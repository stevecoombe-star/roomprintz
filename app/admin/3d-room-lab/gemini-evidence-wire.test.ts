import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCoordinateTransferTransform,
  buildInvocationReceipt,
  buildSealedReceipt,
  canonicalizeRfc8785Jcs,
  makeSyntheticDigest,
  sealReceipt,
  type ContentDigestScopeV1,
  type ContractReceiptV1,
  type GeminiEvidenceReceiptTypeV1,
  type InvocationIdentityV1,
  type InvocationPreflightV1,
} from "./gemini-evidence-contract";

import {
  GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION,
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  parseGeminiEvidenceWireEnvelopeV1,
  parseGeminiEvidenceWireTextV1,
  projectGeminiEvidenceReceiptV1,
  toGeminiEvidenceWireEnvelopeV1,
  type GeminiEvidenceWireEnvelopeV1,
} from "./gemini-evidence-wire";

// ---------------------------------------------------------------------------
// Deterministic fixture helpers (fixed literals only; no time/random/env/fs)
// ---------------------------------------------------------------------------

const PASSED_PREFLIGHT: InvocationPreflightV1 = {
  status: "passed",
  outboundCallStatus: "provider_call_started",
  refusalReasons: [],
};

function d(scope: ContentDigestScopeV1, seed: string) {
  return makeSyntheticDigest(scope, seed);
}

function ref<T extends GeminiEvidenceReceiptTypeV1>(
  receiptId: string,
  receiptType: T,
  seed: string
): { receiptId: string; receiptType: T; receiptDigest: ReturnType<typeof d> } {
  return {
    receiptId,
    receiptType,
    receiptDigest: d("canonical-receipt-payload-json/v1", seed),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function reseal(receipt: unknown): ContractReceiptV1 {
  return sealReceipt(receipt as ContractReceiptV1);
}

function rawEnvelope(rawReceipt: unknown): GeminiEvidenceWireEnvelopeV1 {
  return {
    wireSchemaVersion: GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION,
    canonicalReceipt: canonicalizeRfc8785Jcs(rawReceipt),
    // Structural-refusal fixtures fail before projection is examined, so a
    // placeholder projection is intentional and never reached.
    projection: {} as never,
  };
}

function expectRefusal(
  result: { ok: boolean; reason?: string },
  reason: string
) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
}

// ---------------------------------------------------------------------------
// Valid fixtures for all eight receipt types
// ---------------------------------------------------------------------------

function validInvocationInitial(): ContractReceiptV1 {
  return buildInvocationReceipt({
    receiptId: "inv-1",
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-0",
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    preflight: PASSED_PREFLIGHT,
  });
}

function validInvocationRefusal(): ContractReceiptV1 {
  return buildInvocationReceipt({
    receiptId: "inv-refused",
    identity: {
      logicalInvocationId: "lid-2",
      requestId: "req-2",
      providerAttemptId: null,
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    preflight: {
      status: "refused",
      outboundCallStatus: "not_sent",
      refusalReasons: ["policy_precondition_failed"],
    },
  });
}

function validInvocationProviderRetry(): ContractReceiptV1 {
  return buildInvocationReceipt({
    receiptId: "inv-retry",
    identity: {
      logicalInvocationId: "lid-3",
      requestId: "req-3",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: "attempt-0",
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: ref("inv-prior", "gemini_invocation", "prior"),
  });
}

function validProviderResponse(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "prov-1",
    receiptType: "gemini_provider_response",
    body: {
      invocationRef: ref("inv-1", "gemini_invocation", "inv"),
      rawResponse: {
        digest: d("raw-provider-response-text/v1", "raw"),
        storageBindingDigest: d("storage-binding-json/v1", "bind"),
        retentionState: "digest_only",
      },
    },
  });
}

function validParsedResponse(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "parsed-1",
    receiptType: "gemini_parsed_response",
    body: {
      providerResponseRef: ref("prov-1", "gemini_provider_response", "prov"),
      parsedResponseDigest: d("canonical-parsed-response-json/v1", "parsed"),
      rawCandidateDigest: d("model-candidate-claim-json/v1", "cand"),
    },
  });
}

