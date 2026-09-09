/**
 * Compact production AFC room authority.
 *
 * Built by whitelist from a certified `executeAfcV2Analysis()` applied
 * result. Never constructed by deleting fields from the Lab payload.
 */

import {
  AFC_SR1_LIVE_PRODUCT_VERSION,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "@/app/admin/3d-room-lab/calibrated-camera-applied-authority";
import type { AfcV2AnalyzeResult } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION } from "@/app/admin/3d-room-lab-v2/empty-authoritative-collision-authority-contract";
import {
  AFC_V2_AUTO_METRIC_SCALE_VERSION,
  type AutoMetricScaleAuthority,
} from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import { AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE } from "@/app/admin/3d-room-lab-v2/room-boundary-authority-contract";
import { AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION } from "@/app/admin/3d-room-lab-v2/room-collision-authority-contract";
import type { RoomCollisionEnabledWall } from "@/app/admin/3d-room-lab-v2/room-collision-authority-contract";
import type { ActiveRuntimeCollisionSource } from "@/app/admin/3d-room-lab-v2/room-envelope-collision-authority-contract";
import type { ProductionAutoMetric } from "./production-auto-metric";

export const AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION =
  "afc-v2-production-room-authority/v1" as const;

export const AFC_V2_PRODUCTION_COORDINATE_SPACE =
  AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE;

export const AFC_V2_PRODUCTION_READINESS = "production_ready" as const;

export type AfcProductionArtifactSource = "durable" | "generated";

export type AfcProductionLineageIdentity = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;

export type AfcProductionFloorAuthority = Readonly<{
  authorityKey: string;
  sourceNormalizedPolygon: readonly Readonly<{ x: number; y: number }>[];
  worldWidthM: number;
  referenceDepthM: number;
  widthDepthRatio: number;
}>;

export type AfcProductionFrozenCamera = Readonly<{
  applied: true;
  verticalFovDeg: number;
  pose: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    lookAt: Readonly<{ x: number; y: number; z: number }>;
    up: Readonly<{ x: number; y: number; z: number }>;
  }>;
  frame: Readonly<{ width: number; height: number }>;
  originalBasisRestored: true;
  calibrationVersion: typeof CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION;
  solver: typeof CALIBRATED_CAMERA_AUTHORITY_SOLVER;
  authorityVersion: typeof CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION;
}>;

export type AfcProductionCollisionAuthority = Readonly<{
  source: ActiveRuntimeCollisionSource;
  collisionAuthority: boolean;
  walls: readonly RoomCollisionEnabledWall[];
}>;

export type AfcProductionMetricAuthority = Readonly<{
  autoMetricScale: number;
  metricScale: number;
  accepted: boolean;
  path: "path_a" | "path_b" | "none";
  authority: AutoMetricScaleAuthority;
  fallbackApplied: boolean;
}>;

export type AfcV2ProductionRoomAuthority = Readonly<{
  schemaVersion: typeof AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION;
  engineVersions: Readonly<{
    liveProduct: typeof AFC_SR1_LIVE_PRODUCT_VERSION;
    autoMetric: typeof AFC_V2_AUTO_METRIC_SCALE_VERSION;
    cameraCalibration: typeof CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION;
    cameraAuthority: typeof CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION;
    collision: typeof AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION;
    emptyAuthoritativeCollision: typeof AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION;
  }>;
  generationId: string;
  runId: string;
  createdAt: string;
  status: "ready";
  readiness: typeof AFC_V2_PRODUCTION_READINESS;
  original: AfcProductionLineageIdentity;
  empty: AfcProductionLineageIdentity & Readonly<{
    artifactSource: AfcProductionArtifactSource;
  }>;
  tiled: AfcProductionLineageIdentity & Readonly<{
    artifactSource: AfcProductionArtifactSource;
    cacheKey: string;
    forceRegeneration: boolean;
    readerVersion: string | null;
  }>;
  frame: Readonly<{ width: number; height: number }>;
  floor: AfcProductionFloorAuthority;
  frozenCamera: AfcProductionFrozenCamera;
  coordinateSpace: typeof AFC_V2_PRODUCTION_COORDINATE_SPACE;
  collision: AfcProductionCollisionAuthority;
  metric: AfcProductionMetricAuthority;
  recovery: Readonly<{
    safeFailureState: "none" | "metric_fallback" | "collision_empty";
  }>;
}>;

export type ProductionAuthorityBuildInput = Readonly<{
  generationId: string;
  runId: string;
  createdAt: string;
  original: AfcProductionLineageIdentity;
  empty: AfcProductionLineageIdentity;
  tiled: AfcProductionLineageIdentity;
  emptyArtifactSource: AfcProductionArtifactSource;
  tiledArtifactSource: AfcProductionArtifactSource;
  tiledCacheKey: string;
  tiledForceRegeneration: boolean;
  readerVersion: string | null;
  frame: Readonly<{ width: number; height: number }>;
  analysis: Extract<AfcV2AnalyzeResult, { status: "applied" }>;
  autoMetric: ProductionAutoMetric;
  collision: AfcProductionCollisionAuthority;
}>;

