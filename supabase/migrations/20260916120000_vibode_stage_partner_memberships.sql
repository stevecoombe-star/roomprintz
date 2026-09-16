-- PI-5G1: STAGE Partner Portal membership.
--
-- Portal access is independent of commercial Partner availability
-- (vibode_stage_partners.status). Membership status controls Portal login.
-- Partner status remains the storefront/availability gate.
--
-- Schema only. Do not insert environment-specific Auth user IDs.
-- Browser roles cannot mutate this table. Service role is the
-- authorization lookup authority for the Partner Portal.

begin;

create table public.vibode_stage_partner_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  partner_id text not null references public.vibode_stage_partners (partner_id) on delete restrict,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_partner_memberships_user_partner_key
    unique (user_id, partner_id),
  constraint vibode_stage_partner_memberships_role_closed
    check (role in ('owner')),
  constraint vibode_stage_partner_memberships_status_closed
    check (status in ('active', 'revoked'))
);

create index vibode_stage_partner_memberships_partner_id_idx
  on public.vibode_stage_partner_memberships (partner_id);

create index vibode_stage_partner_memberships_user_id_idx
  on public.vibode_stage_partner_memberships (user_id);

create index vibode_stage_partner_memberships_active_user_idx
  on public.vibode_stage_partner_memberships (user_id)
  where status = 'active';

create trigger set_timestamp_vibode_stage_partner_memberships
before update on public.vibode_stage_partner_memberships
for each row execute function public.set_timestamp();

alter table public.vibode_stage_partner_memberships enable row level security;

revoke all on table public.vibode_stage_partner_memberships
  from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_stage_partner_memberships
  to service_role;

commit;
