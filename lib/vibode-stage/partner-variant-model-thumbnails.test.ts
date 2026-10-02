import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerModelThumbnail, modelThumbnailIsFailed } from "../../app/partner/PartnerModelThumbnail";
import { PartnerInlineModelPanel } from "../../app/partner/catalog/products/PartnerInlineModelPanel";
import { PartnerProductEditor } from "../../app/partner/catalog/products/PartnerProductEditor";
import { PartnerVariantModelSummary } from "../../app/partner/catalog/products/PartnerModelSection";
import type { PartnerCommercialAssetOption } from "./partner-commercial-assets";
import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import {
  partnerDisplayedModelThumbnail,
  partnerEditorModelAssetIds,
  partnerVariantAssignedThumbnailUrl,
  presentPartnerVariantModel,
} from "./partner-product-editor";
import type { StageAsset, StageCategory, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const CHAIR_ID = "vibode-stage/partner-intake/chair";
const SOFA_ID = "vibode-stage/partner-intake/sofa";
const TABLE_ID = "vibode-stage/partner-intake/table";
const CHAIR_URL = "https://cdn.test/thumbs/chair.webp";
const SOFA_URL = "https://cdn.test/thumbs/sofa.webp";
const TABLE_URL = "https://cdn.test/thumbs/table.webp";
const GLB_URL = "https://cdn.test/models/chair.glb";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function option(assetId: string, fileName: string): PartnerCommercialAssetOption {
  return {
    assetId,
    status: "ready",
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
    origin: "partner_intake",
    originalFileName: fileName,
    label: fileName,
  };
}

function asset(assetId: string): StageAsset {
  return {
    assetId,
    glbUrl: GLB_URL,
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
    status: "ready",
  };
}

function product(): StageProduct {
  return {
    productId: "prod-living",
    name: "Living Set",
    brand: "Demo",
    retailer: "Demo",
    categoryId: "living-room",
    subcategoryId: "seating",
    productUrl: "https://example.test/living",
    imageUrl: "https://cdn.test/product.jpg",
    priceAmount: 400,
    priceCurrency: "USD",
    defaultVariantId: "var-chair",
    collectionIds: [],
    source: "partner_catalog",
    partnerId: "partner-demo-furniture-co",
    status: "active",
  };
}

function variant(
  variantId: string,
  assetId: string | null,
  finish: string,
): StageVariant {
  return {
    variantId,
    productId: "prod-living",
    assetId,
    finishLabel: finish,
    sku: finish.toUpperCase(),
    priceAmount: 400,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
  };
}

const categories: readonly StageCategory[] = [{
  id: "living-room",
  label: "Living Room",
  subcategories: [{ id: "seating", label: "Seating" }],
}];

const thumbs: Readonly<Record<string, string | null>> = {
  [CHAIR_ID]: CHAIR_URL,
  [SOFA_ID]: SOFA_URL,
  [TABLE_ID]: TABLE_URL,
};

function renderEditor(input: Readonly<{
  variants: readonly StageVariant[];
  thumbnailUrls?: Readonly<Record<string, string | null>>;
  draft?: PartnerCatalogSyncDocument | null;
}>): string {
  return renderToStaticMarkup(createElement(PartnerProductEditor, {
    product: product(),
    variants: input.variants,
    collections: [],
    assets: [asset(CHAIR_ID), asset(SOFA_ID), asset(TABLE_ID)],
    commercialAssetOptions: [
      option(CHAIR_ID, "chair.glb"),
      option(SOFA_ID, "sofa.glb"),
      option(TABLE_ID, "table.glb"),
    ],
    categories,
    draft: input.draft ? {
      draftId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      revision: 3,
      document: input.draft,
    } : null,
    productNames: { "prod-living": "Living Set" },
    variantProductIds: Object.fromEntries(input.variants.map((item) => [item.variantId, item.productId])),
    modelThumbnailUrls: input.thumbnailUrls,
  }));
}

function between(html: string, start: string, end: string | null): string {
  const from = html.indexOf(start);
  assert.ok(from >= 0, start);
  const to = end == null ? html.length : html.indexOf(end, from + start.length);
  assert.ok(to >= from, end ?? "end");
  return html.slice(from, to);
}

function emptyDocument(): PartnerCatalogSyncDocument {
  return {
    partnerId: "partner-demo-furniture-co",
    mode: "patch",
    products: { update: [], create: [] },
    variants: { update: [], create: [] },
    collections: { update: [], create: [], membershipAdd: [], membershipRemove: [] },
  };
}

test("an assigned model thumbnail follows that variant asset, not another model", () => {
  assert.equal(partnerVariantAssignedThumbnailUrl(CHAIR_ID, thumbs), CHAIR_URL);
  assert.equal(partnerVariantAssignedThumbnailUrl(SOFA_ID, thumbs), SOFA_URL);
  assert.equal(partnerVariantAssignedThumbnailUrl(null, thumbs), undefined);
  assert.equal(partnerVariantAssignedThumbnailUrl(CHAIR_ID, undefined), undefined);
  assert.equal(partnerVariantAssignedThumbnailUrl("missing", thumbs), null);

  const chair = presentPartnerVariantModel({
    assetId: CHAIR_ID,
    assets: [asset(CHAIR_ID)],
    options: [option(CHAIR_ID, "chair.glb"), option(SOFA_ID, "sofa.glb")],
    published: true,
    thumbnailUrls: thumbs,
  });
  assert.equal(chair.thumbnailUrl, CHAIR_URL);
  assert.equal(chair.filename, "chair.glb");
  const sofa = presentPartnerVariantModel({
    assetId: SOFA_ID,
    assets: [asset(SOFA_ID)],
    options: [option(CHAIR_ID, "chair.glb"), option(SOFA_ID, "sofa.glb")],
    published: true,
    thumbnailUrls: thumbs,
  });
  assert.equal(sofa.thumbnailUrl, SOFA_URL);
  assert.notEqual(sofa.thumbnailUrl, chair.thumbnailUrl);
});

test("a variant with a thumbnail shows that image, and a missing thumbnail shows the placeholder", () => {
  const withThumb = renderToStaticMarkup(createElement(PartnerVariantModelSummary, {
    presentation: {
      stateLabel: "Ready",
      filename: "chair.glb",
      detail: null,
      note: null,
      thumbnailUrl: CHAIR_URL,
    },
    productName: "Living Set",
    finish: "Oak",
  }));
  assert.match(withThumb, /data-model-thumbnail="image"/);
  assert.match(withThumb, new RegExp(`src="${CHAIR_URL}"`));
  assert.match(withThumb, /object-contain/);
  assert.match(withThumb, /chair\.glb/);
  assert.match(withThumb, />3D Model</);
  assert.doesNotMatch(withThumb, /<canvas|GLTFLoader|WebGLRenderer/);

  const missing = renderToStaticMarkup(createElement(PartnerVariantModelSummary, {
    presentation: {
      stateLabel: "Ready",
      filename: "chair.glb",
      detail: null,
      note: null,
      thumbnailUrl: null,
    },
    productName: "Living Set",
    finish: "Oak",
  }));
  assert.match(missing, /data-model-thumbnail="placeholder"/);
  assert.match(missing, /chair\.glb preview/);
  assert.doesNotMatch(missing, /<img/);
  assert.match(missing, /chair\.glb/);

  const unsafe = renderToStaticMarkup(createElement(PartnerModelThumbnail, {
    url: "javascript:alert(1)",
    label: "chair.glb",
  }));
  assert.match(unsafe, /data-model-thumbnail="placeholder"/);
  assert.doesNotMatch(unsafe, /<img|javascript:alert/);

  const broken = renderToStaticMarkup(createElement(PartnerModelThumbnail, {
    url: CHAIR_URL,
    label: "chair.glb",
    imageFailed: true,
  }));
  assert.match(broken, /data-model-thumbnail="placeholder"/);
  assert.doesNotMatch(broken, /<img/);
  assert.equal(modelThumbnailIsFailed(CHAIR_URL, CHAIR_URL), true);
  assert.equal(modelThumbnailIsFailed(SOFA_URL, CHAIR_URL), false);
});

test("two variants show their own model thumbnails", () => {
  const html = renderEditor({
    variants: [
      variant("var-chair", CHAIR_ID, "Oak"),
      variant("var-sofa", SOFA_ID, "Ivory"),
    ],
    thumbnailUrls: thumbs,
  });
  const chair = between(html, "Oak · OAK", "Ivory · IVORY");
  const sofa = between(html, "Ivory · IVORY", null);
  assert.match(chair, new RegExp(`src="${CHAIR_URL}"`));
  assert.match(chair, /chair\.glb/);
  assert.doesNotMatch(chair, new RegExp(SOFA_URL));
  assert.doesNotMatch(chair, new RegExp(TABLE_URL));
  assert.match(sofa, new RegExp(`src="${SOFA_URL}"`));
  assert.match(sofa, /sofa\.glb/);
  assert.doesNotMatch(sofa, new RegExp(CHAIR_URL));
  assert.doesNotMatch(sofa, new RegExp(TABLE_URL));
  assert.doesNotMatch(html, new RegExp(GLB_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /<canvas|model-thumbnails|GLTFLoader|WebGLRenderer/);
  assert.match(html, /https:\/\/cdn\.test\/product\.jpg/);
});

test("changing or removing the assigned model changes the thumbnail with it", () => {
  const chair = renderEditor({
    variants: [variant("var-chair", CHAIR_ID, "Oak")],
    thumbnailUrls: thumbs,
  });
  assert.match(chair, new RegExp(`src="${CHAIR_URL}"`));
  assert.doesNotMatch(chair, new RegExp(SOFA_URL));

  const sofa = renderEditor({
    variants: [variant("var-chair", SOFA_ID, "Oak")],
    thumbnailUrls: thumbs,
  });
  assert.match(sofa, new RegExp(`src="${SOFA_URL}"`));
  assert.doesNotMatch(sofa, new RegExp(CHAIR_URL));

  const removed = renderEditor({
    variants: [variant("var-chair", null, "Oak")],
    thumbnailUrls: thumbs,
  });
  assert.match(removed, /No 3D model/);
  assert.doesNotMatch(removed, /data-model-thumbnail|chair\.webp|sofa\.webp|table\.webp/);

  const pendingChair = renderEditor({
    variants: [],
    thumbnailUrls: thumbs,
    draft: {
      ...emptyDocument(),
      variants: {
        update: [],
        create: [{
          variantId: "var-pending",
          productId: "prod-living",
          finishLabel: "Oak",
          sku: "PEND",
          priceAmount: 10,
          priceCurrency: "USD",
          productUrl: null,
          currentAssetId: CHAIR_ID,
        }],
      },
    },
  });
  assert.match(pendingChair, new RegExp(`src="${CHAIR_URL}"`));
  const pendingSofa = renderEditor({
    variants: [],
    thumbnailUrls: thumbs,
    draft: {
      ...emptyDocument(),
      variants: {
        update: [],
        create: [{
          variantId: "var-pending",
          productId: "prod-living",
          finishLabel: "Oak",
          sku: "PEND",
          priceAmount: 10,
          priceCurrency: "USD",
          productUrl: null,
          currentAssetId: SOFA_ID,
        }],
      },
    },
  });
  assert.match(pendingSofa, new RegExp(`src="${SOFA_URL}"`));
  assert.doesNotMatch(pendingSofa, new RegExp(CHAIR_URL));

  const cleared = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: { stateLabel: "No 3D model", filename: null, detail: null, note: null },
    upload: { phase: "idle" },
    options: [],
    selectedAssetId: "",
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.doesNotMatch(cleared, /data-model-thumbnail/);

  const replacing = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: {
      stateLabel: "Ready",
      filename: "chair.glb",
      detail: null,
      note: null,
      thumbnailUrl: CHAIR_URL,
    },
    upload: { phase: "ready", fileName: "sofa.glb" },
    options: [],
    selectedAssetId: CHAIR_ID,
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(replacing, /data-model-thumbnail="placeholder"/);
  assert.match(replacing, /sofa\.glb/);
  assert.doesNotMatch(replacing, new RegExp(CHAIR_URL));
  assert.equal(partnerDisplayedModelThumbnail({
    stateLabel: "Ready",
    filename: "chair.glb",
    thumbnailUrl: CHAIR_URL,
    replacingFileName: "sofa.glb",
  })?.url, null);
});

test("the product editor loads thumbnails in one batch and does not render or generate GLBs", () => {
  const ids = partnerEditorModelAssetIds({
    optionAssetIds: [CHAIR_ID, SOFA_ID, CHAIR_ID],
    variantAssetIds: [SOFA_ID, null, "  "],
    pendingAssetIds: [TABLE_ID],
  });
  assert.deepEqual(ids, [CHAIR_ID, SOFA_ID, TABLE_ID]);

  const page = source("app/partner/catalog/products/[productId]/page.tsx");
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  const section = source("app/partner/catalog/products/PartnerModelSection.tsx");
  const panel = source("app/partner/catalog/products/PartnerInlineModelPanel.tsx");
  const thumbnail = source("app/partner/PartnerModelThumbnail.tsx");
  const persist = source("lib/vibode-model-thumbnail/persist.server.ts");
  assert.equal(page.match(/await attachModelThumbnailUrls/g)?.length, 1);
  assert.match(page, /partnerEditorModelAssetIds/);
  assert.match(persist, /\.in\("asset_id", ids\)/);
  assert.match(persist, /createSignedUrls\(paths/);
  const display = [page, editor, section, panel, thumbnail].join("\n");
  assert.doesNotMatch(display, /generatePartnerModelThumbnail|GLTFLoader|WebGLRenderer|render-browser|model-thumbnails\/source/);
  assert.doesNotMatch(editor, /setThumbnail|useState\([^\n]*thumbnail/);
  assert.match(editor, /assetId: variant\.assetId/);
  assert.match(editor, /published: true/);
  assert.match(editor, /thumbnailUrls: props\.modelThumbnailUrls/);
  assert.match(editor, /assetId: create\.currentAssetId/);
  assert.match(editor, /status: "abandoned"/);
  assert.doesNotMatch(thumbnail, /<canvas/);
});
