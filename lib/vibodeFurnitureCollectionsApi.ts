import type {
  VibodeFurnitureCollectionItemRow,
  VibodeFurnitureCollectionItemStatus,
  VibodeFurnitureCollectionRow,
  VibodeFurnitureCollectionStatus,
  VibodeFurnitureCollectionVisibility,
  VibodeFurniturePartnerRow,
  VibodeFurniturePartnerStatus,
} from "@/lib/vibodeFurnitureCollections";
import {
  VIBODE_FURNITURE_COLLECTION_ITEM_STATUSES,
  VIBODE_FURNITURE_COLLECTION_STATUSES,
  VIBODE_FURNITURE_COLLECTION_VISIBILITIES,
  VIBODE_FURNITURE_PARTNER_STATUSES,
} from "@/lib/vibodeFurnitureCollections";
import { normalizePartnerSlug } from "@/lib/commercial/partners";

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeFurnitureCollectionSlug(value: unknown): string | null {
  const normalized = normalizeText(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  const slug = normalized
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : null;
}

export function resolveFurnitureCollectionSlug(args: {
  slug?: unknown;
  name?: unknown;
}): string | null {
  return (
    normalizeFurnitureCollectionSlug(args.slug) ??
    normalizeFurnitureCollectionSlug(args.name) ??
    null
  );
}

export function resolveFurniturePartnerSlug(args: { slug?: unknown; name?: unknown }): string | null {
  return normalizePartnerSlug(args.slug as string | null | undefined) ?? normalizePartnerSlug(args.name as string | null | undefined);
}

export function parseMetadataObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function parseInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function parseNumeric(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function parseOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeText(value);
}

function parseEnumValue<T extends string>(
  value: unknown,
  validValues: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (validValues.includes(normalized as T)) return normalized as T;
  return undefined;
}

export function parsePartnerStatus(value: unknown): VibodeFurniturePartnerStatus | undefined {
  return parseEnumValue(value, VIBODE_FURNITURE_PARTNER_STATUSES);
}

export function parseCollectionStatus(value: unknown): VibodeFurnitureCollectionStatus | undefined {
  return parseEnumValue(value, VIBODE_FURNITURE_COLLECTION_STATUSES);
}

export function parseCollectionVisibility(
  value: unknown
): VibodeFurnitureCollectionVisibility | undefined {
  return parseEnumValue(value, VIBODE_FURNITURE_COLLECTION_VISIBILITIES);
}

export function parseCollectionItemStatus(
  value: unknown
): VibodeFurnitureCollectionItemStatus | undefined {
  return parseEnumValue(value, VIBODE_FURNITURE_COLLECTION_ITEM_STATUSES);
}

export function parseRequiredId(value: unknown): string | null {
  const text = normalizeText(value);
  return text && text.length >= 10 ? text : null;
}

export function buildPublicFurnitureCollectionPayload(args: {
  partner: VibodeFurniturePartnerRow;
  collection: VibodeFurnitureCollectionRow;
  items: VibodeFurnitureCollectionItemRow[];
}) {
  return {
    partner: {
      id: args.partner.id,
      name: args.partner.name,
      slug: args.partner.slug,
      logo_url: args.partner.logo_url,
      website_url: args.partner.website_url,
      description: args.partner.description,
      metadata: args.partner.metadata,
    },
    collection: {
      id: args.collection.id,
      partner_id: args.collection.partner_id,
      name: args.collection.name,
      slug: args.collection.slug,
      description: args.collection.description,
      hero_image_url: args.collection.hero_image_url,
      visibility: args.collection.visibility,
      metadata: args.collection.metadata,
    },
    items: args.items.map((item) => ({
      id: item.id,
      collection_id: item.collection_id,
      product_name: item.product_name,
      product_url: item.product_url,
      image_url: item.image_url,
      stored_asset_id: item.stored_asset_id,
      brand: item.brand,
      category: item.category,
      price_amount: item.price_amount,
      price_currency: item.price_currency,
      sort_order: item.sort_order,
      metadata: item.metadata,
    })),
  };
}
