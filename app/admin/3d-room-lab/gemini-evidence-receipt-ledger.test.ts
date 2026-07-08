import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildInvocationReceipt,
  makeInvocationReference,
  makeSyntheticDigest,
  type ContractReceiptV1,
  type InvocationIdentityV1,
  type InvocationPreflightV1,
  type InvocationReceiptReferenceV1,
} from "./gemini-evidence-contract";

import {
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  toGeminiEvidenceWireEnvelopeV1,
  type GeminiEvidenceWireEnvelopeV1,
} from "./gemini-evidence-wire";

import {
  buildGeminiEvidenceReceiptLedgerRowV1,
  createFakeGeminiEvidenceReceiptLedgerClientV1,
  GER_W2_LEDGER_CONSTRAINT_NAMES,
  insertGeminiEvidenceReceiptEnvelopeForTestV1,
  verifyGeminiEvidenceReceiptLedgerRowV1,
  type GeminiEvidenceReceiptLedgerClientV1,
  type GeminiEvidenceReceiptLedgerRowV1,
} from "./gemini-evidence-receipt-ledger";

// ---------------------------------------------------------------------------
// Deterministic fixture helpers (fixed literals only; no time/random/env/fs)
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-07-07T12:00:00.000Z";

const PASSED_PREFLIGHT: InvocationPreflightV1 = {
  status: "passed",
  outboundCallStatus: "provider_call_started",
  refusalReasons: [],
};

const REFUSED_PREFLIGHT: InvocationPreflightV1 = {
  status: "refused",
  outboundCallStatus: "not_sent",
  refusalReasons: ["policy_precondition_failed"],
};

function envelopeOf(receipt: ContractReceiptV1): GeminiEvidenceWireEnvelopeV1 {
  return toGeminiEvidenceWireEnvelopeV1(receipt);
}

function initialReceipt(input: {
  receiptId: string;
  logicalInvocationId: string;
  providerAttemptId: string;
  requestId?: string | null;
  preflight?: InvocationPreflightV1;
}): ContractReceiptV1 {
  return buildInvocationReceipt({
    receiptId: input.receiptId,
    identity: {
      logicalInvocationId: input.logicalInvocationId,
      requestId: input.requestId ?? "req-" + input.receiptId,
      providerAttemptId: input.providerAttemptId,
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    preflight: input.preflight ?? PASSED_PREFLIGHT,
  });
}

function refusedInitialReceipt(input: {
  receiptId: string;
  logicalInvocationId: string;
}): ContractReceiptV1 {
  return buildInvocationReceipt({
    receiptId: input.receiptId,
    identity: {
      logicalInvocationId: input.logicalInvocationId,
      requestId: "req-" + input.receiptId,
      providerAttemptId: null,
      relationship: "initial",
      retryOfProviderAttemptId: null,
    },
    preflight: REFUSED_PREFLIGHT,
  });
}

function retryReceipt(input: {
  receiptId: string;
  logicalInvocationId: string;
  providerAttemptId: string;
  retryOfProviderAttemptId: string;
  priorInvocationReceipt: InvocationReceiptReferenceV1;
}): ContractReceiptV1 {
  return buildInvocationReceipt({
    receiptId: input.receiptId,
    identity: {
      logicalInvocationId: input.logicalInvocationId,
      requestId: "req-" + input.receiptId,
      providerAttemptId: input.providerAttemptId,
      relationship: "provider_retry",
      retryOfProviderAttemptId: input.retryOfProviderAttemptId,
    },
    preflight: PASSED_PREFLIGHT,
    priorInvocationReceipt: input.priorInvocationReceipt,
  });
}

function syntheticPriorRef(receiptId: string): InvocationReceiptReferenceV1 {
  return {
    receiptId,
    receiptType: "gemini_invocation",
    receiptDigest: makeSyntheticDigest(
      "canonical-receipt-payload-json/v1",
      "synthetic-" + receiptId
    ),
  };
}

function buildRow(
  receipt: ContractReceiptV1
): GeminiEvidenceReceiptLedgerRowV1 {
  const built = buildGeminiEvidenceReceiptLedgerRowV1({
    envelope: envelopeOf(receipt),
    createdAt: CREATED_AT,
  });
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("unreachable");
  return built.row;
}

function seed(
  client: GeminiEvidenceReceiptLedgerClientV1,
  receipt: ContractReceiptV1
): GeminiEvidenceReceiptLedgerRowV1 {
  const row = buildRow(receipt);
  const result = client.insert(row);
  assert.equal(result.ok, true);
  return row;
}

function insert(
  client: GeminiEvidenceReceiptLedgerClientV1,
  receipt: ContractReceiptV1
) {
  return insertGeminiEvidenceReceiptEnvelopeForTestV1(client, {
    envelope: envelopeOf(receipt),
    createdAt: CREATED_AT,
  });
}

function expectRefusal(
  result: { ok: boolean; reason?: string },
  reason: string
) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
}

