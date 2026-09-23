import type { PerspectiveCamera } from "three";

import {
  projectEmptyFloorPointToWorldXZ,
  type EmptyToWorldXZProjectionResult,
  type WorldXZ,
} from "../empty-to-world-xz-projection";
import type {
  ImageFrameSize,
  ImageIntrinsicSize,
} from "../image-space";
import type { AfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import {
  P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
  type VisibleFloorTerminationCollisionPolicyRecord,
} from "./empty-visible-floor-termination-collision-policy";
import {
  VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE,
  VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION,
  type VisibleFloorTerminationFragment,
} from "./empty-visible-floor-contact-localizer";

export const P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION =
  "p2-s2f-visible-floor-blocker-world-projection/v1" as const;
export const P2_S2F_WORLD_COORDINATE_SPACE =
  "calibrated-world-xz/v1" as const;
export const P2_S2F_WORLD_GEOMETRY_KIND =
  "finite_open_blocking_polyline" as const;

/**
 * One nanometre in calibrated world units. This only rejects numerical
 * first/last collapse; it is never used to tune, snap, or join geometry.
 */
export const P2_S2F_ACCIDENTAL_CLOSURE_TOLERANCE_METERS = 1e-9;

export type P2S2FProjectionPolicyRecord = Readonly<{
  fragmentId: VisibleFloorTerminationCollisionPolicyRecord["fragmentId"];
  collisionPolicy:
    | VisibleFloorTerminationCollisionPolicyRecord["collisionPolicy"]
    | "pass";
}>;

export type P2S2FWorldProjectionInput = Readonly<{
  fragments: readonly VisibleFloorTerminationFragment[];
  policies: readonly P2S2FProjectionPolicyRecord[];
  emptyIntrinsicSize: ImageIntrinsicSize;
  originalIntrinsicSize: ImageIntrinsicSize;
  compatibility: AfcR3cImagePairCompatibility;
  containerSize: ImageFrameSize;
  calibratedCamera: PerspectiveCamera;
}>;

export type ProjectedVisibleFloorBlocker = Readonly<{
  sourceFragmentId: string;
  sourceGeometryVersion: typeof VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION;
  sourcePolicyVersion: typeof P2_S2E_TERMINATION_COLLISION_POLICY_VERSION;
  projectionVersion: typeof P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION;
  coordinateSpace: typeof P2_S2F_WORLD_COORDINATE_SPACE;
  geometryKind: typeof P2_S2F_WORLD_GEOMETRY_KIND;
  pointsWorldXZ: readonly WorldXZ[];
  startEndpoint: Readonly<{ state: "uncertain_support_limit" }>;
  endEndpoint: Readonly<{ state: "uncertain_support_limit" }>;
}>;

type ProjectionFailureReason =
  Extract<EmptyToWorldXZProjectionResult, { ok: false }>["reason"];

export type P2S2FFragmentProjectionFailure = Readonly<{
  sourceFragmentId: string;
  reason:
    | ProjectionFailureReason
    | "empty_polyline"
    | "accidental_closure";
  failedPointIndex: number | null;
}>;

export type P2S2FInputFailureReason =
  | "duplicate_fragment_id"
  | "duplicate_policy_id"
  | "missing_policy"
  | "unknown_policy_id"
  | "inconsistent_provenance";

export type P2S2FWorldProjectionResult =
  | Readonly<{
      ok: true;
      blockers: readonly ProjectedVisibleFloorBlocker[];
      failures: readonly P2S2FFragmentProjectionFailure[];
    }>
  | Readonly<{
      ok: false;
      reason: P2S2FInputFailureReason;
      sourceFragmentId: string | null;
      detail: string;
    }>;

function exactPoint(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>
): boolean {
  return left.x === right.x && left.y === right.y;
}

function validateFragmentProvenance(
  fragments: readonly VisibleFloorTerminationFragment[]
): Extract<P2S2FWorldProjectionResult, { ok: false }> | null {
  if (fragments.length === 0) return null;
  const roomId = fragments[0].roomId;
  const emptyImageSha256 = fragments[0].emptyImageSha256;

  for (const fragment of fragments) {
    const first = fragment.pointsSourceNormalized[0];
    const last = fragment.pointsSourceNormalized.at(-1);
    if (
      fragment.roomId !== roomId ||
      fragment.emptyImageSha256 !== emptyImageSha256 ||
      fragment.coordinateSpace !== VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE ||
      fragment.proposalVersion !== VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION ||
      fragment.geometryKind !== "finite_open_visible_floor_termination" ||
      fragment.startEndpoint.state !== "uncertain_support_limit" ||
      fragment.endEndpoint.state !== "uncertain_support_limit" ||
      (first && !exactPoint(first, fragment.startEndpoint.pointSourceNormalized)) ||
      (last && !exactPoint(last, fragment.endEndpoint.pointSourceNormalized))
    ) {
      return {
        ok: false,
        reason: "inconsistent_provenance",
        sourceFragmentId: fragment.id,
        detail:
          "Every fragment must retain one P2-S2D room/image/version/endpoint provenance.",
      };
    }
  }
  return null;
}

function duplicateId(values: readonly string[]): string | null {
  const observed = new Set<string>();
  for (const value of values) {
    if (observed.has(value)) return value;
    observed.add(value);
  }
  return null;
}

function validateJoin(
  input: P2S2FWorldProjectionInput
): Extract<P2S2FWorldProjectionResult, { ok: false }> | null {
  const duplicateFragmentId = duplicateId(input.fragments.map(fragment => fragment.id));
  if (duplicateFragmentId) {
    return {
      ok: false,
      reason: "duplicate_fragment_id",
      sourceFragmentId: duplicateFragmentId,
      detail: `Duplicate source fragment ID: ${duplicateFragmentId}`,
    };
  }

  const duplicatePolicyId = duplicateId(input.policies.map(policy => policy.fragmentId));
  if (duplicatePolicyId) {
    return {
      ok: false,
      reason: "duplicate_policy_id",
      sourceFragmentId: duplicatePolicyId,
      detail: `Duplicate policy fragment ID: ${duplicatePolicyId}`,
    };
  }

  const fragmentIds = new Set(input.fragments.map(fragment => fragment.id));
  const unknownPolicy = input.policies.find(policy => !fragmentIds.has(policy.fragmentId));
  if (unknownPolicy) {
    return {
      ok: false,
      reason: "unknown_policy_id",
      sourceFragmentId: unknownPolicy.fragmentId,
      detail: `Policy references unknown fragment ID: ${unknownPolicy.fragmentId}`,
    };
  }

  const policyIds = new Set(input.policies.map(policy => policy.fragmentId));
  const missingPolicy = input.fragments.find(fragment => !policyIds.has(fragment.id));
  if (missingPolicy) {
    return {
      ok: false,
      reason: "missing_policy",
      sourceFragmentId: missingPolicy.id,
      detail: `Source fragment has no policy: ${missingPolicy.id}`,
    };
  }

  return validateFragmentProvenance(input.fragments);
}

function isAccidentallyClosed(points: readonly WorldXZ[]): boolean {
  if (points.length === 0) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.z - last.z) <=
    P2_S2F_ACCIDENTAL_CLOSURE_TOLERANCE_METERS;
}

