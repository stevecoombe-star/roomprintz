// GER-W2B / GER-W2D — Receipt Ledger Row Model, Readback Verifier, Fake-Client
// Repository Decision Logic (W2B) plus the real service-role client factory and
// Supabase-backed ledger adapter (W2D).
//
// This module is a lab-only, deterministic-at-its-core continuation of the
// frozen GER-I0 kernel and GER-W1 wire adapter. It defines the W2 ledger row
// shape, a pure row builder from a W1 envelope, a readback verifier that
// re-derives receipt truth exclusively from the canonical payload + the ten
// projection columns, and an in-memory fake-client repository that models the
// W2 unique-constraint surface for deterministic decision-logic tests (W2B).
//
// W2D extends this with:
//   * a real service-role Supabase client factory that fails closed on missing
//     env (never reaching for the server-auth cookie helper module),
//   * an async ledger client interface plus a Supabase adapter that targets
//     public.vibode_gemini_evidence_receipts exactly, and
//   * an async insert helper that mirrors the W2B decision protocol (R1 full
//     prior-chain validation, R2 lookup-driven conflict classification, and
//     post-insert / idempotent readback verification).
//
// The W2B pure logic is preserved verbatim. Canonicalization, hashing, and
// strict wire parsing are never reimplemented; they are delegated to GER-W1.
//
// Allowed imports for W2D are the executable server-only guard, the Supabase JS
// client, and the frozen contract + wire modules. It must NOT import the Next
// framework, its header helper, React, filesystem, node crypto, route handlers,
// the server-auth cookie helper module, the usage-accounting lib, the asset
// finalization lib, the scene-hash helper, storage helpers, or scene/camera
// modules. It never applies migrations, captures raw wire bytes, retains
// artifacts, integrates with routes, or grants any camera/calibration authority.
//
// Recorded design notes:
//   R3 — the GER-W2C migration pins
//        receipt_schema_version = "gemini-evidence-contract/ger-i0/v1"
//        (RECEIPT_SCHEMA_VERSION) as a hard column check.
//   R4 — the W2D service surface uses a real, executable `import "server-only";`
//        statement (not an inert bare string expression that is never
//        evaluated). This module now satisfies R4.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateReceiptSet,
  type ContractReceiptV1,
  type GeminiEvidenceReceiptTypeV1,
  type InvocationBodyV1,
} from "./gemini-evidence-contract";

import {
  GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION,
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  parseGeminiEvidenceWireEnvelopeV1,
  type GeminiEvidenceWireEnvelopeV1,
} from "./gemini-evidence-wire";

// ---------------------------------------------------------------------------
// Section 1 — Pure future-table row type
// ---------------------------------------------------------------------------

/**
 * The planned GER-W2 ledger row.
 *
 * Field classification:
 *   canonical_payload         = authoritative receipt truth (the exact W1
 *                               envelope.canonicalReceipt bytes).
 *   the 10 projection columns = derived from the W1 projection, never used to
 *                               reconstruct receipt truth beyond re-supplying
 *                               them to the wire parser for cross-check.
 *   created_at                = server observation metadata, EXCLUDED from
 *                               readback payload verification.
 *   *_snapshot columns        = advisory access snapshots, EXCLUDED from
 *                               readback payload verification.
 *
 * R3 note: the W2C migration must pin receipt_schema_version to
 * "gemini-evidence-contract/ger-i0/v1". W2B does not create that migration.
 */
export type GeminiEvidenceReceiptLedgerRowV1 = {
  receipt_id: string;
  receipt_type: GeminiEvidenceReceiptTypeV1;
  receipt_schema_version: string;
  canonical_payload: string;
  receipt_digest_hex: string;
  receipt_digest_scope: "canonical-receipt-payload-json/v1";
  receipt_created_at_iso: string;
  created_at: string;

  logical_invocation_id: string | null;
  provider_attempt_id: string | null;
  retry_of_provider_attempt_id: string | null;
  request_correlation_id: string | null;

  owner_user_id_snapshot: string | null;
  room_id_snapshot: string | null;
  asset_id_snapshot: string | null;
  version_id_snapshot: string | null;
};

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

export type LedgerBuildResultV1 =
  | { ok: true; row: GeminiEvidenceReceiptLedgerRowV1; receipt: ContractReceiptV1 }
  | { ok: false; reason: string };

export type LedgerVerifyResultV1 =
  | { ok: true; receipt: ContractReceiptV1 }
  | { ok: false; reason: string };

export type GeminiEvidenceReceiptInsertResultV1 =
  | {
      ok: true;
      outcome: "inserted" | "idempotent";
      row: GeminiEvidenceReceiptLedgerRowV1;
    }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Section 2 — Pure row construction from a W1 envelope
