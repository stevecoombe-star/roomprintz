import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createEmptyManualFloorSupportAnnotation,
  type ManualFloorSupportAnnotation,
  type ManualPhysicalSeam,
} from "./manual-floor-support-types";
import {
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./manual-floor-support-trial-geometry";
import type { QuadSolvabilitySummary, TrialQuadNorm } from "./manual-floor-support-trial-types";
import type { QuadSolvabilityResult } from "./quad-solvability";
import {
  createDefaultCoupledSearchConfig,
  DEFAULT_COUPLED_SEARCH_ASPECT_RATIOS,
  DEFAULT_COUPLED_SEARCH_MAX_EVALUATIONS,
  DEFAULT_COUPLED_SEARCH_TNEAR_SAMPLES,
  type CoupledSearchConfig,
} from "./manual-floor-support-coupled-search-types";
import {
  generateTypeACoupledSearch,
  type CoupledSearchCandidate,
} from "./manual-floor-support-coupled-search-generation";
import {
  coupledStateFromSolver,
  evaluateCoupledSearchResultSet,
  evaluateCoupledSearchTrial,
  runTypeACoupledSearch,
  type CoupledQuadEvaluator,
  type CoupledSearchEvaluationContext,
} from "./manual-floor-support-coupled-search-evaluation";

// Square frame => object-cover crop is identity (container-norm == source-norm),
// so geometry is exactly predictable.
const INTRINSIC: ImageIntrinsicSize = { width: 1000, height: 1000 };
const FRAME: ImageFrameSize = { width: 1000, height: 1000 };

// Canonical [NL, NR, FR, FL], y-down (near corners have larger y).
function baselineQuad(): TrialQuadNorm {
  return [
    { x: 0.2, y: 0.8 }, // NL
    { x: 0.8, y: 0.8 }, // NR
    { x: 0.7, y: 0.3 }, // FR
    { x: 0.3, y: 0.3 }, // FL
  ];
}

function candidate(id = "cand-1"): CoupledSearchCandidate {
  return { id, quadNorm: baselineQuad() };
}

// Left side seam FL -> NL: t=0 at NL baseline (0.2,0.8), t=1 at FL (0.3,0.3).
function leftSeam(): ManualPhysicalSeam {
  return {
    id: "seam-left",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.2, y: 0.8 },
      { x: 0.3, y: 0.3 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 1 },
    corridor: { halfWidthSourcePx: 6 },
  };
}

// Right side seam FR -> NR: t=0 at NR baseline (0.8,0.8), t=1 at FR (0.7,0.3).
function rightSeam(): ManualPhysicalSeam {
  return {
    id: "seam-right",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.8, y: 0.8 },
      { x: 0.7, y: 0.3 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 1 },
    corridor: { halfWidthSourcePx: 6 },
  };
}

function nlAnnotation(
  span: { startT: number; endT: number },
  seam: ManualPhysicalSeam = leftSeam()
): ManualFloorSupportAnnotation {
  return {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [seam],
    mode: "single_corner_constrained",
    adjustmentAuthority: {
      kind: "single_corner",
      corner: "NL",
      seamId: seam.id,
      allowedSpan: span,
    },
  };
}

function nrAnnotation(span: { startT: number; endT: number }): ManualFloorSupportAnnotation {
  const seam = rightSeam();
  return {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [seam],
    mode: "single_corner_constrained",
    adjustmentAuthority: {
      kind: "single_corner",
      corner: "NR",
      seamId: seam.id,
      allowedSpan: span,
    },
  };
}

const FOV_SCAN = { minFovDeg: 20, maxFovDeg: 90, stepDeg: 2 };
const EVAL_CONTEXT: CoupledSearchEvaluationContext = {
  frame: FRAME,
  currentVerticalFovDeg: 55,
  fovScanConfig: FOV_SCAN,
};

