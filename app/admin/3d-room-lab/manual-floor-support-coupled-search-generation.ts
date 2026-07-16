// --- Phase 2O-G: Type A Coupled Diagnostic Search generation ----------------
// Pure, deterministic, NON-MUTATING generation of temporary coupled-search
// trial tuples (tNear x aspectRatio) bounded entirely by operator-approved
// single-corner seam authority for ONE Type A near corner (NL or NR).
//
// HARD GUARANTEES:
// - Never mutates or aliases the input candidate quad; always clones before
//   replacing the single authorized near corner, and clones again per trial.
// - Never imports the solver (quad-solvability / evaluateQuadSolvability),
//   Apply/FOV/snapshot/scene-state, or any UI/state setters.
// - Only the authorized near corner (NL or NR) may differ from baseline; the
//   trustworthy corners (the other near corner and both far corners) remain
//   byte-identical.
// - Off-frame samples are hard-rejected (never clamped); near-frame-edge
//   samples remain evaluable with an advisory warning.
// - aspectRatio / worldDepth are diagnostic solver inputs only and never change
//   the quad geometry. The quad is a function of tNear alone.
// - This phase does NOT implement coupled FL + FR behavior, adaptive
//   refinement, baselines, ranking, or recommendation.
//
// Coordinate spaces:
// - Candidate / trial quads: container-normalized, canonical order [NL,NR,FR,FL].
// - Manual seam geometry: source-image normalized.
// - Conversions go through trial-geometry wrappers (cover-crop image-space).

