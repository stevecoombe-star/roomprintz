/**
 * PI-5F3A deterministic Partner catalog patch updates.
 *
 * Node-only. Reconstructs current commercial state by folding F1/F2
 * registration documents and registered sync patches. Plans explicit
 * patch updates and writes one forward-only partner_sync SQL
 * migration. Does not retarget Assets, mutate Scene Objects, deactivate
 * commercial identity, or rewrite registration history.
 *
 * Historical commercial contract:
 * - Scene geometry remains frozen to SceneObject.assetId.
 * - Commercial display remains current-state by productId/variantId.
 * - PI-5D2B remains the only Variant Asset retarget path.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "@/lib/afc-v2-runtime/furniture-asset-manifest";

import {
  createStageCatalogSnapshot,
  STAGE_SEED_CATALOG,
} from "./catalog";
import { FORBIDDEN_STAGE_CATALOG_TABLES } from "./catalog-store";
import {
  namespacedId,
  parsePartnerCatalogJson,
  partnerCatalogSqlSlug,
  type PartnerCatalogDocument,
} from "./partner-catalog";
import { PARTNER_CATALOG_DOCUMENTS } from "./partner-catalog-documents";
import {
  PARTNER_SYNC_DOCUMENTS,
  type PartnerSyncDocumentRegistration,
} from "./partner-sync-documents";
import {
  asFiniteNumber,
  asNonEmptyString,
  asNullableJsonString,
  hasDuplicateSkuInScope,
  isCommercialId,
  isPlainObject,
  isUuidLike,
  normalizeCurrency,
  productRegistrationRepoPaths,
  sqlNullableString,
  sqlNumber,
  sqlString,
  utcTimestamp,
  validateBrowseTaxonomy,
  validateFiniteNonNegativePrice,
  validateOptionalAbsoluteHttpsUrl,
  validatePartnerCatalogImageUrl,
  validateRequiredAbsoluteHttpsUrl,
  validateVariantRegistration,
  type ProductVariantIssue,
  type ProductVariantValidationGates,
} from "./product-variant-register";
import type {
  StageCatalogSnapshot,
  StageCollection,
  StagePartner,
  StageProduct,
  StageVariant,
} from "./types";

export const DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID =
  "var-demo-furniture-co-demo-coffee-table-walnut";
export const DEMO_COFFEE_TABLE_WALNUT_SKU = "DEMO-COFFEE-TABLE-WALNUT";
export const DEMO_COFFEE_TABLE_WALNUT_PRICE = 439;

export const ALLOWED_PRODUCT_SYNC_COLUMNS = Object.freeze([
  "name",
  "image_url",
  "product_url",
  "price_amount",
  "category_id",
  "subcategory_id",
  "default_variant_id",
]);

export const ALLOWED_VARIANT_SYNC_COLUMNS = Object.freeze([
  "finish_label",
  "sku",
  "price_amount",
  "product_url",
]);

const PRODUCT_UPDATE_KEYS = Object.freeze([
  "productId",
  "name",
  "imageUrl",
  "productUrl",
  "priceAmount",
  "priceCurrency",
  "categoryId",
  "subcategoryId",
  "defaultVariantId",
  "brand",
  "retailer",
  "partnerId",
  "source",
]);

const VARIANT_UPDATE_KEYS = Object.freeze([
  "variantId",
  "productId",
  "finishLabel",
  "sku",
  "priceAmount",
  "priceCurrency",
  "productUrl",
  "currentAssetId",
]);

const VARIANT_CREATE_KEYS = VARIANT_UPDATE_KEYS;

const COLLECTION_UPDATE_KEYS = Object.freeze([
  "collectionId",
  "name",
  "partnerId",
  "owner",
  "partnerName",
  "slug",
]);

const MEMBERSHIP_KEYS = Object.freeze(["productId", "collectionId"]);

const STATUS_KEYS = Object.freeze(["status", "partnerStatus", "productStatus", "variantStatus"]);

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function hasStatusKey(value: Record<string, unknown>): boolean {
  return STATUS_KEYS.some((key) => key in value);
}

function sqlIsNotDistinctFrom(column: string, value: string | number | null): string {
  if (value == null) return `${column} is not distinct from null`;
  if (typeof value === "number") return `${column} is not distinct from ${sqlNumber(value)}`;
  return `${column} is not distinct from ${sqlString(value)}`;
}

export function partnerSyncMigrationFileName(timestamp: string, sqlSlug: string): string {
  return `${timestamp}_vibode_stage_partner_sync_${sqlSlug}.sql`;
}

export function isPartnerSyncMigrationFileName(fileName: string): boolean {
  return /^\d{14}_vibode_stage_partner_sync_[a-z0-9_]+\.sql$/.test(fileName);
}

export function isPartnerSyncSqlForSlug(fileName: string, sqlSlug: string): boolean {
  return new RegExp(`^\\d{14}_vibode_stage_partner_sync_${sqlSlug}\\.sql$`).test(fileName);
}

export function listPartnerSyncMigrations(repoRoot = process.cwd()): string[] {
  const dir = productRegistrationRepoPaths(repoRoot).migrationsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isPartnerSyncMigrationFileName(name))
    .sort();
}

export type FoldedPartnerCatalogState = Readonly<{
  partners: readonly StagePartner[];
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  collections: readonly StageCollection[];
}>;

type MutableProduct = Omit<StageProduct, "collectionIds"> & { collectionIds: string[] };
type MutableCollection = Omit<StageCollection, "productIds"> & { productIds: string[] };

type MutablePartnerCatalogState = {
  partners: StagePartner[];
  products: MutableProduct[];
  variants: StageVariant[];
  collections: MutableCollection[];
};

export function emptyFoldedPartnerCatalogState(): FoldedPartnerCatalogState {
  return Object.freeze({
    partners: Object.freeze([]),
    products: Object.freeze([]),
    variants: Object.freeze([]),
    collections: Object.freeze([]),
  });
}

function freezeFoldedState(state: MutablePartnerCatalogState): FoldedPartnerCatalogState {
  return Object.freeze({
    partners: Object.freeze(state.partners.map((item) => Object.freeze({ ...item }))),
    products: Object.freeze(state.products.map((item) => Object.freeze({
      ...item,
      collectionIds: Object.freeze([...item.collectionIds]),
    }))),
    variants: Object.freeze(state.variants.map((item) => Object.freeze({ ...item }))),
    collections: Object.freeze(state.collections.map((item) => Object.freeze({
      ...item,
      productIds: Object.freeze([...item.productIds]),
    }))),
  });
}

function cloneMutable(state: FoldedPartnerCatalogState): MutablePartnerCatalogState {
  return {
    partners: state.partners.map((item) => ({ ...item })),
    products: state.products.map((item) => ({
      ...item,
      collectionIds: [...item.collectionIds],
    })),
    variants: state.variants.map((item) => ({ ...item })),
    collections: state.collections.map((item) => ({
      ...item,
      productIds: [...item.productIds],
    })),
  };
}

export function overlayFoldedPartnerCatalog(
  state: FoldedPartnerCatalogState,
  seed: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: "durable",
    products: [...seed.products, ...state.products],
    variants: [...seed.variants, ...state.variants],
    assets: seed.assets,
    collections: [...seed.collections, ...state.collections],
    partners: [...seed.partners, ...state.partners],
  });
}

function productSlugFor(partnerSlug: string, productId: string): string | null {
  const prefix = `prod-${partnerSlug}-`;
  if (!productId.startsWith(prefix)) return null;
  const slug = productId.slice(prefix.length);
  return slug.length > 0 ? slug : null;
}

function variantFromRegistration(
  productId: string,
  variant: PartnerCatalogDocument["products"][number]["defaultVariant"],
): StageVariant {
  return {
    variantId: variant.variantId,
    productId,
    assetId: variant.currentAssetId,
    finishLabel: variant.finishLabel,
    sku: variant.sku,
    priceAmount: variant.priceAmount,
    priceCurrency: normalizeCurrency(variant.priceCurrency),
    productUrl: variant.productUrl,
  };
}

function addMembershipMutable(
  state: MutablePartnerCatalogState,
  productId: string,
  collectionId: string,
): void {
  const product = state.products.find((item) => item.productId === productId);
  const collection = state.collections.find((item) => item.collectionId === collectionId);
  if (!product || !collection) return;
  if (!product.collectionIds.includes(collectionId)) {
    product.collectionIds = [...product.collectionIds, collectionId];
  }
  if (!collection.productIds.includes(productId)) {
    collection.productIds = [...collection.productIds, productId];
  }
}

function removeMembershipMutable(
  state: MutablePartnerCatalogState,
  productId: string,
  collectionId: string,
): void {
  const product = state.products.find((item) => item.productId === productId);
  const collection = state.collections.find((item) => item.collectionId === collectionId);
  if (product) {
    product.collectionIds = product.collectionIds.filter((id) => id !== collectionId);
  }
  if (collection) {
    collection.productIds = collection.productIds.filter((id) => id !== productId);
  }
}

export function foldPartnerCatalogRegistrationDocument(
  state: FoldedPartnerCatalogState,
  document: PartnerCatalogDocument,
): Readonly<{ ok: true; state: FoldedPartnerCatalogState; issues: readonly ProductVariantIssue[] }> | Readonly<{
  ok: false;
  state: null;
  issues: readonly ProductVariantIssue[];
}> {
  const issues: ProductVariantIssue[] = [];
  const working = cloneMutable(state);
  const existingPartner = working.partners.find((item) => (
    item.partnerId === document.partner.partnerId
  ));
  if (!existingPartner) {
    working.partners.push({ ...document.partner });
  } else if (
    existingPartner.slug !== document.partner.slug ||
    existingPartner.partnerId !== document.partner.partnerId
  ) {
    issues.push(issue(
      "IDENTITY_IMMUTABLE",
      `Registration Partner ${document.partner.partnerId} mutates frozen identity.`,
    ));
  }

  for (const collectionInput of document.collections) {
    if (working.collections.some((item) => item.collectionId === collectionInput.collectionId)) {
      issues.push(issue(
        "DUPLICATE_COLLECTION_ID",
        `Collection ${collectionInput.collectionId} already exists.`,
      ));
      continue;
    }
    working.collections.push({
      collectionId: collectionInput.collectionId,
      name: collectionInput.name,
      owner: "partner",
      partnerName: document.partner.name,
      partnerId: document.partner.partnerId,
      productIds: [],
    });
  }

  for (const productInput of document.products) {
    if (working.products.some((item) => item.productId === productInput.product.productId)) {
      issues.push(issue(
        "DUPLICATE_PRODUCT_ID",
        `Product ${productInput.product.productId} already exists.`,
      ));
      continue;
    }
    const variants = [productInput.defaultVariant, ...productInput.variants];
    for (const variant of variants) {
      if (working.variants.some((item) => item.variantId === variant.variantId)) {
        issues.push(issue("DUPLICATE_VARIANT_ID", `Variant ${variant.variantId} already exists.`));
      }
    }
    working.products.push({
      productId: productInput.product.productId,
      brand: productInput.product.brand,
      name: productInput.product.name,
      retailer: productInput.product.retailer,
      categoryId: productInput.product.categoryId,
      subcategoryId: productInput.product.subcategoryId,
      productUrl: productInput.product.productUrl,
      imageUrl: productInput.product.imageUrl,
      priceAmount: productInput.product.priceAmount,
      priceCurrency: normalizeCurrency(productInput.product.priceCurrency),
      defaultVariantId: productInput.defaultVariant.variantId,
      collectionIds: [],
      source: "partner_catalog",
      partnerId: document.partner.partnerId,
    });
    for (const variant of variants) {
      working.variants.push(variantFromRegistration(productInput.product.productId, variant));
    }
    for (const collectionId of productInput.product.collectionIds) {
      if (!working.collections.some((item) => item.collectionId === collectionId)) {
        issues.push(issue("UNKNOWN_COLLECTION", `Unknown Collection ${collectionId}.`));
        continue;
      }
      addMembershipMutable(working, productInput.product.productId, collectionId);
    }
  }

  if (issues.length > 0) {
    return { ok: false, state: null, issues };
  }
  return { ok: true, state: freezeFoldedState(working), issues: [] };
}

export type PartnerCatalogProductPatch = Readonly<{
  productId: string;
  name?: string;
  imageUrl?: string;
  productUrl?: string | null;
  priceAmount?: number;
  priceCurrency?: string;
  categoryId?: string;
  subcategoryId?: string | null;
  defaultVariantId?: string;
  brand?: string;
  retailer?: string;
  partnerId?: string;
  source?: string;
}>;

export type PartnerCatalogVariantPatch = Readonly<{
  variantId: string;
  productId?: string;
  finishLabel?: string | null;
  sku?: string | null;
  priceAmount?: number;
  priceCurrency?: string;
  productUrl?: string | null;
  currentAssetId?: string;
}>;

export type PartnerCatalogVariantCreate = Readonly<{
  variantId: string;
  productId: string;
  finishLabel: string | null;
  sku: string | null;
  priceAmount: number;
  priceCurrency: string;
  productUrl: string | null;
  currentAssetId: string;
}>;

export type PartnerCatalogCollectionPatch = Readonly<{
  collectionId: string;
  name?: string;
  partnerId?: string;
  owner?: string;
  partnerName?: string;
  slug?: string;
}>;

export type PartnerCatalogMembershipPatch = Readonly<{
  productId: string;
  collectionId: string;
}>;

export type PartnerCatalogSyncDocument = Readonly<{
  partnerId: string;
  mode: "patch";
  products: Readonly<{
    update: readonly PartnerCatalogProductPatch[];
  }>;
  variants: Readonly<{
    create: readonly PartnerCatalogVariantCreate[];
    update: readonly PartnerCatalogVariantPatch[];
  }>;
  collections: Readonly<{
    update: readonly PartnerCatalogCollectionPatch[];
    membershipAdd: readonly PartnerCatalogMembershipPatch[];
    membershipRemove: readonly PartnerCatalogMembershipPatch[];
  }>;
}>;

function parseProductPatch(
  value: unknown,
  index: number,
  issues: ProductVariantIssue[],
): PartnerCatalogProductPatch | null {
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `products.update[${index}] must be an object.`));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `products.update[${index}] status updates are not allowed.`));
    return null;
  }
  const extra = unknownKeys(value, PRODUCT_UPDATE_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `products.update[${index}] contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  const productId = asNonEmptyString(value.productId);
  if (!productId) {
    issues.push(issue("INVALID_PRODUCT_ID", `products.update[${index}].productId must be a non-empty string.`));
    return null;
  }
  const patch: {
    productId: string;
    name?: string;
    imageUrl?: string;
    productUrl?: string | null;
    priceAmount?: number;
    priceCurrency?: string;
    categoryId?: string;
    subcategoryId?: string | null;
    defaultVariantId?: string;
    brand?: string;
    retailer?: string;
    partnerId?: string;
    source?: string;
  } = { productId };
  if ("name" in value) {
    const name = asNonEmptyString(value.name);
    if (!name) issues.push(issue("EMPTY_NAME", `products.update[${index}].name must be non-empty.`));
    else patch.name = name;
  }
  if ("imageUrl" in value) {
    const imageUrl = asNonEmptyString(value.imageUrl);
    if (!imageUrl) issues.push(issue("INVALID_IMAGE_URL", `products.update[${index}].imageUrl must be non-empty.`));
    else patch.imageUrl = imageUrl;
  }
  if ("productUrl" in value) {
    if (value.productUrl == null) patch.productUrl = null;
    else {
      const productUrl = asNonEmptyString(value.productUrl);
      if (!productUrl) {
        issues.push(issue("INVALID_PRODUCT_URL", `products.update[${index}].productUrl must be a string or null.`));
      } else patch.productUrl = productUrl;
    }
  }
  if ("priceAmount" in value) {
    const priceAmount = asFiniteNumber(value.priceAmount);
    if (priceAmount == null) {
      issues.push(issue("INVALID_PRICE", `products.update[${index}].priceAmount must be a finite number.`));
    } else patch.priceAmount = priceAmount;
  }
  if ("priceCurrency" in value) {
    const priceCurrency = asNonEmptyString(value.priceCurrency);
    if (!priceCurrency) {
      issues.push(issue("INVALID_CURRENCY", `products.update[${index}].priceCurrency must be a non-empty string.`));
    } else patch.priceCurrency = priceCurrency;
  }
  if ("categoryId" in value) {
    const categoryId = asNonEmptyString(value.categoryId);
    if (!categoryId) {
      issues.push(issue("UNKNOWN_CATEGORY", `products.update[${index}].categoryId must be a non-empty string.`));
    } else patch.categoryId = categoryId;
  }
  if ("subcategoryId" in value) {
    if (value.subcategoryId == null) patch.subcategoryId = null;
    else if (typeof value.subcategoryId !== "string") {
      issues.push(issue("UNKNOWN_SUBCATEGORY", `products.update[${index}].subcategoryId must be a string or null.`));
    } else patch.subcategoryId = value.subcategoryId.trim() === "" ? null : value.subcategoryId.trim();
  }
  if ("defaultVariantId" in value) {
    const defaultVariantId = asNonEmptyString(value.defaultVariantId);
    if (!defaultVariantId) {
      issues.push(issue(
        "INVALID_VARIANT_ID",
        `products.update[${index}].defaultVariantId must be a non-empty string.`,
      ));
    } else patch.defaultVariantId = defaultVariantId;
  }
  if ("brand" in value) {
    const brand = asNonEmptyString(value.brand);
    if (!brand) issues.push(issue("EMPTY_BRAND", `products.update[${index}].brand must be non-empty.`));
    else patch.brand = brand;
  }
  if ("retailer" in value) {
    const retailer = asNonEmptyString(value.retailer);
    if (!retailer) issues.push(issue("EMPTY_RETAILER", `products.update[${index}].retailer must be non-empty.`));
    else patch.retailer = retailer;
  }
  if ("partnerId" in value) {
    const partnerId = asNonEmptyString(value.partnerId);
    if (!partnerId) {
      issues.push(issue("PARTNER_MISMATCH", `products.update[${index}].partnerId must be a non-empty string.`));
    } else patch.partnerId = partnerId;
  }
  if ("source" in value) {
    const source = asNonEmptyString(value.source);
    if (!source) {
      issues.push(issue("IDENTITY_IMMUTABLE", `products.update[${index}].source must be a non-empty string.`));
    } else patch.source = source;
  }
  return patch;
}

function parseVariantPatch(
  value: unknown,
  index: number,
  issues: ProductVariantIssue[],
): PartnerCatalogVariantPatch | null {
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `variants.update[${index}] must be an object.`));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `variants.update[${index}] status updates are not allowed.`));
    return null;
  }
  const extra = unknownKeys(value, VARIANT_UPDATE_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `variants.update[${index}] contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  const variantId = asNonEmptyString(value.variantId);
  if (!variantId) {
    issues.push(issue("INVALID_VARIANT_ID", `variants.update[${index}].variantId must be a non-empty string.`));
    return null;
  }
  const patch: {
    variantId: string;
    productId?: string;
    finishLabel?: string | null;
    sku?: string | null;
    priceAmount?: number;
    priceCurrency?: string;
    productUrl?: string | null;
    currentAssetId?: string;
  } = { variantId };
  if ("productId" in value) {
    const productId = asNonEmptyString(value.productId);
    if (!productId) {
      issues.push(issue("IDENTITY_IMMUTABLE", `variants.update[${index}].productId must be a non-empty string.`));
    } else patch.productId = productId;
  }
  if ("finishLabel" in value) {
    const finishLabel = asNullableJsonString(value.finishLabel);
    if (finishLabel === undefined) {
      issues.push(issue("INVALID_JSON", `variants.update[${index}].finishLabel must be a string or null.`));
    } else patch.finishLabel = finishLabel;
  }
  if ("sku" in value) {
    const sku = asNullableJsonString(value.sku);
    if (sku === undefined) {
      issues.push(issue("INVALID_JSON", `variants.update[${index}].sku must be a string or null.`));
    } else patch.sku = sku;
  }
  if ("priceAmount" in value) {
    const priceAmount = asFiniteNumber(value.priceAmount);
    if (priceAmount == null) {
      issues.push(issue("INVALID_PRICE", `variants.update[${index}].priceAmount must be a finite number.`));
    } else patch.priceAmount = priceAmount;
  }
  if ("priceCurrency" in value) {
    const priceCurrency = asNonEmptyString(value.priceCurrency);
    if (!priceCurrency) {
      issues.push(issue("INVALID_CURRENCY", `variants.update[${index}].priceCurrency must be a non-empty string.`));
    } else patch.priceCurrency = priceCurrency;
  }
  if ("productUrl" in value) {
    const productUrl = asNullableJsonString(value.productUrl);
    if (productUrl === undefined) {
      issues.push(issue("INVALID_JSON", `variants.update[${index}].productUrl must be a string or null.`));
    } else patch.productUrl = productUrl;
  }
  if ("currentAssetId" in value) {
    const currentAssetId = asNonEmptyString(value.currentAssetId);
    if (!currentAssetId) {
      issues.push(issue("UNKNOWN_ASSET", `variants.update[${index}].currentAssetId must be a non-empty string.`));
    } else patch.currentAssetId = currentAssetId;
  }
  return patch;
}

function parseVariantCreate(
  value: unknown,
  index: number,
  issues: ProductVariantIssue[],
): PartnerCatalogVariantCreate | null {
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `variants.create[${index}] must be an object.`));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `variants.create[${index}] status updates are not allowed.`));
    return null;
  }
  const extra = unknownKeys(value, VARIANT_CREATE_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `variants.create[${index}] contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  const variantId = asNonEmptyString(value.variantId);
  const productId = asNonEmptyString(value.productId);
  const priceAmount = asFiniteNumber(value.priceAmount);
  const priceCurrency = asNonEmptyString(value.priceCurrency);
  const currentAssetId = asNonEmptyString(value.currentAssetId);
  if (!variantId) issues.push(issue("INVALID_VARIANT_ID", `variants.create[${index}].variantId must be a non-empty string.`));
  if (!productId) issues.push(issue("INVALID_PRODUCT_ID", `variants.create[${index}].productId must be a non-empty string.`));
  if (priceAmount == null) {
    issues.push(issue("INVALID_PRICE", `variants.create[${index}].priceAmount must be a finite number.`));
  }
  if (!priceCurrency) {
    issues.push(issue("INVALID_CURRENCY", `variants.create[${index}].priceCurrency must be a non-empty string.`));
  }
  if (!currentAssetId) {
    issues.push(issue("UNKNOWN_ASSET", `variants.create[${index}].currentAssetId must be a non-empty string.`));
  }
  const finishLabel = asNullableJsonString(value.finishLabel);
  if ("finishLabel" in value && finishLabel === undefined) {
    issues.push(issue("INVALID_JSON", `variants.create[${index}].finishLabel must be a string or null.`));
  }
  const sku = asNullableJsonString(value.sku);
  if ("sku" in value && sku === undefined) {
    issues.push(issue("INVALID_JSON", `variants.create[${index}].sku must be a string or null.`));
  }
  const productUrl = asNullableJsonString(value.productUrl);
  if ("productUrl" in value && productUrl === undefined) {
    issues.push(issue("INVALID_JSON", `variants.create[${index}].productUrl must be a string or null.`));
  }
  if (!variantId || !productId || priceAmount == null || !priceCurrency || !currentAssetId) {
    return null;
  }
  return {
    variantId,
    productId,
    finishLabel: finishLabel ?? null,
    sku: sku ?? null,
    priceAmount,
    priceCurrency,
    productUrl: productUrl ?? null,
    currentAssetId,
  };
}

function parseCollectionPatch(
  value: unknown,
  index: number,
  issues: ProductVariantIssue[],
): PartnerCatalogCollectionPatch | null {
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `collections.update[${index}] must be an object.`));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `collections.update[${index}] status updates are not allowed.`));
    return null;
  }
  const extra = unknownKeys(value, COLLECTION_UPDATE_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `collections.update[${index}] contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  const collectionId = asNonEmptyString(value.collectionId);
  if (!collectionId) {
    issues.push(issue(
      "INVALID_COLLECTION_ID",
      `collections.update[${index}].collectionId must be a non-empty string.`,
    ));
    return null;
  }
  const patch: {
    collectionId: string;
    name?: string;
    partnerId?: string;
    owner?: string;
    partnerName?: string;
    slug?: string;
  } = { collectionId };
  if ("name" in value) {
    const name = asNonEmptyString(value.name);
    if (!name) {
      issues.push(issue("EMPTY_COLLECTION_NAME", `collections.update[${index}].name must be non-empty.`));
    } else patch.name = name;
  }
  if ("partnerId" in value) {
    const partnerId = asNonEmptyString(value.partnerId);
    if (!partnerId) {
      issues.push(issue("IDENTITY_IMMUTABLE", `collections.update[${index}].partnerId must be a non-empty string.`));
    } else patch.partnerId = partnerId;
  }
  if ("owner" in value) {
    const owner = asNonEmptyString(value.owner);
    if (!owner) {
      issues.push(issue("IDENTITY_IMMUTABLE", `collections.update[${index}].owner must be a non-empty string.`));
    } else patch.owner = owner;
  }
  if ("partnerName" in value) {
    const partnerName = asNonEmptyString(value.partnerName);
    if (!partnerName) {
      issues.push(issue("PARTNER_NAME_MISMATCH", `collections.update[${index}].partnerName must be non-empty.`));
    } else patch.partnerName = partnerName;
  }
  if ("slug" in value) {
    const slug = asNonEmptyString(value.slug);
    if (!slug) {
      issues.push(issue("IDENTITY_IMMUTABLE", `collections.update[${index}].slug must be a non-empty string.`));
    } else patch.slug = slug;
  }
  return patch;
}

function parseMembership(
  value: unknown,
  label: string,
  index: number,
  issues: ProductVariantIssue[],
): PartnerCatalogMembershipPatch | null {
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `${label}[${index}] must be an object.`));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `${label}[${index}] status updates are not allowed.`));
    return null;
  }
  const extra = unknownKeys(value, MEMBERSHIP_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `${label}[${index}] contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  const productId = asNonEmptyString(value.productId);
  const collectionId = asNonEmptyString(value.collectionId);
  if (!productId) issues.push(issue("INVALID_PRODUCT_ID", `${label}[${index}].productId must be a non-empty string.`));
  if (!collectionId) {
    issues.push(issue("INVALID_COLLECTION_ID", `${label}[${index}].collectionId must be a non-empty string.`));
  }
  if (!productId || !collectionId) return null;
  return { productId, collectionId };
}

function parseObjectArray<T>(
  value: unknown,
  label: string,
  issues: ProductVariantIssue[],
  parser: (item: unknown, index: number, issues: ProductVariantIssue[]) => T | null,
): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issues.push(issue("INVALID_JSON", `${label} must be an array.`));
    return [];
  }
  return value.flatMap((item, index) => {
    const parsed = parser(item, index, issues);
    return parsed ? [parsed] : [];
  });
}

export function parsePartnerCatalogSyncJson(value: unknown): Readonly<{
  ok: true;
  document: PartnerCatalogSyncDocument;
  issues: readonly ProductVariantIssue[];
}> | Readonly<{
  ok: false;
  document: null;
  issues: readonly ProductVariantIssue[];
}> {
  const issues: ProductVariantIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      document: null,
      issues: [issue("INVALID_JSON", "Partner sync JSON must be an object.")],
    };
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", "Partner/Product/Variant/Collection status updates are not allowed."));
  }
  const extra = unknownKeys(value, ["partnerId", "mode", "products", "variants", "collections"]);
  if (extra.length > 0) {
    issues.push(issue("UNSUPPORTED_OPERATION", `Unsupported top-level fields: ${extra.join(", ")}.`));
  }
  const partnerId = asNonEmptyString(value.partnerId);
  if (!partnerId) {
    issues.push(issue("INVALID_PARTNER_ID", "partnerId must be a non-empty string."));
  }
  if ("mode" in value) {
    const mode = asNonEmptyString(value.mode);
    if (mode !== "patch") {
      issues.push(issue("UNSUPPORTED_OPERATION", 'Partner sync mode must be "patch".'));
    }
  }
  if ("partner" in value) {
    issues.push(issue("UNSUPPORTED_OPERATION", "Partner identity updates are not allowed."));
  }

  const productsRaw = value.products;
  if (productsRaw != null && !isPlainObject(productsRaw)) {
    issues.push(issue("INVALID_JSON", "products must be an object."));
  }
  const variantsRaw = value.variants;
  if (variantsRaw != null && !isPlainObject(variantsRaw)) {
    issues.push(issue("INVALID_JSON", "variants must be an object."));
  }
  const collectionsRaw = value.collections;
  if (collectionsRaw != null && !isPlainObject(collectionsRaw)) {
    issues.push(issue("INVALID_JSON", "collections must be an object."));
  }
  if (isPlainObject(productsRaw)) {
    const extraProducts = unknownKeys(productsRaw, ["update"]);
    if (extra.length === 0 && extraProducts.length > 0) {
      issues.push(issue(
        "UNSUPPORTED_OPERATION",
        `products contains unsupported operations: ${extraProducts.join(", ")}.`,
      ));
    } else if (extraProducts.length > 0) {
      issues.push(issue(
        "UNSUPPORTED_OPERATION",
        `products contains unsupported operations: ${extraProducts.join(", ")}.`,
      ));
    }
  }
  if (isPlainObject(variantsRaw)) {
    const extraVariants = unknownKeys(variantsRaw, ["create", "update"]);
    if (extraVariants.length > 0) {
      issues.push(issue(
        "UNSUPPORTED_OPERATION",
        `variants contains unsupported operations: ${extraVariants.join(", ")}.`,
      ));
    }
  }
  if (isPlainObject(collectionsRaw)) {
    const extraCollections = unknownKeys(collectionsRaw, ["update", "membershipAdd", "membershipRemove"]);
    if (extraCollections.length > 0) {
      issues.push(issue(
        "UNSUPPORTED_OPERATION",
        `collections contains unsupported operations: ${extraCollections.join(", ")}.`,
      ));
    }
  }

  const productUpdates = parseObjectArray(
    isPlainObject(productsRaw) ? productsRaw.update : [],
    "products.update",
    issues,
    parseProductPatch,
  );
  const variantCreates = parseObjectArray(
    isPlainObject(variantsRaw) ? variantsRaw.create : [],
    "variants.create",
    issues,
    parseVariantCreate,
  );
  const variantUpdates = parseObjectArray(
    isPlainObject(variantsRaw) ? variantsRaw.update : [],
    "variants.update",
    issues,
    parseVariantPatch,
  );
  const collectionUpdates = parseObjectArray(
    isPlainObject(collectionsRaw) ? collectionsRaw.update : [],
    "collections.update",
    issues,
    parseCollectionPatch,
  );
  const membershipAdds = parseObjectArray(
    isPlainObject(collectionsRaw) ? collectionsRaw.membershipAdd : [],
    "collections.membershipAdd",
    issues,
    (item, index, nextIssues) => parseMembership(item, "collections.membershipAdd", index, nextIssues),
  );
  const membershipRemoves = parseObjectArray(
    isPlainObject(collectionsRaw) ? collectionsRaw.membershipRemove : [],
    "collections.membershipRemove",
    issues,
    (item, index, nextIssues) => parseMembership(item, "collections.membershipRemove", index, nextIssues),
  );

  if (issues.length > 0 || !partnerId) {
    return { ok: false, document: null, issues };
  }
  return {
    ok: true,
    document: {
      partnerId,
      mode: "patch",
      products: { update: productUpdates },
      variants: { create: variantCreates, update: variantUpdates },
      collections: {
        update: collectionUpdates,
        membershipAdd: membershipAdds,
        membershipRemove: membershipRemoves,
      },
    },
    issues: [],
  };
}

export type PlannedFieldChange = Readonly<{
  column: string;
  next: string | number | null;
  previous: string | number | null;
}>;

export type PlannedProductUpdate = Readonly<{
  productId: string;
  changes: readonly PlannedFieldChange[];
}>;

export type PlannedVariantUpdate = Readonly<{
  variantId: string;
  productId: string;
  changes: readonly PlannedFieldChange[];
}>;

export type PlannedVariantCreate = Readonly<{
  variant: StageVariant;
}>;

export type PlannedCollectionUpdate = Readonly<{
  collectionId: string;
  name: string;
  previousName: string;
}>;

export type PlannedMembership = Readonly<{
  productId: string;
  collectionId: string;
  sortOrder?: number;
}>;

export type PartnerCatalogSyncSqlPlan = Readonly<{
  sql: string;
  migration: string;
}>;

export type PartnerCatalogSyncPlan = Readonly<{
  ok: boolean;
  noOp: boolean;
  issues: readonly ProductVariantIssue[];
  partnerId: string | null;
  productUpdates: readonly PlannedProductUpdate[];
  variantCreates: readonly PlannedVariantCreate[];
  variantUpdates: readonly PlannedVariantUpdate[];
  collectionUpdates: readonly PlannedCollectionUpdate[];
  membershipAdds: readonly PlannedMembership[];
  membershipRemoves: readonly PlannedMembership[];
  sqlPlan: PartnerCatalogSyncSqlPlan | null;
  nextState: FoldedPartnerCatalogState | null;
}>;

function sameValue(left: string | number | null | undefined, right: string | number | null | undefined): boolean {
  if (left == null && right == null) return true;
  return left === right;
}

function productColumnForField(field: string): string | null {
  switch (field) {
    case "name": return "name";
    case "imageUrl": return "image_url";
    case "productUrl": return "product_url";
    case "priceAmount": return "price_amount";
    case "categoryId": return "category_id";
    case "subcategoryId": return "subcategory_id";
    case "defaultVariantId": return "default_variant_id";
    default: return null;
  }
}

function variantColumnForField(field: string): string | null {
  switch (field) {
    case "finishLabel": return "finish_label";
    case "sku": return "sku";
    case "priceAmount": return "price_amount";
    case "productUrl": return "product_url";
    default: return null;
  }
}

function replaceProduct(state: MutablePartnerCatalogState, product: MutableProduct | StageProduct): void {
  state.products = state.products.map((item) => (
    item.productId === product.productId
      ? { ...product, collectionIds: [...product.collectionIds] }
      : item
  ));
}

function replaceVariant(state: MutablePartnerCatalogState, variant: StageVariant): void {
  state.variants = state.variants.map((item) => (
    item.variantId === variant.variantId ? variant : item
  ));
}

function replaceCollection(state: MutablePartnerCatalogState, collection: MutableCollection | StageCollection): void {
  state.collections = state.collections.map((item) => (
    item.collectionId === collection.collectionId
      ? { ...collection, productIds: [...collection.productIds] }
      : item
  ));
}

function workingCatalogFor(
  state: FoldedPartnerCatalogState,
  gates: ProductVariantValidationGates,
): StageCatalogSnapshot {
  return overlayFoldedPartnerCatalog(state, gates.catalog ?? STAGE_SEED_CATALOG);
}

export function planPartnerCatalogSync(input: Readonly<{
  current: FoldedPartnerCatalogState;
  document: PartnerCatalogSyncDocument;
  repoRoot?: string;
  migrationTimestamp?: string;
  sqlSlug?: string;
  catalog?: StageCatalogSnapshot;
  seedAssets?: ProductVariantValidationGates["seedAssets"];
  manifest?: ProductVariantValidationGates["manifest"];
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
  manifestRepoRoot?: string;
}>): PartnerCatalogSyncPlan {
  const issues: ProductVariantIssue[] = [];
  const repoRoot = input.repoRoot ?? process.cwd();
  const gates: ProductVariantValidationGates = {
    catalog: input.catalog ?? STAGE_SEED_CATALOG,
    seedAssets: input.seedAssets,
    manifest: input.manifest,
    repoRoot,
    manifestRepoRoot: input.manifestRepoRoot ?? process.cwd(),
    runtimeAssetIds: input.runtimeAssetIds,
    runtimeDefinitionKnown: input.runtimeDefinitionKnown,
  };
  const partner = input.current.partners.find((item) => item.partnerId === input.document.partnerId) ?? null;
  if (!partner) {
    return {
      ok: false,
      noOp: false,
      issues: [issue("PARTNER_MISMATCH", `Unknown Partner ${input.document.partnerId}.`)],
      partnerId: input.document.partnerId,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      sqlPlan: null,
      nextState: null,
    };
  }
  const working = cloneMutable(input.current);
  const seenProductUpdates = new Set<string>();
  const seenVariantUpdates = new Set<string>();
  const seenVariantCreates = new Set<string>();

  for (const patch of input.document.products.update) {
    if (seenProductUpdates.has(patch.productId)) {
      issues.push(issue("DUPLICATE_PRODUCT_ID", `Product ${patch.productId} is updated more than once.`));
      continue;
    }
    seenProductUpdates.add(patch.productId);
    const current = working.products.find((item) => item.productId === patch.productId) ?? null;
    if (!current) {
      issues.push(issue("NOT_FOUND", `Unknown Product ${patch.productId}.`));
      continue;
    }
    if (current.partnerId !== partner.partnerId || current.source !== "partner_catalog") {
      issues.push(issue("PARTNER_MISMATCH", `Product ${patch.productId} is not owned by ${partner.partnerId}.`));
      continue;
    }
    if (patch.partnerId != null && patch.partnerId !== current.partnerId) {
      issues.push(issue("PARTNER_MISMATCH", `Product ${patch.productId} partnerId is immutable.`));
    }
    if (patch.source != null && patch.source !== current.source) {
      issues.push(issue("IDENTITY_IMMUTABLE", `Product ${patch.productId} source is immutable.`));
    }
    if (patch.priceCurrency != null && normalizeCurrency(patch.priceCurrency) !== current.priceCurrency) {
      issues.push(issue("CURRENCY_IMMUTABLE", `Product ${patch.productId} currency is immutable.`));
    }
    if (patch.brand != null && patch.brand !== partner.name) {
      issues.push(issue("PARTNER_NAME_MISMATCH", `Product ${patch.productId} brand must match Partner name.`));
    }
    if (patch.retailer != null && patch.retailer !== partner.name) {
      issues.push(issue("PARTNER_NAME_MISMATCH", `Product ${patch.productId} retailer must match Partner name.`));
    }
    const next: StageProduct = {
      ...current,
      name: patch.name ?? current.name,
      imageUrl: patch.imageUrl ?? current.imageUrl,
      productUrl: patch.productUrl !== undefined ? patch.productUrl : current.productUrl,
      priceAmount: patch.priceAmount ?? current.priceAmount,
      categoryId: patch.categoryId ?? current.categoryId,
      subcategoryId: patch.subcategoryId !== undefined ? patch.subcategoryId : current.subcategoryId,
      defaultVariantId: patch.defaultVariantId ?? current.defaultVariantId,
      brand: partner.name,
      retailer: partner.name,
    };
    issues.push(...validateRequiredAbsoluteHttpsUrl(next.productUrl));
    issues.push(...validatePartnerCatalogImageUrl(next.imageUrl, repoRoot));
    issues.push(...validateBrowseTaxonomy(next.categoryId, next.subcategoryId));
    if (next.priceAmount != null) {
      issues.push(...validateFiniteNonNegativePrice(next.priceAmount, "Product"));
    }
    replaceProduct(working, next);
  }

  for (const patch of input.document.variants.update) {
    if (seenVariantUpdates.has(patch.variantId)) {
      issues.push(issue("DUPLICATE_VARIANT_ID", `Variant ${patch.variantId} is updated more than once.`));
      continue;
    }
    seenVariantUpdates.add(patch.variantId);
    const current = working.variants.find((item) => item.variantId === patch.variantId) ?? null;
    if (!current) {
      issues.push(issue("NOT_FOUND", `Unknown Variant ${patch.variantId}.`));
      continue;
    }
    const product = working.products.find((item) => item.productId === current.productId) ?? null;
    if (!product || product.partnerId !== partner.partnerId) {
      issues.push(issue("PARTNER_MISMATCH", `Variant ${patch.variantId} is not owned by ${partner.partnerId}.`));
      continue;
    }
    if (patch.productId != null && patch.productId !== current.productId) {
      issues.push(issue("IDENTITY_IMMUTABLE", `Variant ${patch.variantId} productId is immutable.`));
    }
    if (patch.priceCurrency != null && normalizeCurrency(patch.priceCurrency) !== current.priceCurrency) {
      issues.push(issue("CURRENCY_IMMUTABLE", `Variant ${patch.variantId} currency is immutable.`));
    }
    if (patch.currentAssetId != null && patch.currentAssetId !== current.assetId) {
      issues.push(issue(
        "ASSET_RETARGET_REQUIRED",
        `Variant ${patch.variantId} currentAssetId changes require PI-5D2B.`,
      ));
    }
    const next: StageVariant = {
      ...current,
      finishLabel: patch.finishLabel !== undefined ? patch.finishLabel : current.finishLabel,
      sku: patch.sku !== undefined ? patch.sku : current.sku,
      priceAmount: patch.priceAmount ?? current.priceAmount,
      productUrl: patch.productUrl !== undefined ? patch.productUrl : current.productUrl,
    };
    if (next.priceAmount != null) {
      issues.push(...validateFiniteNonNegativePrice(next.priceAmount, "Variant"));
    }
    issues.push(...validateOptionalAbsoluteHttpsUrl(next.productUrl));
    replaceVariant(working, next);
  }

  for (const create of input.document.variants.create) {
    if (seenVariantCreates.has(create.variantId) || seenVariantUpdates.has(create.variantId)) {
      issues.push(issue("DUPLICATE_VARIANT_ID", `Variant ${create.variantId} is duplicated in this patch.`));
      continue;
    }
    seenVariantCreates.add(create.variantId);
    const product = working.products.find((item) => item.productId === create.productId) ?? null;
    if (!product || product.partnerId !== partner.partnerId) {
      issues.push(issue("UNKNOWN_PRODUCT", `Unknown Product ${create.productId}.`));
      continue;
    }
    const productSlug = productSlugFor(partner.slug, product.productId);
    const expectedPrefix = productSlug ? `var-${partner.slug}-${productSlug}-` : null;
    if (!isCommercialId(create.variantId) || isUuidLike(create.variantId)) {
      issues.push(issue("INVALID_VARIANT_ID", `Invalid Variant ID ${create.variantId}.`));
    } else if (expectedPrefix && !create.variantId.startsWith(expectedPrefix)) {
      issues.push(issue(
        "VARIANT_NAMESPACE_MISMATCH",
        `Variant ${create.variantId} is not in Product ${product.productId} namespace.`,
      ));
    }
    if (normalizeCurrency(create.priceCurrency) !== product.priceCurrency) {
      issues.push(issue("CURRENCY_IMMUTABLE", `Variant ${create.variantId} currency must match Product currency.`));
    }
    issues.push(...validateOptionalAbsoluteHttpsUrl(create.productUrl));
    const foldedWorking = freezeFoldedState(working);
    const extraValidation = validateVariantRegistration({
      productId: create.productId,
      variant: create,
    }, {
      ...gates,
      catalog: workingCatalogFor(foldedWorking, gates),
    });
    if (!extraValidation.ok) {
      issues.push(...extraValidation.errors);
      continue;
    }
    working.variants.push(extraValidation.parsed.variant);
  }

  for (const patch of input.document.collections.update) {
    const current = working.collections.find((item) => item.collectionId === patch.collectionId) ?? null;
    if (!current) {
      issues.push(issue("NOT_FOUND", `Unknown Collection ${patch.collectionId}.`));
      continue;
    }
    if (current.partnerId !== partner.partnerId || current.owner !== "partner") {
      issues.push(issue("PARTNER_MISMATCH", `Collection ${patch.collectionId} is not owned by ${partner.partnerId}.`));
      continue;
    }
    if (patch.partnerId != null && patch.partnerId !== current.partnerId) {
      issues.push(issue("IDENTITY_IMMUTABLE", `Collection ${patch.collectionId} partnerId is immutable.`));
    }
    if (patch.owner != null && patch.owner !== current.owner) {
      issues.push(issue("IDENTITY_IMMUTABLE", `Collection ${patch.collectionId} owner is immutable.`));
    }
    if (patch.partnerName != null && patch.partnerName !== partner.name) {
      issues.push(issue("PARTNER_NAME_MISMATCH", `Collection ${patch.collectionId} partnerName must match Partner name.`));
    }
    if (patch.slug != null) {
      const expected = namespacedId("col", partner.slug, patch.slug);
      if (expected !== current.collectionId) {
        issues.push(issue("IDENTITY_IMMUTABLE", `Collection ${patch.collectionId} slug/ID relationship is immutable.`));
      }
    }
    const next: StageCollection = {
      ...current,
      name: patch.name ?? current.name,
      partnerName: partner.name,
    };
    replaceCollection(working, next);
  }

  for (const membership of input.document.collections.membershipAdd) {
    const product = working.products.find((item) => item.productId === membership.productId) ?? null;
    const collection = working.collections.find((item) => item.collectionId === membership.collectionId) ?? null;
    if (!product) {
      issues.push(issue("NOT_FOUND", `Unknown Product ${membership.productId}.`));
      continue;
    }
    if (!collection) {
      issues.push(issue("NOT_FOUND", `Unknown Collection ${membership.collectionId}.`));
      continue;
    }
    if (
      product.partnerId !== partner.partnerId ||
      collection.partnerId !== partner.partnerId ||
      collection.owner !== "partner"
    ) {
      issues.push(issue(
        "COLLECTION_OWNER_MISMATCH",
        `Membership ${membership.productId} → ${membership.collectionId} is not same-partner.`,
      ));
      continue;
    }
    addMembershipMutable(working, membership.productId, membership.collectionId);
  }

  for (const membership of input.document.collections.membershipRemove) {
    const product = working.products.find((item) => item.productId === membership.productId) ?? null;
    const collection = working.collections.find((item) => item.collectionId === membership.collectionId) ?? null;
    if (!product) {
      issues.push(issue("NOT_FOUND", `Unknown Product ${membership.productId}.`));
      continue;
    }
    if (!collection) {
      issues.push(issue("NOT_FOUND", `Unknown Collection ${membership.collectionId}.`));
      continue;
    }
    removeMembershipMutable(working, membership.productId, membership.collectionId);
  }

  const nextState = freezeFoldedState(working);
  const nextCatalog = workingCatalogFor(nextState, gates);

  for (const product of nextState.products) {
    if (product.partnerId !== partner.partnerId) continue;
    const defaultVariant = nextState.variants.find((item) => item.variantId === product.defaultVariantId) ?? null;
    if (!defaultVariant) {
      issues.push(issue(
        "DEFAULT_VARIANT_MISMATCH",
        `Product ${product.productId} default Variant ${product.defaultVariantId} does not exist.`,
      ));
    } else if (defaultVariant.productId !== product.productId) {
      issues.push(issue(
        "DEFAULT_VARIANT_MISMATCH",
        `Default Variant ${product.defaultVariantId} does not belong to Product ${product.productId}.`,
      ));
    } else if (
      product.priceAmount !== defaultVariant.priceAmount ||
      product.priceCurrency !== defaultVariant.priceCurrency
    ) {
      issues.push(issue(
        "PRICE_CURRENCY_MISMATCH",
        "Product and default Variant price/currency must match.",
      ));
    }
  }

  for (const variant of nextState.variants) {
    const product = nextState.products.find((item) => item.productId === variant.productId);
    if (!product || product.partnerId !== partner.partnerId) continue;
    if (variant.priceCurrency !== product.priceCurrency) {
      issues.push(issue("CURRENCY_IMMUTABLE", `Variant ${variant.variantId} currency must match Product currency.`));
    }
    if (
      variant.sku &&
      hasDuplicateSkuInScope({
        sku: variant.sku,
        owner: { source: product.source, partnerId: product.partnerId },
        catalog: nextCatalog,
        ignoreVariantIds: [variant.variantId],
      })
    ) {
      issues.push(issue("DUPLICATE_SKU", `SKU ${variant.sku} already exists.`));
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      noOp: false,
      issues,
      partnerId: partner.partnerId,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      sqlPlan: null,
      nextState: null,
    };
  }

  const productUpdates: PlannedProductUpdate[] = [];
  for (const next of nextState.products) {
    const previous = input.current.products.find((item) => item.productId === next.productId);
    if (!previous) continue;
    const changes: PlannedFieldChange[] = [];
    const fields: Array<keyof Pick<StageProduct, "name" | "imageUrl" | "productUrl" | "priceAmount" | "categoryId" | "subcategoryId" | "defaultVariantId">> = [
      "name",
      "imageUrl",
      "productUrl",
      "priceAmount",
      "categoryId",
      "subcategoryId",
      "defaultVariantId",
    ];
    for (const field of fields) {
      if (!sameValue(previous[field], next[field])) {
        const column = productColumnForField(field);
        if (!column) continue;
        changes.push({
          column,
          previous: previous[field] ?? null,
          next: next[field] ?? null,
        });
      }
    }
    if (changes.length > 0) {
      productUpdates.push({ productId: next.productId, changes });
    }
  }

  const variantUpdates: PlannedVariantUpdate[] = [];
  for (const next of nextState.variants) {
    const previous = input.current.variants.find((item) => item.variantId === next.variantId);
    if (!previous) continue;
    const changes: PlannedFieldChange[] = [];
    const fields: Array<keyof Pick<StageVariant, "finishLabel" | "sku" | "priceAmount" | "productUrl">> = [
      "finishLabel",
      "sku",
      "priceAmount",
      "productUrl",
    ];
    for (const field of fields) {
      if (!sameValue(previous[field], next[field])) {
        const column = variantColumnForField(field);
        if (!column) continue;
        changes.push({
          column,
          previous: previous[field] ?? null,
          next: next[field] ?? null,
        });
      }
    }
    if (changes.length > 0) {
      variantUpdates.push({
        variantId: next.variantId,
        productId: next.productId,
        changes,
      });
    }
  }

  const variantCreates: PlannedVariantCreate[] = nextState.variants
    .filter((variant) => !input.current.variants.some((item) => item.variantId === variant.variantId))
    .map((variant) => ({ variant }));

  const collectionUpdates: PlannedCollectionUpdate[] = [];
  for (const next of nextState.collections) {
    const previous = input.current.collections.find((item) => item.collectionId === next.collectionId);
    if (!previous) continue;
    if (previous.name !== next.name) {
      collectionUpdates.push({
        collectionId: next.collectionId,
        name: next.name,
        previousName: previous.name,
      });
    }
  }

  const membershipAdds: PlannedMembership[] = [];
  for (const collection of nextState.collections) {
    const previous = input.current.collections.find((item) => item.collectionId === collection.collectionId);
    const previousIds = previous?.productIds ?? [];
    for (const [index, productId] of collection.productIds.entries()) {
      if (!previousIds.includes(productId)) {
        membershipAdds.push({
          productId,
          collectionId: collection.collectionId,
          sortOrder: index,
        });
      }
    }
  }

  const membershipRemoves: PlannedMembership[] = [];
  for (const previous of input.current.collections) {
    const next = nextState.collections.find((item) => item.collectionId === previous.collectionId);
    const nextIds = next?.productIds ?? [];
    for (const productId of previous.productIds) {
      if (!nextIds.includes(productId)) {
        membershipRemoves.push({
          productId,
          collectionId: previous.collectionId,
        });
      }
    }
  }

  const noOp = (
    productUpdates.length === 0 &&
    variantCreates.length === 0 &&
    variantUpdates.length === 0 &&
    collectionUpdates.length === 0 &&
    membershipAdds.length === 0 &&
    membershipRemoves.length === 0
  );

  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  const sqlSlug = input.sqlSlug ?? partnerCatalogSqlSlug(`${partner.slug}_sync`);
  const migration = path.join(
    productRegistrationRepoPaths(repoRoot).migrationsDir,
    partnerSyncMigrationFileName(timestamp, sqlSlug),
  );
  const sqlPlan = noOp
    ? null
    : {
      sql: renderPartnerCatalogSyncSql({
        partner,
        productUpdates,
        variantCreates,
        variantUpdates,
        collectionUpdates,
        membershipAdds,
        membershipRemoves,
        current: input.current,
      }),
      migration,
    };

  return {
    ok: true,
    noOp,
    issues: [],
    partnerId: partner.partnerId,
    productUpdates,
    variantCreates,
    variantUpdates,
    collectionUpdates,
    membershipAdds,
    membershipRemoves,
    sqlPlan,
    nextState,
  };
}

function renderGuardedUpdate(input: Readonly<{
  table: string;
  setClauses: readonly string[];
  whereClauses: readonly string[];
}>): string {
  return (
    `do $$\n` +
    `declare\n` +
    `  updated integer;\n` +
    `begin\n` +
    `  update ${input.table}\n` +
    `  set\n` +
    `    ${input.setClauses.join(",\n    ")}\n` +
    `  where\n` +
    `    ${input.whereClauses.join("\n    and ")};\n` +
    `  get diagnostics updated = row_count;\n` +
    `  if updated <> 1 then\n` +
    `    raise exception 'STALE_SYNC';\n` +
    `  end if;\n` +
    `end $$;`
  );
}

export function renderPartnerCatalogSyncSql(input: Readonly<{
  partner: StagePartner;
  productUpdates: readonly PlannedProductUpdate[];
  variantCreates: readonly PlannedVariantCreate[];
  variantUpdates: readonly PlannedVariantUpdate[];
  collectionUpdates: readonly PlannedCollectionUpdate[];
  membershipAdds: readonly PlannedMembership[];
  membershipRemoves: readonly PlannedMembership[];
  current: FoldedPartnerCatalogState;
}>): string {
  const parts: string[] = [];
  const assetIds = [...new Set(
    input.variantCreates
      .map((item) => item.variant.assetId)
      .filter((assetId): assetId is string => !!assetId),
  )];

  const assetGuards = assetIds.map((assetId) => (
    `  if not exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_assets\n` +
    `    where asset_id = ${sqlString(assetId)}\n` +
    `      and status = 'ready'\n` +
    `  ) then\n` +
    `    raise exception 'Target Asset is missing or not ready';\n` +
    `  end if;`
  ));
  const variantExistsGuards = input.variantCreates.map((item) => (
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_variants\n` +
    `    where variant_id = ${sqlString(item.variant.variantId)}\n` +
    `  ) then\n` +
    `    raise exception 'Variant already exists';\n` +
    `  end if;`
  ));
  const skuGuards = [
    ...input.variantCreates.filter((item) => item.variant.sku),
    ...input.variantUpdates.filter((item) => item.changes.some((change) => change.column === "sku" && change.next)),
  ].map((item) => {
    const sku = "variant" in item ? item.variant.sku : item.changes.find((change) => change.column === "sku")?.next;
    const variantId = "variant" in item ? item.variant.variantId : item.variantId;
    if (typeof sku !== "string") return "";
    return (
      `  if exists (\n` +
      `    select 1\n` +
      `    from public.vibode_stage_variants variants\n` +
      `    join public.vibode_stage_products products\n` +
      `      on products.product_id = variants.product_id\n` +
      `    where variants.sku = ${sqlString(sku)}\n` +
      `      and products.partner_id = ${sqlString(input.partner.partnerId)}\n` +
      `      and variants.variant_id is distinct from ${sqlString(variantId)}\n` +
      `  ) then\n` +
      `    raise exception 'SKU already exists for partner';\n` +
      `  end if;`
    );
  }).filter(Boolean);

  const membershipAddGuards = input.membershipAdds.map((item) => (
    `  if not exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_products products\n` +
    `    join public.vibode_stage_collections collections\n` +
    `      on collections.collection_id = ${sqlString(item.collectionId)}\n` +
    `     and collections.partner_id = products.partner_id\n` +
    `     and collections.owner = 'partner'\n` +
    `    where products.product_id = ${sqlString(item.productId)}\n` +
    `      and products.partner_id = ${sqlString(input.partner.partnerId)}\n` +
    `      and products.source = 'partner_catalog'\n` +
    `  ) then\n` +
    `    raise exception 'COLLECTION_OWNER_MISMATCH';\n` +
    `  end if;`
  ));

  const preludeGuards = [
    ...assetGuards,
    ...variantExistsGuards,
    ...skuGuards,
    ...membershipAddGuards,
  ];
  if (preludeGuards.length > 0) {
    parts.push(
      `do $$\n` +
      `begin\n` +
      `${preludeGuards.join("\n\n")}\n` +
      `end $$;`,
    );
  }

  for (const update of [...input.productUpdates].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const current = input.current.products.find((item) => item.productId === update.productId);
    if (!current) continue;
    const setClauses = update.changes.map((change) => (
      `${change.column} = ${typeof change.next === "number" ? sqlNumber(change.next) : sqlNullableString(change.next)}`
    ));
    const whereClauses = [
      `product_id = ${sqlString(update.productId)}`,
      `partner_id = ${sqlString(input.partner.partnerId)}`,
      `source = 'partner_catalog'`,
      ...update.changes.map((change) => sqlIsNotDistinctFrom(change.column, change.previous)),
    ];
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_products",
      setClauses,
      whereClauses,
    }));
  }

  for (const update of [...input.variantUpdates].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const setClauses = update.changes.map((change) => (
      `${change.column} = ${typeof change.next === "number" ? sqlNumber(change.next) : sqlNullableString(change.next)}`
    ));
    const whereClauses = [
      `variant_id = ${sqlString(update.variantId)}`,
      `product_id = ${sqlString(update.productId)}`,
      ...update.changes.map((change) => sqlIsNotDistinctFrom(change.column, change.previous)),
    ];
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_variants",
      setClauses,
      whereClauses,
    }));
  }

  for (const create of [...input.variantCreates].sort((a, b) => (
    a.variant.variantId.localeCompare(b.variant.variantId)
  ))) {
    parts.push(
      `insert into public.vibode_stage_variants (\n` +
      `  variant_id,\n` +
      `  product_id,\n` +
      `  current_asset_id,\n` +
      `  finish_label,\n` +
      `  sku,\n` +
      `  price_amount,\n` +
      `  price_currency,\n` +
      `  product_url\n` +
      `) values (\n` +
      `  ${sqlString(create.variant.variantId)},\n` +
      `  ${sqlString(create.variant.productId)},\n` +
      `  ${sqlString(create.variant.assetId ?? "")},\n` +
      `  ${sqlNullableString(create.variant.finishLabel)},\n` +
      `  ${sqlNullableString(create.variant.sku)},\n` +
      `  ${sqlNumber(create.variant.priceAmount ?? 0)},\n` +
      `  ${sqlString(create.variant.priceCurrency)},\n` +
      `  ${sqlNullableString(create.variant.productUrl)}\n` +
      `);`,
    );
  }

  for (const update of [...input.collectionUpdates].sort((a, b) => (
    a.collectionId.localeCompare(b.collectionId)
  ))) {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_collections",
      setClauses: [`name = ${sqlString(update.name)}`],
      whereClauses: [
        `collection_id = ${sqlString(update.collectionId)}`,
        `partner_id = ${sqlString(input.partner.partnerId)}`,
        `owner = 'partner'`,
        sqlIsNotDistinctFrom("name", update.previousName),
      ],
    }));
  }

  for (const membership of [...input.membershipAdds].sort((a, b) => (
    `${a.collectionId}:${a.productId}`.localeCompare(`${b.collectionId}:${b.productId}`)
  ))) {
    parts.push(
      `insert into public.vibode_stage_product_collections (\n` +
      `  product_id,\n` +
      `  collection_id,\n` +
      `  sort_order\n` +
      `) values (\n` +
      `  ${sqlString(membership.productId)},\n` +
      `  ${sqlString(membership.collectionId)},\n` +
      `  ${sqlNumber(membership.sortOrder ?? 0)}\n` +
      `);`,
    );
  }

  for (const membership of [...input.membershipRemoves].sort((a, b) => (
    `${a.collectionId}:${a.productId}`.localeCompare(`${b.collectionId}:${b.productId}`)
  ))) {
    parts.push(
      `delete from public.vibode_stage_product_collections\n` +
      `where product_id = ${sqlString(membership.productId)}\n` +
      `  and collection_id = ${sqlString(membership.collectionId)};`,
    );
  }

  return (
    `-- PI-5F3A: Partner catalog commercial patch.\n` +
    `--\n` +
    `-- Updates current commercial metadata only.\n` +
    `-- Scene geometry remains frozen to SceneObject.assetId.\n` +
    `-- Commercial display remains current-state by productId/variantId.\n` +
    `-- Does not mutate Assets, current_asset_id, Scene Objects, or identities.\n` +
    `-- PI-5D2B remains the only Variant Asset retarget path.\n` +
    `-- Omission means no change. Patch-only; no snapshot deactivation.\n` +
    `\n` +
    `begin;\n` +
    `\n` +
    `set constraints public.vibode_stage_products_default_variant_fkey deferred;\n` +
    `\n` +
    parts.join("\n\n") +
    `\n` +
    `\n` +
    `commit;\n`
  );
}

export type FoldPartnerCatalogResult = Readonly<{
  ok: true;
  state: FoldedPartnerCatalogState;
  issues: readonly ProductVariantIssue[];
}> | Readonly<{
  ok: false;
  state: null;
  issues: readonly ProductVariantIssue[];
}>;

export function foldPartnerCatalogCurrentState(input: Readonly<{
  repoRoot?: string;
  catalogDocuments?: readonly { jsonRelativePath: string }[];
  syncDocuments?: readonly PartnerSyncDocumentRegistration[];
  stopBeforeSyncBatchId?: string;
  excludeSyncBatchIds?: readonly string[];
}> = {}): FoldPartnerCatalogResult {
  const repoRoot = input.repoRoot ?? process.cwd();
  const catalogDocuments = input.catalogDocuments ?? PARTNER_CATALOG_DOCUMENTS;
  const syncDocuments = input.syncDocuments ?? PARTNER_SYNC_DOCUMENTS;
  const exclude = new Set(input.excludeSyncBatchIds ?? []);
  let state = emptyFoldedPartnerCatalogState();

  for (const documentReg of catalogDocuments) {
    const jsonPath = path.join(repoRoot, documentReg.jsonRelativePath);
    if (!existsSync(jsonPath)) {
      return {
        ok: false,
        state: null,
        issues: [issue("PARTNER_JSON_MISSING", `Missing partner catalog JSON at ${documentReg.jsonRelativePath}.`)],
      };
    }
    let parsed: ReturnType<typeof parsePartnerCatalogJson>;
    try {
      parsed = parsePartnerCatalogJson(JSON.parse(readFileSync(jsonPath, "utf8")));
    } catch (error) {
      return {
        ok: false,
        state: null,
        issues: [issue(
          "INVALID_JSON",
          error instanceof Error ? error.message : `Partner catalog JSON is malformed: ${documentReg.jsonRelativePath}.`,
        )],
      };
    }
    if (!parsed.ok) {
      return { ok: false, state: null, issues: parsed.errors };
    }
    const folded = foldPartnerCatalogRegistrationDocument(state, parsed.document);
    if (!folded.ok) return folded;
    state = folded.state;
  }

  for (const documentReg of syncDocuments) {
    if (documentReg.batchId === input.stopBeforeSyncBatchId) break;
    if (exclude.has(documentReg.batchId)) continue;
    const jsonPath = path.join(repoRoot, documentReg.jsonRelativePath);
    if (!existsSync(jsonPath)) {
      return {
        ok: false,
        state: null,
        issues: [issue("PARTNER_JSON_MISSING", `Missing partner sync JSON at ${documentReg.jsonRelativePath}.`)],
      };
    }
    let parsed: ReturnType<typeof parsePartnerCatalogSyncJson>;
    try {
      parsed = parsePartnerCatalogSyncJson(JSON.parse(readFileSync(jsonPath, "utf8")));
    } catch (error) {
      return {
        ok: false,
        state: null,
        issues: [issue(
          "INVALID_JSON",
          error instanceof Error ? error.message : `Partner sync JSON is malformed: ${documentReg.jsonRelativePath}.`,
        )],
      };
    }
    if (!parsed.ok) {
      return { ok: false, state: null, issues: parsed.issues };
    }
    const plan = planPartnerCatalogSync({
      current: state,
      document: parsed.document,
      repoRoot,
    });
    if (!plan.ok || !plan.nextState) {
      return { ok: false, state: null, issues: plan.issues };
    }
    state = plan.nextState;
  }

  return { ok: true, state, issues: [] };
}

function quotedEquals(sql: string, column: string): string[] {
  const pattern = new RegExp(`${column}\\s*=\\s*'((?:''|[^'])*)'`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    values.push((match[1] ?? "").replace(/''/g, "'"));
  }
  return values;
}

function setColumnsFromUpdate(block: string): string[] {
  const setMatch = block.match(/\bset\b([\s\S]*?)\bwhere\b/i);
  if (!setMatch) return [];
  return (setMatch[1] ?? "")
    .split(",")
    .map((part) => part.trim().split(/\s*=\s*/)[0]?.trim().toLowerCase())
    .filter((column): column is string => !!column);
}

