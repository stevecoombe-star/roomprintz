import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerCatalogWorkspace } from "../../app/partner/catalog/PartnerCatalogWorkspace";
import { PartnerProductEditor } from "../../app/partner/catalog/products/PartnerProductEditor";
import { PartnerSaveState } from "../../app/partner/catalog/products/PartnerSaveState";
import { presentPartnerDraftPreview } from "./partner-draft-preview-view";
import { partnerProductEditorPath } from "./partner-catalog-workspace";
import type { PartnerCommercialAssetOption } from "./partner-commercial-assets";
import {
  PARTNER_DISCARD_CONFIRMATION,
  PARTNER_PUBLISH_CONFIRMATION,
  PARTNER_PUBLISHED_MODEL_NOTE,
  PARTNER_PUBLISHED_NO_MODEL_NOTE,
  PARTNER_VARIANT_MODEL_REQUIRED,
  buildPartnerVariantCreate,
  commitPartnerProductName,
  commitPartnerProductPrice,
  commitPartnerVariantFinish,
  commitPendingVariantModel,
  describePartnerProductReview,
  describePartnerPublishInclusions,
  describeSavedPartnerProductChanges,
  partnerEditorAssetOptionLabel,
  partnerPublishConfirmation,
  presentPartnerVariantModel,
  resolvePartnerProductEditor,
} from "./partner-product-editor";
import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import type { StageAsset, StageCategory, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const PARTNER_ID = "partner-demo-furniture-co";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const DRAFT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ASSET_ID = "asset-coffee-model";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function product(overrides: Partial<StageProduct> & Pick<StageProduct, "productId" | "name">): StageProduct {
  return {
    brand: "Demo",
    retailer: "Demo",
    categoryId: "living-room",
    subcategoryId: "coffee-tables",
    productUrl: "https://example.test/product",
    imageUrl: "https://cdn.test/product.jpg",
    priceAmount: 459,
    priceCurrency: "USD",
    defaultVariantId: "var-coffee",
    collectionIds: [],
    source: "partner_catalog",
    partnerId: PARTNER_ID,
    status: "active",
    ...overrides,
  };
}

function variant(overrides: Partial<StageVariant> & Pick<StageVariant, "variantId" | "productId">): StageVariant {
  return {
    assetId: null,
    finishLabel: "Walnut",
    sku: "DFC-CT-WAL",
    priceAmount: 459,
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

function modelOption(
  assetId: string,
  originalFileName: string | null,
  label: string,
): PartnerCommercialAssetOption {
  return {
    assetId,
    status: "ready",
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
    origin: "catalog_linked",
    originalFileName,
    label,
  };
}

function emptyDocument(): PartnerCatalogSyncDocument {
  return {
    partnerId: PARTNER_ID,
    mode: "patch",
    products: { update: [], create: [] },
    variants: { update: [], create: [] },
    collections: { update: [], create: [], membershipAdd: [], membershipRemove: [] },
  };
}

const categories: readonly StageCategory[] = [{
  id: "living-room",
  label: "Living Room",
  subcategories: [{ id: "coffee-tables", label: "Coffee Tables" }],
}];

function renderEditor(overrides: Partial<Parameters<typeof PartnerProductEditor>[0]> = {}): string {
  const coffee = product({ productId: "prod-coffee", name: "Coffee Table" });
  return renderToStaticMarkup(createElement(PartnerProductEditor, {
    product: coffee,
    variants: [variant({ variantId: "var-coffee", productId: "prod-coffee", assetId: ASSET_ID })],
    collections: [],
    assets: [asset(ASSET_ID, "ready")],
    commercialAssetOptions: [modelOption(ASSET_ID, "coffee-table.glb", "Coffee Table · Walnut")],
    categories,
    draft: null,
    productNames: { "prod-coffee": "Coffee Table" },
    variantProductIds: { "var-coffee": "prod-coffee" },
    ...overrides,
  }));
}

test("A a partner-owned product resolves and the editor renders its commercial fields", () => {
  const coffee = product({ productId: "prod-coffee", name: "Coffee Table" });
  const resolved = resolvePartnerProductEditor({
    partnerId: PARTNER_ID,
    productId: "prod-coffee",
    products: [coffee],
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.product.name, "Coffee Table");

  const html = renderEditor();
  assert.match(html, /Back to Catalog/);
  assert.match(html, /Coffee Table/);
  assert.match(html, />Active</);
  assert.match(html.slice(0, html.indexOf("product-details-heading")), /Set inactive/);
  assert.match(html, /Product name/);
  assert.match(html, /Product price \(USD\)/);
  assert.match(html, /Product image URL/);
  assert.match(html, /Product page URL/);
  assert.match(html, /Living Room/);
  assert.match(html, /Coffee Tables/);
  assert.match(html, />Product</);
  assert.match(html, />Variants</);
  assert.match(html, />3D Model</);
  assert.doesNotMatch(html, />3D Models</);
  assert.doesNotMatch(html, /product-models-heading/);
  assert.match(html, />Publishing</);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /resolvePartnerPortalContext/);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /loadAuthorizedPartnerPortalCatalog/);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /loadOpenPartnerPortalDraft/);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /loadPartnerCommercialAssetsForPortal/);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /resolvePartnerProductEditor/);
});

