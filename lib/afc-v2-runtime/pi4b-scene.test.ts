import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import {
  aabbCorners,
  applyWorldTransformToPoint,
} from "./collision-footprint";
import { resolveSceneObjectCollision } from "./collision-resolver";
import { furnitureAssetDefinition } from "./furniture-assets";
import { cloneFurnitureGlbScene, parseFurnitureGlb } from "./furniture-glb-loader";
import {
  PI4A_SOFA_PLACEMENT_LOCAL_AABB,
  PI4B_INITIAL_SELECTED_OBJECT_ID,
  PI4B_SOFA_A_OBJECT_ID,
  PI4B_SOFA_A_TRANSFORM,
  PI4B_SOFA_B_OBJECT_ID,
  PI4B_SOFA_B_TRANSFORM,
  createPi4bSceneObjectDefinitions,
  createPi4bSceneObjectsFromAuthority,
  createRuntimeSceneObjectsFromDefinitions,
} from "./furniture-runtime";
import {
  canonicalizeObjectWorldTransform,
  realizeObjectWorldTransform,
} from "./metric-world-realization";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  localAabbDimensions,
  measurePlacementLocalAabb,
} from "./object-runtime";
import {
  createPi4aSofaObject3D,
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "./pi4a-sofa-geometry";
import { createPi3aAuthority, PI3A_RIGHT_WALL, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import {
  attachTargetForSelectedObject,
  cloneWorldTransform,
  commitSceneObjectTransformById,
  createRuntimeSceneCollection,
  getLiveSceneObject,
  liveSceneObjectForBodyDrag,
  mountLiveRuntimeSceneObject,
  resolveLiveSceneObjectCollision,
  resolveSelectedObjectId,
  serializeRuntimeScene,
  setLiveSceneObject,
} from "./scene-runtime";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  DEFAULT_WORLD_TRANSFORM,
  type LocalAabb,
  type RuntimeCollisionWall,
  type WorldTransform,
} from "./types";

const ROOT = process.cwd();
const GLB_REPO_PATH = path.join(
  ROOT,
  "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb",
);
const AABB_INVARIANCE_TOLERANCE_M = 1e-6;
const WALL_CONTACT_TOLERANCE_M = 1e-6;
const PLUS_X_WALL_X = 3;
const YAW_INVARIANCE_DEG = [0, 18, 45, 90] as const;
const SOFA_HALF_WIDTH_M = PI4A_SOFA_AUTHORED_WIDTH_M / 2;
const SOFA_HALF_DEPTH_M = PI4A_SOFA_AUTHORED_DEPTH_M / 2;
const TINY_LOCAL_AABB: LocalAabb = Object.freeze({
  min: Object.freeze({ x: -0.1, y: 0, z: -0.1 }),
  max: Object.freeze({ x: 0.1, y: 0.2, z: 0.1 }),
});

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

function orientedHalfExtentX(yawDeg: number): number {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  return (
    Math.abs(SOFA_HALF_WIDTH_M * Math.cos(yaw)) +
    Math.abs(SOFA_HALF_DEPTH_M * Math.sin(yaw))
  );
}

function assertAabbClose(
  actual: LocalAabb,
  expected: LocalAabb,
  label: string,
  tolerance = AABB_INVARIANCE_TOLERANCE_M,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    assert.ok(
      Math.abs(actual.min[axis] - expected.min[axis]) < tolerance,
      `${label} min.${axis} ${actual.min[axis]} vs ${expected.min[axis]}`,
    );
    assert.ok(
      Math.abs(actual.max[axis] - expected.max[axis]) < tolerance,
      `${label} max.${axis} ${actual.max[axis]} vs ${expected.max[axis]}`,
    );
  }
}

