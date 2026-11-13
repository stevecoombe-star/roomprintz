-- MESHY-1D.4F account-deletion admission barrier.
--
-- Account deletion lists and removes Storage before it deletes the auth
-- user. A generation reserved in that interval used to leave the account
-- in place, with the financial hold preserved and the files already gone.
-- This barrier is committed before any of that cleanup. It does not expire.
-- A crashed request cannot clear it, and a stale request cannot clear a
-- newer attempt.
--
-- begin_vibode_account_deletion takes the generation advisory lock first,
-- then a share-row-exclusive lock on the jobs table, then rechecks holds.
-- It does not lock or update the global control row. Reservation takes the
-- same advisory lock before it inserts a job, so the two cannot interleave.
-- The jobs lock also covers a direct insert that does not call reservation.
-- Neither lock is held across Storage HTTP calls.
--
-- phase admitted means cleanup has not started and an operator may abandon
-- the attempt once no request holds the claim. phase destructive means
-- cleanup was entered. Abandon is refused and the account stays closed to
-- new writes until deletion is retried to completion.
--
-- Customer writes are rejected by database triggers, not by a browser
-- control. Generation-job updates that do not leave an unsettled hold stay
-- allowed, so the existing stale sweep can still maintain other accounts.
-- Storage deletes stay allowed so this deletion can remove objects.
--
-- The barrier does not release a hold, record provider consumption, or
-- change paid-submission history. Review before applying. Do not apply to
-- hosted Supabase without explicit approval.

begin;

create table public.vibode_account_deletion_barriers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempt_id uuid not null unique,
  phase text not null,
  claim_request_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  destructive_at timestamptz,
  constraint vibode_account_deletion_barriers_phase
    check (phase in ('admitted', 'destructive'))
);

comment on table public.vibode_account_deletion_barriers is
  'One live account-deletion attempt. It has no expiry. Admitted attempts can be abandoned only while no request holds the claim. Destructive attempts stay until the auth user is deleted.';

create table public.vibode_account_deletion_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  attempt_id uuid not null,
  action text not null,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint vibode_account_deletion_events_action
    check (action in (
      'begin', 'resume', 'claim', 'destructive', 'release_claim', 'abandon', 'succeeded'
    ))
);

comment on table public.vibode_account_deletion_events is
  'Append-only account-deletion audit. Rows are not foreign-keyed to auth.users, so they survive a completed deletion.';

alter table public.vibode_account_deletion_barriers enable row level security;
alter table public.vibode_account_deletion_events enable row level security;

revoke all on table public.vibode_account_deletion_barriers
  from public, anon, authenticated, service_role;
revoke all on table public.vibode_account_deletion_events
  from public, anon, authenticated, service_role;

create or replace function public.vibode_account_deletion_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'VIBODE_ACCOUNT_DELETION:EVENT_IMMUTABLE'
    using errcode = 'P0001';
end;
$fn$;

create trigger vibode_account_deletion_events_immutable
before update or delete on public.vibode_account_deletion_events
for each row
execute function public.vibode_account_deletion_events_immutable();

create trigger vibode_account_deletion_events_immutable_truncate
before truncate on public.vibode_account_deletion_events
for each statement
execute function public.vibode_account_deletion_events_immutable();