// ---------------------------------------------------------------------------

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Build a ledger row from a W1 envelope. The envelope is parsed through the
 * frozen GER-W1 adapter; the row's canonical_payload is the returned
 * canonicalReceipt EXACTLY, and every projection column is copied from the W1
 * projection. A receipt is never constructed from projection values, and
 * created_at / snapshots are never verified against the payload.
 */
export function buildGeminiEvidenceReceiptLedgerRowV1(input: {
  envelope: unknown;
  createdAt: string;
  ownerUserIdSnapshot?: string | null;
  roomIdSnapshot?: string | null;
  assetIdSnapshot?: string | null;
  versionIdSnapshot?: string | null;
}): LedgerBuildResultV1 {
  if (typeof input.createdAt !== "string" || input.createdAt.length === 0) {
    return { ok: false, reason: "ledger_invalid_created_at" };
  }
  const ownerUserIdSnapshot = input.ownerUserIdSnapshot ?? null;
  const roomIdSnapshot = input.roomIdSnapshot ?? null;
  const assetIdSnapshot = input.assetIdSnapshot ?? null;
  const versionIdSnapshot = input.versionIdSnapshot ?? null;
  if (
    !isNullableString(ownerUserIdSnapshot) ||
    !isNullableString(roomIdSnapshot) ||
    !isNullableString(assetIdSnapshot) ||
    !isNullableString(versionIdSnapshot)
  ) {
    return { ok: false, reason: "ledger_invalid_snapshot" };
  }

  const parsed = parseGeminiEvidenceWireEnvelopeV1(input.envelope);
  if (!parsed.ok) {
    return { ok: false, reason: `ledger_wire_parse:${parsed.reason}` };
  }

  const projection = parsed.value.projection;
  const row: GeminiEvidenceReceiptLedgerRowV1 = {
    receipt_id: projection.receiptId,
    receipt_type: projection.receiptType,
    receipt_schema_version: projection.receiptSchemaVersion,
    canonical_payload: parsed.value.canonicalReceipt,
    receipt_digest_hex: projection.receiptDigestHex,
    receipt_digest_scope: projection.receiptDigestScope,
    receipt_created_at_iso: projection.receiptCreatedAtIso,
    created_at: input.createdAt,

    logical_invocation_id: projection.logicalInvocationId,
    provider_attempt_id: projection.providerAttemptId,
    retry_of_provider_attempt_id: projection.retryOfProviderAttemptId,
    request_correlation_id: projection.requestCorrelationId,

    owner_user_id_snapshot: ownerUserIdSnapshot,
    room_id_snapshot: roomIdSnapshot,
    asset_id_snapshot: assetIdSnapshot,
    version_id_snapshot: versionIdSnapshot,
  };

  return { ok: true, row, receipt: parsed.receipt };
}

// ---------------------------------------------------------------------------
// Section 3 — Readback verifier
// ---------------------------------------------------------------------------

/**
 * Rebuild a W1 envelope from the row's canonical_payload and its TEN projection
 * columns, then re-parse it through the frozen GER-W1 adapter. This rechecks the
 * canonical fixed point, the receipt self-digest, zero authority, the strict
 * body profile, all digest scopes, and full projection equality. It then
 * explicitly re-asserts the five header-bound projection columns.
 *
 * created_at and every *_snapshot column are intentionally excluded: they are
 * never used to reconstruct receipt truth.
 */
export function verifyGeminiEvidenceReceiptLedgerRowV1(
  row: GeminiEvidenceReceiptLedgerRowV1
): LedgerVerifyResultV1 {
  const envelope: GeminiEvidenceWireEnvelopeV1 = {
    wireSchemaVersion: GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION,
    canonicalReceipt: row.canonical_payload,
    projection: {
      receiptId: row.receipt_id,
      receiptType: row.receipt_type,
      receiptSchemaVersion: row.receipt_schema_version,
      receiptDigestHex: row.receipt_digest_hex,
      receiptDigestScope: row.receipt_digest_scope,
      receiptCreatedAtIso: row.receipt_created_at_iso,
      logicalInvocationId: row.logical_invocation_id,
      providerAttemptId: row.provider_attempt_id,
      retryOfProviderAttemptId: row.retry_of_provider_attempt_id,
      requestCorrelationId: row.request_correlation_id,
    },
  };

  const parsed = parseGeminiEvidenceWireEnvelopeV1(envelope);
  if (!parsed.ok) {
    return { ok: false, reason: `ledger_readback_wire:${parsed.reason}` };
  }

  const receipt = parsed.receipt;

  // Explicit header-column re-assertions (defense in depth). W1 projection
  // validation already enforces these, so these are normally unreachable.
  if (row.receipt_id !== receipt.header.receiptId) {
    return { ok: false, reason: "ledger_readback_receipt_id" };
  }
  if (row.receipt_type !== receipt.header.receiptType) {
    return { ok: false, reason: "ledger_readback_receipt_type" };
  }
  if (row.receipt_schema_version !== receipt.header.schemaVersion) {
    return { ok: false, reason: "ledger_readback_receipt_schema_version" };
  }
  if (row.receipt_digest_hex !== receipt.header.receiptDigest.value) {
    return { ok: false, reason: "ledger_readback_receipt_digest_hex" };
  }
  if (row.receipt_digest_scope !== receipt.header.receiptDigest.scope) {
    return { ok: false, reason: "ledger_readback_receipt_digest_scope" };
  }

  return { ok: true, receipt };
}

