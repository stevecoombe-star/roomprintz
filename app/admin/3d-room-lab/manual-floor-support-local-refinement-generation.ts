// --- Phase 2O-K-A: Type A Local Refinement generation -----------------------
// Pure, deterministic, NON-MUTATING generation of the local geometry grid
// (tNear offsets around an explicit seed × aspectRatio), bounded entirely by the
// existing operator-approved single-corner seam authority for ONE Type A near
// corner (NL or NR).
//
// HARD GUARANTEES (identical discipline to Phase 2O-G generation):
// - Never mutates or aliases the input candidate quad; clones before replacing
//   the single authorized near corner, and clones again per geometry tuple.
// - Never imports the solver, Apply/FOV/snapshot/scene-state, or UI/state.
// - Only the authorized near corner (NL or NR) may differ from baseline; all
//   other corners remain byte-identical.
// - Off-frame samples are hard-rejected (never clamped); near-frame-edge samples
//   remain evaluable with an advisory warning.
// - aspectRatio / worldDepth are diagnostic solver inputs only; the quad is a
//   function of tNear alone.
//
// The seed is PROVENANCE. This module REQUIRES an explicit seed and rejects
// (returns null) any invalid or mismatched seed/authority combination. It never
// derives or auto-selects a seed from metrics, length, or solver results.

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
} from "./manual-floor-support-trial-types";
import type { CoupledSearchCandidate } from "./manual-floor-support-coupled-search-generation";
import type { CoupledSearchMovableCorner } from "./manual-floor-support-coupled-search-types";
import {
  createSeedCenteredLocalRefinementConfig,
  TYPE_A_LOCAL_REFINEMENT_SET_SCHEMA,
  type LocalRefinementConfig,
  type LocalRefinementGeometryTuple,
  type LocalRefinementResultSet,
  type LocalRefinementSeed,
} from "./manual-floor-support-local-refinement-types";

export type LocalRefinementGenerationInput = {
  candidate: CoupledSearchCandidate;
  annotation: ManualFloorSupportAnnotation;
  // Explicit coarse seed (provenance). REQUIRED; never inferred.
  seed: LocalRefinementSeed;
  intrinsic: ImageIntrinsicSize | null;
  frame: ImageFrameSize | null;
  config?: LocalRefinementConfig;
};

