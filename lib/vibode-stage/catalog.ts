import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import { seedAssetFromCanonical } from "@/lib/afc-v2-runtime/furniture-asset-map";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
} from "@/lib/afc-v2-runtime/types";

import type {
  StageAsset,
  StageCatalogSnapshot,
  StageCategory,
  StageCollection,
  StageCommercialStatus,
  StagePartner,
  StageProduct,
  StageVariant,
} from "./types";
import {
  GENERATED_REGISTERED_PRODUCTS,
  GENERATED_REGISTERED_VARIANTS,
} from "./catalog-commercial.generated";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

export const STAGE_STUDIO_SOFA_PRODUCT_ID = "prod-vibode-studio-sofa";
export const STAGE_STUDIO_SETTEE_PRODUCT_ID = "prod-vibode-studio-settee";
export const STAGE_STUDIO_CHAIR_PRODUCT_ID = "prod-vibode-studio-lounge-chair";
export const STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID = "prod-vibode-studio-side-table";

export const STAGE_STUDIO_SOFA_VARIANT_ID = "var-vibode-studio-sofa-default";
export const STAGE_STUDIO_SETTEE_VARIANT_ID = "var-vibode-studio-settee-default";
export const STAGE_STUDIO_CHAIR_VARIANT_ID = "var-vibode-studio-chair-default";
export const STAGE_STUDIO_SIDE_TABLE_VARIANT_ID = "var-vibode-studio-side-table-default";
export const STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID = "var-vibode-studio-side-table-walnut";
export const STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID = "var-vibode-studio-side-table-black";

export const STAGE_SEED_ASSETS: readonly StageAsset[] = Object.freeze(
  GENERATED_FURNITURE_ASSETS.map((asset) => seedAssetFromCanonical(asset)),
);

function certifiedSeedAsset(assetId: string): StageAsset {
  const asset = STAGE_SEED_ASSETS.find((item) => item.assetId === assetId);
  if (!asset) {
    throw new Error(`Certified seed Asset missing: ${assetId}`);
  }
  return asset;
}

export const STAGE_PI4A_SOFA_ASSET: StageAsset = certifiedSeedAsset(
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
);

export const STAGE_PI5D_LOUNGE_CHAIR_ASSET: StageAsset = certifiedSeedAsset(
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
);

export const STAGE_BROWSE_CATEGORIES: readonly StageCategory[] = Object.freeze([
  Object.freeze({
    id: "living-room",
    label: "Living Room",
    subcategories: Object.freeze([
      Object.freeze({ id: "sofas", label: "Sofas" }),
      Object.freeze({ id: "sectionals", label: "Sectionals" }),
      Object.freeze({ id: "chairs", label: "Chairs" }),
      Object.freeze({ id: "coffee-tables", label: "Coffee Tables" }),
      Object.freeze({ id: "side-tables", label: "Side Tables" }),
    ]),
  }),
  Object.freeze({
    id: "bedroom",
    label: "Bedroom",
    subcategories: Object.freeze([]),
  }),
  Object.freeze({
    id: "dining",
    label: "Dining",
    subcategories: Object.freeze([]),
  }),
  Object.freeze({
    id: "office",
    label: "Office",
    subcategories: Object.freeze([]),
  }),
  Object.freeze({
    id: "outdoor",
    label: "Outdoor",
    subcategories: Object.freeze([]),
  }),
  Object.freeze({
    id: "lighting",
    label: "Lighting",
    subcategories: Object.freeze([]),
  }),
  Object.freeze({
    id: "decor",
    label: "Decor",
    subcategories: Object.freeze([]),
  }),
  Object.freeze({
    id: "storage",
    label: "Storage",
    subcategories: Object.freeze([]),
  }),
]);

