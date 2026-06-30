import assert from "node:assert/strict";
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
import type { QuadSolvabilityResult } from "./quad-solvability";
import type { QuadSolvabilityFovScanConfig } from "./quad-solvability";
import {
  DEFAULT_COUPLED_SEARCH_ASPECT_RATIOS,
} from "./manual-floor-support-coupled-search-types";
import { generateTypeACoupledSearch } from "./manual-floor-support-coupled-search-generation";
import type { CoupledSearchCandidate } from "./manual-floor-support-coupled-search-generation";
import {
  createDefaultLocalRefinementConfig,
  TYPE_A_LOCAL_REFINEMENT_SET_SCHEMA,
  type LocalRefinementConfig,
  type LocalRefinementSeed,
} from "./manual-floor-support-local-refinement-types";
import {
  generateTypeALocalRefinement,
  type LocalRefinementGenerationInput,
} from "./manual-floor-support-local-refinement-generation";
import {
  DEFAULT_LOCAL_REFINEMENT_FOV_SCAN_CONFIG,
  evaluateLocalRefinementResultSet,
  fovProbesIntersectingHighConfidence,
  runTypeALocalRefinement,
  type LocalQuadEvaluator,
  type LocalRefinementEvaluationContext,
} from "./manual-floor-support-local-refinement-evaluation";

// Square frame => object-cover crop is identity (container-norm == source-norm).
const INTRINSIC: ImageIntrinsicSize = { width: 1000, height: 1000 };
const FRAME: ImageFrameSize = { width: 1000, height: 1000 };

function baselineQuad(): CoupledSearchCandidate["quadNorm"] {
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
    adjustmentAuthority: { kind: "single_corner", corner: "NL", seamId: seam.id, allowedSpan: span },
  };
}

function nrAnnotation(span: { startT: number; endT: number }): ManualFloorSupportAnnotation {
  const seam = rightSeam();
  return {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [seam],
    mode: "single_corner_constrained",
    adjustmentAuthority: { kind: "single_corner", corner: "NR", seamId: seam.id, allowedSpan: span },
  };
}

function nlSeed(overrides: Partial<LocalRefinementSeed> = {}): LocalRefinementSeed {
  return {
    sourceCandidateId: "cand-1",
    movableCorner: "NL",
    seamId: "seam-left",
    determiningEdge: null,
    coarseTuple: {
      tNear: 0.3333,
      aspectRatio: 0.8333,
      fixedWorldWidth: 4,
      worldDepth: 3.3332,
      probeFovDeg: 36,
      coarseFovCorridors: null,
    },
    ...overrides,
  };
}

const LOCAL_EVAL_CONTEXT: LocalRefinementEvaluationContext = {
  frame: FRAME,
  fovScanConfig: DEFAULT_LOCAL_REFINEMENT_FOV_SCAN_CONFIG,
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

type RecordedCall = { isProbe: boolean; fov: number; scan: QuadSolvabilityFovScanConfig };

function recordingEvaluator(
  geomResult: () => QuadSolvabilityResult,
  probeResult: (fov: number) => QuadSolvabilityResult
): { evaluator: LocalQuadEvaluator; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const evaluator: LocalQuadEvaluator = (input) => {
    const isProbe = input.fovScanConfig.minFovDeg === input.fovScanConfig.maxFovDeg;
    calls.push({ isProbe, fov: input.currentVerticalFovDeg, scan: input.fovScanConfig });
    return isProbe ? probeResult(input.currentVerticalFovDeg) : geomResult();
  };
  return { evaluator, calls };
}

function uniqueAscending(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 1e-9) out.push(v);
  }
  return out;
}

// --- Tests ------------------------------------------------------------------

