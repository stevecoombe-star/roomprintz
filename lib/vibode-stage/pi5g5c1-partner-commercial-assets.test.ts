import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { addSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import { validateTargetAsset } from "./product-variant-register";
import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import {
  partnerSlugFromPartnerId,
  productIdForCreate,
  variantIdForCreate,
} from "./partner-catalog-ids";
import {
  createMemoryPartnerRuntimeApply,
  httpStatusForPublishErrorCode,
  merchantMessageForPublishErrorCode,
  publishPartnerPatchDraft,
  STAGE_PARTNER_APPLY_RPC,
  STAGE_PARTNER_APPLY_RPC_V2,
  STAGE_PARTNER_APPLY_RPC_V3,
  STAGE_PARTNER_APPLY_RPC_V4,
  STAGE_PARTNER_APPLY_RPC_V5,
  type PartnerRuntimeApplyFn,
} from "./partner-catalog-publish";
import { PARTNER_RUNTIME_PLAN_VERSION } from "./partner-catalog-runtime-executor";
import { PARTNER_RUNTIME_PLAN_VERSION_2 } from "./partner-catalog-runtime-executor-v2";
import { PARTNER_RUNTIME_PLAN_VERSION_3 } from "./partner-catalog-runtime-executor-v3";
import { PARTNER_RUNTIME_PLAN_VERSION_4 } from "./partner-catalog-runtime-executor-v4";
import {
  PARTNER_RUNTIME_PLAN_VERSION_5,
  partnerRuntimePlanNeedsV5,
  partnerRuntimePlanVersionFor,
  persistableRuntimeApplyPayloadV5,
  toRuntimeApplyPayloadV5,
} from "./partner-catalog-runtime-executor-v5";
import {
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
  planPartnerCatalogSync,
} from "./partner-catalog-sync";
import {
  durableAssetCatalogForPlanning,
  foldedPartnerStateFromDurableCatalog,
} from "./partner-catalog-live-state";
import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import {
  assertPartnerCommercialAssetEligible,
  collectAssetIdsFromUnknownPatch,
  commercialEligibilityInputFromContext,
  createPartnerCommercialEligibilityContext,
  evaluatePartnerCommercialAssetEligibility,
  evaluatePartnerPublishAssetGate,
  isPartnerCommercialAssetEligible,
  listPartnerCommercialAssets,
  partnerCommercialAssetKindLabel,
  partnerCommercialPickerSelection,
  pickerDtoLeakKeys,
  type PartnerCommercialEligibilityContext,
} from "./partner-commercial-assets";
import {
  applyPartnerDraftMutation,
  applyPartnerDraftMutations,
  extraCommercialAssetIdsForDraft,
} from "./partner-draft-mutations";
import { presentPartnerDraftPreview } from "./partner-draft-preview-view";
import {
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
} from "./partner-portal-auth";
import { partnerCatalogFromDurableSnapshot } from "./partner-portal-catalog";
import { isPartnerReadyAssetId } from "./partner-portal-assets";
import {
  createMemoryPartnerDraftStore,
  getOrCreatePartnerPatchDraft,
  mutatePartnerDraft,
  type PartnerPortalDraftDto,
} from "./partner-portal-drafts";
import { createMemoryPartnerPublishAuditStore } from "./partner-publish-audit";
import type { PartnerCatalogSyncPlan } from "./partner-catalog-sync-types";
import type { StageAsset, StageCatalogSnapshot, StagePartner } from "./types";

const ROOT = process.cwd();
const G3_SQL = "supabase/migrations/20260917010000_vibode_stage_partner_publish.sql";
const G4A_SQL = "supabase/migrations/20260917120000_vibode_stage_partner_variant_create.sql";
const G4B_SQL = "supabase/migrations/20260917180000_vibode_stage_partner_product_create.sql";
const G4C_SQL = "supabase/migrations/20260917220000_vibode_stage_partner_collection_create.sql";
const G5C1_SQL = "supabase/migrations/20260920100000_vibode_stage_partner_patch_v5.sql";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYNAMIC_ID = "vibode-stage/partner-intake/f9c22d42-c447-4506-aac6-85a219a8a7fc";
const CURATED_ID = "afc-v2-runtime/test-fixtures/pi5d-lounge-chair";
const CHAIR_NAME = "G5C1 Chair";
const CHAIR_PRODUCT_ID = "prod-demo-furniture-co-g5c1-chair";
const CHAIR_VARIANT_ID = "var-demo-furniture-co-g5c1-chair-natural";
const CHAIR_SKU = "DFC-G5C1-CHAIR-01";
const EXTRA_SKU = "DFC-G5C1-SOFA-OAK";
const EXTRA_VARIANT_ID = "var-demo-furniture-co-demo-sofa-g5c1oak";
const CHAIR_IMAGE = "https://example.test/images/g5c1-chair.jpg";
const CHAIR_URL = "https://example.test/products/g5c1-chair";
const SHOWROOM_NAME = "G5C1 Showroom";
const SHOWROOM_ID = "col-demo-furniture-co-g5c1-showroom";

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

function sofaAssetId(catalog: StageCatalogSnapshot): string {
  const variant = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(variant?.assetId);
  return variant.assetId;
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

function dynamicAsset(status: StageAsset["status"] = "ready"): StageAsset {
  return {
    assetId: DYNAMIC_ID,
    glbUrl: `/api/vibode/assets/${DYNAMIC_ID}/glb`,
    authoredWidthM: 1.2,
    authoredHeightM: 0.74,
    authoredDepthM: 0.9,
    status,
  };
}

function mappingsFor(
  partnerId: string,
  rows: ReadonlyArray<{ assetId: string; intakeId?: string | null }>,
) {
  return rows.map((row) => ({
    partnerId,
    assetId: row.assetId,
    intakeId: row.intakeId ?? null,
  }));
}

function commercialContext(input: Readonly<{
  partnerId?: string;
  catalog: StageCatalogSnapshot;
  extraAssets?: readonly StageAsset[];
  extraMappings?: ReadonlyArray<{ partnerId: string; assetId: string; intakeId?: string | null }>;
  fileNames?: Readonly<Record<string, string | null>>;
  omitBackfill?: boolean;
}>): PartnerCommercialEligibilityContext {
  const partnerId = input.partnerId ?? DEMO_FURNITURE_PARTNER_ID;
  const backfill = input.omitBackfill ? [] : input.catalog.variants.flatMap((variant) => {
    const product = input.catalog.products.find((item) => item.productId === variant.productId);
    if (!product || product.partnerId !== partnerId || !variant.assetId) return [];
    return [{ partnerId, assetId: variant.assetId, intakeId: null as string | null }];
  });
  return createPartnerCommercialEligibilityContext({
    partnerId,
    mappings: [...backfill, ...(input.extraMappings ?? [])],
    assets: [...input.catalog.assets, ...(input.extraAssets ?? [])],
    originalFileNames: input.fileNames,
  });
}

function emptyPatch() {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch" as const,
    products: { create: [], update: [], deactivate: [], reactivate: [] },
    variants: { create: [], update: [], deactivate: [], reactivate: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  };
}

function productCreateDoc(catalog: StageCatalogSnapshot, assetId: string, extra: Record<string, unknown> = {}) {
  return {
    ...emptyPatch(),
    products: {
      create: [{
        productId: CHAIR_PRODUCT_ID,
        name: CHAIR_NAME,
        imageUrl: CHAIR_IMAGE,
        productUrl: CHAIR_URL,
        priceAmount: 199,
        priceCurrency: "USD",
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariantId: CHAIR_VARIANT_ID,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    variants: {
      create: [{
        variantId: CHAIR_VARIANT_ID,
        productId: CHAIR_PRODUCT_ID,
        finishLabel: "Natural",
        sku: CHAIR_SKU,
        priceAmount: 199,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: assetId,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    ...extra,
  };
}

function variantCreateDoc(catalog: StageCatalogSnapshot, assetId: string) {
  return {
    ...emptyPatch(),
    variants: {
      create: [{
        variantId: EXTRA_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "G5C1 Oak",
        sku: EXTRA_SKU,
        priceAmount: 1299,
        priceCurrency: catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.priceCurrency ?? "USD",
        productUrl: null,
        currentAssetId: assetId,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
  };
}

function planDocument(
  document: unknown,
  catalog: StageCatalogSnapshot,
  commercialEligibility?: PartnerCommercialEligibilityContext,
): PartnerCatalogSyncPlan {
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
    commercialEligibility,
  });
}

function capturingApply(inner: PartnerRuntimeApplyFn) {
  const payloads: Record<string, unknown>[] = [];
  const apply: PartnerRuntimeApplyFn = async (payload) => {
    payloads.push(payload);
    return inner(payload);
  };
  return { apply, payloads };
}

test("PI-5G5C1 v5 RPC exists beside frozen v1-v4 with mapping-ready Asset gate", () => {
  const v1 = source(G3_SQL);
  const v2 = source(G4A_SQL);
  const v3 = source(G4B_SQL);
  const v4 = source(G4C_SQL);
  const v5 = source(G5C1_SQL);
  assert.match(v1, /create or replace function public\.vibode_stage_apply_partner_patch\(p_apply jsonb\)/);
  assert.match(v2, /create or replace function public\.vibode_stage_apply_partner_patch_v2\(p_apply jsonb\)/);
  assert.match(v3, /create or replace function public\.vibode_stage_apply_partner_patch_v3\(p_apply jsonb\)/);
  assert.match(v4, /create or replace function public\.vibode_stage_apply_partner_patch_v4\(p_apply jsonb\)/);
  assert.doesNotMatch(v1, /vibode_stage_apply_partner_patch_v5/);
  assert.doesNotMatch(v2, /vibode_stage_apply_partner_patch_v5/);
  assert.doesNotMatch(v3, /vibode_stage_apply_partner_patch_v5/);
  assert.doesNotMatch(v4, /vibode_stage_apply_partner_patch_v5/);
  assert.match(v5, /create or replace function public\.vibode_stage_apply_partner_patch_v5\(p_apply jsonb\)/);
  assert.match(v5, /\(p_apply->>'planVersion'\)::integer <> 5/);
  assert.match(v5, /security definer/i);
  assert.match(v5, /set search_path = public/);
  assert.match(v5, /revoke all on function public\.vibode_stage_apply_partner_patch_v5\(jsonb\)/);
  assert.match(v5, /from public, anon, authenticated/);
  assert.match(v5, /grant execute on function public\.vibode_stage_apply_partner_patch_v5\(jsonb\)\s+to service_role/);
  assert.match(v5, /VIBODE_STAGE_PUBLISH:ASSET_NOT_READY/);
  assert.match(v5, /VIBODE_STAGE_PUBLISH:PARTNER_ASSET_UNMAPPED/);
  assert.match(v5, /VIBODE_STAGE_PUBLISH:PARTNER_ASSET_NOT_FOUND/);
  assert.doesNotMatch(v5, /PARTNER_ASSET_UNASSOCIATED/);
  assert.doesNotMatch(v5, /variants\.current_asset_id = v_asset_id/);
  assert.match(v5, /from public\.vibode_stage_partner_assets mappings/);
  assert.match(v5, /insert into public\.vibode_stage_products/);
  assert.match(v5, /insert into public\.vibode_stage_variants/);
  assert.match(v5, /insert into public\.vibode_stage_collections/);
  assert.doesNotMatch(v5, /set current_asset_id/);
  assert.doesNotMatch(v5, /insert into public\.vibode_stage_assets/);
  assert.doesNotMatch(v5, /update public\.vibode_stage_assets/);
  assert.doesNotMatch(v5, /insert into public\.vibode_stage_partner_assets/);
  assert.doesNotMatch(v5, /update public\.vibode_stage_partner_assets/);
  assert.doesNotMatch(v5, /EXECUTE\s+format/i);
  assert.doesNotMatch(v5, /vibode_3d_scenes|objects_json|scene_objects/);
  const assetCheck = v5.indexOf("VIBODE_STAGE_PUBLISH:PARTNER_ASSET_UNMAPPED");
  const variantInsert = v5.indexOf("insert into public.vibode_stage_variants");
  assert.ok(assetCheck >= 0 && assetCheck < variantInsert);
  assert.equal(STAGE_PARTNER_APPLY_RPC, "vibode_stage_apply_partner_patch");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V2, "vibode_stage_apply_partner_patch_v2");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V3, "vibode_stage_apply_partner_patch_v3");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V4, "vibode_stage_apply_partner_patch_v4");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V5, "vibode_stage_apply_partner_patch_v5");
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION, 1);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_2, 2);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_3, 3);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_4, 4);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_5, 5);
  assert.equal(httpStatusForPublishErrorCode("PARTNER_ASSET_UNMAPPED"), 409);
  assert.match(merchantMessageForPublishErrorCode("PARTNER_ASSET_UNMAPPED"), /asset/i);
});

