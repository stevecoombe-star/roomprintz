import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import type { EmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import type { AfcV2OriginalStructuralLocalizationAuthorityReceipt } from "./original-structural-localization-authority-contract";
import type { AfcV2RoomBoundaryAuthorityReceipt, RoomBoundaryCandidate, RoomBoundaryWorldGeometry } from "./room-boundary-authority-contract";
import { ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M } from "./room-boundary-authority-contract";
import { competingSameWall } from "./room-boundary-qualification.server";
import {
  AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
  AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
  AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
  ROOM_COLLISION_REASON,
  type AfcV2RoomCollisionAuthorityReceipt,
  type RoomCollisionBoundary,
} from "./room-collision-authority-contract";
import type { AfcV2RoomEnvelopeAuthorityReceipt } from "./room-envelope-authority-contract";
import { remainingS4bHardGates } from "./room-envelope-collision-authority-contract";
import { qualifyEmptyAuthoritativeOpeningFloorGap } from "./room-envelope-opening-qualification";
import {
  residualWorldSegments,
  subtractParameterIntervals,
} from "./room-envelope-span-subtraction";
import { mergeParameterIntervals } from "./room-opening-intersection-geometry";
import {
  collisionSideSignFromCameraAndPlane,
  explicitGeminiFloorWallObserver,
  finiteSupportPlane,
  finiteWorldSegment,
  imageSideFromPolyline,
  isExplicitGeminiFloorWallObservation,
  reasonsIncludeSemanticVeto,
  trustExplicitGeminiFloorWallObservation,
  type ExplicitGeminiFloorWallExperimentalTrust,
} from "./explicit-gemini-floor-wall-trust";
import {
  AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_POLICY,
  AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_QUALIFICATION_VERSION,
  AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY,
  EMPTY_AUTHORITATIVE_COLLISION_REASON,
  emptyAuthoritativeCompatibilityAdmitted,
  freezeEmptyAuthoritativeCollisionAuthorityReceipt,
  type AfcV2EmptyAuthoritativeCollisionAuthorityReceipt,
  type EmptyAuthoritativeCollisionDerivation,
  type EmptyAuthoritativeCollisionWall,
  type EmptyAuthoritativeCompatibilityTier,
} from "./empty-authoritative-collision-authority-contract";

export type EmptyAuthoritativeCollisionConstructionInput = Readonly<{
  roomCollision: AfcV2RoomCollisionAuthorityReceipt | null;
  roomEnvelope?: AfcV2RoomEnvelopeAuthorityReceipt | null;
  identityRegistration?: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  originalLocalization?: AfcV2OriginalStructuralLocalizationAuthorityReceipt | null;
  roomBoundary?: AfcV2RoomBoundaryAuthorityReceipt | null;
  observation?: EmptyRoomObservationEvidence | null;
}>;

/**
 * Experimental S4C-owned collision product. Reuses certified S4B
 * qualification and geometry. Does not mutate the S4B receipt.
 * Identity registration and ORIGINAL localization are diagnostic only.
 */
export function constructAfcV2EmptyAuthoritativeCollisionAuthority(
  input: EmptyAuthoritativeCollisionConstructionInput,
): AfcV2EmptyAuthoritativeCollisionAuthorityReceipt {
  try {
    return constructUnchecked(input);
  } catch {
    return emptyReceipt(input, [
      EMPTY_AUTHORITATIVE_COLLISION_REASON.constructionFailedClosed,
    ]);
  }
}

function constructUnchecked(
  input: EmptyAuthoritativeCollisionConstructionInput,
): AfcV2EmptyAuthoritativeCollisionAuthorityReceipt {
  const s4b = input.roomCollision;
  if (!s4b) {
    return emptyReceipt(input, [EMPTY_AUTHORITATIVE_COLLISION_REASON.s4bUnavailable]);
  }

  const compatibilityTier = s4b.lineage.roomBoundary.compatibilityTier;
  const admitted = emptyAuthoritativeCompatibilityAdmitted(compatibilityTier);
  const walls: EmptyAuthoritativeCollisionWall[] = [];
  let openingSubtractionPerformed = false;

  for (const boundary of s4b.boundaries) {
    if (!admitted) {
      walls.push(refusedWall(boundary, compatibilityTier, [
        ...withoutAspectVeto(boundary.qualificationReasons),
        EMPTY_AUTHORITATIVE_COLLISION_REASON.incompatibleImageTier,
      ]));
      continue;
    }

    const openingVeto = boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    );
    const hardGates = filterEmptyAuthoritativeHardGates(
      remainingS4bHardGates(boundary.qualificationReasons),
      boundary,
      compatibilityTier,
    );
    const residualSpans = (input.roomEnvelope?.solidBaseSpans ?? []).filter(
      (span) => span.sourceBoundaryId === boundary.sourceBoundaryId,
    );

    if (
      openingVeto &&
      residualSpans.length > 0 &&
      hardGates.length === 0 &&
      geometryCollisionReady(boundary)
    ) {
      openingSubtractionPerformed = true;
      for (const span of residualSpans) {
        walls.push(residualWall(boundary, span, compatibilityTier));
      }
      continue;
    }

    if (
      hardGates.length === 0 &&
      !openingVeto &&
      geometryCollisionReady(boundary)
    ) {
      walls.push(enabledWall(
        boundary,
        compatibilityTier,
        boundary.collisionEnabled
          ? "s4b_equivalent_copy"
          : "empty_authoritative_promotion",
      ));
      continue;
    }

    walls.push(refusedWall(
      boundary,
      compatibilityTier,
      withoutAspectVeto(boundary.qualificationReasons),
    ));
  }

  const trusted = trustExplicitGeminiFloorWallObservation()
    ? applyExplicitGeminiFloorWallTrust({
      input,
      compatibilityTier,
      admitted,
      walls,
      openingSubtractionPerformed,
    })
    : {
      walls,
      openingSubtractionPerformed,
    };

  const accepted = trusted.walls.filter((wall) => wall.collisionEnabled).length;
  const constructionReasons: string[] = [];
  if (accepted === 0) {
    constructionReasons.push(
      EMPTY_AUTHORITATIVE_COLLISION_REASON.zeroCollisionEnabledBoundaries,
    );
  }

  return freezeEmptyAuthoritativeCollisionAuthorityReceipt({
    schemaVersion: AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
    authority: "partial_empty_authoritative_collision_authority",
    qualificationVersion: AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_QUALIFICATION_VERSION,
    geometryKernelVersion: AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
    objectCollisionKernelVersion: AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
    collisionPolicy: AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_POLICY,
    imageAuthorityPolicy: AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY,
    originalCorroborationRequired: false,
    experimentalPolicy: true,
    diagnosticOnlyIdentityRegistration: true,
    diagnosticOnlyOriginalLocalization: true,
    collisionAuthority: accepted > 0,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed: trusted.openingSubtractionPerformed,
    verticalExtentKnown: false,
    lineage: freezeLineage(input, compatibilityTier),
    walls: Object.freeze(trusted.walls),
    summary: Object.freeze({
      accepted,
      refused: trusted.walls.length - accepted,
      candidateCount: trusted.walls.length,
    }),
    constructionReasons: Object.freeze(constructionReasons),
  });
}

