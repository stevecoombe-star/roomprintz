import assert from "node:assert/strict";
import test from "node:test";

import roomC from "./fixtures/afc-sr1-room-c-ground-truth.v1.json";
import {
  AFC_SR1_ASPECT_RELATIVE_ERROR_TOLERANCE,
  AFC_SR1_COORDINATE_SPACE,
  AFC_SR1_HYPOTHESES,
  AFC_SR1_OVERLAY_DESCRIPTOR_VERSION,
  AFC_SR1_SCORE_TOTAL_TOLERANCE,
  AFC_SR1_SEAM_BINDING_TOKEN_VERSION,
  AFC_SR1_SEMANTIC_ORDER,
  AFC_SR1_SEMANTIC_PRIOR_BINDING_VERSION,
  AFC_SR1_SEMANTIC_PRIOR_REQUEST_VERSION,
  AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION,
  AFC_SR1_VALIDATED_ADVISORY_VERSION,
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1SemanticPriorBinding,
  buildAfcSr1SemanticPriorReplay,
  buildAfcSr1SemanticPriorRequest,
  buildAfcSr1SeamBindingToken,
  buildAfcSr1SolverHandoff,
  buildAfcSr1OverlayDescriptor,
  computeAfcSr1RelativeAspectError,
  deriveAfcSr1CanonicalNearToFarSeams,
  fingerprintAfcSr1OverlayDescriptor,
  fingerprintAfcSr1SemanticPriorRequest,
  fingerprintAfcSr1SourcePolygon,
  pointOnAfcSr1NearToFarSeam,
  projectPointOntoAfcSr1NearToFarSeam,
  validateAfcSr1CanonicalNearToFarSeam,
  validateAfcSr1SemanticPriorResponse,
} from "./afc-sr1-semantic-prior";

const hash = (digit: string) => digit.repeat(64);
const originalBasis = {
  fingerprint: hash("a"),
  decodedWidth: 1600,
  decodedHeight: 1000,
  orientation: 1 as const,
};
const emptyBasis = {
  fingerprint: hash("b"),
  decodedWidth: 800,
  decodedHeight: 500,
  orientation: 1 as const,
};
const polygon = [
  { x: 0.12, y: 0.88 },
  { x: 0.89, y: 0.82 },
  { x: 0.68, y: 0.38 },
  { x: 0.29, y: 0.43 },
] as const;

function replay(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "afc-sr1-replay-evidence-identity/v1" as const,
    receiptContractVersion: "afc-r3c-proposal-run-receipt/v1" as const,
    receiptFileName: "receipt.json",
    receiptSha256: hash("c"),
    requestId: "request-1",
    imageRole: "empty_room_boundary_specialist" as const,
    r3bCandidateId: "afc-r3:fixture:1",
    r3cCandidateId: "afc-r3c:empty:afc-r3:fixture:1",
    inputImageFingerprint: emptyBasis.fingerprint,
    originalImageFingerprint: originalBasis.fingerprint,
    emptyRoomAssistFingerprint: emptyBasis.fingerprint,
    replayVerificationVersion: "replay/v1",
    replayEvidenceFingerprint: hash("d"),
    ...overrides,
  };
}

function placement(overrides: Record<string, unknown> = {}) {
  return buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "verified_source_normalized_transfer",
    sourceEmptyBasis: emptyBasis,
    targetOriginalBasis: originalBasis,
    compatibilityTier: "aspect_compatible_rescaled",
    transferRecordFingerprint: hash("e"),
    ...overrides,
  });
}

function context(overrides: Readonly<{
  replayEvidence?: ReturnType<typeof replay>;
  placement?: ReturnType<typeof placement>;
  rawSourcePolygon?: typeof polygon;
  overlayGenerationId?: string;
  requestGenerationId?: string;
}> = {}) {
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: overrides.replayEvidence ?? replay(),
    placement: overrides.placement ?? placement(),
    rawSourcePolygon: overrides.rawSourcePolygon ?? polygon,
    overlayGenerationId: overrides.overlayGenerationId ?? "overlay-1",
    requestGenerationId: overrides.requestGenerationId ?? "request-generation-1",
  });
  const overlayDescriptor = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: binding.placement.targetOriginalBasis,
    rawSourcePolygon: binding.rawSourcePolygon,
    overlayGenerationId: binding.overlayGenerationId,
  });
  const request = buildAfcSr1SemanticPriorRequest({ semanticPriorBinding: binding, overlayDescriptor });
  return { binding, overlayDescriptor, request };
}

