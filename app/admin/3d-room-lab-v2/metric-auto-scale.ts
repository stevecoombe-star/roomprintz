/**
 * UX-3C0 trusted-width uniform Auto derivation.
 *
 * Physical target: accepted room-width prior (metres).
 * Canonical denominator: trusted complete back floor-wall span.
 *
 * Fail closed to autoMetricScale = 1. Never blocks Floor / camera / S4 /
 * collision. Does not claim certified wall completeness.
 */

import {
  metricRoomPriorIsAccepted,
  type MetricRoomPriorReceipt,
} from "./metric-room-prior-contract";
import type { MetricCorrespondenceSpan } from "./metric-correspondence-span-contract";
import {
  acceptedAutoMetricScaleReceipt,
  AUTO_METRIC_CANONICAL_LENGTH_EPSILON,
  AUTO_METRIC_PHYSICAL_SOURCE_KIND,
  AUTO_METRIC_SCALE_SANITY_MAX,
  AUTO_METRIC_SCALE_SANITY_MIN,
  deriveUniformMetricScaleFromPhysicalSpan,
  fallbackAutoMetricScaleReceipt,
  type AutoMetricCanonicalSource,
  type AutoMetricPhysicalSource,
  type AutoMetricS4aSafetyEvidence,
  type AutoMetricScaleReceipt,
} from "./metric-auto-scale-contract";

export type AutoMetricScaleInput = Readonly<{
  roomPrior: MetricRoomPriorReceipt | null | undefined;
  selected: MetricCorrespondenceSpan | null | undefined;
  s4aSafety: AutoMetricS4aSafetyEvidence | null;
  trustSelectedBackSpanAsFullWidth: boolean;
}>;

export type TrustedBackWallWidthSpanResult = Readonly<{
  trusted: boolean;
  reasons: readonly string[];
}>;

function physicalWidthSource(
  roomPrior: MetricRoomPriorReceipt | null | undefined,
): { ok: true; source: AutoMetricPhysicalSource } | {
  ok: false;
  reasons: readonly string[];
  source: AutoMetricPhysicalSource | null;
} {
  if (!roomPrior) {
    return { ok: false, reasons: ["room_prior_unavailable"], source: null };
  }
  if (!metricRoomPriorIsAccepted(roomPrior)) {
    return {
      ok: false,
      reasons: ["room_prior_not_accepted"],
      source: null,
    };
  }
  const width = roomPrior.estimate?.estimatedRoomWidthM ?? null;
  if (
    !width ||
    !Number.isFinite(width.best) ||
    width.best <= 0
  ) {
    return { ok: false, reasons: ["width_unavailable"], source: null };
  }
  return {
    ok: true,
    source: Object.freeze({
      kind: AUTO_METRIC_PHYSICAL_SOURCE_KIND.gemini_room_width,
      metres: width.best,
    }),
  };
}

function backWallCanonicalSource(
  selected: MetricCorrespondenceSpan | null | undefined,
): AutoMetricCanonicalSource | null {
  if (!selected || selected.role !== "back_floor_wall") return null;
  if (
    !Number.isFinite(selected.canonicalLength) ||
    selected.canonicalLength <= AUTO_METRIC_CANONICAL_LENGTH_EPSILON
  ) {
    return null;
  }
  return Object.freeze({
    kind: "back_floor_wall_span",
    correspondenceSpanId: selected.id,
    gaugeLength: selected.canonicalLength,
  });
}

/**
 * Generic controlled trust gate. Does not prove structural completeness.
 * Lab trust is a separate explicit assertion.
 */
