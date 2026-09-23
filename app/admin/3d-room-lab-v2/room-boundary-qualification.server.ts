import {
  FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE,
  type EmptyObservedPlane,
  type SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import {
  ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M,
  ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M,
  ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD,
  ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO,
  ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY,
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_IMAGE_ON_LINE_ABS,
  ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO,
  type FrozenRoomBoundaryCameraSnapshot,
  type RoomBoundaryEvidenceApplicabilityStatus,
  type RoomBoundaryFrontierEvidence,
  type RoomBoundaryFrontierVertexEvidence,
  type RoomBoundaryInteriorEvidence,
  type RoomBoundaryOccupancyEvidence,
  type RoomBoundaryWorldGeometry,
  type RoomBoundaryWorldXyz,
} from "./room-boundary-authority-contract";
import {
  horizontalRunRatio,
  imagePolylineLineFit,
  type FittedImageLine,
} from "./room-boundary-line-fit.server";
import type { OriginalWorldProjectionResult } from "./room-boundary-projection.server";

export type OccupancySide = "positive" | "negative" | "mixed" | "undetermined";

function signedImageSide(
  origin: SourceNormalizedPoint,
  direction: SourceNormalizedPoint,
  point: SourceNormalizedPoint,
): number {
  return direction.x * (point.y - origin.y) - direction.y * (point.x - origin.x);
}

function classifySide(distance: number): "on" | "positive" | "negative" {
  if (Math.abs(distance) <= ROOM_BOUNDARY_IMAGE_ON_LINE_ABS) return "on";
  return distance > 0 ? "positive" : "negative";
}

function polygonCentroid(
  polygon: readonly SourceNormalizedPoint[],
): SourceNormalizedPoint | null {
  if (polygon.length < 3) return null;
  const sum = polygon.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

export function pointInPolygon(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointToSegmentDistance(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): number {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 1e-18) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * abx + (point.y - start.y) * aby) / lengthSq),
  );
  return Math.hypot(point.x - (start.x + t * abx), point.y - (start.y + t * aby));
}

export function distanceToPolygonFrontier(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): number | null {
  if (polygon.length < 2) return null;
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = polygon[(index + 1) % polygon.length];
    min = Math.min(min, pointToSegmentDistance(point, polygon[index], next));
  }
  return Number.isFinite(min) ? min : null;
}

function occupancyForPolygon(
  polygon: readonly SourceNormalizedPoint[],
  line: FittedImageLine,
): { side: OccupancySide; on: number; positive: number; negative: number } {
  let on = 0;
  let positive = 0;
  let negative = 0;
  for (const point of polygon) {
    const classified = classifySide(
      signedImageSide(line.origin, line.direction, point),
    );
    if (classified === "on") on += 1;
    else if (classified === "positive") positive += 1;
    else negative += 1;
  }
  const centroid = polygonCentroid(polygon);
  if (centroid) {
    const classified = classifySide(
      signedImageSide(line.origin, line.direction, centroid),
    );
    if (classified === "positive") positive += 1;
    else if (classified === "negative") negative += 1;
    else on += 1;
  }
  const side: OccupancySide = positive > 0 && negative === 0
    ? "positive"
    : negative > 0 && positive === 0
    ? "negative"
    : positive > 0 && negative > 0
    ? "mixed"
    : "undetermined";
  return { side, on, positive, negative };
}

export function evaluateOppositeOccupancy(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
): RoomBoundaryOccupancyEvidence | null {
  const line = imagePolylineLineFit(polyline);
  if (!line) return null;
  const floor = occupancyForPolygon(floorPolygon, line);
  const wall = occupancyForPolygon(wallPolygon, line);
  return {
    floorSide: floor.side,
    wallSide: wall.side,
    opposite: (floor.side === "positive" && wall.side === "negative") ||
      (floor.side === "negative" && wall.side === "positive"),
    floorOnLineCount: floor.on,
    floorPositiveCount: floor.positive,
    floorNegativeCount: floor.negative,
    wallOnLineCount: wall.on,
    wallPositiveCount: wall.positive,
    wallNegativeCount: wall.negative,
  };
}

