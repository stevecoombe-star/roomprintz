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
  buildAfcSr1TopKReference,
  certifyAfcSr1JointSolve,
  characterizeAfcSr1JointSolveRuntime,
  enumerateAfcSr1IndependentCoarse,
  refineAfcSr1IndependentSeed,
} from "./afc-sr1-solver-certification";
import {
  DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG,
  solveAfcSr1JointCalibration,
  type AfcSr1JointSolverConfigV1,
  type AfcSr1JointSolverEvaluationContextV1,
} from "./afc-sr1-joint-solver";

const hash = (digit: string) => digit.repeat(64);
const roomCPolygon = roomC.rawFloor.polygon as unknown as AfcSr1SourcePolygon;
const roomCContext: AfcSr1JointSolverEvaluationContextV1 = Object.freeze({
  schemaVersion: "afc-sr1-joint-solver-evaluation-context/v1",
  frameSize: Object.freeze({ width: 1118, height: 698 }),
  coverCropPolicy: "existing_image_space_cover_crop/v1",
  researchBasisQualified: true,
});
const roomCOracle = Object.freeze({
  hypothesis: "NR" as const,
  seamT: 0.7063703325987577,
  widthDepthRatio: 1.15,
  verticalFovDeg: 79,
});

const fastConfig: AfcSr1JointSolverConfigV1 = Object.freeze({
  schemaVersion: "afc-sr1-joint-solver-config/v1",
  algorithmVersion: "afc-sr1-joint-solver-algorithm/v1",
  referenceDepthM: 1,
  ratioSearch: Object.freeze({ min: 0.5, max: 2, coarseStep: 0.25, refineStep: 0.025 }),
  fovSearch: Object.freeze({ minDeg: 20, maxDeg: 90, coarseStepDeg: 10, refineStepDeg: 1 }),
  seamSearch: Object.freeze({
    globalMinExclusive: 0,
    globalMaxExclusive: 1,
    coarseStep: 0.25,
    refineStep: 0.025,
    advisoryDensificationStep: 0.05,
  }),
  refinement: Object.freeze({
    topSeedsPerHypothesis: 5,
  }),
  semanticPriorPolicy: "search_order_and_densification_only/v1",
  candidateQualification: "existing_calibrated_camera_apply_gates/v1",
  tieBreakPolicy: "geometric_then_canonical_parameter_order/v1",
});

function handoff(input: Readonly<{
  polygon?: AfcSr1SourcePolygon;
  decision: "adjust_nl" | "adjust_nr" | "abstain";
  ranking?: readonly ["none" | "NL" | "NR", "none" | "NL" | "NR", "none" | "NL" | "NR"];
  seam?: Readonly<{ min: number; max: number; preferred: number | null }> | null;
  basis?: Readonly<{ width: number; height: number }>;
}>) {
  const polygon = input.polygon ?? roomCPolygon;
  const dimensions = input.basis ?? { width: 7360, height: 4912 };
  const original = { fingerprint: hash("a"), decodedWidth: dimensions.width, decodedHeight: dimensions.height, orientation: 1 as const };
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
      receiptFileName: "s1-synthetic-evidence.json",
      receiptSha256: hash("c"),
      requestId: "s1-synthetic-request",
      imageRole: "empty_room_boundary_specialist",
      r3bCandidateId: "afc-r3:s1:1",
      r3cCandidateId: "afc-r3c:empty:afc-r3:s1:1",
      inputImageFingerprint: original.fingerprint,
      originalImageFingerprint: original.fingerprint,
      emptyRoomAssistFingerprint: original.fingerprint,
      replayVerificationVersion: "s1-test/v1",
      replayEvidenceFingerprint: hash("d"),
    },
    placement,
    rawSourcePolygon: polygon,
    overlayGenerationId: "s1-overlay",
    requestGenerationId: "s1-request",
  });
  const overlay = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: original, rawSourcePolygon: polygon, overlayGenerationId: "s1-overlay",
  });
  const request = buildAfcSr1SemanticPriorRequest({ semanticPriorBinding: binding, overlayDescriptor: overlay });
  const top = input.decision === "adjust_nl" ? "NL" : input.decision === "adjust_nr" ? "NR" : "none";
  const ranking = input.ranking ?? (top === "NL" ? ["NL", "NR", "none"] : top === "NR" ? ["NR", "NL", "none"] : ["none", "NL", "NR"]);
  const response = {
    schemaVersion: "afc-sr1-semantic-prior-response/v1" as const,
    bindingEcho: request.seamBindingToken,
    decision: input.decision,
    rankedHypotheses: input.decision === "abstain" ? null : [
      { hypothesis: ranking[0], score: 0.7 },
      { hypothesis: ranking[1], score: 0.2 },
      { hypothesis: ranking[2], score: 0.1 },
    ],
    seamTPrior: input.decision === "abstain" || input.seam === null ? null : {
      adjustableCorner: top,
      preferredSeamT: input.seam?.preferred ?? 0.7,
      minSeamT: input.seam?.min ?? 0.5,
      maxSeamT: input.seam?.max ?? 0.9,
    },
    semanticLabels: [],
  };
  const validated = validateAfcSr1SemanticPriorResponse({
    response, semanticPriorBinding: binding, overlayDescriptor: overlay, request,
  });
  assert.ok(validated.ok);
  if (!validated.ok) throw new Error("Synthetic advisory validation failed.");
  return buildAfcSr1SolverHandoff({
    semanticPriorBinding: binding, bindingToken: request.seamBindingToken, advisory: validated.value,
  });
}

