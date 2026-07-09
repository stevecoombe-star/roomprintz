// GER-W3B.4 — Deterministic tests for the default-off detect-vision invocation
// ledger persistence slice.
//
// Three kinds of proof, all pure:
//   * gate tests for the pure, env-free persistence gate
//     `shouldPersistGeminiEvidenceDetectVisionInvocationV1`,
//   * behavioral tests of the server-only persistence helper against a fake
//     async ledger client wrapping the frozen W2B fake repository (inserted /
//     idempotent / every W2D refusal / read failure / missing service env), and
//   * deterministic source-order / containment assertions on the detect-vision
//     route proving the write is minted-only, post-construction, pre-Gemini,
//     fail-closed, flag-gated, and never logs/returns the receipt/envelope/row.
//
// No current time, randomness, env mutation, network, live DB, live Supabase
// service call, Gemini, or route execution occurs anywhere in this file.
// node:fs is used ONLY for the deterministic route/helper source self-checks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildGeminiEvidenceProducerIdentityV1,
  prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1,
  shouldPersistGeminiEvidenceDetectVisionInvocationV1,
  type GeminiEvidenceProducerIdentityV1,
  type GeminiEvidenceProducerRelationshipV1,
} from "./gemini-evidence-producer-receipts";

import {
  buildGeminiEvidenceReceiptLedgerRowV1,
  createFakeGeminiEvidenceReceiptLedgerClientV1,
  GeminiEvidenceLedgerReadError,
  type AsyncGeminiEvidenceReceiptLedgerClientV1,
  type GeminiEvidenceReceiptLedgerClientV1,
  type GeminiEvidenceReceiptLedgerRowV1,
} from "./gemini-evidence-receipt-ledger";

import type { GeminiEvidenceWireEnvelopeV1 } from "./gemini-evidence-wire";

import {
  GER_W3B4_PERSIST_UNEXPECTED_ERROR_REASON,
  persistDetectVisionGeminiEvidenceInvocationEnvelopeV1,
} from "./gemini-evidence-detect-vision-invocation-persistence";

// ---------------------------------------------------------------------------
// Deterministic fixtures (fixed literals only)
// ---------------------------------------------------------------------------

const IDENTITY_CREATED_AT = "2026-07-08T00:00:00.000Z";
const LEDGER_CREATED_AT = "2026-07-08T12:00:00.000Z";
const REQUEST_ID = "req-fixture-w3b4";

