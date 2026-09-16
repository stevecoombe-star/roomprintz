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
import {
  PI5F2_COFFEE_TABLE_ASSET_ID,
} from "@/lib/afc-v2-runtime/pi5f2-demo-coffee-table-geometry";
import {
  PI5F2_SIDE_TABLE_ASSET_ID,
} from "@/lib/afc-v2-runtime/pi5f2-demo-side-table-geometry";

import {
  favoriteKey,
  STAGE_SEED_PRODUCTS,
  stageVariantsForProduct,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import { GENERATED_REGISTERED_PRODUCTS } from "./catalog-commercial.generated";
import { toggleFavoriteKeys } from "./favorites";
import { detectPartnerCatalogDrift } from "./partner-catalog-drift";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_FURNITURE_PARTNER_NAME,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_SOFA_PRODUCT_ID,
  isPartnerCatalogMigrationFileName,
  PARTNER_CATALOG_JSON_RELATIVE_PATH,
} from "./partner-catalog";
import { PARTNER_CATALOG_DOCUMENTS } from "./partner-catalog-documents";
import { detectPartnerCatalogSyncDrift } from "./partner-catalog-sync-drift";
import {
  DEMO_COFFEE_TABLE_WALNUT_PRICE,
  DEMO_COFFEE_TABLE_WALNUT_SKU,
  DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  foldPartnerCatalogCurrentState,
  importPartnerCatalogSync,
  isPartnerSyncMigrationFileName,
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
  PARTNER_SYNC_DOCUMENTS,
} from "./partner-sync-documents";
import {
  DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
  DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
  DEMO_COFFEE_TABLE_PRODUCT_ID,
  DEMO_SIDE_TABLE_PRODUCT_ID,
  DEMO_SIDE_TABLE_VARIANT_ID,
} from "./partner-package";
import { detectProductVariantRegistrationDrift } from "./product-variant-drift";
import {
  COMMERCIAL_SEED_RELATIVE_PATH,
  isProductRegistrationMigrationFileName,
  isVariantRegistrationMigrationFileName,
} from "./product-variant-register";
import { buildStageSummary } from "./summary";
import {
  detectVariantAssetAssociationDrift,
  isVariantAssociationMigrationFileName,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
} from "./variant-asset-association";

const ROOT = process.cwd();
const F1_JSON = PARTNER_CATALOG_JSON_RELATIVE_PATH;
const F2_JSON = "lib/vibode-stage/partners/demo-furniture-co/pi5f2-tables/partner-catalog.json";
const F1_SQL = "supabase/migrations/20260915050000_vibode_stage_partner_catalog_demo_furniture_co.sql";
const F2_SQL =
  "supabase/migrations/20260915100002_vibode_stage_partner_catalog_demo_furniture_co_pi5f2_tables.sql";
const F3A_SQL =
  `supabase/migrations/${PI5F3A_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3A_SYNC_SQL_SLUG}.sql`;
const FROZEN_SHA = "39c448f2fffb51e083e6714c853f17afd6180235";

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
  return JSON.parse(source(PI5F3A_SYNC_JSON_RELATIVE_PATH));
}

function proofDocument(): PartnerCatalogSyncDocument {
  const parsed = parsePartnerCatalogSyncJson(proofRaw());
  assert.equal(parsed.ok, true, JSON.stringify(parsed.ok ? null : parsed.issues));
  if (!parsed.ok) throw new Error("proof sync JSON invalid");
  return parsed.document;
}

function cloneProof(
  mutator: (document: PartnerCatalogSyncDocument) => PartnerCatalogSyncDocument,
): PartnerCatalogSyncDocument {
  return mutator(structuredClone(proofDocument()));
}

function hasCode(
  result: { issues: readonly { code: string }[] },
  code: string,
): boolean {
  return result.issues.some((item) => item.code === code);
}

