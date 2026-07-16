// --- Phase 2O-G: Type A Coupled Diagnostic Search solver boundary -----------
// The ONLY new Phase 2O-G module permitted to import evaluateQuadSolvability.
// It is a thin, pure wrapper that:
// - evaluates a trial ONLY when trial.constraint.canEvaluate === true;
// - never mutates solver inputs, FOV scan behavior, or the Apply gate;
// - passes the trial's OWN diagnostic aspect-ratio dimensions and a probe FOV to
//   the solver (it never reads or writes live floor dimensions / FOV);
// - stores a TRIMMED solver summary plus the FOV corridors discovered by the
//   solver's existing internal scan;
// - maps the result to a TRUTHFUL primary state (classification, not ranking).
//
// Apply-gate information is preserved as a LABELLED diagnostic. It must NEVER be
// used to sort, rank, recommend, select, or apply a trial. The valid-pose FOV
// corridor, high-confidence FOV corridor, and single-probe Apply-gate diagnostic
// are kept separate and truthful.

import {
  evaluateQuadSolvability,
  type QuadSolvabilityFovScanConfig,
  type QuadSolvabilityInput,
  type QuadSolvabilityResult,
} from "./quad-solvability";
import type { ImageFrameSize } from "./image-space";
import type { QuadSolvabilitySummary } from "./manual-floor-support-trial-types";
import {
  type CoupledSearchFovCorridors,
  type CoupledSearchPrimaryState,
  type CoupledSearchResultSet,
  type CoupledSearchTrial,
} from "./manual-floor-support-coupled-search-types";
import {
  generateTypeACoupledSearch,
  type CoupledSearchGenerationInput,
} from "./manual-floor-support-coupled-search-generation";

// Search-grade FOV scan default. A coarser step than the display default (1 deg)
// halves internal scan cost; the scan still yields valid / high-confidence FOV
// corridors per (tNear, aspectRatio).
export const DEFAULT_COUPLED_SEARCH_FOV_SCAN_CONFIG: QuadSolvabilityFovScanConfig = {
  minFovDeg: 20,
  maxFovDeg: 90,
  stepDeg: 2,
};

export type CoupledSearchEvaluationContext = {
  frame: ImageFrameSize | null;
  // Probe FOV (deg) used for pose decomposition + the Apply-gate diagnostic.
  // The solver's internal scan independently sweeps the full FOV range to
  // produce the valid / high-confidence corridors.
  currentVerticalFovDeg: number;
  fovScanConfig: QuadSolvabilityFovScanConfig;
};

// Injectable solver evaluator (defaults to the real diagnostic solver). The
// indirection exists ONLY to keep this wrapper unit-testable; it changes no
// solver behavior.
export type CoupledQuadEvaluator = (input: QuadSolvabilityInput) => QuadSolvabilityResult;

export function summarizeCoupledSolver(result: QuadSolvabilityResult): {
  summary: QuadSolvabilitySummary;
  corridors: CoupledSearchFovCorridors;
} {
  return {
    summary: {
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
    },
    corridors: {
      valid: result.fovScan.validSampleIntervals,
      highConfidence: result.fovScan.highConfidenceSampleIntervals,
    },
  };
}

/**
 * Pure truthful state classification from a solver summary. NEVER ranks; only
 * classifies. (Callers must not treat "apply_safe_diagnostic" as a winner or a
 * recommendation; it is a diagnostic label.)
 */
export function coupledStateFromSolver(
  summary: QuadSolvabilitySummary
): CoupledSearchPrimaryState {
  if (!summary.poseAvailable) return "no_pose";
  if (summary.confidence !== "high") return "pose_poor";
  return summary.applyGateAvailable
    ? "apply_safe_diagnostic"
    : "high_confidence_not_apply_safe";
}

/**
 * Evaluates a single coupled-search trial through the diagnostic solver, but
 * ONLY when the pre-solver constraint gate permits it. Gate-rejected trials
 * (canEvaluate === false) are returned with state "invalid_geometry", solver
 * null, and fovCorridors null, and NEVER reach the evaluator.
 */
export function evaluateCoupledSearchTrial(
  trial: CoupledSearchTrial,
  context: CoupledSearchEvaluationContext,
  evaluator: CoupledQuadEvaluator = evaluateQuadSolvability
): CoupledSearchTrial {
  if (!trial.constraint.canEvaluate) {
    return { ...trial, state: "invalid_geometry", solver: null, fovCorridors: null };
  }
  const probeFov = context.currentVerticalFovDeg;
  const result = evaluator({
    quadNorm: trial.quadNorm,
    frameSize: context.frame,
    floorDimensions: { worldWidth: trial.worldWidth, worldDepth: trial.worldDepth },
    currentVerticalFovDeg: probeFov,
    fovScanConfig: context.fovScanConfig,
  });
  const { summary, corridors } = summarizeCoupledSolver(result);
  return {
    ...trial,
    tuple: { ...trial.tuple, fovDeg: probeFov },
    state: coupledStateFromSolver(summary),
    solver: summary,
    fovCorridors: corridors,
  };
}

/**
 * Evaluates every trial in a set, preserving generation order. Gate-rejected
 * trials are passed through with state "invalid_geometry" and solver null.
 */
export function evaluateCoupledSearchResultSet(
  set: CoupledSearchResultSet,
  context: CoupledSearchEvaluationContext,
  evaluator: CoupledQuadEvaluator = evaluateQuadSolvability
): CoupledSearchResultSet {
  return {
    ...set,
    trials: set.trials.map((trial) => evaluateCoupledSearchTrial(trial, context, evaluator)),
  };
}

/**
 * Convenience orchestrator: generate then evaluate. Returns null when no search
 * is appropriate (see generateTypeACoupledSearch). Pure aside from the solver
 * call; mutates no live state.
 */
export function runTypeACoupledSearch(
  input: CoupledSearchGenerationInput,
  context: CoupledSearchEvaluationContext,
  evaluator: CoupledQuadEvaluator = evaluateQuadSolvability
): CoupledSearchResultSet | null {
  const set = generateTypeACoupledSearch(input);
  if (!set) return null;
  return evaluateCoupledSearchResultSet(set, context, evaluator);
}
