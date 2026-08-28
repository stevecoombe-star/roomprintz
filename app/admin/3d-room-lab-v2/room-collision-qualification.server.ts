import type {
  EmptyObservedOpening,
  EmptyRoomObservationEvidence,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  type AfcV2RoomBoundaryAuthorityReceipt,
  type RoomBoundaryCandidate,
  type RoomBoundaryOccupancyEvidence,
} from "./room-boundary-authority-contract";
import {
  distanceToPolygonFrontier,
  pointInPolygon as imagePointInPolygon,
} from "./room-boundary-qualification.server";
import {
  AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION,
  AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
  AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
  AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
  AFC_V2_ROOM_COLLISION_QUALIFICATION_VERSION,
  ROOM_COLLISION_REASON,
  collisionReliabilityClass,
  freezeRoomCollisionAuthorityReceipt,
  type AfcV2RoomCollisionAuthorityReceipt,
  type RoomCollisionAuthorityLineage,
  type RoomCollisionBoundary,
  type RoomCollisionBoundaryCorroboration,
  type RoomCollisionCandidateStatus,
} from "./room-collision-authority-contract";

export type RoomCollisionConstructionInput = Readonly<{
  roomBoundary: AfcV2RoomBoundaryAuthorityReceipt | null;
  observation: EmptyRoomObservationEvidence | null;
}>;

const ON_BOUNDARY_ABS = 1e-12;
const COLLINEAR_CROSS_ABS = 1e-14;
const PARAM_MERGE_ABS = 1e-12;
const OPEN_SEGMENT_PARAM_EPS = 1e-9;
const PROBE_COINCIDENCE_EPS = 1e-9;

/**
 * Fail-closed S4B qualification. Never mutates the S4A receipt.
 * Zero enabled boundaries is a valid success.
 */
export function constructAfcV2RoomCollisionAuthority(
  input: RoomCollisionConstructionInput,
): AfcV2RoomCollisionAuthorityReceipt {
  try {
    return constructAfcV2RoomCollisionAuthorityUnchecked(input);
  } catch {
    return emptyReceipt(input, [
      ROOM_COLLISION_REASON.collisionConstructionFailedClosed,
    ]);
  }
}

function constructAfcV2RoomCollisionAuthorityUnchecked(
  input: RoomCollisionConstructionInput,
): AfcV2RoomCollisionAuthorityReceipt {
  const lineage = freezeLineage(input);
  if (!input.roomBoundary) {
    return emptyReceipt(input, [ROOM_COLLISION_REASON.s4aUnavailable]);
  }

  const openings = reportedOpenings(input.observation);
  const receiptIntegrityReasons = s4aReceiptIntegrityReasons(input.roomBoundary);
  const boundaries = input.roomBoundary.candidates.map((candidate) =>
    qualifyBoundary({
      candidate,
      compatibilityTier: lineage.roomBoundary.compatibilityTier,
      observation: input.observation,
      openings,
      receiptIntegrityReasons,
    })
  );

  const summary = Object.freeze({
    accepted: boundaries.filter((boundary) => boundary.status === "accepted").length,
    ambiguous: boundaries.filter((boundary) => boundary.status === "ambiguous").length,
    insufficient: boundaries.filter((boundary) => boundary.status === "insufficient")
      .length,
    rejected: boundaries.filter((boundary) => boundary.status === "rejected").length,
    skippedNonS4AAccepted: boundaries.filter((boundary) =>
      boundary.qualificationReasons.includes(ROOM_COLLISION_REASON.s4aNotAccepted)
    ).length,
    candidateCount: boundaries.length,
  });

  const constructionReasons: string[] = [];
  if (receiptIntegrityReasons.length > 0) {
    constructionReasons.push(ROOM_COLLISION_REASON.s4aContractIntegrity);
  }
  if (summary.accepted === 0) {
    constructionReasons.push(ROOM_COLLISION_REASON.zeroCollisionEnabledBoundaries);
  }

  return freezeRoomCollisionAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
    authority: "partial_room_collision_authority",
    sourceRoomBoundaryVersion: AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
    qualificationVersion: AFC_V2_ROOM_COLLISION_QUALIFICATION_VERSION,
    geometryKernelVersion: AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
    objectCollisionKernelVersion: AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
    collisionAuthority: summary.accepted > 0,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed: false,
    verticalExtentKnown: false,
    lineage,
    boundaries: Object.freeze(boundaries),
    summary,
    constructionReasons: Object.freeze(constructionReasons),
  });
}

