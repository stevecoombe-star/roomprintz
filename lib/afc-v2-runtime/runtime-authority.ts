/**
 * Fail-closed validation of compact PI-2 production authority.
 *
 * Runtime begins at `afc-v2-production-room-authority/v1`. It does not
 * reconstruct Floor, Camera, collision, or metric scale.
 */

import {
  AFC_V2_PRODUCTION_COORDINATE_SPACE,
  AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  isAfcV2ProductionRoomAuthority,
  type AfcV2ProductionRoomAuthority,
} from "@/lib/afc-v2-production/production-authority-contract";

import { AFC_V2_RUNTIME_COORDINATE_SPACE } from "./types";

export type RuntimeAuthorityValidation =
  | Readonly<{ ok: true; authority: AfcV2ProductionRoomAuthority }>
  | Readonly<{ ok: false; reason: string }>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isFiniteNumber(record.x) && isFiniteNumber(record.y) && isFiniteNumber(record.z);
}

function isFiniteVec2(value: unknown): value is { x: number; z: number } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isFiniteNumber(record.x) && isFiniteNumber(record.z);
}

function validateFrozenCamera(
  authority: AfcV2ProductionRoomAuthority,
): string | null {
  const camera = authority.frozenCamera;
  if (camera.applied !== true) return "frozen camera is not applied";
  if (camera.originalBasisRestored !== true) {
    return "frozen camera original basis is not restored";
  }
  if (!isFiniteNumber(camera.verticalFovDeg) || camera.verticalFovDeg <= 0) {
    return "frozen camera FOV is not a positive finite value";
  }
  if (!isFiniteVec3(camera.pose.position)) return "frozen camera position is not finite";
  if (!isFiniteVec3(camera.pose.lookAt)) return "frozen camera lookAt is not finite";
  if (!isFiniteVec3(camera.pose.up)) return "frozen camera up is not finite";
  if (
    !isFiniteNumber(camera.frame.width) ||
    camera.frame.width <= 0 ||
    !isFiniteNumber(camera.frame.height) ||
    camera.frame.height <= 0
  ) {
    return "frozen camera frame is not a positive finite size";
  }
  const view = {
    x: camera.pose.lookAt.x - camera.pose.position.x,
    y: camera.pose.lookAt.y - camera.pose.position.y,
    z: camera.pose.lookAt.z - camera.pose.position.z,
  };
  if (Math.hypot(view.x, view.y, view.z) <= 1e-9) {
    return "frozen camera pose is degenerate";
  }
  const upLength = Math.hypot(camera.pose.up.x, camera.pose.up.y, camera.pose.up.z);
  const cross = Math.hypot(
    view.y * camera.pose.up.z - view.z * camera.pose.up.y,
    view.z * camera.pose.up.x - view.x * camera.pose.up.z,
    view.x * camera.pose.up.y - view.y * camera.pose.up.x,
  );
  if (upLength <= 1e-9 || cross <= 1e-9) {
    return "frozen camera up vector is degenerate";
  }
  return null;
}

function validateFloor(authority: AfcV2ProductionRoomAuthority): string | null {
  const floor = authority.floor;
  if (!isFiniteNumber(floor.worldWidthM) || floor.worldWidthM <= 0) {
    return "floor worldWidthM is not a positive finite value";
  }
  if (!isFiniteNumber(floor.referenceDepthM) || floor.referenceDepthM <= 0) {
    return "floor referenceDepthM is not a positive finite value";
  }
  if (!isFiniteNumber(floor.widthDepthRatio) || floor.widthDepthRatio <= 0) {
    return "floor widthDepthRatio is not a positive finite value";
  }
  if (!Array.isArray(floor.sourceNormalizedPolygon) || floor.sourceNormalizedPolygon.length < 3) {
    return "floor sourceNormalizedPolygon is incomplete";
  }
  return null;
}

function validateCollision(authority: AfcV2ProductionRoomAuthority): string | null {
  const collision = authority.collision;
  if (typeof collision.collisionAuthority !== "boolean") {
    return "collision authority flag is invalid";
  }
  if (!Array.isArray(collision.walls)) return "collision walls are missing";
  for (const wall of collision.walls) {
    if (
      !isFiniteVec2(wall.a) ||
      !isFiniteVec2(wall.b) ||
      !isFiniteVec3(wall.supportPlaneNormal) ||
      !isFiniteNumber(wall.supportPlaneConstant) ||
      (wall.sideSign !== 1 && wall.sideSign !== -1)
    ) {
      return `collision wall ${wall.id ?? "(unnamed)"} is malformed`;
    }
  }
  return null;
}

function validateMetric(authority: AfcV2ProductionRoomAuthority): string | null {
  const metric = authority.metric;
  if (!isFiniteNumber(metric.metricScale) || metric.metricScale <= 0) {
    return "metricScale is not a positive finite value";
  }
  if (!isFiniteNumber(metric.autoMetricScale) || metric.autoMetricScale <= 0) {
    return "autoMetricScale is not a positive finite value";
  }
  return null;
}

export function validateProductionRuntimeAuthority(
  value: unknown,
): RuntimeAuthorityValidation {
  if (!isAfcV2ProductionRoomAuthority(value)) {
    return {
      ok: false,
      reason: "value is not afc-v2-production-room-authority/v1",
    };
  }
  if (value.schemaVersion !== AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION) {
    return { ok: false, reason: "unsupported production authority schema" };
  }
  if (value.coordinateSpace !== AFC_V2_PRODUCTION_COORDINATE_SPACE) {
    return { ok: false, reason: "coordinate space is not calibrated-world-xz/v1" };
  }
  if (value.coordinateSpace !== AFC_V2_RUNTIME_COORDINATE_SPACE) {
    return { ok: false, reason: "runtime coordinate space mismatch" };
  }
  if (typeof value.generationId !== "string" || value.generationId.length === 0) {
    return { ok: false, reason: "generationId is missing" };
  }
  if (
    !isFiniteNumber(value.frame.width) ||
    value.frame.width <= 0 ||
    !isFiniteNumber(value.frame.height) ||
    value.frame.height <= 0
  ) {
    return { ok: false, reason: "authority frame is not a positive finite size" };
  }
  const cameraError = validateFrozenCamera(value);
  if (cameraError) return { ok: false, reason: cameraError };
  const floorError = validateFloor(value);
  if (floorError) return { ok: false, reason: floorError };
  const collisionError = validateCollision(value);
  if (collisionError) return { ok: false, reason: collisionError };
  const metricError = validateMetric(value);
  if (metricError) return { ok: false, reason: metricError };
  return { ok: true, authority: value };
}

export function persistedMetricScale(
  authority: AfcV2ProductionRoomAuthority,
): number {
  const scale = authority.metric.metricScale;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