function geometryCollisionReady(boundary: RoomCollisionBoundary): boolean {
  return Boolean(
    boundary.finiteBaseSegment &&
      boundary.supportPlane &&
      (boundary.interiorHalfSpace.sideSign === 1 ||
        boundary.interiorHalfSpace.sideSign === -1),
  );
}

function withoutAspectVeto(reasons: readonly string[]): readonly string[] {
  return reasons.filter(
    (reason) =>
      reason !== ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
  );
}

/**
 * Aspect-rescaled EMPTY-authoritative only. S4A is the structural occupancy
 * authority; S4B in-span floor/wall frontiers remain an independent hard
 * check. Fixed-inset occupancy insufficiency is diagnostic once both
 * frontiers pass. This is not majority voting and must not mutate
 * `S4B_HARD_COLLISION_GATES`.
 */
function isEmptyAuthoritativeTwoPointInsufficiencyDemotable(
  boundary: RoomCollisionBoundary,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
): boolean {
  if (compatibilityTier !== "aspect_compatible_rescaled") return false;
  if (sourceS4AStatus(boundary) !== "accepted") return false;
  const corroboration = boundary.corroboration;
  if (corroboration.kind !== "multi_probe_region_frontier") return false;
  return corroboration.floorFrontierPass === true &&
    corroboration.wallFrontierPass === true;
}

