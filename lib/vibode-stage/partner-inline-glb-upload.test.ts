import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnerInlineModelPanel } from "../../app/partner/catalog/products/PartnerInlineModelPanel";
import { PartnerProductEditor } from "../../app/partner/catalog/products/PartnerProductEditor";
import type { PartnerCommercialAssetOption } from "./partner-commercial-assets";
import {
  PARTNER_INLINE_GLB_EMPTY_DETAIL,
  PARTNER_INLINE_GLB_EMPTY_TITLE,
  PARTNER_INLINE_GLB_PREPARE_FAILED,
  PARTNER_INLINE_GLB_PROCESSING,
  PARTNER_INLINE_GLB_READY,
  PARTNER_INLINE_GLB_REPLACE,
  PARTNER_INLINE_GLB_UNSUPPORTED,
  PARTNER_INLINE_GLB_UPLOAD,
  PARTNER_INLINE_GLB_UPLOAD_FAILED,
  PARTNER_INLINE_GLB_VALIDATE_FAILED,
  PARTNER_MODEL_UPLOADED_RELOAD,
  createPartnerInlineUploadSession,
  partnerInlineGlbUploadingLabel,
  partnerUploadedModelAssociationFailure,
  runPartnerInlineGlbUpload,
  type PartnerInlineGlbJson,
  type PartnerInlineGlbResult,
  type PartnerInlineGlbTransport,
} from "./partner-inline-glb-upload";
import {
  PARTNER_PUBLISHED_MODEL_NOTE,
  buildPartnerVariantCreate,
  commitPendingVariantModel,
  presentPartnerVariantModel,
} from "./partner-product-editor";
import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import type { StageAsset, StageCategory, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const PARTNER_ID = "partner-demo-furniture-co";
const HIDDEN_ASSET_ID = "asset-hidden-zx9-should-not-render";
const NEW_ASSET_ID = "vibode-stage/partner-intake/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PREVIOUS_ASSET_ID = "asset-previous-untouched";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assignableAssetId(result: PartnerInlineGlbResult): string | null {
  return result.ok ? result.asset.assetId : null;
}

function response(
  status: number,
  body: PartnerInlineGlbJson,
): Readonly<{ status: number; body: PartnerInlineGlbJson }> {
  return { status, body };
}

function pipeline(overrides: Partial<PartnerInlineGlbTransport> = {}) {
  const calls: string[] = [];
  const intakeBodies: unknown[] = [];
  const transport: PartnerInlineGlbTransport = {
    async createIntake(body) {
      calls.push("createIntake");
      intakeBodies.push(body);
      return response(201, {
        ok: true,
        intakeId: "11111111-1111-1111-1111-111111111111",
        signedUrl: "https://signed.test/upload",
      });
    },
    async upload() {
      calls.push("upload");
      return { ok: true };
    },
    async finalize() {
      calls.push("finalize");
      return response(200, { ok: true, intake: { status: "validated", originalFileName: "chair.glb" } });
    },
    async register() {
      calls.push("register");
      return response(200, {
        ok: true,
        asset: { assetId: NEW_ASSET_ID, originalFileName: "chair.glb", status: "unavailable" },
      });
    },
    async activate() {
      calls.push("activate");
      return response(200, { ok: true, asset: { assetId: NEW_ASSET_ID, status: "ready" } });
    },
    ...overrides,
  };
  return { calls, intakeBodies, transport };
}

function product(): StageProduct {
  return {
    productId: "prod-coffee",
    name: "Coffee Table",
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
  };
}

