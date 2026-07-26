import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import roomB from "./fixtures/room-b-floor-control.json";
import fixture from "./fixtures/gemini-floor-proposal-contract.v1.json";
import {
  CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
  CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  candidateCanonicalPolygon,
  runCandidateDiscriminationExperiment,
  type SharedCandidateComparisonContext,
} from "./candidate-discrimination-harness";
import {
  GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
  GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
  deriveGeminiFloorBasisBinding,
  parseGeminiFloorProposalResponse,
  type GeminiFloorProposalParseResult,
  type GeminiFloorProposalTrustedContextV1,
} from "./gemini-floor-proposal-contract";

type CornerObject = { x: unknown; y: unknown; support: unknown; [key: string]: unknown };
type EdgeObject = { support: unknown; note: unknown; [key: string]: unknown };
type ProposalObject = {
  corners: Record<string, CornerObject>;
  edge_evidence: Record<string, EdgeObject>;
  [key: string]: unknown;
};
type ResponseObject = {
  schema_version: unknown;
  basis_binding: unknown;
  status: unknown;
  proposals: ProposalObject[];
  reason_code?: unknown;
  note?: unknown;
  [key: string]: unknown;
};
type MutableTrustedContext = {
  sharedComparisonContext: SharedCandidateComparisonContext;
  coordinateExtentPolicy: { version: string; minX: number; maxX: number; minY: number; maxY: number };
  auditProvenance: {
    requestId: string;
    contractVersion: string;
    promptVersion: string;
    providerId: string;
    modelId: string;
    responseReceivedAt: string;
    rawResponseSha256: string;
  };
};

function sharedContext(): SharedCandidateComparisonContext {
  return {
    ratioFovContractVersion: "ratio-fov-harness/v1",
    basisId: roomB.imageBasis.basisId,
    basisFingerprint: roomB.imageBasis.basisFingerprint,
    decoderId: roomB.imageBasis.coordinateSpaceVersion.decoderId,
    normalizationPolicyVersion: "source-normalized/v1",
    decodedWidth: roomB.imageBasis.decodedWidth,
    decodedHeight: roomB.imageBasis.decodedHeight,
    frameSize: { ...roomB.frameSize },
    orientationApplied: false,
    basisKind: "original",
    // Intentionally narrow: handoff tests exercise AFC-R2, not a broad search.
    ratioDomain: { min: 1.2, max: 1.2, step: 0.05 },
    fovDomain: { minDeg: 58, maxDeg: 58, stepDeg: 1 },
    refinement: { enabled: false, ratioStep: 0.005, fovStepDeg: 0.1, basinFactor: 1.25, additivePxAllowance: 0.25 },
    referenceDepth: 1,
  };
}

function binding(shared = sharedContext(), policy = GEMINI_FLOOR_COORDINATE_EXTENT_POLICY): string {
  return deriveGeminiFloorBasisBinding(shared, policy);
}

