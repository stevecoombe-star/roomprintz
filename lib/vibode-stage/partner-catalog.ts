/**
 * PI-5F1 STAGE-native Partner identity and deterministic partner catalog import.
 *
 * Node-only. Parses/validates/plans/writes one partner catalog batch as a
 * single durable SQL migration. Reuses PI-5E commercial validators.
 * Does not write curated commercial seed or Variant association maps.
 * Does not ingest or mutate Assets.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "@/lib/afc-v2-runtime/furniture-asset-manifest";

import { createStageCatalogSnapshot, STAGE_SEED_CATALOG } from "./catalog";
import { FORBIDDEN_STAGE_CATALOG_TABLES } from "./catalog-store";
import type { GeneratedRegisteredVariant } from "./catalog-commercial.generated";
import {
  asNonEmptyString,
  asNullableJsonString,
  isAbsoluteHttpsUrl,
  isCommercialId,
  isPlainObject,
  isUuidLike,
  parseProductRegistrationJson,
  parseVariantRegistrationJson,
  productRegistrationRepoPaths,
  sqlNullableString,
  sqlNumber,
  sqlString,
  utcTimestamp,
  validateProductVariantRegistration,
  validateVariantRegistration,
  type AdditionalVariantRegistrationInput,
  type ProductVariantIssue,
  type ProductVariantRegistrationInput,
  type ProductVariantValidationGates,
} from "./product-variant-register";
import type {
  StageCatalogSnapshot,
  StageCollection,
  StagePartner,
  StagePartnerStatus,
  StageProduct,
  StageVariant,
} from "./types";

export const PARTNER_CATALOG_JSON_RELATIVE_PATH =
  "lib/vibode-stage/demo-furniture-co.partner.json";

export const DEMO_FURNITURE_PARTNER_ID = "partner-demo-furniture-co";
export const DEMO_FURNITURE_PARTNER_SLUG = "demo-furniture-co";
export const DEMO_FURNITURE_PARTNER_NAME = "Demo Furniture Co.";
export const DEMO_LIVING_ROOM_COLLECTION_ID = "col-demo-furniture-co-demo-living-room";
export const DEMO_SOFA_PRODUCT_ID = "prod-demo-furniture-co-demo-sofa";
export const DEMO_SOFA_DEFAULT_VARIANT_ID = "var-demo-furniture-co-demo-sofa-natural";
export const DEMO_SOFA_STONE_VARIANT_ID = "var-demo-furniture-co-demo-sofa-stone";
export const DEMO_LOUNGE_CHAIR_PRODUCT_ID = "prod-demo-furniture-co-demo-lounge-chair";
export const DEMO_LOUNGE_CHAIR_VARIANT_ID = "var-demo-furniture-co-demo-lounge-chair-natural";

export const STAGE_PARTNER_SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const FORBIDDEN_LEGACY_PARTNER_TABLES = Object.freeze([
  ...FORBIDDEN_STAGE_CATALOG_TABLES,
]);

const PARTNER_STATUSES: readonly StagePartnerStatus[] = Object.freeze([
  "active",
  "inactive",
]);

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

export function partnerIdForSlug(slug: string): string {
  return `partner-${slug}`;
}

export function isPartnerSlug(value: string): boolean {
  return STAGE_PARTNER_SLUG_SHAPE.test(value);
}

export function namespacedId(kind: "prod" | "var" | "col", partnerSlug: string, rest: string): string {
  return `${kind}-${partnerSlug}-${rest}`;
}

export function partnerCatalogMigrationFileName(
  timestamp: string,
  partnerSlug: string,
  batchKey?: string,
): string {
  const raw = batchKey ?? partnerSlug;
  const slug = raw
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${timestamp}_vibode_stage_partner_catalog_${slug}.sql`;
}

export function partnerCatalogSqlSlug(batchKey: string): string {
  return batchKey
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function isPartnerCatalogSqlForSlug(fileName: string, sqlSlug: string): boolean {
  return new RegExp(`^\\d{14}_vibode_stage_partner_catalog_${sqlSlug}\\.sql$`).test(fileName);
}

export function isPartnerCatalogMigrationFileName(fileName: string): boolean {
  return /^\d{14}_vibode_stage_partner_catalog_[a-z0-9_]+\.sql$/.test(fileName);
}

export function listPartnerCatalogMigrations(repoRoot = process.cwd()): string[] {
  const dir = productRegistrationRepoPaths(repoRoot).migrationsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isPartnerCatalogMigrationFileName(name))
    .sort();
}

export function forbiddenLegacyPartnerTableHits(source: string): string[] {
  return FORBIDDEN_LEGACY_PARTNER_TABLES.filter((table) => {
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${table}(?![A-Za-z0-9_])`);
    return pattern.test(source);
  });
}

function sqlQuotedEquals(sql: string, column: string): string[] {
  const pattern = new RegExp(`${column}\\s*=\\s*'((?:''|[^'])*)'`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    values.push((match[1] ?? "").replace(/''/g, "'"));
  }
  return values;
}

export type ParsedPartnerCatalogSql = Readonly<{
  partnerIds: readonly string[];
  slugs: readonly string[];
  collectionIds: readonly string[];
  productIds: readonly string[];
  variantIds: readonly string[];
  assetIds: readonly string[];
  skus: readonly string[];
  insertsPartner: boolean;
  insertsCollection: boolean;
  insertsProduct: boolean;
  insertsVariant: boolean;
  insertsMembership: boolean;
  updatesProduct: boolean;
  updatesVariant: boolean;
  mutatesAssets: boolean;
  touchesObjectsJson: boolean;
  touchesScenes: boolean;
  usesUpsert: boolean;
  forbiddenTables: readonly string[];
}>;

export function parsePartnerCatalogSql(sql: string): ParsedPartnerCatalogSql {
  const unique = (values: readonly string[]) => [...new Set(values)];
  const body = sql.replace(/--[^\n]*/g, "");
  return {
    partnerIds: unique(sqlQuotedEquals(sql, "partner_id")),
    slugs: unique(sqlQuotedEquals(sql, "slug")),
    collectionIds: unique(sqlQuotedEquals(sql, "collection_id")),
    productIds: unique(sqlQuotedEquals(sql, "product_id")),
    variantIds: unique(sqlQuotedEquals(sql, "variant_id")),
    assetIds: unique([
      ...sqlQuotedEquals(sql, "asset_id"),
      ...sqlQuotedEquals(sql, "current_asset_id"),
    ]),
    skus: unique(sqlQuotedEquals(sql, "sku")),
    insertsPartner: /\binsert\s+into\s+public\.vibode_stage_partners\b/i.test(body),
    insertsCollection: /\binsert\s+into\s+public\.vibode_stage_collections\b/i.test(body),
    insertsProduct: /\binsert\s+into\s+public\.vibode_stage_products\b/i.test(body),
    insertsVariant: /\binsert\s+into\s+public\.vibode_stage_variants\b/i.test(body),
    insertsMembership: /\binsert\s+into\s+public\.vibode_stage_product_collections\b/i.test(body),
    updatesProduct: /\bupdate\s+public\.vibode_stage_products\b/i.test(body),
    updatesVariant: /\bupdate\s+public\.vibode_stage_variants\b/i.test(body),
    mutatesAssets: /\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i.test(body),
    touchesObjectsJson: /objects_json/i.test(body),
    touchesScenes: /vibode_3d_scenes/i.test(body),
    usesUpsert: /\bon\s+conflict\b/i.test(body) || /\bupsert\b/i.test(body),
    forbiddenTables: forbiddenLegacyPartnerTableHits(body),
  };
}

