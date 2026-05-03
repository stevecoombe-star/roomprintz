create table public.room_image_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid null references public.vibode_rooms(id) on delete cascade,
  asset_id text null,
  version_id text null,
  image_url text null,
  image_hash text null,
  label text not null,
  confidence numeric null,
  source text not null default 'gemini_room_read',
  created_at timestamptz not null default now()
);

create index room_image_objects_user_id_idx on public.room_image_objects(user_id);
create index room_image_objects_room_id_idx on public.room_image_objects(room_id);
create index room_image_objects_asset_id_idx on public.room_image_objects(asset_id);
create index room_image_objects_version_id_idx on public.room_image_objects(version_id);
create index room_image_objects_image_hash_idx on public.room_image_objects(image_hash);

create unique index room_image_objects_identity_label_uidx
  on public.room_image_objects(user_id, room_id, asset_id, version_id, image_hash, label, source);

alter table public.room_image_objects enable row level security;

create policy "room_image_objects_owner_all"
on public.room_image_objects
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