function assertAuthoredSofaAabb(aabb: LocalAabb, label: string): void {
  assertAabbClose(aabb, PI4A_SOFA_PLACEMENT_LOCAL_AABB, label);
  const size = localAabbDimensions(aabb);
  assert.ok(
    Math.abs(size.width - PI4A_SOFA_AUTHORED_WIDTH_M) < AABB_INVARIANCE_TOLERANCE_M,
    `${label} width ${size.width}`,
  );
  assert.ok(
    Math.abs(size.height - PI4A_SOFA_AUTHORED_HEIGHT_M) < AABB_INVARIANCE_TOLERANCE_M,
    `${label} height ${size.height}`,
  );
  assert.ok(
    Math.abs(size.depth - PI4A_SOFA_AUTHORED_DEPTH_M) < AABB_INVARIANCE_TOLERANCE_M,
    `${label} depth ${size.depth}`,
  );
}

function box3ToLocalAabb(box: THREE.Box3): LocalAabb {
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
}

function measureSequentialPlacementLocalAabb(
  placement: THREE.Object3D,
  importPlacement: THREE.Object3D,
): LocalAabb | null {
  placement.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(placement.matrixWorld).invert();
  const box = new THREE.Box3();
  importPlacement.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.computeBoundingBox();
    const geometryBox = mesh.geometry.boundingBox;
    if (!geometryBox || geometryBox.isEmpty()) return;
    const local = geometryBox.clone();
    local.applyMatrix4(mesh.matrixWorld);
    local.applyMatrix4(inverse);
    box.union(local);
  });
  if (box.isEmpty()) return null;
  return box3ToLocalAabb(box);
}

function measureSofaLocalAabb(transform: WorldTransform): {
  aabb: LocalAabb;
  placement: THREE.Group;
  importPlacement: THREE.Group;
} {
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, createPi4aSofaObject3D());
  applyWorldTransform(root.placement, transform);
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb, "expected placement-local AABB");
  return { aabb, placement: root.placement, importPlacement: root.importPlacement };
}

function nearestCornerWallClearance(
  aabb: LocalAabb,
  transform: WorldTransform,
  wallX: number,
): number {
  let nearest = Infinity;
  for (const corner of aabbCorners(aabb)) {
    const world = applyWorldTransformToPoint(corner, transform);
    nearest = Math.min(nearest, wallX - world.x);
  }
  return nearest;
}

function meshGeometryMaxWorldX(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const corner = new THREE.Vector3();
  let maxX = -Infinity;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const geometryBox = mesh.geometry.boundingBox;
    if (!geometryBox || geometryBox.isEmpty()) return;
    for (const x of [geometryBox.min.x, geometryBox.max.x]) {
      for (const y of [geometryBox.min.y, geometryBox.max.y]) {
        for (const z of [geometryBox.min.z, geometryBox.max.z]) {
          corner.set(x, y, z).applyMatrix4(mesh.matrixWorld);
          if (corner.x > maxX) maxX = corner.x;
        }
      }
    }
  });
  return maxX;
}

function firstMesh(object: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!found && mesh.isMesh) found = mesh;
  });
  assert.ok(found, "expected a mesh");
  return found;
}

function mountFixtureScene(metricScale = 1) {
  const authority = createPi3aAuthority({ metricScale });
  const descriptors = createPi4bSceneObjectsFromAuthority(PI3A_ROOM_ID, authority);
  const scene = createRuntimeSceneCollection();
  for (const descriptor of descriptors) {
    const live = mountLiveRuntimeSceneObject({
      descriptor,
      imported: createPi4aSofaObject3D(),
      metricScale,
    });
    setLiveSceneObject(scene, live);
  }
  return { authority, descriptors, scene };
}

test("PI-4B asset identity is shared while object identity stays distinct", () => {
  const authority = createPi3aAuthority();
  const objects = createPi4bSceneObjectsFromAuthority(PI3A_ROOM_ID, authority);
  assert.equal(objects.length, 2);
  assert.equal(objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
  assert.notEqual(objects[0]?.objectId, objects[1]?.objectId);
  assert.equal(objects[0]?.assetIdentity.id, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(objects[1]?.assetIdentity.id, objects[0]?.assetIdentity.id);
  assert.equal(objects[0]?.assetIdentity.kind, "test_furniture_glb");
  assert.notEqual(objects[0]?.objectId, objects[0]?.assetIdentity.id);
  assert.deepEqual(objects[0]?.transform, PI4B_SOFA_A_TRANSFORM);
  assert.deepEqual(objects[1]?.transform, PI4B_SOFA_B_TRANSFORM);
  assert.equal(objects[0]?.transform.uniformScale, 1);
  assert.equal(objects[1]?.transform.uniformScale, 1);

  const asset = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.ok(asset);
  assert.equal(asset.glbUrl, AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH);
  assert.equal(asset.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);

  const skipped = createRuntimeSceneObjectsFromDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: authority.generationId,
    definitions: [{
      objectId: "missing-asset-object",
      assetId: "not-a-registered-asset",
      transform: DEFAULT_WORLD_TRANSFORM,
    }],
  });
  assert.equal(skipped.length, 0);
});