function context(rawResponse = ""): GeminiFloorProposalTrustedContextV1 {
  const sharedComparisonContext = sharedContext();
  return {
    sharedComparisonContext,
    coordinateExtentPolicy: GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    auditProvenance: {
      ...fixture.trustedContext.auditProvenance,
      rawResponseSha256: createHash("sha256").update(rawResponse, "utf8").digest("hex"),
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function raw(value: unknown): string {
  return JSON.stringify(value);
}

function valid(): ResponseObject {
  const response = clone(fixture.validProposalResponse) as ResponseObject;
  response.basis_binding = binding();
  return response;
}

function proposal(): ProposalObject {
  return valid().proposals[0];
}

function boundResponse<T extends { basis_binding: unknown }>(value: T): T {
  const response = clone(value);
  response.basis_binding = binding();
  return response;
}

function parse(value: unknown, trusted = context()): GeminiFloorProposalParseResult {
  const response = raw(value);
  const hasCallerSuppliedTrustedContext = arguments.length > 1;
  return parseGeminiFloorProposalResponse(response, hasCallerSuppliedTrustedContext ? trusted : context(response));
}

function expectFailure(value: unknown, reason: string, path?: string) {
  const result = parse(value);
  assert.equal(result.status, "contract_failure");
  if (result.status === "contract_failure") {
    assert.equal(result.reason, reason);
    if (path) assert.equal(result.path, path);
    assert.equal(Object.isFrozen(result), true);
  }
}

function allFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every((child) => allFrozen(child, seen));
}

test("valid proposals preserve semantic [NL, NR, FR, FL] geometry and are recursively frozen", () => {
  const source = valid();
  const before = clone(source);
  const trusted = context(raw(source));
  const trustedBefore = clone(trusted);
  const result = parse(source, trusted);
  assert.equal(result.status, "proposals");
  if (result.status !== "proposals") return;
  assert.deepEqual(result.candidates[0].semanticOrder, ["NL", "NR", "FR", "FL"]);
  assert.deepEqual(result.candidates[0].sourceFloorPolygon, [
    { x: source.proposals[0].corners.NL.x, y: source.proposals[0].corners.NL.y },
    { x: source.proposals[0].corners.NR.x, y: source.proposals[0].corners.NR.y },
    { x: source.proposals[0].corners.FR.x, y: source.proposals[0].corners.FR.y },
    { x: source.proposals[0].corners.FL.x, y: source.proposals[0].corners.FL.y },
  ]);
  assert.equal(result.candidates[0].candidateSource, "gemini-proposal");
  assert.equal(result.candidates[0].coordinateSpace, "source-normalized/v1");
  assert.equal(allFrozen(result), true);
  assert.deepEqual(source, before);
  assert.deepEqual(trusted, trustedBefore);
});

test("validly parses one through four proposals and normalizes review text only", () => {
  const one = parse(valid());
  assert.equal(one.status, "proposals");
  const four = valid();
  four.proposals = [proposal(), proposal(), proposal(), proposal()];
  four.proposals[1].corners.NL.x = Number(four.proposals[1].corners.NL.x) + 0.01;
  four.proposals[2].corners.NL.x = Number(four.proposals[2].corners.NL.x) + 0.02;
  four.proposals[3].corners.NL.x = Number(four.proposals[3].corners.NL.x) + 0.03;
  four.proposals[0].edge_evidence.near.note = "  clear\nnear\tboundary  ";
  const result = parse(four);
  assert.equal(result.status, "proposals");
  if (result.status === "proposals") {
    assert.equal(result.candidates.length, 4);
    const evidence = result.reviewEvidenceByCandidateId[result.candidates[0].candidateId];
    assert.ok(Object.values(result.reviewEvidenceByCandidateId).some((value) => value.edges.near.note === "clear near boundary"));
    assert.ok(evidence);
  }
});

test("all insufficient-evidence reasons are accepted, frozen, and retain only normalized review text", () => {
  for (const reason_code of ["image_unusable", "floor_region_not_visible", "boundary_evidence_insufficient", "semantic_labels_unresolvable"]) {
    const response = boundResponse(fixture.insufficientEvidenceResponse);
    response.reason_code = reason_code;
    response.note = "  evidence \n unavailable  ";
    const result = parse(response);
    assert.equal(result.status, "insufficient_evidence");
    if (result.status === "insufficient_evidence") {
      assert.equal(result.reasonCode, reason_code);
      assert.equal(result.note, "evidence unavailable");
      assert.equal(allFrozen(result), true);
    }
  }
});

test("proposal order, review prose, and trusted provenance cannot alter geometry identities or AFC-R2 input fingerprints", () => {
  const first = valid();
  const second = valid();
  second.proposals[0].edge_evidence.near.note = "different prose";
  const baseContext = context(raw(second));
  const otherContext: GeminiFloorProposalTrustedContextV1 = {
    ...baseContext,
    auditProvenance: { ...baseContext.auditProvenance, providerId: "other", modelId: "other-model", promptVersion: "other-prompt" },
  };
  const a = parse(first);
  const b = parse(second, otherContext);
  assert.equal(a.status, "proposals");
  assert.equal(b.status, "proposals");
  if (a.status !== "proposals" || b.status !== "proposals") return;
  assert.equal(a.candidates[0].candidateId, b.candidates[0].candidateId);
  assert.equal(candidateCanonicalPolygon(a.candidates[0]), candidateCanonicalPolygon(b.candidates[0]));
  const reversed = valid();
  const shifted = proposal();
  shifted.corners.NL.x = Number(shifted.corners.NL.x) + 0.01;
  reversed.proposals = [shifted, proposal()];
  const ordered = parse(reversed);
  const reverseOrder = parse({ ...reversed, proposals: [...reversed.proposals].reverse() });
  assert.equal(ordered.status, "proposals");
  assert.equal(reverseOrder.status, "proposals");
  if (ordered.status === "proposals" && reverseOrder.status === "proposals") {
    assert.deepEqual(ordered.candidates.map((item) => item.candidateId), reverseOrder.candidates.map((item) => item.candidateId));
  }
});

test("bounded off-frame and in-frame inferred support are accepted without coordinate repair", () => {
  const offFrame = parse(boundResponse(fixture.offFrameProposalResponse));
  assert.equal(offFrame.status, "proposals");
  if (offFrame.status === "proposals") assert.equal(offFrame.candidates[0].sourceFloorPolygon[0].x, -0.1);
  const inferred = valid();
  inferred.proposals[0].corners.NL.support = "occluded_inferred";
  inferred.proposals[0].corners.NR.support = "inferred_from_visible_edges";
  const result = parse(inferred);
  assert.equal(result.status, "proposals");
});

test("closed schema rejects unknown fields at every object nesting level and all authority-like fields", () => {
  const cases: Array<[string, (value: ResponseObject) => void]> = [
    ["top", (v) => { v.unexpected = true; }],
    ["proposal", (v) => { v.proposals[0].unexpected = true; }],
    ["corners", (v) => { v.proposals[0].corners.X = proposal().corners.NL; }],
    ["corner", (v) => { v.proposals[0].corners.NL.extra = true; }],
    ["edges", (v) => { v.proposals[0].edge_evidence.diagonal = { support: "direct_visible", note: "unexpected edge" }; }],
    ["edge", (v) => { v.proposals[0].edge_evidence.near.extra = true; }],
    ["confidence", (v) => { v.confidence = 1; }],
    ["rank", (v) => { v.proposals[0].rank = 1; }],
    ["ratio", (v) => { v.proposals[0].ratio = 1.2; }],
    ["fov", (v) => { v.proposals[0].fov = 58; }],
    ["pose", (v) => { v.proposals[0].pose = {}; }],
    ["apply", (v) => { v.apply = true; }],
    ["proposal ID", (v) => { v.proposals[0].id = "model-id"; }],
    ["rationale", (v) => { v.proposals[0].rationale = "choose this"; }],
  ];
  for (const [label, alter] of cases) {
    const response = valid();
    alter(response);
    expectFailure(response, label === "corners" ? "r3_corner_unknown" : "r3_unknown_field");
  }
});

test("strict structural, schema, binding, status, and text failures fail closed", () => {
  const unknownSchema = valid();
  unknownSchema.schema_version = "future/v2";
  expectFailure(unknownSchema, "r3_unknown_schema_version", "$.schema_version");
  const wrongBinding = valid();
  wrongBinding.basis_binding = "not-the-trusted-binding";
  expectFailure(wrongBinding, "r3_basis_binding_mismatch", "$.basis_binding");
  const empty = valid();
  empty.proposals = [];
  expectFailure(empty, "r3_proposal_count_out_of_range");
  const five = valid();
  five.proposals = [proposal(), proposal(), proposal(), proposal(), proposal()];
  expectFailure(five, "r3_proposal_count_out_of_range");
  const conflict = boundResponse(fixture.insufficientEvidenceResponse) as ResponseObject;
  conflict.proposals = [proposal()];
  expectFailure(conflict, "r3_status_conflict");
  const proposalConflict = valid();
  proposalConflict.reason_code = "image_unusable";
  expectFailure(proposalConflict, "r3_status_conflict");
  const unknownReason = boundResponse(fixture.insufficientEvidenceResponse);
  unknownReason.reason_code = "other";
  expectFailure(unknownReason, "r3_unknown_reason_code");
  const tooLong = valid();
  tooLong.proposals[0].edge_evidence.near.note = "x".repeat(201);
  expectFailure(tooLong, "r3_text_too_long");
  const whitespace = valid();
  whitespace.proposals[0].edge_evidence.near.note = " \n\t ";
  expectFailure(whitespace, "r3_text_invalid");
  const control = boundResponse(fixture.insufficientEvidenceResponse);
  control.note = "bad\u0000text";
  expectFailure(control, "r3_text_invalid");
});

test("strict text parser refuses fences, prose, malformed JSON, arrays, and oversized UTF-8 source before JSON parsing", () => {
  const text = raw(valid());
  for (const invalid of [`\`\`\`json\n${text}\n\`\`\``, `Here is the response: ${text}`, "{", "[]"]) {
    const result = parseGeminiFloorProposalResponse(invalid, context(invalid));
    assert.equal(result.status, "contract_failure");
    if (result.status === "contract_failure") {
      assert.equal(result.reason, invalid === "[]" ? "r3_not_object" : "r3_invalid_json");
    }
  }
  const oversized = `"${"🙂".repeat(20_000)}"`;
  expectFailureResult(parseGeminiFloorProposalResponse(oversized, context(oversized)), "r3_response_too_large");
});

function expectFailureResult(result: GeminiFloorProposalParseResult, reason: string) {
  assert.equal(result.status, "contract_failure");
  if (result.status === "contract_failure") assert.equal(result.reason, reason);
}

test("corner shape, coordinate, support, and geometry failures reject the entire proposal set", () => {
  for (const missing of ["NL", "NR", "FR", "FL"]) {
    const response = valid();
    delete response.proposals[0].corners[missing];
    expectFailure(response, "r3_corner_missing", `$.proposals[0].corners.${missing}`);
  }
  const extra = valid();
  extra.proposals[0].corners.extra = proposal().corners.NL;
  expectFailure(extra, "r3_corner_unknown");
  for (const invalidCoordinate of ["0.5", null]) {
    const response = valid();
    response.proposals[0].corners.NL.x = invalidCoordinate;
    expectFailure(response, "r3_non_finite_coordinate");
  }
  const below = valid();
  below.proposals[0].corners.NL.x = -0.25001;
  expectFailure(below, "r3_coordinate_outside_permitted_extent");
  const above = valid();
  above.proposals[0].corners.NL.x = 1.25001;
  expectFailure(above, "r3_coordinate_outside_permitted_extent");
  const duplicate = valid();
  duplicate.proposals[0].corners.NR = clone(duplicate.proposals[0].corners.NL);
  expectFailure(duplicate, "r3_polygon_invalid");
  const collinear = valid();
  collinear.proposals[0].corners = {
    NL: { x: 0.1, y: 0.1, support: "direct_visible" },
    NR: { x: 0.2, y: 0.2, support: "direct_visible" },
    FR: { x: 0.3, y: 0.3, support: "direct_visible" },
    FL: { x: 0.4, y: 0.4, support: "direct_visible" },
  };
  expectFailure(collinear, "r3_polygon_invalid");
  const bowTie = valid();
  bowTie.proposals[0].corners = {
    NL: { x: 0.1, y: 0.1, support: "direct_visible" },
    NR: { x: 0.9, y: 0.9, support: "direct_visible" },
    FR: { x: 0.9, y: 0.1, support: "direct_visible" },
    FL: { x: 0.1, y: 0.9, support: "direct_visible" },
  };
  expectFailure(bowTie, "r3_polygon_invalid");
  const nonConvex = valid();
  nonConvex.proposals[0].corners = {
    NL: { x: 0.1, y: 0.1, support: "direct_visible" },
    NR: { x: 0.9, y: 0.1, support: "direct_visible" },
    FR: { x: 0.4, y: 0.4, support: "direct_visible" },
    FL: { x: 0.1, y: 0.9, support: "direct_visible" },
  };
  expectFailure(nonConvex, "r3_polygon_invalid");
});

test("out-of-frame support consistency and unknown supports are fail-closed", () => {
  for (const support of ["direct_visible", "occluded_inferred"]) {
    const response = boundResponse(fixture.offFrameProposalResponse);
    response.proposals[0].corners.NL.support = support;
    expectFailure(response, "r3_support_contradiction");
  }
  const inFrame = valid();
  inFrame.proposals[0].corners.NL.support = "outside_frame_inferred";
  expectFailure(inFrame, "r3_support_contradiction");
  const corner = valid();
  corner.proposals[0].corners.NL.support = "maybe";
  expectFailure(corner, "r3_unknown_support_value");
  const edge = valid();
  edge.proposals[0].edge_evidence.near.support = "maybe";
  expectFailure(edge, "r3_unknown_support_value");
});

test("exact duplicates receive stable geometry-derived occurrence IDs and remain separate AFC-R2 reporting rows", () => {
  const response = valid();
  const same = proposal();
  same.edge_evidence.near.note = "different note, same geometry";
  response.proposals = [same, proposal()];
  const result = parse(response);
  assert.equal(result.status, "proposals");
  if (result.status !== "proposals") return;
  assert.equal(result.candidates.length, 2);
  assert.match(result.candidates[0].candidateId, /^afc-r3:fnv1a32:[0-9a-f]{8}#01$/);
  assert.equal(result.candidates[1].candidateId.replace(/#02$/, ""), result.candidates[0].candidateId.replace(/#01$/, ""));
  assert.match(result.candidates[1].candidateId, /#02$/);
  const comparison = runCandidateDiscriminationExperiment({
    contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
    sharedContext: context().sharedComparisonContext,
    candidates: result.candidates,
    selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  });
  assert.equal(comparison.rankingStages.exactDistinctCandidateCount, 1);
  assert.equal(comparison.rankingStages.exactDuplicateEvaluationReuse, 1);
  assert.equal(comparison.candidateFamilies[0].totalReportingCandidateCount, 2);
});

test("a malformed competing proposal atomically rejects the entire response", () => {
  const response = valid();
  const malformed = proposal();
  malformed.corners.NL.x = "broken";
  response.proposals = [proposal(), malformed];
  const result = parse(response);
  expectFailureResult(result, "r3_non_finite_coordinate");
  if (result.status === "contract_failure") assert.equal(result.path, "$.proposals[1].corners.NL.x");
});

test("the result exposes no adapter selection, confidence, ratio, FOV, pose, or Apply authority", () => {
  const result = parse(valid());
  assert.equal(result.status, "proposals");
  if (result.status !== "proposals") return;
  const serial = JSON.stringify(result);
  for (const forbidden of ["winner", "confidence", "ratio", "fov", "pose", "apply"]) {
    assert.equal(Object.hasOwn(result, forbidden), false);
    assert.equal(serial.includes(`"${forbidden}"`), false);
  }
  assert.deepEqual(result.safety, { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
  assert.equal(result.schemaVersion, GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION);
});

test("trusted coordinate extent policy is exact, finite, and actually governs acceptance", () => {
  const response = valid();
  const text = raw(response);
  for (const mutate of [
    (trusted: MutableTrustedContext) => { trusted.coordinateExtentPolicy.version = "afc-r3-coordinate-extent/v0"; },
    (trusted: MutableTrustedContext) => { trusted.coordinateExtentPolicy.maxX = 1.26; },
    (trusted: MutableTrustedContext) => { trusted.coordinateExtentPolicy.minY = Number.NaN; },
  ]) {
    const trusted = context(text) as unknown as MutableTrustedContext;
    trusted.coordinateExtentPolicy = { ...trusted.coordinateExtentPolicy };
    mutate(trusted);
    expectFailureResult(parseGeminiFloorProposalResponse(text, trusted as GeminiFloorProposalTrustedContextV1), "r3_coordinate_extent_policy_mismatch");
  }
});

test("raw-response SHA-256 is verified before parsing and retained separately in provenance", () => {
  const response = valid();
  const text = raw(response);
  const accepted = parseGeminiFloorProposalResponse(text, context(text));
  assert.equal(accepted.status, "proposals");
  if (accepted.status === "proposals") {
    assert.equal(accepted.auditProvenance.rawResponseSha256, createHash("sha256").update(text, "utf8").digest("hex"));
  }
  const malformed = context(text) as unknown as MutableTrustedContext;
  malformed.auditProvenance = { ...malformed.auditProvenance, rawResponseSha256: "not-a-sha256" };
  expectFailureResult(parseGeminiFloorProposalResponse(text, malformed as GeminiFloorProposalTrustedContextV1), "r3_raw_response_hash_invalid");
  const mismatched = context(text) as unknown as MutableTrustedContext;
  mismatched.auditProvenance = { ...mismatched.auditProvenance, rawResponseSha256: "0".repeat(64) };
  expectFailureResult(parseGeminiFloorProposalResponse(text, mismatched as GeminiFloorProposalTrustedContextV1), "r3_raw_response_hash_mismatch");
});

test("basis bindings are derived from trusted comparison context and extent policy", () => {
  const original = sharedContext();
  const first = binding(original);
  assert.equal(first, binding(original));
  assert.match(first, /^afc-r3b:[a-f0-9]{64}$/);
  assert.notEqual(first, binding({ ...original, basisFingerprint: "other-basis" }));
  assert.notEqual(first, binding({ ...original, decodedWidth: original.decodedWidth + 1 }));
  assert.notEqual(first, binding({ ...original, frameSize: { ...original.frameSize, width: original.frameSize.width + 1 } }));
  assert.notEqual(first, binding({ ...original, normalizationPolicyVersion: "other" } as unknown as SharedCandidateComparisonContext));
  assert.notEqual(first, binding(original, { ...GEMINI_FLOOR_COORDINATE_EXTENT_POLICY, maxX: 1.26 }));
  const response = valid();
  const text = raw(response);
  const changed = context(text) as unknown as MutableTrustedContext;
  changed.sharedComparisonContext = { ...changed.sharedComparisonContext, basisFingerprint: "other-basis" };
  expectFailureResult(parseGeminiFloorProposalResponse(text, changed as GeminiFloorProposalTrustedContextV1), "r3_basis_binding_mismatch");
});

test("trusted adapter version, binding syntax, branch fields, and failure audit provenance remain separate fail-closed boundaries", () => {
  const response = valid();
  const text = raw(response);
  const stale = context(text) as unknown as MutableTrustedContext;
  stale.auditProvenance = { ...stale.auditProvenance, contractVersion: "AFC-R3B/v0" };
  expectFailureResult(parseGeminiFloorProposalResponse(text, stale as GeminiFloorProposalTrustedContextV1), "r3_trusted_contract_version_mismatch");
  const malformedBinding = valid();
  malformedBinding.basis_binding = "";
  expectFailureResult(parseGeminiFloorProposalResponse(raw(malformedBinding), context(raw(malformedBinding))), "r3_basis_binding_invalid");
  const proposalCrossBranch = valid();
  proposalCrossBranch.reason_code = "image_unusable";
  expectFailure(proposalCrossBranch, "r3_status_conflict", "$.reason_code");
  const insufficientCrossBranch = boundResponse(fixture.insufficientEvidenceResponse) as ResponseObject;
  insufficientCrossBranch.proposals = [proposal()];
  const failed = parse(insufficientCrossBranch);
  expectFailureResult(failed, "r3_status_conflict");
  if (failed.status === "contract_failure") {
    assert.equal(failed.auditProvenance.requestId, fixture.trustedContext.auditProvenance.requestId);
    assert.equal(failed.auditProvenance.contractVersion, GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION);
    assert.equal(allFrozen(failed), true);
    assert.equal(JSON.stringify(failed).includes(raw(insufficientCrossBranch)), false);
  }
});
