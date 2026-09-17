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
  collectionCreationSlugFor,
  collectionIdForCreate,
  partnerSlugFromPartnerId,
} from "./partner-catalog-ids";
import {
  createMemoryPartnerRuntimeApply,
  detectPartnerPublishConflicts,
  httpStatusForPublishErrorCode,
  merchantMessageForPublishErrorCode,
  parsePartnerPublishBody,
  publishPartnerPatchDraft,
  STAGE_PARTNER_APPLY_RPC,
  STAGE_PARTNER_APPLY_RPC_V2,
  STAGE_PARTNER_APPLY_RPC_V3,
  STAGE_PARTNER_APPLY_RPC_V4,
  type PartnerRuntimeApplyFn,
} from "./partner-catalog-publish";
import {
  g3UnsupportedPublishOperations,
  toRuntimeApplyPayload,
} from "./partner-catalog-runtime-executor";
import {
  PARTNER_RUNTIME_PLAN_VERSION_2,
  partnerRuntimePlanNeedsV2,
  toRuntimeApplyPayloadV2,
} from "./partner-catalog-runtime-executor-v2";
import {
  PARTNER_RUNTIME_PLAN_VERSION_3,
  partnerRuntimePlanNeedsV3,
  toRuntimeApplyPayloadV3,
} from "./partner-catalog-runtime-executor-v3";
import {
  g4cUnsupportedPublishOperations,
  PARTNER_RUNTIME_PLAN_VERSION_4,
  partnerRuntimePlanNeedsV4,
  persistableRuntimeApplyPayloadV4,
  toRuntimeApplyPayloadV4,
} from "./partner-catalog-runtime-executor-v4";
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
} from "./partner-draft-mutations";
import {
  partnerDraftPreviewHasChanges,
  presentPartnerDraftPreview,
} from "./partner-draft-preview-view";
import {
  emptyPartnerDraftTouchedBase,
  nextPartnerDraftTouchedBase,
} from "./partner-draft-touched-base";
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
const G4C_SQL = "supabase/migrations/20260917220000_vibode_stage_partner_collection_create.sql";
const USER_A = "22222222-2222-2222-2222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SHOWROOM_NAME = "G4c Showroom";
const SHOWROOM_SLUG = "g4c-showroom";
const SHOWROOM_ID = "col-demo-furniture-co-g4c-showroom";
const ALT_SHOWROOM_ID = "col-demo-furniture-co-g4c-gallery";
const OTTOMAN_NAME = "G4c Ottoman";
const OTTOMAN_SLUG = "g4c-ottoman";
const OTTOMAN_PRODUCT_ID = "prod-demo-furniture-co-g4c-ottoman";
const OTTOMAN_VARIANT_ID = "var-demo-furniture-co-g4c-ottoman-natural";
const OTTOMAN_SKU = "DFC-G4C-OTTOMAN-01";
const OTTOMAN_PRICE = 349;
const OTTOMAN_IMAGE = "https://example.test/images/g4c-ottoman.jpg";
const OTTOMAN_URL = "https://example.test/products/g4c-ottoman";
const OAK_VARIANT_ID = "var-demo-furniture-co-demo-sofa-oak";

const PI5G4C_FILES = [
  G4C_SQL,
  "lib/vibode-stage/partner-catalog-ids.ts",
  "lib/vibode-stage/partner-catalog-sync.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v4.ts",
  "lib/vibode-stage/partner-draft-mutations.ts",
  "lib/vibode-stage/partner-draft-preview-view.ts",
  "lib/vibode-stage/partner-draft-touched-base.ts",
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

function emptyPatch(extra: {
  create?: readonly { collectionId: string; name: string }[];
  update?: readonly { collectionId: string; name?: string }[];
  membershipAdd?: readonly { productId: string; collectionId: string }[];
  membershipRemove?: readonly { productId: string; collectionId: string }[];
  products?: Record<string, unknown>;
  variants?: Record<string, unknown>;
} = {}) {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch" as const,
    products: extra.products ?? { create: [], update: [], deactivate: [], reactivate: [] },
    variants: extra.variants ?? { create: [], update: [], deactivate: [], reactivate: [] },
    collections: {
      ...(extra.create ? { create: extra.create } : {}),
      update: extra.update ?? [],
      membershipAdd: extra.membershipAdd ?? [],
      membershipRemove: extra.membershipRemove ?? [],
    },
  };
}

function collectionCreateMutation(extra: Record<string, unknown> = {}) {
  return {
    type: "collection.create" as const,
    name: SHOWROOM_NAME,
    ...extra,
  };
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
  extra?: {
    collection?: { collectionId: string; name: string; slug: string };
    product?: PartnerCatalogSnapshotProductRecord;
    memberProductId?: string;
  },
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
  if (extra?.collection) collections.push(extra.collection);
  const products: PartnerCatalogSnapshotProductRecord[] = state.products
    .filter((item) => item.partnerId === partner.partnerId)
    .map((product) => {
      const variants = state.variants.filter((item) => item.productId === product.productId);
      const defaultVariant = variants.find((item) => item.variantId === product.defaultVariantId);
      assert.ok(defaultVariant);
      assert.ok(product.priceAmount != null);
      const collectionIds = extra?.collection && extra.memberProductId === product.productId
        ? [...product.collectionIds, extra.collection.collectionId]
        : [...product.collectionIds];
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
          collectionIds,
        },
        defaultVariant: snapshotVariant(defaultVariant),
        variants: variants
          .filter((item) => item.variantId !== defaultVariant.variantId)
          .map(snapshotVariant),
      };
    });
  if (extra?.product) products.push(extra.product);
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
    const collectionCreates = Array.isArray(payload.collectionCreates) ? payload.collectionCreates : [];
    const membershipAdds = Array.isArray(payload.membershipAdds) ? payload.membershipAdds : [];
    const nextCollections = live.catalog.collections.map((item) => ({
      ...item,
      productIds: [...item.productIds],
    }));
    for (const raw of collectionCreates) {
      const create = raw as Record<string, unknown>;
      const collectionId = typeof create.collectionId === "string" ? create.collectionId : "";
      if (nextCollections.some((item) => item.collectionId === collectionId)) {
        return { ok: false, errorCode: "DUPLICATE_COLLECTION_ID" };
      }
      nextCollections.push({
        collectionId,
        name: String(create.name ?? ""),
        owner: "partner",
        partnerName: String(create.partnerName ?? ""),
        partnerId: String(create.partnerId ?? ""),
        productIds: [],
      });
    }
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
      if (!collection.productIds.includes(productId)) collection.productIds.push(productId);
      if (!product.collectionIds.includes(collectionId)) product.collectionIds.push(collectionId);
    }
    live.catalog = cloneCatalog(live.catalog, {
      products: productsForMembership,
      variants: nextVariants,
      collections: nextCollections,
    });
    return result;
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

