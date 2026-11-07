-- MESHY-1C.2B paid-submission allowance.
-- Review before apply. This file is not applied to hosted Supabase in this phase.
--
-- paid_submissions_authorized starts at 0. An operator can raise it to 1 once.
-- paid_submissions_used counts provider submissions. A refund, failure, discard,
-- expiry, or worker restart does not return that count. HTTP 429 is the only
-- release, because Meshy confirmed that no task was created.

begin;

alter table public.vibode_furniture_generation_controls
  add column paid_submissions_authorized integer not null default 0,
  add column paid_submissions_used integer not null default 0;

alter table public.vibode_furniture_generation_controls
  add constraint vibode_furniture_generation_paid_authorized_range
    check (paid_submissions_authorized >= 0 and paid_submissions_authorized <= 1),
  add constraint vibode_furniture_generation_paid_used_range
    check (paid_submissions_used >= 0 and paid_submissions_used <= paid_submissions_authorized);

comment on column public.vibode_furniture_generation_controls.paid_submissions_authorized is
  'Operator-granted paid Meshy submissions. The initial policy allows at most one.';
comment on column public.vibode_furniture_generation_controls.paid_submissions_used is
  'Paid submissions already consumed. A Meshy refund does not return this allowance.';

create or replace function public.read_vibode_furniture_generation_controls()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_furniture_generation_controls%rowtype;
begin
  select * into v_row
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  if not found then
    return jsonb_build_object(
      'ok', true,
      'live_enabled', false,
      'paid_submissions_authorized', 0,
      'paid_submissions_used', 0
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'live_enabled', coalesce(v_row.live_enabled, false),
    'paid_submissions_authorized', v_row.paid_submissions_authorized,
    'paid_submissions_used', v_row.paid_submissions_used
  );
end;
$fn$;

create or replace function public.claim_vibode_furniture_generation(
  p_user_id uuid,
  p_job_id uuid,
  p_intent text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_nonce uuid;
  v_used integer;
begin
  if p_intent not in ('submit', 'follow') then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.claim_nonce is not null and v_job.claim_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'lease_held');
  end if;
  if p_intent = 'follow' and v_job.status = 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_nonce := gen_random_uuid();
  if v_job.status = 'needs_review' then
    if p_intent <> 'follow' then
      return jsonb_build_object('ok', false, 'code', 'not_claimable');
    end if;
    update public.vibode_furniture_generation_jobs
    set claim_nonce = v_nonce, claim_expires_at = now() + interval '120 seconds'
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'purpose', 'reconcile', 'job_id', v_job.job_id, 'claim_nonce', v_nonce, 'status', 'needs_review');
  end if;
  if v_job.provider_task_id is not null and v_job.status in ('running', 'ingesting') then
    update public.vibode_furniture_generation_jobs
    set claim_nonce = v_nonce, claim_expires_at = now() + interval '120 seconds'
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'purpose', 'poll', 'job_id', v_job.job_id, 'claim_nonce', v_nonce, 'status', v_job.status);
  end if;
  if v_job.status in ('submitting', 'ambiguous') then
    update public.vibode_furniture_generation_jobs
    set status = 'ambiguous',
      error_class = coalesce(error_class, 'ambiguous_timeout'),
      claim_nonce = v_nonce,
      claim_expires_at = now() + interval '120 seconds'
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'purpose', 'reconcile', 'job_id', v_job.job_id, 'claim_nonce', v_nonce, 'status', 'ambiguous');
  end if;
  if v_job.status <> 'reserved' or p_intent <> 'submit' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.attempt_count >= 2 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.attempt_count > 0 and v_job.resubmit_authorized_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_controls
  set paid_submissions_used = paid_submissions_used + 1
  where control_id = 'global'
    and paid_submissions_used < paid_submissions_authorized
  returning paid_submissions_used into v_used;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
  end if;
  update public.vibode_furniture_generation_jobs
  set attempt_count = attempt_count + 1,
    resubmit_authorized_at = null,
    provider_contacted_at = now(),
    absence_reconciled_at = null,
    status = 'submitting',
    error_class = null,
    error_code = null,
    claim_nonce = v_nonce,
    claim_expires_at = now() + interval '120 seconds'
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'purpose', 'submit', 'job_id', v_job.job_id, 'claim_nonce', v_nonce, 'status', 'submitting');
end;
$fn$;

create or replace function public.settle_vibode_furniture_generation_rate_limit(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
begin
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.claim_nonce is distinct from p_claim_nonce or v_job.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'lease_held');
  end if;
  if v_job.status <> 'submitting' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set attempt_count = greatest(0, attempt_count - 1),
    resubmit_authorized_at = case when attempt_count > 1 then now() else null end,
    provider_contacted_at = null,
    status = 'reserved',
    error_class = null,
    error_code = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  update public.vibode_furniture_generation_controls
  set paid_submissions_used = greatest(0, paid_submissions_used - 1)
  where control_id = 'global';
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'reserved');
end;
$fn$;

create or replace function public.grant_vibode_furniture_generation_paid_submission(
  p_acknowledge boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_controls public.vibode_furniture_generation_controls%rowtype;
begin
  if p_acknowledge is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  if v_controls.paid_submissions_authorized >= 1 then
    return jsonb_build_object(
      'ok', false,
      'code', 'allowance_closed',
      'paid_submissions_authorized', v_controls.paid_submissions_authorized,
      'paid_submissions_used', v_controls.paid_submissions_used
    );
  end if;
  update public.vibode_furniture_generation_controls
  set paid_submissions_authorized = 1
  where control_id = 'global'
    and paid_submissions_authorized = 0
  returning * into v_controls;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'allowance_closed');
  end if;
  return jsonb_build_object(
    'ok', true,
    'paid_submissions_authorized', v_controls.paid_submissions_authorized,
    'paid_submissions_used', v_controls.paid_submissions_used
  );
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_operator(
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_controls public.vibode_furniture_generation_controls%rowtype;
begin
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  if not found then
    return jsonb_build_object(
      'ok', true,
      'job_id', v_job.job_id,
      'status', v_job.status,
      'progress', v_job.progress,
      'error_class', v_job.error_class,
      'provider_status', v_job.provider_status,
      'consumed_credits', v_job.consumed_credits,
      'quota_state', v_job.quota_state,
      'attempt_count', v_job.attempt_count,
      'paid_submissions_authorized', 0,
      'paid_submissions_used', 0
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', v_job.status,
    'progress', v_job.progress,
    'error_class', v_job.error_class,
    'provider_status', v_job.provider_status,
    'consumed_credits', v_job.consumed_credits,
    'quota_state', v_job.quota_state,
    'attempt_count', v_job.attempt_count,
    'paid_submissions_authorized', coalesce(v_controls.paid_submissions_authorized, 0),
    'paid_submissions_used', coalesce(v_controls.paid_submissions_used, 0)
  );
end;
$fn$;

revoke all on function public.grant_vibode_furniture_generation_paid_submission(boolean) from public, anon, authenticated;
revoke all on function public.read_vibode_furniture_generation_operator(uuid) from public, anon, authenticated;
grant execute on function public.grant_vibode_furniture_generation_paid_submission(boolean) to service_role;
grant execute on function public.read_vibode_furniture_generation_operator(uuid) to service_role;

commit;
