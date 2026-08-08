import assert from "node:assert/strict";
import test from "node:test";

import roomC from "./fixtures/afc-sr1-room-c-ground-truth.v1.json";
import {
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1OverlayDescriptor,
  buildAfcSr1SemanticPriorBinding,
  buildAfcSr1SemanticPriorRequest,
  buildAfcSr1SolverHandoff,
  pointOnAfcSr1NearToFarSeam,
  validateAfcSr1SemanticPriorResponse,
  type AfcSr1SourcePolygon,
} from "./afc-sr1-semantic-prior";
import {
  DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG,
  digestAfcSr1JointSolverConfig,
  evaluateAfcSr1JointCandidate,
  fovCoarseTicks,
  rankAfcSr1JointSolverCandidates,
  ratioCoarseTicks,
  seamTAdvisoryDensificationTicks,
  seamTGlobalTicks,
  seamTSamplesForHypothesis,
  solveAfcSr1JointCalibration,
  type AfcSr1JointSolverCandidateV1,
  type AfcSr1JointSolverConfigV1,
  type AfcSr1JointSolverEvaluationContextV1,
} from "./afc-sr1-joint-solver";

const hash = (digit: string) => digit.repeat(64);
const basePolygon: AfcSr1SourcePolygon = [
  { x: 0.12, y: 0.88 },
  { x: 0.89, y: 0.82 },
  { x: 0.68, y: 0.38 },
  { x: 0.29, y: 0.43 },
];

const context: AfcSr1JointSolverEvaluationContextV1 = Object.freeze({
  schemaVersion: "afc-sr1-joint-solver-evaluation-context/v1",
  frameSize: Object.freeze({ width: 960, height: 640 }),
  coverCropPolicy: "existing_image_space_cover_crop/v1",
  researchBasisQualified: true,
});

const fastConfig: AfcSr1JointSolverConfigV1 = Object.freeze({
  schemaVersion: "afc-sr1-joint-solver-config/v1",
  algorithmVersion: "afc-sr1-joint-solver-algorithm/v1",
  referenceDepthM: 1,
  ratioSearch: Object.freeze({ min: 0.5, max: 2, coarseStep: 0.75, refineStep: 0.25 }),
  fovSearch: Object.freeze({ minDeg: 20, maxDeg: 90, coarseStepDeg: 35, refineStepDeg: 10 }),
  seamSearch: Object.freeze({
    globalMinExclusive: 0,
    globalMaxExclusive: 1,
    coarseStep: 0.5,
    refineStep: 0.25,
    advisoryDensificationStep: 0.1,
  }),
  semanticPriorPolicy: "search_order_and_densification_only/v1",
  candidateQualification: "existing_calibrated_camera_apply_gates/v1",
  tieBreakPolicy: "geometric_then_canonical_parameter_order/v1",
});

