// GER-W3C.1 — Deterministic tests for the pure `gemini_provider_response`
// receipt/envelope builder.
//
// Every test is pure/local:
//   * the invocation receipt is built with fixed literal seeds through the
//     frozen producer identity + invocation builders,
//   * the raw provider-response BYTE digest is a fixed, independently computed
//     SHA-256 hex (modeling the exact value handed over from GER-W3C.0),
//   * the pinned storage-binding digest is re-derived independently with the
//     frozen kernel canonicalization + hash, and
//   * closed-profile / retention / no-text refusals are proven by tampering a
//     re-sealed canonical receipt and parsing it back through the frozen W1
//     adapter.
//
// No current time, randomness, env, network, DB, Supabase, Gemini, storage,
// or route execution occurs here. node:crypto is used ONLY to independently
// recompute fixed digest expectations; node:fs is used ONLY for the
// deterministic implementation-source containment self-check.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalizeRfc8785Jcs,
  sealReceipt,
  sha256HexUtf8,
  validateReceiptSet,
  type ContractReceiptV1,
} from "./gemini-evidence-contract";
import {
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  parseGeminiEvidenceWireEnvelopeV1,
} from "./gemini-evidence-wire";
import {
  buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1,
  buildGeminiEvidenceProducerIdentityV1,
  prepareDetectVisionGeminiEvidenceProviderResponseEnvelopeV1,
  GER_W3C1_NOT_STORED_STORAGE_BINDING_PAYLOAD_V1,
  GER_W3C1_PROVIDER_RESPONSE_RECEIPT_ID_PREFIX,
} from "./gemini-evidence-producer-receipts";

// ---------------------------------------------------------------------------
// Deterministic fixtures (fixed literals only)
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-07-09T00:00:00.000Z";
const PROVIDER_RESPONSE_SEED = "provresp-seed-1";

/** A fixed 64-char lowercase SHA-256 hex modeling the W3C.0 byte digest. */
const RAW_BYTE_DIGEST = createHash("sha256")
  .update(Buffer.from("fixture raw provider response bytes\n", "utf8"))
  .digest("hex");

const HELPER_SOURCE = readFileSync(
  new URL("./gemini-evidence-producer-receipts.ts", import.meta.url),
  "utf8"
);

const IDENTIFIER_PATTERN = /^[\x21-\x7e]+$/;

function buildValidInvocation(): ContractReceiptV1 {
  const identity = buildGeminiEvidenceProducerIdentityV1({
    relationship: "initial",
    requestId: "req-fixture-w3c1",
    createdAtIso: CREATED_AT,
    entropy: {
      receiptSeed: "inv-receipt-seed-1",
      logicalSeed: "inv-logical-seed-1",
      attemptSeed: "inv-attempt-seed-1",
    },
  });
  assert.equal(identity.ok, true);
  if (!identity.ok) throw new Error("unreachable: identity build failed");

  const built = buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1({
    identity: identity.value,
    outboundCallStatus: "provider_call_started",
  });
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("unreachable: invocation build failed");
  return built.receipt;
}

function buildProviderResponse(overrides?: {
  invocationReceipt?: unknown;
  rawResponseBytesSha256Hex?: unknown;
  rawResponseByteLength?: number;
  receiptSeed?: string;
  createdAtIso?: string;
}) {
  return prepareDetectVisionGeminiEvidenceProviderResponseEnvelopeV1({
    invocationReceipt: (overrides && "invocationReceipt" in overrides
      ? overrides.invocationReceipt
      : buildValidInvocation()) as ContractReceiptV1,
    rawResponseBytesSha256Hex: (overrides &&
    "rawResponseBytesSha256Hex" in overrides
      ? overrides.rawResponseBytesSha256Hex
      : RAW_BYTE_DIGEST) as string,
    rawResponseByteLength: overrides?.rawResponseByteLength,
    receiptSeed: overrides?.receiptSeed ?? PROVIDER_RESPONSE_SEED,
    createdAtIso: overrides?.createdAtIso ?? CREATED_AT,
  });
}