// ---------------------------------------------------------------------------
// 1) Build a ledger row from a valid W1 envelope
// ---------------------------------------------------------------------------

test("1) builds a ledger row from a valid W1 envelope", () => {
  const receipt = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  const envelope = envelopeOf(receipt);
  const built = buildGeminiEvidenceReceiptLedgerRowV1({
    envelope,
    createdAt: CREATED_AT,
    ownerUserIdSnapshot: "owner-1",
    roomIdSnapshot: "room-1",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const { row, receipt: parsedReceipt } = built;
  assert.equal(row.receipt_id, "inv-1");
  assert.equal(row.receipt_type, "gemini_invocation");
  assert.equal(row.receipt_schema_version, receipt.header.schemaVersion);
  assert.equal(row.canonical_payload, envelope.canonicalReceipt);
  assert.equal(row.receipt_digest_hex, receipt.header.receiptDigest.value);
  assert.equal(row.receipt_digest_scope, "canonical-receipt-payload-json/v1");
  assert.equal(row.receipt_created_at_iso, receipt.header.createdAtIso);
  assert.equal(row.created_at, CREATED_AT);
  assert.equal(row.logical_invocation_id, "lid-1");
  assert.equal(row.provider_attempt_id, "attempt-0");
  assert.equal(row.retry_of_provider_attempt_id, null);
  assert.equal(row.request_correlation_id, "req-inv-1");
  assert.equal(row.owner_user_id_snapshot, "owner-1");
  assert.equal(row.room_id_snapshot, "room-1");
  assert.equal(row.asset_id_snapshot, null);
  assert.equal(row.version_id_snapshot, null);
  assert.deepEqual(parsedReceipt, receipt);
});

// ---------------------------------------------------------------------------
// 2–11) Readback verifier
// ---------------------------------------------------------------------------

test("2) readback verifier accepts a valid row", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const result = verifyGeminiEvidenceReceiptLedgerRowV1(row);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.receipt.header.receiptId, "inv-1");
});

test("3) readback verifier refuses tampered canonical_payload", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered = { ...row, canonical_payload: row.canonical_payload + " " };
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_noncanonical_receipt_text"
  );
});

test("4) readback verifier refuses tampered receipt_id projection", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered = { ...row, receipt_id: "tampered-id" };
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_projection_mismatch:receiptId"
  );
});

test("5) readback verifier refuses tampered receipt_type projection", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered: GeminiEvidenceReceiptLedgerRowV1 = {
    ...row,
    receipt_type: "gemini_provider_response",
  };
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_projection_mismatch:receiptType"
  );
});

test("6) readback verifier refuses tampered receipt_schema_version", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered = { ...row, receipt_schema_version: "other-schema/v9" };
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_projection_mismatch:receiptSchemaVersion"
  );
});

test("7) readback verifier refuses tampered receipt_digest_hex", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered = { ...row, receipt_digest_hex: "a".repeat(64) };
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_projection_mismatch:receiptDigestHex"
  );
});

test("8) readback verifier refuses tampered receipt_digest_scope", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered = {
    ...row,
    receipt_digest_scope: "storage-binding-json/v1",
  } as unknown as GeminiEvidenceReceiptLedgerRowV1;
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_projection_mismatch:receiptDigestScope"
  );
});

test("9) readback verifier refuses tampered logical_invocation_id", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const tampered = { ...row, logical_invocation_id: "wrong-lid" };
  expectRefusal(
    verifyGeminiEvidenceReceiptLedgerRowV1(tampered),
    "ledger_readback_wire:wire_projection_mismatch:logicalInvocationId"
  );
});

test("10) readback verifier ignores changed created_at", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const altered = { ...row, created_at: "1999-12-31T23:59:59.999Z" };
  const result = verifyGeminiEvidenceReceiptLedgerRowV1(altered);
  assert.equal(result.ok, true);
});