export function inNormalizedImageBounds(point: SourceNormalizedPoint): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function pointIsFrameAdjacent(point: SourceNormalizedPoint): boolean {
  return Math.min(point.x, 1 - point.x, point.y, 1 - point.y) <=
    ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY;
}

/**
 * Classify one sample against one polygon frontier.
 *
 * Near-frontier support is PASS. Landing in the opposite known polygon, or
 * sitting in this polygon's interior away from its edge, is CONTRADICTION.
 * Frame-adjacent missing coverage is NOT_APPLICABLE, not a fail.
 */
export function classifyFrontierVertex(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
  oppositePolygon: readonly SourceNormalizedPoint[],
): RoomBoundaryFrontierVertexEvidence {
  const distance = distanceToPolygonFrontier(point, polygon);
  const frameAdjacent = pointIsFrameAdjacent(point);
  if (
    distance !== null &&
    distance <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE
  ) {
    return {
      applicability: "applicable",
      status: "pass",
      distance,
      frameAdjacent,
    };
  }

  const inPolygon = pointInPolygon(point, polygon);
  const inOpposite = pointInPolygon(point, oppositePolygon);

  if (inPolygon) {
    return {
      applicability: "contradiction",
      status: "contradiction",
      distance,
      frameAdjacent,
    };
  }

  if (inOpposite) {
    if (frameAdjacent) {
      return {
        applicability: "unsupported_by_polygon_coverage",
        status: "not_applicable",
        distance,
        frameAdjacent,
      };
    }
    return {
      applicability: "contradiction",
      status: "contradiction",
      distance,
      frameAdjacent,
    };
  }

  if (frameAdjacent) {
    return {
      applicability: "unsupported_by_frame",
      status: "not_applicable",
      distance,
      frameAdjacent,
    };
  }

  return {
    applicability: "contradiction",
    status: "contradiction",
    distance,
    frameAdjacent,
  };
}

function frontierPassFromVertices(
  vertices: readonly RoomBoundaryFrontierVertexEvidence[],
): {
  maxDistance: number | null;
  near: boolean;
} {
  const applicable = vertices.filter((vertex) => vertex.status !== "not_applicable");
  const applicableDistances = applicable
    .map((vertex) => vertex.distance)
    .filter((value): value is number => value !== null);
  const maxDistance = applicableDistances.length > 0
    ? Math.max(...applicableDistances)
    : null;
  const near = applicable.length >= 1 &&
    applicable.every((vertex) => vertex.status === "pass");
  return { maxDistance, near };
}

/**
 * S4A wall-frontier receipt for a certified truncated wall: at least one
 * applicable PASS plus frame/coverage N/A, and no wall contradiction.
 * This is not inferred from in-span probes.
 */
export function s4aWallFrontierHasCertifiedTruncatedSupport(
  frontier: RoomBoundaryFrontierEvidence | null | undefined,
): boolean {
  if (!frontier) return false;
  const vertices = frontier.wallVertices;
  if (vertices.some((vertex) => vertex.status === "contradiction")) {
    return false;
  }
  const hasApplicablePass = vertices.some(
    (vertex) =>
      vertex.status === "pass" && vertex.applicability === "applicable",
  );
  const hasTruncatedNa = vertices.some((vertex) =>
    vertex.status === "not_applicable" &&
      (vertex.applicability === "unsupported_by_frame" ||
        vertex.applicability === "unsupported_by_polygon_coverage")
  );
  return hasApplicablePass && hasTruncatedNa;
}

export function evaluateFrontierProximity(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
): RoomBoundaryFrontierEvidence {
  const floorVertices = polyline.map((point) =>
    classifyFrontierVertex(point, floorPolygon, wallPolygon)
  );
  const wallVertices = polyline.map((point) =>
    classifyFrontierVertex(point, wallPolygon, floorPolygon)
  );
  const floor = frontierPassFromVertices(floorVertices);
  const wall = frontierPassFromVertices(wallVertices);
  return {
    maxDistanceToFloorFrontier: floor.maxDistance,
    maxDistanceToWallFrontier: wall.maxDistance,
    nearFloorFrontier: floor.near,
    nearWallFrontier: wall.near,
    floorVertices,
    wallVertices,
  };
}