function validLocalAssessment(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "assess-1",
    receiptType: "gemini_local_assessment",
    body: {
      parsedResponseRef: ref("parsed-1", "gemini_parsed_response", "parsed"),
      assessmentInputDigest: d(
        "canonical-local-assessment-input-json/v1",
        "in"
      ),
      assessmentOutputDigest: d(
        "canonical-local-assessment-output-json/v1",
        "out"
      ),
      notesClaimDigest: d("model-claim-text/v1", "notes"),
      risksClaimDigest: d("model-claim-text/v1", "risks"),
    },
  });
}

function validDerivativeLineage(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "deriv-1",
    receiptType: "derivative_lineage",
    body: {
      derivativeLineage: {
        parentEncodedBytesDigest: d("encoded-image-bytes/v1", "parent"),
        derivativeEncodedBytesDigest: d("encoded-image-bytes/v1", "deriv"),
        durableStorageBindingDigest: d("storage-binding-json/v1", "store"),
      },
      transferTransform: buildCoordinateTransferTransform(),
      transferTransformDigest: d(
        "coordinate-transfer-transform-json/v1",
        "xfer"
      ),
    },
  });
}

function validComparison(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "cmp-1",
    receiptType: "evidence_comparison",
    body: {
      leftRef: ref("assess-a", "gemini_local_assessment", "a"),
      rightRef: ref("assess-b", "gemini_local_assessment", "b"),
      comparison: {
        inputDigest: d("canonical-comparison-input-json/v1", "cin"),
        outputDigest: d("canonical-comparison-output-json/v1", "cout"),
      },
    },
  });
}

function validDisposition(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "disp-1",
    receiptType: "evidence_disposition",
    body: {
      subjectRef: ref("parsed-1", "gemini_parsed_response", "s"),
      assessmentRef: ref("assess-1", "gemini_local_assessment", "as"),
      disposition: "accepted",
    },
  });
}

function validTombstone(): ContractReceiptV1 {
  return buildSealedReceipt({
    receiptId: "tomb-1",
    receiptType: "evidence_retention_tombstone",
    body: {
      affectedArtifactRole: "raw_provider_response",
      tombstonedReceiptRef: ref(
        "prov-1",
        "gemini_provider_response",
        "prov"
      ),
      originalDigest: d("raw-provider-response-text/v1", "orig"),
      originalStorageBindingDigest: d("storage-binding-json/v1", "origbind"),
      retentionState: "tombstoned",
      recoverablePayloadPresent: false,
    },
  });
}

const ALL_VALID_FIXTURES: Array<[string, () => ContractReceiptV1]> = [
  ["gemini_invocation", validInvocationInitial],
  ["gemini_provider_response", validProviderResponse],
  ["gemini_parsed_response", validParsedResponse],
  ["gemini_local_assessment", validLocalAssessment],
  ["derivative_lineage", validDerivativeLineage],
  ["evidence_comparison", validComparison],
  ["evidence_disposition", validDisposition],
  ["evidence_retention_tombstone", validTombstone],
];

// ---------------------------------------------------------------------------
// 1–5: Positive round-trips
// ---------------------------------------------------------------------------

test("1) valid canonical invocation becomes a wire envelope and round-trips", () => {
  const receipt = validInvocationInitial();
  const envelope = toGeminiEvidenceWireEnvelopeV1(receipt);
  assert.equal(envelope.wireSchemaVersion, "gemini-evidence-wire/v1");
  assert.equal(envelope.canonicalReceipt, canonicalizeRfc8785Jcs(receipt));

  const parsed = parseGeminiEvidenceWireEnvelopeV1(envelope);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.receipt, receipt);
    assert.equal(parsed.value.canonicalReceipt, envelope.canonicalReceipt);
    assert.deepEqual(
      parsed.value.projection,
      projectGeminiEvidenceReceiptV1(receipt)
    );
  }

  const viaText = parseGeminiEvidenceWireTextV1(JSON.stringify(envelope));
  assert.equal(viaText.ok, true);
});

test("2) valid preflight refusal invocation round-trips", () => {
  const receipt = validInvocationRefusal();
  const parsed = parseGeminiEvidenceWireEnvelopeV1(
    toGeminiEvidenceWireEnvelopeV1(receipt)
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.projection.providerAttemptId, null);
    assert.deepEqual(parsed.receipt, receipt);
  }
});

test("3) valid provider-retry invocation round-trips without claiming prior target existence", () => {
  const receipt = validInvocationProviderRetry();
  const parsed = parseGeminiEvidenceWireEnvelopeV1(
    toGeminiEvidenceWireEnvelopeV1(receipt)
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.projection.retryOfProviderAttemptId, "attempt-0");
    assert.equal(parsed.value.projection.providerAttemptId, "attempt-1");
  }
});

