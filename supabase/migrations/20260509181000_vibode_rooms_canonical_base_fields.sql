alter table public.vibode_rooms
  add column if not exists base_image_url text null,
  add column if not exists base_storage_path text null,
  add column if not exists base_version_id uuid null;
