import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

export const STAGE_CATALOG_WIDTH_PX = 340;
export const STAGE_SUMMARY_WIDTH_PX = 340;
export const STAGE_CANVAS_HEIGHT_CLASS = "h-[70vh]";
export const STAGE_CANVAS_WIDTH_CLASS = "w-[70vw] max-w-[1200px]";

export type StageCatalogMode = "browse" | "collections" | "favorites";

export type StageProductSource =
  | "vibode_curated"
  | "partner_catalog"
  | "user_pasted";

export type StageAssetStatus = "ready" | "unavailable";

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
}>;

export type StageCollection = Readonly<{
  collectionId: string;
  name: string;
  owner: "vibode" | "partner";
  partnerName: string | null;
  productIds: readonly string[];
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
