-- MESHY-1D.3A read-only admin dashboard.
--
-- Service-role read functions for the cookie-authenticated admin API.
-- Browser roles keep no table privileges and cannot execute these functions.
-- A null allowance_state stays null: it is a historical job with no tester
-- allowance, and it is not counted as consumed tester usage.
-- Review before applying. Do not apply to hosted Supabase without explicit approval.

begin;

create or replace function public.vibode_furniture_generation_admin_text(
  p_value text,
  p_max integer
) returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v text;
begin
  if p_value is null or p_max is null or p_max < 1 then
    return null;
  end if;
  v := btrim(p_value);
  if v = '' or char_length(v) > p_max then
    return null;
  end if;
  if v ~* '(users/|candidate\.glb|msy_|api\.meshy|://|supabase\.co)' then
    return null;
  end if;
  return v;
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_account_email(
  p_user_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_email text;
begin
  if p_user_id is null then
    return null;
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'email'
  ) then
    return null;
  end if;
  begin
    execute 'select email from auth.users where id = $1'
      into v_email
      using p_user_id;
  exception
    when insufficient_privilege or undefined_column then
      return null;
  end;
  v_email := public.vibode_furniture_generation_admin_text(lower(v_email), 320);
  if v_email is null or position('@' in v_email) = 0 or position(' ' in v_email) > 0 then
    return null;
  end if;
  return v_email;
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_job_record(
  p_job_id uuid,
  p_user_id uuid,
  p_created_at timestamptz,
  p_status text,
  p_operation text,
  p_ai_model text,
  p_settings jsonb,
  p_image_slots text[],
  p_allowance_state text,
  p_reserved_credits integer,
  p_consumed_credits integer,
  p_quota_state text,
  p_error_class text,
  p_provider_status text,
  p_provider_task_confirmed boolean,
  p_provider_contacted boolean,
  p_saved_asset_present boolean
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_status text;
  v_operation text;
  v_model text;
  v_error text;
  v_provider text;
  v_quota text;
  v_allowance text;
  v_saved text;
  v_review text;
  v_slots jsonb := '[]'::jsonb;
  v_poly numeric;
  v_poly_int integer := null;
  v_resolved boolean := false;
  v_unresolved boolean := false;
begin
  v_status := case p_status
    when 'reserved' then 'reserved'
    when 'submitting' then 'submitting'
    when 'ambiguous' then 'ambiguous'
    when 'running' then 'running'
    when 'ingesting' then 'ingesting'
    when 'ready' then 'ready'
    when 'needs_review' then 'needs_review'
    when 'failed' then 'failed'
    when 'saved' then 'saved'
    when 'discarded' then 'discarded'
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    else null
  end;
  v_operation := case p_operation
    when 'image-to-3d' then 'image-to-3d'
    when 'multi-image-to-3d' then 'multi-image-to-3d'
    else null
  end;
  v_model := case p_ai_model when 'meshy-7.1' then 'meshy-7.1' else null end;
  if v_status is null or v_operation is null or v_model is null or p_job_id is null or p_user_id is null then
    return null;
  end if;
  if jsonb_typeof(v_settings) is distinct from 'object' then
    v_settings := '{}'::jsonb;
  end if;
  v_error := public.vibode_furniture_generation_admin_text(p_error_class, 80);
  if v_error is not null and v_error !~ '^[a-z0-9_]+$' then
    v_error := null;
  end if;
  v_provider := case p_provider_status
    when 'PENDING' then 'PENDING'
    when 'IN_PROGRESS' then 'IN_PROGRESS'
    when 'SUCCEEDED' then 'SUCCEEDED'
    when 'FAILED' then 'FAILED'
    when 'CANCELED' then 'CANCELED'
    else null
  end;
  v_quota := case p_quota_state
    when 'reserved' then 'reserved'
    when 'reconciled' then 'reconciled'
    when 'released' then 'released'
    else null
  end;
  v_allowance := case p_allowance_state
    when 'reserved' then 'reserved'
    when 'consumed' then 'consumed'
    when 'released' then 'released'
    else null
  end;
  if p_image_slots is not null and not exists (
    select 1
    from unnest(p_image_slots) as slot(value)
    where slot.value is null
      or slot.value not in ('front', 'left', 'right', 'back')
  ) then
    v_slots := to_jsonb(p_image_slots);
  end if;
  begin
    if jsonb_typeof(v_settings->'targetPolycount') = 'number' then
      v_poly := (v_settings->>'targetPolycount')::numeric;
      if v_poly = trunc(v_poly) and v_poly >= 0 and v_poly <= 1000000 then
        v_poly_int := v_poly::integer;
      end if;
    end if;
  exception
    when numeric_value_out_of_range or invalid_text_representation then
      v_poly_int := null;
  end;
  select exists (
    select 1
    from public.vibode_furniture_generation_credit_resolutions as resolution
    where resolution.job_id = p_job_id
  ) into v_resolved;
  if v_resolved then
    v_review := 'operator_resolved';
  elsif p_consumed_credits is not null then
    v_review := 'reported';
  elsif p_error_class = 'credit_unreported'
    or v_provider in ('SUCCEEDED', 'FAILED', 'CANCELED')
  then
    v_review := 'unreported';
  elsif coalesce(p_provider_task_confirmed, false) or coalesce(p_provider_contacted, false) then
    v_review := 'pending';
  else
    v_review := 'not_contacted';
  end if;
  v_saved := case
    when v_status = 'saved' and coalesce(p_saved_asset_present, false) then 'permanently_saved'
    when v_status = 'ready' then 'candidate_ready'
    else 'not_saved'
  end;
  v_unresolved := v_review = 'unreported'
    or v_status = 'needs_review'
    or v_error in ('credit_unreported', 'submission_budget_exhausted', 'ambiguous_timeout');
  return jsonb_build_object(
    'job_id', p_job_id,
    'user_id', p_user_id,
    'created_at', p_created_at,
    'status', v_status,
    'operation', v_operation,
    'ai_model', v_model,
    'image_slots', v_slots,
    'allowance_state', v_allowance,
    'reserved_credits', p_reserved_credits,
    'consumed_credits', case when p_consumed_credits is null or p_consumed_credits >= 0 then p_consumed_credits else null end,
    'quota_state', v_quota,
    'error_class', v_error,
    'provider_status', v_provider,
    'provider_task_confirmed', coalesce(p_provider_task_confirmed, false),
    'provider_credit_review', v_review,
    'saved_asset_status', v_saved,
    'unresolved', v_unresolved,
    'profile', jsonb_build_object(
      'operation', v_operation,
      'ai_model', v_model,
      'geometry_resolution', public.vibode_furniture_generation_admin_text(v_settings->>'geometryResolution', 40),
      'should_texture', case when jsonb_typeof(v_settings->'shouldTexture') = 'boolean' then (v_settings->>'shouldTexture')::boolean else null end,
      'texture_model', public.vibode_furniture_generation_admin_text(v_settings->>'textureModel', 40),
      'texture_resolution', public.vibode_furniture_generation_admin_text(v_settings->>'textureResolution', 40),
      'enable_pbr', case when jsonb_typeof(v_settings->'enablePbr') = 'boolean' then (v_settings->>'enablePbr')::boolean else null end,
      'image_enhancement', case when jsonb_typeof(v_settings->'imageEnhancement') = 'boolean' then (v_settings->>'imageEnhancement')::boolean else null end,
      'should_remesh', case when jsonb_typeof(v_settings->'shouldRemesh') = 'boolean' then (v_settings->>'shouldRemesh')::boolean else null end,
      'topology', public.vibode_furniture_generation_admin_text(v_settings->>'topology', 40),
      'target_polycount', v_poly_int
    )
  );
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_allowance_events(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_events jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'action', case action
      when 'grant' then 'grant'
      when 'adjust' then 'adjust'
      when 'enable' then 'enable'
      when 'disable' then 'disable'
      when 'restore' then 'restore'
      when 'reserve' then 'reserve'
      when 'release' then 'release'
      when 'consume' then 'consume'
      else null
    end,
    'reason', public.vibode_furniture_generation_admin_text(reason, 200),
    'actor_kind', case actor_kind
      when 'administrator' then 'administrator'
      when 'system' then 'system'
      else null
    end,
    'actor_user_id', actor_user_id,
    'delta_authorized', delta_authorized,
    'delta_reserved', delta_reserved,
    'delta_consumed', delta_consumed,
    'job_id', job_id,
    'created_at', created_at
  ) order by created_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from (
    select *
    from public.vibode_furniture_generation_allowance_events
    where (p_job_id is not null and job_id = p_job_id)
      or (p_job_id is null and p_user_id is not null and user_id = p_user_id)
    order by created_at desc, event_id desc
    limit 50
  ) events;
  return v_events;
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_resubmit_events(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_events jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'action', case action
      when 'authorize' then 'authorize'
      when 'revoke' then 'revoke'
      when 'consume' then 'consume'
      else null
    end,
    'reason', case reason
      when 'operator_recovery' then 'operator_recovery'
      when 'submission_budget_exhausted' then 'submission_budget_exhausted'
      when 'submission_committed' then 'submission_committed'
      else null
    end,
    'job_id', job_id,
    'created_at', created_at
  ) order by created_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from (
    select *
    from public.vibode_furniture_generation_resubmit_events
    where (p_job_id is not null and job_id = p_job_id)
      or (p_job_id is null and p_user_id is not null and user_id = p_user_id)
    order by created_at desc, event_id desc
    limit 50
  ) events;
  return v_events;
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_credit_resolutions(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', job_id,
    'provider_status', case provider_status
      when 'SUCCEEDED' then 'SUCCEEDED'
      when 'FAILED' then 'FAILED'
      when 'CANCELED' then 'CANCELED'
      else null
    end,
    'consumed_credits', consumed_credits,
    'reason', public.vibode_furniture_generation_admin_text(reason, 200),
    'created_at', created_at
  ) order by created_at desc, job_id desc), '[]'::jsonb)
  into v_rows
  from (
    select job_id, provider_status, consumed_credits, reason, created_at
    from public.vibode_furniture_generation_credit_resolutions
    where (p_job_id is not null and job_id = p_job_id)
      or (p_job_id is null and p_user_id is not null and user_id = p_user_id)
    order by created_at desc, job_id desc
    limit 50
  ) resolutions;
  return v_rows;
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_controls public.vibode_furniture_generation_controls%rowtype;
  v_found boolean := false;
  v_approved integer := 0;
  v_enabled integer := 0;
  v_authorized integer := 0;
  v_reserved integer := 0;
  v_consumed integer := 0;
  v_remaining integer := 0;
  v_tasks integer := 0;
  v_ready integer := 0;
  v_saved integer := 0;
  v_failures integer := 0;
  v_exposure integer := 0;
  v_historical_count integer := 0;
  v_historical jsonb := '[]'::jsonb;
  v_deleted_events integer := 0;
  v_deleted jsonb := '[]'::jsonb;