function qualifyBoundary(input: {
  candidate: RoomBoundaryCandidate;
  compatibilityTier: RoomCollisionAuthorityLineage["roomBoundary"]["compatibilityTier"];
  observation: EmptyRoomObservationEvidence | null;
  openings: readonly EmptyObservedOpening[];
  receiptIntegrityReasons: readonly string[];
}): RoomCollisionBoundary {
  const candidate = input.candidate;
  const reasons: string[] = [];
  let status: RoomCollisionCandidateStatus | null = null;

  if (candidate.status !== "accepted") {
    reasons.push(ROOM_COLLISION_REASON.s4aNotAccepted);
    status = candidate.status;
  }

  const geometryComplete = Boolean(
    candidate.worldGeometry &&
      candidate.authority.baseSegment === true &&
      candidate.authority.supportPlane === true,
  );
  if (!geometryComplete) {
    reasons.push(ROOM_COLLISION_REASON.s4aGeometryIncomplete);
    status = status ?? "insufficient";
  }

  const sideSign = candidate.interior.sideSign;
  if (candidate.interior.status !== "accepted" || (sideSign !== 1 && sideSign !== -1)) {
    reasons.push(ROOM_COLLISION_REASON.interiorNotCollisionReady);
    status = status ?? "insufficient";
  }

  const cameraSideSign = candidate.interior.cameraSideSign;
  if (
    !(sideSign === 1 || sideSign === -1) ||
    !(cameraSideSign === 1 || cameraSideSign === -1) ||
    cameraSideSign !== sideSign
  ) {
    reasons.push(ROOM_COLLISION_REASON.interiorCameraNotCorroborated);
    status = status ?? "insufficient";
  }

  const imageSampleCount = candidate.imageEvidence.lineResidual?.sampleCount ??
    candidate.imageEvidence.polyline.length;
  const worldSampleCount = candidate.projection.worldSamples.length;
  const lineResidualInformative = imageSampleCount >= 3 && worldSampleCount >= 3;
  const twoPointObserved = !lineResidualInformative;
  const observedSampleCount = Math.min(imageSampleCount, worldSampleCount);

  if (input.compatibilityTier !== "exact_grid_compatible") {
    reasons.push(ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady);
    status = status ?? "rejected";
  }

  const openingCrossing = floorWallPolylineCrossesOpeningInterior(
    candidate.imageEvidence.polyline,
    input.openings,
  );
  if (openingCrossing) {
    reasons.push(ROOM_COLLISION_REASON.seamCrossesReportedOpening);
    status = status ?? "rejected";
  }

  const integrityReasons = [
    ...input.receiptIntegrityReasons,
    ...candidateIntegrityReasons(candidate),
  ];
  if (integrityReasons.length > 0) {
    reasons.push(ROOM_COLLISION_REASON.s4aContractIntegrity);
    status = status ?? "rejected";
  }

  let twoPointCorroborated = false;
  let corroboration: RoomCollisionBoundaryCorroboration;
  if (lineResidualInformative) {
    corroboration = Object.freeze({
      kind: "observed_multi_point_line" as const,
      openingCrossing,
    });
  } else {
    const span = corroborateTwoPointSpan({
      polyline: candidate.imageEvidence.polyline,
      occupancy: candidate.imageEvidence.occupancy,
      floorPolygon: boundObservedPolygon(
        input.observation,
        candidate.source.floorPlaneId,
      ),
      wallPolygon: boundObservedPolygon(
        input.observation,
        candidate.source.wallPlaneId,
      ),
    });
    twoPointCorroborated = span.passed;
    corroboration = Object.freeze({
      kind: span.kind,
      probeCount: span.probeCount,
      passingProbeCount: span.passingProbeCount,
      floorFrontierPass: span.floorFrontierPass,
      wallFrontierPass: span.wallFrontierPass,
      occupancyPass: span.occupancyPass,
      openingCrossing,
    });
    if (!span.passed) {
      reasons.push(ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient);
      status = status ?? "insufficient";
    }
  }

  const worldGeometry = candidate.worldGeometry;
  const spanM = worldGeometry
    ? Math.hypot(
      worldGeometry.baseEnd.x - worldGeometry.baseStart.x,
      worldGeometry.baseEnd.z - worldGeometry.baseStart.z,
    )
    : null;
  const maxWorldResidualM = candidate.projection.worldResidual?.maxDistance ?? null;
  const residualOverSpan =
    spanM !== null && spanM > 0 && maxWorldResidualM !== null
      ? maxWorldResidualM / spanM
      : null;

  const accepted = status === null;
  return Object.freeze({
    sourceBoundaryId: candidate.id,
    sourceSeamId: candidate.sourceSeamId,
    status: accepted ? "accepted" : status ?? "insufficient",
    collisionEnabled: accepted,
    qualificationReasons: Object.freeze([...reasons]),
    reliabilityClass: lineResidualInformative
      ? collisionReliabilityClass(maxWorldResidualM)
      : "not_applicable",
    diagnostics: Object.freeze({
      observedSampleCount,
      lineResidualInformative,
      maxWorldResidualM,
      spanM: spanM !== null && Number.isFinite(spanM) ? spanM : null,
      residualOverSpan:
        residualOverSpan !== null && Number.isFinite(residualOverSpan)
          ? residualOverSpan
          : null,
    }),
    corroboration,
    finiteBaseSegment: worldGeometry
      ? Object.freeze({
        a: Object.freeze({
          x: worldGeometry.baseStart.x,
          z: worldGeometry.baseStart.z,
        }),
        b: Object.freeze({
          x: worldGeometry.baseEnd.x,
          z: worldGeometry.baseEnd.z,
        }),
      })
      : null,
    supportPlane: worldGeometry
      ? Object.freeze({
        normal: Object.freeze({ ...worldGeometry.supportPlaneNormal }),
        constant: worldGeometry.supportPlaneConstant,
      })
      : null,
    interiorHalfSpace: Object.freeze({
      sideSign: candidate.interior.sideSign,
      cameraSideSign: candidate.interior.cameraSideSign,
    }),
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      openingsNotSubtracted: true as const,
      twoPointObserved,
      twoPointCorroborated,
    }),
  });
}

