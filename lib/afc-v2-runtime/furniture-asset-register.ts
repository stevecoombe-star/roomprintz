/**
 * Fail-safe furniture Asset registration.
 *
 * Validation completes before any manifest, GLB, generated registry,
 * or SQL write. Does not upload to Supabase.
 *
 * `planFurnitureAssetBatch` is the non-writing primitive. Single-Asset
 * registration and partner-package orchestration both consume it.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  appendManifestAsset,
  findManifestAsset,
  furnitureAssetRepoPaths,
  loadFurnitureAssetManifest,
  parseFurnitureAssetManifest,
  publicFilePathFromGlbUrl,
  writeFileAtomic,
  writeFurnitureAssetManifest,
} from "./furniture-asset-manifest";
import {
  furnitureAssetMigrationFileName,
  renderFurnitureAssetInsertSql,
  renderGeneratedFurnitureAssetRegistry,
  writeGeneratedFurnitureAssetRegistry,
} from "./furniture-asset-generate";
import { defaultGlbUrlForAssetId } from "./furniture-asset-policy";
import {
  sha256Hex,
  validateFurnitureAsset,
  type AssetValidationIssue,
  type AssetValidationResult,
} from "./furniture-asset-validate";
import type {
  CanonicalFurnitureAssetManifest,
  CanonicalFurnitureAssetRecord,
} from "./furniture-asset-manifest-types";

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

export type FurnitureAssetPlanIssue = Readonly<{
  code: string;
  message: string;
  level: "error" | "warning";
  path?: string;
  assetId?: string;
  file?: string;
}>;

export type FurnitureAssetBatchExistingPolicy = "fail-duplicate" | "reuse-identical";

export type FurnitureAssetBatchItemInput = Readonly<{
  assetId: string;
  bytes: Uint8Array;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  glbUrl?: string;
  expectedSha256?: string;
  sourcePath?: string;
  status?: CanonicalFurnitureAssetRecord["status"];
}>;

export type FurnitureAssetPlanAction = "create" | "reuse";

export type FurnitureAssetAssetPlan = Readonly<{
  action: FurnitureAssetPlanAction;
  asset: CanonicalFurnitureAssetRecord;
  validation: AssetValidationResult;
  glbDestination: string;
  sql: string | null;
  migrationPath: string | null;
}>;

export type FurnitureAssetWriteIntent = Readonly<{
  kind: "glb" | "sql" | "manifest" | "registry";
  path: string;
  assetId?: string;
}>;

export type FurnitureAssetBatchPlan = Readonly<{
  ok: boolean;
  issues: readonly FurnitureAssetPlanIssue[];
  assetPlans: readonly FurnitureAssetAssetPlan[];
  finalManifest: CanonicalFurnitureAssetManifest | null;
  generatedRegistryText: string | null;
  sqlPlans: readonly Readonly<{ path: string; sql: string; assetId: string }>[];
  writes: readonly FurnitureAssetWriteIntent[];
}>;

export function utcTimestamp(date = new Date()): string {
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

export function nextUtcTimestamp(timestamp: string, offsetSeconds = 1): string {
  if (!/^\d{14}$/.test(timestamp)) return timestamp;
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  const hour = Number(timestamp.slice(8, 10));
  const minute = Number(timestamp.slice(10, 12));
  const second = Number(timestamp.slice(12, 14));
  return utcTimestamp(new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second + offsetSeconds,
  )));
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

function issue(
  code: string,
  message: string,
  extra: Omit<FurnitureAssetPlanIssue, "code" | "message" | "level"> & {
    level?: FurnitureAssetPlanIssue["level"];
  } = {},
): FurnitureAssetPlanIssue {
  return {
    code,
    message,
    level: extra.level ?? "error",
    path: extra.path,
    assetId: extra.assetId,
    file: extra.file,
  };
}

function fromValidationIssue(
  item: AssetValidationIssue,
  level: FurnitureAssetPlanIssue["level"],
  extra: Pick<FurnitureAssetPlanIssue, "assetId" | "file">,
): FurnitureAssetPlanIssue {
  return {
    code: item.code,
    message: item.message,
    level,
    assetId: extra.assetId,
    file: extra.file,
  };
}

function emptyValidation(input: FurnitureAssetBatchItemInput): AssetValidationResult {
  return {
    accepted: false,
    assetId: input.assetId,
    glbPath: input.sourcePath ?? input.assetId,
    fileSizeBytes: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
    parseOk: false,
    measured: null,
    declared: {
      widthM: input.authoredWidthM,
      heightM: input.authoredHeightM,
      depthM: input.authoredDepthM,
    },
    placementScale: null,
    warnings: [],
    errors: [],
  };
}

function canonicalMatch(
  existing: CanonicalFurnitureAssetRecord,
  next: CanonicalFurnitureAssetRecord,
): boolean {
  return (
    existing.assetId === next.assetId &&
    existing.sha256 === next.sha256 &&
    existing.glbUrl === next.glbUrl &&
    existing.authoredWidthM === next.authoredWidthM &&
    existing.authoredHeightM === next.authoredHeightM &&
    existing.authoredDepthM === next.authoredDepthM &&
    existing.status === next.status
  );
}

export async function planFurnitureAssetBatch(input: Readonly<{
  assets: readonly FurnitureAssetBatchItemInput[];
  existingManifest?: CanonicalFurnitureAssetManifest;
  repoRoot?: string;
  existingAssetPolicy?: FurnitureAssetBatchExistingPolicy;
  migrationTimestamp?: string;
}>): Promise<FurnitureAssetBatchPlan> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const paths = furnitureAssetRepoPaths(repoRoot);
  const policy = input.existingAssetPolicy ?? "fail-duplicate";
  const issues: FurnitureAssetPlanIssue[] = [];
  const assetPlans: FurnitureAssetAssetPlan[] = [];

  const validations = await Promise.all(input.assets.map((asset) => (
    validateFurnitureAsset({
      bytes: asset.bytes,
      glbPath: asset.sourcePath ?? asset.assetId,
      assetId: asset.assetId,
      declaredWidthM: asset.authoredWidthM,
      declaredHeightM: asset.authoredHeightM,
      declaredDepthM: asset.authoredDepthM,
    })
  )));

  const seenIds = new Set<string>();
  for (const [index, asset] of input.assets.entries()) {
    const validation = validations[index] ?? emptyValidation(asset);
    const extra = { assetId: asset.assetId, file: asset.sourcePath };
    if (seenIds.has(asset.assetId)) {
      issues.push(issue(
        "DUPLICATE_ASSET_ID",
        `assetId ${asset.assetId} is duplicated in this batch.`,
        extra,
      ));
    }
    seenIds.add(asset.assetId);
    if (asset.expectedSha256 && asset.expectedSha256 !== validation.sha256) {
      issues.push(issue(
        "CHECKSUM_MISMATCH",
        `Computed SHA-256 does not match expected checksum for ${asset.assetId}.`,
        extra,
      ));
    }
    for (const error of validation.errors) {
      issues.push(fromValidationIssue(error, "error", extra));
    }
    for (const warning of validation.warnings) {
      issues.push(fromValidationIssue(warning, "warning", extra));
    }
  }

  const loaded = input.existingManifest
    ? { ok: true as const, manifest: input.existingManifest }
    : loadFurnitureAssetManifest(repoRoot);
  if (!loaded.ok) {
    for (const item of loaded.errors) {
      issues.push(issue(item.code, item.message));
    }
    return {
      ok: false,
      issues,
      assetPlans: [],
      finalManifest: null,
      generatedRegistryText: null,
      sqlPlans: [],
      writes: [],
    };
  }

  const checksumOwners = new Map<string, string[]>();
  for (const existing of loaded.manifest.assets) {
    const owners = checksumOwners.get(existing.sha256) ?? [];
    owners.push(existing.assetId);
    checksumOwners.set(existing.sha256, owners);
  }

  if (issues.some((item) => item.level === "error")) {
    return {
      ok: false,
      issues,
      assetPlans: [],
      finalManifest: null,
      generatedRegistryText: null,
      sqlPlans: [],
      writes: [],
    };
  }

  let timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    issues.push(issue(
      "INVALID_MANIFEST",
      "migration timestamp must be YYYYMMDDHHMMSS.",
    ));
    return {
      ok: false,
      issues,
      assetPlans: [],
      finalManifest: null,
      generatedRegistryText: null,
      sqlPlans: [],
      writes: [],
    };
  }

  let working = loaded.manifest;
  const plannedUrls = new Set(working.assets.map((asset) => asset.glbUrl));
  const sqlPlans: Array<{ path: string; sql: string; assetId: string }> = [];
  const writes: FurnitureAssetWriteIntent[] = [];

  for (const [index, asset] of input.assets.entries()) {
    const validation = validations[index]!;
    const extra = { assetId: asset.assetId, file: asset.sourcePath };
    const glbUrl = asset.glbUrl ?? defaultGlbUrlForAssetId(asset.assetId);
    const destGlb = publicFilePathFromGlbUrl(repoRoot, glbUrl);
    const record: CanonicalFurnitureAssetRecord = {
      assetId: asset.assetId,
      glbUrl,
      authoredWidthM: asset.authoredWidthM,
      authoredHeightM: asset.authoredHeightM,
      authoredDepthM: asset.authoredDepthM,
      status: asset.status ?? "ready",
      sha256: validation.sha256,
    };

    const owners = checksumOwners.get(validation.sha256) ?? [];
    for (const ownerId of owners) {
      if (ownerId !== asset.assetId) {
        issues.push(issue(
          "DUPLICATE_BYTES",
          `Asset ${asset.assetId} shares SHA-256 with ${ownerId}.`,
          { ...extra, level: "warning" },
        ));
      }
    }
    if (!owners.includes(asset.assetId)) {
      checksumOwners.set(validation.sha256, [...owners, asset.assetId]);
    }

    const existing = findManifestAsset(working, asset.assetId);
    if (existing) {
      if (existing.sha256 !== validation.sha256) {
        issues.push(issue(
          "CHECKSUM_MISMATCH",
          `assetId ${asset.assetId} is published and must not point at different geometry.`,
          extra,
        ));
        continue;
      }
      if (policy === "fail-duplicate") {
        issues.push(issue(
          "DUPLICATE_ASSET_ID",
          `assetId ${asset.assetId} is already registered. Supersede with a new Asset ID.`,
          extra,
        ));
        continue;
      }
      if (!canonicalMatch(existing, record)) {
        issues.push(issue(
          "IMMUTABLE_ASSET_MISMATCH",
          `assetId ${asset.assetId} is published and canonical metadata must not change.`,
          extra,
        ));
        continue;
      }
      assetPlans.push({
        action: "reuse",
        asset: existing,
        validation,
        glbDestination: destGlb,
        sql: null,
        migrationPath: null,
      });
      continue;
    }

    if (plannedUrls.has(glbUrl)) {
      issues.push(issue(
        "GLB_URL_COLLISION",
        `glbUrl ${glbUrl} is already used by another Asset.`,
        extra,
      ));
      continue;
    }

    if (existsSync(destGlb)) {
      const destBytes = new Uint8Array(readFileSync(destGlb));
      const destHash = sha256Hex(destBytes);
      if (destHash !== validation.sha256) {
        issues.push(issue(
          "PUBLISHED_FILE_IMMUTABLE",
          `Refusing to replace existing GLB at ${destGlb}.`,
          extra,
        ));
        continue;
      }
    }

    const migrationPath = path.join(
      paths.migrationsDir,
      furnitureAssetMigrationFileName(timestamp, record.assetId),
    );
    const sql = renderFurnitureAssetInsertSql(record);
    timestamp = nextUtcTimestamp(timestamp);
    plannedUrls.add(glbUrl);
    working = appendManifestAsset(working, record);
    sqlPlans.push({ path: migrationPath, sql, assetId: record.assetId });
    writes.push({ kind: "glb", path: destGlb, assetId: record.assetId });
    writes.push({ kind: "sql", path: migrationPath, assetId: record.assetId });
    assetPlans.push({
      action: "create",
      asset: record,
      validation,
      glbDestination: destGlb,
      sql,
      migrationPath,
    });
  }

  if (issues.some((item) => item.level === "error")) {
    return {
      ok: false,
      issues,
      assetPlans,
      finalManifest: null,
      generatedRegistryText: null,
      sqlPlans: [],
      writes: [],
    };
  }

  const parsed = parseFurnitureAssetManifest(working);
  if (!parsed.ok) {
    for (const item of parsed.errors) {
      issues.push(issue(item.code, item.message));
    }
    return {
      ok: false,
      issues,
      assetPlans,
      finalManifest: null,
      generatedRegistryText: null,
      sqlPlans: [],
      writes: [],
    };
  }

  const generatedRegistryText = renderGeneratedFurnitureAssetRegistry(parsed.manifest.assets);
  const created = assetPlans.some((item) => item.action === "create");
  if (created) {
    writes.push({ kind: "manifest", path: paths.manifest });
    writes.push({ kind: "registry", path: paths.generatedRegistry });
  }

  return {
    ok: issues.every((item) => item.level !== "error"),
    issues,
    assetPlans,
    finalManifest: parsed.manifest,
    generatedRegistryText,
    sqlPlans,
    writes,
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
  let bytes: Uint8Array;
  try {
    const buffer = readFileSync(input.glbPath);
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const missing = code === "ENOENT";
    return fail({
      accepted: false,
      assetId: input.assetId,
      glbPath: input.glbPath,
      fileSizeBytes: 0,
      sha256: "",
      parseOk: false,
      measured: null,
      declared: {
        widthM: input.declaredWidthM,
        heightM: input.declaredHeightM,
        depthM: input.declaredDepthM,
      },
      placementScale: null,
      warnings: [],
      errors: [{
        code: missing ? "FILE_MISSING" : "MALFORMED_GLB",
        message: missing
          ? `GLB file is missing: ${input.glbPath}`
          : error instanceof Error
            ? error.message
            : "Unable to read GLB file.",
      }],
    });
  }

  const plan = await planFurnitureAssetBatch({
    assets: [{
      assetId: input.assetId,
      bytes,
      authoredWidthM: input.declaredWidthM,
      authoredHeightM: input.declaredHeightM,
      authoredDepthM: input.declaredDepthM,
      glbUrl: input.glbUrl,
      sourcePath: input.glbPath,
      status: input.status,
    }],
    repoRoot,
    existingAssetPolicy: "fail-duplicate",
    migrationTimestamp: input.migrationTimestamp,
  });

  const baseValidation = plan.assetPlans[0]?.validation ?? await validateFurnitureAsset({
    bytes,
    glbPath: input.glbPath,
    assetId: input.assetId,
    declaredWidthM: input.declaredWidthM,
    declaredHeightM: input.declaredHeightM,
    declaredDepthM: input.declaredDepthM,
  });
  if (!plan.ok) {
    let validation = baseValidation;
    for (const item of plan.issues) {
      if (item.level !== "error") continue;
      if (validation.errors.some((error) => error.code === item.code && error.message === item.message)) {
        continue;
      }
      validation = withError(validation, item.code, item.message);
    }
    return fail(validation);
  }

  const assetPlan = plan.assetPlans[0];
  if (!assetPlan || assetPlan.action !== "create" || !plan.finalManifest || !assetPlan.migrationPath || !assetPlan.sql) {
    return fail(withError(
      baseValidation,
      "DUPLICATE_ASSET_ID",
      `assetId ${input.assetId} is already registered. Supersede with a new Asset ID.`,
    ));
  }

  try {
    if (path.resolve(assetPlan.glbDestination) !== path.resolve(input.glbPath)) {
      writeFileAtomic(assetPlan.glbDestination, Buffer.from(bytes));
    }
    writeGeneratedFurnitureAssetRegistry(repoRoot, plan.finalManifest.assets);
    writeFurnitureAssetManifest(repoRoot, plan.finalManifest);
    writeFileAtomic(assetPlan.migrationPath, assetPlan.sql);
  } catch (error) {
    return fail(withError(
      baseValidation,
      "REGISTER_WRITE_FAILED",
      error instanceof Error ? error.message : "Unable to write Asset artifacts.",
    ));
  }

  return {
    ok: true,
    validation: baseValidation,
    asset: assetPlan.asset,
    written: {
      manifest: paths.manifest,
      generatedRegistry: paths.generatedRegistry,
      glb: assetPlan.glbDestination,
      migration: assetPlan.migrationPath,
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
