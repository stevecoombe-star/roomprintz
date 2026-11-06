-- MESHY-1A: account-owned personal GLB library.
--
-- vibode_furniture_assets is not a partner catalog table and is not
-- vibode_stage_assets. Rows are immutable GLB identities. Archiving changes
-- library_visibility only. It does not remove the row or the object, so a
-- saved room can keep resolving the same asset id.
--
-- service_role is the only database role that can read or write these
-- tables. There are no policies for anon or authenticated. Application
-- routes check auth.uid ownership before using the service role.
--
-- The delete trigger rejects every delete, including a cascade from
-- auth.users. Account deletion for someone who owns a personal model
-- needs a later, explicit cleanup migration. Archive does not delete.
--
-- Private bucket vibode-furniture-assets rejects browser roles. Clients
-- receive a service-role signed URL for one server-chosen object.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.

begin;

create table public.vibode_furniture_assets (
  asset_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  category text null,
  origin text not null default 'uploaded',
  authored_width_m numeric not null,
  authored_height_m numeric not null,
  authored_depth_m numeric not null,
  sha256 text not null,
  byte_size bigint not null,
  storage_bucket text not null,
  storage_object_path text not null,
  library_visibility text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_furniture_assets_asset_id_shape
    check (
      asset_id ~ '^vibode-furniture/personal/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  constraint vibode_furniture_assets_name_len
    check (char_length(display_name) between 1 and 80),
  constraint vibode_furniture_assets_category_len
    check (category is null or char_length(category) between 1 and 40),
  constraint vibode_furniture_assets_origin_uploaded
    check (origin = 'uploaded'),
  constraint vibode_furniture_assets_dimensions
    check (
      authored_width_m >= 0.05 and authored_width_m <= 8
      and authored_height_m >= 0.05 and authored_height_m <= 8
      and authored_depth_m >= 0.05 and authored_depth_m <= 8
    ),
  constraint vibode_furniture_assets_sha256
    check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint vibode_furniture_assets_byte_size
    check (byte_size > 0 and byte_size <= 26214400),
  constraint vibode_furniture_assets_bucket
    check (storage_bucket = 'vibode-furniture-assets'),
  constraint vibode_furniture_assets_path
    check (
      storage_object_path = 'users/' || user_id::text || '/assets/'
        || right(asset_id, 36) || '/model.glb'
      and position('..' in storage_object_path) = 0
    ),
  constraint vibode_furniture_assets_visibility
    check (library_visibility in ('active', 'archived'))
);

create unique index vibode_furniture_assets_user_sha_uidx
  on public.vibode_furniture_assets (user_id, sha256);

create unique index vibode_furniture_assets_object_path_uidx
  on public.vibode_furniture_assets (storage_bucket, storage_object_path);

create index vibode_furniture_assets_user_visibility_idx
  on public.vibode_furniture_assets (user_id, library_visibility, created_at desc);

create table public.vibode_furniture_asset_uploads (
  upload_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null,
  storage_bucket text not null,
  pending_object_path text not null,
  permanent_object_path text not null,
  status text not null,
  result_asset_id text null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vibode_furniture_asset_uploads_asset_id_shape
    check (
      asset_id ~ '^vibode-furniture/personal/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  constraint vibode_furniture_asset_uploads_bucket
    check (storage_bucket = 'vibode-furniture-assets'),
  constraint vibode_furniture_asset_uploads_pending_path
    check (
      pending_object_path = 'users/' || user_id::text || '/uploads/'
        || upload_id::text || '/model.glb'
      and position('..' in pending_object_path) = 0
    ),
  constraint vibode_furniture_asset_uploads_permanent_path
    check (
      permanent_object_path = 'users/' || user_id::text || '/assets/'
        || right(asset_id, 36) || '/model.glb'
      and position('..' in permanent_object_path) = 0
    ),
  constraint vibode_furniture_asset_uploads_status
    check (status in ('pending', 'finalizing', 'finalized', 'rejected', 'expired')),
  constraint vibode_furniture_asset_uploads_result
    check (
      (status = 'finalized' and result_asset_id is not null)
      or (status <> 'finalized' and result_asset_id is null)
    )
);

create unique index vibode_furniture_asset_uploads_asset_id_uidx
  on public.vibode_furniture_asset_uploads (asset_id);

create unique index vibode_furniture_asset_uploads_pending_uidx
  on public.vibode_furniture_asset_uploads (storage_bucket, pending_object_path);

create index vibode_furniture_asset_uploads_user_status_idx
  on public.vibode_furniture_asset_uploads (user_id, status, expires_at);

create trigger set_timestamp_vibode_furniture_assets
before update on public.vibode_furniture_assets
for each row execute function public.set_timestamp();

create trigger set_timestamp_vibode_furniture_asset_uploads
before update on public.vibode_furniture_asset_uploads
for each row execute function public.set_timestamp();

create or replace function public.vibode_furniture_assets_protect_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.asset_id is distinct from OLD.asset_id
    or NEW.user_id is distinct from OLD.user_id
    or NEW.origin is distinct from OLD.origin
    or NEW.authored_width_m is distinct from OLD.authored_width_m
    or NEW.authored_height_m is distinct from OLD.authored_height_m
    or NEW.authored_depth_m is distinct from OLD.authored_depth_m
    or NEW.sha256 is distinct from OLD.sha256
    or NEW.byte_size is distinct from OLD.byte_size
    or NEW.storage_bucket is distinct from OLD.storage_bucket
    or NEW.storage_object_path is distinct from OLD.storage_object_path
    or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'VIBODE_FURNITURE_ASSET:IMMUTABLE';
  end if;
  return NEW;
end;
$$;

create trigger vibode_furniture_assets_protect_row
before update on public.vibode_furniture_assets
for each row execute function public.vibode_furniture_assets_protect_row();

create or replace function public.vibode_furniture_assets_no_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'VIBODE_FURNITURE_ASSET:DELETE_FORBIDDEN';
end;
$$;

create trigger vibode_furniture_assets_no_delete
before delete on public.vibode_furniture_assets
for each row execute function public.vibode_furniture_assets_no_delete();

alter table public.vibode_furniture_assets enable row level security;
alter table public.vibode_furniture_asset_uploads enable row level security;

revoke all on table public.vibode_furniture_assets from public, anon, authenticated;
revoke all on table public.vibode_furniture_asset_uploads from public, anon, authenticated;

grant select, insert, update, delete on table public.vibode_furniture_assets to service_role;
grant select, insert, update, delete on table public.vibode_furniture_asset_uploads to service_role;

revoke all on function public.vibode_furniture_assets_protect_row() from public, anon, authenticated;
revoke all on function public.vibode_furniture_assets_no_delete() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-furniture-assets',
  'vibode-furniture-assets',
  false,
  26214400,
  array['model/gltf-binary', 'application/octet-stream']::text[]
);

drop policy if exists vibode_furniture_asset_deny_anon on storage.objects;
drop policy if exists vibode_furniture_asset_deny_authenticated on storage.objects;

create policy vibode_furniture_asset_deny_anon
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'vibode-furniture-assets')
with check (bucket_id <> 'vibode-furniture-assets');

create policy vibode_furniture_asset_deny_authenticated
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'vibode-furniture-assets')
with check (bucket_id <> 'vibode-furniture-assets');

commit;
