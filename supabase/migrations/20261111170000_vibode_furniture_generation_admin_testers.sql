-- MESHY-1D.3B beta tester management.
--
-- Administrators approve an existing account, set an explicit generation
-- total, change classification, and enable or disable future reservations.
-- Reserved and consumed counts stay untouched. Global spending controls
-- stay untouched. Allowance events remain append-only.
--
-- Admin changes take the same advisory lock as generation reservation,
-- then lock the allowance row. A stale expected timestamp writes nothing,
-- so a waiting administrator cannot overwrite a change that committed first.
-- Review before applying. Do not apply to hosted Supabase without approval.

begin;

alter table public.vibode_furniture_generation_allowance_events
  add column classification_before text null,
  add column classification_after text null,
  add column enabled_before boolean null,
  add column enabled_after boolean null;

alter table public.vibode_furniture_generation_allowance_events
  drop constraint vibode_furniture_generation_allowance_events_actor;

alter table public.vibode_furniture_generation_allowance_events
  add constraint vibode_furniture_generation_allowance_events_actor
  check (
    (
      actor_kind = 'administrator'
      and actor_user_id is not null
      and action in ('grant', 'adjust', 'enable', 'disable', 'restore', 'classify')
    )
    or (
      actor_kind = 'system'
      and actor_user_id is null
      and job_id is not null
      and action in ('reserve', 'release', 'consume')
    )
  );

alter table public.vibode_furniture_generation_allowance_events
  add constraint vibode_fg_events_classification_before
  check (
    classification_before is null
    or classification_before in ('individual_beta', 'furniture_partner')
  );

alter table public.vibode_furniture_generation_allowance_events
  add constraint vibode_fg_events_classification_after
  check (
    classification_after is null
    or classification_after in ('individual_beta', 'furniture_partner')
  );

alter table public.vibode_furniture_generation_allowance_events
  add constraint vibode_fg_events_context_actor
  check (
    actor_kind = 'administrator'
    or (
      classification_before is null
      and classification_after is null
      and enabled_before is null
      and enabled_after is null
    )
  );

comment on column public.vibode_furniture_generation_allowance_events.classification_before is
  'Classification before an administrator change. Null on older events and on system lifecycle events.';

comment on column public.vibode_furniture_generation_allowance_events.classification_after is
  'Classification after an administrator change. Null on older events and on system lifecycle events.';

comment on column public.vibode_furniture_generation_allowance_events.enabled_before is
  'Enabled state before an administrator change. Null on older events and on system lifecycle events.';

comment on column public.vibode_furniture_generation_allowance_events.enabled_after is
  'Enabled state after an administrator change. Null on older events and on system lifecycle events.';

