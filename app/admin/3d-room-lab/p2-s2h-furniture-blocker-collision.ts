import type {
  CollisionSafeBlockerSegment,
} from "./p2-s2g-collision-safe-blocker-contract";

export type FurnitureBlockerPointXZ = Readonly<{
  x: number;
  z: number;
}>;

export type FurnitureBlockerFootprint = Readonly<{
  halfWidth: number;
  halfDepth: number;
  yawRad: number;
}>;

export type FurnitureBlockerResponseMode =
  | "drag_slide"
  | "stop_at_contact";

export type FurnitureBlockerTranslationInput = Readonly<{
  currentCenterXZ: FurnitureBlockerPointXZ;
  proposedCenterXZ: FurnitureBlockerPointXZ;
  footprint: FurnitureBlockerFootprint;
  blockers: readonly CollisionSafeBlockerSegment[];
  responseMode: FurnitureBlockerResponseMode;
}>;

export type FurnitureBlockerInvalidInputReason =
  | "non_finite_position"
  | "invalid_footprint"
  | "invalid_response_mode";

type FurnitureBlockerResolvedStatus =
  | "accepted"
  | "stopped_at_contact"
  | "slid"
  | "slid_then_stopped"
  | "start_overlapping";

export type FurnitureBlockerTranslationResult =
  | Readonly<{
      ok: true;
      status: FurnitureBlockerResolvedStatus;
      resolvedCenterXZ: FurnitureBlockerPointXZ;
      contactBlockerIds: readonly string[];
      skippedInvalidBlockerCount: number;
    }>
  | Readonly<{
      ok: false;
      status: "invalid_input";
      reason: FurnitureBlockerInvalidInputReason;
      resolvedCenterXZ: null;
      contactBlockerIds: readonly [];
      skippedInvalidBlockerCount: 0;
    }>;

type Vec2 = Readonly<{ x: number; z: number }>;

type Slab = Readonly<{
  axis: Vec2;
  min: number;
  max: number;
}>;

type ConfigurationObstacle = Readonly<{
  blockerId: string;
  inputIndex: number;
  slabs: readonly [Slab, Slab, Slab];
}>;

type ObstacleHit = Readonly<{
  obstacle: ConfigurationObstacle;
  time: number;
  normals: readonly Vec2[];
}>;

type EarliestHit = Readonly<{
  time: number;
  hits: readonly ObstacleHit[];
}>;

/*
 * These tolerances are only for near-zero arithmetic and equal-TOI ordering.
 * They never enlarge a slab, move an endpoint, merge blockers, or close a gap.
 */
const DENOMINATOR_EPSILON = 1e-12;
const TIME_ORDER_EPSILON = 1e-10;
const MOTION_EPSILON_SQUARED = 1e-24;

function isFinitePoint(point: FurnitureBlockerPointXZ): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
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

function toYawLocal(point: Vec2, cosine: number, sine: number): Vec2 {
  return {
    x: cosine * point.x + sine * point.z,
    z: -sine * point.x + cosine * point.z,
  };
}

function vectorToWorld(vector: Vec2, cosine: number, sine: number): Vec2 {
  return {
    x: cosine * vector.x - sine * vector.z,
    z: sine * vector.x + cosine * vector.z,
  };
}

