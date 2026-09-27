import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerCatalogWorkspace } from "../../app/partner/catalog/PartnerCatalogWorkspace";
import { createStageCatalogSnapshot } from "./catalog";
import {
  buildPartnerCatalogRows,
  filterPartnerCatalogRows,
  partnerCatalogEditorPath,
  type PartnerCatalogProductRow,
} from "./partner-catalog-workspace";
import type { StageAsset, StageCatalogSnapshot, StageCollection, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const DRAFT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function product(
  overrides: Partial<StageProduct> & Pick<StageProduct, "productId" | "name">,
): StageProduct {
  return {
    brand: "Demo",
    retailer: "Demo",
    categoryId: "seating",
    subcategoryId: null,
    productUrl: "https://example.test/product",
    imageUrl: "https://cdn.test/product.jpg",
    priceAmount: null,
    priceCurrency: "USD",
    defaultVariantId: "var-default",
    collectionIds: [],
    source: "partner_catalog",
    partnerId: "partner-demo-furniture-co",
    status: "active",
    ...overrides,
  };
}

function variant(
  overrides: Partial<StageVariant> & Pick<StageVariant, "variantId" | "productId">,
): StageVariant {
  return {
    assetId: null,
    finishLabel: null,
    sku: null,
    priceAmount: null,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
    ...overrides,
  };
}

function asset(assetId: string, status: StageAsset["status"]): StageAsset {
  return {
    assetId,
    glbUrl: "https://cdn.test/model.glb",
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
    status,
  };
}

function collection(collectionId: string, name: string, productIds: readonly string[]): StageCollection {
  return {
    collectionId,
    name,
    owner: "partner",
    partnerName: "Demo Furniture Co.",
    partnerId: "partner-demo-furniture-co",
    productIds,
  };
}

function catalogFixture(): StageCatalogSnapshot {
  const coffeeAsset = asset("asset-coffee", "ready");
  const sofaReady = asset("asset-sofa-walnut", "ready");
  const sofaBlocked = asset("asset-sofa-stone", "unavailable");
  const bookAsset = asset("asset-book", "ready");
  const loungeAsset = asset("asset-lounge", "ready");
  const ottomanAsset = asset("asset-ottoman", "unavailable");
  return createStageCatalogSnapshot({
    authority: "durable",
    products: [
      product({
        productId: "prod-coffee",
        name: "Coffee Table",
        priceAmount: 459,
        imageUrl: "https://cdn.test/coffee.jpg",
        defaultVariantId: "var-coffee",
        collectionIds: ["col-living", "col-living"],
      }),
      product({
        productId: "prod-sofa",
        name: "Sofa",
        priceAmount: 1800,
        defaultVariantId: "var-sofa-walnut",
        collectionIds: ["col-living"],
      }),
      product({
        productId: "prod-book",
        name: "Bookcase",
        priceAmount: 700,
        defaultVariantId: "var-book-oak",
      }),
      product({
        productId: "prod-lounge",
        name: "Lounge Chair",
        priceAmount: 900,
        status: "inactive",
        defaultVariantId: "var-lounge",
        collectionIds: ["col-lounge"],
      }),
      product({
        productId: "prod-side",
        name: "Side Table",
        imageUrl: "",
        priceAmount: null,
        collectionIds: ["col-missing"],
        defaultVariantId: "var-side",
      }),
      product({
        productId: "prod-ottoman",
        name: "Ottoman",
        priceAmount: 400,
        defaultVariantId: "var-ottoman",
      }),
      product({
        productId: "prod-bench",
        name: "Bench",
        priceAmount: null,
        defaultVariantId: "var-bench",
      }),
    ],
    variants: [
      variant({
        variantId: "var-coffee",
        productId: "prod-coffee",
        assetId: coffeeAsset.assetId,
        finishLabel: "Walnut",
        sku: "DFC-CT-WAL",
        priceAmount: 459,
      }),
      variant({
        variantId: "var-sofa-walnut",
        productId: "prod-sofa",
        assetId: sofaReady.assetId,
        finishLabel: "Walnut",
        sku: "DFC-SOFA-WAL",
      }),
      variant({
        variantId: "var-sofa-stone",
        productId: "prod-sofa",
        assetId: sofaBlocked.assetId,
        finishLabel: "Stone",
        sku: "DFC-SOFA-STN",
        status: "inactive",
      }),
      variant({
        variantId: "var-book-oak",
        productId: "prod-book",
        assetId: bookAsset.assetId,
        finishLabel: "Oak",
        sku: "DFC-BOOK-OAK",
      }),
      variant({
        variantId: "var-book-maple",
        productId: "prod-book",
        finishLabel: "Maple",
        sku: "DFC-BOOK-MAP",
      }),
      variant({
        variantId: "var-book-plain",
        productId: "prod-book",
      }),
      variant({
        variantId: "var-lounge",
        productId: "prod-lounge",
        assetId: loungeAsset.assetId,
        finishLabel: "Linen",
        sku: "DFC-LOUNGE",
      }),
      variant({
        variantId: "var-side",
        productId: "prod-side",
        assetId: null,
        finishLabel: "Oak",
        sku: "DFC-SIDE",
      }),
      variant({
        variantId: "var-ottoman",
        productId: "prod-ottoman",
        assetId: "asset-missing",
        finishLabel: "Black",
        sku: "DFC-OTT",
      }),
    ],
    assets: [coffeeAsset, sofaReady, sofaBlocked, bookAsset, loungeAsset, ottomanAsset],
    collections: [
      collection("col-living", "Living Room", ["prod-coffee", "prod-sofa"]),
      collection("col-lounge", "Lounge", ["prod-lounge"]),
    ],
    partners: [{
      partnerId: "partner-demo-furniture-co",
      name: "Demo Furniture Co.",
      slug: "demo-furniture-co",
      status: "active",
      websiteUrl: null,
      logoUrl: null,
    }],
  });
}

function rows(): readonly PartnerCatalogProductRow[] {
  return buildPartnerCatalogRows(catalogFixture());
}

function row(name: string): PartnerCatalogProductRow {
  const found = rows().find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function markup(props: Parameters<typeof PartnerCatalogWorkspace>[0]): string {
  return renderToStaticMarkup(createElement(PartnerCatalogWorkspace, props));
}

test("A catalog rows keep merchandise order, price, collections, and variant summary", () => {
  const loaded = rows();
  assert.deepEqual(loaded.map((item) => item.name), [
    "Coffee Table",
    "Sofa",
    "Bookcase",
    "Lounge Chair",
    "Side Table",
    "Ottoman",
    "Bench",
  ]);
  assert.equal(row("Coffee Table").priceLabel, "$459");
  assert.equal(row("Sofa").priceLabel, "$1,800");
  assert.deepEqual(row("Coffee Table").collectionNames, ["Living Room"]);
  assert.equal(row("Coffee Table").variantSummary, "Walnut · SKU DFC-CT-WAL");
  assert.equal(row("Coffee Table").variantCountLabel, "1 variant");
  assert.equal(row("Sofa").variantCountLabel, "2 variants");
  assert.equal(row("Side Table").collectionNames.length, 0);
  assert.equal(row("Side Table").priceLabel, "");
  assert.equal(row("Bench").variantCountLabel, "No variants");
  assert.equal(row("Coffee Table").searchText.includes("prod-coffee"), false);
  assert.equal(row("Coffee Table").searchText.includes("var-coffee"), false);
  assert.equal(row("Coffee Table").searchText.includes("asset-coffee"), false);
  assert.equal(row("Coffee Table").searchText.includes("col-living"), false);
});

test("B inactive products stay visible and are labeled Inactive", () => {
  const loaded = rows();
  const lounge = row("Lounge Chair");
  assert.equal(lounge.status, "inactive");
  assert.equal(lounge.statusLabel, "Inactive");
  assert.equal(loaded.some((item) => item.name === "Lounge Chair"), true);
  const html = markup({
    rows: loaded,
    openDraftId: null,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(html, /Lounge Chair/);
  assert.match(html, />Inactive</);
  assert.match(html, /Coffee Table/);
  assert.match(html, />Active</);
});

test("C search matches name, SKU, finish, and collection name", () => {
  const loaded = rows();
  const names = (query: string) => filterPartnerCatalogRows(loaded, {
    query,
    status: "all",
    readiness: "all",
  }).map((item) => item.name);

  assert.deepEqual(names("coffee"), ["Coffee Table"]);
  assert.deepEqual(names("DFC-CT-WAL"), ["Coffee Table"]);
  assert.deepEqual(names("stone"), ["Sofa"]);
  assert.deepEqual(names("living room"), ["Coffee Table", "Sofa"]);
  assert.deepEqual(names("linen lounge"), ["Lounge Chair"]);
  assert.deepEqual(names("   "), loaded.map((item) => item.name));
  assert.deepEqual(names("prod-coffee"), []);
  assert.deepEqual(names("var-coffee"), []);
  assert.deepEqual(names("not-a-product"), []);
});

test("D status filter keeps Active and Inactive separate without dropping the default list", () => {
  const loaded = rows();
  const names = (status: "all" | "active" | "inactive") => filterPartnerCatalogRows(loaded, {
    query: "",
    status,
    readiness: "all",
  }).map((item) => item.name);

  assert.equal(names("all").includes("Lounge Chair"), true);
  assert.equal(names("all").includes("Coffee Table"), true);
  assert.deepEqual(names("inactive"), ["Lounge Chair"]);
  assert.equal(names("active").includes("Lounge Chair"), false);
  assert.equal(names("active").includes("Coffee Table"), true);
  assert.deepEqual(
    filterPartnerCatalogRows(loaded, { query: "chair", status: "inactive", readiness: "all" }).map((item) => item.name),
    ["Lounge Chair"],
  );
});

test("E a product whose referenced assets are ready is labeled Ready", () => {
  const coffee = row("Coffee Table");
  assert.equal(coffee.readiness, "ready");
  assert.equal(coffee.readinessLabel, "Ready");
  const html = markup({
    rows: [coffee],
    openDraftId: null,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(html, /Ready/);
  assert.match(html, /\$459/);
  assert.match(html, /Living Room/);
  assert.match(html, /https:\/\/cdn\.test\/coffee\.jpg/);
  assert.doesNotMatch(html, /prod-coffee|var-coffee|asset-coffee|col-living|partner-demo/);
});

test("F a product without a referenced asset is labeled No model", () => {
  const side = row("Side Table");
  const bench = row("Bench");
  assert.equal(side.readiness, "no_model");
  assert.equal(side.readinessLabel, "No model");
  assert.equal(bench.readiness, "no_model");
  const html = markup({
    rows: [side],
    openDraftId: null,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(html, /No model/);
  assert.match(html, /No image/);
  assert.match(html, /Price on request/);
  assert.doesNotMatch(html, /col-missing|prod-side|var-side/);
});

test("G unresolved or unready assets need attention, and mixed variants say how many are ready", () => {
  const catalog = catalogFixture();
  const statuses = catalog.assets.map((item) => item.status);
  const loaded = buildPartnerCatalogRows(catalog);
  assert.deepEqual(catalog.assets.map((item) => item.status), statuses);
  assert.equal(row("Ottoman").readiness, "needs_attention");
  assert.equal(row("Ottoman").readinessLabel, "Needs attention");
  assert.equal(row("Bookcase").readiness, "needs_attention");
  assert.equal(row("Bookcase").readinessLabel, "1 of 3 ready");
  assert.equal(row("Sofa").readinessLabel, "1 of 2 ready");

  const attention = filterPartnerCatalogRows(loaded, {
    query: "",
    status: "all",
    readiness: "needs_attention",
  }).map((item) => item.name);
  assert.deepEqual(attention, ["Sofa", "Bookcase", "Ottoman"]);
  assert.deepEqual(
    filterPartnerCatalogRows(loaded, { query: "", status: "all", readiness: "ready" }).map((item) => item.name),
    ["Coffee Table", "Lounge Chair"],
  );
  assert.deepEqual(
    filterPartnerCatalogRows(loaded, { query: "", status: "all", readiness: "no_model" }).map((item) => item.name),
    ["Side Table", "Bench"],
  );

  const html = markup({
    rows: [row("Bookcase"), row("Ottoman")],
    openDraftId: null,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(html, /1 of 3 ready/);
  assert.match(html, /Needs attention/);
  assert.doesNotMatch(html, /asset-missing|asset-ottoman|prod-ottoman/);
});

test("H an open draft with changes is unpublished and continues into the existing editor", () => {
  const html = markup({
    rows: [row("Coffee Table")],
    openDraftId: DRAFT_ID,
    hasUnpublishedChanges: true,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(html, /Unpublished changes/);
  assert.match(html, /You have catalog changes that have not been published yet\./);
  assert.match(html, /Continue editing/);
  assert.match(html, new RegExp(`href="/partner/catalog/drafts/${DRAFT_ID}"`));
  assert.doesNotMatch(html, /Resume draft|Edit catalog|revision/i);
});

test("I Add product reaches the existing draft workspace creation path", () => {
  assert.equal(
    partnerCatalogEditorPath(DRAFT_ID, "add-product"),
    `/partner/catalog/drafts/${DRAFT_ID}?intent=add-product`,
  );
  assert.equal(
    partnerCatalogEditorPath(DRAFT_ID, "manage"),
    `/partner/catalog/drafts/${DRAFT_ID}`,
  );

  const withDraft = markup({
    rows: [row("Coffee Table")],
    openDraftId: DRAFT_ID,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(withDraft, /Add product/);
  assert.match(withDraft, new RegExp(`href="/partner/catalog/drafts/${DRAFT_ID}\\?intent=add-product"`));

  const firstProduct = markup({
    rows: [],
    openDraftId: null,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: false,
  });
  assert.match(firstProduct, /No products yet/);
  assert.match(firstProduct, /Add your first product to start building your Vibode catalog\./);
  assert.match(firstProduct, /Add product/);
  assert.doesNotMatch(firstProduct, /Go to 3D Models/);

  const needsModel = markup({
    rows: [],
    openDraftId: null,
    hasUnpublishedChanges: false,
    needsModelBeforeFirstProduct: true,
  });
  assert.match(needsModel, /A 3D model is needed before your first product can be added\./);
  assert.match(needsModel, /href="\/partner\/assets"/);
  assert.match(needsModel, /Go to 3D Models/);
  assert.doesNotMatch(needsModel, /Add product/);
  assert.doesNotMatch(needsModel, /mapped ready Partner Asset/);

  const workspace = source("app/partner/catalog/PartnerCatalogWorkspace.tsx");
  const draftPage = source("app/partner/catalog/drafts/[draftId]/page.tsx");
  const draftClient = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.match(workspace, /\/api\/vibode\/partner\/drafts/);
  assert.match(workspace, /method: "POST"/);
  assert.match(workspace, /partnerCatalogEditorPath/);
  assert.match(draftPage, /intent === "add-product"/);
  assert.match(draftPage, /openProductCreate=/);
  assert.match(draftClient, /id="partner-add-product"/);
  assert.match(draftClient, /openProductCreate && canCreateProduct/);
  assert.match(draftClient, /Product creation requires a mapped, ready Partner Asset/);
});

test("J partner catalog no longer shows planner diagnostic controls", () => {
  const catalogPage = source("app/partner/catalog/page.tsx");
  const workspace = source("app/partner/catalog/PartnerCatalogWorkspace.tsx");
  const home = source("app/partner/page.tsx");
  const layout = source("app/partner/layout.tsx");
  const nav = source("app/partner/PartnerPortalNav.tsx");
  const previewRoute = source("app/api/vibode/partner/catalog/preview/route.ts");
  const joinedUi = [catalogPage, workspace, home, layout, nav].join("\n");

  assert.equal(existsSync(path.join(ROOT, "app/partner/PartnerCatalogPreviewClient.tsx")), false);
  assert.equal(existsSync(path.join(ROOT, "app/partner/catalog/PartnerCatalogDraftEntry.tsx")), false);
  assert.doesNotMatch(joinedUi, /Preview no-op|Preview name change|Preview Asset replacement|Certified patch preview/);
  assert.doesNotMatch(joinedUi, /PartnerCatalogPreviewClient|PI-5F|planVersion|canonical patch/);
  assert.match(catalogPage, /<h1[^>]*>Catalog<\/h1>/);
  assert.match(catalogPage, /Manage the products available through Vibode\./);
  assert.match(catalogPage, /buildPartnerCatalogRows/);
  assert.match(catalogPage, /countPartnerDraftOperations/);
  assert.match(catalogPage, /loadPartnerCommercialAssetsForPortal/);
  assert.doesNotMatch(catalogPage, /Durable catalog|commercial status|Curated catalog/);
  assert.match(previewRoute, /export async function POST/);
  assert.match(previewRoute, /partnerPortalPreviewResponse/);
  assert.match(nav, /Catalog/);
  assert.match(nav, /3D Models/);
  assert.match(nav, /href="\/partner\/catalog"/);
  assert.match(nav, /href="\/partner\/assets"/);
  assert.doesNotMatch(nav, /Overview|"Assets"/);
  assert.doesNotMatch(layout, /commercial status|partner\.partnerId|>Overview<|>Assets</);
  assert.match(home, /Unpublished changes/);
  assert.match(home, /Continue editing/);
  assert.match(home, /Your Vibode furniture catalog\./);
  assert.match(workspace, /filterPartnerCatalogRows\(props\.rows/);
  assert.match(source("app/partner/assets/page.tsx"), /<h1[^>]*>3D Models<\/h1>/);
});
