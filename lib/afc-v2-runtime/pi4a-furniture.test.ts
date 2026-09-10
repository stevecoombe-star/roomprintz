import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolveSceneObjectCollision } from "./collision-resolver";
import { parseFurnitureGlb, loadFurnitureGlb } from "./furniture-glb-loader";
import {
  PI4A_FURNITURE_LOADING_MESSAGE,
  PI4A_SOFA_PLACEMENT_LOCAL_AABB,
  createPi4aFurnitureObjectFromAuthority,
  furnitureBelongsToGeneration,
  pi4aFurnitureGlbPublicPath,
} from "./furniture-runtime";
import {
  canonicalizeObjectWorldTransform,
  realizeObjectWorldTransform,
} from "./metric-world-realization";
import { computeImportPlacement } from "./object-import-bounds";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  localAabbDimensions,
  measurePlacementLocalAabb,
  worldMinY,
} from "./object-runtime";
import {
  createPi4aSofaObject3D,
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "./pi4a-sofa-geometry";
import { createPi3aAuthority, PI3A_ROOM_ID, PI3A_RIGHT_WALL } from "./pi3a-test-fixture";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_FURNITURE_OBJECT_ID,
  DEFAULT_WORLD_TRANSFORM,
  type RuntimeCollisionWall,
  type WorldTransform,
} from "./types";
import { viewportModeToControlsMode } from "./viewport-interaction";

const ROOT = process.cwd();
const GLB_REPO_PATH = path.join(
  ROOT,
  "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb",
);
const DIMENSION_TOLERANCE_M = 1e-3;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayBufferFromFile(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

function assertAuthoredSize(
  size: Readonly<{ width: number; height: number; depth: number }>,
  label: string,
): void {
  assert.ok(
    Math.abs(size.width - PI4A_SOFA_AUTHORED_WIDTH_M) < DIMENSION_TOLERANCE_M,
    `${label} width ${size.width}`,
  );
  assert.ok(
    Math.abs(size.height - PI4A_SOFA_AUTHORED_HEIGHT_M) < DIMENSION_TOLERANCE_M,
    `${label} height ${size.height}`,
  );
  assert.ok(
    Math.abs(size.depth - PI4A_SOFA_AUTHORED_DEPTH_M) < DIMENSION_TOLERANCE_M,
    `${label} depth ${size.depth}`,
  );
}

function transformAt(
  x: number,
  z = 0,
  y = 0,
  rotationY = 0,
): WorldTransform {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y, z },
    rotationDeg: { x: 0, y: rotationY, z: 0 },
  };
}

const FAR_RIGHT_WALL: RuntimeCollisionWall = Object.freeze({
  ...PI3A_RIGHT_WALL,
  id: "rb_right_far",
  sourceBoundaryId: "rb_right_far",
  a: Object.freeze({ x: 3, z: -4 }),
  b: Object.freeze({ x: 3, z: 4 }),
  supportPlaneConstant: -3,
});

test("PI-4A furniture identity is canonical AFC-world, not image-space", () => {
  const authority = createPi3aAuthority();
  const object = createPi4aFurnitureObjectFromAuthority(PI3A_ROOM_ID, authority);
  assert.equal(object.roomId, PI3A_ROOM_ID);
  assert.equal(object.generationId, authority.generationId);
  assert.equal(object.objectId, AFC_V2_RUNTIME_FURNITURE_OBJECT_ID);
  assert.equal(object.assetIdentity.kind, "test_furniture_glb");
  assert.equal(object.assetIdentity.id, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(object.coordinateSpace, AFC_V2_RUNTIME_COORDINATE_SPACE);
  assert.equal(object.transform.uniformScale, 1);
  assert.deepEqual(object.transform, DEFAULT_WORLD_TRANSFORM);
  assert.equal("xNorm" in object, false);
  assert.equal("versionId" in object, false);
  assert.ok(furnitureBelongsToGeneration(object, authority.generationId));
  assert.equal(pi4aFurnitureGlbPublicPath(), AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH);
});

test("PI-4A sofa import uses authored scale with no fit-to-room normalization", () => {
  const sofa = createPi4aSofaObject3D();
  const placementInfo = computeImportPlacement(sofa);
  assert.equal(placementInfo.ok, true);
  assert.equal(placementInfo.scale, 1);
  assertAuthoredSize(
    {
      width: placementInfo.measuredSize.x,
      height: placementInfo.measuredSize.y,
      depth: placementInfo.measuredSize.z,
    },
    "authored sofa",
  );

  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, sofa);
  assert.deepEqual(root.importPlacement.scale.toArray(), [1, 1, 1]);
  assert.equal(root.placement.scale.x, 1);

  const loader = source("lib/afc-v2-runtime/furniture-glb-loader.ts");
  const importBounds = source("lib/afc-v2-runtime/object-import-bounds.ts");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const geometry = source("lib/afc-v2-runtime/pi4a-sofa-geometry.ts");
  for (const text of [loader, importBounds, viewer, geometry]) {
    assert.doesNotMatch(text, /fit-to-1\.5|fitToRoom|userWorldScale|DEFAULT_PX_PER_IN|autoBounds/);
  }
  assert.doesNotMatch(geometry, /\.scale\.set/);
  assert.match(importBounds, /const scale = 1/);
});