function tryPlan(document: unknown, catalog: StageCatalogSnapshot) {
  const folded = foldedPartnerStateFromDurableCatalog(catalog, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(folded);
  const parsed = parsePartnerCatalogSyncJson(
    typeof document === "object" && document ? { ...document as object, partnerId: DEMO_FURNITURE_PARTNER_ID } : document,
  );
  if (!parsed.ok) return { parsed, plan: null as PartnerCatalogSyncPlan | null };
  return {
    parsed,
    plan: planPartnerCatalogSync({
      current: folded,
      document: parsed.document,
      catalog: durableAssetCatalogForPlanning(catalog),
      seedAssets: catalog.assets,
      repoRoot: ROOT,
    }),
  };
}

function emptyPlan(catalog: StageCatalogSnapshot): PartnerCatalogSyncPlan {
  return planDocument(emptyPatch(), catalog);
}

test("PI-5G4c v4 RPC exists beside frozen v1/v2/v3 with service_role-only execute", () => {
  const v1 = source(G3_SQL);
  const v2 = source(G4A_SQL);
  const v3 = source(G4B_SQL);
  const v4 = source(G4C_SQL);
  assert.match(v1, /create or replace function public\.vibode_stage_apply_partner_patch\(p_apply jsonb\)/);
  assert.match(v1, /\(p_apply->>'planVersion'\)::integer <> 1/);
  assert.doesNotMatch(v1, /vibode_stage_apply_partner_patch_v4/);
  assert.match(v2, /create or replace function public\.vibode_stage_apply_partner_patch_v2\(p_apply jsonb\)/);
  assert.doesNotMatch(v2, /vibode_stage_apply_partner_patch_v4/);
  assert.match(v3, /create or replace function public\.vibode_stage_apply_partner_patch_v3\(p_apply jsonb\)/);
  assert.match(v3, /jsonb_array_length\(p_apply->'collectionCreates'\) > 0/);
  assert.doesNotMatch(v3, /vibode_stage_apply_partner_patch_v4/);
  assert.match(v4, /create or replace function public\.vibode_stage_apply_partner_patch_v4\(p_apply jsonb\)/);
  assert.match(v4, /\(p_apply->>'planVersion'\)::integer <> 4/);
  assert.match(v4, /security definer/i);
  assert.match(v4, /set search_path = public/);
  assert.match(v4, /revoke all on function public\.vibode_stage_apply_partner_patch_v4\(jsonb\)/);
  assert.match(v4, /from public, anon, authenticated/);
  assert.match(v4, /grant execute on function public\.vibode_stage_apply_partner_patch_v4\(jsonb\)\s+to service_role/);
  assert.match(v4, /pg_advisory_xact_lock/);
  assert.match(v4, /hashtextextended/);
  assert.match(v4, /for update/);
  assert.match(v4, /SET CONSTRAINTS public\.vibode_stage_products_default_variant_fkey DEFERRED/);
  assert.match(v4, /VIBODE_STAGE_PUBLISH:DUPLICATE_COLLECTION_ID/);
  assert.match(v4, /insert into public\.vibode_stage_collections/);
  assert.match(v4, /insert into public\.vibode_stage_products/);
  assert.match(v4, /insert into public\.vibode_stage_variants/);
  assert.match(v4, /insert into public\.vibode_stage_product_collections/);
  assert.match(v4, /owner,\s*\n\s*partner_name,\s*\n\s*partner_id,\s*\n\s*status,\s*\n\s*sort_order/);
  assert.match(v4, /'partner',\s*\n\s*v_partner_name,\s*\n\s*v_partner_id,\s*\n\s*'active'/);
  const collectionInsert = v4.indexOf("insert into public.vibode_stage_collections");
  const productInsert = v4.indexOf("insert into public.vibode_stage_products");
  const variantInsert = v4.indexOf("insert into public.vibode_stage_variants");
  const membershipInsert = v4.indexOf("insert into public.vibode_stage_product_collections");
  const deferred = v4.indexOf("SET CONSTRAINTS public.vibode_stage_products_default_variant_fkey DEFERRED");
  const successLookup = v4.indexOf("status in ('accepted', 'noop')");
  assert.ok(successLookup >= 0 && successLookup < collectionInsert);
  assert.ok(deferred >= 0 && deferred < collectionInsert);
  assert.ok(collectionInsert >= 0 && collectionInsert < productInsert);
  assert.ok(productInsert >= 0 && productInsert < variantInsert);
  assert.ok(variantInsert >= 0 && variantInsert < membershipInsert);
  assert.doesNotMatch(v4, /delete from public\.vibode_stage_collections/i);
  assert.doesNotMatch(v4, /EXECUTE\s+format/i);
  assert.doesNotMatch(v4, /EXECUTE\s+'/i);
  assert.doesNotMatch(v4, /vibode_3d_scenes|objects_json|scene_objects/);
  assert.doesNotMatch(v4, /insert into public\.vibode_stage_assets/);
  assert.doesNotMatch(v4, /create table/);
  assert.equal(STAGE_PARTNER_APPLY_RPC, "vibode_stage_apply_partner_patch");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V2, "vibode_stage_apply_partner_patch_v2");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V3, "vibode_stage_apply_partner_patch_v3");
  assert.equal(STAGE_PARTNER_APPLY_RPC_V4, "vibode_stage_apply_partner_patch_v4");
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_2, 2);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_3, 3);
  assert.equal(PARTNER_RUNTIME_PLAN_VERSION_4, 4);
  assert.equal(httpStatusForPublishErrorCode("DUPLICATE_COLLECTION_ID"), 409);
  assert.match(merchantMessageForPublishErrorCode("DUPLICATE_COLLECTION_ID"), /collection/i);
});

