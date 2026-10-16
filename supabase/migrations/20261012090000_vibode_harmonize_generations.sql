-- HARMONIZE-3A: durable admin Harmonize generations.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it without explicit approval.
--
-- This migration does not alter AFC tables, thumbnail jobs, room History
-- assets, or 3D scene rows. Browser roles cannot read or write the job
-- table or the private vibode-harmonize bucket.

begin;

create table public.vibode_harmonize_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  source_version_id uuid null references public.vibode_room_assets(id) on delete set null,
  idempotency_key uuid not null,
  kind text not null default 'initial',
  status text not null default 'queued',
  request_sha256 text not null,
  scene_snapshot_sha256 text not null,
  background_sha256 text not null,
  composite_sha256 text not null,
  prompt_sha256 text not null,
  prompt_version text not null,
  assembly_version text not null,
  afc_generation_id uuid not null,
  snapshot jsonb not null,
  composite_bucket text not null default 'vibode-harmonize',
  composite_path text not null,
  prompt_path text null,
  composite_byte_length integer not null,
  composite_width integer not null,
  composite_height integer not null,
  output_bucket text null,
  output_path text null,
  output_sha256 text null,
  output_mime text null,
  output_width integer null,
  output_height integer null,
  provider text not null default 'google-gemini-interactions',
  requested_model_id text not null default 'gemini-3-pro-image',
  returned_model_id text null,
  provider_started_at timestamptz null,
  provider_attempt_id uuid null,
  claim_nonce text null,
  claim_expires_at timestamptz null,
  claimed_at timestamptz null,
  heartbeat_at timestamptz null,
  attempt_count integer not null default 0,
  failure_code text null,
  failure_message text null,
  provider_status text null,
  provider_http_status integer null,
  latency_ms integer null,
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint vibode_harmonize_kind_closed
    check (kind in ('initial', 'regenerate')),
  constraint vibode_harmonize_status_closed
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint vibode_harmonize_request_sha
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_harmonize_scene_sha
    check (scene_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_harmonize_background_sha
    check (background_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_harmonize_composite_sha
    check (composite_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_harmonize_prompt_sha
    check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_harmonize_output_sha
    check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vibode_harmonize_composite_bytes
    check (composite_byte_length between 1 and 9000000),
  constraint vibode_harmonize_composite_edges
    check (
      composite_width between 1 and 4096
      and composite_height between 1 and 4096
    ),
  constraint vibode_harmonize_attempts
    check (attempt_count between 0 and 3),
  constraint vibode_harmonize_failure_code
    check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,64}$'),
  constraint vibode_harmonize_failure_message
    check (failure_message is null or char_length(failure_message) <= 240),
  constraint vibode_harmonize_output_mime
    check (output_mime is null or output_mime = 'image/jpeg'),
  constraint vibode_harmonize_output_frame
    check (
      (output_width is null and output_height is null)
      or (output_width between 1 and 8192 and output_height between 1 and 8192)
    ),
  constraint vibode_harmonize_queued_uncontacted
    check (status <> 'queued' or provider_started_at is null),
  constraint vibode_harmonize_succeeded_contact
    check (
      status <> 'succeeded'
      or (
        provider_started_at is not null
        and output_path is not null
        and output_sha256 is not null
        and output_mime = 'image/jpeg'
      )
    ),
  constraint vibode_harmonize_requested_model
    check (requested_model_id = 'gemini-3-pro-image'),
  constraint vibode_harmonize_provider_id
    check (provider = 'google-gemini-interactions'),
  constraint vibode_harmonize_bucket
    check (composite_bucket = 'vibode-harmonize'),
  constraint vibode_harmonize_user_idempotency
    unique (user_id, idempotency_key)
);

create unique index vibode_harmonize_one_active_user
  on public.vibode_harmonize_generations (user_id)
  where status in ('queued', 'running');

create unique index vibode_harmonize_provider_attempt
  on public.vibode_harmonize_generations (provider_attempt_id)
  where provider_attempt_id is not null;

create index vibode_harmonize_provider_started
  on public.vibode_harmonize_generations (user_id, provider_started_at)
  where provider_started_at is not null;

create index vibode_harmonize_queued
  on public.vibode_harmonize_generations (created_at)
  where status = 'queued';

comment on table public.vibode_harmonize_generations is
  'Admin Harmonize jobs. The snapshot and prompt are immutable. Provider contact is recorded once and is not retried.';

create or replace function public.vibode_harmonize_provider_started_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.vibode_harmonize_generations
  where user_id = p_user_id
    and provider_started_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    and provider_started_at < (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
$$;

create or replace function public.vibode_harmonize_generations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.user_id is distinct from new.user_id
     or old.room_id is distinct from new.room_id
     or old.idempotency_key is distinct from new.idempotency_key
     or old.kind is distinct from new.kind
     or old.request_sha256 is distinct from new.request_sha256
     or old.scene_snapshot_sha256 is distinct from new.scene_snapshot_sha256
     or old.background_sha256 is distinct from new.background_sha256
     or old.composite_sha256 is distinct from new.composite_sha256
     or old.prompt_sha256 is distinct from new.prompt_sha256
     or old.prompt_version is distinct from new.prompt_version
     or old.assembly_version is distinct from new.assembly_version
     or old.afc_generation_id is distinct from new.afc_generation_id
     or old.snapshot is distinct from new.snapshot
     or old.composite_bucket is distinct from new.composite_bucket
     or old.composite_path is distinct from new.composite_path
     or old.composite_byte_length is distinct from new.composite_byte_length
     or old.composite_width is distinct from new.composite_width
     or old.composite_height is distinct from new.composite_height
     or old.provider is distinct from new.provider
     or old.requested_model_id is distinct from new.requested_model_id
     or old.created_at is distinct from new.created_at
  then
    raise exception 'harmonize snapshot is immutable';
  end if;

  if old.provider_started_at is not null
     and new.provider_started_at is distinct from old.provider_started_at
  then
    raise exception 'harmonize provider contact is immutable';
  end if;

  if old.provider_attempt_id is not null
     and new.provider_attempt_id is distinct from old.provider_attempt_id
  then
    raise exception 'harmonize provider contact is immutable';
  end if;

  if old.output_sha256 is not null and new.output_sha256 is distinct from old.output_sha256 then
    raise exception 'harmonize output is immutable';
  end if;

  if old.prompt_path is not null and new.prompt_path is distinct from old.prompt_path then
    raise exception 'harmonize prompt path is immutable';
  end if;

  if old.source_version_id is distinct from new.source_version_id
     and new.source_version_id is not null
  then
    raise exception 'harmonize source version is immutable';
  end if;

  if old.status in ('succeeded', 'failed', 'cancelled') then
    if new.source_version_id is null
       and old.source_version_id is not null
       and new.status is not distinct from old.status
       and new.output_sha256 is not distinct from old.output_sha256
       and new.failure_code is not distinct from old.failure_code
       and new.claim_nonce is not distinct from old.claim_nonce
       and new.provider_started_at is not distinct from old.provider_started_at
    then
      return new;
    end if;
    raise exception 'harmonize generation is terminal';
  end if;

  return new;
end;
$$;

create trigger vibode_harmonize_generations_guard
before update on public.vibode_harmonize_generations
for each row execute function public.vibode_harmonize_generations_guard();

create or replace function public.enqueue_vibode_harmonize_generation(
  p_user_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_source_version_id uuid;
  v_idempotency_key uuid;
  v_generation_id uuid;
  v_existing public.vibode_harmonize_generations%rowtype;
  v_path text;
  v_prompt text;
  v_job public.vibode_harmonize_generations%rowtype;
begin
  begin
    v_room_id := (p_payload->>'roomId')::uuid;
    v_source_version_id := (p_payload->>'sourceVersionId')::uuid;
    v_idempotency_key := (p_payload->>'idempotencyKey')::uuid;
    v_generation_id := (p_payload->>'afcGenerationId')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;

  if p_payload->>'requestSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'sceneSnapshotSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'backgroundSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'compositeSha256' !~ '^[0-9a-f]{64}$'
     or p_payload->>'promptSha256' !~ '^[0-9a-f]{64}$'
     or coalesce(p_payload->>'promptVersion', '') = ''
     or coalesce(p_payload->>'assemblyVersion', '') = ''
     or jsonb_typeof(p_payload->'snapshot') <> 'object'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  v_prompt := p_payload->'snapshot'->>'prompt';
  if v_prompt is null or char_length(v_prompt) < 1 or char_length(v_prompt) > 100000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  v_path := 'rooms/' || v_room_id::text || '/intakes/' || p_user_id::text || '/' || v_idempotency_key::text || '/composite.png';
  if p_payload->>'compositePath' <> v_path then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;

  if not exists (
    select 1 from public.vibode_rooms
    where id = v_room_id and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not exists (
    select 1 from public.vibode_room_assets
    where id = v_source_version_id and room_id = v_room_id and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'source_version_not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('vibode-harmonize:' || p_user_id::text));

  select * into v_existing
  from public.vibode_harmonize_generations
  where user_id = p_user_id and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_sha256 = p_payload->>'requestSha256' then
      return jsonb_build_object('ok', true, 'created', false, 'jobId', v_existing.id, 'status', v_existing.status);
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  if exists (
    select 1 from public.vibode_harmonize_generations
    where user_id = p_user_id and status in ('queued', 'running')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_job');
  end if;

  if public.vibode_harmonize_provider_started_count(p_user_id) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;

  begin
    insert into public.vibode_harmonize_generations (
      user_id, room_id, source_version_id, idempotency_key, kind, status,
      request_sha256, scene_snapshot_sha256, background_sha256, composite_sha256, prompt_sha256,
      prompt_version, assembly_version, afc_generation_id, snapshot,
      composite_bucket, composite_path, composite_byte_length, composite_width, composite_height,
      provider, requested_model_id
    ) values (
      p_user_id, v_room_id, v_source_version_id, v_idempotency_key, 'initial', 'queued',
      p_payload->>'requestSha256',
      p_payload->>'sceneSnapshotSha256',
      p_payload->>'backgroundSha256',
      p_payload->>'compositeSha256',
      p_payload->>'promptSha256',
      p_payload->>'promptVersion',
      p_payload->>'assemblyVersion',
      v_generation_id,
      p_payload->'snapshot',
      'vibode-harmonize',
      v_path,
      (p_payload->>'compositeByteLength')::integer,
      (p_payload->>'compositeWidth')::integer,
      (p_payload->>'compositeHeight')::integer,
      'google-gemini-interactions',
      'gemini-3-pro-image'
    ) returning * into v_job;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'active_job');
    when check_violation or invalid_text_representation then
      return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end;

  return jsonb_build_object('ok', true, 'created', true, 'jobId', v_job.id, 'status', v_job.status);
end;
$$;

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
begin
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

create or replace function public.heartbeat_vibode_harmonize_generation(
  p_job_id uuid,
  p_claim_nonce text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.vibode_harmonize_generations
    set heartbeat_at = now(),
        claim_expires_at = now() + interval '240 seconds',
        updated_at = now()
  where id = p_job_id
    and claim_nonce = p_claim_nonce
    and status = 'running'
    and claim_expires_at > now()
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  return jsonb_build_object('ok', true);
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
begin
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

create or replace function public.complete_vibode_harmonize_generation(
  p_job_id uuid,
  p_claim_nonce text,
  p_output_sha256 text,
  p_output_path text,
  p_returned_model text,
  p_provider_status text,
  p_provider_http_status integer,
  p_latency_ms integer,
  p_output_width integer,
  p_output_height integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_path text;
begin
  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  if v_job.status = 'succeeded' then
    if v_job.claim_nonce = p_claim_nonce then
      return jsonb_build_object('ok', true, 'code', 'already_complete');
    end if;
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  if v_job.status <> 'running'
     or v_job.claim_nonce is distinct from p_claim_nonce
     or v_job.claim_expires_at is null
     or v_job.claim_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  if v_job.provider_started_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_contacted');
  end if;

  if p_output_sha256 !~ '^[0-9a-f]{64}$'
     or p_latency_ms is null
     or p_latency_ms < 0
     or p_output_width is null
     or p_output_height is null
     or p_output_width < 1
     or p_output_height < 1
     or p_output_width > 8192
     or p_output_height > 8192
  then
    return jsonb_build_object('ok', false, 'code', 'unexpected_output');
  end if;

  v_path := 'rooms/' || v_job.room_id::text || '/jobs/' || v_job.id::text || '/output-' || p_claim_nonce || '.jpg';
  if p_output_path <> v_path then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  update public.vibode_harmonize_generations
    set status = 'succeeded',
        output_bucket = 'vibode-harmonize',
        output_path = v_path,
        output_sha256 = p_output_sha256,
        output_mime = 'image/jpeg',
        output_width = p_output_width,
        output_height = p_output_height,
        returned_model_id = left(p_returned_model, 80),
        provider_status = left(p_provider_status, 80),
        provider_http_status = p_provider_http_status,
        latency_ms = p_latency_ms,
        completed_at = now(),
        updated_at = now(),
        failure_code = null,
        failure_message = null
  where id = p_job_id
    and claim_nonce = p_claim_nonce
    and status = 'running';

  return jsonb_build_object('ok', true, 'code', 'completed');
end;
$$;

create or replace function public.fail_vibode_harmonize_generation(
  p_job_id uuid,
  p_claim_nonce text,
  p_code text,
  p_message text,
  p_retryable boolean,
  p_provider_status text,
  p_provider_http_status integer,
  p_latency_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_harmonize_generations%rowtype;
  v_code text;
  v_message text;
begin
  select * into v_job
  from public.vibode_harmonize_generations
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'terminal');
  end if;

  if v_job.status <> 'running'
     or v_job.claim_nonce is distinct from p_claim_nonce
     or v_job.claim_expires_at is null
     or v_job.claim_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;

  v_message := left(btrim(regexp_replace(coalesce(p_message, ''), '\s+', ' ', 'g')), 240);
  v_message := regexp_replace(v_message, 'AIza[0-9A-Za-z_-]{8,}', '[redacted]', 'g');
  if position('Photorealistic Furniture Harmonization' in v_message) > 0 then
    v_message := left(v_message, position('Photorealistic Furniture Harmonization' in v_message) - 1);
  end if;
  if position('PRODUCT MATERIAL / FINISH REFERENCE' in v_message) > 0 then
    v_message := left(v_message, position('PRODUCT MATERIAL / FINISH REFERENCE' in v_message) - 1);
  end if;

  if p_retryable and v_job.provider_started_at is null and v_job.attempt_count < 3 then
    update public.vibode_harmonize_generations
      set status = 'queued',
          not_before = now() + interval '15 seconds',
          updated_at = now(),
          claim_nonce = null,
          claim_expires_at = null,
          claimed_at = null,
          heartbeat_at = null
    where id = p_job_id;
    return jsonb_build_object('ok', true, 'code', 'requeued');
  end if;

  v_code := coalesce(p_code, '');
  if v_code !~ '^[a-z0-9_]{1,64}$' then
    v_code := 'provider_uncertain';
  end if;
  if v_job.provider_started_at is not null
     and v_code not in ('provider_rejected', 'unexpected_output', 'provider_uncertain')
  then
    v_code := 'provider_uncertain';
  end if;

  update public.vibode_harmonize_generations
    set status = 'failed',
        failure_code = v_code,
        failure_message = nullif(btrim(v_message), ''),
        provider_status = left(p_provider_status, 80),
        provider_http_status = p_provider_http_status,
        latency_ms = p_latency_ms,
        completed_at = now(),
        updated_at = now(),
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null
  where id = p_job_id;
  return jsonb_build_object('ok', true, 'code', 'failed');
end;
$$;

revoke all on table public.vibode_harmonize_generations from public, anon, authenticated;
grant select, insert, update, delete on table public.vibode_harmonize_generations to service_role;
alter table public.vibode_harmonize_generations enable row level security;

revoke all on function public.vibode_harmonize_provider_started_count(uuid) from public, anon, authenticated;
revoke all on function public.vibode_harmonize_generations_guard() from public, anon, authenticated;
revoke all on function public.enqueue_vibode_harmonize_generation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_next_vibode_harmonize_generation() from public, anon, authenticated;
revoke all on function public.heartbeat_vibode_harmonize_generation(uuid, text) from public, anon, authenticated;
revoke all on function public.contact_vibode_harmonize_generation(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_vibode_harmonize_generation(uuid, text, text, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.fail_vibode_harmonize_generation(uuid, text, text, text, boolean, text, integer, integer) from public, anon, authenticated;

grant execute on function public.vibode_harmonize_provider_started_count(uuid) to service_role;
grant execute on function public.enqueue_vibode_harmonize_generation(uuid, jsonb) to service_role;
grant execute on function public.claim_next_vibode_harmonize_generation() to service_role;
grant execute on function public.heartbeat_vibode_harmonize_generation(uuid, text) to service_role;
grant execute on function public.contact_vibode_harmonize_generation(uuid, text) to service_role;
grant execute on function public.complete_vibode_harmonize_generation(uuid, text, text, text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.fail_vibode_harmonize_generation(uuid, text, text, text, boolean, text, integer, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-harmonize',
  'vibode-harmonize',
  false,
  12582912,
  array['image/png', 'image/jpeg', 'text/plain']::text[]
)
on conflict (id) do nothing;

drop policy if exists vibode_harmonize_deny_anon on storage.objects;
drop policy if exists vibode_harmonize_deny_authenticated on storage.objects;

create policy vibode_harmonize_deny_anon
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'vibode-harmonize')
with check (bucket_id <> 'vibode-harmonize');

create policy vibode_harmonize_deny_authenticated
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'vibode-harmonize')
with check (bucket_id <> 'vibode-harmonize');

commit;
