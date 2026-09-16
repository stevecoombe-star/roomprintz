/**
 * PI-5C durable STAGE catalog row mapping.
 *
 * Converts vibode_stage_* records into the certified STAGE snapshot shape.
 * This module is client-safe: no Supabase, no 2D furniture systems, no AFC.
 */

import {
  createStageCatalogSnapshot,
  seedFixtureStageCatalog,
} from "./catalog";
import type {
  StageAsset,
  StageAssetStatus,
  StageCatalogAuthority,
  StageCatalogSnapshot,
  StageCollection,
  StageCommercialStatus,
  StagePartner,
  StagePartnerStatus,
  StageProduct,
  StageProductSource,
  StageVariant,
} from "./types";

export const STAGE_CATALOG_TABLES = Object.freeze({
  assets: "vibode_stage_assets",
  products: "vibode_stage_products",
  variants: "vibode_stage_variants",
  collections: "vibode_stage_collections",
  productCollections: "vibode_stage_product_collections",
  partners: "vibode_stage_partners",
});

export const FORBIDDEN_STAGE_CATALOG_TABLES = Object.freeze([
  "vibode_user_furniture",
  "vibode_furniture_collection_items",
  "vibode_furniture_collections",
  "vibode_furniture_partners",
  "vibode_partners",
  "vibode_room_furniture_placements",
  "vibode_room_assets",
]);

export type StageCatalogFallbackReason =
  | "missing_service_role"
  | "durable_load_failed"
  | "durable_empty"
  | "durable_malformed";

export type StageCatalogRows = Readonly<{
  products: readonly Record<string, unknown>[];
  variants: readonly Record<string, unknown>[];
  assets: readonly Record<string, unknown>[];
  collections: readonly Record<string, unknown>[];
  memberships: readonly Record<string, unknown>[];
  partners?: readonly Record<string, unknown>[];
}>;