function variant(): StageVariant {
  return {
    variantId: "var-coffee",
    productId: "prod-coffee",
    assetId: HIDDEN_ASSET_ID,
    finishLabel: "Walnut",
    sku: "DFC-CT-WAL",
    priceAmount: 459,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
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

function modelOption(assetId: string, originalFileName: string | null, label: string): PartnerCommercialAssetOption {
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
  return renderToStaticMarkup(createElement(PartnerProductEditor, {
    product: product(),
    variants: [variant()],
    collections: [],
    assets: [asset(HIDDEN_ASSET_ID, "ready")],
    commercialAssetOptions: [modelOption(HIDDEN_ASSET_ID, "coffee-table.glb", "Coffee Table · Walnut")],
    categories,
    draft: null,
    productNames: { "prod-coffee": "Coffee Table" },
    variantProductIds: { "var-coffee": "prod-coffee" },
    ...overrides,
  }));
}

test("A valid GLB upload calls intake, upload, finalize, register, then activate", async () => {
  const runSource = source("lib/vibode-stage/partner-inline-glb-upload.ts");
  const start = runSource.indexOf("export async function runPartnerInlineGlbUpload");
  const end = runSource.indexOf("async function readPartnerJson");
  const body = runSource.slice(start, end);
  const steps = [".createIntake(", ".upload(", ".finalize(", ".register(", ".activate("];
  let cursor = -1;
  for (const step of steps) {
    const at = body.indexOf(step);
    assert.ok(at > cursor, step);
    cursor = at;
  }
  assert.match(runSource, /PARTNER_INLINE_GLB_INTAKE_ROUTE/);
  assert.match(runSource, /partnerInlineGlbFinalizeRoute/);
  assert.match(runSource, /partnerInlineGlbRegisterRoute/);
  assert.match(runSource, /partnerInlineGlbActivateRoute/);
  assert.match(runSource, /putPartnerGlbToSignedUrl/);

  const harness = pipeline();
  const result = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 1200 },
    transport: harness.transport,
  });
  assert.deepEqual(harness.calls, ["createIntake", "upload", "finalize", "register", "activate"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.asset.status, "ready");
  assert.equal(result.asset.originalFileName, "chair.glb");
  assert.equal(result.asset.assetId, NEW_ASSET_ID);
});

test("B inline upload uses GLB dimensions and does not send authored metres", async () => {
  const harness = pipeline();
  await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 42 },
    transport: harness.transport,
  });
  assert.deepEqual(harness.intakeBodies, [{
    originalFileName: "chair.glb",
    byteSize: 42,
    dimensionSource: "glb",
  }]);
  assert.doesNotMatch(source("lib/vibode-stage/partner-inline-glb-upload.ts"), /dimensionSource: "product"/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-inline-glb-upload.ts"), /authoredWidthM/);
  assert.match(source("app/partner/assets/PartnerAssetWorkspaceClient.tsx"), /dimensionSource: "glb"/);
  assert.match(source("app/partner/assets/PartnerAssetWorkspaceClient.tsx"), /dimensionSource: "product"/);
});

test("C unsupported files are rejected before asset registration", async () => {
  for (const name of ["chair.gltf", "chair.png", "chair.glb.txt", "notes.txt"]) {
    const harness = pipeline();
    const result = await runPartnerInlineGlbUpload({
      file: { name, size: 20 },
      transport: harness.transport,
    });
    assert.deepEqual(harness.calls, [], name);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "unsupported");
    assert.equal(result.message, PARTNER_INLINE_GLB_UNSUPPORTED);
    assert.equal(assignableAssetId(result), null);
  }
});

test("D Ready is returned only after activation succeeds", async () => {
  const phases: string[] = [];
  const harness = pipeline({
    async activate() {
      harness.calls.push("activate");
      return response(409, { ok: false, errorCode: "TRANSPORT_PROOF_FAILED" });
    },
  });
  const failed = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 10 },
    transport: harness.transport,
    onPhase: (phase) => phases.push(phase),
  });
  assert.deepEqual(phases, ["uploading", "processing"]);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.stage, "activate");
  assert.equal(failed.message, PARTNER_INLINE_GLB_PREPARE_FAILED);
  assert.equal(assignableAssetId(failed), null);
  assert.notEqual(partnerInlineGlbUploadingLabel("chair.glb"), PARTNER_INLINE_GLB_READY);

  const unavailable = pipeline({
    async activate() {
      return response(200, { ok: true, asset: { assetId: NEW_ASSET_ID, status: "unavailable" } });
    },
  });
  const notReady = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 10 },
    transport: unavailable.transport,
  });
  assert.equal(notReady.ok, false);
  assert.equal(assignableAssetId(notReady), null);

  const ready = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 10 },
    transport: pipeline().transport,
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.equal(ready.asset.status, "ready");
  const presentation = presentPartnerVariantModel({
    assetId: ready.asset.assetId,
    assets: [],
    options: [],
    published: false,
    uploadedFileName: ready.asset.originalFileName,
  });
  assert.equal(presentation.stateLabel, "Ready");
  assert.equal(presentation.filename, "chair.glb");
  const html = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "ready", fileName: "chair.glb" },
    options: [],
    selectedAssetId: "",
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(html, new RegExp(PARTNER_INLINE_GLB_READY));
  assert.match(html, /chair\.glb/);
  assert.doesNotMatch(html, /Published/);
});

