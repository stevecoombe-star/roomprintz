/**
 * Browser-safe mapping from canonical Asset records to runtime/seed
 * descriptors. Does not read files or parse the JSON manifest.
 */

import type { CanonicalFurnitureAssetRecord } from "./furniture-asset-manifest-types";
import type { FurnitureAssetDefinition } from "./types";
import type { StageAsset } from "@/lib/vibode-stage/types";

export function runtimeDefinitionFromCanonical(
  asset: CanonicalFurnitureAssetRecord,
): FurnitureAssetDefinition {
  return Object.freeze({
    assetId: asset.assetId,
    glbUrl: asset.glbUrl,
    authoredWidthM: asset.authoredWidthM,
    authoredHeightM: asset.authoredHeightM,
    authoredDepthM: asset.authoredDepthM,
  });
}

export function seedAssetFromCanonical(
  asset: CanonicalFurnitureAssetRecord,
): StageAsset {
  return Object.freeze({
    assetId: asset.assetId,
    glbUrl: asset.glbUrl,
    authoredWidthM: asset.authoredWidthM,
    authoredHeightM: asset.authoredHeightM,
    authoredDepthM: asset.authoredDepthM,
    status: asset.status,
  });
}
