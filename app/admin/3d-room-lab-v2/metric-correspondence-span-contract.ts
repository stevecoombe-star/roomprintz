/**
 * UX-3b0 host-side metric correspondence span contract.
 *
 * Authority is prior_only. This receipt identifies one already-qualified
 * finite AFC floor-wall span. It is not S4, Floor, camera, FOV, or
 * collision authority. Live Auto is not this receipt; UX-3C0 may use a
 * qualifying back span as a canonical denominator only.
 *
 * Canonical length is a projective gauge length, not metres. Do not label
 * it as metres. Do not pass canonicalLength to provider-facing prompts.
 *
 * Future host-only (not implemented here):
 *   metricScaleCandidate = physicalSpanLengthM / span.canonicalLength
 * That derivation must stay provider-agnostic (known-span or other
 * physical length source).
 */

export const AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION =
  "afc-v2-metric-correspondence-selection/v1" as const;
export const AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY = "prior_only" as const;
export const METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE =
  "original-source-normalized-image/v1" as const;
export const METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE =
  "empty-source-normalized-image/v1" as const;

/**
 * Minimum normalized image A↔B length. Below this, a later visual
 * physical-length estimate of the highlighted span is not meaningful.
 * Not room-tuned.
 */
export const METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED = 0.08;

export const METRIC_CORRESPONDENCE_ROLE_COPY = {
  back_floor_wall: "Back floor-wall",
  left_floor_wall: "Left floor-wall",
  right_floor_wall: "Right floor-wall",
  other_floor_wall: "Other floor-wall",
} as const;

export type MetricCorrespondenceSpanRole =
  | "back_floor_wall"
  | "left_floor_wall"
  | "right_floor_wall"
  | "other_floor_wall";

export type MetricCorrespondenceEndpointClass =
  | "observed_interior"
  | "observed_junction"
  | "frame_adjacent"
  | "inferred";

export type MetricCorrespondenceSpanSource =
  | "s4a_floor_wall"
  | "ol_floor_wall";

export type MetricCorrespondenceImageSpace =
  | typeof METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE
  | typeof METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE;

export type MetricCorrespondenceRejectionReason =
  | "not_floor_wall"
  | "not_accepted"
  | "missing_world_geometry"
  | "frame_truncated"
  | "overlay_unsafe"
  | "degenerate"
  | "too_short_in_image"
  | "ambiguous_competing_trace"
  | "registration_unavailable"
  | "other";

export type MetricCorrespondenceImagePoint = Readonly<{
  x: number;
  y: number;
}>;

export type MetricCorrespondenceWorldXz = Readonly<{
  x: number;
  z: number;
}>;

export type MetricCorrespondenceSpan = Readonly<{
  id: string;
  source: MetricCorrespondenceSpanSource;
  role: MetricCorrespondenceSpanRole;
  imageSpace: MetricCorrespondenceImageSpace;
  overlaySafeOnOriginal: boolean;
  imageA: MetricCorrespondenceImagePoint;
  imageB: MetricCorrespondenceImagePoint;
  canonicalWorldA: MetricCorrespondenceWorldXz;
  canonicalWorldB: MetricCorrespondenceWorldXz;
  canonicalLength: number;
  endpointAClass: MetricCorrespondenceEndpointClass;
  endpointBClass: MetricCorrespondenceEndpointClass;
  truncation: "none" | "one_end" | "both_ends";
  imageLengthNormalized: number;
  confidence: number;
  selectionReasons: readonly string[];
  lineage: Readonly<{
    s4aCandidateId: string | null;
    sourceSeamId: string | null;
    registrationClass: string | null;
  }>;
}>;

export type MetricCorrespondenceRejectedAlternative = Readonly<{
  id: string;
  role: MetricCorrespondenceSpanRole | "unknown";
  reason: MetricCorrespondenceRejectionReason;
}>;

export type MetricCorrespondenceSelection = Readonly<{
  schemaVersion: typeof AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION;
  authority: typeof AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY;
  selected: MetricCorrespondenceSpan | null;
  rejectedAlternatives: readonly MetricCorrespondenceRejectedAlternative[];
  selectionStatus: "selected" | "no_eligible_finite_span";
  selectionReasons: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function canonicalWorldSpanLength(
  a: MetricCorrespondenceWorldXz,
  b: MetricCorrespondenceWorldXz,
): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function imageSpanLengthNormalized(
  a: MetricCorrespondenceImagePoint,
  b: MetricCorrespondenceImagePoint,
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function metricCorrespondenceRoleCopy(
  role: MetricCorrespondenceSpanRole,
): string {
  return METRIC_CORRESPONDENCE_ROLE_COPY[role];
}

export function formatCanonicalGaugeUnits(length: number): string {
  return `${length.toFixed(2)} gauge units`;
}

export function emptyMetricCorrespondenceSelection(
  reasons: readonly string[] = ["no_eligible_finite_span"],
  rejectedAlternatives: readonly MetricCorrespondenceRejectedAlternative[] = [],
): MetricCorrespondenceSelection {
  return Object.freeze({
    schemaVersion: AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION,
    authority: AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY,
    selected: null,
    rejectedAlternatives: Object.freeze([...rejectedAlternatives]),
    selectionStatus: "no_eligible_finite_span",
    selectionReasons: Object.freeze([...reasons]),
  });
}

export function buildMetricCorrespondenceSelection(
  selected: MetricCorrespondenceSpan | null,
  rejectedAlternatives: readonly MetricCorrespondenceRejectedAlternative[],
  selectionReasons: readonly string[],
): MetricCorrespondenceSelection {
  if (!selected) {
    return emptyMetricCorrespondenceSelection(
      selectionReasons.length > 0
        ? selectionReasons
        : ["no_eligible_finite_span"],
      rejectedAlternatives,
    );
  }
  return Object.freeze({
    schemaVersion: AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION,
    authority: AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY,
    selected,
    rejectedAlternatives: Object.freeze([...rejectedAlternatives]),
    selectionStatus: "selected",
    selectionReasons: Object.freeze([...selectionReasons]),
  });
}

export function isMetricCorrespondenceSelection(
  value: unknown,
): value is MetricCorrespondenceSelection {
  return isRecord(value) &&
    value.schemaVersion === AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION &&
    value.authority === AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY &&
    (value.selectionStatus === "selected" ||
      value.selectionStatus === "no_eligible_finite_span");
}
