-- PI-5G2: STAGE Partner Portal persistent patch drafts.
--
-- One open canonical PI-5F patch document per Partner.
-- Drafts are authoring state, not commercial authority.
-- Portal access remains membership-derived (PI-5G1).
--
-- Schema only. Do not insert environment-specific drafts.
-- Browser roles cannot mutate this table. Service role is the
-- only DML authority; Partner Portal routes authorize by membership.

begin;

create table public.vibode_stage_partner_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  partner_id text not null references public.vibode_stage_partners (partner_id) on delete restrict,
  created_by_user_id uuid references auth.users (id) on delete set null,
  updated_by_user_id uuid references auth.users (id) on delete set null,
  document_kind text not null,
  document jsonb not null,
  status text not null default 'open',
  revision bigint not null default 1,
  base_catalog_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_partner_drafts_kind_closed
    check (document_kind in ('patch')),
  constraint vibode_stage_partner_drafts_status_closed
    check (status in ('open', 'abandoned')),
  constraint vibode_stage_partner_drafts_revision_min
    check (revision >= 1),
  constraint vibode_stage_partner_drafts_document_object
    check (jsonb_typeof(document) = 'object')
);

create unique index vibode_stage_partner_drafts_one_open_patch_idx
  on public.vibode_stage_partner_drafts (partner_id)
  where status = 'open' and document_kind = 'patch';

create index vibode_stage_partner_drafts_partner_id_idx
  on public.vibode_stage_partner_drafts (partner_id);

create index vibode_stage_partner_drafts_partner_status_idx
  on public.vibode_stage_partner_drafts (partner_id, status);

create trigger set_timestamp_vibode_stage_partner_drafts
before update on public.vibode_stage_partner_drafts
for each row execute function public.set_timestamp();

alter table public.vibode_stage_partner_drafts enable row level security;

revoke all on table public.vibode_stage_partner_drafts
  from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_stage_partner_drafts
  to service_role;

commit;
