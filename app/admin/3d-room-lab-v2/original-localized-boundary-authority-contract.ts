import type { FrozenRoomBoundaryCameraSnapshot } from "./room-boundary-authority-contract";
import type {
  RoomBoundaryInteriorEvidence,
  RoomBoundaryLineResidual,
  RoomBoundaryOccupancyEvidence,
  RoomBoundaryWorldGeometry,
  RoomBoundaryWorldXz,
} from "./room-boundary-authority-contract";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  type OriginalSourceNormalizedPoint,
} from "./original-structural-localization-authority-contract";

export const AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION =
  "afc-v2-original-localized-room-boundary-authority/v1" as const;

export type OriginalLocalizedBoundaryCandidateStatus =
  | "accepted"
  | "ambiguous"
  | "insufficient"
  | "rejected";

export const ORIGINAL_LOCALIZED_BOUNDARY_REASON = {
  olNotCertified: "ol_localization_not_certified",
  floorWallNotLocalized: "ol_floor_wall_not_independently_localized",
  originalGeometryMissing: "ol_original_geometry_missing",
  projectionFailed: "ol_original_projection_failed",
  worldLineDegenerate: "ol_world_line_degenerate",
  degenerateWorldSpan: "ol_degenerate_world_span",
  supportPlaneDegenerate: "ol_vertical_support_plane_degenerate",
  interiorInsufficient: "ol_interior_half_space_insufficient",
  cameraContradictsWitness: "ol_interior_camera_contradicts_floor_witness",
  occupancyNotOpposite: "ol_empty_semantic_occupancy_not_opposite",
  nearVertical: "ol_near_vertical_image_seam_insufficient",
  planeBindingInvalid: "ol_invalid_or_missing_floor_wall_plane_binding",
  constructionFailedClosed: "ol_boundary_construction_failed_closed",
  manufacturedGeometry: "ol_geometry_manufactured",
} as const;

export type OriginalLocalizedBoundaryCandidate = Readonly<{
  id: string;
  sourceObservationSeamId: string;
  sourceOLStructureId: string;
  status: OriginalLocalizedBoundaryCandidateStatus;
  source: Readonly<{
    imageBasis: "ORIGINAL";
    coordinateSpace: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
    floorPlaneId: string | null;
    wallPlaneId: string | null;
    planeIds: readonly string[];
  }>;
  originalImageEvidence: Readonly<{
    polyline: readonly OriginalSourceNormalizedPoint[];
    occupancy: RoomBoundaryOccupancyEvidence | null;
    lineResidual: RoomBoundaryLineResidual | null;
    sampleCount: number;
    matchedSampleCount: number;
    matchedFraction: number | null;
    orientationResidual: number | null;
  }>;
  projection: Readonly<{
    kernel: "projectOriginalSourceNormalizedToWorld";
    worldSamples: readonly RoomBoundaryWorldXz[];
    worldResidual: RoomBoundaryLineResidual | null;
  }>;
  worldGeometry: RoomBoundaryWorldGeometry | null;
  interior: RoomBoundaryInteriorEvidence;
  authority: Readonly<{
    kind: "partial_original_localized_room_boundary_authority";
    baseSegment: boolean;
    supportPlane: boolean;
    interiorHalfSpace: "accepted" | "insufficient";
    collision: false;
  }>;
  limitations: Readonly<{
    observedSpanOnly: true;
    hiddenContinuation: false;
    geometryManufactured: false;
    closedTopology: false;
    collisionAuthority: false;
    emptyCoordinatesAuthoritative: false;
  }>;
  reasons: readonly string[];
}>;

export type AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION;
  authority: "partial_original_localized_room_boundary_authority";
  coordinateSpace: "calibrated-world-xz/v1";
  geometryManufactured: false;
  hiddenContinuation: false;
  closedTopology: false;
  collisionAuthority: false;
  camera: FrozenRoomBoundaryCameraSnapshot;
  candidates: readonly OriginalLocalizedBoundaryCandidate[];
  summary: Readonly<{
    accepted: number;
    insufficient: number;
    rejected: number;
    ambiguous: number;
    candidateCount: number;
  }>;
  lineage: Readonly<{
    originalLocalizationSchemaVersion: string | null;
    originalLocalizationReceiptSha256: string | null;
    originalLocalizationClass: string | null;
    identityRegistrationReceiptSha256: string | null;
    s4aNotMutated: true;
  }>;
  constructionReasons: readonly string[];
}>;

export function freezeOriginalLocalizedBoundaryReceipt(
  receipt: AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt,
): AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt {
  return deepFreeze(receipt);
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
