import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PI5F2_COFFEE_TABLE_ASSET_ID } from "@/lib/afc-v2-runtime/pi5f2-demo-coffee-table-geometry";

import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import {
  partnerSlugFromPartnerId,
  productCreationSlugFor,
  productIdForCreate,
  variantIdForCreate,
} from "./partner-catalog-ids";
import {
  createMemoryPartnerRuntimeApply,
  publishPartnerPatchDraft,
  STAGE_PARTNER_APPLY_RPC,
  STAGE_PARTNER_APPLY_RPC_V2,
  STAGE_PARTNER_APPLY_RPC_V3,
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
  g4bUnsupportedPublishOperations,
  PARTNER_RUNTIME_PLAN_VERSION_3,
  partnerRuntimePlanNeedsV3,
  persistableRuntimeApplyPayloadV3,
  toRuntimeApplyPayloadV3,
} from "./partner-catalog-runtime-executor-v3";
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
  PARTNER_CATALOG_SNAPSHOT_SCOPE,
  planPartnerCatalogSnapshotSync,
  type PartnerCatalogSnapshotDocument,
  type PartnerCatalogSnapshotProductRecord,
} from "./partner-catalog-snapshot";
import {
  applyPartnerDraftMutation,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutation,
  partnerCatalogCurrencyForCreate,
} from "./partner-draft-mutations";
import {
  partnerDraftPreviewHasChanges,
  presentPartnerDraftPreview,
} from "./partner-draft-preview-view";
import { listPartnerReadyAssetsForVariantCreate } from "./partner-portal-assets";
import {
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
} from "./partner-portal-auth";
import { partnerCatalogFromDurableSnapshot } from "./partner-portal-catalog";
import {
  createMemoryPartnerDraftStore,
  getOrCreatePartnerPatchDraft,
  getPartnerDraft,
  mutatePartnerDraft,
  previewPersistedPartnerDraft,
  type PartnerPortalDraftDto,
} from "./partner-portal-drafts";
import { createMemoryPartnerPublishAuditStore } from "./partner-publish-audit";
import type { FoldedPartnerCatalogState, PartnerCatalogSyncPlan } from "./partner-catalog-sync-types";
import type { StageCatalogSnapshot, StageCollection, StagePartner, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const G3_SQL = "supabase/migrations/20260917010000_vibode_stage_partner_publish.sql";
const G4A_SQL = "supabase/migrations/20260917120000_vibode_stage_partner_variant_create.sql";
const G4B_SQL = "supabase/migrations/20260917180000_vibode_stage_partner_product_create.sql";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTTOMAN_NAME = "G4b Ottoman";
const OTTOMAN_SLUG = "g4b-ottoman";
const OTTOMAN_PRODUCT_ID = "prod-demo-furniture-co-g4b-ottoman";
const OTTOMAN_VARIANT_ID = "var-demo-furniture-co-g4b-ottoman-natural";
const OTTOMAN_SKU = "DFC-G4B-OTTOMAN-01";
const OTTOMAN_PRICE = 349;
const OTTOMAN_IMAGE = "https://example.test/images/g4b-ottoman.jpg";
const OTTOMAN_URL = "https://example.test/products/g4b-ottoman";
const FOREIGN_COLLECTION_ID = "col-other-furniture-co-showroom";

const PI5G4B_FILES = [
  G4B_SQL,
  "lib/vibode-stage/partner-catalog-ids.ts",
  "lib/vibode-stage/partner-catalog-sync.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v3.ts",
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
  return { mixed, catalog: loaded.catalog, load: loaded, folded: folded.state };
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

function ottomanCreateMutation(catalog: StageCatalogSnapshot, extra: Record<string, unknown> = {}) {
  return {
    type: "product.create" as const,
    name: OTTOMAN_NAME,
    imageUrl: OTTOMAN_IMAGE,
    productUrl: OTTOMAN_URL,
    priceAmount: OTTOMAN_PRICE,
    categoryId: "living-room",
    subcategoryId: "chairs",
    defaultVariant: {
      finishLabel: "Natural",
      sku: OTTOMAN_SKU,
      productUrl: null,
      currentAssetId: sofaAssetId(catalog),
    },
    ...extra,
  };
}

function ottomanPatch(catalog: StageCatalogSnapshot, extra: {
  product?: Record<string, unknown>;
  variant?: Record<string, unknown>;
  membershipAdd?: readonly { productId: string; collectionId: string }[];
  omitVariant?: boolean;
  omitProduct?: boolean;
} = {}) {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch" as const,
    products: {
      create: extra.omitProduct ? [] : [{
        productId: OTTOMAN_PRODUCT_ID,
        name: OTTOMAN_NAME,
        imageUrl: OTTOMAN_IMAGE,
        productUrl: OTTOMAN_URL,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariantId: OTTOMAN_VARIANT_ID,
        ...extra.product,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    variants: {
      create: extra.omitVariant ? [] : [{
        variantId: OTTOMAN_VARIANT_ID,
        productId: OTTOMAN_PRODUCT_ID,
        finishLabel: "Natural",
        sku: OTTOMAN_SKU,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
        ...extra.variant,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: {
      update: [],
      membershipAdd: extra.membershipAdd ?? [],
      membershipRemove: [],
    },
  };
}

function snapshotVariant(variant: StageVariant) {
  assert.ok(variant.priceAmount != null);
  return {
    variantId: variant.variantId,
    productId: variant.productId,
    finishLabel: variant.finishLabel,
    sku: variant.sku,
    priceAmount: variant.priceAmount,
    priceCurrency: variant.priceCurrency,
    productUrl: variant.productUrl,
    currentAssetId: variant.assetId ?? "",
  };
}

function snapshotFromCurrent(
  state: FoldedPartnerCatalogState,
  extra?: PartnerCatalogSnapshotProductRecord,
): PartnerCatalogSnapshotDocument {
  const partner = state.partners.find((item) => item.partnerId === DEMO_FURNITURE_PARTNER_ID);
  assert.ok(partner);
  const prefix = `col-${partner.slug}-`;
  const collections = state.collections
    .filter((item) => item.partnerId === partner.partnerId)
    .map((item) => ({
      collectionId: item.collectionId,
      name: item.name,
      slug: item.collectionId.startsWith(prefix) ? item.collectionId.slice(prefix.length) : item.collectionId,
    }));
  const products: PartnerCatalogSnapshotProductRecord[] = state.products
    .filter((item) => item.partnerId === partner.partnerId)
    .map((product) => {
      const variants = state.variants.filter((item) => item.productId === product.productId);
      const defaultVariant = variants.find((item) => item.variantId === product.defaultVariantId);
      assert.ok(defaultVariant);
      assert.ok(product.priceAmount != null);
      return {
        product: {
          productId: product.productId,
          name: product.name,
          brand: product.brand,
          retailer: product.retailer,
          categoryId: product.categoryId,
          subcategoryId: product.subcategoryId,
          imageUrl: product.imageUrl,
          productUrl: product.productUrl,
          priceAmount: product.priceAmount,
          priceCurrency: product.priceCurrency,
          source: product.source,
          partnerId: product.partnerId,
          collectionIds: [...product.collectionIds],
        },
        defaultVariant: snapshotVariant(defaultVariant),
        variants: variants
          .filter((item) => item.variantId !== defaultVariant.variantId)
          .map(snapshotVariant),
      };
    });
  if (extra) products.push(extra);
  return {
    partnerId: partner.partnerId,
    mode: "snapshot",
    scope: PARTNER_CATALOG_SNAPSHOT_SCOPE,
    partner: { status: partner.status },
    collections,
    products,
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
    const productCreates = Array.isArray(payload.productCreates) ? payload.productCreates : [];
    const variantCreates = Array.isArray(payload.variantCreates) ? payload.variantCreates : [];
    const membershipAdds = Array.isArray(payload.membershipAdds) ? payload.membershipAdds : [];
    const nextProducts: StageProduct[] = [...live.catalog.products];
    for (const raw of productCreates) {
      const create = raw as Record<string, unknown>;
      const productId = typeof create.productId === "string" ? create.productId : "";
      if (nextProducts.some((item) => item.productId === productId)) {
        return { ok: false, errorCode: "DUPLICATE_PRODUCT_ID" };
      }
      nextProducts.push({
        productId,
        name: String(create.name ?? ""),
        brand: String(create.brand ?? ""),
        retailer: String(create.retailer ?? ""),
        imageUrl: String(create.imageUrl ?? ""),
        productUrl: String(create.productUrl ?? ""),
        priceAmount: typeof create.priceAmount === "number" ? create.priceAmount : null,
        priceCurrency: String(create.priceCurrency ?? "USD"),
        categoryId: String(create.categoryId ?? ""),
        subcategoryId: typeof create.subcategoryId === "string" ? create.subcategoryId : null,
        source: "partner_catalog",
        partnerId: String(create.partnerId ?? ""),
        defaultVariantId: String(create.defaultVariantId ?? ""),
        collectionIds: [],
        status: "active",
      });
    }
    const nextVariants: StageVariant[] = [...live.catalog.variants];
    for (const raw of variantCreates) {
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
    const nextCollections = live.catalog.collections.map((item) => ({
      ...item,
      productIds: [...item.productIds],
    }));
    const productsForMembership = nextProducts.map((item) => ({
      ...item,
      collectionIds: [...item.collectionIds],
    }));
    for (const raw of membershipAdds) {
      const add = raw as Record<string, unknown>;
      const productId = String(add.productId ?? "");
      const collectionId = String(add.collectionId ?? "");
      const collection = nextCollections.find((item) => item.collectionId === collectionId);
      const product = productsForMembership.find((item) => item.productId === productId);
      if (!collection || collection.partnerId !== DEMO_FURNITURE_PARTNER_ID) {
        return { ok: false, errorCode: "COLLECTION_OWNER_MISMATCH" };
      }
      if (!product) return { ok: false, errorCode: "COLLECTION_OWNER_MISMATCH" };
      if (!collection.productIds.includes(productId)) {
        collection.productIds.push(productId);
      }
      if (!product.collectionIds.includes(collectionId)) {
        product.collectionIds.push(collectionId);
      }
    }
    live.catalog = cloneCatalog(live.catalog, {
      products: productsForMembership,
      variants: nextVariants,
      collections: nextCollections,
    });
    return result;
  };
}

async function openOttomanDraft(extra: Record<string, unknown> = {}) {
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
    body: { expectedRevision: 1, mutations: [ottomanCreateMutation(catalog, extra)] },
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

test("PI-5G4b v3 RPC exists beside frozen v1/v2 with service_role-only execute", () => {
  const v1 = source(G3_SQL);
  const v2 = source(G4A_SQL);
  const v3 = source(G4B_SQL);
  assert.match(v1, /create or replace function public\.vibode_stage_apply_partner_patch\(p_apply jsonb\)/);
  assert.match(v1, /\(p_apply->>'planVersion'\)::integer <> 1/);
  assert.doesNotMatch(v1, /productCreates/);
  assert.match(v2, /create or replace function public\.vibode_stage_apply_partner_patch_v2\(p_apply jsonb\)/);
  assert.match(v2, /\(p_apply->>'planVersion'\)::integer <> 2/);
  assert.match(v2, /jsonb_array_length\(p_apply->'productCreates'\) > 0/);
  assert.match(v3, /create or replace function public\.vibode_stage_apply_partner_patch_v3\(p_apply jsonb\)/);
  assert.match(v3, /\(p_apply->>'planVersion'\)::integer <> 3/);
  assert.match(v3, /security definer/i);
  assert.match(v3, /set search_path = public/);
  assert.match(v3, /revoke all on function public\.vibode_stage_apply_partner_patch_v3\(jsonb\)/);
  assert.match(v3, /from public, anon, authenticated/);
  assert.match(v3, /grant execute on function public\.vibode_stage_apply_partner_patch_v3\(jsonb\)\s+to service_role/);
  assert.match(v3, /pg_advisory_xact_lock/);
  assert.match(v3, /hashtextextended/);
  assert.match(v3, /for update/);
  assert.match(v3, /SET CONSTRAINTS public\.vibode_stage_products_default_variant_fkey DEFERRED/);
  assert.match(v3, /VIBODE_STAGE_PUBLISH:DUPLICATE_PRODUCT_ID/);
  assert.match(v3, /VIBODE_STAGE_PUBLISH:DEFAULT_VARIANT_MISMATCH/);
  assert.match(v3, /VIBODE_STAGE_PUBLISH:DUPLICATE_VARIANT_ID/);
  assert.match(v3, /VIBODE_STAGE_PUBLISH:DUPLICATE_SKU/);
  assert.match(v3, /VIBODE_STAGE_PUBLISH:ASSET_NOT_READY/);
  assert.match(v3, /VIBODE_STAGE_PUBLISH:PARTNER_ASSET_UNASSOCIATED/);
  assert.match(v3, /insert into public\.vibode_stage_products/);
  assert.match(v3, /insert into public\.vibode_stage_variants/);
  assert.match(v3, /insert into public\.vibode_stage_product_collections/);
  assert.match(v3, /jsonb_array_length\(p_apply->'collectionCreates'\) > 0/);
  const productInsert = v3.indexOf("insert into public.vibode_stage_products");
  const variantInsert = v3.indexOf("insert into public.vibode_stage_variants");
  const membershipInsert = v3.indexOf("insert into public.vibode_stage_product_collections");
  const deferred = v3.indexOf("SET CONSTRAINTS public.vibode_stage_products_default_variant_fkey DEFERRED");
  const successLookup = v3.indexOf("status in ('accepted', 'noop')");
  assert.ok(successLookup >= 0 && successLookup < productInsert);
  assert.ok(deferred >= 0 && deferred < productInsert);
  assert.ok(productInsert >= 0 && productInsert < variantInsert);
  assert.ok(variantInsert >= 0 && variantInsert < membershipInsert);
  assert.doesNotMatch(v3, /insert into public\.vibode_stage_collections/);
  assert.doesNotMatch(v3, /EXECUTE\s+format/i);
  assert.doesNotMatch(v3, /EXECUTE\s+'/i);
  assert.doesNotMatch(v3, /vibode_3d_scenes|objects_json|scene_objects/);
  assert.doesNotMatch(v3, /create table/);
  assert.equal(STAGE_PARTNER_APPLY_RPC, "vibode_stage_apply_partner_patch");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V2, "vibode_stage_apply_partner_patch_v2");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V3, "vibode_stage_apply_partner_patch_v3");
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_2, 2);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_3, 3);
});

test("PI-5G4b Product identity helpers freeze slug-derived IDs", () => {
  const slug = partnerSlugFromPartnerId(DEMO_FURNITURE_PARTNER_ID);
  assert.equal(slug, "demo-furniture-co");
  assert.equal(productCreationSlugFor({ name: OTTOMAN_NAME }), OTTOMAN_SLUG);
  assert.equal(productIdForCreate(slug!, OTTOMAN_SLUG), OTTOMAN_PRODUCT_ID);
  assert.equal(variantIdForCreate(slug!, OTTOMAN_SLUG, "natural"), OTTOMAN_VARIANT_ID);
  assert.equal(productCreationSlugFor({ name: "Renamed Later", creationSlug: OTTOMAN_SLUG }), OTTOMAN_SLUG);
});

test("PI-5G4b parser keeps old patches valid and rejects forbidden Product create stamps", () => {
  const oldPatch = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, name: "Demo Sofa" }], deactivate: [], reactivate: [] },
    variants: { create: [], update: [], deactivate: [], reactivate: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(oldPatch.ok, true);
  if (!oldPatch.ok) return;
  assert.deepEqual(oldPatch.document.products.create, []);
  assert.equal(oldPatch.document.products.update[0]?.name, "Demo Sofa");

  const missingCreate = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(missingCreate.ok, true);
  if (!missingCreate.ok) return;
  assert.deepEqual(missingCreate.document.products.create, []);

  const { catalog } = certifiedScopedCatalog();
  const valid = parsePartnerCatalogSyncJson(ottomanPatch(catalog));
  assert.equal(valid.ok, true, JSON.stringify(valid));
  if (!valid.ok) return;
  assert.equal(valid.document.products.create?.[0]?.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(valid.document.products.create?.[0]?.defaultVariantId, OTTOMAN_VARIANT_ID);
  assert.equal(valid.document.variants.create[0]?.variantId, OTTOMAN_VARIANT_ID);

  const malformed = parsePartnerCatalogSyncJson(ottomanPatch(catalog, { product: { priceAmount: "349" } }));
  assert.equal(malformed.ok, false);

  for (const field of ["brand", "retailer", "source", "partnerId", "status", "sortOrder", "collectionIds"]) {
    const forbidden = parsePartnerCatalogSyncJson(ottomanPatch(catalog, { product: { [field]: "nope" } }));
    assert.equal(forbidden.ok, false, field);
  }

  const snapshot = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "snapshot",
    products: { create: [], update: [] },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(snapshot.ok, false);
});

test("PI-5G4b planner requires an atomic Product+default Variant bundle", () => {
  const { catalog } = certifiedScopedCatalog();
  const valid = planDocument(ottomanPatch(catalog), catalog);
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  assert.equal(valid.noOp, false);
  assert.equal(valid.productCreates.length, 1);
  assert.equal(valid.variantCreates.length, 1);
  const product = valid.productCreates[0]?.product;
  const variant = valid.variantCreates[0]?.variant;
  assert.equal(product?.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(product?.defaultVariantId, OTTOMAN_VARIANT_ID);
  assert.equal(product?.brand, "Demo Furniture Co.");
  assert.equal(product?.retailer, "Demo Furniture Co.");
  assert.equal(product?.source, "partner_catalog");
  assert.equal(product?.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(product?.status, "active");
  assert.equal(product?.priceAmount, OTTOMAN_PRICE);
  assert.equal(product?.priceCurrency, "USD");
  assert.equal(product?.categoryId, "living-room");
  assert.equal(product?.subcategoryId, "chairs");
  assert.equal(variant?.variantId, OTTOMAN_VARIANT_ID);
  assert.equal(variant?.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(variant?.priceAmount, OTTOMAN_PRICE);
  assert.equal(variant?.priceCurrency, "USD");
  assert.equal(variant?.assetId, sofaAssetId(catalog));

  const productOnly = planDocument(ottomanPatch(catalog, { omitVariant: true }), catalog);
  assert.equal(productOnly.ok, false);
  assert.equal(productOnly.issues.some((issue) => issue.code === "DEFAULT_VARIANT_MISMATCH"), true);

  const wrongProduct = planDocument(ottomanPatch(catalog, { variant: { productId: DEMO_SOFA_PRODUCT_ID } }), catalog);
  assert.equal(wrongProduct.ok, false);
  assert.equal(wrongProduct.issues.some((issue) => issue.code === "DEFAULT_VARIANT_MISMATCH"), true);

  const priceMismatch = planDocument(ottomanPatch(catalog, { variant: { priceAmount: 111 } }), catalog);
  assert.equal(priceMismatch.ok, false);
  assert.equal(priceMismatch.issues.some((issue) => issue.code === "PRICE_CURRENCY_MISMATCH"), true);

  const currencyMismatch = planDocument(ottomanPatch(catalog, { variant: { priceCurrency: "EUR" } }), catalog);
  assert.equal(currencyMismatch.ok, false);

  const badUrl = planDocument(ottomanPatch(catalog, { product: { productUrl: "http://example.test/ottoman" } }), catalog);
  assert.equal(badUrl.ok, false);
  assert.equal(badUrl.issues.some((issue) => issue.code === "INVALID_PRODUCT_URL"), true);

  const badImage = planDocument(ottomanPatch(catalog, { product: { imageUrl: "not-a-url" } }), catalog);
  assert.equal(badImage.ok, false);
  assert.equal(badImage.issues.some((issue) => issue.code === "INVALID_IMAGE_URL"), true);

  const missingCategory = parsePartnerCatalogSyncJson(ottomanPatch(catalog, { product: { categoryId: "" } }));
  assert.equal(missingCategory.ok, false);

  const badSubcategory = planDocument(ottomanPatch(catalog, { product: { subcategoryId: "not-a-subcategory" } }), catalog);
  assert.equal(badSubcategory.ok, false);
  assert.equal(badSubcategory.issues.some((issue) => issue.code === "UNKNOWN_SUBCATEGORY"), true);

  const dupProduct = planDocument(ottomanPatch(catalog, {
    product: { productId: DEMO_SOFA_PRODUCT_ID, defaultVariantId: DEMO_SOFA_DEFAULT_VARIANT_ID },
    variant: { variantId: DEMO_SOFA_DEFAULT_VARIANT_ID, productId: DEMO_SOFA_PRODUCT_ID },
  }), catalog);
  assert.equal(dupProduct.issues.some((issue) => issue.code === "DUPLICATE_PRODUCT_ID"), true);

  const dupVariant = planDocument(ottomanPatch(catalog, {
    product: { defaultVariantId: DEMO_SOFA_DEFAULT_VARIANT_ID },
    variant: { variantId: DEMO_SOFA_DEFAULT_VARIANT_ID },
  }), catalog);
  assert.equal(dupVariant.issues.some((issue) => issue.code === "DUPLICATE_VARIANT_ID" || issue.code === "VARIANT_NAMESPACE_MISMATCH"), true);

  const dupSku = planDocument(ottomanPatch(catalog, { variant: { sku: "DFC-SOFA-01" } }), catalog);
  assert.equal(dupSku.issues.some((issue) => issue.code === "DUPLICATE_SKU"), true);

  const unready = cloneCatalog(catalog, {
    assets: catalog.assets.map((asset) => (
      asset.assetId === sofaAssetId(catalog) ? { ...asset, status: "unavailable" as const } : asset
    )),
  });
  const unreadyPlan = planDocument(ottomanPatch(unready), unready);
  assert.equal(unreadyPlan.ok, false);

  const namespace = planDocument(ottomanPatch(catalog, {
    product: {
      productId: "prod-other-furniture-co-g4b-ottoman",
      defaultVariantId: "var-other-furniture-co-g4b-ottoman-natural",
    },
    variant: {
      productId: "prod-other-furniture-co-g4b-ottoman",
      variantId: "var-other-furniture-co-g4b-ottoman-natural",
    },
  }), catalog);
  assert.equal(namespace.issues.some((issue) => issue.code === "PRODUCT_NAMESPACE_MISMATCH"), true);

  const extraPending = planDocument({
    ...ottomanPatch(catalog),
    variants: {
      create: [
        ottomanPatch(catalog).variants.create[0],
        {
          variantId: "var-demo-furniture-co-g4b-ottoman-stone",
          productId: OTTOMAN_PRODUCT_ID,
          finishLabel: "Stone",
          sku: "DFC-G4B-OTTOMAN-02",
          priceAmount: OTTOMAN_PRICE,
          priceCurrency: "USD",
          productUrl: null,
          currentAssetId: sofaAssetId(catalog),
        },
      ],
      update: [],
      deactivate: [],
      reactivate: [],
    },
  }, catalog);
  assert.equal(extraPending.ok, false);
  assert.equal(extraPending.issues.some((issue) => issue.code === "UNSUPPORTED_OPERATION"), true);
});

test("PI-5G4b patch and F3C snapshot planners agree on Product+default Variant create rows", () => {
  const { catalog, folded } = certifiedScopedCatalog();
  const patchPlan = planDocument(ottomanPatch(catalog), catalog);
  assert.equal(patchPlan.ok, true, JSON.stringify(patchPlan.issues));
  const snapshot = snapshotFromCurrent(folded, {
    product: {
      productId: OTTOMAN_PRODUCT_ID,
      name: OTTOMAN_NAME,
      brand: "Demo Furniture Co.",
      retailer: "Demo Furniture Co.",
      categoryId: "living-room",
      subcategoryId: "chairs",
      imageUrl: OTTOMAN_IMAGE,
      productUrl: OTTOMAN_URL,
      priceAmount: OTTOMAN_PRICE,
      priceCurrency: "USD",
      source: "partner_catalog",
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      collectionIds: [],
    },
    defaultVariant: {
      variantId: OTTOMAN_VARIANT_ID,
      finishLabel: "Natural",
      sku: OTTOMAN_SKU,
      priceAmount: OTTOMAN_PRICE,
      priceCurrency: "USD",
      productUrl: null,
      currentAssetId: sofaAssetId(catalog),
    },
    variants: [],
  });
  const snapshotPlan = planPartnerCatalogSnapshotSync({
    current: folded,
    document: snapshot,
    catalog: durableAssetCatalogForPlanning(catalog),
    seedAssets: catalog.assets,
    repoRoot: ROOT,
  });
  assert.equal(snapshotPlan.ok, true, JSON.stringify(snapshotPlan.issues));
  const patchProduct = patchPlan.productCreates.find((item) => item.product.productId === OTTOMAN_PRODUCT_ID)?.product;
  const snapProduct = snapshotPlan.productCreates.find((item) => item.product.productId === OTTOMAN_PRODUCT_ID)?.product;
  const patchVariant = patchPlan.variantCreates.find((item) => item.variant.variantId === OTTOMAN_VARIANT_ID)?.variant;
  const snapVariant = snapshotPlan.variantCreates.find((item) => item.variant.variantId === OTTOMAN_VARIANT_ID)?.variant;
  assert.ok(patchProduct && snapProduct && patchVariant && snapVariant);
  assert.equal(patchProduct?.name, snapProduct?.name);
  assert.equal(patchProduct?.brand, snapProduct?.brand);
  assert.equal(patchProduct?.retailer, snapProduct?.retailer);
  assert.equal(patchProduct?.source, snapProduct?.source);
  assert.equal(patchProduct?.partnerId, snapProduct?.partnerId);
  assert.equal(patchProduct?.priceAmount, snapProduct?.priceAmount);
  assert.equal(patchProduct?.priceCurrency, snapProduct?.priceCurrency);
  assert.equal(patchProduct?.categoryId, snapProduct?.categoryId);
  assert.equal(patchProduct?.subcategoryId, snapProduct?.subcategoryId);
  assert.equal(patchProduct?.defaultVariantId, snapProduct?.defaultVariantId);
  assert.equal(patchProduct?.status, snapProduct?.status);
  assert.equal(patchProduct?.imageUrl, snapProduct?.imageUrl);
  assert.equal(patchProduct?.productUrl, snapProduct?.productUrl);
  assert.equal(patchVariant?.sku, snapVariant?.sku);
  assert.equal(patchVariant?.finishLabel, snapVariant?.finishLabel);
  assert.equal(patchVariant?.priceAmount, snapVariant?.priceAmount);
  assert.equal(patchVariant?.priceCurrency, snapVariant?.priceCurrency);
  assert.equal(patchVariant?.assetId, snapVariant?.assetId);
  assert.equal(patchVariant?.productId, snapVariant?.productId);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-publish.ts"), /planPartnerCatalogSnapshotSync/);
  assert.doesNotMatch(source("app/partner/catalog/drafts/[draftId]/page.tsx"), /planPartnerCatalogSnapshotSync/);
});

test("PI-5G4b draft create persists canonical products.create[] with coupled price and server IDs", async () => {
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
  assert.deepEqual(empty.document.products.create ?? [], []);
  assert.deepEqual(empty.touchedBase, { products: {}, variants: {}, collections: {} });
  assert.equal(partnerCatalogCurrencyForCreate(catalog, DEMO_FURNITURE_PARTNER_ID), "USD");

  const spoof = parsePartnerDraftMutation({
    ...ottomanCreateMutation(catalog),
    partnerId: OTHER_PARTNER_ID,
  });
  assert.equal(spoof.ok, false);

  const created = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [ottomanCreateMutation(catalog, { collectionIds: [DEMO_LIVING_ROOM_COLLECTION_ID] })],
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const dto = draftFrom(created.body);
  assert.equal(dto.revision, 2);
  assert.equal(dto.document.products.create?.length, 1);
  assert.equal(dto.document.variants.create.length, 1);
  const product = dto.document.products.create?.[0];
  const variant = dto.document.variants.create[0]!;
  assert.ok(product);
  assert.equal(product.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(product.defaultVariantId, OTTOMAN_VARIANT_ID);
  assert.equal(product.priceAmount, OTTOMAN_PRICE);
  assert.equal(product.priceCurrency, "USD");
  assert.equal(variant.variantId, OTTOMAN_VARIANT_ID);
  assert.equal(variant.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(variant.priceAmount, OTTOMAN_PRICE);
  assert.equal(variant.priceCurrency, "USD");
  assert.equal(variant.currentAssetId, sofaAssetId(catalog));
  assert.deepEqual(dto.document.collections.membershipAdd, [{
    productId: OTTOMAN_PRODUCT_ID,
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
  }]);
  assert.deepEqual(dto.touchedBase.products, {});
  assert.deepEqual(dto.touchedBase.variants, {});
  assert.deepEqual(
    dto.touchedBase.collections[DEMO_LIVING_ROOM_COLLECTION_ID]?.membership_product_ids,
    [...(catalog.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID)?.productIds ?? [])].sort(),
  );

  const renamed = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "product.create_edit", productId: OTTOMAN_PRODUCT_ID, name: "G4b Ottoman Deluxe" }],
    },
  });
  assert.equal(renamed.status, 200);
  const afterRename = draftFrom(renamed.body);
  assert.equal(afterRename.document.products.create?.[0]?.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(afterRename.document.products.create?.[0]?.name, "G4b Ottoman Deluxe");
  assert.equal(afterRename.document.variants.create[0]?.variantId, OTTOMAN_VARIANT_ID);

  const priced = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "product.create_edit", productId: OTTOMAN_PRODUCT_ID, priceAmount: 399 }],
    },
  });
  assert.equal(priced.status, 200);
  const afterPrice = draftFrom(priced.body);
  assert.equal(afterPrice.document.products.create?.[0]?.priceAmount, 399);
  assert.equal(afterPrice.document.variants.create[0]?.priceAmount, 399);
  assert.equal(afterPrice.document.products.create?.[0]?.priceCurrency, "USD");

  const variantPrice = applyPartnerDraftMutation(afterPrice.document, catalog, {
    type: "variant.create_edit",
    variantId: OTTOMAN_VARIANT_ID,
    priceAmount: 12,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(variantPrice.ok, false);

  const finish = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 4,
      mutations: [{ type: "variant.create_edit", variantId: OTTOMAN_VARIANT_ID, finishLabel: "Natural linen" }],
    },
  });
  assert.equal(finish.status, 200);
  const afterFinish = draftFrom(finish.body);
  assert.equal(afterFinish.document.variants.create[0]?.variantId, OTTOMAN_VARIANT_ID);
  assert.equal(afterFinish.document.variants.create[0]?.finishLabel, "Natural linen");

  const stale = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "product.create_edit", productId: OTTOMAN_PRODUCT_ID, name: "Stale" }],
    },
  });
  assert.equal(stale.status, 409);

  const liveEdit = applyPartnerDraftMutation(afterFinish.document, catalog, {
    type: "product.set_name",
    productId: OTTOMAN_PRODUCT_ID,
    name: "Nope",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(liveEdit.ok, false);

  const extraVariant = applyPartnerDraftMutation(afterFinish.document, catalog, {
    type: "variant.create",
    productId: OTTOMAN_PRODUCT_ID,
    finishLabel: "Stone",
    sku: "DFC-G4B-OTTOMAN-02",
    priceAmount: 399,
    productUrl: null,
    currentAssetId: sofaAssetId(catalog),
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(extraVariant.ok, false);

  const foreignCollection = applyPartnerDraftMutation(emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID), catalog, {
    ...ottomanCreateMutation(catalog),
    collectionIds: [FOREIGN_COLLECTION_ID],
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(foreignCollection.ok, false);

  const removed = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 5,
      mutations: [{ type: "product.create_remove", productId: OTTOMAN_PRODUCT_ID }],
    },
  });
  assert.equal(removed.status, 200);
  const afterRemove = draftFrom(removed.body);
  assert.equal(afterRemove.document.products.create?.length ?? 0, 0);
  assert.equal(afterRemove.document.variants.create.length, 0);
  assert.equal(afterRemove.document.collections.membershipAdd.length, 0);
  assert.equal(afterRemove.revision, 6);
});

