-- SEC-20C: service-role reservation and completion for paid room-image reads.
--
-- Unapplied. Do not execute this file against hosted Supabase from the patch.
--
-- Reservation contract, all of which are required together:
--   {"ok":true,"code":"reserved","attemptId":"<uuid>"}
--   {"ok":false,"code":"busy","attemptId":null}
--   {"ok":false,"code":"user_quota","attemptId":null}
--   {"ok":false,"code":"global_quota","attemptId":null}
--   {"ok":false,"code":"forbidden","attemptId":null}
--   {"ok":false,"code":"invalid","attemptId":null}
-- A missing attemptId, a non-boolean ok, or any other code is not success.
--
-- Completion contract:
--   {"ok":true,"code":"completed","attemptId":"<uuid>","outcome":"succeeded"|"failed"}
--   {"ok":true,"code":"already_terminal","attemptId":"<uuid>","outcome":"succeeded"|"failed"|"timed_out"}
--   {"ok":false,"code":"forbidden","attemptId":null}
--   {"ok":false,"code":"invalid","attemptId":null}
-- Completion keeps the row for the UTC daily count. It never reopens a terminal row.
--
-- Caps count every row created in the current UTC day, including in_flight,
-- timed_out, failed, and succeeded. A timed-out in-flight row stops blocking
-- the same user+asset+mode and still counts. Denied reservations do not insert.
-- The global advisory lock (8142, 20261023) serializes the count and insert.
-- It does not share Harmonize's (8142, 20261015) or (8142, 20261016) locks.
-- Room and asset ids are not foreign keys so deleting a room cannot erase the
-- daily count and cannot fail because attempt rows exist. Ownership is checked
-- against the live room and asset rows inside the transaction.

begin;

create table public.vibode_room_image_read_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  room_id uuid not null,
  asset_id uuid not null,
  mode text not null,
  operation text not null,
  status text not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  completed_at timestamptz null,
  constraint vibode_room_image_read_attempts_mode_chk
    check (mode in ('labels_only', 'geometry')),
  constraint vibode_room_image_read_attempts_operation_chk
    check (operation = 'room_image_read'),
  constraint vibode_room_image_read_attempts_status_chk
    check (status in ('in_flight', 'timed_out', 'failed', 'succeeded')),
  constraint vibode_room_image_read_attempts_expiry_chk
    check (expires_at > created_at)
);

create index vibode_room_image_read_attempts_user_created_idx
  on public.vibode_room_image_read_attempts (user_id, created_at);

create index vibode_room_image_read_attempts_created_idx
  on public.vibode_room_image_read_attempts (created_at);

create unique index vibode_room_image_read_attempts_one_inflight_uidx
  on public.vibode_room_image_read_attempts (user_id, asset_id, mode)
  where status = 'in_flight';

create index vibode_room_image_read_attempts_inflight_expiry_idx
  on public.vibode_room_image_read_attempts (expires_at)
  where status = 'in_flight';

alter table public.vibode_room_image_read_attempts enable row level security;

revoke all on table public.vibode_room_image_read_attempts from public, anon, authenticated, service_role;

comment on table public.vibode_room_image_read_attempts is
  'Paid room-image read attempts. Daily caps count every status. Only the security-definer reservation function inserts rows.';

