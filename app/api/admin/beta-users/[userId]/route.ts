import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type UpdateUserLimitPayload = {
  betaTopupLimit?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function parseOverride(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.trunc(value);
    return parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const { userId } = await context.params;
  if (!userId || userId.length < 10) {
    return json(400, { error: "Invalid user id." });
  }

  const payload = (await request.json().catch(() => ({}))) as UpdateUserLimitPayload;
  const betaTopupLimit = parseOverride(payload.betaTopupLimit);
  if (betaTopupLimit === undefined) {
    return json(400, { error: "Beta top-up limit override must be empty/null or integer >= 0." });
  }

  const { error } = await supabaseAdmin.from("beta_user_settings").upsert({
    user_id: userId,
    beta_topup_limit: betaTopupLimit,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return json(500, { error: "Failed to update user beta top-up limit." });
  }

  return json(200, {
    ok: true,
    userId,
    betaTopupLimit,
  });
}