export type ExistingPartnerCatalogState = Readonly<{
  partners: readonly StagePartner[];
  productIds: readonly string[];
  variantIds: readonly string[];
  collectionIds: readonly string[];
  skusByPartnerId: Readonly<Record<string, readonly string[]>>;
}>;

export function emptyExistingPartnerCatalogState(): ExistingPartnerCatalogState {
  return {
    partners: [],
    productIds: [],
    variantIds: [],
    collectionIds: [],
    skusByPartnerId: {},
  };
}

export function loadExistingPartnerCatalogState(
  repoRoot = process.cwd(),
): ExistingPartnerCatalogState {
  const partners = new Map<string, StagePartner>();
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  const collectionIds = new Set<string>();
  const skusByPartnerId: Record<string, string[]> = {};
  const dir = productRegistrationRepoPaths(repoRoot).migrationsDir;
  for (const fileName of listPartnerCatalogMigrations(repoRoot)) {
    const sql = readFileSync(path.join(dir, fileName), "utf8");
    const parsed = parsePartnerCatalogSql(sql);
    const partnerId = parsed.partnerIds[0] ?? null;
    const slug = parsed.slugs[0] ?? null;
    if (partnerId && slug && !partners.has(partnerId)) {
      partners.set(partnerId, {
        partnerId,
        name: partnerId,
        slug,
        status: "active",
        websiteUrl: null,
        logoUrl: null,
      });
    }
    for (const productId of parsed.productIds) productIds.add(productId);
    for (const variantId of parsed.variantIds) variantIds.add(variantId);
    for (const collectionId of parsed.collectionIds) collectionIds.add(collectionId);
    if (partnerId) {
      const skus = skusByPartnerId[partnerId] ?? [];
      for (const sku of parsed.skus) {
        if (!skus.includes(sku)) skus.push(sku);
      }
      skusByPartnerId[partnerId] = skus;
    }
  }
  return {
    partners: [...partners.values()],
    productIds: [...productIds],
    variantIds: [...variantIds],
    collectionIds: [...collectionIds],
    skusByPartnerId,
  };
}

export type PartnerCatalogCollectionInput = Readonly<{
  collectionId: string;
  name: string;
  slug: string;
}>;

export type PartnerCatalogProductInput = Readonly<{
  product: ProductVariantRegistrationInput["product"];
  defaultVariant: ProductVariantRegistrationInput["defaultVariant"];
  variants: readonly AdditionalVariantRegistrationInput["variant"][];
}>;

export type PartnerCatalogDocument = Readonly<{
  partner: StagePartner;
  collections: readonly PartnerCatalogCollectionInput[];
  products: readonly PartnerCatalogProductInput[];
}>;

export type ParsedPartnerCatalog = Readonly<{
  document: PartnerCatalogDocument;
}>;

function parsePartnerBlock(value: unknown, errors: ProductVariantIssue[]): StagePartner | null {
  if (!isPlainObject(value)) {
    errors.push(issue("INVALID_JSON", "partner must be an object."));
    return null;
  }
  const partnerId = asNonEmptyString(value.partnerId);
  const name = asNonEmptyString(value.name);
  const slug = asNonEmptyString(value.slug);
  const status = asNonEmptyString(value.status);
  if (!partnerId) errors.push(issue("INVALID_PARTNER_ID", "partner.partnerId must be a non-empty string."));
  if (!name) errors.push(issue("EMPTY_PARTNER_NAME", "partner.name must be a non-empty string."));
  if (!slug) errors.push(issue("INVALID_PARTNER_SLUG", "partner.slug must be a non-empty string."));
  if (!status || !(PARTNER_STATUSES as readonly string[]).includes(status)) {
    errors.push(issue("INVALID_PARTNER_STATUS", "partner.status must be active or inactive."));
  }
  const websiteUrl = asNullableJsonString(value.websiteUrl);
  if (websiteUrl === undefined) {
    errors.push(issue("INVALID_JSON", "partner.websiteUrl must be a string or null."));
  }
  const logoUrl = asNullableJsonString(value.logoUrl);
  if (logoUrl === undefined) {
    errors.push(issue("INVALID_JSON", "partner.logoUrl must be a string or null."));
  }
  if (errors.length > 0 || !partnerId || !name || !slug || !status) return null;
  return {
    partnerId,
    name,
    slug,
    status: status as StagePartnerStatus,
    websiteUrl: websiteUrl ?? null,
    logoUrl: logoUrl ?? null,
  };
}

