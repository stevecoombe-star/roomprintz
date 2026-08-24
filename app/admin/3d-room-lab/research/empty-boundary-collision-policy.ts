import type {
  EmptyRegionBoundaryFragment,
} from "./empty-region-boundary-fragments";

export const P2_S2C_BOUNDARY_COLLISION_POLICY_VERSION =
  "p2-s2c-boundary-collision-policy/v1" as const;

export const P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS = Object.freeze({
  minimumSourcePixelLength: 48,
  minimumInsideRegionSupportFraction: 0.8,
  minimumOutsideRegionExclusionFraction: 0.8,
  maximumOutsideFloorLikeFraction: 0.2,
} as const);

export const P2_S2C_BOUNDARY_EVIDENCE_CLASSES = [
  "verified_wall_contact",
  "observed_floor_termination",
  "frame_truncated",
  "unresolved",
] as const;

export const P2_S2C_COLLISION_POLICIES = [
  "block",
  "pass",
  "unresolved",
] as const;

export const P2_S2C_COLLISION_POLICY_REASONS = [
  "source_physical_wall",
  "observed_floor_termination",
  "image_frame_contact",
  "insufficient_finite_support",
  "insufficient_region_side_support",
  "outside_still_floor_like",
] as const;

export type P2S2CBoundaryEvidenceClass =
  typeof P2_S2C_BOUNDARY_EVIDENCE_CLASSES[number];
export type P2S2CCollisionPolicy =
  typeof P2_S2C_COLLISION_POLICIES[number];
export type P2S2CCollisionPolicyReason =
  typeof P2_S2C_COLLISION_POLICY_REASONS[number];

export type P2S2CCollisionPolicyRecord = Readonly<{
  fragmentId: string;
  evidenceClass: P2S2CBoundaryEvidenceClass;
  collisionPolicy: P2S2CCollisionPolicy;
  policyReasons: readonly P2S2CCollisionPolicyReason[];
}>;

type CollisionPolicyFragment = Pick<
  EmptyRegionBoundaryFragment,
  "id" | "boundaryState" | "touchesImageFrame" | "verification"
>;

function record(
  fragmentId: string,
  evidenceClass: P2S2CBoundaryEvidenceClass,
  collisionPolicy: P2S2CCollisionPolicy,
  ...policyReasons: P2S2CCollisionPolicyReason[]
): P2S2CCollisionPolicyRecord {
  return Object.freeze({
    fragmentId,
    evidenceClass,
    collisionPolicy,
    policyReasons: Object.freeze(policyReasons),
  });
}

/**
 * Pure EMPTY-image-space semantics overlay. The source P2-S2A fragment remains
 * the sole geometry, endpoint, classification, and verification authority.
 */
export function classifyP2S2CCollisionPolicy(
  fragment: CollisionPolicyFragment
): P2S2CCollisionPolicyRecord {
  if (
    fragment.boundaryState === "frame_truncated" ||
    fragment.touchesImageFrame
  ) {
    return record(
      fragment.id,
      "frame_truncated",
      "pass",
      "image_frame_contact"
    );
  }

  if (fragment.boundaryState === "physical_wall") {
    return record(
      fragment.id,
      "verified_wall_contact",
      "block",
      "source_physical_wall"
    );
  }

  const reasons: P2S2CCollisionPolicyReason[] = [];
  const { verification } = fragment;
  if (
    verification.sourcePixelLength <
      P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS.minimumSourcePixelLength
  ) {
    reasons.push("insufficient_finite_support");
  }
  if (
    verification.insideRegionSupportFraction === null ||
    verification.insideRegionSupportFraction <
      P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS
        .minimumInsideRegionSupportFraction ||
    verification.outsideRegionExclusionFraction === null ||
    verification.outsideRegionExclusionFraction <
      P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS
        .minimumOutsideRegionExclusionFraction
  ) {
    reasons.push("insufficient_region_side_support");
  }
  if (
    verification.outsideFloorLikeFraction === null ||
    verification.outsideFloorLikeFraction >
      P2_S2C_BOUNDARY_COLLISION_POLICY_PARAMETERS
        .maximumOutsideFloorLikeFraction
  ) {
    reasons.push("outside_still_floor_like");
  }

  return reasons.length === 0
    ? record(
        fragment.id,
        "observed_floor_termination",
        "block",
        "observed_floor_termination"
      )
    : record(fragment.id, "unresolved", "pass", ...reasons);
}

export function classifyP2S2CCollisionPolicies(
  fragments: readonly CollisionPolicyFragment[]
): readonly P2S2CCollisionPolicyRecord[] {
  return Object.freeze(fragments.map(classifyP2S2CCollisionPolicy));
}
