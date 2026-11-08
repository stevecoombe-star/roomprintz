-- MESHY-1C.3A calibrated save linkage.
--
-- The application inserts the permanent vibode_furniture_assets row through
-- the existing service-role store, then calls the link function. This file
-- does not insert that row, does not read or write Storage, and does not
-- change the candidate object, its checksum, its byte count, or its expiry.
-- A saved asset does not inherit output_expires_at.
--
-- service_role may execute these functions. Browser roles cannot.
-- Do not apply this file to hosted Supabase without explicit approval.

begin;

create or replace function public.read_vibode_furniture_generation_save_source(
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
    'saved_asset_id', v_job.saved_asset_id,
    'output_bucket', v_job.output_bucket,
    'output_object_path', v_job.output_object_path,
    'output_sha256', v_job.output_sha256,
    'output_byte_size', v_job.output_byte_size,
    'output_expires_at', v_job.output_expires_at
  );
end;
$fn$;

create or replace function public.link_vibode_furniture_generation_saved_asset(
  p_user_id uuid,
  p_job_id uuid,
  p_asset_id text,
  p_source_sha256 text,
  p_source_byte_size bigint,
  p_asset_sha256 text,
  p_asset_byte_size bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_asset public.vibode_furniture_assets%rowtype;
  v_count integer;
begin
  if p_user_id is null or p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_asset_id is null
    or p_asset_id !~ '^vibode-furniture/personal/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_source_sha256 is null
    or p_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_asset_sha256 is null
    or p_asset_sha256 !~ '^[a-f0-9]{64}$'
    or p_source_byte_size is null
    or p_source_byte_size <= 0
    or p_source_byte_size > 26214400
    or p_asset_byte_size is null
    or p_asset_byte_size <= 0
    or p_asset_byte_size > 26214400
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

  select * into v_asset
  from public.vibode_furniture_assets
  where asset_id = p_asset_id
    and user_id = p_user_id
    and sha256 = p_asset_sha256
    and byte_size = p_asset_byte_size
    and origin = 'uploaded'
    and storage_bucket = 'vibode-furniture-assets'
    and storage_object_path = 'users/' || p_user_id::text || '/assets/'
      || right(p_asset_id, 36) || '/model.glb';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'asset_missing');
  end if;

  if v_job.saved_asset_id is not null or v_job.status = 'saved' then
    if v_job.status = 'saved' and v_job.saved_asset_id = p_asset_id then
      return jsonb_build_object('ok', true, 'status', 'saved', 'idempotent', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_saved');
  end if;

  if v_job.status <> 'ready'
    or v_job.output_bucket is distinct from 'vibode-furniture-assets'
    or v_job.output_object_path is distinct from 'users/' || p_user_id::text
      || '/generations/' || p_job_id::text || '/candidate.glb'
    or v_job.output_sha256 is distinct from p_source_sha256
    or v_job.output_byte_size is distinct from p_source_byte_size
    or v_job.output_expires_at is null
    or v_job.output_expires_at <= now()
  then
    if v_job.status = 'ready'
      and v_job.output_expires_at is not null
      and v_job.output_expires_at <= now()
    then
      return jsonb_build_object('ok', false, 'code', 'expired');
    end if;
    if v_job.output_sha256 is distinct from p_source_sha256
      or v_job.output_byte_size is distinct from p_source_byte_size
    then
      return jsonb_build_object('ok', false, 'code', 'source_mismatch');
    end if;
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;

  update public.vibode_furniture_generation_jobs
  set status = 'saved',
    saved_asset_id = p_asset_id
  where job_id = v_job.job_id
    and user_id = p_user_id
    and status = 'ready'
    and saved_asset_id is null
    and output_sha256 = p_source_sha256
    and output_byte_size = p_source_byte_size
    and output_expires_at > now();
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  return jsonb_build_object('ok', true, 'status', 'saved', 'idempotent', false);
end;
$fn$;

revoke all on function public.read_vibode_furniture_generation_save_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.link_vibode_furniture_generation_saved_asset(uuid, uuid, text, text, bigint, text, bigint) from public, anon, authenticated;

grant execute on function public.read_vibode_furniture_generation_save_source(uuid, uuid) to service_role;
grant execute on function public.link_vibode_furniture_generation_saved_asset(uuid, uuid, text, text, bigint, text, bigint) to service_role;

commit;