function handoffFor(input: Readonly<{
  polygon?: AfcSr1SourcePolygon;
  decision?: "adjust_nl" | "adjust_nr" | "no_adjustment" | "abstain" | "unsupported_image_class";
  rankedHypotheses?: readonly ["none" | "NL" | "NR", "none" | "NL" | "NR", "none" | "NL" | "NR"];
  frameBasis?: Readonly<{ width: number; height: number }>;
}> = {}) {
  const polygon = input.polygon ?? basePolygon;
  const size = input.frameBasis ?? { width: 1600, height: 1000 };
  const original = { fingerprint: hash("a"), decodedWidth: size.width, decodedHeight: size.height, orientation: 1 as const };
  const placement = buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "already_original_basis",
    sourceEmptyBasis: original,
    targetOriginalBasis: original,
    compatibilityTier: "exact_grid_compatible",
    transferRecordFingerprint: hash("b"),
  });
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: {
      schemaVersion: "afc-sr1-replay-evidence-identity/v1",
      receiptContractVersion: "afc-r3c-proposal-run-receipt/v1",
      receiptFileName: "fixture.json",
      receiptSha256: hash("c"),
      requestId: "fixture-request",
      imageRole: "empty_room_boundary_specialist",
      r3bCandidateId: "afc-r3:fixture:1",
      r3cCandidateId: "afc-r3c:empty:afc-r3:fixture:1",
      inputImageFingerprint: original.fingerprint,
      originalImageFingerprint: original.fingerprint,
      emptyRoomAssistFingerprint: original.fingerprint,
      replayVerificationVersion: "fixture/v1",
      replayEvidenceFingerprint: hash("d"),
    },
    placement,
    rawSourcePolygon: polygon,
    overlayGenerationId: "fixture-overlay",
    requestGenerationId: "fixture-generation",
  });
  const overlay = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: original,
    rawSourcePolygon: polygon,
    overlayGenerationId: "fixture-overlay",
  });
  const request = buildAfcSr1SemanticPriorRequest({ semanticPriorBinding: binding, overlayDescriptor: overlay });
  const decision = input.decision ?? "adjust_nr";
  const geometric = decision === "adjust_nl" || decision === "adjust_nr";
  const top = decision === "adjust_nl" ? "NL" : decision === "adjust_nr" ? "NR" : "none";
  const ranking = input.rankedHypotheses ?? (
    top === "NL" ? ["NL", "NR", "none"] : top === "NR" ? ["NR", "NL", "none"] : ["none", "NL", "NR"]
  );
  const response = {
    schemaVersion: "afc-sr1-semantic-prior-response/v1" as const,
    bindingEcho: request.seamBindingToken,
    decision,
    rankedHypotheses: geometric ? [
      { hypothesis: ranking[0], score: 0.7 },
      { hypothesis: ranking[1], score: 0.2 },
      { hypothesis: ranking[2], score: 0.1 },
    ] : null,
    seamTPrior: geometric ? {
      adjustableCorner: top,
      preferredSeamT: 0.7,
      minSeamT: 0.5,
      maxSeamT: 0.9,
    } : null,
    semanticLabels: geometric ? ["both_side_walls_visible"] : [],
  };
  const validated = validateAfcSr1SemanticPriorResponse({
    response,
    semanticPriorBinding: binding,
    overlayDescriptor: overlay,
    request,
  });
  if (!validated.ok) throw new Error(validated.reasonCode);
  return buildAfcSr1SolverHandoff({
    semanticPriorBinding: binding,
    bindingToken: request.seamBindingToken,
    advisory: validated.value,
  });
}

function candidate(input: Readonly<{
  hypothesis: "none" | "NL" | "NR";
  seamT: number | null;
  applySafe?: boolean;
  confidence?: "high" | "low";
  cvAvg?: number;
  cvMax?: number;
}>): AfcSr1JointSolverCandidateV1 {
  return {
    cell: {
      hypothesis: input.hypothesis,
      seamT: input.seamT,
      widthDepthRatio: 1,
      verticalFovDeg: 60,
    },
    sourceNormalizedPolygon: basePolygon,
    polygonFingerprint: `${input.hypothesis}-${input.seamT}`,
    referenceDepthM: 1,
    relativeWidthM: 1,
    relativeDepthM: 1,
    metricScaleDeferred: true,
    camera: {
      confidence: input.confidence ?? "high",
      cvAvgPx: input.cvAvg ?? 1,
      cvMaxPx: input.cvMax ?? 2,
      displayAvgPx: 1,
      displayMaxPx: 2,
      columnScaleRatio: 1,
    },
    applyGateObservability: {
      available: input.applySafe ?? true,
      firstFailingGate: input.applySafe === false ? "scale-ratio" : null,
    },
  };
}

test("config, ratio, FOV, and seam grids are deterministic and retain ratios below one", () => {
  assert.ok(Object.isFrozen(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG));
  assert.equal(digestAfcSr1JointSolverConfig(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG),
    digestAfcSr1JointSolverConfig(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG));
  assert.deepEqual(ratioCoarseTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG), ratioCoarseTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG));
  assert.ok(ratioCoarseTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG).includes(0.5));
  assert.ok(fovCoarseTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG).includes(20));
  assert.ok(fovCoarseTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG).includes(90));
  assert.equal(seamTGlobalTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG).includes(0), false);
  assert.equal(seamTGlobalTicks(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG).includes(1), false);
  const changedConfig: AfcSr1JointSolverConfigV1 = Object.freeze({
    ...fastConfig,
    seamSearch: Object.freeze({ ...fastConfig.seamSearch, advisoryDensificationStep: 0.2 }),
  });
  assert.notEqual(digestAfcSr1JointSolverConfig(fastConfig), digestAfcSr1JointSolverConfig(changedConfig));
});