// --- Solver test double ------------------------------------------------------
function makeSolverResult(opts: {
  poseAvailable: boolean;
  confidence: "high" | "low" | null;
  applyAvailable: boolean;
  applyReason?: string;
  validIntervals?: [number, number][] | null;
  highConfIntervals?: [number, number][] | null;
}): QuadSolvabilityResult {
  return {
    prerequisitesAvailable: true,
    unavailableReason: null,
    orderedCornersNorm: null,
    imagePointsPx: null,
    floorPlanePoints2D: null,
    homographyAvailable: opts.poseAvailable,
    homographyMatrixForPlacement: null,
    decomposition: null,
    poseAvailable: opts.poseAvailable,
    confidence: opts.confidence,
    scaleRatio: null,
    cv: { averagePx: null, maximumPx: null, perCornerResidualPx: null },
    rendered: { averagePx: null, maximumPx: null, perCornerResidualPx: null, count: 0 },
    delta: { averagePx: null, maximumPx: null },
    applyCandidate: null,
    applyEvaluation: {
      available: opts.applyAvailable,
      reason: opts.applyReason ?? (opts.applyAvailable ? "ok" : "not apply-safe"),
      firstFailingGate: opts.applyAvailable ? "none" : "confidence",
    },
    fovScan: {
      scan: null,
      unavailableReason: null,
      validSampleIntervals: opts.validIntervals ?? null,
      highConfidenceSampleIntervals: opts.highConfIntervals ?? null,
      validSampleCount: 0,
      highConfidenceSampleCount: 0,
      sampleCount: 0,
      sampleStepDeg: 2,
    },
    worstCorner: { cv: null, rendered: null, difference: null },
  };
}

function summary(opts: {
  poseAvailable: boolean;
  confidence: "high" | "low" | null;
  applyAvailable: boolean;
}): QuadSolvabilitySummary {
  return {
    poseAvailable: opts.poseAvailable,
    confidence: opts.confidence,
    cv: { averagePx: null, maximumPx: null },
    rendered: { averagePx: null, maximumPx: null },
    delta: { averagePx: null, maximumPx: null },
    worstCorner: null,
    applyGateAvailable: opts.applyAvailable,
    applyGateReason: "x",
  };
}

// --- Tests ------------------------------------------------------------------

test("1. generation and full run are deterministic (deep-equal)", () => {
  const ann = nlAnnotation({ startT: 0, endT: 0.4 });
  const a = generateTypeACoupledSearch({ candidate: candidate(), annotation: ann, intrinsic: INTRINSIC, frame: FRAME });
  const b = generateTypeACoupledSearch({ candidate: candidate(), annotation: ann, intrinsic: INTRINSIC, frame: FRAME });
  assert.deepEqual(a, b);

  const ra = runTypeACoupledSearch({ candidate: candidate(), annotation: ann, intrinsic: INTRINSIC, frame: FRAME }, EVAL_CONTEXT);
  const rb = runTypeACoupledSearch({ candidate: candidate(), annotation: ann, intrinsic: INTRINSIC, frame: FRAME }, EVAL_CONTEXT);
  assert.deepEqual(ra, rb);
});

test("2a. tNear maps by source-pixel arc length; exact sourceNorm/sourcePx/containerNorm retained", () => {
  const set = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config: { ...createDefaultCoupledSearchConfig(), tNearSamples: 5, aspectRatios: [1.3] },
  })!;
  // tNearSamples=5 over [0,1] -> t in {0, .25, .5, .75, 1}. The t=0.5 sample sits
  // at the seam midpoint (0.25, 0.55). Identity crop => containerNorm == sourceNorm.
  const mid = set.trials.find((t) => Math.abs(t.tuple.tNear - 0.5) < 1e-9)!;
  const move = mid.sampledCornerMoves[0];
  assert.ok(Math.abs(move.sourceNorm.x - 0.25) < 1e-9, `sourceNorm.x ${move.sourceNorm.x}`);
  assert.ok(Math.abs(move.sourceNorm.y - 0.55) < 1e-9, `sourceNorm.y ${move.sourceNorm.y}`);
  assert.ok(Math.abs(move.sourcePx.x - 250) < 1e-6);
  assert.ok(Math.abs(move.sourcePx.y - 550) < 1e-6);
  assert.ok(Math.abs(move.containerNorm.x - 0.25) < 1e-9);
  assert.ok(Math.abs(move.containerNorm.y - 0.55) < 1e-9);
  // The moved quad corner equals the exact sampled containerNorm.
  assert.deepEqual(mid.quadNorm[0], { x: move.containerNorm.x, y: move.containerNorm.y });
});

