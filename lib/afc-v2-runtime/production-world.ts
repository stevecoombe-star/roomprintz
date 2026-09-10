/**
 * Realized production metric world from compact PI-2 authority.
 *
 * Applies persisted metricScale exactly once to Floor, Camera pose, and
 * collision walls. Does not recompute metric scale.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import { realizeFrozenCameraFromAuthority } from "./frozen-camera";
import {
  realizeCollisionWalls,
  realizeFloorRectangle,
} from "./metric-world-realization";
import { persistedMetricScale } from "./runtime-authority";
import type {
  CanonicalFloorRectangle,
  RealizedFrozenCamera,
  RuntimeCollisionWall,
} from "./types";

export type RealizedProductionWorld = Readonly<{
  generationId: string;
  metricScale: number;
  coordinateSpace: typeof authorityCoordinateSpace;
  floor: CanonicalFloorRectangle;
  camera: RealizedFrozenCamera;
  collisionWalls: readonly RuntimeCollisionWall[];
}>;

const authorityCoordinateSpace = "calibrated-world-xz/v1" as const;

export function realizeProductionWorld(
  authority: AfcV2ProductionRoomAuthority,
): RealizedProductionWorld {
  const metricScale = persistedMetricScale(authority);
  return {
    generationId: authority.generationId,
    metricScale,
    coordinateSpace: authorityCoordinateSpace,
    floor: realizeFloorRectangle(
      {
        worldWidthM: authority.floor.worldWidthM,
        referenceDepthM: authority.floor.referenceDepthM,
      },
      metricScale,
    ),
    camera: realizeFrozenCameraFromAuthority(authority),
    collisionWalls: realizeCollisionWalls(
      authority.collision.walls,
      metricScale,
    ),
  };
}
