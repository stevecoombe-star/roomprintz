import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceConfidence, PriceSourceType } from "@/lib/attribution/parsers";

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
  parsed_display_name: string | null;
  override_display_name: string | null;
  parsed_source_url: string | null;
  override_source_url: string | null;
  parsed_source_domain: string | null;
  parsed_supplier_name: string | null;
  override_supplier_name: string | null;
  parsed_price_text: string | null;
  parsed_price_amount: number | null;
  parsed_price_currency: string | null;
  override_price_text: string | null;
  override_price_amount: number | null;
  override_price_currency: string | null;
  parsed_dimensions_text: string | null;
  parsed_width_value: number | null;
  parsed_depth_value: number | null;
  parsed_height_value: number | null;
  parsed_dimension_unit: string | null;
  override_dimensions_text: string | null;
  override_width_value: number | null;
  override_depth_value: number | null;
  override_height_value: number | null;
  override_dimension_unit: string | null;
  parsed_category: string | null;
  override_category: string | null;
  price_source_type: PriceSourceType | null;
  price_confidence: PriceConfidence | null;
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

export type UpdateVibodeUserFurnitureOverridesArgs = {
  userId: string;
  id: string;
  overrideDisplayName?: string | null;
  overrideSupplierName?: string | null;
  overridePriceText?: string | null;
  overridePriceAmount?: number | null;
  overridePriceCurrency?: string | null;
  overrideSourceUrl?: string | null;
  overrideCategory?: string | null;
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

export async function updateVibodeUserFurnitureOverrides(
  supabase: AnySupabaseClient,
  args: UpdateVibodeUserFurnitureOverridesArgs
): Promise<VibodeUserFurnitureRow> {
  const payload: Record<string, string | number | null> = {
    override_display_name: normalizeOptionalString(args.overrideDisplayName) ?? null,
    override_supplier_name: normalizeOptionalString(args.overrideSupplierName) ?? null,
    override_price_text: normalizeOptionalString(args.overridePriceText) ?? null,
    override_price_amount: args.overridePriceAmount ?? null,
    override_price_currency: normalizeOptionalString(args.overridePriceCurrency) ?? null,
    override_source_url: normalizeOptionalString(args.overrideSourceUrl) ?? null,
    override_category: normalizeOptionalString(args.overrideCategory) ?? null,
  };

  const { data, error } = await supabase
    .from("vibode_user_furniture")
    .update(payload)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .eq("is_archived", false)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`[my-furniture] failed updating overrides: ${error.message}`);
  }
  if (!data) {
    throw new Error("Saved furniture item was not found.");
  }

  return data as VibodeUserFurnitureRow;
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
    parsedDisplayName?: string | null;
    parsedSourceUrl?: string | null;
    parsedSourceDomain?: string | null;
    parsedSupplierName?: string | null;
    parsedPriceText?: string | null;
    parsedPriceAmount?: number | null;
    parsedPriceCurrency?: string | null;
    parsedDimensionsText?: string | null;
    parsedWidthValue?: number | null;
    parsedDepthValue?: number | null;
    parsedHeightValue?: number | null;
    parsedDimensionUnit?: string | null;
    parsedCategory?: string | null;
    priceSourceType?: PriceSourceType | null;
    priceConfidence?: PriceConfidence | null;
  }
): Promise<VibodeUserFurnitureRow> {
  const payload: Record<string, string | number | boolean | null> = {
    user_id: args.userId,
    user_sku_id: args.userSkuId,
    display_name: normalizeOptionalString(args.displayName) ?? null,
    preview_image_url: normalizeOptionalString(args.previewImageUrl) ?? null,
    source_url: normalizeOptionalString(args.sourceUrl) ?? null,
    category: normalizeOptionalString(args.category) ?? null,
    is_archived: false,
  };

  if (args.parsedDisplayName !== undefined) {
    payload.parsed_display_name = normalizeOptionalString(args.parsedDisplayName) ?? null;
  }
  if (args.parsedSourceUrl !== undefined) {
    payload.parsed_source_url = normalizeOptionalString(args.parsedSourceUrl) ?? null;
  }
  if (args.parsedSourceDomain !== undefined) {
    payload.parsed_source_domain = normalizeOptionalString(args.parsedSourceDomain) ?? null;
  }
  if (args.parsedSupplierName !== undefined) {
    payload.parsed_supplier_name = normalizeOptionalString(args.parsedSupplierName) ?? null;
  }
  if (args.parsedPriceText !== undefined) {
    payload.parsed_price_text = normalizeOptionalString(args.parsedPriceText) ?? null;
  }
  if (args.parsedPriceAmount !== undefined) {
    payload.parsed_price_amount = args.parsedPriceAmount ?? null;
  }
  if (args.parsedPriceCurrency !== undefined) {
    payload.parsed_price_currency = normalizeOptionalString(args.parsedPriceCurrency) ?? null;
  }
  if (args.parsedDimensionsText !== undefined) {
    payload.parsed_dimensions_text = normalizeOptionalString(args.parsedDimensionsText) ?? null;
  }
  if (args.parsedWidthValue !== undefined) {
    payload.parsed_width_value = args.parsedWidthValue ?? null;
  }
  if (args.parsedDepthValue !== undefined) {
    payload.parsed_depth_value = args.parsedDepthValue ?? null;
  }
  if (args.parsedHeightValue !== undefined) {
    payload.parsed_height_value = args.parsedHeightValue ?? null;
  }
  if (args.parsedDimensionUnit !== undefined) {
    payload.parsed_dimension_unit = normalizeOptionalString(args.parsedDimensionUnit) ?? null;
  }
  if (args.parsedCategory !== undefined) {
    payload.parsed_category = normalizeOptionalString(args.parsedCategory) ?? null;
  }
  if (args.priceSourceType !== undefined) {
    payload.price_source_type = args.priceSourceType ?? null;
  }
  if (args.priceConfidence !== undefined) {
    payload.price_confidence = args.priceConfidence ?? null;
  }

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