function solved(result: ReturnType<typeof solveAfcSr1JointCalibration>) {
  assert.equal(result.status, "solved");
  if (result.status !== "solved") throw new Error("Expected solved.");
  return result.candidate;
}

function digest(result: ReturnType<typeof solveAfcSr1JointCalibration>): string {
  assert.notEqual(result.status, "invalid_input");
  if (result.status === "invalid_input") throw new Error("Expected a validated solve.");
  return result.solverDigest;
}

function evaluatedCount(result: ReturnType<typeof solveAfcSr1JointCalibration>): number {
  assert.notEqual(result.status, "invalid_input");
  if (result.status === "invalid_input") throw new Error("Expected a validated solve.");
  return result.diagnostics.evaluatedCellCount;
}

test("Room C full correct, neutral, and wrong-prior solves recover the NR basin", () => {
  const correct = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "adjust_nr", seam: { min: 0.65, max: 0.75, preferred: roomCOracle.seamT } }),
    evaluationContext: roomCContext,
  });
  const neutral = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "abstain" }), evaluationContext: roomCContext,
  });
  const wrong = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "adjust_nl", seam: { min: 0.55, max: 0.85, preferred: 0.7 } }),
    evaluationContext: roomCContext,
  });
  for (const result of [correct, neutral, wrong]) {
    const candidate = solved(result);
    assert.equal(candidate.cell.hypothesis, "NR");
    assert.equal(candidate.applyGateObservability.available, true);
  }
  assert.notEqual(digest(correct), digest(neutral));
  assert.notEqual(digest(neutral), digest(wrong));
});

test("Room C global grid discovers NR and ranking order alone cannot affect its winner", () => {
  const globalOnly = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "abstain" }), evaluationContext: roomCContext,
  });
  const densified = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "adjust_nr", seam: { min: 0.65, max: 0.75, preferred: roomCOracle.seamT } }),
    evaluationContext: roomCContext,
  });
  assert.equal(solved(globalOnly).cell.hypothesis, "NR");
  assert.equal(solved(densified).cell.hypothesis, "NR");

  const nlFirst = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "adjust_nl", ranking: ["NL", "NR", "none"], seam: null }),
    evaluationContext: roomCContext,
  });
  const nrFirst = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "adjust_nr", ranking: ["NR", "NL", "none"], seam: null }),
    evaluationContext: roomCContext,
  });
  assert.deepEqual(solved(nlFirst).cell, solved(nrFirst).cell);
  assert.equal(evaluatedCount(nlFirst), evaluatedCount(nrFirst));
});