export function isNearVerticalFloorWallSeam(
  polyline: readonly SourceNormalizedPoint[],
): boolean {
  const ratio = horizontalRunRatio(polyline);
  return ratio !== null &&
    ratio < ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO;
}

/**
 * Near-vertical image geometry remains a wall-wall ambiguity heuristic.
 * Strong independent floor-wall proof lets the candidate continue through
 * later S4A gates; it does not accept, manufacture geometry, or enable
 * collision.
 */
export function nearVerticalFloorWallMayContinue(input: {
  nearVertical: boolean;
  bindingSucceeded: boolean;
  ambiguity: string | null;
  occupancyOpposite: boolean;
  nearFloorFrontier: boolean;
  nearWallFrontier: boolean;
}): boolean {
  if (!input.nearVertical) return true;
  return input.bindingSucceeded &&
    input.ambiguity === null &&
    input.occupancyOpposite &&
    input.nearFloorFrontier &&
    input.nearWallFrontier;
}

export function endpointIsFrameAdjacent(
  polyline: readonly SourceNormalizedPoint[],
): boolean {
  if (polyline.length < 1) return false;
  const endpoints = [polyline[0], polyline[polyline.length - 1]];
  return endpoints.some((point) => pointIsFrameAdjacent(point));
}

const IN_SPAN_INTERIOR_WITNESS_T = [0.5, 0.25, 0.75, 0.375, 0.625] as const;

export type OccupancyOffsetClassification = Readonly<{
  status: RoomBoundaryEvidenceApplicabilityStatus;
  inExpected: boolean;
  inWrong: boolean;
  outOfBounds: boolean;
}>;

/**
 * Classify a local occupancy offset. Wrong known polygon is contradiction.
 * Out-of-frame or neither-polygon with no affirmative opposite class is N/A.
 */
export function classifyOccupancyOffset(input: {
  sample: SourceNormalizedPoint;
  probe: SourceNormalizedPoint;
  expectedPolygon: readonly SourceNormalizedPoint[];
  wrongPolygon: readonly SourceNormalizedPoint[];
}): OccupancyOffsetClassification {
  const outOfBounds = !inNormalizedImageBounds(input.sample);
  if (outOfBounds) {
    return {
      status: "not_applicable",
      inExpected: false,
      inWrong: false,
      outOfBounds: true,
    };
  }
  const inExpected = pointInPolygon(input.sample, input.expectedPolygon);
  const inWrong = pointInPolygon(input.sample, input.wrongPolygon);
  if (inWrong) {
    return { status: "contradiction", inExpected, inWrong, outOfBounds: false };
  }
  if (inExpected) {
    return { status: "pass", inExpected, inWrong, outOfBounds: false };
  }
  if (
    pointIsFrameAdjacent(input.sample) ||
    pointIsFrameAdjacent(input.probe)
  ) {
    return { status: "not_applicable", inExpected, inWrong, outOfBounds: false };
  }
  const expectedDistance = distanceToPolygonFrontier(
    input.probe,
    input.expectedPolygon,
  );
  if (
    expectedDistance !== null &&
    expectedDistance <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE
  ) {
    return { status: "contradiction", inExpected, inWrong, outOfBounds: false };
  }
  return { status: "not_applicable", inExpected, inWrong, outOfBounds: false };
}

export type RegionalSampleMembership =
  | "floor_only"
  | "wall_only"
  | "both"
  | "neither"
  | "out_of_bounds"
  | "frame_unsupported";

export type RegionalSampleMembershipClassification = Readonly<{
  membership: RegionalSampleMembership;
  inFloor: boolean;
  inWall: boolean;
  outOfBounds: boolean;
  frameAdjacent: boolean;
}>;

/**
 * Unoriented local membership of one offset sample. Does not interpret
 * +normal as floor or -normal as wall.
 */
