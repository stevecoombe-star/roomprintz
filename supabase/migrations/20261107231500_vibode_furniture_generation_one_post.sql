-- MESHY-1C.2G strict one-POST allowance.
-- Review before apply. This file is not applied to hosted Supabase in this phase.
--
-- HTTP 429 previously returned the job to reserved and released
-- paid_submissions_used, so the worker could POST again. A provider POST
-- attempt now keeps that count. The job fails as rate_limited, with no
-- provider task and no consumed provider credits. Polling and
-- reconciliation of an already created task do not call this function.

begin;

comment on column public.vibode_furniture_generation_controls.paid_submissions_used is
  'Paid provider POST attempts already consumed. HTTP 429, another definite rejection, an ambiguous result, a Meshy credit refund, discard, expiry, or a worker restart does not return this allowance.';

create or replace function public.settle_vibode_furniture_generation_rate_limit(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_nonce uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
begin
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.claim_nonce is distinct from p_claim_nonce or v_job.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'lease_held');
  end if;
  if v_job.status <> 'submitting' or v_job.provider_task_id is not null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.quota_state = 'reserved' then
    update public.vibode_furniture_generation_controls
    set credits_reserved = credits_reserved - v_job.reserved_credits
    where control_id = 'global';
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'failed',
    quota_state = case when quota_state = 'reserved' then 'released' else quota_state end,
    consumed_credits = coalesce(consumed_credits, 0),
    error_class = 'rate_limited',
    error_code = 'rate_limited',
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', 'failed',
    'error_class', 'rate_limited',
    'provider_credits_refunded', false
  );
end;
$fn$;

commit;