function validResponse(
  bindingEcho: string,
  decision: "adjust_nl" | "adjust_nr" | "no_adjustment" = "adjust_nr"
) {
  const top = decision === "adjust_nl" ? "NL" : decision === "adjust_nr" ? "NR" : "none";
  const others = (["none", "NL", "NR"] as const).filter(hypothesis => hypothesis !== top);
  return {
    schemaVersion: "afc-sr1-semantic-prior-response/v1",
    bindingEcho,
    decision,
    rankedHypotheses: [
      { hypothesis: top, score: 0.7 },
      { hypothesis: others[0], score: 0.2 },
      { hypothesis: others[1], score: 0.1 },
    ],
    seamTPrior: decision === "no_adjustment" ? null : {
      adjustableCorner: top,
      preferredSeamT: 0.7,
      minSeamT: 0.5,
      maxSeamT: 0.9,
    },
    semanticLabels: ["both_side_walls_visible"],
  };
}

test("P0 exports versioned complete source-normalized contract constants", () => {
  assert.equal(AFC_SR1_SEMANTIC_PRIOR_BINDING_VERSION, "afc-sr1-semantic-prior-binding/v1");
  assert.equal(AFC_SR1_OVERLAY_DESCRIPTOR_VERSION, "afc-sr1-overlay-descriptor/v1");
  assert.equal(AFC_SR1_SEMANTIC_PRIOR_REQUEST_VERSION, "afc-sr1-semantic-prior-request/v1");
  assert.equal(AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION, "afc-sr1-semantic-prior-response/v1");
  assert.equal(AFC_SR1_VALIDATED_ADVISORY_VERSION, "afc-sr1-validated-advisory/v1");
  assert.equal(AFC_SR1_SEAM_BINDING_TOKEN_VERSION, "afc-sr1-seam-binding-token/v1");
  assert.equal(AFC_SR1_COORDINATE_SPACE, "source-normalized/v1");
  assert.deepEqual(AFC_SR1_SEMANTIC_ORDER, ["NL", "NR", "FR", "FL"]);
  assert.deepEqual(AFC_SR1_HYPOTHESES, ["none", "NL", "NR"]);
  assert.equal(AFC_SR1_SCORE_TOTAL_TOLERANCE, 1e-9);
  assert.equal(AFC_SR1_ASPECT_RELATIVE_ERROR_TOLERANCE, 0.015);
});

test("canonical seams are direct raw near-to-far semantic seams", () => {
  const seams = deriveAfcSr1CanonicalNearToFarSeams(polygon);
  assert.deepEqual(seams.NL.seamStartNear, polygon[0]);
  assert.deepEqual(seams.NL.seamEndFar, polygon[3]);
  assert.deepEqual(seams.NR.seamStartNear, polygon[1]);
  assert.deepEqual(seams.NR.seamEndFar, polygon[2]);
  assert.deepEqual(pointOnAfcSr1NearToFarSeam(seams.NR, 0), polygon[1]);
  assert.deepEqual(pointOnAfcSr1NearToFarSeam(seams.NR, 1), polygon[2]);
  assert.throws(() => validateAfcSr1CanonicalNearToFarSeam({
    ...seams.NR, seamStartNear: polygon[2], seamEndFar: polygon[1],
  }, polygon), /reversed/);
  assert.throws(() => validateAfcSr1CanonicalNearToFarSeam({
    ...seams.NL, seamStartNear: polygon[3], seamEndFar: polygon[0],
  }, polygon), /reversed/);
});

test("source polygon validation preserves semantic tuple order and extent without clamping", () => {
  assert.throws(() => buildAfcSr1SemanticPriorBinding({
    replayEvidence: replay(), placement: placement(),
    rawSourcePolygon: [polygon[1], polygon[2], polygon[3], polygon[0]],
    overlayGenerationId: "o", requestGenerationId: "r",
  }), /semantic_order/);
  assert.throws(() => buildAfcSr1SemanticPriorBinding({
    replayEvidence: replay(), placement: placement(),
    rawSourcePolygon: [{ x: -0.26, y: 0.8 }, polygon[1], polygon[2], polygon[3]],
    overlayGenerationId: "o", requestGenerationId: "r",
  }), /extent/);
  assert.throws(() => fingerprintAfcSr1SourcePolygon([
    { x: Number.NaN, y: 0.8 }, polygon[1], polygon[2], polygon[3],
  ]), /extent/);
});

