-- MESHY-1C.1 provisional generation ledger.
--
-- Table names are provisional. This is not a second furniture library.
-- vibode_furniture_assets stays the immutable personal GLB record, and
-- nothing here inserts into it. saved_asset_id stays null until a later
-- explicit save.
--
-- Browser roles have no privileges. service_role cannot write the tables
-- directly. Security-definer functions perform reservation, claim, and
-- reconciliation after the application has checked the signed-in owner.
-- The global live switch defaults off. The credit ceiling is the test budget.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.

begin;

create table public.vibode_furniture_generation_controls (
  control_id text primary key,
  live_enabled boolean not null default false,
  max_concurrent integer not null default 1,
  credit_ceiling integer not null default 40,
  credits_reserved integer not null default 0,
  credits_consumed integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint vibode_furniture_generation_controls_id
    check (control_id = 'global'),
  constraint vibode_furniture_generation_controls_concurrent
    check (max_concurrent = 1),
  constraint vibode_furniture_generation_controls_ceiling
    check (credit_ceiling >= 0 and credit_ceiling <= 40),
  constraint vibode_furniture_generation_controls_balances
    check (credits_reserved >= 0 and credits_consumed >= 0)
);

insert into public.vibode_furniture_generation_controls (control_id)
values ('global');

create table public.vibode_furniture_generation_jobs (
  job_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'meshy',
  ai_model text not null,
  operation text not null,
  idempotency_key text not null,
  request_sha256 text not null,
  settings jsonb not null,
  image_slots text[] not null,
  provider_task_name text not null,
  provider_task_id text null,
  provider_status text null,
  status text not null,
  progress integer not null default 0,
  claim_nonce uuid null,
  claim_expires_at timestamptz null,
  attempt_count integer not null default 0,
  provider_contacted_at timestamptz null,
  absence_reconciled_at timestamptz null,
  resubmit_authorized_at timestamptz null,
  quota_state text not null,
  reserved_credits integer not null,
  consumed_credits integer null,
  output_bucket text null,
  output_object_path text null,
  output_sha256 text null,
  output_byte_size bigint null,
  output_expires_at timestamptz null,
  error_class text null,
  error_code text null,
  saved_asset_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_furniture_generation_jobs_provider
    check (provider = 'meshy'),
  constraint vibode_furniture_generation_jobs_model
    check (ai_model = 'meshy-7.1'),
  constraint vibode_furniture_generation_jobs_operation
    check (operation in ('image-to-3d', 'multi-image-to-3d')),
  constraint vibode_furniture_generation_jobs_key
    check (idempotency_key ~ '^[a-z0-9-]{8,80}$'),
  constraint vibode_furniture_generation_jobs_sha
    check (request_sha256 ~ '^[a-f0-9]{64}$'),
  constraint vibode_furniture_generation_jobs_task_name
    check (provider_task_name = 'vibode-' || job_id::text),
  constraint vibode_furniture_generation_jobs_task_id
    check (provider_task_id is null or provider_task_id ~ '^[A-Za-z0-9-]{8,80}$'),
  constraint vibode_furniture_generation_jobs_provider_status
    check (
      provider_status is null
      or provider_status in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED')
    ),
  constraint vibode_furniture_generation_jobs_status
    check (status in (
      'reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'ready', 'needs_review',
      'failed', 'saved', 'discarded', 'expired', 'cancelled'
    )),
  constraint vibode_furniture_generation_jobs_progress
    check (progress >= 0 and progress <= 100),
  constraint vibode_furniture_generation_jobs_attempts
    check (attempt_count >= 0 and attempt_count <= 2),
  constraint vibode_furniture_generation_jobs_quota
    check (quota_state in ('reserved', 'reconciled', 'released')),
  constraint vibode_furniture_generation_jobs_reserved_credits
    check (reserved_credits >= 20 and reserved_credits <= 40),
  constraint vibode_furniture_generation_jobs_consumed
    check (consumed_credits is null or consumed_credits >= 0),
  constraint vibode_furniture_generation_jobs_output_bucket
    check (output_bucket is null or output_bucket = 'vibode-furniture-assets'),
  constraint vibode_furniture_generation_jobs_output_path
    check (
      output_object_path is null
      or (
        output_object_path = 'users/' || user_id::text || '/generations/' || job_id::text || '/candidate.glb'
        and position('..' in output_object_path) = 0
      )
    ),
  constraint vibode_furniture_generation_jobs_output_size
    check (output_byte_size is null or (output_byte_size > 0 and output_byte_size <= 26214400)),
  constraint vibode_furniture_generation_jobs_ready
    check (status <> 'ready' or output_object_path is not null),
  constraint vibode_furniture_generation_jobs_saved
    check (status <> 'saved' or saved_asset_id is not null),
  constraint vibode_furniture_generation_jobs_saved_id
    check (
      saved_asset_id is null
      or saved_asset_id ~ '^vibode-furniture/personal/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
);

create unique index vibode_furniture_generation_jobs_user_key_uidx
  on public.vibode_furniture_generation_jobs (user_id, idempotency_key);

create unique index vibode_furniture_generation_jobs_task_name_uidx
  on public.vibode_furniture_generation_jobs (provider_task_name);

create unique index vibode_furniture_generation_jobs_provider_task_uidx
  on public.vibode_furniture_generation_jobs (provider, provider_task_id)
  where provider_task_id is not null;

create unique index vibode_furniture_generation_jobs_one_active_uidx
  on public.vibode_furniture_generation_jobs ((1))
  where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'ready', 'needs_review');