function parseCollectionBlock(
  value: unknown,
  index: number,
  errors: ProductVariantIssue[],
): PartnerCatalogCollectionInput | null {
  if (!isPlainObject(value)) {
    errors.push(issue("INVALID_JSON", `collections[${index}] must be an object.`));
    return null;
  }
  const collectionId = asNonEmptyString(value.collectionId);
  const name = asNonEmptyString(value.name);
  const slug = asNonEmptyString(value.slug);
  if (!collectionId) {
    errors.push(issue("INVALID_COLLECTION_ID", `collections[${index}].collectionId must be a non-empty string.`));
  }
  if (!name) errors.push(issue("EMPTY_COLLECTION_NAME", `collections[${index}].name must be a non-empty string.`));
  if (!slug) errors.push(issue("INVALID_COLLECTION_SLUG", `collections[${index}].slug must be a non-empty string.`));
  if (!collectionId || !name || !slug) return null;
  return { collectionId, name, slug };
}

function parseProductBlock(
  value: unknown,
  index: number,
  errors: ProductVariantIssue[],
): PartnerCatalogProductInput | null {
  if (!isPlainObject(value)) {
    errors.push(issue("INVALID_JSON", `products[${index}] must be an object.`));
    return null;
  }
  const parsedProduct = parseProductRegistrationJson({
    product: value.product,
    defaultVariant: value.defaultVariant,
  });
  if (!parsedProduct.ok) {
    for (const item of parsedProduct.errors) {
      errors.push(issue(item.code, `products[${index}]: ${item.message}`));
    }
    return null;
  }
  const variantsRaw = value.variants;
  if (variantsRaw != null && !Array.isArray(variantsRaw)) {
    errors.push(issue("INVALID_JSON", `products[${index}].variants must be an array.`));
    return null;
  }
  const variants: AdditionalVariantRegistrationInput["variant"][] = [];
  for (const [variantIndex, variantRaw] of (variantsRaw ?? []).entries()) {
    const parsedVariant = parseVariantRegistrationJson({
      productId: parsedProduct.input.product.productId,
      variant: variantRaw,
    });
    if (!parsedVariant.ok) {
      for (const item of parsedVariant.errors) {
        errors.push(issue(
          item.code,
          `products[${index}].variants[${variantIndex}]: ${item.message}`,
        ));
      }
      continue;
    }
    variants.push(parsedVariant.input.variant);
  }
  if (errors.length > 0) return null;
  return {
    product: parsedProduct.input.product,
    defaultVariant: parsedProduct.input.defaultVariant,
    variants,
  };
}

export function parsePartnerCatalogJson(value: unknown): Readonly<{
  ok: true;
  document: PartnerCatalogDocument;
  errors: readonly ProductVariantIssue[];
}> | Readonly<{
  ok: false;
  document: null;
  errors: readonly ProductVariantIssue[];
}> {
  const errors: ProductVariantIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      document: null,
      errors: [issue("INVALID_JSON", "Partner catalog JSON must be an object.")],
    };
  }
  const partner = parsePartnerBlock(value.partner, errors);
  if (!Array.isArray(value.collections)) {
    errors.push(issue("INVALID_JSON", "collections must be an array."));
  }
  if (!Array.isArray(value.products)) {
    errors.push(issue("INVALID_JSON", "products must be an array."));
  }
  const collections: PartnerCatalogCollectionInput[] = [];
  if (Array.isArray(value.collections)) {
    for (const [index, raw] of value.collections.entries()) {
      const parsed = parseCollectionBlock(raw, index, errors);
      if (parsed) collections.push(parsed);
    }
  }
  const products: PartnerCatalogProductInput[] = [];
  if (Array.isArray(value.products)) {
    for (const [index, raw] of value.products.entries()) {
      const parsed = parseProductBlock(raw, index, errors);
      if (parsed) products.push(parsed);
    }
  }
  if (errors.length > 0 || !partner) {
    return { ok: false, document: null, errors };
  }
  return {
    ok: true,
    document: {
      partner,
      collections,
      products,
    },
    errors: [],
  };
}

export type PartnerCatalogValidationGates = ProductVariantValidationGates & Readonly<{
  existingPartners?: readonly StagePartner[];
  existingState?: ExistingPartnerCatalogState;
}>;

export type ParsedPartnerCollection = Readonly<{
  collection: StageCollection;
  slug: string;
  sortOrder: number;
}>;

export type ParsedPartnerCatalogProduct = Readonly<{
  product: StageProduct;
  defaultVariant: StageVariant;
  additionalVariants: readonly StageVariant[];
  assetIds: readonly string[];
  collectionSortOrders: readonly Readonly<{
    collectionId: string;
    sortOrder: number;
  }>[];
  productSortOrder: number;
}>;

export type ParsedPartnerCatalogPlan = Readonly<{
  partner: StagePartner;
  insertPartner: boolean;
  collections: readonly ParsedPartnerCollection[];
  products: readonly ParsedPartnerCatalogProduct[];
  currency: string;
}>;

export type PartnerCatalogValidationSuccess = Readonly<{
  ok: true;
  parsed: ParsedPartnerCatalogPlan;
  errors: readonly ProductVariantIssue[];
}>;

export type PartnerCatalogValidationFailure = Readonly<{
  ok: false;
  parsed: null;
  errors: readonly ProductVariantIssue[];
}>;

export type PartnerCatalogValidationResult =
  | PartnerCatalogValidationSuccess
  | PartnerCatalogValidationFailure;

