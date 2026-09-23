/**
 * Production metric world realization.
 *
 *   canonicalProjectiveRealization × metricScale = realizedMetricRuntime
 *
 * metricScale is persisted PI-2 authority. It is applied exactly once.
 * This path does not recompute scale and has no 2D physical-scale inputs.
 */

import type { RuntimeCollisionWall } from "./types";
import type {
  CameraPose,
  CanonicalFloorRectangle,
  WorldTransform,
} from "./types";

export const METRIC_REALIZATION_SOURCE_COORDINATE_SPACE =
  "calibrated-world-xz/v1" as const;

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
  wall: RuntimeCollisionWall,
  metricScale: number,
): RuntimeCollisionWall {
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
  walls: readonly RuntimeCollisionWall[],
  metricScale: number,
): readonly RuntimeCollisionWall[] {
  const scale = finitePositiveScale(metricScale);
  if (scale === 1) return walls;
  return walls.map((wall) => realizeCollisionWall(wall, scale));
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
