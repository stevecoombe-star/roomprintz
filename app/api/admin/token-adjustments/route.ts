import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { applyAdminTokenAdjustment } from "@/lib/vibodeTokenDomain";

type AdminTokenAdjustmentPayload = {
  userId?: unknown;
  tokensDelta?: unknown;
  reason?: unknown;
  idempotencyKey?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTokensDelta(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.trunc(value);
    return parsed === 0 ? null : parsed;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  }
  return null;
}

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const payload = (await request.json().catch(() => ({}))) as AdminTokenAdjustmentPayload;
  const userId = normalizeRequiredText(payload.userId);
  const reason = normalizeRequiredText(payload.reason);
  const idempotencyKey = normalizeRequiredText(payload.idempotencyKey);
  const tokensDelta = normalizeTokensDelta(payload.tokensDelta);

  if (!userId || userId.length < 10) {
    return json(400, { error: "Valid userId is required." });
  }
  if (tokensDelta === null) {
    return json(400, { error: "tokensDelta must be a non-zero integer." });
  }
  if (!reason) {
    return json(400, { error: "Reason is required." });
  }
  if (!adminUser.id) {
    return json(500, { error: "Authenticated admin id missing." });
  }

  try {
    const result = await applyAdminTokenAdjustment({
      supabase: supabaseAdmin,
      userId,
      tokensDelta,
      reason,
      adminUserId: adminUser.id,
      idempotencyKey: idempotencyKey ?? undefined,
      metadata: {
        source: "admin_ui",
      },
    });

    return json(200, {
      ok: true,
      userId,
      tokensDelta,
      balanceTokens: result.balanceTokens,
      ledgerId: result.ledgerId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to apply token adjustment.";
    return json(400, { error: message });
  }
}
