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
import { PI5F2_SIDE_TABLE_ASSET_ID } from "@/lib/afc-v2-runtime/pi5f2-demo-side-table-geometry";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
} from "@/lib/afc-v2-runtime/types";

import {
  activeStageVariantsForProduct,
  createStageCatalogSnapshot,
  favoriteKey,
  isStageCollectionShoppingVisible,
  isStagePartnerActive,
  isStageProductAvailable,
  resolveStagePlacement,
  resolveStagePlacementResult,
  STAGE_SEED_PRODUCTS,
  stagePartnerById,
  stageProductById,
  stageVariantById,
  visibleStageCollections,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import { GENERATED_REGISTERED_PRODUCTS } from "./catalog-commercial.generated";
import { toggleFavoriteKeys } from "./favorites";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_LOUNGE_CHAIR_VARIANT_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import { detectPartnerCatalogDrift } from "./partner-catalog-drift";
import {
  DEMO_COFFEE_TABLE_BLACK_SNAPSHOT_PRICE,
  parsePartnerCatalogSnapshotJson,
  planPartnerCatalogSnapshotSync,
  type PartnerCatalogSnapshotDocument,
} from "./partner-catalog-snapshot";
import { detectPartnerCatalogSyncDrift } from "./partner-catalog-sync-drift";
import {
  DEMO_COFFEE_TABLE_WALNUT_PRICE,
  DEMO_COFFEE_TABLE_WALNUT_SKU,
  DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  foldPartnerCatalogCurrentState,
  importPartnerCatalogSnapshot,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
  parsePartnerCatalogSyncSql,
  planPartnerCatalogSync,
  type FoldedPartnerCatalogState,
  type PartnerCatalogSyncDocument,
} from "./partner-catalog-sync";
import {
  PI5F3A_SYNC_JSON_RELATIVE_PATH,
  PI5F3A_SYNC_MIGRATION_TIMESTAMP,
  PI5F3A_SYNC_SQL_SLUG,
  PI5F3B_SYNC_BATCH_ID,
  PI5F3B_SYNC_JSON_RELATIVE_PATH,
  PI5F3B_SYNC_MIGRATION_TIMESTAMP,
  PI5F3B_SYNC_SQL_SLUG,
  PI5F3C_SYNC_BATCH_ID,
  PI5F3C_SYNC_JSON_RELATIVE_PATH,
  PI5F3C_SYNC_MIGRATION_TIMESTAMP,
  PI5F3C_SYNC_SQL_SLUG,
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
import { COMMERCIAL_SEED_RELATIVE_PATH } from "./product-variant-register";
import { buildStageSummary } from "./summary";
import {
  detectVariantAssetAssociationDrift,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
} from "./variant-asset-association";

const ROOT = process.cwd();
const FROZEN_SHA = "89a6acfe966876a76b16bf00a1d64124d765c1dc";
const F3A_SQL =
  `supabase/migrations/${PI5F3A_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3A_SYNC_SQL_SLUG}.sql`;
const F3B_SQL =
  `supabase/migrations/${PI5F3B_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3B_SYNC_SQL_SLUG}.sql`;
const F3C_SQL =
  `supabase/migrations/${PI5F3C_SYNC_MIGRATION_TIMESTAMP}_vibode_stage_partner_sync_${PI5F3C_SYNC_SQL_SLUG}.sql`;
const NEW_OTTOMAN_PRODUCT_ID = "prod-demo-furniture-co-demo-ottoman";
const NEW_OTTOMAN_VARIANT_ID = "var-demo-furniture-co-demo-ottoman-natural";
const NEW_COFFEE_WHITE_VARIANT_ID = "var-demo-furniture-co-demo-coffee-table-white";
const NEW_DINING_COLLECTION_ID = "col-demo-furniture-co-demo-dining";

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

function hasCode(result: { issues: readonly { code: string }[] }, code: string): boolean {
  return result.issues.some((item) => item.code === code);
}

function proofRaw(): unknown {
  return JSON.parse(source(PI5F3C_SYNC_JSON_RELATIVE_PATH));
}

function proofDocument(): PartnerCatalogSnapshotDocument {
  const parsed = parsePartnerCatalogSnapshotJson(proofRaw());
  assert.equal(parsed.ok, true, JSON.stringify(parsed.ok ? null : parsed.issues));
  if (!parsed.ok) throw new Error("proof snapshot JSON invalid");
  return parsed.document;
}

function cloneSnapshot(
  mutator: (document: PartnerCatalogSnapshotDocument) => PartnerCatalogSnapshotDocument,
): PartnerCatalogSnapshotDocument {
  return mutator(structuredClone(proofDocument()));
}

function preF3cState(): FoldedPartnerCatalogState {
  const folded = foldPartnerCatalogCurrentState({
    repoRoot: ROOT,
    stopBeforeSyncBatchId: PI5F3C_SYNC_BATCH_ID,
  });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("pre-F3C fold failed");
  return folded.state;
}

function afterF3cState(): FoldedPartnerCatalogState {
  const folded = foldPartnerCatalogCurrentState({ repoRoot: ROOT });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("post-F3C fold failed");
  return folded.state;
}

function planSnapshot(
  document: PartnerCatalogSnapshotDocument,
  current = preF3cState(),
) {
  return planPartnerCatalogSnapshotSync({
    current,
    document,
    repoRoot: ROOT,
    sqlSlug: PI5F3C_SYNC_SQL_SLUG,
    migrationTimestamp: PI5F3C_SYNC_MIGRATION_TIMESTAMP,
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

function withInactivePartner(catalog: ReturnType<typeof overlayFoldedPartnerCatalog>) {
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    products: catalog.products,
    variants: catalog.variants,
    assets: catalog.assets,
    collections: catalog.collections,
    partners: catalog.partners.map((partner) => (
      partner.partnerId === DEMO_FURNITURE_PARTNER_ID
        ? { ...partner, status: "inactive" as const }
        : partner
    )),
  });
}

function emptySnapshot(input: Partial<PartnerCatalogSnapshotDocument> = {}): PartnerCatalogSnapshotDocument {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "snapshot",
    scope: "full_partner_catalog",
    partner: { status: "active" },
    collections: [],
    products: [],
    ...input,
  };
}

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f3c-sync-"));
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

function emptyPatch(): PartnerCatalogSyncDocument {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: { create: [], update: [], deactivate: [], reactivate: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  };
}

test("PI-5F3C frozen baseline is 89a6acf and F3A/F3B artifacts stay byte-identical", () => {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(head.stdout.trim(), FROZEN_SHA);
  assert.equal(source(PI5F3A_SYNC_JSON_RELATIVE_PATH), gitShow(PI5F3A_SYNC_JSON_RELATIVE_PATH));
  assert.equal(source(PI5F3B_SYNC_JSON_RELATIVE_PATH), gitShow(PI5F3B_SYNC_JSON_RELATIVE_PATH));
  assert.equal(source(F3A_SQL), gitShow(F3A_SQL));
  assert.equal(source(F3B_SQL), gitShow(F3B_SQL));
  assert.equal(source(COMMERCIAL_SEED_RELATIVE_PATH), gitShow(COMMERCIAL_SEED_RELATIVE_PATH));
  assert.equal(source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH), gitShow(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH));
  assert.deepEqual(PARTNER_SYNC_DOCUMENTS.map((item) => item.batchId), [
    "demo-furniture-co-pi5f3a-commercial",
    PI5F3B_SYNC_BATCH_ID,
    PI5F3C_SYNC_BATCH_ID,
  ]);
  assert.equal(PARTNER_SYNC_DOCUMENTS[2]?.sqlSlug, PI5F3C_SYNC_SQL_SLUG);
  assert.equal(PARTNER_SYNC_DOCUMENTS[2]?.jsonRelativePath, PI5F3C_SYNC_JSON_RELATIVE_PATH);
});

test("PI-5F3C patch parser still rejects snapshot and omission remains no-op", () => {
  const snapshot = parsePartnerCatalogSyncJson(proofRaw());
  assert.equal(snapshot.ok, false);
  assert.equal(hasCode(snapshot, "UNSUPPORTED_OPERATION"), true);
  const omitted = planPartnerCatalogSync({
    current: preF3cState(),
    document: emptyPatch(),
    repoRoot: ROOT,
  });
  assert.equal(omitted.ok, true);
  assert.equal(omitted.noOp, true);
  assert.equal(omitted.sqlPlan, null);
  assert.equal(omitted.productDeactivations.length, 0);
  assert.equal(omitted.variantDeactivations.length, 0);
});

test("PI-5F3C snapshot parser requires scope and complete Product records", () => {
  const parsed = parsePartnerCatalogSnapshotJson(proofRaw());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.mode, "snapshot");
  assert.equal(parsed.document.scope, "full_partner_catalog");
  const noScope = parsePartnerCatalogSnapshotJson({ ...proofRaw() as object, scope: undefined });
  assert.equal(noScope.ok, false);
  assert.equal(hasCode(noScope, "SNAPSHOT_SCOPE_REQUIRED"), true);
  const patchShaped = parsePartnerCatalogSnapshotJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "snapshot",
    scope: "full_partner_catalog",
    partner: { status: "active" },
    collections: [],
    products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, name: "X" }] },
  });
  assert.equal(patchShaped.ok, false);
  const incomplete = parsePartnerCatalogSnapshotJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "snapshot",
    scope: "full_partner_catalog",
    partner: { status: "active" },
    collections: [],
    products: [{ product: { productId: DEMO_SOFA_PRODUCT_ID } }],
  });
  assert.equal(incomplete.ok, false);
});