function suffixAfterPrefix(id: string, prefix: string): string | null {
  if (!id.startsWith(prefix)) return null;
  const suffix = id.slice(prefix.length);
  return suffix.length > 0 ? suffix : null;
}

export function validatePartnerIdentity(
  partner: StagePartner,
  existingPartners: readonly StagePartner[],
): ProductVariantIssue[] {
  const errors: ProductVariantIssue[] = [];
  if (!isCommercialId(partner.partnerId) || isUuidLike(partner.partnerId)) {
    errors.push(issue("INVALID_PARTNER_ID", `Invalid Partner ID ${partner.partnerId}.`));
  }
  if (!isPartnerSlug(partner.slug)) {
    errors.push(issue("INVALID_PARTNER_SLUG", `Invalid Partner slug ${partner.slug}.`));
  }
  if (isPartnerSlug(partner.slug) && partner.partnerId !== partnerIdForSlug(partner.slug)) {
    errors.push(issue(
      "PARTNER_ID_SLUG_MISMATCH",
      `Partner ID ${partner.partnerId} does not match slug ${partner.slug}.`,
    ));
  }
  if (partner.websiteUrl && !isAbsoluteHttpsUrl(partner.websiteUrl)) {
    errors.push(issue("INVALID_WEBSITE_URL", "partner.websiteUrl must be an absolute HTTPS URL."));
  }
  if (partner.logoUrl && !isAbsoluteHttpsUrl(partner.logoUrl) && !partner.logoUrl.startsWith("/")) {
    errors.push(issue("INVALID_LOGO_URL", "partner.logoUrl must be HTTPS or a public path."));
  }
  const sameId = existingPartners.find((item) => item.partnerId === partner.partnerId);
  if (sameId && sameId.slug !== partner.slug) {
    errors.push(issue("PARTNER_ID_CONFLICT", `Partner ID ${partner.partnerId} exists with a different slug.`));
  }
  const sameSlug = existingPartners.find((item) => (
    item.slug === partner.slug && item.partnerId !== partner.partnerId
  ));
  if (sameSlug) {
    errors.push(issue("DUPLICATE_PARTNER_SLUG", `Partner slug ${partner.slug} already exists.`));
  }
  return errors;
}

export function validatePartnerCollection(input: Readonly<{
  collection: PartnerCatalogCollectionInput;
  partner: StagePartner;
  existingCollectionIds: readonly string[];
  catalogCollectionIds: readonly string[];
}>): ProductVariantIssue[] {
  const errors: ProductVariantIssue[] = [];
  if (!isCommercialId(input.collection.collectionId) || isUuidLike(input.collection.collectionId)) {
    errors.push(issue("INVALID_COLLECTION_ID", `Invalid Collection ID ${input.collection.collectionId}.`));
  }
  if (!isPartnerSlug(input.collection.slug)) {
    errors.push(issue("INVALID_COLLECTION_SLUG", `Invalid Collection slug ${input.collection.slug}.`));
  }
  const expected = namespacedId("col", input.partner.slug, input.collection.slug);
  if (input.collection.collectionId !== expected) {
    errors.push(issue(
      "COLLECTION_NAMESPACE_MISMATCH",
      `Collection ID ${input.collection.collectionId} must be ${expected}.`,
    ));
  }
  if (
    input.existingCollectionIds.includes(input.collection.collectionId) ||
    input.catalogCollectionIds.includes(input.collection.collectionId)
  ) {
    errors.push(issue(
      "DUPLICATE_COLLECTION_ID",
      `Collection ${input.collection.collectionId} already exists.`,
    ));
  }
  return errors;
}

function mergeExistingState(
  gates: PartnerCatalogValidationGates,
  repoRoot: string,
): ExistingPartnerCatalogState {
  const loaded = gates.existingState ?? loadExistingPartnerCatalogState(repoRoot);
  const partners = [
    ...loaded.partners,
    ...(gates.existingPartners ?? []).filter((partner) => (
      !loaded.partners.some((item) => item.partnerId === partner.partnerId)
    )),
  ];
  return { ...loaded, partners };
}

function overlayExistingIdentities(
  catalog: StageCatalogSnapshot,
  existing: ExistingPartnerCatalogState,
  partner: StagePartner,
): StageCatalogSnapshot {
  const products = [...catalog.products];
  const variants = [...catalog.variants];
  const collections = [...catalog.collections];
  const partners = [
    ...catalog.partners,
    ...existing.partners.filter((item) => (
      !catalog.partners.some((partnerRow) => partnerRow.partnerId === item.partnerId)
    )),
  ];
  for (const collectionId of existing.collectionIds) {
    if (collections.some((item) => item.collectionId === collectionId)) continue;
    collections.push({
      collectionId,
      name: collectionId,
      owner: "partner",
      partnerName: partner.name,
      partnerId: partner.partnerId,
      productIds: [],
    });
  }
  for (const [index, productId] of existing.productIds.entries()) {
    if (products.some((item) => item.productId === productId)) continue;
    const ownerPartner = existing.partners[0] ?? partner;
    products.push({
      productId,
      brand: ownerPartner.name,
      name: productId,
      retailer: ownerPartner.name,
      categoryId: "living-room",
      subcategoryId: null,
      productUrl: "https://example.test/existing",
      imageUrl: "https://example.test/existing.jpg",
      priceAmount: 1,
      priceCurrency: "USD",
      defaultVariantId: `${productId}-default`,
      collectionIds: [],
      source: "partner_catalog",
      partnerId: ownerPartner.partnerId,
    });
    const sku = (existing.skusByPartnerId[ownerPartner.partnerId] ?? [])[index] ?? null;
    variants.push({
      variantId: existing.variantIds[index] ?? `${productId}-default`,
      productId,
      assetId: null,
      finishLabel: null,
      sku,
      priceAmount: 1,
      priceCurrency: "USD",
      productUrl: null,
    });
  }
  for (const [partnerId, skus] of Object.entries(existing.skusByPartnerId)) {
    const owner = products.find((item) => item.partnerId === partnerId);
    if (!owner) continue;
    for (const [skuIndex, sku] of skus.entries()) {
      if (variants.some((item) => item.sku === sku && item.productId === owner.productId)) continue;
      variants.push({
        variantId: `var-existing-sku-${partnerId}-${skuIndex}`,
        productId: owner.productId,
        assetId: null,
        finishLabel: null,
        sku,
        priceAmount: 1,
        priceCurrency: "USD",
        productUrl: null,
      });
    }
  }
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    products,
    variants,
    assets: catalog.assets,
    collections,
    partners,
  });
}

