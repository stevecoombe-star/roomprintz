/**
 * Fail-safe furniture Asset registration.
 *
 * Validation completes before any manifest, GLB, generated registry,
 * or SQL write. Does not upload to Supabase.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  appendManifestAsset,
  findManifestAsset,
  furnitureAssetRepoPaths,
  loadFurnitureAssetManifest,
  publicFilePathFromGlbUrl,
  writeFileAtomic,
  writeFurnitureAssetManifest,
} from "./furniture-asset-manifest";
import {
  furnitureAssetMigrationFileName,
  renderFurnitureAssetInsertSql,
  writeGeneratedFurnitureAssetRegistry,
} from "./furniture-asset-generate";
import { defaultGlbUrlForAssetId } from "./furniture-asset-policy";
import {
  sha256Hex,
  validateFurnitureAssetFile,
  type AssetValidationResult,
} from "./furniture-asset-validate";
import type { CanonicalFurnitureAssetRecord } from "./furniture-asset-manifest-types";

export type FurnitureAssetRegisterSuccess = Readonly<{
  ok: true;
  validation: AssetValidationResult;
  asset: CanonicalFurnitureAssetRecord;
  written: Readonly<{
    manifest: string;
    generatedRegistry: string;
    glb: string;
    migration: string;
  }>;
}>;

export type FurnitureAssetRegisterFailure = Readonly<{
  ok: false;
  validation: AssetValidationResult;
  written: null;
}>;

export type FurnitureAssetRegisterResult =
  | FurnitureAssetRegisterSuccess
  | FurnitureAssetRegisterFailure;

function utcTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}`
  );
}

function fail(
  validation: AssetValidationResult,
): FurnitureAssetRegisterFailure {
  return { ok: false, validation, written: null };
}

function withError(
  validation: AssetValidationResult,
  code: string,
  message: string,
): AssetValidationResult {
  return {
    ...validation,
    accepted: false,
    errors: [...validation.errors, { code, message }],
  };
}

export async function registerFurnitureAsset(input: Readonly<{
  repoRoot?: string;
  glbPath: string;
  assetId: string;
  declaredWidthM: number;
  declaredHeightM: number;
  declaredDepthM: number;
  status?: CanonicalFurnitureAssetRecord["status"];
  glbUrl?: string;
  migrationTimestamp?: string;
}>): Promise<FurnitureAssetRegisterResult> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const paths = furnitureAssetRepoPaths(repoRoot);
  const validation = await validateFurnitureAssetFile({
    glbPath: input.glbPath,
    assetId: input.assetId,
    declaredWidthM: input.declaredWidthM,
    declaredHeightM: input.declaredHeightM,
    declaredDepthM: input.declaredDepthM,
  });
  if (!validation.accepted) return fail(validation);

  const loaded = loadFurnitureAssetManifest(repoRoot);
  if (!loaded.ok) {
    return fail(withError(
      validation,
      "INVALID_MANIFEST",
      loaded.errors.map((item) => item.message).join(" "),
    ));
  }

  const existing = findManifestAsset(loaded.manifest, input.assetId);
  if (existing) {
    if (existing.sha256 !== validation.sha256) {
      return fail(withError(
        validation,
        "CHECKSUM_MISMATCH",
        `assetId ${input.assetId} is published and must not point at different geometry.`,
      ));
    }
    return fail(withError(
      validation,
      "DUPLICATE_ASSET_ID",
      `assetId ${input.assetId} is already registered. Supersede with a new Asset ID.`,
    ));
  }

  const glbUrl = input.glbUrl ?? defaultGlbUrlForAssetId(input.assetId);
  if (loaded.manifest.assets.some((asset) => asset.glbUrl === glbUrl)) {
    return fail(withError(
      validation,
      "GLB_URL_COLLISION",
      `glbUrl ${glbUrl} is already used by another Asset.`,
    ));
  }

  const destGlb = publicFilePathFromGlbUrl(repoRoot, glbUrl);
  if (existsSync(destGlb)) {
    const destBytes = new Uint8Array(readFileSync(destGlb));
    const destHash = sha256Hex(destBytes);
    if (destHash !== validation.sha256) {
      return fail(withError(
        validation,
        "PUBLISHED_FILE_IMMUTABLE",
        `Refusing to replace existing GLB at ${destGlb}.`,
      ));
    }
  }

  const asset: CanonicalFurnitureAssetRecord = {
    assetId: input.assetId,
    glbUrl,
    authoredWidthM: input.declaredWidthM,
    authoredHeightM: input.declaredHeightM,
    authoredDepthM: input.declaredDepthM,
    status: input.status ?? "ready",
    sha256: validation.sha256,
  };

  const nextManifest = appendManifestAsset(loaded.manifest, asset);
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    return fail(withError(
      validation,
      "INVALID_MANIFEST",
      "migration timestamp must be YYYYMMDDHHMMSS.",
    ));
  }
  const migrationPath = path.join(
    paths.migrationsDir,
    furnitureAssetMigrationFileName(timestamp, asset.assetId),
  );
  const sql = renderFurnitureAssetInsertSql(asset);

  try {
    if (path.resolve(destGlb) !== path.resolve(input.glbPath)) {
      writeFileAtomic(destGlb, readFileSync(input.glbPath));
    }
    writeGeneratedFurnitureAssetRegistry(repoRoot, nextManifest.assets);
    writeFurnitureAssetManifest(repoRoot, nextManifest);
    writeFileAtomic(migrationPath, sql);
  } catch (error) {
    return fail(withError(
      validation,
      "REGISTER_WRITE_FAILED",
      error instanceof Error ? error.message : "Unable to write Asset artifacts.",
    ));
  }

  return {
    ok: true,
    validation,
    asset,
    written: {
      manifest: paths.manifest,
      generatedRegistry: paths.generatedRegistry,
      glb: destGlb,
      migration: migrationPath,
    },
  };
}

export function generateFurnitureAssetArtifacts(repoRoot = process.cwd()): Readonly<{
  ok: boolean;
  generatedRegistry: string;
  errors: readonly string[];
}> {
  const loaded = loadFurnitureAssetManifest(repoRoot);
  const paths = furnitureAssetRepoPaths(repoRoot);
  if (!loaded.ok) {
    return {
      ok: false,
      generatedRegistry: paths.generatedRegistry,
      errors: loaded.errors.map((item) => item.message),
    };
  }
  const generatedRegistry = writeGeneratedFurnitureAssetRegistry(
    repoRoot,
    loaded.manifest.assets,
  );
  return { ok: true, generatedRegistry, errors: [] };
}