test("PI-5G5C1 commercial eligibility is mapping + ready, independent of registry and origin", () => {
  const { catalog } = certifiedScopedCatalog();
  const sofaId = sofaAssetId(catalog);
  const sofa = catalog.assets.find((item) => item.assetId === sofaId);
  assert.ok(sofa);
  const mappedReady = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "f9c22d42-c447-4506-aac6-85a219a8a7fc" }]),
    assets: [dynamicAsset("ready")],
    originalFileName: "chair.glb",
  });
  assert.equal(mappedReady.ok, true);
  if (mappedReady.ok) {
    assert.equal(mappedReady.record.origin, "partner_intake");
    assert.equal(mappedReady.record.status, "ready");
  }

  const unavailable = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "intake" }]),
    assets: [dynamicAsset("unavailable")],
  });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, "PARTNER_ASSET_NOT_READY");

  const unmappedReady = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: [],
    assets: [dynamicAsset("ready")],
  });
  assert.equal(unmappedReady.ok, false);
  if (!unmappedReady.ok) assert.equal(unmappedReady.code, "PARTNER_ASSET_UNMAPPED");

  const staticMapped = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: sofaId,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: sofaId }]),
    assets: [sofa],
  });
  assert.equal(staticMapped.ok, true);
  if (staticMapped.ok) assert.equal(staticMapped.record.origin, "catalog_linked");

  const curated = catalog.assets.find((item) => item.assetId === CURATED_ID) ?? {
    assetId: CURATED_ID,
    glbUrl: "/curated.glb",
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
    status: "ready" as const,
  };
  const curatedUnmapped = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: CURATED_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: sofaId }]),
    assets: [curated, sofa],
  });
  assert.equal(curatedUnmapped.ok, false);
  if (!curatedUnmapped.ok) assert.equal(curatedUnmapped.code, "PARTNER_ASSET_UNMAPPED");

  assert.equal(isPartnerCommercialAssetEligible({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: mappingsFor(OTHER_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
    assets: [dynamicAsset()],
  }), false);

  const shared = mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }])
    .concat(mappingsFor(OTHER_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]));
  assert.equal(isPartnerCommercialAssetEligible({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: shared,
    assets: [dynamicAsset()],
  }), true);
  assert.equal(isPartnerCommercialAssetEligible({
    partnerId: OTHER_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: shared,
    assets: [dynamicAsset()],
  }), true);

  const badDims = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
    assets: [{ ...dynamicAsset(), authoredWidthM: 0 }],
  });
  assert.equal(badDims.ok, false);
  if (!badDims.ok) assert.equal(badDims.code, "PARTNER_ASSET_INVALID_DIMENSIONS");

  const originIrrelevant = evaluatePartnerCommercialAssetEligibility({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: null }]),
    assets: [dynamicAsset()],
  });
  assert.equal(originIrrelevant.ok, true);
  if (originIrrelevant.ok) assert.equal(originIrrelevant.record.origin, "catalog_linked");

  const errors: { code: string; message: string }[] = [];
  validateTargetAsset(DYNAMIC_ID, { catalog }, errors);
  assert.ok(errors.length > 0);
  assert.equal(errors.some((item) => item.code === "UNKNOWN_ASSET" || item.code === "RUNTIME_MISSING_ASSET"), true);
});

