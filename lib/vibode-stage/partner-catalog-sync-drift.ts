/**
 * PI-5F3A partner catalog sync drift detection.
 *
 * Node-only. Separate from registration, Asset, association, and
 * curated commercial drift. The viewer does not import this module.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { PARTNER_CATALOG_DOCUMENTS } from "./partner-catalog-documents";
import {
  isPartnerCatalogMigrationFileName,
  listPartnerCatalogMigrations,
  parsePartnerCatalogSql,
} from "./partner-catalog";
import {
  ALLOWED_PRODUCT_SYNC_COLUMNS,
  ALLOWED_VARIANT_SYNC_COLUMNS,
  foldPartnerCatalogCurrentState,
  isPartnerSyncMigrationFileName,
  isPartnerSyncSqlForSlug,
  listPartnerSyncMigrations,
  parsePartnerCatalogSyncJson,
  parsePartnerCatalogSyncSql,
  planPartnerCatalogSync,
} from "./partner-catalog-sync";
import { PARTNER_SYNC_DOCUMENTS } from "./partner-sync-documents";
import {
  productRegistrationRepoPaths,
  type ProductVariantIssue,
} from "./product-variant-register";

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

function sameMembership(
  left: Readonly<{ productId: string; collectionId: string }>,
  right: Readonly<{ productId: string; collectionId: string }>,
): boolean {
  return left.productId === right.productId && left.collectionId === right.collectionId;
}

export function detectPartnerCatalogSyncDrift(input: Readonly<{
  repoRoot?: string;
}> = {}): ProductVariantIssue[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const issues: ProductVariantIssue[] = [];
  const paths = productRegistrationRepoPaths(repoRoot);
  const files = listPartnerSyncMigrations(repoRoot);
  const mappedSql = new Set<string>();

  const firstFold = foldPartnerCatalogCurrentState({ repoRoot });
  const secondFold = foldPartnerCatalogCurrentState({ repoRoot });
  if (!firstFold.ok) {
    issues.push(...firstFold.issues);
  } else if (!secondFold.ok) {
    issues.push(...secondFold.issues);
  } else if (JSON.stringify(firstFold.state) !== JSON.stringify(secondFold.state)) {
    issues.push(issue("FOLD_NOT_DETERMINISTIC", "Partner catalog current-state fold is not deterministic."));
  }

  const registrationFiles = listPartnerCatalogMigrations(repoRoot);
  for (const fileName of registrationFiles) {
    if (isPartnerSyncMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} is classified as both partner_catalog and partner_sync.`,
      ));
    }
    const sql = readFileSync(path.join(paths.migrationsDir, fileName), "utf8");
    const parsed = parsePartnerCatalogSql(sql);
    if (parsed.updatesProduct || parsed.updatesVariant) {
      issues.push(issue("SQL_UPDATES_PRODUCT", `${fileName} registration SQL is not INSERT-only.`));
    }
  }

  for (const fileName of files) {
    if (isPartnerCatalogMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} is classified as a partner catalog registration migration.`,
      ));
    }
  }

  for (const documentReg of PARTNER_SYNC_DOCUMENTS) {
    const jsonPath = path.join(repoRoot, documentReg.jsonRelativePath);
    if (!existsSync(jsonPath)) {
      issues.push(issue(
        "PARTNER_JSON_MISSING",
        `Missing partner sync JSON at ${documentReg.jsonRelativePath}.`,
      ));
      continue;
    }
    let parsedJson: ReturnType<typeof parsePartnerCatalogSyncJson>;
    try {
      parsedJson = parsePartnerCatalogSyncJson(JSON.parse(readFileSync(jsonPath, "utf8")));
    } catch (error) {
      issues.push(issue(
        "INVALID_JSON",
        error instanceof Error ? error.message : `Partner sync JSON is malformed: ${documentReg.jsonRelativePath}.`,
      ));
      continue;
    }
    if (!parsedJson.ok) {
      for (const item of parsedJson.issues) {
        issues.push(issue(item.code, `${documentReg.jsonRelativePath}: ${item.message}`));
      }
      continue;
    }

    const prior = foldPartnerCatalogCurrentState({
      repoRoot,
      stopBeforeSyncBatchId: documentReg.batchId,
    });
    if (!prior.ok) {
      issues.push(...prior.issues);
      continue;
    }
    const plan = planPartnerCatalogSync({
      current: prior.state,
      document: parsedJson.document,
      repoRoot,
      sqlSlug: documentReg.sqlSlug,
    });
    if (!plan.ok) {
      issues.push(...plan.issues);
      continue;
    }

    const matches = files.filter((fileName) => isPartnerSyncSqlForSlug(fileName, documentReg.sqlSlug));
    if (plan.noOp) {
      if (matches.length > 0) {
        issues.push(issue(
          "SQL_IDENTITY_MISMATCH",
          `No-op sync batch ${documentReg.batchId} must not have partner_sync SQL.`,
        ));
      }
      continue;
    }
    if (matches.length === 0) {
      issues.push(issue(
        "PARTNER_SQL_MISSING",
        `Missing partner sync SQL for batch ${documentReg.batchId}.`,
      ));
      continue;
    }
    if (matches.length > 1) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `Multiple partner sync SQL files map to batch ${documentReg.batchId}.`,
      ));
    }
    const fileName = matches[0]!;
    mappedSql.add(fileName);
    const sql = readFileSync(path.join(paths.migrationsDir, fileName), "utf8");
    const parsedSql = parsePartnerCatalogSyncSql(sql);
    if (!parsedSql.hasBegin || !parsedSql.hasCommit) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is not a single transaction.`));
    }
    if (!parsedSql.mentionsStaleSync) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing STALE_SYNC protection.`));
    }
    if (parsedSql.updatesCurrentAssetId) {
      issues.push(issue("ASSET_RETARGET_REQUIRED", `${fileName} updates current_asset_id.`));
    }
    if (parsedSql.mutatesAssets) {
      issues.push(issue("SQL_TOUCHES_ASSETS", `${fileName} mutates vibode_stage_assets.`));
    }
    if (parsedSql.touchesObjectsJson) {
      issues.push(issue("SQL_TOUCHES_OBJECTS_JSON", `${fileName} mentions objects_json.`));
    }
    if (parsedSql.touchesScenes) {
      issues.push(issue("SQL_TOUCHES_SCENE_OBJECTS", `${fileName} mentions vibode_3d_scenes.`));
    }
    if (parsedSql.usesUpsert) {
      issues.push(issue("SQL_USES_UPSERT", `${fileName} uses upsert semantics.`));
    }
    if (parsedSql.deletesProduct || parsedSql.deletesVariant || parsedSql.deletesPartner || parsedSql.deletesCollection) {
      issues.push(issue("SQL_FORBIDDEN_DELETE", `${fileName} hard-deletes commercial identity.`));
    }
    if (parsedSql.forbiddenTables.length > 0) {
      issues.push(issue(
        "SQL_FORBIDDEN_PARTNER_TABLE",
        `${fileName} references ${parsedSql.forbiddenTables.join(", ")}.`,
      ));
    }
    for (const column of parsedSql.productUpdateColumns) {
      if (!(ALLOWED_PRODUCT_SYNC_COLUMNS as readonly string[]).includes(column)) {
        issues.push(issue("SQL_FORBIDDEN_COLUMN", `${fileName} updates Product column ${column}.`));
      }
    }
    for (const column of parsedSql.variantUpdateColumns) {
      if (!(ALLOWED_VARIANT_SYNC_COLUMNS as readonly string[]).includes(column)) {
        issues.push(issue("SQL_FORBIDDEN_COLUMN", `${fileName} updates Variant column ${column}.`));
      }
    }
    for (const column of parsedSql.collectionUpdateColumns) {
      if (column !== "name") {
        issues.push(issue("SQL_FORBIDDEN_COLUMN", `${fileName} updates Collection column ${column}.`));
      }
    }

    const plannedProductIds = plan.productUpdates.map((item) => item.productId).sort();
    const sqlProductIds = [...parsedSql.updatedProductIds].sort();
    if (JSON.stringify(plannedProductIds) !== JSON.stringify(sqlProductIds)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Product updates differ from the sync document plan.`));
    }
    const plannedVariantUpdateIds = plan.variantUpdates.map((item) => item.variantId).sort();
    const sqlVariantUpdateIds = [...parsedSql.updatedVariantIds].sort();
    if (JSON.stringify(plannedVariantUpdateIds) !== JSON.stringify(sqlVariantUpdateIds)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Variant updates differ from the sync document plan.`));
    }
    const plannedVariantCreateIds = plan.variantCreates.map((item) => item.variant.variantId).sort();
    const sqlVariantCreateIds = [...parsedSql.insertedVariantIds].sort();
    if (JSON.stringify(plannedVariantCreateIds) !== JSON.stringify(sqlVariantCreateIds)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Variant creates differ from the sync document plan.`));
    }

    const plannedProductDeactivate = plan.productDeactivations
      .map((item) => `${item.productId}:${item.from}:${item.to}`)
      .sort();
    const sqlProductDeactivate = parsedSql.productStatusTransitions
      .filter((item) => item.to === "inactive")
      .map((item) => `${item.productId}:${item.from}:${item.to}`)
      .sort();
    if (JSON.stringify(plannedProductDeactivate) !== JSON.stringify(sqlProductDeactivate)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Product deactivations differ from the sync document plan.`));
    }
    const plannedProductReactivate = plan.productReactivations
      .map((item) => `${item.productId}:${item.from}:${item.to}`)
      .sort();
    const sqlProductReactivate = parsedSql.productStatusTransitions
      .filter((item) => item.to === "active")
      .map((item) => `${item.productId}:${item.from}:${item.to}`)
      .sort();
    if (JSON.stringify(plannedProductReactivate) !== JSON.stringify(sqlProductReactivate)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Product reactivations differ from the sync document plan.`));
    }
    const plannedVariantDeactivate = plan.variantDeactivations
      .map((item) => `${item.variantId}:${item.from}:${item.to}`)
      .sort();
    const sqlVariantDeactivate = parsedSql.variantStatusTransitions
      .filter((item) => item.to === "inactive")
      .map((item) => `${item.variantId}:${item.from}:${item.to}`)
      .sort();
    if (JSON.stringify(plannedVariantDeactivate) !== JSON.stringify(sqlVariantDeactivate)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Variant deactivations differ from the sync document plan.`));
    }
    const plannedVariantReactivate = plan.variantReactivations
      .map((item) => `${item.variantId}:${item.from}:${item.to}`)
      .sort();
    const sqlVariantReactivate = parsedSql.variantStatusTransitions
      .filter((item) => item.to === "active")
      .map((item) => `${item.variantId}:${item.from}:${item.to}`)
      .sort();
    if (JSON.stringify(plannedVariantReactivate) !== JSON.stringify(sqlVariantReactivate)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Variant reactivations differ from the sync document plan.`));
    }
    if (
      parsedSql.productStatusTransitions.some((item) => (
        !plan.productDeactivations.some((planned) => (
          planned.productId === item.productId && planned.from === item.from && planned.to === item.to
        )) &&
        !plan.productReactivations.some((planned) => (
          planned.productId === item.productId && planned.from === item.from && planned.to === item.to
        ))
      ))
    ) {
      issues.push(issue("SQL_FORBIDDEN_COLUMN", `${fileName} has unplanned Product status SQL.`));
    }
    if (
      parsedSql.variantStatusTransitions.some((item) => (
        !plan.variantDeactivations.some((planned) => (
          planned.variantId === item.variantId && planned.from === item.from && planned.to === item.to
        )) &&
        !plan.variantReactivations.some((planned) => (
          planned.variantId === item.variantId && planned.from === item.from && planned.to === item.to
        ))
      ))
    ) {
      issues.push(issue("SQL_FORBIDDEN_COLUMN", `${fileName} has unplanned Variant status SQL.`));
    }
    for (const membership of plan.membershipAdds) {
      if (!parsedSql.insertedMemberships.some((item) => sameMembership(item, membership))) {
        issues.push(issue(
          "SQL_JSON_MISMATCH",
          `${fileName} is missing membership add ${membership.productId} → ${membership.collectionId}.`,
        ));
      }
    }
    for (const membership of parsedSql.insertedMemberships) {
      if (!plan.membershipAdds.some((item) => sameMembership(item, membership))) {
        issues.push(issue(
          "SQL_JSON_MISMATCH",
          `${fileName} has extra membership add ${membership.productId} → ${membership.collectionId}.`,
        ));
      }
    }
    for (const membership of plan.membershipRemoves) {
      if (!parsedSql.deletedMemberships.some((item) => sameMembership(item, membership))) {
        issues.push(issue(
          "SQL_JSON_MISMATCH",
          `${fileName} is missing membership remove ${membership.productId} → ${membership.collectionId}.`,
        ));
      }
    }
    for (const membership of parsedSql.deletedMemberships) {
      if (!plan.membershipRemoves.some((item) => sameMembership(item, membership))) {
        issues.push(issue(
          "SQL_JSON_MISMATCH",
          `${fileName} has extra membership remove ${membership.productId} → ${membership.collectionId}.`,
        ));
      }
    }
  }

  for (const fileName of files) {
    if (!mappedSql.has(fileName)) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} is not mapped to a registered partner sync document.`,
      ));
    }
  }

  for (const documentReg of PARTNER_CATALOG_DOCUMENTS) {
    if (PARTNER_SYNC_DOCUMENTS.some((item) => item.jsonRelativePath === documentReg.jsonRelativePath)) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `Registration document ${documentReg.batchId} is mixed into PARTNER_SYNC_DOCUMENTS.`,
      ));
    }
  }

  return issues;
}
