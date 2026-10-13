-- HARMONIZE-3B1B enqueue publication readiness.
--
-- Requires 20261013140000_vibode_harmonize_history_publication.sql.
-- Do not apply this file to hosted Supabase from the application.
--
-- Replaces enqueue_vibode_harmonize_generation so the original queued insert
-- stores backdrop_kind and canonical scene_objects. A payload without those
-- fields is invalid_submission and inserts nothing. There is no post-insert
-- backfill. Provider contact, claim, and complete are unchanged.
--
-- vibode_harmonize_publication_enqueue_ready() exists only after this
-- migration and only while the publication columns exist. The server calls
-- it before enqueue and does not fall back to the previous insert contract.

create or replace function public.enqueue_vibode_harmonize_generation(
  p_user_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_room_id uuid;
  v_source_version_id uuid;
  v_idempotency_key uuid;
  v_generation_id uuid;
  v_existing public.vibode_harmonize_generations%rowtype;
  v_path text;
  v_prompt text;
  v_backdrop text;
  v_scene jsonb;
  v_job public.vibode_harmonize_generations%rowtype;
begin
  begin
    v_room_id := (p_payload->>'roomId')::uuid;
    v_source_version_id := (p_payload->>'sourceVersionId')::uuid;
    v_idempotency_key := (p_payload->>'idempotencyKey')::uuid;
    v_generation_id := (p_payload->>'afcGenerationId')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;

  v_backdrop := p_payload->>'backdropKind';
  v_scene := p_payload->'sceneObjects';
  if p_payload->>'requestSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'sceneSnapshotSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'backgroundSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'compositeSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'promptSha256' !~ '^[0-9a-f]{64}$'
     or coalesce(p_payload->>'promptVersion', '') = ''
     or coalesce(p_payload->>'assemblyVersion', '') = ''
     or jsonb_typeof(p_payload->'snapshot') <> 'object'
     or v_backdrop is null
     or v_backdrop not in ('afc_empty', 'afc_original', 'room_asset')
     or jsonb_typeof(v_scene) is distinct from 'array'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  if jsonb_array_length(v_scene) > 32 then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  v_prompt := p_payload->'snapshot'->>'prompt';
  if v_prompt is null or char_length(v_prompt) < 1 or char_length(v_prompt) > 100000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  v_path := 'rooms/' || v_room_id::text || '/intakes/' || p_user_id::text || '/' || v_idempotency_key::text || '/composite.png';
  if p_payload->>'compositePath' <> v_path then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  if not exists (
    select 1 from public.vibode_rooms
    where id = v_room_id and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not exists (
    select 1 from public.vibode_room_assets
    where id = v_source_version_id and room_id = v_room_id and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'source_version_not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-harmonize:' || p_user_id::text));

  select * into v_existing
  from public.vibode_harmonize_generations
  where user_id = p_user_id and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_sha256 = p_payload->>'requestSha256' then
      return jsonb_build_object('ok', true, 'created', false, 'jobId', v_existing.id, 'status', v_existing.status);
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  if exists (
    select 1 from public.vibode_harmonize_generations
    where user_id = p_user_id and status in ('queued', 'running')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_job');
  end if;

  if public.vibode_harmonize_provider_started_count(p_user_id) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;

  begin
    insert into public.vibode_harmonize_generations (
      user_id, room_id, source_version_id, idempotency_key, kind, status,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot,
      composite_bucket, composite_path, composite_byte_length, composite_width, composite_height,
      provider, requested_model_id,
      backdrop_kind, scene_objects
    ) values (
      p_user_id, v_room_id, v_source_version_id, v_idempotency_key, 'initial', 'queued',
      p_payload->>'requestSha256',
      p_payload->>'sceneSnapshotSha256',
      p_payload->>'backgroundSha256',
      p_payload->>'compositeSha256',
      p_payload->>'promptSha256',
      p_payload->>'promptVersion',
      p_payload->>'assemblyVersion',
      v_generation_id,
      p_payload->'snapshot',
      'vibode-harmonize',
      v_path,
      (p_payload->>'compositeByteLength')::integer,
      (p_payload->>'compositeWidth')::integer,
      (p_payload->>'compositeHeight')::integer,
      'google-gemini-interactions',
      'gemini-3-pro-image',
      v_backdrop,
      v_scene
    ) returning * into v_job;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'active_job');
    when check_violation or invalid_text_representation or not_null_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;

  if v_job.backdrop_kind is null or v_job.scene_objects is null or v_job.provider_started_at is not null then
    raise exception 'harmonize enqueue publication fields were not stored';
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'backdropKind', v_job.backdrop_kind
  );
end;
$$;

revoke all on function public.enqueue_vibode_harmonize_generation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_vibode_harmonize_generation(uuid, jsonb) to service_role;

create or replace function public.vibode_harmonize_publication_enqueue_ready()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from pg_catalog.pg_attribute backdrop
    join pg_catalog.pg_class relation on relation.oid = backdrop.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'vibode_harmonize_generations'
      and backdrop.attname = 'backdrop_kind'
      and backdrop.attnum > 0
      and not backdrop.attisdropped
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute scene
    join pg_catalog.pg_class relation on relation.oid = scene.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'vibode_harmonize_generations'
      and scene.attname = 'scene_objects'
      and scene.attnum > 0
      and not scene.attisdropped
  );
$$;

revoke all on function public.vibode_harmonize_publication_enqueue_ready() from public, anon, authenticated;
grant execute on function public.vibode_harmonize_publication_enqueue_ready() to service_role;
