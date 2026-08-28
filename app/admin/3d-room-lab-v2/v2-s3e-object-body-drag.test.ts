import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import * as THREE from "three";

import {
  DEFAULT_WORLD_TRANSFORM,
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
import { applyWorldTransform } from "./scene-object-runtime";
import {
  SCENE_SELECTION_POINTER_SLOP_PX,
  applyPlacementWorldPosition,
  bodyDragGrabOffset,
  intersectRayWithHorizontalPlane,
  objectBodyDragWorldPosition,
  objectMatchesWorldTransform,
  parentWorldTransformIsIdentity,
  pointerEventToNdc,
  pointerRayAgainstHorizontalPlane,
  shouldActivateObjectBodyDrag,
  shouldBeginObjectBodyDrag,
  shouldSuppressSceneSelection,
  worldPositionXZ,
} from "./scene-viewport-interaction";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const viewerSource = read("CalibratedRoomViewer.tsx");
const interactionSource = read("scene-viewport-interaction.ts");
const sceneLayerSource = read("scene-layer-state.ts");
const roomLabSource = read("RoomLabV2.tsx");

function lookingDownCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.position.set(0, 5, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

test("pointerdown on an object starts a pending X-Z body drag past the click slop", () => {
  assert.equal(
    shouldBeginObjectBodyDrag({
      pointerDownOnGizmo: false,
      gizmoDragging: false,
      hitObjectId: "test-cube-1",
    }),
    true,
  );
  assert.equal(shouldActivateObjectBodyDrag(0), false);
  assert.equal(
    shouldActivateObjectBodyDrag(SCENE_SELECTION_POINTER_SLOP_PX),
    false,
  );
  assert.equal(
    shouldActivateObjectBodyDrag(SCENE_SELECTION_POINTER_SLOP_PX + 1),
    true,
  );
  assert.match(viewerSource, /shouldBeginObjectBodyDrag/);
  assert.match(viewerSource, /shouldActivateObjectBodyDrag/);
  assert.match(viewerSource, /objectBodyDragWorldPosition/);
});

test("body drag changes X and Z and leaves Y unchanged", () => {
  const grab = bodyDragGrabOffset({ x: 0.5, z: -0.25 }, { x: 0.25, z: 0.25 });
  assert.equal(grab.offsetX, 0.25);
  assert.equal(grab.offsetZ, -0.5);
  const next = objectBodyDragWorldPosition({
    hitX: 1.5,
    hitZ: 0.75,
    offsetX: grab.offsetX,
    offsetZ: grab.offsetZ,
    placementY: 0,
  });
  assert.equal(next.x, 1.25);
  assert.equal(next.z, 1.25);
  assert.equal(next.y, 0);

  let state = addTestCube(createInitialSceneLayerState());
  const id = state.selectedObjectId!;
  state = applyObjectWorldTransform(state, id, {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x: next.x, y: next.y, z: next.z },
  });
  const selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.x, 1.25);
  assert.equal(selected?.transform.position.z, 1.25);
  assert.equal(selected?.transform.position.y, 0);
  assert.deepEqual(selected?.transform.rotationDeg, { x: 0, y: 0, z: 0 });
  assert.equal(selected?.transform.uniformScale, 1);
});

test("lifted-object body drag keeps Y = 1.5", () => {
  const next = objectBodyDragWorldPosition({
    hitX: -0.5,
    hitZ: 2,
    offsetX: 0,
    offsetZ: 0,
    placementY: 1.5,
  });
  assert.equal(next.y, 1.5);
  assert.equal(next.x, -0.5);
  assert.equal(next.z, 2);

  const placement = new THREE.Group();
  applyWorldTransform(placement, {
    position: { x: 0, y: 1.5, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  });
  placement.position.set(next.x, next.y, next.z);
  assert.equal(placement.position.y, 1.5);

  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedPositionAxis(state, "y", 1.5);
  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    ...getSelectedSceneObject(state)!.transform,
    position: { x: next.x, y: 1.5, z: next.z },
  });
  assert.equal(getSelectedSceneObject(state)?.transform.position.y, 1.5);
  assert.equal(getSelectedSceneObject(state)?.transform.position.x, -0.5);
});

