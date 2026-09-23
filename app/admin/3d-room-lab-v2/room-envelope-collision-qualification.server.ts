import { registrationCollisionPromotionEligible } from "./empty-original-registration-authority-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import type { AfcV2RoomEnvelopeAuthorityReceipt } from "./room-envelope-authority-contract";
import {
  AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
  AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
  AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
  ROOM_COLLISION_REASON,
  type AfcV2RoomCollisionAuthorityReceipt,
  type RoomCollisionBoundary,
} from "./room-collision-authority-contract";
import {
  AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION,
  AFC_V2_ROOM_ENVELOPE_COLLISION_QUALIFICATION_VERSION,
  ROOM_ENVELOPE_COLLISION_REASON,
  freezeRoomEnvelopeCollisionAuthorityReceipt,
  isCertifiedRescaledPromotion,
  remainingS4bHardGates,
  type AfcV2RoomEnvelopeCollisionAuthorityReceipt,
  type RoomEnvelopeCollisionWall,
} from "./room-envelope-collision-authority-contract";

export type RoomEnvelopeCollisionConstructionInput = Readonly<{
  roomCollision: AfcV2RoomCollisionAuthorityReceipt | null;
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  roomEnvelope: AfcV2RoomEnvelopeAuthorityReceipt | null;
}>;

export function constructAfcV2RoomEnvelopeCollisionAuthority(
  input: RoomEnvelopeCollisionConstructionInput,
): AfcV2RoomEnvelopeCollisionAuthorityReceipt | null {
  try {
    if (!input.roomCollision) return null;
    return constructUnchecked(input);
  } catch {
    return null;
  }
}

function constructUnchecked(
  input: RoomEnvelopeCollisionConstructionInput,
): AfcV2RoomEnvelopeCollisionAuthorityReceipt {
  const s4b = input.roomCollision!;
  const walls: RoomEnvelopeCollisionWall[] = [];
  let openingSubtractionPerformed = false;

  for (const boundary of s4b.boundaries) {
    if (boundary.collisionEnabled) {
      walls.push(copyS4bWall(boundary, "s4b_baseline_copy"));
      continue;
    }

    const openingVeto = boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    );
    const residualSpans = (input.roomEnvelope?.solidBaseSpans ?? []).filter(
      (span) => span.sourceBoundaryId === boundary.sourceBoundaryId,
    );
    const hardGates = remainingS4bHardGates(boundary.qualificationReasons);
    const aspectBlocked = boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    );

    if (openingVeto && residualSpans.length > 0 && hardGates.length === 0) {
      if (aspectBlocked && !isCertifiedRescaledPromotion(input.registration)) {
        continue;
      }
      openingSubtractionPerformed = true;
      for (const span of residualSpans) {
        walls.push(residualWall(boundary, span));
      }
      continue;
    }

    if (
      aspectBlocked &&
      !openingVeto &&
      isCertifiedRescaledPromotion(input.registration) &&
      hardGates.length === 0 &&
      boundary.finiteBaseSegment &&
      boundary.supportPlane &&
      (boundary.interiorHalfSpace.sideSign === 1 ||
        boundary.interiorHalfSpace.sideSign === -1)
    ) {
      walls.push(copyS4bWall(boundary, "certified_rescaled_promotion", true));
    }
  }

  const enabled = walls.filter((wall) => wall.collisionEnabled);
  const promotionBlocked = input.registration &&
    input.registration.oldCompatibilityTier === "aspect_compatible_rescaled" &&
    !registrationCollisionPromotionEligible(input.registration.registrationClass);
  return freezeRoomEnvelopeCollisionAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
    authority: "partial_room_envelope_collision_authority",
    qualificationVersion: AFC_V2_ROOM_ENVELOPE_COLLISION_QUALIFICATION_VERSION,
    geometryKernelVersion: AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
    objectCollisionKernelVersion: AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
    collisionAuthority: enabled.length > 0,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed,
    lineage: Object.freeze({
      roomCollision: Object.freeze({
        schemaVersion: s4b.schemaVersion,
        qualificationVersion: s4b.qualificationVersion,
      }),
      registration: Object.freeze({
        schemaVersion: input.registration?.schemaVersion ?? null,
        receiptSha256: input.registration?.receiptSha256 ?? null,
        registrationClass: input.registration?.registrationClass ?? null,
      }),
      roomEnvelope: Object.freeze({
        schemaVersion: input.roomEnvelope?.schemaVersion ?? null,
        geometryDerivation: input.roomEnvelope?.geometryDerivation ?? null,
      }),
    }),
    walls: Object.freeze(walls),
    constructionReasons: Object.freeze(
      promotionBlocked
        ? [ROOM_ENVELOPE_COLLISION_REASON.registrationNotCertifiedForPromotion]
        : [],
    ),
  });
}

function residualWall(
  boundary: RoomCollisionBoundary,
  span: AfcV2RoomEnvelopeAuthorityReceipt["solidBaseSpans"][number],
): RoomEnvelopeCollisionWall {
  return Object.freeze({
    id: span.id,
    sourceEnvelopeWallId: span.sourceBoundaryId,
    sourceS4BBoundaryId: boundary.sourceBoundaryId,
    sourceS4ABoundaryId: boundary.sourceBoundaryId,
    sourceSeamId: span.sourceSeamId,
    collisionEnabled: true,
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
    openingSubtractionPerformed: true,
    derivation: "observed_interval_subtraction",
    qualificationReasons: Object.freeze([]),
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
    }),
  });
}

function copyS4bWall(
  boundary: RoomCollisionBoundary,
  derivation: RoomEnvelopeCollisionWall["derivation"],
  enable = boundary.collisionEnabled,
): RoomEnvelopeCollisionWall {
  return Object.freeze({
    id: boundary.sourceBoundaryId,
    sourceEnvelopeWallId: null,
    sourceS4BBoundaryId: boundary.sourceBoundaryId,
    sourceS4ABoundaryId: boundary.sourceBoundaryId,
    sourceSeamId: boundary.sourceSeamId,
    collisionEnabled: enable,
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
    openingSubtractionPerformed: false,
    derivation,
    qualificationReasons: Object.freeze(
      enable && derivation === "certified_rescaled_promotion"
        ? []
        : [...boundary.qualificationReasons],
    ),
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
    }),
  });
}
