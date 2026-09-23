/**
 * M2 observed-span metric candidate contract.
 *
 * Path B geometry authority is a metric-safe projected explicit Gemini
 * floor-wall segment. S4A semantic status is diagnostic, not eligibility.
 * Endpoint termination is diagnostic, not metric eligibility authority.
 * It is not completeness, width, depth, collision, ORIGINAL overlay,
 * or Auto authority.
 */

import type { RoomBoundaryCandidateStatus } from "./room-boundary-authority-contract";
import {
  METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE,
  type MetricCorrespondenceEndpointClass,
  type MetricCorrespondenceImagePoint,
  type MetricCorrespondenceSpanRole,
  type MetricCorrespondenceWorldXz,
} from "./metric-correspondence-span-contract";

export const AFC_V2_OBSERVED_SPAN_METRIC_SELECTION_VERSION =
  "afc-v2-observed-span-metric-selection/v1" as const;
export const AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY =
  "metric_safe_projected_observed_floor_wall" as const;
export const OBSERVED_SPAN_METRIC_GEOMETRY_CLASS =
  "metric_safe_projected_floor_wall" as const;
export const OBSERVED_SPAN_METRIC_GEOMETRY_SOURCE =
  "explicit_gemini_floor_wall" as const;
export const OBSERVED_SPAN_IMAGE_SPACE = METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE;

export const OBSERVED_SPAN_METRIC_LABEL = "Estimated Metric Span" as const;
export const OBSERVED_SPAN_METRIC_HELPER_COPY =
  "Auto from highlighted observed wall segment" as const;
export const OBSERVED_SPAN_METRIC_NOT_USED_COPY =
  "Complete back-wall geometry present — observed-span estimator not launched" as const;
export const OBSERVED_SPAN_METRIC_NOT_ELIGIBLE_COPY =
  "No eligible observed wall segment" as const;
export const OBSERVED_SPAN_METRIC_GEOMETRY_COPY =
  "Metric geometry: accepted for same-segment measurement" as const;
export const OBSERVED_SPAN_SEMANTIC_S4A_BYPASSED_COPY =
  "Semantic S4A qualification bypassed for metric: yes" as const;
export const OBSERVED_SPAN_COLLISION_AUTHORITY_SEPARATE_COPY =
  "Collision authority: separate / not claimed" as const;

export type ObservedSpanJunctionProofType =
  | "two_accepted_s4a_floor_wall"
  | "wall_wall_corroboration";

export type ObservedSpanEndpointId = "A" | "B";

export type ObservedSpanMetricRejectionReason =
  | "path_a_complete_back_geometry_present"
  | "not_floor_wall"
  | "not_accepted"
  | "observer_source_not_empty_floor_wall"
  | "observer_ambiguity"
  | "missing_source_seam"
  | "missing_wall_plane"
  | "missing_world_geometry"
  | "malformed_projection"
  | "opening_crossing"
  | "competing_same_wall"
  | "degenerate"
  | "too_short_in_image"
  | "hidden_continuation"
  | "geometry_manufactured"
  | "complete_wall_claim"
  | "collision_only_trusted"
  | "other";

export type ObservedSpanMetricGeometryTrust = Readonly<{
  class: typeof OBSERVED_SPAN_METRIC_GEOMETRY_CLASS;
  source: typeof OBSERVED_SPAN_METRIC_GEOMETRY_SOURCE;
  s4aStatus: RoomBoundaryCandidateStatus;
  s4aReasons: readonly string[];
  projectionValid: true;
  canonicalLengthValid: true;
  semanticQualificationBypassed: boolean;
  metricEligible: true;
}>;

export type ObservedSpanJunctionProof = Readonly<{
  type: ObservedSpanJunctionProofType;
  endpoint: ObservedSpanEndpointId;
  mateCandidateId: string | null;
  mateSourceSeamId: string | null;
  imageDistance: number;
  worldDistance: number | null;
  roomCornerDiagnosticOnly: boolean;
}>;

export type ObservedSpanMetricCandidate = Readonly<{
  id: string;
  source: "s4a_floor_wall";
  role: MetricCorrespondenceSpanRole;
  imageSpace: typeof OBSERVED_SPAN_IMAGE_SPACE;
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
  ambiguity: string | null;
  junction: ObservedSpanJunctionProof | null;
  frameAdjacentEndpoint: ObservedSpanEndpointId | null;
  openingCrossing: false;
  overlaySafeOnOriginal: boolean;
  selectionReasons: readonly string[];
  metricGeometryTrust: ObservedSpanMetricGeometryTrust;
  lineage: Readonly<{
    s4aCandidateId: string;
    sourceSeamId: string;
    wallPlaneId: string;
    observationSource: string;
    lineResidualClass: "supported" | "underdetermined";
  }>;
}>;

