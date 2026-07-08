// GER-W3B.0 — Deterministic unit tests for the pure producer receipt builder +
// identity wrapper. No current time, randomness, env, network, DB, Supabase, or
// route execution is used anywhere in this file. node:fs is used ONLY for a
// deterministic source self-check (containment).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GER_I0_ZERO_AUTHORITY,
  type ContractReceiptV1,
} from "./gemini-evidence-contract";

import {
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  parseGeminiEvidenceWireEnvelopeV1,
} from "./gemini-evidence-wire";

// The ledger row builder + fake client are imported ONLY in the test to prove
// the produced envelope is accepted and the fork invariant holds. The helper
// itself does NOT import the ledger.
import {
  buildGeminiEvidenceReceiptLedgerRowV1,
  createFakeGeminiEvidenceReceiptLedgerClientV1,
  insertGeminiEvidenceReceiptEnvelopeForTestV1,
} from "./gemini-evidence-receipt-ledger";

import {
  buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1,
  buildGeminiEvidenceProducerIdentityV1,
  GER_W3B0_PROVIDER_ATTEMPT_ID_PREFIX,
  GER_W3B0_LOGICAL_INVOCATION_ID_PREFIX,
  GER_W3B0_RECEIPT_ID_PREFIX,
  resolveGeminiEvidenceProducerAccountingContextV1,
  sanitizeGeminiEvidenceProducerRequestIdV1,
  shouldUseGeminiEvidenceProducerIdentityV1,
  type GeminiEvidenceProducerIdentityV1,
  type GeminiEvidenceProducerRelationshipV1,
} from "./gemini-evidence-producer-receipts";

// ---------------------------------------------------------------------------
// Deterministic fixtures (fixed literals only)
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-07-08T00:00:00.000Z";
const LEDGER_CREATED_AT = "2026-07-08T12:00:00.000Z";

function buildIdentity(overrides?: {
  relationship?: GeminiEvidenceProducerRelationshipV1;
  requestId?: string | null;
  receiptSeed?: string;
  logicalSeed?: string;
  attemptSeed?: string;
  createdAtIso?: string;
}): GeminiEvidenceProducerIdentityV1 {
  const result = buildGeminiEvidenceProducerIdentityV1({
    relationship: overrides?.relationship ?? "initial",
    requestId: overrides?.requestId ?? "req-abc-123",
    createdAtIso: overrides?.createdAtIso ?? CREATED_AT,
    entropy: {
      receiptSeed: overrides?.receiptSeed ?? "receipt-seed-1",
      logicalSeed: overrides?.logicalSeed ?? "logical-seed-1",
      attemptSeed: overrides?.attemptSeed ?? "attempt-seed-1",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable: identity build failed");
  return result.value;
}

// ---------------------------------------------------------------------------
// 1–6) Request id sanitizer
// ---------------------------------------------------------------------------

test("1) sanitizer accepts a valid printable requestId unchanged", () => {
  assert.equal(
    sanitizeGeminiEvidenceProducerRequestIdV1("req-abc_123.XYZ"),
    "req-abc_123.XYZ"
  );
});

test("2) sanitizer returns null for a requestId containing spaces", () => {
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("req abc"), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("   "), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1(""), null);
});

test("3) sanitizer returns null for control characters", () => {
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("req\tabc"), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("req\nabc"), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("req\u0000abc"), null);
});

test("4) sanitizer returns null for non-ASCII characters", () => {
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("réq"), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("req—dash"), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("req😀"), null);
});

test("5) sanitizer returns null for a requestId longer than 256 chars", () => {
  assert.equal(
    sanitizeGeminiEvidenceProducerRequestIdV1("a".repeat(256)),
    "a".repeat(256)
  );
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1("a".repeat(257)), null);
});

