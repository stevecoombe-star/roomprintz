import assert from "node:assert/strict";
import test from "node:test";

import { TEST_CUBE_PLACEMENT_LOCAL_AABB as labAabb } from "@/app/admin/3d-room-lab-v2/room-collision-footprint";
import { resolveSceneObjectCollision as labResolve } from "@/app/admin/3d-room-lab-v2/scene-collision-resolver";
import { DEFAULT_WORLD_TRANSFORM as labDefault } from "@/app/admin/3d-room-lab-v2/scene-layer-state";

import { TEST_CUBE_PLACEMENT_LOCAL_AABB } from "./collision-footprint";
import { resolveSceneObjectCollision } from "./collision-resolver";
import { PI3A_RIGHT_WALL } from "./pi3a-test-fixture";
import { DEFAULT_WORLD_TRANSFORM } from "./types";

function transformAt(x: number, z = 0, y = 0) {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y, z },
  };
}

test("production cube AABB matches certified Lab cube AABB", () => {
  assert.deepEqual(TEST_CUBE_PLACEMENT_LOCAL_AABB, labAabb);
});

test("clear translation is accepted", () => {
  const current = transformAt(0);
  const proposed = transformAt(0.2);
  const production = resolveSceneObjectCollision({
    current,
    proposed,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  const lab = labResolve({
    current,
    proposed,
    localAabb: labAabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  assert.equal(production.status, "accepted");
  assert.deepEqual(production, lab);
  assert.equal(production.transform.position.x, 0.2);
});

test("wall impact stops at the cube face, not the center", () => {
  const current = transformAt(0);
  const proposed = transformAt(4);
  const production = resolveSceneObjectCollision({
    current,
    proposed,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  const lab = labResolve({
    current,
    proposed,
    localAabb: labAabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  assert.deepEqual(production, lab);
  assert.ok(Math.abs(production.transform.position.x - 0.5) < 1e-6);
  assert.equal(production.transform.position.y, 0);
});

test("slide along a wall matches Lab", () => {
  const current = transformAt(0, -1);
  const proposed = transformAt(4, 1);
  const production = resolveSceneObjectCollision({
    current,
    proposed,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  const lab = labResolve({
    current,
    proposed,
    localAabb: labAabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  assert.deepEqual(production, lab);
  assert.ok(production.transform.position.x < proposed.position.x);
  assert.ok(production.transform.position.z !== current.position.z);
});

test("large jump does not tunnel through the wall", () => {
  const current = transformAt(0);
  const proposed = transformAt(40);
  const production = resolveSceneObjectCollision({
    current,
    proposed,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  const lab = labResolve({
    current,
    proposed,
    localAabb: labAabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "move",
  });
  assert.deepEqual(production, lab);
  assert.ok(production.transform.position.x < 1);
  assert.ok(Math.abs(production.transform.position.x - 0.5) < 1e-6);
});

test("rotation is accepted when clear and rejected when penetrating", () => {
  const accepted = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      rotationDeg: { x: 0, y: 20, z: 0 },
    },
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: [PI3A_RIGHT_WALL],
    mode: "pose",
  });
  const labAccepted = labResolve({
    current: transformAt(0),
    proposed: {
      ...labDefault,
      rotationDeg: { x: 0, y: 20, z: 0 },
    },
    localAabb: labAabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "pose",
  });
  assert.deepEqual(accepted, labAccepted);
  assert.equal(accepted.status, "accepted");

  const flush = transformAt(0.5);
  const rejected = resolveSceneObjectCollision({
    current: flush,
    proposed: {
      ...flush,
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: [PI3A_RIGHT_WALL],
    mode: "pose",
  });
  const labRejected = labResolve({
    current: flush,
    proposed: {
      ...flush,
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
    localAabb: labAabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "pose",
  });
  assert.deepEqual(rejected, labRejected);
  assert.equal(rejected.status, "rejected_pose");
  assert.equal(rejected.transform.position.x, 0.5);
  assert.equal(rejected.transform.rotationDeg.y, 0);
});
