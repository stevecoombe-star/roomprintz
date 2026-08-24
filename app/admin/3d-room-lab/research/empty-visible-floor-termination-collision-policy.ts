import type { VisibleFloorTerminationFragment } from "./empty-visible-floor-contact-localizer";

export const P2_S2E_TERMINATION_COLLISION_POLICY_VERSION =
  "p2-s2e-visible-floor-termination-collision-policy/v1" as const;

export type P2S2ETerminationCollisionPolicyInput = Pick<
  VisibleFloorTerminationFragment,
  "id"
>;

export type VisibleFloorTerminationCollisionPolicyRecord = Readonly<{
  fragmentId: string;
  evidenceClass: "observed_floor_termination";
  collisionPolicy: "block";
  policyReasons: readonly ["observed_floor_termination"];
}>;

const OBSERVED_TERMINATION_REASON = Object.freeze([
  "observed_floor_termination",
]) as readonly ["observed_floor_termination"];

/**
 * P2-S2D decides whether finite image-space geometry exists. P2-S2E adds only
 * the v1 collision-policy record for that existing fragment.
 */
export function classifyP2S2ETerminationCollisionPolicy(
  fragment: P2S2ETerminationCollisionPolicyInput
): VisibleFloorTerminationCollisionPolicyRecord {
  return Object.freeze({
    fragmentId: fragment.id,
    evidenceClass: "observed_floor_termination" as const,
    collisionPolicy: "block" as const,
    policyReasons: OBSERVED_TERMINATION_REASON,
  });
}

export function classifyP2S2ETerminationCollisionPolicies(
  fragments: readonly P2S2ETerminationCollisionPolicyInput[]
): readonly VisibleFloorTerminationCollisionPolicyRecord[] {
  return Object.freeze(
    fragments.map(classifyP2S2ETerminationCollisionPolicy)
  );
}