function filterEmptyAuthoritativeHardGates(
  hardGates: readonly string[],
  boundary: RoomCollisionBoundary,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
): readonly string[] {
  if (!isEmptyAuthoritativeTwoPointInsufficiencyDemotable(boundary, compatibilityTier)) {
    return hardGates;
  }
  return hardGates.filter(
    (reason) =>
      reason !== ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
  );
}

function sourceS4AStatus(
  boundary: RoomCollisionBoundary,
): EmptyAuthoritativeCollisionWall["sourceS4AStatus"] {
  return boundary.qualificationReasons.includes(ROOM_COLLISION_REASON.s4aNotAccepted)
    ? boundary.status
    : "accepted";
}

function enabledWall(
  boundary: RoomCollisionBoundary,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
  derivation: EmptyAuthoritativeCollisionDerivation,
  experimentalTrust: ExplicitGeminiFloorWallExperimentalTrust | null = null,
): EmptyAuthoritativeCollisionWall {
  return Object.freeze({
    id: boundary.sourceBoundaryId,
    sourceS4ABoundaryId: boundary.sourceBoundaryId,
    sourceSeamId: boundary.sourceSeamId,
    sourceS4AStatus: sourceS4AStatus(boundary),
    compatibilityTier,
    collisionEnabled: true,
    status: "accepted",
    qualificationReasons: Object.freeze([]),
    finiteBaseSegment: boundary.finiteBaseSegment
      ? Object.freeze({
        a: Object.freeze({ ...boundary.finiteBaseSegment.a }),
        b: Object.freeze({ ...boundary.finiteBaseSegment.b }),
      })
      : null,
    supportPlane: boundary.supportPlane
      ? Object.freeze({
        normal: Object.freeze({ ...boundary.supportPlane.normal }),
        constant: boundary.supportPlane.constant,
      })
      : null,
    interiorHalfSpace: Object.freeze({ ...boundary.interiorHalfSpace }),
    corroboration: Object.freeze({ ...boundary.corroboration }),
    twoPointObserved: boundary.limitations.twoPointObserved,
    twoPointCorroborated: boundary.limitations.twoPointCorroborated,
    openingCrossing: boundary.corroboration.openingCrossing,
    openingSubtractionPerformed: false,
    derivation,
    experimentalTrust,
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      geometryManufactured: false as const,
    }),
  });
}

function residualWall(
  boundary: RoomCollisionBoundary,
  span: AfcV2RoomEnvelopeAuthorityReceipt["solidBaseSpans"][number],
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
): EmptyAuthoritativeCollisionWall {
  return Object.freeze({
    id: span.id,
    sourceS4ABoundaryId: boundary.sourceBoundaryId,
    sourceSeamId: span.sourceSeamId,
    sourceS4AStatus: sourceS4AStatus(boundary),
    compatibilityTier,
    collisionEnabled: true,
    status: "accepted",
    qualificationReasons: Object.freeze([]),
    finiteBaseSegment: Object.freeze({
      a: Object.freeze({ ...span.world.a }),
      b: Object.freeze({ ...span.world.b }),
    }),
    supportPlane: boundary.supportPlane
      ? Object.freeze({
        normal: Object.freeze({ ...boundary.supportPlane.normal }),
        constant: boundary.supportPlane.constant,
      })
      : null,
    interiorHalfSpace: Object.freeze({ ...boundary.interiorHalfSpace }),
    corroboration: Object.freeze({ ...boundary.corroboration }),
    twoPointObserved: boundary.limitations.twoPointObserved,
    twoPointCorroborated: boundary.limitations.twoPointCorroborated,
    openingCrossing: true,
    openingSubtractionPerformed: true,
    derivation: "observed_interval_subtraction",
    experimentalTrust: null,
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      geometryManufactured: false as const,
    }),
  });
}

