import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import { TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB } from "./room-collision-footprint";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import {
  DEFAULT_WORLD_TRANSFORM,
  SCENE_TRANSFORM_LIMITS,
  addGlbModel,
  addTestCube,
  applyObjectWorldTransform,
  createInitialSceneLayerState,
  deleteSelectedSceneObject,
  getSelectedSceneObject,
  resetSceneObjectTransform,
  selectSceneObject,
  updateSelectedPositionAxis,
} from "./scene-layer-state";
import {
  applyWorldTransform,
  attachNormalizedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
  measurePlacementLocalAabb,
} from "./scene-object-runtime";
import {
  bodyDragGrabOffset,
  objectBodyDragWorldPosition,
} from "./scene-viewport-interaction";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const xWall: RoomCollisionEnabledWall = {
  id: "rb_right",
  sourceBoundaryId: "rb_right",
  sourceSeamId: "right_floor_wall",
  a: { x: 1, z: -2 },
  b: { x: 1, z: 2 },
  supportPlaneNormal: { x: 1, y: 0, z: 0 },
  supportPlaneConstant: -1,
  sideSign: -1,
};

function transformAt(x: number, z = 0) {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y: 0, z },
  };
}

test("body-drag helper preserves grab offset while the resolver stops at the wall", () => {
  const grab = bodyDragGrabOffset({ x: 0.5, z: -0.25 }, { x: 0.25, z: 0.25 });
  const proposed = objectBodyDragWorldPosition({
    hitX: 4,
    hitZ: 0.5,
    offsetX: grab.offsetX,
    offsetZ: grab.offsetZ,
    placementY: 0,
  });
  assert.equal(proposed.x, 4 - grab.offsetX);
  const resolved = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: { ...DEFAULT_WORLD_TRANSFORM, position: proposed },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "move",
  });
  assert.ok(resolved.transform.position.x < proposed.x);
  assert.ok(Math.abs(resolved.transform.position.x - 0.25) < 1e-6);
  assert.equal(resolved.transform.position.y, 0);
});

test("TransformControls Move uses the same resolver and leaves Y to the floor invariant", () => {
  const resolved = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 4, y: 1.2, z: 0.5 },
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "move",
  });
  assert.ok(Math.abs(resolved.transform.position.x - 0.25) < 1e-6);
  assert.equal(resolved.transform.position.y, 1.2);
  const viewerSource = read("CalibratedRoomViewer.tsx");
  assert.match(viewerSource, /writeAttachedTransform/);
  assert.match(viewerSource, /mode: controls\.getMode\(\) === "translate" \? "move" : "pose"/);
  assert.match(viewerSource, /applyWorldTransform\(attached, resolved\.transform\)/);
});

test("X/Z sliders cannot bypass collision; Y slider is floor-only", () => {
  const state = addTestCube(createInitialSceneLayerState());
  const selected = getSelectedSceneObject(state)!;
  const clamped = updateSelectedPositionAxis(state, "x", 4);
  const proposed = getSelectedSceneObject(clamped)!;
  const resolved = resolveSceneObjectCollision({
    current: selected.transform,
    proposed: proposed.transform,
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "move",
  });
  assert.ok(resolved.transform.position.x < 4);
  const yOnly = updateSelectedPositionAxis(state, "y", 2);
  assert.equal(getSelectedSceneObject(yOnly)?.transform.position.y, 2);
  assert.equal(getSelectedSceneObject(yOnly)?.transform.position.x, 0);
  const roomLabSource = read("RoomLabV2.tsx");
  assert.match(roomLabSource, /applyCollisionAwareTransform/);
  assert.match(roomLabSource, /updateSelectedPositionAxis\(\s*current,\s*"y"/);
});

test("valid rotation is accepted and penetrating rotation is rejected without auto-translation", () => {
  const accepted = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      rotationDeg: { x: 0, y: 20, z: 0 },
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "pose",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.transform.rotationDeg.y, 20);
  const flush = transformAt(0.25);
  const rejected = resolveSceneObjectCollision({
    current: flush,
    proposed: {
      ...flush,
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "pose",
  });
  assert.equal(rejected.status, "rejected_pose");
  assert.equal(rejected.transform.position.x, 0.25);
  assert.equal(rejected.transform.rotationDeg.y, 0);
});

test("valid scale is accepted and penetrating scale is rejected without auto-translation", () => {
  const accepted = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: { ...DEFAULT_WORLD_TRANSFORM, uniformScale: 1.1 },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "pose",
  });
  assert.equal(accepted.status, "accepted");
  const flush = transformAt(0.25);
  const rejected = resolveSceneObjectCollision({
    current: flush,
    proposed: { ...flush, uniformScale: 2 },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "pose",
  });
  assert.equal(rejected.status, "rejected_pose");
  assert.equal(rejected.transform.uniformScale, 1);
  assert.equal(rejected.transform.position.x, 0.25);
});

