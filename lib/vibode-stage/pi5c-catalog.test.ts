import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createPi4bSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import { validatePersistedSceneObjects } from "@/lib/afc-v2-runtime/persisted-scene";
import {
  addSceneObject,
  createSceneObjectId,
} from "@/lib/afc-v2-runtime/scene-crud";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
} from "@/lib/afc-v2-runtime/types";
import {
  createPastedStageProduct,
  createPastedStageVariant,
  createStageCatalogSnapshot,
  fallbackProductIdForAsset,
  resolveStagePlacement,
  STAGE_PI4A_SOFA_ASSET,
  STAGE_SEED_CATALOG,
  STAGE_SEED_COLLECTIONS,
  STAGE_SEED_PRODUCTS,
  STAGE_SEED_VARIANTS,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_CHAIR_VARIANT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_VARIANT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_STUDIO_SOFA_VARIANT_ID,
  favoriteKey,
  stageAssetById,
  stageProductById,
  stageVariantById,
} from "./catalog";
import { filterStageCatalogProducts } from "./catalog-query";
import {
  assembleStageCatalogFromRows,
  FORBIDDEN_STAGE_CATALOG_TABLES,
  parseStageCatalogPayload,
  resolveLoadedStageCatalog,
  retargetVariantCurrentAsset,
  serializeStageCatalogPayload,
  STAGE_CATALOG_TABLES,
  stageCatalogRowsFromSnapshot,
} from "./catalog-store";
import { buildStageSummary, summaryGroupKey } from "./summary";

const ROOT = process.cwd();
const MIGRATION = "supabase/migrations/20260914120000_vibode_stage_catalog.sql";
const IMPROVED_ASSET_ID = "afc-v2-runtime/test-fixtures/pi4a-sofa-improved";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function durableCatalogFromSeed() {
  const assembled = assembleStageCatalogFromRows(
    stageCatalogRowsFromSnapshot(STAGE_SEED_CATALOG),
  );
  assert.ok(assembled);
  return assembled;
}

function identityRecord(catalog: ReturnType<typeof durableCatalogFromSeed>) {
  return {
    products: catalog.products.map((product) => ({
      productId: product.productId,
      name: product.name,
      brand: product.brand,
      retailer: product.retailer,
      imageUrl: product.imageUrl,
      priceAmount: product.priceAmount,
      priceCurrency: product.priceCurrency,
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId,
      source: product.source,
      defaultVariantId: product.defaultVariantId,
      collectionIds: [...product.collectionIds],
    })),
    variants: catalog.variants.map((variant) => ({
      variantId: variant.variantId,
      productId: variant.productId,
      assetId: variant.assetId,
      finishLabel: variant.finishLabel,
      sku: variant.sku,
      priceAmount: variant.priceAmount,
      priceCurrency: variant.priceCurrency,
      productUrl: variant.productUrl,
    })),
    assets: catalog.assets.map((asset) => ({
      assetId: asset.assetId,
      glbUrl: asset.glbUrl,
      authoredWidthM: asset.authoredWidthM,
      authoredHeightM: asset.authoredHeightM,
      authoredDepthM: asset.authoredDepthM,
      status: asset.status,
    })),
    collections: catalog.collections.map((collection) => ({
      collectionId: collection.collectionId,
      name: collection.name,
      owner: collection.owner,
      partnerName: collection.partnerName,
      productIds: [...collection.productIds],
    })),
  };
}