function refusedWall(
  boundary: RoomCollisionBoundary,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
  reasons: readonly string[],
): EmptyAuthoritativeCollisionWall {
  const status = boundary.status === "accepted" ? "rejected" : boundary.status;
  return Object.freeze({
    id: boundary.sourceBoundaryId,
    sourceS4ABoundaryId: boundary.sourceBoundaryId,
    sourceSeamId: boundary.sourceSeamId,
    sourceS4AStatus: sourceS4AStatus(boundary),
    compatibilityTier,
    collisionEnabled: false,
    status,
    qualificationReasons: Object.freeze([...reasons]),
    finiteBaseSegment: boundary.finiteBaseSegment
      ? Object.freeze({
        a: Object.freeze({ ...boundary.finiteBaseSegment.a }),
        b: Object.freeze({ ...boundary.finiteBaseSegment.b }),
      })
      : null,
    supportPlane: boundary.supportPlane
      ? Object.freeze({
        normal: Object.freeze({ ...boundary.supportPlane.normal }),
        constant: boundary.supportPlane.constant,
      })
      : null,
    interiorHalfSpace: Object.freeze({ ...boundary.interiorHalfSpace }),
    corroboration: Object.freeze({ ...boundary.corroboration }),
    twoPointObserved: boundary.limitations.twoPointObserved,
    twoPointCorroborated: boundary.limitations.twoPointCorroborated,
    openingCrossing: boundary.corroboration.openingCrossing,
    openingSubtractionPerformed: false,
    derivation: boundary.collisionEnabled
      ? "s4b_equivalent_copy"
      : "empty_authoritative_promotion",
    experimentalTrust: null,
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      geometryManufactured: false as const,
    }),
  });
}

type ExperimentalCandidate = Readonly<{
  boundary: RoomCollisionBoundary;
  candidate: RoomBoundaryCandidate | null;
  observer: "general" | "focused";
  side: "left" | "right" | "center";
  mechanical: boolean;
  sideSign: -1 | 1 | null;
  reasons: readonly string[];
}>;