test("horizontal plane intersection is world Y, not screen-space delta", () => {
  const camera = lookingDownCamera();
  const originHit = pointerRayAgainstHorizontalPlane({
    clientX: 50,
    clientY: 50,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    camera,
    planeY: 0,
  });
  assert.ok(originHit);
  assert.ok(Math.abs(originHit!.x) < 1e-6);
  assert.ok(Math.abs(originHit!.z) < 1e-6);
  assert.equal(originHit!.y, 0);

  const lifted = pointerRayAgainstHorizontalPlane({
    clientX: 50,
    clientY: 50,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    camera,
    planeY: 1.5,
  });
  assert.ok(lifted);
  assert.equal(lifted!.y, 1.5);

  const ray = new THREE.Ray(
    new THREE.Vector3(0, 4, 0),
    new THREE.Vector3(0, -1, 0),
  );
  const planeHit = intersectRayWithHorizontalPlane(ray, 1.25);
  assert.deepEqual(planeHit, { x: 0, y: 1.25, z: 0 });
  assert.doesNotMatch(
    interactionSource,
    /sourceNormalizedPolygon|floorPolygon|roomObservation/,
  );
});

test("TransformControls axis or dragging prevents body drag and double transform", () => {
  assert.equal(
    shouldBeginObjectBodyDrag({
      pointerDownOnGizmo: true,
      gizmoDragging: false,
      hitObjectId: "cube-1",
    }),
    false,
  );
  assert.equal(
    shouldBeginObjectBodyDrag({
      pointerDownOnGizmo: false,
      gizmoDragging: true,
      hitObjectId: "cube-1",
    }),
    false,
  );
  assert.equal(
    shouldSuppressSceneSelection({
      gizmoDragging: false,
      pointerDownOnGizmo: false,
      pointerMovementPx: 0,
      bodyDragging: true,
    }),
    true,
  );
  assert.match(viewerSource, /pointerDownOnGizmo = controls\.axis !== null \|\| gizmoDragging/);
  assert.match(viewerSource, /if \(gizmoDragging\) \{[\s\S]*if \(bodyDrag\) endBodyDrag\(\)/);
  assert.match(viewerSource, /controls\.enabled = false/);
});

test("small pointer movement selects without changing the transform", () => {
  let state = addTestCube(createInitialSceneLayerState());
  const before = getSelectedSceneObject(state)!.transform;
  assert.equal(shouldActivateObjectBodyDrag(3), false);
  state = selectSceneObject(state, state.objects[0]!.id);
  assert.deepEqual(getSelectedSceneObject(state)?.transform, before);
  assert.match(viewerSource, /session\.active = true/);
  assert.match(viewerSource, /if \(!shouldActivateObjectBodyDrag\(movement\)\) return/);
});

test("only the dragged object moves in a multi-object scene", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addGlbModel(state, { objectUrl: "blob:chair", fileName: "chair.glb" });
  state = addTestCube(state);
  const [cubeA, chairB, cubeC] = state.objects;
  state = selectSceneObject(state, chairB!.id);
  const next = objectBodyDragWorldPosition({
    hitX: 0.8,
    hitZ: -1.2,
    offsetX: 0,
    offsetZ: 0,
    placementY: 0,
  });
  state = applyObjectWorldTransform(state, chairB!.id, {
    ...chairB!.transform,
    position: next,
  });
  assert.deepEqual(
    state.objects.find((object) => object.id === cubeA!.id)?.transform,
    cubeA!.transform,
  );
  assert.deepEqual(
    state.objects.find((object) => object.id === cubeC!.id)?.transform,
    cubeC!.transform,
  );
  assert.deepEqual(
    state.objects.find((object) => object.id === chairB!.id)?.transform.position,
    { x: 0.8, y: 0, z: -1.2 },
  );
});

test("Reset Transform restores a body-dragged object to its initial transform", () => {
  let state = addTestCube(createInitialSceneLayerState());
  const id = state.selectedObjectId!;
  state = applyObjectWorldTransform(state, id, {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x: 1.2, y: 0, z: -0.6 },
  });
  state = resetSceneObjectTransform(state);
  assert.equal(state.selectedObjectId, id);
  assert.deepEqual(getSelectedSceneObject(state)?.transform, DEFAULT_WORLD_TRANSFORM);
  assert.match(roomLabSource, /handleResetSelectedTransform/);
  assert.match(roomLabSource, /applyCollisionAwareTransform/);
  assert.match(roomLabSource, /selected\.initialTransform/);
});

