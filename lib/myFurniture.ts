export type MyFurnitureItem = {
  id: string;
  userSkuId: string;
  displayName: string | null;
  category: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  previewUrl: string | null;
  normalizedPreviewUrl: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
  status: string;
};

export type MyFurnitureViewMode = "grid" | "list";
export type MyFurnitureSortMode = "recent" | "used" | "oldest";

type UnknownRecord = Record<string, unknown>;

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeMyFurnitureItem(raw: unknown): MyFurnitureItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as UnknownRecord;

  const id = asOptionalString(row.id);
  const userSkuId = asOptionalString(row.user_sku_id ?? row.userSkuId);
  const createdAt = asOptionalString(row.created_at ?? row.createdAt);
  if (!id || !userSkuId || !createdAt) return null;

  return {
    id,
    userSkuId,
    displayName: asOptionalString(row.display_name ?? row.displayName),
    category: asOptionalString(row.category),
    sourceLabel: asOptionalString(row.source_label ?? row.sourceLabel),
    sourceUrl: asOptionalString(row.source_url ?? row.sourceUrl),
    previewUrl: asOptionalString(row.preview_image_url ?? row.previewImageUrl),
    normalizedPreviewUrl: asOptionalString(
      row.normalized_preview_url ?? row.normalizedPreviewUrl
    ),
    timesUsed: Math.max(0, asNumber(row.times_used ?? row.timesUsed)),
    lastUsedAt: asOptionalString(row.last_used_at ?? row.lastUsedAt),
    createdAt,
    status: asOptionalString(row.status) ?? "ready",
  };
}

export function getMyFurniturePreferredImageUrl(item: MyFurnitureItem): string | null {
  return item.normalizedPreviewUrl || item.previewUrl || null;
}

export function getMyFurnitureDisplayTitle(item: MyFurnitureItem): string {
  return item.displayName?.trim() || "Untitled item";
}

export function getMyFurnitureUsageSignal(item: MyFurnitureItem): string {
  if (item.timesUsed > 0) {
    return `Used ${item.timesUsed} ${item.timesUsed === 1 ? "time" : "times"}`;
  }
  return "New";
}

export function sortMyFurnitureItems(
  items: MyFurnitureItem[],
  sort: MyFurnitureSortMode
): MyFurnitureItem[] {
  const next = [...items];

  next.sort((a, b) => {
    const aCreated = parseTimestamp(a.createdAt) ?? 0;
    const bCreated = parseTimestamp(b.createdAt) ?? 0;
    const aLastUsed = parseTimestamp(a.lastUsedAt);
    const bLastUsed = parseTimestamp(b.lastUsedAt);

    if (sort === "oldest") {
      if (aCreated !== bCreated) return aCreated - bCreated;
      return b.id.localeCompare(a.id);
    }

    if (sort === "used") {
      if (a.timesUsed !== b.timesUsed) return b.timesUsed - a.timesUsed;
      const aFallback = aLastUsed ?? aCreated;
      const bFallback = bLastUsed ?? bCreated;
      if (aFallback !== bFallback) return bFallback - aFallback;
      return b.id.localeCompare(a.id);
    }

    const aRecent = aLastUsed ?? aCreated;
    const bRecent = bLastUsed ?? bCreated;
    if (aRecent !== bRecent) return bRecent - aRecent;
    return b.id.localeCompare(a.id);
  });

  return next;
}
