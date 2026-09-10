/**
 * Frozen AFC Camera realization.
 *
 * The production PerspectiveCamera is constructed only from persisted
 * frozenCamera fields. Aspect is always frame.width / frame.height.
 * Metric scale is applied once to pose translation, never to FOV.
 */

import * as THREE from "three";

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import { realizeCameraPose } from "./metric-world-realization";
import { persistedMetricScale } from "./runtime-authority";
import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  type FrozenCameraSnapshot,
  type RealizedFrozenCamera,
} from "./types";

const VECTOR_EPSILON = 1e-9;

export type FrozenCameraBuildResult =
  | Readonly<{ ok: true; camera: THREE.PerspectiveCamera; realized: RealizedFrozenCamera }>
  | Readonly<{ ok: false; reason: string }>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteVector(vector: { x: number; y: number; z: number }): boolean {
  return finite(vector.x) && finite(vector.y) && finite(vector.z);
}

function vectorLength(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function crossLength(
  first: { x: number; y: number; z: number },
  second: { x: number; y: number; z: number },
): number {
  return Math.hypot(
    first.y * second.z - first.z * second.y,
    first.z * second.x - first.x * second.z,
    first.x * second.y - first.y * second.x,
  );
}

export function frozenCameraSnapshotFromAuthority(
  authority: AfcV2ProductionRoomAuthority,
): FrozenCameraSnapshot {
  return {
    verticalFovDeg: authority.frozenCamera.verticalFovDeg,
    pose: {
      position: { ...authority.frozenCamera.pose.position },
      lookAt: { ...authority.frozenCamera.pose.lookAt },
      up: { ...authority.frozenCamera.pose.up },
    },
    frame: {
      width: authority.frozenCamera.frame.width,
      height: authority.frozenCamera.frame.height,
    },
  };
}

export function frozenCameraAspect(
  frame: Readonly<{ width: number; height: number }>,
): number {
  return frame.width / frame.height;
}

export function realizeFrozenCamera(
  snapshot: FrozenCameraSnapshot,
  metricScale: number,
): RealizedFrozenCamera {
  const pose = realizeCameraPose(snapshot.pose, metricScale);
  return {
    verticalFovDeg: snapshot.verticalFovDeg,
    aspect: frozenCameraAspect(snapshot.frame),
    near: AFC_V2_RUNTIME_CAMERA_NEAR,
    far: AFC_V2_RUNTIME_CAMERA_FAR,
    pose,
    frame: { width: snapshot.frame.width, height: snapshot.frame.height },
  };
}

export function realizeFrozenCameraFromAuthority(
  authority: AfcV2ProductionRoomAuthority,
): RealizedFrozenCamera {
  return realizeFrozenCamera(
    frozenCameraSnapshotFromAuthority(authority),
    persistedMetricScale(authority),
  );
}

export function buildProductionPerspectiveCamera(
  realized: RealizedFrozenCamera,
): FrozenCameraBuildResult {
  if (!finite(realized.frame.width) || realized.frame.width <= 0) {
    return { ok: false, reason: "frame width must be a positive finite value" };
  }
  if (!finite(realized.frame.height) || realized.frame.height <= 0) {
    return { ok: false, reason: "frame height must be a positive finite value" };
  }
  if (!finite(realized.verticalFovDeg) || realized.verticalFovDeg <= 0) {
    return { ok: false, reason: "FOV must be a positive finite value" };
  }
  if (
    !finite(realized.near) ||
    realized.near <= 0 ||
    !finite(realized.far) ||
    realized.far <= realized.near
  ) {
    return { ok: false, reason: "near/far must be finite with 0 < near < far" };
  }
  if (!finiteVector(realized.pose.position)) {
    return { ok: false, reason: "camera position must be finite" };
  }
  if (!finiteVector(realized.pose.lookAt)) {
    return { ok: false, reason: "camera lookAt target must be finite" };
  }
  if (!finiteVector(realized.pose.up)) {
    return { ok: false, reason: "camera up vector must be finite" };
  }

  const viewDirection = {
    x: realized.pose.lookAt.x - realized.pose.position.x,
    y: realized.pose.lookAt.y - realized.pose.position.y,
    z: realized.pose.lookAt.z - realized.pose.position.z,
  };
  if (vectorLength(viewDirection) <= VECTOR_EPSILON) {
    return { ok: false, reason: "camera position and lookAt target are degenerate" };
  }
  if (
    vectorLength(realized.pose.up) <= VECTOR_EPSILON ||
    crossLength(viewDirection, realized.pose.up) <= VECTOR_EPSILON
  ) {
    return { ok: false, reason: "camera up vector is degenerate" };
  }

  const aspect = realized.frame.width / realized.frame.height;
  const camera = new THREE.PerspectiveCamera(
    realized.verticalFovDeg,
    aspect,
    realized.near,
    realized.far,
  );
  camera.position.set(
    realized.pose.position.x,
    realized.pose.position.y,
    realized.pose.position.z,
  );
  camera.up.set(realized.pose.up.x, realized.pose.up.y, realized.pose.up.z);
  camera.lookAt(
    realized.pose.lookAt.x,
    realized.pose.lookAt.y,
    realized.pose.lookAt.z,
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { ok: true, camera, realized };
}

export function applyRealizedFrozenCamera(
  camera: THREE.PerspectiveCamera,
  realized: RealizedFrozenCamera,
): void {
  camera.fov = realized.verticalFovDeg;
  camera.aspect = realized.frame.width / realized.frame.height;
  camera.near = realized.near;
  camera.far = realized.far;
  camera.position.set(
    realized.pose.position.x,
    realized.pose.position.y,
    realized.pose.position.z,
  );
  camera.up.set(realized.pose.up.x, realized.pose.up.y, realized.pose.up.z);
  camera.lookAt(
    realized.pose.lookAt.x,
    realized.pose.lookAt.y,
    realized.pose.lookAt.z,
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
