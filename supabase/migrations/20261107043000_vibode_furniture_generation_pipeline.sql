-- MESHY-1C.2A generation pipeline helpers.
--
-- service_role may execute these functions. Browser roles cannot.
-- claim_next is the only worker entry. A reserved job is submitted only
-- when the caller passes submit permission and the database switch is on.
-- Follow-up claims stay read-only until an administrator authorizes a
-- second POST. Cleanup never touches vibode_furniture_assets.
--
-- Do not apply this file to hosted Supabase without explicit approval.

begin;

create or replace function public.read_vibode_furniture_generation(
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
  where job_id = p_job_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', v_job.status,
    'progress', v_job.progress,
    'quota_state', v_job.quota_state,
    'error_class', v_job.error_class,
    'error_code', v_job.error_code,
    'saved_asset_id', v_job.saved_asset_id,
    'output_bucket', v_job.output_bucket,
    'output_object_path', v_job.output_object_path,
    'output_expires_at', v_job.output_expires_at
  );
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_controls()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_live boolean;
begin
  select live_enabled into v_live
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  if not found then
    return jsonb_build_object('ok', true, 'live_enabled', false);
  end if;
  return jsonb_build_object('ok', true, 'live_enabled', coalesce(v_live, false));
end;
$fn$;

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
    'settings', v_job.settings,
    'image_slots', to_jsonb(v_job.image_slots)
  );
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_inputs(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', slot,
    'storage_bucket', storage_bucket,
    'storage_object_path', storage_object_path,
    'sha256', sha256,
    'mime_type', mime_type,
    'byte_size', byte_size,
    'width_px', width_px,
    'height_px', height_px
  ) order by ordinal), '[]'::jsonb)
  into v_rows
  from public.vibode_furniture_generation_inputs
  where job_id = p_job_id
    and user_id = p_user_id
    and purged_at is null;
  return jsonb_build_object('ok', true, 'inputs', v_rows);
end;
$fn$;

create or replace function public.sweep_vibode_furniture_generation_holds()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  perform public.vibode_furniture_generation_release_stale();
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.list_vibode_furniture_generation_temporary_objects(
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_limit integer := case
    when p_limit is null or p_limit < 1 then 50
    when p_limit > 100 then 100
    else p_limit
  end;
  v_rows jsonb;
begin
  with candidates as (
    select
      'input'::text as kind,
      storage_bucket as bucket,
      storage_object_path as path,
      job_id,
      user_id,
      slot,
      created_at
    from public.vibode_furniture_generation_inputs
    where purged_at is null
      and expires_at <= now()
      and storage_bucket = 'vibode-furniture-generation-inputs'
      and storage_object_path = 'users/' || user_id::text || '/inputs/' || job_id::text || '/' || slot || '.'
        || case mime_type
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          else 'webp'
        end
    union all
    select
      'candidate'::text,
      output_bucket,
      output_object_path,
      job_id,
      user_id,
      null::text,
      updated_at
    from public.vibode_furniture_generation_jobs
    where saved_asset_id is null
      and status in ('discarded', 'expired', 'failed', 'cancelled')
      and output_bucket = 'vibode-furniture-assets'
      and output_object_path = 'users/' || user_id::text || '/generations/' || job_id::text || '/candidate.glb'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind,
    'bucket', bucket,
    'path', path,
    'job_id', job_id,
    'user_id', user_id,
    'slot', slot
  )), '[]'::jsonb)
  into v_rows
  from (
    select * from candidates
    order by created_at
    limit v_limit
  ) limited;
  return jsonb_build_object('ok', true, 'objects', v_rows);
end;
$fn$;

create or replace function public.mark_vibode_furniture_generation_temporary_object_purged(
  p_kind text,
  p_job_id uuid,
  p_slot text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_count integer;
begin
  if p_kind = 'input' then
    update public.vibode_furniture_generation_inputs
    set purged_at = coalesce(purged_at, now())
    where job_id = p_job_id
      and slot = p_slot
      and storage_bucket = 'vibode-furniture-generation-inputs'
      and storage_object_path = 'users/' || user_id::text || '/inputs/' || job_id::text || '/' || slot || '.'
        || case mime_type
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          else 'webp'
        end;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    return jsonb_build_object('ok', true, 'kind', 'input');
  end if;
  if p_kind is distinct from 'candidate' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set output_bucket = null,
    output_object_path = null,
    output_sha256 = null,
    output_byte_size = null
  where job_id = p_job_id
    and saved_asset_id is null
    and status in ('discarded', 'expired', 'failed', 'cancelled')
    and (
      output_object_path is null
      or output_object_path = 'users/' || user_id::text || '/generations/' || job_id::text || '/candidate.glb'
    );
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  return jsonb_build_object('ok', true, 'kind', 'candidate');
end;
$fn$;

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

revoke all on function public.read_vibode_furniture_generation_controls() from public, anon, authenticated;
revoke all on function public.claim_next_vibode_furniture_generation(boolean) from public, anon, authenticated;
revoke all on function public.read_vibode_furniture_generation_inputs(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sweep_vibode_furniture_generation_holds() from public, anon, authenticated;
revoke all on function public.list_vibode_furniture_generation_temporary_objects(integer) from public, anon, authenticated;
revoke all on function public.mark_vibode_furniture_generation_temporary_object_purged(text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_authorize_vibode_furniture_generation_resubmit(uuid, boolean) from public, anon, authenticated;

grant execute on function public.read_vibode_furniture_generation_controls() to service_role;
grant execute on function public.claim_next_vibode_furniture_generation(boolean) to service_role;
grant execute on function public.read_vibode_furniture_generation_inputs(uuid, uuid) to service_role;
grant execute on function public.sweep_vibode_furniture_generation_holds() to service_role;
grant execute on function public.list_vibode_furniture_generation_temporary_objects(integer) to service_role;
grant execute on function public.mark_vibode_furniture_generation_temporary_object_purged(text, uuid, text) to service_role;
grant execute on function public.admin_authorize_vibode_furniture_generation_resubmit(uuid, boolean) to service_role;

commit;
