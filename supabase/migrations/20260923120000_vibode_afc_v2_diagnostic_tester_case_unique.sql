-- AFD-3A: tester Case uniqueness hardening.
--
-- At most one tester-originated Diagnostic Case per reporter + generation.
-- admin_capture remains independently legal and is excluded from this
-- partial unique index. Case evidence shape is unchanged. No browser
-- grants or RLS policies are added. Service-role DML only.

begin;

create unique index vibode_afc_diagnostic_cases_one_tester_reporter_generation_uidx
  on public.vibode_afc_diagnostic_cases (
    reporter_user_id,
    reported_generation_id
  )
  where "trigger" in ('manual_report', 'repeated_unsuccessful');

commit;
