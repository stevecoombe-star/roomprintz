// GER-W3B.2 — Deterministic tests for the default-off detect-vision route
// producer-identity slice: a server-only flag gate, a pure route-identity
// preparation helper, and source-level containment/ordering assertions on the
// detect-vision route.
//
// These tests are pure: no current time, randomness, env mutation, network, DB,
// Supabase, Gemini, or route execution is exercised. The pure helpers are
// tested directly with fixed literal seeds, and node:fs is used ONLY for
// deterministic source self-checks (containment + mint-placement ordering).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  prepareDetectVisionGeminiEvidenceIdentityV1,
  shouldMintGeminiEvidenceDetectVisionIdentityV1,
  GER_W3B0_PROVIDER_ATTEMPT_ID_PREFIX,
  GER_W3B0_RECEIPT_ID_PREFIX,
  GER_W3B0_LOGICAL_INVOCATION_ID_PREFIX,
} from "./gemini-evidence-producer-receipts";

// ---------------------------------------------------------------------------
// Deterministic fixtures (fixed literals only)
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-07-08T00:00:00.000Z";
const REQUEST_ID = "req-fixture-123";
const SEEDS = {
  receiptSeed: "receipt-seed-1",
  logicalSeed: "logical-seed-1",
  attemptSeed: "attempt-seed-1",
} as const;

const ROUTE_SOURCE = readFileSync(
  new URL(
    "../../../app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ---------------------------------------------------------------------------
// 1) Default-off gate is false for absent/null/empty/false/"0"/"false"
// ---------------------------------------------------------------------------

test("1) default-off gate is false for absent/null/empty/false/0/false", () => {
  assert.equal(shouldMintGeminiEvidenceDetectVisionIdentityV1({}), false);
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: undefined }),
    false
  );
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: null }),
    false
  );
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: "" }),
    false
  );
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: false }),
    false
  );
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: "0" }),
    false
  );
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: "false" }),
    false
  );
});

// ---------------------------------------------------------------------------
// 2) Gate is true only for explicit truthy values
// ---------------------------------------------------------------------------

test("2) gate is true only for explicit truthy values", () => {
  for (const v of ["1", "true", "yes", "on"]) {
    assert.equal(
      shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: v }),
      true,
      `expected true for: ${v}`
    );
  }
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: true }),
    true
  );
  // Non-recognized truthy-looking strings stay false.
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: "TRUE" }),
    false
  );
  assert.equal(
    shouldMintGeminiEvidenceDetectVisionIdentityV1({ enabled: "enabled" }),
    false
  );
});

// ---------------------------------------------------------------------------
// 3) Route uses the server-only env name, not a NEXT_PUBLIC flag
// ---------------------------------------------------------------------------

test("3) route reads the server-only env flag, never a NEXT_PUBLIC flag", () => {
  assert.equal(
    ROUTE_SOURCE.includes("process.env.GER_DETECT_VISION_IDENTITY_ENABLED"),
    true,
    "route must read the server-only GER_DETECT_VISION_IDENTITY_ENABLED flag"
  );
  assert.equal(
    ROUTE_SOURCE.includes("NEXT_PUBLIC"),
    false,
    "route must not expose the identity flag via NEXT_PUBLIC_*"
  );
});

// ---------------------------------------------------------------------------
// 4) Identity is minted only after preflight and before the Gemini call
// ---------------------------------------------------------------------------

test("4) route mints identity after preflight and before detectFloorFromVerifiedBytes", () => {
  // The last local preflight refusal is the decoded-dimension check.
  const preflightAnchor = ROUTE_SOURCE.indexOf('reason: "dimension_mismatch"');
  const mintAnchor = ROUTE_SOURCE.indexOf(
    "prepareDetectVisionGeminiEvidenceIdentityV1("
  );
  const callAnchor = ROUTE_SOURCE.indexOf("detectFloorFromVerifiedBytes({");

  assert.ok(preflightAnchor >= 0, "expected a dimension_mismatch preflight");
  assert.ok(mintAnchor >= 0, "expected route identity preparation call");
  assert.ok(callAnchor >= 0, "expected the outbound Gemini call");

  assert.ok(
    preflightAnchor < mintAnchor,
    "identity must be minted AFTER local preflight refusal points"
  );
  assert.ok(
    mintAnchor < callAnchor,
    "identity must be minted BEFORE the outbound Gemini call"
  );
});

// ---------------------------------------------------------------------------
// 5) No seeds / identity when disabled (pure helper proof + source ordering)
// ---------------------------------------------------------------------------

