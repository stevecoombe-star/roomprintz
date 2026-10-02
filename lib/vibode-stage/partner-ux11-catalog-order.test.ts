import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerCatalogOrderEditor } from "../../app/partner/catalog/PartnerCatalogOrderEditor";
import { PartnerCatalogWorkspace } from "../../app/partner/catalog/PartnerCatalogWorkspace";
import { assembleStageCatalogFromRows } from "./catalog-store";
import {
  assignPartnerManualSortOrders,
  movePartnerCatalogProduct,
  nextPartnerProductSortOrder,
  readPartnerCatalogOrderIds,
  validatePartnerCatalogReorder,
} from "./partner-catalog-order";
import { renderPartnerCatalogSyncSql } from "./partner-catalog-sync";
import {
  filterPartnerCatalogRows,
  sortPartnerCatalogRows,
  type PartnerCatalogProductRow,
} from "./partner-catalog-workspace";
import type { StagePartner } from "./types";

const ROOT = process.cwd();
const MIGRATION = "supabase/migrations/20261001230000_vibode_stage_partner_catalog_order.sql";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function row(
  productKey: string,
  name: string,
  extras: Partial<PartnerCatalogProductRow> = {},
): PartnerCatalogProductRow {
  return {
    productKey,
    name,
    imageUrl: "",
    status: "active",
    statusLabel: "Active",
    variantCountLabel: "1 variant",
    variantSummary: null,
    priceLabel: "",
    collectionNames: [],
    readiness: "ready",
    readinessLabel: "Ready",
    searchText: name.toLowerCase(),
    ...extras,
  };
}

function productRow(productId: string, name: string, sortOrder: number) {
  return {
    product_id: productId,
    name,
    brand: "Demo",
    retailer: "Demo",
    image_url: "https://cdn.test/product.jpg",
    product_url: null,
    price_amount: 10,
    price_currency: "USD",
    category_id: "living-room",
    subcategory_id: null,
    source: "vibode_curated",
    partner_id: null,
    default_variant_id: "var-default",
    status: "active",
    sort_order: sortOrder,
  };
}

test("existing catalog order is sort_order then product id", () => {
  const assembled = assembleStageCatalogFromRows({
    assets: [],
    products: [
      productRow("prod-b", "Tied B", 0),
      productRow("prod-a", "Tied A", 0),
      productRow("prod-c", "Later", 4),
    ],
    variants: [],
    collections: [],
    memberships: [],
    partners: [],
  });
  assert.ok(assembled);
  assert.deepEqual(assembled.products.map((product) => product.productId), [
    "prod-a",
    "prod-b",
    "prod-c",
  ]);
  assert.deepEqual(assembled.products.map((product) => product.sortOrder), [0, 0, 4]);
});

test("tied manual positions expand without moving an already increasing sequence", () => {
  assert.deepEqual(assignPartnerManualSortOrders(
    ["prod-sofa", "prod-chair", "prod-table"],
    [
      { productId: "prod-sofa", sortOrder: 4 },
      { productId: "prod-chair", sortOrder: 5 },
      { productId: "prod-table", sortOrder: 7 },
    ],
  ), [
    { productId: "prod-sofa", sortOrder: 4 },
    { productId: "prod-chair", sortOrder: 5 },
    { productId: "prod-table", sortOrder: 7 },
  ]);

  assert.deepEqual(assignPartnerManualSortOrders(
    ["prod-b", "prod-a"],
    [
      { productId: "prod-a", sortOrder: 0 },
      { productId: "prod-b", sortOrder: 0 },
    ],
  ), [
    { productId: "prod-b", sortOrder: 0 },
    { productId: "prod-a", sortOrder: 1 },
  ]);
});

test("a new product appends after the highest manual position", () => {
  assert.equal(nextPartnerProductSortOrder([
    { sortOrder: 4 },
    { sortOrder: 7 },
  ]), 8);
  assert.equal(nextPartnerProductSortOrder([
    { sortOrder: 4 },
    { sortOrder: 7 },
  ], 1), 9);
  assert.equal(nextPartnerProductSortOrder([{}, {}]), 2);
  assert.match(source("lib/vibode-stage/partner-catalog-sync.ts"), /nextPartnerProductSortOrder/);
  assert.match(source("lib/vibode-stage/partner-catalog-snapshot.ts"), /nextPartnerProductSortOrder/);
});