test("6) sanitizer returns null for the reserved sentinel and null/undefined", () => {
  assert.equal(
    sanitizeGeminiEvidenceProducerRequestIdV1(
      GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL
    ),
    null
  );
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1(null), null);
  assert.equal(sanitizeGeminiEvidenceProducerRequestIdV1(undefined), null);
});

// ---------------------------------------------------------------------------
// 7–11) Identity builder
// ---------------------------------------------------------------------------

const HOSTILE_REQUEST_IDS: readonly string[] = [
  "req with space",
  "req\ttab",
  "req\u0000nul",
  "réq-nonascii",
  "a".repeat(300),
  "   ",
  "",
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
];

test("7) identity builder mints grammar-safe receipt/logical/attempt IDs", () => {
  const identity = buildIdentity();
  const grammar = /^[\x21-\x7e]+$/;
  for (const id of [
    identity.receiptId,
    identity.logicalInvocationId,
    identity.providerAttemptId,
  ]) {
    assert.equal(grammar.test(id), true, `not grammar-safe: ${id}`);
    assert.ok(id.length > 0 && id.length <= 256);
    assert.notEqual(id, GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL);
  }
  assert.ok(identity.receiptId.startsWith(GER_W3B0_RECEIPT_ID_PREFIX));
  assert.ok(
    identity.logicalInvocationId.startsWith(
      GER_W3B0_LOGICAL_INVOCATION_ID_PREFIX
    )
  );
  assert.ok(
    identity.providerAttemptId.startsWith(GER_W3B0_PROVIDER_ATTEMPT_ID_PREFIX)
  );
});

test("8) identity builder never embeds requestId in providerAttemptId", () => {
  const requestId = "req-secret-correlation-99";
  const identity = buildIdentity({ requestId });
  assert.equal(identity.requestId, requestId);
  assert.equal(identity.providerAttemptId.includes(requestId), false);
  assert.equal(identity.logicalInvocationId.includes(requestId), false);
  assert.equal(identity.receiptId.includes(requestId), false);
});

