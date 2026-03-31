import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient<any, "public", any>;

export type MyFurnitureRow = {
  id: string;
  user_id: string;
  user_sku_id: string;
  display_name: string | null;
  item_type: string | null;
  source_type: string;
  source_label: string | null;
  preview_image_url: string | null;
  normalized_preview_url: string | null;
  variant_image_urls: string[];
  status: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type VibodeEligibleSku = {
  skuId: string;
  label: string;
  source: "user";
  variants: Array<{ imageUrl: string }>;
};

export type PreparedUserSkuCandidate = {
  userSkuId: string;
  ownerUserId: string | null;
  status: string | null;
  reusable: boolean | null;
  label: string | null;
  itemType: string | null;
  sourceLabel: string | null;
  previewImageUrl: string | null;
  normalizedPreviewUrl: string | null;
  variantUrls: string[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isUuidLike(value: string | null): value is string {
  if (typeof value !== "string") return false;
  return UUID_RE.test(value);
}

function isImageUrlLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:image/")
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function collectVariantUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim().length > 0) {
      urls.push(item.trim());
      continue;
    }
    if (!isRecord(item)) continue;
    const imageUrl =
      safeString(item.imageUrl) ??
      safeString(item.url) ??
      safeString(item.src) ??
      safeString(item.pngUrl);
    if (imageUrl) {
      urls.push(imageUrl);
    }
  }
  return uniqueStrings(urls).filter(isImageUrlLike);
}

function collectStrictVariantImageUrls(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const urls: string[] = [];
  for (const item of raw) {
    const imageUrl = safeString(item);
    if (!imageUrl || !isImageUrlLike(imageUrl)) {
      return null;
    }
    urls.push(imageUrl);
  }
  const uniqueUrls = uniqueStrings(urls);
  return uniqueUrls.length > 0 ? uniqueUrls : null;
}

function normalizeStatus(raw: string | null): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

function isReadyStatus(raw: string | null): boolean {
  const normalized = normalizeStatus(raw);
  return normalized === "ready";
}

function isReusable(raw: boolean | null): boolean {
  return raw !== false;
}

function resolveSourceType(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "unknown";
  return normalized;
}

export function extractPreparedUserSkuCandidate(raw: unknown): PreparedUserSkuCandidate | null {
  if (!isRecord(raw)) return null;

  // Upstream ingest payloads may expose prepared user SKU identifiers as `skuId`.
  const userSkuId =
    safeString(raw.user_sku_id) ??
    safeString(raw.userSkuId) ??
    safeString(raw.id) ??
    safeString(raw.skuId);
  if (!userSkuId) return null;

  const normalizedPreviewUrl =
    safeString(raw.normalized_preview_url) ??
    safeString(raw.normalizedPreviewUrl) ??
    safeString(raw.normalizedImageUrl);
  const previewImageUrl =
    safeString(raw.preview_image_url) ??
    safeString(raw.previewImageUrl) ??
    safeString(raw.previewUrl);
  const variantUrls = uniqueStrings([
    ...collectVariantUrls(raw.variants),
    normalizedPreviewUrl,
    previewImageUrl,
  ]).filter(isImageUrlLike);

  return {
    userSkuId,
    ownerUserId:
      safeString(raw.user_id) ??
      safeString(raw.userId) ??
      safeString(raw.owner_user_id) ??
      safeString(raw.ownerUserId),
    status: safeString(raw.status),
    reusable: safeBool(raw.reusable) ?? safeBool(raw.isReusable) ?? safeBool(raw.reuseEligible),
    label:
      safeString(raw.display_name) ??
      safeString(raw.displayName) ??
      safeString(raw.label) ??
      safeString(raw.name),
    itemType: safeString(raw.item_type) ?? safeString(raw.itemType) ?? safeString(raw.type),
    sourceLabel:
      safeString(raw.source_label) ??
      safeString(raw.sourceLabel) ??
      safeString(raw.source_url) ??
      safeString(raw.sourceUrl),
    previewImageUrl,
    normalizedPreviewUrl,
    variantUrls,
  };
}

function resolveDisplayName(candidate: PreparedUserSkuCandidate): string {
  return candidate.label ?? candidate.userSkuId;
}

function resolvePreviewUrls(candidate: PreparedUserSkuCandidate): {
  previewImageUrl: string | null;
  normalizedPreviewUrl: string | null;
} {
  const normalized = candidate.normalizedPreviewUrl;
  const preview = candidate.previewImageUrl ?? candidate.variantUrls[0] ?? null;
  return {
    previewImageUrl: preview,
    normalizedPreviewUrl: normalized ?? preview,
  };
}