function buildIdentity(overrides?: {
  relationship?: GeminiEvidenceProducerRelationshipV1;
  requestId?: string | null;
  receiptSeed?: string;
  logicalSeed?: string;
  attemptSeed?: string;
}): GeminiEvidenceProducerIdentityV1 {
  const result = buildGeminiEvidenceProducerIdentityV1({
    relationship: overrides?.relationship ?? "initial",
    requestId: overrides?.requestId ?? REQUEST_ID,
    createdAtIso: IDENTITY_CREATED_AT,
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

function envelopeFor(overrides?: {
  receiptSeed?: string;
  logicalSeed?: string;
  attemptSeed?: string;
  requestId?: string | null;
}): GeminiEvidenceWireEnvelopeV1 {
  const built = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    identity: buildIdentity(overrides),
  });
  assert.equal(built.status, "built");
  if (built.status !== "built") throw new Error("unreachable: build failed");
  return built.envelope;
}

/**
 * Wrap the synchronous W2B fake client as an async ledger client, mirroring the
 * W2D test harness. Unique violations surface as ledger_unique_violation so the
 * async insert helper classifies by lookup order.
 */
function toAsyncLedgerClient(
  sync: GeminiEvidenceReceiptLedgerClientV1
): AsyncGeminiEvidenceReceiptLedgerClientV1 {
  return {
    async insert(row) {
      const result = sync.insert(row);
      if (result.ok) return { ok: true };
      return result.constraint !== undefined
        ? { ok: false, reason: "ledger_unique_violation", constraint: result.constraint }
        : { ok: false, reason: "ledger_unique_violation" };
    },
    async readByReceiptId(receiptId) {
      return sync.readByReceiptId(receiptId);
    },
    async readByDigestHex(digestHex) {
      return sync.readByDigestHex(digestHex);
    },
    async readByProviderAttemptId(providerAttemptId) {
      return sync.readByProviderAttemptId(providerAttemptId);
    },
    async readByRetryForkKey(input) {
      return sync.readByRetryForkKey(input);
    },
  };
}

const ROUTE_SOURCE = readFileSync(
  new URL(
    "../../../app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts",
    import.meta.url
  ),
  "utf8"
);

const HELPER_SOURCE = readFileSync(
  new URL("./gemini-evidence-detect-vision-invocation-persistence.ts", import.meta.url),
  "utf8"
);

const PERSIST_CALL = "persistDetectVisionGeminiEvidenceInvocationEnvelopeV1(";
const GATE_CALL = "shouldPersistGeminiEvidenceDetectVisionInvocationV1({";
const CONSTRUCT_CALL = "prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1(";
const GEMINI_CALL = "detectFloorFromVerifiedBytes({";

// ===========================================================================
// Gate tests
// ===========================================================================

test("gate: false for absent/null/empty/false/0/false/TRUE/enabled", () => {
  for (const enabled of [
    undefined,
    null,
    "",
    false,
    "0",
    "false",
    "TRUE",
    "enabled",
  ] as const) {
    assert.equal(
      shouldPersistGeminiEvidenceDetectVisionInvocationV1({ enabled }),
      false,
      `expected false for: ${String(enabled)}`
    );
  }
  assert.equal(shouldPersistGeminiEvidenceDetectVisionInvocationV1({}), false);
});

test("gate: true only for true/1/true/yes/on", () => {
  for (const enabled of ["1", "true", "yes", "on"] as const) {
    assert.equal(
      shouldPersistGeminiEvidenceDetectVisionInvocationV1({ enabled }),
      true,
      `expected true for: ${enabled}`
    );
  }
  assert.equal(
    shouldPersistGeminiEvidenceDetectVisionInvocationV1({ enabled: true }),
    true
  );
});

test("gate: helper module never reads process.env / NEXT_PUBLIC", () => {
  // The gate is a pure delegate; neither it nor the persistence helper module
  // reads the process environment or any NEXT_PUBLIC flag.
  assert.equal(HELPER_SOURCE.includes("process.env"), false);
  assert.equal(HELPER_SOURCE.includes("NEXT_PUBLIC"), false);
});

// ===========================================================================
// Persistence helper tests (fake async client; no live DB / Supabase / network)
// ===========================================================================

test("helper: inserted outcome -> { status: persisted, outcome: inserted }", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envelopeFor(),
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(result, { status: "persisted", outcome: "inserted" });
});

test("helper: idempotent outcome -> { status: persisted, outcome: idempotent }", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  const envelope = envelopeFor();
  const first = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope,
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(first, { status: "persisted", outcome: "inserted" });

  const second = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope,
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(second, { status: "persisted", outcome: "idempotent" });
});

test("helper: id-conflict duplicate -> ledger_receipt_integrity_conflict", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  // Same receiptSeed -> same receipt_id; different other seeds + requestId ->
  // different canonical payload/digest, so it collides on receipt_id with a
  // mismatched payload.
  const envA = envelopeFor({
    receiptSeed: "shared-receipt",
    logicalSeed: "logical-A",
    attemptSeed: "attempt-A",
    requestId: "req-A",
  });
  const envB = envelopeFor({
    receiptSeed: "shared-receipt",
    logicalSeed: "logical-B",
    attemptSeed: "attempt-B",
    requestId: "req-B",
  });
  assert.equal(
    (
      await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
        envelope: envA,
        createdAt: LEDGER_CREATED_AT,
        client,
      })
    ).status,
    "persisted"
  );
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envB,
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(result, {
    status: "error",
    reason: "ledger_receipt_integrity_conflict",
  });
});

test("helper: digest mismatch -> ledger_digest_id_mismatch", async () => {
  const sync = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const envelope = envelopeFor();
  // Seed a forged row that shares the digest but a different receipt_id.
  const built = buildGeminiEvidenceReceiptLedgerRowV1({
    envelope,
    createdAt: LEDGER_CREATED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const forged: GeminiEvidenceReceiptLedgerRowV1 = {
    ...built.row,
    receipt_id: "forged-distinct-receipt-id",
  };
  assert.equal(sync.insert(forged).ok, true);

  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope,
    createdAt: LEDGER_CREATED_AT,
    client: toAsyncLedgerClient(sync),
  });
  assert.deepEqual(result, {
    status: "error",
    reason: "ledger_digest_id_mismatch",
  });
});

