-- PI-5C: durable STAGE Product / Variant / Asset catalog foundation.
--
-- This is the production commercial identity source of truth for STAGE.
-- Identities are stable text IDs (not random UUIDs) so existing Scene
-- Objects that persist productId / variantId / assetId keep resolving.
--
-- Conceptual model:
--   Product → Variants
--   Variant.current_asset_id → current visualization Asset
--   Asset remains independently addressable
--
-- Scene Objects are NOT stored here. They keep their own assetId in
-- vibode_3d_scenes.objects_json. Changing a Variant's current Asset must
-- not rewrite existing Scene Objects.
--
-- This catalog is intentionally separate from:
--   vibode_user_furniture
--   vibode_furniture_collection_items
--   vibode_room_furniture_placements
--   vibode_room_assets
--   vibode_partners / vibode_furniture_partners
--
-- Public/authenticated SELECT of active production records.
-- Mutations remain service-role / privileged. This is not My Furniture.

begin;

create table public.vibode_stage_assets (
  asset_id text primary key,
  glb_url text not null,
  authored_width_m numeric not null,
  authored_height_m numeric not null,
  authored_depth_m numeric not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_assets_asset_id_len
    check (char_length(asset_id) between 1 and 256),
  constraint vibode_stage_assets_glb_url_len
    check (char_length(glb_url) between 1 and 1024),
  constraint vibode_stage_assets_status_closed
    check (status in ('ready', 'unavailable')),
  constraint vibode_stage_assets_authored_width_positive
    check (authored_width_m > 0),
  constraint vibode_stage_assets_authored_height_positive
    check (authored_height_m > 0),
  constraint vibode_stage_assets_authored_depth_positive
    check (authored_depth_m > 0)
);