function applyExplicitGeminiFloorWallTrust(args: {
  input: EmptyAuthoritativeCollisionConstructionInput;
  compatibilityTier: EmptyAuthoritativeCompatibilityTier;
  admitted: boolean;
  walls: EmptyAuthoritativeCollisionWall[];
  openingSubtractionPerformed: boolean;
}): {
  walls: EmptyAuthoritativeCollisionWall[];
  openingSubtractionPerformed: boolean;
} {
  const s4b = args.input.roomCollision;
  if (!s4b || !args.admitted) {
    return {
      walls: args.walls.map((wall) => withExperimentalTrust(wall, null)),
      openingSubtractionPerformed: args.openingSubtractionPerformed,
    };
  }

  const evaluated: ExperimentalCandidate[] = s4b.boundaries.map((boundary) =>
    evaluateExperimentalCandidate(boundary, args.input)
  );
  const conflictBySeam = experimentalConflictBySeam(evaluated);
  const next: EmptyAuthoritativeCollisionWall[] = [];
  let openingSubtractionPerformed = args.openingSubtractionPerformed;

  for (let index = 0; index < s4b.boundaries.length; index += 1) {
    const boundary = s4b.boundaries[index]!;
    const evaluatedCandidate = evaluated[index]!;
    const baseline = args.walls.filter(
      (wall) => wall.sourceS4ABoundaryId === boundary.sourceBoundaryId,
    );
    const conflict = conflictBySeam.get(boundary.sourceSeamId) ?? "none";
    const trust = experimentalTrustFor(
      evaluatedCandidate,
      conflict,
      args.input,
    );

    if (conflict === "general_competing_ambiguous") {
      next.push(refusedExperimentalWall(boundary, args.compatibilityTier, trust, [
        ...withoutAspectVeto(boundary.qualificationReasons),
        "competing_same_wall_trace",
      ]));
      continue;
    }
    if (conflict === "general_wins" && evaluatedCandidate.observer === "focused") {
      next.push(refusedExperimentalWall(boundary, args.compatibilityTier, trust, [
        ...withoutAspectVeto(boundary.qualificationReasons),
        "focused_duplicate_suppressed:general_side_floor_wall_present",
      ]));
      continue;
    }
    const geometryUsable = finiteWorldSegment(
      boundary.finiteBaseSegment,
      ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
    ) && finiteSupportPlane(boundary.supportPlane) &&
      (evaluatedCandidate.sideSign === 1 || evaluatedCandidate.sideSign === -1);
    if (!geometryUsable) {
      next.push(refusedExperimentalWall(
        boundary,
        args.compatibilityTier,
        trust,
        withoutAspectVeto(boundary.qualificationReasons),
      ));
      continue;
    }
    if (!evaluatedCandidate.mechanical || !trust?.experimentalAcceptance) {
      if (baseline.length > 0) {
        next.push(...baseline.map((wall) => withExperimentalTrust(wall, trust)));
      } else {
        next.push(refusedExperimentalWall(
          boundary,
          args.compatibilityTier,
          trust,
          withoutAspectVeto(boundary.qualificationReasons),
        ));
      }
      continue;
    }

    const openingWalls = experimentalOpeningWalls(
      boundary,
      evaluatedCandidate,
      args.input,
      args.compatibilityTier,
      trust,
    );
    if (openingWalls) {
      openingSubtractionPerformed = true;
      next.push(...openingWalls);
      continue;
    }

    next.push(enabledExperimentalWall(
      boundary,
      evaluatedCandidate,
      args.compatibilityTier,
      trust,
      args.input.roomCollision?.lineage.camera.pose?.position ?? null,
    ));
  }

  return { walls: next, openingSubtractionPerformed };
}

function evaluateExperimentalCandidate(
  boundary: RoomCollisionBoundary,
  input: EmptyAuthoritativeCollisionConstructionInput,
): ExperimentalCandidate {
  const candidate = s4aCandidateFor(input, boundary);
  const observer = candidate
    ? explicitGeminiFloorWallObserver(candidate.source.observationSource)
    : null;
  const explicit = Boolean(
    candidate &&
      isExplicitGeminiFloorWallObservation(candidate.source) &&
      candidate.source.ambiguity === null,
  );
  const polyline = candidate?.imageEvidence.polyline ?? [];
  const side = imageSideFromPolyline(polyline);
  const reasons = [
    ...withoutAspectVeto(boundary.qualificationReasons),
    ...(candidate?.reasons ?? []),
  ];
  const contractIntegrity = reasons.includes(ROOM_COLLISION_REASON.s4aContractIntegrity);
  const existingSide = boundary.interiorHalfSpace.sideSign;
  const cameraSide = collisionSideSignFromCameraAndPlane(
    boundary.supportPlane,
    input.roomCollision?.lineage.camera.pose?.position ?? null,
  );
  const sideSign = existingSide === 1 || existingSide === -1
    ? existingSide
    : cameraSide;
  const mechanical = explicit &&
    observer !== null &&
    !contractIntegrity &&
    finiteWorldSegment(
      boundary.finiteBaseSegment,
      ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
    ) &&
    finiteSupportPlane(boundary.supportPlane) &&
    (sideSign === 1 || sideSign === -1);
  return {
    boundary,
    candidate,
    observer: observer ?? "general",
    side,
    mechanical,
    sideSign,
    reasons,
  };
}

