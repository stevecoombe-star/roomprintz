-- MESHY-1D.2F missing provider-credit accounting.
--
-- Meshy's task payload has no contract, in this repository, that
-- consumed_credits is present when a task first becomes FAILED, CANCELED,
-- or SUCCEEDED, or that a later read cannot change it. A missing value is
-- therefore not zero and not final. The first authoritative integer is
-- recorded once. A later disagreement does not rewrite it.
--
-- A terminal task with no number moves to needs_review. That frees the
-- single processing slot and keeps the tester reservation and the original
-- credit hold. It does not start another provider POST.
--
-- This file does not rewrite stored jobs, invent historical amounts, or
-- change the global control row. Do not apply it to hosted Supabase
-- without explicit approval.

begin;

create table public.vibode_furniture_generation_credit_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  user_id uuid not null,
  actor_user_id uuid not null,
  provider_task_id text not null,
  provider_status text not null,
  consumed_credits integer not null,
  reason text not null,
  evidence_ref text not null,
  created_at timestamptz not null default now(),
  constraint vibode_furniture_generation_credit_resolutions_job unique (job_id),
  constraint vibode_furniture_generation_credit_resolutions_task
    check (provider_task_id ~ '^[A-Za-z0-9-]{8,80}$'),
  constraint vibode_furniture_generation_credit_resolutions_status
    check (provider_status in ('SUCCEEDED', 'FAILED', 'CANCELED')),
  constraint vibode_furniture_generation_credit_resolutions_credits
    check (consumed_credits >= 0 and consumed_credits <= 1000),
  constraint vibode_furniture_generation_credit_resolutions_reason
    check (char_length(btrim(reason)) between 8 and 200),
  constraint vibode_furniture_generation_credit_resolutions_evidence
    check (char_length(btrim(evidence_ref)) between 8 and 200)
);

comment on table public.vibode_furniture_generation_credit_resolutions is
  'One operator record of a provider credit amount that Meshy did not report. Identifiers are copied without foreign keys. Rows are immutable.';

alter table public.vibode_furniture_generation_credit_resolutions enable row level security;

revoke all on table public.vibode_furniture_generation_credit_resolutions from public, anon, authenticated, service_role;

create or replace function public.vibode_furniture_generation_credit_resolutions_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'VIBODE_FURNITURE_GENERATION:CREDIT_RESOLUTION_IMMUTABLE';
end;
$fn$;

create trigger vibode_furniture_generation_credit_resolutions_no_update
before update on public.vibode_furniture_generation_credit_resolutions
for each row execute function public.vibode_furniture_generation_credit_resolutions_immutable();

create trigger vibode_furniture_generation_credit_resolutions_no_delete
before delete on public.vibode_furniture_generation_credit_resolutions
for each row execute function public.vibode_furniture_generation_credit_resolutions_immutable();

create trigger vibode_furniture_generation_credit_resolutions_no_truncate
before truncate on public.vibode_furniture_generation_credit_resolutions
for each statement execute function public.vibode_furniture_generation_credit_resolutions_immutable();

revoke all on function public.vibode_furniture_generation_credit_resolutions_immutable() from public, anon, authenticated, service_role;

create or replace function public.vibode_furniture_generation_record_known_credits(
  p_job_id uuid,
  p_consumed integer,
  p_provider_status text,
  p_progress integer,
  p_error_code text,
  p_release_claim boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
  v_slot_busy boolean;
begin
  if p_consumed is null or p_consumed < 0 or p_consumed > 1000
    or p_provider_status not in ('SUCCEEDED', 'FAILED', 'CANCELED')
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.consumed_credits is not null or v_job.quota_state is distinct from 'reserved' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'job_id', v_job.job_id,
      'status', v_job.status,
      'consumed_credits', v_job.consumed_credits
    );
  end if;

  if p_provider_status in ('FAILED', 'CANCELED') then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits,
      credits_consumed = credits_consumed + case when p_consumed > 0 then p_consumed else 0 end
    where control_id = 'global';
    v_allowance := public.vibode_furniture_generation_settle_allowance(
      v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
    );
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = 'failed',
      quota_state = case when p_consumed > 0 then 'reconciled' else 'released' end,
      allowance_state = v_allowance,
      consumed_credits = p_consumed,
      error_class = 'provider_failed',
      error_code = left(coalesce(p_error_code, p_provider_status), 80),
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'job_id', v_job.job_id,
      'status', 'failed',
      'consumed_credits', p_consumed,
      'error_class', 'provider_failed'
    );
  end if;

  update public.vibode_furniture_generation_controls
  set credits_reserved = credits_reserved - v_job.reserved_credits,
    credits_consumed = credits_consumed + p_consumed
  where control_id = 'global';
  select exists (
    select 1 from public.vibode_furniture_generation_jobs
    where job_id <> v_job.job_id
      and status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  ) into v_slot_busy;
  if v_slot_busy then
    update public.vibode_furniture_generation_jobs
    set provider_status = 'SUCCEEDED',
      progress = p_progress,
      status = 'needs_review',
      quota_state = 'reconciled',
      consumed_credits = p_consumed,
      error_class = null,
      error_code = null,
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'job_id', v_job.job_id,
      'status', 'needs_review',
      'consumed_credits', p_consumed
    );
  end if;
  update public.vibode_furniture_generation_jobs
  set provider_status = 'SUCCEEDED',
    progress = p_progress,
    status = 'ingesting',
    quota_state = 'reconciled',
    consumed_credits = p_consumed,
    error_class = null,
    error_code = null,
    claim_nonce = case when p_release_claim then null else claim_nonce end,
    claim_expires_at = case when p_release_claim then null else claim_expires_at end
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'job_id', v_job.job_id,
    'status', 'ingesting',
    'consumed_credits', p_consumed,
    'claim_nonce', case when p_release_claim then null else v_job.claim_nonce end
  );
