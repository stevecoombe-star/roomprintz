-- PARTNER-UX-11: Partner Portal catalog manual order.
--
-- Manual order already lives on vibode_stage_products.sort_order. Catalog
-- reads sort by that column, then product_id. This migration does not invent
-- a second position column and does not touch variant or collection order.
--
-- Existing products keep that sequence. Where a partner has tied sort_order
-- values, those ties are expanded in the current visible order
-- (sort_order, product_id) so each product has an explicit integer. A
-- sequence that is already strictly increasing is left unchanged, which
-- keeps seeded partner bands such as 4,5,6,7 in place.
--
-- The reorder function writes one partner's full sequence in a single
-- transaction. It reuses the current sort_order slots, made strictly
-- increasing, and refuses duplicates, foreign ids, and partial lists.

begin;

with recursive ordered as (
  select
    product_id,
    partner_id,
    sort_order,
    row_number() over (
      partition by partner_id
      order by sort_order, product_id
    ) as rn
  from public.vibode_stage_products
  where source = 'partner_catalog'
    and partner_id is not null
),
expanded as (
  select
    product_id,
    partner_id,
    rn,
    sort_order as assigned
  from ordered
  where rn = 1
  union all
  select
    incoming.product_id,
    incoming.partner_id,
    incoming.rn,
    case
      when incoming.sort_order > previous.assigned then incoming.sort_order
      else previous.assigned + 1
    end as assigned
  from ordered as incoming
  join expanded as previous
    on previous.partner_id = incoming.partner_id
   and incoming.rn = previous.rn + 1
)
update public.vibode_stage_products as products
set sort_order = expanded.assigned
from expanded
where products.product_id = expanded.product_id
  and products.source = 'partner_catalog'
  and products.partner_id = expanded.partner_id
  and products.sort_order is distinct from expanded.assigned;

create or replace function public.vibode_stage_reorder_partner_catalog(
  p_partner_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id text;
  v_owned integer;
  v_items integer;
  v_distinct integer;
  v_updated integer;
begin
  v_partner_id := nullif(btrim(p_partner_id), '');
  if v_partner_id is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_order';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_partner_id, 0));

  select count(*) into v_items
  from jsonb_array_elements(p_items) as item;

  select count(distinct item->>'productId') into v_distinct
  from jsonb_array_elements(p_items) as item;

  if v_items <> v_distinct then
    raise exception 'duplicate_product';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where nullif(btrim(item->>'productId'), '') is null
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

  select count(*) into v_owned
  from public.vibode_stage_products
  where partner_id = v_partner_id
    and source = 'partner_catalog';

  if v_owned <> v_items then
    raise exception 'incomplete_order';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where not exists (
      select 1
      from public.vibode_stage_products as products
      where products.product_id = item->>'productId'
        and products.partner_id = v_partner_id
        and products.source = 'partner_catalog'
    )
  ) then
    raise exception 'unknown_product';
  end if;

  update public.vibode_stage_products as products
  set sort_order = (item->>'sortOrder')::integer
  from jsonb_array_elements(p_items) as item
  where products.product_id = item->>'productId'
    and products.partner_id = v_partner_id
    and products.source = 'partner_catalog';

  get diagnostics v_updated = row_count;
  if v_updated <> v_owned then
    raise exception 'unknown_product';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.vibode_stage_reorder_partner_catalog(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.vibode_stage_reorder_partner_catalog(text, jsonb)
  to service_role;

commit;
