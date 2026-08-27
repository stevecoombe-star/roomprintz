import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { computeAutoBoundsNormalization } from "@/app/admin/3d-room-lab/model-bounds";

import {
  CALIBRATED_FLOOR_PLANE_Y,
  SCENE_ROTATION_EULER_ORDER,
  TEST_CUBE_COLOR,
  TEST_CUBE_GEOMETRY_SIZE,
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
    TEST_CUBE_GEOMETRY_SIZE,
    TEST_CUBE_GEOMETRY_SIZE,
    TEST_CUBE_GEOMETRY_SIZE,
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
  autoBounds: THREE.Group;
} {
  const placement = new THREE.Group();
  const autoBounds = new THREE.Group();
  placement.add(autoBounds);
  return { placement, autoBounds };
}

export function applyAutoBoundsToGroup(
  autoBounds: THREE.Group,
  object: THREE.Object3D,
): void {
  const info = computeAutoBoundsNormalization(object);
  autoBounds.rotation.set(0, 0, 0);
  if (info.ok) {
    autoBounds.scale.setScalar(info.scale);
    autoBounds.position.set(info.offset.x, info.offset.y, info.offset.z);
    return;
  }
  autoBounds.scale.setScalar(1);
  autoBounds.position.set(0, 0, 0);
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

export function attachNormalizedObject(
  autoBounds: THREE.Group,
  object: THREE.Object3D,
): void {
  while (autoBounds.children.length > 0) {
    const child = autoBounds.children[0];
    autoBounds.remove(child);
    disposeObject3D(child);
  }
  applyAutoBoundsToGroup(autoBounds, object);
  autoBounds.add(object);
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
