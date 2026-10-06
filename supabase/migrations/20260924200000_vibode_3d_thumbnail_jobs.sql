-- THUMB-2D: durable 3D thumbnail jobs and published pointers.
--
-- One job row per room version. A running claim keeps claim_content_token
-- while content_token moves to a newer scene. Publish succeeds only when
-- those tokens still match the locked scene identity.
--
-- vibode_room_assets.thumbnail_storage_* remains the 2D History thumbnail.
-- This migration does not read or write those columns.
--
-- Quiet window (4s) and claim lease (180s) are applied by the app.
-- Retry backoff encoded below: 15s, 60s, then terminal. 180s is reserved.

begin;

create table public.vibode_3d_thumbnail_jobs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  version_id uuid not null,
  afc_generation_id uuid not null,
  content_token text not null,
  status text not null default 'pending',
  desired_outcome text not null default 'render',
  not_before timestamptz not null,
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claim_content_token text,
  claim_nonce text,
  last_error_code text,
  last_error_message text,
  desired_scene_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_3d_thumbnail_jobs_version_room_fkey
    foreign key (version_id, room_id)
    references public.vibode_room_assets (id, room_id)
    on delete cascade,
  constraint vibode_3d_thumbnail_jobs_room_version_key unique (room_id, version_id),
  constraint vibode_3d_thumbnail_jobs_status_closed
    check (status in ('pending', 'running', 'failed', 'superseded', 'completed')),
  constraint vibode_3d_thumbnail_jobs_outcome_closed
    check (desired_outcome in ('render', 'clear')),
  constraint vibode_3d_thumbnail_jobs_content_token_hex
    check (content_token ~ '^[0-9a-f]{64}$'),
  constraint vibode_3d_thumbnail_jobs_claim_token_hex
    check (claim_content_token is null or claim_content_token ~ '^[0-9a-f]{64}$'),
  constraint vibode_3d_thumbnail_jobs_attempt_count_bounds
    check (attempt_count >= 0 and attempt_count <= 3),
  constraint vibode_3d_thumbnail_jobs_error_message_len
    check (last_error_message is null or char_length(last_error_message) <= 240)
);

create index vibode_3d_thumbnail_jobs_due_idx
  on public.vibode_3d_thumbnail_jobs (not_before, created_at)
  where status = 'pending' and desired_outcome = 'render';

create index vibode_3d_thumbnail_jobs_lease_idx
  on public.vibode_3d_thumbnail_jobs (claim_expires_at)
  where status = 'running';

create unique index vibode_3d_thumbnail_jobs_claim_nonce_uidx
  on public.vibode_3d_thumbnail_jobs (claim_nonce)
  where claim_nonce is not null;

create trigger set_timestamp_vibode_3d_thumbnail_jobs
before update on public.vibode_3d_thumbnail_jobs
for each row execute function public.set_timestamp();

create table public.vibode_3d_thumbnail_pointers (
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  version_id uuid not null,
  afc_generation_id uuid not null,
  content_token text not null,
  storage_bucket text not null,
  storage_path text not null,
  generated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (version_id),
  constraint vibode_3d_thumbnail_pointers_version_room_fkey
    foreign key (version_id, room_id)
    references public.vibode_room_assets (id, room_id)
    on delete cascade,
  constraint vibode_3d_thumbnail_pointers_room_version_key unique (room_id, version_id),
  constraint vibode_3d_thumbnail_pointers_content_token_hex
    check (content_token ~ '^[0-9a-f]{64}$'),
  constraint vibode_3d_thumbnail_pointers_bucket_closed
    check (storage_bucket = 'vibode-thumbnails'),
  constraint vibode_3d_thumbnail_pointers_path_closed
    check (
      storage_path = 'rooms/' || room_id::text || '/versions/' || version_id::text
        || '/scene/' || content_token || '.webp'
    )
);

create trigger set_timestamp_vibode_3d_thumbnail_pointers
before update on public.vibode_3d_thumbnail_pointers
for each row execute function public.set_timestamp();

