-- Keep scratch-photo tracking past the signed upload token.
-- @supabase/storage-js createSignedUploadUrl is valid for 2 hours and sends
-- no expiry, so this application cannot shorten it. The token is minted when
-- the row is created. A 25 MiB upload that starts just before that token
-- expires still finishes within 30 minutes at about 100 KB/s, which is the
-- margin below. The row is the cleanup record, not the photograph.

begin;

alter table public.vibode_photo_preparations
  add column object_cleared_at timestamptz;

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
      and (
        object_cleared_at is null
        or (
          p_now < created_at + interval '2 hours 30 minutes'
          and object_cleared_at <= p_now - interval '10 minutes'
        )
        or (
          p_now >= created_at + interval '2 hours 30 minutes'
          and object_cleared_at < created_at + interval '2 hours 30 minutes'
        )
      )
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

  return jsonb_build_object('ok', true, 'paths', to_jsonb(paths));
end;
$$;

create or replace function public.confirm_vibode_photo_preparation_cleared(
  p_object_path text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.vibode_photo_preparations%rowtype;
begin
  if p_now is null or p_object_path is null or p_object_path !~ '^users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/preparations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.heic$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into row
  from public.vibode_photo_preparations
  where object_path = p_object_path
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'retired', false);
  end if;
  if row.status = 'pending' and row.upload_expires_at > p_now then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  if row.status = 'converting' and row.convert_lease_until is not null and row.convert_lease_until > p_now then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;

  update public.vibode_photo_preparations
  set object_cleared_at = p_now
  where preparation_id = row.preparation_id;

  if row.status = 'closed' and row.created_at + interval '2 hours 30 minutes' <= p_now then
    delete from public.vibode_photo_preparations
    where preparation_id = row.preparation_id;
    return jsonb_build_object('ok', true, 'retired', true);
  end if;

  return jsonb_build_object('ok', true, 'retired', false);
end;
$$;

create or replace function public.list_orphan_vibode_photo_preparations(p_now timestamptz)
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
    select o.name
    from storage.objects o
    where o.bucket_id = 'vibode-photo-preparations'
      and o.created_at <= p_now - interval '15 minutes'
      and o.name ~ '^users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/preparations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/source\.heic$'
      and not exists (
        select 1
        from public.vibode_photo_preparations p
        where p.object_path = o.name
      )
    order by o.created_at
    limit 40
  loop
    paths := array_append(paths, rec.name);
  end loop;

  return jsonb_build_object('ok', true, 'paths', to_jsonb(paths));
end;
$$;

revoke all on function public.sweep_vibode_photo_preparations(timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_vibode_photo_preparation_cleared(text, timestamptz) from public, anon, authenticated;
revoke all on function public.list_orphan_vibode_photo_preparations(timestamptz) from public, anon, authenticated;

grant execute on function public.sweep_vibode_photo_preparations(timestamptz) to service_role;
grant execute on function public.confirm_vibode_photo_preparation_cleared(text, timestamptz) to service_role;
grant execute on function public.list_orphan_vibode_photo_preparations(timestamptz) to service_role;

commit;
