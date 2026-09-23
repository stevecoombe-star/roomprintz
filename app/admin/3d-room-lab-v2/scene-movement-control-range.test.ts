import assert from "node:assert/strict";
import test from "node:test";

import {
  MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M,
  MOVEMENT_CONTROL_RANGE_MARGIN_M,
  MOVEMENT_CONTROL_RANGE_MAX_ABS_M,
  MOVEMENT_CONTROL_RANGE_MIN_SPAN_M,
  MOVEMENT_CONTROL_RANGE_STEP_M,
  deriveSceneMovementControlRange,
} from "./scene-movement-control-range";

const typicalFloor = {
  worldWidthM: 6,
  referenceDepthM: 4,
};

test("X and Z control ranges derive independently", () => {
  const range = deriveSceneMovementControlRange({
    floor: typicalFloor,
    collisionWalls: [
      { a: { x: 10, z: 0 }, b: { x: 10, z: 1 } },
    ],
  });
  assert.ok(range.positionX.max > range.positionZ.max);
  assert.ok(range.positionX.min < 0);
  assert.equal(range.positionX.step, MOVEMENT_CONTROL_RANGE_STEP_M);
  assert.equal(range.positionZ.step, MOVEMENT_CONTROL_RANGE_STEP_M);
});

test("Floor rectangle extent contributes to the control range", () => {
  const range = deriveSceneMovementControlRange({
    floor: typicalFloor,
    collisionWalls: [],
  });
  assert.ok(range.positionX.min <= -typicalFloor.worldWidthM / 2);
  assert.ok(range.positionX.max >= typicalFloor.worldWidthM / 2);
  assert.ok(range.positionZ.min <= -typicalFloor.referenceDepthM / 2);
  assert.ok(range.positionZ.max >= typicalFloor.referenceDepthM / 2);
});

test("active collision walls can expand the range beyond Floor extent", () => {
  const floorOnly = deriveSceneMovementControlRange({
    floor: typicalFloor,
    collisionWalls: [],
  });
  const withWall = deriveSceneMovementControlRange({
    floor: typicalFloor,
    collisionWalls: [
      { a: { x: 4, z: -14 }, b: { x: -4, z: -14 } },
    ],
  });
  assert.ok(withWall.positionZ.min < floorOnly.positionZ.min);
  assert.ok(withWall.positionZ.min <= -14 - MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.ok(withWall.positionZ.min < -10);
});

test("derived ranges include a margin beyond the union extent", () => {
  const range = deriveSceneMovementControlRange({
    floor: { worldWidthM: 20, referenceDepthM: 20 },
    collisionWalls: [],
  });
  assert.equal(range.positionX.min, -10 - MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.equal(range.positionX.max, 10 + MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.equal(range.positionZ.min, -10 - MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.equal(range.positionZ.max, 10 + MOVEMENT_CONTROL_RANGE_MARGIN_M);
});

test("small-room bounds receive the minimum practical span", () => {
  const range = deriveSceneMovementControlRange({
    floor: { worldWidthM: 1, referenceDepthM: 1 },
    collisionWalls: [],
  });
  assert.ok(
    range.positionX.max - range.positionX.min >= MOVEMENT_CONTROL_RANGE_MIN_SPAN_M,
  );
  assert.ok(
    range.positionZ.max - range.positionZ.min >= MOVEMENT_CONTROL_RANGE_MIN_SPAN_M,
  );
  assert.equal(
    range.positionX.max - range.positionX.min,
    MOVEMENT_CONTROL_RANGE_MIN_SPAN_M,
  );
});

test("missing or invalid room geometry uses the fallback range", () => {
  const missing = deriveSceneMovementControlRange({
    floor: null,
    collisionWalls: [],
  });
  const invalid = deriveSceneMovementControlRange({
    floor: { worldWidthM: Number.NaN, referenceDepthM: -4 },
    collisionWalls: [
      {
        a: { x: Number.NaN, z: Number.POSITIVE_INFINITY },
        b: { x: Number.NaN, z: Number.NaN },
      },
    ],
  });
  for (const range of [missing, invalid]) {
    assert.equal(range.positionX.min, -MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M);
    assert.equal(range.positionX.max, MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M);
    assert.equal(range.positionZ.min, -MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M);
    assert.equal(range.positionZ.max, MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M);
  }
});

test("absurdly large geometry is capped for UI usability", () => {
  const range = deriveSceneMovementControlRange({
    floor: { worldWidthM: 400, referenceDepthM: 400 },
    collisionWalls: [
      { a: { x: 10_000, z: -8_000 }, b: { x: 9_000, z: -7_000 } },
    ],
  });
  assert.equal(range.positionX.min, -MOVEMENT_CONTROL_RANGE_MAX_ABS_M);
  assert.equal(range.positionX.max, MOVEMENT_CONTROL_RANGE_MAX_ABS_M);
  assert.equal(range.positionZ.min, -MOVEMENT_CONTROL_RANGE_MAX_ABS_M);
  assert.equal(range.positionZ.max, MOVEMENT_CONTROL_RANGE_MAX_ABS_M);
});

test("range derivation does not inspect object kind", () => {
  const cubeRange = deriveSceneMovementControlRange({
    floor: typicalFloor,
    collisionWalls: [{ a: { x: 2, z: -3 }, b: { x: -2, z: -3 } }],
  });
  const glbRange = deriveSceneMovementControlRange({
    floor: typicalFloor,
    collisionWalls: [{ a: { x: 2, z: -3 }, b: { x: -2, z: -3 } }],
  });
  assert.deepEqual(cubeRange, glbRange);
});
