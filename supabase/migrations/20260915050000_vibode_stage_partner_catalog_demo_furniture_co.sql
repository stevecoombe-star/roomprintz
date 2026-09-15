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

  if exists (
    select 1
    from public.vibode_stage_collections
    where collection_id = 'col-demo-furniture-co-demo-living-room'
  ) then
    raise exception 'Collection already exists';
  end if;

  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/test-fixtures/pi4a-sofa'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/test-fixtures/pi5d-lounge-chair'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  if exists (
    select 1
    from public.vibode_stage_products
    where product_id = 'prod-demo-furniture-co-demo-sofa'
  ) then
    raise exception 'Product already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_products
    where product_id = 'prod-demo-furniture-co-demo-lounge-chair'
  ) then
    raise exception 'Product already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-sofa-natural'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-sofa-stone'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-demo-furniture-co-demo-lounge-chair-natural'
  ) then
    raise exception 'Variant already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DFC-SOFA-01'
      and products.partner_id = 'partner-demo-furniture-co'
  ) then
    raise exception 'SKU already exists for partner';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DFC-SOFA-02'
      and products.partner_id = 'partner-demo-furniture-co'
  ) then
    raise exception 'SKU already exists for partner';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants variants
    join public.vibode_stage_products products
      on products.product_id = variants.product_id
    where variants.sku = 'DFC-CHAIR-01'
      and products.partner_id = 'partner-demo-furniture-co'
  ) then
    raise exception 'SKU already exists for partner';
  end if;
end $$;

insert into public.vibode_stage_partners (
  partner_id,
  name,
  slug,
  status,
  website_url,
  logo_url
)
select
  'partner-demo-furniture-co',
  'Demo Furniture Co.',
  'demo-furniture-co',
  'active',
  'https://example.test',
  null
where not exists (
  select 1
  from public.vibode_stage_partners
  where partner_id = 'partner-demo-furniture-co'
);

insert into public.vibode_stage_collections (
  collection_id,
  name,
  owner,
  partner_name,
  partner_id,
  status,
  sort_order
) values (
  'col-demo-furniture-co-demo-living-room',
  'Demo Living Room',
  'partner',
  'Demo Furniture Co.',
  'partner-demo-furniture-co',
  'active',
  3
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
  'prod-demo-furniture-co-demo-sofa',
  'Demo Sofa',
  'Demo Furniture Co.',
  'Demo Furniture Co.',
  'https://example.test/images/demo-sofa.jpg',
  'https://example.test/products/demo-sofa?ref=stage',
  1299,
  'USD',
  'living-room',
  'sofas',
  'partner_catalog',
  'partner-demo-furniture-co',
  'var-demo-furniture-co-demo-sofa-natural',
  'active',
  4
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
  'prod-demo-furniture-co-demo-lounge-chair',
  'Demo Lounge Chair',
  'Demo Furniture Co.',
  'Demo Furniture Co.',
  'https://example.test/images/demo-lounge-chair.jpg',
  'https://example.test/products/demo-lounge-chair',
  649,
  'USD',
  'living-room',
  'chairs',
  'partner_catalog',
  'partner-demo-furniture-co',
  'var-demo-furniture-co-demo-lounge-chair-natural',
  'active',
  5
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
    'var-demo-furniture-co-demo-sofa-natural',
    'prod-demo-furniture-co-demo-sofa',
    'afc-v2-runtime/test-fixtures/pi4a-sofa',
    'Natural oak',
    'DFC-SOFA-01',
    1299,
    'USD',
    null
  ),
  (
    'var-demo-furniture-co-demo-sofa-stone',
    'prod-demo-furniture-co-demo-sofa',
    'afc-v2-runtime/test-fixtures/pi4a-sofa',
    'Stone linen',
    'DFC-SOFA-02',
    1399,
    'USD',
    null
  ),
  (
    'var-demo-furniture-co-demo-lounge-chair-natural',
    'prod-demo-furniture-co-demo-lounge-chair',
    'afc-v2-runtime/test-fixtures/pi5d-lounge-chair',
    'Natural oak',
    'DFC-CHAIR-01',
    649,
    'USD',
    null
  );

insert into public.vibode_stage_product_collections (
  product_id,
  collection_id,
  sort_order
) values
  (
    'prod-demo-furniture-co-demo-sofa',
    'col-demo-furniture-co-demo-living-room',
    0
  ),
  (
    'prod-demo-furniture-co-demo-lounge-chair',
    'col-demo-furniture-co-demo-living-room',
    1
  );

commit;
