import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

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
  createGeminiEvidenceReceiptLedgerServiceClient,
  createSupabaseGeminiEvidenceReceiptLedgerClientV1,
  GeminiEvidenceLedgerReadError,
  GER_W2_LEDGER_CONSTRAINT_NAMES,
  GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON,
  GER_W2_LEDGER_TABLE,
  insertGeminiEvidenceReceiptEnvelopeForTestV1,
  insertGeminiEvidenceReceiptEnvelopeV1,
  isGeminiEvidenceLedgerUniqueViolationError,
  resolveGeminiEvidenceReceiptLedgerServiceEnv,
  verifyGeminiEvidenceReceiptLedgerRowV1,
  type AsyncGeminiEvidenceReceiptLedgerClientV1,
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
// W2D deterministic mock helpers (no real database, no Supabase network)
// ---------------------------------------------------------------------------

/**
 * Wrap the synchronous W2B fake client as an async ledger client. Unique
 * violations are surfaced with the stable ledger_unique_violation reason so the
 * async insert helper classifies by lookup order, mirroring the real adapter.
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

function asyncInsert(
  client: AsyncGeminiEvidenceReceiptLedgerClientV1,
  receipt: ContractReceiptV1
) {
  return insertGeminiEvidenceReceiptEnvelopeV1(client, {
    envelope: envelopeOf(receipt),
    createdAt: CREATED_AT,
  });
}

type SupabaseCallLog = {
  tables: string[];
  selects: string[];
  filters: Array<{ op: string; col: string; val: unknown }>;
  inserts: unknown[];
  upsertCount: number;
  ignoreDuplicatesSeen: boolean;
  maybeSingleCount: number;
};

type MockSupabaseConfig = {
  insertResult?: { data: unknown; error: unknown };
  readResult?: { data: unknown; error: unknown };
};

/**
 * A minimal deterministic Supabase-shaped mock. It records the table, the
 * select/filter chain, and insert payloads so tests can assert the adapter's
 * query shape without any database or network access.
 */
