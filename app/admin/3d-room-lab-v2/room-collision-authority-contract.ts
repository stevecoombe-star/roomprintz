import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  type AfcV2RoomBoundaryAuthorityReceipt,
  type RoomBoundaryCandidateStatus,
} from "./room-boundary-authority-contract";

export const AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION =
  "afc-v2-room-collision-authority/v1" as const;
export const AFC_V2_ROOM_COLLISION_COORDINATE_SPACE =
  AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE;
export const AFC_V2_ROOM_COLLISION_QUALIFICATION_VERSION =
  "afc-v2-room-collision-qualification/v3" as const;
export const AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION =
  "afc-v2-room-collision-geometry/v1" as const;
export const AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION =
  "afc-v2-room-collision-object-kernel/v1" as const;

export const ROOM_COLLISION_RELIABILITY_NOMINAL_RESIDUAL_RATIO = 0.8;
export const ROOM_COLLISION_DIAGNOSTIC_BASE_Y = 0.018;

export const ROOM_COLLISION_REASON = {
  s4aNotAccepted: "s4a_not_accepted",
  s4aGeometryIncomplete: "s4a_geometry_incomplete",
  interiorNotCollisionReady: "interior_not_collision_ready",
  interiorCameraNotCorroborated: "interior_camera_not_corroborated",
  /**
   * Legacy automatic-refusal reason for n<3 residual. Retired from the live
   * two-point path; kept only so older receipts/types remain recognizable.
   * Live two-point refusal uses two_point_region_corroboration_insufficient.
   */
  twoPointOrUnderdeterminedLine: "two_point_or_underdetermined_line",
  twoPointRegionCorroborationInsufficient:
    "two_point_region_corroboration_insufficient",
  aspectRescaledOrIncompatibleNotCollisionReady:
    "aspect_rescaled_or_incompatible_not_collision_ready",
  seamCrossesReportedOpening: "seam_crosses_reported_opening",
  s4aContractIntegrity: "s4a_contract_integrity",
  collisionConstructionFailedClosed: "collision_construction_failed_closed",
  s4aUnavailable: "s4a_unavailable",
  zeroCollisionEnabledBoundaries: "zero_collision_enabled_boundaries",
} as const;

export type RoomCollisionCandidateStatus = RoomBoundaryCandidateStatus;

export type RoomCollisionReliabilityClass =
  | "nominal"
  | "near_s4a_residual_limit"
  | "not_applicable";

export type RoomCollisionWorldXz = Readonly<{
  x: number;
  z: number;
}>;

export type RoomCollisionWorldXyz = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type RoomCollisionBoundaryLimitations = Readonly<{
  observedSpanOnly: true;
  verticalExtentUnknown: true;
  hiddenContinuation: false;
  openingsNotSubtracted: true;
  /** True only when the observed polyline has fewer than 3 vertices. */
  twoPointObserved: boolean;
  /**
   * True when residual-underdetermined corroboration passed. Applies to both
   * 2-point seams and residual-underdetermined n>=3 seams.
   */
  twoPointCorroborated: boolean;
}>;

export type RoomCollisionCorroborationKind =
  | "observed_multi_point_line"
  | "multi_probe_region_frontier"
  | "none";

export type RoomCollisionProbeEvidenceStatus =
  | "pass"
  | "contradiction"
  | "not_applicable";

export type RoomCollisionProbeEvidence = Readonly<{
  status: RoomCollisionProbeEvidenceStatus;
}>;

export type RoomCollisionBoundaryCorroboration = Readonly<{
  kind: RoomCollisionCorroborationKind;
  probeCount?: number;
  passingProbeCount?: number;
  /**
   * Floor/wall/occupancy summary booleans are defined against *applicable*
   * evidence only. `false` means applicable contradiction or zero applicable
   * evidence, never mere unsupported/truncated observation.
   */
  floorFrontierPass?: boolean;
  wallFrontierPass?: boolean;
  occupancyPass?: boolean;
  applicableProbeCount?: number;
  passingApplicableProbeCount?: number;
  contradictionProbeCount?: number;
  notApplicableProbeCount?: number;
  probes?: readonly RoomCollisionProbeEvidence[];
  openingCrossing: boolean;
}>;

export type RoomCollisionBoundaryDiagnostics = Readonly<{
  observedSampleCount: number;
  /**
   * True only when n>=3, image residual <= 0.006, world residual <= 0.05 m,
   * and no projection-invalidating condition. Sample count alone is not proof.
   */
  lineResidualInformative: boolean;
  lineResidualClass: "supported" | "underdetermined";
  maxWorldResidualM: number | null;
  spanM: number | null;
  residualOverSpan: number | null;
}>;

export type RoomCollisionBoundary = Readonly<{
  sourceBoundaryId: string;
  sourceSeamId: string;
  status: RoomCollisionCandidateStatus;
  collisionEnabled: boolean;
  qualificationReasons: readonly string[];
  reliabilityClass: RoomCollisionReliabilityClass;
  diagnostics: RoomCollisionBoundaryDiagnostics;
  corroboration: RoomCollisionBoundaryCorroboration;
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
  limitations: RoomCollisionBoundaryLimitations;
}>;

