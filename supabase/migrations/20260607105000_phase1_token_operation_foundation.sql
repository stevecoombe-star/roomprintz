-- Phase 1: token operation pricing + idempotent operation charging foundation.
-- This migration is backward-compatible with existing charging paths.

create table if not exists public.vibode_token_operation_costs (
  operation_key text primary key,
  admin_label text not null,
  model_version text,
  token_cost integer not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_timestamp_vibode_token_operation_costs on public.vibode_token_operation_costs;
create trigger set_timestamp_vibode_token_operation_costs
before update on public.vibode_token_operation_costs
for each row execute function public.set_timestamp();

alter table public.vibode_token_operation_costs enable row level security;

drop policy if exists "vibode_token_operation_costs_read_all" on public.vibode_token_operation_costs;
create policy "vibode_token_operation_costs_read_all"
on public.vibode_token_operation_costs
for select
using (auth.uid() is not null);

alter table public.token_ledger
  add column if not exists operation_key text,
  add column if not exists operation_id text,
  add column if not exists request_id text,
  add column if not exists idempotency_key text,
  add column if not exists model_version text,
  add column if not exists charge_phase text;

create index if not exists token_ledger_operation_key_idx
  on public.token_ledger (operation_key);

create index if not exists token_ledger_operation_id_idx
  on public.token_ledger (operation_id);

create index if not exists token_ledger_request_id_idx
  on public.token_ledger (request_id);

create unique index if not exists token_ledger_spend_operation_idempotency_uidx
  on public.token_ledger (user_id, operation_key, idempotency_key)
  where idempotency_key is not null
    and operation_key is not null
    and tokens_delta < 0;

insert into public.vibode_token_operation_costs (operation_key, admin_label, model_version, token_cost, active, metadata)
values
  ('SETUP_PREPARE_ROOM', 'Setup: Prepare Room', null, 0, true, '{}'::jsonb),
  ('SETUP_CLEANUP', 'Setup: Cleanup', null, 0, true, '{}'::jsonb),
  ('SETUP_MODIFY_ROOM', 'Setup: Modify Room', null, 0, true, '{}'::jsonb),
  ('STAGE_PASTE_TO_PLACE', 'Stage: Paste To Place', null, 0, true, '{}'::jsonb),
  ('STAGE_LET_VIBODE_DECIDE', 'Stage: Let Vibode Decide', null, 0, true, '{}'::jsonb),
  ('STYLE_RUN', 'Style: Run', null, 0, true, '{}'::jsonb),
  ('SCENE_REBUILD_USER_DIRECTED', 'Scene Rebuild: User Directed', null, 0, true, '{}'::jsonb),
  ('FULL_VIBE', 'Full Vibe', null, 0, true, '{}'::jsonb),
  ('INGEST_IMAGE', 'Ingest: Image', null, 0, true, '{}'::jsonb),
  ('INGEST_PRODUCT_URL', 'Ingest: Product URL', null, 0, true, '{}'::jsonb),
  ('ROOM_READ_OBJECT_DETECTION', 'Room Read: Object Detection', null, 0, true, '{}'::jsonb),
  ('EDIT_REMOVE', 'Edit: Remove', null, 0, true, '{}'::jsonb),
  ('EDIT_SWAP', 'Edit: Swap', null, 0, true, '{}'::jsonb),
  ('EDIT_ROTATE', 'Edit: Rotate', null, 0, true, '{}'::jsonb)
on conflict (operation_key) do update
set
  admin_label = excluded.admin_label,
  model_version = excluded.model_version,
  token_cost = excluded.token_cost,
  active = excluded.active,
  metadata = excluded.metadata,
  updated_at = now();

create or replace function public.charge_vibode_tokens_for_operation(
  p_user_id uuid,
  p_operation_key text,
  p_idempotency_key text,
  p_operation_id text default null,
  p_request_id text default null,
  p_model_version text default null,
  p_charge_phase text default 'success',
  p_room_id uuid default null,
  p_generation_run_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  skipped boolean,
  charged_tokens integer,
  balance_tokens integer,
  ledger_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_key text := nullif(trim(p_operation_key), '');
  v_idempotency_key text := nullif(trim(p_idempotency_key), '');
  v_charge_phase text := coalesce(nullif(trim(p_charge_phase), ''), 'success');
  v_cost integer;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_wallet public.user_token_wallets%rowtype;
  v_ledger_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_operation_key is null then
    raise exception 'operation_key is required';
  end if;
  if v_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  select token_cost
  into v_cost
  from public.vibode_token_operation_costs
  where operation_key = v_operation_key
    and active = true
  limit 1;

  if not found then
    raise exception 'no active token operation cost configured for operation_key %', v_operation_key;
  end if;
  if v_cost is null or v_cost <= 0 then
    return query select true, 0, null::integer, null::uuid;
    return;
  end if;

  select *
  into v_wallet
  from public.user_token_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'token wallet missing for user %', p_user_id;
  end if;

  if exists (
    select 1
    from public.token_ledger
    where user_id = p_user_id
      and operation_key = v_operation_key
      and idempotency_key = v_idempotency_key
      and tokens_delta < 0
    limit 1
  ) then
    return query select true, 0, v_wallet.balance_tokens, null::uuid;
    return;
  end if;

  if v_wallet.balance_tokens < v_cost then
    raise exception 'insufficient tokens for operation %, required %, available %',
      v_operation_key, v_cost, v_wallet.balance_tokens;
  end if;

  update public.user_token_wallets
  set
    balance_tokens = v_wallet.balance_tokens - v_cost,
    lifetime_spent_tokens = v_wallet.lifetime_spent_tokens + v_cost,
    monthly_spent_tokens = v_wallet.monthly_spent_tokens + v_cost,
    updated_at = now()
  where user_id = p_user_id
  returning * into v_wallet;

  insert into public.token_ledger (
    user_id,
    room_id,
    generation_run_id,
    event_type,
    action_type,
    model_version,
    operation_key,
    operation_id,
    request_id,
    idempotency_key,
    charge_phase,
    tokens_delta,
    balance_after,
    metadata
  ) values (
    p_user_id,
    p_room_id,
    p_generation_run_id,
    'spend',
    v_operation_key,
    p_model_version,
    v_operation_key,
    p_operation_id,
    p_request_id,
    v_idempotency_key,
    v_charge_phase,
    -v_cost,
    v_wallet.balance_tokens,
    v_metadata
  )
  returning id into v_ledger_id;

  return query select false, v_cost, v_wallet.balance_tokens, v_ledger_id;
end;
$$;

revoke all on function public.charge_vibode_tokens_for_operation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.charge_vibode_tokens_for_operation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  jsonb
) to service_role;

create or replace function public.apply_admin_token_adjustment(
  p_user_id uuid,
  p_tokens_delta integer,
  p_reason text,
  p_admin_user_id uuid,
  p_operation_id text default null,
  p_request_id text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  balance_tokens integer,
  ledger_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(p_reason), '');
  v_idempotency_key text := nullif(trim(p_idempotency_key), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_wallet public.user_token_wallets%rowtype;
  v_ledger_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;
  if v_reason is null then
    raise exception 'reason is required for admin token adjustment';
  end if;
  if p_tokens_delta is null or p_tokens_delta = 0 then
    raise exception 'tokens_delta must be non-zero';
  end if;

  select *
  into v_wallet
  from public.user_token_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'token wallet missing for user %', p_user_id;
  end if;

  if v_idempotency_key is not null and exists (
    select 1
    from public.token_ledger
    where user_id = p_user_id
      and operation_key = 'ADMIN_ADJUSTMENT'
      and idempotency_key = v_idempotency_key
    limit 1
  ) then
    return query select v_wallet.balance_tokens, null::uuid;
    return;
  end if;

  if p_tokens_delta < 0 and v_wallet.balance_tokens < abs(p_tokens_delta) then
    raise exception 'insufficient tokens for admin debit, requested %, available %',
      abs(p_tokens_delta), v_wallet.balance_tokens;
  end if;

  update public.user_token_wallets
  set
    balance_tokens = v_wallet.balance_tokens + p_tokens_delta,
    lifetime_granted_tokens = v_wallet.lifetime_granted_tokens + greatest(p_tokens_delta, 0),
    lifetime_spent_tokens = v_wallet.lifetime_spent_tokens,
    monthly_granted_tokens = v_wallet.monthly_granted_tokens + greatest(p_tokens_delta, 0),
    monthly_spent_tokens = v_wallet.monthly_spent_tokens,
    updated_at = now()
  where user_id = p_user_id
  returning * into v_wallet;

  insert into public.token_ledger (
    user_id,
    event_type,
    action_type,
    operation_key,
    operation_id,
    request_id,
    idempotency_key,
    charge_phase,
    tokens_delta,
    balance_after,
    metadata
  ) values (
    p_user_id,
    case when p_tokens_delta > 0 then 'admin_grant' else 'admin_debit' end,
    'admin_adjustment',
    'ADMIN_ADJUSTMENT',
    p_operation_id,
    p_request_id,
    v_idempotency_key,
    'manual',
    p_tokens_delta,
    v_wallet.balance_tokens,
    v_metadata || jsonb_build_object('reason', v_reason, 'admin_user_id', p_admin_user_id)
  )
  returning id into v_ledger_id;

  return query select v_wallet.balance_tokens, v_ledger_id;
end;
$$;

revoke all on function public.apply_admin_token_adjustment(
  uuid,
  integer,
  text,
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.apply_admin_token_adjustment(
  uuid,
  integer,
  text,
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;