test("5) disabled gate mints no identity even if seeds are supplied", () => {
  const disabled = prepareDetectVisionGeminiEvidenceIdentityV1({
    enabled: false,
    requestId: REQUEST_ID,
    createdAtIso: CREATED_AT,
    entropySeeds: SEEDS,
  });
  assert.equal(disabled.status, "disabled");

  const absent = prepareDetectVisionGeminiEvidenceIdentityV1({
    requestId: REQUEST_ID,
    createdAtIso: CREATED_AT,
    entropySeeds: SEEDS,
  });
  assert.equal(absent.status, "disabled");
});

test("5b) route generates entropy seeds only inside the enabled branch", () => {
  // Every randomUUID() seed generation must occur after the flag gate opens and
  // before the outbound Gemini call — never on the default/disabled path.
  const gateAnchor = ROUTE_SOURCE.indexOf(
    "shouldMintGeminiEvidenceDetectVisionIdentityV1({"
  );
  const callAnchor = ROUTE_SOURCE.indexOf("detectFloorFromVerifiedBytes({");
  assert.ok(gateAnchor >= 0, "expected the identity flag gate");
  assert.ok(callAnchor >= 0, "expected the outbound Gemini call");

  const seedMatches = [...ROUTE_SOURCE.matchAll(/randomUUID\(\)/g)];
  assert.ok(seedMatches.length >= 1, "expected route to generate entropy seeds");
  for (const m of seedMatches) {
    const at = m.index ?? -1;
    assert.ok(
      at > gateAnchor && at < callAnchor,
      "randomUUID seed generation must live inside the enabled branch"
    );
  }
});

// ---------------------------------------------------------------------------
// 6) Enabled branch mints a grammar-safe identity + attemptId supply wiring
// ---------------------------------------------------------------------------

