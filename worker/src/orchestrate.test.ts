import assert from "node:assert/strict";
import test from "node:test";

import type { ClaimedJob, ThumbnailApi } from "./client.js";
import type { WorkerEnv } from "./env.js";
import { readWorkerEnv } from "./env.js";
import { failureFromTimeout, workerFailure } from "./failures.js";
import { renderUrl, runClaimedJob, runOnePoll, type ThumbnailSession } from "./orchestrate.js";

const env: WorkerEnv = {
  appBaseUrl: "https://app.example",
  workerSecret: "worker-secret",
  pollIntervalMs: 4000,
  healthPort: 8080,
  navigationTimeoutMs: 30_000,
  readyTimeoutMs: 90_000,
  screenshotTimeoutMs: 15_000,
  publishTimeoutMs: 30_000,
  browserRecycleAfterJobs: 25,
};

const job: ClaimedJob = {
  jobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  roomId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222",
  contentToken: "ab".repeat(32),
  claimNonce: "nonce-1",
  claimExpiresAt: "2026-09-25T00:03:00.000Z",
  accessToken: "signed-token",
  attemptCount: 1,
};

test("idle poll does not open a browser session", async () => {
  let opened = 0;
  const result = await runOnePoll({
    env,
    api: fakeApi({ claim: async () => ({ ok: true, job: null }) }),
    openSession: async () => {
      opened += 1;
      throw new Error("no session");
    },
  });
  assert.equal(result.outcome, "idle");
  assert.equal(opened, 0);
});

test("a ready frame is encoded and published with the claim token", async () => {
  const published: Uint8Array[] = [];
  const result = await runClaimedJob({
    env,
    api: fakeApi({
      publish: async (_job, bytes) => {
        published.push(bytes);
        return { ok: true };
      },
    }),
    openSession: async () => readySession(new Uint8Array([1, 2, 3])),
    encode: async () => new Uint8Array([82, 73, 70, 70]),
    now: sequence([0, 10, 25, 30, 40]),
  }, job);
  assert.equal(result.outcome, "completed");
  assert.equal(published.length, 1);
  assert.equal(result.timingsMs?.total, 40);
});

test("render page errors are failed and not published", async () => {
  const codes: string[] = [];
  let publishes = 0;
  const result = await runClaimedJob({
    env,
    api: fakeApi({
      fail: async (_job, failure) => {
        codes.push(failure.code);
      },
      publish: async () => {
        publishes += 1;
        return { ok: true };
      },
    }),
    openSession: async () => readySession(new Uint8Array([1]), {
      status: "error",
      error: { code: "glb_load_failed", message: "Furniture GLB failed to load." },
    }),
  }, job);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(codes, ["glb_load_failed"]);
  assert.equal(publishes, 0);
});

test("readiness timeout maps to a retryable render timeout", async () => {
  const codes: string[] = [];
  const result = await runClaimedJob({
    env,
    api: fakeApi({
      fail: async (_job, failure) => {
        codes.push(failure.code);
        assert.equal(failure.retryable, true);
      },
    }),
    openSession: async () => ({
      goto: async () => undefined,
      waitForReady: async () => {
        throw new Error("Timeout 90000ms exceeded");
      },
      captureFrame: async () => new Uint8Array(),
      close: async () => undefined,
    }),
  }, job);
  assert.equal(result.code, "render_timeout");
  assert.deepEqual(codes, ["render_timeout"]);
});

test("publish rejection does not call fail again", async () => {
  let fails = 0;
  const result = await runClaimedJob({
    env,
    api: fakeApi({
      fail: async () => {
        fails += 1;
      },
      publish: async () => ({ ok: false, code: "stale_publish" }),
    }),
    openSession: async () => readySession(new Uint8Array([1])),
    encode: async () => new Uint8Array([1]),
  }, job);
  assert.equal(result.code, "stale_publish");
  assert.equal(fails, 0);
});

test("render URL carries only the durable access token", () => {
  const url = new URL(renderUrl(env, job));
  assert.equal(url.origin + url.pathname, "https://app.example/internal/vibode-thumbnail-render");
  assert.equal(url.searchParams.get("access"), "signed-token");
  assert.equal(url.searchParams.get("roomId"), null);
});

test("env validation requires the app base URL and worker secret", () => {
  const missing = readWorkerEnv({});
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.deepEqual(missing.missing, ["VIBODE_APP_BASE_URL", "VIBODE_THUMBNAIL_WORKER_SECRET"]);
  const parsed = readWorkerEnv({
    VIBODE_APP_BASE_URL: "https://app.example/",
    VIBODE_THUMBNAIL_WORKER_SECRET: "secret",
    VIBODE_THUMBNAIL_POLL_INTERVAL_MS: "2500",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.env.appBaseUrl, "https://app.example");
  assert.equal(parsed.env.pollIntervalMs, 2500);
});

test("timeout helpers use stable codes", () => {
  assert.equal(failureFromTimeout("navigation").code, "navigation_timeout");
  assert.equal(failureFromTimeout("screenshot").retryable, true);
  assert.equal(workerFailure("render_access_denied", "no").retryable, false);
});

function fakeApi(overrides: Partial<ThumbnailApi> = {}): ThumbnailApi {
  return {
    claim: async () => ({ ok: true, job }),
    fail: async () => undefined,
    publish: async () => ({ ok: true }),
    ...overrides,
  };
}

function readySession(
  png: Uint8Array,
  ready: { status?: string; error?: { code?: string; message?: string } } = { status: "ready" },
): ThumbnailSession {
  return {
    goto: async () => undefined,
    waitForReady: async () => ready,
    captureFrame: async () => png,
    close: async () => undefined,
  };
}

function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}