function replaceCollection(
  catalog: StageCatalogSnapshot,
  collection: StageCollection,
): StageCatalogSnapshot {
  const collections = catalog.collections.some((item) => item.collectionId === collection.collectionId)
    ? catalog.collections.map((item) => (
      item.collectionId === collection.collectionId ? collection : item
    ))
    : [...catalog.collections, collection];
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    products: catalog.products,
    variants: catalog.variants,
    assets: catalog.assets,
    collections,
    partners: catalog.partners,
  });
}

function appendProduct(
  catalog: StageCatalogSnapshot,
  product: StageProduct,
  variants: readonly StageVariant[],
): StageCatalogSnapshot {
  const collections = catalog.collections.map((collection) => {
    if (!product.collectionIds.includes(collection.collectionId)) return collection;
    if (collection.productIds.includes(product.productId)) return collection;
    return {
      ...collection,
      productIds: Object.freeze([...collection.productIds, product.productId]),
    };
  });
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    products: [...catalog.products, product],
    variants: [...catalog.variants, ...variants],
    assets: catalog.assets,
    collections,
    partners: catalog.partners,
  });
}

function appendVariants(
  catalog: StageCatalogSnapshot,
  variants: readonly StageVariant[],
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    products: catalog.products,
    variants: [...catalog.variants, ...variants],
    assets: catalog.assets,
    collections: catalog.collections,
    partners: catalog.partners,
  });
}