test("B a product outside the partner scope cannot be opened", () => {
  const secret = product({
    productId: "prod-other-secret-sofa",
    name: "Secret Sofa",
    partnerId: OTHER_PARTNER_ID,
  });
  const missing = resolvePartnerProductEditor({
    partnerId: PARTNER_ID,
    productId: "prod-other-secret-sofa",
    products: [product({ productId: "prod-coffee", name: "Coffee Table" })],
  });
  const foreign = resolvePartnerProductEditor({
    partnerId: PARTNER_ID,
    productId: secret.productId,
    products: [secret, product({ productId: "prod-coffee", name: "Coffee Table" })],
  });
  assert.deepEqual(missing, { ok: false, reason: "not_found" });
  assert.deepEqual(foreign, { ok: false, reason: "not_found" });
  assert.equal(JSON.stringify(foreign).includes("Secret Sofa"), false);
  assert.equal(JSON.stringify(foreign).includes(OTHER_PARTNER_ID), false);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /if \(!resolved\.ok\) notFound\(\)/);
});

test("C a catalog product row links to the product editor", () => {
  assert.equal(partnerProductEditorPath("prod-coffee"), "/partner/catalog/products/prod-coffee");
  const html = renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [{
      productKey: "prod-coffee",
      name: "Coffee Table",
      imageUrl: "",
      status: "active",
      statusLabel: "Active",
      variantCountLabel: "1 variant",
      variantSummary: "Walnut",
      priceLabel: "$459",
      collectionNames: [],
      readiness: "ready",
      readinessLabel: "Ready",
      searchText: "coffee table",
    }],
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
  assert.match(html, /href="\/partner\/catalog\/products\/prod-coffee"/);
  assert.match(html, />Coffee Table</);
  assert.match(source("app/partner/catalog/PartnerCatalogWorkspace.tsx"), /partnerProductEditorPath\(row\.productKey\)/);
});

test("D editing a product field writes through the existing draft mutation", () => {
  assert.deepEqual(commitPartnerProductName("prod-coffee", "Cafe Table", "Coffee Table"), {
    state: "mutation",
    mutation: { type: "product.set_name", productId: "prod-coffee", name: "Cafe Table" },
  });
  assert.deepEqual(commitPartnerProductPrice("prod-coffee", "500", "459"), {
    state: "mutation",
    mutation: { type: "product.set_price", productId: "prod-coffee", priceAmount: 500 },
  });
  assert.deepEqual(commitPartnerProductName("prod-coffee", "Coffee Table", "Coffee Table"), { state: "unchanged" });
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /commitPartnerProductName/);
  assert.match(editor, /commitPartnerProductPrice/);
  assert.match(editor, /method: "PATCH"/);
  assert.match(editor, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}/);
  assert.match(editor, /expectedRevision: current\.revision/);
  assert.match(source("lib/vibode-stage/partner-draft-mutations.ts"), /function applyPriceCoupling/);
  const html = renderToStaticMarkup(createElement(PartnerSaveState, { state: "unsaved" }))
    + renderToStaticMarkup(createElement(PartnerSaveState, { state: "saving" }))
    + renderToStaticMarkup(createElement(PartnerSaveState, { state: "saved" }))
    + renderToStaticMarkup(createElement(PartnerSaveState, { state: "failed" }));
  assert.match(html, /Unsaved/);
  assert.match(html, /Saving…/);
  assert.match(html, /Saved/);
  assert.match(html, /Save failed/);
});

