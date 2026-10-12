import assert from "node:assert/strict";
import test from "node:test";

import { stageCatalogRowsFromSnapshot } from "./catalog-store";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import { toRuntimeApplyPayloadV8 } from "./partner-catalog-runtime-executor-v8";
import {
  partnerRuntimePlanVersionForPublish,
  toRuntimeApplyPayloadV9,
} from "./partner-catalog-runtime-executor-v9";
import { foldedPartnerStateFromDurableCatalog } from "./partner-catalog-live-state";
import {
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
  planPartnerCatalogSync,
} from "./partner-catalog-sync";
import {
  applyPartnerDraftMutation,
  emptyPartnerPatchDocument,
} from "./partner-draft-mutations";
import { partnerCatalogFromDurableSnapshot } from "./partner-portal-catalog";
import { partnerCatalogCommercialFingerprint } from "./partner-portal-drafts";
import { parseMaterialText } from "./material-text";
import type { StageCatalogSnapshot, StageVariant } from "./types";

const ROOT = process.cwd();

function certifiedCatalog(): StageCatalogSnapshot {
  const folded = foldPartnerCatalogCurrentState({ repoRoot: ROOT });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("certified fold failed");
  const mixed = overlayFoldedPartnerCatalog(folded.state);
  const loaded = partnerCatalogFromDurableSnapshot({
    catalog: mixed,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("scoped catalog failed");
  return loaded.catalog;
}

function planDocument(document: unknown, catalog: StageCatalogSnapshot) {
  const folded = foldedPartnerStateFromDurableCatalog(catalog, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(folded);
  const parsed = parsePartnerCatalogSyncJson(
    typeof document === "object" && document
      ? { ...document as object, partnerId: DEMO_FURNITURE_PARTNER_ID }
      : document,
    );
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok || !folded) throw new Error("plan setup failed");
  return planPartnerCatalogSync({
    current: folded,
    document: parsed.document,
    catalog,
    seedAssets: catalog.assets,
    repoRoot: ROOT,
  });
}

test("existing products and variants keep working without material descriptions", () => {
  const catalog = certifiedCatalog();
  const product = catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  const variant = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(product);
  assert.ok(variant);
  assert.equal(product?.primaryMaterial, undefined);
  assert.equal(product?.secondaryMaterial, undefined);
  assert.equal(variant?.primaryMaterial, undefined);
  assert.equal(variant?.secondaryMaterial, undefined);
  const rows = stageCatalogRowsFromSnapshot(catalog);
  const productRow = rows.products.find((item) => item.product_id === DEMO_SOFA_PRODUCT_ID);
  const variantRow = rows.variants.find((item) => item.variant_id === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(productRow?.primary_material, undefined);
  assert.equal(variantRow?.primary_material, undefined);
  assert.equal(partnerCatalogCommercialFingerprint(catalog), partnerCatalogCommercialFingerprint(catalog));
  const plan = planDocument(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.noOp, true);
  assert.equal(partnerRuntimePlanVersionForPublish(plan), 1);
});

test("product defaults persist and a variant can override or clear them", () => {
  const catalog = certifiedCatalog();
  const before = JSON.stringify(catalog);
  const beforeHash = partnerCatalogCommercialFingerprint(catalog);
  const current = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(current?.assetId);
  if (!current?.assetId) return;

  let staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "product.set_primary_material",
    productId: DEMO_SOFA_PRODUCT_ID,
    primaryMaterial: "  Chenille Helios  ",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  staged = applyPartnerDraftMutation(staged.document, catalog, {
    type: "product.set_secondary_material",
    productId: DEMO_SOFA_PRODUCT_ID,
    secondaryMaterial: "black metal legs",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  staged = applyPartnerDraftMutation(staged.document, catalog, {
    type: "variant.set_primary_material",
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    primaryMaterial: "blue velvet upholstery",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.equal(JSON.stringify(catalog), before);
  assert.equal(partnerCatalogCommercialFingerprint(catalog), beforeHash);

  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.noOp, false);
  assert.equal(partnerRuntimePlanVersionForPublish(plan), 9);
  assert.equal(plan.productUpdates.length, 0);
  assert.equal(plan.variantUpdates.length, 0);
  assert.deepEqual(plan.materialFieldUpdates, [
    {
      entity: "product",
      productId: DEMO_SOFA_PRODUCT_ID,
      variantId: null,
      column: "primary_material",
      previous: null,
      next: "Chenille Helios",
    },
    {
      entity: "product",
      productId: DEMO_SOFA_PRODUCT_ID,
      variantId: null,
      column: "secondary_material",
      previous: null,
      next: "black metal legs",
    },
    {
      entity: "variant",
      productId: DEMO_SOFA_PRODUCT_ID,
      variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
      column: "primary_material",
      previous: null,
      next: "blue velvet upholstery",
    },
  ]);
  const product = plan.nextState?.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  const variant = plan.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(product?.primaryMaterial, "Chenille Helios");
  assert.equal(product?.secondaryMaterial, "black metal legs");
  assert.equal(variant?.primaryMaterial, "blue velvet upholstery");
  assert.equal(variant?.secondaryMaterial, undefined);

  const v8 = toRuntimeApplyPayloadV8(plan);
  assert.equal(v8.ok, true, JSON.stringify(v8));
  if (v8.ok) {
    assert.equal(v8.payload.planVersion, 8);
    assert.equal("materialUpdates" in v8.payload, false);
  }
  const v9 = toRuntimeApplyPayloadV9(plan);
  assert.equal(v9.ok, true, JSON.stringify(v9));
  if (!v9.ok) return;
  assert.equal(v9.payload.planVersion, 9);
  assert.equal(v9.payload.materialUpdates.length, 3);
  assert.equal(v9.payload.materialUpdates[2]?.next, "blue velvet upholstery");

  const cleared = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), withMaterials(catalog, current, {
    primaryMaterial: "blue velvet upholstery",
  }), {
    type: "variant.set_primary_material",
    variantId: current.variantId,
    primaryMaterial: "",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(cleared.ok, true, JSON.stringify(cleared));
  if (!cleared.ok) return;
  const clearPlan = planDocument(cleared.document, withMaterials(catalog, current, {
    primaryMaterial: "blue velvet upholstery",
  }));
  assert.equal(clearPlan.ok, true, JSON.stringify(clearPlan.issues));
  assert.deepEqual(clearPlan.materialFieldUpdates, [{
    entity: "variant",
    productId: DEMO_SOFA_PRODUCT_ID,
    variantId: current.variantId,
    column: "primary_material",
    previous: "blue velvet upholstery",
    next: "",
  }]);
  const clearedVariant = clearPlan.nextState?.variants.find((item) => item.variantId === current.variantId);
  assert.equal(clearedVariant?.primaryMaterial, "");
});

test("a new variant keeps an intentional clear and a product blank stays unset", () => {
  const catalog = certifiedCatalog();
  const current = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(current?.assetId);
  if (!current?.assetId) return;
  const staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "variant.create",
    productId: DEMO_SOFA_PRODUCT_ID,
    finishLabel: "Helios",
    sku: "MAT-HELIOS-2M",
    priceAmount: current.priceAmount ?? 1,
    productUrl: current.productUrl ?? null,
    currentAssetId: current.assetId,
    primaryMaterial: "",
    secondaryMaterial: "black metal legs",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  const created = plan.variantCreates.find((item) => item.variant.finishLabel === "Helios");
  assert.equal(created?.variant.primaryMaterial, "");
  assert.equal(created?.variant.secondaryMaterial, "black metal legs");
  const serialized = toRuntimeApplyPayloadV9(plan);
  assert.equal(serialized.ok, true, JSON.stringify(serialized));
  if (!serialized.ok || !created) return;
  const payloadCreate = serialized.payload.variantCreates.find((item) => item.variantId === created.variant.variantId);
  assert.equal(payloadCreate?.primaryMaterial, "");
  assert.equal(payloadCreate?.secondaryMaterial, "black metal legs");
  assert.equal(serialized.payload.planVersion, 9);

  const blank = parseMaterialText("   ", "product");
  const clear = parseMaterialText("   ", "variant");
  assert.deepEqual(blank, { ok: true, value: null });
  assert.deepEqual(clear, { ok: true, value: "" });
  const unsafe = parseMaterialText("velvet https://example.test", "product");
  assert.equal(unsafe.ok, false);
});

function withMaterials(
  catalog: StageCatalogSnapshot,
  variant: StageVariant,
  materials: Pick<StageVariant, "primaryMaterial" | "secondaryMaterial">,
): StageCatalogSnapshot {
  return {
    ...catalog,
    variants: catalog.variants.map((item) => (
      item.variantId === variant.variantId ? { ...item, ...materials } : item
    )),
  };
}
