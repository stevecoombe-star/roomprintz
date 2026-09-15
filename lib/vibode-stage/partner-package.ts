/**
 * PI-5F2A partner package Asset orchestration.
 *
 * Node-only. Plans Assets with PI-5D2A, overlays them into PI-5F1
 * catalog validation, then writes GLBs + Asset artifacts + catalog
 * SQL as one fail-closed unit. Does not create a second Asset model,
 * GLB validator, or partner-aware runtime lookup.
 *
 * Generated runtime registry remains a compiled Map. That shape may
 * become unsuitable around thousands / 10k Assets; F2A proof stays
 * within the certified architecture.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import { seedAssetFromCanonical } from "@/lib/afc-v2-runtime/furniture-asset-map";
import {
  furnitureAssetRepoPaths,
  writeFileAtomic,
  writeFurnitureAssetManifest,
} from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import { FORBIDDEN_FURNITURE_ASSET_MANIFEST_KEYS } from "@/lib/afc-v2-runtime/furniture-asset-manifest-types";
import { defaultGlbUrlForAssetId } from "@/lib/afc-v2-runtime/furniture-asset-policy";
import {
  nextUtcTimestamp,
  planFurnitureAssetBatch,
  type FurnitureAssetAssetPlan,
  type FurnitureAssetBatchItemInput,
  type FurnitureAssetBatchPlan,
  type FurnitureAssetPlanIssue,
} from "@/lib/afc-v2-runtime/furniture-asset-register";
import { writeGeneratedFurnitureAssetRegistry } from "@/lib/afc-v2-runtime/furniture-asset-generate";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";

import { STAGE_SEED_ASSETS, STAGE_SEED_CATALOG } from "./catalog";
import {
  PI5F2_PACKAGE_BATCH_ID,
  PI5F2_PACKAGE_RELATIVE_PATH,
  PARTNER_CATALOG_DOCUMENTS,
} from "./partner-catalog-documents";
import {
  isPartnerCatalogSqlForSlug,
  listPartnerCatalogMigrations,
  loadExistingPartnerCatalogState,
  parsePartnerCatalogJson,
  partnerCatalogSqlSlug,
  partnerIdForSlug,
  planPartnerCatalogImport,
  validatePartnerCatalog,
  type PartnerCatalogDocument,
  type PartnerCatalogWritePlan,
} from "./partner-catalog";
import {
  asNonEmptyString,
  isPlainObject,
  type ProductVariantIssue,
} from "./product-variant-register";

export const PARTNER_ASSETS_JSON_NAME = "partner-assets.json";
export const PARTNER_CATALOG_JSON_NAME = "partner-catalog.json";

export const DEMO_COFFEE_TABLE_PRODUCT_ID = "prod-demo-furniture-co-demo-coffee-table";
export const DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID =
  "var-demo-furniture-co-demo-coffee-table-natural";
export const DEMO_COFFEE_TABLE_BLACK_VARIANT_ID =
  "var-demo-furniture-co-demo-coffee-table-black";
export const DEMO_SIDE_TABLE_PRODUCT_ID = "prod-demo-furniture-co-demo-side-table";
export const DEMO_SIDE_TABLE_VARIANT_ID = "var-demo-furniture-co-demo-side-table-natural";

export type PartnerPackageIssue = FurnitureAssetPlanIssue;

export type PartnerPackageAssetDeclaration = Readonly<{
  assetId: string;
  file: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  expectedSha256?: string;
}>;

export type PartnerAssetsDocument = Readonly<{
  partnerId: string;
  assets: readonly PartnerPackageAssetDeclaration[];
}>;

export type PartnerPackageWritten = Readonly<{
  glbs: readonly string[];
  assetSqls: readonly string[];
  manifest: string;
  generatedRegistry: string;
  catalogSql: string;
}>;

export type PartnerPackageAssetPlanSummary = Readonly<{
  action: FurnitureAssetAssetPlan["action"];
  assetId: string;
  sha256: string;
  glbUrl: string;
  glbDestination: string;
  migrationPath: string | null;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}>;

export type PartnerPackagePlan = Readonly<{
  ok: boolean;
  issues: readonly PartnerPackageIssue[];
  assetPlans: readonly PartnerPackageAssetPlanSummary[];
  catalogPlan: PartnerCatalogWritePlan | null;
  insertPartner: boolean;
  collectionCount: number;
  migrationOrder: readonly string[];
  assetBatch: FurnitureAssetBatchPlan | null;
  catalogDocument: PartnerCatalogDocument | null;
}>;

export type PartnerPackageImportSuccess = Readonly<{
  ok: true;
  check: boolean;
  issues: readonly PartnerPackageIssue[];
  assetPlans: readonly PartnerPackageAssetPlanSummary[];
  catalogPlan: PartnerCatalogWritePlan;
  written: PartnerPackageWritten | null;
  migrationOrder: readonly string[];
  incompleteRecovery: readonly string[];
}>;

export type PartnerPackageImportFailure = Readonly<{
  ok: false;
  check: boolean;
  issues: readonly PartnerPackageIssue[];
  assetPlans: readonly PartnerPackageAssetPlanSummary[];
  catalogPlan: PartnerCatalogWritePlan | null;
  written: null;
  migrationOrder: readonly string[];
  incompleteRecovery: readonly string[];
}>;

export type PartnerPackageImportResult =
  | PartnerPackageImportSuccess
  | PartnerPackageImportFailure;

function pkgIssue(
  code: string,
  message: string,
  extra: Omit<PartnerPackageIssue, "code" | "message" | "level"> & {
    level?: PartnerPackageIssue["level"];
  } = {},
): PartnerPackageIssue {
  return {
    code,
    message,
    level: extra.level ?? "error",
    path: extra.path,
    assetId: extra.assetId,
    file: extra.file,
  };
}

function fromCommercial(item: ProductVariantIssue, extra: Pick<PartnerPackageIssue, "path"> = {}): PartnerPackageIssue {
  return pkgIssue(item.code, item.message, extra);
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveJailedPackagePath(input: Readonly<{
  packageRoot: string;
  relativeFile: string;
  requireGlb?: boolean;
}>): Readonly<{ ok: true; absolutePath: string }> | Readonly<{
  ok: false;
  issue: PartnerPackageIssue;
}> {
  const requireGlb = input.requireGlb !== false;
  const relativeFile = input.relativeFile;
  if (!relativeFile || relativeFile.trim() !== relativeFile) {
    return {
      ok: false,
      issue: pkgIssue("PATH_ESCAPE", "Package file path must be a non-empty trimmed string.", {
        file: relativeFile,
      }),
    };
  }
  const segments = relativeFile.split(/[\\/]/);
  if (segments.includes("..")) {
    return {
      ok: false,
      issue: pkgIssue("PATH_ESCAPE", `Package file path escapes the package root: ${relativeFile}.`, {
        file: relativeFile,
      }),
    };
  }
  if (requireGlb && !relativeFile.toLowerCase().endsWith(".glb")) {
    return {
      ok: false,
      issue: pkgIssue("WRONG_EXTENSION", `Package Asset files must be .glb: ${relativeFile}.`, {
        file: relativeFile,
      }),
    };
  }
  if (requireGlb && relativeFile.toLowerCase().endsWith(".gltf")) {
    return {
      ok: false,
      issue: pkgIssue("WRONG_EXTENSION", "glTF + sidecar resources are not supported.", {
        file: relativeFile,
      }),
    };
  }

  let packageRoot: string;
  try {
    packageRoot = realpathSync(input.packageRoot);
  } catch {
    return {
      ok: false,
      issue: pkgIssue("FILE_MISSING", `Package root is missing: ${input.packageRoot}.`),
    };
  }

  const candidate = path.isAbsolute(relativeFile)
    ? path.normalize(relativeFile)
    : path.resolve(packageRoot, relativeFile);
  if (!isPathInside(packageRoot, candidate)) {
    return {
      ok: false,
      issue: pkgIssue("PATH_ESCAPE", `Package file path escapes the package root: ${relativeFile}.`, {
        file: relativeFile,
      }),
    };
  }
  if (!existsSync(candidate)) {
    return {
      ok: false,
      issue: pkgIssue("FILE_MISSING", `Package GLB is missing: ${relativeFile}.`, {
        file: relativeFile,
      }),
    };
  }
  try {
    const realFile = realpathSync(candidate);
    if (!isPathInside(packageRoot, realFile)) {
      return {
        ok: false,
        issue: pkgIssue("PATH_ESCAPE", `Package file resolves outside the package root: ${relativeFile}.`, {
          file: relativeFile,
        }),
      };
    }
    return { ok: true, absolutePath: realFile };
  } catch {
    return {
      ok: false,
      issue: pkgIssue("PATH_ESCAPE", `Unable to resolve package file: ${relativeFile}.`, {
        file: relativeFile,
      }),
    };
  }
}

export function parsePartnerAssetsJson(value: unknown): Readonly<{
  ok: true;
  document: PartnerAssetsDocument;
  errors: readonly PartnerPackageIssue[];
}> | Readonly<{
  ok: false;
  document: null;
  errors: readonly PartnerPackageIssue[];
}> {
  const errors: PartnerPackageIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      document: null,
      errors: [pkgIssue("INVALID_JSON", "partner-assets.json must be an object.")],
    };
  }
  const partnerId = asNonEmptyString(value.partnerId);
  if (!partnerId) {
    errors.push(pkgIssue("INVALID_PARTNER_ID", "partner-assets.json partnerId must be a non-empty string."));
  }
  if (!Array.isArray(value.assets)) {
    errors.push(pkgIssue("INVALID_JSON", "partner-assets.json assets must be an array."));
    return { ok: false, document: null, errors };
  }
  const assets: PartnerPackageAssetDeclaration[] = [];
  for (const [index, raw] of value.assets.entries()) {
    if (!isPlainObject(raw)) {
      errors.push(pkgIssue("INVALID_JSON", `assets[${index}] must be an object.`));
      continue;
    }
    if (raw.glbUrl != null) {
      errors.push(pkgIssue(
        "UNEXPECTED_GLB_URL",
        `assets[${index}] must not declare glbUrl; destination URLs are derived from assetId.`,
        { assetId: asNonEmptyString(raw.assetId) ?? undefined },
      ));
    }
    for (const key of Object.keys(raw)) {
      if ((FORBIDDEN_FURNITURE_ASSET_MANIFEST_KEYS as readonly string[]).includes(key)
        || key === "partnerId"
        || key === "partner_id"
      ) {
        errors.push(pkgIssue(
          "FORBIDDEN_COMMERCIAL_KEY",
          `assets[${index}] includes commercial field ${key}.`,
          { assetId: asNonEmptyString(raw.assetId) ?? undefined },
        ));
      }
    }
    const assetId = asNonEmptyString(raw.assetId);
    const file = asNonEmptyString(raw.file);
    const authoredWidthM = typeof raw.authoredWidthM === "number" ? raw.authoredWidthM : NaN;
    const authoredHeightM = typeof raw.authoredHeightM === "number" ? raw.authoredHeightM : NaN;
    const authoredDepthM = typeof raw.authoredDepthM === "number" ? raw.authoredDepthM : NaN;
    const expectedSha256 = raw.expectedSha256 == null
      ? undefined
      : asNonEmptyString(raw.expectedSha256);
    if (!assetId) errors.push(pkgIssue("INVALID_ASSET_ID", `assets[${index}].assetId is required.`));
    if (!file) errors.push(pkgIssue("FILE_MISSING", `assets[${index}].file is required.`));
    if (![authoredWidthM, authoredHeightM, authoredDepthM].every((value) => Number.isFinite(value) && value > 0)) {
      errors.push(pkgIssue(
        "INVALID_DECLARED_DIMENSIONS",
        `assets[${index}] authored dimensions must be finite positive metres.`,
        { assetId: assetId ?? undefined, file: file ?? undefined },
      ));
    }
    if (raw.expectedSha256 != null && !expectedSha256) {
      errors.push(pkgIssue("CHECKSUM_MISMATCH", `assets[${index}].expectedSha256 is invalid.`));
    }
    if (!assetId || !file) continue;
    assets.push({
      assetId,
      file,
      authoredWidthM,
      authoredHeightM,
      authoredDepthM,
      expectedSha256: expectedSha256 ?? undefined,
    });
  }
  if (errors.length > 0 || !partnerId) {
    return { ok: false, document: null, errors };
  }
  return { ok: true, document: { partnerId, assets }, errors: [] };
}

function summarizeAssetPlans(
  plans: readonly FurnitureAssetAssetPlan[],
): PartnerPackageAssetPlanSummary[] {
  return plans.map((item) => ({
    action: item.action,
    assetId: item.asset.assetId,
    sha256: item.asset.sha256,
    glbUrl: item.asset.glbUrl,
    glbDestination: item.glbDestination,
    migrationPath: item.migrationPath,
    authoredWidthM: item.asset.authoredWidthM,
    authoredHeightM: item.asset.authoredHeightM,
    authoredDepthM: item.asset.authoredDepthM,
  }));
}

function catalogReferencedAssetIds(document: PartnerCatalogDocument): Set<string> {
  const ids = new Set<string>();
  for (const product of document.products) {
    ids.add(product.defaultVariant.currentAssetId);
    for (const variant of product.variants) {
      ids.add(variant.currentAssetId);
    }
  }
  return ids;
}

function batchIdForCatalogJson(jsonRelativePath: string): string {
  const registered = PARTNER_CATALOG_DOCUMENTS.find((item) => (
    item.jsonRelativePath === jsonRelativePath
  ));
  return registered?.batchId ?? PI5F2_PACKAGE_BATCH_ID;
}

export async function planPartnerPackageImport(input: Readonly<{
  partnerAssets: PartnerAssetsDocument;
  catalogDocument: PartnerCatalogDocument;
  assets: readonly FurnitureAssetBatchItemInput[];
  repoRoot?: string;
  migrationTimestamp?: string;
  catalogBatchId?: string;
  catalogJsonRelativePath?: string;
}>): Promise<PartnerPackagePlan> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const issues: PartnerPackageIssue[] = [];
  const catalogPath = input.catalogJsonRelativePath;

  if (input.partnerAssets.partnerId !== input.catalogDocument.partner.partnerId) {
    issues.push(pkgIssue(
      "PARTNER_MISMATCH",
      `partner-assets.json partnerId ${input.partnerAssets.partnerId} does not match catalog ${input.catalogDocument.partner.partnerId}.`,
    ));
  }
  if (input.catalogDocument.partner.partnerId !== partnerIdForSlug(input.catalogDocument.partner.slug)) {
    issues.push(pkgIssue(
      "PARTNER_MISMATCH",
      `Catalog Partner ID ${input.catalogDocument.partner.partnerId} does not match slug namespace ${input.catalogDocument.partner.slug}.`,
    ));
  }

  const assetBatch = await planFurnitureAssetBatch({
    assets: input.assets,
    repoRoot,
    existingAssetPolicy: "reuse-identical",
    migrationTimestamp: input.migrationTimestamp,
  });
  issues.push(...assetBatch.issues);

  if (issues.some((item) => item.level === "error") || !assetBatch.ok || !assetBatch.finalManifest) {
    return {
      ok: false,
      issues,
      assetPlans: summarizeAssetPlans(assetBatch.assetPlans),
      catalogPlan: null,
      insertPartner: false,
      collectionCount: 0,
      migrationOrder: [],
      assetBatch,
      catalogDocument: input.catalogDocument,
    };
  }

  const referenced = catalogReferencedAssetIds(input.catalogDocument);
  for (const declared of input.partnerAssets.assets) {
    if (!referenced.has(declared.assetId)) {
      issues.push(pkgIssue(
        "UNUSED_ASSET",
        `Declared Asset ${declared.assetId} is not referenced by the partner catalog.`,
        { level: "warning", assetId: declared.assetId, file: declared.file },
      ));
    }
  }

  const plannedReadyAssets = assetBatch.assetPlans
    .filter((item) => item.action === "create")
    .map((item) => item.asset);
  const plannedIds = new Set(plannedReadyAssets.map((asset) => asset.assetId));
  const seedAssets = [
    ...STAGE_SEED_ASSETS,
    ...plannedReadyAssets
      .filter((asset) => !STAGE_SEED_ASSETS.some((item) => item.assetId === asset.assetId))
      .map((asset) => seedAssetFromCanonical(asset)),
  ];

  const catalogValidation = validatePartnerCatalog(input.catalogDocument, {
    repoRoot,
    catalog: STAGE_SEED_CATALOG,
    existingState: loadExistingPartnerCatalogState(repoRoot),
    manifest: assetBatch.finalManifest,
    plannedReadyAssets,
    runtimeAssetIds: assetBatch.finalManifest.assets.map((asset) => asset.assetId),
    seedAssets,
    runtimeDefinitionKnown: (assetId) => (
      furnitureAssetDefinition(assetId) != null || plannedIds.has(assetId)
    ),
  });
  if (!catalogValidation.ok) {
    for (const item of catalogValidation.errors) {
      issues.push(fromCommercial(item, { path: catalogPath }));
    }
    return {
      ok: false,
      issues,
      assetPlans: summarizeAssetPlans(assetBatch.assetPlans),
      catalogPlan: null,
      insertPartner: false,
      collectionCount: 0,
      migrationOrder: [],
      assetBatch,
      catalogDocument: input.catalogDocument,
    };
  }

  const lastAssetSql = assetBatch.sqlPlans[assetBatch.sqlPlans.length - 1];
  const catalogTimestamp = lastAssetSql
    ? nextUtcTimestamp(path.basename(lastAssetSql.path).slice(0, 14))
    : input.migrationTimestamp;

  const catalogPlan = planPartnerCatalogImport({
    parsed: catalogValidation.parsed,
    repoRoot,
    migrationTimestamp: catalogTimestamp,
    batchKey: input.catalogBatchId ?? PI5F2_PACKAGE_BATCH_ID,
  });

  const migrationOrder = [
    ...assetBatch.sqlPlans.map((item) => item.path),
    catalogPlan.migration,
  ];

  return {
    ok: issues.every((item) => item.level !== "error"),
    issues,
    assetPlans: summarizeAssetPlans(assetBatch.assetPlans),
    catalogPlan,
    insertPartner: catalogValidation.parsed.insertPartner,
    collectionCount: catalogValidation.parsed.collections.length,
    migrationOrder,
    assetBatch,
    catalogDocument: input.catalogDocument,
  };
}

export function loadPartnerPackageFromDirectory(input: Readonly<{
  packageDir: string;
  repoRoot?: string;
}>): Readonly<{
  ok: true;
  partnerAssets: PartnerAssetsDocument;
  catalogDocument: PartnerCatalogDocument;
  assets: FurnitureAssetBatchItemInput[];
  issues: readonly PartnerPackageIssue[];
  catalogJsonRelativePath: string;
}> | Readonly<{
  ok: false;
  issues: readonly PartnerPackageIssue[];
}> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const packageDir = path.resolve(repoRoot, input.packageDir);
  const issues: PartnerPackageIssue[] = [];
  const assetsPath = path.join(packageDir, PARTNER_ASSETS_JSON_NAME);
  const catalogPath = path.join(packageDir, PARTNER_CATALOG_JSON_NAME);
  if (!existsSync(assetsPath)) {
    issues.push(pkgIssue("INVALID_JSON", `Missing ${PARTNER_ASSETS_JSON_NAME}.`, { file: PARTNER_ASSETS_JSON_NAME }));
  }
  if (!existsSync(catalogPath)) {
    issues.push(pkgIssue("INVALID_JSON", `Missing ${PARTNER_CATALOG_JSON_NAME}.`, { file: PARTNER_CATALOG_JSON_NAME }));
  }
  if (issues.length > 0) return { ok: false, issues };

  let assetsRaw: unknown;
  let catalogRaw: unknown;
  try {
    assetsRaw = JSON.parse(readFileSync(assetsPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      issues: [pkgIssue(
        "INVALID_JSON",
        error instanceof Error ? error.message : "Unable to read partner-assets.json.",
        { file: PARTNER_ASSETS_JSON_NAME },
      )],
    };
  }
  try {
    catalogRaw = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      issues: [pkgIssue(
        "INVALID_JSON",
        error instanceof Error ? error.message : "Unable to read partner-catalog.json.",
        { file: PARTNER_CATALOG_JSON_NAME },
      )],
    };
  }

  const parsedAssets = parsePartnerAssetsJson(assetsRaw);
  const parsedCatalog = parsePartnerCatalogJson(catalogRaw);
  if (!parsedAssets.ok) issues.push(...parsedAssets.errors);
  if (!parsedCatalog.ok) {
    for (const item of parsedCatalog.errors) {
      issues.push(fromCommercial(item, { path: PARTNER_CATALOG_JSON_NAME }));
    }
  }
  if (!parsedAssets.ok || !parsedCatalog.ok) {
    return { ok: false, issues };
  }

  const assets: FurnitureAssetBatchItemInput[] = [];
  for (const declared of parsedAssets.document.assets) {
    const jailed = resolveJailedPackagePath({
      packageRoot: packageDir,
      relativeFile: declared.file,
    });
    if (!jailed.ok) {
      issues.push({ ...jailed.issue, assetId: declared.assetId, file: declared.file });
      continue;
    }
    try {
      if (lstatSync(jailed.absolutePath).isSymbolicLink()) {
        const realFile = realpathSync(jailed.absolutePath);
        if (!isPathInside(realpathSync(packageDir), realFile)) {
          issues.push(pkgIssue(
            "PATH_ESCAPE",
            `Package file resolves outside the package root: ${declared.file}.`,
            { assetId: declared.assetId, file: declared.file },
          ));
          continue;
        }
      }
    } catch {
      issues.push(pkgIssue("PATH_ESCAPE", `Unable to inspect ${declared.file}.`, {
        assetId: declared.assetId,
        file: declared.file,
      }));
      continue;
    }
    const buffer = readFileSync(jailed.absolutePath);
    assets.push({
      assetId: declared.assetId,
      bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      authoredWidthM: declared.authoredWidthM,
      authoredHeightM: declared.authoredHeightM,
      authoredDepthM: declared.authoredDepthM,
      expectedSha256: declared.expectedSha256,
      sourcePath: declared.file,
      glbUrl: defaultGlbUrlForAssetId(declared.assetId),
    });
  }
  if (issues.some((item) => item.level === "error")) {
    return { ok: false, issues };
  }

  const catalogJsonRelativePath = path.relative(repoRoot, catalogPath);
  return {
    ok: true,
    partnerAssets: parsedAssets.document,
    catalogDocument: parsedCatalog.document,
    assets,
    issues,
    catalogJsonRelativePath: catalogJsonRelativePath || path.join(
      PI5F2_PACKAGE_RELATIVE_PATH,
      PARTNER_CATALOG_JSON_NAME,
    ),
  };
}

function restoreTextFile(filePath: string, contents: string | null): void {
  if (contents == null) return;
  writeFileAtomic(filePath, contents);
}

function unlinkCreated(created: readonly string[]): string[] {
  const leftover: string[] = [];
  for (const filePath of created) {
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      leftover.push(filePath);
    }
  }
  return leftover;
}

export async function importPartnerPackage(input: Readonly<{
  packageDir: string;
  repoRoot?: string;
  check?: boolean;
  migrationTimestamp?: string;
  catalogBatchId?: string;
}>): Promise<PartnerPackageImportResult> {
  const check = input.check === true;
  const repoRoot = input.repoRoot ?? process.cwd();
  const loaded = loadPartnerPackageFromDirectory({
    packageDir: input.packageDir,
    repoRoot,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      check,
      issues: loaded.issues,
      assetPlans: [],
      catalogPlan: null,
      written: null,
      migrationOrder: [],
      incompleteRecovery: [],
    };
  }

  const batchId = input.catalogBatchId ?? batchIdForCatalogJson(loaded.catalogJsonRelativePath);
  if (!check) {
    const sqlSlug = partnerCatalogSqlSlug(batchId);
    const existingBatchSql = listPartnerCatalogMigrations(repoRoot).find((fileName) => (
      isPartnerCatalogSqlForSlug(fileName, sqlSlug)
    ));
    if (existingBatchSql) {
      return {
        ok: false,
        check,
        issues: [pkgIssue(
          "MIGRATION_EXISTS",
          `Partner catalog migration already exists: ${existingBatchSql}`,
        )],
        assetPlans: [],
        catalogPlan: null,
        written: null,
        migrationOrder: [],
        incompleteRecovery: [],
      };
    }
  }

  const plan = await planPartnerPackageImport({
    partnerAssets: loaded.partnerAssets,
    catalogDocument: loaded.catalogDocument,
    assets: loaded.assets,
    repoRoot,
    migrationTimestamp: input.migrationTimestamp,
    catalogBatchId: batchId,
    catalogJsonRelativePath: loaded.catalogJsonRelativePath,
  });

  if (!plan.ok || !plan.catalogPlan || !plan.assetBatch?.ok || !plan.assetBatch.finalManifest) {
    return {
      ok: false,
      check,
      issues: plan.issues,
      assetPlans: plan.assetPlans,
      catalogPlan: plan.catalogPlan,
      written: null,
      migrationOrder: plan.migrationOrder,
      incompleteRecovery: [],
    };
  }

  if (check) {
    return {
      ok: true,
      check: true,
      issues: plan.issues,
      assetPlans: plan.assetPlans,
      catalogPlan: plan.catalogPlan,
      written: null,
      migrationOrder: plan.migrationOrder,
      incompleteRecovery: [],
    };
  }

  if (existsSync(plan.catalogPlan.migration)) {
    return {
      ok: false,
      check,
      issues: [pkgIssue(
        "MIGRATION_EXISTS",
        `Partner catalog migration already exists: ${plan.catalogPlan.migration}`,
      )],
      assetPlans: plan.assetPlans,
      catalogPlan: plan.catalogPlan,
      written: null,
      migrationOrder: plan.migrationOrder,
      incompleteRecovery: [],
    };
  }
  for (const sqlPlan of plan.assetBatch.sqlPlans) {
    if (existsSync(sqlPlan.path)) {
      return {
        ok: false,
        check,
        issues: [pkgIssue(
          "MIGRATION_EXISTS",
          `Asset migration already exists: ${sqlPlan.path}`,
          { assetId: sqlPlan.assetId },
        )],
        assetPlans: plan.assetPlans,
        catalogPlan: plan.catalogPlan,
        written: null,
        migrationOrder: plan.migrationOrder,
        incompleteRecovery: [],
      };
    }
  }

  const paths = furnitureAssetRepoPaths(repoRoot);
  const manifestBefore = existsSync(paths.manifest) ? readFileSync(paths.manifest, "utf8") : null;
  const registryBefore = existsSync(paths.generatedRegistry)
    ? readFileSync(paths.generatedRegistry, "utf8")
    : null;
  const created: string[] = [];
  const writtenGlbs: string[] = [];
  let wroteManifest = false;

  try {
    for (const assetPlan of plan.assetBatch.assetPlans) {
      if (assetPlan.action !== "create") continue;
      const dest = assetPlan.glbDestination;
      const existed = existsSync(dest);
      if (!existed) {
        writeFileAtomic(dest, Buffer.from(loaded.assets.find((item) => (
          item.assetId === assetPlan.asset.assetId
        ))!.bytes));
        created.push(dest);
      }
      writtenGlbs.push(dest);
    }
    for (const sqlPlan of plan.assetBatch.sqlPlans) {
      writeFileAtomic(sqlPlan.path, sqlPlan.sql);
      created.push(sqlPlan.path);
    }
    if (plan.assetBatch.assetPlans.some((item) => item.action === "create")) {
      writeFurnitureAssetManifest(repoRoot, plan.assetBatch.finalManifest);
      writeGeneratedFurnitureAssetRegistry(repoRoot, plan.assetBatch.finalManifest.assets);
      wroteManifest = true;
    }
    writeFileAtomic(plan.catalogPlan.migration, plan.catalogPlan.sql);
    created.push(plan.catalogPlan.migration);
  } catch (error) {
    if (wroteManifest) {
      restoreTextFile(paths.manifest, manifestBefore);
      restoreTextFile(paths.generatedRegistry, registryBefore);
    }
    const leftover = unlinkCreated(created);
    return {
      ok: false,
      check,
      issues: [
        pkgIssue(
          "WRITE_FAILED",
          error instanceof Error ? error.message : "Unable to write partner package artifacts.",
        ),
        ...leftover.map((filePath) => pkgIssue(
          "INCOMPLETE_RECOVERY",
          `Unable to fully roll back newly created file ${filePath}.`,
          { file: filePath },
        )),
      ],
      assetPlans: plan.assetPlans,
      catalogPlan: plan.catalogPlan,
      written: null,
      migrationOrder: plan.migrationOrder,
      incompleteRecovery: leftover,
    };
  }

  return {
    ok: true,
    check: false,
    issues: plan.issues,
    assetPlans: plan.assetPlans,
    catalogPlan: plan.catalogPlan,
    written: {
      glbs: writtenGlbs,
      assetSqls: plan.assetBatch.sqlPlans.map((item) => item.path),
      manifest: paths.manifest,
      generatedRegistry: paths.generatedRegistry,
      catalogSql: plan.catalogPlan.migration,
    },
    migrationOrder: plan.migrationOrder,
    incompleteRecovery: [],
  };
}
