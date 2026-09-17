import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PI5F2_COFFEE_TABLE_ASSET_ID } from "@/lib/afc-v2-runtime/pi5f2-demo-coffee-table-geometry";

import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
  DEMO_SOFA_STONE_VARIANT_ID,
} from "./partner-catalog";
import {
  partnerSlugFromPartnerId,
  productSlugFor,
  variantIdForCreate,
} from "./partner-catalog-ids";
import {
  createMemoryPartnerRuntimeApply,
  publishPartnerPatchDraft,
  STAGE_PARTNER_APPLY_RPC,
  STAGE_PARTNER_APPLY_RPC_V2,
  type PartnerRuntimeApplyFn,
} from "./partner-catalog-publish";
import {
  g3UnsupportedPublishOperations,
  toRuntimeApplyPayload,
} from "./partner-catalog-runtime-executor";
import {
  g4aUnsupportedPublishOperations,
  PARTNER_RUNTIME_PLAN_VERSION_2,
  partnerRuntimePlanNeedsV2,
  toRuntimeApplyPayloadV2,
} from "./partner-catalog-runtime-executor-v2";
import {
  DEMO_COFFEE_TABLE_WALNUT_SKU,
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
  planPartnerCatalogSync,
  renderPartnerCatalogSyncSql,
} from "./partner-catalog-sync";
import {
  durableAssetCatalogForPlanning,
  foldedPartnerStateFromDurableCatalog,
} from "./partner-catalog-live-state";
import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import {
  applyPartnerDraftMutation,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutation,
} from "./partner-draft-mutations";
import {
  partnerDraftPreviewHasChanges,
  presentPartnerDraftPreview,
} from "./partner-draft-preview-view";
import { listPartnerReadyAssetsForVariantCreate } from "./partner-portal-assets";
import {
  resolvePartnerPortalAuth,
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
} from "./partner-portal-auth";
import { partnerCatalogFromDurableSnapshot, type PartnerPortalCatalogLoadResult } from "./partner-portal-catalog";
import {
  createMemoryPartnerDraftStore,
  getOrCreatePartnerPatchDraft,
  getPartnerDraft,
  mutatePartnerDraft,
  previewPersistedPartnerDraft,
  type PartnerPortalDraftDto,
} from "./partner-portal-drafts";
import { createMemoryPartnerPublishAuditStore } from "./partner-publish-audit";
import type { PartnerCatalogSyncPlan } from "./partner-catalog-sync-types";
import type { StageCatalogSnapshot, StagePartner, StageVariant } from "./types";

const ROOT = process.cwd();
const G3_SQL = "supabase/migrations/20260917010000_vibode_stage_partner_publish.sql";
const G4A_SQL = "supabase/migrations/20260917120000_vibode_stage_partner_variant_create.sql";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OAK_VARIANT_ID = "var-demo-furniture-co-demo-sofa-oak";
const OAK_SKU = "DFC-SOFA-OAK-G4A";
const OAK_PRICE = 1499;

const PI5G4A_FILES = [
  G4A_SQL,
  "lib/vibode-stage/partner-catalog-ids.ts",
  "lib/vibode-stage/partner-portal-assets.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
  "lib/vibode-stage/partner-draft-mutations.ts",
  "lib/vibode-stage/partner-draft-preview-view.ts",
  "lib/vibode-stage/partner-catalog-publish.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor.server.ts",
  "app/partner/catalog/drafts/[draftId]/page.tsx",
  "app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx",
];

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function demoPartner(status: StagePartner["status"] = "active"): StagePartner {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    name: "Demo Furniture Co.",
    slug: "demo-furniture-co",
    status,
    websiteUrl: null,
    logoUrl: null,
  };
}

function context(partner = demoPartner(), userId = USER_A): PartnerPortalContext {
  return {
    userId,
    partnerId: partner.partnerId,
    role: "owner",
    membershipId: "11111111-1111-1111-1111-111111111111",
    partner,
  };
}

function authOk(partner = demoPartner(), userId = USER_A): PartnerPortalAuthResult {
  return { ok: true, context: context(partner, userId) };
}

function certifiedScopedCatalog() {
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
  return { mixed, catalog: loaded.catalog, load: loaded };
}

function draftFrom(body: unknown): PartnerPortalDraftDto {
  const record = body as { ok?: boolean; draft?: PartnerPortalDraftDto };
  assert.equal(record.ok, true);
  assert.ok(record.draft);
  return record.draft!;
}