test("PI-5G4c Collection identity helpers freeze slug-derived IDs", () => {
  const slug = partnerSlugFromPartnerId(DEMO_FURNITURE_PARTNER_ID);
  assert.equal(slug, "demo-furniture-co");
  assert.equal(collectionCreationSlugFor({ name: SHOWROOM_NAME }), SHOWROOM_SLUG);
  assert.equal(collectionIdForCreate(slug!, SHOWROOM_SLUG), SHOWROOM_ID);
  assert.equal(collectionCreationSlugFor({ name: "Renamed Later", creationSlug: SHOWROOM_SLUG }), SHOWROOM_SLUG);
  assert.equal(collectionCreationSlugFor({ name: "???" }), null);
});

test("PI-5G4c parser keeps old patches valid and rejects forbidden Collection create stamps", () => {
  const omitted = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [], deactivate: [], reactivate: [] },
    variants: { create: [], update: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(omitted.ok, true);
  if (!omitted.ok) return;
  assert.deepEqual(omitted.document.collections.create, []);

  const oldPatch = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, name: "Demo Sofa" }], deactivate: [], reactivate: [] },
    variants: { create: [], update: [], deactivate: [], reactivate: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(oldPatch.ok, true);
  if (!oldPatch.ok) return;
  assert.deepEqual(oldPatch.document.collections.create, []);
  assert.equal(oldPatch.document.products.update[0]?.name, "Demo Sofa");

  const valid = parsePartnerCatalogSyncJson(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
  }));
  assert.equal(valid.ok, true, JSON.stringify(valid));
  if (!valid.ok) return;
  assert.equal(valid.document.collections.create?.[0]?.collectionId, SHOWROOM_ID);
  assert.equal(valid.document.collections.create?.[0]?.name, SHOWROOM_NAME);
  assert.deepEqual(Object.keys(valid.document.collections.create?.[0] ?? {}).sort(), ["collectionId", "name"]);

  const malformed = parsePartnerCatalogSyncJson(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME, extra: true } as { collectionId: string; name: string }],
  }));
  assert.equal(malformed.ok, false);

  const missingId = parsePartnerCatalogSyncJson(emptyPatch({
    create: [{ name: SHOWROOM_NAME } as { collectionId: string; name: string }],
  }));
  assert.equal(missingId.ok, false);
  assert.equal(missingId.ok === false && missingId.issues.some((issue) => issue.code === "INVALID_COLLECTION_ID"), true);

  const emptyName = parsePartnerCatalogSyncJson(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: "  " }],
  }));
  assert.equal(emptyName.ok, false);
  assert.equal(emptyName.ok === false && emptyName.issues.some((issue) => issue.code === "EMPTY_COLLECTION_NAME"), true);

  for (const field of ["owner", "partnerId", "partnerName", "status", "sortOrder", "slug", "productIds", "collectionIds"]) {
    const forbidden = parsePartnerCatalogSyncJson({
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      mode: "patch",
      products: { create: [], update: [], deactivate: [], reactivate: [] },
      variants: { create: [], update: [], deactivate: [], reactivate: [] },
      collections: {
        create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME, [field]: "nope" }],
        update: [],
        membershipAdd: [],
        membershipRemove: [],
      },
    });
    assert.equal(forbidden.ok, false, field);
  }

  const snapshot = parsePartnerCatalogSyncJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "snapshot",
    products: { create: [], update: [] },
    variants: { create: [], update: [] },
    collections: { create: [], update: [], membershipAdd: [], membershipRemove: [] },
  });
  assert.equal(snapshot.ok, false);
});

