import type { SupportPlane, SupportVec3 } from "./support-plane-math";

export type RoomEnvelopeSupportKind = "floor" | "wall_back" | "wall_left" | "wall_right" | "ceiling";
export type RoomEnvelopeWallKind = Exclude<RoomEnvelopeSupportKind, "floor" | "ceiling">;
export type RoomEnvelopeFaceId = "floor" | "ceiling" | "left" | "right" | "back" | "front";

export const ROOM_ENVELOPE_SUPPORT_ORDER: readonly RoomEnvelopeSupportKind[] = [
  "floor",
  "wall_back",
  "wall_left",
  "wall_right",
  "ceiling",
];

export const ROOM_ENVELOPE_FACE_ORDER: readonly RoomEnvelopeFaceId[] = [
  "floor",
  "ceiling",
  "left",
  "right",
  "back",
  "front",
];

export type RoomEnvelopeFloorGeometry = {
  kind: "floor";
  boundaryWorld: readonly SupportVec3[];
  plane: SupportPlane;
  xAxisWorld?: SupportVec3;
  zAxisWorld?: SupportVec3;
};

export type RoomEnvelopeWallGeometry = {
  kind: RoomEnvelopeWallKind;
  seamWorld: readonly [SupportVec3, SupportVec3];
  boundaryWorld: readonly SupportVec3[];
  plane: SupportPlane;
};

export type RoomEnvelopeCeilingGeometry = {
  kind: "ceiling";
  boundaryWorld: readonly SupportVec3[];
  plane: SupportPlane;
  roomHeight: number;
};

export type RoomEnvelopeSupportGeometry =
  | RoomEnvelopeFloorGeometry
  | RoomEnvelopeWallGeometry
  | RoomEnvelopeCeilingGeometry;

export type RoomEnvelopeSupportGeometries = {
  floor: RoomEnvelopeFloorGeometry | null;
  wall_back: RoomEnvelopeWallGeometry | null;
  wall_left: RoomEnvelopeWallGeometry | null;
  wall_right: RoomEnvelopeWallGeometry | null;
  ceiling: RoomEnvelopeCeilingGeometry | null;
};

export type RoomEnvelopeInclusionState = Readonly<Record<RoomEnvelopeSupportKind, boolean>>;

export type RoomEnvelopeAnchorChoice =
  | { mode: "default" }
  | { mode: "explicit"; anchor: "wall_back" | "wall_left" | "wall_right" | "floor_axes" };

export type RoomEnvelopeResolvedAnchor = {
  kind: "wall_back" | "wall_left" | "wall_right" | "floor_axes";
  selection: "default" | "explicit";
};

export type RoomEnvelopeForegroundCapGeometry =
  | null
  | { mode: "room_depth_from_back"; depthWorld: number };

/**
 * Geometry-only reconciliation input. The caller has already decided which
 * source-normalized supports are eligible; this type deliberately has no
 * review, confirmation, runtime-usability, camera, or identity fields.
 */
export type RoomEnvelopeGeometryInput = {
  supports: RoomEnvelopeSupportGeometries;
  included: RoomEnvelopeInclusionState;
  anchorChoice: RoomEnvelopeAnchorChoice;
  foregroundCap: RoomEnvelopeForegroundCapGeometry;
};

export type RoomEnvelopeFace =
  | { present: false }
  | { present: true; source: "support"; supportKind: RoomEnvelopeSupportKind; offset: number }
  | {
      present: true;
      source: "operator_assumption";
      assumptionKind: "foreground_depth_from_back";
      offset: number;
    };

export type RoomEnvelopeCandidateFaces = Readonly<Record<RoomEnvelopeFaceId, RoomEnvelopeFace>>;

export type RoomEnvelopeFrame = {
  originWorld: SupportVec3;
  xAxisWorld: SupportVec3;
  yAxisWorld: SupportVec3;
  zAxisWorld: SupportVec3;
  resolvedAnchor: RoomEnvelopeResolvedAnchor;
};

export type RoomEnvelopeDimension =
  | { present: false }
  | { present: true; value: number; provenance: "machine_derived_world_extent" | "operator_assumption" };

export type RoomEnvelopeDimensions = {
  width: RoomEnvelopeDimension;
  visibleReviewedDepth: RoomEnvelopeDimension;
  assumedCappedDepth: RoomEnvelopeDimension;
  roomHeight: RoomEnvelopeDimension;
};