test("none retains the exact raw polygon and NL/NR alter only their certified near-to-far seam", () => {
  const handoff = handoffFor();
  const none = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "none", seamT: null, widthDepthRatio: 1.25, verticalFovDeg: 55 },
  });
  assert.ok(none.ok);
  if (!none.ok) return;
  assert.deepEqual(none.candidate.sourceNormalizedPolygon, handoff.rawSourcePolygon);
  assert.equal(none.candidate.cell.seamT, null);

  const nl = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "NL", seamT: 0.5, widthDepthRatio: 1.25, verticalFovDeg: 55 },
  });
  assert.ok(nl.ok);
  if (!nl.ok) return;
  assert.deepEqual(nl.candidate.sourceNormalizedPolygon[0], pointOnAfcSr1NearToFarSeam(handoff.canonicalSeams.NL, 0.5));
  assert.deepEqual(nl.candidate.sourceNormalizedPolygon.slice(1), handoff.rawSourcePolygon.slice(1));

  const nr = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "NR", seamT: 0.5, widthDepthRatio: 1.25, verticalFovDeg: 55 },
  });
  assert.ok(nr.ok);
  if (!nr.ok) return;
  assert.deepEqual(nr.candidate.sourceNormalizedPolygon[1], pointOnAfcSr1NearToFarSeam(handoff.canonicalSeams.NR, 0.5));
  assert.deepEqual(nr.candidate.sourceNormalizedPolygon[0], handoff.rawSourcePolygon[0]);
  assert.deepEqual(nr.candidate.sourceNormalizedPolygon.slice(2), handoff.rawSourcePolygon.slice(2));
});

test("semantic densification only adds legal samples and usable order never prunes global geometry", () => {
  const handoff = handoffFor({ decision: "adjust_nr" });
  const global = seamTGlobalTicks(fastConfig);
  const samples = seamTSamplesForHypothesis(handoff, "NR", fastConfig);
  assert.ok(global.every(value => samples.includes(value)));
  assert.ok(samples.includes(0.7));
  assert.ok(samples.length > global.length);
  assert.deepEqual(
    seamTAdvisoryDensificationTicks(fastConfig, 0.5, 0.9, 0.7),
    seamTAdvisoryDensificationTicks(fastConfig, 0.5, 0.9, 0.7)
  );
});

test("safe abstention and unsupported semantic output retain neutral geometry order", () => {
  for (const decision of ["abstain", "unsupported_image_class"] as const) {
    const result = solveAfcSr1JointCalibration({
      solverHandoff: handoffFor({ decision }),
      evaluationContext: context,
      config: fastConfig,
    });
    assert.notEqual(result.status, "invalid_input");
    if (result.status !== "invalid_input") {
      assert.deepEqual(result.diagnostics.hypothesisOrder, ["none", "NL", "NR"]);
      assert.ok(result.diagnostics.evaluatedCellCount > 0);
    }
  }
});

test("off-frame source geometry remains unclamped, ratio below one remains legal, and near-degenerate seams reject locally", () => {
  const offFrame = handoffFor({
    polygon: [
      { x: -0.1, y: 0.88 },
      { x: 0.89, y: 0.82 },
      { x: 0.68, y: 0.38 },
      { x: 0.2, y: 0.43 },
    ],
  });
  const offFrameResult = evaluateAfcSr1JointCandidate({
    solverHandoff: offFrame, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "none", seamT: null, widthDepthRatio: 0.8, verticalFovDeg: 55 },
  });
  assert.notEqual(offFrameResult.ok ? null : offFrameResult.reasonCode, "source_extent_failure");
  if (offFrameResult.ok) assert.equal(offFrameResult.candidate.sourceNormalizedPolygon[0].x, -0.1);

  const handoff = handoffFor();
  const subUnit = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "none", seamT: null, widthDepthRatio: 0.8, verticalFovDeg: 55 },
  });
  assert.notEqual(subUnit.ok ? null : subUnit.reasonCode, "invalid_cell");
  const nearOne = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "NR", seamT: 0.99, widthDepthRatio: 1.25, verticalFovDeg: 55 },
  });
  assert.notEqual(nearOne.ok ? null : nearOne.reasonCode, "invalid_cell");
  const exactOne = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff, evaluationContext: context, config: fastConfig,
    cell: { hypothesis: "NR", seamT: 1, widthDepthRatio: 1.25, verticalFovDeg: 55 },
  });
  assert.deepEqual(exactOne, { ok: false, reasonCode: "invalid_cell" });
});

