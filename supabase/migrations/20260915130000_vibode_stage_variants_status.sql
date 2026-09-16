-- PI-5F3B: Variant commercial availability status.
--
-- Existing rows become active via the column default.
-- Frozen F1/F2/F3A INSERT SQL remains valid without edits.
-- Filename uses variants_status so it is not classified as a PI-5D2B
-- association migration (those use vibode_stage_variant_<slug>).
-- Does not mutate Products, Assets, Scene Objects, or identities.

begin;

alter table public.vibode_stage_variants
  add column status text not null default 'active';

alter table public.vibode_stage_variants
  add constraint vibode_stage_variants_status_closed
  check (status in ('active', 'inactive'));

commit;
