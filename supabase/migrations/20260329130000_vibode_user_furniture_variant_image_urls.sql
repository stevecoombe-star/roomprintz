alter table public.vibode_user_furniture
  add column if not exists variant_image_urls jsonb not null default '[]'::jsonb;
