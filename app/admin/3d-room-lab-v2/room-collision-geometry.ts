import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import type { Vec2 } from "./room-collision-footprint";

/*
 * Arithmetic-only epsilons. They never enlarge a wall, invent thickness,
 * move an endpoint, or close a gap. Adapted from S2H swept collision.
 */
export const DENOMINATOR_EPSILON = 1e-12;
export const TIME_ORDER_EPSILON = 1e-10;
export const MOTION_EPSILON_SQUARED = 1e-24;
export const NUMERICAL_DISTANCE_EPSILON = 1e-12;

export type CollisionTranslationStatus =
  | "accepted"
  | "stopped_at_contact"
  | "slid"
  | "slid_then_stopped"
  | "start_overlapping";

export type CollisionTranslationResult = Readonly<{
  translation: Vec2;
  status: CollisionTranslationStatus;
  contactWallIds: readonly string[];
  skippedInvalidWallCount: number;
  unresolvedOverlap: boolean;
}>;

export type PreparedCollisionWall = Readonly<{
  id: string;
  a: Vec2;
  b: Vec2;
  tangent: Vec2;
  sMin: number;
  sMax: number;
  interiorNormal: Vec2;
  interiorConstant: number;
}>;

type LinearFeature = Readonly<{
  wallId: string;
  a: number;
  b: number;
  tEnter: number;
  tExit: number;
}>;

type WallHit = Readonly<{
  wall: PreparedCollisionWall;
  time: number;
}>;

export function prepareCollisionWall(
  wall: RoomCollisionEnabledWall,
): PreparedCollisionWall | null {
  if (
    !wall ||
    !Number.isFinite(wall.a.x) ||
    !Number.isFinite(wall.a.z) ||
    !Number.isFinite(wall.b.x) ||
    !Number.isFinite(wall.b.z) ||
    !Number.isFinite(wall.supportPlaneNormal.x) ||
    !Number.isFinite(wall.supportPlaneNormal.z) ||
    !Number.isFinite(wall.supportPlaneConstant) ||
    (wall.sideSign !== 1 && wall.sideSign !== -1)
  ) {
    return null;
  }
  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= DENOMINATOR_EPSILON) return null;
  const tangent = { x: dx / length, z: dz / length };
  const nx = wall.supportPlaneNormal.x * wall.sideSign;
  const nz = wall.supportPlaneNormal.z * wall.sideSign;
  const nLength = Math.hypot(nx, nz);
  if (!Number.isFinite(nLength) || nLength <= DENOMINATOR_EPSILON) return null;
  const interiorNormal = { x: nx / nLength, z: nz / nLength };
  const sA = tangent.x * wall.a.x + tangent.z * wall.a.z;
  const sB = tangent.x * wall.b.x + tangent.z * wall.b.z;
  return {
    id: wall.id,
    a: { x: wall.a.x, z: wall.a.z },
    b: { x: wall.b.x, z: wall.b.z },
    tangent,
    sMin: Math.min(sA, sB),
    sMax: Math.max(sA, sB),
    interiorNormal,
    interiorConstant: wall.supportPlaneConstant * wall.sideSign,
  };
}

export function interiorSignedDistance(point: Vec2, wall: PreparedCollisionWall): number {
  return wall.interiorNormal.x * point.x +
    wall.interiorNormal.z * point.z +
    wall.interiorConstant;
}

export function clippedMinInteriorDistance(
  vertices: readonly Vec2[],
  wall: PreparedCollisionWall,
): number | null {
  if (vertices.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let any = false;
  for (const vertex of vertices) {
    const s = wall.tangent.x * vertex.x + wall.tangent.z * vertex.z;
    if (s >= wall.sMin && s <= wall.sMax) {
      min = Math.min(min, interiorSignedDistance(vertex, wall));
      any = true;
    }
  }
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    for (const sBound of [wall.sMin, wall.sMax]) {
      const clipped = edgeSlabPoint(start, end, wall, sBound);
      if (!clipped) continue;
      min = Math.min(min, interiorSignedDistance(clipped, wall));
      any = true;
    }
  }
  if (!any || !Number.isFinite(min)) return null;
  return min;
}

export function overlapPenetration(
  vertices: readonly Vec2[],
  wall: PreparedCollisionWall,
): number {
  const distance = clippedMinInteriorDistance(vertices, wall);
  if (distance === null) return 0;
  return Math.max(0, -distance);
}

export function posePenetratesWalls(
  vertices: readonly Vec2[],
  walls: readonly PreparedCollisionWall[],
): boolean {
  return walls.some((wall) => overlapPenetration(vertices, wall) > NUMERICAL_DISTANCE_EPSILON);
}

/**
 * Swept translation of a convex XZ footprint against finite one-sided walls.
 * One-pass slide only. Exact flush contact is allowed.
 */