export type RoomEnvelopeAngularResidual = { available: boolean; degrees: number };
export type RoomEnvelopeWallVerticalityResidual = {
  wallKind: RoomEnvelopeWallKind;
  degreesFromVerticalPlane: number;
};
export type RoomEnvelopeSeamResidual = {
  wallKind: RoomEnvelopeWallKind;
  maxAbsY: number;
  faceOffsetSpread: number;
};
export type RoomEnvelopePlaneOffsetResidual = {
  wallKind: RoomEnvelopeWallKind;
  signedOffset: number;
  absoluteOffset: number;
};
export type RoomEnvelopeCornerClosureResidual = {
  pair: "wall_back:wall_left" | "wall_back:wall_right";
  available: boolean;
  intersectionSinTheta: number;
  worldDistanceError: number;
};
export type RoomEnvelopeCoverageResidual = {
  wallKind: RoomEnvelopeWallKind;
  upperCornerGaps: number[];
};
export type RoomEnvelopeExcludedResidual = {
  supportKind: RoomEnvelopeSupportKind;
  available: boolean;
  maxBoundaryOutsideDistance: number;
  supportPlaneOffset: number | null;
};

export type RoomEnvelopeResiduals = {
  wallVerticality: RoomEnvelopeWallVerticalityResidual[];
  floorCeilingParallelism: RoomEnvelopeAngularResidual;
  leftRightParallelism: RoomEnvelopeAngularResidual;
  adjacentWallOrthogonality: {
    backLeft: RoomEnvelopeAngularResidual;
    backRight: RoomEnvelopeAngularResidual;
  };
  wallFloorSeams: RoomEnvelopeSeamResidual[];
  wallCeilingPlaneOrthogonality: RoomEnvelopeAngularResidual[];
  wallCeilingCoverage: RoomEnvelopeCoverageResidual[];
  supportPlaneOffsets: RoomEnvelopePlaneOffsetResidual[];
  maxAbsSupportPlaneOffset: number;
  cornerClosure: RoomEnvelopeCornerClosureResidual[];
  maxBoundaryToEnvelopeDistance: number;
  rmsBoundaryToEnvelopeDistance: number;
  excludedSupportResiduals: RoomEnvelopeExcludedResidual[];
};

export type RoomEnvelopeConditioning = {
  wallSeamLengths: { wallKind: RoomEnvelopeWallKind; length: number }[];
  cornerIntersectionSinTheta: { pair: "wall_back:wall_left" | "wall_back:wall_right"; value: number }[];
  normalizationFailures: string[];
  candidateDimensionBounds: { name: string; value: number | null; valid: boolean }[];
  includedSupportKinds: RoomEnvelopeSupportKind[];
  includedFaceIds: RoomEnvelopeFaceId[];
};

export type RoomEnvelopeBlocker =
  | "non_finite_input"
  | "floor_missing"
  | "explicit_anchor_missing"
  | "explicit_anchor_excluded"
  | "canonical_frame_unavailable"
  | "degenerate_normal"
  | "degenerate_wall_seam"
  | "wall_not_vertical"
  | "support_role_inconsistent"
  | "left_right_order_invalid"
  | "left_right_nonparallel"
  | "back_left_nonorthogonal"
  | "back_right_nonorthogonal"
  | "floor_ceiling_nonparallel"
  | "wall_ceiling_plane_inconsistent"
  | "wall_floor_seam_error"
  | "support_plane_offset"
  | "corner_ill_conditioned"
  | "corner_closure_error"
  | "boundary_outside_envelope"
  | "foreground_cap_requires_back"
  | "foreground_cap_invalid"
  | "dimension_out_of_bounds";

export type RoomEnvelopeDerivationStatus = "unavailable" | "partial" | "candidate" | "inconsistent";

export type RoomEnvelopeReconciliationResult = {
  status: RoomEnvelopeDerivationStatus;
  frame: RoomEnvelopeFrame | null;
  faces: RoomEnvelopeCandidateFaces;
  dimensions: RoomEnvelopeDimensions;
  residuals: RoomEnvelopeResiduals;
  conditioning: RoomEnvelopeConditioning;
  blockers: RoomEnvelopeBlocker[];
  resolvedAnchor: RoomEnvelopeResolvedAnchor | null;
  hasCeiling: boolean;
  hasForegroundCap: boolean;
  isCompleteCappedEnvelope: boolean;
};

export type RoomEnvelopeNumericPolicy = {
  angularToleranceDegrees: number;
  worldDistanceTolerance: number;
  minimumUsableDimension: number;
  maximumBoundedDimension: number;
  normalizationEpsilon: number;
  lineConditioningThreshold: number;
};

export type RoomEnvelopeSupportIdentity = {
  present: boolean;
  included: boolean;
  identityKey: string | null;
};

export type RoomEnvelopeForegroundCapContext =
  | null
  | {
      mode: "room_depth_from_back";
      depthKey: string;
      assumptionId: string;
      revision: string;
    };

/** Context-only staleness input. It intentionally contains no derived geometry. */
export type RoomEnvelopeContextInput = {
  basis: { basisId: string | null; basisFingerprint: string | null };
  camera: { appliedAtIso: string | null; frameWidth: number | null; frameHeight: number | null };
  supports: Readonly<Record<RoomEnvelopeSupportKind, RoomEnvelopeSupportIdentity>>;
  resolvedAnchor: RoomEnvelopeResolvedAnchor;
  foregroundCap: RoomEnvelopeForegroundCapContext;
};
