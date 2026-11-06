import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

import { personalFurnitureAssetIds } from "./library";

/**
 * Save gate for personal asset ids. An empty result means the scene has no
 * personal furniture, so the table is not queried. Archived rows still count
 * as owned. A database error is unavailable, not a permission denial.
 */
export async function personalSceneAssetOwnership(
  supabase: SupabaseClient,
  userId: string,
  objects: readonly SceneObjectDefinition[],
): Promise<"empty" | "owned" | "foreign" | "unavailable"> {
  const ids = personalFurnitureAssetIds(objects);
  if (ids.length === 0) return "empty";
  const { data, error } = await supabase
    .from("vibode_furniture_assets")
    .select("asset_id")
    .eq("user_id", userId)
    .in("asset_id", ids);
  if (error || !Array.isArray(data)) return "unavailable";
  const owned = new Set(data
    .map((row) => (row && typeof row === "object" ? (row as { asset_id?: unknown }).asset_id : null))
    .filter((id): id is string => typeof id === "string"));
  return ids.every((id) => owned.has(id)) ? "owned" : "foreign";
}
