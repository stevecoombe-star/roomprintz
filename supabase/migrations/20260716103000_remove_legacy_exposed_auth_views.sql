-- Remove legacy views that exposed auth.users-derived personal data
-- through the public Data API.
--
-- account_entitlements depends on token_balance, so it must be
-- dropped first. RESTRICT prevents accidental removal of any
-- unexpected dependent database objects.

begin;

drop view if exists public.account_entitlements restrict;
drop view if exists public.token_balance restrict;

commit;
