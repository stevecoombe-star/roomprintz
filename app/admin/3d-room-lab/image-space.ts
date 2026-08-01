import type { FloorPoint } from "./scene-state";

// AFC-CP1A coordinate-transform policy
// ------------------------------------
// This module exposes two families of transforms:
//
//   Clamped helpers (containerNormToSourceNorm, sourceNormToContainerNorm,
//   normToPixels, pixelsToNorm) are UI-SAFE helpers. They keep interactive
//   overlays, pointer input, and display geometry inside the visible frame,
//   and they intentionally destroy magnitude outside [0,1].
//
//   Unclamped helpers (containerNormToSourceNormUnclamped,
//   sourceNormToContainerNormUnclamped, normToPixelsUnclamped) are
//   GEOMETRY/AUTHORITY transforms. They are exact, lossless, and mutually
//   inverse, and they preserve coordinates outside [0,1].
//
// Who uses which, as of AFC-CP1A:
//
//   FLOOR authority projection uses the UNCLAMPED transforms. The Floor
//   source-normalized polygon is the canonical authority, and a clamped round
//   trip through container space silently rewrote an untouched source corner
//   whenever the image aspect differed from the frame aspect. Only the
//   Floor-specific projection callbacks are wired this way.
//
//   WALL, CEILING, seam, Type B, Empty-Room-Assist, and every other ordinary
//   UI-safe overlay stay on the CLAMPED transforms. Their derived container
//   polygons remain inside [0,1], so their handles stay reachable and no
//   boundary proxy is needed. AFC-CP1A did NOT switch them.
//
//   FLOOR HANDLES are drawn through a presentation-only boundary proxy (see
//   floor-handle-presentation.ts). Only the rendered element and its hit
//   target are clamped; the Floor polygon outline and Floor state keep the
//   truthful unclamped coordinate.
//
//   SOLVER INPUT remains clamped in AFC-CP1A. normToPixelsUnclamped is
//   additive scaffolding with no caller; quad solvability still uses
//   normToPixels.
//
// The unclamped transforms are raw mathematical transforms and stay that way.
// Removing one-ULP noise around a semantic image boundary is a separate,
// Floor-only concern handled by canonicalizeSourceUnitBoundaryPoint in
// floor-coordinate-extent.ts, never inside this module.

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

/**
 * UI-safe helper. Clamps both the container input and the source output to
 * [0,1]. Not an authority transform: see containerNormToSourceNormUnclamped.
 */
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

