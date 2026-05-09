alter table public.room_furniture_placements
  add column if not exists source_image_path text null,
  add column if not exists thumbnail_path text null;
