import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { detectFurnitureAssetDrift } from "@/lib/afc-v2-runtime/furniture-asset-drift";
import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { PI5D2_SIDE_TABLE_ASSET_ID } from "@/lib/afc-v2-runtime/pi5d2-side-table-geometry";
import { addSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
} from "@/lib/afc-v2-runtime/types";

import {
  createStageCatalogSnapshot,
  fallbackProductIdForAsset,
  favoriteKey,
  resolveStagePlacement,
  STAGE_CERTIFIED_SEED_COLLECTIONS,
  STAGE_CERTIFIED_SEED_PRODUCTS,
  STAGE_CERTIFIED_SEED_VARIANTS,
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
  STAGE_SEED_PRODUCTS,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_VARIANT_ID,
  STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
  STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import { GENERATED_REGISTERED_PRODUCTS, GENERATED_REGISTERED_VARIANTS } from "./catalog-commercial.generated";
import { toggleFavoriteKeys } from "./favorites";
import { detectProductVariantRegistrationDrift } from "./product-variant-drift";
import {
  COMMERCIAL_SEED_RELATIVE_PATH,
  isProductRegistrationMigrationFileName,
  listProductRegistrationMigrations,
  parseProductRegistrationJson,
  parseProductRegistrationSql,
  productRegistrationMigrationFileName,
  registerProductVariant,
  renderGeneratedCommercialSeed,
  renderProductVariantInsertSql,
  validateProductVariantRegistration,
  type ProductVariantRegistrationInput,
} from "./product-variant-register";
import { buildStageSummary } from "./summary";
import {
  detectVariantAssetAssociationDrift,
  isVariantAssociationMigrationFileName,
  listVariantAssociationMigrations,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
} from "./variant-asset-association";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

const ROOT = process.cwd();
const PROOF_JSON = "lib/vibode-stage/studio-side-table.product.json";
const PRODUCT_SQL =
  "supabase/migrations/20260915010000_vibode_stage_product_studio_side_table.sql";
const SETTEE_SQL =
  "supabase/migrations/20260914230000_vibode_stage_variant_studio_settee_default.sql";
const ASSET_C_SQL =
  "supabase/migrations/20260914220000_vibode_stage_asset_pi5d2_side_table.sql";
const ASSET_A = AFC_V2_RUNTIME_FURNITURE_ASSET_ID;
const ASSET_B = AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID;
const ASSET_C = PI5D2_SIDE_TABLE_ASSET_ID;
const ASSET_C_SHA256 =
  "00e8614d15d8d6871fbe8a2db5cd4f245b7d9f760e60c7aecb7f3d4bbf6cc418";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function proofInput(): ProductVariantRegistrationInput {
  const parsed = parseProductRegistrationJson(JSON.parse(source(PROOF_JSON)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("proof JSON invalid");
  return parsed.input;
}

function certifiedCatalog() {
  return createStageCatalogSnapshot({
    authority: "seed_fixture",
    products: STAGE_CERTIFIED_SEED_PRODUCTS,
    variants: STAGE_CERTIFIED_SEED_VARIANTS,
    assets: STAGE_SEED_ASSETS,
    collections: STAGE_CERTIFIED_SEED_COLLECTIONS,
  });
}

function associationsWithoutSideTable() {
  return GENERATED_VARIANT_CURRENT_ASSETS.filter((row) => (
    row.variantId !== STAGE_STUDIO_SIDE_TABLE_VARIANT_ID
  ));
}

function isolatedGates(
  overrides: Parameters<typeof validateProductVariantRegistration>[1] = {},
) {
  return {
    catalog: certifiedCatalog(),
    currentAssociations: associationsWithoutSideTable(),
    currentGeneratedProducts: [],
    currentGeneratedVariants: [],
    manifestRepoRoot: ROOT,
    ...overrides,
  };
}

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5e1-product-"));
  mkdirSync(path.join(repoRoot, "lib/vibode-stage"), { recursive: true });
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  mkdirSync(path.join(repoRoot, "public/vibode-stage"), { recursive: true });
  copyFileSync(
    path.join(ROOT, "public/vibode-stage/studio-side-table.svg"),
    path.join(repoRoot, "public/vibode-stage/studio-side-table.svg"),
  );
  return repoRoot;
}

function runCli(args: string[], cwd = ROOT) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/vibode-product.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

function snapshotFrozenTree() {
  return {
    commercial: source(COMMERCIAL_SEED_RELATIVE_PATH),
    map: source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    productSql: source(PRODUCT_SQL),
    setteeSql: source(SETTEE_SQL),
    assetCSql: source(ASSET_C_SQL),
    image: source("public/vibode-stage/studio-side-table.svg"),
    manifest: source("lib/afc-v2-runtime/furniture-asset-manifest.json"),
    registry: source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
    viewer: source("components/afc-3d/AfcProductionRoomViewer.tsx"),
    crud: source("lib/afc-v2-runtime/scene-crud.ts"),
    persisted: source("lib/afc-v2-runtime/persisted-scene.ts"),
    migrations: readdirSync(path.join(ROOT, "supabase/migrations")).sort(),
  };
}

function catalogQuery(input: Partial<Parameters<typeof filterStageCatalogProducts>[0]> = {}) {
  return filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "browse",
    query: "",
    categoryId: "living-room",
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
    ...input,
  });
}

