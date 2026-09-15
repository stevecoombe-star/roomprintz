/**
 * Manifest / runtime / seed / file / checksum drift detection.
 *
 * Node-only. The viewer does not import this module.
 */

import { existsSync, readFileSync } from "node:fs";

import type { CanonicalFurnitureAssetManifest } from "./furniture-asset-manifest-types";
import {
  findManifestAsset,
  loadFurnitureAssetManifest,
  publicFilePathFromGlbUrl,
} from "./furniture-asset-manifest";
import { seedAssetFromCanonical } from "./furniture-asset-map";
import { furnitureAssetDefinition, registeredFurnitureAssetIds } from "./furniture-assets";
import { sha256Hex } from "./furniture-asset-validate";
import { STAGE_SEED_ASSETS } from "@/lib/vibode-stage/catalog";
import type { StageAsset } from "@/lib/vibode-stage/types";
import type { FurnitureAssetDefinition } from "./types";

export type FurnitureAssetDriftIssue = Readonly<{
  code: string;
  message: string;
}>;

function issue(code: string, message: string): FurnitureAssetDriftIssue {
  return { code, message };
}

export function detectFurnitureAssetDrift(input: Readonly<{
  repoRoot?: string;
  manifest?: CanonicalFurnitureAssetManifest;
  runtimeAssets?: readonly FurnitureAssetDefinition[];
  seedAssets?: readonly StageAsset[];
}> = {}): FurnitureAssetDriftIssue[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const issues: FurnitureAssetDriftIssue[] = [];
  const loaded = input.manifest
    ? { ok: true as const, manifest: input.manifest }
    : loadFurnitureAssetManifest(repoRoot);
  if (!loaded.ok) {
    return loaded.errors.map((item) => issue(item.code, item.message));
  }

  const seen = new Set<string>();
  for (const asset of loaded.manifest.assets) {
    if (seen.has(asset.assetId)) {
      issues.push(issue("DUPLICATE_ASSET_ID", `Duplicate assetId ${asset.assetId}.`));
    }
    seen.add(asset.assetId);
  }

  const runtimeAssets = input.runtimeAssets ??
    registeredFurnitureAssetIds().map((assetId) => furnitureAssetDefinition(assetId)!)
      .filter((asset): asset is FurnitureAssetDefinition => !!asset);
  const runtimeById = new Map(runtimeAssets.map((asset) => [asset.assetId, asset]));
  const seedAssets = input.seedAssets ?? STAGE_SEED_ASSETS;
  const seedById = new Map(seedAssets.map((asset) => [asset.assetId, asset]));

  for (const asset of loaded.manifest.assets) {
    const runtime = runtimeById.get(asset.assetId);
    if (!runtime) {
      issues.push(issue(
        "MANIFEST_MISSING_RUNTIME",
        `Manifest Asset ${asset.assetId} is missing a runtime descriptor.`,
      ));
      continue;
    }
    if (runtime.glbUrl !== asset.glbUrl) {
      issues.push(issue(
        "URL_MISMATCH",
        `Asset ${asset.assetId} glbUrl differs between manifest and runtime.`,
      ));
    }
    if (
      runtime.authoredWidthM !== asset.authoredWidthM ||
      runtime.authoredHeightM !== asset.authoredHeightM ||
      runtime.authoredDepthM !== asset.authoredDepthM
    ) {
      issues.push(issue(
        "DIMENSION_MISMATCH",
        `Asset ${asset.assetId} authored dimensions differ between manifest and runtime.`,
      ));
    }

    const seed = seedById.get(asset.assetId);
    if (!seed) {
      issues.push(issue(
        "MANIFEST_MISSING_SEED",
        `Manifest Asset ${asset.assetId} is missing from seed Catalog Assets.`,
      ));
    } else {
      const expected = seedAssetFromCanonical(asset);
      if (
        seed.glbUrl !== expected.glbUrl ||
        seed.authoredWidthM !== expected.authoredWidthM ||
        seed.authoredHeightM !== expected.authoredHeightM ||
        seed.authoredDepthM !== expected.authoredDepthM ||
        seed.status !== expected.status
      ) {
        issues.push(issue(
          "SEED_MISMATCH",
          `Asset ${asset.assetId} seed Catalog metadata does not match the manifest.`,
        ));
      }
    }

    const filePath = publicFilePathFromGlbUrl(repoRoot, asset.glbUrl);
    if (!existsSync(filePath)) {
      issues.push(issue("FILE_MISSING", `GLB file is missing for ${asset.assetId}: ${filePath}`));
      continue;
    }
    const digest = sha256Hex(new Uint8Array(readFileSync(filePath)));
    if (digest !== asset.sha256) {
      issues.push(issue(
        "CHECKSUM_MISMATCH",
        `Asset ${asset.assetId} file checksum does not match the manifest.`,
      ));
    }
  }

  for (const runtime of runtimeAssets) {
    if (!findManifestAsset(loaded.manifest, runtime.assetId)) {
      issues.push(issue(
        "RUNTIME_MISSING_MANIFEST",
        `Runtime descriptor ${runtime.assetId} is missing a manifest row.`,
      ));
    }
  }

  for (const seed of seedAssets) {
    if (seed.status !== "ready") continue;
    if (!runtimeById.has(seed.assetId)) {
      issues.push(issue(
        "SEED_READY_UNKNOWN_TO_RUNTIME",
        `Seed-ready Asset ${seed.assetId} is unknown to the runtime registry.`,
      ));
    }
  }

  return issues;
}
