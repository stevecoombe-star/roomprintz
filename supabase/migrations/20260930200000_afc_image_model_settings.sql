-- Admin-selectable AFC EMPTY and TILED image models.
--
-- One global row. Missing or invalid values are treated as Nano Banana Pro
-- by the application. This migration does not change generation tables.
-- Apply manually. Do not assume it has been applied to hosted Supabase.

begin;

create table if not exists public.afc_image_model_settings (
  id text primary key default 'global',
  empty_model text not null default 'nano-banana-pro',
  tiled_model text not null default 'nano-banana-pro',
  updated_at timestamptz not null default now(),
  constraint afc_image_model_settings_empty_model_check
    check (empty_model in ('nano-banana-pro', 'gpt-image-2.5-sunburst-high')),
  constraint afc_image_model_settings_tiled_model_check
    check (tiled_model in ('nano-banana-pro', 'gpt-image-2.5-sunburst-high'))
);

insert into public.afc_image_model_settings (id, empty_model, tiled_model)
values ('global', 'nano-banana-pro', 'nano-banana-pro')
on conflict (id) do nothing;

alter table public.afc_image_model_settings enable row level security;

revoke all on table public.afc_image_model_settings from public, anon, authenticated;
grant select, insert, update on table public.afc_image_model_settings to service_role;

comment on table public.afc_image_model_settings is
  'Global AFC EMPTY and TILED image-model selections. Service role only. Defaults are Nano Banana Pro.';

commit;
