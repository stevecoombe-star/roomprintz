import assert from "node:assert/strict";
import test from "node:test";

import { TEST_CUBE_PLACEMENT_LOCAL_AABB } from "./collision-footprint";
import { createPi3aCubeObjectFromAuthority } from "./cube-runtime";
import {
  applyWorldTransform,
  attachImportedObject,
  createOneMetreCubeMesh,
  createSceneObjectRoot,
  geometryLocalSize,
  measurePlacementLocalAabb,
  worldMinY,
} from "./object-runtime";
import { createPi3aAuthority, PI3A_GENERATION_A, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_CUBE_EDGE_M,
  DEFAULT_WORLD_TRANSFORM,
} from "./types";

test("PI-3A cube geometry is 1 m and object scale is 1", () => {
  const mesh = createOneMetreCubeMesh();
  const size = geometryLocalSize(mesh);
  assert.ok(size);
  assert.ok(Math.abs(size.x - AFC_V2_RUNTIME_CUBE_EDGE_M) < 1e-9);
  assert.ok(Math.abs(size.y - AFC_V2_RUNTIME_CUBE_EDGE_M) < 1e-9);
  assert.ok(Math.abs(size.z - AFC_V2_RUNTIME_CUBE_EDGE_M) < 1e-9);
  assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
});

test("floor contact places the cube with world minY ≈ 0", () => {
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createOneMetreCubeMesh());
  applyWorldTransform(root.placement, DEFAULT_WORLD_TRANSFORM);
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);
  assert.ok(Math.abs(aabb.min.y - 0) < 1e-6);
  assert.ok(Math.abs(aabb.max.y - 1) < 1e-6);
  assert.deepEqual(aabb.min, TEST_CUBE_PLACEMENT_LOCAL_AABB.min);
  assert.deepEqual(aabb.max, TEST_CUBE_PLACEMENT_LOCAL_AABB.max);
  assert.ok(Math.abs(worldMinY(root.placement)) < 1e-6);
});

test("cube runtime identity is canonical AFC-world, not image-space", () => {
  const authority = createPi3aAuthority();
  const object = createPi3aCubeObjectFromAuthority(PI3A_ROOM_ID, authority);
  assert.equal(object.roomId, PI3A_ROOM_ID);
  assert.equal(object.generationId, PI3A_GENERATION_A);
  assert.equal(object.coordinateSpace, AFC_V2_RUNTIME_COORDINATE_SPACE);
  assert.equal(object.transform.uniformScale, 1);
  assert.deepEqual(object.transform.position, { x: 0, y: 0, z: 0 });
  assert.equal("xNorm" in object, false);
});
