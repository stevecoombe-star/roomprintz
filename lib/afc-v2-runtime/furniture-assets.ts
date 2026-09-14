/**
 * In-memory furniture asset registry.
 *
 * Scene objects refer to assetId. The GLB URL is not object identity.
 * This is a technical runtime adapter for certified STAGE Assets. It is
 * not a catalogue API, persistence layer, or Supabase client.
 */

import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "./pi4a-sofa-geometry";
import {
  PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
} from "./pi5d-lounge-chair-geometry";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH,
  type FurnitureAssetDefinition,
} from "./types";

export const PI4A_SOFA_FURNITURE_ASSET: FurnitureAssetDefinition = Object.freeze({
  assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  glbUrl: AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  authoredWidthM: PI4A_SOFA_AUTHORED_WIDTH_M,
  authoredHeightM: PI4A_SOFA_AUTHORED_HEIGHT_M,
  authoredDepthM: PI4A_SOFA_AUTHORED_DEPTH_M,
});

export const PI5D_LOUNGE_CHAIR_FURNITURE_ASSET: FurnitureAssetDefinition = Object.freeze({
  assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  glbUrl: AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH,
  authoredWidthM: PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
  authoredHeightM: PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
  authoredDepthM: PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
});

const FURNITURE_ASSET_REGISTRY: ReadonlyMap<string, FurnitureAssetDefinition> =
  new Map([
    [PI4A_SOFA_FURNITURE_ASSET.assetId, PI4A_SOFA_FURNITURE_ASSET],
    [PI5D_LOUNGE_CHAIR_FURNITURE_ASSET.assetId, PI5D_LOUNGE_CHAIR_FURNITURE_ASSET],
  ]);

export function furnitureAssetDefinition(
  assetId: string,
): FurnitureAssetDefinition | null {
  return FURNITURE_ASSET_REGISTRY.get(assetId) ?? null;
}

export function furnitureAssetGlbUrl(assetId: string): string | null {
  return furnitureAssetDefinition(assetId)?.glbUrl ?? null;
}

export function defaultFurnitureAssetId(): string {
  return PI4A_SOFA_FURNITURE_ASSET.assetId;
}

export function registeredFurnitureAssetIds(): readonly string[] {
  return Object.freeze([...FURNITURE_ASSET_REGISTRY.keys()]);
}

export function uniqueRegisteredFurnitureAssetIds(
  assetIds: readonly string[],
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const assetId of assetIds) {
    if (seen.has(assetId)) continue;
    if (!furnitureAssetDefinition(assetId)) continue;
    seen.add(assetId);
    unique.push(assetId);
  }
  return unique;
}
