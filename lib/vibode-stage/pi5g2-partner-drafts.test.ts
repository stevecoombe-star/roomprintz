import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";

import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
  DEMO_SOFA_STONE_VARIANT_ID,
} from "./partner-catalog";
import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import {
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
  parsePartnerCatalogSyncJson,
} from "./partner-catalog-sync";
import {
  DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
  DEMO_COFFEE_TABLE_PRODUCT_ID,
} from "./partner-package";
import {
  resolvePartnerPortalAuth,
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
  type StagePartnerMembershipRow,
} from "./partner-portal-auth";
import { partnerCatalogFromDurableSnapshot } from "./partner-portal-catalog";
import {
  partnerDraftPreviewHasChanges,
  presentPartnerDraftPreview,
} from "./partner-draft-preview-view";
import {
  applyPartnerDraftMutation,
  applyPartnerDraftMutations,
  countPartnerDraftOperations,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutation,
  PARTNER_DRAFT_MAX_JSON_BYTES,
  PARTNER_DRAFT_MAX_OPERATIONS,
} from "./partner-draft-mutations";
import {
  createMemoryPartnerDraftStore,
  getOrCreatePartnerPatchDraft,
  getPartnerDraft,
  mutatePartnerDraft,
  partnerCatalogCommercialFingerprint,
  previewPersistedPartnerDraft,
  STAGE_PARTNER_DRAFTS_TABLE,
  type PartnerDraftRow,
  type PartnerPortalDraftDto,
} from "./partner-portal-drafts";
import type { StagePartner } from "./types";

const ROOT = process.cwd();
const DRAFT_SQL = "supabase/migrations/20260916180000_vibode_stage_partner_drafts.sql";
const MEMBERSHIP_SQL = "supabase/migrations/20260916120000_vibode_stage_partner_memberships.sql";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const USER_B = "44444444-4444-4444-4444-444444444444";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DRAFT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const PI5G2_FILES = [
  DRAFT_SQL,
  "lib/vibode-stage/partner-draft-mutations.ts",
  "lib/vibode-stage/partner-draft-preview-view.ts",
  "lib/vibode-stage/partner-portal-drafts.ts",
  "lib/vibode-stage/partner-portal-drafts.ts",
  "lib/vibode-stage/partner-portal-drafts.server.ts",
  "app/api/vibode/partner/drafts/route.ts",
  "app/api/vibode/partner/drafts/[draftId]/route.ts",
  "app/api/vibode/partner/drafts/[draftId]/preview/route.ts",
  "app/partner/catalog/page.tsx",
  "app/partner/catalog/PartnerCatalogDraftEntry.tsx",
  "app/partner/catalog/drafts/[draftId]/page.tsx",
  "app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx",
];

