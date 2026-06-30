// --- Phase 2O-K-A: Type A Local Refinement solver boundary ------------------
// The ONLY new Phase 2O-K-A module permitted to import the solver. It is a thin,
// pure wrapper that:
// - evaluates a geometry tuple ONLY when constraint.canEvaluate === true;
// - runs the existing solver (with its full internal FOV scan) EXACTLY ONCE per
//   evaluable geometry tuple, at the seed's probe FOV, to obtain the geometry
//   state + the valid / high-confidence FOV corridors;
// - then, ONLY for tuples whose HIGH-CONFIDENCE corridor intersects a configured
//   FOV probe, runs bounded DIRECT Apply-gate probes using a degenerate
//   single-FOV scan config (min === max), so it never re-runs the full scan once
//   per probe;
// - enforces a deterministic global cap on direct probe evaluations, truncating
//   trailing probes in generation order (never ranking or metric-skipping);
// - never mutates solver inputs, FOV scan behavior, the Apply gate, or any live
//   state (candidate / floorPolygon / FOV / dimensions / calibration / scene).
//
// Geometry-level corridors and per-probe Apply-gate outcomes are kept DISTINCT
// and truthful. A high-confidence corridor NEVER implies Apply-safe.

import {
  evaluateQuadSolvability,
  type QuadSolvabilityFovScanConfig,
} from "./quad-solvability";
import type { ImageFrameSize } from "./image-space";
import {
  coupledStateFromSolver,
  summarizeCoupledSolver,
  type CoupledQuadEvaluator,
} from "./manual-floor-support-coupled-search-evaluation";
import {
  generateTypeALocalRefinement,
  type LocalRefinementGenerationInput,
} from "./manual-floor-support-local-refinement-generation";
import type {
  LocalRefinementGeometryTuple,
  LocalRefinementProbe,
  LocalRefinementResultSet,
} from "./manual-floor-support-local-refinement-types";

// Geometry-level scan default (matches the coarse search): a 2° step over the
// full plausible FOV range yields the valid / high-confidence corridors per
// geometry tuple from a SINGLE solver call.
export const DEFAULT_LOCAL_REFINEMENT_FOV_SCAN_CONFIG: QuadSolvabilityFovScanConfig = {
  minFovDeg: 20,
  maxFovDeg: 90,
  stepDeg: 2,
};

// Reuse the coarse-search injectable evaluator signature unchanged.
export type LocalQuadEvaluator = CoupledQuadEvaluator;

export type LocalRefinementEvaluationContext = {
  frame: ImageFrameSize | null;
  // Full-range scan config for the once-per-geometry-tuple corridor discovery.
  fovScanConfig: QuadSolvabilityFovScanConfig;
};

const FOV_EPS = 1e-9;

// Degenerate single-FOV scan config for a direct Apply-gate probe. min === max
// makes the solver's internal scan emit exactly one sample, so a probe does NOT
// re-run the full corridor scan.
function narrowProbeScanConfig(fovDeg: number): QuadSolvabilityFovScanConfig {
  return { minFovDeg: fovDeg, maxFovDeg: fovDeg, stepDeg: 1 };
}

export function fovInCorridor(
  fovDeg: number,
  intervals: [number, number][] | null | undefined
): boolean {
  if (!intervals || intervals.length === 0) return false;
  return intervals.some(([start, end]) => fovDeg >= start - FOV_EPS && fovDeg <= end + FOV_EPS);
}

/**
 * Ascending configured probe FOVs that fall inside the tuple's high-confidence
 * corridor. Pure; used by the evaluator and exposed for tests.
 */
export function fovProbesIntersectingHighConfidence(
  tuple: Pick<LocalRefinementGeometryTuple, "fovCorridors">,
  probeFovsDeg: number[]
): number[] {
  const corridor = tuple.fovCorridors?.highConfidence ?? null;
  if (!corridor) return [];
  return probeFovsDeg.filter((fov) => fovInCorridor(fov, corridor));
}