test("PI-5G4c planner stamps Collection create and keeps empty Collection as a change", () => {
  const { catalog } = certifiedScopedCatalog();
  const empty = planDocument(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
  }), catalog);
  assert.equal(empty.ok, true, JSON.stringify(empty.issues));
  assert.equal(empty.noOp, false);
  assert.equal(empty.collectionCreates.length, 1);
  const created = empty.collectionCreates[0]?.collection;
  assert.ok(created);
  assert.equal(created.collectionId, SHOWROOM_ID);
  assert.equal(created.name, SHOWROOM_NAME);
  assert.equal(created.owner, "partner");
  assert.equal(created.partnerName, "Demo Furniture Co.");
  assert.equal(created.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.deepEqual(created.productIds, []);
  assert.equal(empty.membershipAdds.length, 0);
  assert.equal(typeof empty.collectionCreates[0]?.sortOrder, "number");

  const withLive = planDocument(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
    membershipAdd: [{ productId: DEMO_SOFA_PRODUCT_ID, collectionId: SHOWROOM_ID }],
  }), catalog);
  assert.equal(withLive.ok, true, JSON.stringify(withLive.issues));
  assert.equal(withLive.collectionCreates[0]?.collection.collectionId, SHOWROOM_ID);
  assert.equal(withLive.membershipAdds.some((item) => (
    item.productId === DEMO_SOFA_PRODUCT_ID && item.collectionId === SHOWROOM_ID
  )), true);
  assert.equal(withLive.collectionCreates[0]?.collection.productIds.includes(DEMO_SOFA_PRODUCT_ID), true);

  const dupLive = tryPlan(emptyPatch({
    create: [{ collectionId: DEMO_LIVING_ROOM_COLLECTION_ID, name: "Living Room Copy" }],
  }), catalog);
  assert.ok(dupLive.plan);
  assert.equal(dupLive.plan.ok, false);
  assert.equal(dupLive.plan.issues.some((issue) => issue.code === "DUPLICATE_COLLECTION_ID"), true);

  const dupPending = tryPlan(emptyPatch({
    create: [
      { collectionId: SHOWROOM_ID, name: SHOWROOM_NAME },
      { collectionId: SHOWROOM_ID, name: "Also Showroom" },
    ],
  }), catalog);
  assert.ok(dupPending.plan);
  assert.equal(dupPending.plan.ok, false);
  assert.equal(dupPending.plan.issues.some((issue) => issue.code === "DUPLICATE_COLLECTION_ID"), true);

  const mismatch = tryPlan(emptyPatch({
    create: [{ collectionId: "col-other-furniture-co-showroom", name: SHOWROOM_NAME }],
  }), catalog);
  assert.ok(mismatch.plan);
  assert.equal(mismatch.plan.ok, false);
  assert.equal(mismatch.plan.issues.some((issue) => issue.code === "COLLECTION_NAMESPACE_MISMATCH"), true);

  const sameName = planDocument(emptyPatch({
    create: [
      { collectionId: SHOWROOM_ID, name: SHOWROOM_NAME },
      { collectionId: ALT_SHOWROOM_ID, name: SHOWROOM_NAME },
    ],
  }), catalog);
  assert.equal(sameName.ok, true, JSON.stringify(sameName.issues));
  assert.equal(sameName.collectionCreates.length, 2);

  const createAndUpdate = tryPlan(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
    update: [{ collectionId: SHOWROOM_ID, name: "Nope" }],
  }), catalog);
  assert.ok(createAndUpdate.plan);
  assert.equal(createAndUpdate.plan.ok, false);
  assert.equal(createAndUpdate.plan.issues.some((issue) => issue.code === "NOT_FOUND"), true);

  const oldPatch = planDocument(emptyPatch(), catalog);
  assert.equal(oldPatch.ok, true);
  assert.deepEqual(oldPatch.collectionCreates, []);
});