export function validatePartnerCatalog(
  document: PartnerCatalogDocument,
  gates: PartnerCatalogValidationGates = {},
): PartnerCatalogValidationResult {
  const errors: ProductVariantIssue[] = [];
  const repoRoot = gates.repoRoot ?? process.cwd();
  const existing = mergeExistingState(gates, repoRoot);
  const partner = document.partner;

  errors.push(...validatePartnerIdentity(partner, existing.partners));
  if (partner.status !== "active") {
    errors.push(issue("PARTNER_INACTIVE", "Partner catalog import requires an active Partner."));
  }

  let working = overlayExistingIdentities(
    gates.catalog ?? STAGE_SEED_CATALOG,
    existing,
    partner,
  );
  if (!working.partners.some((item) => item.partnerId === partner.partnerId)) {
    working = createStageCatalogSnapshot({
      ...working,
      partners: [...working.partners, partner],
    });
  }

  const parsedCollections: ParsedPartnerCollection[] = [];
  const seenCollectionIds = new Set<string>();
  for (const collectionInput of document.collections) {
    errors.push(...validatePartnerCollection({
      collection: collectionInput,
      partner,
      existingCollectionIds: existing.collectionIds,
      catalogCollectionIds: working.collections.map((item) => item.collectionId),
    }));
    if (seenCollectionIds.has(collectionInput.collectionId)) {
      errors.push(issue(
        "DUPLICATE_COLLECTION_ID",
        `Collection ${collectionInput.collectionId} is duplicated in this catalog.`,
      ));
    }
    seenCollectionIds.add(collectionInput.collectionId);
    const collection: StageCollection = {
      collectionId: collectionInput.collectionId,
      name: collectionInput.name,
      owner: "partner",
      partnerName: partner.name,
      partnerId: partner.partnerId,
      productIds: [],
    };
    parsedCollections.push({
      collection,
      slug: collectionInput.slug,
      sortOrder: working.collections.length + parsedCollections.length,
    });
    working = replaceCollection(working, collection);
  }

  const currencies = new Set<string>();
  const parsedProducts: ParsedPartnerCatalogProduct[] = [];
  for (const [productIndex, productInput] of document.products.entries()) {
    const productIn = productInput.product;
    const productSlug = suffixAfterPrefix(productIn.productId, `prod-${partner.slug}-`);
    if (!isCommercialId(productIn.productId)) {
      errors.push(issue("INVALID_PRODUCT_ID", `Invalid Product ID ${productIn.productId}.`));
    } else if (!productSlug) {
      errors.push(issue(
        "PRODUCT_NAMESPACE_MISMATCH",
        `Product ${productIn.productId} is not in Partner ${partner.slug} namespace.`,
      ));
    }
    if (productIn.source !== "partner_catalog") {
      errors.push(issue(
        "INVALID_SOURCE",
        `Partner catalog Product ${productIn.productId} must use source partner_catalog.`,
      ));
    }
    if (productIn.partnerId !== partner.partnerId) {
      errors.push(issue(
        "PRODUCT_PARTNER_MISMATCH",
        `Product ${productIn.productId} partnerId does not match the catalog Partner.`,
      ));
    }
    if (productIn.brand !== partner.name || productIn.retailer !== partner.name) {
      errors.push(issue(
        "PARTNER_NAME_MISMATCH",
        `Product ${productIn.productId} brand/retailer must match Partner name.`,
      ));
    }
    const defaultPrefix = productSlug ? `var-${partner.slug}-${productSlug}-` : null;
    if (defaultPrefix && !productInput.defaultVariant.variantId.startsWith(defaultPrefix)) {
      errors.push(issue(
        "VARIANT_NAMESPACE_MISMATCH",
        `Variant ${productInput.defaultVariant.variantId} is not in Product ${productIn.productId} namespace.`,
      ));
    }
    for (const extra of productInput.variants) {
      if (defaultPrefix && !extra.variantId.startsWith(defaultPrefix)) {
        errors.push(issue(
          "VARIANT_NAMESPACE_MISMATCH",
          `Variant ${extra.variantId} is not in Product ${productIn.productId} namespace.`,
        ));
      }
    }

    const registration = validateProductVariantRegistration({
      product: productIn,
      defaultVariant: productInput.defaultVariant,
    }, { ...gates, catalog: working, repoRoot });
    if (!registration.ok) {
      for (const item of registration.errors) {
        errors.push(issue(item.code, `products[${productIndex}]: ${item.message}`));
      }
      continue;
    }

    currencies.add(registration.parsed.product.priceCurrency);
    currencies.add(registration.parsed.variant.priceCurrency);

    let productWorking = appendProduct(
      working,
      registration.parsed.product,
      [registration.parsed.variant],
    );
    const additionalVariants: StageVariant[] = [];
    for (const [variantIndex, extra] of productInput.variants.entries()) {
      const extraValidation = validateVariantRegistration({
        productId: registration.parsed.product.productId,
        variant: extra,
      }, { ...gates, catalog: productWorking, repoRoot });
      if (!extraValidation.ok) {
        for (const item of extraValidation.errors) {
          errors.push(issue(
            item.code,
            `products[${productIndex}].variants[${variantIndex}]: ${item.message}`,
          ));
        }
        continue;
      }
      if (extraValidation.parsed.variant.priceCurrency !== registration.parsed.product.priceCurrency) {
        errors.push(issue(
          "CATALOG_CURRENCY_MISMATCH",
          `Variant ${extra.variantId} currency must match the partner catalog currency.`,
        ));
      }
      currencies.add(extraValidation.parsed.variant.priceCurrency);
      additionalVariants.push(extraValidation.parsed.variant);
      productWorking = appendVariants(productWorking, [extraValidation.parsed.variant]);
    }

    parsedProducts.push({
      product: registration.parsed.product,
      defaultVariant: registration.parsed.variant,
      additionalVariants,
      assetIds: Object.freeze([
        registration.parsed.assetId,
        ...additionalVariants.map((variant) => variant.assetId).filter((id): id is string => !!id),
      ]),
      collectionSortOrders: registration.parsed.collectionSortOrders,
      productSortOrder: registration.parsed.sortOrder,
    });
    working = productWorking;
  }

  if (document.products.length === 0) {
    errors.push(issue("EMPTY_CATALOG", "Partner catalog must include at least one Product."));
  }
  if (currencies.size > 1) {
    errors.push(issue(
      "CATALOG_CURRENCY_MISMATCH",
      "A partner catalog must use one currency across Products and Variants.",
    ));
  }

  for (const parsedCollection of parsedCollections) {
    const members = parsedProducts.filter((item) => (
      item.product.collectionIds.includes(parsedCollection.collection.collectionId)
    ));
    if (members.length === 0) {
      errors.push(issue(
        "EMPTY_COLLECTION",
        `Collection ${parsedCollection.collection.collectionId} has no Products.`,
      ));
    }
    for (const member of members) {
      if (
        member.product.source !== "partner_catalog" ||
        member.product.partnerId !== partner.partnerId
      ) {
        errors.push(issue(
          "COLLECTION_OWNER_MISMATCH",
          `Collection ${parsedCollection.collection.collectionId} cannot include ${member.product.productId}.`,
        ));
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, parsed: null, errors };
  }

  const insertPartner = !existing.partners.some((item) => (
    item.partnerId === partner.partnerId && item.slug === partner.slug
  ));

  return {
    ok: true,
    parsed: {
      partner,
      insertPartner,
      collections: parsedCollections,
      products: parsedProducts,
      currency: [...currencies][0] ?? "USD",
    },
    errors: [],
  };
}

export type PartnerCatalogWritePlan = Readonly<{
  migration: string;
  sql: string;
  productCount: number;
  variantCount: number;
  collectionCount: number;
  membershipCount: number;
}>;

export function renderPartnerCatalogInsertSql(parsed: ParsedPartnerCatalogPlan): string {
  const assetIds = [...new Set(parsed.products.flatMap((item) => item.assetIds))];
  const productIds = parsed.products.map((item) => item.product.productId);
  const variantIds = parsed.products.flatMap((item) => [
    item.defaultVariant.variantId,
    ...item.additionalVariants.map((variant) => variant.variantId),
  ]);
  const skus = parsed.products.flatMap((item) => (
    [item.defaultVariant, ...item.additionalVariants]
      .map((variant) => variant.sku)
      .filter((sku): sku is string => !!sku)
  ));

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
  const productGuards = productIds.map((productId) => (
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_products\n` +
    `    where product_id = ${sqlString(productId)}\n` +
    `  ) then\n` +
    `    raise exception 'Product already exists';\n` +
    `  end if;`
  ));
  const variantGuards = variantIds.map((variantId) => (
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_variants\n` +
    `    where variant_id = ${sqlString(variantId)}\n` +
    `  ) then\n` +
    `    raise exception 'Variant already exists';\n` +
    `  end if;`
  ));
  const collectionGuards = parsed.collections.map((item) => (
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_collections\n` +
    `    where collection_id = ${sqlString(item.collection.collectionId)}\n` +
    `  ) then\n` +
    `    raise exception 'Collection already exists';\n` +
    `  end if;`
  ));
  const skuGuards = skus.map((sku) => (
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_variants variants\n` +
    `    join public.vibode_stage_products products\n` +
    `      on products.product_id = variants.product_id\n` +
    `    where variants.sku = ${sqlString(sku)}\n` +
    `      and products.partner_id = ${sqlString(parsed.partner.partnerId)}\n` +
    `  ) then\n` +
    `    raise exception 'SKU already exists for partner';\n` +
    `  end if;`
  ));

  const partnerInsert = parsed.insertPartner
    ? (
      `insert into public.vibode_stage_partners (\n` +
      `  partner_id,\n` +
      `  name,\n` +
      `  slug,\n` +
      `  status,\n` +
      `  website_url,\n` +
      `  logo_url\n` +
      `)\n` +
      `select\n` +
      `  ${sqlString(parsed.partner.partnerId)},\n` +
      `  ${sqlString(parsed.partner.name)},\n` +
      `  ${sqlString(parsed.partner.slug)},\n` +
      `  ${sqlString(parsed.partner.status)},\n` +
      `  ${sqlNullableString(parsed.partner.websiteUrl)},\n` +
      `  ${sqlNullableString(parsed.partner.logoUrl)}\n` +
      `where not exists (\n` +
      `  select 1\n` +
      `  from public.vibode_stage_partners\n` +
      `  where partner_id = ${sqlString(parsed.partner.partnerId)}\n` +
      `);\n`
    )
    : (
      `-- Partner ${parsed.partner.partnerId} already exists with matching identity.\n`
    );

  const collectionInserts = parsed.collections.map((item) => (
    `insert into public.vibode_stage_collections (\n` +
    `  collection_id,\n` +
    `  name,\n` +
    `  owner,\n` +
    `  partner_name,\n` +
    `  partner_id,\n` +
    `  status,\n` +
    `  sort_order\n` +
    `) values (\n` +
    `  ${sqlString(item.collection.collectionId)},\n` +
    `  ${sqlString(item.collection.name)},\n` +
    `  'partner',\n` +
    `  ${sqlString(parsed.partner.name)},\n` +
    `  ${sqlString(parsed.partner.partnerId)},\n` +
    `  'active',\n` +
    `  ${sqlNumber(item.sortOrder)}\n` +
    `);`
  ));

  const productInserts = parsed.products.map((item) => (
    `insert into public.vibode_stage_products (\n` +
    `  product_id,\n` +
    `  name,\n` +
    `  brand,\n` +
    `  retailer,\n` +
    `  image_url,\n` +
    `  product_url,\n` +
    `  price_amount,\n` +
    `  price_currency,\n` +
    `  category_id,\n` +
    `  subcategory_id,\n` +
    `  source,\n` +
    `  partner_id,\n` +
    `  default_variant_id,\n` +
    `  status,\n` +
    `  sort_order\n` +
    `) values (\n` +
    `  ${sqlString(item.product.productId)},\n` +
    `  ${sqlString(item.product.name)},\n` +
    `  ${sqlString(item.product.brand)},\n` +
    `  ${sqlString(item.product.retailer)},\n` +
    `  ${sqlString(item.product.imageUrl)},\n` +
    `  ${sqlNullableString(item.product.productUrl)},\n` +
    `  ${sqlNumber(item.product.priceAmount ?? 0)},\n` +
    `  ${sqlString(item.product.priceCurrency)},\n` +
    `  ${sqlString(item.product.categoryId)},\n` +
    `  ${sqlNullableString(item.product.subcategoryId)},\n` +
    `  'partner_catalog',\n` +
    `  ${sqlString(parsed.partner.partnerId)},\n` +
    `  ${sqlString(item.product.defaultVariantId)},\n` +
    `  'active',\n` +
    `  ${sqlNumber(item.productSortOrder)}\n` +
    `);`
  ));

  const variantInsert = (variant: StageVariant) => (
    `  (\n` +
    `    ${sqlString(variant.variantId)},\n` +
    `    ${sqlString(variant.productId)},\n` +
    `    ${sqlString(variant.assetId ?? "")},\n` +
    `    ${sqlNullableString(variant.finishLabel)},\n` +
    `    ${sqlNullableString(variant.sku)},\n` +
    `    ${sqlNumber(variant.priceAmount ?? 0)},\n` +
    `    ${sqlString(variant.priceCurrency)},\n` +
    `    ${sqlNullableString(variant.productUrl)}\n` +
    `  )`
  );
  const allVariants = parsed.products.flatMap((item) => [
    item.defaultVariant,
    ...item.additionalVariants,
  ]);
  const variantInsertSql = (
    `insert into public.vibode_stage_variants (\n` +
    `  variant_id,\n` +
    `  product_id,\n` +
    `  current_asset_id,\n` +
    `  finish_label,\n` +
    `  sku,\n` +
    `  price_amount,\n` +
    `  price_currency,\n` +
    `  product_url\n` +
    `) values\n` +
    `${allVariants.map(variantInsert).join(",\n")};`
  );

  const memberships = parsed.products.flatMap((item) => (
    item.collectionSortOrders.map((membership) => (
      `  (\n` +
      `    ${sqlString(item.product.productId)},\n` +
      `    ${sqlString(membership.collectionId)},\n` +
      `    ${sqlNumber(membership.sortOrder)}\n` +
      `  )`
    ))
  ));
  const membershipSql = memberships.length === 0
    ? ""
    : (
      `insert into public.vibode_stage_product_collections (\n` +
      `  product_id,\n` +
      `  collection_id,\n` +
      `  sort_order\n` +
      `) values\n` +
      `${memberships.join(",\n")};\n`
    );

  return (
    `-- PI-5F1: Partner catalog batch import.\n` +
    `--\n` +
    `-- Inserts one Partner (if absent), partner Collections, Products,\n` +
    `-- default Variants, additional Variants, and memberships.\n` +
    `-- Does not mutate technical Asset rows.\n` +
    `-- Does not rewrite Scene Objects.\n` +
    `-- Does not retarget existing Variants.\n` +
    `-- Does not write curated commercial seed or association maps.\n` +
    `\n` +
    `begin;\n` +
    `\n` +
    `set constraints public.vibode_stage_products_default_variant_fkey deferred;\n` +
    `\n` +
    `do $$\n` +
    `begin\n` +
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_partners\n` +
    `    where partner_id = ${sqlString(parsed.partner.partnerId)}\n` +
    `      and slug is distinct from ${sqlString(parsed.partner.slug)}\n` +
    `  ) then\n` +
    `    raise exception 'PARTNER_ID_CONFLICT';\n` +
    `  end if;\n` +
    `\n` +
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_partners\n` +
    `    where slug = ${sqlString(parsed.partner.slug)}\n` +
    `      and partner_id is distinct from ${sqlString(parsed.partner.partnerId)}\n` +
    `  ) then\n` +
    `    raise exception 'PARTNER_SLUG_CONFLICT';\n` +
    `  end if;\n` +
    `${collectionGuards.length ? `\n${collectionGuards.join("\n\n")}\n` : ""}` +
    `${assetGuards.length ? `\n${assetGuards.join("\n\n")}\n` : ""}` +
    `${productGuards.length ? `\n${productGuards.join("\n\n")}\n` : ""}` +
    `${variantGuards.length ? `\n${variantGuards.join("\n\n")}\n` : ""}` +
    `${skuGuards.length ? `\n${skuGuards.join("\n\n")}\n` : ""}` +
    `end $$;\n` +
    `\n` +
    partnerInsert +
    `\n` +
    (collectionInserts.length > 0 ? `${collectionInserts.join("\n\n")}\n\n` : "") +
    (productInserts.length > 0 ? `${productInserts.join("\n\n")}\n\n` : "") +
    variantInsertSql +
    `\n` +
    (membershipSql ? `\n${membershipSql}` : "") +
    `\n` +
    `commit;\n`
  );
}