function preF3aState(): FoldedPartnerCatalogState {
  const folded = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3A_SYNC_BATCH_ID,
  });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("pre-F3A fold failed");
  return folded.state;
}

function afterF3aState(): FoldedPartnerCatalogState {
  const folded = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3B_SYNC_BATCH_ID,
  });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("current fold failed");
  return folded.state;
}

function planPatch(document: PartnerCatalogSyncDocument, current = preF3aState()) {
  return planPartnerCatalogSync({
    current,
    document,
    repoRoot: ROOT,
    sqlSlug: PI5F3A_SYNC_SQL_SLUG,
    migrationTimestamp: PI5F3A_SYNC_MIGRATION_TIMESTAMP,
  });
}

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f3a-sync-"));
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

function catalogQuery(
  catalog: ReturnType<typeof overlayFoldedPartnerCatalog>,
  input: Partial<Parameters<typeof filterStageCatalogProducts>[0]> = {},
) {
  return filterStageCatalogProducts({
    products: catalog.products,
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

function secondPartnerState(base: FoldedPartnerCatalogState): FoldedPartnerCatalogState {
  return {
    partners: [
      ...base.partners,
      {
        partnerId: "partner-other-co",
        name: "Other Co.",
        slug: "other-co",
        status: "active",
        websiteUrl: null,
        logoUrl: null,
      },
    ],
    products: base.products,
    variants: base.variants,
    collections: [
      ...base.collections,
      {
        collectionId: "col-other-co-showroom",
        name: "Other Showroom",
        owner: "partner",
        partnerName: "Other Co.",
        partnerId: "partner-other-co",
        productIds: [],
      },
    ],
  };
}

test("PI-5F3A frozen baseline is exact and F1/F2 documents stay byte-identical", () => {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(head.stdout.trim(), "592b167c4160893e150965be702f52b83568a35f");
  assert.equal(source(F1_JSON), gitShow(F1_JSON));
  assert.equal(source(F2_JSON), gitShow(F2_JSON));
  assert.equal(source(F1_SQL), gitShow(F1_SQL));
  assert.equal(source(F2_SQL), gitShow(F2_SQL));
  assert.equal(
    source("lib/vibode-stage/partners/demo-furniture-co/pi5f2-tables/partner-assets.json"),
    gitShow("lib/vibode-stage/partners/demo-furniture-co/pi5f2-tables/partner-assets.json"),
  );
  assert.equal(source(COMMERCIAL_SEED_RELATIVE_PATH), gitShow(COMMERCIAL_SEED_RELATIVE_PATH));
  assert.equal(source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH), gitShow(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH));
  assert.equal(
    PARTNER_CATALOG_DOCUMENTS.some((item) => item.jsonRelativePath === PI5F3A_SYNC_JSON_RELATIVE_PATH),
    false,
  );
  assert.deepEqual(
    PARTNER_SYNC_DOCUMENTS[0],
    Object.freeze({
      batchId: PI5F3A_SYNC_BATCH_ID,
      jsonRelativePath: PI5F3A_SYNC_JSON_RELATIVE_PATH,
      sqlSlug: PI5F3A_SYNC_SQL_SLUG,
    }),
  );
  assert.equal(PARTNER_SYNC_DOCUMENTS[0]?.batchId, PI5F3A_SYNC_BATCH_ID);
  assert.equal(PARTNER_SYNC_DOCUMENTS[0]?.sqlSlug, PI5F3A_SYNC_SQL_SLUG);
});

test("PI-5F3A fold of F1/F2 is deterministic and reconstructs field-level state", () => {
  const first = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3A_SYNC_BATCH_ID,
  });
  const second = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3A_SYNC_BATCH_ID,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.state, second.state);
  assert.equal(first.state.partners[0]?.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(first.state.products.length, 4);
  assert.equal(first.state.variants.length, 6);
  const coffee = first.state.products.find((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID);
  const side = first.state.products.find((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID);
  const chair = first.state.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID);
  const living = first.state.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.equal(coffee?.name, "Demo Coffee Table");
  assert.equal(coffee?.priceAmount, 399);
  assert.equal(side?.name, "Demo Side Table");
  assert.equal(side?.priceAmount, 189);
  assert.equal(chair?.collectionIds.includes(DEMO_LIVING_ROOM_COLLECTION_ID), true);
  assert.equal(living?.productIds.includes(DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);
  const black = first.state.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  assert.equal(black?.priceAmount, 429);
  assert.equal(black?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
});

test("PI-5F3A valid patch parses as patch-only and snapshot/status modes fail", () => {
  const parsed = parsePartnerCatalogSyncJson(proofRaw());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.mode, "patch");
  assert.equal(parsed.document.partnerId, DEMO_FURNITURE_PARTNER_ID);
  const snapshot = parsePartnerCatalogSyncJson({ ...proofRaw() as object, mode: "snapshot" });
  assert.equal(snapshot.ok, false);
  assert.equal(hasCode(snapshot, "UNSUPPORTED_OPERATION"), true);
  const status = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, status: "inactive" }] },
  });
  assert.equal(status.ok, false);
  assert.equal(hasCode(status, "UNSUPPORTED_OPERATION"), true);
  const variantStatus = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    variants: { update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, status: "inactive" }] },
  });
  assert.equal(variantStatus.ok, false);
  assert.equal(hasCode(variantStatus, "UNSUPPORTED_OPERATION"), true);
});