function boundObservedPolygon(
  observation: EmptyRoomObservationEvidence | null,
  planeId: string | null,
): readonly SourceNormalizedPoint[] | null {
  if (!observation || observation.observerStatus === "failed" || !planeId) {
    return null;
  }
  const plane = observation.observedPlanes.find((item) => item.id === planeId);
  if (!plane || plane.sourceNormalizedPolygon.length < 3) return null;
  return plane.sourceNormalizedPolygon;
}

type SpanCorroborationResult = Readonly<{
  kind: "multi_probe_region_frontier" | "none";
  probeCount: number;
  passingProbeCount: number;
  floorFrontierPass: boolean;
  wallFrontierPass: boolean;
  occupancyPass: boolean;
  passed: boolean;
}>;

function failedSpanCorroboration(): SpanCorroborationResult {
  return {
    kind: "none",
    probeCount: 0,
    passingProbeCount: 0,
    floorFrontierPass: false,
    wallFrontierPass: false,
    occupancyPass: false,
    passed: false,
  };
}

/**
 * Independent span-wise region corroboration for residual-underdetermined
 * seams. Qualification probes never enter the observed polyline, worldSamples,
 * or residual.
 */
function corroborateTwoPointSpan(input: {
  polyline: readonly SourceNormalizedPoint[];
  occupancy: RoomBoundaryOccupancyEvidence | null;
  floorPolygon: readonly SourceNormalizedPoint[] | null;
  wallPolygon: readonly SourceNormalizedPoint[] | null;
}): SpanCorroborationResult {
  if (!input.floorPolygon || !input.wallPolygon) return failedSpanCorroboration();
  const start = input.polyline[0];
  const end = input.polyline[input.polyline.length - 1];
  if (!start || !end) return failedSpanCorroboration();
  const probes = buildTwoPointSpanProbes(start, end, input.floorPolygon, input.wallPolygon);
  if (probes.length === 0) return failedSpanCorroboration();

  let passingProbeCount = 0;
  let floorFrontierPass = true;
  let wallFrontierPass = true;
  let occupancyPass = true;
  for (const probe of probes) {
    const floorDistance = distanceToPolygonFrontier(probe.point, input.floorPolygon);
    const wallDistance = distanceToPolygonFrontier(probe.point, input.wallPolygon);
    const floorOk = floorDistance !== null &&
      floorDistance <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE;
    const wallOk = wallDistance !== null &&
      wallDistance <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE;
    const occupancyOk = localOppositeOccupancyPass({
      probe: probe.point,
      start,
      end,
      occupancy: input.occupancy,
      floorPolygon: input.floorPolygon,
      wallPolygon: input.wallPolygon,
    });
    if (!floorOk) floorFrontierPass = false;
    if (!wallOk) wallFrontierPass = false;
    if (!occupancyOk) occupancyPass = false;
    if (floorOk && wallOk && occupancyOk) passingProbeCount += 1;
  }

  return {
    kind: "multi_probe_region_frontier",
    probeCount: probes.length,
    passingProbeCount,
    floorFrontierPass,
    wallFrontierPass,
    occupancyPass,
    passed: passingProbeCount === probes.length,
  };
}

