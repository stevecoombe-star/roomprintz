import type { AutoBoundsNormalization } from "./model-bounds";
import type { FurnitureBlockerFootprint } from "./p2-s2h-furniture-blocker-collision";

export type P2S2HFurnitureFootprintUnavailableReason =
  | "auto_bounds_unavailable"
  | "auto_bounds_disabled"
  | "invalid_measured_size"
  | "invalid_auto_bounds_scale"
  | "invalid_auto_bounds_centering"
  | "invalid_effective_scale"
  | "invalid_model_scale"
  | "invalid_combined_scale"
  | "invalid_yaw";

export type P2S2HFurnitureFootprintInput = Readonly<{
  autoBounds: AutoBoundsNormalization | null;
  autoNormalizeBoundsEnabled: boolean;
  /**
   * The scalar actually applied to detached placementGroup. The host resolves
   * TransformState.uniformScale and any active depth-scaling policy before
   * calling this camera-independent adapter.
   */
  effectivePlacementScale: number;
  modelScaleMultiplier: number;
  placementYawDeg: number;
  modelYawOffsetDeg: number;
  /**
   * Optional query-time visual yaw, such as auto-rotate. Persistent placement
   * and model yaw remain separate inputs so callers cannot accidentally omit
   * either authority.
   */
  additionalYawDeg?: number;
}>;

export type P2S2HFurnitureFootprintResult =
  | Readonly<{
      ok: true;
      footprint: FurnitureBlockerFootprint;
    }>
  | Readonly<{
      ok: false;
      reason: P2S2HFurnitureFootprintUnavailableReason;
    }>;

/**
 * Derives the detached furniture OBB consumed by the P2-S2H collision kernel.
 * measuredSize is raw, pre-normalization mesh authority, so every scalar is
 * applied exactly once and yaw remains separate from the local half-extents.
 */
export function deriveP2S2HFurnitureFootprint(
  input: P2S2HFurnitureFootprintInput
): P2S2HFurnitureFootprintResult {
  if (!input.autoNormalizeBoundsEnabled) {
    return { ok: false, reason: "auto_bounds_disabled" };
  }

  const autoBounds = input.autoBounds;
  if (!autoBounds || !autoBounds.ok) {
    return { ok: false, reason: "auto_bounds_unavailable" };
  }

  const { measuredSize, measuredCenter, offset, scale: autoBoundsScale } = autoBounds;
  if (
    !Number.isFinite(measuredSize.x) ||
    !Number.isFinite(measuredSize.z) ||
    measuredSize.x <= 0 ||
    measuredSize.z <= 0
  ) {
    return { ok: false, reason: "invalid_measured_size" };
  }
  if (!Number.isFinite(autoBoundsScale) || autoBoundsScale <= 0) {
    return { ok: false, reason: "invalid_auto_bounds_scale" };
  }
  if (
    !Number.isFinite(measuredCenter.x) ||
    !Number.isFinite(measuredCenter.z) ||
    !Number.isFinite(offset.x) ||
    !Number.isFinite(offset.z)
  ) {
    return { ok: false, reason: "invalid_auto_bounds_centering" };
  }
  if (
    !Number.isFinite(input.effectivePlacementScale) ||
    input.effectivePlacementScale <= 0
  ) {
    return { ok: false, reason: "invalid_effective_scale" };
  }
  if (
    !Number.isFinite(input.modelScaleMultiplier) ||
    input.modelScaleMultiplier <= 0
  ) {
    return { ok: false, reason: "invalid_model_scale" };
  }

  const additionalYawDeg = input.additionalYawDeg ?? 0;
  if (
    !Number.isFinite(input.placementYawDeg) ||
    !Number.isFinite(input.modelYawOffsetDeg) ||
    !Number.isFinite(additionalYawDeg)
  ) {
    return { ok: false, reason: "invalid_yaw" };
  }

  const combinedScale =
    autoBoundsScale *
    input.modelScaleMultiplier *
    input.effectivePlacementScale;
  if (!Number.isFinite(combinedScale) || combinedScale <= 0) {
    return { ok: false, reason: "invalid_combined_scale" };
  }

  const yawDeg =
    input.placementYawDeg +
    input.modelYawOffsetDeg +
    additionalYawDeg;
  const yawRad = yawDeg * (Math.PI / 180);
  if (!Number.isFinite(yawDeg) || !Number.isFinite(yawRad)) {
    return { ok: false, reason: "invalid_yaw" };
  }

  const halfWidth = (measuredSize.x * combinedScale) / 2;
  const halfDepth = (measuredSize.z * combinedScale) / 2;
  if (
    !Number.isFinite(halfWidth) ||
    !Number.isFinite(halfDepth) ||
    halfWidth <= 0 ||
    halfDepth <= 0
  ) {
    return { ok: false, reason: "invalid_combined_scale" };
  }

  return {
    ok: true,
    footprint: {
      halfWidth,
      halfDepth,
      yawRad,
    },
  };
}
