-- GER-W2C — Append-only Gemini Evidence Receipt ledger.
--
-- This migration creates the immutable receipt ledger table backing the frozen
-- GER-I0 evidence contract and the GER-W1 wire adapter. The canonical_payload
-- column is the sole authoritative receipt truth; the receipt_* and invocation
-- columns are derived projections; created_at is server observation metadata;
-- and the *_snapshot columns are immutable advisory access snapshots (plain
-- text only, never relational keys).
--
-- Scope guards enforced here:
--   * receipt_schema_version is pinned to the literal GER-I0 schema version so a
--     permanently immutable row can never be admitted unless it can pass the
--     GER-W1 readback contract.
--   * append-only via before-mutation triggers.
--   * row level security enabled and left fail-closed (no policies). Service
--     access arrives later in GER-W2D.

create table if not exists public.vibode_gemini_evidence_receipts (
  receipt_id text primary key,
  receipt_type text not null,
  receipt_schema_version text not null,
  canonical_payload text not null,
  receipt_digest_hex text not null,
  receipt_digest_scope text not null,
  receipt_created_at_iso text not null,
  created_at timestamptz not null default now(),

  logical_invocation_id text null,
  provider_attempt_id text null,
  retry_of_provider_attempt_id text null,
  request_correlation_id text null,

  owner_user_id_snapshot text null,
  room_id_snapshot text null,
  asset_id_snapshot text null,
  version_id_snapshot text null,

  constraint vibode_gemini_evidence_receipts_receipt_digest_hex_key
    unique (receipt_digest_hex),

  constraint vibode_gemini_evidence_receipts_receipt_type_closed
    check (receipt_type in (
      'gemini_invocation',
      'gemini_provider_response',
      'gemini_parsed_response',
      'gemini_local_assessment',
      'derivative_lineage',
      'evidence_comparison',
      'evidence_disposition',
      'evidence_retention_tombstone'
    )),

  constraint vibode_gemini_evidence_receipts_schema_version_pinned
    check (receipt_schema_version = 'gemini-evidence-contract/ger-i0/v1'),

  constraint vibode_gemini_evidence_receipts_digest_scope_pinned
    check (receipt_digest_scope = 'canonical-receipt-payload-json/v1'),

  constraint vibode_gemini_evidence_receipts_digest_hex_format
    check (receipt_digest_hex ~ '^[0-9a-f]{64}$'),

  constraint vibode_gemini_evidence_receipts_canonical_payload_nonempty
    check (length(canonical_payload) > 0),

  constraint vibode_gemini_evidence_receipts_created_at_iso_nonempty
    check (length(receipt_created_at_iso) > 0),

  -- Invocation rows must carry a logical invocation identity.
  constraint vibode_gemini_evidence_receipts_invocation_logical_present
    check (
      receipt_type <> 'gemini_invocation'
      or logical_invocation_id is not null
    ),

  -- Non-invocation rows must leave every invocation projection column null.
  constraint vibode_gemini_evidence_receipts_noninvocation_projection_null
    check (
      receipt_type = 'gemini_invocation'
      or (
        logical_invocation_id is null
        and provider_attempt_id is null
        and retry_of_provider_attempt_id is null
        and request_correlation_id is null
      )
    )
);

-- Partial uniqueness: at most one invocation row per non-null provider attempt.
create unique index if not exists
  vibode_gemini_evidence_receipts_provider_attempt_id_key
  on public.vibode_gemini_evidence_receipts (provider_attempt_id)
  where receipt_type = 'gemini_invocation' and provider_attempt_id is not null;

-- Retry-fork uniqueness: within a logical invocation, each predecessor attempt
-- may be extended only once. A null predecessor collapses onto the shared W1/W2B
-- sentinel so that initial / operator_rerun siblings still collide.
create unique index if not exists
  vibode_gemini_evidence_receipts_retry_fork_key
  on public.vibode_gemini_evidence_receipts (
    logical_invocation_id,
    coalesce(retry_of_provider_attempt_id, '__ger_null_retry_predecessor_v1__')
  )
  where receipt_type = 'gemini_invocation';

-- Query indexes.
create index if not exists
  vibode_gemini_evidence_receipts_created_at_idx
  on public.vibode_gemini_evidence_receipts (created_at desc);

create index if not exists
  vibode_gemini_evidence_receipts_type_created_at_idx
  on public.vibode_gemini_evidence_receipts (receipt_type, created_at desc);

create index if not exists
  vibode_gemini_evidence_receipts_logical_invocation_idx
  on public.vibode_gemini_evidence_receipts (logical_invocation_id)
  where logical_invocation_id is not null;

-- Row level security: enabled and fail-closed. No policies are defined, so
-- anon and authenticated roles cannot read or write. Service access is a later
-- phase (GER-W2D).
alter table public.vibode_gemini_evidence_receipts enable row level security;

-- Append-only immutability. A dedicated trigger function is used so this table
-- never shares mutation-guard state with any other ledger.
create or replace function public.prevent_vibode_gemini_evidence_receipts_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vibode_gemini_evidence_receipts is append-only';
end;
$$;

drop trigger if exists vibode_gemini_evidence_receipts_no_update
  on public.vibode_gemini_evidence_receipts;

create trigger vibode_gemini_evidence_receipts_no_update
  before update on public.vibode_gemini_evidence_receipts
  for each row
  execute function public.prevent_vibode_gemini_evidence_receipts_mutation();

drop trigger if exists vibode_gemini_evidence_receipts_no_delete
  on public.vibode_gemini_evidence_receipts;

create trigger vibode_gemini_evidence_receipts_no_delete
  before delete on public.vibode_gemini_evidence_receipts
  for each row
  execute function public.prevent_vibode_gemini_evidence_receipts_mutation();
