-- PI-5D1: Lounge Chair visualization Asset B.
--
-- Studio Sofa and Studio Settee remain on Asset A (PI-4A sofa GLB).
-- Studio Lounge Chair Variant current_asset_id moves to Asset B.
-- Existing Scene Objects are not rewritten. Product / Variant IDs stay
-- unchanged. This does not alter the PI-5C catalog schema.

begin;

insert into public.vibode_stage_assets (
  asset_id,
  glb_url,
  authored_width_m,
  authored_height_m,
  authored_depth_m,
  status
) values (
  'afc-v2-runtime/test-fixtures/pi5d-lounge-chair',
  '/afc-v2-runtime/test-fixtures/pi5d-lounge-chair.glb',
  0.8,
  0.8,
  0.78,
  'ready'
);

update public.vibode_stage_variants
set current_asset_id = 'afc-v2-runtime/test-fixtures/pi5d-lounge-chair'
where variant_id = 'var-vibode-studio-chair-default'
  and product_id = 'prod-vibode-studio-lounge-chair';

commit;
