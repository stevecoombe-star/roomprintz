/**
 * Browser call for owner-authorized personal placement.
 * The response runtime descriptor is memory-only. Scene saves keep assetId.
 */

import {
  parseRuntimeFurnitureAssetDefinition,
  type RuntimeFurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/runtime-furniture-assets";

export const PERSONAL_FURNITURE_PLACE_PATH = "/api/vibode/furniture-assets/place";

export type EnsurePersonalFurniturePlacement = (
  assetId: string,
) => Promise<PersonalPlacementClientResult>;

export type PersonalPlacementClientResult =
  | Readonly<{
    ok: true;
    assetId: string;
    runtimeAsset: RuntimeFurnitureAssetDefinition;
  }>
  | Readonly<{
    ok: false;
    errorCode: string;
    error: string;
    cancelled?: boolean;
  }>;

export async function fetchPersonalFurniturePlacement(input: Readonly<{
  assetId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  token: string;
  fetchImpl?: typeof fetch;
}>): Promise<PersonalPlacementClientResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(PERSONAL_FURNITURE_PLACE_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetId: input.assetId,
      roomId: input.roomId,
      versionId: input.versionId,
      afcGenerationId: input.afcGenerationId,
    }),
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    error?: string;
    errorCode?: string;
    assetId?: string;
    runtimeAsset?: unknown;
  } | null;
  if (!response.ok || !payload || payload.ok !== true) {
    return {
      ok: false,
      errorCode: payload?.errorCode || "RUNTIME_DEFINITION_UNAVAILABLE",
      error: payload?.error || "This furniture model is temporarily unavailable.",
    };
  }
  const runtimeAsset = parseRuntimeFurnitureAssetDefinition(payload.runtimeAsset);
  if (!runtimeAsset || runtimeAsset.assetId !== input.assetId || payload.assetId !== input.assetId) {
    return {
      ok: false,
      errorCode: "RUNTIME_DEFINITION_UNAVAILABLE",
      error: "This furniture model is temporarily unavailable.",
    };
  }
  return { ok: true, assetId: input.assetId, runtimeAsset };
}