test("reorder rejects duplicates, foreign products, and partial lists", () => {
  const owned = ["prod-sofa", "prod-chair", "prod-lamp"];
  assert.equal(validatePartnerCatalogReorder(
    ["prod-lamp", "prod-sofa", "prod-chair"],
    owned,
  ), null);
  assert.equal(validatePartnerCatalogReorder(
    ["prod-sofa", "prod-sofa", "prod-chair"],
    owned,
  ), "duplicate_product");
  assert.equal(validatePartnerCatalogReorder(
    ["prod-sofa", "prod-chair", "prod-other-partner"],
    owned,
  ), "unknown_product");
  assert.equal(validatePartnerCatalogReorder(
    ["prod-sofa", "prod-chair"],
    owned,
  ), "incomplete_order");
  assert.equal(readPartnerCatalogOrderIds({
    partnerId: "partner-someone-else",
    productIds: ["prod-sofa", "not an id"],
  }), null);
  assert.deepEqual(readPartnerCatalogOrderIds({
    partnerId: "partner-someone-else",
    productIds: ["prod-sofa"],
  }), ["prod-sofa"]);
  assert.equal(readPartnerCatalogOrderIds({ productIds: ["prod-sofa", "prod-sofa"] })?.[0], "prod-sofa");
});

test("moving a product shifts its neighbors once", () => {
  assert.deepEqual(
    movePartnerCatalogProduct(["sofa", "chair", "table", "lamp"], 3, 1),
    ["sofa", "lamp", "chair", "table"],
  );
  assert.deepEqual(
    movePartnerCatalogProduct(["sofa", "chair"], 0, 0),
    ["sofa", "chair"],
  );
});

test("name sorting is natural, case-insensitive, and reversible", () => {
  const products = [
    row("prod-chair-10", "Chair 10"),
    row("prod-sofa", "Sofa"),
    row("prod-chair-2", "Chair 2"),
    row("prod-coffee", "coffee table"),
  ];
  const ascending = sortPartnerCatalogRows(products, "name_asc").map((item) => item.name);
  assert.deepEqual(ascending, ["Chair 2", "Chair 10", "coffee table", "Sofa"]);
  assert.deepEqual(
    sortPartnerCatalogRows(products, "name_desc").map((item) => item.name),
    [...ascending].reverse(),
  );
  assert.deepEqual(products.map((item) => item.name), [
    "Chair 10",
    "Sofa",
    "Chair 2",
    "coffee table",
  ]);

  const tied = [
    row("prod-b", "Chair"),
    row("prod-a", "chair"),
  ];
  assert.deepEqual(sortPartnerCatalogRows(tied, "name_asc").map((item) => item.productKey), [
    "prod-a",
    "prod-b",
  ]);
  assert.deepEqual(sortPartnerCatalogRows(tied, "name_desc").map((item) => item.productKey), [
    "prod-b",
    "prod-a",
  ]);
});

test("filters keep relative manual order and do not rewrite it", () => {
  const products = [
    row("prod-sofa", "Sofa"),
    row("prod-chair", "Chair", { searchText: "chair\nkeep" }),
    row("prod-table", "Coffee Table"),
    row("prod-lamp", "Lamp", { searchText: "lamp\nkeep", status: "inactive", statusLabel: "Inactive" }),
  ];
  const filtered = filterPartnerCatalogRows(products, {
    query: "keep",
    status: "all",
    readiness: "all",
  });
  assert.deepEqual(
    sortPartnerCatalogRows(filtered, "manual").map((item) => item.name),
    ["Chair", "Lamp"],
  );
  assert.deepEqual(products.map((item) => item.name), ["Sofa", "Chair", "Coffee Table", "Lamp"]);
  assert.deepEqual(filterPartnerCatalogRows(products, {
    query: "",
    status: "inactive",
    readiness: "all",
  }).map((item) => item.name), ["Lamp"]);
});

