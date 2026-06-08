import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type TokenLedgerAdjustmentRow = {
  id: string;
  created_at: string;
  user_id: string;
  tokens_delta: number;
  metadata: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 25;
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

function parseMetadata(value: unknown): { reason: string | null; adminUserId: string | null } {
  if (!value || typeof value !== "object") return { reason: null, adminUserId: null };
  const source = value as Record<string, unknown>;
  return {
    reason: safeStr(source.reason),
    adminUserId: safeStr(source.admin_user_id),
  };
}

export async function GET(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));

  const { data, error } = await supabaseAdmin
    .from("token_ledger")
    .select("id,created_at,user_id,tokens_delta,metadata")
    .eq("operation_key", "ADMIN_ADJUSTMENT")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return json(500, { error: "Failed to load recent admin adjustments." });

  const rows = (data ?? []) as TokenLedgerAdjustmentRow[];
  const uniqueUserIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const userEmailById = new Map<string, string | null>();
  await Promise.all(
    uniqueUserIds.map(async (id) => {
      try {
        const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(id);
        if (userErr || !userData?.user) {
          userEmailById.set(id, null);
          return;
        }
        userEmailById.set(id, safeStr(userData.user.email));
      } catch {
        userEmailById.set(id, null);
      }
    })
  );

  return json(200, {
    rows: rows.map((row) => {
      const metadata = parseMetadata(row.metadata);
      return {
        id: row.id,
        createdAt: row.created_at,
        userId: row.user_id,
        userEmail: userEmailById.get(row.user_id) ?? null,
        tokensDelta: row.tokens_delta,
        reason: metadata.reason,
        adminUserId: metadata.adminUserId,
      };
    }),
  });
}
