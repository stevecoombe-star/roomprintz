-- REMOVE-2D3: durable admin Clean Up Room jobs.
--
-- Review this file before applying it. Do not apply it as part of app
-- startup, and do not apply it to hosted Supabase without explicit approval.
--
-- This migration does not alter AFC tables, Harmonize jobs, thumbnail jobs,
-- room History assets, or 3D scene rows. Browser roles cannot read or write
-- the job table or the private vibode-cleanup bucket.
--
-- Numeric limits match lib/vibode-stage/remove-cleanup-jobs/policy.ts.

begin;

create table public.vibode_cleanup_generations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.vibode_rooms(id) on delete cascade,
  afc_generation_id uuid not null,
  paid_request_fingerprint text not null,
  input_fingerprint text not null,
  status text not null default 'queued',
  hidden_object_count integer not null,
  hidden_concepts text[] not null,
  selection_summary jsonb not null,
  original_sha256 text not null,
  original_mime text not null,
  original_byte_count integer not null,
  original_width integer not null,
  original_height integer not null,
  overlay_sha256 text not null,
  prompt_sha256 text not null,
  prompt_version text not null,
  mask_manifest_sha256 text not null,
  aspect_ratio_family text not null,
  documented_1k_grid_width integer not null,
  documented_1k_grid_height integer not null,
  resolution_class text not null default '2K',
  output_mime text not null default 'image/jpeg',
  provider text not null default 'google-gemini-interactions',
  requested_model_id text not null default 'gemini-3-pro-image',
  artifact_bucket text not null default 'vibode-cleanup',
  original_path text not null,
  overlay_path text not null,
  prompt_path text not null,
  masks_path text not null,
  output_path text null,
  output_sha256 text null,
  output_width integer null,
  output_height integer null,
  returned_model_id text null,
  interaction_id text null,
  usage jsonb null,
  stage_registration text not null default 'not-assessed',
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
  discarded_at timestamptz null,
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint vibode_cleanup_status_closed
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint vibode_cleanup_resolution_2k
    check (resolution_class = '2K'),
  constraint vibode_cleanup_output_mime
    check (output_mime = 'image/jpeg'),
  constraint vibode_cleanup_provider
    check (provider = 'google-gemini-interactions'),
  constraint vibode_cleanup_model
    check (requested_model_id = 'gemini-3-pro-image'),
  constraint vibode_cleanup_bucket
    check (artifact_bucket = 'vibode-cleanup'),
  constraint vibode_cleanup_registration
    check (stage_registration = 'not-assessed'),
  constraint vibode_cleanup_sha
    check (
      paid_request_fingerprint ~ '^[0-9a-f]{64}$'
      and input_fingerprint ~ '^[0-9a-f]{64}$'
      and original_sha256 ~ '^[0-9a-f]{64}$'
      and overlay_sha256 ~ '^[0-9a-f]{64}$'
      and prompt_sha256 ~ '^[0-9a-f]{64}$'
      and mask_manifest_sha256 ~ '^[0-9a-f]{64}$'
      and (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$')
    ),
  constraint vibode_cleanup_hidden
    check (hidden_object_count between 1 and 48),
  constraint vibode_cleanup_attempts
    check (attempt_count between 0 and 3),
  constraint vibode_cleanup_failure_message
    check (failure_message is null or char_length(failure_message) <= 240),
  constraint vibode_cleanup_queued_uncontacted
    check (status <> 'queued' or provider_started_at is null),
  constraint vibode_cleanup_succeeded_output
    check (
      status <> 'succeeded'
      or (
        provider_started_at is not null
        and output_path is not null
        and output_sha256 is not null
      )
    ),
  constraint vibode_cleanup_user_fingerprint
    unique (user_id, paid_request_fingerprint)
);

create unique index vibode_cleanup_one_active_user
  on public.vibode_cleanup_generations (user_id)
  where status in ('queued', 'running');

