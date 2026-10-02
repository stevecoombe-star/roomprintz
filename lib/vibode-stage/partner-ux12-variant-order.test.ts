import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerProductEditor } from "../../app/partner/catalog/products/PartnerProductEditor";
import {
  activeStageVariantsForProduct,
  createStageCatalogSnapshot,
  STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
  STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID,
  STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
  STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
  stageVariantsForProduct,
} from "./catalog";
import { assembleStageCatalogFromRows } from "./catalog-store";
import { partnerVariantHeading } from "./partner-product-editor";
import { renderPartnerCatalogSyncSql } from "./partner-catalog-sync";
import {
  assignPartnerVariantSortOrders,
  movePartnerVariant,
  nextPartnerVariantSortOrder,
  orderPartnerVariantCards,
  partnerVariantManualIds,
  partnerVariantOrderLabel,
  readPartnerVariantOrderRequest,
  samePartnerVariantOrder,
  validatePartnerVariantReorder,
  type PartnerVariantOrderCard,
} from "./partner-variant-order";
import type { StageCategory, StagePartner, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const MIGRATION = "supabase/migrations/20261002010000_vibode_stage_partner_variant_order.sql";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function card(id: string, label: string, published = true): PartnerVariantOrderCard {
  return { id, label, published };
}

function variant(overrides: Partial<StageVariant> & Pick<StageVariant, "variantId">): StageVariant {
  return {
    productId: "prod-table",
    assetId: null,
    finishLabel: null,
    sku: null,
    priceAmount: 10,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
    ...overrides,
  };
}

function product(): StageProduct {
  return {
    productId: "prod-table",
    brand: "Demo",
    name: "Table",
    retailer: "Demo",
    categoryId: "living-room",
    subcategoryId: null,
    productUrl: null,
    imageUrl: "https://cdn.test/product.jpg",
    priceAmount: 10,
    priceCurrency: "USD",
    defaultVariantId: "var-oak",
    collectionIds: [],
    source: "partner_catalog",
    partnerId: "partner-demo",
    status: "active",
  };
}

const categories: readonly StageCategory[] = [{
  id: "living-room",
  label: "Living Room",
  subcategories: [],
}];

test("existing variants initialize from variant id order and assemble in manual order", () => {
  const sql = source(MIGRATION);
  assert.match(sql, /partition by product_id/);
  assert.match(sql, /order by variant_id/);
  assert.match(sql, /row_number\(\) over \([\s\S]*\) - 1/);
  assert.doesNotMatch(sql, /default_variant_id/);
  assert.match(sql, /vibode_stage_variants_product_sort_key/);
  assert.match(sql, /deferrable initially immediate/);
  assert.match(sql, /set constraints vibode_stage_variants_product_sort_key deferred/);
  assert.doesNotMatch(sql, /update public\.vibode_stage_products/);

  const assembled = assembleStageCatalogFromRows({
    assets: [],
    products: [{
      product_id: "prod-table",
      name: "Table",
      brand: "Demo",
      retailer: "Demo",
      image_url: "https://cdn.test/product.jpg",
      product_url: null,
      price_amount: 10,
      price_currency: "USD",
      category_id: "living-room",
      subcategory_id: null,
      source: "partner_catalog",
      partner_id: "partner-demo",
      default_variant_id: "var-oak",
      status: "active",
      sort_order: 0,
    }],
    variants: [
      { variant_id: "var-black", product_id: "prod-table", finish_label: "Black", sort_order: 2, status: "active" },
      { variant_id: "var-walnut", product_id: "prod-table", finish_label: "Walnut", sort_order: 0, status: "active" },
      { variant_id: "var-oak", product_id: "prod-table", finish_label: "Oak", sort_order: 1, status: "inactive" },
    ],
    collections: [],
    memberships: [],
    partners: [],
  });
  assert.ok(assembled);
  assert.deepEqual(assembled.variants.map((item) => item.variantId), ["var-walnut", "var-oak", "var-black"]);
  assert.deepEqual(assembled.variants.map((item) => item.sortOrder), [0, 1, 2]);
  assert.deepEqual(partnerVariantManualIds(assembled.variants), ["var-walnut", "var-oak", "var-black"]);
});

test("reorder persists a complete product sequence and rejects foreign, duplicate, and partial payloads", () => {
  const owned = ["var-walnut", "var-oak", "var-black"];
  assert.equal(validatePartnerVariantReorder(["var-black", "var-walnut", "var-oak"], owned), null);
  assert.equal(validatePartnerVariantReorder(
    ["var-walnut", "var-walnut", "var-oak"],
    owned,
  ), "duplicate_variant");
  assert.equal(validatePartnerVariantReorder(
    ["var-walnut", "var-oak", "var-other-product"],
    owned,
  ), "unknown_variant");
  assert.equal(validatePartnerVariantReorder(["var-walnut", "var-oak"], owned), "incomplete_order");
  assert.equal(readPartnerVariantOrderRequest({
    productId: "not an id",
    variantIds: owned,
  }), null);
  assert.equal(readPartnerVariantOrderRequest({
    variantIds: owned,
  }), null);
  assert.equal(readPartnerVariantOrderRequest({
    productId: "prod-table",
    variantIds: ["var-walnut", "bad id"],
  }), null);
  assert.deepEqual(readPartnerVariantOrderRequest({
    partnerId: "partner-someone-else",
    productId: "prod-table",
    variantIds: ["var-black", "var-walnut", "var-oak"],
  }), {
    productId: "prod-table",
    variantIds: ["var-black", "var-walnut", "var-oak"],
  });

  assert.deepEqual(assignPartnerVariantSortOrders(
    ["var-black", "var-walnut", "var-oak"],
    [
      { variantId: "var-walnut", sortOrder: 4 },
      { variantId: "var-oak", sortOrder: 5 },
      { variantId: "var-black", sortOrder: 7 },
    ],
  ), [
    { variantId: "var-black", sortOrder: 4 },
    { variantId: "var-walnut", sortOrder: 5 },
    { variantId: "var-oak", sortOrder: 7 },
  ]);
  assert.deepEqual(movePartnerVariant(["var-walnut", "var-oak", "var-black"], 2, 0), [
    "var-black",
    "var-walnut",
    "var-oak",
  ]);
});

test("a new variant appends and activation does not rewrite manual order", () => {
  assert.equal(nextPartnerVariantSortOrder([
    { sortOrder: 4 },
    { sortOrder: 7 },
  ]), 8);
  assert.equal(nextPartnerVariantSortOrder([
    { sortOrder: 4 },
    { sortOrder: 7 },
  ], 1), 9);
  assert.equal(nextPartnerVariantSortOrder([{}, {}]), 2);

  const sql = source(MIGRATION);
  assert.match(sql, /if new\.sort_order is not null then/);
  assert.match(sql, /coalesce\(max\(variants\.sort_order\), -1\) \+ 1/);
  assert.match(sql, /vibode-variant-order:/);
  assert.match(sql, /raise exception 'duplicate_variant'/);
  assert.match(sql, /raise exception 'duplicate_position'/);
  assert.match(sql, /raise exception 'unknown_variant'/);
  assert.match(sql, /raise exception 'unknown_product'/);
  assert.match(sql, /raise exception 'incomplete_order'/);
  assert.match(sql, /source = 'partner_catalog'/);
  assert.match(sql, /revoke all on function public\.vibode_stage_reorder_partner_product_variants\(text, text, jsonb\)/);
  assert.match(sql, /grant execute on function public\.vibode_stage_reorder_partner_product_variants\(text, text, jsonb\)\s+to service_role/);
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.vibode_stage_reorder_partner_product_variants\(text, text, jsonb\)\s+to (anon|authenticated|public)/,
  );

  const partner: StagePartner = {
    partnerId: "partner-demo",
    name: "Demo",
    slug: "demo",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  };
  const statusSql = renderPartnerCatalogSyncSql({
    partner,
    productUpdates: [],
    variantUpdates: [],
    variantCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    variantDeactivations: [{ variantId: "var-oak", productId: "prod-table", from: "active", to: "inactive" }],
    variantReactivations: [{ variantId: "var-black", productId: "prod-table", from: "inactive", to: "active" }],
    current: {
      partners: [partner],
      products: [],
      variants: [],
      collections: [],
    },
  });
  assert.match(statusSql, /status = 'inactive'/);
  assert.match(statusSql, /status = 'active'/);
  assert.doesNotMatch(statusSql, /sort_order/);

  const sync = source("lib/vibode-stage/partner-catalog-sync.ts");
  const insertAt = sync.indexOf("insert into public.vibode_stage_variants");
  assert.ok(insertAt >= 0);
  const insertBlock = sync.slice(insertAt, insertAt + 700);
  assert.match(insertBlock, /product_url/);
  assert.doesNotMatch(insertBlock, /sort_order/);
});