test("1. explicit-seed requirement: mismatched/invalid seeds reject safely (null)", () => {
  const ann = nlAnnotation({ startT: 0, endT: 1 });
  const base: LocalRefinementGenerationInput = {
    candidate: candidate(),
    annotation: ann,
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  };
  // Valid seed -> non-null.
  assert.ok(generateTypeALocalRefinement(base));

  // sourceCandidateId mismatch.
  assert.equal(
    generateTypeALocalRefinement({ ...base, seed: nlSeed({ sourceCandidateId: "other" }) }),
    null
  );
  // movableCorner mismatch (authority is NL).
  assert.equal(
    generateTypeALocalRefinement({ ...base, seed: nlSeed({ movableCorner: "NR" }) }),
    null
  );
  // seamId mismatch.
  assert.equal(
    generateTypeALocalRefinement({ ...base, seed: nlSeed({ seamId: "seam-wrong" }) }),
    null
  );
  // invalid coarse tuple (non-positive aspect ratio).
  assert.equal(
    generateTypeALocalRefinement({
      ...base,
      seed: nlSeed({ coarseTuple: { ...nlSeed().coarseTuple, aspectRatio: 0 } }),
    }),
    null
  );
  // invalid coarse tuple (non-positive width).
  assert.equal(
    generateTypeALocalRefinement({
      ...base,
      seed: nlSeed({ coarseTuple: { ...nlSeed().coarseTuple, fixedWorldWidth: 0 } }),
    }),
    null
  );
  // non-Type-A / wrong mode rejects (empty annotation, direct mode).
  assert.equal(
    generateTypeALocalRefinement({ ...base, annotation: createEmptyManualFloorSupportAnnotation() }),
    null
  );
  // missing image/frame.
  assert.equal(generateTypeALocalRefinement({ ...base, intrinsic: null }), null);

  // Determining-edge is preserved verbatim as evidence (never inferred/consumed).
  const withEdge = generateTypeALocalRefinement({
    ...base,
    seed: nlSeed({
      determiningEdge: {
        seamId: "seam-rear",
        role: "rear_floor_wall_edge",
        intendedCanonicalSupport: ["FL", "FR"],
      },
    }),
  })!;
  assert.equal(withEdge.seed.determiningEdge?.seamId, "seam-rear");
});

test("2. deterministic local tNear sampling: offsets resolve, clamp at proposal, dedupe", () => {
  // Wide span: 5 offsets resolve to 5 distinct ascending t around seed 0.3333.
  const wide = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const wideTs = uniqueAscending(wide.geometryTuples.map((g) => g.tNear));
  assert.equal(wideTs.length, 5);
  const expected = [0.25, 0.2916, 0.3333, 0.375, 0.4166];
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(wideTs[i] - expected[i]) < 1e-6, `t[${i}] ${wideTs[i]}`);
  }

  // Tight span [0.30, 0.36]: low offsets clamp to 0.30, high offsets clamp to
  // 0.36; deterministic dedupe collapses to exactly [0.30, 0.3333, 0.36].
  const tight = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0.3, endT: 0.36 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const tightTs = uniqueAscending(tight.geometryTuples.map((g) => g.tNear));
  assert.equal(tightTs.length, 3);
  assert.ok(Math.abs(tightTs[0] - 0.3) < 1e-9);
  assert.ok(Math.abs(tightTs[1] - 0.3333) < 1e-9);
  assert.ok(Math.abs(tightTs[2] - 0.36) < 1e-9);

  // Determinism: identical inputs deep-equal.
  const a = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  assert.deepEqual(a, wide);
});

test("3. exact geometry: sampled coordinates retained; fixed corners byte-identical; off-frame rejected not clamped", () => {
  const cand = candidate();
  const set = generateTypeALocalRefinement({
    candidate: cand,
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  // Exact sampled geometry: moved NL corner equals the exact sampled containerNorm.
  for (const g of set.geometryTuples) {
    const move = g.sampledCornerMoves[0];
    assert.equal(move.corner, "NL");
    assert.equal(move.seamId, "seam-left");
    assert.ok(Math.abs(move.sourcePx.x - move.sourceNorm.x * 1000) < 1e-6);
    assert.ok(Math.abs(move.sourcePx.y - move.sourceNorm.y * 1000) < 1e-6);
    // identity crop => containerNorm == sourceNorm.
    assert.ok(Math.abs(move.containerNorm.x - move.sourceNorm.x) < 1e-9);
    assert.deepEqual(g.quadNorm[0], { x: move.containerNorm.x, y: move.containerNorm.y });
    // Fixed corners are byte-identical to baseline.
    assert.deepEqual(g.quadNorm[1], cand.quadNorm[1]); // NR
    assert.deepEqual(g.quadNorm[2], cand.quadNorm[2]); // FR
    assert.deepEqual(g.quadNorm[3], cand.quadNorm[3]); // FL
  }

  // Off-frame: a high seam cropped out by a short frame is rejected, not clamped.
  const shortFrame: ImageFrameSize = { width: 1000, height: 400 };
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
  const offFrame = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }, highSeam),
    seed: nlSeed({ seamId: "seam-high" }),
    intrinsic: INTRINSIC,
    frame: shortFrame,
  })!;
  assert.ok(offFrame.geometryTuples.length > 0);
  for (const g of offFrame.geometryTuples) {
    assert.equal(g.state, "invalid_geometry");
    assert.equal(g.constraint.canEvaluate, false);
    assert.ok(g.constraint.hardReasons.some((r) => /off-frame/.test(r)));
    assert.ok(g.sampledCornerMoves[0].containerNorm.y > 1, "off-frame y preserved (unclamped)");
  }
});

