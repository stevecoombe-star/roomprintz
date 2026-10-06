-- AFR-4A: generation-scoped manual perspective record.
--
-- manual_perspective is a derived QA correction. It is not automatic AFC
-- evidence. Null means no manual correction has been applied. Null must not
-- be read as a failed settle, an unrealizable camera, or a missing artifact.
--
-- The column stays writable after a generation is ready or failed so Apply
-- can record a later correction. It is intentionally absent from the terminal
-- immutability predicate. settle_decision, camera_realizability_decision,
-- production_authority, and artifact_lineage_decision stay frozen.
--
-- No default, no backfill, no index, no foreign key, and no new grant.
-- Table ownership stays service-role only. RLS stays enabled.
-- The existing BEFORE UPDATE trigger already calls
-- vibode_afc_generations_protect_authority. This migration replaces that
-- function with the same predicate and does not add a second trigger.

begin;

alter table public.vibode_afc_generations
  add column if not exists manual_perspective jsonb null;

alter table public.vibode_afc_generations
  drop constraint if exists vibode_afc_generations_manual_perspective_object;

alter table public.vibode_afc_generations
  add constraint vibode_afc_generations_manual_perspective_object
    check (
      manual_perspective is null
      or jsonb_typeof(manual_perspective) = 'object'
    );

comment on column public.vibode_afc_generations.manual_perspective is
  'Generation-scoped manual source-quad correction applied by an authorized QA user. Null means no manual correction has been applied. Null must not be interpreted as a failed settle, an unrealizable camera, or a missing artifact. The automatic settle, camera-realizability, production authority, and artifact-lineage evidence stay on their own columns. Runtime reads this record as an overlay and does not write those columns. Historical rows are intentionally null.';

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
      or new.metric_decision is distinct from old.metric_decision
      or new.settle_decision is distinct from old.settle_decision
      or new.camera_realizability_decision is distinct from old.camera_realizability_decision
      or new.artifact_lineage_decision is distinct from old.artifact_lineage_decision
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
