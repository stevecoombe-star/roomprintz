-- Private scratch photographs for New Room and the 3D Generator.
-- Rows are not customer assets. service_role reaches them only through these functions.
-- The bucket is not public, and signed upload URLs are minted by the service role.

begin;

create table public.vibode_photo_preparations (
  preparation_id uuid primary key,
  user_id uuid not null,
  purpose text not null check (purpose in ('room', 'furniture')),
  object_path text not null unique,
  byte_size bigint not null check (byte_size > 4000000 and byte_size <= 26214400),
  status text not null check (status in ('pending', 'converting', 'closed')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  upload_expires_at timestamptz not null,
  convert_lease_until timestamptz,
  check (
    object_path = 'users/' || lower(user_id::text) || '/preparations/' || lower(preparation_id::text) || '/source.heic'
  )
);

create index vibode_photo_preparations_user_created_idx
  on public.vibode_photo_preparations (user_id, created_at desc);

create index vibode_photo_preparations_sweep_idx
  on public.vibode_photo_preparations (status, upload_expires_at, convert_lease_until);

alter table public.vibode_photo_preparations enable row level security;

revoke all on table public.vibode_photo_preparations from public, anon, authenticated, service_role;

comment on table public.vibode_photo_preparations is
  'Short-lived originals waiting to be normalized. Not a room image, furniture asset, or generation input.';

create or replace function public.sweep_vibode_photo_preparations(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  paths text[] := '{}';
begin
  if p_now is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  for rec in
    select preparation_id, object_path, status
    from public.vibode_photo_preparations
    where (
      status = 'pending' and upload_expires_at <= p_now
    ) or (
      status = 'converting'
      and convert_lease_until is not null
      and convert_lease_until <= p_now
    ) or (
      status = 'closed'
      and updated_at <= p_now - interval '1 minute'
      and updated_at > p_now - interval '2 hours'
    )
    order by updated_at
    limit 40
    for update skip locked
  loop
    if rec.status <> 'closed' then
      update public.vibode_photo_preparations
      set status = 'closed',
          convert_lease_until = null,
          updated_at = p_now
      where preparation_id = rec.preparation_id;
    end if;
    paths := array_append(paths, rec.object_path);
  end loop;

  delete from public.vibode_photo_preparations
  where status = 'closed'
    and updated_at <= p_now - interval '2 hours';

  return jsonb_build_object('ok', true, 'paths', to_jsonb(paths));
end;
$$;

create or replace function public.begin_vibode_photo_preparation(
  p_user_id uuid,
  p_purpose text,
  p_byte_size bigint,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  recent_count integer;
  new_id uuid := gen_random_uuid();
  new_path text;
begin
  if p_user_id is null or p_now is null or p_purpose not in ('room', 'furniture') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_byte_size is null or p_byte_size <= 4000000 or p_byte_size > 26214400 then
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(p_user_id::text), 4815162342));

  select count(*) into active_count
  from public.vibode_photo_preparations
  where user_id = p_user_id
    and (
      (status = 'pending' and upload_expires_at > p_now)
      or (
        status = 'converting'
        and convert_lease_until is not null
        and convert_lease_until > p_now
      )
    );

  if active_count >= 3 then
    return jsonb_build_object('ok', false, 'code', 'capacity');
  end if;

  select count(*) into recent_count
  from public.vibode_photo_preparations
  where user_id = p_user_id
    and created_at > p_now - interval '1 hour';

  if recent_count >= 30 then
    return jsonb_build_object('ok', false, 'code', 'rate');
  end if;

  new_path := 'users/' || lower(p_user_id::text) || '/preparations/' || lower(new_id::text) || '/source.heic';
  insert into public.vibode_photo_preparations (
    preparation_id, user_id, purpose, object_path, byte_size, status,
    created_at, updated_at, upload_expires_at
  ) values (
    new_id, p_user_id, p_purpose, new_path, p_byte_size, 'pending',
    p_now, p_now, p_now + interval '10 minutes'
  );

  return jsonb_build_object(
    'ok', true,
    'preparationId', new_id,
    'objectPath', new_path
  );
end;
$$;

create or replace function public.claim_vibode_photo_preparation(
  p_user_id uuid,
  p_preparation_id uuid,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.vibode_photo_preparations%rowtype;
begin
  if p_user_id is null or p_preparation_id is null or p_now is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into row
  from public.vibode_photo_preparations
  where preparation_id = p_preparation_id
  for update;

  if not found or row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if row.status = 'converting' and row.convert_lease_until is not null and row.convert_lease_until > p_now then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  if row.status <> 'pending' or row.upload_expires_at <= p_now then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  update public.vibode_photo_preparations
  set status = 'converting',
      convert_lease_until = p_now + interval '90 seconds',
      updated_at = p_now
  where preparation_id = p_preparation_id;

  return jsonb_build_object(
    'ok', true,
    'objectPath', row.object_path,
    'byteSize', row.byte_size,
    'purpose', row.purpose
  );
end;
$$;

create or replace function public.close_vibode_photo_preparation(
  p_user_id uuid,
  p_preparation_id uuid,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.vibode_photo_preparations%rowtype;
begin
  if p_user_id is null or p_preparation_id is null or p_now is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into row
  from public.vibode_photo_preparations
  where preparation_id = p_preparation_id
  for update;

  if not found or row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if row.status = 'closed' then
    return jsonb_build_object('ok', true, 'objectPath', row.object_path);
  end if;
  if row.status = 'converting' and row.convert_lease_until is not null and row.convert_lease_until > p_now then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;

  update public.vibode_photo_preparations
  set status = 'closed',
      convert_lease_until = null,
      updated_at = p_now
  where preparation_id = p_preparation_id;

  return jsonb_build_object('ok', true, 'objectPath', row.object_path);
end;
$$;

create or replace function public.finish_vibode_photo_preparation(
  p_user_id uuid,
  p_preparation_id uuid,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.vibode_photo_preparations%rowtype;
begin
  if p_user_id is null or p_preparation_id is null or p_now is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  update public.vibode_photo_preparations
  set status = 'closed',
      convert_lease_until = null,
      updated_at = p_now
  where preparation_id = p_preparation_id
    and user_id = p_user_id
    and status in ('pending', 'converting')
  returning * into row;

  if found then
    return jsonb_build_object('ok', true, 'objectPath', row.object_path);
  end if;

  select * into row
  from public.vibode_photo_preparations
  where preparation_id = p_preparation_id
    and user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'objectPath', row.object_path);
end;
$$;

create or replace function public.delete_vibode_photo_preparations_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  delete from public.vibode_photo_preparations
  where user_id = p_user_id;
  get diagnostics removed = row_count;

  return jsonb_build_object('ok', true, 'deleted', removed);
end;
$$;

revoke all on function public.sweep_vibode_photo_preparations(timestamptz) from public, anon, authenticated;
revoke all on function public.begin_vibode_photo_preparation(uuid, text, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_vibode_photo_preparation(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.close_vibode_photo_preparation(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_vibode_photo_preparation(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_vibode_photo_preparations_for_user(uuid) from public, anon, authenticated;

grant execute on function public.sweep_vibode_photo_preparations(timestamptz) to service_role;
grant execute on function public.begin_vibode_photo_preparation(uuid, text, bigint, timestamptz) to service_role;
grant execute on function public.claim_vibode_photo_preparation(uuid, uuid, timestamptz) to service_role;
grant execute on function public.close_vibode_photo_preparation(uuid, uuid, timestamptz) to service_role;
grant execute on function public.finish_vibode_photo_preparation(uuid, uuid, timestamptz) to service_role;
grant execute on function public.delete_vibode_photo_preparations_for_user(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-photo-preparations',
  'vibode-photo-preparations',
  false,
  26214400,
  array['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']::text[]
)
on conflict (id) do nothing;

drop policy if exists vibode_photo_preparation_deny_anon on storage.objects;
drop policy if exists vibode_photo_preparation_deny_authenticated on storage.objects;

create policy vibode_photo_preparation_deny_anon
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'vibode-photo-preparations')
with check (bucket_id <> 'vibode-photo-preparations');

create policy vibode_photo_preparation_deny_authenticated
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'vibode-photo-preparations')
with check (bucket_id <> 'vibode-photo-preparations');

commit;