test("PI-5G4b reuses the G4a Partner Asset picker and rejects unready/foreign Assets", () => {
  const { catalog } = certifiedScopedCatalog();
  const choices = listPartnerReadyAssetsForVariantCreate(catalog);
  assert.ok(choices.length > 0);
  assert.equal(choices.some((item) => item.assetId === sofaAssetId(catalog)), true);

  const emptyAssets = cloneCatalog(catalog, {
    assets: [],
    variants: catalog.variants.map((item) => ({ ...item, assetId: null })),
  });
  assert.equal(listPartnerReadyAssetsForVariantCreate(emptyAssets).length, 0);
  const disabled = applyPartnerDraftMutation(
    emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    emptyAssets,
    ottomanCreateMutation(catalog),
    DEMO_FURNITURE_PARTNER_ID,
  );
  assert.equal(disabled.ok, false);

  const foreign = applyPartnerDraftMutation(
    emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    catalog,
    ottomanCreateMutation(catalog, {
      defaultVariant: {
        finishLabel: "Natural",
        sku: OTTOMAN_SKU,
        productUrl: null,
        currentAssetId: "not-a-partner-asset",
      },
    }),
    DEMO_FURNITURE_PARTNER_ID,
  );
  assert.equal(foreign.ok, false);

  const unreadyCatalog = cloneCatalog(catalog, {
    assets: catalog.assets.map((asset) => (
      asset.assetId === sofaAssetId(catalog) ? { ...asset, status: "unavailable" as const } : asset
    )),
  });
  const unreadySave = applyPartnerDraftMutation(
    emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    unreadyCatalog,
    ottomanCreateMutation(catalog),
    DEMO_FURNITURE_PARTNER_ID,
  );
  assert.equal(unreadySave.ok, false);

  const reused = applyPartnerDraftMutation(
    emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    catalog,
    ottomanCreateMutation(catalog),
    DEMO_FURNITURE_PARTNER_ID,
  );
  assert.equal(reused.ok, true);
  assert.match(source("app/partner/catalog/drafts/[draftId]/page.tsx"), /listPartnerReadyAssetsForVariantCreate/);
  assert.match(source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx"), /Product creation requires an already-certified Partner Asset/);
  assert.doesNotMatch(PI5G4B_FILES.map((file) => source(file)).join("\n"), /writeGeneratedFurnitureAssetRegistry/);
});

test("PI-5G4b Preview shows Create Product, default Variant, and membership without sqlPlan", async () => {
  const opened = await openOttomanDraft({ collectionIds: [DEMO_LIVING_ROOM_COLLECTION_ID] });
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5g4b-preview-"));
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
    productCreates: readonly { product: { productId: string; name: string } }[];
    variantCreates: readonly { variant: { variantId: string; sku: string | null } }[];
    membershipAdds: readonly { productId: string; collectionId: string }[];
  };
  assert.equal(body.ok, true);
  assert.equal(body.noOp, false);
  assert.equal(body.sqlPlan, undefined);
  assert.equal(body.productCreates.some((item) => item.product.productId === OTTOMAN_PRODUCT_ID), true);
  assert.equal(body.variantCreates.some((item) => item.variant.variantId === OTTOMAN_VARIANT_ID), true);
  assert.equal(body.membershipAdds.some((item) => (
    item.productId === OTTOMAN_PRODUCT_ID && item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
  )), true);
  const view = presentPartnerDraftPreview(body);
  assert.equal("error" in view, false);
  if ("error" in view) return;
  assert.equal(partnerDraftPreviewHasChanges(view), true);
  const created = view.productCreates.find((item) => item.productId === OTTOMAN_PRODUCT_ID);
  assert.ok(created);
  assert.match(created?.name ?? "", /Ottoman/);
  assert.match(created?.price ?? "", /349/);
  const defaultVariant = view.variantCreates.find((item) => item.variantId === OTTOMAN_VARIANT_ID);
  assert.ok(defaultVariant);
  assert.equal(defaultVariant?.sku, OTTOMAN_SKU);
  const workspace = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.match(workspace, /Create Product/);
  assert.match(workspace, /Create Default Variant/);
  assert.match(workspace, /New Product — pending publish/);
  assert.match(workspace, /Add Product/);
  assert.match(workspace, /product\.create_edit/);
  assert.match(workspace, /product\.create_remove/);
  assert.doesNotMatch(workspace, /collection\.create/);
  assert.deepEqual(readdirSync(repoRoot), before);
});

