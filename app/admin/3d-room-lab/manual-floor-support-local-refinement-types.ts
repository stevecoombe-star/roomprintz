// --- Phase 2O-K-A: Type A Local Refinement Diagnostic types -----------------
// Pure schema + literals for a LAB-ONLY, DIAGNOSTIC-ONLY, NON-PERSISTENT,
// NON-MUTATING local-refinement layer that inspects ONE explicitly supplied
// coarse Phase 2O-G Type A coupled-search tuple at higher resolution.
//
// ABSOLUTE SCOPE (Phase 2O-K-A): nothing in this module (or anything that
// consumes it) may read or mutate live candidate selection, floorPolygon, live
// FOV, floorMapping dimensions, the calibrated snapshot, Scan & Apply, the
// shared Apply gate, scene-state, persistence, APIs, React state, or UI. Every
// input is explicit and every output is an immutable diagnostic record.
//
// The seed is PROVENANCE, not a recommendation. There is no automatic
// "best coarse tuple" selection anywhere in this layer.
//
// This module imports ONLY harmless pure TYPE aliases. It has NO solver,
// calibration/apply, FOV, snapshot, scene-state, image-space, or UI imports.
//
// The refinement studies three variables that work together (exactly like the
// coarse coupled search, just at higher resolution around the seed):
//   1. tNear      - the one authorized near corner along its approved seam;
//   2. aspectRatio - floor aspect ratio (worldDepth / worldWidth);
//   3. FOV         - geometry-level corridors come from the solver's internal
//                    scan; explicit FOV probes are bounded direct Apply-gate
//                    diagnostics, run ONLY where a high-confidence corridor
//                    intersects a configured probe.
//
// The temporary quad geometry is a function of tNear ONLY. aspectRatio and FOV
// are diagnostic solver inputs and never change the quad coordinates.

import type {
  FloorCornerLabel,
  ManualDeterminingEdge,
  ManualSearchMode,
} from "./manual-floor-support-types";
import type {
  ManualTrialConstraintStatus,
  ManualTrialSampledCornerMove,
  QuadSolvabilitySummary,
  TrialQuadNorm,
} from "./manual-floor-support-trial-types";
import type {
  CoupledSearchFovCorridors,
  CoupledSearchMovableCorner,
  CoupledSearchPrimaryState,
} from "./manual-floor-support-coupled-search-types";

export const TYPE_A_LOCAL_REFINEMENT_SET_SCHEMA =
  "vibode-type-a-local-refinement-set/v0" as const;

// --- Local default configuration (constants, NOT user-facing controls) -------
// Tuned for the FIRST observed Type A high-confidence basin (movable corner NL,
// coarse tNear ≈ 0.3333, coarse aspect range 0.7500–0.8333, high-confidence FOV
// corridors in the mid-30s°). Easy to tune later; never exposed in UI.
//
// tNear offsets are ADDED to the explicit seed tNear, then each PROPOSED value
// is clamped to the approved allowed span and de-duplicated before sampling.
export const DEFAULT_LOCAL_REFINEMENT_TNEAR_OFFSETS: readonly number[] = [
  -0.0833, -0.0417, 0, 0.0417, 0.0833,
];
export const DEFAULT_LOCAL_REFINEMENT_ASPECT_RATIOS: readonly number[] = [
  0.72, 0.75, 0.78, 0.8, 0.8167, 0.8333, 0.85, 0.875, 0.9,
];
// FOV probes are diagnostic Apply-gate probes ONLY (never a search dimension for
// geometry). Ascending; used only where they intersect a high-confidence
// corridor for a given geometry tuple.
export const DEFAULT_LOCAL_REFINEMENT_FOV_PROBES_DEG: readonly number[] = [
  34, 35, 36, 37, 38, 39, 40, 41, 42,
];
// Deterministic hard ceiling on direct FOV probe evaluations across the whole
// set. The geometry grid is at most 5 tNear × 9 aspect = 45 tuples; if every
// tuple probed all 9 FOVs that would be 405, so this cap is meaningful.
export const DEFAULT_LOCAL_REFINEMENT_MAX_PROBE_EVALUATIONS = 128;

