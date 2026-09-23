import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { computeImportPlacement } from "./scene-object-import-bounds";
import {
  CALIBRATED_FLOOR_PLANE_Y,
  SCENE_ROTATION_EULER_ORDER,
  TEST_CUBE_COLOR,
  TEST_CUBE_EDGE_M,
  type WorldTransform,
} from "./scene-layer-state";

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "lightMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "specularMap",
] as const;

export type LoadedGlbResult =
  | Readonly<{ ok: true; scene: THREE.Group }>
  | Readonly<{ ok: false; message: string }>;

export function createTestCubeMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(
    TEST_CUBE_EDGE_M,
    TEST_CUBE_EDGE_M,
    TEST_CUBE_EDGE_M,
  );
  const material = new THREE.MeshStandardMaterial({
    color: TEST_CUBE_COLOR,
    metalness: 0.1,
    roughness: 0.6,
  });
  return new THREE.Mesh(geometry, material);
}

export function createSceneObjectRoot(): {
  placement: THREE.Group;
  importPlacement: THREE.Group;
} {
  const placement = new THREE.Group();
  const importPlacement = new THREE.Group();
  placement.add(importPlacement);
  return { placement, importPlacement };
}

export function applyImportPlacementToGroup(
  importPlacement: THREE.Group,
  object: THREE.Object3D,
): void {
  const info = computeImportPlacement(object);
  importPlacement.rotation.set(0, 0, 0);
  if (info.ok) {
    importPlacement.scale.setScalar(info.scale);
    importPlacement.position.set(info.offset.x, info.offset.y, info.offset.z);
    return;
  }
  importPlacement.scale.setScalar(1);
  importPlacement.position.set(0, 0, 0);
}

export function applyWorldTransform(
  object: THREE.Object3D,
  transform: WorldTransform,
): void {
  object.position.set(
    transform.position.x,
    Math.max(CALIBRATED_FLOOR_PLANE_Y, transform.position.y),
    transform.position.z,
  );
  object.rotation.order = SCENE_ROTATION_EULER_ORDER;
  object.rotation.set(
    THREE.MathUtils.degToRad(transform.rotationDeg.x),
    THREE.MathUtils.degToRad(transform.rotationDeg.y),
    THREE.MathUtils.degToRad(transform.rotationDeg.z),
  );
  object.scale.setScalar(transform.uniformScale);
}

export function attachImportedObject(
  importPlacement: THREE.Group,
  object: THREE.Object3D,
): void {
  while (importPlacement.children.length > 0) {
    const child = importPlacement.children[0];
    importPlacement.remove(child);
    disposeObject3D(child);
  }
  applyImportPlacementToGroup(importPlacement, object);
  importPlacement.add(object);
}

/**
 * Cached placement-local AABB of imported child content. Call once after
 * attachImportedObject. Collision uses this cache plus proposed TRS.
 */
export function measurePlacementLocalAabb(
  placement: THREE.Object3D,
  importPlacement: THREE.Object3D,
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
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
  const min = { x: box.min.x, y: box.min.y, z: box.min.z };
  const max = { x: box.max.x, y: box.max.y, z: box.max.z };
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) {
    return null;
  }
  return { min, max };
}

export async function loadGlbFromUrl(url: string): Promise<LoadedGlbResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, message: "Model path is empty." };
  }
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(trimmed);
    return { ok: true, scene: gltf.scene };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : "Unable to load GLB asset.",
    };
  }
}

function disposeMaterial(material: THREE.Material): void {
  const materialRecord = material as unknown as Record<string, unknown>;
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const value = materialRecord[key];
    if (value && typeof value === "object" && "isTexture" in value) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh;
    if (!maybeMesh.isMesh) return;
    maybeMesh.geometry?.dispose();
    if (Array.isArray(maybeMesh.material)) {
      for (const material of maybeMesh.material) disposeMaterial(material);
      return;
    }
    if (maybeMesh.material) disposeMaterial(maybeMesh.material);
  });
}