export function classifyRegionalSampleMembership(input: {
  point: SourceNormalizedPoint;
  probe: SourceNormalizedPoint;
  floorPolygon: readonly SourceNormalizedPoint[];
  wallPolygon: readonly SourceNormalizedPoint[];
}): RegionalSampleMembershipClassification {
  const frameAdjacent = pointIsFrameAdjacent(input.point) ||
    pointIsFrameAdjacent(input.probe);
  const outOfBounds = !inNormalizedImageBounds(input.point);
  if (outOfBounds) {
    return {
      membership: "out_of_bounds",
      inFloor: false,
      inWall: false,
      outOfBounds: true,
      frameAdjacent,
    };
  }
  const inFloor = pointInPolygon(input.point, input.floorPolygon);
  const inWall = pointInPolygon(input.point, input.wallPolygon);
  if (inFloor && inWall) {
    return {
      membership: "both",
      inFloor,
      inWall,
      outOfBounds: false,
      frameAdjacent,
    };
  }
  if (inFloor) {
    return {
      membership: "floor_only",
      inFloor,
      inWall,
      outOfBounds: false,
      frameAdjacent,
    };
  }
  if (inWall) {
    return {
      membership: "wall_only",
      inFloor,
      inWall,
      outOfBounds: false,
      frameAdjacent,
    };
  }
  if (frameAdjacent) {
    return {
      membership: "frame_unsupported",
      inFloor,
      inWall,
      outOfBounds: false,
      frameAdjacent,
    };
  }
  const floorDistance = distanceToPolygonFrontier(input.probe, input.floorPolygon);
  const wallDistance = distanceToPolygonFrontier(input.probe, input.wallPolygon);
  const locallySupported =
    (floorDistance !== null &&
      floorDistance <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE) ||
    (wallDistance !== null &&
      wallDistance <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE);
  return {
    membership: locallySupported ? "neither" : "frame_unsupported",
    inFloor,
    inWall,
    outOfBounds: false,
    frameAdjacent,
  };
}

function membershipIsHardContradiction(
  membership: RegionalSampleMembership,
): boolean {
  return membership === "both" || membership === "neither";
}

/**
 * Combine the two physical sides of an unoriented seam. Pass only when the
 * unordered pair is {floor_only, wall_only}. Hard contradiction dominates N/A.
 */
export function classifyRegionalOppositeOccupancy(input: {
  plus: RegionalSampleMembership;
  minus: RegionalSampleMembership;
}): RoomBoundaryEvidenceApplicabilityStatus {
  if (
    membershipIsHardContradiction(input.plus) ||
    membershipIsHardContradiction(input.minus)
  ) {
    return "contradiction";
  }
  const uniqueOpposition =
    (input.plus === "floor_only" && input.minus === "wall_only") ||
    (input.plus === "wall_only" && input.minus === "floor_only");
  if (uniqueOpposition) return "pass";
  if (input.plus === "floor_only" && input.minus === "floor_only") {
    return "contradiction";
  }
  if (input.plus === "wall_only" && input.minus === "wall_only") {
    return "contradiction";
  }
  return "not_applicable";
}

export type RegionalProbeClassification = Readonly<{
  status: RoomBoundaryEvidenceApplicabilityStatus;
  floorFrontier: RoomBoundaryFrontierVertexEvidence;
  wallFrontier: RoomBoundaryFrontierVertexEvidence;
  occupancy: RoomBoundaryEvidenceApplicabilityStatus;
  plusMembership: RegionalSampleMembership | null;
  minusMembership: RegionalSampleMembership | null;
}>;

function regionalMembershipIsFloorOnlyPlusNeither(
  plus: RegionalSampleMembership,
  minus: RegionalSampleMembership,
): boolean {
  return (plus === "floor_only" && minus === "neither") ||
    (plus === "neither" && minus === "floor_only");
}

