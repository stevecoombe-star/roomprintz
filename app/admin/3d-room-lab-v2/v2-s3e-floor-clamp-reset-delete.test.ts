import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import * as THREE from "three";

import {
  CALIBRATED_FLOOR_PLANE_Y,
  DEFAULT_WORLD_TRANSFORM,
  SCENE_TRANSFORM_LIMITS,
  addGlbModel,
  addTestCube,
  applyObjectWorldTransform,
  blobUrlOwnedSolelyByObject,
  createInitialSceneLayerState,
  deleteSceneObject,
  deleteSelectedSceneObject,
  getSelectedSceneObject,
  resetSceneObjectTransform,
  sceneObjectBlobUrls,
  selectSceneObject,
  updateSelectedPositionAxis,
  updateSelectedRotationAxis,
  updateSelectedUniformScale,
} from "./scene-layer-state";
import {
  applyWorldTransform,
  createSceneObjectRoot,
} from "./scene-object-runtime";
import {
  enforceNonNegativeWorldY,
  transformControlsAttachmentTarget,
  worldTransformFromObject3D,
} from "./scene-viewport-interaction";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const sceneLayerSource = read("scene-layer-state.ts");
const sceneRuntimeSource = read("scene-object-runtime.ts");
const interactionSource = read("scene-viewport-interaction.ts");
const viewerSource = read("CalibratedRoomViewer.tsx");
const roomLabSource = read("RoomLabV2.tsx");

test("negative Y is rejected by state and normalized to the calibrated floor plane", () => {
  assert.equal(CALIBRATED_FLOOR_PLANE_Y, 0);
  assert.equal(SCENE_TRANSFORM_LIMITS.positionY.min, 0);
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedPositionAxis(state, "y", -1);
  assert.equal(getSelectedSceneObject(state)?.transform.position.y, 0);

  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    position: { x: 0.25, y: -1, z: 0.5 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  });
  const selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.y, 0);
  assert.equal(selected?.transform.position.x, 0.25);
  assert.equal(selected?.transform.position.z, 0.5);
});

test("gizmo readback clamps placement Y below the floor during synchronization", () => {
  const root = createSceneObjectRoot();
  tagAndPlace(root.placement, "cube-1", { x: 0.2, y: -1, z: -0.4 });
  enforceNonNegativeWorldY(root.placement);
  assert.equal(root.placement.position.y, 0);
  assert.equal(root.placement.position.x, 0.2);
  assert.equal(root.placement.position.z, -0.4);

  let state = addTestCube(createInitialSceneLayerState());
  const id = state.selectedObjectId!;
  state = applyObjectWorldTransform(state, id, worldTransformFromObject3D(root.placement));
  assert.equal(state.objects[0]?.transform.position.y, 0);
  assert.equal(state.objects[0]?.transform.position.x, 0.2);
  assert.match(viewerSource, /enforceNonNegativeWorldY\(attached\)/);
  assert.match(viewerSource, /enforceNonNegativeWorldY\(entry\.placement\)/);
  assert.match(viewerSource, /if \(controls\.object\) enforceNonNegativeWorldY\(controls\.object\)/);
});

test("positive Y and negative X/Z remain valid", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedPositionAxis(state, "y", 1.5);
  state = updateSelectedPositionAxis(state, "x", -1.25);
  state = updateSelectedPositionAxis(state, "z", -2.5);
  const selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.y, 1.5);
  assert.equal(selected?.transform.position.x, -1.25);
  assert.equal(selected?.transform.position.z, -2.5);

  const object = new THREE.Group();
  applyWorldTransform(object, {
    position: { x: -1.25, y: 1.5, z: -2.5 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  });
  assert.deepEqual(object.position.toArray(), [-1.25, 1.5, -2.5]);
});