const LIVE_CATALOG_TABLES = [
  "vibode_stage_partners",
  "vibode_stage_products",
  "vibode_stage_variants",
  "vibode_stage_collections",
  "vibode_stage_product_collections",
  "vibode_stage_assets",
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

function otherPartner(): StagePartner {
  return {
    partnerId: OTHER_PARTNER_ID,
    name: "Other Furniture Co.",
    slug: "other-furniture-co",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  };
}

function membership(
  overrides: Partial<StagePartnerMembershipRow> = {},
): StagePartnerMembershipRow {
  return {
    membershipId: "11111111-1111-1111-1111-111111111111",
    userId: USER_A,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    role: "owner",
    status: "active",
    ...overrides,
  };
}

function context(partner = demoPartner(), userId = USER_A): PartnerPortalContext {
  return {
    userId,
    partnerId: partner.partnerId,
    role: "owner",
    membershipId: userId === USER_A ? "11111111-1111-1111-1111-111111111111" : "33333333-3333-3333-3333-333333333333",
    partner,
  };
}

function authOk(partner = demoPartner(), userId = USER_A): PartnerPortalAuthResult {
  return { ok: true, context: context(partner, userId) };
}

function authFail(
  code: "unauthenticated" | "forbidden" | "membership_revoked",
  status: 401 | 403,
): PartnerPortalAuthResult {
  return { ok: false, code, status, error: status === 401 ? "Unauthorized" : "Forbidden" };
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

function hasIssue(result: { issues: readonly { code: string }[] }, code: string): boolean {
  return result.issues.some((item) => item.code === code);
}

test("PI-5G2 draft schema is Partner-owned, schema-only, and service-role DML", () => {
  const sql = source(DRAFT_SQL);
  assert.match(sql, /create table public\.vibode_stage_partner_drafts/);
  assert.match(sql, /partner_id text not null references public\.vibode_stage_partners/);
  assert.match(sql, /created_by_user_id uuid references auth\.users/);
  assert.match(sql, /updated_by_user_id uuid references auth\.users/);
  assert.match(sql, /document_kind in \('patch'\)/);
  assert.match(sql, /status in \('open', 'abandoned'\)/);
  assert.match(sql, /revision >= 1/);
  assert.match(sql, /jsonb_typeof\(document\) = 'object'/);
  assert.match(sql, /vibode_stage_partner_drafts_one_open_patch_idx/);
  assert.match(sql, /where status = 'open' and document_kind = 'patch'/);
  assert.match(sql, /vibode_stage_partner_drafts_partner_id_idx/);
  assert.match(sql, /vibode_stage_partner_drafts_partner_status_idx/);
  assert.match(sql, /set_timestamp_vibode_stage_partner_drafts/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.vibode_stage_partner_drafts/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_stage_partner_drafts\s+to service_role/);
  assert.doesNotMatch(sql, /create policy/);
  assert.doesNotMatch(sql, /insert into public\.vibode_stage_partner_drafts/i);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(sql, /@/);
  assert.doesNotMatch(sql, /references public\.vibode_stage_partner_memberships/);
  assert.doesNotMatch(source(MEMBERSHIP_SQL), /vibode_stage_partner_drafts/);
});

test("PI-5G2 authorization reuses G1 membership and hides foreign drafts", async () => {
  const { load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  const created = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  assert.equal(created.status, 201);
  const draftId = draftFrom(created.body).draftId;

  const unauthenticated = await getPartnerDraft({
    auth: authFail("unauthenticated", 401),
    store,
    draftId,
  });
  assert.equal(unauthenticated.status, 401);

  const none = await getOrCreatePartnerPatchDraft({
    auth: resolvePartnerPortalAuth({
      userId: USER_A,
      memberships: { ok: true, rows: [] },
      partner: demoPartner(),
    }),
    store,
    catalog: load,
  });
  assert.equal(none.status, 403);

  const revoked = await getPartnerDraft({
    auth: authFail("membership_revoked", 403),
    store,
    draftId,
  });
  assert.equal(revoked.status, 403);

  const inactive = await getOrCreatePartnerPatchDraft({
    auth: authOk(demoPartner("inactive")),
    store,
    catalog: load,
  });
  assert.equal(inactive.status, 200);
  assert.equal(draftFrom(inactive.body).draftId, draftId);

  const foreign = await getPartnerDraft({
    auth: authOk(otherPartner(), USER_B),
    store,
    draftId,
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, { ok: false, error: "Not found." });

  const otherStore = createMemoryPartnerDraftStore();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(otherPartner(), USER_B),
    store: otherStore,
    catalog: load,
    draftId: DRAFT_B,
  });
  await otherStore.insertOpenPatch({
    ...(store.rows[0] as PartnerDraftRow),
    draftId: DRAFT_A,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  const isolated = await getPartnerDraft({
    auth: authOk(otherPartner(), USER_B),
    store: otherStore,
    draftId: DRAFT_A,
  });
  assert.equal(isolated.status, 404);

  const escalated = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId,
    body: {
      expectedRevision: 1,
      partnerId: OTHER_PARTNER_ID,
      createdByUserId: USER_B,
      updatedByUserId: USER_B,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Escalated Sofa" }],
    },
  });
  assert.equal(escalated.status, 200);
  assert.equal(draftFrom(escalated.body).partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(draftFrom(escalated.body).document.partnerId, DEMO_FURNITURE_PARTNER_ID);
});

test("PI-5G2 get-or-create, reload, update, and abandon persist Partner-owned drafts", async () => {
  const { load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  const first = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  assert.equal(first.status, 201);
  const created = draftFrom(first.body);
  assert.equal(created.revision, 1);
  assert.equal(created.status, "open");
  assert.equal(created.documentKind, "patch");
  const parsedEmpty = parsePartnerCatalogSyncJson(created.document);
  assert.equal(parsedEmpty.ok, true);
  assert.equal(countPartnerDraftOperations(created.document), 0);

  const second = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
  });
  assert.equal(second.status, 200);
  assert.equal(draftFrom(second.body).draftId, created.draftId);

  const reloaded = await getPartnerDraft({ auth: authOk(), store, draftId: created.draftId });
  assert.equal(reloaded.status, 200);
  assert.equal(draftFrom(reloaded.body).document.products.update.length, 0);

  const updated = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: created.draftId,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Demo Sofa (preview)" }],
    },
  });
  assert.equal(updated.status, 200);
  const afterUpdate = draftFrom(updated.body);
  assert.equal(afterUpdate.revision, 2);
  assert.equal(afterUpdate.document.products.update[0]?.name, "Demo Sofa (preview)");

  const afterReload = await getPartnerDraft({ auth: authOk(), store, draftId: created.draftId });
  assert.equal(draftFrom(afterReload.body).document.products.update[0]?.name, "Demo Sofa (preview)");

  const abandoned = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: created.draftId,
    body: { expectedRevision: 2, status: "abandoned" },
  });
  assert.equal(abandoned.status, 200);
  assert.equal(draftFrom(abandoned.body).status, "abandoned");
  assert.equal(draftFrom(abandoned.body).revision, 3);

  const mutateAbandoned = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: created.draftId,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Nope" }],
    },
  });
  assert.equal(mutateAbandoned.status, 404);

  const nextOpen = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_B,
  });
  assert.equal(nextOpen.status, 201);
  const fresh = draftFrom(nextOpen.body);
  assert.notEqual(fresh.draftId, created.draftId);
  assert.equal(fresh.revision, 1);
  assert.equal(fresh.document.products.update.length, 0);

  const stillReadable = await getPartnerDraft({ auth: authOk(), store, draftId: created.draftId });
  assert.equal(draftFrom(stillReadable.body).status, "abandoned");
});