function buildConfigurationObstacle(
  blocker: CollisionSafeBlockerSegment,
  inputIndex: number,
  halfWidth: number,
  halfDepth: number,
  cosine: number,
  sine: number
): ConfigurationObstacle | null {
  if (
    !blocker ||
    !blocker.a ||
    !blocker.b ||
    !Number.isFinite(blocker.a.x) ||
    !Number.isFinite(blocker.a.z) ||
    !Number.isFinite(blocker.b.x) ||
    !Number.isFinite(blocker.b.z) ||
    (blocker.a.x === blocker.b.x && blocker.a.z === blocker.b.z)
  ) {
    return null;
  }

  const a = toYawLocal(blocker.a, cosine, sine);
  const b = toYawLocal(blocker.b, cosine, sine);
  const segment = subtract(b, a);
  const segmentLength = Math.hypot(segment.x, segment.z);
  if (
    !isFinitePoint(a) ||
    !isFinitePoint(b) ||
    !Number.isFinite(segmentLength) ||
    segmentLength === 0
  ) {
    return null;
  }

  const segmentNormal = {
    x: -segment.z / segmentLength,
    z: segment.x / segmentLength,
  };
  const projectionA = dot(a, segmentNormal);
  const projectionB = dot(b, segmentNormal);
  const normalRadius =
    halfWidth * Math.abs(segmentNormal.x) +
    halfDepth * Math.abs(segmentNormal.z);
  const slabs: readonly [Slab, Slab, Slab] = [
    {
      axis: { x: 1, z: 0 },
      min: Math.min(a.x, b.x) - halfWidth,
      max: Math.max(a.x, b.x) + halfWidth,
    },
    {
      axis: { x: 0, z: 1 },
      min: Math.min(a.z, b.z) - halfDepth,
      max: Math.max(a.z, b.z) + halfDepth,
    },
    {
      axis: segmentNormal,
      min: Math.min(projectionA, projectionB) - normalRadius,
      max: Math.max(projectionA, projectionB) + normalRadius,
    },
  ];
  if (
    !slabs.every(slab =>
      isFinitePoint(slab.axis) &&
      Number.isFinite(slab.min) &&
      Number.isFinite(slab.max) &&
      slab.min <= slab.max
    )
  ) {
    return null;
  }

  return {
    blockerId:
      typeof blocker.id === "string"
        ? blocker.id
        : `invalid-runtime-blocker:${inputIndex}`,
    inputIndex,
    slabs,
  };
}

function isStrictlyInsideObstacle(
  point: Vec2,
  obstacle: ConfigurationObstacle
): boolean {
  return obstacle.slabs.every(slab => {
    const projection = dot(point, slab.axis);
    return projection > slab.min && projection < slab.max;
  });
}

function pushDistinctNormal(normals: Vec2[], candidate: Vec2): void {
  if (
    normals.some(normal =>
      Math.abs(normal.x - candidate.x) <= DENOMINATOR_EPSILON &&
      Math.abs(normal.z - candidate.z) <= DENOMINATOR_EPSILON
    )
  ) {
    return;
  }
  normals.push(candidate);
}

function sweepObstacle(
  start: Vec2,
  delta: Vec2,
  obstacle: ConfigurationObstacle
): ObstacleHit | null {
  let entryTime = Number.NEGATIVE_INFINITY;
  let exitTime = Number.POSITIVE_INFINITY;
  let entryNormals: Vec2[] = [];

  for (const slab of obstacle.slabs) {
    const startProjection = dot(start, slab.axis);
    const projectedVelocity = dot(delta, slab.axis);
    if (Math.abs(projectedVelocity) <= DENOMINATOR_EPSILON) {
      if (startProjection < slab.min || startProjection > slab.max) {
        return null;
      }
      continue;
    }

    const timeAtMin = (slab.min - startProjection) / projectedVelocity;
    const timeAtMax = (slab.max - startProjection) / projectedVelocity;
    const entersAtMin = timeAtMin <= timeAtMax;
    const slabEntry = entersAtMin ? timeAtMin : timeAtMax;
    const slabExit = entersAtMin ? timeAtMax : timeAtMin;
    const entryNormal = entersAtMin
      ? { x: -slab.axis.x, z: -slab.axis.z }
      : slab.axis;

    if (slabEntry > entryTime + TIME_ORDER_EPSILON) {
      entryTime = slabEntry;
      entryNormals = [entryNormal];
    } else if (Math.abs(slabEntry - entryTime) <= TIME_ORDER_EPSILON) {
      pushDistinctNormal(entryNormals, entryNormal);
    }
    exitTime = Math.min(exitTime, slabExit);
    if (entryTime > exitTime) return null;
  }

  const clippedEntry = Math.max(0, entryTime);
  const clippedExit = Math.min(1, exitTime);
  if (
    !Number.isFinite(clippedEntry) ||
    !Number.isFinite(clippedExit) ||
    clippedEntry < 0 ||
    clippedEntry > 1 ||
    clippedExit <= clippedEntry
  ) {
    return null;
  }

  /*
   * Contact blocks only when the trajectory enters the obstacle interior.
   * This permits exact tangential travel and point-only endpoint grazing.
   */
  const interiorProbeTime = clippedEntry + (clippedExit - clippedEntry) * 0.5;
  const interiorProbe = add(start, scale(delta, interiorProbeTime));
  if (!isStrictlyInsideObstacle(interiorProbe, obstacle)) return null;

  return {
    obstacle,
    time: clippedEntry,
    normals: entryNormals,
  };
}