export function classifyRegionalProbeEvidence(input: {
  probe: SourceNormalizedPoint;
  start: SourceNormalizedPoint;
  end: SourceNormalizedPoint;
  occupancy: RoomBoundaryOccupancyEvidence | null;
  floorPolygon: readonly SourceNormalizedPoint[];
  wallPolygon: readonly SourceNormalizedPoint[];
  supportingRegionWall?: boolean;
  s4aTruncatedWallSupport?: boolean;
}): RegionalProbeClassification {
  const floorFrontier = classifyFrontierVertex(
    input.probe,
    input.floorPolygon,
    input.wallPolygon,
  );
  let wallFrontier = classifyFrontierVertex(
    input.probe,
    input.wallPolygon,
    input.floorPolygon,
  );
  if (
    input.supportingRegionWall === true &&
    wallFrontier.status === "contradiction" &&
    pointInPolygon(input.probe, input.wallPolygon)
  ) {
    wallFrontier = {
      ...wallFrontier,
      applicability: "applicable",
      status: "pass",
    };
  }
  const truncatedWallSupport = input.s4aTruncatedWallSupport === true;
  const uniqueFloorSide = input.occupancy?.floorSide === "positive" ||
    input.occupancy?.floorSide === "negative";
  const uniqueWallSide = input.occupancy?.wallSide === "positive" ||
    input.occupancy?.wallSide === "negative";
  const supportingRegionMixedWall = input.supportingRegionWall === true &&
    uniqueFloorSide &&
    input.occupancy?.wallSide === "mixed";
  if (!uniqueFloorSide || (!uniqueWallSide && !supportingRegionMixedWall)) {
    const occupancyStatus: RoomBoundaryEvidenceApplicabilityStatus =
      floorFrontier.status === "contradiction" ||
        wallFrontier.status === "contradiction"
        ? "contradiction"
        : "not_applicable";
    return {
      status: occupancyStatus === "contradiction" ||
          floorFrontier.status === "contradiction" ||
          wallFrontier.status === "contradiction"
        ? "contradiction"
        : "not_applicable",
      floorFrontier,
      wallFrontier,
      occupancy: occupancyStatus,
      plusMembership: null,
      minusMembership: null,
    };
  }
  const tangent = normalize2d({
    x: input.end.x - input.start.x,
    y: input.end.y - input.start.y,
  });
  if (!tangent) {
    return {
      status: "not_applicable",
      floorFrontier,
      wallFrontier,
      occupancy: "not_applicable",
      plusMembership: null,
      minusMembership: null,
    };
  }
  const normal = normalize2d({ x: -tangent.y, y: tangent.x });
  if (!normal) {
    return {
      status: "not_applicable",
      floorFrontier,
      wallFrontier,
      occupancy: "not_applicable",
      plusMembership: null,
      minusMembership: null,
    };
  }
  const plusSample = {
    x: input.probe.x + normal.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    y: input.probe.y + normal.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  };
  const minusSample = {
    x: input.probe.x - normal.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    y: input.probe.y - normal.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  };
  const plus = classifyRegionalSampleMembership({
    point: plusSample,
    probe: input.probe,
    floorPolygon: input.floorPolygon,
    wallPolygon: input.wallPolygon,
  });
  const minus = classifyRegionalSampleMembership({
    point: minusSample,
    probe: input.probe,
    floorPolygon: input.floorPolygon,
    wallPolygon: input.wallPolygon,
  });
  let plusForOccupancy: RegionalSampleMembership =
    input.supportingRegionWall === true && plus.membership === "both"
      ? "floor_only"
      : plus.membership;
  let minusForOccupancy: RegionalSampleMembership =
    input.supportingRegionWall === true && minus.membership === "both"
      ? "floor_only"
      : minus.membership;
  const probeInWall = pointInPolygon(input.probe, input.wallPolygon);
  if (
    truncatedWallSupport &&
    floorFrontier.status === "pass" &&
    !probeInWall &&
    regionalMembershipIsFloorOnlyPlusNeither(plusForOccupancy, minusForOccupancy)
  ) {
    if (plusForOccupancy === "neither") plusForOccupancy = "frame_unsupported";
    if (minusForOccupancy === "neither") minusForOccupancy = "frame_unsupported";
  }
  const occupancy = classifyRegionalOppositeOccupancy({
    plus: plusForOccupancy,
    minus: minusForOccupancy,
  });
  if (
    truncatedWallSupport &&
    floorFrontier.status === "pass" &&
    wallFrontier.status === "contradiction" &&
    !probeInWall &&
    occupancy !== "contradiction"
  ) {
    wallFrontier = {
      applicability: "unsupported_by_polygon_coverage",
      status: "not_applicable",
      distance: wallFrontier.distance,
      frameAdjacent: wallFrontier.frameAdjacent,
    };
  }
  const status: RoomBoundaryEvidenceApplicabilityStatus =
    occupancy === "contradiction" ||
      floorFrontier.status === "contradiction" ||
      wallFrontier.status === "contradiction"
      ? "contradiction"
      : occupancy === "pass"
      ? "pass"
      : "not_applicable";
  return {
    status,
    floorFrontier,
    wallFrontier,
    occupancy,
    plusMembership: plus.membership,
    minusMembership: minus.membership,
  };
}