// ---------------------------------------------------------------------------
// Section 4 — Fake-client repository boundary
// ---------------------------------------------------------------------------

/**
 * Stable fake-client constraint names. A real database does NOT guarantee which
 * violated unique constraint it reports first when several are violated at once,
 * so these names are diagnostic corroboration ONLY and must never drive conflict
 * classification (see R2 lookup-driven classification below).
 */
export const GER_W2_LEDGER_CONSTRAINT_NAMES = {
  receiptId: "ger_w2_receipt_ledger_receipt_id_key",
  receiptDigestHex: "ger_w2_receipt_ledger_receipt_digest_hex_key",
  providerAttemptId: "ger_w2_receipt_ledger_provider_attempt_id_key",
  retryFork: "ger_w2_receipt_ledger_retry_fork_key",
} as const;

export interface GeminiEvidenceReceiptLedgerClientV1 {
  insert(
    row: GeminiEvidenceReceiptLedgerRowV1
  ): { ok: true } | { ok: false; reason: string; constraint?: string };

  readByReceiptId(receiptId: string): GeminiEvidenceReceiptLedgerRowV1 | null;
  readByDigestHex(digestHex: string): GeminiEvidenceReceiptLedgerRowV1 | null;
  readByProviderAttemptId(
    providerAttemptId: string
  ): GeminiEvidenceReceiptLedgerRowV1 | null;
  readByRetryForkKey(input: {
    logicalInvocationId: string;
    retryOfProviderAttemptId: string | null;
  }): GeminiEvidenceReceiptLedgerRowV1 | null;
}

/**
 * Compute the retry-fork uniqueness key for a row. Only invocation rows (those
 * with a non-null logical_invocation_id) participate. A null retry predecessor
 * is expressed with the reserved GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL so that
 * initial and operator_rerun rows still collide with a sibling invocation that
 * shares the same logical invocation and null predecessor.
 */
function retryForkKeyForRow(
  row: GeminiEvidenceReceiptLedgerRowV1
): string | null {
  if (row.logical_invocation_id === null) return null;
  const predecessor =
    row.retry_of_provider_attempt_id ?? GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL;
  return `${row.logical_invocation_id}\u0000${predecessor}`;
}

function retryForkKeyForLookup(input: {
  logicalInvocationId: string;
  retryOfProviderAttemptId: string | null;
}): string {
  const predecessor =
    input.retryOfProviderAttemptId ?? GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL;
  return `${input.logicalInvocationId}\u0000${predecessor}`;
}

/**
 * Create a pure, in-memory fake ledger client that models the future W2 unique
 * constraints:
 *   - receipt_id uniqueness
 *   - receipt_digest_hex uniqueness
 *   - provider_attempt_id partial uniqueness (non-null only)
 *   - retry-fork uniqueness (invocation rows only, null-predecessor sentinel)
 *
 * On a multi-constraint collision the reported constraint is chosen by
 * `pickConstraint` (default: first detected). Tests use this to prove that the
 * reported constraint is arbitrary and never drives classification.
 *
 * `onStore` optionally transforms the row actually persisted (used only to
 * simulate post-insert corruption for readback-failure tests). It must not alter
 * any key column.
 */
