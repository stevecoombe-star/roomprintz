-- PI-5D2B: Variant → current Asset association.
--
-- Updates exactly one Variant.current_asset_id.
-- Does not insert Assets, Products, or Collections.
-- Existing Scene Objects are not rewritten.

begin;

do $$
declare
  target_count integer;
begin
  -- Verify target Asset exists and is ready.
  if not exists (
    select 1
    from public.vibode_stage_assets
    where asset_id = 'afc-v2-runtime/test-fixtures/pi5d2-side-table'
      and status = 'ready'
  ) then
    raise exception 'Target Asset is missing or not ready';
  end if;

  -- Verify exact Product/Variant row exists.
  select count(*)
  into target_count
  from public.vibode_stage_variants
  where variant_id = 'var-vibode-studio-settee-default'
    and product_id = 'prod-vibode-studio-settee';

  if target_count <> 1 then
    raise exception 'Expected exactly one matching Variant';
  end if;

  update public.vibode_stage_variants
  set current_asset_id = 'afc-v2-runtime/test-fixtures/pi5d2-side-table'
  where variant_id = 'var-vibode-studio-settee-default'
    and product_id = 'prod-vibode-studio-settee';
end $$;

commit;
