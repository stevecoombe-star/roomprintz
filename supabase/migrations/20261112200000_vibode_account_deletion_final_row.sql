-- MESHY-1D.4J final-row check for account-deletion cleanup.
--
-- 20261112190000 admits an update of a barred account when the client
-- statement is a DELETE, the trigger is nested, and the row it sees has
-- only ON DELETE SET NULL columns becoming null. A BEFORE UPDATE trigger
-- that runs later can still change business columns, and the admitted
-- update is then stored.
--
-- This migration does not treat trigger depth or current_query() as
-- proof that PostgreSQL's foreign-key engine produced the update. The
-- BEFORE trigger remains the admission check. This AFTER trigger reads
-- the row after ordinary BEFORE triggers have finished and rejects any
-- stored change that is not a null ON DELETE SET NULL foreign key, or
-- updated_at set to this transaction's timestamp by an existing
-- set_timestamp or set_updated_at trigger.
--
-- An owner-installed DELETE trigger that only nulls those foreign-key
-- columns still produces an allowed final row. That remains a table-owner
-- boundary, not evidence of an internal foreign-key action.
--
-- An AFTER trigger cannot rewrite NEW. An additional UPDATE it issues is
-- a new statement and passes through this same check.
--
-- The barrier row references auth.users with ON DELETE CASCADE, so that
-- row can disappear before later foreign-key updates in the same delete
-- finish. A guard row records that the delete started while a barrier
-- existed. It is not proof that an update came from the foreign-key
-- engine, and it is removed at transaction end. An owner of auth.users
-- can still remove that guard before the child updates run.
--
-- This file does not release a hold, record provider consumption, or
-- change paid-submission history or the global control row. Do not apply
-- it to hosted Supabase without explicit approval.

begin;

create or replace function public.vibode_account_deletion_final_row_allowed(
  p_relid oid,
  p_old jsonb,
  p_new jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_key text;
  v_timestamp_trigger boolean;
begin
  select exists (
    select 1
    from pg_trigger as rewrite
    join pg_proc as fn on fn.oid = rewrite.tgfoid
    where rewrite.tgrelid = p_relid
      and not rewrite.tgisinternal
      and (rewrite.tgtype::integer & 18) = 18
      and fn.pronamespace = 'public'::regnamespace
      and fn.pronargs = 0
      and fn.proname in ('set_timestamp', 'set_updated_at')
  ) into v_timestamp_trigger;

  for v_key in
    select changed.key
    from jsonb_each(p_new) as changed(key, value)
    where changed.value is distinct from p_old -> changed.key
  loop
    if jsonb_typeof(p_new -> v_key) = 'null'
       and exists (
         select 1
         from pg_constraint as fk
         join pg_attribute as attribute
           on attribute.attrelid = fk.conrelid
          and attribute.attnum = any (fk.conkey)
          and not attribute.attisdropped
         where fk.conrelid = p_relid
           and fk.contype = 'f'
           and fk.confdeltype = 'n'
           and attribute.attname = v_key
       )
    then
      continue;
    end if;

    if v_key = 'updated_at'
       and v_timestamp_trigger
       and (p_new ->> 'updated_at') is not null
       and (p_new ->> 'updated_at')::timestamptz = transaction_timestamp()
    then
      continue;
    end if;

    return false;
  end loop;

  return true;
end;
$fn$;

revoke all on function public.vibode_account_deletion_final_row_allowed(oid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.vibode_account_deletion_enforce_final_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_column text;
  v_blocked boolean := false;
begin
  for v_column in
    select distinct split_part(encode(watched.tgargs, 'escape'), E'\\000', 1)
    from pg_trigger as watched
    where watched.tgrelid = tg_relid
      and not watched.tgisinternal
      and watched.tgname in (
        'a_vibode_account_deletion_block_write',
        'a_vibode_account_deletion_block_profile_id'
      )
  loop
    if v_column not in ('user_id', 'id') then
      raise exception 'VIBODE_ACCOUNT_DELETION:TRIGGER_ARGUMENT'
        using errcode = 'P0001';
    end if;
    if public.vibode_account_deletion_user_blocked(nullif(v_new ->> v_column, '')::uuid)
       or public.vibode_account_deletion_user_blocked(nullif(v_old ->> v_column, '')::uuid)
    then
      v_blocked := true;
    end if;
  end loop;

  if not v_blocked then
    return null;
  end if;

  if public.vibode_account_deletion_final_row_allowed(tg_relid, v_old, v_new) then
    return null;
  end if;

  raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
    using errcode = 'P0001';
end;
$fn$;

revoke all on function public.vibode_account_deletion_enforce_final_row()
  from public, anon, authenticated, service_role;
grant execute on function public.vibode_account_deletion_enforce_final_row() to public;

create or replace function public.vibode_account_deletion_enforce_final_storage_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if public.vibode_account_deletion_path_blocked(new.name)
     or (
       tg_op = 'UPDATE'
       and public.vibode_account_deletion_path_blocked(old.name)
     )
  then
    raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
      using errcode = 'P0001';
  end if;
  return null;
end;
$fn$;

revoke all on function public.vibode_account_deletion_enforce_final_storage_row()
  from public, anon, authenticated, service_role;
grant execute on function public.vibode_account_deletion_enforce_final_storage_row() to public;

do $attach$
declare
  v_schema text;
  v_table text;
begin
  for v_schema, v_table in
    select distinct n.nspname, c.relname
    from pg_trigger as watched
    join pg_class as c on c.oid = watched.tgrelid
    join pg_namespace as n on n.oid = c.relnamespace
    where not watched.tgisinternal
      and watched.tgname in (
        'a_vibode_account_deletion_block_write',
        'a_vibode_account_deletion_block_profile_id'
      )
      and not exists (
        select 1
        from pg_trigger as existing
        where existing.tgrelid = watched.tgrelid
          and existing.tgname = 'z_vibode_account_deletion_final_row'
          and not existing.tgisinternal
      )
  loop
    execute format(
      'create trigger z_vibode_account_deletion_final_row
       after update on %I.%I
       for each row execute function public.vibode_account_deletion_enforce_final_row()',
      v_schema,
      v_table
    );
  end loop;

  if to_regclass('storage.objects') is not null
     and exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('storage.objects')
         and tgname = 'vibode_account_deletion_block_storage_write'
         and not tgisinternal
     )
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('storage.objects')
         and tgname = 'z_vibode_account_deletion_final_storage_row'
         and not tgisinternal
     )
  then
    execute
      'create trigger z_vibode_account_deletion_final_storage_row
       after insert or update on storage.objects
       for each row execute function public.vibode_account_deletion_enforce_final_storage_row()';
  end if;