test("PI-5G5C1 picker lists mapped ready Assets and preserves stale selected IDs", () => {
  const { catalog } = certifiedScopedCatalog();
  const sofaId = sofaAssetId(catalog);
  const options = listPartnerCommercialAssets({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [
      { assetId: DYNAMIC_ID, intakeId: "f9c22d42-c447-4506-aac6-85a219a8a7fc" },
      { assetId: sofaId },
    ]),
    assets: [...catalog.assets, dynamicAsset()],
    originalFileNames: { [DYNAMIC_ID]: "uploaded-chair.glb" },
    products: catalog.products,
    variants: catalog.variants,
  });
  assert.equal(options.some((item) => item.assetId === DYNAMIC_ID), true);
  assert.equal(options.some((item) => item.assetId === sofaId), true);
  const uploaded = options.find((item) => item.assetId === DYNAMIC_ID);
  assert.equal(uploaded?.label, "uploaded-chair.glb");
  assert.equal(partnerCommercialAssetKindLabel(uploaded!.origin), "Uploaded Asset");
  const legacy = options.find((item) => item.assetId === sofaId);
  assert.equal(partnerCommercialAssetKindLabel(legacy!.origin), "Existing Catalog Asset");
  assert.ok((legacy?.referencedBy ?? 0) > 0);

  const excluded = listPartnerCommercialAssets({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [
      { assetId: DYNAMIC_ID, intakeId: "x" },
      { assetId: sofaId },
    ]),
    assets: [...catalog.assets, dynamicAsset("unavailable")],
  });
  assert.equal(excluded.some((item) => item.assetId === DYNAMIC_ID), false);

  const unmapped = listPartnerCommercialAssets({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: sofaId }]),
    assets: [...catalog.assets, dynamicAsset()],
  });
  assert.equal(unmapped.some((item) => item.assetId === DYNAMIC_ID), false);

  const serialized = JSON.stringify(options);
  for (const key of pickerDtoLeakKeys()) {
    assert.equal(serialized.includes(key), false, key);
  }

  const stale = partnerCommercialPickerSelection({ options, selectedAssetId: "missing-asset" });
  assert.equal(stale.invalid, true);
  assert.equal(stale.selectedAssetId, "missing-asset");
  assert.equal(isPartnerReadyAssetId(catalog, DYNAMIC_ID), false);
});

