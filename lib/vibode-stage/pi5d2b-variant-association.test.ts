import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { PI5D2_SIDE_TABLE_ASSET_ID } from "@/lib/afc-v2-runtime/pi5d2-side-table-geometry";
import { validatePersistedSceneObjects } from "@/lib/afc-v2-runtime/persisted-scene";
import { addSceneObject, duplicateSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
} from "@/lib/afc-v2-runtime/types";
import {
  createStageCatalogSnapshot,
  favoriteKey,
  resolveStagePlacement,
  seedFixtureStageCatalog,
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
  STAGE_SEED_VARIANTS,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_CHAIR_VARIANT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_VARIANT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_STUDIO_SOFA_VARIANT_ID,
} from "./catalog";
import { rememberRecentlyUsed } from "./catalog-query";
import { STAGE_FAVORITES_STORAGE_KEY } from "./favorites";
import { buildStageSummary } from "./summary";
import {
  detectVariantAssetAssociationDrift,
  listVariantAssociationMigrations,
  parseVariantAssociationSql,
  renderGeneratedVariantCurrentAssetMap,
  renderVariantCurrentAssetUpdateSql,
  retargetVariantCurrentAssetAssociation,
  retargetVariantCurrentAssetStrict,
  validateVariantAssetAssociation,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
  variantAssociationMigrationFileName,
  type VariantCurrentAssetAssociation,
} from "./variant-asset-association";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

const ROOT = process.cwd();
const SETTEE_MIGRATION =
  "supabase/migrations/20260914230000_vibode_stage_variant_studio_settee_default.sql";
const ASSET_C_MIGRATION =
  "supabase/migrations/20260914220000_vibode_stage_asset_pi5d2_side_table.sql";
const ASSET_A = AFC_V2_RUNTIME_FURNITURE_ASSET_ID;
const ASSET_B = AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID;
const ASSET_C = PI5D2_SIDE_TABLE_ASSET_ID;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function runCli(args: string[], cwd = ROOT) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/vibode-variant.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

function seedAssetId(variantId: string): string | null {
  return STAGE_SEED_VARIANTS.find((variant) => variant.variantId === variantId)?.assetId ?? null;
}

function beforeRetargetAssociations(): VariantCurrentAssetAssociation[] {
  return [
    {
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      currentAssetId: ASSET_A,
    },
    {
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      currentAssetId: ASSET_A,
    },
    {
      variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
      productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
      currentAssetId: ASSET_B,
    },
  ];
}

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5d2b-assoc-"));
  mkdirSync(path.join(repoRoot, "lib/vibode-stage"), { recursive: true });
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  return repoRoot;
}

function snapshotFrozenAssets() {
  return {
    manifest: source("lib/afc-v2-runtime/furniture-asset-manifest.json"),
    registry: source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
    register: source("scripts/vibode-asset.ts"),
    assetC: source(ASSET_C_MIGRATION),
    map: source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    setteeSql: source(SETTEE_MIGRATION),
    migrations: readdirSync(path.join(ROOT, "supabase/migrations")).sort(),
  };
}

function setteeObject(input: Readonly<{
  objectId: string;
  assetId: string;
}>) {
  return {
    objectId: input.objectId,
    assetId: input.assetId,
    transform: DEFAULT_WORLD_TRANSFORM,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
  };
}

