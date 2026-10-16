-- HARMONIZE-3B2-A1: one running generation, and 10 provider contacts per UTC day.
--
-- Apply after 20261013150000_vibode_harmonize_enqueue_publication.sql and
-- before any unattended Harmonize worker starts. Hosted publication is
-- already applied. This file replaces the two claim overloads and the
-- contact RPC. It does not replace publish_vibode_harmonize_history, the
-- row guard, enqueue, or any AFC or 3D scene authority.
--
-- The launch ceiling lives only in vibode_harmonize_global_provider_limit().
-- A later migration revises that one function.
--
-- Both claim overloads and contact take the same transaction advisory lock
-- before they read or write a job row, so the running count and the contact
-- count cannot race an unlocked update.
--
-- Claim returns ok true and a null job when it refuses work. global_busy
-- means another generation is running; the queued row is unchanged.
-- global_daily_limit means the UTC-day ceiling is full. That queued row
-- stays queued, keeps its attempt count, and waits until the next UTC day.
--
-- Contact returns ok false and global_daily_limit after it has already
-- requeued the running row. The current worker calls fail() only for
-- already_contacted. Any other contact refusal stops before the provider
-- and does not send a second fail RPC, so this requeue is the deferral.
-- provider_started_at is not written, and the claim's attempt increment is
-- returned. A per-user daily_limit is still a terminal failure.

begin;

create or replace function public.vibode_harmonize_global_provider_limit()
returns integer
language sql
immutable
as $$
  select 10;
$$;