test("PI-5C durable catalog round-trips certified product / variant / asset / collection identity", () => {
  const durable = durableCatalogFromSeed();
  assert.equal(durable.authority, "durable");
  assert.deepEqual(identityRecord(durable), identityRecord(STAGE_SEED_CATALOG));
  assert.equal(durable.products.length, 3);
  assert.deepEqual(durable.products.map((product) => product.productId), [
    STAGE_STUDIO_SOFA_PRODUCT_ID,
    STAGE_STUDIO_SETTEE_PRODUCT_ID,
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
  ]);
  assert.deepEqual(durable.variants.map((variant) => variant.variantId), [
    STAGE_STUDIO_SOFA_VARIANT_ID,
    STAGE_STUDIO_SETTEE_VARIANT_ID,
    STAGE_STUDIO_CHAIR_VARIANT_ID,
  ]);
  assert.equal(durable.assets.length, 2);
  assert.equal(durable.assets[0]?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(durable.assets[0]?.glbUrl, AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH);
  assert.equal(durable.assets[0]?.status, "ready");
  assert.equal(durable.assets[1]?.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(
    durable.variants.find((variant) => variant.variantId === STAGE_STUDIO_SOFA_VARIANT_ID)?.assetId,
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  );
  assert.equal(
    durable.variants.find((variant) => variant.variantId === STAGE_STUDIO_SETTEE_VARIANT_ID)?.assetId,
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  );
  assert.equal(
    durable.variants.find((variant) => variant.variantId === STAGE_STUDIO_CHAIR_VARIANT_ID)?.assetId,
    AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  );
  const sofa = stageProductById(STAGE_STUDIO_SOFA_PRODUCT_ID, [], durable);
  const settee = stageProductById(STAGE_STUDIO_SETTEE_PRODUCT_ID, [], durable);
  const chair = stageProductById(STAGE_STUDIO_CHAIR_PRODUCT_ID, [], durable);
  assert.equal(sofa?.priceAmount, 2495);
  assert.equal(settee?.priceAmount, 1895);
  assert.equal(chair?.priceAmount, 895);
  assert.equal(sofa?.priceCurrency, "USD");
  assert.equal(sofa?.imageUrl, "/vibode-stage/studio-sofa.svg");
  assert.equal(settee?.imageUrl, "/vibode-stage/studio-settee.svg");
  assert.equal(chair?.imageUrl, "/vibode-stage/studio-chair.svg");
  assert.equal(sofa?.source, "vibode_curated");
  assert.deepEqual([...sofa?.collectionIds ?? []], ["col-vibode-picks", "col-modern-living"]);
  assert.deepEqual([...settee?.collectionIds ?? []], [
    "col-vibode-picks",
    "col-small-spaces",
    "col-modern-living",
  ]);
  assert.deepEqual([...chair?.collectionIds ?? []], ["col-vibode-picks", "col-small-spaces"]);
});

test("PI-5C numeric database strings still hydrate certified prices and authored metres", () => {
  const rows = stageCatalogRowsFromSnapshot(STAGE_SEED_CATALOG);
  const stringRows = {
    ...rows,
    products: rows.products.map((row) => ({ ...row, price_amount: "2495" })),
    variants: rows.variants.map((row) => ({ ...row, price_amount: String(row.price_amount) })),
    assets: rows.assets.map((row) => ({
      ...row,
      authored_width_m: "2.2",
      authored_height_m: "0.8",
      authored_depth_m: "0.9",
    })),
  };
  stringRows.products[0] = { ...stringRows.products[0], price_amount: "2495" };
  stringRows.products[1] = { ...stringRows.products[1], price_amount: "1895" };
  stringRows.products[2] = { ...stringRows.products[2], price_amount: "895" };
  const durable = assembleStageCatalogFromRows(stringRows);
  assert.ok(durable);
  assert.equal(durable.products[0]?.priceAmount, 2495);
  assert.equal(durable.products[1]?.priceAmount, 1895);
  assert.equal(durable.products[2]?.priceAmount, 895);
  assert.equal(durable.assets[0]?.authoredWidthM, 2.2);
  assert.equal(durable.assets[0]?.authoredHeightM, 0.8);
  assert.equal(durable.assets[0]?.authoredDepthM, 0.9);
});

test("PI-5C Catalog Add persists the same productId variantId assetId and uniformScale 1", () => {
  const durable = durableCatalogFromSeed();
  const cases = [
    {
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      objectId: "so-pi5c-sofa",
    },
    {
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
      objectId: "so-pi5c-settee",
    },
    {
      productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
      variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
      objectId: "so-pi5c-chair",
    },
  ] as const;

  let objects: ReturnType<typeof addSceneObject>["objects"] = [];
  for (const item of cases) {
    const placement = resolveStagePlacement({
      productId: item.productId,
      catalog: durable,
    });
    assert.ok(placement);
    assert.equal(placement.product.productId, item.productId);
    assert.equal(placement.variant.variantId, item.variantId);
    const expectedAssetId = item.productId === STAGE_STUDIO_CHAIR_PRODUCT_ID
      ? AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID
      : AFC_V2_RUNTIME_FURNITURE_ASSET_ID;
    assert.equal(placement.assetId, expectedAssetId);
    const added = addSceneObject({
      objects,
      assetId: placement.assetId,
      identity: {
        productId: placement.product.productId,
        variantId: placement.variant.variantId,
      },
      createObjectId: () => item.objectId,
    });
    assert.equal(added.ok, true);
    if (!added.ok) return;
    assert.equal(added.object.objectId, item.objectId);
    assert.equal(added.object.productId, item.productId);
    assert.equal(added.object.variantId, item.variantId);
    assert.equal(added.object.assetId, expectedAssetId);
    assert.equal(added.object.transform.uniformScale, 1);
    objects = added.objects;
  }
  assert.equal(createSceneObjectId(() => "pi5c-token"), "so-pi5c-token");
  const validated = validatePersistedSceneObjects(objects);
  assert.equal(validated.ok, true);
});

test("PI-5C Summary still groups by product+variant and keeps unlabeled sofa fallback", () => {
  const durable = durableCatalogFromSeed();
  const defaults = createPi4bSceneObjectDefinitions();
  const sofaA = defaults[0];
  const sofaB = defaults[1];
  assert.ok(sofaA && sofaB);
  const chairPlacement = resolveStagePlacement({
    productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
    catalog: durable,
  });
  assert.ok(chairPlacement);
  const summary = buildStageSummary({
    catalog: durable,
    objects: [
      sofaA,
      sofaB,
      {
        ...sofaA,
        objectId: "so-chair",
        productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
        variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
      },
    ],
  });
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.lines.length, 2);
  const sofaLine = summary.lines.find((line) => line.productId === STAGE_STUDIO_SOFA_PRODUCT_ID);
  const chairLine = summary.lines.find((line) => line.productId === STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(sofaLine?.quantity, 2);
  assert.equal(chairLine?.quantity, 1);
  assert.equal(summary.estimatedTotal, 2495 * 2 + 895);
  assert.equal(
    fallbackProductIdForAsset(AFC_V2_RUNTIME_FURNITURE_ASSET_ID),
    STAGE_STUDIO_SOFA_PRODUCT_ID,
  );
  assert.equal(sofaA.productId, undefined);
  assert.match(summaryGroupKey(sofaA), new RegExp(STAGE_STUDIO_SOFA_PRODUCT_ID));
});

test("PI-5C different products sharing one Asset do not collapse in Summary", () => {
  const durable = durableCatalogFromSeed();
  const sofa = resolveStagePlacement({ productId: STAGE_STUDIO_SOFA_PRODUCT_ID, catalog: durable });
  const settee = resolveStagePlacement({
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    catalog: durable,
  });
  const chair = resolveStagePlacement({
    productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
    catalog: durable,
  });
  assert.ok(sofa && settee && chair);
  assert.equal(sofa.assetId, settee.assetId);
  assert.notEqual(chair.assetId, sofa.assetId);
  assert.equal(sofa.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(chair.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  const summary = buildStageSummary({
    catalog: durable,
    objects: [
      {
        objectId: "so-a",
        assetId: sofa.assetId,
        transform: DEFAULT_WORLD_TRANSFORM,
        productId: sofa.product.productId,
        variantId: sofa.variant.variantId,
      },
      {
        objectId: "so-b",
        assetId: settee.assetId,
        transform: DEFAULT_WORLD_TRANSFORM,
        productId: settee.product.productId,
        variantId: settee.variant.variantId,
      },
      {
        objectId: "so-c",
        assetId: chair.assetId,
        transform: DEFAULT_WORLD_TRANSFORM,
        productId: chair.product.productId,
        variantId: chair.variant.variantId,
      },
    ],
  });
  assert.equal(summary.lines.length, 3);
  assert.equal(summary.estimatedTotal, 2495 + 1895 + 895);
});

test("PI-5C Variant can move to Asset A2 while a Scene Object keeps Asset A1", () => {
  const durable = durableCatalogFromSeed();
  const improved = {
    assetId: IMPROVED_ASSET_ID,
    glbUrl: "/afc-v2-runtime/test-fixtures/pi4a-sofa-improved.glb",
    authoredWidthM: 2.2,
    authoredHeightM: 0.8,
    authoredDepthM: 0.9,
    status: "ready" as const,
  };
  const withImprovedAsset = createStageCatalogSnapshot({
    authority: "durable",
    products: durable.products,
    variants: durable.variants,
    assets: [...durable.assets, improved],
    collections: durable.collections,
  });
  const moved = retargetVariantCurrentAsset(
    withImprovedAsset,
    STAGE_STUDIO_SOFA_VARIANT_ID,
    IMPROVED_ASSET_ID,
  );
  assert.ok(moved);
  const variant = stageVariantById(STAGE_STUDIO_SOFA_VARIANT_ID, [], moved);
  assert.equal(variant?.assetId, IMPROVED_ASSET_ID);
  const persisted = validatePersistedSceneObjects([
    {
      objectId: "so-existing-sofa",
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: DEFAULT_WORLD_TRANSFORM,
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    },
  ]);
  assert.equal(persisted.ok, true);
  if (!persisted.ok) return;
  assert.equal(persisted.objects[0]?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(persisted.objects[0]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(persisted.objects[0]?.variantId, STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.equal(
    stageAssetById(AFC_V2_RUNTIME_FURNITURE_ASSET_ID, moved)?.assetId,
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  );
  assert.notEqual(variant?.assetId, persisted.objects[0]?.assetId);
});

test("PI-5C unknown product variant missing and unready assets fail safely", () => {
  const durable = durableCatalogFromSeed();
  assert.equal(
    resolveStagePlacement({ productId: "prod-does-not-exist", catalog: durable }),
    null,
  );
  assert.equal(
    resolveStagePlacement({
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: "var-does-not-exist",
      catalog: durable,
    }),
    null,
  );
  const missingAsset = retargetVariantCurrentAsset(
    durable,
    STAGE_STUDIO_SOFA_VARIANT_ID,
    null,
  );
  assert.ok(missingAsset);
  assert.equal(
    resolveStagePlacement({ productId: STAGE_STUDIO_SOFA_PRODUCT_ID, catalog: missingAsset }),
    null,
  );
  const unready = createStageCatalogSnapshot({
    authority: "durable",
    products: durable.products,
    variants: durable.variants,
    assets: [{ ...STAGE_PI4A_SOFA_ASSET, status: "unavailable" }],
    collections: durable.collections,
  });
  assert.equal(
    resolveStagePlacement({ productId: STAGE_STUDIO_SOFA_PRODUCT_ID, catalog: unready }),
    null,
  );
  assert.equal(stageProductById("prod-does-not-exist", [], durable), null);
  assert.equal(stageVariantById("var-does-not-exist", [], durable), null);
});

test("PI-5C pasted products stay session-only and non-placeable", () => {
  const durable = durableCatalogFromSeed();
  const product = createPastedStageProduct({
    productId: "prod-pasted-example",
    name: "Pasted product",
    brand: "Pasted",
    imageUrl: "https://example.test/p.jpg",
    productUrl: "https://example.test/p",
  });
  const variant = createPastedStageVariant(product);
  assert.equal(product.source, "user_pasted");
  assert.equal(stageProductById(product.productId, [], durable), null);
  assert.equal(
    resolveStagePlacement({
      productId: product.productId,
      extras: [product],
      extraVariants: [variant],
      catalog: durable,
    }),
    null,
  );
  const durableIds = new Set(durable.products.map((item) => item.productId));
  assert.equal(durableIds.has(product.productId), false);
  const withPastedRow = stageCatalogRowsFromSnapshot(STAGE_SEED_CATALOG);
  const assembled = assembleStageCatalogFromRows({
    ...withPastedRow,
    products: [
      ...withPastedRow.products,
      {
        product_id: product.productId,
        name: product.name,
        brand: product.brand,
        retailer: product.retailer,
        image_url: product.imageUrl,
        product_url: product.productUrl,
        price_amount: null,
        price_currency: "USD",
        category_id: product.categoryId,
        subcategory_id: product.subcategoryId,
        source: "user_pasted",
        default_variant_id: product.defaultVariantId,
        status: "active",
        sort_order: 99,
      },
    ],
  });
  assert.ok(assembled);
  assert.equal(assembled.products.some((item) => item.productId === product.productId), false);
});

test("PI-5C durable empty or failed loads use an explicit seed fixture fallback", () => {
  const empty = resolveLoadedStageCatalog({ durable: null, reason: "durable_empty" });
  assert.equal(empty.authority, "seed_fixture");
  assert.equal(empty.fallbackReason, "durable_empty");
  assert.equal(empty.catalog.products.length, 3);
  const failed = resolveLoadedStageCatalog({
    durable: null,
    reason: "durable_load_failed",
  });
  assert.equal(failed.fallbackReason, "durable_load_failed");
  const loaded = resolveLoadedStageCatalog({ durable: durableCatalogFromSeed() });
  assert.equal(loaded.authority, "durable");
  assert.equal(loaded.fallbackReason, null);
  assert.equal(parseStageCatalogPayload({ ok: false }), null);
  const payload = serializeStageCatalogPayload(loaded);
  const parsed = parseStageCatalogPayload(payload);
  assert.equal(parsed?.authority, "durable");
  assert.equal(parsed?.catalog.products.length, 3);
});

test("PI-5C Catalog browse still filters durable products without scene presence", () => {
  const durable = durableCatalogFromSeed();
  const living = filterStageCatalogProducts({
    products: durable.products,
    mode: "browse",
    query: "",
    categoryId: "living-room",
    subcategoryId: "chairs",
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(living.length, 1);
  assert.equal(living[0]?.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  const picks = filterStageCatalogProducts({
    products: durable.products,
    mode: "collections",
    query: "",
    categoryId: null,
    subcategoryId: null,
    collectionId: "col-vibode-picks",
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(picks.length, 3);
});

test("PI-5C migration seeds the certified STAGE identities and stays a public catalog", () => {
  const sql = source(MIGRATION);
  const lower = sql.toLowerCase();
  for (const table of Object.values(STAGE_CATALOG_TABLES)) {
    assert.match(sql, new RegExp(`create table public.${table}`));
    assert.match(sql, new RegExp(`alter table public.${table} enable row level security`));
    assert.match(sql, new RegExp(`grant select on table public.${table} to anon, authenticated`));
  }
  assert.match(sql, /current_asset_id text null references public.vibode_stage_assets/);
  assert.match(sql, /on delete set null/);
  assert.match(sql, /vibode_stage_products_default_variant_fkey/);
  assert.match(sql, /deferrable initially deferred/);
  assert.doesNotMatch(sql, /product_id uuid primary key/);
  assert.doesNotMatch(sql, /variant_id uuid primary key/);
  assert.doesNotMatch(sql, /asset_id uuid primary key/);
  for (const id of [
    STAGE_STUDIO_SOFA_PRODUCT_ID,
    STAGE_STUDIO_SETTEE_PRODUCT_ID,
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
    STAGE_STUDIO_SOFA_VARIANT_ID,
    STAGE_STUDIO_SETTEE_VARIANT_ID,
    STAGE_STUDIO_CHAIR_VARIANT_ID,
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    "col-vibode-picks",
    "col-small-spaces",
    "col-modern-living",
  ]) {
    assert.match(sql, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(sql, /2495/);
  assert.match(sql, /1895/);
  assert.match(sql, /895/);
  assert.match(sql, /Warm oak/);
  assert.match(sql, /Stone linen/);
  assert.match(sql, /Saddle leather/);
  assert.match(sql, /\/vibode-stage\/studio-sofa.svg/);
  assert.match(sql, /source in \('vibode_curated', 'partner_catalog', 'user_pasted'\)/);
  assert.match(sql, /to service_role/);
  for (const forbidden of FORBIDDEN_STAGE_CATALOG_TABLES) {
    assert.equal(lower.includes(`from public.${forbidden}`), false);
    assert.equal(lower.includes(`references public.${forbidden}`), false);
  }
});

test("PI-5C STAGE read path is a server catalog loader and does not change AFC runtime", () => {
  const route = source("app/api/vibode/stage-catalog/route.ts");
  const store = source("lib/vibode-stage/catalog-persistence.server.ts");
  const mapper = source("lib/vibode-stage/catalog-store.ts");
  const context = source("components/stage/StageEditorContext.tsx");
  const catalog = source("lib/vibode-stage/catalog.ts");
  const runtimeAssets = source("lib/afc-v2-runtime/furniture-assets.ts");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");

  assert.match(route, /loadStageCatalogFromEnv/);
  assert.match(route, /serializeStageCatalogPayload/);
  assert.match(store, /getServiceRoleSupabaseClient/);
  assert.match(store, /STAGE_CATALOG_TABLES/);
  assert.match(store, /current_asset_id/);
  assert.match(mapper, /vibode_stage_products/);
  assert.match(mapper, /current_asset_id/);
  assert.match(context, /\/api\/vibode\/stage-catalog/);
  assert.match(context, /parseStageCatalogPayload/);
  assert.match(context, /addFurnitureWithIdentity/);
  assert.doesNotMatch(catalog, /vibode_user_furniture|vibode_furniture_collection_items/);
  assert.doesNotMatch(store, /vibode_user_furniture|vibode_furniture_collection_items/);
  assert.doesNotMatch(route, /executeAfcV2Analysis|furniture-glb-loader/);
  assert.match(runtimeAssets, /AFC_V2_RUNTIME_FURNITURE_ASSET_ID/);
  assert.match(runtimeAssets, /PI4A_SOFA_FURNITURE_ASSET/);
  assert.doesNotMatch(runtimeAssets, /IMPROVED_ASSET|multi-glb|signed url/i);
  assert.match(crud, /uniformScale: 1/);
  assert.match(crud, /function createSceneObjectId/);
  assert.equal(STAGE_SEED_PRODUCTS.length, 3);
  assert.equal(STAGE_SEED_VARIANTS.length, 3);
  assert.equal(STAGE_SEED_COLLECTIONS.length, 3);
});