test("4. aspect model: worldDepth = aspectRatio * worldWidth; 0.8333 × 4.00 ≈ 3.3332", () => {
  const set = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  for (const g of set.geometryTuples) {
    assert.equal(g.worldWidth, 4);
    assert.ok(Math.abs(g.worldDepth - g.aspectRatio * 4) < 1e-12);
  }
  const oracle = set.geometryTuples.find((g) => g.aspectRatio === 0.8333);
  assert.ok(oracle, "expected a 0.8333 aspect tuple");
  assert.ok(Math.abs(oracle!.worldDepth - 3.3332) < 1e-9, `depth ${oracle!.worldDepth}`);
});

test("5. broad-search isolation: Phase 2O-G defaults untouched; separate module + schema", () => {
  // The Phase 2O-J coarse band is unchanged by this layer.
  assert.deepEqual(
    [...DEFAULT_COUPLED_SEARCH_ASPECT_RATIOS],
    [0.75, 0.8, 0.8333, 0.9, 1.0, 1.1, 1.3, 1.4, 1.55]
  );
  // The coarse search remains independently functional.
  const coarse = generateTypeACoupledSearch({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 0.4 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  assert.ok(coarse && coarse.trials.length > 0);
  // Local refinement is a distinct schema/path.
  const local = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  assert.equal(local.schema, TYPE_A_LOCAL_REFINEMENT_SET_SCHEMA);
  assert.notEqual(local.schema, coarse!.schema);
});

test("6. local geometry ordering: ascending tNear then ascending aspect; eval preserves order", () => {
  const config: LocalRefinementConfig = {
    ...createDefaultLocalRefinementConfig(),
    tNearOffsets: [-0.0417, 0, 0.0417],
    aspectRatios: [0.85, 0.78, 0.8], // supplied out of order
  };
  const set = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config,
  })!;
  const sortedAspects = [0.78, 0.8, 0.85];
  let prevT = -Infinity;
  for (const g of set.geometryTuples) {
    assert.ok(g.tNear >= prevT - 1e-12);
    if (Math.abs(g.tNear - prevT) > 1e-12) prevT = g.tNear;
    assert.equal(g.aspectRatio, sortedAspects[g.generation.aspectIndex]);
  }
  // Evaluation preserves geometry-tuple order exactly (no ranking).
  const { evaluator } = recordingEvaluator(
    () => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false, highConfIntervals: null }),
    (fov) => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: fov === 36 })
  );
  const evaluated = evaluateLocalRefinementResultSet(set, LOCAL_EVAL_CONTEXT, evaluator);
  assert.deepEqual(
    evaluated.geometryTuples.map((g) => g.geometryTupleId),
    set.geometryTuples.map((g) => g.geometryTupleId)
  );
});

test("7. FOV probe policy: full scan once per geometry tuple; probes only intersect high-confidence; ascending", () => {
  const config: LocalRefinementConfig = {
    ...createDefaultLocalRefinementConfig(),
    tNearOffsets: [-0.0417, 0, 0.0417], // 3 tNear
    aspectRatios: [0.8, 0.8333], // 2 aspects => 6 geometry tuples
    maxProbeEvaluations: 128,
  };
  const set = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config,
  })!;
  const evaluableCount = set.geometryTuples.filter((g) => g.constraint.canEvaluate).length;
  assert.equal(evaluableCount, 6);

  // Geometry calls expose a high-confidence corridor [35,38]; configured probes
  // intersecting it are 35,36,37,38 (4 per tuple).
  const { evaluator, calls } = recordingEvaluator(
    () => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false, highConfIntervals: [[35, 38]] }),
    (fov) => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: fov === 36 })
  );
  const evaluated = evaluateLocalRefinementResultSet(set, LOCAL_EVAL_CONTEXT, evaluator);

  // Exactly one FULL scan call per evaluable geometry tuple.
  const fullScanCalls = calls.filter((c) => !c.isProbe);
  assert.equal(fullScanCalls.length, evaluableCount);
  for (const c of fullScanCalls) {
    assert.notEqual(c.scan.minFovDeg, c.scan.maxFovDeg); // full range
    assert.equal(c.fov, 36); // seed probe FOV used for geometry-level decomposition
  }
  // Probe calls only at intersecting FOVs, narrow (min===max), ascending per tuple.
  const probeCalls = calls.filter((c) => c.isProbe);
  assert.equal(probeCalls.length, evaluableCount * 4);
  for (const c of probeCalls) {
    assert.equal(c.scan.minFovDeg, c.scan.maxFovDeg);
    assert.ok([35, 36, 37, 38].includes(c.fov));
  }
  for (const g of evaluated.geometryTuples) {
    assert.deepEqual(g.probes.map((p) => p.fovDeg), [35, 36, 37, 38]);
    assert.ok(g.probes.every((p) => p.geometryTupleId === g.geometryTupleId));
  }
  assert.equal(evaluated.probeEvaluationCount, evaluableCount * 4);
  assert.equal(evaluated.truncatedProbes, false);

  // Helper agrees with the policy.
  assert.deepEqual(
    fovProbesIntersectingHighConfidence({ fovCorridors: { valid: null, highConfidence: [[35, 38]] } }, config.fovProbesDeg),
    [35, 36, 37, 38]
  );
  // No high-confidence corridor => no probes.
  assert.deepEqual(
    fovProbesIntersectingHighConfidence({ fovCorridors: { valid: [[20, 80]], highConfidence: null } }, config.fovProbesDeg),
    []
  );
});

