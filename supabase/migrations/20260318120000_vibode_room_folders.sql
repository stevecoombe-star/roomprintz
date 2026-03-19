create table public.vibode_room_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_room_folders_name_length_check check (char_length(trim(name)) between 1 and 120),
  constraint vibode_room_folders_user_id_name_key unique (user_id, name)
);

alter table public.vibode_rooms
  add column folder_id uuid references public.vibode_room_folders(id) on delete set null;

create index vibode_room_folders_user_id_idx on public.vibode_room_folders(user_id);
create index vibode_room_folders_user_id_updated_at_desc_idx
  on public.vibode_room_folders(user_id, updated_at desc);
create index vibode_rooms_user_id_folder_id_idx on public.vibode_rooms(user_id, folder_id);

alter table public.vibode_room_folders enable row level security;

create policy "vibode_room_folders_owner_all"
on public.vibode_room_folders
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger set_timestamp_vibode_room_folders
before update on public.vibode_room_folders
for each row execute function public.set_timestamp();