test("PI-4A sofa grounds to local minY ≈ 0 without changing AFC Floor", () => {
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createPi4aSofaObject3D());
  applyWorldTransform(root.placement, DEFAULT_WORLD_TRANSFORM);
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);
  assert.ok(Math.abs(aabb.min.y) < DIMENSION_TOLERANCE_M);
  assertAuthoredSize(localAabbDimensions(aabb), "grounded sofa");
  assert.ok(Math.abs(aabb.min.x + PI4A_SOFA_AUTHORED_WIDTH_M / 2) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(aabb.max.x - PI4A_SOFA_AUTHORED_WIDTH_M / 2) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(aabb.min.z + PI4A_SOFA_AUTHORED_DEPTH_M / 2) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(aabb.max.z - PI4A_SOFA_AUTHORED_DEPTH_M / 2) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(aabb.max.y - PI4A_SOFA_AUTHORED_HEIGHT_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(worldMinY(root.placement)) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(aabb.min.x - PI4A_SOFA_PLACEMENT_LOCAL_AABB.min.x) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(aabb.max.y - PI4A_SOFA_PLACEMENT_LOCAL_AABB.max.y) < DIMENSION_TOLERANCE_M);
});

test("PI-4A GLB fixture measures to the authored sofa dimensions", async () => {
  const loaded = await parseFurnitureGlb(arrayBufferFromFile(GLB_REPO_PATH));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;

  const placementInfo = computeImportPlacement(loaded.scene);
  assert.equal(placementInfo.ok, true);
  assert.equal(placementInfo.scale, 1);
  assertAuthoredSize(
    {
      width: placementInfo.measuredSize.x,
      height: placementInfo.measuredSize.y,
      depth: placementInfo.measuredSize.z,
    },
    "parsed GLB",
  );

  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, loaded.scene);
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);
  assert.ok(Math.abs(aabb.min.y) < DIMENSION_TOLERANCE_M);
  assertAuthoredSize(localAabbDimensions(aabb), "parsed GLB grounded");
  assert.deepEqual(root.importPlacement.scale.toArray(), [1, 1, 1]);
});

test("PI-4A furniture uses certified metric realization and keeps authored uniformScale 1", () => {
  const authority = createPi3aAuthority({ metricScale: 1.7 });
  const object = createPi4aFurnitureObjectFromAuthority(PI3A_ROOM_ID, authority);
  const moved = {
    ...object.transform,
    position: { x: 0.4, y: 0, z: -0.2 },
  };
  const realized = realizeObjectWorldTransform(moved, 1.7);
  assert.equal(realized.uniformScale, 1);
  assert.equal(realized.position.y, 0);
  assert.ok(Math.abs(realized.position.x - 0.4 * 1.7) < 1e-12);
  assert.ok(Math.abs(realized.position.z - -0.2 * 1.7) < 1e-12);
  const canonical = canonicalizeObjectWorldTransform(realized, 1.7);
  assert.deepEqual(canonical.position, moved.position);
  assert.equal(canonical.uniformScale, 1);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(viewer, /realizeObjectWorldTransform/);
  assert.match(viewer, /canonicalizeObjectWorldTransform/);
  assert.match(viewer, /furniture\.transform/);
  assert.match(viewer, /uniformScale: 1/);
});