export function planPartnerCatalogImport(input: Readonly<{
  parsed: ParsedPartnerCatalogPlan;
  repoRoot?: string;
  migrationTimestamp?: string;
  batchKey?: string;
}>): PartnerCatalogWritePlan {
  const repoRoot = input.repoRoot ?? process.cwd();
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  const migration = path.join(
    productRegistrationRepoPaths(repoRoot).migrationsDir,
    partnerCatalogMigrationFileName(
      timestamp,
      input.parsed.partner.slug,
      input.batchKey,
    ),
  );
  const variantCount = input.parsed.products.reduce((sum, item) => (
    sum + 1 + item.additionalVariants.length
  ), 0);
  const membershipCount = input.parsed.products.reduce((sum, item) => (
    sum + item.collectionSortOrders.length
  ), 0);
  return {
    migration,
    sql: renderPartnerCatalogInsertSql(input.parsed),
    productCount: input.parsed.products.length,
    variantCount,
    collectionCount: input.parsed.collections.length,
    membershipCount,
  };
}

export function writePartnerCatalogImportPlan(plan: PartnerCatalogWritePlan): void {
  writeFileAtomic(plan.migration, plan.sql);
}

export type PartnerCatalogImportSuccess = Readonly<{
  ok: true;
  check: boolean;
  partnerId: string;
  errors: readonly ProductVariantIssue[];
  written: Readonly<{ migration: string }> | null;
  plan: PartnerCatalogWritePlan;
  productCount: number;
  variantCount: number;
  collectionCount: number;
}>;

