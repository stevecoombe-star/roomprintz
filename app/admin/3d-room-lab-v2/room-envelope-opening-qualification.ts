import type {
  EmptyObservedOpening,
  EmptyRoomObservationEvidence,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import { registrationCollisionPromotionEligible } from "./empty-original-registration-authority-contract";
import {
  ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY,
  type RoomBoundaryCandidate,
  type RoomBoundaryOccupancyEvidence,
} from "./room-boundary-authority-contract";
import {
  FLOOR_REACHING_OPENING_CATEGORIES,
  ROOM_ENVELOPE_REASON,
} from "./room-envelope-authority-contract";
import {
  OPENING_ENDPOINT_PARAM_EPS,
  floorWallPolylineCrossesOpeningInterior,
  mergeParameterIntervals,
  openingInteriorIntervalsAlongPolyline,
  properSeamOpeningIntersectionParameters,
  type OpeningParameterInterval,
} from "./room-opening-intersection-geometry";

export type QualifiedOpeningFloorGap = Readonly<{
  openingId: string;
  sourceBoundaryId: string;
  interval: OpeningParameterInterval;
}>;

export type OpeningQualificationResult = Readonly<{
  accepted: boolean;
  interval: OpeningParameterInterval | null;
  reasons: readonly string[];
}>;

export type OpeningFloorGapGeometryInput = Readonly<{
  opening: Readonly<{
    id: string;
    category: string;
    hostPlaneId: string | null;
    sourceNormalizedBoundary: readonly SourceNormalizedPoint[];
    boundaryClosure: EmptyObservedOpening["boundaryClosure"];
    ambiguity: string | null;
  }>;
  polyline: readonly SourceNormalizedPoint[];
  occupancy: RoomBoundaryOccupancyEvidence | null;
  wallPlaneId: string | null;
}>;

const FLOOR_REACHING = new Set<string>(FLOOR_REACHING_OPENING_CATEGORIES);
const INTERIOR_WIDTH_MIN = 1e-6;

export function registrationAllowsEnvelopeSubtraction(
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null,
): boolean {
  return Boolean(
    registration &&
      registrationCollisionPromotionEligible(registration.registrationClass),
  );
}

/**
 * Category / host / jamb / floor-contact geometry. Image basis is caller-owned.
 */
export function evaluateOpeningFloorGapGeometry(
  input: OpeningFloorGapGeometryInput,
): OpeningQualificationResult {
  const reasons: string[] = [];
  if (input.opening.ambiguity) {
    reasons.push(ROOM_ENVELOPE_REASON.ambiguousOpening);
  }
  if (input.opening.hostPlaneId === null) {
    reasons.push(ROOM_ENVELOPE_REASON.nullHostPlane);
  } else if (input.opening.hostPlaneId !== input.wallPlaneId) {
    reasons.push(ROOM_ENVELOPE_REASON.wrongHostWall);
  }
  if (!FLOOR_REACHING.has(input.opening.category)) {
    reasons.push(ROOM_ENVELOPE_REASON.categoryNotFloorReaching);
  }
  if (isFrameTruncatedOneSided(input.opening)) {
    reasons.push(ROOM_ENVELOPE_REASON.frameTruncated);
  }

  const polyline = input.polyline;
  const openingForGeometry = {
    ...input.opening,
    sourceNormalizedBoundary: input.opening.sourceNormalizedBoundary,
  } as EmptyObservedOpening;
  const intersections = properSeamOpeningIntersectionParameters(
    polyline,
    openingForGeometry,
  );
  const interiorIntervals = mergeParameterIntervals(
    [...openingInteriorIntervalsAlongPolyline(polyline, openingForGeometry)],
  );
  const occupiesInterior = floorWallPolylineCrossesOpeningInterior(
    polyline,
    [openingForGeometry],
  );
  const interiorJambHits = intersections.filter((t) =>
    t > OPENING_ENDPOINT_PARAM_EPS && t < 1 - OPENING_ENDPOINT_PARAM_EPS
  );
  const acceptedIntervals = interiorIntervals.filter((interval) =>
    interval.t1 - interval.t0 > INTERIOR_WIDTH_MIN
  );

  if (
    input.opening.boundaryClosure !== "complete_visible_outline" &&
    interiorJambHits.length < 2
  ) {
    reasons.push(ROOM_ENVELOPE_REASON.partialOpenBoundary);
  }

  if (intersections.length === 1 && acceptedIntervals.length === 0) {
    reasons.push(ROOM_ENVELOPE_REASON.oneJambOnly);
  }
  if (
    intersections.length >= 1 &&
    acceptedIntervals.length === 0 &&
    !occupiesInterior
  ) {
    reasons.push(ROOM_ENVELOPE_REASON.endpointTouchOnly);
  }
  if (
    !occupiesInterior &&
    interiorJambHits.length < 2 &&
    acceptedIntervals.length === 0
  ) {
    reasons.push(ROOM_ENVELOPE_REASON.doesNotMeetSeam);
  }
  if (
    occupiesInterior &&
    interiorJambHits.length < 2 &&
    acceptedIntervals.length === 0
  ) {
    reasons.push(ROOM_ENVELOPE_REASON.bothIntersectionsRequired);
  }
  if (!openingExtendsIntoWallNotFloor(
    openingForGeometry,
    polyline,
    input.occupancy,
  )) {
    reasons.push(ROOM_ENVELOPE_REASON.extendsIntoFloor);
  }

  const unique = uniqueReasons(reasons);
  if (unique.length > 0) {
    return { accepted: false, interval: null, reasons: unique };
  }
  const interval = mergeParameterIntervals(acceptedIntervals)[0] ??
    (interiorJambHits.length >= 2
      ? { t0: interiorJambHits[0]!, t1: interiorJambHits[interiorJambHits.length - 1]! }
      : null);
  if (!interval || interval.t1 - interval.t0 <= INTERIOR_WIDTH_MIN) {
    return {
      accepted: false,
      interval: null,
      reasons: [ROOM_ENVELOPE_REASON.doesNotMeetSeam],
    };
  }
  return { accepted: true, interval, reasons: [] };
}

export function qualifyOpeningFloorGap(input: {
  opening: EmptyObservedOpening;
  candidate: RoomBoundaryCandidate;
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
}): OpeningQualificationResult {
  const reasons: string[] = [];
  if (!registrationAllowsEnvelopeSubtraction(input.registration)) {
    reasons.push(ROOM_ENVELOPE_REASON.registrationNotCollisionReady);
  }
  if (input.candidate.status !== "accepted") {
    reasons.push(ROOM_ENVELOPE_REASON.s4aNotAccepted);
  }
  if (
    !input.candidate.worldGeometry ||
    input.candidate.authority.baseSegment !== true ||
    input.candidate.authority.supportPlane !== true
  ) {
    reasons.push(ROOM_ENVELOPE_REASON.s4aGeometryIncomplete);
  }
  const geometry = evaluateOpeningFloorGapGeometry({
    opening: input.opening,
    polyline: input.candidate.imageEvidence.polyline,
    occupancy: input.candidate.imageEvidence.occupancy,
    wallPlaneId: input.candidate.source.wallPlaneId,
  });
  if (reasons.length > 0) {
    return {
      accepted: false,
      interval: null,
      reasons: uniqueReasons([...reasons, ...geometry.reasons]),
    };
  }
  return geometry;
}

export function qualifyObservationOpeningsForCandidate(input: {
  observation: EmptyRoomObservationEvidence | null;
  candidate: RoomBoundaryCandidate;
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
}): readonly Readonly<{
  opening: EmptyObservedOpening;
  result: OpeningQualificationResult;
}>[] {
  if (!input.observation || input.observation.observerStatus === "failed") {
    return Object.freeze([]);
  }
  return Object.freeze(
    input.observation.observedOpenings.map((opening) => ({
      opening,
      result: qualifyOpeningFloorGap({
        opening,
        candidate: input.candidate,
        registration: input.registration,
      }),
    })),
  );
}

function isFrameTruncatedOneSided(opening: OpeningFloorGapGeometryInput["opening"]): boolean {
  if (opening.boundaryClosure === "complete_visible_outline") return false;
  return opening.sourceNormalizedBoundary.some(isFrameAdjacent);
}

function isFrameAdjacent(point: SourceNormalizedPoint): boolean {
  return point.x <= ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY ||
    point.x >= 1 - ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY ||
    point.y <= ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY ||
    point.y >= 1 - ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY;
}

function openingExtendsIntoWallNotFloor(
  opening: OpeningFloorGapGeometryInput["opening"] | EmptyObservedOpening,
  polyline: readonly SourceNormalizedPoint[],
  occupancy: RoomBoundaryOccupancyEvidence | null,
): boolean {
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  if (!start || !end) return false;
  if (occupancy?.floorSide !== "positive" && occupancy?.floorSide !== "negative") {
    return false;
  }
  let wallCount = 0;
  for (const vertex of opening.sourceNormalizedBoundary) {
    const side = signedSide(start, end, vertex);
    if (Math.abs(side) <= 1e-12) continue;
    const onPositive = side > 0;
    const floorIsPositive = occupancy.floorSide === "positive";
    if (onPositive !== floorIsPositive) wallCount += 1;
  }
  return wallCount > 0;
}

function signedSide(
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
  point: SourceNormalizedPoint,
): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function uniqueReasons(reasons: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    unique.push(reason);
  }
  return unique;
}
