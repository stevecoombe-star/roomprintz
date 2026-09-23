import type { EmptyRegionBoundaryFragment } from "./empty-region-boundary-fragments";
import type {
  VisibleFloorContactDiagnostics,
  VisibleFloorTerminationFragment,
} from "./empty-visible-floor-contact-localizer";

export const P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS = [
  "room-a",
  "room-b",
  "room-c",
  "room-d",
  "room-e",
] as const;

export type P2S2DFloorContactReviewRoomId =
  typeof P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS[number];

export type P2S2DFloorContactReviewRecord = Readonly<{
  roomId: P2S2DFloorContactReviewRoomId;
  oldSourceAuthority: "certified_p2_s2a_current" | "frozen_p2_s2b_receipt";
  emptyImageSha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
  oldReceiptSha256: string | null;
  oldFragments: readonly EmptyRegionBoundaryFragment[];
  newFragments: readonly VisibleFloorTerminationFragment[];
  diagnostics: VisibleFloorContactDiagnostics;
}>;

export const P2_S2D_ROOM_C_REVIEW_NEIGHBORHOODS = Object.freeze([
  Object.freeze({
    id: "0000–0002",
    label: "left-side recovery",
    oldFragmentSuffixes: Object.freeze(["0000", "0001", "0002"]),
  }),
  Object.freeze({
    id: "0007–0010",
    label: "radiator",
    oldFragmentSuffixes: Object.freeze(["0007", "0008", "0009", "0010"]),
  }),
  Object.freeze({
    id: "0012–0018",
    label: "wall climb / corner reveal",
    oldFragmentSuffixes: Object.freeze([
      "0012", "0013", "0014", "0015", "0016", "0017", "0018",
    ]),
  }),
  Object.freeze({
    id: "0021–0023",
    label: "preserve",
    oldFragmentSuffixes: Object.freeze(["0021", "0022", "0023"]),
  }),
  Object.freeze({
    id: "0031–0041",
    label: "interior-floor rim",
    oldFragmentSuffixes: Object.freeze([
      "0031", "0032", "0033", "0034", "0035", "0036",
      "0037", "0038", "0039", "0040", "0041",
    ]),
  }),
  Object.freeze({
    id: "0043",
    label: "bottom-frame chord",
    oldFragmentSuffixes: Object.freeze(["0043"]),
  }),
]);

export function isP2S2DFloorContactReviewRoomId(
  value: unknown
): value is P2S2DFloorContactReviewRoomId {
  return typeof value === "string" &&
    P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS.includes(
      value as P2S2DFloorContactReviewRoomId
    );
}

export function p2S2DFloorContactShortId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

export function p2S2DFloorContactPolyline(
  fragment: Pick<
    EmptyRegionBoundaryFragment | VisibleFloorTerminationFragment,
    "pointsSourceNormalized"
  >,
  dimensions: Readonly<{ width: number; height: number }>
): readonly Readonly<{ x: number; y: number }>[] {
  return Object.freeze(fragment.pointsSourceNormalized.map(point =>
    Object.freeze({
      x: point.x * dimensions.width,
      y: point.y * dimensions.height,
    })
  ));
}

export function p2S2DFloorContactPointerToSourcePixel(
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