test("Delete Object removes a body-dragged selection and clears drag on missing runtime", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addTestCube(state);
  const remainingId = state.objects[0]!.id;
  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x: 0.4, y: 0, z: 0.4 },
  });
  state = deleteSelectedSceneObject(state);
  assert.equal(state.selectedObjectId, null);
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0]?.id, remainingId);
  assert.match(viewerSource, /if \(bodyDrag && !runtime\.has\(bodyDrag\.objectId\)\)/);
  assert.match(viewerSource, /endBodyDrag\(\)/);
  assert.match(viewerSource, /setPointerCapture/);
  assert.match(viewerSource, /releasePointerCapture/);
  assert.match(viewerSource, /pointercancel/);
});

test("direct X-Z drag never writes Y and keeps the floor-plane invariant", () => {
  const below = objectBodyDragWorldPosition({
    hitX: 0.2,
    hitZ: 0.2,
    offsetX: 0,
    offsetZ: 0,
    placementY: 0,
  });
  assert.equal(below.y, 0);
  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x: 0.2, y: -1, z: 0.2 },
  });
  assert.equal(getSelectedSceneObject(state)?.transform.position.y, 0);
  assert.match(viewerSource, /applyPlacementWorldPosition\(entry\.placement,/);
  assert.match(viewerSource, /entry\.placement\.position\.y = session\.placementY/);
  assert.match(viewerSource, /entry\.placement\.position\.y = bodyDrag\.placementY/);
  assert.doesNotMatch(interactionSource, /sourceNormalizedPolygon/);
});