function compareHits(a: ObstacleHit, b: ObstacleHit): number {
  const idOrder = a.obstacle.blockerId.localeCompare(b.obstacle.blockerId);
  if (idOrder !== 0) return idOrder;
  return a.obstacle.inputIndex - b.obstacle.inputIndex;
}

function findEarliestHit(
  start: Vec2,
  delta: Vec2,
  obstacles: readonly ConfigurationObstacle[]
): EarliestHit | null {
  let earliestTime = Number.POSITIVE_INFINITY;
  let hits: ObstacleHit[] = [];
  for (const obstacle of obstacles) {
    const hit = sweepObstacle(start, delta, obstacle);
    if (!hit) continue;
    if (hit.time < earliestTime - TIME_ORDER_EPSILON) {
      earliestTime = hit.time;
      hits = [hit];
    } else if (Math.abs(hit.time - earliestTime) <= TIME_ORDER_EPSILON) {
      hits.push(hit);
    }
  }
  if (hits.length === 0) return null;
  hits.sort(compareHits);
  return { time: earliestTime, hits };
}

function distinctContactIds(hits: readonly ObstacleHit[]): string[] {
  return [...new Set(hits.map(hit => hit.obstacle.blockerId))].sort();
}

function selectPrimaryNormal(
  hits: readonly ObstacleHit[],
  remainingDelta: Vec2
): Vec2 | null {
  let selected: Vec2 | null = null;
  let selectedDot = 0;
  for (const hit of hits) {
    for (const normal of hit.normals) {
      const normalMotion = dot(remainingDelta, normal);
      if (normalMotion < selectedDot) {
        selected = normal;
        selectedDot = normalMotion;
      }
    }
  }
  return selected;
}

function addLocalMovementToWorld(
  origin: FurnitureBlockerPointXZ,
  localMovement: Vec2,
  cosine: number,
  sine: number
): FurnitureBlockerPointXZ {
  const worldMovement = vectorToWorld(localMovement, cosine, sine);
  return {
    x: origin.x + worldMovement.x,
    z: origin.z + worldMovement.z,
  };
}

function invalidResult(
  reason: FurnitureBlockerInvalidInputReason
): FurnitureBlockerTranslationResult {
  return {
    ok: false,
    status: "invalid_input",
    reason,
    resolvedCenterXZ: null,
    contactBlockerIds: [],
    skippedInvalidBlockerCount: 0,
  };
}

/**
 * Sweeps a fixed-yaw rectangular furniture footprint against exact finite S2G
 * blockers. Configuration obstacles are temporary solver values only.
 */
