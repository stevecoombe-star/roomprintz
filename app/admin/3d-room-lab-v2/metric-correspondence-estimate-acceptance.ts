/**
 * Pure host acceptance for the UX-3b1 matched-span physical estimate.
 *
 * Fail closed. Model confidence is an input, not authority.
 * Do not consult generic room width/depth, TILED Floor ratio, or the
 * UX-2b manual World Scale slider band. A valid ~0.26× candidate is
 * shadow-recordable.
 */

import {
  deriveMetricScaleFromSpan,
  type MetricCorrespondenceEstimateHostAcceptance,
  type MetricCorrespondencePhysicalEstimate,
  type MetricSpanRangeM,
} from "./metric-correspondence-estimate-contract";

export const METRIC_SPAN_MIN_MODEL_CONFIDENCE = 0.55;
export const METRIC_SPAN_MAX_RELATIVE_RANGE = 1.5;
export const METRIC_SPAN_MAX_ABSOLUTE_RANGE_M = 20;
export const METRIC_SPAN_PHYSICAL_ABSURD_MIN_M = 0.2;
export const METRIC_SPAN_PHYSICAL_ABSURD_MAX_M = 80;

function freezeAcceptance(
  className: MetricCorrespondenceEstimateHostAcceptance["class"],
  reasons: readonly string[],
  candidateMetricScale: number | null,
): MetricCorrespondenceEstimateHostAcceptance {
  return Object.freeze({
    class: className,
    reasons: Object.freeze([...reasons]),
    candidateMetricScale,
  });
}

function rangeOrderValid(range: MetricSpanRangeM): boolean {
  return range.low <= range.best && range.best <= range.high;
}

function rangePositive(range: MetricSpanRangeM): boolean {
  return range.low > 0 && range.best > 0 && range.high > 0;
}

function rangeTooUncertain(range: MetricSpanRangeM): boolean {
  const span = range.high - range.low;
  if (span > METRIC_SPAN_MAX_ABSOLUTE_RANGE_M) return true;
  return span / range.best > METRIC_SPAN_MAX_RELATIVE_RANGE;
}

function rangeFinite(range: MetricSpanRangeM): boolean {
  return Number.isFinite(range.low) &&
    Number.isFinite(range.best) &&
    Number.isFinite(range.high);
}

/**
 * Host-owned classification. Does not clamp estimates into range.
 * Does not reject a finite positive candidate solely because it is
 * outside the current 0.50×–2.00× manual World Scale slider.
 */
export function acceptMetricCorrespondenceEstimate(
  estimate: MetricCorrespondencePhysicalEstimate | null,
  canonicalLength: number,
): MetricCorrespondenceEstimateHostAcceptance {
  if (!estimate) {
    return freezeAcceptance("unavailable", ["estimate_missing"], null);
  }

  const length = estimate.estimatedLengthM;
  const candidate = length
    ? deriveMetricScaleFromSpan(canonicalLength, length.best)
    : null;

  if (estimate.observability === "not_recoverable") {
    return freezeAcceptance(
      "unobservable_rejected",
      ["observability_not_recoverable"],
      candidate,
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
    return freezeAcceptance("unavailable", structuralReasons, candidate);
  }

  if (candidate === null) {
    return freezeAcceptance(
      "unavailable",
      ["candidate_metric_scale_not_finite_positive"],
      null,
    );
  }

  const implausibleReasons: string[] = [];
  if (
    length.best < METRIC_SPAN_PHYSICAL_ABSURD_MIN_M ||
    length.best > METRIC_SPAN_PHYSICAL_ABSURD_MAX_M
  ) {
    implausibleReasons.push("physical_length_outside_broad_sanity");
  }
  if (implausibleReasons.length > 0) {
    return freezeAcceptance("implausible_rejected", implausibleReasons, candidate);
  }

  const weakReasons: string[] = [];
  if (estimate.observability === "weak") {
    weakReasons.push("observability_weak");
  }
  if (estimate.modelConfidence < METRIC_SPAN_MIN_MODEL_CONFIDENCE) {
    weakReasons.push("model_confidence_below_host_minimum");
  }
  if (rangeTooUncertain(length)) {
    weakReasons.push("length_uncertainty_too_broad");
  }
  if (weakReasons.length > 0) {
    return freezeAcceptance("weak_rejected", weakReasons, candidate);
  }

  return freezeAcceptance("accepted", ["host_accepted_matched_span_estimate"], candidate);
}
