// GER-W2C — Deterministic SQL text lint for the append-only Gemini Evidence
// Receipt ledger migration.
//
// This test reads the migration file as static source text and asserts its
// structural shape only. It performs no time, randomness, env, network,
// database, or Supabase access, and imports no runtime module. It mirrors the
// GER containment self-check style: pure string inspection of a fixed path.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_PATH = new URL(
  "../../../supabase/migrations/20260708103000_create_vibode_gemini_evidence_receipts.sql",
  import.meta.url
);

const SOURCE = readFileSync(MIGRATION_PATH, "utf8");
const LOWER = SOURCE.toLowerCase();

const REQUIRED_COLUMNS = [
  "receipt_id text primary key",
  "receipt_type text not null",
  "receipt_schema_version text not null",
  "canonical_payload text not null",
  "receipt_digest_hex text not null",
  "receipt_digest_scope text not null",
  "receipt_created_at_iso text not null",
  "created_at timestamptz not null default now()",
  "logical_invocation_id text null",
  "provider_attempt_id text null",
  "retry_of_provider_attempt_id text null",
  "request_correlation_id text null",
  "owner_user_id_snapshot text null",
  "room_id_snapshot text null",
  "asset_id_snapshot text null",
  "version_id_snapshot text null",
];

const RECEIPT_TYPES = [
  "gemini_invocation",
  "gemini_provider_response",
  "gemini_parsed_response",
  "gemini_local_assessment",
  "derivative_lineage",
  "evidence_comparison",
  "evidence_disposition",
  "evidence_retention_tombstone",
];

const FORBIDDEN_SUBSTRINGS = [
  "on delete",
  "on update",
  "cascade",
  "set null",
  "create policy",
  "metadata jsonb",
  "references",
  "nulls not distinct",
];

test("1) creates public.vibode_gemini_evidence_receipts table", () => {
  assert.ok(
    LOWER.includes(
      "create table if not exists public.vibode_gemini_evidence_receipts"
    ),
    "expected the ledger table create statement"
  );
});

test("2) declares every required column", () => {
  for (const column of REQUIRED_COLUMNS) {
    assert.ok(LOWER.includes(column), `expected column: ${column}`);
  }
});

test("3) does not add a metadata jsonb column", () => {
  assert.equal(
    LOWER.includes("metadata jsonb"),
    false,
    "migration must not add a metadata jsonb column"
  );
});

test("4) declares no references (foreign key) clauses", () => {
  assert.equal(
    LOWER.includes("references"),
    false,
    "migration must not declare any foreign keys"
  );
});

test("5) closed receipt_type CHECK includes all 8 GER-I0 types", () => {
  assert.ok(
    LOWER.includes("check (receipt_type in ("),
    "expected a closed receipt_type check"
  );
  for (const receiptType of RECEIPT_TYPES) {
    assert.ok(
      LOWER.includes(`'${receiptType}'`),
      `expected receipt type literal: ${receiptType}`
    );
  }
});

test("6) receipt_schema_version equality CHECK pins the GER-I0 schema version", () => {
  assert.ok(
    LOWER.includes(
      "check (receipt_schema_version = 'gemini-evidence-contract/ger-i0/v1')"
    ),
    "receipt_schema_version must be pinned by equality, not a non-empty check"
  );
});

test("7) receipt_digest_scope equality CHECK pins the canonical payload scope", () => {
  assert.ok(
    LOWER.includes(
      "check (receipt_digest_scope = 'canonical-receipt-payload-json/v1')"
    ),
    "receipt_digest_scope must be pinned by equality"
  );
});

test("8) receipt_digest_hex CHECK contains the lower-case SHA-256 pattern", () => {
  assert.ok(
    SOURCE.includes("^[0-9a-f]{64}$"),
    "expected the lower-case SHA-256 hex pattern"
  );
});

test("9) canonical_payload non-empty CHECK exists", () => {
  assert.ok(
    LOWER.includes("check (length(canonical_payload) > 0)"),
    "expected a canonical_payload non-empty check"
  );
});

test("10) receipt_created_at_iso non-empty CHECK exists", () => {
  assert.ok(
    LOWER.includes("check (length(receipt_created_at_iso) > 0)"),
    "expected a receipt_created_at_iso non-empty check"
  );
});

test("11) invocation projection nullability CHECK exists", () => {
  assert.ok(
    LOWER.includes("receipt_type <> 'gemini_invocation'") &&
      LOWER.includes("or logical_invocation_id is not null"),
    "expected an invocation logical-id present check"
  );
});