test("PI-5G2 optimistic revision rejects stale saves without overwrite", async () => {
  const { load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  const first = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Tab one" }],
    },
  });
  assert.equal(first.status, 200);
  assert.equal(draftFrom(first.body).revision, 2);

  const stale = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Tab two" }],
    },
  });
  assert.equal(stale.status, 409);
  const latest = await getPartnerDraft({ auth: authOk(), store, draftId: DRAFT_A });
  assert.equal(draftFrom(latest.body).revision, 2);
  assert.equal(draftFrom(latest.body).document.products.update[0]?.name, "Tab one");
});

test("PI-5G2 commercial fingerprint is stable, partner-scoped, and ignores asset bytes", () => {
  const { catalog } = certifiedScopedCatalog();
  const reversed = createStageCatalogSnapshot({
    authority: catalog.authority,
    fallbackReason: catalog.fallbackReason,
    partners: [...catalog.partners].reverse(),
    products: [...catalog.products].reverse().map((product) => ({
      ...product,
      collectionIds: [...product.collectionIds].reverse(),
    })),
    variants: [...catalog.variants].reverse(),
    collections: [...catalog.collections].reverse().map((collection) => ({
      ...collection,
      productIds: [...collection.productIds].reverse(),
    })),
    assets: [...catalog.assets].reverse().map((asset) => ({
      ...asset,
      glbUrl: `${asset.glbUrl}?nonce=1`,
    })),
  });
  assert.equal(
    partnerCatalogCommercialFingerprint(catalog),
    partnerCatalogCommercialFingerprint(reversed),
  );

  const renamed = createStageCatalogSnapshot({
    authority: catalog.authority,
    products: catalog.products.map((product) => (
      product.productId === DEMO_SOFA_PRODUCT_ID ? { ...product, name: "Renamed" } : product
    )),
    variants: catalog.variants,
    collections: catalog.collections,
    assets: catalog.assets,
    partners: catalog.partners,
  });
  assert.notEqual(
    partnerCatalogCommercialFingerprint(catalog),
    partnerCatalogCommercialFingerprint(renamed),
  );

  const withWebsite = createStageCatalogSnapshot({
    authority: catalog.authority,
    products: catalog.products,
    variants: catalog.variants,
    collections: catalog.collections,
    assets: catalog.assets,
    partners: catalog.partners.map((partner) => ({
      ...partner,
      websiteUrl: "https://example.test/changed",
      logoUrl: "https://example.test/logo.png",
    })),
  });
  assert.equal(
    partnerCatalogCommercialFingerprint(catalog),
    partnerCatalogCommercialFingerprint(withWebsite),
  );
});