test("name sorting is natural, case-insensitive, and does not change manual order", () => {
  assert.equal(partnerVariantOrderLabel({
    finish: "Oak",
    sku: "A",
    variantId: "var-oak",
  }), partnerVariantHeading("Oak", "A"));
  assert.equal(partnerVariantOrderLabel({
    finish: "  ",
    sku: null,
    variantId: "var-blank",
  }), "var-blank");
  assert.equal(partnerVariantHeading(null, null), "Variant");

  const cards = [
    card("var-10", "Finish 10"),
    card("var-walnut", "Walnut"),
    card("var-2", "Finish 2"),
    card("var-oak", "oak"),
  ];
  const manual = cards.map((item) => item.id);
  const ascending = orderPartnerVariantCards(cards, "name_asc", manual);
  assert.deepEqual(ascending.map((item) => item.label), ["Finish 2", "Finish 10", "oak", "Walnut"]);
  assert.deepEqual(
    orderPartnerVariantCards(cards, "name_desc", manual).map((item) => item.label),
    ["Walnut", "oak", "Finish 10", "Finish 2"],
  );
  assert.deepEqual(cards.map((item) => item.label), ["Finish 10", "Walnut", "Finish 2", "oak"]);
  assert.deepEqual(manual, ["var-10", "var-walnut", "var-2", "var-oak"]);

  const tied = [card("var-b", "Chair"), card("var-a", "chair")];
  assert.deepEqual(orderPartnerVariantCards(tied, "name_asc", ["var-b", "var-a"]).map((item) => item.id), [
    "var-a",
    "var-b",
  ]);
  assert.deepEqual(orderPartnerVariantCards(tied, "name_desc", ["var-b", "var-a"]).map((item) => item.id), [
    "var-b",
    "var-a",
  ]);

  const withPending = [
    card("var-walnut", "Walnut"),
    card("var-oak", "Oak"),
    card("var-pending", "Ash", false),
  ];
  assert.deepEqual(orderPartnerVariantCards(withPending, "manual", ["var-oak", "var-walnut"]).map((item) => item.id), [
    "var-oak",
    "var-walnut",
    "var-pending",
  ]);
  assert.deepEqual(orderPartnerVariantCards(withPending, "name_asc", ["var-oak", "var-walnut"]).map((item) => item.id), [
    "var-pending",
    "var-oak",
    "var-walnut",
  ]);
  assert.equal(samePartnerVariantOrder(["var-oak", "var-walnut"], ["var-oak", "var-walnut"]), true);
});