create or replace function public.enqueue_vibode_3d_thumbnail_job(
  p_room_id uuid,
  p_version_id uuid,
  p_afc_generation_id uuid,
  p_content_token text,
  p_not_before timestamptz,
  p_scene_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_3d_thumbnail_jobs%rowtype;
begin
  if p_content_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  -- One statement. Concurrent first inserts cannot lose the row.
  -- A later commit with an older scene updated_at does not replace a newer token.
  insert into public.vibode_3d_thumbnail_jobs (
    room_id, version_id, afc_generation_id, content_token, status,
    desired_outcome, not_before, attempt_count, desired_scene_updated_at
  ) values (
    p_room_id, p_version_id, p_afc_generation_id, p_content_token, 'pending',
    'render', p_not_before, 0, p_scene_updated_at
  )
  on conflict (room_id, version_id) do update
    set afc_generation_id = case
          when excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then excluded.afc_generation_id
          else vibode_3d_thumbnail_jobs.afc_generation_id
        end,
        content_token = case
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.content_token
          when excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then excluded.content_token
          else vibode_3d_thumbnail_jobs.content_token
        end,
        desired_outcome = case
          when excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then 'render'
          else vibode_3d_thumbnail_jobs.desired_outcome
        end,
        not_before = case
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.not_before
          when excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then excluded.not_before
          else vibode_3d_thumbnail_jobs.not_before
        end,
        status = case
          when vibode_3d_thumbnail_jobs.status = 'running' then 'running'
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then 'completed'
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.status
          else 'pending'
        end,
        attempt_count = case
          when vibode_3d_thumbnail_jobs.status = 'running'
            then vibode_3d_thumbnail_jobs.attempt_count
          when vibode_3d_thumbnail_jobs.status = 'pending'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            and excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.attempt_count
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.attempt_count
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.attempt_count
          else 0
        end,
        last_error_code = case
          when vibode_3d_thumbnail_jobs.status = 'running'
            then vibode_3d_thumbnail_jobs.last_error_code
          when vibode_3d_thumbnail_jobs.status = 'pending'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            and excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.last_error_code
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.last_error_code
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.last_error_code
          else null
        end,
        last_error_message = case
          when vibode_3d_thumbnail_jobs.status = 'running'
            then vibode_3d_thumbnail_jobs.last_error_message
          when vibode_3d_thumbnail_jobs.status = 'pending'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            and excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.last_error_message
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.last_error_message
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.last_error_message
          else null
        end,
        claimed_at = case
          when vibode_3d_thumbnail_jobs.status = 'running' then vibode_3d_thumbnail_jobs.claimed_at
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.claimed_at
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.claimed_at
          else null
        end,
        claim_expires_at = case
          when vibode_3d_thumbnail_jobs.status = 'running' then vibode_3d_thumbnail_jobs.claim_expires_at
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.claim_expires_at
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.claim_expires_at
          else null
        end,
        claim_content_token = case
          when vibode_3d_thumbnail_jobs.status = 'running' then vibode_3d_thumbnail_jobs.claim_content_token
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.claim_content_token
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.claim_content_token
          else null
        end,
        claim_nonce = case
          when vibode_3d_thumbnail_jobs.status = 'running' then vibode_3d_thumbnail_jobs.claim_nonce
          when excluded.desired_scene_updated_at < vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then vibode_3d_thumbnail_jobs.claim_nonce
          when vibode_3d_thumbnail_jobs.status = 'completed'
            and vibode_3d_thumbnail_jobs.content_token = excluded.content_token
            then vibode_3d_thumbnail_jobs.claim_nonce
          else null
        end,
        desired_scene_updated_at = case
          when excluded.desired_scene_updated_at >= vibode_3d_thumbnail_jobs.desired_scene_updated_at
            then excluded.desired_scene_updated_at
          else vibode_3d_thumbnail_jobs.desired_scene_updated_at
        end
  returning * into v_job;

  return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', v_job.status, 'content_token', v_job.content_token);
end;
$$;

create or replace function public.clear_vibode_3d_thumbnail_for_empty_scene(
  p_room_id uuid,
  p_version_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_3d_thumbnail_jobs%rowtype;
  v_has_job boolean := false;
begin
  select *
    into v_job
  from public.vibode_3d_thumbnail_jobs
  where room_id = p_room_id
    and version_id = p_version_id
  for update;
  v_has_job := found;

  delete from public.vibode_3d_thumbnail_pointers
  where room_id = p_room_id
    and version_id = p_version_id;

  if not v_has_job then
    return jsonb_build_object('ok', true, 'status', 'cleared');
  end if;

  if v_job.status = 'running' then
    update public.vibode_3d_thumbnail_jobs
      set desired_outcome = 'clear'
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', 'running');
  end if;

  update public.vibode_3d_thumbnail_jobs
    set desired_outcome = 'clear',
        status = 'superseded',
        claimed_at = null,
        claim_expires_at = null,
        claim_content_token = null,
        claim_nonce = null,
        last_error_code = null,
        last_error_message = null
  where id = v_job.id;
  return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', 'superseded');
end;
$$;

create or replace function public.claim_next_vibode_3d_thumbnail_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_job public.vibode_3d_thumbnail_jobs%rowtype;
begin
  update public.vibode_3d_thumbnail_jobs
    set status = 'superseded',
        claimed_at = null,
        claim_expires_at = null,
        claim_content_token = null,
        claim_nonce = null
  where status = 'running'
    and desired_outcome = 'clear'
    and claim_expires_at <= now();

  update public.vibode_3d_thumbnail_jobs
    set status = 'failed',
        last_error_code = 'claim_expired',
        last_error_message = 'Claim lease expired after the last attempt.',
        claimed_at = null,
        claim_expires_at = null,
        claim_content_token = null,
        claim_nonce = null
  where status = 'running'
    and desired_outcome = 'render'
    and claim_expires_at <= now()
    and attempt_count >= 3;

  select id
    into v_id
  from public.vibode_3d_thumbnail_jobs
  where (
      status = 'pending'
      and desired_outcome = 'render'
      and not_before <= now()
    ) or (
      status = 'running'
      and desired_outcome = 'render'
      and claim_expires_at <= now()
      and attempt_count < 3
    )
  order by not_before, created_at
  limit 1
  for update skip locked;

  if v_id is null then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  update public.vibode_3d_thumbnail_jobs
    set status = 'running',
        attempt_count = attempt_count + 1,
        claimed_at = now(),
        claim_expires_at = now() + interval '180 seconds',
        claim_content_token = content_token,
        claim_nonce = gen_random_uuid()::text,
        last_error_code = null,
        last_error_message = null
  where id = v_id
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id,
      'roomId', v_job.room_id,
      'versionId', v_job.version_id,
      'afcGenerationId', v_job.afc_generation_id,
      'contentToken', v_job.content_token,
      'claimContentToken', v_job.claim_content_token,
      'claimNonce', v_job.claim_nonce,
      'claimExpiresAt', v_job.claim_expires_at,
      'attemptCount', v_job.attempt_count,
      'status', v_job.status
    )
  );