test("PI-5G4c planner folds pending Product then Collection before membership", () => {
  const { catalog } = certifiedScopedCatalog();
  const plan = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      create: [{
        productId: OTTOMAN_PRODUCT_ID,
        name: OTTOMAN_NAME,
        imageUrl: OTTOMAN_IMAGE,
        productUrl: OTTOMAN_URL,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariantId: OTTOMAN_VARIANT_ID,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    variants: {
      create: [{
        variantId: OTTOMAN_VARIANT_ID,
        productId: OTTOMAN_PRODUCT_ID,
        finishLabel: "Natural",
        sku: OTTOMAN_SKU,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [{ productId: OTTOMAN_PRODUCT_ID, collectionId: SHOWROOM_ID }],
      membershipRemove: [],
    },
  }, catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.productCreates[0]?.product.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(plan.variantCreates[0]?.variant.variantId, OTTOMAN_VARIANT_ID);
  assert.equal(plan.collectionCreates[0]?.collection.collectionId, SHOWROOM_ID);
  assert.equal(plan.membershipAdds.some((item) => (
    item.productId === OTTOMAN_PRODUCT_ID && item.collectionId === SHOWROOM_ID
  )), true);
  assert.equal(partnerRuntimePlanNeedsV4(plan), true);
  assert.equal(partnerRuntimePlanNeedsV3(plan), true);
});

test("PI-5G4c patch and F3C snapshot planners agree on Collection create rows", () => {
  const { catalog, folded } = certifiedScopedCatalog();
  const emptyPatchPlan = planDocument(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
  }), catalog);
  assert.equal(emptyPatchPlan.ok, true, JSON.stringify(emptyPatchPlan.issues));
  const emptySnapshot = snapshotFromCurrent(folded, {
    collection: { collectionId: SHOWROOM_ID, name: SHOWROOM_NAME, slug: SHOWROOM_SLUG },
  });
  const emptySnapPlan = planPartnerCatalogSnapshotSync({
    current: folded,
    document: emptySnapshot,
    catalog: durableAssetCatalogForPlanning(catalog),
    seedAssets: catalog.assets,
    repoRoot: ROOT,
  });
  assert.equal(emptySnapPlan.ok, true, JSON.stringify(emptySnapPlan.issues));
  const patchEmpty = emptyPatchPlan.collectionCreates.find((item) => item.collection.collectionId === SHOWROOM_ID)?.collection;
  const snapEmpty = emptySnapPlan.collectionCreates.find((item) => item.collection.collectionId === SHOWROOM_ID)?.collection;
  assert.ok(patchEmpty && snapEmpty);
  assert.equal(patchEmpty.collectionId, snapEmpty.collectionId);
  assert.equal(patchEmpty.name, snapEmpty.name);
  assert.equal(patchEmpty.owner, snapEmpty.owner);
  assert.equal(patchEmpty.partnerName, snapEmpty.partnerName);
  assert.equal(patchEmpty.partnerId, snapEmpty.partnerId);
  assert.deepEqual(patchEmpty.productIds, []);
  assert.deepEqual(snapEmpty.productIds, []);
  assert.equal(emptyPatchPlan.membershipAdds.length, 0);

  const livePatch = planDocument(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
    membershipAdd: [{ productId: DEMO_SOFA_PRODUCT_ID, collectionId: SHOWROOM_ID }],
  }), catalog);
  const liveSnapshotDoc = snapshotFromCurrent(folded, {
    collection: { collectionId: SHOWROOM_ID, name: SHOWROOM_NAME, slug: SHOWROOM_SLUG },
    memberProductId: DEMO_SOFA_PRODUCT_ID,
  });
  const liveSnapPlan = planPartnerCatalogSnapshotSync({
    current: folded,
    document: liveSnapshotDoc,
    catalog: durableAssetCatalogForPlanning(catalog),
    seedAssets: catalog.assets,
    repoRoot: ROOT,
  });
  assert.equal(livePatch.ok, true, JSON.stringify(livePatch.issues));
  assert.equal(liveSnapPlan.ok, true, JSON.stringify(liveSnapPlan.issues));
  assert.equal(livePatch.collectionCreates[0]?.collection.collectionId, liveSnapPlan.collectionCreates[0]?.collection.collectionId);
  assert.equal(livePatch.membershipAdds.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(liveSnapPlan.membershipAdds.some((item) => item.productId === DEMO_SOFA_PRODUCT_ID), true);

  const crossPatch = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      create: [{
        productId: OTTOMAN_PRODUCT_ID,
        name: OTTOMAN_NAME,
        imageUrl: OTTOMAN_IMAGE,
        productUrl: OTTOMAN_URL,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariantId: OTTOMAN_VARIANT_ID,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    variants: {
      create: [{
        variantId: OTTOMAN_VARIANT_ID,
        productId: OTTOMAN_PRODUCT_ID,
        finishLabel: "Natural",
        sku: OTTOMAN_SKU,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [{ productId: OTTOMAN_PRODUCT_ID, collectionId: SHOWROOM_ID }],
      membershipRemove: [],
    },
  }, catalog);
  const crossSnapshot = snapshotFromCurrent(folded, {
    collection: { collectionId: SHOWROOM_ID, name: SHOWROOM_NAME, slug: SHOWROOM_SLUG },
    product: {
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
        collectionIds: [SHOWROOM_ID],
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
    },
  });
  const crossSnapPlan = planPartnerCatalogSnapshotSync({
    current: folded,
    document: crossSnapshot,
    catalog: durableAssetCatalogForPlanning(catalog),
    seedAssets: catalog.assets,
    repoRoot: ROOT,
  });
  assert.equal(crossPatch.ok, true, JSON.stringify(crossPatch.issues));
  assert.equal(crossSnapPlan.ok, true, JSON.stringify(crossSnapPlan.issues));
  assert.equal(crossPatch.productCreates[0]?.product.productId, crossSnapPlan.productCreates[0]?.product.productId);
  assert.equal(crossPatch.variantCreates[0]?.variant.variantId, crossSnapPlan.variantCreates[0]?.variant.variantId);
  assert.equal(crossPatch.collectionCreates[0]?.collection.collectionId, crossSnapPlan.collectionCreates[0]?.collection.collectionId);
  assert.equal(crossPatch.membershipAdds[0]?.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(crossSnapPlan.membershipAdds.some((item) => item.productId === OTTOMAN_PRODUCT_ID), true);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-publish.ts"), /planPartnerCatalogSnapshotSync/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-draft-mutations.ts"), /planPartnerCatalogSnapshotSync/);
  assert.doesNotMatch(source("app/partner/catalog/drafts/[draftId]/page.tsx"), /planPartnerCatalogSnapshotSync/);
});

test("PI-5G4c draft create derives Collection ID, freezes rename, and cascades remove", async () => {
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
  assert.deepEqual(empty.document.collections.create ?? [], []);
  assert.deepEqual(empty.touchedBase, { products: {}, variants: {}, collections: {} });

  const spoof = parsePartnerDraftMutation({
    ...collectionCreateMutation(),
    collectionId: "col-browser-authored",
  });
  assert.equal(spoof.ok, false);

  const created = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [collectionCreateMutation({ productIds: [DEMO_SOFA_PRODUCT_ID] })],
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const dto = draftFrom(created.body);
  assert.equal(dto.document.collections.create?.[0]?.collectionId, SHOWROOM_ID);
  assert.equal(dto.document.collections.create?.[0]?.name, SHOWROOM_NAME);
  assert.deepEqual(dto.document.collections.membershipAdd, [{
    productId: DEMO_SOFA_PRODUCT_ID,
    collectionId: SHOWROOM_ID,
  }]);
  assert.deepEqual(dto.touchedBase.collections, {});
  assert.equal(dto.touchedBase.collections[SHOWROOM_ID], undefined);

  const renamed = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "collection.create_edit", collectionId: SHOWROOM_ID, name: "G4c Showroom Deluxe" }],
    },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  const afterRename = draftFrom(renamed.body);
  assert.equal(afterRename.document.collections.create?.[0]?.collectionId, SHOWROOM_ID);
  assert.equal(afterRename.document.collections.create?.[0]?.name, "G4c Showroom Deluxe");

  const liveName = applyPartnerDraftMutation(afterRename.document, catalog, {
    type: "collection.set_name",
    collectionId: SHOWROOM_ID,
    name: "Should fail",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(liveName.ok, false);

  const unselected = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "collection.create_edit", collectionId: SHOWROOM_ID, productIds: [] }],
    },
  });
  assert.equal(unselected.status, 200);
  assert.deepEqual(draftFrom(unselected.body).document.collections.membershipAdd, []);
  assert.deepEqual(draftFrom(unselected.body).document.collections.membershipRemove, []);

  const explicit = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 4,
      mutations: [collectionCreateMutation({
        name: "Custom Identity",
        creationSlug: "g4c-custom",
      })],
    },
  });
  assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
  assert.equal(
    draftFrom(explicit.body).document.collections.create?.some((item) => item.collectionId === "col-demo-furniture-co-g4c-custom"),
    true,
  );

  const pendingProduct = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 5,
      mutations: [ottomanCreateMutation(catalog)],
    },
  });
  assert.equal(pendingProduct.status, 200, JSON.stringify(pendingProduct.body));
  const withPendingProduct = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 6,
      mutations: [{
        type: "collection.create_edit",
        collectionId: SHOWROOM_ID,
        productIds: [OTTOMAN_PRODUCT_ID],
      }],
    },
  });
  assert.equal(withPendingProduct.status, 200, JSON.stringify(withPendingProduct.body));
  const pendingMembership = draftFrom(withPendingProduct.body);
  assert.deepEqual(pendingMembership.document.collections.membershipAdd, [{
    productId: OTTOMAN_PRODUCT_ID,
    collectionId: SHOWROOM_ID,
  }]);

  const removedProduct = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 7,
      mutations: [{ type: "product.create_remove", productId: OTTOMAN_PRODUCT_ID }],
    },
  });
  assert.equal(removedProduct.status, 200);
  assert.equal(
    draftFrom(removedProduct.body).document.collections.membershipAdd.some((item) => item.productId === OTTOMAN_PRODUCT_ID),
    false,
  );

  const stale = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "collection.create_edit", collectionId: SHOWROOM_ID, name: "Stale" }],
    },
  });
  assert.equal(stale.status, 409);

  const removed = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 8,
      mutations: [{ type: "collection.create_remove", collectionId: SHOWROOM_ID }],
    },
  });
  assert.equal(removed.status, 200);
  const afterRemove = draftFrom(removed.body);
  assert.equal(afterRemove.document.collections.create?.some((item) => item.collectionId === SHOWROOM_ID), false);
  assert.equal(afterRemove.document.collections.membershipAdd.some((item) => item.collectionId === SHOWROOM_ID), false);

  const liveTouch = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 9,
      mutations: [{
        type: "collection.set_membership",
        collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
        productIds: [DEMO_SOFA_PRODUCT_ID],
      }],
    },
  });
  assert.equal(liveTouch.status, 200);
  assert.ok(draftFrom(liveTouch.body).touchedBase.collections[DEMO_LIVING_ROOM_COLLECTION_ID]?.membership_product_ids);
});