test("PI-5D2B known Variant → known ready Asset succeeds and writes seed/SQL only", () => {
  const repoRoot = tmpRepo();
  const result = retargetVariantCurrentAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
    repoRoot,
    currentAssociations: beforeRetargetAssociations(),
    migrationTimestamp: "20260914230000",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.noop, false);
  assert.ok(result.written);
  assert.equal(existsSync(result.written.generatedMap), true);
  assert.equal(existsSync(result.written.migration), true);
  assert.equal(
    path.basename(result.written.migration),
    variantAssociationMigrationFileName("20260914230000", STAGE_STUDIO_SETTEE_VARIANT_ID),
  );
  const map = readFileSync(result.written.generatedMap, "utf8");
  assert.equal(
    map,
    renderGeneratedVariantCurrentAssetMap([
      ...beforeRetargetAssociations().filter((row) => row.variantId !== STAGE_STUDIO_SETTEE_VARIANT_ID),
      {
        variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
        productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
        currentAssetId: ASSET_C,
      },
    ]),
  );
  assert.match(map, /pi5d2-side-table/);
  assert.doesNotMatch(map, /priceAmount|imageUrl|Studio Settee/);
  const sql = readFileSync(result.written.migration, "utf8");
  assert.equal(sql, renderVariantCurrentAssetUpdateSql({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
  }));
  assert.equal(existsSync(path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json")), false);
});

test("PI-5D2B unknown Variant/Product/mismatch/Asset fail with zero writes", () => {
  const before = snapshotFrozenAssets();
  const cases = [
    {
      variantId: "var-does-not-exist",
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      assetId: ASSET_C,
      code: "UNKNOWN_VARIANT",
    },
    {
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
      productId: "prod-does-not-exist",
      assetId: ASSET_C,
      code: "UNKNOWN_PRODUCT",
    },
    {
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      assetId: ASSET_C,
      code: "PRODUCT_VARIANT_MISMATCH",
    },
    {
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      assetId: "afc-v2-runtime/test-fixtures/not-an-asset",
      code: "UNKNOWN_ASSET",
    },
  ] as const;
  for (const item of cases) {
    const result = retargetVariantCurrentAssetAssociation({
      ...item,
      migrationTimestamp: "20990101000000",
    });
    assert.equal(result.ok, false, item.code);
    if (result.ok) return;
    assert.equal(result.written, null);
    assert.equal(result.errors.some((error) => error.code === item.code), true, item.code);
  }
  const after = snapshotFrozenAssets();
  assert.deepEqual(after, before);
});

test("PI-5D2B unavailable, runtime-missing, and unknown runtime Assets fail closed", () => {
  const before = snapshotFrozenAssets();
  const unavailable = validateVariantAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
    seedAssets: STAGE_SEED_ASSETS.map((asset) => (
      asset.assetId === ASSET_C ? { ...asset, status: "unavailable" } : asset
    )),
  });
  assert.equal(unavailable.ok, false);
  if (unavailable.ok) return;
  assert.equal(unavailable.errors.some((error) => error.code === "UNAVAILABLE_ASSET"), true);

  const runtimeMissing = validateVariantAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
    runtimeAssetIds: [ASSET_A, ASSET_B],
  });
  assert.equal(runtimeMissing.ok, false);
  if (runtimeMissing.ok) return;
  assert.equal(runtimeMissing.errors.some((error) => error.code === "RUNTIME_MISSING_ASSET"), true);

  const unknownDefinition = validateVariantAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
    runtimeDefinitionKnown: () => false,
  });
  assert.equal(unknownDefinition.ok, false);
  if (unknownDefinition.ok) return;
  assert.equal(
    unknownDefinition.errors.some((error) => error.code === "UNKNOWN_RUNTIME_DEFINITION"),
    true,
  );

  const strict = retargetVariantCurrentAssetStrict(STAGE_SEED_CATALOG, {
    variantId: "var-does-not-exist",
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
  });
  assert.equal(strict.ok, false);
  assert.deepEqual(snapshotFrozenAssets(), before);
});

test("PI-5D2B no-op association writes nothing and is safe to repeat", () => {
  const before = snapshotFrozenAssets();
  const first = retargetVariantCurrentAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
    migrationTimestamp: "20990101000001",
  });
  const second = retargetVariantCurrentAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
    migrationTimestamp: "20990101000002",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.noop, true);
  assert.equal(second.noop, true);
  assert.equal(first.written, null);
  assert.equal(second.written, null);
  const cli = runCli([
    "--variant-id", STAGE_STUDIO_SETTEE_VARIANT_ID,
    "--product-id", STAGE_STUDIO_SETTEE_PRODUCT_ID,
    "--asset-id", ASSET_C,
  ]);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout) as { ok: boolean; noop: boolean; written: null };
  assert.equal(payload.ok, true);
  assert.equal(payload.noop, true);
  assert.equal(payload.written, null);
  assert.deepEqual(snapshotFrozenAssets(), before);
});

