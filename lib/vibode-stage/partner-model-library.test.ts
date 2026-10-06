import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerModelLibrary } from "../../app/partner/assets/PartnerModelLibrary";
import { PartnerAssetWorkspaceClient } from "../../app/partner/assets/PartnerAssetWorkspaceClient";
import PartnerAssetsPage from "../../app/partner/assets/page";
import { toPartnerAssetIntakeDto, type PartnerAssetIntakeRow } from "./partner-asset-intake";
import {
  PARTNER_MODEL_LIBRARY_ATTENTION,
  PARTNER_MODEL_LIBRARY_PREPARE,
  PARTNER_MODEL_LIBRARY_PREPARING,
  PARTNER_MODEL_LIBRARY_PROCESSING,
  PARTNER_MODEL_LIBRARY_READY,
  PARTNER_MODEL_LIBRARY_UNUSED,
  PARTNER_MODEL_LIBRARY_VALIDATE,
  buildPartnerModelLibrary,
  filterPartnerModelLibrary,
  type PartnerModelLibraryAssetInput,
  type PartnerModelLibraryIntakeInput,
  type PartnerModelLibraryItem,
  type PartnerModelLibraryStatusFilter,
} from "./partner-model-library";

const ROOT = process.cwd();
const ASSET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INTAKE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PRODUCT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const VARIANT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const OTHER_ASSET_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OTHER_PRODUCT_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutHrefs(html: string): string {
  return html.replace(/\shref="[^"]*"/g, "");
}

function asset(
  overrides: Partial<PartnerModelLibraryAssetInput> & Pick<PartnerModelLibraryAssetInput, "assetId">,
): PartnerModelLibraryAssetInput {
  return {
    status: "ready",
    originalFileName: "chair.glb",
    measuredWidthM: 1.2,
    measuredHeightM: 0.8,
    measuredDepthM: 0.9,
    sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    registeredAt: "2026-09-15T12:00:00.000Z",
    origin: "partner_intake",
    ...overrides,
  };
}

function intake(
  overrides: Partial<PartnerModelLibraryIntakeInput> & Pick<PartnerModelLibraryIntakeInput, "intakeId">,
): PartnerModelLibraryIntakeInput {
  return {
    status: "validated",
    originalFileName: "chair.glb",
    byteSize: 2_621_440,
    createdAt: "2026-09-15T12:00:00.000Z",
    sha256: null,
    errorCode: null,
    error: null,
    assetId: null,
    ...overrides,
  };
}

function catalog(variants: readonly Record<string, unknown>[] = []): unknown {
  return {
    ok: true,
    products: [
      { productId: PRODUCT_ID, name: "Coffee Table" },
      { productId: "prod-side", name: "Side Table" },
    ],
    variants,
  };
}

function library(input: Readonly<{
  assets?: readonly PartnerModelLibraryAssetInput[];
  intakes?: readonly PartnerModelLibraryIntakeInput[];
  catalog?: unknown;
}>) {
  return buildPartnerModelLibrary({
    assets: input.assets ?? [],
    intakes: input.intakes ?? [],
    catalog: input.catalog ?? catalog(),
  });
}

function renderLibrary(
  items: readonly PartnerModelLibraryItem[],
  options: Readonly<{
    query?: string;
    status?: PartnerModelLibraryStatusFilter;
    technicalOpen?: boolean;
    associationsKnown?: boolean;
    loaded?: boolean;
  }> = {},
): string {
  return renderToStaticMarkup(createElement(PartnerModelLibrary, {
    items,
    loaded: options.loaded ?? true,
    loadError: null,
    associationsKnown: options.associationsKnown ?? true,
    query: options.query ?? "",
    status: options.status ?? "all",
    onQueryChange: () => undefined,
    onStatusChange: () => undefined,
    onClearFilters: () => undefined,
    technicalOpen: options.technicalOpen,
  }));
}