test("PI-5F3C proof snapshot plans Sofa reactivate, Lounge deactivate, Black $459, Walnut deactivate", () => {
  const plan = planSnapshot(proofDocument());
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.noOp, false);
  assert.equal(plan.partnerStatusTransition, null);
  assert.equal(plan.productCreates.length, 0);
  assert.equal(plan.collectionCreates.length, 0);
  assert.deepEqual(plan.productReactivations.map((item) => item.productId), [DEMO_SOFA_PRODUCT_ID]);
  assert.deepEqual(plan.productDeactivations.map((item) => item.productId), [DEMO_LOUNGE_CHAIR_PRODUCT_ID]);
  assert.equal(plan.variantReactivations.some((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID), true);
  assert.equal(plan.variantDeactivations.some((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID), true);
  const blackUpdate = plan.variantUpdates.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID);
  assert.equal(blackUpdate?.changes.some((change) => (
    change.column === "price_amount" && change.previous === 449 && change.next === DEMO_COFFEE_TABLE_BLACK_SNAPSHOT_PRICE
  )), true);
  assert.doesNotMatch(plan.sqlPlan?.sql ?? "", /\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i);
  assert.doesNotMatch(plan.sqlPlan?.sql ?? "", /vibode_3d_scenes|objects_json/);
  assert.doesNotMatch(plan.sqlPlan?.sql ?? "", /current_asset_id\s*=/);
});