test("E editing an existing variant field writes through the existing mutation", () => {
  assert.deepEqual(commitPartnerVariantFinish("var-coffee", "Oak", "Walnut"), {
    state: "mutation",
    mutation: { type: "variant.set_finish_label", variantId: "var-coffee", finishLabel: "Oak" },
  });
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /commitPartnerVariantFinish/);
  assert.match(editor, /commitPartnerVariantSku/);
  assert.match(editor, /commitPartnerVariantPrice/);
  assert.match(editor, /commitPartnerVariantUrl/);
  const html = renderEditor();
  assert.match(html, /Finish/);
  assert.match(html, /SKU/);
  assert.match(html, /Walnut/);
});

test("F add variant stays on the product page and still requires a ready model", () => {
  const created = buildPartnerVariantCreate({
    productId: "prod-coffee",
    currency: "USD",
    finish: "Oak",
    shortName: "",
    sku: "DFC-OAK",
    price: "510",
    productUrl: "",
    assetId: ASSET_ID,
    hasReadyModel: true,
  });
  assert.equal(created.state, "mutation");
  if (created.state !== "mutation") return;
  assert.equal(created.mutation.type, "variant.create");
  if (created.mutation.type !== "variant.create") return;
  assert.equal(created.mutation.currentAssetId, ASSET_ID);
  assert.equal("creationSlug" in created.mutation, false);

  const blocked = buildPartnerVariantCreate({
    productId: "prod-coffee",
    currency: "USD",
    finish: "Oak",
    shortName: "",
    sku: "",
    price: "510",
    productUrl: "",
    assetId: "",
    hasReadyModel: false,
  });
  assert.deepEqual(blocked, { state: "invalid", message: PARTNER_VARIANT_MODEL_REQUIRED });

  const html = renderEditor({ commercialAssetOptions: [], assets: [] });
  assert.match(html, /Add variant|A ready 3D model is needed before this Variant can be added\./);
  assert.match(html, new RegExp(PARTNER_VARIANT_MODEL_REQUIRED.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(html, /mapped ready Partner Asset/i);
  assert.match(source("app/partner/catalog/products/PartnerProductEditor.tsx"), /buildPartnerVariantCreate/);
  assert.doesNotMatch(source("app/partner/catalog/drafts/[draftId]/page.tsx"), /partner\/catalog\/products/);
});

test("G a variant with a ready model shows Ready and the filename without an asset id", () => {
  const presentation = presentPartnerVariantModel({
    assetId: ASSET_ID,
    assets: [asset(ASSET_ID, "ready")],
    options: [modelOption(ASSET_ID, "coffee-table.glb", "Coffee Table · Walnut")],
    published: true,
  });
  assert.equal(presentation.stateLabel, "Ready");
  assert.equal(presentation.filename, "coffee-table.glb");
  assert.equal(presentation.note, PARTNER_PUBLISHED_MODEL_NOTE);
  const label = partnerEditorAssetOptionLabel(modelOption(ASSET_ID, "coffee-table.glb", "Coffee Table · Walnut"));
  assert.match(label, /coffee-table\.glb/);
  assert.match(label, /Coffee Table · Walnut/);
  assert.match(label, /Ready/);
  assert.doesNotMatch(label, new RegExp(ASSET_ID));
  assert.doesNotMatch(label, /Uploaded Asset|Existing Catalog Asset/);
  const hidden = partnerEditorAssetOptionLabel(modelOption(ASSET_ID, null, ASSET_ID));
  assert.equal(hidden, "3D model · Ready");
  assert.doesNotMatch(hidden, new RegExp(ASSET_ID));

  const html = renderEditor();
  assert.match(html, /Ready/);
  assert.match(html, /coffee-table\.glb/);
  assert.equal(html.split("coffee-table.glb").length - 1, 1);
  assert.doesNotMatch(html, /Coffee Table · Walnut/);
  assert.doesNotMatch(html, /This published Variant keeps its current 3D model\./);
  assert.doesNotMatch(html, new RegExp(ASSET_ID));
  assert.doesNotMatch(html, /Replace Model|Replace model/);
  assert.doesNotMatch(html, /product-models-heading/);

  const foreign = renderEditor({
    commercialAssetOptions: [modelOption(ASSET_ID, "coffee-table.glb", "Demo Coffee Table · Black")],
  });
  assert.match(foreign, /coffee-table\.glb/);
  assert.match(foreign, /Demo Coffee Table · Black/);
  assert.equal(foreign.split("Demo Coffee Table · Black").length - 1, 1);
});

test("H a variant without a model shows No 3D model", () => {
  const presentation = presentPartnerVariantModel({
    assetId: null,
    assets: [],
    options: [],
    published: true,
  });
  assert.equal(presentation.stateLabel, "No 3D model");
  assert.equal(presentation.note, PARTNER_PUBLISHED_NO_MODEL_NOTE);
  const html = renderEditor({
    variants: [variant({ variantId: "var-coffee", productId: "prod-coffee", assetId: null })],
    assets: [],
    commercialAssetOptions: [],
  });
  assert.match(html, /No 3D model/);
  assert.match(html, /No model uploaded/);
  assert.match(html, /A 3D model cannot be added to this published Variant\./);
  assert.doesNotMatch(html, /Replace Model|Upload GLB/);
});

test("I a published variant does not expose Replace Model or a current-asset mutation", () => {
  const html = renderEditor();
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /Replace Model/);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  const model = source("lib/vibode-stage/partner-product-editor.ts");
  assert.doesNotMatch(editor, /Replace Model/);
  assert.doesNotMatch(model, /variant\.set_current_asset/);
  assert.equal(commitPendingVariantModel("var-new", ASSET_ID, "asset-old").state, "mutation");
  const pending = commitPendingVariantModel("var-new", ASSET_ID, "asset-old");
  assert.equal(pending.state, "mutation");
  if (pending.state !== "mutation") return;
  assert.equal(pending.mutation.type, "variant.create_edit");
  const publishedBlock = source("app/partner/catalog/products/PartnerModelSection.tsx");
  assert.match(publishedBlock, /This published Variant keeps its current 3D model\.|presentation\.note/);
  assert.doesNotMatch(publishedBlock, /Replace Model/);
});

test("J review uses the existing preview presenter", () => {
  const body = {
    ok: true,
    noOp: false,
    planVersion: 3,
    partnerId: PARTNER_ID,
    issues: [],
    productUpdates: [{
      productId: "prod-coffee",
      changes: [{ column: "name", previous: "Coffee Table", next: "Cafe Table" }],
    }],
    variantUpdates: [],
    productCreates: [],
    variantCreates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
  };
  const presented = presentPartnerDraftPreview(body);
  const review = describePartnerProductReview(presented, {
    productId: "prod-coffee",
    productNames: { "prod-coffee": "Coffee Table" },
    variantLabels: {},
    collectionNames: {},
    variantProductIds: {},
    assetLabel: () => "Ready",
  });
  assert.equal(review.publishable, true);
  assert.deepEqual(review.changes, [{ label: "Name", previous: "Coffee Table", next: "Cafe Table" }]);
  assert.equal(JSON.stringify(review).includes("planVersion"), false);
  assert.equal(JSON.stringify(review).includes(PARTNER_ID), false);
  const invalid = describePartnerProductReview(presentPartnerDraftPreview({
    ok: false,
    noOp: false,
    issues: [{ code: "SKU_CONFLICT", message: "This SKU is already used." }],
    productUpdates: [],
    variantUpdates: [],
  }), {
    productId: "prod-coffee",
    productNames: {},
    variantLabels: {},
    collectionNames: {},
    variantProductIds: {},
    assetLabel: () => "Ready",
  });
  assert.equal(invalid.publishable, false);
  assert.deepEqual(invalid.issues, ["This SKU is already used."]);
  assert.equal(invalid.issues.some((issue) => issue.includes("SKU_CONFLICT")), false);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /presentPartnerDraftPreview/);
  assert.match(editor, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/preview/);
  assert.match(source("app/partner/catalog/products/PartnerPublishSection.tsx"), /Review changes/);
  assert.match(renderEditor(), /Review changes/);
});