test("PI-5G4c pending Collection membership does not require live membership touched_base", () => {
  const { catalog } = certifiedScopedCatalog();
  const plan = planDocument(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
    membershipAdd: [{ productId: DEMO_SOFA_PRODUCT_ID, collectionId: SHOWROOM_ID }],
  }), catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  const pending = detectPartnerPublishConflicts({
    touchedBase: emptyPartnerDraftTouchedBase(),
    catalog,
    plan,
  });
  assert.equal(pending.missingCoverage, false);
  assert.equal(pending.conflicts.length, 0);

  const crossCreate = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      create: [{
        productId: OTTOMAN_PRODUCT_ID,
        name: OTTOMAN_NAME,
        imageUrl: OTTOMAN_IMAGE,
        productUrl: OTTOMAN_URL,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariantId: OTTOMAN_VARIANT_ID,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    variants: {
      create: [{
        variantId: OTTOMAN_VARIANT_ID,
        productId: OTTOMAN_PRODUCT_ID,
        finishLabel: "Natural",
        sku: OTTOMAN_SKU,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [{ productId: OTTOMAN_PRODUCT_ID, collectionId: SHOWROOM_ID }],
      membershipRemove: [],
    },
  }, catalog);
  assert.equal(crossCreate.ok, true, JSON.stringify(crossCreate.issues));
  const crossConflicts = detectPartnerPublishConflicts({
    touchedBase: emptyPartnerDraftTouchedBase(),
    catalog,
    plan: crossCreate,
  });
  assert.equal(crossConflicts.missingCoverage, false);
  assert.equal(crossConflicts.conflicts.length, 0);

  const liveMissing = detectPartnerPublishConflicts({
    touchedBase: emptyPartnerDraftTouchedBase(),
    catalog,
    plan: {
      ...emptyPlan(catalog),
      ok: true,
      membershipAdds: [{ productId: DEMO_SOFA_PRODUCT_ID, collectionId: DEMO_LIVING_ROOM_COLLECTION_ID, sortOrder: 0 }],
    },
  });
  assert.equal(liveMissing.missingCoverage, true);

  const living = catalog.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.ok(living);
  const liveStale = detectPartnerPublishConflicts({
    touchedBase: {
      products: {},
      variants: {},
      collections: {
        [DEMO_LIVING_ROOM_COLLECTION_ID]: { membership_product_ids: ["prod-missing"] },
      },
    },
    catalog,
    plan: {
      ...emptyPlan(catalog),
      ok: true,
      membershipAdds: [{ productId: DEMO_SOFA_PRODUCT_ID, collectionId: DEMO_LIVING_ROOM_COLLECTION_ID, sortOrder: 0 }],
    },
  });
  assert.equal(liveStale.conflicts.some((item) => item.field === "membership_product_ids"), true);

  const document = emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID);
  const next = applyPartnerDraftMutation(document, catalog, collectionCreateMutation({
    productIds: [DEMO_SOFA_PRODUCT_ID],
  }), DEMO_FURNITURE_PARTNER_ID);
  assert.equal(next.ok, true);
  if (!next.ok) return;
  const touched = nextPartnerDraftTouchedBase({
    previous: emptyPartnerDraftTouchedBase(),
    nextDocument: next.document,
    catalog,
  });
  assert.deepEqual(touched.collections, {});
});

test("PI-5G4c Preview shows Create Collection, empty copy, and does not duplicate membership", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 1, mutations: [collectionCreateMutation()] },
  });
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5g4c-preview-"));
  const before = readdirSync(repoRoot);
  const preview = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
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
    collectionCreates: readonly { collection: { collectionId: string; name: string; productIds: readonly string[] } }[];
    membershipAdds: readonly { productId: string; collectionId: string }[];
  };
  assert.equal(body.ok, true);
  assert.equal(body.noOp, false);
  assert.equal(body.sqlPlan, undefined);
  assert.equal(body.collectionCreates.some((item) => item.collection.collectionId === SHOWROOM_ID), true);
  const view = presentPartnerDraftPreview(body);
  assert.equal("error" in view, false);
  if ("error" in view) return;
  assert.equal(partnerDraftPreviewHasChanges(view), true);
  const created = view.collectionCreates.find((item) => item.collectionId === SHOWROOM_ID);
  assert.ok(created);
  assert.equal(created?.name, SHOWROOM_NAME);
  assert.deepEqual(created?.productIds ?? [], []);
  const workspace = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.match(workspace, /Create Collection/);
  assert.match(workspace, /Collection will be created with no Products/);
  assert.match(workspace, /New Collection — pending publish/);
  assert.match(workspace, /Add Collection/);
  assert.match(workspace, /collection\.create_edit/);
  assert.match(workspace, /collection\.create_remove/);
  assert.match(workspace, /pending publish/);
  assert.deepEqual(readdirSync(repoRoot), before);

  await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{
        type: "collection.create_edit",
        collectionId: SHOWROOM_ID,
        productIds: [DEMO_SOFA_PRODUCT_ID],
      }],
    },
  });
  const withMembers = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 3 },
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot: ROOT,
    }),
  });
  const memberView = presentPartnerDraftPreview(withMembers.body);
  assert.equal("error" in memberView, false);
  if ("error" in memberView) return;
  assert.equal(memberView.collectionCreates[0]?.productIds.includes(DEMO_SOFA_PRODUCT_ID)
    || memberView.membershipAdds.some((item) => item.collectionId === SHOWROOM_ID), true);
  const createdIds = new Set(memberView.collectionCreates.map((item) => item.collectionId));
  assert.equal(memberView.membershipAdds.some((item) => createdIds.has(item.collectionId)) === false
    || workspace.includes("created.has(item.collectionId)"), true);
});

