import assert from "node:assert/strict";
import test from "node:test";

import roomA from "./fixtures/room-a-floor-control.json";
import roomAFamily from "./fixtures/room-a-candidate-family.json";
import roomB from "./fixtures/room-b-floor-control.json";
import roomBFamily from "./fixtures/room-b-candidate-family.json";
import roomC from "./fixtures/room-c-floor-control.json";
import roomCFamily from "./fixtures/room-c-candidate-family.json";
import {
  CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
  CANDIDATE_DISCRIMINATION_POLICY,
  CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  compareCanonicalStrings,
  convexPolygonIoU,
  runCandidateDiscriminationExperiment,
  stableSerialize,
  type FloorCandidateComparisonInput,
  type FloorCandidateInput,
  type SharedCandidateComparisonContext,
} from "./candidate-discrimination-harness";

type Control = typeof roomA;
type FamilyFixture = Readonly<{
  controlRef: Readonly<{ fixtureId: string; basisFingerprint: string; approvedPolygonFingerprint: string }>;
  candidates: readonly Readonly<{
    candidateId: string;
    candidateSource: string;
    role?: string;
    notes?: string;
    transformSpec?: Record<string, unknown>;
    sourceFloorPolygon?: readonly RatioPoint[];
  }>[];
}>;
type RatioPoint = Readonly<{ x: number; y: number }>;

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function contextFor(control: Control): SharedCandidateComparisonContext {
  return {
    ratioFovContractVersion: "ratio-fov-harness/v1",
    basisId: control.imageBasis.basisId,
    basisFingerprint: control.imageBasis.basisFingerprint,
    decoderId: control.imageBasis.coordinateSpaceVersion.decoderId,
    normalizationPolicyVersion: "source-normalized/v1",
    decodedWidth: control.imageBasis.decodedWidth,
    decodedHeight: control.imageBasis.decodedHeight,
    frameSize: { ...control.frameSize },
    orientationApplied: false,
    basisKind: "original",
    ratioDomain: { min: 0.5, max: 2, step: 0.05 },
    fovDomain: { minDeg: 20, maxDeg: 90, stepDeg: 1 },
    refinement: { enabled: true, ratioStep: 0.005, fovStepDeg: 0.1, basinFactor: 1.25, additivePxAllowance: 0.25 },
    referenceDepth: 1,
  };
}

function controlCandidate(control: Control, candidateId = "approvedControlCandidate"): FloorCandidateInput {
  return {
    candidateId,
    candidateSource: "approved-control",
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon: structuredClone(control.sourceFloorPolygon) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  };
}

function input(control: Control, candidates: readonly FloorCandidateInput[]): FloorCandidateComparisonInput {
  return {
    contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
    sharedContext: contextFor(control),
    candidates,
    selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  };
}

function effective(candidate: ReturnType<typeof runCandidateDiscriminationExperiment>["candidateResults"][number]) {
  return candidate.effectiveStage === "stageB" && candidate.stageB ? candidate.stageB : candidate.stageA;
}

function fixtureCandidates(control: Control, fixture: FamilyFixture): FloorCandidateInput[] {
  assert.equal(fixture.controlRef.fixtureId, control.fixtureId);
  assert.equal(fixture.controlRef.basisFingerprint, control.imageBasis.basisFingerprint);
  assert.equal(
    fixture.controlRef.approvedPolygonFingerprint,
    fnv1a32(stableSerialize({
      coordinateSpace: "source-normalized/v1",
      semanticOrder: ["NL", "NR", "FR", "FL"],
      sourceFloorPolygon: control.sourceFloorPolygon,
    }))
  );
  return fixture.candidates.map((entry) => ({
    candidateId: entry.candidateId,
    candidateSource: entry.candidateSource as FloorCandidateInput["candidateSource"],
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon: ("sourceFloorPolygon" in entry
      ? entry.sourceFloorPolygon
      : structuredClone(control.sourceFloorPolygon)) as unknown as FloorCandidateInput["sourceFloorPolygon"],
    role: entry.role,
    notes: entry.notes,
    transformSpec: entry.transformSpec,
  }));
}

const fullFixtureCache = new Map<string, ReturnType<typeof runCandidateDiscriminationExperiment>>();

function fullFixtureResult(control: Control, fixture: FamilyFixture) {
  const cached = fullFixtureCache.get(fixture.controlRef.fixtureId);
  if (cached) return cached;
  const result = runCandidateDiscriminationExperiment(input(control, fixtureCandidates(control, fixture)));
  fullFixtureCache.set(fixture.controlRef.fixtureId, result);
  return result;
}

test("AFC-R2 validates control references and materialized candidate fixtures", () => {
  for (const [control, family] of [[roomA, roomAFamily], [roomB, roomBFamily], [roomC, roomCFamily]] as const) {
    const candidates = fixtureCandidates(control, family);
    assert.equal(candidates[0].candidateId, "approvedControlCandidate");
    assert.equal(candidates[1].candidateId, "duplicateOfApproved");
    assert.deepEqual(candidates[0].sourceFloorPolygon, control.sourceFloorPolygon);
  }
});

