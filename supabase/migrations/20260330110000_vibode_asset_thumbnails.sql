alter table public.vibode_room_assets
  add column if not exists thumbnail_storage_bucket text,
  add column if not exists thumbnail_storage_path text;