test("shopper variant order follows manual sort_order and keeps relative order after filtering", () => {
  const catalog = createStageCatalogSnapshot({
    authority: "durable",
    products: [product()],
    variants: [
      variant({ variantId: "var-black", finishLabel: "Black", sortOrder: 3, status: "active" }),
      variant({ variantId: "var-walnut", finishLabel: "Walnut", sortOrder: 0, status: "active" }),
      variant({ variantId: "var-oak", finishLabel: "Oak", sortOrder: 1, status: "inactive" }),
      variant({ variantId: "var-white", finishLabel: "White", sortOrder: 2, status: "active" }),
    ],
    assets: [],
    collections: [],
  });
  assert.deepEqual(stageVariantsForProduct("prod-table", [], catalog).map((item) => item.variantId), [
    "var-walnut",
    "var-oak",
    "var-white",
    "var-black",
  ]);
  assert.deepEqual(activeStageVariantsForProduct("prod-table", [], catalog).map((item) => item.variantId), [
    "var-walnut",
    "var-white",
    "var-black",
  ]);
  assert.notEqual(catalog.products[0]?.defaultVariantId, "var-walnut");

  const sideTable = stageVariantsForProduct(STAGE_STUDIO_SIDE_TABLE_PRODUCT_ID);
  assert.deepEqual(sideTable.map((item) => item.variantId), [
    STAGE_STUDIO_SIDE_TABLE_VARIANT_ID,
    STAGE_STUDIO_SIDE_TABLE_BLACK_VARIANT_ID,
    STAGE_STUDIO_SIDE_TABLE_WALNUT_VARIANT_ID,
  ]);

  const detail = source("components/stage/StageProductDetail.tsx");
  const persistence = source("lib/vibode-stage/catalog-persistence.server.ts");
  assert.match(detail, /stageVariantsForProduct/);
  assert.match(detail, /\.filter\(\(item\) => isStageCommercialActive\(item\.status\)\)/);
  assert.doesNotMatch(detail, /localeCompare|name_asc|name_desc|\.sort\(/);
  assert.match(persistence, /sort_order/);
  assert.match(persistence, /"sort_order",\s*\n\s*"variant_id"/);
  assert.match(source("lib/vibode-stage/catalog.ts"), /sortOrder/);
});

test("partner variant sort is a view control and manual reorder saves once", () => {
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /setVariantSort\(event\.target\.value as PartnerVariantSort\)/);
  assert.doesNotMatch(editor, /onChange=\{\(event\) => \{[^}]*persistVariantOrder/);
  assert.match(editor, /void persistVariantOrder\(manualRef\.current\)/);
  assert.match(editor, /\/api\/vibode\/partner\/catalog\/variants\/order/);
  assert.match(editor, /moveVariantByKey/);
  assert.doesNotMatch(editor, /onDragOver=\{[^}]*persistVariantOrder/);
  assert.match(source("app/partner/catalog/products/[productId]/page.tsx"), /PartnerProductEditorRefresh/);
  assert.match(source("lib/vibode-stage/partner-variant-order.server.ts"), /auth\.context\.partnerId/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-variant-order.server.ts"), /p_partner_id: body|body\.partnerId/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-order.ts"), /variant/);
  assert.doesNotMatch(source("supabase/migrations/20261001230000_vibode_stage_partner_catalog_order.sql"), /vibode_stage_variants/);

  const html = renderToStaticMarkup(createElement(PartnerProductEditor, {
    product: {
      ...product(),
      productId: "prod-coffee",
      name: "Coffee Table",
      defaultVariantId: "var-oak",
    },
    variants: [
      variant({
        variantId: "var-oak",
        productId: "prod-coffee",
        finishLabel: "Oak",
        sku: null,
        sortOrder: 1,
      }),
      variant({
        variantId: "var-walnut",
        productId: "prod-coffee",
        finishLabel: "Walnut",
        sku: null,
        sortOrder: 0,
      }),
    ],
    collections: [],
    assets: [],
    commercialAssetOptions: [],
    categories,
    draft: null,
    productNames: { "prod-coffee": "Coffee Table" },
    variantProductIds: { "var-oak": "prod-coffee", "var-walnut": "prod-coffee" },
  }));
  assert.match(html, /Sort/);
  assert.match(html, /Manual/);
  assert.match(html, /Name A–Z/);
  assert.match(html, /Name Z–A/);
  assert.match(html, /data-variant-sort="manual"/);
  const walnutAt = html.indexOf(">Walnut<");
  const oakAt = html.indexOf(">Oak<");
  assert.ok(walnutAt >= 0 && oakAt > walnutAt);
  assert.match(html, /Reorder Walnut/);
  assert.match(html, /Reorder Oak/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /ArrowUp ArrowDown/);
  assert.doesNotMatch(html.slice(walnutAt, oakAt), />Default</);
  assert.match(html.slice(oakAt), />Default</);

  const single = renderToStaticMarkup(createElement(PartnerProductEditor, {
    product: {
      ...product(),
      productId: "prod-coffee",
      name: "Coffee Table",
      defaultVariantId: "var-walnut",
    },
    variants: [variant({
      variantId: "var-walnut",
      productId: "prod-coffee",
      finishLabel: "Walnut",
      sku: null,
    })],
    collections: [],
    assets: [],
    commercialAssetOptions: [],
    categories,
    draft: null,
    productNames: { "prod-coffee": "Coffee Table" },
    variantProductIds: { "var-walnut": "prod-coffee" },
  }));
  assert.doesNotMatch(single, /data-variant-sort|Reorder /);
});
