/**
 * Realized production metric world from compact PI-2 authority.
 *
 * effectiveMetricScale = certified metricScale × roomScaleMultiplier.
 * That product is applied once to Floor, Camera pose, and collision walls.
 * Certified metricScale on the authority is not rewritten. FOV is not scaled.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import {
  frozenCameraSnapshotFromAuthority,
  realizeFrozenCamera,
} from "./frozen-camera";
import {
  realizeCollisionWalls,
  realizeFloorRectangle,
} from "./metric-world-realization";
import { persistedMetricScale } from "./runtime-authority";
import {
  ROOM_SCALE_DEFAULT,
  clampRoomScaleMultiplier,
  effectiveMetricScale,
} from "@/lib/vibode-stage/room-scale";
import type {
  CanonicalFloorRectangle,
  RealizedFrozenCamera,
  RuntimeCollisionWall,
} from "./types";

export type RealizedProductionWorld = Readonly<{
  generationId: string;
  /** Effective metric scale used by runtime consumers. */
  metricScale: number;
  certifiedMetricScale: number;
  roomScaleMultiplier: number;
  coordinateSpace: typeof authorityCoordinateSpace;
  floor: CanonicalFloorRectangle;
  camera: RealizedFrozenCamera;
  collisionWalls: readonly RuntimeCollisionWall[];
}>;

const authorityCoordinateSpace = "calibrated-world-xz/v1" as const;

export function realizeProductionWorld(
  authority: AfcV2ProductionRoomAuthority,
  roomScaleMultiplier: number = ROOM_SCALE_DEFAULT,
): RealizedProductionWorld {
  const certifiedMetricScale = persistedMetricScale(authority);
  const roomScale = clampRoomScaleMultiplier(roomScaleMultiplier);
  const metricScale = effectiveMetricScale(certifiedMetricScale, roomScale);
  return {
    generationId: authority.generationId,
    metricScale,
    certifiedMetricScale,
    roomScaleMultiplier: roomScale,
    coordinateSpace: authorityCoordinateSpace,
    floor: realizeFloorRectangle(
      {
        worldWidthM: authority.floor.worldWidthM,
        referenceDepthM: authority.floor.referenceDepthM,
      },
      metricScale,
    ),
    camera: realizeFrozenCamera(
      frozenCameraSnapshotFromAuthority(authority),
      metricScale,
    ),
    collisionWalls: realizeCollisionWalls(
      authority.collision.walls,
      metricScale,
    ),
  };
}
