-- HARMONIZE-3B2-A2: durable History publication and thumbnail recovery.
--
-- Apply after 20261015190000_vibode_harmonize_global_ceilings.sql.
-- Do not apply this file to hosted Supabase without explicit approval.
-- Do not start a worker from this migration.
--
-- history_state stays pending, published, or unavailable. A blocked path
-- keeps that state and is excluded by history_blocked_at or
-- thumbnail_blocked_at until an operator unblock. This file does not
-- replace publish_vibode_harmonize_history, generation claim, contact,
-- or enqueue.
--
-- Recovery leases use recovery_nonce and recovery_expires_at. They are
-- not generation claim_nonce, claim_expires_at, or provider_started_at.
-- The recovery advisory lock is (8142, 20261016). Generation claims keep
-- (8142, 20261015).
--
-- Transient failures 1 through 4 schedule 5 seconds, 15 seconds,
-- 45 seconds, and 3 minutes. Failure 5 blocks that path. The backoff
-- function still returns 15 minutes for index 4; that interval is reserved
-- and is not scheduled while the cap is 5. An expired lease is one failed
-- attempt when the publication or thumbnail is still outstanding. A stale
-- nonce cannot charge another attempt, clear a block, or overwrite the row.

begin;

alter table public.vibode_harmonize_generations
  add column history_attempt_count integer not null default 0,
  add column history_not_before timestamptz null,
  add column history_blocked_at timestamptz null,
  add column history_block_code text null,
  add column thumbnail_attempt_count integer not null default 0,
  add column thumbnail_not_before timestamptz null,
  add column thumbnail_blocked_at timestamptz null,
  add column thumbnail_block_code text null,
  add column recovery_nonce text null,
  add column recovery_expires_at timestamptz null,
  add column recovery_kind text null;

alter table public.vibode_harmonize_generations
  add constraint vibode_harmonize_history_attempt_count_bounds
    check (history_attempt_count between 0 and 5),
  add constraint vibode_harmonize_thumbnail_attempt_count_bounds
    check (thumbnail_attempt_count between 0 and 5),
  add constraint vibode_harmonize_history_block_code_shape
    check (history_block_code is null or history_block_code ~ '^[a-z0-9_]{1,64}$'),
  add constraint vibode_harmonize_thumbnail_block_code_shape
    check (thumbnail_block_code is null or thumbnail_block_code ~ '^[a-z0-9_]{1,64}$'),
  add constraint vibode_harmonize_history_block_pair
    check ((history_blocked_at is null) = (history_block_code is null)),
  add constraint vibode_harmonize_thumbnail_block_pair
    check ((thumbnail_blocked_at is null) = (thumbnail_block_code is null)),
  add constraint vibode_harmonize_recovery_claim_shape
    check (
      (
        recovery_nonce is null
        and recovery_expires_at is null
        and recovery_kind is null
      )
      or (
        recovery_nonce ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and recovery_expires_at is not null
        and recovery_kind in ('history', 'thumbnail')
      )
    ),
  add constraint vibode_harmonize_recovery_only_after_success
    check (
      status = 'succeeded'
      or (
        history_attempt_count = 0
        and history_not_before is null
        and history_blocked_at is null
        and history_block_code is null
        and thumbnail_attempt_count = 0
        and thumbnail_not_before is null
        and thumbnail_blocked_at is null
        and thumbnail_block_code is null
        and recovery_nonce is null
      )
    );

comment on column public.vibode_harmonize_generations.history_attempt_count is
  'Failed durable History publication attempts. Independent of generation attempt_count.';

comment on column public.vibode_harmonize_generations.history_blocked_at is
  'Set when History recovery is blocked. history_state stays pending until an operator unblocks or publication commits.';

comment on column public.vibode_harmonize_generations.thumbnail_attempt_count is
  'Failed durable thumbnail attempts for an already published Harmonize asset.';

comment on column public.vibode_harmonize_generations.recovery_nonce is
  'Fence for one History or thumbnail recovery claim. Independent of claim_nonce.';

create index vibode_harmonize_history_recovery_due
  on public.vibode_harmonize_generations (completed_at)
  where status = 'succeeded'
    and history_state = 'pending'
    and history_blocked_at is null
    and recovery_nonce is null;

create index vibode_harmonize_thumbnail_recovery_due
  on public.vibode_harmonize_generations (completed_at)
  where status = 'succeeded'
    and history_state = 'published'
    and thumbnail_blocked_at is null
    and recovery_nonce is null;

