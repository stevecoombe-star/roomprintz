-- REMOVE-2E: accept one succeeded Clean Up candidate into Image History.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.
--
-- The private candidate stays in vibode-cleanup. The service confirms this
-- function and its columns exist before copying any bytes into History
-- storage. Acceptance records a History asset and leaves the room, scene,
-- camera, and scale unchanged. It does not mark the asset active.

begin;

alter table public.vibode_cleanup_generations
  add column history_asset_id uuid null,
  add column accepted_at timestamptz null;

alter table public.vibode_room_assets
  add column cleanup_job_id uuid null;

alter table public.vibode_generation_runs
  add column cleanup_job_id uuid null;

alter table public.vibode_cleanup_generations
  add constraint vibode_cleanup_history_asset_id_fkey
    foreign key (history_asset_id)
    references public.vibode_room_assets(id)
    on delete set null;

alter table public.vibode_room_assets
  add constraint vibode_room_assets_cleanup_job_id_fkey
    foreign key (cleanup_job_id)
    references public.vibode_cleanup_generations(id)
    on delete set null;

alter table public.vibode_generation_runs
  add constraint vibode_generation_runs_cleanup_job_id_fkey
    foreign key (cleanup_job_id)
    references public.vibode_cleanup_generations(id)
    on delete set null;

create unique index vibode_cleanup_history_asset_id_uidx
  on public.vibode_cleanup_generations (history_asset_id)
  where history_asset_id is not null;

create unique index vibode_room_assets_cleanup_job_id_uidx
  on public.vibode_room_assets (cleanup_job_id)
  where cleanup_job_id is not null;

create unique index vibode_generation_runs_cleanup_job_id_uidx
  on public.vibode_generation_runs (cleanup_job_id)
  where cleanup_job_id is not null;

comment on column public.vibode_cleanup_generations.history_asset_id is
  'Image History asset created by accepting this candidate. Null until acceptance. Acceptance does not activate the room.';

create or replace function public.vibode_cleanup_generations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.user_id is distinct from new.user_id
     or old.room_id is distinct from new.room_id
     or old.afc_generation_id is distinct from new.afc_generation_id
     or old.paid_request_fingerprint is distinct from new.paid_request_fingerprint
     or old.input_fingerprint is distinct from new.input_fingerprint
     or old.original_sha256 is distinct from new.original_sha256
     or old.overlay_sha256 is distinct from new.overlay_sha256
     or old.prompt_sha256 is distinct from new.prompt_sha256
     or old.mask_manifest_sha256 is distinct from new.mask_manifest_sha256
     or old.aspect_ratio_family is distinct from new.aspect_ratio_family
     or old.resolution_class is distinct from new.resolution_class
     or old.original_path is distinct from new.original_path
     or old.overlay_path is distinct from new.overlay_path
     or old.prompt_path is distinct from new.prompt_path
     or old.masks_path is distinct from new.masks_path
     or old.provider is distinct from new.provider
     or old.requested_model_id is distinct from new.requested_model_id
     or old.created_at is distinct from new.created_at
     or old.retry_of_job_id is distinct from new.retry_of_job_id
     or old.retry_ordinal is distinct from new.retry_ordinal
  then
    raise exception 'cleanup snapshot is immutable';
  end if;
  if old.provider_started_at is not null and new.provider_started_at is distinct from old.provider_started_at then
    raise exception 'cleanup provider contact is immutable';
  end if;
  if old.provider_attempt_id is not null and new.provider_attempt_id is distinct from old.provider_attempt_id then
    raise exception 'cleanup provider contact is immutable';
  end if;
  if old.output_sha256 is not null and new.output_sha256 is distinct from old.output_sha256 then
    raise exception 'cleanup output is immutable';
  end if;
  if old.history_asset_id is not null and new.history_asset_id is distinct from old.history_asset_id then
    raise exception 'cleanup history is immutable';
  end if;
  if old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at then
    raise exception 'cleanup history is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.accept_vibode_cleanup_history(
  p_user_id uuid,
  p_job_id uuid,
  p_output_sha256 text,
  p_width integer,
  p_height integer,
  p_history_bucket text,
  p_history_path text,
  p_aspect_tier text,
  p_aspect_error double precision,
  p_source_asset_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.vibode_cleanup_generations%rowtype;
  v_asset_id uuid;
  v_run_id uuid;
  v_source uuid;
  v_path text;