export function resolveSweptFurnitureBlockerTranslation(
  input: FurnitureBlockerTranslationInput
): FurnitureBlockerTranslationResult {
  const {
    currentCenterXZ,
    proposedCenterXZ,
    footprint,
    blockers,
    responseMode,
  } = input;
  if (!isFinitePoint(currentCenterXZ) || !isFinitePoint(proposedCenterXZ)) {
    return invalidResult("non_finite_position");
  }
  if (
    !footprint ||
    !Number.isFinite(footprint.halfWidth) ||
    !Number.isFinite(footprint.halfDepth) ||
    !Number.isFinite(footprint.yawRad) ||
    footprint.halfWidth <= 0 ||
    footprint.halfDepth <= 0
  ) {
    return invalidResult("invalid_footprint");
  }
  if (
    responseMode !== "drag_slide" &&
    responseMode !== "stop_at_contact"
  ) {
    return invalidResult("invalid_response_mode");
  }
  if (blockers.length === 0) {
    return {
      ok: true,
      status: "accepted",
      resolvedCenterXZ: proposedCenterXZ,
      contactBlockerIds: [],
      skippedInvalidBlockerCount: 0,
    };
  }

  const cosine = Math.cos(footprint.yawRad);
  const sine = Math.sin(footprint.yawRad);
  if (!Number.isFinite(cosine) || !Number.isFinite(sine)) {
    return invalidResult("invalid_footprint");
  }
  const obstacles: ConfigurationObstacle[] = [];
  let skippedInvalidBlockerCount = 0;
  blockers.forEach((blocker, inputIndex) => {
    const obstacle = buildConfigurationObstacle(
      blocker,
      inputIndex,
      footprint.halfWidth,
      footprint.halfDepth,
      cosine,
      sine
    );
    if (obstacle) {
      obstacles.push(obstacle);
    } else {
      skippedInvalidBlockerCount += 1;
    }
  });
  if (obstacles.length === 0) {
    return {
      ok: true,
      status: "accepted",
      resolvedCenterXZ: proposedCenterXZ,
      contactBlockerIds: [],
      skippedInvalidBlockerCount,
    };
  }

  const startLocal = toYawLocal(currentCenterXZ, cosine, sine);
  const proposedLocal = toYawLocal(proposedCenterXZ, cosine, sine);
  const attemptedDelta = subtract(proposedLocal, startLocal);
  const overlapping = obstacles
    .filter(obstacle => isStrictlyInsideObstacle(startLocal, obstacle))
    .map(obstacle => obstacle.blockerId)
    .sort();
  if (overlapping.length > 0) {
    return {
      ok: true,
      status: "start_overlapping",
      resolvedCenterXZ: currentCenterXZ,
      contactBlockerIds: [...new Set(overlapping)],
      skippedInvalidBlockerCount,
    };
  }
  if (lengthSquared(attemptedDelta) <= MOTION_EPSILON_SQUARED) {
    return {
      ok: true,
      status: "accepted",
      resolvedCenterXZ: proposedCenterXZ,
      contactBlockerIds: [],
      skippedInvalidBlockerCount,
    };
  }

  const firstHit = findEarliestHit(startLocal, attemptedDelta, obstacles);
  if (!firstHit) {
    return {
      ok: true,
      status: "accepted",
      resolvedCenterXZ: proposedCenterXZ,
      contactBlockerIds: [],
      skippedInvalidBlockerCount,
    };
  }

  const movementToFirstContact = scale(attemptedDelta, firstHit.time);
  const firstContactWorld = addLocalMovementToWorld(
    currentCenterXZ,
    movementToFirstContact,
    cosine,
    sine
  );
  const firstContactIds = distinctContactIds(firstHit.hits);
  if (responseMode === "stop_at_contact") {
    return {
      ok: true,
      status: "stopped_at_contact",
      resolvedCenterXZ: firstContactWorld,
      contactBlockerIds: firstContactIds,
      skippedInvalidBlockerCount,
    };
  }

  const remainingDelta = scale(attemptedDelta, 1 - firstHit.time);
  const primaryNormal = selectPrimaryNormal(firstHit.hits, remainingDelta);
  if (!primaryNormal) {
    return {
      ok: true,
      status: "stopped_at_contact",
      resolvedCenterXZ: firstContactWorld,
      contactBlockerIds: firstContactIds,
      skippedInvalidBlockerCount,
    };
  }
  const blockedNormalMotion = Math.min(0, dot(remainingDelta, primaryNormal));
  const slideDelta = subtract(
    remainingDelta,
    scale(primaryNormal, blockedNormalMotion)
  );
  const simultaneousNormals = firstHit.hits.flatMap(hit => hit.normals);
  if (
    lengthSquared(slideDelta) <= MOTION_EPSILON_SQUARED ||
    simultaneousNormals.some(normal =>
      dot(slideDelta, normal) < -DENOMINATOR_EPSILON
    )
  ) {
    return {
      ok: true,
      status: "stopped_at_contact",
      resolvedCenterXZ: firstContactWorld,
      contactBlockerIds: firstContactIds,
      skippedInvalidBlockerCount,
    };
  }

  const firstContactLocal = add(startLocal, movementToFirstContact);
  const secondHit = findEarliestHit(firstContactLocal, slideDelta, obstacles);
  if (!secondHit) {
    const resolvedCenterXZ = addLocalMovementToWorld(
      firstContactWorld,
      slideDelta,
      cosine,
      sine
    );
    return {
      ok: true,
      status: "slid",
      resolvedCenterXZ,
      contactBlockerIds: firstContactIds,
      skippedInvalidBlockerCount,
    };
  }

  const movementToSecondContact = scale(slideDelta, secondHit.time);
  const resolvedCenterXZ = addLocalMovementToWorld(
    firstContactWorld,
    movementToSecondContact,
    cosine,
    sine
  );
  const contactBlockerIds = [
    ...new Set([
      ...firstContactIds,
      ...distinctContactIds(secondHit.hits),
    ]),
  ].sort();
  return {
    ok: true,
    status: "slid_then_stopped",
    resolvedCenterXZ,
    contactBlockerIds,
    skippedInvalidBlockerCount,
  };
}
