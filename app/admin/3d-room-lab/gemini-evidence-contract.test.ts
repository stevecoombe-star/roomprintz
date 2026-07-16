import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  attemptRawResponseReparse,
  attemptRawResponseReplay,
  buildCoordinateTransferTransform,
  buildInvocationReceipt,
  buildSealedReceipt,
  canonicalizeRfc8785Jcs,
  computeReceiptDigest,
  digestCanonicalJson,
  getRequiredDigestScope,
  makeInvocationReference,
  makeSyntheticDigest,
  sealReceipt,
  validateCoordinateTransferTransform,
  validateDigestForField,
  validateReceiptReference,
  validateReceiptSet,
  validateRetentionTombstone,
  validateZeroAuthority,
  verifyReceiptSelfDigest,
  type ContentDigestScopeV1,
  type ContractReceiptV1,
  type EvidenceDigestFieldKey,
  type InvocationIdentityV1,
  type InvocationPreflightV1,
  type RawResponseBindingV1,
  type RetentionTombstoneBodyV1,
} from "./gemini-evidence-contract";

const PASSED_PREFLIGHT: InvocationPreflightV1 = {
  status: "passed",
  outboundCallStatus: "provider_call_started",
  refusalReasons: [],
};

function initialIdentity(
  overrides: Partial<InvocationIdentityV1> = {}
): InvocationIdentityV1 {
  return {
    logicalInvocationId: "lid-1",
    requestId: "req-1",
    providerAttemptId: "attempt-0",
    relationship: "initial",
    retryOfProviderAttemptId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–4: Canonical JSON contract
// ---------------------------------------------------------------------------

test("1) key insertion order does not affect JCS output or digest", () => {
  const a = { b: 1, a: 2, nested: { z: 1, y: 2 } };
  const b = { nested: { y: 2, z: 1 }, a: 2, b: 1 };
  assert.equal(canonicalizeRfc8785Jcs(a), canonicalizeRfc8785Jcs(b));
  assert.equal(canonicalizeRfc8785Jcs(a), '{"a":2,"b":1,"nested":{"y":2,"z":1}}');
  assert.equal(
    digestCanonicalJson("generation-request-json/v1", a).value,
    digestCanonicalJson("generation-request-json/v1", b).value
  );
});

test("2) array order remains significant", () => {
  assert.notEqual(
    canonicalizeRfc8785Jcs([1, 2, 3]),
    canonicalizeRfc8785Jcs([3, 2, 1])
  );
  assert.equal(canonicalizeRfc8785Jcs([1, 2, 3]), "[1,2,3]");
});

test("3) -0 canonicalizes as 0", () => {
  assert.equal(canonicalizeRfc8785Jcs(-0), "0");
  assert.equal(canonicalizeRfc8785Jcs({ v: -0 }), '{"v":0}');
  assert.equal(
    digestCanonicalJson("generation-request-json/v1", { v: -0 }).value,
    digestCanonicalJson("generation-request-json/v1", { v: 0 }).value
  );
});

test("4) NaN/Infinity/undefined/Date/Map/Set/function/bigint are refused", () => {
  assert.throws(() => canonicalizeRfc8785Jcs(NaN), /non_finite_number/);
  assert.throws(() => canonicalizeRfc8785Jcs(Infinity), /non_finite_number/);
  assert.throws(() => canonicalizeRfc8785Jcs(-Infinity), /non_finite_number/);
  assert.throws(() => canonicalizeRfc8785Jcs(undefined), /undefined_value/);
  assert.throws(() => canonicalizeRfc8785Jcs({ a: undefined }), /undefined_value/);
  assert.throws(() => canonicalizeRfc8785Jcs([undefined]), /undefined_value/);
  assert.throws(() => canonicalizeRfc8785Jcs(new Date()), /non_plain_object/);
  assert.throws(() => canonicalizeRfc8785Jcs(new Map()), /non_plain_object/);
  assert.throws(() => canonicalizeRfc8785Jcs(new Set()), /non_plain_object/);
  assert.throws(() => canonicalizeRfc8785Jcs(new Uint8Array([1])), /non_plain_object/);
  assert.throws(() => canonicalizeRfc8785Jcs(() => 1), /unsupported_function/);
  assert.throws(() => canonicalizeRfc8785Jcs(BigInt(10)), /unsupported_bigint/);
  assert.throws(() => canonicalizeRfc8785Jcs(Symbol("s")), /unsupported_symbol/);
});

// ---------------------------------------------------------------------------
// 5–7: Receipt self-digest
// ---------------------------------------------------------------------------

test("5) receipt self-digest verifies after sealing", () => {
  const receipt = buildSealedReceipt({
    receiptId: "r-1",
    receiptType: "gemini_local_assessment",
    body: { note: "hello", score: 3 },
  });
  assert.deepEqual(verifyReceiptSelfDigest(receipt), { ok: true });
});

test("6) mutating any non-digest field invalidates the self-digest", () => {
  const receipt = buildSealedReceipt({
    receiptId: "r-2",
    receiptType: "gemini_local_assessment",
    body: { note: "hello" },
  });

  const mutatedBody: ContractReceiptV1 = {
    header: receipt.header,
    body: { note: "tampered" },
  };
  assert.equal(verifyReceiptSelfDigest(mutatedBody).ok, false);

  const mutatedHeader: ContractReceiptV1 = {
    header: { ...receipt.header, receiptId: "r-2-x" },
    body: receipt.body,
  };
  assert.equal(verifyReceiptSelfDigest(mutatedHeader).ok, false);

  const mutatedCreatedAt: ContractReceiptV1 = {
    header: { ...receipt.header, createdAtIso: "2000-01-01T00:00:00.000Z" },
    body: receipt.body,
  };
  assert.equal(verifyReceiptSelfDigest(mutatedCreatedAt).ok, false);
});

test("7) self-digest omits only header.receiptDigest, nothing else", () => {
  const receipt = buildSealedReceipt({
    receiptId: "r-3",
    receiptType: "gemini_local_assessment",
    body: { note: "hello", extra: { deep: [1, 2] } },
  });

  // Changing the stored receiptDigest does not change the recomputed digest.
  const spoofed: ContractReceiptV1 = {
    header: {
      ...receipt.header,
      receiptDigest: makeSyntheticDigest(
        "canonical-receipt-payload-json/v1",
        "spoof"
      ),
    },
    body: receipt.body,
  };
  assert.equal(
    computeReceiptDigest(spoofed).value,
    computeReceiptDigest(receipt).value
  );

  // But every OTHER field participates: dropping a body field changes it.
  const droppedField: ContractReceiptV1 = {
    header: receipt.header,
    body: { note: "hello" },
  };
  assert.notEqual(
    computeReceiptDigest(droppedField).value,
    computeReceiptDigest(receipt).value
  );

  // sealReceipt must not mutate the original.
  const before = JSON.stringify(receipt);
  sealReceipt(receipt);
  assert.equal(JSON.stringify(receipt), before);
});

// ---------------------------------------------------------------------------
// 8–9: Field-to-scope bindings
// ---------------------------------------------------------------------------

const CORRECT_FIELD_SCOPES: Array<[EvidenceDigestFieldKey, ContentDigestScopeV1]> =
  [
    ["header.receiptDigest", "canonical-receipt-payload-json/v1"],
    ["receiptReference.receiptDigest", "canonical-receipt-payload-json/v1"],
    ["inputBasis.encodedBytesDigest", "encoded-image-bytes/v1"],
    ["intrinsicToContainerTransformDigest", "render-coordinate-transform-json/v1"],
    ["renderedPromptDigest", "rendered-prompt-text/v1"],
    ["responseSchemaDigest", "response-schema-json/v1"],
    ["effectiveGenerationConfigDigest", "effective-generation-config-json/v1"],
    ["invocationPayloadDigest", "canonical-invocation-payload-json/v1"],
    ["rawResponse.digest", "raw-provider-response-text/v1"],
    ["rawResponse.storageBindingDigest", "storage-binding-json/v1"],
    ["parsedResponseDigest", "canonical-parsed-response-json/v1"],
    ["rawCandidateDigest", "model-candidate-claim-json/v1"],
    ["notesClaimDigest", "model-claim-text/v1"],
    ["risksClaimDigest", "model-claim-text/v1"],
    ["assessmentInputDigest", "canonical-local-assessment-input-json/v1"],
    ["assessmentOutputDigest", "canonical-local-assessment-output-json/v1"],
    ["transferTransformDigest", "coordinate-transfer-transform-json/v1"],
    ["derivativeLineage.parentEncodedBytesDigest", "encoded-image-bytes/v1"],
    ["derivativeLineage.derivativeEncodedBytesDigest", "encoded-image-bytes/v1"],
    ["derivativeLineage.durableStorageBindingDigest", "storage-binding-json/v1"],
    ["generation.requestDigest", "generation-request-json/v1"],
    ["generation.resultDigest", "generation-result-json/v1"],
    ["comparison.inputDigest", "canonical-comparison-input-json/v1"],
    ["comparison.outputDigest", "canonical-comparison-output-json/v1"],
    ["tombstone.originalStorageBindingDigest", "storage-binding-json/v1"],
    ["coordinateTransfer.sourceBasis.encodedBytesDigest", "encoded-image-bytes/v1"],
    [
      "coordinateTransfer.destinationBasis.encodedBytesDigest",
      "encoded-image-bytes/v1",
    ],
  ];

test("8) every required field accepts its correct scope", () => {
  for (const [field, scope] of CORRECT_FIELD_SCOPES) {
    const digest = makeSyntheticDigest(scope, `${field}-seed`);
    assert.deepEqual(
      validateDigestForField(field, digest),
      { ok: true },
      `field ${field} should accept scope ${scope}`
    );
  }

  // Role-dependent tombstone.originalDigest resolves structurally by role.
  assert.equal(
    getRequiredDigestScope("tombstone.originalDigest", {
      affectedArtifactRole: "raw_provider_response",
    }),
    "raw-provider-response-text/v1"
  );
  assert.deepEqual(
    validateDigestForField(
      "tombstone.originalDigest",
      makeSyntheticDigest("canonical-parsed-response-json/v1", "x"),
      { affectedArtifactRole: "parsed_response" }
    ),
    { ok: true }
  );
  // Missing role context is refused, not guessed.
  assert.equal(
    validateDigestForField(
      "tombstone.originalDigest",
      makeSyntheticDigest("raw-provider-response-text/v1", "x")
    ).ok,
    false
  );
});

test("9) wrong-scope substitutions all refuse", () => {
  const swaps: Array<[EvidenceDigestFieldKey, ContentDigestScopeV1]> = [
    // raw candidate <-> notes claim
    ["rawCandidateDigest", "model-claim-text/v1"],
    ["notesClaimDigest", "model-candidate-claim-json/v1"],
    // ordinary render transform <-> transfer transform
    ["intrinsicToContainerTransformDigest", "coordinate-transfer-transform-json/v1"],
    ["transferTransformDigest", "render-coordinate-transform-json/v1"],
    // raw provider response <-> parsed response
    ["rawResponse.digest", "canonical-parsed-response-json/v1"],
    ["parsedResponseDigest", "raw-provider-response-text/v1"],
    // receipt digest <-> image-byte digest
    ["header.receiptDigest", "encoded-image-bytes/v1"],
    ["inputBasis.encodedBytesDigest", "canonical-receipt-payload-json/v1"],
    // generation request <-> generation result
    ["generation.requestDigest", "generation-result-json/v1"],
    ["generation.resultDigest", "generation-request-json/v1"],
  ];
  for (const [field, wrongScope] of swaps) {
    const digest = makeSyntheticDigest(wrongScope, `${field}-wrong`);
    assert.deepEqual(
      validateDigestForField(field, digest),
      { ok: false, reason: "wrong_digest_scope_for_field" },
      `field ${field} must refuse scope ${wrongScope}`
    );
  }

  // A structurally malformed digest value (not 64 lowercase hex chars)
  // refuses. NOTE: this is malformed-syntax detection, NOT cryptographic
  // wrong-content detection. validateDigestForField validates digest STRUCTURE
  // and the required field-to-scope binding only; it is never given source
  // content and never recomputes a hash. Content recomputation is the job of
  // verifyReceiptSelfDigest (see test 10 and the dedicated test below).
  assert.deepEqual(
    validateDigestForField("renderedPromptDigest", {
      algorithm: "sha256",
      encoding: "hex",
      scope: "rendered-prompt-text/v1",
      value: "not-64-lowercase-hex-chars",
    }),
    { ok: false, reason: "malformed_content_digest" }
  );
  // missing required digest refuses.
  assert.deepEqual(validateDigestForField("renderedPromptDigest", null), {
    ok: false,
    reason: "missing_required_digest",
  });
});

test("9b) validateDigestForField checks structure/binding, not source content", () => {
  // Any well-formed digest with the correct scope is accepted regardless of
  // whether its 64-hex value actually corresponds to any real content. This
  // makes the structure-only contract explicit: no content is supplied here,
  // so no cryptographic verification is possible or claimed.
  const fabricatedButWellFormed = {
    algorithm: "sha256" as const,
    encoding: "hex" as const,
    scope: "rendered-prompt-text/v1" as const,
    value: "a".repeat(64),
  };
  assert.deepEqual(
    validateDigestForField("renderedPromptDigest", fabricatedButWellFormed),
    { ok: true }
  );

  // By contrast, verifyReceiptSelfDigest recomputes the enclosing receipt
  // digest against the actual receipt payload, so a fabricated (wrong-content)
  // receiptDigest of the correct scope is rejected.
  const sealed = buildSealedReceipt({
    receiptId: "content-check",
    receiptType: "gemini_local_assessment",
    body: { note: "real payload" },
  });
  const wrongContentDigest: ContractReceiptV1 = {
    header: {
      ...sealed.header,
      receiptDigest: makeSyntheticDigest(
        "canonical-receipt-payload-json/v1",
        "unrelated-content"
      ),
    },
    body: sealed.body,
  };
  assert.deepEqual(verifyReceiptSelfDigest(wrongContentDigest), {
    ok: false,
    reason: "receipt_self_digest_mismatch",
  });
});

test("10) notes<->risks swap invalidates the self-digest despite shared scope", () => {
  const notes = makeSyntheticDigest("model-claim-text/v1", "notes-claim");
  const risks = makeSyntheticDigest("model-claim-text/v1", "risks-claim");

  const receipt = buildSealedReceipt({
    receiptId: "assess-1",
    receiptType: "gemini_local_assessment",
    body: { notesClaimDigest: notes, risksClaimDigest: risks },
  });
  assert.deepEqual(verifyReceiptSelfDigest(receipt), { ok: true });

  // Both digests carry the SAME scope, so field validation cannot see the swap.
  assert.deepEqual(validateDigestForField("notesClaimDigest", risks), {
    ok: true,
  });

  // The self-digest binds them positionally, so swapping breaks it.
  const swapped: ContractReceiptV1 = {
    header: receipt.header,
    body: { notesClaimDigest: risks, risksClaimDigest: notes },
  };
  assert.equal(verifyReceiptSelfDigest(swapped).ok, false);
});

// ---------------------------------------------------------------------------
// 11–22: Retry-chain integrity
// ---------------------------------------------------------------------------

test("11) valid initial invocation validates", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-initial",
    identity: initialIdentity(),
    preflight: PASSED_PREFLIGHT,
  });
  assert.deepEqual(validateReceiptSet([initial]), { ok: true });
});

