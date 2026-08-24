import type {
  EmptyRegionBoundaryFragment,
} from "./empty-region-boundary-fragments";
import type {
  P2S2CCollisionPolicyRecord,
} from "./empty-boundary-collision-policy";

export const P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS = [
  "room-a",
  "room-b",
  "room-c",
  "room-d",
  "room-e",
] as const;

export type P2S2CCollisionOverlayReviewRoomId =
  typeof P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS[number];

export type P2S2CCollisionOverlayReviewRecord = Readonly<{
  roomId: P2S2CCollisionOverlayReviewRoomId;
  sourceAuthority: "certified_p2_s2a_current" | "frozen_p2_s2b_receipt";
  emptyImageSha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
  receiptSha256: string | null;
  fragments: readonly EmptyRegionBoundaryFragment[];
  policies: readonly P2S2CCollisionPolicyRecord[];
}>;

export const P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS = Object.freeze({
  "room-a": Object.freeze([]),
  "room-b": Object.freeze(["0012", "0013", "0014", "0015", "0024"]),
  "room-c": Object.freeze(["0007", "0008", "0009", "0010"]),
  "room-d": Object.freeze(["0001", "0006", "0007", "0008", "0009"]),
  "room-e": Object.freeze([]),
} satisfies Readonly<
  Record<P2S2CCollisionOverlayReviewRoomId, readonly string[]>
>);

export function isP2S2CCollisionOverlayReviewRoomId(
  value: unknown
): value is P2S2CCollisionOverlayReviewRoomId {
  return typeof value === "string" &&
    P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS.includes(
      value as P2S2CCollisionOverlayReviewRoomId
    );
}

export function p2S2CCollisionOverlayShortFragmentId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

export function p2S2CCollisionOverlayPolicyForFragment(
  record: Pick<P2S2CCollisionOverlayReviewRecord, "policies">,
  fragmentId: string
): P2S2CCollisionPolicyRecord {
  const policy = record.policies.find(item => item.fragmentId === fragmentId);
  if (!policy) throw new Error(`Missing P2-S2C policy for ${fragmentId}`);
  return policy;
}

export function p2S2CCollisionOverlayFragmentPolyline(
  fragment: Pick<EmptyRegionBoundaryFragment, "pointsSourceNormalized">,
  dimensions: Readonly<{ width: number; height: number }>
): readonly Readonly<{ x: number; y: number }>[] {
  return Object.freeze(fragment.pointsSourceNormalized.map(point =>
    Object.freeze({
      x: point.x * dimensions.width,
      y: point.y * dimensions.height,
    })
  ));
}
