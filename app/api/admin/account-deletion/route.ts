import { NextResponse } from "next/server";
import { operatorDecision } from "@/lib/account-deletion/admission";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

export const runtime = "nodejs";

type AccountDeletionPayload = {
  userId?: unknown;
  confirmEmail?: unknown;
  attemptId?: unknown;
  action?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

export type AdminAccountDeletionHandlerDeps = {
  getAuthenticatedAdminUser?: typeof getAuthenticatedAdminUser;
  getServiceRoleSupabaseClient?: typeof getServiceRoleSupabaseClient;
};

export function createAdminAccountDeletionPostHandler(
  deps: AdminAccountDeletionHandlerDeps = {},
) {
  const resolveAdminUser = deps.getAuthenticatedAdminUser ?? getAuthenticatedAdminUser;
  const resolveServiceRoleClient =
    deps.getServiceRoleSupabaseClient ?? getServiceRoleSupabaseClient;

  return async function POST(request: Request) {
    const adminUser = await resolveAdminUser();
    if (!adminUser) return json(403, { error: "Admin access required." });
    const supabaseAdmin = resolveServiceRoleClient();
    if (!supabaseAdmin) {
      return json(500, { error: "Server configuration missing for admin controls." });
    }

    const payload = (await request.json().catch(() => ({}))) as AccountDeletionPayload;
    const userId = safeString(payload.userId)?.trim() ?? "";
    const confirmEmail = safeString(payload.confirmEmail) ?? "";
    const attemptId = safeString(payload.attemptId)?.trim().toLowerCase() ?? "";
    const action = payload.action === "abandon" || payload.action === "resume" ? payload.action : null;

    if (!UUID_RE.test(userId) || !UUID_RE.test(attemptId) || !action) {
      return json(400, { error: "The deletion recovery request is not valid." });
    }
    if (!confirmEmail) {
      return json(400, { error: "Confirmation email is required." });
    }
    if (adminUser.id === userId) {
      return json(400, { error: "You cannot delete your own admin user." });
    }

    const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authUserErr || !authUserData?.user) {
      return json(404, { error: "User not found." });
    }
    const targetEmail = authUserData.user.email ?? "";
    if (!targetEmail || confirmEmail !== targetEmail) {
      return json(400, { error: "Confirmation email does not match target user email." });
    }

    const functionName = action === "abandon"
      ? "abandon_vibode_account_deletion"
      : "resume_vibode_account_deletion";
    let data: unknown = null;
    let errorCode: string | null = null;
    try {
      const result = await supabaseAdmin.rpc(functionName, {
        p_user_id: userId,
        p_attempt_id: attemptId,
        p_admin_id: adminUser.id,
      });
      data = result.data;
      errorCode = typeof result.error?.code === "string" ? result.error.code : null;
      if (result.error) {
        console.error("[admin/account-deletion] recovery failed", { code: errorCode });
        return json(500, { error: "Account deletion could not be updated." });
      }
    } catch {
      console.error("[admin/account-deletion] recovery failed", { code: null });
      return json(500, { error: "Account deletion could not be updated." });
    }

    const decision = operatorDecision(data);
    if (decision.status === "ok") {
      return json(200, { ok: true, action });
    }
    if (decision.status === "mismatch") {
      return json(409, { error: "This deletion attempt is no longer current." });
    }
    if (decision.status === "busy") {
      return json(409, { error: "Account deletion is still running. Resume it only after that request has stopped." });
    }
    if (decision.status === "cleanup_started") {
      return json(409, { error: "Deletion already started removing data. Retry account deletion instead of abandoning it." });
    }
    if (decision.status === "missing") {
      return json(404, { error: "No account deletion is in progress." });
    }
    return json(500, { error: "Account deletion could not be updated." });
  };
}

export const POST = createAdminAccountDeletionPostHandler();