create table public.vibode_furniture_generation_inputs (
  job_id uuid not null references public.vibode_furniture_generation_jobs(job_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,
  ordinal integer not null,
  storage_bucket text not null,
  storage_object_path text not null,
  sha256 text not null,
  byte_size bigint not null,
  mime_type text not null,
  width_px integer not null,
  height_px integer not null,
  expires_at timestamptz not null,
  purged_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, slot),
  constraint vibode_furniture_generation_inputs_slot
    check (slot in ('front', 'left', 'right', 'back')),
  constraint vibode_furniture_generation_inputs_ordinal
    check (ordinal >= 0 and ordinal <= 3),
  constraint vibode_furniture_generation_inputs_bucket
    check (storage_bucket = 'vibode-furniture-generation-inputs'),
  constraint vibode_furniture_generation_inputs_mime
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint vibode_furniture_generation_inputs_sha
    check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint vibode_furniture_generation_inputs_bytes
    check (byte_size > 0 and byte_size <= 20971520),
  constraint vibode_furniture_generation_inputs_edges
    check (width_px >= 32 and height_px >= 32),
  constraint vibode_furniture_generation_inputs_pixels
    check (width_px::bigint * height_px::bigint <= 178956970),
  constraint vibode_furniture_generation_inputs_path
    check (
      storage_object_path = 'users/' || user_id::text || '/inputs/' || job_id::text || '/' || slot || '.'
        || case mime_type
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          when 'image/webp' then 'webp'
        end
      and position('..' in storage_object_path) = 0
    )
);

create trigger set_timestamp_vibode_furniture_generation_controls
before update on public.vibode_furniture_generation_controls
for each row execute function public.set_timestamp();

create trigger set_timestamp_vibode_furniture_generation_jobs
before update on public.vibode_furniture_generation_jobs
for each row execute function public.set_timestamp();

create trigger set_timestamp_vibode_furniture_generation_inputs
before update on public.vibode_furniture_generation_inputs
for each row execute function public.set_timestamp();

create or replace function public.vibode_furniture_generation_protect_controls()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if new.control_id is distinct from old.control_id
    or new.max_concurrent is distinct from old.max_concurrent
    or new.credit_ceiling is distinct from old.credit_ceiling
  then
    raise exception 'VIBODE_FURNITURE_GENERATION:CONTROLS_LOCKED';
  end if;
  return new;
end;
$fn$;

create trigger vibode_furniture_generation_protect_controls
before update on public.vibode_furniture_generation_controls
for each row execute function public.vibode_furniture_generation_protect_controls();

