import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerAddProductFlow } from "../../app/partner/catalog/new/PartnerAddProductFlow";
import { PartnerCatalogWorkspace } from "../../app/partner/catalog/PartnerCatalogWorkspace";
import { createStageCatalogSnapshot } from "./catalog";
import {
  PARTNER_ADD_PRODUCT_CURRENCY_CONFLICT,
  buildPartnerProductCreate,
  diffPartnerAddProductMutations,
  discardPartnerAddProductMutation,
  emptyPartnerAddProductFields,
  formatPartnerCreatePrice,
  partnerAddProductCollectionChoices,
  partnerAddProductCurrencyChoice,
  partnerAddProductPublishLabel,
  partnerProductNeedsShortName,
  partnerVariantNeedsShortName,
  readPartnerAddProductResume,
  summarizePartnerAddProduct,
  validatePartnerAddProductStep,
  type PartnerAddProductFields,
} from "./partner-add-product";
import { partnerAddProductPath } from "./partner-catalog-workspace";
import type { PartnerCommercialAssetOption } from "./partner-commercial-assets";
import {
  applyPartnerDraftMutations,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutation,
  resolvePartnerCatalogCurrency,
} from "./partner-draft-mutations";
import type { StageCatalogSnapshot, StageCategory, StageCollection, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const PARTNER_ID = "partner-demo-furniture-co";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const ASSET_ID = "asset-studio-settee";
const DRAFT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const categories: readonly StageCategory[] = [{
  id: "living-room",
  label: "Living Room",
  subcategories: [{ id: "sofas", label: "Sofas" }],
}];

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function catalog(products: readonly StageProduct[] = [], variants: readonly StageVariant[] = []): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: "durable",
    products,
    variants,
    assets: [],
    collections: [collection()],
    partners: [{
      partnerId: PARTNER_ID,
      name: "Demo Furniture Co.",
      slug: "demo-furniture-co",
      status: "active",
      websiteUrl: null,
      logoUrl: null,
    }],
  });
}

function product(overrides: Partial<StageProduct> = {}): StageProduct {
  return {
    productId: "prod-demo-furniture-co-coffee-table",
    brand: "Demo",
    name: "Coffee Table",
    retailer: "Demo",
    categoryId: "living-room",
    subcategoryId: "sofas",
    productUrl: "https://example.test/coffee",
    imageUrl: "https://cdn.test/coffee.jpg",
    priceAmount: 459,
    priceCurrency: "USD",
    defaultVariantId: "var-demo-furniture-co-coffee-table-walnut",
    collectionIds: [],
    source: "partner_catalog",
    partnerId: PARTNER_ID,
    status: "active",
    ...overrides,
  };
}

function variant(overrides: Partial<StageVariant> = {}): StageVariant {
  return {
    variantId: "var-demo-furniture-co-coffee-table-walnut",
    productId: "prod-demo-furniture-co-coffee-table",
    assetId: ASSET_ID,
    finishLabel: "Walnut",
    sku: "DFC-CT-WAL",
    priceAmount: 459,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
    ...overrides,
  };
}

function collection(): StageCollection {
  return {
    collectionId: "col-demo-furniture-co-living-room",
    name: "Living Room",
    owner: "partner",
    partnerName: "Demo Furniture Co.",
    partnerId: PARTNER_ID,
    productIds: [],
  };
}

function fields(overrides: Partial<PartnerAddProductFields> = {}): PartnerAddProductFields {
  return {
    ...emptyPartnerAddProductFields("USD"),
    name: "Studio Settee",
    price: "1295",
    imageUrl: "https://cdn.test/studio-settee.jpg",
    productUrl: "https://example.test/studio-settee",
    categoryId: "living-room",
    subcategoryId: "sofas",
    finish: "Natural Oak",
    sku: "SS-NO-01",
    assetId: ASSET_ID,
    assetFileName: "studio-settee.glb",
    ...overrides,
  };
}

function option(): PartnerCommercialAssetOption {
  return {
    assetId: ASSET_ID,
    status: "ready",
    authoredWidthM: 1.8,
    authoredHeightM: 0.8,
    authoredDepthM: 0.9,
    origin: "partner_intake",
    originalFileName: "studio-settee.glb",
    label: "Natural Oak",
  };
}