export function applicableEvidencePasses(input: {
  passCount: number;
  contradictionCount: number;
}): boolean {
  return input.passCount >= 1 && input.contradictionCount === 0;
}

export function floorWallProjectionContinuation(
  points: readonly Readonly<{ ok: boolean }>[],
): Readonly<{
  endpointProjectionFailed: boolean;
  interiorProjectionFailed: boolean;
  retainObservedEndpointSpan: boolean;
}> {
  const first = points[0];
  const last = points[points.length - 1];
  const endpointProjectionFailed = !first || !last || !first.ok || !last.ok;
  const interiorProjectionFailed = points.slice(1, -1).some((point) => !point.ok);
  return {
    endpointProjectionFailed,
    interiorProjectionFailed,
    retainObservedEndpointSpan: !endpointProjectionFailed,
  };
}

function perpendicularTowardSide(
  direction: SourceNormalizedPoint,
  desired: "positive" | "negative",
): SourceNormalizedPoint {
  const first = { x: -direction.y, y: direction.x };
  const origin = { x: 0, y: 0 };
  const firstSign = signedImageSide(origin, direction, first);
  const matches = desired === "positive" ? firstSign > 0 : firstSign < 0;
  return matches ? first : { x: direction.y, y: -direction.x };
}

function normalize2d(
  vector: SourceNormalizedPoint,
): SourceNormalizedPoint | null {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return { x: vector.x / length, y: vector.y / length };
}

export function chooseFloorInteriorWitness(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  occupancy: RoomBoundaryOccupancyEvidence,
  wallPolygon: readonly SourceNormalizedPoint[] | null = null,
  supportingRegionWallOverlapAllowed = false,
): SourceNormalizedPoint | null {
  return chooseFloorInteriorWitnessAttempt(
    polyline,
    floorPolygon,
    occupancy,
    wallPolygon,
    supportingRegionWallOverlapAllowed,
  ).witness;
}

export function chooseFloorInteriorWitnessAttempt(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  occupancy: RoomBoundaryOccupancyEvidence,
  wallPolygon: readonly SourceNormalizedPoint[] | null = null,
  supportingRegionWallOverlapAllowed = false,
): Readonly<{
  witness: SourceNormalizedPoint | null;
  status: "pass" | "contradiction" | "insufficient";
}> {
  if (occupancy.floorSide !== "positive" && occupancy.floorSide !== "negative") {
    return { witness: null, status: "insufficient" };
  }
  if (polyline.length < 2) return { witness: null, status: "insufficient" };
  const line = imagePolylineLineFit(polyline);
  if (!line) return { witness: null, status: "insufficient" };
  const direction = normalize2d(line.direction);
  if (!direction) return { witness: null, status: "insufficient" };
  const inward = normalize2d(
    perpendicularTowardSide(direction, occupancy.floorSide),
  );
  if (!inward) return { witness: null, status: "insufficient" };
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  for (const t of IN_SPAN_INTERIOR_WITNESS_T) {
    const onSpan = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };
    const inset = {
      x: onSpan.x + inward.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
      y: onSpan.y + inward.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    };
    if (!inNormalizedImageBounds(inset)) continue;
    const inFloor = pointInPolygon(inset, floorPolygon);
    if (wallPolygon && pointInPolygon(inset, wallPolygon)) {
      if (!(supportingRegionWallOverlapAllowed && inFloor)) {
        return { witness: inset, status: "contradiction" };
      }
    }
    if (inFloor) {
      return { witness: inset, status: "pass" };
    }
  }
  return { witness: null, status: "insufficient" };
}

