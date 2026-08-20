import type { PerspectiveCamera } from "three";

import { intersectOverlayRayWithFloorPlane } from "./calibrated-floor-ray";
import {
  isValidImageSize,
  sourceNormToContainerNormUnclamped,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import type { FloorPoint } from "./scene-state";
import type { AfcR3cImagePairCompatibility } from "./research/afc-r3c-image-pair-compatibility";

export type WorldXZ = Readonly<{ x: number; z: number }>;

export type EmptyToWorldXZProjectionInput = Readonly<{
  emptySourceNormalized: FloorPoint;
  emptyIntrinsicSize: ImageIntrinsicSize;
  originalIntrinsicSize: ImageIntrinsicSize;
  compatibility: AfcR3cImagePairCompatibility;
  containerSize: ImageFrameSize;
  calibratedCamera: PerspectiveCamera;
}>;

export type EmptyToWorldXZProjectionResult =
  | Readonly<{
      ok: true;
      originalSourceNormalized: FloorPoint;
      containerNormalized: FloorPoint;
      worldXZ: WorldXZ;
    }>
  | Readonly<{
      ok: false;
      reason:
        | "invalid_input"
        | "incompatible_basis"
        | "ray_parallel_to_floor"
        | "ray_intersection_behind_camera"
        | "ray_projection_failed";
      detail: string;
    }>;

function matchingDimensions(
  expected: Readonly<{ width: number; height: number }> | null,
  actual: ImageIntrinsicSize
): boolean {
  return !!expected && expected.width === actual.width && expected.height === actual.height;
}

function hasFinitePoint(point: FloorPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Applies the existing AFC source-normalized transfer contract. Both accepted
 * tiers preserve the numerical normalized coordinate; aspect-rescaled is a
 * reinterpretation in the Original basis, never a fitted warp or homography.
 */
export function transferEmptySourceNormalizedToOriginal(
  input: Pick<
    EmptyToWorldXZProjectionInput,
    "emptySourceNormalized" | "emptyIntrinsicSize" | "originalIntrinsicSize" | "compatibility"
  >
): EmptyToWorldXZProjectionResult | Readonly<{ ok: true; originalSourceNormalized: FloorPoint }> {
  if (
    !hasFinitePoint(input.emptySourceNormalized) ||
    !isValidImageSize(input.emptyIntrinsicSize) ||
    !isValidImageSize(input.originalIntrinsicSize)
  ) {
    return { ok: false, reason: "invalid_input", detail: "EMPTY point and image dimensions must be finite." };
  }
  if (input.compatibility.tier === "incompatible") {
    return { ok: false, reason: "incompatible_basis", detail: input.compatibility.reason ?? "EMPTY and Original bases are incompatible." };
  }
  if (
    !matchingDimensions(input.compatibility.inputDecodedDimensions, input.emptyIntrinsicSize) ||
    !matchingDimensions(input.compatibility.originalDecodedDimensions, input.originalIntrinsicSize)
  ) {
    return { ok: false, reason: "invalid_input", detail: "Image dimensions do not match the supplied compatibility evidence." };
  }
  return {
    ok: true,
    originalSourceNormalized: {
      x: input.emptySourceNormalized.x,
      y: input.emptySourceNormalized.y,
    },
  };
}

function rayFailure(
  reason: string
): Extract<EmptyToWorldXZProjectionResult, { ok: false }> {
  if (reason === "ray parallel to floor") {
    return { ok: false, reason: "ray_parallel_to_floor", detail: reason };
  }
  if (reason === "intersection behind camera") {
    return { ok: false, reason: "ray_intersection_behind_camera", detail: reason };
  }
  return { ok: false, reason: "ray_projection_failed", detail: reason };
}

/**
 * EMPTY source-normalized -> Original source-normalized -> container-normalized
 * -> already-applied calibrated-camera ray -> world y=0 -> world X/Z.
 */
export function projectEmptyFloorPointToWorldXZ(
  input: EmptyToWorldXZProjectionInput
): EmptyToWorldXZProjectionResult {
  const transferred = transferEmptySourceNormalizedToOriginal(input);
  if (!transferred.ok) return transferred;
  if (!isValidImageSize(input.containerSize)) {
    return { ok: false, reason: "invalid_input", detail: "Container dimensions must be finite and positive." };
  }
  if (!input.calibratedCamera) {
    return { ok: false, reason: "invalid_input", detail: "An already-applied calibrated camera is required." };
  }
  const containerNormalized = sourceNormToContainerNormUnclamped(
    transferred.originalSourceNormalized,
    input.originalIntrinsicSize,
    input.containerSize
  );
  if (!containerNormalized) {
    return { ok: false, reason: "invalid_input", detail: "Original source point cannot map to the container." };
  }
  const ray = intersectOverlayRayWithFloorPlane(containerNormalized, input.calibratedCamera, 0);
  if (!ray.ok) return rayFailure(ray.reason);
  return {
    ok: true,
    originalSourceNormalized: transferred.originalSourceNormalized,
    containerNormalized,
    worldXZ: { x: ray.floorPlane2D.x, z: ray.floorPlane2D.y },
  };
}
