import type {
  EmptyObservedSeamCategory,
  EmptyObservedSeamObservationSource,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";

export const AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION =
  "afc-v2-room-boundary-authority/v1" as const;
export const AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE =
  "calibrated-world-xz/v1" as const;
export const AFC_V2_ROOM_BOUNDARY_KIND =
  "visible_wall_base_boundary" as const;
export const AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION =
  "afc-v2-room-boundary-projection/v1" as const;
export const AFC_V2_ROOM_BOUNDARY_CONSTRUCTION_VERSION =
  "afc-v2-room-boundary-construction/v1" as const;
export const AFC_V2_ROOM_BOUNDARY_LINE_FIT_VERSION =
  "afc-v2-room-boundary-line-fit/v1" as const;

/**
 * Conservative named thresholds. These are fail-closed engineering gates,
 * not calibrated probabilities. Do not loosen them to manufacture success.
 */
export const ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL = 0.006;
export const ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M = 0.05;
export const ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M = 1e-6;
export const ROOM_BOUNDARY_RAY_EPSILON = 1e-9;
export const ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX = 1e-9;
export const ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE = 0.012;
export const ROOM_BOUNDARY_IMAGE_ON_LINE_ABS = 0.003;
export const ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO = 0.1;
export const ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY = 0.02;
export const ROOM_BOUNDARY_INTERIOR_WITNESS_INSET = 0.012;
export const ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M = 0.02;
export const ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD = (15 * Math.PI) / 180;
export const ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M = 0.15;
export const ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO = 0.3;
export const ROOM_BOUNDARY_DIAGNOSTIC_BASE_Y = 0.01;
export const ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M = 0.2;
export const ROOM_BOUNDARY_GOLDEN_FLOOR_CORNER_MAX_ERROR_M = 0.1;
export const ROOM_BOUNDARY_GOLDEN_FLOOR_CENTER_MAX_ERROR_M = 0.15;

export type RoomBoundaryCandidateStatus =
  | "accepted"
  | "ambiguous"
  | "insufficient"
  | "rejected";

export type RoomBoundaryInteriorStatus = "accepted" | "insufficient";

export type FrozenRoomBoundaryCameraSnapshot = Readonly<{
  verticalFovDeg: number;
  pose: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    lookAt: Readonly<{ x: number; y: number; z: number }>;
    up: Readonly<{ x: number; y: number; z: number }>;
  }>;
  frame: Readonly<{ width: number; height: number }>;
}>;

export type RoomBoundaryWorldXyz = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type RoomBoundaryWorldXz = Readonly<{
  x: number;
  z: number;
}>;

export type RoomBoundaryProjectionFailureReason =
  | "camera unavailable"
  | "camera_realization_failed"
  | "invalid_input"
  | "incompatible_basis"
  | "non-finite input"
  | "invalid ray direction"
  | "ray parallel to floor"
  | "ray_parallel_to_floor"
  | "invalid intersection distance"
  | "intersection behind camera"
  | "ray_intersection_behind_camera"
  | "non-finite intersection point"
  | "ray_projection_failed";

export type RoomBoundaryPerPointProjection =
  | Readonly<{
      ok: true;
      emptySourceNormalized: SourceNormalizedPoint;
      originalSourceNormalized: SourceNormalizedPoint;
      containerNormalized: SourceNormalizedPoint;
      world: RoomBoundaryWorldXyz;
    }>
  | Readonly<{
      ok: false;
      emptySourceNormalized: SourceNormalizedPoint;
      reason: RoomBoundaryProjectionFailureReason;
      detail: string;
    }>;

export type RoomBoundaryOccupancyEvidence = Readonly<{
  floorSide: "positive" | "negative" | "mixed" | "undetermined";
  wallSide: "positive" | "negative" | "mixed" | "undetermined";
  opposite: boolean;
  floorOnLineCount: number;
  floorPositiveCount: number;
  floorNegativeCount: number;
  wallOnLineCount: number;
  wallPositiveCount: number;
  wallNegativeCount: number;
}>;

export type RoomBoundaryFrontierEvidence = Readonly<{
  maxDistanceToFloorFrontier: number | null;
  maxDistanceToWallFrontier: number | null;
  nearFloorFrontier: boolean;
  nearWallFrontier: boolean;
}>;