test("PI-4B scene collection is addressable by stable objectId, not array index", () => {
  const { scene, descriptors } = mountFixtureScene();
  assert.equal(scene.size, 2);
  const sofaA = getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID);
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaA);
  assert.ok(sofaB);
  assert.equal(sofaA.objectId, descriptors[0]?.objectId);
  assert.equal(sofaB.objectId, descriptors[1]?.objectId);
  assert.equal(getLiveSceneObject(scene, "missing"), null);
  assert.equal(scene.get(0 as unknown as string), undefined);
  assert.deepEqual(
    createPi4bSceneObjectDefinitions().map((item) => item.objectId),
    [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
  );
});

test("PI-4B Move and Rotate on one object leave the other unchanged", () => {
  const { scene } = mountFixtureScene();
  const beforeB = cloneWorldTransform(
    getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID)!.canonicalTransform,
  );
  const beforeBRealized = cloneWorldTransform(
    getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID)!.realizedTransform,
  );

  const moved = commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(-0.2, 0.1, 0, 0),
    metricScale: 1,
  });
  assert.ok(moved);
  assert.equal(moved.canonicalTransform.position.x, -0.2);
  assert.deepEqual(
    getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID)?.canonicalTransform,
    beforeB,
  );
  assert.deepEqual(
    getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID)?.realizedTransform,
    beforeBRealized,
  );

  const rotated = commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_B_OBJECT_ID,
    realized: transformAt(0.8, -0.35, 0, 40),
    metricScale: 1,
  });
  assert.ok(rotated);
  assert.equal(rotated.canonicalTransform.rotationDeg.y, 40);
  assert.equal(
    getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID)?.canonicalTransform.position.x,
    -0.2,
  );
  assert.equal(
    getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID)?.canonicalTransform.rotationDeg.y,
    0,
  );
});