/** Deep-clone a built receipt, mutate its body, then re-seal a valid digest. */
function tamperAndReseal(
  receipt: ContractReceiptV1,
  mutate: (body: Record<string, unknown>) => void
): ContractReceiptV1 {
  const cloned = structuredClone(receipt);
  mutate(cloned.body as Record<string, unknown>);
  return sealReceipt(cloned);
}

// ===========================================================================
// 1) Happy path
// ===========================================================================

test("1: happy path builds a linked, digest-only provider_response receipt", () => {
  const invocation = buildValidInvocation();
  const result = prepareDetectVisionGeminiEvidenceProviderResponseEnvelopeV1({
    invocationReceipt: invocation,
    rawResponseBytesSha256Hex: RAW_BYTE_DIGEST,
    receiptSeed: PROVIDER_RESPONSE_SEED,
    createdAtIso: CREATED_AT,
  });

  assert.equal(result.status, "built");
  if (result.status !== "built") return;

  // receiptType is gemini_provider_response.
  assert.equal(result.receipt.header.receiptType, "gemini_provider_response");
  assert.equal(
    result.envelope.projection.receiptType,
    "gemini_provider_response"
  );

  const body = result.receipt.body as {
    invocationRef: {
      receiptId: string;
      receiptType: string;
      receiptDigest: { value: string; scope: string };
    };
    rawResponse: {
      digest: { scope: string; value: string };
      storageBindingDigest: { scope: string; value: string };
      retentionState: string;
      text?: unknown;
    };
  };

  // invocationRef points to the invocation receipt.
  assert.equal(body.invocationRef.receiptType, "gemini_invocation");
  assert.equal(body.invocationRef.receiptId, invocation.header.receiptId);
  assert.equal(
    body.invocationRef.receiptDigest.value,
    invocation.header.receiptDigest.value
  );

  // raw digest scope + value.
  assert.equal(body.rawResponse.digest.scope, "raw-provider-response-text/v1");
  assert.equal(body.rawResponse.digest.value, RAW_BYTE_DIGEST);

  // storage-binding digest scope + retention state.
  assert.equal(
    body.rawResponse.storageBindingDigest.scope,
    "storage-binding-json/v1"
  );
  assert.equal(body.rawResponse.retentionState, "digest_only");

  // text is absent (no own property at all).
  assert.equal(
    Object.hasOwn(body.rawResponse, "text"),
    false,
    "rawResponse.text must be absent"
  );

  // W1 parse succeeds.
  const parsed = parseGeminiEvidenceWireEnvelopeV1(result.envelope);
  assert.equal(parsed.ok, true);

  // validateReceiptSet([invocation, providerResponse]) succeeds.
  const set = validateReceiptSet([invocation, result.receipt]);
  assert.equal(set.ok, true);
});

// ===========================================================================
// 2) Storage-binding digest is pinned
// ===========================================================================

test("2: storage-binding digest equals SHA-256 of the pinned canonical JSON", () => {
  const expectedCanonical = canonicalizeRfc8785Jcs({
    artifactRole: "raw_provider_response",
    kind: "not_stored",
    schemaVersion: "vibode-storage-binding/v1",
  });
  const expectedDigest = sha256HexUtf8(expectedCanonical);

  // The exported pinned payload is exactly the decision-#3 object.
  assert.deepEqual(GER_W3C1_NOT_STORED_STORAGE_BINDING_PAYLOAD_V1, {
    artifactRole: "raw_provider_response",
    kind: "not_stored",
    schemaVersion: "vibode-storage-binding/v1",
  });

  const result = buildProviderResponse();
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const body = result.receipt.body as {
    rawResponse: { storageBindingDigest: { value: string } };
  };
  assert.equal(body.rawResponse.storageBindingDigest.value, expectedDigest);

  // Changing ANY field changes the digest.
  const mutated = [
    { artifactRole: "parsed_response", kind: "not_stored", schemaVersion: "vibode-storage-binding/v1" },
    { artifactRole: "raw_provider_response", kind: "stored", schemaVersion: "vibode-storage-binding/v1" },
    { artifactRole: "raw_provider_response", kind: "not_stored", schemaVersion: "vibode-storage-binding/v2" },
    { artifactRole: "raw_provider_response", kind: "not_stored", schemaVersion: "vibode-storage-binding/v1", extra: 1 },
  ];
  for (const payload of mutated) {
    const digest = sha256HexUtf8(canonicalizeRfc8785Jcs(payload));
    assert.notEqual(
      digest,
      expectedDigest,
      `changed payload must change the digest: ${JSON.stringify(payload)}`
    );
  }
});

