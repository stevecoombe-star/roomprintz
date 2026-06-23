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