test("PI-5G5C1 planner accepts mapped ready dynamic Assets and rejects forged, unavailable, foreign, and retarget", () => {
  const { catalog } = certifiedScopedCatalog();
  const sofaId = sofaAssetId(catalog);
  const mapped = commercialContext({
    catalog,
    extraAssets: [dynamicAsset()],
    extraMappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
    fileNames: { [DYNAMIC_ID]: "uploaded-chair.glb" },
  });

  const productPlan = planDocument(productCreateDoc(catalog, DYNAMIC_ID), catalog, mapped);
  assert.equal(productPlan.ok, true, JSON.stringify(productPlan.issues));
  assert.equal(productPlan.productCreates[0]?.product.productId, CHAIR_PRODUCT_ID);
  assert.equal(productPlan.variantCreates[0]?.variant.assetId, DYNAMIC_ID);
  assert.equal(partnerRuntimePlanNeedsV5(productPlan), true);
  assert.equal(partnerRuntimePlanVersionFor(productPlan), 5);

  const variantPlan = planDocument(variantCreateDoc(catalog, DYNAMIC_ID), catalog, mapped);
  assert.equal(variantPlan.ok, true, JSON.stringify(variantPlan.issues));
  assert.equal(variantPlan.variantCreates[0]?.variant.assetId, DYNAMIC_ID);
  assert.equal(partnerRuntimePlanVersionFor(variantPlan), 5);

  const forged = planDocument(productCreateDoc(catalog, DYNAMIC_ID), catalog, commercialContext({
    catalog,
    extraAssets: [dynamicAsset()],
    omitBackfill: false,
  }));
  assert.equal(forged.ok, false);
  assert.equal(forged.issues.some((issue) => issue.code === "PARTNER_ASSET_UNMAPPED"), true);

  const unavailable = planDocument(productCreateDoc(catalog, DYNAMIC_ID), catalog, commercialContext({
    catalog,
    extraAssets: [dynamicAsset("unavailable")],
    extraMappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
  }));
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.issues.some((issue) => issue.code === "PARTNER_ASSET_NOT_READY"), true);

  const foreign = planDocument(productCreateDoc(catalog, DYNAMIC_ID), catalog, commercialContext({
    catalog,
    extraAssets: [dynamicAsset()],
    extraMappings: mappingsFor(OTHER_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
  }));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.issues.some((issue) => (
    issue.code === "PARTNER_ASSET_UNMAPPED" || issue.code === "PARTNER_ASSET_NOT_FOUND"
  )), true);

  const retarget = planDocument({
    ...emptyPatch(),
    variants: {
      create: [],
      update: [{ variantId: DEMO_SOFA_DEFAULT_VARIANT_ID, currentAssetId: DYNAMIC_ID }],
      deactivate: [],
      reactivate: [],
    },
  }, catalog, mapped);
  assert.equal(retarget.issues.some((issue) => issue.code === "ASSET_RETARGET_REQUIRED"), true);

  const inactive = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(inactive);
  const reactivateOk = planDocument({
    ...emptyPatch(),
    variants: {
      create: [],
      update: [],
      deactivate: [],
      reactivate: [{ variantId: DEMO_SOFA_DEFAULT_VARIANT_ID }],
    },
  }, cloneCatalog(catalog, {
    variants: catalog.variants.map((item) => (
      item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID ? { ...item, status: "inactive" } : item
    )),
  }), commercialContext({ catalog, extraAssets: [dynamicAsset()] }));
  assert.equal(reactivateOk.ok, true, JSON.stringify(reactivateOk.issues));

  const reactivateBad = planDocument({
    ...emptyPatch(),
    variants: {
      create: [],
      update: [],
      deactivate: [],
      reactivate: [{ variantId: DEMO_SOFA_DEFAULT_VARIANT_ID }],
    },
  }, cloneCatalog(catalog, {
    variants: catalog.variants.map((item) => (
      item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID
        ? { ...item, status: "inactive", assetId: DYNAMIC_ID }
        : item
    )),
    assets: [...catalog.assets, dynamicAsset("unavailable")],
  }), commercialContext({
    catalog,
    extraAssets: [dynamicAsset("unavailable")],
    extraMappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
  }));
  assert.equal(reactivateBad.ok, false);
  assert.equal(reactivateBad.issues.some((issue) => (
    issue.code === "PARTNER_ASSET_NOT_READY" || issue.code === "UNAVAILABLE_ASSET"
  )), true);

  const staticCreate = planDocument(productCreateDoc(catalog, sofaId), catalog, commercialContext({ catalog }));
  assert.equal(staticCreate.ok, true, JSON.stringify(staticCreate.issues));
  assert.equal(partnerRuntimePlanVersionFor(staticCreate), 5);
});

