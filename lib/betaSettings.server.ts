import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_BETA_SETTINGS_ID = "global";
export const DEFAULT_BETA_ACCESS_CODE_PLACEHOLDER = "VIBODE-BETA";
export const DEFAULT_TOPUP_LIMIT_FALLBACK = 1;

type AnySupabaseClient = SupabaseClient<any, "public", any>;

export type GlobalBetaSettings = {
  id: string;
  betaAccessCode: string;
  defaultTopupLimit: number;
  updatedAt: string | null;
};

type BetaSettingsRow = {
  id: string;
  beta_access_code: string;
  default_topup_limit: number;
  updated_at: string | null;
};

type ReadSettingsOptions = {
  allowLocalEnvFallback?: boolean;
};

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  return n >= 0 ? n : fallback;
}

function normalizeSettingsRow(row: BetaSettingsRow): GlobalBetaSettings {
  return {
    id: row.id || DEFAULT_BETA_SETTINGS_ID,
    betaAccessCode: normalizeCode(row.beta_access_code),
    defaultTopupLimit: parseNonNegativeInt(row.default_topup_limit, DEFAULT_TOPUP_LIMIT_FALLBACK),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

function localFallbackSettings(): GlobalBetaSettings | null {
  if (process.env.NODE_ENV === "production") return null;

  const envCode = normalizeCode(process.env.VIBODE_BETA_SIGNUP_CODE);
  const code = envCode || DEFAULT_BETA_ACCESS_CODE_PLACEHOLDER;

  return {
    id: DEFAULT_BETA_SETTINGS_ID,
    betaAccessCode: code,
    defaultTopupLimit: DEFAULT_TOPUP_LIMIT_FALLBACK,
    updatedAt: null,
  };
}

export async function readGlobalBetaSettings(
  supabaseAdmin: AnySupabaseClient,
  options: ReadSettingsOptions = {}
): Promise<GlobalBetaSettings> {
  const { data, error } = await supabaseAdmin
    .from("beta_settings")
    .select("id,beta_access_code,default_topup_limit,updated_at")
    .eq("id", DEFAULT_BETA_SETTINGS_ID)
    .maybeSingle<BetaSettingsRow>();

  if (!error && data) {
    const normalized = normalizeSettingsRow(data);
    if (normalized.betaAccessCode.length > 0) return normalized;
  }

  if (options.allowLocalEnvFallback) {
    const fallback = localFallbackSettings();
    if (fallback) return fallback;
  }

  throw new Error("Global beta settings are missing or invalid.");
}