// Coincident-t tolerance (in t units). Distinct offsets differ far above this;
// dedupe only removes values that collapse together after span clamping.
const T_DEDUPE_EPS = 1e-9;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// Proposed t = seed.tNear + offset, clamped to the approved allowed span, then
// de-duplicated deterministically and returned ascending. Clamping happens ONLY
// here (at the proposed-t stage); sampled container geometry is never clamped.
function buildLocalTNearValues(
  seedTNear: number,
  offsets: number[],
  startT: number,
  endT: number
): number[] {
  const lo = clamp01(Math.min(startT, endT));
  const hi = clamp01(Math.max(startT, endT));
  const proposed: number[] = [];
  for (const offset of offsets) {
    if (!Number.isFinite(offset)) continue;
    proposed.push(clamp(seedTNear + offset, lo, hi));
  }
  proposed.sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of proposed) {
    if (out.length === 0 || Math.abs(value - out[out.length - 1]) > T_DEDUPE_EPS) {
      out.push(value);
    }
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

function normalizeConfig(config: LocalRefinementConfig): LocalRefinementConfig {
  const fovProbesDeg = Array.from(
    new Set(config.fovProbesDeg.filter((v) => Number.isFinite(v) && v > 0))
  ).sort((a, b) => a - b);
  return {
    // Carry through any provenance fields (aspectBandSource / aspectMultipliers /
    // fovProbeSource) so an explicit override config keeps its truthful source.
    ...config,
    tNearOffsets: config.tNearOffsets.filter((v) => Number.isFinite(v)),
    aspectRatios: normalizeAspectRatios(config.aspectRatios),
    fovProbesDeg,
    maxProbeEvaluations: Math.max(0, Math.floor(config.maxProbeEvaluations)),
  };
}

function seedTupleValid(seed: LocalRefinementSeed): boolean {
  const t = seed.coarseTuple;
  return (
    Number.isFinite(t.tNear) &&
    Number.isFinite(t.aspectRatio) &&
    t.aspectRatio > 0 &&
    Number.isFinite(t.fixedWorldWidth) &&
    t.fixedWorldWidth > 0 &&
    Number.isFinite(t.worldDepth) &&
    Number.isFinite(t.probeFovDeg)
  );
}

/**
 * Generates the temporary, non-mutating Type A local-refinement geometry grid
 * for an EXPLICIT coarse seed, in deterministic order (ascending tNear, then
 * ascending aspectRatio). The grid is at most 5 tNear × 9 aspect = 45 tuples.
 *
 * Returns null when no refinement is appropriate:
 * - invalid annotation;
 * - missing image/frame context;
 * - invalid candidate quad;
 * - mode is not single_corner_constrained;
 * - authority is not single_corner;
 * - authorized corner is not a Type A near corner (NL or NR);
 * - authority seam is missing or yields an invalid usable span;
 * - the explicit seed is invalid or does not match the candidate/authority
 *   (sourceCandidateId, movableCorner, or seamId mismatch);
 * - no explicit config override is supplied AND the seed-centered envelope
 *   cannot be derived (Phase 2O-L-B: invalid aspect/width, or an absent/empty/
 *   non-finite/reversed high-confidence FOV corridor on the seed).
 *
 * Tuples are NOT yet evaluated: solver/state/probes are left for the evaluation
 * module. Gate-rejected (off-frame / degenerate) tuples carry state
 * "invalid_geometry" and constraint.canEvaluate === false, never reaching the
 * solver and never receiving FOV probes.
 */
export function generateTypeALocalRefinement(
  input: LocalRefinementGenerationInput
): LocalRefinementResultSet | null {
  const { candidate, annotation, seed, intrinsic, frame } = input;

  const validation = validateManualFloorSupportAnnotation(annotation);
  if (!validation.ok) return null;
  if (!intrinsic || !frame) return null;
  if (!candidate || !isFiniteQuadInUnitRange(candidate.quadNorm)) return null;

  if (annotation.mode !== "single_corner_constrained") return null;
  const authority = annotation.adjustmentAuthority;
  if (authority.kind !== "single_corner") return null;
  if (authority.corner !== "NL" && authority.corner !== "NR") return null;

  // Explicit seed must be present and consistent with the candidate/authority.
  if (!seed || !seedTupleValid(seed)) return null;
  if (seed.sourceCandidateId !== candidate.id) return null;
  if (seed.movableCorner !== authority.corner) return null;
  if (seed.seamId !== authority.seamId) return null;

  const seam = annotation.seams.find((s) => s.id === authority.seamId);
  if (!seam) return null;
  const usable = buildUsableSeam(seam, intrinsic);
  if (!usable) return null;

  // Phase 2O-L-B: when no explicit override is supplied, the envelope is derived
  // ENTIRELY from the explicit operator-chosen seed (seed-centered aspect band +
  // seed high-confidence-corridor FOV probes). If that derivation cannot be made
  // (no valid aspect/width or no usable high-confidence corridor) we reject
  // safely rather than fabricating a fallback or reusing legacy fixed defaults.
  let config: LocalRefinementConfig;
  if (input.config) {
    config = normalizeConfig(input.config);
  } else {
    const seedCentered = createSeedCenteredLocalRefinementConfig(seed);
    if (!seedCentered) return null;
    config = seedCentered;
  }

  const movableCorner: CoupledSearchMovableCorner = authority.corner;
  const seamId = authority.seamId;
  const cornerIndex = CANONICAL_CORNER_INDEX[movableCorner];
  const baselineQuad = cloneQuad(candidate.quadNorm);
  const { startT, endT } = authority.allowedSpan;

  const worldWidth = seed.coarseTuple.fixedWorldWidth;
  const tValues = buildLocalTNearValues(
    seed.coarseTuple.tNear,
    config.tNearOffsets,
    startT,
    endT
  );
  const aspectList = config.aspectRatios;

  const notes: string[] = [];
  if (aspectList.length === 0) {
    notes.push("no valid (finite, positive) aspect ratios in config; produced no geometry tuples.");
  }
  if (tValues.length === 0) {
    notes.push("no valid tNear offsets resolved within the approved span.");
  }

  const geometryTuples: LocalRefinementGeometryTuple[] = [];

  for (let ti = 0; ti < tValues.length; ti += 1) {
    const t = tValues[ti];
    const srcPt = pointAtT(usable, t);

    // Per-tNear quad (geometry depends on tNear only), fanned out across aspects
    // with an independent clone per geometry tuple.
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
      const aspectRatio = aspectList[ai];
      const worldDepth = aspectRatio * worldWidth;
      const quadNorm = cloneQuad(quadForT);

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

      geometryTuples.push({
        geometryTupleId: `${candidate.id}::localref::${movableCorner}::t${ti}::a${ai}`,
        sourceCandidateId: candidate.id,
        movableCorner,
        seamId,
        tNear: t,
        aspectRatio,
        worldWidth,
        worldDepth,
        quadNorm,
        changedCorners: [movableCorner],
        sampledCornerMoves,
        constraint: status,
        state: status.canEvaluate ? null : "invalid_geometry",
        solver: null,
        fovCorridors: null,
        probes: [],
        generation: { tIndex: ti, aspectIndex: ai },
        provenance: "diagnostic_local_refinement_only",
      });
    }
  }

  return {
    schema: TYPE_A_LOCAL_REFINEMENT_SET_SCHEMA,
    sourceCandidateId: candidate.id,
    movableCorner,
    seamId,
    seed,
    config,
    generatedFor: { mode: annotation.mode, corner: movableCorner },
    geometryTuples,
    truncatedProbes: false,
    probeEvaluationCount: 0,
    notes,
  };
}