export type RoomCollisionAuthorityLineage = Readonly<{
  roomBoundary: Readonly<{
    schemaVersion: string | null;
    attemptId: string | null;
    loadGeneration: number | null;
    emptySha256: string | null;
    originalSha256: string | null;
    compatibilityTier:
      | "exact_grid_compatible"
      | "aspect_compatible_rescaled"
      | "incompatible"
      | null;
    constructionVersion: string | null;
    lineFitVersion: string | null;
    projectionKernelVersion: string | null;
  }>;
  floor: Readonly<{
    authorityKey: string | null;
    worldWidthM: number | null;
    referenceDepthM: number | null;
  }>;
  camera: Readonly<{
    verticalFovDeg: number | null;
    freezeReceiptVersion: string | null;
    freezePayloadSha256: string | null;
    pose: AfcV2RoomBoundaryAuthorityReceipt["lineage"]["camera"]["pose"] | null;
  }>;
  observation: Readonly<{
    schemaVersion: string | null;
    authority: "observation_only" | null;
    worldProjectionPerformed: false;
  }>;
  objectCollisionKernelVersion: typeof AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION;
}>;

export type RoomCollisionAuthoritySummary = Readonly<{
  accepted: number;
  ambiguous: number;
  insufficient: number;
  rejected: number;
  skippedNonS4AAccepted: number;
  candidateCount: number;
}>;

export type AfcV2RoomCollisionAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION;
  coordinateSpace: typeof AFC_V2_ROOM_COLLISION_COORDINATE_SPACE;
  authority: "partial_room_collision_authority";
  sourceRoomBoundaryVersion: typeof AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION;
  qualificationVersion: typeof AFC_V2_ROOM_COLLISION_QUALIFICATION_VERSION;
  geometryKernelVersion: typeof AFC_V2_ROOM_COLLISION_GEOMETRY_KERNEL_VERSION;
  objectCollisionKernelVersion: typeof AFC_V2_ROOM_COLLISION_OBJECT_KERNEL_VERSION;
  collisionAuthority: boolean;
  geometryManufactured: false;
  hiddenContinuation: false;
  closedTopology: false;
  openingSubtractionPerformed: false;
  verticalExtentKnown: false;
  lineage: RoomCollisionAuthorityLineage;
  boundaries: readonly RoomCollisionBoundary[];
  summary: RoomCollisionAuthoritySummary;
  constructionReasons: readonly string[];
}>;

export type RoomCollisionEnabledWall = Readonly<{
  id: string;
  sourceBoundaryId: string;
  sourceSeamId: string;
  a: RoomCollisionWorldXz;
  b: RoomCollisionWorldXz;
  supportPlaneNormal: RoomCollisionWorldXyz;
  supportPlaneConstant: number;
  sideSign: -1 | 1;
}>;

export type RoomCollisionWallDiagnostic = Readonly<{
  id: string;
  sourceSeamId: string;
  start: readonly [number, number, number];
  end: readonly [number, number, number];
}>;

export function freezeRoomCollisionAuthorityReceipt(
  receipt: AfcV2RoomCollisionAuthorityReceipt,
): AfcV2RoomCollisionAuthorityReceipt {
  return deepFreeze(receipt);
}

export function collisionReliabilityClass(
  maxWorldResidualM: number | null | undefined,
): RoomCollisionReliabilityClass {
  if (
    maxWorldResidualM === null ||
    maxWorldResidualM === undefined ||
    !Number.isFinite(maxWorldResidualM)
  ) {
    return "not_applicable";
  }
  if (ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M <= 0) return "not_applicable";
  const ratio = maxWorldResidualM / ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M;
  return ratio <= ROOM_COLLISION_RELIABILITY_NOMINAL_RESIDUAL_RATIO
    ? "nominal"
    : "near_s4a_residual_limit";
}

export type RoomCollisionQualificationBasisLabel =
  | "multi-point residual-supported"
  | "two-point region-corroborated"
  | "two-point region corroboration failed"
  | "residual-underdetermined region-corroborated"
  | "residual-underdetermined region corroboration failed";

export function roomCollisionQualificationBasisLabel(
  boundary: Pick<RoomCollisionBoundary, "limitations" | "diagnostics">,
): RoomCollisionQualificationBasisLabel {
  if (boundary.diagnostics.lineResidualInformative) {
    return "multi-point residual-supported";
  }
  if (boundary.limitations.twoPointObserved) {
    return boundary.limitations.twoPointCorroborated
      ? "two-point region-corroborated"
      : "two-point region corroboration failed";
  }
  return boundary.limitations.twoPointCorroborated
    ? "residual-underdetermined region-corroborated"
    : "residual-underdetermined region corroboration failed";
}

export function enabledCollisionWallsFromReceipt(
  receipt: AfcV2RoomCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionEnabledWall[] {
  if (!receipt) return Object.freeze([]);
  const walls: RoomCollisionEnabledWall[] = [];
  for (const boundary of receipt.boundaries) {
    if (
      !boundary.collisionEnabled ||
      boundary.status !== "accepted" ||
      !boundary.finiteBaseSegment ||
      !boundary.supportPlane ||
      (boundary.interiorHalfSpace.sideSign !== 1 &&
        boundary.interiorHalfSpace.sideSign !== -1)
    ) {
      continue;
    }
    walls.push(Object.freeze({
      id: boundary.sourceBoundaryId,
      sourceBoundaryId: boundary.sourceBoundaryId,
      sourceSeamId: boundary.sourceSeamId,
      a: Object.freeze({ ...boundary.finiteBaseSegment.a }),
      b: Object.freeze({ ...boundary.finiteBaseSegment.b }),
      supportPlaneNormal: Object.freeze({ ...boundary.supportPlane.normal }),
      supportPlaneConstant: boundary.supportPlane.constant,
      sideSign: boundary.interiorHalfSpace.sideSign,
    }));
  }
  return Object.freeze(walls);
}

export function collisionWallDiagnosticsFromReceipt(
  receipt: AfcV2RoomCollisionAuthorityReceipt | null | undefined,
): readonly RoomCollisionWallDiagnostic[] {
  if (!receipt) return Object.freeze([]);
  return Object.freeze(
    enabledCollisionWallsFromReceipt(receipt).map((wall) =>
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