test("12) initial -> provider retry -> second provider retry validates", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-0",
    identity: initialIdentity({ providerAttemptId: "attempt-0" }),
    preflight: PASSED_PREFLIGHT,
  });
  const retry1 = buildInvocationReceipt({
    receiptId: "inv-1",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  const retry2 = buildInvocationReceipt({
    receiptId: "inv-2",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-2",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-1",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(retry1),
  });
  assert.deepEqual(validateReceiptSet([initial, retry1, retry2]), { ok: true });
});

test("13) operator rerun validates as a new logical invocation", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-a",
    identity: initialIdentity({ logicalInvocationId: "lid-A" }),
    preflight: PASSED_PREFLIGHT,
  });
  const rerun = buildInvocationReceipt({
    receiptId: "inv-b",
    identity: {
      logicalInvocationId: "lid-B",
      requestId: "req-2",
      providerAttemptId: "attempt-0",
      relationship: "operator_rerun",
      retryOfProviderAttemptId: null,
    },
    preflight: PASSED_PREFLIGHT,
  });
  assert.deepEqual(validateReceiptSet([initial, rerun]), { ok: true });
});

test("14) preflight refusal validates without a provider response", () => {
  const refusal = buildInvocationReceipt({
    receiptId: "inv-refused",
    identity: initialIdentity({
      providerAttemptId: null,
      relationship: "initial",
    }),
    preflight: {
      status: "refused",
      outboundCallStatus: "not_sent",
      refusalReasons: ["policy_precondition_failed"],
    },
  });
  assert.deepEqual(validateReceiptSet([refusal]), { ok: true });
});

