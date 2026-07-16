import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getUserTokenWallet,
  type UserTokenWalletRow,
} from "@/lib/vibodeTokenDomain";

type AnySupabaseClient = SupabaseClient;

export class TokenSnapshotServiceConfigurationError extends Error {
  constructor() {
    super("Server configuration missing service role Supabase for token wallet access.");
    this.name = "TokenSnapshotServiceConfigurationError";
  }
}

export type TokenSnapshotResponse = {
  balanceTokens: number;
  lifetimeGrantedTokens: number;
  lifetimeSpentTokens: number;
  monthlyGrantedTokens: number;
  monthlySpentTokens: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};

export async function getAuthenticatedTokenSnapshotWallet(args: {
  authClients: Array<AnySupabaseClient | null>;
  getServiceRoleClient: () => AnySupabaseClient | null;
  getWallet?: (
    serviceRoleClient: AnySupabaseClient,
    verifiedUserId: string
  ) => Promise<UserTokenWalletRow>;
}): Promise<{ verifiedUserId: string; wallet: UserTokenWalletRow } | null> {
  for (const authClient of args.authClients) {
    if (!authClient) continue;

    const { data, error } = await authClient.auth.getUser();
    const verifiedUserId = !error ? data?.user?.id : null;
    if (!verifiedUserId) continue;

    const serviceRoleClient = args.getServiceRoleClient();
    if (!serviceRoleClient) {
      throw new TokenSnapshotServiceConfigurationError();
    }

    const wallet = await (args.getWallet ?? getUserTokenWallet)(serviceRoleClient, verifiedUserId);
    return { verifiedUserId, wallet };
  }

  return null;
}

export function toTokenSnapshotResponse(wallet: UserTokenWalletRow): TokenSnapshotResponse {
  return {
    balanceTokens: wallet.balance_tokens,
    lifetimeGrantedTokens: wallet.lifetime_granted_tokens,
    lifetimeSpentTokens: wallet.lifetime_spent_tokens,
    monthlyGrantedTokens: wallet.monthly_granted_tokens,
    monthlySpentTokens: wallet.monthly_spent_tokens,
    currentPeriodStart: wallet.current_period_start,
    currentPeriodEnd: wallet.current_period_end,
  };
}