create or replace function public.vibode_harmonize_recovery_backoff(p_attempt_index integer)
returns interval
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case p_attempt_index
    when 0 then interval '5 seconds'
    when 1 then interval '15 seconds'
    when 2 then interval '45 seconds'
    when 3 then interval '3 minutes'
    else interval '15 minutes'
  end
$$;

revoke all on function public.vibode_harmonize_recovery_backoff(integer) from public, anon, authenticated;

create or replace function public.vibode_harmonize_generations_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.user_id is distinct from new.user_id
     or old.room_id is distinct from new.room_id
     or old.idempotency_key is distinct from new.idempotency_key
     or old.kind is distinct from new.kind
     or old.request_sha256 is distinct from new.request_sha256
     or old.scene_snapshot_sha256 is distinct from new.scene_snapshot_sha256
     or old.background_sha256 is distinct from new.background_sha256
     or old.composite_sha256 is distinct from new.composite_sha256
     or old.prompt_sha256 is distinct from new.prompt_sha256
     or old.prompt_version is distinct from new.prompt_version
     or old.assembly_version is distinct from new.assembly_version
     or old.afc_generation_id is distinct from new.afc_generation_id
     or old.snapshot is distinct from new.snapshot
     or old.composite_bucket is distinct from new.composite_bucket
     or old.composite_path is distinct from new.composite_path
     or old.composite_byte_length is distinct from new.composite_byte_length
     or old.composite_width is distinct from new.composite_width
     or old.composite_height is distinct from new.composite_height
     or old.provider is distinct from new.provider
     or old.requested_model_id is distinct from new.requested_model_id
     or old.created_at is distinct from new.created_at
  then
    raise exception 'harmonize snapshot is immutable';
  end if;

  if old.backdrop_kind is not null and new.backdrop_kind is distinct from old.backdrop_kind then
    raise exception 'harmonize backdrop is immutable';
  end if;

  if old.backdrop_kind is null and new.backdrop_kind is not null then
    if old.status <> 'queued' or new.status <> 'queued'
       or old.history_state <> 'pending' or new.history_state <> 'pending'
    then
      raise exception 'harmonize backdrop is immutable';
    end if;
  end if;

  if old.scene_objects is not null and new.scene_objects is distinct from old.scene_objects then
    raise exception 'harmonize scene snapshot is immutable';
  end if;

  if old.scene_objects is null and new.scene_objects is not null then
    if old.status <> 'queued' or new.status <> 'queued'
       or old.history_state <> 'pending' or new.history_state <> 'pending'
    then
      raise exception 'harmonize scene snapshot is immutable';
    end if;
  end if;

  if old.provider_started_at is not null
     and new.provider_started_at is distinct from old.provider_started_at
  then
    raise exception 'harmonize provider contact is immutable';
  end if;

  if old.provider_attempt_id is not null
     and new.provider_attempt_id is distinct from old.provider_attempt_id
  then
    raise exception 'harmonize provider contact is immutable';
  end if;

  if old.output_sha256 is not null and new.output_sha256 is distinct from old.output_sha256 then
    raise exception 'harmonize output is immutable';
  end if;

  if old.prompt_path is not null and new.prompt_path is distinct from old.prompt_path then
    raise exception 'harmonize prompt path is immutable';
  end if;

  if old.source_version_id is distinct from new.source_version_id
     and new.source_version_id is not null
  then
    raise exception 'harmonize source version is immutable';
  end if;

  if old.status not in ('succeeded', 'failed', 'cancelled')
     and (
       new.history_state is distinct from old.history_state
       or new.output_asset_id is distinct from old.output_asset_id
     )
  then
    raise exception 'harmonize history publishes only after success';
  end if;

  if old.status in ('succeeded', 'failed', 'cancelled') then
    -- Source asset and History asset deletes null their foreign keys.
    -- A room delete can null both in one update, so either or both is allowed.
    -- History state stays where it is. A published job is not republished.
    if new.status is not distinct from old.status
       and new.history_state is not distinct from old.history_state
       and new.output_sha256 is not distinct from old.output_sha256
       and new.output_path is not distinct from old.output_path
       and new.output_bucket is not distinct from old.output_bucket
       and new.failure_code is not distinct from old.failure_code
       and new.claim_nonce is not distinct from old.claim_nonce
       and new.provider_started_at is not distinct from old.provider_started_at
       and new.backdrop_kind is not distinct from old.backdrop_kind
       and new.scene_objects is not distinct from old.scene_objects
       and (new.source_version_id is not distinct from old.source_version_id or new.source_version_id is null)
       and (
         new.output_asset_id is not distinct from old.output_asset_id
         or (old.history_state = 'published' and new.output_asset_id is null)
       )
       and (
         new.source_version_id is distinct from old.source_version_id
         or new.output_asset_id is distinct from old.output_asset_id
       )
    then
      return new;
    end if;

    if old.status = 'succeeded'
       and new.status = 'succeeded'
       and old.history_state = 'pending'
       and new.history_state = 'unavailable'
       and old.output_asset_id is null
       and new.output_asset_id is null
       and new.source_version_id is not distinct from old.source_version_id
       and new.output_sha256 is not distinct from old.output_sha256
       and new.output_path is not distinct from old.output_path
       and new.output_bucket is not distinct from old.output_bucket
       and new.failure_code is not distinct from old.failure_code
       and new.claim_nonce is not distinct from old.claim_nonce
       and new.provider_started_at is not distinct from old.provider_started_at
       and new.provider_attempt_id is not distinct from old.provider_attempt_id
       and new.backdrop_kind is not distinct from old.backdrop_kind
       and new.scene_objects is not distinct from old.scene_objects
       and new.snapshot is not distinct from old.snapshot
       and new.afc_generation_id is not distinct from old.afc_generation_id
       and (
         old.backdrop_kind is null
         or old.scene_objects is null
         or old.output_sha256 is null
         or old.output_path is null
         or old.output_bucket is null
         or old.output_mime is distinct from 'image/jpeg'
         or old.output_width is null
         or old.output_height is null
       )
    then
      return new;
    end if;

    if old.status = 'succeeded'
       and new.status = 'succeeded'
       and old.history_state = 'pending'
       and new.history_state = 'published'
       and old.output_asset_id is null
       and new.output_asset_id is not null
       and new.source_version_id is not distinct from old.source_version_id
       and new.output_sha256 is not distinct from old.output_sha256
       and new.output_path is not distinct from old.output_path
       and new.output_bucket is not distinct from old.output_bucket
       and new.failure_code is not distinct from old.failure_code
       and new.claim_nonce is not distinct from old.claim_nonce
       and new.provider_started_at is not distinct from old.provider_started_at
       and new.backdrop_kind is not distinct from old.backdrop_kind
       and new.scene_objects is not distinct from old.scene_objects
    then
      return new;
    end if;

    -- Recovery bookkeeping and its lease. Capture, provider contact,
    -- generation attempts, and history_state stay where they are.
    if new.status = 'succeeded'
       and new.history_state is not distinct from old.history_state
       and new.output_asset_id is not distinct from old.output_asset_id
       and new.output_sha256 is not distinct from old.output_sha256
       and new.output_path is not distinct from old.output_path
       and new.output_bucket is not distinct from old.output_bucket
       and new.output_mime is not distinct from old.output_mime
       and new.output_width is not distinct from old.output_width
       and new.output_height is not distinct from old.output_height
       and new.failure_code is not distinct from old.failure_code
       and new.failure_message is not distinct from old.failure_message
       and new.claim_nonce is not distinct from old.claim_nonce
       and new.claim_expires_at is not distinct from old.claim_expires_at
       and new.claimed_at is not distinct from old.claimed_at
       and new.heartbeat_at is not distinct from old.heartbeat_at
       and new.provider_started_at is not distinct from old.provider_started_at
       and new.provider_attempt_id is not distinct from old.provider_attempt_id
       and new.provider_status is not distinct from old.provider_status
       and new.provider_http_status is not distinct from old.provider_http_status
       and new.returned_model_id is not distinct from old.returned_model_id
       and new.latency_ms is not distinct from old.latency_ms
       and new.attempt_count is not distinct from old.attempt_count
       and new.not_before is not distinct from old.not_before
       and new.completed_at is not distinct from old.completed_at
       and new.backdrop_kind is not distinct from old.backdrop_kind
       and new.scene_objects is not distinct from old.scene_objects
       and new.snapshot is not distinct from old.snapshot
       and new.source_version_id is not distinct from old.source_version_id
       and new.afc_generation_id is not distinct from old.afc_generation_id
       and new.prompt_path is not distinct from old.prompt_path
       and (
         new.history_attempt_count is distinct from old.history_attempt_count
         or new.history_not_before is distinct from old.history_not_before
         or new.history_blocked_at is distinct from old.history_blocked_at
         or new.history_block_code is distinct from old.history_block_code
         or new.thumbnail_attempt_count is distinct from old.thumbnail_attempt_count
         or new.thumbnail_not_before is distinct from old.thumbnail_not_before
         or new.thumbnail_blocked_at is distinct from old.thumbnail_blocked_at
         or new.thumbnail_block_code is distinct from old.thumbnail_block_code
         or new.recovery_nonce is distinct from old.recovery_nonce
         or new.recovery_expires_at is distinct from old.recovery_expires_at
         or new.recovery_kind is distinct from old.recovery_kind
       )
    then
      if old.history_state = 'pending'
         and new.thumbnail_attempt_count is not distinct from old.thumbnail_attempt_count
         and new.thumbnail_not_before is not distinct from old.thumbnail_not_before
         and new.thumbnail_blocked_at is not distinct from old.thumbnail_blocked_at
         and new.thumbnail_block_code is not distinct from old.thumbnail_block_code
         and (
           new.recovery_kind is not distinct from old.recovery_kind
           or (old.recovery_kind is null and new.recovery_kind = 'history')
           or (old.recovery_kind = 'history' and new.recovery_kind is null)
           or (old.recovery_kind = 'thumbnail' and new.recovery_kind is null)
         )
      then
        return new;
      end if;

      if old.history_state = 'published'
         and new.history_attempt_count is not distinct from old.history_attempt_count
         and new.history_not_before is not distinct from old.history_not_before
         and new.history_blocked_at is not distinct from old.history_blocked_at
         and new.history_block_code is not distinct from old.history_block_code
         and (
           new.recovery_kind is not distinct from old.recovery_kind
           or (old.recovery_kind is null and new.recovery_kind = 'thumbnail')
           or (old.recovery_kind = 'thumbnail' and new.recovery_kind is null)
           or (old.recovery_kind = 'history' and new.recovery_kind is null)
         )
      then
        return new;
      end if;

      if old.history_state = 'unavailable'
         and new.history_attempt_count is not distinct from old.history_attempt_count
         and new.history_not_before is not distinct from old.history_not_before
         and new.history_blocked_at is not distinct from old.history_blocked_at
         and new.history_block_code is not distinct from old.history_block_code
         and new.thumbnail_attempt_count is not distinct from old.thumbnail_attempt_count
         and new.thumbnail_not_before is not distinct from old.thumbnail_not_before
         and new.thumbnail_blocked_at is not distinct from old.thumbnail_blocked_at
         and new.thumbnail_block_code is not distinct from old.thumbnail_block_code
         and new.recovery_nonce is null
         and new.recovery_expires_at is null
         and new.recovery_kind is null
      then
        return new;
      end if;
    end if;

    raise exception 'harmonize generation is terminal';
  end if;

  return new;
