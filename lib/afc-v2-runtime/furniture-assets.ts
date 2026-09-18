/**
 * In-memory furniture asset registry.
 *
 * Scene objects refer to assetId. The GLB URL is not object identity.
 * This is a technical runtime adapter for certified STAGE Assets. It is
 * not a catalogue API, persistence layer, or Supabase client.
 *
 * Definitions are generated from the canonical furniture Asset manifest.
 * Do not hand-author additional runtime Asset entries here.
 */

import { GENERATED_FURNITURE_ASSETS } from "./furniture-asset-registry.generated";
import { runtimeDefinitionFromCanonical } from "./furniture-asset-map";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  type FurnitureAssetDefinition,
} from "./types";

function requiredCertifiedAsset(assetId: string): FurnitureAssetDefinition {
  const generated = GENERATED_FURNITURE_ASSETS.find((asset) => asset.assetId === assetId);
  if (!generated) {
    throw new Error(`Certified furniture Asset missing from generated registry: ${assetId}`);
  }
  return runtimeDefinitionFromCanonical(generated);
}

export const PI4A_SOFA_FURNITURE_ASSET: FurnitureAssetDefinition = requiredCertifiedAsset(
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
);

export const PI5D_LOUNGE_CHAIR_FURNITURE_ASSET: FurnitureAssetDefinition =
  requiredCertifiedAsset(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);

const FURNITURE_ASSET_REGISTRY: ReadonlyMap<string, FurnitureAssetDefinition> =
  new Map(
    GENERATED_FURNITURE_ASSETS.map((asset) => [
      asset.assetId,
      runtimeDefinitionFromCanonical(asset),
    ]),
  );

export function furnitureAssetDefinition(
  assetId: string,
): FurnitureAssetDefinition | null {
  return FURNITURE_ASSET_REGISTRY.get(assetId) ?? null;
}

export type FurnitureAssetResolver =
  (assetId: string) => FurnitureAssetDefinition | null;

/**
 * Static generated registry first. Overlay is request/session-local and
 * never mutates FURNITURE_ASSET_REGISTRY. Overlay entries for generated
 * IDs are ignored; static wins.
 */
export function createFurnitureAssetResolver(
  overlay?: ReadonlyMap<string, FurnitureAssetDefinition> | null,
): FurnitureAssetResolver {
  return (assetId: string) => {
    const generated = furnitureAssetDefinition(assetId);
    if (generated) return generated;
    return overlay?.get(assetId) ?? null;
  };
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
  resolver: FurnitureAssetResolver = furnitureAssetDefinition,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const assetId of assetIds) {
    if (seen.has(assetId)) continue;
    if (!resolver(assetId)) continue;
    seen.add(assetId);
    unique.push(assetId);
  }
  return unique;
}