test("PI-5F3A planner accepts product/variant/collection/membership ops and true no-ops", () => {
  const valid = planPatch(proofDocument());
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  assert.equal(valid.noOp, false);
  assert.equal(valid.productUpdates.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), true);
  assert.equal(valid.productUpdates.some((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID), true);
  assert.equal(valid.variantUpdates.some((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID), true);
  assert.equal(valid.variantCreates.some((item) => item.variant.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID), true);
  assert.equal(valid.membershipRemoves.some((item) => (
    item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID &&
    item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
  )), true);
  assert.equal(valid.productUpdates.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);
  const name = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [{ productId: DEMO_COFFEE_TABLE_PRODUCT_ID, name: "Demo Coffee Table" }] },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(name.ok, true);
  assert.equal(name.noOp, true);
  assert.equal(name.sqlPlan, null);
  const collectionName = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [] },
    variants: { create: [], update: [] },
    collections: {
      update: [{ collectionId: DEMO_LIVING_ROOM_COLLECTION_ID, name: "Demo Living Room Refresh" }],
      membershipAdd: [],
      membershipRemove: [],
    },
  });
  assert.equal(collectionName.ok, true);
  assert.equal(collectionName.collectionUpdates[0]?.name, "Demo Living Room Refresh");
  const membershipAdd = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [] },
    variants: { create: [], update: [] },
    collections: {
      update: [],
      membershipAdd: [{
        productId: DEMO_LOUNGE_CHAIR_PRODUCT_ID,
        collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
      }],
      membershipRemove: [],
    },
  });
  assert.equal(membershipAdd.ok, true);
  assert.equal(membershipAdd.noOp, true);
});