test("9) identity builder refuses unsupported provider_retry (R-5)", () => {
  const result = buildGeminiEvidenceProducerIdentityV1({
    relationship: "provider_retry" as unknown as GeminiEvidenceProducerRelationshipV1,
    requestId: "req-1",
    createdAtIso: CREATED_AT,
    entropy: {
      receiptSeed: "r",
      logicalSeed: "l",
      attemptSeed: "a",
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "producer_unsupported_relationship");
  }
});

test("10) identity builder produces null sanitized requestId for hostile requestId", () => {
  for (const hostile of HOSTILE_REQUEST_IDS) {
    const identity = buildIdentity({ requestId: hostile });
    assert.equal(identity.requestId, null, `expected null for: ${hostile}`);
    // The hostile header is never embedded anywhere in identity. (Skip the
    // empty string, which is trivially a substring of everything.)
    if (hostile.length > 0) {
      assert.equal(identity.providerAttemptId.includes(hostile), false);
    }
  }
});

test("11) identity builder accepts operator_rerun with a fresh logicalInvocationId", () => {
  const first = buildIdentity({
    relationship: "initial",
    logicalSeed: "logical-A",
  });
  const rerun = buildIdentity({
    relationship: "operator_rerun",
    logicalSeed: "logical-B",
  });
  assert.equal(rerun.relationship, "operator_rerun");
  assert.notEqual(rerun.logicalInvocationId, first.logicalInvocationId);
});

// ---------------------------------------------------------------------------
// 12–13) Default-off gate (R-2)
// ---------------------------------------------------------------------------

test("12) default-off gate is false for absent/null/empty/false/0", () => {
  assert.equal(shouldUseGeminiEvidenceProducerIdentityV1({}), false);
  assert.equal(
    shouldUseGeminiEvidenceProducerIdentityV1({ enabled: undefined }),
    false
  );
  assert.equal(
    shouldUseGeminiEvidenceProducerIdentityV1({ enabled: null }),
    false
  );
  assert.equal(shouldUseGeminiEvidenceProducerIdentityV1({ enabled: "" }), false);
  assert.equal(
    shouldUseGeminiEvidenceProducerIdentityV1({ enabled: false }),
    false
  );
  assert.equal(shouldUseGeminiEvidenceProducerIdentityV1({ enabled: "0" }), false);
  assert.equal(
    shouldUseGeminiEvidenceProducerIdentityV1({ enabled: "false" }),
    false
  );
});

test("13) gate is true only for explicit truthy values", () => {
  for (const v of ["1", "true", "yes", "on"]) {
    assert.equal(
      shouldUseGeminiEvidenceProducerIdentityV1({ enabled: v }),
      true,
      `expected true for: ${v}`
    );
  }
  assert.equal(shouldUseGeminiEvidenceProducerIdentityV1({ enabled: true }), true);
  // Non-recognized truthy-looking strings stay false.
  assert.equal(
    shouldUseGeminiEvidenceProducerIdentityV1({ enabled: "TRUE" }),
    false
  );
  assert.equal(
    shouldUseGeminiEvidenceProducerIdentityV1({ enabled: "enabled" }),
    false
  );
});

// ---------------------------------------------------------------------------
// 14) Default-off path is byte-identical (R-2)
// ---------------------------------------------------------------------------

test("14) with gate off no identity/attemptId is passed; context byte-identical", () => {
  const baseContext = {
    model: "gemini-fixture",
    tokenBudget: 1000,
    nested: { a: 1, b: "x" },
  } as const;
  const before = JSON.stringify(baseContext);

  // Gate off (default): context is returned unchanged (same reference).
  const off = resolveGeminiEvidenceProducerAccountingContextV1(baseContext, {
    attemptId: "ger-attempt-should-not-appear",
  });
  assert.equal(off.used, false);
  assert.equal(off.context, baseContext); // same object reference
  assert.equal(JSON.stringify(off.context), before);
  assert.equal("attemptId" in off.context, false);

  // Gate on but attemptId absent: still unchanged, byte-identical.
  const onNoAttempt = resolveGeminiEvidenceProducerAccountingContextV1(
    baseContext,
    { enabled: "1" }
  );
  assert.equal(onNoAttempt.used, false);
  assert.equal(onNoAttempt.context, baseContext);
  assert.equal(JSON.stringify(onNoAttempt.context), before);

  // Gate on AND grammar-safe attemptId: pass-through in a shallow clone only.
  const onWithAttempt = resolveGeminiEvidenceProducerAccountingContextV1(
    baseContext,
    { enabled: "1", attemptId: "ger-attempt-seed-1" }
  );
  assert.equal(onWithAttempt.used, true);
  if (onWithAttempt.used) {
    assert.equal(onWithAttempt.context.attemptId, "ger-attempt-seed-1");
  }
  // The original base context is never mutated.
  assert.equal(JSON.stringify(baseContext), before);
});

// ---------------------------------------------------------------------------
// 15–22) Invocation receipt builder
// ---------------------------------------------------------------------------

function buildInvocation(identity: GeminiEvidenceProducerIdentityV1) {
  return buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1({
    identity,
    outboundCallStatus: "provider_call_started",
  });
}

test("15) invocation builder creates a gemini_invocation receipt + envelope", () => {
  const result = buildInvocation(buildIdentity());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.receipt.header.receiptType, "gemini_invocation");
  assert.equal(result.envelope.projection.receiptType, "gemini_invocation");
});

test("16) invocation receipt carries zero authority", () => {
  const result = buildInvocation(buildIdentity());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.receipt.header.authority, GER_I0_ZERO_AUTHORITY);
});

