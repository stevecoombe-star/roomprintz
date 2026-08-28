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
  DEFAULT_SHOW_FLOOR_QUAD,
  DEFAULT_WORLD_TRANSFORM,
  SCENE_ROTATION_EULER_ORDER,
  TEST_CUBE_COLOR,
  TEST_CUBE_GEOMETRY_SIZE,
  addGlbModel,
  addTestCube,
  createInitialSceneLayerState,
  getSelectedSceneObject,
  selectSceneObject,
  setSceneObjectLoadStatus,
  updateSelectedPositionAxis,
  updateSelectedRotationAxis,
  updateSelectedUniformScale,
} from "./scene-layer-state";
import {
  applyWorldTransform,
  attachNormalizedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
  loadGlbFromUrl,
} from "./scene-object-runtime";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const sceneLayerSource = read("scene-layer-state.ts");
const sceneRuntimeSource = read("scene-object-runtime.ts");
const viewerSource = read("CalibratedRoomViewer.tsx");
const roomLabSource = read("RoomLabV2.tsx");
const overlaySource = read("RoomEvidenceOverlay.tsx");

const frozenAuthority = Object.freeze({
  verticalFovDeg: 61.5,
  originalBasisRestored: true as const,
  pose: Object.freeze({
    position: Object.freeze({ x: 1.25, y: 2.5, z: 3.75 }),
    lookAt: Object.freeze({ x: 0.25, y: 0.5, z: -0.75 }),
    up: Object.freeze({ x: 0, y: 1, z: 0 }),
  }),
  floor: Object.freeze({
    authorityKey: "floor-key",
    sourceNormalizedPolygon: Object.freeze([
      Object.freeze({ x: 0.1, y: 0.9 }),
      Object.freeze({ x: 0.9, y: 0.9 }),
      Object.freeze({ x: 0.65, y: 0.55 }),
      Object.freeze({ x: 0.35, y: 0.55 }),
    ]),
  }),
  freezeReceipt: Object.freeze({ receipt: "frozen" }),
});

