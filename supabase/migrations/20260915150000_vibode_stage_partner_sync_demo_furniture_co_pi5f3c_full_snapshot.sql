-- PI-5F3C: Partner catalog snapshot sync.
--
-- Full Partner desired commercial state. Presence is active.
-- Omission within full_partner_catalog scope deactivates Product/Variant.
-- Partner status is availability only; no Product/Variant cascade.
-- Present Collections exact-sync membership. Omitted Collections unchanged.
-- Scene geometry remains frozen to SceneObject.assetId.
-- Inactive identities remain resolvable. No hard deletes.
-- Does not mutate Assets, current_asset_id, Scene Objects, or identities.
-- PI-5D2B remains the only Variant Asset retarget path.
-- Snapshot authority may reactivate identities previously patched inactive.
-- Collection retirement and Partner metadata mutation remain deferred.

begin;

set constraints public.vibode_stage_products_default_variant_fkey deferred;

do $$
declare
  updated integer;
begin
  update public.vibode_stage_variants
  set
    price_amount = 459
  where
    variant_id = 'var-demo-furniture-co-demo-coffee-table-black'
    and product_id = 'prod-demo-furniture-co-demo-coffee-table'
    and price_amount is not distinct from 449;
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
    status = 'active'
  where
    variant_id = 'var-demo-furniture-co-demo-coffee-table-black'
    and product_id = 'prod-demo-furniture-co-demo-coffee-table'
    and status = 'inactive'
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

do $$
declare
  updated integer;
begin
  update public.vibode_stage_products
  set
    status = 'active'
  where
    product_id = 'prod-demo-furniture-co-demo-sofa'
    and partner_id = 'partner-demo-furniture-co'
    and source = 'partner_catalog'
    and status = 'inactive';
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
    variant_id = 'var-demo-furniture-co-demo-coffee-table-walnut'
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

do $$
declare
  updated integer;
begin
  update public.vibode_stage_products
  set
    status = 'inactive'
  where
    product_id = 'prod-demo-furniture-co-demo-lounge-chair'
    and partner_id = 'partner-demo-furniture-co'
    and source = 'partner_catalog'
    and status = 'active';
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'STALE_SYNC';
  end if;
end $$;

commit;
