import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import r3bFixture from "./fixtures/gemini-floor-proposal-contract.v1.json";
import {
  CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
  CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  candidateCanonicalPolygon,
  runCandidateDiscriminationExperiment,
  type SharedCandidateComparisonContext,
} from "./candidate-discrimination-harness";
import {
  AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE,
  AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION,
  AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION,
  classifyAfcR3cImagePairCompatibility,
  composeAfcR3cProposalRuns,
  createAfcR3cProposalRun,
  transferAfcR3cCandidateToOriginalBasis,
  type AfcR3cCandidateProvenance,
  type AfcR3cDecodedImage,
  type AfcR3cProposalRun,
} from "./gemini-floor-proposal-composition";
import {
  deriveGeminiFloorBasisBinding,
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
  GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
  parseGeminiFloorProposalResponse,
  type GeminiFloorProposalParseResult,
} from "./gemini-floor-proposal-contract";
import { buildAfcR3cGeminiFloorProposalPrompt } from "./gemini-floor-proposal-prompt";

const original: AfcR3cDecodedImage = { fingerprint: "original-sha", decodedWidth: 960, decodedHeight: 640, orientation: 1 };
const empty: AfcR3cDecodedImage = { fingerprint: "empty-sha", decodedWidth: 1264, decodedHeight: 848, orientation: 1 };

function allFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every((child) => allFrozen(child, seen));
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function resultStatus(value: unknown): string | undefined {
  return value && typeof value === "object" && "status" in value
    ? (value as { status?: string }).status
    : undefined;
}
function sharedContext(): SharedCandidateComparisonContext {
  return {
    ratioFovContractVersion: "ratio-fov-harness/v1",
    basisId: "original-source",
    basisFingerprint: original.fingerprint,
    decoderId: "fixture-decoder",
    normalizationPolicyVersion: "source-normalized/v1",
    decodedWidth: original.decodedWidth,
    decodedHeight: original.decodedHeight,
    frameSize: { width: 960, height: 640 },
    orientationApplied: false,
    basisKind: "original",
    ratioDomain: { min: 1.2, max: 1.2, step: 0.05 },
    fovDomain: { minDeg: 58, maxDeg: 58, stepDeg: 1 },
    refinement: { enabled: false, ratioStep: 0.005, fovStepDeg: 0.1, basinFactor: 1.25, additivePxAllowance: 0.25 },
    referenceDepth: 1,
  };
}
function binding(): string {
  return deriveGeminiFloorBasisBinding(sharedContext(), GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
}
function parseResponse(response: unknown): GeminiFloorProposalParseResult {
  const raw = JSON.stringify(response);
  return parseGeminiFloorProposalResponse(raw, {
    sharedComparisonContext: sharedContext(),
    coordinateExtentPolicy: GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    auditProvenance: {
      requestId: "synthetic-r3b-request",
      contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
      promptVersion: "synthetic-r3b-prompt/v1",
      providerId: "gemini-fixture",
      modelId: "gemini-fixture-model",
      responseReceivedAt: "2026-07-26T18:00:00.000Z",
      rawResponseSha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    },
  });
}
function validParsed(kind: "valid" | "offFrame" | "insufficient" = "valid"): GeminiFloorProposalParseResult {
  const value = clone(
    kind === "valid" ? r3bFixture.validProposalResponse :
      kind === "offFrame" ? r3bFixture.offFrameProposalResponse :
        r3bFixture.insufficientEvidenceResponse
  ) as Record<string, unknown>;
  value.basis_binding = binding();
  return parseResponse(value);
}
function failureParsed(): GeminiFloorProposalParseResult {
  const raw = "{";
  return parseGeminiFloorProposalResponse(raw, {
    sharedComparisonContext: sharedContext(),
    coordinateExtentPolicy: GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    auditProvenance: {
      requestId: "synthetic-r3b-request",
      contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
      promptVersion: "synthetic-r3b-prompt/v1",
      providerId: "gemini-fixture",
      modelId: "gemini-fixture-model",
      responseReceivedAt: "2026-07-26T18:00:00.000Z",
      rawResponseSha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    },
  });
}
function run(
  imageRole: "empty_room_boundary_specialist" | "original_contextual",
  r3bResult: GeminiFloorProposalParseResult,
  inputImage = imageRole === "empty_room_boundary_specialist" ? empty : original,
  studyMode: "empty_only" | "original_only" | "parallel_union" = "parallel_union"
): AfcR3cProposalRun {
  const result = createAfcR3cProposalRun({
    studyMode,
    imageRole,
    requestId: `${imageRole}-request`,
    originalImage: original,
    inputImage,
    emptyRoomImageFingerprint: imageRole === "empty_room_boundary_specialist" ? empty.fingerprint : undefined,
    prompt: buildAfcR3cGeminiFloorProposalPrompt({ imageRole, basisBinding: binding() }),
    providerId: "fixture-provider",
    modelId: "fixture-model",
    r3bResult,
  });
  if (resultStatus(result) === "incompatible_input") throw new Error((result as { reason: string }).reason);
  return result as AfcR3cProposalRun;
}

test("compatibility formula mirrors the audited route boundary behavior and freezes output", () => {
  const exact = classifyAfcR3cImagePairCompatibility(original, { ...original });
  assert.equal(exact.version, AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION);
  assert.equal(exact.tier, "exact_grid_compatible");
  const audited = classifyAfcR3cImagePairCompatibility(original, empty);
  assert.equal(audited.tier, "aspect_compatible_rescaled");
  assert.equal(audited.relativeAspectError, 0.0063);
  assert.ok(audited.relativeAspectError! > 0 && audited.relativeAspectError! < AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE);
  const exactlyBoundary = classifyAfcR3cImagePairCompatibility(
    { fingerprint: "o", decodedWidth: 200, decodedHeight: 1, orientation: 1 },
    { fingerprint: "e", decodedWidth: 197, decodedHeight: 1, orientation: 1 }
  );
  assert.equal(exactlyBoundary.relativeAspectError, 0.015);
  assert.equal(exactlyBoundary.tier, "aspect_compatible_rescaled");
  assert.equal(classifyAfcR3cImagePairCompatibility(
    { fingerprint: "o", decodedWidth: 200, decodedHeight: 1, orientation: 1 },
    { fingerprint: "e", decodedWidth: 196, decodedHeight: 1, orientation: 1 }
  ).tier, "incompatible");
  assert.equal(classifyAfcR3cImagePairCompatibility(original, { ...empty, orientation: 6 }).tier, "incompatible");
  assert.equal(classifyAfcR3cImagePairCompatibility(original, { ...empty, decodedWidth: 0 }).tier, "incompatible");
  assert.equal(allFrozen(audited), true);
});

test("role input attestation refuses mismatched original, missing empty fingerprint, and incompatible empty metadata", () => {
  const parsed = validParsed();
  const originalMismatch = createAfcR3cProposalRun({
    studyMode: "original_only", imageRole: "original_contextual", requestId: "r", originalImage: original,
    inputImage: { ...original, fingerprint: "not-original" },
    prompt: buildAfcR3cGeminiFloorProposalPrompt({ imageRole: "original_contextual", basisBinding: binding() }),
    providerId: "p", modelId: "m", r3bResult: parsed,
  });
  assert.equal(resultStatus(originalMismatch), "incompatible_input");
  const emptyMissing = createAfcR3cProposalRun({
    studyMode: "empty_only", imageRole: "empty_room_boundary_specialist", requestId: "r", originalImage: original,
    inputImage: empty,
    prompt: buildAfcR3cGeminiFloorProposalPrompt({ imageRole: "empty_room_boundary_specialist", basisBinding: binding() }),
    providerId: "p", modelId: "m", r3bResult: parsed,
  });
  assert.equal(resultStatus(emptyMissing), "incompatible_input");
  const incompatible = createAfcR3cProposalRun({
    studyMode: "empty_only", imageRole: "empty_room_boundary_specialist", requestId: "r", originalImage: original,
    inputImage: { ...empty, decodedWidth: 1000, decodedHeight: 400 }, emptyRoomImageFingerprint: empty.fingerprint,
    prompt: buildAfcR3cGeminiFloorProposalPrompt({ imageRole: "empty_room_boundary_specialist", basisBinding: binding() }),
    providerId: "p", modelId: "m", r3bResult: parsed,
  });
  assert.equal(resultStatus(incompatible), "incompatible_input");
});

test("transfer is exact source-normalized reinterpretation, including accepted out-of-unit coordinates", () => {
  const exactRun = run("original_contextual", validParsed(), original, "original_only");
  const aspectRun = run("empty_room_boundary_specialist", validParsed("offFrame"), empty, "empty_only");
  assert.equal(exactRun.transfer.transferPolicyVersion, AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION);
  assert.equal(exactRun.transfer.numericalCoordinatesReinterpreted, false);
  assert.equal(aspectRun.transfer.numericalCoordinatesReinterpreted, true);
  assert.equal(aspectRun.transfer.compatibilityTier, "aspect_compatible_rescaled");
  assert.deepEqual(
    { clamped: aspectRun.transfer.clamped, reordered: aspectRun.transfer.reordered, repaired: aspectRun.transfer.repaired, containerSpaceUsed: aspectRun.transfer.containerSpaceUsed },
    { clamped: false, reordered: false, repaired: false, containerSpaceUsed: false }
  );
  assert.equal(aspectRun.r3bResult.status, "proposals");
  if (aspectRun.r3bResult.status !== "proposals") return;
  const source = aspectRun.r3bResult.candidates[0];
  const transferred = transferAfcR3cCandidateToOriginalBasis(source, aspectRun.transfer);
  assert.equal(Object.is(transferred.sourceFloorPolygon[0].x, source.sourceFloorPolygon[0].x), true);
  assert.equal(transferred.sourceFloorPolygon[0].x, -0.1);
  assert.deepEqual(transferred.semanticOrder, source.semanticOrder);
  assert.equal(transferred.candidateSource, "gemini-proposal");
  assert.equal(allFrozen(transferred), true);
});

test("single-source modes preserve proposals, insufficient evidence, and contract failures", () => {
  const emptyProposals = composeAfcR3cProposalRuns({ studyMode: "empty_only", emptyRun: run("empty_room_boundary_specialist", validParsed(), empty, "empty_only") });
  assert.equal(emptyProposals.status, "proposals");
  const originalProposals = composeAfcR3cProposalRuns({ studyMode: "original_only", originalRun: run("original_contextual", validParsed(), original, "original_only") });
  assert.equal(originalProposals.status, "proposals");
  const insufficient = composeAfcR3cProposalRuns({ studyMode: "original_only", originalRun: run("original_contextual", validParsed("insufficient"), original, "original_only") });
  assert.equal(insufficient.status, "insufficient_evidence");
  const failed = composeAfcR3cProposalRuns({ studyMode: "empty_only", emptyRun: run("empty_room_boundary_specialist", failureParsed(), empty, "empty_only") });
  assert.equal(failed.status, "contract_failure");
});

test("parallel union namespaces candidates, preserves geometry/order, and records an explicit insufficient arm", () => {
  const emptyRun = run("empty_room_boundary_specialist", validParsed());
  const originalRun = run("original_contextual", validParsed());
  const union = composeAfcR3cProposalRuns({ studyMode: "parallel_union", emptyRun, originalRun });
  assert.equal(union.status, "proposals");
  if (union.status !== "proposals") return;
  assert.equal(union.candidates.length, 2);
  assert.equal(new Set(union.candidates.map((candidate) => candidate.candidateId)).size, 2);
  assert.deepEqual(union.candidates.map((candidate) => candidate.candidateSource), ["gemini-proposal", "gemini-proposal"]);
  for (const candidate of union.candidates) {
    const sidecar: AfcR3cCandidateProvenance = union.candidateProvenanceById[candidate.candidateId]!;
    assert.ok(sidecar);
    assert.equal(candidate.candidateId.includes(sidecar.imageRole === "empty_room_boundary_specialist" ? ":empty:" : ":original:"), true);
    assert.equal(Object.hasOwn(candidate, "notes"), false);
    assert.equal(Object.hasOwn(candidate, "role"), false);
  }
  const withInsufficient = composeAfcR3cProposalRuns({
    studyMode: "parallel_union",
    emptyRun,
    originalRun: run("original_contextual", validParsed("insufficient")),
  });
  assert.equal(withInsufficient.status, "proposals");
  assert.equal(withInsufficient.armStatuses.some((arm) => arm.status === "insufficient_evidence"), true);
  const bothInsufficient = composeAfcR3cProposalRuns({
    studyMode: "parallel_union",
    emptyRun: run("empty_room_boundary_specialist", validParsed("insufficient")),
    originalRun: run("original_contextual", validParsed("insufficient")),
  });
  assert.equal(bothInsufficient.status, "insufficient_evidence");
  const failed = composeAfcR3cProposalRuns({
    studyMode: "parallel_union", emptyRun: run("empty_room_boundary_specialist", failureParsed()), originalRun,
  });
  assert.equal(failed.status, "contract_failure");
  assert.deepEqual(failed.candidates, []);
});

test("canonical geometry-first ordering is invocation-order independent and provenance does not affect AFC-R2 geometry", () => {
  const emptyRun = run("empty_room_boundary_specialist", validParsed());
  const originalRun = run("original_contextual", validParsed());
  const first = composeAfcR3cProposalRuns({ studyMode: "parallel_union", emptyRun, originalRun });
  const reversed = composeAfcR3cProposalRuns({ studyMode: "parallel_union", originalRun, emptyRun });
  assert.equal(first.status, "proposals");
  assert.equal(reversed.status, "proposals");
  if (first.status !== "proposals" || reversed.status !== "proposals") return;
  assert.deepEqual(first.candidates.map((candidate) => candidate.candidateId), reversed.candidates.map((candidate) => candidate.candidateId));
  assert.deepEqual(first.candidates.map(candidateCanonicalPolygon), reversed.candidates.map(candidateCanonicalPolygon));
  const a = runCandidateDiscriminationExperiment({
    contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
    sharedContext: sharedContext(),
    candidates: first.candidates,
    selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  });
  const b = runCandidateDiscriminationExperiment({
    contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
    sharedContext: sharedContext(),
    candidates: reversed.candidates,
    selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  });
  assert.equal(a.rankingStages.exactDistinctCandidateCount, 1);
  assert.equal(a.rankingStages.exactDuplicateEvaluationReuse, 1);
  assert.equal(a.candidateFamilies[0].totalReportingCandidateCount, 2);
  assert.equal(a.comparisonFingerprint, b.comparisonFingerprint);
  assert.equal(a.selectionState, b.selectionState);
});

test("composition branches, candidates, provenance, arm status, and safety are recursively frozen and do not mutate inputs", () => {
  const parsed = validParsed();
  const parsedBefore = clone(parsed);
  const emptyRun = run("empty_room_boundary_specialist", parsed);
  const originalRun = run("original_contextual", parsed);
  const result = composeAfcR3cProposalRuns({ studyMode: "parallel_union", emptyRun, originalRun });
  assert.equal(allFrozen(result), true);
  assert.deepEqual(parsed, parsedBefore);
  const serial = JSON.stringify(result).toLowerCase();
  for (const prohibited of ["winner", "confidence", "\"ratio\"", "\"fov\"", "\"pose\"", "\"apply\""]) {
    assert.equal(serial.includes(prohibited), false);
  }
});

test("research-only imports exclude provider, route, UI, Apply, persistence, and scene modules", () => {
  for (const path of [
    new URL("./gemini-floor-proposal-prompt.ts", import.meta.url),
    new URL("./gemini-floor-proposal-composition.ts", import.meta.url),
  ]) {
    const source = readFileSync(path, "utf8");
    const imports = source.match(/^import[\s\S]*?;\n/gm)?.join("\n") ?? "";
    for (const forbidden of ["ThreeRoomLab", "/api/", "auto-floor-vision-provider", "auto-floor-detection", "decideEmptyPrimaryPolicy", "canonicalizeUnlabelledFloorQuad", "persistence", "scene state"]) {
      assert.equal(imports.includes(forbidden), false);
    }
  }
});