test("helper: providerAttemptId reuse -> ledger_provider_attempt_reused", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  // Same attemptSeed -> shared provider_attempt_id; different receipt/logical
  // seeds -> distinct receipt_id/digest/logical, so classification reaches the
  // provider-attempt lookup.
  const envA = envelopeFor({
    receiptSeed: "receipt-A",
    logicalSeed: "logical-A",
    attemptSeed: "shared-attempt",
  });
  const envB = envelopeFor({
    receiptSeed: "receipt-B",
    logicalSeed: "logical-B",
    attemptSeed: "shared-attempt",
  });
  assert.equal(
    (
      await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
        envelope: envA,
        createdAt: LEDGER_CREATED_AT,
        client,
      })
    ).status,
    "persisted"
  );
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envB,
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(result, {
    status: "error",
    reason: "ledger_provider_attempt_reused",
  });
});

test("helper: retry-fork collision -> ledger_forked_invocation_lineage", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  // Same logicalSeed -> shared logical_invocation_id with null predecessor;
  // distinct receipt/attempt seeds. Two such initial invocations collide as a
  // forked lineage. (Only initial/operator_rerun invocation receipts are
  // reachable here; provider_retry is out of scope for this producer.)
  const envA = envelopeFor({
    receiptSeed: "receipt-A",
    logicalSeed: "shared-logical",
    attemptSeed: "attempt-A",
  });
  const envB = envelopeFor({
    receiptSeed: "receipt-B",
    logicalSeed: "shared-logical",
    attemptSeed: "attempt-B",
  });
  assert.equal(
    (
      await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
        envelope: envA,
        createdAt: LEDGER_CREATED_AT,
        client,
      })
    ).status,
    "persisted"
  );
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envB,
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(result, {
    status: "error",
    reason: "ledger_forked_invocation_lineage",
  });
});

test("helper: read error -> ledger_read_failed", async () => {
  // insert succeeds, but the post-insert readback throws a genuine read error,
  // which the W2D repository maps to the stable ledger_read_failed reason.
  const readErrorClient: AsyncGeminiEvidenceReceiptLedgerClientV1 = {
    async insert() {
      return { ok: true };
    },
    async readByReceiptId() {
      throw new GeminiEvidenceLedgerReadError("boom");
    },
    async readByDigestHex() {
      return null;
    },
    async readByProviderAttemptId() {
      return null;
    },
    async readByRetryForkKey() {
      return null;
    },
  };
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envelopeFor(),
    createdAt: LEDGER_CREATED_AT,
    client: readErrorClient,
  });
  assert.deepEqual(result, { status: "error", reason: "ledger_read_failed" });
});

test("helper: unexpected non-read throw -> ledger_persist_unexpected_error", async () => {
  // A plain Error thrown from insert (NOT a GeminiEvidenceLedgerReadError) is
  // rethrown by the W2D repository and caught conservatively by the helper,
  // which maps it to the stable unexpected-error reason.
  const throwingClient: AsyncGeminiEvidenceReceiptLedgerClientV1 = {
    async insert() {
      throw new Error("unexpected boom");
    },
    async readByReceiptId() {
      return null;
    },
    async readByDigestHex() {
      return null;
    },
    async readByProviderAttemptId() {
      return null;
    },
    async readByRetryForkKey() {
      return null;
    },
  };
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envelopeFor(),
    createdAt: LEDGER_CREATED_AT,
    client: throwingClient,
  });
  assert.deepEqual(result, {
    status: "error",
    reason: GER_W3B4_PERSIST_UNEXPECTED_ERROR_REASON,
  });
});

test("helper: missing service env -> ledger_service_env_missing", async () => {
  // No client is provided, so the helper attempts to build a service-role
  // client from the injected (empty) env source, which fails closed with the
  // stable reason. No real ambient env is read and no network call is made.
  const result = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope: envelopeFor(),
    createdAt: LEDGER_CREATED_AT,
    serviceEnvSource: {},
  });
  assert.deepEqual(result, {
    status: "error",
    reason: "ledger_service_env_missing",
  });
});

