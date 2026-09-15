-- PI-5E2: additional Variant registration.
--
-- Inserts one Variant for an existing Product.
-- Does not mutate Product, Asset, Collection, or Scene Object rows.
-- Does not change the Product default Variant.

begin;

do $$
begin
  if not exists (
    select 1
    from public.vibode_stage_products
    where product_id = 'prod-vibode-studio-side-table'
      and status = 'active'
  ) then
    raise exception 'Product is missing or not active';
  end if;

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
    from public.vibode_stage_variants
    where variant_id = 'var-vibode-studio-side-table-black'
  ) then
    raise exception 'Variant already exists';
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
  'var-vibode-studio-side-table-black',
  'prod-vibode-studio-side-table',
  'afc-v2-runtime/test-fixtures/pi5d2-side-table',
  'Black',
  'VBD-STUDIO-SIDE-TABLE-BLACK',
  495,
  'USD',
  null
);

commit;