test("PI-5F3C Product/Variant omission, reappearance, and no Variant cascade", () => {
  const pre = preF3cState();
  const lounge = pre.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID);
  const loungeVariant = pre.variants.find((item) => item.variantId === DEMO_LOUNGE_CHAIR_VARIANT_ID);
  const plan = planSnapshot(proofDocument(), pre);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  const next = plan.nextState;
  assert.ok(next);
  assert.equal(next.products.length, pre.products.length);
  assert.equal(next.variants.length, pre.variants.length);
  assert.equal(next.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "active");
  assert.equal(next.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)?.status, "inactive");
  assert.equal(next.variants.find((item) => item.variantId === DEMO_LOUNGE_CHAIR_VARIANT_ID)?.status, loungeVariant?.status ?? "active");
  assert.equal(next.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)?.partnerId, lounge?.partnerId);
  const reappear = planSnapshot(proofDocument(), next);
  assert.equal(reappear.ok, true, JSON.stringify(reappear.issues));
  assert.equal(reappear.noOp, true);
  const empty = planSnapshot(emptySnapshot({ collections: proofDocument().collections }), pre);
  assert.equal(empty.ok, true, JSON.stringify(empty.issues));
  assert.equal(empty.nextState?.partners[0]?.status, "active");
  assert.equal(empty.productDeactivations.length, 3);
  assert.equal(empty.variantDeactivations.length, 0);
  for (const variant of empty.nextState?.variants ?? []) {
    const previous = pre.variants.find((item) => item.variantId === variant.variantId);
    assert.equal(variant.status ?? "active", previous?.status ?? "active");
  }
});

test("PI-5F3C Partner deactivate is availability-only and does not cascade", () => {
  const pre = preF3cState();
  const products = pre.products.filter((item) => item.partnerId === DEMO_FURNITURE_PARTNER_ID).map((product) => {
    const variants = pre.variants.filter((item) => item.productId === product.productId);
    const defaultVariant = variants.find((item) => item.variantId === product.defaultVariantId) ?? variants[0]!;
    return {
      product: {
        productId: product.productId,
        name: product.name,
        brand: product.brand,
        retailer: product.retailer,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        priceAmount: product.priceAmount ?? 0,
        priceCurrency: product.priceCurrency,
        source: product.source,
        partnerId: product.partnerId,
        collectionIds: [...product.collectionIds],
      },
      defaultVariant: {
        variantId: defaultVariant.variantId,
        finishLabel: defaultVariant.finishLabel,
        sku: defaultVariant.sku,
        priceAmount: defaultVariant.priceAmount ?? 0,
        priceCurrency: defaultVariant.priceCurrency,
        productUrl: defaultVariant.productUrl,
        currentAssetId: defaultVariant.assetId ?? "",
      },
      variants: variants
        .filter((item) => item.variantId !== defaultVariant.variantId)
        .map((item) => ({
          variantId: item.variantId,
          finishLabel: item.finishLabel,
          sku: item.sku,
          priceAmount: item.priceAmount ?? 0,
          priceCurrency: item.priceCurrency,
          productUrl: item.productUrl,
          currentAssetId: item.assetId ?? "",
        })),
    };
  });
  const plan = planSnapshot({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "snapshot",
    scope: "full_partner_catalog",
    partner: { status: "inactive" },
    collections: proofDocument().collections,
    products,
  }, pre);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.partnerStatusTransition?.from, "active");
  assert.equal(plan.partnerStatusTransition?.to, "inactive");
  assert.equal(plan.productDeactivations.length, 0);
  assert.equal(plan.variantDeactivations.length, 0);
  const next = plan.nextState;
  assert.ok(next);
  for (const product of next.products) {
    if (product.partnerId !== DEMO_FURNITURE_PARTNER_ID) continue;
    assert.equal(product.status, "active");
  }
});

