import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import type { AfcV2OriginalStructuralLocalizationAuthorityReceipt } from "./original-structural-localization-authority-contract";
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

  const accepted = walls.filter((wall) => wall.collisionEnabled).length;
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
    openingSubtractionPerformed,
    verticalExtentKnown: false,
    lineage: freezeLineage(input, compatibilityTier),
    walls: Object.freeze(walls),
    summary: Object.freeze({
      accepted,
      refused: walls.length - accepted,
      candidateCount: walls.length,
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
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      geometryManufactured: false as const,
    }),
  });
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