begin
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  v_found := found;

  select
    count(*)::integer,
    (count(*) filter (where enabled))::integer,
    coalesce(sum(authorized_generations), 0)::integer,
    coalesce(sum(reserved_generations), 0)::integer,
    coalesce(sum(consumed_generations), 0)::integer,
    coalesce(sum(authorized_generations - reserved_generations - consumed_generations), 0)::integer
  into v_approved, v_enabled, v_authorized, v_reserved, v_consumed, v_remaining
  from public.vibode_furniture_generation_allowances;

  select
    (count(*) filter (where provider_task_id is not null))::integer,
    (count(*) filter (where status = 'ready'))::integer,
    (count(*) filter (where status = 'saved' and saved_asset_id is not null))::integer,
    (count(*) filter (
      where error_class = 'provider_failed'
        or provider_status in ('FAILED', 'CANCELED')
    ))::integer,
    (coalesce(sum(reserved_credits) filter (
      where consumed_credits is null
        and quota_state = 'reserved'
        and (
          error_class = 'credit_unreported'
          or status in ('ambiguous', 'submitting', 'needs_review')
        )
    ), 0))::integer,
    (count(*) filter (where allowance_state is null))::integer
  into v_tasks, v_ready, v_saved, v_failures, v_exposure, v_historical_count
  from public.vibode_furniture_generation_jobs;

  select coalesce(jsonb_agg(rec order by ord), '[]'::jsonb)
  into v_historical
  from (
    select public.vibode_furniture_generation_admin_job_record(
      j.job_id,
      j.user_id,
      j.created_at,
      j.status,
      j.operation,
      j.ai_model,
      j.settings,
      j.image_slots,
      j.allowance_state,
      j.reserved_credits,
      j.consumed_credits,
      j.quota_state,
      j.error_class,
      j.provider_status,
      j.provider_task_id is not null,
      j.provider_contacted_at is not null,
      j.saved_asset_id is not null
    ) as rec,
    row_number() over (order by j.created_at desc, j.job_id desc) as ord
    from (
      select
        job_id, user_id, created_at, status, operation, ai_model, settings, image_slots,
        allowance_state, reserved_credits, consumed_credits, quota_state, error_class,
        provider_status, provider_task_id, provider_contacted_at, saved_asset_id
      from public.vibode_furniture_generation_jobs
      where allowance_state is null
      order by created_at desc, job_id desc
      limit 20
    ) j
  ) listed;

  with orphan as (
    select event.user_id, 'allowance'::text as kind
    from public.vibode_furniture_generation_allowance_events as event
    where not exists (select 1 from auth.users as account where account.id = event.user_id)
    union all
    select event.user_id, 'resubmit'::text
    from public.vibode_furniture_generation_resubmit_events as event
    where not exists (select 1 from auth.users as account where account.id = event.user_id)
    union all
    select event.user_id, 'credit'::text
    from public.vibode_furniture_generation_credit_resolutions as event
    where not exists (select 1 from auth.users as account where account.id = event.user_id)
  ),
  grouped as (
    select
      user_id,
      (count(*) filter (where kind = 'allowance'))::integer as allowance_events,
      (count(*) filter (where kind = 'resubmit'))::integer as resubmit_events,
      (count(*) filter (where kind = 'credit'))::integer as credit_resolutions
    from orphan
    group by user_id
  )
  select
    coalesce((select count(*)::integer from orphan), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id,
        'allowance_events', allowance_events,
        'resubmit_events', resubmit_events,
        'credit_resolutions', credit_resolutions
      ) order by user_id)
      from (
        select * from grouped
        order by user_id
        limit 20
      ) limited
    ), '[]'::jsonb)
  into v_deleted_events, v_deleted;

  return jsonb_build_object(
    'ok', true,
    'approved_accounts', v_approved,
    'enabled_accounts', v_enabled,
    'authorized_generations', v_authorized,
    'reserved_generations', v_reserved,
    'consumed_generations', v_consumed,
    'remaining_generations', v_remaining,
    'paid_submissions_authorized', case when v_found then v_controls.paid_submissions_authorized else 0 end,
    'paid_submissions_used', case when v_found then v_controls.paid_submissions_used else 0 end,
    'confirmed_provider_tasks', v_tasks,
    'usable_candidates', v_ready,
    'permanently_saved_models', v_saved,
    'provider_failures', v_failures,
    'credits_reserved', case when v_found then v_controls.credits_reserved else 0 end,
    'credits_consumed', case when v_found then v_controls.credits_consumed else 0 end,
    'credit_ceiling', case when v_found then v_controls.credit_ceiling else 0 end,
    'remaining_credit_budget', case
      when v_found then v_controls.credit_ceiling - v_controls.credits_reserved - v_controls.credits_consumed
      else 0
    end,
    'unresolved_provider_credit_exposure', v_exposure,
    'live_enabled', case when v_found then coalesce(v_controls.live_enabled, false) else false end,
    'max_concurrent', case when v_found then v_controls.max_concurrent else 0 end,
    'deleted_account_audit_events', v_deleted_events,
    'deleted_account_audits', v_deleted,
    'historical_jobs_without_allowance', v_historical_count,
    'historical_jobs', v_historical
  );
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_admin_testers(
  p_query text,
  p_limit integer,
  p_offset integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_needle text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if char_length(v_needle) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  return (
    with filtered as (
      select
        allowance.user_id,
        allowance.classification,
        allowance.enabled,
        allowance.authorized_generations,
        allowance.reserved_generations,
        allowance.consumed_generations,
        allowance.updated_at,
        public.vibode_furniture_generation_admin_account_email(allowance.user_id) as email
      from public.vibode_furniture_generation_allowances as allowance
      where v_needle = ''
        or position(v_needle in lower(allowance.user_id::text)) > 0
        or position(
          v_needle in coalesce(public.vibode_furniture_generation_admin_account_email(allowance.user_id), '')
        ) > 0
    )
    select jsonb_build_object(
      'ok', true,
      'total', (select count(*)::integer from filtered),
      'limit', v_limit,
      'offset', v_offset,
      'testers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', user_id,
          'email', email,
          'classification', case classification
            when 'individual_beta' then 'individual_beta'
            when 'furniture_partner' then 'furniture_partner'
            else null
          end,
          'enabled', enabled,
          'authorized_generations', authorized_generations,
          'reserved_generations', reserved_generations,
          'consumed_generations', consumed_generations,
          'remaining_generations', authorized_generations - reserved_generations - consumed_generations,
          'updated_at', updated_at
        ) order by updated_at desc, user_id)
        from (
          select * from filtered
          order by updated_at desc, user_id
          limit v_limit
          offset v_offset
        ) page
      ), '[]'::jsonb)
    )
  );
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_admin_jobs(
  p_user_id uuid,
  p_limit integer,
  p_offset integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer := 0;
  v_jobs jsonb := '[]'::jsonb;
  v_approved boolean := false;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select count(*)::integer
  into v_total
  from public.vibode_furniture_generation_jobs
  where user_id = p_user_id;
  select coalesce(jsonb_agg(rec order by ord), '[]'::jsonb)
  into v_jobs
  from (
    select public.vibode_furniture_generation_admin_job_record(
      j.job_id,
      j.user_id,
      j.created_at,
      j.status,
      j.operation,
      j.ai_model,
      j.settings,
      j.image_slots,
      j.allowance_state,
      j.reserved_credits,
      j.consumed_credits,
      j.quota_state,
      j.error_class,
      j.provider_status,
      j.provider_task_id is not null,
      j.provider_contacted_at is not null,
      j.saved_asset_id is not null
    ) as rec,
    row_number() over (order by j.created_at desc, j.job_id desc) as ord
    from (
      select
        job_id, user_id, created_at, status, operation, ai_model, settings, image_slots,
        allowance_state, reserved_credits, consumed_credits, quota_state, error_class,
        provider_status, provider_task_id, provider_contacted_at, saved_asset_id
      from public.vibode_furniture_generation_jobs
      where user_id = p_user_id
      order by created_at desc, job_id desc
      limit v_limit
      offset v_offset
    ) j
  ) listed;
  select exists (
    select 1
    from public.vibode_furniture_generation_allowances
    where user_id = p_user_id
  ) into v_approved;
  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'email', public.vibode_furniture_generation_admin_account_email(p_user_id),
    'approved', v_approved,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'jobs', v_jobs,
    'allowance_events', public.vibode_furniture_generation_admin_allowance_events(p_user_id, null),
    'resubmit_events', public.vibode_furniture_generation_admin_resubmit_events(p_user_id, null),
    'credit_resolutions', public.vibode_furniture_generation_admin_credit_resolutions(p_user_id, null)
  );
