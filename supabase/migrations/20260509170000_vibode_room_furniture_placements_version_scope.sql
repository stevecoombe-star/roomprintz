alter table public.room_furniture_placements
  add column if not exists version_id uuid null;

create index if not exists room_furniture_placements_room_id_version_id_user_id_idx
  on public.room_furniture_placements(room_id, version_id, user_id);