test("PI-5F3C Partner inactive hides discovery, blocks Add, and keeps Summary identity", () => {
  const catalog = overlayFoldedPartnerCatalog(afterF3cState());
  const inactive = withInactivePartner(catalog);
  assert.equal(isStagePartnerActive(stagePartnerById(DEMO_FURNITURE_PARTNER_ID, inactive)), false);
  assert.equal(isStageProductAvailable(stageProductById(DEMO_SOFA_PRODUCT_ID, [], inactive)!, inactive), false);
  const browse = catalogQuery(inactive);
  assert.equal(browse.some((item) => item.partnerId === DEMO_FURNITURE_PARTNER_ID), false);
  assert.equal(STAGE_SEED_PRODUCTS.every((product) => (
    browse.some((item) => item.productId === product.productId) ||
    catalogQuery(inactive, { categoryId: product.categoryId }).some((item) => item.productId === product.productId) ||
    isStageProductAvailable(product, inactive)
  )), true);
  assert.equal(visibleStageCollections(inactive).some((item) => (
    item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
  )), false);
  assert.equal(isStageCollectionShoppingVisible(
    inactive.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID)!,
    inactive,
  ), false);
  const add = resolveStagePlacementResult({ productId: DEMO_SOFA_PRODUCT_ID, catalog: inactive });
  assert.equal(add.ok, false);
  if (!add.ok) assert.equal(add.code, "PARTNER_INACTIVE");
  const sofaPlaced = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: { productId: DEMO_SOFA_PRODUCT_ID, variantId: DEMO_SOFA_DEFAULT_VARIANT_ID },
    createObjectId: () => "so-sofa",
  });
  assert.equal(sofaPlaced.ok, true);
  if (!sofaPlaced.ok) return;
  const summary = buildStageSummary({ objects: [sofaPlaced.object], catalog: inactive });
  assert.equal(summary.lines[0]?.name, "Demo Sofa");
  assert.equal(summary.lines[0]?.brand, "Demo Furniture Co.");
  assert.equal(summary.lines[0]?.shoppable, false);
  const sofaKey = favoriteKey(DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_DEFAULT_VARIANT_ID);
  const keys = toggleFavoriteKeys(new Set(), DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(keys.has(sofaKey), true);
  const favorites = catalogQuery(inactive, { mode: "favorites", favoriteKeys: keys });
  assert.equal(favorites.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);
  assert.equal(keys.has(sofaKey), true);
  const recentIds = rememberRecentlyUsed([], DEMO_SOFA_PRODUCT_ID);
  const recent = catalogQuery(inactive, { mode: "recently_used", recentlyUsedProductIds: recentIds });
  assert.equal(recent.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), false);
  assert.deepEqual(recentIds, [DEMO_SOFA_PRODUCT_ID]);
  const restored = catalogQuery(catalog, { mode: "favorites", favoriteKeys: keys });
  assert.equal(restored.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), true);
});

test("PI-5F3C new Product/Variant/Collection creates are planned without durable proof", () => {
  const document = cloneSnapshot((current) => ({
    ...current,
    collections: [
      ...current.collections,
      {
        collectionId: NEW_DINING_COLLECTION_ID,
        name: "Demo Dining",
        slug: "demo-dining",
      },
    ],
    products: [
      ...current.products.map((item) => (
        item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
          ? {
            ...item,
            variants: [
              ...item.variants,
              {
                variantId: NEW_COFFEE_WHITE_VARIANT_ID,
                finishLabel: "White",
                sku: "DFC-COFFEE-WHITE",
                priceAmount: 419,
                priceCurrency: "USD",
                productUrl: null,
                currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
              },
            ],
          }
          : item
      )),
      {
        product: {
          productId: NEW_OTTOMAN_PRODUCT_ID,
          name: "Demo Ottoman",
          brand: "Demo Furniture Co.",
          retailer: "Demo Furniture Co.",
          categoryId: "living-room",
          subcategoryId: "chairs",
          imageUrl: "https://example.test/images/demo-ottoman.jpg",
          productUrl: "https://example.test/products/demo-ottoman",
          priceAmount: 299,
          priceCurrency: "USD",
          source: "partner_catalog",
          partnerId: DEMO_FURNITURE_PARTNER_ID,
          collectionIds: [NEW_DINING_COLLECTION_ID],
        },
        defaultVariant: {
          variantId: NEW_OTTOMAN_VARIANT_ID,
          finishLabel: "Natural",
          sku: "DFC-OTTOMAN-01",
          priceAmount: 299,
          priceCurrency: "USD",
          productUrl: null,
          currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        },
        variants: [],
      },
    ],
  }));
  const plan = planSnapshot(document);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.productCreates.some((item) => item.product.productId === NEW_OTTOMAN_PRODUCT_ID), true);
  assert.equal(plan.variantCreates.some((item) => item.variant.variantId === NEW_OTTOMAN_VARIANT_ID), true);
  assert.equal(plan.variantCreates.some((item) => item.variant.variantId === NEW_COFFEE_WHITE_VARIANT_ID), true);
  assert.equal(plan.collectionCreates.some((item) => item.collection.collectionId === NEW_DINING_COLLECTION_ID), true);
  assert.equal(plan.nextState?.products.length, preF3cState().products.length + 1);
});

