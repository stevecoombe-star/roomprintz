-- PARTNER-UX-8B: replace the thumbnail path check.
--
-- PostgreSQL compiles a bound quantifier only when the check runs, and
-- rejects any bound above 255. The applied pattern {1,480} therefore
-- failed every thumbnail upsert with:
--   invalid regular expression: invalid repetition count(s)
--
-- The character set, the ban on "..", and the 480-character middle
-- segment stay. The length cap is a char_length check instead of a
-- bound quantifier. {64} remains, because 64 is within the limit.

begin;

alter table public.vibode_stage_model_thumbnails
  drop constraint if exists vibode_stage_model_thumbnails_path_safe;

alter table public.vibode_stage_model_thumbnails
  add constraint vibode_stage_model_thumbnails_path_safe
  check (
    storage_path is null
    or (
      storage_path ~ '^models/[A-Za-z0-9._/-]+/[a-f0-9]{64}\.webp$'
      and position('..' in storage_path) = 0
      and char_length(storage_path) <= 557
    )
  );

commit;