import type { ManualFloorSupportAnnotation } from "./manual-floor-support-types";
import { validateManualFloorSupportAnnotation } from "./manual-floor-support-validation";
import {
  CANONICAL_CORNER_INDEX,
  buildUsableSeam,
  cloneQuad,
  gateTrialQuad,
  isFiniteQuadInUnitRange,
  isNearFrameEdge,
  pointAtT,
  sourceToContainerForTrial,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./manual-floor-support-trial-geometry";
import {
  createEvaluableConstraintStatus,
  mergeConstraintStatus,
  type ManualTrialSampledCornerMove,
  type TrialPoint,
  type TrialQuadNorm,
} from "./manual-floor-support-trial-types";
import {
  DEFAULT_COUPLED_SEARCH_FIXED_WORLD_WIDTH,
  TYPE_A_COUPLED_SEARCH_SET_SCHEMA,
  createDefaultCoupledSearchConfig,
  type CoupledSearchConfig,
  type CoupledSearchMovableCorner,
  type CoupledSearchResultSet,
  type CoupledSearchTrial,
} from "./manual-floor-support-coupled-search-types";

// Minimal candidate shape: decouples generation from auto-floor-detection.
export type CoupledSearchCandidate = {
  id: string;
  quadNorm: TrialQuadNorm;
};

export type CoupledSearchGenerationInput = {
  candidate: CoupledSearchCandidate;
  annotation: ManualFloorSupportAnnotation;
  intrinsic: ImageIntrinsicSize | null;
  frame: ImageFrameSize | null;
  config?: CoupledSearchConfig;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Uniform samples across the allowed span, inclusive of both endpoints. Because
// the usable seam is arc-length parameterized (pointAtT maps t -> source-pixel
// arc length), uniform t is uniform source-pixel arc length along the span.
function buildTNearValues(startT: number, endT: number, samples: number): number[] {
  const n = Math.max(1, Math.floor(samples));
  const lo = clamp01(Math.min(startT, endT));
  const hi = clamp01(Math.max(startT, endT));
  if (n === 1) return [lo];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(lo + (hi - lo) * (i / (n - 1)));
  }
  return out;
}

// Finite, positive, de-duplicated, ascending aspect ratios.
function normalizeAspectRatios(values: number[]): number[] {
  const seen = new Set<number>();
  for (const v of values) {
    if (Number.isFinite(v) && v > 0) seen.add(v);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function normalizeConfig(config: CoupledSearchConfig): CoupledSearchConfig {
  const fixedWorldWidth =
    Number.isFinite(config.fixedWorldWidth) && config.fixedWorldWidth > 0
      ? config.fixedWorldWidth
      : DEFAULT_COUPLED_SEARCH_FIXED_WORLD_WIDTH;
  return {
    tNearSamples: Math.max(1, Math.floor(config.tNearSamples)),
    aspectRatios: normalizeAspectRatios(config.aspectRatios),
    fixedWorldWidth,
    maxEvaluations: Math.max(0, Math.floor(config.maxEvaluations)),
  };
}

/**
 * Generates a temporary, non-mutating Type A coupled-search trial set for a
 * candidate, sweeping tNear x aspectRatio in deterministic generation order
 * (ascending tNear, then ascending aspectRatio).
 *
 * Returns null when no search is appropriate:
 * - invalid annotation;
 * - missing image/frame context;
 * - invalid candidate quad;
 * - mode is not single_corner_constrained;
 * - authority is not single_corner;
 * - authorized corner is not a Type A near corner (NL or NR);
 * - authority seam is missing or yields an invalid usable span.
 *
 * Trials are NOT yet evaluated: solver/state are left for the evaluation module.
 * Gate-rejected (off-frame / degenerate) trials carry state "invalid_geometry"
 * and constraint.canEvaluate === false so they never reach the solver.
 */
export function generateTypeACoupledSearch(
  input: CoupledSearchGenerationInput
): CoupledSearchResultSet | null {
  const { candidate, annotation, intrinsic, frame } = input;

  const validation = validateManualFloorSupportAnnotation(annotation);
  if (!validation.ok) return null;
  if (!intrinsic || !frame) return null;
  if (!candidate || !isFiniteQuadInUnitRange(candidate.quadNorm)) return null;

  // First Type A scope: single authorized near corner only.
  if (annotation.mode !== "single_corner_constrained") return null;
  const authority = annotation.adjustmentAuthority;
  if (authority.kind !== "single_corner") return null;
  if (authority.corner !== "NL" && authority.corner !== "NR") return null;

  const seam = annotation.seams.find((s) => s.id === authority.seamId);
  if (!seam) return null;
  const usable = buildUsableSeam(seam, intrinsic);
  if (!usable) return null;

  const config = normalizeConfig(input.config ?? createDefaultCoupledSearchConfig());

  const movableCorner: CoupledSearchMovableCorner = authority.corner;
  const seamId = authority.seamId;
  const cornerIndex = CANONICAL_CORNER_INDEX[movableCorner];
  const baselineQuad = cloneQuad(candidate.quadNorm);
  const { startT, endT } = authority.allowedSpan;

  const tValues = buildTNearValues(startT, endT, config.tNearSamples);
  const aspectList = config.aspectRatios;

  const notes: string[] = [];
  if (aspectList.length === 0) {
    notes.push("no valid (finite, positive) aspect ratios in config; produced no trials.");
  }

  const cap = config.maxEvaluations;
  const trials: CoupledSearchTrial[] = [];
  let truncated = false;

  for (let ti = 0; ti < tValues.length; ti += 1) {
    const t = tValues[ti];
    const srcPt = pointAtT(usable, t);

    // Build the per-tNear quad once (geometry depends on tNear only), then fan
    // out across aspectRatios with an independent clone per trial.
    const quadForT = cloneQuad(baselineQuad);
    let convStatus = createEvaluableConstraintStatus();
    let conversionOk = false;

    const conv = sourceToContainerForTrial(srcPt, intrinsic, frame);
    if (!conv) {
      convStatus = mergeConstraintStatus(convStatus, {
        hardReasons: [`source->container conversion failed for ${movableCorner}`],
      });
    } else {
      const containerPoint: TrialPoint = { x: conv.container.x, y: conv.container.y };
      quadForT[cornerIndex] = containerPoint;
      conversionOk = true;
      if (!conv.visibleInFrame) {
        convStatus = mergeConstraintStatus(convStatus, {
          hardReasons: [
            `${movableCorner} sample off-frame (overshoot ${conv.maxOvershoot.toFixed(4)})`,
          ],
        });
      } else if (isNearFrameEdge(containerPoint)) {
        convStatus = mergeConstraintStatus(convStatus, {
          warnings: [`${movableCorner} sample near frame edge`],
        });
      }
    }

    let status = convStatus;
    if (status.canEvaluate) {
      status = mergeConstraintStatus(
        status,
        gateTrialQuad({ quad: quadForT, baselineQuad, changedCornerIndices: [cornerIndex] })
      );
    }

    for (let ai = 0; ai < aspectList.length; ai += 1) {
      if (trials.length >= cap) {
        truncated = true;
        return finalize();
      }

      const aspectRatio = aspectList[ai];
      const worldWidth = config.fixedWorldWidth;
      const worldDepth = aspectRatio * worldWidth;
      const quadNorm = cloneQuad(quadForT);

      // Faithful exact sampled geometry. When conversion failed entirely the
      // container coordinate is unknown; preserve the moved corner as it stands
      // in the (un-replaced) clone rather than fabricating a value.
      const sampledCornerMoves: ManualTrialSampledCornerMove[] = [
        {
          corner: movableCorner,
          seamId,
          t,
          sourceNorm: { x: srcPt.x, y: srcPt.y },
          sourcePx: { x: srcPt.x * intrinsic.width, y: srcPt.y * intrinsic.height },
          containerNorm: conversionOk
            ? { x: quadNorm[cornerIndex].x, y: quadNorm[cornerIndex].y }
            : { x: Number.NaN, y: Number.NaN },
        },
      ];

      trials.push({
        trialId: `${candidate.id}::coupled::${movableCorner}::t${ti}::a${ai}`,
        sourceCandidateId: candidate.id,
        movableCorner,
        seamId,
        tuple: { tNear: t, aspectRatio, fovDeg: null },
        worldWidth,
        worldDepth,
        quadNorm,
        changedCorners: [movableCorner],
        sampledCornerMoves,
        constraint: status,
        state: status.canEvaluate ? null : "invalid_geometry",
        solver: null,
        fovCorridors: null,
        generation: { tIndex: ti, aspectIndex: ai },
        provenance: "diagnostic_trial_only",
      });
    }
  }

  return finalize();

  function finalize(): CoupledSearchResultSet {
    return {
      schema: TYPE_A_COUPLED_SEARCH_SET_SCHEMA,
      sourceCandidateId: candidate.id,
      movableCorner,
      seamId,
      config,
      generatedFor: { mode: annotation.mode, corner: movableCorner },
      trials,
      truncated,
      notes,
    };
  }
}