// Phase 2O-L-B: truthful provenance of how the aspect band / FOV-probe envelope
// for a config was produced. "seed_centered" means the bands were derived from
// the explicit operator-chosen coarse seed (see createSeedCenteredLocalRefinementConfig);
// "explicit_override" means a caller supplied the config directly.
export type LocalRefinementAspectBandSource = "seed_centered" | "explicit_override";
export type LocalRefinementFovProbeSource = "seed_high_confidence_corridor" | "explicit_override";

export type LocalRefinementConfig = {
  // Offsets ADDED to the seed tNear (not absolute t values).
  tNearOffsets: number[];
  aspectRatios: number[];
  fovProbesDeg: number[];
  maxProbeEvaluations: number;
  // --- Phase 2O-L-B provenance (optional; populated by the seed-centered
  // builder so the K-B readout can show truthful envelope sources). Older
  // explicit-override callers may omit these. ---
  aspectBandSource?: LocalRefinementAspectBandSource;
  // The exact normalized multiplier set applied to the seed aspect ratio.
  aspectMultipliers?: number[];
  fovProbeSource?: LocalRefinementFovProbeSource;
};

// Phase 2O-L-B: deterministic, seed-CENTERED multiplicative aspect band. The
// center multiplier 1.0 reproduces the EXACT stored seed aspect ratio. Applied
// as localAspectRatio = seed.aspectRatio × multiplier.
export const LOCAL_REFINEMENT_ASPECT_MULTIPLIERS: readonly number[] = [
  0.9, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.1,
];

// Stable rounding precision for derived public aspect ratios. 4 decimals matches
// the coupled-search band style (e.g. 0.8333). The center value is kept EXACT
// (never rounded) so the explicit seed ratio is always reproduced verbatim.
const LOCAL_REFINEMENT_ASPECT_DECIMALS = 4;
const ASPECT_ROUND_SCALE = 10 ** LOCAL_REFINEMENT_ASPECT_DECIMALS;
const FOV_DEGREE_EPS = 1e-9;

function roundAspect(value: number): number {
  return Math.round(value * ASPECT_ROUND_SCALE) / ASPECT_ROUND_SCALE;
}

/**
 * Seed-centered aspect ratios: each multiplier × seed aspect ratio, rounded
 * deterministically to a stable precision (center kept exact), ascending and
 * de-duplicated after rounding. Non-finite / non-positive derived ratios are
 * dropped (never clamped). Returns [] for an invalid seed aspect ratio.
 */
export function deriveSeedCenteredAspectRatios(seedAspectRatio: number): number[] {
  if (!Number.isFinite(seedAspectRatio) || seedAspectRatio <= 0) return [];
  const derived: number[] = [];
  for (const multiplier of LOCAL_REFINEMENT_ASPECT_MULTIPLIERS) {
    // Multiplier 1.0 reproduces the exact stored seed ratio (no rounding).
    const value = multiplier === 1 ? seedAspectRatio : roundAspect(seedAspectRatio * multiplier);
    if (Number.isFinite(value) && value > 0) derived.push(value);
  }
  derived.sort((a, b) => a - b);
  const out: number[] = [];
  let lastKey: number | null = null;
  for (const value of derived) {
    const key = Math.round(value * ASPECT_ROUND_SCALE);
    if (lastKey === null || key !== lastKey) {
      out.push(value);
      lastKey = key;
    }
  }
  return out;
}

/**
 * Every whole-degree FOV within the stored high-confidence corridor (inclusive),
 * across all intervals, ascending and de-duplicated. Rejects (returns []) for an
 * absent/empty corridor or any non-finite or reversed interval. Never uses live
 * FOV, the broad seed probe FOV, or solver-inferred corridors.
 */
export function deriveSeedCorridorFovProbes(
  corridor: ReadonlyArray<readonly [number, number]> | null | undefined
): number[] {
  if (!corridor || corridor.length === 0) return [];
  const degrees = new Set<number>();
  for (const interval of corridor) {
    if (!interval || interval.length !== 2) return [];
    const [start, end] = interval;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    if (end < start) return [];
    const lo = Math.ceil(start - FOV_DEGREE_EPS);
    const hi = Math.floor(end + FOV_DEGREE_EPS);
    for (let degree = lo; degree <= hi; degree += 1) degrees.add(degree);
  }
  return Array.from(degrees).sort((a, b) => a - b);
}

