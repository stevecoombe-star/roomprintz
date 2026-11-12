-- MESHY-1D.4C owner recent-generation read.
--
-- Returns at most 20 recoverable jobs for the user id the server passes in.
-- Order is created_at descending, then job_id descending.
-- Eligible statuses are reserved, submitting, ambiguous, running, ingesting,
-- and needs_review. A ready job is included only while it is unsaved and
-- its candidate has not expired. Failed, expired, saved, discarded, and
-- cancelled jobs are omitted so a later history view can add them.
-- The read does not check the admission switch or the tester allowance,
-- and it does not grant, reserve, or change global spending controls.
-- Browser roles cannot execute it.
--
-- Review before applying. Do not apply to hosted Supabase without approval.

begin;

create or replace function public.read_vibode_furniture_generation_owner_recent(
  p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_jobs jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select coalesce(jsonb_agg(item.job order by item.created_at desc, item.job_id desc), '[]'::jsonb)
    into v_jobs
  from (
    select
      created_at,
      job_id,
      jsonb_build_object(
        'job_id', job_id,
        'status', status,
        'error_class', case error_class
          when 'credit_unreported' then 'needs_review'
          when 'provider_payment' then 'provider_failed'
          when 'provider_auth' then 'provider_failed'
          when 'provider_forbidden' then 'provider_failed'
          when 'submission_budget_exhausted' then null
          when 'provider_rejected' then error_class
          when 'provider_failed' then error_class
          when 'rate_limited' then error_class
          when 'ambiguous_timeout' then error_class
          when 'invalid_output' then error_class
          when 'oversized_output' then error_class
          when 'ingest_failed' then error_class
          when 'input_storage_failed' then error_class
          when 'needs_review' then error_class
          else null
        end,
        'progress', progress,
        'created_at', created_at,
        'updated_at', updated_at,
        'output_expires_at', case when status = 'ready' then output_expires_at else null end,
        'preview_available', (
          status = 'ready'
          and saved_asset_id is null
          and output_expires_at > now()
          and output_object_path is not null
        )
      ) as job
    from public.vibode_furniture_generation_jobs
    where user_id = p_user_id
      and (
        status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'needs_review')
        or (
          status = 'ready'
          and saved_asset_id is null
          and output_expires_at > now()
        )
      )
    order by created_at desc, job_id desc
    limit 20
  ) item;

  return jsonb_build_object('ok', true, 'limit', 20, 'jobs', v_jobs);
end;
$fn$;

comment on function public.read_vibode_furniture_generation_owner_recent(uuid) is
  'Reads at most 20 recoverable generations for one owner. It does not grant generations or change spending controls.';

revoke all on function public.read_vibode_furniture_generation_owner_recent(uuid) from public, anon, authenticated;
grant execute on function public.read_vibode_furniture_generation_owner_recent(uuid) to service_role;

commit;