test("15) retry self-reference refuses via the self-reference guard", () => {
  // The self-reference is present in the body BEFORE sealing, so the receipt
  // seals to a fully valid self-digest. Failure therefore comes from the
  // provider_retry self-reference guard, not from a self-digest mismatch.
  const selfRef = buildInvocationReceipt({
    receiptId: "inv-self",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: {
      receiptId: "inv-self",
      receiptType: "gemini_invocation",
      receiptDigest: makeSyntheticDigest(
        "canonical-receipt-payload-json/v1",
        "self"
      ),
    },
  });
  // The receipt is genuinely self-digest-valid; the failure is the guard.
  assert.deepEqual(verifyReceiptSelfDigest(selfRef), { ok: true });
  assert.deepEqual(validateReceiptSet([selfRef]), {
    ok: false,
    reason: "provider_retry_self_reference",
  });
});

test("16) retry cycle refuses", () => {
  const a = buildInvocationReceipt({
    receiptId: "cyc-a",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-a",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-b",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: {
      receiptId: "cyc-b",
      receiptType: "gemini_invocation",
      receiptDigest: makeSyntheticDigest(
        "canonical-receipt-payload-json/v1",
        "b"
      ),
    },
  });
  const b = buildInvocationReceipt({
    receiptId: "cyc-b",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-b",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-a",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: {
      receiptId: "cyc-a",
      receiptType: "gemini_invocation",
      receiptDigest: makeSyntheticDigest(
        "canonical-receipt-payload-json/v1",
        "a"
      ),
    },
  });
  assert.deepEqual(validateReceiptSet([a, b]), {
    ok: false,
    reason: "retry_reference_cycle",
  });
});

