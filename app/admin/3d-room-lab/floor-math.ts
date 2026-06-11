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