test("activating or deactivating a product does not write sort_order", () => {
  const partner: StagePartner = {
    partnerId: "partner-demo",
    name: "Demo",
    slug: "demo",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  };
  const current = {
    partners: [partner],
    products: [],
    variants: [],
    collections: [],
  };
  const sql = renderPartnerCatalogSyncSql({
    partner,
    productUpdates: [],
    variantUpdates: [],
    variantCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [{ productId: "prod-chair", from: "active", to: "inactive" }],
    productReactivations: [{ productId: "prod-lamp", from: "inactive", to: "active" }],
    current,
  });
  assert.match(sql, /status = 'inactive'/);
  assert.match(sql, /status = 'active'/);
  assert.doesNotMatch(sql, /sort_order\s*=/);
});

test("catalog sort is a view control and normal cards are not draggable", () => {
  const products = [row("prod-chair", "Chair"), row("prod-sofa", "Sofa")];
  const html = renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: products,
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
  assert.match(html, /Sort/);
  assert.match(html, /Manual/);
  assert.match(html, /Name A–Z/);
  assert.match(html, /Name Z–A/);
  assert.match(html, /value="manual"/);
  assert.match(html, /Manage catalog/);
  assert.doesNotMatch(html, /draggable|Reorder /);
  assert.doesNotMatch(source("app/partner/catalog/PartnerCatalogWorkspace.tsx"), /draggable/);

  const empty = renderToStaticMarkup(createElement(PartnerCatalogWorkspace, {
    rows: [],
    openDraftId: null,
    hasUnpublishedChanges: false,
  }));
  assert.match(empty, /No products yet/);
  assert.doesNotMatch(empty, /Sort/);

  const one = renderToStaticMarkup(createElement(PartnerCatalogOrderEditor, {
    products: [{ productId: "prod-chair", name: "Chair" }],
  }));
  assert.equal(one, "");

  const manage = renderToStaticMarkup(createElement(PartnerCatalogOrderEditor, {
    products: [
      { productId: "prod-sofa", name: "Sofa", status: "active" },
      { productId: "prod-chair", name: "Chair", status: "inactive" },
    ],
  }));
  assert.match(manage, /Catalog order/);
  assert.match(manage, /draggable="true"/);
  assert.match(manage, /Reorder Sofa/);
  assert.match(manage, /Reorder Chair/);
  assert.match(manage, /☰/);
  assert.match(manage, /ArrowUp ArrowDown/);
  assert.match(manage, />Inactive</);
  assert.match(source("app/partner/catalog/PartnerCatalogOrderEditor.tsx"), /\/api\/vibode\/partner\/catalog\/order/);
  assert.match(source("app/partner/catalog/PartnerCatalogOrderEditor.tsx"), /onDrop=\{/);
  assert.doesNotMatch(
    source("app/partner/catalog/PartnerCatalogOrderEditor.tsx"),
    /onDragOver=\{[^}]*persistOrder/,
  );
  assert.match(
    source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx"),
    /PartnerCatalogOrderEditor/,
  );
});

test("reorder migration is partner-scoped, atomic, and leaves variant order alone", () => {
  const sql = source(MIGRATION);
  assert.match(sql, /source = 'partner_catalog'/);
  assert.match(sql, /order by sort_order, product_id/);
  assert.match(sql, /raise exception 'duplicate_product'/);
  assert.match(sql, /raise exception 'unknown_product'/);
  assert.match(sql, /raise exception 'incomplete_order'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /revoke all on function public\.vibode_stage_reorder_partner_catalog\(text, jsonb\)/);
  assert.match(sql, /grant execute on function public\.vibode_stage_reorder_partner_catalog\(text, jsonb\)\s+to service_role/);
  assert.doesNotMatch(sql, /vibode_stage_variants/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.vibode_stage_reorder_partner_catalog\(text, jsonb\)\s+to (anon|authenticated|public)/);
  assert.match(source("app/api/vibode/partner/catalog/order/route.ts"), /partnerPortalCatalogOrderResponse/);
  assert.match(source("lib/vibode-stage/partner-catalog-order.server.ts"), /auth\.context\.partnerId/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-order.server.ts"), /body\.partnerId|p_partner_id: body/);
});