export type StageCatalogLoadResult = Readonly<{
  catalog: StageCatalogSnapshot;
  authority: StageCatalogAuthority;
  fallbackReason: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInteger(value: unknown, fallback = 0): number {
  const parsed = asNumber(value);
  if (parsed == null) return fallback;
  return Math.trunc(parsed);
}

function asSource(value: unknown): StageProductSource | null {
  if (
    value === "vibode_curated" ||
    value === "partner_catalog" ||
    value === "user_pasted"
  ) {
    return value;
  }
  return null;
}

function asAssetStatus(value: unknown): StageAssetStatus | null {
  if (value === "ready" || value === "unavailable") return value;
  return null;
}

function asOwner(value: unknown): "vibode" | "partner" | null {
  if (value === "vibode" || value === "partner") return value;
  return null;
}

function asPartnerStatus(value: unknown): StagePartnerStatus | null {
  if (value === "active" || value === "inactive") return value;
  return null;
}

function asCommercialStatus(value: unknown): StageCommercialStatus | null {
  if (value == null) return "active";
  if (typeof value === "string" && value.trim() === "") return "active";
  if (value === "active" || value === "inactive") return value;
  return null;
}

function mapPartner(row: Record<string, unknown>): StagePartner | null {
  const partnerId = asTrimmedString(row.partner_id);
  const name = asTrimmedString(row.name);
  const slug = asTrimmedString(row.slug);
  const status = asPartnerStatus(row.status);
  if (!partnerId || !name || !slug || !status) return null;
  return {
    partnerId,
    name,
    slug,
    status,
    websiteUrl: asNullableString(row.website_url),
    logoUrl: asNullableString(row.logo_url),
  };
}

function mapAsset(row: Record<string, unknown>): StageAsset | null {
  const assetId = asTrimmedString(row.asset_id);
  const glbUrl = asTrimmedString(row.glb_url);
  const authoredWidthM = asNumber(row.authored_width_m);
  const authoredHeightM = asNumber(row.authored_height_m);
  const authoredDepthM = asNumber(row.authored_depth_m);
  const status = asAssetStatus(row.status);
  if (
    !assetId ||
    !glbUrl ||
    authoredWidthM == null ||
    authoredHeightM == null ||
    authoredDepthM == null ||
    !status
  ) {
    return null;
  }
  return {
    assetId,
    glbUrl,
    authoredWidthM,
    authoredHeightM,
    authoredDepthM,
    status,
  };
}

function mapVariant(row: Record<string, unknown>): StageVariant | null {
  const variantId = asTrimmedString(row.variant_id);
  const productId = asTrimmedString(row.product_id);
  const status = asCommercialStatus(row.status);
  if (!variantId || !productId || !status) return null;
  return {
    variantId,
    productId,
    assetId: asNullableString(row.current_asset_id),
    finishLabel: asNullableString(row.finish_label),
    sku: asNullableString(row.sku),
    priceAmount: asNumber(row.price_amount),
    priceCurrency: asNullableString(row.price_currency) ?? "USD",
    productUrl: asNullableString(row.product_url),
    status,
  };
}

function mapProduct(
  row: Record<string, unknown>,
  collectionIds: readonly string[],
): StageProduct | null {
  const productId = asTrimmedString(row.product_id);
  const name = asTrimmedString(row.name);
  const brand = asTrimmedString(row.brand);
  const retailer = asTrimmedString(row.retailer);
  const imageUrl = asTrimmedString(row.image_url);
  const categoryId = asTrimmedString(row.category_id);
  const defaultVariantId = asTrimmedString(row.default_variant_id);
  const source = asSource(row.source);
  const status = asCommercialStatus(row.status);
  const partnerId = asNullableString(row.partner_id);
  if (
    !productId ||
    !name ||
    !brand ||
    !retailer ||
    !imageUrl ||
    !categoryId ||
    !defaultVariantId ||
    !source ||
    !status
  ) {
    return null;
  }
  if (source === "partner_catalog" && !partnerId) return null;
  if (source !== "partner_catalog" && partnerId) return null;
  return {
    productId,
    brand,
    name,
    retailer,
    categoryId,
    subcategoryId: asNullableString(row.subcategory_id),
    productUrl: asNullableString(row.product_url),
    imageUrl,
    priceAmount: asNumber(row.price_amount),
    priceCurrency: asNullableString(row.price_currency) ?? "USD",
    defaultVariantId,
    collectionIds: Object.freeze([...collectionIds]),
    source,
    partnerId,
    status,
  };
}

function mapCollection(
  row: Record<string, unknown>,
  productIds: readonly string[],
): StageCollection | null {
  const collectionId = asTrimmedString(row.collection_id);
  const name = asTrimmedString(row.name);
  const owner = asOwner(row.owner);
  const status = asTrimmedString(row.status);
  const partnerId = asNullableString(row.partner_id);
  if (!collectionId || !name || !owner || status !== "active") return null;
  if (owner === "partner" && !partnerId) return null;
  if (owner === "vibode" && partnerId) return null;
  return {
    collectionId,
    name,
    owner,
    partnerName: asNullableString(row.partner_name),
    partnerId,
    productIds: Object.freeze([...productIds]),
  };
}

function sortByOrderThenId<T>(
  items: readonly T[],
  orderOf: (item: T) => number,
  idOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const order = orderOf(a) - orderOf(b);
    if (order !== 0) return order;
    return idOf(a).localeCompare(idOf(b));
  });
}