const STUDIO_SOFA: StageProduct = Object.freeze({
  productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
  brand: "Vibode",
  name: "Studio Sofa",
  retailer: "Vibode",
  categoryId: "living-room",
  subcategoryId: "sofas",
  productUrl: null,
  imageUrl: "/vibode-stage/studio-sofa.svg",
  priceAmount: 2495,
  priceCurrency: "USD",
  defaultVariantId: STAGE_STUDIO_SOFA_VARIANT_ID,
  collectionIds: Object.freeze(["col-vibode-picks", "col-modern-living"]),
  source: "vibode_curated",
  partnerId: null,
  status: "active",
});

const STUDIO_SETTEE: StageProduct = Object.freeze({
  productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
  brand: "Vibode",
  name: "Studio Settee",
  retailer: "Vibode",
  categoryId: "living-room",
  subcategoryId: "sofas",
  productUrl: null,
  imageUrl: "/vibode-stage/studio-settee.svg",
  priceAmount: 1895,
  priceCurrency: "USD",
  defaultVariantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
  collectionIds: Object.freeze([
    "col-vibode-picks",
    "col-small-spaces",
    "col-modern-living",
  ]),
  source: "vibode_curated",
  partnerId: null,
  status: "active",
});

const STUDIO_CHAIR: StageProduct = Object.freeze({
  productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
  brand: "Vibode",
  name: "Studio Lounge Chair",
  retailer: "Vibode",
  categoryId: "living-room",
  subcategoryId: "chairs",
  productUrl: null,
  imageUrl: "/vibode-stage/studio-chair.svg",
  priceAmount: 895,
  priceCurrency: "USD",
  defaultVariantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
  collectionIds: Object.freeze(["col-vibode-picks", "col-small-spaces"]),
  source: "vibode_curated",
  partnerId: null,
  status: "active",
});

export const STAGE_CERTIFIED_SEED_PRODUCTS: readonly StageProduct[] = Object.freeze([
  STUDIO_SOFA,
  STUDIO_SETTEE,
  STUDIO_CHAIR,
]);

export const STAGE_SEED_PRODUCTS: readonly StageProduct[] = Object.freeze([
  ...STAGE_CERTIFIED_SEED_PRODUCTS,
  ...GENERATED_REGISTERED_PRODUCTS.map((product) => Object.freeze({
    ...product,
    status: "active" as const,
  })),
]);

function certifiedVariantCurrentAssetId(variantId: string, productId: string): string {
  const row = GENERATED_VARIANT_CURRENT_ASSETS.find((item) => (
    item.variantId === variantId && item.productId === productId
  ));
  if (!row) {
    throw new Error(`Certified seed Variant current Asset missing: ${variantId}`);
  }
  return row.currentAssetId;
}

export const STAGE_CERTIFIED_SEED_VARIANTS: readonly StageVariant[] = Object.freeze([
  Object.freeze({
    variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
    assetId: certifiedVariantCurrentAssetId(
      STAGE_STUDIO_SOFA_VARIANT_ID,
      STAGE_STUDIO_SOFA_PRODUCT_ID,
    ),
    finishLabel: "Warm oak",
    sku: null,
    priceAmount: 2495,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
  }),
  Object.freeze({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: certifiedVariantCurrentAssetId(
      STAGE_STUDIO_SETTEE_VARIANT_ID,
      STAGE_STUDIO_SETTEE_PRODUCT_ID,
    ),
    finishLabel: "Stone linen",
    sku: null,
    priceAmount: 1895,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
  }),
  Object.freeze({
    variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
    productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
    assetId: certifiedVariantCurrentAssetId(
      STAGE_STUDIO_CHAIR_VARIANT_ID,
      STAGE_STUDIO_CHAIR_PRODUCT_ID,
    ),
    finishLabel: "Saddle leather",
    sku: null,
    priceAmount: 895,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
  }),
]);

