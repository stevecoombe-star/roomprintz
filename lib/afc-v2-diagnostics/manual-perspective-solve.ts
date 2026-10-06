/**
 * AFR-4A calibration for one manually corrected source-image floor quad.
 *
 * The quad is the image target. Ratio, the centered world rectangle, vertical
 * FOV, and the camera pose come from the production settle and the same
 * quad-solvability pose production freezes. referenceDepthM stays the
 * automatic metric depth. metricScale is not applied here.
 */

import { settleAfcFixedSeamCalibrationWithRatioExtension } from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import { evaluateQuadSolvability } from "@/app/admin/3d-room-lab/quad-solvability";

import {
  canonicalWorldRectangle,
  cloneManualPerspectiveImagePoints,
  quadFromImagePoints,
  type ManualPerspectiveImagePoints,
  type ManualPerspectiveVec3,
  type ManualPerspectiveWorldRectangle,
} from "./manual-perspective-geometry";

export type ManualPerspectiveSolveStatus = "converged" | "unrealizable" | "error";

export type ManualPerspectiveSolvedPose = Readonly<{
  position: ManualPerspectiveVec3;
  lookAt: ManualPerspectiveVec3;
  up: ManualPerspectiveVec3;
}>;

export type ManualPerspectiveSolveResult = Readonly<{
  status: ManualPerspectiveSolveStatus;
  imagePoints: ManualPerspectiveImagePoints;
  worldRectangle: ManualPerspectiveWorldRectangle | null;
  verticalFovDeg: number | null;
  pose: ManualPerspectiveSolvedPose | null;
  objectivePx: number | null;
  iterationCount: number;
  convergenceReason: string;
  elapsedMs: number;
  applySafe: boolean;
}>;

export type ManualPerspectiveSolveInput = Readonly<{
  imagePoints: ManualPerspectiveImagePoints;
  sourceImageSize: Readonly<{ width: number; height: number }>;
  frameSize: Readonly<{ width: number; height: number }>;
  referenceDepthM: number;
}>;

export function solveManualPerspectiveCalibration(
  input: ManualPerspectiveSolveInput,
): ManualPerspectiveSolveResult {
  const started = performance.now();
  const imagePoints = cloneManualPerspectiveImagePoints(input.imagePoints);
  const unrealizable = (
    reason: string,
    iterationCount = 0,
  ): ManualPerspectiveSolveResult =>
    Object.freeze({
      status: "unrealizable",
      imagePoints,
      worldRectangle: null,
      verticalFovDeg: null,
      pose: null,
      objectivePx: null,
      iterationCount,
      convergenceReason: reason.slice(0, 80),
      elapsedMs: performance.now() - started,
      applySafe: false,
    });

  try {
    const settle = settleAfcFixedSeamCalibrationWithRatioExtension({
      sourceNormalizedPolygon: quadFromImagePoints(imagePoints),
      sourceImageSize: input.sourceImageSize,
      frameSize: input.frameSize,
      referenceDepthM: input.referenceDepthM,
    });
    if (!settle.ok || !settle.applyObservability.available) {
      return unrealizable(
        settle.ok ? "settle_not_apply_safe" : settle.reason,
        settle.evaluatedCellCount,
      );
    }
    if (settle.referenceDepthM !== input.referenceDepthM) {
      return unrealizable("reference_depth_changed", settle.evaluatedCellCount);
    }
    const worldRectangle = canonicalWorldRectangle(
      settle.worldWidthM,
      settle.referenceDepthM,
    );
    if (
      !worldRectangle ||
      Math.abs(worldRectangle.widthDepthRatio - settle.widthDepthRatio) > 1e-9
    ) {
      return unrealizable("world_rectangle_invalid", settle.evaluatedCellCount);
    }
    const solved = evaluateQuadSolvability({
      quadNorm: quadFromImagePoints(imagePoints).map((point) => ({
        x: point.x,
        y: point.y,
      })),
      frameSize: input.frameSize,
      floorDimensions: {
        worldWidth: settle.worldWidthM,
        worldDepth: settle.worldDepthM,
      },
      currentVerticalFovDeg: settle.verticalFovDeg,
      fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
    });
    const candidate = solved.applyCandidate;
    if (!candidate || !solved.applyEvaluation.available || !candidate.pose) {
      return unrealizable(
        solved.applyEvaluation.reason || "pose_not_apply_safe",
        settle.evaluatedCellCount,
      );
    }
    const pose = candidate.pose;
    return Object.freeze({
      status: "converged",
      imagePoints,
      worldRectangle,
      verticalFovDeg: settle.verticalFovDeg,
      pose: Object.freeze({
        position: freezeVec(pose.position),
        lookAt: freezeVec(pose.lookAt),
        up: freezeVec(pose.up),
      }),
      objectivePx: settle.applyObservability.displayAvgPx,
      iterationCount: settle.evaluatedCellCount,
      convergenceReason: "apply_safe",
      elapsedMs: performance.now() - started,
      applySafe: true,
    });
  } catch {
    return Object.freeze({
      status: "error",
      imagePoints,
      worldRectangle: null,
      verticalFovDeg: null,
      pose: null,
      objectivePx: null,
      iterationCount: 0,
      convergenceReason: "solve_threw",
      elapsedMs: performance.now() - started,
      applySafe: false,
    });
  }
}

function freezeVec(value: { x: number; y: number; z: number }): ManualPerspectiveVec3 {
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}
