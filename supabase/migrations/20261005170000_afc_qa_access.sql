-- Durable AFC QA access.
--
-- One global QA Mode flag and an allowlist keyed by auth user id.
-- Email is display metadata only. Defaults are QA Mode disabled and an
-- empty allowlist. After applying, an administrator enables QA Mode and
-- adds users at /admin/afc-diagnostics.
--
-- Apply manually. Do not assume this has been applied to hosted Supabase.
-- Do not seed operator ids in this migration.

begin;

create table if not exists public.afc_qa_settings (
  id text primary key,
  qa_mode_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint afc_qa_settings_singleton check (id = 'global')
);

insert into public.afc_qa_settings (id, qa_mode_enabled)
values ('global', false)
on conflict (id) do nothing;

create table if not exists public.afc_qa_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_snapshot text,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null
);

alter table public.afc_qa_settings enable row level security;
alter table public.afc_qa_users enable row level security;

revoke all on table public.afc_qa_settings from public, anon, authenticated;
revoke all on table public.afc_qa_users from public, anon, authenticated;

grant select, insert, update on table public.afc_qa_settings to service_role;
grant select, insert, delete on table public.afc_qa_users to service_role;

comment on table public.afc_qa_settings is
  'Global AFC QA Mode. Service role only. Default is disabled.';

comment on table public.afc_qa_users is
  'AFC QA allowlist keyed by auth user id. email_snapshot is display-only.';

comment on column public.afc_qa_users.user_id is
  'Authenticated Supabase user id. This is the authorization identity.';

commit;
