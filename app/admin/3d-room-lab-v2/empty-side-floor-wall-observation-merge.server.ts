import "server-only";

import type {
  EmptyObservedPlane,
  EmptyObservedSeam,
  EmptyRoomObservationAcceptedEvidence,
  EmptyRoomObservationEvidence,
  FocusedSideFloorWallMergeReceipt,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import type {
  FocusedSideFloorWallEvidence,
  FocusedSideFloorWallSide,
  FocusedSideFloorWallSideEvidence,
} from "./empty-side-floor-wall-observation-contract";
import {
  classifyFrontierVertex,
  evaluateFrontierProximity,
  evaluateOppositeOccupancy,
  isNearVerticalFloorWallSeam,
  pointIsFrameAdjacent,
} from "./room-boundary-qualification.server";

const MAX_PLANES = 24;
const MAX_SEAMS = 48;
const DUPLICATE_THRESHOLD = 0.045;
const SUPPORT_BOX_PAD = 0.04;

/**
 * Image-space floor-wall minimum span. Shorter traces are local trim/noise
 * and cannot form a usable visible side floor-wall. This is not an epsilon.
 */
export const FOCUSED_SIDE_FLOOR_WALL_MIN_IMAGE_SPAN = 0.04;

/**
 * Interior samples along a focused seam. Endpoints are not proof: a
 * junction-pass + frame-N/A pair can hide an in-span departure from the
 * General floor frontier.
 */
export const IN_SPAN_FLOOR_FRONTIER_SAMPLE_T = [0.25, 0.5, 0.75] as const;

export const FLOOR_WALL_MERGE_REASON = {
  identityMismatch: "focused_rejected:empty_identity_mismatch",
  floorMissing: "focused_rejected:general_floor_missing",
  ambiguous: "focused_rejected:ambiguous_focused_evidence",
  seamWithoutWall: "focused_rejected:seam_without_wall_plane",
  wallWithoutSeam: "focused_skipped:wall_without_coherent_seam",
  alreadyPresent: "focused_duplicate_suppressed:general_side_floor_wall_present",
  duplicateSeam: "focused_duplicate_suppressed:same_side_or_overlapping_seam",
  duplicatePlane: "focused_duplicate_suppressed:equivalent_general_wall_plane",
  notNearFloorFrontier: "focused_rejected:seam_not_near_floor_frontier",
  notNearWallFrontier: "focused_rejected:seam_not_near_wall_frontier",
  occupancyIncoherent: "focused_rejected:local_occupancy_incoherent",
  nearVertical: "focused_rejected:near_vertical_wall_wall_like",
  minSpan: "focused_rejected:below_minimum_image_span",
  beyondSupport: "focused_rejected:extends_beyond_reported_support",
  wallWallEdge: "focused_rejected:wall_wall_edge",
  wallCeilingEdge: "focused_rejected:wall_ceiling_edge",
  backWallContinuation: "focused_rejected:back_wall_continuation",
  sideMismatch: "focused_rejected:side_geometry_mismatch",
  conflictingGeometry: "focused_rejected:conflicting_general_geometry",
  ambiguousWallMatch: "focused_rejected:ambiguous_general_wall_match",
  maxPrimitives: "focused_rejected:max_planes_or_seams",
} as const;

function distance(a: SourceNormalizedPoint, b: SourceNormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestPointOnSegment(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): SourceNormalizedPoint {
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  const span = spanX * spanX + spanY * spanY;
  if (span === 0) return start;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * spanX + (point.y - start.y) * spanY) / span),
  );
  return { x: start.x + spanX * t, y: start.y + spanY * t };
}

function pointToPolylineDistance(
  point: SourceNormalizedPoint,
  line: readonly SourceNormalizedPoint[],
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    minimum = Math.min(
      minimum,
      distance(point, nearestPointOnSegment(point, line[index - 1], line[index])),
    );
  }
  return minimum;
}

function meanPointToPolylineDistance(
  points: readonly SourceNormalizedPoint[],
  line: readonly SourceNormalizedPoint[],
): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  return points.reduce(
    (sum, point) => sum + pointToPolylineDistance(point, line),
    0,
  ) / points.length;
}

function polylineLength(line: readonly SourceNormalizedPoint[]): number {
  let length = 0;
  for (let index = 1; index < line.length; index += 1) {
    length += distance(line[index - 1], line[index]);
  }
  return length;
}

function polylinesAreNearDuplicate(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): boolean {
  if (first.length < 2 || second.length < 2) return false;
  const meanFirst = meanPointToPolylineDistance(first, second);
  const meanSecond = meanPointToPolylineDistance(second, first);
  return meanFirst <= DUPLICATE_THRESHOLD && meanSecond <= DUPLICATE_THRESHOLD;
}