test("PI-5F3A identity, currency, retarget, taxonomy, URL, and SKU failures write nothing", () => {
  const partnerChange = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_COFFEE_TABLE_PRODUCT_ID, partnerId: "partner-other-co" }],
    },
  })));
  assert.equal(partnerChange.ok, false);
  assert.equal(hasCode(partnerChange, "PARTNER_MISMATCH"), true);
  const sourceChange = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_COFFEE_TABLE_PRODUCT_ID, source: "vibode_curated" }],
    },
  })));
  assert.equal(sourceChange.ok, false);
  assert.equal(hasCode(sourceChange, "IDENTITY_IMMUTABLE"), true);
  const variantMove = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, productId: DEMO_SIDE_TABLE_PRODUCT_ID }],
    },
  })));
  assert.equal(variantMove.ok, false);
  assert.equal(hasCode(variantMove, "IDENTITY_IMMUTABLE"), true);
  const collectionOwner = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [] },
    variants: { create: [], update: [] },
    collections: {
      update: [{ collectionId: DEMO_LIVING_ROOM_COLLECTION_ID, owner: "vibode", partnerId: "partner-other-co" }],
      membershipAdd: [],
      membershipRemove: [],
    },
  });
  assert.equal(collectionOwner.ok, false);
  assert.equal(hasCode(collectionOwner, "IDENTITY_IMMUTABLE"), true);
  const uuidVariant = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    variants: {
      create: [{
        variantId: "123e4567-e89b-12d3-a456-426614174000",
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        finishLabel: "Bad",
        sku: "BAD",
        priceAmount: 1,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
      }],
    },
  });
  assert.equal(uuidVariant.ok, true);
  if (uuidVariant.ok) {
    const planned = planPatch(uuidVariant.document);
    assert.equal(planned.ok, false);
    assert.equal(hasCode(planned, "INVALID_VARIANT_ID"), true);
  }
  const retarget = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [],
      update: [{
        variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
        currentAssetId: PI5F2_SIDE_TABLE_ASSET_ID,
      }],
    },
  })));
  assert.equal(retarget.ok, false);
  assert.equal(hasCode(retarget, "ASSET_RETARGET_REQUIRED"), true);
  assert.equal(retarget.sqlPlan, null);
  const sameAsset = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [] },
    variants: {
      create: [],
      update: [{
        variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
        currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
        priceAmount: 449,
      }],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(sameAsset.ok, true, JSON.stringify(sameAsset.issues));
  assert.equal(sameAsset.variantUpdates[0]?.changes.some((item) => item.column === "current_asset_id"), false);
  const productCurrency = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_SIDE_TABLE_PRODUCT_ID, priceCurrency: "CAD" }],
    },
  })));
  assert.equal(productCurrency.ok, false);
  assert.equal(hasCode(productCurrency, "CURRENCY_IMMUTABLE"), true);
  const variantCurrency = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, priceCurrency: "CAD" }],
    },
  })));
  assert.equal(variantCurrency.ok, false);
  assert.equal(hasCode(variantCurrency, "CURRENCY_IMMUTABLE"), true);
  const duplicateSku = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, sku: "DFC-COFFEE-01" }],
    },
  })));
  assert.equal(duplicateSku.ok, false);
  assert.equal(hasCode(duplicateSku, "DUPLICATE_SKU"), true);
  const createDupSku = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [{
        variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        finishLabel: "Walnut",
        sku: "DFC-COFFEE-01",
        priceAmount: DEMO_COFFEE_TABLE_WALNUT_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
      }],
      update: [],
    },
  })));
  assert.equal(createDupSku.ok, false);
  assert.equal(hasCode(createDupSku, "DUPLICATE_SKU"), true);
  const skuFree = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [] },
    variants: {
      create: [{
        variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        finishLabel: "Walnut",
        sku: "DFC-COFFEE-02",
        priceAmount: DEMO_COFFEE_TABLE_WALNUT_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
      }],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, sku: "DFC-COFFEE-02B" }],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(skuFree.ok, true, JSON.stringify(skuFree.issues));
  const httpUrl = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_COFFEE_TABLE_PRODUCT_ID, productUrl: "http://example.test/nope" }],
    },
  })));
  assert.equal(httpUrl.ok, false);
  assert.equal(hasCode(httpUrl, "INVALID_PRODUCT_URL"), true);
  const nullUrl = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    products: { update: [{ productId: DEMO_COFFEE_TABLE_PRODUCT_ID, productUrl: null }] },
  });
  assert.equal(nullUrl.ok, true);
  if (nullUrl.ok) {
    const planned = planPatch(nullUrl.document);
    assert.equal(planned.ok, false);
    assert.equal(hasCode(planned, "MISSING_PRODUCT_URL"), true);
  }
  const badImage = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_COFFEE_TABLE_PRODUCT_ID, imageUrl: "javascript:alert(1)" }],
    },
  })));
  assert.equal(badImage.ok, false);
  assert.equal(hasCode(badImage, "INVALID_IMAGE_URL"), true);
  const badVariantUrl = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, productUrl: "http://example.test/nope" }],
    },
  })));
  assert.equal(badVariantUrl.ok, false);
  assert.equal(hasCode(badVariantUrl, "INVALID_PRODUCT_URL"), true);
  const badPrice = planPatch(cloneProof((document) => ({
    ...document,
    variants: {
      create: [],
      update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, priceAmount: -1 }],
    },
  })));
  assert.equal(badPrice.ok, false);
  assert.equal(hasCode(badPrice, "INVALID_PRICE"), true);
  const badCategory = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_SIDE_TABLE_PRODUCT_ID, categoryId: "spaceships" }],
    },
  })));
  assert.equal(badCategory.ok, false);
  assert.equal(hasCode(badCategory, "UNKNOWN_CATEGORY"), true);
  const badSubcategory = planPatch(cloneProof((document) => ({
    ...document,
    products: {
      update: [{ productId: DEMO_SIDE_TABLE_PRODUCT_ID, subcategoryId: "nope" }],
    },
  })));
  assert.equal(badSubcategory.ok, false);
  assert.equal(hasCode(badSubcategory, "UNKNOWN_SUBCATEGORY"), true);
  const repoRoot = tmpRepo();
  const mixed = importPartnerCatalogSync({
    document: cloneProof((document) => ({
      ...document,
      products: {
        update: [
          ...document.products.update,
          { productId: DEMO_SOFA_PRODUCT_ID, priceCurrency: "CAD" },
        ],
      },
    })),
    repoRoot,
    current: preF3aState(),
    migrationTimestamp: "20990101000000",
    sqlSlug: "should_not_write",
  });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.written, null);
  assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")), []);
});

