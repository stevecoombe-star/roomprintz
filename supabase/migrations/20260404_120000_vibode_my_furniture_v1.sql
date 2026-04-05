create table if not exists public.vibode_user_furniture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_sku_id text not null,
  display_name text,
  preview_image_url text,
  source_url text,
  category text,
  times_used integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_archived boolean not null default false
);

alter table public.vibode_user_furniture
  add column if not exists preview_image_url text,
  add column if not exists source_url text,
  add column if not exists category text,
  add column if not exists times_used integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists is_archived boolean not null default false;

alter table public.vibode_user_furniture
  alter column user_sku_id type text using user_sku_id::text,
  alter column user_sku_id set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vibode_user_furniture'
      and column_name = 'source_type'
  ) then
    execute 'alter table public.vibode_user_furniture alter column source_type set default ''unknown''';
    execute 'update public.vibode_user_furniture set source_type = ''unknown'' where source_type is null';
  end if;
end
$$;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, user_sku_id
      order by is_archived asc, updated_at desc nulls last, created_at desc, id desc
    ) as rn
  from public.vibode_user_furniture
)
delete from public.vibode_user_furniture target
using ranked
where target.id = ranked.id
  and ranked.rn > 1;

drop index if exists public.vibode_user_furniture_user_id_user_sku_id_active_key;
create unique index if not exists vibode_user_furniture_user_id_user_sku_id_key
  on public.vibode_user_furniture(user_id, user_sku_id);

create index if not exists vibode_user_furniture_user_id_idx
  on public.vibode_user_furniture(user_id);
create index if not exists vibode_user_furniture_user_archived_idx
  on public.vibode_user_furniture(user_id, is_archived);
create index if not exists vibode_user_furniture_user_last_used_desc_idx
  on public.vibode_user_furniture(user_id, last_used_at desc nulls last);
create index if not exists vibode_user_furniture_user_created_desc_idx
  on public.vibode_user_furniture(user_id, created_at desc);
create index if not exists vibode_user_furniture_category_idx
  on public.vibode_user_furniture(category);

create table if not exists public.vibode_furniture_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_furniture_id uuid not null references public.vibode_user_furniture(id) on delete cascade,
  event_type text not null check (event_type in ('added', 'swapped')),
  room_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists vibode_furniture_events_user_id_idx
  on public.vibode_furniture_events(user_id);
create index if not exists vibode_furniture_events_user_furniture_id_idx
  on public.vibode_furniture_events(user_furniture_id);
create index if not exists vibode_furniture_events_room_id_idx
  on public.vibode_furniture_events(room_id);
create index if not exists vibode_furniture_events_event_type_idx
  on public.vibode_furniture_events(event_type);
create index if not exists vibode_furniture_events_created_at_desc_idx
  on public.vibode_furniture_events(created_at desc);

alter table public.vibode_user_furniture enable row level security;
alter table public.vibode_furniture_events enable row level security;

drop policy if exists "vibode_user_furniture_owner_all" on public.vibode_user_furniture;
drop policy if exists "vibode_user_furniture_owner_select" on public.vibode_user_furniture;
drop policy if exists "vibode_user_furniture_owner_insert" on public.vibode_user_furniture;
drop policy if exists "vibode_user_furniture_owner_update" on public.vibode_user_furniture;
drop policy if exists "vibode_user_furniture_owner_delete" on public.vibode_user_furniture;

create policy "vibode_user_furniture_owner_select"
on public.vibode_user_furniture
for select
using (auth.uid() = user_id);

create policy "vibode_user_furniture_owner_insert"
on public.vibode_user_furniture
for insert
with check (auth.uid() = user_id);

create policy "vibode_user_furniture_owner_update"
on public.vibode_user_furniture
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "vibode_user_furniture_owner_delete"
on public.vibode_user_furniture
for delete
using (auth.uid() = user_id);

drop policy if exists "vibode_furniture_events_owner_select" on public.vibode_furniture_events;
drop policy if exists "vibode_furniture_events_owner_insert" on public.vibode_furniture_events;

create policy "vibode_furniture_events_owner_select"
on public.vibode_furniture_events
for select
using (auth.uid() = user_id);

create policy "vibode_furniture_events_owner_insert"
on public.vibode_furniture_events
for insert
with check (auth.uid() = user_id);

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

drop trigger if exists set_timestamp_vibode_user_furniture on public.vibode_user_furniture;
drop trigger if exists set_updated_at_vibode_user_furniture on public.vibode_user_furniture;

create trigger set_updated_at_vibode_user_furniture
before update on public.vibode_user_furniture
for each row execute function public.set_updated_at();