test("17) cross-logical-invocation retry reference refuses", () => {
  const foreign = buildInvocationReceipt({
    receiptId: "inv-foreign",
    identity: initialIdentity({
      logicalInvocationId: "lid-OTHER",
      providerAttemptId: "attempt-0",
    }),
    preflight: PASSED_PREFLIGHT,
  });
  const retry = buildInvocationReceipt({
    receiptId: "inv-retry",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(foreign),
  });
  assert.deepEqual(validateReceiptSet([foreign, retry]), {
    ok: false,
    reason: "cross_logical_invocation_reference",
  });
});

test("18) wrong prior attempt ID refuses", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-0",
    identity: initialIdentity({ providerAttemptId: "attempt-0" }),
    preflight: PASSED_PREFLIGHT,
  });
  const retry = buildInvocationReceipt({
    receiptId: "inv-1",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-WRONG",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  assert.deepEqual(validateReceiptSet([initial, retry]), {
    ok: false,
    reason: "wrong_prior_attempt_id",
  });
});

test("19) retry chained off a preflight refusal refuses with wrong_prior_attempt_id", () => {
  // A fully self-digest-valid preflight refusal always has providerAttemptId
  // null (invariant enforced by validatePreflightConsistency). A provider
  // retry must carry a non-null retryOfProviderAttemptId, so the prior-attempt
  // match (prior.providerAttemptId === retryOfProviderAttemptId) can never
  // hold. Under the present invariant ordering the retry is therefore refused
  // at wrong_prior_attempt_id.
  //
  // The later referenced_receipt_preflight_not_passed and
  // referenced_receipt_no_outbound_call checks are retained as defense in
  // depth, but they are UNREACHABLE for a self-digest-valid preflight refusal
  // because the null providerAttemptId trips the attempt-id check first.
  const refusal = buildInvocationReceipt({
    receiptId: "inv-refused",
    identity: initialIdentity({
      providerAttemptId: null,
      relationship: "initial",
    }),
    preflight: {
      status: "refused",
      outboundCallStatus: "not_sent",
      refusalReasons: ["policy_precondition_failed"],
    },
  });
  const retry = buildInvocationReceipt({
    receiptId: "inv-retry",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(refusal),
  });
  assert.deepEqual(validateReceiptSet([refusal, retry]), {
    ok: false,
    reason: "wrong_prior_attempt_id",
  });
});