test("PI-5F3A default Variant, membership, and cross-partner semantics", () => {
  const validDefault = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      update: [{
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        defaultVariantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
        priceAmount: 429,
      }],
    },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(validDefault.ok, true, JSON.stringify(validDefault.issues));
  assert.equal(validDefault.productUpdates[0]?.changes.some((item) => item.column === "default_variant_id"), true);
  const otherProduct = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      update: [{
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        defaultVariantId: DEMO_SIDE_TABLE_VARIANT_ID,
      }],
    },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(otherProduct.ok, false);
  assert.equal(hasCode(otherProduct, "DEFAULT_VARIANT_MISMATCH"), true);
  const priceMismatch = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      update: [{
        productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
        defaultVariantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
      }],
    },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(priceMismatch.ok, false);
  assert.equal(hasCode(priceMismatch, "PRICE_CURRENCY_MISMATCH"), true);
  const exactRemove = planPatch(proofDocument());
  assert.equal(exactRemove.membershipRemoves.length, 1);
  const absent = planPatch({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [] },
    variants: { create: [], update: [] },
    collections: {
      update: [],
      membershipAdd: [],
      membershipRemove: [{
        productId: DEMO_SOFA_PRODUCT_ID,
        collectionId: "col-demo-furniture-co-missing",
      }],
    },
  });
  assert.equal(absent.ok, false);
  assert.equal(hasCode(absent, "NOT_FOUND"), true);
  const current = preF3aState();
  const withEmpty: FoldedPartnerCatalogState = {
    ...current,
    collections: [
      ...current.collections,
      {
        collectionId: "col-demo-furniture-co-overflow",
        name: "Overflow",
        owner: "partner",
        partnerName: DEMO_FURNITURE_PARTNER_NAME,
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        productIds: [],
      },
    ],
  };
  const absentNoOp = planPartnerCatalogSync({
    current: withEmpty,
    document: {
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      mode: "patch",
      products: { update: [] },
      variants: { create: [], update: [] },
      collections: {
        update: [],
        membershipAdd: [],
        membershipRemove: [{
          productId: DEMO_SOFA_PRODUCT_ID,
          collectionId: "col-demo-furniture-co-overflow",
        }],
      },
    },
    repoRoot: ROOT,
  });
  assert.equal(absentNoOp.ok, true, JSON.stringify(absentNoOp.issues));
  assert.equal(absentNoOp.noOp, true);
  const cross = planPartnerCatalogSync({
    current: secondPartnerState(preF3aState()),
    document: {
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      mode: "patch",
      products: { update: [] },
      variants: { create: [], update: [] },
      collections: {
        update: [],
        membershipAdd: [{
          productId: DEMO_SOFA_PRODUCT_ID,
          collectionId: "col-other-co-showroom",
        }],
        membershipRemove: [],
      },
    },
    repoRoot: ROOT,
  });
  assert.equal(cross.ok, false);
  assert.equal(hasCode(cross, "COLLECTION_OWNER_MISMATCH"), true);
  assert.equal(cross.sqlPlan, null);
});