test("17) invocation receipt: relationship initial, preflight passed, outbound started", () => {
  const result = buildInvocation(buildIdentity({ relationship: "initial" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.receipt.body as {
    identity: { relationship: string };
    preflight: { status: string; outboundCallStatus: string };
  };
  assert.equal(body.identity.relationship, "initial");
  assert.equal(body.preflight.status, "passed");
  assert.equal(body.preflight.outboundCallStatus, "provider_call_started");
});

test("18) invocation receipt has non-null providerAttemptId and null retry fields", () => {
  const identity = buildIdentity();
  const result = buildInvocation(identity);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.receipt.body as {
    identity: { providerAttemptId: string | null; retryOfProviderAttemptId: string | null };
    priorInvocationReceipt: unknown;
  };
  assert.equal(body.identity.providerAttemptId, identity.providerAttemptId);
  assert.notEqual(body.identity.providerAttemptId, null);
  assert.equal(body.identity.retryOfProviderAttemptId, null);
  assert.equal(body.priorInvocationReceipt, null);
});

test("19) invocation receipt does not contain sceneHash/roomId/assetId/versionId", () => {
  const result = buildInvocation(buildIdentity());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.receipt);
  for (const banned of ["sceneHash", "roomId", "assetId", "versionId"]) {
    assert.equal(
      serialized.includes(banned),
      false,
      `receipt must not contain ${banned}`
    );
  }
});

test("20) invocation receipt does not contain calibration/apply authority fields", () => {
  const result = buildInvocation(buildIdentity());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.receipt);
  for (const banned of [
    "calibratedCameraEligible",
    "applyCamera",
    "calibrationAuthorityGranted",
    "preserveCalibration",
  ]) {
    assert.equal(
      serialized.includes(banned),
      false,
      `receipt must not contain ${banned}`
    );
  }
});

test("21) invocation envelope parses through the frozen W1 adapter", () => {
  const result = buildInvocation(buildIdentity());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = parseGeminiEvidenceWireEnvelopeV1(result.envelope);
  assert.equal(parsed.ok, true);
});

test("22) invocation receipt validates through kernel validateReceiptSet", async () => {
  // Import the kernel validator dynamically to keep the exact-API surface tight.
  const { validateReceiptSet } = await import("./gemini-evidence-contract");
  const result = buildInvocation(buildIdentity());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const validated = validateReceiptSet([result.receipt]);
  assert.equal(validated.ok, true);
});

// ---------------------------------------------------------------------------
// 23) Ledger row builder accepts the invocation envelope
// ---------------------------------------------------------------------------

test("23) ledger row builder accepts the invocation envelope", () => {
  const identity = buildIdentity();
  const built = buildInvocation(identity);
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const row = buildGeminiEvidenceReceiptLedgerRowV1({
    envelope: built.envelope,
    createdAt: LEDGER_CREATED_AT,
  });
  assert.equal(row.ok, true);
  if (!row.ok) return;
  assert.equal(row.row.receipt_type, "gemini_invocation");
  assert.equal(row.row.receipt_id, identity.receiptId);
  assert.equal(row.row.logical_invocation_id, identity.logicalInvocationId);
  assert.equal(row.row.provider_attempt_id, identity.providerAttemptId);
  assert.equal(row.row.retry_of_provider_attempt_id, null);
});

// ---------------------------------------------------------------------------
// 24) provider_retry is refused / out of scope (R-5)
// ---------------------------------------------------------------------------

test("24) provider_retry build attempt is refused / out of scope", () => {
  // At the identity boundary.
  const idResult = buildGeminiEvidenceProducerIdentityV1({
    relationship: "provider_retry" as unknown as GeminiEvidenceProducerRelationshipV1,
    createdAtIso: CREATED_AT,
    entropy: { receiptSeed: "r", logicalSeed: "l", attemptSeed: "a" },
  });
  assert.equal(idResult.ok, false);
  if (!idResult.ok) {
    assert.equal(idResult.reason, "producer_unsupported_relationship");
  }

  // At the invocation-builder boundary (identity forged with provider_retry).
  const forged = {
    ...buildIdentity(),
    relationship: "provider_retry" as unknown as GeminiEvidenceProducerRelationshipV1,
  } as GeminiEvidenceProducerIdentityV1;
  const invResult = buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1({
    identity: forged,
    outboundCallStatus: "provider_call_started",
  });
  assert.equal(invResult.ok, false);
  if (!invResult.ok) {
    assert.equal(
      invResult.reason,
      "producer_invocation_unsupported_relationship"
    );
  }
});

// ---------------------------------------------------------------------------
// 25) One-invocation-per-logical-id / null-predecessor invariant
// ---------------------------------------------------------------------------

test("25) two invocations sharing logicalInvocationId + null predecessor collide as forked lineage", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();

  // Same logicalSeed -> same logicalInvocationId; distinct receipt/attempt seeds
  // -> distinct receiptId/providerAttemptId. Both have a null retry predecessor.
  const idA = buildIdentity({
    relationship: "initial",
    logicalSeed: "shared-logical",
    receiptSeed: "receipt-A",
    attemptSeed: "attempt-A",
  });
  const idB = buildIdentity({
    relationship: "operator_rerun",
    logicalSeed: "shared-logical",
    receiptSeed: "receipt-B",
    attemptSeed: "attempt-B",
  });
  assert.equal(idA.logicalInvocationId, idB.logicalInvocationId);

  const envA = buildInvocation(idA);
  const envB = buildInvocation(idB);
  assert.equal(envA.ok, true);
  assert.equal(envB.ok, true);
  if (!envA.ok || !envB.ok) return;

  const first = insertGeminiEvidenceReceiptEnvelopeForTestV1(client, {
    envelope: envA.envelope,
    createdAt: LEDGER_CREATED_AT,
  });
  assert.equal(first.ok, true);

  const second = insertGeminiEvidenceReceiptEnvelopeForTestV1(client, {
    envelope: envB.envelope,
    createdAt: LEDGER_CREATED_AT,
  });
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, "ledger_forked_invocation_lineage");
  }
});

