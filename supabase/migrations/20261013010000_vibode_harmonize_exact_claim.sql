-- Exact Harmonize claim.
--
-- Adds an overload. The existing zero-argument function remains the
-- continuous worker claim and is not modified.
--
-- public.claim_next_vibode_harmonize_generation(uuid) locks and claims
-- that id when it is an eligible queued row. A missing, locked, running,
-- waiting, or terminal row returns no job. It does not scan the queue and
-- it does not reap another job's lease.

begin;

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
begin
  if p_job_id is null then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

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

revoke all on function public.claim_next_vibode_harmonize_generation(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_vibode_harmonize_generation(uuid) to service_role;

commit;