test("PI-5G2 product, variant, and collection mutations normalize against live catalog", () => {
  const { catalog } = certifiedScopedCatalog();
  const empty = emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID);
  const sofa = catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  assert.ok(sofa);

  const named = applyPartnerDraftMutation(empty, catalog, {
    type: "product.set_name",
    productId: DEMO_SOFA_PRODUCT_ID,
    name: "Demo Sofa (preview)",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(named.ok, true);
  if (!named.ok) return;
  assert.equal(named.document.products.update[0]?.name, "Demo Sofa (preview)");

  const image = applyPartnerDraftMutation(named.document, catalog, {
    type: "product.set_image_url",
    productId: DEMO_SOFA_PRODUCT_ID,
    imageUrl: "https://example.test/images/demo-sofa-2.jpg",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(image.ok, true);

  const url = applyPartnerDraftMutation(empty, catalog, {
    type: "product.set_product_url",
    productId: DEMO_SOFA_PRODUCT_ID,
    productUrl: "https://example.test/products/demo-sofa-2",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(url.ok, true);

  const priced = applyPartnerDraftMutation(empty, catalog, {
    type: "product.set_price",
    productId: DEMO_SOFA_PRODUCT_ID,
    priceAmount: 1400,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  assert.equal(priced.document.products.update[0]?.priceAmount, 1400);
  assert.equal(priced.document.variants.update[0]?.variantId, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(priced.document.variants.update[0]?.priceAmount, 1400);

  const finish = applyPartnerDraftMutation(empty, catalog, {
    type: "variant.set_finish_label",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    finishLabel: "Stone linen deluxe",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(finish.ok, true);

  const sku = applyPartnerDraftMutation(empty, catalog, {
    type: "variant.set_sku",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    sku: "DFC-SOFA-02B",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(sku.ok, true);

  const variantPrice = applyPartnerDraftMutation(empty, catalog, {
    type: "variant.set_price",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    priceAmount: 1500,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(variantPrice.ok, true);
  if (!variantPrice.ok) return;
  assert.equal(variantPrice.document.products.update.length, 0);

  const variantUrl = applyPartnerDraftMutation(empty, catalog, {
    type: "variant.set_product_url",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    productUrl: "https://example.test/stone",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(variantUrl.ok, true);

  const asset = parsePartnerDraftMutation({
    type: "variant.set_asset",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  });
  assert.equal(asset.ok, false);
  if (!asset.ok) assert.equal(asset.code, "forbidden");

  const assetField = parsePartnerDraftMutation({
    type: "variant.set_sku",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    sku: "X",
    currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  });
  assert.equal(assetField.ok, false);

  const renamed = applyPartnerDraftMutation(empty, catalog, {
    type: "collection.set_name",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
    name: "Living Room Edit",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(renamed.ok, true);

  const living = catalog.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.ok(living);
  const membershipSet = applyPartnerDraftMutation(empty, catalog, {
    type: "collection.set_membership",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
    productIds: [DEMO_SOFA_PRODUCT_ID],
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(membershipSet.ok, true);
  if (!membershipSet.ok) return;
  assert.ok(membershipSet.document.collections.membershipRemove.length > 0);
  assert.equal(membershipSet.document.collections.membershipAdd.length, 0);

  const again = applyPartnerDraftMutation(membershipSet.document, catalog, {
    type: "collection.set_membership",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
    productIds: [DEMO_SOFA_PRODUCT_ID],
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(
    again.document.collections.membershipRemove.map((item) => item.productId).sort(),
    membershipSet.document.collections.membershipRemove.map((item) => item.productId).sort(),
  );

  const restored = applyPartnerDraftMutation(again.document, catalog, {
    type: "collection.set_membership",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
    productIds: [...living.productIds],
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.document.collections.membershipAdd.length, 0);
  assert.equal(restored.document.collections.membershipRemove.length, 0);

  const revertName = applyPartnerDraftMutation(named.document, catalog, {
    type: "product.set_name",
    productId: DEMO_SOFA_PRODUCT_ID,
    name: sofa.name,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(revertName.ok, true);
  if (!revertName.ok) return;
  assert.equal(revertName.document.products.update.length, 0);

  const revertVariant = applyPartnerDraftMutation(sku.document, catalog, {
    type: "variant.set_sku",
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    sku: catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID)?.sku ?? null,
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(revertVariant.ok, true);
  if (!revertVariant.ok) return;
  assert.equal(revertVariant.document.variants.update.length, 0);

  const duplicate = applyPartnerDraftMutations(named.document, catalog, [
    { type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Demo Sofa (preview)" },
    { type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Demo Sofa (again)" },
  ], DEMO_FURNITURE_PARTNER_ID);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.document.products.update.length, 1);
  assert.equal(duplicate.document.products.update[0]?.name, "Demo Sofa (again)");

  const unknown = applyPartnerDraftMutation(empty, catalog, {
    type: "product.set_name",
    productId: "prod-missing",
    name: "Nope",
  }, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(unknown.ok, false);

  const create = parsePartnerDraftMutation({
    type: "variant.create",
    variantId: "var-new",
    productId: DEMO_SOFA_PRODUCT_ID,
  });
  assert.equal(create.ok, false);

  const availability = parsePartnerDraftMutation({
    type: "product.set_status",
    productId: DEMO_SOFA_PRODUCT_ID,
    status: "inactive",
  });
  assert.equal(availability.ok, false);

  const noop = parsePartnerCatalogSyncJson(empty);
  assert.equal(noop.ok, true);
  assert.ok(countPartnerDraftOperations(empty) <= PARTNER_DRAFT_MAX_OPERATIONS);
  assert.ok(JSON.stringify(empty).length < PARTNER_DRAFT_MAX_JSON_BYTES);
});

test("PI-5G2 persisted draft preview uses certified planner and rejects body replacement", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5g2-preview-"));
  const before = readdirSync(repoRoot);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });

  const noop = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {},
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot,
    }),
  });
  assert.equal(noop.status, 200);
  const noopBody = noop.body as { noOp: boolean; sqlPlan?: unknown; ok: boolean };
  assert.equal(noopBody.ok, true);
  assert.equal(noopBody.noOp, true);
  assert.equal(noopBody.sqlPlan, undefined);

  const replaced = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, name: "Stolen preview" }] },
      },
    },
  });
  assert.equal(replaced.status, 400);

  await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Preview Sofa Name" }],
    },
  });
  const named = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: { expectedRevision: 2 },
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot,
    }),
  });
  assert.equal(named.status, 200);
  const namedBody = named.body as {
    ok: boolean;
    noOp: boolean;
    productUpdates: readonly { productId: string; changes: readonly { column: string; next: unknown }[] }[];
  };
  assert.equal(namedBody.ok, true);
  assert.equal(namedBody.noOp, false);
  assert.equal(namedBody.productUpdates.some((item) => (
    item.productId === DEMO_SOFA_PRODUCT_ID
    && item.changes.some((change) => change.column === "name" && change.next === "Preview Sofa Name")
  )), true);

  const skuSave = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "variant.set_sku", variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: "DFC-SOFA-02-EDIT" }],
    },
  });
  assert.equal(skuSave.status, 200);
  const validSku = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {},
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot,
    }),
  });
  const validSkuBody = validSku.body as { ok: boolean; issues: readonly { code: string }[] };
  assert.equal(validSkuBody.ok, true, JSON.stringify(validSkuBody));

  const dup = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "variant.set_sku", variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: "DFC-SOFA-01" }],
    },
  });
  assert.equal(dup.status, 200);
  const dupPreview = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {},
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot,
    }),
  });
  const dupBody = dupPreview.body as { ok: boolean; issues: readonly { code: string }[] };
  assert.equal(dupBody.ok, false);
  assert.equal(hasIssue(dupBody, "DUPLICATE_SKU"), true);

  store.rows[0] = {
    ...store.rows[0]!,
    document: {
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      mode: "patch",
      products: { update: [], deactivate: [], reactivate: [] },
      variants: {
        create: [],
        update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }],
        deactivate: [],
        reactivate: [],
      },
      collections: { update: [], membershipAdd: [], membershipRemove: [] },
    },
  };
  const retarget = await previewPersistedPartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {},
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      repoRoot,
    }),
  });
  const retargetBody = retarget.body as { ok: boolean; issues: readonly { code: string }[] };
  assert.equal(hasIssue(retargetBody, "ASSET_RETARGET_REQUIRED"), true);
  assert.deepEqual(readdirSync(repoRoot), before);
  assert.ok(catalog.products.some((item) => item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID));
});