begin
  select * into v_job
  from public.vibode_cleanup_generations
  where id = p_job_id
    and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not exists (
    select 1 from public.vibode_rooms
    where id = v_job.room_id and user_id = v_job.user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_job.history_asset_id is not null then
    select id into v_run_id
    from public.vibode_generation_runs
    where cleanup_job_id = v_job.id;
    return jsonb_build_object(
      'ok', true,
      'code', 'already_accepted',
      'assetId', v_job.history_asset_id,
      'generationRunId', v_run_id,
      'activated', false
    );
  end if;

  if v_job.discarded_at is not null or v_job.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'discarded');
  end if;

  if v_job.status <> 'succeeded'
     or v_job.output_sha256 is null
     or v_job.output_width is null
     or v_job.output_height is null
  then
    return jsonb_build_object('ok', false, 'code', 'not_succeeded');
  end if;

  if p_output_sha256 is distinct from v_job.output_sha256
     or p_output_sha256 !~ '^[0-9a-f]{64}$'
     or p_width is distinct from v_job.output_width
     or p_height is distinct from v_job.output_height
  then
    return jsonb_build_object('ok', false, 'code', 'candidate_mismatch');
  end if;

  v_path := 'rooms/' || v_job.room_id::text || '/cleanup/' || v_job.id::text || '.jpg';
  if p_history_bucket is distinct from 'vibode-generations'
     or p_history_path is distinct from v_path
  then
    return jsonb_build_object('ok', false, 'code', 'candidate_mismatch');
  end if;

  if p_aspect_tier is distinct from 'exact_grid_compatible'
     and p_aspect_tier is distinct from 'aspect_compatible_rescaled'
  then
    return jsonb_build_object('ok', false, 'code', 'aspect_incompatible');
  end if;

  if p_aspect_error is null or p_aspect_error < 0 or p_aspect_error > 0.015 then
    return jsonb_build_object('ok', false, 'code', 'aspect_incompatible');
  end if;

  v_source := null;
  if p_source_asset_id is not null then
    select id into v_source
    from public.vibode_room_assets
    where id = p_source_asset_id
      and room_id = v_job.room_id
      and user_id = v_job.user_id;
  end if;

  begin
    insert into public.vibode_room_assets (
      room_id,
      user_id,
      asset_type,
      stage_number,
      storage_bucket,
      storage_path,
      image_url,
      width,
      height,
      model_version,
      is_active,
      ai_generated,
      cleanup_job_id,
      metadata
    ) values (
      v_job.room_id,
      v_job.user_id,
      'stage_output',
      3,
      'vibode-generations',
      v_path,
      '',
      v_job.output_width,
      v_job.output_height,
      coalesce(v_job.returned_model_id, v_job.requested_model_id),
      false,
      true,
      v_job.id,
      jsonb_strip_nulls(jsonb_build_object(
        'versionKind', 'stage',
        'label', 'Clean Up Room',
        'cleanupJobId', v_job.id,
        'sourceRoomId', v_job.room_id,
        'sourceAfcGenerationId', v_job.afc_generation_id,
        'source_version_id', v_source,
        'originalSha256', v_job.original_sha256,
        'candidateSha256', v_job.output_sha256,
        'provider', v_job.provider,
        'model', coalesce(v_job.returned_model_id, v_job.requested_model_id),
        'candidateWidth', v_job.output_width,
        'candidateHeight', v_job.output_height,
        'generatedAt', v_job.completed_at,
        'acceptedAt', now(),
        'aspectCompatibility', jsonb_build_object(
          'version', 'afc-r3c-image-pair-compatibility/v1',
          'tier', p_aspect_tier,
          'relativeAspectError', p_aspect_error
        ),
        'stageRegistration', 'not-assessed'
      ))
    )
    returning id into v_asset_id;

    insert into public.vibode_generation_runs (
      room_id,
      user_id,
      run_type,
      stage_number,
      source_asset_id,
      output_asset_id,
      model_version,
      status,
      request_payload,
      response_payload,
      cleanup_job_id,
      completed_at
    ) values (
      v_job.room_id,
      v_job.user_id,
      'cleanup',
      3,
      v_source,
      v_asset_id,
      coalesce(v_job.returned_model_id, v_job.requested_model_id),
      'completed',
      jsonb_build_object(
        'cleanupJobId', v_job.id,
        'sourceAfcGenerationId', v_job.afc_generation_id,
        'originalSha256', v_job.original_sha256
      ),
      jsonb_build_object(
        'bucket', 'vibode-generations',
        'storagePath', v_path,
        'outputSha256', v_job.output_sha256,
        'width', v_job.output_width,
        'height', v_job.output_height,
        'label', 'Clean Up Room'
      ),
      v_job.id,
      now()
    )
    returning id into v_run_id;

    update public.vibode_cleanup_generations
      set history_asset_id = v_asset_id,
          accepted_at = now(),
          updated_at = now()
    where id = v_job.id
      and user_id = v_job.user_id
      and history_asset_id is null
      and status = 'succeeded';
    if not found then
      raise exception 'cleanup history acceptance lost the job lock';
    end if;
  exception
    when unique_violation then
      select history_asset_id into v_asset_id
      from public.vibode_cleanup_generations
      where id = v_job.id;
      if v_asset_id is null then
        return jsonb_build_object('ok', false, 'code', 'unavailable');
      end if;
      return jsonb_build_object(
        'ok', true,
        'code', 'already_accepted',
        'assetId', v_asset_id,
        'generationRunId', null,
        'activated', false
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'code', 'accepted',
    'assetId', v_asset_id,
    'generationRunId', v_run_id,
    'activated', false
  );
end;
$$;

revoke all on function public.accept_vibode_cleanup_history(uuid, uuid, text, integer, integer, text, text, text, double precision, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_vibode_cleanup_history(uuid, uuid, text, integer, integer, text, text, text, double precision, uuid)
  to service_role;

commit;
