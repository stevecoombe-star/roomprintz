import {
  AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
  AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
  AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
  ROOM_COLLISION_DIAGNOSTIC_BASE_Y,
  ROOM_COLLISION_REASON,
  collisionWallDiagnosticsFromReceipt,
  enabledCollisionWallsFromReceipt,
  type AfcV2RoomCollisionAuthorityReceipt,
  type RoomCollisionEnabledWall,
  type RoomCollisionWallDiagnostic,
  type RoomCollisionWorldXyz,
  type RoomCollisionWorldXz,
} from "./room-collision-authority-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import {
  enabledOriginalLocalizedCollisionWalls,
  originalLocalizedCollisionWallDiagnostics,
  type AfcV2OriginalLocalizedCollisionAuthorityReceipt,
} from "./original-localized-collision-authority-contract";
import {
  AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
  emptyAuthoritativeCollisionWallDiagnostics,
  emptyAuthoritativeCompatibilityAdmitted,
  enabledEmptyAuthoritativeCollisionWalls,
  type AfcV2EmptyAuthoritativeCollisionAuthorityReceipt,
} from "./empty-authoritative-collision-authority-contract";
import { trustExplicitGeminiFloorWallObservation } from "./explicit-gemini-floor-wall-trust";

export const AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION =
  "afc-v2-room-envelope-collision-authority/v1" as const;
export const AFC_V2_ROOM_ENVELOPE_COLLISION_QUALIFICATION_VERSION =
  "afc-v2-room-envelope-collision-qualification/v1" as const;

export const ROOM_ENVELOPE_COLLISION_REASON = {
  constructionFailedClosed: "envelope_collision_construction_failed_closed",
  s4bUnavailable: "s4b_unavailable",
  registrationNotCertifiedForPromotion: "registration_not_certified_for_promotion",
  remainingHardGateFailed: "remaining_s4b_hard_gate_failed",
} as const;

export type RoomEnvelopeCollisionDerivation =
  | "s4b_baseline_copy"
  | "observed_interval_subtraction"
  | "certified_rescaled_promotion";

export type RoomEnvelopeCollisionWall = Readonly<{
  id: string;
  sourceEnvelopeWallId: string | null;
  sourceS4BBoundaryId: string | null;
  sourceS4ABoundaryId: string;
  sourceSeamId: string;
  collisionEnabled: boolean;
  finiteBaseSegment: Readonly<{
    a: RoomCollisionWorldXz;
    b: RoomCollisionWorldXz;
  }> | null;
  supportPlane: Readonly<{
    normal: RoomCollisionWorldXyz;
    constant: number;
  }> | null;
  interiorHalfSpace: Readonly<{
    sideSign: -1 | 1 | null;
    cameraSideSign: -1 | 1 | 0 | null;
  }>;
  openingSubtractionPerformed: boolean;
  derivation: RoomEnvelopeCollisionDerivation;
  qualificationReasons: readonly string[];
  limitations: Readonly<{
    observedSpanOnly: true;
    verticalExtentUnknown: true;
    hiddenContinuation: false;
  }>;
}>;

export type AfcV2RoomEnvelopeCollisionAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION;
  coordinateSpace: typeof AFC_V2_ROOM_COLLISION_COORDINATE_SPACE;
  authority: "partial_room_envelope_collision_authority";
  qualificationVersion: typeof AFC_V2_ROOM_ENVELOPE_COLLISION_QUALIFICATION_VERSION;
  geometryKernelVersion: typeof AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION;
  objectCollisionKernelVersion: typeof AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION;
  collisionAuthority: boolean;
  geometryManufactured: false;
  hiddenContinuation: false;
  closedTopology: false;
  openingSubtractionPerformed: boolean;
  lineage: Readonly<{
    roomCollision: Readonly<{
      schemaVersion: string | null;
      qualificationVersion: string | null;
    }>;
    registration: Readonly<{
      schemaVersion: string | null;
      receiptSha256: string | null;
      registrationClass: string | null;
    }>;
    roomEnvelope: Readonly<{
      schemaVersion: string | null;
      geometryDerivation: string | null;
    }>;
  }>;
  walls: readonly RoomEnvelopeCollisionWall[];
  constructionReasons: readonly string[];
}>;

export type ActiveRuntimeCollisionSource =
  | "empty_authoritative"
  | "ol_cq"
  | "s4c_cq"
  | "s4b";

export type ActiveRuntimeCollisionSelection = Readonly<{
  source: ActiveRuntimeCollisionSource;
  walls: readonly RoomCollisionEnabledWall[];
  diagnostics: readonly RoomCollisionWallDiagnostic[];
}>;

export function freezeRoomEnvelopeCollisionAuthorityReceipt(
  receipt: AfcV2RoomEnvelopeCollisionAuthorityReceipt,
): AfcV2RoomEnvelopeCollisionAuthorityReceipt {
  return deepFreeze(receipt);
}