test("20) retry with non-receipt reference digest scope refuses", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-0",
    identity: initialIdentity({ providerAttemptId: "attempt-0" }),
    preflight: PASSED_PREFLIGHT,
  });
  const retry = buildInvocationReceipt({
    receiptId: "inv-1",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: {
      receiptId: "inv-0",
      receiptType: "gemini_invocation",
      // Wrong scope: not a canonical-receipt-payload-json/v1 digest.
      receiptDigest: makeSyntheticDigest(
        "raw-provider-response-text/v1",
        "bad"
      ) as never,
    },
  });
  assert.equal(validateReceiptSet([initial, retry]).ok, false);
});

test("21) forked retry chain refuses via store-level uniqueness", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-0",
    identity: initialIdentity({ providerAttemptId: "attempt-0" }),
    preflight: PASSED_PREFLIGHT,
  });
  const retryA = buildInvocationReceipt({
    receiptId: "inv-1a",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1a",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  const retryB = buildInvocationReceipt({
    receiptId: "inv-1b",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1b",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  assert.deepEqual(validateReceiptSet([initial, retryA, retryB]), {
    ok: false,
    reason: "forked_invocation_lineage",
  });
});

test("22) usage-accounting-shaped object cannot substitute for a reference", () => {
  const initial = buildInvocationReceipt({
    receiptId: "inv-0",
    identity: initialIdentity({ providerAttemptId: "attempt-0" }),
    preflight: PASSED_PREFLIGHT,
  });
  const byId = new Map([[initial.header.receiptId, initial]]);
  const usageRow = {
    requestId: "req-1",
    promptTokenCount: 1200,
    candidatesTokenCount: 340,
    totalTokenCount: 1540,
    model: "gemini-x",
  };
  assert.deepEqual(
    validateReceiptReference(usageRow, {
      receiptsById: byId,
      expectedType: "gemini_invocation",
    }),
    { ok: false, reason: "invalid_reference_shape" }
  );
});

