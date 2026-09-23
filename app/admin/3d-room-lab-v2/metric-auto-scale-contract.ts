/**
 * UX-3C0 uniform Auto metric-scale contract.
 *
 * One similarity scale maps a trusted canonical span onto a physical
 * length in metres:
 *
 *   autoMetricScale = physicalLengthM / canonicalLength
 *
 * The helper is provider-agnostic. Gemini room width is one physical
 * source; a later known-span measurement can outrank it without changing
 * UX-2b realization.
 *
 * This is not Floor, camera, FOV, S4, collision, or completeness
 * authority. Experimental trusted-span Auto is live-validation only.
 */

import { AUTO_METRIC_SCALE } from "./scene-metric-world-realization";

export const AFC_V2_AUTO_METRIC_SCALE_VERSION =
  "afc-v2-auto-metric-scale/v1" as const;

export const AUTO_METRIC_SCALE_AUTHORITY = {
  none: "none",
  gemini_width_back_span_experimental: "gemini_width_back_span_experimental",
  gemini_observed_span_physical_estimate:
    "gemini_observed_span_physical_estimate",
} as const;

export type AutoMetricScaleAuthority =
  | typeof AUTO_METRIC_SCALE_AUTHORITY.none
  | typeof AUTO_METRIC_SCALE_AUTHORITY.gemini_width_back_span_experimental
  | typeof AUTO_METRIC_SCALE_AUTHORITY.gemini_observed_span_physical_estimate;

/**
 * Conceptual source order. Only gemini_room_width is implemented.
 * manual_known_span is reserved and must outrank Gemini when added.
 */
export const AUTO_METRIC_SOURCE_PRECEDENCE = [
  "manual_known_span",
  "gemini_room_width_back_span",
  "none",
] as const;

export const AUTO_METRIC_PHYSICAL_SOURCE_KIND = {
  gemini_room_width: "gemini_room_width",
  manual_known_span: "manual_known_span",
  gemini_observed_span_length: "gemini_observed_span_length",
} as const;

export type AutoMetricPhysicalSource =
  | Readonly<{
      kind: typeof AUTO_METRIC_PHYSICAL_SOURCE_KIND.gemini_room_width;
      metres: number;
    }>
  | Readonly<{
      kind: typeof AUTO_METRIC_PHYSICAL_SOURCE_KIND.gemini_observed_span_length;
      metres: number;
    }>;

export type AutoMetricCanonicalSource = Readonly<{
  kind: "back_floor_wall_span" | "observed_floor_wall_span";
  correspondenceSpanId: string;
  gaugeLength: number;
}>;

export const AUTO_METRIC_CANONICAL_LENGTH_EPSILON = 1e-6;
export const AUTO_METRIC_SCALE_SANITY_MIN = 0.05;
export const AUTO_METRIC_SCALE_SANITY_MAX = 10;

export const AUTO_METRIC_SCALE_EXPERIMENTAL_COPY = "Experimental" as const;
export const AUTO_METRIC_SCALE_SOURCE_COPY =
  "Gemini room width + trusted back span" as const;
export const AUTO_METRIC_GEMINI_AVAILABLE_COPY =
  "Gemini room size available" as const;
export const AUTO_METRIC_NO_TRUSTED_SPAN_COPY =
  "No trusted complete back-wall span" as const;
export const AUTO_METRIC_UNRELIABLE_COPY =
  "Couldn't estimate room size reliably" as const;
export const AUTO_METRIC_LAB_TRUST_LABEL =
  "Trust selected back span as full width" as const;

export type AutoMetricS4aSafetyEvidence = Readonly<{
  observedSpanOnly: boolean;
  hiddenContinuation: boolean;
  geometryManufactured: boolean;
}>;

export type AutoMetricScaleReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_AUTO_METRIC_SCALE_VERSION;
  authority: AutoMetricScaleAuthority;
  physicalSource: AutoMetricPhysicalSource | null;
  canonicalSource: AutoMetricCanonicalSource | null;
  autoMetricScale: number;
  accepted: boolean;
  labTrustEnabled: boolean;
  reasons: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Provider-agnostic uniform similarity scale from a canonical gauge
 * length and a physical length in metres.
 */
export function deriveUniformMetricScaleFromPhysicalSpan(
  canonicalLength: number,
  physicalLengthM: number,
): number | null {
  if (
    !Number.isFinite(canonicalLength) ||
    canonicalLength <= AUTO_METRIC_CANONICAL_LENGTH_EPSILON
  ) {
    return null;
  }
  if (!Number.isFinite(physicalLengthM) || physicalLengthM <= 0) return null;
  const scale = physicalLengthM / canonicalLength;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function formatAutoMetricScale(scale: number): string {
  return `${scale.toFixed(2)}×`;
}

export function fallbackAutoMetricScaleReceipt(
  reasons: readonly string[],
  extras: Readonly<{
    physicalSource?: AutoMetricPhysicalSource | null;
    canonicalSource?: AutoMetricCanonicalSource | null;
    labTrustEnabled?: boolean;
  }> = {},
): AutoMetricScaleReceipt {
  return Object.freeze({
    schemaVersion: AFC_V2_AUTO_METRIC_SCALE_VERSION,
    authority: AUTO_METRIC_SCALE_AUTHORITY.none,
    physicalSource: extras.physicalSource ?? null,
    canonicalSource: extras.canonicalSource ?? null,
    autoMetricScale: AUTO_METRIC_SCALE,
    accepted: false,
    labTrustEnabled: extras.labTrustEnabled ?? false,
    reasons: Object.freeze([...reasons]),
  });
}

export function acceptedAutoMetricScaleReceipt(input: Readonly<{
  physicalSource: AutoMetricPhysicalSource;
  canonicalSource: AutoMetricCanonicalSource;
  autoMetricScale: number;
  labTrustEnabled: boolean;
  reasons: readonly string[];
}>): AutoMetricScaleReceipt {
  return Object.freeze({
    schemaVersion: AFC_V2_AUTO_METRIC_SCALE_VERSION,
    authority: AUTO_METRIC_SCALE_AUTHORITY.gemini_width_back_span_experimental,
    physicalSource: input.physicalSource,
    canonicalSource: input.canonicalSource,
    autoMetricScale: input.autoMetricScale,
    accepted: true,
    labTrustEnabled: input.labTrustEnabled,
    reasons: Object.freeze([...input.reasons]),
  });
}

export function isAutoMetricScaleReceipt(
  value: unknown,
): value is AutoMetricScaleReceipt {
  return isRecord(value) &&
    value.schemaVersion === AFC_V2_AUTO_METRIC_SCALE_VERSION &&
    (value.authority === AUTO_METRIC_SCALE_AUTHORITY.none ||
      value.authority ===
        AUTO_METRIC_SCALE_AUTHORITY.gemini_width_back_span_experimental ||
      value.authority ===
        AUTO_METRIC_SCALE_AUTHORITY.gemini_observed_span_physical_estimate);
}