test("PI-5E1 valid Product JSON is accepted", () => {
  const parsed = parseProductRegistrationJson(JSON.parse(source(PROOF_JSON)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const accepted = validateProductVariantRegistration(parsed.input, isolatedGates());
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.parsed.product.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(accepted.parsed.variant.variantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.equal(accepted.parsed.assetId, ASSET_C);
  assert.equal(accepted.parsed.sortOrder, 3);
});

test("PI-5E1 unknown, unavailable, and runtime-missing Assets fail closed", () => {
  const before = snapshotFrozenTree();
  const unknown = validateProductVariantRegistration({
    ...proofInput(),
    defaultVariant: {
      ...proofInput().defaultVariant,
      currentAssetId: "afc-v2-runtime/test-fixtures/not-an-asset",
    },
  }, isolatedGates());
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.errors.some((error) => error.code === "UNKNOWN_ASSET"), true);

  const unavailable = validateProductVariantRegistration(proofInput(), isolatedGates({
    seedAssets: STAGE_SEED_ASSETS.map((asset) => (
      asset.assetId === ASSET_C ? { ...asset, status: "unavailable" } : asset
    )),
  }));
  assert.equal(unavailable.ok, false);
  if (unavailable.ok) return;
  assert.equal(unavailable.errors.some((error) => error.code === "UNAVAILABLE_ASSET"), true);

  const runtimeMissing = validateProductVariantRegistration(proofInput(), isolatedGates({
    runtimeAssetIds: [ASSET_A, ASSET_B],
  }));
  assert.equal(runtimeMissing.ok, false);
  if (runtimeMissing.ok) return;
  assert.equal(runtimeMissing.errors.some((error) => error.code === "RUNTIME_MISSING_ASSET"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E1 unknown category/subcategory and missing image fail closed", () => {
  const before = snapshotFrozenTree();
  const category = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, categoryId: "not-a-category" },
  }, isolatedGates());
  assert.equal(category.ok, false);
  if (category.ok) return;
  assert.equal(category.errors.some((error) => error.code === "UNKNOWN_CATEGORY"), true);

  const subcategory = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, subcategoryId: "not-a-subcategory" },
  }, isolatedGates());
  assert.equal(subcategory.ok, false);
  if (subcategory.ok) return;
  assert.equal(subcategory.errors.some((error) => error.code === "UNKNOWN_SUBCATEGORY"), true);

  const missingImage = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, imageUrl: "/vibode-stage/missing-side-table.svg" },
  }, isolatedGates());
  assert.equal(missingImage.ok, false);
  if (missingImage.ok) return;
  assert.equal(missingImage.errors.some((error) => error.code === "MISSING_IMAGE"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E1 invalid Product ID and duplicate Product/Variant/SKU fail closed", () => {
  const before = snapshotFrozenTree();
  const invalidId = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, productId: "not a valid id" },
  }, isolatedGates());
  assert.equal(invalidId.ok, false);
  if (invalidId.ok) return;
  assert.equal(invalidId.errors.some((error) => error.code === "INVALID_PRODUCT_ID"), true);

  const duplicateProduct = validateProductVariantRegistration(proofInput());
  assert.equal(duplicateProduct.ok, false);
  if (duplicateProduct.ok) return;
  assert.equal(duplicateProduct.errors.some((error) => error.code === "DUPLICATE_PRODUCT_ID"), true);

  const duplicateVariant = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, productId: "prod-vibode-other-table" },
  });
  assert.equal(duplicateVariant.ok, false);
  if (duplicateVariant.ok) return;
  assert.equal(duplicateVariant.errors.some((error) => error.code === "DUPLICATE_VARIANT_ID"), true);

  const duplicateSku = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, productId: "prod-vibode-other-table" },
    defaultVariant: {
      ...proofInput().defaultVariant,
      variantId: "var-vibode-other-table-default",
    },
  }, isolatedGates({
    catalog: STAGE_SEED_CATALOG,
    currentAssociations: GENERATED_VARIANT_CURRENT_ASSETS,
  }));
  assert.equal(duplicateSku.ok, false);
  if (duplicateSku.ok) return;
  assert.equal(duplicateSku.errors.some((error) => error.code === "DUPLICATE_SKU"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E1 SKU uniqueness is scoped so a partner SKU does not block curated registration", () => {
  const partnerProduct = {
    productId: "prod-other-furniture-co-item",
    brand: "Other Furniture Co.",
    name: "Other Item",
    retailer: "Other Furniture Co.",
    categoryId: "living-room",
    subcategoryId: "sofas",
    productUrl: "https://example.test/other-item",
    imageUrl: "https://example.test/other-item.jpg",
    priceAmount: 100,
    priceCurrency: "USD",
    defaultVariantId: "var-other-furniture-co-item-default",
    collectionIds: Object.freeze(["col-other-furniture-co-items"]),
    source: "partner_catalog" as const,
    partnerId: "partner-other-furniture-co",
  };
  const catalog = createStageCatalogSnapshot({
    authority: "seed_fixture",
    products: [...STAGE_CERTIFIED_SEED_PRODUCTS, partnerProduct],
    variants: [
      ...STAGE_CERTIFIED_SEED_VARIANTS,
      {
        variantId: "var-other-furniture-co-item-default",
        productId: partnerProduct.productId,
        assetId: ASSET_A,
        finishLabel: "Oak",
        sku: proofInput().defaultVariant.sku,
        priceAmount: 100,
        priceCurrency: "USD",
        productUrl: null,
      },
    ],
    assets: STAGE_SEED_ASSETS,
    collections: [
      ...STAGE_CERTIFIED_SEED_COLLECTIONS,
      {
        collectionId: "col-other-furniture-co-items",
        name: "Other Items",
        owner: "partner",
        partnerName: "Other Furniture Co.",
        partnerId: "partner-other-furniture-co",
        productIds: [partnerProduct.productId],
      },
    ],
    partners: [{
      partnerId: "partner-other-furniture-co",
      name: "Other Furniture Co.",
      slug: "other-furniture-co",
      status: "active",
      websiteUrl: "https://example.test",
      logoUrl: null,
    }],
  });
  const accepted = validateProductVariantRegistration(proofInput(), isolatedGates({ catalog }));
  assert.equal(accepted.ok, true);
});