function midpoint(line: readonly SourceNormalizedPoint[]): SourceNormalizedPoint {
  const start = line[0];
  const end = line[line.length - 1];
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function imageSideFromX(x: number): FocusedSideFloorWallSide | "center" {
  if (x <= 0.4) return "left";
  if (x >= 0.6) return "right";
  return "center";
}

function polylineSide(
  line: readonly SourceNormalizedPoint[],
): FocusedSideFloorWallSide | "center" {
  return imageSideFromX(midpoint(line).x);
}

function polygonCentroid(
  polygon: readonly SourceNormalizedPoint[],
): SourceNormalizedPoint | null {
  if (polygon.length < 3) return null;
  const sum = polygon.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

function polygonSide(
  polygon: readonly SourceNormalizedPoint[],
): FocusedSideFloorWallSide | "center" {
  const centroid = polygonCentroid(polygon);
  return centroid ? imageSideFromX(centroid.x) : "center";
}

function boundingBox(points: readonly SourceNormalizedPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (points.length === 0) return null;
  return points.reduce(
    (box, point) => ({
      minX: Math.min(box.minX, point.x),
      minY: Math.min(box.minY, point.y),
      maxX: Math.max(box.maxX, point.x),
      maxY: Math.max(box.maxY, point.y),
    }),
    {
      minX: points[0].x,
      minY: points[0].y,
      maxX: points[0].x,
      maxY: points[0].y,
    },
  );
}

function seamExtendsBeyondWallSupport(
  seam: readonly SourceNormalizedPoint[],
  wall: readonly SourceNormalizedPoint[],
): boolean {
  const wallBox = boundingBox(wall);
  if (!wallBox) return true;
  return seam.some((point) => {
    const outside =
      point.x < wallBox.minX - SUPPORT_BOX_PAD ||
      point.x > wallBox.maxX + SUPPORT_BOX_PAD ||
      point.y < wallBox.minY - SUPPORT_BOX_PAD ||
      point.y > wallBox.maxY + SUPPORT_BOX_PAD;
    return outside && !pointIsFrameAdjacent(point);
  });
}

function uniqueId(rawId: string, used: Set<string>, prefix: string): string {
  const base = /^[A-Za-z]/.test(rawId) ? rawId : `${prefix}_${rawId}`;
  const prefixed = base.startsWith(prefix) ? base.slice(0, 80) : `${prefix}_${base}`.slice(0, 80);
  if (!used.has(prefixed)) {
    used.add(prefixed);
    return prefixed;
  }
  for (let index = 2; index < 32; index += 1) {
    const candidate = `${prefixed.slice(0, 76)}_${index}`.slice(0, 80);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${prefix}_${used.size}`.slice(0, 80);
  used.add(fallback);
  return fallback;
}

function occupancyCoherent(
  seam: readonly SourceNormalizedPoint[],
  floor: readonly SourceNormalizedPoint[],
  wall: readonly SourceNormalizedPoint[],
): boolean {
  const occupancy = evaluateOppositeOccupancy(seam, floor, wall);
  return Boolean(
    occupancy &&
      occupancy.opposite &&
      occupancy.floorSide !== "mixed" &&
      occupancy.wallSide !== "mixed" &&
      occupancy.floorSide !== "undetermined" &&
      occupancy.wallSide !== "undetermined",
  );
}

function frontierCoherent(
  seam: readonly SourceNormalizedPoint[],
  floor: readonly SourceNormalizedPoint[],
  wall: readonly SourceNormalizedPoint[],
): { nearFloor: boolean; nearWall: boolean } {
  const frontier = evaluateFrontierProximity(seam, floor, wall);
  return {
    nearFloor: frontier.nearFloorFrontier,
    nearWall: frontier.nearWallFrontier,
  };
}

function boundFloorWallSeams(
  seams: readonly EmptyObservedSeam[],
  floorId: string,
  wallId: string,
): EmptyObservedSeam[] {
  return seams.filter((seam) =>
    seam.category === "floor_wall" &&
    seam.planeIds.includes(floorId) &&
    seam.planeIds.includes(wallId)
  );
}

type GeneralWallRole = "back" | "side" | "unknown";

type FrameTerminus =
  | "bottom_left"
  | "bottom_right"
  | "bottom"
  | "left_side"
  | "right_side"
  | "other";

type OrientedFrontier = Readonly<{
  rear: SourceNormalizedPoint;
  fore: SourceNormalizedPoint;
}>;

function seamEndpoints(
  line: readonly SourceNormalizedPoint[],
): {
  start: SourceNormalizedPoint;
  end: SourceNormalizedPoint;
} | null {
  if (line.length < 2) return null;
  return { start: line[0], end: line[line.length - 1] };
}

function pointNear(
  first: SourceNormalizedPoint,
  second: SourceNormalizedPoint,
): boolean {
  return distance(first, second) <= DUPLICATE_THRESHOLD;
}

function polylineMeetsJunction(
  line: readonly SourceNormalizedPoint[],
  junction: SourceNormalizedPoint,
): boolean {
  const ends = seamEndpoints(line);
  if (!ends) return false;
  return pointNear(ends.start, junction) || pointNear(ends.end, junction);
}

function farEndpointFromJunction(
  line: readonly SourceNormalizedPoint[],
  junction: SourceNormalizedPoint,
): SourceNormalizedPoint | null {
  const ends = seamEndpoints(line);
  if (!ends) return null;
  return distance(ends.start, junction) >= distance(ends.end, junction)
    ? ends.start
    : ends.end;
}

function wallWallFloorJunction(
  wallWall: EmptyObservedSeam,
): SourceNormalizedPoint | null {
  const ends = seamEndpoints(wallWall.sourceNormalizedPolyline);
  if (!ends) return null;
  return ends.start.y >= ends.end.y ? ends.start : ends.end;
}

function adjacentWallId(
  wallWall: EmptyObservedSeam,
  wallId: string,
): string | null {
  if (!wallWall.planeIds.includes(wallId) || wallWall.planeIds.length !== 2) {
    return null;
  }
  return wallWall.planeIds.find((id) => id !== wallId) ?? null;
}

/**
 * At a floor/back/side trihedral, two floor-wall seams meet a wall-wall
 * floor junction. The seam whose far endpoint is farther toward image
 * foreground (y → 1) is SIDE; the more rear/lateral seam is BACK.
 * Relative comparison only — no new angular cutoff.
 */
function classifySeamKindByTrihedral(args: {
  seam: EmptyObservedSeam;
  wallId: string;
  floorId: string;
  seams: readonly EmptyObservedSeam[];
}): GeneralWallRole | null {
  const votes: GeneralWallRole[] = [];
  for (const wallWall of args.seams) {
    if (wallWall.category !== "wall_wall") continue;
    const neighborId = adjacentWallId(wallWall, args.wallId);
    if (!neighborId) continue;
    const junction = wallWallFloorJunction(wallWall);
    if (!junction) continue;
    if (!polylineMeetsJunction(args.seam.sourceNormalizedPolyline, junction)) {
      continue;
    }
    const neighborSeams = boundFloorWallSeams(
      args.seams,
      args.floorId,
      neighborId,
    ).filter((other) =>
      other.id !== args.seam.id &&
      polylineMeetsJunction(other.sourceNormalizedPolyline, junction)
    );
    if (neighborSeams.length !== 1) {
      if (neighborSeams.length > 1) votes.push("unknown");
      continue;
    }
    const thisFore = farEndpointFromJunction(
      args.seam.sourceNormalizedPolyline,
      junction,
    );
    const neighborFore = farEndpointFromJunction(
      neighborSeams[0].sourceNormalizedPolyline,
      junction,
    );
    if (!thisFore || !neighborFore) {
      votes.push("unknown");
      continue;
    }
    if (thisFore.y > neighborFore.y) votes.push("side");
    else if (thisFore.y < neighborFore.y) votes.push("back");
    else votes.push("unknown");
  }
  if (votes.length === 0) return null;
  if (votes.every((vote) => vote === "side")) return "side";
  if (votes.every((vote) => vote === "back")) return "back";
  return "unknown";
}

/**
 * When no trihedral is available: a floor-wall that leaves a rear
 * location toward a foreground/frame endpoint is SIDE. A perfectly
 * lateral interior span is BACK. Frame-touching rear spans and
 * interior-only traces that cannot be distinguished stay unknown.
 * Does not require the side wall to touch the frame.
 */
function classifySeamKindByForegroundDeparture(
  line: readonly SourceNormalizedPoint[],
): GeneralWallRole {
  const ends = seamEndpoints(line);
  if (!ends) return "unknown";
  const higher = ends.start.y >= ends.end.y ? ends.start : ends.end;
  const lower = ends.start.y >= ends.end.y ? ends.end : ends.start;
  if (pointIsFrameAdjacent(higher) && higher.y > lower.y) return "side";
  const touchesFrame =
    pointIsFrameAdjacent(ends.start) || pointIsFrameAdjacent(ends.end);
  if (!touchesFrame && higher.y === lower.y) return "back";
  return "unknown";
}

function classifyBoundFloorWallSeamKind(args: {
  seam: EmptyObservedSeam;
  wallId: string;
  floorId: string;
  seams: readonly EmptyObservedSeam[];
}): GeneralWallRole {
  return classifySeamKindByTrihedral(args) ??
    classifySeamKindByForegroundDeparture(args.seam.sourceNormalizedPolyline);
}

function closedPolygonEdges(
  polygon: readonly SourceNormalizedPoint[],
): readonly (readonly [SourceNormalizedPoint, SourceNormalizedPoint])[] {
  if (polygon.length < 2) return [];
  const edges: [SourceNormalizedPoint, SourceNormalizedPoint][] = [];
  for (let index = 1; index < polygon.length; index += 1) {
    edges.push([polygon[index - 1], polygon[index]]);
  }
  if (polygon.length >= 3) {
    edges.push([polygon[polygon.length - 1], polygon[0]]);
  }
  return edges;
}

function nearestFloorContactingEdge(
  wallPolygon: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
): readonly SourceNormalizedPoint[] | null {
  let best: readonly SourceNormalizedPoint[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [start, end] of closedPolygonEdges(wallPolygon)) {
    const edge = [start, end];
    const edgeDistance = meanPointToPolylineDistance(edge, floorPolygon);
    if (edgeDistance < bestDistance) {
      bestDistance = edgeDistance;
      best = edge;
    }
  }
  if (!best || bestDistance > DUPLICATE_THRESHOLD) return null;
  return best;
}

function wallWallNeighborIds(
  seams: readonly EmptyObservedSeam[],
  wallId: string,
): string[] {
  const neighbors: string[] = [];
  for (const seam of seams) {
    if (seam.category !== "wall_wall") continue;
    const neighborId = adjacentWallId(seam, wallId);
    if (neighborId && !neighbors.includes(neighborId)) {
      neighbors.push(neighborId);
    }
  }
  return neighbors;
}

function neighborHasBackFloorWall(args: {
  neighborId: string;
  floorId: string;
  seams: readonly EmptyObservedSeam[];
}): boolean {
  const bound = boundFloorWallSeams(args.seams, args.floorId, args.neighborId);
  return bound.length > 0 &&
    bound.every((seam) =>
      classifyBoundFloorWallSeamKind({
        seam,
        wallId: args.neighborId,
        floorId: args.floorId,
        seams: args.seams,
      }) === "back"
    );
}

function agreedRole(kinds: readonly GeneralWallRole[]): GeneralWallRole {
  if (kinds.length === 0) return "unknown";
  if (kinds.every((kind) => kind === "side")) return "side";
  if (kinds.every((kind) => kind === "back")) return "back";
  return "unknown";
}

/**
 * Prove wall role from lower-room topology only. wall_ceiling is never
 * consulted. Provider ids are not authoritative.
 */
function classifyGeneralWallRole(args: {
  wall: EmptyObservedPlane;
  floor: EmptyObservedPlane;
  seams: readonly EmptyObservedSeam[];
}): GeneralWallRole {
  if (args.wall.category !== "wall") return "unknown";
  const bound = boundFloorWallSeams(
    args.seams,
    args.floor.id,
    args.wall.id,
  );
  if (bound.length > 0) {
    return agreedRole(
      bound.map((seam) =>
        classifyBoundFloorWallSeamKind({
          seam,
          wallId: args.wall.id,
          floorId: args.floor.id,
          seams: args.seams,
        })
      ),
    );
  }
  if (
    wallWallNeighborIds(args.seams, args.wall.id).some((neighborId) =>
      neighborHasBackFloorWall({
        neighborId,
        floorId: args.floor.id,
        seams: args.seams,
      })
    )
  ) {
    return "side";
  }
  const contact = nearestFloorContactingEdge(
    args.wall.sourceNormalizedPolygon,
    args.floor.sourceNormalizedPolygon,
  );
  if (!contact) return "unknown";
  return classifySeamKindByForegroundDeparture(contact);
}

function sideFromRearToForeground(
  line: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
): FocusedSideFloorWallSide | null {
  const ends = seamEndpoints(line);
  if (!ends) return null;
  const rear = ends.start.y <= ends.end.y ? ends.start : ends.end;
  const fore = ends.start.y <= ends.end.y ? ends.end : ends.start;
  const spanX = fore.x - rear.x;
  if (spanX < 0) return "left";
  if (spanX > 0) return "right";
  const floorCenter = polygonCentroid(floorPolygon);
  if (!floorCenter) return null;
  const seamCenterX = (ends.start.x + ends.end.x) / 2;
  if (seamCenterX < floorCenter.x) return "left";
  if (seamCenterX > floorCenter.x) return "right";
  return null;
}

/**
 * LEFT/RIGHT only after structural side-wall proof. Image x-bands are
 * not applied to arbitrary walls. Direction is rear → foreground in
 * EMPTY image space (y → 1), mirrored-room safe.
 */
function classifyProvenSideWallSide(args: {
  wall: EmptyObservedPlane;
  floor: EmptyObservedPlane;
  seams: readonly EmptyObservedSeam[];
  wallRole: GeneralWallRole;
}): FocusedSideFloorWallSide | null {
  if (args.wallRole !== "side") return null;
  const bound = boundFloorWallSeams(
    args.seams,
    args.floor.id,
    args.wall.id,
  );
  const line = bound[0]?.sourceNormalizedPolyline ??
    nearestFloorContactingEdge(
      args.wall.sourceNormalizedPolygon,
      args.floor.sourceNormalizedPolygon,
    );
  if (!line) return null;
  return sideFromRearToForeground(line, args.floor.sourceNormalizedPolygon);
}

function pointAlongPolyline(
  line: readonly SourceNormalizedPoint[],
  t: number,
): SourceNormalizedPoint {
  const start = line[0];
  if (line.length < 2) return start;
  const total = polylineLength(line);
  if (total <= 0) return start;
  let remaining = total * t;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    const segment = distance(from, to);
    if (remaining <= segment) {
      const u = segment === 0 ? 0 : remaining / segment;
      return {
        x: from.x + (to.x - from.x) * u,
        y: from.y + (to.y - from.y) * u,
      };
    }
    remaining -= segment;
  }
  return line[line.length - 1];
}

function unitFromTo(
  from: SourceNormalizedPoint,
  to: SourceNormalizedPoint,
): SourceNormalizedPoint | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return { x: dx / length, y: dy / length };
}

function classifyFrameTerminus(point: SourceNormalizedPoint): FrameTerminus {
  if (!pointIsFrameAdjacent(point)) return "other";
  const left = point.x;
  const right = 1 - point.x;
  const top = point.y;
  const bottom = 1 - point.y;
  const nearest = Math.min(left, right, top, bottom);
  const onLeft = left === nearest;
  const onRight = right === nearest;
  const onBottom = bottom === nearest;
  if (onBottom && onLeft) return "bottom_left";
  if (onBottom && onRight) return "bottom_right";
  if (onBottom) return "bottom";
  if (onLeft) return "left_side";
  if (onRight) return "right_side";
  return "other";
}

function bottomOnRequestedSide(
  point: SourceNormalizedPoint,
  side: FocusedSideFloorWallSide,
): boolean {
  return imageSideFromX(point.x) === side;
}

/**
 * Corner endpoints may match an adjacent edge. A high side-frame cut does
 * not match a bottom/bottom-corner General exit.
 */
function frameTerminiCompatible(
  focused: SourceNormalizedPoint,
  general: SourceNormalizedPoint,
  side: FocusedSideFloorWallSide,
): boolean {
  const focusedTerminus = classifyFrameTerminus(focused);
  const generalTerminus = classifyFrameTerminus(general);
  if (focusedTerminus === "other" || generalTerminus === "other") {
    return false;
  }
  if (side === "left") {
    const focusedBottom =
      focusedTerminus === "bottom_left" ||
      (focusedTerminus === "bottom" && bottomOnRequestedSide(focused, "left"));
    const generalBottom =
      generalTerminus === "bottom_left" ||
      (generalTerminus === "bottom" && bottomOnRequestedSide(general, "left"));
    if (focusedTerminus === "bottom_left") {
      return generalBottom || generalTerminus === "left_side";
    }
    if (focusedBottom && generalBottom) return true;
    return focusedTerminus === "left_side" &&
      generalTerminus === "left_side";
  }
  const focusedBottom =
    focusedTerminus === "bottom_right" ||
    (focusedTerminus === "bottom" && bottomOnRequestedSide(focused, "right"));
  const generalBottom =
    generalTerminus === "bottom_right" ||
    (generalTerminus === "bottom" && bottomOnRequestedSide(general, "right"));
  if (focusedTerminus === "bottom_right") {
    return generalBottom || generalTerminus === "right_side";
  }
  if (focusedBottom && generalBottom) return true;
  return focusedTerminus === "right_side" &&
    generalTerminus === "right_side";
}

function orientPolylineFromRear(
  seam: readonly SourceNormalizedPoint[],
  rear: SourceNormalizedPoint,
): readonly SourceNormalizedPoint[] {
  if (seam.length < 2) return seam;
  return distance(seam[0], rear) <= distance(seam[seam.length - 1], rear)
    ? seam
    : [...seam].reverse();
}

function frameTruncatedEndpoints(
  seam: readonly SourceNormalizedPoint[],
): OrientedFrontier | null {
  const ends = seamEndpoints(seam);
  if (!ends) return null;
  const startAdjacent = pointIsFrameAdjacent(ends.start);
  const endAdjacent = pointIsFrameAdjacent(ends.end);
  if (!startAdjacent && !endAdjacent) return null;
  if (startAdjacent && endAdjacent) {
    const truncated = ends.start.y >= ends.end.y ? ends.start : ends.end;
    const rear = ends.start.y >= ends.end.y ? ends.end : ends.start;
    return { rear, fore: truncated };
  }
  return startAdjacent
    ? { rear: ends.end, fore: ends.start }
    : { rear: ends.start, fore: ends.end };
}

function generalSideFloorFrontier(
  floorPolygon: readonly SourceNormalizedPoint[],
  side: FocusedSideFloorWallSide,
  junction: SourceNormalizedPoint,
): OrientedFrontier | null {
  let best: { frontier: OrientedFrontier; distance: number } | null = null;
  for (const [start, end] of closedPolygonEdges(floorPolygon)) {
    const line = [start, end];
    if (classifySeamKindByForegroundDeparture(line) !== "side") continue;
    if (sideFromRearToForeground(line, floorPolygon) !== side) continue;
    const edgeDistance = pointToPolylineDistance(junction, line);
    if (best && edgeDistance >= best.distance) continue;
    const rear = start.y <= end.y ? start : end;
    const fore = start.y <= end.y ? end : start;
    best = { frontier: { rear, fore }, distance: edgeDistance };
  }
  if (!best) return null;
  if (
    classifyFrontierVertex(junction, [best.frontier.rear, best.frontier.fore], [])
      .status !== "pass"
  ) {
    return null;
  }
  return best.frontier;
}

/**
 * Consistency-only: focused seam vs General visible floor polygon frontier.
 * Does not snap, extend, or replace focused geometry.
 */
export function focusedSeamPassesInSpanFloorFrontier(
  seam: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
): Readonly<{
  pass: boolean;
  sampleStatuses: readonly ("pass" | "contradiction" | "not_applicable")[];
}> {
  if (seam.length < 2 || floorPolygon.length < 3) {
    return { pass: false, sampleStatuses: Object.freeze([]) };
  }
  const sampleStatuses = IN_SPAN_FLOOR_FRONTIER_SAMPLE_T.map((t) =>
    classifyFrontierVertex(
      pointAlongPolyline(seam, t),
      floorPolygon,
      [],
    ).status
  );
  const applicable = sampleStatuses.filter((status) =>
    status !== "not_applicable"
  );
  return {
    pass: applicable.length >= 1 &&
      applicable.every((status) => status === "pass"),
    sampleStatuses: Object.freeze(sampleStatuses),
  };
}

function focusedSeamPassesFrameTruncatedSideFrontier(
  seam: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  side: FocusedSideFloorWallSide,
): Readonly<{
  pass: boolean;
  sampleStatuses: readonly ("pass" | "contradiction" | "not_applicable")[];
}> {
  const empty = Object.freeze(
    [] as ("pass" | "contradiction" | "not_applicable")[],
  );
  if (seam.length < 2 || floorPolygon.length < 3) {
    return { pass: false, sampleStatuses: empty };
  }
  const ends = frameTruncatedEndpoints(seam);
  if (!ends) {
    return { pass: false, sampleStatuses: empty };
  }
  const junctionStatus = classifyFrontierVertex(
    ends.rear,
    floorPolygon,
    [],
  ).status;
  if (junctionStatus !== "pass") {
    return { pass: false, sampleStatuses: Object.freeze([junctionStatus]) };
  }
  const oriented = orientPolylineFromRear(seam, ends.rear);
  const nearRearT = IN_SPAN_FLOOR_FRONTIER_SAMPLE_T[0];
  const nearRearStatus = classifyFrontierVertex(
    pointAlongPolyline(oriented, nearRearT),
    floorPolygon,
    [],
  ).status;
  if (nearRearStatus === "contradiction") {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  if (oriented.length >= 2 && oriented[1].y < oriented[0].y) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  const generalFrontier = generalSideFloorFrontier(
    floorPolygon,
    side,
    ends.rear,
  );
  if (!generalFrontier) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  if (ends.fore.y <= ends.rear.y) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  if (
    ends.fore.y < (ends.rear.y + generalFrontier.fore.y) / 2
  ) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  const focusedDirection = unitFromTo(ends.rear, ends.fore);
  const generalDirection = unitFromTo(generalFrontier.rear, generalFrontier.fore);
  if (!focusedDirection || !generalDirection) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  const directionalSimilarity =
    focusedDirection.x * generalDirection.x +
    focusedDirection.y * generalDirection.y;
  if (directionalSimilarity <= 0) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  if (!frameTerminiCompatible(ends.fore, generalFrontier.fore, side)) {
    return {
      pass: false,
      sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
    };
  }
  return {
    pass: true,
    sampleStatuses: Object.freeze([junctionStatus, nearRearStatus]),
  };
}

/**
 * Two-mode floor-frontier consistency. Ordinary seams keep full in-span
 * 0.012 coincidence. Proven frame-truncated SIDE seams use junction
 * agreement, supported-rear sampling, directional compatibility, and
 * frame-region compatibility instead of full-span coincidence.
 */
export function focusedSeamPassesFloorFrontierConsistency(args: {
  seam: readonly SourceNormalizedPoint[];
  floorPolygon: readonly SourceNormalizedPoint[];
  side: FocusedSideFloorWallSide;
  frameTruncated: boolean;
}): Readonly<{
  pass: boolean;
  sampleStatuses: readonly ("pass" | "contradiction" | "not_applicable")[];
}> {
  if (!args.frameTruncated) {
    return focusedSeamPassesInSpanFloorFrontier(
      args.seam,
      args.floorPolygon,
    );
  }
  return focusedSeamPassesFrameTruncatedSideFrontier(
    args.seam,
    args.floorPolygon,
    args.side,
  );
}

/**
 * Complete General side pair from General geometry only: exactly one
 * structurally proven SIDE wall classified to the requested LEFT/RIGHT,
 * plus a surviving floor_wall seam bound to floor + that exact wall.
 * Image-position centroid is not wall-role authority. Independent of
 * focused seam geometry and of wall_ceiling / S3F.
 */
function findCompleteGeneralSideFloorWallPair(args: {
  floor: EmptyObservedPlane;
  side: FocusedSideFloorWallSide;
  planes: readonly EmptyObservedPlane[];
  seams: readonly EmptyObservedSeam[];
}): {
  status: "complete" | "wall_without_seam" | "ambiguous_walls" | "absent";
  wall: EmptyObservedPlane | null;
  seam: EmptyObservedSeam | null;
} {
  const matches: {
    wall: EmptyObservedPlane;
    bound: EmptyObservedSeam[];
  }[] = [];
  for (const plane of args.planes) {
    if (plane.category !== "wall") continue;
    const wallRole = classifyGeneralWallRole({
      wall: plane,
      floor: args.floor,
      seams: args.seams,
    });
    if (wallRole === "back" || wallRole === "unknown") continue;
    const provenSide = classifyProvenSideWallSide({
      wall: plane,
      floor: args.floor,
      seams: args.seams,
      wallRole,
    });
    if (provenSide !== args.side) continue;
    matches.push({
      wall: plane,
      bound: boundFloorWallSeams(args.seams, args.floor.id, plane.id),
    });
  }
  if (matches.length > 1) {
    return { status: "ambiguous_walls", wall: null, seam: null };
  }
  if (matches.length === 0) {
    return { status: "absent", wall: null, seam: null };
  }
  const match = matches[0];
  if (match.bound.length === 0) {
    return { status: "wall_without_seam", wall: match.wall, seam: null };
  }
  return { status: "complete", wall: match.wall, seam: match.bound[0] };
}

function generalFloor(
  planes: readonly EmptyObservedPlane[],
): EmptyObservedPlane | null {
  const floors = planes.filter((plane) => plane.category === "floor");
  return floors.length === 1 ? floors[0] : null;
}

function conservativeConfidence(
  focused: number,
  floor: EmptyObservedPlane,
  wall: EmptyObservedPlane,
): number {
  return Math.min(focused, floor.confidence, wall.confidence);
}

function focusedReceipt(args: {
  focused: FocusedSideFloorWallEvidence | null;
  addedPlaneIds?: readonly string[];
  addedSeamIds?: readonly string[];
  skippedDuplicatePlaneIds?: readonly string[];
  skippedDuplicateSeamIds?: readonly string[];
  rejectedPlaneIds?: readonly string[];
  rejectedSeamIds?: readonly string[];
  resolutionReasons?: readonly string[];
}): FocusedSideFloorWallMergeReceipt {
  const addedPlaneIds = args.addedPlaneIds ?? [];
  const addedSeamIds = args.addedSeamIds ?? [];
  const skippedDuplicatePlaneIds = args.skippedDuplicatePlaneIds ?? [];
  const skippedDuplicateSeamIds = args.skippedDuplicateSeamIds ?? [];
  const rejectedPlaneIds = args.rejectedPlaneIds ?? [];
  const rejectedSeamIds = args.rejectedSeamIds ?? [];
  const resolutionReasons = args.resolutionReasons ?? [];
  if (!args.focused) {
    return Object.freeze({
      observerStatus: "not_run",
      promptVersion: null,
      emptyIdentitySha256: null,
      addedPlaneIds: Object.freeze(addedPlaneIds),
      addedSeamIds: Object.freeze(addedSeamIds),
      skippedDuplicatePlaneIds: Object.freeze(skippedDuplicatePlaneIds),
      skippedDuplicateSeamIds: Object.freeze(skippedDuplicateSeamIds),
      rejectedPlaneIds: Object.freeze(rejectedPlaneIds),
      rejectedSeamIds: Object.freeze(rejectedSeamIds),
      resolutionReasons: Object.freeze(resolutionReasons),
      geometryManufactured: false,
      hiddenContinuationAdded: false,
      failure: null,
    });
  }
  const observerStatus = args.focused.observerStatus === "failed"
    ? "failed" as const
    : args.focused.observedSides.length === 0
    ? "empty" as const
    : args.focused.observerStatus;
  return Object.freeze({
    observerStatus,
    promptVersion: args.focused.observer.promptVersion,
    emptyIdentitySha256: args.focused.basis.identity.sha256,
    addedPlaneIds: Object.freeze(addedPlaneIds),
    addedSeamIds: Object.freeze(addedSeamIds),
    skippedDuplicatePlaneIds: Object.freeze(skippedDuplicatePlaneIds),
    skippedDuplicateSeamIds: Object.freeze(skippedDuplicateSeamIds),
    rejectedPlaneIds: Object.freeze(rejectedPlaneIds),
    rejectedSeamIds: Object.freeze(rejectedSeamIds),
    resolutionReasons: Object.freeze(resolutionReasons),
    geometryManufactured: false,
    hiddenContinuationAdded: false,
    failure: args.focused.failure,
  });
}

function identitiesMatch(
  general: EmptyRoomObservationAcceptedEvidence,
  focused: FocusedSideFloorWallEvidence,
): boolean {
  return general.basis.identity.sha256 === focused.basis.identity.sha256 &&
    general.basis.attemptId === focused.basis.attemptId &&
    general.basis.loadGeneration === focused.basis.loadGeneration;
}

function withReceipt(
  general: EmptyRoomObservationAcceptedEvidence,
  receipt: FocusedSideFloorWallMergeReceipt,
  extras: {
    planes?: readonly EmptyObservedPlane[];
    seams?: readonly EmptyObservedSeam[];
    adjacency?: EmptyRoomObservationAcceptedEvidence["observedAdjacency"];
  } = {},
): EmptyRoomObservationAcceptedEvidence {
  return Object.freeze({
    ...general,
    observedPlanes: extras.planes ?? general.observedPlanes,
    observedSeams: extras.seams ?? general.observedSeams,
    observedAdjacency: extras.adjacency ?? general.observedAdjacency,
    qualityGate: Object.freeze({
      ...general.qualityGate,
      focusedSideFloorWall: receipt,
    }),
  });
}

function rejectSide(
  side: FocusedSideFloorWallSideEvidence,
  reason: string,
  rejectedPlaneIds: string[],
  rejectedSeamIds: string[],
  resolutionReasons: string[],
) {
  rejectedPlaneIds.push(`${side.side}_wall`);
  rejectedSeamIds.push(`${side.side}_floor_wall`);
  resolutionReasons.push(reason);
}

function resolveFocusedSide(args: {
  side: FocusedSideFloorWallSideEvidence;
  floor: EmptyObservedPlane;
  planes: EmptyObservedPlane[];
  seams: EmptyObservedSeam[];
  usedPlaneIds: Set<string>;
  usedSeamIds: Set<string>;
  addedPlaneIds: string[];
  addedSeamIds: string[];
  skippedDuplicatePlaneIds: string[];
  skippedDuplicateSeamIds: string[];
  rejectedPlaneIds: string[];
  rejectedSeamIds: string[];
  resolutionReasons: string[];
}): void {
  const {
    side,
    floor,
    planes,
    seams,
    usedPlaneIds,
    usedSeamIds,
    addedPlaneIds,
    addedSeamIds,
    skippedDuplicatePlaneIds,
    skippedDuplicateSeamIds,
    rejectedPlaneIds,
    rejectedSeamIds,
    resolutionReasons,
  } = args;
  const seamLine = side.sourceNormalizedFloorWallPolyline;
  const wallPolygon = side.sourceNormalizedWallPolygon;

  if (side.ambiguity !== null) {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.ambiguous,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }
  if (!seamLine) {
    resolutionReasons.push(FLOOR_WALL_MERGE_REASON.wallWithoutSeam);
    return;
  }
  if (polylineSide(seamLine) !== side.side && polylineSide(seamLine) !== "center") {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.sideMismatch,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }
  if (polylineLength(seamLine) < FOCUSED_SIDE_FLOOR_WALL_MIN_IMAGE_SPAN) {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.minSpan,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }
  if (isNearVerticalFloorWallSeam(seamLine)) {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.nearVertical,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }

  const completePair = findCompleteGeneralSideFloorWallPair({
    floor,
    side: side.side,
    planes,
    seams,
  });
  if (completePair.status === "ambiguous_walls") {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.ambiguousWallMatch,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }
  if (completePair.status === "complete") {
    skippedDuplicateSeamIds.push(`${side.side}_floor_wall`);
    if (wallPolygon) {
      skippedDuplicatePlaneIds.push(`${side.side}_wall`);
    }
    resolutionReasons.push(FLOOR_WALL_MERGE_REASON.alreadyPresent);
    return;
  }

  const overlappingSeam = seams.find((seam) =>
    seam.category === "floor_wall" &&
    polylinesAreNearDuplicate(seamLine, seam.sourceNormalizedPolyline)
  );
  if (overlappingSeam) {
    skippedDuplicateSeamIds.push(`${side.side}_floor_wall`);
    resolutionReasons.push(FLOOR_WALL_MERGE_REASON.duplicateSeam);
    return;
  }
  const wallWalls = seams.filter((seam) => seam.category === "wall_wall");
  if (
    wallWalls.some((seam) =>
      polylinesAreNearDuplicate(seamLine, seam.sourceNormalizedPolyline)
    )
  ) {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.wallWallEdge,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }
  const wallCeilings = seams.filter((seam) => seam.category === "wall_ceiling");
  if (
    wallCeilings.some((seam) =>
      polylinesAreNearDuplicate(seamLine, seam.sourceNormalizedPolyline)
    )
  ) {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.wallCeilingEdge,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }

  const inSpanFloor = focusedSeamPassesFloorFrontierConsistency({
    seam: seamLine,
    floorPolygon: floor.sourceNormalizedPolygon,
    side: side.side,
    frameTruncated: side.frameTruncated,
  });
  if (!inSpanFloor.pass) {
    rejectSide(
      side,
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    );
    return;
  }

  let wall = completePair.wall;
  let addedPlane: EmptyObservedPlane | null = null;
  if (!wall) {
    if (!wallPolygon) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.seamWithoutWall,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    const wallSide = polygonSide(wallPolygon);
    if (wallSide !== side.side) {
      rejectSide(
        side,
        wallSide === "center"
          ? FLOOR_WALL_MERGE_REASON.backWallContinuation
          : FLOOR_WALL_MERGE_REASON.sideMismatch,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (seamExtendsBeyondWallSupport(seamLine, wallPolygon)) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.beyondSupport,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    const frontier = frontierCoherent(
      seamLine,
      floor.sourceNormalizedPolygon,
      wallPolygon,
    );
    if (!frontier.nearFloor) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (!frontier.nearWall) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.notNearWallFrontier,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (!occupancyCoherent(seamLine, floor.sourceNormalizedPolygon, wallPolygon)) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.occupancyIncoherent,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (planes.length >= MAX_PLANES || seams.length >= MAX_SEAMS) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.maxPrimitives,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    addedPlane = Object.freeze({
      id: uniqueId(
        `focused_${side.side}_wall_plane`,
        usedPlaneIds,
        "fsfw",
      ),
      category: "wall" as const,
      sourceNormalizedPolygon: wallPolygon,
      regionRole: "observed_visible_plane_region" as const,
      confidence: side.confidence,
      ambiguity: null,
      evidenceClass: "provider_reported_visible_evidence" as const,
    });
    wall = addedPlane;
  } else {
    if (wallPolygon) {
      skippedDuplicatePlaneIds.push(`${side.side}_wall`);
      resolutionReasons.push(FLOOR_WALL_MERGE_REASON.duplicatePlane);
    }
    const frontier = frontierCoherent(
      seamLine,
      floor.sourceNormalizedPolygon,
      wall.sourceNormalizedPolygon,
    );
    if (!frontier.nearFloor) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (!frontier.nearWall) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.notNearWallFrontier,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (
      !occupancyCoherent(
        seamLine,
        floor.sourceNormalizedPolygon,
        wall.sourceNormalizedPolygon,
      )
    ) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.occupancyIncoherent,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (seamExtendsBeyondWallSupport(seamLine, wall.sourceNormalizedPolygon)) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.beyondSupport,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
    if (seams.length >= MAX_SEAMS) {
      rejectSide(
        side,
        FLOOR_WALL_MERGE_REASON.maxPrimitives,
        rejectedPlaneIds,
        rejectedSeamIds,
        resolutionReasons,
      );
      return;
    }
  }

  const mergedSeam: EmptyObservedSeam = Object.freeze({
    id: uniqueId(
      `focused_floor_${side.side}_wall_seam`,
      usedSeamIds,
      "fsfw",
    ),
    category: "floor_wall",
    planeIds: Object.freeze([floor.id, wall.id]),
    sourceNormalizedPolyline: seamLine,
    endpointPolicy: "preserve_observed_open_endpoints",
    confidence: conservativeConfidence(side.confidence, floor, wall),
    ambiguity: null,
    evidenceClass: "provider_reported_visible_evidence",
    observationSource: "general_empty_observer",
  });
  if (addedPlane) {
    planes.push(addedPlane);
    addedPlaneIds.push(addedPlane.id);
  }
  seams.push(mergedSeam);
  addedSeamIds.push(mergedSeam.id);
}

function withMergedEvidence(
  general: EmptyRoomObservationAcceptedEvidence,
  focused: FocusedSideFloorWallEvidence,
): EmptyRoomObservationAcceptedEvidence {
  if (!identitiesMatch(general, focused)) {
    return withReceipt(
      general,
      focusedReceipt({
        focused,
        rejectedPlaneIds: focused.observerStatus === "failed"
          ? []
          : focused.observedSides.map((side) => `${side.side}_wall`),
        rejectedSeamIds: focused.observerStatus === "failed"
          ? []
          : focused.observedSides.map((side) => `${side.side}_floor_wall`),
        resolutionReasons: [FLOOR_WALL_MERGE_REASON.identityMismatch],
      }),
    );
  }
  if (focused.observerStatus === "failed") {
    return withReceipt(general, focusedReceipt({ focused }));
  }
  if (focused.observedSides.length === 0) {
    return withReceipt(general, focusedReceipt({ focused }));
  }

  const floor = generalFloor(general.observedPlanes);
  const addedPlaneIds: string[] = [];
  const addedSeamIds: string[] = [];
  const skippedDuplicatePlaneIds: string[] = [];
  const skippedDuplicateSeamIds: string[] = [];
  const rejectedPlaneIds: string[] = [];
  const rejectedSeamIds: string[] = [];
  const resolutionReasons: string[] = [];
  if (!floor) {
    return withReceipt(general, focusedReceipt({
      focused,
      rejectedPlaneIds: focused.observedSides.map((side) => `${side.side}_wall`),
      rejectedSeamIds: focused.observedSides.map((side) => `${side.side}_floor_wall`),
      resolutionReasons: [FLOOR_WALL_MERGE_REASON.floorMissing],
    }));
  }

  const planes = [...general.observedPlanes];
  const seams = [...general.observedSeams];
  const usedPlaneIds = new Set(planes.map((plane) => plane.id));
  const usedSeamIds = new Set(seams.map((seam) => seam.id));
  for (const side of focused.observedSides) {
    resolveFocusedSide({
      side,
      floor,
      planes,
      seams,
      usedPlaneIds,
      usedSeamIds,
      addedPlaneIds,
      addedSeamIds,
      skippedDuplicatePlaneIds,
      skippedDuplicateSeamIds,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    });
  }

  const addedSeamIdSet = new Set(addedSeamIds);
  const adjacency = Object.freeze([
    ...general.observedAdjacency,
    ...seams
      .filter((seam) => addedSeamIdSet.has(seam.id) && seam.planeIds.length === 2)
      .map((seam) => Object.freeze({
        id: `adj_${seam.id}`.slice(0, 80),
        planeAId: seam.planeIds[0],
        planeBId: seam.planeIds[1],
        seamId: seam.id,
        confidence: seam.confidence,
        evidenceClass: "visible_seam_supported_adjacency" as const,
      })),
  ]);

  return withReceipt(
    general,
    focusedReceipt({
      focused,
      addedPlaneIds,
      addedSeamIds,
      skippedDuplicatePlaneIds,
      skippedDuplicateSeamIds,
      rejectedPlaneIds,
      rejectedSeamIds,
      resolutionReasons,
    }),
    {
      planes: Object.freeze(planes),
      seams: Object.freeze(seams),
      adjacency,
    },
  );
}

/**
 * Conservatively merge focused side floor-wall evidence onto general EMPTY
 * observation. Complete-General dominance: if General already has exactly
 * one structurally proven side wall for the requested side plus a
 * floor_wall seam bound to floor + that wall, focused evidence for that
 * side is diagnostic-only. Wall role is proven from lower-room topology
 * before LEFT/RIGHT classification. A left- or right-biased back wall is
 * never a side wall. wall_ceiling / S3F is not required. A left-biased
 * back floor-wall seam is not a left-side pair. When General is
 * incomplete, a focused fill must agree with the General floor polygon
 * frontier: ordinary seams require in-span 0.012 coincidence; proven
 * frame-truncated SIDE seams require rear-junction agreement, supported
 * rear sampling, foreground direction, and compatible frame termination.
 * Floor polygon geometry is never modified or used to manufacture a
 * seam. Added floor_wall seams are rewritten to general_empty_observer
 * so S4A can enumerate them.
 */
export function mergeFocusedSideFloorWallObservation(args: {
  general: EmptyRoomObservationEvidence | null;
  focused: FocusedSideFloorWallEvidence | null;
}): EmptyRoomObservationEvidence | null {
  const { general, focused } = args;
  if (!general) return null;
  if (!focused) {
    if (general.observerStatus === "failed") return general;
    return withReceipt(general, focusedReceipt({ focused: null }));
  }
  if (general.observerStatus === "failed") return general;
  return withMergedEvidence(general, focused);
}
