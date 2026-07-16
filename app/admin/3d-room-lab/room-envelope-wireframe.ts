import type {
  RoomEnvelopeFaceId,
  RoomEnvelopeGeometryInput,
  RoomEnvelopeReconciliationResult,
  RoomEnvelopeSupportGeometry,
  RoomEnvelopeSupportKind,
} from "./room-envelope-types";
import type { SupportVec3 } from "./support-plane-math";

export type RoomEnvelopeWireframeSegmentKind =
  | "reconciled_support_patch"
  | "room_frame"
  | "visible_extent"
  | "assumed_foreground_cap";

export type RoomEnvelopeWireframeSegment = Readonly<{
  id: string;
  startWorld: Readonly<SupportVec3>;
  endWorld: Readonly<SupportVec3>;
  kind: RoomEnvelopeWireframeSegmentKind;
  supportKind?: RoomEnvelopeSupportKind;
  faceId?: RoomEnvelopeFaceId;
}>;

export type RoomEnvelopeWireframe = Readonly<{
  status: RoomEnvelopeReconciliationResult["status"];
  segments: readonly RoomEnvelopeWireframeSegment[];
}>;

type CanonicalPoint = { x: number; y: number; z: number };

const EPSILON = 1e-9;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePoint(point: SupportVec3 | null | undefined): point is SupportVec3 {
  return !!point && finite(point.x) && finite(point.y) && finite(point.z);
}

