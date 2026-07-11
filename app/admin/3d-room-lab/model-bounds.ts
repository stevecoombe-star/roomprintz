import * as THREE from "three";

// --- Phase 0P-B: Box3 GLB auto-normalization -------------------------------
// Pure-ish helpers that measure a loaded object's bounds and derive safe
// model-local corrections (floor contact, X/Z footprint centering, native
// size normalization). Results are applied to a dedicated autoBoundsGroup so
// the raw object is never mutated. No React/DOM dependencies; never throws.

export const AUTO_NORMALIZE_TARGET_SIZE = 1.5;
export const AUTO_NORMALIZE_MIN_SCALE = 1e-3;
export const AUTO_NORMALIZE_MAX_SCALE = 1e3;

const MIN_MEASURABLE_DIMENSION = 1e-6;

export type Vec3 = { x: number; y: number; z: number };

export type AutoBoundsNormalization = {
  ok: boolean;
  scale: number;
  offset: Vec3;
  measuredSize: Vec3;
  measuredCenter: Vec3;
  reason?: string;
};

const IDENTITY_NORMALIZATION: AutoBoundsNormalization = {
  ok: false,
  scale: 1,
  offset: { x: 0, y: 0, z: 0 },
  measuredSize: { x: 0, y: 0, z: 0 },
  measuredCenter: { x: 0, y: 0, z: 0 },
  reason: "not measured",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

// --- Phase 2I-B1: placement-frame local floor-contact ---------------------
// Pure helper that computes the model's true floor-contact Y in the
// placementGroup local frame (the coordinate that placementGroup.scale scales).
// This is read-only metadata math; it never mutates objects or React state and
// never throws. Calibrated Scale uses it only to gate the "grounded at origin"
// eligibility (it does NOT bake in the yLocal === modelYOffset shortcut so the
// general normalization order stays auditable here).

// Structural subset of scene-state's ModelNormalizationState. Kept local so
// model-bounds.ts stays free of component/scene-state imports.
export type ModelNormalizationLike = {
  modelScaleMultiplier: number;
  modelYOffset: number;
};

export type PlacementLocalFloorContactInput = {
  autoBoundsInfo: AutoBoundsNormalization | null;
  autoNormalizeBoundsEnabled: boolean;
  modelNormalization: ModelNormalizationLike;
};

export type PlacementLocalFloorContactResult =
  | { ok: true; yLocal: number; reason: "available" }
  | { ok: false; yLocal: null; reason: string };

export function computePlacementLocalFloorContactY(
  input: PlacementLocalFloorContactInput
): PlacementLocalFloorContactResult {
  const { autoBoundsInfo, autoNormalizeBoundsEnabled, modelNormalization } = input;

  if (!autoBoundsInfo) {
    return { ok: false, yLocal: null, reason: "auto-bounds metadata unavailable" };
  }
  if (!autoBoundsInfo.ok) {
    return { ok: false, yLocal: null, reason: "auto-bounds metadata invalid" };
  }

  const { measuredSize, measuredCenter, scale, offset } = autoBoundsInfo;
  const candidateValues = [
    measuredSize.x,
    measuredSize.y,
    measuredSize.z,
    measuredCenter.x,
    measuredCenter.y,
    measuredCenter.z,
    scale,
    offset.x,
    offset.y,
    offset.z,
    modelNormalization.modelScaleMultiplier,
    modelNormalization.modelYOffset,
  ];
  if (!candidateValues.every((value) => Number.isFinite(value))) {
    return { ok: false, yLocal: null, reason: "non-finite contact metadata" };
  }

  const minYraw = measuredCenter.y - measuredSize.y / 2;
  // When auto-bounds normalization is currently applied, the autoBoundsGroup
  // contributes its own scale/offset.y; otherwise it is identity (scale 1, 0).
  const appliedAutoScale = autoNormalizeBoundsEnabled ? scale : 1;
  const appliedAutoOffsetY = autoNormalizeBoundsEnabled ? offset.y : 0;
  const contactInModelNormSpace = appliedAutoScale * minYraw + appliedAutoOffsetY;
  const yLocal =
    modelNormalization.modelScaleMultiplier * contactInModelNormSpace +
    modelNormalization.modelYOffset;

  if (!Number.isFinite(yLocal)) {
    return { ok: false, yLocal: null, reason: "non-finite local floor-contact" };
  }

  return { ok: true, yLocal, reason: "available" };
}

/**
 * Axis-aligned bounds in placementGroup local space. This folds the existing
 * auto-bounds and model-normalization child groups into raw measured bounds,
 * but deliberately excludes placementGroup's room transform. Attachment math
 * can therefore orient these model-local coordinates exactly once.
 */
export function computePlacementLocalModelBounds(input: {
  autoBoundsInfo: AutoBoundsNormalization | null;
  autoNormalizeBoundsEnabled: boolean;
  modelNormalization: ModelNormalizationLike & { modelYawOffsetDeg: number };
}): { ok: true; min: Vec3; max: Vec3 } | { ok: false; reason: string } {
  const { autoBoundsInfo, autoNormalizeBoundsEnabled, modelNormalization } = input;
  if (!autoBoundsInfo || !autoBoundsInfo.ok) return { ok: false, reason: "auto-bounds metadata unavailable" };
  const { measuredSize, measuredCenter, scale, offset } = autoBoundsInfo;
  const values = [
    measuredSize.x, measuredSize.y, measuredSize.z,
    measuredCenter.x, measuredCenter.y, measuredCenter.z,
    scale, offset.x, offset.y, offset.z,
    modelNormalization.modelScaleMultiplier, modelNormalization.modelYOffset, modelNormalization.modelYawOffsetDeg,
  ];
  if (!values.every(Number.isFinite) || modelNormalization.modelScaleMultiplier <= 0) {
    return { ok: false, reason: "non-finite placement-local bounds metadata" };
  }
  const rawMin = {
    x: measuredCenter.x - measuredSize.x / 2,
    y: measuredCenter.y - measuredSize.y / 2,
    z: measuredCenter.z - measuredSize.z / 2,
  };
  const rawMax = {
    x: measuredCenter.x + measuredSize.x / 2,
    y: measuredCenter.y + measuredSize.y / 2,
    z: measuredCenter.z + measuredSize.z / 2,
  };
  const autoScale = autoNormalizeBoundsEnabled ? scale : 1;
  const autoOffset = autoNormalizeBoundsEnabled ? offset : { x: 0, y: 0, z: 0 };
  const yaw = (modelNormalization.modelYawOffsetDeg * Math.PI) / 180;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  for (const x of [rawMin.x, rawMax.x]) {
    for (const y of [rawMin.y, rawMax.y]) {
      for (const z of [rawMin.z, rawMax.z]) {
        const autoX = x * autoScale + autoOffset.x;
        const autoY = y * autoScale + autoOffset.y;
        const autoZ = z * autoScale + autoOffset.z;
        const scaledX = autoX * modelNormalization.modelScaleMultiplier;
        const scaledY = autoY * modelNormalization.modelScaleMultiplier + modelNormalization.modelYOffset;
        const scaledZ = autoZ * modelNormalization.modelScaleMultiplier;
        const transformed = {
          x: cosine * scaledX + sine * scaledZ,
          y: scaledY,
          z: -sine * scaledX + cosine * scaledZ,
        };
        min.x = Math.min(min.x, transformed.x);
        min.y = Math.min(min.y, transformed.y);
        min.z = Math.min(min.z, transformed.z);
        max.x = Math.max(max.x, transformed.x);
        max.y = Math.max(max.y, transformed.y);
        max.z = Math.max(max.z, transformed.z);
      }
    }
  }
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) {
    return { ok: false, reason: "non-finite placement-local bounds" };
  }
  if (max.x - min.x <= MIN_MEASURABLE_DIMENSION || max.y - min.y <= MIN_MEASURABLE_DIMENSION || max.z - min.z <= MIN_MEASURABLE_DIMENSION) {
    return { ok: false, reason: "degenerate placement-local bounds" };
  }
  return { ok: true, min, max };
}