function experimentalConflictBySeam(
  evaluated: readonly ExperimentalCandidate[],
): Map<string, ExplicitGeminiFloorWallExperimentalTrust["conflict"]> {
  const conflicts = new Map<string, ExplicitGeminiFloorWallExperimentalTrust["conflict"]>();
  const mechanical = evaluated.filter((item) => item.mechanical);
  const generals = mechanical.filter((item) => item.observer === "general");

  for (const first of generals) {
    for (const second of generals) {
      if (first.boundary.sourceSeamId >= second.boundary.sourceSeamId) continue;
      const left = worldGeometryFor(first);
      const right = worldGeometryFor(second);
      if (left && right && competingSameWall(left, right)) {
        conflicts.set(first.boundary.sourceSeamId, "general_competing_ambiguous");
        conflicts.set(second.boundary.sourceSeamId, "general_competing_ambiguous");
      }
    }
  }

  for (const focused of mechanical.filter((item) => item.observer === "focused")) {
    const generalSameSide = mechanical.some((item) =>
      item.observer === "general" &&
      item.side === focused.side &&
      conflicts.get(item.boundary.sourceSeamId) !== "general_competing_ambiguous"
    );
    if (generalSameSide) {
      conflicts.set(focused.boundary.sourceSeamId, "general_wins");
    }
  }
  return conflicts;
}

function experimentalTrustFor(
  evaluated: ExperimentalCandidate,
  conflict: ExplicitGeminiFloorWallExperimentalTrust["conflict"],
  input: EmptyAuthoritativeCollisionConstructionInput,
): ExplicitGeminiFloorWallExperimentalTrust | null {
  const candidate = evaluated.candidate;
  if (!candidate || !isExplicitGeminiFloorWallObservation(candidate.source)) {
    return null;
  }
  const observer = explicitGeminiFloorWallObserver(candidate.source.observationSource);
  if (!observer) return null;
  const experimentalAcceptance = evaluated.mechanical &&
    conflict !== "general_competing_ambiguous" &&
    !(conflict === "general_wins" && observer === "focused");
  const segment = evaluated.boundary.finiteBaseSegment &&
      finiteWorldSegment(evaluated.boundary.finiteBaseSegment)
    ? {
      a: { ...evaluated.boundary.finiteBaseSegment.a },
      b: { ...evaluated.boundary.finiteBaseSegment.b },
    }
    : null;
  const mergeReasons = observer === "focused" &&
      input.observation &&
      input.observation.observerStatus !== "failed"
    ? input.observation.qualityGate.focusedSideFloorWall.resolutionReasons
    : [];
  return Object.freeze({
    enabled: true as const,
    source: "explicit_gemini_floor_wall" as const,
    observer,
    geminiSeamId: candidate.sourceSeamId,
    confidence: candidate.source.confidence,
    priorQualificationStatus: candidate.status,
    priorQualificationReasons: Object.freeze([
      ...evaluated.reasons,
      ...mergeReasons,
    ]),
    semanticVetoBypassed: reasonsIncludeSemanticVeto(evaluated.reasons) &&
      experimentalAcceptance,
    experimentalAcceptance,
    projectedFiniteSegment: segment,
    collisionEnabled: experimentalAcceptance,
    metricEligibleSeparately: candidate.status === "accepted",
    conflict,
  });
}