test("PI-5G4b publish selects v3 for Product create and keeps v1/v2 routing", async () => {
  const opened = await openOttomanDraft({ collectionIds: [DEMO_LIVING_ROOM_COLLECTION_ID] });
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
  assert.equal(opened.payloads[0]?.planVersion, 3);
  assert.ok(Array.isArray(opened.payloads[0]?.productCreates));
  assert.ok(Array.isArray(opened.payloads[0]?.variantCreates));
  assert.deepEqual(opened.payloads[0]?.collectionCreates, []);
  const liveProduct = opened.live.catalog.products.find((item) => item.productId === OTTOMAN_PRODUCT_ID);
  const liveVariant = opened.live.catalog.variants.find((item) => item.variantId === OTTOMAN_VARIANT_ID);
  assert.ok(liveProduct);
  assert.ok(liveVariant);
  assert.equal(liveProduct?.defaultVariantId, OTTOMAN_VARIANT_ID);
  assert.equal(liveProduct?.priceAmount, OTTOMAN_PRICE);
  assert.equal(liveVariant?.priceAmount, OTTOMAN_PRICE);
  assert.equal(liveProduct?.priceCurrency, liveVariant?.priceCurrency);
  assert.equal(liveProduct?.collectionIds.includes(DEMO_LIVING_ROOM_COLLECTION_ID), true);
  const audit = opened.audit.rows.find((row) => row.status === "accepted");
  assert.ok(audit);
  const plan = audit?.plan as { planVersion?: number; productCreates?: unknown[]; variantCreates?: unknown[] };
  assert.equal(plan.planVersion, 3);
  assert.ok(Array.isArray(plan.productCreates));
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
  assert.equal(opened.live.catalog.products.filter((item) => item.productId === OTTOMAN_PRODUCT_ID).length, 1);
  assert.equal(opened.live.catalog.variants.filter((item) => item.variantId === OTTOMAN_VARIANT_ID).length, 1);
  assert.equal(opened.audit.rows.filter((row) => row.status === "accepted").length, 1);

  const { catalog, load } = certifiedScopedCatalog();
  const updateStore = createMemoryPartnerDraftStore();
  const updateAudit = createMemoryPartnerPublishAuditStore();
  const captured = capturingApply(createMemoryPartnerRuntimeApply({ store: updateStore, audit: updateAudit }));
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
  assert.equal(captured.payloads[0]?.productCreates, undefined);

  const variantStore = createMemoryPartnerDraftStore();
  const variantAudit = createMemoryPartnerPublishAuditStore();
  const variantLive = { catalog: certifiedScopedCatalog().mixed };
  const variantCaptured = capturingApply(insertingApply(
    createMemoryPartnerRuntimeApply({ store: variantStore, audit: variantAudit }),
    variantLive,
  ));
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: variantStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: variantStore,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{
        type: "variant.create",
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Oak",
        sku: "DFC-SOFA-OAK-G4B",
        priceAmount: 1499,
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
    },
  });
  const variantOnly = await publishPartnerPatchDraft({
    auth: authOk(),
    store: variantStore,
    catalog: load,
    audit: variantAudit,
    apply: variantCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    reloadCatalog: async () => loadOf(variantLive.catalog),
  });
  assert.equal(variantOnly.status, 200, JSON.stringify(variantOnly.body));
  assert.equal(variantCaptured.payloads[0]?.planVersion, 2);
  assert.equal(variantCaptured.payloads[0]?.productCreates, undefined);

  const mixedStore = createMemoryPartnerDraftStore();
  const mixedAudit = createMemoryPartnerPublishAuditStore();
  const mixedLive = { catalog: certifiedScopedCatalog().mixed };
  const mixedCaptured = capturingApply(insertingApply(
    createMemoryPartnerRuntimeApply({ store: mixedStore, audit: mixedAudit }),
    mixedLive,
  ));
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
        ottomanCreateMutation(catalog),
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
    reloadCatalog: async () => loadOf(mixedLive.catalog),
  });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
  assert.equal(mixedCaptured.payloads[0]?.planVersion, 3);
  assert.ok(Array.isArray(mixedCaptured.payloads[0]?.productUpdates));
  assert.ok(Array.isArray(mixedCaptured.payloads[0]?.productCreates));
});