test("A partner-scoped library renders only the supplied partner models", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID, originalFileName: "chair.glb" })],
    catalog: {
      ok: true,
      products: [
        { productId: PRODUCT_ID, name: "Coffee Table" },
        { productId: OTHER_PRODUCT_ID, name: "Foreign Chair" },
      ],
      variants: [
        {
          variantId: VARIANT_ID,
          productId: OTHER_PRODUCT_ID,
          assetId: OTHER_ASSET_ID,
          finishLabel: "Foreign finish",
          sku: "FOREIGN-SKU",
        },
        {
          variantId: "variant-known",
          productId: "missing-product",
          assetId: ASSET_ID,
          finishLabel: "Hidden finish",
          sku: "HIDDEN-SKU",
        },
      ],
    },
  });
  assert.equal(built.associationsKnown, true);
  assert.equal(built.items.length, 1);
  assert.equal(built.items[0]?.fileName, "chair.glb");
  assert.equal(built.items[0]?.uses.length, 0);
  assert.equal(JSON.stringify(built.items).includes("Foreign Chair"), false);
  assert.equal(JSON.stringify(built.items).includes(OTHER_ASSET_ID), false);
  assert.equal(JSON.stringify(built.items).includes(OTHER_PRODUCT_ID), false);
  assert.equal(JSON.stringify(built.items).includes("HIDDEN-SKU"), false);
  assert.equal(JSON.stringify(built.items).includes(VARIANT_ID), false);

  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  assert.match(client, /fetch\("\/api\/vibode\/partner\/assets\/intakes", \{ cache: "no-store" \}\)/);
  assert.match(client, /fetch\("\/api\/vibode\/partner\/assets", \{ cache: "no-store" \}\)/);
  assert.match(client, /fetch\("\/api\/vibode\/partner\/catalog", \{ cache: "no-store" \}\)/);
  assert.match(source("lib/vibode-stage/partner-asset-register.ts"), /listPartnerAssets\(input\.auth\.context\.partnerId\)/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.ts"), /listByPartner\(input\.auth\.context\.partnerId\)/);
  assert.match(source("lib/vibode-stage/partner-portal-catalog.ts"), /product\.partnerId === partnerId/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-model-library.ts"), /server-only|getServiceRoleSupabaseClient|createSignedUrl/);
});

test("B ready model displays filename and Ready", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID, originalFileName: "chair.glb" })],
    intakes: [intake({ intakeId: INTAKE_ID, assetId: ASSET_ID, byteSize: 2_621_440 })],
  });
  const item = built.items[0];
  assert.ok(item);
  assert.equal(item.fileName, "chair.glb");
  assert.equal(item.state, "ready");
  assert.equal(item.stateLabel, PARTNER_MODEL_LIBRARY_READY);
  assert.equal(item.uploadedLabel, "15 Sep 2026");
  assert.equal(item.fileSizeLabel, "2.5 MB");
  assert.equal(item.dimensionsLabel, "1.200 × 0.800 × 0.900 m");
  const html = renderLibrary(built.items);
  assert.match(html, /chair\.glb/);
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_READY));
  assert.match(html, /Uploaded 15 Sep 2026/);
  assert.match(html, /2\.5 MB/);
});

test("C referenced model shows product and variant context", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID, originalFileName: "table.glb" })],
    catalog: catalog([
      {
        variantId: VARIANT_ID,
        productId: PRODUCT_ID,
        assetId: ASSET_ID,
        finishLabel: "Walnut",
        sku: "DFC-COFFEE-01",
      },
      {
        variantId: "side-variant",
        productId: "prod-side",
        assetId: ASSET_ID,
        finishLabel: "Oak",
        sku: "DFC-SIDE-01",
      },
    ]),
  });
  const item = built.items[0];
  assert.ok(item);
  assert.equal(item.unused, false);
  assert.deepEqual(item.uses.map((use) => use.productName), ["Coffee Table", "Side Table"]);
  assert.equal(item.uses[0]?.variantLabel, "Walnut · SKU DFC-COFFEE-01");
  const html = renderLibrary(built.items);
  assert.match(html, /Coffee Table/);
  assert.match(html, /Walnut · SKU DFC-COFFEE-01/);
  assert.match(html, /Side Table/);
  assert.match(html, /Oak · SKU DFC-SIDE-01/);
  assert.match(html, new RegExp(`href="/partner/catalog/products/${PRODUCT_ID}"`));
  assert.match(html, /href="\/partner\/catalog\/products\/prod-side"/);
});

test("D unused ready model shows Unused and stays Ready", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID, originalFileName: "spare.glb" })],
    catalog: catalog([]),
  });
  const item = built.items[0];
  assert.ok(item);
  assert.equal(item.state, "ready");
  assert.equal(item.unused, true);
  const html = renderLibrary(built.items);
  assert.match(html, /spare\.glb/);
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_READY));
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_UNUSED));
  assert.doesNotMatch(html, /Try again|Could not validate|could not be prepared/i);
});

