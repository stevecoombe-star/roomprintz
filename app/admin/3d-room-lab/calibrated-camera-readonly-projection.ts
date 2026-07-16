import * as THREE from "three";

export type CalibratedReadOnlyProjectionInput = Readonly<{
  fovDeg: number;
  pose: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    lookAt: Readonly<{ x: number; y: number; z: number }>;
    up: Readonly<{ x: number; y: number; z: number }>;
  }>;
  frameSize: Readonly<{
    width: number;
    height: number;
  }>;
  near: number;
  far: number;
}>;

export type CalibratedReadOnlyProjectionCameraResult =
  | Readonly<{ ok: true; camera: THREE.PerspectiveCamera }>
  | Readonly<{ ok: false; reason: string }>;

// Mirrors the committed Room Lab renderer camera construction. These values
// preserve the renderer's clipping convention; this camera is projection-only.
const ROOM_LAB_RENDERER_CAMERA_NEAR = 0.1;
const ROOM_LAB_RENDERER_CAMERA_FAR = 100;
const VECTOR_EPSILON = 1e-9;

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
  second: { x: number; y: number; z: number }
): number {
  return Math.hypot(
    first.y * second.z - first.z * second.y,
    first.z * second.x - first.x * second.z,
    first.x * second.y - first.y * second.x
  );
}

/**
 * Builds an isolated Three camera from accepted calibrated snapshot values.
 * It is never registered with the renderer and grants no camera authority.
 */
export function buildCalibratedReadOnlyProjectionCamera(
  input: CalibratedReadOnlyProjectionInput
): CalibratedReadOnlyProjectionCameraResult {
  if (!finite(input.frameSize.width) || input.frameSize.width <= 0) {
    return { ok: false, reason: "frame width must be a positive finite value" };
  }
  if (!finite(input.frameSize.height) || input.frameSize.height <= 0) {
    return { ok: false, reason: "frame height must be a positive finite value" };
  }
  if (!finite(input.fovDeg) || input.fovDeg <= 0) {
    return { ok: false, reason: "FOV must be a positive finite value" };
  }
  if (!finite(input.near) || input.near <= 0 || !finite(input.far) || input.far <= input.near) {
    return { ok: false, reason: "near/far must be finite with 0 < near < far" };
  }
  if (!finiteVector(input.pose.position)) {
    return { ok: false, reason: "camera position must be finite" };
  }
  if (!finiteVector(input.pose.lookAt)) {
    return { ok: false, reason: "camera lookAt target must be finite" };
  }
  if (!finiteVector(input.pose.up)) {
    return { ok: false, reason: "camera up vector must be finite" };
  }

  const viewDirection = {
    x: input.pose.lookAt.x - input.pose.position.x,
    y: input.pose.lookAt.y - input.pose.position.y,
    z: input.pose.lookAt.z - input.pose.position.z,
  };
  if (vectorLength(viewDirection) <= VECTOR_EPSILON) {
    return { ok: false, reason: "camera position and lookAt target are degenerate" };
  }
  if (vectorLength(input.pose.up) <= VECTOR_EPSILON || crossLength(viewDirection, input.pose.up) <= VECTOR_EPSILON) {
    return { ok: false, reason: "camera up vector is degenerate" };
  }

  const camera = new THREE.PerspectiveCamera(
    input.fovDeg,
    input.frameSize.width / input.frameSize.height,
    input.near,
    input.far
  );
  camera.position.set(input.pose.position.x, input.pose.position.y, input.pose.position.z);
  camera.up.set(input.pose.up.x, input.pose.up.y, input.pose.up.z);
  camera.lookAt(input.pose.lookAt.x, input.pose.lookAt.y, input.pose.lookAt.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { ok: true, camera };
}

export const CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR = ROOM_LAB_RENDERER_CAMERA_NEAR;
export const CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR = ROOM_LAB_RENDERER_CAMERA_FAR;
