import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";

import {
  createStageCatalogSnapshot,
  isStageProductAvailable,
  seedFixtureStageCatalog,
  STAGE_SEED_PRODUCTS,
} from "./catalog";
import { filterStageCatalogProducts } from "./catalog-query";
import { resolveLoadedStageCatalog } from "./catalog-store";
import {
  foldedPartnerStateFromDurableCatalog,
} from "./partner-catalog-live-state";
import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_SOFA_PRODUCT_ID,
} from "./partner-catalog";
import {
  DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
  DEMO_COFFEE_TABLE_PRODUCT_ID,
} from "./partner-package";
import {
  DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
  foldPartnerCatalogCurrentState,
  overlayFoldedPartnerCatalog,
} from "./partner-catalog-sync";
import {
  resolvePartnerPortalAuth,
  resolvePartnerPortalMembership,
  STAGE_PARTNER_MEMBERSHIPS_TABLE,
  type PartnerPortalContext,
  type StagePartnerMembershipRow,
} from "./partner-portal-auth";
import {
  partnerCatalogFromDurableSnapshot,
  scopeDurableCatalogToPartner,
} from "./partner-portal-catalog";
import {
  executePartnerPortalCatalog,
  executePartnerPortalPreview,
  executePartnerPortalSession,
} from "./partner-portal-http";
import type { StagePartner, StageProduct, StageVariant } from "./types";

const ROOT = process.cwd();
const MEMBERSHIP_SQL =
  "supabase/migrations/20260916120000_vibode_stage_partner_memberships.sql";
const OTHER_PARTNER_ID = "partner-other-furniture-co";

const PI5G1_FILES = [
  MEMBERSHIP_SQL,
  "lib/vibode-stage/partner-portal-auth.ts",
  "lib/vibode-stage/partner-portal-auth.server.ts",
  "lib/vibode-stage/partner-portal-catalog.ts",
  "lib/vibode-stage/partner-portal-catalog.server.ts",
  "lib/vibode-stage/partner-catalog-live-state.ts",
  "lib/vibode-stage/partner-catalog-preview.ts",
  "lib/vibode-stage/partner-catalog-preview.server.ts",
  "lib/vibode-stage/partner-portal-http.ts",
  "app/api/vibode/partner/session/route.ts",
  "app/api/vibode/partner/catalog/route.ts",
  "app/api/vibode/partner/catalog/preview/route.ts",
  "app/partner/layout.tsx",
  "app/partner/page.tsx",
  "app/partner/catalog/page.tsx",
  "app/partner/PartnerCatalogPreviewClient.tsx",
  "proxy.ts",
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
    userId: "22222222-2222-2222-2222-222222222222",
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    role: "owner",
    status: "active",
    ...overrides,
  };
}

function context(partner = demoPartner()): PartnerPortalContext {
  return {
    userId: "22222222-2222-2222-2222-222222222222",
    partnerId: partner.partnerId,
    role: "owner",
    membershipId: "11111111-1111-1111-1111-111111111111",
    partner,
  };
}

function certifiedDemoCatalog() {
  const folded = foldPartnerCatalogCurrentState({ repoRoot: ROOT });
  assert.equal(folded.ok, true, JSON.stringify(folded.ok ? null : folded.issues));
  if (!folded.ok) throw new Error("certified fold failed");
  return {
    folded: folded.state,
    mixed: overlayFoldedPartnerCatalog(folded.state),
  };
}

function otherProduct(): StageProduct {
  return {
    productId: "prod-other-furniture-co-secret-sofa",
    brand: "Other Furniture Co.",
    name: "Secret Sofa",
    retailer: "Other Furniture Co.",
    categoryId: "living-room",
    subcategoryId: "sofas",
    productUrl: "https://example.test/other-sofa",
    imageUrl: "https://example.test/other-sofa.jpg",
    priceAmount: 10,
    priceCurrency: "USD",
    defaultVariantId: "var-other-furniture-co-secret-sofa-default",
    collectionIds: Object.freeze(["col-other-furniture-co-secret"]),
    source: "partner_catalog",
    partnerId: OTHER_PARTNER_ID,
    status: "active",
  };
}

function otherVariant(): StageVariant {
  return {
    variantId: "var-other-furniture-co-secret-sofa-default",
    productId: "prod-other-furniture-co-secret-sofa",
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    finishLabel: "Secret",
    sku: "OTHER-SECRET",
    priceAmount: 10,
    priceCurrency: "USD",
    productUrl: null,
    status: "active",
  };
}

