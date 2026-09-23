-- PI-5F1: Partner catalog batch import.
--
-- Inserts one Partner (if absent), partner Collections, Products,
-- default Variants, additional Variants, and memberships.
-- Does not mutate technical Asset rows.
-- Does not rewrite Scene Objects.
-- Does not retarget existing Variants.
-- Does not write curated commercial seed or association maps.

begin;

set constraints public.vibode_stage_products_default_variant_fkey deferred;

do $$
begin
  if exists (
    select 1
    from public.vibode_stage_partners
    where partner_id = 'partner-demo-furniture-co'
      and slug is distinct from 'demo-furniture-co'
  ) then
    raise exception 'PARTNER_ID_CONFLICT';
  end if;

  if exists (
    select 1
    from public.vibode_stage_partners
    where slug = 'demo-furniture-co'
      and partner_id is distinct from 'partner-demo-furniture-co'
  ) then
    raise exception 'PARTNER_SLUG_CONFLICT';
  end if;

  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/partners/demo-furniture-co/demo-side-table-v1'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  if exists (
    select 1
    from public.vibode_stage_products
    where product_id = 'prod-demo-furniture-co-demo-coffee-table'
  ) then
    raise exception 'Product already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_products
    where product_id = 'prod-demo-furniture-co-demo-side-table'
  ) then
    raise exception 'Product already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-coffee-table-natural'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-coffee-table-black'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-side-table-natural'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DFC-COFFEE-01'
      and products.partner_id = 'partner-demo-furniture-co'
  ) then
    raise exception 'SKU already exists for partner';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DFC-COFFEE-02'
      and products.partner_id = 'partner-demo-furniture-co'
  ) then
    raise exception 'SKU already exists for partner';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DFC-SIDE-01'
      and products.partner_id = 'partner-demo-furniture-co'
  ) then
    raise exception 'SKU already exists for partner';
  end if;
end $$;

-- Partner partner-demo-furniture-co already exists with matching identity.

insert into public.vibode_stage_products (
  product_id,
  name,
  brand,
  retailer,
  image_url,
  product_url,
  price_amount,
  price_currency,
  category_id,
  subcategory_id,
  source,
  partner_id,
  default_variant_id,
  status,
  sort_order
) values (
  'prod-demo-furniture-co-demo-coffee-table',
  'Demo Coffee Table',
  'Demo Furniture Co.',
  'Demo Furniture Co.',
  'https://example.test/images/demo-coffee-table.jpg',
  'https://example.test/products/demo-coffee-table',
  399,
  'USD',
  'living-room',
  'coffee-tables',
  'partner_catalog',
  'partner-demo-furniture-co',
  'var-demo-furniture-co-demo-coffee-table-natural',
  'active',
  6
);

insert into public.vibode_stage_products (
  product_id,
  name,
  brand,
  retailer,
  image_url,
  product_url,
  price_amount,
  price_currency,
  category_id,
  subcategory_id,
  source,
  partner_id,
  default_variant_id,
  status,
  sort_order
) values (
  'prod-demo-furniture-co-demo-side-table',
  'Demo Side Table',
  'Demo Furniture Co.',
  'Demo Furniture Co.',
  'https://example.test/images/demo-side-table.jpg',
  'https://example.test/products/demo-side-table',
  189,
  'USD',
  'living-room',
  'side-tables',
  'partner_catalog',
  'partner-demo-furniture-co',
  'var-demo-furniture-co-demo-side-table-natural',
  'active',
  7
);

insert into public.vibode_stage_variants (
  variant_id,
  product_id,
  current_asset_id,
  finish_label,
  sku,
  price_amount,
  price_currency,
  product_url
) values
  (
    'var-demo-furniture-co-demo-coffee-table-natural',
    'prod-demo-furniture-co-demo-coffee-table',
    'afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1',
    'Natural',
    'DFC-COFFEE-01',
    399,
    'USD',
    null
  ),
  (
    'var-demo-furniture-co-demo-coffee-table-black',
    'prod-demo-furniture-co-demo-coffee-table',
    'afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1',
    'Black',
    'DFC-COFFEE-02',
    429,
    'USD',
    null
  ),
  (
    'var-demo-furniture-co-demo-side-table-natural',
    'prod-demo-furniture-co-demo-side-table',
    'afc-v2-runtime/partners/demo-furniture-co/demo-side-table-v1',
    'Natural',
    'DFC-SIDE-01',
    189,
    'USD',
    null
  );

insert into public.vibode_stage_product_collections (
  product_id,
  collection_id,
  sort_order
) values
  (
    'prod-demo-furniture-co-demo-coffee-table',
    'col-demo-furniture-co-demo-living-room',
    0
  ),
  (
    'prod-demo-furniture-co-demo-side-table',
    'col-demo-furniture-co-demo-living-room',
    1
  );

commit;