test("E incomplete preparation maps to Processing", () => {
  const uploaded = library({
    intakes: [intake({
      intakeId: INTAKE_ID,
      status: "uploaded",
      originalFileName: "sofa.glb",
      assetId: null,
    })],
  });
  assert.equal(uploaded.items[0]?.state, "processing");
  assert.equal(uploaded.items[0]?.stateLabel, PARTNER_MODEL_LIBRARY_PROCESSING);
  assert.equal(uploaded.items[0]?.processingMessage, PARTNER_MODEL_LIBRARY_PREPARING);
  assert.equal(uploaded.items[0]?.unused, false);

  const validated = library({
    intakes: [intake({ intakeId: "validated-intake", status: "validated", assetId: null })],
  });
  assert.equal(validated.items[0]?.state, "processing");

  const pending = library({
    assets: [asset({ assetId: ASSET_ID, status: "unavailable", originalFileName: "pending.glb" })],
  });
  assert.equal(pending.items[0]?.state, "processing");
  assert.equal(pending.items[0]?.unused, false);
  const html = renderLibrary(uploaded.items);
  assert.match(html, /sofa\.glb/);
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_PROCESSING));
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_PREPARING));
});

test("F failed preparation maps to Needs attention in plain language", () => {
  const built = library({
    intakes: [intake({
      intakeId: INTAKE_ID,
      status: "failed",
      originalFileName: "broken.glb",
      errorCode: "DIMENSION_MISMATCH",
      error: "The GLB dimensions do not match the actual product dimensions you entered.",
      assetId: null,
    })],
  });
  const item = built.items[0];
  assert.ok(item);
  assert.equal(item.state, "needs_attention");
  assert.equal(item.stateLabel, PARTNER_MODEL_LIBRARY_ATTENTION);
  assert.equal(item.attentionMessage, PARTNER_MODEL_LIBRARY_VALIDATE);
  const html = renderLibrary(built.items);
  assert.match(html, /broken\.glb/);
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_ATTENTION));
  assert.match(html, new RegExp(PARTNER_MODEL_LIBRARY_VALIDATE));
  assert.match(html, /href="\/partner\/catalog"/);
  assert.match(html, />Try again</);
  assert.doesNotMatch(html, /DIMENSION_MISMATCH|finalized|registered|unavailable|activation/i);

  const prepared = library({
    intakes: [intake({
      intakeId: "too-big",
      status: "failed",
      originalFileName: "huge.glb",
      errorCode: "FILE_TOO_LARGE",
      assetId: null,
    })],
  });
  assert.equal(prepared.items[0]?.attentionMessage, PARTNER_MODEL_LIBRARY_PREPARE);
});

test("G search matches filename, product, finish, and SKU", () => {
  const built = library({
    assets: [
      asset({ assetId: ASSET_ID, originalFileName: "coffee.glb" }),
      asset({ assetId: OTHER_ASSET_ID, originalFileName: "lamp.glb", registeredAt: "2026-09-01T00:00:00.000Z" }),
    ],
    catalog: catalog([
      {
        productId: PRODUCT_ID,
        assetId: ASSET_ID,
        finishLabel: "Walnut",
        sku: "DFC-COFFEE-01",
      },
    ]),
  });
  assert.equal(filterPartnerModelLibrary(built.items, { query: "coffee.glb", status: "all" }).length, 1);
  assert.equal(filterPartnerModelLibrary(built.items, { query: "Coffee Table", status: "all" })[0]?.fileName, "coffee.glb");
  assert.equal(filterPartnerModelLibrary(built.items, { query: "walnut", status: "all" })[0]?.fileName, "coffee.glb");
  assert.equal(filterPartnerModelLibrary(built.items, { query: "dfc-coffee-01", status: "all" })[0]?.fileName, "coffee.glb");
  assert.equal(filterPartnerModelLibrary(built.items, { query: "lamp", status: "all" })[0]?.fileName, "lamp.glb");
  assert.equal(filterPartnerModelLibrary(built.items, { query: "missing-name", status: "all" }).length, 0);
  const html = renderLibrary(built.items, { query: "Walnut" });
  assert.match(html, /coffee\.glb/);
  assert.doesNotMatch(html, /lamp\.glb/);
});

