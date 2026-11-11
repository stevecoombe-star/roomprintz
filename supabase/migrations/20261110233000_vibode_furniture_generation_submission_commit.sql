-- MESHY-1D.2E paid-submission preflight.
--
-- A reserved job receives a preparation lease before anyone reads its
-- photo. That lease does not increment paid_submissions_used, attempt_count,
-- or provider_contacted_at. The paid attempt is recorded in a later commit,
-- and only the worker holding the new submit lease may POST.
--
-- A terminal provider task with no reported consumed_credits is unchanged.
-- Existing settlement can record provider cost 0 while the tester allowance
-- stays reserved. This file does not treat a missing provider charge as zero.
--
-- Review before apply. Do not apply this file to hosted Supabase without
-- explicit approval. It does not change the stored global control row.

begin;

create or replace function public.vibode_furniture_generation_fail_unsent(
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
    error_code = 'input_storage_failed',
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
end;
$fn$;

revoke all on function public.vibode_furniture_generation_fail_unsent(uuid, uuid) from public, anon, authenticated, service_role;

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
begin
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
  return public.vibode_furniture_generation_fail_unsent(p_user_id, p_job_id);
end;
$fn$;

revoke all on function public.fail_vibode_furniture_generation_before_provider(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_vibode_furniture_generation_before_provider(uuid, uuid) to service_role;

create or replace function public.fail_vibode_furniture_generation_prepared_input(
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
  return public.vibode_furniture_generation_fail_unsent(p_user_id, p_job_id);
end;
$fn$;

revoke all on function public.fail_vibode_furniture_generation_prepared_input(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_vibode_furniture_generation_prepared_input(uuid, uuid, uuid) to service_role;

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
  if v_used >= v_authorized then
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
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
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

revoke all on function public.commit_vibode_furniture_generation_submission(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_vibode_furniture_generation_submission(uuid, uuid, uuid) to service_role;

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
    'settings', v_job.settings,
    'image_slots', to_jsonb(v_job.image_slots)
  );
end;
$fn$;

revoke all on function public.claim_next_vibode_furniture_generation(boolean) from public, anon, authenticated;
grant execute on function public.claim_next_vibode_furniture_generation(boolean) to service_role;

commit;