test("PI-5G4c publish selects v4 for Collection create and keeps v1/v2/v3 routing", async () => {
  const { catalog, load, mixed } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  const audit = createMemoryPartnerPublishAuditStore();
  const live = { catalog: mixed };
  const captured = capturingApply(insertingApply(
    createMemoryPartnerRuntimeApply({ store, audit }),
    live,
  ));
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 1, mutations: [collectionCreateMutation()] },
  });
  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    audit,
    apply: captured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    reloadCatalog: async () => loadOf(live.catalog),
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(captured.payloads[0]?.planVersion, 4);
  assert.equal((captured.payloads[0]?.collectionCreates as unknown[])?.length, 1);
  const liveCollection = live.catalog.collections.find((item) => item.collectionId === SHOWROOM_ID);
  assert.ok(liveCollection);
  assert.equal(liveCollection?.owner, "partner");
  const auditRow = audit.rows.find((row) => row.status === "accepted");
  const plan = auditRow?.plan as { planVersion?: number; collectionCreates?: unknown[] };
  assert.equal(plan.planVersion, 4);
  assert.ok(Array.isArray(plan.collectionCreates));

  const clientVersion = parsePartnerPublishBody({ expectedDraftRevision: 2, planVersion: 1 });
  assert.equal(clientVersion.ok, false);

  const productStore = createMemoryPartnerDraftStore();
  const productAudit = createMemoryPartnerPublishAuditStore();
  const productLive = { catalog: certifiedScopedCatalog().mixed };
  const productCaptured = capturingApply(insertingApply(
    createMemoryPartnerRuntimeApply({ store: productStore, audit: productAudit }),
    productLive,
  ));
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: productStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: productStore,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 1, mutations: [ottomanCreateMutation(catalog)] },
  });
  const productOnly = await publishPartnerPatchDraft({
    auth: authOk(),
    store: productStore,
    catalog: load,
    audit: productAudit,
    apply: productCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    reloadCatalog: async () => loadOf(productLive.catalog),
  });
  assert.equal(productOnly.status, 200, JSON.stringify(productOnly.body));
  assert.equal(productCaptured.payloads[0]?.planVersion, 3);

  const updateStore = createMemoryPartnerDraftStore();
  const updateAudit = createMemoryPartnerPublishAuditStore();
  const updateCaptured = capturingApply(createMemoryPartnerRuntimeApply({ store: updateStore, audit: updateAudit }));
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
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Updated Sofa" }],
    },
  });
  const updateOnly = await publishPartnerPatchDraft({
    auth: authOk(),
    store: updateStore,
    catalog: load,
    audit: updateAudit,
    apply: updateCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(updateOnly.status, 200, JSON.stringify(updateOnly.body));
  assert.equal(updateCaptured.payloads[0]?.planVersion, 1);

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
      mutations: [ottomanCreateMutation(catalog), collectionCreateMutation({ productIds: [OTTOMAN_PRODUCT_ID] })],
    },
  });
  const mixedPublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: mixedStore,
    catalog: load,
    audit: mixedAudit,
    apply: mixedCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    reloadCatalog: async () => loadOf(mixedLive.catalog),
  });
  assert.equal(mixedPublish.status, 200, JSON.stringify(mixedPublish.body));
  assert.equal(mixedCaptured.payloads[0]?.planVersion, 4);
  assert.ok(Array.isArray(mixedCaptured.payloads[0]?.productCreates));
  assert.ok(Array.isArray(mixedCaptured.payloads[0]?.collectionCreates));

  const noopStore = createMemoryPartnerDraftStore();
  const noopAudit = createMemoryPartnerPublishAuditStore();
  const noopCaptured = capturingApply(createMemoryPartnerRuntimeApply({ store: noopStore, audit: noopAudit }));
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: noopStore,
    catalog: load,
    draftId: DRAFT_A,
  });
  const noopPublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: noopStore,
    catalog: load,
    audit: noopAudit,
    apply: noopCaptured.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 1 },
  });
  assert.equal(noopPublish.status, 200, JSON.stringify(noopPublish.body));
  assert.equal(noopCaptured.payloads[0]?.planVersion, 1);

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
        sku: "DFC-SOFA-OAK-G4C",
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
});

