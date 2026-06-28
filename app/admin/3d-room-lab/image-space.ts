import type { FloorPoint } from "./scene-state";

export type ImageIntrinsicSize = { width: number; height: number };
export type ImageFrameSize = { width: number; height: number };
export type PixelPoint = { x: number; y: number };

export type CoverCropResult = {
  scale: number;
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
  visibleSourceRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isValidImageSize(
  size: ImageIntrinsicSize | ImageFrameSize | null | undefined
): size is ImageIntrinsicSize | ImageFrameSize {
  if (!size) return false;
  return isFinitePositive(size.width) && isFinitePositive(size.height);
}

export function getCoverCrop(
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): CoverCropResult | null {
  if (!isValidImageSize(intrinsic) || !isValidImageSize(frame)) return null;
  const scale = Math.max(frame.width / intrinsic.width, frame.height / intrinsic.height);
  if (!isFinitePositive(scale)) return null;

  const renderedWidth = intrinsic.width * scale;
  const renderedHeight = intrinsic.height * scale;
  const offsetX = (frame.width - renderedWidth) / 2;
  const offsetY = (frame.height - renderedHeight) / 2;

  const visibleSourceX = clamp01((-offsetX) / renderedWidth) * intrinsic.width;
  const visibleSourceY = clamp01((-offsetY) / renderedHeight) * intrinsic.height;
  const visibleSourceMaxX = clamp01((frame.width - offsetX) / renderedWidth) * intrinsic.width;
  const visibleSourceMaxY = clamp01((frame.height - offsetY) / renderedHeight) * intrinsic.height;

  return {
    scale,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    visibleSourceRect: {
      x: visibleSourceX,
      y: visibleSourceY,
      width: Math.max(0, visibleSourceMaxX - visibleSourceX),
      height: Math.max(0, visibleSourceMaxY - visibleSourceY),
    },
  };
}

export function containerNormToSourceNorm(
  point: FloorPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint | null {
  const crop = getCoverCrop(intrinsic, frame);
  if (!crop) return null;

  const frameX = clamp01(point.x) * frame.width;
  const frameY = clamp01(point.y) * frame.height;

  const sourceX = (frameX - crop.offsetX) / crop.scale;
  const sourceY = (frameY - crop.offsetY) / crop.scale;

  return {
    x: clamp01(sourceX / intrinsic.width),
    y: clamp01(sourceY / intrinsic.height),
  };
}

export function sourceNormToContainerNorm(
  point: FloorPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint | null {
  const crop = getCoverCrop(intrinsic, frame);
  if (!crop) return null;

  const sourceX = clamp01(point.x) * intrinsic.width;
  const sourceY = clamp01(point.y) * intrinsic.height;

  const frameX = sourceX * crop.scale + crop.offsetX;
  const frameY = sourceY * crop.scale + crop.offsetY;

  return {
    x: clamp01(frameX / frame.width),
    y: clamp01(frameY / frame.height),
  };
}

/**
 * Like sourceNormToContainerNorm, but DOES NOT clamp inputs or outputs to [0,1].
 * Uses the exact same object-cover crop math (getCoverCrop) so it is consistent
 * with the clamping variant, but preserves out-of-frame magnitude.
 *
 * This is intended ONLY for converting untrusted model raw coordinates (Phase
 * 2F vision) BEFORE the Phase 2F-B validator applies its own clamp/reject
 * policy. It must NOT be used for UI/manual overlay conversion, which relies on
 * the clamping sourceNormToContainerNorm to stay inside the frame.
 *
 * Returns null for invalid/non-finite dimensions or points.
 */
export function sourceNormToContainerNormUnclamped(
  point: FloorPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint | null {
  const crop = getCoverCrop(intrinsic, frame);
  if (!crop) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  // No clamp on the source-normalized input.
  const sourceX = point.x * intrinsic.width;
  const sourceY = point.y * intrinsic.height;

  const frameX = sourceX * crop.scale + crop.offsetX;
  const frameY = sourceY * crop.scale + crop.offsetY;

  // No clamp on the container-normalized output; magnitude outside [0,1] is
  // preserved so downstream validation can distinguish mild vs gross off-frame.
  return {
    x: frameX / frame.width,
    y: frameY / frame.height,
  };
}

/**
 * Converts a source-image-pixel corridor half-width into the SVG overlay
 * stroke width used by the manual seam corridor band.
 *
 * The manual overlay SVG uses viewBox "0 0 100 100" with
 * preserveAspectRatio="none", so a stroke expressed in user units renders
 * non-uniformly across x/y. For Phase 2O-B1 a wide translucent stroke that
 * tracks the polyline and is PROPORTIONAL to the source-pixel width is the
 * accepted representation (no offset-curve geometry).
 *
 * Pipeline: full band width in source px (2 * halfWidth) -> container px via the
 * object-cover scale (getCoverCrop) -> viewBox units using the average
 * per-pixel unit scale across both axes (so the isotropic SVG stroke
 * approximates the intended band on a non-square viewBox). The result is linear
 * in halfWidthSourcePx for a fixed image/frame context.
 *
 * Returns null for invalid dimensions or a non-positive/non-finite half-width.
 */
export function corridorHalfWidthToOverlayStrokeWidth(
  halfWidthSourcePx: number,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): number | null {
  if (!Number.isFinite(halfWidthSourcePx) || halfWidthSourcePx <= 0) return null;
  const crop = getCoverCrop(intrinsic, frame);
  if (!crop) return null;
  const fullWidthContainerPx = 2 * halfWidthSourcePx * crop.scale;
  const avgUnitsPerPx = (100 / frame.width + 100 / frame.height) / 2;
  return fullWidthContainerPx * avgUnitsPerPx;
}

export function normToPixels(point: FloorPoint, size: ImageIntrinsicSize | ImageFrameSize): PixelPoint | null {
  if (!isValidImageSize(size)) return null;
  return {
    x: clamp01(point.x) * size.width,
    y: clamp01(point.y) * size.height,
  };
}

export function pixelsToNorm(point: PixelPoint, size: ImageIntrinsicSize | ImageFrameSize): FloorPoint | null {
  if (!isValidImageSize(size)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: clamp01(point.x / size.width),
    y: clamp01(point.y / size.height),
  };
}
