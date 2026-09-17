-- PI-5G5A: STAGE Partner Portal GLB intake foundation.
--
-- Durable Partner-owned GLB upload + certified validation evidence.
-- This is not runtime Asset authority. G5A does not insert
-- public.vibode_stage_assets, does not create Partner↔Asset eligibility,
-- and does not mint a ready Asset.
--
-- Failed intake retry policy: a failed intake remains failed.
-- Changed bytes require a new intake. After validation, the Storage
-- object is immutable. G5A does not auto-delete orphan objects.
--
-- Schema + private Storage bucket only. Do not seed intakes.
-- Browser roles cannot mutate this table. Service role is the
-- only DML authority; Partner Portal routes authorize by membership.

begin;

create table public.vibode_stage_partner_asset_intakes (
  intake_id uuid primary key default gen_random_uuid(),
  partner_id text not null references public.vibode_stage_partners (partner_id) on delete restrict,
  created_by_user_id uuid references auth.users (id) on delete set null,
  status text not null,
  object_path text not null,
  original_filename text not null,
  byte_size bigint not null,
  sha256 text,
  authored_width_m numeric not null,
  authored_height_m numeric not null,
  authored_depth_m numeric not null,
  measured_width_m numeric,
  measured_height_m numeric,
  measured_depth_m numeric,
  placement_scale numeric,
  validation_warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_stage_partner_asset_intakes_status_closed
    check (status in ('created', 'uploaded', 'validating', 'validated', 'failed')),
  constraint vibode_stage_partner_asset_intakes_object_path_len
    check (char_length(object_path) between 1 and 1024),
  constraint vibode_stage_partner_asset_intakes_object_path_safe
    check (position('..' in object_path) = 0 and object_path not like '/%'),
  constraint vibode_stage_partner_asset_intakes_filename_len
    check (char_length(original_filename) between 1 and 200),
  constraint vibode_stage_partner_asset_intakes_byte_size_positive
    check (byte_size > 0 and byte_size <= 26214400),
  constraint vibode_stage_partner_asset_intakes_sha256_hex
    check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  constraint vibode_stage_partner_asset_intakes_authored_width_positive
    check (authored_width_m > 0),
  constraint vibode_stage_partner_asset_intakes_authored_height_positive
    check (authored_height_m > 0),
  constraint vibode_stage_partner_asset_intakes_authored_depth_positive
    check (authored_depth_m > 0),
  constraint vibode_stage_partner_asset_intakes_measured_width_positive
    check (measured_width_m is null or measured_width_m > 0),
  constraint vibode_stage_partner_asset_intakes_measured_height_positive
    check (measured_height_m is null or measured_height_m > 0),
  constraint vibode_stage_partner_asset_intakes_measured_depth_positive
    check (measured_depth_m is null or measured_depth_m > 0),
  constraint vibode_stage_partner_asset_intakes_warnings_array
    check (jsonb_typeof(validation_warnings) = 'array')
);

create unique index vibode_stage_partner_asset_intakes_object_path_uidx
  on public.vibode_stage_partner_asset_intakes (object_path);

create index vibode_stage_partner_asset_intakes_partner_id_idx
  on public.vibode_stage_partner_asset_intakes (partner_id);

create index vibode_stage_partner_asset_intakes_partner_created_idx
  on public.vibode_stage_partner_asset_intakes (partner_id, created_at desc);

create index vibode_stage_partner_asset_intakes_partner_status_idx
  on public.vibode_stage_partner_asset_intakes (partner_id, status);

create trigger set_timestamp_vibode_stage_partner_asset_intakes
before update on public.vibode_stage_partner_asset_intakes
for each row execute function public.set_timestamp();

alter table public.vibode_stage_partner_asset_intakes enable row level security;

revoke all on table public.vibode_stage_partner_asset_intakes
  from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_stage_partner_asset_intakes
  to service_role;

-- Private Partner GLB intake bucket. Do not reuse vibode-base-images,
-- vibode-generations, or vibode-afc-v2. Browser writes only through a
-- service-role minted signed upload URL for one object path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-stage-assets',
  'vibode-stage-assets',
  false,
  26214400,
  array['model/gltf-binary', 'application/octet-stream']::text[]
);

drop policy if exists vibode_stage_asset_intake_deny_anon on storage.objects;
drop policy if exists vibode_stage_asset_intake_deny_authenticated on storage.objects;

create policy vibode_stage_asset_intake_deny_anon
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'vibode-stage-assets')
with check (bucket_id <> 'vibode-stage-assets');

create policy vibode_stage_asset_intake_deny_authenticated
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'vibode-stage-assets')
with check (bucket_id <> 'vibode-stage-assets');

commit;
