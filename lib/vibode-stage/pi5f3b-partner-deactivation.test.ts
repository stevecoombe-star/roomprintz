import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import { addSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import { PI5F2_COFFEE_TABLE_ASSET_ID } from "@/lib/afc-v2-runtime/pi5f2-demo-coffee-table-geometry";
import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";

import {
  activeStageVariantsForProduct,
  createStageCatalogSnapshot,
  favoriteKey,
  resolveStagePlacement,
  resolveStagePlacementResult,
  STAGE_SEED_PRODUCTS,
  stageProductById,
  stageVariantById,
  stageVariantsForProduct,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import {
  assembleStageCatalogFromRows,
  stageCatalogRowsFromSnapshot,
} from "./catalog-store";
import { GENERATED_REGISTERED_PRODUCTS } from "./catalog-commercial.generated";
import { toggleFavoriteKeys } from "./favorites";
import { detectPartnerCatalogDrift } from "./partner-catalog-drift";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_LOUNGE_CHAIR_VARIANT_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
  DEMO_SOFA_STONE_VARIANT_ID,
  isPartnerCatalogMigrationFileName,
} from "./partner-catalog";
import { detectPartnerCatalogSyncDrift } from "./partner-catalog-sync-drift";
import {
  DEMO_COFFEE_TABLE_WALNUT_PRICE,
  DEMO_COFFEE_TABLE_WALNUT_SKU,
  DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
  parsePartnerCatalogSyncSql,
  planPartnerCatalogSync,
  type FoldedPartnerCatalogState,
  type PartnerCatalogSyncDocument,
} from "./partner-catalog-sync";
import {
  PI5F3A_SYNC_BATCH_ID,
  PI5F3A_SYNC_JSON_RELATIVE_PATH,
  PI5F3A_SYNC_MIGRATION_TIMESTAMP,
  PI5F3A_SYNC_SQL_SLUG,
  PI5F3B_SYNC_BATCH_ID,
  PI5F3B_SYNC_JSON_RELATIVE_PATH,
  PI5F3B_SYNC_MIGRATION_TIMESTAMP,
  PI5F3B_SYNC_SQL_SLUG,
  PI5F3B_VARIANT_STATUS_MIGRATION_FILE,
  PI5F3C_SYNC_BATCH_ID,
  PARTNER_SYNC_DOCUMENTS,
} from "./partner-sync-documents";
import {
  DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
  DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
  DEMO_COFFEE_TABLE_PRODUCT_ID,
  DEMO_SIDE_TABLE_PRODUCT_ID,
} from "./partner-package";
import { detectProductVariantRegistrationDrift } from "./product-variant-drift";
import { COMMERCIAL_SEED_RELATIVE_PATH } from "./product-variant-register";
import { buildStageSummary } from "./summary";
import {
  detectVariantAssetAssociationDrift,
  isVariantAssociationMigrationFileName,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
} from "./variant-asset-association";

const ROOT = process.cwd();
const FROZEN_SHA = "592b167c4160893e150965be702f52b83568a35f";
const F3A_SQL =
  `supabase/migrations/${PI5F3A_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3A_SYNC_SQL_SLUG}.sql`;
const F3B_SQL =
  `supabase/migrations/${PI5F3B_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3B_SYNC_SQL_SLUG}.sql`;
const VARIANT_STATUS_SQL =
  `supabase/migrations/${PI5F3B_VARIANT_STATUS_MIGRATION_FILE}`;
const BLACK_SKU = "DFC-COFFEE-02";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function gitShow(relativePath: string): string {
  const result = spawnSync("git", ["show", `${FROZEN_SHA}:${relativePath}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function proofRaw(): unknown {
  return JSON.parse(source(PI5F3B_SYNC_JSON_RELATIVE_PATH));
}

function proofDocument(): PartnerCatalogSyncDocument {
  const parsed = parsePartnerCatalogSyncJson(proofRaw());
  assert.equal(parsed.ok, true, JSON.stringify(parsed.ok ? null : parsed.issues));
  if (!parsed.ok) throw new Error("proof sync JSON invalid");
  return parsed.document;
}

function hasCode(
  result: { issues: readonly { code: string }[] },
  code: string,
): boolean {
  return result.issues.some((item) => item.code === code);
}

function preF3bState(): FoldedPartnerCatalogState {
  const folded = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3B_SYNC_BATCH_ID,
  });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("pre-F3B fold failed");
  return folded.state;
}

function afterF3bState(): FoldedPartnerCatalogState {
  const folded = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3C_SYNC_BATCH_ID,
  });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("post-F3B fold failed");
  return folded.state;
}

function emptyPatch(input: {
  products?: PartnerCatalogSyncDocument["products"];
  variants?: PartnerCatalogSyncDocument["variants"];
  collections?: PartnerCatalogSyncDocument["collections"];
} = {}): PartnerCatalogSyncDocument {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [], ...input.products },
    variants: { create: [], update: [], deactivate: [], reactivate: [], ...input.variants },
    collections: { update: [], membershipAdd: [], membershipRemove: [], ...input.collections },
  };
}

function planPatch(document: PartnerCatalogSyncDocument, current = preF3bState()) {
  return planPartnerCatalogSync({
    current,
    document,
    repoRoot: ROOT,
    sqlSlug: PI5F3B_SYNC_SQL_SLUG,
    migrationTimestamp: PI5F3B_SYNC_MIGRATION_TIMESTAMP,
  });
}

function catalogQuery(
  catalog: ReturnType<typeof overlayFoldedPartnerCatalog>,
  input: Partial<Parameters<typeof filterStageCatalogProducts>[0]> = {},
) {
  return filterStageCatalogProducts({
    products: catalog.products,
    variants: catalog.variants,
    partners: catalog.partners,
    catalog,
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

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f3b-sync-"));
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  return repoRoot;
}

function runCli(args: string[], cwd = ROOT) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/vibode-partner-catalog-sync.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

test("PI-5F3B frozen provenance is 592b167 and F3A artifacts stay byte-identical", () => {
  assert.equal(source(PI5F3A_SYNC_JSON_RELATIVE_PATH), gitShow(PI5F3A_SYNC_JSON_RELATIVE_PATH));
  assert.equal(source(F3A_SQL), gitShow(F3A_SQL));
  assert.equal(source(COMMERCIAL_SEED_RELATIVE_PATH), gitShow(COMMERCIAL_SEED_RELATIVE_PATH));
  assert.equal(source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH), gitShow(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH));
  assert.equal(PARTNER_SYNC_DOCUMENTS[0]?.batchId, PI5F3A_SYNC_BATCH_ID);
  assert.equal(PARTNER_SYNC_DOCUMENTS[1]?.batchId, PI5F3B_SYNC_BATCH_ID);
  assert.equal(PARTNER_SYNC_DOCUMENTS[1]?.sqlSlug, PI5F3B_SYNC_SQL_SLUG);
  assert.equal(existsSync(path.join(ROOT, VARIANT_STATUS_SQL)), true);
  assert.equal(existsSync(path.join(ROOT, F3B_SQL)), true);
  assert.equal(isPartnerCatalogMigrationFileName(path.basename(F3B_SQL)), false);
  assert.equal(isVariantAssociationMigrationFileName(path.basename(VARIANT_STATUS_SQL)), false);
});

test("PI-5F3B pre-state from F1+F2+F3A is fully active and fold is deterministic", () => {
  const first = preF3bState();
  const second = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3B_SYNC_BATCH_ID,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(first, second.state);
  assert.equal(first.products.length, 4);
  assert.equal(first.variants.length, 7);
  for (const product of first.products) {
    assert.equal(product.status ?? "active", "active");
  }
  for (const variant of first.variants) {
    assert.equal(variant.status ?? "active", "active");
  }
  const coffee = first.variants.filter((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID);
  assert.equal(coffee.length, 3);
  const black = first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  assert.equal(black?.priceAmount, 449);
});

test("PI-5F3B proof patch parses, snapshot/generic status still fail, omission is no-op", () => {
  const parsed = parsePartnerCatalogSyncJson(proofRaw());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.mode, "patch");
  assert.equal(parsed.document.products.deactivate?.[0]?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(parsed.document.variants.deactivate?.[0]?.variantId, DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  const snapshot = parsePartnerCatalogSyncJson({ ...proofRaw() as object, mode: "snapshot" });
  assert.equal(snapshot.ok, false);
  assert.equal(hasCode(snapshot, "UNSUPPORTED_OPERATION"), true);
  const productStatus = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, status: "inactive" }] },
  });
  assert.equal(productStatus.ok, false);
  assert.equal(hasCode(productStatus, "UNSUPPORTED_OPERATION"), true);
  const variantStatus = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    variants: { update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, status: "inactive" }] },
  });
  assert.equal(variantStatus.ok, false);
  assert.equal(hasCode(variantStatus, "UNSUPPORTED_OPERATION"), true);
  const omitted = planPatch(emptyPatch());
  assert.equal(omitted.ok, true);
  assert.equal(omitted.noOp, true);
  assert.equal(omitted.sqlPlan, null);
});

test("PI-5F3B Product/Variant deactivate is valid, idempotent, and does not cascade", () => {
  const valid = planPatch(proofDocument());
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  assert.equal(valid.noOp, false);
  assert.equal(valid.productDeactivations[0]?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(valid.variantDeactivations[0]?.variantId, DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  assert.equal(valid.productUpdates.length, 0);
  assert.equal(valid.variantUpdates.length, 0);
  const sofa = valid.nextState?.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  const natural = valid.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  const stone = valid.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  assert.equal(sofa?.status, "inactive");
  assert.equal(natural?.status ?? "active", "active");
  assert.equal(stone?.status ?? "active", "active");
  const again = planPatch(proofDocument(), valid.nextState!);
  assert.equal(again.ok, true, JSON.stringify(again.issues));
  assert.equal(again.noOp, true);
  assert.equal(again.sqlPlan, null);
});

test("PI-5F3B Product/Variant reactivate is valid, idempotent, and allowed under inactive Product", () => {
  const after = afterF3bState();
  const product = planPatch(emptyPatch({
    products: { update: [], deactivate: [], reactivate: [{ productId: DEMO_SOFA_PRODUCT_ID }] },
  }), after);
  assert.equal(product.ok, true, JSON.stringify(product.issues));
  assert.equal(product.productReactivations[0]?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(product.nextState?.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "active");
  const productAgain = planPatch(emptyPatch({
    products: { update: [], deactivate: [], reactivate: [{ productId: DEMO_SOFA_PRODUCT_ID }] },
  }), product.nextState!);
  assert.equal(productAgain.ok, true);
  assert.equal(productAgain.noOp, true);

  const variant = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [], reactivate: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID }] },
  }), after);
  assert.equal(variant.ok, true, JSON.stringify(variant.issues));
  assert.equal(variant.variantReactivations[0]?.variantId, DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  const variantAgain = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [], reactivate: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID }] },
  }), variant.nextState!);
  assert.equal(variantAgain.ok, true);
  assert.equal(variantAgain.noOp, true);

  const stoneOff = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [{ variantId: DEMO_SOFA_STONE_VARIANT_ID }], reactivate: [] },
  }), after);
  assert.equal(stoneOff.ok, true, JSON.stringify(stoneOff.issues));
  const stoneOn = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [], reactivate: [{ variantId: DEMO_SOFA_STONE_VARIANT_ID }] },
  }), stoneOff.nextState!);
  assert.equal(stoneOn.ok, true, JSON.stringify(stoneOn.issues));
  assert.equal(stoneOn.nextState?.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "inactive");
  assert.equal(stoneOn.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID)?.status, "active");
});

test("PI-5F3B default Variant and last-active Variant rules are exact", () => {
  const defaultIllegal = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [{ variantId: DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID }], reactivate: [] },
  }));
  assert.equal(defaultIllegal.ok, false);
  assert.equal(hasCode(defaultIllegal, "DEFAULT_VARIANT_INACTIVE"), true);
  assert.equal(defaultIllegal.sqlPlan, null);

  const defaultPaired = planPatch(emptyPatch({
    products: {
      update: [{
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        defaultVariantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
        priceAmount: DEMO_COFFEE_TABLE_WALNUT_PRICE,
      }],
      deactivate: [],
      reactivate: [],
    },
    variants: { create: [], update: [], deactivate: [{ variantId: DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID }], reactivate: [] },
  }));
  assert.equal(defaultPaired.ok, true, JSON.stringify(defaultPaired.issues));
  assert.equal(
    defaultPaired.nextState?.products.find((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID)?.defaultVariantId,
    DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  );

  const lastIllegal = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [{ variantId: DEMO_LOUNGE_CHAIR_VARIANT_ID }], reactivate: [] },
  }));
  assert.equal(lastIllegal.ok, false);
  assert.equal(hasCode(lastIllegal, "LAST_ACTIVE_VARIANT"), true);
  assert.equal(lastIllegal.sqlPlan, null);

  const lastPaired = planPatch(emptyPatch({
    products: { update: [], deactivate: [{ productId: DEMO_LOUNGE_CHAIR_PRODUCT_ID }], reactivate: [] },
    variants: { create: [], update: [], deactivate: [{ variantId: DEMO_LOUNGE_CHAIR_VARIANT_ID }], reactivate: [] },
  }));
  assert.equal(lastPaired.ok, true, JSON.stringify(lastPaired.issues));
  assert.equal(lastPaired.nextState?.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)?.status, "inactive");
  assert.equal(lastPaired.nextState?.variants.find((item) => item.variantId === DEMO_LOUNGE_CHAIR_VARIANT_ID)?.status, "inactive");
});

test("PI-5F3B Product reactivate requires an active default and Variant reactivate requires a ready Asset", () => {
  const after = afterF3bState();
  const defaultOff = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [{ variantId: DEMO_SOFA_DEFAULT_VARIANT_ID }], reactivate: [] },
  }), after);
  assert.equal(defaultOff.ok, true, JSON.stringify(defaultOff.issues));
  const reactivate = planPatch(emptyPatch({
    products: { update: [], deactivate: [], reactivate: [{ productId: DEMO_SOFA_PRODUCT_ID }] },
  }), defaultOff.nextState!);
  assert.equal(reactivate.ok, false);
  assert.equal(hasCode(reactivate, "DEFAULT_VARIANT_INACTIVE"), true);
  assert.equal(reactivate.sqlPlan, null);

  const brokenAssets = overlayFoldedPartnerCatalog(after);
  const unavailable = createStageCatalogSnapshot({
    authority: brokenAssets.authority,
    fallbackReason: brokenAssets.fallbackReason,
    products: brokenAssets.products,
    variants: brokenAssets.variants,
    collections: brokenAssets.collections,
    partners: brokenAssets.partners,
    assets: brokenAssets.assets.map((asset) => (
      asset.assetId === PI5F2_COFFEE_TABLE_ASSET_ID ? { ...asset, status: "unavailable" } : asset
    )),
  });
  const assetFail = planPartnerCatalogSync({
    current: after,
    document: emptyPatch({
      variants: { create: [], update: [], deactivate: [], reactivate: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID }] },
    }),
    repoRoot: ROOT,
    catalog: unavailable,
  });
  assert.equal(assetFail.ok, false);
  assert.equal(hasCode(assetFail, "UNAVAILABLE_ASSET"), true);
  assert.equal(assetFail.sqlPlan, null);
});

test("PI-5F3B inactive SKU stays reserved and currentAssetId retarget still fails", () => {
  const after = afterF3bState();
  const stolen = planPatch(emptyPatch({
    variants: {
      create: [{
        variantId: "var-demo-furniture-co-demo-coffee-table-oak",
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        finishLabel: "Oak",
        sku: BLACK_SKU,
        priceAmount: 399,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
  }), after);
  assert.equal(stolen.ok, false);
  assert.equal(hasCode(stolen, "DUPLICATE_SKU"), true);
  const ownSku = planPatch(emptyPatch({
    variants: { create: [], update: [], deactivate: [], reactivate: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID }] },
  }), after);
  assert.equal(ownSku.ok, true, JSON.stringify(ownSku.issues));
  const retarget = planPatch(emptyPatch({
    variants: {
      create: [],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }],
      deactivate: [],
      reactivate: [],
    },
  }), after);
  assert.equal(retarget.ok, false);
  assert.equal(hasCode(retarget, "ASSET_RETARGET_REQUIRED"), true);
});

test("PI-5F3B snapshot retains inactive identities while discovery, selector, and Add gate shrink", () => {
  const before = overlayFoldedPartnerCatalog(preF3bState());
  const afterState = afterF3bState();
  const catalog = overlayFoldedPartnerCatalog(afterState);
  assert.equal(afterState.products.length, 4);
  assert.equal(afterState.variants.length, 7);
  assert.equal(catalog.products.length, before.products.length);
  assert.equal(catalog.variants.length, before.variants.length);
  const sofa = stageProductById(DEMO_SOFA_PRODUCT_ID, [], catalog);
  const black = stageVariantById(DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, [], catalog);
  const coffee = stageProductById(DEMO_COFFEE_TABLE_PRODUCT_ID, [], catalog);
  assert.equal(sofa?.status, "inactive");
  assert.equal(sofa?.name, "Demo Sofa");
  assert.equal(black?.status, "inactive");
  assert.equal(black?.priceAmount, 449);
  assert.equal(coffee?.status ?? "active", "active");
  assert.equal(coffee?.defaultVariantId, DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID);

  const assembled = assembleStageCatalogFromRows(stageCatalogRowsFromSnapshot(catalog));
  assert.ok(assembled);
  assert.equal(assembled.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "inactive");
  assert.equal(assembled.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID)?.status, "inactive");

  const browse = catalogQuery(catalog);
  assert.equal(browse.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);
  assert.equal(browse.some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);
  assert.equal(browse.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), true);
  assert.equal(browse.some((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID), true);
  assert.equal(STAGE_SEED_PRODUCTS.every((product) => (
    catalog.products.some((item) => item.productId === product.productId)
  )), true);

  const sofaSearch = catalogQuery(catalog, { query: "Sofa" });
  assert.equal(sofaSearch.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);

  const living = afterState.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.equal(living?.productIds.includes(DEMO_SOFA_PRODUCT_ID), true);
  const collectionUi = catalogQuery(catalog, {
    mode: "collections",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
  });
  assert.equal(collectionUi.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);

  const allCoffee = stageVariantsForProduct(DEMO_COFFEE_TABLE_PRODUCT_ID, [], catalog);
  const activeCoffee = activeStageVariantsForProduct(DEMO_COFFEE_TABLE_PRODUCT_ID, [], catalog);
  assert.equal(allCoffee.some((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID), true);
  assert.deepEqual(activeCoffee.map((item) => item.variantId).sort(), [
    DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
    DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  ].sort());

  assert.equal(resolveStagePlacement({
    productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
    variantId: DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
    catalog,
  })?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(resolveStagePlacement({
    productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
    variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
    catalog,
  })?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(resolveStagePlacement({ productId: DEMO_SOFA_PRODUCT_ID, catalog }), null);
  const sofaGate = resolveStagePlacementResult({ productId: DEMO_SOFA_PRODUCT_ID, catalog });
  assert.equal(sofaGate.ok, false);
  if (!sofaGate.ok) assert.equal(sofaGate.code, "PRODUCT_INACTIVE");
  assert.equal(resolveStagePlacement({
    productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
    variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    catalog,
  }), null);
  const blackGate = resolveStagePlacementResult({
    productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
    variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    catalog,
  });
  assert.equal(blackGate.ok, false);
  if (!blackGate.ok) assert.equal(blackGate.code, "VARIANT_INACTIVE");
});

test("PI-5F3B Favorites and Recent hide inactive identities without mutating stored keys", () => {
  const catalog = overlayFoldedPartnerCatalog(afterF3bState());
  const sofaKey = favoriteKey(DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_DEFAULT_VARIANT_ID);
  const blackKey = favoriteKey(DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  const walnutKey = favoriteKey(DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID);
  const sofaKeys = toggleFavoriteKeys(new Set(), DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(sofaKeys.has(sofaKey), true);
  const sofaFavorites = catalogQuery(catalog, { mode: "favorites", favoriteKeys: sofaKeys });
  assert.equal(sofaFavorites.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);
  assert.equal(sofaKeys.has(sofaKey), true);

  const blackOnly = toggleFavoriteKeys(new Set(), DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  assert.equal(blackOnly.has(blackKey), true);
  const blackFavorites = catalogQuery(catalog, { mode: "favorites", favoriteKeys: blackOnly });
  assert.equal(blackFavorites.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), false);
  assert.equal(blackOnly.has(blackKey), true);

  const mixed = toggleFavoriteKeys(blackOnly, DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID);
  const mixedFavorites = catalogQuery(catalog, { mode: "favorites", favoriteKeys: mixed });
  assert.equal(mixedFavorites.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), true);
  assert.equal(mixed.has(blackKey), true);
  assert.equal(mixed.has(walnutKey), true);

  const recentIds = rememberRecentlyUsed([DEMO_SOFA_PRODUCT_ID, DEMO_COFFEE_TABLE_PRODUCT_ID], DEMO_COFFEE_TABLE_PRODUCT_ID);
  assert.deepEqual(recentIds, [DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_SOFA_PRODUCT_ID]);
  const recent = catalogQuery(catalog, { mode: "recently_used", recentlyUsedProductIds: recentIds });
  assert.equal(recent.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);
  assert.equal(recent.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), true);
  assert.deepEqual(recentIds, [DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_SOFA_PRODUCT_ID]);
});

test("PI-5F3B Summary still resolves inactive Product/Variant and marks lines non-shoppable", () => {
  const catalog = overlayFoldedPartnerCatalog(afterF3bState());
  const sofaPlaced = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: {
      productId: DEMO_SOFA_PRODUCT_ID,
      variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    },
    createObjectId: () => "so-sofa",
  });
  assert.equal(sofaPlaced.ok, true);
  if (!sofaPlaced.ok) return;
  const sofaSummary = buildStageSummary({ objects: [sofaPlaced.object], catalog });
  assert.equal(sofaSummary.lines[0]?.name, "Demo Sofa");
  assert.equal(sofaSummary.lines[0]?.brand, "Demo Furniture Co.");
  assert.equal(sofaSummary.lines[0]?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.notEqual(sofaSummary.lines[0]?.name, "Placed item");
  assert.equal(sofaSummary.lines[0]?.shoppable, false);
  assert.equal(sofaSummary.shoppable, false);

  const blackPlaced = addSceneObject({
    objects: [sofaPlaced.object],
    assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
    identity: {
      productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
      variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    },
    createObjectId: () => "so-black",
  });
  assert.equal(blackPlaced.ok, true);
  if (!blackPlaced.ok) return;
  assert.equal(blackPlaced.object.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  const mixed = buildStageSummary({ objects: blackPlaced.objects, catalog });
  const blackLine = mixed.lines.find((line) => line.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  assert.equal(blackLine?.name, "Demo Coffee Table");
  assert.equal(blackLine?.variantLabel, "Black");
  assert.equal(blackLine?.unitPrice, 449);
  assert.equal(blackLine?.shoppable, false);
  assert.notEqual(blackLine?.name, "Placed item");
  assert.equal(sofaPlaced.object.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(blackPlaced.object.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);

  const restoredSummary = buildStageSummary({ objects: blackPlaced.objects, catalog });
  assert.equal(restoredSummary.lines.some((line) => line.name === "Demo Sofa"), true);
  assert.equal(restoredSummary.lines.some((line) => line.unitPrice === 449), true);
  assert.equal(blackPlaced.objects[0]?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(blackPlaced.objects[1]?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(blackPlaced.objects[0]?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(blackPlaced.objects[1]?.variantId, DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
});

test("PI-5F3B generated SQL is status-only, guarded, and has no identity/Asset/Scene DML", () => {
  const sql = source(F3B_SQL);
  const parsed = parsePartnerCatalogSyncSql(sql);
  assert.equal(parsed.hasBegin, true);
  assert.equal(parsed.hasCommit, true);
  assert.equal(parsed.mentionsStaleSync, true);
  assert.deepEqual([...parsed.statusUpdatedProductIds], [DEMO_SOFA_PRODUCT_ID]);
  assert.deepEqual([...parsed.statusUpdatedVariantIds], [DEMO_COFFEE_TABLE_BLACK_VARIANT_ID]);
  assert.deepEqual([...parsed.updatedProductIds], []);
  assert.deepEqual([...parsed.updatedVariantIds], []);
  assert.equal(parsed.productStatusTransitions[0]?.from, "active");
  assert.equal(parsed.productStatusTransitions[0]?.to, "inactive");
  assert.equal(parsed.variantStatusTransitions[0]?.from, "active");
  assert.equal(parsed.variantStatusTransitions[0]?.to, "inactive");
  assert.equal(parsed.deletesProduct, false);
  assert.equal(parsed.deletesVariant, false);
  assert.equal(parsed.deletesPartner, false);
  assert.equal(parsed.deletesCollection, false);
  assert.equal(parsed.deletesMembership, false);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.updatesCurrentAssetId, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.touchesObjectsJson, false);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /current_asset_id\s*=/);
  assert.match(sql, /status = 'inactive'/);
  assert.match(sql, /status = 'active'/);
  const schema = source(VARIANT_STATUS_SQL);
  assert.match(schema, /add column status text not null default 'active'/);
  assert.match(schema, /vibode_stage_variants_status_closed/);
});

test("PI-5F3B post-state, Walnut Asset D, and current-state fold stay exact", () => {
  const after = afterF3bState();
  overlayFoldedPartnerCatalog(after);
  assert.equal(after.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "inactive");
  assert.equal(after.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)?.status ?? "active", "active");
  assert.equal(after.products.find((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID)?.status ?? "active", "active");
  assert.equal(after.products.find((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID)?.status ?? "active", "active");
  assert.equal(after.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID)?.status ?? "active", "active");
  assert.equal(after.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID)?.status, "inactive");
  const walnut = after.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID);
  assert.equal(walnut?.status ?? "active", "active");
  assert.equal(walnut?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(walnut?.sku, DEMO_COFFEE_TABLE_WALNUT_SKU);
  const repeat = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3C_SYNC_BATCH_ID,
  });
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.deepEqual(repeat.state, after);
  assert.equal(GENERATED_REGISTERED_PRODUCTS.some((product) => product.source === "partner_catalog"), false);
});

test("PI-5F3B drift stays clean and Scene/viewer/Asset/retarget stay frozen", () => {
  assert.deepEqual(detectPartnerCatalogSyncDrift(), []);
  assert.deepEqual(detectPartnerCatalogDrift(), []);
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  assert.deepEqual(detectVariantAssetAssociationDrift(), []);
  assert.deepEqual(detectProductVariantRegistrationDrift(), []);
  const syncModule = source("lib/vibode-stage/partner-catalog-sync.ts");
  assert.doesNotMatch(syncModule, /retargetVariantCurrentAsset|planVariantAssociation|registerVariant\(/);
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  assert.equal(viewer, gitShow("components/afc-3d/AfcProductionRoomViewer.tsx"));
  assert.equal(crud, gitShow("lib/afc-v2-runtime/scene-crud.ts"));
  assert.equal(persisted, gitShow("lib/afc-v2-runtime/persisted-scene.ts"));
  assert.doesNotMatch(viewer, /partner-sync|partner-catalog-sync/);
  assert.doesNotMatch(source("lib/vibode-stage/catalog.ts"), /partner-catalog-sync/);
});

test("PI-5F3B CLI is thin, --check writes nothing, and live --check is structured", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(
    pkg.scripts["vibode:sync-partner-catalog"],
    "node --import tsx scripts/vibode-partner-catalog-sync.ts",
  );
  assert.equal(
    pkg.scripts["test:afc-v2-pi5f3b"],
    "node --conditions=react-server --import tsx --test --test-concurrency=1 lib/vibode-stage/pi5f3b-partner-deactivation.test.ts",
  );
  const repoRoot = tmpRepo();
  const check = runCli([
    "--input",
    path.join(ROOT, PI5F3B_SYNC_JSON_RELATIVE_PATH),
    "--check",
    "--repo-root",
    repoRoot,
    "--migration-timestamp",
    PI5F3B_SYNC_MIGRATION_TIMESTAMP,
  ], ROOT);
  assert.notEqual(check.status, 0);
  assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")), []);
  const liveCheck = runCli([
    "--input",
    PI5F3B_SYNC_JSON_RELATIVE_PATH,
    "--check",
    "--migration-timestamp",
    PI5F3B_SYNC_MIGRATION_TIMESTAMP,
  ]);
  assert.equal(liveCheck.status, 0, liveCheck.stderr + liveCheck.stdout);
  const payload = JSON.parse(liveCheck.stdout) as {
    ok: boolean;
    check: boolean;
    noOp: boolean;
    written: null;
    productDeactivations: unknown[];
    variantDeactivations: unknown[];
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.check, true);
  assert.equal(payload.noOp, false);
  assert.equal(payload.written, null);
  assert.equal(payload.productDeactivations.length, 1);
  assert.equal(payload.variantDeactivations.length, 1);
});