function buildTwoPointSpanProbes(
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
  floorPolygon: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
): readonly Readonly<{ t: number; point: SourceNormalizedPoint }>[] {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 1e-18) return [];
  const probes: Array<{ t: number; point: SourceNormalizedPoint }> = [{
    t: 0.5,
    point: {
      x: start.x + 0.5 * abx,
      y: start.y + 0.5 * aby,
    },
  }];
  for (const vertex of [...floorPolygon, ...wallPolygon]) {
    const projected = orthogonalProjectionOnOpenSegment(
      vertex,
      start,
      abx,
      aby,
      lengthSq,
    );
    if (projected) probes.push(projected);
  }
  probes.sort((left, right) => left.t - right.t);
  const unique: Array<{ t: number; point: SourceNormalizedPoint }> = [];
  for (const probe of probes) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(probe.t - last.t) <= PROBE_COINCIDENCE_EPS) continue;
    unique.push(probe);
  }
  return unique;
}

function orthogonalProjectionOnOpenSegment(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  abx: number,
  aby: number,
  lengthSq: number,
): { t: number; point: SourceNormalizedPoint } | null {
  const t = ((point.x - start.x) * abx + (point.y - start.y) * aby) / lengthSq;
  if (!(t > OPEN_SEGMENT_PARAM_EPS && t < 1 - OPEN_SEGMENT_PARAM_EPS)) return null;
  const projected = {
    x: start.x + t * abx,
    y: start.y + t * aby,
  };
  if (
    Math.hypot(projected.x - start.x, projected.y - start.y) <= PROBE_COINCIDENCE_EPS ||
    Math.hypot(projected.x - (start.x + abx), projected.y - (start.y + aby)) <=
      PROBE_COINCIDENCE_EPS
  ) {
    return null;
  }
  return { t, point: projected };
}

function localOppositeOccupancyPass(input: {
  probe: SourceNormalizedPoint;
  start: SourceNormalizedPoint;
  end: SourceNormalizedPoint;
  occupancy: RoomBoundaryOccupancyEvidence | null;
  floorPolygon: readonly SourceNormalizedPoint[];
  wallPolygon: readonly SourceNormalizedPoint[];
}): boolean {
  const floorSide = input.occupancy?.floorSide;
  if (floorSide !== "positive" && floorSide !== "negative") return false;
  const tangent = normalize2d({
    x: input.end.x - input.start.x,
    y: input.end.y - input.start.y,
  });
  if (!tangent) return false;
  const floorNormal = normalize2d(perpendicularTowardSide(tangent, floorSide));
  if (!floorNormal) return false;
  const floorSample = {
    x: input.probe.x + floorNormal.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    y: input.probe.y + floorNormal.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  };
  const wallSample = {
    x: input.probe.x - floorNormal.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    y: input.probe.y - floorNormal.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  };
  if (!inNormalizedImageBounds(floorSample) || !inNormalizedImageBounds(wallSample)) {
    return false;
  }
  return imagePointInPolygon(floorSample, input.floorPolygon) &&
    !imagePointInPolygon(floorSample, input.wallPolygon) &&
    imagePointInPolygon(wallSample, input.wallPolygon) &&
    !imagePointInPolygon(wallSample, input.floorPolygon);
}

