/**
 * V2-local metric realization. Maps frozen canonical projective authority
 * into the realized runtime world:
 *
 *   canonicalProjectiveRealization × metricScale = realizedMetricRuntime
 *
 * World Scale does not rewrite Floor/Camera receipts, S4 qualification,
 * authored object size, local AABB, Y, rotation, or user uniformScale.
 */

import type {
  RoomBoundaryWallBaseDiagnostic,
} from "./room-boundary-authority-contract";
import type {
  RoomCollisionEnabledWall,
  RoomCollisionWallDiagnostic,
} from "./room-collision-authority-contract";
import {
  aabbIsValid,
  type LocalAabb,
} from "./room-collision-footprint";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import type {
  SceneLayerState,
  SceneObjectRecord,
  WorldTransform,
} from "./scene-layer-state";

export const AUTO_METRIC_SCALE = 1;
export const USER_WORLD_SCALE_MIN = 0.5;
export const USER_WORLD_SCALE_MAX = 2;
export const USER_WORLD_SCALE_STEP = 0.01;
export const USER_WORLD_SCALE_DEFAULT = 1;
export const METRIC_REALIZATION_SOURCE_COORDINATE_SPACE =
  "calibrated-world-xz/v1" as const;

export type MetricRealizationMetadata = Readonly<{
  metricScale: number;
  autoMetricScale: number;
  userWorldScale: number;
  sourceCoordinateSpace: typeof METRIC_REALIZATION_SOURCE_COORDINATE_SPACE;
}>;

export type CanonicalFloorRectangle = Readonly<{
  worldWidthM: number;
  referenceDepthM: number;
}>;

export type CameraPose = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>;
  lookAt: Readonly<{ x: number; y: number; z: number }>;
  up: Readonly<{ x: number; y: number; z: number }>;
}>;

export function clampUserWorldScale(value: number): number {
  if (!Number.isFinite(value)) return USER_WORLD_SCALE_DEFAULT;
  return Math.max(USER_WORLD_SCALE_MIN, Math.min(USER_WORLD_SCALE_MAX, value));
}

export function computeMetricScale(
  autoMetricScale: number,
  userWorldScale: number,
): number {
  const auto = Number.isFinite(autoMetricScale) && autoMetricScale > 0
    ? autoMetricScale
    : AUTO_METRIC_SCALE;
  return auto * clampUserWorldScale(userWorldScale);
}

export function createMetricRealizationMetadata(input: Readonly<{
  autoMetricScale?: number;
  userWorldScale: number;
}>): MetricRealizationMetadata {
  const autoMetricScale = Number.isFinite(input.autoMetricScale)
    ? input.autoMetricScale as number
    : AUTO_METRIC_SCALE;
  const userWorldScale = clampUserWorldScale(input.userWorldScale);
  return {
    metricScale: computeMetricScale(autoMetricScale, userWorldScale),
    autoMetricScale,
    userWorldScale,
    sourceCoordinateSpace: METRIC_REALIZATION_SOURCE_COORDINATE_SPACE,
  };
}

export function realizeFloorRectangle(
  floor: CanonicalFloorRectangle,
  metricScale: number,
): CanonicalFloorRectangle {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) {
    return {
      worldWidthM: floor.worldWidthM,
      referenceDepthM: floor.referenceDepthM,
    };
  }
  return {
    worldWidthM: floor.worldWidthM * scale,
    referenceDepthM: floor.referenceDepthM * scale,
  };
}

export function realizeCameraPose(
  pose: CameraPose,
  metricScale: number,
): CameraPose {
  const scale = finitePositiveScale(metricScale);
  return {
    position: scaleVec3(pose.position, scale),
    lookAt: scaleVec3(pose.lookAt, scale),
    up: { x: pose.up.x, y: pose.up.y, z: pose.up.z },
  };
}

export function realizeCollisionWall(
  wall: RoomCollisionEnabledWall,
  metricScale: number,
): RoomCollisionEnabledWall {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return wall;
  return {
    id: wall.id,
    sourceBoundaryId: wall.sourceBoundaryId,
    sourceSeamId: wall.sourceSeamId,
    a: scaleXz(wall.a, scale),
    b: scaleXz(wall.b, scale),
    supportPlaneNormal: {
      x: wall.supportPlaneNormal.x,
      y: wall.supportPlaneNormal.y,
      z: wall.supportPlaneNormal.z,
    },
    supportPlaneConstant: wall.supportPlaneConstant * scale,
    sideSign: wall.sideSign,
  };
}

export function realizeCollisionWalls(
  walls: readonly RoomCollisionEnabledWall[],
  metricScale: number,
): readonly RoomCollisionEnabledWall[] {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return walls;
  return walls.map((wall) => realizeCollisionWall(wall, scale));
}