export type PartnerCatalogImportFailure = Readonly<{
  ok: false;
  check: boolean;
  written: null;
  plan: null;
  errors: readonly ProductVariantIssue[];
}>;

export type PartnerCatalogImportResult =
  | PartnerCatalogImportSuccess
  | PartnerCatalogImportFailure;

export function importPartnerCatalog(input: Readonly<{
  document: PartnerCatalogDocument;
  repoRoot?: string;
  check?: boolean;
  migrationTimestamp?: string;
  batchKey?: string;
  catalog?: StageCatalogSnapshot;
  existingPartners?: readonly StagePartner[];
  existingState?: ExistingPartnerCatalogState;
  currentGeneratedProducts?: readonly StageProduct[];
  currentGeneratedVariants?: readonly GeneratedRegisteredVariant[];
}> & ProductVariantValidationGates): PartnerCatalogImportResult {
  const check = input.check === true;
  const validation = validatePartnerCatalog(input.document, input);
  if (!validation.ok) {
    return { ok: false, check, written: null, plan: null, errors: validation.errors };
  }
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    return {
      ok: false,
      check,
      written: null,
      plan: null,
      errors: [issue("INVALID_TIMESTAMP", "migration timestamp must be YYYYMMDDHHMMSS.")],
    };
  }
  const plan = planPartnerCatalogImport({
    parsed: validation.parsed,
    repoRoot: input.repoRoot,
    migrationTimestamp: timestamp,
    batchKey: input.batchKey,
  });
  if (check) {
    return {
      ok: true,
      check: true,
      partnerId: validation.parsed.partner.partnerId,
      errors: [],
      written: null,
      plan,
      productCount: plan.productCount,
      variantCount: plan.variantCount,
      collectionCount: plan.collectionCount,
    };
  }
  if (existsSync(plan.migration)) {
    return {
      ok: false,
      check,
      written: null,
      plan: null,
      errors: [issue("MIGRATION_EXISTS", `Partner catalog migration already exists: ${plan.migration}`)],
    };
  }
  try {
    writePartnerCatalogImportPlan(plan);
  } catch (error) {
    return {
      ok: false,
      check,
      written: null,
      plan: null,
      errors: [issue(
        "WRITE_FAILED",
        error instanceof Error ? error.message : "Unable to write partner catalog SQL.",
      )],
    };
  }
  return {
    ok: true,
    check: false,
    partnerId: validation.parsed.partner.partnerId,
    errors: [],
    written: { migration: plan.migration },
    plan,
    productCount: plan.productCount,
    variantCount: plan.variantCount,
    collectionCount: plan.collectionCount,
  };
}
