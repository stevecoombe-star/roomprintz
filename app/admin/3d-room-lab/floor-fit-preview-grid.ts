import {
  applyHomography,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  invertHomography,
  solvePlaneHomography,
} from "./perspective-solve";
import type { FloorPoint } from "./scene-state";

export type FloorFitPreviewGridOptions = {
  orderedCornersNorm: readonly [FloorPoint, FloorPoint, FloorPoint, FloorPoint];
  frameSize: { width: number; height: number };
  worldWidth: number;
  worldDepth: number;
  gridLineCount: number;
  samplesPerLine: number;
};

function isPositiveFiniteInteger(value: number, minimum: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= minimum;
}

/**
 * Builds the calibrated-camera Floor Fit preview grid from truthful,
 * container-normalized Floor geometry. This is display-only geometry: callers
 * must not use its preview homography for placement or solver policy.
 */
export function buildFloorFitPreviewGridPolylines({
  orderedCornersNorm,
  frameSize,
  worldWidth,
  worldDepth,
  gridLineCount,
  samplesPerLine,
}: FloorFitPreviewGridOptions): FloorPoint[][] {
  if (
    !Number.isFinite(frameSize.width) ||
    !Number.isFinite(frameSize.height) ||
    frameSize.width <= 0 ||
    frameSize.height <= 0 ||
    !isPositiveFiniteInteger(gridLineCount, 2) ||
    !isPositiveFiniteInteger(samplesPerLine, 1)
  ) {
    return [];
  }

  // This deliberately does not use normToPixels: preview geometry must retain
  // truthful off-frame Floor corners while placement remains clamped.
  const previewCornersPx = orderedCornersNorm.map((point) => ({
    x: point.x * frameSize.width,
    y: point.y * frameSize.height,
  }));
  if (!previewCornersPx.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return [];
  }

  const floorRectResult = getFloorRectCorners({
    widthMeters: worldWidth,
    depthMeters: worldDepth,
  });
  if (!floorRectResult.ok) return [];

  const previewSolve = solvePlaneHomography(
    previewCornersPx,
    floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point))
  );
  if (!previewSolve.ok) return [];

  const previewInverse = invertHomography(previewSolve.value);
  if (!previewInverse) return [];

  const halfWidth = worldWidth / 2;
  const halfDepth = worldDepth / 2;
  const lines: FloorPoint[][] = [];

  const projectFloorToPreviewNorm = (x: number, z: number): FloorPoint | null => {
    const projectedPx = applyHomography(previewInverse, { x, y: z });
    if (!projectedPx) return null;
    const normalized = {
      x: projectedPx.x / frameSize.width,
      y: projectedPx.y / frameSize.height,
    };
    return Number.isFinite(normalized.x) && Number.isFinite(normalized.y) ? normalized : null;
  };

  const addSampledLine = (
    axis: "x" | "z",
    fixedValue: number,
    variableMin: number,
    variableMax: number
  ) => {
    let currentSegment: FloorPoint[] = [];
    for (let sampleIndex = 0; sampleIndex <= samplesPerLine; sampleIndex += 1) {
      const t = sampleIndex / samplesPerLine;
      const variable = variableMin + (variableMax - variableMin) * t;
      const point =
        axis === "x"
          ? projectFloorToPreviewNorm(fixedValue, variable)
          : projectFloorToPreviewNorm(variable, fixedValue);
      if (point) {
        currentSegment.push(point);
      } else if (currentSegment.length >= 2) {
        lines.push(currentSegment);
        currentSegment = [];
      } else {
        currentSegment = [];
      }
    }
    if (currentSegment.length >= 2) lines.push(currentSegment);
  };

  for (let index = 0; index < gridLineCount; index += 1) {
    const t = index / (gridLineCount - 1);
    addSampledLine("x", -halfWidth + halfWidth * 2 * t, -halfDepth, halfDepth);
  }
  for (let index = 0; index < gridLineCount; index += 1) {
    const t = index / (gridLineCount - 1);
    addSampledLine("z", -halfDepth + halfDepth * 2 * t, -halfWidth, halfWidth);
  }

  return lines;
}