function catalogWithOtherPartner(mixed: ReturnType<typeof overlayFoldedPartnerCatalog>) {
  return createStageCatalogSnapshot({
    authority: "durable",
    fallbackReason: null,
    partners: [...mixed.partners, otherPartner()],
    products: [...mixed.products, otherProduct()],
    variants: [...mixed.variants, otherVariant()],
    collections: [
      ...mixed.collections,
      {
        collectionId: "col-other-furniture-co-secret",
        name: "Secret Collection",
        owner: "partner",
        partnerName: "Other Furniture Co.",
        partnerId: OTHER_PARTNER_ID,
        productIds: Object.freeze(["prod-other-furniture-co-secret-sofa"]),
      },
    ],
    assets: mixed.assets,
  });
}

function hasIssue(result: { issues: readonly { code: string }[] }, code: string): boolean {
  return result.issues.some((item) => item.code === code);
}

test("PI-5G1 membership schema is Portal access only and environment-independent", () => {
  const sql = source(MEMBERSHIP_SQL);
  assert.match(sql, /create table public\.vibode_stage_partner_memberships/);
  assert.match(sql, /user_id uuid not null references auth\.users/);
  assert.match(sql, /partner_id text not null references public\.vibode_stage_partners/);
  assert.match(sql, /unique \(user_id, partner_id\)/);
  assert.match(sql, /role in \('owner'\)/);
  assert.match(sql, /status in \('active', 'revoked'\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.vibode_stage_partner_memberships/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_stage_partner_memberships\s+to service_role/);
  assert.match(sql, /vibode_stage_partner_memberships_active_user_idx/);
  assert.match(sql, /set_timestamp_vibode_stage_partner_memberships/);
  assert.doesNotMatch(sql, /insert into public\.vibode_stage_partner_memberships/i);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(sql, /VIBODE_ADMIN_EMAIL|isAdminEmail|@/);
  assert.doesNotMatch(sql, /alter table public\.vibode_stage_partners/);
  assert.doesNotMatch(sql, /grant insert, update, delete on table public\.vibode_stage_products/i);
  assert.doesNotMatch(sql, /create policy/);
});

test("PI-5G1 authorization is membership-derived and independent of admin email and Partner status", () => {
  const userId = "22222222-2222-2222-2222-222222222222";
  const none = resolvePartnerPortalMembership({
    userId: null,
    memberships: { ok: true, rows: [] },
  });
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.equal(none.status, 401);
    assert.equal(none.code, "unauthenticated");
  }

  const noMembership = resolvePartnerPortalAuth({
    userId,
    memberships: { ok: true, rows: [] },
    partner: demoPartner(),
  });
  assert.equal(noMembership.ok, false);
  if (!noMembership.ok) {
    assert.equal(noMembership.status, 403);
    assert.equal(noMembership.code, "forbidden");
  }

  const revoked = resolvePartnerPortalAuth({
    userId,
    memberships: { ok: true, rows: [membership({ status: "revoked" })] },
    partner: demoPartner(),
  });
  assert.equal(revoked.ok, false);
  if (!revoked.ok) {
    assert.equal(revoked.status, 403);
    assert.equal(revoked.code, "membership_revoked");
  }

  const missingPartner = resolvePartnerPortalAuth({
    userId,
    memberships: { ok: true, rows: [membership()] },
    partner: null,
  });
  assert.equal(missingPartner.ok, false);
  if (!missingPartner.ok) {
    assert.equal(missingPartner.status, 403);
    assert.equal(missingPartner.code, "partner_missing");
  }

  const inactivePartner = resolvePartnerPortalAuth({
    userId,
    memberships: { ok: true, rows: [membership()] },
    partner: demoPartner("inactive"),
  });
  assert.equal(inactivePartner.ok, true);
  if (inactivePartner.ok) {
    assert.equal(inactivePartner.context.partner.status, "inactive");
    assert.equal(inactivePartner.context.partnerId, DEMO_FURNITURE_PARTNER_ID);
  }

  const multiple = resolvePartnerPortalAuth({
    userId,
    memberships: {
      ok: true,
      rows: [
        membership(),
        membership({
          membershipId: "33333333-3333-3333-3333-333333333333",
          partnerId: OTHER_PARTNER_ID,
        }),
      ],
    },
    partner: demoPartner(),
  });
  assert.equal(multiple.ok, false);
  if (!multiple.ok) {
    assert.equal(multiple.status, 409);
    assert.equal(multiple.code, "multiple_memberships");
  }

  const unavailable = resolvePartnerPortalAuth({
    userId,
    memberships: { ok: false, reason: "unavailable" },
    partner: "failed",
  });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    assert.equal(unavailable.status, 500);
    assert.equal(unavailable.code, "service_unavailable");
  }

  const allowed = resolvePartnerPortalAuth({
    userId,
    memberships: { ok: true, rows: [membership()] },
    partner: demoPartner(),
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.context.partnerId, DEMO_FURNITURE_PARTNER_ID);
});

