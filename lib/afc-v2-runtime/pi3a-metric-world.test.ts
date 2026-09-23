import assert from "node:assert/strict";
import test from "node:test";

import {
  realizeCameraPose as labRealizeCameraPose,
  realizeCollisionWalls as labRealizeCollisionWalls,
  realizeFloorRectangle as labRealizeFloorRectangle,
} from "@/app/admin/3d-room-lab-v2/scene-metric-world-realization";

import {
  realizeCameraPose,
  realizeCollisionWalls,
  realizeFloorRectangle,
} from "./metric-world-realization";
import { createPi3aAuthority, PI3A_RIGHT_WALL } from "./pi3a-test-fixture";
import { realizeProductionWorld } from "./production-world";
import { persistedMetricScale } from "./runtime-authority";

test("production metric realization matches Lab v2 for the same Floor/Camera/collision and S", () => {
  const S = 1.7;
  const floor = { worldWidthM: 6, referenceDepthM: 4 };
  const pose = {
    position: { x: 1.25, y: 2.5, z: 3.75 },
    lookAt: { x: 0.25, y: 0.5, z: -0.75 },
    up: { x: 0, y: 1, z: 0 },
  };
  const authority = createPi3aAuthority({
    metricScale: S,
    floor,
    pose,
    walls: [PI3A_RIGHT_WALL],
  });
  assert.equal(persistedMetricScale(authority), S);
  const world = realizeProductionWorld(authority);
  assert.equal(world.metricScale, S);
  assert.deepEqual(
    realizeFloorRectangle(floor, S),
    labRealizeFloorRectangle(floor, S),
  );
  assert.deepEqual(world.floor, labRealizeFloorRectangle(floor, S));
  assert.deepEqual(
    realizeCameraPose(pose, S),
    labRealizeCameraPose(pose, S),
  );
  assert.deepEqual(
    realizeCollisionWalls([PI3A_RIGHT_WALL], S),
    labRealizeCollisionWalls([PI3A_RIGHT_WALL], S),
  );
});

test("metricScale 1 is identity and is not multiplied by a second scalar", () => {
  const authority = createPi3aAuthority({ metricScale: 1 });
  const world = realizeProductionWorld(authority);
  assert.equal(world.metricScale, 1);
  assert.equal(world.floor.worldWidthM, authority.floor.worldWidthM);
  assert.equal(world.camera.pose.position.x, authority.frozenCamera.pose.position.x);
  assert.deepEqual(world.collisionWalls[0], PI3A_RIGHT_WALL);
});
