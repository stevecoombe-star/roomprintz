import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
  DEMO_SOFA_STONE_VARIANT_ID,
} from "./partner-catalog";
import {
  createMemoryPartnerRuntimeApply,
  publishPartnerPatchDraft,
} from "./partner-catalog-publish";
import { toRuntimeApplyPayload } from "./partner-catalog-runtime-executor";
import { toRuntimeApplyPayloadV5 } from "./partner-catalog-runtime-executor-v5";
import { toRuntimeApplyPayloadV6 } from "./partner-catalog-runtime-executor-v6";
import { toRuntimeApplyPayloadV7 } from "./partner-catalog-runtime-executor-v7";
import {
  applyPartnerDraftMutation,
  applyPartnerDraftMutations,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutation,
} from "./partner-draft-mutations";
import { foldedPartnerStateFromDurableCatalog } from "./partner-catalog-live-state";
import {
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
  planPartnerCatalogSync,
} from "./partner-catalog-sync";
import { partnerCatalogFromDurableSnapshot } from "./partner-portal-catalog";
import type { PartnerPortalAuthResult, PartnerPortalContext } from "./partner-portal-auth";
import {
  createMemoryPartnerDraftStore,
  getOpenPartnerPatchDraft,
  getOrCreatePartnerPatchDraft,
  mutatePartnerDraft,
} from "./partner-portal-drafts";
import { createMemoryPartnerPublishAuditStore } from "./partner-publish-audit";
import type { StageCatalogSnapshot, StagePartner, StageVariant } from "./types";

const ROOT = process.cwd();
const USER_A = "22222222-2222-2222-2222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VARIANT_SQL = "supabase/migrations/20261001180000_vibode_stage_partner_variant_status.sql";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function demoPartner(): StagePartner {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    name: "Demo Furniture Co.",
    slug: "demo-furniture-co",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  };
}

function authOk(): PartnerPortalAuthResult {
  const context: PartnerPortalContext = {
    userId: USER_A,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    role: "owner",
    membershipId: "11111111-1111-1111-1111-111111111111",
    partner: demoPartner(),
  };
  return { ok: true, context };
}

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

function withVariantStatus(
  catalog: StageCatalogSnapshot,
  variantId: string,
  status: "active" | "inactive",
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    partners: catalog.partners,
    products: catalog.products,
    variants: catalog.variants.map((item) => (
      item.variantId === variantId ? { ...item, status } : item
    )),
    collections: catalog.collections,
    assets: catalog.assets,
  });
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

function variantSnapshot(variant: StageVariant | undefined) {
  assert.ok(variant);
  if (!variant) throw new Error("missing variant");
  return {
    variantId: variant.variantId,
    productId: variant.productId,
    status: variant.status ?? "active",
    assetId: variant.assetId ?? null,
    sku: variant.sku ?? null,
    priceAmount: variant.priceAmount ?? null,
    productUrl: variant.productUrl ?? null,
    finishLabel: variant.finishLabel ?? null,
  };
}