function cloneCatalog(
  catalog: StageCatalogSnapshot,
  patch: Partial<StageCatalogSnapshot>,
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    partners: patch.partners ?? catalog.partners,
    products: patch.products ?? catalog.products,
    variants: patch.variants ?? catalog.variants,
    collections: patch.collections ?? catalog.collections,
    assets: patch.assets ?? catalog.assets,
  });
}

function loadOf(catalog: StageCatalogSnapshot) {
  return partnerCatalogFromDurableSnapshot({ catalog, partnerId: DEMO_FURNITURE_PARTNER_ID });
}

function sofaAssetId(catalog: StageCatalogSnapshot): string {
  const variant = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(variant?.assetId);
  return variant.assetId;
}

function oakCreateMutation(catalog: StageCatalogSnapshot, extra: Record<string, unknown> = {}) {
  return {
    type: "variant.create" as const,
    productId: DEMO_SOFA_PRODUCT_ID,
    finishLabel: "Oak",
    sku: OAK_SKU,
    priceAmount: OAK_PRICE,
    productUrl: null,
    currentAssetId: sofaAssetId(catalog),
    ...extra,
  };
}

function capturingApply(inner: PartnerRuntimeApplyFn) {
  const payloads: Record<string, unknown>[] = [];
  const apply: PartnerRuntimeApplyFn = async (payload) => {
    payloads.push(payload);
    return inner(payload);
  };
  return { apply, payloads };
}

function insertingApply(
  inner: PartnerRuntimeApplyFn,
  live: { catalog: StageCatalogSnapshot },
): PartnerRuntimeApplyFn {
  return async (payload) => {
    const result = await inner(payload);
    if (!result.ok) return result;
    if (result.idempotent) return result;
    const creates = Array.isArray(payload.variantCreates) ? payload.variantCreates : [];
    if (creates.length === 0) return result;
    const nextVariants: StageVariant[] = [...live.catalog.variants];
    for (const raw of creates) {
      const create = raw as Record<string, unknown>;
      const variantId = typeof create.variantId === "string" ? create.variantId : "";
      if (nextVariants.some((item) => item.variantId === variantId)) {
        return { ok: false, errorCode: "DUPLICATE_VARIANT_ID" };
      }
      nextVariants.push({
        variantId,
        productId: String(create.productId ?? ""),
        assetId: String(create.currentAssetId ?? ""),
        finishLabel: typeof create.finishLabel === "string" ? create.finishLabel : null,
        sku: typeof create.sku === "string" ? create.sku : null,
        priceAmount: typeof create.priceAmount === "number" ? create.priceAmount : null,
        priceCurrency: String(create.priceCurrency ?? "USD"),
        productUrl: typeof create.productUrl === "string" ? create.productUrl : null,
        status: "active",
      });
    }
    live.catalog = cloneCatalog(live.catalog, { variants: nextVariants });
    return result;
  };
}

async function openOakDraft() {
  const { catalog, load, mixed } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  const audit = createMemoryPartnerPublishAuditStore();
  const live = { catalog: mixed };
  const memory = createMemoryPartnerRuntimeApply({ store, audit });
  const captured = capturingApply(insertingApply(memory, live));
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  const saved = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 1, mutations: [oakCreateMutation(catalog)] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return {
    catalog,
    load,
    mixed,
    live,
    store,
    audit,
    apply: captured.apply,
    payloads: captured.payloads,
  };
}

