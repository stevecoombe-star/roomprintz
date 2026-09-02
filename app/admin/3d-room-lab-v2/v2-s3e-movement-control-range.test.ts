import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import { TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB, footprintFromLocalAabb } from "./room-collision-footprint";
import {
  NUMERICAL_DISTANCE_EPSILON,
  resolveSweptConvexTranslation,
} from "./room-collision-geometry";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import {
  DEFAULT_WORLD_TRANSFORM,
  SCENE_POSITION_XZ_SAFETY_ABS_M,
  SCENE_TRANSFORM_LIMITS,
  addGlbModel,
  addTestCube,
  applyObjectWorldTransform,
  createInitialSceneLayerState,
  getSelectedSceneObject,
  resetSceneObjectTransform,
  updateSelectedPositionAxis,
  updateSelectedRotationAxis,
  updateSelectedUniformScale,
} from "./scene-layer-state";
import {
  MOVEMENT_CONTROL_RANGE_MARGIN_M,
  deriveSceneMovementControlRange,
} from "./scene-movement-control-range";
import { objectBodyDragWorldPosition } from "./scene-viewport-interaction";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const roomLabSource = read("RoomLabV2.tsx");
const sceneLayerSource = read("scene-layer-state.ts");
const interactionSource = read("scene-viewport-interaction.ts");
const rangeSource = read("scene-movement-control-range.ts");

const distantBackWall: RoomCollisionEnabledWall = {
  id: "rb_back",
  sourceBoundaryId: "rb_back",
  sourceSeamId: "back_floor_wall",
  a: { x: -4, z: -14 },
  b: { x: 4, z: -14 },
  supportPlaneNormal: { x: 0, y: 0, z: -1 },
  supportPlaneConstant: -14,
  sideSign: -1,
};

const distantRightWall: RoomCollisionEnabledWall = {
  id: "rb_right",
  sourceBoundaryId: "rb_right",
  sourceSeamId: "right_floor_wall",
  a: { x: 8, z: -4 },
  b: { x: 8, z: 4 },
  supportPlaneNormal: { x: 1, y: 0, z: 0 },
  supportPlaneConstant: -8,
  sideSign: -1,
};

function transformAt(x: number, z = 0) {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y: 0, z },
  };
}

test("Test Cube and GLB share one live X/Z control-range derivation", () => {
  assert.match(roomLabSource, /deriveSceneMovementControlRange/);
  assert.match(roomLabSource, /min=\{movementControlRange\.positionX\.min\}/);
  assert.match(roomLabSource, /min=\{movementControlRange\.positionZ\.min\}/);
  assert.doesNotMatch(
    roomLabSource,
    /selectedSceneObject\.kind[\s\S]{0,120}movementControlRange/,
  );
  assert.doesNotMatch(rangeSource, /test_cube|glb/);
  let cube = addTestCube(createInitialSceneLayerState());
  let glb = addGlbModel(createInitialSceneLayerState(), {
    objectUrl: "blob:ux1b",
    fileName: "chair.glb",
  });
  cube = updateSelectedPositionAxis(cube, "z", -12);
  glb = updateSelectedPositionAxis(glb, "z", -12);
  assert.equal(getSelectedSceneObject(cube)?.transform.position.z, -12);
  assert.equal(getSelectedSceneObject(glb)?.transform.position.z, -12);
});

test("body drag and state writes can reach beyond historical ±5 / ±10", () => {
  const drag = objectBodyDragWorldPosition({
    hitX: 8,
    hitZ: -14,
    offsetX: 0,
    offsetZ: 0,
    placementY: 0,
  });
  assert.equal(drag.x, 8);
  assert.equal(drag.z, -14);
  assert.ok(drag.x > SCENE_TRANSFORM_LIMITS.positionX.max);
  assert.ok(drag.z < SCENE_TRANSFORM_LIMITS.positionZ.min);

  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x: 8, y: 0, z: -12 },
  });
  const selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.x, 8);
  assert.equal(selected?.transform.position.z, -12);
});

