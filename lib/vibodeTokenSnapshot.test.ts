import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAuthenticatedTokenSnapshotWallet,
  toTokenSnapshotResponse,
  TokenSnapshotServiceConfigurationError,
} from "./vibodeTokenSnapshot";
import type { UserTokenWalletRow } from "./vibodeTokenDomain";

const verifiedUserId = "123e4567-e89b-42d3-a456-426614174000";
const requestProvidedUserId = "123e4567-e89b-42d3-a456-426614174001";
const wallet: UserTokenWalletRow = {
  user_id: verifiedUserId,
  balance_tokens: 12,
  lifetime_granted_tokens: 42,
  lifetime_spent_tokens: 30,
  monthly_granted_tokens: 20,
  monthly_spent_tokens: 8,
  current_period_start: "2026-07-01T00:00:00.000Z",
  current_period_end: "2026-08-01T00:00:00.000Z",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
};

function authClient(userId: string | null): SupabaseClient {
  return {
    auth: {
      async getUser() {
        return userId
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: new Error("invalid session") };
      },
    },
  } as unknown as SupabaseClient;
}

test("snapshot wallet access authenticates before obtaining a service-role client", async () => {
  let serviceClientRequested = false;
  let walletRequested = false;

  const result = await getAuthenticatedTokenSnapshotWallet({
    authClients: [authClient(null)],
    getServiceRoleClient() {
      serviceClientRequested = true;
      return {} as SupabaseClient;
    },
    async getWallet() {
      walletRequested = true;
      return wallet;
    },
  });

  assert.equal(result, null);
  assert.equal(serviceClientRequested, false);
  assert.equal(walletRequested, false);
});

test("snapshot wallet access ignores an untrusted user ID and uses the verified session user ID", async () => {
  const serviceRoleClient = {} as SupabaseClient;
  let receivedClient: SupabaseClient | null = null;
  let receivedUserId: string | null = null;
  const untrustedRequest = { userId: requestProvidedUserId };

  const result = await getAuthenticatedTokenSnapshotWallet({
    authClients: [authClient(verifiedUserId)],
    getServiceRoleClient: () => serviceRoleClient,
    async getWallet(client, userId) {
      receivedClient = client;
      receivedUserId = userId;
      return wallet;
    },
    ...untrustedRequest,
  });

  assert.equal(result?.verifiedUserId, verifiedUserId);
  assert.equal(receivedClient, serviceRoleClient);
  assert.equal(receivedUserId, verifiedUserId);
  assert.notEqual(receivedUserId, requestProvidedUserId);
});

test("snapshot wallet access fails closed without service-role configuration", async () => {
  await assert.rejects(
    getAuthenticatedTokenSnapshotWallet({
      authClients: [authClient(verifiedUserId)],
      getServiceRoleClient: () => null,
    }),
    TokenSnapshotServiceConfigurationError
  );
});

test("snapshot response fields preserve the existing API contract", () => {
  assert.deepEqual(toTokenSnapshotResponse(wallet), {
    balanceTokens: 12,
    lifetimeGrantedTokens: 42,
    lifetimeSpentTokens: 30,
    monthlyGrantedTokens: 20,
    monthlySpentTokens: 8,
    currentPeriodStart: "2026-07-01T00:00:00.000Z",
    currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  });
});
