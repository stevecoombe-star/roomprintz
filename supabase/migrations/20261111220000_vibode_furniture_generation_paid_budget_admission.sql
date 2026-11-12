-- MESHY-1D.4B paid-budget admission.
--
-- A new reservation requires a remaining paid submission before any job or
-- financial hold is created. The check runs under the existing advisory lock
-- and the global control-row lock, after an idempotent replay has been
-- returned. A same-key, same-hash replay still returns the existing job when
-- the budget is later exhausted.
--
-- A first attempt that is still definitively uncontacted releases its tester
-- reservation and provider-credit hold when the paid budget is gone at
-- commit time. A job with provider contact, including an operator-authorized
-- resubmission, keeps the Slice 7 review hold. This file does not change the
-- stored global control row and does not add another provider POST.
--
-- Review before applying. Do not apply to hosted Supabase without approval.

begin;

create or replace function public.reserve_vibode_furniture_generation(
  p_user_id uuid,
  p_job_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_operation text,
  p_ai_model text,
  p_settings jsonb,
  p_image_slots text[],
  p_reserved_credits integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_existing public.vibode_furniture_generation_jobs%rowtype;
  v_controls public.vibode_furniture_generation_controls%rowtype;
  v_allowance public.vibode_furniture_generation_allowances%rowtype;
  v_profile jsonb;
  v_credits integer;
begin
  if p_user_id is null or p_job_id is null
    or p_idempotency_key is null or p_idempotency_key !~ '^[a-z0-9-]{8,80}$'
    or p_request_sha256 is null or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or not exists (select 1 from auth.users where id = p_user_id)
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- One reservation at a time. Controls are locked before the allowance row.
  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);

  select * into v_existing
  from public.vibode_furniture_generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    -- A matching replay returns the original job and does not reserve again,
    -- including when the allowance or paid budget was later exhausted.
    if v_existing.request_sha256 = p_request_sha256 then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'job_id', v_existing.job_id,
        'status', v_existing.status,
        'reserved_credits', v_existing.reserved_credits,
        'provider_task_name', v_existing.provider_task_name
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  v_profile := jsonb_build_object(
    'geometryResolution', 'standard',
    'shouldTexture', true,
    'textureModel', 'default',
    'textureResolution', '2k',
    'enablePbr', false,
    'texturePrompt', '',
    'imageEnhancement', true,
    'shouldRemesh', false,
    'topology', 'triangle',
    'targetPolycount', 30000
  );
  if p_ai_model is distinct from 'meshy-7.1'
    or p_operation is distinct from 'image-to-3d'
    or p_image_slots is distinct from array['front']::text[]
    or not public.vibode_furniture_generation_slots_ok(p_operation, p_image_slots)
    or p_settings is distinct from v_profile
  then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;
  v_credits := public.vibode_furniture_generation_credit_estimate(p_operation, p_settings);
  if v_credits is distinct from 30 or p_reserved_credits is distinct from 30 then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;

  perform public.vibode_furniture_generation_release_stale();

  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found or v_controls.live_enabled is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if v_controls.paid_submissions_used >= v_controls.paid_submissions_authorized then
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
  end if;

  select * into v_allowance
  from public.vibode_furniture_generation_allowances
  where user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'allowance_required');
  end if;
  if v_allowance.enabled is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'allowance_disabled');
  end if;
  if v_allowance.authorized_generations
    - v_allowance.reserved_generations
    - v_allowance.consumed_generations < 1
  then
    return jsonb_build_object('ok', false, 'code', 'allowance_exhausted');
  end if;

  -- The owner stays blocked while an unresolved review still holds money.
  if exists (
    select 1 from public.vibode_furniture_generation_jobs
    where user_id = p_user_id
      and status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'needs_review')
  ) then
    return jsonb_build_object('ok', false, 'code', 'concurrency_limited');
  end if;
  if exists (
    select 1 from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  ) then
    return jsonb_build_object('ok', false, 'code', 'concurrency_limited');
  end if;
  -- credits_reserved includes holds on jobs outside the processing index.
  if v_controls.credits_reserved + v_controls.credits_consumed + v_credits > v_controls.credit_ceiling then
    return jsonb_build_object('ok', false, 'code', 'quota_exhausted');
  end if;

  insert into public.vibode_furniture_generation_jobs (
    job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
    settings, image_slots, provider_task_name, status, quota_state, allowance_state, reserved_credits
  ) values (
    p_job_id, p_user_id, 'meshy', 'meshy-7.1', p_operation, p_idempotency_key, p_request_sha256,
    p_settings, p_image_slots, 'vibode-' || p_job_id::text, 'reserved', 'reserved', 'reserved', v_credits
  );
  update public.vibode_furniture_generation_allowances
  set reserved_generations = reserved_generations + 1,
    updated_by = null
  where user_id = p_user_id;
  update public.vibode_furniture_generation_controls
  set credits_reserved = credits_reserved + v_credits
  where control_id = 'global';
  insert into public.vibode_furniture_generation_allowance_events (
    user_id, actor_kind, actor_user_id, action,
    delta_authorized, delta_reserved, delta_consumed, job_id, reason
  ) values (
    p_user_id, 'system', null, 'reserve',
    0, 1, 0, p_job_id, 'Beta generation reserved'
  );
  return jsonb_build_object(
    'ok', true,
    'created', true,
    'job_id', p_job_id,
    'status', 'reserved',
    'reserved_credits', v_credits,
    'provider_task_name', 'vibode-' || p_job_id::text
  );