test("variant status uses explicit lifecycle ops and leaves product status alone", () => {
  const catalog = certifiedCatalog();
  const stone = catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  const natural = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  const beforeStone = variantSnapshot(stone);
  const beforeNatural = variantSnapshot(natural);
  assert.equal(beforeStone.status, "active");
  const empty = emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID);
  const forbidden = parsePartnerDraftMutation({
    type: "variant.set_status",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    status: "inactive",
  });
  assert.equal(forbidden.ok, false);

  const staged = applyPartnerDraftMutation(empty, catalog, {
    type: "variant.deactivate",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.deepEqual(staged.document.variants.deactivate, [{ variantId: DEMO_SOFA_STONE_VARIANT_ID }]);
  assert.deepEqual(staged.document.variants.reactivate, []);
  assert.equal(staged.document.variants.update.length, 0);
  assert.equal(staged.document.variants.create.length, 0);
  assert.equal(staged.document.products.deactivate?.length ?? 0, 0);
  assert.equal(staged.document.products.reactivate?.length ?? 0, 0);
  assert.equal(staged.document.products.update.length, 0);
  assert.deepEqual(variantSnapshot(catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID)), beforeStone);

  const again = applyPartnerDraftMutation(staged.document, catalog, {
    type: "variant.deactivate",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(again.document.variants.deactivate, [{ variantId: DEMO_SOFA_STONE_VARIANT_ID }]);

  const cleared = applyPartnerDraftMutation(staged.document, catalog, {
    type: "variant.reactivate",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.document.variants.deactivate?.length ?? 0, 0);
  assert.equal(cleared.document.variants.reactivate?.length ?? 0, 0);

  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.noOp, false);
  assert.deepEqual(plan.variantDeactivations, [{
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "active",
    to: "inactive",
  }]);
  assert.equal(plan.variantReactivations.length, 0);
  assert.equal(plan.productDeactivations.length, 0);
  assert.equal(plan.productReactivations.length, 0);
  assert.equal(plan.variantCreates.length, 0);
  assert.equal(plan.variantUpdates.length, 0);
  assert.equal(plan.productCreates.length, 0);
  assert.equal(plan.productUpdates.length, 0);
  assert.ok(plan.nextState);
  if (!plan.nextState) return;
  const nextStone = plan.nextState.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  const nextNatural = plan.nextState.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  const nextProduct = plan.nextState.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  assert.equal(nextStone?.status, "inactive");
  assert.equal(nextStone?.variantId, beforeStone.variantId);
  assert.equal(nextStone?.assetId ?? null, beforeStone.assetId);
  assert.equal(nextStone?.sku ?? null, beforeStone.sku);
  assert.equal(nextStone?.priceAmount ?? null, beforeStone.priceAmount);
  assert.equal(nextStone?.productUrl ?? null, beforeStone.productUrl);
  assert.equal(nextStone?.finishLabel ?? null, beforeStone.finishLabel);
  assert.deepEqual(variantSnapshot(nextNatural), beforeNatural);
  assert.equal(nextProduct?.status ?? "active", "active");
  assert.equal(nextProduct?.defaultVariantId, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(plan.nextState.variants.length, catalog.variants.filter((item) => (
    plan.nextState?.products.some((product) => product.productId === item.productId && product.partnerId === DEMO_FURNITURE_PARTNER_ID)
  )).length);

  assert.equal(toRuntimeApplyPayload(plan).ok, false);
  assert.equal(toRuntimeApplyPayloadV5(plan).ok, false);
  assert.equal(toRuntimeApplyPayloadV6(plan).ok, false);
  const payload = toRuntimeApplyPayloadV7(plan);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  if (!payload.ok) return;
  assert.equal(payload.payload.planVersion, 7);
  assert.deepEqual(payload.payload.productStatusTransitions, []);
  assert.deepEqual(payload.payload.variantStatusTransitions, [{
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "active",
    to: "inactive",
  }]);
  assert.equal(payload.payload.variantUpdates.length, 0);
  assert.equal(payload.payload.productUpdates.length, 0);
  assert.equal(payload.payload.variantCreates.length, 0);
});

test("inactive variant reactivation keeps the same variant and model", () => {
  const catalog = withVariantStatus(certifiedCatalog(), DEMO_SOFA_STONE_VARIANT_ID, "inactive");
  const before = variantSnapshot(catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID));
  const staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "variant.reactivate",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.deepEqual(staged.document.variants.reactivate, [{ variantId: DEMO_SOFA_STONE_VARIANT_ID }]);
  assert.equal(staged.document.products.reactivate?.length ?? 0, 0);
  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.deepEqual(plan.variantReactivations, [{
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "inactive",
    to: "active",
  }]);
  assert.equal(plan.productReactivations.length, 0);
  assert.equal(plan.variantCreates.length, 0);
  const next = plan.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  assert.equal(next?.status, "active");
  assert.equal(next?.assetId ?? null, before.assetId);
  assert.equal(next?.sku ?? null, before.sku);
  assert.equal(plan.nextState?.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status ?? "active", "active");
  const payload = toRuntimeApplyPayloadV7(plan);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  if (!payload.ok) return;
  assert.equal(payload.payload.planVersion, 7);
  assert.deepEqual(payload.payload.variantStatusTransitions, [{
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "inactive",
    to: "active",
  }]);
});

test("variant status can share a draft with another variant field edit", () => {
  const catalog = certifiedCatalog();
  const before = variantSnapshot(catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID));
  const staged = applyPartnerDraftMutations(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, [
    { type: "variant.set_sku", variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: "DFC-SOFA-02-PENDING" },
    { type: "variant.deactivate", variantId: DEMO_SOFA_STONE_VARIANT_ID },
  ], DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.deepEqual(staged.document.variants.update, [{
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    sku: "DFC-SOFA-02-PENDING",
  }]);
  assert.deepEqual(staged.document.variants.deactivate, [{ variantId: DEMO_SOFA_STONE_VARIANT_ID }]);
  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.variantUpdates.length, 1);
  assert.equal(plan.variantUpdates[0]?.changes.some((change) => change.column === "sku" && change.next === "DFC-SOFA-02-PENDING"), true);
  assert.equal(plan.variantDeactivations.length, 1);
  assert.equal(plan.productDeactivations.length, 0);
  const next = plan.nextState?.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  assert.equal(next?.status, "inactive");
  assert.equal(next?.sku, "DFC-SOFA-02-PENDING");
  assert.equal(next?.assetId ?? null, before.assetId);
  assert.equal(next?.finishLabel ?? null, before.finishLabel);
  assert.equal(next?.priceAmount ?? null, before.priceAmount);
  assert.equal(next?.productUrl ?? null, before.productUrl);
  const payload = toRuntimeApplyPayloadV7(plan);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  if (!payload.ok) return;
  assert.equal(payload.payload.variantUpdates.length, 1);
  assert.equal(payload.payload.variantStatusTransitions.length, 1);
  assert.deepEqual(payload.payload.productStatusTransitions, []);

  const both = applyPartnerDraftMutations(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, [
    { type: "variant.deactivate", variantId: DEMO_SOFA_STONE_VARIANT_ID },
    { type: "product.deactivate", productId: DEMO_SOFA_PRODUCT_ID },
  ], DEMO_FURNITURE_PARTNER_ID);
  assert.equal(both.ok, true, JSON.stringify(both));
  if (!both.ok) return;
  const bothPlan = planDocument(both.document, catalog);
  assert.equal(bothPlan.ok, true, JSON.stringify(bothPlan.issues));
  assert.equal(bothPlan.variantDeactivations.length, 1);
  assert.equal(bothPlan.productDeactivations.length, 1);
  const bothPayload = toRuntimeApplyPayloadV7(bothPlan);
  assert.equal(bothPayload.ok, true, JSON.stringify(bothPayload));
  if (!bothPayload.ok) return;
  assert.equal(bothPayload.payload.planVersion, 7);
  assert.equal(bothPayload.payload.productStatusTransitions.length, 1);
  assert.equal(bothPayload.payload.variantStatusTransitions.length, 1);
  assert.equal(toRuntimeApplyPayloadV6(bothPlan).ok, false);
});

test("default variant deactivation stays blocked for an active product", () => {
  const catalog = certifiedCatalog();
  const staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "variant.deactivate",
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.equal(staged.document.products.deactivate?.length ?? 0, 0);
  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, false);
  assert.equal(plan.issues.some((issue) => issue.code === "DEFAULT_VARIANT_INACTIVE"), true);
  assert.equal(plan.productDeactivations.length, 0);
});