test("PI-5E1 negative/non-finite price and Product/Variant price-currency mismatch fail", () => {
  const before = snapshotFrozenTree();
  const negative = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, priceAmount: -1 },
    defaultVariant: { ...proofInput().defaultVariant, priceAmount: -1 },
  }, isolatedGates());
  assert.equal(negative.ok, false);
  if (negative.ok) return;
  assert.equal(negative.errors.some((error) => error.code === "INVALID_PRICE"), true);

  const nonFinite = validateProductVariantRegistration({
    ...proofInput(),
    product: { ...proofInput().product, priceAmount: Number.POSITIVE_INFINITY },
    defaultVariant: { ...proofInput().defaultVariant, priceAmount: Number.POSITIVE_INFINITY },
  }, isolatedGates());
  assert.equal(nonFinite.ok, false);
  if (nonFinite.ok) return;
  assert.equal(nonFinite.errors.some((error) => error.code === "INVALID_PRICE"), true);

  const mismatch = validateProductVariantRegistration({
    ...proofInput(),
    defaultVariant: { ...proofInput().defaultVariant, priceAmount: 100, priceCurrency: "EUR" },
  }, isolatedGates());
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.errors.some((error) => error.code === "PRICE_CURRENCY_MISMATCH"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E1 --check writes nothing and successful registration generates seed/SQL/map", () => {
  const repoRoot = tmpRepo();
  const check = registerProductVariant({
    input: proofInput(),
    repoRoot,
    check: true,
    migrationTimestamp: "20990101000000",
    ...isolatedGates({ repoRoot }),
  });
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.written, null);
  assert.ok(check.plan);
  assert.equal(existsSync(check.plan.commercialSeed), false);
  assert.equal(existsSync(check.plan.generatedMap), false);
  assert.equal(existsSync(check.plan.migration), false);

  const written = registerProductVariant({
    input: proofInput(),
    repoRoot,
    migrationTimestamp: "20990101000000",
    ...isolatedGates({ repoRoot }),
  });
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.ok(written.written);
  assert.equal(existsSync(written.written.commercialSeed), true);
  assert.equal(existsSync(written.written.generatedMap), true);
  assert.equal(existsSync(written.written.migration), true);
  assert.equal(
    path.basename(written.written.migration),
    productRegistrationMigrationFileName("20990101000000", STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID),
  );
  const commercial = readFileSync(written.written.commercialSeed, "utf8");
  assert.match(commercial, /prod-vibode-studio-side-table/);
  assert.match(commercial, /Studio Side Table/);
  assert.doesNotMatch(commercial, /currentAssetId|pi5d2-side-table/);
  const map = readFileSync(written.written.generatedMap, "utf8");
  assert.match(map, /var-vibode-studio-side-table-default/);
  assert.match(map, /pi5d2-side-table/);
  assert.match(map, /var-vibode-studio-settee-default/);
  const sql = readFileSync(written.written.migration, "utf8");
  assert.equal(sql, written.plan?.sql);
  const validated = validateProductVariantRegistration(proofInput(), isolatedGates({ repoRoot }));
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(sql, renderProductVariantInsertSql(validated.parsed));
});