export function createFakeGeminiEvidenceReceiptLedgerClientV1(options?: {
  pickConstraint?: (violatedConstraints: readonly string[]) => string;
  onStore?: (
    row: GeminiEvidenceReceiptLedgerRowV1
  ) => GeminiEvidenceReceiptLedgerRowV1;
}): GeminiEvidenceReceiptLedgerClientV1 {
  const pickConstraint =
    options?.pickConstraint ?? ((violated) => violated[0]);
  const onStore = options?.onStore;

  const byReceiptId = new Map<string, GeminiEvidenceReceiptLedgerRowV1>();
  const byDigestHex = new Map<string, GeminiEvidenceReceiptLedgerRowV1>();
  const byProviderAttemptId = new Map<
    string,
    GeminiEvidenceReceiptLedgerRowV1
  >();
  const byRetryForkKey = new Map<string, GeminiEvidenceReceiptLedgerRowV1>();

  return {
    insert(row) {
      const violated: string[] = [];
      if (byReceiptId.has(row.receipt_id)) {
        violated.push(GER_W2_LEDGER_CONSTRAINT_NAMES.receiptId);
      }
      if (byDigestHex.has(row.receipt_digest_hex)) {
        violated.push(GER_W2_LEDGER_CONSTRAINT_NAMES.receiptDigestHex);
      }
      if (
        row.provider_attempt_id !== null &&
        byProviderAttemptId.has(row.provider_attempt_id)
      ) {
        violated.push(GER_W2_LEDGER_CONSTRAINT_NAMES.providerAttemptId);
      }
      const forkKey = retryForkKeyForRow(row);
      if (forkKey !== null && byRetryForkKey.has(forkKey)) {
        violated.push(GER_W2_LEDGER_CONSTRAINT_NAMES.retryFork);
      }

      if (violated.length > 0) {
        return {
          ok: false,
          reason: "unique_violation",
          constraint: pickConstraint(violated),
        };
      }

      const stored = onStore ? onStore(row) : row;
      byReceiptId.set(row.receipt_id, stored);
      byDigestHex.set(row.receipt_digest_hex, stored);
      if (row.provider_attempt_id !== null) {
        byProviderAttemptId.set(row.provider_attempt_id, stored);
      }
      if (forkKey !== null) {
        byRetryForkKey.set(forkKey, stored);
      }
      return { ok: true };
    },

    readByReceiptId(receiptId) {
      return byReceiptId.get(receiptId) ?? null;
    },
    readByDigestHex(digestHex) {
      return byDigestHex.get(digestHex) ?? null;
    },
    readByProviderAttemptId(providerAttemptId) {
      return byProviderAttemptId.get(providerAttemptId) ?? null;
    },
    readByRetryForkKey(input) {
      return byRetryForkKey.get(retryForkKeyForLookup(input)) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Section 5 — Insert helper (fake-client version of the future W2D repository)
// ---------------------------------------------------------------------------

/** Guard against pathological / malicious cyclic stores during the chain walk. */
export const GER_W2_MAX_RETRY_CHAIN_DEPTH = 1024;

function asInvocationBody(receipt: ContractReceiptV1): InvocationBodyV1 | null {
  if (receipt.header.receiptType !== "gemini_invocation") return null;
  return receipt.body as unknown as InvocationBodyV1;
}

/**
 * R1 — full prior-chain retry validation.
 *
 * For a provider_retry current receipt, walk backward through every
 * priorInvocationReceipt.receiptId edge, reading and readback-verifying each row
 * from the store, until an initial or operator_rerun ancestor is reached. Then
 * run the frozen validateReceiptSet over the complete chain oldest-first with
 * the current receipt last. A missing prior is a hard failure; no
 * missing_referenced_receipt is tolerated in W2B.
 */
function validateProviderRetryChain(
  client: GeminiEvidenceReceiptLedgerClientV1,
  currentReceipt: ContractReceiptV1
): { ok: true } | { ok: false; reason: string } {
  const currentBody = asInvocationBody(currentReceipt);
  if (!currentBody) {
    return { ok: false, reason: "ledger_retry_chain:current_not_invocation" };
  }
  if (currentBody.priorInvocationReceipt === null) {
    return {
      ok: false,
      reason: "ledger_retry_chain:provider_retry_missing_prior_reference",
    };
  }

  const ancestorsNearestFirst: ContractReceiptV1[] = [];
  const visited = new Set<string>([currentReceipt.header.receiptId]);

  let cursorBody: InvocationBodyV1 = currentBody;
  let depth = 0;

  for (;;) {
    depth += 1;
    if (depth > GER_W2_MAX_RETRY_CHAIN_DEPTH) {
      return { ok: false, reason: "ledger_retry_chain:max_depth_exceeded" };
    }

    const priorRef = cursorBody.priorInvocationReceipt;
    if (priorRef === null) {
      // Reached a provider_retry with no prior reference: structurally invalid.
      return {
        ok: false,
        reason: "ledger_retry_chain:provider_retry_missing_prior_reference",
      };
    }

    const priorId = priorRef.receiptId;
    if (visited.has(priorId)) {
      return { ok: false, reason: "ledger_retry_chain:retry_reference_cycle" };
    }
    visited.add(priorId);

    const priorRow = client.readByReceiptId(priorId);
    if (priorRow === null) {
      return {
        ok: false,
        reason: "ledger_retry_chain:missing_referenced_receipt",
      };
    }

    const verified = verifyGeminiEvidenceReceiptLedgerRowV1(priorRow);
    if (!verified.ok) {
      return {
        ok: false,
        reason: `ledger_retry_chain:referenced_receipt_readback:${verified.reason}`,
      };
    }

    const priorReceipt = verified.receipt;
    const priorBody = asInvocationBody(priorReceipt);
    if (!priorBody) {
      return {
        ok: false,
        reason: "ledger_retry_chain:referenced_receipt_not_invocation",
      };
    }

    ancestorsNearestFirst.push(priorReceipt);

    if (priorBody.identity.relationship !== "provider_retry") {
      break; // reached initial or operator_rerun
    }
    cursorBody = priorBody;
  }

  const oldestFirstChain = [...ancestorsNearestFirst].reverse();
  const fullChain = [...oldestFirstChain, currentReceipt];

  const setResult = validateReceiptSet(fullChain);
  if (!setResult.ok) {
    return { ok: false, reason: `ledger_retry_chain:${setResult.reason}` };
  }
  return { ok: true };
}

/**
 * R2 — lookup-driven conflict classification.
 *
 * On any fake-client unique violation, classify purely by store lookups in a
 * fixed order, never by the reported constraint name.
 */
function classifyUniqueViolation(
  client: GeminiEvidenceReceiptLedgerClientV1,
  row: GeminiEvidenceReceiptLedgerRowV1
): GeminiEvidenceReceiptInsertResultV1 {
  const byId = client.readByReceiptId(row.receipt_id);
  if (byId !== null) {
    if (
      byId.canonical_payload === row.canonical_payload &&
      byId.receipt_digest_hex === row.receipt_digest_hex
    ) {
      // Byte-identical authoritative payload + digest is necessary but not
      // sufficient: the stored row's projection columns must also survive
      // readback verification before we may report idempotent success.
      const verified = verifyGeminiEvidenceReceiptLedgerRowV1(byId);
      if (!verified.ok) {
        return {
          ok: false,
          reason: "ledger_idempotent_readback_verification_failed",
        };
      }
      return { ok: true, outcome: "idempotent", row: byId };
    }
    return { ok: false, reason: "ledger_receipt_integrity_conflict" };
  }

  const byDigest = client.readByDigestHex(row.receipt_digest_hex);
  if (byDigest !== null) {
    return { ok: false, reason: "ledger_digest_id_mismatch" };
  }

  if (row.provider_attempt_id !== null) {
    const byAttempt = client.readByProviderAttemptId(row.provider_attempt_id);
    if (byAttempt !== null) {
      return { ok: false, reason: "ledger_provider_attempt_reused" };
    }
  }

  if (row.logical_invocation_id !== null) {
    const byFork = client.readByRetryForkKey({
      logicalInvocationId: row.logical_invocation_id,
      retryOfProviderAttemptId: row.retry_of_provider_attempt_id,
    });
    if (byFork !== null) {
      return { ok: false, reason: "ledger_forked_invocation_lineage" };
    }
  }

  return { ok: false, reason: "ledger_unclassified_unique_violation" };
}

/**
 * Fake-client version of the future GER-W2D repository insert. It performs:
 *   1. W1 parse + row construction
 *   2. provider_retry full prior-chain walk (R1)
 *   3. insert attempt
 *   4. lookup-driven conflict classification (R2)
 *   5. post-insert readback verification
 */
export function insertGeminiEvidenceReceiptEnvelopeForTestV1(
  client: GeminiEvidenceReceiptLedgerClientV1,
  input: {
    envelope: unknown;
    createdAt: string;
    ownerUserIdSnapshot?: string | null;
    roomIdSnapshot?: string | null;
    assetIdSnapshot?: string | null;
    versionIdSnapshot?: string | null;
  }
): GeminiEvidenceReceiptInsertResultV1 {
  const built = buildGeminiEvidenceReceiptLedgerRowV1(input);
  if (!built.ok) {
    return { ok: false, reason: built.reason };
  }
  const { row, receipt } = built;

  const invocationBody = asInvocationBody(receipt);
  if (
    invocationBody !== null &&
    invocationBody.identity.relationship === "provider_retry"
  ) {
    const chain = validateProviderRetryChain(client, receipt);
    if (!chain.ok) {
      return { ok: false, reason: chain.reason };
    }
  }

  const inserted = client.insert(row);
  if (!inserted.ok) {
    return classifyUniqueViolation(client, row);
  }

  const stored = client.readByReceiptId(row.receipt_id);
  if (stored === null) {
    return { ok: false, reason: "ledger_readback_missing_after_insert" };
  }
  const verified = verifyGeminiEvidenceReceiptLedgerRowV1(stored);
  if (!verified.ok) {
    return { ok: false, reason: "ledger_readback_verification_failed" };
  }

  return { ok: true, outcome: "inserted", row: stored };
}

// ---------------------------------------------------------------------------
// Section 6 — Real service-role client factory (GER-W2D)
// ---------------------------------------------------------------------------

/**
 * The physical ledger table created by the GER-W2C migration. The Supabase
 * adapter targets exactly this table and never any other relation.
 */
export const GER_W2_LEDGER_TABLE = "vibode_gemini_evidence_receipts";

/** Stable fail-closed reason when service-role env is incomplete. */
export const GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON =
  "ledger_service_env_missing";

/**
 * Env source shape for the service-role factory. Defaults to process.env, but
 * tests may pass an explicit object to exercise fail-closed behavior without
 * reading the real ambient environment. The variable names mirror the existing
 * service-role env patterns used elsewhere in the project.
 */
export type GeminiEvidenceReceiptLedgerServiceEnvSource = {
  SUPABASE_URL?: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  SUPABASE_SERVICE_KEY?: string | undefined;
  [key: string]: string | undefined;
};

export type GeminiEvidenceReceiptLedgerServiceEnvResult =
  | { ok: true; url: string; serviceRoleKey: string }
  | { ok: false; reason: string };

/**
 * Resolve the service-role URL + key from an env source, failing closed with a
 * stable ledger_ reason when either is missing. Pure and side-effect-free.
 */
export function resolveGeminiEvidenceReceiptLedgerServiceEnv(
  source: GeminiEvidenceReceiptLedgerServiceEnvSource = process.env
): GeminiEvidenceReceiptLedgerServiceEnvResult {
  const url = source.SUPABASE_URL || source.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey =
    source.SUPABASE_SERVICE_ROLE_KEY || source.SUPABASE_SERVICE_KEY || "";
  if (!url || !serviceRoleKey) {
    return { ok: false, reason: GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON };
  }
  return { ok: true, url, serviceRoleKey };
}

/**
 * Construct a real service-role Supabase client. This only builds the client
 * object; it performs no database call. It fails closed by throwing a stable
 * Error when env is missing, and never reaches for the server-auth cookie
 * helper module or the Next framework header helper.
 */
export function createGeminiEvidenceReceiptLedgerServiceClient(
  source: GeminiEvidenceReceiptLedgerServiceEnvSource = process.env
): SupabaseClient {
  const env = resolveGeminiEvidenceReceiptLedgerServiceEnv(source);
  if (!env.ok) {
    throw new Error(env.reason);
  }
  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Section 7 — Async ledger client interface + Supabase adapter (GER-W2D)
// ---------------------------------------------------------------------------

/**
 * Async counterpart to the synchronous W2B fake-client interface. The insert
 * result reports a unique violation with the stable ledger_unique_violation
 * reason so the async insert helper can classify by lookup order (R2). Reads
 * resolve to null on no-row and throw GeminiEvidenceLedgerReadError only for a
 * genuine client/query error (never for a missing row).
 */
export interface AsyncGeminiEvidenceReceiptLedgerClientV1 {
  insert(
    row: GeminiEvidenceReceiptLedgerRowV1
  ): Promise<
    { ok: true } | { ok: false; reason: string; constraint?: string }
  >;

  readByReceiptId(
    receiptId: string
  ): Promise<GeminiEvidenceReceiptLedgerRowV1 | null>;
  readByDigestHex(
    digestHex: string
  ): Promise<GeminiEvidenceReceiptLedgerRowV1 | null>;
  readByProviderAttemptId(
    providerAttemptId: string
  ): Promise<GeminiEvidenceReceiptLedgerRowV1 | null>;
  readByRetryForkKey(input: {
    logicalInvocationId: string;
    retryOfProviderAttemptId: string | null;
  }): Promise<GeminiEvidenceReceiptLedgerRowV1 | null>;
}

/** Thrown by the Supabase adapter reads on a genuine client/query error. */
export class GeminiEvidenceLedgerReadError extends Error {
  readonly detail: string | null;
  constructor(detail?: string | null) {
    super("ledger_read_failed");
    this.name = "GeminiEvidenceLedgerReadError";
    this.detail = detail ?? null;
  }
}

/**
 * Conservatively recognize a Postgres/PostgREST unique-violation error. The
 * primary signal is the SQLSTATE unique_violation code 23505. The constraint
 * name is never trusted for classification (see R2); it is only optionally
 * surfaced for diagnostics.
 */
export function isGeminiEvidenceLedgerUniqueViolationError(
  error: unknown
): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505" || code === 23505;
}

function extractLedgerUniqueViolationConstraint(
  error: unknown
): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" && constraint.length > 0
    ? constraint
    : undefined;
}

function readErrorDetail(error: unknown): string | null {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return null;
}

function interpretLedgerRead(
  data: unknown,
  error: unknown
): GeminiEvidenceReceiptLedgerRowV1 | null {
  if (error) {
    throw new GeminiEvidenceLedgerReadError(readErrorDetail(error));
  }
  return (data as GeminiEvidenceReceiptLedgerRowV1 | null) ?? null;
}

/**
 * Adapt a Supabase client to the async ledger client interface, targeting
 * public.vibode_gemini_evidence_receipts exactly.
 *
 * insert uses a plain .insert (never upsert / ignoreDuplicates) so that unique
 * violations surface for lookup-driven classification. Reads return a single
 * row via maybeSingle: no-row resolves to null, and a query error throws
 * GeminiEvidenceLedgerReadError. The retry-fork read uses an IS NULL predicate
 * for a null predecessor and an equality predicate otherwise (never a raw
 * coalesce expression).
 */
export function createSupabaseGeminiEvidenceReceiptLedgerClientV1(
  supabase: SupabaseClient
): AsyncGeminiEvidenceReceiptLedgerClientV1 {
  return {
    async insert(row) {
      const { error } = await supabase.from(GER_W2_LEDGER_TABLE).insert(row);
      if (error) {
        if (isGeminiEvidenceLedgerUniqueViolationError(error)) {
          const constraint = extractLedgerUniqueViolationConstraint(error);
          return constraint !== undefined
            ? { ok: false, reason: "ledger_unique_violation", constraint }
            : { ok: false, reason: "ledger_unique_violation" };
        }
        return { ok: false, reason: "ledger_insert_failed" };
      }
      return { ok: true };
    },

    async readByReceiptId(receiptId) {
      const { data, error } = await supabase
        .from(GER_W2_LEDGER_TABLE)
        .select("*")
        .eq("receipt_id", receiptId)
        .maybeSingle();
      return interpretLedgerRead(data, error);
    },

    async readByDigestHex(digestHex) {
      const { data, error } = await supabase
        .from(GER_W2_LEDGER_TABLE)
        .select("*")
        .eq("receipt_digest_hex", digestHex)
        .maybeSingle();
      return interpretLedgerRead(data, error);
    },

    async readByProviderAttemptId(providerAttemptId) {
      const { data, error } = await supabase
        .from(GER_W2_LEDGER_TABLE)
        .select("*")
        .eq("provider_attempt_id", providerAttemptId)
        .maybeSingle();
      return interpretLedgerRead(data, error);
    },

    async readByRetryForkKey(input) {
      const base = supabase
        .from(GER_W2_LEDGER_TABLE)
        .select("*")
        .eq("receipt_type", "gemini_invocation")
        .eq("logical_invocation_id", input.logicalInvocationId);
      const query =
        input.retryOfProviderAttemptId === null
          ? base.is("retry_of_provider_attempt_id", null)
          : base.eq(
              "retry_of_provider_attempt_id",
              input.retryOfProviderAttemptId
            );
      const { data, error } = await query.maybeSingle();
      return interpretLedgerRead(data, error);
    },
  };
}

// ---------------------------------------------------------------------------
// Section 8 — Async insert helper (GER-W2D repository protocol)
// ---------------------------------------------------------------------------

/**
 * Async R1 — full prior-chain retry validation. Behaviorally identical to the
 * synchronous validateProviderRetryChain; only store I/O is awaited.
 */
async function validateProviderRetryChainAsync(
  client: AsyncGeminiEvidenceReceiptLedgerClientV1,
  currentReceipt: ContractReceiptV1
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const currentBody = asInvocationBody(currentReceipt);
  if (!currentBody) {
    return { ok: false, reason: "ledger_retry_chain:current_not_invocation" };
  }
  if (currentBody.priorInvocationReceipt === null) {
    return {
      ok: false,
      reason: "ledger_retry_chain:provider_retry_missing_prior_reference",
    };
  }

  const ancestorsNearestFirst: ContractReceiptV1[] = [];
  const visited = new Set<string>([currentReceipt.header.receiptId]);

  let cursorBody: InvocationBodyV1 = currentBody;
  let depth = 0;

  for (;;) {
    depth += 1;
    if (depth > GER_W2_MAX_RETRY_CHAIN_DEPTH) {
      return { ok: false, reason: "ledger_retry_chain:max_depth_exceeded" };
    }

    const priorRef = cursorBody.priorInvocationReceipt;
    if (priorRef === null) {
      return {
        ok: false,
        reason: "ledger_retry_chain:provider_retry_missing_prior_reference",
      };
    }

    const priorId = priorRef.receiptId;
    if (visited.has(priorId)) {
      return { ok: false, reason: "ledger_retry_chain:retry_reference_cycle" };
    }
    visited.add(priorId);

    const priorRow = await client.readByReceiptId(priorId);
    if (priorRow === null) {
      return {
        ok: false,
        reason: "ledger_retry_chain:missing_referenced_receipt",
      };
    }

    const verified = verifyGeminiEvidenceReceiptLedgerRowV1(priorRow);
    if (!verified.ok) {
      return {
        ok: false,
        reason: `ledger_retry_chain:referenced_receipt_readback:${verified.reason}`,
      };
    }

    const priorReceipt = verified.receipt;
    const priorBody = asInvocationBody(priorReceipt);
    if (!priorBody) {
      return {
        ok: false,
        reason: "ledger_retry_chain:referenced_receipt_not_invocation",
      };
    }

    ancestorsNearestFirst.push(priorReceipt);

    if (priorBody.identity.relationship !== "provider_retry") {
      break;
    }
    cursorBody = priorBody;
  }

  const oldestFirstChain = [...ancestorsNearestFirst].reverse();
  const fullChain = [...oldestFirstChain, currentReceipt];

  const setResult = validateReceiptSet(fullChain);
  if (!setResult.ok) {
    return { ok: false, reason: `ledger_retry_chain:${setResult.reason}` };
  }
  return { ok: true };
}

/**
 * Async R2 — lookup-driven conflict classification. Behaviorally identical to
 * the synchronous classifyUniqueViolation; only store I/O is awaited. The
 * reported constraint name is never consulted.
 */
async function classifyUniqueViolationAsync(
  client: AsyncGeminiEvidenceReceiptLedgerClientV1,
  row: GeminiEvidenceReceiptLedgerRowV1
): Promise<GeminiEvidenceReceiptInsertResultV1> {
  const byId = await client.readByReceiptId(row.receipt_id);
  if (byId !== null) {
    if (
      byId.canonical_payload === row.canonical_payload &&
      byId.receipt_digest_hex === row.receipt_digest_hex
    ) {
      const verified = verifyGeminiEvidenceReceiptLedgerRowV1(byId);
      if (!verified.ok) {
        return {
          ok: false,
          reason: "ledger_idempotent_readback_verification_failed",
        };
      }
      return { ok: true, outcome: "idempotent", row: byId };
    }
    return { ok: false, reason: "ledger_receipt_integrity_conflict" };
  }

  const byDigest = await client.readByDigestHex(row.receipt_digest_hex);
  if (byDigest !== null) {
    return { ok: false, reason: "ledger_digest_id_mismatch" };
  }

  if (row.provider_attempt_id !== null) {
    const byAttempt = await client.readByProviderAttemptId(
      row.provider_attempt_id
    );
    if (byAttempt !== null) {
      return { ok: false, reason: "ledger_provider_attempt_reused" };
    }
  }

  if (row.logical_invocation_id !== null) {
    const byFork = await client.readByRetryForkKey({
      logicalInvocationId: row.logical_invocation_id,
      retryOfProviderAttemptId: row.retry_of_provider_attempt_id,
    });
    if (byFork !== null) {
      return { ok: false, reason: "ledger_forked_invocation_lineage" };
    }
  }

  return { ok: false, reason: "ledger_unclassified_unique_violation" };
}

/**
 * The GER-W2D async repository insert. It mirrors the W2B fake-client helper
 * exactly:
 *   1. W1-backed row construction
 *   2. provider_retry full prior-chain validation (R1)
 *   3. insert attempt (no upsert)
 *   4. lookup-driven conflict classification on unique violation (R2)
 *   5. post-insert readback verification
 *   6. post-idempotent readback verification
 *
 * A genuine read query error (surfaced by the adapter as
 * GeminiEvidenceLedgerReadError) is mapped to the stable ledger_read_failed
 * reason. No mutable global state or hidden DB access is introduced.
 */
export async function insertGeminiEvidenceReceiptEnvelopeV1(
  client: AsyncGeminiEvidenceReceiptLedgerClientV1,
  input: {
    envelope: unknown;
    createdAt: string;
    ownerUserIdSnapshot?: string | null;
    roomIdSnapshot?: string | null;
    assetIdSnapshot?: string | null;
    versionIdSnapshot?: string | null;
  }
): Promise<GeminiEvidenceReceiptInsertResultV1> {
  try {
    const built = buildGeminiEvidenceReceiptLedgerRowV1(input);
    if (!built.ok) {
      return { ok: false, reason: built.reason };
    }
    const { row, receipt } = built;

    const invocationBody = asInvocationBody(receipt);
    if (
      invocationBody !== null &&
      invocationBody.identity.relationship === "provider_retry"
    ) {
      const chain = await validateProviderRetryChainAsync(client, receipt);
      if (!chain.ok) {
        return { ok: false, reason: chain.reason };
      }
    }

    const inserted = await client.insert(row);
    if (!inserted.ok) {
      if (inserted.reason === "ledger_unique_violation") {
        return await classifyUniqueViolationAsync(client, row);
      }
      return { ok: false, reason: inserted.reason };
    }

    const stored = await client.readByReceiptId(row.receipt_id);
    if (stored === null) {
      return { ok: false, reason: "ledger_readback_missing_after_insert" };
    }
    const verified = verifyGeminiEvidenceReceiptLedgerRowV1(stored);
    if (!verified.ok) {
      return { ok: false, reason: "ledger_readback_verification_failed" };
    }

    return { ok: true, outcome: "inserted", row: stored };
  } catch (err: unknown) {
    if (err instanceof GeminiEvidenceLedgerReadError) {
      return { ok: false, reason: "ledger_read_failed" };
    }
    throw err;
  }
}
