/**
 * Path B observed-span Auto derivation and Path A/B hierarchy.
 *
 * Path A remains deriveAutoMetricScale. This module never replaces Path A
 * when complete-back geometry exists, including when the Path A lab
 * checkbox is off.
 */

import {
  AFC_V2_AUTO_METRIC_SCALE_VERSION,
  AUTO_METRIC_PHYSICAL_SOURCE_KIND,
  AUTO_METRIC_SCALE_AUTHORITY,
  fallbackAutoMetricScaleReceipt,
  type AutoMetricScaleReceipt,
} from "./metric-auto-scale-contract";
import type { ObservedSpanMetricCandidate } from "./observed-span-metric-candidate-contract";
import {
  observedSpanPhysicalEstimateIsAccepted,
  type ObservedSpanPhysicalEstimateReceipt,
} from "./observed-span-physical-estimate-contract";

export const OBSERVED_SPAN_AUTO_SOURCE_COPY =
  "Gemini observed-span length + canonical segment" as const;

export function deriveObservedSpanAutoMetricScale(input: Readonly<{
  estimate: ObservedSpanPhysicalEstimateReceipt | null | undefined;
  candidate: ObservedSpanMetricCandidate | null | undefined;
  completeBackGeometryExists: boolean;
}>): AutoMetricScaleReceipt {
  const extras = {
    physicalSource: input.estimate?.estimate?.estimatedLengthM
      ? Object.freeze({
        kind: AUTO_METRIC_PHYSICAL_SOURCE_KIND.gemini_observed_span_length,
        metres: input.estimate.estimate.estimatedLengthM.best,
      })
      : null,
    canonicalSource: input.candidate
      ? Object.freeze({
        kind: "observed_floor_wall_span" as const,
        correspondenceSpanId: input.candidate.id,
        gaugeLength: input.candidate.canonicalLength,
      })
      : null,
    labTrustEnabled: false,
  };

  if (input.completeBackGeometryExists) {
    return fallbackAutoMetricScaleReceipt(
      ["complete_back_geometry_suppresses_observed_span_auto"],
      extras,
    );
  }
  if (!input.candidate) {
    return fallbackAutoMetricScaleReceipt(
      ["observed_span_candidate_missing"],
      extras,
    );
  }
  if (!input.estimate) {
    return fallbackAutoMetricScaleReceipt(
      ["observed_span_estimate_missing"],
      extras,
    );
  }
  if (!observedSpanPhysicalEstimateIsAccepted(input.estimate)) {
    return fallbackAutoMetricScaleReceipt(
      input.estimate.hostAcceptance.reasons.length > 0
        ? input.estimate.hostAcceptance.reasons
        : ["observed_span_estimate_not_accepted"],
      extras,
    );
  }
  const scale = input.estimate.hostAcceptance.autoMetricScale;
  const metres = input.estimate.estimate?.estimatedLengthM?.best ?? null;
  if (
    scale === null ||
    metres === null ||
    !Number.isFinite(scale) ||
    !Number.isFinite(metres)
  ) {
    return fallbackAutoMetricScaleReceipt(
      ["observed_span_auto_not_finite"],
      extras,
    );
  }

  return Object.freeze({
    schemaVersion: AFC_V2_AUTO_METRIC_SCALE_VERSION,
    authority: AUTO_METRIC_SCALE_AUTHORITY.gemini_observed_span_physical_estimate,
    physicalSource: Object.freeze({
      kind: AUTO_METRIC_PHYSICAL_SOURCE_KIND.gemini_observed_span_length,
      metres,
    }),
    canonicalSource: Object.freeze({
      kind: "observed_floor_wall_span" as const,
      correspondenceSpanId: input.candidate.id,
      gaugeLength: input.candidate.canonicalLength,
    }),
    autoMetricScale: scale,
    accepted: true,
    labTrustEnabled: false,
    reasons: Object.freeze([
      "observed_span_physical_estimate_accepted",
      "uniform_physical_span_scale",
    ]),
  });
}

/**
 * Hierarchy: Path A accepted → Path A. Complete-back geometry (even with
 * checkbox off) → Path A fallback. Else accepted Path B. Else Path A
 * fallback (autoMetricScale = 1).
 */
export function selectAppliedAutoMetricScale(input: Readonly<{
  pathA: AutoMetricScaleReceipt;
  pathB: AutoMetricScaleReceipt;
  completeBackGeometryExists: boolean;
}>): AutoMetricScaleReceipt {
  if (input.pathA.accepted) return input.pathA;
  if (input.completeBackGeometryExists) return input.pathA;
  if (input.pathB.accepted) return input.pathB;
  return input.pathA;
}

export function appliedAutoMetricPath(
  receipt: AutoMetricScaleReceipt,
): "path_a" | "path_b" | "none" {
  if (
    receipt.accepted &&
    receipt.authority ===
      AUTO_METRIC_SCALE_AUTHORITY.gemini_width_back_span_experimental
  ) {
    return "path_a";
  }
  if (
    receipt.accepted &&
    receipt.authority ===
      AUTO_METRIC_SCALE_AUTHORITY.gemini_observed_span_physical_estimate
  ) {
    return "path_b";
  }
  return "none";
}
