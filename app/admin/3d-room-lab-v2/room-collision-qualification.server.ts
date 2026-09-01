import type {
  EmptyObservedOpening,
  EmptyRoomObservationEvidence,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  type AfcV2RoomBoundaryAuthorityReceipt,
  type RoomBoundaryCandidate,
  type RoomBoundaryOccupancyEvidence,
} from "./room-boundary-authority-contract";
import {
  applicableEvidencePasses,
  classifyRegionalProbeEvidence,
} from "./room-boundary-qualification.server";
import { floorWallPolylineCrossesOpeningInterior } from "./room-opening-intersection-geometry";
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
  const imageResidual = candidate.imageEvidence.lineResidual?.maxDistance ?? null;
  const worldResidual = candidate.projection.worldResidual?.maxDistance ?? null;
  const projectionInvalidating = candidate.projection.points.some((point) => !point.ok);
  const imageResidualSupported = imageResidual !== null &&
    imageResidual <= ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL;
  const worldResidualSupported = worldResidual !== null &&
    worldResidual <= ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M;
  const lineResidualInformative = imageSampleCount >= 3 &&
    worldSampleCount >= 3 &&
    imageResidualSupported &&
    worldResidualSupported &&
    !projectionInvalidating;
  const lineResidualClass = lineResidualInformative ? "supported" as const : "underdetermined" as const;
  const twoPointObserved = candidate.imageEvidence.polyline.length < 3;
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
    const span = corroborateObservedSpan({
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
      applicableProbeCount: span.applicableProbeCount,
      passingApplicableProbeCount: span.passingApplicableProbeCount,
      contradictionProbeCount: span.contradictionProbeCount,
      notApplicableProbeCount: span.notApplicableProbeCount,
      probes: span.probes,
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
      lineResidualClass,
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
  applicableProbeCount: number;
  passingApplicableProbeCount: number;
  contradictionProbeCount: number;
  notApplicableProbeCount: number;
  probes: readonly Readonly<{ status: "pass" | "contradiction" | "not_applicable" }>[];
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
    applicableProbeCount: 0,
    passingApplicableProbeCount: 0,
    contradictionProbeCount: 0,
    notApplicableProbeCount: 0,
    probes: Object.freeze([]),
    passed: false,
  };
}

/**
 * Independent span-wise region corroboration for residual-underdetermined
 * seams (2-point and n>=3). Qualification probes never enter the observed polyline,
 * worldSamples, or residual.
 */
export function corroborateObservedSpan(input: {
  polyline: readonly SourceNormalizedPoint[];
  occupancy: RoomBoundaryOccupancyEvidence | null;
  floorPolygon: readonly SourceNormalizedPoint[] | null;
  wallPolygon: readonly SourceNormalizedPoint[] | null;
}): SpanCorroborationResult {
  if (!input.floorPolygon || !input.wallPolygon) return failedSpanCorroboration();
  const start = input.polyline[0];
  const end = input.polyline[input.polyline.length - 1];
  if (!start || !end) return failedSpanCorroboration();
  const probes = buildObservedSpanProbes(
    input.polyline,
    input.floorPolygon,
    input.wallPolygon,
  );
  if (probes.length === 0) return failedSpanCorroboration();

  const classified = probes.map((probe) =>
    classifyRegionalProbeEvidence({
      probe: probe.point,
      start,
      end,
      occupancy: input.occupancy,
      floorPolygon: input.floorPolygon!,
      wallPolygon: input.wallPolygon!,
    })
  );
  const passCount = classified.filter((item) => item.status === "pass").length;
  const contradictionCount = classified.filter((item) =>
    item.status === "contradiction"
  ).length;
  const notApplicableCount = classified.filter((item) =>
    item.status === "not_applicable"
  ).length;
  const applicableCount = passCount + contradictionCount;
  const floorApplicable = classified.filter((item) =>
    item.floorFrontier.status !== "not_applicable"
  );
  const wallApplicable = classified.filter((item) =>
    item.wallFrontier.status !== "not_applicable"
  );
  const occupancyApplicable = classified.filter((item) =>
    item.occupancy !== "not_applicable"
  );
  const floorFrontierPass = floorApplicable.length >= 1 &&
    floorApplicable.every((item) => item.floorFrontier.status === "pass");
  const wallFrontierPass = wallApplicable.length >= 1 &&
    wallApplicable.every((item) => item.wallFrontier.status === "pass");
  const occupancyPass = occupancyApplicable.length >= 1 &&
    occupancyApplicable.every((item) => item.occupancy === "pass");

  return {
    kind: "multi_probe_region_frontier",
    probeCount: classified.length,
    passingProbeCount: passCount,
    floorFrontierPass,
    wallFrontierPass,
    occupancyPass,
    applicableProbeCount: applicableCount,
    passingApplicableProbeCount: passCount,
    contradictionProbeCount: contradictionCount,
    notApplicableProbeCount: notApplicableCount,
    probes: Object.freeze(classified.map((item) => Object.freeze({ status: item.status }))),
    passed: applicableEvidencePasses({
      passCount,
      contradictionCount,
    }),
  };
}

function buildObservedSpanProbes(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
): readonly Readonly<{ t: number; point: SourceNormalizedPoint }>[] {
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  if (!start || !end) return [];
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const lengthSq = abx * abx + aby * aby;
  const probes = [
    ...buildTwoPointSpanProbes(start, end, floorPolygon, wallPolygon),
  ];
  if (polyline.length >= 3 && lengthSq > 1e-18) {
    for (let index = 1; index < polyline.length - 1; index += 1) {
      const point = polyline[index];
      const t = ((point.x - start.x) * abx + (point.y - start.y) * aby) / lengthSq;
      if (!(t > OPEN_SEGMENT_PARAM_EPS && t < 1 - OPEN_SEGMENT_PARAM_EPS)) continue;
      probes.push({ t, point });
    }
  }
  probes.sort((left, right) => left.t - right.t);
  const unique: Array<{ t: number; point: SourceNormalizedPoint }> = [];
  for (const probe of probes) {
    const duplicate = unique.some((item) =>
      Math.hypot(item.point.x - probe.point.x, item.point.y - probe.point.y) <=
        PROBE_COINCIDENCE_EPS
    );
    if (duplicate) continue;
    unique.push(probe);
  }
  return unique;
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

export { floorWallPolylineCrossesOpeningInterior } from "./room-opening-intersection-geometry";
