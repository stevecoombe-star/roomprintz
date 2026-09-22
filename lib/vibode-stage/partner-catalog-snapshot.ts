/**
 * PI-5F3C Partner catalog full-snapshot sync.
 *
 * Dedicated snapshot parser and planner. Patch omission semantics stay
 * in parsePartnerCatalogSyncJson / planPartnerCatalogSync.
 *
 * Snapshot contract:
 * - Presence within full_partner_catalog scope is desired active state.
 * - Omission deactivates Partner-owned Products/Variants. Never hard-delete.
 * - Partner status is an availability gate only; no Product/Variant cascade.
 * - Present Collections exact-sync membership. Omitted Collections unchanged.
 * - Assets, Scene Objects, and current_asset_id remain outside this lifecycle.
 * - PI-5D2B remains the only Variant Asset retarget path.
 *
 * Deferred:
 * - Snapshot presence may reactivate identities previously patched inactive.
 *   No separate Vibode moderation override bit exists yet.
 * - Collection retirement/status exposure is not implemented.
 * - Partner name/website/logo/slug mutation is not implemented.
 * - Membership join rows are not expected-old guarded against concurrent
 *   live-DB edits; repo fold remains the planning authority.
 * - 10,000-Variant SQL/repo scale remains a future concern.
 */

import path from "node:path";

import {
  createStageCatalogSnapshot,
  isStageAssetReady,
  isStageCommercialActive,
  STAGE_SEED_CATALOG,
  stageAssetById,
  stageCommercialStatus,
} from "./catalog";
import {
  namespacedId,
  partnerCatalogSqlSlug,
  validatePartnerCollection,
} from "./partner-catalog";
import type {
  FoldedPartnerCatalogState,
  PartnerCatalogSyncPlan,
  PartnerCatalogSyncSqlPlan,
  PlannedCollectionCreate,
  PlannedCollectionUpdate,
  PlannedFieldChange,
  PlannedMembership,
  PlannedPartnerStatusTransition,
  PlannedProductCreate,
  PlannedProductStatusTransition,
  PlannedProductUpdate,
  PlannedVariantCreate,
  PlannedVariantStatusTransition,
  PlannedVariantUpdate,
} from "./partner-catalog-sync-types";
import {
  asNonEmptyString,
  hasDuplicateSkuInScope,
  isCommercialId,
  isPlainObject,
  isUuidLike,
  normalizeCurrency,
  parseProductRegistrationJson,
  parseVariantRegistrationJson,
  productRegistrationRepoPaths,
  sqlNullableString,
  sqlNumber,
  sqlString,
  utcTimestamp,
  validateBrowseTaxonomy,
  validateFiniteNonNegativePrice,
  validateOptionalAbsoluteHttpsUrl,
  validatePartnerCatalogImageUrl,
  validateProductVariantRegistration,
  validateRequiredAbsoluteHttpsUrl,
  validateTargetAsset,
  validateVariantRegistration,
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

export const PARTNER_CATALOG_SNAPSHOT_SCOPE = "full_partner_catalog" as const;
export const DEMO_COFFEE_TABLE_BLACK_SNAPSHOT_PRICE = 459;

const SNAPSHOT_TOP_LEVEL_KEYS = Object.freeze([
  "partnerId",
  "mode",
  "scope",
  "partner",
  "collections",
  "products",
]);

const SNAPSHOT_PARTNER_KEYS = Object.freeze(["status"]);

const SNAPSHOT_COLLECTION_KEYS = Object.freeze(["collectionId", "name", "slug"]);

const SNAPSHOT_PRODUCT_WRAPPER_KEYS = Object.freeze([
  "product",
  "defaultVariant",
  "variants",
]);

const SNAPSHOT_PRODUCT_KEYS = Object.freeze([
  "productId",
  "name",
  "brand",
  "retailer",
  "categoryId",
  "subcategoryId",
  "imageUrl",
  "productUrl",
  "priceAmount",
  "priceCurrency",
  "source",
  "partnerId",
  "collectionIds",
]);

const SNAPSHOT_VARIANT_KEYS = Object.freeze([
  "variantId",
  "productId",
  "finishLabel",
  "sku",
  "priceAmount",
  "priceCurrency",
  "productUrl",
  "currentAssetId",
]);

const PATCH_OPERATION_KEYS = Object.freeze([
  "update",
  "create",
  "deactivate",
  "reactivate",
  "membershipAdd",
  "membershipRemove",
]);

const STATUS_KEYS = Object.freeze(["status", "partnerStatus", "productStatus", "variantStatus"]);

const PRODUCT_MUTABLE_FIELDS = Object.freeze([
  "name",
  "imageUrl",
  "productUrl",
  "priceAmount",
  "categoryId",
  "subcategoryId",
  "defaultVariantId",
] as const);

const VARIANT_MUTABLE_FIELDS = Object.freeze([
  "finishLabel",
  "sku",
  "priceAmount",
  "productUrl",
] as const);

export type PartnerCatalogSnapshotVariantRecord = ProductVariantRegistrationInput["defaultVariant"];

export type PartnerCatalogSnapshotProductRecord = Readonly<{
  product: ProductVariantRegistrationInput["product"];
  defaultVariant: PartnerCatalogSnapshotVariantRecord;
  variants: readonly PartnerCatalogSnapshotVariantRecord[];
}>;

export type PartnerCatalogSnapshotCollectionRecord = Readonly<{
  collectionId: string;
  name: string;
  slug: string;
}>;

export type PartnerCatalogSnapshotDocument = Readonly<{
  partnerId: string;
  mode: "snapshot";
  scope: typeof PARTNER_CATALOG_SNAPSHOT_SCOPE;
  partner: Readonly<{ status: StagePartnerStatus }>;
  collections: readonly PartnerCatalogSnapshotCollectionRecord[];
  products: readonly PartnerCatalogSnapshotProductRecord[];
}>;

type MutableProduct = Omit<StageProduct, "collectionIds"> & { collectionIds: string[] };
type MutableCollection = Omit<StageCollection, "productIds"> & { productIds: string[] };
type MutablePartnerCatalogState = {
  partners: StagePartner[];
  products: MutableProduct[];
  variants: StageVariant[];
  collections: MutableCollection[];
};

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function hasStatusKey(value: Record<string, unknown>): boolean {
  return STATUS_KEYS.some((key) => key in value);
}

function hasPatchOperationKey(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => (
    (PATCH_OPERATION_KEYS as readonly string[]).includes(key)
  ));
}

function suffixAfterPrefix(id: string, prefix: string): string | null {
  if (!id.startsWith(prefix)) return null;
  const suffix = id.slice(prefix.length);
  return suffix.length > 0 ? suffix : null;
}

