import type {
  EmptyObservedPlane,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import {
  ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M,
  ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M,
  ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD,
  ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO,
  ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY,
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_IMAGE_ON_LINE_ABS,
  ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO,
  type FrozenRoomBoundaryCameraSnapshot,
  type RoomBoundaryFrontierEvidence,
  type RoomBoundaryInteriorEvidence,
  type RoomBoundaryOccupancyEvidence,
  type RoomBoundaryWorldGeometry,
  type RoomBoundaryWorldXyz,
} from "./room-boundary-authority-contract";
import {
  horizontalRunRatio,
  imagePolylineLineFit,
  type FittedImageLine,
} from "./room-boundary-line-fit.server";
import type { OriginalWorldProjectionResult } from "./room-boundary-projection.server";

export type OccupancySide = "positive" | "negative" | "mixed" | "undetermined";

function signedImageSide(
  origin: SourceNormalizedPoint,
  direction: SourceNormalizedPoint,
  point: SourceNormalizedPoint,
): number {
  return direction.x * (point.y - origin.y) - direction.y * (point.x - origin.x);
}

function classifySide(distance: number): "on" | "positive" | "negative" {
  if (Math.abs(distance) <= ROOM_BOUNDARY_IMAGE_ON_LINE_ABS) return "on";
  return distance > 0 ? "positive" : "negative";
}

function polygonCentroid(
  polygon: readonly SourceNormalizedPoint[],
): SourceNormalizedPoint | null {
  if (polygon.length < 3) return null;
  const sum = polygon.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

export function pointInPolygon(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointToSegmentDistance(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): number {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 1e-18) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * abx + (point.y - start.y) * aby) / lengthSq),
  );
  return Math.hypot(point.x - (start.x + t * abx), point.y - (start.y + t * aby));
}

export function distanceToPolygonFrontier(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): number | null {
  if (polygon.length < 2) return null;
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = polygon[(index + 1) % polygon.length];
    min = Math.min(min, pointToSegmentDistance(point, polygon[index], next));
  }
  return Number.isFinite(min) ? min : null;
}

function occupancyForPolygon(
  polygon: readonly SourceNormalizedPoint[],
  line: FittedImageLine,
): { side: OccupancySide; on: number; positive: number; negative: number } {
  let on = 0;
  let positive = 0;
  let negative = 0;
  for (const point of polygon) {
    const classified = classifySide(
      signedImageSide(line.origin, line.direction, point),
    );
    if (classified === "on") on += 1;
    else if (classified === "positive") positive += 1;
    else negative += 1;
  }
  const centroid = polygonCentroid(polygon);
  if (centroid) {
    const classified = classifySide(
      signedImageSide(line.origin, line.direction, centroid),
    );
    if (classified === "positive") positive += 1;
    else if (classified === "negative") negative += 1;
    else on += 1;
  }
  const side: OccupancySide = positive > 0 && negative === 0
    ? "positive"
    : negative > 0 && positive === 0
    ? "negative"
    : positive > 0 && negative > 0
    ? "mixed"
    : "undetermined";
  return { side, on, positive, negative };
}

export function evaluateOppositeOccupancy(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
): RoomBoundaryOccupancyEvidence | null {
  const line = imagePolylineLineFit(polyline);
  if (!line) return null;
  const floor = occupancyForPolygon(floorPolygon, line);
  const wall = occupancyForPolygon(wallPolygon, line);
  return {
    floorSide: floor.side,
    wallSide: wall.side,
    opposite: (floor.side === "positive" && wall.side === "negative") ||
      (floor.side === "negative" && wall.side === "positive"),
    floorOnLineCount: floor.on,
    floorPositiveCount: floor.positive,
    floorNegativeCount: floor.negative,
    wallOnLineCount: wall.on,
    wallPositiveCount: wall.positive,
    wallNegativeCount: wall.negative,
  };
}

export function evaluateFrontierProximity(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  wallPolygon: readonly SourceNormalizedPoint[],
): RoomBoundaryFrontierEvidence {
  const floorDistances = polyline.map((point) =>
    distanceToPolygonFrontier(point, floorPolygon)
  );
  const wallDistances = polyline.map((point) =>
    distanceToPolygonFrontier(point, wallPolygon)
  );
  const maxDistanceToFloorFrontier = floorDistances.every(
    (value): value is number => value !== null,
  )
    ? Math.max(...floorDistances)
    : null;
  const maxDistanceToWallFrontier = wallDistances.every(
    (value): value is number => value !== null,
  )
    ? Math.max(...wallDistances)
    : null;
  return {
    maxDistanceToFloorFrontier,
    maxDistanceToWallFrontier,
    nearFloorFrontier: maxDistanceToFloorFrontier !== null &&
      maxDistanceToFloorFrontier <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
    nearWallFrontier: maxDistanceToWallFrontier !== null &&
      maxDistanceToWallFrontier <= ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  };
}