export function resolveSweptConvexTranslation(input: Readonly<{
  startVertices: readonly Vec2[];
  translation: Vec2;
  walls: readonly RoomCollisionEnabledWall[];
  allowSlide: boolean;
}>): CollisionTranslationResult {
  const prepared: PreparedCollisionWall[] = [];
  let skippedInvalidWallCount = 0;
  for (const wall of input.walls) {
    const ready = prepareCollisionWall(wall);
    if (ready) prepared.push(ready);
    else skippedInvalidWallCount += 1;
  }
  const translation = input.translation;
  if (!isFiniteVec(translation) || input.startVertices.length === 0) {
    return {
      translation: { x: 0, z: 0 },
      status: "accepted",
      contactWallIds: Object.freeze([]),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }
  if (prepared.length === 0) {
    return {
      translation,
      status: "accepted",
      contactWallIds: Object.freeze([]),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  const startOverlapping = posePenetratesWalls(input.startVertices, prepared);
  if (startOverlapping) {
    const proposedVertices = translateVertices(input.startVertices, translation);
    const deeper = prepared.some((wall) =>
      overlapPenetration(proposedVertices, wall) >
        overlapPenetration(input.startVertices, wall) + NUMERICAL_DISTANCE_EPSILON
    );
    if (deeper) {
      return {
        translation: { x: 0, z: 0 },
        status: "start_overlapping",
        contactWallIds: Object.freeze(overlappingWallIds(input.startVertices, prepared)),
        skippedInvalidWallCount,
        unresolvedOverlap: true,
      };
    }
    return {
      translation,
      status: "start_overlapping",
      contactWallIds: Object.freeze(overlappingWallIds(proposedVertices, prepared)),
      skippedInvalidWallCount,
      unresolvedOverlap: posePenetratesWalls(proposedVertices, prepared),
    };
  }

  if (lengthSquared(translation) <= MOTION_EPSILON_SQUARED) {
    return {
      translation,
      status: "accepted",
      contactWallIds: Object.freeze([]),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  const firstHit = findEarliestCrossing(input.startVertices, translation, prepared);
  if (!firstHit) {
    return {
      translation,
      status: "accepted",
      contactWallIds: Object.freeze([]),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  const toContact = scale(translation, firstHit.time);
  const firstContactIds = [firstHit.wall.id];
  if (!input.allowSlide) {
    return {
      translation: toContact,
      status: "stopped_at_contact",
      contactWallIds: Object.freeze(firstContactIds),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  const remaining = scale(translation, 1 - firstHit.time);
  const blocked = Math.min(0, dot(remaining, firstHit.wall.interiorNormal));
  const slideDelta = subtract(remaining, scale(firstHit.wall.interiorNormal, blocked));
  if (lengthSquared(slideDelta) <= MOTION_EPSILON_SQUARED) {
    return {
      translation: toContact,
      status: "stopped_at_contact",
      contactWallIds: Object.freeze(firstContactIds),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  const contactVertices = translateVertices(input.startVertices, toContact);
  const secondHit = findEarliestCrossing(contactVertices, slideDelta, prepared);
  if (!secondHit) {
    return {
      translation: add(toContact, slideDelta),
      status: "slid",
      contactWallIds: Object.freeze(firstContactIds),
      skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  return {
    translation: add(toContact, scale(slideDelta, secondHit.time)),
    status: "slid_then_stopped",
    contactWallIds: Object.freeze(
      [...new Set([...firstContactIds, secondHit.wall.id])].sort(),
    ),
    skippedInvalidWallCount,
    unresolvedOverlap: false,
  };
}

function findEarliestCrossing(
  vertices: readonly Vec2[],
  translation: Vec2,
  walls: readonly PreparedCollisionWall[],
): WallHit | null {
  let earliestTime = Number.POSITIVE_INFINITY;
  let earliestWall: PreparedCollisionWall | null = null;
  for (const wall of walls) {
    const time = earliestPlaneCrossingTime(vertices, translation, wall);
    if (time === null) continue;
    if (time < earliestTime - TIME_ORDER_EPSILON) {
      earliestTime = time;
      earliestWall = wall;
    } else if (
      Math.abs(time - earliestTime) <= TIME_ORDER_EPSILON &&
      earliestWall &&
      wall.id.localeCompare(earliestWall.id) < 0
    ) {
      earliestWall = wall;
    }
  }
  if (!earliestWall || !Number.isFinite(earliestTime) || earliestTime > 1) {
    return null;
  }
  return { wall: earliestWall, time: Math.min(1, Math.max(0, earliestTime)) };
}

function earliestPlaneCrossingTime(
  vertices: readonly Vec2[],
  translation: Vec2,
  wall: PreparedCollisionWall,
): number | null {
  const features = clipDistanceFeatures(vertices, translation, wall);
  let best: number | null = null;
  for (const feature of features) {
    const enter = feature.tEnter;
    const exit = feature.tExit;
    if (exit < -TIME_ORDER_EPSILON) continue;
    const t0 = Math.max(0, enter);
    const t1 = Math.min(1, exit);
    if (t1 < t0 - TIME_ORDER_EPSILON) continue;
    const time = firstNegativeTime(feature.a, feature.b, t0, t1);
    if (time === null) continue;
    if (best === null || time < best - TIME_ORDER_EPSILON) best = time;
  }
  return best;
}

function firstNegativeTime(
  a: number,
  b: number,
  t0: number,
  t1: number,
): number | null {
  const d0 = a + b * t0;
  const d1 = a + b * t1;
  if (d0 < -NUMERICAL_DISTANCE_EPSILON) {
    // Already exterior while active — one-sided wall does not cap from behind.
    return null;
  }
  if (d1 >= -NUMERICAL_DISTANCE_EPSILON) return null;
  if (Math.abs(b) <= DENOMINATOR_EPSILON) return null;
  const tZero = -a / b;
  if (!Number.isFinite(tZero)) return null;
  if (tZero < t0 - TIME_ORDER_EPSILON || tZero > t1 + TIME_ORDER_EPSILON) {
    return t0;
  }
  return Math.min(t1, Math.max(t0, tZero));
}

function clipDistanceFeatures(
  vertices: readonly Vec2[],
  translation: Vec2,
  wall: PreparedCollisionWall,
): LinearFeature[] {
  const sVel = wall.tangent.x * translation.x + wall.tangent.z * translation.z;
  const dVel = wall.interiorNormal.x * translation.x +
    wall.interiorNormal.z * translation.z;
  const features: LinearFeature[] = [];
  const coords = vertices.map((vertex) => ({
    s: wall.tangent.x * vertex.x + wall.tangent.z * vertex.z,
    d: interiorSignedDistance(vertex, wall),
  }));

  for (const point of coords) {
    const interval = activeInterval(point.s, sVel, wall.sMin, wall.sMax);
    if (!interval) continue;
    features.push({
      wallId: wall.id,
      a: point.d,
      b: dVel,
      tEnter: interval.enter,
      tExit: interval.exit,
    });
  }

  if (vertices.length < 2) return features;
  for (let index = 0; index < coords.length; index += 1) {
    const start = coords[index];
    const end = coords[(index + 1) % coords.length];
    const ds = end.s - start.s;
    if (Math.abs(ds) <= DENOMINATOR_EPSILON) continue;
    for (const sBound of [wall.sMin, wall.sMax]) {
      const a = start.d + ((sBound - start.s) / ds) * (end.d - start.d);
      const b = dVel - (sVel / ds) * (end.d - start.d);
      let tEnter: number;
      let tExit: number;
      if (Math.abs(sVel) <= DENOMINATOR_EPSILON) {
        const u = (sBound - start.s) / ds;
        if (u < 0 || u > 1) continue;
        tEnter = Number.NEGATIVE_INFINITY;
        tExit = Number.POSITIVE_INFINITY;
      } else {
        const tU0 = (sBound - start.s) / sVel;
        const tU1 = (sBound - end.s) / sVel;
        tEnter = Math.min(tU0, tU1);
        tExit = Math.max(tU0, tU1);
      }
      features.push({
        wallId: wall.id,
        a,
        b,
        tEnter,
        tExit,
      });
    }
  }
  return features;
}

function activeInterval(
  value0: number,
  velocity: number,
  min: number,
  max: number,
): { enter: number; exit: number } | null {
  if (Math.abs(velocity) <= DENOMINATOR_EPSILON) {
    if (value0 >= min && value0 <= max) {
      return { enter: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY };
    }
    return null;
  }
  let tMin = (min - value0) / velocity;
  let tMax = (max - value0) / velocity;
  if (tMin > tMax) {
    const swap = tMin;
    tMin = tMax;
    tMax = swap;
  }
  return { enter: tMin, exit: tMax };
}

function edgeSlabPoint(
  start: Vec2,
  end: Vec2,
  wall: PreparedCollisionWall,
  sBound: number,
): Vec2 | null {
  const s0 = wall.tangent.x * start.x + wall.tangent.z * start.z;
  const s1 = wall.tangent.x * end.x + wall.tangent.z * end.z;
  const ds = s1 - s0;
  if (Math.abs(ds) <= DENOMINATOR_EPSILON) return null;
  const u = (sBound - s0) / ds;
  if (u < 0 || u > 1) return null;
  return {
    x: start.x + (end.x - start.x) * u,
    z: start.z + (end.z - start.z) * u,
  };
}

function overlappingWallIds(
  vertices: readonly Vec2[],
  walls: readonly PreparedCollisionWall[],
): string[] {
  return walls
    .filter((wall) => overlapPenetration(vertices, wall) > NUMERICAL_DISTANCE_EPSILON)
    .map((wall) => wall.id)
    .sort();
}

function translateVertices(vertices: readonly Vec2[], translation: Vec2): Vec2[] {
  return vertices.map((vertex) => add(vertex, translation));
}

function isFiniteVec(value: Vec2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.z);
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

function scale(value: Vec2, scalar: number): Vec2 {
  return { x: value.x * scalar, z: value.z * scalar };
}

function lengthSquared(value: Vec2): number {
  return dot(value, value);
}