test("H status filters keep Ready, Processing, Needs attention, and Unused distinct", () => {
  const built = library({
    assets: [
      asset({ assetId: ASSET_ID, originalFileName: "used.glb" }),
      asset({ assetId: OTHER_ASSET_ID, originalFileName: "spare.glb" }),
      asset({
        assetId: "pending-asset",
        status: "unavailable",
        originalFileName: "pending.glb",
      }),
    ],
    intakes: [intake({
      intakeId: INTAKE_ID,
      status: "failed",
      originalFileName: "broken.glb",
      errorCode: "MALFORMED_GLB",
      assetId: null,
      createdAt: "2026-09-20T00:00:00.000Z",
    })],
    catalog: catalog([{ productId: PRODUCT_ID, assetId: ASSET_ID, finishLabel: "Walnut", sku: "DFC-1" }]),
  });
  const names = (status: PartnerModelLibraryStatusFilter) => (
    filterPartnerModelLibrary(built.items, { query: "", status }).map((item) => item.fileName)
  );
  assert.deepEqual(names("ready").sort(), ["spare.glb", "used.glb"]);
  assert.deepEqual(names("unused"), ["spare.glb"]);
  assert.deepEqual(names("processing"), ["pending.glb"]);
  assert.deepEqual(names("needs_attention"), ["broken.glb"]);
  const html = renderLibrary(built.items, { status: "needs_attention" });
  assert.match(html, /broken\.glb/);
  assert.doesNotMatch(html, /spare\.glb|used\.glb|pending\.glb/);
  const clear = renderLibrary(
    built.items.filter((item) => item.state === "ready"),
    { status: "needs_attention" },
  );
  assert.match(clear, /No models need attention/);
  assert.match(clear, />Clear filters</);
  const filtered = renderLibrary(built.items, { query: "no-such-model", status: "ready" });
  assert.match(filtered, /No models match these filters/);
});

test("I primary model list does not show raw asset, intake, product, or variant ids", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID, originalFileName: "table.glb" })],
    intakes: [intake({ intakeId: INTAKE_ID, assetId: ASSET_ID })],
    catalog: catalog([{
      variantId: VARIANT_ID,
      productId: PRODUCT_ID,
      assetId: ASSET_ID,
      finishLabel: "Walnut",
      sku: "DFC-1",
    }]),
  });
  const html = withoutHrefs(renderLibrary(built.items));
  assert.match(html, /table\.glb/);
  assert.match(html, /Coffee Table/);
  for (const id of [ASSET_ID, INTAKE_ID, PRODUCT_ID, VARIANT_ID]) {
    assert.equal(html.includes(id), false, id);
  }
  assert.doesNotMatch(html, /SHA |Asset status|Intake status|Asset ID|Intake ID/);
});

test("J technical ids stay inside the closed technical disclosure", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID })],
    intakes: [intake({
      intakeId: INTAKE_ID,
      assetId: ASSET_ID,
      errorCode: "DIMENSION_MISMATCH",
    })],
  });
  const closed = renderLibrary(built.items);
  assert.match(closed, />Technical details</);
  assert.equal(closed.includes(ASSET_ID), false);
  assert.equal(closed.includes(INTAKE_ID), false);
  assert.doesNotMatch(closed, /DIMENSION_MISMATCH/);
  const open = renderLibrary(built.items, { technicalOpen: true });
  assert.match(open, new RegExp(`Asset ID ${ASSET_ID}`));
  assert.match(open, new RegExp(`Intake ID ${INTAKE_ID}`));
  assert.match(open, /SHA abcdef012345/);
  assert.match(open, /Asset status: ready/);
  assert.match(open, /Intake status: validated/);
});

test("K register and activate are not primary page actions", () => {
  const page = renderToStaticMarkup(createElement(PartnerAssetsPage));
  const client = renderToStaticMarkup(createElement(PartnerAssetWorkspaceClient));
  assert.match(page, /<h1[^>]*>3D Models<\/h1>/);
  assert.match(page, /View and manage the 3D models used across your Vibode catalog/);
  assert.match(page, /Upload new models while editing a Product or Variant/);
  assert.doesNotMatch(page, /Register Asset|Activate Runtime|Width \(m\)|Intake history/);
  assert.match(client, /Advanced \/ Technical tools/);
  assert.doesNotMatch(client, /Register Asset|Activate Runtime|Width \(m\)|Use GLB dimensions/);
  const sourceText = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  const gate = sourceText.indexOf("advancedOpen ?");
  assert.ok(gate > 0);
  assert.ok(sourceText.indexOf("Register Asset") > gate);
  assert.ok(sourceText.indexOf("Activate Runtime") > gate);
  assert.ok(sourceText.indexOf("Width (m)") > gate);
});