test("convex polygon IoU is deterministic, symmetric, and handles core cases", () => {
  const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  const disjoint = [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 2 }, { x: 3, y: 2 }];
  const overlap = [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }];
  const contained = [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }];
  assert.equal(convexPolygonIoU(square, square), 1);
  assert.equal(convexPolygonIoU(square, disjoint), 0);
  assert.equal(convexPolygonIoU(square, overlap), 1 / 3);
  assert.equal(convexPolygonIoU(square, contained), 0.25);
  assert.equal(convexPolygonIoU(square, overlap), convexPolygonIoU(overlap, square));
  const unchanged = structuredClone(square);
  assert.equal(convexPolygonIoU([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }] as RatioPoint[], square), null);
  assert.deepEqual(square, unchanged);
});

test("context and policy failures fail closed before evaluating candidates", () => {
  const base = input(roomB, [controlCandidate(roomB)]);
  for (const broken of [
    { ...base, contractVersion: "wrong" },
    { ...base, selectionPolicyVersion: "wrong" },
    { ...base, candidates: [] },
    { ...base, sharedContext: { ...base.sharedContext, orientationApplied: true } },
    { ...base, candidates: [controlCandidate(roomB, "same"), controlCandidate(roomB, "same")] },
  ]) {
    const result = runCandidateDiscriminationExperiment(broken as FloorCandidateComparisonInput);
    assert.equal(result.status, "comparison_context_invalid");
    assert.deepEqual(result.safety, { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
    assert.equal(result.candidateResults.length, 0);
  }
});

test("caller-owned shared context remains mutable and value-identical", () => {
  const comparison = input(roomB, [controlCandidate(roomB)]);
  const before = structuredClone(comparison);
  runCandidateDiscriminationExperiment(comparison);
  assert.deepEqual(comparison, before);
  assert.equal(Object.isFrozen(comparison.sharedContext), false);
  assert.equal(Object.isFrozen(comparison.sharedContext.frameSize), false);
  (comparison.sharedContext.frameSize as { width: number }).width += 1;
  assert.equal(comparison.sharedContext.frameSize.width, before.sharedContext.frameSize.width + 1);
  assert.doesNotThrow(() => runCandidateDiscriminationExperiment(structuredClone(before) as FloorCandidateComparisonInput));
});

test("exact duplicates reuse AFC-R1H2 evaluation and provenance does not alter geometry identity", () => {
  const approved = controlCandidate(roomB, "first-id");
  const duplicate = { ...controlCandidate(roomB, "second-id"), candidateSource: "research-probe" as const, role: "not-ranking-evidence", notes: "provenance only" };
  const result = runCandidateDiscriminationExperiment(input(roomB, [duplicate, approved]));
  assert.equal(result.rankingStages.exactDistinctCandidateCount, 1);
  assert.equal(result.rankingStages.stageAEvaluationCount, 1);
  assert.equal(result.rankingStages.stageBEvaluationCount, result.rankingStages.comparisonRelevantFamilyCount);
  assert.equal(result.rankingStages.exactDuplicateEvaluationReuse, 1);
  assert.equal(result.candidateResults[0].candidateGeometryFingerprint, result.candidateResults[1].candidateGeometryFingerprint);
  assert.equal(result.candidateFamilies.length, 1);
  assert.equal(result.candidateFamilies[0].exactDuplicateCount, 1);
  assert.strictEqual(result.candidateResults[0].stageA, result.candidateResults[1].stageA);
  assert.strictEqual(result.candidateResults[0].stageB, result.candidateResults[1].stageB);
  assert.ok(["no_valid_candidate", "equivalent_candidate_family", "insufficient_discrimination"].includes(result.status));
});

test("Stage-B confirmation asymmetry does not create a family Stage-A disagreement", () => {
  const candidates = fixtureCandidates(roomB, roomBFamily);
  const jittered = [
    controlCandidate(roomB),
    candidates.find((candidate) => candidate.candidateId === "equivalentFamilyMemberSubPixel")!,
    candidates.find((candidate) => candidate.candidateId === "equivalentFamilyMemberPlusOne")!,
  ];
  const result = runCandidateDiscriminationExperiment(input(roomB, jittered));
  assert.equal(result.candidateFamilies.length, 1);
  assert.equal(result.rankingStages.stageBEvaluationCount, 1);
  assert.equal(result.candidateFamilies[0].familyStageAGateDisagreement, false);
  assert.equal(result.candidateFamilies[0].representativeConfirmationFailure, false);
  assert.equal(result.candidateFamilies[0].totalReportingCandidateCount, 3);
  assert.equal(result.pairwiseComparisons.length, 0);
  assert.equal(result.selectionState, "equivalent_candidate_family");
  assert.equal(result.candidateResults.filter((candidate) => candidate.stageB !== null).length, 1);
});

test("equivalent candidate families ignore invalid non-relevant siblings", () => {
  const candidates = fixtureCandidates(roomB, roomBFamily);
  const invalid = candidates.find((candidate) => candidate.candidateId === "invalidInputProbeBowTie")!;
  const near = candidates.find((candidate) => candidate.candidateId === "equivalentFamilyMemberSubPixel")!;
  for (const members of [
    [controlCandidate(roomB), controlCandidate(roomB, "duplicate")],
    [controlCandidate(roomB), controlCandidate(roomB, "duplicate"), invalid],
    [controlCandidate(roomB), near],
    [controlCandidate(roomB), near, invalid],
  ]) {
    const result = runCandidateDiscriminationExperiment(input(roomB, members));
    assert.equal(result.selectionState, "equivalent_candidate_family");
    assert.equal(result.selectedCandidateFingerprint, null);
    assert.equal(result.selectedFamilyFingerprint, null);
    assert.deepEqual(result.refusalReasons, []);
    if (members.includes(invalid)) {
      const rejected = result.candidateResults.find((candidate) => candidate.candidateId === invalid.candidateId)!;
      assert.equal(rejected.validityLayer, "input_invalid");
      assert.ok(rejected.refusalReasons.includes("input_or_harness_failure:floor_polygon"));
    }
  }
});

test("a unique candidate ignores invalid sibling failures at top level", () => {
  const invalid = fixtureCandidates(roomB, roomBFamily).find((candidate) => candidate.candidateId === "invalidInputProbeBowTie")!;
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), invalid]));
  assert.equal(result.selectionState, "unique_candidate");
  assert.deepEqual(result.refusalReasons, []);
  assert.ok(result.candidateResults.find((candidate) => candidate.candidateId === invalid.candidateId)?.refusalReasons.includes("input_or_harness_failure:floor_polygon"));
});

