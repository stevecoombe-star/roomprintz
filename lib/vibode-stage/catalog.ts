import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
} from "@/lib/afc-v2-runtime/types";
import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "@/lib/afc-v2-runtime/pi4a-sofa-geometry";

import type {
  StageAsset,
  StageCategory,
  StageCollection,
  StageProduct,
  StageVariant,
} from "./types";

export const STAGE_STUDIO_SOFA_PRODUCT_ID = "prod-vibode-studio-sofa";
export const STAGE_STUDIO_SETTEE_PRODUCT_ID = "prod-vibode-studio-settee";
export const STAGE_STUDIO_CHAIR_PRODUCT_ID = "prod-vibode-studio-lounge-chair";

export const STAGE_STUDIO_SOFA_VARIANT_ID = "var-vibode-studio-sofa-default";
export const STAGE_STUDIO_SETTEE_VARIANT_ID = "var-vibode-studio-settee-default";
export const STAGE_STUDIO_CHAIR_VARIANT_ID = "var-vibode-studio-chair-default";

export const STAGE_PI4A_SOFA_ASSET: StageAsset = Object.freeze({
  assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  glbUrl: AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  authoredWidthM: PI4A_SOFA_AUTHORED_WIDTH_M,
  authoredHeightM: PI4A_SOFA_AUTHORED_HEIGHT_M,
  authoredDepthM: PI4A_SOFA_AUTHORED_DEPTH_M,
  status: "ready",
});

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
});

export const STAGE_SEED_PRODUCTS: readonly StageProduct[] = Object.freeze([
  STUDIO_SOFA,
  STUDIO_SETTEE,
  STUDIO_CHAIR,
]);

export const STAGE_SEED_VARIANTS: readonly StageVariant[] = Object.freeze([
  Object.freeze({
    variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    finishLabel: "Warm oak",
    sku: null,
    priceAmount: 2495,
    priceCurrency: "USD",
    productUrl: null,
  }),
  Object.freeze({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    finishLabel: "Stone linen",
    sku: null,
    priceAmount: 1895,
    priceCurrency: "USD",
    productUrl: null,
  }),
  Object.freeze({
    variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
    productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    finishLabel: "Saddle leather",
    sku: null,
    priceAmount: 895,
    priceCurrency: "USD",
    productUrl: null,
  }),
]);

export const STAGE_SEED_COLLECTIONS: readonly StageCollection[] = Object.freeze([
  Object.freeze({
    collectionId: "col-vibode-picks",
    name: "Vibode Picks",
    owner: "vibode",
    partnerName: null,
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
    productIds: Object.freeze([
      STAGE_STUDIO_SOFA_PRODUCT_ID,
      STAGE_STUDIO_SETTEE_PRODUCT_ID,
    ]),
  }),
]);

const PRODUCT_BY_ID = new Map(
  STAGE_SEED_PRODUCTS.map((product) => [product.productId, product]),
);
const VARIANT_BY_ID = new Map(
  STAGE_SEED_VARIANTS.map((variant) => [variant.variantId, variant]),
);
const ASSET_BY_ID = new Map([[STAGE_PI4A_SOFA_ASSET.assetId, STAGE_PI4A_SOFA_ASSET]]);
const COLLECTION_BY_ID = new Map(
  STAGE_SEED_COLLECTIONS.map((collection) => [collection.collectionId, collection]),
);

export function stageProductById(
  productId: string | null | undefined,
  extras: readonly StageProduct[] = [],
): StageProduct | null {
  if (!productId) return null;
  return extras.find((product) => product.productId === productId) ??
    PRODUCT_BY_ID.get(productId) ??
    null;
}

export function stageVariantById(
  variantId: string | null | undefined,
  extras: readonly StageVariant[] = [],
): StageVariant | null {
  if (!variantId) return null;
  return extras.find((variant) => variant.variantId === variantId) ??
    VARIANT_BY_ID.get(variantId) ??
    null;
}

export function stageAssetById(assetId: string | null | undefined): StageAsset | null {
  if (!assetId) return null;
  return ASSET_BY_ID.get(assetId) ?? null;
}

export function stageCollectionById(collectionId: string): StageCollection | null {
  return COLLECTION_BY_ID.get(collectionId) ?? null;
}

export function fallbackProductIdForAsset(assetId: string): string | null {
  return assetId === AFC_V2_RUNTIME_FURNITURE_ASSET_ID
    ? STAGE_STUDIO_SOFA_PRODUCT_ID
    : null;
}

export function resolveStagePlacement(input: Readonly<{
  productId: string;
  variantId?: string | null;
  extras?: readonly StageProduct[];
  extraVariants?: readonly StageVariant[];
}>): Readonly<{
  product: StageProduct;
  variant: StageVariant;
  assetId: string;
}> | null {
  const product = stageProductById(input.productId, input.extras);
  if (!product) return null;
  const variant = stageVariantById(
    input.variantId ?? product.defaultVariantId,
    input.extraVariants,
  );
  if (!variant || variant.productId !== product.productId) return null;
  if (!variant.assetId || !stageAssetById(variant.assetId)) return null;
  return { product, variant, assetId: variant.assetId };
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
  };
}