function validationBase(live = catalog()) {
  return {
    fields: fields(),
    currencyMode: "inherited" as const,
    categories,
    partnerId: PARTNER_ID,
    products: live.products,
    variants: live.variants,
    pendingProductIds: [] as string[],
    pendingVariantIds: [] as string[],
    pendingSkus: live.variants.flatMap((item) => item.sku ? [item.sku] : []),
    ignoreProductId: null,
    ignoreVariantId: null,
    assetReady: true,
  };
}

function flow(overrides: Partial<Parameters<typeof PartnerAddProductFlow>[0]> = {}) {
  return renderToStaticMarkup(createElement(PartnerAddProductFlow, {
    partnerId: PARTNER_ID,
    currency: { mode: "inherited", currency: "USD" },
    categories,
    collections: [collection()],
    products: [],
    variants: [],
    assets: [],
    commercialAssetOptions: [option()],
    draft: null,
    ...overrides,
  }));
}

test("A Add product route is the catalog destination", () => {
  assert.equal(partnerAddProductPath(), "/partner/catalog/new");
  const html = renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [],
    openDraftId: DRAFT_ID,
    hasUnpublishedChanges: false,
  }));
  assert.match(html, /href="\/partner\/catalog\/new"/);
  assert.doesNotMatch(html, /intent=add-product/);
  assert.match(source("app/partner/catalog/new/page.tsx"), /PartnerAddProductFlow/);
  assert.match(source("package.json"), /test:partner-ux6-add-product/);
});

