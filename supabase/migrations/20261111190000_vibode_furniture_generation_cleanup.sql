-- MESHY-1D.3C temporary generation cleanup.
--
-- Expired inputs are eligible only after the job no longer needs the
-- photograph. needs_review inputs stay and are counted for an operator.
-- A candidate is eligible after discard, expiry, failure, or cancellation,
-- or after a durable save has stored the library GLB. The library object
-- users/{userId}/assets/.../model.glb is never selected.
--
-- The stale-reservation sweep is unchanged. The worker calls it from the
-- cleanup pass when cleanup is enabled, and from the processing pass when
-- cleanup is off. Reservation still calls it. Contacted jobs are not
-- cancelled. Allowance events remain immutable and keep surviving account
-- deletion; this slice does not rewrite that audit policy.
--
-- Review before applying. Do not apply to hosted Supabase without approval.

begin;

create or replace function public.vibode_furniture_generation_candidate_purgeable(
  p_job public.vibode_furniture_generation_jobs
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $fn$
  select
    p_job.output_bucket = 'vibode-furniture-assets'
    and p_job.output_object_path = 'users/' || p_job.user_id::text
      || '/generations/' || p_job.job_id::text || '/candidate.glb'
    and position('/assets/' in p_job.output_object_path) = 0
    and (
      (
        p_job.saved_asset_id is null
        and p_job.status in ('discarded', 'expired', 'failed', 'cancelled')
      )
      or (
        p_job.status = 'saved'
        and p_job.saved_asset_id is not null
        and exists (
          select 1
          from public.vibode_furniture_assets as asset
          where asset.asset_id = p_job.saved_asset_id
            and asset.user_id = p_job.user_id
            and asset.storage_bucket = 'vibode-furniture-assets'
            and asset.storage_object_path = 'users/' || p_job.user_id::text
              || '/assets/' || right(p_job.saved_asset_id, 36) || '/model.glb'
        )
      )
    );
$fn$;

create or replace function public.list_vibode_furniture_generation_temporary_objects(
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_limit integer := case
    when p_limit is null or p_limit < 1 or p_limit > 50 then 50
    else p_limit
  end;
  v_rows jsonb;
  v_retained integer;
begin
  with candidates as (
    select
      'input'::text as kind,
      input.storage_bucket as bucket,
      input.storage_object_path as path,
      input.job_id,
      input.user_id,
      input.slot,
      input.created_at
    from public.vibode_furniture_generation_inputs as input
    join public.vibode_furniture_generation_jobs as job
      on job.job_id = input.job_id
     and job.user_id = input.user_id
    where input.purged_at is null
      and input.expires_at <= now()
      and job.status in ('ready', 'saved', 'failed', 'discarded', 'expired', 'cancelled')
      and input.storage_bucket = 'vibode-furniture-generation-inputs'
      and input.storage_object_path = 'users/' || input.user_id::text || '/inputs/' || input.job_id::text || '/' || input.slot || '.'
        || case input.mime_type
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          else 'webp'
        end
    union all
    select
      'candidate'::text,
      job.output_bucket,
      job.output_object_path,
      job.job_id,
      job.user_id,
      null::text,
      job.updated_at
    from public.vibode_furniture_generation_jobs as job
    where public.vibode_furniture_generation_candidate_purgeable(job)
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

  select count(*)::integer
  into v_retained
  from public.vibode_furniture_generation_inputs as input
  join public.vibode_furniture_generation_jobs as job
    on job.job_id = input.job_id
   and job.user_id = input.user_id
  where input.purged_at is null
    and input.expires_at <= now()
    and job.status = 'needs_review';

  return jsonb_build_object(
    'ok', true,
    'objects', v_rows,
    'retained_for_review', coalesce(v_retained, 0)
  );
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
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_count integer;
begin
  if p_kind = 'input' then
    update public.vibode_furniture_generation_inputs as input
    set purged_at = coalesce(input.purged_at, now())
    from public.vibode_furniture_generation_jobs as job
    where input.job_id = p_job_id
      and input.slot = p_slot
      and job.job_id = input.job_id
      and job.user_id = input.user_id
      and job.status in ('ready', 'saved', 'failed', 'discarded', 'expired', 'cancelled')
      and input.expires_at <= now()
      and input.storage_bucket = 'vibode-furniture-generation-inputs'
      and input.storage_object_path = 'users/' || input.user_id::text || '/inputs/' || input.job_id::text || '/' || input.slot || '.'
        || case input.mime_type
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

  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id
  for update;
  if not found or not public.vibode_furniture_generation_candidate_purgeable(v_job) then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs as job
  set output_bucket = null,
    output_object_path = null,
    output_sha256 = null,
    output_byte_size = null
  where job.job_id = v_job.job_id
    and public.vibode_furniture_generation_candidate_purgeable(job);
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  return jsonb_build_object('ok', true, 'kind', 'candidate');
end;
$fn$;

comment on function public.list_vibode_furniture_generation_temporary_objects(integer) is
  'At most 50 expired temporary generation objects. Active and needs_review inputs are omitted. Library GLBs are omitted.';

comment on function public.mark_vibode_furniture_generation_temporary_object_purged(text, uuid, text) is
  'Records a purge only while the same eligibility rules still hold. It does not delete the permanent library object.';

revoke all on function public.vibode_furniture_generation_candidate_purgeable(public.vibode_furniture_generation_jobs) from public, anon, authenticated, service_role;
revoke all on function public.list_vibode_furniture_generation_temporary_objects(integer) from public, anon, authenticated;
revoke all on function public.mark_vibode_furniture_generation_temporary_object_purged(text, uuid, text) from public, anon, authenticated;
grant execute on function public.list_vibode_furniture_generation_temporary_objects(integer) to service_role;
grant execute on function public.mark_vibode_furniture_generation_temporary_object_purged(text, uuid, text) to service_role;

commit;