create or replace function public.vibode_furniture_generation_protect_job()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if new.job_id is distinct from old.job_id
    or new.user_id is distinct from old.user_id
    or new.provider is distinct from old.provider
    or new.ai_model is distinct from old.ai_model
    or new.operation is distinct from old.operation
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_sha256 is distinct from old.request_sha256
    or new.settings is distinct from old.settings
    or new.image_slots is distinct from old.image_slots
    or new.provider_task_name is distinct from old.provider_task_name
    or new.reserved_credits is distinct from old.reserved_credits
    or new.created_at is distinct from old.created_at
  then
    raise exception 'VIBODE_FURNITURE_GENERATION:IMMUTABLE';
  end if;
  if old.provider_task_id is not null and new.provider_task_id is distinct from old.provider_task_id then
    raise exception 'VIBODE_FURNITURE_GENERATION:TASK_IMMUTABLE';
  end if;
  if old.saved_asset_id is not null and new.saved_asset_id is distinct from old.saved_asset_id then
    raise exception 'VIBODE_FURNITURE_GENERATION:ASSET_IMMUTABLE';
  end if;
  if new.status = 'saved' and new.saved_asset_id is null then
    raise exception 'VIBODE_FURNITURE_GENERATION:SAVE_REQUIRES_ASSET';
  end if;
  return new;
end;
$fn$;

create trigger vibode_furniture_generation_protect_job
before update on public.vibode_furniture_generation_jobs
for each row execute function public.vibode_furniture_generation_protect_job();

create or replace function public.vibode_furniture_generation_input_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_owner uuid;
begin
  select user_id into v_owner
  from public.vibode_furniture_generation_jobs
  where job_id = new.job_id;
  if v_owner is null or v_owner is distinct from new.user_id then
    raise exception 'VIBODE_FURNITURE_GENERATION:INPUT_OWNER';
  end if;
  return new;
end;
$fn$;

create trigger vibode_furniture_generation_input_owner
before insert or update on public.vibode_furniture_generation_inputs
for each row execute function public.vibode_furniture_generation_input_owner();

create or replace function public.vibode_furniture_generation_slots_ok(
  p_operation text,
  p_slots text[]
) returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_slot text;
  v_previous integer := 0;
  v_index integer;
  v_canon text[] := array['front', 'left', 'right', 'back'];
begin
  if p_slots is null or cardinality(p_slots) < 1 or p_slots[1] is distinct from 'front' then
    return false;
  end if;
  foreach v_slot in array p_slots loop
    v_index := array_position(v_canon, v_slot);
    if v_index is null or v_index <= v_previous then
      return false;
    end if;
    v_previous := v_index;
  end loop;
  if p_operation = 'image-to-3d' then
    return cardinality(p_slots) = 1;
  end if;
  return p_operation = 'multi-image-to-3d' and cardinality(p_slots) between 2 and 4;
end;
$fn$;

create or replace function public.vibode_furniture_generation_settings_issue(
  p_operation text,
  p_settings jsonb
) returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_texture boolean;
  v_model text;
  v_resolution text;
  v_geometry text;
  v_pbr boolean;
  v_remesh boolean;
  v_topology text;
  v_poly numeric;
  v_prompt text;
  v_effective text;
