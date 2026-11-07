/**
 * Worker loop and startup. These tests do not start a process or call Meshy.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { runFurnitureGenerationWorker } from "./run";
import { evaluateFurnitureGenerationWorkerStartup } from "./startup";

test("a disabled worker does not execute a pass", async () => {
  let calls = 0;
  const code = await runFurnitureGenerationWorker({
    enabled: () => false,
    once: true,
    execute: async () => {
      calls += 1;
      return { action: "idle", jobId: null };
    },
    pollIntervalMs: 1_000,
    shouldStop: () => false,
    sleep: async () => undefined,
    log: () => undefined,
  });
  assert.equal(code, 1);
  assert.equal(calls, 0);
});

test("once mode runs a single pass", async () => {
  let calls = 0;
  const code = await runFurnitureGenerationWorker({
    enabled: () => true,
    once: true,
    execute: async () => {
      calls += 1;
      return { action: "idle", jobId: null };
    },
    pollIntervalMs: 1_000,
    shouldStop: () => false,
    sleep: async () => undefined,
    log: () => undefined,
  });
  assert.equal(code, 0);
  assert.equal(calls, 1);
});

test("continuous mode does not overlap passes", async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const code = await runFurnitureGenerationWorker({
    enabled: () => true,
    once: false,
    execute: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls += 1;
      active -= 1;
      return { action: "idle", jobId: null };
    },
    pollIntervalMs: 1,
    shouldStop: () => calls >= 2,
    sleep: async () => undefined,
    log: () => undefined,
  });
  assert.equal(code, 0);
  assert.equal(maxActive, 1);
  assert.equal(calls, 2);
});

test("startup refuses Meshy credentials and a live provider", () => {
  const credential = evaluateFurnitureGenerationWorkerStartup({
    MESHY_API_KEY: "present",
    VIBODE_FURNITURE_GENERATION_PROVIDER: "fake",
  }, []);
  assert.equal(credential.ok, false);
  const live = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
  }, []);
  assert.equal(live.ok, false);
  const fake = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_PROVIDER: "fake",
  }, ["--once"]);
  assert.equal(fake.ok, true);
  if (fake.ok) {
    assert.equal(fake.processingEnabled, false);
    assert.equal(fake.once, true);
  }
});