test("comparison is deterministic and ignores candidate order and reporting provenance", () => {
  const approved = controlCandidate(roomB, "operator-a");
  const changedProvenance = { ...controlCandidate(roomB, "operator-b"), candidateSource: "gemini-proposal" as const, role: "annotationRequiredDecoy", notes: "non-geometric" };
  const first = runCandidateDiscriminationExperiment(input(roomB, [approved, changedProvenance]));
  const second = runCandidateDiscriminationExperiment(input(roomB, [changedProvenance, approved]));
  assert.equal(first.comparisonFingerprint, second.comparisonFingerprint);
  assert.equal(first.selectionState, second.selectionState);
  assert.equal(first.candidateResults[0].candidateGeometryFingerprint, second.candidateResults[0].candidateGeometryFingerprint);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.candidateResults));
  assert.ok(Object.isFrozen(first.candidateResults[0].hardGates));
  assert.throws(() => (first.safety as { applied: boolean }).applied = true, TypeError);
  assert.equal("effectiveResult" in first.candidateResults[0], false);
  assert.ok(Object.isFrozen(first.candidateResults[0].stageA));
  const confirmation = first.candidateResults[0].stageB;
  assert.ok(Object.isFrozen(confirmation?.status === "success" ? confirmation.perturbation?.samples[0] ?? {} : {}));
  assert.ok(Object.isFrozen(first.candidateFamilies));
  assert.ok(Object.isFrozen(first.policyVariantResults));
  assert.ok(Object.isFrozen(first.candidateResults[0].boundary));
  assert.ok(Object.isFrozen(first.pairwiseComparisons));
  assert.ok(Object.isFrozen(first.warnings));
});

test("semantic alternatives stay distinct and Room C screen recanonicalization fails closed", () => {
  const candidates = fixtureCandidates(roomC, roomCFamily);
  const screenRecanonicalized = candidates.find((candidate) => candidate.candidateId === "invalidInputProbeScreenRecanonicalized")!;
  const cyclic = candidates.find((candidate) => candidate.candidateId === "semanticAlternativeCandidateCyclic")!;
  const reversed = candidates.find((candidate) => candidate.candidateId === "semanticAlternativeCandidateReversed")!;
  const result = runCandidateDiscriminationExperiment(input(roomC, [controlCandidate(roomC), cyclic, reversed, screenRecanonicalized]));
  const invalid = result.candidateResults.find((candidate) => candidate.candidateId === screenRecanonicalized.candidateId)!;
  assert.equal(invalid.stageA.status, "failure");
  assert.equal(invalid.stageA.status === "failure" ? invalid.stageA.code : null, "floor_polygon");
  assert.notEqual(result.candidateResults.find((candidate) => candidate.candidateId === cyclic.candidateId)!.candidateGeometryFingerprint, result.candidateResults.find((candidate) => candidate.candidateId === "approvedControlCandidate")!.candidateGeometryFingerprint);
  assert.equal(result.safety.authoritative, false);
});

test("policy metadata is visible, fixed, exploratory, and excludes raw residual ranking", () => {
  assert.equal(CANDIDATE_DISCRIMINATION_POLICY.nearDuplicateToleranceIntrinsicPx, 1.5);
  assert.equal(CANDIDATE_DISCRIMINATION_POLICY.minimumForeshorteningRatio, 1.05);
  assert.deepEqual(Object.keys(CANDIDATE_DISCRIMINATION_POLICY.fixedPolicyVariants), ["nominal", "conservative", "permissive"]);
  assert.ok(CANDIDATE_DISCRIMINATION_POLICY.excludedDiagnostics.some((reason) => reason.startsWith("raw cvAvgPx")));
  assert.ok(Object.isFrozen(CANDIDATE_DISCRIMINATION_POLICY));
});

test("canonical ordering is locale-independent code-point ordering", () => {
  const shorter = '{"sourceFloorPolygon":[{"x":0.45189992159498205,"y":0.595103779515}]}';
  const longer = '{"sourceFloorPolygon":[{"x":0.45189992159498205,"y":0.5951037795153279}]}';
  assert.notEqual(compareCanonicalStrings(shorter, longer), shorter.localeCompare(longer));
  assert.equal(compareCanonicalStrings(shorter, longer), 1);
  assert.equal(compareCanonicalStrings(longer, shorter), -1);
});