export function assembleStageCatalogFromRows(
  rows: StageCatalogRows,
): StageCatalogSnapshot | null {
  const assets: StageAsset[] = [];
  for (const row of rows.assets) {
    if (!isRecord(row)) return null;
    const asset = mapAsset(row);
    if (!asset) return null;
    assets.push(asset);
  }

  const partners: StagePartner[] = [];
  for (const row of rows.partners ?? []) {
    if (!isRecord(row)) return null;
    const partner = mapPartner(row);
    if (!partner) return null;
    partners.push(partner);
  }

  const membershipByProduct = new Map<string, { collectionId: string; sortOrder: number }[]>();
  const membershipByCollection = new Map<string, { productId: string; sortOrder: number }[]>();
  for (const row of rows.memberships) {
    if (!isRecord(row)) return null;
    const productId = asTrimmedString(row.product_id);
    const collectionId = asTrimmedString(row.collection_id);
    if (!productId || !collectionId) return null;
    const sortOrder = asInteger(row.sort_order);
    const productMemberships = membershipByProduct.get(productId) ?? [];
    productMemberships.push({ collectionId, sortOrder });
    membershipByProduct.set(productId, productMemberships);
    const collectionMemberships = membershipByCollection.get(collectionId) ?? [];
    collectionMemberships.push({ productId, sortOrder });
    membershipByCollection.set(collectionId, collectionMemberships);
  }

  const collectionSortOrder = new Map<string, number>();
  for (const row of rows.collections) {
    if (!isRecord(row)) return null;
    const collectionId = asTrimmedString(row.collection_id);
    if (!collectionId) return null;
    collectionSortOrder.set(collectionId, asInteger(row.sort_order));
  }

  const productRows = sortByOrderThenId(
    rows.products.filter(isRecord),
    (row) => asInteger(row.sort_order),
    (row) => asTrimmedString(row.product_id) ?? "",
  );
  const products: StageProduct[] = [];
  for (const row of productRows) {
    const productId = asTrimmedString(row.product_id);
    if (!productId) return null;
    if (asSource(row.source) === "user_pasted") continue;
    const memberships = sortByOrderThenId(
      membershipByProduct.get(productId) ?? [],
      (item) => collectionSortOrder.get(item.collectionId) ?? item.sortOrder,
      (item) => item.collectionId,
    );
    const product = mapProduct(row, memberships.map((item) => item.collectionId));
    if (!product) return null;
    products.push(product);
  }

  const variants: StageVariant[] = [];
  for (const row of rows.variants) {
    if (!isRecord(row)) return null;
    const variant = mapVariant(row);
    if (!variant) return null;
    variants.push(variant);
  }

  const collectionRows = sortByOrderThenId(
    rows.collections.filter(isRecord),
    (row) => asInteger(row.sort_order),
    (row) => asTrimmedString(row.collection_id) ?? "",
  );
  const collections: StageCollection[] = [];
  for (const row of collectionRows) {
    const collectionId = asTrimmedString(row.collection_id);
    if (!collectionId) return null;
    if (asTrimmedString(row.status) !== "active") continue;
    const memberships = sortByOrderThenId(
      membershipByCollection.get(collectionId) ?? [],
      (item) => item.sortOrder,
      (item) => item.productId,
    );
    const collection = mapCollection(row, memberships.map((item) => item.productId));
    if (!collection) return null;
    collections.push(collection);
  }

  if (products.length === 0) return null;

  return createStageCatalogSnapshot({
    authority: "durable",
    fallbackReason: null,
    products,
    variants,
    assets,
    collections,
    partners,
  });
}

export function resolveLoadedStageCatalog(input: Readonly<{
  durable: StageCatalogSnapshot | null;
  reason?: StageCatalogFallbackReason | null;
}>): StageCatalogLoadResult {
  if (input.durable && input.durable.products.length > 0) {
    return {
      catalog: input.durable,
      authority: "durable",
      fallbackReason: null,
    };
  }
  const fallbackReason = input.reason ?? "durable_empty";
  const catalog = seedFixtureStageCatalog(fallbackReason);
  return {
    catalog,
    authority: "seed_fixture",
    fallbackReason,
  };
}

export function serializeStageCatalogPayload(result: StageCatalogLoadResult): Readonly<{
  ok: true;
  authority: StageCatalogAuthority;
  fallbackReason: string | null;
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  assets: readonly StageAsset[];
  collections: readonly StageCollection[];
  partners: readonly StagePartner[];
}> {
  return {
    ok: true,
    authority: result.authority,
    fallbackReason: result.fallbackReason,
    products: result.catalog.products,
    variants: result.catalog.variants,
    assets: result.catalog.assets,
    collections: result.catalog.collections,
    partners: result.catalog.partners,
  };
}

