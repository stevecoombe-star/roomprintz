-- MESHY-1D.4H referential-cleanup exception for the deletion barrier.
--
-- 20261112180000 rejects every update of a barred account. PostgreSQL
-- implements ON DELETE SET NULL as an UPDATE fired by the foreign-key
-- trigger, so deleting a room, a generation run, a room asset, or the
-- auth user can fail after Storage cleanup has already happened.
--
-- pg_trigger_depth() is the documented nesting level of the trigger
-- currently executing. A statement issued by the client, including a
-- statement inside a security-definer function, fires this trigger at
-- depth 1. A foreign-key action is itself a trigger, so the nested
-- update fires at depth 2 or greater. current_query() is the text
-- submitted by the client, not the internal foreign-key statement.
--
-- An update is allowed only when all three are true: the trigger depth
-- is at least 2, the client statement is a DELETE, and every changed
-- column is an ON DELETE SET NULL foreign-key column whose new value is
-- null. No role is exempt. A client flag is not consulted. Triggers are
-- not disabled.
--
-- The trigger is renamed so it runs before set_timestamp and
-- set_updated_at. Those triggers rewrite updated_at, and a comparison
-- made after they run would reject a legitimate foreign-key update.
-- Their later rewrite of updated_at is their existing behavior.
--
-- This file does not release a hold, record provider consumption, or
-- change paid-submission history or the global control row. Do not apply
-- it to hosted Supabase without explicit approval.

begin;

create or replace function public.vibode_account_deletion_client_command_is_delete()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_query text := current_query();
  v_close integer;
  v_newline integer;
begin
  if v_query is null then
    return false;
  end if;
  loop
    v_query := btrim(v_query);
    if left(v_query, 2) = '/*' then
      v_close := position('*/' in v_query);
      if v_close = 0 then
        return false;
      end if;
      v_query := substr(v_query, v_close + 2);
      continue;
    end if;
    if left(v_query, 2) = '--' then
      v_newline := position(E'\n' in v_query);
      if v_newline = 0 then
        return false;
      end if;
      v_query := substr(v_query, v_newline + 1);
      continue;
    end if;
    exit;
  end loop;
  return upper(left(v_query, 6)) = 'DELETE';
end;
$fn$;

revoke all on function public.vibode_account_deletion_client_command_is_delete()
  from public, anon, authenticated, service_role;

create or replace function public.vibode_account_deletion_update_is_referential_cleanup(
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
  v_changed boolean := false;
  v_key text;
begin
  if pg_trigger_depth() < 2
     or not public.vibode_account_deletion_client_command_is_delete()
  then
    return false;
  end if;
  for v_key in
    select n.key
    from jsonb_each(p_new) as n(key, value)
    where n.value is distinct from p_old -> n.key
  loop
    v_changed := true;
    if jsonb_typeof(p_new -> v_key) is distinct from 'null' then
      return false;
    end if;
    if not exists (
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
    ) then
      return false;
    end if;
  end loop;
  return v_changed;
end;
$fn$;

revoke all on function public.vibode_account_deletion_update_is_referential_cleanup(oid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.vibode_account_deletion_block_owned_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_column text := tg_argv[0];
  v_new uuid;
  v_old uuid;
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    v_new := nullif(to_jsonb(new) ->> v_column, '')::uuid;
  end if;
  if tg_op = 'UPDATE' then
    v_old := nullif(to_jsonb(old) ->> v_column, '')::uuid;
  end if;
  if public.vibode_account_deletion_user_blocked(v_new)
    or public.vibode_account_deletion_user_blocked(v_old)
  then
    if tg_op = 'UPDATE'
       and public.vibode_account_deletion_update_is_referential_cleanup(
         tg_relid,
         to_jsonb(old),
         to_jsonb(new)
       )
    then
      return new;
    end if;
    raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

-- Run before timestamp triggers. Their names start with "set_".
do $rename$
declare
  v_schema text;
  v_table text;
  v_arg text;
begin
  for v_schema, v_table, v_arg in
    select n.nspname,
           c.relname,
           split_part(encode(t.tgargs, 'escape'), E'\\000', 1)
    from pg_trigger as t
    join pg_class as c on c.oid = t.tgrelid
    join pg_namespace as n on n.oid = c.relnamespace
    where t.tgname = 'vibode_account_deletion_block_write'
      and not t.tgisinternal
  loop
    if v_arg not in ('user_id', 'id') then
      raise exception 'VIBODE_ACCOUNT_DELETION:TRIGGER_ARGUMENT'
        using errcode = 'P0001';
    end if;
    execute format(
      'drop trigger vibode_account_deletion_block_write on %I.%I',
      v_schema,
      v_table
    );
    execute format(
      'create trigger a_vibode_account_deletion_block_write
       before insert or update on %I.%I
       for each row execute function public.vibode_account_deletion_block_owned_write(%L)',
      v_schema,
      v_table,
      v_arg
    );
  end loop;

  if to_regclass('public.profiles') is not null
     and exists (
       select 1
       from pg_attribute
       where attrelid = to_regclass('public.profiles')
         and attname = 'id'
         and atttypid = 'uuid'::regtype
         and not attisdropped
     )
     and not exists (
       select 1
       from pg_trigger as t
       where t.tgrelid = to_regclass('public.profiles')
         and not t.tgisinternal
         and split_part(encode(t.tgargs, 'escape'), E'\\000', 1) = 'id'
         and t.tgname in (
           'vibode_account_deletion_block_write',
           'a_vibode_account_deletion_block_write',
           'a_vibode_account_deletion_block_profile_id'
         )
     )
  then
    execute $sql$
      create trigger a_vibode_account_deletion_block_profile_id
      before insert or update on public.profiles
      for each row execute function public.vibode_account_deletion_block_owned_write('id')
    $sql$;
  end if;
end;
$rename$;

do $grant$
declare
  v_owner name := current_user;
begin
  execute format(
    'grant execute on function public.vibode_account_deletion_user_blocked(uuid) to %I',
    v_owner
  );
  execute format(
    'grant execute on function public.vibode_account_deletion_room_owner(uuid) to %I',
    v_owner
  );
  execute format(
    'grant execute on function public.vibode_account_deletion_path_blocked(text) to %I',
    v_owner
  );
  execute format(
    'grant execute on function public.vibode_account_deletion_client_command_is_delete() to %I',
    v_owner
  );
  execute format(
    'grant execute on function public.vibode_account_deletion_update_is_referential_cleanup(oid, jsonb, jsonb) to %I',
    v_owner
  );
end;
$grant$;

grant execute on function public.vibode_account_deletion_block_owned_write() to public;

commit;
