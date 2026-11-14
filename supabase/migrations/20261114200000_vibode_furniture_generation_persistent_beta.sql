-- Persistent beta budget controls.
--
-- The certified ledger stays where the one-shot ceiling migration left it.
-- This file does not replay 20261113210000 and does not change consumed
-- credits, reserved credits, paid attempts already used, or the current
-- ceiling and authorization. An administrator raises those limits later,
-- with a reason, through admin_adjust_vibode_furniture_generation_budget.
--
-- Direct edits stay locked. service_role cannot update the controls table
-- and cannot execute the adjustment. The function runs only as the signed-in
-- administrator whose email matches the database setting vibode.admin_email.
-- Until that setting is present, every adjustment fails closed.
--
-- Hard rails: credit ceiling cannot pass 600, and paid authorization cannot
-- pass 20. Concurrency stays 1. Nothing in this file replenishes a budget.

begin;

alter table public.vibode_furniture_generation_controls
  drop constraint vibode_furniture_generation_controls_ceiling;
alter table public.vibode_furniture_generation_controls
  add constraint vibode_furniture_generation_controls_ceiling
    check (
      credit_ceiling >= credits_consumed + credits_reserved
      and credit_ceiling <= 600
    );

alter table public.vibode_furniture_generation_controls
  drop constraint vibode_furniture_generation_paid_authorized_range;
alter table public.vibode_furniture_generation_controls
  add constraint vibode_furniture_generation_paid_authorized_range
    check (
      paid_submissions_authorized >= paid_submissions_used
      and paid_submissions_authorized <= 20
    );

comment on column public.vibode_furniture_generation_controls.credit_ceiling is
  'Global Meshy credit ceiling. An audited administrator adjustment may set it from credits already consumed or reserved through 600.';
comment on column public.vibode_furniture_generation_controls.paid_submissions_authorized is
  'Paid Meshy submissions authorized for the beta. An audited administrator adjustment may set it from attempts already used through 20. It does not replenish itself.';

create table public.vibode_furniture_generation_budget_events (
  event_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  reason text not null,
  live_enabled_before boolean not null,
  live_enabled_after boolean not null,
  credit_ceiling_before integer not null,
  credit_ceiling_after integer not null,
  paid_submissions_authorized_before integer not null,
  paid_submissions_authorized_after integer not null,
  credits_consumed integer not null,
  credits_reserved integer not null,
  paid_submissions_used integer not null,
  created_at timestamptz not null default now(),
  constraint vibode_furniture_generation_budget_events_reason_length
    check (char_length(reason) between 1 and 200)
);

revoke all on table public.vibode_furniture_generation_budget_events
  from public, anon, authenticated, service_role;
alter table public.vibode_furniture_generation_budget_events enable row level security;

create or replace function public.vibode_furniture_generation_protect_controls()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_adjust text := current_setting('vibode.furniture_budget_adjustment', true);
begin
  if new.control_id is distinct from old.control_id
    or new.max_concurrent is distinct from old.max_concurrent
  then
    raise exception 'VIBODE_FURNITURE_GENERATION:CONTROLS_LOCKED';
  end if;
  if v_adjust is distinct from 'on' and (
    new.credit_ceiling is distinct from old.credit_ceiling
    or new.live_enabled is distinct from old.live_enabled
    or (
      new.paid_submissions_authorized is distinct from old.paid_submissions_authorized
      and not (
        old.paid_submissions_authorized = 0
        and new.paid_submissions_authorized = 1
      )
    )
  ) then
    raise exception 'VIBODE_FURNITURE_GENERATION:CONTROLS_LOCKED';
  end if;
  return new;
end;
$fn$;