function subtract(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: SupportVec3, b: SupportVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function samePoint(a: SupportVec3, b: SupportVec3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= EPSILON;
}

function pointKey(point: SupportVec3): string {
  return [point.x, point.y, point.z].map((value) => value.toFixed(9)).join(",");
}

function segmentKey(startWorld: SupportVec3, endWorld: SupportVec3): string {
  const [first, second] = [pointKey(startWorld), pointKey(endWorld)].sort();
  return `${first}|${second}`;
}

function supportFaceId(kind: RoomEnvelopeSupportKind): RoomEnvelopeFaceId {
  if (kind === "floor" || kind === "ceiling") return kind;
  return kind === "wall_back" ? "back" : kind === "wall_left" ? "left" : "right";
}

function supportBoundary(support: RoomEnvelopeSupportGeometry): readonly SupportVec3[] {
  return support.boundaryWorld;
}

function kindRank(kind: RoomEnvelopeWireframeSegmentKind): number {
  switch (kind) {
    case "room_frame":
      return 0;
    case "assumed_foreground_cap":
      return 1;
    case "visible_extent":
      return 2;
    case "reconciled_support_patch":
      return 3;
  }
}

/**
 * Produces display-only world segments from the pure reconciliation candidate.
 * Finite reviewed patches retain support provenance; finite forward rails are
 * explicitly presentation extents rather than an inferred foreground wall.
 */
export function deriveRoomEnvelopeWireframe(input: {
  reconciliation: RoomEnvelopeReconciliationResult;
  geometry: RoomEnvelopeGeometryInput;
}): RoomEnvelopeWireframe {
  const { reconciliation, geometry } = input;
  const frame = reconciliation.frame;
  if (!frame || reconciliation.status === "unavailable") {
    return Object.freeze({ status: reconciliation.status, segments: Object.freeze([]) });
  }

  const toCanonical = (point: SupportVec3): CanonicalPoint => {
    const relative = subtract(point, frame.originWorld);
    return {
      x: dot(relative, frame.xAxisWorld),
      y: dot(relative, frame.yAxisWorld),
      z: dot(relative, frame.zAxisWorld),
    };
  };
  const toWorld = (point: CanonicalPoint): SupportVec3 => ({
    x: frame.originWorld.x + frame.xAxisWorld.x * point.x + frame.yAxisWorld.x * point.y + frame.zAxisWorld.x * point.z,
    y: frame.originWorld.y + frame.xAxisWorld.y * point.x + frame.yAxisWorld.y * point.y + frame.zAxisWorld.y * point.z,
    z: frame.originWorld.z + frame.xAxisWorld.z * point.x + frame.yAxisWorld.z * point.y + frame.zAxisWorld.z * point.z,
  });
  const projectToFace = (point: SupportVec3, faceId: RoomEnvelopeFaceId): SupportVec3 | null => {
    const face = reconciliation.faces[faceId];
    if (!face.present || !finite(face.offset) || !finitePoint(point)) return null;
    const canonical = toCanonical(point);
    if (!finite(canonical.x) || !finite(canonical.y) || !finite(canonical.z)) return null;
    if (faceId === "floor" || faceId === "ceiling") canonical.y = face.offset;
    if (faceId === "left" || faceId === "right") canonical.x = face.offset;
    if (faceId === "back" || faceId === "front") canonical.z = face.offset;
    const projected = toWorld(canonical);
    return finitePoint(projected) ? projected : null;
  };

  const candidates: RoomEnvelopeWireframeSegment[] = [];
  const addSegment = (
    id: string,
    startWorld: SupportVec3 | null,
    endWorld: SupportVec3 | null,
    kind: RoomEnvelopeWireframeSegmentKind,
    metadata: Pick<RoomEnvelopeWireframeSegment, "supportKind" | "faceId"> = {}
  ) => {
    if (!finitePoint(startWorld) || !finitePoint(endWorld) || samePoint(startWorld, endWorld)) return;
    candidates.push({
      id,
      startWorld: { ...startWorld },
      endWorld: { ...endWorld },
      kind,
      ...metadata,
    });
  };

  for (const kind of ["floor", "wall_back", "wall_left", "wall_right", "ceiling"] as const) {
    if (!geometry.included[kind]) continue;
    const support = geometry.supports[kind];
    if (!support || support.kind !== kind) continue;
    const faceId = supportFaceId(kind);
    const face = reconciliation.faces[faceId];
    if (!face.present || face.source !== "support" || face.supportKind !== kind) continue;
    const patch = supportBoundary(support)
      .map((point) => projectToFace(point, faceId))
      .filter((point): point is SupportVec3 => point !== null);
    if (patch.length < 3) continue;
    for (let index = 0; index < patch.length; index += 1) {
      addSegment(
        `patch:${kind}:${index}`,
        patch[index],
        patch[(index + 1) % patch.length],
        "reconciled_support_patch",
        { supportKind: kind, faceId }
      );
    }
  }

  const floor = reconciliation.faces.floor;
  const back = reconciliation.faces.back;
  const left = reconciliation.faces.left;
  const right = reconciliation.faces.right;
  const ceiling = reconciliation.faces.ceiling;
  const hasOpenFrame = floor.present && back.present && left.present && right.present &&
    [back.offset, left.offset, right.offset].every(finite);
  const visibleDepth = reconciliation.dimensions.visibleReviewedDepth;
  const visibleEndZ = hasOpenFrame && visibleDepth.present && finite(visibleDepth.value)
    ? back.offset + visibleDepth.value
    : null;

  if (hasOpenFrame) {
    const bottomLeftBack = toWorld({ x: left.offset, y: floor.offset, z: back.offset });
    const bottomRightBack = toWorld({ x: right.offset, y: floor.offset, z: back.offset });
    addSegment("frame:back:floor", bottomLeftBack, bottomRightBack, "room_frame", { faceId: "back" });

    if (visibleEndZ !== null && visibleEndZ > back.offset + EPSILON) {
      addSegment(
        "extent:floor:left-rail",
        bottomLeftBack,
        toWorld({ x: left.offset, y: floor.offset, z: visibleEndZ }),
        "visible_extent",
        { faceId: "left" }
      );
      addSegment(
        "extent:floor:right-rail",
        bottomRightBack,
        toWorld({ x: right.offset, y: floor.offset, z: visibleEndZ }),
        "visible_extent",
        { faceId: "right" }
      );
    }

    if (ceiling.present && finite(ceiling.offset) && ceiling.offset > floor.offset + EPSILON) {
      const topLeftBack = toWorld({ x: left.offset, y: ceiling.offset, z: back.offset });
      const topRightBack = toWorld({ x: right.offset, y: ceiling.offset, z: back.offset });
      addSegment("frame:back:top", topLeftBack, topRightBack, "room_frame", { faceId: "back" });
      addSegment("frame:back:left-vertical", bottomLeftBack, topLeftBack, "room_frame", { faceId: "back" });
      addSegment("frame:back:right-vertical", bottomRightBack, topRightBack, "room_frame", { faceId: "back" });
      if (visibleEndZ !== null && visibleEndZ > back.offset + EPSILON) {
        addSegment(
          "extent:ceiling:left-rail",
          topLeftBack,
          toWorld({ x: left.offset, y: ceiling.offset, z: visibleEndZ }),
          "visible_extent",
          { faceId: "left" }
        );
        addSegment(
          "extent:ceiling:right-rail",
          topRightBack,
          toWorld({ x: right.offset, y: ceiling.offset, z: visibleEndZ }),
          "visible_extent",
          { faceId: "right" }
        );
      }
    }
  }

  const front = reconciliation.faces.front;
  if (
    front.present &&
    front.source === "operator_assumption" &&
    floor.present &&
    left.present &&
    right.present &&
    [front.offset, floor.offset, left.offset, right.offset].every(finite)
  ) {
    const bottomLeftFront = toWorld({ x: left.offset, y: floor.offset, z: front.offset });
    const bottomRightFront = toWorld({ x: right.offset, y: floor.offset, z: front.offset });
    addSegment("cap:front:floor", bottomLeftFront, bottomRightFront, "assumed_foreground_cap", { faceId: "front" });
    if (ceiling.present && finite(ceiling.offset) && ceiling.offset > floor.offset + EPSILON) {
      const topLeftFront = toWorld({ x: left.offset, y: ceiling.offset, z: front.offset });
      const topRightFront = toWorld({ x: right.offset, y: ceiling.offset, z: front.offset });
      addSegment("cap:front:top", topLeftFront, topRightFront, "assumed_foreground_cap", { faceId: "front" });
      addSegment("cap:front:left-vertical", bottomLeftFront, topLeftFront, "assumed_foreground_cap", { faceId: "front" });
      addSegment("cap:front:right-vertical", bottomRightFront, topRightFront, "assumed_foreground_cap", { faceId: "front" });
    }
  }

  const retained = new Map<string, RoomEnvelopeWireframeSegment>();
  const ranked = [...candidates].sort((a, b) => {
    const rankDifference = kindRank(a.kind) - kindRank(b.kind);
    return rankDifference !== 0 ? rankDifference : a.id.localeCompare(b.id);
  });
  for (const segment of ranked) {
    const key = segmentKey(segment.startWorld, segment.endWorld);
    if (!retained.has(key)) retained.set(key, segment);
  }
  const segments = [...retained.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((segment) =>
      Object.freeze({
        ...segment,
        startWorld: Object.freeze({ ...segment.startWorld }),
        endWorld: Object.freeze({ ...segment.endWorld }),
      })
    );
  return Object.freeze({ status: reconciliation.status, segments: Object.freeze(segments) });
}