test("PI-5G2 unique-conflict refetch and get-or-create race return the canonical open draft", async () => {
  const { load } = certifiedScopedCatalog();
  const inner = createMemoryPartnerDraftStore();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: inner,
    catalog: load,
    draftId: DRAFT_A,
  });
  let skipped = false;
  const store = {
    ...inner,
    rows: inner.rows,
    findOpenPatch: async (partnerId: string) => {
      if (!skipped) {
        skipped = true;
        return null;
      }
      return inner.findOpenPatch(partnerId);
    },
  };
  const raced = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_B,
  });
  assert.equal(raced.status, 200);
  assert.equal(draftFrom(raced.body).draftId, DRAFT_A);
});

test("PI-5G2 preview DTO is presented as previous → next instead of discarded", () => {
  const dto = {
    ok: true,
    noOp: false,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    issues: [],
    partnerStatusTransition: null,
    productCreates: [],
    productUpdates: [],
    variantCreates: [],
    variantUpdates: [{
      variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
      productId: DEMO_SOFA_PRODUCT_ID,
      changes: [
        { column: "finish_label", previous: "Natural oak", next: "Natural oak TEST" },
        { column: "sku", previous: "DFC-SOFA-01", next: "DFC-SOFA-01-TEST" },
      ],
    }],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [],
    productReactivations: [],
    variantDeactivations: [],
    variantReactivations: [],
  };
  const view = presentPartnerDraftPreview(dto);
  assert.equal("error" in view, false);
  if ("error" in view) return;
  assert.equal(view.ok, true);
  assert.equal(view.noOp, false);
  assert.equal(partnerDraftPreviewHasChanges(view), true);
  const variant = view.variantUpdates.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(variant);
  assert.equal(variant?.changes.some((change) => (
    change.label === "Finish"
    && change.previous === "Natural oak"
    && change.next === "Natural oak TEST"
  )), true);
  assert.equal(variant?.changes.some((change) => (
    change.label === "SKU"
    && change.previous === "DFC-SOFA-01"
    && change.next === "DFC-SOFA-01-TEST"
  )), true);
  const workspace = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.match(workspace, /presentPartnerDraftPreview/);
  assert.match(workspace, /setPreview\(presented\)/);
  assert.match(workspace, /draft-preview-result/);
  assert.match(workspace, /change\.previous/);
  assert.match(workspace, /change\.next/);
  assert.match(workspace, /DraftPreviewResult/);
});