test("PI-5F3C present Collection exact membership; omitted Collection unchanged", () => {
  const pre = preF3cState();
  const extraId = "col-demo-furniture-co-demo-archive";
  const current: FoldedPartnerCatalogState = {
    ...pre,
    collections: [
      ...pre.collections,
      {
        collectionId: extraId,
        name: "Demo Archive",
        owner: "partner",
        partnerName: "Demo Furniture Co.",
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        productIds: [DEMO_SOFA_PRODUCT_ID],
      },
    ],
    products: pre.products.map((product) => (
      product.productId === DEMO_SOFA_PRODUCT_ID
        ? { ...product, collectionIds: [...product.collectionIds, extraId] }
        : product
    )),
  };
  const document = cloneSnapshot((item) => ({
    ...item,
    products: item.products.map((product) => (
      product.product.productId === DEMO_SOFA_PRODUCT_ID
        ? { ...product, product: { ...product.product, collectionIds: [] } }
        : product.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
          ? {
            ...product,
            product: {
              ...product.product,
              collectionIds: [DEMO_LIVING_ROOM_COLLECTION_ID],
            },
          }
          : product
    )),
  }));
  const loungePresent = {
    product: {
      productId: DEMO_LOUNGE_CHAIR_PRODUCT_ID,
      name: "Demo Lounge Chair",
      brand: "Demo Furniture Co.",
      retailer: "Demo Furniture Co.",
      categoryId: "living-room",
      subcategoryId: "chairs",
      imageUrl: "https://example.test/images/demo-lounge-chair.jpg",
      productUrl: "https://example.test/products/demo-lounge-chair",
      priceAmount: 649,
      priceCurrency: "USD" as const,
      source: "partner_catalog" as const,
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      collectionIds: [DEMO_LIVING_ROOM_COLLECTION_ID],
    },
    defaultVariant: {
      variantId: DEMO_LOUNGE_CHAIR_VARIANT_ID,
      finishLabel: "Natural oak",
      sku: "DFC-CHAIR-01",
      priceAmount: 649,
      priceCurrency: "USD",
      productUrl: null,
      currentAssetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
    },
    variants: [],
  };
  const withAdd = {
    ...document,
    products: [...document.products.filter((item) => item.product.productId !== DEMO_SOFA_PRODUCT_ID), loungePresent],
  };
  const plan = planSnapshot(withAdd, current);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.membershipRemoves.some((item) => (
    item.productId === DEMO_SOFA_PRODUCT_ID && item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
  )), true);
  assert.equal(plan.membershipAdds.some((item) => (
    item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID && item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
  )), true);
  const extra = plan.nextState?.collections.find((item) => item.collectionId === extraId);
  assert.equal(extra?.name, "Demo Archive");
  assert.deepEqual(extra?.productIds, [DEMO_SOFA_PRODUCT_ID]);
});

