-- PI-4C: durable per-History-version 3D furniture scenes.
--
-- Scene state belongs to the Vibode version, not the AFC generation row.
-- AFC generation id is stored as spatial lineage so transforms are only
-- restored when they still match the room's current AFC coordinate system.
--
-- Mutable scene upserts reuse one row per version. This is not immutable
-- AFC generation history.
--
-- Access is fail-closed: RLS is enabled, browser roles are revoked, and
-- production APIs use the service role after owner authorization (same
-- ownership boundary as PI-2 AFC production persistence).
--
-- afc_generation_id is stored as lineage, not as a foreign key. AFC
-- generations are immutable historical rows whose DELETE semantics exist
-- for room cascade/cleanup. Scene lifetime must follow the version/room,
-- not generation cleanup, and a generation FK RESTRICT would race room
-- CASCADE order between vibode_3d_scenes and vibode_afc_generations.
-- APIs validate that the generation belongs to the room before read/write.

begin;

create unique index if not exists vibode_room_assets_id_room_id_uidx
  on public.vibode_room_assets (id, room_id);

create table public.vibode_3d_scenes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  version_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  afc_generation_id uuid not null,
  coordinate_space text not null default 'calibrated-world-xz/v1',
  objects_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_3d_scenes_version_room_fkey
    foreign key (version_id, room_id)
    references public.vibode_room_assets (id, room_id)
    on delete cascade,
  constraint vibode_3d_scenes_room_version_key unique (room_id, version_id),
  constraint vibode_3d_scenes_version_id_key unique (version_id),
  constraint vibode_3d_scenes_coordinate_space_closed
    check (coordinate_space = 'calibrated-world-xz/v1'),
  constraint vibode_3d_scenes_objects_json_is_array
    check (jsonb_typeof(objects_json) = 'array'),
  constraint vibode_3d_scenes_objects_json_len
    check (jsonb_array_length(objects_json) <= 32)
);

create index vibode_3d_scenes_room_id_idx
  on public.vibode_3d_scenes (room_id);

create index vibode_3d_scenes_user_id_idx
  on public.vibode_3d_scenes (user_id);

create index vibode_3d_scenes_afc_generation_id_idx
  on public.vibode_3d_scenes (afc_generation_id);

create trigger set_timestamp_vibode_3d_scenes
before update on public.vibode_3d_scenes
for each row execute function public.set_timestamp();

alter table public.vibode_3d_scenes enable row level security;

revoke all on table public.vibode_3d_scenes from public, anon, authenticated;
grant select, insert, update, delete on table public.vibode_3d_scenes
  to service_role;

commit;