test("8. probe cap: deterministic trailing truncation, truthful metadata, no metric skipping", () => {
  const config: LocalRefinementConfig = {
    ...createDefaultLocalRefinementConfig(),
    tNearOffsets: [-0.0417, 0, 0.0417],
    aspectRatios: [0.8, 0.8333], // 6 tuples × 4 intersecting probes = 24 candidates
    maxProbeEvaluations: 5,
  };
  const set = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config,
  })!;
  const { evaluator } = recordingEvaluator(
    () => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false, highConfIntervals: [[35, 38]] }),
    (fov) => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: fov === 36 })
  );
  const evaluated = evaluateLocalRefinementResultSet(set, LOCAL_EVAL_CONTEXT, evaluator);

  assert.equal(evaluated.probeEvaluationCount, 5);
  assert.equal(evaluated.truncatedProbes, true);
  // The retained probes are exactly the first 5 in generation order: tuple0's
  // [35,36,37,38] then tuple1's [35].
  const allProbeIds = evaluated.geometryTuples.flatMap((g) => g.probes.map((p) => p.fovDeg));
  assert.deepEqual(allProbeIds, [35, 36, 37, 38, 35]);
  assert.equal(evaluated.geometryTuples[0].probes.length, 4);
  assert.equal(evaluated.geometryTuples[1].probes.length, 1);
  for (let i = 2; i < evaluated.geometryTuples.length; i += 1) {
    assert.equal(evaluated.geometryTuples[i].probes.length, 0);
  }
});

test("9. state mapping: geometry-level + per-probe truthful states", () => {
  const config: LocalRefinementConfig = {
    ...createDefaultLocalRefinementConfig(),
    tNearOffsets: [0],
    aspectRatios: [0.8333],
    maxProbeEvaluations: 128,
  };
  const set = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }),
    seed: nlSeed(),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config,
  })!;
  // Geometry call: high-confidence corridor spanning all probes so every FOV
  // probes; per-probe states vary by FOV.
  const probeByFov: Record<number, QuadSolvabilityResult> = {
    34: makeSolverResult({ poseAvailable: false, confidence: null, applyAvailable: false }), // no_pose
    35: makeSolverResult({ poseAvailable: true, confidence: "low", applyAvailable: false }), // pose_poor
    36: makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false }), // high_conf_not_apply
    37: makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: true }), // apply_safe
  };
  const { evaluator } = recordingEvaluator(
    () => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false, highConfIntervals: [[34, 37]] }),
    (fov) => probeByFov[fov]
  );
  const evaluated = evaluateLocalRefinementResultSet(set, LOCAL_EVAL_CONTEXT, evaluator);
  const g = evaluated.geometryTuples[0];
  assert.equal(g.state, "high_confidence_not_apply_safe"); // geometry-level
  const stateByFov = Object.fromEntries(g.probes.map((p) => [p.fovDeg, p.state]));
  assert.equal(stateByFov[34], "no_pose");
  assert.equal(stateByFov[35], "pose_poor");
  assert.equal(stateByFov[36], "high_confidence_not_apply_safe");
  assert.equal(stateByFov[37], "apply_safe_diagnostic");

  // invalid_geometry geometry-level state never reaches the evaluator.
  const shortFrame: ImageFrameSize = { width: 1000, height: 400 };
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
  const invalidSet = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 1 }, highSeam),
    seed: nlSeed({ seamId: "seam-high" }),
    intrinsic: INTRINSIC,
    frame: shortFrame,
    config,
  })!;
  let calls = 0;
  const counting: LocalQuadEvaluator = () => {
    calls += 1;
    return makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false });
  };
  const invalidEvaluated = evaluateLocalRefinementResultSet(invalidSet, { ...LOCAL_EVAL_CONTEXT, frame: shortFrame }, counting);
  assert.equal(calls, 0);
  for (const tuple of invalidEvaluated.geometryTuples) {
    assert.equal(tuple.state, "invalid_geometry");
    assert.equal(tuple.solver, null);
    assert.equal(tuple.probes.length, 0);
  }
});