test("11) readback verifier ignores changed snapshot fields", () => {
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const altered = {
    ...row,
    owner_user_id_snapshot: "changed-owner",
    room_id_snapshot: "changed-room",
    asset_id_snapshot: "changed-asset",
    version_id_snapshot: "changed-version",
  };
  const result = verifyGeminiEvidenceReceiptLedgerRowV1(altered);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// 12–13) Insert + idempotency
// ---------------------------------------------------------------------------

test("12) insert valid initial invocation -> inserted", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const result = insert(
    client,
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, "inserted");
    assert.equal(result.row.receipt_id, "inv-1");
  }
});

test("13) exact duplicate initial -> idempotent even if fake reports a non-PK constraint", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1({
    // Report the retry-fork constraint even though the PK also collides, to
    // prove classification is lookup-driven, not constraint-driven.
    pickConstraint: () => GER_W2_LEDGER_CONSTRAINT_NAMES.retryFork,
  });
  const receipt = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  const first = insert(client, receipt);
  assert.equal(first.ok, true);

  const second = insert(client, receipt);
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.outcome, "idempotent");
    assert.equal(second.row.receipt_id, "inv-1");
  }
});

// ---------------------------------------------------------------------------
// 14–17) Lookup-driven conflict classification
// ---------------------------------------------------------------------------

test("14) same receipt_id + different payload -> ledger_receipt_integrity_conflict", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const first = initialReceipt({
    receiptId: "dup",
    logicalInvocationId: "lid",
    providerAttemptId: "attempt-0",
    requestId: "req-1",
  });
  const second = initialReceipt({
    receiptId: "dup",
    logicalInvocationId: "lid",
    providerAttemptId: "attempt-0",
    requestId: "req-2",
  });
  assert.equal(insert(client, first).ok, true);
  expectRefusal(insert(client, second), "ledger_receipt_integrity_conflict");
});

test("15) same digest + different receipt_id -> ledger_digest_id_mismatch", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const receiptN = initialReceipt({
    receiptId: "N",
    logicalInvocationId: "lid-n",
    providerAttemptId: "attempt-n",
  });
  const rowN = buildRow(receiptN);
  // Seed a forged row that shares N's digest but carries a different receipt_id.
  const forgedSeed: GeminiEvidenceReceiptLedgerRowV1 = {
    ...rowN,
    receipt_id: "S",
  };
  assert.equal(client.insert(forgedSeed).ok, true);
  expectRefusal(insert(client, receiptN), "ledger_digest_id_mismatch");
});

test("16) same provider_attempt_id + different receipt -> ledger_provider_attempt_reused", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const seedReceipt = initialReceipt({
    receiptId: "s",
    logicalInvocationId: "lid-s",
    providerAttemptId: "shared-attempt",
  });
  const newReceipt = initialReceipt({
    receiptId: "n",
    logicalInvocationId: "lid-n",
    providerAttemptId: "shared-attempt",
  });
  assert.equal(insert(client, seedReceipt).ok, true);
  expectRefusal(insert(client, newReceipt), "ledger_provider_attempt_reused");
});

test("17) same retry-fork key + different receipt -> ledger_forked_invocation_lineage", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const seedReceipt = initialReceipt({
    receiptId: "s",
    logicalInvocationId: "lid-fork",
    providerAttemptId: "attempt-s",
  });
  const newReceipt = initialReceipt({
    receiptId: "n",
    logicalInvocationId: "lid-fork",
    providerAttemptId: "attempt-n",
  });
  assert.equal(insert(client, seedReceipt).ok, true);
  expectRefusal(insert(client, newReceipt), "ledger_forked_invocation_lineage");
});

// ---------------------------------------------------------------------------
// 18–20) Full prior-chain retry validation (R1)
// ---------------------------------------------------------------------------

test("18) valid retry1 referencing initial -> inserted", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const initial = initialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  assert.equal(insert(client, initial).ok, true);

  const retry1 = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  const result = insert(client, retry1);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.outcome, "inserted");
});

test("19) valid retry2 referencing retry1 -> inserted (full-chain validation)", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const initial = initialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  const retry1 = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  const retry2 = retryReceipt({
    receiptId: "inv-2",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-2",
    retryOfProviderAttemptId: "attempt-1",
    priorInvocationReceipt: makeInvocationReference(retry1),
  });
  assert.equal(insert(client, initial).ok, true);
  assert.equal(insert(client, retry1).ok, true);
  const result = insert(client, retry2);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.outcome, "inserted");
});