test("2b. arc-length param: a bent seam samples the bend exactly at t=0.5", () => {
  // Two equal-length legs (400px vertical, 400px horizontal); t=0.5 == bend.
  const bent: ManualPhysicalSeam = {
    id: "seam-bent",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.2, y: 0.8 },
      { x: 0.2, y: 0.4 },
      { x: 0.6, y: 0.4 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 2 },
    corridor: { halfWidthSourcePx: 6 },
  };
  const set = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }, bent),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config: { ...createDefaultCoupledSearchConfig(), tNearSamples: 3, aspectRatios: [1.3] },
  })!;
  const mid = set.trials.find((t) => t.generation.tIndex === 1)!; // t = 0.5
  assert.ok(Math.abs(mid.tuple.tNear - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.sampledCornerMoves[0].sourceNorm.x - 0.2) < 1e-9);
  assert.ok(Math.abs(mid.sampledCornerMoves[0].sourceNorm.y - 0.4) < 1e-9);
});

test("3. Type A authority: NL/NR accepted; mismatched corner/mode/authority rejected (null)", () => {
  const nl = generateTypeACoupledSearch({ candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.4 }), intrinsic: INTRINSIC, frame: FRAME })!;
  assert.equal(nl.movableCorner, "NL");
  assert.ok(nl.trials.every((t) => t.changedCorners.length === 1 && t.changedCorners[0] === "NL"));
  assert.ok(nl.trials.every((t) => t.seamId === "seam-left"));

  const nr = generateTypeACoupledSearch({ candidate: candidate(), annotation: nrAnnotation({ startT: 0, endT: 0.4 }), intrinsic: INTRINSIC, frame: FRAME })!;
  assert.equal(nr.movableCorner, "NR");
  assert.ok(nr.trials.every((t) => t.changedCorners[0] === "NR" && t.seamId === "seam-right"));

  // Far corner (FL) single-corner authority is out of first Type A scope -> null.
  const flAnn: ManualFloorSupportAnnotation = {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [leftSeam()],
    mode: "single_corner_constrained",
    adjustmentAuthority: { kind: "single_corner", corner: "FL", seamId: "seam-left", allowedSpan: { startT: 0, endT: 0.4 } },
  };
  assert.equal(generateTypeACoupledSearch({ candidate: candidate(), annotation: flAnn, intrinsic: INTRINSIC, frame: FRAME }), null);

  // Direct mode -> null. Coupled authority -> null (rejected as invalid annotation by mode mismatch and unsupported here).
  assert.equal(
    generateTypeACoupledSearch({ candidate: candidate(), annotation: createEmptyManualFloorSupportAnnotation(), intrinsic: INTRINSIC, frame: FRAME }),
    null
  );

  // Missing image/frame -> null.
  assert.equal(generateTypeACoupledSearch({ candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.4 }), intrinsic: null, frame: FRAME }), null);
});

