/**
 * Personal assets share the runtime descriptor with partner GLBs.
 * Partner lookup never sees these ids, and a personal row is signed only
 * when its user_id is the room owner.
 */

import type { RuntimeAssetIssue, RuntimeFurnitureAssetDefinition } from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import { createRuntimeAssetIssue } from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import { isPositiveFiniteMetres } from "@/lib/vibode-stage/partner-asset-register";
import {
  resolveSceneRuntimeAssets,
  runtimeDefinitionLeaksProvenance,
  type DynamicRuntimeLookupRow,
  type SceneRuntimeAssetResolution,
  type SignedGetMintResult,
} from "@/lib/vibode-stage/partner-runtime-assets";

import { isPersonalFurnitureAssetId, PERSONAL_FURNITURE_BUCKET } from "./asset-id";

export type PersonalRuntimeRow = Readonly<{
  assetId: string;
  userId: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  storageBucket: string;
  storageObjectPath: string;
}>;

export async function resolveMixedSceneRuntimeAssets(input: Readonly<{
  assetIds: readonly string[];
  ownerUserId: string;
  lookupDynamicAssets: (
    ids: readonly string[],
  ) => Promise<readonly DynamicRuntimeLookupRow[]>;
  lookupPersonalAssets: (
    ids: readonly string[],
    ownerUserId: string,
  ) => Promise<readonly PersonalRuntimeRow[]>;
  mintSignedGet: (
    row: Readonly<{ storageBucket: string; storageObjectPath: string }>,
  ) => Promise<SignedGetMintResult>;
}>): Promise<SceneRuntimeAssetResolution> {
  const personalIds: string[] = [];
  const otherIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.assetIds) {
    const assetId = raw.trim();
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    if (isPersonalFurnitureAssetId(assetId)) personalIds.push(assetId);
    else otherIds.push(assetId);
  }
  const partner = await resolveSceneRuntimeAssets({
    assetIds: otherIds,
    lookupDynamicAssets: input.lookupDynamicAssets,
    mintSignedGet: (row) => input.mintSignedGet(row),
  });
  const personal = await resolvePersonalRuntimeAssets({
    assetIds: personalIds,
    ownerUserId: input.ownerUserId,
    lookupPersonalAssets: input.lookupPersonalAssets,
    mintSignedGet: input.mintSignedGet,
  });
  return {
    assetDefinitions: [...partner.assetDefinitions, ...personal.assetDefinitions],
    assetIssues: [...partner.assetIssues, ...personal.assetIssues],
    queriedIds: personal.queriedIds,
  };
}

export async function resolvePersonalRuntimeAssets(input: Readonly<{
  assetIds: readonly string[];
  ownerUserId: string;
  lookupPersonalAssets: (
    ids: readonly string[],
    ownerUserId: string,
  ) => Promise<readonly PersonalRuntimeRow[]>;
  mintSignedGet: (
    row: Readonly<{ storageBucket: string; storageObjectPath: string }>,
  ) => Promise<SignedGetMintResult>;
}>): Promise<SceneRuntimeAssetResolution> {
  if (input.assetIds.length === 0) {
    return { assetDefinitions: [], assetIssues: [], queriedIds: null };
  }
  const ownerUserId = input.ownerUserId.trim();
  const rows = ownerUserId
    ? await input.lookupPersonalAssets(input.assetIds, ownerUserId)
    : [];
  const byId = new Map(rows.map((row) => [row.assetId, row]));
  const assetDefinitions: RuntimeFurnitureAssetDefinition[] = [];
  const assetIssues: RuntimeAssetIssue[] = [];
  for (const assetId of input.assetIds) {
    const row = byId.get(assetId) ?? null;
    if (
      !row ||
      row.userId !== ownerUserId ||
      row.assetId !== assetId ||
      row.storageBucket !== PERSONAL_FURNITURE_BUCKET ||
      !isSafePersonalPath(row.storageObjectPath) ||
      !isPositiveFiniteMetres(row.authoredWidthM) ||
      !isPositiveFiniteMetres(row.authoredHeightM) ||
      !isPositiveFiniteMetres(row.authoredDepthM)
    ) {
      assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_NOT_FOUND"));
      continue;
    }
    const minted = await input.mintSignedGet(row);
    if (!minted.ok) {
      assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_URL_MINT_FAILED"));
      continue;
    }
    const dto: RuntimeFurnitureAssetDefinition = {
      assetId: row.assetId,
      glbUrl: minted.signedUrl,
      authoredWidthM: row.authoredWidthM,
      authoredHeightM: row.authoredHeightM,
      authoredDepthM: row.authoredDepthM,
      expiresAt: minted.expiresAt,
    };
    if (runtimeDefinitionLeaksProvenance(dto)) {
      assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_URL_MINT_FAILED"));
      continue;
    }
    assetDefinitions.push(dto);
  }
  return { assetDefinitions, assetIssues, queriedIds: input.assetIds };
}

function isSafePersonalPath(objectPath: string): boolean {
  return objectPath.trim().length > 0 &&
    !objectPath.includes("..") &&
    !objectPath.startsWith("/") &&
    objectPath.startsWith("users/") &&
    objectPath.endsWith("/model.glb");
}
