/**
 * PI-5E1 commercial Product/Variant registration drift detection.
 *
 * Node-only. Separate from Asset drift and Variant-retarget drift.
 * The viewer does not import this module.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";

import {
  isStageAssetReady,
  STAGE_BROWSE_CATEGORIES,
  STAGE_CERTIFIED_SEED_PRODUCTS,
  STAGE_SEED_CATALOG,
} from "./catalog";
import {
  GENERATED_REGISTERED_PRODUCTS,
  GENERATED_REGISTERED_VARIANTS,
} from "./catalog-commercial.generated";
import {
  COMMERCIAL_SEED_RELATIVE_PATH,
  isProductRegistrationMigrationFileName,
  isVariantRegistrationMigrationFileName,
  listProductRegistrationMigrations,
  listVariantRegistrationMigrations,
  parseProductRegistrationSql,
  parseVariantRegistrationSql,
  productRegistrationRepoPaths,
  publicFilePathFromImageUrl,
  renderGeneratedCommercialSeed,
  type ProductVariantIssue,
} from "./product-variant-register";
import type { StageCatalogSnapshot } from "./types";
import { isVariantAssociationMigrationFileName } from "./variant-asset-association";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

function issue(code: string, message: string): ProductVariantIssue {
  return { code, message };
}

function categoryExists(categoryId: string, subcategoryId: string | null): boolean {
  const category = STAGE_BROWSE_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return false;
  if (subcategoryId == null) return true;
  return category.subcategories.some((item) => item.id === subcategoryId);
}

export function detectProductVariantRegistrationDrift(input: Readonly<{
  repoRoot?: string;
  catalog?: StageCatalogSnapshot;
}> = {}): ProductVariantIssue[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const catalog = input.catalog ?? STAGE_SEED_CATALOG;
  const issues: ProductVariantIssue[] = [];
  const paths = productRegistrationRepoPaths(repoRoot);

  const productIds = new Map<string, number>();
  const variantIds = new Map<string, number>();
  const skus = new Map<string, number>();

  for (const product of catalog.products) {
    productIds.set(product.productId, (productIds.get(product.productId) ?? 0) + 1);
    if (!categoryExists(product.categoryId, product.subcategoryId)) {
      issues.push(issue(
        "UNKNOWN_CATEGORY",
        `Product ${product.productId} has unknown category/subcategory.`,
      ));
    }
    const defaultVariant = catalog.variants.find((variant) => (
      variant.variantId === product.defaultVariantId
    ));
    if (!defaultVariant) {
      issues.push(issue(
        "DEFAULT_VARIANT_MISMATCH",
        `Product ${product.productId} default Variant ${product.defaultVariantId} is missing.`,
      ));
    } else {
      if (defaultVariant.productId !== product.productId) {
        issues.push(issue(
          "DEFAULT_VARIANT_MISMATCH",
          `Product ${product.productId} default Variant belongs to ${defaultVariant.productId}.`,
        ));
      }
      if (defaultVariant.priceAmount !== product.priceAmount) {
        issues.push(issue(
          "PRICE_MISMATCH",
          `Product ${product.productId} price does not match its default Variant.`,
        ));
      }
      if (defaultVariant.priceCurrency !== product.priceCurrency) {
        issues.push(issue(
          "CURRENCY_MISMATCH",
          `Product ${product.productId} currency does not match its default Variant.`,
        ));
      }
    }
    for (const collectionId of product.collectionIds) {
      const collection = catalog.collections.find((item) => item.collectionId === collectionId);
      if (!collection || !collection.productIds.includes(product.productId)) {
        issues.push(issue(
          "COLLECTION_MEMBERSHIP_MISMATCH",
          `Product ${product.productId} is missing from Collection ${collectionId}.`,
        ));
      }
    }
    if (product.source === "vibode_curated") {
      if (!existsSync(publicFilePathFromImageUrl(repoRoot, product.imageUrl))) {
        issues.push(issue(
          "MISSING_IMAGE",
          `Local image missing for ${product.productId}: ${product.imageUrl}.`,
        ));
      }
    }
  }

  for (const collection of catalog.collections) {
    for (const productId of collection.productIds) {
      const product = catalog.products.find((item) => item.productId === productId);
      if (!product || !product.collectionIds.includes(collection.collectionId)) {
        issues.push(issue(
          "COLLECTION_MEMBERSHIP_MISMATCH",
          `Collection ${collection.collectionId} lists ${productId} without matching membership.`,
        ));
      }
    }
  }

  for (const variant of catalog.variants) {
    variantIds.set(variant.variantId, (variantIds.get(variant.variantId) ?? 0) + 1);
    if (variant.sku) {
      skus.set(variant.sku, (skus.get(variant.sku) ?? 0) + 1);
    }
    const association = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
      row.variantId === variant.variantId
    ));
    if (!association) {
      issues.push(issue(
        "VARIANT_ASSET_MISMATCH",
        `Variant ${variant.variantId} is missing a current Asset association.`,
      ));
    } else if (association.currentAssetId !== variant.assetId || association.productId !== variant.productId) {
      issues.push(issue(
        "VARIANT_ASSET_MISMATCH",
        `Variant ${variant.variantId} Asset/Product does not match the association map.`,
      ));
    }
    const asset = catalog.assets.find((item) => item.assetId === variant.assetId) ?? null;
    if (!variant.assetId) {
      issues.push(issue("VARIANT_ASSET_MISMATCH", `Variant ${variant.variantId} has no current Asset.`));
    } else if (!asset) {
      issues.push(issue("VARIANT_ASSET_UNKNOWN", `Variant ${variant.variantId} Asset ${variant.assetId} is unknown.`));
    } else if (!isStageAssetReady(asset)) {
      issues.push(issue("VARIANT_ASSET_UNREADY", `Variant ${variant.variantId} Asset ${variant.assetId} is not ready.`));
    }
    if (variant.assetId && !GENERATED_FURNITURE_ASSETS.some((item) => item.assetId === variant.assetId)) {
      issues.push(issue(
        "VARIANT_ASSET_RUNTIME_MISSING",
        `Variant ${variant.variantId} Asset ${variant.assetId} is missing from runtime.`,
      ));
    }
    if (variant.assetId && furnitureAssetDefinition(variant.assetId) == null) {
      issues.push(issue(
        "VARIANT_ASSET_RUNTIME_MISSING",
        `Variant ${variant.variantId} Asset ${variant.assetId} is unknown to furnitureAssetDefinition.`,
      ));
    }
  }

  for (const [productId, count] of productIds) {
    if (count > 1) {
      issues.push(issue("DUPLICATE_PRODUCT_ID", `Duplicate Product ID ${productId}.`));
    }
  }
  for (const [variantId, count] of variantIds) {
    if (count > 1) {
      issues.push(issue("DUPLICATE_VARIANT_ID", `Duplicate Variant ID ${variantId}.`));
    }
  }
  for (const [sku, count] of skus) {
    if (count > 1) {
      issues.push(issue("DUPLICATE_SKU", `Duplicate non-null SKU ${sku}.`));
    }
  }

  for (const product of GENERATED_REGISTERED_PRODUCTS) {
    if (!catalog.products.some((item) => item.productId === product.productId)) {
      issues.push(issue(
        "REGISTERED_PRODUCT_MISSING_SEED",
        `Registered Product ${product.productId} is missing from the seed catalog.`,
      ));
    } else {
      const seed = catalog.products.find((item) => item.productId === product.productId)!;
      if (seed.imageUrl !== product.imageUrl) {
        issues.push(issue(
          "IMAGE_URL_MISMATCH",
          `Registered Product ${product.productId} image URL drifted from seed.`,
        ));
      }
      if (seed.defaultVariantId !== product.defaultVariantId) {
        issues.push(issue(
          "DEFAULT_VARIANT_MISMATCH",
          `Registered Product ${product.productId} default Variant drifted from seed.`,
        ));
      }
    }
  }
  for (const variant of GENERATED_REGISTERED_VARIANTS) {
    if (!catalog.variants.some((item) => item.variantId === variant.variantId)) {
      issues.push(issue(
        "REGISTERED_VARIANT_MISSING_SEED",
        `Registered Variant ${variant.variantId} is missing from the seed catalog.`,
      ));
    }
  }

  if (existsSync(paths.commercialSeed)) {
    const onDisk = readFileSync(paths.commercialSeed, "utf8");
    const expected = renderGeneratedCommercialSeed({
      products: GENERATED_REGISTERED_PRODUCTS,
      variants: GENERATED_REGISTERED_VARIANTS,
    });
    if (onDisk !== expected) {
      issues.push(issue(
        "COMMERCIAL_SEED_DRIFT",
        "Generated commercial seed is not renderer-identical.",
      ));
    }
  } else {
    issues.push(issue(
      "COMMERCIAL_SEED_DRIFT",
      `Missing generated commercial seed at ${COMMERCIAL_SEED_RELATIVE_PATH}.`,
    ));
  }

  const certifiedIds = new Set(STAGE_CERTIFIED_SEED_PRODUCTS.map((item) => item.productId));
  for (const fileName of listProductRegistrationMigrations(repoRoot)) {
    if (isVariantAssociationMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_LOOKS_LIKE_ASSOCIATION_MIGRATION",
        `${fileName} is classified as a PI-5D2B association migration.`,
      ));
    }
    const sql = readFileSync(path.join(paths.migrationsDir, fileName), "utf8");
    const parsed = parseProductRegistrationSql(sql);
    if (parsed.mutatesAssets) {
      issues.push(issue("SQL_TOUCHES_ASSETS", `${fileName} mutates vibode_stage_assets.`));
    }
    if (parsed.touchesObjectsJson) {
      issues.push(issue("SQL_TOUCHES_OBJECTS_JSON", `${fileName} mentions objects_json.`));
    }
    if (parsed.touchesScenes) {
      issues.push(issue("SQL_TOUCHES_SCENE_OBJECTS", `${fileName} mentions vibode_3d_scenes.`));
    }
    if (parsed.retargetsVariant) {
      issues.push(issue("SQL_RETARGETS_VARIANT", `${fileName} retargets an existing Variant.`));
    }
    const productId = parsed.productIds[0] ?? null;
    const variantId = parsed.variantIds[0] ?? null;
    const assetId = parsed.assetIds[0] ?? null;
    if (!productId || !variantId || !assetId) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing Product/Variant/Asset identity.`));
      continue;
    }
    if (certifiedIds.has(productId)) {
      issues.push(issue(
        "SQL_RETARGETS_VARIANT",
        `${fileName} targets a certified Product rather than a new registration.`,
      ));
    }
    const seedProduct = catalog.products.find((item) => item.productId === productId);
    const seedVariant = catalog.variants.find((item) => item.variantId === variantId);
    if (!seedProduct || !seedVariant) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} Product/Variant IDs differ from seed.`,
      ));
      continue;
    }
    if (seedProduct.defaultVariantId !== variantId || seedVariant.productId !== productId) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} Product/Variant pairing differs from seed.`,
      ));
    }
    if (seedVariant.assetId !== assetId) {
      issues.push(issue(
        "SQL_ASSET_MISMATCH",
        `${fileName} Asset ${assetId} differs from seed ${seedVariant.assetId}.`,
      ));
    }
    if (!sql.includes(seedProduct.imageUrl)) {
      issues.push(issue(
        "IMAGE_URL_MISMATCH",
        `${fileName} image URL differs from seed.`,
      ));
    }
    for (const collectionId of seedProduct.collectionIds) {
      if (!sql.includes(collectionId)) {
        issues.push(issue(
          "COLLECTION_MEMBERSHIP_MISMATCH",
          `${fileName} is missing Collection ${collectionId}.`,
        ));
      }
    }
    if (!/status = 'ready'/.test(sql)) {
      issues.push(issue("SQL_ASSET_NOT_READY", `${fileName} does not require a ready Asset.`));
    }
  }

  for (const fileName of listProductRegistrationMigrations(repoRoot)) {
    if (!isProductRegistrationMigrationFileName(fileName)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is not a Product registration migration.`));
    }
  }

  const generatedDefaultVariantIds = new Set(
    GENERATED_REGISTERED_PRODUCTS.map((product) => product.defaultVariantId),
  );
  const additionalGeneratedVariants = GENERATED_REGISTERED_VARIANTS.filter((variant) => (
    !generatedDefaultVariantIds.has(variant.variantId)
  ));
  const registerVariantFiles = listVariantRegistrationMigrations(repoRoot);
  const registerVariantByVariantId = new Map<string, string>();

  for (const fileName of registerVariantFiles) {
    if (isVariantAssociationMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_LOOKS_LIKE_ASSOCIATION_MIGRATION",
        `${fileName} is classified as a PI-5D2B association migration.`,
      ));
    }
    if (isProductRegistrationMigrationFileName(fileName)) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} is classified as a Product registration migration.`,
      ));
    }
    if (!isVariantRegistrationMigrationFileName(fileName)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is not a Variant registration migration.`));
    }
    const sql = readFileSync(path.join(paths.migrationsDir, fileName), "utf8");
    const parsed = parseVariantRegistrationSql(sql);
    if (!parsed.insertsVariant) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} does not insert a Variant.`));
    }
    if (parsed.insertsProduct || parsed.updatesProduct || parsed.mentionsDefaultVariant) {
      issues.push(issue("SQL_MUTATES_PRODUCT", `${fileName} mutates Product rows or default_variant_id.`));
    }
    if (parsed.updatesVariant) {
      issues.push(issue("SQL_UPDATES_VARIANT", `${fileName} updates an existing Variant.`));
    }
    if (parsed.mutatesAssets) {
      issues.push(issue("SQL_TOUCHES_ASSETS", `${fileName} mutates vibode_stage_assets.`));
    }
    if (parsed.touchesCollections) {
      issues.push(issue("SQL_TOUCHES_COLLECTIONS", `${fileName} mentions Collections.`));
    }
    if (parsed.touchesObjectsJson) {
      issues.push(issue("SQL_TOUCHES_OBJECTS_JSON", `${fileName} mentions objects_json.`));
    }
    if (parsed.touchesScenes) {
      issues.push(issue("SQL_TOUCHES_SCENE_OBJECTS", `${fileName} mentions vibode_3d_scenes.`));
    }
    const productId = parsed.productIds[0] ?? null;
    const variantId = parsed.variantIds[0] ?? null;
    const assetId = parsed.assetIds[0] ?? null;
    if (!productId || !variantId || !assetId) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} is missing Product/Variant/Asset identity.`));
      continue;
    }
    registerVariantByVariantId.set(variantId, fileName);
    const seedProduct = catalog.products.find((item) => item.productId === productId);
    const seedVariant = catalog.variants.find((item) => item.variantId === variantId);
    const generatedVariant = GENERATED_REGISTERED_VARIANTS.find((item) => (
      item.variantId === variantId
    ));
    if (!seedProduct || !seedVariant || !generatedVariant) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} Product/Variant IDs differ from generated seed.`,
      ));
      continue;
    }
    if (seedProduct.defaultVariantId === variantId) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} targets the Product default Variant rather than an additional Variant.`,
      ));
    }
    if (seedProduct.defaultVariantId !== GENERATED_REGISTERED_PRODUCTS.find((item) => (
      item.productId === productId
    ))?.defaultVariantId) {
      issues.push(issue(
        "DEFAULT_VARIANT_MISMATCH",
        `${fileName} Product default Variant drifted.`,
      ));
    }
    if (seedVariant.productId !== productId || generatedVariant.productId !== productId) {
      issues.push(issue(
        "SQL_IDENTITY_MISMATCH",
        `${fileName} Variant does not belong to Product ${productId}.`,
      ));
    }
    const association = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
      row.variantId === variantId
    ));
    if (!association || association.currentAssetId !== assetId || seedVariant.assetId !== assetId) {
      issues.push(issue(
        "SQL_ASSET_MISMATCH",
        `${fileName} Asset ${assetId} differs from association map/seed.`,
      ));
    }
    if (generatedVariant.finishLabel && !sql.includes(generatedVariant.finishLabel)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} finish label differs from seed.`));
    }
    if (generatedVariant.sku && !sql.includes(generatedVariant.sku)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} SKU differs from seed.`));
    }
    if (
      generatedVariant.priceAmount != null &&
      !sql.includes(String(generatedVariant.priceAmount))
    ) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} price differs from seed.`));
    }
    if (!sql.includes(generatedVariant.priceCurrency)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} currency differs from seed.`));
    }
    if (generatedVariant.productUrl && !sql.includes(generatedVariant.productUrl)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} product URL differs from seed.`));
    }
    if (!/status = 'ready'/.test(sql)) {
      issues.push(issue("SQL_ASSET_NOT_READY", `${fileName} does not require a ready Asset.`));
    }
    if (!/status = 'active'/.test(sql)) {
      issues.push(issue("SQL_IDENTITY_MISMATCH", `${fileName} does not require an active Product.`));
    }
  }

  for (const variant of additionalGeneratedVariants) {
    if (!registerVariantByVariantId.has(variant.variantId)) {
      issues.push(issue(
        "REGISTERED_VARIANT_MISSING_SQL",
        `Additional Variant ${variant.variantId} is missing a register_variant migration.`,
      ));
    }
  }

  return issues;
}