test("4. fixed corners (NR, FR, FL) remain byte-identical to baseline for an NL search", () => {
  const cand = candidate();
  const set = generateTypeACoupledSearch({ candidate: cand, annotation: nlAnnotation({ startT: 0, endT: 0.4 }), intrinsic: INTRINSIC, frame: FRAME })!;
  for (const trial of set.trials) {
    assert.deepEqual(trial.quadNorm[1], cand.quadNorm[1]); // NR
    assert.deepEqual(trial.quadNorm[2], cand.quadNorm[2]); // FR
    assert.deepEqual(trial.quadNorm[3], cand.quadNorm[3]); // FL
  }
});

test("5. aspect-ratio derivation: worldDepth === aspectRatio * worldWidth (ratio is depth/width)", () => {
  const config: CoupledSearchConfig = { tNearSamples: 2, aspectRatios: [1.1, 1.3], fixedWorldWidth: 2, maxEvaluations: 64 };
  const set = generateTypeACoupledSearch({ candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.3 }), intrinsic: INTRINSIC, frame: FRAME, config })!;
  for (const trial of set.trials) {
    assert.equal(trial.worldWidth, 2);
    assert.ok(Math.abs(trial.worldDepth - trial.tuple.aspectRatio * 2) < 1e-12);
    assert.ok(Math.abs(trial.worldDepth / trial.worldWidth - trial.tuple.aspectRatio) < 1e-12);
  }
});

test("6. off-frame samples are NOT clamped and become invalid_geometry; never reach the solver", () => {
  const shortFrame: ImageFrameSize = { width: 1000, height: 400 };
  // High-y seam that the short frame crops out entirely.
  const highSeam: ManualPhysicalSeam = {
    id: "seam-high",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.2, y: 0.75 },
      { x: 0.25, y: 0.85 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 1 },
    corridor: { halfWidthSourcePx: 6 },
  };
  const set = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }, highSeam),
    intrinsic: INTRINSIC,
    frame: shortFrame,
    config: { ...createDefaultCoupledSearchConfig(), tNearSamples: 4, aspectRatios: [1.3] },
  })!;
  assert.ok(set.trials.length > 0);
  for (const trial of set.trials) {
    assert.equal(trial.state, "invalid_geometry");
    assert.equal(trial.constraint.canEvaluate, false);
    assert.ok(trial.constraint.hardReasons.some((r) => /off-frame/.test(r)));
    // No clamping: the preserved container coordinate is outside [0,1].
    const c = trial.sampledCornerMoves[0].containerNorm;
    assert.ok(c.y > 1, `expected off-frame containerNorm.y > 1, got ${c.y}`);
  }
  let calls = 0;
  const counting: CoupledQuadEvaluator = () => {
    calls += 1;
    return makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false });
  };
  const evaluated = evaluateCoupledSearchResultSet(set, { ...EVAL_CONTEXT, frame: shortFrame }, counting);
  assert.equal(calls, 0);
  for (const trial of evaluated.trials) {
    assert.equal(trial.solver, null);
    assert.equal(trial.state, "invalid_geometry");
  }
});

test("7. pre-solver geometry rejection: invalid quads never reach the injected solver", () => {
  // Full-span NL seam: t=1 drives NL onto FL (0.3,0.3) -> not-distinct -> reject.
  const set = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config: { ...createDefaultCoupledSearchConfig(), tNearSamples: 5, aspectRatios: [1.3] },
  })!;
  const evaluable = set.trials.filter((t) => t.constraint.canEvaluate);
  const invalid = set.trials.filter((t) => !t.constraint.canEvaluate);
  assert.ok(evaluable.length > 0, "expected some evaluable trials");
  assert.ok(invalid.length > 0, "expected the t=1 (coincident) sample to be rejected");
  for (const t of invalid) assert.equal(t.state, "invalid_geometry");

  let calls = 0;
  const counting: CoupledQuadEvaluator = () => {
    calls += 1;
    return makeSolverResult({ poseAvailable: true, confidence: "low", applyAvailable: false });
  };
  evaluateCoupledSearchResultSet(set, EVAL_CONTEXT, counting);
  assert.equal(calls, evaluable.length);
});