begin
  if p_operation not in ('image-to-3d', 'multi-image-to-3d') then
    return 'unsupported_settings';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text) > 4000 then
    return 'unsupported_settings';
  end if;
  if p_settings::text like '%data:image%' then
    return 'unsupported_settings';
  end if;
  if jsonb_typeof(p_settings->'shouldTexture') is distinct from 'boolean'
    or jsonb_typeof(p_settings->'enablePbr') is distinct from 'boolean'
    or jsonb_typeof(p_settings->'shouldRemesh') is distinct from 'boolean'
    or jsonb_typeof(p_settings->'imageEnhancement') is distinct from 'boolean'
    or jsonb_typeof(p_settings->'targetPolycount') is distinct from 'number'
  then
    return 'unsupported_settings';
  end if;
  v_geometry := p_settings->>'geometryResolution';
  v_model := p_settings->>'textureModel';
  v_resolution := p_settings->>'textureResolution';
  v_topology := p_settings->>'topology';
  v_texture := (p_settings->>'shouldTexture')::boolean;
  v_pbr := (p_settings->>'enablePbr')::boolean;
  v_remesh := (p_settings->>'shouldRemesh')::boolean;
  v_prompt := coalesce(p_settings->>'texturePrompt', '');
  if v_geometry not in ('standard', '2k', '4k')
    or v_model not in ('default', 'meshy-7', 'meshy-n1', 'meshy-6-lite')
    or v_resolution not in ('2k', '4k', '8k')
    or v_topology not in ('triangle', 'quad')
  then
    return 'unsupported_settings';
  end if;
  if p_operation = 'multi-image-to-3d' and v_geometry = '4k' then
    return 'unsupported_settings';
  end if;
  if p_operation = 'multi-image-to-3d' and v_texture and v_model = 'meshy-6-lite' then
    return 'unsupported_settings';
  end if;
  v_effective := case when v_model in ('meshy-n1', 'meshy-6-lite') then v_model else 'meshy-7' end;
  if v_texture and v_effective <> 'meshy-7' and v_resolution <> '2k' then
    return 'unsupported_settings';
  end if;
  if v_pbr and not v_texture then
    return 'unsupported_settings';
  end if;
  if v_pbr and v_texture and v_effective = 'meshy-n1' then
    return 'unsupported_settings';
  end if;
  if v_remesh and v_topology = 'quad' and v_effective = 'meshy-n1' then
    return 'unsupported_settings';
  end if;
  if v_remesh then
    v_poly := (p_settings->>'targetPolycount')::numeric;
    if v_poly is null or v_poly <> trunc(v_poly) or v_poly < 100 or v_poly > 300000 then
      return 'unsupported_settings';
    end if;
  end if;
  if v_texture and v_effective <> 'meshy-n1' and char_length(btrim(v_prompt)) > 800 then
    return 'unsupported_settings';
  end if;
  return null;
end;
$fn$;

create or replace function public.vibode_furniture_generation_credit_estimate(
  p_operation text,
  p_settings jsonb
) returns integer
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_texture boolean;
  v_resolution text;
  v_geometry text;
  v_credits integer;
begin
  if public.vibode_furniture_generation_settings_issue(p_operation, p_settings) is not null then
    return null;
  end if;
  v_texture := (p_settings->>'shouldTexture')::boolean;
  v_resolution := p_settings->>'textureResolution';
  v_geometry := p_settings->>'geometryResolution';
  if v_texture then
    if v_resolution = '8k' then
      v_credits := 35;
    elsif v_resolution in ('2k', '4k') then
      v_credits := 30;
    else
      return null;
    end if;
  else
    v_credits := 20;
  end if;
  if v_geometry in ('2k', '4k') then
    v_credits := v_credits + 5;
  end if;
  if v_credits > 40 then
    return null;
  end if;
  return v_credits;
end;
$fn$;

create or replace function public.vibode_furniture_generation_release_stale()
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
begin
  update public.vibode_furniture_generation_jobs
  set status = 'expired',
    error_class = 'expired',
    error_code = 'expired',
    claim_nonce = null,
    claim_expires_at = null
  where status = 'ready'
    and saved_asset_id is null
    and output_expires_at is not null
    and output_expires_at <= now();

  for v_job in
    select *
    from public.vibode_furniture_generation_jobs
    where status = 'reserved'
      and provider_contacted_at is null
      and provider_task_id is null
      and saved_asset_id is null
      and created_at <= now() - interval '24 hours'
    for update
  loop
    if v_job.quota_state = 'reserved' then
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - v_job.reserved_credits
      where control_id = 'global';
    end if;
    update public.vibode_furniture_generation_jobs
    set status = 'cancelled',
      quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
      consumed_credits = coalesce(consumed_credits, 0),
      error_class = 'cancelled',
      error_code = 'cancelled',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
  end loop;
end;
$fn$;

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
  v_credits integer;