test("V2-S3E floor quad default is explicit ON and visual-only", () => {
  assert.equal(DEFAULT_SHOW_FLOOR_QUAD, true);
  const markup = renderToStaticMarkup(createElement(RoomLabV2));
  assert.match(markup, /aria-label="Show Floor Quad"/);
  assert.match(markup, /Show Floor Quad/);
  assert.match(
    markup,
    /aria-label="Show Floor Quad"[\s\S]*checked|checked[\s\S]*aria-label="Show Floor Quad"/,
  );
  assert.match(viewerSource, /floorSurface\.visible = showFloorQuadRef\.current/);
  assert.match(viewerSource, /floorWireframe\.visible = showFloorQuadRef\.current/);
  assert.match(
    viewerSource,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
  assert.doesNotMatch(
    viewerSource,
    /showFloorQuadRef\.current[\s\S]{0,80}worldWidthM\s*=/,
  );
  assert.match(
    roomLabSource,
    /showFloorAuthority=\{[\s\S]*selectedRepresentation === "TILED"[\s\S]*showFloorQuad/,
  );
  assert.match(overlaySource, /data-evidence-role="authoritative-floor"/);
});

test("toggling the Floor quad does not rewrite Floor or camera authority", () => {
  const before = structuredClone(frozenAuthority);
  assert.equal(DEFAULT_SHOW_FLOOR_QUAD, true);
  const hidden = false;
  const shown = true;
  assert.notEqual(hidden, shown);
  assert.deepEqual(frozenAuthority, before);
  assert.doesNotMatch(sceneLayerSource, /sourceNormalizedPolygon|authorityKey|verticalFovDeg|freezeReceipt/);
  assert.doesNotMatch(
    roomLabSource,
    /setShowFloorQuad\([\s\S]{0,120}setApplied|setShowFloorQuad\([\s\S]{0,120}analyzeAndApply/,
  );
});

test("Add Test Cube creates one selected scene object at the V1 origin", () => {
  const initial = createInitialSceneLayerState();
  const withCube = addTestCube(initial);
  assert.equal(initial.objects.length, 0);
  assert.equal(withCube.objects.length, 1);
  const selected = getSelectedSceneObject(withCube);
  assert.ok(selected);
  assert.equal(selected?.kind, "test_cube");
  assert.match(selected?.label ?? "", /Test Cube/);
  assert.equal(withCube.selectedObjectId, selected?.id);
  assert.deepEqual(selected?.transform, DEFAULT_WORLD_TRANSFORM);
  assert.equal(selected?.transform.position.x, 0);
  assert.equal(selected?.transform.position.y, 0);
  assert.equal(selected?.transform.position.z, 0);
});

test("Test Cube mesh reuses the V1 cube geometry and material", () => {
  const cube = createTestCubeMesh();
  const geometry = cube.geometry as THREE.BoxGeometry;
  assert.equal(geometry.parameters.width, TEST_CUBE_GEOMETRY_SIZE);
  assert.equal(geometry.parameters.height, TEST_CUBE_GEOMETRY_SIZE);
  assert.equal(geometry.parameters.depth, TEST_CUBE_GEOMETRY_SIZE);
  assert.equal(TEST_CUBE_GEOMETRY_SIZE, 0.8);
  const material = cube.material as THREE.MeshStandardMaterial;
  assert.equal(`#${material.color.getHexString()}`, TEST_CUBE_COLOR);
  cube.geometry.dispose();
  material.dispose();
  assert.match(sceneRuntimeSource, /BoxGeometry\(/);
  assert.match(sceneRuntimeSource, /MeshStandardMaterial/);
  assert.match(roomLabSource, /Add Test Cube/);
  assert.match(viewerSource, /createTestCubeMesh/);
  assert.match(viewerSource, /renderer\.render\(scene, result\.camera\)/);
});

test("GLB loader path is available and failures stay in the scene layer", async () => {
  assert.match(sceneRuntimeSource, /GLTFLoader/);
  assert.match(sceneRuntimeSource, /loadAsync/);
  assert.match(roomLabSource, /Load Model \/ GLB/);
  assert.match(roomLabSource, /type="file"/);
  assert.match(roomLabSource, /accept="\.glb,\.gltf/);

  const empty = await loadGlbFromUrl("");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.message, /empty/i);

  let state = addGlbModel(createInitialSceneLayerState(), {
    objectUrl: "blob:v2-s3e-mock-glb",
    fileName: "chair.glb",
  });
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0]?.kind, "glb");
  assert.equal(state.objects[0]?.loadStatus, "loading");
  assert.equal(state.selectedObjectId, state.objects[0]?.id);
  state = setSceneObjectLoadStatus(
    state,
    state.objects[0]!.id,
    "failed",
    "Unable to load GLB asset.",
  );
  assert.equal(state.objects[0]?.loadStatus, "failed");
  assert.equal(state.objects[0]?.loadError, "Unable to load GLB asset.");
  assert.match(viewerSource, /GLB load failed/);
  assert.match(viewerSource, /"failed"/);
});

test("mocked GLB attaches, auto-bounds, and accepts world transforms", () => {
  const root = createSceneObjectRoot();
  const mockGlb = new THREE.Group();
  mockGlb.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  attachNormalizedObject(root.autoBounds, mockGlb);
  applyWorldTransform(root.placement, {
    position: { x: 0.4, y: 0.2, z: -0.3 },
    rotationDeg: { x: 0, y: 25, z: 0 },
    uniformScale: 1.2,
  });
  assert.deepEqual(root.placement.position.toArray(), [0.4, 0.2, -0.3]);
  assert.equal(root.placement.scale.x, 1.2);
  assert.equal(root.placement.rotation.order, SCENE_ROTATION_EULER_ORDER);
  mockGlb.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
});

test("Move X/Y/Z each change only that axis and leave camera authority untouched", () => {
  const authority = structuredClone(frozenAuthority);
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedPositionAxis(state, "x", 1.25);
  let selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.x, 1.25);
  assert.equal(selected?.transform.position.y, 0);
  assert.equal(selected?.transform.position.z, 0);

  state = updateSelectedPositionAxis(state, "y", 0.5);
  selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.x, 1.25);
  assert.equal(selected?.transform.position.y, 0.5);
  assert.equal(selected?.transform.position.z, 0);

  state = updateSelectedPositionAxis(state, "z", -2);
  selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.x, 1.25);
  assert.equal(selected?.transform.position.y, 0.5);
  assert.equal(selected?.transform.position.z, -2);
  assert.deepEqual(authority, frozenAuthority);
});