function signedPlaneDistance(
  point: RoomBoundaryWorldXyz,
  geometry: RoomBoundaryWorldGeometry,
): number {
  return geometry.supportPlaneNormal.x * point.x +
    geometry.supportPlaneNormal.y * point.y +
    geometry.supportPlaneNormal.z * point.z +
    geometry.supportPlaneConstant;
}

function signFromDistance(distance: number): -1 | 1 | 0 | null {
  if (!Number.isFinite(distance)) return null;
  if (Math.abs(distance) <= ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M) {
    return 0;
  }
  return distance > 0 ? 1 : -1;
}

export function evaluateInteriorHalfSpace(input: {
  occupancy: RoomBoundaryOccupancyEvidence | null;
  polyline: readonly SourceNormalizedPoint[];
  floorPolygon: readonly SourceNormalizedPoint[] | null;
  wallPolygon?: readonly SourceNormalizedPoint[] | null;
  geometry: RoomBoundaryWorldGeometry | null;
  camera: FrozenRoomBoundaryCameraSnapshot;
  projectWitness: (
    point: SourceNormalizedPoint,
  ) => OriginalWorldProjectionResult | RoomBoundaryWorldXyz | null;
  supportingRegionWallOverlapAllowed?: boolean;
}): RoomBoundaryInteriorEvidence {
  const failed = (
    extras: Partial<RoomBoundaryInteriorEvidence> = {},
  ): RoomBoundaryInteriorEvidence => ({
    status: "insufficient",
    witnessImagePoint: extras.witnessImagePoint ?? null,
    witnessWorldPoint: extras.witnessWorldPoint ?? null,
    sideSign: extras.sideSign ?? null,
    cameraSideSign: extras.cameraSideSign ?? null,
    cameraContradictsWitness: extras.cameraContradictsWitness ?? false,
  });
  if (!input.occupancy || !input.geometry || !input.floorPolygon) {
    return failed();
  }
  const attempt = chooseFloorInteriorWitnessAttempt(
    input.polyline,
    input.floorPolygon,
    input.occupancy,
    input.wallPolygon ?? null,
    input.supportingRegionWallOverlapAllowed === true,
  );
  if (attempt.status === "contradiction") {
    return failed({ witnessImagePoint: attempt.witness });
  }
  const witnessImage = attempt.witness;
  if (!witnessImage || attempt.status !== "pass") return failed();
  if (!pointInPolygon(witnessImage, input.floorPolygon)) {
    return failed({ witnessImagePoint: witnessImage });
  }
  if (
    input.wallPolygon &&
    pointInPolygon(witnessImage, input.wallPolygon) &&
    input.supportingRegionWallOverlapAllowed !== true
  ) {
    return failed({ witnessImagePoint: witnessImage });
  }
  const projected = input.projectWitness(witnessImage);
  if (!projected) return failed({ witnessImagePoint: witnessImage });
  const witnessWorld = "ok" in projected
    ? projected.ok
      ? projected.world
      : null
    : projected;
  if (!witnessWorld) return failed({ witnessImagePoint: witnessImage });
  const witnessDistance = signedPlaneDistance(witnessWorld, input.geometry);
  const sideSign = signFromDistance(witnessDistance);
  if (sideSign === null || sideSign === 0) {
    return failed({
      witnessImagePoint: witnessImage,
      witnessWorldPoint: witnessWorld,
    });
  }
  const cameraDistance = signedPlaneDistance({
    x: input.camera.pose.position.x,
    y: input.camera.pose.position.y,
    z: input.camera.pose.position.z,
  }, input.geometry);
  const cameraSideSign = signFromDistance(cameraDistance);
  if (
    cameraSideSign === 1 || cameraSideSign === -1
  ) {
    if (cameraSideSign !== sideSign) {
      return failed({
        witnessImagePoint: witnessImage,
        witnessWorldPoint: witnessWorld,
        sideSign,
        cameraSideSign,
        cameraContradictsWitness: true,
      });
    }
  }
  return {
    status: "accepted",
    witnessImagePoint: witnessImage,
    witnessWorldPoint: witnessWorld,
    sideSign,
    cameraSideSign,
    cameraContradictsWitness: false,
  };
}