test("PI-5G4c v4 serializer emits complete Collection rows and v3 still rejects them", () => {
  const { catalog } = certifiedScopedCatalog();
  const plan = planDocument(emptyPatch({
    create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
    membershipAdd: [{ productId: DEMO_SOFA_PRODUCT_ID, collectionId: SHOWROOM_ID }],
  }), catalog);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(partnerRuntimePlanNeedsV4(plan), true);
  assert.equal(partnerRuntimePlanNeedsV3(plan), false);
  assert.equal(partnerRuntimePlanNeedsV2(plan), false);
  assert.deepEqual(g3UnsupportedPublishOperations(plan), ["collectionCreates"]);
  assert.equal(toRuntimeApplyPayload(plan).ok, false);
  assert.equal(toRuntimeApplyPayloadV2(plan).ok, false);
  assert.equal(toRuntimeApplyPayloadV3(plan).ok, false);
  assert.deepEqual(g4cUnsupportedPublishOperations(plan), []);
  const v4 = toRuntimeApplyPayloadV4(plan);
  assert.equal(v4.ok, true);
  if (!v4.ok) return;
  assert.equal(v4.payload.planVersion, 4);
  assert.deepEqual(Object.keys(v4.payload).sort(), [
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
  const collection = v4.payload.collectionCreates[0];
  assert.ok(collection);
  assert.deepEqual(Object.keys(collection).sort(), [
    "collectionId",
    "name",
    "owner",
    "partnerId",
    "partnerName",
    "sortOrder",
    "status",
  ]);
  assert.equal(collection.owner, "partner");
  assert.equal(collection.status, "active");
  assert.equal(collection.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(collection.partnerName, "Demo Furniture Co.");
  assert.equal(v4.payload.membershipAdds[0]?.collectionId, SHOWROOM_ID);
  const persistable = persistableRuntimeApplyPayloadV4(v4.payload);
  assert.equal(persistable.planVersion, 4);
  assert.equal("sqlPlan" in persistable, false);

  const mixedPlan = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: {
      create: [{
        productId: OTTOMAN_PRODUCT_ID,
        name: OTTOMAN_NAME,
        imageUrl: OTTOMAN_IMAGE,
        productUrl: OTTOMAN_URL,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        categoryId: "living-room",
        subcategoryId: "chairs",
        defaultVariantId: OTTOMAN_VARIANT_ID,
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    variants: {
      create: [{
        variantId: OTTOMAN_VARIANT_ID,
        productId: OTTOMAN_PRODUCT_ID,
        finishLabel: "Natural",
        sku: OTTOMAN_SKU,
        priceAmount: OTTOMAN_PRICE,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [{ productId: OTTOMAN_PRODUCT_ID, collectionId: SHOWROOM_ID }],
      membershipRemove: [],
    },
  }, catalog);
  assert.equal(mixedPlan.ok, true, JSON.stringify(mixedPlan.issues));
  const mixed = toRuntimeApplyPayloadV4(mixedPlan);
  assert.equal(mixed.ok, true);
  if (!mixed.ok) return;
  assert.equal(mixed.payload.productCreates[0]?.productId, OTTOMAN_PRODUCT_ID);
  assert.equal(mixed.payload.variantCreates[0]?.variantId, OTTOMAN_VARIANT_ID);
  assert.equal(mixed.payload.collectionCreates[0]?.collectionId, SHOWROOM_ID);

  const variantPlan = planDocument({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    mode: "patch",
    products: { create: [], update: [], deactivate: [], reactivate: [] },
    variants: {
      create: [{
        variantId: OAK_VARIANT_ID,
        productId: DEMO_SOFA_PRODUCT_ID,
        finishLabel: "Oak",
        sku: "DFC-SOFA-OAK-G4C",
        priceAmount: 1499,
        priceCurrency: "USD",
        productUrl: null,
        currentAssetId: sofaAssetId(catalog),
      }],
      update: [],
      deactivate: [],
      reactivate: [],
    },
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [],
      membershipRemove: [],
    },
  }, catalog);
  assert.equal(variantPlan.ok, true, JSON.stringify(variantPlan.issues));
  assert.equal(partnerRuntimePlanNeedsV4(variantPlan), true);
  assert.equal(toRuntimeApplyPayloadV4(variantPlan).ok, true);

  const noop = emptyPlan(catalog);
  assert.equal(partnerRuntimePlanNeedsV4(noop), false);
  assert.equal(partnerRuntimePlanNeedsV3(noop), false);
  assert.equal(partnerRuntimePlanNeedsV2(noop), false);

  const deactivatePlan: PartnerCatalogSyncPlan = {
    ...plan,
    productDeactivations: [{ productId: DEMO_SOFA_PRODUCT_ID, from: "active", to: "inactive" }],
  };
  assert.equal(toRuntimeApplyPayloadV4(deactivatePlan).ok, false);
  const malformed: PartnerCatalogSyncPlan = {
    ...plan,
    collectionCreates: [{
      collection: {
        collectionId: SHOWROOM_ID,
        name: SHOWROOM_NAME,
        owner: "vibode",
        partnerName: "Demo Furniture Co.",
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        productIds: [],
      },
      sortOrder: 0,
    }],
  };
  assert.equal(toRuntimeApplyPayloadV4(malformed).ok, false);
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
    collections: {
      create: [{ collectionId: SHOWROOM_ID, name: SHOWROOM_NAME }],
      update: [],
      membershipAdd: [],
      membershipRemove: [],
    },
  }, catalog);
  assert.equal(retarget.issues.some((issue) => issue.code === "ASSET_RETARGET_REQUIRED"), true);
});

test("PI-5G4c Node paths do not DML commercial, Asset, or Scene tables", () => {
  for (const file of [
    "lib/vibode-stage/partner-catalog-publish.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor-v3.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor-v4.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.server.ts",
    "lib/vibode-stage/partner-draft-mutations.ts",
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
  assert.match(source("lib/vibode-stage/partner-draft-mutations.ts"), /"collection.create"/);
  assert.match(source("package.json"), /test:afc-v2-pi5g4c/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-runtime-executor.ts"), /PARTNER_RUNTIME_PLAN_VERSION_4|planVersion: 4/);
  assert.doesNotMatch(source(G3_SQL), /vibode_stage_apply_partner_patch_v4/);
  assert.doesNotMatch(source(G4A_SQL), /vibode_stage_apply_partner_patch_v4/);
  assert.doesNotMatch(source(G4B_SQL), /vibode_stage_apply_partner_patch_v4/);
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /STAGE_PARTNER_APPLY_RPC_V4/);
  const joined = PI5G4C_FILES.map((file) => source(file)).join("\n");
  assert.doesNotMatch(joined, /writeGeneratedFurnitureAssetRegistry/);
});
