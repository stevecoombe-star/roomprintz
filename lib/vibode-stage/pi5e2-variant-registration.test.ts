import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
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
} from "@/lib/afc-v2-runtime/types";

import {
  createStageCatalogSnapshot,
  formatStagePrice,
  resolveStagePlacement,
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
  STAGE_SEED_PRODUCTS,
  STAGE_SEED_VARIANTS,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_VARIANT_ID,
  STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
  STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
  STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
  STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_STUDIO_SOFA_VARIANT_ID,
  stageVariantsForProduct,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import { GENERATED_REGISTERED_PRODUCTS, GENERATED_REGISTERED_VARIANTS } from "./catalog-commercial.generated";
import { favoriteKey } from "./catalog";
import { isProductFavorited, toggleFavoriteKeys } from "./favorites";
import { detectProductVariantRegistrationDrift } from "./product-variant-drift";
import {
  COMMERCIAL_SEED_RELATIVE_PATH,
  isProductRegistrationMigrationFileName,
  isVariantRegistrationMigrationFileName,
  listProductRegistrationMigrations,
  listVariantRegistrationMigrations,
  parseVariantRegistrationJson,
  parseVariantRegistrationSql,
  registerVariant,
  renderAdditionalVariantInsertSql,
  renderGeneratedCommercialSeed,
  validateVariantRegistration,
  variantRegistrationMigrationFileName,
  type AdditionalVariantRegistrationInput,
} from "./product-variant-register";
import { buildStageSummary, summaryGroupKey } from "./summary";
import {
  detectVariantAssetAssociationDrift,
  isVariantAssociationMigrationFileName,
  listVariantAssociationMigrations,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
} from "./variant-asset-association";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

const ROOT = process.cwd();
const WALNUT_JSON = "lib/vibode-stage/studio-side-table-walnut.variant.json";
const BLACK_JSON = "lib/vibode-stage/studio-side-table-black.variant.json";
const PRODUCT_JSON = "lib/vibode-stage/studio-side-table.product.json";
const PRODUCT_SQL =
  "supabase/migrations/20260915010000_vibode_stage_product_studio_side_table.sql";
const WALNUT_SQL =
  "supabase/migrations/20260915020000_vibode_stage_register_variant_studio_side_table_walnut.sql";
const BLACK_SQL =
  "supabase/migrations/20260915030000_vibode_stage_register_variant_studio_side_table_black.sql";
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

function hasCode(
  result: Readonly<{ ok: boolean; errors: readonly { code: string }[] }>,
  code: string,
): boolean {
  return result.errors.some((error) => error.code === code);
}

function proofInput(relativePath: string): AdditionalVariantRegistrationInput {
  const parsed = parseVariantRegistrationJson(JSON.parse(source(relativePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("proof JSON invalid");
  return parsed.input;
}

function catalogWithoutProofExtras() {
  return createStageCatalogSnapshot({
    authority: STAGE_SEED_CATALOG.authority,
    fallbackReason: STAGE_SEED_CATALOG.fallbackReason,
    products: STAGE_SEED_CATALOG.products,
    variants: STAGE_SEED_CATALOG.variants.filter((variant) => (
      variant.variantId !== STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID &&
      variant.variantId !== STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID
    )),
    assets: STAGE_SEED_ASSETS,
    collections: STAGE_SEED_CATALOG.collections,
  });
}

function associationsWithoutProofExtras() {
  return GENERATED_VARIANT_CURRENT_ASSETS.filter((row) => (
    row.variantId !== STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID &&
    row.variantId !== STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID
  ));
}

function generatedVariantsWithoutProofExtras() {
  return GENERATED_REGISTERED_VARIANTS.filter((variant) => (
    variant.variantId !== STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID &&
    variant.variantId !== STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID
  ));
}

function isolatedGates(
  overrides: Parameters<typeof validateVariantRegistration>[1] = {},
) {
  return {
    catalog: catalogWithoutProofExtras(),
    currentAssociations: associationsWithoutProofExtras(),
    currentGeneratedProducts: GENERATED_REGISTERED_PRODUCTS,
    currentGeneratedVariants: generatedVariantsWithoutProofExtras(),
    manifestRepoRoot: ROOT,
    ...overrides,
  };
}

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5e2-variant-"));
  mkdirSync(path.join(repoRoot, "lib/vibode-stage"), { recursive: true });
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  return repoRoot;
}

function runCli(args: string[], cwd = ROOT) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/vibode-register-variant.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

function snapshotFrozenTree() {
  return {
    commercial: source(COMMERCIAL_SEED_RELATIVE_PATH),
    map: source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    productSql: source(PRODUCT_SQL),
    walnutSql: existsSync(path.join(ROOT, WALNUT_SQL)) ? source(WALNUT_SQL) : null,
    blackSql: existsSync(path.join(ROOT, BLACK_SQL)) ? source(BLACK_SQL) : null,
    setteeSql: source(SETTEE_SQL),
    assetCSql: source(ASSET_C_SQL),
    image: source("public/vibode-stage/studio-side-table.svg"),
    manifest: source("lib/afc-v2-runtime/furniture-asset-manifest.json"),
    registry: source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
    viewer: source("components/afc-3d/AfcProductionRoomViewer.tsx"),
    crud: source("lib/afc-v2-runtime/scene-crud.ts"),
    persisted: source("lib/afc-v2-runtime/persisted-scene.ts"),
    types: source("lib/afc-v2-runtime/types.ts"),
    migrations: readdirSync(path.join(ROOT, "supabase/migrations")).sort(),
  };
}

function place(productId: string, variantId?: string | null) {
  return resolveStagePlacement({
    productId,
    variantId,
    catalog: STAGE_SEED_CATALOG,
  });
}

function addPlaced(productId: string, variantId: string, objectId: string) {
  const placement = place(productId, variantId);
  assert.ok(placement);
  const added = addSceneObject({
    objects: [],
    assetId: placement!.assetId,
    identity: {
      productId: placement!.product.productId,
      variantId: placement!.variant.variantId,
    },
    createObjectId: () => objectId,
  });
  assert.equal(added.ok, true);
  if (!added.ok) throw new Error("add failed");
  return added.object;
}

test("PI-5E2 Walnut and Black JSON are accepted", () => {
  const walnutParsed = parseVariantRegistrationJson(JSON.parse(source(WALNUT_JSON)));
  assert.equal(walnutParsed.ok, true);
  const walnut = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates());
  assert.equal(walnut.ok, true);
  if (!walnut.ok) return;
  assert.equal(walnut.parsed.product.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(walnut.parsed.variant.variantId, STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID);
  assert.equal(walnut.parsed.variant.finishLabel, "Walnut");
  assert.equal(walnut.parsed.variant.sku, "VBD-STUDIO-SIDE-TABLE-WALNUT");
  assert.equal(walnut.parsed.variant.priceAmount, 525);
  assert.equal(walnut.parsed.assetId, ASSET_C);
  assert.equal(walnut.parsed.product.defaultVariantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.equal(walnut.parsed.product.priceAmount, 495);

  const black = validateVariantRegistration(proofInput(BLACK_JSON), isolatedGates());
  assert.equal(black.ok, true);
  if (!black.ok) return;
  assert.equal(black.parsed.variant.variantId, STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID);
  assert.equal(black.parsed.variant.finishLabel, "Black");
  assert.equal(black.parsed.variant.priceAmount, 495);
  assert.equal(black.parsed.assetId, ASSET_C);
});

test("PI-5E2 unknown Product and malformed JSON fail closed with zero writes", () => {
  const before = snapshotFrozenTree();
  const unknown = validateVariantRegistration({
    ...proofInput(WALNUT_JSON),
    productId: "prod-vibode-does-not-exist",
  }, isolatedGates());
  assert.equal(unknown.ok, false);
  assert.equal(hasCode(unknown, "UNKNOWN_PRODUCT"), true);

  const malformed = parseVariantRegistrationJson("not-an-object");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.errors.some((error) => error.code === "INVALID_JSON"), true);
  }
  const repoRoot = tmpRepo();
  writeFileSync(path.join(repoRoot, "bad.json"), "{");
  const cli = runCli(["--input", path.join(repoRoot, "bad.json"), "--repo-root", repoRoot]);
  assert.notEqual(cli.status, 0);
  const payload = JSON.parse(cli.stdout) as { ok: boolean; written: null; errors: { code: string }[] };
  assert.equal(payload.ok, false);
  assert.equal(payload.written, null);
  assert.equal(payload.errors.some((error) => error.code === "INVALID_JSON"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E2 duplicate Variant ID, duplicate SKU, and invalid identity fail closed", () => {
  const before = snapshotFrozenTree();
  const duplicateId = validateVariantRegistration(proofInput(WALNUT_JSON));
  assert.equal(duplicateId.ok, false);
  assert.equal(hasCode(duplicateId, "DUPLICATE_VARIANT_ID"), true);

  const duplicateSku = validateVariantRegistration({
    productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    variant: {
      ...proofInput(WALNUT_JSON).variant,
      variantId: "var-vibode-studio-side-table-extra",
      sku: "VBD-STUDIO-SIDE-TABLE-01",
    },
  }, isolatedGates());
  assert.equal(duplicateSku.ok, false);
  assert.equal(hasCode(duplicateSku, "DUPLICATE_SKU"), true);

  const uuid = validateVariantRegistration({
    productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    variant: {
      ...proofInput(WALNUT_JSON).variant,
      variantId: "550e8400-e29b-41d4-a716-446655440000",
    },
  }, isolatedGates());
  assert.equal(uuid.ok, false);
  assert.equal(hasCode(uuid, "INVALID_VARIANT_ID"), true);

  const assetInId = validateVariantRegistration({
    productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    variant: {
      ...proofInput(WALNUT_JSON).variant,
      variantId: `var-${ASSET_C}`,
    },
  }, isolatedGates());
  assert.equal(assetInId.ok, false);
  assert.equal(hasCode(assetInId, "INVALID_VARIANT_ID"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E2 invalid price/currency fail, and Walnut 525 is valid while Product stays 495", () => {
  const before = snapshotFrozenTree();
  const negative = validateVariantRegistration({
    ...proofInput(WALNUT_JSON),
    variant: { ...proofInput(WALNUT_JSON).variant, priceAmount: -1 },
  }, isolatedGates());
  assert.equal(negative.ok, false);
  assert.equal(hasCode(negative, "INVALID_PRICE"), true);

  const nonFinite = validateVariantRegistration({
    ...proofInput(WALNUT_JSON),
    variant: { ...proofInput(WALNUT_JSON).variant, priceAmount: Number.POSITIVE_INFINITY },
  }, isolatedGates());
  assert.equal(nonFinite.ok, false);
  assert.equal(hasCode(nonFinite, "INVALID_PRICE"), true);

  const currency = validateVariantRegistration({
    ...proofInput(WALNUT_JSON),
    variant: { ...proofInput(WALNUT_JSON).variant, priceCurrency: "US" },
  }, isolatedGates());
  assert.equal(currency.ok, false);
  assert.equal(hasCode(currency, "INVALID_CURRENCY"), true);

  const walnut = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates());
  assert.equal(walnut.ok, true);
  if (!walnut.ok) return;
  assert.equal(walnut.parsed.variant.priceAmount, 525);
  assert.equal(walnut.parsed.product.priceAmount, 495);
  assert.equal(walnut.errors.some((error) => error.code === "PRICE_CURRENCY_MISMATCH"), false);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E2 unknown, unavailable, runtime-missing, seed-missing Asset and association conflict fail", () => {
  const before = snapshotFrozenTree();
  const unknownAsset = validateVariantRegistration({
    ...proofInput(WALNUT_JSON),
    variant: {
      ...proofInput(WALNUT_JSON).variant,
      currentAssetId: "afc-v2-runtime/test-fixtures/not-an-asset",
    },
  }, isolatedGates());
  assert.equal(unknownAsset.ok, false);
  assert.equal(hasCode(unknownAsset, "UNKNOWN_ASSET"), true);

  const unavailable = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates({
    seedAssets: STAGE_SEED_ASSETS.map((asset) => (
      asset.assetId === ASSET_C ? { ...asset, status: "unavailable" } : asset
    )),
  }));
  assert.equal(unavailable.ok, false);
  assert.equal(hasCode(unavailable, "UNAVAILABLE_ASSET"), true);

  const runtimeMissing = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates({
    runtimeAssetIds: [ASSET_A, ASSET_B],
  }));
  assert.equal(runtimeMissing.ok, false);
  assert.equal(hasCode(runtimeMissing, "RUNTIME_MISSING_ASSET"), true);

  const seedMissing = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates({
    seedAssets: STAGE_SEED_ASSETS.filter((asset) => asset.assetId !== ASSET_C),
  }));
  assert.equal(seedMissing.ok, false);
  assert.equal(hasCode(seedMissing, "SEED_MISSING_ASSET"), true);

  const unknownRuntime = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates({
    runtimeDefinitionKnown: () => false,
  }));
  assert.equal(unknownRuntime.ok, false);
  assert.equal(hasCode(unknownRuntime, "UNKNOWN_RUNTIME_DEFINITION"), true);

  const conflict = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates({
    currentAssociations: [
      ...associationsWithoutProofExtras(),
      {
        variantId: STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
        productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
        currentAssetId: ASSET_C,
      },
    ],
  }));
  assert.equal(conflict.ok, false);
  assert.equal(hasCode(conflict, "ASSOCIATION_CONFLICT"), true);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E2 --check writes nothing and success appends Variant seed, association, and register_variant SQL", () => {
  const repoRoot = tmpRepo();
  const check = registerVariant({
    input: proofInput(WALNUT_JSON),
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
  assert.equal(
    path.basename(check.plan.migration),
    variantRegistrationMigrationFileName("20990101000000", STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID),
  );

  const written = registerVariant({
    input: proofInput(WALNUT_JSON),
    repoRoot,
    migrationTimestamp: "20990101000000",
    ...isolatedGates({ repoRoot }),
  });
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.ok(written.written);
  const commercial = readFileSync(written.written.commercialSeed, "utf8");
  assert.match(commercial, /var-vibode-studio-side-table-walnut/);
  assert.match(commercial, /Walnut/);
  assert.match(commercial, /VBD-STUDIO-SIDE-TABLE-WALNUT/);
  assert.match(commercial, /525/);
  assert.match(commercial, /prod-vibode-studio-side-table/);
  assert.match(commercial, /var-vibode-studio-side-table-default/);
  assert.equal((commercial.match(/prod-vibode-studio-side-table/g) ?? []).length >= 1, true);
  assert.doesNotMatch(commercial, /currentAssetId|pi5d2-side-table/);
  assert.match(commercial, /defaultVariantId: "var-vibode-studio-side-table-default"/);
  const map = readFileSync(written.written.generatedMap, "utf8");
  assert.match(map, /var-vibode-studio-side-table-walnut/);
  assert.match(map, /var-vibode-studio-side-table-default/);
  assert.match(map, /var-vibode-studio-settee-default/);
  assert.match(map, /pi5d2-side-table/);
  const sql = readFileSync(written.written.migration, "utf8");
  assert.equal(sql, written.plan?.sql);
  assert.equal(isVariantRegistrationMigrationFileName(path.basename(written.written.migration)), true);
  assert.equal(isProductRegistrationMigrationFileName(path.basename(written.written.migration)), false);
  assert.equal(isVariantAssociationMigrationFileName(path.basename(written.written.migration)), false);
  const parsed = parseVariantRegistrationSql(sql);
  assert.equal(parsed.insertsVariant, true);
  assert.equal(parsed.insertsProduct, false);
  assert.equal(parsed.updatesProduct, false);
  assert.equal(parsed.updatesVariant, false);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.touchesCollections, false);
  assert.equal(parsed.touchesObjectsJson, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.mentionsDefaultVariant, false);
  assert.deepEqual([...parsed.variantIds], [STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID]);
  assert.deepEqual([...parsed.productIds], [STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID]);
  assert.equal(parsed.assetIds.includes(ASSET_C), true);
  const validated = validateVariantRegistration(proofInput(WALNUT_JSON), isolatedGates({ repoRoot }));
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(sql, renderAdditionalVariantInsertSql(validated.parsed));
});

test("PI-5E2 live seed, association map, and SQL contain Walnut and Black without mutating Product", () => {
  assert.equal(
    source(COMMERCIAL_SEED_RELATIVE_PATH),
    renderGeneratedCommercialSeed({
      products: GENERATED_REGISTERED_PRODUCTS,
      variants: GENERATED_REGISTERED_VARIANTS,
    }),
  );
  assert.equal(GENERATED_REGISTERED_PRODUCTS.length, 1);
  assert.equal(GENERATED_REGISTERED_PRODUCTS[0]?.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(GENERATED_REGISTERED_PRODUCTS[0]?.defaultVariantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.equal(GENERATED_REGISTERED_PRODUCTS[0]?.priceAmount, 495);
  assert.equal(GENERATED_REGISTERED_VARIANTS[0]?.variantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.deepEqual(GENERATED_REGISTERED_VARIANTS.map((variant) => variant.variantId), [
    STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
    STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
  ]);
  assert.equal(GENERATED_REGISTERED_VARIANTS[1]?.priceAmount, 525);
  assert.equal(GENERATED_REGISTERED_VARIANTS[2]?.priceAmount, 495);

  const walnutAssoc = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
    row.variantId === STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID
  ));
  const blackAssoc = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
    row.variantId === STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID
  ));
  const oakAssoc = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
    row.variantId === STAGE_STUDIO_SIDE_TABLE_VARIANT_ID
  ));
  const settee = GENERATED_VARIANT_CURRENT_ASSETS.find((row) => (
    row.variantId === STAGE_STUDIO_SETTEE_VARIANT_ID
  ));
  assert.equal(walnutAssoc?.currentAssetId, ASSET_C);
  assert.equal(blackAssoc?.currentAssetId, ASSET_C);
  assert.equal(oakAssoc?.currentAssetId, ASSET_C);
  assert.equal(settee?.currentAssetId, ASSET_C);

  assert.deepEqual(listVariantRegistrationMigrations(ROOT), [
    "20260915020000_vibode_stage_register_variant_studio_side_table_walnut.sql",
    "20260915030000_vibode_stage_register_variant_studio_side_table_black.sql",
  ]);
  assert.deepEqual(listProductRegistrationMigrations(ROOT), [
    "20260915010000_vibode_stage_product_studio_side_table.sql",
  ]);
  assert.deepEqual(listVariantAssociationMigrations(ROOT), [
    "20260914230000_vibode_stage_variant_studio_settee_default.sql",
  ]);

  const productSql = source(PRODUCT_SQL);
  assert.doesNotMatch(productSql, /var-vibode-studio-side-table-walnut/);
  assert.doesNotMatch(productSql, /var-vibode-studio-side-table-black/);
  assert.match(productSql, /default_variant_id[\s\S]*var-vibode-studio-side-table-default/);

  for (const relative of [WALNUT_SQL, BLACK_SQL]) {
    const sql = source(relative);
    const parsed = parseVariantRegistrationSql(sql);
    assert.equal(isVariantRegistrationMigrationFileName(path.basename(relative)), true);
    assert.equal(isVariantAssociationMigrationFileName(path.basename(relative)), false);
    assert.equal(parsed.insertsVariant, true);
    assert.equal(parsed.insertsProduct, false);
    assert.equal(parsed.updatesProduct, false);
    assert.equal(parsed.updatesVariant, false);
    assert.equal(parsed.mutatesAssets, false);
    assert.equal(parsed.touchesCollections, false);
    assert.equal(parsed.touchesObjectsJson, false);
    assert.equal(parsed.touchesScenes, false);
    assert.equal(parsed.mentionsDefaultVariant, false);
    assert.doesNotMatch(sql, /insert\s+into\s+public\.vibode_stage_products/i);
    assert.doesNotMatch(sql, /update\s+public\.vibode_stage_products/i);
    assert.doesNotMatch(sql, /update\s+public\.vibode_stage_variants/i);
    assert.doesNotMatch(sql, /insert\s+into\s+public\.vibode_stage_assets/i);
    assert.doesNotMatch(sql, /update\s+public\.vibode_stage_assets/i);
    assert.doesNotMatch(sql, /vibode_stage_product_collections/);
    assert.doesNotMatch(sql, /objects_json/);
    assert.doesNotMatch(sql, /vibode_3d_scenes/);
    assert.match(sql, /status = 'active'/);
    assert.match(sql, /status = 'ready'/);
  }
  assert.match(source(WALNUT_SQL), /525/);
  assert.match(source(WALNUT_SQL), /Walnut/);
  assert.match(source(BLACK_SQL), /Black/);
});

