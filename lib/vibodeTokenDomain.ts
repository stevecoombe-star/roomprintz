import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TOKEN_BOOTSTRAP_STARTER_BALANCE,
  TOKEN_DEFAULT_COSTS,
  type TokenActionKey,
} from "@/lib/vibodeTokenConstants";

type JsonObject = Record<string, unknown>;
type AnySupabaseClient = SupabaseClient;

export type UserTokenWalletRow = {
  user_id: string;
  balance_tokens: number;
  lifetime_granted_tokens: number;
  lifetime_spent_tokens: number;
  monthly_granted_tokens: number;
  monthly_spent_tokens: number;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type TokenLedgerRow = {
  id: string;
  user_id: string;
  room_id: string | null;
  generation_run_id: string | null;
  event_type: string;
  action_type: string;
  stage_number: number | null;
  model_version: string | null;
  tokens_delta: number;
  balance_after: number | null;
  metadata: JsonObject;
  created_at: string;
};

type TokenPriceConfigRow = {
  key: string;
  token_cost: number;
  is_active: boolean;
};

export type TokenAffordabilityResult = {
  allowed: boolean;
  requiredTokens: number;
  balanceTokens: number;
  shortfallTokens: number;
};

export type SpendTokensResult =
  | ({
      ok: true;
      spentTokens: number;
      balanceTokens: number;
      wallet: UserTokenWalletRow;
      ledger: TokenLedgerRow;
    } & TokenAffordabilityResult)
  | ({
      ok: false;
    } & TokenAffordabilityResult);

export type GrantTokensResult = {
  grantedTokens: number;
  balanceTokens: number;
  wallet: UserTokenWalletRow;
  ledger: TokenLedgerRow;
};

export type RefundTokensResult = {
  refundedTokens: number;
  balanceTokens: number;
  wallet: UserTokenWalletRow;
  ledger: TokenLedgerRow;
};

function getMonthPeriodBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isWalletPeriodExpired(wallet: UserTokenWalletRow, now = new Date()) {
  const periodEnd = wallet.current_period_end;
  if (!periodEnd) return true;
  const periodEndMs = Date.parse(periodEnd);
  if (!Number.isFinite(periodEndMs)) return true;
  return periodEndMs <= now.getTime();
}

function ensurePositiveInt(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`[tokens] ${name} must be finite.`);
  }
  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    throw new Error(`[tokens] ${name} must be > 0.`);
  }
  return normalized;
}

async function getExistingWallet(
  supabase: AnySupabaseClient,
  userId: string
): Promise<UserTokenWalletRow | null> {
  const { data, error } = await supabase
    .from("user_token_wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`[tokens] failed to fetch token wallet: ${error.message}`);
  }
  return (data as UserTokenWalletRow | null) ?? null;
}

async function rollWalletPeriodIfExpired(
  supabase: AnySupabaseClient,
  userId: string,
  wallet: UserTokenWalletRow
): Promise<UserTokenWalletRow> {
  if (!isWalletPeriodExpired(wallet)) return wallet;

  const { startIso, endIso } = getMonthPeriodBounds();
  const { data, error } = await supabase
    .from("user_token_wallets")
    .update({
      current_period_start: startIso,
      current_period_end: endIso,
      monthly_granted_tokens: 0,
      monthly_spent_tokens: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("updated_at", wallet.updated_at)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`[tokens] failed to roll token wallet period forward: ${error.message}`);
  }
  if (!data) {
    const racedWallet = await getExistingWallet(supabase, userId);
    if (racedWallet) return racedWallet;
    throw new Error("[tokens] token wallet changed during period rollover; retry request.");
  }

  return data as UserTokenWalletRow;
}

