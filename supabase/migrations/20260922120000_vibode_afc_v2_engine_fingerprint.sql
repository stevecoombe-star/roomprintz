-- AFD-1B: per-generation engine fingerprint and terminal historical freeze.
--
-- engine_fingerprint is AFC generation evidence, not diagnostic metadata.
-- Newly created generations always persist a baseline fingerprint at insert.
-- Historical rows stay NULL: unknown engine identity must remain unknown.
-- Do not backfill using today's constants.
--
-- Terminal immutability is based on OLD.status. running → ready|failed may
-- still write completion evidence, including tiled.readerVersion fill.
-- Once OLD.status is ready or failed, historical evidence cannot mutate.
-- DELETE is intentionally not protected so room/user cascade still works.
--
-- parent_generation_id, activation, and current_afc_generation_id semantics
-- are unchanged. This migration does not touch diagnostic session tables.

begin;

alter table public.vibode_afc_generations
  add column if not exists engine_fingerprint jsonb null;

alter table public.vibode_afc_generations
  drop constraint if exists vibode_afc_generations_engine_fingerprint_object;

alter table public.vibode_afc_generations
  add constraint vibode_afc_generations_engine_fingerprint_object
    check (
      engine_fingerprint is null
      or jsonb_typeof(engine_fingerprint) = 'object'
    );

comment on column public.vibode_afc_generations.engine_fingerprint is
  'AFC engine/build identity for this generation. Required for newly created rows. Historical rows remain null.';

create or replace function public.vibode_afc_generations_protect_authority()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.lineage_seq is distinct from old.lineage_seq
    or new.room_id is distinct from old.room_id
    or new.user_id is distinct from old.user_id
    or new.run_id is distinct from old.run_id
    or new.parent_generation_id is distinct from old.parent_generation_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'AFC generation identity is immutable';
  end if;

  if old.status in ('ready', 'failed') then
    if new.status is distinct from old.status
      or new.engine_fingerprint is distinct from old.engine_fingerprint
      or new.production_authority is distinct from old.production_authority
      or new.intent is distinct from old.intent
      or new.original_sha256 is distinct from old.original_sha256
      or new.original_decoded_width is distinct from old.original_decoded_width
      or new.original_decoded_height is distinct from old.original_decoded_height
      or new.original_byte_count is distinct from old.original_byte_count
      or new.original_mime_type is distinct from old.original_mime_type
      or new.original_orientation is distinct from old.original_orientation
      or new.empty_sha256 is distinct from old.empty_sha256
      or new.empty_decoded_width is distinct from old.empty_decoded_width
      or new.empty_decoded_height is distinct from old.empty_decoded_height
      or new.empty_byte_count is distinct from old.empty_byte_count
      or new.empty_mime_type is distinct from old.empty_mime_type
      or new.empty_orientation is distinct from old.empty_orientation
      or new.empty_storage_bucket is distinct from old.empty_storage_bucket
      or new.empty_storage_path is distinct from old.empty_storage_path
      or new.empty_artifact_source is distinct from old.empty_artifact_source
      or new.tiled_sha256 is distinct from old.tiled_sha256
      or new.tiled_decoded_width is distinct from old.tiled_decoded_width
      or new.tiled_decoded_height is distinct from old.tiled_decoded_height
      or new.tiled_byte_count is distinct from old.tiled_byte_count
      or new.tiled_mime_type is distinct from old.tiled_mime_type
      or new.tiled_orientation is distinct from old.tiled_orientation
      or new.tiled_storage_bucket is distinct from old.tiled_storage_bucket
      or new.tiled_storage_path is distinct from old.tiled_storage_path
      or new.tiled_artifact_source is distinct from old.tiled_artifact_source
      or new.tiled_cache_key is distinct from old.tiled_cache_key
      or new.tiled_force_regeneration is distinct from old.tiled_force_regeneration
      or new.frame_width is distinct from old.frame_width
      or new.frame_height is distinct from old.frame_height
      or new.diagnostic_payload is distinct from old.diagnostic_payload
      or new.failure_reason is distinct from old.failure_reason
      or new.provider_provenance is distinct from old.provider_provenance
      or new.metric_status is distinct from old.metric_status
      or new.collision_status is distinct from old.collision_status
      or new.completed_at is distinct from old.completed_at
    then
      raise exception 'AFC generation historical evidence is immutable once terminal';
    end if;
  end if;

  return new;
end;
$$;

commit;
