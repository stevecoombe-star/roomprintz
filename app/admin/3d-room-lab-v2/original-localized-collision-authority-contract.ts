import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import type { RoomCollisionWallDiagnostic } from "./room-collision-authority-contract";
import { ROOM_COLLISION_DIAGNOSTIC_BASE_Y } from "./room-collision-authority-contract";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  type OriginalSourceNormalizedPoint,
} from "./original-structural-localization-authority-contract";

export const AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION =
  "afc-v2-original-localized-collision-authority/v1" as const;
export const AFC_V2_ORIGINAL_LOCALIZED_COLLISION_QUALIFICATION_VERSION =
  "afc-v2-original-localized-collision-qualification/v1" as const;

export const ORIGINAL_LOCALIZED_COLLISION_REASON = {
  olBoundaryNotAccepted: "ol_boundary_not_accepted",
  olGeometryIncomplete: "ol_geometry_incomplete",
  interiorNotCollisionReady: "ol_interior_not_collision_ready",
  interiorCameraNotCorroborated: "ol_interior_camera_not_corroborated",
  twoPointSupportInsufficient: "ol_two_point_support_insufficient",
  contractIntegrity: "ol_contract_integrity",
  openingUnsafe: "ol_opening_localization_unsafe",
  openingBasisMismatch: "ol_image_basis_mismatch",
  manufacturedGeometry: "ol_geometry_manufactured",
  hiddenContinuation: "ol_hidden_continuation",
  localizationNotCertified: "ol_localization_not_certified",
  constructionFailedClosed: "ol_collision_construction_failed_closed",
  emptyOpeningGeometryForbidden: "ol_empty_opening_geometry_forbidden",
} as const;

export type OriginalLocalizedCollisionDerivation =
  | "original_localized_full_span"
  | "original_localized_interval_subtraction";

export type OriginalLocalizedCollisionWall = Readonly<{
  id: string;
  sourceOlBoundaryId: string;
  sourceSeamId: string;
  collisionEnabled: boolean;
  finiteBaseSegment: Readonly<{
    a: Readonly<{ x: number; z: number }>;
    b: Readonly<{ x: number; z: number }>;
  }> | null;
  supportPlane: Readonly<{
    normal: Readonly<{ x: number; y: number; z: number }>;
    constant: number;
  }> | null;
  interiorHalfSpace: Readonly<{
    sideSign: -1 | 1 | null;
    cameraSideSign: -1 | 1 | 0 | null;
  }>;
  openingSubtractionPerformed: boolean;
  openingImageBasis: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE | null;
  wallSeamImageBasis: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
  derivation: OriginalLocalizedCollisionDerivation;
  qualificationReasons: readonly string[];
  limitations: Readonly<{
    observedSpanOnly: true;
    verticalExtentUnknown: true;
    hiddenContinuation: false;
    emptyCoordinatesAuthoritative: false;
  }>;
}>;

export type OriginalLocalizedOpeningRecord = Readonly<{
  openingId: string;
  imageBasis: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
  wallSeamImageBasis: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
  status: "qualified_floor_gap" | "refused" | "not_localized";
  hostPlaneId: string | null;
  category: string;
  originalBoundary: readonly OriginalSourceNormalizedPoint[] | null;
  floorContactInterval: Readonly<{ t0: number; t1: number }> | null;
  refusalReasons: readonly string[];
}>;

export type AfcV2OriginalLocalizedCollisionAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION;
  coordinateSpace: "calibrated-world-xz/v1";
  authority: "partial_original_localized_collision_authority";
  qualificationVersion: typeof AFC_V2_ORIGINAL_LOCALIZED_COLLISION_QUALIFICATION_VERSION;
  collisionAuthority: boolean;
  geometryManufactured: false;
  hiddenContinuation: false;
  closedTopology: false;
  openingSubtractionPerformed: boolean;
  walls: readonly OriginalLocalizedCollisionWall[];
  openings: readonly OriginalLocalizedOpeningRecord[];
  lineage: Readonly<{
    originalLocalizationReceiptSha256: string | null;
    originalLocalizationClass: string | null;
    originalLocalizedBoundarySchema: string | null;
    identityRegistrationClass: string | null;
    s4aNotMutated: true;
    s4bNotMutated: true;
  }>;
  constructionReasons: readonly string[];
}>;

export function freezeOriginalLocalizedCollisionReceipt(
  receipt: AfcV2OriginalLocalizedCollisionAuthorityReceipt,
): AfcV2OriginalLocalizedCollisionAuthorityReceipt {
  return deepFreeze(receipt);
}

export function enabledOriginalLocalizedCollisionWalls(
  receipt: AfcV2OriginalLocalizedCollisionAuthorityReceipt | null | undefined,
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
      sourceBoundaryId: wall.sourceOlBoundaryId,
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

export function originalLocalizedCollisionWallDiagnostics(
  receipt: AfcV2OriginalLocalizedCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionWallDiagnostic[] {
  return Object.freeze(
    enabledOriginalLocalizedCollisionWalls(receipt).map((wall) =>
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
