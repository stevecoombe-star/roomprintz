import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerAssetWorkspaceClient } from "../../app/partner/assets/PartnerAssetWorkspaceClient";
import { PartnerModelLibrary } from "../../app/partner/assets/PartnerModelLibrary";
import { PartnerCatalogWorkspace } from "../../app/partner/catalog/PartnerCatalogWorkspace";
import { PartnerAddProductFlow } from "../../app/partner/catalog/new/PartnerAddProductFlow";
import { PartnerInlineModelPanel } from "../../app/partner/catalog/products/PartnerInlineModelPanel";
import { PartnerProductEditor } from "../../app/partner/catalog/products/PartnerProductEditor";
import { PARTNER_ADD_PRODUCT_STEPS } from "./partner-add-product";
import { partnerAddProductPath, partnerProductEditorPath } from "./partner-catalog-workspace";
import type { PartnerCommercialAssetOption } from "./partner-commercial-assets";
import { emptyPartnerPatchDocument } from "./partner-draft-mutations";
import {
  PARTNER_INLINE_GLB_PROCESSING,
  PARTNER_INLINE_GLB_READY,
  partnerInlineGlbUploadingLabel,
} from "./partner-inline-glb-upload";
import { describePartnerPublishInclusions } from "./partner-product-editor";
import type { StageAsset, StageCategory, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const PARTNER_ID = "partner-demo-furniture-co";
const ASSET_ID = "asset-studio-settee";

const PRIMARY_TERMS = /Partner ID|Product ID|Variant ID|Asset ID|planVersion|Register Asset|Activate Runtime|PI-5|canonical patch|currentAssetId|runtime-ready/;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

const categories: readonly StageCategory[] = [{
  id: "living-room",
  label: "Living Room",
  subcategories: [{ id: "sofas", label: "Sofas" }],
}];

function product(): StageProduct {
  return {
    productId: "prod-studio-settee",
    name: "Studio Settee",
    brand: "Demo",
    retailer: "Demo",
    categoryId: "living-room",
    subcategoryId: "sofas",
    productUrl: "https://example.test/studio-settee",
    imageUrl: "https://cdn.test/studio-settee.jpg",
    priceAmount: 1295,
    priceCurrency: "USD",
    defaultVariantId: "var-studio-settee",
    collectionIds: [],
    source: "partner_catalog",
    partnerId: PARTNER_ID,
    status: "active",
  };
}

function variant(): StageVariant {
  return {
    variantId: "var-studio-settee",
    productId: "prod-studio-settee",
    assetId: ASSET_ID,
    finishLabel: "Natural oak",
    sku: "SS-NO-01",
    priceAmount: 1295,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
  };
}

function asset(): StageAsset {
  return {
    assetId: ASSET_ID,
    glbUrl: "https://cdn.test/studio-settee.glb",
    authoredWidthM: 1.8,
    authoredHeightM: 0.8,
    authoredDepthM: 0.9,
    status: "ready",
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
    label: "Natural oak",
  };
}

function catalogHtml(): string {
  return renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [{
      productKey: "prod-studio-settee",
      name: "Studio Settee",
      imageUrl: "",
      status: "active",
      statusLabel: "Active",
      variantCountLabel: "1 variant",
      variantSummary: "Natural oak · SKU SS-NO-01",
      priceLabel: "$1,295",
      collectionNames: ["Living Room"],
      readiness: "ready",
      readinessLabel: "Ready",
      searchText: "studio settee",
    }],
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
}

function emptyCatalogHtml(): string {
  return renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [],
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
}

function addProductHtml(step?: "product" | "variant" | "model" | "review"): string {
  return renderToStaticMarkup(createElement(PartnerAddProductFlow, {
    partnerId: PARTNER_ID,
    currency: { mode: "inherited", currency: "USD" },
    categories,
    collections: [],
    products: [],
    variants: [],
    assets: [],
    commercialAssetOptions: [option()],
    draft: null,
    initialStep: step,
  }));
}

function editorHtml(): string {
  const item = product();
  return renderToStaticMarkup(createElement(PartnerProductEditor, {
    product: item,
    variants: [variant()],
    collections: [],
    assets: [asset()],
    commercialAssetOptions: [option()],
    categories,
    draft: null,
    productNames: { [item.productId]: item.name },
    variantProductIds: { "var-studio-settee": item.productId },
  }));
}

test("A primary partner routes avoid internal terminology", () => {
  const html = [
    catalogHtml(),
    emptyCatalogHtml(),
    addProductHtml("product"),
    addProductHtml("variant"),
    addProductHtml("model"),
    addProductHtml("review"),
    editorHtml(),
    renderToStaticMarkup(createElement(PartnerModelLibrary, {
      items: [],
      loaded: true,
      loadError: null,
      associationsKnown: true,
      query: "",
      status: "all",
      onQueryChange: () => undefined,
      onStatusChange: () => undefined,
      onClearFilters: () => undefined,
    })),
    renderToStaticMarkup(createElement(PartnerAssetWorkspaceClient)),
  ].join("\n");
  assert.doesNotMatch(html, PRIMARY_TERMS);
  const primarySources = [
    "app/partner/page.tsx",
    "app/partner/PartnerPortalNav.tsx",
    "app/partner/catalog/page.tsx",
    "app/partner/catalog/PartnerCatalogWorkspace.tsx",
    "app/partner/catalog/new/page.tsx",
    "app/partner/catalog/new/PartnerAddProductFlow.tsx",
    "app/partner/catalog/products/PartnerProductEditor.tsx",
    "app/partner/catalog/products/PartnerPublishSection.tsx",
    "app/partner/assets/page.tsx",
    "app/partner/assets/PartnerModelLibrary.tsx",
  ].map(source).join("\n");
  assert.doesNotMatch(primarySources, /Register Asset|Activate Runtime|planVersion|PI-5F|canonical patch/);
});

test("B catalog add product opens the guided flow", () => {
  assert.equal(partnerAddProductPath(), "/partner/catalog/new");
  assert.match(catalogHtml(), /href="\/partner\/catalog\/new"/);
  assert.match(catalogHtml(), />Add product</);
  assert.match(emptyCatalogHtml(), /href="\/partner\/catalog\/new"/);
});

test("C a catalog product opens the product editor", () => {
  assert.equal(partnerProductEditorPath("prod-studio-settee"), "/partner/catalog/products/prod-studio-settee");
  const html = catalogHtml();
  assert.match(html, /href="\/partner\/catalog\/products\/prod-studio-settee"/);
  assert.match(html, />Studio Settee</);
  assert.match(html, /View product/);
});

test("D add product keeps the product, variant, model, and review sequence", () => {
  assert.deepEqual(PARTNER_ADD_PRODUCT_STEPS.map((step) => step.label), [
    "Product",
    "Variant",
    "3D Model",
    "Review & Publish",
  ]);
  const productStep = addProductHtml("product");
  assert.match(productStep, /Step 1 of 4/);
  assert.match(productStep, /Product name/);
  assert.match(productStep, /\(required\)/);
  const variantStep = addProductHtml("variant");
  assert.match(variantStep, /Step 2 of 4/);
  assert.match(variantStep, />Variant</);
  const modelStep = addProductHtml("model");
  assert.match(modelStep, /Step 3 of 4/);
  assert.match(modelStep, />3D Model</);
  assert.match(modelStep, />Review</);
  const reviewStep = addProductHtml("review");
  assert.match(reviewStep, /Step 4 of 4/);
  assert.match(reviewStep, /Review &amp; Publish|Review & Publish/);
  assert.match(reviewStep, /Publish product/);
});

test("E inline GLB shows uploading, preparing, and ready", () => {
  const uploading = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "uploading", fileName: "sofa.glb" },
    options: [],
    selectedAssetId: "",
    disabled: true,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  const preparing = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "processing", fileName: "sofa.glb" },
    options: [],
    selectedAssetId: "",
    disabled: true,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  const ready = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "ready", fileName: "sofa.glb" },
    options: [],
    selectedAssetId: "",
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(uploading, new RegExp(partnerInlineGlbUploadingLabel("sofa.glb").replace(/[.]/g, "\\.")));
  assert.match(uploading, /Uploading/);
  assert.match(preparing, new RegExp(PARTNER_INLINE_GLB_PROCESSING.replace(/[.]/g, "\\.")));
  assert.match(ready, new RegExp(PARTNER_INLINE_GLB_READY));
  assert.match(ready, /sofa\.glb/);
  assert.match(source("app/partner/catalog/products/PartnerInlineModelPanel.tsx"), /aria-label="Upload GLB"/);
  assert.match(source("lib/vibode-stage/partner-inline-glb-upload.ts"), /partnerInlineGlbFinalizeRoute/);
  assert.match(source("lib/vibode-stage/partner-inline-glb-upload.ts"), /partnerInlineGlbRegisterRoute/);
  assert.match(source("lib/vibode-stage/partner-inline-glb-upload.ts"), /partnerInlineGlbActivateRoute/);
});

