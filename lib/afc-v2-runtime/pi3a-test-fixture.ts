import {
  AFC_V2_PRODUCTION_COORDINATE_SPACE,
  AFC_V2_PRODUCTION_READINESS,
  AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  type AfcV2ProductionRoomAuthority,
} from "@/lib/afc-v2-production/production-authority-contract";

import type { RuntimeCollisionWall } from "./types";

export const PI3A_ROOM_ID = "11111111-1111-4111-8111-111111111111";
export const PI3A_GENERATION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PI3A_GENERATION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const PI3A_RIGHT_WALL: RuntimeCollisionWall = Object.freeze({
  id: "rb_right",
  sourceBoundaryId: "rb_right",
  sourceSeamId: "right_floor_wall",
  a: Object.freeze({ x: 1, z: -2 }),
  b: Object.freeze({ x: 1, z: 2 }),
  supportPlaneNormal: Object.freeze({ x: 1, y: 0, z: 0 }),
  supportPlaneConstant: -1,
  sideSign: -1,
});

export const PI3A_REAR_WALL: RuntimeCollisionWall = Object.freeze({
  id: "rb_back",
  sourceBoundaryId: "rb_back",
  sourceSeamId: "back_floor_wall",
  a: Object.freeze({ x: -2, z: -2 }),
  b: Object.freeze({ x: 2, z: -2 }),
  supportPlaneNormal: Object.freeze({ x: 0, y: 0, z: -1 }),
  supportPlaneConstant: -2,
  sideSign: -1,
});

export function createPi3aAuthority(input: Readonly<{
  generationId?: string;
  metricScale?: number;
  walls?: readonly RuntimeCollisionWall[];
  verticalFovDeg?: number;
  pose?: AfcV2ProductionRoomAuthority["frozenCamera"]["pose"];
  frame?: Readonly<{ width: number; height: number }>;
  floor?: Readonly<{ worldWidthM: number; referenceDepthM: number }>;
}> = {}): AfcV2ProductionRoomAuthority {
  const frame = input.frame ?? { width: 1200, height: 800 };
  const pose = input.pose ?? {
    position: { x: 0, y: 1.6, z: 4 },
    lookAt: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };
  const floor = input.floor ?? { worldWidthM: 6, referenceDepthM: 4 };
  const metricScale = input.metricScale ?? 1;
  return Object.freeze({
    schemaVersion: AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
    engineVersions: Object.freeze({
      liveProduct: "afc-sr1-complete-product-attempt/v2" as const,
      autoMetric: "afc-v2-auto-metric-scale/v1" as const,
      cameraCalibration: "calibrated-camera/v2" as const,
      cameraAuthority: "calibrated-camera-applied-authority/v1" as const,
      collision: "afc-v2-room-collision-authority/v1" as const,
      emptyAuthoritativeCollision:
        "afc-v2-empty-authoritative-collision-authority/v1" as const,
    }),
    generationId: input.generationId ?? PI3A_GENERATION_A,
    runId: "run-pi3a",
    createdAt: "2026-09-09T00:00:00.000Z",
    status: "ready",
    readiness: AFC_V2_PRODUCTION_READINESS,
    original: Object.freeze({
      sha256: "a".repeat(64),
      decodedWidth: frame.width,
      decodedHeight: frame.height,
      orientation: 1 as const,
    }),
    empty: Object.freeze({
      sha256: "b".repeat(64),
      decodedWidth: frame.width,
      decodedHeight: frame.height,
      orientation: 1 as const,
      artifactSource: "durable" as const,
    }),
    tiled: Object.freeze({
      sha256: "c".repeat(64),
      decodedWidth: frame.width,
      decodedHeight: frame.height,
      orientation: 1 as const,
      artifactSource: "durable" as const,
      cacheKey: "tiled-cache",
      forceRegeneration: false,
      readerVersion: null,
    }),
    frame: Object.freeze({ ...frame }),
    floor: Object.freeze({
      authorityKey: "floor-pi3a",
      sourceNormalizedPolygon: Object.freeze([
        Object.freeze({ x: 0.1, y: 0.9 }),
        Object.freeze({ x: 0.9, y: 0.9 }),
        Object.freeze({ x: 0.7, y: 0.55 }),
        Object.freeze({ x: 0.3, y: 0.55 }),
      ]),
      worldWidthM: floor.worldWidthM,
      referenceDepthM: floor.referenceDepthM,
      widthDepthRatio: floor.worldWidthM / floor.referenceDepthM,
    }),
    frozenCamera: Object.freeze({
      applied: true as const,
      verticalFovDeg: input.verticalFovDeg ?? 52,
      pose: Object.freeze({
        position: Object.freeze({ ...pose.position }),
        lookAt: Object.freeze({ ...pose.lookAt }),
        up: Object.freeze({ ...pose.up }),
      }),
      frame: Object.freeze({ ...frame }),
      originalBasisRestored: true as const,
      calibrationVersion: "calibrated-camera/v2" as const,
      solver: "homography-planar-cv/v1" as const,
      authorityVersion: "calibrated-camera-applied-authority/v1" as const,
    }),
    coordinateSpace: AFC_V2_PRODUCTION_COORDINATE_SPACE,
    collision: Object.freeze({
      source: "s4b" as const,
      collisionAuthority: true,
      walls: Object.freeze((input.walls ?? [PI3A_RIGHT_WALL]).map((wall) =>
        Object.freeze({
          ...wall,
          a: Object.freeze({ ...wall.a }),
          b: Object.freeze({ ...wall.b }),
          supportPlaneNormal: Object.freeze({ ...wall.supportPlaneNormal }),
        }),
      )),
    }),
    metric: Object.freeze({
      autoMetricScale: metricScale,
      metricScale,
      accepted: true,
      path: "none" as const,
      authority: "none" as const,
      fallbackApplied: false,
    }),
    recovery: Object.freeze({
      safeFailureState: "none" as const,
    }),
  });
}
