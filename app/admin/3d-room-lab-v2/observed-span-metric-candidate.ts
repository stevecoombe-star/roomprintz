/**
 * Pure host selection of one M2 observed-span metric candidate.
 *
 * Independent of Path A complete-back selection. Does not widen
 * selectMetricCorrespondenceSpan. Collision experimental trust is ignored.
 */

import {
  FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE,
  type EmptyObservedJunction,
  type EmptyObservedOpening,
  type EmptyObservedSeam,
  type SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import {
  evaluateTrustedBackWallWidthSpan,
} from "./metric-auto-scale";
import { AUTO_METRIC_CANONICAL_LENGTH_EPSILON } from "./metric-auto-scale-contract";
import {
  canonicalWorldSpanLength,
  imageSpanLengthNormalized,
  METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED,
  type MetricCorrespondenceEndpointClass,
  type MetricCorrespondenceImagePoint,
  type MetricCorrespondenceSpanRole,
  type MetricCorrespondenceWorldXz,
} from "./metric-correspondence-span-contract";
import {
  deriveMetricCorrespondenceSpanRole,
  selectMetricCorrespondenceSpan,
  type MetricCorrespondenceCameraPose,
} from "./metric-correspondence-span";
import {
  OBSERVED_SPAN_IMAGE_SPACE,
  OBSERVED_SPAN_METRIC_GEOMETRY_CLASS,
  OBSERVED_SPAN_METRIC_GEOMETRY_SOURCE,
  buildObservedSpanMetricSelection,
  emptyObservedSpanMetricSelection,
  type ObservedSpanEndpointId,
  type ObservedSpanJunctionProof,
  type ObservedSpanMetricCandidate,
  type ObservedSpanMetricGeometryTrust,
  type ObservedSpanMetricRejectionReason,
  type ObservedSpanMetricSelection,
  type ObservedSpanPathAGeometry,
  type ObservedSpanRejectedAlternative,
} from "./observed-span-metric-candidate-contract";
import { floorWallPolylineCrossesOpeningInterior } from "./room-opening-intersection-geometry";
import {
  ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M,
  ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD,
  ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO,
  ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY,
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  type RoomBoundaryCandidate,
  type RoomBoundaryWorldGeometry,
} from "./room-boundary-authority-contract";

export type ObservedSpanMetricSelectionInput = Readonly<{
  roomBoundary: {
    readonly candidates: readonly RoomBoundaryCandidate[];
    readonly lineage?: {
      readonly camera?: {
        readonly pose?: MetricCorrespondenceCameraPose;
      };
    };
  } | null | undefined;
  roomCollision?: {
    readonly boundaries: readonly {
      readonly sourceBoundaryId: string;
      readonly corroboration: { readonly openingCrossing: boolean };
    }[];
  } | null;
  observation?: {
    readonly observedSeams?: readonly EmptyObservedSeam[];
    readonly observedOpenings?: readonly EmptyObservedOpening[];
    readonly observedJunctions?: readonly EmptyObservedJunction[];
  } | null;
  suppressWhenCompleteBackGeometryExists?: boolean;
  overlaySafeOnOriginal?: boolean;
}>;

type RankedEligible = Readonly<{
  candidate: ObservedSpanMetricCandidate;
  residualRank: number;
  ambiguityRank: number;
  metricWorldGeometry: RoomBoundaryWorldGeometry;
}>;

const GENERAL_EMPTY_OBSERVER_SOURCE = "general_empty_observer" as const;

function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pointIsFrameAdjacent(point: MetricCorrespondenceImagePoint): boolean {
  return Math.min(point.x, 1 - point.x, point.y, 1 - point.y) <=
    ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY;
}

/**
 * Per-endpoint classification from the exact observed polyline point.
 * One frame-adjacent end must not pollute the opposite end.
 */
export function classifyObservedSpanEndpoint(
  point: MetricCorrespondenceImagePoint,
): Exclude<MetricCorrespondenceEndpointClass, "observed_junction" | "inferred"> {
  if (pointIsFrameAdjacent(point)) return "frame_adjacent";
  return "observed_interior";
}

function truncationFromEndpoints(
  endpointAClass: MetricCorrespondenceEndpointClass,
  endpointBClass: MetricCorrespondenceEndpointClass,
): "none" | "one_end" | "both_ends" {
  const a = endpointAClass === "frame_adjacent";
  const b = endpointBClass === "frame_adjacent";
  if (a && b) return "both_ends";
  if (a || b) return "one_end";
  return "none";
}

function reject(
  id: string,
  role: MetricCorrespondenceSpanRole | "unknown",
  reason: ObservedSpanMetricRejectionReason,
): ObservedSpanRejectedAlternative {
  return Object.freeze({ id, role, reason });
}

function imageDistance(
  a: MetricCorrespondenceImagePoint,
  b: MetricCorrespondenceImagePoint,
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function worldDistance(
  a: MetricCorrespondenceWorldXz,
  b: MetricCorrespondenceWorldXz,
): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function s4aEmptyEndpoints(candidate: RoomBoundaryCandidate): {
  imageA: MetricCorrespondenceImagePoint;
  imageB: MetricCorrespondenceImagePoint;
  worldA: MetricCorrespondenceWorldXz;
  worldB: MetricCorrespondenceWorldXz;
} | null {
  const polyline = candidate.imageEvidence.polyline;
  if (polyline.length < 2) return null;
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  if (
    !first || !last ||
    !finiteNumber(first.x) || !finiteNumber(first.y) ||
    !finiteNumber(last.x) || !finiteNumber(last.y)
  ) {
    return null;
  }
  const points = candidate.projection.points;
  if (points.length < 2) return null;
  const firstProj = points[0];
  const lastProj = points[points.length - 1];
  if (!firstProj?.ok || !lastProj?.ok) return null;
  if (
    !finiteNumber(firstProj.world.x) || !finiteNumber(firstProj.world.z) ||
    !finiteNumber(lastProj.world.x) || !finiteNumber(lastProj.world.z)
  ) {
    return null;
  }
  return {
    imageA: Object.freeze({ x: first.x, y: first.y }),
    imageB: Object.freeze({ x: last.x, y: last.y }),
    worldA: Object.freeze({ x: firstProj.world.x, z: firstProj.world.z }),
    worldB: Object.freeze({ x: lastProj.world.x, z: lastProj.world.z }),
  };
}

function orderWorldToImage(
  imageAWorld: MetricCorrespondenceWorldXz | null,
  worldA: MetricCorrespondenceWorldXz,
  worldB: MetricCorrespondenceWorldXz,
): readonly [MetricCorrespondenceWorldXz, MetricCorrespondenceWorldXz] {
  if (!imageAWorld) return [worldA, worldB];
  const toA = Math.hypot(imageAWorld.x - worldA.x, imageAWorld.z - worldA.z);
  const toB = Math.hypot(imageAWorld.x - worldB.x, imageAWorld.z - worldB.z);
  return toB < toA ? [worldB, worldA] : [worldA, worldB];
}

function competingSameWall(
  first: RoomBoundaryWorldGeometry,
  second: RoomBoundaryWorldGeometry,
): boolean {
  const firstLength = Math.hypot(first.tangent.x, first.tangent.z);
  const secondLength = Math.hypot(second.tangent.x, second.tangent.z);
  if (firstLength <= 1e-12 || secondLength <= 1e-12) return false;
  const firstTangent = {
    x: first.tangent.x / firstLength,
    z: first.tangent.z / firstLength,
  };
  const secondTangent = {
    x: second.tangent.x / secondLength,
    z: second.tangent.z / secondLength,
  };
  const absDot = Math.min(
    1,
    Math.abs(
      firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z,
    ),
  );
  const orientation = Math.acos(absDot);
  if (orientation > ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD) return false;

  const lateral = Math.max(
    pointToInfiniteXzLineDistance(first.baseStart, second),
    pointToInfiniteXzLineDistance(first.baseEnd, second),
    pointToInfiniteXzLineDistance(second.baseStart, first),
    pointToInfiniteXzLineDistance(second.baseEnd, first),
  );
  if (lateral > ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M) return false;

  const aligned =
    firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z >= 0;
  const axis = {
    x: firstTangent.x + (aligned ? secondTangent.x : -secondTangent.x),
    z: firstTangent.z + (aligned ? secondTangent.z : -secondTangent.z),
  };
  const axisLength = Math.hypot(axis.x, axis.z);
  if (axisLength <= 1e-12) return false;
  const unit = { x: axis.x / axisLength, z: axis.z / axisLength };
  const firstA = first.baseStart.x * unit.x + first.baseStart.z * unit.z;
  const firstB = first.baseEnd.x * unit.x + first.baseEnd.z * unit.z;
  const secondA = second.baseStart.x * unit.x + second.baseStart.z * unit.z;
  const secondB = second.baseEnd.x * unit.x + second.baseEnd.z * unit.z;
  const overlap = intervalOverlap(firstA, firstB, secondA, secondB);
  const minSpan = Math.min(Math.abs(firstB - firstA), Math.abs(secondB - secondA));
  if (minSpan <= 1e-12) return false;
  return overlap / minSpan >= ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO;
}

function pointToInfiniteXzLineDistance(
  point: Readonly<{ x: number; z: number }>,
  geometry: RoomBoundaryWorldGeometry,
): number {
  const length = Math.hypot(geometry.tangent.x, geometry.tangent.z);
  if (length <= 1e-12) return Number.POSITIVE_INFINITY;
  const unit = { x: geometry.tangent.x / length, z: geometry.tangent.z / length };
  return Math.abs(
    (point.x - geometry.baseStart.x) * unit.z -
      (point.z - geometry.baseStart.z) * unit.x,
  );
}

function intervalOverlap(a0: number, a1: number, b0: number, b1: number): number {
  const left = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const right = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, right - left);
}

function competingSameWallTrace(candidate: RoomBoundaryCandidate): boolean {
  return candidate.reasons.includes("competing_same_wall_trace");
}

function emptyFloorWallObserverSource(source: string): boolean {
  return source === GENERAL_EMPTY_OBSERVER_SOURCE ||
    source === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE;
}

function worldGeometryFromProjectedEndpoints(
  worldA: MetricCorrespondenceWorldXz,
  worldB: MetricCorrespondenceWorldXz,
): RoomBoundaryWorldGeometry | null {
  const dx = worldB.x - worldA.x;
  const dz = worldB.z - worldA.z;
  const length = Math.hypot(dx, dz);
  if (!finiteNumber(length) || length <= AUTO_METRIC_CANONICAL_LENGTH_EPSILON) {
    return null;
  }
  const tangent = { x: dx / length, y: 0, z: dz / length };
  const supportPlaneNormal = { x: -tangent.z, y: 0, z: tangent.x };
  return {
    baseStart: { x: worldA.x, y: 0, z: worldA.z },
    baseEnd: { x: worldB.x, y: 0, z: worldB.z },
    tangent,
    supportPlaneNormal,
    supportPlaneConstant:
      -(supportPlaneNormal.x * worldA.x + supportPlaneNormal.z * worldA.z),
  };
}

export type MetricSafeProjectedFloorWallOk = Readonly<{
  ok: true;
  sourceSeamId: string;
  wallPlaneId: string;
  imageA: MetricCorrespondenceImagePoint;
  imageB: MetricCorrespondenceImagePoint;
  canonicalWorldA: MetricCorrespondenceWorldXz;
  canonicalWorldB: MetricCorrespondenceWorldXz;
  canonicalLength: number;
  imageLengthNormalized: number;
  metricWorldGeometry: RoomBoundaryWorldGeometry;
}>;

export type MetricSafeProjectedFloorWallResult =
  | MetricSafeProjectedFloorWallOk
  | Readonly<{ ok: false; reason: ObservedSpanMetricRejectionReason }>;

/**
 * Path B metric denominator eligibility. Inspects mechanical projected
 * fields. Does not require S4A semantic status, occupancy uniqueness,
 * interior witness, support-plane authority, or collision authority.
 */
export function isMetricSafeProjectedFloorWall(
  candidate: RoomBoundaryCandidate,
  extras: Readonly<{
    observation?: ObservedSpanMetricSelectionInput["observation"];
    roomCollision?: ObservedSpanMetricSelectionInput["roomCollision"];
  }> = {},
): MetricSafeProjectedFloorWallResult {
  if (candidate.source.category !== "floor_wall") {
    return { ok: false, reason: "not_floor_wall" };
  }
  if (!emptyFloorWallObserverSource(candidate.source.observationSource)) {
    return { ok: false, reason: "observer_source_not_empty_floor_wall" };
  }
  if (candidate.source.ambiguity !== null) {
    return { ok: false, reason: "observer_ambiguity" };
  }
  if (competingSameWallTrace(candidate)) {
    return { ok: false, reason: "competing_same_wall" };
  }
  if (!validId(candidate.sourceSeamId)) {
    return { ok: false, reason: "missing_source_seam" };
  }
  const sourceSeamId = candidate.sourceSeamId;
  if (!validId(candidate.source.wallPlaneId)) {
    return { ok: false, reason: "missing_wall_plane" };
  }
  const wallPlaneId = candidate.source.wallPlaneId;
  if (candidate.limitations.hiddenContinuation) {
    return { ok: false, reason: "hidden_continuation" };
  }
  if (candidate.limitations.geometryManufactured) {
    return { ok: false, reason: "geometry_manufactured" };
  }
  if (candidate.limitations.completeWall) {
    return { ok: false, reason: "complete_wall_claim" };
  }
  if (candidate.limitations.observedSpanOnly !== true) {
    return { ok: false, reason: "other" };
  }
  const endpoints = s4aEmptyEndpoints(candidate);
  if (!endpoints) {
    return { ok: false, reason: "malformed_projection" };
  }
  const openings = extras.observation?.observedOpenings ?? [];
  const openingCrossing = s4bOpeningCrossing(candidate.id, extras.roomCollision) ||
    floorWallPolylineCrossesOpeningInterior(candidate.imageEvidence.polyline, openings);
  if (openingCrossing) {
    return { ok: false, reason: "opening_crossing" };
  }
  const [canonicalWorldA, canonicalWorldB] = orderWorldToImage(
    endpoints.worldA,
    endpoints.worldA,
    endpoints.worldB,
  );
  const canonicalLength = canonicalWorldSpanLength(canonicalWorldA, canonicalWorldB);
  if (
    !finiteNumber(canonicalLength) ||
    canonicalLength <= AUTO_METRIC_CANONICAL_LENGTH_EPSILON
  ) {
    return { ok: false, reason: "degenerate" };
  }
  const imageLength = imageSpanLengthNormalized(endpoints.imageA, endpoints.imageB);
  if (
    !finiteNumber(imageLength) ||
    imageLength < METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED
  ) {
    return { ok: false, reason: "too_short_in_image" };
  }
  const metricWorldGeometry = worldGeometryFromProjectedEndpoints(
    canonicalWorldA,
    canonicalWorldB,
  );
  if (!metricWorldGeometry) {
    return { ok: false, reason: "degenerate" };
  }
  return {
    ok: true,
    sourceSeamId,
    wallPlaneId,
    imageA: endpoints.imageA,
    imageB: endpoints.imageB,
    canonicalWorldA,
    canonicalWorldB,
    canonicalLength,
    imageLengthNormalized: imageLength,
    metricWorldGeometry,
  };
}

function s4bOpeningCrossing(
  candidateId: string,
  roomCollision: ObservedSpanMetricSelectionInput["roomCollision"],
): boolean {
  return roomCollision?.boundaries.some((boundary) =>
    boundary.sourceBoundaryId === candidateId &&
    boundary.corroboration.openingCrossing === true
  ) === true;
}

function openingJambNear(
  point: MetricCorrespondenceImagePoint,
  junctions: readonly EmptyObservedJunction[],
): boolean {
  return junctions.some((junction) =>
    junction.category === "opening_boundary_intersection" &&
    imageDistance(point, junction.sourceNormalizedPoint) <=
      ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE
  );
}

function roomCornerNear(
  point: MetricCorrespondenceImagePoint,
  junctions: readonly EmptyObservedJunction[],
): boolean {
  return junctions.some((junction) =>
    junction.category === "room_corner" &&
    imageDistance(point, junction.sourceNormalizedPoint) <=
      ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE
  );
}

function mateWorldEndpoints(
  candidate: RoomBoundaryCandidate,
): readonly [MetricCorrespondenceWorldXz, MetricCorrespondenceWorldXz] | null {
  if (candidate.worldGeometry) {
    return [
      { x: candidate.worldGeometry.baseStart.x, z: candidate.worldGeometry.baseStart.z },
      { x: candidate.worldGeometry.baseEnd.x, z: candidate.worldGeometry.baseEnd.z },
    ];
  }
  const endpoints = s4aEmptyEndpoints(candidate);
  if (!endpoints) return null;
  return [endpoints.worldA, endpoints.worldB];
}

function mateImageEndpoints(
  candidate: RoomBoundaryCandidate,
): readonly [MetricCorrespondenceImagePoint, MetricCorrespondenceImagePoint] | null {
  const polyline = candidate.imageEvidence.polyline;
  if (polyline.length < 2) return null;
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  if (!first || !last) return null;
  return [first, last];
}

/**
 * Optional diagnostic junction annotation. Failure does not disqualify
 * an otherwise eligible exact observed span.
 */
export function certifyObservedSpanJunction(input: Readonly<{
  endpoint: MetricCorrespondenceImagePoint;
  world: MetricCorrespondenceWorldXz;
  candidate: RoomBoundaryCandidate;
  others: readonly RoomBoundaryCandidate[];
  observation: ObservedSpanMetricSelectionInput["observation"];
}>): ObservedSpanJunctionProof | null {
  if (pointIsFrameAdjacent(input.endpoint)) return null;
  const junctions = input.observation?.observedJunctions ?? [];
  if (openingJambNear(input.endpoint, junctions)) return null;

  const wallPlaneId = input.candidate.source.wallPlaneId;
  if (!validId(wallPlaneId)) return null;

  for (const other of input.others) {
    if (other.id === input.candidate.id) continue;
    if (other.source.category !== "floor_wall") continue;
    if (other.status !== "accepted") continue;
    if (competingSameWallTrace(other)) continue;
    if (!validId(other.source.wallPlaneId)) continue;
    if (other.source.wallPlaneId === wallPlaneId) continue;
    if (!other.worldGeometry || !input.candidate.worldGeometry) continue;
    if (competingSameWall(input.candidate.worldGeometry, other.worldGeometry)) {
      continue;
    }
    const images = mateImageEndpoints(other);
    const worlds = mateWorldEndpoints(other);
    if (!images || !worlds) continue;
    for (let index = 0; index < 2; index += 1) {
      const imageGap = imageDistance(input.endpoint, images[index]!);
      const worldGap = worldDistance(input.world, worlds[index]!);
      if (
        imageGap <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE &&
        worldGap <= ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M
      ) {
        return Object.freeze({
          type: "two_accepted_s4a_floor_wall",
          endpoint: "A",
          mateCandidateId: other.id,
          mateSourceSeamId: other.sourceSeamId,
          imageDistance: imageGap,
          worldDistance: worldGap,
          roomCornerDiagnosticOnly: roomCornerNear(input.endpoint, junctions),
        });
      }
    }
  }

  const wallWalls = (input.observation?.observedSeams ?? []).filter(
    (seam) => seam.category === "wall_wall",
  );
  for (const seam of wallWalls) {
    if (!seam.planeIds.includes(wallPlaneId)) continue;
    const polyline = seam.sourceNormalizedPolyline;
    if (polyline.length < 1) continue;
    const ends: SourceNormalizedPoint[] = [polyline[0]!];
    if (polyline.length > 1) ends.push(polyline[polyline.length - 1]!);
    for (const end of ends) {
      const imageGap = imageDistance(input.endpoint, end);
      if (imageGap <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE) {
        return Object.freeze({
          type: "wall_wall_corroboration",
          endpoint: "A",
          mateCandidateId: null,
          mateSourceSeamId: seam.id,
          imageDistance: imageGap,
          worldDistance: null,
          roomCornerDiagnosticOnly: roomCornerNear(input.endpoint, junctions),
        });
      }
    }
  }

  return null;
}

function freezeCandidate(
  candidate: ObservedSpanMetricCandidate,
): ObservedSpanMetricCandidate {
  return Object.freeze({
    ...candidate,
    imageA: Object.freeze({ ...candidate.imageA }),
    imageB: Object.freeze({ ...candidate.imageB }),
    canonicalWorldA: Object.freeze({ ...candidate.canonicalWorldA }),
    canonicalWorldB: Object.freeze({ ...candidate.canonicalWorldB }),
    junction: candidate.junction
      ? Object.freeze({ ...candidate.junction })
      : null,
    selectionReasons: Object.freeze([...candidate.selectionReasons]),
    metricGeometryTrust: Object.freeze({
      ...candidate.metricGeometryTrust,
      s4aReasons: Object.freeze([...candidate.metricGeometryTrust.s4aReasons]),
    }),
    lineage: Object.freeze({ ...candidate.lineage }),
  });
}

function residualRank(
  lineResidualClass: "supported" | "underdetermined" | null,
): number {
  return lineResidualClass === "supported" ? 0 : 1;
}

function compareEligible(left: RankedEligible, right: RankedEligible): number {
  const image = right.candidate.imageLengthNormalized -
    left.candidate.imageLengthNormalized;
  if (image !== 0) return image;
  const confidence = right.candidate.confidence - left.candidate.confidence;
  if (confidence !== 0) return confidence;
  const residual = left.residualRank - right.residualRank;
  if (residual !== 0) return residual;
  const canonical = right.candidate.canonicalLength - left.candidate.canonicalLength;
  if (canonical !== 0) return canonical;
  const ambiguity = left.ambiguityRank - right.ambiguityRank;
  if (ambiguity !== 0) return ambiguity;
  const id = left.candidate.id.localeCompare(right.candidate.id);
  if (id !== 0) return id;
  return left.candidate.lineage.sourceSeamId.localeCompare(
    right.candidate.lineage.sourceSeamId,
  );
}

function evaluateCandidate(input: {
  candidate: RoomBoundaryCandidate;
  others: readonly RoomBoundaryCandidate[];
  cameraPose: MetricCorrespondenceCameraPose | null;
  observation: ObservedSpanMetricSelectionInput["observation"];
  roomCollision: ObservedSpanMetricSelectionInput["roomCollision"];
  overlaySafeOnOriginal: boolean;
}):
  | { ok: true; eligible: RankedEligible }
  | { ok: false; rejected: ObservedSpanRejectedAlternative }
{
  const candidate = input.candidate;
  const metricSafe = isMetricSafeProjectedFloorWall(candidate, {
    observation: input.observation,
    roomCollision: input.roomCollision,
  });
  const roleGuess = metricSafe.ok
    ? deriveMetricCorrespondenceSpanRole(
      metricSafe.metricWorldGeometry,
      input.cameraPose,
    )
    : candidate.worldGeometry
      ? deriveMetricCorrespondenceSpanRole(candidate.worldGeometry, input.cameraPose)
      : "unknown";
  if (!metricSafe.ok) {
    return { ok: false, rejected: reject(candidate.id, roleGuess, metricSafe.reason) };
  }

  const endpointARaw = classifyObservedSpanEndpoint(metricSafe.imageA);
  const endpointBRaw = classifyObservedSpanEndpoint(metricSafe.imageB);
  const truncation = truncationFromEndpoints(endpointARaw, endpointBRaw);

  const proofA = certifyObservedSpanJunction({
    endpoint: metricSafe.imageA,
    world: metricSafe.canonicalWorldA,
    candidate,
    others: input.others,
    observation: input.observation,
  });
  const proofB = certifyObservedSpanJunction({
    endpoint: metricSafe.imageB,
    world: metricSafe.canonicalWorldB,
    candidate,
    others: input.others,
    observation: input.observation,
  });
  const recordedJunction: ObservedSpanJunctionProof | null = proofA
    ? Object.freeze({ ...proofA, endpoint: "A" })
    : proofB
      ? Object.freeze({ ...proofB, endpoint: "B" })
      : null;
  const endpointAClass: MetricCorrespondenceEndpointClass = proofA
    ? "observed_junction"
    : endpointARaw;
  const endpointBClass: MetricCorrespondenceEndpointClass = proofB
    ? "observed_junction"
    : endpointBRaw;
  const frameAdjacentEndpoint: ObservedSpanEndpointId | null =
    truncation === "one_end"
      ? endpointARaw === "frame_adjacent" ? "A" : "B"
      : null;

  const role = deriveMetricCorrespondenceSpanRole(
    metricSafe.metricWorldGeometry,
    input.cameraPose,
  );
  const semanticQualificationBypassed = candidate.status !== "accepted";
  const metricGeometryTrust: ObservedSpanMetricGeometryTrust = Object.freeze({
    class: OBSERVED_SPAN_METRIC_GEOMETRY_CLASS,
    source: OBSERVED_SPAN_METRIC_GEOMETRY_SOURCE,
    s4aStatus: candidate.status,
    s4aReasons: Object.freeze([...candidate.reasons]),
    projectionValid: true as const,
    canonicalLengthValid: true as const,
    semanticQualificationBypassed,
    metricEligible: true as const,
  });
  const span = freezeCandidate({
    id: candidate.id,
    source: "s4a_floor_wall",
    role,
    imageSpace: OBSERVED_SPAN_IMAGE_SPACE,
    imageA: metricSafe.imageA,
    imageB: metricSafe.imageB,
    canonicalWorldA: metricSafe.canonicalWorldA,
    canonicalWorldB: metricSafe.canonicalWorldB,
    canonicalLength: metricSafe.canonicalLength,
    endpointAClass,
    endpointBClass,
    truncation,
    imageLengthNormalized: metricSafe.imageLengthNormalized,
    confidence: candidate.source.confidence,
    ambiguity: candidate.source.ambiguity,
    junction: recordedJunction,
    frameAdjacentEndpoint,
    openingCrossing: false,
    overlaySafeOnOriginal: input.overlaySafeOnOriginal,
    selectionReasons: Object.freeze([
      OBSERVED_SPAN_METRIC_GEOMETRY_CLASS,
      ...(candidate.status === "accepted" ? ["accepted_s4a_floor_wall"] : []),
      ...(semanticQualificationBypassed
        ? ["semantic_s4a_qualification_bypassed_for_metric"]
        : []),
      "exact_observed_span",
      "observed_span_only",
      `truncation_${truncation}`,
      recordedJunction ? `junction_${recordedJunction.type}` : "junction_none",
      `role_${role}`,
    ]),
    metricGeometryTrust,
    lineage: {
      s4aCandidateId: candidate.id,
      sourceSeamId: metricSafe.sourceSeamId,
      wallPlaneId: metricSafe.wallPlaneId,
      observationSource: candidate.source.observationSource,
      lineResidualClass: candidate.imageEvidence.lineResidualClass,
    },
  });
  return {
    ok: true,
    eligible: {
      candidate: span,
      residualRank: residualRank(candidate.imageEvidence.lineResidualClass),
      ambiguityRank: candidate.source.ambiguity ? 1 : 0,
      metricWorldGeometry: metricSafe.metricWorldGeometry,
    },
  };
}

export function inspectCompleteBackWallMetricGeometry(
  roomBoundary: ObservedSpanMetricSelectionInput["roomBoundary"],
): ObservedSpanPathAGeometry {
  const selection = selectMetricCorrespondenceSpan({
    roomBoundary,
    registration: null,
    originalLocalizedBoundary: null,
    originalLocalizationClass: null,
  });
  const selected = selection.selected;
  if (!selected) {
    return Object.freeze({
      exists: false,
      selectedId: null,
      reasons: Object.freeze(["complete_back_geometry_absent"]),
    });
  }
  const s4a = roomBoundary?.candidates.find((item) => item.id === selected.id) ??
    null;
  const trust = evaluateTrustedBackWallWidthSpan(
    selected,
    s4a
      ? {
        observedSpanOnly: s4a.limitations.observedSpanOnly,
        hiddenContinuation: s4a.limitations.hiddenContinuation,
        geometryManufactured: s4a.limitations.geometryManufactured,
      }
      : null,
  );
  return Object.freeze({
    exists: trust.trusted,
    selectedId: selected.id,
    reasons: trust.trusted
      ? Object.freeze(["complete_back_wall_geometry_present", ...trust.reasons])
      : Object.freeze(["complete_back_geometry_absent", ...trust.reasons]),
  });
}

function selectUnchecked(
  input: ObservedSpanMetricSelectionInput,
): ObservedSpanMetricSelection {
  const pathAGeometry = inspectCompleteBackWallMetricGeometry(input.roomBoundary);
  const suppress = input.suppressWhenCompleteBackGeometryExists !== false;
  if (suppress && pathAGeometry.exists) {
    return emptyObservedSpanMetricSelection(
      [
        "complete_back_wall_geometry_present",
        "observed_span_estimator_not_launched",
      ],
      {
        pathAGeometry,
        estimatorLaunched: false,
        selectionStatus: "suppressed_by_path_a",
      },
    );
  }

  const s4aCandidates = input.roomBoundary?.candidates ?? [];
  const cameraPose = input.roomBoundary?.lineage?.camera?.pose ?? null;
  const rejected: ObservedSpanRejectedAlternative[] = [];
  const eligible: RankedEligible[] = [];

  for (const candidate of s4aCandidates) {
    const result = evaluateCandidate({
      candidate,
      others: s4aCandidates,
      cameraPose,
      observation: input.observation,
      roomCollision: input.roomCollision,
      overlaySafeOnOriginal: input.overlaySafeOnOriginal === true,
    });
    if (result.ok) {
      eligible.push(result.eligible);
    } else {
      rejected.push(result.rejected);
    }
  }

  const competingIds = new Set<string>();
  for (let first = 0; first < eligible.length; first += 1) {
    for (let second = first + 1; second < eligible.length; second += 1) {
      if (
        competingSameWall(
          eligible[first]!.metricWorldGeometry,
          eligible[second]!.metricWorldGeometry,
        )
      ) {
        competingIds.add(eligible[first]!.candidate.id);
        competingIds.add(eligible[second]!.candidate.id);
      }
    }
  }
  const remaining: RankedEligible[] = [];
  for (const item of eligible) {
    if (competingIds.has(item.candidate.id)) {
      rejected.push(reject(
        item.candidate.id,
        item.candidate.role,
        "competing_same_wall",
      ));
    } else {
      remaining.push(item);
    }
  }

  remaining.sort(compareEligible);
  const selected = remaining[0]?.candidate ?? null;
  if (!selected) {
    return buildObservedSpanMetricSelection(
      null,
      rejected,
      s4aCandidates.length === 0
        ? ["no_s4a_floor_wall_candidates"]
        : ["no_eligible_observed_span"],
      pathAGeometry,
      false,
    );
  }
  return buildObservedSpanMetricSelection(
    selected,
    rejected,
    Object.freeze([
      ...selected.selectionReasons,
      "ranked_best_eligible_observed_span",
    ]),
    pathAGeometry,
    false,
  );
}

/**
 * Fail-closed. Extraction errors become no_eligible_observed_span.
 */
export function selectObservedSpanMetricCandidate(
  input: ObservedSpanMetricSelectionInput,
): ObservedSpanMetricSelection {
  try {
    return selectUnchecked(input);
  } catch {
    return emptyObservedSpanMetricSelection(["extraction_failed_closed"]);
  }
}

export function markObservedSpanEstimatorLaunched(
  selection: ObservedSpanMetricSelection,
  launched: boolean,
): ObservedSpanMetricSelection {
  return Object.freeze({
    ...selection,
    estimatorLaunched: launched &&
      selection.selected !== null &&
      !selection.pathAGeometry.exists,
    selectionReasons: launched && selection.selected && !selection.pathAGeometry.exists
      ? Object.freeze([...selection.selectionReasons, "observed_span_estimator_launched"])
      : selection.selectionReasons,
  });
}