function sameValue(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
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

function sqlIsNotDistinctFrom(column: string, value: string | number | null): string {
  if (value == null) return `${column} is not distinct from null`;
  if (typeof value === "number") return `${column} is not distinct from ${sqlNumber(value)}`;
  return `${column} is not distinct from ${sqlString(value)}`;
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

function replaceProduct(state: MutablePartnerCatalogState, product: MutableProduct): void {
  state.products = state.products.map((item) => (
    item.productId === product.productId ? product : item
  ));
}

function replaceCollection(state: MutablePartnerCatalogState, collection: MutableCollection): void {
  state.collections = state.collections.map((item) => (
    item.collectionId === collection.collectionId ? collection : item
  ));
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

function overlayState(
  state: FoldedPartnerCatalogState,
  seed: StageCatalogSnapshot,
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

function snapshotMigrationFileName(timestamp: string, sqlSlug: string): string {
  return `${timestamp}_vibode_stage_partner_sync_${sqlSlug}.sql`;
}

function failedPlan(
  issues: readonly ProductVariantIssue[],
  partnerId: string | null,
): PartnerCatalogSyncPlan {
  return {
    ok: false,
    noOp: false,
    issues,
    partnerId,
    partnerStatusTransition: null,
    productCreates: [],
    productUpdates: [],
    variantCreates: [],
    variantUpdates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [],
    productReactivations: [],
    variantDeactivations: [],
    variantReactivations: [],
    sqlPlan: null,
    nextState: null,
  };
}

function partnerOwnedProduct(
  product: MutableProduct | StageProduct | undefined,
  partnerId: string,
): boolean {
  return !!product && product.partnerId === partnerId && product.source === "partner_catalog";
}

function uniquePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function exactMembership(currentIds: readonly string[], desired: ReadonlySet<string>): string[] {
  const kept = currentIds.filter((id) => desired.has(id));
  const added = [...desired].filter((id) => !currentIds.includes(id)).sort((a, b) => a.localeCompare(b));
  return [...kept, ...added];
}

function parseSnapshotVariantRecord(
  value: unknown,
  label: string,
  issues: ProductVariantIssue[],
  productId: string,
): PartnerCatalogSnapshotVariantRecord | null {
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `${label} must be an object.`));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `${label} must not include status language.`));
    return null;
  }
  const extra = unknownKeys(value, SNAPSHOT_VARIANT_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `${label} contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  if ("productId" in value) {
    const nestedProductId = asNonEmptyString(value.productId);
    if (!nestedProductId || nestedProductId !== productId) {
      issues.push(issue(
        "IDENTITY_IMMUTABLE",
        `${label}.productId must match the enclosing Product.`,
      ));
    }
  }
  const parsed = parseVariantRegistrationJson({
    productId,
    variant: value,
  });
  if (!parsed.ok) {
    for (const item of parsed.errors) {
      issues.push(issue(item.code, `${label}: ${item.message}`));
    }
    return null;
  }
  return parsed.input.variant;
}

function parseSnapshotProductRecord(
  value: unknown,
  index: number,
  issues: ProductVariantIssue[],
): PartnerCatalogSnapshotProductRecord | null {
  const label = `products[${index}]`;
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `${label} must be an object.`));
    return null;
  }
  const patchKeys = hasPatchOperationKey(value);
  if (patchKeys.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `${label} must not include patch operations: ${patchKeys.join(", ")}.`,
    ));
    return null;
  }
  if (hasStatusKey(value)) {
    issues.push(issue("UNSUPPORTED_OPERATION", `${label} must not include status language.`));
    return null;
  }
  const extra = unknownKeys(value, SNAPSHOT_PRODUCT_WRAPPER_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `${label} contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  if (!isPlainObject(value.product)) {
    issues.push(issue("INVALID_JSON", `${label}.product must be a complete Product record.`));
    return null;
  }
  if (hasStatusKey(value.product) || hasPatchOperationKey(value.product).length > 0) {
    issues.push(issue("UNSUPPORTED_OPERATION", `${label}.product must not include status or patch keys.`));
    return null;
  }
  const extraProduct = unknownKeys(value.product, SNAPSHOT_PRODUCT_KEYS);
  if (extraProduct.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `${label}.product contains unsupported fields: ${extraProduct.join(", ")}.`,
    ));
    return null;
  }
  const parsedProduct = parseProductRegistrationJson({
    product: value.product,
    defaultVariant: value.defaultVariant,
  });
  if (!parsedProduct.ok) {
    for (const item of parsedProduct.errors) {
      issues.push(issue(item.code, `${label}: ${item.message}`));
    }
    return null;
  }
  const productId = parsedProduct.input.product.productId;
  if (parsedProduct.input.product.source !== "partner_catalog") {
    issues.push(issue(
      "IDENTITY_IMMUTABLE",
      `${label}.product source must be partner_catalog.`,
    ));
    return null;
  }
  if (!parsedProduct.input.product.partnerId) {
    issues.push(issue("MISSING_PARTNER_ID", `${label}.product requires partnerId.`));
    return null;
  }
  const defaultVariant = parseSnapshotVariantRecord(
    value.defaultVariant,
    `${label}.defaultVariant`,
    issues,
    productId,
  );
  if (!defaultVariant) return null;
  if (value.variants == null) {
    issues.push(issue("INVALID_JSON", `${label}.variants must be an array.`));
    return null;
  }
  if (!Array.isArray(value.variants)) {
    issues.push(issue("INVALID_JSON", `${label}.variants must be an array.`));
    return null;
  }
  const variants: PartnerCatalogSnapshotVariantRecord[] = [];
  for (const [variantIndex, variantRaw] of value.variants.entries()) {
    const parsed = parseSnapshotVariantRecord(
      variantRaw,
      `${label}.variants[${variantIndex}]`,
      issues,
      productId,
    );
    if (parsed) variants.push(parsed);
  }
  return {
    product: parsedProduct.input.product,
    defaultVariant,
    variants,
  };
}

function parseSnapshotCollectionRecord(
  value: unknown,
  index: number,
  partnerSlug: string,
  issues: ProductVariantIssue[],
): PartnerCatalogSnapshotCollectionRecord | null {
  const label = `collections[${index}]`;
  if (!isPlainObject(value)) {
    issues.push(issue("INVALID_JSON", `${label} must be an object.`));
    return null;
  }
  if (hasStatusKey(value) || hasPatchOperationKey(value).length > 0) {
    issues.push(issue("UNSUPPORTED_OPERATION", `${label} must not include status or patch keys.`));
    return null;
  }
  const extra = unknownKeys(value, SNAPSHOT_COLLECTION_KEYS);
  if (extra.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `${label} contains unsupported fields: ${extra.join(", ")}.`,
    ));
    return null;
  }
  const collectionId = asNonEmptyString(value.collectionId);
  const name = asNonEmptyString(value.name);
  if (!collectionId) {
    issues.push(issue("INVALID_COLLECTION_ID", `${label}.collectionId must be a non-empty string.`));
  }
  if (!name) {
    issues.push(issue("EMPTY_COLLECTION_NAME", `${label}.name must be non-empty.`));
  }
  let slug = asNonEmptyString(value.slug);
  if ("slug" in value && !slug) {
    issues.push(issue("INVALID_COLLECTION_SLUG", `${label}.slug must be a non-empty string.`));
  }
  if (!slug && collectionId) {
    slug = suffixAfterPrefix(collectionId, `col-${partnerSlug}-`);
  }
  if (!collectionId || !name || !slug) {
    if (collectionId && name && !slug) {
      issues.push(issue(
        "COLLECTION_NAMESPACE_MISMATCH",
        `${label} Collection ID is not in Partner ${partnerSlug} namespace.`,
      ));
    }
    return null;
  }
  return { collectionId, name, slug };
}

