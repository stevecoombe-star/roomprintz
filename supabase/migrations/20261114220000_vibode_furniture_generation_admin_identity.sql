-- Durable administrator identity for the persistent furniture beta.
--
-- Hosted Supabase rejects ALTER DATABASE SET for the custom parameter
-- vibode.admin_email. A session setting is also caller-controlled, so it
-- cannot authorize a budget change. The signed-in administrator is the
-- auth.users email for auth.uid(), compared with the single row below.
--
-- This migration does not insert that row, change the ledger, or replay
-- 20261114200000. Until the table owner inserts the row, budget changes
-- fail closed. anon, authenticated, and service_role cannot read or write it.

begin;

create table public.vibode_furniture_generation_admin_identity (
  config_id text primary key,
  admin_email text not null,
  constraint vibode_furniture_generation_admin_identity_singleton
    check (config_id = 'admin'),
  constraint vibode_furniture_generation_admin_identity_email
    check (
      char_length(admin_email) between 6 and 320
      and admin_email = lower(admin_email)
      and admin_email !~ '[[:cntrl:][:space:]]'
      and position('@' in admin_email) > 1
    )
);

revoke all on table public.vibode_furniture_generation_admin_identity
  from public, anon, authenticated, service_role;
alter table public.vibode_furniture_generation_admin_identity enable row level security;

create or replace function public.vibode_furniture_generation_admin_identity_normalize()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  new.admin_email := lower(btrim(new.admin_email));
  return new;
end;
$fn$;

create trigger vibode_furniture_generation_admin_identity_normalize
  before insert or update on public.vibode_furniture_generation_admin_identity
  for each row execute function public.vibode_furniture_generation_admin_identity_normalize();

revoke all on function public.vibode_furniture_generation_admin_identity_normalize()
  from public, anon, authenticated, service_role;

create or replace function public.vibode_furniture_generation_budget_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_admin text;
begin
  if v_actor is null then
    return null;
  end if;
  select admin_email into v_admin
  from public.vibode_furniture_generation_admin_identity
  where config_id = 'admin';
  if v_admin is null then
    return null;
  end if;
  select lower(btrim(email)) into v_email
  from auth.users
  where id = v_actor;
  if v_email is null or v_email is distinct from v_admin then
    return null;
  end if;
  return v_actor;
end;
$fn$;

revoke all on function public.vibode_furniture_generation_budget_actor()
  from public, anon, authenticated, service_role;

create or replace function public.admin_adjust_vibode_furniture_generation_budget(
  p_credit_ceiling integer,
  p_paid_submissions_authorized integer,
  p_live_enabled boolean,
  p_reason text,
  p_confirmed boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_actor uuid := public.vibode_furniture_generation_budget_actor();
  v_reason text;
  v_controls public.vibode_furniture_generation_controls%rowtype;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'budget_unauthorized');
  end if;
  if p_confirmed is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'budget_confirm');
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
  if p_credit_ceiling < 0
    or p_paid_submissions_authorized < 0
    or p_credit_ceiling > 1000000000
    or p_paid_submissions_authorized > 1000000000
    or (
      p_credit_ceiling is distinct from v_controls.credit_ceiling
      and p_credit_ceiling::bigint < v_controls.credits_consumed::bigint + v_controls.credits_reserved::bigint
    )
    or (
      p_paid_submissions_authorized is distinct from v_controls.paid_submissions_authorized
      and p_paid_submissions_authorized < v_controls.paid_submissions_used
    )
  then
    return jsonb_build_object('ok', false, 'code', 'budget_bounds');
  end if;
  if p_credit_ceiling::bigint > v_controls.credit_ceiling::bigint
    + greatest(10000, v_controls.credit_ceiling)::bigint
    or p_paid_submissions_authorized::bigint > v_controls.paid_submissions_authorized::bigint
    + greatest(20, v_controls.paid_submissions_authorized)::bigint
  then
    return jsonb_build_object('ok', false, 'code', 'budget_step');
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
  perform set_config('vibode.furniture_budget_adjustment', 'off', true);
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

revoke all on function public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_adjust_vibode_furniture_generation_budget(integer, integer, boolean, text, boolean)
  to authenticated;

create or replace function public.admin_read_vibode_furniture_generation_budget_events(
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_actor uuid := public.vibode_furniture_generation_budget_actor();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_events jsonb;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'budget_unauthorized');
  end if;
  select coalesce(jsonb_agg(to_jsonb(event) order by event.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      event_id,
      actor_user_id,
      reason,
      live_enabled_before,
      live_enabled_after,
      credit_ceiling_before,
      credit_ceiling_after,
      paid_submissions_authorized_before,
      paid_submissions_authorized_after,
      credits_consumed,
      credits_reserved,
      paid_submissions_used,
      created_at
    from public.vibode_furniture_generation_budget_events
    order by created_at desc
    limit v_limit
  ) event;
  return jsonb_build_object('ok', true, 'events', v_events);
end;
$fn$;

revoke all on function public.admin_read_vibode_furniture_generation_budget_events(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_read_vibode_furniture_generation_budget_events(integer)
  to authenticated;

comment on table public.vibode_furniture_generation_admin_identity is
  'Single durable furniture-beta administrator email. The table owner writes it. Budget authorization reads auth.users for auth.uid() and does not accept a session setting.';

commit;
