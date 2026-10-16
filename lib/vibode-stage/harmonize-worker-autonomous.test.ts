import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { executeHarmonizeClaim } from "@/lib/vibode-stage/harmonize-jobs/execute";
import type { HarmonizeWorkerApi, HarmonizeWorkerClaim } from "@/lib/vibode-stage/harmonize-jobs/worker-api";
import { harmonizeWorkerProcessingEnabled } from "@/lib/vibode-stage/harmonize-jobs/worker-enabled";

import { createHarmonizeWorkerHealthState, startHarmonizeWorkerHealthServer } from "../../harmonize-worker/src/health";
import {
  createHttpHarmonizeWorkerApi,
  createHttpHarmonizeWorkerControl,
} from "../../harmonize-worker/src/http-api";
import { runHarmonizeWorker } from "../../harmonize-worker/src/run";
import { evaluateHarmonizeWorkerStartup } from "../../harmonize-worker/src/startup";

const JOB = "11111111-1111-4111-8111-111111111111";

test("processing is off unless the enable flag is exactly 1", () => {
  assert.equal(harmonizeWorkerProcessingEnabled({}), false);
  assert.equal(harmonizeWorkerProcessingEnabled({ VIBODE_HARMONIZE_WORKER_ENABLED: "true" }), false);
  assert.equal(harmonizeWorkerProcessingEnabled({ VIBODE_HARMONIZE_WORKER_ENABLED: "01" }), false);
  assert.equal(harmonizeWorkerProcessingEnabled({ VIBODE_HARMONIZE_WORKER_ENABLED: " 1 " }), true);
  assert.equal(harmonizeWorkerProcessingEnabled({
    VIBODE_HARMONIZE_WORKER_ENABLED: "1",
    GEMINI_API_KEY: "present",
    VIBODE_HARMONIZE_WORKER_SECRET: "present",
  }), true);
});

test("startup stays unconfigured for work when credentials exist and the flag is absent", () => {
  const started = evaluateHarmonizeWorkerStartup({
    VIBODE_APP_BASE_URL: "https://app.example",
    VIBODE_HARMONIZE_WORKER_SECRET: "worker-secret",
    GEMINI_API_KEY: "provider-key",
  }, []);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.processingEnabled, false);
  assert.equal(started.providerMode, "google");
  assert.equal(started.selection.mode, "continuous");
  assert.equal(started.port, 8080);
  const startup = readFileSync(path.join(process.cwd(), "harmonize-worker/src/startup.ts"), "utf8");
  assert.doesNotMatch(startup, /createHarmonizeNbpProvider|generativelanguage|executeHarmonizeClaim/);
  assert.doesNotMatch(startup, /VIBODE_HARMONIZE_MODE/);
});

test("startup refuses a missing secret, an invalid provider, and fake mode in production", () => {
  const base = {
    VIBODE_APP_BASE_URL: "https://app.example",
    GEMINI_API_KEY: "provider-key",
  };
  const missingSecret = evaluateHarmonizeWorkerStartup(base, []);
  assert.equal(missingSecret.ok, false);
  if (!missingSecret.ok) assert.match(missingSecret.missing, /VIBODE_HARMONIZE_WORKER_SECRET/);
  const missingUrl = evaluateHarmonizeWorkerStartup({
    VIBODE_HARMONIZE_WORKER_SECRET: "worker-secret",
    GEMINI_API_KEY: "provider-key",
  }, []);
  assert.equal(missingUrl.ok, false);
  if (!missingUrl.ok) assert.match(missingUrl.missing, /VIBODE_APP_BASE_URL/);
  const invalid = evaluateHarmonizeWorkerStartup({
    ...base,
    VIBODE_HARMONIZE_WORKER_SECRET: "worker-secret",
    VIBODE_HARMONIZE_PROVIDER: "other",
  }, []);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.missing, "invalid_provider");
  const missingKey = evaluateHarmonizeWorkerStartup({
    VIBODE_APP_BASE_URL: "https://app.example",
    VIBODE_HARMONIZE_WORKER_SECRET: "worker-secret",
  }, []);
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.equal(missingKey.missing, "GEMINI_API_KEY");
  const fake = evaluateHarmonizeWorkerStartup({
    ...base,
    VIBODE_HARMONIZE_WORKER_SECRET: "worker-secret",
    VIBODE_HARMONIZE_PROVIDER: "fake",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
    NODE_ENV: "production",
  }, []);
  assert.equal(fake.ok, false);
  if (!fake.ok) assert.equal(fake.missing, "fake_forbidden");
});