export type RoomBoundaryLineResidual = Readonly<{
  meanDistance: number;
  maxDistance: number;
  sampleCount: number;
}>;

export type RoomBoundaryWorldGeometry = Readonly<{
  baseStart: RoomBoundaryWorldXyz;
  baseEnd: RoomBoundaryWorldXyz;
  tangent: RoomBoundaryWorldXyz;
  supportPlaneNormal: RoomBoundaryWorldXyz;
  supportPlaneConstant: number;
}>;

export type RoomBoundaryInteriorEvidence = Readonly<{
  status: RoomBoundaryInteriorStatus;
  witnessImagePoint: SourceNormalizedPoint | null;
  witnessWorldPoint: RoomBoundaryWorldXyz | null;
  sideSign: -1 | 1 | null;
  cameraSideSign: -1 | 1 | 0 | null;
  cameraContradictsWitness: boolean;
}>;

export type RoomBoundaryCandidateAuthority = Readonly<{
  kind: typeof AFC_V2_ROOM_BOUNDARY_KIND | null;
  baseSegment: boolean;
  supportPlane: boolean;
  interiorHalfSpace: RoomBoundaryInteriorStatus;
  collision: false;
}>;

export type RoomBoundaryCandidateLimitations = Readonly<{
  observedSpanOnly: true;
  verticalExtentUnknown: true;
  hiddenContinuation: false;
  completeWall: false;
  frameAdjacentEndpoint: boolean;
  geometryManufactured: false;
}>;

export type RoomBoundaryCandidate = Readonly<{
  id: string;
  sourceSeamId: string;
  status: RoomBoundaryCandidateStatus;
  source: Readonly<{
    category: EmptyObservedSeamCategory;
    observationSource: EmptyObservedSeamObservationSource;
    imageBasis: "EMPTY";
    planeIds: readonly string[];
    floorPlaneId: string | null;
    wallPlaneId: string | null;
    confidence: number;
    ambiguity: string | null;
  }>;
  imageEvidence: Readonly<{
    polyline: readonly SourceNormalizedPoint[];
    occupancy: RoomBoundaryOccupancyEvidence | null;
    frontier: RoomBoundaryFrontierEvidence | null;
    lineResidual: RoomBoundaryLineResidual | null;
    nearVertical: boolean;
  }>;
  projection: Readonly<{
    kernelVersion: typeof AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION;
    points: readonly RoomBoundaryPerPointProjection[];
    worldSamples: readonly RoomBoundaryWorldXz[];
    worldResidual: RoomBoundaryLineResidual | null;
  }>;
  worldGeometry: RoomBoundaryWorldGeometry | null;
  interior: RoomBoundaryInteriorEvidence;
  authority: RoomBoundaryCandidateAuthority;
  limitations: RoomBoundaryCandidateLimitations;
  reasons: readonly string[];
}>;

export type RoomBoundaryEmptyOriginalCompatibility = Readonly<{
  version: string;
  tier:
    | "exact_grid_compatible"
    | "aspect_compatible_rescaled"
    | "incompatible";
  reason: string | null;
}>;

export type RoomBoundaryAuthorityLineage = Readonly<{
  attemptId: string;
  loadGeneration: number;
  emptyIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  originalIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  emptyToOriginalCompatibility: RoomBoundaryEmptyOriginalCompatibility;
  observation: Readonly<{
    schemaVersion: string | null;
    authority: "observation_only" | null;
    worldProjectionPerformed: false;
    promptVersion: string | null;
    observerProfile: string | null;
    coordinateSpace: string | null;
  }>;
  floor: Readonly<{
    authorityKey: string;
    worldWidthM: number;
    referenceDepthM: number;
    widthDepthRatio: number;
  }>;
  camera: Readonly<{
    verticalFovDeg: number;
    frame: Readonly<{ width: number; height: number }>;
    pose: FrozenRoomBoundaryCameraSnapshot["pose"];
    freezeReceiptVersion: string | null;
    freezePayloadSha256: string | null;
  }>;
  projectionKernelVersion: typeof AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION;
  constructionVersion: typeof AFC_V2_ROOM_BOUNDARY_CONSTRUCTION_VERSION;
  lineFitVersion: typeof AFC_V2_ROOM_BOUNDARY_LINE_FIT_VERSION;
}>;

