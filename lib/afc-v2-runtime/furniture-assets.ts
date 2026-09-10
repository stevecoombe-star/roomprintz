/**
 * In-memory furniture asset registry.
 *
 * Scene objects refer to assetId. The GLB URL is not object identity.
 * This is not a catalogue API or persistence layer.
 */

import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  type FurnitureAssetDefinition,
} from "./types";

export const PI4A_SOFA_FURNITURE_ASSET: FurnitureAssetDefinition = Object.freeze({
  assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  glbUrl: AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
});

const FURNITURE_ASSET_REGISTRY: ReadonlyMap<string, FurnitureAssetDefinition> =
  new Map([
    [PI4A_SOFA_FURNITURE_ASSET.assetId, PI4A_SOFA_FURNITURE_ASSET],
  ]);

export function furnitureAssetDefinition(
  assetId: string,
): FurnitureAssetDefinition | null {
  return FURNITURE_ASSET_REGISTRY.get(assetId) ?? null;
}

export function furnitureAssetGlbUrl(assetId: string): string | null {
  return furnitureAssetDefinition(assetId)?.glbUrl ?? null;
}