test("geometric ranking excludes semantic score: a wrong NL prior cannot defeat a stronger NR result", () => {
  const handoff = handoffFor({ decision: "adjust_nl", rankedHypotheses: ["NL", "NR", "none"] });
  assert.deepEqual(handoff.advisory.rankedHypotheses?.map(item => item.hypothesis), ["NL", "NR", "none"]);
  const nl = candidate({ hypothesis: "NL", seamT: 0.7, cvAvg: 8, cvMax: 12 });
  const nr = candidate({ hypothesis: "NR", seamT: 0.7, cvAvg: 0.1, cvMax: 0.2 });
  assert.equal(rankAfcSr1JointSolverCandidates([nl, nr])[0]?.cell.hypothesis, "NR");
});

test("a wrong NL semantic ordering still permits the globally stronger NR geometry to win", () => {
  const roomContext: AfcSr1JointSolverEvaluationContextV1 = Object.freeze({
    schemaVersion: "afc-sr1-joint-solver-evaluation-context/v1",
    frameSize: Object.freeze({
      width: roomC.calibration.cameraDiagnosticsContext.frameWidth,
      height: roomC.calibration.cameraDiagnosticsContext.frameHeight,
    }),
    coverCropPolicy: "existing_image_space_cover_crop/v1",
    researchBasisQualified: true,
  });
  const result = solveAfcSr1JointCalibration({
    solverHandoff: handoffFor({
      polygon: roomC.rawFloor.polygon as unknown as AfcSr1SourcePolygon,
      decision: "adjust_nl",
      rankedHypotheses: ["NL", "NR", "none"],
      frameBasis: { width: roomC.imageBasis.decodedWidth, height: roomC.imageBasis.decodedHeight },
    }),
    evaluationContext: roomContext,
  });
  assert.equal(result.status, "solved");
  if (result.status === "solved") assert.equal(result.candidate.cell.hypothesis, "NR");
});

test("ranking prioritizes Apply safety, confidence, residuals, then canonical parameter order", () => {
  const unavailable = candidate({ hypothesis: "none", seamT: null, applySafe: false, cvAvg: 0 });
  const low = candidate({ hypothesis: "NR", seamT: 0.2, confidence: "low", cvAvg: 0 });
  const highWorse = candidate({ hypothesis: "NR", seamT: 0.3, cvAvg: 2, cvMax: 3 });
  const highBetter = candidate({ hypothesis: "NL", seamT: 0.3, cvAvg: 1, cvMax: 3 });
  const highTie = candidate({ hypothesis: "none", seamT: null, cvAvg: 1, cvMax: 3 });
  assert.deepEqual(
    rankAfcSr1JointSolverCandidates([unavailable, low, highWorse, highBetter, highTie]).map(item => item.cell.hypothesis),
    ["none", "NL", "NR", "NR", "none"]
  );
});

test("Room C seam parameterization is representable by the existing Apply-safe evaluator", () => {
  const roomContext: AfcSr1JointSolverEvaluationContextV1 = Object.freeze({
    schemaVersion: "afc-sr1-joint-solver-evaluation-context/v1",
    frameSize: Object.freeze({
      width: roomC.calibration.cameraDiagnosticsContext.frameWidth,
      height: roomC.calibration.cameraDiagnosticsContext.frameHeight,
    }),
    coverCropPolicy: "existing_image_space_cover_crop/v1",
    researchBasisQualified: true,
  });
  const handoff = handoffFor({
    polygon: roomC.rawFloor.polygon as unknown as AfcSr1SourcePolygon,
    decision: "adjust_nr",
    frameBasis: { width: roomC.imageBasis.decodedWidth, height: roomC.imageBasis.decodedHeight },
  });
  const result = evaluateAfcSr1JointCandidate({
    solverHandoff: handoff,
    evaluationContext: roomContext,
    config: DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG,
    cell: {
      hypothesis: "NR",
      seamT: 0.7063703325987577,
      widthDepthRatio: 1.15,
      verticalFovDeg: 79,
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.candidate.applyGateObservability.available, true);
});

test("identical solves retain deterministic trace, winner identity, and digests", () => {
  const handoff = handoffFor();
  const left = solveAfcSr1JointCalibration({ solverHandoff: handoff, evaluationContext: context, config: fastConfig });
  const right = solveAfcSr1JointCalibration({ solverHandoff: handoff, evaluationContext: context, config: fastConfig });
  assert.deepEqual(left, right);
  assert.notEqual(left.status, "invalid_input");
});