end;
$$;

revoke all on function public.vibode_harmonize_generations_guard() from public, anon, authenticated;

create or replace function public.claim_next_vibode_harmonize_history_recovery()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job_id uuid;
  v_kind text;
  v_nonce text;
  v_expires timestamptz;
  v_updated integer := 0;
begin
  perform pg_advisory_xact_lock(8142, 20261016);

  -- A crashed worker's lease expires here. The stale nonce cannot do this
  -- itself. Publication that already committed is not charged again.
  update public.vibode_harmonize_generations
    set recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where recovery_nonce is not null
    and recovery_expires_at <= now()
    and recovery_kind = 'history'
    and (
      history_state in ('published', 'unavailable')
      or history_blocked_at is not null
    );

  update public.vibode_harmonize_generations
    set history_attempt_count = least(history_attempt_count + 1, 5),
        history_not_before = case
          when history_attempt_count + 1 >= 5 then null
          else now() + public.vibode_harmonize_recovery_backoff(history_attempt_count)
        end,
        history_blocked_at = case
          when history_attempt_count + 1 >= 5 then now()
          else history_blocked_at
        end,
        history_block_code = case
          when history_attempt_count + 1 >= 5 then 'recovery_abandoned'
          else history_block_code
        end,
        recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where status = 'succeeded'
    and history_state = 'pending'
    and history_blocked_at is null
    and recovery_kind = 'history'
    and recovery_nonce is not null
    and recovery_expires_at <= now();

  update public.vibode_harmonize_generations as job
    set recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where job.recovery_nonce is not null
    and job.recovery_expires_at <= now()
    and job.recovery_kind = 'thumbnail'
    and (
      job.thumbnail_blocked_at is not null
      or exists (
        select 1
        from public.vibode_room_assets asset
        where asset.id = job.output_asset_id
          and asset.harmonize_job_id = job.id
          and nullif(btrim(asset.thumbnail_storage_path), '') is not null
      )
    );

  update public.vibode_harmonize_generations
    set thumbnail_attempt_count = least(thumbnail_attempt_count + 1, 5),
        thumbnail_not_before = case
          when thumbnail_attempt_count + 1 >= 5 then null
          else now() + public.vibode_harmonize_recovery_backoff(thumbnail_attempt_count)
        end,
        thumbnail_blocked_at = case
          when thumbnail_attempt_count + 1 >= 5 then now()
          else thumbnail_blocked_at
        end,
        thumbnail_block_code = case
          when thumbnail_attempt_count + 1 >= 5 then 'thumbnail_abandoned'
          else thumbnail_block_code
        end,
        recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where status = 'succeeded'
    and history_state = 'published'
    and thumbnail_blocked_at is null
    and recovery_kind = 'thumbnail'
    and recovery_nonce is not null
    and recovery_expires_at <= now();

  select job.id, 'history'::text
    into v_job_id, v_kind
  from public.vibode_harmonize_generations job
  where job.status = 'succeeded'
    and job.history_state = 'pending'
    and job.history_blocked_at is null
    and job.history_attempt_count < 5
    and (job.history_not_before is null or job.history_not_before <= now())
    and job.recovery_nonce is null
    and job.backdrop_kind is not null
    and job.scene_objects is not null
    and jsonb_typeof(job.scene_objects) = 'array'
    and job.output_sha256 is not null
    and job.output_path is not null
    and job.output_bucket is not null
    and job.output_mime = 'image/jpeg'
    and job.output_width is not null
    and job.output_height is not null
  order by job.completed_at nulls last, job.created_at
  limit 1
  for update skip locked;

  if v_job_id is null then
    select job.id, 'thumbnail'::text
      into v_job_id, v_kind
    from public.vibode_harmonize_generations job
    where job.status = 'succeeded'
      and job.history_state = 'published'
      and job.output_asset_id is not null
      and job.thumbnail_blocked_at is null
      and job.thumbnail_attempt_count < 5
      and (job.thumbnail_not_before is null or job.thumbnail_not_before <= now())
      and job.recovery_nonce is null
      and exists (
        select 1
        from public.vibode_room_assets asset
        where asset.id = job.output_asset_id
          and asset.harmonize_job_id = job.id
          and asset.room_id = job.room_id
          and asset.user_id = job.user_id
          and nullif(btrim(asset.thumbnail_storage_path), '') is null
      )
    order by job.completed_at nulls last, job.created_at
    limit 1
    for update skip locked;
  end if;

  if v_job_id is null then
    return jsonb_build_object('ok', true, 'task', null);
  end if;

  v_nonce := gen_random_uuid()::text;
  v_expires := now() + interval '120 seconds';
  update public.vibode_harmonize_generations
    set recovery_nonce = v_nonce,
        recovery_expires_at = v_expires,
        recovery_kind = v_kind,
        updated_at = now()
  where id = v_job_id
    and recovery_nonce is null
    and status = 'succeeded';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object('ok', true, 'task', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'task', jsonb_build_object(
      'jobId', v_job_id,
      'kind', v_kind,
      'recoveryNonce', v_nonce,
      'recoveryExpiresAt', v_expires
    )
  );