test("B the route uses the current Partner catalog and hides foreign collections", () => {
  const page = source("app/partner/catalog/new/page.tsx");
  assert.match(page, /resolvePartnerPortalContext\(/);
  assert.match(page, /loadAuthorizedPartnerPortalCatalog\(auth\.context\.partnerId\)/);
  assert.match(page, /loadPartnerCommercialAssetsForPortal\([\s\S]*auth\.context\.partnerId/);
  const html = flow({
    collections: [
      collection(),
      {
        ...collection(),
        collectionId: "col-other-secret",
        name: "Secret Collection",
        partnerId: OTHER_PARTNER_ID,
      },
    ],
    products: [product({
      productId: "prod-other-secret-sofa",
      name: "Secret Sofa",
      partnerId: OTHER_PARTNER_ID,
      priceCurrency: "EUR",
    })],
  });
  assert.match(html, /Living Room/);
  assert.doesNotMatch(html, /Secret Collection|Secret Sofa|partner-other-furniture-co|partner-demo-furniture-co/);
  const choices = partnerAddProductCollectionChoices({
    partnerId: PARTNER_ID,
    collections: [
      collection(),
      { ...collection(), collectionId: "col-other-secret", name: "Secret Collection", partnerId: OTHER_PARTNER_ID },
    ],
    pendingCollections: [],
    selectedIds: [],
  });
  assert.deepEqual(choices.map((item) => item.name), ["Living Room"]);
});

test("C an empty catalog can select a currency for the first product", () => {
  const live = catalog();
  assert.deepEqual(resolvePartnerCatalogCurrency(live, PARTNER_ID), { status: "empty" });
  assert.deepEqual(partnerAddProductCurrencyChoice("empty", null), { mode: "choose" });
  const html = flow({ currency: { mode: "choose" } });
  assert.match(html, /Currency/);
  assert.match(html, /<option value="CAD">CAD<\/option>/);
  const issues = validatePartnerAddProductStep({
    ...validationBase(live),
    step: "product",
    currencyMode: "choose",
    fields: fields({ currency: "" }),
  });
  assert.equal(issues.includes("Choose a currency."), true);
  const built = buildPartnerProductCreate({
    ...validationBase(live),
    currencyMode: "choose",
    fields: fields({ currency: "cad" }),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.mutation.priceCurrency, "CAD");
  const parsed = parsePartnerDraftMutation(built.mutation);
  assert.equal(parsed.ok, true);
  const applied = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.document.products.create?.[0]?.priceCurrency, "CAD");
  assert.equal(applied.document.variants.create[0]?.priceCurrency, "CAD");
  const missing = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [{ ...built.mutation, priceCurrency: undefined }],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(missing.ok, false);
});

test("D an established catalog currency is inherited", () => {
  const live = catalog([product()], [variant()]);
  assert.deepEqual(resolvePartnerCatalogCurrency(live, PARTNER_ID), { status: "resolved", currency: "USD" });
  const withForeign = catalog([
    product(),
    product({
      productId: "prod-other-secret-sofa",
      name: "Secret Sofa",
      partnerId: OTHER_PARTNER_ID,
      priceCurrency: "EUR",
    }),
  ], [variant()]);
  assert.equal(resolvePartnerCatalogCurrency(withForeign, PARTNER_ID).status, "resolved");
  const html = flow({ currency: { mode: "inherited", currency: "USD" } });
  assert.match(html, /USD/);
  assert.doesNotMatch(html, /Currency/);
  const built = buildPartnerProductCreate({
    ...validationBase(live),
    fields: fields({ currency: "USD" }),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const applied = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.document.products.create?.[0]?.priceCurrency, "USD");
  const conflict = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [{ ...built.mutation, priceCurrency: "CAD" }],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(conflict.ok, false);
});

test("E conflicting catalog currencies block creation", () => {
  const live = catalog([
    product({ priceCurrency: "USD" }),
    product({
      productId: "prod-demo-furniture-co-lamp",
      name: "Lamp",
      priceCurrency: "CAD",
      defaultVariantId: "var-demo-furniture-co-lamp-brass",
    }),
  ], [variant()]);
  assert.deepEqual(resolvePartnerCatalogCurrency(live, PARTNER_ID), { status: "conflict" });
  const html = flow({ currency: { mode: "conflict" } });
  assert.match(html, new RegExp(PARTNER_ADD_PRODUCT_CURRENCY_CONFLICT));
  assert.doesNotMatch(html, /Product name|Publish product|Currency/);
  const blocked = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [{
      type: "product.create",
      name: "Studio Settee",
      imageUrl: "https://cdn.test/studio-settee.jpg",
      productUrl: "https://example.test/studio-settee",
      priceAmount: 1295,
      priceCurrency: "USD",
      categoryId: "living-room",
      subcategoryId: "sofas",
      defaultVariant: {
        finishLabel: "Natural Oak",
        sku: "SS-NO-01",
        productUrl: null,
        currentAssetId: ASSET_ID,
      },
    }],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.match(blocked.error, /currency could not be resolved/);
});

test("F product identity is derived and the product id stays off the form", () => {
  assert.equal(partnerProductNeedsShortName("Studio Settee"), false);
  assert.equal(partnerProductNeedsShortName("@@@"), true);
  const built = buildPartnerProductCreate({ ...validationBase(), fields: fields() });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal("productId" in built.mutation, false);
  assert.equal(built.mutation.productCreationSlug, undefined);
  const applied = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    catalog(),
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  const created = applied.document.products.create?.[0];
  assert.equal(created?.productId, "prod-demo-furniture-co-studio-settee");
  const summary = summarizePartnerAddProduct({ fields: fields(), categories });
  assert.equal(JSON.stringify(summary).includes("prod-demo-furniture-co-studio-settee"), false);
  const html = flow();
  assert.doesNotMatch(html, /prod-demo-furniture-co-studio-settee|Product ID|Short name/);
  const needsShortName = validatePartnerAddProductStep({
    ...validationBase(),
    step: "product",
    fields: fields({ name: "@@@" }),
  });
  assert.equal(needsShortName.includes("Enter a short name so this product can be identified."), true);
});

test("G variant identity is derived from finish and the variant id stays off the form", () => {
  assert.equal(partnerVariantNeedsShortName("Natural Oak"), false);
  assert.equal(partnerVariantNeedsShortName("@@@"), true);
  const built = buildPartnerProductCreate({ ...validationBase(), fields: fields() });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.mutation.defaultVariant.creationSlug, undefined);
  const applied = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    catalog(),
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(
    applied.document.variants.create[0]?.variantId,
    "var-demo-furniture-co-studio-settee-natural-oak",
  );
  const html = flow({ initialStep: "variant" });
  assert.match(html, /Finish/);
  assert.match(html, /SKU/);
  assert.doesNotMatch(html, /var-demo|Variant ID|Short name/);
});

test("H product price is the default variant price", () => {
  const live = catalog();
  const built = buildPartnerProductCreate({ ...validationBase(live), fields: fields() });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const created = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.document.products.create?.[0]?.priceAmount, 1295);
  assert.equal(created.document.variants.create[0]?.priceAmount, 1295);
  const productId = created.document.products.create?.[0]?.productId ?? "";
  const variantId = created.document.variants.create[0]?.variantId ?? "";
  const edits = diffPartnerAddProductMutations({
    productId,
    variantId,
    saved: fields(),
    next: fields({ price: "1400" }),
  });
  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.type, "product.create_edit");
  const repriced = applyPartnerDraftMutations(
    created.document,
    live,
    edits,
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(repriced.ok, true);
  if (!repriced.ok) return;
  assert.equal(repriced.document.products.create?.[0]?.priceAmount, 1400);
  assert.equal(repriced.document.variants.create[0]?.priceAmount, 1400);
  const direct = applyPartnerDraftMutations(
    repriced.document,
    live,
    [{ type: "variant.create_edit", variantId, priceAmount: 1500 }],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(direct.ok, false);
  if (direct.ok) return;
  assert.match(direct.error, /Default variant price is edited through the Product/);
  const html = flow({ initialStep: "variant" });
  assert.match(html, /This finish uses the product price/);
  assert.doesNotMatch(html, /inputMode="decimal"/);
});

test("I the add-product model step uses the inline GLB pipeline", () => {
  const flowSource = source("app/partner/catalog/new/PartnerAddProductFlow.tsx");
  const upload = source("lib/vibode-stage/partner-inline-glb-upload.ts");
  assert.match(flowSource, /usePartnerInlineGlbUploads/);
  assert.match(flowSource, /PartnerInlineModelPanel/);
  assert.match(flowSource, /Upload a GLB so customers can place this Product in their room\./);
  assert.doesNotMatch(flowSource, /dimensionSource: "product"|authoredWidthM/);
  assert.match(upload, /dimensionSource: "glb"/);
  assert.match(source("app/partner/catalog/products/usePartnerInlineGlbUploads.ts"), /runPartnerInlineGlbUpload/);
  const html = flow({ initialStep: "model", commercialAssetOptions: [] });
  assert.match(html, /3D Model/);
  assert.match(html, /Upload GLB/);
  assert.match(html, /Upload a GLB so customers can place this Product in their room\./);
  assert.match(html, /drop a GLB here/);
});

test("J an existing ready model can be chosen without showing its asset id", () => {
  const html = flow({ initialStep: "model" });
  assert.match(html, /Choose existing model/);
  assert.match(html, /studio-settee\.glb/);
  assert.match(html, /Ready/);
  assert.doesNotMatch(html, new RegExp(ASSET_ID));
});

test("K product and first variant are saved with the existing draft mutations", () => {
  const built = buildPartnerProductCreate({
    ...validationBase(),
    fields: fields({ collectionIds: [collection().collectionId] }),
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.mutation.type, "product.create");
  const applied = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    catalog(),
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.document.products.create?.length, 1);
  assert.equal(applied.document.variants.create.length, 1);
  assert.equal(applied.document.variants.create[0]?.productId, applied.document.products.create?.[0]?.productId);
  assert.equal(
    applied.document.collections.membershipAdd.some((item) => item.collectionId === collection().collectionId),
    true,
  );
});

test("L variant create receives the ready current asset id", () => {
  const missing = validatePartnerAddProductStep({ ...validationBase(), step: "model", assetReady: false });
  assert.deepEqual(missing, ["Upload a GLB or choose an existing 3D model."]);
  const built = buildPartnerProductCreate({ ...validationBase(), fields: fields() });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.mutation.defaultVariant.currentAssetId, ASSET_ID);
  const applied = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    catalog(),
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.document.variants.create[0]?.currentAssetId, ASSET_ID);
});