test("production family representative uses code-point canonical geometry, never residual or provenance", () => {
  const full: FloorCandidateInput = {
    ...controlCandidate(roomB, "full-precision"),
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 2 ? { x: point.x + 0.7 / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  };
  const truncated: FloorCandidateInput = {
    ...controlCandidate(roomB, "truncated-and-better-looking"),
    candidateSource: "gemini-proposal",
    role: "provenance-only",
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 0 ? { x: point.x, y: 0.7085225978419 } :
      index === 2 ? { x: point.x - 0.7 / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  };
  const first = runCandidateDiscriminationExperiment(input(roomB, [full, truncated]));
  const second = runCandidateDiscriminationExperiment(input(roomB, [truncated, full]));
  const family = first.candidateFamilies[0];
  const canonicalKeys = first.candidateResults.map((candidate) => candidate.canonicalPolygonKey);
  assert.notEqual(compareCanonicalStrings(canonicalKeys[0], canonicalKeys[1]), canonicalKeys[0].localeCompare(canonicalKeys[1]));
  const expectedRepresentative = first.candidateResults
    .slice()
    .sort((left, right) => compareCanonicalStrings(left.canonicalPolygonKey, right.canonicalPolygonKey))[0];
  assert.equal(family.representativeFingerprint, expectedRepresentative.candidateGeometryFingerprint);
  assert.equal(second.candidateFamilies[0].representativeFingerprint, family.representativeFingerprint);
  const representative = first.candidateResults.find((candidate) => candidate.candidateGeometryFingerprint === family.representativeFingerprint)!;
  const other = first.candidateResults.find((candidate) => candidate !== representative)!;
  const raw = (candidate: typeof representative) => {
    const value = effective(candidate);
    return value.status === "success" ? value.ranking.globallyRankedBest?.cvAvgPx ?? Infinity : Infinity;
  };
  assert.ok(raw(other) < raw(representative) || (other.normalizedDiagnostics.rhoAvg ?? Infinity) < (representative.normalizedDiagnostics.rhoAvg ?? Infinity));
});

test("fixed policy variants reuse AFC-R1H2 evidence and agree before a unique selection", () => {
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB)]));
  assert.deepEqual(result.policyVariantResults.map((variant) => variant.name), ["nominal", "conservative", "permissive"]);
  assert.ok(result.policyVariantResults.every((variant) => variant.afcR1H2Reevaluated === false));
  assert.ok(result.policyVariantResults.every((variant) => variant.selectionState === "unique_candidate"));
  assert.ok(result.policyVariantResults.every((variant) => variant.selectedFamilyFingerprint === result.selectedFamilyFingerprint));
  assert.equal(result.rankingStages.stageAEvaluationCount, 1);
  assert.equal(result.rankingStages.stageBEvaluationCount, 1);
  assert.equal(result.rankingStages.comparisonRelevantFamilyCount, result.policyVariantResults[0].familyFingerprints.length);
  assert.ok(Number.isFinite(result.rankingStages.comparisonRelevantFamilyCount));
});

test("semantic near/far edges use NL→NR and FL→FR without threshold tuning", () => {
  const expected = [
    { control: roomA, near: 996.845, far: 371.176, ratio: 2.685640 },
    { control: roomB, near: 884.251, far: 428.863, ratio: 2.061849 },
    { control: roomC, near: 629.002, far: 378.036, ratio: 1.663870 },
  ] as const;
  for (const { control, near, far, ratio } of expected) {
    const result = runCandidateDiscriminationExperiment(input(control, [controlCandidate(control)]));
    const candidate = result.candidateResults[0];
    assert.ok(candidate.polygonMetrics.nearEdgeLengthPx !== null);
    assert.ok(candidate.polygonMetrics.farEdgeLengthPx !== null);
    assert.ok(candidate.polygonMetrics.nearToFarEdgeRatio !== null);
    assert.ok(Math.abs(candidate.polygonMetrics.nearEdgeLengthPx! - near) < 0.01);
    assert.ok(Math.abs(candidate.polygonMetrics.farEdgeLengthPx! - far) < 0.01);
    assert.ok(Math.abs(candidate.polygonMetrics.nearToFarEdgeRatio! - ratio) < 0.0001);
    assert.equal(candidate.hardGates.foreshorteningSufficient, true);
    assert.ok(candidate.polygonMetrics.nearToFarEdgeRatio! >= CANDIDATE_DISCRIMINATION_POLICY.minimumForeshorteningRatio);
  }
});

test("ratio and FOV boundary contacts remain axis-specific hard refusals", () => {
  const base = input(roomB, [controlCandidate(roomB)]);
  const ratioBounded: FloorCandidateComparisonInput = {
    ...base,
    sharedContext: {
    ...base.sharedContext,
    ratioDomain: { min: 1.19, max: 2, step: 0.05 },
    },
  };
  const fovBounded: FloorCandidateComparisonInput = {
    ...base,
    sharedContext: {
    ...base.sharedContext,
    fovDomain: { minDeg: 58.4, maxDeg: 90, stepDeg: 1 },
    },
  };
  const ratio = runCandidateDiscriminationExperiment(ratioBounded);
  const fov = runCandidateDiscriminationExperiment(fovBounded);
  assert.equal(ratio.candidateResults[0].boundary.optimumRatioBoundaryContact, true);
  assert.equal(ratio.candidateResults[0].boundary.optimumFovBoundaryContact, false);
  assert.equal(ratio.candidateResults[0].hardGates.bestRatioInterior, false);
  assert.equal(fov.candidateResults[0].boundary.optimumRatioBoundaryContact, false);
  assert.equal(fov.candidateResults[0].boundary.optimumFovBoundaryContact, true);
  assert.equal(fov.candidateResults[0].hardGates.bestFovInterior, false);
});

