import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type LoadFurnitureGlbResult =
  | Readonly<{ ok: true; scene: THREE.Group }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Production furniture GLB seam. Interprets glTF units as metres.
 * Does not normalize, fit to a target size, or mutate AFC world authority.
 */
export async function parseFurnitureGlb(
  data: ArrayBuffer,
): Promise<LoadFurnitureGlbResult> {
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(data, "");
    if (!gltf.scene) {
      return { ok: false, message: "Furniture asset has no scene." };
    }
    return { ok: true, scene: gltf.scene };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : "Unable to read furniture asset.",
    };
  }
}

export async function loadFurnitureGlb(
  url: string,
): Promise<LoadFurnitureGlbResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, message: "Furniture asset path is empty." };
  }
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(trimmed);
    if (!gltf.scene) {
      return { ok: false, message: "Furniture asset has no scene." };
    }
    return { ok: true, scene: gltf.scene };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : "Unable to load furniture asset.",
    };
  }
}
