/**
 * PI-5G3 first-touch live bases for Partner draft fields.
 *
 * touched_base is not commercial authority. It records the durable live
 * value at first touch so publish can detect stale conflicts that
 * replanning alone cannot see. Subsequent edits preserve the original
 * base. Normalization back to live removes the field.
 */

import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import { isPlainObject } from "./product-variant-register";
import type { StageCatalogSnapshot, StageCollection, StageProduct, StageVariant } from "./types";

export type PartnerDraftTouchedProductBase = Readonly<{
  name?: string;
  image_url?: string | null;
  product_url?: string | null;
  price_amount?: number | null;
}>;

export type PartnerDraftTouchedVariantBase = Readonly<{
  finish_label?: string | null;
  sku?: string | null;
  price_amount?: number | null;
  product_url?: string | null;
}>;

export type PartnerDraftTouchedCollectionBase = Readonly<{
  name?: string;
  membership_product_ids?: readonly string[];
}>;

export type PartnerDraftTouchedBase = Readonly<{
  products: Readonly<Record<string, PartnerDraftTouchedProductBase>>;
  variants: Readonly<Record<string, PartnerDraftTouchedVariantBase>>;
  collections: Readonly<Record<string, PartnerDraftTouchedCollectionBase>>;
}>;

export const PARTNER_DRAFT_PRODUCT_TOUCH_FIELDS = Object.freeze([
  "name",
  "image_url",
  "product_url",
  "price_amount",
] as const);

export const PARTNER_DRAFT_VARIANT_TOUCH_FIELDS = Object.freeze([
  "finish_label",
  "sku",
  "price_amount",
  "product_url",
] as const);

type ProductTouchField = (typeof PARTNER_DRAFT_PRODUCT_TOUCH_FIELDS)[number];
type VariantTouchField = (typeof PARTNER_DRAFT_VARIANT_TOUCH_FIELDS)[number];

function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function findProduct(catalog: StageCatalogSnapshot, productId: string): StageProduct | null {
  return catalog.products.find((item) => item.productId === productId) ?? null;
}

function findVariant(catalog: StageCatalogSnapshot, variantId: string): StageVariant | null {
  return catalog.variants.find((item) => item.variantId === variantId) ?? null;
}

function findCollection(catalog: StageCatalogSnapshot, collectionId: string): StageCollection | null {
  return catalog.collections.find((item) => item.collectionId === collectionId) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  return value;
}

function asNullableNumber(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) return null;
    ids.push(item);
  }
  return ids;
}

export function emptyPartnerDraftTouchedBase(): PartnerDraftTouchedBase {
  return { products: {}, variants: {}, collections: {} };
}

export function persistablePartnerDraftTouchedBase(base: PartnerDraftTouchedBase): Record<string, unknown> {
  const products: Record<string, PartnerDraftTouchedProductBase> = {};
  for (const [id, entry] of Object.entries(base.products)) {
    if (Object.keys(entry).length > 0) products[id] = entry;
  }
  const variants: Record<string, PartnerDraftTouchedVariantBase> = {};
  for (const [id, entry] of Object.entries(base.variants)) {
    if (Object.keys(entry).length > 0) variants[id] = entry;
  }
  const collections: Record<string, PartnerDraftTouchedCollectionBase> = {};
  for (const [id, entry] of Object.entries(base.collections)) {
    if (Object.keys(entry).length > 0) collections[id] = entry;
  }
  const out: Record<string, unknown> = {};
  if (Object.keys(products).length > 0) out.products = products;
  if (Object.keys(variants).length > 0) out.variants = variants;
  if (Object.keys(collections).length > 0) out.collections = collections;
  return out;
}

function parseProductEntry(value: unknown): PartnerDraftTouchedProductBase | null {
  const record = asRecord(value);
  if (!record) return null;
  const next: {
    name?: string;
    image_url?: string | null;
    product_url?: string | null;
    price_amount?: number | null;
  } = {};
  if ("name" in record) {
    const name = asNullableString(record.name);
    if (typeof name === "string") next.name = name;
  }
  if ("image_url" in record) {
    const imageUrl = asNullableString(record.image_url);
    if (imageUrl !== undefined) next.image_url = imageUrl;
  }
  if ("product_url" in record) {
    const productUrl = asNullableString(record.product_url);
    if (productUrl !== undefined) next.product_url = productUrl;
  }
  if ("price_amount" in record) {
    const price = asNullableNumber(record.price_amount);
    if (price !== undefined) next.price_amount = price;
  }
  return next;
}

