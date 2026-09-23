-- PI-5G5A follow-up: Partner Portal GLB intake ceiling 50 MiB.
--
-- Historical 20260918100000_vibode_stage_partner_asset_intakes.sql remains
-- the 25 MiB creation. Do not rewrite that file.
-- Certified F2A/D2A default FURNITURE_ASSET_INTAKE_MAX_BYTES stays 25 MiB.
-- This raises only the Partner Portal intake table CHECK and the private
-- vibode-stage-assets bucket file_size_limit.

begin;

update storage.buckets
set file_size_limit = 52428800
where id = 'vibode-stage-assets';

alter table public.vibode_stage_partner_asset_intakes
  drop constraint vibode_stage_partner_asset_intakes_byte_size_positive;

alter table public.vibode_stage_partner_asset_intakes
  add constraint vibode_stage_partner_asset_intakes_byte_size_positive
    check (byte_size > 0 and byte_size <= 52428800);

commit;
