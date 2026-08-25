export const P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION =
  "p2-s2g-collision-safe-blocker-qualification/v1" as const;
export const P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE =
  "calibrated-world-xz/v1" as const;
export const P2_S2G_COLLISION_SAFE_BLOCKER_GEOMETRY_KIND =
  "finite_two_sided_line_segment" as const;

export type CollisionSafeBlockerWorldXZ = Readonly<{
  x: number;
  z: number;
}>;

export type CollisionSafeBlockerSourceIdentity = Readonly<{
  sourceFragmentId: string;
  sourceGeometryVersion: string;
  sourcePolicyVersion: string;
  sourceProjectionVersion: string;
  sourceCoordinateSpace: string;
  sourceGeometryKind: string;
}>;

/**
 * The only blocker geometry contract intended for future AFC runtime collision.
 * It contains exact qualified source edges, never inferred wall topology.
 */
export type CollisionSafeBlockerSegment = Readonly<{
  id: string;
  qualificationVersion:
    typeof P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION;
  coordinateSpace: typeof P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE;
  geometryKind: typeof P2_S2G_COLLISION_SAFE_BLOCKER_GEOMETRY_KIND;
  sourceIdentity: CollisionSafeBlockerSourceIdentity;
  sourceEdgeIndex: number;
  sourcePointIndices: readonly [number, number];
  a: CollisionSafeBlockerWorldXZ;
  b: CollisionSafeBlockerWorldXZ;
}>;

export type CollisionSafeBlockerRejectionReason =
  | "duplicate_source_identity"
  | "uncertified_source_provenance"
  | "non_finite_endpoint"
  | "degenerate_source_edge";

export type CollisionSafeBlockerRejection = Readonly<{
  sourceFragmentId: string;
  sourceEdgeIndex: number;
  sourcePointIndices: readonly [number, number];
  reason: CollisionSafeBlockerRejectionReason;
}>;

export type P2S2GCollisionSafeBlockerQualification = Readonly<{
  qualificationVersion:
    typeof P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION;
  coordinateSpace: typeof P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE;
  segments: readonly CollisionSafeBlockerSegment[];
  rejections: readonly CollisionSafeBlockerRejection[];
}>;
