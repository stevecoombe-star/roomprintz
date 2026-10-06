/**
 * Lifts diagnostic source-normalized span endpoints onto the floor.
 *
 * Uses the same unclamped source→container map and calibrated floor ray as
 * AFC boundary projection. The camera passed in is the viewport's realized
 * camera, so the hit is already in effective Room Scale space. Callers must
 * not apply a second scale.
 */

import type { PerspectiveCamera } from "three";

import { intersectOverlayRayWithFloorPlane } from "@/app/admin/3d-room-lab/calibrated-floor-ray";
import { sourceNormToContainerNormUnclamped } from "@/app/admin/3d-room-lab/image-space";

import type { TrustedPathImagePoint } from "./trusted-path";

export type TrustedPathFloorPoint = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

const MIN_SEGMENT_M = 1e-4;

export function liftTrustedPathImagePoint(
  point: TrustedPathImagePoint,
  intrinsic: Readonly<{ width: number; height: number }>,
  frame: Readonly<{ width: number; height: number }>,
  camera: PerspectiveCamera,
): TrustedPathFloorPoint | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const container = sourceNormToContainerNormUnclamped(point, intrinsic, frame);
  if (!container) return null;
  const hit = intersectOverlayRayWithFloorPlane(container, camera, 0);
  if (!hit.ok) return null;
  if (!Number.isFinite(hit.worldPoint.x) || !Number.isFinite(hit.worldPoint.z)) {
    return null;
  }
  return Object.freeze({
    x: hit.worldPoint.x,
    y: 0,
    z: hit.worldPoint.z,
  });
}

export function liftTrustedPathSegment(
  imageA: TrustedPathImagePoint,
  imageB: TrustedPathImagePoint,
  intrinsic: Readonly<{ width: number; height: number }>,
  frame: Readonly<{ width: number; height: number }>,
  camera: PerspectiveCamera,
): Readonly<{ a: TrustedPathFloorPoint; b: TrustedPathFloorPoint }> | null {
  const a = liftTrustedPathImagePoint(imageA, intrinsic, frame, camera);
  const b = liftTrustedPathImagePoint(imageB, intrinsic, frame, camera);
  if (!a || !b) return null;
  if (Math.hypot(b.x - a.x, b.z - a.z) <= MIN_SEGMENT_M) return null;
  return Object.freeze({ a, b });
}
