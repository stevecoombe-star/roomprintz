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

test("startup keeps fake mode when a key exists and fails closed for real mode", () => {
  const key = "msy_test_secret_value";
  const credential = evaluateFurnitureGenerationWorkerStartup({
    MESHY_API_KEY: key,
    VIBODE_FURNITURE_GENERATION_PROVIDER: "fake",
  }, []);
  assert.equal(credential.ok, true);
  if (credential.ok) assert.equal(credential.mode, "fake");
  assert.equal(JSON.stringify(credential).includes(key), false);
  const incomplete = evaluateFurnitureGenerationWorkerStartup({
    MESHY_API_KEY: key,
    VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
  }, []);
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.equal(incomplete.missing, "generation_disabled");
  const missingKey = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
    VIBODE_MESHY_GENERATION_ENABLED: "true",
  }, []);
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.equal(missingKey.missing, "meshy_credential_missing");
  const enabled = evaluateFurnitureGenerationWorkerStartup({
    MESHY_API_KEY: key,
    VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
    VIBODE_MESHY_GENERATION_ENABLED: "true",
  }, ["--once"]);
  assert.equal(enabled.ok, true);
  if (enabled.ok) {
    assert.equal(enabled.mode, "meshy");
    assert.equal(enabled.processingEnabled, false);
    assert.equal(enabled.once, true);
  }
  assert.equal(JSON.stringify(enabled).includes(key), false);
  const fake = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_PROVIDER: "fake",
  }, ["--once"]);
  assert.equal(fake.ok, true);
  if (fake.ok) {
    assert.equal(fake.mode, "fake");
    assert.equal(fake.processingEnabled, false);
    assert.equal(fake.cleanupEnabled, false);
    assert.equal(fake.once, true);
  }
  const cleanupOnly = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_PROVIDER: "fake",
    VIBODE_FURNITURE_GENERATION_CLEANUP_ENABLED: "true",
  }, ["--once"]);
  assert.equal(cleanupOnly.ok, true);
  if (cleanupOnly.ok) {
    assert.equal(cleanupOnly.mode, "fake");
    assert.equal(cleanupOnly.processingEnabled, false);
    assert.equal(cleanupOnly.cleanupEnabled, true);
  }
  const explicitOff = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_CLEANUP_ENABLED: "false",
  }, []);
  assert.equal(explicitOff.ok, true);
  if (explicitOff.ok) assert.equal(explicitOff.cleanupEnabled, false);
  for (const value of ["TRUE", "1", "yes", "on"]) {
    const invalid = evaluateFurnitureGenerationWorkerStartup({
      VIBODE_FURNITURE_GENERATION_CLEANUP_ENABLED: value,
    }, []);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.missing, "cleanup_flag");
  }
  const stillStrict = evaluateFurnitureGenerationWorkerStartup({
    VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
    VIBODE_FURNITURE_GENERATION_CLEANUP_ENABLED: "true",
  }, []);
  assert.equal(stillStrict.ok, false);
  if (!stillStrict.ok) assert.equal(stillStrict.missing, "generation_disabled");
});