end;
$$;

create or replace function public.complete_vibode_harmonize_history_recovery(
  p_job_id uuid,
  p_recovery_nonce text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_updated integer := 0;
begin
  if p_job_id is null or p_recovery_nonce is null then
    return jsonb_build_object('ok', false, 'code', 'stale_recovery');
  end if;

  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found
     or v_job.status is distinct from 'succeeded'
     or v_job.recovery_nonce is distinct from p_recovery_nonce
     or v_job.recovery_expires_at is null
     or v_job.recovery_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'stale_recovery');
  end if;

  if v_job.recovery_kind = 'history' then
    if v_job.history_state is distinct from 'published' then
      return jsonb_build_object('ok', false, 'code', 'not_published');
    end if;
  elsif v_job.recovery_kind = 'thumbnail' then
    if v_job.history_state is distinct from 'published'
       or not exists (
         select 1
         from public.vibode_room_assets asset
         where asset.id = v_job.output_asset_id
           and asset.harmonize_job_id = v_job.id
           and nullif(btrim(asset.thumbnail_storage_path), '') is not null
       )
    then
      return jsonb_build_object('ok', false, 'code', 'not_thumbnailed');
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'stale_recovery');
  end if;

  update public.vibode_harmonize_generations
    set recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where id = v_job.id
    and recovery_nonce = p_recovery_nonce
    and recovery_expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object('ok', false, 'code', 'stale_recovery');
  end if;

  return jsonb_build_object('ok', true, 'code', 'completed');
