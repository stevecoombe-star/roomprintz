/**
 * Frozen production world → normalized image projection.
 *
 * Extracted from the Lab overlay projector (`projectWorldPointToOverlayNormalized`)
 * as pure math. Uses the same Three.js PerspectiveCamera model as
 * `buildProductionPerspectiveCamera`. Does not import Lab React components.
 *
 * Collision clipping:
 * 1. Camera space: clip the segment to the near plane (`z = -near`).
 *    Both endpoints behind/near → omit. One behind → keep the visible portion.
 * 2. Normalized image: clip the projected segment to
 *    [AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN, AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX]
 *    = [-0.05, 1.05]. Small padding so edges near the viewport remain visible.
 *
 * Floor quads are never clipped by this helper.
 *
 * Normalized conversion (matches Lab):
 *   x = (ndc.x + 1) / 2
 *   y = (1 - ndc.y) / 2
 */

import * as THREE from "three";

export const AFC_ADMIN_WORLD_TO_IMAGE_PROJECTION_VERSION =
  "afc-admin-world-to-image/v1" as const;

export const AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN = -0.05;
export const AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX = 1.05;

const VECTOR_EPSILON = 1e-9;

export type WorldXyz = Readonly<{ x: number; y: number; z: number }>;

export type NormalizedImagePoint = Readonly<{ x: number; y: number }>;

export type ProjectedNormalizedSegment = Readonly<{
  points: readonly [NormalizedImagePoint, NormalizedImagePoint];
}>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteVec3(value: WorldXyz): boolean {
  return finite(value.x) && finite(value.y) && finite(value.z);
}

export function ndcToNormalizedImage(ndc: Readonly<{
  x: number;
  y: number;
}>): NormalizedImagePoint {
  return {
    x: (ndc.x + 1) / 2,
    y: (1 - ndc.y) / 2,
  };
}

function cameraSpacePoint(
  camera: THREE.PerspectiveCamera,
  worldPoint: WorldXyz,
): THREE.Vector3 | null {
  if (!finiteVec3(worldPoint)) return null;
  const cameraPoint = new THREE.Vector3(
    worldPoint.x,
    worldPoint.y,
    worldPoint.z,
  ).applyMatrix4(camera.matrixWorldInverse);
  if (
    !finite(cameraPoint.x) ||
    !finite(cameraPoint.y) ||
    !finite(cameraPoint.z)
  ) {
    return null;
  }
  return cameraPoint;
}

function projectCameraSpaceToNormalized(
  camera: THREE.PerspectiveCamera,
  cameraPoint: THREE.Vector3,
): NormalizedImagePoint | null {
  const ndc = cameraPoint.clone().applyMatrix4(camera.projectionMatrix);
  if (!finite(ndc.x) || !finite(ndc.y) || !finite(ndc.z)) return null;
  const normalized = ndcToNormalizedImage(ndc);
  if (!finite(normalized.x) || !finite(normalized.y)) return null;
  return normalized;
}

function interpolateCamera(
  start: THREE.Vector3,
  end: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    start.x + (end.x - start.x) * t,
    start.y + (end.y - start.y) * t,
    start.z + (end.z - start.z) * t,
  );
}

function clipCameraSegmentToNearPlane(
  start: THREE.Vector3,
  end: THREE.Vector3,
  near: number,
): readonly [THREE.Vector3, THREE.Vector3] | null {
  if (!finite(near) || near <= 0) return null;
  const clipZ = -near;
  const startVisible = start.z <= clipZ;
  const endVisible = end.z <= clipZ;
  if (!startVisible && !endVisible) return null;
  if (startVisible && endVisible) return [start, end];
  const dz = end.z - start.z;
  if (Math.abs(dz) <= VECTOR_EPSILON) return null;
  const t = (clipZ - start.z) / dz;
  if (!finite(t) || t < -VECTOR_EPSILON || t > 1 + VECTOR_EPSILON) return null;
  const clipped = interpolateCamera(start, end, Math.min(1, Math.max(0, t)));
  return startVisible ? [start, clipped] : [clipped, end];
}

/**
 * Liang–Barsky clip of a 2D segment against an axis-aligned square.
 */
export function clipNormalizedSegmentToRange(
  start: NormalizedImagePoint,
  end: NormalizedImagePoint,
  min: number,
  max: number,
): ProjectedNormalizedSegment | null {
  if (
    !finite(start.x) ||
    !finite(start.y) ||
    !finite(end.x) ||
    !finite(end.y) ||
    !finite(min) ||
    !finite(max) ||
    max <= min
  ) {
    return null;
  }
  let t0 = 0;
  let t1 = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) <= VECTOR_EPSILON) return q >= -VECTOR_EPSILON;
    const t = q / p;
    if (!finite(t)) return false;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (
    !clip(-dx, start.x - min) ||
    !clip(dx, max - start.x) ||
    !clip(-dy, start.y - min) ||
    !clip(dy, max - start.y)
  ) {
    return null;
  }
  if (t1 < t0) return null;
  const clippedStart = {
    x: start.x + t0 * dx,
    y: start.y + t0 * dy,
  };
  const clippedEnd = {
    x: start.x + t1 * dx,
    y: start.y + t1 * dy,
  };
  const length = Math.hypot(
    clippedEnd.x - clippedStart.x,
    clippedEnd.y - clippedStart.y,
  );
  if (!finite(length) || length <= VECTOR_EPSILON) return null;
  return {
    points: [clippedStart, clippedEnd],
  };
}

export function projectWorldPointToNormalizedImage(
  camera: THREE.PerspectiveCamera,
  worldPoint: WorldXyz,
): NormalizedImagePoint | null {
  camera.updateMatrixWorld(true);
  const cameraPoint = cameraSpacePoint(camera, worldPoint);
  if (!cameraPoint) return null;
  if (cameraPoint.z > -camera.near) return null;
  return projectCameraSpaceToNormalized(camera, cameraPoint);
}

export function projectWorldSegmentToNormalizedImage(
  camera: THREE.PerspectiveCamera,
  startWorld: WorldXyz,
  endWorld: WorldXyz,
): ProjectedNormalizedSegment | null {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const startCamera = cameraSpacePoint(camera, startWorld);
  const endCamera = cameraSpacePoint(camera, endWorld);
  if (!startCamera || !endCamera) return null;
  const clipped = clipCameraSegmentToNearPlane(
    startCamera,
    endCamera,
    camera.near,
  );
  if (!clipped) return null;
  const startImage = projectCameraSpaceToNormalized(camera, clipped[0]);
  const endImage = projectCameraSpaceToNormalized(camera, clipped[1]);
  if (!startImage || !endImage) return null;
  return clipNormalizedSegmentToRange(
    startImage,
    endImage,
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  );
}