export function enabledEnvelopeCollisionWallsFromReceipt(
  receipt: AfcV2RoomEnvelopeCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionEnabledWall[] {
  if (!receipt) return Object.freeze([]);
  const walls: RoomCollisionEnabledWall[] = [];
  for (const wall of receipt.walls) {
    if (
      !wall.collisionEnabled ||
      !wall.finiteBaseSegment ||
      !wall.supportPlane ||
      (wall.interiorHalfSpace.sideSign !== 1 &&
        wall.interiorHalfSpace.sideSign !== -1)
    ) {
      continue;
    }
    walls.push(Object.freeze({
      id: wall.id,
      sourceBoundaryId: wall.sourceS4ABoundaryId,
      sourceSeamId: wall.sourceSeamId,
      a: Object.freeze({ ...wall.finiteBaseSegment.a }),
      b: Object.freeze({ ...wall.finiteBaseSegment.b }),
      supportPlaneNormal: Object.freeze({ ...wall.supportPlane.normal }),
      supportPlaneConstant: wall.supportPlane.constant,
      sideSign: wall.interiorHalfSpace.sideSign,
    }));
  }
  return Object.freeze(walls);
}

export function envelopeCollisionWallDiagnosticsFromReceipt(
  receipt: AfcV2RoomEnvelopeCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionWallDiagnostic[] {
  if (!receipt) return Object.freeze([]);
  return Object.freeze(
    enabledEnvelopeCollisionWallsFromReceipt(receipt).map((wall) =>
      Object.freeze({
        id: wall.id,
        sourceSeamId: wall.sourceSeamId,
        start: Object.freeze([
          wall.a.x,
          ROOM_COLLISION_DIAGNOSTIC_BASE_Y,
          wall.a.z,
        ] as const),
        end: Object.freeze([
          wall.b.x,
          ROOM_COLLISION_DIAGNOSTIC_BASE_Y,
          wall.b.z,
        ] as const),
      }),
    ),
  );
}

/**
 * Runtime consumes exactly one wall set.
 *
 * Flag OFF (a80aad6): aspect_compatible_rescaled uses EMPTY-authoritative
 * when constructed; exact-grid keeps OL → S4C-CQ → S4B. Never concatenate.
 *
 * Flag ON: admitted image tiers use the experimental EMPTY-authoritative
 * receipt as the only active runtime wall source. Incompatible images
 * produce no experimental walls. Never concatenate OL / S4C / S4B.
 */
export function selectActiveRuntimeCollisionWalls(input: {
  emptyAuthoritativeCollision?: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null;
  originalLocalizedCollision?: AfcV2OriginalLocalizedCollisionAuthorityReceipt | null;
  envelopeCollision?: AfcV2RoomEnvelopeCollisionAuthorityReceipt | null;
  roomCollision?: AfcV2RoomCollisionAuthorityReceipt | null;
}): ActiveRuntimeCollisionSelection {
  const compatibility =
    input.emptyAuthoritativeCollision?.lineage.compatibilityTier ??
    input.roomCollision?.lineage.roomBoundary.compatibilityTier ??
    null;
  if (
    trustExplicitGeminiFloorWallObservation() &&
    input.emptyAuthoritativeCollision?.schemaVersion ===
      AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION
  ) {
    if (emptyAuthoritativeCompatibilityAdmitted(compatibility)) {
      return Object.freeze({
        source: "empty_authoritative" as const,
        walls: enabledEmptyAuthoritativeCollisionWalls(
          input.emptyAuthoritativeCollision,
        ),
        diagnostics: emptyAuthoritativeCollisionWallDiagnostics(
          input.emptyAuthoritativeCollision,
        ),
      });
    }
    return Object.freeze({
      source: "empty_authoritative" as const,
      walls: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }
  if (
    compatibility === "aspect_compatible_rescaled" &&
    input.emptyAuthoritativeCollision?.schemaVersion ===
      AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION
  ) {
    return Object.freeze({
      source: "empty_authoritative" as const,
      walls: enabledEmptyAuthoritativeCollisionWalls(
        input.emptyAuthoritativeCollision,
      ),
      diagnostics: emptyAuthoritativeCollisionWallDiagnostics(
        input.emptyAuthoritativeCollision,
      ),
    });
  }
  if (
    input.originalLocalizedCollision?.lineage.originalLocalizationClass ===
      "certified_original_localized"
  ) {
    return Object.freeze({
      source: "ol_cq" as const,
      walls: enabledOriginalLocalizedCollisionWalls(
        input.originalLocalizedCollision,
      ),
      diagnostics: originalLocalizedCollisionWallDiagnostics(
        input.originalLocalizedCollision,
      ),
    });
  }
  if (
    input.envelopeCollision &&
    input.envelopeCollision.schemaVersion ===
      AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION
  ) {
    return Object.freeze({
      source: "s4c_cq" as const,
      walls: enabledEnvelopeCollisionWallsFromReceipt(input.envelopeCollision),
      diagnostics: envelopeCollisionWallDiagnosticsFromReceipt(
        input.envelopeCollision,
      ),
    });
  }
  return Object.freeze({
    source: "s4b" as const,
    walls: enabledCollisionWallsFromReceipt(input.roomCollision),
    diagnostics: collisionWallDiagnosticsFromReceipt(input.roomCollision),
  });
}

export const S4B_HARD_COLLISION_GATES: readonly string[] = Object.freeze([
  ROOM_COLLISION_REASON.s4aNotAccepted,
  ROOM_COLLISION_REASON.s4aGeometryIncomplete,
  ROOM_COLLISION_REASON.interiorNotCollisionReady,
  ROOM_COLLISION_REASON.interiorCameraNotCorroborated,
  ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
  ROOM_COLLISION_REASON.s4aContractIntegrity,
]);

export function remainingS4bHardGates(
  reasons: readonly string[],
): readonly string[] {
  return reasons.filter((reason) => S4B_HARD_COLLISION_GATES.includes(reason));
}

export function isCertifiedRescaledPromotion(
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null,
): boolean {
  return registration?.registrationClass === "certified_rescaled_registered" &&
    registration.collisionPromotionEligible === true;
}

export function envelopeCollisionUsesRegistration(
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null | undefined,
): boolean {
  return Boolean(registration);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(object as Record<string, unknown>)) {
      deepFreeze(child, seen);
    }
    if (!Object.isFrozen(object)) Object.freeze(object);
  }
  return value;
}
