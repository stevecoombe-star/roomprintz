-- P0-2: Atomic wallet bootstrap for first-touch wallet creation.
-- Guarantees wallet + bootstrap ledger are created together or not at all.
create or replace function public.ensure_user_token_wallet_bootstrap(
  p_user_id uuid,
  p_bootstrap_tokens integer default 40
)
returns table (
  user_id uuid,
  balance_tokens integer,
  lifetime_granted_tokens integer,
  lifetime_spent_tokens integer,
  monthly_granted_tokens integer,
  monthly_spent_tokens integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.user_token_wallets%rowtype;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_bootstrap_tokens is null or p_bootstrap_tokens <= 0 then
    raise exception 'bootstrap_tokens must be > 0';
  end if;

  -- Fast path: existing wallet should not be mutated by bootstrap logic.
  select *
  into v_wallet
  from public.user_token_wallets
  where public.user_token_wallets.user_id = p_user_id
  for update;

  if found then
    return query
    select
      v_wallet.user_id,
      v_wallet.balance_tokens,
      v_wallet.lifetime_granted_tokens,
      v_wallet.lifetime_spent_tokens,
      v_wallet.monthly_granted_tokens,
      v_wallet.monthly_spent_tokens,
      v_wallet.current_period_start,
      v_wallet.current_period_end,
      v_wallet.created_at,
      v_wallet.updated_at;
    return;
  end if;

  v_start := date_trunc('month', timezone('UTC', now())) at time zone 'UTC';
  v_end := (date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC';

  insert into public.user_token_wallets (
    user_id,
    balance_tokens,
    lifetime_granted_tokens,
    lifetime_spent_tokens,
    monthly_granted_tokens,
    monthly_spent_tokens,
    current_period_start,
    current_period_end
  )
  values (
    p_user_id,
    p_bootstrap_tokens,
    p_bootstrap_tokens,
    0,
    p_bootstrap_tokens,
    0,
    v_start,
    v_end
  )
  on conflict on constraint user_token_wallets_pkey do nothing
  returning * into v_wallet;

  if not found then
    -- Lost the race to create wallet. Return the winner unchanged.
    select *
    into v_wallet
    from public.user_token_wallets
    where public.user_token_wallets.user_id = p_user_id
    for update;

    return query
    select
      v_wallet.user_id,
      v_wallet.balance_tokens,
      v_wallet.lifetime_granted_tokens,
      v_wallet.lifetime_spent_tokens,
      v_wallet.monthly_granted_tokens,
      v_wallet.monthly_spent_tokens,
      v_wallet.current_period_start,
      v_wallet.current_period_end,
      v_wallet.created_at,
      v_wallet.updated_at;
    return;
  end if;

  insert into public.token_ledger (
    user_id,
    event_type,
    action_type,
    tokens_delta,
    balance_after,
    metadata
  )
  values (
    p_user_id,
    'bootstrap',
    'BOOTSTRAP',
    p_bootstrap_tokens,
    v_wallet.balance_tokens,
    jsonb_build_object(
      'source', 'beta_bootstrap',
      'note', 'Initial internal starter balance'
    )
  );

  return query
  select
    v_wallet.user_id,
    v_wallet.balance_tokens,
    v_wallet.lifetime_granted_tokens,
    v_wallet.lifetime_spent_tokens,
    v_wallet.monthly_granted_tokens,
    v_wallet.monthly_spent_tokens,
    v_wallet.current_period_start,
    v_wallet.current_period_end,
    v_wallet.created_at,
    v_wallet.updated_at;
end;
$$;