test("Original-basis placement requires an explicit compatible placement record", () => {
  const already = buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "already_original_basis",
    sourceEmptyBasis: originalBasis,
    targetOriginalBasis: originalBasis,
    compatibilityTier: "exact_grid_compatible",
    transferRecordFingerprint: hash("f"),
  });
  assert.equal(already.status, "placed_on_original_basis");
  assert.throws(() => buildAfcSr1OriginalBasisPlacement({
    ...already, sourceEmptyBasis: emptyBasis,
  }), /mismatch/);
  assert.throws(() => buildAfcSr1OriginalBasisPlacement({
    ...placement(), targetOriginalBasis: { ...originalBasis, orientation: 8 },
  } as any), /values/);
  assert.throws(() => buildAfcSr1OriginalBasisPlacement({
    ...placement(), compatibilityTier: "exact_grid_compatible",
  }), /exact_grid/);

  const boundarySource = {
    fingerprint: hash("1"), decodedWidth: 1015, decodedHeight: 1000, orientation: 1 as const,
  };
  const boundaryTarget = {
    fingerprint: hash("2"), decodedWidth: 1000, decodedHeight: 1000, orientation: 1 as const,
  };
  const boundaryError = computeAfcSr1RelativeAspectError(boundarySource, boundaryTarget);
  assert.ok(boundaryError <= AFC_SR1_ASPECT_RELATIVE_ERROR_TOLERANCE);
  assert.ok(Math.abs(boundaryError - 0.015) < Number.EPSILON);
  assert.doesNotThrow(() => buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "verified_source_normalized_transfer",
    sourceEmptyBasis: boundarySource,
    targetOriginalBasis: boundaryTarget,
    compatibilityTier: "aspect_compatible_rescaled",
    transferRecordFingerprint: hash("3"),
  }));
  assert.throws(() => buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "verified_source_normalized_transfer",
    sourceEmptyBasis: { ...boundarySource, decodedWidth: 1016 },
    targetOriginalBasis: boundaryTarget,
    compatibilityTier: "aspect_compatible_rescaled",
    transferRecordFingerprint: hash("3"),
  }), /placement_aspect_mismatch/);
});

test("complete binding derives all hypotheses and binds replay evidence by identity", () => {
  const { binding, request } = context();
  assert.deepEqual(Object.keys(binding.hypotheses), ["none", "NL", "NR"]);
  assert.equal(binding.hypotheses.none, true);
  assert.deepEqual(request.hypotheses, ["none", "NL", "NR"]);
  assert.equal(request.geometryAuthority, "server_fixed_empty_candidate_geometry");
  assert.equal(request.advisoryOnly, true);
  assert.equal(binding.replayEvidence.emptyRoomAssistFingerprint, emptyBasis.fingerprint);
  assert.equal(binding.placement.targetOriginalBasis.fingerprint, originalBasis.fingerprint);

  const fields = [
    "receiptFileName", "receiptSha256", "requestId", "r3bCandidateId", "r3cCandidateId",
    "inputImageFingerprint", "originalImageFingerprint", "emptyRoomAssistFingerprint",
    "replayVerificationVersion", "replayEvidenceFingerprint",
  ] as const;
  const baseline = request.seamBindingToken;
  for (const field of fields) {
    const value = field.includes("Fingerprint") || field === "receiptSha256" || field === "replayEvidenceFingerprint"
      ? hash(field.charCodeAt(0).toString(16).slice(-1) || "0")
      : `${field}-substituted`;
    if (field === "r3bCandidateId") {
      const candidate = "afc-r3:fixture:substituted";
      assert.notEqual(context({ replayEvidence: replay({ r3bCandidateId: candidate, r3cCandidateId: `afc-r3c:empty:${candidate}` }) }).request.seamBindingToken, baseline);
    } else if (field === "r3cCandidateId") {
      assert.throws(() => context({ replayEvidence: replay({ r3cCandidateId: "afc-r3c:empty:afc-r3:fixture:other" }) }), /candidate_identity/);
    } else if (field === "inputImageFingerprint" || field === "emptyRoomAssistFingerprint") {
      assert.throws(() => context({ replayEvidence: replay({ [field]: value }) }), /replay_empty_role_input_image_mismatch/);
    } else if (field === "originalImageFingerprint") {
      assert.throws(() => context({ replayEvidence: replay({ [field]: value }) }), /binding_original_target_basis_mismatch/);
    } else {
      assert.notEqual(context({ replayEvidence: replay({ [field]: value }) }).request.seamBindingToken, baseline);
    }
  }
  assert.throws(() => context({ replayEvidence: { ...replay(), replay_verified: true } as any }), /shape/);
});

