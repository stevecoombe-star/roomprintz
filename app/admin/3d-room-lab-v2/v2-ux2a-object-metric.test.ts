import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import {
  TEST_CUBE_PLACEMENT_LOCAL_AABB,
  footprintFromLocalAabb,
} from "./room-collision-footprint";
import { computeImportPlacement } from "./scene-object-import-bounds";
import {
  DEFAULT_WORLD_TRANSFORM,
  TEST_CUBE_EDGE_M,
  addTestCube,
  createInitialSceneLayerState,
  getSelectedSceneObject,
  resetSceneObjectTransform,
  updateSelectedUniformScale,
} from "./scene-layer-state";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
  measurePlacementLocalAabb,
} from "./scene-object-runtime";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const EPS = 1e-6;

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

function boxMesh(width: number, height: number, depth: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
}

function worldBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function sizeOf(box: THREE.Box3): THREE.Vector3 {
  const size = new THREE.Vector3();
  box.getSize(size);
  return size;
}

function assertApprox(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) material.dispose();
      } else {
        mesh.material?.dispose();
      }
    }
  });
}

function importObject(content: THREE.Object3D) {
  const root = createSceneObjectRoot();
  attachImportedObject(root.importPlacement, content);
  applyWorldTransform(root.placement, DEFAULT_WORLD_TRANSFORM);
  return root;
}

test("imported 2.2 m sofa keeps authored size at uniformScale 1", () => {
  const sofa = boxMesh(2.2, 0.9, 0.9);
  const measured = computeImportPlacement(sofa);
  assert.equal(measured.ok, true);
  assert.equal(measured.scale, 1);
  assertApprox(measured.measuredSize.x, 2.2, "sofa measured x");
  assertApprox(measured.measuredSize.y, 0.9, "sofa measured y");
  assertApprox(measured.measuredSize.z, 0.9, "sofa measured z");
  assert.ok(Math.max(measured.measuredSize.x, measured.measuredSize.y, measured.measuredSize.z) > 1.5);

  const root = importObject(sofa);
  assert.equal(root.importPlacement.scale.x, 1);
  const size = sizeOf(worldBox(root.placement));
  assertApprox(size.x, 2.2, "sofa world x");
  assertApprox(size.y, 0.9, "sofa world y");
  assertApprox(size.z, 0.9, "sofa world z");
  assertApprox(Math.max(size.x, size.y, size.z), 2.2, "sofa max dimension");
  disposeObject(sofa);
});

test("imported ~0.9 × 0.9 × 1.0 m chair keeps authored size and is not fit to 1.5", () => {
  const chair = boxMesh(0.9, 1.0, 0.9);
  const measured = computeImportPlacement(chair);
  assert.equal(measured.ok, true);
  assert.equal(measured.scale, 1);
  assertApprox(measured.measuredSize.x, 0.9, "chair measured x");
  assertApprox(measured.measuredSize.y, 1.0, "chair measured y");
  assertApprox(measured.measuredSize.z, 0.9, "chair measured z");

  const root = importObject(chair);
  const size = sizeOf(worldBox(root.placement));
  assertApprox(size.x, 0.9, "chair world x");
  assertApprox(size.y, 1.0, "chair world y");
  assertApprox(size.z, 0.9, "chair world z");
  assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 1.5) > 0.2);
  disposeObject(chair);
});

test("sofa and chair remain differently sized after import", () => {
  const sofa = boxMesh(2.2, 0.9, 0.9);
  const chair = boxMesh(0.9, 1.0, 0.9);
  const sofaRoot = importObject(sofa);
  const chairRoot = importObject(chair);
  const sofaSize = sizeOf(worldBox(sofaRoot.placement));
  const chairSize = sizeOf(worldBox(chairRoot.placement));
  assert.ok(sofaSize.x > chairSize.x + 0.5);
  assert.ok(Math.abs(sofaSize.x - chairSize.x) > 1);
  assertApprox(sofaSize.x / chairSize.x, 2.2 / 0.9, "relative length");
  disposeObject(sofa);
  disposeObject(chair);
});

test("authored child node scale is preserved and included in imported bounds", () => {
  const content = new THREE.Group();
  const child = new THREE.Group();
  child.scale.set(2, 2, 2);
  const mesh = boxMesh(1.1, 0.45, 0.45);
  child.add(mesh);
  content.add(child);

  const measured = computeImportPlacement(content);
  assert.equal(measured.ok, true);
  assert.equal(measured.scale, 1);
  assertApprox(measured.measuredSize.x, 2.2, "authored-scale measured x");
  assertApprox(measured.measuredSize.y, 0.9, "authored-scale measured y");
  assertApprox(measured.measuredSize.z, 0.9, "authored-scale measured z");

  const root = importObject(content);
  assert.deepEqual(child.scale.toArray(), [2, 2, 2]);
  assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
  const size = sizeOf(worldBox(root.placement));
  assertApprox(size.x, 2.2, "authored-scale world x");
  assertApprox(size.y, 0.9, "authored-scale world y");
  assertApprox(size.z, 0.9, "authored-scale world z");
  disposeObject(content);
});

test("XZ centering and floor contact change pivot without changing size", () => {
  const mesh = boxMesh(2.2, 0.9, 0.9);
  mesh.position.set(4, -1.2, -3);
  const sizeBefore = sizeOf(worldBox(mesh));
  const centerBefore = worldBox(mesh).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(centerBefore.x) > 1);
  assert.ok(worldBox(mesh).min.y < 0);

  const root = importObject(mesh);
  const boxAfter = worldBox(root.placement);
  const sizeAfter = sizeOf(boxAfter);
  assertApprox(sizeAfter.x, sizeBefore.x, "centered size x");
  assertApprox(sizeAfter.y, sizeBefore.y, "centered size y");
  assertApprox(sizeAfter.z, sizeBefore.z, "centered size z");
  const centerAfter = boxAfter.getCenter(new THREE.Vector3());
  assertApprox(centerAfter.x, 0, "centered x");
  assertApprox(centerAfter.z, 0, "centered z");
  assertApprox(boxAfter.min.y, 0, "floor minY");
  assert.equal(root.importPlacement.scale.x, 1);
  disposeObject(mesh);
});