test("8a. coupledStateFromSolver classifies truthfully", () => {
  assert.equal(coupledStateFromSolver(summary({ poseAvailable: false, confidence: null, applyAvailable: false })), "no_pose");
  assert.equal(coupledStateFromSolver(summary({ poseAvailable: true, confidence: "low", applyAvailable: false })), "pose_poor");
  assert.equal(coupledStateFromSolver(summary({ poseAvailable: true, confidence: "high", applyAvailable: false })), "high_confidence_not_apply_safe");
  assert.equal(coupledStateFromSolver(summary({ poseAvailable: true, confidence: "high", applyAvailable: true })), "apply_safe_diagnostic");
});

test("8b. evaluateCoupledSearchTrial maps each state and retains FOV corridors + probe FOV", () => {
  const set = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 0.3 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config: { ...createDefaultCoupledSearchConfig(), tNearSamples: 1, aspectRatios: [1.3] },
  })!;
  const trial = set.trials[0];
  assert.equal(trial.constraint.canEvaluate, true);

  const apply: CoupledQuadEvaluator = () =>
    makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: true, validIntervals: [[40, 70]], highConfIntervals: [[50, 60]] });
  const evApply = evaluateCoupledSearchTrial(trial, EVAL_CONTEXT, apply);
  assert.equal(evApply.state, "apply_safe_diagnostic");
  assert.equal(evApply.tuple.fovDeg, 55);
  assert.deepEqual(evApply.fovCorridors, { valid: [[40, 70]], highConfidence: [[50, 60]] });
  assert.ok(evApply.solver && evApply.solver.applyGateAvailable === true);

  const noPose: CoupledQuadEvaluator = () => makeSolverResult({ poseAvailable: false, confidence: null, applyAvailable: false });
  assert.equal(evaluateCoupledSearchTrial(trial, EVAL_CONTEXT, noPose).state, "no_pose");

  const poor: CoupledQuadEvaluator = () => makeSolverResult({ poseAvailable: true, confidence: "low", applyAvailable: false });
  assert.equal(evaluateCoupledSearchTrial(trial, EVAL_CONTEXT, poor).state, "pose_poor");
});

test("9a. generation order is ascending tNear then ascending aspectRatio (no metric sort)", () => {
  // Aspect ratios supplied out of order; generation must normalize ascending.
  const config: CoupledSearchConfig = { tNearSamples: 3, aspectRatios: [1.3, 1.1, 1.2], fixedWorldWidth: 1, maxEvaluations: 64 };
  const set = generateTypeACoupledSearch({ candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.3 }), intrinsic: INTRINSIC, frame: FRAME, config })!;
  assert.deepEqual(set.config.aspectRatios, [1.1, 1.2, 1.3]);
  let prevT = -Infinity;
  for (let i = 0; i < set.trials.length; i += 1) {
    const t = set.trials[i];
    assert.ok(t.tuple.tNear >= prevT - 1e-12);
    if (Math.abs(t.tuple.tNear - prevT) > 1e-12) prevT = t.tuple.tNear;
    assert.equal(t.tuple.aspectRatio, [1.1, 1.2, 1.3][t.generation.aspectIndex]);
  }
  // Evaluation preserves generation order exactly (no ranking).
  const evaluated = evaluateCoupledSearchResultSet(set, EVAL_CONTEXT);
  assert.deepEqual(evaluated.trials.map((t) => t.trialId), set.trials.map((t) => t.trialId));
});

test("9b. maxEvaluations cap truncates deterministically (trailing tuples dropped)", () => {
  const config: CoupledSearchConfig = { tNearSamples: 3, aspectRatios: [1.1, 1.2, 1.3], fixedWorldWidth: 1, maxEvaluations: 4 };
  const set = generateTypeACoupledSearch({ candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.3 }), intrinsic: INTRINSIC, frame: FRAME, config })!;
  assert.equal(set.trials.length, 4);
  assert.equal(set.truncated, true);
  assert.deepEqual(
    set.trials.map((t) => `${t.generation.tIndex}-${t.generation.aspectIndex}`),
    ["0-0", "0-1", "0-2", "1-0"]
  );
});