function signedImageSide(
  origin: SourceNormalizedPoint,
  direction: SourceNormalizedPoint,
  point: SourceNormalizedPoint,
): number {
  return direction.x * (point.y - origin.y) - direction.y * (point.x - origin.x);
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

function inNormalizedImageBounds(point: SourceNormalizedPoint): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function s4aReceiptIntegrityReasons(
  receipt: AfcV2RoomBoundaryAuthorityReceipt,
): string[] {
  const reasons: string[] = [];
  if (receipt.collisionAuthority !== false) reasons.push("s4a_collision_authority_true");
  if (receipt.geometryManufactured !== false) reasons.push("s4a_geometry_manufactured");
  return reasons;
}

function candidateIntegrityReasons(candidate: RoomBoundaryCandidate): string[] {
  const reasons: string[] = [];
  if (candidate.authority.collision !== false) reasons.push("s4a_candidate_collision_true");
  if (candidate.limitations.hiddenContinuation !== false) {
    reasons.push("s4a_hidden_continuation");
  }
  if (candidate.limitations.geometryManufactured !== false) {
    reasons.push("s4a_candidate_geometry_manufactured");
  }
  return reasons;
}

function reportedOpenings(
  observation: EmptyRoomObservationEvidence | null,
): readonly EmptyObservedOpening[] {
  if (!observation || observation.observerStatus === "failed") return [];
  return observation.observedOpenings;
}

function freezeLineage(
  input: RoomCollisionConstructionInput,
): RoomCollisionAuthorityLineage {
  const s4a = input.roomBoundary;
  return Object.freeze({
    roomBoundary: Object.freeze({
      schemaVersion: s4a?.schemaVersion ?? null,
      attemptId: s4a?.lineage.attemptId ?? null,
      loadGeneration: s4a?.lineage.loadGeneration ?? null,
      emptySha256: s4a?.lineage.emptyIdentity.sha256 ?? null,
      originalSha256: s4a?.lineage.originalIdentity.sha256 ?? null,
      compatibilityTier: s4a?.lineage.emptyToOriginalCompatibility.tier ?? null,
      constructionVersion: s4a?.lineage.constructionVersion ?? null,
      lineFitVersion: s4a?.lineage.lineFitVersion ?? null,
      projectionKernelVersion: s4a?.lineage.projectionKernelVersion ?? null,
    }),
    floor: Object.freeze({
      authorityKey: s4a?.lineage.floor.authorityKey ?? null,
      worldWidthM: s4a?.lineage.floor.worldWidthM ?? null,
      referenceDepthM: s4a?.lineage.floor.referenceDepthM ?? null,
    }),
    camera: Object.freeze({
      verticalFovDeg: s4a?.lineage.camera.verticalFovDeg ?? null,
      freezeReceiptVersion: s4a?.lineage.camera.freezeReceiptVersion ?? null,
      freezePayloadSha256: s4a?.lineage.camera.freezePayloadSha256 ?? null,
      pose: s4a?.lineage.camera.pose ?? null,
    }),
    observation: Object.freeze({
      schemaVersion: input.observation?.schemaVersion ??
        s4a?.lineage.observation.schemaVersion ??
        null,
      authority: "observation_only" as const,
      worldProjectionPerformed: false as const,
    }),
    objectCollisionKernelVersion: AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
  });
}

function emptyReceipt(
  input: RoomCollisionConstructionInput,
  constructionReasons: readonly string[],
): AfcV2RoomCollisionAuthorityReceipt {
  return freezeRoomCollisionAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
    authority: "partial_room_collision_authority",
    sourceRoomBoundaryVersion: AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
    qualificationVersion: AFC_V2_ROOM_COLLISION_QUALIFICATION_VERSION,
    geometryKernelVersion: AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
    objectCollisionKernelVersion: AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
    collisionAuthority: false,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed: false,
    verticalExtentKnown: false,
    lineage: freezeLineage(input),
    boundaries: Object.freeze([]),
    summary: Object.freeze({
      accepted: 0,
      ambiguous: 0,
      insufficient: 0,
      rejected: 0,
      skippedNonS4AAccepted: 0,
      candidateCount: 0,
    }),
    constructionReasons: Object.freeze([...constructionReasons]),
  });
}

/**
 * Whole-boundary opening veto. Touching a jamb or opening endpoint is not a
 * crossing. Uses segment-vs-polygon interior tests, not sparse sampling.
 */
