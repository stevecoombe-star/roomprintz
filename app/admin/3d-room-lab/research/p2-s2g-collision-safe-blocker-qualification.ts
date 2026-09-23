import {
  P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION,
  P2_S2F_WORLD_COORDINATE_SPACE,
  P2_S2F_WORLD_GEOMETRY_KIND,
  type ProjectedVisibleFloorBlocker,
} from "./empty-visible-floor-blocker-world-projection";
import {
  P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE,
  P2_S2G_COLLISION_SAFE_BLOCKER_GEOMETRY_KIND,
  P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION,
  type CollisionSafeBlockerRejection,
  type CollisionSafeBlockerRejectionReason,
  type CollisionSafeBlockerSegment,
  type CollisionSafeBlockerSourceIdentity,
  type P2S2GCollisionSafeBlockerQualification,
} from "../p2-s2g-collision-safe-blocker-contract";

const CERTIFIED_SOURCE_GEOMETRY_VERSION =
  "p2-s2d-visible-floor-contact-localizer/v1" satisfies
    ProjectedVisibleFloorBlocker["sourceGeometryVersion"];
const CERTIFIED_SOURCE_POLICY_VERSION =
  "p2-s2e-visible-floor-termination-collision-policy/v1" satisfies
    ProjectedVisibleFloorBlocker["sourcePolicyVersion"];

function sourceIdentity(
  blocker: ProjectedVisibleFloorBlocker
): CollisionSafeBlockerSourceIdentity {
  return Object.freeze({
    sourceFragmentId: blocker.sourceFragmentId,
    sourceGeometryVersion: blocker.sourceGeometryVersion,
    sourcePolicyVersion: blocker.sourcePolicyVersion,
    sourceProjectionVersion: blocker.projectionVersion,
    sourceCoordinateSpace: blocker.coordinateSpace,
    sourceGeometryKind: blocker.geometryKind,
  });
}

function hasCertifiedSourceProvenance(
  blocker: ProjectedVisibleFloorBlocker
): boolean {
  return blocker.sourceGeometryVersion ===
      CERTIFIED_SOURCE_GEOMETRY_VERSION &&
    blocker.sourcePolicyVersion ===
      CERTIFIED_SOURCE_POLICY_VERSION &&
    blocker.projectionVersion ===
      P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION &&
    blocker.coordinateSpace === P2_S2F_WORLD_COORDINATE_SPACE &&
    blocker.geometryKind === P2_S2F_WORLD_GEOMETRY_KIND &&
    blocker.startEndpoint.state === "uncertain_support_limit" &&
    blocker.endEndpoint.state === "uncertain_support_limit";
}

function rejection(
  blocker: ProjectedVisibleFloorBlocker,
  sourceEdgeIndex: number,
  reason: CollisionSafeBlockerRejectionReason
): CollisionSafeBlockerRejection {
  return Object.freeze({
    sourceFragmentId: blocker.sourceFragmentId,
    sourceEdgeIndex,
    sourcePointIndices: Object.freeze(
      [sourceEdgeIndex, sourceEdgeIndex + 1] as const
    ),
    reason,
  });
}

function finitePoint(point: Readonly<{ x: number; z: number }>): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

function exactSamePoint(
  a: Readonly<{ x: number; z: number }>,
  b: Readonly<{ x: number; z: number }>
): boolean {
  return a.x === b.x && a.z === b.z;
}

/**
 * Qualifies only consecutive edges already present in certified P2-S2F
 * polylines. Rejected edges disappear in place; their neighbors are never
 * connected, extended, snapped, clamped, or otherwise repaired.
 */
export function qualifyP2S2FCollisionSafeBlockers(
  blockers: readonly ProjectedVisibleFloorBlocker[]
): P2S2GCollisionSafeBlockerQualification {
  const sourceIdentityCounts = new Map<string, number>();
  for (const blocker of blockers) {
    sourceIdentityCounts.set(
      blocker.sourceFragmentId,
      (sourceIdentityCounts.get(blocker.sourceFragmentId) ?? 0) + 1
    );
  }

  const segments: CollisionSafeBlockerSegment[] = [];
  const rejections: CollisionSafeBlockerRejection[] = [];

  for (const blocker of blockers) {
    const duplicateSourceIdentity =
      (sourceIdentityCounts.get(blocker.sourceFragmentId) ?? 0) !== 1;
    const certifiedSource = hasCertifiedSourceProvenance(blocker);
    const identity = sourceIdentity(blocker);

    for (
      let sourceEdgeIndex = 0;
      sourceEdgeIndex + 1 < blocker.pointsWorldXZ.length;
      sourceEdgeIndex += 1
    ) {
      const a = blocker.pointsWorldXZ[sourceEdgeIndex];
      const b = blocker.pointsWorldXZ[sourceEdgeIndex + 1];
      const reason: CollisionSafeBlockerRejectionReason | null =
        duplicateSourceIdentity
          ? "duplicate_source_identity"
          : !certifiedSource
            ? "uncertified_source_provenance"
            : !finitePoint(a) || !finitePoint(b)
              ? "non_finite_endpoint"
              : exactSamePoint(a, b)
                ? "degenerate_source_edge"
                : null;

      if (reason) {
        rejections.push(rejection(blocker, sourceEdgeIndex, reason));
        continue;
      }

      segments.push(Object.freeze({
        id: `${blocker.sourceFragmentId}:edge:${sourceEdgeIndex}`,
        qualificationVersion:
          P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION,
        coordinateSpace: P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE,
        geometryKind: P2_S2G_COLLISION_SAFE_BLOCKER_GEOMETRY_KIND,
        sourceIdentity: identity,
        sourceEdgeIndex,
        sourcePointIndices: Object.freeze(
          [sourceEdgeIndex, sourceEdgeIndex + 1] as const
        ),
        a: Object.freeze({ x: a.x, z: a.z }),
        b: Object.freeze({ x: b.x, z: b.z }),
      }));
    }
  }

  return Object.freeze({
    qualificationVersion:
      P2_S2G_COLLISION_SAFE_BLOCKER_QUALIFICATION_VERSION,
    coordinateSpace: P2_S2G_COLLISION_SAFE_BLOCKER_COORDINATE_SPACE,
    segments: Object.freeze(segments),
    rejections: Object.freeze(rejections),
  });
}
