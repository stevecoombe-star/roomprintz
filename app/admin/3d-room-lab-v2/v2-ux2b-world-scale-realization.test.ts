import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../3d-room-lab/calibrated-camera-readonly-projection";
import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import {
  ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M,
} from "./room-boundary-authority-contract";
import {
  TEST_CUBE_PLACEMENT_LOCAL_AABB,
  footprintFromLocalAabb,
} from "./room-collision-footprint";
import {
  NUMERICAL_DISTANCE_EPSILON,
  prepareCollisionWall,
  clippedMinInteriorDistance,
  resolveSweptConvexTranslation,
} from "./room-collision-geometry";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import {
  DEFAULT_WORLD_TRANSFORM,
  TEST_CUBE_EDGE_M,
  addTestCube,
  applyObjectWorldTransform,
  createInitialSceneLayerState,
  getSelectedSceneObject,
  resetSceneObjectTransform,
} from "./scene-layer-state";
import {
  MOVEMENT_CONTROL_RANGE_MARGIN_M,
  MOVEMENT_CONTROL_RANGE_MIN_SPAN_M,
  MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M,
  MOVEMENT_CONTROL_RANGE_MAX_ABS_M,
  MOVEMENT_CONTROL_RANGE_STEP_M,
  deriveSceneMovementControlRange,
} from "./scene-movement-control-range";
import {
  AUTO_METRIC_SCALE,
  USER_WORLD_SCALE_DEFAULT,
  USER_WORLD_SCALE_MAX,
  USER_WORLD_SCALE_MIN,
  USER_WORLD_SCALE_STEP,
  canonicalizeObjectWorldTransform,
  canonicalXzFromDisplayed,
  clampUserWorldScale,
  computeMetricScale,
  correctCanonicalTransformForScaleDown,
  correctSceneLayerForWorldScaleChange,
  createMetricRealizationMetadata,
  displayedXzFromCanonical,
  realizeCameraPose,
  realizeCollisionWall,
  realizeCollisionWalls,
  realizeCollisionWallDiagnostic,
  realizeFloorRectangle,
  realizeInteriorTick,
  realizeObjectWorldTransform,
  realizeWallBaseDiagnostic,
  resolveCanonicalTransformInRealizedWorld,
} from "./scene-metric-world-realization";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
  measurePlacementLocalAabb,
} from "./scene-object-runtime";
import {
  objectBodyDragWorldPosition,
  objectMatchesWorldTransform,
  worldTransformFromObject3D,
} from "./scene-viewport-interaction";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const PROJECTION_EPS = 1e-6;

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const roomLabSource = read("RoomLabV2.tsx");
const viewerSource = read("CalibratedRoomViewer.tsx");
const realizationSource = read("scene-metric-world-realization.ts");
const kernelSource = read("room-collision-geometry.ts");
const resolverSource = read("scene-collision-resolver.ts");
const interactionSource = read("scene-viewport-interaction.ts");

const xWallAt2: RoomCollisionEnabledWall = {
  id: "rb_right",
  sourceBoundaryId: "rb_right",
  sourceSeamId: "right_floor_wall",
  a: { x: 2, z: -4 },
  b: { x: 2, z: 4 },
  supportPlaneNormal: { x: 1, y: 0, z: 0 },
  supportPlaneConstant: -2,
  sideSign: -1,
};

const distantRightWall: RoomCollisionEnabledWall = {
  id: "rb_right_far",
  sourceBoundaryId: "rb_right_far",
  sourceSeamId: "right_floor_wall",
  a: { x: 8, z: -4 },
  b: { x: 8, z: 4 },
  supportPlaneNormal: { x: 1, y: 0, z: 0 },
  supportPlaneConstant: -8,
  sideSign: -1,
};

const canonicalFloor = { worldWidthM: 6, referenceDepthM: 4 };

const canonicalCameraPose = {
  position: { x: 1.25, y: 2.5, z: 3.75 },
  lookAt: { x: 0.25, y: 0.5, z: -0.75 },
  up: { x: 0, y: 1, z: 0 },
};

