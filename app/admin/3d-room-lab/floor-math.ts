import type {
  FloorMappingState,
  FloorPoint,
  PerspectiveDepthScalingState,
} from "./scene-state";

export const DEFAULT_FLOOR_MAPPING: FloorMappingState = {
  worldWidth: 4,
  worldDepth: 4,
  depthCenterY: 0.75,
};

export const FLOOR_MAPPING_LIMITS = {
  worldWidth: { min: 0.5, max: 12, step: 0.1 },
  worldDepth: { min: 0.5, max: 12, step: 0.1 },
  depthCenterY: { min: 0, max: 1, step: 0.01 },
} as const;

export const DEFAULT_PERSPECTIVE_DEPTH_SCALING: PerspectiveDepthScalingState = {
  enabled: false,
  nearScaleMultiplier: 1.25,
  farScaleMultiplier: 0.75,
  nearFloorY: 0.95,
  farFloorY: 0.72,
};

export const PERSPECTIVE_DEPTH_SCALING_LIMITS = {
  nearScaleMultiplier: { min: 0.5, max: 2.5, step: 0.05 },
  farScaleMultiplier: { min: 0.25, max: 1.5, step: 0.05 },
  nearFloorY: { min: 0, max: 1, step: 0.01 },
  farFloorY: { min: 0, max: 1, step: 0.01 },
} as const;

export function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// --- Phase 2I-C1: calibrated vertical lift mapping -------------------------
// Pure, camera-aware mapping for calibrated Height/Lift. The caller projects a
// world-vertical reference segment (both endpoints share the object's X/Z and
// differ only in world Y by `refWorldYSpan`) through the active camera and passes
// the resulting screen-pixel endpoints. This helper derives the screen-space
// "up in world" direction + sensitivity from that segment and maps pointer travel
// projected onto that direction to a delta in world Y. Motion is therefore
// constrained to the world Y axis (never free ray movement). Pure; never throws.

export type ScreenPoint = { x: number; y: number };

export type CalibratedVerticalLiftMappingResult =
  | { ok: true; deltaWorldY: number }
  | { ok: false; reason: string };

export type CalibratedVerticalLiftMappingInput = {
  // Screen-pixel projection of the lower world-Y reference endpoint.
  refLowScreenPx: ScreenPoint;
  // Screen-pixel projection of the higher world-Y reference endpoint.
  refHighScreenPx: ScreenPoint;
  // World-Y span between the two reference endpoints (refHigh - refLow). Must be
  // finite and > 0; this calibrates world-units-per-screen-pixel.
  refWorldYSpan: number;
  // Pointer screen-pixel position captured at gesture start.
  startPointerPx: ScreenPoint;
  // Pointer screen-pixel position at the current move event.
  currentPointerPx: ScreenPoint;
  // Smallest acceptable projected segment length (px) before the projection is
  // treated as degenerate (camera nearly aligned with the world vertical axis).
  minScreenSegmentPx?: number;
};

// --- Phase 2I-C1A/C1B: calibrated Lift viewport eligibility + handle placement
// Pure helpers for keeping the calibrated Lift handle on-screen and clear of the
// other calibrated handles. No THREE / DOM dependencies; never throw.

export type Vec2 = { x: number; y: number };

// Phase 2I-C1B: baseline visibility test. A projected normalized point is
// "visible" when it is finite and inside the ACTUAL viewport [0,1] (with an
// optional tiny tolerance for floating-point stability). This is intentionally
// NOT a conservative inset — a floor anchor near the viewport edge is still a
// valid placement and must not, by itself, disable Lift.
export function isWithinViewportBounds(normalized: Vec2 | null, tolerance = 0): boolean {
  if (!normalized) return false;
  if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) return false;
  const t = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;
  return (
    normalized.x >= -t &&
    normalized.x <= 1 + t &&
    normalized.y >= -t &&
    normalized.y <= 1 + t
  );
}

export type ViewportSafeHandleSelection = {
  offset: Vec2;
  center: Vec2;
  separation: number;
  withinViewport: boolean;
  ideal: boolean;
  available: boolean;
  reason: string;
};