test("4) valid tombstone receipt round-trips", () => {
  const receipt = validTombstone();
  const parsed = parseGeminiEvidenceWireEnvelopeV1(
    toGeminiEvidenceWireEnvelopeV1(receipt)
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.projection.logicalInvocationId, null);
    assert.deepEqual(parsed.receipt, receipt);
  }
});

test("5) every one of the eight receipt types has an accepted strict-profile fixture", () => {
  for (const [label, factory] of ALL_VALID_FIXTURES) {
    const receipt = factory();
    const parsed = parseGeminiEvidenceWireEnvelopeV1(
      toGeminiEvidenceWireEnvelopeV1(receipt)
    );
    assert.equal(parsed.ok, true, `${label} should be accepted`);
    if (parsed.ok) assert.deepEqual(parsed.receipt, receipt, label);
  }
});

// ---------------------------------------------------------------------------
// 6–9: Canonical-boundary / JSON refusals
// ---------------------------------------------------------------------------

test("6) non-canonical canonicalReceipt with reordered keys refuses", () => {
  const envelope: GeminiEvidenceWireEnvelopeV1 = {
    wireSchemaVersion: "gemini-evidence-wire/v1",
    canonicalReceipt: '{"b":2,"a":1}',
    projection: {} as never,
  };
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(envelope),
    "wire_noncanonical_receipt_text"
  );
});

test("7) canonicalReceipt with leading/trailing whitespace refuses", () => {
  const canonical = canonicalizeRfc8785Jcs(validLocalAssessment());
  const envelope: GeminiEvidenceWireEnvelopeV1 = {
    wireSchemaVersion: "gemini-evidence-wire/v1",
    canonicalReceipt: `  ${canonical}\n`,
    projection: {} as never,
  };
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(envelope),
    "wire_noncanonical_receipt_text"
  );
});

test("8) duplicate JSON key representation refuses through fixed-point failure", () => {
  const envelope: GeminiEvidenceWireEnvelopeV1 = {
    wireSchemaVersion: "gemini-evidence-wire/v1",
    canonicalReceipt: '{"a":1,"a":2}',
    projection: {} as never,
  };
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(envelope),
    "wire_noncanonical_receipt_text"
  );
});

test("9) invalid JSON refuses", () => {
  expectRefusal(
    parseGeminiEvidenceWireTextV1("not valid json{"),
    "wire_invalid_json"
  );
});

// ---------------------------------------------------------------------------
// 10–17: Unknown-field / unknown-type refusals
// ---------------------------------------------------------------------------

test("10) unknown envelope key refuses", () => {
  const envelope = toGeminiEvidenceWireEnvelopeV1(validLocalAssessment());
  const tampered = { ...envelope, extra: 1 } as unknown;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(tampered),
    "wire_unknown_envelope_field:extra"
  );
});

test("11) unknown root receipt key refuses", () => {
  const raw = clone(validLocalAssessment()) as Record<string, unknown>;
  raw.extra = 1;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(raw)),
    "wire_unknown_receipt_field:extra"
  );
});

test("12) unknown header key refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header as Record<string, unknown>).extra = 1;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_unknown_header_field:extra"
  );
});

test("13) unknown producer key refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header.producer as Record<string, unknown>).extra = 1;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_unknown_producer_field:extra"
  );
});

test("14) unknown authority key refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header.authority as Record<string, unknown>).extra = "x";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_unknown_authority_field:extra"
  );
});

test("15) unknown body key refuses for every receipt type", () => {
  for (const [label, factory] of ALL_VALID_FIXTURES) {
    const raw = clone(factory());
    (raw.body as Record<string, unknown>).wireExtra = 1;
    expectRefusal(
      parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
      "wire_unknown_body_field:wireExtra"
    );
    void label;
  }
});

test("16) unknown nested digest key refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.body.notesClaimDigest as Record<string, unknown>).z = 1;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_unknown_digest_field:notesClaimDigest:z"
  );
});

test("17) unknown receipt type refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header as Record<string, unknown>).receiptType = "not_a_receipt_type";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_unknown_receipt_type"
  );
});

// ---------------------------------------------------------------------------
// 18–22: Scope / digest / authority refusals
// ---------------------------------------------------------------------------