function parseVariantEntry(value: unknown): PartnerDraftTouchedVariantBase | null {
  const record = asRecord(value);
  if (!record) return null;
  const next: {
    finish_label?: string | null;
    sku?: string | null;
    price_amount?: number | null;
    product_url?: string | null;
  } = {};
  if ("finish_label" in record) {
    const finish = asNullableString(record.finish_label);
    if (finish !== undefined) next.finish_label = finish;
  }
  if ("sku" in record) {
    const sku = asNullableString(record.sku);
    if (sku !== undefined) next.sku = sku;
  }
  if ("price_amount" in record) {
    const price = asNullableNumber(record.price_amount);
    if (price !== undefined) next.price_amount = price;
  }
  if ("product_url" in record) {
    const productUrl = asNullableString(record.product_url);
    if (productUrl !== undefined) next.product_url = productUrl;
  }
  return next;
}

function parseCollectionEntry(value: unknown): PartnerDraftTouchedCollectionBase | null {
  const record = asRecord(value);
  if (!record) return null;
  const next: {
    name?: string;
    membership_product_ids?: readonly string[];
  } = {};
  if ("name" in record) {
    const name = asNullableString(record.name);
    if (typeof name === "string") next.name = name;
  }
  if ("membership_product_ids" in record) {
    const ids = asStringArray(record.membership_product_ids);
    if (ids) next.membership_product_ids = sortIds(ids);
  }
  return next;
}

export function parsePartnerDraftTouchedBase(value: unknown): PartnerDraftTouchedBase {
  const empty = emptyPartnerDraftTouchedBase();
  const record = asRecord(value);
  if (!record) return empty;
  const products: Record<string, PartnerDraftTouchedProductBase> = {};
  const productMap = asRecord(record.products);
  if (productMap) {
    for (const [id, entry] of Object.entries(productMap)) {
      const parsed = parseProductEntry(entry);
      if (parsed && Object.keys(parsed).length > 0) products[id] = parsed;
    }
  }
  const variants: Record<string, PartnerDraftTouchedVariantBase> = {};
  const variantMap = asRecord(record.variants);
  if (variantMap) {
    for (const [id, entry] of Object.entries(variantMap)) {
      const parsed = parseVariantEntry(entry);
      if (parsed && Object.keys(parsed).length > 0) variants[id] = parsed;
    }
  }
  const collections: Record<string, PartnerDraftTouchedCollectionBase> = {};
  const collectionMap = asRecord(record.collections);
  if (collectionMap) {
    for (const [id, entry] of Object.entries(collectionMap)) {
      const parsed = parseCollectionEntry(entry);
      if (parsed && Object.keys(parsed).length > 0) collections[id] = parsed;
    }
  }
  return { products, variants, collections };
}

function liveProductField(product: StageProduct, field: ProductTouchField): string | number | null {
  if (field === "name") return product.name;
  if (field === "image_url") return product.imageUrl;
  if (field === "product_url") return product.productUrl;
  return product.priceAmount;
}

function liveVariantField(variant: StageVariant, field: VariantTouchField): string | number | null {
  if (field === "finish_label") return variant.finishLabel;
  if (field === "sku") return variant.sku;
  if (field === "price_amount") return variant.priceAmount;
  return variant.productUrl;
}

function pendingProductFields(
  document: PartnerCatalogSyncDocument,
): Map<string, ProductTouchField[]> {
  const pending = new Map<string, ProductTouchField[]>();
  for (const patch of document.products.update) {
    const fields: ProductTouchField[] = [];
    if (patch.name !== undefined) fields.push("name");
    if (patch.imageUrl !== undefined) fields.push("image_url");
    if (patch.productUrl !== undefined) fields.push("product_url");
    if (patch.priceAmount !== undefined) fields.push("price_amount");
    if (fields.length > 0) pending.set(patch.productId, fields);
  }
  return pending;
}

function pendingVariantFields(
  document: PartnerCatalogSyncDocument,
): Map<string, VariantTouchField[]> {
  const pending = new Map<string, VariantTouchField[]>();
  for (const patch of document.variants.update) {
    const fields: VariantTouchField[] = [];
    if (patch.finishLabel !== undefined) fields.push("finish_label");
    if (patch.sku !== undefined) fields.push("sku");
    if (patch.priceAmount !== undefined) fields.push("price_amount");
    if (patch.productUrl !== undefined) fields.push("product_url");
    if (fields.length > 0) pending.set(patch.variantId, fields);
  }
  return pending;
}