test("M review calls the existing draft preview route", () => {
  const flowSource = source("app/partner/catalog/new/PartnerAddProductFlow.tsx");
  assert.match(flowSource, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/preview/);
  assert.match(flowSource, /presentPartnerDraftPreview/);
  assert.match(flowSource, /describePartnerProductReview/);
  assert.doesNotMatch(flowSource, /planVersion|sqlPlan/);
});

test("N unrelated draft changes are disclosed before publish", () => {
  const live = catalog([product()], [variant()]);
  const named = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [{ type: "product.set_name", productId: product().productId, name: "Cafe Table" }],
    PARTNER_ID,
  );
  assert.equal(named.ok, true);
  if (!named.ok) return;
  const built = buildPartnerProductCreate({ ...validationBase(live), fields: fields() });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const drafted = applyPartnerDraftMutations(
    named.document,
    live,
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;
  const html = flow({
    products: live.products,
    variants: live.variants,
    draft: { draftId: DRAFT_ID, revision: 3, document: drafted.document },
    initialStep: "review",
  });
  assert.match(html, /Also included in this publish/);
  assert.match(html, /1 change to Coffee Table/);
  assert.match(html, /Publish changes/);
  assert.equal(partnerAddProductPublishLabel(1), "Publish changes");
  assert.equal(partnerAddProductPublishLabel(0), "Publish product");
});