// Phase 2I-C1B: deterministic, viewport-aware handle-offset selection. A
// candidate is *usable* only when its resulting handle center lies inside the
// safe on-screen interaction inset [inset, viewportSize - inset]. Among usable
// candidates we prefer (in preferred-first order) the first that is also clear
// of every obstacle by `minSeparation`; otherwise we keep the usable candidate
// with the greatest obstacle separation (so the handle stays reachable even in a
// crowded corner). If NO candidate is usable (handle center can't be made
// visible/reachable), the result is `available: false` with a precise reason.
// Pure + deterministic => the preferred offset is retained whenever it stays
// usable, so there is no per-frame jitter.
export function selectViewportSafeHandleOffset(input: {
  anchor: Vec2; // handle anchor in viewBox units (0..viewportSize)
  candidateOffsets: Vec2[];
  obstacles: Vec2[];
  minSeparation: number;
  viewportSize: number;
  viewportInset: number;
}): ViewportSafeHandleSelection {
  const { anchor, candidateOffsets, obstacles, minSeparation, viewportSize, viewportInset } = input;
  const fallbackOffset = candidateOffsets[0] ?? { x: 0, y: 0 };
  const lo = viewportInset;
  const hi = viewportSize - viewportInset;

  let bestUsable:
    | { offset: Vec2; center: Vec2; separation: number }
    | null = null;

  for (const offset of candidateOffsets) {
    const center = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    const withinViewport = center.x >= lo && center.x <= hi && center.y >= lo && center.y <= hi;
    if (!withinViewport) continue;
    let minDist = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
      const dist = Math.hypot(center.x - obstacle.x, center.y - obstacle.y);
      if (dist < minDist) minDist = dist;
    }
    if (minDist >= minSeparation) {
      return {
        offset,
        center,
        separation: minDist,
        withinViewport: true,
        ideal: true,
        available: true,
        reason: "clear",
      };
    }
    if (!bestUsable || minDist > bestUsable.separation) {
      bestUsable = { offset, center, separation: minDist };
    }
  }

  if (bestUsable) {
    return {
      offset: bestUsable.offset,
      center: bestUsable.center,
      separation: bestUsable.separation,
      withinViewport: true,
      ideal: false,
      available: true,
      reason: "inward (best separation)",
    };
  }

  return {
    offset: fallbackOffset,
    center: { x: anchor.x + fallbackOffset.x, y: anchor.y + fallbackOffset.y },
    separation: 0,
    withinViewport: false,
    ideal: false,
    available: false,
    reason: "no on-screen handle placement",
  };
}

export function mapPointerTravelToWorldYDelta(
  input: CalibratedVerticalLiftMappingInput
): CalibratedVerticalLiftMappingResult {
  const {
    refLowScreenPx,
    refHighScreenPx,
    refWorldYSpan,
    startPointerPx,
    currentPointerPx,
    minScreenSegmentPx = 1e-3,
  } = input;

  const allFinite = [
    refLowScreenPx.x,
    refLowScreenPx.y,
    refHighScreenPx.x,
    refHighScreenPx.y,
    refWorldYSpan,
    startPointerPx.x,
    startPointerPx.y,
    currentPointerPx.x,
    currentPointerPx.y,
  ].every((value) => Number.isFinite(value));
  if (!allFinite) {
    return { ok: false, reason: "non-finite mapping geometry" };
  }
  if (refWorldYSpan <= 0) {
    return { ok: false, reason: "invalid world-Y reference span" };
  }

  // Screen vector pointing in the direction of increasing world Y.
  const screenVecX = refHighScreenPx.x - refLowScreenPx.x;
  const screenVecY = refHighScreenPx.y - refLowScreenPx.y;
  const screenLen = Math.hypot(screenVecX, screenVecY);
  if (!Number.isFinite(screenLen) || screenLen < minScreenSegmentPx) {
    return { ok: false, reason: "degenerate vertical projection" };
  }

  const unitX = screenVecX / screenLen;
  const unitY = screenVecY / screenLen;
  const worldPerScreenPixel = refWorldYSpan / screenLen;

  const pointerDx = currentPointerPx.x - startPointerPx.x;
  const pointerDy = currentPointerPx.y - startPointerPx.y;
  // Signed pointer travel along the world-up screen direction.
  const travelAlongUp = pointerDx * unitX + pointerDy * unitY;
  const deltaWorldY = travelAlongUp * worldPerScreenPixel;

  if (!Number.isFinite(deltaWorldY)) {
    return { ok: false, reason: "non-finite world-Y delta" };
  }

  return { ok: true, deltaWorldY };
}

