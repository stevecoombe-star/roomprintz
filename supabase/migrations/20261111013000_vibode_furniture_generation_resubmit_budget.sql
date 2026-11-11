-- MESHY-1D.2G exhausted resubmission recovery.
--
-- An authorized retry whose paid budget is already spent used to stay
-- reserved, which held the only processing slot. The refused commit now
-- parks that job in needs_review, keeps the credit and tester holds, and
-- closes the live authorization. The event row keeps the earlier approval.
-- A later budget change cannot reuse it. This file does not rewrite stored
-- jobs or the global control row.

begin;

create table public.vibode_furniture_generation_resubmit_events (
  event_id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  user_id uuid not null,
  action text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint vibode_furniture_generation_resubmit_events_action
    check (action in ('authorize', 'revoke', 'consume')),
  constraint vibode_furniture_generation_resubmit_events_reason
    check (reason in ('operator_recovery', 'submission_budget_exhausted', 'submission_committed'))
);

comment on table public.vibode_furniture_generation_resubmit_events is
  'Immutable history of an operator resubmission approval and how that approval was closed. Rows do not grant a new provider submission.';

alter table public.vibode_furniture_generation_resubmit_events enable row level security;

revoke all on table public.vibode_furniture_generation_resubmit_events from public, anon, authenticated, service_role;

create or replace function public.vibode_furniture_generation_resubmit_events_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'VIBODE_FURNITURE_GENERATION:RESUBMIT_EVENT_IMMUTABLE';
end;
$fn$;

create trigger vibode_furniture_generation_resubmit_events_no_update
before update on public.vibode_furniture_generation_resubmit_events
for each row execute function public.vibode_furniture_generation_resubmit_events_immutable();

create trigger vibode_furniture_generation_resubmit_events_no_delete
before delete on public.vibode_furniture_generation_resubmit_events
for each row execute function public.vibode_furniture_generation_resubmit_events_immutable();

create trigger vibode_furniture_generation_resubmit_events_no_truncate
before truncate on public.vibode_furniture_generation_resubmit_events
for each statement execute function public.vibode_furniture_generation_resubmit_events_immutable();

revoke all on function public.vibode_furniture_generation_resubmit_events_immutable()
  from public, anon, authenticated, service_role;

create or replace function public.commit_vibode_furniture_generation_submission(
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
  v_controls public.vibode_furniture_generation_controls%rowtype;
  v_nonce uuid;
  v_used integer;
  v_profile jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('vibode-furniture-generation')::bigint);
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
  if v_job.status <> 'reserved' or v_job.provider_task_id is not null or v_job.attempt_count >= 2 then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  if v_job.attempt_count > 0 and v_job.resubmit_authorized_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
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
  if v_job.allowance_state is not null and (
    v_job.ai_model is distinct from 'meshy-7.1'
    or v_job.operation is distinct from 'image-to-3d'
    or v_job.image_slots is distinct from array['front']::text[]
    or v_job.settings is distinct from v_profile
    or v_job.reserved_credits is distinct from 30
  ) then
    return jsonb_build_object('ok', false, 'code', 'unsupported_settings');
  end if;
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found or v_controls.live_enabled is distinct from true then
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  update public.vibode_furniture_generation_controls
  set paid_submissions_used = paid_submissions_used + 1
  where control_id = 'global'
    and paid_submissions_used < paid_submissions_authorized
  returning paid_submissions_used into v_used;
  if not found then
    if v_job.provider_contacted_at is not null then
      update public.vibode_furniture_generation_jobs
      set status = 'needs_review',
        error_class = 'submission_budget_exhausted',
        error_code = 'submission_budget_exhausted',
        resubmit_authorized_at = null,
        claim_nonce = null,
        claim_expires_at = null
      where job_id = v_job.job_id;
      insert into public.vibode_furniture_generation_resubmit_events (
        job_id, user_id, action, reason
      ) values (
        v_job.job_id, v_job.user_id, 'revoke', 'submission_budget_exhausted'
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'submission_not_authorized',
        'job_id', v_job.job_id,
        'status', 'needs_review',
        'error_class', 'submission_budget_exhausted'
      );
    end if;
    update public.vibode_furniture_generation_jobs
    set claim_nonce = null, claim_expires_at = null
    where job_id = v_job.job_id;
    return jsonb_build_object('ok', false, 'code', 'submission_not_authorized');
  end if;
  if v_job.resubmit_authorized_at is not null then
    insert into public.vibode_furniture_generation_resubmit_events (
      job_id, user_id, action, reason
    ) values (
      v_job.job_id, v_job.user_id, 'consume', 'submission_committed'
    );
  end if;
  v_nonce := gen_random_uuid();
  update public.vibode_furniture_generation_jobs
  set attempt_count = attempt_count + 1,
    resubmit_authorized_at = null,
    provider_contacted_at = now(),
    absence_reconciled_at = null,
    status = 'submitting',
    error_class = null,
    error_code = null,
    claim_nonce = v_nonce,
    claim_expires_at = now() + interval '120 seconds'
  where job_id = v_job.job_id;
  return jsonb_build_object(
    'ok', true,
    'purpose', 'submit',
    'job_id', v_job.job_id,
    'claim_nonce', v_nonce,
    'status', 'submitting',
    'paid_submissions_used', v_used
  );
end;
$fn$;

revoke all on function public.commit_vibode_furniture_generation_submission(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_vibode_furniture_generation_submission(uuid, uuid, uuid)
  to service_role;

create or replace function public.admin_authorize_vibode_furniture_generation_resubmit(
  p_job_id uuid,
  p_duplicate_charge_risk_accepted boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_job public.vibode_furniture_generation_jobs%rowtype;
begin
  if p_duplicate_charge_risk_accepted is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  select * into v_job
  from public.vibode_furniture_generation_jobs
  where job_id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_job.status <> 'needs_review'
    or v_job.provider_task_id is not null
    or v_job.saved_asset_id is not null
    or v_job.attempt_count >= 2
    or v_job.error_class = 'credit_unreported'
    or (
      v_job.consumed_credits is null
      and v_job.provider_status in ('FAILED', 'CANCELED', 'SUCCEEDED')
    )
  then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;
  update public.vibode_furniture_generation_jobs
  set status = 'reserved',
    resubmit_authorized_at = now(),
    error_class = null,
    error_code = null,
    claim_nonce = null,
    claim_expires_at = null
  where job_id = v_job.job_id;
  insert into public.vibode_furniture_generation_resubmit_events (
    job_id, user_id, action, reason
  ) values (
    v_job.job_id, v_job.user_id, 'authorize', 'operator_recovery'
  );
  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.job_id,
    'status', 'reserved',
    'duplicate_charge_risk', true
  );
end;
$fn$;

revoke all on function public.admin_authorize_vibode_furniture_generation_resubmit(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_authorize_vibode_furniture_generation_resubmit(uuid, boolean)
  to service_role;

commit;