test("K other product changes are included in the publish warning", () => {
  const document = emptyDocument();
  const withOthers: PartnerCatalogSyncDocument = {
    ...document,
    products: {
      update: [
        { productId: "prod-coffee", name: "Cafe Table" },
        { productId: "prod-sofa", name: "New Sofa", priceAmount: 1900 },
      ],
      create: [],
    },
    collections: {
      ...document.collections,
      update: [{ collectionId: "col-living", name: "Rooms" }],
    },
  };
  assert.deepEqual(describePartnerPublishInclusions({
    document: withOthers,
    productId: "prod-coffee",
    productNames: { "prod-coffee": "Coffee Table", "prod-sofa": "Sofa" },
    variantProductIds: {},
  }), ["2 changes to Sofa", "1 Collection change"]);

  const html = renderEditor({
    draft: { draftId: DRAFT_ID, revision: 4, document: withOthers },
    productNames: { "prod-coffee": "Coffee Table", "prod-sofa": "Sofa" },
  });
  assert.match(html, /Also included in this publish/);
  assert.match(html, /2 changes to Sofa/);
  assert.match(html, /1 Collection change/);
  assert.doesNotMatch(html, /prod-sofa|col-living/);
  const saved = describeSavedPartnerProductChanges({
    product: product({ productId: "prod-coffee", name: "Coffee Table" }),
    variants: [],
    collections: [],
    document: withOthers,
  });
  assert.deepEqual(saved, [{ label: "Name", previous: "Coffee Table", next: "Cafe Table" }]);
});