test("reset uses collision policy instead of bypassing walls", () => {
  const overlappingInitial = transformAt(1);
  const current = transformAt(-1);
  const reset = resolveSceneObjectCollision({
    current,
    proposed: overlappingInitial,
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "pose",
  });
  assert.equal(reset.status, "rejected_pose");
  assert.equal(reset.transform.position.x, -1);
  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, transformAt(0.4));
  state = resetSceneObjectTransform(state);
  assert.equal(getSelectedSceneObject(state)?.transform.position.x, 0);
});

test("object lifecycle, selection, and delete remain independent of collision", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addGlbModel(state, { objectUrl: "blob:s4b", fileName: "chair.glb" });
  assert.equal(state.objects.length, 2);
  state = selectSceneObject(state, state.objects[0]!.id);
  state = deleteSelectedSceneObject(state);
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0]?.kind, "glb");
  const viewerSource = read("CalibratedRoomViewer.tsx");
  assert.match(viewerSource, /controls\.attach\(target\)/);
  assert.match(viewerSource, /loadGlbFromUrl/);
  assert.doesNotMatch(viewerSource, /revokeObjectURL/);
});

test("historical X/Z sandbox limits are not physical authority; walls still stop movement", () => {
  const state = updateSelectedPositionAxis(
    addTestCube(createInitialSceneLayerState()),
    "x",
    8,
  );
  assert.equal(getSelectedSceneObject(state)?.transform.position.x, 8);
  assert.ok(8 > SCENE_TRANSFORM_LIMITS.positionX.max);
  const resolved = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: transformAt(8),
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [xWall],
    mode: "move",
  });
  assert.ok(resolved.transform.position.x < 8);
  assert.ok(Math.abs(resolved.transform.position.x - 0.25) < 1e-6);
});

test("Test Cube cached AABB matches auto-bounds normalization", () => {
  const root = createSceneObjectRoot();
  const cube = createTestCubeMesh();
  attachNormalizedObject(root.autoBounds, cube);
  applyWorldTransform(root.placement, DEFAULT_WORLD_TRANSFORM);
  const aabb = measurePlacementLocalAabb(root.placement, root.autoBounds);
  assert.ok(aabb);
  assert.ok(Math.abs(aabb.min.x - TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB.min.x) < 1e-6);
  assert.ok(Math.abs(aabb.max.x - TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB.max.x) < 1e-6);
  assert.ok(Math.abs(aabb.min.y) < 1e-6);
  cube.geometry.dispose();
  (cube.material as THREE.Material).dispose();
});

test("resolver does not inspect observation or S4A qualification", () => {
  const source = read("scene-collision-resolver.ts");
  assert.doesNotMatch(source, /empty-room-observation|observedSeams|room-boundary-qualification/);
  assert.doesNotMatch(source, /constructAfcV2RoomCollisionAuthority|aspect_compatible_rescaled/);
  assert.match(source, /RoomCollisionEnabledWall/);
});