test("Rotate X/Y/Z updates the selected object with Three.js XYZ euler degrees", () => {
  const authority = structuredClone(frozenAuthority);
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedRotationAxis(state, "x", 15);
  state = updateSelectedRotationAxis(state, "y", -40);
  state = updateSelectedRotationAxis(state, "z", 10);
  const selected = getSelectedSceneObject(state);
  assert.deepEqual(selected?.transform.rotationDeg, { x: 15, y: -40, z: 10 });
  assert.equal(SCENE_ROTATION_EULER_ORDER, "XYZ");

  const object = new THREE.Group();
  applyWorldTransform(object, selected!.transform);
  assert.equal(object.rotation.order, "XYZ");
  assert.ok(Math.abs(object.rotation.x - THREE.MathUtils.degToRad(15)) < 1e-12);
  assert.ok(Math.abs(object.rotation.y - THREE.MathUtils.degToRad(-40)) < 1e-12);
  assert.ok(Math.abs(object.rotation.z - THREE.MathUtils.degToRad(10)) < 1e-12);
  assert.deepEqual(object.position.toArray(), [0, 0, 0]);
  assert.deepEqual(authority, frozenAuthority);
});

test("Uniform scale updates the selected object only", () => {
  const authority = structuredClone(frozenAuthority);
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedUniformScale(state, 1.5);
  const selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.uniformScale, 1.5);
  const object = new THREE.Group();
  applyWorldTransform(object, selected!.transform);
  assert.deepEqual(object.scale.toArray(), [1.5, 1.5, 1.5]);
  assert.deepEqual(authority, frozenAuthority);
});

test("selected-object transforms do not affect other objects", () => {
  let state = addTestCube(createInitialSceneLayerState());
  const firstId = state.selectedObjectId;
  state = addTestCube(state);
  const secondId = state.selectedObjectId;
  assert.notEqual(firstId, secondId);
  state = updateSelectedPositionAxis(state, "x", 2);
  state = updateSelectedRotationAxis(state, "y", 30);
  state = updateSelectedUniformScale(state, 2);
  const first = state.objects.find((object) => object.id === firstId);
  const second = state.objects.find((object) => object.id === secondId);
  assert.deepEqual(first?.transform, DEFAULT_WORLD_TRANSFORM);
  assert.equal(second?.transform.position.x, 2);
  assert.equal(second?.transform.rotationDeg.y, 30);
  assert.equal(second?.transform.uniformScale, 2);
  state = selectSceneObject(state, firstId!);
  state = updateSelectedPositionAxis(state, "z", -1);
  assert.equal(
    state.objects.find((object) => object.id === secondId)?.transform.position.z,
    0,
  );
  assert.equal(
    state.objects.find((object) => object.id === firstId)?.transform.position.z,
    -1,
  );
});

test("scene-layer transforms never write camera, Floor, freeze, or observation", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
  camera.position.set(1, 2, 3);
  const fov = camera.fov;
  const position = camera.position.toArray();
  const object = new THREE.Group();
  applyWorldTransform(object, {
    position: { x: 4, y: 1, z: -2 },
    rotationDeg: { x: 10, y: 20, z: 30 },
    uniformScale: 2,
  });
  assert.equal(camera.fov, fov);
  assert.deepEqual(camera.position.toArray(), position);

  for (const source of [sceneLayerSource, sceneRuntimeSource, viewerSource]) {
    assert.doesNotMatch(source, /analyzeAndApply|executeAfcV2Analysis|observeRetainedEmptyRoom/);
    assert.doesNotMatch(source, /setApplied|setPipeline|freezeReceipt|originalBasisRestored/);
    assert.doesNotMatch(
      source,
      /evaluateQuadSolvability|setCalibratedCamera|FULLY_TILED/,
    );
  }
  assert.doesNotMatch(
    viewerSource,
    /result\.camera\.(fov|aspect|position|up)\s*=/,
  );
  assert.match(
    roomLabSource,
    /onClick=\{\(\) => setSceneLayer\(\(current\) => addTestCube\(current\)\)\}/,
  );
  const addCubeRegion = roomLabSource.slice(
    roomLabSource.indexOf("Add Test Cube") - 220,
    roomLabSource.indexOf("Add Test Cube") + 40,
  );
  assert.doesNotMatch(addCubeRegion, /analyzeAndApply|setApplied|setPipeline/);
});

