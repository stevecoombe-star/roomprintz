-- MESHY-2B generation output ceiling.
--
-- A succeeded Meshy 7.1 image-to-3d task can return a textured GLB larger
-- than the 25 MiB manual furniture upload. The measured production file was
-- 70,297,756 bytes. Generation candidates and the saved calibrated asset
-- accept up to 100 MiB. Manual upload code keeps its 25 MiB check.
--
-- A paid success that still cannot be stored stays in needs_review with the
-- tester allowance reserved. It is not claimed again and it does not create
-- another provider task. A download or storage failure is tried at most
-- three times, then it stops. reopen_vibode_furniture_generation_succeeded_output
-- is the explicit recovery for that row. This file does not change credit
-- ceilings, paid-submission authorization, allowance grants, or live switches,
-- and it does not update an existing job.

begin;

alter table public.vibode_furniture_generation_jobs
  drop constraint vibode_furniture_generation_jobs_output_size;

alter table public.vibode_furniture_generation_jobs
  add constraint vibode_furniture_generation_jobs_output_size
  check (output_byte_size is null or (output_byte_size > 0 and output_byte_size <= 104857600));

alter table public.vibode_furniture_assets
  drop constraint vibode_furniture_assets_byte_size;

alter table public.vibode_furniture_assets
  add constraint vibode_furniture_assets_byte_size
  check (byte_size > 0 and byte_size <= 104857600);

update storage.buckets
set file_size_limit = 104857600
where id = 'vibode-furniture-assets';

alter table public.vibode_furniture_generation_jobs
  add column output_attempt_count integer not null default 0;

alter table public.vibode_furniture_generation_jobs
  add constraint vibode_furniture_generation_jobs_output_attempts
  check (output_attempt_count >= 0 and output_attempt_count <= 3);

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
  if p_sha256 !~ '^[a-f0-9]{64}$' or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 104857600 then
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
  v_status text;
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
  v_status := 'failed';
  if v_job.provider_status = 'SUCCEEDED'
    and v_job.consumed_credits is not null
    and v_job.quota_state = 'reconciled'
  then
    v_status := 'needs_review';
  elsif v_job.allowance_state = 'reserved'
    and v_job.quota_state = 'reconciled'
    and v_job.consumed_credits is not null
  then
    v_allowance := public.vibode_furniture_generation_settle_allowance(
      v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
    );
  end if;
  update public.vibode_furniture_generation_jobs
  set status = v_status,
    allowance_state = v_allowance,
    error_class = p_error_class,
    error_code = left(p_error_class, 80),
    saved_asset_id = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_status, 'error_class', p_error_class);
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
    or p_source_byte_size > 104857600
    or p_asset_byte_size is null
    or p_asset_byte_size <= 0
    or p_asset_byte_size > 104857600
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
    and (
      status <> 'reserved'
      or (p_submit_allowed is true and v_live is true)
    )
    and (
      status is distinct from 'needs_review'
      or error_class is null
      or error_class not in ('oversized_output', 'invalid_output', 'ingest_failed')
    )
  order by case when status = 'needs_review' then 1 else 0 end, created_at
  limit 1
  for update skip locked;
  if not found then
    if exists (
      select 1
      from public.vibode_furniture_generation_jobs
      where status = 'reserved'
        and (claim_nonce is null or claim_expires_at <= now())
    ) then
      return jsonb_build_object('ok', true, 'outcome', 'disabled');
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'idle');
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

create or replace function public.reopen_vibode_furniture_generation_succeeded_output(
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_allowance text;
  v_updated integer;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.provider_status is distinct from 'SUCCEEDED'
    or v_job.provider_task_id is null
    or v_job.consumed_credits is null
    or v_job.quota_state is distinct from 'reconciled'
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.status = 'ingesting' then
    return jsonb_build_object(
      'ok', true,
      'job_id', v_job.job_id,
      'status', 'ingesting',
      'idempotent', true,
      'provider_task_id', v_job.provider_task_id,
      'consumed_credits', v_job.consumed_credits,
      'attempt_count', v_job.attempt_count
    );
  end if;
  if v_job.status not in ('failed', 'needs_review')
    or v_job.error_class not in ('oversized_output', 'invalid_output', 'ingest_failed')
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_allowance := v_job.allowance_state;
  if v_job.allowance_state = 'released' then
    update public.vibode_furniture_generation_allowances
    set reserved_generations = reserved_generations + 1,
      updated_by = null
    where user_id = v_job.user_id
      and authorized_generations - reserved_generations - consumed_generations >= 1;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      return jsonb_build_object('ok', false, 'code', 'allowance_exhausted');
    end if;
    insert into public.vibode_furniture_generation_allowance_events (
      user_id, actor_kind, actor_user_id, action,
      delta_authorized, delta_reserved, delta_consumed, job_id, reason
    ) values (
      v_job.user_id, 'system', null, 'reserve',
      0, 1, 0, v_job.job_id, 'Recovered Meshy output re-reserved'
    );
    v_allowance := 'reserved';
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'ingesting',
    allowance_state = v_allowance,
    error_class = null,
    error_code = null,
    output_attempt_count = 0,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id
    and provider_task_id = v_job.provider_task_id
    and consumed_credits = v_job.consumed_credits
    and attempt_count = v_job.attempt_count
    and quota_state = 'reconciled';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VIBODE_FURNITURE_GENERATION:OUTPUT_REOPEN';
  end if;
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', 'ingesting',
    'idempotent', false,
    'provider_task_id', v_job.provider_task_id,
    'consumed_credits', v_job.consumed_credits,
    'attempt_count', v_job.attempt_count
  );