test("a wall beyond historical Z = -10 stops the object, not the old transform range", () => {
  const range = deriveSceneMovementControlRange({
    floor: { worldWidthM: 6, referenceDepthM: 4 },
    collisionWalls: [distantBackWall],
  });
  assert.ok(range.positionZ.min <= -14 - MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.ok(range.positionZ.min < SCENE_TRANSFORM_LIMITS.positionZ.min);

  const resolved = resolveSceneObjectCollision({
    current: transformAt(0, 0),
    proposed: transformAt(0, -20),
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [distantBackWall],
    mode: "move",
  });
  assert.ok(resolved.transform.position.z < SCENE_TRANSFORM_LIMITS.positionZ.min);
  assert.ok(Math.abs(resolved.transform.position.z - (-13.25)) < 1e-6);
  assert.ok(resolved.transform.position.z > -14);
});

test("a wall beyond historical X = 5 stops the object, not the old transform range", () => {
  const range = deriveSceneMovementControlRange({
    floor: { worldWidthM: 6, referenceDepthM: 4 },
    collisionWalls: [distantRightWall],
  });
  assert.ok(range.positionX.max >= 8 + MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.ok(range.positionX.max > SCENE_TRANSFORM_LIMITS.positionX.max);

  const resolved = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: transformAt(20),
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [distantRightWall],
    mode: "move",
  });
  assert.ok(resolved.transform.position.x > SCENE_TRANSFORM_LIMITS.positionX.max);
  assert.ok(Math.abs(resolved.transform.position.x - 7.25) < 1e-6);
});

test("no-tunneling remains intact for a jump past a distant wall", () => {
  const start = footprintFromLocalAabb(
    TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    transformAt(0),
  );
  const result = resolveSweptConvexTranslation({
    startVertices: start,
    translation: { x: 40, z: 0 },
    walls: [distantRightWall],
    allowSlide: false,
  });
  assert.ok(result.translation.x < 8);
  assert.ok(Math.abs(result.translation.x - 7.25) < 1e-6);
});

test("slide remains intact along a distant wall", () => {
  const flushX = 7.25;
  const start = footprintFromLocalAabb(
    TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    transformAt(flushX, 0),
  );
  const result = resolveSweptConvexTranslation({
    startVertices: start,
    translation: { x: 2, z: -1.5 },
    walls: [distantRightWall],
    allowSlide: true,
  });
  assert.ok(Math.abs(result.translation.x) <= NUMERICAL_DISTANCE_EPSILON * 10);
  assert.ok(result.translation.z < 0);
  assert.ok(Math.abs(result.translation.z + 1.5) < 1e-6);
});

test("rotate rejection remains intact against a distant wall", () => {
  const flush = transformAt(7.25);
  const rejected = resolveSceneObjectCollision({
    current: flush,
    proposed: {
      ...flush,
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [distantRightWall],
    mode: "pose",
  });
  assert.equal(rejected.status, "rejected_pose");
  assert.equal(rejected.transform.position.x, 7.25);
  assert.equal(rejected.transform.rotationDeg.y, 0);
});

test("scale rejection remains intact against a distant wall", () => {
  const flush = transformAt(7.25);
  const rejected = resolveSceneObjectCollision({
    current: flush,
    proposed: { ...flush, uniformScale: 2 },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [distantRightWall],
    mode: "pose",
  });
  assert.equal(rejected.status, "rejected_pose");
  assert.equal(rejected.transform.uniformScale, 1);
  assert.equal(rejected.transform.position.x, 7.25);
});

test("floor Y clamp and Reset Transform remain intact", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    position: { x: 8, y: -2, z: -12 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  });
  assert.equal(getSelectedSceneObject(state)?.transform.position.y, 0);
  assert.equal(getSelectedSceneObject(state)?.transform.position.x, 8);
  assert.equal(getSelectedSceneObject(state)?.transform.position.z, -12);
  state = resetSceneObjectTransform(state);
  assert.deepEqual(getSelectedSceneObject(state)?.transform, DEFAULT_WORLD_TRANSFORM);
});

test("Y, rotation, and scale limits are unchanged", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedPositionAxis(state, "y", 9);
  assert.equal(
    getSelectedSceneObject(state)?.transform.position.y,
    SCENE_TRANSFORM_LIMITS.positionY.max,
  );
  state = updateSelectedRotationAxis(state, "y", 400);
  assert.equal(
    getSelectedSceneObject(state)?.transform.rotationDeg.y,
    SCENE_TRANSFORM_LIMITS.rotationDeg.max,
  );
  state = updateSelectedUniformScale(state, 12);
  assert.equal(
    getSelectedSceneObject(state)?.transform.uniformScale,
    SCENE_TRANSFORM_LIMITS.uniformScale.max,
  );
});

test("X/Z UI range stays out of S4 receipts and the collision kernel", () => {
  assert.doesNotMatch(rangeSource, /schemaVersion|collisionAuthority|S4A|S4B/);
  assert.doesNotMatch(
    sceneLayerSource,
    /worldWidthM|referenceDepthM|deriveSceneMovementControlRange/,
  );
  assert.doesNotMatch(
    interactionSource,
    /deriveSceneMovementControlRange|worldWidthM|SCENE_TRANSFORM_LIMITS\.positionX\.min/,
  );
  assert.match(interactionSource, /SCENE_POSITION_XZ_SAFETY_ABS_M/);
  assert.equal(SCENE_POSITION_XZ_SAFETY_ABS_M, 500);
});
