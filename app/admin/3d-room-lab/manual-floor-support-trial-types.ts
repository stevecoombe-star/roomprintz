// --- Phase 2O-D: Constrained Diagnostic Trial types -------------------------
// Pure schema + literals for LAB-ONLY, DIAGNOSTIC-ONLY, NON-PERSISTENT,
// NON-MUTATING constrained trial generation.
//
// ABSOLUTE SCOPE (Phase 2O-D): nothing in this module (or anything that
// consumes it) may mutate floorPolygon, Auto Floor candidate geometry, selected
// candidate state, candidate ranking/defaulting/selection, FOV, floor
// dimensions, Apply calibration, Scan & Apply, the shared Apply gate, snapshots,
// or scene-state. Trials are temporary local diagnostic records only. No trial
// is ever auto-selected, applied, promoted, or written back to calibration.
//
// This module intentionally imports ONLY harmless pure TYPE aliases from the
// Phase 2O-B1 annotation types module. It has NO solver, calibration/apply,
// FOV, snapshot, scene-state, image-space, or UI imports.

import type {
  FloorCornerLabel,
  ManualAdjustmentAuthority,
  ManualSearchMode,
} from "./manual-floor-support-types";

// Structural point shape compatible with FloorPoint / Vec2 ({ x, y }). Declared
// locally so this types module stays free of scene-state / solver imports.
export type TrialPoint = { x: number; y: number };

export type TrialQuadNorm = [TrialPoint, TrialPoint, TrialPoint, TrialPoint];

export const MANUAL_FLOOR_SUPPORT_TRIAL_SET_SCHEMA =
  "vibode-manual-floor-support-trial-set/v0" as const;

// --- Trial budget (strict initial caps) -------------------------------------
export const MANUAL_TRIAL_MAX_SINGLE_CORNER_SAMPLES = 7;
export const MANUAL_TRIAL_MAX_COUPLED_SAMPLES = 7;
// baseline (1) + at most one moved family (7) = 8.
export const MANUAL_TRIAL_MAX_PER_RUN = 8;

// --- Constraint status model ------------------------------------------------
// Composable pre-solver validity. Invariant:
//   canEvaluate === (hardReasons.length === 0)
// Hard reasons mean the trial NEVER reaches the solver and solver stays null.
// Warnings are advisory display-only notes and NEVER confer authority.
export type ManualTrialConstraintStatus = {
  canEvaluate: boolean;
  hardReasons: string[];
  warnings: string[];
};

export function createEvaluableConstraintStatus(): ManualTrialConstraintStatus {
  return { canEvaluate: true, hardReasons: [], warnings: [] };
}

// Small pure merge helper. Re-derives canEvaluate from the merged hard reasons
// so the invariant always holds.
export function mergeConstraintStatus(
  base: ManualTrialConstraintStatus,
  add: { hardReasons?: string[]; warnings?: string[] }
): ManualTrialConstraintStatus {
  const hardReasons = [...base.hardReasons, ...(add.hardReasons ?? [])];
  const warnings = [...base.warnings, ...(add.warnings ?? [])];
  return {
    hardReasons,
    warnings,
    canEvaluate: hardReasons.length === 0,
  };
}

// --- Trimmed solver summary (diagnostic display only) -----------------------
// A deliberately small projection of QuadSolvabilityResult. Apply-gate fields
// are LABELLED diagnostic and must NEVER be used to sort, rank, recommend,
// select, or apply a trial.
export type QuadSolvabilitySummary = {
  poseAvailable: boolean;
  confidence: "high" | "low" | null;
  cv: { averagePx: number | null; maximumPx: number | null };
  rendered: { averagePx: number | null; maximumPx: number | null };
  delta: { averagePx: number | null; maximumPx: number | null };
  worstCorner: { index: number; value: number } | null;
  // Apply-gate DIAGNOSTIC only. Informational. Never an authority signal.
  applyGateAvailable: boolean;
  applyGateReason: string;
};

export type ManualFloorSupportTrialKind =
  | "baseline"
  | "single_corner"
  | "coupled_far_edge";

// --- Phase 2O-E: exact preview-ready sampled-corner metadata ----------------
// Records the EXACT sampled geometry for each corner a trial moves, captured at
// generation time so the preview/readout uses the true sampled values and never
// recomputes an approximation. `sourceNorm` is source-image normalized (the
// seam space), `sourcePx` is source pixels, and `containerNorm` is the resulting
// container-normalized corner placed into the trial quad (may be outside [0,1]
// for an off-frame, hard-rejected sample — preserved faithfully, never clamped).
export type ManualTrialSampledCornerMove = {
  corner: FloorCornerLabel;
  seamId: string;
  t: number;
  sourceNorm: { x: number; y: number };
  sourcePx: { x: number; y: number };
  containerNorm: { x: number; y: number };
};

export type ManualFloorSupportTrial = {
  trialId: string;
  sourceCandidateId: string;

  kind: ManualFloorSupportTrialKind;

  // Canonical corner labels permitted to differ from baseline for this trial.
  // baseline => []; single => [corner]; coupled => ["FL","FR"].
  changedCorners: FloorCornerLabel[];

  // Container-normalized cloned tuple in canonical order [NL, NR, FR, FL].
  quadNorm: TrialQuadNorm;

  generation: {
    sampleIndex: number;
    tAlongUsableSpan?: number;
    sharedDeltaSourcePx?: number;
    perpendicularOffsetSourcePx?: number;
  };

  // Exact preview-ready sampled geometry, one entry per moved corner. Empty for
  // baseline (no corner moves). Phase 2O-E.
  sampledCornerMoves: ManualTrialSampledCornerMove[];

  evidenceRefs: {
    seamId: string | null;
    mode: ManualSearchMode;
    authorityKind: ManualAdjustmentAuthority["kind"];
    determiningEdgeSeamId: string | null;
  };

  constraint: ManualTrialConstraintStatus;

  // Populated ONLY by the dedicated solver wrapper, and ONLY when
  // constraint.canEvaluate === true. Otherwise remains null.
  solver: QuadSolvabilitySummary | null;

  provenance: "diagnostic_trial_only";
};

export type ManualFloorSupportTrialSet = {
  schema: typeof MANUAL_FLOOR_SUPPORT_TRIAL_SET_SCHEMA;
  sourceCandidateId: string;
  baselineTrialId: string;
  generatedFor: {
    mode: ManualSearchMode;
    authorityKind: ManualAdjustmentAuthority["kind"];
  };
  trials: ManualFloorSupportTrial[];
  // true when a requested sample family exceeded its cap (samples were dropped).
  truncated: boolean;
  notes: string[];
};