test("PI-5G2 first-touch touched_base persists, preserves, and normalizes against live", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const store = createMemoryPartnerDraftStore();
  const sofa = catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  const stone = catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  const living = catalog.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.ok(sofa && stone && living);

  const created = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
  });
  assert.equal(created.status, 201);
  const empty = draftFrom(created.body);
  assert.deepEqual(empty.touchedBase, { products: {}, variants: {}, collections: {} });

  const first = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Draft Sofa B" }],
    },
  });
  assert.equal(first.status, 200);
  const afterFirst = draftFrom(first.body);
  assert.equal(afterFirst.touchedBase.products[DEMO_SOFA_PRODUCT_ID]?.name, sofa.name);

  const second = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Draft Sofa C" }],
    },
  });
  assert.equal(second.status, 200);
  assert.equal(draftFrom(second.body).touchedBase.products[DEMO_SOFA_PRODUCT_ID]?.name, sofa.name);

  const reverted = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: sofa.name }],
    },
  });
  assert.equal(reverted.status, 200);
  assert.equal(draftFrom(reverted.body).touchedBase.products[DEMO_SOFA_PRODUCT_ID], undefined);

  const priced = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 4,
      mutations: [{ type: "product.set_price", productId: DEMO_SOFA_PRODUCT_ID, priceAmount: 1400 }],
    },
  });
  assert.equal(priced.status, 200);
  const pricedDraft = draftFrom(priced.body);
  assert.equal(pricedDraft.touchedBase.products[DEMO_SOFA_PRODUCT_ID]?.price_amount, sofa.priceAmount);
  assert.equal(
    pricedDraft.touchedBase.variants[DEMO_SOFA_DEFAULT_VARIANT_ID]?.price_amount,
    catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID)?.priceAmount,
  );

  const membership = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 5,
      mutations: [{
        type: "collection.set_membership",
        collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
        productIds: [DEMO_SOFA_PRODUCT_ID],
      }],
    },
  });
  assert.equal(membership.status, 200);
  assert.deepEqual(
    draftFrom(membership.body).touchedBase.collections[DEMO_LIVING_ROOM_COLLECTION_ID]?.membership_product_ids,
    [...living.productIds].sort((left, right) => left.localeCompare(right)),
  );

  const membershipRestored = await mutatePartnerDraft({
    auth: authOk(),
    store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 6,
      mutations: [{
        type: "collection.set_membership",
        collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
        productIds: [...living.productIds],
      }],
    },
  });
  assert.equal(membershipRestored.status, 200);
  assert.equal(
    draftFrom(membershipRestored.body).touchedBase.collections[DEMO_LIVING_ROOM_COLLECTION_ID]?.membership_product_ids,
    undefined,
  );
});