test("20) retry2 fails if initial ancestor is missing from the store", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const initial = initialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  const retry1 = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  const retry2 = retryReceipt({
    receiptId: "inv-2",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-2",
    retryOfProviderAttemptId: "attempt-1",
    priorInvocationReceipt: makeInvocationReference(retry1),
  });
  // Seed retry1 directly WITHOUT the initial ancestor.
  seed(client, retry1);
  expectRefusal(
    insert(client, retry2),
    "ledger_retry_chain:missing_referenced_receipt"
  );
});

// ---------------------------------------------------------------------------
// 21–27) Retry-chain refusals
// ---------------------------------------------------------------------------

test("21) provider_retry referencing missing immediate prior -> missing_referenced_receipt", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const retry = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: syntheticPriorRef("inv-0"),
  });
  expectRefusal(
    insert(client, retry),
    "ledger_retry_chain:missing_referenced_receipt"
  );
});

test("22) provider_retry with prior digest mismatch -> referenced_receipt_digest_mismatch", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const initial = initialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  seed(client, initial);
  // Reference the correct id/type but a wrong (well-formed) digest value.
  const retry = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: syntheticPriorRef("inv-0"),
  });
  expectRefusal(
    insert(client, retry),
    "ledger_retry_chain:referenced_receipt_digest_mismatch"
  );
});

test("23) provider_retry with cross-logical prior -> cross_logical_invocation_reference", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const initial = initialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-A",
    providerAttemptId: "attempt-0",
  });
  seed(client, initial);
  const retry = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-B",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  expectRefusal(
    insert(client, retry),
    "ledger_retry_chain:cross_logical_invocation_reference"
  );
});

test("24) provider_retry with wrong prior attempt id -> wrong_prior_attempt_id", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const initial = initialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  seed(client, initial);
  const retry = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-WRONG",
    priorInvocationReceipt: makeInvocationReference(initial),
  });
  expectRefusal(
    insert(client, retry),
    "ledger_retry_chain:wrong_prior_attempt_id"
  );
});

test("25) provider_retry referencing preflight refusal -> wrong_prior_attempt_id", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const refused = refusedInitialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
  });
  seed(client, refused);
  const retry = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-0",
    priorInvocationReceipt: makeInvocationReference(refused),
  });
  // The refused prior has a null providerAttemptId, so the full-chain kernel
  // resolution reaches wrong_prior_attempt_id.
  expectRefusal(
    insert(client, retry),
    "ledger_retry_chain:wrong_prior_attempt_id"
  );
});

test("26) provider_retry referencing prior with no outbound call -> exact kernel refusal", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  // A prior whose outbound call never started is expressed as a refused
  // preflight (not_sent, null provider attempt). The full-chain kernel
  // resolution reaches wrong_prior_attempt_id because the prior attempt is null.
  const refused = refusedInitialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
  });
  seed(client, refused);
  const retry = retryReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
    retryOfProviderAttemptId: "attempt-99",
    priorInvocationReceipt: makeInvocationReference(refused),
  });
  expectRefusal(
    insert(client, retry),
    "ledger_retry_chain:wrong_prior_attempt_id"
  );
});

test("27) retry cycle in the fake store refuses via visited-set guard", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  // Seed a 2-cycle A <-> B directly (each individually valid at W1; each
  // tolerates its missing prior). Neither is a self-reference.
  const receiptA = retryReceipt({
    receiptId: "A",
    logicalInvocationId: "lid-cycle",
    providerAttemptId: "attempt-a",
    retryOfProviderAttemptId: "attempt-b",
    priorInvocationReceipt: syntheticPriorRef("B"),
  });
  const receiptB = retryReceipt({
    receiptId: "B",
    logicalInvocationId: "lid-cycle",
    providerAttemptId: "attempt-b",
    retryOfProviderAttemptId: "attempt-a",
    priorInvocationReceipt: syntheticPriorRef("A"),
  });
  seed(client, receiptA);
  seed(client, receiptB);

  const current = retryReceipt({
    receiptId: "C",
    logicalInvocationId: "lid-cycle",
    providerAttemptId: "attempt-c",
    retryOfProviderAttemptId: "attempt-a",
    priorInvocationReceipt: makeInvocationReference(receiptA),
  });
  expectRefusal(
    insert(client, current),
    "ledger_retry_chain:retry_reference_cycle"
  );
});

// ---------------------------------------------------------------------------
// 28) Refused-preflight occupies the null retry-fork key
// ---------------------------------------------------------------------------