end;
$$;

create or replace function public.fail_vibode_harmonize_history_recovery(
  p_job_id uuid,
  p_recovery_nonce text,
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_code text;
  v_transient boolean;
  v_next integer;
  v_updated integer := 0;
begin
  if p_job_id is null or p_recovery_nonce is null then
    return jsonb_build_object('ok', false, 'code', 'stale_recovery');
  end if;

  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found
     or v_job.status is distinct from 'succeeded'
     or v_job.recovery_nonce is distinct from p_recovery_nonce
     or v_job.recovery_expires_at is null
     or v_job.recovery_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'stale_recovery');
  end if;

  v_code := lower(btrim(coalesce(p_code, '')));
  if v_code !~ '^[a-z0-9_]{1,64}$' then
    v_code := 'unexpected_output';
  end if;
  v_transient := v_code in (
    'output_unreadable',
    'unavailable',
    'publication_failed',
    'thumbnail_failed'
  );

  if v_job.recovery_kind = 'history' and v_job.history_state = 'unavailable' then
    update public.vibode_harmonize_generations
      set recovery_nonce = null,
          recovery_expires_at = null,
          recovery_kind = null,
          updated_at = now()
    where id = v_job.id
      and recovery_nonce = p_recovery_nonce;
    return jsonb_build_object('ok', true, 'code', 'not_publishable', 'blocked', false);
  end if;

  if v_job.recovery_kind = 'history' and v_job.history_state = 'published' then
    update public.vibode_harmonize_generations
      set recovery_nonce = null,
          recovery_expires_at = null,
          recovery_kind = null,
          updated_at = now()
    where id = v_job.id
      and recovery_nonce = p_recovery_nonce;
    return jsonb_build_object('ok', true, 'code', 'already_published', 'blocked', false);
  end if;

  if v_job.recovery_kind = 'history' and v_job.history_state = 'pending' then
    v_next := v_job.history_attempt_count + 1;
    if v_transient and v_next < 5 then
      update public.vibode_harmonize_generations
        set history_attempt_count = v_next,
            history_not_before = now() + public.vibode_harmonize_recovery_backoff(v_job.history_attempt_count),
            recovery_nonce = null,
            recovery_expires_at = null,
            recovery_kind = null,
            updated_at = now()
      where id = v_job.id
        and recovery_nonce = p_recovery_nonce
        and history_state = 'pending';
    else
      update public.vibode_harmonize_generations
        set history_attempt_count = least(v_next, 5),
            history_not_before = null,
            history_blocked_at = now(),
            history_block_code = v_code,
            recovery_nonce = null,
            recovery_expires_at = null,
            recovery_kind = null,
            updated_at = now()
      where id = v_job.id
        and recovery_nonce = p_recovery_nonce
        and history_state = 'pending';
    end if;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      return jsonb_build_object('ok', false, 'code', 'stale_recovery');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', v_code,
      'blocked', v_next >= 5 or not v_transient,
      'attemptCount', least(v_next, 5)
    );
  end if;

  if v_job.recovery_kind = 'thumbnail' and v_job.history_state = 'published' then
    v_next := v_job.thumbnail_attempt_count + 1;
    if v_transient and v_next < 5 then
      update public.vibode_harmonize_generations
        set thumbnail_attempt_count = v_next,
            thumbnail_not_before = now() + public.vibode_harmonize_recovery_backoff(v_job.thumbnail_attempt_count),
            recovery_nonce = null,
            recovery_expires_at = null,
            recovery_kind = null,
            updated_at = now()
      where id = v_job.id
        and recovery_nonce = p_recovery_nonce
        and history_state = 'published';
    else
      update public.vibode_harmonize_generations
        set thumbnail_attempt_count = least(v_next, 5),
            thumbnail_not_before = null,
            thumbnail_blocked_at = now(),
            thumbnail_block_code = v_code,
            recovery_nonce = null,
            recovery_expires_at = null,
            recovery_kind = null,
            updated_at = now()
      where id = v_job.id
        and recovery_nonce = p_recovery_nonce
        and history_state = 'published';
    end if;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      return jsonb_build_object('ok', false, 'code', 'stale_recovery');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', v_code,
      'blocked', v_next >= 5 or not v_transient,
      'attemptCount', least(v_next, 5)
    );
  end if;

  update public.vibode_harmonize_generations
    set recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where id = v_job.id
    and recovery_nonce = p_recovery_nonce;
  return jsonb_build_object('ok', true, 'code', 'not_publishable', 'blocked', false);
