import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";

import RoomLabV2 from "./RoomLabV2";
import { REPRESENTATION_KINDS } from "./representation-state";
import {
  DEFAULT_VIEWPORT_TRANSFORM_MODE,
  addGlbModel,
  addTestCube,
  applyObjectWorldTransform,
  createInitialSceneLayerState,
  selectSceneObject,
  setViewportTransformMode,
} from "./scene-layer-state";
import {
  applyWorldTransform,
  createSceneObjectRoot,
} from "./scene-object-runtime";
import {
  deriveUniformScaleFromAxes,
  objectMatchesWorldTransform,
  pickSceneObjectId,
  pointerEventToNdc,
  resolveSceneObjectId,
  shouldSuppressSceneSelection,
  tagSceneObjectRoot,
  transformControlsAttachmentTarget,
  viewportModeToControlsMode,
  worldTransformFromObject3D,
} from "./scene-viewport-interaction";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const viewerSource = read("CalibratedRoomViewer.tsx");
const roomLabSource = read("RoomLabV2.tsx");
const interactionSource = read("scene-viewport-interaction.ts");
const overlaySource = read("RoomEvidenceOverlay.tsx");

test("raycast hit selects the tagged SceneObject, including nested GLB meshes", () => {
  const root = createSceneObjectRoot();
  tagSceneObjectRoot(root.placement, "glb-1");
  const nested = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  root.autoBounds.add(nested);
  assert.equal(resolveSceneObjectId(nested), "glb-1");
  assert.equal(
    pickSceneObjectId([{ object: nested }]),
    "glb-1",
  );
  nested.geometry.dispose();
});

test("empty intersects deselect and a second object replaces the first", () => {
  assert.equal(pickSceneObjectId([]), null);
  let state = addTestCube(createInitialSceneLayerState());
  state = addGlbModel(state, { objectUrl: "blob:b", fileName: "b.glb" });
  const cubeId = state.objects[0]!.id;
  const glbId = state.objects[1]!.id;
  assert.equal(state.selectedObjectId, glbId);
  state = selectSceneObject(state, cubeId);
  assert.equal(state.selectedObjectId, cubeId);
  state = selectSceneObject(state, glbId);
  assert.equal(state.selectedObjectId, glbId);
  state = selectSceneObject(state, null);
  assert.equal(state.selectedObjectId, null);
  assert.equal(state.objects.length, 2);
});

test("TransformControls attachment target is the placement group, not autoBounds or camera", () => {
  const root = createSceneObjectRoot();
  const target = transformControlsAttachmentTarget(root);
  assert.equal(target, root.placement);
  assert.notEqual(target, root.autoBounds);
  assert.match(viewerSource, /controls\.attach\(target\)/);
  assert.match(viewerSource, /transformControlsAttachmentTarget\(entry\)/);
  assert.doesNotMatch(viewerSource, /attach\(entry\.autoBounds\)/);
  assert.doesNotMatch(viewerSource, /controls\.attach\(result\.camera\)/);
  assert.doesNotMatch(interactionSource, /PerspectiveCamera/);
});

test("gizmo translation and rotation write only the addressed object into SceneLayerState", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = addTestCube(state);
  const firstId = state.objects[0]!.id;
  const secondId = state.objects[1]!.id;
  state = applyObjectWorldTransform(state, firstId, {
    position: { x: 1.2, y: 0.4, z: -0.8 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  });
  state = applyObjectWorldTransform(state, secondId, {
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 10, y: -20, z: 5 },
    uniformScale: 1,
  });
  const first = state.objects.find((object) => object.id === firstId);
  const second = state.objects.find((object) => object.id === secondId);
  assert.deepEqual(first?.transform.position, { x: 1.2, y: 0.4, z: -0.8 });
  assert.deepEqual(first?.transform.rotationDeg, { x: 0, y: 0, z: 0 });
  assert.deepEqual(second?.transform.rotationDeg, { x: 10, y: -20, z: 5 });
  assert.deepEqual(second?.transform.position, { x: 0, y: 0, z: 0 });
  assert.match(interactionSource, /SCENE_ROTATION_EULER_ORDER/);
});

test("single-axis gizmo scale is persisted as uniform scale on the object and in state", () => {
  assert.equal(deriveUniformScaleFromAxes({ x: 1.5, y: 1, z: 1 }, 1), 1.5);
  assert.equal(deriveUniformScaleFromAxes({ x: 1, y: 2, z: 1 }, 1), 2);
  assert.equal(deriveUniformScaleFromAxes({ x: 1.2, y: 1.2, z: 1.2 }, 1), 1.2);
  const object = new THREE.Group();
  object.scale.set(1.5, 1, 1);
  const uniform = deriveUniformScaleFromAxes(object.scale, 1);
  object.scale.setScalar(uniform);
  let state = addTestCube(createInitialSceneLayerState());
  const id = state.selectedObjectId!;
  state = applyObjectWorldTransform(state, id, {
    ...state.objects[0]!.transform,
    uniformScale: uniform,
  });
  applyWorldTransform(object, state.objects[0]!.transform);
  assert.equal(state.objects[0]?.transform.uniformScale, 1.5);
  assert.deepEqual(object.scale.toArray(), [1.5, 1.5, 1.5]);
  assert.equal(objectMatchesWorldTransform(object, state.objects[0]!.transform), true);
});