export function computeAutoBoundsNormalization(object: THREE.Object3D): AutoBoundsNormalization {
  try {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      return { ...IDENTITY_NORMALIZATION, reason: "empty bounds" };
    }

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    if (!isFiniteVector(size) || !isFiniteVector(center) || !isFiniteVector(box.min)) {
      return { ...IDENTITY_NORMALIZATION, reason: "non-finite bounds" };
    }

    const measuredSize: Vec3 = { x: size.x, y: size.y, z: size.z };
    const measuredCenter: Vec3 = { x: center.x, y: center.y, z: center.z };

    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension < MIN_MEASURABLE_DIMENSION) {
      return { ...IDENTITY_NORMALIZATION, reason: "degenerate size", measuredSize, measuredCenter };
    }

    const autoScale = clamp(
      AUTO_NORMALIZE_TARGET_SIZE / maxDimension,
      AUTO_NORMALIZE_MIN_SCALE,
      AUTO_NORMALIZE_MAX_SCALE
    );
    const offsetX = -autoScale * center.x;
    const offsetY = -autoScale * box.min.y;
    const offsetZ = -autoScale * center.z;

    if (![autoScale, offsetX, offsetY, offsetZ].every((value) => Number.isFinite(value))) {
      return { ...IDENTITY_NORMALIZATION, reason: "non-finite normalization", measuredSize, measuredCenter };
    }

    return {
      ok: true,
      scale: autoScale,
      offset: { x: offsetX, y: offsetY, z: offsetZ },
      measuredSize,
      measuredCenter,
    };
  } catch {
    return { ...IDENTITY_NORMALIZATION, reason: "measurement error" };
  }
}