test("PI-5G4b v3 serializer emits complete Product creates and rejects unsupported ops", () => {
  const { catalog } = certifiedScopedCatalog();
  const plan = planDocument(ottomanPatch(catalog, {
    membershipAdd: [{ productId: OTTOMAN_PRODUCT_ID, collectionId: DEMO_LIVING_ROOM_COLLECTION_ID }],
  }), catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(partnerRuntimePlanNeedsV3(plan), true);
  assert.equal(partnerRuntimePlanNeedsV2(plan), true);
  assert.deepEqual(g3UnsupportedPublishOperations(plan).sort(), ["productCreates", "variantCreates"].sort());
  assert.equal(g4aUnsupportedPublishOperations(plan).includes("productCreates"), true);
  assert.equal(toRuntimeApplyPayload(plan).ok, false);
  assert.equal(toRuntimeApplyPayloadV2(plan).ok, false);
  assert.deepEqual(g4bUnsupportedPublishOperations(plan), []);
  const v3 = toRuntimeApplyPayloadV3(plan);
  assert.equal(v3.ok, true);
  if (!v3.ok) return;
  assert.equal(v3.payload.planVersion, 3);
  assert.deepEqual(Object.keys(v3.payload).sort(), [
    "collectionCreates",
    "collectionUpdates",
    "membershipAdds",
    "membershipRemoves",
    "partnerId",
    "planVersion",
    "productCreates",
    "productUpdates",
    "variantCreates",
    "variantUpdates",
  ]);
  assert.deepEqual(v3.payload.collectionCreates, []);
  const product = v3.payload.productCreates[0];
  assert.ok(product);
  assert.deepEqual(Object.keys(product).sort(), [
    "brand",
    "categoryId",
    "defaultVariantId",
    "imageUrl",
    "name",
    "partnerId",
    "priceAmount",
    "priceCurrency",
    "productId",
    "productUrl",
    "retailer",
    "sortOrder",
    "source",
    "status",
    "subcategoryId",
  ]);
  assert.equal(product.source, "partner_catalog");
  assert.equal(product.status, "active");
  assert.equal(product.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(product.brand, "Demo Furniture Co.");
  assert.equal(product.retailer, "Demo Furniture Co.");
  assert.equal(v3.payload.variantCreates[0]?.variantId, OTTOMAN_VARIANT_ID);
  assert.equal(v3.payload.variantCreates[0]?.currentAssetId, sofaAssetId(catalog));
  assert.equal(v3.payload.membershipAdds[0]?.productId, OTTOMAN_PRODUCT_ID);
  const persistable = persistableRuntimeApplyPayloadV3(v3.payload);
  assert.equal(persistable.planVersion, 3);
  assert.equal("sqlPlan" in persistable, false);
  assert.equal("availability" in persistable, false);

  const deactivatePlan: PartnerCatalogSyncPlan = {
    ...plan,
    productDeactivations: [{ productId: DEMO_SOFA_PRODUCT_ID, from: "active", to: "inactive" }],
  };
  assert.equal(toRuntimeApplyPayloadV3(deactivatePlan).ok, false);
  const collectionCreatePlan: PartnerCatalogSyncPlan = {
    ...plan,
    collectionCreates: [{
      collection: catalog.collections[0]!,
      sortOrder: 0,
    }],
  };
  assert.equal(toRuntimeApplyPayloadV3(collectionCreatePlan).ok, false);
  const retarget = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [],
      update: [{ variantId: DEMO_SOFA_DEFAULT_VARIANT_ID, currentAssetId: PI5F2_COFFEE_TABLE_ASSET_ID }],
      deactivate: [],
      reactivate: [],
    },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  }, catalog);
  assert.equal(retarget.issues.some((issue) => issue.code === "ASSET_RETARGET_REQUIRED"), true);
});

