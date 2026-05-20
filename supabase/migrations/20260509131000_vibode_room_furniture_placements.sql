create table if not exists public.room_furniture_placements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  furniture_id uuid null,
  thumbnail_url text null,
  source_image_url text not null,
  -- x/y are normalized canvas/image coordinates in [0,1], not pixels.
  x double precision not null,
  y double precision not null,
  scale double precision not null default 1,
  rotation double precision not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_furniture_placements_user_id_idx
  on public.room_furniture_placements(user_id);
create index if not exists room_furniture_placements_room_id_idx
  on public.room_furniture_placements(room_id);
create index if not exists room_furniture_placements_created_at_idx
  on public.room_furniture_placements(created_at);
create index if not exists room_furniture_placements_room_id_user_id_idx
  on public.room_furniture_placements(room_id, user_id);

alter table public.room_furniture_placements enable row level security;

drop policy if exists "room_furniture_placements_owner_select" on public.room_furniture_placements;
drop policy if exists "room_furniture_placements_owner_insert" on public.room_furniture_placements;
drop policy if exists "room_furniture_placements_owner_update" on public.room_furniture_placements;
drop policy if exists "room_furniture_placements_owner_delete" on public.room_furniture_placements;

create policy "room_furniture_placements_owner_select"
on public.room_furniture_placements
for select
using (auth.uid() = user_id);

create policy "room_furniture_placements_owner_insert"
on public.room_furniture_placements
for insert
with check (auth.uid() = user_id);

create policy "room_furniture_placements_owner_update"
on public.room_furniture_placements
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "room_furniture_placements_owner_delete"
on public.room_furniture_placements
for delete
using (auth.uid() = user_id);

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

drop trigger if exists set_updated_at_room_furniture_placements on public.room_furniture_placements;

create trigger set_updated_at_room_furniture_placements
before update on public.room_furniture_placements
for each row execute function public.set_updated_at();