test("9c. Phase 2O-J default aspect band: exact ordered values, 63 tuples, no truncation, 0.8333 depth", () => {
  const EXPECTED_BAND = [0.75, 0.8, 0.8333, 0.9, 1.0, 1.1, 1.3, 1.4, 1.55];

  // (1) Centralized default band is exactly the corrected ordered set, spanning
  // both the sub-1.0 and above-1.0 regions, and the default config exposes it.
  assert.deepEqual([...DEFAULT_COUPLED_SEARCH_ASPECT_RATIOS], EXPECTED_BAND);
  const config = createDefaultCoupledSearchConfig();
  assert.deepEqual(config.aspectRatios, EXPECTED_BAND);
  assert.equal(config.tNearSamples, DEFAULT_COUPLED_SEARCH_TNEAR_SAMPLES);
  assert.equal(config.tNearSamples, 7);
  assert.equal(config.maxEvaluations, DEFAULT_COUPLED_SEARCH_MAX_EVALUATIONS);
  assert.equal(config.maxEvaluations, 64);

  // (2) + (3) 7 tNear × 9 aspects = 63 tuples, below the deterministic cap of 64,
  // so the default configuration does NOT truncate.
  const set = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 0.3 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!; // default config
  assert.equal(set.trials.length, 63);
  assert.equal(set.truncated, false);

  // (5) Generation order remains ascending tNear, then ascending aspect ratio.
  let prevT = -Infinity;
  for (const t of set.trials) {
    assert.ok(t.tuple.tNear >= prevT - 1e-12);
    if (Math.abs(t.tuple.tNear - prevT) > 1e-12) prevT = t.tuple.tNear;
    assert.equal(t.tuple.aspectRatio, EXPECTED_BAND[t.generation.aspectIndex]);
  }

  // (4) The verified manual-oracle ratio 0.8333 derives depth correctly:
  // worldDepth = aspectRatio × worldWidth = 0.8333 × 4.00 = 3.3332 (fp-exact to tol).
  const wideSet = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 0.3 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config: { ...createDefaultCoupledSearchConfig(), fixedWorldWidth: 4 },
  })!;
  const oracle = wideSet.trials.find((t) => t.tuple.aspectRatio === 0.8333);
  assert.ok(oracle, "expected a 0.8333 aspect tuple in the default band");
  assert.equal(oracle!.worldWidth, 4);
  assert.ok(Math.abs(oracle!.worldDepth - 3.3332) < 1e-9, `depth ${oracle!.worldDepth}`);
});

test("10. baseline candidate is never mutated or aliased", () => {
  const cand = candidate();
  const snapshot = JSON.stringify(cand);
  const result = runTypeACoupledSearch(
    { candidate: cand, annotation: nlAnnotation({ startT: 0, endT: 0.4 }), intrinsic: INTRINSIC, frame: FRAME },
    EVAL_CONTEXT
  )!;
  assert.equal(JSON.stringify(cand), snapshot);
  for (const trial of result.trials) {
    assert.notEqual(trial.quadNorm, cand.quadNorm);
    assert.notEqual(trial.quadNorm[0], cand.quadNorm[0]);
  }
});

