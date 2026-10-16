-- HARMONIZE-3B1A: durable History publication for a succeeded Harmonize job.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.
--
-- Additive only. It does not rewrite provider contact, claim, or complete.
-- It does not insert or update vibode_3d_scenes or any AFC generation row.
--
-- scene_objects is the persisted canonical objects_json from vibode_3d_scenes
-- at enqueue: automatic certified-camera coordinates. It is not the
-- manual-perspective effective coordinates that the Harmonize scene hash uses.
-- Publication compares it to the stored scene row with jsonb equality.
-- Those fields can be filled only while the job is still queued and pending,
-- so a later edit of the live scene cannot be stamped onto the capture.
--
-- Rows that already exist become history_state unavailable without an UPDATE.
-- The immutability trigger does not run, and no room, scene, or provider
-- field is read. Inserts after the default change are pending.
--
-- This migration does not change enqueue. The later enqueue writer must
-- insert backdrop_kind and canonical scene_objects in the same INSERT that
-- creates the queued pending job. Deploy that writer before any History
-- recovery sweep. A succeeded job that still lacks either value is marked
-- unavailable on the first publication attempt and is not sent to the
-- provider again.

begin;

alter table public.vibode_harmonize_generations
  add column history_state text not null default 'unavailable',
  add column output_asset_id uuid null,
  add column backdrop_kind text null,
  add column scene_objects jsonb null;

alter table public.vibode_harmonize_generations
  alter column history_state set default 'pending';

alter table public.vibode_harmonize_generations
  add constraint vibode_harmonize_history_state_closed
    check (history_state in ('pending', 'published', 'unavailable')),
  add constraint vibode_harmonize_backdrop_kind_closed
    check (
      backdrop_kind is null
      or backdrop_kind in ('afc_empty', 'afc_original', 'room_asset')
    ),
  add constraint vibode_harmonize_scene_objects_array
    check (
      scene_objects is null
      or (
        jsonb_typeof(scene_objects) = 'array'
        and jsonb_array_length(scene_objects) <= 32
      )
    ),
  add constraint vibode_harmonize_output_asset_id_fkey
    foreign key (output_asset_id)
    references public.vibode_room_assets(id)
    on delete set null;

create unique index vibode_harmonize_output_asset_id_uidx
  on public.vibode_harmonize_generations (output_asset_id)
  where output_asset_id is not null;

create index vibode_harmonize_history_pending
  on public.vibode_harmonize_generations (completed_at)
  where status = 'succeeded'
    and history_state = 'pending'
    and backdrop_kind is not null
    and scene_objects is not null
    and output_sha256 is not null
    and output_path is not null
    and output_bucket is not null
    and output_mime = 'image/jpeg'
    and output_width is not null
    and output_height is not null;

comment on column public.vibode_harmonize_generations.history_state is
  'pending: a new job may still be published. published: History was committed and is not republished. unavailable: legacy or irrecoverable capture; recovery does not revisit it.';

comment on column public.vibode_harmonize_generations.scene_objects is
  'Canonical vibode_3d_scenes.objects_json frozen at enqueue. Automatic certified-camera coordinates, not manual-perspective display coordinates.';

comment on column public.vibode_harmonize_generations.backdrop_kind is
  'Identity of the viewport background hashed at enqueue: afc_empty, afc_original, or room_asset.';

alter table public.vibode_room_assets
  add column harmonize_job_id uuid null,
  add column ai_generated boolean not null default false;

alter table public.vibode_room_assets
  add constraint vibode_room_assets_harmonize_job_id_fkey
    foreign key (harmonize_job_id)
    references public.vibode_harmonize_generations(id)
    on delete set null;

create unique index vibode_room_assets_harmonize_job_id_uidx
  on public.vibode_room_assets (harmonize_job_id)
  where harmonize_job_id is not null;

alter table public.vibode_generation_runs
  add column harmonize_job_id uuid null;

alter table public.vibode_generation_runs
  add constraint vibode_generation_runs_harmonize_job_id_fkey
    foreign key (harmonize_job_id)
    references public.vibode_harmonize_generations(id)
    on delete set null;