create or replace function public.vibode_account_deletion_user_blocked(
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
  select p_user_id is not null
    and exists (
      select 1
      from public.vibode_account_deletion_barriers
      where user_id = p_user_id
    );
$fn$;

create or replace function public.vibode_account_deletion_room_owner(
  p_room_id uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_owner uuid;
begin
  if p_room_id is null then
    return null;
  end if;
  if to_regclass('public.vibode_rooms') is not null then
    execute 'select user_id from public.vibode_rooms where id = $1'
      into v_owner
      using p_room_id;
    if v_owner is not null then
      return v_owner;
    end if;
  end if;
  if to_regclass('public.rooms') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'rooms'
        and column_name = 'user_id'
    )
  then
    begin
      execute 'select user_id from public.rooms where id::text = $1 limit 1'
        into v_owner
        using p_room_id::text;
    exception
      when datatype_mismatch or invalid_text_representation then
        return null;
    end;
    if v_owner is not null then
      return v_owner;
    end if;
  end if;
  return null;
end;
$fn$;

create or replace function public.vibode_account_deletion_path_blocked(
  p_name text
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_segment text;
  v_id uuid;
  v_owner uuid;
begin
  if p_name is null or p_name = '' then
    return false;
  end if;
  foreach v_segment in array string_to_array(lower(p_name), '/')
  loop
    if v_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_id := v_segment::uuid;
      if public.vibode_account_deletion_user_blocked(v_id) then
        return true;
      end if;
      v_owner := public.vibode_account_deletion_room_owner(v_id);
      if public.vibode_account_deletion_user_blocked(v_owner) then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$fn$;

create or replace function public.begin_vibode_account_deletion(
  p_user_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_existing public.vibode_account_deletion_barriers%rowtype;
  v_attempt uuid;
begin
  if p_user_id is null
    or p_admin_id is null
    or not exists (select 1 from auth.users where id = p_user_id)
  then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Same first lock as reservation. The jobs lock is next, so a direct
  -- insert waits until this check and the barrier insert both commit.
  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
  lock table public.vibode_furniture_generation_jobs in share row exclusive mode;

  if exists (
    select 1
    from public.vibode_furniture_generation_jobs
    where user_id = p_user_id
      and public.vibode_furniture_generation_job_hold_unsettled(
        quota_state,
        provider_contacted_at,
        consumed_credits
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'unsettled_hold');
  end if;

  select * into v_existing
  from public.vibode_account_deletion_barriers
  where user_id = p_user_id
  for update;
  if found then
    insert into public.vibode_account_deletion_events (
      user_id, attempt_id, action, actor_user_id
    ) values (
      p_user_id, v_existing.attempt_id, 'resume', p_admin_id
    );
    return jsonb_build_object(
      'ok', true,
      'code', 'in_progress',
      'attempt_id', v_existing.attempt_id,
      'phase', v_existing.phase,
      'claimed', v_existing.claim_request_id is not null
    );
  end if;

  v_attempt := gen_random_uuid();
  insert into public.vibode_account_deletion_barriers (
    user_id, attempt_id, phase, created_by
  ) values (
    p_user_id, v_attempt, 'admitted', p_admin_id
  );
  insert into public.vibode_account_deletion_events (
    user_id, attempt_id, action, actor_user_id
  ) values (
    p_user_id, v_attempt, 'begin', p_admin_id
  );
  return jsonb_build_object(
    'ok', true,
    'code', 'begun',
    'attempt_id', v_attempt,
    'phase', 'admitted',
    'claimed', false
  );
end;
$fn$;

create or replace function public.claim_vibode_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_account_deletion_barriers%rowtype;
begin
  if p_user_id is null or p_attempt_id is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  select * into v_row
  from public.vibode_account_deletion_barriers
  where user_id = p_user_id
  for update;
  if not found or v_row.attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  if v_row.claim_request_id is not null
    and v_row.claim_request_id is distinct from p_request_id
  then
    return jsonb_build_object('ok', false, 'code', 'deletion_in_progress');
  end if;
  if v_row.claim_request_id is null then
    update public.vibode_account_deletion_barriers
    set claim_request_id = p_request_id
    where user_id = p_user_id
      and attempt_id = p_attempt_id;
    insert into public.vibode_account_deletion_events (
      user_id, attempt_id, action, actor_user_id
    ) values (
      p_user_id, p_attempt_id, 'claim', null
    );
  end if;
  return jsonb_build_object('ok', true, 'phase', v_row.phase);
end;
$fn$;

create or replace function public.mark_vibode_account_deletion_destructive(
  p_user_id uuid,
  p_attempt_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_account_deletion_barriers%rowtype;
begin
  select * into v_row
  from public.vibode_account_deletion_barriers
  where user_id = p_user_id
  for update;
  if not found
    or v_row.attempt_id is distinct from p_attempt_id
    or v_row.claim_request_id is distinct from p_request_id
  then
    return jsonb_build_object('ok', false, 'code', 'deletion_in_progress');
  end if;
  if v_row.phase = 'admitted' then
    update public.vibode_account_deletion_barriers
    set phase = 'destructive',
      destructive_at = now()
    where user_id = p_user_id
      and attempt_id = p_attempt_id
      and claim_request_id = p_request_id;
    insert into public.vibode_account_deletion_events (
      user_id, attempt_id, action, actor_user_id
    ) values (
      p_user_id, p_attempt_id, 'destructive', null
    );
  end if;
  return jsonb_build_object('ok', true, 'phase', 'destructive');
end;
$fn$;

create or replace function public.release_vibode_account_deletion_claim(
  p_user_id uuid,
  p_attempt_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_account_deletion_barriers%rowtype;
begin
  select * into v_row
  from public.vibode_account_deletion_barriers
  where user_id = p_user_id
  for update;
  if not found or v_row.attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  if v_row.claim_request_id is distinct from p_request_id then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  update public.vibode_account_deletion_barriers
  set claim_request_id = null
  where user_id = p_user_id
    and attempt_id = p_attempt_id
    and claim_request_id = p_request_id;
  insert into public.vibode_account_deletion_events (
    user_id, attempt_id, action, actor_user_id
  ) values (
    p_user_id, p_attempt_id, 'release_claim', null
  );
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.abandon_vibode_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_account_deletion_barriers%rowtype;
begin
  select * into v_row
  from public.vibode_account_deletion_barriers
  where user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  if v_row.phase is distinct from 'admitted' then
    return jsonb_build_object('ok', false, 'code', 'cleanup_started');
  end if;
  if v_row.claim_request_id is not null then
    return jsonb_build_object('ok', false, 'code', 'deletion_in_progress');
  end if;
  delete from public.vibode_account_deletion_barriers
  where user_id = p_user_id
    and attempt_id = p_attempt_id
    and phase = 'admitted'
    and claim_request_id is null;
  insert into public.vibode_account_deletion_events (
    user_id, attempt_id, action, actor_user_id
  ) values (
    p_user_id, p_attempt_id, 'abandon', p_admin_id
  );
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.resume_vibode_account_deletion(
  p_user_id uuid,
  p_attempt_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row public.vibode_account_deletion_barriers%rowtype;
begin
  select * into v_row
  from public.vibode_account_deletion_barriers
  where user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  if v_row.claim_request_id is not null then
    update public.vibode_account_deletion_barriers
    set claim_request_id = null
    where user_id = p_user_id
      and attempt_id = p_attempt_id;
    insert into public.vibode_account_deletion_events (
      user_id, attempt_id, action, actor_user_id
    ) values (
      p_user_id, p_attempt_id, 'release_claim', p_admin_id
    );
  end if;
  return jsonb_build_object('ok', true, 'phase', v_row.phase);
end;
$fn$;

create or replace function public.note_vibode_account_deletion_succeeded(
  p_user_id uuid,
  p_attempt_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if p_user_id is null or p_attempt_id is null then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  if not exists (
    select 1
    from public.vibode_account_deletion_events
    where user_id = p_user_id
      and attempt_id = p_attempt_id
      and action = 'begin'
  ) then
    return jsonb_build_object('ok', false, 'code', 'attempt_mismatch');
  end if;
  if exists (
    select 1
    from public.vibode_account_deletion_events
    where user_id = p_user_id
      and attempt_id = p_attempt_id
      and action = 'succeeded'
  ) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  insert into public.vibode_account_deletion_events (
    user_id, attempt_id, action, actor_user_id
  ) values (
    p_user_id, p_attempt_id, 'succeeded', p_admin_id
  );
  return jsonb_build_object('ok', true, 'idempotent', false);
end;
$fn$;

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
    raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

create or replace function public.vibode_account_deletion_block_generation_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT'
    and public.vibode_account_deletion_user_blocked(new.user_id)
  then
    raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE'
    and (
      public.vibode_account_deletion_user_blocked(new.user_id)
      or public.vibode_account_deletion_user_blocked(old.user_id)
    )
    and public.vibode_furniture_generation_job_hold_unsettled(
      new.quota_state,
      new.provider_contacted_at,
      new.consumed_credits
    )
  then
    raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    return coalesce(old, new);
  end if;
  return new;
end;
$fn$;

create trigger vibode_account_deletion_block_generation_job
before insert or update on public.vibode_furniture_generation_jobs
for each row
execute function public.vibode_account_deletion_block_generation_job();

create or replace function public.vibode_account_deletion_block_storage_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if public.vibode_account_deletion_path_blocked(new.name)
    or (tg_op = 'UPDATE' and public.vibode_account_deletion_path_blocked(old.name))
  then
    raise exception 'VIBODE_ACCOUNT_DELETION:IN_PROGRESS'
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

do $attach$
declare
  v_name text;
begin
  for v_name in
    select distinct c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'user_id'
      and a.atttypid = 'uuid'::regtype
      and c.relname not in (
        'vibode_account_deletion_barriers',
        'vibode_account_deletion_events',
        'vibode_furniture_generation_jobs'
      )
  loop
    execute format(
      'create trigger vibode_account_deletion_block_write
       before insert or update on public.%I
       for each row execute function public.vibode_account_deletion_block_owned_write(%L)',
      v_name,
      'user_id'
    );
  end loop;

  if to_regclass('public.profiles') is not null then
    execute $sql$
      create trigger vibode_account_deletion_block_write
      before insert or update on public.profiles
      for each row execute function public.vibode_account_deletion_block_owned_write('id')
    $sql$;
  end if;

  if to_regclass('storage.objects') is not null then
    execute $sql$
      create trigger vibode_account_deletion_block_storage_write
      before insert or update on storage.objects
      for each row execute function public.vibode_account_deletion_block_storage_write()
    $sql$;
  end if;
end;
$attach$;

create or replace function public.reserve_vibode_furniture_generation(
  p_user_id uuid,
  p_job_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_operation text,
  p_ai_model text,
  p_settings jsonb,
  p_image_slots text[],
  p_reserved_credits integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_existing public.vibode_furniture_generation_jobs%rowtype;
  v_controls public.vibode_furniture_generation_controls%rowtype;
  v_allowance public.vibode_furniture_generation_allowances%rowtype;
  v_profile jsonb;
  v_credits integer;
begin
  if p_user_id is null or p_job_id is null
    or p_idempotency_key is null or p_idempotency_key !~ '^[a-z0-9-]{8,80}$'
    or p_request_sha256 is null or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or not exists (select 1 from auth.users where id = p_user_id)
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- One reservation at a time. Controls are locked before the allowance row.
  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);

  select * into v_existing
  from public.vibode_furniture_generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    -- A matching replay returns the original job and does not reserve again,
    -- including when the allowance or paid budget was later exhausted.
    if v_existing.request_sha256 = p_request_sha256 then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'job_id', v_existing.job_id,
        'status', v_existing.status,
        'reserved_credits', v_existing.reserved_credits,
        'provider_task_name', v_existing.provider_task_name
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  -- The deletion barrier is checked under the same advisory lock that
  -- commits it. A matching replay above does not create a hold.
  if exists (
    select 1
    from public.vibode_account_deletion_barriers
    where user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'account_deletion_in_progress');
  end if;

  v_profile := jsonb_build_object(
    'geometryResolution', 'standard',
    'shouldTexture', true,
    'textureModel', 'default',
    'textureResolution', '2k',
    'enablePbr', false,
    'texturePrompt', '',
    'imageEnhancement', true,
    'shouldRemesh', false,
    'topology', 'triangle',
    'targetPolycount', 30000
  );
  if p_ai_model is distinct from 'meshy-7.1'
    or p_operation is distinct from 'image-to-3d'
    or p_image_slots is distinct from array['front']::text[]
    or not public.vibode_furniture_generation_slots_ok(p_operation, p_image_slots)
    or p_settings is distinct from v_profile
  then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;
  v_credits := public.vibode_furniture_generation_credit_estimate(p_operation, p_settings);
  if v_credits is distinct from 30 or p_reserved_credits is distinct from 30 then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;

  perform public.vibode_furniture_generation_release_stale();

  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found or v_controls.live_enabled is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  if v_controls.paid_submissions_used >= v_controls.paid_submissions_authorized then
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
  end if;

  select * into v_allowance
  from public.vibode_furniture_generation_allowances
  where user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'allowance_required');
  end if;
  if v_allowance.enabled is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'allowance_disabled');
  end if;
  if v_allowance.authorized_generations
    - v_allowance.reserved_generations
    - v_allowance.consumed_generations < 1
  then
    return jsonb_build_object('ok', false, 'code', 'allowance_exhausted');
  end if;

  -- The owner stays blocked while an unresolved review still holds money.
  if exists (
    select 1 from public.vibode_furniture_generation_jobs
    where user_id = p_user_id
      and status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting', 'needs_review')
  ) then
    return jsonb_build_object('ok', false, 'code', 'concurrency_limited');
  end if;
  if exists (
    select 1 from public.vibode_furniture_generation_jobs
    where status in ('reserved', 'submitting', 'ambiguous', 'running', 'ingesting')
  ) then
    return jsonb_build_object('ok', false, 'code', 'concurrency_limited');
  end if;
  -- credits_reserved includes holds on jobs outside the processing index.
  if v_controls.credits_reserved + v_controls.credits_consumed + v_credits > v_controls.credit_ceiling then
    return jsonb_build_object('ok', false, 'code', 'quota_exhausted');
  end if;

  insert into public.vibode_furniture_generation_jobs (
    job_id, user_id, provider, ai_model, operation, idempotency_key, request_sha256,
    settings, image_slots, provider_task_name, status, quota_state, allowance_state, reserved_credits
  ) values (
    p_job_id, p_user_id, 'meshy', 'meshy-7.1', p_operation, p_idempotency_key, p_request_sha256,
    p_settings, p_image_slots, 'vibode-' || p_job_id::text, 'reserved', 'reserved', 'reserved', v_credits
  );
  update public.vibode_furniture_generation_allowances
  set reserved_generations = reserved_generations + 1,
    updated_by = null
  where user_id = p_user_id;
  update public.vibode_furniture_generation_controls
  set credits_reserved = credits_reserved + v_credits
  where control_id = 'global';
  insert into public.vibode_furniture_generation_allowance_events (
    user_id, actor_kind, actor_user_id, action,
    delta_authorized, delta_reserved, delta_consumed, job_id, reason
  ) values (
    p_user_id, 'system', null, 'reserve',
    0, 1, 0, p_job_id, 'Beta generation reserved'
  );
  return jsonb_build_object(
    'ok', true,
    'created', true,
    'job_id', p_job_id,
    'status', 'reserved',
    'reserved_credits', v_credits,
    'provider_task_name', 'vibode-' || p_job_id::text
  );
end;
$fn$;

revoke all on function public.reserve_vibode_furniture_generation(uuid, uuid, text, text, text, text, jsonb, text[], integer)
  from public, anon, authenticated;
grant execute on function public.reserve_vibode_furniture_generation(uuid, uuid, text, text, text, text, jsonb, text[], integer)
  to service_role;

create or replace function public.attach_vibode_furniture_generation_input(
  p_user_id uuid,
  p_job_id uuid,
  p_slot text,
  p_mime_type text,
  p_byte_size bigint,
  p_width_px integer,
  p_height_px integer,
  p_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
  v_ordinal integer;
begin
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520
    or p_width_px is null or p_height_px is null
    or p_width_px < 32 or p_height_px < 32
    or p_width_px::bigint * p_height_px::bigint > 178956970
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if exists (
    select 1
    from public.vibode_account_deletion_barriers
    where user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'account_deletion_in_progress');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found or v_job.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_ordinal := array_position(v_job.image_slots, p_slot);
  if v_ordinal is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  insert into public.vibode_furniture_generation_inputs (
    job_id, user_id, slot, ordinal, storage_bucket, storage_object_path,
    sha256, byte_size, mime_type, width_px, height_px, expires_at
  ) values (
    p_job_id,
    p_user_id,
    p_slot,
    v_ordinal - 1,
    'vibode-furniture-generation-inputs',
    'users/' || p_user_id::text || '/inputs/' || p_job_id::text || '/' || p_slot || '.'
      || case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end,
    p_sha256,
    p_byte_size,
    p_mime_type,
    p_width_px,
    p_height_px,
    now() + interval '24 hours'
  )
  on conflict (job_id, slot) do update
  set sha256 = excluded.sha256,
    byte_size = excluded.byte_size,
    mime_type = excluded.mime_type,
    width_px = excluded.width_px,
    height_px = excluded.height_px,
    storage_object_path = excluded.storage_object_path,
    expires_at = excluded.expires_at,
    purged_at = null;
  return jsonb_build_object('ok', true, 'job_id', p_job_id, 'slot', p_slot);
end;
$fn$;

revoke all on function public.attach_vibode_furniture_generation_input(uuid, uuid, text, text, bigint, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.attach_vibode_furniture_generation_input(uuid, uuid, text, text, bigint, integer, integer, text)
  to service_role;

revoke all on function public.begin_vibode_account_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_vibode_account_deletion(uuid, uuid) to service_role;

revoke all on function public.claim_vibode_account_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_vibode_account_deletion(uuid, uuid, uuid) to service_role;

revoke all on function public.mark_vibode_account_deletion_destructive(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_vibode_account_deletion_destructive(uuid, uuid, uuid) to service_role;

revoke all on function public.release_vibode_account_deletion_claim(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_vibode_account_deletion_claim(uuid, uuid, uuid) to service_role;

revoke all on function public.abandon_vibode_account_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.abandon_vibode_account_deletion(uuid, uuid, uuid) to service_role;

revoke all on function public.resume_vibode_account_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resume_vibode_account_deletion(uuid, uuid, uuid) to service_role;

revoke all on function public.note_vibode_account_deletion_succeeded(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.note_vibode_account_deletion_succeeded(uuid, uuid, uuid) to service_role;

revoke all on function public.vibode_account_deletion_user_blocked(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.vibode_account_deletion_room_owner(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.vibode_account_deletion_path_blocked(text)
  from public, anon, authenticated, service_role;

grant execute on function public.vibode_account_deletion_events_immutable() to public;
grant execute on function public.vibode_account_deletion_block_owned_write() to public;
grant execute on function public.vibode_account_deletion_block_generation_job() to public;
grant execute on function public.vibode_account_deletion_block_storage_write() to public;

commit;
