// GER-W3B.3 — Deterministic tests for the default-off, non-persistent
// detect-vision route-adjacent invocation envelope construction slice.
//
// Two kinds of proof, both pure:
//   * direct unit tests of the pure preparation helper
//     `prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1` (built with fixed
//     literal seeds, then re-checked through the frozen W1 adapter, the frozen
//     kernel validator, and the W2 ledger row-builder), and
//   * deterministic source-order / containment assertions on the detect-vision
//     route proving the construction is minted-only, pre-Gemini, fail-closed,
//     non-persistent, and never returns/logs the canonical payload.
//
// No current time, randomness, env mutation, network, DB, Supabase, Gemini, or
// route execution occurs anywhere in this file. node:fs is used ONLY for the
// deterministic route source self-check.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateReceiptSet } from "./gemini-evidence-contract";
import { parseGeminiEvidenceWireEnvelopeV1 } from "./gemini-evidence-wire";
import { buildGeminiEvidenceReceiptLedgerRowV1 } from "./gemini-evidence-receipt-ledger";

import {
  buildGeminiEvidenceProducerIdentityV1,
  prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1,
  type GeminiEvidenceProducerIdentityV1,
  type GeminiEvidenceProducerRelationshipV1,
} from "./gemini-evidence-producer-receipts";

// ---------------------------------------------------------------------------
// Deterministic fixtures (fixed literals only)
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-07-08T00:00:00.000Z";
const LEDGER_CREATED_AT = "2026-07-08T12:00:00.000Z";
const REQUEST_ID = "req-fixture-123";
const SEEDS = {
  receiptSeed: "receipt-seed-1",
  logicalSeed: "logical-seed-1",
  attemptSeed: "attempt-seed-1",
} as const;

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
    requestId: overrides?.requestId ?? REQUEST_ID,
    createdAtIso: overrides?.createdAtIso ?? CREATED_AT,
    entropy: {
      receiptSeed: overrides?.receiptSeed ?? SEEDS.receiptSeed,
      logicalSeed: overrides?.logicalSeed ?? SEEDS.logicalSeed,
      attemptSeed: overrides?.attemptSeed ?? SEEDS.attemptSeed,
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable: identity build failed");
  return result.value;
}

const ROUTE_SOURCE = readFileSync(
  new URL(
    "../../../app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts",
    import.meta.url
  ),
  "utf8"
);

const HELPER_SOURCE = readFileSync(
  new URL("./gemini-evidence-producer-receipts.ts", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------------
// 1) Pure helper builds status=built for a valid identity
// ---------------------------------------------------------------------------

test("1) helper builds status=built for a valid minted identity", () => {
  const result = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    identity: buildIdentity(),
  });
  assert.equal(result.status, "built");
});

// ---------------------------------------------------------------------------
// 2) Built receipt type is gemini_invocation (receipt + envelope projection)
// ---------------------------------------------------------------------------

test("2) built receipt/envelope are gemini_invocation only", () => {
  const result = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    identity: buildIdentity(),
  });
  assert.equal(result.status, "built");
  if (result.status !== "built") return;
  assert.equal(result.receipt.header.receiptType, "gemini_invocation");
  assert.equal(result.envelope.projection.receiptType, "gemini_invocation");
});

// ---------------------------------------------------------------------------
// 3) Built receipt/envelope parse through W1 and validate through the kernel
// ---------------------------------------------------------------------------

test("3) built receipt validates through kernel and envelope parses through W1", () => {
  const identity = buildIdentity();
  const result = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    identity,
  });
  assert.equal(result.status, "built");
  if (result.status !== "built") return;

  const validated = validateReceiptSet([result.receipt]);
  assert.equal(validated.ok, true);

  const parsed = parseGeminiEvidenceWireEnvelopeV1(result.envelope);
  assert.equal(parsed.ok, true);
});

// ---------------------------------------------------------------------------
// 4) Ledger row-builder accepts the built envelope (no insert)
// ---------------------------------------------------------------------------

