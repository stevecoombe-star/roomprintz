import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  AFC_IMAGE_MODEL_DEFAULT,
  defaultAfcImageModelSettings,
  isAfcImageModelChoice,
  type AfcImageModelChoice,
  type AfcImageModelSettings,
} from "@/lib/afc-image-models";

export const AFC_IMAGE_MODEL_SETTINGS_ID = "global";
export const AFC_IMAGE_MODEL_SETTINGS_TABLE = "afc_image_model_settings";
export const AFC_IMAGE_MODEL_SETTINGS_MIGRATION =
  "20260930200000_afc_image_model_settings.sql";

type SettingsRow = {
  id?: string;
  empty_model?: unknown;
  tiled_model?: unknown;
  updated_at?: unknown;
};

export type AfcImageModelSettingsRead =
  | Readonly<{ ok: true; settings: AfcImageModelSettings }>
  | Readonly<{ ok: false; error: string }>;

function serviceClientFromEnv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function choiceOrDefault(value: unknown): AfcImageModelChoice {
  return isAfcImageModelChoice(value) ? value : AFC_IMAGE_MODEL_DEFAULT;
}

function settingsFromRow(row: SettingsRow | null): AfcImageModelSettings {
  if (!row) return defaultAfcImageModelSettings();
  return Object.freeze({
    empty: choiceOrDefault(row.empty_model),
    tiled: choiceOrDefault(row.tiled_model),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  });
}

/**
 * Generation read. Missing table, missing row, invalid values, and transport
 * errors all resolve to Nano Banana Pro. Never throws.
 */
export async function readAfcImageModelSettings(
  client: SupabaseClient | null = serviceClientFromEnv(),
): Promise<AfcImageModelSettings> {
  if (!client) return defaultAfcImageModelSettings();
  try {
    const { data, error } = await client
      .from(AFC_IMAGE_MODEL_SETTINGS_TABLE)
      .select("id,empty_model,tiled_model,updated_at")
      .eq("id", AFC_IMAGE_MODEL_SETTINGS_ID)
      .maybeSingle<SettingsRow>();
    if (error || !data) return defaultAfcImageModelSettings();
    return settingsFromRow(data);
  } catch {
    return defaultAfcImageModelSettings();
  }
}

export async function readAfcImageModelSettingsStrict(
  client: SupabaseClient | null = serviceClientFromEnv(),
): Promise<AfcImageModelSettingsRead> {
  if (!client) {
    return Object.freeze({
      ok: false,
      error: "Server configuration missing for admin settings.",
    });
  }
  try {
    const { data, error } = await client
      .from(AFC_IMAGE_MODEL_SETTINGS_TABLE)
      .select("id,empty_model,tiled_model,updated_at")
      .eq("id", AFC_IMAGE_MODEL_SETTINGS_ID)
      .maybeSingle<SettingsRow>();
    if (error) {
      return Object.freeze({
        ok: false,
        error: `Failed to read AFC image model settings. Apply migration ${AFC_IMAGE_MODEL_SETTINGS_MIGRATION} if it has not been applied.`,
      });
    }
    return Object.freeze({ ok: true, settings: settingsFromRow(data) });
  } catch {
    return Object.freeze({
      ok: false,
      error: `Failed to read AFC image model settings. Apply migration ${AFC_IMAGE_MODEL_SETTINGS_MIGRATION} if it has not been applied.`,
    });
  }
}

export async function writeAfcImageModelSettings(
  settings: Readonly<{ empty: AfcImageModelChoice; tiled: AfcImageModelChoice }>,
  client: SupabaseClient | null = serviceClientFromEnv(),
): Promise<AfcImageModelSettingsRead> {
  if (!isAfcImageModelChoice(settings.empty) || !isAfcImageModelChoice(settings.tiled)) {
    return Object.freeze({ ok: false, error: "Unknown AFC image model." });
  }
  if (!client) {
    return Object.freeze({
      ok: false,
      error: "Server configuration missing for admin settings.",
    });
  }
  const updatedAt = new Date().toISOString();
  try {
    const { error } = await client.from(AFC_IMAGE_MODEL_SETTINGS_TABLE).upsert({
      id: AFC_IMAGE_MODEL_SETTINGS_ID,
      empty_model: settings.empty,
      tiled_model: settings.tiled,
      updated_at: updatedAt,
    });
    if (error) {
      return Object.freeze({
        ok: false,
        error: `Failed to save AFC image model settings. Apply migration ${AFC_IMAGE_MODEL_SETTINGS_MIGRATION} if it has not been applied.`,
      });
    }
    return Object.freeze({
      ok: true,
      settings: Object.freeze({
        empty: settings.empty,
        tiled: settings.tiled,
        updatedAt,
      }),
    });
  } catch {
    return Object.freeze({
      ok: false,
      error: `Failed to save AFC image model settings. Apply migration ${AFC_IMAGE_MODEL_SETTINGS_MIGRATION} if it has not been applied.`,
    });
  }
}