end;
$fn$;

create or replace function public.read_vibode_furniture_generation_admin_job(
  p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_record jsonb;
  v_allowance jsonb;
  v_resubmit jsonb;
  v_credits jsonb;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select public.vibode_furniture_generation_admin_job_record(
    j.job_id,
    j.user_id,
    j.created_at,
    j.status,
    j.operation,
    j.ai_model,
    j.settings,
    j.image_slots,
    j.allowance_state,
    j.reserved_credits,
    j.consumed_credits,
    j.quota_state,
    j.error_class,
    j.provider_status,
    j.provider_task_id is not null,
    j.provider_contacted_at is not null,
    j.saved_asset_id is not null
  )
  into v_record
  from public.vibode_furniture_generation_jobs as j
  where j.job_id = p_job_id;
  v_allowance := public.vibode_furniture_generation_admin_allowance_events(null, p_job_id);
  v_resubmit := public.vibode_furniture_generation_admin_resubmit_events(null, p_job_id);
  v_credits := public.vibode_furniture_generation_admin_credit_resolutions(null, p_job_id);
  if v_record is null
    and v_allowance = '[]'::jsonb
    and v_resubmit = '[]'::jsonb
    and v_credits = '[]'::jsonb
  then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'job', v_record,
    'allowance_events', v_allowance,
    'resubmit_events', v_resubmit,
    'credit_resolution', case
      when jsonb_array_length(v_credits) = 0 then null::jsonb
      else v_credits->0
    end
  );