test("PI-4A sofa AABB participates in Move and Rotate collision", () => {
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createPi4aSofaObject3D());
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);

  const move = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: transformAt(10),
    localAabb: aabb,
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  assert.equal(move.status, "stopped_at_contact");
  assert.ok(Math.abs(move.transform.position.x - 1.9) < 1e-6);
  assert.equal(move.transform.uniformScale, 1);

  const clearRotate = resolveSceneObjectCollision({
    current: transformAt(0),
    proposed: transformAt(0, 0, 0, 90),
    localAabb: aabb,
    walls: [FAR_RIGHT_WALL],
    mode: "pose",
  });
  assert.equal(clearRotate.status, "accepted");
  assert.equal(clearRotate.transform.rotationDeg.y, 90);

  const rejectedRotate = resolveSceneObjectCollision({
    current: transformAt(0.4, 0, 0, 90),
    proposed: transformAt(0.4, 0, 0, 0),
    localAabb: aabb,
    walls: [PI3A_RIGHT_WALL],
    mode: "pose",
  });
  assert.equal(rejectedRotate.status, "rejected_pose");
  assert.equal(rejectedRotate.transform.rotationDeg.y, 90);
  assert.equal(rejectedRotate.transform.position.x, 0.4);
});

test("PI-4A runtime cannot enter Scale mode", () => {
  assert.equal(viewportModeToControlsMode("move"), "translate");
  assert.equal(viewportModeToControlsMode("rotate"), "rotate");
  assert.notEqual(viewportModeToControlsMode("move"), "scale");
  assert.notEqual(viewportModeToControlsMode("rotate"), "scale");

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const panel = source("components/afc-3d/Editor3dModePanel.tsx");
  assert.match(viewer, /if \(controls\.getMode\(\) === "scale"\) controls\.setMode\("translate"\)/);
  assert.doesNotMatch(viewer, />Scale</);
  assert.doesNotMatch(panel, />Scale</);
  assert.match(panel, /aria-pressed=\{transformMode === "move"\}/);
  assert.match(panel, /aria-pressed=\{transformMode === "rotate"\}/);
});

test("PI-4A History image changes do not remount furniture during the 3D session", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(
    viewer,
    /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/,
  );
  assert.match(
    viewer,
    /\}, \[authority\.generationId, furniture\.objectId, furniture\.transform, world\]\);/,
  );
  assert.doesNotMatch(
    viewer,
    /\[authority\.generationId, furniture\.objectId, furniture\.transform, world, visualImageUrl\]/,
  );
  assert.doesNotMatch(viewer, /key=\{[^}]*visualImageUrl/);
  assert.doesNotMatch(viewer, /key=\{[^}]*backgroundImageUrl/);
  assert.doesNotMatch(viewer, /selectedVersionId/);
  assert.doesNotMatch(viewer, /activeAssetId/);
  assert.match(viewer, /loadFurnitureGlb\(pi4aFurnitureGlbPublicPath\(\)\)/);
  assert.doesNotMatch(viewer, /createOneMetreCubeMesh/);
});

test("PI-4A preserves AFC authority and does not persist the scene", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const loader = source("lib/afc-v2-runtime/furniture-glb-loader.ts");
  const furniture = source("lib/afc-v2-runtime/furniture-runtime.ts");
  for (const text of [viewer, loader, furniture]) {
    assert.doesNotMatch(text, /app\/admin\/3d-room-lab-v2/);
    assert.doesNotMatch(text, /executeAfcV2Analysis/);
    assert.doesNotMatch(text, /userWorldScale/);
    assert.doesNotMatch(text, /DEFAULT_PX_PER_IN/);
    assert.doesNotMatch(text, /OrbitControls/);
    assert.doesNotMatch(text, /collisionV1/);
    assert.doesNotMatch(text, /create table/i);
    assert.doesNotMatch(text, /from\("afc_.*scene/);
    assert.doesNotMatch(text, /version inheritance|parentScene|scene snapshot/i);
  }
  assert.match(viewer, /realizeProductionWorld\(authority\)/);
  assert.match(viewer, /world\.collisionWalls/);
  assert.match(viewer, /resolveSceneObjectCollision/);
  assert.match(viewer, /measurePlacementLocalAabb/);
  assert.equal(PI4A_FURNITURE_LOADING_MESSAGE, "Loading furniture…");
  assert.match(viewer, /PI4A_FURNITURE_LOADING_MESSAGE/);
  assert.doesNotMatch(viewer, /GLTFLoader|network decoder|AABB/);
  assert.doesNotMatch(viewer, />Furniture<|>Products<|>Delete<|>Duplicate</);
});

test("PI-4A loader fails closed without throwing and does not require a URL to throw", async () => {
  const empty = await loadFurnitureGlb("   ");
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.equal(empty.message, "Furniture asset path is empty.");

  const invalid = await parseFurnitureGlb(new ArrayBuffer(8));
  assert.equal(invalid.ok, false);
});