test("unpublished variants keep create-edit semantics", () => {
  const catalog = certifiedCatalog();
  const document = {
    ...emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    variants: {
      create: [{
        variantId: "var-demo-furniture-co-demo-sofa-pending",
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Pending",
        sku: null,
        priceAmount: 1,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: "asset-pending",
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
  };
  const staged = applyPartnerDraftMutation(document, catalog, {
    type: "variant.deactivate",
    variantId: "var-demo-furniture-co-demo-sofa-pending",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, false);
  if (staged.ok) return;
  assert.equal(staged.code, "invalid_mutation");
});

test("publish stages variant status through the v7 payload and discard drops it", async () => {
  const catalog = certifiedCatalog();
  const load = partnerCatalogFromDurableSnapshot({
    catalog,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(load.ok, true);
  const store = createMemoryPartnerDraftStore();
  const audit = createMemoryPartnerPublishAuditStore();
  const payloads: Record<string, unknown>[] = [];
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  const staged = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "variant.deactivate", variantId: DEMO_SOFA_STONE_VARIANT_ID }],
    },
  });
  assert.equal(staged.status, 200, JSON.stringify(staged.body));

  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    audit,
    apply: async (payload) => {
      payloads.push(payload);
      return createMemoryPartnerRuntimeApply({ store, audit })(payload);
    },
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal((published.body as { status?: string }).status, "accepted");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.planVersion, 7);
  assert.deepEqual(payloads[0]?.variantStatusTransitions, [{
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "active",
    to: "inactive",
  }]);
  assert.deepEqual(payloads[0]?.productStatusTransitions, []);
  assert.deepEqual(payloads[0]?.variantUpdates, []);
  assert.deepEqual(payloads[0]?.productUpdates, []);
  assert.equal(catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID)?.status ?? "active", "active");
  assert.equal(catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status ?? "active", "active");

  const discardStore = createMemoryPartnerDraftStore();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: discardStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  const stagedAgain = await mutatePartnerDraft({
    auth: authOk(),
    store: discardStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "variant.deactivate", variantId: DEMO_SOFA_STONE_VARIANT_ID }],
    },
  });
  assert.equal(stagedAgain.status, 200, JSON.stringify(stagedAgain.body));
  const discarded = await mutatePartnerDraft({
    auth: authOk(),
    store: discardStore,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 2, status: "abandoned" },
  });
  assert.equal(discarded.status, 200, JSON.stringify(discarded.body));
  const open = await getOpenPartnerPatchDraft({ auth: authOk(), store: discardStore });
  assert.equal((open.body as { draft?: unknown }).draft, null);
});