test("a disabled continuous worker does not claim, recover, or exit", async () => {
  let generations = 0;
  let recoveries = 0;
  let stop = false;
  const logs: string[] = [];
  const code = await runHarmonizeWorker({
    selection: { mode: "continuous" },
    enabled: () => false,
    execute: async () => {
      generations += 1;
      return { outcome: "idle", code: null, jobId: null };
    },
    recover: async () => {
      recoveries += 1;
      return { outcome: "idle", code: null, kind: null, activated: false, blocked: false };
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async () => {
      stop = true;
    },
    log: (event) => {
      logs.push(event);
    },
  });
  assert.equal(code, 0);
  assert.equal(generations, 0);
  assert.equal(recoveries, 0);
  assert.deepEqual(logs, ["processing_disabled"]);
});

test("exact-ID mode also refuses to run when processing is disabled", async () => {
  let generations = 0;
  const code = await runHarmonizeWorker({
    selection: { mode: "once", jobId: JOB },
    enabled: () => false,
    execute: async () => {
      generations += 1;
      return { outcome: "succeeded", code: "completed", jobId: JOB };
    },
    recover: async () => {
      throw new Error("exact-ID mode started recovery");
    },
    pollIntervalMs: 2000,
    shouldStop: () => false,
    sleep: async () => undefined,
    log: () => undefined,
  });
  assert.equal(code, 1);
  assert.equal(generations, 0);
});

test("recovery continues while a generation is in progress and while the database defers", async () => {
  let generations = 0;
  let recoveries = 0;
  let releaseGeneration: (value?: void) => void = () => undefined;
  const generationGate = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  let stop = false;
  let sawRecoveryDuringGeneration = false;
  let sawRecoveryDuringDefer = false;
  let generationDeferred = false;
  const pending = runHarmonizeWorker({
    selection: { mode: "continuous" },
    enabled: () => true,
    execute: async () => {
      generations += 1;
      if (generations === 1) {
        await generationGate;
        return { outcome: "succeeded", code: "completed", jobId: JOB };
      }
      return { outcome: "idle", code: generations === 2 ? "global_busy" : "global_daily_limit", jobId: null };
    },
    recover: async () => {
      recoveries += 1;
      if (generations === 1) sawRecoveryDuringGeneration = true;
      if (generationDeferred) sawRecoveryDuringDefer = true;
      return { outcome: "idle", code: null, kind: null, activated: false, blocked: false };
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async (ms) => {
      if (ms >= 15_000) {
        generationDeferred = true;
        const seen = recoveries;
        while (recoveries === seen) await Promise.resolve();
        stop = true;
      }
    },
    log: () => undefined,
  });
  await waitFor(() => sawRecoveryDuringGeneration);
  assert.equal(generations, 1);
  releaseGeneration();
  await pending;
  assert.equal(generations >= 2, true);
  assert.equal(sawRecoveryDuringDefer, true);
  assert.equal(stop, true);
});

test("an empty queue, a thrown claim, and a blocked recovery still let the other loop move", async () => {
  let generations = 0;
  let recoveries = 0;
  let stop = false;
  const code = await runHarmonizeWorker({
    selection: { mode: "continuous" },
    enabled: () => true,
    execute: async () => {
      generations += 1;
      if (generations === 1) return { outcome: "idle", code: null, jobId: null };
      throw new Error("claim transport failed");
    },
    recover: async () => {
      recoveries += 1;
      if (recoveries === 1) {
        return { outcome: "failed", code: "recovery_abandoned", kind: "history", activated: false, blocked: true };
      }
      stop = true;
      return { outcome: "idle", code: null, kind: null, activated: false, blocked: false };
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async () => undefined,
    log: () => undefined,
  });
  assert.equal(code, 0);
  assert.equal(generations >= 2, true);
  assert.equal(recoveries >= 2, true);
});

test("a thrown generation does not leave the loop or start another claim immediately", async () => {
  let generations = 0;
  let stop = false;
  const sleeps: number[] = [];
  const code = await runHarmonizeWorker({
    selection: { mode: "continuous" },
    enabled: () => true,
    execute: async () => {
      generations += 1;
      throw new Error("provider transport failed");
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async (ms) => {
      sleeps.push(ms);
      stop = true;
    },
    log: () => undefined,
  });
  assert.equal(code, 0);
  assert.equal(generations, 1);
  assert.deepEqual(sleeps, [15_000]);
});

test("SIGTERM during a generation lets that generation finish and does not start recovery or another claim", async () => {
  let stop = false;
  let generations = 0;
  let recoveries = 0;
  let release: (value?: void) => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = runHarmonizeWorker({
    selection: { mode: "continuous" },
    enabled: () => true,
    execute: async () => {
      generations += 1;
      stop = true;
      await gate;
      return { outcome: "succeeded", code: "completed", jobId: JOB };
    },
    recover: async () => {
      recoveries += 1;
      return { outcome: "completed", code: "published", kind: "history", activated: false, blocked: false };
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async () => {
      throw new Error("the loop slept after shutdown");
    },
    log: () => undefined,
  });
  await waitFor(() => generations === 1);
  assert.equal(recoveries, 0);
  release();
  assert.equal(await pending, 0);
  assert.equal(generations, 1);
  assert.equal(recoveries, 0);
});

test("shutdown during History recovery finishes that recovery and does not claim again", async () => {
  let stop = false;
  let generations = 0;
  let recoveries = 0;
  let release: (value?: void) => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = runHarmonizeWorker({
    selection: { mode: "continuous" },
    enabled: () => true,
    execute: async () => {
      generations += 1;
      return { outcome: "idle", code: null, jobId: null };
    },
    recover: async () => {
      recoveries += 1;
      stop = true;
      await gate;
      return { outcome: "failed", code: "thumbnail_failed", kind: "thumbnail", activated: false, blocked: false };
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async () => {
      throw new Error("the loop slept after recovery shutdown");
    },
    log: () => undefined,
  });
  await waitFor(() => recoveries === 1);
  assert.equal(generations, 1);
  release();
  assert.equal(await pending, 0);
  assert.equal(generations, 1);
  assert.equal(recoveries, 1);
});

test("a disable after an uncontacted claim releases it and does not call the provider", async () => {
  const claim = claimFixture();
  let providerCalls = 0;
  const failures: Array<{ code: string; retryable: boolean }> = [];
  const api: HarmonizeWorkerApi = {
    async claim() {
      return claim;
    },
    async composite() {
      return Uint8Array.from([1, 2, 3]);
    },
    async contact() {
      return { ok: false, code: "worker_disabled" };
    },
    async heartbeat() {
      return true;
    },
    async complete() {
      throw new Error("a disabled claim was completed");
    },
    async fail(_claimed, failure) {
      failures.push({ code: failure.code, retryable: failure.retryable });
      return { ok: true, code: "requeued" };
    },
  };
  const result = await executeHarmonizeClaim({
    api,
    heartbeatIntervalMs: 60_000,
    provider: async () => {
      providerCalls += 1;
      throw new Error("provider");
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.outcome, "failed");
  assert.equal(result.code, "worker_disabled");
  assert.deepEqual(failures, [{ code: "worker_interrupted", retryable: true }]);
});

test("an already contacted job is not sent to the provider again", async () => {
  const claim = claimFixture();
  let providerCalls = 0;
  const api: HarmonizeWorkerApi = {
    async claim() {
      return claim;
    },
    async composite() {
      return Uint8Array.from([1, 2, 3]);
    },
    async contact() {
      return { ok: false, code: "already_contacted" };
    },
    async heartbeat() {
      return true;
    },
    async complete() {
      throw new Error("an uncertain job was completed");
    },
    async fail(_claimed, failure) {
      assert.equal(failure.code, "provider_uncertain");
      assert.equal(failure.retryable, false);
      return { ok: true, code: "failed" };
    },
  };
  const result = await executeHarmonizeClaim({
    api,
    heartbeatIntervalMs: 60_000,
    provider: async () => {
      providerCalls += 1;
      throw new Error("provider");
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.outcome, "failed");
  assert.equal(result.code, "provider_uncertain");
});

test("claim dispositions for a busy or exhausted global ceiling reach the loop", async () => {
  const calls: string[] = [];
  const api = createHttpHarmonizeWorkerApi({
    appBaseUrl: "https://app.example",
    workerSecret: "worker-secret",
    pollIntervalMs: 2000,
  }, {
    fetchImpl: async () => Response.json({ ok: true, job: null, code: "global_daily_limit" }),
  });
  const claimed = await api.claim();
  assert.equal(claimed, null);
  assert.equal(api.claimDisposition?.(), "global_daily_limit");
  const result = await executeHarmonizeClaim({
    api,
    provider: async () => {
      throw new Error("a deferred claim called the provider");
    },
  });
  assert.equal(result.outcome, "idle");
  assert.equal(result.code, "global_daily_limit");
  calls.push(result.code ?? "");
  assert.deepEqual(calls, ["global_daily_limit"]);
});

test("recovery and operations use the worker secret and do not carry image fields", async () => {
  const seen: string[] = [];
  const control = createHttpHarmonizeWorkerControl({
    appBaseUrl: "https://app.example",
    workerSecret: "worker-secret",
    pollIntervalMs: 2000,
  }, {
    fetchImpl: async (url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-vibode-harmonize-worker"), "worker-secret");
      if (String(url).includes("action=operations")) {
        return Response.json({
          ok: true,
          processingEnabled: false,
          globalProviderContactsToday: 4,
          globalProviderContactLimit: 10,
        });
      }
      return Response.json({
        outcome: "idle",
        code: "worker_disabled",
        prompt: "hidden",
        outputPath: "rooms/private.jpg",
      });
    },
  });
  const recovered = await control.recover();
  const operations = await control.operations();
  assert.equal(recovered.outcome, "idle");
  assert.equal(recovered.code, "worker_disabled");
  assert.equal("prompt" in recovered, false);
  assert.deepEqual(operations, {
    globalProviderContactsToday: 4,
    globalProviderContactLimit: 10,
    appProcessingEnabled: false,
  });
  assert.deepEqual(seen, [
    "POST https://app.example/api/internal/vibode-harmonize-jobs?action=recover",
    "GET https://app.example/api/internal/vibode-harmonize-jobs?action=operations",
  ]);
});

test("health stays live and ready while processing is disabled and hides private fields", async () => {
  const state = createHarmonizeWorkerHealthState("google");
  state.noteOperations({
    globalProviderContactsToday: 2,
    globalProviderContactLimit: 10,
    appProcessingEnabled: false,
  });
  const server = await startHarmonizeWorkerHealthServer({
    port: 0,
    host: "127.0.0.1",
    snapshot: () => state.snapshot(false),
  });
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    const ready = await fetch(`http://127.0.0.1:${server.port}/ready`);
    assert.equal(health.status, 200);
    assert.equal(ready.status, 200);
    const body = await health.json() as Record<string, unknown>;
    assert.equal(body.status, "ok");
    assert.equal(body.live, true);
  assert.equal(body.ready, true);
  assert.equal(body.readiness, "process");
  assert.equal(body.providerSpendAuthorized, false);
  assert.equal(body.processingEnabled, false);
    assert.equal(body.idle, true);
    assert.equal(body.provider, "google");
    assert.equal(body.globalProviderContactsToday, 2);
    state.noteGeneration({ outcome: "failed", code: "provider_uncertain", jobId: null });
    state.noteRecovery({
      outcome: "failed",
      code: "thumbnail_failed",
      kind: "thumbnail",
      activated: false,
      blocked: false,
    });
    const distinguished = state.snapshot(false);
    assert.equal(distinguished.lastGenerationFailureCode, "provider_uncertain");
    assert.equal(distinguished.lastRecoveryFailureCode, "thumbnail_failed");
    assert.equal(distinguished.providerSpendAuthorized, false);
    state.noteOperations({
      globalProviderContactsToday: 2,
      globalProviderContactLimit: 10,
      appProcessingEnabled: true,
    });
    assert.equal(state.snapshot(false).providerSpendAuthorized, false);
    assert.equal(state.snapshot(true).providerSpendAuthorized, true);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /worker-secret|GEMINI|prompt|sha256|signed|storage_path|rooms\//i);
    assert.equal((await ready.json() as { processingEnabled: boolean }).processingEnabled, false);
  } finally {
    await server.close();
  }
});

test("the worker image does not bundle environment files or start a paid generation", () => {
  const dockerfile = readFileSync(path.join(process.cwd(), "harmonize-worker/Dockerfile"), "utf8");
  const ignore = readFileSync(path.join(process.cwd(), ".dockerignore"), "utf8");
  const index = readFileSync(path.join(process.cwd(), "harmonize-worker/src/index.ts"), "utf8");
  assert.match(dockerfile, /CMD \["node", "--import", "tsx", "harmonize-worker\/src\/index.ts"\]/);
  assert.doesNotMatch(dockerfile, /--once|--job-id|GEMINI_API_KEY=|COPY \.env/);
  assert.match(dockerfile, /\/health/);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(index, /enabled: \(\) => harmonizeWorkerProcessingEnabled\(process\.env\)/);
  assert.doesNotMatch(index, /dotenv|\.env\.local/);
  const heartbeat = readFileSync(path.join(process.cwd(), "app/api/internal/vibode-harmonize-jobs/route.ts"), "utf8");
  const heartbeatBlock = heartbeat.slice(
    heartbeat.indexOf('action === "heartbeat"'),
    heartbeat.indexOf('action === "contact"'),
  );
  assert.doesNotMatch(heartbeatBlock, /harmonizeWorkerProcessingEnabled|worker_disabled/);
  const jobs = readFileSync(path.join(process.cwd(), "app/api/vibode/harmonize/jobs/route.ts"), "utf8");
  assert.doesNotMatch(jobs, /VIBODE_HARMONIZE_WORKER_ENABLED|runServiceHarmonizeHistoryRecovery/);
});

async function waitFor(ready: () => boolean): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 1000) throw new Error("timed out waiting for the worker loop");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function claimFixture(): HarmonizeWorkerClaim {
  const prompt = "Photorealistic Furniture Harmonization";
  const png = Uint8Array.from([1, 2, 3]);
  return {
    jobId: JOB,
    roomId: "22222222-2222-4222-8222-222222222222",
    claimNonce: "33333333-3333-4333-8333-333333333333",
    prompt,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    compositeSha256: createHash("sha256").update(png).digest("hex"),
    compositeWidth: 1200,
    compositeHeight: 896,
    requestedModelId: "gemini-3-pro-image",
  };
}