export function isNearVerticalFloorWallSeam(
  polyline: readonly SourceNormalizedPoint[],
): boolean {
  const ratio = horizontalRunRatio(polyline);
  return ratio !== null &&
    ratio < ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO;
}

export function endpointIsFrameAdjacent(
  polyline: readonly SourceNormalizedPoint[],
): boolean {
  if (polyline.length < 1) return false;
  const endpoints = [polyline[0], polyline[polyline.length - 1]];
  return endpoints.some((point) =>
    Math.min(point.x, 1 - point.x, point.y, 1 - point.y) <=
      ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY
  );
}

function perpendicularTowardSide(
  direction: SourceNormalizedPoint,
  desired: "positive" | "negative",
): SourceNormalizedPoint {
  const first = { x: -direction.y, y: direction.x };
  const origin = { x: 0, y: 0 };
  const firstSign = signedImageSide(origin, direction, first);
  const matches = desired === "positive" ? firstSign > 0 : firstSign < 0;
  return matches ? first : { x: direction.y, y: -direction.x };
}

function normalize2d(
  vector: SourceNormalizedPoint,
): SourceNormalizedPoint | null {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return { x: vector.x / length, y: vector.y / length };
}

export function chooseFloorInteriorWitness(
  polyline: readonly SourceNormalizedPoint[],
  floorPolygon: readonly SourceNormalizedPoint[],
  occupancy: RoomBoundaryOccupancyEvidence,
): SourceNormalizedPoint | null {
  if (occupancy.floorSide !== "positive" && occupancy.floorSide !== "negative") {
    return null;
  }
  const line = imagePolylineLineFit(polyline);
  if (!line) return null;
  const direction = normalize2d(line.direction);
  if (!direction) return null;
  const inward = normalize2d(
    perpendicularTowardSide(direction, occupancy.floorSide),
  );
  if (!inward) return null;
  const midpoint = {
    x: (polyline[0].x + polyline[polyline.length - 1].x) / 2,
    y: (polyline[0].y + polyline[polyline.length - 1].y) / 2,
  };
  const inset = {
    x: midpoint.x + inward.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    y: midpoint.y + inward.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  };
  if (pointInPolygon(inset, floorPolygon)) return inset;
  const centroid = polygonCentroid(floorPolygon);
  if (centroid && pointInPolygon(centroid, floorPolygon)) {
    const towardCentroid = {
      x: midpoint.x + (centroid.x - midpoint.x) * 0.35,
      y: midpoint.y + (centroid.y - midpoint.y) * 0.35,
    };
    if (pointInPolygon(towardCentroid, floorPolygon)) return towardCentroid;
    return centroid;
  }
  return null;
}

function signedPlaneDistance(
  point: RoomBoundaryWorldXyz,
  geometry: RoomBoundaryWorldGeometry,
): number {
  return geometry.supportPlaneNormal.x * point.x +
    geometry.supportPlaneNormal.y * point.y +
    geometry.supportPlaneNormal.z * point.z +
    geometry.supportPlaneConstant;
}

function signFromDistance(distance: number): -1 | 1 | 0 | null {
  if (!Number.isFinite(distance)) return null;
  if (Math.abs(distance) <= ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M) {
    return 0;
  }
  return distance > 0 ? 1 : -1;
}

export function evaluateInteriorHalfSpace(input: {
  occupancy: RoomBoundaryOccupancyEvidence | null;
  polyline: readonly SourceNormalizedPoint[];
  floorPolygon: readonly SourceNormalizedPoint[] | null;
  geometry: RoomBoundaryWorldGeometry | null;
  camera: FrozenRoomBoundaryCameraSnapshot;
  projectWitness: (
    point: SourceNormalizedPoint,
  ) => OriginalWorldProjectionResult | RoomBoundaryWorldXyz | null;
}): RoomBoundaryInteriorEvidence {
  const failed = (
    extras: Partial<RoomBoundaryInteriorEvidence> = {},
  ): RoomBoundaryInteriorEvidence => ({
    status: "insufficient",
    witnessImagePoint: extras.witnessImagePoint ?? null,
    witnessWorldPoint: extras.witnessWorldPoint ?? null,
    sideSign: extras.sideSign ?? null,
    cameraSideSign: extras.cameraSideSign ?? null,
    cameraContradictsWitness: extras.cameraContradictsWitness ?? false,
  });
  if (!input.occupancy || !input.geometry || !input.floorPolygon) {
    return failed();
  }
  const witnessImage = chooseFloorInteriorWitness(
    input.polyline,
    input.floorPolygon,
    input.occupancy,
  );
  if (!witnessImage) return failed();
  if (!pointInPolygon(witnessImage, input.floorPolygon)) {
    return failed({ witnessImagePoint: witnessImage });
  }
  const projected = input.projectWitness(witnessImage);
  if (!projected) return failed({ witnessImagePoint: witnessImage });
  const witnessWorld = "ok" in projected
    ? projected.ok
      ? projected.world
      : null
    : projected;
  if (!witnessWorld) return failed({ witnessImagePoint: witnessImage });
  const witnessDistance = signedPlaneDistance(witnessWorld, input.geometry);
  const sideSign = signFromDistance(witnessDistance);
  if (sideSign === null || sideSign === 0) {
    return failed({
      witnessImagePoint: witnessImage,
      witnessWorldPoint: witnessWorld,
    });
  }
  const cameraDistance = signedPlaneDistance({
    x: input.camera.pose.position.x,
    y: input.camera.pose.position.y,
    z: input.camera.pose.position.z,
  }, input.geometry);
  const cameraSideSign = signFromDistance(cameraDistance);
  if (
    cameraSideSign === 1 || cameraSideSign === -1
  ) {
    if (cameraSideSign !== sideSign) {
      return failed({
        witnessImagePoint: witnessImage,
        witnessWorldPoint: witnessWorld,
        sideSign,
        cameraSideSign,
        cameraContradictsWitness: true,
      });
    }
  }
  return {
    status: "accepted",
    witnessImagePoint: witnessImage,
    witnessWorldPoint: witnessWorld,
    sideSign,
    cameraSideSign,
    cameraContradictsWitness: false,
  };
}