test("PI-5F3A import writes one partner_sync SQL with guards and no forbidden DML", () => {
  const repoRoot = tmpRepo();
  const check = importPartnerCatalogSync({
    document: proofDocument(),
    repoRoot,
    current: preF3aState(),
    check: true,
    migrationTimestamp: PI5F3A_SYNC_MIGRATION_TIMESTAMP,
    sqlSlug: PI5F3A_SYNC_SQL_SLUG,
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.equal(check.written, null);
  assert.equal(check.noOp, false);
  assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")), []);
  const written = importPartnerCatalogSync({
    document: proofDocument(),
    repoRoot,
    current: preF3aState(),
    migrationTimestamp: PI5F3A_SYNC_MIGRATION_TIMESTAMP,
    sqlSlug: PI5F3A_SYNC_SQL_SLUG,
  });
  assert.equal(written.ok, true, JSON.stringify(written.issues));
  assert.equal(written.written?.migration.endsWith(
    `${PI5F3A_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3A_SYNC_SQL_SLUG}.sql`,
  ), true);
  const files = readdirSync(path.join(repoRoot, "supabase/migrations"));
  assert.equal(files.length, 1);
  assert.equal(isPartnerSyncMigrationFileName(files[0]!), true);
  assert.equal(isPartnerCatalogMigrationFileName(files[0]!), false);
  const sql = readFileSync(written.written!.migration, "utf8");
  const parsed = parsePartnerCatalogSyncSql(sql);
  assert.equal(parsed.hasBegin, true);
  assert.equal(parsed.hasCommit, true);
  assert.equal(parsed.mentionsStaleSync, true);
  assert.equal(parsed.updatesProduct, true);
  assert.equal(parsed.updatesVariant, true);
  assert.equal(parsed.insertsVariant, true);
  assert.equal(parsed.deletesMembership, true);
  assert.equal(parsed.insertsMembership, false);
  assert.equal(parsed.deletesProduct, false);
  assert.equal(parsed.deletesVariant, false);
  assert.equal(parsed.deletesPartner, false);
  assert.equal(parsed.deletesCollection, false);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.updatesCurrentAssetId, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.touchesObjectsJson, false);
  assert.equal(parsed.usesUpsert, false);
  assert.equal(parsed.insertedVariantIds.includes(DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID), true);
  assert.equal(parsed.deletedMemberships.some((item) => (
    item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID &&
    item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
  )), true);
  for (const column of parsed.productUpdateColumns) {
    assert.equal(["name", "image_url", "product_url", "price_amount", "category_id", "subcategory_id", "default_variant_id"].includes(column), true, column);
  }
  for (const column of parsed.variantUpdateColumns) {
    assert.equal(["finish_label", "sku", "price_amount", "product_url"].includes(column), true, column);
  }
  assert.match(sql, /partner_id = 'partner-demo-furniture-co'/);
  assert.match(sql, /source = 'partner_catalog'/);
  assert.match(sql, /is not distinct from/);
  assert.doesNotMatch(sql, /delete from public\.vibode_stage_products/i);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i);
  assert.doesNotMatch(sql, /objects_json/);
  assert.doesNotMatch(sql, /retargetVariantCurrentAsset|current_asset_id =/);
  const retry = importPartnerCatalogSync({
    document: proofDocument(),
    repoRoot,
    current: preF3aState(),
    migrationTimestamp: PI5F3A_SYNC_MIGRATION_TIMESTAMP,
    sqlSlug: PI5F3A_SYNC_SQL_SLUG,
  });
  assert.equal(retry.ok, false);
  assert.equal(hasCode(retry, "MIGRATION_EXISTS"), true);
});