test("PI-5E2 Product count stays 4, Variant count becomes 6, and stageVariantsForProduct is deterministic", () => {
  assert.equal(STAGE_SEED_PRODUCTS.length, 4);
  assert.equal(STAGE_SEED_VARIANTS.length, 6);
  assert.equal(
    STAGE_SEED_PRODUCTS.filter((product) => product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID).length,
    1,
  );
  const sideTable = stageVariantsForProduct(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.deepEqual(sideTable.map((variant) => variant.variantId), [
    STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
    STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
  ]);
  assert.equal(stageVariantsForProduct(STAGE_STUDIO_SOFA_PRODUCT_ID).length, 1);
  assert.equal(stageVariantsForProduct(STAGE_STUDIO_SETTEE_PRODUCT_ID).length, 1);
  assert.equal(stageVariantsForProduct(STAGE_STUDIO_CHAIR_PRODUCT_ID).length, 1);

  const overridden = stageVariantsForProduct(
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    [{
      variantId: STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
      productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
      assetId: ASSET_C,
      finishLabel: "Walnut extra",
      sku: "VBD-STUDIO-SIDE-TABLE-WALNUT",
      priceAmount: 525,
      priceCurrency: "USD",
      productUrl: null,
    }],
  );
  assert.equal(overridden.find((variant) => (
    variant.variantId === STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID
  ))?.finishLabel, "Walnut extra");
});

test("PI-5E2 Product Detail selector, selected prices, and Add use the selected Variant", () => {
  const detail = source("components/stage/StageProductDetail.tsx");
  const card = source("components/stage/StageProductCard.tsx");
  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  assert.match(detail, /stageVariantsForProduct/);
  assert.match(detail, /data-stage-selected-variant/);
  assert.match(detail, /variants\.length > 1/);
  assert.match(detail, /product\.defaultVariantId/);
  assert.match(detail, /addProductToRoom\(\s*product\.productId,\s*selectedVariantId/);
  assert.match(detail, /toggleFavorite\(\s*product\.productId,\s*selectedVariantId/);
  assert.doesNotMatch(card, /stageVariantsForProduct|selectedVariantId|<select/);
  assert.match(drawer, /onAdd\(product\.productId, product\.defaultVariantId\)/);

  const walnut = place(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID, STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID);
  const black = place(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID, STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID);
  const oak = place(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(walnut?.variant.priceAmount, 525);
  assert.equal(black?.variant.priceAmount, 495);
  assert.equal(oak?.variant.variantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.equal(formatStagePrice(walnut?.variant.priceAmount, "USD"), "$525");
  assert.equal(formatStagePrice(black?.variant.priceAmount, "USD"), "$495");
  assert.equal(formatStagePrice(oak?.product.priceAmount, "USD"), "$495");
});

test("PI-5E2 Walnut/Black Add freeze selected Variant + Asset C; omitted Variant still resolves oak", () => {
  const walnut = addPlaced(
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
    "so-side-table-walnut",
  );
  assert.equal(walnut.productId, STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(walnut.variantId, STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID);
  assert.equal(walnut.assetId, ASSET_C);
  assert.equal(walnut.transform.uniformScale, 1);

  const black = addPlaced(
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
    "so-side-table-black",
  );
  assert.equal(black.variantId, STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID);
  assert.equal(black.assetId, ASSET_C);
  assert.equal(black.transform.uniformScale, 1);

  const omitted = place(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.equal(omitted?.variant.variantId, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID);
  assert.equal(omitted?.assetId, ASSET_C);
});

test("PI-5E2 Summary groups by Product+Variant, not shared Asset C", () => {
  const oakA = addPlaced(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID, STAGE_STUDIO_SIDE_TABLE_VARIANT_ID, "so-oak-a");
  const oakB = addSceneObject({
    objects: [oakA],
    assetId: ASSET_C,
    identity: {
      productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
      variantId: STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
    },
    createObjectId: () => "so-oak-b",
  });
  assert.equal(oakB.ok, true);
  if (!oakB.ok) return;
  const twoOak = buildStageSummary({ catalog: STAGE_SEED_CATALOG, objects: oakB.objects });
  assert.equal(twoOak.lines.length, 1);
  assert.equal(twoOak.lines[0]?.quantity, 2);
  assert.equal(twoOak.lines[0]?.variantLabel, "Natural oak");
  assert.equal(twoOak.lines[0]?.unitPrice, 495);

  const walnut = addPlaced(
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
    "so-walnut",
  );
  const oakWalnut = buildStageSummary({
    catalog: STAGE_SEED_CATALOG,
    objects: [oakA, walnut],
  });
  assert.equal(oakWalnut.lines.length, 2);
  assert.equal(summaryGroupKey(oakA) === summaryGroupKey(walnut), false);

  const black = addPlaced(
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
    "so-black",
  );
  const walnutBlack = buildStageSummary({
    catalog: STAGE_SEED_CATALOG,
    objects: [walnut, black],
  });
  assert.equal(walnutBlack.lines.length, 2);
  const walnutLine = walnutBlack.lines.find((line) => (
    line.variantId === STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID
  ));
  const blackLine = walnutBlack.lines.find((line) => (
    line.variantId === STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID
  ));
  assert.equal(walnutLine?.name, "Studio Side Table");
  assert.equal(walnutLine?.variantLabel, "Walnut");
  assert.equal(walnutLine?.unitPrice, 525);
  assert.equal(blackLine?.name, "Studio Side Table");
  assert.equal(blackLine?.variantLabel, "Black");
  assert.equal(blackLine?.unitPrice, 495);
  assert.equal(walnut.assetId, black.assetId);
});

test("PI-5E2 Favorites, Recent, Collections, and search stay Product-level except widened Favorites inclusion", () => {
  const walnutKey = favoriteKey(
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
  );
  const favorite = toggleFavoriteKeys(
    new Set(),
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
  );
  assert.equal(favorite.has(walnutKey), true);
  assert.equal(isProductFavorited(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID, favorite), true);
  const favorites = filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "favorites",
    query: "",
    categoryId: null,
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: favorite,
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(favorites.filter((product) => (
    product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID
  )).length, 1);

  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const card = source("components/stage/StageProductCard.tsx");
  assert.match(drawer, /toggleFavorite\(product\.productId, product\.defaultVariantId\)/);
  assert.match(card, /favoriteKey\(product\.productId, product\.defaultVariantId\)/);

  assert.deepEqual(
    rememberRecentlyUsed([], STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID),
    [STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID],
  );
  const context = source("components/stage/StageEditorContext.tsx");
  assert.match(context, /rememberRecentlyUsed\(current, productId\)/);
  assert.doesNotMatch(context, /selectedVariantId/);

  const picks = filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "collections",
    query: "",
    categoryId: null,
    subcategoryId: null,
    collectionId: "col-vibode-picks",
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(picks.filter((product) => (
    product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID
  )).length, 1);

  const walnutSearch = filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "browse",
    query: "walnut",
    categoryId: "living-room",
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(walnutSearch.some((product) => (
    product.productId === STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID
  )), false);
  const blackSearch = filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "browse",
    query: "black",
    categoryId: "living-room",
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(blackSearch.length, 0);
});

test("PI-5E2 frozen Product SQL, Asset C, Settee→C, drift, and viewer/schema stay intact", () => {
  const assetC = GENERATED_FURNITURE_ASSETS.find((asset) => asset.assetId === ASSET_C);
  assert.equal(assetC?.sha256, ASSET_C_SHA256);
  assert.ok(furnitureAssetDefinition(ASSET_C));
  assert.equal(place(STAGE_STUDIO_SETTEE_PRODUCT_ID)?.assetId, ASSET_C);
  assert.equal(place(STAGE_STUDIO_SOFA_PRODUCT_ID)?.assetId, ASSET_A);
  assert.equal(place(STAGE_STUDIO_CHAIR_PRODUCT_ID)?.assetId, ASSET_B);
  assert.equal(place(STAGE_STUDIO_SOFA_PRODUCT_ID)?.variant.variantId, STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  assert.deepEqual(detectVariantAssetAssociationDrift(), []);
  assert.deepEqual(detectProductVariantRegistrationDrift(), []);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  const types = source("lib/afc-v2-runtime/types.ts");
  assert.doesNotMatch(viewer, /registerVariant|register-variant|selectedVariantId/);
  assert.doesNotMatch(crud, /registerVariant|STAGE_SEED_VARIANTS/);
  assert.doesNotMatch(persisted, /registerVariant|catalog-commercial/);
  assert.match(crud, /uniformScale: 1/);
  assert.match(types, /productId\?: string;/);
  assert.match(types, /variantId\?: string;/);
  assert.doesNotMatch(source(PRODUCT_SQL), /PI-5E2/);
  assert.match(source(SETTEE_SQL), /PI-5D2B/);
  assert.match(source(WALNUT_SQL), /PI-5E2/);
  assert.doesNotMatch(source(PRODUCT_JSON), /"variants"\s*:/);
});

test("PI-5E2 repeat Walnut/Black registration fails with zero writes", () => {
  const before = snapshotFrozenTree();
  const walnut = registerVariant({
    input: proofInput(WALNUT_JSON),
    migrationTimestamp: "20990101000011",
  });
  assert.equal(walnut.ok, false);
  if (!walnut.ok) {
    assert.equal(walnut.written, null);
    assert.equal(hasCode(walnut, "DUPLICATE_VARIANT_ID"), true);
  }
  const black = registerVariant({
    input: proofInput(BLACK_JSON),
    migrationTimestamp: "20990101000012",
  });
  assert.equal(black.ok, false);
  if (!black.ok) {
    assert.equal(black.written, null);
    assert.equal(hasCode(black, "DUPLICATE_VARIANT_ID"), true);
  }
  const cli = runCli([
    "--input", WALNUT_JSON,
    "--migration-timestamp", "20990101000013",
  ]);
  assert.notEqual(cli.status, 0);
  const payload = JSON.parse(cli.stdout) as { ok: boolean; written: null };
  assert.equal(payload.ok, false);
  assert.equal(payload.written, null);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5E2 CLI exists and live --check of registered Walnut writes nothing", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["vibode:register-variant"], "node --import tsx scripts/vibode-register-variant.ts");
  assert.equal(pkg.scripts["vibode:retarget-variant"], "node --import tsx scripts/vibode-variant.ts");
  assert.equal(pkg.scripts["test:afc-v2-pi5e2"]?.includes("pi5e2-variant-registration.test.ts"), true);
  const before = snapshotFrozenTree();
  const check = runCli(["--input", WALNUT_JSON, "--check"]);
  assert.notEqual(check.status, 0);
  const payload = JSON.parse(check.stdout) as { ok: boolean; written: null };
  assert.equal(payload.ok, false);
  assert.equal(payload.written, null);
  assert.deepEqual(snapshotFrozenTree(), before);
});