export function isPointInsidePolygon(point: FloorPoint, polygon: FloorPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function mapFloorPointToObjectTransform(
  point: FloorPoint,
  mapping: FloorMappingState
): { positionX: number; positionZ: number } {
  return {
    positionX: (point.x - 0.5) * mapping.worldWidth,
    positionZ: (point.y - mapping.depthCenterY) * mapping.worldDepth,
  };
}

export function getDepthScaleMultiplier(
  anchorY: number | null,
  settings: PerspectiveDepthScalingState
): number {
  if (!settings.enabled) return 1;
  if (anchorY === null || !Number.isFinite(anchorY)) return 1;
  const denominator = settings.nearFloorY - settings.farFloorY;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < Number.EPSILON) {
    return settings.nearScaleMultiplier;
  }
  const rawT = (anchorY - settings.farFloorY) / denominator;
  const t = clampValue(rawT, 0, 1);
  return settings.farScaleMultiplier + t * (settings.nearScaleMultiplier - settings.farScaleMultiplier);
}

export function getEffectiveObjectScale(
  baseScale: number,
  anchor: FloorPoint | null,
  settings: PerspectiveDepthScalingState
): number {
  return baseScale * getDepthScaleMultiplier(anchor?.y ?? null, settings);
}

export function getDepthNearFarOrderingInfo(
  settings: PerspectiveDepthScalingState
): { isValid: boolean; warning: string | null } {
  const isValid = settings.nearFloorY >= settings.farFloorY;
  return {
    isValid,
    warning: isValid
      ? null
      : "Near floor Y is above Far floor Y. This inverts depth scaling semantics.",
  };
}

// --- Phase 0P-A: Auto-fit from floor polygon -------------------------------
// Pure heuristics that derive initial floor mapping + perspective depth
// scaling from the editable floor polygon. These are intentionally
// approximate (no camera solve, no homography) and exist to reduce manual
// tuning. All outputs are clamped to the existing limits above.

export const ASSUMED_FRONT_EDGE_METERS = 3.5;
export const DEPTH_BOOST = 2.0;
export const MIN_EDGE_WIDTH_NORM = 0.02;
export const MIN_DEPTH_EXTENT_NORM = 0.03;
export const MAX_WIDTH_RATIO = 6;
export const MIN_RATIO_FOR_DEPTH = 1.05;

export type DeriveResult<T> =
  | { ok: true; value: T; confidence: "high" | "low"; note?: string }
  | { ok: false; reason: string };

export type FloorQuadMetrics = {
  nearEdgeY: number;
  farEdgeY: number;
  nearWidthNorm: number;
  farWidthNorm: number;
  depthExtentNorm: number;
  centroidY: number;
  isConvex: boolean;
};

function meanY(points: FloorPoint[]): number {
  return points.reduce((sum, point) => sum + point.y, 0) / points.length;
}

function horizontalExtent(points: FloorPoint[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
  }
  return maxX - minX;
}

