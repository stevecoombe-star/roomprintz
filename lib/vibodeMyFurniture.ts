import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient;

export type VibodeFurnitureEventType = "added" | "swapped";

export type VibodeUserFurnitureRow = {
  id: string;
  user_id: string;
  user_sku_id: string;
  display_name: string | null;
  preview_image_url: string | null;
  source_url: string | null;
  category: string | null;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
  variant_image_urls?: unknown;
};

export type VibodeEligibleSku = {
  skuId: string;
  label: string;
  source: "user";
  variants: Array<{ imageUrl: string }>;
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export async function upsertVibodeUserFurniture(
  supabase: AnySupabaseClient,
  args: {
    userId: string;
    userSkuId: string;
    displayName?: string | null;
    previewImageUrl?: string | null;
    sourceUrl?: string | null;
    category?: string | null;
  }
): Promise<VibodeUserFurnitureRow> {
  const payload = {
    user_id: args.userId,
    user_sku_id: args.userSkuId,
    display_name: normalizeOptionalString(args.displayName) ?? null,
    preview_image_url: normalizeOptionalString(args.previewImageUrl) ?? null,
    source_url: normalizeOptionalString(args.sourceUrl) ?? null,
    category: normalizeOptionalString(args.category) ?? null,
    is_archived: false,
  };

  const { data, error } = await supabase
    .from("vibode_user_furniture")
    .upsert(payload, { onConflict: "user_id,user_sku_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`[my-furniture] failed to upsert row: ${error?.message ?? "unknown error"}`);
  }
  return data as VibodeUserFurnitureRow;
}

export async function getVibodeUserFurnitureById(
  supabase: AnySupabaseClient,
  userId: string,
  id: string
): Promise<VibodeUserFurnitureRow | null> {
  const { data, error } = await supabase
    .from("vibode_user_furniture")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`[my-furniture] failed reading row: ${error.message}`);
  }
  return (data as VibodeUserFurnitureRow | null) ?? null;
}

export function buildEligibleSkuFromVibodeUserFurniture(
  row: Pick<
    VibodeUserFurnitureRow,
    "user_sku_id" | "display_name" | "preview_image_url" | "variant_image_urls"
  >
): VibodeEligibleSku {
  const variantUrls = asStringArray(row.variant_image_urls);
  const previewImageUrl = normalizeOptionalString(row.preview_image_url);
  const urls = variantUrls.length > 0 ? variantUrls : previewImageUrl ? [previewImageUrl] : [];
  if (urls.length === 0) {
    throw new Error("Saved furniture item is missing a valid preview image.");
  }

  return {
    skuId: row.user_sku_id,
    label: normalizeOptionalString(row.display_name) ?? row.user_sku_id,
    source: "user",
    variants: urls.map((imageUrl) => ({ imageUrl })),
  };
}

export async function trackVibodeFurnitureEvent(
  supabase: AnySupabaseClient,
  args: {
    userId: string;
    userFurnitureId: string;
    eventType: VibodeFurnitureEventType;
    roomId?: string | null;
  }
): Promise<{ times_used: number; last_used_at: string | null }> {
  const item = await getVibodeUserFurnitureById(supabase, args.userId, args.userFurnitureId);
  if (!item || item.is_archived) {
    throw new Error("Saved furniture item was not found.");
  }

  const { error: eventErr } = await supabase.from("vibode_furniture_events").insert({
    user_id: args.userId,
    user_furniture_id: args.userFurnitureId,
    event_type: args.eventType,
    room_id: normalizeOptionalString(args.roomId) ?? null,
  });
  if (eventErr) {
    throw new Error(`[my-furniture] failed inserting event: ${eventErr.message}`);
  }

  const nextTimesUsed = Math.max(0, Number(item.times_used ?? 0)) + 1;
  const nextLastUsedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("vibode_user_furniture")
    .update({
      times_used: nextTimesUsed,
      last_used_at: nextLastUsedAt,
    })
    .eq("id", args.userFurnitureId)
    .eq("user_id", args.userId)
    .select("times_used,last_used_at")
    .single();
  if (updateErr || !updated) {
    throw new Error(`[my-furniture] failed updating counters: ${updateErr?.message ?? "unknown error"}`);
  }

  return {
    times_used: Number(updated.times_used ?? nextTimesUsed),
    last_used_at:
      typeof updated.last_used_at === "string" ? updated.last_used_at : (nextLastUsedAt as string | null),
  };
}

// Backward-compat helper for legacy route.
export async function markMyFurnitureUsed(args: {
  supabase: AnySupabaseClient;
  userId: string;
  furnitureId: string;
}): Promise<void> {
  const { error } = await args.supabase
    .from("vibode_user_furniture")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", args.furnitureId)
    .eq("user_id", args.userId)
    .eq("is_archived", false);

  if (error) {
    throw new Error(`[my-furniture] failed updating last_used_at: ${error.message}`);
  }
}