test("uniformScale 1 / 0.5 / 2 maps to authored / half / double collision footprint", () => {
  const sofa = boxMesh(2.2, 0.9, 0.9);
  const root = importObject(sofa);
  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);
  assertApprox(aabb.max.x - aabb.min.x, 2.2, "local length");
  assertApprox(aabb.max.y - aabb.min.y, 0.9, "local height");
  assertApprox(aabb.max.z - aabb.min.z, 0.9, "local depth");

  const extentX = (transformScale: number) => {
    const hull = footprintFromLocalAabb(aabb, {
      ...DEFAULT_WORLD_TRANSFORM,
      uniformScale: transformScale,
    });
    const xs = hull.map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  assertApprox(extentX(1), 2.2, "scale 1 footprint");
  assertApprox(extentX(0.5), 1.1, "scale 0.5 footprint");
  assertApprox(extentX(2), 4.4, "scale 2 footprint");
  disposeObject(sofa);
});

test("Reset Transform restores uniformScale 1 and authored import size", () => {
  let state = addTestCube(createInitialSceneLayerState());
  state = updateSelectedUniformScale(state, 2);
  assert.equal(getSelectedSceneObject(state)?.transform.uniformScale, 2);
  state = resetSceneObjectTransform(state);
  assert.equal(getSelectedSceneObject(state)?.transform.uniformScale, 1);
  assert.deepEqual(getSelectedSceneObject(state)?.transform, DEFAULT_WORLD_TRANSFORM);

  const cube = createTestCubeMesh();
  const root = importObject(cube);
  applyWorldTransform(root.placement, {
    ...DEFAULT_WORLD_TRANSFORM,
    uniformScale: 2,
  });
  assertApprox(sizeOf(worldBox(root.placement)).x, 2, "scaled cube");
  applyWorldTransform(root.placement, DEFAULT_WORLD_TRANSFORM);
  assertApprox(sizeOf(worldBox(root.placement)).x, 1, "reset cube");
  disposeObject(cube);
});

test("Test Cube is an explicit 1 m object with matching placement-local AABB", () => {
  assert.equal(TEST_CUBE_EDGE_M, 1);
  const cube = createTestCubeMesh();
  const geometry = cube.geometry as THREE.BoxGeometry;
  assert.equal(geometry.parameters.width, TEST_CUBE_EDGE_M);
  assert.equal(geometry.parameters.height, TEST_CUBE_EDGE_M);
  assert.equal(geometry.parameters.depth, TEST_CUBE_EDGE_M);

  const root = importObject(cube);
  assert.equal(root.importPlacement.scale.x, 1);
  assert.equal(root.importPlacement.scale.y, 1);
  assert.equal(root.importPlacement.scale.z, 1);

  const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
  assert.ok(aabb);
  assertApprox(aabb.min.x, -0.5, "cube aabb min x");
  assertApprox(aabb.max.x, 0.5, "cube aabb max x");
  assertApprox(aabb.min.y, 0, "cube aabb min y");
  assertApprox(aabb.max.y, 1, "cube aabb max y");
  assertApprox(aabb.min.z, -0.5, "cube aabb min z");
  assertApprox(aabb.max.z, 0.5, "cube aabb max z");
  assertApprox(aabb.min.x, TEST_CUBE_PLACEMENT_LOCAL_AABB.min.x, "named aabb min x");
  assertApprox(aabb.max.y, TEST_CUBE_PLACEMENT_LOCAL_AABB.max.y, "named aabb max y");

  const scale1 = footprintFromLocalAabb(aabb, DEFAULT_WORLD_TRANSFORM);
  const xs1 = scale1.map((point) => point.x);
  assertApprox(Math.max(...xs1) - Math.min(...xs1), 1, "scale 1 footprint");

  const scale2 = footprintFromLocalAabb(aabb, {
    ...DEFAULT_WORLD_TRANSFORM,
    uniformScale: 2,
  });
  const xs2 = scale2.map((point) => point.x);
  assertApprox(Math.max(...xs2) - Math.min(...xs2), 2, "scale 2 footprint");
  disposeObject(cube);
});

test("V2 scene-object import no longer uses V1 fit-to-1.5 normalization", () => {
  const runtime = read("scene-object-runtime.ts");
  const helper = read("scene-object-import-bounds.ts");
  const shell = read("v2-shell.test.ts");
  assert.doesNotMatch(runtime, /model-bounds/);
  assert.doesNotMatch(runtime, /computeAutoBoundsNormalization|AUTO_NORMALIZE_TARGET_SIZE|attachNormalizedObject/);
  assert.doesNotMatch(helper, /AUTO_NORMALIZE_TARGET_SIZE|1\.5\s*\/\s*maxDimension/);
  assert.match(helper, /scale = 1/);
  assert.match(runtime, /attachImportedObject/);
  assert.match(shell, /scene-object-import-bounds/);
  const allowlist = shell.slice(
    shell.indexOf("const allowedImports"),
    shell.indexOf("for (const imported"),
  );
  assert.match(allowlist, /scene-object-import-bounds/);
  assert.doesNotMatch(allowlist, /model-bounds/);
});