test("L publish still uses the existing publish route and live re-check", () => {
  assert.match(partnerPublishConfirmation([], 1), new RegExp(PARTNER_PUBLISH_CONFIRMATION));
  const confirmed = partnerPublishConfirmation(["2 changes to Sofa"], 1);
  assert.match(confirmed, /This updates your live Vibode catalog\./);
  assert.match(confirmed, /2 changes to Sofa/);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /\/api\/vibode\/partner\/drafts\/\$\{current\.draftId\}\/publish/);
  assert.match(editor, /expectedDraftRevision: current\.revision/);
  assert.match(editor, /STALE_LIVE_FIELD/);
  assert.match(editor, /STALE_CATALOG_BASE/);
  assert.match(editor, /window\.location\.assign\("\/partner\/catalog"\)/);
  assert.match(editor, /partnerPublishConfirmation/);
  assert.match(source("app/api/vibode/partner/drafts/[draftId]/publish/route.ts"), /partnerPortalDraftPublishResponse/);
});

test("M the product editor does not render internal authoring terminology", () => {
  const document = emptyDocument();
  const html = renderEditor({
    draft: { draftId: DRAFT_ID, revision: 7, document },
    product: product({
      productId: "prod-coffee",
      name: "Coffee Table",
      partnerId: PARTNER_ID,
    }),
  });
  assert.doesNotMatch(html, new RegExp(PARTNER_ID));
  assert.doesNotMatch(html, new RegExp(DRAFT_ID));
  assert.doesNotMatch(html, /prod-coffee|var-coffee/);
  assert.doesNotMatch(html, /\brevision\b/i);
  assert.doesNotMatch(html, /PI-5F|planVersion|canonical patch/i);
  assert.doesNotMatch(html, /"products"\s*:/);
  assert.match(html, /Back to Catalog/);
  assert.match(html, /Coffee Table/);
  assert.equal(PARTNER_DISCARD_CONFIRMATION.includes("not only this product"), true);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /PARTNER_DISCARD_CONFIRMATION/);
  assert.match(editor, /This discards all unpublished Partner catalog changes, not only this product\./);
  assert.match(source("lib/vibode-stage/partner-product-editor.ts"), /partnerCatalogCurrencyForCreate/);
  assert.match(source("lib/vibode-stage/partner-product-editor.ts"), /empty/);
  assert.equal(source("app/partner/catalog/drafts/[draftId]/page.tsx").includes("PartnerDraftWorkspaceClient"), true);
});