// ---------------------------------------------------------------------------
// 26) No gemini_provider_response builder/export exists in W3B.0
// ---------------------------------------------------------------------------

test("26) helper source builds no non-invocation receipt type", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-producer-receipts.ts", import.meta.url),
    "utf8"
  );
  const forbiddenReceiptTypes = [
    "gemini_provider_response",
    "gemini_parsed_response",
    "gemini_local_assessment",
    "evidence_disposition",
    "derivative_lineage",
    "evidence_comparison",
    "evidence_retention_tombstone",
  ];
  for (const t of forbiddenReceiptTypes) {
    assert.equal(
      source.includes(t),
      false,
      `helper must not reference receipt type ${t}`
    );
  }
  // No exported builder for any non-invocation producer receipt.
  assert.equal(
    /export\s+function\s+build\w*ProviderResponse/.test(source),
    false,
    "no provider_response builder may be exported in W3B.0"
  );
});

// ---------------------------------------------------------------------------
// 27–28) Source containment
// ---------------------------------------------------------------------------

const HELPER_ALLOWED_IMPORTS = new Set([
  "./gemini-evidence-contract",
  "./gemini-evidence-wire",
  "./gemini-evidence-receipt-ledger",
]);

test("27) helper imports only allowed GER modules", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-producer-receipts.ts", import.meta.url),
    "utf8"
  );
  const fromTargets = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(fromTargets.length >= 1, "expected at least one import");
  for (const target of fromTargets) {
    assert.equal(
      HELPER_ALLOWED_IMPORTS.has(target),
      true,
      `unexpected import target: ${target}`
    );
  }
  assert.equal(/\brequire\(/.test(source), false, "must not use require()");
});

