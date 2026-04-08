export type MyFurnitureItem = {
  id: string;
  userSkuId: string;
  displayName: string;
  category: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  previewUrl: string | null;
  normalizedPreviewUrl: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
  status: string;
  supplier: string | null;
  priceLabel: string | null;
  resolved: {
    displayName: string;
    sourceUrl: string | null;
    supplier: string | null;
    priceLabel: string | null;
    category: string | null;
  };
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

function asOptionalNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function readOptionalString(row: UnknownRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const parsed = asOptionalString(row[key]);
    if (parsed) return parsed;
  }
  return null;
}

function readOptionalNumber(row: UnknownRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const parsed = asOptionalNumber(row[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function formatAmountLabel(currency: string | null, amount: number): string {
  const value = Number.isInteger(amount) ? amount.toString() : amount.toString();
  return currency ? `${currency} ${value}` : value;
}

export function resolveDisplayName(raw: unknown): string {
  const row = asRecord(raw);
  if (!row) return "Untitled item";

  const override = readOptionalString(row, "override_display_name", "overrideDisplayName");
  if (override) return override;

  const parsed = readOptionalString(row, "parsed_display_name", "parsedDisplayName");
  if (parsed) return parsed;

  const legacy = readOptionalString(row, "display_name", "displayName");
  if (legacy) return legacy;

  const resolved = asRecord(row.resolved);
  const fromResolved = resolved ? readOptionalString(resolved, "displayName") : null;
  return fromResolved ?? "Untitled item";
}

export function resolveSourceUrl(raw: unknown): string | null {
  const row = asRecord(raw);
  if (!row) return null;

  const override = readOptionalString(row, "override_source_url", "overrideSourceUrl");
  if (override) return override;

  const parsed = readOptionalString(row, "parsed_source_url", "parsedSourceUrl");
  if (parsed) return parsed;

  const legacy = readOptionalString(row, "source_url", "sourceUrl");
  if (legacy) return legacy;

  const resolved = asRecord(row.resolved);
  return resolved ? readOptionalString(resolved, "sourceUrl") : null;
}

export function resolveSupplier(raw: unknown): string | null {
  const row = asRecord(raw);
  if (!row) return null;

  const override = readOptionalString(row, "override_supplier_name", "overrideSupplierName");
  if (override) return override;

  const parsed = readOptionalString(row, "parsed_supplier_name", "parsedSupplierName");
  if (parsed) return parsed;

  const legacy = readOptionalString(row, "source_label", "sourceLabel");
  if (legacy) return legacy;

  const resolved = asRecord(row.resolved);
  return resolved ? readOptionalString(resolved, "supplier") : null;
}

export function resolveCategory(raw: unknown): string | null {
  const row = asRecord(raw);
  if (!row) return null;

  const override = readOptionalString(row, "override_category", "overrideCategory");
  if (override) return override;

  const parsed = readOptionalString(row, "parsed_category", "parsedCategory");
  if (parsed) return parsed;

  const legacy = readOptionalString(row, "category");
  if (legacy) return legacy;

  const resolved = asRecord(row.resolved);
  return resolved ? readOptionalString(resolved, "category") : null;
}

export function resolvePriceLabel(raw: unknown): string | null {
  const row = asRecord(raw);
  if (!row) return null;

  const overrideText = readOptionalString(row, "override_price_text", "overridePriceText");
  if (overrideText) return overrideText;

  const overrideAmount = readOptionalNumber(row, "override_price_amount", "overridePriceAmount");
  if (overrideAmount !== null) {
    const currency = readOptionalString(row, "override_price_currency", "overridePriceCurrency");
    return formatAmountLabel(currency, overrideAmount);
  }

  const parsedText = readOptionalString(row, "parsed_price_text", "parsedPriceText");
  if (parsedText) return parsedText;

  const parsedAmount = readOptionalNumber(row, "parsed_price_amount", "parsedPriceAmount");
  if (parsedAmount !== null) {
    const currency = readOptionalString(row, "parsed_price_currency", "parsedPriceCurrency");
    return formatAmountLabel(currency, parsedAmount);
  }

  const direct = readOptionalString(row, "priceLabel");
  if (direct) return direct;

  const resolved = asRecord(row.resolved);
  return resolved ? readOptionalString(resolved, "priceLabel") : null;
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

  const resolved = {
    displayName: resolveDisplayName(row),
    sourceUrl: resolveSourceUrl(row),
    supplier: resolveSupplier(row),
    priceLabel: resolvePriceLabel(row),
    category: resolveCategory(row),
  };

  return {
    id,
    userSkuId,
    displayName: resolved.displayName,
    category: resolved.category,
    sourceLabel: resolved.supplier ?? asOptionalString(row.source_label ?? row.sourceLabel),
    sourceUrl: resolved.sourceUrl,
    previewUrl: asOptionalString(row.preview_image_url ?? row.previewImageUrl),
    normalizedPreviewUrl: asOptionalString(
      row.normalized_preview_url ?? row.normalizedPreviewUrl
    ),
    timesUsed: Math.max(0, asNumber(row.times_used ?? row.timesUsed)),
    lastUsedAt: asOptionalString(row.last_used_at ?? row.lastUsedAt),
    createdAt,
    status: asOptionalString(row.status) ?? "ready",
    supplier: resolved.supplier,
    priceLabel: resolved.priceLabel,
    resolved,
  };
}

export function getMyFurniturePreferredImageUrl(item: MyFurnitureItem): string | null {
  return item.normalizedPreviewUrl || item.previewUrl || null;
}

export function getMyFurnitureDisplayTitle(item: MyFurnitureItem): string {
  return item.resolved.displayName;
}

export function getMyFurnitureSourceUrl(item: MyFurnitureItem): string | null {
  return item.resolved.sourceUrl;
}

export function getMyFurnitureSupplier(item: MyFurnitureItem): string | null {
  return item.resolved.supplier;
}

export function getMyFurniturePriceLabel(item: MyFurnitureItem): string | null {
  return item.resolved.priceLabel;
}

export function getMyFurnitureSubtitle(item: MyFurnitureItem): string {
  return item.resolved.category || item.resolved.supplier || "Saved item";
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