test("N product status stays on the published badge until publish and reviews as Product status", () => {
  const activeHtml = renderEditor();
  const activeHeader = activeHtml.slice(0, activeHtml.indexOf("product-details-heading"));
  assert.match(activeHeader, />Active</);
  assert.match(activeHeader, /Set inactive/);
  assert.doesNotMatch(activeHeader, /Set active/);
  assert.doesNotMatch(activeHeader, /Pending:/);

  const inactiveHtml = renderEditor({
    product: product({ productId: "prod-coffee", name: "Coffee Table", status: "inactive" }),
  });
  const inactiveHeader = inactiveHtml.slice(0, inactiveHtml.indexOf("product-details-heading"));
  assert.match(inactiveHeader, />Inactive</);
  assert.match(inactiveHeader, /Set active/);
  assert.doesNotMatch(inactiveHeader, /Set inactive/);

  const pendingDocument: PartnerCatalogSyncDocument = {
    ...emptyDocument(),
    products: {
      update: [],
      create: [],
      deactivate: [{ productId: "prod-coffee" }],
      reactivate: [],
    },
  };
  const pendingHtml = renderEditor({
    draft: { draftId: DRAFT_ID, revision: 2, document: pendingDocument },
  });
  const pendingHeader = pendingHtml.slice(0, pendingHtml.indexOf("product-details-heading"));
  assert.match(pendingHeader, />Active</);
  assert.match(pendingHeader, /Pending: Inactive/);
  assert.match(pendingHeader, /Set inactive/);
  assert.doesNotMatch(pendingHeader, />Inactive</);
  assert.match(pendingHtml, /Product status/);
  assert.match(pendingHtml, /Active → Inactive/);
  assert.doesNotMatch(source("app/partner/catalog/products/PartnerProductEditor.tsx"), /product\.set_status|variant\.set_status/);

  const saved = describeSavedPartnerProductChanges({
    product: product({ productId: "prod-coffee", name: "Coffee Table" }),
    variants: [variant({ variantId: "var-coffee", productId: "prod-coffee" })],
    collections: [],
    document: pendingDocument,
  });
  assert.deepEqual(
    saved.filter((line) => line.label === "Product status"),
    [{ label: "Product status", previous: "Active", next: "Inactive" }],
  );

  const reviewInput = {
    productId: "prod-coffee",
    productNames: { "prod-coffee": "Coffee Table" },
    variantLabels: {},
    collectionNames: {},
    variantProductIds: { "var-coffee": "prod-coffee" },
    assetLabel: () => "Ready",
  };
  const inactiveReview = describePartnerProductReview(presentPartnerDraftPreview({
    ok: true,
    noOp: false,
    planVersion: 6,
    partnerId: PARTNER_ID,
    issues: [],
    productUpdates: [],
    variantUpdates: [],
    productCreates: [],
    variantCreates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [{ productId: "prod-coffee", from: "active", to: "inactive" }],
    productReactivations: [],
    variantDeactivations: [],
    variantReactivations: [],
  }), reviewInput);
  assert.equal(inactiveReview.publishable, true);
  assert.deepEqual(inactiveReview.changes, [{ label: "Product status", previous: "Active", next: "Inactive" }]);

  const activeReview = describePartnerProductReview(presentPartnerDraftPreview({
    ok: true,
    noOp: false,
    planVersion: 6,
    partnerId: PARTNER_ID,
    issues: [],
    productUpdates: [],
    variantUpdates: [],
    productCreates: [],
    variantCreates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [],
    productReactivations: [{ productId: "prod-coffee", from: "inactive", to: "active" }],
  }), reviewInput);
  assert.deepEqual(activeReview.changes, [{ label: "Product status", previous: "Inactive", next: "Active" }]);
});

