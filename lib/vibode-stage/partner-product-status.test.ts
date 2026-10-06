import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import {
  createMemoryPartnerRuntimeApply,
  publishPartnerPatchDraft,
  STAGE_PARTNER_APPLY_RPC_V6,
} from "./partner-catalog-publish";
import { toRuntimeApplyPayloadV5 } from "./partner-catalog-runtime-executor-v5";
import {
  persistableRuntimeApplyPayloadV6,
  toRuntimeApplyPayloadV6,
} from "./partner-catalog-runtime-executor-v6";
import {
  applyPartnerDraftMutation,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutation,
} from "./partner-draft-mutations";
import {
  foldedPartnerStateFromDurableCatalog,
} from "./partner-catalog-live-state";
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
import type { StageCatalogSnapshot, StagePartner } from "./types";

const ROOT = process.cwd();
const USER_A = "22222222-2222-2222-2222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STATUS_SQL = "supabase/migrations/20261001140000_vibode_stage_partner_product_status.sql";

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

function withProductStatus(
  catalog: StageCatalogSnapshot,
  productId: string,
  status: "active" | "inactive",
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    partners: catalog.partners,
    products: catalog.products.map((item) => (
      item.productId === productId ? { ...item, status } : item
    )),
    variants: catalog.variants,
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

function fingerprint(state: {
  products: readonly { productId: string; status?: string; categoryId?: string; subcategoryId?: string | null; defaultVariantId?: string; collectionIds?: readonly string[] }[];
  variants: readonly { variantId: string; productId: string; status?: string; assetId?: string | null; sku?: string | null }[];
  collections: readonly { collectionId: string; productIds: readonly string[] }[];
}) {
  return {
    products: state.products.map((item) => ({
      productId: item.productId,
      status: item.status ?? "active",
      categoryId: item.categoryId,
      subcategoryId: item.subcategoryId ?? null,
      defaultVariantId: item.defaultVariantId,
      collectionIds: [...(item.collectionIds ?? [])].sort(),
    })).sort((left, right) => left.productId.localeCompare(right.productId)),
    variants: state.variants.map((item) => ({
      variantId: item.variantId,
      productId: item.productId,
      status: item.status ?? "active",
      assetId: item.assetId ?? null,
      sku: item.sku ?? null,
    })).sort((left, right) => left.variantId.localeCompare(right.variantId)),
    collections: state.collections.map((item) => ({
      collectionId: item.collectionId,
      productIds: [...item.productIds].sort(),
    })).sort((left, right) => left.collectionId.localeCompare(right.collectionId)),
  };
}

test("product status mutations stage lifecycle ops without a second status system", () => {
  const catalog = certifiedCatalog();
  const before = fingerprint(catalog);
  const empty = emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID);
  const forbidden = parsePartnerDraftMutation({
    type: "product.set_status",
    productId: DEMO_SOFA_PRODUCT_ID,
    status: "inactive",
  });
  assert.equal(forbidden.ok, false);
  const variantForbidden = parsePartnerDraftMutation({
    type: "variant.set_status",
    variantId: "var-demo-furniture-co-demo-sofa-stone",
    status: "inactive",
  });
  assert.equal(variantForbidden.ok, false);

  const staged = applyPartnerDraftMutation(empty, catalog, {
    type: "product.deactivate",
    productId: DEMO_SOFA_PRODUCT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.deepEqual(staged.document.products.deactivate, [{ productId: DEMO_SOFA_PRODUCT_ID }]);
  assert.deepEqual(staged.document.products.reactivate, []);
  assert.equal(staged.document.products.update.length, 0);
  assert.equal(staged.document.variants.deactivate?.length ?? 0, 0);
  assert.equal(staged.document.variants.update.length, 0);
  assert.equal(staged.document.collections.membershipAdd.length, 0);
  assert.equal(staged.document.collections.membershipRemove.length, 0);
  assert.deepEqual(fingerprint(catalog), before);

  const again = applyPartnerDraftMutation(staged.document, catalog, {
    type: "product.deactivate",
    productId: DEMO_SOFA_PRODUCT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(again.document.products.deactivate, [{ productId: DEMO_SOFA_PRODUCT_ID }]);

  const cleared = applyPartnerDraftMutation(staged.document, catalog, {
    type: "product.reactivate",
    productId: DEMO_SOFA_PRODUCT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.document.products.deactivate?.length ?? 0, 0);
  assert.equal(cleared.document.products.reactivate?.length ?? 0, 0);

  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.noOp, false);
  assert.deepEqual(plan.productDeactivations, [{
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "active",
    to: "inactive",
  }]);
  assert.equal(plan.productReactivations.length, 0);
  assert.equal(plan.variantDeactivations.length, 0);
  assert.equal(plan.variantReactivations.length, 0);
  assert.equal(plan.productCreates.length, 0);
  assert.equal(plan.productUpdates.length, 0);
  assert.equal(plan.membershipAdds.length, 0);
  assert.equal(plan.membershipRemoves.length, 0);
  assert.ok(plan.nextState);
  if (!plan.nextState) return;
  const folded = foldedPartnerStateFromDurableCatalog(catalog, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(folded);
  if (!folded) return;
  const beforePlan = fingerprint(folded);
  const afterPlan = fingerprint(plan.nextState);
  assert.deepEqual(afterPlan.variants, beforePlan.variants);
  assert.deepEqual(afterPlan.collections, beforePlan.collections);
  assert.deepEqual(
    afterPlan.products.filter((item) => item.productId !== DEMO_SOFA_PRODUCT_ID),
    beforePlan.products.filter((item) => item.productId !== DEMO_SOFA_PRODUCT_ID),
  );
  assert.equal(afterPlan.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "inactive");
  assert.equal(beforePlan.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "active");
  assert.equal(afterPlan.products.length, beforePlan.products.length);

  assert.equal(toRuntimeApplyPayloadV5(plan).ok, false);
  const payload = toRuntimeApplyPayloadV6(plan);
  assert.equal(payload.ok, true, JSON.stringify(payload));
  if (!payload.ok) return;
  assert.equal(payload.payload.planVersion, 6);
  assert.deepEqual(payload.payload.productStatusTransitions, [{
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "active",
    to: "inactive",
  }]);
  assert.equal(payload.payload.productUpdates.length, 0);
  assert.equal(payload.payload.variantUpdates.length, 0);
  const persisted = persistableRuntimeApplyPayloadV6(payload.payload);
  assert.equal(persisted.planVersion, 6);
  assert.equal(Array.isArray(persisted.productStatusTransitions), true);

  const variantBlocked = toRuntimeApplyPayloadV6({
    ...plan,
    variantDeactivations: [{
      variantId: "var-demo-furniture-co-demo-sofa-stone",
      productId: DEMO_SOFA_PRODUCT_ID,
      from: "active",
      to: "inactive",
    }],
  });
  assert.equal(variantBlocked.ok, false);
});

test("inactive product reactivation keeps the same product identity", () => {
  const activeCatalog = certifiedCatalog();
  const catalog = withProductStatus(activeCatalog, DEMO_SOFA_PRODUCT_ID, "inactive");
  const staged = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "product.reactivate",
    productId: DEMO_SOFA_PRODUCT_ID,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  if (!staged.ok) return;
  assert.deepEqual(staged.document.products.reactivate, [{ productId: DEMO_SOFA_PRODUCT_ID }]);
  assert.equal(staged.document.products.create?.length ?? 0, 0);
  const plan = planDocument(staged.document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.deepEqual(plan.productReactivations, [{
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "inactive",
    to: "active",
  }]);
  assert.equal(plan.productCreates.length, 0);
  assert.equal(plan.variantCreates.length, 0);
  assert.ok(plan.nextState);
  if (!plan.nextState) return;
  const folded = foldedPartnerStateFromDurableCatalog(catalog, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(folded);
  if (!folded) return;
  const before = fingerprint(folded);
  const after = fingerprint(plan.nextState);
  assert.deepEqual(after.variants, before.variants);
  assert.deepEqual(after.collections, before.collections);
  assert.equal(after.products.length, before.products.length);
  assert.equal(after.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.status, "active");
});

test("publish stages product status through review payload and discard drops it", async () => {
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
      mutations: [{ type: "product.deactivate", productId: DEMO_SOFA_PRODUCT_ID }],
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
  assert.equal(payloads[0]?.planVersion, 6);
  assert.deepEqual(payloads[0]?.productStatusTransitions, [{
    productId: DEMO_SOFA_PRODUCT_ID,
    from: "active",
    to: "inactive",
  }]);
  assert.deepEqual(payloads[0]?.variantUpdates, []);
  assert.deepEqual(payloads[0]?.productUpdates, []);
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
      mutations: [{ type: "product.deactivate", productId: DEMO_SOFA_PRODUCT_ID }],
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

test("product status SQL updates status on the same product row", () => {
  const sql = source(STATUS_SQL);
  assert.match(sql, /create or replace function public\.vibode_stage_apply_partner_patch_v6\(p_apply jsonb\)/);
  assert.match(sql, /\(p_apply->>'planVersion'\)::integer <> 6/);
  assert.match(sql, /set status = v_next_status/);
  assert.match(sql, /and status = v_prev_status/);
  assert.match(sql, /grant execute on function public\.vibode_stage_apply_partner_patch_v6\(jsonb\)\s+to service_role/);
  assert.doesNotMatch(sql, /delete from public\.vibode_stage_products/i);
  assert.doesNotMatch(sql, /update public\.vibode_stage_variants[\s\S]{0,80}status/i);
  assert.equal(STAGE_PARTNER_APPLY_RPC_V6, "vibode_stage_apply_partner_patch_v6");
  for (const file of [
    "supabase/migrations/20260917010000_vibode_stage_partner_publish.sql",
    "supabase/migrations/20260917120000_vibode_stage_partner_variant_create.sql",
    "supabase/migrations/20260917180000_vibode_stage_partner_product_create.sql",
    "supabase/migrations/20260917220000_vibode_stage_partner_collection_create.sql",
    "supabase/migrations/20260920100000_vibode_stage_partner_patch_v5.sql",
  ]) {
    assert.doesNotMatch(source(file), /vibode_stage_apply_partner_patch_v6/);
  }
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /STAGE_PARTNER_APPLY_RPC_V6/);
});
