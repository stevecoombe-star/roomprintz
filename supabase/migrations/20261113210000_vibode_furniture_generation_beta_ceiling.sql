-- MESHY-1D.5B.2 one additional controlled paid-beta generation.
--
-- The certified ledger is false|1|40|0|30|1|1. A 30-credit reservation
-- needs the historical 30 to stay consumed, so the ceiling must be 60
-- and one unused paid submission must exist. The result is
-- false|1|60|0|30|2|1. A later 30-credit settlement ends at
-- false|1|60|0|60|2|2.
--
-- The ceiling trigger rejects every credit_ceiling change, including
-- this one, so this migration disables that trigger for a single update
-- and enables it again in the same transaction. The trigger function is
-- unchanged. service_role still has no table privileges. The paid-grant
-- function is unchanged and still refuses once authorization is at least
-- 1, so this file is the only path from 1 to 2. The replacement checks
-- then freeze the ceiling at 60 and paid authorization at 2.
--
-- Review before applying. Do not apply to hosted Supabase without
-- explicit approval.

begin;

do $$
declare
  v_controls public.vibode_furniture_generation_controls%rowtype;
  v_updated integer;
begin
  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global'
  for update;
  if not found
    or v_controls.live_enabled is distinct from false
    or v_controls.max_concurrent is distinct from 1
    or v_controls.credit_ceiling is distinct from 40
    or v_controls.credits_reserved is distinct from 0
    or v_controls.credits_consumed is distinct from 30
    or v_controls.paid_submissions_authorized is distinct from 1
    or v_controls.paid_submissions_used is distinct from 1
  then
    raise exception 'VIBODE_FURNITURE_GENERATION:BASELINE_MISMATCH';
  end if;

  alter table public.vibode_furniture_generation_controls
    drop constraint vibode_furniture_generation_controls_ceiling;
  alter table public.vibode_furniture_generation_controls
    drop constraint vibode_furniture_generation_paid_authorized_range;
  alter table public.vibode_furniture_generation_controls
    disable trigger vibode_furniture_generation_protect_controls;

  update public.vibode_furniture_generation_controls
  set credit_ceiling = 60,
    paid_submissions_authorized = 2
  where control_id = 'global'
    and live_enabled is false
    and max_concurrent = 1
    and credit_ceiling = 40
    and credits_reserved = 0
    and credits_consumed = 30
    and paid_submissions_authorized = 1
    and paid_submissions_used = 1;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VIBODE_FURNITURE_GENERATION:BASELINE_MISMATCH';
  end if;

  alter table public.vibode_furniture_generation_controls
    enable trigger vibode_furniture_generation_protect_controls;
  alter table public.vibode_furniture_generation_controls
    add constraint vibode_furniture_generation_controls_ceiling
      check (credit_ceiling = 60);
  alter table public.vibode_furniture_generation_controls
    add constraint vibode_furniture_generation_paid_authorized_range
      check (paid_submissions_authorized = 2);

  select * into v_controls
  from public.vibode_furniture_generation_controls
  where control_id = 'global';
  if v_controls.live_enabled is distinct from false
    or v_controls.max_concurrent is distinct from 1
    or v_controls.credit_ceiling is distinct from 60
    or v_controls.credits_reserved is distinct from 0
    or v_controls.credits_consumed is distinct from 30
    or v_controls.paid_submissions_authorized is distinct from 2
    or v_controls.paid_submissions_used is distinct from 1
  then
    raise exception 'VIBODE_FURNITURE_GENERATION:BASELINE_MISMATCH';
  end if;
end;
$$;

comment on column public.vibode_furniture_generation_controls.credit_ceiling is
  'Global Meshy credit ceiling. The controlled beta value is exactly 60: 30 already consumed plus one 30-credit reservation. The protect trigger rejects later edits.';
comment on column public.vibode_furniture_generation_controls.paid_submissions_authorized is
  'Paid Meshy submissions authorized for the controlled beta. The value is exactly 2. The grant function does not raise it, and a third submission is rejected.';

commit;
