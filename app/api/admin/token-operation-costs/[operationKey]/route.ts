import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type UpdateOperationCostPayload = {
  tokenCost?: unknown;
  active?: unknown;
  adminLabel?: unknown;
  modelVersion?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function parseTokenCost(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.trunc(value);
    return parsed >= 0 ? parsed : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function parseActive(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ operationKey: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const { operationKey } = await context.params;
  if (!operationKey || operationKey.trim().length < 2) {
    return json(400, { error: "Invalid operation key." });
  }

  const payload = (await request.json().catch(() => ({}))) as UpdateOperationCostPayload;
  const tokenCost = parseTokenCost(payload.tokenCost);
  if (tokenCost === null) {
    return json(400, { error: "tokenCost must be an integer >= 0." });
  }

  const active = parseActive(payload.active);
  if (active === null) {
    return json(400, { error: "active must be true or false." });
  }

  const adminLabel = normalizeOptionalText(payload.adminLabel);
  const modelVersion = normalizeOptionalText(payload.modelVersion);
  if (adminLabel === undefined || modelVersion === undefined) {
    return json(400, { error: "adminLabel/modelVersion must be string, null, or omitted." });
  }

  const updates: Record<string, unknown> = {
    token_cost: tokenCost,
    active,
  };
  if (adminLabel !== undefined) updates.admin_label = adminLabel;
  if (modelVersion !== undefined) updates.model_version = modelVersion;

  const { data, error } = await supabaseAdmin
    .from("vibode_token_operation_costs")
    .update(updates)
    .eq("operation_key", operationKey)
    .select("operation_key,admin_label,model_version,token_cost,active,updated_at")
    .maybeSingle();

  if (error) {
    return json(500, { error: "Failed to update token operation cost." });
  }
  if (!data) {
    return json(404, { error: "Operation key not found." });
  }

  return json(200, {
    row: {
      operationKey: data.operation_key,
      adminLabel: data.admin_label,
      modelVersion: data.model_version,
      tokenCost: data.token_cost,
      active: data.active,
      updatedAt: data.updated_at,
    },
  });
}