// ---------------------------------------------------------------------------
// 23–25: Coordinate-transfer transform
// ---------------------------------------------------------------------------

test("23) a correctly scoped coordinate-transfer transform validates", () => {
  const transform = buildCoordinateTransferTransform();
  assert.deepEqual(validateCoordinateTransferTransform(transform), { ok: true });

  const digest = digestCanonicalJson(
    "coordinate-transfer-transform-json/v1",
    transform
  );
  assert.deepEqual(validateDigestForField("transferTransformDigest", digest), {
    ok: true,
  });

  // aspect_rescaled remains valid and diagnostic-only.
  const rescaled = buildCoordinateTransferTransform({
    compatibility: { status: "aspect_rescaled", compatibilityPolicyVersion: "c/v1" },
  });
  assert.deepEqual(validateCoordinateTransferTransform(rescaled), { ok: true });
});

test("24) transfer transform carrying an ordinary render-transform scope refuses", () => {
  const transform = buildCoordinateTransferTransform();
  const wrongScopeDigest = digestCanonicalJson(
    "render-coordinate-transform-json/v1",
    transform
  );
  assert.deepEqual(
    validateDigestForField("transferTransformDigest", wrongScopeDigest),
    { ok: false, reason: "wrong_digest_scope_for_field" }
  );
});