create or replace function public.vibode_furniture_generation_admin_allowance_events(
  p_user_id uuid,
  p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_events jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'action', case action
      when 'grant' then 'grant'
      when 'adjust' then 'adjust'
      when 'enable' then 'enable'
      when 'disable' then 'disable'
      when 'restore' then 'restore'
      when 'classify' then 'classify'
      when 'reserve' then 'reserve'
      when 'release' then 'release'
      when 'consume' then 'consume'
      else null
    end,
    'reason', public.vibode_furniture_generation_admin_text(reason, 200),
    'actor_kind', case actor_kind
      when 'administrator' then 'administrator'
      when 'system' then 'system'
      else null
    end,
    'actor_user_id', actor_user_id,
    'delta_authorized', delta_authorized,
    'delta_reserved', delta_reserved,
    'delta_consumed', delta_consumed,
    'job_id', job_id,
    'classification_before', classification_before,
    'classification_after', classification_after,
    'enabled_before', enabled_before,
    'enabled_after', enabled_after,
    'created_at', created_at
  ) order by created_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from (
    select *
    from public.vibode_furniture_generation_allowance_events
    where (p_job_id is not null and job_id = p_job_id)
      or (p_job_id is null and p_user_id is not null and user_id = p_user_id)
    order by created_at desc, event_id desc
    limit 50
  ) events;
  return v_events;
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_match_account(
  p_email text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ids uuid[];
begin
  if v_email = ''
    or char_length(v_email) > 320
    or position('@' in v_email) = 0
    or position(' ' in v_email) > 0
    or v_email ~* '(users/|candidate\.glb|msy_|api\.meshy|://|supabase\.co)'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'email'
  ) then
    return jsonb_build_object('ok', false, 'code', 'email_unavailable');
  end if;
  begin
    execute
      'select coalesce(array_agg(id order by id), array[]::uuid[]) from auth.users where email is not null and lower(btrim(email)) = $1'
      into v_ids
      using v_email;
  exception
    when insufficient_privilege or undefined_column then
      return jsonb_build_object('ok', false, 'code', 'email_unavailable');
  end;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if array_length(v_ids, 1) > 1 then
    return jsonb_build_object('ok', false, 'code', 'ambiguous_account');
  end if;
  return jsonb_build_object('ok', true, 'user_id', v_ids[1]);
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_tester_record(
  p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_record jsonb;
begin
  select jsonb_build_object(
    'user_id', allowance.user_id,
    'email', public.vibode_furniture_generation_admin_account_email(allowance.user_id),
    'classification', case allowance.classification
      when 'individual_beta' then 'individual_beta'
      when 'furniture_partner' then 'furniture_partner'
      else null
    end,
    'enabled', allowance.enabled,
    'authorized_generations', allowance.authorized_generations,
    'reserved_generations', allowance.reserved_generations,
    'consumed_generations', allowance.consumed_generations,
    'remaining_generations', allowance.authorized_generations - allowance.reserved_generations - allowance.consumed_generations,
    'updated_at', allowance.updated_at
  )
  into v_record
  from public.vibode_furniture_generation_allowances as allowance
  where allowance.user_id = p_user_id;
  return v_record;
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_append_event(
  p_user_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_delta_authorized integer,
  p_reason text,
  p_classification_before text,
  p_classification_after text,
  p_enabled_before boolean,
  p_enabled_after boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  insert into public.vibode_furniture_generation_allowance_events (
    user_id, actor_kind, actor_user_id, action,
    delta_authorized, delta_reserved, delta_consumed, job_id, reason,
    classification_before, classification_after, enabled_before, enabled_after,
    created_at
  ) values (
    p_user_id, 'administrator', p_actor_user_id, p_action,
    p_delta_authorized, 0, 0, null, p_reason,
    p_classification_before, p_classification_after, p_enabled_before, p_enabled_after,
    clock_timestamp()
  );
end;
$fn$;

create or replace function public.vibode_furniture_generation_admin_reason(
  p_reason text
) returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 1
    or char_length(v_reason) > 200
    or v_reason ~ '[[:cntrl:]]'
    or v_reason ~* '(users/|candidate\.glb|msy_|api\.meshy|://|supabase\.co)'
  then
    return null;
  end if;
  return v_reason;
end;
$fn$;

create or replace function public.admin_approve_vibode_furniture_generation_tester(
  p_actor_user_id uuid,
  p_email text,
  p_classification text,
  p_authorized_generations integer,
  p_enabled boolean,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_reason text;
  v_match jsonb;
  v_user uuid;
  v_row public.vibode_furniture_generation_allowances%rowtype;
begin
  if p_actor_user_id is null
    or not exists (select 1 from auth.users where id = p_actor_user_id)
    or p_classification not in ('individual_beta', 'furniture_partner')
    or p_authorized_generations is null
    or p_authorized_generations < 0
    or p_authorized_generations > 50
    or p_enabled is null
  then
    return jsonb_build_object(
      'ok', false,
      'code', case
        when p_classification is null or p_classification not in ('individual_beta', 'furniture_partner') then 'invalid_classification'
        when p_authorized_generations is null or p_authorized_generations < 0 or p_authorized_generations > 50 then 'invalid_allowance'
        else 'invalid_input'
      end
    );
  end if;
  v_reason := public.vibode_furniture_generation_admin_reason(p_reason);
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
  v_match := public.vibode_furniture_generation_admin_match_account(p_email);
  if coalesce((v_match->>'ok')::boolean, false) is distinct from true then
    return v_match;
  end if;
  v_user := (v_match->>'user_id')::uuid;

  select * into v_row
  from public.vibode_furniture_generation_allowances
  where user_id = v_user
  for update;
  if found then
    if v_row.classification = p_classification
      and v_row.authorized_generations = p_authorized_generations
      and v_row.enabled = p_enabled
    then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'unchanged', false,
        'tester', public.vibode_furniture_generation_admin_tester_record(v_user)
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_approved');
  end if;

  insert into public.vibode_furniture_generation_allowances (
    user_id, classification, enabled, authorized_generations,
    reserved_generations, consumed_generations, updated_by
  ) values (
    v_user, p_classification, p_enabled, p_authorized_generations, 0, 0, p_actor_user_id
  );
  perform public.vibode_furniture_generation_admin_append_event(
    v_user, p_actor_user_id, 'grant', p_authorized_generations, v_reason,
    null, p_classification, null, p_enabled
  );
  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'unchanged', false,
    'tester', public.vibode_furniture_generation_admin_tester_record(v_user)
  );
end;
$fn$;

create or replace function public.admin_update_vibode_furniture_generation_tester(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_classification text,
  p_authorized_generations integer,
  p_enabled boolean,
  p_expected_updated_at timestamptz,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_reason text;
  v_row public.vibode_furniture_generation_allowances%rowtype;
  v_classification text;
  v_enabled boolean;
  v_authorized integer;
  v_delta integer;
begin
  if p_actor_user_id is null
    or p_user_id is null
    or p_expected_updated_at is null
    or not exists (select 1 from auth.users where id = p_actor_user_id)
    or p_classification not in ('individual_beta', 'furniture_partner')
    or p_authorized_generations is null
    or p_authorized_generations < 0
    or p_authorized_generations > 50
    or p_enabled is null
  then
    return jsonb_build_object(
      'ok', false,
      'code', case
        when p_classification is null or p_classification not in ('individual_beta', 'furniture_partner') then 'invalid_classification'
        when p_authorized_generations is null or p_authorized_generations < 0 or p_authorized_generations > 50 then 'invalid_allowance'
        else 'invalid_input'
      end
    );
  end if;
  v_reason := public.vibode_furniture_generation_admin_reason(p_reason);
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_row
  from public.vibode_furniture_generation_allowances
  where user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end if;
  if p_authorized_generations < v_row.reserved_generations + v_row.consumed_generations then
    return jsonb_build_object('ok', false, 'code', 'allowance_obligation');
  end if;
  if v_row.classification = p_classification
    and v_row.authorized_generations = p_authorized_generations
    and v_row.enabled = p_enabled
  then
    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'unchanged', true,
      'tester', public.vibode_furniture_generation_admin_tester_record(p_user_id)
    );
  end if;

  v_classification := v_row.classification;
  v_enabled := v_row.enabled;
  v_authorized := v_row.authorized_generations;
  update public.vibode_furniture_generation_allowances
  set classification = p_classification,
    authorized_generations = p_authorized_generations,
    enabled = p_enabled,
    updated_by = p_actor_user_id
  where user_id = p_user_id;

  if p_classification is distinct from v_classification then
    perform public.vibode_furniture_generation_admin_append_event(
      p_user_id, p_actor_user_id, 'classify', 0, v_reason,
      v_classification, p_classification, v_enabled, v_enabled
    );
    v_classification := p_classification;
  end if;
  if p_authorized_generations is distinct from v_authorized then
    v_delta := p_authorized_generations - v_authorized;
    perform public.vibode_furniture_generation_admin_append_event(
      p_user_id, p_actor_user_id,
      case when v_delta > 0 then 'restore' else 'adjust' end,
      v_delta, v_reason,
      v_classification, v_classification, v_enabled, v_enabled
    );
    v_authorized := p_authorized_generations;
  end if;
  if p_enabled is distinct from v_enabled then
    perform public.vibode_furniture_generation_admin_append_event(
      p_user_id, p_actor_user_id,
      case when p_enabled then 'enable' else 'disable' end,
      0, v_reason,
      v_classification, v_classification, v_enabled, p_enabled
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'unchanged', false,
    'tester', public.vibode_furniture_generation_admin_tester_record(p_user_id)
  );
end;
$fn$;

comment on function public.admin_approve_vibode_furniture_generation_tester(uuid, text, text, integer, boolean, text) is
  'Approve an existing account with an explicit allowance. The same terms are idempotent. Different terms for an approved account are rejected.';

comment on function public.admin_update_vibode_furniture_generation_tester(uuid, uuid, text, integer, boolean, timestamptz, text) is
  'Set an approved tester total, classification, and enabled state. Takes the generation advisory lock. A stale timestamp writes nothing.';

revoke all on function public.vibode_furniture_generation_admin_allowance_events(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vibode_furniture_generation_admin_allowance_events(uuid, uuid) to service_role;

revoke all on function public.vibode_furniture_generation_admin_match_account(text) from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_admin_tester_record(uuid) from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_admin_append_event(uuid, uuid, text, integer, text, text, text, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.vibode_furniture_generation_admin_reason(text) from public, anon, authenticated, service_role;

revoke all on function public.admin_approve_vibode_furniture_generation_tester(uuid, text, text, integer, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_vibode_furniture_generation_tester(uuid, uuid, text, integer, boolean, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_vibode_furniture_generation_tester(uuid, text, text, integer, boolean, text) to service_role;
grant execute on function public.admin_update_vibode_furniture_generation_tester(uuid, uuid, text, integer, boolean, timestamptz, text) to service_role;

commit;