function polygonSignedArea(points: FloorPoint[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return area / 2;
}

function isPolygonConvex(points: FloorPoint[]): boolean {
  const n = points.length;
  if (n < 4) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c = points[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (currentSign !== sign) {
      return false;
    }
  }
  return true;
}

export function inferFloorQuadMetrics(
  polygon: FloorPoint[]
): { ok: true; metrics: FloorQuadMetrics } | { ok: false; reason: string } {
  if (!Array.isArray(polygon) || polygon.length < 4) {
    return { ok: false, reason: "Floor polygon needs at least 4 corners for auto-fit." };
  }
  for (const point of polygon) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { ok: false, reason: "Floor polygon has invalid points." };
    }
  }

  const area = Math.abs(polygonSignedArea(polygon));
  if (!Number.isFinite(area) || area < 1e-4) {
    return { ok: false, reason: "Floor polygon area is degenerate." };
  }

  const centroidY = meanY(polygon);
  const sorted = [...polygon].sort((a, b) => a.y - b.y);

  let farPts: FloorPoint[];
  let nearPts: FloorPoint[];
  if (polygon.length === 4) {
    farPts = [sorted[0], sorted[1]];
    nearPts = [sorted[2], sorted[3]];
  } else {
    const yMin = sorted[0].y;
    const yMax = sorted[sorted.length - 1].y;
    const band = (yMax - yMin) * 0.25;
    let far = sorted.filter((point) => point.y <= yMin + band);
    let near = sorted.filter((point) => point.y >= yMax - band);
    if (far.length < 2) far = [sorted[0], sorted[1]];
    if (near.length < 2) near = [sorted[sorted.length - 2], sorted[sorted.length - 1]];
    farPts = far;
    nearPts = near;
  }

  const nearWidthNorm = horizontalExtent(nearPts);
  const farWidthNorm = horizontalExtent(farPts);
  const nearEdgeY = meanY(nearPts);
  const farEdgeY = meanY(farPts);
  const depthExtentNorm = nearEdgeY - farEdgeY;

  if (
    !Number.isFinite(nearWidthNorm) ||
    !Number.isFinite(farWidthNorm) ||
    !Number.isFinite(nearEdgeY) ||
    !Number.isFinite(farEdgeY) ||
    !Number.isFinite(depthExtentNorm)
  ) {
    return { ok: false, reason: "Floor polygon produced non-finite metrics." };
  }

  return {
    ok: true,
    metrics: {
      nearEdgeY,
      farEdgeY,
      nearWidthNorm,
      farWidthNorm,
      depthExtentNorm,
      centroidY,
      isConvex: isPolygonConvex(polygon),
    },
  };
}

export function deriveFloorMappingFromPolygon(
  polygon: FloorPoint[]
): DeriveResult<FloorMappingState> {
  const inferred = inferFloorQuadMetrics(polygon);
  if (!inferred.ok) return { ok: false, reason: inferred.reason };
  const metrics = inferred.metrics;

  if (metrics.nearWidthNorm < MIN_EDGE_WIDTH_NORM) {
    return { ok: false, reason: "Near floor edge is too narrow to estimate world size." };
  }
  if (metrics.depthExtentNorm < MIN_DEPTH_EXTENT_NORM) {
    return { ok: false, reason: "Floor polygon is too shallow to estimate depth." };
  }

  const worldWidth = clampValue(
    ASSUMED_FRONT_EDGE_METERS / Math.max(metrics.nearWidthNorm, MIN_EDGE_WIDTH_NORM),
    FLOOR_MAPPING_LIMITS.worldWidth.min,
    FLOOR_MAPPING_LIMITS.worldWidth.max
  );
  const worldDepth = clampValue(
    worldWidth *
      (metrics.depthExtentNorm / Math.max(metrics.nearWidthNorm, MIN_EDGE_WIDTH_NORM)) *
      DEPTH_BOOST,
    FLOOR_MAPPING_LIMITS.worldDepth.min,
    FLOOR_MAPPING_LIMITS.worldDepth.max
  );
  const depthCenterY = clampValue(
    metrics.centroidY,
    FLOOR_MAPPING_LIMITS.depthCenterY.min,
    FLOOR_MAPPING_LIMITS.depthCenterY.max
  );

  if (
    !Number.isFinite(worldWidth) ||
    !Number.isFinite(worldDepth) ||
    !Number.isFinite(depthCenterY)
  ) {
    return { ok: false, reason: "Derived floor mapping was non-finite." };
  }

  const confidence: "high" | "low" = metrics.isConvex ? "high" : "low";
  const note = metrics.isConvex
    ? undefined
    : "Floor polygon is concave; mapping estimate may be rough.";
  return { ok: true, value: { worldWidth, worldDepth, depthCenterY }, confidence, note };
}