const PRODUCTION_AUTHORITY_KEYS = [
  "schemaVersion",
  "engineVersions",
  "generationId",
  "runId",
  "createdAt",
  "status",
  "readiness",
  "original",
  "empty",
  "tiled",
  "frame",
  "floor",
  "frozenCamera",
  "coordinateSpace",
  "collision",
  "metric",
  "recovery",
] as const;

function clonePoint(point: Readonly<{ x: number; y: number }>) {
  return Object.freeze({ x: point.x, y: point.y });
}

function clonePose(
  pose: AfcProductionFrozenCamera["pose"],
): AfcProductionFrozenCamera["pose"] {
  return Object.freeze({
    position: Object.freeze({ ...pose.position }),
    lookAt: Object.freeze({ ...pose.lookAt }),
    up: Object.freeze({ ...pose.up }),
  });
}

function cloneWall(wall: RoomCollisionEnabledWall): RoomCollisionEnabledWall {
  return Object.freeze({
    id: wall.id,
    sourceBoundaryId: wall.sourceBoundaryId,
    sourceSeamId: wall.sourceSeamId,
    a: Object.freeze({ ...wall.a }),
    b: Object.freeze({ ...wall.b }),
    supportPlaneNormal: Object.freeze({ ...wall.supportPlaneNormal }),
    supportPlaneConstant: wall.supportPlaneConstant,
    sideSign: wall.sideSign,
  });
}

/**
 * Whitelist builder. Callers must not spread Lab analysis results into this
 * object. Only production-runtime fields listed here are admitted.
 */
export function buildAfcV2ProductionRoomAuthority(
  input: ProductionAuthorityBuildInput,
): AfcV2ProductionRoomAuthority {
  const metricFallback = input.autoMetric.receipt.accepted !== true;
  const collisionEmpty = input.collision.walls.length === 0;
  const safeFailureState = metricFallback
    ? "metric_fallback"
    : collisionEmpty
    ? "collision_empty"
    : "none";
  return Object.freeze({
    schemaVersion: AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
    engineVersions: Object.freeze({
      liveProduct: AFC_SR1_LIVE_PRODUCT_VERSION,
      autoMetric: AFC_V2_AUTO_METRIC_SCALE_VERSION,
      cameraCalibration: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      cameraAuthority: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
      collision: AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION,
      emptyAuthoritativeCollision:
        AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
    }),
    generationId: input.generationId,
    runId: input.runId,
    createdAt: input.createdAt,
    status: "ready",
    readiness: AFC_V2_PRODUCTION_READINESS,
    original: Object.freeze({ ...input.original }),
    empty: Object.freeze({
      ...input.empty,
      artifactSource: input.emptyArtifactSource,
    }),
    tiled: Object.freeze({
      ...input.tiled,
      artifactSource: input.tiledArtifactSource,
      cacheKey: input.tiledCacheKey,
      forceRegeneration: input.tiledForceRegeneration,
      readerVersion: input.readerVersion,
    }),
    frame: Object.freeze({ ...input.frame }),
    floor: Object.freeze({
      authorityKey: input.analysis.floor.authorityKey,
      sourceNormalizedPolygon: Object.freeze(
        input.analysis.floor.sourceNormalizedPolygon.map(clonePoint),
      ),
      worldWidthM: input.analysis.floor.worldWidthM,
      referenceDepthM: input.analysis.floor.referenceDepthM,
      widthDepthRatio: input.analysis.floor.widthDepthRatio,
    }),
    frozenCamera: Object.freeze({
      applied: true as const,
      verticalFovDeg: input.analysis.camera.verticalFovDeg,
      pose: clonePose(input.analysis.camera.pose),
      frame: Object.freeze({ ...input.analysis.camera.frame }),
      originalBasisRestored: true as const,
      calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
      authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
    }),
    coordinateSpace: AFC_V2_PRODUCTION_COORDINATE_SPACE,
    collision: Object.freeze({
      source: input.collision.source,
      collisionAuthority: input.collision.collisionAuthority,
      walls: Object.freeze(input.collision.walls.map(cloneWall)),
    }),
    metric: Object.freeze({
      autoMetricScale: input.autoMetric.receipt.autoMetricScale,
      metricScale: input.autoMetric.metricScale,
      accepted: input.autoMetric.receipt.accepted,
      path: input.autoMetric.path,
      authority: input.autoMetric.receipt.authority,
      fallbackApplied: metricFallback,
    }),
    recovery: Object.freeze({
      safeFailureState,
    }),
  });
}

export function productionAuthorityKeys(): readonly string[] {
  return PRODUCTION_AUTHORITY_KEYS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isAfcV2ProductionRoomAuthority(
  value: unknown,
): value is AfcV2ProductionRoomAuthority {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION) {
    return false;
  }
  if (value.status !== "ready") return false;
  if (value.readiness !== AFC_V2_PRODUCTION_READINESS) return false;
  if (value.coordinateSpace !== AFC_V2_PRODUCTION_COORDINATE_SPACE) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== PRODUCTION_AUTHORITY_KEYS.length) return false;
  return PRODUCTION_AUTHORITY_KEYS.every((key) => keys.includes(key));
}