function planDocument(document: unknown, catalog: StageCatalogSnapshot): PartnerCatalogSyncPlan {
  const folded = foldedPartnerStateFromDurableCatalog(catalog, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(folded);
  const parsed = parsePartnerCatalogSyncJson(
    typeof document === "object" && document ? { ...document as object, partnerId: DEMO_FURNITURE_PARTNER_ID } : document,
  );
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error("parse failed");
  return planPartnerCatalogSync({
    current: folded,
    document: parsed.document,
    catalog: durableAssetCatalogForPlanning(catalog),
    seedAssets: catalog.assets,
    repoRoot: ROOT,
  });
}

test("PI-5G4a v2 RPC exists beside frozen v1 with service_role-only execute", () => {
  const v1 = source(G3_SQL);
  const v2 = source(G4A_SQL);
  assert.match(v1, /create or replace function public\.vibode_stage_apply_partner_patch\(p_apply jsonb\)/);
  assert.match(v1, /\(p_apply->>'planVersion'\)::integer <> 1/);
  assert.doesNotMatch(v1, /variantCreates/);
  assert.match(v2, /create or replace function public\.vibode_stage_apply_partner_patch_v2\(p_apply jsonb\)/);
  assert.match(v2, /\(p_apply->>'planVersion'\)::integer <> 2/);
  assert.match(v2, /security definer/i);
  assert.match(v2, /set search_path = public/);
  assert.match(v2, /revoke all on function public\.vibode_stage_apply_partner_patch_v2\(jsonb\)/);
  assert.match(v2, /from public, anon, authenticated/);
  assert.match(v2, /grant execute on function public\.vibode_stage_apply_partner_patch_v2\(jsonb\)\s+to service_role/);
  assert.match(v2, /pg_advisory_xact_lock/);
  assert.match(v2, /hashtextextended/);
  assert.match(v2, /for update/);
  assert.match(v2, /VIBODE_STAGE_PUBLISH:DUPLICATE_VARIANT_ID/);
  assert.match(v2, /VIBODE_STAGE_PUBLISH:PARENT_PRODUCT_MISMATCH/);
  assert.match(v2, /VIBODE_STAGE_PUBLISH:DUPLICATE_SKU/);
  assert.match(v2, /VIBODE_STAGE_PUBLISH:ASSET_NOT_READY/);
  assert.match(v2, /VIBODE_STAGE_PUBLISH:PARTNER_ASSET_UNASSOCIATED/);
  assert.match(v2, /insert into public\.vibode_stage_variants/);
  assert.match(v2, /current_asset_id/);
  assert.doesNotMatch(v2, /set default_variant_id/);
  assert.doesNotMatch(v2, /EXECUTE\s+format/i);
  assert.doesNotMatch(v2, /EXECUTE\s+'/i);
  assert.doesNotMatch(v2, /vibode_3d_scenes|objects_json|scene_objects/);
  assert.doesNotMatch(v2, /create table/);
  assert.equal(STAGE_PARTNER_APPLY_RPC, "vibode_stage_apply_partner_patch");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V2, "vibode_stage_apply_partner_patch_v2");
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_2, 2);
});

test("PI-5G4a identity helpers lift productSlugFor without changing certified namespace", () => {
  const slug = partnerSlugFromPartnerId(DEMO_FURNITURE_PARTNER_ID);
  assert.equal(slug, "demo-furniture-co");
  assert.equal(productSlugFor(slug!, DEMO_SOFA_PRODUCT_ID), "demo-sofa");
  assert.equal(variantIdForCreate(slug!, "demo-sofa", "oak"), OAK_VARIANT_ID);
  assert.match(source("lib/vibode-stage/partner-catalog-sync.ts"), /productSlugFor/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-ids.ts"), /partnerCatalogSqlSlug|partnerCatalogMigrationFileName/);
});

test("PI-5G4a draft create persists canonical variants.create[] with server-derived identity", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  const empty = draftFrom((await getPartnerDraft({
    auth: authOk(),
    store,
    draftId: DRAFT_A,
  })).body);
  assert.equal(empty.document.variants.create.length, 0);
  assert.deepEqual(empty.touchedBase, { products: {}, variants: {}, collections: {} });

  const spoof = parsePartnerDraftMutation({
    ...oakCreateMutation(catalog),
    partnerId: OTHER_PARTNER_ID,
  });
  assert.equal(spoof.ok, false);

  const saved = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [oakCreateMutation(catalog, { partnerId: OTHER_PARTNER_ID })],
    },
  });
  assert.equal(saved.status, 400);

  const created = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 1, mutations: [oakCreateMutation(catalog)] },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const dto = draftFrom(created.body);
  assert.equal(dto.revision, 2);
  assert.equal(dto.document.variants.create.length, 1);
  const create = dto.document.variants.create[0]!;
  assert.equal(create.variantId, OAK_VARIANT_ID);
  assert.equal(create.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(create.finishLabel, "Oak");
  assert.equal(create.sku, OAK_SKU);
  assert.equal(create.priceAmount, OAK_PRICE);
  assert.equal(create.priceCurrency, catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.priceCurrency);
  assert.equal(create.currentAssetId, sofaAssetId(catalog));
  assert.deepEqual(dto.touchedBase, { products: {}, variants: {}, collections: {} });
  const parsed = parsePartnerCatalogSyncJson(dto.document);
  assert.equal(parsed.ok, true);

  const renamed = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "variant.create_edit", variantId: OAK_VARIANT_ID, finishLabel: "White oak" }],
    },
  });
  assert.equal(renamed.status, 200);
  const afterEdit = draftFrom(renamed.body);
  assert.equal(afterEdit.revision, 3);
  assert.equal(afterEdit.document.variants.create[0]?.variantId, OAK_VARIANT_ID);
  assert.equal(afterEdit.document.variants.create[0]?.finishLabel, "White oak");
  assert.deepEqual(afterEdit.touchedBase, { products: {}, variants: {}, collections: {} });

  const stale = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "variant.create_edit", variantId: OAK_VARIANT_ID, sku: "STALE" }],
    },
  });
  assert.equal(stale.status, 409);

  const removed = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "variant.create_remove", variantId: OAK_VARIANT_ID }],
    },
  });
  assert.equal(removed.status, 200);
  const afterRemove = draftFrom(removed.body);
  assert.equal(afterRemove.document.variants.create.length, 0);
  assert.equal(afterRemove.revision, 4);
  assert.deepEqual(afterRemove.touchedBase, { products: {}, variants: {}, collections: {} });

  const liveEdit = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    type: "variant.set_finish_label",
    variantId: OAK_VARIANT_ID,
    finishLabel: "Nope",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(liveEdit.ok, false);
});

