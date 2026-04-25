import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { readGlobalBetaSettings } from "@/lib/betaSettings.server";

type BetaUserSettingsLimitRow = {
  user_id: string;
  beta_topup_limit: number | null;
};

type TokenLedgerTopupGrantRow = {
  user_id: string;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function parseLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : null;
}

export async function GET() {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const settings = await readGlobalBetaSettings(supabaseAdmin, {
    allowLocalEnvFallback: true,
  }).catch(() => null);

  if (!settings) {
    return json(500, { error: "Failed to load global beta settings." });
  }

  const users: Array<{
    id: string;
    email: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
  }> = [];

  const perPage = 200;
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      return json(500, { error: "Failed to load users." });
    }

    const chunk = data?.users ?? [];
    for (const user of chunk) {
      users.push({
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
      });
    }

    if (chunk.length < perPage || users.length >= 1000) break;
    page += 1;
  }

  if (users.length === 0) {
    return json(200, { users: [], defaultTopupLimit: settings.defaultTopupLimit });
  }

  const userIds = users.map((user) => user.id);

  const { data: userSettingsRows, error: userSettingsErr } = await supabaseAdmin
    .from("beta_user_settings")
    .select("user_id,beta_topup_limit")
    .in("user_id", userIds);

  if (userSettingsErr) {
    return json(500, { error: "Failed to load user beta overrides." });
  }

  const { data: topupGrantRows, error: grantsErr } = await supabaseAdmin
    .from("token_ledger")
    .select("user_id")
    .in("user_id", userIds)
    .eq("event_type", "grant")
    .eq("action_type", "topup");

  if (grantsErr) {
    return json(500, { error: "Failed to load top-up usage counts." });
  }

  const overrideByUserId = new Map<string, number | null>();
  for (const row of (userSettingsRows ?? []) as BetaUserSettingsLimitRow[]) {
    overrideByUserId.set(row.user_id, parseLimit(row.beta_topup_limit));
  }

  const topupUsedByUserId = new Map<string, number>();
  for (const row of (topupGrantRows ?? []) as TokenLedgerTopupGrantRow[]) {
    topupUsedByUserId.set(row.user_id, (topupUsedByUserId.get(row.user_id) ?? 0) + 1);
  }

  const normalizedUsers = users
    .map((user) => {
      const topupLimitOverride = overrideByUserId.get(user.id) ?? null;
      const effectiveTopupLimit = topupLimitOverride ?? settings.defaultTopupLimit;
      const topupsUsed = topupUsedByUserId.get(user.id) ?? 0;

      return {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        lastSignInAt: user.lastSignInAt,
        topupsUsed,
        effectiveTopupLimit,
        betaTopupLimitOverride: topupLimitOverride,
      };
    })
    .sort((a, b) => {
      const aDate = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bDate = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bDate - aDate;
    });

  return json(200, {
    users: normalizedUsers,
    defaultTopupLimit: settings.defaultTopupLimit,
  });
}