test("selection-state fixtures remain fail-closed under policy-variant disagreement", () => {
  const bowTie = fixtureCandidates(roomB, roomBFamily).find((candidate) => candidate.candidateId === "invalidInputProbeBowTie")!;
  const translated = fixtureCandidates(roomB, roomBFamily).find((candidate) => candidate.candidateId === "ambiguityProbeTranslation")!;
  const unique = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB)]));
  const equivalent = runCandidateDiscriminationExperiment(input(roomB, [
    controlCandidate(roomB, "approvedControlCandidate"),
    controlCandidate(roomB, "duplicateOfApproved"),
  ]));
  const noValid = runCandidateDiscriminationExperiment(input(roomB, [bowTie]));
  const multiple = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), translated]));
  const insufficient = runCandidateDiscriminationExperiment(input(roomA, [controlCandidate(roomA)]));
  const invalid = runCandidateDiscriminationExperiment({
    ...input(roomB, [controlCandidate(roomB)]),
    contractVersion: "invalid" as FloorCandidateComparisonInput["contractVersion"],
  });
  const expected = [
    [invalid, "comparison_context_invalid"],
    [noValid, "no_valid_candidate"],
    [equivalent, "equivalent_candidate_family"],
    [unique, "unique_candidate"],
    [multiple, "insufficient_discrimination"],
    [insufficient, "insufficient_discrimination"],
  ] as const;
  for (const [result, state] of expected) {
    assert.equal(result.selectionState, state);
    assert.deepEqual(result.safety, { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
  }
  assert.equal(unique.selectedFamilyFingerprint, unique.selectedCandidateFingerprint && unique.selectedFamilyFingerprint);
  assert.equal(equivalent.selectedFamilyFingerprint, null);
  assert.equal(noValid.selectedCandidateFingerprint, null);
  assert.ok(noValid.rejectedCandidates.length > 0);
  assert.ok(insufficient.refusalReasons.includes("representative_confirmation_failure"));
  assert.ok(multiple.refusalReasons.includes("policy_variant_disagreement"));
});

test("Room A confirmation refuses its degenerate control and Room B confirmation reaches Stage B", () => {
  const a = runCandidateDiscriminationExperiment(input(roomA, [controlCandidate(roomA)]));
  const b = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB)]));
  assert.equal(a.selectionState, "insufficient_discrimination");
  assert.equal(a.candidateResults[0].stageA.status, "success");
  assert.equal(a.candidateResults[0].stageA.status === "success" ? a.candidateResults[0].stageA.basin.classification : null, "degenerate_valley");
  assert.equal(a.candidateResults[0].stageB?.status, "success");
  assert.equal(a.candidateResults[0].rankingEligible, false);
  assert.equal(b.selectionState, "unique_candidate");
  assert.equal(b.rankingStages.stageBEvaluationCount, 1);
  assert.equal(b.candidateResults[0].hardGates.confirmationPerturbationEnabled, true);
  assert.equal(b.candidateResults[0].hardGates.confirmationClassificationStable, true);
});

test("Room A translated candidate is provisionally isolated then demoted by confirmation", () => {
  const translated = fixtureCandidates(roomA, roomAFamily).find((candidate) => candidate.candidateId === "ambiguityProbeTranslation")!;
  const result = runCandidateDiscriminationExperiment(input(roomA, [translated]));
  const candidate = result.candidateResults[0];
  assert.equal(candidate.stageA.status, "success");
  assert.equal(candidate.stageA.status === "success" ? candidate.stageA.basin.classification : null, "isolated_optimum");
  assert.equal(candidate.stageB?.status, "success");
  assert.equal(candidate.stageB?.status === "success" ? candidate.stageB.basin.classification : null, "unstable_branch");
  assert.equal(candidate.rankingEligible, false);
  assert.ok(candidate.refusalReasons.includes("perturbation_instability"));
  assert.equal(result.selectionState, "insufficient_discrimination");
});

test("semantic alternatives are never exact duplicate reuse and reversed winding loses camera height", () => {
  const candidates = fixtureCandidates(roomB, roomBFamily);
  const reversed = candidates.find((candidate) => candidate.candidateId === "semanticAlternativeCandidateReversed")!;
  const cyclic = candidates.find((candidate) => candidate.candidateId === "semanticAlternativeCandidateCyclic")!;
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), cyclic, reversed]));
  const reversedResult = result.candidateResults.find((candidate) => candidate.candidateId === reversed.candidateId)!;
  const cyclicResult = result.candidateResults.find((candidate) => candidate.candidateId === cyclic.candidateId)!;
  assert.equal(result.rankingStages.exactDistinctCandidateCount, 3);
  assert.equal(reversedResult.stageA.status, "success");
  assert.equal(reversedResult.hardGates.cameraHeightPositive, false);
  assert.ok(reversedResult.refusalReasons.includes("camera_below_floor"));
  assert.notEqual(cyclicResult.familyFingerprint, result.candidateResults.find((candidate) => candidate.candidateId === "approvedControlCandidate")!.familyFingerprint);
});