export function deriveDepthScalingFromPolygon(
  polygon: FloorPoint[]
): DeriveResult<PerspectiveDepthScalingState> {
  const inferred = inferFloorQuadMetrics(polygon);
  if (!inferred.ok) return { ok: false, reason: inferred.reason };
  const metrics = inferred.metrics;

  if (metrics.nearWidthNorm < MIN_EDGE_WIDTH_NORM || metrics.farWidthNorm < MIN_EDGE_WIDTH_NORM) {
    return { ok: false, reason: "Floor edges are too narrow to estimate depth scaling." };
  }
  if (metrics.depthExtentNorm < MIN_DEPTH_EXTENT_NORM) {
    return { ok: false, reason: "Floor polygon is too shallow to estimate depth scaling." };
  }

  const nearFloorY = clampValue(
    metrics.nearEdgeY,
    PERSPECTIVE_DEPTH_SCALING_LIMITS.nearFloorY.min,
    PERSPECTIVE_DEPTH_SCALING_LIMITS.nearFloorY.max
  );
  const farFloorY = clampValue(
    metrics.farEdgeY,
    PERSPECTIVE_DEPTH_SCALING_LIMITS.farFloorY.min,
    PERSPECTIVE_DEPTH_SCALING_LIMITS.farFloorY.max
  );

  // Floor narrows toward the camera (atypical perspective): keep depth off.
  if (metrics.nearWidthNorm < metrics.farWidthNorm) {
    const neutralNear = clampValue(
      1,
      PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.min,
      PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.max
    );
    const neutralFar = clampValue(
      1,
      PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.min,
      PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.max
    );
    return {
      ok: true,
      value: {
        enabled: false,
        nearScaleMultiplier: neutralNear,
        farScaleMultiplier: neutralFar,
        nearFloorY,
        farFloorY,
      },
      confidence: "low",
      note: "Floor narrows toward camera; depth scaling left off.",
    };
  }

  const rawRatio = metrics.nearWidthNorm / Math.max(metrics.farWidthNorm, MIN_EDGE_WIDTH_NORM);
  const widthRatio = clampValue(rawRatio, 1 / MAX_WIDTH_RATIO, MAX_WIDTH_RATIO);
  const ratioWasClamped = rawRatio > MAX_WIDTH_RATIO;

  const nearScaleMultiplier = clampValue(
    Math.sqrt(widthRatio),
    PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.min,
    PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.max
  );
  const farScaleMultiplier = clampValue(
    1 / Math.sqrt(widthRatio),
    PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.min,
    PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.max
  );

  if (
    !Number.isFinite(nearScaleMultiplier) ||
    !Number.isFinite(farScaleMultiplier) ||
    !Number.isFinite(nearFloorY) ||
    !Number.isFinite(farFloorY)
  ) {
    return { ok: false, reason: "Derived depth scaling was non-finite." };
  }

  const hasMeaningfulPerspective = widthRatio >= MIN_RATIO_FOR_DEPTH;
  const enabled = hasMeaningfulPerspective && metrics.isConvex;

  let confidence: "high" | "low" = "high";
  let note: string | undefined;
  if (!metrics.isConvex) {
    confidence = "low";
    note = "Floor polygon is concave; depth scaling left off.";
  } else if (ratioWasClamped) {
    confidence = "low";
    note = "Extreme perspective ratio was clamped.";
  } else if (!hasMeaningfulPerspective) {
    confidence = "low";
    note = "Floor has little perspective; depth scaling left off.";
  }

  return {
    ok: true,
    value: { enabled, nearScaleMultiplier, farScaleMultiplier, nearFloorY, farFloorY },
    confidence,
    note,
  };
}