test("11. mirrored Type A symmetry: NL along FL->NL and NR along FR->NR are mirror images", () => {
  const config: CoupledSearchConfig = { tNearSamples: 4, aspectRatios: [1.3], fixedWorldWidth: 1, maxEvaluations: 64 };
  const nl = generateTypeACoupledSearch({ candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.4 }), intrinsic: INTRINSIC, frame: FRAME, config })!;
  const nr = generateTypeACoupledSearch({ candidate: candidate(), annotation: nrAnnotation({ startT: 0, endT: 0.4 }), intrinsic: INTRINSIC, frame: FRAME, config })!;
  assert.equal(nl.trials.length, nr.trials.length);
  for (let i = 0; i < nl.trials.length; i += 1) {
    const a = nl.trials[i];
    const b = nr.trials[i];
    // NL moves index 0; NR moves index 1. Geometry is mirror-symmetric about x=0.5.
    assert.ok(Math.abs(a.quadNorm[0].x - (1 - b.quadNorm[1].x)) < 1e-9, `x mirror @${i}`);
    assert.ok(Math.abs(a.quadNorm[0].y - b.quadNorm[1].y) < 1e-9, `y match @${i}`);
    assert.equal(a.constraint.canEvaluate, b.constraint.canEvaluate);
  }
});

test("12. real-solver end-to-end: evaluable trials get a solver summary + a truthful state", () => {
  const set = runTypeACoupledSearch(
    { candidate: candidate(), annotation: nlAnnotation({ startT: 0, endT: 0.3 }), intrinsic: INTRINSIC, frame: FRAME },
    EVAL_CONTEXT
  )!;
  const allowed = new Set([
    "invalid_geometry",
    "no_pose",
    "pose_poor",
    "high_confidence_not_apply_safe",
    "apply_safe_diagnostic",
  ]);
  for (const trial of set.trials) {
    assert.ok(trial.state && allowed.has(trial.state));
    if (trial.constraint.canEvaluate) {
      assert.notEqual(trial.solver, null);
      assert.equal(trial.tuple.fovDeg, 55);
    } else {
      assert.equal(trial.solver, null);
      assert.equal(trial.state, "invalid_geometry");
    }
  }
});

test("13. coupled-search modules respect import boundaries (generation never imports the solver)", () => {
  const labDir = join(process.cwd(), "app", "admin", "3d-room-lab");
  const moduleAllow: Record<string, Set<string>> = {
    "manual-floor-support-coupled-search-types.ts": new Set([
      "./manual-floor-support-types",
      "./manual-floor-support-trial-types",
    ]),
    "manual-floor-support-coupled-search-generation.ts": new Set([
      "./manual-floor-support-types",
      "./manual-floor-support-validation",
      "./manual-floor-support-trial-geometry",
      "./manual-floor-support-trial-types",
      "./manual-floor-support-coupled-search-types",
    ]),
    "manual-floor-support-coupled-search-evaluation.ts": new Set([
      "./quad-solvability",
      "./image-space",
      "./manual-floor-support-trial-types",
      "./manual-floor-support-coupled-search-types",
      "./manual-floor-support-coupled-search-generation",
    ]),
  };
  const forbiddenSubstrings = ["scene-state", "calibrated-camera-apply", "auto-floor-detection", "auto-floor-scoring", "snapshot"];
  for (const [fileName, allow] of Object.entries(moduleAllow)) {
    const source = readFileSync(join(labDir, fileName), "utf8");
    const importRegex = /import[\s\S]*?from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      assert.ok(allow.has(match[1]), `${fileName}: disallowed import "${match[1]}"`);
    }
    for (const forbidden of forbiddenSubstrings) {
      assert.ok(
        !new RegExp(`from\\s+["'][^"']*${forbidden}[^"']*["']`).test(source),
        `${fileName} must not import ${forbidden}`
      );
    }
    for (const banned of ["setFloorPolygon", "applyCalibrated", "useState", "useEffect", "Promote"]) {
      assert.ok(!source.includes(banned), `${fileName} must not reference ${banned}`);
    }
  }
  // The generation module specifically must never import the solver.
  const genSource = readFileSync(join(labDir, "manual-floor-support-coupled-search-generation.ts"), "utf8");
  assert.ok(
    !/from\s+["'][^"']*quad-solvability[^"']*["']/.test(genSource),
    "generation must not import quad-solvability"
  );
});
