import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type TokenLedgerRow = {
  id: string;
  created_at: string;
  user_id: string;
  event_type: string;
  action_type: string;
  operation_key: string | null;
  tokens_delta: number;
  balance_after: number | null;
  charge_phase: string | null;
  operation_id: string | null;
  request_id: string | null;
  idempotency_key: string | null;
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

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseNonNegativeInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function summarizeMetadata(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
  } catch {
    return "[unserializable metadata]";
  }
}

export async function GET(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const url = new URL(request.url);
  const userId = safeStr(url.searchParams.get("userId"));
  const operationKey = safeStr(url.searchParams.get("operationKey"));
  const eventType = safeStr(url.searchParams.get("eventType"));
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
  const days = parseNonNegativeInt(url.searchParams.get("days"), 14, 365);

  const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from("token_ledger")
    .select(
      "id,created_at,user_id,event_type,action_type,operation_key,tokens_delta,balance_after,charge_phase,operation_id,request_id,idempotency_key,metadata",
      { count: "exact" }
    )
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (userId) query = query.eq("user_id", userId);
  if (operationKey) query = query.eq("operation_key", operationKey);
  if (eventType) query = query.eq("event_type", eventType);

  const { data, error, count } = await query;
  if (error) return json(500, { error: "Failed to load token ledger rows." });

  const rows = (data ?? []) as TokenLedgerRow[];
  const uniqueUserIds = Array.from(new Set(rows.map((row) => safeStr(row.user_id)).filter(Boolean))) as string[];
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
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      userId: row.user_id,
      userEmail: userEmailById.get(row.user_id) ?? null,
      eventType: row.event_type,
      actionType: row.action_type,
      operationKey: row.operation_key,
      tokensDelta: row.tokens_delta,
      balanceAfter: row.balance_after,
      chargePhase: row.charge_phase,
      operationId: row.operation_id,
      requestId: row.request_id,
      idempotencyKey: row.idempotency_key,
      metadataSummary: summarizeMetadata(row.metadata),
      metadata: row.metadata,
    })),
    filters: {
      userId,
      operationKey,
      eventType,
      limit,
      days,
    },
    totalCount: count ?? rows.length,
  });
}