end;
$fn$;

create or replace function public.begin_vibode_furniture_generation_output_attempt(
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
  v_status text;
  v_allowance text;
  v_reason text;
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
  if v_job.status <> 'ingesting' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.output_attempt_count >= 3 then
    v_allowance := v_job.allowance_state;
    v_status := 'failed';
    v_reason := case when v_job.error_code in ('download', 'storage') then v_job.error_code else 'download' end;
    if v_job.provider_status = 'SUCCEEDED'
      and v_job.consumed_credits is not null
      and v_job.quota_state = 'reconciled'
    then
      v_status := 'needs_review';
    elsif v_job.allowance_state = 'reserved'
      and v_job.quota_state = 'reconciled'
      and v_job.consumed_credits is not null
    then
      v_allowance := public.vibode_furniture_generation_settle_allowance(
        v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
      );
    end if;
    update public.vibode_furniture_generation_jobs
    set status = v_status,
      allowance_state = v_allowance,
      error_class = 'ingest_failed',
      error_code = v_reason,
      saved_asset_id = null,
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'proceed', false, 'status', v_status, 'error_class', 'ingest_failed');
  end if;
  update public.vibode_furniture_generation_jobs
  set output_attempt_count = output_attempt_count + 1,
    claim_expires_at = now() + interval '120 seconds'
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'proceed', true,
    'status', 'ingesting',
    'attempts', v_job.output_attempt_count + 1
  );
end;
$fn$;

create or replace function public.renew_vibode_furniture_generation_claim(
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
  if v_job.status not in ('ingesting', 'running') then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set claim_expires_at = now() + interval '120 seconds'
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'status', v_job.status);
end;
$fn$;

create or replace function public.defer_vibode_furniture_generation_output(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_status text;
  v_allowance text;
begin
  if p_reason not in ('download', 'storage') then
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
  if v_job.output_attempt_count >= 3 then
    v_allowance := v_job.allowance_state;
    v_status := 'failed';
    if v_job.provider_status = 'SUCCEEDED'
      and v_job.consumed_credits is not null
      and v_job.quota_state = 'reconciled'
    then
      v_status := 'needs_review';
    elsif v_job.allowance_state = 'reserved'
      and v_job.quota_state = 'reconciled'
      and v_job.consumed_credits is not null
    then
      v_allowance := public.vibode_furniture_generation_settle_allowance(
        v_job.user_id, v_job.job_id, v_job.allowance_state, 'release'
      );
    end if;
    update public.vibode_furniture_generation_jobs
    set status = v_status,
      allowance_state = v_allowance,
      error_class = 'ingest_failed',
      error_code = p_reason,
      saved_asset_id = null,
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'status', v_status, 'error_class', 'ingest_failed');
  end if;
  update public.vibode_furniture_generation_jobs
  set error_class = null,
    error_code = p_reason,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'status', 'ingesting');
end;
$fn$;

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
          when 'ingest_failed' then case
            when error_code = 'download' then 'download_failed'
            else error_class
          end
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

revoke all on function public.record_vibode_furniture_generation_output(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.fail_vibode_furniture_generation_output(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.link_vibode_furniture_generation_saved_asset(uuid, uuid, text, text, bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.claim_next_vibode_furniture_generation(boolean) from public, anon, authenticated;
revoke all on function public.reopen_vibode_furniture_generation_succeeded_output(uuid) from public, anon, authenticated;
revoke all on function public.begin_vibode_furniture_generation_output_attempt(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.renew_vibode_furniture_generation_claim(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.defer_vibode_furniture_generation_output(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.record_vibode_furniture_generation_output(uuid, uuid, uuid, bigint, text) to service_role;
grant execute on function public.fail_vibode_furniture_generation_output(uuid, uuid, uuid, text) to service_role;
grant execute on function public.link_vibode_furniture_generation_saved_asset(uuid, uuid, text, text, bigint, text, bigint) to service_role;
grant execute on function public.claim_next_vibode_furniture_generation(boolean) to service_role;
grant execute on function public.reopen_vibode_furniture_generation_succeeded_output(uuid) to service_role;
grant execute on function public.begin_vibode_furniture_generation_output_attempt(uuid, uuid, uuid) to service_role;
grant execute on function public.renew_vibode_furniture_generation_claim(uuid, uuid, uuid) to service_role;
grant execute on function public.defer_vibode_furniture_generation_output(uuid, uuid, uuid, text) to service_role;

comment on function public.reopen_vibode_furniture_generation_succeeded_output(uuid) is
  'Puts a succeeded provider task back into ingesting without a new provider POST. Provider credits, the task id, and the attempt count stay unchanged.';

commit;
