/**
 * Canonical furniture Asset manifest IO.
 *
 * Node-only. The production viewer imports the generated TS registry,
 * not this module.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CANONICAL_FURNITURE_ASSET_KEYS,
  FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION,
  FORBIDDEN_FURNITURE_ASSET_MANIFEST_KEYS,
  type CanonicalFurnitureAssetManifest,
  type CanonicalFurnitureAssetRecord,
  type FurnitureAssetManifestStatus,
} from "./furniture-asset-manifest-types";
import type { AssetValidationIssue } from "./furniture-asset-validate";

export const FURNITURE_ASSET_MANIFEST_RELATIVE_PATH =
  "lib/afc-v2-runtime/furniture-asset-manifest.json";

export const FURNITURE_ASSET_REGISTRY_GENERATED_RELATIVE_PATH =
  "lib/afc-v2-runtime/furniture-asset-registry.generated.ts";

export function furnitureAssetRepoPaths(repoRoot = process.cwd()) {
  return {
    repoRoot,
    manifest: path.join(repoRoot, FURNITURE_ASSET_MANIFEST_RELATIVE_PATH),
    generatedRegistry: path.join(
      repoRoot,
      FURNITURE_ASSET_REGISTRY_GENERATED_RELATIVE_PATH,
    ),
    publicDir: path.join(repoRoot, "public"),
    migrationsDir: path.join(repoRoot, "supabase/migrations"),
  };
}

export function publicFilePathFromGlbUrl(repoRoot: string, glbUrl: string): string {
  const trimmed = glbUrl.trim();
  const relative = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return path.join(repoRoot, "public", relative);
}

function issue(code: string, message: string): AssetValidationIssue {
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asStatus(value: unknown): FurnitureAssetManifestStatus | null {
  return value === "ready" || value === "unavailable" ? value : null;
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function asSha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function asNonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim() === value
    ? value
    : null;
}

export type ManifestParseResult =
  | Readonly<{ ok: true; manifest: CanonicalFurnitureAssetManifest }>
  | Readonly<{ ok: false; errors: readonly AssetValidationIssue[] }>;

export function parseFurnitureAssetManifest(raw: unknown): ManifestParseResult {
  const errors: AssetValidationIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: [issue("INVALID_MANIFEST", "Manifest must be an object.")] };
  }
  if (raw.schemaVersion !== FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION) {
    errors.push(issue(
      "INVALID_MANIFEST",
      `Unsupported manifest schemaVersion ${String(raw.schemaVersion)}.`,
    ));
  }
  if (!Array.isArray(raw.assets)) {
    errors.push(issue("INVALID_MANIFEST", "Manifest assets must be an array."));
    return { ok: false, errors };
  }

  const assets: CanonicalFurnitureAssetRecord[] = [];
  const seen = new Set<string>();
  const urls = new Set<string>();
  raw.assets.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(issue("INVALID_MANIFEST", `Asset ${index} is not an object.`));
      return;
    }
    for (const key of Object.keys(entry)) {
      if ((FORBIDDEN_FURNITURE_ASSET_MANIFEST_KEYS as readonly string[]).includes(key)) {
        errors.push(issue(
          "INVALID_MANIFEST",
          `Asset ${index} includes commercial field ${key}; manifest is technical only.`,
        ));
      }
      if (!(CANONICAL_FURNITURE_ASSET_KEYS as readonly string[]).includes(key)) {
        errors.push(issue(
          "INVALID_MANIFEST",
          `Asset ${index} has unsupported field ${key}.`,
        ));
      }
    }
    const assetId = asNonEmpty(entry.assetId);
    const glbUrl = asNonEmpty(entry.glbUrl);
    const authoredWidthM = asPositiveNumber(entry.authoredWidthM);
    const authoredHeightM = asPositiveNumber(entry.authoredHeightM);
    const authoredDepthM = asPositiveNumber(entry.authoredDepthM);
    const status = asStatus(entry.status);
    const sha256 = asSha256(entry.sha256);
    if (!assetId) errors.push(issue("INVALID_MANIFEST", `Asset ${index} assetId is invalid.`));
    if (!glbUrl || !glbUrl.startsWith("/") || !glbUrl.endsWith(".glb")) {
      errors.push(issue("INVALID_MANIFEST", `Asset ${index} glbUrl must be a root-relative .glb path.`));
    }
    if (authoredWidthM == null || authoredHeightM == null || authoredDepthM == null) {
      errors.push(issue("INVALID_MANIFEST", `Asset ${index} authored dimensions are invalid.`));
    }
    if (!status) errors.push(issue("INVALID_MANIFEST", `Asset ${index} status must be ready or unavailable.`));
    if (!sha256) errors.push(issue("INVALID_MANIFEST", `Asset ${index} sha256 must be 64 lowercase hex chars.`));
    if (!assetId || !glbUrl || authoredWidthM == null || authoredHeightM == null || authoredDepthM == null || !status || !sha256) {
      return;
    }
    if (seen.has(assetId)) {
      errors.push(issue("DUPLICATE_ASSET_ID", `Duplicate assetId ${assetId}.`));
      return;
    }
    if (urls.has(glbUrl)) {
      errors.push(issue("GLB_URL_COLLISION", `Duplicate glbUrl ${glbUrl}.`));
    }
    seen.add(assetId);
    urls.add(glbUrl);
    assets.push({
      assetId,
      glbUrl,
      authoredWidthM,
      authoredHeightM,
      authoredDepthM,
      status,
      sha256,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      schemaVersion: FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION,
      assets,
    },
  };
}

export function renderFurnitureAssetManifestJson(
  manifest: CanonicalFurnitureAssetManifest,
): string {
  const payload = {
    schemaVersion: FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION,
    assets: manifest.assets.map((asset) => ({
      assetId: asset.assetId,
      glbUrl: asset.glbUrl,
      authoredWidthM: asset.authoredWidthM,
      authoredHeightM: asset.authoredHeightM,
      authoredDepthM: asset.authoredDepthM,
      status: asset.status,
      sha256: asset.sha256,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function loadFurnitureAssetManifest(repoRoot = process.cwd()): ManifestParseResult {
  const filePath = furnitureAssetRepoPaths(repoRoot).manifest;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parseFurnitureAssetManifest(raw);
  } catch (error) {
    return {
      ok: false,
      errors: [
        issue(
          "INVALID_MANIFEST",
          error instanceof Error ? error.message : "Unable to read furniture Asset manifest.",
        ),
      ],
    };
  }
}

export function writeFileAtomic(filePath: string, contents: string | Uint8Array): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, contents);
    renameSync(tmp, filePath);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup
    }
    throw error;
  }
}

export function writeFurnitureAssetManifest(
  repoRoot: string,
  manifest: CanonicalFurnitureAssetManifest,
): void {
  writeFileAtomic(
    furnitureAssetRepoPaths(repoRoot).manifest,
    renderFurnitureAssetManifestJson(manifest),
  );
}

export function findManifestAsset(
  manifest: CanonicalFurnitureAssetManifest,
  assetId: string,
): CanonicalFurnitureAssetRecord | null {
  return manifest.assets.find((asset) => asset.assetId === assetId) ?? null;
}

export function appendManifestAsset(
  manifest: CanonicalFurnitureAssetManifest,
  asset: CanonicalFurnitureAssetRecord,
): CanonicalFurnitureAssetManifest {
  return {
    schemaVersion: FURNITURE_ASSET_MANIFEST_SCHEMA_VERSION,
    assets: [...manifest.assets, asset],
  };
}