function pendingCollectionNames(document: PartnerCatalogSyncDocument): Set<string> {
  const ids = new Set<string>();
  for (const patch of document.collections.update) {
    if (patch.name !== undefined) ids.add(patch.collectionId);
  }
  return ids;
}

function pendingCollectionMembership(document: PartnerCatalogSyncDocument): Set<string> {
  const pendingCreateIds = new Set((document.collections.create ?? []).map((item) => item.collectionId));
  const ids = new Set<string>();
  for (const item of document.collections.membershipAdd) {
    if (!pendingCreateIds.has(item.collectionId)) ids.add(item.collectionId);
  }
  for (const item of document.collections.membershipRemove) {
    if (!pendingCreateIds.has(item.collectionId)) ids.add(item.collectionId);
  }
  return ids;
}

export function nextPartnerDraftTouchedBase(input: Readonly<{
  previous: PartnerDraftTouchedBase;
  nextDocument: PartnerCatalogSyncDocument;
  catalog: StageCatalogSnapshot;
}>): PartnerDraftTouchedBase {
  const products: Record<string, PartnerDraftTouchedProductBase> = {};
  for (const [productId, fields] of pendingProductFields(input.nextDocument)) {
    const live = findProduct(input.catalog, productId);
    const previous = input.previous.products[productId] ?? {};
    const entry: {
      name?: string;
      image_url?: string | null;
      product_url?: string | null;
      price_amount?: number | null;
    } = {};
    for (const field of fields) {
      if (field in previous) {
        const current = previous[field];
        if (current !== undefined) {
          (entry as Record<string, string | number | null>)[field] = current as string | number | null;
        }
      } else if (live) {
        (entry as Record<string, string | number | null>)[field] = liveProductField(live, field);
      }
    }
    if (Object.keys(entry).length > 0) products[productId] = entry;
  }

  const variants: Record<string, PartnerDraftTouchedVariantBase> = {};
  for (const [variantId, fields] of pendingVariantFields(input.nextDocument)) {
    const live = findVariant(input.catalog, variantId);
    const previous = input.previous.variants[variantId] ?? {};
    const entry: {
      finish_label?: string | null;
      sku?: string | null;
      price_amount?: number | null;
      product_url?: string | null;
    } = {};
    for (const field of fields) {
      if (field in previous) {
        const current = previous[field];
        if (current !== undefined) {
          (entry as Record<string, string | number | null>)[field] = current as string | number | null;
        }
      } else if (live) {
        (entry as Record<string, string | number | null>)[field] = liveVariantField(live, field);
      }
    }
    if (Object.keys(entry).length > 0) variants[variantId] = entry;
  }

  const collections: Record<string, PartnerDraftTouchedCollectionBase> = {};
  const named = pendingCollectionNames(input.nextDocument);
  const membership = pendingCollectionMembership(input.nextDocument);
  const pendingCreateIds = new Set((input.nextDocument.collections.create ?? []).map((item) => item.collectionId));
  const collectionIds = new Set([...named, ...membership]);
  for (const collectionId of collectionIds) {
    if (pendingCreateIds.has(collectionId)) continue;
    const live = findCollection(input.catalog, collectionId);
    const previous = input.previous.collections[collectionId] ?? {};
    const entry: {
      name?: string;
      membership_product_ids?: readonly string[];
    } = {};
    if (named.has(collectionId)) {
      if (previous.name !== undefined) entry.name = previous.name;
      else if (live) entry.name = live.name;
    }
    if (membership.has(collectionId)) {
      if (previous.membership_product_ids !== undefined) {
        entry.membership_product_ids = [...previous.membership_product_ids];
      } else if (live) {
        entry.membership_product_ids = sortIds(live.productIds);
      }
    }
    if (Object.keys(entry).length > 0) collections[collectionId] = entry;
  }

  return { products, variants, collections };
}

export function partnerDraftTouchedBaseIsEmpty(base: PartnerDraftTouchedBase): boolean {
  return (
    Object.keys(base.products).length === 0
    && Object.keys(base.variants).length === 0
    && Object.keys(base.collections).length === 0
  );
}

export function sortedMembershipProductIds(ids: readonly string[]): string[] {
  return sortIds(ids);
}
