import * as THREE from "three";

import type { FloorPoint } from "./scene-state";

export type CalibratedFloorRayIntersectionResult =
  | {
      ok: true;
      worldPoint: { x: number; y: number; z: number };
      floorPlane2D: { x: number; y: number };
    }
  | { ok: false; reason: string };

/**
 * Intersects a container-normalized overlay point with the already-applied
 * calibrated camera's world-floor plane. This is intentionally camera-only:
 * it neither creates nor calibrates a camera.
 */
export function intersectOverlayRayWithFloorPlane(
  normalizedPoint: FloorPoint,
  camera: THREE.PerspectiveCamera | null,
  floorPlaneY = 0
): CalibratedFloorRayIntersectionResult {
  if (!camera) return { ok: false, reason: "camera unavailable" };
  if (
    !Number.isFinite(normalizedPoint.x) ||
    !Number.isFinite(normalizedPoint.y) ||
    !Number.isFinite(floorPlaneY)
  ) {
    return { ok: false, reason: "non-finite input" };
  }
  camera.updateMatrixWorld(true);
  const rayOrigin = camera.getWorldPosition(new THREE.Vector3());
  const ndcPoint = new THREE.Vector3(normalizedPoint.x * 2 - 1, 1 - normalizedPoint.y * 2, 0.5);
  const rayPoint = ndcPoint.unproject(camera);
  const rayDirection = rayPoint.sub(rayOrigin);
  const rayDirectionLength = rayDirection.length();
  if (!Number.isFinite(rayDirectionLength) || rayDirectionLength <= 1e-9) {
    return { ok: false, reason: "invalid ray direction" };
  }
  rayDirection.multiplyScalar(1 / rayDirectionLength);
  if (!Number.isFinite(rayDirection.y) || Math.abs(rayDirection.y) <= 1e-9) {
    return { ok: false, reason: "ray parallel to floor" };
  }
  const intersectionDistance = (floorPlaneY - rayOrigin.y) / rayDirection.y;
  if (!Number.isFinite(intersectionDistance)) {
    return { ok: false, reason: "invalid intersection distance" };
  }
  if (intersectionDistance <= 1e-9) {
    return { ok: false, reason: "intersection behind camera" };
  }
  const intersectionPoint = rayOrigin.clone().addScaledVector(rayDirection, intersectionDistance);
  if (
    !Number.isFinite(intersectionPoint.x) ||
    !Number.isFinite(intersectionPoint.y) ||
    !Number.isFinite(intersectionPoint.z)
  ) {
    return { ok: false, reason: "non-finite intersection point" };
  }
  return {
    ok: true,
    worldPoint: { x: intersectionPoint.x, y: intersectionPoint.y, z: intersectionPoint.z },
    floorPlane2D: { x: intersectionPoint.x, y: intersectionPoint.z },
  };
}
