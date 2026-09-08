/**
 * Lab experiment: if Gemini explicitly reports a valid floor_wall seam,
 * trust that seam for EMPTY-authoritative collision after mechanical /
 * projection / runtime-safety checks only.
 *
 * Flag OFF preserves a80aad6 behavior exactly. Do not scatter ad-hoc
 * booleans; import `trustExplicitGeminiFloorWallObservation()` instead.
 */

import { FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE } from "./empty-room-observation-contract";
import { ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M } from "./room-boundary-authority-contract";
import type { RoomBoundaryCandidateStatus } from "./room-boundary-authority-contract";
import type { RoomCollisionWorldXyz, RoomCollisionWorldXz } from "./room-collision-authority-contract";

export const TRUST_EXPLICIT_GEMINI_FLOOR_WALL_OBSERVATION = true;

export const EXPLICIT_GEMINI_FLOOR_WALL_TRUST_SOURCE =
  "explicit_gemini_floor_wall" as const;

export const GENERAL_EMPTY_OBSERVER_SOURCE = "general_empty_observer" as const;

let trustOverride: boolean | null = null;

export function trustExplicitGeminiFloorWallObservation(): boolean {
  return trustOverride ?? TRUST_EXPLICIT_GEMINI_FLOOR_WALL_OBSERVATION;
}

/** Test/rollback helper. Production lab uses the default constant. */
export function setTrustExplicitGeminiFloorWallObservationForTests(
  enabled: boolean | null,
): void {
  trustOverride = enabled;
}

export function runWithTrustExplicitGeminiFloorWallObservation<T>(
  enabled: boolean,
  fn: () => T,
): T {
  const previous = trustOverride;
  trustOverride = enabled;
  try {
    return fn();
  } finally {
    trustOverride = previous;
  }
}

export type ExplicitGeminiFloorWallObserver = "general" | "focused";

export type ExplicitGeminiFloorWallExperimentalTrust = Readonly<{
  enabled: true;
  source: typeof EXPLICIT_GEMINI_FLOOR_WALL_TRUST_SOURCE;
  observer: ExplicitGeminiFloorWallObserver;
  geminiSeamId: string;
  confidence: number;
  priorQualificationStatus: RoomBoundaryCandidateStatus;
  priorQualificationReasons: readonly string[];
  semanticVetoBypassed: boolean;
  experimentalAcceptance: boolean;
  projectedFiniteSegment: Readonly<{
    a: RoomCollisionWorldXz;
    b: RoomCollisionWorldXz;
  }> | null;
  collisionEnabled: boolean;
  metricEligibleSeparately: boolean;
  conflict: "none" | "general_wins" | "general_competing_ambiguous";
}>;

export const FOCUSED_FLOOR_WALL_SEMANTIC_MERGE_REASONS = Object.freeze([
  "focused_rejected:side_geometry_mismatch",
  "focused_rejected:below_minimum_image_span",
  "focused_rejected:near_vertical_wall_wall_like",
  "focused_rejected:seam_not_near_floor_frontier",
  "focused_rejected:seam_not_near_wall_frontier",
  "focused_rejected:local_occupancy_incoherent",
  "focused_rejected:extends_beyond_reported_support",
  "focused_rejected:back_wall_continuation",
  "focused_rejected:ambiguous_general_wall_match",
  "focused_rejected:wall_wall_edge",
  "focused_rejected:wall_ceiling_edge",
] as const);

export const S4A_SEMANTIC_FLOOR_WALL_REASONS = Object.freeze([
  "near_vertical_image_seam_insufficient_as_floor_wall",
  "floor_occupancy_not_unique",
  "wall_occupancy_not_unique",
  "floor_occupancy_undetermined",
  "wall_occupancy_undetermined",
  "floor_and_wall_occupancy_not_opposite",
  "seam_not_near_floor_polygon_frontier",
  "seam_not_near_wall_polygon_frontier",
  "competing_same_wall_trace",
] as const);

export const S4B_SEMANTIC_FLOOR_WALL_REASONS = Object.freeze([
  "s4a_not_accepted",
  "two_point_region_corroboration_insufficient",
  "interior_camera_not_corroborated",
] as const);

export function isExplicitGeminiFloorWallObservation(input: {
  category: string;
  observationSource: string;
}): boolean {
  return input.category === "floor_wall" &&
    (input.observationSource === GENERAL_EMPTY_OBSERVER_SOURCE ||
      input.observationSource === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
}

export function explicitGeminiFloorWallObserver(
  observationSource: string,
): ExplicitGeminiFloorWallObserver | null {
  if (observationSource === GENERAL_EMPTY_OBSERVER_SOURCE) return "general";
  if (observationSource === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE) {
    return "focused";
  }
  return null;
}

export function imageSideFromPolyline(
  polyline: readonly Readonly<{ x: number; y: number }>[],
): "left" | "right" | "center" {
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  if (!start || !end) return "center";
  const x = (start.x + end.x) / 2;
  if (x <= 0.4) return "left";
  if (x >= 0.6) return "right";
  return "center";
}

export function collisionSideSignFromCameraAndPlane(
  supportPlane: Readonly<{
    normal: RoomCollisionWorldXyz;
    constant: number;
  }> | null | undefined,
  cameraPosition: Readonly<{ x: number; y: number; z: number }> | null | undefined,
): -1 | 1 | null {
  if (!supportPlane || !cameraPosition) return null;
  const distance = supportPlane.normal.x * cameraPosition.x +
    supportPlane.normal.y * cameraPosition.y +
    supportPlane.normal.z * cameraPosition.z +
    supportPlane.constant;
  if (!Number.isFinite(distance)) return null;
  if (Math.abs(distance) <= ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M) {
    return null;
  }
  return distance > 0 ? 1 : -1;
}

export function finiteWorldSegment(
  segment: Readonly<{
    a: RoomCollisionWorldXz;
    b: RoomCollisionWorldXz;
  }> | null | undefined,
  minLength = 1e-6,
): boolean {
  if (!segment) return false;
  const values = [segment.a.x, segment.a.z, segment.b.x, segment.b.z];
  if (values.some((value) => !Number.isFinite(value))) return false;
  const length = Math.hypot(segment.b.x - segment.a.x, segment.b.z - segment.a.z);
  return Number.isFinite(length) && length >= minLength;
}

export function finiteSupportPlane(
  plane: Readonly<{
    normal: RoomCollisionWorldXyz;
    constant: number;
  }> | null | undefined,
): boolean {
  if (!plane) return false;
  return [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant]
    .every((value) => Number.isFinite(value)) &&
    Math.hypot(plane.normal.x, plane.normal.z) > 1e-12;
}

export function reasonsIncludeSemanticVeto(
  reasons: readonly string[],
): boolean {
  const semantic = new Set<string>([
    ...FOCUSED_FLOOR_WALL_SEMANTIC_MERGE_REASONS,
    ...S4A_SEMANTIC_FLOOR_WALL_REASONS,
    ...S4B_SEMANTIC_FLOOR_WALL_REASONS,
  ]);
  return reasons.some((reason) => semantic.has(reason));
}