test("PI-5G5C1 routing sends Product/Variant creates through v5, collection-only v4, update-only v1", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const sofaId = sofaAssetId(catalog);
  const mapped = commercialContext({
    catalog,
    extraAssets: [dynamicAsset()],
    extraMappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
  });

  const productPlan = planDocument(productCreateDoc(catalog, DYNAMIC_ID), catalog, mapped);
  const productPayload = toRuntimeApplyPayloadV5(productPlan);
  assert.equal(productPayload.ok, true);
  if (productPayload.ok) {
    assert.equal(productPayload.payload.planVersion, 5);
    assert.equal(productPayload.payload.variantCreates[0]?.currentAssetId, DYNAMIC_ID);
    const persistable = persistableRuntimeApplyPayloadV5(productPayload.payload);
    assert.equal(persistable.planVersion, 5);
    assert.equal("origin" in persistable, false);
    assert.equal(JSON.stringify(persistable).includes("signedUrl"), false);
  }

  const variantPlan = planDocument(variantCreateDoc(catalog, DYNAMIC_ID), catalog, mapped);
  assert.equal(toRuntimeApplyPayloadV5(variantPlan).ok, true);

  const mixedProductCollection = planDocument({
    ...productCreateDoc(catalog, DYNAMIC_ID),
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [{ productId: CHAIR_PRODUCT_ID, collectionId: SHOWROOM_ID }],
      membershipRemove: [],
    },
  }, catalog, mapped);
  assert.equal(mixedProductCollection.ok, true, JSON.stringify(mixedProductCollection.issues));
  assert.equal(partnerRuntimePlanVersionFor(mixedProductCollection), 5);
  const mixedPayload = toRuntimeApplyPayloadV5(mixedProductCollection);
  assert.equal(mixedPayload.ok, true);
  if (mixedPayload.ok) {
    assert.equal(mixedPayload.payload.collectionCreates[0]?.collectionId, SHOWROOM_ID);
    assert.equal(mixedPayload.payload.productCreates[0]?.productId, CHAIR_PRODUCT_ID);
  }

  const mixedVariantCollection = planDocument({
    ...variantCreateDoc(catalog, DYNAMIC_ID),
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [],
      membershipRemove: [],
    },
  }, catalog, mapped);
  assert.equal(partnerRuntimePlanVersionFor(mixedVariantCollection), 5);

  const collectionOnly = planDocument({
    ...emptyPatch(),
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [],
      membershipRemove: [],
    },
  }, catalog, mapped);
  assert.equal(partnerRuntimePlanNeedsV5(collectionOnly), false);
  assert.equal(partnerRuntimePlanVersionFor(collectionOnly), 4);

  const updateStore = createMemoryPartnerDraftStore();
  const updateAudit = createMemoryPartnerPublishAuditStore();
  const captured = capturingApply(createMemoryPartnerRuntimeApply({ store: updateStore, audit: updateAudit }));
  await getOrCreatePartnerPatchDraft({ auth: authOk(), store: updateStore, catalog: load, draftId: DRAFT_A });
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
    commercialEligibility: mapped,
  });
  assert.equal(updateOnly.status, 200, JSON.stringify(updateOnly.body));
  assert.equal(captured.payloads[0]?.planVersion, 1);

  const productStore = createMemoryPartnerDraftStore();
  const productAudit = createMemoryPartnerPublishAuditStore();
  const productCaptured = capturingApply(createMemoryPartnerRuntimeApply({ store: productStore, audit: productAudit }));
  await getOrCreatePartnerPatchDraft({ auth: authOk(), store: productStore, catalog: load, draftId: DRAFT_A });
  const created = await mutatePartnerDraft({
    auth: authOk(),
    store: productStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{
        type: "product.create",
        name: CHAIR_NAME,
        imageUrl: CHAIR_IMAGE,
        productUrl: CHAIR_URL,
        priceAmount: 199,
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariant: {
          finishLabel: "Natural",
          sku: CHAIR_SKU,
          productUrl: null,
          currentAssetId: DYNAMIC_ID,
        },
      }],
    },
    commercialAssetIds: new Set([DYNAMIC_ID, sofaId]),
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store: productStore,
    catalog: load,
    audit: productAudit,
    apply: productCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    commercialEligibility: mapped,
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(productCaptured.payloads[0]?.planVersion, 5);
  assert.equal((productCaptured.payloads[0]?.variantCreates as { currentAssetId?: string }[])?.[0]?.currentAssetId, DYNAMIC_ID);

  const variantStore = createMemoryPartnerDraftStore();
  const variantAudit = createMemoryPartnerPublishAuditStore();
  const variantCaptured = capturingApply(createMemoryPartnerRuntimeApply({ store: variantStore, audit: variantAudit }));
  await getOrCreatePartnerPatchDraft({ auth: authOk(), store: variantStore, catalog: load, draftId: DRAFT_A });
  const extra = await mutatePartnerDraft({
    auth: authOk(),
    store: variantStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{
        type: "variant.create",
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "G5C1 Oak",
        sku: EXTRA_SKU,
        priceAmount: 1299,
        productUrl: null,
        currentAssetId: DYNAMIC_ID,
      }],
    },
    commercialAssetIds: new Set([DYNAMIC_ID, sofaId]),
  });
  assert.equal(extra.status, 200, JSON.stringify(extra.body));
  const extraPublished = await publishPartnerPatchDraft({
    auth: authOk(),
    store: variantStore,
    catalog: load,
    audit: variantAudit,
    apply: variantCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    commercialEligibility: mapped,
  });
  assert.equal(extraPublished.status, 200, JSON.stringify(extraPublished.body));
  assert.equal(variantCaptured.payloads[0]?.planVersion, 5);

  const collectionStore = createMemoryPartnerDraftStore();
  const collectionAudit = createMemoryPartnerPublishAuditStore();
  const collectionCaptured = capturingApply(createMemoryPartnerRuntimeApply({
    store: collectionStore,
    audit: collectionAudit,
  }));
  await getOrCreatePartnerPatchDraft({ auth: authOk(), store: collectionStore, catalog: load, draftId: DRAFT_A });
  await mutatePartnerDraft({
    auth: authOk(),
    store: collectionStore,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 1, mutations: [{ type: "collection.create", name: SHOWROOM_NAME }] },
  });
  const collectionOnlyPublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: collectionStore,
    catalog: load,
    audit: collectionAudit,
    apply: collectionCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    commercialEligibility: mapped,
  });
  assert.equal(collectionOnlyPublish.status, 200, JSON.stringify(collectionOnlyPublish.body));
  assert.equal(collectionCaptured.payloads[0]?.planVersion, 4);

  const staticStore = createMemoryPartnerDraftStore();
  const staticAudit = createMemoryPartnerPublishAuditStore();
  const staticCaptured = capturingApply(createMemoryPartnerRuntimeApply({ store: staticStore, audit: staticAudit }));
  await getOrCreatePartnerPatchDraft({ auth: authOk(), store: staticStore, catalog: load, draftId: DRAFT_A });
  const staticCreated = await mutatePartnerDraft({
    auth: authOk(),
    store: staticStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{
        type: "product.create",
        name: CHAIR_NAME,
        imageUrl: CHAIR_IMAGE,
        productUrl: CHAIR_URL,
        priceAmount: 199,
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariant: {
          finishLabel: "Natural",
          sku: "DFC-G5C1-STATIC-01",
          productUrl: null,
          currentAssetId: sofaId,
        },
      }],
    },
    commercialAssetIds: new Set([sofaId]),
  });
  assert.equal(staticCreated.status, 200, JSON.stringify(staticCreated.body));
  const staticPublished = await publishPartnerPatchDraft({
    auth: authOk(),
    store: staticStore,
    catalog: load,
    audit: staticAudit,
    apply: staticCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    commercialEligibility: commercialContext({ catalog }),
  });
  assert.equal(staticPublished.status, 200, JSON.stringify(staticPublished.body));
  assert.equal(staticCaptured.payloads[0]?.planVersion, 5);
  assert.equal((staticCaptured.payloads[0]?.variantCreates as { currentAssetId?: string }[])?.[0]?.currentAssetId, sofaId);
});