test("PI-4B each object keeps an independent AABB for wall collision", () => {
  const authority = createPi3aAuthority();
  const descriptors = createRuntimeSceneObjectsFromDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: authority.generationId,
    definitions: [
      {
        objectId: PI4B_SOFA_A_OBJECT_ID,
        assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        transform: transformAt(0),
      },
      {
        objectId: PI4B_SOFA_B_OBJECT_ID,
        assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        transform: transformAt(0),
      },
    ],
  });
  const scene = createRuntimeSceneCollection();
  for (const descriptor of descriptors) {
    setLiveSceneObject(scene, mountLiveRuntimeSceneObject({
      descriptor,
      imported: createPi4aSofaObject3D(),
      metricScale: 1,
    }));
  }
  const sofaA = getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID);
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaA?.localAabb);
  assert.ok(sofaB?.localAabb);
  assert.notEqual(sofaA.localAabb, sofaB.localAabb);
  assert.deepEqual(
    localAabbDimensions(sofaA.localAabb),
    localAabbDimensions(sofaB.localAabb),
  );

  sofaB.localAabb = TINY_LOCAL_AABB;
  const moveA = resolveLiveSceneObjectCollision({
    object: sofaA,
    proposed: transformAt(10),
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  const moveB = resolveLiveSceneObjectCollision({
    object: sofaB,
    proposed: transformAt(10),
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  assert.equal(moveA.status, "stopped_at_contact");
  assert.equal(moveB.status, "stopped_at_contact");
  assert.ok(Math.abs(moveA.transform.position.x - 1.9) < 1e-6);
  assert.ok(Math.abs(moveB.transform.position.x - 2.9) < 1e-6);
  assert.notEqual(moveA.transform.position.x, moveB.transform.position.x);
});

test("PI-4B selection switches TransformControls attachment and empty picks deselect", () => {
  const { scene } = mountFixtureScene();
  const sofaA = getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID);
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaA);
  assert.ok(sofaB);
  assert.equal(PI4B_INITIAL_SELECTED_OBJECT_ID, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(
    attachTargetForSelectedObject(scene, PI4B_SOFA_A_OBJECT_ID),
    sofaA.placement,
  );
  assert.equal(
    attachTargetForSelectedObject(scene, PI4B_SOFA_B_OBJECT_ID),
    sofaB.placement,
  );
  assert.notEqual(sofaA.placement, sofaB.placement);
  assert.equal(attachTargetForSelectedObject(scene, null), null);
  assert.equal(resolveSelectedObjectId(PI4B_SOFA_B_OBJECT_ID), PI4B_SOFA_B_OBJECT_ID);
  assert.equal(resolveSelectedObjectId(null), null);
  assert.equal(resolveSelectedObjectId(""), null);
});

test("PI-4B body drag resolves the hit objectId, not previous selection", () => {
  const { scene } = mountFixtureScene();
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaB);
  const dragged = liveSceneObjectForBodyDrag(scene, {
    objectId: PI4B_SOFA_B_OBJECT_ID,
  });
  assert.equal(dragged, sofaB);
  assert.notEqual(
    liveSceneObjectForBodyDrag(scene, { objectId: PI4B_SOFA_B_OBJECT_ID })?.objectId,
    PI4B_SOFA_A_OBJECT_ID,
  );

  const beforeA = cloneWorldTransform(
    getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID)!.canonicalTransform,
  );
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_B_OBJECT_ID,
    realized: transformAt(0.4, -0.1),
    metricScale: 1,
  });
  assert.deepEqual(
    getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID)?.canonicalTransform,
    beforeA,
  );
  assert.equal(
    getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID)?.canonicalTransform.position.x,
    0.4,
  );
});

test("PI-4B each object independently respects certified wall collision", () => {
  const { scene } = mountFixtureScene();
  const sofaA = getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID);
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaA?.localAabb);
  assert.ok(sofaB?.localAabb);

  const moveA = resolveLiveSceneObjectCollision({
    object: sofaA,
    proposed: {
      ...sofaA.realizedTransform,
      position: { x: 10, y: sofaA.realizedTransform.position.y, z: sofaA.realizedTransform.position.z },
    },
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  const moveB = resolveLiveSceneObjectCollision({
    object: sofaB,
    proposed: {
      ...sofaB.realizedTransform,
      position: { x: 10, y: sofaB.realizedTransform.position.y, z: sofaB.realizedTransform.position.z },
    },
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  assert.equal(moveA.status, "stopped_at_contact");
  assert.equal(moveB.status, "stopped_at_contact");
  const expectedStopA = PLUS_X_WALL_X - orientedHalfExtentX(
    sofaA.realizedTransform.rotationDeg.y,
  );
  const expectedStopB = PLUS_X_WALL_X - orientedHalfExtentX(
    sofaB.realizedTransform.rotationDeg.y,
  );
  assert.ok(
    Math.abs(moveA.transform.position.x - expectedStopA) < WALL_CONTACT_TOLERANCE_M,
    `Sofa A stop ${moveA.transform.position.x} vs ${expectedStopA}`,
  );
  assert.ok(
    Math.abs(moveB.transform.position.x - expectedStopB) < WALL_CONTACT_TOLERANCE_M,
    `Sofa B stop ${moveB.transform.position.x} vs ${expectedStopB}`,
  );
  assert.ok(
    Math.abs(
      nearestCornerWallClearance(sofaA.localAabb, moveA.transform, PLUS_X_WALL_X),
    ) < WALL_CONTACT_TOLERANCE_M,
  );
  assert.ok(
    Math.abs(
      nearestCornerWallClearance(sofaB.localAabb, moveB.transform, PLUS_X_WALL_X),
    ) < WALL_CONTACT_TOLERANCE_M,
  );
  assert.equal(
    getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID)?.canonicalTransform.position.x,
    PI4B_SOFA_B_TRANSFORM.position.x,
  );

  const rejected = resolveLiveSceneObjectCollision({
    object: {
      ...sofaA,
      realizedTransform: transformAt(0.4, 0, 0, 90),
    },
    proposed: transformAt(0.4, 0, 0, 0),
    walls: [PI3A_RIGHT_WALL],
    mode: "pose",
  });
  assert.equal(rejected.status, "rejected_pose");
  assert.equal(rejected.transform.rotationDeg.y, 90);
  assert.equal(rejected.transform.position.x, 0.4);
});

test("PI-4B History image changes do not remount the multi-object scene", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(viewer, /selectedObjectId/);
  assert.match(viewer, /createRuntimeSceneCollection/);
  assert.match(viewer, /createPi4bSceneObjects/);
  assert.match(viewer, /cloneFurnitureGlbScene/);
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
  assert.doesNotMatch(viewer, /selectedVersionId/);
  assert.doesNotMatch(viewer, /activeAssetId/);
  const controlMatches = viewer.match(/new TransformControls/g);
  assert.equal(controlMatches?.length, 1);
});

