import type {
  P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
  VisibleFloorTerminationCollisionPolicyRecord,
} from "./empty-visible-floor-termination-collision-policy";
import type {
  VisibleFloorContactDiagnostics,
  VisibleFloorTerminationFragment,
} from "./empty-visible-floor-contact-localizer";

export const P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS = [
  "room-a",
  "room-b",
  "room-c",
  "room-d",
  "room-e",
] as const;

export type P2S2ETerminationCollisionReviewRoomId =
  typeof P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS[number];

export type P2S2ETerminationCollisionReviewRecord = Readonly<{
  roomId: P2S2ETerminationCollisionReviewRoomId;
  geometryAuthority: "certified_p2_s2d_current";
  policyVersion: typeof P2_S2E_TERMINATION_COLLISION_POLICY_VERSION;
  emptyImageSha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
  fragments: readonly VisibleFloorTerminationFragment[];
  policies: readonly VisibleFloorTerminationCollisionPolicyRecord[];
  diagnostics: VisibleFloorContactDiagnostics;
}>;

export function isP2S2ETerminationCollisionReviewRoomId(
  value: unknown
): value is P2S2ETerminationCollisionReviewRoomId {
  return typeof value === "string" &&
    P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS.includes(
      value as P2S2ETerminationCollisionReviewRoomId
    );
}

export function p2S2ETerminationCollisionShortId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

export function p2S2ETerminationCollisionPolyline(
  fragment: Pick<VisibleFloorTerminationFragment, "pointsSourceNormalized">,
  dimensions: Readonly<{ width: number; height: number }>
): readonly Readonly<{ x: number; y: number }>[] {
  return Object.freeze(fragment.pointsSourceNormalized.map(point =>
    Object.freeze({
      x: point.x * dimensions.width,
      y: point.y * dimensions.height,
    })
  ));
}

export function p2S2ETerminationCollisionPointerToSourcePixel(
  point: Readonly<{ x: number; y: number }>,
  rendered: Readonly<{ width: number; height: number }>,
  source: Readonly<{ width: number; height: number }>
): Readonly<{ x: number; y: number }> {
  if (rendered.width <= 0 || rendered.height <= 0) {
    throw new TypeError("rendered dimensions must be positive");
  }
  return Object.freeze({
    x: Math.min(
      source.width - 1,
      Math.max(0, Math.floor(point.x / rendered.width * source.width))
    ),
    y: Math.min(
      source.height - 1,
      Math.max(0, Math.floor(point.y / rendered.height * source.height))
    ),
  });
}