test("body drag does not couple to camera, Floor, or EMPTY observation", () => {
  for (const source of [viewerSource, interactionSource, sceneLayerSource]) {
    assert.doesNotMatch(source, /OrbitControls/);
    assert.doesNotMatch(source, /analyzeAndApply|observeRetainedEmptyRoom|setApplied/);
    assert.doesNotMatch(source, /FULLY_TILED/);
  }
  assert.doesNotMatch(
    viewerSource,
    /result\.camera\.(fov|aspect|position|up)\s*=/,
  );
  assert.match(
    viewerSource,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
  assert.doesNotMatch(
    interactionSource,
    /wall collision|floor boundary collision|support surfaces|sliding/i,
  );
});

test("absolute body-drag target is hit minus grab offset, not an accumulated delta", () => {
  const grab = bodyDragGrabOffset({ x: 1.2, z: 2.3 }, { x: 1, z: 2 });
  assert.ok(Math.abs(grab.offsetX - 0.2) < 1e-12);
  assert.ok(Math.abs(grab.offsetZ - 0.3) < 1e-12);
  const target = objectBodyDragWorldPosition({
    hitX: 2.2,
    hitZ: 3.3,
    offsetX: 0.2,
    offsetZ: 0.3,
    placementY: 0,
  });
  assert.ok(Math.abs(target.x - 2) < 1e-12);
  assert.ok(Math.abs(target.z - 3) < 1e-12);
  assert.equal(target.y, 0);
  const accumulatedWrongX = 1 + (2.2 - 1.2) + 0.2;
  const accumulatedWrongZ = 2 + (3.3 - 2.3) + 0.3;
  assert.ok(Math.abs(target.x - accumulatedWrongX) > 0.1);
  assert.ok(Math.abs(target.z - accumulatedWrongZ) > 0.1);
});

test("identical pointer-plane hits produce the same transform twice", () => {
  const first = objectBodyDragWorldPosition({
    hitX: 0.4,
    hitZ: -0.8,
    offsetX: 0.1,
    offsetZ: -0.2,
    placementY: 1.25,
  });
  const second = objectBodyDragWorldPosition({
    hitX: 0.4,
    hitZ: -0.8,
    offsetX: 0.1,
    offsetZ: -0.2,
    placementY: 1.25,
  });
  assert.deepEqual(first, second);
  assert.equal(first.y, 1.25);
});

test("runtime target matches SceneLayerState without a second displacement", () => {
  const placement = new THREE.Group();
  const target = objectBodyDragWorldPosition({
    hitX: 1.4,
    hitZ: -0.6,
    offsetX: 0.4,
    offsetZ: -0.1,
    placementY: 0,
  });
  applyPlacementWorldPosition(placement, target);
  let state = addTestCube(createInitialSceneLayerState());
  state = applyObjectWorldTransform(state, state.selectedObjectId!, {
    ...DEFAULT_WORLD_TRANSFORM,
    position: target,
  });
  applyWorldTransform(placement, state.objects[0]!.transform);
  assert.equal(objectMatchesWorldTransform(placement, state.objects[0]!.transform), true);
  assert.deepEqual(placement.position.toArray(), [target.x, target.y, target.z]);
});

test("NDC uses CSS canvas bounds, not a 2× backing-store width", () => {
  const cssRect = { left: 0, top: 0, width: 900, height: 600 };
  const backingStoreRect = { left: 0, top: 0, width: 1800, height: 1200 };
  const cssNdc = pointerEventToNdc(450, 300, cssRect);
  const doubledNdc = pointerEventToNdc(450, 300, backingStoreRect);
  assert.deepEqual(cssNdc, { x: 0, y: 0 });
  assert.ok(doubledNdc);
  assert.ok(Math.abs(doubledNdc!.x - (-0.5)) < 1e-12);
  assert.match(viewerSource, /renderer\.domElement\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(
    viewerSource,
    /domElement\.width|drawingBufferWidth|clientWidth \* devicePixelRatio/,
  );
});

test("placement parent is identity in the viewer; worldToLocal is used when it is not", () => {
  const scene = new THREE.Scene();
  const objectLayer = new THREE.Group();
  scene.add(objectLayer);
  const placement = new THREE.Group();
  objectLayer.add(placement);
  assert.equal(parentWorldTransformIsIdentity(placement), true);
  applyPlacementWorldPosition(placement, { x: 1.5, y: 0, z: -0.5 });
  assert.deepEqual(worldPositionXZ(placement), { x: 1.5, z: -0.5 });
  assert.deepEqual(placement.position.toArray(), [1.5, 0, -0.5]);

  const scaledParent = new THREE.Group();
  scaledParent.scale.set(2, 2, 2);
  scene.add(scaledParent);
  const child = new THREE.Group();
  scaledParent.add(child);
  assert.equal(parentWorldTransformIsIdentity(child), false);
  applyPlacementWorldPosition(child, { x: 2, y: 0, z: 4 });
  assert.deepEqual(child.position.toArray(), [1, 0, 2]);
  assert.deepEqual(worldPositionXZ(child), { x: 2, z: 4 });
  assert.match(viewerSource, /applyPlacementWorldPosition/);
  assert.match(viewerSource, /worldToLocal|applyPlacementWorldPosition/);
  assert.match(viewerSource, /objectLayer\.add\(created\.placement\)/);
});

test("a floor-height drag plane doubles XZ motion versus a grab-height plane", () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1.6, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const grabY = 0.8;
  const floorStart = pointerRayAgainstHorizontalPlane({
    clientX: 50,
    clientY: 50,
    rect,
    camera,
    planeY: 0,
  });
  const floorMoved = pointerRayAgainstHorizontalPlane({
    clientX: 60,
    clientY: 50,
    rect,
    camera,
    planeY: 0,
  });
  const grabStart = pointerRayAgainstHorizontalPlane({
    clientX: 50,
    clientY: 50,
    rect,
    camera,
    planeY: grabY,
  });
  const grabMoved = pointerRayAgainstHorizontalPlane({
    clientX: 60,
    clientY: 50,
    rect,
    camera,
    planeY: grabY,
  });
  assert.ok(floorStart && floorMoved && grabStart && grabMoved);
  const floorDelta = Math.hypot(
    floorMoved!.x - floorStart!.x,
    floorMoved!.z - floorStart!.z,
  );
  const grabDelta = Math.hypot(
    grabMoved!.x - grabStart!.x,
    grabMoved!.z - grabStart!.z,
  );
  assert.ok(grabDelta > 0);
  assert.ok(Math.abs(floorDelta / grabDelta - 2) < 0.15);
  assert.match(viewerSource, /grabPlaneY/);
  assert.match(viewerSource, /picked\?\.point/);
});