test("PI-5G5C1 preview/publish stale guards and transactional TOCTOU reject without partial rows", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const mapped = commercialContext({
    catalog,
    extraAssets: [dynamicAsset()],
    extraMappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
  });
  const previewOk = previewPartnerCatalogFromDurable({
    catalog,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: productCreateDoc(catalog, DYNAMIC_ID),
    commercialEligibility: mapped,
  });
  assert.equal(previewOk.kind, "preview");
  assert.equal(previewOk.dto.ok, true);
  assert.equal(previewOk.dto.planVersion, 5);
  assert.equal(previewOk.dto.variantCreates[0]?.variant.assetId, DYNAMIC_ID);
  const view = presentPartnerDraftPreview(previewOk.dto);
  assert.equal("error" in view, false);
  if (!("error" in view)) {
    assert.equal(view.planVersion, 5);
    assert.equal(view.variantCreates[0]?.currentAssetId, DYNAMIC_ID);
  }

  const stalePreview = previewPartnerCatalogFromDurable({
    catalog,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: productCreateDoc(catalog, DYNAMIC_ID),
    commercialEligibility: commercialContext({
      catalog,
      extraAssets: [dynamicAsset("unavailable")],
      extraMappings: mappingsFor(DEMO_FURNITURE_PARTNER_ID, [{ assetId: DYNAMIC_ID, intakeId: "x" }]),
    }),
  });
  assert.equal(stalePreview.dto.ok, false);
  assert.equal(stalePreview.dto.issues.some((issue) => issue.code === "PARTNER_ASSET_NOT_READY"), true);
  assert.match(stalePreview.dto.issues[0]?.message ?? "", new RegExp(DYNAMIC_ID));

  const missingMap = previewPartnerCatalogFromDurable({
    catalog,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: productCreateDoc(catalog, DYNAMIC_ID),
    commercialEligibility: commercialContext({ catalog, extraAssets: [dynamicAsset()] }),
  });
  assert.equal(missingMap.dto.ok, false);
  assert.equal(missingMap.dto.issues.some((issue) => issue.code === "PARTNER_ASSET_UNMAPPED"), true);

  const store = createMemoryPartnerDraftStore();
  const audit = createMemoryPartnerPublishAuditStore();
  await getOrCreatePartnerPatchDraft({ auth: authOk(), store, catalog: load, draftId: DRAFT_A });
  const saved = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{
        type: "product.create",
        name: CHAIR_NAME,
        imageUrl: CHAIR_IMAGE,
        productUrl: CHAIR_URL,
        priceAmount: 199,
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariant: {
          finishLabel: "Natural",
          sku: CHAIR_SKU,
          productUrl: null,
          currentAssetId: DYNAMIC_ID,
        },
      }],
    },
    commercialAssetIds: new Set([DYNAMIC_ID, sofaAssetId(catalog)]),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const dto = (saved.body as { draft: PartnerPortalDraftDto }).draft;
  assert.equal(dto.document.variants.create[0]?.currentAssetId, DYNAMIC_ID);

  const rejectedUnavailable = await publishPartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    audit,
    apply: async () => ({ ok: false, errorCode: "ASSET_NOT_READY" }),
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    commercialEligibility: mapped,
  });
  assert.equal(rejectedUnavailable.status, 409);
  assert.equal((rejectedUnavailable.body as { code?: string }).code, "ASSET_NOT_READY");
  assert.equal(load.catalog.products.some((item) => item.productId === CHAIR_PRODUCT_ID), false);
  assert.equal(load.catalog.variants.some((item) => item.variantId === CHAIR_VARIANT_ID), false);

  const rejectedUnmapped = evaluatePartnerPublishAssetGate({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    asset: { assetId: DYNAMIC_ID, status: "ready" },
    mapped: false,
  });
  assert.equal(rejectedUnmapped.ok, false);
  if (!rejectedUnmapped.ok) assert.equal(rejectedUnmapped.code, "PARTNER_ASSET_UNMAPPED");
  const rejectedNotReady = evaluatePartnerPublishAssetGate({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    asset: { assetId: DYNAMIC_ID, status: "unavailable" },
    mapped: true,
  });
  assert.equal(rejectedNotReady.ok, false);
  if (!rejectedNotReady.ok) assert.equal(rejectedNotReady.code, "ASSET_NOT_READY");
  const rejectedMissing = evaluatePartnerPublishAssetGate({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    asset: null,
    mapped: true,
  });
  assert.equal(rejectedMissing.ok, false);
  if (!rejectedMissing.ok) assert.equal(rejectedMissing.code, "PARTNER_ASSET_NOT_FOUND");
  assert.equal(evaluatePartnerPublishAssetGate({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assetId: DYNAMIC_ID,
    asset: { assetId: DYNAMIC_ID, status: "ready" },
    mapped: true,
  }).ok, true);
});