test("PI-5F3C negatives fail closed with no SQL", () => {
  const retarget = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          variants: item.variants.map((variant) => (
            variant.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID
              ? { ...variant, currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }
              : variant
          )),
        }
        : item
    )),
  })));
  assert.equal(retarget.ok, false);
  assert.equal(hasCode(retarget, "ASSET_RETARGET_REQUIRED"), true);
  assert.equal(retarget.sqlPlan, null);
  assert.equal(retarget.nextState, null);

  const unknownAsset = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          variants: [
            ...item.variants,
            {
              variantId: NEW_COFFEE_WHITE_VARIANT_ID,
              finishLabel: "White",
              sku: "DFC-COFFEE-WHITE",
              priceAmount: 419,
              priceCurrency: "USD",
              productUrl: null,
              currentAssetId: "afc-v2-runtime/missing-asset",
            },
          ],
        }
        : item
    )),
  })));
  assert.equal(unknownAsset.ok, false);
  assert.equal(unknownAsset.sqlPlan, null);

  const zeroVariants = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          defaultVariant: {
            ...item.defaultVariant,
            variantId: "var-demo-furniture-co-demo-coffee-table-ghost",
          },
          variants: [],
        }
        : item
    )),
  })));
  assert.equal(zeroVariants.ok, false);
  assert.equal(zeroVariants.sqlPlan, null);

  const badDefault = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          defaultVariant: {
            ...item.defaultVariant,
            variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
            finishLabel: "Walnut",
            sku: DEMO_COFFEE_TABLE_WALNUT_SKU,
            priceAmount: DEMO_COFFEE_TABLE_WALNUT_PRICE,
            currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID,
          },
        }
        : item
    )),
  })));
  assert.equal(badDefault.ok, false);

  const currency = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          product: { ...item.product, priceCurrency: "EUR", priceAmount: 399 },
          defaultVariant: { ...item.defaultVariant, priceCurrency: "EUR" },
          variants: item.variants.map((variant) => ({ ...variant, priceCurrency: "EUR" })),
        }
        : item
    )),
  })));
  assert.equal(currency.ok, false);
  assert.equal(hasCode(currency, "CURRENCY_IMMUTABLE"), true);

  const dupSku = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          variants: item.variants.map((variant) => (
            variant.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID
              ? { ...variant, sku: DEMO_COFFEE_TABLE_WALNUT_SKU }
              : variant
          )),
        }
        : item
    )),
  })));
  assert.equal(dupSku.ok, false);
  assert.equal(hasCode(dupSku, "DUPLICATE_SKU"), true);

  const ownership = parsePartnerCatalogSnapshotJson({
    ...proofRaw() as object,
    products: [
      ...(proofDocument().products),
      {
        product: {
          ...proofDocument().products[0]!.product,
          productId: "prod-vibode-studio-sofa",
          source: "vibode_curated",
          partnerId: null,
        },
        defaultVariant: {
          ...proofDocument().products[0]!.defaultVariant,
          variantId: "var-vibode-studio-sofa-natural",
        },
        variants: [],
      },
    ],
  });
  assert.equal(ownership.ok, false);
  const owned = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item, index) => (
      index === 0
        ? {
          ...item,
          product: { ...item.product, productId: "prod-vibode-studio-sofa", partnerId: DEMO_FURNITURE_PARTNER_ID },
        }
        : item
    )),
  })));
  assert.equal(owned.ok, false);

  const dupProduct = parsePartnerCatalogSnapshotJson({
    ...proofRaw() as object,
    products: [...proofDocument().products, proofDocument().products[0]],
  });
  assert.equal(dupProduct.ok, false);
  assert.equal(hasCode(dupProduct, "DUPLICATE_PRODUCT_ID"), true);
  const dupVariant = parsePartnerCatalogSnapshotJson({
    ...proofRaw() as object,
    products: proofDocument().products.map((item, index) => (
      index === 0
        ? { ...item, variants: [...item.variants, item.defaultVariant] }
        : item
    )),
  });
  assert.equal(dupVariant.ok, false);
  assert.equal(hasCode(dupVariant, "DUPLICATE_VARIANT_ID"), true);
  const dupCollection = parsePartnerCatalogSnapshotJson({
    ...proofRaw() as object,
    collections: [...proofDocument().collections, proofDocument().collections[0]],
  });
  assert.equal(dupCollection.ok, false);
  assert.equal(hasCode(dupCollection, "DUPLICATE_COLLECTION_ID"), true);
});

test("PI-5F3C shuffled arrays are deterministic and mixed failure is atomic", () => {
  const first = planSnapshot(proofDocument());
  const shuffled = cloneSnapshot((document) => ({
    ...document,
    collections: [...document.collections].reverse(),
    products: [...document.products].reverse().map((item) => ({
      ...item,
      variants: [...item.variants].reverse(),
    })),
  }));
  const second = planSnapshot(shuffled);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.sqlPlan?.sql, second.sqlPlan?.sql);
  assert.deepEqual(
    first.productReactivations.map((item) => item.productId).sort(),
    second.productReactivations.map((item) => item.productId).sort(),
  );
  const mixed = planSnapshot(cloneSnapshot((document) => ({
    ...document,
    products: document.products.map((item) => (
      item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? {
          ...item,
          variants: item.variants.map((variant) => (
            variant.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID
              ? { ...variant, currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }
              : variant
          )),
        }
        : item
    )),
  })));
  assert.equal(mixed.ok, false);
  assert.equal(hasCode(mixed, "ASSET_RETARGET_REQUIRED"), true);
  assert.equal(mixed.sqlPlan, null);
  assert.equal(mixed.productReactivations.length, 0);
});

test("PI-5F3C generated SQL is transactional, guarded, and membership-delete only", () => {
  const sql = source(F3C_SQL);
  const parsed = parsePartnerCatalogSyncSql(sql);
  assert.equal(parsed.hasBegin, true);
  assert.equal(parsed.hasCommit, true);
  assert.equal(parsed.mentionsStaleSync, true);
  assert.equal(parsed.deletesProduct, false);
  assert.equal(parsed.deletesVariant, false);
  assert.equal(parsed.deletesPartner, false);
  assert.equal(parsed.deletesCollection, false);
  assert.equal(parsed.usesUpsert, false);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.updatesCurrentAssetId, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.touchesObjectsJson, false);
  assert.equal(parsed.insertsProduct, false);
  assert.equal(parsed.insertsCollection, false);
  assert.equal(parsed.partnerStatusTransitions.length, 0);
  assert.deepEqual([...parsed.statusUpdatedProductIds].sort(), [
    DEMO_LOUNGE_CHAIR_PRODUCT_ID,
    DEMO_SOFA_PRODUCT_ID,
  ].sort());
  assert.equal(parsed.updatedVariantIds.includes(DEMO_COFFEE_TABLE_BLACK_VARIANT_ID), true);
  assert.doesNotMatch(sql, /\bon\s+conflict\b/i);
  assert.match(sql, /status = 'inactive'/);
  assert.match(sql, /status = 'active'/);
  assert.match(sql, /price_amount = 459/);
  const deletes = [...sql.matchAll(/\bdelete\s+from\s+([a-z0-9_.]+)/gi)].map((item) => item[1]);
  assert.equal(deletes.every((table) => table === "public.vibode_stage_product_collections" || table == null), true);
});

