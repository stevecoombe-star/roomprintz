import assert from "node:assert/strict";
import test from "node:test";

import { createPi3aCubeObjectFromAuthority } from "./cube-runtime";
import {
  createPi3aAuthority,
  PI3A_GENERATION_A,
  PI3A_GENERATION_B,
  PI3A_ROOM_ID,
} from "./pi3a-test-fixture";
import { realizeProductionWorld } from "./production-world";
import { DEFAULT_WORLD_TRANSFORM } from "./types";

test("generation replacement rebuilds Camera/Floor/collision and does not migrate cube transforms", () => {
  const generationA = createPi3aAuthority({
    generationId: PI3A_GENERATION_A,
    metricScale: 1,
    verticalFovDeg: 50,
    pose: {
      position: { x: 0, y: 1.5, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
  });
  const generationB = createPi3aAuthority({
    generationId: PI3A_GENERATION_B,
    metricScale: 2,
    verticalFovDeg: 40,
    pose: {
      position: { x: 2, y: 2, z: 6 },
      lookAt: { x: 0.5, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    floor: { worldWidthM: 8, referenceDepthM: 5 },
  });

  const worldA = realizeProductionWorld(generationA);
  const worldB = realizeProductionWorld(generationB);
  assert.equal(worldA.generationId, PI3A_GENERATION_A);
  assert.equal(worldB.generationId, PI3A_GENERATION_B);
  assert.notEqual(worldA.camera.verticalFovDeg, worldB.camera.verticalFovDeg);
  assert.notEqual(worldA.camera.pose.position.x, worldB.camera.pose.position.x);
  assert.notEqual(worldA.floor.worldWidthM, worldB.floor.worldWidthM);
  assert.notEqual(worldA.metricScale, worldB.metricScale);

  const cubeA = createPi3aCubeObjectFromAuthority(PI3A_ROOM_ID, generationA);
  const movedA = {
    ...cubeA,
    transform: {
      ...cubeA.transform,
      position: { x: 0.4, y: 0, z: -0.2 },
    },
  };
  const cubeB = createPi3aCubeObjectFromAuthority(PI3A_ROOM_ID, generationB);
  assert.equal(cubeB.generationId, PI3A_GENERATION_B);
  assert.deepEqual(cubeB.transform, DEFAULT_WORLD_TRANSFORM);
  assert.notDeepEqual(cubeB.transform.position, movedA.transform.position);
});
