import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseHarmonizeWorkerArgs } from "@/harmonize-worker/src/args";
import { createHttpHarmonizeWorkerApi } from "@/harmonize-worker/src/http-api";
import { runHarmonizeWorker } from "@/harmonize-worker/src/run";
import {
  claimNextHarmonizeJob,
  createHarmonizeJobDatabase,
  enqueueHarmonizeJob,
  type HarmonizeJobDatabase,
} from "@/lib/vibode-stage/harmonize-jobs/engine";
import { executeHarmonizeClaim } from "@/lib/vibode-stage/harmonize-jobs/execute";
import { createMemoryHarmonizeWorkerApi } from "@/lib/vibode-stage/harmonize-jobs/memory-api";
import { createHarmonizeFakeProvider, readHarmonizeWorkerProviderMode } from "@/lib/vibode-stage/harmonize-jobs/provider";
import type { HarmonizeJobInsert, HarmonizeJobRow } from "@/lib/vibode-stage/harmonize-jobs/types";

const PROMPT = "UNIQUE_PROMPT_SENTINEL";
const OLDER = "11111111-1111-4111-8111-111111111111";
const NEWER = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ROOM_B = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

test("worker arguments accept one exact job and reject every other shape", () => {
  assert.deepEqual(parseHarmonizeWorkerArgs([]), { ok: true, selection: { mode: "continuous" } });
  assert.deepEqual(parseHarmonizeWorkerArgs(["--job-id", NEWER, "--once"]), {
    ok: true,
    selection: { mode: "once", jobId: NEWER },
  });
  assert.deepEqual(parseHarmonizeWorkerArgs(["--once", "--job-id", NEWER.toUpperCase()]), {
    ok: true,
    selection: { mode: "once", jobId: NEWER },
  });
  assert.equal(parseHarmonizeWorkerArgs(["--once"]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["--job-id", NEWER]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["--job-id", "not-a-uuid", "--once"]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["--job-id", "--once"]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["--job-id", NEWER, "--once", "--extra"]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["--once", "--once", "--job-id", NEWER]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["--job-id", NEWER, "--job-id", OLDER, "--once"]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs([`--job-id=${NEWER}`, "--once"]).ok, false);
  assert.equal(parseHarmonizeWorkerArgs(["positional"]).ok, false);
});

test("an exact claim takes only that job", () => {
  const db = pair();
  const claimed = claimNextHarmonizeJob(db, 5, NEWER);
  assert.equal(claimed?.jobId, NEWER);
  assert.equal(status(db, OLDER), "queued");
  assert.equal(status(db, NEWER), "running");
  assert.equal(claimNextHarmonizeJob(db, 5, NEWER), null);
  assert.equal(db.jobs.find((job) => job.id === NEWER)?.attemptCount, 1);
  assert.equal(status(db, OLDER), "queued");
});

test("continuous claim still takes the oldest queued job", () => {
  const db = pair();
  const claimed = claimNextHarmonizeJob(db, 5);
  assert.equal(claimed?.jobId, OLDER);
  assert.equal(status(db, NEWER), "queued");
});

test("an unknown, waiting, running, or terminal job is not claimed and does not take another", () => {
  const db = pair();
  assert.equal(claimNextHarmonizeJob(db, 5, "33333333-3333-4333-8333-333333333333"), null);
  const older = row(db, OLDER);
  older.notBeforeMs = 50;
  assert.equal(claimNextHarmonizeJob(db, 5, OLDER), null);
  assert.equal(status(db, OLDER), "queued");
  assert.equal(status(db, NEWER), "queued");
  older.notBeforeMs = 0;
  older.status = "succeeded";
  assert.equal(claimNextHarmonizeJob(db, 5, OLDER), null);
  assert.equal(status(db, NEWER), "queued");
  const running = claimNextHarmonizeJob(db, 5, NEWER);
  assert.equal(running?.jobId, NEWER);
  assert.equal(claimNextHarmonizeJob(db, 5, NEWER), null);
  assert.equal(status(db, OLDER), "succeeded");
});

test("an exact claim does not reap or fail a different job", () => {
  const db = pair();
  const older = row(db, OLDER);
  older.status = "running";
  older.claimExpiresAtMs = 1;
  older.providerStartedAtMs = 1;
  older.attemptCount = 1;
  const claimed = claimNextHarmonizeJob(db, 500, NEWER);
  assert.equal(claimed?.jobId, NEWER);
  assert.equal(status(db, OLDER), "running");
  assert.equal(older.failureCode, null);
});

test("a continuous claim still closes an expired contacted lease before taking the next job", () => {
  const db = pair();
  const older = row(db, OLDER);
  older.status = "running";
  older.claimExpiresAtMs = 1;
  older.providerStartedAtMs = 1;
  older.attemptCount = 1;
  const claimed = claimNextHarmonizeJob(db, 500);
  assert.equal(claimed?.jobId, NEWER);
  assert.equal(status(db, OLDER), "failed");
  assert.equal(older.failureCode, "provider_uncertain");
});

test("an exact daily-limit failure does not claim the other queued job", () => {
  const db = pair();
  const template = row(db, OLDER);
  for (let index = 0; index < 10; index += 1) {
    db.jobs.push({
      ...template,
      id: `44444444-4444-4444-8444-${index.toString(16).padStart(12, "0")}`,
      idempotencyKey: `cap-${index}`,
      status: "failed",
      providerStartedAtMs: 1,
    });
  }
  assert.equal(claimNextHarmonizeJob(db, 20, OLDER), null);
  assert.equal(status(db, OLDER), "failed");
  assert.equal(row(db, OLDER).failureCode, "daily_limit");
  assert.equal(status(db, NEWER), "queued");
});

test("an ineligible exact job performs zero provider calls", async () => {
  const db = pair();
  row(db, NEWER).status = "succeeded";
  const calls = await runOnce(db, NEWER);
  assert.equal(calls.providerCalls, 0);
  assert.equal(calls.executeCalls, 1);
  assert.equal(calls.exitCode, 1);
  assert.equal(calls.sleeps, 0);
  assert.equal(status(db, OLDER), "queued");
  assert.equal(status(db, NEWER), "succeeded");
  assert.match(JSON.stringify(calls.logs), /job_finished/);
  assert.match(JSON.stringify(calls.logs), /not_claimed/);
  assert.match(JSON.stringify(calls.logs), new RegExp(NEWER));
  assert.doesNotMatch(JSON.stringify(calls.logs), /UNIQUE_PROMPT_SENTINEL/);
});

test("successful single-job processing exits without another claim", async () => {
  const db = pair();
  const calls = await runOnce(db, NEWER);
  assert.equal(calls.providerCalls, 1);
  assert.equal(calls.executeCalls, 1);
  assert.equal(calls.exitCode, 0);
  assert.equal(calls.sleeps, 0);
  assert.equal(status(db, NEWER), "succeeded");
  assert.equal(row(db, NEWER).historyState, "published");
  assert.equal(status(db, OLDER), "queued");
  assert.equal(row(db, OLDER).historyState, "pending");
  assert.equal(row(db, OLDER).providerStartedAtMs, null);
  const logged = JSON.stringify(calls.logs);
  assert.match(logged, /"historyOutcome":"published"/);
  assert.doesNotMatch(logged, /UNIQUE_PROMPT_SENTINEL/);
  assert.doesNotMatch(logged, /[0-9a-f]{64}/);
});

test("exact-id once does not publish or claim another succeeded pending job", async () => {
  const db = pair();
  const older = row(db, OLDER);
  older.status = "succeeded";
  older.historyState = "pending";
  older.outputBucket = "vibode-harmonize";
  older.outputPath = `rooms/${ROOM_A}/jobs/${OLDER}/output-left.jpg`;
  older.outputSha256 = "ab".repeat(32);
  older.outputMime = "image/jpeg";
  older.outputWidth = 2400;
  older.outputHeight = 1792;
  const calls = await runOnce(db, NEWER);
  assert.equal(calls.providerCalls, 1);
  assert.equal(calls.exitCode, 0);
  assert.equal(older.status, "succeeded");
  assert.equal(older.historyState, "pending");
  assert.equal(older.providerStartedAtMs, null);
  assert.equal(row(db, NEWER).historyState, "published");
  assert.equal(row(db, NEWER).attemptCount, 1);
});

test("a history failure keeps generation success and does not pay the provider again", async () => {
  const db = pair();
  let providerCalls = 0;
  let publications = 0;
  const fake = createHarmonizeFakeProvider();
  const api = createMemoryHarmonizeWorkerApi({
    db,
    composites: new Map(db.jobs.map((job) => [job.id, pngHeader(1200, 896)])),
    outputs: new Map(),
    clock: { nowMs: 5 },
    jobId: NEWER,
    publishHistory: async () => {
      publications += 1;
      return { outcome: "pending", code: "output_unreadable" };
    },
  });
  const first = await executeHarmonizeClaim({
    api,
    provider: async (input) => {
      providerCalls += 1;
      return fake(input);
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(first.outcome, "succeeded");
  assert.equal(first.history?.outcome, "pending");
  assert.equal(first.history?.code, "output_unreadable");
  assert.equal(status(db, NEWER), "succeeded");
  assert.equal(row(db, NEWER).historyState, "pending");
  assert.equal(providerCalls, 1);
  assert.equal(publications, 1);
  const second = await executeHarmonizeClaim({
    api,
    provider: async (input) => {
      providerCalls += 1;
      return fake(input);
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(second.outcome, "idle");
  assert.equal(providerCalls, 1);
  assert.equal(publications, 1);
  assert.equal(status(db, OLDER), "queued");
  assert.equal(row(db, OLDER).historyState, "pending");
});

test("a lost complete response after commit does not fail the generation or call the provider again", async () => {
  const db = pair();
  let providerCalls = 0;
  let failCalls = 0;
  const fake = createHarmonizeFakeProvider();
  const inner = workerApi(db, NEWER);
  const api = {
    ...inner,
    async complete(claim: Parameters<typeof inner.complete>[0], completion: Parameters<typeof inner.complete>[1]) {
      const stored = await inner.complete(claim, completion);
      assert.equal(stored.ok, true);
      return { ok: false as const, code: "complete_failed" };
    },
    async fail(claim: Parameters<typeof inner.fail>[0], failure: Parameters<typeof inner.fail>[1]) {
      failCalls += 1;
      return inner.fail(claim, failure);
    },
  };
  const logs: Array<{ event: string; fields: Record<string, string | number | null> }> = [];
  const exitCode = await runHarmonizeWorker({
    selection: { mode: "once", jobId: NEWER },
    execute: () => executeHarmonizeClaim({
      api,
      provider: async (input) => {
        providerCalls += 1;
        return fake(input);
      },
      heartbeatIntervalMs: 60_000,
    }),
    pollIntervalMs: 2000,
    shouldStop: () => false,
    sleep: async () => {
      throw new Error("single-job mode slept");
    },
    log: (event, fields) => {
      logs.push({ event, fields });
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(providerCalls, 1);
  assert.equal(failCalls, 0);
  assert.equal(status(db, NEWER), "succeeded");
  assert.equal(row(db, NEWER).failureCode, null);
  assert.equal(row(db, NEWER).historyState, "published");
  assert.ok(row(db, NEWER).providerStartedAtMs);
  assert.equal(status(db, OLDER), "queued");
  assert.equal(row(db, OLDER).providerStartedAtMs, null);
  assert.equal(logs[0]?.fields.outcome, "stale");
  assert.equal(logs[0]?.fields.code, "complete_failed");
  assert.equal(logs[0]?.fields.historyOutcome, null);
  const again = await executeHarmonizeClaim({
    api,
    provider: async (input) => {
      providerCalls += 1;
      return fake(input);
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(again.outcome, "idle");
  assert.equal(providerCalls, 1);
  assert.equal(failCalls, 0);
  assert.equal(status(db, NEWER), "succeeded");
  assert.equal(status(db, OLDER), "queued");
});

test("a dropped complete response after commit does not start another provider call", async () => {
  const db = pair();
  let providerCalls = 0;
  let failCalls = 0;
  const fake = createHarmonizeFakeProvider();
  const inner = workerApi(db, NEWER);
  const api = {
    ...inner,
    async complete(claim: Parameters<typeof inner.complete>[0], completion: Parameters<typeof inner.complete>[1]) {
      const stored = await inner.complete(claim, completion);
      assert.equal(stored.ok, true);
      throw new Error("complete response dropped");
    },
    async fail(claim: Parameters<typeof inner.fail>[0], failure: Parameters<typeof inner.fail>[1]) {
      failCalls += 1;
      return inner.fail(claim, failure);
    },
  };
  const logs: Array<{ event: string; fields: Record<string, string | number | null> }> = [];
  const exitCode = await runHarmonizeWorker({
    selection: { mode: "once", jobId: NEWER },
    execute: () => executeHarmonizeClaim({
      api,
      provider: async (input) => {
        providerCalls += 1;
        return fake(input);
      },
      heartbeatIntervalMs: 60_000,
    }),
    pollIntervalMs: 2000,
    shouldStop: () => false,
    sleep: async () => {
      throw new Error("single-job mode slept");
    },
    log: (event, fields) => {
      logs.push({ event, fields });
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(providerCalls, 1);
  assert.equal(failCalls, 0);
  assert.equal(status(db, NEWER), "succeeded");
  assert.equal(row(db, NEWER).failureCode, null);
  assert.equal(logs[0]?.fields.outcome, "failed");
  assert.equal(logs[0]?.fields.code, "poll_failed");
  assert.equal(logs[0]?.fields.historyOutcome, null);
  const again = await executeHarmonizeClaim({
    api,
    provider: async (input) => {
      providerCalls += 1;
      return fake(input);
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(again.outcome, "idle");
  assert.equal(providerCalls, 1);
  assert.equal(status(db, OLDER), "queued");
});

test("failed single-job processing does not start the other job", async () => {
  const db = pair();
  const calls = await runOnce(db, NEWER, async () => {
    throw new Error("provider down");
  });
  assert.equal(calls.providerCalls, 1);
  assert.equal(calls.executeCalls, 1);
  assert.equal(calls.exitCode, 1);
  assert.equal(status(db, NEWER), "failed");
  assert.equal(row(db, NEWER).failureCode, "provider_uncertain");
  assert.equal(status(db, OLDER), "queued");
  const finished = calls.logs.find((entry) => (entry as { event?: string }).event === "job_finished") as {
    fields: { outcome: string; code: string; jobId: string; historyOutcome: string | null };
  };
  assert.equal(finished.fields.outcome, "failed");
  assert.equal(finished.fields.code, "provider_uncertain");
  assert.equal(finished.fields.jobId, NEWER);
  assert.equal(finished.fields.historyOutcome, null);
  assert.equal(row(db, NEWER).historyState, "pending");
  assert.equal(row(db, NEWER).outputSha256, null);
});

test("a provider-contacted job is not sent to the provider again", async () => {
  const db = pair();
  const first = await runOnce(db, NEWER, async () => {
    throw new Error("provider down");
  });
  assert.equal(first.providerCalls, 1);
  assert.equal(first.exitCode, 1);
  const second = await runOnce(db, NEWER, async () => {
    throw new Error("provider down");
  });
  assert.equal(second.providerCalls, 0);
  assert.equal(second.exitCode, 1);
  assert.equal(status(db, NEWER), "failed");
  assert.equal(status(db, OLDER), "queued");

  const reopened = pair();
  const claimed = claimNextHarmonizeJob(reopened, 5, NEWER);
  if (!claimed) throw new Error("expected the newer claim");
  const job = row(reopened, NEWER);
  job.status = "queued";
  job.providerStartedAtMs = 5;
  job.claimNonce = null;
  job.claimExpiresAtMs = null;
  let calls = 0;
  const result = await executeHarmonizeClaim({
    api: workerApi(reopened, NEWER),
    provider: async () => {
      calls += 1;
      throw new Error("provider down");
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(calls, 0);
  assert.equal(result.outcome, "failed");
  assert.equal(result.code, "already_contacted");
  assert.equal(status(reopened, NEWER), "failed");
  assert.equal(status(reopened, OLDER), "queued");
});

test("a stop signal during the one job does not execute it again", async () => {
  const db = pair();
  let stop = false;
  let executes = 0;
  const code = await runHarmonizeWorker({
    selection: { mode: "once", jobId: NEWER },
    execute: async () => {
      executes += 1;
      stop = true;
      return executeHarmonizeClaim({
        api: workerApi(db, NEWER),
        provider: async () => {
          throw new Error("provider down");
        },
        heartbeatIntervalMs: 60_000,
      });
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: async () => {
      throw new Error("single-job mode slept");
    },
    log: () => undefined,
  });
  assert.equal(executes, 1);
  assert.equal(code, 1);
  assert.equal(status(db, OLDER), "queued");
});

test("a stop signal before the single job exits without a claim", async () => {
  let executes = 0;
  const logs: Array<{ event: string; fields: Record<string, string | number | null> }> = [];
  const code = await runHarmonizeWorker({
    selection: { mode: "once", jobId: NEWER },
    execute: async () => {
      executes += 1;
      throw new Error("should not run");
    },
    pollIntervalMs: 2000,
    shouldStop: () => true,
    sleep: async () => {
      throw new Error("single-job mode slept");
    },
    log: (event, fields) => {
      logs.push({ event, fields });
    },
  });
  assert.equal(executes, 0);
  assert.equal(code, 1);
  assert.equal(logs[0]?.event, "job_finished");
  assert.equal(logs[0]?.fields.outcome, "cancelled");
  assert.equal(logs[0]?.fields.code, "cancelled");
  assert.equal(logs[0]?.fields.jobId, NEWER);
});

test("a stale once-mode result exits nonzero and does not continue", async () => {
  let executes = 0;
  const logs: Array<{ event: string; fields: Record<string, string | number | null> }> = [];
  const code = await runHarmonizeWorker({
    selection: { mode: "once", jobId: NEWER },
    execute: async () => {
      executes += 1;
      return { outcome: "stale" as const, code: "stale_claim", jobId: NEWER };
    },
    pollIntervalMs: 2000,
    shouldStop: () => false,
    sleep: async () => {
      throw new Error("single-job mode slept");
    },
    log: (event, fields) => {
      logs.push({ event, fields });
    },
  });
  assert.equal(executes, 1);
  assert.equal(code, 1);
  assert.equal(logs[0]?.fields.outcome, "stale");
  assert.equal(logs[0]?.fields.code, "stale_claim");
  assert.equal(logs[0]?.fields.jobId, NEWER);
});

test("continuous mode still polls the next queued job", async () => {
  const db = pair();
  let executes = 0;
  let sleeps = 0;
  const seen: string[] = [];
  const code = await runHarmonizeWorker({
    selection: { mode: "continuous" },
    execute: async () => {
      executes += 1;
      const result = await executeHarmonizeClaim({
        api: workerApi(db, null),
        provider: async () => {
          throw new Error("provider down");
        },
        heartbeatIntervalMs: 60_000,
      });
      if (result.jobId) seen.push(result.jobId);
      return result;
    },
    pollIntervalMs: 2000,
    shouldStop: () => executes >= 2,
    sleep: async () => {
      sleeps += 1;
    },
    log: () => undefined,
  });
  assert.equal(code, 0);
  assert.equal(executes, 2);
  assert.equal(sleeps, 1);
  assert.deepEqual(seen, [OLDER, NEWER]);
});

test("a rejected interval heartbeat cannot terminate the process or call the provider twice", async () => {
  const db = pair();
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandled);
  let providerCalls = 0;
  let beats = 0;
  let failNextBeat = false;
  try {
    const result = await executeHarmonizeClaim({
      api: {
        ...workerApi(db, NEWER),
        async heartbeat() {
          beats += 1;
          if (failNextBeat) {
            failNextBeat = false;
            throw new Error("heartbeat transport failed");
          }
          return true;
        },
      },
      provider: async (input) => {
        providerCalls += 1;
        failNextBeat = true;
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (input.signal.aborted) throw new Error("heartbeat transport aborted the provider");
        return createHarmonizeFakeProvider()(input);
      },
      heartbeatIntervalMs: 15,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(beats > 1);
    assert.equal(unhandled.length, 0);
    assert.equal(providerCalls, 1);
    assert.equal(result.outcome, "succeeded");
    assert.equal(status(db, NEWER), "succeeded");
    assert.equal(status(db, OLDER), "queued");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("the exact claim request names one job and rejects a substituted job", async () => {
  const env = {
    appBaseUrl: "http://127.0.0.1:3000",
    workerSecret: "local-test-secret",
    pollIntervalMs: 2000,
  };
  const urls: string[] = [];
  const exact = createHttpHarmonizeWorkerApi(env, {
    jobId: NEWER,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json({ ok: true, job: null });
    },
  });
  assert.equal(await exact.claim(), null);
  assert.equal(urls.length, 1);
  assert.match(urls[0] ?? "", /action=claim-exact/);
  assert.match(urls[0] ?? "", new RegExp(`jobId=${NEWER}`));
  assert.doesNotMatch(urls[0] ?? "", /11111111/);

  const open = createHttpHarmonizeWorkerApi(env, {
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json({ ok: true, job: null });
    },
  });
  assert.equal(await open.claim(), null);
  assert.match(urls[1] ?? "", /action=claim$/);

  const substituted = createHttpHarmonizeWorkerApi(env, {
    jobId: NEWER,
    fetchImpl: async () => Response.json({
      ok: true,
      job: {
        jobId: OLDER,
        roomId: ROOM_A,
        claimNonce: "99999999-9999-4999-8999-999999999999",
        prompt: PROMPT,
        promptSha256: "ab".repeat(32),
        compositeSha256: "cd".repeat(32),
        compositeWidth: 1200,
        compositeHeight: 896,
        requestedModelId: "gemini-3-pro-image",
      },
    }),
  });
  await assert.rejects(() => substituted.claim(), /claim_mismatch/);
  assert.throws(() => createHttpHarmonizeWorkerApi(env, { jobId: "not-a-uuid" }), /claim_job_invalid/);
});

test("single-job mode keeps fake-provider refusal and does not read a local env file", () => {
  const worker = readFileSync(path.join(process.cwd(), "harmonize-worker/src/index.ts"), "utf8");
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql"), "utf8");
  const route = readFileSync(path.join(process.cwd(), "app/api/internal/vibode-harmonize-jobs/route.ts"), "utf8");
  const server = readFileSync(path.join(process.cwd(), "lib/vibode-stage/harmonize-jobs/jobs.server.ts"), "utf8");
  const main = worker.slice(worker.indexOf("async function main"));
  const modeAt = main.indexOf("readHarmonizeWorkerProviderMode");
  assert.ok(modeAt > 0);
  assert.ok(modeAt < main.indexOf("createHarmonizeFakeProvider("));
  assert.ok(modeAt < main.indexOf("createHarmonizeNbpProvider("));
  assert.doesNotMatch(worker, /dotenv|\.env\.local/);
  assert.match(worker, /mode: "once"/);
  assert.match(sql, /where id = p_job_id/);
  assert.match(sql, /for update skip locked/);
  assert.doesNotMatch(sql, /claim_next_vibode_harmonize_generation\(\)/);
  assert.doesNotMatch(sql, /order by created_at/);
  assert.doesNotMatch(sql, /alter table public\.vibode_3d|alter table public\.vibode_afc|alter table public\.vibode_room_assets/);
  assert.match(route, /action === "claim-exact"/);
  assert.match(route, /claimResponse\(null\)/);
  assert.match(route, /claimResponse\(requested\.toLowerCase\(\)\)/);
  assert.match(server, /p_job_id: jobId/);
  assert.match(server, /jobId === null \? \{\} : \{ p_job_id: jobId \}/);
  const production = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "fake",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
    NODE_ENV: "production",
  });
  assert.equal(production.ok, false);
});

async function runOnce(
  db: HarmonizeJobDatabase,
  jobId: string,
  provider?: () => Promise<never>,
): Promise<{ providerCalls: number; executeCalls: number; exitCode: number; sleeps: number; logs: unknown[] }> {
  let providerCalls = 0;
  let executeCalls = 0;
  let sleeps = 0;
  const logs: unknown[] = [];
  const fake = createHarmonizeFakeProvider();
  const exitCode = await runHarmonizeWorker({
    selection: { mode: "once", jobId },
    execute: async () => {
      executeCalls += 1;
      return executeHarmonizeClaim({
        api: workerApi(db, jobId),
        provider: async (input) => {
          providerCalls += 1;
          if (provider) return provider();
          return fake(input);
        },
        heartbeatIntervalMs: 60_000,
      });
    },
    pollIntervalMs: 2000,
    shouldStop: () => false,
    sleep: async () => {
      sleeps += 1;
    },
    log: (event, fields) => {
      logs.push({ event, fields });
    },
  });
  return { providerCalls, executeCalls, exitCode, sleeps, logs };
}

function workerApi(db: HarmonizeJobDatabase, jobId: string | null) {
  const composites = new Map(db.jobs.map((job) => [job.id, pngHeader(1200, 896)]));
  return createMemoryHarmonizeWorkerApi({
    db,
    composites,
    outputs: new Map(),
    clock: { nowMs: 5 },
    jobId,
  });
}

function pair(): HarmonizeJobDatabase {
  const db = createHarmonizeJobDatabase();
  const bytes = pngHeader(1200, 896);
  const older = enqueueHarmonizeJob(db, insert(USER_A, ROOM_A, "older", PROMPT, bytes), 0, OLDER);
  const newer = enqueueHarmonizeJob(db, insert(USER_B, ROOM_B, "newer", PROMPT, bytes), 1, NEWER);
  if (!older.ok || !newer.ok) throw new Error("enqueue failed");
  return db;
}

function insert(
  userId: string,
  roomId: string,
  idempotencyKey: string,
  prompt: string,
  composite: Uint8Array,
): HarmonizeJobInsert {
  const digest = sha(composite);
  const promptSha = sha(prompt);
  const zero = { x: 0, y: 0, z: 0 };
  return {
    userId,
    roomId,
    sourceVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    idempotencyKey,
    requestSha256: digest,
    sceneSnapshotSha256: digest,
    backgroundSha256: digest,
    compositeSha256: digest,
    promptSha256: promptSha,
    promptVersion: "harmonize-universal-prompt/2.0",
    assemblyVersion: "harmonize-prompt-assembly/1",
    afcGenerationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    compositePath: `rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png`,
    compositeByteLength: composite.byteLength,
    compositeWidth: 1200,
    compositeHeight: 896,
    roomUserId: userId,
    sourceUserId: userId,
    sourceRoomId: roomId,
    backdropKind: "room_asset",
    sceneObjects: [],
    snapshot: {
      generationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      roomScaleMultiplier: 1,
      certifiedMetricScale: 1,
      effectiveMetricScale: 1,
      camera: {
        projection: "frozen-production-perspective",
        verticalFovDeg: 50,
        aspect: 4 / 3,
        near: 0.1,
        far: 100,
        frame: { width: 2048, height: 1536 },
        pose: { position: zero, lookAt: zero, up: { x: 0, y: 1, z: 0 } },
      },
      objects: [],
      unmountedObjectIds: [],
      uniformScales: [],
      materials: [],
      prompt,
      backgroundSha256: digest,
      compositeSha256: digest,
      sourceVersionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      sceneSnapshotSha256: digest,
    },
  };
}

function row(db: HarmonizeJobDatabase, jobId: string): HarmonizeJobRow {
  const job = db.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new Error(`missing ${jobId}`);
  return job;
}

function status(db: HarmonizeJobDatabase, jobId: string): string {
  return row(db, jobId).status;
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function sha(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