end;
$fn$;

revoke all on function public.vibode_furniture_generation_record_known_credits(uuid, integer, text, integer, text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.apply_vibode_furniture_generation_observation(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_provider_status text,
  p_progress integer,
  p_consumed_credits integer,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_open boolean;
  v_result jsonb;
begin
  if p_provider_status not in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED')
    or p_progress is null or p_progress < 0 or p_progress > 100
    or (p_consumed_credits is not null and p_consumed_credits < 0)
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
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
  if v_job.provider_task_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.status in ('ready', 'saved', 'failed', 'discarded', 'expired', 'cancelled') then
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_job.status, 'idempotent', true);
  end if;
  if v_job.status = 'ingesting' then
    if p_provider_status <> 'SUCCEEDED' then
      return jsonb_build_object('ok', false, 'code', 'not_claimable');
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting', 'idempotent', true);
  end if;
  v_open := v_job.status = 'needs_review'
    and v_job.error_class = 'credit_unreported'
    and v_job.consumed_credits is null
    and v_job.quota_state = 'reserved';
  if v_job.status = 'needs_review' and not v_open then
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'needs_review', 'idempotent', true);
  end if;
  if v_job.status <> 'running' and not v_open then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;

  if p_provider_status in ('PENDING', 'IN_PROGRESS') then
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = case when v_open then 'needs_review' else 'running' end,
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object(
      'ok', true,
      'job_id', v_job.job_id,
      'status', case when v_open then 'needs_review' else 'running' end,
      'error_class', case when v_open then 'credit_unreported' else null end
    );
  end if;

  if p_consumed_credits is null then
    if v_job.consumed_credits is not null or v_job.quota_state is distinct from 'reserved' then
      if p_provider_status = 'SUCCEEDED' and v_job.status = 'running' then
        update public.vibode_furniture_generation_jobs
        set provider_status = 'SUCCEEDED',
          progress = p_progress,
          status = 'ingesting',
          error_class = null
        where job_id = v_job.job_id;
        return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting', 'claim_nonce', v_job.claim_nonce);
      end if;
      update public.vibode_furniture_generation_jobs
      set claim_nonce = null, claim_expires_at = null
      where job_id = v_job.job_id;
      return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_job.status, 'idempotent', true);
    end if;
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = 'needs_review',
      error_class = 'credit_unreported',
      error_code = 'credit_unreported',
      resubmit_authorized_at = null,
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object(
      'ok', true,
      'job_id', v_job.job_id,
      'status', 'needs_review',
      'error_class', 'credit_unreported'
    );
  end if;

  if v_job.consumed_credits is not null or v_job.quota_state is distinct from 'reserved' then
    if p_provider_status = 'SUCCEEDED' and v_job.status = 'running' then
      update public.vibode_furniture_generation_jobs
      set status = 'ingesting', error_class = null
      where job_id = v_job.job_id;
      return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting', 'claim_nonce', v_job.claim_nonce, 'idempotent', true);
    end if;
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_job.status, 'idempotent', true);
  end if;

  v_result := public.vibode_furniture_generation_record_known_credits(
    v_job.job_id,
    p_consumed_credits,
    p_provider_status,
    p_progress,
    p_error_code,
    false
  );
  return v_result;
end;
$fn$;