test("complete linkage prevents a label-wise epsilon chain from swallowing a distinct candidate", () => {
  const make = (candidateId: string, deltaIntrinsicPx: number): FloorCandidateInput => ({
    ...controlCandidate(roomB, candidateId),
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 2 ? { x: point.x + deltaIntrinsicPx / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  });
  const first = make("chain-a", 0);
  const middle = make("chain-b", 1.4);
  const last = make("chain-c", 2.8);
  const result = runCandidateDiscriminationExperiment(input(roomB, [last, middle, first]));
  assert.equal(result.candidateFamilies.length, 2);
  assert.deepEqual(result.candidateFamilies.map((family) => family.memberFingerprints.length).sort(), [1, 2]);
  assert.ok(result.candidateFamilies.some((family) => family.epsilonBoundaryInstability));
});

test("near-duplicate epsilon is inclusive at 1.50 intrinsic pixels", () => {
  const displaced = (delta: number): FloorCandidateInput => ({
    ...controlCandidate(roomB, `fr-${delta}`),
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 2 ? { x: point.x + delta / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  });
  const run = (delta: number, reversed = false) => {
    const candidates = [controlCandidate(roomB, "base"), displaced(delta)];
    return runCandidateDiscriminationExperiment(input(roomB, reversed ? [...candidates].reverse() : candidates));
  };
  const at149 = run(1.49);
  const at150 = run(1.5, true);
  const at151 = run(1.51);
  assert.equal(at149.candidateFamilies.length, 1);
  assert.equal(at150.candidateFamilies.length, 1);
  assert.equal(at151.candidateFamilies.length, 2);
  assert.equal(at150.policyVariantResults.find((variant) => variant.name === "conservative")?.familyFingerprints.length, 2);
  assert.equal(at150.policyVariantResults.find((variant) => variant.name === "permissive")?.familyFingerprints.length, 1);
  assert.ok(at150.refusalReasons.includes("policy_variant_disagreement"));
});

test("a real near-duplicate family reports only its Stage-A FOV boundary disagreement", () => {
  const displaced: FloorCandidateInput = {
    ...controlCandidate(roomB, "fr-plus-1.4"),
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 2 ? { x: point.x + 1.4 / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  };
  const base = input(roomB, [controlCandidate(roomB), displaced]);
  const result = runCandidateDiscriminationExperiment({
    ...base,
    sharedContext: { ...base.sharedContext, fovDomain: { minDeg: 58.3, maxDeg: 90, stepDeg: 1 } },
  });
  assert.equal(result.candidateFamilies.length, 1);
  const family = result.candidateFamilies[0];
  assert.equal(family.familyStageAGateDisagreement, true);
  const members = result.candidateResults.filter((candidate) => candidate.familyFingerprint === family.familyFingerprint);
  const [left, right] = members;
  const differing = Object.keys(left.familyComparableStageAGates).filter((key) =>
    left.familyComparableStageAGates[key as keyof typeof left.familyComparableStageAGates] !==
    right.familyComparableStageAGates[key as keyof typeof right.familyComparableStageAGates]
  );
  assert.deepEqual(differing, ["bestFovInterior"]);
  assert.equal(typeof family.representativeConfirmationFailure, "boolean");
  assert.equal(result.selectionState, "insufficient_discrimination");
  assert.ok(result.refusalReasons.includes("family_stage_a_gate_disagreement"));
});

test("Room B residual decoys cannot become selected solely by raw cvAvgPx", () => {
  const candidates = fixtureCandidates(roomB, roomBFamily);
  const chosen = [
    controlCandidate(roomB),
    candidates.find((candidate) => candidate.candidateId === "structuredDecoyFrMinus20")!,
    candidates.find((candidate) => candidate.candidateId === "structuredDecoyNlMinus20")!,
    candidates.find((candidate) => candidate.candidateId === "trivialFitProbeHalfScale")!,
  ];
  const result = runCandidateDiscriminationExperiment(input(roomB, chosen));
  const approved = result.candidateResults.find((candidate) => candidate.candidateId === "approvedControlCandidate")!;
  const decoys = result.candidateResults.filter((candidate) => candidate.candidateId !== "approvedControlCandidate");
  const approvedEvidence = effective(approved);
  const rawApproved = approvedEvidence.status === "success" ? approvedEvidence.ranking.globallyRankedBest?.cvAvgPx ?? Infinity : Infinity;
  assert.ok(decoys.some((candidate) => {
    const evidence = effective(candidate);
    return evidence.status === "success" && (evidence.ranking.globallyRankedBest?.cvAvgPx ?? Infinity) < rawApproved;
  }));
  assert.ok(result.diagnosticsExcluded.some((reason) => reason.startsWith("raw cvAvgPx")));
  assert.notEqual(result.selectionState, "unique_candidate");
});

test("Room B approved plus FR +3 reaches multiple plausible candidates", () => {
  const plusThree: FloorCandidateInput = {
    ...controlCandidate(roomB, "fr-plus-3"),
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 2 ? { x: point.x + 3 / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  };
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), plusThree]));
  assert.equal(result.selectionState, "multiple_plausible_candidates");
  assert.equal(result.selectedCandidateFingerprint, null);
  assert.equal(result.selectedFamilyFingerprint, null);
  assert.equal(result.comparisonRelevantCandidates.length, 2);
  assert.equal(result.rankingEligibleCandidates.length, 2);
  assert.equal(result.pairwiseComparisons.length, 1);
  assert.equal(result.pairwiseComparisons[0].outcome, "equivalent");
  assert.equal(result.pairwiseComparisons[0].projectivelyEquivalentHighOverlap, true);
  assert.deepEqual(result.policyVariantResults.map((variant) => variant.selectionState), ["multiple_plausible_candidates", "multiple_plausible_candidates", "multiple_plausible_candidates"]);
  assert.deepEqual(result.safety, { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
});

test("a comparison-relevant non-eligible Room B quarter-scale family blocks uniqueness", () => {
  const quarter = fixtureCandidates(roomB, roomBFamily).find((candidate) => candidate.candidateId === "trivialFitProbeQuarterScale")!;
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), quarter]));
  const approved = result.candidateResults.find((candidate) => candidate.candidateId === "approvedControlCandidate")!;
  const quarterResult = result.candidateResults.find((candidate) => candidate.candidateId === quarter.candidateId)!;
  assert.equal(approved.rankingEligible, true);
  assert.equal(quarterResult.comparisonRelevant, true);
  assert.equal(quarterResult.rankingEligible, false);
  assert.equal(quarterResult.boundary.comparisonReliability, "unusable");
  assert.ok(quarterResult.refusalReasons.includes("search_boundary_censored"));
  assert.equal(result.selectionState, "insufficient_discrimination");
  assert.equal(result.selectedCandidateFingerprint, null);
  assert.equal(result.selectedFamilyFingerprint, null);
  assert.ok(result.refusalReasons.includes("representative_confirmation_failure"));
  assert.ok(result.policyVariantResults.every((variant) => variant.selectionState === "insufficient_discrimination"));
});