test("12) non-invocation projection nullability CHECK nulls all invocation projections", () => {
  assert.ok(
    LOWER.includes("receipt_type = 'gemini_invocation'") &&
      LOWER.includes("logical_invocation_id is null") &&
      LOWER.includes("and provider_attempt_id is null") &&
      LOWER.includes("and retry_of_provider_attempt_id is null") &&
      LOWER.includes("and request_correlation_id is null"),
    "expected a non-invocation projection-null check"
  );
});

test("13) receipt_digest_hex uniqueness exists", () => {
  assert.ok(
    LOWER.includes("unique (receipt_digest_hex)"),
    "expected a unique constraint on receipt_digest_hex"
  );
});

test("14) provider_attempt_id partial unique index exists", () => {
  assert.ok(
    LOWER.includes(
      "create unique index if not exists\n  vibode_gemini_evidence_receipts_provider_attempt_id_key"
    ),
    "expected the provider_attempt_id partial unique index"
  );
  assert.ok(
    LOWER.includes(
      "where receipt_type = 'gemini_invocation' and provider_attempt_id is not null"
    ),
    "provider_attempt_id unique index must be partial on invocation + non-null"
  );
});

test("15) retry-fork coalesce-sentinel unique index exists", () => {
  assert.ok(
    LOWER.includes(
      "create unique index if not exists\n  vibode_gemini_evidence_receipts_retry_fork_key"
    ),
    "expected the retry-fork unique index"
  );
  assert.ok(
    LOWER.includes(
      "coalesce(retry_of_provider_attempt_id, '__ger_null_retry_predecessor_v1__')"
    ),
    "retry-fork index must coalesce onto the null-predecessor sentinel"
  );
});

test("16) the W1/W2B sentinel literal is present", () => {
  assert.ok(
    SOURCE.includes("__ger_null_retry_predecessor_v1__"),
    "expected the exact retry-predecessor sentinel literal"
  );
});

test("17) NULLS NOT DISTINCT is absent", () => {
  assert.equal(
    LOWER.includes("nulls not distinct"),
    false,
    "migration must not use NULLS NOT DISTINCT"
  );
});

test("18) created_at desc index exists", () => {
  assert.ok(
    LOWER.includes(
      "vibode_gemini_evidence_receipts_created_at_idx\n  on public.vibode_gemini_evidence_receipts (created_at desc)"
    ),
    "expected a created_at desc index"
  );
});

test("19) receipt_type + created_at desc index exists", () => {
  assert.ok(
    LOWER.includes(
      "on public.vibode_gemini_evidence_receipts (receipt_type, created_at desc)"
    ),
    "expected a (receipt_type, created_at desc) index"
  );
});

test("20) logical_invocation_id partial query index exists", () => {
  assert.ok(
    LOWER.includes(
      "vibode_gemini_evidence_receipts_logical_invocation_idx\n  on public.vibode_gemini_evidence_receipts (logical_invocation_id)\n  where logical_invocation_id is not null"
    ),
    "expected a partial logical_invocation_id query index"
  );
});

test("21) RLS enable statement exists", () => {
  assert.ok(
    LOWER.includes(
      "alter table public.vibode_gemini_evidence_receipts enable row level security"
    ),
    "expected row level security to be enabled"
  );
});

test("22) no create policy statement exists", () => {
  assert.equal(
    LOWER.includes("create policy"),
    false,
    "W2C must not create any policy"
  );
});

test("23) dedicated append-only trigger function exists", () => {
  assert.ok(
    LOWER.includes(
      "function public.prevent_vibode_gemini_evidence_receipts_mutation()"
    ),
    "expected a dedicated append-only trigger function"
  );
});

test("24) before update trigger exists", () => {
  assert.ok(
    LOWER.includes(
      "before update on public.vibode_gemini_evidence_receipts"
    ),
    "expected a before-update append-only trigger"
  );
});

test("25) before delete trigger exists", () => {
  assert.ok(
    LOWER.includes(
      "before delete on public.vibode_gemini_evidence_receipts"
    ),
    "expected a before-delete append-only trigger"
  );
});

test("26) expected append-only exception text exists", () => {
  assert.ok(
    SOURCE.includes(
      "raise exception 'vibode_gemini_evidence_receipts is append-only'"
    ),
    "expected the append-only raise exception text"
  );
});

test("27) migration text contains no forbidden relational/policy substrings", () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.equal(
      LOWER.includes(forbidden),
      false,
      `migration must not contain: ${forbidden}`
    );
  }
});