test("PI-5G5C1 draft mutations use commercial options, preserve stale IDs, and keep SKU/currency/collection rules", () => {
  const { catalog } = certifiedScopedCatalog();
  const sofaId = sofaAssetId(catalog);
  const allowed = new Set([DYNAMIC_ID, sofaId]);
  const created = applyPartnerDraftMutation(
    {
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      mode: "patch",
      products: { create: [], update: [], deactivate: [], reactivate: [] },
      variants: { create: [], update: [], deactivate: [], reactivate: [] },
      collections: { update: [], membershipAdd: [], membershipRemove: [] },
    },
    catalog,
    {
      type: "product.create",
      name: CHAIR_NAME,
      imageUrl: CHAIR_IMAGE,
      productUrl: CHAIR_URL,
      priceAmount: 199,
      categoryId: "living-room",
      subcategoryId: "chairs",
      defaultVariant: {
        finishLabel: "Natural",
        sku: CHAIR_SKU,
        productUrl: null,
        currentAssetId: DYNAMIC_ID,
      },
    },
    DEMO_FURNITURE_PARTNER_ID,
    { commercialAssetIds: allowed },
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const createdProduct = created.document.products.create?.[0];
  assert.ok(createdProduct);
  assert.equal(created.document.variants.create[0]?.currentAssetId, DYNAMIC_ID);
  assert.equal(createdProduct.priceCurrency, catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID)?.priceCurrency);
  assert.equal(createdProduct.defaultVariantId, created.document.variants.create[0]?.variantId);

  const rejected = applyPartnerDraftMutation(
    created.document,
    catalog,
    {
      type: "variant.create",
      productId: DEMO_SOFA_PRODUCT_ID,
      finishLabel: "Nope",
      sku: "NOPE",
      priceAmount: 10,
      productUrl: null,
      currentAssetId: "forged-asset",
    },
    DEMO_FURNITURE_PARTNER_ID,
    { commercialAssetIds: allowed },
  );
  assert.equal(rejected.ok, false);

  const membership = applyPartnerDraftMutations(
    created.document,
    catalog,
    [{
      type: "collection.create",
      name: SHOWROOM_NAME,
    }, {
      type: "product.create_edit",
      productId: createdProduct.productId,
      collectionIds: [DEMO_LIVING_ROOM_COLLECTION_ID],
    }],
    DEMO_FURNITURE_PARTNER_ID,
    { commercialAssetIds: allowed },
  );
  assert.equal(membership.ok, true, JSON.stringify(membership));
  if (membership.ok) {
    assert.ok(membership.document.collections.create?.some((item) => item.name === SHOWROOM_NAME));
    assert.ok(membership.document.collections.membershipAdd.some((item) => (
      item.productId === createdProduct.productId
    )));
    assert.equal(extraCommercialAssetIdsForDraft(membership.document, catalog).includes(DYNAMIC_ID), true);
  }

  const liveRetarget = applyPartnerDraftMutation(
    created.document,
    catalog,
    {
      type: "variant.set_finish_label",
      variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
      finishLabel: "Still allowed",
    },
    DEMO_FURNITURE_PARTNER_ID,
    { commercialAssetIds: allowed },
  );
  assert.equal(liveRetarget.ok, true);
  const forbidden = applyPartnerDraftMutations(
    created.document,
    catalog,
    [{
      type: "variant.set_sku",
      variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
      sku: "X",
    }],
    DEMO_FURNITURE_PARTNER_ID,
    { commercialAssetIds: allowed },
  );
  assert.equal(forbidden.ok, true);
  assert.equal(collectAssetIdsFromUnknownPatch(created.document).includes(DYNAMIC_ID), true);
});