/**
 * Changes only coordinate space. Each block-policy P2-S2D fragment is
 * projected point-for-point through the certified P2-S0 primitive.
 */
export function projectVisibleFloorBlockersToWorldXZ(
  input: P2S2FWorldProjectionInput
): P2S2FWorldProjectionResult {
  const invalid = validateJoin(input);
  if (invalid) return invalid;

  const policyByFragmentId = new Map(
    input.policies.map(policy => [policy.fragmentId, policy] as const)
  );
  const blockers: ProjectedVisibleFloorBlocker[] = [];
  const failures: P2S2FFragmentProjectionFailure[] = [];

  for (const fragment of input.fragments) {
    const policy = policyByFragmentId.get(fragment.id);
    // Join validation guarantees this lookup. A pass policy intentionally
    // remains an unprojected world-space gap.
    if (!policy || policy.collisionPolicy !== "block") continue;

    if (fragment.pointsSourceNormalized.length === 0) {
      failures.push(Object.freeze({
        sourceFragmentId: fragment.id,
        reason: "empty_polyline",
        failedPointIndex: null,
      }));
      continue;
    }

    const pointsWorldXZ: WorldXZ[] = [];
    let pointFailure: P2S2FFragmentProjectionFailure | null = null;
    for (
      let pointIndex = 0;
      pointIndex < fragment.pointsSourceNormalized.length;
      pointIndex += 1
    ) {
      const projected = projectEmptyFloorPointToWorldXZ({
        emptySourceNormalized: fragment.pointsSourceNormalized[pointIndex],
        emptyIntrinsicSize: input.emptyIntrinsicSize,
        originalIntrinsicSize: input.originalIntrinsicSize,
        compatibility: input.compatibility,
        containerSize: input.containerSize,
        calibratedCamera: input.calibratedCamera,
      });
      if (!projected.ok) {
        pointFailure = Object.freeze({
          sourceFragmentId: fragment.id,
          reason: projected.reason,
          failedPointIndex: pointIndex,
        });
        break;
      }
      pointsWorldXZ.push(Object.freeze({
        x: projected.worldXZ.x,
        z: projected.worldXZ.z,
      }));
    }

    if (pointFailure) {
      failures.push(pointFailure);
      continue;
    }
    if (isAccidentallyClosed(pointsWorldXZ)) {
      failures.push(Object.freeze({
        sourceFragmentId: fragment.id,
        reason: "accidental_closure",
        failedPointIndex: null,
      }));
      continue;
    }

    blockers.push(Object.freeze({
      sourceFragmentId: fragment.id,
      sourceGeometryVersion: VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION,
      sourcePolicyVersion: P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
      projectionVersion: P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION,
      coordinateSpace: P2_S2F_WORLD_COORDINATE_SPACE,
      geometryKind: P2_S2F_WORLD_GEOMETRY_KIND,
      pointsWorldXZ: Object.freeze(pointsWorldXZ),
      startEndpoint: Object.freeze({ state: "uncertain_support_limit" as const }),
      endEndpoint: Object.freeze({ state: "uncertain_support_limit" as const }),
    }));
  }

  return Object.freeze({
    ok: true,
    blockers: Object.freeze(blockers),
    failures: Object.freeze(failures),
  });
}
