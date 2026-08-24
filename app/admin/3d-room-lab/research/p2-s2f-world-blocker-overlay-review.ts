import type {
  P2S2FFragmentProjectionFailure,
  P2S2FWorldProjectionResult,
  ProjectedVisibleFloorBlocker,
} from "./empty-visible-floor-blocker-world-projection";
import type { VisibleFloorTerminationCollisionPolicyRecord } from "./empty-visible-floor-termination-collision-policy";
import type { VisibleFloorTerminationFragment } from "./empty-visible-floor-contact-localizer";

export const P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS = [
  "room-a",
  "room-b",
  "room-c",
  "room-d",
  "room-e",
] as const;

export type P2S2FWorldBlockerReviewRoomId =
  typeof P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS[number];

export type P2S2FReviewCameraProvenance =
  | "accepted_live_or_frozen_calibrated_camera"
  | "reconstituted_accepted_snapshot"
  | "unavailable";

export type P2S2FFragmentReviewDiagnostic = Readonly<{
  sourceFragmentId: string;
  sourcePointCount: number;
  worldPointCount: number;
  projectedLengthMeters: number | null;
  minimumConsecutiveSpacingMeters: number | null;
  maximumConsecutiveSpacingMeters: number | null;
  projectionStatus: "projected" | "failed" | "policy_pass" | "unavailable";
  failureReason: P2S2FFragmentProjectionFailure["reason"] | null;
  failedPointIndex: number | null;
}>;

export type P2S2FWorldBlockerReviewProjection =
  | Readonly<{
      status: "available";
      cameraProvenance: Exclude<P2S2FReviewCameraProvenance, "unavailable">;
      cameraAppliedAtIso: string;
      blockers: readonly ProjectedVisibleFloorBlocker[];
      failures: readonly P2S2FFragmentProjectionFailure[];
    }>
  | Readonly<{
      status: "unavailable";
      cameraProvenance: "unavailable";
      reason:
        | "accepted_camera_snapshot_not_configured"
        | "accepted_camera_snapshot_unavailable"
        | "accepted_camera_snapshot_invalid"
        | "accepted_camera_original_basis_mismatch";
    }>;

export type P2S2FWorldBlockerReviewRecord = Readonly<{
  roomId: P2S2FWorldBlockerReviewRoomId;
  emptyImageSha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
  fragments: readonly VisibleFloorTerminationFragment[];
  policies: readonly VisibleFloorTerminationCollisionPolicyRecord[];
  projection: P2S2FWorldBlockerReviewProjection;
  diagnostics: readonly P2S2FFragmentReviewDiagnostic[];
}>;

export function isP2S2FWorldBlockerReviewRoomId(
  value: unknown
): value is P2S2FWorldBlockerReviewRoomId {
  return typeof value === "string" &&
    P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS.includes(
      value as P2S2FWorldBlockerReviewRoomId
    );
}

export function p2S2FShortFragmentId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

export function p2S2FImagePolyline(
  fragment: Pick<VisibleFloorTerminationFragment, "pointsSourceNormalized">,
  dimensions: Readonly<{ width: number; height: number }>
): readonly Readonly<{ x: number; y: number }>[] {
  return fragment.pointsSourceNormalized.map(point => Object.freeze({
    x: point.x * dimensions.width,
    y: point.y * dimensions.height,
  }));
}

function spacing(blocker: ProjectedVisibleFloorBlocker): readonly number[] {
  const values: number[] = [];
  for (let index = 1; index < blocker.pointsWorldXZ.length; index += 1) {
    const start = blocker.pointsWorldXZ[index - 1];
    const end = blocker.pointsWorldXZ[index];
    values.push(Math.hypot(end.x - start.x, end.z - start.z));
  }
  return values;
}

export function buildP2S2FFragmentReviewDiagnostics(
  fragments: readonly Pick<
    VisibleFloorTerminationFragment,
    "id" | "pointsSourceNormalized"
  >[],
  policies: readonly Readonly<{
    fragmentId: string;
    collisionPolicy: "block" | "pass";
  }>[],
  projection: P2S2FWorldProjectionResult | null
): readonly P2S2FFragmentReviewDiagnostic[] {
  const policyById = new Map(
    policies.map(policy => [policy.fragmentId, policy] as const)
  );
  const blockerById = new Map(
    projection?.ok
      ? projection.blockers.map(blocker => [blocker.sourceFragmentId, blocker] as const)
      : []
  );
  const failureById = new Map(
    projection?.ok
      ? projection.failures.map(failure => [failure.sourceFragmentId, failure] as const)
      : []
  );

  return Object.freeze(fragments.map(fragment => {
    const policy = policyById.get(fragment.id);
    const blocker = blockerById.get(fragment.id);
    const failure = failureById.get(fragment.id);
    const consecutiveSpacing = blocker ? spacing(blocker) : [];
    const length = consecutiveSpacing.reduce((sum, value) => sum + value, 0);
    const projectionStatus = !projection
      ? "unavailable"
      : policy?.collisionPolicy === "pass"
        ? "policy_pass"
        : blocker
          ? "projected"
          : "failed";

    return Object.freeze({
      sourceFragmentId: fragment.id,
      sourcePointCount: fragment.pointsSourceNormalized.length,
      worldPointCount: blocker?.pointsWorldXZ.length ?? 0,
      projectedLengthMeters: blocker ? length : null,
      minimumConsecutiveSpacingMeters:
        consecutiveSpacing.length > 0 ? Math.min(...consecutiveSpacing) : null,
      maximumConsecutiveSpacingMeters:
        consecutiveSpacing.length > 0 ? Math.max(...consecutiveSpacing) : null,
      projectionStatus,
      failureReason: failure?.reason ?? null,
      failedPointIndex: failure?.failedPointIndex ?? null,
    });
  }));
}

export type P2S2FWorldPlotViewBox = Readonly<{
  minX: number;
  minZ: number;
  extent: number;
}>;

export function p2S2FWorldPlotViewBox(
  blockers: readonly ProjectedVisibleFloorBlocker[],
  paddingFraction = 0.08
): P2S2FWorldPlotViewBox {
  const points = blockers.flatMap(blocker => blocker.pointsWorldXZ);
  if (points.length === 0) return { minX: -1, minZ: -1, extent: 2 };
  const xs = points.map(point => point.x);
  const zs = points.map(point => point.z);
  const rawExtent = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs)
  );
  const extent = Math.max(rawExtent, 1e-6) * (1 + paddingFraction * 2);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  return Object.freeze({
    minX: centerX - extent / 2,
    minZ: centerZ - extent / 2,
    extent,
  });
}