end;
$$;

create or replace function public.fail_vibode_3d_thumbnail_job(
  p_job_id uuid,
  p_claim_nonce text,
  p_code text,
  p_message text,
  p_retryable boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_3d_thumbnail_jobs%rowtype;
  v_delay_sec integer;
begin
  select *
    into v_job
  from public.vibode_3d_thumbnail_jobs
  where id = p_job_id
  for update;

  if not found
    or v_job.status is distinct from 'running'
    or v_job.claim_nonce is distinct from p_claim_nonce
    or v_job.claim_expires_at is null
    or v_job.claim_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  if v_job.desired_outcome = 'clear' then
    update public.vibode_3d_thumbnail_jobs
      set status = 'superseded',
          claimed_at = null,
          claim_expires_at = null,
          claim_content_token = null,
          claim_nonce = null
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'status', 'superseded');
  end if;

  if v_job.content_token is distinct from v_job.claim_content_token then
    update public.vibode_3d_thumbnail_jobs
      set status = 'pending',
          attempt_count = 0,
          last_error_code = null,
          last_error_message = null,
          claimed_at = null,
          claim_expires_at = null,
          claim_content_token = null,
          claim_nonce = null
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;

  v_delay_sec := case v_job.attempt_count
    when 1 then 15
    when 2 then 60
    else 180
  end;

  if p_retryable and v_job.attempt_count < 3 then
    update public.vibode_3d_thumbnail_jobs
      set status = 'pending',
          not_before = now() + make_interval(secs => v_delay_sec),
          last_error_code = left(coalesce(p_code, 'render_page_error'), 80),
          last_error_message = left(coalesce(p_message, ''), 240),
          claimed_at = null,
          claim_expires_at = null,
          claim_content_token = null,
          claim_nonce = null
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'status', 'pending', 'backoffSec', v_delay_sec);
  end if;

  update public.vibode_3d_thumbnail_jobs
    set status = 'failed',
        last_error_code = left(coalesce(p_code, 'render_page_error'), 80),
        last_error_message = left(coalesce(p_message, ''), 240),
        claimed_at = null,
        claim_expires_at = null,
        claim_content_token = null,
        claim_nonce = null
  where id = v_job.id;
  return jsonb_build_object('ok', true, 'status', 'failed');