test("PI-4B keeps authored uniformScale 1 on every object", () => {
  const { scene } = mountFixtureScene(1.7);
  for (const object of scene.values()) {
    assert.equal(object.canonicalTransform.uniformScale, 1);
    assert.equal(object.realizedTransform.uniformScale, 1);
    assert.deepEqual(object.placement.scale.toArray(), [1, 1, 1]);
    const realized = realizeObjectWorldTransform(object.canonicalTransform, 1.7);
    assert.equal(realized.uniformScale, 1);
    const canonical = canonicalizeObjectWorldTransform(realized, 1.7);
    assert.equal(canonical.uniformScale, 1);
    assert.ok(Math.abs(canonical.position.x - object.canonicalTransform.position.x) < 1e-12);
  }
});

test("PI-4B serializeRuntimeScene emits persistence-ready data without Three.js objects", () => {
  const { scene } = mountFixtureScene();
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(-0.25, 0.2, 0, 12),
    metricScale: 1,
  });
  const serialized = serializeRuntimeScene(scene);
  assert.deepEqual(Object.keys(serialized), ["objects"]);
  assert.equal(serialized.objects.length, 2);
  for (const record of serialized.objects) {
    assert.deepEqual(Object.keys(record).sort(), ["assetId", "objectId", "transform"]);
    assert.equal(record.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
    assert.equal(record.transform.uniformScale, 1);
    assert.equal("placement" in record, false);
    assert.equal("importPlacement" in record, false);
    assert.equal("localAabb" in record, false);
    assert.equal("canonicalTransform" in record, false);
    assert.equal("realizedTransform" in record, false);
  }
  assert.equal(serialized.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(serialized.objects[0]?.transform.position.x, -0.25);
  assert.equal(serialized.objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
  const json = JSON.stringify(serialized);
  assert.doesNotMatch(json, /matrixWorld|uuid|isObject3D|Mesh|Group/);
  JSON.parse(json);
});

test("PI-4B loads one GLB asset and clones independent instances", async () => {
  const loaded = await parseFurnitureGlb(arrayBufferFromFile(GLB_REPO_PATH));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const cloneA = cloneFurnitureGlbScene(loaded.scene);
  const cloneB = cloneFurnitureGlbScene(loaded.scene);
  assert.notEqual(cloneA, cloneB);
  assert.notEqual(cloneA, loaded.scene);
  assert.equal(firstMesh(cloneA).geometry, firstMesh(loaded.scene).geometry);
  cloneA.position.set(2, 0, 0);
  assert.equal(cloneB.position.x, 0);
  assert.equal(loaded.scene.position.x, 0);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(viewer, /loadFurnitureGlb\(pi4aFurnitureGlbPublicPath\(\)\)/);
  assert.match(viewer, /cloneFurnitureGlbScene\(template\)/);
});

test("PI-4B preserves AFC authority, wall-only collision, and the persistence boundary", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const sceneRuntime = source("lib/afc-v2-runtime/scene-runtime.ts");
  const furniture = source("lib/afc-v2-runtime/furniture-runtime.ts");
  const assets = source("lib/afc-v2-runtime/furniture-assets.ts");
  for (const text of [viewer, sceneRuntime, furniture, assets]) {
    assert.doesNotMatch(text, /app\/admin\/3d-room-lab-v2/);
    assert.doesNotMatch(text, /executeAfcV2Analysis/);
    assert.doesNotMatch(text, /userWorldScale/);
    assert.doesNotMatch(text, /DEFAULT_PX_PER_IN/);
    assert.doesNotMatch(text, /OrbitControls/);
    assert.doesNotMatch(text, /collisionV1/);
    assert.doesNotMatch(text, /create table/i);
    assert.doesNotMatch(text, /from\("afc_.*scene/);
    assert.doesNotMatch(text, /parentScene|scene inheritance/i);
    assert.doesNotMatch(text, /object-object|furniture-to-furniture|objectToObject/);
  }
  assert.match(viewer, /realizeProductionWorld\(authority\)/);
  assert.match(viewer, /world\.collisionWalls/);
  assert.match(viewer, /resolveSceneObjectCollision/);
  assert.match(viewer, /measurePlacementLocalAabb/);
  assert.match(viewer, /liveSceneObjectForBodyDrag/);
  assert.doesNotMatch(viewer, />Furniture<|>Products<|>Delete<|>Duplicate<|>Scale</);
  assert.match(
    viewer,
    /if \(controls\.getMode\(\) === "scale"\) controls\.setMode\("translate"\)/,
  );
});

test("PI-4B1 placement-local AABB is invariant to placement translation and yaw", async () => {
  const identity = measureSofaLocalAabb(DEFAULT_WORLD_TRANSFORM).aabb;
  assertAuthoredSofaAabb(identity, "yaw 0");

  const measured = new Map<number, LocalAabb>();
  for (const yaw of YAW_INVARIANCE_DEG) {
    const translated = measureSofaLocalAabb(transformAt(2.4, -1.1, 0, yaw)).aabb;
    assertAuthoredSofaAabb(translated, `yaw ${yaw}° translated`);
    assertAabbClose(translated, identity, `yaw ${yaw}° vs identity`);
    measured.set(yaw, translated);
  }

  const { scene } = mountFixtureScene();
  const sofaA = getLiveSceneObject(scene, PI4B_SOFA_A_OBJECT_ID);
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaA?.localAabb);
  assert.ok(sofaB?.localAabb);
  assertAuthoredSofaAabb(sofaA.localAabb, "mounted Sofa A");
  assertAuthoredSofaAabb(sofaB.localAabb, "mounted Sofa B at 18°");
  assertAabbClose(sofaA.localAabb, identity, "mounted Sofa A vs identity");
  assertAabbClose(sofaB.localAabb, identity, "mounted Sofa B vs identity");

  const secondMeasureB = measurePlacementLocalAabb(
    sofaB.placement,
    sofaB.importPlacement,
  );
  assert.ok(secondMeasureB);
  assertAabbClose(secondMeasureB, sofaB.localAabb, "viewer remasurement of yawed Sofa B");
  assertAabbClose(
    secondMeasureB,
    measured.get(18)!,
    "second Sofa B measure vs direct 18° measurement",
  );

  const loaded = await parseFurnitureGlb(arrayBufferFromFile(GLB_REPO_PATH));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  let glbIdentity: LocalAabb | null = null;
  for (const yaw of YAW_INVARIANCE_DEG) {
    const root = createSceneObjectRoot();
    attachImportedObject(root.importPlacement, cloneFurnitureGlbScene(loaded.scene));
    applyWorldTransform(root.placement, transformAt(-0.7, 0.4, 0, yaw));
    const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
    assert.ok(aabb);
    assertAuthoredSofaAabb(aabb, `GLB yaw ${yaw}°`);
    if (!glbIdentity) glbIdentity = aabb;
    else assertAabbClose(aabb, glbIdentity, `GLB yaw ${yaw}° vs 0°`);
  }
});

test("PI-4B1 sequential Box3.applyMatrix4 expands under yaw; composed measurement does not", () => {
  const yawed = transformAt(1.3, -0.25, 0, 18);
  const { aabb, placement, importPlacement } = measureSofaLocalAabb(yawed);
  const sequential = measureSequentialPlacementLocalAabb(placement, importPlacement);
  assert.ok(sequential);

  assertAuthoredSofaAabb(aabb, "composed at 18°");
  const sequentialSize = localAabbDimensions(sequential);
  const composedSize = localAabbDimensions(aabb);
  assert.ok(
    sequentialSize.width > composedSize.width + 0.4,
    `sequential width ${sequentialSize.width} should inflate past ${composedSize.width}`,
  );
  assert.ok(
    sequentialSize.depth > composedSize.depth + 0.4,
    `sequential depth ${sequentialSize.depth} should inflate past ${composedSize.depth}`,
  );
  assert.ok(
    Math.abs(sequentialSize.height - composedSize.height) < AABB_INVARIANCE_TOLERANCE_M,
    "yaw around Y must not inflate height",
  );

  const proposed = transformAt(10, 0, 0, 18);
  const current = transformAt(0, 0, 0, 18);
  const composedMove = resolveSceneObjectCollision({
    current,
    proposed,
    localAabb: aabb,
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  const sequentialMove = resolveSceneObjectCollision({
    current,
    proposed,
    localAabb: sequential,
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  const expectedStop = PLUS_X_WALL_X - orientedHalfExtentX(18);
  assert.equal(composedMove.status, "stopped_at_contact");
  assert.equal(sequentialMove.status, "stopped_at_contact");
  assert.ok(
    Math.abs(composedMove.transform.position.x - expectedStop) < WALL_CONTACT_TOLERANCE_M,
  );
  assert.ok(
    sequentialMove.transform.position.x < composedMove.transform.position.x - 0.4,
    `inflated AABB stopped at ${sequentialMove.transform.position.x}, true contact ${composedMove.transform.position.x}`,
  );
});

test("PI-4B1 yaw-18 sofa Move contacts the +X wall at the true oriented corner", () => {
  const { scene } = mountFixtureScene();
  const sofaB = getLiveSceneObject(scene, PI4B_SOFA_B_OBJECT_ID);
  assert.ok(sofaB?.localAabb);
  assertAuthoredSofaAabb(sofaB.localAabb, "Sofa B cached local AABB");

  const expectedExtentX = orientedHalfExtentX(18);
  assert.ok(Math.abs(expectedExtentX - 1.18522) < 1e-5, `extentX ${expectedExtentX}`);
  const expectedStopX = PLUS_X_WALL_X - expectedExtentX;
  assert.ok(Math.abs(expectedStopX - 1.81478) < 1e-5, `expected stop ${expectedStopX}`);

  const move = resolveLiveSceneObjectCollision({
    object: sofaB,
    proposed: {
      ...sofaB.realizedTransform,
      position: {
        x: 10,
        y: sofaB.realizedTransform.position.y,
        z: sofaB.realizedTransform.position.z,
      },
    },
    walls: [FAR_RIGHT_WALL],
    mode: "move",
  });
  assert.equal(move.status, "stopped_at_contact");
  assert.ok(
    Math.abs(move.transform.position.x - expectedStopX) < WALL_CONTACT_TOLERANCE_M,
    `stop ${move.transform.position.x} vs ${expectedStopX}`,
  );
  assert.ok(
    Math.abs(move.transform.position.x - 1.81478) < 1e-5,
    `live-test stop ${move.transform.position.x}`,
  );

  const cornerClearance = nearestCornerWallClearance(
    sofaB.localAabb,
    move.transform,
    PLUS_X_WALL_X,
  );
  assert.ok(
    Math.abs(cornerClearance) < WALL_CONTACT_TOLERANCE_M,
    `true local-AABB corner clearance ${cornerClearance}`,
  );

  applyWorldTransform(sofaB.placement, move.transform);
  const meshClearance = PLUS_X_WALL_X - meshGeometryMaxWorldX(sofaB.placement);
  assert.ok(
    Math.abs(meshClearance) < 1e-3,
    `fixture mesh clearance ${meshClearance}`,
  );
});