begin
  if p_user_id is null or p_job_id is null
    or p_idempotency_key is null or p_idempotency_key !~ '^[a-z0-9-]{8,80}$'
    or p_request_sha256 is null or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or not exists (select 1 from auth.users where id = p_user_id)
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);

  select * into v_existing
  from public.vibode_furniture_generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
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

  if p_ai_model is distinct from 'meshy-7.1'
    or not public.vibode_furniture_generation_slots_ok(p_operation, p_image_slots)
  then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;
  v_credits := public.vibode_furniture_generation_credit_estimate(p_operation, p_settings);
  if v_credits is null or v_credits is distinct from p_reserved_credits then
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
    settings, image_slots, provider_task_name, status, quota_state, reserved_credits
  ) values (
    p_job_id, p_user_id, 'meshy', 'meshy-7.1', p_operation, p_idempotency_key, p_request_sha256,
    p_settings, p_image_slots, 'vibode-' || p_job_id::text, 'reserved', 'reserved', v_credits
  );
  update public.vibode_furniture_generation_controls
  set credits_reserved = credits_reserved + v_credits
  where control_id = 'global';
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
    'provider_task_id', v_job.provider_task_id,
    'provider_status', v_job.provider_status,
    'progress', v_job.progress,
    'quota_state', v_job.quota_state,
    'reserved_credits', v_job.reserved_credits,
    'consumed_credits', v_job.consumed_credits,
    'error_class', v_job.error_class,
    'saved_asset_id', v_job.saved_asset_id,
    'output_object_path', v_job.output_object_path
  );
end;
$fn$;

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
  if v_job.attempt_count >= 2 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.attempt_count > 0 and v_job.resubmit_authorized_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
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
  return jsonb_build_object('ok', true, 'purpose', 'submit', 'job_id', v_job.job_id, 'claim_nonce', v_nonce, 'status', 'submitting');
end;
$fn$;

create or replace function public.mark_vibode_furniture_generation_ambiguous(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_error_code text
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
  if v_job.status <> 'submitting' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'ambiguous',
    error_class = 'ambiguous_timeout',
    error_code = left(coalesce(p_error_code, 'create_timeout'), 80),
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ambiguous');
end;
$fn$;

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
begin
  if p_provider_task_id !~ '^[A-Za-z0-9-]{8,80}$'
    or p_provider_status not in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED')
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
  if v_job.claim_nonce is distinct from p_claim_nonce or v_job.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'lease_held');
  end if;
  if v_job.status not in ('submitting', 'ambiguous', 'needs_review') then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.provider_task_id is not null and v_job.provider_task_id is distinct from p_provider_task_id then
    return jsonb_build_object('ok', false, 'code', 'task_immutable');
  end if;
  update public.vibode_furniture_generation_jobs
  set provider_task_id = p_provider_task_id,
    provider_status = p_provider_status,
    status = 'running',
    error_class = case when error_class in ('ambiguous_timeout', 'needs_review') then null else error_class end,
    resubmit_authorized_at = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running', 'provider_task_id', p_provider_task_id);
end;
$fn$;

create or replace function public.mark_vibode_furniture_generation_needs_review(
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
  v_wait interval;
begin
  if p_reason not in ('list_absent', 'list_incomplete') then
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
  if v_job.status = 'needs_review' and v_job.provider_task_id is null then
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'needs_review', 'provider_credits_refunded', false);
  end if;
  if v_job.status <> 'ambiguous' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  v_wait := case when p_reason = 'list_incomplete' then interval '60 minutes' else interval '60 seconds' end;
  if v_job.provider_contacted_at is null or v_job.provider_contacted_at > now() - v_wait then
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', false, 'code', 'needs_reconciliation');
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'needs_review',
    error_class = 'needs_review',
    error_code = p_reason,
    resubmit_authorized_at = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'needs_review', 'provider_credits_refunded', false);
end;
$fn$;

