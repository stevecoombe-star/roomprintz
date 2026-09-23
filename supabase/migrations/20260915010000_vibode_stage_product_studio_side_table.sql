-- PI-5E1: Product + default Variant registration.
--
-- Inserts one Product, its default Variant, and Collection membership.
-- Does not mutate technical Asset rows.
-- Does not rewrite Scene Objects.
-- Does not retarget existing Variants.

begin;

set constraints public.vibode_stage_products_default_variant_fkey deferred;

do $$
begin
  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/test-fixtures/pi5d2-side-table'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  if exists (
    select 1
    from public.vibode_stage_products
    where product_id = 'prod-vibode-studio-side-table'
  ) then
    raise exception 'Product already exists';
  end if;

  if exists (
    select 1
    from public.vibode_stage_variants
    where variant_id = 'var-vibode-studio-side-table-default'
  ) then
    raise exception 'Variant already exists';
  end if;
end $$;

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
  default_variant_id,
  status,
  sort_order
) values (
  'prod-vibode-studio-side-table',
  'Studio Side Table',
  'Vibode',
  'Vibode',
  '/vibode-stage/studio-side-table.svg',
  null,
  495,
  'USD',
  'living-room',
  'side-tables',
  'vibode_curated',
  'var-vibode-studio-side-table-default',
  'active',
  3
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
) values (
  'var-vibode-studio-side-table-default',
  'prod-vibode-studio-side-table',
  'afc-v2-runtime/test-fixtures/pi5d2-side-table',
  'Natural oak',
  'VBD-STUDIO-SIDE-TABLE-01',
  495,
  'USD',
  null
);

insert into public.vibode_stage_product_collections (
  product_id,
  collection_id,
  sort_order
) values
  (
    'prod-vibode-studio-side-table',
    'col-vibode-picks',
    3
  );

commit;