test("PI-5G1 Portal catalog is durable-only, Partner-scoped, and includes inactive identities", () => {
  const { folded, mixed } = certifiedDemoCatalog();
  const withOther = catalogWithOtherPartner(mixed);
  const loaded = partnerCatalogFromDurableSnapshot({
    catalog: withOther,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const catalog = loaded.catalog;
  assert.equal(catalog.authority, "durable");
  assert.equal(catalog.fallbackReason, null);
  assert.equal(catalog.partners.length, 1);
  assert.equal(catalog.partners[0]?.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(catalog.products.some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);
  assert.equal(catalog.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)?.status, "inactive");
  assert.equal(catalog.variants.some((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID), true);
  assert.equal(catalog.variants.find((item) => item.variantId === DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID)?.status, "inactive");
  assert.equal(catalog.collections.some((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID), true);
  assert.equal(catalog.products.some((item) => item.partnerId === OTHER_PARTNER_ID), false);
  assert.equal(catalog.variants.some((item) => item.productId === otherProduct().productId), false);
  assert.equal(catalog.collections.some((item) => item.partnerId === OTHER_PARTNER_ID), false);
  assert.equal(catalog.products.some((item) => item.source === "vibode_curated"), false);
  assert.equal(STAGE_SEED_PRODUCTS.every((product) => (
    !catalog.products.some((item) => item.productId === product.productId)
  )), true);

  const shopping = filterStageCatalogProducts({
    products: mixed.products,
    variants: mixed.variants,
    partners: mixed.partners,
    catalog: mixed,
    mode: "browse",
    query: "",
    categoryId: "living-room",
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => product.productId,
  });
  assert.equal(shopping.some((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), false);
  assert.equal(isStageProductAvailable(
    catalog.products.find((item) => item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID)!,
    mixed,
  ), false);

  const inactivePartnerCatalog = partnerCatalogFromDurableSnapshot({
    catalog: createStageCatalogSnapshot({
      authority: "durable",
      products: catalog.products,
      variants: catalog.variants,
      collections: catalog.collections,
      assets: catalog.assets,
      partners: [{ ...demoPartner("inactive") }],
    }),
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(inactivePartnerCatalog.ok, true);
  if (inactivePartnerCatalog.ok) {
    assert.equal(inactivePartnerCatalog.catalog.partners[0]?.status, "inactive");
    assert.equal(inactivePartnerCatalog.catalog.products.length, catalog.products.length);
  }

  const seed = partnerCatalogFromDurableSnapshot({
    catalog: seedFixtureStageCatalog("durable_load_failed"),
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(seed.ok, false);
  if (!seed.ok) assert.equal(seed.code, "seed_fallback_forbidden");

  const fallback = resolveLoadedStageCatalog({ durable: null, reason: "durable_load_failed" });
  const fromFallback = partnerCatalogFromDurableSnapshot({
    catalog: fallback.catalog,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    authority: fallback.authority,
    fallbackReason: fallback.fallbackReason,
  });
  assert.equal(fromFallback.ok, false);
  if (!fromFallback.ok) assert.equal(fromFallback.code, "seed_fallback_forbidden");

  const live = foldedPartnerStateFromDurableCatalog(withOther, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(live);
  assert.deepEqual(
    live?.partners.map((item) => ({ partnerId: item.partnerId, status: item.status })),
    folded.partners.map((item) => ({ partnerId: item.partnerId, status: item.status })),
  );
  assert.deepEqual(
    [...(live?.products ?? [])].map((item) => item.productId).sort(),
    folded.products.map((item) => item.productId).sort(),
  );
  assert.deepEqual(
    [...(live?.variants ?? [])].map((item) => [item.variantId, item.sku, item.status, item.priceAmount]).sort(),
    folded.variants.map((item) => [item.variantId, item.sku, item.status, item.priceAmount]).sort(),
  );
  const living = live?.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  const foldedLiving = folded.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.deepEqual([...(living?.productIds ?? [])].sort(), [...(foldedLiving?.productIds ?? [])].sort());
  assert.equal(scopeDurableCatalogToPartner(seedFixtureStageCatalog("x"), DEMO_FURNITURE_PARTNER_ID), null);
});

test("PI-5G1 preview uses certified planner, stamps Partner ID, and never writes", () => {
  const { mixed } = certifiedDemoCatalog();
  const scoped = scopeDurableCatalogToPartner(mixed, DEMO_FURNITURE_PARTNER_ID);
  assert.ok(scoped);
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5g1-preview-"));
  const before = readdirSync(repoRoot);

  const noop = previewPartnerCatalogFromDurable({
    catalog: scoped!,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: { partnerId: DEMO_FURNITURE_PARTNER_ID, mode: "patch" },
    repoRoot,
  });
  assert.equal(noop.kind, "preview");
  assert.equal(noop.dto.ok, true);
  assert.equal(noop.dto.noOp, true);
  assert.equal("sqlPlan" in noop.dto, false);
  assert.equal(JSON.stringify(noop.dto).includes("sqlPlan"), false);
  assert.equal(JSON.stringify(noop.dto).includes("supabase/migrations"), false);

  const rename = previewPartnerCatalogFromDurable({
    catalog: scoped!,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: {
      partnerId: OTHER_PARTNER_ID,
      mode: "patch",
      products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, name: "Preview Sofa Name" }] },
    },
    repoRoot,
  });
  assert.equal(rename.kind, "preview");
  assert.equal(rename.dto.ok, true);
  assert.equal(rename.dto.noOp, false);
  assert.equal(rename.dto.partnerId, DEMO_FURNITURE_PARTNER_ID);
  const nameChange = rename.dto.productUpdates.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  assert.ok(nameChange);
  assert.equal(nameChange?.changes.some((change) => (
    change.column === "name" && change.previous === "Demo Sofa" && change.next === "Preview Sofa Name"
  )), true);

  const variantUpdate = previewPartnerCatalogFromDurable({
    catalog: scoped!,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: {
      mode: "patch",
      variants: { update: [{ variantId: DEMO_COFFEE_TABLE_BLACK_VARIANT_ID, priceAmount: 321 }] },
    },
    repoRoot,
  });
  assert.equal(variantUpdate.dto.ok, true, JSON.stringify(variantUpdate.dto.issues));
  assert.equal(variantUpdate.dto.variantUpdates.some((item) => (
    item.variantId === DEMO_COFFEE_TABLE_BLACK_VARIANT_ID &&
    item.changes.some((change) => change.column === "price_amount" && change.next === 321)
  )), true);

  const retarget = previewPartnerCatalogFromDurable({
    catalog: scoped!,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: {
      mode: "patch",
      variants: {
        update: [{
          variantId: DEMO_COFFEE_TABLE_WALNUT_VARIANT_ID,
          currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        }],
      },
    },
    repoRoot,
  });
  assert.equal(retarget.kind, "preview");
  assert.equal(retarget.dto.ok, false);
  assert.equal(hasIssue(retarget.dto, "ASSET_RETARGET_REQUIRED"), true);

  const invalid = previewPartnerCatalogFromDurable({
    catalog: scoped!,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: { partnerId: DEMO_FURNITURE_PARTNER_ID, mode: "snapshot" },
    repoRoot,
  });
  assert.equal(invalid.kind, "invalid_document");

  const foreign = previewPartnerCatalogFromDurable({
    catalog: scoped!,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    document: {
      mode: "patch",
      products: { update: [{ productId: otherProduct().productId, name: "Stolen" }] },
    },
    repoRoot,
  });
  assert.equal(foreign.dto.ok, false);
  assert.equal(hasIssue(foreign.dto, "NOT_FOUND") || hasIssue(foreign.dto, "PARTNER_MISMATCH"), true);

  assert.deepEqual(readdirSync(repoRoot), before);
});

test("PI-5G1 HTTP boundary fails closed and ignores browser Partner IDs", () => {
  const { mixed } = certifiedDemoCatalog();
  const scoped = partnerCatalogFromDurableSnapshot({
    catalog: catalogWithOtherPartner(mixed),
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(scoped.ok, true);
  if (!scoped.ok) return;

  const unauthenticated = executePartnerPortalSession({
    ok: false,
    code: "unauthenticated",
    status: 401,
    error: "Unauthorized",
  });
  assert.equal(unauthenticated.status, 401);

  const adminWithoutMembership = executePartnerPortalCatalog({
    auth: {
      ok: false,
      code: "forbidden",
      status: 403,
      error: "Forbidden",
    },
    catalog: scoped,
  });
  assert.equal(adminWithoutMembership.status, 403);

  const session = executePartnerPortalSession({ ok: true, context: context(demoPartner("inactive")) });
  assert.equal(session.status, 200);
  const sessionBody = session.body as { partner: { status: string } };
  assert.equal(sessionBody.partner.status, "inactive");

  const catalog = executePartnerPortalCatalog({
    auth: { ok: true, context: context() },
    catalog: scoped,
  });
  assert.equal(catalog.status, 200);
  const catalogBody = catalog.body as { products: { productId: string }[]; variants: { variantId: string }[] };
  assert.equal(catalogBody.products.some((item) => item.productId === otherProduct().productId), false);
  assert.equal(catalogBody.variants.some((item) => item.variantId === otherVariant().variantId), false);

  const mismatch = executePartnerPortalPreview({
    auth: { ok: true, context: context() },
    body: { document: { partnerId: OTHER_PARTNER_ID, mode: "patch" } },
    catalog: scoped,
  });
  assert.equal(mismatch.status, 403);

  const preview = executePartnerPortalPreview({
    auth: { ok: true, context: context() },
    body: { document: { partnerId: DEMO_FURNITURE_PARTNER_ID, mode: "patch" } },
    catalog: scoped,
  });
  assert.equal(preview.status, 200);
  const previewBody = preview.body as { noOp: boolean; sqlPlan?: unknown };
  assert.equal(previewBody.noOp, true);
  assert.equal(previewBody.sqlPlan, undefined);

  const loadFail = executePartnerPortalCatalog({
    auth: { ok: true, context: context() },
    catalog: { ok: false, code: "durable_load_failed" },
  });
  assert.equal(loadFail.status, 500);

  const invalid = executePartnerPortalPreview({
    auth: { ok: true, context: context() },
    body: { document: { partnerId: DEMO_FURNITURE_PARTNER_ID, mode: "snapshot" } },
    catalog: scoped,
  });
  assert.equal(invalid.status, 400);
});

test("PI-5G1 Portal code stays inside STAGE membership and certified planner adapters", () => {
  const joined = PI5G1_FILES.map((file) => source(file)).join("\n");
  assert.match(source("proxy.ts"), /\/partner/);
  assert.match(source("proxy.ts"), /PROTECTED_PREFIXES/);
  assert.match(source("app/partner/layout.tsx"), /resolvePartnerPortalContext/);
  assert.doesNotMatch(source("app/partner/layout.tsx"), /isAdminEmail|VIBODE_ADMIN_EMAIL/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-auth.ts"), /isAdminEmail|VIBODE_ADMIN_EMAIL/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-auth.server.ts"), /isAdminEmail|VIBODE_ADMIN_EMAIL/);
  assert.doesNotMatch(joined, /vibode_partners\b|vibode_furniture_partners|vibode_furniture_collections/);
  assert.doesNotMatch(joined, /\/admin\/furniture-partners/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-catalog.ts"), /seedFixtureStageCatalog|resolveLoadedStageCatalog|loadStageCatalogFromEnv/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-catalog.server.ts"), /seedFixtureStageCatalog|resolveLoadedStageCatalog|loadStageCatalogFromEnv/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-live-state.ts"), /foldPartnerCatalogCurrentState/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-preview.ts"), /importPartnerCatalogSync|importPartnerCatalogSnapshot|writeFileAtomic|writePartnerCatalogImportPlan/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-preview.server.ts"), /importPartnerCatalogSync|writeFileAtomic|\.insert\(|\.update\(/);
  assert.doesNotMatch(source("app/api/vibode/partner/catalog/preview/route.ts"), /importPartnerCatalogSync|writeFileAtomic/);
  assert.match(source("lib/vibode-stage/partner-catalog-preview.ts"), /parsePartnerCatalogSyncJson/);
  assert.match(source("lib/vibode-stage/partner-catalog-preview.ts"), /planPartnerCatalogSync/);
  assert.match(source("lib/adminAccess.ts"), /isAdminEmail/);
  assert.doesNotMatch(source("lib/adminAccess.ts"), /STAGE_PARTNER_MEMBERSHIPS_TABLE|partner-portal-auth/);
  assert.equal(STAGE_PARTNER_MEMBERSHIPS_TABLE, "vibode_stage_partner_memberships");
  assert.match(source("package.json"), /test:afc-v2-pi5g1/);

  const productId = DEMO_COFFEE_TABLE_PRODUCT_ID;
  assert.ok(productId);
});
