-- PI-5F3B: Partner catalog availability patch.
--
-- Explicit Product/Variant deactivate and reactivate only.
-- Scene geometry remains frozen to SceneObject.assetId.
-- Commercial display remains current-state by productId/variantId.
-- Inactive identities remain resolvable. No hard deletes.
-- Does not mutate Assets, current_asset_id, Scene Objects, or identities.
-- PI-5D2B remains the only Variant Asset retarget path.
-- Omission means no change. Patch-only; no snapshot deactivation.

begin;

set constraints public.vibode_stage_products_default_variant_fkey deferred;

do $$
declare
  updated integer;
begin
  update public.vibode_stage_products
  set
    status = 'inactive'
  where
    product_id = 'prod-demo-furniture-co-demo-sofa'
    and partner_id = 'partner-demo-furniture-co'
    and source = 'partner_catalog'
    and status = 'active';
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'STALE_SYNC';
  end if;
end $$;

do $$
declare
  updated integer;
begin
  update public.vibode_stage_variants
  set
    status = 'inactive'
  where
    variant_id = 'var-demo-furniture-co-demo-coffee-table-black'
    and product_id = 'prod-demo-furniture-co-demo-coffee-table'
    and status = 'active'
    and exists (
      select 1
      from public.vibode_stage_products products
      where products.product_id = 'prod-demo-furniture-co-demo-coffee-table'
        and products.partner_id = 'partner-demo-furniture-co'
        and products.source = 'partner_catalog'
    );
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'STALE_SYNC';
  end if;
end $$;

commit;
