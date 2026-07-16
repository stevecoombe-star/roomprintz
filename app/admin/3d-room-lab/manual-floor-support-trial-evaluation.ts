// --- Phase 2O-D: Constrained Diagnostic Trial solver boundary ---------------
// The ONLY new Phase 2O-D module permitted to import evaluateQuadSolvability.
// It is a thin, pure wrapper that:
// - evaluates a trial ONLY when trial.constraint.canEvaluate === true;
// - never mutates solver inputs, FOV scan behavior, or the Apply gate;
// - stores a TRIMMED summary only.
//
// Apply-gate information is preserved as a LABELLED diagnostic. It must NEVER be
// used to sort, rank, recommend, select, or apply a trial.

import {
  evaluateQuadSolvability,
  type QuadSolvabilityFovScanConfig,
  type QuadSolvabilityResult,
} from "./quad-solvability";
import type { ImageFrameSize } from "./image-space";
import type {
  ManualFloorSupportTrial,
  ManualFloorSupportTrialSet,
  QuadSolvabilitySummary,
} from "./manual-floor-support-trial-types";

export type TrialEvaluationContext = {
  frame: ImageFrameSize | null;
  floorDimensions: { worldWidth: number; worldDepth: number };
  currentVerticalFovDeg: number;
  fovScanConfig: QuadSolvabilityFovScanConfig;
};

function summarize(result: QuadSolvabilityResult): QuadSolvabilitySummary {
  return {
    poseAvailable: result.poseAvailable,
    confidence: result.confidence,
    cv: { averagePx: result.cv.averagePx, maximumPx: result.cv.maximumPx },
    rendered: {
      averagePx: result.rendered.averagePx,
      maximumPx: result.rendered.maximumPx,
    },
    delta: { averagePx: result.delta.averagePx, maximumPx: result.delta.maximumPx },
    worstCorner: result.worstCorner.cv,
    applyGateAvailable: result.applyEvaluation.available,
    applyGateReason: result.applyEvaluation.reason,
  };
}

/**
 * Evaluates a single trial through the existing diagnostic solver, but ONLY when
 * the pre-solver constraint gate permits it. Rejected trials (canEvaluate ===
 * false) are returned unchanged with solver === null and NEVER reach
 * evaluateQuadSolvability.
 */
export function evaluateManualFloorSupportTrial(
  trial: ManualFloorSupportTrial,
  context: TrialEvaluationContext
): ManualFloorSupportTrial {
  if (!trial.constraint.canEvaluate) {
    return { ...trial, solver: null };
  }
  const result = evaluateQuadSolvability({
    quadNorm: trial.quadNorm,
    frameSize: context.frame,
    floorDimensions: context.floorDimensions,
    currentVerticalFovDeg: context.currentVerticalFovDeg,
    fovScanConfig: context.fovScanConfig,
  });
  return { ...trial, solver: summarize(result) };
}

/**
 * Evaluates every trial in a set, preserving generation order. Gate-rejected
 * trials are passed through with solver === null.
 */
export function evaluateManualFloorSupportTrialSet(
  set: ManualFloorSupportTrialSet,
  context: TrialEvaluationContext
): ManualFloorSupportTrialSet {
  return {
    ...set,
    trials: set.trials.map((trial) => evaluateManualFloorSupportTrial(trial, context)),
  };
}