test("PI-5G4b race and membership guards are encoded in v3 SQL", () => {
  const sql = source(G4B_SQL);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /products\.product_id = v_product_id/);
  assert.match(sql, /variants\.variant_id = v_variant_id/);
  assert.match(sql, /variants\.sku = v_sku/);
  assert.doesNotMatch(sql, /variants\.status = 'active'/);
  assert.match(sql, /assets\.status = 'ready'/);
  assert.match(sql, /variants\.current_asset_id = v_asset_id/);
  assert.match(sql, /v_item->>'brand' is distinct from v_partner_name/);
  assert.match(sql, /source = 'partner_catalog'/);
  assert.match(sql, /products\.source = 'partner_catalog'/);
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /STAGE_PARTNER_APPLY_RPC_V3/);
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /supabase\.rpc\(STAGE_PARTNER_APPLY_RPC_V3/);
  const collectionCreate = parsePartnerDraftMutation({ type: "collection.create", name: "Nope" });
  assert.equal(collectionCreate.ok, false);
});

test("PI-5G4b Node paths do not DML commercial, Asset, or Scene tables", () => {
  for (const file of [
    "lib/vibode-stage/partner-catalog-publish.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor-v3.ts",
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
  assert.equal(parsePartnerDraftMutation({ type: "collection.create", name: "Nope" }).ok, false);
  assert.match(source("lib/vibode-stage/partner-draft-mutations.ts"), /"collection.create"/);
  assert.match(source("package.json"), /test:afc-v2-pi5g4b/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-runtime-executor.ts"), /PARTNER_RUNTIME_PLAN_VERSION_3|planVersion: 3/);
  assert.doesNotMatch(source(G3_SQL), /vibode_stage_apply_partner_patch_v3/);
  assert.doesNotMatch(source(G4A_SQL), /vibode_stage_apply_partner_patch_v3/);
});
