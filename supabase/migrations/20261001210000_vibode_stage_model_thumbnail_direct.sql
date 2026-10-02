-- PARTNER-UX-8A: drop the model-thumbnail worker queue.
--
-- The original table migration stays as applied. This follow-up removes
-- claim, lease, and retry columns that only existed for a background worker.
-- A stored thumbnail is the object path plus its source identity.

begin;

drop function if exists public.claim_next_vibode_stage_model_thumbnail();
drop function if exists public.fail_vibode_stage_model_thumbnail(text, text, text, text, boolean);
drop function if exists public.publish_vibode_stage_model_thumbnail(text, text, text, text);

drop index if exists public.vibode_stage_model_thumbnails_claim_nonce_uidx;
drop index if exists public.vibode_stage_model_thumbnails_due_idx;

alter table public.vibode_stage_model_thumbnails
  drop constraint if exists vibode_stage_model_thumbnails_status_closed,
  drop constraint if exists vibode_stage_model_thumbnails_attempt_bounds,
  drop constraint if exists vibode_stage_model_thumbnails_ready_complete;

alter table public.vibode_stage_model_thumbnails
  drop column if exists status,
  drop column if exists attempt_count,
  drop column if exists not_before,
  drop column if exists claimed_at,
  drop column if exists claim_expires_at,
  drop column if exists claim_nonce;

alter table public.vibode_stage_model_thumbnails
  drop constraint if exists vibode_stage_model_thumbnails_stored_complete;

alter table public.vibode_stage_model_thumbnails
  add constraint vibode_stage_model_thumbnails_stored_complete
  check (
    (
      storage_bucket is null
      and storage_path is null
    )
    or (
      storage_bucket = 'vibode-thumbnails'
      and storage_path is not null
      and source_sha256 is not null
      and generated_at is not null
    )
  );

commit;
