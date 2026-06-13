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