test("verified Empty transfer binds request input, support image, source basis, and Original target", () => {
  assert.doesNotThrow(() => context());
  const replacementEmptyFingerprint = hash("7");
  assert.throws(() => context({
    replayEvidence: replay({ inputImageFingerprint: replacementEmptyFingerprint }),
  }), /replay_empty_role_input_image_mismatch/);
  assert.throws(() => context({
    replayEvidence: replay({
      inputImageFingerprint: replacementEmptyFingerprint,
      emptyRoomAssistFingerprint: replacementEmptyFingerprint,
    }),
  }), /binding_empty_source_basis_mismatch/);
  assert.throws(() => context({
    replayEvidence: replay({ originalImageFingerprint: hash("8") }),
  }), /binding_original_target_basis_mismatch/);
});

test("canonical hash inputs are stable and reject non-JSON values", () => {
  assert.equal(
    fingerprintAfcSr1SourcePolygon(polygon),
    fingerprintAfcSr1SourcePolygon(structuredClone(polygon)),
  );
  const { binding, overlayDescriptor, request } = context();
  assert.equal(fingerprintAfcSr1OverlayDescriptor(overlayDescriptor), fingerprintAfcSr1OverlayDescriptor(structuredClone(overlayDescriptor)));
  assert.equal(buildAfcSr1SeamBindingToken({ semanticPriorBinding: binding, overlayFingerprint: request.overlayFingerprint }), request.seamBindingToken);
  assert.equal(fingerprintAfcSr1SemanticPriorRequest(request), fingerprintAfcSr1SemanticPriorRequest(structuredClone(request)));
  const zeroPolygon = [
    { x: 0, y: 0.88 }, polygon[1], polygon[2], polygon[3],
  ] as const;
  const negativeZeroPolygon = [
    { x: -0, y: 0.88 }, polygon[1], polygon[2], polygon[3],
  ] as const;
  assert.equal(fingerprintAfcSr1SourcePolygon(zeroPolygon), fingerprintAfcSr1SourcePolygon(negativeZeroPolygon));
  assert.throws(() => fingerprintAfcSr1SourcePolygon([
    { x: Infinity, y: 0.8 }, polygon[1], polygon[2], polygon[3],
  ]), /extent/);
});

test("overlay binds the Original basis, both seams, and generation without renderer state", () => {
  const { binding, overlayDescriptor } = context();
  assert.equal(overlayDescriptor.originalTargetBasis.fingerprint, binding.placement.targetOriginalBasis.fingerprint);
  assert.deepEqual(Object.keys(overlayDescriptor.hypotheses), ["none", "NL", "NR"]);
  assert.equal(overlayDescriptor.visualInstructions.showReplacementPolygon, false);
  assert.equal(overlayDescriptor.visualInstructions.showCameraGeometry, false);
  const changed = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: binding.placement.targetOriginalBasis,
    rawSourcePolygon: binding.rawSourcePolygon,
    overlayGenerationId: "overlay-2",
  });
  assert.notEqual(fingerprintAfcSr1OverlayDescriptor(overlayDescriptor), fingerprintAfcSr1OverlayDescriptor(changed));
  assert.equal(JSON.stringify(overlayDescriptor).includes("viewport"), false);
  assert.equal(JSON.stringify(overlayDescriptor).includes("provider"), false);
});