create table public.vibode_stage_products (
  product_id text primary key,
  name text not null,
  brand text not null,
  retailer text not null,
  image_url text not null,
  product_url text null,
  price_amount numeric null,
  price_currency text not null default 'USD',
  category_id text not null,
  subcategory_id text null,
  source text not null,
  default_variant_id text null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_products_product_id_shape
    check (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint vibode_stage_products_name_len
    check (char_length(name) between 1 and 200),
  constraint vibode_stage_products_source_closed
    check (source in ('vibode_curated', 'partner_catalog', 'user_pasted')),
  constraint vibode_stage_products_status_closed
    check (status in ('active', 'inactive')),
  constraint vibode_stage_products_price_amount_finite
    check (price_amount is null or price_amount >= 0),
  constraint vibode_stage_products_price_currency_len
    check (char_length(price_currency) between 1 and 8)
);

create table public.vibode_stage_variants (
  variant_id text primary key,
  product_id text not null references public.vibode_stage_products(product_id)
    on delete cascade,
  current_asset_id text null references public.vibode_stage_assets(asset_id)
    on delete set null,
  finish_label text null,
  sku text null,
  price_amount numeric null,
  price_currency text null,
  product_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_variants_variant_id_shape
    check (variant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint vibode_stage_variants_price_amount_finite
    check (price_amount is null or price_amount >= 0)
);

create unique index vibode_stage_variants_product_id_variant_id_uidx
  on public.vibode_stage_variants (product_id, variant_id);

create table public.vibode_stage_collections (
  collection_id text primary key,
  name text not null,
  owner text not null,
  partner_name text null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_collections_collection_id_shape
    check (collection_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint vibode_stage_collections_name_len
    check (char_length(name) between 1 and 200),
  constraint vibode_stage_collections_owner_closed
    check (owner in ('vibode', 'partner')),
  constraint vibode_stage_collections_status_closed
    check (status in ('active', 'inactive'))
);

create table public.vibode_stage_product_collections (
  product_id text not null references public.vibode_stage_products(product_id)
    on delete cascade,
  collection_id text not null references public.vibode_stage_collections(collection_id)
    on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, collection_id)
);

create index vibode_stage_products_status_category_idx
  on public.vibode_stage_products (status, category_id, subcategory_id);

create index vibode_stage_products_source_idx
  on public.vibode_stage_products (source);

create index vibode_stage_products_status_sort_idx
  on public.vibode_stage_products (status, sort_order, product_id);

create index vibode_stage_variants_product_id_idx
  on public.vibode_stage_variants (product_id);

create index vibode_stage_variants_current_asset_id_idx
  on public.vibode_stage_variants (current_asset_id);

create index vibode_stage_collections_status_sort_idx
  on public.vibode_stage_collections (status, sort_order, collection_id);

create index vibode_stage_product_collections_collection_id_idx
  on public.vibode_stage_product_collections (collection_id);

create index vibode_stage_assets_status_idx
  on public.vibode_stage_assets (status);

create trigger set_timestamp_vibode_stage_assets
before update on public.vibode_stage_assets
for each row execute function public.set_timestamp();

create trigger set_timestamp_vibode_stage_products
before update on public.vibode_stage_products
for each row execute function public.set_timestamp();

create trigger set_timestamp_vibode_stage_variants
before update on public.vibode_stage_variants
for each row execute function public.set_timestamp();

create trigger set_timestamp_vibode_stage_collections
before update on public.vibode_stage_collections
for each row execute function public.set_timestamp();

-- Certified STAGE fixture parity. Same stable text IDs already persisted
-- on Scene Objects. All three products share the PI-4A sofa visualization
-- Asset; Product identity is not collapsed into Asset identity.

insert into public.vibode_stage_assets (
  asset_id,
  glb_url,
  authored_width_m,
  authored_height_m,
  authored_depth_m,
  status
) values (
  'afc-v2-runtime/test-fixtures/pi4a-sofa',
  '/afc-v2-runtime/test-fixtures/pi4a-sofa.glb',
  2.2,
  0.8,
  0.9,
  'ready'
);

insert into public.vibode_stage_collections (
  collection_id,
  name,
  owner,
  partner_name,
  status,
  sort_order
) values
  ('col-vibode-picks', 'Vibode Picks', 'vibode', null, 'active', 0),
  ('col-small-spaces', 'Small Spaces', 'vibode', null, 'active', 1),
  ('col-modern-living', 'Modern Living', 'vibode', null, 'active', 2);

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
) values
  (
    'prod-vibode-studio-sofa',
    'Studio Sofa',
    'Vibode',
    'Vibode',
    '/vibode-stage/studio-sofa.svg',
    null,
    2495,
    'USD',
    'living-room',
    'sofas',
    'vibode_curated',
    null,
    'active',
    0
  ),
  (
    'prod-vibode-studio-settee',
    'Studio Settee',
    'Vibode',
    'Vibode',
    '/vibode-stage/studio-settee.svg',
    null,
    1895,
    'USD',
    'living-room',
    'sofas',
    'vibode_curated',
    null,
    'active',
    1
  ),
  (
    'prod-vibode-studio-lounge-chair',
    'Studio Lounge Chair',
    'Vibode',
    'Vibode',
    '/vibode-stage/studio-chair.svg',
    null,
    895,
    'USD',
    'living-room',
    'chairs',
    'vibode_curated',
    null,
    'active',
    2
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
    'var-vibode-studio-sofa-default',
    'prod-vibode-studio-sofa',
    'afc-v2-runtime/test-fixtures/pi4a-sofa',
    'Warm oak',
    null,
    2495,
    'USD',
    null
  ),
  (
    'var-vibode-studio-settee-default',
    'prod-vibode-studio-settee',
    'afc-v2-runtime/test-fixtures/pi4a-sofa',
    'Stone linen',
    null,
    1895,
    'USD',
    null
  ),
  (
    'var-vibode-studio-chair-default',
    'prod-vibode-studio-lounge-chair',
    'afc-v2-runtime/test-fixtures/pi4a-sofa',
    'Saddle leather',
    null,
    895,
    'USD',
    null
  );

update public.vibode_stage_products
set default_variant_id = 'var-vibode-studio-sofa-default'
where product_id = 'prod-vibode-studio-sofa';

update public.vibode_stage_products
set default_variant_id = 'var-vibode-studio-settee-default'
where product_id = 'prod-vibode-studio-settee';

update public.vibode_stage_products
set default_variant_id = 'var-vibode-studio-chair-default'
where product_id = 'prod-vibode-studio-lounge-chair';

alter table public.vibode_stage_products
  alter column default_variant_id set not null;

alter table public.vibode_stage_products
  add constraint vibode_stage_products_default_variant_fkey
  foreign key (product_id, default_variant_id)
  references public.vibode_stage_variants (product_id, variant_id)
  deferrable initially deferred;

insert into public.vibode_stage_product_collections (
  product_id,
  collection_id,
  sort_order
) values
  ('prod-vibode-studio-sofa', 'col-vibode-picks', 0),
  ('prod-vibode-studio-settee', 'col-vibode-picks', 1),
  ('prod-vibode-studio-lounge-chair', 'col-vibode-picks', 2),
  ('prod-vibode-studio-settee', 'col-small-spaces', 0),
  ('prod-vibode-studio-lounge-chair', 'col-small-spaces', 1),
  ('prod-vibode-studio-sofa', 'col-modern-living', 0),
  ('prod-vibode-studio-settee', 'col-modern-living', 1);

alter table public.vibode_stage_assets enable row level security;
alter table public.vibode_stage_products enable row level security;
alter table public.vibode_stage_variants enable row level security;
alter table public.vibode_stage_collections enable row level security;
alter table public.vibode_stage_product_collections enable row level security;

revoke all on table public.vibode_stage_assets from public, anon, authenticated;
revoke all on table public.vibode_stage_products from public, anon, authenticated;
revoke all on table public.vibode_stage_variants from public, anon, authenticated;
revoke all on table public.vibode_stage_collections from public, anon, authenticated;
revoke all on table public.vibode_stage_product_collections from public, anon, authenticated;

grant select on table public.vibode_stage_assets to anon, authenticated;
grant select on table public.vibode_stage_products to anon, authenticated;
grant select on table public.vibode_stage_variants to anon, authenticated;
grant select on table public.vibode_stage_collections to anon, authenticated;
grant select on table public.vibode_stage_product_collections to anon, authenticated;

grant select, insert, update, delete on table public.vibode_stage_assets to service_role;
grant select, insert, update, delete on table public.vibode_stage_products to service_role;
grant select, insert, update, delete on table public.vibode_stage_variants to service_role;
grant select, insert, update, delete on table public.vibode_stage_collections to service_role;
grant select, insert, update, delete on table public.vibode_stage_product_collections to service_role;

create policy "vibode_stage_assets_public_select"
on public.vibode_stage_assets
for select
to anon, authenticated
using (true);

create policy "vibode_stage_products_public_active_select"
on public.vibode_stage_products
for select
to anon, authenticated
using (status = 'active');

create policy "vibode_stage_variants_public_active_select"
on public.vibode_stage_variants
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.vibode_stage_products products
    where products.product_id = vibode_stage_variants.product_id
      and products.status = 'active'
  )
);

create policy "vibode_stage_collections_public_active_select"
on public.vibode_stage_collections
for select
to anon, authenticated
using (status = 'active');

create policy "vibode_stage_product_collections_public_active_select"
on public.vibode_stage_product_collections
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.vibode_stage_products products
    where products.product_id = vibode_stage_product_collections.product_id
      and products.status = 'active'
  )
  and exists (
    select 1
    from public.vibode_stage_collections collections
    where collections.collection_id = vibode_stage_product_collections.collection_id
      and collections.status = 'active'
  )
);

commit;
