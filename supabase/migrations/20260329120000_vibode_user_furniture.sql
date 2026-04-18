create table public.vibode_user_furniture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_sku_id text not null,
  display_name text,
  item_type text,
  source_type text not null,
  source_label text,
  preview_image_url text,
  normalized_preview_url text,
  variant_image_urls jsonb not null default '[]'::jsonb,
  status text not null default 'ready',
  constraint vibode_user_furniture_status_check
    check (status in ('ready', 'failed', 'archived')),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index vibode_user_furniture_user_id_idx
  on public.vibode_user_furniture(user_id);
create index vibode_user_furniture_user_status_idx
  on public.vibode_user_furniture(user_id, status);
create index vibode_user_furniture_user_last_used_created_desc_idx
  on public.vibode_user_furniture(user_id, last_used_at desc nulls last, created_at desc);

create unique index vibode_user_furniture_user_id_user_sku_id_active_key
  on public.vibode_user_furniture(user_id, user_sku_id)
  where is_archived = false;

alter table public.vibode_user_furniture enable row level security;

create policy "vibode_user_furniture_owner_all"
on public.vibode_user_furniture
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger set_timestamp_vibode_user_furniture
before update on public.vibode_user_furniture
for each row execute function public.set_timestamp();
