-- Phase 4D: visibility-only persistence for post-success token charge failures.
-- No charging semantics are changed by this migration.

create table if not exists public.vibode_token_charge_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_key text not null,
  operation_id text null,
  request_id text null,
  idempotency_key text null,
  route text null,
  charge_phase text null,
  expected_tokens integer null,
  model_version text null,
  room_id uuid null references public.vibode_rooms(id) on delete set null,
  generation_run_id uuid null references public.vibode_generation_runs(id) on delete set null,
  output_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vibode_token_charge_failures_created_at_idx
  on public.vibode_token_charge_failures (created_at desc);

create index if not exists vibode_token_charge_failures_user_id_idx
  on public.vibode_token_charge_failures (user_id, created_at desc);

create index if not exists vibode_token_charge_failures_operation_key_idx
  on public.vibode_token_charge_failures (operation_key, created_at desc);

create index if not exists vibode_token_charge_failures_route_idx
  on public.vibode_token_charge_failures (route, created_at desc);

alter table public.vibode_token_charge_failures enable row level security;

revoke all on public.vibode_token_charge_failures from public, anon, authenticated;

create or replace function public.prevent_vibode_token_charge_failures_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vibode_token_charge_failures is append-only';
end;
$$;

drop trigger if exists vibode_token_charge_failures_no_update
on public.vibode_token_charge_failures;

create trigger vibode_token_charge_failures_no_update
before update on public.vibode_token_charge_failures
for each row execute function public.prevent_vibode_token_charge_failures_mutation();

drop trigger if exists vibode_token_charge_failures_no_delete
on public.vibode_token_charge_failures;

create trigger vibode_token_charge_failures_no_delete
before delete on public.vibode_token_charge_failures
for each row execute function public.prevent_vibode_token_charge_failures_mutation();