test("raycast selection is suppressed while the gizmo is dragging", () => {
  assert.equal(
    shouldSuppressSceneSelection({
      gizmoDragging: true,
      pointerDownOnGizmo: false,
      pointerMovementPx: 0,
    }),
    true,
  );
  assert.equal(
    shouldSuppressSceneSelection({
      gizmoDragging: false,
      pointerDownOnGizmo: true,
      pointerMovementPx: 0,
    }),
    true,
  );
  assert.equal(
    shouldSuppressSceneSelection({
      gizmoDragging: false,
      pointerDownOnGizmo: false,
      pointerMovementPx: 12,
    }),
    true,
  );
  assert.equal(
    shouldSuppressSceneSelection({
      gizmoDragging: false,
      pointerDownOnGizmo: false,
      pointerMovementPx: 0,
    }),
    false,
  );
  assert.match(viewerSource, /dragging-changed/);
  assert.doesNotMatch(viewerSource, /OrbitControls/);
  assert.doesNotMatch(viewerSource, /result\.camera\.(fov|aspect|position|up)\s*=/);
});

test("viewport NDC mapping and mode mapping stay in the frozen-camera pick path", () => {
  assert.deepEqual(
    pointerEventToNdc(50, 25, { left: 0, top: 0, width: 100, height: 100 }),
    { x: 0, y: 0.5 },
  );
  assert.equal(viewportModeToControlsMode("move"), "translate");
  assert.equal(viewportModeToControlsMode("rotate"), "rotate");
  assert.equal(viewportModeToControlsMode("scale"), "scale");
  assert.equal(DEFAULT_VIEWPORT_TRANSFORM_MODE, "move");
  assert.match(viewerSource, /raycaster\.setFromCamera\(pointerNdc, result\.camera\)/);
  assert.match(viewerSource, /intersectObject\(objectLayer, true\)/);
});

test("world transform round-trip preserves XYZ euler and skips redundant writes", () => {
  const object = new THREE.Group();
  const transform = {
    position: { x: 0.3, y: 0.2, z: 1.1 },
    rotationDeg: { x: 12, y: -40, z: 8 },
    uniformScale: 1.25,
  };
  applyWorldTransform(object, transform);
  const readBack = worldTransformFromObject3D(object);
  assert.ok(Math.abs(readBack.position.x - 0.3) < 1e-6);
  assert.ok(Math.abs(readBack.rotationDeg.y + 40) < 1e-4);
  assert.equal(object.rotation.order, "XYZ");
  assert.equal(objectMatchesWorldTransform(object, transform), true);
});

test("GLB blob URLs remain owned by scene state, not TransformControls mount", () => {
  const state = addGlbModel(createInitialSceneLayerState(), {
    objectUrl: "blob:v2-s3e-glb",
    fileName: "chair.glb",
  });
  assert.equal(state.objects[0]?.objectUrl, "blob:v2-s3e-glb");
  assert.match(roomLabSource, /URL\.createObjectURL/);
  assert.match(roomLabSource, /URL\.revokeObjectURL/);
  assert.doesNotMatch(viewerSource, /revokeObjectURL|createObjectURL/);
  assert.match(viewerSource, /loadGlbFromUrl\(objectUrl\)/);
});

test("Floor quad toggle and EMPTY observation stay decoupled from viewport picking", () => {
  assert.match(viewerSource, /floorSurface\.visible = showFloorQuadRef\.current/);
  assert.match(viewerSource, /intersectObject\(objectLayer, true\)/);
  assert.doesNotMatch(interactionSource, /sourceNormalizedPolygon|roomObservation/);
  assert.doesNotMatch(viewerSource, /analyzeAndApply|setApplied|observeRetainedEmptyRoom/);
  assert.match(overlaySource, /pointer-events-none/);
  assert.deepEqual(REPRESENTATION_KINDS, ["ORIGINAL", "EMPTY", "TILED"]);
  assert.doesNotMatch(viewerSource, /FULLY_TILED|OrbitControls/);
  const markup = renderToStaticMarkup(createElement(RoomLabV2));
  assert.match(markup, />Move</);
  assert.match(markup, />Rotate</);
  assert.match(markup, />Scale</);
});

test("viewport transform mode is independent of selected-object identity", () => {
  let state = addTestCube(createInitialSceneLayerState());
  assert.equal(state.transformMode, "move");
  state = setViewportTransformMode(state, "rotate");
  assert.equal(state.transformMode, "rotate");
  assert.equal(state.selectedObjectId, state.objects[0]?.id);
  state = setViewportTransformMode(state, "scale");
  state = selectSceneObject(state, null);
  assert.equal(state.transformMode, "scale");
  assert.equal(state.selectedObjectId, null);
});
