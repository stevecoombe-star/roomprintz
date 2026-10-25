-- Interim SAM 3 ceilings for public REMOVE, before Token billing.
--
-- These counters are not a payment ledger. They record one attempt per
-- reservation. Rows from earlier UTC days are removed inside the reservation
-- lock. Room deletion does not remove rows. Account deletion does.
-- Clean Up Room NBP limits are unchanged.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.

begin;

create table public.vibode_remove_segmentation_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  generation_id uuid not null,
  original_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint vibode_remove_segmentation_calls_sha_hex check (original_sha256 ~ '^[0-9a-f]{64}$')
);

create index vibode_remove_segmentation_calls_user_created_idx
  on public.vibode_remove_segmentation_calls (user_id, created_at);

create index vibode_remove_segmentation_calls_created_idx
  on public.vibode_remove_segmentation_calls (created_at);

alter table public.vibode_remove_segmentation_calls enable row level security;

revoke all on table public.vibode_remove_segmentation_calls from public, anon, authenticated, service_role;

comment on table public.vibode_remove_segmentation_calls is
  'SAM 3 reservation ledger. Current UTC day counts toward the ceilings. service_role has no table privileges. The security-definer reservation function inserts rows.';

create or replace function public.vibode_remove_segmentation_user_daily_limit()
returns integer
language sql
immutable
set search_path = pg_catalog
as $$ select 24; $$;

create or replace function public.vibode_remove_segmentation_global_daily_limit()
returns integer
language sql
immutable
set search_path = pg_catalog
as $$ select 200; $$;

create or replace function public.reserve_vibode_remove_segmentation(
  p_user_id uuid,
  p_room_id uuid,
  p_generation_id uuid,
  p_original_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid;
  v_user_count bigint;
  v_global_count bigint;
  v_day timestamptz;
begin
  if p_user_id is null or p_room_id is null or p_generation_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_original_sha256 is null or p_original_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select user_id into v_owner
  from public.vibode_rooms
  where id = p_room_id;
  if v_owner is null or v_owner is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not exists (
    select 1
    from public.vibode_afc_generations
    where id = p_generation_id
      and room_id = p_room_id
      and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-remove-segmentation')::bigint);

  v_day := (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc');

  delete from public.vibode_remove_segmentation_calls
  where created_at < v_day;

  select count(*) into v_user_count
  from public.vibode_remove_segmentation_calls
  where user_id = p_user_id
    and created_at >= v_day;
  if v_user_count >= public.vibode_remove_segmentation_user_daily_limit() then
    return jsonb_build_object('ok', false, 'code', 'user_limit');
  end if;

  select count(*) into v_global_count
  from public.vibode_remove_segmentation_calls
  where created_at >= v_day;
  if v_global_count >= public.vibode_remove_segmentation_global_daily_limit() then
    return jsonb_build_object('ok', false, 'code', 'global_limit');
  end if;

  insert into public.vibode_remove_segmentation_calls (
    user_id,
    room_id,
    generation_id,
    original_sha256
  ) values (
    p_user_id,
    p_room_id,
    p_generation_id,
    p_original_sha256
  );

  return jsonb_build_object('ok', true, 'code', 'reserved');
end;
$$;

comment on function public.reserve_vibode_remove_segmentation(uuid, uuid, uuid, text) is
  'Atomic SAM 3 reservation. Owner is the migration role. EXECUTE is service_role only. Per-user UTC cap 24, global UTC cap 200.';

revoke all on function public.vibode_remove_segmentation_user_daily_limit() from public, anon, authenticated;
revoke all on function public.vibode_remove_segmentation_global_daily_limit() from public, anon, authenticated;
revoke all on function public.reserve_vibode_remove_segmentation(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.vibode_remove_segmentation_user_daily_limit() to service_role;
grant execute on function public.vibode_remove_segmentation_global_daily_limit() to service_role;
grant execute on function public.reserve_vibode_remove_segmentation(uuid, uuid, uuid, text) to service_role;

commit;