test("PI-5G4a Partner Asset picker is Partner-scoped ready-only Portal tenancy", () => {
  const { catalog, mixed } = certifiedScopedCatalog();
  const choices = listPartnerReadyAssetsForVariantCreate(catalog);
  assert.ok(choices.length > 0);
  assert.equal(choices.some((item) => item.assetId === sofaAssetId(catalog)), true);
  assert.equal(choices.every((item) => catalog.variants.some((variant) => variant.assetId === item.assetId)), true);

  const foreignOnly = cloneCatalog(catalog, {
    assets: [
      ...catalog.assets,
      {
        assetId: "afc-v2-runtime/partners/other-furniture-co/secret",
        glbUrl: "/secret.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        status: "ready",
      },
    ],
  });
  const foreignChoices = listPartnerReadyAssetsForVariantCreate(foreignOnly);
  assert.equal(foreignChoices.some((item) => item.assetId.includes("other-furniture-co")), false);

  const notReady = cloneCatalog(catalog, {
    assets: catalog.assets.map((asset) => (
      asset.assetId === sofaAssetId(catalog) ? { ...asset, status: "unavailable" as const } : asset
    )),
  });
  const notReadyChoices = listPartnerReadyAssetsForVariantCreate(notReady);
  assert.equal(notReadyChoices.some((item) => item.assetId === sofaAssetId(catalog)), false);

  const unknown = applyPartnerDraftMutation(
    emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    catalog,
    {
      type: "variant.create",
      productId: DEMO_SOFA_PRODUCT_ID,
      finishLabel: "Oak",
      sku: OAK_SKU,
      priceAmount: OAK_PRICE,
      productUrl: null,
      currentAssetId: "not-a-partner-asset",
    },
    DEMO_FURNITURE_PARTNER_ID,
  );
  assert.equal(unknown.ok, false);

  const emptyAssets = cloneCatalog(catalog, { assets: [], variants: catalog.variants.map((item) => ({ ...item, assetId: null })) });
  const emptyChoices = listPartnerReadyAssetsForVariantCreate(emptyAssets);
  assert.equal(emptyChoices.length, 0);
  const disabled = applyPartnerDraftMutation(
    emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    emptyAssets,
    oakCreateMutation(catalog),
    DEMO_FURNITURE_PARTNER_ID,
  );
  assert.equal(disabled.ok, false);
  assert.match(source("lib/vibode-stage/partner-portal-assets.ts"), /Portal tenancy enforcement/);
  assert.doesNotMatch(source("lib/vibode-stage/product-variant-register.ts"), /Partner-scoped certified-ready Asset picker/);
  assert.ok(mixed.assets.length >= catalog.assets.length);
});

