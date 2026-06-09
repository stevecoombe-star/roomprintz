import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

type TokenOperationCostRow = {
  operation_key: string;
  admin_label: string;
  model_version: string | null;
  token_cost: number;
  active: boolean;
  updated_at: string;
};

export async function GET() {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const { data, error } = await supabaseAdmin
    .from("vibode_token_operation_costs")
    .select("operation_key,admin_label,model_version,token_cost,active,updated_at")
    .order("admin_label", { ascending: true });

  if (error) {
    return json(500, { error: "Failed to load token operation costs." });
  }

  return json(200, {
    rows: ((data ?? []) as TokenOperationCostRow[]).map((row) => ({
      operationKey: row.operation_key,
      adminLabel: row.admin_label,
      modelVersion: row.model_version,
      tokenCost: Number.isFinite(row.token_cost) ? Math.trunc(row.token_cost) : 0,
      active: Boolean(row.active),
      updatedAt: row.updated_at,
    })),
  });
}