test("6) enabled gate mints a grammar-safe identity with a minted providerAttemptId", () => {
  const minted = prepareDetectVisionGeminiEvidenceIdentityV1({
    enabled: true,
    requestId: REQUEST_ID,
    createdAtIso: CREATED_AT,
    entropySeeds: SEEDS,
  });
  assert.equal(minted.status, "minted");
  if (minted.status !== "minted") return;
  const { identity } = minted;

  const grammar = /^[\x21-\x7e]+$/;
  for (const id of [
    identity.receiptId,
    identity.logicalInvocationId,
    identity.providerAttemptId,
  ]) {
    assert.equal(grammar.test(id), true, `not grammar-safe: ${id}`);
    assert.ok(id.length > 0 && id.length <= 256);
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
  // requestId is carried as correlation only, never embedded in the attempt id.
  assert.equal(identity.requestId, REQUEST_ID);
  assert.equal(identity.providerAttemptId.includes(REQUEST_ID), false);
});

test("6b) route supplies attemptId to accounting only from a minted identity", () => {
  // The single attemptId supply site pulls from identity.providerAttemptId and
  // is guarded behind the minted branch. There is no request-input attemptId.
  assert.match(ROUTE_SOURCE, /attemptId:\s*identity\.identity\.providerAttemptId/);
  assert.match(ROUTE_SOURCE, /identity\.status === "minted"/);
  // The base (default/disabled) accounting object carries no attemptId key.
  assert.match(
    ROUTE_SOURCE,
    /const baseAccounting = \{\s*requestId,\s*route: VISION_ROUTE,\s*userId: adminUser\.id \?\? null,\s*\};/
  );
});

// ---------------------------------------------------------------------------
// 7) Fail-closed when enabled but identity cannot be built
// ---------------------------------------------------------------------------

test("7) enabled gate with missing seeds fails closed (error, no minting)", () => {
  const missing = prepareDetectVisionGeminiEvidenceIdentityV1({
    enabled: true,
    requestId: REQUEST_ID,
    createdAtIso: CREATED_AT,
  });
  assert.equal(missing.status, "error");
  if (missing.status === "error") {
    assert.equal(missing.reason, "detect_vision_identity_missing_seeds");
  }
});

test("7b) enabled gate with an unbuildable seed fails closed (error)", () => {
  const bad = prepareDetectVisionGeminiEvidenceIdentityV1({
    enabled: true,
    requestId: REQUEST_ID,
    createdAtIso: CREATED_AT,
    entropySeeds: { receiptSeed: "", logicalSeed: "l", attemptSeed: "a" },
  });
  assert.equal(bad.status, "error");

  const badTime = prepareDetectVisionGeminiEvidenceIdentityV1({
    enabled: true,
    requestId: REQUEST_ID,
    createdAtIso: "not-an-iso-instant",
    entropySeeds: SEEDS,
  });
  assert.equal(badTime.status, "error");
});

test("7c) route fails closed before the Gemini call on identity error", () => {
  const errorAnchor = ROUTE_SOURCE.indexOf('identity.status === "error"');
  const callAnchor = ROUTE_SOURCE.indexOf("detectFloorFromVerifiedBytes({");
  assert.ok(errorAnchor >= 0, "expected an identity error branch");
  assert.ok(
    errorAnchor < callAnchor,
    "the fail-closed return must precede the outbound Gemini call"
  );
  // The fail-closed path returns the same style of safe failed result.
  assert.match(ROUTE_SOURCE, /failedWithBasis\(\s*"Vision calibration identity/);
});

// ---------------------------------------------------------------------------
// 8) Route imports/calls no ledger insert helpers
// ---------------------------------------------------------------------------

test("8) route imports/calls no ledger insert / Supabase / DB helpers", () => {
  const forbidden = [
    "insertGeminiEvidenceReceiptEnvelopeV1",
    "insertGeminiEvidenceReceiptEnvelopeForTestV1",
    "createGeminiEvidenceReceiptLedgerServiceClient",
    "createSupabaseGeminiEvidenceReceiptLedgerClientV1",
    "gemini-evidence-receipt-ledger",
    ".from(",
    ".upsert(",
    ".insert(",
  ];
  for (const fragment of forbidden) {
    assert.equal(
      ROUTE_SOURCE.includes(fragment),
      false,
      `route must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 9) Route calls no receipt builder
// ---------------------------------------------------------------------------

test("9) route builds no invocation/evidence receipt", () => {
  const forbidden = [
    "buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1",
    "buildGeminiEvidenceReceiptLedgerRowV1",
    "toGeminiEvidenceWireEnvelopeV1",
  ];
  for (const fragment of forbidden) {
    assert.equal(
      ROUTE_SOURCE.includes(fragment),
      false,
      `route must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 10) Route captures no raw provider response text
// ---------------------------------------------------------------------------

test("10) route captures no raw provider response / provider_response receipt", () => {
  const forbidden = [
    "provider_response",
    "gemini_provider_response",
    "res.text(",
    "response.text(",
    ".rawResponse",
    "rawResponseText",
  ];
  for (const fragment of forbidden) {
    assert.equal(
      ROUTE_SOURCE.includes(fragment),
      false,
      `route must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 11) Identity seeds are never derived from scene/request inputs
// ---------------------------------------------------------------------------

test("11) route entropy seeds are randomUUID(), never scene/request-derived", () => {
  // The entropySeeds block must be built from randomUUID() only. No entropy
  // field may be assigned from a scene/request identifier or the image URL.
  const seedsBlockMatch = ROUTE_SOURCE.match(
    /entropySeeds:\s*\{([\s\S]*?)\}/
  );
  assert.ok(seedsBlockMatch, "expected an entropySeeds block");
  const seedsBlock = seedsBlockMatch[1];
  for (const banned of [
    "requestId",
    "roomId",
    "assetId",
    "versionId",
    "sceneHash",
    "imageUrl",
    "frameSize",
    "attestedBasisFingerprint",
  ]) {
    assert.equal(
      seedsBlock.includes(banned),
      false,
      `entropy seeds must not be derived from ${banned}`
    );
  }
  // Each of the three seeds is a fresh randomUUID().
  assert.equal((seedsBlock.match(/randomUUID\(\)/g) ?? []).length, 3);

  // The pure helper also never embeds a scene/request input as an identifier:
  // even with a hostile requestId, the minted attempt id excludes it.
  const minted = prepareDetectVisionGeminiEvidenceIdentityV1({
    enabled: true,
    requestId: "req-should-not-embed",
    createdAtIso: CREATED_AT,
    entropySeeds: SEEDS,
  });
  assert.equal(minted.status, "minted");
  if (minted.status === "minted") {
    assert.equal(
      minted.identity.providerAttemptId.includes("req-should-not-embed"),
      false
    );
  }
});

// ---------------------------------------------------------------------------
// 12) Existing admin + feature-flag gates remain intact ahead of minting
// ---------------------------------------------------------------------------

test("12) admin gate and AUTO_FLOOR_VISION_ENABLED gate precede identity minting", () => {
  const adminAnchor = ROUTE_SOURCE.indexOf("getAuthenticatedAdminUser()");
  const flagAnchor = ROUTE_SOURCE.indexOf("isAutoFloorVisionEnabled()");
  const mintAnchor = ROUTE_SOURCE.indexOf(
    "prepareDetectVisionGeminiEvidenceIdentityV1("
  );
  assert.ok(adminAnchor >= 0, "admin gate must remain");
  assert.ok(flagAnchor >= 0, "AUTO_FLOOR_VISION_ENABLED gate must remain");
  assert.ok(mintAnchor >= 0, "identity minting must exist");
  assert.ok(adminAnchor < mintAnchor, "admin gate must precede minting");
  assert.ok(flagAnchor < mintAnchor, "vision flag gate must precede minting");
});
