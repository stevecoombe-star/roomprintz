/**
 * PI-5F1 partner catalog drift detection.
 *
 * Node-only. Separate from Asset, association, and curated commercial drift.
 * The viewer does not import this module.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";

import {
  isStageAssetReady,
  STAGE_SEED_CATALOG,
} from "./catalog";
import {
  GENERATED_REGISTERED_PRODUCTS,
} from "./catalog-commercial.generated";
import {
  isPartnerCatalogMigrationFileName,
  isPartnerCatalogSqlForSlug,
  listPartnerCatalogMigrations,
  parsePartnerCatalogJson,
  parsePartnerCatalogSql,
  partnerIdForSlug,
  validatePartnerIdentity,
  type ExistingPartnerCatalogState,
} from "./partner-catalog";
import { PARTNER_CATALOG_DOCUMENTS } from "./partner-catalog-documents";
import {
  isProductRegistrationMigrationFileName,
  isVariantRegistrationMigrationFileName,
  productRegistrationRepoPaths,
  skuOwnerForVariant,
  skuScopeKey,
  type ProductVariantIssue,
} from "./product-variant-register";
import type { StageCatalogSnapshot, StagePartner } from "./types";
import { isVariantAssociationMigrationFileName } from "./variant-asset-association";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

export function detectPartnerCatalogDrift(input: Readonly<{
  repoRoot?: string;
  catalog?: StageCatalogSnapshot;
  partnerJsonRelativePath?: string;
}> = {}): ProductVariantIssue[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const catalog = input.catalog ?? STAGE_SEED_CATALOG;
  const issues: ProductVariantIssue[] = [];
  const paths = productRegistrationRepoPaths(repoRoot);

  const partnersById = new Map<string, StagePartner>();
  const slugs = new Map<string, string>();
  for (const partner of catalog.partners) {
    const identityIssues = validatePartnerIdentity(partner, [...partnersById.values()]);
    issues.push(...identityIssues);
    if (partnersById.has(partner.partnerId)) {
      issues.push(issue("DUPLICATE_PARTNER_ID", `Duplicate Partner ID ${partner.partnerId}.`));
    }
    partnersById.set(partner.partnerId, partner);
    if (slugs.has(partner.slug) && slugs.get(partner.slug) !== partner.partnerId) {
      issues.push(issue("DUPLICATE_PARTNER_SLUG", `Duplicate Partner slug ${partner.slug}.`));
    }
    slugs.set(partner.slug, partner.partnerId);
    if (partner.partnerId !== partnerIdForSlug(partner.slug)) {
      issues.push(issue(
        "PARTNER_ID_SLUG_MISMATCH",
        `Partner ${partner.partnerId} slug ${partner.slug} is inconsistent.`,
      ));
    }
  }

  for (const product of catalog.products) {
    if (product.source === "partner_catalog") {
      if (!product.partnerId) {
        issues.push(issue(
          "MISSING_PARTNER_ID",
          `partner_catalog Product ${product.productId} requires partnerId.`,
        ));
      } else {
        const partner = partnersById.get(product.partnerId)
          ?? catalog.partners.find((item) => item.partnerId === product.partnerId)
          ?? null;
        const slug = partner?.slug ?? product.partnerId.replace(/^partner-/, "");
        if (!product.productId.startsWith(`prod-${slug}-`)) {
          issues.push(issue(
            "PRODUCT_NAMESPACE_MISMATCH",
            `Product ${product.productId} is not in Partner ${slug} namespace.`,
          ));
        }
      }
    } else if (product.partnerId) {
      issues.push(issue(
        "UNEXPECTED_PARTNER_ID",
        `Product ${product.productId} source ${product.source} must not have partnerId.`,
      ));
    }
  }

  for (const variant of catalog.variants) {
    const product = catalog.products.find((item) => item.productId === variant.productId);
    if (product?.source !== "partner_catalog" || !product.partnerId) continue;
    const partner = partnersById.get(product.partnerId);
    const slug = partner?.slug ?? product.partnerId.replace(/^partner-/, "");
    const productSlug = product.productId.startsWith(`prod-${slug}-`)
      ? product.productId.slice(`prod-${slug}-`.length)
      : null;
    if (!productSlug || !variant.variantId.startsWith(`var-${slug}-${productSlug}-`)) {
      issues.push(issue(
        "VARIANT_NAMESPACE_MISMATCH",
        `Variant ${variant.variantId} is not in Product ${product.productId} namespace.`,
      ));
    }
    const asset = catalog.assets.find((item) => item.assetId === variant.assetId) ?? null;
    if (!variant.assetId) {
      issues.push(issue("VARIANT_ASSET_MISMATCH", `Partner Variant ${variant.variantId} has no current Asset.`));
    } else if (!asset || !isStageAssetReady(asset)) {
      issues.push(issue(
        "VARIANT_ASSET_UNREADY",
        `Partner Variant ${variant.variantId} Asset ${variant.assetId} is not ready.`,
      ));
    } else if (!GENERATED_FURNITURE_ASSETS.some((item) => item.assetId === variant.assetId)) {
      issues.push(issue(
        "VARIANT_ASSET_RUNTIME_MISSING",
        `Partner Variant ${variant.variantId} Asset ${variant.assetId} is missing from runtime.`,
      ));
    } else if (furnitureAssetDefinition(variant.assetId) == null) {
      issues.push(issue(
        "VARIANT_ASSET_RUNTIME_MISSING",
        `Partner Variant ${variant.variantId} Asset ${variant.assetId} is unknown to furnitureAssetDefinition.`,
      ));
    }
  }

  for (const collection of catalog.collections) {
    if (collection.owner === "partner") {
      if (!collection.partnerId) {
        issues.push(issue(
          "MISSING_PARTNER_ID",
          `Partner Collection ${collection.collectionId} requires partnerId.`,
        ));
      } else {
        const partner = partnersById.get(collection.partnerId);
        const slug = partner?.slug ?? collection.partnerId.replace(/^partner-/, "");
        if (!collection.collectionId.startsWith(`col-${slug}-`)) {
          issues.push(issue(
            "COLLECTION_NAMESPACE_MISMATCH",
            `Collection ${collection.collectionId} is not in Partner ${slug} namespace.`,
          ));
        }
        if (partner && collection.partnerName !== partner.name) {
          issues.push(issue(
            "PARTNER_NAME_MISMATCH",
            `Collection ${collection.collectionId} partnerName drifted from Partner name.`,
          ));
        }
      }
    } else if (collection.partnerId) {
      issues.push(issue(
        "UNEXPECTED_PARTNER_ID",
        `Vibode Collection ${collection.collectionId} must not have partnerId.`,
      ));
    }
    for (const productId of collection.productIds) {
      const product = catalog.products.find((item) => item.productId === productId);
      if (!product) continue;
      if (collection.owner === "partner") {
        if (product.source !== "partner_catalog" || product.partnerId !== collection.partnerId) {
          issues.push(issue(
            "COLLECTION_OWNER_MISMATCH",
            `Collection ${collection.collectionId} membership ${productId} is not same-partner.`,
          ));
        }
      } else if (product.source === "partner_catalog" || product.partnerId) {
        issues.push(issue(
          "COLLECTION_OWNER_MISMATCH",
          `Vibode Collection ${collection.collectionId} cannot include partner Product ${productId}.`,
        ));
      }
    }
  }

  const skusByScope = new Map<string, string[]>();
  for (const variant of catalog.variants) {
    if (!variant.sku) continue;
    const owner = skuOwnerForVariant(variant, catalog);
    if (!owner) continue;
    const key = skuScopeKey(owner);
    const list = skusByScope.get(key) ?? [];
    if (list.includes(variant.sku) && owner.source === "partner_catalog") {
      issues.push(issue("DUPLICATE_SKU", `Duplicate SKU ${variant.sku} within partner scope ${key}.`));
    }
    list.push(variant.sku);
    skusByScope.set(key, list);
  }

  for (const product of GENERATED_REGISTERED_PRODUCTS) {
    if (product.source === "partner_catalog" || product.partnerId) {
      issues.push(issue(
        "PARTNER_PRODUCT_IN_CURATED_SEED",
        `Curated commercial seed contains partner Product ${product.productId}.`,
      ));
    }
  }

  for (const row of GENERATED_VARIANT_CURRENT_ASSETS) {
    const product = catalog.products.find((item) => item.productId === row.productId);
    if (product?.source === "partner_catalog") {
      issues.push(issue(
        "PARTNER_VARIANT_IN_ASSOCIATION_MAP",
        `Association map contains partner Variant ${row.variantId}.`,
      ));
    }
  }

  const documents = [...PARTNER_CATALOG_DOCUMENTS];
  if (
    input.partnerJsonRelativePath
    && !documents.some((item) => item.jsonRelativePath === input.partnerJsonRelativePath)
  ) {
    documents.push({
      batchId: input.partnerJsonRelativePath,
      jsonRelativePath: input.partnerJsonRelativePath,
      sqlSlug: path.basename(input.partnerJsonRelativePath, ".json")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase(),
    });
  }

  const files = listPartnerCatalogMigrations(repoRoot);
  const mappedSql = new Set<string>();
  const unionJsonProductIds = new Set<string>();
  const unionJsonVariantIds = new Set<string>();
  const unionJsonPartnerIds = new Set<string>();
  const unionJsonCollectionIds = new Set<string>();
  const unionSqlProductIds = new Set<string>();
  const unionSqlVariantIds = new Set<string>();
  const unionSqlPartnerIds = new Set<string>();
  const unionSqlCollectionIds = new Set<string>();
  const seenPartners = new Set<string>();

  if (files.length === 0) {
    issues.push(issue("PARTNER_SQL_MISSING", "Missing partner catalog SQL migration."));
  }

  for (const fileName of files) {
    if (isVariantAssociationMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_LOOKS_LIKE_ASSOCIATION_MIGRATION",
        `${fileName} is classified as a PI-5D2B association migration.`,
      ));
    }
    if (isProductRegistrationMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_LOOKS_LIKE_PRODUCT_REGISTRATION",
        `${fileName} is classified as a PI-5E1 Product registration migration.`,
      ));
    }
    if (isVariantRegistrationMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_LOOKS_LIKE_VARIANT_REGISTRATION",
        `${fileName} is classified as a PI-5E2 Variant registration migration.`,
      ));
    }
    if (!isPartnerCatalogMigrationFileName(fileName)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is not a partner catalog migration.`));
    }
    const sql = readFileSync(path.join(paths.migrationsDir, fileName), "utf8");
    const parsedSql = parsePartnerCatalogSql(sql);
    if (parsedSql.mutatesAssets) {
      issues.push(issue("SQL_TOUCHES_ASSETS", `${fileName} mutates vibode_stage_assets.`));
    }
    if (parsedSql.updatesProduct) {
      issues.push(issue("SQL_UPDATES_PRODUCT", `${fileName} updates Products.`));
    }
    if (parsedSql.updatesVariant) {
      issues.push(issue("SQL_UPDATES_VARIANT", `${fileName} updates Variants.`));
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
    if (parsedSql.forbiddenTables.length > 0) {
      issues.push(issue(
        "SQL_FORBIDDEN_PARTNER_TABLE",
        `${fileName} references ${parsedSql.forbiddenTables.join(", ")}.`,
      ));
    }
    for (const productId of parsedSql.productIds) unionSqlProductIds.add(productId);
    for (const variantId of parsedSql.variantIds) unionSqlVariantIds.add(variantId);
    for (const partnerId of parsedSql.partnerIds) unionSqlPartnerIds.add(partnerId);
    for (const collectionId of parsedSql.collectionIds) unionSqlCollectionIds.add(collectionId);
  }

  for (const documentReg of documents) {
    const jsonPath = path.join(repoRoot, documentReg.jsonRelativePath);
    if (!existsSync(jsonPath)) {
      issues.push(issue(
        "PARTNER_JSON_MISSING",
        `Missing partner catalog JSON at ${documentReg.jsonRelativePath}.`,
      ));
      continue;
    }
    let parsedJson: ReturnType<typeof parsePartnerCatalogJson>;
    try {
      parsedJson = parsePartnerCatalogJson(JSON.parse(readFileSync(jsonPath, "utf8")));
    } catch (error) {
      issues.push(issue(
        "INVALID_JSON",
        error instanceof Error ? error.message : `Partner catalog JSON is malformed: ${documentReg.jsonRelativePath}.`,
      ));
      continue;
    }
    if (!parsedJson.ok) {
      for (const item of parsedJson.errors) {
        issues.push(issue(item.code, `${documentReg.jsonRelativePath}: ${item.message}`));
      }
      continue;
    }

    const jsonProductIds = parsedJson.document.products.map((item) => item.product.productId);
    const jsonVariantIds = parsedJson.document.products.flatMap((item) => [
      item.defaultVariant.variantId,
      ...item.variants.map((variant) => variant.variantId),
    ]);
    const jsonCollectionIds = parsedJson.document.collections.map((item) => item.collectionId);
    const jsonCollectionRefs = [
      ...jsonCollectionIds,
      ...parsedJson.document.products.flatMap((item) => item.product.collectionIds),
    ];
    for (const productId of jsonProductIds) unionJsonProductIds.add(productId);
    for (const variantId of jsonVariantIds) unionJsonVariantIds.add(variantId);
    unionJsonPartnerIds.add(parsedJson.document.partner.partnerId);
    for (const collectionId of jsonCollectionRefs) unionJsonCollectionIds.add(collectionId);

    const matches = files.filter((fileName) => (
      isPartnerCatalogSqlForSlug(fileName, documentReg.sqlSlug)
    ));
    if (matches.length === 0) {
      issues.push(issue(
        "PARTNER_SQL_MISSING",
        `Missing partner catalog SQL for batch ${documentReg.batchId}.`,
      ));
      continue;
    }
    if (matches.length > 1) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `Multiple partner catalog SQL files map to batch ${documentReg.batchId}.`,
      ));
    }
    const fileName = matches[0]!;
    mappedSql.add(fileName);
    const sql = readFileSync(path.join(paths.migrationsDir, fileName), "utf8");
    const parsedSql = parsePartnerCatalogSql(sql);
    const firstForPartner = !seenPartners.has(parsedJson.document.partner.partnerId);
    seenPartners.add(parsedJson.document.partner.partnerId);

    for (const productId of jsonProductIds) {
      if (!parsedSql.productIds.includes(productId)) {
        issues.push(issue("SQL_JSON_MISMATCH", `${fileName} is missing Product ${productId} from JSON.`));
      }
    }
    for (const productId of parsedSql.productIds) {
      if (!jsonProductIds.includes(productId)) {
        issues.push(issue("SQL_JSON_MISMATCH", `${fileName} has Product ${productId} not in JSON.`));
      }
    }
    for (const variantId of jsonVariantIds) {
      if (!parsedSql.variantIds.includes(variantId)) {
        issues.push(issue("SQL_JSON_MISMATCH", `${fileName} is missing Variant ${variantId} from JSON.`));
      }
    }
    for (const variantId of parsedSql.variantIds) {
      if (!jsonVariantIds.includes(variantId)) {
        issues.push(issue("SQL_JSON_MISMATCH", `${fileName} has Variant ${variantId} not in JSON.`));
      }
    }
    for (const collectionId of jsonCollectionIds) {
      if (!parsedSql.collectionIds.includes(collectionId)) {
        issues.push(issue("SQL_JSON_MISMATCH", `${fileName} is missing Collection ${collectionId} from JSON.`));
      }
    }
    if (!parsedSql.partnerIds.includes(parsedJson.document.partner.partnerId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `${fileName} Partner ID differs from JSON.`));
    }
    if (firstForPartner && !parsedSql.insertsPartner) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing Partner insert for the first batch.`));
    }
    if (!firstForPartner && parsedSql.insertsPartner) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} re-inserts an existing Partner.`));
    }
    if (jsonCollectionIds.length > 0 && !parsedSql.insertsCollection) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing Collection inserts from JSON.`));
    }
    if (jsonCollectionIds.length === 0 && parsedSql.insertsCollection) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} inserts Collections not declared in JSON.`));
    }
    if (!parsedSql.insertsProduct) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing Product inserts.`));
    }
    if (!parsedSql.insertsVariant) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing Variant inserts.`));
    }
    const hasMemberships = parsedJson.document.products.some((item) => (
      item.product.collectionIds.length > 0
    ));
    if (hasMemberships && !parsedSql.insertsMembership) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing membership inserts.`));
    }
  }

  for (const fileName of files) {
    if (!mappedSql.has(fileName)) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} is not mapped to a registered partner catalog document.`,
      ));
    }
  }

  for (const productId of unionJsonProductIds) {
    if (!unionSqlProductIds.has(productId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `Union of partner catalog SQL is missing Product ${productId}.`));
    }
  }
  for (const productId of unionSqlProductIds) {
    if (!unionJsonProductIds.has(productId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `Union of partner catalog JSON is missing Product ${productId}.`));
    }
  }
  for (const variantId of unionJsonVariantIds) {
    if (!unionSqlVariantIds.has(variantId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `Union of partner catalog SQL is missing Variant ${variantId}.`));
    }
  }
  for (const variantId of unionSqlVariantIds) {
    if (!unionJsonVariantIds.has(variantId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `Union of partner catalog JSON is missing Variant ${variantId}.`));
    }
  }
  for (const partnerId of unionJsonPartnerIds) {
    if (!unionSqlPartnerIds.has(partnerId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `Union of partner catalog SQL is missing Partner ${partnerId}.`));
    }
  }
  for (const collectionId of unionJsonCollectionIds) {
    if (!unionSqlCollectionIds.has(collectionId)) {
      issues.push(issue("SQL_JSON_MISMATCH", `Union of partner catalog SQL is missing Collection ${collectionId}.`));
    }
  }

  return issues;
}

export function existingStateFromCatalog(catalog: StageCatalogSnapshot): ExistingPartnerCatalogState {
  const skusByPartnerId: Record<string, string[]> = {};
  for (const variant of catalog.variants) {
    const product = catalog.products.find((item) => item.productId === variant.productId);
    if (!product?.partnerId || !variant.sku) continue;
    const list = skusByPartnerId[product.partnerId] ?? [];
    if (!list.includes(variant.sku)) list.push(variant.sku);
    skusByPartnerId[product.partnerId] = list;
  }
  return {
    partners: catalog.partners,
    productIds: catalog.products
      .filter((product) => product.source === "partner_catalog")
      .map((product) => product.productId),
    variantIds: catalog.variants
      .filter((variant) => catalog.products.some((product) => (
        product.productId === variant.productId && product.source === "partner_catalog"
      )))
      .map((variant) => variant.variantId),
    collectionIds: catalog.collections
      .filter((collection) => collection.owner === "partner")
      .map((collection) => collection.collectionId),
    skusByPartnerId,
  };
}
