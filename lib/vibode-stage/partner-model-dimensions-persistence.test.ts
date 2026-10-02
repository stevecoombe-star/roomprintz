import assert from "node:assert/strict";
import test from "node:test";

import { createStageCatalogSnapshot } from "./catalog";
import { retargetVariantCurrentAsset, stageCatalogRowsFromSnapshot } from "./catalog-store";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import { toRuntimeApplyPayloadV7 } from "./partner-catalog-runtime-executor-v7";
import {
  partnerRuntimePlanVersionForPublish,
  toRuntimeApplyPayloadV8,
} from "./partner-catalog-runtime-executor-v8";
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
import type { StageCatalogSnapshot, StageVariant } from "./types";

const ROOT = process.cwd();
const DIMENSIONS = {
  modelWidthM: 0.84,
  modelHeightM: 0.73,
  modelDepthM: 0.94,
  modelSizingMode: "exact" as const,
};

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

test("existing variants without explicit sizing stay on the asset measurement", () => {
  const catalog = certifiedCatalog();
  const variant = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  const asset = catalog.assets.find((item) => item.assetId === variant?.assetId);
  assert.ok(variant);
  assert.ok(asset);
  assert.equal(variant?.modelWidthM, undefined);
  const rows = stageCatalogRowsFromSnapshot(catalog);
  const row = rows.variants.find((item) => item.variant_id === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(row?.model_width_m, undefined);
  assert.equal(partnerCatalogCommercialFingerprint(catalog), partnerCatalogCommercialFingerprint(catalog));
});

test("an existing variant can draft corrected dimensions without touching the live catalog", () => {
  const catalog = certifiedCatalog();
  const before = JSON.stringify(catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID));
  const beforeHash = partnerCatalogCommercialFingerprint(catalog);
  const staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "variant.set_model_dimensions",
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    ...DIMENSIONS,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.equal(
    JSON.stringify(catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID)),
    before,
  );
  assert.equal(partnerCatalogCommercialFingerprint(catalog), beforeHash);

  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.noOp, false);
  assert.equal(partnerRuntimePlanVersionForPublish(plan), 8);
  assert.deepEqual(plan.variantModelDimensionUpdates, [{
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    previous: null,
    next: {
      widthM: 0.84,
      heightM: 0.73,
      depthM: 0.94,
      sizingMode: "exact",
    },
  }]);
  const next = plan.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(next?.modelWidthM, 0.84);
  assert.equal(next?.modelSizingMode, "exact");
  const v7 = toRuntimeApplyPayloadV7(plan);
  assert.equal(v7.ok, false);
  const v8 = toRuntimeApplyPayloadV8(plan);
  assert.equal(v8.ok, true, JSON.stringify(v8));
  if (!v8.ok) return;
  assert.equal(v8.payload.planVersion, 8);
  assert.equal(v8.payload.variantModelDimensions.length, 1);
  assert.equal(v8.payload.variantModelDimensions[0]?.widthM, 0.84);
  assert.equal(v8.payload.variantModelDimensions[0]?.previousWidthM, null);
});

test("a new variant persists corrected dimensions and replacement keeps them", () => {
  const catalog = certifiedCatalog();
  const current = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(current?.assetId);
  if (!current?.assetId) return;
  const staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "variant.create",
    productId: DEMO_SOFA_PRODUCT_ID,
    finishLabel: "Dimension Oak",
    sku: "DIM-OAK-UX13",
    priceAmount: current.priceAmount ?? 1,
    productUrl: current.productUrl ?? null,
    currentAssetId: current.assetId,
    ...DIMENSIONS,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  const created = plan.variantCreates.find((item) => item.variant.finishLabel === "Dimension Oak");
  assert.equal(created?.variant.modelWidthM, 0.84);
  assert.equal(created?.variant.modelDepthM, 0.94);
  const serialized = toRuntimeApplyPayloadV8(plan);
  assert.equal(serialized.ok, true, JSON.stringify(serialized));
  if (!serialized.ok || !created) return;
  const payloadCreate = serialized.payload.variantCreates.find((item) => item.variantId === created.variant.variantId);
  assert.equal(payloadCreate?.modelWidthM, 0.84);
  assert.equal(payloadCreate?.modelSizingMode, "exact");

  const published = withDimensions(catalog, current, DIMENSIONS);
  const replaced = retargetVariantCurrentAsset(published, current.variantId, "asset-replacement-ux13");
  assert.ok(replaced);
  const kept = replaced?.variants.find((item) => item.variantId === current.variantId);
  assert.equal(kept?.assetId, "asset-replacement-ux13");
  assert.equal(kept?.modelWidthM, 0.84);
  assert.equal(kept?.modelHeightM, 0.73);
  assert.equal(kept?.modelDepthM, 0.94);
  assert.equal(kept?.modelSizingMode, "exact");
});

function withDimensions(
  catalog: StageCatalogSnapshot,
  variant: StageVariant,
  dimensions: Pick<StageVariant, "modelWidthM" | "modelHeightM" | "modelDepthM" | "modelSizingMode">,
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    partners: catalog.partners,
    products: catalog.products,
    variants: catalog.variants.map((item) => (
      item.variantId === variant.variantId ? { ...item, ...dimensions } : item
    )),
    collections: catalog.collections,
    assets: catalog.assets,
  });
}