test("L asset routes and helpers are unchanged", () => {
  assert.match(source("app/api/vibode/partner/assets/route.ts"), /partnerRegisteredAssetListResponse/);
  assert.match(source("app/api/vibode/partner/assets/intakes/route.ts"), /partnerAssetIntakeListResponse/);
  assert.match(source("app/api/vibode/partner/assets/intakes/route.ts"), /partnerAssetIntakeCreateResponse/);
  assert.match(source("app/api/vibode/partner/assets/intakes/[intakeId]/finalize/route.ts"), /partnerAssetIntakeFinalizeResponse/);
  assert.match(source("app/api/vibode/partner/assets/intakes/[intakeId]/register/route.ts"), /partnerAssetRegisterResponse/);
  assert.match(source("app/api/vibode/partner/assets/[...assetPath]/route.ts"), /partnerAssetActivateResponse/);
  assert.match(source("lib/vibode-stage/partner-asset-register.ts"), /export async function registerPartnerAsset/);
  assert.match(source("lib/vibode-stage/partner-asset-register.ts"), /export async function listPartnerRegisteredAssets/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-model-library.ts"), /registerPartnerAsset|activatePartner|putPartnerGlbToSignedUrl/);
  assert.doesNotMatch(source("app/partner/assets/PartnerAssetWorkspaceClient.tsx"), /runPartnerInlineGlbUpload/);
  assert.doesNotMatch(
    source("app/partner/assets/PartnerModelLibrary.tsx") + source("app/partner/assets/page.tsx"),
    /Preview 3D|createSignedUrl/,
  );

  const row: PartnerAssetIntakeRow = {
    intakeId: INTAKE_ID,
    partnerId: "partner-demo",
    createdByUserId: null,
    status: "validated",
    objectPath: "partner-demo/intake/model.glb",
    originalFileName: "chair.glb",
    byteSize: 4096,
    sha256: null,
    dimensionSource: "glb",
    authoredWidthM: null,
    authoredHeightM: null,
    authoredDepthM: null,
    measuredWidthM: 1,
    measuredHeightM: 1,
    measuredDepthM: 1,
    placementScale: 1,
    validationWarnings: [],
    errorCode: null,
    errorDetail: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
  assert.equal(toPartnerAssetIntakeDto(row).byteSize, 4096);
});

test("M view product resolves to the product editor", () => {
  const built = library({
    assets: [asset({ assetId: ASSET_ID })],
    catalog: catalog([{
      productId: PRODUCT_ID,
      assetId: ASSET_ID,
      finishLabel: "Walnut",
      sku: null,
    }]),
  });
  assert.equal(
    built.items[0]?.uses[0]?.viewProductHref,
    `/partner/catalog/products/${PRODUCT_ID}`,
  );
  const html = renderLibrary(built.items);
  assert.match(html, new RegExp(`href="/partner/catalog/products/${PRODUCT_ID}"`));
  assert.match(html, />View product</);
});

test("library sorts newest uploads first and does not duplicate a registered intake", () => {
  const built = library({
    assets: [
      asset({
        assetId: ASSET_ID,
        originalFileName: "older.glb",
        registeredAt: "2026-09-01T00:00:00.000Z",
      }),
    ],
    intakes: [
      intake({
        intakeId: INTAKE_ID,
        assetId: ASSET_ID,
        originalFileName: "older.glb",
        createdAt: "2026-09-01T00:00:00.000Z",
      }),
      intake({
        intakeId: "newer-intake",
        status: "uploaded",
        originalFileName: "newer.glb",
        createdAt: "2026-09-27T00:00:00.000Z",
        assetId: null,
      }),
    ],
  });
  assert.deepEqual(built.items.map((item) => item.fileName), ["newer.glb", "older.glb"]);
  assert.equal(built.items.filter((item) => item.fileName === "older.glb").length, 1);
});

test("empty library points partners back to the catalog", () => {
  const html = renderLibrary([]);
  assert.match(html, /No 3D models yet/);
  assert.match(html, /Upload a GLB while adding or editing a Product Variant/);
  assert.match(html, /href="\/partner\/catalog"/);
  assert.match(html, />Open Catalog</);
  assert.doesNotMatch(html, /Register Asset|Activate Runtime/);
});