test("search-integrity certification passes while GT0 parameter recovery remains unresolved", () => {
  const solverHandoff = handoff({ decision: "abstain" });
  const production = solveAfcSr1JointCalibration({ solverHandoff, evaluationContext: roomCContext });
  const coarse = enumerateAfcSr1IndependentCoarse({ solverHandoff, evaluationContext: roomCContext });
  assert.ok(coarse.NL.length > 0 && coarse.NR.length > 0);
  const reference = buildAfcSr1TopKReference({
    solverHandoff, evaluationContext: roomCContext, productionResult: production, k: 5,
  });
  assert.equal(reference.k, 5);
  assert.equal(reference.productionMatchesReference, true, JSON.stringify(reference));
  assert.ok(reference.best);
  const report = certifyAfcSr1JointSolve({
    fixtureId: "room-c-neutral",
    solverHandoff,
    evaluationContext: roomCContext,
    oracle: roomCOracle,
    reference,
  });
  assert.equal(report.certificationStatus, "pass");
  assert.equal(report.convergence, "certified");
  assert.equal(report.searchIntegrity, "certified");
  assert.equal(report.gt0ParameterRecovery, "diverged");
  assert.equal(report.physicalSelectionConstraintAvailable, false);
  assert.equal(report.withinRefineTolerance, false);
  assert.equal(report.deterministicReplay, true);
});

test("correct densified Room C production matches independent K=5 refinement", () => {
  const solverHandoff = handoff({
    decision: "adjust_nr",
    seam: { min: 0.65, max: 0.75, preferred: roomCOracle.seamT },
  });
  const production = solveAfcSr1JointCalibration({ solverHandoff, evaluationContext: roomCContext });
  const reference = buildAfcSr1TopKReference({
    solverHandoff, evaluationContext: roomCContext, productionResult: production, k: 5,
  });
  const candidate = solved(production);
  assert.equal(candidate.cell.hypothesis, "NR");
  assert.equal(reference.productionMatchesReference, true, JSON.stringify(reference));
  assert.deepEqual(candidate.cell, {
    hypothesis: reference.best?.hypothesis,
    seamT: reference.best?.seamT,
    widthDepthRatio: reference.best?.widthDepthRatio,
    verticalFovDeg: reference.best?.verticalFovDeg,
  });
});

test("synthetic seam variants are independently enumerable under wrong semantic order", () => {
  const target: AfcSr1SourcePolygon = [
    { x: 0.12, y: 0.88 }, { x: 0.89, y: 0.82 }, { x: 0.68, y: 0.38 }, { x: 0.29, y: 0.43 },
  ];
  const syntheticContext: AfcSr1JointSolverEvaluationContextV1 = Object.freeze({
    ...roomCContext, frameSize: Object.freeze({ width: 960, height: 640 }),
  });
  const targetHandoff = handoff({ polygon: target, basis: { width: 1600, height: 1000 }, decision: "adjust_nl", seam: null });
  const targetResult = solved(solveAfcSr1JointCalibration({
    solverHandoff: targetHandoff, evaluationContext: syntheticContext, config: fastConfig,
  }));
  const nlRaw = target.map(point => ({ ...point })) as [
    { x: number; y: number }, { x: number; y: number },
    { x: number; y: number }, { x: number; y: number },
  ];
  nlRaw[0] = pointOnAfcSr1NearToFarSeam(targetHandoff.canonicalSeams.NL, 0.25);
  const nrRaw = target.map(point => ({ ...point })) as [
    { x: number; y: number }, { x: number; y: number },
    { x: number; y: number }, { x: number; y: number },
  ];
  nrRaw[1] = pointOnAfcSr1NearToFarSeam(targetHandoff.canonicalSeams.NR, 0.25);
  for (const [id, polygon, wrongDecision] of [
    ["none", target, "adjust_nl"],
    ["NL", nlRaw as AfcSr1SourcePolygon, "adjust_nr"],
    ["NR", nrRaw as AfcSr1SourcePolygon, "adjust_nl"],
  ] as const) {
    const result = solved(solveAfcSr1JointCalibration({
      solverHandoff: handoff({ polygon, basis: { width: 1600, height: 1000 }, decision: wrongDecision, seam: null }),
      evaluationContext: syntheticContext,
      config: fastConfig,
    }));
    assert.ok(result.applyGateObservability.available, id);
    assert.ok(["none", "NL", "NR"].includes(result.cell.hypothesis), id);
  }
  assert.ok(targetResult.camera.cvAvgPx >= 0);
});

