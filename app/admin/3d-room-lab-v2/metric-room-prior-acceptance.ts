/**
 * Pure host acceptance for the UX-3a metric room prior.
 *
 * Fail closed. Model confidence is an input, not authority.
 * Projective Floor aspect from the tile-group sample is never an
 * acceptance input. The canonical depth gauge is a similarity unit,
 * not a physical-length claim.
 *
 * UX-3C0 physical Auto target is estimatedRoomWidthM.best.
 * estimatedRoomDepthM is diagnostic. The legacy depth / gauge ratio is
 * not an Auto candidate and is not an acceptance gate.
 */

import type {
  MetricRangeM,
  MetricRoomPriorHostAcceptance,
  MetricRoomPriorModelEstimate,
} from "./metric-room-prior-contract";

export const CANONICAL_PROJECTIVE_DEPTH_GAUGE_M = 4;

export const METRIC_PRIOR_DEPTH_BEST_MIN_M = 1.5;
export const METRIC_PRIOR_DEPTH_BEST_MAX_M = 20;
export const METRIC_PRIOR_WIDTH_BEST_MIN_M = 1.5;
export const METRIC_PRIOR_WIDTH_BEST_MAX_M = 30;
export const METRIC_PRIOR_CEILING_SOFT_MIN_M = 1.8;
export const METRIC_PRIOR_CEILING_SOFT_MAX_M = 6;
export const METRIC_PRIOR_MIN_MODEL_CONFIDENCE = 0.55;
export const METRIC_PRIOR_MAX_RELATIVE_RANGE = 1;
export const METRIC_PRIOR_MAX_ABSOLUTE_RANGE_M = 10;

function freezeAcceptance(
  className: MetricRoomPriorHostAcceptance["class"],
  reasons: readonly string[],
  derivedAutoMetricScale: number | null,
): MetricRoomPriorHostAcceptance {
  return Object.freeze({
    class: className,
    reasons: Object.freeze([...reasons]),
    derivedAutoMetricScale,
  });
}

function rangeOrderValid(range: MetricRangeM): boolean {
  return range.low <= range.best && range.best <= range.high;
}

function rangePositive(range: MetricRangeM): boolean {
  return range.low > 0 && range.best > 0 && range.high > 0;
}

function rangeTooUncertain(range: MetricRangeM): boolean {
  const span = range.high - range.low;
  if (span > METRIC_PRIOR_MAX_ABSOLUTE_RANGE_M) return true;
  return span / range.best > METRIC_PRIOR_MAX_RELATIVE_RANGE;
}

/**
 * Legacy diagnostic only: physical depth / projective gauge 4.
 * Deprecated. Not used for acceptance, Auto, UI authority, or runtime.
 */
export function deriveShadowAutoMetricScale(depthBestM: number): number {
  return depthBestM / CANONICAL_PROJECTIVE_DEPTH_GAUGE_M;
}

function legacyDepthGaugeRatio(depth: MetricRangeM | null): number | null {
  return depth && Number.isFinite(depth.best) && depth.best > 0
    ? deriveShadowAutoMetricScale(depth.best)
    : null;
}

/**
 * Host-owned classification. Does not clamp estimates into range.
 * Does not consult projective Floor aspect as a physical-room check.
 * Does not reject because a legacy depth/gauge ratio is outside 0.50–2.00.
 */
export function acceptMetricRoomPrior(
  estimate: MetricRoomPriorModelEstimate | null,
): MetricRoomPriorHostAcceptance {
  if (!estimate) {
    return freezeAcceptance("unavailable", ["estimate_missing"], null);
  }

  const depth = estimate.estimatedRoomDepthM;
  const width = estimate.estimatedRoomWidthM;
  const legacyDerived = legacyDepthGaugeRatio(depth);

  if (estimate.observability === "not_recoverable") {
    return freezeAcceptance(
      "unobservable_rejected",
      ["observability_not_recoverable"],
      legacyDerived,
    );
  }

  const structuralReasons: string[] = [];
  if (depth) {
    if (!rangePositive(depth)) structuralReasons.push("depth_not_positive");
    if (!rangeOrderValid(depth)) structuralReasons.push("depth_range_inverted");
  }
  if (width) {
    if (!rangePositive(width)) structuralReasons.push("width_not_positive");
    if (!rangeOrderValid(width)) structuralReasons.push("width_range_inverted");
  }
  if (
    estimate.estimatedCeilingHeightM !== null &&
    !(estimate.estimatedCeilingHeightM > 0)
  ) {
    structuralReasons.push("ceiling_not_positive");
  }
  if (structuralReasons.length > 0) {
    return freezeAcceptance("unavailable", structuralReasons, legacyDerived);
  }

  if (!width) {
    return freezeAcceptance(
      "weak_rejected",
      depth
        ? ["width_unavailable_depth_only_not_used_for_auto"]
        : ["width_unavailable"],
      legacyDerived,
    );
  }

  const implausibleReasons: string[] = [];
  if (
    width.best < METRIC_PRIOR_WIDTH_BEST_MIN_M ||
    width.best > METRIC_PRIOR_WIDTH_BEST_MAX_M
  ) {
    implausibleReasons.push("width_best_outside_physical_bounds");
  }
  if (
    depth &&
    (depth.best < METRIC_PRIOR_DEPTH_BEST_MIN_M ||
      depth.best > METRIC_PRIOR_DEPTH_BEST_MAX_M)
  ) {
    implausibleReasons.push("depth_best_outside_physical_bounds");
  }
  if (implausibleReasons.length > 0) {
    return freezeAcceptance("implausible_rejected", implausibleReasons, legacyDerived);
  }

  const weakReasons: string[] = [];
  if (estimate.observability === "weak") {
    weakReasons.push("observability_weak");
  }
  if (estimate.modelConfidence < METRIC_PRIOR_MIN_MODEL_CONFIDENCE) {
    weakReasons.push("model_confidence_below_host_minimum");
  }
  if (rangeTooUncertain(width)) {
    weakReasons.push("width_uncertainty_too_broad");
  }
  if (depth && rangeTooUncertain(depth)) {
    weakReasons.push("depth_uncertainty_too_broad");
  }
  if (weakReasons.length > 0) {
    return freezeAcceptance("weak_rejected", weakReasons, legacyDerived);
  }

  const reasons = ["host_accepted_width_prior"];
  if (depth) {
    reasons.push("depth_retained_as_diagnostic");
  }
  if (
    estimate.estimatedCeilingHeightM !== null &&
    (estimate.estimatedCeilingHeightM < METRIC_PRIOR_CEILING_SOFT_MIN_M ||
      estimate.estimatedCeilingHeightM > METRIC_PRIOR_CEILING_SOFT_MAX_M)
  ) {
    reasons.push("ceiling_outside_soft_plausibility_not_used_for_rejection");
  }
  return freezeAcceptance("accepted", reasons, legacyDerived);
}