export type ObservedSpanRejectedAlternative = Readonly<{
  id: string;
  role: MetricCorrespondenceSpanRole | "unknown";
  reason: ObservedSpanMetricRejectionReason;
}>;

export type ObservedSpanPathAGeometry = Readonly<{
  exists: boolean;
  selectedId: string | null;
  reasons: readonly string[];
}>;

export type ObservedSpanMetricSelection = Readonly<{
  schemaVersion: typeof AFC_V2_OBSERVED_SPAN_METRIC_SELECTION_VERSION;
  authority: typeof AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY;
  selected: ObservedSpanMetricCandidate | null;
  rejectedAlternatives: readonly ObservedSpanRejectedAlternative[];
  selectionStatus: "selected" | "no_eligible_observed_span" | "suppressed_by_path_a";
  selectionReasons: readonly string[];
  pathAGeometry: ObservedSpanPathAGeometry;
  estimatorLaunched: boolean;
  collisionExperimentIgnoredForMetric: true;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function emptyObservedSpanMetricSelection(
  reasons: readonly string[],
  extras: Readonly<{
    rejectedAlternatives?: readonly ObservedSpanRejectedAlternative[];
    pathAGeometry?: ObservedSpanPathAGeometry;
    estimatorLaunched?: boolean;
    selectionStatus?: ObservedSpanMetricSelection["selectionStatus"];
  }> = {},
): ObservedSpanMetricSelection {
  return Object.freeze({
    schemaVersion: AFC_V2_OBSERVED_SPAN_METRIC_SELECTION_VERSION,
    authority: AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY,
    selected: null,
    rejectedAlternatives: Object.freeze([
      ...(extras.rejectedAlternatives ?? []),
    ]),
    selectionStatus: extras.selectionStatus ?? "no_eligible_observed_span",
    selectionReasons: Object.freeze([...reasons]),
    pathAGeometry: extras.pathAGeometry ?? Object.freeze({
      exists: false,
      selectedId: null,
      reasons: Object.freeze(["complete_back_geometry_absent"]),
    }),
    estimatorLaunched: extras.estimatorLaunched === true,
    collisionExperimentIgnoredForMetric: true,
  });
}

export function buildObservedSpanMetricSelection(
  selected: ObservedSpanMetricCandidate | null,
  rejectedAlternatives: readonly ObservedSpanRejectedAlternative[],
  selectionReasons: readonly string[],
  pathAGeometry: ObservedSpanPathAGeometry,
  estimatorLaunched: boolean,
): ObservedSpanMetricSelection {
  if (!selected) {
    return emptyObservedSpanMetricSelection(
      selectionReasons.length > 0
        ? selectionReasons
        : ["no_eligible_observed_span"],
      {
        rejectedAlternatives,
        pathAGeometry,
        estimatorLaunched: false,
        selectionStatus: pathAGeometry.exists
          ? "suppressed_by_path_a"
          : "no_eligible_observed_span",
      },
    );
  }
  return Object.freeze({
    schemaVersion: AFC_V2_OBSERVED_SPAN_METRIC_SELECTION_VERSION,
    authority: AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY,
    selected,
    rejectedAlternatives: Object.freeze([...rejectedAlternatives]),
    selectionStatus: "selected",
    selectionReasons: Object.freeze([...selectionReasons]),
    pathAGeometry,
    estimatorLaunched,
    collisionExperimentIgnoredForMetric: true,
  });
}

export function isObservedSpanMetricSelection(
  value: unknown,
): value is ObservedSpanMetricSelection {
  return isRecord(value) &&
    value.schemaVersion === AFC_V2_OBSERVED_SPAN_METRIC_SELECTION_VERSION &&
    value.authority === AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY;
}

export function observedSpanEndpointDiagnosticCopy(
  endpointClass: MetricCorrespondenceEndpointClass,
): string {
  switch (endpointClass) {
    case "frame_adjacent":
      return "frame-adjacent";
    case "observed_junction":
      return "observed junction";
    case "observed_interior":
      return "observed interior";
    case "inferred":
      return "inferred";
  }
}

export function observedSpanTruncationDiagnosticCopy(
  truncation: ObservedSpanMetricCandidate["truncation"],
): string | null {
  if (truncation === "none") return null;
  return truncation === "one_end" ? "one end" : "both ends";
}
