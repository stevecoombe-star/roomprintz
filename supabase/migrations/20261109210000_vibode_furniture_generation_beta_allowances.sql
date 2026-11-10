-- MESHY-1D.2A beta allowance schema.
--
-- Operational allowance rows and an append-only audit trail. This file does
-- not approve a user, does not reserve or settle a generation, and does not
-- read or write the global generation control row. Its switch, ceiling,
-- concurrency cap, credit balances, and paid-attempt counters stay as
-- MESHY-1C left them.
--
-- allowance_state on a job is null for every existing MESHY-1C row. Null
-- means that job has no tester allowance, not that a generation was consumed.
--
-- Allowance events store user and job identifiers without foreign keys. The
-- immutability trigger rejects update, delete, and truncate, including a
-- cascade from auth.users or from a generation job. History therefore survives
-- account deletion. The allowance row itself follows the job ledger and
-- leaves with the account.
--
-- Browser roles and service_role have no table privileges. This slice adds
-- no grant or settlement function. Review before applying. Do not apply it
-- to hosted Supabase without explicit approval.

begin;

create table public.vibode_furniture_generation_allowances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  classification text not null,
  enabled boolean not null,
  authorized_generations integer not null,
  reserved_generations integer not null,
  consumed_generations integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  constraint vibode_furniture_generation_allowances_classification
    check (classification in ('individual_beta', 'furniture_partner')),
  constraint vibode_furniture_generation_allowances_counts
    check (
      authorized_generations >= 0
      and reserved_generations >= 0
      and consumed_generations >= 0
    ),
  constraint vibode_furniture_generation_allowances_cap
    check (authorized_generations <= 50),
  constraint vibode_furniture_generation_allowances_balance
    check (reserved_generations + consumed_generations <= authorized_generations)
);

comment on table public.vibode_furniture_generation_allowances is
  'Per-user AI furniture generation allowance. Remaining is authorized minus reserved minus consumed and is not stored. No row means the user is denied.';

comment on column public.vibode_furniture_generation_allowances.updated_by is
  'Administrator who last changed the row. Null when a later system settlement is the last writer. Not a foreign key, so deleting that administrator does not rewrite the row.';

comment on column public.vibode_furniture_generation_allowances.classification is
  'individual_beta or furniture_partner. A label for an approved account, not a shared credit pool.';

create table public.vibode_furniture_generation_allowance_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor_kind text not null,
  actor_user_id uuid null,
  action text not null,
  delta_authorized integer not null,
  delta_reserved integer not null,
  delta_consumed integer not null,
  job_id uuid null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint vibode_furniture_generation_allowance_events_actor_kind
    check (actor_kind in ('administrator', 'system')),
  constraint vibode_furniture_generation_allowance_events_actor
    check (
      (
        actor_kind = 'administrator'
        and actor_user_id is not null
        and action in ('grant', 'adjust', 'enable', 'disable', 'restore')
      )
      or (
        actor_kind = 'system'
        and actor_user_id is null
        and job_id is not null
        and action in ('reserve', 'release', 'consume')
      )
    ),
  constraint vibode_furniture_generation_allowance_events_deltas
    check (
      delta_authorized between -50 and 50
      and delta_reserved between -50 and 50
      and delta_consumed between 0 and 50
    ),
  constraint vibode_furniture_generation_allowance_events_reason
    check (char_length(btrim(reason)) between 1 and 200)
);

comment on table public.vibode_furniture_generation_allowance_events is
  'Append-only allowance audit. administrator rows record an acting user. system rows record a job lifecycle change and have no acting user. Identifiers are retained without foreign keys.';

comment on column public.vibode_furniture_generation_allowance_events.actor_kind is
  'administrator for a human operator. system for reserve, release, and consume during a job lifecycle.';

create trigger set_timestamp_vibode_furniture_generation_allowances
before update on public.vibode_furniture_generation_allowances
for each row execute function public.set_timestamp();

create or replace function public.vibode_furniture_generation_allowance_events_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'VIBODE_FURNITURE_GENERATION:ALLOWANCE_EVENT_IMMUTABLE';
end;
$fn$;

create trigger vibode_furniture_generation_allowance_events_no_update
before update on public.vibode_furniture_generation_allowance_events
for each row execute function public.vibode_furniture_generation_allowance_events_immutable();

create trigger vibode_furniture_generation_allowance_events_no_delete
before delete on public.vibode_furniture_generation_allowance_events
for each row execute function public.vibode_furniture_generation_allowance_events_immutable();

create trigger vibode_furniture_generation_allowance_events_no_truncate
before truncate on public.vibode_furniture_generation_allowance_events
for each statement execute function public.vibode_furniture_generation_allowance_events_immutable();

alter table public.vibode_furniture_generation_jobs
  add column allowance_state text null;

alter table public.vibode_furniture_generation_jobs
  add constraint vibode_furniture_generation_jobs_allowance_state
  check (allowance_state is null or allowance_state in ('reserved', 'consumed', 'released'));

comment on column public.vibode_furniture_generation_jobs.allowance_state is
  'Tester allowance settlement. Null keeps a MESHY-1C job outside the beta allowance. reserved, consumed, and released are the only later states. Null does not mean consumed.';

alter table public.vibode_furniture_generation_allowances enable row level security;
alter table public.vibode_furniture_generation_allowance_events enable row level security;

revoke all on table public.vibode_furniture_generation_allowances from public, anon, authenticated, service_role;
revoke all on table public.vibode_furniture_generation_allowance_events from public, anon, authenticated, service_role;

revoke all on function public.vibode_furniture_generation_allowance_events_immutable() from public, anon, authenticated, service_role;

commit;