test("PI-5F3C fold after snapshot is deterministic and no-op on the same document", () => {
  const first = afterF3cState();
  const second = foldPartnerCatalogCurrentState({ repoRoot: ROOT });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(second.state, first);
  assert.equal(first.products.length, 4);
  assert.equal(first.variants.length, 7);
  assert.equal(first.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "active");
  assert.equal(first.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)?.status, "inactive");
  assert.equal(first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID)?.status, "active");
  assert.equal(first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID)?.priceAmount, 459);
  assert.equal(first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID)?.status, "inactive");
  assert.equal(first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID)?.priceAmount, 439);
  assert.equal(first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID)?.status ?? "active", "active");
  assert.equal(first.products.find((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID)?.defaultVariantId, DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID);
  assert.equal(first.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID)?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(first.variants.find((item) => item.variantId === DEMO_SIDE_TABLE_VARIANT_ID)?.assetId, PI5F2_SIDE_TABLE_ASSET_ID);
  assert.equal(first.partners[0]?.status, "active");
  const again = planSnapshot(proofDocument(), first);
  assert.equal(again.ok, true, JSON.stringify(again.issues));
  assert.equal(again.noOp, true);
  assert.equal(again.sqlPlan, null);
});

test("PI-5F3C proof discovery, Coffee selector, Add, and historical Summary", () => {
  const catalog = overlayFoldedPartnerCatalog(afterF3cState());
  const browse = catalogQuery(catalog);
  assert.equal(browse.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(browse.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), true);
  assert.equal(browse.some((item) => item.productId === DEMO_SIDE_TABLE_PRODUCT_ID), true);
  assert.equal(browse.some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), false);
  assert.equal(catalogQuery(catalog, { query: "Sofa" }).some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(catalogQuery(catalog, { query: "Lounge Chair" }).some((item) => (
    item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID
  )), false);
  const activeCoffee = activeStageVariantsForProduct(DEMO_COFFEE_TABLE_PRODUCT_ID, [], catalog);
  assert.deepEqual(activeCoffee.map((item) => item.variantId).sort(), [
    DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
  ].sort());
  assert.equal(stageVariantById(DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, [], catalog)?.priceAmount, 459);
  assert.equal(resolveStagePlacement({ productId: DEMO_SOFA_PRODUCT_ID, catalog })?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(resolveStagePlacement({
    productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
    variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
    catalog,
  })?.assetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(resolveStagePlacement({
    productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
    variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
    catalog,
  }), null);
  const loungeGate = resolveStagePlacementResult({ productId: DEMO_LOUNGE_CHAIR_PRODUCT_ID, catalog });
  assert.equal(loungeGate.ok, false);
  if (!loungeGate.ok) assert.equal(loungeGate.code, "PRODUCT_INACTIVE");

  const loungePlaced = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
    identity: { productId: DEMO_LOUNGE_CHAIR_PRODUCT_ID, variantId: DEMO_LOUNGE_CHAIR_VARIANT_ID },
    createObjectId: () => "so-lounge",
  });
  assert.equal(loungePlaced.ok, true);
  if (!loungePlaced.ok) return;
  const loungeSummary = buildStageSummary({ objects: [loungePlaced.object], catalog });
  assert.equal(loungeSummary.lines[0]?.name, "Demo Lounge Chair");
  assert.equal(loungeSummary.lines[0]?.shoppable, false);
  assert.equal(loungePlaced.object.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);

  const walnutPlaced = addSceneObject({
    objects: [],
    assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
    identity: { productId: DEMO_COFFEE_TABLE_PRODUCT_ID, variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID },
    createObjectId: () => "so-walnut",
  });
  assert.equal(walnutPlaced.ok, true);
  if (!walnutPlaced.ok) return;
  const walnutSummary = buildStageSummary({ objects: [walnutPlaced.object], catalog });
  assert.equal(walnutSummary.lines[0]?.variantLabel, "Walnut");
  assert.equal(walnutSummary.lines[0]?.unitPrice, 439);
  assert.equal(walnutSummary.lines[0]?.shoppable, false);

  const blackPlaced = addSceneObject({
    objects: [],
    assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
    identity: { productId: DEMO_COFFEE_TABLE_PRODUCT_ID, variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID },
    createObjectId: () => "so-black",
  });
  assert.equal(blackPlaced.ok, true);
  if (!blackPlaced.ok) return;
  const blackSummary = buildStageSummary({ objects: [blackPlaced.object], catalog });
  assert.equal(blackSummary.lines[0]?.variantLabel, "Black");
  assert.equal(blackSummary.lines[0]?.unitPrice, 459);
  assert.equal(blackSummary.lines[0]?.shoppable, true);

  const sofaPlaced = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: { productId: DEMO_SOFA_PRODUCT_ID, variantId: DEMO_SOFA_DEFAULT_VARIANT_ID },
    createObjectId: () => "so-sofa-live",
  });
  assert.equal(sofaPlaced.ok, true);
  if (!sofaPlaced.ok) return;
  const sofaSummary = buildStageSummary({ objects: [sofaPlaced.object], catalog });
  assert.equal(sofaSummary.lines[0]?.shoppable, true);
  assert.equal(GENERATED_REGISTERED_PRODUCTS.some((product) => product.source === "partner_catalog"), false);
});

