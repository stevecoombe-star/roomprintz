-- MESHY-1D.4D account-deletion financial guard and legacy resubmit lockdown.
--
-- A generation job with an open provider-credit hold is the remaining
-- evidence of that hold. Deleting the auth user used to cascade the job
-- away and leave credits_reserved unchanged. These triggers reject that
-- delete, and a direct delete of the job, before the row disappears.
-- The triggers read the job row only. They do not take the generation
-- advisory lock and do not lock the global control row.
--
-- The legacy three-argument resubmit function stays in place and loses
-- every browser and service-role execute grant. Operator recovery stays
-- on admin_authorize_vibode_furniture_generation_resubmit.
--
-- This file does not change the stored global control row, does not
-- release a hold, and does not record a provider outcome. Review it
-- before applying. Do not apply it to hosted Supabase without explicit
-- approval.

begin;

create or replace function public.vibode_furniture_generation_job_hold_unsettled(
  p_quota_state text,
  p_provider_contacted_at timestamptz,
  p_consumed_credits integer
) returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $fn$
  select p_quota_state = 'reserved'
    or (
      p_provider_contacted_at is not null
      and p_consumed_credits is null
      and p_quota_state is distinct from 'reconciled'
    );
$fn$;

comment on function public.vibode_furniture_generation_job_hold_unsettled(text, timestamptz, integer) is
  'True when a generation row still represents an unsettled provider-credit obligation. quota_state reserved is authoritative. A contacted row with no recorded consumption is included.';

revoke all on function public.vibode_furniture_generation_job_hold_unsettled(text, timestamptz, integer)
  from public, anon, authenticated, service_role;

create or replace function public.vibode_furniture_generation_jobs_block_unsettled_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if tg_op = 'DELETE' then
    if public.vibode_furniture_generation_job_hold_unsettled(
      old.quota_state,
      old.provider_contacted_at,
      old.consumed_credits
    ) then
      raise exception 'VIBODE_FURNITURE_GENERATION:UNSETTLED_HOLD'
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'TRUNCATE' then
    if exists (
      select 1
      from public.vibode_furniture_generation_jobs
      where public.vibode_furniture_generation_job_hold_unsettled(
        quota_state,
        provider_contacted_at,
        consumed_credits
      )
    ) then
      raise exception 'VIBODE_FURNITURE_GENERATION:UNSETTLED_HOLD'
        using errcode = 'P0001';
    end if;
    return null;
  end if;
  raise exception 'VIBODE_FURNITURE_GENERATION:UNSETTLED_HOLD'
    using errcode = 'P0001';
end;
$fn$;

comment on function public.vibode_furniture_generation_jobs_block_unsettled_delete() is
  'Rejects deletion of a generation job that still carries an unsettled provider-credit obligation. Leaves the row, the auth user, and the global counters unchanged.';

create trigger vibode_furniture_generation_jobs_block_unsettled_delete
before delete on public.vibode_furniture_generation_jobs
for each row
execute function public.vibode_furniture_generation_jobs_block_unsettled_delete();

create trigger vibode_furniture_generation_jobs_block_unsettled_truncate
before truncate on public.vibode_furniture_generation_jobs
for each statement
execute function public.vibode_furniture_generation_jobs_block_unsettled_delete();

create or replace function public.vibode_furniture_generation_block_unsettled_account_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if exists (
    select 1
    from public.vibode_furniture_generation_jobs
    where user_id = old.id
      and public.vibode_furniture_generation_job_hold_unsettled(
        quota_state,
        provider_contacted_at,
        consumed_credits
      )
  ) then
    raise exception 'VIBODE_FURNITURE_GENERATION:UNSETTLED_HOLD'
      using errcode = 'P0001';
  end if;
  return old;
end;
$fn$;

comment on function public.vibode_furniture_generation_block_unsettled_account_delete() is
  'Rejects auth-user deletion while that account still has an unsettled provider-credit obligation. The generation-job delete trigger remains the backstop for a direct job delete and for the auth cascade.';

create trigger vibode_furniture_generation_block_unsettled_account_delete
before delete on auth.users
for each row
execute function public.vibode_furniture_generation_block_unsettled_account_delete();

-- The role that deletes auth.users is the managed auth owner, which is
-- not service_role. Trigger execution stays available to that role. The
-- functions are security definer, read only the hold predicate, and
-- return no identifiers.
grant execute on function public.vibode_furniture_generation_jobs_block_unsettled_delete()
  to public;
grant execute on function public.vibode_furniture_generation_block_unsettled_account_delete()
  to public;

create or replace function public.vibode_furniture_generation_account_has_unsettled_hold(
  p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'blocked', exists (
      select 1
      from public.vibode_furniture_generation_jobs
      where user_id = p_user_id
        and public.vibode_furniture_generation_job_hold_unsettled(
          quota_state,
          provider_contacted_at,
          consumed_credits
        )
    )
  );
end;
$fn$;

comment on function public.vibode_furniture_generation_account_has_unsettled_hold(uuid) is
  'Service-role preflight for account deletion. Reports whether an unsettled provider-credit obligation exists and returns no job, task, or storage identifier.';

revoke all on function public.vibode_furniture_generation_account_has_unsettled_hold(uuid)
  from public, anon, authenticated;
grant execute on function public.vibode_furniture_generation_account_has_unsettled_hold(uuid)
  to service_role;

revoke all on function public.authorize_vibode_furniture_generation_resubmit(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

commit;
