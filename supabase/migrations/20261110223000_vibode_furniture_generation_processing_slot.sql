-- MESHY-1D.2D processing slot.
--
-- The global processing index covers only reserved, submitting, ambiguous,
-- running, and ingesting. A ready candidate and a needs_review job no longer
-- occupy that one slot. needs_review still blocks its owner, and it keeps
-- the tester allowance, the provider-credit hold, the paid-attempt count,
-- and the provider contact history.
--
-- Binding a discovered provider task back to running takes the processing
-- slot only when it is free. If another job holds the slot, the reviewed job
-- stays in needs_review and keeps the task id that was just discovered.
-- This function does not submit a second provider POST.
--
-- A terminal FAILED or CANCELED provider task with no reported
-- consumed_credits is unchanged. Existing settlement records provider cost
-- 0 and leaves the tester allowance reserved. That job is failed, so it
-- leaves the processing slot, but the tester hold remains. Do not treat a
-- missing provider charge as zero in new code. SUCCEEDED with no reported
-- credits stays running and therefore keeps the processing slot. Both are
-- pre-beta accounting gaps, not this slice.
--
-- Review before apply. Do not apply this file to hosted Supabase without
-- explicit approval. It does not change the stored global control row.

begin;

do $occupancy$
declare
  v_conflicts integer;
begin
  select count(*) into v_conflicts
  from (
    select user_id
    from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'needs_review')
    group by user_id
    having count(*) > 1
  ) conflicts;
  if v_conflicts > 0 then
    raise exception 'VIBODE_FURNITURE_GENERATION:USER_OCCUPANCY'
      using errcode = '23505';
  end if;
end
$occupancy$;

drop index public.vibode_furniture_generation_jobs_one_active_uidx;

create unique index vibode_furniture_generation_jobs_one_active_uidx
  on public.vibode_furniture_generation_jobs ((1))
  where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting');

create unique index vibode_furniture_generation_jobs_one_user_open_uidx
  on public.vibode_furniture_generation_jobs (user_id)
  where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'needs_review');

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
    -- including when the allowance was later disabled or exhausted.
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

  -- Same first lock as reservation and claim_next, before the job row.
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
      set claim_nonce = null,
        claim_expires_at = null
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
        set claim_nonce = null,
          claim_expires_at = null
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
        set claim_nonce = null,
          claim_expires_at = null
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

revoke all on function public.bind_vibode_furniture_generation_task(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.bind_vibode_furniture_generation_task(uuid, uuid, uuid, text, text) to service_role;

commit;