test("PI-5F3C drift stays clean and Scene/viewer/Asset/retarget stay frozen", () => {
  assert.deepEqual(detectPartnerCatalogSyncDrift(), []);
  assert.deepEqual(detectPartnerCatalogDrift(), []);
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  assert.deepEqual(detectVariantAssetAssociationDrift(), []);
  assert.deepEqual(detectProductVariantRegistrationDrift(), []);
  const snapshotModule = source("lib/vibode-stage/partner-catalog-snapshot.ts");
  const syncModule = source("lib/vibode-stage/partner-catalog-sync.ts");
  assert.doesNotMatch(snapshotModule, /retargetVariantCurrentAsset|planVariantAssociation|registerVariant\(/);
  assert.doesNotMatch(syncModule, /retargetVariantCurrentAsset|planVariantAssociation/);
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  assert.equal(viewer, gitShow("components/afc-3d/AfcProductionRoomViewer.tsx"));
  assert.equal(crud, gitShow("lib/afc-v2-runtime/scene-crud.ts"));
  assert.equal(persisted, gitShow("lib/afc-v2-runtime/persisted-scene.ts"));
  assert.doesNotMatch(viewer, /partner-sync|partner-catalog-sync|partner-catalog-snapshot/);
  assert.doesNotMatch(source("lib/vibode-stage/catalog.ts"), /partner-catalog-sync|partner-catalog-snapshot/);
});

test("PI-5F3C CLI --check is structured, writes nothing, and service import can emit SQL", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(
    pkg.scripts["test:afc-v2-pi5f3c"],
    "node --conditions=react-server --import tsx --test --test-concurrency=1 lib/vibode-stage/pi5f3c-partner-snapshot.test.ts",
  );
  const repoRoot = tmpRepo();
  const check = runCli([
    "--input",
    PI5F3C_SYNC_JSON_RELATIVE_PATH,
    "--check",
    "--repo-root",
    repoRoot,
    "--migration-timestamp",
    PI5F3C_SYNC_MIGRATION_TIMESTAMP,
  ], ROOT);
  assert.notEqual(check.status, 0);
  assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")), []);
  const liveCheck = runCli([
    "--input",
    PI5F3C_SYNC_JSON_RELATIVE_PATH,
    "--check",
    "--migration-timestamp",
    PI5F3C_SYNC_MIGRATION_TIMESTAMP,
  ]);
  assert.equal(liveCheck.status, 0, liveCheck.stderr + liveCheck.stdout);
  const payload = JSON.parse(liveCheck.stdout) as {
    ok: boolean;
    check: boolean;
    noOp: boolean;
    written: null;
    productReactivations: Array<{ productId: string }>;
    productDeactivations: Array<{ productId: string }>;
    variantReactivations: Array<{ variantId: string }>;
    variantDeactivations: Array<{ variantId: string }>;
    variantUpdates: Array<{ variantId: string; changes: Array<{ next: unknown }> }>;
    partnerStatusTransition: null;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.check, true);
  assert.equal(payload.noOp, false);
  assert.equal(payload.written, null);
  assert.equal(payload.partnerStatusTransition, null);
  assert.equal(payload.productReactivations.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(payload.productDeactivations.some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);
  assert.equal(payload.variantReactivations.some((item) => item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID), true);
  assert.equal(payload.variantDeactivations.some((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID), true);
  const writeRepo = tmpRepo();
  const written = importPartnerCatalogSnapshot({
    document: proofDocument(),
    repoRoot: writeRepo,
    current: preF3cState(),
    migrationTimestamp: PI5F3C_SYNC_MIGRATION_TIMESTAMP,
    sqlSlug: PI5F3C_SYNC_SQL_SLUG,
  });
  assert.equal(written.ok, true, JSON.stringify(written.ok ? null : written.issues));
  assert.equal(written.noOp, false);
  assert.ok(written.migration);
  assert.equal(existsSync(written.migration!), true);
});