test("E a ready upload becomes currentAssetId on variant.create", async () => {
  const result = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 10 },
    transport: pipeline().transport,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const created = buildPartnerVariantCreate({
    productId: "prod-coffee",
    currency: "USD",
    finish: "Oak",
    shortName: "",
    sku: "OAK",
    price: "510",
    productUrl: "",
    assetId: result.asset.assetId,
    hasReadyModel: true,
  });
  assert.equal(created.state, "mutation");
  if (created.state !== "mutation" || created.mutation.type !== "variant.create") return;
  assert.equal(created.mutation.currentAssetId, result.asset.assetId);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /assetId: addModel\?\.assetId \?\? ""/);
  assert.match(editor, /buildPartnerVariantCreate/);
  assert.match(editor, /source: "upload"/);
});

test("F a pending variant replacement uses variant.create_edit", async () => {
  const result = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 10 },
    transport: pipeline().transport,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const edit = commitPendingVariantModel("var-pending", result.asset.assetId, PREVIOUS_ASSET_ID);
  assert.equal(edit.state, "mutation");
  if (edit.state !== "mutation") return;
  assert.equal(edit.mutation.type, "variant.create_edit");
  if (edit.mutation.type !== "variant.create_edit") return;
  assert.equal(edit.mutation.currentAssetId, result.asset.assetId);
  assert.equal(edit.mutation.variantId, "var-pending");
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /commitPendingVariantModel\(variantId, outcome\.assetId, pending\.currentAssetId\)/);
  assert.match(editor, /attachingUploadedModel: true/);
});

test("G replacing a pending model does not mutate or delete the previous asset", async () => {
  const harness = pipeline();
  const result = await runPartnerInlineGlbUpload({
    file: { name: "replacement.glb", size: 80 },
    transport: harness.transport,
  });
  assert.equal(JSON.stringify(harness.intakeBodies).includes(PREVIOUS_ASSET_ID), false);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.asset.assetId, PREVIOUS_ASSET_ID);
  const edit = commitPendingVariantModel("var-pending", result.asset.assetId, PREVIOUS_ASSET_ID);
  assert.equal(edit.state, "mutation");
  if (edit.state !== "mutation" || edit.mutation.type !== "variant.create_edit") return;
  assert.equal(Object.keys(edit.mutation).includes("currentAssetId"), true);
  assert.equal(JSON.stringify(edit.mutation).includes("delete"), false);
  const joined = [
    "lib/vibode-stage/partner-inline-glb-upload.ts",
    "lib/vibode-stage/partner-glb-signed-upload.ts",
    "app/partner/catalog/products/PartnerInlineModelPanel.tsx",
    "app/partner/catalog/products/usePartnerInlineGlbUploads.ts",
    "app/partner/catalog/products/PartnerProductEditor.tsx",
  ].map((file) => source(file)).join("\n");
  assert.doesNotMatch(joined, /method:\s*"DELETE"/);
  assert.doesNotMatch(joined, /variant\.set_current_asset/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-product-editor.ts"), /variant\.set_current_asset/);
});

test("H a published variant has no inline upload or replace control", () => {
  const html = renderEditor();
  assert.match(html, /coffee-table\.glb/);
  assert.match(html, />3D Model</);
  assert.doesNotMatch(html, />3D Models</);
  assert.doesNotMatch(html, new RegExp(PARTNER_PUBLISHED_MODEL_NOTE.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(html, new RegExp(PARTNER_INLINE_GLB_UPLOAD));
  assert.doesNotMatch(html, new RegExp(PARTNER_INLINE_GLB_REPLACE));
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /Replace Model/);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  const published = source("app/partner/catalog/products/PartnerModelSection.tsx");
  assert.match(editor, /published: true/);
  assert.doesNotMatch(editor, /variant\.set_current_asset/);
  assert.doesNotMatch(published, /Replace model|Upload GLB|runPartnerInlineGlbUpload/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-inline-glb-upload.ts"), /set_current_asset|current_asset_id/);
});

test("I a failed finalize leaves the variant unassociated", async () => {
  const harness = pipeline({
    async finalize() {
      harness.calls.push("finalize");
      return response(400, {
        ok: false,
        errorCode: "MALFORMED_GLB",
        intake: { status: "failed", errorCode: "MALFORMED_GLB" },
      });
    },
  });
  const result = await runPartnerInlineGlbUpload({
    file: { name: "broken.glb", size: 12 },
    transport: harness.transport,
  });
  assert.deepEqual(harness.calls, ["createIntake", "upload", "finalize"]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "finalize");
  assert.equal(result.message, PARTNER_INLINE_GLB_VALIDATE_FAILED);
  assert.equal(result.technical, "MALFORMED_GLB");
  assert.equal(assignableAssetId(result), null);
});

test("J a failed registration leaves the variant unchanged", async () => {
  const harness = pipeline({
    async register() {
      harness.calls.push("register");
      return response(409, { ok: false, errorCode: "REGISTRATION_CONFLICT" });
    },
  });
  const result = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 12 },
    transport: harness.transport,
  });
  assert.deepEqual(harness.calls, ["createIntake", "upload", "finalize", "register"]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "register");
  assert.equal(result.message, PARTNER_INLINE_GLB_PREPARE_FAILED);
  assert.equal(assignableAssetId(result), null);
});