test("18) unknown digest scope refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.body.notesClaimDigest as Record<string, unknown>).scope =
    "not-a-real-scope/v1";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_invalid_digest:notesClaimDigest:malformed_content_digest"
  );
});

test("19) receipt self-digest tamper refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header.receiptDigest as Record<string, unknown>).value = "1".repeat(64);
  // Deliberately NOT resealed: the stored digest stays well-formed but wrong.
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(raw)),
    "wire_receipt_self_digest:receipt_self_digest_mismatch"
  );
});

test("20) non-zero authority refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header.authority as Record<string, unknown>).mutationPermission =
    "granted";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_zero_authority:non_zero_authority"
  );
});

test("21) forbidden authority-like body field refuses recursively", () => {
  const raw = clone(validLocalAssessment());
  (raw.body as Record<string, unknown>).nested = {
    deeper: { calibratedCameraEligible: true },
  };
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_zero_authority:forbidden_authority_field:calibratedCameraEligible"
  );
});

test("22) receipt-reference digest scope other than canonical-receipt-payload-json/v1 refuses", () => {
  const raw = clone(validProviderResponse());
  (raw.body.invocationRef as { receiptDigest: Record<string, unknown> }).receiptDigest =
    d("raw-provider-response-text/v1", "wrong") as unknown as Record<
      string,
      unknown
    >;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_invalid_digest:receiptReference.receiptDigest:wrong_digest_scope_for_field"
  );
});

// ---------------------------------------------------------------------------
// 23–26: Projection refusals
// ---------------------------------------------------------------------------

test("23) projection receipt ID/type/schema/digest/scope tampering refuses", () => {
  const cases: Array<[string, unknown]> = [
    ["receiptId", "different-id"],
    ["receiptType", "gemini_invocation"],
    ["receiptSchemaVersion", "other-schema"],
    ["receiptDigestHex", "a".repeat(64)],
    ["receiptDigestScope", "storage-binding-json/v1"],
  ];
  for (const [field, value] of cases) {
    const envelope = clone(
      toGeminiEvidenceWireEnvelopeV1(validLocalAssessment())
    );
    (envelope.projection as Record<string, unknown>)[field] = value;
    expectRefusal(
      parseGeminiEvidenceWireEnvelopeV1(envelope),
      `wire_projection_mismatch:${field}`
    );
  }
});

test("24) projection timestamp tampering refuses", () => {
  const envelope = clone(
    toGeminiEvidenceWireEnvelopeV1(validLocalAssessment())
  );
  envelope.projection.receiptCreatedAtIso = "2000-01-01T00:00:00.000Z";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(envelope),
    "wire_projection_mismatch:receiptCreatedAtIso"
  );
});

test("25) projection invocation identity tampering refuses", () => {
  const envelope = clone(
    toGeminiEvidenceWireEnvelopeV1(validInvocationInitial())
  );
  envelope.projection.providerAttemptId = "tampered-attempt";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(envelope),
    "wire_projection_mismatch:providerAttemptId"
  );
});

test("26) non-invocation receipt with non-null invocation projections refuses", () => {
  const envelope = clone(
    toGeminiEvidenceWireEnvelopeV1(validLocalAssessment())
  );
  envelope.projection.logicalInvocationId = "sneaky-lid";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(envelope),
    "wire_projection_mismatch:logicalInvocationId"
  );
});

// ---------------------------------------------------------------------------
// 27–28: Identifier grammar + reserved sentinel
// ---------------------------------------------------------------------------

test("27) malformed identifier refuses", () => {
  const raw = clone(validLocalAssessment());
  (raw.header as Record<string, unknown>).receiptId = "has space";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_invalid_identifier"
  );
});

test("28) reserved W2 sentinel refuses in every applicable identifier field", () => {
  // receiptId
  const withReceiptId = buildInvocationReceipt({
    receiptId: GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
    identity: {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-0",
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    preflight: PASSED_PREFLIGHT,
  });
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(withReceiptId)),
    "wire_reserved_identifier"
  );

  const identityCases: InvocationIdentityV1[] = [
    {
      logicalInvocationId: GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
      requestId: "req-1",
      providerAttemptId: "attempt-0",
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    {
      logicalInvocationId: "lid-1",
      requestId: GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
      providerAttemptId: "attempt-0",
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    {
      logicalInvocationId: "lid-1",
      requestId: "req-1",
      providerAttemptId: "attempt-1",
      relationship: "provider_retry",
      retryOfProviderAttemptId: GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
    },
  ];
  for (const identity of identityCases) {
    const receipt = buildInvocationReceipt({
      receiptId: "inv-sentinel",
      identity,
      preflight: PASSED_PREFLIGHT,
      priorInvocationReceipt:
        identity.relationship === "provider_retry"
          ? ref("inv-prior", "gemini_invocation", "p")
          : null,
    });
    expectRefusal(
      parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(receipt)),
      "wire_reserved_identifier"
    );
  }
});