test("PI-5D2B seed net association is Sofa A, Settee C, Chair B", () => {
  assert.equal(seedAssetId(STAGE_STUDIO_SOFA_VARIANT_ID), ASSET_A);
  assert.equal(seedAssetId(STAGE_STUDIO_SETTEE_VARIANT_ID), ASSET_C);
  assert.equal(seedAssetId(STAGE_STUDIO_CHAIR_VARIANT_ID), ASSET_B);
  const fallback = seedFixtureStageCatalog("durable_load_failed");
  const sofa = resolveStagePlacement({
    productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
    catalog: fallback,
  });
  const settee = resolveStagePlacement({
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    catalog: fallback,
  });
  const chair = resolveStagePlacement({
    productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
    catalog: fallback,
  });
  assert.ok(sofa && settee && chair);
  assert.equal(sofa.assetId, ASSET_A);
  assert.equal(settee.assetId, ASSET_C);
  assert.equal(chair.assetId, ASSET_B);
  assert.equal(settee.product.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  assert.equal(settee.variant.variantId, STAGE_STUDIO_SETTEE_VARIANT_ID);
  assert.equal(settee.product.name, "Studio Settee");
  assert.equal(settee.product.priceAmount, 1895);
});

test("PI-5D2B generated SQL targets one Variant, requires ready Asset, and ignores Scene Objects", () => {
  const sql = source(SETTEE_MIGRATION);
  assert.equal(sql, renderVariantCurrentAssetUpdateSql({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_C,
  }));
  const parsed = parseVariantAssociationSql(sql);
  assert.deepEqual([...new Set(parsed.variantIds)], [STAGE_STUDIO_SETTEE_VARIANT_ID]);
  assert.deepEqual([...new Set(parsed.productIds)], [STAGE_STUDIO_SETTEE_PRODUCT_ID]);
  assert.deepEqual([...new Set(parsed.assetIds)], [ASSET_C]);
  assert.match(sql, /status = 'ready'/);
  assert.match(sql, /Target Asset is missing or not ready/);
  assert.match(sql, /Expected exactly one matching Variant/);
  assert.doesNotMatch(sql, /objects_json/);
  assert.doesNotMatch(sql, /vibode_3d_scenes/);
  assert.doesNotMatch(sql, /vibode_stage_products/);
  assert.doesNotMatch(sql, /vibode_stage_collections/);
  assert.doesNotMatch(sql, /insert into public\.vibode_stage_assets/);
  assert.doesNotMatch(sql, /update public\.vibode_stage_assets/);
  assert.match(sql, /update public\.vibode_stage_variants/);
});

test("PI-5D2B association drift detector is clean for the certified net map", () => {
  const issues = detectVariantAssetAssociationDrift();
  assert.deepEqual(issues, []);
  assert.equal(
    source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    renderGeneratedVariantCurrentAssetMap(GENERATED_VARIANT_CURRENT_ASSETS),
  );
  assert.deepEqual(
    listVariantAssociationMigrations(ROOT),
    ["20260914230000_vibode_stage_variant_studio_settee_default.sql"],
  );

  const drifted = detectVariantAssetAssociationDrift({
    associations: beforeRetargetAssociations(),
  });
  assert.equal(drifted.some((issue) => issue.code === "MAP_SEED_DRIFT"), true);
});

test("PI-5D2B placement-time freeze: old Settee stays A, new Add stores C", () => {
  const oldObject = setteeObject({ objectId: "so-settee-a", assetId: ASSET_A });
  const restored = validatePersistedSceneObjects([oldObject]);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.objects[0]?.assetId, ASSET_A);
  assert.equal(restored.objects[0]?.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  assert.equal(restored.objects[0]?.variantId, STAGE_STUDIO_SETTEE_VARIANT_ID);

  const placement = resolveStagePlacement({
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.ok(placement);
  assert.equal(placement.assetId, ASSET_C);
  const added = addSceneObject({
    objects: restored.objects,
    assetId: placement.assetId,
    identity: {
      productId: placement.product.productId,
      variantId: placement.variant.variantId,
    },
    createObjectId: () => "so-settee-c",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  assert.equal(added.object.variantId, STAGE_STUDIO_SETTEE_VARIANT_ID);
  assert.equal(added.object.assetId, ASSET_C);
  assert.equal(added.objects[0]?.assetId, ASSET_A);
  assert.equal(JSON.stringify(added.objects).includes("rewrite"), false);
});

test("PI-5D2B duplicate of an old A Settee stays A", () => {
  const added = addSceneObject({
    objects: [],
    assetId: ASSET_A,
    identity: {
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    },
    createObjectId: () => "so-settee-old-a",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const duplicated = duplicateSceneObject({
    objects: added.objects,
    objectId: added.object.objectId,
    createObjectId: () => "so-settee-dup-a",
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.equal(duplicated.object.assetId, ASSET_A);
  assert.equal(duplicated.object.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  assert.equal(duplicated.object.variantId, STAGE_STUDIO_SETTEE_VARIANT_ID);
  assert.notEqual(
    resolveStagePlacement({
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      catalog: STAGE_SEED_CATALOG,
    })?.assetId,
    duplicated.object.assetId,
  );
});

test("PI-5D2B Summary groups A and C Settees as one Studio Settee line", () => {
  const summary = buildStageSummary({
    catalog: STAGE_SEED_CATALOG,
    objects: [
      setteeObject({ objectId: "so-old-a", assetId: ASSET_A }),
      setteeObject({ objectId: "so-new-c", assetId: ASSET_C }),
    ],
  });
  assert.equal(summary.lines.length, 1);
  assert.equal(summary.lines[0]?.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  assert.equal(summary.lines[0]?.variantId, STAGE_STUDIO_SETTEE_VARIANT_ID);
  assert.equal(summary.lines[0]?.name, "Studio Settee");
  assert.equal(summary.lines[0]?.quantity, 2);
  assert.equal(summary.estimatedTotal, 1895 * 2);
});

test("PI-5D2B Favorites/Recent/Collections stay Product/Variant based", () => {
  assert.equal(STAGE_FAVORITES_STORAGE_KEY, "vibode:stage-favorites/v1");
  assert.equal(
    favoriteKey(STAGE_STUDIO_SETTEE_PRODUCT_ID, STAGE_STUDIO_SETTEE_VARIANT_ID).includes(ASSET_C),
    false,
  );
  assert.deepEqual(
    rememberRecentlyUsed([], STAGE_STUDIO_SETTEE_PRODUCT_ID),
    [STAGE_STUDIO_SETTEE_PRODUCT_ID],
  );
  const collection = STAGE_SEED_CATALOG.collections.find((item) => item.collectionId === "col-vibode-picks");
  assert.deepEqual(collection?.productIds, [
    STAGE_STUDIO_SOFA_PRODUCT_ID,
    STAGE_STUDIO_SETTEE_PRODUCT_ID,
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
  ]);
  const favorites = source("lib/vibode-stage/favorites.ts");
  const query = source("lib/vibode-stage/catalog-query.ts");
  const context = source("components/stage/StageEditorContext.tsx");
  assert.doesNotMatch(favorites, /assetId/);
  assert.match(query, /recentlyUsedProductIds/);
  assert.match(query, /product\.collectionIds/);
  assert.match(context, /resolveStagePlacement/);
  assert.match(context, /rememberRecentlyUsed\(current, productId\)/);
  assert.match(context, /toggleFavoriteKeys\(current, productId, variantId\)/);
  const fromFavorite = resolveStagePlacement({
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.equal(fromFavorite?.assetId, ASSET_C);
});

test("PI-5D2B unavailable current Asset fails new Add and leaves existing Scene Objects", () => {
  const unavailableCatalog = createStageCatalogSnapshot({
    authority: "durable",
    products: STAGE_SEED_CATALOG.products,
    variants: STAGE_SEED_CATALOG.variants,
    assets: STAGE_SEED_ASSETS.map((asset) => (
      asset.assetId === ASSET_C ? { ...asset, status: "unavailable" } : asset
    )),
    collections: STAGE_SEED_CATALOG.collections,
  });
  assert.equal(
    resolveStagePlacement({
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      catalog: unavailableCatalog,
    }),
    null,
  );
  const existing = validatePersistedSceneObjects([
    setteeObject({ objectId: "so-existing-c", assetId: ASSET_C }),
  ]);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.objects[0]?.assetId, ASSET_C);
  assert.ok(furnitureAssetDefinition(ASSET_C));
});

test("PI-5D2B rollback C→A is a new forward association migration", () => {
  const repoRoot = tmpRepo();
  const originalSql = source(SETTEE_MIGRATION);
  writeFileSync(path.join(repoRoot, SETTEE_MIGRATION), originalSql);
  writeFileSync(
    path.join(repoRoot, VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
  );
  const result = retargetVariantCurrentAssetAssociation({
    variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    assetId: ASSET_A,
    repoRoot,
    currentAssociations: GENERATED_VARIANT_CURRENT_ASSETS,
    migrationTimestamp: "20260914235959",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.noop, false);
  assert.equal(readFileSync(path.join(repoRoot, SETTEE_MIGRATION), "utf8"), originalSql);
  assert.ok(result.written);
  const rollback = readFileSync(result.written.migration, "utf8");
  assert.match(rollback, new RegExp(ASSET_A.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(rollback, /20990101/);
  const parsed = parseVariantAssociationSql(rollback);
  assert.deepEqual([...new Set(parsed.assetIds)], [ASSET_A]);
  assert.deepEqual([...new Set(parsed.variantIds)], [STAGE_STUDIO_SETTEE_VARIANT_ID]);
});

test("PI-5D2B CLI exists, --check is dry-run, and unknown Variant writes nothing", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["vibode:retarget-variant"], "node --import tsx scripts/vibode-variant.ts");
  assert.equal(pkg.scripts["vibode:register-asset"]?.includes("scripts/vibode-asset.ts register"), true);
  assert.doesNotMatch(source("scripts/vibode-asset.ts"), /retarget-variant|variant-asset-association/);

  const before = snapshotFrozenAssets();
  const check = runCli([
    "--variant-id", STAGE_STUDIO_SETTEE_VARIANT_ID,
    "--product-id", STAGE_STUDIO_SETTEE_PRODUCT_ID,
    "--asset-id", ASSET_C,
    "--check",
  ]);
  assert.equal(check.status, 0, check.stderr);
  const checkPayload = JSON.parse(check.stdout) as { ok: boolean; noop: boolean; check: boolean };
  assert.equal(checkPayload.ok, true);
  assert.equal(checkPayload.noop, true);

  const unknown = runCli([
    "--variant-id", "var-missing",
    "--product-id", STAGE_STUDIO_SETTEE_PRODUCT_ID,
    "--asset-id", ASSET_C,
    "--migration-timestamp", "20990101000003",
  ]);
  assert.notEqual(unknown.status, 0);
  const unknownPayload = JSON.parse(unknown.stdout) as { ok: boolean; errors: { code: string }[] };
  assert.equal(unknownPayload.ok, false);
  assert.equal(unknownPayload.errors.some((error) => error.code === "UNKNOWN_VARIANT"), true);
  assert.deepEqual(snapshotFrozenAssets(), before);
});

test("PI-5D2B Asset intake, viewer, and PI-5D2A Asset C SQL stay frozen", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const cache = source("lib/afc-v2-runtime/furniture-template-cache.ts");
  const assets = source("lib/afc-v2-runtime/furniture-assets.ts");
  const runtime = source("lib/afc-v2-runtime/furniture-runtime.ts");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  const assetC = source(ASSET_C_MIGRATION);
  assert.match(viewer, /furnitureAssetDefinition/);
  assert.match(viewer, /templateCache\.template\(definition\.assetId\)/);
  assert.doesNotMatch(viewer, /from "@\/lib\/supabase/);
  assert.doesNotMatch(viewer, /stage-catalog|vibode_stage_variants|current_asset_id/);
  assert.doesNotMatch(cache, /vibode_stage_variants|stage-catalog/);
  assert.doesNotMatch(assets, /vibode_stage_variants|stage-catalog|createClient/);
  assert.doesNotMatch(runtime, /stage-catalog|current_asset_id/);
  assert.doesNotMatch(crud, /STAGE_SEED_VARIANTS|current_asset_id/);
  assert.doesNotMatch(persisted, /current_asset_id|stage-catalog/);
  assert.doesNotMatch(assetC, /vibode_stage_products|vibode_stage_variants|current_asset_id/);
  assert.doesNotMatch(source("scripts/vibode-variant.ts"), /validateFurnitureAssetFile|registerFurnitureAsset/);
});