end;
$$;

create or replace function public.unblock_vibode_harmonize_history_recovery(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_updated integer := 0;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform pg_advisory_xact_lock(8142, 20261016);

  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.status is distinct from 'succeeded' then
    return jsonb_build_object('ok', false, 'code', 'not_succeeded');
  end if;
  if v_job.history_state is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  if v_job.history_blocked_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_blocked');
  end if;
  if v_job.recovery_nonce is not null and v_job.recovery_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'recovery_in_progress');
  end if;

  update public.vibode_harmonize_generations
    set history_attempt_count = 0,
        history_not_before = now(),
        history_blocked_at = null,
        history_block_code = null,
        recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where id = v_job.id
    and status = 'succeeded'
    and history_state = 'pending'
    and history_blocked_at is not null
    and (recovery_kind is null or recovery_kind = 'history');
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object('ok', false, 'code', 'not_blocked');
  end if;

  return jsonb_build_object('ok', true, 'code', 'unblocked');
end;
$$;

create or replace function public.unblock_vibode_harmonize_thumbnail_recovery(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_updated integer := 0;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform pg_advisory_xact_lock(8142, 20261016);

  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.status is distinct from 'succeeded' then
    return jsonb_build_object('ok', false, 'code', 'not_succeeded');
  end if;
  if v_job.history_state is distinct from 'published' then
    return jsonb_build_object('ok', false, 'code', 'not_published');
  end if;
  if v_job.thumbnail_blocked_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_blocked');
  end if;
  if v_job.recovery_nonce is not null and v_job.recovery_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'recovery_in_progress');
  end if;

  update public.vibode_harmonize_generations
    set thumbnail_attempt_count = 0,
        thumbnail_not_before = now(),
        thumbnail_blocked_at = null,
        thumbnail_block_code = null,
        recovery_nonce = null,
        recovery_expires_at = null,
        recovery_kind = null,
        updated_at = now()
  where id = v_job.id
    and status = 'succeeded'
    and history_state = 'published'
    and thumbnail_blocked_at is not null
    and (recovery_kind is null or recovery_kind = 'thumbnail' or recovery_expires_at <= now());
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object('ok', false, 'code', 'not_blocked');
  end if;

  return jsonb_build_object('ok', true, 'code', 'unblocked');
end;
$$;

revoke all on function public.claim_next_vibode_harmonize_history_recovery() from public, anon, authenticated;
revoke all on function public.complete_vibode_harmonize_history_recovery(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_vibode_harmonize_history_recovery(uuid, text, text) from public, anon, authenticated;
revoke all on function public.unblock_vibode_harmonize_history_recovery(uuid) from public, anon, authenticated;
revoke all on function public.unblock_vibode_harmonize_thumbnail_recovery(uuid) from public, anon, authenticated;

grant execute on function public.claim_next_vibode_harmonize_history_recovery() to service_role;
grant execute on function public.complete_vibode_harmonize_history_recovery(uuid, text) to service_role;
grant execute on function public.fail_vibode_harmonize_history_recovery(uuid, text, text) to service_role;
grant execute on function public.unblock_vibode_harmonize_history_recovery(uuid) to service_role;
grant execute on function public.unblock_vibode_harmonize_thumbnail_recovery(uuid) to service_role;

commit;