/**
 * Evaluates the local-refinement set: one full-scan solver call per evaluable
 * geometry tuple, then bounded direct Apply-gate probes where the
 * high-confidence corridor intersects a configured probe FOV, capped
 * deterministically. Generation order is preserved exactly (no ranking).
 */
export function evaluateLocalRefinementResultSet(
  set: LocalRefinementResultSet,
  context: LocalRefinementEvaluationContext,
  evaluator: LocalQuadEvaluator = evaluateQuadSolvability
): LocalRefinementResultSet {
  const geometryProbeFovDeg = set.seed.coarseTuple.probeFovDeg;
  const probeFovsDeg = set.config.fovProbesDeg;
  const cap = set.config.maxProbeEvaluations;

  let probeEvaluationCount = 0;
  let truncatedProbes = false;

  const geometryTuples: LocalRefinementGeometryTuple[] = set.geometryTuples.map((tuple) => {
    if (!tuple.constraint.canEvaluate) {
      return { ...tuple, state: "invalid_geometry", solver: null, fovCorridors: null, probes: [] };
    }

    // Once per geometry tuple: full internal FOV scan + single-probe summary.
    const geomResult = evaluator({
      quadNorm: tuple.quadNorm,
      frameSize: context.frame,
      floorDimensions: { worldWidth: tuple.worldWidth, worldDepth: tuple.worldDepth },
      currentVerticalFovDeg: geometryProbeFovDeg,
      fovScanConfig: context.fovScanConfig,
    });
    const { summary, corridors } = summarizeCoupledSolver(geomResult);

    // Direct Apply-gate probes ONLY where the high-confidence corridor intersects
    // a configured probe FOV, in ascending FOV order, within the global cap.
    const probes: LocalRefinementProbe[] = [];
    const candidateFovs = fovProbesIntersectingHighConfidence({ fovCorridors: corridors }, probeFovsDeg);
    for (const fovDeg of candidateFovs) {
      if (probeEvaluationCount >= cap) {
        truncatedProbes = true;
        break;
      }
      const probeResult = evaluator({
        quadNorm: tuple.quadNorm,
        frameSize: context.frame,
        floorDimensions: { worldWidth: tuple.worldWidth, worldDepth: tuple.worldDepth },
        currentVerticalFovDeg: fovDeg,
        fovScanConfig: narrowProbeScanConfig(fovDeg),
      });
      const probeSummary = summarizeCoupledSolver(probeResult).summary;
      probes.push({
        probeId: `${tuple.geometryTupleId}::fov${fovDeg}`,
        geometryTupleId: tuple.geometryTupleId,
        fovDeg,
        poseAvailable: probeSummary.poseAvailable,
        confidence: probeSummary.confidence,
        cv: { averagePx: probeSummary.cv.averagePx, maximumPx: probeSummary.cv.maximumPx },
        rendered: {
          averagePx: probeSummary.rendered.averagePx,
          maximumPx: probeSummary.rendered.maximumPx,
        },
        applyGateAvailable: probeSummary.applyGateAvailable,
        applyGateReason: probeSummary.applyGateReason,
        state: coupledStateFromSolver(probeSummary),
      });
      probeEvaluationCount += 1;
    }

    return {
      ...tuple,
      state: coupledStateFromSolver(summary),
      solver: summary,
      fovCorridors: corridors,
      probes,
    };
  });

  return { ...set, geometryTuples, truncatedProbes, probeEvaluationCount };
}

/**
 * Convenience orchestrator: generate from the explicit seed, then evaluate.
 * Returns null when no refinement is appropriate (see
 * generateTypeALocalRefinement). Pure aside from the solver call; mutates no
 * live state.
 */
export function runTypeALocalRefinement(
  input: LocalRefinementGenerationInput,
  context: LocalRefinementEvaluationContext,
  evaluator: LocalQuadEvaluator = evaluateQuadSolvability
): LocalRefinementResultSet | null {
  const set = generateTypeALocalRefinement(input);
  if (!set) return null;
  return evaluateLocalRefinementResultSet(set, context, evaluator);
}