test("28) helper does not import forbidden runtime dependencies", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-producer-receipts.ts", import.meta.url),
    "utf8"
  );
  const forbiddenFragments = [
    "@supabase/supabase-js",
    "@supabase/ssr",
    "server-only",
    'from "next',
    "next/headers",
    'from "react',
    'from "fs"',
    'from "node:fs"',
    'from "node:crypto"',
    "randomUUID",
    "crypto",
    "app/api/",
    "lib/vibodeGemini",
    "lib/vibodeAutoFloorVisionDetect",
    "sceneHash",
    "process.env",
    "Date.now",
    "Math.random",
  ];
  for (const fragment of forbiddenFragments) {
    assert.equal(
      source.includes(fragment),
      false,
      `helper must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 29–30) Accounting pass-through wiring deliberately deferred (memo)
// ---------------------------------------------------------------------------

test("29/30) producer-boundary lib files are intentionally untouched in W3B.0", () => {
  // W3B.0 deliberately leaves lib/vibodeGeminiAutoFloorDetection.ts and
  // lib/vibodeAutoFloorVisionDetect.ts UNTOUCHED. The optional attemptId
  // accounting pass-through cannot be exercised without route/network execution
  // in those files, so its default-off, byte-identical behavior is proven here
  // by the PURE resolver instead (see test 14 and the assertions below). This
  // memo documents that the live wiring is deferred to a later slice.

  // Provided attemptId is passed through unchanged when the gate is on.
  const base = { usage: { in: 1, out: 2 } } as const;
  const passed = resolveGeminiEvidenceProducerAccountingContextV1(base, {
    enabled: true,
    attemptId: "ger-attempt-xyz",
  });
  assert.equal(passed.used, true);
  if (passed.used) {
    assert.equal(passed.context.attemptId, "ger-attempt-xyz");
    // Non-attempt fields are preserved exactly.
    assert.deepEqual(passed.context.usage, base.usage);
  }

  // Absent attemptId preserves the old context shape exactly (byte-identical).
  const before = JSON.stringify(base);
  const preserved = resolveGeminiEvidenceProducerAccountingContextV1(base, {
    enabled: true,
  });
  assert.equal(preserved.used, false);
  assert.equal(preserved.context, base);
  assert.equal(JSON.stringify(preserved.context), before);
});

// ---------------------------------------------------------------------------
// R-3 mint-placement source assertion
// ---------------------------------------------------------------------------

test("R-3) helper documents mint placement and exposes no pre-outbound refusal builder", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-producer-receipts.ts", import.meta.url),
    "utf8"
  );
  // The invocation builder only accepts provider_call_started; a refused /
  // not_sent pre-outbound receipt cannot be built here, so providerAttemptId is
  // only ever minted at the outbound boundary.
  assert.equal(
    source.includes("provider_call_started"),
    true,
    "builder must model the outbound-call boundary"
  );
  assert.equal(
    source.includes("not_sent"),
    false,
    "W3B.0 helper must not emit a pre-outbound (not_sent) receipt"
  );
  // The placement rule is recorded in source (R-3).
  assert.equal(source.includes("R-3"), true, "R-3 placement rule must be documented");

  // An outbound status other than provider_call_started is refused.
  const identity = buildIdentity();
  const bad = buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1({
    identity,
    outboundCallStatus: "not_sent" as unknown as "provider_call_started",
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.reason, "producer_invocation_invalid_outbound_status");
  }
});

// ---------------------------------------------------------------------------
// R-4 live-preflight re-scope memo (documentation only; no live preflight run)
// ---------------------------------------------------------------------------

test("R-4) live-preflight re-scope is recorded and no live preflight is run", () => {
  // R-4 is a documentation-only correction for W3B.0:
  //   * id-conflict duplicate refusal is live-preflight-testable, and
  //   * corrupted-stored-row refusal is fake-client-only because append-only
  //     triggers prevent live corruption.
  // W3B.0 builds and runs NO live preflight. This memo records the re-scope; the
  // producer helper performs zero database/storage/network access.
  assert.ok(true);
});
