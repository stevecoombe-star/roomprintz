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
  'afc-v2-runtime/test-fixtures/pi5d2-side-table',
  '/afc-v2-runtime/test-fixtures/pi5d2-side-table.glb',
  0.55,
  0.46,
  0.52,
  'ready'
);

commit;