test("helper: never returns row / receipt / canonical payload / envelope body", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  const envelope = envelopeFor();
  const persisted = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope,
    createdAt: LEDGER_CREATED_AT,
    client,
  });
  assert.deepEqual(Object.keys(persisted).sort(), ["outcome", "status"]);

  // A genuine error result carries a stable reason and no data surface.
  const errored = await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
    envelope,
    createdAt: LEDGER_CREATED_AT,
    serviceEnvSource: {},
  });
  assert.equal(errored.status, "error");
  assert.deepEqual(Object.keys(errored).sort(), ["reason", "status"]);

  // No leaked receipt/envelope/row surface, and the authoritative canonical
  // payload never appears in the serialized result.
  for (const result of [persisted, errored]) {
    for (const banned of [
      "row",
      "receipt",
      "envelope",
      "canonical_payload",
      "canonicalReceipt",
      "projection",
    ]) {
      assert.equal(banned in result, false, `result must not carry ${banned}`);
    }
    assert.equal(
      JSON.stringify(result).includes(envelope.canonicalReceipt),
      false,
      "result must not leak the canonical payload"
    );
  }
});

// ===========================================================================
// Persistence helper source containment
// ===========================================================================

test("helper source: executable import \"server-only\"; (R-4)", () => {
  assert.equal(
    /^\s*import\s+["']server-only["']\s*;?\s*$/m.test(HELPER_SOURCE),
    true,
    'persistence helper must use executable import "server-only";'
  );
  assert.equal(
    /^\s*["']server-only["']\s*;/m.test(HELPER_SOURCE),
    false,
    "persistence helper must not use an inert bare server-only string statement"
  );
});

test("helper source: imports only the frozen W2D ledger + wire modules", () => {
  const fromTargets = [...HELPER_SOURCE.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
    (m) => m[1]
  );
  const allowed = new Set([
    "./gemini-evidence-receipt-ledger",
    "./gemini-evidence-wire",
  ]);
  for (const target of fromTargets) {
    assert.equal(allowed.has(target), true, `unexpected import target: ${target}`);
  }
  assert.equal(/\brequire\(/.test(HELPER_SOURCE), false, "must not use require()");
});

test("helper source: no provider_response / raw capture / storage retention", () => {
  for (const fragment of [
    "gemini_provider_response",
    "provider_response",
    "raw-provider-response-text",
    "res.text(",
    "response.text(",
    ".rawResponse",
    "rawResponseText",
    "parsed_response",
    "local_assessment",
    "evidence_disposition",
    "derivative_lineage",
    "evidence_comparison",
    "retention_tombstone",
    "tombstone",
    ".upload(",
    "storage",
    "console.",
  ]) {
    assert.equal(
      HELPER_SOURCE.includes(fragment),
      false,
      `persistence helper must not reference ${fragment}`
    );
  }
});

// ===========================================================================
// Route source tests
// ===========================================================================

test("route: persistence flag read is server-side only", () => {
  assert.ok(
    ROUTE_SOURCE.includes(
      "process.env.GER_DETECT_VISION_INVOCATION_LEDGER_WRITE_ENABLED"
    ),
    "route must read the server-side write flag from process.env"
  );
  assert.equal(
    ROUTE_SOURCE.includes("NEXT_PUBLIC"),
    false,
    "route must not use a NEXT_PUBLIC flag"
  );
});

test("route: persistence call occurs only inside identity.status === minted", () => {
  const mintedAnchor = ROUTE_SOURCE.indexOf('identity.status === "minted"');
  const persistAnchor = ROUTE_SOURCE.indexOf(PERSIST_CALL);
  assert.ok(mintedAnchor >= 0, "expected the minted branch");
  assert.ok(persistAnchor >= 0, "expected the persistence call");
  assert.ok(
    mintedAnchor < persistAnchor,
    "persistence must live inside the minted branch"
  );
  // Exactly one persistence call site.
  assert.equal(
    (
      ROUTE_SOURCE.match(
        /persistDetectVisionGeminiEvidenceInvocationEnvelopeV1\(/g
      ) ?? []
    ).length,
    1
  );
});

test("route: persistence call occurs after invocation construction succeeds", () => {
  const constructAnchor = ROUTE_SOURCE.indexOf(CONSTRUCT_CALL);
  const constructErrorAnchor = ROUTE_SOURCE.indexOf(
    'invocation.status === "error"'
  );
  const persistAnchor = ROUTE_SOURCE.indexOf(PERSIST_CALL);
  assert.ok(constructAnchor >= 0, "expected the construction call");
  assert.ok(constructErrorAnchor >= 0, "expected the construction error branch");
  assert.ok(persistAnchor >= 0, "expected the persistence call");
  assert.ok(
    constructAnchor < persistAnchor,
    "persistence must be after construction"
  );
  assert.ok(
    constructErrorAnchor < persistAnchor,
    "the construction fail-closed return must precede persistence"
  );
});

test("route: persistence call occurs before detectFloorFromVerifiedBytes", () => {
  const persistAnchor = ROUTE_SOURCE.indexOf(PERSIST_CALL);
  const callAnchor = ROUTE_SOURCE.indexOf(GEMINI_CALL);
  assert.ok(persistAnchor >= 0, "expected the persistence call");
  assert.ok(callAnchor >= 0, "expected the outbound Gemini call");
  assert.ok(
    persistAnchor < callAnchor,
    "persistence must precede the outbound Gemini call"
  );
});

test("route: persistence error fail-closes before the Gemini call", () => {
  const errorAnchor = ROUTE_SOURCE.indexOf('persistence.status === "error"');
  const callAnchor = ROUTE_SOURCE.indexOf(GEMINI_CALL);
  assert.ok(errorAnchor >= 0, "expected a persistence error branch");
  assert.ok(callAnchor >= 0, "expected the outbound Gemini call");
  assert.ok(
    errorAnchor < callAnchor,
    "the persistence fail-closed return must precede the Gemini call"
  );
  assert.match(
    ROUTE_SOURCE,
    /failedWithBasis\(\s*"Vision calibration invocation could not be recorded\."/
  );
});

test("route: no persistence call when flag disabled (branch-proven by source order)", () => {
  const gateAnchor = ROUTE_SOURCE.indexOf(GATE_CALL);
  const persistAnchor = ROUTE_SOURCE.indexOf(PERSIST_CALL);
  assert.ok(gateAnchor >= 0, "expected the persistence flag gate");
  assert.ok(persistAnchor >= 0, "expected the persistence call");
  assert.ok(
    gateAnchor < persistAnchor,
    "the persistence call must live inside the enabled gate only"
  );
});

test("route: imports no direct Supabase/service ledger client", () => {
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

test("route: logs only requestId/route/stage/reason for persistence failure", () => {
  const stageAnchor = ROUTE_SOURCE.indexOf('stage: "invocation_persistence"');
  assert.ok(stageAnchor >= 0, "expected the persistence failure log stage");
  const callStart = ROUTE_SOURCE.lastIndexOf("logVisionFailure({", stageAnchor);
  const callEnd = ROUTE_SOURCE.indexOf("});", stageAnchor);
  assert.ok(callStart >= 0 && callEnd > callStart, "expected an enclosing log call");
  const block = ROUTE_SOURCE.slice(callStart, callEnd);

  for (const allowed of ["requestId", "route:", "stage:", "reason:"]) {
    assert.ok(block.includes(allowed), `persistence log must include ${allowed}`);
  }
  for (const banned of [
    "receiptId",
    "logicalInvocationId",
    "providerAttemptId",
    "envelope",
    "receipt",
    "canonical",
    "row",
  ]) {
    assert.equal(
      block.includes(banned),
      false,
      `persistence log must not include ${banned}`
    );
  }
});

test("route: does not return/log receipt / envelope / canonical payload / row", () => {
  // Exactly one invocation.envelope use site (the persistence argument); the
  // receipt body / canonical payload / projection are never referenced.
  assert.equal(
    (ROUTE_SOURCE.match(/invocation\.envelope/g) ?? []).length,
    1,
    "exactly one invocation.envelope use site (the persistence argument)"
  );
  for (const banned of [
    "invocation.receipt",
    "canonicalPayload",
    "canonicalReceipt",
    ".projection",
    "...invocation",
  ]) {
    assert.equal(
      ROUTE_SOURCE.includes(banned),
      false,
      `route must not reference ${banned}`
    );
  }
});

test("route: no provider_response / raw capture / storage retention", () => {
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
