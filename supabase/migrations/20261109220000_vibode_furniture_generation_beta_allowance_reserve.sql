-- MESHY-1D.2B beta allowance reservation.
--
-- Replaces reserve_vibode_furniture_generation. A new job is admitted only
-- when the caller has an enabled allowance with a generation remaining and
-- the request is the certified beta profile. The job, the tester hold, the
-- system audit event, and the existing provider-credit hold commit together
-- or not at all.
--
-- This slice does not release or consume a tester allowance. A reserved
-- generation that later fails, expires, or is rejected by the provider keeps
-- reserved_generations until a later settlement slice. Do not enable the
-- beta on this migration alone.
--
-- The function can see the model, operation, image slots, settings, and the
-- server credit estimate. It cannot see photo bytes, pixel dimensions, or
-- the preimage of the request hash. The trusted server rejects a front photo
-- over 3 MB before it calls this function. A direct service-role call can
-- still reserve without those bytes; the attach function still accepts up
-- to 20 MB. That path is not a production admission path.
--
-- Review before apply. Do not apply this file to hosted Supabase without
-- explicit approval. It does not change the stored global control row.

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

  if exists (
    select 1 from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'ready', 'needs_review')
  ) then
    return jsonb_build_object('ok', false, 'code', 'concurrency_limited');
  end if;
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

commit;