revoke all on function public.apply_vibode_furniture_generation_observation(uuid, uuid, uuid, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_vibode_furniture_generation_observation(uuid, uuid, uuid, text, integer, integer, text)
  to service_role;

create or replace function public.review_vibode_furniture_generation_contacted_input(
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
  if v_job.status <> 'reserved'
    or v_job.provider_task_id is not null
    or v_job.provider_contacted_at is null
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'needs_review',
    error_class = 'input_storage_failed',
    error_code = 'input_unreadable',
    resubmit_authorized_at = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'needs_review');
end;
$fn$;

revoke all on function public.review_vibode_furniture_generation_contacted_input(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.review_vibode_furniture_generation_contacted_input(uuid, uuid, uuid)
  to service_role;

create or replace function public.resolve_vibode_furniture_generation_provider_credits(
  p_actor_user_id uuid,
  p_job_id uuid,
  p_provider_task_id text,
  p_consumed_credits integer,
  p_reason text,
  p_evidence_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_existing public.vibode_furniture_generation_credit_resolutions%rowtype;
  v_result jsonb;
begin
  if p_actor_user_id is null
    or p_provider_task_id !~ '^[A-Za-z0-9-]{8,80}$'
    or p_consumed_credits is null
    or p_consumed_credits < 0
    or p_consumed_credits > 1000
    or p_reason is null
    or char_length(btrim(p_reason)) < 8
    or char_length(btrim(p_reason)) > 200
    or p_evidence_ref is null
    or char_length(btrim(p_evidence_ref)) < 8
    or char_length(btrim(p_evidence_ref)) > 200
    or p_reason ~* 'msy_|://'
    or p_evidence_ref ~* 'msy_|://'
    or not exists (select 1 from auth.users where id = p_actor_user_id)
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_existing
  from public.vibode_furniture_generation_credit_resolutions
  where job_id = p_job_id;
  if found then
    if v_existing.provider_task_id = p_provider_task_id
      and v_existing.consumed_credits = p_consumed_credits
    then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'job_id', v_job.job_id,
        'status', v_job.status,
        'consumed_credits', v_job.consumed_credits
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end if;
  if v_job.provider_task_id is distinct from p_provider_task_id then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.consumed_credits is not null or v_job.quota_state is distinct from 'reserved' then
    if v_job.consumed_credits = p_consumed_credits then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'job_id', v_job.job_id,
        'status', v_job.status,
        'consumed_credits', v_job.consumed_credits
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end if;
  if v_job.status <> 'needs_review'
    or v_job.error_class is distinct from 'credit_unreported'
    or v_job.provider_status not in ('SUCCEEDED', 'FAILED', 'CANCELED')
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_result := public.vibode_furniture_generation_record_known_credits(
    v_job.job_id,
    p_consumed_credits,
    v_job.provider_status,
    coalesce(v_job.progress, 0),
    v_job.provider_status,
    true
  );
  if coalesce(v_result->>'ok', 'false') <> 'true' or coalesce(v_result->>'idempotent', 'false') = 'true' then
    return v_result;
  end if;
  insert into public.vibode_furniture_generation_credit_resolutions (
    job_id, user_id, actor_user_id, provider_task_id, provider_status,
    consumed_credits, reason, evidence_ref
  ) values (
    v_job.job_id, v_job.user_id, p_actor_user_id, v_job.provider_task_id, v_job.provider_status,
    p_consumed_credits, btrim(p_reason), btrim(p_evidence_ref)
  );
  return v_result || jsonb_build_object('idempotent', false);
end;
$fn$;

revoke all on function public.resolve_vibode_furniture_generation_provider_credits(uuid, uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_vibode_furniture_generation_provider_credits(uuid, uuid, text, integer, text, text)
  to service_role;

create or replace function public.admin_authorize_vibode_furniture_generation_resubmit(
  p_job_id uuid,
  p_duplicate_charge_risk_accepted boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
begin
  if p_duplicate_charge_risk_accepted is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.status <> 'needs_review'
    or v_job.provider_task_id is not null
    or v_job.saved_asset_id is not null
    or v_job.attempt_count >= 2
    or v_job.error_class = 'credit_unreported'
    or (
      v_job.consumed_credits is null
      and v_job.provider_status in ('FAILED', 'CANCELED', 'SUCCEEDED')
    )
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'reserved',
    resubmit_authorized_at = now(),
    error_class = null,
    error_code = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', 'reserved',
    'duplicate_charge_risk', true
  );
end;
$fn$;

revoke all on function public.admin_authorize_vibode_furniture_generation_resubmit(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_authorize_vibode_furniture_generation_resubmit(uuid, boolean)
  to service_role;

create or replace function public.bind_vibode_furniture_generation_task(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_provider_task_id text,
  p_provider_status text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_promoted integer;
begin
  if p_provider_task_id !~ '^[A-Za-z0-9-]{8,80}$'
    or p_provider_status not in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED')
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
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
  if v_job.status not in ('submitting', 'ambiguous', 'needs_review') then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.provider_task_id is not null and v_job.provider_task_id is distinct from p_provider_task_id then
    return jsonb_build_object('ok', false, 'code', 'task_immutable');
  end if;
  if v_job.error_class = 'credit_unreported' and v_job.consumed_credits is null then
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'credit_unreported',
      'job_id', v_job.job_id,
      'status', v_job.status
    );
  end if;

  if v_job.status = 'needs_review' then
    begin
      update public.vibode_furniture_generation_jobs
      set provider_task_id = p_provider_task_id,
        provider_status = p_provider_status
      where job_id = v_job.job_id
        and status = 'needs_review'
        and (provider_task_id is null or provider_task_id = p_provider_task_id);
      if not found then
        return jsonb_build_object('ok', false, 'code', 'not_claimable');
      end if;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'code', 'task_immutable');
    end;
    if exists (
      select 1 from public.vibode_furniture_generation_jobs
      where job_id <> v_job.job_id
        and status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
    ) then
      update public.vibode_furniture_generation_jobs
      set claim_nonce = null, claim_expires_at = null
      where job_id = v_job.job_id;
      return jsonb_build_object(
        'ok', false,
        'code', 'concurrency_limited',
        'job_id', v_job.job_id,
        'status', 'needs_review',
        'provider_task_id', p_provider_task_id
      );
    end if;
    begin
      update public.vibode_furniture_generation_jobs
      set provider_task_id = p_provider_task_id,
        provider_status = p_provider_status,
        status = 'running',
        error_class = case when error_class in ('ambiguous_timeout', 'needs_review') then null else error_class end,
        resubmit_authorized_at = null,
        claim_nonce = null,
        claim_expires_at = null
      where job_id = v_job.job_id
        and status = 'needs_review'
        and (provider_task_id is null or provider_task_id = p_provider_task_id)
        and not exists (
          select 1 from public.vibode_furniture_generation_jobs
          where job_id <> v_job.job_id
            and status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
        );
      get diagnostics v_promoted = row_count;
      if v_promoted = 0 then
        update public.vibode_furniture_generation_jobs
        set claim_nonce = null, claim_expires_at = null
        where job_id = v_job.job_id;
        return jsonb_build_object(
          'ok', false,
          'code', 'concurrency_limited',
          'job_id', v_job.job_id,
          'status', 'needs_review',
          'provider_task_id', p_provider_task_id
        );
      end if;
    exception
      when unique_violation then
        update public.vibode_furniture_generation_jobs
        set claim_nonce = null, claim_expires_at = null
        where job_id = v_job.job_id
          and status = 'needs_review';
        return jsonb_build_object(
          'ok', false,
          'code', 'concurrency_limited',
          'job_id', v_job.job_id,
          'status', 'needs_review',
          'provider_task_id', p_provider_task_id
        );
    end;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running', 'provider_task_id', p_provider_task_id);
  end if;

  begin
    update public.vibode_furniture_generation_jobs
    set provider_task_id = p_provider_task_id,
      provider_status = p_provider_status,
      status = 'running',
      error_class = case when error_class in ('ambiguous_timeout', 'needs_review') then null else error_class end,
      resubmit_authorized_at = null,
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id
      and status in ('submitting', 'ambiguous');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_claimable');
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'task_immutable');
  end;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running', 'provider_task_id', p_provider_task_id);
end;
$fn$;

revoke all on function public.bind_vibode_furniture_generation_task(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.bind_vibode_furniture_generation_task(uuid, uuid, uuid, text, text)
  to service_role;

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
  order by created_at
  limit 1
  for update skip locked;
  if not found then
    return jsonb_build_object('ok', true, 'outcome', 'idle');
  end if;
  if v_job.status = 'reserved' and (p_submit_allowed is distinct from true or v_live is distinct from true) then
    return jsonb_build_object('ok', true, 'outcome', 'disabled');
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

revoke all on function public.claim_next_vibode_furniture_generation(boolean) from public, anon, authenticated;
grant execute on function public.claim_next_vibode_furniture_generation(boolean) to service_role;

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
  v_live boolean;
  v_authorized integer;
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
  if v_job.attempt_count >= 2 or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.attempt_count > 0 and v_job.resubmit_authorized_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select live_enabled, paid_submissions_authorized, paid_submissions_used
    into v_live, v_authorized, v_used
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  if v_live is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if v_used >= v_authorized and v_job.provider_contacted_at is null then
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
  end if;
  update public.vibode_furniture_generation_jobs
  set claim_nonce = v_nonce,
    claim_expires_at = now() + interval '120 seconds'
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'purpose', 'prepare',
    'job_id', v_job.job_id,
    'claim_nonce', v_nonce,
    'status', 'reserved'
  );
end;
$fn$;

revoke all on function public.claim_vibode_furniture_generation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_vibode_furniture_generation(uuid, uuid, text) to service_role;

commit;