test("F the model library stays primary and the manual pipeline stays closed", () => {
  const page = source("app/partner/assets/page.tsx");
  const client = renderToStaticMarkup(createElement(PartnerAssetWorkspaceClient));
  const clientSource = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  assert.match(page, /<h1[^>]*>3D Models<\/h1>/);
  assert.match(client, /Advanced \/ Technical tools/);
  assert.doesNotMatch(client, /Register Asset|Activate Runtime/);
  const gate = clientSource.indexOf("advancedOpen ?");
  assert.ok(gate > 0);
  assert.ok(clientSource.indexOf("Register Asset") > gate);
  assert.ok(clientSource.indexOf("Activate Runtime") > gate);
});

test("G unrelated draft changes stay disclosed before publish", () => {
  const document = emptyPartnerPatchDocument(PARTNER_ID);
  const withOthers = {
    ...document,
    products: {
      ...document.products,
      update: [
        { productId: "prod-studio-settee", name: "Studio Sofa" },
        { productId: "prod-chair", name: "Lounge Chair" },
      ],
    },
  };
  assert.deepEqual(describePartnerPublishInclusions({
    document: withOthers,
    productId: "prod-studio-settee",
    productNames: { "prod-studio-settee": "Studio Settee", "prod-chair": "Lounge Chair" },
    variantProductIds: {},
  }), ["1 change to Lounge Chair"]);
  assert.match(source("app/partner/catalog/products/PartnerPublishSection.tsx"), /Also included in this publish/);
  assert.match(source("app/partner/catalog/new/PartnerAddProductFlow.tsx"), /Also included in this publish/);
  assert.match(addProductHtml("review"), /Publish product/);
});

