-- MESHY-1D.2C beta allowance settlement.
--
-- Completes the tester-allowance lifecycle on the existing terminal
-- transitions. A reserved beta job is consumed only when a validated
-- candidate becomes ready after provider credits are reconciled. It is
-- released when the outcome is a definite failure. Ambiguous work,
-- needs_review, and a provider result with no reported credit number keep
-- the tester reservation.
--
-- A null allowance_state is a MESHY-1C job. Those rows settle provider
-- credits exactly as before and never gain a tester event.
--
-- Callers that change the global credit hold update that row before calling
-- vibode_furniture_generation_settle_allowance. The helper then locks the
-- allowance row. That is the same controls-then-allowance order as
-- reservation, so the two paths do not deadlock.
--
-- This file does not change the stored global control row, the one-active
-- job index, or the one-POST paid-attempt rule. It does not enable
-- generation. Do not apply it to hosted Supabase without explicit approval.

begin;

create or replace function public.vibode_furniture_generation_settle_allowance(
  p_user_id uuid,
  p_job_id uuid,
  p_state text,
  p_action text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_furniture_generation_allowances%rowtype;
  v_updated integer;
  v_next text;
  v_delta_consumed integer;
  v_reason text;
begin
  if p_action not in ('release', 'consume') then
    raise exception 'VIBODE_FURNITURE_GENERATION:ALLOWANCE_ACTION';
  end if;
  if p_state is null then
    return null;
  end if;
  if p_action = 'release' and p_state = 'released' then
    return 'released';
  end if;
  if p_action = 'consume' and p_state = 'consumed' then
    return 'consumed';
  end if;
  if p_state is distinct from 'reserved' then
    raise exception 'VIBODE_FURNITURE_GENERATION:ALLOWANCE_STATE';
  end if;

  select * into v_row
  from public.vibode_furniture_generation_allowances
  where user_id = p_user_id
  for update;
  if not found or v_row.reserved_generations < 1 then
    raise exception 'VIBODE_FURNITURE_GENERATION:ALLOWANCE_REQUIRED';
  end if;

  if p_action = 'release' then
    v_next := 'released';
    v_delta_consumed := 0;
    v_reason := 'Beta generation released';
    update public.vibode_furniture_generation_allowances
    set reserved_generations = reserved_generations - 1,
      updated_by = null
    where user_id = p_user_id
      and reserved_generations >= 1;
  else
    v_next := 'consumed';
    v_delta_consumed := 1;
    v_reason := 'Beta generation consumed';
    update public.vibode_furniture_generation_allowances
    set reserved_generations = reserved_generations - 1,
      consumed_generations = consumed_generations + 1,
      updated_by = null
    where user_id = p_user_id
      and reserved_generations >= 1;
  end if;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VIBODE_FURNITURE_GENERATION:ALLOWANCE_REQUIRED';
  end if;

  insert into public.vibode_furniture_generation_allowance_events (
    user_id, actor_kind, actor_user_id, action,
    delta_authorized, delta_reserved, delta_consumed, job_id, reason
  ) values (
    p_user_id, 'system', null, p_action,
    0, -1, v_delta_consumed, p_job_id, v_reason
  );
  return v_next;
end;
$fn$;

revoke all on function public.vibode_furniture_generation_settle_allowance(uuid, uuid, text, text) from public, anon, authenticated, service_role;

create or replace function public.vibode_furniture_generation_release_stale()
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
begin
  -- A ready candidate was already consumed. Expiry does not refund it.
  update public.vibode_furniture_generation_jobs
  set status = 'expired',
    error_class = 'expired',
    error_code = 'expired',
    claim_nonce = null,
    claim_expires_at = null
  where status = 'ready'
    and saved_asset_id is null
    and output_expires_at is not null
    and output_expires_at <= now();

  for v_job in
    select *
    from public.vibode_furniture_generation_jobs
    where status = 'reserved'
      and provider_contacted_at is null
      and provider_task_id is null
      and saved_asset_id is null
      and created_at <= now() - interval '24 hours'
    for update
  loop
    if v_job.quota_state = 'reserved' then
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - v_job.reserved_credits
      where control_id = 'global';
    end if;
    v_allowance := public.vibode_furniture_generation_settle_allowance(
      v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
    );
    update public.vibode_furniture_generation_jobs
    set status = 'cancelled',
      quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
      allowance_state = v_allowance,
      consumed_credits = coalesce(consumed_credits, 0),
      error_class = 'cancelled',
      error_code = 'cancelled',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
  end loop;
end;
$fn$;

create or replace function public.fail_vibode_furniture_generation_before_provider(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
begin
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.status <> 'reserved' or v_job.provider_contacted_at is not null or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits
    where control_id = 'global';
  end if;
  v_allowance := public.vibode_furniture_generation_settle_allowance(
    v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
  );
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    quota_state = 'released',
    allowance_state = v_allowance,
    consumed_credits = 0,
    error_class = 'input_storage_failed',
    error_code = 'input_storage_failed'
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
end;
$fn$;

create or replace function public.fail_vibode_furniture_generation_create(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_error_class text,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
begin
  if p_error_class not in ('provider_rejected', 'provider_payment', 'provider_auth', 'provider_forbidden') then
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
  if v_job.status <> 'submitting' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits
    where control_id = 'global';
  end if;
  v_allowance := public.vibode_furniture_generation_settle_allowance(
    v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
  );
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
    allowance_state = v_allowance,
    consumed_credits = coalesce(consumed_credits, 0),
    error_class = p_error_class,
    error_code = left(coalesce(p_error_code, p_error_class), 80),
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
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
  v_allowance text;
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
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits
    where control_id = 'global';
  end if;
  v_allowance := public.vibode_furniture_generation_settle_allowance(
    v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
  );
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
    allowance_state = v_allowance,
    consumed_credits = coalesce(consumed_credits, 0),
    error_class = 'rate_limited',
    error_code = 'rate_limited',
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', 'failed',
    'error_class', 'rate_limited',
    'provider_credits_refunded', false
  );
end;
$fn$;

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
  v_consumed integer;
  v_allowance text;
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
  if v_job.status in ('ready', 'saved', 'failed', 'discarded', 'expired', 'cancelled', 'needs_review') then
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_job.status);
  end if;
  if v_job.status = 'ingesting' then
    if p_provider_status <> 'SUCCEEDED' then
      return jsonb_build_object('ok', false, 'code', 'not_claimable');
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting');
  end if;
  if v_job.status <> 'running' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if p_provider_status in ('PENDING', 'IN_PROGRESS') then
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = 'running',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running');
  end if;
  if p_provider_status in ('FAILED', 'CANCELED') then
    v_consumed := coalesce(p_consumed_credits, 0);
    if v_job.quota_state = 'reserved' then
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - v_job.reserved_credits,
        credits_consumed = credits_consumed + case when v_consumed > 0 then v_consumed else 0 end
      where control_id = 'global';
    end if;
    -- A missing number is not a numeric zero. Provider credits stay on the
    -- existing coalesce path; the tester reservation stays reserved.
    v_allowance := v_job.allowance_state;
    if p_consumed_credits is not null then
      v_allowance := public.vibode_furniture_generation_settle_allowance(
        v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
      );
    end if;
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = 'failed',
      quota_state = case
        when quota_state <> 'reserved' then quota_state
        when v_consumed > 0 then 'reconciled'
        else 'released'
      end,
      allowance_state = v_allowance,
      consumed_credits = case when quota_state = 'reserved' then v_consumed else consumed_credits end,
      error_class = 'provider_failed',
      error_code = left(coalesce(p_error_code, p_provider_status), 80),
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
  end if;
  if p_consumed_credits is null then
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      error_class = 'credit_unreported',
      status = 'running',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running', 'error_class', 'credit_unreported');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits,
      credits_consumed = credits_consumed + p_consumed_credits
    where control_id = 'global';
  end if;
  update public.vibode_furniture_generation_jobs
  set provider_status = 'SUCCEEDED',
    progress = p_progress,
    status = 'ingesting',
    quota_state = case when quota_state = 'reserved' then 'reconciled' else quota_state end,
    consumed_credits = case when quota_state = 'reserved' then p_consumed_credits else consumed_credits end,
    error_class = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting', 'claim_nonce', v_job.claim_nonce);
end;
$fn$;

create or replace function public.record_vibode_furniture_generation_output(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_byte_size bigint,
  p_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_path text;
  v_allowance text;
begin
  if p_sha256 !~ '^[a-f0-9]{64}$' or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 26214400 then
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
  if v_job.status <> 'ingesting' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.allowance_state = 'reserved'
    and (v_job.quota_state is distinct from 'reconciled' or v_job.consumed_credits is null)
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_allowance := public.vibode_furniture_generation_settle_allowance(
    v_job.user_id, v_job.job_id, v_job.allowance_state, 'consume'
  );
  v_path := 'users/' || v_job.user_id::text || '/generations/' || v_job.job_id::text || '/candidate.glb';
  update public.vibode_furniture_generation_jobs
  set output_bucket = 'vibode-furniture-assets',
    output_object_path = v_path,
    output_sha256 = p_sha256,
    output_byte_size = p_byte_size,
    output_expires_at = now() + interval '7 days',
    status = 'ready',
    allowance_state = v_allowance,
    saved_asset_id = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ready', 'output_object_path', v_path, 'saved_asset_id', null);
end;
$fn$;

create or replace function public.fail_vibode_furniture_generation_output(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_error_class text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
begin
  if p_error_class not in ('invalid_output', 'oversized_output', 'ingest_failed') then
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
  if v_job.status not in ('ingesting', 'running') then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_allowance := v_job.allowance_state;
  if v_job.allowance_state = 'reserved'
    and v_job.quota_state = 'reconciled'
    and v_job.consumed_credits is not null
  then
    v_allowance := public.vibode_furniture_generation_settle_allowance(
      v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
    );
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    allowance_state = v_allowance,
    error_class = p_error_class,
    error_code = left(p_error_class, 80),
    saved_asset_id = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed', 'error_class', p_error_class);
end;
$fn$;

create or replace function public.discard_vibode_furniture_generation_candidate(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
begin
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.saved_asset_id is not null or v_job.status = 'saved' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.status = 'ready' then
    update public.vibode_furniture_generation_jobs
    set status = 'discarded',
      error_class = 'discarded',
      error_code = 'discarded',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'discarded', 'provider_credits_refunded', false);
  end if;
  if v_job.status = 'reserved' and v_job.provider_contacted_at is null and v_job.provider_task_id is null then
    if v_job.quota_state = 'reserved' then
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - v_job.reserved_credits
      where control_id = 'global';
    end if;
    v_allowance := public.vibode_furniture_generation_settle_allowance(
      v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
    );
    update public.vibode_furniture_generation_jobs
    set status = 'cancelled',
      quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
      allowance_state = v_allowance,
      consumed_credits = coalesce(consumed_credits, 0),
      error_class = 'cancelled',
      error_code = 'cancelled',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'cancelled', 'provider_credits_refunded', false);
  end if;
  return jsonb_build_object('ok', false, 'code', 'not_claimable');
end;
$fn$;

commit;