test("strict response parsing accepts valid advice and fails closed on geometry or rank errors", () => {
  const { binding, overlayDescriptor, request } = context();
  for (const decision of ["adjust_nl", "adjust_nr", "no_adjustment"] as const) {
    const validation = validateAfcSr1SemanticPriorResponse({
      response: validResponse(request.seamBindingToken, decision),
      semanticPriorBinding: binding, overlayDescriptor, request,
    });
    assert.equal(validation.ok, true);
    if (validation.ok) assert.equal(validation.value.status, "usable");
  }
  for (const decision of ["abstain", "unsupported_image_class", "insufficient_evidence"] as const) {
    const validation = validateAfcSr1SemanticPriorResponse({
      response: {
        schemaVersion: "afc-sr1-semantic-prior-response/v1", bindingEcho: request.seamBindingToken,
        decision, rankedHypotheses: null, seamTPrior: null, semanticLabels: [],
      },
      semanticPriorBinding: binding, overlayDescriptor, request,
    });
    assert.equal(validation.ok, true);
    if (validation.ok) assert.equal(validation.value.status, decision === "unsupported_image_class" ? "unsupported" : "safe_abstention");
  }
  const invalids = [
    { polygon: polygon },
    { corners: polygon },
    { NL: polygon[0] },
    { seamStart: polygon[1] },
    { seamEndpoints: polygon },
    { width: 4.6 },
    { depth: 4 },
    { ratio: 1.15 },
    { verticalFov: 79 },
    { camera: {} },
  ];
  for (const injected of invalids) {
    const result = validateAfcSr1SemanticPriorResponse({
      response: { ...validResponse(request.seamBindingToken), ...injected },
      semanticPriorBinding: binding, overlayDescriptor, request,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failureClass, "hard_invalid");
  }
  const duplicate = validResponse(request.seamBindingToken);
  duplicate.rankedHypotheses[2].hypothesis = "NR";
  const badRank = validateAfcSr1SemanticPriorResponse({ response: duplicate, semanticPriorBinding: binding, overlayDescriptor, request });
  assert.equal(badRank.ok, false);
  const invalidOrder = validResponse(request.seamBindingToken);
  invalidOrder.rankedHypotheses[1].score = 0.8;
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: invalidOrder, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const invalidRange = validResponse(request.seamBindingToken);
  invalidRange.rankedHypotheses[0].score = 1.1;
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: invalidRange, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const invalidTotal = validResponse(request.seamBindingToken);
  invalidTotal.rankedHypotheses[2].score = 0.05;
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: invalidTotal, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const rankConflict = validResponse(request.seamBindingToken);
  rankConflict.decision = "adjust_nl";
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: rankConflict, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const inconsistentSeam = validResponse(request.seamBindingToken);
  if (!inconsistentSeam.seamTPrior) throw new Error("test setup failure");
  inconsistentSeam.seamTPrior.adjustableCorner = "NL";
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: inconsistentSeam, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const invalidInterval = validResponse(request.seamBindingToken);
  if (!invalidInterval.seamTPrior) throw new Error("test setup failure");
  invalidInterval.seamTPrior.minSeamT = 0.8;
  invalidInterval.seamTPrior.maxSeamT = 0.2;
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: invalidInterval, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const noAdjustmentWithSeam = validResponse(request.seamBindingToken, "no_adjustment");
  noAdjustmentWithSeam.seamTPrior = { adjustableCorner: "NR", preferredSeamT: 0.5, minSeamT: 0.2, maxSeamT: 0.8 };
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: noAdjustmentWithSeam, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const abstentionWithRanking = {
    schemaVersion: "afc-sr1-semantic-prior-response/v1", bindingEcho: request.seamBindingToken,
    decision: "abstain", rankedHypotheses: validResponse(request.seamBindingToken).rankedHypotheses,
    seamTPrior: null, semanticLabels: [],
  };
  assert.equal(validateAfcSr1SemanticPriorResponse({
    response: abstentionWithRanking, semanticPriorBinding: binding, overlayDescriptor, request,
  }).ok, false);
  const stale = validateAfcSr1SemanticPriorResponse({
    response: validResponse(`sr1sbt1:${hash("0")}`), semanticPriorBinding: binding, overlayDescriptor, request,
  });
  assert.deepEqual(stale, { ok: false, failureClass: "stale", reasonCode: "binding_or_request_mismatch" });
});

test("replay record and future solver handoff preserve advisory-only authority", () => {
  const { binding, overlayDescriptor, request } = context();
  const usable = validateAfcSr1SemanticPriorResponse({
    response: validResponse(request.seamBindingToken), semanticPriorBinding: binding, overlayDescriptor, request,
  });
  assert.equal(usable.ok, true);
  if (!usable.ok) return;
  const replayRecord = buildAfcSr1SemanticPriorReplay({
    bindingToken: request.seamBindingToken, semanticPriorBinding: binding, overlayDescriptor,
    overlayFingerprint: request.overlayFingerprint, request,
    executionProvenance: {
      providerId: null, modelId: null, providerModelVersion: null, attempt: 0,
      requestedAt: null, receivedAt: null,
    },
    rawProviderResponse: null, parsedResponse: null, validation: usable.value,
  });
  assert.equal(replayRecord.requestDigest, fingerprintAfcSr1SemanticPriorRequest(request));
  const handoff = buildAfcSr1SolverHandoff({
    semanticPriorBinding: binding, bindingToken: request.seamBindingToken, advisory: usable.value,
  });
  assert.deepEqual(handoff.allowedHypotheses, ["none", "NL", "NR"]);
  for (const forbidden of ["refined", "width", "depth", "fov", "camera", "pose", "apply"]) {
    assert.equal(Object.keys(handoff).some(key => key.toLowerCase().includes(forbidden)), false);
  }
});

test("Room C is representable as an explicit Original-basis contract without calibration defaults", () => {
  const raw = roomC.rawFloor.polygon as unknown as typeof polygon;
  const roomOriginal = {
    fingerprint: roomC.imageBasis.fingerprint!, decodedWidth: roomC.imageBasis.decodedWidth!,
    decodedHeight: roomC.imageBasis.decodedHeight!, orientation: 1 as const,
  };
  const roomEmpty = {
    fingerprint: roomC.uncertifiedReceiptSeamEvidence.emptyBasisFingerprint,
    decodedWidth: roomC.uncertifiedReceiptSeamEvidence.emptyDecodedWidth,
    decodedHeight: roomC.uncertifiedReceiptSeamEvidence.emptyDecodedHeight,
    orientation: 1 as const,
  };
  const roomPlacement = buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "verified_source_normalized_transfer",
    sourceEmptyBasis: roomEmpty,
    targetOriginalBasis: roomOriginal,
    compatibilityTier: "aspect_compatible_rescaled",
    transferRecordFingerprint: hash("9"),
  });
  assert.ok(computeAfcSr1RelativeAspectError(roomEmpty, roomOriginal) <= AFC_SR1_ASPECT_RELATIVE_ERROR_TOLERANCE);
  assert.throws(() => buildAfcSr1OriginalBasisPlacement({
    ...roomPlacement, compatibilityTier: "exact_grid_compatible",
  }), /placement_exact_grid_mismatch/);
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: replay({
      receiptFileName: roomC.rawFloor.receiptFileName,
      receiptSha256: roomC.rawFloor.receiptSha256,
      requestId: roomC.rawFloor.requestId,
      r3bCandidateId: roomC.rawFloor.r3bCandidateId,
      r3cCandidateId: roomC.rawFloor.r3cCandidateId,
      inputImageFingerprint: roomEmpty.fingerprint,
      originalImageFingerprint: roomOriginal.fingerprint,
      emptyRoomAssistFingerprint: roomEmpty.fingerprint,
    }),
    placement: roomPlacement, rawSourcePolygon: raw,
    overlayGenerationId: "room-c-overlay", requestGenerationId: "room-c-request",
  });
  const nr = binding.hypotheses.NR;
  assert.deepEqual(nr.seamStartNear, roomC.rawFloor.polygon[1]);
  assert.deepEqual(nr.seamEndFar, roomC.rawFloor.polygon[2]);
  const projected = pointOnAfcSr1NearToFarSeam(nr, roomC.seamRefinement.seamT!);
  assert.ok(Math.hypot(projected.x - roomC.acceptedFloor.polygon[1].x, projected.y - roomC.acceptedFloor.polygon[1].y) < 0.001);
  const measurement = projectPointOntoAfcSr1NearToFarSeam(nr, roomC.acceptedFloor.polygon[1]);
  assert.ok(Math.abs(measurement.seamT - roomC.seamRefinement.seamT!) < 1e-12);
  for (const index of [0, 2, 3]) assert.deepEqual(roomC.rawFloor.polygon[index], roomC.acceptedFloor.polygon[index]);
  const serialized = JSON.stringify(binding);
  for (const solverValue of ["79", "4.6", "1.15", "verticalFov", "worldWidth"]) {
    assert.equal(serialized.includes(solverValue), false);
  }
});