test("variant status SQL updates status on the same variant row", () => {
  const sql = source(VARIANT_SQL);
  const marker = "coalesce(p_apply->'variantStatusTransitions', '[]'::jsonb)) as value";
  const start = sql.indexOf(marker);
  assert.ok(start > 0);
  const block = sql.slice(start, sql.indexOf("p_apply->'collectionUpdates'", start));
  assert.match(sql, /create or replace function public\.vibode_stage_apply_partner_patch_v7\(p_apply jsonb\)/);
  assert.match(sql, /\(p_apply->>'planVersion'\)::integer <> 7/);
  assert.doesNotMatch(sql, /vibode_stage_apply_partner_patch_v6/);
  assert.match(sql, /coalesce\(p_apply->'variantStatusTransitions', '\[\]'::jsonb\)/);
  assert.match(block, /update public\.vibode_stage_variants/);
  assert.match(block, /set status = v_next_status/);
  assert.match(block, /variant_id = v_variant_id/);
  assert.match(block, /product_id = v_product_id/);
  assert.match(block, /status = v_prev_status/);
  assert.doesNotMatch(block, /current_asset_id|finish_label|sku|price_amount|product_url|delete /i);
  assert.match(sql, /update public\.vibode_stage_products\s+set status = v_next_status/);
  assert.doesNotMatch(sql, /delete from public\.vibode_stage_variants/i);
  assert.doesNotMatch(sql, /delete from public\.vibode_stage_products/i);
  for (const file of [
    "supabase/migrations/20260917010000_vibode_stage_partner_publish.sql",
    "supabase/migrations/20260917120000_vibode_stage_partner_variant_create.sql",
    "supabase/migrations/20260917180000_vibode_stage_partner_product_create.sql",
    "supabase/migrations/20260917220000_vibode_stage_partner_collection_create.sql",
    "supabase/migrations/20260920100000_vibode_stage_partner_patch_v5.sql",
    "supabase/migrations/20261001140000_vibode_stage_partner_product_status.sql",
  ]) {
    assert.doesNotMatch(source(file), /variantStatusTransitions/);
  }
});
