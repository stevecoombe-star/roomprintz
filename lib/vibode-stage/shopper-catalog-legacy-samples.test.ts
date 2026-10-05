import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createStageCatalogSnapshot,
  favoriteKey,
  resolveStagePlacement,
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
  STAGE_SEED_PRODUCTS,
  STAGE_SEED_VARIANTS,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
} from "./catalog";
import {
  isLegacyShopperCatalogSample,
  LEGACY_SHOPPER_CATALOG_SAMPLE_PRODUCT_IDS,
  visibleStageCatalogProducts,
} from "./catalog-query";
import type { StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const PARTNER_ID = "partner-shopper-catalog";
const PARTNER_SOFA_ID = "prod-partner-shopper-sofa";
const PARTNER_CHAIR_ID = "prod-partner-shopper-chair";
const PARTNER_TABLE_ID = "prod-partner-shopper-table";
const PASTED_ID = "prod-user-pasted-lamp";

function partnerProduct(
  productId: string,
  name: string,
  subcategoryId: string,
  collectionIds: readonly string[],
  status: "active" | "inactive" = "active",
): StageProduct {
  return {
    productId,
    brand: "Harbor",
    name,
    retailer: "Harbor",
    categoryId: "living-room",
    subcategoryId,
    productUrl: "https://example.test/harbor",
    imageUrl: "https://example.test/harbor.jpg",
    priceAmount: 1200,
    priceCurrency: "USD",
    defaultVariantId: `${productId}-default`,
    collectionIds,
    source: "partner_catalog",
    partnerId: PARTNER_ID,
    status,
    sortOrder: 0,
  };
}

function variantFor(product: StageProduct): StageVariant {
  return {
    variantId: product.defaultVariantId,
    productId: product.productId,
    assetId: "afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1",
    finishLabel: "Oak",
    sku: null,
    priceAmount: product.priceAmount,
    priceCurrency: "USD",
    productUrl: product.productUrl,
    status: product.status ?? "active",
  };
}

const PARTNER_SOFA = partnerProduct(
  PARTNER_SOFA_ID,
  "Harbor Sofa",
  "sofas",
  ["col-harbor-living"],
);
const INACTIVE_CHAIR = partnerProduct(
  PARTNER_CHAIR_ID,
  "Harbor Chair",
  "chairs",
  ["col-harbor-living"],
  "inactive",
);
const PARTNER_TABLE = partnerProduct(
  PARTNER_TABLE_ID,
  "Harbor Side Table",
  "side-tables",
  ["col-harbor-living"],
);
const PASTED: StageProduct = {
  productId: PASTED_ID,
  brand: "Pasted",
  name: "Pasted Lamp",
  retailer: "Pasted",
  categoryId: "lighting",
  subcategoryId: null,
  productUrl: "https://example.test/lamp",
  imageUrl: "https://example.test/lamp.jpg",
  priceAmount: null,
  priceCurrency: "USD",
  defaultVariantId: `${PASTED_ID}-default`,
  collectionIds: [],
  source: "user_pasted",
  partnerId: null,
  status: "active",
};

const ORDERED_PRODUCTS: readonly StageProduct[] = [
  ...STAGE_SEED_PRODUCTS,
  PARTNER_SOFA,
  INACTIVE_CHAIR,
  PARTNER_TABLE,
  PASTED,
];

function shopper(input: Partial<Parameters<typeof visibleStageCatalogProducts>[0]> = {}) {
  const catalog = createStageCatalogSnapshot({
    authority: "durable",
    products: ORDERED_PRODUCTS,
    variants: [
      ...STAGE_SEED_VARIANTS,
      variantFor(PARTNER_SOFA),
      variantFor(INACTIVE_CHAIR),
      variantFor(PARTNER_TABLE),
      variantFor(PASTED),
    ],
    assets: STAGE_SEED_ASSETS,
    collections: [
      ...STAGE_SEED_CATALOG.collections,
      {
        collectionId: "col-harbor-living",
        name: "Harbor Living",
        owner: "partner",
        partnerName: "Harbor",
        partnerId: PARTNER_ID,
        productIds: [PARTNER_SOFA_ID, PARTNER_CHAIR_ID, PARTNER_TABLE_ID],
      },
    ],
    partners: [{
      partnerId: PARTNER_ID,
      name: "Harbor",
      slug: "harbor",
      status: "active",
      websiteUrl: null,
      logoUrl: null,
    }],
  });
  return visibleStageCatalogProducts({
    products: ORDERED_PRODUCTS,
    variants: catalog.variants,
    partners: catalog.partners,
    catalog,
    mode: "browse",
    query: "",
    categoryId: null,
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
    recentlyUsedProductIds: [],
    ...input,
  });
}

function assertLegacySamplesAbsent(products: readonly StageProduct[]) {
  for (const productId of LEGACY_SHOPPER_CATALOG_SAMPLE_PRODUCT_IDS) {
    assert.equal(products.some((product) => product.productId === productId), false, productId);
  }
}

test("shopper catalog planner excludes the four legacy Vibode samples", () => {
  assert.deepEqual(LEGACY_SHOPPER_CATALOG_SAMPLE_PRODUCT_IDS, [
    STAGE_STUDIO_SOFA_PRODUCT_ID,
    STAGE_STUDIO_SETTEE_PRODUCT_ID,
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
    STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
  ]);
  for (const product of STAGE_SEED_PRODUCTS) {
    assert.equal(isLegacyShopperCatalogSample(product.productId), true);
  }

  const browse = shopper();
  assert.deepEqual(browse.map((product) => product.productId), [
    PARTNER_SOFA_ID,
    PARTNER_TABLE_ID,
    PASTED_ID,
  ]);
  assertLegacySamplesAbsent(browse);

  const living = shopper({ categoryId: "living-room" });
  assert.deepEqual(living.map((product) => product.productId), [
    PARTNER_SOFA_ID,
    PARTNER_TABLE_ID,
  ]);
  const chairs = shopper({ categoryId: "living-room", subcategoryId: "chairs" });
  assert.deepEqual(chairs.map((product) => product.productId), []);
  const sofas = shopper({ categoryId: "living-room", subcategoryId: "sofas" });
  assert.deepEqual(sofas.map((product) => product.productId), [PARTNER_SOFA_ID]);

  const search = shopper({ query: "Studio" });
  assert.deepEqual(search.map((product) => product.productId), []);
  const harbor = shopper({ query: "Harbor Side" });
  assert.deepEqual(harbor.map((product) => product.productId), [PARTNER_TABLE_ID]);
});

test("Browse, Collections, Recent, and Favorites keep partner order without the samples", () => {
  const collection = shopper({
    mode: "collections",
    collectionId: "col-harbor-living",
  });
  assert.deepEqual(collection.map((product) => product.productId), [
    PARTNER_SOFA_ID,
    PARTNER_TABLE_ID,
  ]);
  const legacyCollection = shopper({
    mode: "collections",
    collectionId: "col-vibode-picks",
  });
  assert.deepEqual(legacyCollection.map((product) => product.productId), []);

  const recent = shopper({
    mode: "recently_used",
    recentlyUsedProductIds: [
      STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
      PARTNER_TABLE_ID,
      STAGE_STUDIO_SOFA_PRODUCT_ID,
      PARTNER_SOFA_ID,
      PARTNER_CHAIR_ID,
    ],
  });
  assert.deepEqual(recent.map((product) => product.productId), [
    PARTNER_TABLE_ID,
    PARTNER_SOFA_ID,
  ]);

  const favoriteKeys = new Set([
    favoriteKey(STAGE_STUDIO_SOFA_PRODUCT_ID, "var-vibode-studio-sofa-default"),
    favoriteKey(PARTNER_TABLE_ID, PARTNER_TABLE.defaultVariantId),
    favoriteKey(PARTNER_CHAIR_ID, INACTIVE_CHAIR.defaultVariantId),
  ]);
  const favorites = shopper({ mode: "favorites", favoriteKeys });
  assert.deepEqual(favorites.map((product) => product.productId), [PARTNER_TABLE_ID]);
  assertLegacySamplesAbsent(favorites);
});

test("legacy sample assets and placement records stay in the seed catalog", () => {
  assert.equal(STAGE_SEED_PRODUCTS.length, 4);
  assert.deepEqual(
    STAGE_SEED_CATALOG.products.map((product) => product.name),
    ["Studio Sofa", "Studio Settee", "Studio Lounge Chair", "Studio Side Table"],
  );
  for (const productId of LEGACY_SHOPPER_CATALOG_SAMPLE_PRODUCT_IDS) {
    assert.equal(
      STAGE_SEED_CATALOG.variants.some((variant) => variant.productId === productId),
      true,
      productId,
    );
  }
  const placement = resolveStagePlacement({
    productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.equal(placement?.assetId, "afc-v2-runtime/test-fixtures/pi4a-sofa");
  assert.equal(
    resolveStagePlacement({
      productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
      catalog: STAGE_SEED_CATALOG,
    })?.assetId,
    "afc-v2-runtime/test-fixtures/pi5d-lounge-chair",
  );
  assert.equal(
    resolveStagePlacement({
      productId: STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
      catalog: STAGE_SEED_CATALOG,
    })?.assetId,
    "afc-v2-runtime/test-fixtures/pi5d2-side-table",
  );

  for (const relativePath of [
    "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb",
    "public/afc-v2-runtime/test-fixtures/pi5d-lounge-chair.glb",
    "public/afc-v2-runtime/test-fixtures/pi5d2-side-table.glb",
    "public/vibode-stage/studio-sofa.svg",
    "public/vibode-stage/studio-settee.svg",
    "public/vibode-stage/studio-chair.svg",
    "public/vibode-stage/studio-side-table.svg",
  ]) {
    assert.equal(existsSync(path.join(ROOT, relativePath)), true, relativePath);
  }

  const drawer = readFileSync(path.join(ROOT, "components/stage/StageCatalogDrawer.tsx"), "utf8");
  assert.match(drawer, /visibleStageCatalogProducts/);
  assert.equal(STAGE_SEED_CATALOG.assets.length > 0, true);
  assert.equal(
    STAGE_SEED_CATALOG.products.some((product) => product.productId === STAGE_STUDIO_SETTEE_PRODUCT_ID),
    true,
  );
});