test("floor-plane translated Room B candidate exposes equivalent-camera different-Floor ambiguity", () => {
  // Authored once through the approved Room B confirmed camera: canonical
  // rectangle translated by depth −0.6 at reference depth 1, then projected
  // and converted back to source-normalized coordinates.
  const translated: FloorCandidateInput = {
    candidateId: "room-b-floor-plane-depth-minus-0.6",
    candidateSource: "research-probe",
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon: [
      { x: 0.39034489979356746, y: 0.6249487048639982 },
      { x: 0.8695994096549523, y: 0.6867426744779663 },
      { x: 0.8047120733714572, y: 0.5891972771796575 },
      { x: 0.5107349755770088, y: 0.56657584326232 },
    ],
  };
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), translated]));
  const pair = result.pairwiseComparisons[0];
  assert.ok((pair.polygonIoU ?? 1) < 0.5);
  assert.equal(pair.cameraInvariantComparison.equivalentWithinPolicy, true);
  assert.ok((pair.cameraInvariantComparison.fovDifferenceDeg ?? Infinity) <= 0.5);
  assert.ok((pair.cameraInvariantComparison.logRatioDifference ?? Infinity) <= 0.01);
  assert.ok((pair.cameraInvariantComparison.lookElevationDifferenceDeg ?? Infinity) <= 0.5);
  assert.ok((pair.cameraInvariantComparison.upTiltDifferenceDeg ?? Infinity) <= 0.5);
  assert.equal(pair.equivalentCameraDifferentFloor, true);
  assert.equal(result.candidateFamilies.length, 2);
  assert.equal(result.selectionState, "insufficient_discrimination");
  assert.ok(result.refusalReasons.includes("equivalent_camera_different_floor"));
  assert.ok(result.policyVariantResults.every((variant) => variant.selectionState !== "unique_candidate"));
  assert.equal("sameNearDuplicateFamily" in pair, false);
  assert.equal("nearDuplicate" in pair, false);
  assert.equal("stageA" in result.candidateFamilies[0], false);
  assert.equal("stageA" in result.pairwiseComparisons[0], false);
  assert.equal("stageA" in result.policyVariantResults[0], false);
});

