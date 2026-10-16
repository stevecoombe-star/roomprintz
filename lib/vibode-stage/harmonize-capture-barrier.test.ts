import assert from "node:assert/strict";
import test from "node:test";

import { createSceneSaveGate } from "@/lib/afc-v2-runtime/scene-save-gate";

import { runHarmonizeCaptureBoundary } from "./harmonize-capture-boundary";
import { createRoomScalePersistence } from "./room-scale-persistence";

test("scene flush waits for an in-flight save and a newer edit", async () => {
  const saves: string[] = [];
  let releaseFirst: (ok: boolean) => void = () => undefined;
  const gate = createSceneSaveGate<string>(async (job) => {
    saves.push(job.value);
    if (job.value === "first") {
      return new Promise<boolean>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return job.value !== "failed";
  });
  const first = gate.submit("first");
  const flushing = gate.flush();
  gate.submit("second");
  releaseFirst(true);
  assert.equal(await first, true);
  assert.equal(await flushing, true);
  assert.deepEqual(saves, ["first", "second"]);
});

test("a failed scene save fails the flush and keeps the newer edit behind it", async () => {
  const saves: string[] = [];
  const gate = createSceneSaveGate<string>(async (job) => {
    saves.push(job.value);
    return job.value === "kept";
  });
  const failed = gate.submit("failed");
  gate.submit("kept");
  assert.equal(await failed, true);
  assert.equal(await gate.flush(), true);
  assert.deepEqual(saves, ["failed", "kept"]);

  const failing = createSceneSaveGate<string>(async () => false);
  failing.submit("edit");
  assert.equal(await failing.flush(), false);
});

test("room scale debounce collapses edits and an older put cannot finish last", async () => {
  const calls: number[] = [];
  const resolvers: Array<(ok: boolean) => void> = [];
  const scheduled: Array<() => void> = [];
  const writer = createRoomScalePersistence({
    delayMs: 200,
    persist: (write) => new Promise<boolean>((resolve) => {
      calls.push(write.multiplier);
      resolvers.push(resolve);
    }),
    schedule: (run) => {
      scheduled.push(run);
      return () => {
        const index = scheduled.indexOf(run);
        if (index >= 0) scheduled.splice(index, 1);
      };
    },
  });
  writer.queue({ roomId: "room", multiplier: 1.1 });
  writer.queue({ roomId: "room", multiplier: 1.25 });
  assert.deepEqual(calls, []);
  const fire = scheduled.at(-1);
  if (!fire) throw new Error("expected a debounced room-scale write");
  fire();
  await Promise.resolve();
  assert.deepEqual(calls, [1.25]);
  const barrier = writer.flush();
  writer.queue({ roomId: "room", multiplier: 1.5 });
  resolvers[0]?.(true);
  await Promise.resolve();
  assert.deepEqual(calls, [1.25, 1.5]);
  resolvers[1]?.(true);
  assert.equal(await barrier, true);
  assert.equal(await writer.flush(), true);
  assert.deepEqual(calls, [1.25, 1.5]);
});

test("a room scale failure is reported and does not acknowledge the unsaved value", async () => {
  const calls: number[] = [];
  const writer = createRoomScalePersistence({
    delayMs: 200,
    persist: async (write) => {
      calls.push(write.multiplier);
      return false;
    },
    schedule: () => () => undefined,
  });
  writer.queue({ roomId: "room", multiplier: 0.8 });
  assert.equal(await writer.flush(), false);
  assert.deepEqual(calls, [0.8]);
});

test("an active drag, a failed save, and a version change do not capture or enqueue", async () => {
  let captures = 0;
  let sceneFlushes = 0;
  let scaleFlushes = 0;
  const blocked = await runHarmonizeCaptureBoundary({
    furnitureGestureActive: () => true,
    sourceVersionId: () => "version-a",
    sceneIdentity: () => "scene-a",
    flushScene: async () => {
      sceneFlushes += 1;
      return true;
    },
    flushRoomScale: async () => {
      scaleFlushes += 1;
      return true;
    },
    capture: async () => {
      captures += 1;
      return "package";
    },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, "gesture_active");
  assert.equal(captures, 0);
  assert.equal(sceneFlushes, 0);
  assert.equal(scaleFlushes, 0);

  const failedSave = await runHarmonizeCaptureBoundary({
    furnitureGestureActive: () => false,
    sourceVersionId: () => "version-a",
    sceneIdentity: () => "scene-a",
    flushScene: async () => false,
    flushRoomScale: async () => {
      scaleFlushes += 1;
      return true;
    },
    capture: async () => {
      captures += 1;
      return "package";
    },
  });
  assert.equal(failedSave.ok, false);
  if (!failedSave.ok) assert.equal(failedSave.code, "scene_save_failed");
  assert.equal(captures, 0);
  assert.equal(scaleFlushes, 0);

  let version = "version-a";
  const changed = await runHarmonizeCaptureBoundary({
    furnitureGestureActive: () => false,
    sourceVersionId: () => version,
    sceneIdentity: () => "scene-a",
    flushScene: async () => {
      version = "version-b";
      return true;
    },
    flushRoomScale: async () => true,
    capture: async () => {
      captures += 1;
      return "package";
    },
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.code, "capture_stale");
  assert.equal(captures, 0);

  let submits = 0;
  const prepared = await runHarmonizeCaptureBoundary({
    furnitureGestureActive: () => false,
    sourceVersionId: () => "version-a",
    sceneIdentity: () => "scene-a",
    flushScene: async () => true,
    flushRoomScale: async () => true,
    capture: async () => {
      captures += 1;
      return { composite: true };
    },
  });
  if (prepared.ok) submits += 1;
  assert.equal(prepared.ok, true);
  assert.equal(captures, 1);
  assert.equal(submits, 1);
});

test("a scene edit during room-scale persistence is saved before capture", async () => {
  let captures = 0;
  let sceneFlushes = 0;
  let editedDuringScale = false;
  const result = await runHarmonizeCaptureBoundary({
    furnitureGestureActive: () => false,
    sourceVersionId: () => "version-a",
    sceneIdentity: () => "scene-a",
    flushScene: async () => {
      sceneFlushes += 1;
      if (sceneFlushes === 2) assert.equal(editedDuringScale, true);
      return true;
    },
    flushRoomScale: async () => {
      editedDuringScale = true;
      return true;
    },
    capture: async () => {
      captures += 1;
      assert.equal(sceneFlushes, 2);
      return "package";
    },
  });
  assert.equal(result.ok, true);
  assert.equal(captures, 1);
  assert.equal(sceneFlushes, 2);
});

test("a gesture that starts during preparation aborts before capture", async () => {
  let captures = 0;
  let dragging = false;
  const result = await runHarmonizeCaptureBoundary({
    furnitureGestureActive: () => dragging,
    sourceVersionId: () => "version-a",
    sceneIdentity: () => "scene-a",
    flushScene: async () => true,
    flushRoomScale: async () => {
      dragging = true;
      return true;
    },
    capture: async () => {
      captures += 1;
      return "package";
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "capture_stale");
  assert.equal(captures, 0);
});

test("a capture that fails after the saves is not returned for enqueue", async () => {
  let flushes = 0;
  await assert.rejects(
    () => runHarmonizeCaptureBoundary({
      furnitureGestureActive: () => false,
      sourceVersionId: () => "version-a",
      sceneIdentity: () => "scene-a",
      flushScene: async () => {
        flushes += 1;
        return true;
      },
      flushRoomScale: async () => true,
      capture: async () => {
        throw new Error("disposed");
      },
    }),
    /disposed/,
  );
  assert.equal(flushes, 2);
});