create unique index vibode_cleanup_one_running
  on public.vibode_cleanup_generations ((true))
  where status = 'running';

create index vibode_cleanup_provider_started
  on public.vibode_cleanup_generations (user_id, provider_started_at)
  where provider_started_at is not null;

create index vibode_cleanup_room
  on public.vibode_cleanup_generations (user_id, room_id, created_at desc);

comment on table public.vibode_cleanup_generations is
  'Admin Clean Up Room jobs. Frozen inputs are immutable. Provider contact is recorded once and is not retried.';

create or replace function public.vibode_cleanup_user_daily_provider_limit()
returns integer
language sql
immutable
as $$
  select 5;
$$;

create or replace function public.vibode_cleanup_global_daily_provider_limit()
returns integer
language sql
immutable
as $$
  select 5;
$$;

create or replace function public.vibode_cleanup_precontact_attempt_limit()
returns integer
language sql
immutable
as $$
  select 3;
$$;

create or replace function public.vibode_cleanup_user_provider_started_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.vibode_cleanup_generations
  where user_id = p_user_id
    and provider_started_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    and provider_started_at < (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
$$;

create or replace function public.vibode_cleanup_global_provider_started_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.vibode_cleanup_generations
  where provider_started_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    and provider_started_at < (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
$$;

create or replace function public.vibode_cleanup_generations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.user_id is distinct from new.user_id
     or old.room_id is distinct from new.room_id
     or old.afc_generation_id is distinct from new.afc_generation_id
     or old.paid_request_fingerprint is distinct from new.paid_request_fingerprint
     or old.input_fingerprint is distinct from new.input_fingerprint
     or old.original_sha256 is distinct from new.original_sha256
     or old.overlay_sha256 is distinct from new.overlay_sha256
     or old.prompt_sha256 is distinct from new.prompt_sha256
     or old.mask_manifest_sha256 is distinct from new.mask_manifest_sha256
     or old.aspect_ratio_family is distinct from new.aspect_ratio_family
     or old.resolution_class is distinct from new.resolution_class
     or old.original_path is distinct from new.original_path
     or old.overlay_path is distinct from new.overlay_path
     or old.prompt_path is distinct from new.prompt_path
     or old.masks_path is distinct from new.masks_path
     or old.provider is distinct from new.provider
     or old.requested_model_id is distinct from new.requested_model_id
     or old.created_at is distinct from new.created_at
  then
    raise exception 'cleanup snapshot is immutable';
  end if;
  if old.provider_started_at is not null and new.provider_started_at is distinct from old.provider_started_at then
    raise exception 'cleanup provider contact is immutable';
  end if;
  if old.provider_attempt_id is not null and new.provider_attempt_id is distinct from old.provider_attempt_id then
    raise exception 'cleanup provider contact is immutable';
  end if;
  if old.output_sha256 is not null and new.output_sha256 is distinct from old.output_sha256 then
    raise exception 'cleanup output is immutable';
  end if;
  return new;
end;
$$;

create trigger vibode_cleanup_generations_guard
before update on public.vibode_cleanup_generations
for each row execute function public.vibode_cleanup_generations_guard();

create or replace function public.enqueue_vibode_cleanup_generation(
  p_user_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_generation_id uuid;
  v_existing public.vibode_cleanup_generations%rowtype;
  v_job public.vibode_cleanup_generations%rowtype;
  v_owner uuid;
  v_current uuid;
begin
  v_room_id := (p_payload->>'roomId')::uuid;
  v_generation_id := (p_payload->>'afcGenerationId')::uuid;
  select user_id, current_afc_generation_id into v_owner, v_current
  from public.vibode_rooms
  where id = v_room_id;
  if v_owner is null or v_owner <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_current is distinct from v_generation_id then
    return jsonb_build_object('ok', false, 'code', 'stale_generation');
  end if;
  if coalesce(p_payload->>'resolutionClass', '2K') <> '2K'
     or coalesce(p_payload->>'provider', 'google-gemini-interactions') <> 'google-gemini-interactions'
     or coalesce(p_payload->>'requestedModelId', 'gemini-3-pro-image') <> 'gemini-3-pro-image'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_submission');
  end if;
  select * into v_existing
  from public.vibode_cleanup_generations
  where user_id = p_user_id
    and paid_request_fingerprint = p_payload->>'paidRequestFingerprint';
  if found then
    if v_existing.input_fingerprint = p_payload->>'inputFingerprint'
       and v_existing.original_sha256 = p_payload->>'originalSha256'
    then
      return jsonb_build_object('ok', true, 'created', false, 'job', to_jsonb(v_existing));
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if exists (
    select 1 from public.vibode_cleanup_generations
    where user_id = p_user_id and status in ('queued', 'running')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_job');
  end if;
  if public.vibode_cleanup_user_provider_started_count(p_user_id) >= public.vibode_cleanup_user_daily_provider_limit() then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  if public.vibode_cleanup_global_provider_started_count() >= public.vibode_cleanup_global_daily_provider_limit() then
    return jsonb_build_object('ok', false, 'code', 'global_daily_limit');
  end if;
  insert into public.vibode_cleanup_generations (
    id, user_id, room_id, afc_generation_id, paid_request_fingerprint, input_fingerprint,
    hidden_object_count, hidden_concepts, selection_summary, original_sha256, original_mime,
    original_byte_count, original_width, original_height, overlay_sha256, prompt_sha256,
    prompt_version, mask_manifest_sha256, aspect_ratio_family, documented_1k_grid_width,
    documented_1k_grid_height, original_path, overlay_path, prompt_path, masks_path
  ) values (
    (p_payload->>'id')::uuid,
    p_user_id,
    v_room_id,
    v_generation_id,
    p_payload->>'paidRequestFingerprint',
    p_payload->>'inputFingerprint',
    jsonb_array_length(p_payload->'selection'),
    (
      select coalesce(array_agg(value), '{}')
      from jsonb_array_elements_text(p_payload->'hiddenConcepts') as value
    ),
    p_payload->'selection',
    p_payload->>'originalSha256',
    p_payload->>'originalMime',
    (p_payload->>'originalByteCount')::integer,
    (p_payload->>'originalWidth')::integer,
    (p_payload->>'originalHeight')::integer,
    p_payload->>'overlaySha256',
    p_payload->>'promptSha256',
    p_payload->>'promptVersion',
    p_payload->>'maskManifestSha256',
    p_payload->>'aspectRatioFamily',
    (p_payload->>'documented1kGridWidth')::integer,
    (p_payload->>'documented1kGridHeight')::integer,
    p_payload->>'originalPath',
    p_payload->>'overlayPath',
    p_payload->>'promptPath',
    p_payload->>'masksPath'
  )
  returning * into v_job;
  return jsonb_build_object('ok', true, 'created', true, 'job', to_jsonb(v_job));
exception
  when unique_violation then
    select * into v_existing
    from public.vibode_cleanup_generations
    where user_id = p_user_id
      and paid_request_fingerprint = p_payload->>'paidRequestFingerprint';
    if found and v_existing.input_fingerprint = p_payload->>'inputFingerprint'
       and v_existing.original_sha256 = p_payload->>'originalSha256' then
      return jsonb_build_object('ok', true, 'created', false, 'job', to_jsonb(v_existing));
    end if;
    if found then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', false, 'code', 'active_job');
end;
$$;

create or replace function public.claim_next_vibode_cleanup_generation(p_job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_cleanup_generations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('vibode_cleanup_claim'));
  update public.vibode_cleanup_generations
  set status = 'queued',
      not_before = now(),
      claim_nonce = null,
      claim_expires_at = null,
      claimed_at = null,
      heartbeat_at = null,
      updated_at = now()
  where status = 'running'
    and provider_started_at is null
    and claim_expires_at <= now()
    and attempt_count < public.vibode_cleanup_precontact_attempt_limit()
    and (p_job_id is null or id = p_job_id);
  update public.vibode_cleanup_generations
  set status = 'failed',
      failure_code = 'provider_uncertain',
      failure_message = 'Provider contact ended before a confirmed result.',
      completed_at = now(),
      updated_at = now(),
      claim_nonce = null,
      claim_expires_at = null,
      claimed_at = null,
      heartbeat_at = null
  where status = 'running'
    and provider_started_at is not null
    and output_sha256 is null
    and claim_expires_at <= now()
    and (p_job_id is null or id = p_job_id);
  update public.vibode_cleanup_generations
  set status = 'failed',
      failure_code = 'attempts_exhausted',
      failure_message = 'Clean Up stopped before contacting the provider.',
      completed_at = now(),
      updated_at = now(),
      claim_nonce = null,
      claim_expires_at = null
  where status = 'running'
    and provider_started_at is null
    and claim_expires_at <= now()
    and attempt_count >= public.vibode_cleanup_precontact_attempt_limit()
    and (p_job_id is null or id = p_job_id);
  update public.vibode_cleanup_generations
  set status = 'succeeded',
      completed_at = coalesce(completed_at, now()),
      updated_at = now(),
      claim_nonce = null,
      claim_expires_at = null,
      claimed_at = null,
      heartbeat_at = null,
      failure_code = null,
      failure_message = null
  where status = 'running'
    and provider_started_at is not null
    and output_sha256 is not null
    and output_path is not null
    and claim_expires_at <= now()
    and (p_job_id is null or id = p_job_id);
  if exists (select 1 from public.vibode_cleanup_generations where status = 'running') then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  select * into v_job
  from public.vibode_cleanup_generations
  where status = 'queued'
    and provider_started_at is null
    and not_before <= now()
    and (p_job_id is null or id = p_job_id)
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'idle');
  end if;
  if public.vibode_cleanup_user_provider_started_count(v_job.user_id) >= public.vibode_cleanup_user_daily_provider_limit() then
    update public.vibode_cleanup_generations
    set status = 'failed', failure_code = 'daily_limit', failure_message = 'Daily Clean Up provider limit was reached.',
        completed_at = now(), updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  if public.vibode_cleanup_global_provider_started_count() >= public.vibode_cleanup_global_daily_provider_limit() then
    update public.vibode_cleanup_generations
    set not_before = (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day',
        updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', false, 'code', 'global_daily_limit');
  end if;
  update public.vibode_cleanup_generations
  set status = 'running',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      heartbeat_at = now(),
      claim_expires_at = now() + interval '240 seconds',
      claim_nonce = gen_random_uuid()::text,
      updated_at = now(),
      failure_code = null,
      failure_message = null
  where id = v_job.id
  returning * into v_job;
  return jsonb_build_object(
    'ok', true,
    'claim', jsonb_build_object(
      'jobId', v_job.id,
      'userId', v_job.user_id,
      'roomId', v_job.room_id,
      'claimNonce', v_job.claim_nonce,
      'claimExpiresAtMs', floor(extract(epoch from v_job.claim_expires_at) * 1000),
      'attemptCount', v_job.attempt_count,
      'afcGenerationId', v_job.afc_generation_id,
      'inputFingerprint', v_job.input_fingerprint,
      'paidRequestFingerprint', v_job.paid_request_fingerprint,
      'aspectRatioFamily', v_job.aspect_ratio_family,
      'documented1kGridWidth', v_job.documented_1k_grid_width,
      'documented1kGridHeight', v_job.documented_1k_grid_height,
      'originalSha256', v_job.original_sha256,
      'originalMime', v_job.original_mime,
      'originalWidth', v_job.original_width,
      'originalHeight', v_job.original_height,
      'overlaySha256', v_job.overlay_sha256,
      'promptSha256', v_job.prompt_sha256,
      'promptVersion', v_job.prompt_version,
      'maskManifestSha256', v_job.mask_manifest_sha256,
      'originalPath', v_job.original_path,
      'overlayPath', v_job.overlay_path,
      'promptPath', v_job.prompt_path,
      'masksPath', v_job.masks_path,
      'selection', v_job.selection_summary
    )
  );
end;
$$;

create or replace function public.heartbeat_vibode_cleanup_generation(p_job_id uuid, p_claim_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vibode_cleanup_generations
  set heartbeat_at = now(),
      claim_expires_at = now() + interval '240 seconds',
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and claim_nonce = p_claim_nonce
    and claim_expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.contact_vibode_cleanup_generation(p_job_id uuid, p_claim_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_cleanup_generations%rowtype;
  v_attempt uuid;
begin
  select * into v_job
  from public.vibode_cleanup_generations
  where id = p_job_id
  for update;
  if not found
     or v_job.status <> 'running'
     or v_job.claim_nonce is distinct from p_claim_nonce
     or v_job.claim_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  if v_job.provider_started_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_contacted');
  end if;
  if public.vibode_cleanup_user_provider_started_count(v_job.user_id) >= public.vibode_cleanup_user_daily_provider_limit() then
    update public.vibode_cleanup_generations
    set status = 'failed', failure_code = 'daily_limit',
        failure_message = 'Daily Clean Up provider limit was reached.',
        completed_at = now(), updated_at = now(),
        claim_nonce = null, claim_expires_at = null, claimed_at = null, heartbeat_at = null
    where id = p_job_id;
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  if public.vibode_cleanup_global_provider_started_count() >= public.vibode_cleanup_global_daily_provider_limit() then
    update public.vibode_cleanup_generations
    set status = 'queued',
        attempt_count = greatest(0, attempt_count - 1),
        not_before = (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day',
        claim_nonce = null, claim_expires_at = null, claimed_at = null, heartbeat_at = null,
        updated_at = now()
    where id = p_job_id;
    return jsonb_build_object('ok', false, 'code', 'global_daily_limit');
  end if;
  v_attempt := gen_random_uuid();
  update public.vibode_cleanup_generations
  set provider_started_at = now(),
      provider_attempt_id = v_attempt,
      updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('ok', true, 'attemptId', v_attempt);
end;
$$;

create or replace function public.complete_vibode_cleanup_generation(
  p_job_id uuid,
  p_claim_nonce text,
  p_output jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_cleanup_generations%rowtype;
begin
  select * into v_job from public.vibode_cleanup_generations where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  if v_job.status = 'succeeded' and v_job.output_sha256 = p_output->>'outputSha256' then
    return jsonb_build_object('ok', true, 'code', 'already_complete');
  end if;
  if v_job.status <> 'running' or v_job.claim_nonce is distinct from p_claim_nonce or v_job.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  if v_job.provider_started_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_contacted');
  end if;
  update public.vibode_cleanup_generations
  set status = 'succeeded',
      output_path = 'rooms/' || room_id::text || '/jobs/' || id::text || '/candidate.jpg',
      output_sha256 = p_output->>'outputSha256',
      output_width = (p_output->>'outputWidth')::integer,
      output_height = (p_output->>'outputHeight')::integer,
      returned_model_id = p_output->>'returnedModelId',
      interaction_id = p_output->>'interactionId',
      usage = p_output->'usage',
      provider_status = p_output->>'providerStatus',
      provider_http_status = nullif(p_output->>'providerHttpStatus', '')::integer,
      latency_ms = (p_output->>'latencyMs')::integer,
      failure_code = null,
      failure_message = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('ok', true, 'code', 'completed');
end;
$$;

create or replace function public.settle_vibode_cleanup_candidate(p_job_id uuid, p_claim_nonce text, p_output jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_cleanup_generations%rowtype;
begin
  select * into v_job from public.vibode_cleanup_generations where id = p_job_id for update;
  if not found or v_job.provider_started_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_contacted');
  end if;
  if v_job.status = 'succeeded' and v_job.output_sha256 = p_output->>'outputSha256' then
    return jsonb_build_object('ok', true, 'code', 'already_complete');
  end if;
  if not (
    v_job.status = 'running'
    or (v_job.status = 'failed' and v_job.failure_code = 'provider_uncertain' and v_job.output_sha256 is null)
  ) then
    return jsonb_build_object('ok', false, 'code', 'terminal');
  end if;
  update public.vibode_cleanup_generations
  set status = 'succeeded',
      output_path = 'rooms/' || room_id::text || '/jobs/' || id::text || '/candidate.jpg',
      output_sha256 = p_output->>'outputSha256',
      output_width = (p_output->>'outputWidth')::integer,
      output_height = (p_output->>'outputHeight')::integer,
      returned_model_id = p_output->>'returnedModelId',
      interaction_id = p_output->>'interactionId',
      usage = p_output->'usage',
      provider_status = p_output->>'providerStatus',
      provider_http_status = nullif(p_output->>'providerHttpStatus', '')::integer,
      latency_ms = (p_output->>'latencyMs')::integer,
      failure_code = null,
      failure_message = null,
      completed_at = now(),
      updated_at = now(),
      claim_nonce = null,
      claim_expires_at = null
  where id = p_job_id;
  return jsonb_build_object('ok', true, 'code', 'completed');
end;
$$;

create or replace function public.fail_vibode_cleanup_generation(
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
  v_job public.vibode_cleanup_generations%rowtype;
  v_code text;
begin
  select * into v_job from public.vibode_cleanup_generations where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'terminal');
  end if;
  if v_job.status <> 'running' or v_job.claim_nonce is distinct from p_claim_nonce or v_job.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'stale_claim');
  end if;
  if p_retryable and v_job.provider_started_at is null and v_job.attempt_count < public.vibode_cleanup_precontact_attempt_limit() then
    update public.vibode_cleanup_generations
    set status = 'queued',
        not_before = now() + interval '15 seconds',
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null,
        updated_at = now()
    where id = p_job_id;
    return jsonb_build_object('ok', true, 'disposition', 'requeued');
  end if;
  v_code := case
    when v_job.provider_started_at is null and p_code ~ '^[a-z0-9_]{1,64}$' then p_code
    when p_code in ('provider_rejected', 'unexpected_output', 'provider_uncertain') then p_code
    when p_code = 'content_refused' then 'provider_rejected'
    else 'provider_uncertain'
  end;
  update public.vibode_cleanup_generations
  set status = 'failed',
      failure_code = v_code,
      failure_message = left(regexp_replace(coalesce(p_message, ''), '\s+', ' ', 'g'), 240),
      provider_status = p_provider_status,
      provider_http_status = p_provider_http_status,
      latency_ms = p_latency_ms,
      completed_at = now(),
      updated_at = now(),
      claim_nonce = null,
      claim_expires_at = null,
      claimed_at = null,
      heartbeat_at = null
  where id = p_job_id;
  return jsonb_build_object('ok', true, 'disposition', 'failed');
end;
$$;

create or replace function public.discard_vibode_cleanup_generation(p_user_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.vibode_cleanup_generations%rowtype;
  v_effect text;
begin
  select * into v_job
  from public.vibode_cleanup_generations
  where id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.discarded_at is not null or v_job.status = 'cancelled' then
    update public.vibode_cleanup_generations
    set discarded_at = coalesce(discarded_at, now()), updated_at = now()
    where id = p_job_id
    returning * into v_job;
    return jsonb_build_object('ok', true, 'effect', 'already', 'job', to_jsonb(v_job));
  end if;
  if v_job.provider_started_at is null and v_job.status in ('queued', 'running') then
    update public.vibode_cleanup_generations
    set status = 'cancelled',
        discarded_at = now(),
        completed_at = now(),
        failure_code = 'cancelled',
        failure_message = 'Clean Up was cancelled before provider contact.',
        claim_nonce = null,
        claim_expires_at = null,
        claimed_at = null,
        heartbeat_at = null,
        updated_at = now()
    where id = p_job_id
    returning * into v_job;
    v_effect := 'cancelled';
  else
    update public.vibode_cleanup_generations
    set discarded_at = now(), updated_at = now()
    where id = p_job_id
    returning * into v_job;
    v_effect := 'marked';
  end if;
  return jsonb_build_object('ok', true, 'effect', v_effect, 'job', to_jsonb(v_job));
end;
$$;

create or replace function public.list_recoverable_vibode_cleanup_generations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'jobs', coalesce(jsonb_agg(to_jsonb(job)), '[]'::jsonb)
  )
  from (
    select *
    from public.vibode_cleanup_generations
    where provider_started_at is not null
      and output_sha256 is null
      and status = 'failed'
      and failure_code = 'provider_uncertain'
    order by provider_started_at
    limit 5
  ) as job;
$$;

revoke all on table public.vibode_cleanup_generations from public, anon, authenticated;
grant select, insert, update, delete on table public.vibode_cleanup_generations to service_role;
alter table public.vibode_cleanup_generations enable row level security;

revoke all on function public.vibode_cleanup_user_daily_provider_limit() from public, anon, authenticated;
revoke all on function public.vibode_cleanup_global_daily_provider_limit() from public, anon, authenticated;
revoke all on function public.vibode_cleanup_precontact_attempt_limit() from public, anon, authenticated;
revoke all on function public.vibode_cleanup_user_provider_started_count(uuid) from public, anon, authenticated;
revoke all on function public.vibode_cleanup_global_provider_started_count() from public, anon, authenticated;
revoke all on function public.vibode_cleanup_generations_guard() from public, anon, authenticated;
revoke all on function public.enqueue_vibode_cleanup_generation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_next_vibode_cleanup_generation(uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_vibode_cleanup_generation(uuid, text) from public, anon, authenticated;
revoke all on function public.contact_vibode_cleanup_generation(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_vibode_cleanup_generation(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.settle_vibode_cleanup_candidate(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_vibode_cleanup_generation(uuid, text, text, text, boolean, text, integer, integer) from public, anon, authenticated;
revoke all on function public.discard_vibode_cleanup_generation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_recoverable_vibode_cleanup_generations() from public, anon, authenticated;

grant execute on function public.enqueue_vibode_cleanup_generation(uuid, jsonb) to service_role;
grant execute on function public.claim_next_vibode_cleanup_generation(uuid) to service_role;
grant execute on function public.heartbeat_vibode_cleanup_generation(uuid, text) to service_role;
grant execute on function public.contact_vibode_cleanup_generation(uuid, text) to service_role;
grant execute on function public.complete_vibode_cleanup_generation(uuid, text, jsonb) to service_role;
grant execute on function public.settle_vibode_cleanup_candidate(uuid, text, jsonb) to service_role;
grant execute on function public.fail_vibode_cleanup_generation(uuid, text, text, text, boolean, text, integer, integer) to service_role;
grant execute on function public.discard_vibode_cleanup_generation(uuid, uuid) to service_role;
grant execute on function public.list_recoverable_vibode_cleanup_generations() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vibode-cleanup',
  'vibode-cleanup',
  false,
  48000000,
  array['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/json']::text[]
)
on conflict (id) do nothing;

drop policy if exists vibode_cleanup_deny_anon on storage.objects;
drop policy if exists vibode_cleanup_deny_authenticated on storage.objects;

create policy vibode_cleanup_deny_anon
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'vibode-cleanup')
with check (bucket_id <> 'vibode-cleanup');

create policy vibode_cleanup_deny_authenticated
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'vibode-cleanup')
with check (bucket_id <> 'vibode-cleanup');

commit;