test("H catalog and model library empty states use the final copy", () => {
  assert.match(emptyCatalogHtml(), /No products yet/);
  assert.match(emptyCatalogHtml(), /Add your first product to start building your Vibode catalog\./);
  assert.match(emptyCatalogHtml(), />Add product</);
  const library = renderToStaticMarkup(createElement(PartnerModelLibrary, {
    items: [],
    loaded: true,
    loadError: null,
    associationsKnown: true,
    query: "",
    status: "all",
    onQueryChange: () => undefined,
    onStatusChange: () => undefined,
    onClearFilters: () => undefined,
  }));
  assert.match(library, /No 3D models yet/);
  assert.match(library, /Upload a GLB while adding or editing a Product Variant\./);
  assert.match(library, />Open Catalog</);
  const filtered = renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [{
      productKey: "prod-studio-settee",
      name: "Studio Settee",
      imageUrl: "",
      status: "active",
      statusLabel: "Active",
      variantCountLabel: "1 variant",
      variantSummary: null,
      priceLabel: "$1,295",
      collectionNames: [],
      readiness: "ready",
      readinessLabel: "Ready",
      searchText: "studio settee",
    }],
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
  assert.match(source("app/partner/catalog/PartnerCatalogWorkspace.tsx"), /No products match these filters\./);
  assert.match(source("lib/vibode-stage/partner-model-library.ts"), /No models match these filters\./);
  assert.match(source("lib/vibode-stage/partner-model-library.ts"), /No models need attention\./);
  assert.match(filtered, /Studio Settee/);
});

test("I a published variant does not offer replace model", () => {
  const html = editorHtml();
  assert.doesNotMatch(html, /Replace model/);
  assert.match(html, /studio-settee\.glb/);
  assert.match(html, />3D Model</);
  assert.doesNotMatch(html, />3D Models</);
  assert.doesNotMatch(html, /This published Variant keeps its current 3D model\./);
  assert.doesNotMatch(source("app/partner/catalog/products/PartnerModelSection.tsx"), /Replace model|Upload GLB/);
});

test("J draft, publish, and asset routes remain the existing ones", () => {
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  const flow = source("app/partner/catalog/new/PartnerAddProductFlow.tsx");
  const assets = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  assert.match(editor, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}/);
  assert.match(editor, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/preview/);
  assert.match(editor, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/publish/);
  assert.match(flow, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/publish/);
  assert.match(assets, /\/api\/vibode\/partner\/assets\/intakes/);
  assert.match(assets, /\/api\/vibode\/partner\/assets\/intakes\/\$\{createdBody\.intakeId\}\/finalize/);
  assert.match(assets, /\/api\/vibode\/partner\/assets\/intakes\/\$\{intakeId\}\/register/);
  assert.match(assets, /\/api\/vibode\/partner\/assets\/\$\{assetId\}\/activate/);
  assert.match(source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx"), /id="partner-add-product"/);
  assert.match(source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx"), /Superseded\. Add a product from the catalog instead\./);
});