test("sub-one ratio recovery, off-frame, no-Apply-safe, no-geometric, and invalid inputs remain distinct", () => {
  const subOne: AfcSr1SourcePolygon = [
    { x: 0.35, y: 0.9 }, { x: 0.65, y: 0.9 }, { x: 0.55, y: 0.4 }, { x: 0.45, y: 0.4 },
  ];
  const offFrame: AfcSr1SourcePolygon = [
    { x: -0.1, y: 0.88 }, { x: 0.92, y: 0.85 }, { x: 0.72, y: 0.35 }, { x: 0.25, y: 0.4 },
  ];
  const context = Object.freeze({ ...roomCContext, frameSize: Object.freeze({ width: 960, height: 640 }) });
  const subOneResult = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ polygon: subOne, basis: { width: 1600, height: 1000 }, decision: "adjust_nr", seam: null }),
    evaluationContext: context, config: fastConfig,
  });
  assert.equal(subOneResult.status, "no_apply_safe_candidate");
  if (subOneResult.status === "no_apply_safe_candidate") {
    assert.ok(subOneResult.bestValidCandidate);
    assert.ok((subOneResult.bestValidCandidate?.cell.widthDepthRatio ?? 1) < 1);
  }
  const offFrameResult = solved(solveAfcSr1JointCalibration({
    solverHandoff: handoff({ polygon: offFrame, basis: { width: 1600, height: 1000 }, decision: "adjust_nl", seam: null }),
    evaluationContext: context, config: fastConfig,
  }));
  assert.equal(offFrameResult.sourceNormalizedPolygon[0].x, -0.1);

  const noGeometricPolygon: AfcSr1SourcePolygon = [
    { x: 0.1, y: 0.50000001 }, { x: 0.9, y: 0.5 },
    { x: 0.900000001, y: 0.5 }, { x: 0.100000001, y: 0.500000001 },
  ];
  const noGeometric = solveAfcSr1JointCalibration({
    solverHandoff: handoff({
      polygon: noGeometricPolygon,
      basis: { width: 1600, height: 1000 },
      decision: "abstain",
    }),
    evaluationContext: context,
    config: fastConfig,
  });
  assert.equal(noGeometric.status, "no_geometric_candidate");

  const invalid = solveAfcSr1JointCalibration({
    solverHandoff: handoff({ decision: "abstain" }),
    evaluationContext: { ...roomCContext, frameSize: { width: 0, height: 698 } } as AfcSr1JointSolverEvaluationContextV1,
  });
  assert.equal(invalid.status, "invalid_input");
});

test("principal replay and deterministic complexity counts are stable; runtime is informational", () => {
  const solverHandoff = handoff({ decision: "abstain" });
  const left = solveAfcSr1JointCalibration({ solverHandoff, evaluationContext: roomCContext });
  const right = solveAfcSr1JointCalibration({ solverHandoff, evaluationContext: roomCContext });
  assert.deepEqual(left, right);
  const runtime = characterizeAfcSr1JointSolveRuntime({
    solverHandoff, evaluationContext: roomCContext, runs: 3,
  });
  assert.equal(runtime.deterministicCounts, true);
  assert.ok(runtime.minMs >= 0 && runtime.medianMs >= runtime.minMs && runtime.maxMs >= runtime.medianMs);
});

test("certification source remains contained to research geometry dependencies", async () => {
  const source = await import("node:fs/promises").then(fs =>
    fs.readFile(new URL("./afc-sr1-solver-certification.ts", import.meta.url), "utf8")
  );
  for (const forbidden of [
    "afc-sr1-gemini-adapter", "afc-sr1-provider-execution", "afc-sr1-provider-replay",
    "ThreeRoomLab", "afc-verified-floor-apply", "afc-verified-camera-apply",
    "afc-verified-camera-binding", "CP2A", "CP2B", "fetch(", "Supabase", "React", "DOM",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
  assert.equal(Object.isFrozen(DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG), true);
});