/**
 * Phase 2O-L-B: the runtime default local-refinement config, derived ENTIRELY
 * from the explicit operator-chosen coarse seed:
 * - aspect band: seed-centered multiplicative band (deriveSeedCenteredAspectRatios);
 * - direct FOV probes: whole degrees of the seed's stored high-confidence FOV
 *   corridor (deriveSeedCorridorFovProbes);
 * - tNear offsets + probe cap: the existing constants (unchanged).
 *
 * Returns null (safe reject; no fabricated fallback) when the seed is absent or
 * any required band cannot be derived: invalid/non-positive aspect ratio or
 * width, absent/empty/non-finite/reversed high-confidence corridor, or an empty
 * resolved aspect or FOV list. Never falls back to live state, the probe FOV,
 * residuals, or the legacy fixed defaults.
 */
export function createSeedCenteredLocalRefinementConfig(
  seed: LocalRefinementSeed | null | undefined
): LocalRefinementConfig | null {
  if (!seed) return null;
  const tuple = seed.coarseTuple;
  if (!tuple) return null;
  if (!Number.isFinite(tuple.aspectRatio) || tuple.aspectRatio <= 0) return null;
  if (!Number.isFinite(tuple.fixedWorldWidth) || tuple.fixedWorldWidth <= 0) return null;

  const highConfidence = tuple.coarseFovCorridors?.highConfidence ?? null;
  if (!highConfidence || highConfidence.length === 0) return null;

  const aspectRatios = deriveSeedCenteredAspectRatios(tuple.aspectRatio);
  if (aspectRatios.length === 0) return null;

  const fovProbesDeg = deriveSeedCorridorFovProbes(highConfidence);
  if (fovProbesDeg.length === 0) return null;

  return {
    tNearOffsets: [...DEFAULT_LOCAL_REFINEMENT_TNEAR_OFFSETS],
    aspectRatios,
    fovProbesDeg,
    maxProbeEvaluations: DEFAULT_LOCAL_REFINEMENT_MAX_PROBE_EVALUATIONS,
    aspectBandSource: "seed_centered",
    aspectMultipliers: [...LOCAL_REFINEMENT_ASPECT_MULTIPLIERS],
    fovProbeSource: "seed_high_confidence_corridor",
  };
}

// Phase 2O-L-A legacy fixed config. As of Phase 2O-L-B this is NO LONGER the
// runtime default (generation uses createSeedCenteredLocalRefinementConfig when
// no explicit override is supplied). Retained only as a convenient base for
// explicit caller-supplied overrides and tests; the fixed 0.72–0.90 / 34–42
// bands here never drive production refinement.
export function createDefaultLocalRefinementConfig(): LocalRefinementConfig {
  return {
    tNearOffsets: [...DEFAULT_LOCAL_REFINEMENT_TNEAR_OFFSETS],
    aspectRatios: [...DEFAULT_LOCAL_REFINEMENT_ASPECT_RATIOS],
    fovProbesDeg: [...DEFAULT_LOCAL_REFINEMENT_FOV_PROBES_DEG],
    maxProbeEvaluations: DEFAULT_LOCAL_REFINEMENT_MAX_PROBE_EVALUATIONS,
    aspectBandSource: "explicit_override",
    fovProbeSource: "explicit_override",
  };
}

// --- Explicit coarse seed (PROVENANCE, not a recommendation) -----------------
// The exact coarse coupled-search tuple this refinement is seeded from. A future
// caller MUST supply this explicitly; this layer never derives or auto-selects a
// seed from metrics.
export type LocalRefinementSeedTuple = {
  tNear: number;
  aspectRatio: number;
  // worldWidth is held canonical (from the coarse run); worldDepth = ratio×width.
  fixedWorldWidth: number;
  worldDepth: number;
  probeFovDeg: number;
  // Optional documentation-only corridors retained from the coarse evaluation.
  // Never consumed to gate, rank, or select anything in this layer.
  coarseFovCorridors?: CoupledSearchFovCorridors | null;
};