export async function ensureUserTokenWallet(
  supabase: AnySupabaseClient,
  userId: string
): Promise<UserTokenWalletRow> {
  const existing = await getExistingWallet(supabase, userId);
  if (existing) return rollWalletPeriodIfExpired(supabase, userId, existing);

  const { data, error } = await supabase.rpc("ensure_user_token_wallet_bootstrap", {
    p_user_id: userId,
    p_bootstrap_tokens: TOKEN_BOOTSTRAP_STARTER_BALANCE,
  });
  if (error) {
    throw new Error(`[tokens] failed to create token wallet: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("[tokens] ensure_user_token_wallet_bootstrap returned no result row.");
  }
  return row as UserTokenWalletRow;
}

export async function getUserTokenWallet(
  supabase: AnySupabaseClient,
  userId: string
): Promise<UserTokenWalletRow> {
  const existing = await getExistingWallet(supabase, userId);
  if (existing) return existing;
  // Keep deterministic first-touch bootstrap, but avoid periodic counter resets in read paths.
  return ensureUserTokenWallet(supabase, userId);
}

export async function getUserTokenWalletIfExists(
  supabase: AnySupabaseClient,
  userId: string
): Promise<UserTokenWalletRow | null> {
  const wallet = await getExistingWallet(supabase, userId);
  if (!wallet) return null;
  return rollWalletPeriodIfExpired(supabase, userId, wallet);
}

export async function getTokenCostForAction(
  supabase: AnySupabaseClient,
  actionKey: TokenActionKey
): Promise<number> {
  const fallback = TOKEN_DEFAULT_COSTS[actionKey];
  const { data, error } = await supabase
    .from("token_price_config")
    .select("key, token_cost, is_active")
    .eq("key", actionKey)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn(`[tokens] token_price_config read failed for ${actionKey}; using fallback`, error.message);
    }
    return fallback;
  }

  const row = data as TokenPriceConfigRow;
  if (!Number.isFinite(row.token_cost) || Math.trunc(row.token_cost) <= 0) {
    return fallback;
  }
  return Math.trunc(row.token_cost);
}

export function canAffordTokens(args: {
  balanceTokens: number;
  requiredTokens: number;
}): TokenAffordabilityResult {
  const balanceTokens = Math.max(0, Math.trunc(args.balanceTokens));
  const requiredTokens = Math.max(0, Math.trunc(args.requiredTokens));
  const shortfallTokens = Math.max(0, requiredTokens - balanceTokens);
  return {
    allowed: shortfallTokens === 0,
    requiredTokens,
    balanceTokens,
    shortfallTokens,
  };
}

export async function spendTokens(args: {
  supabase: AnySupabaseClient;
  userId: string;
  spendTokens: number;
  eventType: string;
  actionType: string;
  stageNumber?: number | null;
  modelVersion?: string | null;
  roomId?: string | null;
  generationRunId?: string | null;
  metadata?: JsonObject;
  allowNegativeBalance?: boolean;
}): Promise<SpendTokensResult> {
  const spendAmount = ensurePositiveInt(args.spendTokens, "spendTokens");
  const walletBefore = await ensureUserTokenWallet(args.supabase, args.userId);
  const affordability = canAffordTokens({
    balanceTokens: walletBefore.balance_tokens,
    requiredTokens: spendAmount,
  });

  if (!args.allowNegativeBalance && !affordability.allowed) {
    return { ok: false, ...affordability };
  }

  const { data: updatedData, error: updateErr } = await args.supabase
    .from("user_token_wallets")
    .update({
      balance_tokens: walletBefore.balance_tokens - spendAmount,
      lifetime_spent_tokens: walletBefore.lifetime_spent_tokens + spendAmount,
      monthly_spent_tokens: walletBefore.monthly_spent_tokens + spendAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("updated_at", walletBefore.updated_at)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    throw new Error(`[tokens] failed to spend tokens: ${updateErr.message}`);
  }
  if (!updatedData) {
    throw new Error("[tokens] token wallet changed while spending tokens; retry request.");
  }

  const wallet = updatedData as UserTokenWalletRow;
  // NOTE: No SQL transaction is used in this repo path yet. Wallet update + ledger insert is best-effort.
  const { data: ledgerData, error: ledgerErr } = await args.supabase
    .from("token_ledger")
    .insert({
      user_id: args.userId,
      room_id: args.roomId ?? null,
      generation_run_id: args.generationRunId ?? null,
      event_type: args.eventType,
      action_type: args.actionType,
      stage_number: args.stageNumber ?? null,
      model_version: args.modelVersion ?? null,
      tokens_delta: -spendAmount,
      balance_after: wallet.balance_tokens,
      metadata: args.metadata ?? {},
    })
    .select("*")
    .single();

  if (ledgerErr || !ledgerData) {
    const ledgerErrorMessage = ledgerErr?.message ?? "unknown error";
    const { data: rollbackData, error: rollbackErr } = await args.supabase
      .from("user_token_wallets")
      .update({
        balance_tokens: walletBefore.balance_tokens,
        lifetime_spent_tokens: walletBefore.lifetime_spent_tokens,
        monthly_spent_tokens: walletBefore.monthly_spent_tokens,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", args.userId)
      .eq("updated_at", wallet.updated_at)
      .select("user_id")
      .maybeSingle();

    if (rollbackErr || !rollbackData) {
      const rollbackMessage =
        rollbackErr?.message ?? "wallet changed before rollback could be applied";
      console.error("[tokens] CRITICAL integrity warning: spend rollback failed after ledger insert error", {
        userId: args.userId,
        ledgerError: ledgerErrorMessage,
        rollbackError: rollbackMessage,
      });
      throw new Error(
        `[tokens] CRITICAL integrity warning: ledger insert failed after wallet debit, and rollback failed: ${ledgerErrorMessage}; rollback error: ${rollbackMessage}`
      );
    }

    throw new Error(`[tokens] spend rolled back due to ledger failure: ${ledgerErrorMessage}`);
  }

  return {
    ok: true,
    ...canAffordTokens({
      balanceTokens: wallet.balance_tokens + spendAmount,
      requiredTokens: spendAmount,
    }),
    spentTokens: spendAmount,
    balanceTokens: wallet.balance_tokens,
    wallet,
    ledger: ledgerData as TokenLedgerRow,
  };
}

export async function grantTokens(args: {
  supabase: AnySupabaseClient;
  userId: string;
  grantTokens: number;
  eventType: string;
  actionType: string;
  stageNumber?: number | null;
  modelVersion?: string | null;
  roomId?: string | null;
  generationRunId?: string | null;
  metadata?: JsonObject;
}): Promise<GrantTokensResult> {
  const grantTokens = ensurePositiveInt(args.grantTokens, "grantTokens");
  const walletBefore = await ensureUserTokenWallet(args.supabase, args.userId);

  const { data: updatedData, error: updateErr } = await args.supabase
    .from("user_token_wallets")
    .update({
      balance_tokens: walletBefore.balance_tokens + grantTokens,
      lifetime_granted_tokens: walletBefore.lifetime_granted_tokens + grantTokens,
      monthly_granted_tokens: walletBefore.monthly_granted_tokens + grantTokens,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("updated_at", walletBefore.updated_at)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    throw new Error(`[tokens] failed to grant tokens: ${updateErr.message}`);
  }
  if (!updatedData) {
    throw new Error("[tokens] token wallet changed while granting tokens; retry request.");
  }

  const wallet = updatedData as UserTokenWalletRow;
  // NOTE: No SQL transaction is used in this repo path yet. Wallet update + ledger insert is best-effort.
  const { data: ledgerData, error: ledgerErr } = await args.supabase
    .from("token_ledger")
    .insert({
      user_id: args.userId,
      room_id: args.roomId ?? null,
      generation_run_id: args.generationRunId ?? null,
      event_type: args.eventType,
      action_type: args.actionType,
      stage_number: args.stageNumber ?? null,
      model_version: args.modelVersion ?? null,
      tokens_delta: grantTokens,
      balance_after: wallet.balance_tokens,
      metadata: args.metadata ?? {},
    })
    .select("*")
    .single();

  if (ledgerErr || !ledgerData) {
    throw new Error(
      `[tokens] tokens granted but failed to append ledger row: ${ledgerErr?.message ?? "unknown error"}`
    );
  }

  return {
    grantedTokens: grantTokens,
    balanceTokens: wallet.balance_tokens,
    wallet,
    ledger: ledgerData as TokenLedgerRow,
  };
}

export async function refundTokens(args: {
  supabase: AnySupabaseClient;
  userId: string;
  refundTokens: number;
  actionType: string;
  stageNumber?: number | null;
  modelVersion?: string | null;
  roomId?: string | null;
  generationRunId?: string | null;
  metadata?: JsonObject;
}): Promise<RefundTokensResult> {
  const refundTokens = ensurePositiveInt(args.refundTokens, "refundTokens");
  const walletBefore = await ensureUserTokenWallet(args.supabase, args.userId);

  const { data: updatedData, error: updateErr } = await args.supabase
    .from("user_token_wallets")
    .update({
      balance_tokens: walletBefore.balance_tokens + refundTokens,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("updated_at", walletBefore.updated_at)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    throw new Error(`[tokens] failed to refund tokens: ${updateErr.message}`);
  }
  if (!updatedData) {
    throw new Error("[tokens] token wallet changed while refunding tokens; retry request.");
  }

  const wallet = updatedData as UserTokenWalletRow;
  const { data: ledgerData, error: ledgerErr } = await args.supabase
    .from("token_ledger")
    .insert({
      user_id: args.userId,
      room_id: args.roomId ?? null,
      generation_run_id: args.generationRunId ?? null,
      event_type: "refund",
      action_type: args.actionType,
      stage_number: args.stageNumber ?? null,
      model_version: args.modelVersion ?? null,
      tokens_delta: refundTokens,
      balance_after: wallet.balance_tokens,
      metadata: args.metadata ?? {},
    })
    .select("*")
    .single();

  if (ledgerErr || !ledgerData) {
    throw new Error(
      `[tokens] tokens refunded but failed to append ledger row: ${ledgerErr?.message ?? "unknown error"}`
    );
  }

  return {
    refundedTokens: refundTokens,
    balanceTokens: wallet.balance_tokens,
    wallet,
    ledger: ledgerData as TokenLedgerRow,
  };
}