test("PI-5F3A live SQL, current state after sync, and generic catalog surfaces", () => {
  assert.equal(existsSync(path.join(ROOT, F3A_SQL)), true);
  const sql = source(F3A_SQL);
  const parsed = parsePartnerCatalogSyncSql(sql);
  assert.equal(isPartnerSyncMigrationFileName(path.basename(F3A_SQL)), true);
  assert.equal(parsed.insertsVariant, true);
  assert.equal(parsed.deletesMembership, true);
  const after = afterF3aState();
  const coffee = after.products.find((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID);
  const side = after.products.find((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID);
  const sofa = after.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  const chair = after.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID);
  const walnut = after.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID);
  const black = after.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  const sideVariant = after.variants.find((item) => item.variantId === DEMO_SIDE_TABLE_VARIANT_ID);
  const living = after.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.equal(coffee?.name, "Demo Coffee Table");
  assert.equal(coffee?.imageUrl, "https://example.test/images/demo-coffee-table-f3a.jpg");
  assert.equal(coffee?.productUrl, "https://example.test/products/demo-coffee-table?ref=pi5f3a");
  assert.equal(coffee?.priceAmount, 399);
  assert.equal(coffee?.defaultVariantId, DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID);
  assert.equal(side?.name, "Demo Pedestal Side Table");
  assert.equal(side?.priceAmount, 199);
  assert.equal(sofa?.name, "Demo Sofa");
  assert.equal(sofa?.priceAmount, 1299);
  assert.equal(chair?.name, "Demo Lounge Chair");
  assert.equal(chair?.collectionIds.includes(DEMO_LIVING_ROOM_COLLECTION_ID), false);
  assert.equal(living?.productIds.includes(DEMO_LOUNGE_CHAIR_PRODUCT_ID), false);
  assert.equal(living?.productIds.includes(DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(walnut?.sku, DEMO_COFFEE_TABLE_WALNUT_SKU);
  assert.equal(walnut?.priceAmount, DEMO_COFFEE_TABLE_WALNUT_PRICE);
  assert.equal(walnut?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(black?.priceAmount, 449);
  assert.equal(black?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(sideVariant?.priceAmount, 199);
  assert.equal(sideVariant?.assetId, PI5F2_SIDE_TABLE_ASSET_ID);
  const catalog = overlayFoldedPartnerCatalog(after);
  const variants = stageVariantsForProduct(DEMO_COFFEE_TABLE_PRODUCT_ID, [], catalog);
  assert.deepEqual(variants.map((item) => item.variantId).sort(), [
    DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
    DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  ].sort());
  const pedestal = catalogQuery(catalog, { query: "Pedestal" });
  assert.equal(pedestal.some((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID), true);
  assert.equal(catalogQuery(catalog).some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);
  assert.equal(catalogQuery(catalog, {
    mode: "collections",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
  }).some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), false);
  const favorites = toggleFavoriteKeys(new Set(), DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID);
  assert.equal(favorites.has(favoriteKey(DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID)), true);
  assert.equal(favoriteKey(DEMO_COFFEE_TABLE_PRODUCT_ID, DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID).includes(PI5F2_COFFEE_TABLE_ASSET_ID), false);
  assert.deepEqual(rememberRecentlyUsed([], DEMO_SIDE_TABLE_PRODUCT_ID), [DEMO_SIDE_TABLE_PRODUCT_ID]);
  const placed = addSceneObject({
    objects: [],
    assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
    identity: {
      productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
      variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    },
    createObjectId: () => "so-coffee-black",
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(placed.object.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  const summary = buildStageSummary({
    objects: [placed.object],
    catalog,
  });
  assert.equal(summary.lines[0]?.name, "Demo Coffee Table");
  assert.equal(summary.lines[0]?.unitPrice, 449);
  const sidePlaced = addSceneObject({
    objects: [],
    assetId: PI5F2_SIDE_TABLE_ASSET_ID,
    identity: {
      productId: DEMO_SIDE_TABLE_PRODUCT_ID,
      variantId: DEMO_SIDE_TABLE_VARIANT_ID,
    },
    createObjectId: () => "so-side",
  });
  assert.equal(sidePlaced.ok, true);
  if (!sidePlaced.ok) return;
  const sideSummary = buildStageSummary({ objects: [sidePlaced.object], catalog });
  assert.equal(sideSummary.lines[0]?.name, "Demo Pedestal Side Table");
  assert.equal(sideSummary.lines[0]?.unitPrice, 199);
  assert.equal(STAGE_SEED_PRODUCTS.some((product) => product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), false);
  assert.equal(GENERATED_REGISTERED_PRODUCTS.some((product) => product.source === "partner_catalog"), false);
});

test("PI-5F3A drift stays clean and frozen Scene/viewer/retarget files stay untouched", () => {
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
  assert.equal(isVariantAssociationMigrationFileName(path.basename(F3A_SQL)), false);
  assert.equal(isProductRegistrationMigrationFileName(path.basename(F3A_SQL)), false);
  assert.equal(isVariantRegistrationMigrationFileName(path.basename(F3A_SQL)), false);
});

test("PI-5F3A CLI is thin, --check writes nothing, and live --check is structured", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(
    pkg.scripts["vibode:sync-partner-catalog"],
    "node --import tsx scripts/vibode-partner-catalog-sync.ts",
  );
  assert.equal(
    pkg.scripts["test:afc-v2-pi5f3a"],
    "node --conditions=react-server --import tsx --test --test-concurrency=1 lib/vibode-stage/pi5f3a-partner-catalog-sync.test.ts",
  );
  const repoRoot = tmpRepo();
  const check = runCli([
    "--input",
    path.join(ROOT, PI5F3A_SYNC_JSON_RELATIVE_PATH),
    "--check",
    "--repo-root",
    repoRoot,
    "--migration-timestamp",
    PI5F3A_SYNC_MIGRATION_TIMESTAMP,
  ], ROOT);
  assert.notEqual(check.status, 0);
  const liveCheck = runCli([
    "--input",
    PI5F3A_SYNC_JSON_RELATIVE_PATH,
    "--check",
    "--migration-timestamp",
    PI5F3A_SYNC_MIGRATION_TIMESTAMP,
  ]);
  assert.equal(liveCheck.status, 0, liveCheck.stderr + liveCheck.stdout);
  const payload = JSON.parse(liveCheck.stdout) as {
    ok: boolean;
    check: boolean;
    noOp: boolean;
    written: null;
    issues: unknown[];
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.check, true);
  assert.equal(payload.noOp, false);
  assert.equal(payload.written, null);
  assert.deepEqual(payload.issues, []);
});