export function parsePartnerCatalogSnapshotJson(value: unknown): Readonly<{
  ok: true;
  document: PartnerCatalogSnapshotDocument;
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
      issues: [issue("INVALID_JSON", "Partner snapshot JSON must be an object.")],
    };
  }
  const extra = unknownKeys(value, SNAPSHOT_TOP_LEVEL_KEYS);
  if (extra.length > 0) {
    issues.push(issue("UNSUPPORTED_OPERATION", `Unsupported top-level fields: ${extra.join(", ")}.`));
  }
  const patchKeys = hasPatchOperationKey(value);
  if (patchKeys.length > 0) {
    issues.push(issue(
      "UNSUPPORTED_OPERATION",
      `Snapshot documents must not include patch operations: ${patchKeys.join(", ")}.`,
    ));
  }
  const partnerId = asNonEmptyString(value.partnerId);
  if (!partnerId) {
    issues.push(issue("INVALID_PARTNER_ID", "partnerId must be a non-empty string."));
  }
  const mode = asNonEmptyString(value.mode);
  if (mode !== "snapshot") {
    issues.push(issue("UNSUPPORTED_OPERATION", 'Partner snapshot mode must be "snapshot".'));
  }
  const scope = asNonEmptyString(value.scope);
  if (scope !== PARTNER_CATALOG_SNAPSHOT_SCOPE) {
    issues.push(issue(
      "SNAPSHOT_SCOPE_REQUIRED",
      `scope must be "${PARTNER_CATALOG_SNAPSHOT_SCOPE}".`,
    ));
  }
  if (!isPlainObject(value.partner)) {
    issues.push(issue("INVALID_JSON", "partner must be an object with status only."));
  }
  let partnerStatus: StagePartnerStatus | null = null;
  if (isPlainObject(value.partner)) {
    if (hasPatchOperationKey(value.partner).length > 0) {
      issues.push(issue("UNSUPPORTED_OPERATION", "partner must not include patch operations."));
    }
    const extraPartner = unknownKeys(value.partner, SNAPSHOT_PARTNER_KEYS);
    if (extraPartner.length > 0) {
      issues.push(issue(
        "UNSUPPORTED_OPERATION",
        `Partner snapshot supports status only. Unsupported fields: ${extraPartner.join(", ")}.`,
      ));
    }
    const status = asNonEmptyString(value.partner.status);
    if (status !== "active" && status !== "inactive") {
      issues.push(issue("INVALID_PARTNER_STATUS", "partner.status must be active or inactive."));
    } else {
      partnerStatus = status;
    }
  }
  if (value.collections == null || !Array.isArray(value.collections)) {
    issues.push(issue("INVALID_JSON", "collections must be an array."));
  }
  if (value.products == null || !Array.isArray(value.products)) {
    issues.push(issue("INVALID_JSON", "products must be an array."));
  }
  if (isPlainObject(value.products)) {
    issues.push(issue("UNSUPPORTED_OPERATION", "products must be a complete-record array, not a patch object."));
  }
  if (isPlainObject(value.variants)) {
    issues.push(issue("UNSUPPORTED_OPERATION", "variants must be nested under present Products."));
  }

  const partnerSlug = partnerId ? suffixAfterPrefix(partnerId, "partner-") : null;
  const collections: PartnerCatalogSnapshotCollectionRecord[] = [];
  const collectionIds = new Set<string>();
  if (Array.isArray(value.collections) && partnerSlug) {
    for (const [index, raw] of value.collections.entries()) {
      const parsed = parseSnapshotCollectionRecord(raw, index, partnerSlug, issues);
      if (!parsed) continue;
      if (collectionIds.has(parsed.collectionId)) {
        issues.push(issue(
          "DUPLICATE_COLLECTION_ID",
          `Collection ${parsed.collectionId} is listed more than once.`,
        ));
        continue;
      }
      collectionIds.add(parsed.collectionId);
      collections.push(parsed);
    }
  }

  const products: PartnerCatalogSnapshotProductRecord[] = [];
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  if (Array.isArray(value.products)) {
    for (const [index, raw] of value.products.entries()) {
      const parsed = parseSnapshotProductRecord(raw, index, issues);
      if (!parsed) continue;
      if (productIds.has(parsed.product.productId)) {
        issues.push(issue(
          "DUPLICATE_PRODUCT_ID",
          `Product ${parsed.product.productId} is listed more than once.`,
        ));
        continue;
      }
      productIds.add(parsed.product.productId);
      const allVariants = [parsed.defaultVariant, ...parsed.variants];
      for (const variant of allVariants) {
        if (variantIds.has(variant.variantId)) {
          issues.push(issue(
            "DUPLICATE_VARIANT_ID",
            `Variant ${variant.variantId} is listed more than once.`,
          ));
        }
        variantIds.add(variant.variantId);
      }
      products.push(parsed);
    }
  }

  if (issues.length > 0 || !partnerId || partnerStatus == null) {
    return { ok: false, document: null, issues };
  }
  return {
    ok: true,
    document: {
      partnerId,
      mode: "snapshot",
      scope: PARTNER_CATALOG_SNAPSHOT_SCOPE,
      partner: { status: partnerStatus },
      collections,
      products,
    },
    issues: [],
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

export function renderPartnerCatalogSnapshotSql(input: Readonly<{
  partner: StagePartner;
  partnerStatusTransition: PlannedPartnerStatusTransition | null;
  productCreates: readonly PlannedProductCreate[];
  productUpdates: readonly PlannedProductUpdate[];
  variantCreates: readonly PlannedVariantCreate[];
  variantUpdates: readonly PlannedVariantUpdate[];
  collectionCreates: readonly PlannedCollectionCreate[];
  collectionUpdates: readonly PlannedCollectionUpdate[];
  membershipAdds: readonly PlannedMembership[];
  membershipRemoves: readonly PlannedMembership[];
  productDeactivations: readonly PlannedProductStatusTransition[];
  productReactivations: readonly PlannedProductStatusTransition[];
  variantDeactivations: readonly PlannedVariantStatusTransition[];
  variantReactivations: readonly PlannedVariantStatusTransition[];
  current: FoldedPartnerCatalogState;
}>): string {
  const parts: string[] = [];
  const assetIds = [...new Set(
    input.variantCreates
      .map((item) => item.variant.assetId)
      .filter((assetId): assetId is string => !!assetId),
  )].sort();
  const prelude: string[] = [];

  for (const assetId of assetIds) {
    prelude.push(
      `  if not exists (\n` +
      `    select 1\n` +
      `    from public.vibode_stage_assets\n` +
      `    where asset_id = ${sqlString(assetId)}\n` +
      `      and status = 'ready'\n` +
      `  ) then\n` +
      `    raise exception 'Target Asset is missing or not ready';\n` +
      `  end if;`,
    );
  }
  for (const create of [...input.collectionCreates].sort((a, b) => (
    a.collection.collectionId.localeCompare(b.collection.collectionId)
  ))) {
    prelude.push(
      `  if exists (\n` +
      `    select 1\n` +
      `    from public.vibode_stage_collections\n` +
      `    where collection_id = ${sqlString(create.collection.collectionId)}\n` +
      `  ) then\n` +
      `    raise exception 'Collection already exists';\n` +
      `  end if;`,
    );
  }
  for (const create of [...input.productCreates].sort((a, b) => (
    a.product.productId.localeCompare(b.product.productId)
  ))) {
    prelude.push(
      `  if exists (\n` +
      `    select 1\n` +
      `    from public.vibode_stage_products\n` +
      `    where product_id = ${sqlString(create.product.productId)}\n` +
      `  ) then\n` +
      `    raise exception 'Product already exists';\n` +
      `  end if;`,
    );
  }
  for (const create of [...input.variantCreates].sort((a, b) => (
    a.variant.variantId.localeCompare(b.variant.variantId)
  ))) {
    prelude.push(
      `  if exists (\n` +
      `    select 1\n` +
      `    from public.vibode_stage_variants\n` +
      `    where variant_id = ${sqlString(create.variant.variantId)}\n` +
      `  ) then\n` +
      `    raise exception 'Variant already exists';\n` +
      `  end if;`,
    );
  }
  const skuItems = [
    ...input.variantCreates.filter((item) => item.variant.sku),
    ...input.variantUpdates.filter((item) => item.changes.some((change) => change.column === "sku" && change.next)),
  ];
  for (const item of skuItems) {
    const sku = "variant" in item ? item.variant.sku : item.changes.find((change) => change.column === "sku")?.next;
    const variantId = "variant" in item ? item.variant.variantId : item.variantId;
    if (typeof sku !== "string") continue;
    prelude.push(
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
      `  end if;`,
    );
  }
  for (const membership of input.membershipAdds) {
    prelude.push(
      `  if not exists (\n` +
      `    select 1\n` +
      `    from public.vibode_stage_products products\n` +
      `    join public.vibode_stage_collections collections\n` +
      `      on collections.collection_id = ${sqlString(membership.collectionId)}\n` +
      `     and collections.partner_id = products.partner_id\n` +
      `     and collections.owner = 'partner'\n` +
      `    where products.product_id = ${sqlString(membership.productId)}\n` +
      `      and products.partner_id = ${sqlString(input.partner.partnerId)}\n` +
      `      and products.source = 'partner_catalog'\n` +
      `  ) then\n` +
      `    raise exception 'COLLECTION_OWNER_MISMATCH';\n` +
      `  end if;`,
    );
  }
  if (prelude.length > 0) {
    parts.push(`do $$\nbegin\n${prelude.join("\n\n")}\nend $$;`);
  }

  if (input.partnerStatusTransition?.to === "active") {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_partners",
      setClauses: [`status = ${sqlString("active")}`],
      whereClauses: [
        `partner_id = ${sqlString(input.partner.partnerId)}`,
        `status = ${sqlString(input.partnerStatusTransition.from)}`,
      ],
    }));
  }

  for (const create of [...input.collectionCreates].sort((a, b) => (
    a.collection.collectionId.localeCompare(b.collection.collectionId)
  ))) {
    parts.push(
      `insert into public.vibode_stage_collections (\n` +
      `  collection_id,\n` +
      `  name,\n` +
      `  owner,\n` +
      `  partner_name,\n` +
      `  partner_id,\n` +
      `  status,\n` +
      `  sort_order\n` +
      `) values (\n` +
      `  ${sqlString(create.collection.collectionId)},\n` +
      `  ${sqlString(create.collection.name)},\n` +
      `  'partner',\n` +
      `  ${sqlString(input.partner.name)},\n` +
      `  ${sqlString(input.partner.partnerId)},\n` +
      `  'active',\n` +
      `  ${sqlNumber(create.sortOrder)}\n` +
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

  for (const create of [...input.productCreates].sort((a, b) => (
    a.product.productId.localeCompare(b.product.productId)
  ))) {
    const product = create.product;
    parts.push(
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
      `  ${sqlString(product.productId)},\n` +
      `  ${sqlString(product.name)},\n` +
      `  ${sqlString(product.brand)},\n` +
      `  ${sqlString(product.retailer)},\n` +
      `  ${sqlString(product.imageUrl)},\n` +
      `  ${sqlNullableString(product.productUrl)},\n` +
      `  ${sqlNumber(product.priceAmount ?? 0)},\n` +
      `  ${sqlString(product.priceCurrency)},\n` +
      `  ${sqlString(product.categoryId)},\n` +
      `  ${sqlNullableString(product.subcategoryId)},\n` +
      `  'partner_catalog',\n` +
      `  ${sqlString(input.partner.partnerId)},\n` +
      `  ${sqlString(product.defaultVariantId)},\n` +
      `  'active',\n` +
      `  ${sqlNumber(create.sortOrder)}\n` +
      `);`,
    );
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

  for (const update of [...input.variantUpdates].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_variants",
      setClauses: update.changes.map((change) => (
        `${change.column} = ${typeof change.next === "number" ? sqlNumber(change.next) : sqlNullableString(change.next)}`
      )),
      whereClauses: [
        `variant_id = ${sqlString(update.variantId)}`,
        `product_id = ${sqlString(update.productId)}`,
        ...update.changes.map((change) => sqlIsNotDistinctFrom(change.column, change.previous)),
      ],
    }));
  }

  for (const update of [...input.productUpdates].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const current = input.current.products.find((item) => item.productId === update.productId);
    if (!current) continue;
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_products",
      setClauses: update.changes.map((change) => (
        `${change.column} = ${typeof change.next === "number" ? sqlNumber(change.next) : sqlNullableString(change.next)}`
      )),
      whereClauses: [
        `product_id = ${sqlString(update.productId)}`,
        `partner_id = ${sqlString(input.partner.partnerId)}`,
        `source = 'partner_catalog'`,
        ...update.changes.map((change) => sqlIsNotDistinctFrom(change.column, change.previous)),
      ],
    }));
  }

  for (const transition of [...input.variantReactivations].sort((a, b) => (
    a.variantId.localeCompare(b.variantId)
  ))) {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_variants",
      setClauses: [`status = ${sqlString(transition.to)}`],
      whereClauses: [
        `variant_id = ${sqlString(transition.variantId)}`,
        `product_id = ${sqlString(transition.productId)}`,
        `status = ${sqlString(transition.from)}`,
        `exists (\n` +
        `      select 1\n` +
        `      from public.vibode_stage_products products\n` +
        `      where products.product_id = ${sqlString(transition.productId)}\n` +
        `        and products.partner_id = ${sqlString(input.partner.partnerId)}\n` +
        `        and products.source = 'partner_catalog'\n` +
        `    )`,
      ],
    }));
  }

  for (const transition of [...input.productReactivations].sort((a, b) => (
    a.productId.localeCompare(b.productId)
  ))) {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_products",
      setClauses: [`status = ${sqlString(transition.to)}`],
      whereClauses: [
        `product_id = ${sqlString(transition.productId)}`,
        `partner_id = ${sqlString(input.partner.partnerId)}`,
        `source = 'partner_catalog'`,
        `status = ${sqlString(transition.from)}`,
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

  for (const transition of [...input.variantDeactivations].sort((a, b) => (
    a.variantId.localeCompare(b.variantId)
  ))) {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_variants",
      setClauses: [`status = ${sqlString(transition.to)}`],
      whereClauses: [
        `variant_id = ${sqlString(transition.variantId)}`,
        `product_id = ${sqlString(transition.productId)}`,
        `status = ${sqlString(transition.from)}`,
        `exists (\n` +
        `      select 1\n` +
        `      from public.vibode_stage_products products\n` +
        `      where products.product_id = ${sqlString(transition.productId)}\n` +
        `        and products.partner_id = ${sqlString(input.partner.partnerId)}\n` +
        `        and products.source = 'partner_catalog'\n` +
        `    )`,
      ],
    }));
  }

  for (const transition of [...input.productDeactivations].sort((a, b) => (
    a.productId.localeCompare(b.productId)
  ))) {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_products",
      setClauses: [`status = ${sqlString(transition.to)}`],
      whereClauses: [
        `product_id = ${sqlString(transition.productId)}`,
        `partner_id = ${sqlString(input.partner.partnerId)}`,
        `source = 'partner_catalog'`,
        `status = ${sqlString(transition.from)}`,
      ],
    }));
  }

  if (input.partnerStatusTransition?.to === "inactive") {
    parts.push(renderGuardedUpdate({
      table: "public.vibode_stage_partners",
      setClauses: [`status = ${sqlString("inactive")}`],
      whereClauses: [
        `partner_id = ${sqlString(input.partner.partnerId)}`,
        `status = ${sqlString(input.partnerStatusTransition.from)}`,
      ],
    }));
  }

  const header = (
    `-- PI-5F3C: Partner catalog snapshot sync.\n` +
    `--\n` +
    `-- Full Partner desired commercial state. Presence is active.\n` +
    `-- Omission within full_partner_catalog scope deactivates Product/Variant.\n` +
    `-- Partner status is availability only; no Product/Variant cascade.\n` +
    `-- Present Collections exact-sync membership. Omitted Collections unchanged.\n` +
    `-- Scene geometry remains frozen to SceneObject.assetId.\n` +
    `-- Inactive identities remain resolvable. No hard deletes.\n` +
    `-- Does not mutate Assets, current_asset_id, Scene Objects, or identities.\n` +
    `-- PI-5D2B remains the only Variant Asset retarget path.\n` +
    `-- Snapshot authority may reactivate identities previously patched inactive.\n` +
    `-- Collection retirement and Partner metadata mutation remain deferred.\n`
  );

  return (
    header +
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

export function planPartnerCatalogSnapshotSync(input: Readonly<{
  current: FoldedPartnerCatalogState;
  document: PartnerCatalogSnapshotDocument;
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
  const seed = input.catalog ?? STAGE_SEED_CATALOG;
  const gates: ProductVariantValidationGates = {
    catalog: seed,
    seedAssets: input.seedAssets,
    manifest: input.manifest,
    repoRoot,
    manifestRepoRoot: input.manifestRepoRoot ?? process.cwd(),
    runtimeAssetIds: input.runtimeAssetIds,
    runtimeDefinitionKnown: input.runtimeDefinitionKnown,
  };
  const partner = input.current.partners.find((item) => (
    item.partnerId === input.document.partnerId
  )) ?? null;
  if (!partner) {
    return failedPlan(
      [issue("PARTNER_MISMATCH", `Unknown Partner ${input.document.partnerId}.`)],
      input.document.partnerId,
    );
  }

  const working = cloneMutable(input.current);
  const currentProducts = new Map(working.products.map((item) => [item.productId, item]));
  const currentVariants = new Map(working.variants.map((item) => [item.variantId, item]));
  const currentCollections = new Map(working.collections.map((item) => [item.collectionId, item]));

  const presentProductIds = new Set(input.document.products.map((item) => item.product.productId));
  const presentCollectionIds = new Set(input.document.collections.map((item) => item.collectionId));
  const snapshotProductById = new Map(
    input.document.products.map((item) => [item.product.productId, item]),
  );
  const snapshotVariantsByProduct = new Map<string, PartnerCatalogSnapshotVariantRecord[]>();
  for (const record of input.document.products) {
    const variants = [record.defaultVariant, ...record.variants];
    snapshotVariantsByProduct.set(record.product.productId, variants);
  }

  if (input.document.partner.status !== partner.status) {
    const index = working.partners.findIndex((item) => item.partnerId === partner.partnerId);
    if (index >= 0) {
      working.partners[index] = { ...partner, status: input.document.partner.status };
    }
  }

  for (const collectionRecord of input.document.collections) {
    const existing = currentCollections.get(collectionRecord.collectionId);
    if (!existing) {
      issues.push(...validatePartnerCollection({
        collection: collectionRecord,
        partner,
        existingCollectionIds: working.collections.map((item) => item.collectionId),
        catalogCollectionIds: seed.collections.map((item) => item.collectionId),
      }));
      const expected = namespacedId("col", partner.slug, collectionRecord.slug);
      if (collectionRecord.collectionId !== expected) {
        issues.push(issue(
          "COLLECTION_NAMESPACE_MISMATCH",
          `Collection ID ${collectionRecord.collectionId} must be ${expected}.`,
        ));
      }
      working.collections.push({
        collectionId: collectionRecord.collectionId,
        name: collectionRecord.name,
        owner: "partner",
        partnerName: partner.name,
        partnerId: partner.partnerId,
        productIds: [],
      });
      currentCollections.set(collectionRecord.collectionId, working.collections[working.collections.length - 1]!);
      continue;
    }
    if (existing.partnerId !== partner.partnerId || existing.owner !== "partner") {
      issues.push(issue(
        "PARTNER_MISMATCH",
        `Collection ${collectionRecord.collectionId} is not owned by ${partner.partnerId}.`,
      ));
      continue;
    }
    const expected = namespacedId("col", partner.slug, collectionRecord.slug);
    if (collectionRecord.collectionId !== expected) {
      issues.push(issue(
        "IDENTITY_IMMUTABLE",
        `Collection ${collectionRecord.collectionId} slug/ID relationship is immutable.`,
      ));
    }
    const nextCollection: MutableCollection = {
      ...existing,
      name: collectionRecord.name,
      partnerName: partner.name,
    };
    replaceCollection(working, nextCollection);
    currentCollections.set(nextCollection.collectionId, nextCollection);
  }

  for (const record of input.document.products) {
    const productIn = record.product;
    const existing = currentProducts.get(productIn.productId);
    if (existing && !partnerOwnedProduct(existing, partner.partnerId)) {
      issues.push(issue(
        "PARTNER_MISMATCH",
        `Product ${productIn.productId} is not owned by ${partner.partnerId}.`,
      ));
      continue;
    }
    if (!existing) {
      const seedProduct = seed.products.find((item) => item.productId === productIn.productId);
      if (seedProduct) {
        issues.push(issue(
          "PARTNER_MISMATCH",
          `Product ${productIn.productId} belongs to another catalog owner.`,
        ));
        continue;
      }
    }
    if (productIn.partnerId !== partner.partnerId) {
      issues.push(issue(
        "PRODUCT_PARTNER_MISMATCH",
        `Product ${productIn.productId} partnerId does not match the snapshot Partner.`,
      ));
    }
    if (productIn.source !== "partner_catalog") {
      issues.push(issue(
        "IDENTITY_IMMUTABLE",
        `Product ${productIn.productId} source must remain partner_catalog.`,
      ));
    }
    if (productIn.brand !== partner.name || productIn.retailer !== partner.name) {
      issues.push(issue(
        "PARTNER_NAME_MISMATCH",
        `Product ${productIn.productId} brand/retailer must match Partner name.`,
      ));
    }
    const productSlug = suffixAfterPrefix(productIn.productId, `prod-${partner.slug}-`);
    if (!isCommercialId(productIn.productId) || isUuidLike(productIn.productId)) {
      issues.push(issue("INVALID_PRODUCT_ID", `Invalid Product ID ${productIn.productId}.`));
    } else if (!productSlug) {
      issues.push(issue(
        "PRODUCT_NAMESPACE_MISMATCH",
        `Product ${productIn.productId} is not in Partner ${partner.slug} namespace.`,
      ));
    }
    const defaultPrefix = productSlug ? `var-${partner.slug}-${productSlug}-` : null;
    const allVariants = snapshotVariantsByProduct.get(productIn.productId) ?? [];
    for (const variant of allVariants) {
      if (defaultPrefix && !variant.variantId.startsWith(defaultPrefix)) {
        issues.push(issue(
          "VARIANT_NAMESPACE_MISMATCH",
          `Variant ${variant.variantId} is not in Product ${productIn.productId} namespace.`,
        ));
      }
    }
    for (const collectionId of productIn.collectionIds) {
      const snapshotCollection = presentCollectionIds.has(collectionId);
      const existingCollection = currentCollections.get(collectionId);
      if (!snapshotCollection && !existingCollection) {
        const seedCollection = seed.collections.find((item) => item.collectionId === collectionId);
        if (!seedCollection) {
          issues.push(issue("UNKNOWN_COLLECTION", `Unknown Collection ${collectionId}.`));
        } else {
          issues.push(issue(
            "COLLECTION_OWNER_MISMATCH",
            `Product ${productIn.productId} cannot join Collection ${collectionId}.`,
          ));
        }
        continue;
      }
      const collection = existingCollection ?? currentCollections.get(collectionId);
      if (collection && (collection.partnerId !== partner.partnerId || collection.owner !== "partner")) {
        issues.push(issue(
          "COLLECTION_OWNER_MISMATCH",
          `Product ${productIn.productId} does not match Collection ${collectionId} ownership.`,
        ));
      }
    }

    if (!existing) {
      const foldedWorking = freezeFoldedState(working);
      const registration = validateProductVariantRegistration({
        product: productIn,
        defaultVariant: record.defaultVariant,
      }, { ...gates, catalog: overlayState(foldedWorking, seed), repoRoot });
      if (!registration.ok) {
        issues.push(...registration.errors);
        continue;
      }
      working.products.push({
        ...registration.parsed.product,
        collectionIds: [],
        status: "active",
      });
      currentProducts.set(productIn.productId, working.products[working.products.length - 1]!);
      working.variants.push(registration.parsed.variant);
      currentVariants.set(registration.parsed.variant.variantId, registration.parsed.variant);
      let productWorkingCatalog = overlayState(freezeFoldedState(working), seed);
      for (const extra of record.variants) {
        const extraValidation = validateVariantRegistration({
          productId: productIn.productId,
          variant: extra,
        }, { ...gates, catalog: productWorkingCatalog, repoRoot });
        if (!extraValidation.ok) {
          issues.push(...extraValidation.errors);
          continue;
        }
        working.variants.push(extraValidation.parsed.variant);
        currentVariants.set(extra.variantId, extraValidation.parsed.variant);
        productWorkingCatalog = overlayState(freezeFoldedState(working), seed);
      }
      continue;
    }

    if (normalizeCurrency(productIn.priceCurrency) !== existing.priceCurrency) {
      issues.push(issue("CURRENCY_IMMUTABLE", `Product ${productIn.productId} currency is immutable.`));
    }
    issues.push(...validateRequiredAbsoluteHttpsUrl(productIn.productUrl));
    issues.push(...validatePartnerCatalogImageUrl(productIn.imageUrl, repoRoot));
    issues.push(...validateBrowseTaxonomy(productIn.categoryId, productIn.subcategoryId));
    issues.push(...validateFiniteNonNegativePrice(productIn.priceAmount, "Product"));
    const nextProduct: MutableProduct = {
      ...existing,
      name: productIn.name,
      imageUrl: productIn.imageUrl,
      productUrl: productIn.productUrl,
      priceAmount: productIn.priceAmount,
      categoryId: productIn.categoryId,
      subcategoryId: productIn.subcategoryId,
      defaultVariantId: record.defaultVariant.variantId,
      brand: partner.name,
      retailer: partner.name,
      status: "active",
    };
    replaceProduct(working, nextProduct);
    currentProducts.set(nextProduct.productId, nextProduct);

    const presentVariantIds = new Set(allVariants.map((item) => item.variantId));
    for (const variantRecord of allVariants) {
      const currentVariant = currentVariants.get(variantRecord.variantId);
      if (currentVariant && currentVariant.productId !== productIn.productId) {
        issues.push(issue(
          "IDENTITY_IMMUTABLE",
          `Variant ${variantRecord.variantId} productId is immutable.`,
        ));
        continue;
      }
      if (!currentVariant) {
        const seedVariant = seed.variants.find((item) => item.variantId === variantRecord.variantId);
        if (seedVariant) {
          issues.push(issue(
            "PARTNER_MISMATCH",
            `Variant ${variantRecord.variantId} belongs to another catalog owner.`,
          ));
          continue;
        }
        const foldedWorking = freezeFoldedState(working);
        const extraValidation = validateVariantRegistration({
          productId: productIn.productId,
          variant: variantRecord,
        }, { ...gates, catalog: overlayState(foldedWorking, seed), repoRoot });
        if (!extraValidation.ok) {
          issues.push(...extraValidation.errors);
          continue;
        }
        working.variants.push(extraValidation.parsed.variant);
        currentVariants.set(variantRecord.variantId, extraValidation.parsed.variant);
        continue;
      }
      if (normalizeCurrency(variantRecord.priceCurrency) !== currentVariant.priceCurrency) {
        issues.push(issue("CURRENCY_IMMUTABLE", `Variant ${variantRecord.variantId} currency is immutable.`));
      }
      if (variantRecord.currentAssetId !== currentVariant.assetId) {
        issues.push(issue(
          "ASSET_RETARGET_REQUIRED",
          `Variant ${variantRecord.variantId} currentAssetId changes require PI-5D2B.`,
        ));
      }
      if (currentVariant.priceAmount != null || variantRecord.priceAmount != null) {
        issues.push(...validateFiniteNonNegativePrice(variantRecord.priceAmount, "Variant"));
      }
      issues.push(...validateOptionalAbsoluteHttpsUrl(variantRecord.productUrl));
      const wasInactive = !isStageCommercialActive(currentVariant.status);
      if (wasInactive) {
        const catalogForAsset = overlayState(freezeFoldedState(working), seed);
        const asset = stageAssetById(currentVariant.assetId, catalogForAsset);
        if (!currentVariant.assetId || !isStageAssetReady(asset)) {
          issues.push(issue(
            "UNAVAILABLE_ASSET",
            `Variant ${variantRecord.variantId} current Asset is missing or not ready.`,
          ));
        } else {
          validateTargetAsset(currentVariant.assetId, { ...gates, catalog: catalogForAsset }, issues);
        }
      }
      const nextVariant: StageVariant = {
        ...currentVariant,
        finishLabel: variantRecord.finishLabel,
        sku: variantRecord.sku,
        priceAmount: variantRecord.priceAmount,
        productUrl: variantRecord.productUrl,
        status: "active",
      };
      const variantIndex = working.variants.findIndex((item) => item.variantId === nextVariant.variantId);
      if (variantIndex >= 0) working.variants[variantIndex] = nextVariant;
      currentVariants.set(nextVariant.variantId, nextVariant);
    }
    for (const currentVariant of working.variants) {
      if (currentVariant.productId !== productIn.productId) continue;
      if (presentVariantIds.has(currentVariant.variantId)) continue;
      if (isStageCommercialActive(currentVariant.status)) {
        const nextVariant: StageVariant = { ...currentVariant, status: "inactive" };
        const variantIndex = working.variants.findIndex((item) => item.variantId === currentVariant.variantId);
        if (variantIndex >= 0) working.variants[variantIndex] = nextVariant;
        currentVariants.set(currentVariant.variantId, nextVariant);
      }
    }
  }

  for (const product of working.products) {
    if (!partnerOwnedProduct(product, partner.partnerId)) continue;
    if (presentProductIds.has(product.productId)) continue;
    if (isStageCommercialActive(product.status)) {
      const nextProduct: MutableProduct = { ...product, status: "inactive" };
      replaceProduct(working, nextProduct);
      currentProducts.set(nextProduct.productId, nextProduct);
    }
  }

  const desiredMembers = new Map<string, Set<string>>();
  for (const collectionId of presentCollectionIds) {
    desiredMembers.set(collectionId, new Set());
  }
  for (const record of input.document.products) {
    for (const collectionId of record.product.collectionIds) {
      if (!presentCollectionIds.has(collectionId)) continue;
      desiredMembers.get(collectionId)?.add(record.product.productId);
    }
  }
  for (const collection of working.collections) {
    if (collection.partnerId !== partner.partnerId || collection.owner !== "partner") continue;
    if (!presentCollectionIds.has(collection.collectionId)) continue;
    const desired = desiredMembers.get(collection.collectionId) ?? new Set<string>();
    collection.productIds = exactMembership(collection.productIds, desired);
  }
  for (const product of working.products) {
    if (!partnerOwnedProduct(product, partner.partnerId)) continue;
    const preserved = product.collectionIds.filter((collectionId) => {
      const collection = currentCollections.get(collectionId);
      return !!collection &&
        collection.partnerId === partner.partnerId &&
        !presentCollectionIds.has(collectionId);
    });
    const snapshotRecord = snapshotProductById.get(product.productId);
    const fromPresent = (snapshotRecord?.product.collectionIds ?? []).filter((collectionId) => (
      presentCollectionIds.has(collectionId)
    ));
    product.collectionIds = uniquePreserveOrder([...preserved, ...fromPresent]);
  }

  const nextState = freezeFoldedState(working);
  const nextCatalog = overlayState(nextState, seed);
  const nextProductById = new Map(nextState.products.map((item) => [item.productId, item]));
  const nextVariantById = new Map(nextState.variants.map((item) => [item.variantId, item]));
  const nextVariantsByProduct = new Map<string, StageVariant[]>();
  for (const variant of nextState.variants) {
    const list = nextVariantsByProduct.get(variant.productId) ?? [];
    list.push(variant);
    nextVariantsByProduct.set(variant.productId, list);
  }

  for (const product of nextState.products) {
    if (product.partnerId !== partner.partnerId) continue;
    const defaultVariant = nextVariantById.get(product.defaultVariantId) ?? null;
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
    } else if (
      isStageCommercialActive(product.status) &&
      !isStageCommercialActive(defaultVariant.status)
    ) {
      issues.push(issue(
        "DEFAULT_VARIANT_INACTIVE",
        `Active Product ${product.productId} cannot have inactive default Variant ${product.defaultVariantId}.`,
      ));
    }
    if (presentProductIds.has(product.productId)) {
      const snapshotRecord = snapshotProductById.get(product.productId);
      if (snapshotRecord && snapshotRecord.defaultVariant.variantId !== product.defaultVariantId) {
        issues.push(issue(
          "DEFAULT_VARIANT_MISMATCH",
          `Product ${product.productId} default Variant must be explicit in the snapshot.`,
        ));
      }
      if (
        snapshotRecord &&
        !snapshotVariantsByProduct.get(product.productId)?.some((item) => (
          item.variantId === snapshotRecord.defaultVariant.variantId
        ))
      ) {
        issues.push(issue(
          "DEFAULT_VARIANT_MISMATCH",
          `Product ${product.productId} default Variant must be present in the snapshot.`,
        ));
      }
    }
    if (isStageCommercialActive(product.status)) {
      const activeVariants = (nextVariantsByProduct.get(product.productId) ?? []).filter((variant) => (
        isStageCommercialActive(variant.status)
      ));
      if (activeVariants.length === 0) {
        issues.push(issue(
          "LAST_ACTIVE_VARIANT",
          `Active Product ${product.productId} cannot remain with zero active Variants.`,
        ));
      }
    }
  }

  for (const variant of nextState.variants) {
    const product = nextProductById.get(variant.productId);
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
    return failedPlan(issues, partner.partnerId);
  }

  const currentProductById = new Map(input.current.products.map((item) => [item.productId, item]));
  const currentVariantById = new Map(input.current.variants.map((item) => [item.variantId, item]));
  const currentCollectionById = new Map(input.current.collections.map((item) => [item.collectionId, item]));

  const productCreates: PlannedProductCreate[] = [];
  const productUpdates: PlannedProductUpdate[] = [];
  for (const next of nextState.products) {
    if (next.partnerId !== partner.partnerId) continue;
    const previous = currentProductById.get(next.productId);
    if (!previous) {
      productCreates.push({
        product: next,
        sortOrder: input.current.products.length + productCreates.length,
      });
      continue;
    }
    const changes: PlannedFieldChange[] = [];
    for (const field of PRODUCT_MUTABLE_FIELDS) {
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

  const variantCreates: PlannedVariantCreate[] = [];
  const variantUpdates: PlannedVariantUpdate[] = [];
  for (const next of nextState.variants) {
    const product = nextProductById.get(next.productId);
    if (!product || product.partnerId !== partner.partnerId) continue;
    const previous = currentVariantById.get(next.variantId);
    if (!previous) {
      variantCreates.push({ variant: next });
      continue;
    }
    const changes: PlannedFieldChange[] = [];
    for (const field of VARIANT_MUTABLE_FIELDS) {
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

  const collectionCreates: PlannedCollectionCreate[] = [];
  const collectionUpdates: PlannedCollectionUpdate[] = [];
  for (const next of nextState.collections) {
    if (next.partnerId !== partner.partnerId) continue;
    const previous = currentCollectionById.get(next.collectionId);
    if (!previous) {
      collectionCreates.push({
        collection: next,
        sortOrder: input.current.collections.length + collectionCreates.length,
      });
      continue;
    }
    if (previous.name !== next.name) {
      collectionUpdates.push({
        collectionId: next.collectionId,
        name: next.name,
        previousName: previous.name,
      });
    }
  }

  const membershipAdds: PlannedMembership[] = [];
  const membershipRemoves: PlannedMembership[] = [];
  for (const collection of nextState.collections) {
    if (collection.partnerId !== partner.partnerId || !presentCollectionIds.has(collection.collectionId)) {
      continue;
    }
    const previous = currentCollectionById.get(collection.collectionId);
    const previousIds = previous?.productIds ?? [];
    const previousSet = new Set(previousIds);
    const nextSet = new Set(collection.productIds);
    for (const [index, productId] of collection.productIds.entries()) {
      if (!previousSet.has(productId)) {
        membershipAdds.push({
          productId,
          collectionId: collection.collectionId,
          sortOrder: index,
        });
      }
    }
    for (const productId of previousIds) {
      if (!nextSet.has(productId)) {
        membershipRemoves.push({
          productId,
          collectionId: collection.collectionId,
        });
      }
    }
  }

  const productDeactivations: PlannedProductStatusTransition[] = [];
  const productReactivations: PlannedProductStatusTransition[] = [];
  for (const next of nextState.products) {
    if (next.partnerId !== partner.partnerId) continue;
    const previous = currentProductById.get(next.productId);
    if (!previous) continue;
    const from = stageCommercialStatus(previous.status);
    const to = stageCommercialStatus(next.status);
    if (from === to) continue;
    const transition = { productId: next.productId, from, to };
    if (to === "inactive") productDeactivations.push(transition);
    else productReactivations.push(transition);
  }

  const variantDeactivations: PlannedVariantStatusTransition[] = [];
  const variantReactivations: PlannedVariantStatusTransition[] = [];
  for (const next of nextState.variants) {
    const product = nextProductById.get(next.productId);
    if (!product || product.partnerId !== partner.partnerId) continue;
    const previous = currentVariantById.get(next.variantId);
    if (!previous) continue;
    const from = stageCommercialStatus(previous.status);
    const to = stageCommercialStatus(next.status);
    if (from === to) continue;
    const transition = {
      variantId: next.variantId,
      productId: next.productId,
      from,
      to,
    };
    if (to === "inactive") variantDeactivations.push(transition);
    else variantReactivations.push(transition);
  }

  const nextPartner = nextState.partners.find((item) => item.partnerId === partner.partnerId) ?? partner;
  const partnerStatusTransition: PlannedPartnerStatusTransition | null =
    nextPartner.status === partner.status
      ? null
      : {
        partnerId: partner.partnerId,
        from: partner.status,
        to: nextPartner.status,
      };

  const noOp = (
    partnerStatusTransition == null &&
    productCreates.length === 0 &&
    productUpdates.length === 0 &&
    variantCreates.length === 0 &&
    variantUpdates.length === 0 &&
    collectionCreates.length === 0 &&
    collectionUpdates.length === 0 &&
    membershipAdds.length === 0 &&
    membershipRemoves.length === 0 &&
    productDeactivations.length === 0 &&
    productReactivations.length === 0 &&
    variantDeactivations.length === 0 &&
    variantReactivations.length === 0
  );

  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  const sqlSlug = input.sqlSlug ?? partnerCatalogSqlSlug(`${partner.slug}_snapshot`);
  const migration = path.join(
    productRegistrationRepoPaths(repoRoot).migrationsDir,
    snapshotMigrationFileName(timestamp, sqlSlug),
  );
  const sqlPlan: PartnerCatalogSyncSqlPlan | null = noOp
    ? null
    : {
      sql: renderPartnerCatalogSnapshotSql({
        partner: nextPartner,
        partnerStatusTransition,
        productCreates,
        productUpdates,
        variantCreates,
        variantUpdates,
        collectionCreates,
        collectionUpdates,
        membershipAdds,
        membershipRemoves,
        productDeactivations,
        productReactivations,
        variantDeactivations,
        variantReactivations,
        current: input.current,
      }),
      migration,
    };

  return {
    ok: true,
    noOp,
    issues: [],
    partnerId: partner.partnerId,
    partnerStatusTransition,
    productCreates,
    productUpdates,
    variantCreates,
    variantUpdates,
    collectionCreates,
    collectionUpdates,
    membershipAdds,
    membershipRemoves,
    productDeactivations,
    productReactivations,
    variantDeactivations,
    variantReactivations,
    sqlPlan,
    nextState,
  };
}