test("PI-5E1 live seed, association map, and SQL contain the Side Table → Asset C registration", () => {
  assert.equal(
    source(COMMERCIAL_SEED_RELATIVE_PATH),
    renderGeneratedCommercialSeed({
      products: GENERATED_REGISTERED_PRODUCTS,
      variants: GENERATED_REGISTERED_VARIANTS,
    }),
  );
  assert.equal(GENERATED_REGISTERED_PRODUCTS[0]?.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(GENERATED_REGISTERED_VARIANTS[0]?.variantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  const association = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
    row.variantId === STAGE_STUDIO_SIDE_TABLE_VARIANT_ID
  ));
  assert.equal(association?.currentAssetId, ASSET_C);
  assert.equal(association?.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  const settee = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
    row.variantId === STAGE_STUDIO_SETTEE_VARIANT_ID
  ));
  assert.equal(settee?.currentAssetId, ASSET_C);

  const sql = source(PRODUCT_SQL);
  assert.equal(isProductRegistrationMigrationFileName(path.basename(PRODUCT_SQL)), true);
  assert.equal(isVariantAssociationMigrationFileName(path.basename(PRODUCT_SQL)), false);
  assert.deepEqual(listProductRegistrationMigrations(ROOT), [
    "20260915010000_vibode_stage_product_studio_side_table.sql",
  ]);
  assert.deepEqual(listVariantAssociationMigrations(ROOT), [
    "20260914230000_vibode_stage_variant_studio_settee_default.sql",
  ]);
  assert.match(sql, /prod-vibode-studio-side-table/);
  assert.match(sql, /var-vibode-studio-side-table-default/);
  assert.match(sql, /afc-v2-runtime\/test-fixtures\/pi5d2-side-table/);
  assert.match(sql, /status = 'ready'/);
  assert.match(sql, /col-vibode-picks/);
  assert.match(sql, /sort_order[\s\S]*3/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.vibode_stage_assets/i);
  assert.doesNotMatch(sql, /update\s+public\.vibode_stage_assets/i);
  assert.doesNotMatch(sql, /objects_json/);
  assert.doesNotMatch(sql, /vibode_3d_scenes/);
  assert.doesNotMatch(sql, /update\s+public\.vibode_stage_variants/i);
  const parsed = parseProductRegistrationSql(sql);
  assert.deepEqual([...parsed.productIds], [STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID]);
  assert.deepEqual([...parsed.variantIds], [STAGE_STUDIO_SIDE_TABLE_VARIANT_ID]);
  assert.equal(parsed.assetIds.includes(ASSET_C), true);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.touchesObjectsJson, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.retargetsVariant, false);
});

