/**
 * Pure host acceptance for the M2 observed-span physical estimate.
 *
 * Fail closed. Does not consult Gemini width/depth, OL, ORIGINAL
 * registration, or collision experimental trust. Does not clamp.
 */

import {
  AUTO_METRIC_SCALE_SANITY_MAX,
  AUTO_METRIC_SCALE_SANITY_MIN,
  deriveUniformMetricScaleFromPhysicalSpan,
} from "./metric-auto-scale-contract";
import {
  METRIC_SPAN_MAX_ABSOLUTE_RANGE_M,
  METRIC_SPAN_MAX_RELATIVE_RANGE,
  METRIC_SPAN_MIN_MODEL_CONFIDENCE,
  METRIC_SPAN_PHYSICAL_ABSURD_MAX_M,
  METRIC_SPAN_PHYSICAL_ABSURD_MIN_M,
} from "./metric-correspondence-estimate-acceptance";
import type { ObservedSpanMetricCandidate } from "./observed-span-metric-candidate-contract";
import type {
  ObservedSpanEstimateHostAcceptance,
  ObservedSpanEstimateLineage,
  ObservedSpanPhysicalEstimate,
  ObservedSpanRangeM,
} from "./observed-span-physical-estimate-contract";

export type ObservedSpanEstimateAcceptanceContext = Readonly<{
  candidate: ObservedSpanMetricCandidate | null;
  lineage: ObservedSpanEstimateLineage;
  current: Readonly<{
    s4aCandidateId: string;
    sourceSeamId: string;
    emptySha256: string;
    originalSha256: string | null;
    floorAuthorityKey: string;
    canonicalLength: number;
    freezeReceiptVersion: string | null;
    freezePayloadSha256: string | null;
    candidateStillEligible: boolean;
  }>;
  originalWasIncluded: boolean;
}>;

function freezeAcceptance(
  className: ObservedSpanEstimateHostAcceptance["class"],
  reasons: readonly string[],
  autoMetricScale: number | null,
): ObservedSpanEstimateHostAcceptance {
  return Object.freeze({
    class: className,
    reasons: Object.freeze([...reasons]),
    autoMetricScale,
  });
}

function rangeOrderValid(range: ObservedSpanRangeM): boolean {
  return range.low <= range.best && range.best <= range.high;
}

function rangePositive(range: ObservedSpanRangeM): boolean {
  return range.low > 0 && range.best > 0 && range.high > 0;
}

function rangeTooUncertain(range: ObservedSpanRangeM): boolean {
  const span = range.high - range.low;
  if (span > METRIC_SPAN_MAX_ABSOLUTE_RANGE_M) return true;
  return span / range.best > METRIC_SPAN_MAX_RELATIVE_RANGE;
}

function rangeFinite(range: ObservedSpanRangeM): boolean {
  return Number.isFinite(range.low) &&
    Number.isFinite(range.best) &&
    Number.isFinite(range.high);
}

function sameOptional(left: string | null, right: string | null): boolean {
  return left === right;
}

export function observedSpanEstimateLineageMatches(
  lineage: ObservedSpanEstimateLineage,
  current: ObservedSpanEstimateAcceptanceContext["current"],
  originalWasIncluded: boolean,
): readonly string[] {
  const reasons: string[] = [];
  if (lineage.s4aCandidateId !== current.s4aCandidateId) {
    reasons.push("lineage_s4a_candidate_mismatch");
  }
  if (lineage.sourceSeamId !== current.sourceSeamId) {
    reasons.push("lineage_source_seam_mismatch");
  }
  if (lineage.emptySha256 !== current.emptySha256) {
    reasons.push("lineage_empty_sha_mismatch");
  }
  if (
    originalWasIncluded &&
    lineage.originalSha256 !== null &&
    lineage.originalSha256 !== current.originalSha256
  ) {
    reasons.push("lineage_original_sha_mismatch");
  }
  if (lineage.floorAuthorityKey !== current.floorAuthorityKey) {
    reasons.push("lineage_floor_authority_key_mismatch");
  }
  if (lineage.canonicalLength !== current.canonicalLength) {
    reasons.push("lineage_canonical_length_mismatch");
  }
  if (!sameOptional(lineage.freezeReceiptVersion, current.freezeReceiptVersion)) {
    reasons.push("lineage_freeze_version_mismatch");
  }
  if (!sameOptional(lineage.freezePayloadSha256, current.freezePayloadSha256)) {
    reasons.push("lineage_freeze_payload_mismatch");
  }
  return Object.freeze(reasons);
}