create or replace function public.admin_adjust_vibode_furniture_generation_budget(
  p_credit_ceiling integer,
  p_paid_submissions_authorized integer,
  p_live_enabled boolean,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_admin text := lower(btrim(coalesce(current_setting('vibode.admin_email', true), '')));
  v_reason text;
  v_controls public.vibode_furniture_generation_controls%rowtype;
begin
  if v_actor is null or v_admin = '' then
    return jsonb_build_object('ok', false, 'code', 'budget_unauthorized');
  end if;
  select lower(email) into v_email
  from auth.users
  where id = v_actor;
  if v_email is null or v_email is distinct from v_admin then
    return jsonb_build_object('ok', false, 'code', 'budget_unauthorized');
  end if;
  v_reason := public.vibode_furniture_generation_admin_reason(p_reason);
  if v_reason is null or p_credit_ceiling is null or p_paid_submissions_authorized is null or p_live_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if p_credit_ceiling < v_controls.credits_consumed + v_controls.credits_reserved
    or p_credit_ceiling > 600
    or p_paid_submissions_authorized < v_controls.paid_submissions_used
    or p_paid_submissions_authorized > 20
  then
    return jsonb_build_object('ok', false, 'code', 'budget_bounds');
  end if;
  if p_credit_ceiling = v_controls.credit_ceiling
    and p_paid_submissions_authorized = v_controls.paid_submissions_authorized
    and p_live_enabled is not distinct from v_controls.live_enabled
  then
    return jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'live_enabled', v_controls.live_enabled,
      'credit_ceiling', v_controls.credit_ceiling,
      'paid_submissions_authorized', v_controls.paid_submissions_authorized,
      'credits_consumed', v_controls.credits_consumed,
      'credits_reserved', v_controls.credits_reserved,
      'paid_submissions_used', v_controls.paid_submissions_used,
      'max_concurrent', v_controls.max_concurrent
    );
  end if;

  perform set_config('vibode.furniture_budget_adjustment', 'on', true);
  update public.vibode_furniture_generation_controls
  set credit_ceiling = p_credit_ceiling,
    paid_submissions_authorized = p_paid_submissions_authorized,
    live_enabled = p_live_enabled
  where control_id = 'global';
  insert into public.vibode_furniture_generation_budget_events (
    actor_user_id, reason,
    live_enabled_before, live_enabled_after,
    credit_ceiling_before, credit_ceiling_after,
    paid_submissions_authorized_before, paid_submissions_authorized_after,
    credits_consumed, credits_reserved, paid_submissions_used
  ) values (
    v_actor, v_reason,
    v_controls.live_enabled, p_live_enabled,
    v_controls.credit_ceiling, p_credit_ceiling,
    v_controls.paid_submissions_authorized, p_paid_submissions_authorized,
    v_controls.credits_consumed, v_controls.credits_reserved, v_controls.paid_submissions_used
  );
  return jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'live_enabled', p_live_enabled,
    'credit_ceiling', p_credit_ceiling,
    'paid_submissions_authorized', p_paid_submissions_authorized,
    'credits_consumed', v_controls.credits_consumed,
    'credits_reserved', v_controls.credits_reserved,
    'paid_submissions_used', v_controls.paid_submissions_used,
    'max_concurrent', v_controls.max_concurrent
  );
end;
$fn$;

revoke all on function public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text)
  to authenticated;

create or replace function public.claim_next_vibode_furniture_generation(
  p_submit_allowed boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_live boolean;
  v_claim jsonb;
  v_intent text;
begin
  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
  select live_enabled into v_live
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'needs_review')
    and (claim_nonce is null or claim_expires_at <= now())
    and (
      status <> 'reserved'
      or (p_submit_allowed is true and v_live is true)
    )
  order by case when status = 'needs_review' then 1 else 0 end, created_at
  limit 1
  for update skip locked;
  if not found then
    if exists (
      select 1
      from public.vibode_furniture_generation_jobs
      where status = 'reserved'
        and (claim_nonce is null or claim_expires_at <= now())
    ) then
      return jsonb_build_object('ok', true, 'outcome', 'disabled');
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'idle');
  end if;
  v_intent := case when v_job.status = 'reserved' then 'submit' else 'follow' end;
  v_claim := public.claim_vibode_furniture_generation(v_job.user_id, v_job.job_id, v_intent);
  if coalesce(v_claim->>'ok', 'false') <> 'true' then
    return v_claim;
  end if;
  return v_claim || jsonb_build_object(
    'outcome', 'claimed',
    'user_id', v_job.user_id,
    'operation', v_job.operation,
    'provider_task_id', v_job.provider_task_id,
    'provider_task_name', v_job.provider_task_name,
    'provider_contacted_at', v_job.provider_contacted_at,
    'created_at', v_job.created_at,
    'error_class', v_job.error_class,
    'settings', v_job.settings,
    'image_slots', to_jsonb(v_job.image_slots)
  );
end;
$fn$;

revoke all on function public.claim_next_vibode_furniture_generation(boolean)
  from public, anon, authenticated;
grant execute on function public.claim_next_vibode_furniture_generation(boolean) to service_role;

comment on function public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text) is
  'Audited administrator change to the beta ceiling, paid-attempt authorization, and database admission. Historical consumed credits and used attempts stay put.';

commit;