function experimentalOpeningWalls(
  boundary: RoomCollisionBoundary,
  evaluated: ExperimentalCandidate,
  input: EmptyAuthoritativeCollisionConstructionInput,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
  trust: ExplicitGeminiFloorWallExperimentalTrust | null,
): EmptyAuthoritativeCollisionWall[] | null {
  const observation = input.observation;
  const candidate = evaluated.candidate;
  const segment = boundary.finiteBaseSegment;
  if (
    !observation ||
    observation.observerStatus === "failed" ||
    !candidate ||
    !segment ||
    !evaluated.sideSign
  ) {
    return null;
  }
  const openings = observation.observedOpenings.filter((opening) =>
    opening.hostPlaneId === null ||
    opening.hostPlaneId === candidate.source.wallPlaneId
  );
  if (openings.length === 0) return null;
  const acceptedGaps = openings.flatMap((opening) => {
    const result = qualifyEmptyAuthoritativeOpeningFloorGap({
      opening,
      polyline: candidate.imageEvidence.polyline,
      occupancy: candidate.imageEvidence.occupancy,
      wallPlaneId: candidate.source.wallPlaneId,
    });
    return result.accepted && result.interval ? [result.interval] : [];
  });
  if (acceptedGaps.length === 0) return null;
  const residuals = subtractParameterIntervals(
    { t0: 0, t1: 1 },
    mergeParameterIntervals(acceptedGaps),
  );
  const world = residualWorldSegments(segment, residuals);
  if (world.length === 0) return null;
  return world.map((span, index) => Object.freeze({
    ...enabledExperimentalWall(
      boundary,
      evaluated,
      compatibilityTier,
      trust,
      input.roomCollision?.lineage.camera.pose?.position ?? null,
    ),
    id: `${boundary.sourceBoundaryId}__ea_solid_${index}`,
    finiteBaseSegment: Object.freeze({
      a: Object.freeze({ ...span.a }),
      b: Object.freeze({ ...span.b }),
    }),
    openingCrossing: true,
    openingSubtractionPerformed: true,
    derivation: "observed_interval_subtraction" as const,
  }));
}

function enabledExperimentalWall(
  boundary: RoomCollisionBoundary,
  evaluated: ExperimentalCandidate,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
  trust: ExplicitGeminiFloorWallExperimentalTrust | null,
  cameraPosition?: Readonly<{ x: number; y: number; z: number }> | null,
): EmptyAuthoritativeCollisionWall {
  const sideSign = evaluated.sideSign === 1 || evaluated.sideSign === -1
    ? evaluated.sideSign
    : boundary.interiorHalfSpace.sideSign;
  const cameraSideSign = collisionSideSignFromCameraAndPlane(
    boundary.supportPlane,
    cameraPosition ?? null,
  ) ?? (sideSign === 1 || sideSign === -1 ? sideSign : boundary.interiorHalfSpace.cameraSideSign);
  return Object.freeze({
    id: boundary.sourceBoundaryId,
    sourceS4ABoundaryId: boundary.sourceBoundaryId,
    sourceSeamId: boundary.sourceSeamId,
    sourceS4AStatus: sourceS4AStatus(boundary),
    compatibilityTier,
    collisionEnabled: true,
    status: "accepted",
    qualificationReasons: Object.freeze([...withoutAspectVeto(evaluated.reasons)]),
    finiteBaseSegment: boundary.finiteBaseSegment
      ? Object.freeze({
        a: Object.freeze({ ...boundary.finiteBaseSegment.a }),
        b: Object.freeze({ ...boundary.finiteBaseSegment.b }),
      })
      : null,
    supportPlane: boundary.supportPlane
      ? Object.freeze({
        normal: Object.freeze({ ...boundary.supportPlane.normal }),
        constant: boundary.supportPlane.constant,
      })
      : null,
    interiorHalfSpace: Object.freeze({
      sideSign,
      cameraSideSign,
    }),
    corroboration: Object.freeze({ ...boundary.corroboration }),
    twoPointObserved: boundary.limitations.twoPointObserved,
    twoPointCorroborated: boundary.limitations.twoPointCorroborated,
    openingCrossing: boundary.corroboration.openingCrossing,
    openingSubtractionPerformed: false,
    derivation: boundary.collisionEnabled
      ? "s4b_equivalent_copy" as const
      : "empty_authoritative_promotion" as const,
    experimentalTrust: trust
      ? Object.freeze({ ...trust, collisionEnabled: true, experimentalAcceptance: true })
      : null,
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      geometryManufactured: false as const,
    }),
  });
}