test("PI-5E1 Add persists Product+Variant+Asset C with uniformScale 1 and Summary resolves commercially", () => {
  const placement = resolveStagePlacement({
    productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.ok(placement);
  assert.equal(placement?.assetId, ASSET_C);
  assert.equal(placement?.product.name, "Studio Side Table");
  assert.equal(placement?.variant.finishLabel, "Natural oak");
  const added = addSceneObject({
    objects: [],
    assetId: placement!.assetId,
    identity: {
      productId: placement!.product.productId,
      variantId: placement!.variant.variantId,
    },
    createObjectId: () => "so-side-table-c",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(added.object.variantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.equal(added.object.assetId, ASSET_C);
  assert.equal(added.object.transform.uniformScale, 1);
  assert.equal(fallbackProductIdForAsset(ASSET_C), null);

  const summary = buildStageSummary({
    catalog: STAGE_SEED_CATALOG,
    objects: [added.object],
  });
  assert.equal(summary.lines.length, 1);
  assert.equal(summary.lines[0]?.name, "Studio Side Table");
  assert.equal(summary.lines[0]?.variantLabel, "Natural oak");
  assert.equal(summary.lines[0]?.unitPrice, 495);
  assert.equal(summary.lines[0]?.currency, "USD");
  assert.equal(summary.lines[0]?.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(summary.shoppable, false);
});

test("PI-5E1 Favorites, Recent, search, and subcategory filters are data-driven", () => {
  const favorite = toggleFavoriteKeys(
    new Set(),
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
  );
  assert.equal(
    favorite.has(favoriteKey(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID)),
    true,
  );
  assert.equal(favoriteKey(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID).includes(ASSET_C), false);
  const fromFavorite = resolveStagePlacement({
    productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    variantId: STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.equal(fromFavorite?.assetId, ASSET_C);

  assert.deepEqual(
    rememberRecentlyUsed([], STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID),
    [STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID],
  );
  const fromRecent = resolveStagePlacement({
    productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.equal(fromRecent?.assetId, ASSET_C);

  const sideTableSearch = catalogQuery({ query: "side table" });
  assert.equal(sideTableSearch.some((product) => product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID), true);
  const brandSearch = catalogQuery({ query: "Vibode" });
  assert.equal(brandSearch.some((product) => product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID), true);

  const sideTables = catalogQuery({ subcategoryId: "side-tables" });
  assert.equal(sideTables.some((product) => product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID), true);
  const sofas = catalogQuery({ subcategoryId: "sofas" });
  assert.equal(sofas.some((product) => product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID), false);

  const picks = catalogQuery({
    mode: "collections",
    collectionId: "col-vibode-picks",
    categoryId: null,
  });
  assert.equal(picks.some((product) => product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID), true);

  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const card = source("components/stage/StageProductCard.tsx");
  const catalog = source("lib/vibode-stage/catalog.ts");
  assert.doesNotMatch(drawer, /Studio Side Table/);
  assert.doesNotMatch(card, /Studio Side Table/);
  assert.doesNotMatch(catalog, /Studio Side Table/);
  assert.match(drawer, /visibleStageCatalogProducts/);
});

test("PI-5E1 Asset C checksum, Settee→C, drift, and frozen boundaries stay intact", () => {
  const assetC = GENERATED_FURNITURE_ASSETS.find((asset) => asset.assetId === ASSET_C);
  assert.equal(assetC?.sha256, ASSET_C_SHA256);
  assert.ok(furnitureAssetDefinition(ASSET_C));
  assert.equal(
    resolveStagePlacement({ productId: STAGE_STUDIO_SETTEE_PRODUCT_ID, catalog: STAGE_SEED_CATALOG })?.assetId,
    ASSET_C,
  );
  assert.equal(
    resolveStagePlacement({ productId: STAGE_STUDIO_SOFA_PRODUCT_ID, catalog: STAGE_SEED_CATALOG })?.assetId,
    ASSET_A,
  );
  assert.equal(
    resolveStagePlacement({ productId: STAGE_STUDIO_CHAIR_PRODUCT_ID, catalog: STAGE_SEED_CATALOG })?.assetId,
    ASSET_B,
  );
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  assert.deepEqual(detectVariantAssetAssociationDrift(), []);
  assert.deepEqual(detectProductVariantRegistrationDrift(), []);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  assert.doesNotMatch(viewer, /product-variant-register|catalog-commercial\.generated|registerProductVariant/);
  assert.doesNotMatch(crud, /product-variant-register|STAGE_SEED_VARIANTS/);
  assert.doesNotMatch(persisted, /product-variant-register|catalog-commercial/);
  assert.match(crud, /uniformScale: 1/);
  assert.doesNotMatch(source(PRODUCT_SQL), /PI-5D2B/);
  assert.match(source(SETTEE_SQL), /PI-5D2B/);
});

test("PI-5E1 re-running exact registration fails with zero writes", () => {
  const before = snapshotFrozenTree();
  const result = registerProductVariant({
    input: proofInput(),
    migrationTimestamp: "20990101000001",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.written, null);
  assert.equal(result.errors.some((error) => error.code === "DUPLICATE_PRODUCT_ID"), true);

  const cli = runCli([
    "--input", PROOF_JSON,
    "--migration-timestamp", "20990101000002",
  ]);
  assert.notEqual(cli.status, 0);
  const payload = JSON.parse(cli.stdout) as { ok: boolean; errors: { code: string }[] };
  assert.equal(payload.ok, false);
  assert.equal(payload.errors.some((error) => error.code === "DUPLICATE_PRODUCT_ID"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E1 CLI exists and live --check of the registered Product writes nothing", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["vibode:register-product"], "node --import tsx scripts/vibode-product.ts");
  const before = snapshotFrozenTree();
  const check = runCli(["--input", PROOF_JSON, "--check"]);
  assert.notEqual(check.status, 0);
  const payload = JSON.parse(check.stdout) as { ok: boolean; written: null };
  assert.equal(payload.ok, false);
  assert.equal(payload.written, null);
  assert.deepEqual(snapshotFrozenTree(), before);
});
