import type { ExplicitGeminiFloorWallExperimentalTrust } from "./explicit-gemini-floor-wall-trust";
import {
  AFC_V2_ROOM_COLLISION_COORDINATE_SPACE,
  AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION,
  AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION,
  ROOM_COLLISION_DIAGNOSTIC_BASE_Y,
  type RoomCollisionBoundaryCorroboration,
  type RoomCollisionCandidateStatus,
  type RoomCollisionEnabledWall,
  type RoomCollisionWallDiagnostic,
  type RoomCollisionWorldXyz,
  type RoomCollisionWorldXz,
} from "./room-collision-authority-contract";

export type { ExplicitGeminiFloorWallExperimentalTrust };

export const AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION =
  "afc-v2-empty-authoritative-collision-authority/v1" as const;
export const AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_QUALIFICATION_VERSION =
  "afc-v2-empty-authoritative-collision-qualification/v1" as const;
export const AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_POLICY =
  "empty_authoritative_experiment" as const;
export const AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY =
  "qualified_empty_floor_wall_trusted_without_original_corroboration" as const;

export const EMPTY_AUTHORITATIVE_COLLISION_REASON = {
  incompatibleImageTier: "incompatible_image_tier_not_collision_ready",
  s4bUnavailable: "s4b_unavailable",
  constructionFailedClosed: "empty_authoritative_collision_construction_failed_closed",
  zeroCollisionEnabledBoundaries: "zero_collision_enabled_boundaries",
} as const;

export type EmptyAuthoritativeCompatibilityTier =
  | "exact_grid_compatible"
  | "aspect_compatible_rescaled"
  | "incompatible"
  | null;

export type EmptyAuthoritativeCollisionDerivation =
  | "s4b_equivalent_copy"
  | "empty_authoritative_promotion"
  | "observed_interval_subtraction";

export type EmptyAuthoritativeCollisionWall = Readonly<{
  id: string;
  sourceS4ABoundaryId: string;
  sourceSeamId: string;
  sourceS4AStatus: RoomCollisionCandidateStatus | "accepted";
  compatibilityTier: EmptyAuthoritativeCompatibilityTier;
  collisionEnabled: boolean;
  status: RoomCollisionCandidateStatus;
  qualificationReasons: readonly string[];
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
  corroboration: RoomCollisionBoundaryCorroboration;
  twoPointObserved: boolean;
  twoPointCorroborated: boolean;
  openingCrossing: boolean;
  openingSubtractionPerformed: boolean;
  derivation: EmptyAuthoritativeCollisionDerivation;
  experimentalTrust: ExplicitGeminiFloorWallExperimentalTrust | null;
  limitations: Readonly<{
    observedSpanOnly: true;
    verticalExtentUnknown: true;
    hiddenContinuation: false;
    geometryManufactured: false;
  }>;
}>;

export type AfcV2EmptyAuthoritativeCollisionAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION;
  coordinateSpace: typeof AFC_V2_ROOM_COLLISION_COORDINATE_SPACE;
  authority: "partial_empty_authoritative_collision_authority";
  qualificationVersion: typeof AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_QUALIFICATION_VERSION;
  geometryKernelVersion: typeof AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION;
  objectCollisionKernelVersion: typeof AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION;
  collisionPolicy: typeof AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_POLICY;
  imageAuthorityPolicy: typeof AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY;
  originalCorroborationRequired: false;
  experimentalPolicy: true;
  diagnosticOnlyIdentityRegistration: true;
  diagnosticOnlyOriginalLocalization: true;
  collisionAuthority: boolean;
  geometryManufactured: false;
  hiddenContinuation: false;
  closedTopology: false;
  openingSubtractionPerformed: boolean;
  verticalExtentKnown: false;
  lineage: Readonly<{
    compatibilityTier: EmptyAuthoritativeCompatibilityTier;
    roomCollision: Readonly<{
      schemaVersion: string | null;
      qualificationVersion: string | null;
    }>;
    identityRegistration: Readonly<{
      registrationClass: string | null;
      diagnosticOnly: true;
    }>;
    originalLocalization: Readonly<{
      registrationClass: string | null;
      diagnosticOnly: true;
    }>;
  }>;
  walls: readonly EmptyAuthoritativeCollisionWall[];
  summary: Readonly<{
    accepted: number;
    refused: number;
    candidateCount: number;
  }>;
  constructionReasons: readonly string[];
}>;

export function freezeEmptyAuthoritativeCollisionAuthorityReceipt(
  receipt: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt,
): AfcV2EmptyAuthoritativeCollisionAuthorityReceipt {
  return deepFreeze(receipt);
}

export function emptyAuthoritativeCompatibilityAdmitted(
  tier: EmptyAuthoritativeCompatibilityTier,
): boolean {
  return tier === "exact_grid_compatible" || tier === "aspect_compatible_rescaled";
}

export function enabledEmptyAuthoritativeCollisionWalls(
  receipt: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionEnabledWall[] {
  if (!receipt) return Object.freeze([]);
  const walls: RoomCollisionEnabledWall[] = [];
  for (const wall of receipt.walls) {
    if (
      !wall.collisionEnabled ||
      wall.status !== "accepted" ||
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

export function emptyAuthoritativeCollisionWallDiagnostics(
  receipt: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionWallDiagnostic[] {
  if (!receipt) return Object.freeze([]);
  return Object.freeze(
    enabledEmptyAuthoritativeCollisionWalls(receipt).map((wall) =>
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