test("applyWorldTransform never writes a below-floor Y onto a placement group", () => {
  const object = new THREE.Group();
  applyWorldTransform(object, {
    position: { x: 0.4, y: -3, z: 0.1 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  });
  assert.equal(object.position.y, 0);
  assert.equal(object.position.x, 0.4);
  assert.equal(object.position.z, 0.1);
  assert.match(sceneRuntimeSource, /Math\.max\(CALIBRATED_FLOOR_PLANE_Y, transform\.position\.y\)/);
});

test("Y bound is the infinite calibrated floor plane, not the cyan Floor quad", () => {
  assert.doesNotMatch(
    sceneLayerSource,
    /sourceNormalizedPolygon|isPointInsidePolygon|floorPolygon/,
  );
  assert.doesNotMatch(
    interactionSource,
    /sourceNormalizedPolygon|isPointInsidePolygon|floorPolygon|worldWidthM/,
  );
  assert.doesNotMatch(
    viewerSource,
    /sourceNormalizedPolygon|isPointInsidePolygon/,
  );
  assert.match(sceneLayerSource, /CALIBRATED_FLOOR_PLANE_Y/);
  assert.doesNotMatch(
    sceneLayerSource,
    /wall collision|floor boundary collision|support surfaces|sliding|corner collision/i,
  );
});

test("Reset Transform restores the recorded initial transform without deselecting", () => {
  let state = addTestCube(createInitialSceneLayerState());
  const id = state.selectedObjectId!;
  assert.deepEqual(state.objects[0]?.initialTransform, DEFAULT_WORLD_TRANSFORM);
  state = updateSelectedPositionAxis(state, "x", 1.5);
  state = updateSelectedPositionAxis(state, "y", 0.8);
  state = updateSelectedPositionAxis(state, "z", -1);
  state = updateSelectedRotationAxis(state, "y", 45);
  state = updateSelectedUniformScale(state, 2);
  state = resetSceneObjectTransform(state);
  const selected = getSelectedSceneObject(state);
  assert.equal(state.selectedObjectId, id);
  assert.deepEqual(selected?.transform, DEFAULT_WORLD_TRANSFORM);
  assert.deepEqual(selected?.initialTransform, DEFAULT_WORLD_TRANSFORM);

  const placement = new THREE.Group();
  applyWorldTransform(placement, selected!.transform);
  const importPlacement = new THREE.Group();
  const target = transformControlsAttachmentTarget({
    placement,
    importPlacement,
  });
  assert.equal(target, placement);
  assert.match(roomLabSource, /Reset Transform/);
  assert.match(roomLabSource, /handleResetSelectedTransform/);
  assert.match(roomLabSource, /applyCollisionAwareTransform/);
  assert.match(roomLabSource, /selected\.initialTransform/);
  assert.doesNotMatch(
    roomLabSource.slice(
      roomLabSource.indexOf("handleResetSelectedTransform"),
      roomLabSource.indexOf("handleDeleteSelectedObject"),
    ),
    /analyzeAndApply|setApplied|observeRetainedEmptyRoom|selectedObjectId: null/,
  );

  let glbState = addGlbModel(createInitialSceneLayerState(), {
    objectUrl: "blob:reset-glb",
    fileName: "chair.glb",
  });
  const glbId = glbState.selectedObjectId;
  const glbUrl = glbState.objects[0]?.objectUrl;
  glbState = updateSelectedPositionAxis(glbState, "x", -0.8);
  glbState = updateSelectedUniformScale(glbState, 1.7);
  glbState = resetSceneObjectTransform(glbState);
  assert.equal(glbState.selectedObjectId, glbId);
  assert.equal(glbState.objects[0]?.objectUrl, glbUrl);
  assert.deepEqual(glbState.objects[0]?.transform, DEFAULT_WORLD_TRANSFORM);
});

test("Delete Object removes only the selected cube and clears selection", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addTestCube(state);
  const firstId = state.objects[0]!.id;
  const secondId = state.objects[1]!.id;
  state = selectSceneObject(state, secondId);
  state = deleteSelectedSceneObject(state);
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0]?.id, firstId);
  assert.equal(state.selectedObjectId, null);
  assert.match(roomLabSource, /Delete Object/);
  assert.match(viewerSource, /if \(controls\.object === entry\.placement\) controls\.detach\(\)/);
  assert.match(viewerSource, /disposeObject3D\(entry\.placement\)/);
});