function assertReusableCandidate(userId: string, candidate: PreparedUserSkuCandidate) {
  if (!isUuidLike(userId)) {
    throw new Error("Unauthorized: invalid authenticated user id.");
  }
  if (candidate.ownerUserId && candidate.ownerUserId !== userId) {
    throw new Error("Prepared user SKU does not belong to authenticated user.");
  }
  if (!safeString(candidate.userSkuId)) {
    throw new Error("Prepared user SKU id is missing or invalid.");
  }
  if (!isReadyStatus(candidate.status)) {
    throw new Error("Prepared user SKU is not ready.");
  }
  if (!isReusable(candidate.reusable)) {
    throw new Error("Prepared user SKU is not reusable.");
  }
  if (candidate.variantUrls.length === 0) {
    throw new Error("Prepared user SKU has no valid variants.");
  }
}

export async function saveMyFurnitureFromPreparedUserSku(args: {
  supabase: AnySupabaseClient;
  userId: string;
  preparedUserSku: PreparedUserSkuCandidate;
  sourceType: string;
  sourceLabel?: string | null;
}): Promise<MyFurnitureRow> {
  assertReusableCandidate(args.userId, args.preparedUserSku);
  const preview = resolvePreviewUrls(args.preparedUserSku);
  const sourceLabel = args.sourceLabel ?? args.preparedUserSku.sourceLabel ?? null;

  const { data: existing, error: existingErr } = await args.supabase
    .from("vibode_user_furniture")
    .select("*")
    .eq("user_id", args.userId)
    .eq("user_sku_id", args.preparedUserSku.userSkuId)
    .eq("is_archived", false)
    .maybeSingle();
  if (existingErr) {
    throw new Error(`[my-furniture] failed reading existing row: ${existingErr.message}`);
  }

  const payload = {
    user_id: args.userId,
    user_sku_id: args.preparedUserSku.userSkuId,
    display_name: resolveDisplayName(args.preparedUserSku),
    item_type: args.preparedUserSku.itemType,
    source_type: resolveSourceType(args.sourceType),
    source_label: sourceLabel,
    preview_image_url: preview.previewImageUrl,
    normalized_preview_url: preview.normalizedPreviewUrl,
    variant_image_urls: args.preparedUserSku.variantUrls,
    status: "ready",
    is_archived: false,
  };

  if (existing?.id) {
    const { data: updated, error: updateErr } = await args.supabase
      .from("vibode_user_furniture")
      .update(payload)
      .eq("id", existing.id)
      .eq("user_id", args.userId)
      .select("*")
      .single();
    if (updateErr || !updated) {
      throw new Error(`[my-furniture] failed updating row: ${updateErr?.message ?? "unknown error"}`);
    }
    return updated as MyFurnitureRow;
  }

  const { data: inserted, error: insertErr } = await args.supabase
    .from("vibode_user_furniture")
    .insert(payload)
    .select("*")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`[my-furniture] failed inserting row: ${insertErr?.message ?? "unknown error"}`);
  }
  return inserted as MyFurnitureRow;
}

function toEligibleSku(row: MyFurnitureRow): VibodeEligibleSku {
  const variants = collectStrictVariantImageUrls(row.variant_image_urls);
  if (!variants) {
    throw new Error("Saved furniture item is missing reusable variants.");
  }

  return {
    skuId: row.user_sku_id,
    label: row.display_name ?? row.user_sku_id,
    source: "user",
    variants: variants.map((imageUrl) => ({ imageUrl })),
  };
}

export async function resolveMyFurnitureEligibleSku(args: {
  supabase: AnySupabaseClient;
  userId: string;
  furnitureId: string;
}): Promise<{ furniture: MyFurnitureRow; eligibleSku: VibodeEligibleSku }> {
  const { data: rowData, error: rowErr } = await args.supabase
    .from("vibode_user_furniture")
    .select("*")
    .eq("id", args.furnitureId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (rowErr) {
    throw new Error(`[my-furniture] failed loading saved item: ${rowErr.message}`);
  }
  if (!rowData) {
    throw new Error("Saved furniture item was not found.");
  }

  const row = rowData as MyFurnitureRow;
  if (row.is_archived) {
    throw new Error("Saved furniture item is archived.");
  }
  if (!isReadyStatus(row.status)) {
    throw new Error("Saved furniture item is not ready.");
  }

  return {
    furniture: row,
    eligibleSku: toEligibleSku(row),
  };
}

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
    .eq("status", "ready")
    .eq("is_archived", false);
  if (error) {
    throw new Error(`[my-furniture] failed updating last_used_at: ${error.message}`);
  }
}