function transformAt(x: number, z = 0, y = 0) {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y, z },
  };
}

function cubeSize(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(object).getSize(size);
  return size;
}

function projectNdc(
  camera: THREE.PerspectiveCamera,
  point: Readonly<{ x: number; y: number; z: number }>,
): { x: number; y: number } {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: projected.x, y: projected.y };
}

function buildCamera(pose: typeof canonicalCameraPose): THREE.PerspectiveCamera {
  const result = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: 61.5,
    pose,
    frameSize: { width: 1118, height: 698 },
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("calibrated camera construction failed");
  return result.camera;
}

test("World Scale UI is present with Auto 1.00×, 0.50–2.00, step 0.01, and Reset to Auto", () => {
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(USER_WORLD_SCALE_DEFAULT, 1);
  assert.equal(USER_WORLD_SCALE_MIN, 0.5);
  assert.equal(USER_WORLD_SCALE_MAX, 2);
  assert.equal(USER_WORLD_SCALE_STEP, 0.01);
  assert.equal(computeMetricScale(1, 1.5), 1.5);
  assert.equal(clampUserWorldScale(0.1), 0.5);
  assert.equal(clampUserWorldScale(9), 2);
  assert.match(roomLabSource, /World Scale/);
  assert.match(roomLabSource, /Auto \{autoMetricScale\.toFixed\(2\)\}×/);
  assert.match(roomLabSource, /Reset to Auto/);
  assert.match(roomLabSource, /aria-label="World Scale"/);
  assert.match(roomLabSource, /const \[userWorldScale, setUserWorldScale\]/);
  assert.match(roomLabSource, /autoMetricScale \* |computeMetricScale\(autoMetricScale, userWorldScale\)/);
  assert.doesNotMatch(roomLabSource, /setUserWorldScale\([\s\S]{0,200}analyzeAndApply/);
  assert.doesNotMatch(roomLabSource, /setUserWorldScale\([\s\S]{0,200}constructAfc/);
});

test("S = 1 identity leaves Floor, camera, walls, and object X/Z/size unchanged", () => {
  const floor = realizeFloorRectangle(canonicalFloor, 1);
  assert.deepEqual(floor, canonicalFloor);
  const pose = realizeCameraPose(canonicalCameraPose, 1);
  assert.deepEqual(pose, canonicalCameraPose);
  const wall = realizeCollisionWall(xWallAt2, 1);
  assert.deepEqual(wall, xWallAt2);
  const object = realizeObjectWorldTransform(
    { ...DEFAULT_WORLD_TRANSFORM, position: { x: 1.5, y: 0.4, z: -2 }, uniformScale: 1.2 },
    1,
  );
  assert.equal(object.position.x, 1.5);
  assert.equal(object.position.y, 0.4);
  assert.equal(object.position.z, -2);
  assert.equal(object.uniformScale, 1.2);
});

test("S = 2 doubles Floor, camera translation, walls, and object X/Z without changing size fields", () => {
  const floor = realizeFloorRectangle(canonicalFloor, 2);
  assert.equal(floor.worldWidthM, 12);
  assert.equal(floor.referenceDepthM, 8);
  const pose = realizeCameraPose(canonicalCameraPose, 2);
  assert.deepEqual(pose.position, { x: 2.5, y: 5, z: 7.5 });
  assert.deepEqual(pose.lookAt, { x: 0.5, y: 1, z: -1.5 });
  assert.deepEqual(pose.up, canonicalCameraPose.up);
  const wall = realizeCollisionWall(xWallAt2, 2);
  assert.deepEqual(wall.a, { x: 4, z: -8 });
  assert.deepEqual(wall.b, { x: 4, z: 8 });
  assert.equal(wall.supportPlaneConstant, -4);
  assert.deepEqual(wall.supportPlaneNormal, xWallAt2.supportPlaneNormal);
  assert.equal(wall.sideSign, -1);
  assert.equal(wall.id, "rb_right");
  const object = realizeObjectWorldTransform(
    {
      position: { x: 1.5, y: 0.4, z: -2 },
      rotationDeg: { x: 10, y: 20, z: 30 },
      uniformScale: 1.2,
    },
    2,
  );
  assert.equal(object.position.x, 3);
  assert.equal(object.position.y, 0.4);
  assert.equal(object.position.z, -4);
  assert.deepEqual(object.rotationDeg, { x: 10, y: 20, z: 30 });
  assert.equal(object.uniformScale, 1.2);
  assert.deepEqual(TEST_CUBE_PLACEMENT_LOCAL_AABB.max, { x: 0.5, y: 1, z: 0.5 });
});

test("S = 0.5 is the inverse of S = 2", () => {
  const floor = realizeFloorRectangle(canonicalFloor, 0.5);
  assert.equal(floor.worldWidthM, 3);
  assert.equal(floor.referenceDepthM, 2);
  const pose = realizeCameraPose(canonicalCameraPose, 0.5);
  assert.deepEqual(pose.position, { x: 0.625, y: 1.25, z: 1.875 });
  const wall = realizeCollisionWall(xWallAt2, 0.5);
  assert.deepEqual(wall.a, { x: 1, z: -2 });
  assert.equal(wall.supportPlaneConstant, -1);
  const object = realizeObjectWorldTransform(transformAt(1.5, -2, 0.4), 0.5);
  assert.equal(object.position.x, 0.75);
  assert.equal(object.position.y, 0.4);
  assert.equal(object.position.z, -1);
});

test("uniform scale preserves the plane equation n·(S p) + S c = S(n·p + c)", () => {
  const point = { x: 2, y: 0, z: 1 };
  const S = 1.5;
  const canonical =
    xWallAt2.supportPlaneNormal.x * point.x +
    xWallAt2.supportPlaneNormal.y * point.y +
    xWallAt2.supportPlaneNormal.z * point.z +
    xWallAt2.supportPlaneConstant;
  const realizedWall = realizeCollisionWall(xWallAt2, S);
  const realizedPoint = { x: point.x * S, y: point.y, z: point.z * S };
  const realized =
    realizedWall.supportPlaneNormal.x * realizedPoint.x +
    realizedWall.supportPlaneNormal.y * realizedPoint.y +
    realizedWall.supportPlaneNormal.z * realizedPoint.z +
    realizedWall.supportPlaneConstant;
  assert.ok(Math.abs(realized - S * canonical) < 1e-12);
  assert.equal(canonical, 0);
  assert.equal(realized, 0);
});

test("projection invariance: Floor corners and wall endpoints stay on the same pixels", () => {
  const S = 1.7;
  const canonicalCamera = buildCamera(canonicalCameraPose);
  const realizedCamera = buildCamera(realizeCameraPose(canonicalCameraPose, S));
  assert.equal(canonicalCamera.fov, realizedCamera.fov);
  assert.deepEqual(canonicalCamera.up.toArray(), realizedCamera.up.toArray());

  const halfW = canonicalFloor.worldWidthM / 2;
  const halfD = canonicalFloor.referenceDepthM / 2;
  const corners = [
    { x: -halfW, y: 0, z: -halfD },
    { x: halfW, y: 0, z: -halfD },
    { x: halfW, y: 0, z: halfD },
    { x: -halfW, y: 0, z: halfD },
  ];
  const wallPoints = [
    { x: xWallAt2.a.x, y: 0, z: xWallAt2.a.z },
    { x: xWallAt2.b.x, y: 0, z: xWallAt2.b.z },
  ];
  let maxError = 0;
  for (const point of [...corners, ...wallPoints]) {
    const before = projectNdc(canonicalCamera, point);
    const after = projectNdc(realizedCamera, {
      x: point.x * S,
      y: point.y,
      z: point.z * S,
    });
    const error = Math.hypot(before.x - after.x, before.y - after.y);
    maxError = Math.max(maxError, error);
    assert.ok(
      error < PROJECTION_EPS,
      `pixel drift ${error} at ${JSON.stringify(point)}`,
    );
  }
  assert.ok(maxError < PROJECTION_EPS, `max pixel drift ${maxError}`);
});

test("active wall identity is preserved; realization happens after selectActiveRuntimeCollisionWalls", () => {
  const realized = realizeCollisionWalls([xWallAt2, distantRightWall], 1.5);
  assert.equal(realized.length, 2);
  assert.equal(realized[0]?.id, "rb_right");
  assert.equal(realized[1]?.id, "rb_right_far");
  assert.equal(realized[0]?.sourceSeamId, xWallAt2.sourceSeamId);
  assert.equal(realized[0]?.sideSign, -1);
  assert.notEqual(realized[0]?.a.x, xWallAt2.a.x);
  const selectCall = roomLabSource.indexOf(
    "const activeCollision = selectActiveRuntimeCollisionWalls",
  );
  const realizeCall = roomLabSource.indexOf(
    "realizeCollisionWalls(\n    activeCollision.walls",
  );
  assert.ok(selectCall >= 0);
  assert.ok(realizeCall > selectCall);
  assert.doesNotMatch(viewerSource, /selectActiveRuntimeCollisionWalls/);
  assert.match(viewerSource, /realizeCollisionWalls\(collisionWallsRef\.current/);
  assert.match(roomLabSource, /collisionWalls=\{activeCollision\.walls\}/);
});

test("scaling up a flush 1 m cube preserves size, follows Model C, and allows a gap", () => {
  const flush = transformAt(1.5);
  const S = 1.5;
  const realized = realizeObjectWorldTransform(flush, S);
  const realizedWalls = realizeCollisionWalls([xWallAt2], S);
  assert.equal(realized.position.x, 2.25);
  assert.equal(realized.uniformScale, 1);
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createTestCubeMesh());
  applyWorldTransform(root.placement, realized);
  const size = cubeSize(root.placement);
  assert.ok(Math.abs(size.x - TEST_CUBE_EDGE_M) < 1e-6);
  assert.ok(Math.abs(size.y - TEST_CUBE_EDGE_M) < 1e-6);
  const resolved = resolveSceneObjectCollision({
    current: realized,
    proposed: realized,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: realizedWalls,
    mode: "move",
  });
  assert.ok(Math.abs(resolved.transform.position.x - 2.25) < 1e-6);
  const face = realized.position.x + 0.5;
  const wallX = realizedWalls[0]!.a.x;
  assert.ok(wallX - face > 0.2);
  const corrected = correctCanonicalTransformForScaleDown({
    canonical: flush,
    previousMetricScale: 1,
    nextMetricScale: S,
    canonicalWalls: [xWallAt2],
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
  });
  assert.equal(corrected.position.x, 1.5);
  assert.equal(corrected.uniformScale, 1);
});

test("scaling down a flush cube uses the swept resolver and canonicalizes a valid pose", () => {
  const flush = transformAt(1.5);
  const S = 0.5;
  const corrected = correctCanonicalTransformForScaleDown({
    canonical: flush,
    previousMetricScale: 1,
    nextMetricScale: S,
    canonicalWalls: [xWallAt2],
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
  });
  const realized = realizeObjectWorldTransform(corrected, S);
  const realizedWalls = realizeCollisionWalls([xWallAt2], S);
  const check = resolveSceneObjectCollision({
    current: realized,
    proposed: realized,
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls: realizedWalls,
    mode: "move",
  });
  assert.equal(check.unresolvedOverlap, false);
  assert.ok(Math.abs(realized.position.x - 0.5) < 1e-6);
  assert.ok(Math.abs(corrected.position.x - 1) < 1e-6);
  assert.equal(corrected.position.y, 0);
  assert.equal(corrected.uniformScale, 1);
  const prepared = prepareCollisionWall(realizedWalls[0]!);
  assert.ok(prepared);
  const minD = clippedMinInteriorDistance(
    footprintFromLocalAabb(TEST_CUBE_PLACEMENT_LOCAL_AABB, realized),
    prepared,
  );
  assert.ok(minD !== null);
  assert.ok(minD! >= -NUMERICAL_DISTANCE_EPSILON);
});

test("no-tunneling, slide, rotate rejection, and scale rejection hold against realized walls", () => {
  const S = 1.5;
  const walls = realizeCollisionWalls([distantRightWall], S);
  const start = footprintFromLocalAabb(
    TEST_CUBE_PLACEMENT_LOCAL_AABB,
    realizeObjectWorldTransform(transformAt(0), S),
  );
  const tunneled = resolveSweptConvexTranslation({
    startVertices: start,
    translation: { x: 40, z: 0 },
    walls,
    allowSlide: false,
  });
  assert.ok(tunneled.translation.x < 12);
  assert.ok(Math.abs(tunneled.translation.x - 11.5) < 1e-6);
  const flushRealized = {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x: 11.5, y: 0, z: 0 },
  };
  const slideStart = footprintFromLocalAabb(
    TEST_CUBE_PLACEMENT_LOCAL_AABB,
    flushRealized,
  );
  const slid = resolveSweptConvexTranslation({
    startVertices: slideStart,
    translation: { x: 2, z: -1.5 },
    walls,
    allowSlide: true,
  });
  assert.ok(Math.abs(slid.translation.x) <= NUMERICAL_DISTANCE_EPSILON * 10);
  const rotateRejected = resolveSceneObjectCollision({
    current: flushRealized,
    proposed: { ...flushRealized, rotationDeg: { x: 0, y: 45, z: 0 } },
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls,
    mode: "pose",
  });
  assert.equal(rotateRejected.status, "rejected_pose");
  const scaleRejected = resolveSceneObjectCollision({
    current: flushRealized,
    proposed: { ...flushRealized, uniformScale: 2 },
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls,
    mode: "pose",
  });
  assert.equal(scaleRejected.status, "rejected_pose");
  assert.equal(scaleRejected.transform.uniformScale, 1);
});

test("TransformControls at World Scale ≠ 1 compares realized mesh pose to realized state", () => {
  const canonical = transformAt(1.2, -0.8, 0.4);
  const S = 1.5;
  const realized = realizeObjectWorldTransform(canonical, S);
  const object = new THREE.Group();
  applyWorldTransform(object, realized);
  assert.equal(objectMatchesWorldTransform(object, realized), true);
  assert.equal(objectMatchesWorldTransform(object, canonical), false);
  const readBack = worldTransformFromObject3D(object);
  const stored = canonicalizeObjectWorldTransform(readBack, S);
  assert.ok(Math.abs(stored.position.x - canonical.position.x) < 1e-6);
  assert.ok(Math.abs(stored.position.z - canonical.position.z) < 1e-6);
  assert.equal(stored.position.y, 0.4);
  assert.equal(stored.uniformScale, 1);
  assert.match(viewerSource, /realizeObjectWorldTransform\(\s*record\.transform/);
  assert.match(viewerSource, /objectMatchesWorldTransform\(entry\.placement, realizedTransform\)/);
  assert.match(viewerSource, /canonicalizeObjectWorldTransform\(realized, metricScaleRef\.current\)/);
  assert.match(viewerSource, /applyWorldTransform\(attached, resolved\.transform\)/);
  assert.doesNotMatch(viewerSource, /uniformScale[\s\S]{0,40}metricScale/);
});

test("body drag proposals stay in realized metres and write back canonical X/Z", () => {
  const S = 2;
  const drag = objectBodyDragWorldPosition({
    hitX: 3,
    hitZ: -4,
    offsetX: 0,
    offsetZ: 0,
    placementY: 0,
  });
  assert.equal(drag.x, 3);
  assert.equal(drag.z, -4);
  const stored = canonicalizeObjectWorldTransform(
    { ...DEFAULT_WORLD_TRANSFORM, position: drag },
    S,
  );
  assert.equal(stored.position.x, 1.5);
  assert.equal(stored.position.z, -2);
  const again = realizeObjectWorldTransform(stored, S);
  assert.equal(again.position.x, 3);
  assert.equal(again.position.z, -4);
  assert.equal(again.position.y, 0);
  const host = resolveCanonicalTransformInRealizedWorld({
    currentCanonical: transformAt(0),
    proposedCanonical: transformAt(3, -2),
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    canonicalWalls: [xWallAt2],
    metricScale: S,
    mode: "move",
  });
  assert.ok(host.position.x < 3);
  assert.match(viewerSource, /reportCanonicalTransform\(session\.objectId/);
  assert.match(viewerSource, /objectBodyDragWorldPosition/);
});

test("host sliders display realized X/Z and store canonical X/Z", () => {
  const S = 1.5;
  assert.equal(displayedXzFromCanonical(1, S), 1.5);
  assert.equal(canonicalXzFromDisplayed(2.25, S), 1.5);
  assert.match(roomLabSource, /displayedXzFromCanonical\(\s*selectedSceneObject\.transform\.position\.x/);
  assert.match(roomLabSource, /displayedXzFromCanonical\(\s*selectedSceneObject\.transform\.position\.z/);
  assert.match(roomLabSource, /canonicalXzFromDisplayed\(value, metricScale\)/);
  assert.match(roomLabSource, /realizeFloorRectangle\(applied\.floor, metricScale\)/);
  const range = deriveSceneMovementControlRange({
    floor: realizeFloorRectangle(canonicalFloor, S),
    collisionWalls: realizeCollisionWalls([distantRightWall], S),
  });
  assert.ok(range.positionX.max >= 12 + MOVEMENT_CONTROL_RANGE_MARGIN_M);
  assert.equal(MOVEMENT_CONTROL_RANGE_MARGIN_M, 1);
  assert.equal(MOVEMENT_CONTROL_RANGE_MIN_SPAN_M, 10);
  assert.equal(MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M, 20);
  assert.equal(MOVEMENT_CONTROL_RANGE_MAX_ABS_M, 50);
  assert.equal(MOVEMENT_CONTROL_RANGE_STEP_M, 0.01);
});

test("Reset Transform at S=1.5 restores canonical initialTransform and realizes it", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, transformAt(1, -2));
  state = resetSceneObjectTransform(state);
  const selected = getSelectedSceneObject(state);
  assert.deepEqual(selected?.transform, DEFAULT_WORLD_TRANSFORM);
  const realized = realizeObjectWorldTransform(selected!.transform, 1.5);
  assert.equal(realized.position.x, 0);
  assert.equal(realized.position.z, 0);
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createTestCubeMesh());
  applyWorldTransform(root.placement, realized);
  assert.ok(Math.abs(cubeSize(root.placement).x - 1) < 1e-6);
  assert.match(roomLabSource, /selected\.initialTransform/);
});

test("Reset to Auto restores S=1 without rewriting canonical X/Z", () => {
  const metadata = createMetricRealizationMetadata({ userWorldScale: 1.5 });
  assert.equal(metadata.metricScale, 1.5);
  assert.equal(metadata.autoMetricScale, 1);
  assert.equal(metadata.userWorldScale, 1.5);
  assert.equal(metadata.sourceCoordinateSpace, "calibrated-world-xz/v1");
  const reset = createMetricRealizationMetadata({ userWorldScale: 1 });
  assert.equal(reset.metricScale, 1);
  const canonical = transformAt(1, -2);
  const realizedAtReset = realizeObjectWorldTransform(canonical, reset.metricScale);
  assert.equal(realizedAtReset.position.x, 1);
  assert.equal(realizedAtReset.position.z, -2);
  assert.match(roomLabSource, /Reset to Auto/);
  assert.match(roomLabSource, /setUserWorldScale\(USER_WORLD_SCALE_DEFAULT\)/);
});

test("viewer construction dependencies stay canonical; World Scale updates in place", () => {
  assert.match(
    viewerSource,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
  assert.doesNotMatch(
    viewerSource,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot, metricScale\]\);/,
  );
  assert.match(viewerSource, /metricScaleRef/);
  assert.match(viewerSource, /applyFloorMeshScale/);
  assert.match(viewerSource, /applyRealizedCameraPose\(result\.camera, snapshot/);
  assert.match(viewerSource, /floorSurface\.scale\.set/);
  assert.doesNotMatch(viewerSource, /objectLayer\.scale/);
  assert.doesNotMatch(viewerSource, /scene\.scale/);
  assert.doesNotMatch(realizationSource, /from ["']react["']|from ["']three["']/);
});

test("amber and collision diagnostics realize X/Z and keep Y offsets and tick length", () => {
  const amber = realizeWallBaseDiagnostic({
    id: "rb_right",
    sourceSeamId: "right_floor_wall",
    start: [2, 0.01, -1],
    end: [2, 0.01, 1],
    interiorTick: {
      from: [2, 0.01, 0],
      to: [2 - ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M, 0.01, 0],
    },
  }, 2);
  assert.deepEqual(amber.start, [4, 0.01, -2]);
  assert.deepEqual(amber.end, [4, 0.01, 2]);
  assert.ok(amber.interiorTick);
  const tickLen = Math.hypot(
    amber.interiorTick!.to[0] - amber.interiorTick!.from[0],
    amber.interiorTick!.to[2] - amber.interiorTick!.from[2],
  );
  assert.ok(Math.abs(tickLen - ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M) < 1e-9);
  const collision = realizeCollisionWallDiagnostic({
    id: "rb_right",
    sourceSeamId: "right_floor_wall",
    start: [2, 0.018, -1],
    end: [2, 0.018, 1],
  }, 2);
  assert.deepEqual(collision.start, [4, 0.018, -2]);
  const tick = realizeInteriorTick({
    from: [0, 0.01, 0],
    to: [ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M, 0.01, 0],
  }, 0.5);
  assert.ok(
    Math.abs(tick.to[0] - tick.from[0] - ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M) < 1e-12,
  );
  assert.match(viewerSource, /realizeWallBaseDiagnostic\(canonical, scale\)/);
  assert.match(viewerSource, /realizeCollisionWallDiagnostic\(canonical, scale\)/);
  assert.doesNotMatch(kernelSource, /metricScale|userWorldScale/);
  assert.doesNotMatch(resolverSource, /metricScale|userWorldScale/);
});

test("World Scale does not rebuild applied, S4, or the collision kernel", () => {
  assert.doesNotMatch(realizationSource, /constructAfcV2RoomBoundaryAuthority|constructAfcV2RoomCollisionAuthority/);
  assert.doesNotMatch(realizationSource, /selectActiveRuntimeCollisionWalls/);
  assert.doesNotMatch(interactionSource, /metricScale|userWorldScale/);
  assert.match(roomLabSource, /camera=\{applied\.camera\}/);
  assert.match(roomLabSource, /worldWidthM: applied\.floor\.worldWidthM/);
  assert.match(roomLabSource, /referenceDepthM: applied\.floor\.referenceDepthM/);
  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, transformAt(0.2, -0.4, 0.3));
  const after = correctSceneLayerForWorldScaleChange({
    state,
    previousMetricScale: 1,
    nextMetricScale: 1.8,
    canonicalWalls: [xWallAt2],
    localAabbFor: () => TEST_CUBE_PLACEMENT_LOCAL_AABB,
  });
  assert.equal(after, state);
  const root = createSceneObjectRoot();
  const cube = createTestCubeMesh();
  attachImportedObject(root.importPlacement, cube);
  applyWorldTransform(
    root.placement,
    realizeObjectWorldTransform(DEFAULT_WORLD_TRANSFORM, 1.8),
  );
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);
  assert.ok(Math.abs(aabb.max.x - 0.5) < 1e-6);
  assert.ok(Math.abs(aabb.max.y - 1) < 1e-6);
  cube.geometry.dispose();
  (cube.material as THREE.Material).dispose();
});
