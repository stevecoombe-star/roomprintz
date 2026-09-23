-- PI-5F3A: Partner catalog commercial patch.
--
-- Updates current commercial metadata only.
-- Scene geometry remains frozen to SceneObject.assetId.
-- Commercial display remains current-state by productId/variantId.
-- Does not mutate Assets, current_asset_id, Scene Objects, or identities.
-- PI-5D2B remains the only Variant Asset retarget path.
-- Omission means no change. Patch-only; no snapshot deactivation.

begin;

set constraints public.vibode_stage_products_default_variant_fkey deferred;

do $$
begin
  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-coffee-table-walnut'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DEMO-COFFEE-TABLE-WALNUT'
      and products.partner_id = 'partner-demo-furniture-co'
      and variants.variant_id is distinct from 'var-demo-furniture-co-demo-coffee-table-walnut'
  ) then
    raise exception 'SKU already exists for partner';
  end if;
end $$;

do $$
declare
  updated integer;
begin
  update public.vibode_stage_products
  set
    image_url = 'https://example.test/images/demo-coffee-table-f3a.jpg',
    product_url = 'https://example.test/products/demo-coffee-table?ref=pi5f3a'
  where
    product_id = 'prod-demo-furniture-co-demo-coffee-table'
    and partner_id = 'partner-demo-furniture-co'
    and source = 'partner_catalog'
    and image_url is not distinct from 'https://example.test/images/demo-coffee-table.jpg'
    and product_url is not distinct from 'https://example.test/products/demo-coffee-table';
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
    name = 'Demo Pedestal Side Table',
    price_amount = 199
  where
    product_id = 'prod-demo-furniture-co-demo-side-table'
    and partner_id = 'partner-demo-furniture-co'
    and source = 'partner_catalog'
    and name is not distinct from 'Demo Side Table'
    and price_amount is not distinct from 189;
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
    price_amount = 449
  where
    variant_id = 'var-demo-furniture-co-demo-coffee-table-black'
    and product_id = 'prod-demo-furniture-co-demo-coffee-table'
    and price_amount is not distinct from 429;
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
    price_amount = 199
  where
    variant_id = 'var-demo-furniture-co-demo-side-table-natural'
    and product_id = 'prod-demo-furniture-co-demo-side-table'
    and price_amount is not distinct from 189;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'STALE_SYNC';
  end if;
end $$;

insert into public.vibode_stage_variants (
  variant_id,
  product_id,
  current_asset_id,
  finish_label,
  sku,
  price_amount,
  price_currency,
  product_url
) values (
  'var-demo-furniture-co-demo-coffee-table-walnut',
  'prod-demo-furniture-co-demo-coffee-table',
  'afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1',
  'Walnut',
  'DEMO-COFFEE-TABLE-WALNUT',
  439,
  'USD',
  null
);

delete from public.vibode_stage_product_collections
where product_id = 'prod-demo-furniture-co-demo-lounge-chair'
  and collection_id = 'col-demo-furniture-co-demo-living-room';

commit;
