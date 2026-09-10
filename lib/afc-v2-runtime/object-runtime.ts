import * as THREE from "three";

import { computeImportPlacement } from "./object-import-bounds";
import {
  AFC_V2_RUNTIME_CUBE_EDGE_M,
  AFC_V2_RUNTIME_FLOOR_PLANE_Y,
  AFC_V2_RUNTIME_ROTATION_EULER_ORDER,
  type LocalAabb,
  type WorldTransform,
} from "./types";

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

export const AFC_V2_RUNTIME_CUBE_COLOR = 0x34d399;

export function createOneMetreCubeMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(
    AFC_V2_RUNTIME_CUBE_EDGE_M,
    AFC_V2_RUNTIME_CUBE_EDGE_M,
    AFC_V2_RUNTIME_CUBE_EDGE_M,
  );
  const material = new THREE.MeshStandardMaterial({
    color: AFC_V2_RUNTIME_CUBE_COLOR,
    metalness: 0.1,
    roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(1, 1, 1);
  return mesh;
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
    Math.max(AFC_V2_RUNTIME_FLOOR_PLANE_Y, transform.position.y),
    transform.position.z,
  );
  object.rotation.order = AFC_V2_RUNTIME_ROTATION_EULER_ORDER;
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

export function measurePlacementLocalAabb(
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
  const min = { x: box.min.x, y: box.min.y, z: box.min.z };
  const max = { x: box.max.x, y: box.max.y, z: box.max.z };
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) {
    return null;
  }
  return { min, max };
}

export function worldMinY(object: THREE.Object3D): number {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object).min.y;
}

export function localAabbDimensions(aabb: LocalAabb): {
  width: number;
  height: number;
  depth: number;
} {
  return {
    width: aabb.max.x - aabb.min.x,
    height: aabb.max.y - aabb.min.y,
    depth: aabb.max.z - aabb.min.z,
  };
}

export function geometryLocalSize(object: THREE.Object3D): {
  x: number;
  y: number;
  z: number;
} | null {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || !mesh.geometry) return null;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box || box.isEmpty()) return null;
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
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