create unique index vibode_generation_runs_harmonize_job_id_uidx
  on public.vibode_generation_runs (harmonize_job_id)
  where harmonize_job_id is not null;

comment on column public.vibode_generation_runs.harmonize_job_id is
  'One generation run per Harmonize job. Identity is this column, not request JSON.';

create table public.vibode_user_acknowledgements (
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledgement_key text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, acknowledgement_key),
  constraint vibode_user_acknowledgements_key_closed
    check (acknowledgement_key = 'harmonize_ai_disclosure_v1')
);

comment on table public.vibode_user_acknowledgements is
  'Durable per-user disclosure acknowledgements. The first key is harmonize_ai_disclosure_v1. Rows are not updated or deleted by the owner.';

alter table public.vibode_user_acknowledgements enable row level security;

revoke all on table public.vibode_user_acknowledgements from public, anon, authenticated;
grant select, insert on table public.vibode_user_acknowledgements to authenticated;
grant select, insert, update, delete on table public.vibode_user_acknowledgements to service_role;

create policy vibode_user_acknowledgements_select
on public.vibode_user_acknowledgements
for select
to authenticated
using (auth.uid() = user_id);

create policy vibode_user_acknowledgements_insert
on public.vibode_user_acknowledgements
for insert
to authenticated
with check (
  auth.uid() = user_id
  and acknowledgement_key = 'harmonize_ai_disclosure_v1'
);

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

    raise exception 'harmonize generation is terminal';
  end if;

  return new;
end;
$$;

revoke all on function public.vibode_harmonize_generations_guard() from public, anon, authenticated;