end;
$fn$;

revoke all on function public.reserve_vibode_furniture_generation(uuid, uuid, text, text, text, text, jsonb, text[], integer) from public, anon, authenticated;
grant execute on function public.reserve_vibode_furniture_generation(uuid, uuid, text, text, text, text, jsonb, text[], integer) to service_role;

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
  select live_enabled into v_live
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  if v_live is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'disabled');
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

create or replace function public.commit_vibode_furniture_generation_submission(
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
  v_controls public.vibode_furniture_generation_controls%rowtype;
  v_nonce uuid;
  v_used integer;
  v_profile jsonb;
  v_allowance text;
  v_updated integer;
begin
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
  if v_job.status <> 'reserved' or v_job.provider_task_id is not null or v_job.attempt_count >= 2 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.attempt_count > 0 and v_job.resubmit_authorized_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_profile := jsonb_build_object(
    'geometryResolution', 'standard',
    'shouldTexture', true,
    'textureModel', 'default',
    'textureResolution', '2k',
    'enablePbr', false,
    'texturePrompt', '',
    'imageEnhancement', true,
    'shouldRemesh', false,
    'topology', 'triangle',
    'targetPolycount', 30000
  );
  if v_job.allowance_state is not null and (
    v_job.ai_model is distinct from 'meshy-7.1'
    or v_job.operation is distinct from 'image-to-3d'
    or v_job.image_slots is distinct from array['front']::text[]
    or v_job.settings is distinct from v_profile
    or v_job.reserved_credits is distinct from 30
  ) then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found or v_controls.live_enabled is distinct from true then
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  update public.vibode_furniture_generation_controls
  set paid_submissions_used = paid_submissions_used + 1
  where control_id = 'global'
    and paid_submissions_used < paid_submissions_authorized
  returning paid_submissions_used into v_used;
  if not found then
    if v_job.provider_contacted_at is not null then
      update public.vibode_furniture_generation_jobs
      set status = 'needs_review',
        error_class = 'submission_budget_exhausted',
        error_code = 'submission_budget_exhausted',
        resubmit_authorized_at = null,
        claim_nonce = null,
        claim_expires_at = null
      where job_id = v_job.job_id;
      insert into public.vibode_furniture_generation_resubmit_events (
        job_id, user_id, action, reason
      ) values (
        v_job.job_id, v_job.user_id, 'revoke', 'submission_budget_exhausted'
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'submission_not_authorized',
        'job_id', v_job.job_id,
        'status', 'needs_review',
        'error_class', 'submission_budget_exhausted'
      );
    end if;
    if v_job.status = 'reserved'
      and v_job.attempt_count = 0
      and v_job.provider_task_id is null
      and v_job.provider_contacted_at is null
      and v_job.resubmit_authorized_at is null
    then
      if v_job.quota_state = 'reserved' then
        update public.vibode_furniture_generation_controls
        set credits_reserved = credits_reserved - v_job.reserved_credits
        where control_id = 'global'
          and credits_reserved >= v_job.reserved_credits;
        if not found then
          raise exception 'VIBODE_FURNITURE_GENERATION:CREDIT_HOLD';
        end if;
      end if;
      v_allowance := public.vibode_furniture_generation_settle_allowance(
        v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
      );
      update public.vibode_furniture_generation_jobs
      set status = 'failed',
        quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
        allowance_state = v_allowance,
        consumed_credits = 0,
        error_class = 'submission_budget_exhausted',
        error_code = 'submission_budget_exhausted',
        claim_nonce = null,
        claim_expires_at = null
      where job_id = v_job.job_id
        and status = 'reserved'
        and attempt_count = 0
        and provider_task_id is null
        and provider_contacted_at is null
        and resubmit_authorized_at is null
        and claim_nonce = p_claim_nonce;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'VIBODE_FURNITURE_GENERATION:BUDGET_RELEASE';
      end if;
      return jsonb_build_object(
        'ok', false,
        'code', 'submission_not_authorized',
        'job_id', v_job.job_id,
        'status', 'failed',
        'error_class', 'submission_budget_exhausted'
      );
    end if;
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
  end if;
  if v_job.resubmit_authorized_at is not null then
    insert into public.vibode_furniture_generation_resubmit_events (
      job_id, user_id, action, reason
    ) values (
      v_job.job_id, v_job.user_id, 'consume', 'submission_committed'
    );
  end if;
  v_nonce := gen_random_uuid();
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
  return jsonb_build_object(
    'ok', true,
    'purpose', 'submit',
    'job_id', v_job.job_id,
    'claim_nonce', v_nonce,
    'status', 'submitting',
    'paid_submissions_used', v_used
  );
end;
$fn$;

revoke all on function public.commit_vibode_furniture_generation_submission(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_vibode_furniture_generation_submission(uuid, uuid, uuid)
  to service_role;

commit;