test("O variant status stays on the published badge until publish and reviews by variant identity", () => {
  const activeHtml = renderEditor();
  const variantsHtml = activeHtml.slice(activeHtml.indexOf("product-variants-heading"));
  assert.match(variantsHtml, />Active</);
  assert.match(variantsHtml, /Set inactive/);
  assert.doesNotMatch(variantsHtml, /Set active/);
  assert.doesNotMatch(variantsHtml, /Pending:/);
  assert.match(variantsHtml, />3D Model</);

  const inactiveHtml = renderEditor({
    variants: [variant({
      variantId: "var-coffee",
      productId: "prod-coffee",
      assetId: ASSET_ID,
      status: "inactive",
    })],
  });
  const inactiveVariants = inactiveHtml.slice(inactiveHtml.indexOf("product-variants-heading"));
  assert.match(inactiveVariants, />Inactive</);
  assert.match(inactiveVariants, /Set active/);
  assert.doesNotMatch(inactiveVariants, /Set inactive/);
  assert.match(inactiveHtml.slice(0, inactiveHtml.indexOf("product-details-heading")), /Set inactive/);

  const pendingDocument: PartnerCatalogSyncDocument = {
    ...emptyDocument(),
    variants: {
      update: [{ variantId: "var-coffee", sku: "DFC-CT-WAL-2" }],
      create: [{
        variantId: "var-new-linen",
        productId: "prod-coffee",
        finishLabel: "New linen",
        sku: "NEW-1",
        priceAmount: 20,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: ASSET_ID,
      }],
      deactivate: [{ variantId: "var-coffee" }],
      reactivate: [],
    },
  };
  const pendingHtml = renderEditor({
    draft: { draftId: DRAFT_ID, revision: 2, document: pendingDocument },
  });
  const pendingVariants = pendingHtml.slice(pendingHtml.indexOf("product-variants-heading"));
  assert.match(pendingVariants, />Active</);
  assert.match(pendingVariants, /Pending: Inactive/);
  assert.match(pendingVariants, /Set inactive/);
  assert.match(pendingVariants, /Not published yet/);
  assert.equal((pendingVariants.match(/Set inactive/g) ?? []).length, 1);
  assert.match(pendingHtml, /Variant (&quot;|")Walnut · DFC-CT-WAL-2(&quot;|") status/);
  assert.match(pendingHtml, /Active → Inactive/);
  assert.match(pendingHtml, /Walnut · DFC-CT-WAL-2 · SKU/);

  const saved = describeSavedPartnerProductChanges({
    product: product({ productId: "prod-coffee", name: "Coffee Table" }),
    variants: [variant({ variantId: "var-coffee", productId: "prod-coffee" })],
    collections: [],
    document: pendingDocument,
  });
  assert.deepEqual(
    saved.filter((line) => line.label.includes("status")),
    [{ label: "Variant \"Walnut · DFC-CT-WAL-2\" status", previous: "Active", next: "Inactive" }],
  );
  assert.equal(saved.some((line) => line.label === "Product status"), false);
  assert.equal(saved.some((line) => line.label.endsWith("SKU")), true);

  const reviewInput = {
    productId: "prod-coffee",
    productNames: { "prod-coffee": "Coffee Table" },
    variantLabels: { "var-coffee": "Walnut · DFC-CT-WAL" },
    collectionNames: {},
    variantProductIds: { "var-coffee": "prod-coffee", "var-other": "prod-other" },
    assetLabel: () => "Ready",
  };
  const inactiveReview = describePartnerProductReview(presentPartnerDraftPreview({
    ok: true,
    noOp: false,
    planVersion: 6,
    partnerId: PARTNER_ID,
    issues: [],
    productUpdates: [],
    variantUpdates: [{
      variantId: "var-coffee",
      productId: "prod-coffee",
      changes: [{ column: "sku", previous: "DFC-CT-WAL", next: "DFC-CT-WAL-2" }],
    }],
    productCreates: [],
    variantCreates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [],
    productReactivations: [],
    variantDeactivations: [{ variantId: "var-coffee", productId: "prod-coffee", from: "active", to: "inactive" }],
    variantReactivations: [],
  }), reviewInput);
  assert.equal(inactiveReview.publishable, true);
  assert.deepEqual(inactiveReview.changes, [
    { label: "Variant \"Walnut · DFC-CT-WAL\" status", previous: "Active", next: "Inactive" },
    { label: "Walnut · DFC-CT-WAL · SKU", previous: "DFC-CT-WAL", next: "DFC-CT-WAL-2" },
  ]);

  const activeReview = describePartnerProductReview(presentPartnerDraftPreview({
    ok: true,
    noOp: false,
    planVersion: 6,
    partnerId: PARTNER_ID,
    issues: [],
    productUpdates: [],
    variantUpdates: [],
    productCreates: [],
    variantCreates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [],
    productReactivations: [],
    variantDeactivations: [],
    variantReactivations: [{ variantId: "var-coffee", productId: "prod-coffee", from: "inactive", to: "active" }],
  }), reviewInput);
  assert.deepEqual(activeReview.changes, [
    { label: "Variant \"Walnut · DFC-CT-WAL\" status", previous: "Inactive", next: "Active" },
  ]);
});
