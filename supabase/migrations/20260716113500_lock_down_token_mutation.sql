-- Restrict all token mutations to server-side service-role clients while
-- preserving authenticated users' read-only access to their own token data.

begin;

revoke all on function public.apply_stripe_token_grant(uuid, integer, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_token_grant(uuid, integer, text, text, text, jsonb)
  to service_role;

revoke all on function public.ensure_user_token_wallet_bootstrap(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.ensure_user_token_wallet_bootstrap(uuid, integer)
  to service_role;

drop policy if exists "user_token_wallets_owner_all" on public.user_token_wallets;
drop policy if exists "token_ledger_insert_own" on public.token_ledger;
drop policy if exists "token_ledger_owner_all" on public.token_ledger;

-- Remove every client-facing policy first, including policies introduced by
-- environments that predate this migration. The explicit SELECT policies below
-- are the sole authenticated-user access path after this migration.
do $$
declare
  target_table text;
  target_policy text;
begin
  foreach target_table in array array['user_token_wallets', 'token_ledger']
  loop
    for target_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and exists (
          select 1
          from unnest(roles) as policy_role(role_name)
          where role_name in ('public', 'anon', 'authenticated')
        )
    loop
      execute format('drop policy if exists %I on public.%I', target_policy, target_table);
    end loop;
  end loop;
end;
$$;

revoke all privileges on table public.user_token_wallets from public, anon, authenticated;
grant select on table public.user_token_wallets to authenticated;
grant all privileges on table public.user_token_wallets to service_role;

create policy "user_token_wallets_owner_select"
on public.user_token_wallets
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all privileges on table public.token_ledger from public, anon, authenticated;
grant select on table public.token_ledger to authenticated;
grant all privileges on table public.token_ledger to service_role;

create policy "token_ledger_owner_select"
on public.token_ledger
for select
to authenticated
using ((select auth.uid()) = user_id);

commit;