// ===========================================================================
// 3) Wrong invocation input refuses (stable reasons)
// ===========================================================================

test("3: non-invocation receipt refuses with wrong_type", () => {
  // Feed a built provider_response receipt back in as the invocation.
  const seed = buildProviderResponse();
  assert.equal(seed.status, "built");
  if (seed.status !== "built") return;
  const result = buildProviderResponse({ invocationReceipt: seed.receipt });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.reason, "provider_response_invocation_wrong_type");
  }
});

test("3: malformed invocation receipt refuses", () => {
  // Correct type token but no valid self-digest / structure.
  const malformed = { header: { receiptType: "gemini_invocation" }, body: {} };
  const result = buildProviderResponse({ invocationReceipt: malformed });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.match(result.reason, /^provider_response_invocation_malformed/);
  }
});

test("3: no header at all refuses as malformed", () => {
  const result = buildProviderResponse({ invocationReceipt: { body: {} } });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.reason, "provider_response_invocation_malformed");
  }
});

test("3: missing invocation receipt refuses", () => {
  for (const missing of [null, undefined]) {
    const result = buildProviderResponse({ invocationReceipt: missing });
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.equal(result.reason, "provider_response_invocation_missing");
    }
  }
});

test("3: structurally-invalid invocation (re-sealed) refuses as invalid", () => {
  const invocation = buildValidInvocation();
  // Break identity coherence, then re-seal so the failure is a kernel-set
  // failure (not a self-digest failure).
  const broken = tamperAndReseal(invocation, (body) => {
    (body.identity as Record<string, unknown>).relationship = "provider_retry";
  });
  const result = buildProviderResponse({ invocationReceipt: broken });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.match(result.reason, /^provider_response_invocation_invalid:/);
  }
});

// ===========================================================================
// 4) Raw digest validation (no silent normalization)
// ===========================================================================

test("4: raw digest must be a lowercase 64-hex string (else refuse)", () => {
  const bad: unknown[] = [
    123, // non-string
    RAW_BYTE_DIGEST.slice(0, 63), // wrong length (short)
    RAW_BYTE_DIGEST + "a", // wrong length (long)
    RAW_BYTE_DIGEST.toUpperCase(), // uppercase hex (never normalized)
    "g".repeat(64), // non-hex
    "", // empty
  ];
  for (const value of bad) {
    const result = buildProviderResponse({ rawResponseBytesSha256Hex: value });
    assert.equal(result.status, "error", `expected refusal for ${String(value)}`);
    if (result.status === "error") {
      assert.equal(result.reason, "provider_response_invalid_raw_digest");
    }
  }
});

test("4: valid lowercase digest is embedded verbatim (not normalized)", () => {
  const result = buildProviderResponse();
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const body = result.receipt.body as {
    rawResponse: { digest: { value: string } };
  };
  assert.equal(body.rawResponse.digest.value, RAW_BYTE_DIGEST);
});

// ===========================================================================
// 5) Receipt ID grammar (hostile seeds)
// ===========================================================================

test("5: empty seed refuses", () => {
  const result = buildProviderResponse({ receiptSeed: "" });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.reason, "provider_response_receipt_id:invalid_seed");
  }
});

test("5: very long seed refuses (exceeds identifier length bound)", () => {
  const result = buildProviderResponse({ receiptSeed: "a".repeat(300) });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(
      result.reason,
      "provider_response_receipt_id:invalid_identifier"
    );
  }
});

test("5: control/non-ASCII seed is safely slugged into a grammar-safe id", () => {
  const result = buildProviderResponse({
    receiptSeed: "seed \u0000\u00ff\ttab",
  });
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const id = result.receipt.header.receiptId;
  assert.ok(
    id.startsWith(GER_W3C1_PROVIDER_RESPONSE_RECEIPT_ID_PREFIX),
    "id must carry the provider_response prefix"
  );
  assert.match(id, IDENTIFIER_PATTERN, "minted id must be printable ASCII");
});