end;
$fn$;

comment on function public.read_vibode_furniture_generation_admin_overview() is
  'Read-only global beta access, usage, credit, and production-control snapshot for the admin dashboard.';

comment on function public.read_vibode_furniture_generation_admin_testers(text, integer, integer) is
  'Read-only page of allowance rows. No allowance row is created. Email is included only when auth.users.email can be read.';

comment on function public.read_vibode_furniture_generation_admin_jobs(uuid, integer, integer) is
  'Read-only bounded generation history and retained audit events for one account.';

comment on function public.read_vibode_furniture_generation_admin_job(uuid) is
  'Read-only generation detail. Storage paths, provider task identifiers, and resolution evidence are omitted.';

do $rev$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc as p
    where p.pronamespace = 'public'::regnamespace
      and (
        p.proname like 'read_vibode_furniture_generation_admin_%'
        or p.proname like 'vibode_furniture_generation_admin_%'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      r.signature
    );
  end loop;
end;
$rev$;

grant execute on function public.read_vibode_furniture_generation_admin_overview() to service_role;
grant execute on function public.read_vibode_furniture_generation_admin_testers(text, integer, integer) to service_role;
grant execute on function public.read_vibode_furniture_generation_admin_jobs(uuid, integer, integer) to service_role;
grant execute on function public.read_vibode_furniture_generation_admin_job(uuid) to service_role;

commit;
