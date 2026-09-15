import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

export const STAGE_CATALOG_WIDTH_PX = 340;
export const STAGE_SUMMARY_WIDTH_PX = 340;
export const STAGE_CANVAS_HEIGHT_CLASS = "h-[70vh]";
export const STAGE_CANVAS_WIDTH_CLASS = "w-[70vw] max-w-[1200px]";

export type StageCatalogMode =
  | "browse"
  | "recently_used"
  | "collections"
  | "favorites";

export const STAGE_DEFAULT_CATALOG_MODE: StageCatalogMode = "browse";

export const STAGE_CATALOG_MODES: readonly Readonly<{
  id: StageCatalogMode;
  label: string;
}>[] = Object.freeze([
  Object.freeze({ id: "browse", label: "Browse" }),
  Object.freeze({ id: "collections", label: "Collections" }),
  Object.freeze({ id: "recently_used", label: "Recent" }),
  Object.freeze({ id: "favorites", label: "Favorites" }),
]);

export type StageProductSource =
  | "vibode_curated"
  | "partner_catalog"
  | "user_pasted";

export type StageCatalogAuthority = "durable" | "seed_fixture";

export type StageAssetStatus = "ready" | "unavailable";

export type StagePartnerStatus = "active" | "inactive";

export type StagePartner = Readonly<{
  partnerId: string;
  name: string;
  slug: string;
  status: StagePartnerStatus;
  websiteUrl: string | null;
  logoUrl: string | null;
}>;

export type StageAsset = Readonly<{
  assetId: string;
  glbUrl: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  status: StageAssetStatus;
}>;

export type StageVariant = Readonly<{
  variantId: string;
  productId: string;
  assetId: string | null;
  finishLabel: string | null;
  sku: string | null;
  priceAmount: number | null;
  priceCurrency: string;
  productUrl: string | null;
}>;

export type StageProduct = Readonly<{
  productId: string;
  brand: string;
  name: string;
  retailer: string;
  categoryId: string;
  subcategoryId: string | null;
  productUrl: string | null;
  imageUrl: string;
  priceAmount: number | null;
  priceCurrency: string;
  defaultVariantId: string;
  collectionIds: readonly string[];
  source: StageProductSource;
  partnerId: string | null;
}>;

export type StageCollection = Readonly<{
  collectionId: string;
  name: string;
  owner: "vibode" | "partner";
  partnerName: string | null;
  partnerId: string | null;
  productIds: readonly string[];
}>;

export type StageCatalogSnapshot = Readonly<{
  authority: StageCatalogAuthority;
  fallbackReason: string | null;
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  assets: readonly StageAsset[];
  collections: readonly StageCollection[];
  partners: readonly StagePartner[];
}>;

export type StageCategory = Readonly<{
  id: string;
  label: string;
  subcategories: readonly Readonly<{ id: string; label: string }>[];
}>;

export type StageDrawerLayout = Readonly<{
  catalogWidthPx: number;
  summaryWidthPx: number;
  canvasWidthClass: typeof STAGE_CANVAS_WIDTH_CLASS;
  canvasHeightClass: typeof STAGE_CANVAS_HEIGHT_CLASS;
}>;

export type StageSummaryLine = Readonly<{
  key: string;
  productId: string | null;
  variantId: string | null;
  assetId: string;
  brand: string;
  name: string;
  variantLabel: string | null;
  imageUrl: string | null;
  unitPrice: number | null;
  currency: string;
  quantity: number;
  lineTotal: number | null;
  objectIds: readonly string[];
}>;

export type StageSummaryModel = Readonly<{
  itemCount: number;
  lines: readonly StageSummaryLine[];
  estimatedTotal: number | null;
  currency: string;
  shoppable: boolean;
}>;

export type StageToolbarPlacement = Readonly<{
  left: number;
  top: number;
  side: "above" | "below" | "side";
}>;

export type StageSceneObjects = readonly SceneObjectDefinition[];
