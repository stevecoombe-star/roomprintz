/**
 * PI-5E1 deterministic Product + default Variant registration, and
 * PI-5E2 additional Variant registration for an existing Product.
 *
 * Node-only. Validates commercial identity, then appends generated
 * commercial seed, Variant→Asset association, and a guarded SQL
 * migration. Does not mutate Assets, Scene Objects, or Product defaults.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import {
  findManifestAsset,
  loadFurnitureAssetManifest,
} from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import type { CanonicalFurnitureAssetManifest } from "@/lib/afc-v2-runtime/furniture-asset-manifest-types";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";

import {
  STAGE_BROWSE_CATEGORIES,
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
} from "./catalog";
import type { GeneratedRegisteredVariant } from "./catalog-commercial.generated";
import {
  GENERATED_REGISTERED_PRODUCTS,
  GENERATED_REGISTERED_VARIANTS,
} from "./catalog-commercial.generated";
import type {
  StageAsset,
  StageCatalogSnapshot,
  StageProduct,
  StageProductSource,
  StageVariant,
} from "./types";
import {
  renderGeneratedVariantCurrentAssetMap,
  sortVariantAssociations,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
  variantIdMigrationSlug,
  type VariantCurrentAssetAssociation,
} from "./variant-asset-association";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

export const COMMERCIAL_SEED_RELATIVE_PATH =
  "lib/vibode-stage/catalog-commercial.generated.ts";

export const STAGE_COMMERCIAL_ID_SHAPE =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_SOURCES: readonly StageProductSource[] = Object.freeze([
  "vibode_curated",
  "partner_catalog",
  "user_pasted",
]);

export type ProductVariantIssue = Readonly<{
  code: string;
  message: string;
}>;

export type ProductVariantRegistrationInput = Readonly<{
  product: Readonly<{
    productId: string;
    name: string;
    brand: string;
    retailer: string;
    categoryId: string;
    subcategoryId: string | null;
    imageUrl: string;
    productUrl: string | null;
    priceAmount: number;
    priceCurrency: string;
    source: StageProductSource;
    collectionIds: readonly string[];
  }>;
  defaultVariant: Readonly<{
    variantId: string;
    finishLabel: string | null;
    sku: string | null;
    priceAmount: number;
    priceCurrency: string;
    productUrl: string | null;
    currentAssetId: string;
  }>;
}>;

export type ParsedProductVariantRegistration = Readonly<{
  product: StageProduct;
  variant: StageVariant;
  assetId: string;
  collectionIds: readonly string[];
  sortOrder: number;
  collectionSortOrders: readonly Readonly<{
    collectionId: string;
    sortOrder: number;
  }>[];
}>;

export type ProductVariantValidationSuccess = Readonly<{
  ok: true;
  parsed: ParsedProductVariantRegistration;
  errors: readonly ProductVariantIssue[];
}>;

export type ProductVariantValidationFailure = Readonly<{
  ok: false;
  parsed: null;
  errors: readonly ProductVariantIssue[];
}>;

export type ProductVariantValidationResult =
  | ProductVariantValidationSuccess
  | ProductVariantValidationFailure;

export type ProductVariantWritePlan = Readonly<{
  commercialSeed: string;
  generatedMap: string;
  migration: string;
  sql: string;
  commercialSource: string;
  mapSource: string;
}>;

export type ProductVariantRegisterSuccess = Readonly<{
  ok: true;
  check: boolean;
  productId: string;
  variantId: string;
  assetId: string;
  errors: readonly ProductVariantIssue[];
  written: Readonly<{
    commercialSeed: string;
    generatedMap: string;
    migration: string;
  }> | null;
  plan: ProductVariantWritePlan | null;
}>;

export type ProductVariantRegisterFailure = Readonly<{
  ok: false;
  check: boolean;
  written: null;
  plan: null;
  errors: readonly ProductVariantIssue[];
}>;

export type ProductVariantRegisterResult =
  | ProductVariantRegisterSuccess
  | ProductVariantRegisterFailure;

export type ProductVariantValidationGates = Readonly<{
  catalog?: StageCatalogSnapshot;
  seedAssets?: readonly StageAsset[];
  manifest?: CanonicalFurnitureAssetManifest;
  repoRoot?: string;
  manifestRepoRoot?: string;
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
  currentGeneratedProducts?: readonly StageProduct[];
  currentGeneratedVariants?: readonly GeneratedRegisteredVariant[];
}>;

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

function tsNullableString(value: string | null): string {
  return value == null ? "null" : JSON.stringify(value);
}

function tsNullableNumber(value: number | null): string {
  return value == null ? "null" : JSON.stringify(value);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableString(value: string | null): string {
  return value == null ? "null" : sqlString(value);
}

function sqlNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function utcTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}`
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableJsonString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function isValidCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function isUuidLike(value: string): boolean {
  return UUID_SHAPE.test(value);
}

function isSameOriginPublicPath(imageUrl: string): boolean {
  if (
    imageUrl.includes("..") ||
    imageUrl.includes("://") ||
    imageUrl.includes("//") ||
    !imageUrl.startsWith("/")
  ) {
    return false;
  }
  return /^\/[A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+$/.test(imageUrl);
}

export function publicFilePathFromImageUrl(repoRoot: string, imageUrl: string): string {
  return path.join(repoRoot, "public", imageUrl.replace(/^\//, ""));
}

export function productRegistrationRepoPaths(repoRoot = process.cwd()) {
  return {
    repoRoot,
    commercialSeed: path.join(repoRoot, COMMERCIAL_SEED_RELATIVE_PATH),
    generatedMap: path.join(repoRoot, VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    migrationsDir: path.join(repoRoot, "supabase/migrations"),
  };
}

export function productIdMigrationSlug(productId: string): string {
  return productId
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^prod_vibode_/i, "")
    .replace(/^prod_/i, "")
    .toLowerCase();
}

export function productRegistrationMigrationFileName(
  timestamp: string,
  productId: string,
): string {
  return `${timestamp}_vibode_stage_product_${productIdMigrationSlug(productId)}.sql`;
}

export function isProductRegistrationMigrationFileName(fileName: string): boolean {
  return /^\d{14}_vibode_stage_product_[a-z0-9_]+\.sql$/.test(fileName);
}

export function listProductRegistrationMigrations(repoRoot = process.cwd()): string[] {
  const dir = productRegistrationRepoPaths(repoRoot).migrationsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isProductRegistrationMigrationFileName(name))
    .sort();
}

export function parseProductRegistrationJson(
  value: unknown,
): Readonly<{ ok: true; input: ProductVariantRegistrationInput }> | Readonly<{
  ok: false;
  errors: readonly ProductVariantIssue[];
}> {
  const errors: ProductVariantIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      errors: [issue("INVALID_JSON", "Product registration JSON must be an object.")],
    };
  }
  const productRaw = value.product;
  const variantRaw = value.defaultVariant;
  if (!isPlainObject(productRaw)) {
    errors.push(issue("INVALID_JSON", "product must be an object."));
  }
  if (!isPlainObject(variantRaw)) {
    errors.push(issue("INVALID_JSON", "defaultVariant must be an object."));
  }
  if (errors.length > 0 || !isPlainObject(productRaw) || !isPlainObject(variantRaw)) {
    return { ok: false, errors };
  }

  const productId = asNonEmptyString(productRaw.productId);
  const name = asNonEmptyString(productRaw.name);
  const brand = asNonEmptyString(productRaw.brand);
  const retailer = asNonEmptyString(productRaw.retailer);
  const categoryId = asNonEmptyString(productRaw.categoryId);
  const imageUrl = asNonEmptyString(productRaw.imageUrl);
  const source = asNonEmptyString(productRaw.source);
  const priceAmount = asFiniteNumber(productRaw.priceAmount);
  const priceCurrency = asNonEmptyString(productRaw.priceCurrency);
  const variantId = asNonEmptyString(variantRaw.variantId);
  const variantPriceAmount = asFiniteNumber(variantRaw.priceAmount);
  const variantPriceCurrency = asNonEmptyString(variantRaw.priceCurrency);
  const currentAssetId = asNonEmptyString(variantRaw.currentAssetId);

  if (!productId) errors.push(issue("INVALID_PRODUCT_ID", "product.productId must be a non-empty string."));
  if (!name) errors.push(issue("EMPTY_NAME", "product.name must be a non-empty string."));
  if (!brand) errors.push(issue("EMPTY_BRAND", "product.brand must be a non-empty string."));
  if (!retailer) errors.push(issue("EMPTY_RETAILER", "product.retailer must be a non-empty string."));
  if (!categoryId) errors.push(issue("UNKNOWN_CATEGORY", "product.categoryId must be a non-empty string."));
  if (!imageUrl) errors.push(issue("INVALID_IMAGE_URL", "product.imageUrl must be a non-empty string."));
  if (priceAmount == null) {
    errors.push(issue("INVALID_PRICE", "product.priceAmount must be a finite number."));
  }
  if (!priceCurrency) errors.push(issue("INVALID_CURRENCY", "product.priceCurrency must be a non-empty string."));
  if (!source || !(ALLOWED_SOURCES as readonly string[]).includes(source)) {
    errors.push(issue("INVALID_SOURCE", "product.source is not an allowed source."));
  }
  if (!Array.isArray(productRaw.collectionIds) ||
    productRaw.collectionIds.some((id) => typeof id !== "string" || id.trim() === "")
  ) {
    errors.push(issue("UNKNOWN_COLLECTION", "product.collectionIds must be an array of strings."));
  }
  const subcategoryRaw = productRaw.subcategoryId;
  if (subcategoryRaw != null && typeof subcategoryRaw !== "string") {
    errors.push(issue("UNKNOWN_SUBCATEGORY", "product.subcategoryId must be a string or null."));
  }
  const productUrl = asNullableJsonString(productRaw.productUrl);
  if (productUrl === undefined) {
    errors.push(issue("INVALID_JSON", "product.productUrl must be a string or null."));
  }
  if (!variantId) errors.push(issue("INVALID_VARIANT_ID", "defaultVariant.variantId must be a non-empty string."));
  if (variantPriceAmount == null) {
    errors.push(issue("INVALID_PRICE", "defaultVariant.priceAmount must be a finite number."));
  }
  if (!variantPriceCurrency) {
    errors.push(issue("INVALID_CURRENCY", "defaultVariant.priceCurrency must be a non-empty string."));
  }
  if (!currentAssetId) {
    errors.push(issue("UNKNOWN_ASSET", "defaultVariant.currentAssetId must be a non-empty string."));
  }
  const finishLabel = asNullableJsonString(variantRaw.finishLabel);
  if (finishLabel === undefined) {
    errors.push(issue("INVALID_JSON", "defaultVariant.finishLabel must be a string or null."));
  }
  const sku = asNullableJsonString(variantRaw.sku);
  if (sku === undefined) {
    errors.push(issue("INVALID_JSON", "defaultVariant.sku must be a string or null."));
  }
  const variantProductUrl = asNullableJsonString(variantRaw.productUrl);
  if (variantProductUrl === undefined) {
    errors.push(issue("INVALID_JSON", "defaultVariant.productUrl must be a string or null."));
  }

  if (errors.length > 0) return { ok: false, errors };

  const subcategoryId = typeof subcategoryRaw === "string"
    ? (subcategoryRaw.trim() === "" ? null : subcategoryRaw.trim())
    : null;

  return {
    ok: true,
    input: {
      product: {
        productId: productId!,
        name: name!,
        brand: brand!,
        retailer: retailer!,
        categoryId: categoryId!,
        subcategoryId,
        imageUrl: imageUrl!,
        productUrl: productUrl ?? null,
        priceAmount: priceAmount!,
        priceCurrency: priceCurrency!,
        source: source as StageProductSource,
        collectionIds: Object.freeze(
          (productRaw.collectionIds as unknown[]).map((id) => String(id).trim()),
        ),
      },
      defaultVariant: {
        variantId: variantId!,
        finishLabel: finishLabel ?? null,
        sku: sku ?? null,
        priceAmount: variantPriceAmount!,
        priceCurrency: variantPriceCurrency!,
        productUrl: variantProductUrl ?? null,
        currentAssetId: currentAssetId!,
      },
    },
  };
}

function renderRegisteredProduct(product: StageProduct): string {
  const collections = product.collectionIds.map((id) => tsString(id)).join(", ");
  return (
    `    Object.freeze({\n` +
    `      productId: ${tsString(product.productId)},\n` +
    `      brand: ${tsString(product.brand)},\n` +
    `      name: ${tsString(product.name)},\n` +
    `      retailer: ${tsString(product.retailer)},\n` +
    `      categoryId: ${tsString(product.categoryId)},\n` +
    `      subcategoryId: ${tsNullableString(product.subcategoryId)},\n` +
    `      productUrl: ${tsNullableString(product.productUrl)},\n` +
    `      imageUrl: ${tsString(product.imageUrl)},\n` +
    `      priceAmount: ${tsNullableNumber(product.priceAmount)},\n` +
    `      priceCurrency: ${tsString(product.priceCurrency)},\n` +
    `      defaultVariantId: ${tsString(product.defaultVariantId)},\n` +
    `      collectionIds: Object.freeze([${collections}]),\n` +
    `      source: ${tsString(product.source)},\n` +
    `    })`
  );
}

function renderRegisteredVariant(variant: GeneratedRegisteredVariant): string {
  return (
    `    Object.freeze({\n` +
    `      variantId: ${tsString(variant.variantId)},\n` +
    `      productId: ${tsString(variant.productId)},\n` +
    `      finishLabel: ${tsNullableString(variant.finishLabel)},\n` +
    `      sku: ${tsNullableString(variant.sku)},\n` +
    `      priceAmount: ${tsNullableNumber(variant.priceAmount)},\n` +
    `      priceCurrency: ${tsString(variant.priceCurrency)},\n` +
    `      productUrl: ${tsNullableString(variant.productUrl)},\n` +
    `    })`
  );
}

export function renderGeneratedCommercialSeed(input: Readonly<{
  products: readonly StageProduct[];
  variants: readonly GeneratedRegisteredVariant[];
}>): string {
  const products = input.products.map(renderRegisteredProduct);
  const variants = input.variants.map(renderRegisteredVariant);
  return (
    `/**\n` +
    ` * GENERATED by PI-5E1 Product + default Variant registration. Do not edit by hand.\n` +
    ` * Regenerator: npm run vibode:register-product\n` +
    ` */\n` +
    `\n` +
    `import type { StageProduct } from "./types";\n` +
    `\n` +
    `export type GeneratedRegisteredVariant = Readonly<{\n` +
    `  variantId: string;\n` +
    `  productId: string;\n` +
    `  finishLabel: string | null;\n` +
    `  sku: string | null;\n` +
    `  priceAmount: number | null;\n` +
    `  priceCurrency: string;\n` +
    `  productUrl: string | null;\n` +
    `}>;\n` +
    `\n` +
    `export const GENERATED_REGISTERED_PRODUCTS: readonly StageProduct[] =\n` +
    `  Object.freeze([\n` +
    `${products.join(",\n")}${products.length > 0 ? ",\n" : ""}` +
    `  ]);\n` +
    `\n` +
    `export const GENERATED_REGISTERED_VARIANTS: readonly GeneratedRegisteredVariant[] =\n` +
    `  Object.freeze([\n` +
    `${variants.join(",\n")}${variants.length > 0 ? ",\n" : ""}` +
    `  ]);\n`
  );
}

export function renderProductVariantInsertSql(input: Readonly<{
  product: StageProduct;
  variant: StageVariant;
  assetId: string;
  sortOrder: number;
  collectionSortOrders: readonly Readonly<{
    collectionId: string;
    sortOrder: number;
  }>[];
}>): string {
  const memberships = input.collectionSortOrders.map((item) => (
    `  (\n` +
    `    ${sqlString(input.product.productId)},\n` +
    `    ${sqlString(item.collectionId)},\n` +
    `    ${sqlNumber(item.sortOrder)}\n` +
    `  )`
  ));
  const membershipSql = memberships.length === 0
    ? ""
    : (
      `\n` +
      `insert into public.vibode_stage_product_collections (\n` +
      `  product_id,\n` +
      `  collection_id,\n` +
      `  sort_order\n` +
      `) values\n` +
      `${memberships.join(",\n")};\n`
    );
  return (
    `-- PI-5E1: Product + default Variant registration.\n` +
    `--\n` +
    `-- Inserts one Product, its default Variant, and Collection membership.\n` +
    `-- Does not mutate technical Asset rows.\n` +
    `-- Does not rewrite Scene Objects.\n` +
    `-- Does not retarget existing Variants.\n` +
    `\n` +
    `begin;\n` +
    `\n` +
    `set constraints public.vibode_stage_products_default_variant_fkey deferred;\n` +
    `\n` +
    `do $$\n` +
    `begin\n` +
    `  if not exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_assets\n` +
    `    where asset_id = ${sqlString(input.assetId)}\n` +
    `      and status = 'ready'\n` +
    `  ) then\n` +
    `    raise exception 'Target Asset is missing or not ready';\n` +
    `  end if;\n` +
    `\n` +
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_products\n` +
    `    where product_id = ${sqlString(input.product.productId)}\n` +
    `  ) then\n` +
    `    raise exception 'Product already exists';\n` +
    `  end if;\n` +
    `\n` +
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_variants\n` +
    `    where variant_id = ${sqlString(input.variant.variantId)}\n` +
    `  ) then\n` +
    `    raise exception 'Variant already exists';\n` +
    `  end if;\n` +
    `end $$;\n` +
    `\n` +
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
    `  default_variant_id,\n` +
    `  status,\n` +
    `  sort_order\n` +
    `) values (\n` +
    `  ${sqlString(input.product.productId)},\n` +
    `  ${sqlString(input.product.name)},\n` +
    `  ${sqlString(input.product.brand)},\n` +
    `  ${sqlString(input.product.retailer)},\n` +
    `  ${sqlString(input.product.imageUrl)},\n` +
    `  ${sqlNullableString(input.product.productUrl)},\n` +
    `  ${sqlNumber(input.product.priceAmount ?? 0)},\n` +
    `  ${sqlString(input.product.priceCurrency)},\n` +
    `  ${sqlString(input.product.categoryId)},\n` +
    `  ${sqlNullableString(input.product.subcategoryId)},\n` +
    `  ${sqlString(input.product.source)},\n` +
    `  ${sqlString(input.product.defaultVariantId)},\n` +
    `  'active',\n` +
    `  ${sqlNumber(input.sortOrder)}\n` +
    `);\n` +
    `\n` +
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
    `  ${sqlString(input.variant.variantId)},\n` +
    `  ${sqlString(input.product.productId)},\n` +
    `  ${sqlString(input.assetId)},\n` +
    `  ${sqlNullableString(input.variant.finishLabel)},\n` +
    `  ${sqlNullableString(input.variant.sku)},\n` +
    `  ${sqlNumber(input.variant.priceAmount ?? 0)},\n` +
    `  ${sqlString(input.variant.priceCurrency)},\n` +
    `  ${sqlNullableString(input.variant.productUrl)}\n` +
    `);\n` +
    membershipSql +
    `\n` +
    `commit;\n`
  );
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

export type ParsedProductRegistrationSql = Readonly<{
  productIds: readonly string[];
  variantIds: readonly string[];
  assetIds: readonly string[];
  imageUrls: readonly string[];
  collectionIds: readonly string[];
  mutatesAssets: boolean;
  touchesObjectsJson: boolean;
  touchesScenes: boolean;
  retargetsVariant: boolean;
}>;

export function parseProductRegistrationSql(sql: string): ParsedProductRegistrationSql {
  const unique = (values: readonly string[]) => [...new Set(values)];
  return {
    productIds: unique(sqlQuotedEquals(sql, "product_id")),
    variantIds: unique(sqlQuotedEquals(sql, "variant_id")),
    assetIds: unique([
      ...sqlQuotedEquals(sql, "asset_id"),
      ...sqlQuotedEquals(sql, "current_asset_id"),
    ]),
    imageUrls: unique(sqlQuotedEquals(sql, "image_url")),
    collectionIds: unique(sqlQuotedEquals(sql, "collection_id")),
    mutatesAssets: /\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i.test(sql),
    touchesObjectsJson: /objects_json/i.test(sql),
    touchesScenes: /vibode_3d_scenes/i.test(sql),
    retargetsVariant: /\bupdate\s+public\.vibode_stage_variants\b/i.test(sql),
  };
}

function validateTargetAsset(
  assetId: string,
  gates: ProductVariantValidationGates,
  errors: ProductVariantIssue[],
): void {
  const loaded = gates.manifest
    ? { ok: true as const, manifest: gates.manifest }
    : loadFurnitureAssetManifest(gates.manifestRepoRoot ?? gates.repoRoot ?? process.cwd());
  if (!loaded.ok) {
    for (const item of loaded.errors) {
      errors.push(issue(item.code, item.message));
    }
  } else {
    const published = findManifestAsset(loaded.manifest, assetId);
    if (!published) {
      errors.push(issue("UNKNOWN_ASSET", `Unknown Asset ${assetId}.`));
    } else if (published.status !== "ready") {
      errors.push(issue("UNAVAILABLE_ASSET", `Asset ${assetId} is not ready.`));
    }
  }

  const runtimeAssetIds = gates.runtimeAssetIds ??
    GENERATED_FURNITURE_ASSETS.map((asset) => asset.assetId);
  if (!runtimeAssetIds.includes(assetId)) {
    errors.push(issue(
      "RUNTIME_MISSING_ASSET",
      `Asset ${assetId} is missing from the generated runtime registry.`,
    ));
  }

  const seedAssets = gates.seedAssets ?? gates.catalog?.assets ?? STAGE_SEED_ASSETS;
  const seedAsset = seedAssets.find((asset) => asset.assetId === assetId) ?? null;
  if (!seedAsset) {
    errors.push(issue("SEED_MISSING_ASSET", `Asset ${assetId} is missing from seed Assets.`));
  } else if (seedAsset.status !== "ready") {
    errors.push(issue("UNAVAILABLE_ASSET", `Seed Asset ${assetId} is not ready.`));
  }

  const runtimeKnown = gates.runtimeDefinitionKnown ??
    ((id: string) => furnitureAssetDefinition(id) != null);
  if (!runtimeKnown(assetId)) {
    errors.push(issue(
      "UNKNOWN_RUNTIME_DEFINITION",
      `Asset ${assetId} is unknown to furnitureAssetDefinition.`,
    ));
  }
}

function collectSharedVariantRegistrationIssues(
  input: Readonly<{
    variantId: string;
    sku: string | null;
    currentAssetId: string;
  }>,
  gates: ProductVariantValidationGates,
  errors: ProductVariantIssue[],
): void {
  const catalog = gates.catalog ?? STAGE_SEED_CATALOG;
  if (!STAGE_COMMERCIAL_ID_SHAPE.test(input.variantId) || isUuidLike(input.variantId)) {
    errors.push(issue("INVALID_VARIANT_ID", `Invalid Variant ID ${input.variantId}.`));
  }
  if (input.variantId.includes(input.currentAssetId)) {
    errors.push(issue(
      "INVALID_VARIANT_ID",
      "Variant ID must not include the current Asset ID.",
    ));
  }
  if (catalog.variants.some((variant) => variant.variantId === input.variantId)) {
    errors.push(issue("DUPLICATE_VARIANT_ID", `Variant ${input.variantId} already exists.`));
  }
  if (input.sku) {
    const duplicateSku = catalog.variants.some((variant) => (
      variant.sku != null && variant.sku === input.sku
    ));
    if (duplicateSku) {
      errors.push(issue("DUPLICATE_SKU", `SKU ${input.sku} already exists.`));
    }
  }

  validateTargetAsset(input.currentAssetId, { ...gates, catalog }, errors);

  const currentAssociations = gates.currentAssociations ?? GENERATED_VARIANT_CURRENT_ASSETS;
  const existingAssociation = currentAssociations.find((row) => (
    row.variantId === input.variantId
  ));
  if (existingAssociation) {
    errors.push(issue(
      "ASSOCIATION_CONFLICT",
      `Variant ${input.variantId} already has a current Asset association.`,
    ));
  }
}

export function validateProductVariantRegistration(
  input: ProductVariantRegistrationInput,
  gates: ProductVariantValidationGates = {},
): ProductVariantValidationResult {
  const errors: ProductVariantIssue[] = [];
  const catalog = gates.catalog ?? STAGE_SEED_CATALOG;
  const repoRoot = gates.repoRoot ?? process.cwd();
  const productIn = input.product;
  const variantIn = input.defaultVariant;

  const productCurrency = normalizeCurrency(productIn.priceCurrency);
  const variantCurrency = normalizeCurrency(variantIn.priceCurrency);

  if (!STAGE_COMMERCIAL_ID_SHAPE.test(productIn.productId) || isUuidLike(productIn.productId)) {
    errors.push(issue("INVALID_PRODUCT_ID", `Invalid Product ID ${productIn.productId}.`));
  }
  if (productIn.productId.includes(variantIn.currentAssetId)) {
    errors.push(issue(
      "INVALID_PRODUCT_ID",
      "Product ID must not include the current Asset ID.",
    ));
  }
  if (!asNonEmptyString(productIn.name)) {
    errors.push(issue("EMPTY_NAME", "Product name must be non-empty."));
  }
  if (!asNonEmptyString(productIn.brand)) {
    errors.push(issue("EMPTY_BRAND", "Brand must be non-empty."));
  }
  if (!asNonEmptyString(productIn.retailer)) {
    errors.push(issue("EMPTY_RETAILER", "Retailer must be non-empty."));
  }
  if (!asNonEmptyString(productIn.imageUrl)) {
    errors.push(issue("INVALID_IMAGE_URL", "Image URL must be non-empty."));
  }
  if (catalog.products.some((product) => product.productId === productIn.productId)) {
    errors.push(issue("DUPLICATE_PRODUCT_ID", `Product ${productIn.productId} already exists.`));
  }

  const category = STAGE_BROWSE_CATEGORIES.find((item) => item.id === productIn.categoryId) ?? null;
  if (!category) {
    errors.push(issue("UNKNOWN_CATEGORY", `Unknown category ${productIn.categoryId}.`));
  } else if (productIn.subcategoryId) {
    const subcategory = category.subcategories.find((item) => item.id === productIn.subcategoryId);
    if (!subcategory) {
      errors.push(issue(
        "UNKNOWN_SUBCATEGORY",
        `Unknown subcategory ${productIn.subcategoryId} under ${productIn.categoryId}.`,
      ));
    }
  }

  if (!Number.isFinite(productIn.priceAmount) || productIn.priceAmount < 0) {
    errors.push(issue("INVALID_PRICE", "Product price must be finite and >= 0."));
  }
  if (!Number.isFinite(variantIn.priceAmount) || variantIn.priceAmount < 0) {
    errors.push(issue("INVALID_PRICE", "Variant price must be finite and >= 0."));
  }
  if (!isValidCurrency(productCurrency) || !isValidCurrency(variantCurrency)) {
    errors.push(issue("INVALID_CURRENCY", "Currency must be a 3-letter ISO code."));
  }
  if (
    Number.isFinite(productIn.priceAmount) &&
    Number.isFinite(variantIn.priceAmount) &&
    (productIn.priceAmount !== variantIn.priceAmount || productCurrency !== variantCurrency)
  ) {
    errors.push(issue(
      "PRICE_CURRENCY_MISMATCH",
      "Product and default Variant price/currency must match.",
    ));
  }
  if (!(ALLOWED_SOURCES as readonly string[]).includes(productIn.source)) {
    errors.push(issue("INVALID_SOURCE", `Source ${productIn.source} is not allowed.`));
  }

  for (const collectionId of productIn.collectionIds) {
    if (!catalog.collections.some((collection) => collection.collectionId === collectionId)) {
      errors.push(issue("UNKNOWN_COLLECTION", `Unknown Collection ${collectionId}.`));
    }
  }

  if (productIn.source === "vibode_curated") {
    if (!isSameOriginPublicPath(productIn.imageUrl)) {
      errors.push(issue(
        "INVALID_IMAGE_URL",
        "Vibode curated image URL must be a same-origin public path.",
      ));
    } else if (!existsSync(publicFilePathFromImageUrl(repoRoot, productIn.imageUrl))) {
      errors.push(issue(
        "MISSING_IMAGE",
        `Local image file missing for ${productIn.imageUrl}.`,
      ));
    }
  }

  collectSharedVariantRegistrationIssues({
    variantId: variantIn.variantId,
    sku: variantIn.sku,
    currentAssetId: variantIn.currentAssetId,
  }, { ...gates, catalog }, errors);

  if (errors.length > 0) {
    return { ok: false, parsed: null, errors };
  }

  const product: StageProduct = Object.freeze({
    productId: productIn.productId,
    brand: productIn.brand,
    name: productIn.name,
    retailer: productIn.retailer,
    categoryId: productIn.categoryId,
    subcategoryId: productIn.subcategoryId,
    productUrl: productIn.productUrl,
    imageUrl: productIn.imageUrl,
    priceAmount: productIn.priceAmount,
    priceCurrency: productCurrency,
    defaultVariantId: variantIn.variantId,
    collectionIds: Object.freeze([...productIn.collectionIds]),
    source: productIn.source,
  });
  const variant: StageVariant = Object.freeze({
    variantId: variantIn.variantId,
    productId: productIn.productId,
    assetId: variantIn.currentAssetId,
    finishLabel: variantIn.finishLabel,
    sku: variantIn.sku,
    priceAmount: variantIn.priceAmount,
    priceCurrency: variantCurrency,
    productUrl: variantIn.productUrl,
  });
  const collectionSortOrders = product.collectionIds.map((collectionId) => {
    const collection = catalog.collections.find((item) => item.collectionId === collectionId);
    return {
      collectionId,
      sortOrder: collection?.productIds.length ?? 0,
    };
  });
  return {
    ok: true,
    parsed: {
      product,
      variant,
      assetId: variantIn.currentAssetId,
      collectionIds: product.collectionIds,
      sortOrder: catalog.products.length,
      collectionSortOrders,
    },
    errors: [],
  };
}

export function planProductVariantRegistration(input: Readonly<{
  parsed: ParsedProductVariantRegistration;
  repoRoot?: string;
  migrationTimestamp?: string;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
  currentGeneratedProducts?: readonly StageProduct[];
  currentGeneratedVariants?: readonly GeneratedRegisteredVariant[];
}>): ProductVariantWritePlan {
  const repoRoot = input.repoRoot ?? process.cwd();
  const paths = productRegistrationRepoPaths(repoRoot);
  const currentAssociations = input.currentAssociations ?? GENERATED_VARIANT_CURRENT_ASSETS;
  const currentProducts = input.currentGeneratedProducts ?? GENERATED_REGISTERED_PRODUCTS;
  const currentVariants = input.currentGeneratedVariants ?? GENERATED_REGISTERED_VARIANTS;
  const nextAssociations = sortVariantAssociations([
    ...currentAssociations,
    {
      variantId: input.parsed.variant.variantId,
      productId: input.parsed.product.productId,
      currentAssetId: input.parsed.assetId,
    },
  ]);
  const nextProducts = [...currentProducts, input.parsed.product];
  const nextVariants: GeneratedRegisteredVariant[] = [
    ...currentVariants,
    {
      variantId: input.parsed.variant.variantId,
      productId: input.parsed.product.productId,
      finishLabel: input.parsed.variant.finishLabel,
      sku: input.parsed.variant.sku,
      priceAmount: input.parsed.variant.priceAmount,
      priceCurrency: input.parsed.variant.priceCurrency,
      productUrl: input.parsed.variant.productUrl,
    },
  ];
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  const migration = path.join(
    paths.migrationsDir,
    productRegistrationMigrationFileName(timestamp, input.parsed.product.productId),
  );
  return {
    commercialSeed: paths.commercialSeed,
    generatedMap: paths.generatedMap,
    migration,
    sql: renderProductVariantInsertSql(input.parsed),
    commercialSource: renderGeneratedCommercialSeed({
      products: nextProducts,
      variants: nextVariants,
    }),
    mapSource: renderGeneratedVariantCurrentAssetMap(nextAssociations),
  };
}

function failRegister(
  errors: readonly ProductVariantIssue[],
  check: boolean,
): ProductVariantRegisterFailure {
  return {
    ok: false,
    check,
    written: null,
    plan: null,
    errors,
  };
}

function writePlannedFiles(files: readonly Readonly<{ path: string; contents: string }>[]): void {
  const temps: { tmp: string; dest: string }[] = [];
  try {
    for (const file of files) {
      mkdirSync(path.dirname(file.path), { recursive: true });
      const tmp = `${file.path}.${process.pid}.${Date.now()}.${temps.length}.tmp`;
      writeFileSync(tmp, file.contents);
      temps.push({ tmp, dest: file.path });
    }
    for (const item of temps) {
      renameSync(item.tmp, item.dest);
    }
  } catch (error) {
    for (const item of temps) {
      try {
        unlinkSync(item.tmp);
      } catch {
        // ignore cleanup
      }
    }
    throw error;
  }
}

export function registerProductVariant(input: Readonly<{
  input: ProductVariantRegistrationInput;
  repoRoot?: string;
  check?: boolean;
  migrationTimestamp?: string;
  catalog?: StageCatalogSnapshot;
  seedAssets?: readonly StageAsset[];
  manifest?: CanonicalFurnitureAssetManifest;
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
  currentGeneratedProducts?: readonly StageProduct[];
  currentGeneratedVariants?: readonly GeneratedRegisteredVariant[];
  manifestRepoRoot?: string;
}>): ProductVariantRegisterResult {
  const check = input.check === true;
  const validation = validateProductVariantRegistration(input.input, input);
  if (!validation.ok) return failRegister(validation.errors, check);

  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    return failRegister([
      issue("INVALID_TIMESTAMP", "migration timestamp must be YYYYMMDDHHMMSS."),
    ], check);
  }

  const plan = planProductVariantRegistration({
    parsed: validation.parsed,
    repoRoot: input.repoRoot,
    migrationTimestamp: timestamp,
    currentAssociations: input.currentAssociations,
    currentGeneratedProducts: input.currentGeneratedProducts,
    currentGeneratedVariants: input.currentGeneratedVariants,
  });

  if (check) {
    return {
      ok: true,
      check: true,
      productId: validation.parsed.product.productId,
      variantId: validation.parsed.variant.variantId,
      assetId: validation.parsed.assetId,
      errors: [],
      written: null,
      plan,
    };
  }

  if (existsSync(plan.migration)) {
    return failRegister([
      issue("MIGRATION_EXISTS", `Product migration already exists: ${plan.migration}`),
    ], check);
  }

  try {
    writePlannedFiles([
      { path: plan.commercialSeed, contents: plan.commercialSource },
      { path: plan.generatedMap, contents: plan.mapSource },
      { path: plan.migration, contents: plan.sql },
    ]);
  } catch (error) {
    return failRegister([
      issue(
        "WRITE_FAILED",
        error instanceof Error ? error.message : "Unable to write Product registration artifacts.",
      ),
    ], check);
  }

  return {
    ok: true,
    check: false,
    productId: validation.parsed.product.productId,
    variantId: validation.parsed.variant.variantId,
    assetId: validation.parsed.assetId,
    errors: [],
    written: {
      commercialSeed: plan.commercialSeed,
      generatedMap: plan.generatedMap,
      migration: plan.migration,
    },
    plan,
  };
}

export type AdditionalVariantRegistrationInput = Readonly<{
  productId: string;
  variant: Readonly<{
    variantId: string;
    finishLabel: string | null;
    sku: string | null;
    priceAmount: number;
    priceCurrency: string;
    productUrl: string | null;
    currentAssetId: string;
  }>;
}>;

export type ParsedAdditionalVariantRegistration = Readonly<{
  product: StageProduct;
  variant: StageVariant;
  assetId: string;
}>;

export type AdditionalVariantValidationSuccess = Readonly<{
  ok: true;
  parsed: ParsedAdditionalVariantRegistration;
  errors: readonly ProductVariantIssue[];
}>;

export type AdditionalVariantValidationFailure = Readonly<{
  ok: false;
  parsed: null;
  errors: readonly ProductVariantIssue[];
}>;

export type AdditionalVariantValidationResult =
  | AdditionalVariantValidationSuccess
  | AdditionalVariantValidationFailure;

export type AdditionalVariantWritePlan = ProductVariantWritePlan;

export type AdditionalVariantRegisterResult = ProductVariantRegisterResult;

export function variantRegistrationMigrationFileName(
  timestamp: string,
  variantId: string,
): string {
  return `${timestamp}_vibode_stage_register_variant_${variantIdMigrationSlug(variantId)}.sql`;
}

export function isVariantRegistrationMigrationFileName(fileName: string): boolean {
  return /^\d{14}_vibode_stage_register_variant_[a-z0-9_]+\.sql$/.test(fileName);
}

export function listVariantRegistrationMigrations(repoRoot = process.cwd()): string[] {
  const dir = productRegistrationRepoPaths(repoRoot).migrationsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isVariantRegistrationMigrationFileName(name))
    .sort();
}

export function parseVariantRegistrationJson(
  value: unknown,
): Readonly<{ ok: true; input: AdditionalVariantRegistrationInput }> | Readonly<{
  ok: false;
  errors: readonly ProductVariantIssue[];
}> {
  const errors: ProductVariantIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      errors: [issue("INVALID_JSON", "Variant registration JSON must be an object.")],
    };
  }
  const productId = asNonEmptyString(value.productId);
  const variantRaw = value.variant;
  if (!productId) {
    errors.push(issue("INVALID_PRODUCT_ID", "productId must be a non-empty string."));
  }
  if (!isPlainObject(variantRaw)) {
    errors.push(issue("INVALID_JSON", "variant must be an object."));
  }
  if (errors.length > 0 || !isPlainObject(variantRaw) || !productId) {
    return { ok: false, errors };
  }

  const variantId = asNonEmptyString(variantRaw.variantId);
  const priceAmount = asFiniteNumber(variantRaw.priceAmount);
  const priceCurrency = asNonEmptyString(variantRaw.priceCurrency);
  const currentAssetId = asNonEmptyString(variantRaw.currentAssetId);
  if (!variantId) errors.push(issue("INVALID_VARIANT_ID", "variant.variantId must be a non-empty string."));
  if (priceAmount == null) {
    errors.push(issue("INVALID_PRICE", "variant.priceAmount must be a finite number."));
  }
  if (!priceCurrency) {
    errors.push(issue("INVALID_CURRENCY", "variant.priceCurrency must be a non-empty string."));
  }
  if (!currentAssetId) {
    errors.push(issue("UNKNOWN_ASSET", "variant.currentAssetId must be a non-empty string."));
  }
  const finishLabel = asNullableJsonString(variantRaw.finishLabel);
  if (finishLabel === undefined) {
    errors.push(issue("INVALID_JSON", "variant.finishLabel must be a string or null."));
  }
  const sku = asNullableJsonString(variantRaw.sku);
  if (sku === undefined) {
    errors.push(issue("INVALID_JSON", "variant.sku must be a string or null."));
  }
  const productUrl = asNullableJsonString(variantRaw.productUrl);
  if (productUrl === undefined) {
    errors.push(issue("INVALID_JSON", "variant.productUrl must be a string or null."));
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      productId,
      variant: {
        variantId: variantId!,
        finishLabel: finishLabel ?? null,
        sku: sku ?? null,
        priceAmount: priceAmount!,
        priceCurrency: priceCurrency!,
        productUrl: productUrl ?? null,
        currentAssetId: currentAssetId!,
      },
    },
  };
}

export function renderAdditionalVariantInsertSql(input: Readonly<{
  product: StageProduct;
  variant: StageVariant;
  assetId: string;
}>): string {
  return (
    `-- PI-5E2: additional Variant registration.\n` +
    `--\n` +
    `-- Inserts one Variant for an existing Product.\n` +
    `-- Does not mutate Product, Asset, Collection, or Scene Object rows.\n` +
    `-- Does not change the Product default Variant.\n` +
    `\n` +
    `begin;\n` +
    `\n` +
    `do $$\n` +
    `begin\n` +
    `  if not exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_products\n` +
    `    where product_id = ${sqlString(input.product.productId)}\n` +
    `      and status = 'active'\n` +
    `  ) then\n` +
    `    raise exception 'Product is missing or not active';\n` +
    `  end if;\n` +
    `\n` +
    `  if not exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_assets\n` +
    `    where asset_id = ${sqlString(input.assetId)}\n` +
    `      and status = 'ready'\n` +
    `  ) then\n` +
    `    raise exception 'Target Asset is missing or not ready';\n` +
    `  end if;\n` +
    `\n` +
    `  if exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_variants\n` +
    `    where variant_id = ${sqlString(input.variant.variantId)}\n` +
    `  ) then\n` +
    `    raise exception 'Variant already exists';\n` +
    `  end if;\n` +
    `end $$;\n` +
    `\n` +
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
    `  ${sqlString(input.variant.variantId)},\n` +
    `  ${sqlString(input.product.productId)},\n` +
    `  ${sqlString(input.assetId)},\n` +
    `  ${sqlNullableString(input.variant.finishLabel)},\n` +
    `  ${sqlNullableString(input.variant.sku)},\n` +
    `  ${sqlNumber(input.variant.priceAmount ?? 0)},\n` +
    `  ${sqlString(input.variant.priceCurrency)},\n` +
    `  ${sqlNullableString(input.variant.productUrl)}\n` +
    `);\n` +
    `\n` +
    `commit;\n`
  );
}

export type ParsedVariantRegistrationSql = Readonly<{
  productIds: readonly string[];
  variantIds: readonly string[];
  assetIds: readonly string[];
  insertsVariant: boolean;
  insertsProduct: boolean;
  updatesProduct: boolean;
  updatesVariant: boolean;
  mutatesAssets: boolean;
  touchesCollections: boolean;
  touchesObjectsJson: boolean;
  touchesScenes: boolean;
  mentionsDefaultVariant: boolean;
}>;

export function parseVariantRegistrationSql(sql: string): ParsedVariantRegistrationSql {
  const unique = (values: readonly string[]) => [...new Set(values)];
  const body = sql.replace(/--[^\n]*/g, "");
  return {
    productIds: unique(sqlQuotedEquals(sql, "product_id")),
    variantIds: unique(sqlQuotedEquals(sql, "variant_id")),
    assetIds: unique([
      ...sqlQuotedEquals(sql, "asset_id"),
      ...sqlQuotedEquals(sql, "current_asset_id"),
    ]),
    insertsVariant: /\binsert\s+into\s+public\.vibode_stage_variants\b/i.test(body),
    insertsProduct: /\binsert\s+into\s+public\.vibode_stage_products\b/i.test(body),
    updatesProduct: /\bupdate\s+public\.vibode_stage_products\b/i.test(body),
    updatesVariant: /\bupdate\s+public\.vibode_stage_variants\b/i.test(body),
    mutatesAssets: /\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i.test(body),
    touchesCollections: /vibode_stage_(?:product_)?collections/i.test(body),
    touchesObjectsJson: /objects_json/i.test(body),
    touchesScenes: /vibode_3d_scenes/i.test(body),
    mentionsDefaultVariant: /\bdefault_variant_id\b/i.test(body),
  };
}

export function validateVariantRegistration(
  input: AdditionalVariantRegistrationInput,
  gates: ProductVariantValidationGates = {},
): AdditionalVariantValidationResult {
  const errors: ProductVariantIssue[] = [];
  const catalog = gates.catalog ?? STAGE_SEED_CATALOG;
  const variantIn = input.variant;
  const variantCurrency = normalizeCurrency(variantIn.priceCurrency);
  const product = catalog.products.find((item) => item.productId === input.productId) ?? null;

  if (!product) {
    errors.push(issue("UNKNOWN_PRODUCT", `Unknown Product ${input.productId}.`));
  }
  if (!Number.isFinite(variantIn.priceAmount) || variantIn.priceAmount < 0) {
    errors.push(issue("INVALID_PRICE", "Variant price must be finite and >= 0."));
  }
  if (!isValidCurrency(variantCurrency)) {
    errors.push(issue("INVALID_CURRENCY", "Currency must be a 3-letter ISO code."));
  }

  collectSharedVariantRegistrationIssues({
    variantId: variantIn.variantId,
    sku: variantIn.sku,
    currentAssetId: variantIn.currentAssetId,
  }, { ...gates, catalog }, errors);

  if (errors.length > 0 || !product) {
    return { ok: false, parsed: null, errors };
  }

  const variant: StageVariant = Object.freeze({
    variantId: variantIn.variantId,
    productId: product.productId,
    assetId: variantIn.currentAssetId,
    finishLabel: variantIn.finishLabel,
    sku: variantIn.sku,
    priceAmount: variantIn.priceAmount,
    priceCurrency: variantCurrency,
    productUrl: variantIn.productUrl,
  });
  return {
    ok: true,
    parsed: {
      product,
      variant,
      assetId: variantIn.currentAssetId,
    },
    errors: [],
  };
}

export function planVariantRegistration(input: Readonly<{
  parsed: ParsedAdditionalVariantRegistration;
  repoRoot?: string;
  migrationTimestamp?: string;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
  currentGeneratedProducts?: readonly StageProduct[];
  currentGeneratedVariants?: readonly GeneratedRegisteredVariant[];
}>): AdditionalVariantWritePlan {
  const repoRoot = input.repoRoot ?? process.cwd();
  const paths = productRegistrationRepoPaths(repoRoot);
  const currentAssociations = input.currentAssociations ?? GENERATED_VARIANT_CURRENT_ASSETS;
  const currentProducts = input.currentGeneratedProducts ?? GENERATED_REGISTERED_PRODUCTS;
  const currentVariants = input.currentGeneratedVariants ?? GENERATED_REGISTERED_VARIANTS;
  const nextAssociations = sortVariantAssociations([
    ...currentAssociations,
    {
      variantId: input.parsed.variant.variantId,
      productId: input.parsed.product.productId,
      currentAssetId: input.parsed.assetId,
    },
  ]);
  const nextVariants: GeneratedRegisteredVariant[] = [
    ...currentVariants,
    {
      variantId: input.parsed.variant.variantId,
      productId: input.parsed.product.productId,
      finishLabel: input.parsed.variant.finishLabel,
      sku: input.parsed.variant.sku,
      priceAmount: input.parsed.variant.priceAmount,
      priceCurrency: input.parsed.variant.priceCurrency,
      productUrl: input.parsed.variant.productUrl,
    },
  ];
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  const migration = path.join(
    paths.migrationsDir,
    variantRegistrationMigrationFileName(timestamp, input.parsed.variant.variantId),
  );
  return {
    commercialSeed: paths.commercialSeed,
    generatedMap: paths.generatedMap,
    migration,
    sql: renderAdditionalVariantInsertSql(input.parsed),
    commercialSource: renderGeneratedCommercialSeed({
      products: currentProducts,
      variants: nextVariants,
    }),
    mapSource: renderGeneratedVariantCurrentAssetMap(nextAssociations),
  };
}

export function registerVariant(input: Readonly<{
  input: AdditionalVariantRegistrationInput;
  repoRoot?: string;
  check?: boolean;
  migrationTimestamp?: string;
  catalog?: StageCatalogSnapshot;
  seedAssets?: readonly StageAsset[];
  manifest?: CanonicalFurnitureAssetManifest;
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
  currentGeneratedProducts?: readonly StageProduct[];
  currentGeneratedVariants?: readonly GeneratedRegisteredVariant[];
  manifestRepoRoot?: string;
}>): AdditionalVariantRegisterResult {
  const check = input.check === true;
  const validation = validateVariantRegistration(input.input, input);
  if (!validation.ok) return failRegister(validation.errors, check);

  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    return failRegister([
      issue("INVALID_TIMESTAMP", "migration timestamp must be YYYYMMDDHHMMSS."),
    ], check);
  }

  const plan = planVariantRegistration({
    parsed: validation.parsed,
    repoRoot: input.repoRoot,
    migrationTimestamp: timestamp,
    currentAssociations: input.currentAssociations,
    currentGeneratedProducts: input.currentGeneratedProducts,
    currentGeneratedVariants: input.currentGeneratedVariants,
  });

  if (check) {
    return {
      ok: true,
      check: true,
      productId: validation.parsed.product.productId,
      variantId: validation.parsed.variant.variantId,
      assetId: validation.parsed.assetId,
      errors: [],
      written: null,
      plan,
    };
  }

  if (existsSync(plan.migration)) {
    return failRegister([
      issue("MIGRATION_EXISTS", `Variant registration migration already exists: ${plan.migration}`),
    ], check);
  }

  try {
    writePlannedFiles([
      { path: plan.commercialSeed, contents: plan.commercialSource },
      { path: plan.generatedMap, contents: plan.mapSource },
      { path: plan.migration, contents: plan.sql },
    ]);
  } catch (error) {
    return failRegister([
      issue(
        "WRITE_FAILED",
        error instanceof Error ? error.message : "Unable to write Variant registration artifacts.",
      ),
    ], check);
  }

  return {
    ok: true,
    check: false,
    productId: validation.parsed.product.productId,
    variantId: validation.parsed.variant.variantId,
    assetId: validation.parsed.assetId,
    errors: [],
    written: {
      commercialSeed: plan.commercialSeed,
      generatedMap: plan.generatedMap,
      migration: plan.migration,
    },
    plan,
  };
}