test("deleting a GLB drops its blob URL from scene state and does not revoke other URLs", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addGlbModel(state, { objectUrl: "blob:chair-a", fileName: "chair.glb" });
  state = addGlbModel(state, { objectUrl: "blob:lamp-b", fileName: "lamp.glb" });
  const cubeId = state.objects[0]!.id;
  const chair = state.objects[1]!;
  const lamp = state.objects[2]!;
  assert.equal(blobUrlOwnedSolelyByObject(state, chair), "blob:chair-a");
  assert.equal(blobUrlOwnedSolelyByObject(state, state.objects[0]!), null);
  assert.deepEqual(sceneObjectBlobUrls(state), ["blob:chair-a", "blob:lamp-b"]);

  state = selectSceneObject(state, chair.id);
  const urlToRevoke = blobUrlOwnedSolelyByObject(state, chair);
  state = deleteSceneObject(state, chair.id);
  assert.equal(urlToRevoke, "blob:chair-a");
  assert.deepEqual(sceneObjectBlobUrls(state), ["blob:lamp-b"]);
  assert.equal(state.objects.map((object) => object.id).join(","), `${cubeId},${lamp.id}`);
  assert.equal(state.selectedObjectId, null);
  assert.match(roomLabSource, /blobUrlOwnedSolelyByObject\(current, selected\)/);
  assert.match(roomLabSource, /URL\.revokeObjectURL\(urlToRevoke\)/);
  assert.match(roomLabSource, /sceneLayerRef\.current = next/);
  assert.doesNotMatch(viewerSource, /revokeObjectURL|createObjectURL/);
});

test("deleting object B from A/B/C leaves A and C transforms unchanged", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addGlbModel(state, { objectUrl: "blob:b", fileName: "b.glb" });
  state = addTestCube(state);
  const [objectA, objectB, objectC] = state.objects;
  state = selectSceneObject(state, objectA!.id);
  state = updateSelectedPositionAxis(state, "x", 1.1);
  state = selectSceneObject(state, objectC!.id);
  state = updateSelectedRotationAxis(state, "y", 20);
  state = updateSelectedUniformScale(state, 1.4);
  state = selectSceneObject(state, objectB!.id);
  state = deleteSelectedSceneObject(state);

  assert.equal(state.objects.length, 2);
  assert.equal(state.objects[0]?.id, objectA!.id);
  assert.equal(state.objects[1]?.id, objectC!.id);
  assert.equal(state.objects[0]?.transform.position.x, 1.1);
  assert.equal(state.objects[1]?.transform.rotationDeg.y, 20);
  assert.equal(state.objects[1]?.transform.uniformScale, 1.4);
  assert.equal(state.selectedObjectId, null);
});

test("Reset, Delete, and Y bound do not couple to camera, Floor, or EMPTY observation", () => {
  for (const source of [sceneLayerSource, sceneRuntimeSource, interactionSource, viewerSource]) {
    assert.doesNotMatch(source, /analyzeAndApply|executeAfcV2Analysis|observeRetainedEmptyRoom/);
    assert.doesNotMatch(source, /setApplied|setPipeline|freezeReceipt|originalBasisRestored/);
    assert.doesNotMatch(source, /FULLY_TILED|OrbitControls/);
  }
  assert.doesNotMatch(
    viewerSource,
    /result\.camera\.(fov|aspect|position|up)\s*=/,
  );
  assert.doesNotMatch(
    roomLabSource.slice(
      roomLabSource.indexOf("handleDeleteSelectedObject"),
      roomLabSource.indexOf("handleGlbFile"),
    ),
    /analyzeAndApply|setApplied|setPipeline|observeRetainedEmptyRoom/,
  );
});

function tagAndPlace(
  placement: THREE.Object3D,
  id: string,
  position: Readonly<{ x: number; y: number; z: number }>,
): void {
  placement.userData.sceneObjectId = id;
  placement.position.set(position.x, position.y, position.z);
}