test("O publish uses the existing route and returns to the catalog", () => {
  const flowSource = source("app/partner/catalog/new/PartnerAddProductFlow.tsx");
  assert.match(flowSource, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/publish/);
  assert.match(flowSource, /expectedDraftRevision/);
  assert.match(flowSource, /window\.location\.assign\(CATALOG_PATH\)/);
  assert.match(flowSource, /const CATALOG_PATH = "\/partner\/catalog"/);
  assert.match(flowSource, /PARTNER_PUBLISH_CONFIRMATION/);
  assert.doesNotMatch(flowSource, /publish-v2|new publish RPC/i);
  const html = flow({ initialStep: "review" });
  assert.match(html, /Publish product/);
  assert.match(html, /This updates your live Vibode catalog\./);
});

test("P an empty catalog links directly to add product", () => {
  const html = renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [],
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
  assert.match(html, /No products yet/);
  assert.match(html, /Add your first product to start building your Vibode catalog\./);
  assert.match(html, /href="\/partner\/catalog\/new"/);
  assert.doesNotMatch(html, /Go to 3D Models|A 3D model is needed before your first product/);
  assert.doesNotMatch(source("app/partner/catalog/page.tsx"), /loadPartnerCommercialAssetsForPortal/);
});

test("Q the creation screen does not show technical catalog language", () => {
  const html = [
    flow(),
    flow({ initialStep: "variant" }),
    flow({ initialStep: "model" }),
    flow({ initialStep: "review" }),
    flow({ currency: { mode: "conflict" } }),
    flow({ currency: { mode: "choose" } }),
  ].join("\n");
  assert.doesNotMatch(html, /Partner ID|Product ID|Variant ID|Asset ID|planVersion|Register Asset|Activate Runtime/);
  assert.doesNotMatch(html, /\brevision\b|\bpatch\b|planVersion|prod-demo|var-demo|asset-studio|partner-demo/);
  const ui = [
    source("app/partner/catalog/new/PartnerAddProductFlow.tsx"),
    source("app/partner/catalog/new/page.tsx"),
  ].join("\n");
  assert.doesNotMatch(ui, /Register Asset|Activate Runtime|planVersion|Product ID|Variant ID|Asset ID|Partner ID/);
  assert.equal(formatPartnerCreatePrice(1295, "CAD"), "$1,295 CAD");
});

test("R discard removes only the pending product", () => {
  const live = catalog([product()], [variant()]);
  const named = applyPartnerDraftMutations(
    emptyPartnerPatchDocument(PARTNER_ID),
    live,
    [{ type: "product.set_name", productId: product().productId, name: "Cafe Table" }],
    PARTNER_ID,
  );
  assert.equal(named.ok, true);
  if (!named.ok) return;
  const built = buildPartnerProductCreate({ ...validationBase(live), fields: fields() });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const drafted = applyPartnerDraftMutations(
    named.document,
    live,
    [built.mutation],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;
  const createdId = drafted.document.products.create?.[0]?.productId ?? "";
  const removal = discardPartnerAddProductMutation(createdId);
  assert.equal(removal.type, "product.create_remove");
  const removed = applyPartnerDraftMutations(
    drafted.document,
    live,
    [removal],
    PARTNER_ID,
    { commercialAssetIds: new Set([ASSET_ID]) },
  );
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.document.products.create?.length ?? 0, 0);
  assert.equal(removed.document.variants.create.length, 0);
  assert.equal(removed.document.products.update[0]?.name, "Cafe Table");
  const unsaved = flow();
  assert.match(unsaved, /href="\/partner\/catalog"/);
  assert.match(unsaved, />Cancel</);
  assert.doesNotMatch(unsaved, /Discard new product|Discard unpublished changes/);
  const savedHtml = flow({
    products: live.products,
    variants: live.variants,
    draft: { draftId: DRAFT_ID, revision: 2, document: drafted.document },
  });
  assert.match(savedHtml, /Discard new product/);
  assert.doesNotMatch(savedHtml, /Discard unpublished changes/);
  assert.equal(readPartnerAddProductResume(drafted.document).kind, "one");
  assert.doesNotMatch(source("app/partner/catalog/new/PartnerAddProductFlow.tsx"), /Discard unpublished changes/);
});