create or replace function public.fail_vibode_furniture_generation_create(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_error_class text,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
begin
  if p_error_class not in ('provider_rejected', 'provider_payment', 'provider_auth', 'provider_forbidden') then
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
  if v_job.status <> 'submitting' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits
    where control_id = 'global';
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
    consumed_credits = coalesce(consumed_credits, 0),
    error_class = p_error_class,
    error_code = left(coalesce(p_error_code, p_error_class), 80),
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
end;
$fn$;

create or replace function public.apply_vibode_furniture_generation_observation(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid,
  p_provider_status text,
  p_progress integer,
  p_consumed_credits integer,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_consumed integer;
begin
  if p_provider_status not in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED')
    or p_progress is null or p_progress < 0 or p_progress > 100
    or (p_consumed_credits is not null and p_consumed_credits < 0)
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
  if v_job.claim_nonce is distinct from p_claim_nonce or v_job.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'lease_held');
  end if;
  if v_job.provider_task_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.status in ('ready', 'saved', 'failed', 'discarded', 'expired', 'cancelled', 'needs_review') then
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_job.status);
  end if;
  if v_job.status = 'ingesting' then
    if p_provider_status <> 'SUCCEEDED' then
      return jsonb_build_object('ok', false, 'code', 'not_claimable');
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting');
  end if;
  if v_job.status <> 'running' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if p_provider_status in ('PENDING', 'IN_PROGRESS') then
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = 'running',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running');
  end if;
  if p_provider_status in ('FAILED', 'CANCELED') then
    v_consumed := coalesce(p_consumed_credits, 0);
    if v_job.quota_state = 'reserved' then
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - v_job.reserved_credits,
        credits_consumed = credits_consumed + case when v_consumed > 0 then v_consumed else 0 end
      where control_id = 'global';
    end if;
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      status = 'failed',
      quota_state = case
        when quota_state <> 'reserved' then quota_state
        when v_consumed > 0 then 'reconciled'
        else 'released'
      end,
      consumed_credits = case when quota_state = 'reserved' then v_consumed else consumed_credits end,
      error_class = 'provider_failed',
      error_code = left(coalesce(p_error_code, p_provider_status), 80),
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
  end if;
  if p_consumed_credits is null then
    update public.vibode_furniture_generation_jobs
    set provider_status = p_provider_status,
      progress = p_progress,
      error_class = 'credit_unreported',
      status = 'running',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'running', 'error_class', 'credit_unreported');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits,
      credits_consumed = credits_consumed + p_consumed_credits
    where control_id = 'global';
  end if;
  update public.vibode_furniture_generation_jobs
  set provider_status = 'SUCCEEDED',
    progress = p_progress,
    status = 'ingesting',
    quota_state = case when quota_state = 'reserved' then 'reconciled' else quota_state end,
    consumed_credits = case when quota_state = 'reserved' then p_consumed_credits else consumed_credits end,
    error_class = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ingesting', 'claim_nonce', v_job.claim_nonce);
end;
$fn$;

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
begin
  if p_sha256 !~ '^[a-f0-9]{64}$' or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 26214400 then
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
  v_path := 'users/' || v_job.user_id::text || '/generations/' || v_job.job_id::text || '/candidate.glb';
  update public.vibode_furniture_generation_jobs
  set output_bucket = 'vibode-furniture-assets',
    output_object_path = v_path,
    output_sha256 = p_sha256,
    output_byte_size = p_byte_size,
    output_expires_at = now() + interval '7 days',
    status = 'ready',
    saved_asset_id = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'ready', 'output_object_path', v_path, 'saved_asset_id', null);
end;
$fn$;

