/**
 * Canonical technical furniture Asset records.
 *
 * This is the PI-5D2A intake contract. It is not a Product, Variant,
 * Catalog card, or Scene Object. Scene Objects continue to store
 * assetId only.
 */

export const FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION = 1 as const;

export type FurnitureAssetManifestStatus = "ready" | "unavailable";

export type CanonicalFurnitureAssetRecord = Readonly<{
  assetId: string;
  glbUrl: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  status: FurnitureAssetManifestStatus;
  sha256: string;
}>;

export type CanonicalFurnitureAssetManifest = Readonly<{
  schemaVersion: typeof FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION;
  assets: readonly CanonicalFurnitureAssetRecord[];
}>;

export const CANONICAL_FURNITURE_ASSET_KEYS = Object.freeze([
  "assetId",
  "glbUrl",
  "authoredWidthM",
  "authoredHeightM",
  "authoredDepthM",
  "status",
  "sha256",
] as const);

export const FORBIDDEN_FURNITURE_ASSET_MANIFEST_KEYS = Object.freeze([
  "productId",
  "variantId",
  "price",
  "image",
  "collection",
  "partner",
  "retailer",
]);
