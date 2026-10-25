-- REMOVE-2F: publish one deterministic Remove composite into Image History.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.
--
-- The function records an inactive History asset. It does not activate the
-- room, rewrite a scene, or contact a provider. The service uploads the PNG
-- before calling it. A repeated fingerprint returns the existing asset.

begin;

create table public.vibode_remove_edits (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  history_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
  afc_generation_id uuid not null,
  parent_asset_id uuid null references public.vibode_room_assets(id) on delete set null,
  width integer not null,
  height integer not null,
  output_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint vibode_remove_edits_fingerprint_hex check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint vibode_remove_edits_sha_hex check (output_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_remove_edits_dimensions check (width > 0 and height > 0 and width::bigint * height::bigint <= 8000000)
);

create unique index vibode_remove_edits_room_fingerprint_uidx
  on public.vibode_remove_edits (room_id, fingerprint);

alter table public.vibode_remove_edits enable row level security;

revoke all on table public.vibode_remove_edits from public, anon, authenticated;
grant select, insert, update, delete on table public.vibode_remove_edits to service_role;

create or replace function public.publish_vibode_remove_edit(
  p_user_id uuid,
  p_room_id uuid,
  p_fingerprint text,
  p_afc_generation_id uuid,
  p_parent_asset_id uuid,
  p_selected_asset_id uuid,
  p_width integer,
  p_height integer,
  p_output_sha256 text,
  p_storage_path text,
  p_original_sha256 text,
  p_empty_sha256 text,
  p_keep_sha256 text,
  p_coverage_width integer,
  p_coverage_height integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid;
  v_parent uuid;
  v_asset_id uuid;
  v_run_id uuid;
  v_existing uuid;
begin
  if p_user_id is null or p_room_id is null or p_afc_generation_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_output_sha256 is null or p_output_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_keep_sha256 is null or p_keep_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_original_sha256 is null or p_original_sha256 !~ '^[0-9a-f]{64}$'
     or p_empty_sha256 is null or p_empty_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_coverage_width is null or p_coverage_height is null
     or p_coverage_width < 1 or p_coverage_height < 1
     or p_coverage_width::bigint * p_coverage_height::bigint > 8000000 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_parent_asset_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_width is null or p_height is null or p_width < 1 or p_height < 1
     or p_width::bigint * p_height::bigint > 8000000 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_storage_path is distinct from ('rooms/' || p_room_id::text || '/remove/' || p_fingerprint || '.png') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select user_id into v_owner
  from public.vibode_rooms
  where id = p_room_id;
  if v_owner is null or v_owner is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_room_id::text || ':' || p_fingerprint)::bigint);

  select history_asset_id into v_existing
  from public.vibode_remove_edits
  where room_id = p_room_id
    and fingerprint = p_fingerprint;
  if v_existing is not null then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_saved',
      'assetId', v_existing,
      'activated', false
    );
  end if;

  v_parent := null;
  if p_parent_asset_id is not null then
    select id into v_parent
    from public.vibode_room_assets
    where id = p_parent_asset_id
      and room_id = p_room_id
      and user_id = p_user_id;
  end if;
  if v_parent is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
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
      metadata
    ) values (
      p_room_id,
      p_user_id,
      'stage_output',
      3,
      'vibode-generations',
      p_storage_path,
      '',
      p_width,
      p_height,
      'vibode-remove-edit/v2',
      false,
      false,
      jsonb_strip_nulls(jsonb_build_object(
        'versionKind', 'stage',
        'label', 'Remove',
        'removeEditFingerprint', p_fingerprint,
        'source_version_id', v_parent,
        'sourceAfcGenerationId', p_afc_generation_id,
        'sourceRoomId', p_room_id,
        'originalSha256', p_original_sha256,
        'emptySha256', p_empty_sha256,
        'keepAssetId', v_parent,
        'keepSha256', p_keep_sha256,
        'keepWidth', p_width,
        'keepHeight', p_height,
        'coverageWidth', p_coverage_width,
        'coverageHeight', p_coverage_height,
        'selectedAssetId', p_selected_asset_id,
        'compositor', 'vibode-remove-edit/v2',
        'candidateWidth', p_width,
        'candidateHeight', p_height,
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
      completed_at
    ) values (
      p_room_id,
      p_user_id,
      'remove',
      3,
      v_parent,
      v_asset_id,
      'vibode-remove-edit/v2',
      'completed',
      jsonb_build_object(
        'removeEditFingerprint', p_fingerprint,
        'sourceAfcGenerationId', p_afc_generation_id,
        'originalSha256', p_original_sha256,
        'emptySha256', p_empty_sha256,
        'keepAssetId', v_parent,
        'keepSha256', p_keep_sha256,
        'coverageWidth', p_coverage_width,
        'coverageHeight', p_coverage_height
      ),
      jsonb_build_object(
        'bucket', 'vibode-generations',
        'storagePath', p_storage_path,
        'outputSha256', p_output_sha256,
        'width', p_width,
        'height', p_height,
        'label', 'Remove'
      ),
      now()
    )
    returning id into v_run_id;

    insert into public.vibode_remove_edits (
      room_id,
      user_id,
      fingerprint,
      history_asset_id,
      afc_generation_id,
      parent_asset_id,
      width,
      height,
      output_sha256
    ) values (
      p_room_id,
      p_user_id,
      p_fingerprint,
      v_asset_id,
      p_afc_generation_id,
      v_parent,
      p_width,
      p_height,
      p_output_sha256
    );
  exception
    when unique_violation then
      select history_asset_id into v_existing
      from public.vibode_remove_edits
      where room_id = p_room_id
        and fingerprint = p_fingerprint;
      if v_existing is null then
        return jsonb_build_object('ok', false, 'code', 'unavailable');
      end if;
      return jsonb_build_object(
        'ok', true,
        'code', 'already_saved',
        'assetId', v_existing,
        'activated', false
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'code', 'saved',
    'assetId', v_asset_id,
    'generationRunId', v_run_id,
    'activated', false
  );
end;
$$;

revoke all on function public.publish_vibode_remove_edit(
  uuid, uuid, text, uuid, uuid, uuid, integer, integer, text, text, text, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.publish_vibode_remove_edit(
  uuid, uuid, text, uuid, uuid, uuid, integer, integer, text, text, text, text, text, integer, integer
) to service_role;

commit;