export function floorWallPolylineCrossesOpeningInterior(
  polyline: readonly SourceNormalizedPoint[],
  openings: readonly EmptyObservedOpening[],
): boolean {
  if (polyline.length < 2 || openings.length === 0) return false;
  for (const opening of openings) {
    const boundary = opening.sourceNormalizedBoundary;
    if (boundary.length < 2) continue;
    if (opening.boundaryClosure === "complete_visible_outline" && boundary.length >= 3) {
      if (polylineCrossesPolygonInterior(polyline, boundary)) return true;
      continue;
    }
    if (polylineProperlyCrossesPolyline(polyline, boundary)) return true;
  }
  return false;
}

function polylineCrossesPolygonInterior(
  polyline: readonly SourceNormalizedPoint[],
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  for (const point of polyline) {
    if (strictlyInsidePolygon(point, polygon)) return true;
  }
  for (let index = 0; index < polyline.length - 1; index += 1) {
    if (segmentCrossesPolygonInterior(polyline[index], polyline[index + 1], polygon)) {
      return true;
    }
  }
  return false;
}

function segmentCrossesPolygonInterior(
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  const params = [0, 1];
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const hit = closedSegmentIntersectionParameter(start, end, edgeStart, edgeEnd);
    if (hit !== null) params.push(hit);
  }
  params.sort((left, right) => left - right);
  const unique = uniqueParams(params);
  for (let index = 0; index < unique.length - 1; index += 1) {
    const t0 = unique[index];
    const t1 = unique[index + 1];
    if (t1 - t0 <= PARAM_MERGE_ABS) continue;
    const mid = {
      x: start.x + (end.x - start.x) * ((t0 + t1) / 2),
      y: start.y + (end.y - start.y) * ((t0 + t1) / 2),
    };
    if (strictlyInsidePolygon(mid, polygon)) return true;
  }
  return false;
}

function polylineProperlyCrossesPolyline(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): boolean {
  for (let i = 0; i < first.length - 1; i += 1) {
    for (let j = 0; j < second.length - 1; j += 1) {
      if (segmentsProperlyIntersect(first[i], first[i + 1], second[j], second[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

function strictlyInsidePolygon(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  return pointInPolygon(point, polygon) && !pointOnPolygonBoundary(point, polygon);
}

function pointInPolygon(
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

function pointOnPolygonBoundary(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) {
      return true;
    }
  }
  return false;
}

function pointOnSegment(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): boolean {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const apx = point.x - start.x;
  const apy = point.y - start.y;
  const cross = abx * apy - aby * apx;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 1e-24) {
    return Math.hypot(apx, apy) <= ON_BOUNDARY_ABS;
  }
  if (Math.abs(cross) > ON_BOUNDARY_ABS * Math.sqrt(lengthSq)) return false;
  const dot = apx * abx + apy * aby;
  return dot >= -ON_BOUNDARY_ABS && dot <= lengthSq + ON_BOUNDARY_ABS;
}

function closedSegmentIntersectionParameter(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
): number | null {
  const hit = segmentIntersection(a, b, c, d, true);
  return hit ? hit.t : null;
}

function segmentsProperlyIntersect(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
): boolean {
  const hit = segmentIntersection(a, b, c, d, false);
  return hit !== null;
}

function segmentIntersection(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
  inclusive: boolean,
): { t: number; u: number } | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const denom = abx * cdy - aby * cdx;
  if (Math.abs(denom) <= COLLINEAR_CROSS_ABS) return null;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const t = (acx * cdy - acy * cdx) / denom;
  const u = (acx * aby - acy * abx) / denom;
  if (inclusive) {
    if (t < -PARAM_MERGE_ABS || t > 1 + PARAM_MERGE_ABS) return null;
    if (u < -PARAM_MERGE_ABS || u > 1 + PARAM_MERGE_ABS) return null;
    return { t: Math.min(1, Math.max(0, t)), u };
  }
  if (t <= PARAM_MERGE_ABS || t >= 1 - PARAM_MERGE_ABS) return null;
  if (u <= PARAM_MERGE_ABS || u >= 1 - PARAM_MERGE_ABS) return null;
  return { t, u };
}

function uniqueParams(values: readonly number[]): number[] {
  const unique: number[] = [];
  for (const value of values) {
    const last = unique[unique.length - 1];
    if (last === undefined || Math.abs(value - last) > PARAM_MERGE_ABS) {
      unique.push(value);
    }
  }
  return unique;
}