create or replace function public.reserve_vibode_room_image_read(
  p_user_id uuid,
  p_room_id uuid,
  p_asset_id uuid,
  p_mode text,
  p_operation text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_user_count integer;
  v_global_count integer;
  v_attempt_id uuid;
begin
  if p_user_id is null or p_room_id is null or p_asset_id is null
     or p_operation is distinct from 'room_image_read'
     or (p_mode is distinct from 'labels_only' and p_mode is distinct from 'geometry') then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid', 'attemptId', null);
  end if;

  -- Global lock first, then the user+asset+mode lock. Every caller uses this order.
  perform pg_catalog.pg_advisory_xact_lock(8142, 20261023);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_asset_id::text || ':' || p_mode,
      20261023
    )
  );

  if not exists (
    select 1
    from public.vibode_rooms
    where id = p_room_id
      and user_id = p_user_id
  ) or not exists (
    select 1
    from public.vibode_room_assets
    where id = p_asset_id
      and room_id = p_room_id
      and user_id = p_user_id
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden', 'attemptId', null);
  end if;

  update public.vibode_room_image_read_attempts
    set status = 'timed_out',
        completed_at = coalesce(completed_at, pg_catalog.now())
  where status = 'in_flight'
    and expires_at <= pg_catalog.now();

  v_day_start := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'utc') at time zone 'utc');
  v_day_end := v_day_start + interval '1 day';

  select count(*)::integer
    into v_user_count
  from public.vibode_room_image_read_attempts
  where user_id = p_user_id
    and created_at >= v_day_start
    and created_at < v_day_end;

  if v_user_count >= 24 then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'user_quota', 'attemptId', null);
  end if;

  select count(*)::integer
    into v_global_count
  from public.vibode_room_image_read_attempts
  where created_at >= v_day_start
    and created_at < v_day_end;

  if v_global_count >= 200 then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'global_quota', 'attemptId', null);
  end if;

  perform 1
  from public.vibode_room_image_read_attempts
  where user_id = p_user_id
    and asset_id = p_asset_id
    and mode = p_mode
    and status = 'in_flight'
    and expires_at > pg_catalog.now()
  for update;

  if found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'busy', 'attemptId', null);
  end if;

  insert into public.vibode_room_image_read_attempts (
    user_id,
    room_id,
    asset_id,
    mode,
    operation,
    status,
    expires_at
  ) values (
    p_user_id,
    p_room_id,
    p_asset_id,
    p_mode,
    'room_image_read',
    'in_flight',
    pg_catalog.now() + interval '5 minutes'
  )
  returning id into v_attempt_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'reserved',
    'attemptId', v_attempt_id
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'busy', 'attemptId', null);
end;
$$;

comment on function public.reserve_vibode_room_image_read(uuid, uuid, uuid, text, text) is
  'Atomic room-image read reservation. Owner is the migration role. EXECUTE is service_role only. Per-user UTC cap 24, global UTC cap 200, in-flight TTL 5 minutes.';

revoke all on function public.reserve_vibode_room_image_read(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.reserve_vibode_room_image_read(uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.complete_vibode_room_image_read(
  p_user_id uuid,
  p_attempt_id uuid,
  p_outcome text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_asset_id uuid;
  v_mode text;
  v_status text;
begin
  if p_user_id is null
     or p_attempt_id is null
     or (p_outcome is distinct from 'succeeded' and p_outcome is distinct from 'failed') then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid', 'attemptId', null);
  end if;

  -- Global lock first, the same first lock reserve takes. The per-key lock
  -- comes second, and only after this transaction holds the global lock.
  perform pg_catalog.pg_advisory_xact_lock(8142, 20261023);

  select user_id, asset_id, mode, status
    into v_owner, v_asset_id, v_mode, v_status
  from public.vibode_room_image_read_attempts
  where id = p_attempt_id;

  if not found or v_owner is distinct from p_user_id then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden', 'attemptId', null);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || v_asset_id::text || ':' || v_mode,
      20261023
    )
  );

  select status
    into v_status
  from public.vibode_room_image_read_attempts
  where id = p_attempt_id
    and user_id = p_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden', 'attemptId', null);
  end if;

  if v_status is distinct from 'in_flight' then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'code', 'already_terminal',
      'attemptId', p_attempt_id,
      'outcome', v_status
    );
  end if;

  update public.vibode_room_image_read_attempts
    set status = p_outcome,
        completed_at = pg_catalog.now()
  where id = p_attempt_id
    and user_id = p_user_id
    and status = 'in_flight';

  if not found then
    select status
      into v_status
    from public.vibode_room_image_read_attempts
    where id = p_attempt_id
      and user_id = p_user_id;
    if not found then
      return pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden', 'attemptId', null);
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'code', 'already_terminal',
      'attemptId', p_attempt_id,
      'outcome', v_status
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'completed',
    'attemptId', p_attempt_id,
    'outcome', p_outcome
  );
end;
$$;

comment on function public.complete_vibode_room_image_read(uuid, uuid, text) is
  'Releases one room-image read lease. Owner is the migration role. EXECUTE is service_role only. The row stays for UTC daily accounting. Terminal rows are not reopened.';

revoke all on function public.complete_vibode_room_image_read(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.complete_vibode_room_image_read(uuid, uuid, text)
  to service_role;

commit;
