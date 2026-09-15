-- PI-5D2A: technical furniture Asset insert.
--
-- Inserts Asset metadata only. Does not create Product or Variant records.
-- Does not retarget existing Variants. Existing Scene Objects are not rewritten.

begin;

insert into public.vibode_stage_assets (
  asset_id,
  glb_url,
  authored_width_m,
  authored_height_m,
  authored_depth_m,
  status
) values (
  'afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1',
  '/afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1.glb',
  1.2,
  0.4,
  0.6,
  'ready'
);

commit;