function createMockSupabase(config: MockSupabaseConfig = {}): {
  supabase: SupabaseClient;
  calls: SupabaseCallLog;
} {
  const calls: SupabaseCallLog = {
    tables: [],
    selects: [],
    filters: [],
    inserts: [],
    upsertCount: 0,
    ignoreDuplicatesSeen: false,
    maybeSingleCount: 0,
  };

  const builder = {
    select(cols: string) {
      calls.selects.push(cols);
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.filters.push({ op: "eq", col, val });
      return builder;
    },
    is(col: string, val: unknown) {
      calls.filters.push({ op: "is", col, val });
      return builder;
    },
    insert(payload: unknown) {
      calls.inserts.push(payload);
      return Promise.resolve(config.insertResult ?? { data: null, error: null });
    },
    upsert(payload: unknown, opts?: { ignoreDuplicates?: boolean }) {
      void payload;
      calls.upsertCount += 1;
      if (opts?.ignoreDuplicates) calls.ignoreDuplicatesSeen = true;
      return Promise.resolve(config.insertResult ?? { data: null, error: null });
    },
    maybeSingle() {
      calls.maybeSingleCount += 1;
      return Promise.resolve(config.readResult ?? { data: null, error: null });
    },
  };

  const supabase = {
    from(table: string) {
      calls.tables.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { supabase, calls };
}

function initialEnvelopeInput(receipt: ContractReceiptV1) {
  return { envelope: envelopeOf(receipt), createdAt: CREATED_AT };
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

// 32 / 50) Source-containment self-check updated for the W2D allowed imports.
test("32) the ledger module imports only the W2D-allowed dependencies", () => {
  const source = readFileSync(
    new URL("./gemini-evidence-receipt-ledger.ts", import.meta.url),
    "utf8"
  );

  const fromTargets = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(fromTargets.length >= 1, "expected at least one import");
  // W2D allows exactly the frozen kernel/wire plus the Supabase JS client.
  const allowed = new Set([
    "./gemini-evidence-contract",
    "./gemini-evidence-wire",
    "@supabase/supabase-js",
  ]);
  for (const target of fromTargets) {
    assert.equal(
      allowed.has(target),
      true,
      `unexpected import target: ${target}`
    );
  }

  assert.equal(/\brequire\(/.test(source), false, "must not use require()");

  const forbiddenFragments = [
    "app/api/",
    "lib/vibodeGemini",
    "lib/vibodeAssetFinalization",
    "lib/adminServer",
    "lib/sceneHash",
    "next/headers",
    'from "next',
    'from "react',
    'from "fs"',
    'from "node:fs"',
    'from "node:crypto"',
    "Date.now",
    "Math.random",
  ];
  for (const fragment of forbiddenFragments) {
    assert.equal(
      source.includes(fragment),
      false,
      `module must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 34–35) W2D service-role client factory (source + fail-closed env)
// ---------------------------------------------------------------------------

test('34) service module uses executable import "server-only" and no server-auth deps', () => {
  const source = readFileSync(
    new URL("./gemini-evidence-receipt-ledger.ts", import.meta.url),
    "utf8"
  );
  // Must use a real, executable server-only guard import statement.
  assert.equal(
    /^\s*import\s+["']server-only["']\s*;?\s*$/m.test(source),
    true,
    'W2D must use executable import "server-only";'
  );
  // Must NOT use an inert bare "server-only"; expression statement.
  assert.equal(
    /^\s*["']server-only["']\s*;/m.test(source),
    false,
    "W2D must not use an inert bare server-only string statement"
  );
  assert.equal(
    source.includes("next/headers"),
    false,
    "service module must not import next/headers"
  );
  assert.equal(
    source.includes("adminServer"),
    false,
    "service module must not import lib/adminServer"
  );
});

test("35) service client factory fails closed on missing env and builds on complete env", () => {
  // Fail-closed behavior is exercised with explicit env objects; the real
  // ambient process.env is never read here.
  assert.equal(resolveGeminiEvidenceReceiptLedgerServiceEnv({}).ok, false);

  const partial = resolveGeminiEvidenceReceiptLedgerServiceEnv({
    SUPABASE_URL: "https://example.supabase.co",
  });
  assert.equal(partial.ok, false);
  if (!partial.ok) {
    assert.equal(partial.reason, GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON);
  }

  const complete = resolveGeminiEvidenceReceiptLedgerServiceEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  });
  assert.equal(complete.ok, true);
  if (complete.ok) {
    assert.equal(complete.url, "https://example.supabase.co");
    assert.equal(complete.serviceRoleKey, "service-role-key");
  }

  assert.throws(
    () => createGeminiEvidenceReceiptLedgerServiceClient({}),
    (err: unknown) =>
      err instanceof Error &&
      err.message === GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON
  );

  const client = createGeminiEvidenceReceiptLedgerServiceClient({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  });
  assert.equal(typeof client, "object");
  assert.ok(client !== null);
  assert.equal(typeof client.from, "function");
});

// ---------------------------------------------------------------------------
// 36–41) Supabase adapter query shape (deterministic mock Supabase)
// ---------------------------------------------------------------------------

test("36) supabase adapter insert targets the receipt table exactly once with no upsert", async () => {
  const { supabase, calls } = createMockSupabase({
    insertResult: { data: null, error: null },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const row = buildRow(
    initialReceipt({
      receiptId: "inv-1",
      logicalInvocationId: "lid-1",
      providerAttemptId: "attempt-0",
    })
  );
  const result = await client.insert(row);
  assert.deepEqual(result, { ok: true });
  assert.equal(GER_W2_LEDGER_TABLE, "vibode_gemini_evidence_receipts");
  assert.deepEqual(calls.tables, [GER_W2_LEDGER_TABLE]);
  assert.equal(calls.inserts.length, 1);
  assert.equal(calls.inserts[0], row);
  assert.equal(calls.upsertCount, 0);
  assert.equal(calls.ignoreDuplicatesSeen, false);
});

test("37) supabase adapter readByReceiptId filters receipt_id and maps no-row to null", async () => {
  const { supabase, calls } = createMockSupabase({
    readResult: { data: null, error: null },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const result = await client.readByReceiptId("inv-x");
  assert.equal(result, null);
  assert.deepEqual(calls.tables, [GER_W2_LEDGER_TABLE]);
  assert.equal(calls.maybeSingleCount, 1);
  assert.ok(
    calls.filters.some(
      (f) => f.op === "eq" && f.col === "receipt_id" && f.val === "inv-x"
    ),
    "expected an eq filter on receipt_id"
  );
});

test("38) supabase adapter readByDigestHex queries receipt_digest_hex", async () => {
  const { supabase, calls } = createMockSupabase({
    readResult: { data: null, error: null },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const digest = "a".repeat(64);
  const result = await client.readByDigestHex(digest);
  assert.equal(result, null);
  assert.ok(
    calls.filters.some(
      (f) => f.op === "eq" && f.col === "receipt_digest_hex" && f.val === digest
    ),
    "expected an eq filter on receipt_digest_hex"
  );
});

test("39) supabase adapter readByProviderAttemptId queries provider_attempt_id", async () => {
  const { supabase, calls } = createMockSupabase({
    readResult: { data: null, error: null },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const result = await client.readByProviderAttemptId("attempt-7");
  assert.equal(result, null);
  assert.ok(
    calls.filters.some(
      (f) =>
        f.op === "eq" && f.col === "provider_attempt_id" && f.val === "attempt-7"
    ),
    "expected an eq filter on provider_attempt_id"
  );
});

test("40) supabase adapter readByRetryForkKey uses IS NULL branch for null predecessor", async () => {
  const { supabase, calls } = createMockSupabase({
    readResult: { data: null, error: null },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const result = await client.readByRetryForkKey({
    logicalInvocationId: "lid-1",
    retryOfProviderAttemptId: null,
  });
  assert.equal(result, null);
  assert.ok(
    calls.filters.some(
      (f) =>
        f.op === "eq" && f.col === "logical_invocation_id" && f.val === "lid-1"
    ),
    "expected an eq filter on logical_invocation_id"
  );
  assert.ok(
    calls.filters.some(
      (f) =>
        f.op === "is" &&
        f.col === "retry_of_provider_attempt_id" &&
        f.val === null
    ),
    "expected an IS NULL filter on retry_of_provider_attempt_id"
  );
  assert.equal(
    calls.filters.some(
      (f) => f.op === "eq" && f.col === "retry_of_provider_attempt_id"
    ),
    false,
    "must not use an equality predicate for a null predecessor"
  );
});

test("41) supabase adapter readByRetryForkKey uses equality branch for non-null predecessor", async () => {
  const { supabase, calls } = createMockSupabase({
    readResult: { data: null, error: null },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const result = await client.readByRetryForkKey({
    logicalInvocationId: "lid-1",
    retryOfProviderAttemptId: "attempt-0",
  });
  assert.equal(result, null);
  assert.ok(
    calls.filters.some(
      (f) =>
        f.op === "eq" &&
        f.col === "retry_of_provider_attempt_id" &&
        f.val === "attempt-0"
    ),
    "expected an equality predicate on retry_of_provider_attempt_id"
  );
  assert.equal(
    calls.filters.some(
      (f) => f.op === "is" && f.col === "retry_of_provider_attempt_id"
    ),
    false,
    "must not use an IS NULL predicate for a non-null predecessor"
  );
});

// ---------------------------------------------------------------------------
// 42–47) Async insert protocol (mirrors the W2B fake-client decision logic)
// ---------------------------------------------------------------------------

test("42) async insert of a valid initial invocation -> inserted", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
  const result = await asyncInsert(
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

test("43) async exact duplicate with arbitrary unique violation -> idempotent after readback", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1({
      pickConstraint: () => GER_W2_LEDGER_CONSTRAINT_NAMES.retryFork,
    })
  );
  const receipt = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  assert.equal((await asyncInsert(client, receipt)).ok, true);
  const second = await asyncInsert(client, receipt);
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.outcome, "idempotent");
    assert.equal(second.row.receipt_id, "inv-1");
  }
});

test("44) async idempotent duplicate with corrupted stored projection -> idempotent readback failure", async () => {
  const sync = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const client = toAsyncLedgerClient(sync);
  const receipt = initialReceipt({
    receiptId: "inv-1",
    logicalInvocationId: "lid-1",
    providerAttemptId: "attempt-0",
  });
  const validRow = buildRow(receipt);
  // Payload + digest are intact (looks byte-identical), but a projection column
  // is corrupted, so the idempotent branch must fail readback verification.
  const corruptedStored: GeminiEvidenceReceiptLedgerRowV1 = {
    ...validRow,
    logical_invocation_id: "corrupted-lid",
  };
  assert.equal(sync.insert(corruptedStored).ok, true);
  expectRefusal(
    await asyncInsert(client, receipt),
    "ledger_idempotent_readback_verification_failed"
  );
});

test("45) async unique violation with no matching lookups -> unclassified", async () => {
  const client: AsyncGeminiEvidenceReceiptLedgerClientV1 = {
    async insert() {
      return { ok: false, reason: "ledger_unique_violation" };
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
  expectRefusal(
    await asyncInsert(
      client,
      initialReceipt({
        receiptId: "inv-1",
        logicalInvocationId: "lid-1",
        providerAttemptId: "attempt-0",
      })
    ),
    "ledger_unclassified_unique_violation"
  );
});

test("46) async provider_retry valid full chain initial->retry1->retry2 -> inserted", async () => {
  const client = toAsyncLedgerClient(
    createFakeGeminiEvidenceReceiptLedgerClientV1()
  );
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
  assert.equal((await asyncInsert(client, initial)).ok, true);
  assert.equal((await asyncInsert(client, retry1)).ok, true);
  const result = await asyncInsert(client, retry2);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.outcome, "inserted");
});

test("47) async provider_retry missing ancestor -> missing_referenced_receipt", async () => {
  const sync = createFakeGeminiEvidenceReceiptLedgerClientV1();
  const client = toAsyncLedgerClient(sync);
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
  // Seed retry1 directly WITHOUT its initial ancestor.
  assert.equal(sync.insert(buildRow(retry1)).ok, true);
  expectRefusal(
    await asyncInsert(client, retry2),
    "ledger_retry_chain:missing_referenced_receipt"
  );
});

// ---------------------------------------------------------------------------
// 48–49) Adapter-surfaced insert/read errors -> stable ledger_ reasons
// ---------------------------------------------------------------------------

test("48) async non-unique insert error -> ledger_insert_failed", async () => {
  const { supabase } = createMockSupabase({
    insertResult: { data: null, error: { code: "XX000", message: "boom" } },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const result = await insertGeminiEvidenceReceiptEnvelopeV1(
    client,
    initialEnvelopeInput(
      initialReceipt({
        receiptId: "inv-1",
        logicalInvocationId: "lid-1",
        providerAttemptId: "attempt-0",
      })
    )
  );
  expectRefusal(result, "ledger_insert_failed");
  // A 23505 error would instead be classified as a unique violation.
  assert.equal(
    isGeminiEvidenceLedgerUniqueViolationError({ code: "XX000" }),
    false
  );
  assert.equal(
    isGeminiEvidenceLedgerUniqueViolationError({ code: "23505" }),
    true
  );
});

test("49) async read query error -> ledger_read_failed", async () => {
  const { supabase } = createMockSupabase({
    insertResult: { data: null, error: null },
    readResult: { data: null, error: { code: "XX000", message: "boom" } },
  });
  const client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
  const result = await insertGeminiEvidenceReceiptEnvelopeV1(
    client,
    initialEnvelopeInput(
      initialReceipt({
        receiptId: "inv-1",
        logicalInvocationId: "lid-1",
        providerAttemptId: "attempt-0",
      })
    )
  );
  expectRefusal(result, "ledger_read_failed");

  // The adapter surfaces genuine query errors as a typed read error.
  await assert.rejects(
    async () => client.readByReceiptId("inv-1"),
    (err: unknown) => err instanceof GeminiEvidenceLedgerReadError
  );
});