create or replace function public.vibode_harmonize_global_provider_started_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.vibode_harmonize_generations
  where provider_started_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    and provider_started_at < (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
$$;

create index if not exists vibode_harmonize_provider_started_global
  on public.vibode_harmonize_generations (provider_started_at)
  where provider_started_at is not null;

comment on function public.vibode_harmonize_global_provider_limit() is
  'Launch ceiling for Harmonize provider contacts across all users in one UTC day. Replace this function to revise it.';

comment on function public.vibode_harmonize_global_provider_started_count() is
  'Recorded provider contacts in the current UTC day, including succeeded, failed, provider_uncertain, and fake contacts.';

create or replace function public.claim_next_vibode_harmonize_generation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_user uuid;
  v_job public.vibode_harmonize_generations%rowtype;
  v_next_day timestamptz;
begin
  perform pg_advisory_xact_lock(8142, 20261015);

  update public.vibode_harmonize_generations
    set status = 'failed',
        failure_code = 'provider_uncertain',
        failure_message = 'Provider contact lease expired before a confirmed result.',
        completed_at = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where status = 'running'
    and claim_expires_at <= now()
    and provider_started_at is not null;

  update public.vibode_harmonize_generations
    set status = 'queued',
        not_before = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where status = 'running'
    and claim_expires_at <= now()
    and provider_started_at is null
    and attempt_count < 3;

  update public.vibode_harmonize_generations
    set status = 'failed',
        failure_code = 'attempts_exhausted',
        failure_message = 'Harmonize stopped before contacting the provider.',
        completed_at = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where status = 'running'
    and claim_expires_at <= now()
    and provider_started_at is null
    and attempt_count >= 3;

  if (select count(*) from public.vibode_harmonize_generations where status = 'running') >= 1 then
    return jsonb_build_object('ok', true, 'job', null, 'code', 'global_busy');
  end if;

  v_next_day := (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';

  loop
    select id into v_id
    from public.vibode_harmonize_generations
    where status = 'queued' and not_before <= now()
    order by created_at
    limit 1
    for update skip locked;

    exit when v_id is null;

    select user_id into v_user
    from public.vibode_harmonize_generations
    where id = v_id;

    if public.vibode_harmonize_provider_started_count(v_user) >= 10 then
      update public.vibode_harmonize_generations
        set status = 'failed',
            failure_code = 'daily_limit',
            failure_message = 'Daily Harmonize provider limit was reached.',
            completed_at = now(),
            updated_at = now()
      where id = v_id;
      continue;
    end if;

    if public.vibode_harmonize_global_provider_started_count() >= public.vibode_harmonize_global_provider_limit() then
      update public.vibode_harmonize_generations
        set not_before = greatest(not_before, v_next_day),
            updated_at = now()
      where id = v_id
        and status = 'queued'
        and provider_started_at is null;
      return jsonb_build_object('ok', true, 'job', null, 'code', 'global_daily_limit');
    end if;

    update public.vibode_harmonize_generations
      set status = 'running',
          attempt_count = attempt_count + 1,
          claimed_at = now(),
          heartbeat_at = now(),
          claim_expires_at = now() + interval '240 seconds',
          claim_nonce = gen_random_uuid()::text,
          updated_at = now(),
          failure_code = null,
          failure_message = null
    where id = v_id
    returning * into v_job;

    return jsonb_build_object(
      'ok', true,
      'job', jsonb_build_object(
        'jobId', v_job.id,
        'roomId', v_job.room_id,
        'claimNonce', v_job.claim_nonce,
        'prompt', v_job.snapshot->>'prompt',
        'promptSha256', v_job.prompt_sha256,
        'compositeSha256', v_job.composite_sha256,
        'compositeWidth', v_job.composite_width,
        'compositeHeight', v_job.composite_height,
        'requestedModelId', v_job.requested_model_id,
        'claimExpiresAt', v_job.claim_expires_at
      )
    );
  end loop;

  return jsonb_build_object('ok', true, 'job', null);
end;
$$;

create or replace function public.claim_next_vibode_harmonize_generation(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_user uuid;
  v_job public.vibode_harmonize_generations%rowtype;
  v_next_day timestamptz;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  perform pg_advisory_xact_lock(8142, 20261015);

  update public.vibode_harmonize_generations
    set status = 'failed',
        failure_code = 'provider_uncertain',
        failure_message = 'Provider contact lease expired before a confirmed result.',
        completed_at = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where id = p_job_id
    and status = 'running'
    and claim_expires_at <= now()
    and provider_started_at is not null;

  update public.vibode_harmonize_generations
    set status = 'queued',
        not_before = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where id = p_job_id
    and status = 'running'
    and claim_expires_at <= now()
    and provider_started_at is null
    and attempt_count < 3;

  update public.vibode_harmonize_generations
    set status = 'failed',
        failure_code = 'attempts_exhausted',
        failure_message = 'Harmonize stopped before contacting the provider.',
        completed_at = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where id = p_job_id
    and status = 'running'
    and claim_expires_at <= now()
    and provider_started_at is null
    and attempt_count >= 3;

  if (select count(*) from public.vibode_harmonize_generations where status = 'running') >= 1 then
    return jsonb_build_object('ok', true, 'job', null, 'code', 'global_busy');
  end if;

  select id into v_id
  from public.vibode_harmonize_generations
  where id = p_job_id
    and status = 'queued'
    and not_before <= now()
  for update skip locked;

  if v_id is null then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  select user_id into v_user
  from public.vibode_harmonize_generations
  where id = v_id;

  if public.vibode_harmonize_provider_started_count(v_user) >= 10 then
    update public.vibode_harmonize_generations
      set status = 'failed',
          failure_code = 'daily_limit',
          failure_message = 'Daily Harmonize provider limit was reached.',
          completed_at = now(),
          updated_at = now()
    where id = v_id;
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  if public.vibode_harmonize_global_provider_started_count() >= public.vibode_harmonize_global_provider_limit() then
    v_next_day := (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
    update public.vibode_harmonize_generations
      set not_before = greatest(not_before, v_next_day),
          updated_at = now()
    where id = v_id
      and status = 'queued'
      and provider_started_at is null;
    return jsonb_build_object('ok', true, 'job', null, 'code', 'global_daily_limit');
  end if;

  update public.vibode_harmonize_generations
    set status = 'running',
        attempt_count = attempt_count + 1,
        claimed_at = now(),
        heartbeat_at = now(),
        claim_expires_at = now() + interval '240 seconds',
        claim_nonce = gen_random_uuid()::text,
        updated_at = now(),
        failure_code = null,
        failure_message = null
  where id = v_id
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'jobId', v_job.id,
      'roomId', v_job.room_id,
      'claimNonce', v_job.claim_nonce,
      'prompt', v_job.snapshot->>'prompt',
      'promptSha256', v_job.prompt_sha256,
      'compositeSha256', v_job.composite_sha256,
      'compositeWidth', v_job.composite_width,
      'compositeHeight', v_job.composite_height,
      'requestedModelId', v_job.requested_model_id,
      'claimExpiresAt', v_job.claim_expires_at
    )
  );
end;
$$;

create or replace function public.contact_vibode_harmonize_generation(
  p_job_id uuid,
  p_claim_nonce text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_attempt uuid;
  v_deferred uuid;
  v_next_day timestamptz;
begin
  perform pg_advisory_xact_lock(8142, 20261015);

  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found
     or v_job.status <> 'running'
     or v_job.claim_nonce is distinct from p_claim_nonce
     or v_job.claim_expires_at is null
     or v_job.claim_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  if v_job.provider_started_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_contacted');
  end if;

  if public.vibode_harmonize_provider_started_count(v_job.user_id) >= 10 then
    update public.vibode_harmonize_generations
      set status = 'failed',
          failure_code = 'daily_limit',
          failure_message = 'Daily Harmonize provider limit was reached.',
          completed_at = now(),
          updated_at = now(),
          claim_nonce = null,
          claim_expires_at = null,
          claimed_at = null,
          heartbeat_at = null
    where id = p_job_id;
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;

  if public.vibode_harmonize_global_provider_started_count() >= public.vibode_harmonize_global_provider_limit() then
    v_next_day := (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
    update public.vibode_harmonize_generations
      set status = 'queued',
          attempt_count = greatest(attempt_count - 1, 0),
          not_before = v_next_day,
          updated_at = now(),
          claim_nonce = null,
          claim_expires_at = null,
          claimed_at = null,
          heartbeat_at = null
    where id = p_job_id
      and status = 'running'
      and claim_nonce = p_claim_nonce
      and provider_started_at is null
    returning id into v_deferred;
    if v_deferred is null then
      return jsonb_build_object('ok', false, 'code', 'stale_claim');
    end if;
    return jsonb_build_object('ok', false, 'code', 'global_daily_limit');
  end if;

  v_attempt := gen_random_uuid();
  update public.vibode_harmonize_generations
    set provider_started_at = now(),
        provider_attempt_id = v_attempt,
        updated_at = now()
  where id = p_job_id
    and provider_started_at is null;
  return jsonb_build_object('ok', true, 'attemptId', v_attempt);
end;
$$;

revoke all on function public.vibode_harmonize_global_provider_limit() from public, anon, authenticated;
revoke all on function public.vibode_harmonize_global_provider_started_count() from public, anon, authenticated;
revoke all on function public.claim_next_vibode_harmonize_generation() from public, anon, authenticated;
revoke all on function public.claim_next_vibode_harmonize_generation(uuid) from public, anon, authenticated;
revoke all on function public.contact_vibode_harmonize_generation(uuid, text) from public, anon, authenticated;

grant execute on function public.vibode_harmonize_global_provider_limit() to service_role;
grant execute on function public.vibode_harmonize_global_provider_started_count() to service_role;
grant execute on function public.claim_next_vibode_harmonize_generation() to service_role;
grant execute on function public.claim_next_vibode_harmonize_generation(uuid) to service_role;
grant execute on function public.contact_vibode_harmonize_generation(uuid, text) to service_role;

commit;
