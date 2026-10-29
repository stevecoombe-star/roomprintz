import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT, REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT } from "@/lib/vibode-stage/remove-cleanup-jobs/policy";
import { cleanupWorkerProcessingEnabled } from "@/lib/vibode-stage/remove-cleanup-jobs/worker-enabled";

import { startCleanupWorkerHealthServer } from "../../cleanup-worker/src/health";
import { runCleanupWorker } from "../../cleanup-worker/src/run";
import { evaluateCleanupWorkerStartup } from "../../cleanup-worker/src/startup";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const configured = {
  GEMINI_API_KEY: "super-secret-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
};

test("processing is off unless the enable flag is exactly 1", () => {
  assert.equal(cleanupWorkerProcessingEnabled({}), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: undefined }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "" }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "0" }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "true" }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "01" }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "yes" }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: " 1 " }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "1 " }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "1\n" }), false);
  assert.equal(cleanupWorkerProcessingEnabled({ VIBODE_CLEANUP_WORKER_ENABLED: "1" }), true);
  assert.equal(cleanupWorkerProcessingEnabled({
    ...configured,
    VIBODE_CLEANUP_WORKER_ENABLED: "0",
  }), false);
});

test("startup stays idle when credentials exist and the flag is absent or invalid", () => {
  const missing = evaluateCleanupWorkerStartup(configured, ["--provider", "google"]);
  assert.equal(missing.ok, true);
  if (!missing.ok) return;
  assert.equal(missing.processingEnabled, false);
  assert.equal(missing.providerMode, "google");
  assert.equal(missing.port, 8080);
  assert.equal(JSON.stringify(missing).includes("super-secret-key"), false);
  assert.equal(JSON.stringify(missing).includes("service-role-secret"), false);

  for (const value of ["0", "true", "01", "yes", " 1 ", "1 ", "1\n"]) {
    const started = evaluateCleanupWorkerStartup({
      ...configured,
      VIBODE_CLEANUP_WORKER_ENABLED: value,
    }, ["--provider", "google"]);
    assert.equal(started.ok, true, value);
    if (started.ok) assert.equal(started.processingEnabled, false, value);
  }
  const enabled = evaluateCleanupWorkerStartup({
    ...configured,
    VIBODE_CLEANUP_WORKER_ENABLED: "1",
  }, ["--provider", "google"]);
  assert.equal(enabled.ok, true);
  if (enabled.ok) assert.equal(enabled.processingEnabled, true);

  const startup = source("cleanup-worker/src/startup.ts");
  assert.doesNotMatch(startup, /executeCleanupClaim|requestRemoveCleanupNbpCandidate|from\("vibode_/);
});

test("startup refuses a missing credential, an invalid provider, and fake mode in production", () => {
  const missingKey = evaluateCleanupWorkerStartup({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  }, ["--provider", "google"]);
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.equal(missingKey.missing, "GEMINI_API_KEY");

  const missingService = evaluateCleanupWorkerStartup({
    GEMINI_API_KEY: "super-secret-key",
    SUPABASE_URL: "https://example.supabase.co",
  }, ["--provider", "google"]);
  assert.equal(missingService.ok, false);
  if (!missingService.ok) assert.equal(missingService.missing, "SUPABASE_SERVICE_ROLE_KEY");

  const missingUrl = evaluateCleanupWorkerStartup({
    GEMINI_API_KEY: "super-secret-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  }, ["--provider", "google"]);
  assert.equal(missingUrl.ok, false);
  if (!missingUrl.ok) assert.equal(missingUrl.missing, "SUPABASE_URL");

  const missingProvider = evaluateCleanupWorkerStartup(configured, []);
  assert.equal(missingProvider.ok, false);
  if (!missingProvider.ok) assert.equal(missingProvider.missing, "--provider google|fake");

  const fake = evaluateCleanupWorkerStartup({
    ...configured,
    NODE_ENV: "production",
  }, ["--provider", "fake"]);
  assert.equal(fake.ok, false);
  if (!fake.ok) assert.equal(fake.missing, "fake provider is refused in production");

  const badPort = evaluateCleanupWorkerStartup({ ...configured, PORT: "0" }, ["--provider", "google"]);
  assert.equal(badPort.ok, false);
  if (!badPort.ok) assert.equal(badPort.missing, "PORT");
});

test("a disabled or omitted worker loop makes no claims and logs once", async () => {
  for (const enabled of [undefined, () => false] as const) {
    let calls = 0;
    let sleeps = 0;
    let stop = false;
    const logs: string[] = [];
    const code = await runCleanupWorker({
      once: async () => {
        calls += 1;
        throw new Error("claimed");
      },
      pollIntervalMs: 1,
      shouldStop: () => stop,
      sleep: async () => {
        sleeps += 1;
        if (sleeps >= 3) stop = true;
      },
      log: (event) => {
        logs.push(event);
      },
      ...(enabled ? { enabled } : {}),
    });
    assert.equal(code, 0);
    assert.equal(calls, 0);
    assert.equal(sleeps, 3);
    assert.deepEqual(logs, ["processing_disabled"]);
  }

  let passes = 0;
  let stop = false;
  const enabledCode = await runCleanupWorker({
    once: async () => {
      passes += 1;
      stop = true;
      return { outcome: "idle", code: null, jobId: null };
    },
    pollIntervalMs: 1,
    shouldStop: () => stop,
    sleep: async () => undefined,
    log: () => undefined,
    enabled: () => true,
  });
  assert.equal(enabledCode, 0);
  assert.equal(passes, 1);

  const run = source("cleanup-worker/src/run.ts");
  const gate = run.indexOf("if (!processingEnabled())");
  const once = run.indexOf("await input.once()");
  assert.ok(gate > 0 && once > gate);
  assert.match(run, /input\.enabled \?\? \(\(\) => false\)/);
  const worker = source("cleanup-worker/src/index.ts");
  assert.match(worker, /enabled: \(\) => cleanupWorkerProcessingEnabled\(process\.env\)/);
  assert.match(worker, /worker_config_invalid/);
  assert.doesNotMatch(worker, /executeCleanupClaim\(\{[\s\S]*enabled/);
});

test("health output reports readiness without secrets", async () => {
  const server = await startCleanupWorkerHealthServer({
    port: 0,
    host: "127.0.0.1",
    snapshot: () => ({
      status: "ok",
      live: true,
      ready: true,
      readiness: "process",
      processingEnabled: false,
      idle: true,
      provider: "google",
    }),
  });
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);
    const body = await health.json() as { processingEnabled: boolean; ready: boolean; provider: string };
    assert.equal(body.processingEnabled, false);
    assert.equal(body.ready, true);
    assert.equal(body.provider, "google");
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /super-secret|service-role|supabase|GEMINI|BEGIN /i);
    const ready = await fetch(`http://127.0.0.1:${server.port}/ready?token=super-secret-key`);
    assert.equal(ready.status, 200);
    assert.equal(JSON.stringify(await ready.json()).includes("super-secret"), false);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/claim`)).status, 404);
  } finally {
    await server.close();
  }
  const healthSource = source("cleanup-worker/src/health.ts");
  assert.doesNotMatch(healthSource, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|process\.env/);
});

test("the Clean Up image defaults processing off and stays separate from the other workers", () => {
  const dockerfile = source("cleanup-worker/Dockerfile");
  const script = source("package.json");
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.match(dockerfile, /^ENV VIBODE_CLEANUP_WORKER_ENABLED=0$/m);
  assert.doesNotMatch(dockerfile, /^ENV VIBODE_CLEANUP_WORKER_ENABLED=1$/m);
  assert.match(dockerfile, /COPY lib \.\/lib/);
  assert.match(dockerfile, /COPY app \.\/app/);
  assert.match(dockerfile, /COPY cleanup-worker \.\/cleanup-worker/);
  assert.doesNotMatch(dockerfile, /COPY \.env|harmonize-worker|CMD \[.*worker\/dist/);
  assert.match(dockerfile, /cleanup-worker\/src\/index\.ts/);
  assert.match(dockerfile, /--conditions=react-server/);
  assert.match(dockerfile, /--provider", "google"/);
  assert.match(dockerfile, /\/health/);
  assert.match(script, /"cleanup:worker": "node --conditions=react-server --import tsx cleanup-worker\/src\/index\.ts"/);
  const cleanupSql = source("supabase/migrations/20261020193000_vibode_cleanup_generations.sql");
  const samSql = source("supabase/migrations/20261021180000_vibode_remove_segmentation_limits.sql");
  assert.match(cleanupSql, /vibode_cleanup_user_daily_provider_limit\(\)[\s\S]*select 5;/);
  assert.match(cleanupSql, /vibode_cleanup_global_daily_provider_limit\(\)[\s\S]*select 5;/);
  assert.match(samSql, /vibode_remove_segmentation_user_daily_limit\(\)[\s\S]*select 24;/);
  assert.match(samSql, /vibode_remove_segmentation_global_daily_limit\(\)[\s\S]*select 200;/);
  assert.equal(REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT, 5);
  assert.equal(REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT, 5);
});