export function competingSameWall(
  first: RoomBoundaryWorldGeometry,
  second: RoomBoundaryWorldGeometry,
): boolean {
  const firstLength = Math.hypot(
    first.tangent.x,
    first.tangent.z,
  );
  const secondLength = Math.hypot(
    second.tangent.x,
    second.tangent.z,
  );
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
    Math.abs(firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z),
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

  const axis = {
    x: firstTangent.x + (firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z >= 0
      ? secondTangent.x
      : -secondTangent.x),
    z: firstTangent.z + (firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z >= 0
      ? secondTangent.z
      : -secondTangent.z),
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
  point: RoomBoundaryWorldXyz,
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

function intervalOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): number {
  const left = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const right = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, right - left);
}

export function boundPlanesForFloorWall(
  planeIds: readonly string[],
  planes: readonly EmptyObservedPlane[],
): Readonly<{ floor: EmptyObservedPlane; wall: EmptyObservedPlane }> | null {
  if (planeIds.length !== 2) return null;
  const bound = planeIds
    .map((id) => planes.find((plane) => plane.id === id) ?? null);
  if (bound.some((plane) => plane === null)) return null;
  const [first, second] = bound as [EmptyObservedPlane, EmptyObservedPlane];
  if (first.category === "floor" && second.category === "wall") {
    return { floor: first, wall: second };
  }
  if (first.category === "wall" && second.category === "floor") {
    return { floor: second, wall: first };
  }
  return null;
}

export type FocusedWallSupportingRegionAdmissionClass =
  | "outline_coherent"
  | "supporting_region_interior_overshoot"
  | "true_contradiction";

/**
 * Focused Floor-Wall only: the focused wall polygon is a supporting visible
 * region, not a certified exact outline. Interior overshoot is distinguishable
 * from a floating unrelated seam. Does not snap or manufacture geometry.
 */
export function classifyFocusedWallSupportingRegion(
  seam: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
): FocusedWallSupportingRegionAdmissionClass {
  if (seam.length < 2 || wallPolygon.length < 3) return "true_contradiction";
  let applicable = 0;
  let outlinePass = 0;
  let interiorOvershoot = 0;
  let trueContradiction = 0;
  for (const point of seam) {
    const vertex = classifyFrontierVertex(point, wallPolygon, floorPolygon);
    if (vertex.status === "not_applicable") continue;
    applicable += 1;
    if (vertex.status === "pass") {
      outlinePass += 1;
      continue;
    }
    if (pointInPolygon(point, wallPolygon)) {
      interiorOvershoot += 1;
      continue;
    }
    trueContradiction += 1;
  }
  if (trueContradiction > 0 || applicable === 0) return "true_contradiction";
  if (interiorOvershoot > 0) return "supporting_region_interior_overshoot";
  if (outlinePass === applicable) return "outline_coherent";
  return "true_contradiction";
}

export function focusedSupportingRegionOccupancyAcceptable(
  occupancy: RoomBoundaryOccupancyEvidence | null,
  supportingRegionClass: FocusedWallSupportingRegionAdmissionClass,
): boolean {
  if (!occupancy) return false;
  const floorUnique = occupancy.floorSide === "positive" ||
    occupancy.floorSide === "negative";
  if (!floorUnique) return false;
  if (supportingRegionClass === "outline_coherent") {
    return occupancy.opposite === true &&
      (occupancy.wallSide === "positive" || occupancy.wallSide === "negative");
  }
  if (supportingRegionClass === "supporting_region_interior_overshoot") {
    if (occupancy.wallSide === "undetermined") return false;
    if (occupancy.wallSide === "mixed") return true;
    return occupancy.opposite === true;
  }
  return false;
}

export function isFocusedSideFloorWallObservationSource(
  source: string,
): boolean {
  return source === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE;
}

export function observationSourceMayCreateWorldBoundary(
  source: string,
): boolean {
  return source === "general_empty_observer" ||
    source === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE;
}