export function competingSameWall(
  first: RoomBoundaryWorldGeometry,
  second: RoomBoundaryWorldGeometry,
): boolean {
  const firstLength = Math.hypot(
    first.tangent.x,
    first.tangent.z,
  );
  const secondLength = Math.hypot(
    second.tangent.x,
    second.tangent.z,
  );
  if (firstLength <= 1e-12 || secondLength <= 1e-12) return false;
  const firstTangent = {
    x: first.tangent.x / firstLength,
    z: first.tangent.z / firstLength,
  };
  const secondTangent = {
    x: second.tangent.x / secondLength,
    z: second.tangent.z / secondLength,
  };
  const absDot = Math.min(
    1,
    Math.abs(firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z),
  );
  const orientation = Math.acos(absDot);
  if (orientation > ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD) return false;

  const lateral = Math.max(
    pointToInfiniteXzLineDistance(first.baseStart, second),
    pointToInfiniteXzLineDistance(first.baseEnd, second),
    pointToInfiniteXzLineDistance(second.baseStart, first),
    pointToInfiniteXzLineDistance(second.baseEnd, first),
  );
  if (lateral > ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M) return false;

  const axis = {
    x: firstTangent.x + (firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z >= 0
      ? secondTangent.x
      : -secondTangent.x),
    z: firstTangent.z + (firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z >= 0
      ? secondTangent.z
      : -secondTangent.z),
  };
  const axisLength = Math.hypot(axis.x, axis.z);
  if (axisLength <= 1e-12) return false;
  const unit = { x: axis.x / axisLength, z: axis.z / axisLength };
  const firstA = first.baseStart.x * unit.x + first.baseStart.z * unit.z;
  const firstB = first.baseEnd.x * unit.x + first.baseEnd.z * unit.z;
  const secondA = second.baseStart.x * unit.x + second.baseStart.z * unit.z;
  const secondB = second.baseEnd.x * unit.x + second.baseEnd.z * unit.z;
  const overlap = intervalOverlap(firstA, firstB, secondA, secondB);
  const minSpan = Math.min(Math.abs(firstB - firstA), Math.abs(secondB - secondA));
  if (minSpan <= 1e-12) return false;
  return overlap / minSpan >= ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO;
}

function pointToInfiniteXzLineDistance(
  point: RoomBoundaryWorldXyz,
  geometry: RoomBoundaryWorldGeometry,
): number {
  const length = Math.hypot(geometry.tangent.x, geometry.tangent.z);
  if (length <= 1e-12) return Number.POSITIVE_INFINITY;
  const unit = { x: geometry.tangent.x / length, z: geometry.tangent.z / length };
  return Math.abs(
    (point.x - geometry.baseStart.x) * unit.z -
      (point.z - geometry.baseStart.z) * unit.x,
  );
}

function intervalOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): number {
  const left = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const right = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, right - left);
}

export function boundPlanesForFloorWall(
  planeIds: readonly string[],
  planes: readonly EmptyObservedPlane[],
): Readonly<{ floor: EmptyObservedPlane; wall: EmptyObservedPlane }> | null {
  if (planeIds.length !== 2) return null;
  const bound = planeIds
    .map((id) => planes.find((plane) => plane.id === id) ?? null);
  if (bound.some((plane) => plane === null)) return null;
  const [first, second] = bound as [EmptyObservedPlane, EmptyObservedPlane];
  if (first.category === "floor" && second.category === "wall") {
    return { floor: first, wall: second };
  }
  if (first.category === "wall" && second.category === "floor") {
    return { floor: second, wall: first };
  }
  return null;
}
