/**
 * Auto-frame a single GLB for a catalog thumbnail.
 *
 * The camera moves. The model transform is not changed. Framing uses the
 * world-space bounding sphere so tall, wide, and deep objects stay inside
 * a square frame from one elevated three-quarter view.
 */

export const VIBODE_MODEL_THUMBNAIL_EDGE_PX = 512;

export const VIBODE_MODEL_THUMBNAIL_VERTICAL_FOV_DEG = 32;

export const VIBODE_MODEL_THUMBNAIL_FRAME_PADDING = 1.22;

export const VIBODE_MODEL_THUMBNAIL_CLEAR_HEX = "#e7e5e4";

export const VIBODE_MODEL_THUMBNAIL_CLEAR_COLOR = 0xe7e5e4;

const MIN_RADIUS = 1e-6;

const VIEW_RAW = Object.freeze({ x: 1, y: 0.72, z: 1 });

const VIEW_LENGTH = Math.hypot(VIEW_RAW.x, VIEW_RAW.y, VIEW_RAW.z);

export const VIBODE_MODEL_THUMBNAIL_VIEW_DIRECTION = Object.freeze({
  x: VIEW_RAW.x / VIEW_LENGTH,
  y: VIEW_RAW.y / VIEW_LENGTH,
  z: VIEW_RAW.z / VIEW_LENGTH,
});

export type ModelThumbnailVec3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type ModelThumbnailBounds = Readonly<{
  min: ModelThumbnailVec3;
  max: ModelThumbnailVec3;
}>;

export type ModelThumbnailCamera = Readonly<{
  position: ModelThumbnailVec3;
  lookAt: ModelThumbnailVec3;
  up: ModelThumbnailVec3;
  verticalFovDeg: number;
  near: number;
  far: number;
}>;

export type FrameModelThumbnailResult =
  | Readonly<{
    ok: true;
    camera: ModelThumbnailCamera;
    center: ModelThumbnailVec3;
    radius: number;
  }>
  | Readonly<{ ok: false; reason: string }>;

export function frameModelThumbnail(bounds: ModelThumbnailBounds): FrameModelThumbnailResult {
  const { min, max } = bounds;
  if (!finiteVec(min) || !finiteVec(max)) {
    return { ok: false, reason: "bounds are not finite" };
  }
  const size = {
    x: max.x - min.x,
    y: max.y - min.y,
    z: max.z - min.z,
  };
  if (size.x < 0 || size.y < 0 || size.z < 0) {
    return { ok: false, reason: "bounds are inverted" };
  }
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const radius = 0.5 * Math.hypot(size.x, size.y, size.z);
  if (!Number.isFinite(radius) || radius < MIN_RADIUS) {
    return { ok: false, reason: "bounds are degenerate" };
  }
  const halfFov = (VIBODE_MODEL_THUMBNAIL_VERTICAL_FOV_DEG * Math.PI) / 360;
  const sinHalf = Math.sin(halfFov);
  if (!Number.isFinite(sinHalf) || sinHalf <= 0) {
    return { ok: false, reason: "camera FOV is invalid" };
  }
  const distance = (radius / sinHalf) * VIBODE_MODEL_THUMBNAIL_FRAME_PADDING;
  const direction = VIBODE_MODEL_THUMBNAIL_VIEW_DIRECTION;
  const position = {
    x: center.x + direction.x * distance,
    y: center.y + direction.y * distance,
    z: center.z + direction.z * distance,
  };
  const near = distance / 100;
  const far = distance + radius * 8;
  const up = { x: 0, y: 1, z: 0 };
  if (
    !finiteVec(center) ||
    !finiteVec(position) ||
    !Number.isFinite(distance) ||
    distance <= 0 ||
    !Number.isFinite(near) ||
    !Number.isFinite(far) ||
    near <= 0 ||
    far <= near
  ) {
    return { ok: false, reason: "camera values are not finite" };
  }
  const view = {
    x: center.x - position.x,
    y: center.y - position.y,
    z: center.z - position.z,
  };
  const parallel = Math.hypot(
    view.y * up.z - view.z * up.y,
    view.z * up.x - view.x * up.z,
    view.x * up.y - view.y * up.x,
  );
  if (!Number.isFinite(parallel) || parallel <= 1e-9) {
    return { ok: false, reason: "camera pose is degenerate" };
  }
  return {
    ok: true,
    center,
    radius,
    camera: {
      position,
      lookAt: center,
      up,
      verticalFovDeg: VIBODE_MODEL_THUMBNAIL_VERTICAL_FOV_DEG,
      near,
      far,
    },
  };
}

function finiteVec(value: ModelThumbnailVec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}