test("camera-equivalence overlap bands are fail-closed", () => {
  const high: FloorCandidateInput = {
    ...controlCandidate(roomB, "fr-plus-3-high-overlap"),
    sourceFloorPolygon: roomB.sourceFloorPolygon.map((point, index) =>
      index === 2 ? { x: point.x + 3 / roomB.imageBasis.decodedWidth, y: point.y } : { ...point }
    ) as unknown as FloorCandidateInput["sourceFloorPolygon"],
  };
  // Canonical rectangle translated laterally +0.1 at reference depth 1 and
  // reprojected through Room B's confirmed camera during fixture authoring.
  const mid: FloorCandidateInput = {
    candidateId: "room-b-floor-plane-lateral-plus-0.1",
    candidateSource: "research-probe",
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon: [
      { x: 0.257981336982319, y: 0.7175815150411237 },
      { x: 1.118311693535476, y: 0.9092688909643132 },
      { x: 0.8765294603844156, y: 0.6380572462262717 },
      { x: 0.477494026790029, y: 0.5976762875922993 },
    ],
  };
  const low: FloorCandidateInput = {
    candidateId: "room-b-floor-plane-depth-minus-0.6-repeat",
    candidateSource: "research-probe",
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon: [
      { x: 0.39034489979356746, y: 0.6249487048639982 },
      { x: 0.8695994096549523, y: 0.6867426744779663 },
      { x: 0.8047120733714572, y: 0.5891972771796575 },
      { x: 0.5107349755770088, y: 0.56657584326232 },
    ],
  };
  const inspect = (other: FloorCandidateInput) =>
    runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), other]));
  const highResult = inspect(high);
  const midResult = inspect(mid);
  const lowResult = inspect(low);
  const highPair = highResult.pairwiseComparisons[0];
  const midPair = midResult.pairwiseComparisons[0];
  const lowPair = lowResult.pairwiseComparisons[0];
  assert.ok((highPair.polygonIoU ?? 0) >= 0.9);
  assert.equal(highPair.projectivelyEquivalentHighOverlap, true);
  assert.equal(highPair.outcome, "equivalent");
  assert.ok((midPair.polygonIoU ?? 0) >= 0.5 && (midPair.polygonIoU ?? 1) < 0.9);
  assert.equal(midPair.cameraEquivalentAmbiguousOverlap, true);
  assert.notEqual(midPair.outcome, "a_wins");
  assert.notEqual(midPair.outcome, "b_wins");
  assert.equal(midResult.selectionState, "insufficient_discrimination");
  assert.ok(midResult.refusalReasons.includes("camera_equivalent_ambiguous_overlap"));
  assert.ok((lowPair.polygonIoU ?? 1) < 0.5);
  assert.equal(lowPair.equivalentCameraDifferentFloor, true);
  assert.notEqual(lowPair.outcome, "a_wins");
  assert.notEqual(lowPair.outcome, "b_wins");
  assert.equal(lowResult.selectionState, "insufficient_discrimination");
  const nonEquivalent = runCandidateDiscriminationExperiment(input(roomB, [
    controlCandidate(roomB),
    fixtureCandidates(roomB, roomBFamily).find((candidate) => candidate.candidateId === "trivialFitProbeHalfScale")!,
  ])).pairwiseComparisons[0];
  assert.ok((nonEquivalent.polygonIoU ?? 1) < 0.5);
  assert.equal(nonEquivalent.cameraInvariantComparison.equivalentWithinPolicy, false);
  assert.equal(nonEquivalent.distinctCompetingCandidate, true);
});

test("low overlap alone is not an equivalent-camera different-Floor claim", () => {
  const half = fixtureCandidates(roomB, roomBFamily).find((candidate) => candidate.candidateId === "trivialFitProbeHalfScale")!;
  const result = runCandidateDiscriminationExperiment(input(roomB, [controlCandidate(roomB), half]));
  const pair = result.pairwiseComparisons[0];
  assert.ok((pair.polygonIoU ?? 1) < 0.5);
  assert.equal(pair.equivalentCameraDifferentFloor, false);
});

test("Room C keeps hidden negative-x evidence unclamped and screen recanonicalization fails", () => {
  const candidates = fixtureCandidates(roomC, roomCFamily);
  const hidden = candidates.find((candidate) => candidate.candidateId === "annotationRequiredDecoyHiddenNl")!;
  const invalid = candidates.find((candidate) => candidate.candidateId === "invalidInputProbeScreenRecanonicalized")!;
  const result = runCandidateDiscriminationExperiment(input(roomC, [hidden, invalid]));
  assert.equal(hidden.sourceFloorPolygon[0].x, -0.02);
  assert.equal(result.candidateResults.find((candidate) => candidate.candidateId === invalid.candidateId)?.stageA.status, "failure");
  assert.equal(result.candidateResults.find((candidate) => candidate.candidateId === hidden.candidateId)?.candidateId, hidden.candidateId);
});

test("complete Room A, B, and C candidate families retain deterministic accounting", () => {
  const expected = [
    { control: roomA, fixture: roomAFamily, inputs: 11, distinct: 10, families: 8, relevantFamilies: 6, relevantCandidates: 9, eligible: 0, stageB: 6, pairs: 28, refusal: "representative_confirmation_failure" },
    { control: roomB, fixture: roomBFamily, inputs: 14, distinct: 13, families: 11, relevantFamilies: 8, relevantCandidates: 11, eligible: 8, stageB: 8, pairs: 55, refusal: "representative_confirmation_failure" },
    { control: roomC, fixture: roomCFamily, inputs: 11, distinct: 10, families: 9, relevantFamilies: 6, relevantCandidates: 8, eligible: 6, stageB: 6, pairs: 36, refusal: "representative_confirmation_failure" },
  ] as const;
  for (const entry of expected) {
    const result = fullFixtureResult(entry.control, entry.fixture);
    assert.equal(result.candidateResults.length, entry.inputs);
    assert.equal(result.rankingStages.exactDistinctCandidateCount, entry.distinct);
    assert.equal(result.rankingStages.stageAEvaluationCount, entry.distinct);
    assert.equal(result.rankingStages.exactDuplicateEvaluationReuse, 1);
    assert.equal(result.candidateFamilies.length, entry.families);
    assert.equal(result.rankingStages.comparisonRelevantFamilyCount, entry.relevantFamilies);
    assert.equal(result.comparisonRelevantCandidates.length, entry.relevantCandidates);
    assert.equal(result.rankingStages.stageBEvaluationCount, entry.stageB);
    assert.equal(result.rankingStages.pairwiseComparisonCount, entry.pairs);
    assert.equal(result.rankingEligibleCandidates.length, entry.eligible);
    assert.equal(result.selectionState, "insufficient_discrimination");
    assert.ok(result.refusalReasons.includes(entry.refusal));
    assert.deepEqual(result.safety, { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
    assert.ok(result.policyVariantResults.every((variant) => variant.afcR1H2Reevaluated === false && variant.selectionState === "insufficient_discrimination"));
    assert.ok(result.candidateResults.some((candidate) => candidate.stageB === null && candidate.effectiveStage === "stageA"));
  }
});