export function realizeCollisionWallDiagnostic(
  segment: RoomCollisionWallDiagnostic,
  metricScale: number,
): RoomCollisionWallDiagnostic {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return segment;
  return {
    id: segment.id,
    sourceSeamId: segment.sourceSeamId,
    start: realizeXzKeepingY(segment.start, scale),
    end: realizeXzKeepingY(segment.end, scale),
  };
}

export function realizeCollisionWallDiagnostics(
  diagnostics: readonly RoomCollisionWallDiagnostic[],
  metricScale: number,
): readonly RoomCollisionWallDiagnostic[] {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return diagnostics;
  return diagnostics.map((segment) =>
    realizeCollisionWallDiagnostic(segment, scale)
  );
}

export function realizeWallBaseDiagnostic(
  segment: RoomBoundaryWallBaseDiagnostic,
  metricScale: number,
): RoomBoundaryWallBaseDiagnostic {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return segment;
  return {
    id: segment.id,
    sourceSeamId: segment.sourceSeamId,
    start: realizeXzKeepingY(segment.start, scale),
    end: realizeXzKeepingY(segment.end, scale),
    interiorTick: segment.interiorTick
      ? realizeInteriorTick(segment.interiorTick, scale)
      : null,
  };
}

export function realizeWallBaseDiagnostics(
  diagnostics: readonly RoomBoundaryWallBaseDiagnostic[],
  metricScale: number,
): readonly RoomBoundaryWallBaseDiagnostic[] {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return diagnostics;
  return diagnostics.map((segment) => realizeWallBaseDiagnostic(segment, scale));
}

export function realizeObjectWorldTransform(
  transform: WorldTransform,
  metricScale: number,
): WorldTransform {
  const scale = finitePositiveScale(metricScale);
  return {
    position: {
      x: transform.position.x * scale,
      y: transform.position.y,
      z: transform.position.z * scale,
    },
    rotationDeg: {
      x: transform.rotationDeg.x,
      y: transform.rotationDeg.y,
      z: transform.rotationDeg.z,
    },
    uniformScale: transform.uniformScale,
  };
}

export function canonicalizeObjectWorldTransform(
  realized: WorldTransform,
  metricScale: number,
): WorldTransform {
  const scale = finitePositiveScale(metricScale);
  return {
    position: {
      x: realized.position.x / scale,
      y: realized.position.y,
      z: realized.position.z / scale,
    },
    rotationDeg: {
      x: realized.rotationDeg.x,
      y: realized.rotationDeg.y,
      z: realized.rotationDeg.z,
    },
    uniformScale: realized.uniformScale,
  };
}

export function displayedXzFromCanonical(
  canonical: number,
  metricScale: number,
): number {
  return canonical * finitePositiveScale(metricScale);
}

export function canonicalXzFromDisplayed(
  displayed: number,
  metricScale: number,
): number {
  return displayed / finitePositiveScale(metricScale);
}

export function realizeXzKeepingY(
  point: readonly [number, number, number],
  metricScale: number,
): readonly [number, number, number] {
  const scale = finitePositiveScale(metricScale);
  return [point[0] * scale, point[1], point[2] * scale];
}

export function realizeInteriorTick(
  tick: Readonly<{
    from: readonly [number, number, number];
    to: readonly [number, number, number];
  }>,
  metricScale: number,
): Readonly<{
  from: readonly [number, number, number];
  to: readonly [number, number, number];
}> {
  const from = realizeXzKeepingY(tick.from, metricScale);
  return {
    from,
    to: [
      from[0] + (tick.to[0] - tick.from[0]),
      from[1] + (tick.to[1] - tick.from[1]),
      from[2] + (tick.to[2] - tick.from[2]),
    ],
  };
}

/**
 * Host collision path: canonical current/proposed → realize → resolve in
 * realized metres → canonicalize X/Z back into scene state.
 */
export function resolveCanonicalTransformInRealizedWorld(input: Readonly<{
  currentCanonical: WorldTransform;
  proposedCanonical: WorldTransform;
  localAabb: LocalAabb | null;
  canonicalWalls: readonly RoomCollisionEnabledWall[];
  metricScale: number;
  mode: "move" | "pose";
}>): WorldTransform {
  const scale = finitePositiveScale(input.metricScale);
  const resolved = resolveSceneObjectCollision({
    current: realizeObjectWorldTransform(input.currentCanonical, scale),
    proposed: realizeObjectWorldTransform(input.proposedCanonical, scale),
    localAabb: input.localAabb,
    walls: realizeCollisionWalls(input.canonicalWalls, scale),
    mode: input.mode,
  });
  return canonicalizeObjectWorldTransform(resolved.transform, scale);
}

/**
 * Scale-down only. Scaling up leaves canonical X/Z unchanged (gaps allowed).
 * When the Model C pivot would penetrate newly closer walls, the existing
 * swept resolver is used. Object size is never changed to avoid collision.
 */
