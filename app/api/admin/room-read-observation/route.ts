import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type GeminiUsageObservationRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  model: string;
  workflow_type: string;
  action_type: string;
  route: string;
  status: "success" | "failure";
  request_id: string | null;
  operation_id: string | null;
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
  const parsed = value ? Number.parseInt(value, 10) : 50;
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
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
    .from("vibode_gemini_usage_events")
    .select("id,created_at,user_id,model,workflow_type,action_type,route,status,request_id,operation_id")
    .or(
      [
        "workflow_type.ilike.%room-read%",
        "workflow_type.ilike.%object%",
        "action_type.ilike.%room-read%",
        "action_type.ilike.%object%",
        "route.ilike.%room-read%",
        "route.ilike.%room-image-objects%",
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return json(500, { error: "Failed to load room-read observation rows." });

  const rows = (data ?? []) as GeminiUsageObservationRow[];
  const uniqueUserIds = Array.from(
    new Set(rows.map((row) => safeStr(row.user_id)).filter(Boolean))
  ) as string[];
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
      userEmail: row.user_id ? userEmailById.get(row.user_id) ?? null : null,
      model: row.model,
      workflowType: row.workflow_type,
      actionType: row.action_type,
      route: row.route,
      status: row.status,
      requestId: row.request_id,
      operationId: row.operation_id,
    })),
  });
}