export function acceptObservedSpanPhysicalEstimate(
  estimate: ObservedSpanPhysicalEstimate | null,
  context: ObservedSpanEstimateAcceptanceContext,
): ObservedSpanEstimateHostAcceptance {
  if (!estimate) {
    return freezeAcceptance("unavailable", ["estimate_missing"], null);
  }
  if (!context.candidate) {
    return freezeAcceptance("unavailable", ["candidate_missing"], null);
  }
  if (!context.current.candidateStillEligible) {
    return freezeAcceptance(
      "unavailable",
      ["candidate_no_longer_m2_eligible"],
      null,
    );
  }

  const lineageReasons = observedSpanEstimateLineageMatches(
    context.lineage,
    context.current,
    context.originalWasIncluded,
  );
  if (lineageReasons.length > 0) {
    return freezeAcceptance("lineage_rejected", lineageReasons, null);
  }

  const length = estimate.estimatedLengthM;
  const scale = length
    ? deriveUniformMetricScaleFromPhysicalSpan(
      context.candidate.canonicalLength,
      length.best,
    )
    : null;

  if (estimate.status === "not_recoverable") {
    return freezeAcceptance(
      "unobservable_rejected",
      ["status_not_recoverable"],
      scale,
    );
  }

  if (!length) {
    return freezeAcceptance(
      "weak_rejected",
      ["estimated_length_unavailable"],
      null,
    );
  }

  const structuralReasons: string[] = [];
  if (!rangeFinite(length)) structuralReasons.push("length_not_finite");
  if (!rangePositive(length)) structuralReasons.push("length_not_positive");
  if (!rangeOrderValid(length)) structuralReasons.push("length_range_inverted");
  if (structuralReasons.length > 0) {
    return freezeAcceptance("unavailable", structuralReasons, scale);
  }

  if (scale === null) {
    return freezeAcceptance(
      "unavailable",
      ["derived_auto_metric_scale_not_finite"],
      null,
    );
  }

  const implausibleReasons: string[] = [];
  if (
    length.best < METRIC_SPAN_PHYSICAL_ABSURD_MIN_M ||
    length.best > METRIC_SPAN_PHYSICAL_ABSURD_MAX_M
  ) {
    implausibleReasons.push("physical_length_outside_segment_sanity");
  }
  if (implausibleReasons.length > 0) {
    return freezeAcceptance("implausible_rejected", implausibleReasons, scale);
  }

  const weakReasons: string[] = [];
  if (estimate.status === "weak") {
    weakReasons.push("status_weak");
  }
  if (estimate.modelConfidence < METRIC_SPAN_MIN_MODEL_CONFIDENCE) {
    weakReasons.push("model_confidence_below_host_minimum");
  }
  if (rangeTooUncertain(length)) {
    weakReasons.push("length_uncertainty_too_broad");
  }
  if (weakReasons.length > 0) {
    return freezeAcceptance("weak_rejected", weakReasons, scale);
  }

  if (
    scale < AUTO_METRIC_SCALE_SANITY_MIN ||
    scale > AUTO_METRIC_SCALE_SANITY_MAX
  ) {
    return freezeAcceptance(
      "implausible_rejected",
      ["candidate_outside_catastrophic_sanity_bounds"],
      scale,
    );
  }

  return freezeAcceptance(
    "accepted",
    ["host_accepted_observed_span_physical_estimate"],
    scale,
  );
}