create or replace function public.attach_vibode_furniture_generation_input(
  p_user_id uuid,
  p_job_id uuid,
  p_slot text,
  p_mime_type text,
  p_byte_size bigint,
  p_width_px integer,
  p_height_px integer,
  p_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_ordinal integer;
begin
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520
    or p_width_px is null or p_height_px is null
    or p_width_px < 32 or p_height_px < 32
    or p_width_px::bigint * p_height_px::bigint > 178956970
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found or v_job.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_ordinal := array_position(v_job.image_slots, p_slot);
  if v_ordinal is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  insert into public.vibode_furniture_generation_inputs (
    job_id, user_id, slot, ordinal, storage_bucket, storage_object_path,
    sha256, byte_size, mime_type, width_px, height_px, expires_at
  ) values (
    p_job_id,
    p_user_id,
    p_slot,
    v_ordinal - 1,
    'vibode-furniture-generation-inputs',
    'users/' || p_user_id::text || '/inputs/' || p_job_id::text || '/' || p_slot || '.'
      || case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end,
    p_sha256,
    p_byte_size,
    p_mime_type,
    p_width_px,
    p_height_px,
    now() + interval '24 hours'
  )
  on conflict (job_id, slot) do update
  set sha256 = excluded.sha256,
    byte_size = excluded.byte_size,
    mime_type = excluded.mime_type,
    width_px = excluded.width_px,
    height_px = excluded.height_px,
    storage_object_path = excluded.storage_object_path,
    expires_at = excluded.expires_at,
    purged_at = null;
  return jsonb_build_object('ok', true, 'job_id', p_job_id, 'slot', p_slot);
end;
$fn$;

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
  if v_job.status <> 'reserved' or v_job.provider_contacted_at is not null or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits
    where control_id = 'global';
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    quota_state = 'released',
    consumed_credits = 0,
    error_class = 'input_storage_failed',
    error_code = 'input_storage_failed'
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed');
end;
$fn$;

alter table public.vibode_furniture_generation_controls enable row level security;
alter table public.vibode_furniture_generation_jobs enable row level security;
alter table public.vibode_furniture_generation_inputs enable row level security;

create or replace function public.drop_vibode_furniture_generation_claim(
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
  update public.vibode_furniture_generation_jobs
  set claim_nonce = null, claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', v_job.status);
end;
$fn$;

create or replace function public.settle_vibode_furniture_generation_rate_limit(
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
  if v_job.status <> 'submitting' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set attempt_count = greatest(0, attempt_count - 1),
    resubmit_authorized_at = case when attempt_count > 1 then now() else null end,
    provider_contacted_at = null,
    status = 'reserved',
    error_class = null,
    error_code = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'reserved');
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
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    error_class = p_error_class,
    error_code = left(p_error_class, 80),
    saved_asset_id = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'failed', 'error_class', p_error_class);
end;
$fn$;

create or replace function public.authorize_vibode_furniture_generation_resubmit(
  p_user_id uuid,
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
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.status <> 'needs_review' or v_job.provider_task_id is not null or v_job.saved_asset_id is not null or v_job.attempt_count >= 2 then
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
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'reserved', 'duplicate_charge_risk', true);
end;
$fn$;

create or replace function public.discard_vibode_furniture_generation_candidate(
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
  if v_job.saved_asset_id is not null or v_job.status = 'saved' then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.status = 'ready' then
    update public.vibode_furniture_generation_jobs
    set status = 'discarded',
      error_class = 'discarded',
      error_code = 'discarded',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'discarded', 'provider_credits_refunded', false);
  end if;
  if v_job.status = 'reserved' and v_job.provider_contacted_at is null and v_job.provider_task_id is null then
    if v_job.quota_state = 'reserved' then
      update public.vibode_furniture_generation_controls
      set credits_reserved = credits_reserved - v_job.reserved_credits
      where control_id = 'global';
    end if;
    update public.vibode_furniture_generation_jobs
    set status = 'cancelled',
      quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
      consumed_credits = coalesce(consumed_credits, 0),
      error_class = 'cancelled',
      error_code = 'cancelled',
      claim_nonce = null,
      claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'cancelled', 'provider_credits_refunded', false);
  end if;
  return jsonb_build_object('ok', false, 'code', 'not_claimable');
end;
$fn$;

