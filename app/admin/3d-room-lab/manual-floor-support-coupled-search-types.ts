// --- Phase 2O-G: Type A Coupled Diagnostic Search types ---------------------
// Pure schema + literals for the LAB-ONLY, DIAGNOSTIC-ONLY, NON-PERSISTENT,
// NON-MUTATING Type A coupled search foundation.
//
// ABSOLUTE SCOPE (Phase 2O-G): nothing in this module (or anything that consumes
// it) may mutate floorPolygon, Auto Floor candidate geometry, selected candidate
// state, candidate ranking/defaulting/selection, live FOV, live floor
// dimensions, Apply calibration, Scan & Apply, the shared Apply gate, snapshots,
// or scene-state. Coupled-search trials are temporary local diagnostic records
// only. No trial is ever auto-selected, ranked, recommended, applied, promoted,
// or written back to calibration.
//
// This module imports ONLY harmless pure TYPE aliases. It has NO solver,
// calibration/apply, FOV, snapshot, scene-state, image-space, or UI imports.
//
// The Type A coupled search studies THREE variables that work together:
//   1. tNear      - one authorized near corner along an approved visible seam;
//   2. aspectRatio - floor aspect ratio (worldDepth / worldWidth);
//   3. FOV         - discovered via the existing solver's internal FOV scan
//                    (valid / high-confidence corridors) plus an optional probe
//                    FOV for the Apply-gate diagnostic.
//
// The temporary quad geometry is a function of tNear ONLY. aspectRatio and FOV
// are diagnostic solver inputs and never change the quad coordinates.

import type {
  FloorCornerLabel,
  ManualSearchMode,
} from "./manual-floor-support-types";
import type {
  ManualTrialConstraintStatus,
  ManualTrialSampledCornerMove,
  QuadSolvabilitySummary,
  TrialQuadNorm,
} from "./manual-floor-support-trial-types";

export const TYPE_A_COUPLED_SEARCH_SET_SCHEMA =
  "vibode-type-a-coupled-search-set/v0" as const;

// First Type A scope: ONLY a near corner is adjustable, and only NL or NR. The
// trustworthy far corners (FL/FR) and the rear seam are evidence only.
export type CoupledSearchMovableCorner = Extract<FloorCornerLabel, "NL" | "NR">;

export const COUPLED_SEARCH_MOVABLE_CORNERS: readonly CoupledSearchMovableCorner[] = [
  "NL",
  "NR",
] as const;

// --- Default bounded configuration (constants, NOT user-facing controls) -----
// Conservative coarse defaults. Easy to tune later; never exposed in UI.
export const DEFAULT_COUPLED_SEARCH_TNEAR_SAMPLES = 7;
// Phase 2O-J: aspect-band coverage correction. The band now spans both the
// sub-1.0 region (diagnostic depth < fixed width) and the previously studied
// above-1.0 region. This is a COVERAGE fix, not a formula change:
// aspectRatio = worldDepth / worldWidth is unchanged. The sub-1.0 entries are
// required because a real-room Type A manual oracle verified a successful
// diagnostic configuration near aspectRatio ≈ 0.8333 (width 4.00, depth ≈ 3.33),
// which the old band (starting at 1.10) never tested. 7 tNear × 9 aspects = 63
// tuples, still below the deterministic cap of 64.
export const DEFAULT_COUPLED_SEARCH_ASPECT_RATIOS: readonly number[] = [
  0.75, 0.8, 0.8333, 0.9, 1.0, 1.1, 1.3, 1.4, 1.55,
];
// Canonical fixed dimension. worldWidth is held constant; worldDepth is derived
// as aspectRatio * worldWidth. Image-derived dimensions are diagnostic solver
// inputs, never asserted physical measurements, so the absolute width is a
// neutral unit (1) and only the proportion is explored.
export const DEFAULT_COUPLED_SEARCH_FIXED_WORLD_WIDTH = 1;
// Hard ceiling on generated trial tuples (a conservative superset of solver
// evaluations, since invalid-geometry tuples never reach the solver).
export const DEFAULT_COUPLED_SEARCH_MAX_EVALUATIONS = 64;