test("PI-5G4a Preview shows Create Variant and keeps planner advisory", async () => {
  const opened = await openOakDraft();
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5g4a-preview-"));
  const before = readdirSync(repoRoot);
  const preview = await previewPersistedPartnerDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.load,
    draftId: DRAFT_A,
    body: { expectedRevision: 2 },
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot: ROOT,
    }),
  });
  assert.equal(preview.status, 200);
  const body = preview.body as {
    ok: boolean;
    noOp: boolean;
    sqlPlan?: unknown;
    variantCreates: readonly { variant: { variantId: string; sku: string | null } }[];
    issues: readonly { code: string }[];
  };
  assert.equal(body.ok, true);
  assert.equal(body.noOp, false);
  assert.equal(body.sqlPlan, undefined);
  assert.equal(body.variantCreates.some((item) => item.variant.variantId === OAK_VARIANT_ID), true);
  const view = presentPartnerDraftPreview(body);
  assert.equal("error" in view, false);
  if ("error" in view) return;
  assert.equal(partnerDraftPreviewHasChanges(view), true);
  const created = view.variantCreates.find((item) => item.variantId === OAK_VARIANT_ID);
  assert.ok(created);
  assert.equal(created?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(created?.sku, OAK_SKU);
  assert.match(created?.finishLabel ?? "", /Oak/);
  assert.match(created?.price ?? "", /1499/);
  assert.ok(created?.currentAssetId);
  const workspace = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.match(workspace, /Create Variant/);
  assert.match(workspace, /Update Variant/);
  assert.match(workspace, /New Variant — pending publish/);
  assert.match(workspace, /Add Variant/);
  assert.match(workspace, /variant\.create_edit/);
  assert.match(workspace, /variant\.create_remove/);
  assert.doesNotMatch(workspace, /variant\.set_asset/);
  assert.deepEqual(readdirSync(repoRoot), before);

  opened.store.rows[0] = {
    ...opened.store.rows[0]!,
    document: {
      ...opened.store.rows[0]!.document as object,
      variants: {
        create: [{
          variantId: OAK_VARIANT_ID,
          productId: DEMO_SOFA_PRODUCT_ID,
          finishLabel: "Oak",
          sku: "DFC-SOFA-01",
          priceAmount: OAK_PRICE,
          priceCurrency: "USD",
          productUrl: null,
          currentAssetId: sofaAssetId(opened.catalog),
        }],
        update: [],
        deactivate: [],
        reactivate: [],
      },
    },
  };
  const dup = await previewPersistedPartnerDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.load,
    draftId: DRAFT_A,
    body: {},
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot: ROOT,
    }),
  });
  const dupBody = dup.body as { ok: boolean; issues: readonly { code: string }[] };
  assert.equal(dupBody.ok, false);
  assert.equal(dupBody.issues.some((item) => item.code === "DUPLICATE_SKU"), true);
});

test("PI-5G4a existing Variant Asset update remains ASSET_RETARGET_REQUIRED", () => {
  const { catalog } = certifiedScopedCatalog();
  const parsed = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [],
      update: [{ variantId: DEMO_SOFA_STONE_VARIANT_ID, currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID }],
      deactivate: [],
      reactivate: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const plan = planDocument(parsed.document, catalog);
  assert.equal(plan.issues.some((issue) => issue.code === "ASSET_RETARGET_REQUIRED"), true);
  const forbidden = parsePartnerDraftMutation({
    type: "variant.set_asset",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    currentAssetId: sofaAssetId(catalog),
  });
  assert.equal(forbidden.ok, false);
});