test("PI-5G5C1 does not open customer add, runtime resolve, signed-URL mint, or D2B retarget", () => {
  const added = addSceneObject({
    objects: [],
    assetId: DYNAMIC_ID,
    createObjectId: () => "so-g5c1",
  });
  assert.equal(added.ok, false);
  if (!added.ok) assert.equal(added.reason, "unknown_asset");

  const sceneCrud = source("lib/afc-v2-runtime/scene-crud.ts");
  assert.doesNotMatch(sceneCrud, /partner-commercial-assets|planVersion: 5|PARTNER_ASSET_UNMAPPED/);
  const runtime = source("lib/vibode-stage/partner-runtime-assets.ts");
  assert.doesNotMatch(runtime, /listPartnerCommercialAssets|planVersion: 5/);
  const association = source("lib/vibode-stage/variant-asset-association.ts");
  assert.doesNotMatch(association, /planVersion: 5|listPartnerCommercialAssets/);
  const register = source("lib/vibode-stage/product-variant-register.ts");
  assert.match(register, /export function validateTargetAsset/);
  assert.match(register, /assertTargetAsset/);
  const page = source("app/partner/catalog/drafts/[draftId]/page.tsx");
  assert.match(page, /commercialAssetOptions/);
  assert.doesNotMatch(page, /listPartnerReadyAssetsForVariantCreate/);
  assert.match(source("package.json"), /test:afc-v2-pi5g5c1/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-runtime-executor.ts"), /PARTNER_RUNTIME_PLAN_VERSION_5|planVersion: 5/);
  assert.doesNotMatch(source(G3_SQL), /vibode_stage_apply_partner_patch_v5/);
  assert.doesNotMatch(source(G4A_SQL), /vibode_stage_apply_partner_patch_v5/);
  assert.doesNotMatch(source(G4B_SQL), /vibode_stage_apply_partner_patch_v5/);
  assert.doesNotMatch(source(G4C_SQL), /vibode_stage_apply_partner_patch_v5/);
  const commercialAssets = source("lib/vibode-stage/partner-commercial-assets.ts");
  assert.doesNotMatch(commercialAssets, /from ["'].*product-variant-register|from ["'].*furniture-asset-manifest|from ["']node:fs["']|from ["']server-only["']/);
  const runtimeAssetId = source("lib/vibode-stage/partner-runtime-asset-id.ts");
  assert.doesNotMatch(runtimeAssetId, /from ["'].*product-variant-register|from ["'].*furniture-asset-manifest|from ["']node:fs["']|from ["']server-only["']/);
  const assetIdHelper = source("lib/vibode-stage/asset-id.ts");
  assert.doesNotMatch(assetIdHelper, /from ["'].*product-variant-register|from ["'].*furniture-asset-manifest|from ["']node:fs["']|from ["']server-only["']/);
  const client = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.doesNotMatch(client, /from ["'].*product-variant-register|from ["'].*furniture-asset-manifest|from ["']node:fs["']|from ["']server-only["']/);
  const customerRoute = source("app/api/vibode/assets/[...assetPath]/route.ts");
  assert.doesNotMatch(customerRoute, /createSignedUrl|mintPartnerRuntimeSignedGet/);
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /STAGE_PARTNER_APPLY_RPC_V5/);
  const slug = partnerSlugFromPartnerId(DEMO_FURNITURE_PARTNER_ID);
  assert.equal(productIdForCreate(slug!, "g5c1-chair"), CHAIR_PRODUCT_ID);
  assert.equal(variantIdForCreate(slug!, "g5c1-chair", "natural"), CHAIR_VARIANT_ID);
  const errors: { code: string; message: string }[] = [];
  assertPartnerCommercialAssetEligible(
    commercialEligibilityInputFromContext(
      createPartnerCommercialEligibilityContext({
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mappings: [],
        assets: [dynamicAsset()],
      }),
      DYNAMIC_ID,
    ),
    errors,
  );
  assert.equal(errors[0]?.code, "PARTNER_ASSET_UNMAPPED");
});