test("25) transfer source/destination byte digests must use encoded-image-bytes/v1", () => {
  const badSource = buildCoordinateTransferTransform({
    sourceBasis: {
      encodedBytesDigest: makeSyntheticDigest(
        "storage-binding-json/v1",
        "wrong"
      ),
      intrinsicSize: { width: 10, height: 10 },
      frameSize: { width: 10, height: 10 },
    },
  });
  assert.equal(validateCoordinateTransferTransform(badSource).ok, false);
});

// ---------------------------------------------------------------------------
// 26–27: Tombstone / retention replay refusal
// ---------------------------------------------------------------------------

test("26) tombstoned raw response is never replayable", () => {
  const tombstoned: RawResponseBindingV1 = {
    digest: makeSyntheticDigest("raw-provider-response-text/v1", "raw"),
    storageBindingDigest: makeSyntheticDigest("storage-binding-json/v1", "bind"),
    retentionState: "tombstoned",
  };
  assert.deepEqual(attemptRawResponseReplay(tombstoned), {
    ok: false,
    reason: "raw_response_tombstoned_replay_refused",
  });

  const tombstoneBody: RetentionTombstoneBodyV1 = {
    affectedArtifactRole: "raw_provider_response",
    tombstonedReceiptRef: {
      receiptId: "prov-1",
      receiptType: "gemini_provider_response",
      receiptDigest: makeSyntheticDigest(
        "canonical-receipt-payload-json/v1",
        "prov"
      ),
    },
    originalDigest: makeSyntheticDigest("raw-provider-response-text/v1", "raw"),
    originalStorageBindingDigest: makeSyntheticDigest(
      "storage-binding-json/v1",
      "bind"
    ),
    retentionState: "tombstoned",
    recoverablePayloadPresent: false,
  };
  assert.deepEqual(validateRetentionTombstone(tombstoneBody), { ok: true });
});

test("27) digest-only raw response is never re-parseable", () => {
  const digestOnly: RawResponseBindingV1 = {
    digest: makeSyntheticDigest("raw-provider-response-text/v1", "raw"),
    storageBindingDigest: makeSyntheticDigest("storage-binding-json/v1", "bind"),
    retentionState: "digest_only",
  };
  assert.deepEqual(attemptRawResponseReparse(digestOnly), {
    ok: false,
    reason: "raw_response_digest_only_not_reparseable",
  });
});

// ---------------------------------------------------------------------------
// 28–29: Zero authority
// ---------------------------------------------------------------------------

test("28) every fixture receipt passes zero-authority validation", () => {
  const fixtures: ContractReceiptV1[] = [
    buildSealedReceipt({
      receiptId: "z-1",
      receiptType: "gemini_invocation",
      body: { identity: initialIdentity(), preflight: PASSED_PREFLIGHT, priorInvocationReceipt: null },
    }),
    buildSealedReceipt({
      receiptId: "z-2",
      receiptType: "gemini_local_assessment",
      body: { note: "n" },
    }),
    buildSealedReceipt({
      receiptId: "z-3",
      receiptType: "evidence_retention_tombstone",
      body: { retentionState: "tombstoned" },
    }),
  ];
  for (const receipt of fixtures) {
    assert.deepEqual(validateZeroAuthority(receipt), { ok: true });
  }
});