export const STAGE_SEED_VARIANTS: readonly StageVariant[] = Object.freeze([
  ...STAGE_CERTIFIED_SEED_VARIANTS,
  ...GENERATED_REGISTERED_VARIANTS.map((variant) => Object.freeze({
    variantId: variant.variantId,
    productId: variant.productId,
    assetId: certifiedVariantCurrentAssetId(variant.variantId, variant.productId),
    finishLabel: variant.finishLabel,
    sku: variant.sku,
    priceAmount: variant.priceAmount,
    priceCurrency: variant.priceCurrency,
    productUrl: variant.productUrl,
    status: "active" as const,
  })),
]);

export const STAGE_CERTIFIED_SEED_COLLECTIONS: readonly StageCollection[] = Object.freeze([
  Object.freeze({
    collectionId: "col-vibode-picks",
    name: "Vibode Picks",
    owner: "vibode",
    partnerName: null,
    partnerId: null,
    productIds: Object.freeze([
      STAGE_STUDIO_SOFA_PRODUCT_ID,
      STAGE_STUDIO_SETTEE_PRODUCT_ID,
      STAGE_STUDIO_CHAIR_PRODUCT_ID,
    ]),
  }),
  Object.freeze({
    collectionId: "col-small-spaces",
    name: "Small Spaces",
    owner: "vibode",
    partnerName: null,
    partnerId: null,
    productIds: Object.freeze([
      STAGE_STUDIO_SETTEE_PRODUCT_ID,
      STAGE_STUDIO_CHAIR_PRODUCT_ID,
    ]),
  }),
  Object.freeze({
    collectionId: "col-modern-living",
    name: "Modern Living",
    owner: "vibode",
    partnerName: null,
    partnerId: null,
    productIds: Object.freeze([
      STAGE_STUDIO_SOFA_PRODUCT_ID,
      STAGE_STUDIO_SETTEE_PRODUCT_ID,
    ]),
  }),
]);

function collectionsWithRegisteredProducts(
  collections: readonly StageCollection[],
  products: readonly StageProduct[],
): readonly StageCollection[] {
  return Object.freeze(
    collections.map((collection) => {
      const extras = products
        .filter((product) => product.collectionIds.includes(collection.collectionId))
        .map((product) => product.productId)
        .filter((productId) => !collection.productIds.includes(productId));
      if (extras.length === 0) return collection;
      return Object.freeze({
        ...collection,
        productIds: Object.freeze([...collection.productIds, ...extras]),
      });
    }),
  );
}

export const STAGE_SEED_COLLECTIONS: readonly StageCollection[] =
  collectionsWithRegisteredProducts(
    STAGE_CERTIFIED_SEED_COLLECTIONS,
    GENERATED_REGISTERED_PRODUCTS,
  );

export function createStageCatalogSnapshot(input: Readonly<{
  authority: StageCatalogSnapshot["authority"];
  fallbackReason?: string | null;
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  assets: readonly StageAsset[];
  collections: readonly StageCollection[];
  partners?: readonly StagePartner[];
}>): StageCatalogSnapshot {
  return Object.freeze({
    authority: input.authority,
    fallbackReason: input.fallbackReason ?? null,
    products: Object.freeze([...input.products]),
    variants: Object.freeze([...input.variants]),
    assets: Object.freeze([...input.assets]),
    collections: Object.freeze([...input.collections]),
    partners: Object.freeze([...(input.partners ?? [])]),
  });
}

export const STAGE_SEED_CATALOG: StageCatalogSnapshot = createStageCatalogSnapshot({
  authority: "seed_fixture",
  fallbackReason: null,
  products: STAGE_SEED_PRODUCTS,
  variants: STAGE_SEED_VARIANTS,
  assets: STAGE_SEED_ASSETS,
  collections: STAGE_SEED_COLLECTIONS,
});

export function seedFixtureStageCatalog(reason: string): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: "seed_fixture",
    fallbackReason: reason,
    products: STAGE_SEED_PRODUCTS,
    variants: STAGE_SEED_VARIANTS,
    assets: STAGE_SEED_ASSETS,
    collections: STAGE_SEED_COLLECTIONS,
  });
}