test("10. no baseline mutation or aliasing", () => {
  const cand = candidate();
  const snapshot = JSON.stringify(cand);
  const result = runTypeALocalRefinement(
    {
      candidate: cand,
      annotation: nlAnnotation({ startT: 0, endT: 1 }),
      seed: nlSeed(),
      intrinsic: INTRINSIC,
      frame: FRAME,
    },
    LOCAL_EVAL_CONTEXT,
    () => makeSolverResult({ poseAvailable: true, confidence: "high", applyAvailable: false, highConfIntervals: null })
  )!;
  assert.equal(JSON.stringify(cand), snapshot);
  for (const g of result.geometryTuples) {
    assert.notEqual(g.quadNorm, cand.quadNorm);
    assert.notEqual(g.quadNorm[0], cand.quadNorm[0]);
  }
  // Sibling tuples are independent arrays/objects.
  if (result.geometryTuples.length >= 2) {
    assert.notEqual(result.geometryTuples[0].quadNorm, result.geometryTuples[1].quadNorm);
  }
});

test("11. mirrored Type A authority: NL along FL->NL and NR along FR->NR are mirror images", () => {
  const config: LocalRefinementConfig = {
    ...createDefaultLocalRefinementConfig(),
    tNearOffsets: [-0.0417, 0, 0.0417],
    aspectRatios: [0.8333],
  };
  const seedTuple = { tNear: 0.2, aspectRatio: 0.8333, fixedWorldWidth: 4, worldDepth: 3.3332, probeFovDeg: 36, coarseFovCorridors: null };
  const nl = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nlAnnotation({ startT: 0, endT: 0.6 }),
    seed: nlSeed({ coarseTuple: seedTuple }),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config,
  })!;
  const nr = generateTypeALocalRefinement({
    candidate: candidate(),
    annotation: nrAnnotation({ startT: 0, endT: 0.6 }),
    seed: nlSeed({ movableCorner: "NR", seamId: "seam-right", coarseTuple: seedTuple }),
    intrinsic: INTRINSIC,
    frame: FRAME,
    config,
  })!;
  assert.equal(nl.geometryTuples.length, nr.geometryTuples.length);
  for (let i = 0; i < nl.geometryTuples.length; i += 1) {
    const a = nl.geometryTuples[i];
    const b = nr.geometryTuples[i];
    // NL moves index 0; NR moves index 1; mirror-symmetric about x = 0.5.
    assert.ok(Math.abs(a.quadNorm[0].x - (1 - b.quadNorm[1].x)) < 1e-9, `x mirror @${i}`);
    assert.ok(Math.abs(a.quadNorm[0].y - b.quadNorm[1].y) < 1e-9, `y match @${i}`);
    assert.equal(a.constraint.canEvaluate, b.constraint.canEvaluate);
  }
});

test("12. real-solver end-to-end: bounded probes wired through the default evaluator", () => {
  // No injected double: exercises evaluateQuadSolvability + the narrow probe
  // adapter. Asserts only structural truths (no thresholds asserted).
  const result = runTypeALocalRefinement(
    {
      candidate: candidate(),
      annotation: nlAnnotation({ startT: 0, endT: 1 }),
      seed: nlSeed(),
      intrinsic: INTRINSIC,
      frame: FRAME,
    },
    LOCAL_EVAL_CONTEXT
  )!;
  assert.ok(result.geometryTuples.length > 0);
  assert.ok(result.probeEvaluationCount <= result.config.maxProbeEvaluations);
  const allowed = new Set([
    "invalid_geometry",
    "no_pose",
    "pose_poor",
    "high_confidence_not_apply_safe",
    "apply_safe_diagnostic",
  ]);
  for (const g of result.geometryTuples) {
    if (g.constraint.canEvaluate) {
      assert.ok(g.state && allowed.has(g.state));
    } else {
      assert.equal(g.state, "invalid_geometry");
      assert.equal(g.probes.length, 0);
    }
    for (const p of g.probes) {
      assert.ok(allowed.has(p.state));
      assert.ok(fovProbesIntersectingHighConfidence({ fovCorridors: g.fovCorridors }, [p.fovDeg]).length === 1);
    }
  }
});
