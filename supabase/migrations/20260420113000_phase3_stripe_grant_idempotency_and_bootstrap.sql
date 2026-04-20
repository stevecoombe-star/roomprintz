-- P0-1: Enforce DB-level idempotency for Stripe grants.
-- This guarantees one grant per (user_id, action_type, reference_id)
-- for Stripe grant actions, even under concurrent webhook deliveries.
create unique index if not exists token_ledger_grant_reference_unique_idx
  on public.token_ledger (user_id, action_type, ((metadata ->> 'reference_id')))
  where event_type = 'grant'
    and action_type in ('topup', 'subscription')
    and metadata ? 'reference_id';

-- P0-1: Atomic grant apply path for Stripe webhook.
-- Runs wallet update + ledger insert in a single DB transaction boundary.
create or replace function public.apply_stripe_token_grant(
  p_user_id uuid,
  p_grant_amount integer,
  p_action_type text,
  p_reference_id text,
  p_model_version text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  skipped boolean,
  balance_tokens integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference_id text := nullif(trim(p_reference_id), '');
  v_wallet public.user_token_wallets%rowtype;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_grant_amount is null or p_grant_amount <= 0 then
    raise exception 'grant_amount must be > 0';
  end if;

  if p_action_type not in ('topup', 'subscription') then
    raise exception 'unsupported action_type for Stripe grant: %', p_action_type;
  end if;

  if v_reference_id is null then
    raise exception 'reference_id is required for Stripe grant idempotency';
  end if;

  -- Lock wallet row to serialize grant evaluation and mutation per user.
  select *
  into v_wallet
  from public.user_token_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'token wallet missing for user %', p_user_id;
  end if;

  -- Keep monthly counters behavior consistent with existing wallet logic.
  if v_wallet.current_period_end is null or v_wallet.current_period_end <= now() then
    v_start := date_trunc('month', timezone('UTC', now())) at time zone 'UTC';
    v_end := (date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC';

    update public.user_token_wallets
    set
      current_period_start = v_start,
      current_period_end = v_end,
      monthly_granted_tokens = 0,
      monthly_spent_tokens = 0,
      updated_at = now()
    where user_id = p_user_id
    returning * into v_wallet;
  end if;

  -- Fast idempotency branch before mutating wallet.
  if exists (
    select 1
    from public.token_ledger
    where user_id = p_user_id
      and event_type = 'grant'
      and action_type = p_action_type
      and metadata ->> 'reference_id' = v_reference_id
    limit 1
  ) then
    return query select true as skipped, v_wallet.balance_tokens as balance_tokens;
    return;
  end if;

  update public.user_token_wallets
  set
    balance_tokens = v_wallet.balance_tokens + p_grant_amount,
    lifetime_granted_tokens = v_wallet.lifetime_granted_tokens + p_grant_amount,
    monthly_granted_tokens = v_wallet.monthly_granted_tokens + p_grant_amount,
    updated_at = now()
  where user_id = p_user_id
  returning * into v_wallet;

  begin
    insert into public.token_ledger (
      user_id,
      event_type,
      action_type,
      model_version,
      tokens_delta,
      balance_after,
      metadata
    )
    values (
      p_user_id,
      'grant',
      p_action_type,
      p_model_version,
      p_grant_amount,
      v_wallet.balance_tokens,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('reference_id', v_reference_id)
    );
  exception
    when unique_violation then
      -- Safety net for races: revert the prior wallet increment before skipping.
      update public.user_token_wallets
      set
        balance_tokens = v_wallet.balance_tokens - p_grant_amount,
        lifetime_granted_tokens = v_wallet.lifetime_granted_tokens - p_grant_amount,
        monthly_granted_tokens = v_wallet.monthly_granted_tokens - p_grant_amount,
        updated_at = now()
      where user_id = p_user_id
      returning * into v_wallet;
      return query select true as skipped, v_wallet.balance_tokens as balance_tokens;
      return;
  end;

  return query select false as skipped, v_wallet.balance_tokens as balance_tokens;
end;
$$;
