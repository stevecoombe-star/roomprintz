alter table public.room_image_objects
  add column if not exists center_x numeric null,
  add column if not exists center_y numeric null,
  add column if not exists bbox jsonb null;