export type CoupledSearchConfig = {
  tNearSamples: number;
  aspectRatios: number[];
  fixedWorldWidth: number;
  maxEvaluations: number;
};

export function createDefaultCoupledSearchConfig(): CoupledSearchConfig {
  return {
    tNearSamples: DEFAULT_COUPLED_SEARCH_TNEAR_SAMPLES,
    aspectRatios: [...DEFAULT_COUPLED_SEARCH_ASPECT_RATIOS],
    fixedWorldWidth: DEFAULT_COUPLED_SEARCH_FIXED_WORLD_WIDTH,
    maxEvaluations: DEFAULT_COUPLED_SEARCH_MAX_EVALUATIONS,
  };
}

// Exact coupled-search tuple. fovDeg is the probe FOV actually used for pose /
// Apply-gate diagnostics; it is null until the trial is evaluated.
export type CoupledSearchTuple = {
  tNear: number;
  aspectRatio: number;
  fovDeg: number | null;
};

// Truthful primary evaluation state. This is a CLASSIFICATION, never a ranking.
// "invalid_geometry" is assigned pre-solver (the trial never reaches the solver).
export type CoupledSearchPrimaryState =
  | "invalid_geometry"
  | "no_pose"
  | "pose_poor"
  | "high_confidence_not_apply_safe"
  | "apply_safe_diagnostic";

// FOV corridors discovered by the solver's existing internal scan. Kept SEPARATE
// from the single-probe Apply-gate diagnostic and never used to rank trials.
export type CoupledSearchFovCorridors = {
  valid: [number, number][] | null;
  highConfidence: [number, number][] | null;
};

export type CoupledSearchTrial = {
  // Deterministic, tuple-derived id.
  trialId: string;
  sourceCandidateId: string;

  movableCorner: CoupledSearchMovableCorner;
  seamId: string;

  tuple: CoupledSearchTuple;

  // Exact derived diagnostic dimensions (NOT asserted physical measurements).
  worldWidth: number;
  worldDepth: number;

  // Exact temporary quad: container-normalized, canonical order [NL, NR, FR, FL].
  // Always an independent clone (never aliases the input candidate quad).
  quadNorm: TrialQuadNorm;
  changedCorners: FloorCornerLabel[];

  // Exact preview-ready sampled geometry for the single moved corner (Phase 2O-E
  // shape). containerNorm may be outside [0,1] for an off-frame, hard-rejected
  // sample — preserved faithfully, never clamped.
  sampledCornerMoves: ManualTrialSampledCornerMove[];

  // Pre-solver geometry gate result.
  constraint: ManualTrialConstraintStatus;

  // null until evaluated (constraint passed but solver not yet run). The only
  // state assignable before the solver is "invalid_geometry".
  state: CoupledSearchPrimaryState | null;

  // Populated ONLY when constraint.canEvaluate === true and the trial has been
  // evaluated. Otherwise null. Apply-gate fields are LABELLED diagnostic and
  // must NEVER be used to sort, rank, recommend, select, or apply a trial.
  solver: QuadSolvabilitySummary | null;
  fovCorridors: CoupledSearchFovCorridors | null;

  generation: { tIndex: number; aspectIndex: number };

  provenance: "diagnostic_trial_only";
};

export type CoupledSearchResultSet = {
  schema: typeof TYPE_A_COUPLED_SEARCH_SET_SCHEMA;
  sourceCandidateId: string;
  movableCorner: CoupledSearchMovableCorner;
  seamId: string;
  // The effective (normalized) configuration actually used.
  config: CoupledSearchConfig;
  generatedFor: {
    mode: ManualSearchMode;
    corner: CoupledSearchMovableCorner;
  };
  // Generation order: ascending tNear, then ascending aspectRatio. NEVER sorted
  // by any metric.
  trials: CoupledSearchTrial[];
  // true when the maxEvaluations cap dropped trailing tuples.
  truncated: boolean;
  notes: string[];
};