end;
$$;

create or replace function public.publish_vibode_3d_thumbnail(
  p_job_id uuid,
  p_claim_nonce text,
  p_content_token text,
  p_afc_generation_id uuid,
  p_scene_updated_at timestamptz,
  p_background_bucket text,
  p_background_path text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_3d_thumbnail_jobs%rowtype;
  v_scene public.vibode_3d_scenes%rowtype;
  v_has_scene boolean := false;
  v_bucket text;
  v_path text;
  v_current_generation uuid;
  v_expected_path text;
begin
  if p_content_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_storage_path');
  end if;

  select *
    into v_job
  from public.vibode_3d_thumbnail_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  v_expected_path := 'rooms/' || v_job.room_id::text || '/versions/' || v_job.version_id::text
    || '/scene/' || p_content_token || '.webp';

  if v_job.status = 'completed'
    and v_job.content_token = p_content_token
    and exists (
      select 1
      from public.vibode_3d_thumbnail_pointers pointer
      where pointer.version_id = v_job.version_id
        and pointer.content_token = p_content_token
        and pointer.storage_path = v_expected_path
        and pointer.storage_bucket = 'vibode-thumbnails'
    )
  then
    return jsonb_build_object('ok', true, 'idempotent', true, 'storagePath', v_expected_path);
  end if;

  if v_job.status is distinct from 'running'
    or v_job.claim_nonce is distinct from p_claim_nonce
    or v_job.claim_content_token is distinct from p_content_token
    or v_job.claim_expires_at is null
    or v_job.claim_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  select *
    into v_scene
  from public.vibode_3d_scenes
  where room_id = v_job.room_id
    and version_id = v_job.version_id
  for update;
  v_has_scene := found;

  select storage_bucket, storage_path, current_afc.current_afc_generation_id
    into v_bucket, v_path, v_current_generation
  from public.vibode_room_assets asset
  join public.vibode_rooms current_afc on current_afc.id = asset.room_id
  where asset.id = v_job.version_id
    and asset.room_id = v_job.room_id
  for update of asset, current_afc;

  if v_job.desired_outcome = 'clear'
    or not v_has_scene
    or jsonb_typeof(v_scene.objects_json) is distinct from 'array'
    or jsonb_array_length(v_scene.objects_json) = 0
  then
    delete from public.vibode_3d_thumbnail_pointers
    where version_id = v_job.version_id;
    update public.vibode_3d_thumbnail_jobs
      set status = 'superseded',
          desired_outcome = 'clear',
          claimed_at = null,
          claim_expires_at = null,
          claim_content_token = null,
          claim_nonce = null
    where id = v_job.id;
    return jsonb_build_object('ok', false, 'code', 'stale_publish');
  end if;

  if v_job.content_token is distinct from p_content_token
    or v_scene.afc_generation_id is distinct from p_afc_generation_id
    or v_scene.afc_generation_id is distinct from v_job.afc_generation_id
    or v_current_generation is distinct from p_afc_generation_id
    or v_scene.updated_at is distinct from p_scene_updated_at
    or v_bucket is distinct from p_background_bucket
    or v_path is distinct from p_background_path
  then
    if v_job.content_token is distinct from v_job.claim_content_token then
      update public.vibode_3d_thumbnail_jobs
        set status = 'pending',
            attempt_count = 0,
            last_error_code = null,
            last_error_message = null,
            claimed_at = null,
            claim_expires_at = null,
            claim_content_token = null,
            claim_nonce = null
      where id = v_job.id;
    else
      update public.vibode_3d_thumbnail_jobs
        set status = 'superseded',
            claimed_at = null,
            claim_expires_at = null,
            claim_content_token = null,
            claim_nonce = null
      where id = v_job.id;
    end if;
    return jsonb_build_object('ok', false, 'code', 'stale_publish');
  end if;

  insert into public.vibode_3d_thumbnail_pointers (
    room_id, version_id, afc_generation_id, content_token,
    storage_bucket, storage_path, generated_at
  ) values (
    v_job.room_id, v_job.version_id, v_job.afc_generation_id, p_content_token,
    'vibode-thumbnails', v_expected_path, now()
  )
  on conflict (version_id) do update
    set room_id = excluded.room_id,
        afc_generation_id = excluded.afc_generation_id,
        content_token = excluded.content_token,
        storage_bucket = excluded.storage_bucket,
        storage_path = excluded.storage_path,
        generated_at = case
          when vibode_3d_thumbnail_pointers.content_token = excluded.content_token
            and vibode_3d_thumbnail_pointers.storage_path = excluded.storage_path
          then vibode_3d_thumbnail_pointers.generated_at
          else excluded.generated_at
        end;

  update public.vibode_3d_thumbnail_jobs
    set status = 'completed',
        last_error_code = null,
        last_error_message = null,
        claimed_at = null,
        claim_expires_at = null,
        claim_content_token = null,
        claim_nonce = null
  where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'storageBucket', 'vibode-thumbnails',
    'storagePath', v_expected_path
  );