/**
 * UI-safe helper. Clamps both the source input and the container output to
 * [0,1]. Not an authority transform: see sourceNormToContainerNormUnclamped.
 */
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
 * Three distinct call sites are sanctioned, and they must not be conflated:
 *
 *   1. Truthful authority-derived geometry projection. The canonical Floor
 *      source/container projection pair (AFC-CP1A) and the untrusted-model raw
 *      coordinate conversion (Phase 2F vision, ahead of the Phase 2F-B
 *      validator's own clamp/reject policy) both use this helper. Any path
 *      whose output must remain a faithful, invertible image of the source
 *      geometry belongs here.
 *
 *   2. Ordinary UI-safe overlays. Wall, Ceiling, seam, Type B, and
 *      Empty-Room-Assist overlays intentionally stay inside the frame and keep
 *      using the clamping sourceNormToContainerNorm. AFC-CP1A did not switch
 *      them, and they have no boundary-proxy handles because they never need
 *      one. Do not switch them.
 *
 *   3. Presentation-only proxy handles. An interactive Floor handle whose
 *      truthful container coordinate falls outside the frame is DRAWN at a
 *      clamped boundary target so it stays visible and reachable (see
 *      floor-handle-presentation.ts). That clamp applies to the rendered
 *      element and its hit target only; the polygon outline and the underlying
 *      Floor state keep the truthful unclamped coordinate.
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
 * AFC-CP1A authority transform: the exact mathematical inverse of
 * sourceNormToContainerNormUnclamped.
 *
 * Uses the same object-cover crop math (getCoverCrop) as every other helper in
 * this module, but clamps neither the container-normalized input nor the
 * source-normalized output, so a Floor corner that projects outside the visible
 * frame survives a container round trip with full precision.
 *
 * Returns null for invalid/non-finite dimensions, a non-finite point, or a
 * non-finite result.
 */
export function containerNormToSourceNormUnclamped(
  point: FloorPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint | null {
  const crop = getCoverCrop(intrinsic, frame);
  if (!crop) return null;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  // No clamp on the container-normalized input.
  const frameX = point.x * frame.width;
  const frameY = point.y * frame.height;

  const sourceX = (frameX - crop.offsetX) / crop.scale;
  const sourceY = (frameY - crop.offsetY) / crop.scale;

  // No clamp on the source-normalized output.
  const x = sourceX / intrinsic.width;
  const y = sourceY / intrinsic.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
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

// --- Phase 2O-D: unclamped diagnostic source -> container conversion ---------
// Additive, pure helper used ONLY by the constrained diagnostic trial pipeline.
// It converts a source-image-normalized point into container-normalized space
// using the SAME object-cover crop math (getCoverCrop) as the clamping helpers,
// but DOES NOT clamp. This lets the trial pre-solver gate distinguish an
// off-frame sample (which must be hard-rejected before the solver) from a valid
// in-frame sample, instead of silently snapping it to the frame edge.
//
// This must NOT replace sourceNormToContainerNorm for ordinary
// UI/interaction/display conversion, which intentionally clamps to keep
// editable overlays inside the frame. It is appropriate for read-only
// diagnostic/evidence projections that must truthfully preserve off-frame
// coordinates for operator inspection.
export type SourceToContainerDiagnostic = {
  // Unclamped container-normalized coordinate (may be outside [0,1]).
  container: FloorPoint;
  // True only if both x and y land within [0,1].
  visibleInFrame: boolean;
  // Non-negative worst-axis overshoot beyond [0,1]; 0 when visibleInFrame.
  maxOvershoot: number;
};

export function sourceNormToContainerNormDiagnostic(
  point: FloorPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): SourceToContainerDiagnostic | null {
  const crop = getCoverCrop(intrinsic, frame);
  if (!crop) return null;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  // No clamp on the source-normalized input.
  const sourceX = point.x * intrinsic.width;
  const sourceY = point.y * intrinsic.height;

  const frameX = sourceX * crop.scale + crop.offsetX;
  const frameY = sourceY * crop.scale + crop.offsetY;

  // No clamp on the container-normalized output.
  const container: FloorPoint = {
    x: frameX / frame.width,
    y: frameY / frame.height,
  };

  const overshoot = Math.max(
    0,
    -container.x,
    container.x - 1,
    -container.y,
    container.y - 1
  );
  const visibleInFrame = overshoot === 0;

  return {
    container,
    visibleInFrame,
    maxOvershoot: overshoot,
  };
}

/**
 * UI-safe helper. Clamps the normalized input to [0,1] before scaling.
 * Not an authority transform: see normToPixelsUnclamped.
 */
export function normToPixels(point: FloorPoint, size: ImageIntrinsicSize | ImageFrameSize): PixelPoint | null {
  if (!isValidImageSize(size)) return null;
  return {
    x: clamp01(point.x) * size.width,
    y: clamp01(point.y) * size.height,
  };
}

/**
 * AFC-CP1A authority helper: normalized -> pixels with no clamp, so negative
 * and greater-than-one coordinates keep their magnitude.
 *
 * Additive scaffolding. No solver caller is switched to it in AFC-CP1A; the
 * existing clamped normToPixels remains the solver input path for now.
 *
 * Follows this module's invalid-input convention and returns null for an
 * invalid size or a non-finite point.
 */
export function normToPixelsUnclamped(
  point: FloorPoint,
  size: ImageIntrinsicSize | ImageFrameSize
): PixelPoint | null {
  if (!isValidImageSize(size)) return null;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: point.x * size.width,
    y: point.y * size.height,
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