export function parseStageCatalogPayload(value: unknown): StageCatalogLoadResult | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const authority = value.authority;
  if (authority !== "durable" && authority !== "seed_fixture") return null;
  if (!Array.isArray(value.products) || !Array.isArray(value.variants)) return null;
  if (!Array.isArray(value.assets) || !Array.isArray(value.collections)) return null;
  const partners = Array.isArray(value.partners) ? value.partners as StagePartner[] : [];
  const catalog = createStageCatalogSnapshot({
    authority,
    fallbackReason: asNullableString(value.fallbackReason),
    products: value.products as StageProduct[],
    variants: value.variants as StageVariant[],
    assets: value.assets as StageAsset[],
    collections: value.collections as StageCollection[],
    partners,
  });
  if (catalog.products.length === 0) return null;
  return {
    catalog,
    authority,
    fallbackReason: catalog.fallbackReason,
  };
}

export function stageCatalogRowsFromSnapshot(
  catalog: StageCatalogSnapshot,
): StageCatalogRows {
  const memberships: Record<string, unknown>[] = [];
  for (const collection of catalog.collections) {
    collection.productIds.forEach((productId, sortOrder) => {
      memberships.push({
        product_id: productId,
        collection_id: collection.collectionId,
        sort_order: sortOrder,
      });
    });
  }
  return {
    assets: catalog.assets.map((asset) => ({
      asset_id: asset.assetId,
      glb_url: asset.glbUrl,
      authored_width_m: asset.authoredWidthM,
      authored_height_m: asset.authoredHeightM,
      authored_depth_m: asset.authoredDepthM,
      status: asset.status,
    })),
    products: catalog.products.map((product, sortOrder) => ({
      product_id: product.productId,
      name: product.name,
      brand: product.brand,
      retailer: product.retailer,
      image_url: product.imageUrl,
      product_url: product.productUrl,
      price_amount: product.priceAmount,
      price_currency: product.priceCurrency,
      category_id: product.categoryId,
      subcategory_id: product.subcategoryId,
      source: product.source,
      partner_id: product.partnerId,
      default_variant_id: product.defaultVariantId,
      status: product.status ?? "active",
      sort_order: sortOrder,
    })),
    variants: catalog.variants.map((variant) => ({
      variant_id: variant.variantId,
      product_id: variant.productId,
      current_asset_id: variant.assetId,
      finish_label: variant.finishLabel,
      sku: variant.sku,
      price_amount: variant.priceAmount,
      price_currency: variant.priceCurrency,
      product_url: variant.productUrl,
      status: variant.status ?? "active",
    })),
    collections: catalog.collections.map((collection, sortOrder) => ({
      collection_id: collection.collectionId,
      name: collection.name,
      owner: collection.owner,
      partner_name: collection.partnerName,
      partner_id: collection.partnerId,
      status: "active",
      sort_order: sortOrder,
    })),
    memberships,
    partners: catalog.partners.map((partner) => ({
      partner_id: partner.partnerId,
      name: partner.name,
      slug: partner.slug,
      status: partner.status,
      website_url: partner.websiteUrl,
      logo_url: partner.logoUrl,
    })),
  };
}

export function retargetVariantCurrentAsset(
  catalog: StageCatalogSnapshot,
  variantId: string,
  nextAssetId: string | null,
): StageCatalogSnapshot | null {
  const variants = catalog.variants.map((variant) => (
    variant.variantId === variantId
      ? { ...variant, assetId: nextAssetId }
      : variant
  ));
  if (variants.every((variant, index) => variant === catalog.variants[index])) {
    return null;
  }
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    products: catalog.products,
    variants,
    assets: catalog.assets,
    collections: catalog.collections,
    partners: catalog.partners,
  });
}