create or replace function public.expire_vibode_furniture_generation_candidate(
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
  if v_job.saved_asset_id is not null
    or v_job.status <> 'ready'
    or v_job.output_expires_at is null
    or v_job.output_expires_at > now()
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'expired',
    error_class = 'expired',
    error_code = 'expired',
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object('ok', true, 'job_id', v_job.job_id, 'status', 'expired', 'provider_credits_refunded', false);
end;
$fn$;

revoke all on table public.vibode_furniture_generation_controls from public, anon, authenticated, service_role;
revoke all on table public.vibode_furniture_generation_jobs from public, anon, authenticated, service_role;
revoke all on table public.vibode_furniture_generation_inputs from public, anon, authenticated, service_role;

revoke all on function public.vibode_furniture_generation_protect_controls() from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_protect_job() from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_input_owner() from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_slots_ok(text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_settings_issue(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_credit_estimate(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_release_stale() from public, anon, authenticated, service_role;

revoke all on function public.reserve_vibode_furniture_generation(uuid, uuid, text, text, text, text, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.read_vibode_furniture_generation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_vibode_furniture_generation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_vibode_furniture_generation_ambiguous(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bind_vibode_furniture_generation_task(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_vibode_furniture_generation_needs_review(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_vibode_furniture_generation_create(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.apply_vibode_furniture_generation_observation(uuid, uuid, uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.record_vibode_furniture_generation_output(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.attach_vibode_furniture_generation_input(uuid, uuid, text, text, bigint, integer, integer, text) from public, anon, authenticated;
revoke all on function public.fail_vibode_furniture_generation_before_provider(uuid, uuid) from public, anon, authenticated;
revoke all on function public.drop_vibode_furniture_generation_claim(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_vibode_furniture_generation_rate_limit(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_vibode_furniture_generation_output(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.authorize_vibode_furniture_generation_resubmit(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.discard_vibode_furniture_generation_candidate(uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_vibode_furniture_generation_candidate(uuid, uuid) from public, anon, authenticated;

grant execute on function public.reserve_vibode_furniture_generation(uuid, uuid, text, text, text, text, jsonb, text[], integer) to service_role;
grant execute on function public.read_vibode_furniture_generation(uuid, uuid) to service_role;
grant execute on function public.claim_vibode_furniture_generation(uuid, uuid, text) to service_role;
grant execute on function public.mark_vibode_furniture_generation_ambiguous(uuid, uuid, uuid, text) to service_role;
grant execute on function public.bind_vibode_furniture_generation_task(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.mark_vibode_furniture_generation_needs_review(uuid, uuid, uuid, text) to service_role;
grant execute on function public.fail_vibode_furniture_generation_create(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.apply_vibode_furniture_generation_observation(uuid, uuid, uuid, text, integer, integer, text) to service_role;
grant execute on function public.record_vibode_furniture_generation_output(uuid, uuid, uuid, bigint, text) to service_role;
grant execute on function public.attach_vibode_furniture_generation_input(uuid, uuid, text, text, bigint, integer, integer, text) to service_role;
grant execute on function public.fail_vibode_furniture_generation_before_provider(uuid, uuid) to service_role;
grant execute on function public.drop_vibode_furniture_generation_claim(uuid, uuid, uuid) to service_role;
grant execute on function public.settle_vibode_furniture_generation_rate_limit(uuid, uuid, uuid) to service_role;
grant execute on function public.fail_vibode_furniture_generation_output(uuid, uuid, uuid, text) to service_role;
grant execute on function public.authorize_vibode_furniture_generation_resubmit(uuid, uuid, boolean) to service_role;
grant execute on function public.discard_vibode_furniture_generation_candidate(uuid, uuid) to service_role;
grant execute on function public.expire_vibode_furniture_generation_candidate(uuid, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-furniture-generation-inputs',
  'vibode-furniture-generation-inputs',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
);

drop policy if exists vibode_furniture_generation_input_deny_anon on storage.objects;
drop policy if exists vibode_furniture_generation_input_deny_authenticated on storage.objects;

create policy vibode_furniture_generation_input_deny_anon
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'vibode-furniture-generation-inputs')
with check (bucket_id <> 'vibode-furniture-generation-inputs');

create policy vibode_furniture_generation_input_deny_authenticated
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'vibode-furniture-generation-inputs')
with check (bucket_id <> 'vibode-furniture-generation-inputs');

comment on table public.vibode_furniture_generation_jobs is
  'Provisional account-owned Meshy generation jobs. service_role reaches them only through security-definer functions. Not a personal asset library.';

commit;