export type LocalRefinementSeed = {
  sourceCandidateId: string;
  movableCorner: CoupledSearchMovableCorner;
  // The operator-approved seam the movable near corner is constrained to.
  seamId: string;
  // Operator-declared determining edge EVIDENCE only (never auto-selected here).
  determiningEdge: ManualDeterminingEdge | null;
  coarseTuple: LocalRefinementSeedTuple;
};

// --- FOV-probe Apply-gate outcome (distinct from geometry-level corridors) ---
// A high-confidence corridor NEVER implies Apply-safe; the Apply-gate outcome is
// reported truthfully and separately, per probed FOV.
export type LocalRefinementProbe = {
  probeId: string;
  geometryTupleId: string;
  fovDeg: number;
  poseAvailable: boolean;
  confidence: "high" | "low" | null;
  cv: { averagePx: number | null; maximumPx: number | null };
  rendered: { averagePx: number | null; maximumPx: number | null };
  applyGateAvailable: boolean;
  applyGateReason: string;
  // Same truthful 5-state vocabulary as the coarse search (classification only).
  state: CoupledSearchPrimaryState;
};

export type LocalRefinementGeometryTuple = {
  // Deterministic, seed/grid-derived id.
  geometryTupleId: string;
  sourceCandidateId: string;

  movableCorner: CoupledSearchMovableCorner;
  seamId: string;

  // Exact local tuple (absolute, post-offset/clamp/dedupe).
  tNear: number;
  aspectRatio: number;

  // Exact derived diagnostic dimensions (NOT asserted physical measurements).
  worldWidth: number;
  worldDepth: number;

  // Exact temporary quad: container-normalized, canonical order [NL, NR, FR, FL].
  // Always an independent clone (never aliases the input candidate quad).
  quadNorm: TrialQuadNorm;
  changedCorners: FloorCornerLabel[];

  // Exact preview-ready sampled geometry for the single moved corner. May be
  // outside [0,1] for an off-frame hard-rejected sample (preserved, not clamped).
  sampledCornerMoves: ManualTrialSampledCornerMove[];

  // Pre-solver geometry gate result.
  constraint: ManualTrialConstraintStatus;

  // Geometry-level primary state. null only until evaluated; the sole pre-solver
  // assignable state is "invalid_geometry".
  state: CoupledSearchPrimaryState | null;

  // Populated ONLY when constraint.canEvaluate === true and the tuple has been
  // evaluated. Apply-gate fields are LABELLED diagnostic; NEVER a ranking signal.
  solver: QuadSolvabilitySummary | null;
  // Geometry-level FOV corridors from the solver's single internal scan. Kept
  // DISTINCT from the per-probe Apply-gate outcomes below.
  fovCorridors: CoupledSearchFovCorridors | null;

  // Direct FOV-probe Apply-gate diagnostics (ascending fovDeg). Non-empty only
  // when this tuple has a high-confidence corridor that intersects a configured
  // probe AND the global probe cap had not yet been reached.
  probes: LocalRefinementProbe[];

  generation: { tIndex: number; aspectIndex: number };

  provenance: "diagnostic_local_refinement_only";
};

export type LocalRefinementResultSet = {
  schema: typeof TYPE_A_LOCAL_REFINEMENT_SET_SCHEMA;
  sourceCandidateId: string;
  movableCorner: CoupledSearchMovableCorner;
  seamId: string;
  // The explicit coarse seed this refinement was generated from (provenance).
  seed: LocalRefinementSeed;
  // The effective (normalized) configuration actually used.
  config: LocalRefinementConfig;
  generatedFor: {
    mode: ManualSearchMode;
    corner: CoupledSearchMovableCorner;
  };
  // Generation order: ascending tNear, then ascending aspectRatio. NEVER sorted
  // by any metric.
  geometryTuples: LocalRefinementGeometryTuple[];
  // true when the maxProbeEvaluations cap dropped trailing probes.
  truncatedProbes: boolean;
  // Total direct FOV-probe evaluations actually performed (<= maxProbeEvaluations).
  probeEvaluationCount: number;
  notes: string[];
};