test("PI-5G4a v1 serializer still rejects creates and v2 serializes them", () => {
  const { catalog } = certifiedScopedCatalog();
  const document = {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [{
        variantId: OAK_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Oak",
        sku: OAK_SKU,
        priceAmount: OAK_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  };
  const plan = planDocument(document, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.variantCreates.length, 1);
  assert.equal(partnerRuntimePlanNeedsV2(plan), true);
  assert.deepEqual(g3UnsupportedPublishOperations(plan), ["variantCreates"]);
  assert.equal(toRuntimeApplyPayload(plan).ok, false);
  assert.deepEqual(g4aUnsupportedPublishOperations(plan), []);
  const v2 = toRuntimeApplyPayloadV2(plan);
  assert.equal(v2.ok, true);
  if (!v2.ok) return;
  assert.equal(v2.payload.planVersion, 2);
  assert.equal(v2.payload.variantCreates[0]?.variantId, OAK_VARIANT_ID);
  assert.equal(v2.payload.variantCreates[0]?.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(v2.payload.variantCreates[0]?.currentAssetId, sofaAssetId(catalog));
  assert.equal(v2.payload.variantCreates[0]?.sku, OAK_SKU);
  assert.equal(v2.payload.variantCreates[0]?.priceAmount, OAK_PRICE);
  assert.equal(v2.payload.variantCreates[0]?.priceCurrency, "USD");

  const rendered = renderPartnerCatalogSyncSql({
    partner: catalog.partners[0]!,
    productUpdates: plan.productUpdates,
    variantCreates: plan.variantCreates,
    variantUpdates: plan.variantUpdates,
    collectionUpdates: plan.collectionUpdates,
    membershipAdds: plan.membershipAdds,
    membershipRemoves: plan.membershipRemoves,
    current: foldedPartnerStateFromDurableCatalog(catalog, DEMO_FURNITURE_PARTNER_ID)!,
  });
  assert.match(rendered, new RegExp(OAK_VARIANT_ID));
  assert.match(rendered, /insert into public\.vibode_stage_variants/);
  assert.match(rendered, /current_asset_id/);
  assert.match(rendered, /SKU already exists for partner/);
  assert.match(rendered, /Target Asset is missing or not ready/);
  const v2sql = source(G4A_SQL);
  assert.match(v2sql, /insert into public\.vibode_stage_variants/);
  assert.match(v2sql, /variants\.sku = v_sku/);
  assert.match(v2sql, /assets\.status = 'ready'/);
  assert.match(v2sql, /variants\.current_asset_id = v_asset_id/);

  const productCreatePlan: PartnerCatalogSyncPlan = {
    ...plan,
    productCreates: [{ product: catalog.products[0]!, sortOrder: 0 }],
  };
  assert.equal(g4aUnsupportedPublishOperations(productCreatePlan).includes("productCreates"), true);
  assert.equal(toRuntimeApplyPayloadV2(productCreatePlan).ok, false);
});

test("PI-5G4a publish selects v2 for creates, v1 for update-only, and inserts without changing default", async () => {
  const opened = await openOakDraft();
  const sofa = opened.catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  assert.ok(sofa);
  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.load,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    reloadCatalog: async () => loadOf(opened.live.catalog),
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal((published.body as { status?: string }).status, "accepted");
  assert.equal(opened.payloads[0]?.planVersion, 2);
  assert.ok(Array.isArray(opened.payloads[0]?.variantCreates));
  const inserted = opened.live.catalog.variants.find((item) => item.variantId === OAK_VARIANT_ID);
  assert.ok(inserted);
  assert.equal(inserted?.sku, OAK_SKU);
  assert.equal(inserted?.status, "active");
  const afterProduct = opened.live.catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  assert.equal(afterProduct?.defaultVariantId, sofa.defaultVariantId);
  const audit = opened.audit.rows.find((row) => row.status === "accepted");
  assert.ok(audit);
  const document = audit?.document as { variants?: { create?: unknown[] } };
  assert.ok(Array.isArray(document.variants?.create));
  const plan = audit?.plan as { planVersion?: number; variantCreates?: unknown[] };
  assert.equal(plan.planVersion, 2);
  assert.ok(Array.isArray(plan.variantCreates));

  const retry = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: loadOf(opened.live.catalog),
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(retry.status, 200);
  assert.equal((retry.body as { idempotent?: boolean }).idempotent, true);
  assert.equal((retry.body as { publishId?: string }).publishId, (published.body as { publishId?: string }).publishId);
  assert.equal(opened.live.catalog.variants.filter((item) => item.variantId === OAK_VARIANT_ID).length, 1);
  assert.equal(opened.audit.rows.filter((row) => row.status === "accepted").length, 1);

  const { catalog, load } = certifiedScopedCatalog();
  const updateStore = createMemoryPartnerDraftStore();
  const updateAudit = createMemoryPartnerPublishAuditStore();
  const memory = createMemoryPartnerRuntimeApply({ store: updateStore, audit: updateAudit });
  const captured = capturingApply(memory);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: updateStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: updateStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Update Only Sofa" }],
    },
  });
  const updateOnly = await publishPartnerPatchDraft({
    auth: authOk(),
    store: updateStore,
    catalog: load,
    audit: updateAudit,
    apply: captured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(updateOnly.status, 200);
  assert.equal(captured.payloads[0]?.planVersion, 1);
  assert.equal(captured.payloads[0]?.variantCreates, undefined);

  const mixedStore = createMemoryPartnerDraftStore();
  const mixedAudit = createMemoryPartnerPublishAuditStore();
  const mixedMemory = createMemoryPartnerRuntimeApply({ store: mixedStore, audit: mixedAudit });
  const mixedCaptured = capturingApply(mixedMemory);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: mixedStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: mixedStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [
        { type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Mixed Sofa" },
        oakCreateMutation(catalog),
      ],
    },
  });
  const mixed = await publishPartnerPatchDraft({
    auth: authOk(),
    store: mixedStore,
    catalog: load,
    audit: mixedAudit,
    apply: mixedCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
  assert.equal(mixedCaptured.payloads[0]?.planVersion, 2);
  assert.ok(Array.isArray(mixedCaptured.payloads[0]?.productUpdates));
  assert.ok(Array.isArray(mixedCaptured.payloads[0]?.variantCreates));

  const noopStore = createMemoryPartnerDraftStore();
  const noopAudit = createMemoryPartnerPublishAuditStore();
  const noopCaptured = capturingApply(createMemoryPartnerRuntimeApply({ store: noopStore, audit: noopAudit }));
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: noopStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  const noop = await publishPartnerPatchDraft({
    auth: authOk(),
    store: noopStore,
    catalog: load,
    audit: noopAudit,
    apply: noopCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 1 },
  });
  assert.equal(noop.status, 200);
  assert.equal((noop.body as { status?: string }).status, "noop");
  assert.equal(noopCaptured.payloads[0]?.planVersion, 1);
});

test("PI-5G4a planner still owns duplicate identity/SKU; v2 SQL has race guards", () => {
  const { catalog } = certifiedScopedCatalog();
  const liveNatural = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [{
        variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Natural",
        sku: "DFC-SOFA-NEW",
        priceAmount: OAK_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  }, catalog);
  assert.equal(liveNatural.issues.some((issue) => issue.code === "DUPLICATE_VARIANT_ID"), true);

  const dupSku = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [{
        variantId: OAK_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Oak",
        sku: "DFC-SOFA-01",
        priceAmount: OAK_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  }, catalog);
  assert.equal(dupSku.issues.some((issue) => issue.code === "DUPLICATE_SKU"), true);

  const inactiveSku = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [{
        variantId: OAK_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Oak",
        sku: DEMO_COFFEE_TABLE_WALNUT_SKU,
        priceAmount: OAK_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  }, catalog);
  assert.equal(inactiveSku.issues.some((issue) => issue.code === "DUPLICATE_SKU"), true);

  const caseSku = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [{
        variantId: OAK_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Oak",
        sku: "dfc-sofa-01",
        priceAmount: OAK_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  }, catalog);
  assert.equal(caseSku.ok, true, JSON.stringify(caseSku.issues));

  const sql = source(G4A_SQL);
  assert.match(sql, /variants\.variant_id is distinct from v_variant_id/);
  assert.match(sql, /products\.partner_id = v_partner_id/);
  assert.doesNotMatch(sql, /variants\.status = 'active'/);
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /supabase\.rpc\(STAGE_PARTNER_APPLY_RPC_V2/);
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /supabase\.rpc\(STAGE_PARTNER_APPLY_RPC/);
});

test("PI-5G4a Node paths do not DML commercial, Asset, or Scene tables", () => {
  const joined = PI5G4A_FILES.map((file) => source(file)).join("\n");
  for (const file of [
    "lib/vibode-stage/partner-catalog-publish.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.server.ts",
    "lib/vibode-stage/partner-draft-mutations.ts",
    "lib/vibode-stage/partner-portal-assets.ts",
    "app/api/vibode/partner/drafts/[draftId]/publish/route.ts",
    "app/partner/catalog/drafts/[draftId]/page.tsx",
  ]) {
    const text = source(file);
    assert.doesNotMatch(text, /\.from\("vibode_stage_products"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_variants"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_collections"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_product_collections"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_assets"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_3d_scenes"\)/);
    assert.doesNotMatch(text, /writeFileAtomic|writeGeneratedFurnitureAssetRegistry/);
  }
  assert.match(source("package.json"), /test:afc-v2-pi5g4a/);
  assert.match(joined, /Portal tenancy enforcement/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-runtime-executor.ts"), /PARTNER_RUNTIME_PLAN_VERSION_2|planVersion: 2/);
});
