-- Candidate only. BLOCKED FROM APPLICATION.
--
-- Allowlisted development accounts get a separate 200-scan UTC daily
-- ceiling. Their rows stay in vibode_remove_segmentation_calls and are
-- omitted from the public global count. Every other account keeps the
-- public 24-per-user and 200-global UTC ceilings.
--
-- The allowlist is created empty. Membership is the only exemption.
-- The reservation signature is unchanged. There is no client flag and
-- the function does not read an environment variable or GUC.
--
-- This candidate replaces reserve_vibode_remove_segmentation from the
-- repository body in
-- 20261021180000_vibode_remove_segmentation_limits.sql.
-- That earlier file stays immutable history.
-- The deployed function body has not been read with pg_get_functiondef.
-- Do not apply this file to hosted Supabase until a separately authorized
-- privileged read shows the live body still matches that repository
-- definition. Clean Up Room limits are unchanged.
--
-- The guard below aborts the transaction before any DDL. The session
-- setting is an apply-time interlock for that read, not a quota bypass.
-- Do not set it in Preview, Production, or application environment.

begin;

do $guard$
begin
  if current_setting('vibode.apply_remove_segmentation_dev_exemption', true)
       is distinct from 'verified-function-def' then
    raise exception
      'BLOCKED FROM APPLICATION. Read pg_get_functiondef of public.reserve_vibode_remove_segmentation(uuid,uuid,uuid,text) and confirm it matches 20261021180000_vibode_remove_segmentation_limits.sql before applying this candidate.';
  end if;
end
$guard$;

create table public.vibode_remove_segmentation_dev_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.vibode_remove_segmentation_dev_allowlist enable row level security;

revoke all on table public.vibode_remove_segmentation_dev_allowlist
  from public, anon, authenticated, service_role;

comment on table public.vibode_remove_segmentation_dev_allowlist is
  'Development SAM 3 exemption. Empty unless a privileged operator inserts a user id. No client flag. service_role has no table privileges. The reservation function reads membership inside its lock.';

create or replace function public.vibode_remove_segmentation_dev_daily_limit()
returns integer
language sql
immutable
set search_path = pg_catalog
as $$ select 200; $$;

comment on function public.vibode_remove_segmentation_dev_daily_limit() is
  'Separate UTC SAM 3 ceiling for vibode_remove_segmentation_dev_allowlist. Public ceilings stay 24 per user and 200 global.';

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
  v_dev boolean;
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

  select exists (
    select 1
    from public.vibode_remove_segmentation_dev_allowlist
    where user_id = p_user_id
  ) into v_dev;

  select count(*) into v_user_count
  from public.vibode_remove_segmentation_calls
  where user_id = p_user_id
    and created_at >= v_day;

  if v_dev then
    if v_user_count >= public.vibode_remove_segmentation_dev_daily_limit() then
      return jsonb_build_object('ok', false, 'code', 'user_limit');
    end if;
  else
    if v_user_count >= public.vibode_remove_segmentation_user_daily_limit() then
      return jsonb_build_object('ok', false, 'code', 'user_limit');
    end if;

    select count(*) into v_global_count
    from public.vibode_remove_segmentation_calls as ledger
    where ledger.created_at >= v_day
      and not exists (
        select 1
        from public.vibode_remove_segmentation_dev_allowlist as allowlist
        where allowlist.user_id = ledger.user_id
      );
    if v_global_count >= public.vibode_remove_segmentation_global_daily_limit() then
      return jsonb_build_object('ok', false, 'code', 'global_limit');
    end if;
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
  'Atomic SAM 3 reservation. Owner is the migration role. EXECUTE is service_role only. Public per-user UTC cap 24. Public global UTC cap 200, excluding allowlisted development rows. Allowlisted development users have a separate UTC cap of 200.';

revoke all on function public.vibode_remove_segmentation_dev_daily_limit()
  from public, anon, authenticated;
revoke all on function public.reserve_vibode_remove_segmentation(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.vibode_remove_segmentation_dev_daily_limit() to service_role;
grant execute on function public.reserve_vibode_remove_segmentation(uuid, uuid, uuid, text) to service_role;

commit;
