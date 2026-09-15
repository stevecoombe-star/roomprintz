-- PI-5F1: STAGE-native Partner identity and Product/Collection ownership.
--
-- Adds vibode_stage_partners and partner_id on STAGE Products/Collections.
-- Does not touch legacy vibode_partners / furniture-partner tables.
-- Does not mutate Assets, Variants, or Scene Objects.
-- Partner catalog rows are imported by a later partner_catalog migration.

begin;

create table public.vibode_stage_partners (
  partner_id text primary key,
  name text not null,
  slug text not null,
  status text not null default 'active',
  website_url text null,
  logo_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_partners_partner_id_shape
    check (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  constraint vibode_stage_partners_partner_id_prefix
    check (partner_id like 'partner-%'),
  constraint vibode_stage_partners_name_len
    check (char_length(name) between 1 and 200),
  constraint vibode_stage_partners_slug_shape
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint vibode_stage_partners_status_closed
    check (status in ('active', 'inactive'))
);

create unique index vibode_stage_partners_slug_uidx
  on public.vibode_stage_partners (slug);

create index vibode_stage_partners_status_idx
  on public.vibode_stage_partners (status);

create trigger set_timestamp_vibode_stage_partners
before update on public.vibode_stage_partners
for each row execute function public.set_timestamp();

alter table public.vibode_stage_products
  add column partner_id text null;

alter table public.vibode_stage_products
  add constraint vibode_stage_products_partner_id_fkey
  foreign key (partner_id)
  references public.vibode_stage_partners (partner_id)
  on delete restrict;

alter table public.vibode_stage_products
  add constraint vibode_stage_products_partner_source_pairing
  check (
    (source = 'partner_catalog' and partner_id is not null)
    or (source in ('vibode_curated', 'user_pasted') and partner_id is null)
  );

create index vibode_stage_products_partner_id_idx
  on public.vibode_stage_products (partner_id);

alter table public.vibode_stage_collections
  add column partner_id text null;

alter table public.vibode_stage_collections
  add constraint vibode_stage_collections_partner_id_fkey
  foreign key (partner_id)
  references public.vibode_stage_partners (partner_id)
  on delete restrict;

alter table public.vibode_stage_collections
  add constraint vibode_stage_collections_partner_owner_pairing
  check (
    (owner = 'partner' and partner_id is not null)
    or (owner = 'vibode' and partner_id is null)
  );

create index vibode_stage_collections_partner_id_idx
  on public.vibode_stage_collections (partner_id);

alter table public.vibode_stage_partners enable row level security;

revoke all on table public.vibode_stage_partners from public, anon, authenticated;

grant select on table public.vibode_stage_partners to anon, authenticated;
grant select, insert, update, delete on table public.vibode_stage_partners to service_role;

create policy "vibode_stage_partners_public_active_select"
on public.vibode_stage_partners
for select
to anon, authenticated
using (status = 'active');

commit;