test("29) injecting a forbidden authority-like field into a body refuses", () => {
  for (const key of [
    "applyCamera",
    "calibrationAuthorityGranted",
    "calibratedCameraEligible",
    "preserveCalibration",
  ]) {
    const receipt = buildSealedReceipt({
      receiptId: `bad-${key}`,
      receiptType: "gemini_local_assessment",
      body: { nested: { [key]: true } },
    });
    assert.deepEqual(validateZeroAuthority(receipt), {
      ok: false,
      reason: `forbidden_authority_field:${key}`,
    });
  }

  // A non-zero authority block also refuses.
  const tampered = buildSealedReceipt({
    receiptId: "auth-tamper",
    receiptType: "gemini_local_assessment",
    body: { note: "n" },
  });
  const withAuthority: ContractReceiptV1 = {
    header: {
      ...tampered.header,
      authority: {
        ...tampered.header.authority,
        mutationPermission: "granted" as never,
      },
    },
    body: tampered.body,
  };
  assert.deepEqual(validateZeroAuthority(withAuthority), {
    ok: false,
    reason: "non_zero_authority",
  });
});

// ---------------------------------------------------------------------------
// 30: Scope-containment self-check
// ---------------------------------------------------------------------------

test("30) the contract module imports none of the forbidden modules", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-contract.ts", import.meta.url),
    "utf8"
  );
  const forbiddenImportFragments = [
    "app/api/",
    "lib/vibodeGemini",
    "@supabase/",
    'from "next/',
    'from "next"',
    'from "react"',
    'from "react/',
    'from "fs"',
    'from "node:fs"',
  ];
  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line) || /\brequire\(/.test(line));
  const joined = importLines.join("\n");
  for (const fragment of forbiddenImportFragments) {
    assert.equal(
      joined.includes(fragment),
      false,
      `module must not import ${fragment}`
    );
  }
  // Sanity: the only permitted external import is node:crypto.
  assert.equal(joined.includes("node:crypto"), true);
});

// ---------------------------------------------------------------------------
// 31–34: Fail-closed field-key and receipt-set hardening
// ---------------------------------------------------------------------------

test('31) unknown field key "constructor" refuses (own-property-safe)', () => {
  // "constructor" lives on Object.prototype; a prototype-chain lookup would
  // have resolved it to a function. Own-property access refuses it.
  assert.throws(
    () => getRequiredDigestScope("constructor" as never),
    /unknown_field/
  );
  assert.deepEqual(
    validateDigestForField(
      "constructor" as never,
      makeSyntheticDigest("rendered-prompt-text/v1", "x")
    ),
    { ok: false, reason: "digest_field_binding:unknown_field" }
  );
});

test('32) unknown field key "__proto__" refuses (own-property-safe)', () => {
  assert.throws(
    () => getRequiredDigestScope("__proto__" as never),
    /unknown_field/
  );
  assert.deepEqual(
    validateDigestForField(
      "__proto__" as never,
      makeSyntheticDigest("rendered-prompt-text/v1", "x")
    ),
    { ok: false, reason: "digest_field_binding:unknown_field" }
  );
});

test("33) unknown receipt type refuses in validateReceiptSet", () => {
  const bogus = buildSealedReceipt({
    receiptId: "bogus-type",
    receiptType: "not_a_receipt_type" as never,
    body: { note: "n" },
  });
  // Sealed to a valid self-digest, so failure is specifically the type check.
  assert.deepEqual(verifyReceiptSelfDigest(bogus), { ok: true });
  assert.deepEqual(validateReceiptSet([bogus]), {
    ok: false,
    reason: "unknown_receipt_type",
  });
});

test("34) wrong-type prior reference inside validateReceiptSet refuses", () => {
  const priorAssessment = buildSealedReceipt({
    receiptId: "prior-assess",
    receiptType: "gemini_local_assessment",
    body: { note: "n" },
  });
  const retry = buildInvocationReceipt({
    receiptId: "inv-retry",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: {
      receiptId: "prior-assess",
      // Not a gemini_invocation: the prior reference type is wrong.
      receiptType: "gemini_local_assessment",
      receiptDigest: priorAssessment.header.receiptDigest,
    } as never,
  });
  assert.deepEqual(validateReceiptSet([priorAssessment, retry]), {
    ok: false,
    reason: "wrong_reference_type",
  });
});