type StageCatalogIndex = Readonly<{
  productById: ReadonlyMap<string, StageProduct>;
  variantById: ReadonlyMap<string, StageVariant>;
  variantsByProductId: ReadonlyMap<string, readonly StageVariant[]>;
  assetById: ReadonlyMap<string, StageAsset>;
  collectionById: ReadonlyMap<string, StageCollection>;
}>;

const CATALOG_INDEXES = new WeakMap<StageCatalogSnapshot, StageCatalogIndex>();

export function indexStageCatalog(
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageCatalogIndex {
  const cached = CATALOG_INDEXES.get(catalog);
  if (cached) return cached;
  const variantsByProductId = new Map<string, StageVariant[]>();
  for (const variant of catalog.variants) {
    const list = variantsByProductId.get(variant.productId);
    if (list) list.push(variant);
    else variantsByProductId.set(variant.productId, [variant]);
  }
  const index: StageCatalogIndex = {
    productById: new Map(catalog.products.map((product) => [product.productId, product])),
    variantById: new Map(catalog.variants.map((variant) => [variant.variantId, variant])),
    variantsByProductId,
    assetById: new Map(catalog.assets.map((asset) => [asset.assetId, asset])),
    collectionById: new Map(
      catalog.collections.map((collection) => [collection.collectionId, collection]),
    ),
  };
  CATALOG_INDEXES.set(catalog, index);
  return index;
}

export function allStageProducts(
  extras: readonly StageProduct[] = [],
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageProduct[] {
  const byId = new Map<string, StageProduct>();
  for (const product of catalog.products) byId.set(product.productId, product);
  for (const product of extras) byId.set(product.productId, product);
  return [...byId.values()];
}

export function stageProductById(
  productId: string | null | undefined,
  extras: readonly StageProduct[] = [],
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageProduct | null {
  if (!productId) return null;
  return extras.find((product) => product.productId === productId) ??
    indexStageCatalog(catalog).productById.get(productId) ??
    null;
}

export function stageVariantById(
  variantId: string | null | undefined,
  extras: readonly StageVariant[] = [],
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageVariant | null {
  if (!variantId) return null;
  return extras.find((variant) => variant.variantId === variantId) ??
    indexStageCatalog(catalog).variantById.get(variantId) ??
    null;
}

export function stageVariantsForProduct(
  productId: string,
  extraVariants: readonly StageVariant[] = [],
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageVariant[] {
  const product = stageProductById(productId, [], catalog);
  const byId = new Map<string, StageVariant>();
  const indexed = indexStageCatalog(catalog).variantsByProductId.get(productId) ?? [];
  for (const variant of indexed) {
    if (variant.productId === productId) byId.set(variant.variantId, variant);
  }
  for (const variant of extraVariants) {
    if (variant.productId === productId) byId.set(variant.variantId, variant);
  }
  const variants = [...byId.values()];
  const defaultId = product?.defaultVariantId;
  const preferred = variants.filter((variant) => variant.variantId === defaultId);
  const rest = variants
    .filter((variant) => variant.variantId !== defaultId)
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  return [...preferred, ...rest];
}

export function stageCommercialStatus(
  status: StageCommercialStatus | null | undefined,
): StageCommercialStatus {
  return status === "inactive" ? "inactive" : "active";
}

export function isStageCommercialActive(
  status: StageCommercialStatus | null | undefined,
): boolean {
  return stageCommercialStatus(status) === "active";
}

export function activeStageVariantsForProduct(
  productId: string,
  extraVariants: readonly StageVariant[] = [],
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageVariant[] {
  return stageVariantsForProduct(productId, extraVariants, catalog).filter((variant) => (
    isStageCommercialActive(variant.status)
  ));
}

export function stageAssetById(
  assetId: string | null | undefined,
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageAsset | null {
  if (!assetId) return null;
  return indexStageCatalog(catalog).assetById.get(assetId) ?? null;
}

export function stageCollectionById(
  collectionId: string,
  catalog: StageCatalogSnapshot = STAGE_SEED_CATALOG,
): StageCollection | null {
  return indexStageCatalog(catalog).collectionById.get(collectionId) ?? null;
}

export function isStageAssetReady(asset: StageAsset | null | undefined): boolean {
  return asset?.status === "ready";
}

export function fallbackProductIdForAsset(assetId: string): string | null {
  return assetId === AFC_V2_RUNTIME_FURNITURE_ASSET_ID
    ? STAGE_STUDIO_SOFA_PRODUCT_ID
    : null;
}

export type StagePlacementFailureCode =
  | "PRODUCT_NOT_FOUND"
  | "VARIANT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "VARIANT_INACTIVE"
  | "ASSET_UNAVAILABLE";

export type StagePlacementResult =
  | Readonly<{
    ok: true;
    product: StageProduct;
    variant: StageVariant;
    assetId: string;
  }>
  | Readonly<{
    ok: false;
    code: StagePlacementFailureCode;
  }>;

export function resolveStagePlacementResult(input: Readonly<{
  productId: string;
  variantId?: string | null;
  extras?: readonly StageProduct[];
  extraVariants?: readonly StageVariant[];
  catalog?: StageCatalogSnapshot;
}>): StagePlacementResult {
  const catalog = input.catalog ?? STAGE_SEED_CATALOG;
  const product = stageProductById(input.productId, input.extras, catalog);
  if (!product) return { ok: false, code: "PRODUCT_NOT_FOUND" };
  if (!isStageCommercialActive(product.status)) {
    return { ok: false, code: "PRODUCT_INACTIVE" };
  }
  const variant = stageVariantById(
    input.variantId ?? product.defaultVariantId,
    input.extraVariants,
    catalog,
  );
  if (!variant || variant.productId !== product.productId) {
    return { ok: false, code: "VARIANT_NOT_FOUND" };
  }
  if (!isStageCommercialActive(variant.status)) {
    return { ok: false, code: "VARIANT_INACTIVE" };
  }
  const asset = stageAssetById(variant.assetId, catalog);
  if (!variant.assetId || !isStageAssetReady(asset)) {
    return { ok: false, code: "ASSET_UNAVAILABLE" };
  }
  return { ok: true, product, variant, assetId: variant.assetId };
}

export function resolveStagePlacement(input: Readonly<{
  productId: string;
  variantId?: string | null;
  extras?: readonly StageProduct[];
  extraVariants?: readonly StageVariant[];
  catalog?: StageCatalogSnapshot;
}>): Readonly<{
  product: StageProduct;
  variant: StageVariant;
  assetId: string;
}> | null {
  const result = resolveStagePlacementResult(input);
  return result.ok ? result : null;
}

export function formatStagePrice(
  amount: number | null | undefined,
  currency = "USD",
): string {
  if (amount == null || !Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

export function favoriteKey(
  productId: string,
  variantId?: string | null,
): string {
  return `${productId}::${variantId ?? ""}`;
}

export function createPastedStageProduct(input: Readonly<{
  productId: string;
  name: string;
  brand: string;
  imageUrl: string;
  productUrl: string;
}>): StageProduct {
  return {
    productId: input.productId,
    brand: input.brand,
    name: input.name,
    retailer: input.brand,
    categoryId: "living-room",
    subcategoryId: null,
    productUrl: input.productUrl,
    imageUrl: input.imageUrl,
    priceAmount: null,
    priceCurrency: "USD",
    defaultVariantId: `${input.productId}-default`,
    collectionIds: [],
    source: "user_pasted",
    partnerId: null,
    status: "active",
  };
}

export function createPastedStageVariant(product: StageProduct): StageVariant {
  return {
    variantId: product.defaultVariantId,
    productId: product.productId,
    assetId: null,
    finishLabel: null,
    sku: null,
    priceAmount: product.priceAmount,
    priceCurrency: product.priceCurrency,
    productUrl: product.productUrl,
    status: "active",
  };
}