export function correctSceneLayerForWorldScaleChange(input: Readonly<{
  state: SceneLayerState;
  previousMetricScale: number;
  nextMetricScale: number;
  canonicalWalls: readonly RoomCollisionEnabledWall[];
  localAabbFor: (object: SceneObjectRecord) => LocalAabb | null;
}>): SceneLayerState {
  const previous = finitePositiveScale(input.previousMetricScale);
  const next = finitePositiveScale(input.nextMetricScale);
  if (!(next < previous) || input.state.objects.length === 0) {
    return input.state;
  }
  let changed = false;
  const objects = input.state.objects.map((object) => {
    const corrected = correctCanonicalTransformForScaleDown({
      canonical: object.transform,
      previousMetricScale: previous,
      nextMetricScale: next,
      canonicalWalls: input.canonicalWalls,
      localAabb: input.localAabbFor(object),
    });
    if (transformsEqual(object.transform, corrected)) return object;
    changed = true;
    return { ...object, transform: corrected };
  });
  if (!changed) return input.state;
  return { ...input.state, objects };
}

export function correctCanonicalTransformForScaleDown(input: Readonly<{
  canonical: WorldTransform;
  previousMetricScale: number;
  nextMetricScale: number;
  canonicalWalls: readonly RoomCollisionEnabledWall[];
  localAabb: LocalAabb | null;
}>): WorldTransform {
  const previous = finitePositiveScale(input.previousMetricScale);
  const next = finitePositiveScale(input.nextMetricScale);
  if (!(next < previous)) return input.canonical;
  if (!aabbIsValid(input.localAabb) || input.canonicalWalls.length === 0) {
    return input.canonical;
  }
  const realizedWalls = realizeCollisionWalls(input.canonicalWalls, next);
  const previousRealized = realizeObjectWorldTransform(input.canonical, previous);
  const proposedRealized = realizeObjectWorldTransform(input.canonical, next);
  if (realizedPoseIsClear(proposedRealized, input.localAabb, realizedWalls)) {
    return input.canonical;
  }
  const fromPrevious = resolveSceneObjectCollision({
    current: previousRealized,
    proposed: proposedRealized,
    localAabb: input.localAabb,
    walls: realizedWalls,
    mode: "move",
  });
  if (
    realizedPoseIsClear(fromPrevious.transform, input.localAabb, realizedWalls)
  ) {
    return preserveNonXz(input.canonical, fromPrevious.transform, next);
  }
  const interiorStart: WorldTransform = {
    ...proposedRealized,
    position: {
      x: 0,
      y: proposedRealized.position.y,
      z: 0,
    },
  };
  if (realizedPoseIsClear(interiorStart, input.localAabb, realizedWalls)) {
    const fromInterior = resolveSceneObjectCollision({
      current: interiorStart,
      proposed: proposedRealized,
      localAabb: input.localAabb,
      walls: realizedWalls,
      mode: "move",
    });
    if (
      realizedPoseIsClear(fromInterior.transform, input.localAabb, realizedWalls)
    ) {
      return preserveNonXz(input.canonical, fromInterior.transform, next);
    }
  }
  return preserveNonXz(input.canonical, fromPrevious.transform, next);
}

function realizedPoseIsClear(
  realized: WorldTransform,
  localAabb: LocalAabb,
  walls: readonly RoomCollisionEnabledWall[],
): boolean {
  const result = resolveSceneObjectCollision({
    current: realized,
    proposed: realized,
    localAabb,
    walls,
    mode: "move",
  });
  return !result.unresolvedOverlap;
}

function preserveNonXz(
  canonical: WorldTransform,
  realizedResolved: WorldTransform,
  nextMetricScale: number,
): WorldTransform {
  const canonicalized = canonicalizeObjectWorldTransform(realizedResolved, nextMetricScale);
  return {
    position: {
      x: canonicalized.position.x,
      y: canonical.position.y,
      z: canonicalized.position.z,
    },
    rotationDeg: { ...canonical.rotationDeg },
    uniformScale: canonical.uniformScale,
  };
}

function transformsEqual(left: WorldTransform, right: WorldTransform): boolean {
  return left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.position.z === right.position.z &&
    left.rotationDeg.x === right.rotationDeg.x &&
    left.rotationDeg.y === right.rotationDeg.y &&
    left.rotationDeg.z === right.rotationDeg.z &&
    left.uniformScale === right.uniformScale;
}

function finitePositiveScale(metricScale: number): number {
  return Number.isFinite(metricScale) && metricScale > 0 ? metricScale : 1;
}

function scaleXz(
  point: Readonly<{ x: number; z: number }>,
  scale: number,
): { x: number; z: number } {
  return { x: point.x * scale, z: point.z * scale };
}

function scaleVec3(
  point: Readonly<{ x: number; y: number; z: number }>,
  scale: number,
): { x: number; y: number; z: number } {
  return {
    x: point.x * scale,
    y: point.y * scale,
    z: point.z * scale,
  };
}