export type ParsedPartnerCatalogSyncSql = Readonly<{
  productIds: readonly string[];
  variantIds: readonly string[];
  collectionIds: readonly string[];
  partnerIds: readonly string[];
  assetIds: readonly string[];
  updatedProductIds: readonly string[];
  updatedVariantIds: readonly string[];
  insertedVariantIds: readonly string[];
  insertedMemberships: readonly Readonly<{ productId: string; collectionId: string }>[];
  deletedMemberships: readonly Readonly<{ productId: string; collectionId: string }>[];
  productUpdateColumns: readonly string[];
  variantUpdateColumns: readonly string[];
  collectionUpdateColumns: readonly string[];
  insertsVariant: boolean;
  insertsMembership: boolean;
  deletesMembership: boolean;
  deletesProduct: boolean;
  deletesVariant: boolean;
  deletesPartner: boolean;
  deletesCollection: boolean;
  deletesCollectionEntity: boolean;
  updatesProduct: boolean;
  updatesVariant: boolean;
  updatesCollection: boolean;
  updatesCurrentAssetId: boolean;
  mutatesAssets: boolean;
  touchesObjectsJson: boolean;
  touchesScenes: boolean;
  usesUpsert: boolean;
  hasBegin: boolean;
  hasCommit: boolean;
  mentionsStaleSync: boolean;
  forbiddenTables: readonly string[];
}>;

