import * as THREE from "three";

/**
 * V2-local import placement. Measures authored bounds and returns XZ-centering
 * plus floor-contact offsets with wrapper scale = 1. Does not fit to a target
 * dimension. Authored GLTF node transforms are not mutated.
 */

const MIN_MEASURABLE_DIMENSION = 1e-6;

export type Vec3 = { x: number; y: number; z: number };

export type ImportPlacement = {
  ok: boolean;
  scale: number;
  offset: Vec3;
  measuredSize: Vec3;
  measuredCenter: Vec3;
  reason?: string;
};

const IDENTITY_PLACEMENT: ImportPlacement = {
  ok: false,
  scale: 1,
  offset: { x: 0, y: 0, z: 0 },
  measuredSize: { x: 0, y: 0, z: 0 },
  measuredCenter: { x: 0, y: 0, z: 0 },
  reason: "not measured",
};

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

export function computeImportPlacement(object: THREE.Object3D): ImportPlacement {
  try {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      return { ...IDENTITY_PLACEMENT, reason: "empty bounds" };
    }

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    if (!isFiniteVector(size) || !isFiniteVector(center) || !isFiniteVector(box.min)) {
      return { ...IDENTITY_PLACEMENT, reason: "non-finite bounds" };
    }

    const measuredSize: Vec3 = { x: size.x, y: size.y, z: size.z };
    const measuredCenter: Vec3 = { x: center.x, y: center.y, z: center.z };

    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension < MIN_MEASURABLE_DIMENSION) {
      return { ...IDENTITY_PLACEMENT, reason: "degenerate size", measuredSize, measuredCenter };
    }

    const scale = 1;
    const offsetX = -center.x;
    const offsetY = -box.min.y;
    const offsetZ = -center.z;

    if (![scale, offsetX, offsetY, offsetZ].every((value) => Number.isFinite(value))) {
      return { ...IDENTITY_PLACEMENT, reason: "non-finite placement", measuredSize, measuredCenter };
    }

    return {
      ok: true,
      scale,
      offset: { x: offsetX, y: offsetY, z: offsetZ },
      measuredSize,
      measuredCenter,
    };
  } catch {
    return { ...IDENTITY_PLACEMENT, reason: "measurement error" };
  }
}