// ---------------------------------------------------------------------------
// 29–33: Raw-response retention handling
// ---------------------------------------------------------------------------

test("29) rawResponse.retentionState = retained refuses", () => {
  const raw = clone(validProviderResponse());
  (raw.body.rawResponse as Record<string, unknown>).retentionState =
    "retained";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_raw_response_retained"
  );
});

test("30) a fourth discarded retention value refuses", () => {
  const raw = clone(validProviderResponse());
  (raw.body.rawResponse as Record<string, unknown>).retentionState =
    "discarded";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_invalid_raw_response_retention_state:discarded"
  );
});

test("31) absent rawResponse is accepted as discarded-without-binding", () => {
  const receipt = buildSealedReceipt({
    receiptId: "prov-empty",
    receiptType: "gemini_provider_response",
    body: {
      invocationRef: ref("inv-1", "gemini_invocation", "inv"),
    },
  });
  const parsed = parseGeminiEvidenceWireEnvelopeV1(
    toGeminiEvidenceWireEnvelopeV1(receipt)
  );
  assert.equal(parsed.ok, true);
});

test("32) digest_only raw response with non-null text refuses", () => {
  const raw = clone(validProviderResponse());
  (raw.body.rawResponse as Record<string, unknown>).text = "leaked bytes";
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_raw_response_text_present"
  );
});

test("33) digest_only raw response with wrong digest scope refuses", () => {
  const raw = clone(validProviderResponse());
  (raw.body.rawResponse as { digest: Record<string, unknown> }).digest =
    d("canonical-parsed-response-json/v1", "wrong") as unknown as Record<
      string,
      unknown
    >;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_invalid_digest:rawResponse.digest:wrong_digest_scope_for_field"
  );
});

// ---------------------------------------------------------------------------
// 34–35: Coordinate transfer + tombstone semantics
// ---------------------------------------------------------------------------

test("34) coordinate transfer with ordinary render-transform scope refuses", () => {
  const raw = clone(validDerivativeLineage());
  (raw.body as { transferTransformDigest: Record<string, unknown> }).transferTransformDigest =
    d("render-coordinate-transform-json/v1", "wrong") as unknown as Record<
      string,
      unknown
    >;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_invalid_digest:transferTransformDigest:wrong_digest_scope_for_field"
  );
});

test("35) tombstone role/digest mismatch refuses", () => {
  const raw = clone(validTombstone());
  // role raw_provider_response requires raw-provider-response-text/v1, but the
  // original digest carries a parsed-response scope: the frozen tombstone
  // validator refuses the mismatch.
  (raw.body as { originalDigest: Record<string, unknown> }).originalDigest =
    d("canonical-parsed-response-json/v1", "mismatch") as unknown as Record<
      string,
      unknown
    >;
  expectRefusal(
    parseGeminiEvidenceWireEnvelopeV1(rawEnvelope(reseal(raw))),
    "wire_tombstone:original_digest:wrong_digest_scope_for_field"
  );
});

// ---------------------------------------------------------------------------
// 36: Scope-containment self-check
// ---------------------------------------------------------------------------

test("36) the wire adapter imports only the GER-I0 kernel and no prohibited dependency", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-wire.ts", import.meta.url),
    "utf8"
  );

  const fromTargets = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(fromTargets.length >= 1, "expected at least one import");
  for (const target of fromTargets) {
    assert.equal(
      target,
      "./gemini-evidence-contract",
      `unexpected import target: ${target}`
    );
  }

  assert.equal(/\brequire\(/.test(source), false, "must not use require()");

  const forbiddenFragments = [
    "app/api/",
    "lib/vibodeGemini",
    "lib/sceneHash",
    "@supabase/",
    'from "next',
    'from "react',
    'from "fs"',
    'from "node:fs"',
    'from "node:crypto"',
  ];
  for (const fragment of forbiddenFragments) {
    assert.equal(
      source.includes(fragment),
      false,
      `module must not reference ${fragment}`
    );
  }
});