function blocksMatching(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map((match) => match[0] ?? "");
}

function firstSqlString(sql: string): string | null {
  const match = sql.match(/'((?:''|[^'])*)'/);
  if (!match) return null;
  return (match[1] ?? "").replace(/''/g, "'");
}

function sqlStringLiterals(sql: string): string[] {
  const values: string[] = [];
  const pattern = /'((?:''|[^'])*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    values.push((match[1] ?? "").replace(/''/g, "'"));
  }
  return values;
}

function valuesClause(sql: string): string {
  const match = sql.match(/\bvalues\b([\s\S]*)/i);
  return match?.[1] ?? "";
}

export function parsePartnerCatalogSyncSql(sql: string): ParsedPartnerCatalogSyncSql {
  const unique = (values: readonly string[]) => [...new Set(values)];
  const body = sql.replace(/--[^\n]*/g, "");
  const productUpdateBlocks = blocksMatching(body, /\bupdate\s+public\.vibode_stage_products\b[\s\S]*?;/gi);
  const variantUpdateBlocks = blocksMatching(body, /\bupdate\s+public\.vibode_stage_variants\b[\s\S]*?;/gi);
  const collectionUpdateBlocks = blocksMatching(body, /\bupdate\s+public\.vibode_stage_collections\b[\s\S]*?;/gi);
  const variantInsertBlocks = blocksMatching(body, /\binsert\s+into\s+public\.vibode_stage_variants\b[\s\S]*?;/gi);
  const membershipInsertBlocks = blocksMatching(body, /\binsert\s+into\s+public\.vibode_stage_product_collections\b[\s\S]*?;/gi);
  const membershipDeleteBlocks = blocksMatching(body, /\bdelete\s+from\s+public\.vibode_stage_product_collections\b[\s\S]*?;/gi);
  const productUpdateColumns = unique(productUpdateBlocks.flatMap(setColumnsFromUpdate));
  const variantUpdateColumns = unique(variantUpdateBlocks.flatMap(setColumnsFromUpdate));
  const collectionUpdateColumns = unique(collectionUpdateBlocks.flatMap(setColumnsFromUpdate));
  const forbiddenTables = FORBIDDEN_STAGE_CATALOG_TABLES.filter((table) => {
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${table}(?![A-Za-z0-9_])`);
    return pattern.test(body);
  });
  return {
    productIds: unique(quotedEquals(sql, "product_id")),
    variantIds: unique(quotedEquals(sql, "variant_id")),
    collectionIds: unique(quotedEquals(sql, "collection_id")),
    partnerIds: unique(quotedEquals(sql, "partner_id")),
    assetIds: unique([
      ...quotedEquals(sql, "asset_id"),
      ...quotedEquals(sql, "current_asset_id"),
    ]),
    updatedProductIds: unique(productUpdateBlocks.flatMap((block) => quotedEquals(block, "product_id"))),
    updatedVariantIds: unique(variantUpdateBlocks.flatMap((block) => quotedEquals(block, "variant_id"))),
    insertedVariantIds: unique(variantInsertBlocks.flatMap((block) => {
      const id = firstSqlString(valuesClause(block));
      return id ? [id] : [];
    })),
    insertedMemberships: membershipInsertBlocks.flatMap((block) => {
      const literals = sqlStringLiterals(valuesClause(block));
      if (literals.length < 2) return [];
      return [{ productId: literals[0]!, collectionId: literals[1]! }];
    }),
    deletedMemberships: membershipDeleteBlocks.flatMap((block) => {
      const productIds = quotedEquals(block, "product_id");
      const collectionIds = quotedEquals(block, "collection_id");
      const count = Math.min(productIds.length, collectionIds.length);
      const pairs: Array<{ productId: string; collectionId: string }> = [];
      for (let index = 0; index < count; index += 1) {
        pairs.push({
          productId: productIds[index]!,
          collectionId: collectionIds[index]!,
        });
      }
      return pairs;
    }),
    productUpdateColumns,
    variantUpdateColumns,
    collectionUpdateColumns,
    insertsVariant: variantInsertBlocks.length > 0,
    insertsMembership: membershipInsertBlocks.length > 0,
    deletesMembership: membershipDeleteBlocks.length > 0,
    deletesProduct: /\bdelete\s+from\s+public\.vibode_stage_products\b/i.test(body),
    deletesVariant: /\bdelete\s+from\s+public\.vibode_stage_variants\b/i.test(body),
    deletesPartner: /\bdelete\s+from\s+public\.vibode_stage_partners\b/i.test(body),
    deletesCollection: /\bdelete\s+from\s+public\.vibode_stage_collections\b/i.test(body),
    deletesCollectionEntity: /\bdelete\s+from\s+public\.vibode_stage_collections\b/i.test(body),
    updatesProduct: productUpdateBlocks.length > 0,
    updatesVariant: variantUpdateBlocks.length > 0,
    updatesCollection: collectionUpdateBlocks.length > 0,
    updatesCurrentAssetId: variantUpdateColumns.includes("current_asset_id"),
    mutatesAssets: /\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i.test(body),
    touchesObjectsJson: /objects_json/i.test(body),
    touchesScenes: /vibode_3d_scenes/i.test(body),
    usesUpsert: /\bon\s+conflict\b/i.test(body) || /\bupsert\b/i.test(body),
    hasBegin: /^\s*begin\s*;/im.test(body),
    hasCommit: /\bcommit\s*;/i.test(body),
    mentionsStaleSync: /STALE_SYNC/.test(sql),
    forbiddenTables,
  };
}

export type PartnerCatalogSyncImportSuccess = Readonly<{
  ok: true;
  check: boolean;
  noOp: boolean;
  issues: readonly ProductVariantIssue[];
  partnerId: string;
  productUpdates: readonly PlannedProductUpdate[];
  variantCreates: readonly PlannedVariantCreate[];
  variantUpdates: readonly PlannedVariantUpdate[];
  collectionUpdates: readonly PlannedCollectionUpdate[];
  membershipAdds: readonly PlannedMembership[];
  membershipRemoves: readonly PlannedMembership[];
  written: Readonly<{ migration: string }> | null;
  migration: string | null;
  nextState: FoldedPartnerCatalogState;
}>;

export type PartnerCatalogSyncImportFailure = Readonly<{
  ok: false;
  check: boolean;
  noOp: false;
  issues: readonly ProductVariantIssue[];
  partnerId: string | null;
  productUpdates: readonly [];
  variantCreates: readonly [];
  variantUpdates: readonly [];
  collectionUpdates: readonly [];
  membershipAdds: readonly [];
  membershipRemoves: readonly [];
  written: null;
  migration: null;
  nextState: null;
}>;

export type PartnerCatalogSyncImportResult =
  | PartnerCatalogSyncImportSuccess
  | PartnerCatalogSyncImportFailure;

export function resolvePartnerSyncRegistration(
  inputPath: string,
  repoRoot = process.cwd(),
  documents: readonly PartnerSyncDocumentRegistration[] = PARTNER_SYNC_DOCUMENTS,
): PartnerSyncDocumentRegistration | null {
  const relative = path.relative(repoRoot, path.resolve(repoRoot, inputPath)).replaceAll("\\", "/");
  return documents.find((item) => (
    item.jsonRelativePath === relative || item.jsonRelativePath === inputPath.replaceAll("\\", "/")
  )) ?? null;
}

export function importPartnerCatalogSync(input: Readonly<{
  document: PartnerCatalogSyncDocument;
  repoRoot?: string;
  check?: boolean;
  migrationTimestamp?: string;
  sqlSlug?: string;
  current?: FoldedPartnerCatalogState;
  stopBeforeSyncBatchId?: string;
  jsonRelativePath?: string;
  catalog?: StageCatalogSnapshot;
  manifestRepoRoot?: string;
}>): PartnerCatalogSyncImportResult {
  const check = input.check === true;
  const repoRoot = input.repoRoot ?? process.cwd();
  const registration = input.jsonRelativePath
    ? resolvePartnerSyncRegistration(input.jsonRelativePath, repoRoot)
    : null;
  let folded = input.current ?? null;
  if (!folded) {
    const foldedResult = foldPartnerCatalogCurrentState({
      repoRoot,
      stopBeforeSyncBatchId: input.stopBeforeSyncBatchId ?? registration?.batchId,
    });
    if (!foldedResult.ok) {
      return {
        ok: false,
        check,
        noOp: false,
        issues: foldedResult.issues,
        partnerId: input.document.partnerId,
        productUpdates: [],
        variantCreates: [],
        variantUpdates: [],
        collectionUpdates: [],
        membershipAdds: [],
        membershipRemoves: [],
        written: null,
        migration: null,
        nextState: null,
      };
    }
    folded = foldedResult.state;
  }
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    return {
      ok: false,
      check,
      noOp: false,
      issues: [issue("INVALID_TIMESTAMP", "migration timestamp must be YYYYMMDDHHMMSS.")],
      partnerId: input.document.partnerId,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      written: null,
      migration: null,
      nextState: null,
    };
  }
  const plan = planPartnerCatalogSync({
    current: folded,
    document: input.document,
    repoRoot,
    migrationTimestamp: timestamp,
    sqlSlug: input.sqlSlug ?? registration?.sqlSlug,
    catalog: input.catalog,
    manifestRepoRoot: input.manifestRepoRoot,
  });
  if (!plan.ok || !plan.nextState) {
    return {
      ok: false,
      check,
      noOp: false,
      issues: plan.issues,
      partnerId: plan.partnerId,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      written: null,
      migration: null,
      nextState: null,
    };
  }
  if (plan.noOp || !plan.sqlPlan) {
    return {
      ok: true,
      check,
      noOp: true,
      issues: [],
      partnerId: plan.partnerId ?? input.document.partnerId,
      productUpdates: plan.productUpdates,
      variantCreates: plan.variantCreates,
      variantUpdates: plan.variantUpdates,
      collectionUpdates: plan.collectionUpdates,
      membershipAdds: plan.membershipAdds,
      membershipRemoves: plan.membershipRemoves,
      written: null,
      migration: null,
      nextState: plan.nextState,
    };
  }
  if (check) {
    return {
      ok: true,
      check: true,
      noOp: false,
      issues: [],
      partnerId: plan.partnerId ?? input.document.partnerId,
      productUpdates: plan.productUpdates,
      variantCreates: plan.variantCreates,
      variantUpdates: plan.variantUpdates,
      collectionUpdates: plan.collectionUpdates,
      membershipAdds: plan.membershipAdds,
      membershipRemoves: plan.membershipRemoves,
      written: null,
      migration: plan.sqlPlan.migration,
      nextState: plan.nextState,
    };
  }
  if (existsSync(plan.sqlPlan.migration)) {
    return {
      ok: false,
      check,
      noOp: false,
      issues: [issue("MIGRATION_EXISTS", `Partner sync migration already exists: ${plan.sqlPlan.migration}`)],
      partnerId: plan.partnerId,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      written: null,
      migration: null,
      nextState: null,
    };
  }
  try {
    writeFileAtomic(plan.sqlPlan.migration, plan.sqlPlan.sql);
  } catch (error) {
    return {
      ok: false,
      check,
      noOp: false,
      issues: [issue(
        "WRITE_FAILED",
        error instanceof Error ? error.message : "Unable to write partner sync SQL.",
      )],
      partnerId: plan.partnerId,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      written: null,
      migration: null,
      nextState: null,
    };
  }
  return {
    ok: true,
    check: false,
    noOp: false,
    issues: [],
    partnerId: plan.partnerId ?? input.document.partnerId,
    productUpdates: plan.productUpdates,
    variantCreates: plan.variantCreates,
    variantUpdates: plan.variantUpdates,
    collectionUpdates: plan.collectionUpdates,
    membershipAdds: plan.membershipAdds,
    membershipRemoves: plan.membershipRemoves,
    written: { migration: plan.sqlPlan.migration },
    migration: plan.sqlPlan.migration,
    nextState: plan.nextState,
  };
}