export function evaluateTrustedBackWallWidthSpan(
  selected: MetricCorrespondenceSpan | null | undefined,
  s4aSafety: AutoMetricS4aSafetyEvidence | null,
): TrustedBackWallWidthSpanResult {
  const reasons: string[] = [];
  if (!selected) {
    return { trusted: false, reasons: Object.freeze(["selected_span_missing"]) };
  }
  if (selected.source !== "s4a_floor_wall") {
    reasons.push("source_not_s4a_floor_wall");
  }
  if (selected.role !== "back_floor_wall") {
    reasons.push("role_not_back_floor_wall");
  }
  if (selected.truncation !== "none") {
    reasons.push("span_truncated");
  }
  if (selected.endpointAClass === "frame_adjacent") {
    reasons.push("endpoint_a_frame_adjacent");
  }
  if (selected.endpointBClass === "frame_adjacent") {
    reasons.push("endpoint_b_frame_adjacent");
  }
  if (selected.overlaySafeOnOriginal !== true) {
    reasons.push("overlay_unsafe_on_original");
  }
  if (
    !Number.isFinite(selected.canonicalLength) ||
    selected.canonicalLength <= AUTO_METRIC_CANONICAL_LENGTH_EPSILON
  ) {
    reasons.push("canonical_length_not_usable");
  }
  if (!s4aSafety) {
    reasons.push("s4a_safety_unavailable");
  } else {
    if (s4aSafety.observedSpanOnly !== true) {
      reasons.push("s4a_observed_span_only_not_true");
    }
    if (s4aSafety.hiddenContinuation !== false) {
      reasons.push("s4a_hidden_continuation");
    }
    if (s4aSafety.geometryManufactured !== false) {
      reasons.push("s4a_geometry_manufactured");
    }
  }
  if (reasons.length > 0) {
    return { trusted: false, reasons: Object.freeze(reasons) };
  }
  return {
    trusted: true,
    reasons: Object.freeze(["trusted_back_floor_wall_span_experimental"]),
  };
}

/**
 * Derive one uniform Auto scale. Never throws. Never clamps a legitimate
 * candidate into the manual 0.50–2.00 user band.
 */
export function deriveAutoMetricScale(
  input: AutoMetricScaleInput,
): AutoMetricScaleReceipt {
  const labTrustEnabled = input.trustSelectedBackSpanAsFullWidth === true;
  const physical = physicalWidthSource(input.roomPrior);
  const canonicalSource = backWallCanonicalSource(input.selected);
  const spanTrust = evaluateTrustedBackWallWidthSpan(
    input.selected,
    input.s4aSafety,
  );
  const extras = {
    physicalSource: physical.source,
    canonicalSource,
    labTrustEnabled,
  };

  if (!physical.ok) {
    return fallbackAutoMetricScaleReceipt(physical.reasons, extras);
  }
  if (!input.selected) {
    return fallbackAutoMetricScaleReceipt(["selected_span_missing"], extras);
  }
  if (!spanTrust.trusted) {
    return fallbackAutoMetricScaleReceipt(spanTrust.reasons, extras);
  }
  if (!labTrustEnabled) {
    return fallbackAutoMetricScaleReceipt(
      ["lab_trust_not_enabled", "completeness_not_certified"],
      extras,
    );
  }
  if (!canonicalSource) {
    return fallbackAutoMetricScaleReceipt(
      ["canonical_back_span_unavailable"],
      extras,
    );
  }

  const scale = deriveUniformMetricScaleFromPhysicalSpan(
    canonicalSource.gaugeLength,
    physical.source.metres,
  );
  if (scale === null) {
    return fallbackAutoMetricScaleReceipt(["candidate_non_finite"], extras);
  }
  if (
    scale < AUTO_METRIC_SCALE_SANITY_MIN ||
    scale > AUTO_METRIC_SCALE_SANITY_MAX
  ) {
    return fallbackAutoMetricScaleReceipt(
      ["candidate_outside_catastrophic_sanity_bounds"],
      extras,
    );
  }

  return acceptedAutoMetricScaleReceipt({
    physicalSource: physical.source,
    canonicalSource,
    autoMetricScale: scale,
    labTrustEnabled,
    reasons: [
      ...spanTrust.reasons,
      "lab_trust_enabled",
      "uniform_physical_span_scale",
    ],
  });
}