test("28) refused-preflight initial occupies null fork key; second same-logical initial -> forked lineage", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const refused = refusedInitialReceipt({
    receiptId: "inv-0",
    logicalInvocationId: "lid-1",
  });
  assert.equal(insert(client, refused).ok, true);

  const second = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-1",
  });
  expectRefusal(insert(client, second), "ledger_forked_invocation_lineage");
});

// ---------------------------------------------------------------------------
// 29–30) Arbitrary reported constraint never drives classification
// ---------------------------------------------------------------------------

test("29) arbitrary reported constraint still resolves exact duplicate as idempotent", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1({
    pickConstraint: () => GER_W2_LEDGER_CONSTRAINT_NAMES.receiptDigestHex,
  });
  const receipt = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  assert.equal(insert(client, receipt).ok, true);
  const second = insert(client, receipt);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.outcome, "idempotent");
});

test("30) arbitrary reported constraint still resolves non-duplicate by lookup order", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1({
    // Force the provider-attempt constraint even though the digest collision is
    // the one that classification must resolve first by lookup order.
    pickConstraint: (violated) =>
      violated.includes(GER_W2_LEDGER_CONSTRAINT_NAMES.providerAttemptId)
        ? GER_W2_LEDGER_CONSTRAINT_NAMES.providerAttemptId
        : violated[0],
  });
  const receiptN = initialReceipt({
    receiptId: "N",
    logicalInvocationId: "lid-n",
    providerAttemptId: "attempt-n",
  });
  const rowN = buildRow(receiptN);
  const forgedSeed: GeminiEvidenceReceiptLedgerRowV1 = {
    ...rowN,
    receipt_id: "S",
  };
  assert.equal(client.insert(forgedSeed).ok, true);
  expectRefusal(insert(client, receiptN), "ledger_digest_id_mismatch");
});

// ---------------------------------------------------------------------------
// 31) Post-insert readback failure
// ---------------------------------------------------------------------------

test("31) insert success then readback failure -> ledger_readback_verification_failed", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1({
    // Corrupt only the canonical_payload of the persisted row (no key column),
    // so the row inserts and reads back by id but fails readback verification.
    onStore: (row) => ({
      ...row,
      canonical_payload: row.canonical_payload + " ",
    }),
  });
  const result = insert(
    client,
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  expectRefusal(result, "ledger_readback_verification_failed");
});

// ---------------------------------------------------------------------------
// 33) Idempotent path verifies readback before returning success
// ---------------------------------------------------------------------------

test("33) idempotent path refuses when stored row fails readback despite intact payload/digest", () => {
  const client = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const receipt = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  const validRow = buildRow(receipt);

  // Seed a corrupted stored row: canonical_payload + receipt_digest_hex are
  // intact (so it looks byte-identical), but a projection column is corrupted.
  const corruptedStored: GeminiEvidenceReceiptLedgerRowV1 = {
    ...validRow,
    logical_invocation_id: "corrupted-lid",
  };
  assert.equal(client.insert(corruptedStored).ok, true);

  // Inserting the same valid receipt collides on receipt_id and reaches the
  // idempotent branch, which must verify the stored row before succeeding.
  expectRefusal(
    insert(client, receipt),
    "ledger_idempotent_readback_verification_failed"
  );
});

// ---------------------------------------------------------------------------
// 32) Scope-containment self-check
// ---------------------------------------------------------------------------

test("32) the ledger module imports only the W1/W0 kernel and no prohibited dependency", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-receipt-ledger.ts", import.meta.url),
    "utf8"
  );

  const fromTargets = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(fromTargets.length >= 1, "expected at least one import");
  const allowed = new Set([
    "./gemini-evidence-contract",
    "./gemini-evidence-wire",
  ]);
  for (const target of fromTargets) {
    assert.equal(
      allowed.has(target),
      true,
      `unexpected import target: ${target}`
    );
  }

  assert.equal(/\brequire\(/.test(source), false, "must not use require()");
  // Anchor to a real import statement (line start), never a prose mention.
  assert.equal(
    /^\s*import\s+["']server-only["']/m.test(source),
    false,
    "must not import server-only"
  );

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
    "Date.now",
    "Math.random",
    "process.env",
  ];
  for (const fragment of forbiddenFragments) {
    assert.equal(
      source.includes(fragment),
      false,
      `module must not reference ${fragment}`
    );
  }
});
