create table if not exists public.vibode_furniture_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text null,
  website_url text null,
  description text null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  internal_notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vibode_furniture_collections (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.vibode_furniture_partners(id) on delete cascade,
  name text not null,
  slug text not null,
  description text null,
  hero_image_url text null,
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'unlisted')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, slug)
);

create table if not exists public.vibode_furniture_collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.vibode_furniture_collections(id) on delete cascade,
  product_name text not null,
  product_url text null,
  image_url text null,
  stored_asset_id uuid null,
  brand text null,
  category text null,
  price_amount numeric null,
  price_currency text null,
  sort_order integer not null default 0,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vibode_furniture_collection_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  session_id text null,
  collection_id uuid not null references public.vibode_furniture_collections(id) on delete cascade,
  source text not null default 'public_collection_url',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vibode_furniture_partners_slug_idx
  on public.vibode_furniture_partners(slug);

create index if not exists vibode_furniture_collections_slug_idx
  on public.vibode_furniture_collections(slug);

create index if not exists vibode_furniture_collections_partner_id_idx
  on public.vibode_furniture_collections(partner_id);

create index if not exists vibode_furniture_collection_items_collection_id_idx
  on public.vibode_furniture_collection_items(collection_id);

create index if not exists vibode_furniture_collection_imports_user_id_idx
  on public.vibode_furniture_collection_imports(user_id);

create index if not exists vibode_furniture_collection_imports_session_id_idx
  on public.vibode_furniture_collection_imports(session_id);

create index if not exists vibode_furniture_collection_imports_collection_id_idx
  on public.vibode_furniture_collection_imports(collection_id);

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and p.pronargs = 0
  ) then
    create function public.set_updated_at()
    returns trigger
    language plpgsql
    as $function$
    begin
      new.updated_at = now();
      return new;
    end;
    $function$;
  end if;
end
$$;

drop trigger if exists set_updated_at_vibode_furniture_partners
on public.vibode_furniture_partners;
create trigger set_updated_at_vibode_furniture_partners
before update on public.vibode_furniture_partners
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_vibode_furniture_collections
on public.vibode_furniture_collections;
create trigger set_updated_at_vibode_furniture_collections
before update on public.vibode_furniture_collections
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_vibode_furniture_collection_items
on public.vibode_furniture_collection_items;
create trigger set_updated_at_vibode_furniture_collection_items
before update on public.vibode_furniture_collection_items
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_vibode_furniture_collection_imports
on public.vibode_furniture_collection_imports;
create trigger set_updated_at_vibode_furniture_collection_imports
before update on public.vibode_furniture_collection_imports
for each row execute function public.set_updated_at();

alter table public.vibode_furniture_partners enable row level security;
alter table public.vibode_furniture_collections enable row level security;
alter table public.vibode_furniture_collection_items enable row level security;
alter table public.vibode_furniture_collection_imports enable row level security;

drop policy if exists "vibode_furniture_partners_public_active_select"
on public.vibode_furniture_partners;
create policy "vibode_furniture_partners_public_active_select"
on public.vibode_furniture_partners
for select
to anon, authenticated
using (status = 'active');

drop policy if exists "vibode_furniture_collections_public_active_select"
on public.vibode_furniture_collections;
create policy "vibode_furniture_collections_public_active_select"
on public.vibode_furniture_collections
for select
to anon, authenticated
using (
  status = 'active'
  and visibility = 'public'
  and exists (
    select 1
    from public.vibode_furniture_partners partners
    where partners.id = partner_id
      and partners.status = 'active'
  )
);

drop policy if exists "vibode_furniture_collection_items_public_active_select"
on public.vibode_furniture_collection_items;
create policy "vibode_furniture_collection_items_public_active_select"
on public.vibode_furniture_collection_items
for select
to anon, authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.vibode_furniture_collections collections
    join public.vibode_furniture_partners partners
      on partners.id = collections.partner_id
    where collections.id = collection_id
      and collections.status = 'active'
      and collections.visibility = 'public'
      and partners.status = 'active'
  )
);

-- TODO(vibode-furniture-collections): add explicit admin/internal write policies
-- once the phase-2 server routes are added and mapped to existing admin guards.