end;
$$;

revoke all on function public.enqueue_vibode_3d_thumbnail_job(uuid, uuid, uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.clear_vibode_3d_thumbnail_for_empty_scene(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_next_vibode_3d_thumbnail_job()
  from public, anon, authenticated;
revoke all on function public.fail_vibode_3d_thumbnail_job(uuid, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.publish_vibode_3d_thumbnail(uuid, text, text, uuid, timestamptz, text, text)
  from public, anon, authenticated;

grant execute on function public.enqueue_vibode_3d_thumbnail_job(uuid, uuid, uuid, text, timestamptz, timestamptz)
  to service_role;
grant execute on function public.clear_vibode_3d_thumbnail_for_empty_scene(uuid, uuid)
  to service_role;
grant execute on function public.claim_next_vibode_3d_thumbnail_job()
  to service_role;
grant execute on function public.fail_vibode_3d_thumbnail_job(uuid, text, text, text, boolean)
  to service_role;
grant execute on function public.publish_vibode_3d_thumbnail(uuid, text, text, uuid, timestamptz, text, text)
  to service_role;

alter table public.vibode_3d_thumbnail_jobs enable row level security;
alter table public.vibode_3d_thumbnail_pointers enable row level security;

revoke all on table public.vibode_3d_thumbnail_jobs from public, anon, authenticated;
revoke all on table public.vibode_3d_thumbnail_pointers from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_3d_thumbnail_jobs to service_role;
grant select, insert, update, delete on table public.vibode_3d_thumbnail_pointers to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-thumbnails',
  'vibode-thumbnails',
  false,
  10485760,
  array['image/webp', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do nothing;

commit;