test("5: reserved sentinel seed can never mint the reserved sentinel id", () => {
  const result = buildProviderResponse({
    receiptSeed: GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  });
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const id = result.receipt.header.receiptId;
  assert.notEqual(id, GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL);
  assert.ok(id.startsWith(GER_W3C1_PROVIDER_RESPONSE_RECEIPT_ID_PREFIX));
  // The built envelope still parses (a valid grammar-safe id).
  const parsed = parseGeminiEvidenceWireEnvelopeV1(result.envelope);
  assert.equal(parsed.ok, true);
});

// ===========================================================================
// 6) No raw text / retained-state cannot be produced
// ===========================================================================

test("6: builder never emits rawResponse.text and never retains", () => {
  const result = buildProviderResponse();
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const raw = (result.receipt.body as { rawResponse: Record<string, unknown> })
    .rawResponse;
  assert.equal(Object.hasOwn(raw, "text"), false);
  assert.equal(raw.retentionState, "digest_only");
});

test("6: W1 refuses a tampered provider_response carrying rawResponse.text", () => {
  const result = buildProviderResponse();
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const tampered = tamperAndReseal(result.receipt, (body) => {
    (body.rawResponse as Record<string, unknown>).text = "smuggled raw text";
  });
  const parsed = parseGeminiEvidenceWireEnvelopeV1({
    wireSchemaVersion: "gemini-evidence-wire/v1",
    canonicalReceipt: canonicalizeRfc8785Jcs(tampered),
    projection: result.envelope.projection,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.reason, "wire_raw_response_text_present");
  }
});

test("6: W1 refuses a tampered provider_response with retained retentionState", () => {
  const result = buildProviderResponse();
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  const tampered = tamperAndReseal(result.receipt, (body) => {
    (body.rawResponse as Record<string, unknown>).retentionState = "retained";
  });
  const parsed = parseGeminiEvidenceWireEnvelopeV1({
    wireSchemaVersion: "gemini-evidence-wire/v1",
    canonicalReceipt: canonicalizeRfc8785Jcs(tampered),
    projection: result.envelope.projection,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.reason, "wire_raw_response_retained");
  }
});

// ===========================================================================
// 7) Closed profile: forbidden fields are refused by W1
// ===========================================================================

test("7: W1 refuses tampered forbidden top-level body fields", () => {
  const forbidden = [
    "httpStatus",
    "model",
    "headers",
    "providerAttemptId",
    "logicalInvocationId",
    "metadata",
  ];
  for (const field of forbidden) {
    const result = buildProviderResponse();
    assert.equal(result.status, "built");
    if (result.status !== "built") continue;
    const tampered = tamperAndReseal(result.receipt, (body) => {
      body[field] = "x";
    });
    const parsed = parseGeminiEvidenceWireEnvelopeV1({
      wireSchemaVersion: "gemini-evidence-wire/v1",
      canonicalReceipt: canonicalizeRfc8785Jcs(tampered),
      projection: result.envelope.projection,
    });
    assert.equal(parsed.ok, false, `field ${field} must be refused`);
    if (!parsed.ok) {
      assert.equal(parsed.reason, `wire_unknown_body_field:${field}`);
    }
  }
});

// ===========================================================================
// 8) Source containment
// ===========================================================================

test("8: helper source performs no env/time/randomness/IO/persistence", () => {
  for (const fragment of [
    "process.env",
    "Date.now",
    "new Date(",
    "Math.random",
    "randomUUID",
    "node:crypto",
    'from "crypto"',
    "node:fs",
    'from "fs"',
    "@supabase/supabase-js",
    "@supabase/ssr",
    "gemini-evidence-receipt-ledger",
    "vibodeGeminiAutoFloorDetection",
    "next/server",
    "app/api/",
    "detect-vision/route",
    "route.ts",
    ".insert(",
    ".upsert(",
    ".upload(",
    "fetch(",
    "console.",
  ]) {
    assert.equal(
      HELPER_SOURCE.includes(fragment),
      false,
      `helper must not reference ${fragment}`
    );
  }
});
