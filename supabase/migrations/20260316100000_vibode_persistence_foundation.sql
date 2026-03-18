create table public.vibode_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Room',
  status text not null default 'draft',
  source_type text not null default 'upload',
  aspect_ratio text,
  selected_model text,
  base_asset_id uuid,
  active_asset_id uuid,
  current_stage smallint not null default 0,
  cover_image_url text,
  last_opened_at timestamptz,
  sort_key timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vibode_room_assets (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_type text not null,
  stage_number smallint,
  storage_bucket text,
  storage_path text,
  image_url text not null,
  width integer,
  height integer,
  model_version text,
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.vibode_generation_runs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_type text not null,
  stage_number smallint,
  source_asset_id uuid references public.vibode_room_assets(id) on delete set null,
  output_asset_id uuid references public.vibode_room_assets(id) on delete set null,
  model_version text,
  aspect_ratio text,
  status text not null default 'completed',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.vibode_rooms
  add constraint vibode_rooms_base_asset_id_fkey
    foreign key (base_asset_id)
    references public.vibode_room_assets(id)
    on delete set null;

alter table public.vibode_rooms
  add constraint vibode_rooms_active_asset_id_fkey
    foreign key (active_asset_id)
    references public.vibode_room_assets(id)
    on delete set null;

create index vibode_rooms_user_id_idx on public.vibode_rooms(user_id);
create index vibode_rooms_user_id_updated_at_desc_idx
  on public.vibode_rooms(user_id, updated_at desc);
create index vibode_rooms_user_id_sort_key_desc_idx
  on public.vibode_rooms(user_id, sort_key desc);

create index vibode_room_assets_room_id_idx on public.vibode_room_assets(room_id);
create index vibode_room_assets_user_id_idx on public.vibode_room_assets(user_id);
create index vibode_room_assets_room_stage_created_desc_idx
  on public.vibode_room_assets(room_id, stage_number, created_at desc);
create index vibode_room_assets_room_is_active_idx
  on public.vibode_room_assets(room_id, is_active);

create index vibode_generation_runs_room_id_idx on public.vibode_generation_runs(room_id);
create index vibode_generation_runs_user_id_idx on public.vibode_generation_runs(user_id);
create index vibode_generation_runs_room_created_desc_idx
  on public.vibode_generation_runs(room_id, created_at desc);

alter table public.vibode_rooms enable row level security;
alter table public.vibode_room_assets enable row level security;
alter table public.vibode_generation_runs enable row level security;

create policy "vibode_rooms_owner_all"
on public.vibode_rooms
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "vibode_room_assets_owner_all"
on public.vibode_room_assets
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "vibode_generation_runs_owner_all"
on public.vibode_generation_runs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger set_timestamp_vibode_rooms
before update on public.vibode_rooms
for each row execute function public.set_timestamp();
