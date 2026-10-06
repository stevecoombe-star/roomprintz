-- PARTNER-UX-12: durable manual order for product variants.
--
-- vibode_stage_variants had no position column. Partner Portal listed
-- variants in variant_id order. The shopper selector pinned the default
-- variant and then sorted the rest by variant id. This column is the
-- single manual sequence for both surfaces.
--
-- Existing rows are initialized to that Partner Portal sequence:
-- variant_id ascending within each product, numbered 0..n-1. variant_id
-- is already unique, so the assigned positions are unique. The default
-- variant is not moved to the front.
--
-- Inserts that omit sort_order append after the product's current max.
-- Name A–Z / Z–A are not stored here.

begin;

alter table public.vibode_stage_variants
  add column sort_order integer;

with ranked as (
  select
    variant_id,
    (row_number() over (
      partition by product_id
      order by variant_id
    ) - 1)::integer as assigned
  from public.vibode_stage_variants
)
update public.vibode_stage_variants as variants
set sort_order = ranked.assigned
from ranked
where variants.variant_id = ranked.variant_id
  and variants.sort_order is distinct from ranked.assigned;

alter table public.vibode_stage_variants
  alter column sort_order set not null;

alter table public.vibode_stage_variants
  add constraint vibode_stage_variants_product_sort_key
  unique (product_id, sort_order)
  deferrable initially immediate;

create or replace function public.vibode_stage_variants_assign_sort_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sort_order is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vibode-variant-order:' || new.product_id, 0)
  );

  select coalesce(max(variants.sort_order), -1) + 1
    into new.sort_order
  from public.vibode_stage_variants as variants
  where variants.product_id = new.product_id;

  return new;
end;
$$;

create trigger vibode_stage_variants_assign_sort_order
before insert on public.vibode_stage_variants
for each row
execute function public.vibode_stage_variants_assign_sort_order();

revoke all on function public.vibode_stage_variants_assign_sort_order()
  from public, anon, authenticated;
grant execute on function public.vibode_stage_variants_assign_sort_order()
  to service_role;

create or replace function public.vibode_stage_reorder_partner_product_variants(
  p_partner_id text,
  p_product_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id text;
  v_product_id text;
  v_owned integer;
  v_items integer;
  v_distinct integer;
  v_distinct_orders integer;
  v_updated integer;
begin
  v_partner_id := nullif(btrim(p_partner_id), '');
  v_product_id := nullif(btrim(p_product_id), '');
  if v_partner_id is null
    or v_product_id is null
    or jsonb_typeof(p_items) is distinct from 'array'
  then
    raise exception 'invalid_order';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vibode-variant-order:' || v_product_id, 0)
  );

  set constraints vibode_stage_variants_product_sort_key deferred;

  if not exists (
    select 1
    from public.vibode_stage_products as products
    where products.product_id = v_product_id
      and products.partner_id = v_partner_id
      and products.source = 'partner_catalog'
  ) then
    raise exception 'unknown_product';
  end if;

  select count(*) into v_items
  from jsonb_array_elements(p_items) as item;

  select count(distinct item->>'variantId') into v_distinct
  from jsonb_array_elements(p_items) as item;

  if v_items <> v_distinct then
    raise exception 'duplicate_variant';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where nullif(btrim(item->>'variantId'), '') is null
      or coalesce(item->>'sortOrder', '') !~ '^-?[0-9]+$'
  ) then
    raise exception 'invalid_order';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where (item->>'sortOrder')::numeric > 2147483647
      or (item->>'sortOrder')::numeric < -2147483648
  ) then
    raise exception 'invalid_order';
  end if;

  select count(distinct (item->>'sortOrder')::integer) into v_distinct_orders
  from jsonb_array_elements(p_items) as item;

  if v_distinct_orders <> v_items then
    raise exception 'duplicate_position';
  end if;

  select count(*) into v_owned
  from public.vibode_stage_variants as variants
  where variants.product_id = v_product_id;

  if v_owned <> v_items then
    raise exception 'incomplete_order';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where not exists (
      select 1
      from public.vibode_stage_variants as variants
      where variants.variant_id = item->>'variantId'
        and variants.product_id = v_product_id
    )
  ) then
    raise exception 'unknown_variant';
  end if;

  update public.vibode_stage_variants as variants
  set sort_order = (item->>'sortOrder')::integer
  from jsonb_array_elements(p_items) as item
  where variants.variant_id = item->>'variantId'
    and variants.product_id = v_product_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_owned then
    raise exception 'unknown_variant';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.vibode_stage_reorder_partner_product_variants(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.vibode_stage_reorder_partner_product_variants(text, text, jsonb)
  to service_role;

commit;
