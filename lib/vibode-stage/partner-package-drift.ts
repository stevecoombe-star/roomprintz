/**
 * PI-5F2A partner package drift detection.
 *
 * Node-only. Separate from technical furniture Asset drift and from
 * generic partner catalog multi-batch drift. The viewer does not import
 * this module.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import { isFurnitureAssetMigrationFileName } from "@/lib/afc-v2-runtime/furniture-asset-generate";
import {
  findManifestAsset,
  loadFurnitureAssetManifest,
  publicFilePathFromGlbUrl,
} from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import { defaultGlbUrlForAssetId } from "@/lib/afc-v2-runtime/furniture-asset-policy";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { sha256Hex } from "@/lib/afc-v2-runtime/furniture-asset-validate";

import {
  isPartnerCatalogSqlForSlug,
  listPartnerCatalogMigrations,
  parsePartnerCatalogSql,
} from "./partner-catalog";
import { productRegistrationRepoPaths } from "./product-variant-register";
import {
  PI5F2_PACKAGE_BATCH_ID,
  PI5F2_PACKAGE_RELATIVE_PATH,
} from "./partner-catalog-documents";
import {
  loadPartnerPackageFromDirectory,
  parsePartnerAssetsJson,
  PARTNER_ASSETS_JSON_NAME,
  type PartnerPackageIssue,
} from "./partner-package";

function issue(
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

export function detectPartnerPackageDrift(input: Readonly<{
  repoRoot?: string;
  packageDir?: string;
  catalogBatchId?: string;
}> = {}): PartnerPackageIssue[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const packageDir = input.packageDir ?? path.join(repoRoot, PI5F2_PACKAGE_RELATIVE_PATH);
  const issues: PartnerPackageIssue[] = [];
  const loaded = loadPartnerPackageFromDirectory({ packageDir, repoRoot });
  if (!loaded.ok) return [...loaded.issues];

  if (loaded.partnerAssets.partnerId !== loaded.catalogDocument.partner.partnerId) {
    issues.push(issue(
      "PARTNER_MISMATCH",
      "Package Asset Partner ID does not match catalog Partner ID.",
    ));
  }

  const assetsRaw = JSON.parse(readFileSync(
    path.join(packageDir, PARTNER_ASSETS_JSON_NAME),
    "utf8",
  ));
  const parsedAssets = parsePartnerAssetsJson(assetsRaw);
  if (!parsedAssets.ok) issues.push(...parsedAssets.errors);

  const manifestLoaded = loadFurnitureAssetManifest(repoRoot);
  if (!manifestLoaded.ok) {
    for (const item of manifestLoaded.errors) {
      issues.push(issue(item.code, item.message));
    }
    return issues;
  }

  const referenced = new Set<string>();
  for (const product of loaded.catalogDocument.products) {
    referenced.add(product.defaultVariant.currentAssetId);
    for (const variant of product.variants) referenced.add(variant.currentAssetId);
  }

  const migrationsDir = productRegistrationRepoPaths(repoRoot).migrationsDir;
  const assetSqlFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir).filter((name) => isFurnitureAssetMigrationFileName(name)).sort()
    : [];

  const createOrder: string[] = [];
  for (const declared of loaded.partnerAssets.assets) {
    const extra = { assetId: declared.assetId, file: declared.file };
    const bytes = loaded.assets.find((item) => item.assetId === declared.assetId)?.bytes;
    if (!bytes) {
      issues.push(issue("FILE_MISSING", `Missing GLB bytes for ${declared.assetId}.`, extra));
      continue;
    }
    const digest = sha256Hex(bytes);
    const glbUrl = defaultGlbUrlForAssetId(declared.assetId);
    const dest = publicFilePathFromGlbUrl(repoRoot, glbUrl);
    if (!existsSync(dest)) {
      issues.push(issue("FILE_MISSING", `Canonical GLB is missing for ${declared.assetId}.`, extra));
    } else {
      const destHash = sha256Hex(new Uint8Array(readFileSync(dest)));
      if (destHash !== digest) {
        issues.push(issue(
          "CHECKSUM_MISMATCH",
          `Package GLB checksum does not match canonical file for ${declared.assetId}.`,
          extra,
        ));
      }
    }

    const published = findManifestAsset(manifestLoaded.manifest, declared.assetId);
    if (!published) {
      issues.push(issue("UNKNOWN_ASSET", `Manifest is missing package Asset ${declared.assetId}.`, extra));
    } else {
      if (published.sha256 !== digest) {
        issues.push(issue(
          "CHECKSUM_MISMATCH",
          `Manifest checksum does not match package GLB for ${declared.assetId}.`,
          extra,
        ));
      }
      if (published.glbUrl !== glbUrl) {
        issues.push(issue("URL_MISMATCH", `Manifest glbUrl drifted for ${declared.assetId}.`, extra));
      }
    }

    const registryPath = path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-registry.generated.ts");
    if (!existsSync(registryPath) || !readFileSync(registryPath, "utf8").includes(declared.assetId)) {
      issues.push(issue(
        "RUNTIME_MISSING_ASSET",
        `Generated registry is missing package Asset ${declared.assetId}.`,
        extra,
      ));
    }
    const runtime = GENERATED_FURNITURE_ASSETS.find((item) => item.assetId === declared.assetId);
    if (repoRoot === process.cwd()) {
      if (!runtime || runtime.sha256 !== digest || runtime.glbUrl !== glbUrl) {
        issues.push(issue(
          "RUNTIME_MISSING_ASSET",
          `Generated registry drifted for package Asset ${declared.assetId}.`,
          extra,
        ));
      }
      if (furnitureAssetDefinition(declared.assetId) == null) {
        issues.push(issue(
          "UNKNOWN_RUNTIME_DEFINITION",
          `furnitureAssetDefinition does not resolve ${declared.assetId}.`,
          extra,
        ));
      }
    }

    const slug = declared.assetId.split("/").pop()?.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    const sqlFile = assetSqlFiles.find((name) => name.endsWith(`_vibode_stage_asset_${slug}.sql`));
    if (!sqlFile) {
      issues.push(issue("PARTNER_SQL_MISSING", `Missing Asset SQL for ${declared.assetId}.`, extra));
    } else {
      const sql = readFileSync(path.join(migrationsDir, sqlFile), "utf8");
      if (!sql.includes(declared.assetId) || !sql.includes(glbUrl)) {
        issues.push(issue("SQL_JSON_MISMATCH", `${sqlFile} does not match package Asset ${declared.assetId}.`, extra));
      }
      if (/partner_id/i.test(sql)) {
        issues.push(issue("FORBIDDEN_COMMERCIAL_KEY", `${sqlFile} includes partner_id.`, extra));
      }
      if (/update\s+public\.vibode_stage_assets/i.test(sql)) {
        issues.push(issue("SQL_TOUCHES_ASSETS", `${sqlFile} updates Assets.`, extra));
      }
      createOrder.push(sqlFile);
    }
  }

  const manifestText = readFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"),
    "utf8",
  );
  if (/"partnerId"|"partner_id"|"productId"|"variantId"/.test(manifestText)) {
    issues.push(issue(
      "FORBIDDEN_COMMERCIAL_KEY",
      "Canonical furniture Asset manifest includes commercial or partner ownership keys.",
    ));
  }

  const catalogFiles = listPartnerCatalogMigrations(repoRoot).filter((fileName) => (
    isPartnerCatalogSqlForSlug(fileName, (input.catalogBatchId ?? PI5F2_PACKAGE_BATCH_ID)
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase())
  ));
  if (catalogFiles.length !== 1) {
    issues.push(issue(
      "PARTNER_SQL_MISSING",
      `Expected one partner catalog SQL for package batch ${input.catalogBatchId ?? PI5F2_PACKAGE_BATCH_ID}.`,
    ));
  } else {
    const catalogSql = readFileSync(path.join(migrationsDir, catalogFiles[0]!), "utf8");
    const parsed = parsePartnerCatalogSql(catalogSql);
    if (parsed.mutatesAssets) {
      issues.push(issue("SQL_TOUCHES_ASSETS", `${catalogFiles[0]} mutates vibode_stage_assets.`));
    }
    if (parsed.updatesProduct) {
      issues.push(issue("SQL_UPDATES_PRODUCT", `${catalogFiles[0]} updates Products.`));
    }
    if (parsed.updatesVariant) {
      issues.push(issue("SQL_UPDATES_VARIANT", `${catalogFiles[0]} updates Variants.`));
    }
    if (parsed.touchesScenes || parsed.touchesObjectsJson) {
      issues.push(issue("SQL_TOUCHES_SCENE_OBJECTS", `${catalogFiles[0]} mutates Scene state.`));
    }
    if (parsed.insertsPartner) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${catalogFiles[0]} must reuse the existing Partner.`));
    }
    if (parsed.insertsCollection) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${catalogFiles[0]} must reuse Demo Living Room by omission.`));
    }
    for (const product of loaded.catalogDocument.products) {
      if (!parsed.productIds.includes(product.product.productId)) {
        issues.push(issue(
          "SQL_JSON_MISMATCH",
          `${catalogFiles[0]} is missing Product ${product.product.productId}.`,
        ));
      }
      if (!referenced.has(product.defaultVariant.currentAssetId)) continue;
    }
    for (const assetId of referenced) {
      if (!parsed.assetIds.includes(assetId)) {
        issues.push(issue(
          "SQL_JSON_MISMATCH",
          `${catalogFiles[0]} is missing currentAssetId ${assetId}.`,
        ));
      }
    }
    const catalogStamp = Number(catalogFiles[0]!.slice(0, 14));
    for (const sqlFile of createOrder) {
      const stamp = Number(sqlFile.slice(0, 14));
      if (!(stamp < catalogStamp)) {
        issues.push(issue(
          "SQL_IDENTITY_MISMATCH",
          `Asset SQL ${sqlFile} must sort before catalog SQL ${catalogFiles[0]}.`,
        ));
      }
    }
  }

  return issues;
}