function refusedExperimentalWall(
  boundary: RoomCollisionBoundary,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
  trust: ExplicitGeminiFloorWallExperimentalTrust | null,
  reasons: readonly string[],
): EmptyAuthoritativeCollisionWall {
  return Object.freeze({
    ...refusedWall(boundary, compatibilityTier, reasons),
    experimentalTrust: trust
      ? Object.freeze({
        ...trust,
        collisionEnabled: false,
        experimentalAcceptance: false,
      })
      : null,
  });
}

function withExperimentalTrust(
  wall: EmptyAuthoritativeCollisionWall,
  trust: ExplicitGeminiFloorWallExperimentalTrust | null,
): EmptyAuthoritativeCollisionWall {
  return Object.freeze({ ...wall, experimentalTrust: trust });
}

function s4aCandidateFor(
  input: EmptyAuthoritativeCollisionConstructionInput,
  boundary: RoomCollisionBoundary,
): RoomBoundaryCandidate | null {
  const candidates = input.roomBoundary?.candidates ?? [];
  return candidates.find((candidate) => candidate.id === boundary.sourceBoundaryId) ??
    candidates.find((candidate) => candidate.sourceSeamId === boundary.sourceSeamId) ??
    null;
}

function worldGeometryFor(
  evaluated: ExperimentalCandidate,
): RoomBoundaryWorldGeometry | null {
  if (evaluated.candidate?.worldGeometry) return evaluated.candidate.worldGeometry;
  const segment = evaluated.boundary.finiteBaseSegment;
  const plane = evaluated.boundary.supportPlane;
  if (!segment || !plane) return null;
  const dx = segment.b.x - segment.a.x;
  const dz = segment.b.z - segment.a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-12) return null;
  return {
    baseStart: { x: segment.a.x, y: 0, z: segment.a.z },
    baseEnd: { x: segment.b.x, y: 0, z: segment.b.z },
    tangent: { x: dx / length, y: 0, z: dz / length },
    supportPlaneNormal: plane.normal,
    supportPlaneConstant: plane.constant,
  };
}

function freezeLineage(
  input: EmptyAuthoritativeCollisionConstructionInput,
  compatibilityTier: EmptyAuthoritativeCompatibilityTier,
): AfcV2EmptyAuthoritativeCollisionAuthorityReceipt["lineage"] {
  return Object.freeze({
    compatibilityTier,
    roomCollision: Object.freeze({
      schemaVersion: input.roomCollision?.schemaVersion ?? null,
      qualificationVersion: input.roomCollision?.qualificationVersion ?? null,
    }),
    identityRegistration: Object.freeze({
      registrationClass: input.identityRegistration?.registrationClass ?? null,
      diagnosticOnly: true as const,
    }),
    originalLocalization: Object.freeze({
      registrationClass: input.originalLocalization?.registrationClass ?? null,
      diagnosticOnly: true as const,
    }),
  });
}

function emptyReceipt(
  input: EmptyAuthoritativeCollisionConstructionInput,
  constructionReasons: readonly string[],
): AfcV2EmptyAuthoritativeCollisionAuthorityReceipt {
  const compatibilityTier =
    input.roomCollision?.lineage.roomBoundary.compatibilityTier ?? null;
  return freezeEmptyAuthoritativeCollisionAuthorityReceipt({
    schemaVersion: AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
    authority: "partial_empty_authoritative_collision_authority",
    qualificationVersion: AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_QUALIFICATION_VERSION,
    geometryKernelVersion: AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
    objectCollisionKernelVersion: AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
    collisionPolicy: AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_POLICY,
    imageAuthorityPolicy: AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY,
    originalCorroborationRequired: false,
    experimentalPolicy: true,
    diagnosticOnlyIdentityRegistration: true,
    diagnosticOnlyOriginalLocalization: true,
    collisionAuthority: false,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed: false,
    verticalExtentKnown: false,
    lineage: freezeLineage(input, compatibilityTier),
    walls: Object.freeze([]),
    summary: Object.freeze({
      accepted: 0,
      refused: 0,
      candidateCount: 0,
    }),
    constructionReasons: Object.freeze([...constructionReasons]),
  });
}