test("K a failed activation does not show Ready or change the variant", async () => {
  const harness = pipeline({
    async activate() {
      harness.calls.push("activate");
      return response(500, { ok: false, errorCode: "SERVICE_UNAVAILABLE" });
    },
  });
  const result = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 12 },
    transport: harness.transport,
  });
  assert.deepEqual(harness.calls, ["createIntake", "upload", "finalize", "register", "activate"]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "activate");
  assert.equal(result.message, PARTNER_INLINE_GLB_PREPARE_FAILED);
  assert.equal(assignableAssetId(result), null);
  const html = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: {
      stateLabel: "Ready",
      filename: "previous.glb",
      detail: null,
      note: null,
    },
    upload: {
      phase: "attention",
      fileName: "chair.glb",
      message: result.message,
      technical: result.technical,
      reload: false,
    },
    options: [],
    selectedAssetId: "",
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(html, /previous\.glb/);
  assert.match(html, new RegExp(PARTNER_INLINE_GLB_PREPARE_FAILED));
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /chair\.glb/);
});

test("L a stale draft revision keeps the uploaded asset and asks for a reload", () => {
  const failure = partnerUploadedModelAssociationFailure({ uploadReady: true, httpStatus: 409 });
  assert.ok(failure);
  assert.equal(failure?.deleteAsset, false);
  assert.equal(failure?.assetRemainsRegistered, true);
  assert.equal(failure?.reload, true);
  assert.equal(failure?.message, PARTNER_MODEL_UPLOADED_RELOAD);
  assert.equal(partnerUploadedModelAssociationFailure({ uploadReady: false, httpStatus: 409 }), null);
  assert.equal(partnerUploadedModelAssociationFailure({ uploadReady: true, httpStatus: 400 }), null);
  const editor = source("app/partner/catalog/products/PartnerProductEditor.tsx");
  assert.match(editor, /partnerUploadedModelAssociationFailure/);
  assert.match(editor, /attachingUploadedModel/);
  assert.doesNotMatch(editor, /method:\s*"DELETE"/);
  const html = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: { stateLabel: "Ready", filename: "previous.glb", detail: null, note: null },
    upload: {
      phase: "attention",
      fileName: "chair.glb",
      message: PARTNER_MODEL_UPLOADED_RELOAD,
      technical: null,
      reload: true,
    },
    options: [],
    selectedAssetId: "",
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(html, new RegExp(PARTNER_MODEL_UPLOADED_RELOAD.replace(/[.]/g, "\\.")));
  assert.match(html, /Reload product/);
  assert.match(html, /previous\.glb/);
  assert.doesNotMatch(html, /delete/i);
});

test("M the primary model UI does not render raw asset ids", () => {
  const idle = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: { stateLabel: "No 3D model", filename: null, detail: null, note: null },
    upload: { phase: "idle" },
    options: [modelOption(HIDDEN_ASSET_ID, "walnut.glb", "Walnut table")].map((option) => ({
      assetId: option.assetId,
      label: "walnut.glb · Walnut table · Ready",
    })),
    selectedAssetId: "",
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(idle, new RegExp(PARTNER_INLINE_GLB_EMPTY_TITLE.replace(/[.]/g, "\\.")));
  assert.match(idle, new RegExp(PARTNER_INLINE_GLB_EMPTY_DETAIL));
  assert.match(idle, new RegExp(PARTNER_INLINE_GLB_UPLOAD));
  assert.match(idle, /Choose existing model/);
  assert.doesNotMatch(idle, new RegExp(HIDDEN_ASSET_ID));
  assert.doesNotMatch(idle, /Asset ID|Intake|Register Asset|Activate Runtime/);

  const ready = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "ready", fileName: "walnut.glb" },
    options: [],
    selectedAssetId: HIDDEN_ASSET_ID,
    disabled: false,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(ready, /walnut\.glb/);
  assert.doesNotMatch(ready, new RegExp(HIDDEN_ASSET_ID));

  const published = renderEditor();
  assert.doesNotMatch(published, new RegExp(HIDDEN_ASSET_ID));
  assert.match(published, /coffee-table\.glb/);
});