end;
$attach$;

create table if not exists public.vibode_account_deletion_cascade_guard (
  account_id uuid primary key
);

comment on table public.vibode_account_deletion_cascade_guard is
  'Accounts whose auth-user delete started while a deletion barrier existed. The row lasts until the deleting transaction ends. It has no foreign key, so the barrier cascade does not remove it.';

alter table public.vibode_account_deletion_cascade_guard enable row level security;

revoke all on table public.vibode_account_deletion_cascade_guard
  from public, anon, authenticated, service_role;

create or replace function public.vibode_account_deletion_user_blocked(
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
  select p_user_id is not null
    and (
      exists (
        select 1
        from public.vibode_account_deletion_barriers
        where user_id = p_user_id
      )
      or exists (
        select 1
        from public.vibode_account_deletion_cascade_guard
        where account_id = p_user_id
      )
    );
$fn$;

create or replace function public.vibode_account_deletion_note_cascade()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if public.vibode_account_deletion_user_blocked(old.id) then
    insert into public.vibode_account_deletion_cascade_guard (account_id)
    values (old.id)
    on conflict (account_id) do nothing;
  end if;
  return old;
end;
$fn$;

create or replace function public.vibode_account_deletion_clear_cascade_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  delete from public.vibode_account_deletion_cascade_guard
  where account_id = old.id;
  return null;
end;
$fn$;

revoke all on function public.vibode_account_deletion_note_cascade()
  from public, anon, authenticated, service_role;
grant execute on function public.vibode_account_deletion_note_cascade() to public;

revoke all on function public.vibode_account_deletion_clear_cascade_guard()
  from public, anon, authenticated, service_role;
grant execute on function public.vibode_account_deletion_clear_cascade_guard() to public;

do $cascade_guard$
begin
  if to_regclass('auth.users') is null then
    return;
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = to_regclass('auth.users')
      and tgname = 'a_vibode_account_deletion_note_cascade'
      and not tgisinternal
  ) then
    execute
      'create trigger a_vibode_account_deletion_note_cascade
       before delete on auth.users
       for each row execute function public.vibode_account_deletion_note_cascade()';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = to_regclass('auth.users')
      and tgname = 'z_vibode_account_deletion_clear_cascade_guard'
      and not tgisinternal
  ) then
    execute
      'create constraint trigger z_vibode_account_deletion_clear_cascade_guard
       after delete on auth.users
       deferrable initially deferred
       for each row execute function public.vibode_account_deletion_clear_cascade_guard()';
  end if;
end;
$cascade_guard$;

do $grant$
declare
  v_owner name := current_user;
begin
  execute format(
    'grant execute on function public.vibode_account_deletion_final_row_allowed(oid, jsonb, jsonb) to %I',
    v_owner
  );
  execute format(
    'grant execute on function public.vibode_account_deletion_user_blocked(uuid) to %I',
    v_owner
  );
  execute format(
    'grant execute on function public.vibode_account_deletion_path_blocked(text) to %I',
    v_owner
  );
end;
$grant$;

commit;