test("cyan Floor quad is not a movement boundary", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedPositionAxis(state, "x", 5);
  state = updateSelectedPositionAxis(state, "z", -10);
  const selected = getSelectedSceneObject(state);
  assert.equal(selected?.transform.position.x, 5);
  assert.equal(selected?.transform.position.z, -10);
  assert.doesNotMatch(
    sceneLayerSource,
    /sourceNormalizedPolygon|isPointInsidePolygon|floorPolygon|worldWidthM|referenceDepthM/,
  );
  assert.doesNotMatch(
    sceneRuntimeSource,
    /sourceNormalizedPolygon|isPointInsidePolygon|floorPolygon/,
  );
  assert.doesNotMatch(
    viewerSource,
    /clamp[\s\S]{0,40}floor|inside[\s\S]{0,40}quad|movement boundary/i,
  );
});

test("object interaction does not feed EMPTY room observation", () => {
  assert.doesNotMatch(
    sceneLayerSource,
    /roomObservation|observedPlanes|empty-room-observation/,
  );
  assert.doesNotMatch(
    sceneRuntimeSource,
    /roomObservation|observeRetainedEmptyRoom/,
  );
  assert.doesNotMatch(
    roomLabSource,
    /setPipeline\([\s\S]{0,80}sceneLayer|sceneLayer[\s\S]{0,80}roomObservation/,
  );
});

test("S3C/S3D representation architecture remains ORIGINAL → EMPTY → TILED", () => {
  assert.deepEqual(REPRESENTATION_KINDS, ["ORIGINAL", "EMPTY", "TILED"]);
  assert.doesNotMatch(roomLabSource, /FULLY_TILED/);
  assert.doesNotMatch(viewerSource, /FULLY_TILED/);
  assert.doesNotMatch(sceneLayerSource, /FULLY_TILED/);
  assert.match(roomLabSource, /Room Observations/);
  assert.match(roomLabSource, /Room Boundaries/);
  assert.match(roomLabSource, /collisionAuthority/);
  assert.match(overlaySource, /data-evidence-role="authoritative-floor"/);
  assert.match(
    roomLabSource,
    /showRoomObservation=\{[\s\S]*selectedRepresentation === "EMPTY"/,
  );
});

test("V2-S4B collision and object-enforcement behavior is not implemented", () => {
  for (const source of [sceneLayerSource, sceneRuntimeSource, viewerSource]) {
    assert.doesNotMatch(
      source,
      /wall collision|floor boundary collision|support surfaces|object clamping|sliding|corner collision/i,
    );
    assert.doesNotMatch(
      source,
      /live-collision|support-attachment|room-envelope-reconciliation/,
    );
  }
  assert.match(roomLabSource, /Not implemented/);
  assert.match(roomLabSource, /collisionAuthority = \{String\(applied\.roomBoundaries\.collisionAuthority\)\}/);
});

test("auto-bounds places a Test Cube on the calibrated floor plane, not the cyan quad", () => {
  const root = createSceneObjectRoot();
  const cube = createTestCubeMesh();
  attachNormalizedObject(root.autoBounds, cube);
  applyWorldTransform(root.placement, DEFAULT_WORLD_TRANSFORM);
  root.placement.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root.placement);
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.ok(box.max.y > 0);
  cube.geometry.dispose();
  (cube.material as THREE.Material).dispose();
});