test("N an eligible existing ready model can still be selected", () => {
  const document = emptyDocument();
  const html = renderEditor({
    variants: [],
    draft: {
      draftId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      revision: 2,
      document: {
        ...document,
        variants: {
          ...document.variants,
          create: [{
            variantId: "var-pending",
            productId: "prod-coffee",
            finishLabel: "Oak",
            sku: "OAK",
            priceAmount: 510,
            priceCurrency: "USD",
            productUrl: null,
            currentAssetId: HIDDEN_ASSET_ID,
          }],
        },
      },
    },
  });
  assert.match(html, /Choose existing model/);
  assert.match(html, /coffee-table\.glb/);
  assert.match(html, new RegExp(PARTNER_INLINE_GLB_REPLACE));
  assert.match(html, /Oak/);
  assert.doesNotMatch(html, new RegExp(HIDDEN_ASSET_ID));
  assert.doesNotMatch(html, /Asset ID/);
  const chosen = commitPendingVariantModel("var-pending", HIDDEN_ASSET_ID, "asset-other");
  assert.equal(chosen.state, "mutation");
  if (chosen.state !== "mutation" || chosen.mutation.type !== "variant.create_edit") return;
  assert.equal(chosen.mutation.currentAssetId, HIDDEN_ASSET_ID);
  assert.match(source("app/partner/catalog/products/PartnerProductEditor.tsx"), /commitPendingVariantModel/);
});

test("upload lifecycle ignores a second start and a stale completion", async () => {
  const session = createPartnerInlineUploadSession();
  const first = session.tryStart();
  assert.equal(typeof first, "number");
  assert.equal(session.tryStart(), null);
  session.finish(first!);
  const second = session.tryStart();
  assert.equal(typeof second, "number");
  session.invalidate();
  assert.equal(session.isCurrent(second!), false);
  assert.equal(session.tryStart() != null, true);

  let open = true;
  const harness = pipeline();
  const result = await runPartnerInlineGlbUpload({
    file: { name: "chair.glb", size: 10 },
    transport: harness.transport,
    isCurrent: () => {
      const allowed = open;
      open = false;
      return allowed;
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "cancelled");
  assert.equal(assignableAssetId(result), null);
  assert.deepEqual(harness.calls, ["createIntake"]);
  assert.match(source("app/partner/catalog/products/usePartnerInlineGlbUploads.ts"), /beforeunload/);
  assert.match(source("app/partner/catalog/products/usePartnerInlineGlbUploads.ts"), /tryStart/);
  assert.match(source("app/partner/catalog/products/PartnerProductEditor.tsx"), /uploadLocks/);
  assert.match(source("app/partner/catalog/products/PartnerProductEditor.tsx"), /uploads\.invalidate\("create"\)/);
});

test("partner asset library keeps manual register and activate controls", () => {
  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  assert.match(client, /putPartnerGlbToSignedUrl/);
  assert.match(client, /Register Asset/);
  assert.match(client, /Activate Runtime/);
  assert.match(client, /Width \(m\)/);
  assert.match(client, /Use GLB dimensions/);
  assert.doesNotMatch(client, /productId|variantId|collectionId|planVersion/);
  assert.doesNotMatch(
    source("app/partner/catalog/products/PartnerProductEditor.tsx")
      + source("app/partner/catalog/products/PartnerInlineModelPanel.tsx"),
    /GLTFLoader|Preview 3D/,
  );
  assert.match(source("package.json"), /test:partner-ux4-inline-glb/);
});

test("upload and processing copy stays separate from publish language", () => {
  const html = renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "uploading", fileName: "chair.glb" },
    options: [],
    selectedAssetId: "",
    disabled: true,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  })) + renderToStaticMarkup(createElement(PartnerInlineModelPanel, {
    saved: null,
    upload: { phase: "processing", fileName: "chair.glb" },
    options: [],
    selectedAssetId: "",
    disabled: true,
    invalid: false,
    onFile: () => undefined,
    onChoose: () => undefined,
  }));
  assert.match(html, /Uploading chair\.glb…/);
  assert.match(html, new RegExp(PARTNER_INLINE_GLB_PROCESSING));
  assert.doesNotMatch(html, /Published|Saving…|Saved/);
  assert.equal(partnerInlineGlbUploadingLabel("chair.glb"), "Uploading chair.glb…");
  const intakeFailure = pipeline({
    async createIntake() {
      return response(400, { ok: false, errorCode: "FILE_TOO_LARGE" });
    },
  });
  return runPartnerInlineGlbUpload({
    file: { name: "huge.glb", size: 10 },
    transport: intakeFailure.transport,
  }).then((result) => {
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "intake");
    assert.match(result.message, /50 MiB/);
    assert.notEqual(result.message, PARTNER_INLINE_GLB_UPLOAD_FAILED);
  });
});