-- The caller is the trusted service. It must already have verified that the
-- private provider JPEG and the copied History JPEG both hash to
-- p_output_sha256. This function cannot see Storage. It rejects a hash that
-- is not the completed job's output_sha256, and it rejects a History path
-- other than the deterministic object for this job.
--
-- Thumbnails and cover URLs are not written here. They remain application
-- work after this transaction commits. A thumbnail failure must not roll
-- this publication back.
create or replace function public.publish_vibode_harmonize_history(
  p_job_id uuid,
  p_output_sha256 text,
  p_history_bucket text,
  p_history_path text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_source_room uuid;
  v_source_user uuid;
  v_stage smallint;
  v_scale double precision;
  v_asset_id uuid;
  v_run_id uuid;
  v_path text;
  v_activated boolean := false;
  v_room_updated integer := 0;
  v_published integer := 0;
  v_unavailable integer := 0;
begin
  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_job.history_state = 'published' then
    select id into v_run_id
    from public.vibode_generation_runs
    where harmonize_job_id = v_job.id;
    return jsonb_build_object(
      'ok', true,
      'code', 'already_published',
      'assetId', v_job.output_asset_id,
      'generationRunId', v_run_id,
      'activated', false
    );
  end if;

  if v_job.history_state = 'unavailable' then
    return jsonb_build_object('ok', false, 'code', 'not_publishable');
  end if;

  if v_job.status <> 'succeeded' then
    return jsonb_build_object('ok', false, 'code', 'not_succeeded');
  end if;

  -- Missing capture cannot be filled after the job leaves queued. This is
  -- permanent. A wrong caller sha, a wrong History path, or a rolled-back
  -- transaction is not: those leave the job pending.
  if v_job.output_sha256 is null
     or v_job.output_path is null
     or v_job.output_bucket is null
     or v_job.output_mime is distinct from 'image/jpeg'
     or v_job.output_width is null
     or v_job.output_height is null
     or v_job.backdrop_kind is null
     or v_job.scene_objects is null
     or jsonb_typeof(v_job.scene_objects) is distinct from 'array'
  then
    update public.vibode_harmonize_generations
      set history_state = 'unavailable',
          updated_at = now()
    where id = v_job.id
      and history_state = 'pending'
      and status = 'succeeded';
    get diagnostics v_unavailable = row_count;
    if v_unavailable <> 1 then
      raise exception 'harmonize history could not record unavailable';
    end if;
    return jsonb_build_object('ok', false, 'code', 'not_publishable');
  end if;

  if p_output_sha256 is distinct from v_job.output_sha256
     or p_output_sha256 !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('ok', false, 'code', 'output_mismatch');
  end if;

  v_path := 'rooms/' || v_job.room_id::text || '/harmonize/' || v_job.id::text || '.jpg';
  if p_history_bucket is distinct from 'vibode-generations' or p_history_path is distinct from v_path then
    return jsonb_build_object('ok', false, 'code', 'invalid_history_path');
  end if;

  if not exists (
    select 1 from public.vibode_rooms
    where id = v_job.room_id and user_id = v_job.user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- STAGE shelf. versionKind in metadata is the lineage label. Do not copy
  -- a STYLE or SETUP stage_number from the source image.
  v_stage := 3;
  if v_job.source_version_id is not null then
    select room_id, user_id
      into v_source_room, v_source_user
    from public.vibode_room_assets
    where id = v_job.source_version_id;
    if not found
       or v_source_room is distinct from v_job.room_id
       or v_source_user is distinct from v_job.user_id
    then
      return jsonb_build_object('ok', false, 'code', 'source_mismatch');
    end if;
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
    harmonize_job_id,
    metadata
  ) values (
    v_job.room_id,
    v_job.user_id,
    'stage_output',
    v_stage,
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
      'source_version_id', v_job.source_version_id,
      'harmonizeJobId', v_job.id
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
    harmonize_job_id,
    completed_at
  ) values (
    v_job.room_id,
    v_job.user_id,
    'harmonize',
    v_stage,
    v_job.source_version_id,
    v_asset_id,
    coalesce(v_job.returned_model_id, v_job.requested_model_id),
    'completed',
    jsonb_build_object('harmonizeJobId', v_job.id),
    jsonb_build_object(
      'bucket', 'vibode-generations',
      'storagePath', v_path,
      'outputSha256', v_job.output_sha256
    ),
    v_job.id,
    now()
  )
  returning id into v_run_id;

  update public.vibode_harmonize_generations
    set history_state = 'published',
        output_asset_id = v_asset_id,
        updated_at = now()
  where id = v_job.id
    and history_state = 'pending'
    and status = 'succeeded';
  get diagnostics v_published = row_count;
  if v_published <> 1 then
    raise exception 'harmonize history publication did not lock the pending job';
  end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'asset_conflict');
  end;

  begin
    if jsonb_typeof(v_job.snapshot->'roomScaleMultiplier') = 'number' then
      v_scale := (v_job.snapshot->>'roomScaleMultiplier')::double precision;
      if v_scale is null or v_scale < 0.25 or v_scale > 2 then
        v_scale := null;
      end if;
    end if;
  exception
    when numeric_value_out_of_range or invalid_text_representation then
      v_scale := null;
  end;

  if v_job.source_version_id is not null and v_scale is not null then
    update public.vibode_rooms
      set active_asset_id = v_asset_id,
          current_stage = v_stage,
          sort_key = now()
    where id = v_job.room_id
      and user_id = v_job.user_id
      and active_asset_id is not distinct from v_job.source_version_id
      and current_afc_generation_id is not distinct from v_job.afc_generation_id
      and room_scale_multiplier = v_scale
      and exists (
        select 1
        from public.vibode_3d_scenes scene
        where scene.room_id = v_job.room_id
          and scene.version_id = v_job.source_version_id
          and scene.user_id = v_job.user_id
          and scene.afc_generation_id = v_job.afc_generation_id
          and scene.objects_json = v_job.scene_objects
      );
    get diagnostics v_room_updated = row_count;
  end if;

  if v_room_updated = 1 then
    update public.vibode_room_assets
      set is_active = false
    where room_id = v_job.room_id
      and user_id = v_job.user_id
      and is_active = true
      and id is distinct from v_asset_id;
    update public.vibode_room_assets
      set is_active = true
    where id = v_asset_id
      and room_id = v_job.room_id
      and user_id = v_job.user_id;
    v_activated := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'published',
    'assetId', v_asset_id,
    'generationRunId', v_run_id,
    'activated', v_activated
  );
end;
$$;

revoke all on function public.publish_vibode_harmonize_history(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_vibode_harmonize_history(uuid, text, text, text) to service_role;

commit;