export type RoomBoundaryAuthoritySummary = Readonly<{
  accepted: number;
  ambiguous: number;
  insufficient: number;
  rejected: number;
  skippedNonFloorWall: number;
  candidateCount: number;
}>;

export type AfcV2RoomBoundaryAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION;
  coordinateSpace: typeof AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE;
  authority: "partial_room_boundary_authority";
  boundaryKind: typeof AFC_V2_ROOM_BOUNDARY_KIND;
  lineage: RoomBoundaryAuthorityLineage;
  candidates: readonly RoomBoundaryCandidate[];
  summary: RoomBoundaryAuthoritySummary;
  geometryManufactured: false;
  collisionAuthority: false;
  constructionReasons: readonly string[];
}>;

export type RoomBoundaryWallBaseDiagnostic = Readonly<{
  id: string;
  sourceSeamId: string;
  start: readonly [number, number, number];
  end: readonly [number, number, number];
  interiorTick: Readonly<{
    from: readonly [number, number, number];
    to: readonly [number, number, number];
  }> | null;
}>;

export function freezeRoomBoundaryAuthorityReceipt(
  receipt: AfcV2RoomBoundaryAuthorityReceipt,
): AfcV2RoomBoundaryAuthorityReceipt {
  return deepFreeze(receipt);
}

export function wallBaseDiagnosticsFromReceipt(
  receipt: AfcV2RoomBoundaryAuthorityReceipt | null | undefined,
): readonly RoomBoundaryWallBaseDiagnostic[] {
  if (!receipt) return Object.freeze([]);
  return Object.freeze(
    receipt.candidates
      .filter((candidate) =>
        candidate.status === "accepted" && candidate.worldGeometry
      )
      .map((candidate) => {
        const geometry = candidate.worldGeometry!;
        const start = Object.freeze([
          geometry.baseStart.x,
          ROOM_BOUNDARY_DIAGNOSTIC_BASE_Y,
          geometry.baseStart.z,
        ] as const);
        const end = Object.freeze([
          geometry.baseEnd.x,
          ROOM_BOUNDARY_DIAGNOSTIC_BASE_Y,
          geometry.baseEnd.z,
        ] as const);
        const interiorTick =
          candidate.interior.status === "accepted" &&
            candidate.interior.sideSign &&
            Number.isFinite(geometry.supportPlaneNormal.x) &&
            Number.isFinite(geometry.supportPlaneNormal.z)
            ? Object.freeze({
              from: Object.freeze([
                (geometry.baseStart.x + geometry.baseEnd.x) / 2,
                ROOM_BOUNDARY_DIAGNOSTIC_BASE_Y,
                (geometry.baseStart.z + geometry.baseEnd.z) / 2,
              ] as const),
              to: Object.freeze([
                (geometry.baseStart.x + geometry.baseEnd.x) / 2 +
                  geometry.supportPlaneNormal.x * candidate.interior.sideSign *
                    ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M,
                ROOM_BOUNDARY_DIAGNOSTIC_BASE_Y,
                (geometry.baseStart.z + geometry.baseEnd.z) / 2 +
                  geometry.supportPlaneNormal.z * candidate.interior.sideSign *
                    ROOM_BOUNDARY_INTERIOR_TICK_LENGTH_M,
              ] as const),
            })
            : null;
        return Object.freeze({
          id: candidate.id,
          sourceSeamId: candidate.sourceSeamId,
          start,
          end,
          interiorTick,
        });
      }),
  );
}

export function floorWallBoundaryStatusBySeamId(
  receipt: AfcV2RoomBoundaryAuthorityReceipt | null | undefined,
): Readonly<Record<string, RoomBoundaryCandidateStatus>> {
  if (!receipt) return Object.freeze({});
  const statuses: Record<string, RoomBoundaryCandidateStatus> = {};
  for (const candidate of receipt.candidates) {
    statuses[candidate.sourceSeamId] = candidate.status;
  }
  return Object.freeze(statuses);
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
