alter table public.room_furniture_placements
  add column if not exists metadata jsonb not null default '{}'::jsonb;