test("4) ledger row-builder accepts the built envelope", () => {
  const identity = buildIdentity();
  const result = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    identity,
  });
  assert.equal(result.status, "built");
  if (result.status !== "built") return;

  const row = buildGeminiEvidenceReceiptLedgerRowV1({
    envelope: result.envelope,
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
// 5) Helper returns error for a provider_retry forged identity (R-5)
// ---------------------------------------------------------------------------

test("5) helper returns error for a provider_retry forged identity", () => {
  const forged = {
    ...buildIdentity(),
    relationship:
      "provider_retry" as unknown as GeminiEvidenceProducerRelationshipV1,
  } as GeminiEvidenceProducerIdentityV1;
  const result = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    identity: forged,
  });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(
      result.reason,
      "producer_invocation_unsupported_relationship"
    );
  }
});

// ---------------------------------------------------------------------------
// 6) Helper source has no env/time/randomness/crypto/route imports
// ---------------------------------------------------------------------------

test("6) helper source is pure (no env/time/randomness/crypto/route imports)", () => {
  for (const fragment of [
    "process.env",
    "Date.now",
    "new Date(",
    "Math.random",
    "randomUUID",
    "node:crypto",
    'from "crypto"',
    "app/api/",
    "next/server",
    "@supabase/supabase-js",
    "@supabase/ssr",
  ]) {
    assert.equal(
      HELPER_SOURCE.includes(fragment),
      false,
      `helper must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 7) Route constructs the invocation envelope ONLY after identity is minted
// ---------------------------------------------------------------------------

test("7) route constructs invocation envelope only after identity minted", () => {
  const mintedAnchor = ROUTE_SOURCE.indexOf('identity.status === "minted"');
  const constructAnchor = ROUTE_SOURCE.indexOf(
    "prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1("
  );
  assert.ok(mintedAnchor >= 0, "expected a minted branch");
  assert.ok(constructAnchor >= 0, "expected invocation construction call");
  assert.ok(
    mintedAnchor < constructAnchor,
    "invocation must be constructed only inside the minted branch"
  );
  // Exactly one construction site.
  assert.equal(
    (
      ROUTE_SOURCE.match(
        /prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1\(/g
      ) ?? []
    ).length,
    1
  );
});

// ---------------------------------------------------------------------------
// 8) Route constructs the invocation envelope BEFORE the Gemini call
// ---------------------------------------------------------------------------

test("8) route constructs invocation envelope before detectFloorFromVerifiedBytes", () => {
  const constructAnchor = ROUTE_SOURCE.indexOf(
    "prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1("
  );
  const callAnchor = ROUTE_SOURCE.indexOf("detectFloorFromVerifiedBytes({");
  assert.ok(constructAnchor >= 0, "expected invocation construction call");
  assert.ok(callAnchor >= 0, "expected the outbound Gemini call");
  assert.ok(
    constructAnchor < callAnchor,
    "invocation must be constructed before the outbound Gemini call"
  );
});

// ---------------------------------------------------------------------------
// 9) Route fail-closes before the Gemini call on construction error
// ---------------------------------------------------------------------------

test("9) route fail-closes before the Gemini call on construction error", () => {
  const errorAnchor = ROUTE_SOURCE.indexOf('invocation.status === "error"');
  const callAnchor = ROUTE_SOURCE.indexOf("detectFloorFromVerifiedBytes({");
  assert.ok(errorAnchor >= 0, "expected a construction error branch");
  assert.ok(callAnchor >= 0, "expected the outbound Gemini call");
  assert.ok(
    errorAnchor < callAnchor,
    "the fail-closed return must precede the outbound Gemini call"
  );
  assert.match(
    ROUTE_SOURCE,
    /failedWithBasis\(\s*"Vision calibration invocation/
  );
});

// ---------------------------------------------------------------------------
// 10) Route inserts no ledger rows and imports no service client
// ---------------------------------------------------------------------------

test("10) route inserts no ledger rows / imports no service client", () => {
  for (const fragment of [
    "insertGeminiEvidenceReceiptEnvelopeV1",
    "insertGeminiEvidenceReceiptEnvelopeForTestV1",
    "buildGeminiEvidenceReceiptLedgerRowV1",
    "createGeminiEvidenceReceiptLedgerServiceClient",
    "createSupabaseGeminiEvidenceReceiptLedgerClientV1",
    "gemini-evidence-receipt-ledger",
    "@supabase/supabase-js",
    "@supabase/ssr",
    ".from(",
    ".insert(",
    ".upsert(",
  ]) {
    assert.equal(
      ROUTE_SOURCE.includes(fragment),
      false,
      `route must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 11) Route does not return/log the canonical payload or built envelope/receipt
// ---------------------------------------------------------------------------

test("11) route does not return/log the built receipt or envelope", () => {
  for (const fragment of [
    "invocation.receipt",
    "invocation.envelope",
    "canonicalPayload",
    "canonicalJson",
    ".projection",
    ".canonical",
  ]) {
    assert.equal(
      ROUTE_SOURCE.includes(fragment),
      false,
      `route must not reference ${fragment}`
    );
  }
  // The constructed value must not be spread into any NextResponse body.
  assert.equal(ROUTE_SOURCE.includes("...invocation"), false);
});

// ---------------------------------------------------------------------------
// 12) Route builds no provider_response / raw capture / storage retention
// ---------------------------------------------------------------------------

test("12) route builds no provider_response / raw-capture / storage retention", () => {
  for (const fragment of [
    "provider_response",
    "gemini_provider_response",
    "res.text(",
    "response.text(",
    ".rawResponse",
    "rawResponseText",
    "parsed_response",
    "local_assessment",
    "evidence_disposition",
    "derivative_lineage",
    "evidence_comparison",
    "tombstone",
    ".upload(",
    "storage",
  ]) {
    assert.equal(
      ROUTE_SOURCE.includes(fragment),
      false,
      `route must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 13) Disabled/default branch constructs no invocation envelope
// ---------------------------------------------------------------------------

test("13) disabled/default branch constructs no invocation envelope", () => {
  // The single construction site is strictly inside the enabled gate AND the
  // minted branch, so the default/disabled path can never reach it.
  const gateAnchor = ROUTE_SOURCE.indexOf(
    "shouldMintGeminiEvidenceDetectVisionIdentityV1({"
  );
  const mintedAnchor = ROUTE_SOURCE.indexOf('identity.status === "minted"');
  const constructAnchor = ROUTE_SOURCE.indexOf(
    "prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1("
  );
  assert.ok(gateAnchor >= 0, "expected the identity flag gate");
  assert.ok(mintedAnchor >= 0, "expected the minted branch");
  assert.ok(constructAnchor >= 0, "expected the construction call");
  assert.ok(
    gateAnchor < mintedAnchor && mintedAnchor < constructAnchor,
    "construction must live inside the enabled+minted branch only"
  );
});

// ---------------------------------------------------------------------------
// 14) provider_retry stays out of scope at the identity boundary too
// ---------------------------------------------------------------------------

test("14) provider_retry stays out of scope (identity boundary refuses)", () => {
  const idResult = buildGeminiEvidenceProducerIdentityV1({
    relationship:
      "provider_retry" as unknown as GeminiEvidenceProducerRelationshipV1,
    requestId: REQUEST_ID,
    createdAtIso: CREATED_AT,
    entropy: { receiptSeed: "r", logicalSeed: "l", attemptSeed: "a" },
  });
  assert.equal(idResult.ok, false);
  if (!idResult.ok) {
    assert.equal(idResult.reason, "producer_unsupported_relationship");
  }
  // The helper never mints its own identity, so it also cannot upgrade a forged
  // provider_retry identity into a built envelope (covered by test 5).
  assert.equal(HELPER_SOURCE.includes("provider_retry"), true);
});