test("PI-5G2 source stays inside draft authoring and does not write live catalog", () => {
  const joined = PI5G2_FILES.map((file) => source(file)).join("\n");
  assert.equal(STAGE_PARTNER_DRAFTS_TABLE, "vibode_stage_partner_drafts");
  assert.match(source("package.json"), /test:afc-v2-pi5g2/);
  assert.match(source("app/api/vibode/partner/catalog/preview/route.ts"), /partnerPortalPreviewResponse/);
  assert.match(source("lib/vibode-stage/partner-catalog-preview.ts"), /parsePartnerCatalogSyncJson/);
  assert.match(source("lib/vibode-stage/partner-catalog-preview.ts"), /planPartnerCatalogSync/);
  assert.match(source("lib/vibode-stage/partner-portal-drafts.server.ts"), /import "server-only"/);
  assert.match(source("lib/vibode-stage/partner-draft-mutations.ts"), /parsePartnerCatalogSyncJson/);
  assert.match(source("app/partner/catalog/PartnerCatalogDraftEntry.tsx"), /Edit catalog/);
  assert.match(source("app/partner/catalog/PartnerCatalogDraftEntry.tsx"), /Resume draft/);
  assert.match(source("app/partner/catalog/drafts/[draftId]/page.tsx"), /PartnerDraftWorkspaceClient/);
  assert.doesNotMatch(joined, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(joined, /importPartnerCatalogSync|importPartnerCatalogSnapshot|writeFileAtomic/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-drafts.ts"), /vibode_stage_products|\.from\("vibode_stage_variants"\)/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-drafts.server.ts"), /importPartnerCatalogSync|writeFileAtomic/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-preview.server.ts"), /STAGE_PARTNER_DRAFTS_TABLE|\.insert\(|\.update\(/);
  for (const table of LIVE_CATALOG_TABLES) {
    assert.doesNotMatch(source("lib/vibode-stage/partner-portal-drafts.server.ts"), new RegExp(`from\\("${table}"\\)`));
    assert.doesNotMatch(source("app/api/vibode/partner/drafts/route.ts"), new RegExp(table));
    assert.doesNotMatch(source("app/api/vibode/partner/drafts/[draftId]/route.ts"), new RegExp(table));
    assert.doesNotMatch(source("app/api/vibode/partner/drafts/[draftId]/preview/route.ts"), new RegExp(table));
  }
  assert.match(source("lib/vibode-stage/partner-portal-drafts.ts"), /vibode_stage_partner_drafts/);
  assert.match(source("lib/vibode-stage/partner-portal-drafts.server.ts"), /STAGE_PARTNER_DRAFTS_TABLE/);
  assert.doesNotMatch(source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx"), /product\.set_status|variant\.set_asset/);
  assert.match(source("lib/vibode-stage/partner-draft-mutations.ts"), /Inactive Collection/);
});
