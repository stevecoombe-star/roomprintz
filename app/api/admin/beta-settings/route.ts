import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  DEFAULT_BETA_SETTINGS_ID,
  readGlobalBetaSettings,
} from "@/lib/betaSettings.server";

type UpdateBetaSettingsPayload = {
  betaAccessCode?: unknown;
  defaultTopupLimit?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function parseTopupLimit(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.trunc(value);
    return parsed >= 0 ? parsed : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin settings." });
  }

  try {
    const settings = await readGlobalBetaSettings(supabaseAdmin, {
      allowLocalEnvFallback: true,
    });
    return json(200, {
      settings: {
        betaAccessCode: settings.betaAccessCode,
        defaultTopupLimit: settings.defaultTopupLimit,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to read beta settings.";
    return json(500, { error: message });
  }
}

export async function PATCH(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin settings." });
  }

  const payload = (await request.json().catch(() => ({}))) as UpdateBetaSettingsPayload;
  const betaAccessCode = normalizeCode(payload.betaAccessCode);
  const defaultTopupLimit = parseTopupLimit(payload.defaultTopupLimit);

  if (betaAccessCode.length < 4) {
    return json(400, { error: "Beta access code must be at least 4 characters." });
  }
  if (betaAccessCode.length > 128) {
    return json(400, { error: "Beta access code must be 128 characters or fewer." });
  }
  if (defaultTopupLimit === null) {
    return json(400, { error: "Default top-up limit must be an integer >= 0." });
  }

  const { error: upsertErr } = await supabaseAdmin.from("beta_settings").upsert({
    id: DEFAULT_BETA_SETTINGS_ID,
    beta_access_code: betaAccessCode,
    default_topup_limit: defaultTopupLimit,
    updated_at: new Date().toISOString(),
  });

  if (upsertErr) {
    return json(500, { error: "Failed to save beta settings." });
  }

  return json(200, {
    ok: true,
    settings: {
      betaAccessCode,
      defaultTopupLimit,
    },
  });
}
