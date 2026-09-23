import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createStageCatalogSnapshot } from "./catalog";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
  DEMO_SOFA_STONE_VARIANT_ID,
} from "./partner-catalog";
import {
  createMemoryPartnerRuntimeApply,
  detectPartnerPublishConflicts,
  parsePartnerPublishBody,
  parseRuntimeApplyRpcError,
  publishPartnerPatchDraft,
  STAGE_PARTNER_APPLY_RPC,
} from "./partner-catalog-publish";
import {
  g3UnsupportedPublishOperations,
  toRuntimeApplyPayload,
} from "./partner-catalog-runtime-executor";
import { emptyPartnerPatchDocument } from "./partner-draft-mutations";
import { parsePartnerDraftTouchedBase } from "./partner-draft-touched-base";
import {
  DEMO_COFFEE_TABLE_PRODUCT_ID,
} from "./partner-package";
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
  partnerCatalogCommercialFingerprint,
  type PartnerPortalDraftDto,
} from "./partner-portal-drafts";
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
import { createMemoryPartnerPublishAuditStore } from "./partner-publish-audit";
import type { PartnerCatalogSyncPlan } from "./partner-catalog-sync-types";
import type { StageCatalogSnapshot, StagePartner } from "./types";

const ROOT = process.cwd();
const PUBLISH_SQL = "supabase/migrations/20260917010000_vibode_stage_partner_publish.sql";
const DRAFT_SQL = "supabase/migrations/20260916180000_vibode_stage_partner_drafts.sql";
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const USER_B = "44444444-4444-4444-4444-444444444444";
const DRAFT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DRAFT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const PI5G3_FILES = [
  PUBLISH_SQL,
  "lib/vibode-stage/partner-draft-touched-base.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor.server.ts",
  "lib/vibode-stage/partner-catalog-publish.ts",
  "lib/vibode-stage/partner-catalog-publish.server.ts",
  "lib/vibode-stage/partner-publish-audit.ts",
  "lib/vibode-stage/partner-portal-drafts.ts",
  "lib/vibode-stage/partner-portal-drafts.server.ts",
  "app/api/vibode/partner/drafts/[draftId]/publish/route.ts",
  "app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx",
  "app/partner/catalog/drafts/[draftId]/page.tsx",
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

function publishHarness(catalogLoad?: PartnerPortalCatalogLoadResult) {
  const load = catalogLoad ?? certifiedScopedCatalog().load;
  const store = createMemoryPartnerDraftStore();
  const audit = createMemoryPartnerPublishAuditStore();
  const apply = createMemoryPartnerRuntimeApply({ store, audit });
  return { store, audit, apply, catalogLoad: load };
}

async function openNamedDraft(options: Readonly<{
  name?: string;
  sku?: string | null;
  finish?: string | null;
  collectionName?: string;
  membership?: readonly string[];
  catalogLoad?: ReturnType<typeof certifiedScopedCatalog>["load"];
}> = {}) {
  const { catalog, load } = certifiedScopedCatalog();
  const catalogLoad = options.catalogLoad ?? load;
  const harness = publishHarness(catalogLoad);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: catalogLoad,
    draftId: DRAFT_A,
  });
  const mutations = [];
  if (options.name) {
    mutations.push({ type: "product.set_name" as const, productId: DEMO_SOFA_PRODUCT_ID, name: options.name });
  }
  if (options.sku !== undefined) {
    mutations.push({ type: "variant.set_sku" as const, variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: options.sku });
  }
  if (options.finish !== undefined) {
    mutations.push({
      type: "variant.set_finish_label" as const,
      variantId: DEMO_SOFA_STONE_VARIANT_ID,
      finishLabel: options.finish,
    });
  }
  if (options.collectionName) {
    mutations.push({
      type: "collection.set_name" as const,
      collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
      name: options.collectionName,
    });
  }
  if (options.membership) {
    mutations.push({
      type: "collection.set_membership" as const,
      collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
      productIds: options.membership,
    });
  }
  if (mutations.length > 0) {
    const saved = await mutatePartnerDraft({
      auth: authOk(),
      store: harness.store,
      catalog: catalogLoad,
      draftId: DRAFT_A,
      body: { expectedRevision: 1, mutations },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  }
  return { ...harness, catalog, catalogLoad };
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
    repoRoot: mkdtempSync(path.join(tmpdir(), "pi5g3-plan-")),
  });
}

function unescapeSql(value: string): string {
  return value.replace(/''/g, "'");
}

function sqlLiteral(raw: string): string | number | null {
  const trimmed = raw.trim().replace(/;+$/, "");
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const quoted = trimmed.match(/^'(.*)'$/);
  if (quoted) return unescapeSql(quoted[1]);
  return trimmed;
}

function parseCertifiedSqlSemantics(sql: string) {
  const productUpdates: { productId: string; changes: { column: string; previous: unknown; next: unknown }[] }[] = [];
  const productBlocks = sql.match(/update public\.vibode_stage_products[\s\S]*?end \$\$;/g) ?? [];
  for (const block of productBlocks) {
    const id = block.match(/product_id = '([^']+)'/)?.[1];
    if (!id) continue;
    const setMatch = block.match(/set\n([\s\S]*?)\n\s+where/);
    const changes: { column: string; previous: unknown; next: unknown }[] = [];
    if (setMatch) {
      for (const line of setMatch[1].split(",\n")) {
        const pair = line.trim().match(/^([a-z_]+) = (.+)$/);
        if (!pair) continue;
        const column = pair[1];
        const next = sqlLiteral(pair[2]);
        const previousMatch = block.match(new RegExp(`${column} is not distinct from ([^\\n;]+)`));
        changes.push({
          column,
          next,
          previous: previousMatch ? sqlLiteral(previousMatch[1]) : null,
        });
      }
    }
    productUpdates.push({ productId: id, changes });
  }

  const variantUpdates: { variantId: string; productId: string; changes: { column: string; previous: unknown; next: unknown }[] }[] = [];
  const variantBlocks = sql.match(/update public\.vibode_stage_variants[\s\S]*?end \$\$;/g) ?? [];
  for (const block of variantBlocks) {
    const variantId = block.match(/variant_id = '([^']+)'/)?.[1];
    const productId = block.match(/product_id = '([^']+)'/)?.[1];
    if (!variantId || !productId) continue;
    const setMatch = block.match(/set\n([\s\S]*?)\n\s+where/);
    const changes: { column: string; previous: unknown; next: unknown }[] = [];
    if (setMatch) {
      for (const line of setMatch[1].split(",\n")) {
        const pair = line.trim().match(/^([a-z_]+) = (.+)$/);
        if (!pair) continue;
        const column = pair[1];
        const next = sqlLiteral(pair[2]);
        const previousMatch = block.match(new RegExp(`${column} is not distinct from ([^\\n;]+)`));
        changes.push({
          column,
          next,
          previous: previousMatch ? sqlLiteral(previousMatch[1]) : null,
        });
      }
    }
    variantUpdates.push({ variantId, productId, changes });
  }

  const collectionUpdates: { collectionId: string; name: string; previousName: string | null }[] = [];
  const collectionBlocks = sql.match(/update public\.vibode_stage_collections[\s\S]*?end \$\$;/g) ?? [];
  for (const block of collectionBlocks) {
    const collectionId = block.match(/collection_id = '([^']+)'/)?.[1];
    const name = block.match(/set\n\s+name = '([^']+)'/)?.[1];
    const previousName = block.match(/name is not distinct from ([^\n]+)/)?.[1];
    if (!collectionId || !name) continue;
    collectionUpdates.push({
      collectionId,
      name: unescapeSql(name),
      previousName: previousName ? String(sqlLiteral(previousName)) : null,
    });
  }

  const membershipAdds: { productId: string; collectionId: string; sortOrder: number }[] = [];
  const addRe = /insert into public\.vibode_stage_product_collections \([\s\S]*?values \([\s\S]*?  '([^']+)',\n  '([^']+)',\n  ([0-9]+)\n\);/g;
  let addMatch = addRe.exec(sql);
  while (addMatch) {
    membershipAdds.push({
      productId: addMatch[1],
      collectionId: addMatch[2],
      sortOrder: Number(addMatch[3]),
    });
    addMatch = addRe.exec(sql);
  }

  const membershipRemoves: { productId: string; collectionId: string }[] = [];
  const removeRe = /delete from public\.vibode_stage_product_collections\nwhere product_id = '([^']+)'\n  and collection_id = '([^']+)';/g;
  let removeMatch = removeRe.exec(sql);
  while (removeMatch) {
    membershipRemoves.push({ productId: removeMatch[1], collectionId: removeMatch[2] });
    removeMatch = removeRe.exec(sql);
  }

  const skuTargets: { sku: string; variantId: string }[] = [];
  const skuRe = /variants\.sku = '([^']+)'[\s\S]*?variants\.variant_id is distinct from '([^']+)'/g;
  let skuMatch = skuRe.exec(sql);
  while (skuMatch) {
    skuTargets.push({ sku: skuMatch[1], variantId: skuMatch[2] });
    skuMatch = skuRe.exec(sql);
  }

  return {
    productUpdates,
    variantUpdates,
    collectionUpdates,
    membershipAdds,
    membershipRemoves,
    skuTargets,
  };
}

test("PI-5G3 migration extends drafts, adds insert-only audit, and defines a service-role RPC", () => {
  const sql = source(PUBLISH_SQL);
  const g2 = source(DRAFT_SQL);
  assert.match(g2, /status in \('open', 'abandoned'\)/);
  assert.match(sql, /status in \('open', 'abandoned', 'published'\)/);
  assert.match(sql, /touched_base jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /jsonb_typeof\(touched_base\) = 'object'/);
  assert.match(sql, /create table public\.vibode_stage_partner_publishes/);
  assert.match(sql, /status in \('accepted', 'noop', 'rejected', 'failed'\)/);
  assert.match(sql, /source in \('portal'\)/);
  assert.match(sql, /mode in \('patch'\)/);
  assert.match(sql, /user_id uuid references auth\.users \(id\) on delete set null/);
  assert.match(sql, /vibode_stage_partner_publishes_success_revision_idx/);
  assert.match(sql, /where status in \('accepted', 'noop'\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.vibode_stage_partner_publishes/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant select, insert on table public\.vibode_stage_partner_publishes/);
  assert.doesNotMatch(sql, /grant update|grant delete/i);
  assert.doesNotMatch(sql, /create policy/);
  assert.match(sql, /create or replace function public\.vibode_stage_apply_partner_patch\(p_apply jsonb\)/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /revoke all on function public\.vibode_stage_apply_partner_patch\(jsonb\)/);
  assert.match(sql, /grant execute on function public\.vibode_stage_apply_partner_patch\(jsonb\)\s+to service_role/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /hashtextextended/);
  assert.match(sql, /for update/);
  assert.match(sql, /planVersion/);
  assert.match(sql, /source = 'partner_catalog'/);
  assert.match(sql, /is not distinct from/);
  assert.match(sql, /owner = 'partner'/);
  assert.match(sql, /variants\.sku = v_sku/);
  assert.doesNotMatch(sql, /variants\.status/);
  assert.match(sql, /VIBODE_STAGE_PUBLISH:STALE_SYNC/);
  assert.doesNotMatch(sql, /vibode_stage_assets|vibode_3d_scenes|scene_objects/);
  assert.doesNotMatch(sql, /EXECUTE\s+format/i);
  assert.doesNotMatch(sql, /EXECUTE\s+'/i);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(sql, /@/);
  assert.equal(STAGE_PARTNER_APPLY_RPC, "vibode_stage_apply_partner_patch");
});

test("PI-5G3 publish auth is membership-derived and rejects client identity/plan keys", async () => {
  const { load, catalog } = certifiedScopedCatalog();
  const harness = publishHarness(load);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Auth Sofa" }],
    },
  });

  const unauthenticated = await publishPartnerPatchDraft({
    auth: authFail("unauthenticated", 401),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(unauthenticated.status, 401);

  const none = await publishPartnerPatchDraft({
    auth: resolvePartnerPortalAuth({
      userId: USER_A,
      memberships: { ok: true, rows: [] },
      partner: demoPartner(),
    }),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(none.status, 403);

  const revoked = await publishPartnerPatchDraft({
    auth: authFail("membership_revoked", 403),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(revoked.status, 403);

  const foreign = await publishPartnerPatchDraft({
    auth: authOk(otherPartner(), USER_B),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(foreign.status, 404);

  const inactive = await publishPartnerPatchDraft({
    auth: authOk(demoPartner("inactive")),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(inactive.status, 200, JSON.stringify(inactive.body));

  assert.equal(parsePartnerPublishBody({
    expectedDraftRevision: 2,
    partnerId: OTHER_PARTNER_ID,
    userId: USER_B,
  }).ok, false);
  assert.equal(parsePartnerPublishBody({ expectedDraftRevision: 2, plan: {} }).ok, false);
  assert.equal(parsePartnerPublishBody({ expectedDraftRevision: 2, document: {} }).ok, false);
  assert.equal(parsePartnerPublishBody({ expectedDraftRevision: 2, sqlPlan: "--" }).ok, false);
  assert.ok(catalog.products.length > 0);
});

test("PI-5G3 revision, published lifecycle, and idempotent retry", async () => {
  const opened = await openNamedDraft({ name: "Published Sofa" });
  const stale = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 1 },
  });
  assert.equal(stale.status, 409);

  const first = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const firstBody = first.body as { publishId: string; status: string; idempotent: boolean };
  assert.equal(firstBody.status, "accepted");
  assert.equal(firstBody.idempotent, false);
  const closed = await getPartnerDraft({ auth: authOk(), store: opened.store, draftId: DRAFT_A });
  assert.equal(draftFrom(closed.body).status, "published");

  const mutatePublished = await mutatePartnerDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Nope" }],
    },
  });
  assert.equal(mutatePublished.status, 409);
  assert.equal((mutatePublished.body as { code?: string }).code, "DRAFT_PUBLISHED");

  const abandonPublished = await mutatePartnerDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    draftId: DRAFT_A,
    body: { expectedRevision: 2, status: "abandoned" },
  });
  assert.equal(abandonPublished.status, 409);

  const retry = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(retry.status, 200);
  const retryBody = retry.body as { publishId: string; idempotent: boolean; status: string };
  assert.equal(retryBody.publishId, firstBody.publishId);
  assert.equal(retryBody.idempotent, true);
  assert.equal(retryBody.status, "accepted");
  assert.equal(
    opened.audit.rows.filter((row) => row.status === "accepted" || row.status === "noop").length,
    1,
  );

  const next = await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    draftId: DRAFT_B,
  });
  assert.equal(next.status, 201);
  assert.notEqual(draftFrom(next.body).draftId, DRAFT_A);
  assert.equal(draftFrom(next.body).status, "open");
  assert.deepEqual(draftFrom(next.body).touchedBase, { products: {}, variants: {}, collections: {} });
});

test("PI-5G3 publish replans persisted draft and ignores client plan/document", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5g3-replan-"));
  const before = readdirSync(repoRoot);
  const opened = await openNamedDraft({ name: "Replan Sofa" });
  const rejectedPlan = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: {
      expectedDraftRevision: 2,
      plan: { ok: true, noOp: true, productUpdates: [] },
    },
    repoRoot,
  });
  assert.equal(rejectedPlan.status, 400);

  const rejectedDocument = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: {
      expectedDraftRevision: 2,
      document: emptyPartnerPatchDocument(DEMO_FURNITURE_PARTNER_ID),
    },
    repoRoot,
  });
  assert.equal(rejectedDocument.status, 400);

  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: opened.catalogLoad,
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
    repoRoot,
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.deepEqual(readdirSync(repoRoot), before);
  assert.match(source("lib/vibode-stage/partner-catalog-publish.ts"), /planPartnerCatalogSync/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-publish.ts"), /body\.plan|input\.body\.plan/);
});

test("PI-5G3 stale field conflicts are first-touch specific and unrelated live changes do not block", async () => {
  const { catalog } = certifiedScopedCatalog();
  const sofa = catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  const stone = catalog.variants.find((item) => item.variantId === DEMO_SOFA_STONE_VARIANT_ID);
  assert.ok(sofa && stone);
  const opened = await openNamedDraft({ name: "Wanted Sofa C", finish: "Wanted Finish" });

  const renamedLive = cloneCatalog(catalog, {
    products: catalog.products.map((item) => (
      item.productId === DEMO_SOFA_PRODUCT_ID ? { ...item, name: "Live Sofa B" } : item
    )),
  });
  const staleName = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: loadOf(renamedLive),
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(staleName.status, 409);
  const nameBody = staleName.body as { code?: string; conflicts?: { field: string; expected: unknown; live: unknown }[] };
  assert.equal(nameBody.code, "STALE_LIVE_FIELD");
  assert.equal(nameBody.conflicts?.some((item) => (
    item.field === "name" && item.expected === sofa.name && item.live === "Live Sofa B"
  )), true);

  const finishLive = cloneCatalog(catalog, {
    variants: catalog.variants.map((item) => (
      item.variantId === DEMO_SOFA_STONE_VARIANT_ID ? { ...item, finishLabel: "Live Finish B" } : item
    )),
  });
  const staleFinish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: loadOf(finishLive),
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(staleFinish.status, 409);

  const unrelated = cloneCatalog(catalog, {
    products: catalog.products.map((item) => (
      item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID ? { ...item, name: "Unrelated Live" } : item
    )),
  });
  const okUnrelated = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: loadOf(unrelated),
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(okUnrelated.status, 200, JSON.stringify(okUnrelated.body));
});

test("PI-5G3 reverted touched fields leave the publish conflict set", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const sofa = catalog.products.find((item) => item.productId === DEMO_SOFA_PRODUCT_ID);
  assert.ok(sofa);
  const harness = publishHarness(load);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Temporary" }],
    },
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 2,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: sofa.name }],
    },
  });
  const afterRevert = draftFrom((await getPartnerDraft({
    auth: authOk(),
    store: harness.store,
    draftId: DRAFT_A,
  })).body);
  assert.equal(afterRevert.touchedBase.products[DEMO_SOFA_PRODUCT_ID], undefined);

  await mutatePartnerDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 3,
      mutations: [{ type: "variant.set_sku", variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: "DFC-SOFA-02-EDIT" }],
    },
  });
  const liveNameChanged = cloneCatalog(catalog, {
    products: catalog.products.map((item) => (
      item.productId === DEMO_SOFA_PRODUCT_ID ? { ...item, name: "Later Live Name" } : item
    )),
  });
  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: loadOf(liveNameChanged),
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 4 },
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
});

test("PI-5G3 membership conflicts compare the full live set and ignore unrelated collections", async () => {
  const { catalog } = certifiedScopedCatalog();
  const living = catalog.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.ok(living);
  assert.ok(living.productIds.length > 1);
  const opened = await openNamedDraft({ membership: [DEMO_SOFA_PRODUCT_ID] });

  const extraMember = cloneCatalog(catalog, {
    collections: catalog.collections.map((item) => (
      item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID
        ? { ...item, productIds: [...item.productIds, DEMO_COFFEE_TABLE_PRODUCT_ID] }
        : item
    )),
    products: catalog.products.map((item) => (
      item.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
        ? { ...item, collectionIds: [...item.collectionIds, DEMO_LIVING_ROOM_COLLECTION_ID] }
        : item
    )),
  });
  const stale = await publishPartnerPatchDraft({
    auth: authOk(),
    store: opened.store,
    catalog: loadOf(extraMember),
    audit: opened.audit,
    apply: opened.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(stale.status, 409);
  const body = stale.body as { code?: string; conflicts?: { field: string }[] };
  assert.equal(body.code, "STALE_LIVE_FIELD");
  assert.equal(body.conflicts?.some((item) => item.field === "membership_product_ids"), true);

  const otherCollection = catalog.collections.find((item) => item.collectionId !== DEMO_LIVING_ROOM_COLLECTION_ID);
  if (otherCollection) {
    const renamedOther = cloneCatalog(catalog, {
      collections: catalog.collections.map((item) => (
        item.collectionId === otherCollection.collectionId ? { ...item, name: "Unrelated Collection" } : item
      )),
    });
    const ok = await publishPartnerPatchDraft({
      auth: authOk(),
      store: opened.store,
      catalog: loadOf(renamedOther),
      audit: opened.audit,
      apply: opened.apply,
      draftId: DRAFT_A,
      body: { expectedDraftRevision: 2 },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  }
});

test("PI-5G3 pre-G3 empty touched_base falls back to catalog hash", async () => {
  const { catalog, load } = certifiedScopedCatalog();
  const harness = publishHarness(load);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Legacy Sofa" }],
    },
  });
  const row = harness.store.rows[0]!;
  harness.store.rows[0] = { ...row, touchedBase: {} };

  const sameHash = await publishPartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(sameHash.status, 200, JSON.stringify(sameHash.body));

  const harness2 = publishHarness(load);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness2.store,
    catalog: load,
    draftId: DRAFT_A,
  });
  await mutatePartnerDraft({
    auth: authOk(),
    store: harness2.store,
    catalog: load,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "product.set_name", productId: DEMO_SOFA_PRODUCT_ID, name: "Legacy Sofa" }],
    },
  });
  harness2.store.rows[0] = { ...harness2.store.rows[0]!, touchedBase: {} };
  const changed = cloneCatalog(catalog, {
    products: catalog.products.map((item) => (
      item.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID ? { ...item, name: "Changed Unrelated" } : item
    )),
  });
  const mismatch = await publishPartnerPatchDraft({
    auth: authOk(),
    store: harness2.store,
    catalog: loadOf(changed),
    audit: harness2.audit,
    apply: harness2.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(mismatch.status, 409);
  assert.equal((mismatch.body as { code?: string }).code, "STALE_CATALOG_BASE");
});

test("PI-5G3 SKU planner rejection, null SKU, case-sensitivity, and RPC SKU contract", async () => {
  const sql = source(PUBLISH_SQL);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /hashtextextended\(v_partner_id, 0\)/);
  assert.match(sql, /variants\.sku = v_sku/);
  assert.match(sql, /products\.partner_id = v_partner_id/);
  assert.match(sql, /variants\.variant_id is distinct from v_variant_id/);
  const skuGuard = sql.slice(
    sql.indexOf("from public.vibode_stage_variants variants"),
    sql.indexOf("VIBODE_STAGE_PUBLISH:DUPLICATE_SKU") + 40,
  );
  assert.match(skuGuard, /variants\.sku = v_sku/);
  assert.match(skuGuard, /products\.partner_id = v_partner_id/);
  assert.match(skuGuard, /variants\.variant_id is distinct from v_variant_id/);
  assert.doesNotMatch(skuGuard, /variants\.status|products\.status/);

  const duplicate = await openNamedDraft({ sku: "DFC-SOFA-01" });
  const dupPublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: duplicate.store,
    catalog: duplicate.catalogLoad,
    audit: duplicate.audit,
    apply: duplicate.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(dupPublish.status, 400);
  const dupBody = dupPublish.body as { code?: string; issues?: { code: string }[] };
  assert.equal(dupBody.code, "PLANNER_ISSUE");
  assert.equal(dupBody.issues?.some((item) => item.code === "DUPLICATE_SKU"), true);
  assert.equal(duplicate.audit.rows.some((row) => row.status === "rejected"), true);

  const { catalog, load } = certifiedScopedCatalog();
  const reserved = cloneCatalog(catalog, {
    variants: catalog.variants.map((item) => (
      item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID
        ? { ...item, status: "inactive" as const }
        : item
    )),
  });
  const reservedLoad = loadOf(reserved);
  const harness = publishHarness(reservedLoad);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: reservedLoad,
    draftId: DRAFT_A,
  });
  const reservedSku = catalog.variants.find((item) => item.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID)?.sku;
  assert.ok(reservedSku);
  await mutatePartnerDraft({
    auth: authOk(),
    store: harness.store,
    catalog: reservedLoad,
    draftId: DRAFT_A,
    body: {
      expectedRevision: 1,
      mutations: [{ type: "variant.set_sku", variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: reservedSku }],
    },
  });
  const reservedPublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: reservedLoad,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(reservedPublish.status, 400);
  assert.equal(
    (reservedPublish.body as { issues?: { code: string }[] }).issues?.some((item) => item.code === "DUPLICATE_SKU"),
    true,
  );

  const nullSku = await openNamedDraft({ sku: null });
  const nullPublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: nullSku.store,
    catalog: nullSku.catalogLoad,
    audit: nullSku.audit,
    apply: nullSku.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(nullPublish.status, 200, JSON.stringify(nullPublish.body));

  const cased = await openNamedDraft({ sku: "dfc-sofa-01" });
  const casePublish = await publishPartnerPatchDraft({
    auth: authOk(),
    store: cased.store,
    catalog: cased.catalogLoad,
    audit: cased.audit,
    apply: cased.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(casePublish.status, 200, JSON.stringify(casePublish.body));
  assert.ok(load.ok);
});

test("PI-5G3 runtime serializer matches certified SQL apply semantics", () => {
  const { catalog } = certifiedScopedCatalog();
  const living = catalog.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.ok(living);
  const cases: { label: string; document: unknown }[] = [
    {
      label: "product name",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, name: "Demo Sofa G3" }], deactivate: [], reactivate: [] },
        variants: { create: [], update: [], deactivate: [], reactivate: [] },
        collections: { update: [], membershipAdd: [], membershipRemove: [] },
      },
    },
    {
      label: "product price",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [{ productId: DEMO_SOFA_PRODUCT_ID, priceAmount: 1400 }], deactivate: [], reactivate: [] },
        variants: { create: [], update: [{ variantId: DEMO_SOFA_DEFAULT_VARIANT_ID, priceAmount: 1400 }], deactivate: [], reactivate: [] },
        collections: { update: [], membershipAdd: [], membershipRemove: [] },
      },
    },
    {
      label: "variant finish",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [], deactivate: [], reactivate: [] },
        variants: { create: [], update: [{ variantId: DEMO_SOFA_STONE_VARIANT_ID, finishLabel: "Stone deluxe" }], deactivate: [], reactivate: [] },
        collections: { update: [], membershipAdd: [], membershipRemove: [] },
      },
    },
    {
      label: "variant sku",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [], deactivate: [], reactivate: [] },
        variants: { create: [], update: [{ variantId: DEMO_SOFA_STONE_VARIANT_ID, sku: "DFC-SOFA-02-G3" }], deactivate: [], reactivate: [] },
        collections: { update: [], membershipAdd: [], membershipRemove: [] },
      },
    },
    {
      label: "variant price",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [], deactivate: [], reactivate: [] },
        variants: { create: [], update: [{ variantId: DEMO_SOFA_STONE_VARIANT_ID, priceAmount: 1550 }], deactivate: [], reactivate: [] },
        collections: { update: [], membershipAdd: [], membershipRemove: [] },
      },
    },
    {
      label: "collection rename",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [], deactivate: [], reactivate: [] },
        variants: { create: [], update: [], deactivate: [], reactivate: [] },
        collections: { update: [{ collectionId: DEMO_LIVING_ROOM_COLLECTION_ID, name: "Living Room G3" }], membershipAdd: [], membershipRemove: [] },
      },
    },
    {
      label: "membership add/remove",
      document: {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        mode: "patch",
        products: { update: [], deactivate: [], reactivate: [] },
        variants: { create: [], update: [], deactivate: [], reactivate: [] },
        collections: {
          update: [],
          membershipAdd: living.productIds.includes(DEMO_COFFEE_TABLE_PRODUCT_ID) ? [] : [
            { productId: DEMO_COFFEE_TABLE_PRODUCT_ID, collectionId: DEMO_LIVING_ROOM_COLLECTION_ID },
          ],
          membershipRemove: living.productIds
            .filter((id) => id !== DEMO_SOFA_PRODUCT_ID)
            .map((productId) => ({ productId, collectionId: DEMO_LIVING_ROOM_COLLECTION_ID })),
        },
      },
    },
  ];

  for (const item of cases) {
    const plan = planDocument(item.document, catalog);
    assert.equal(plan.ok, true, `${item.label} ${JSON.stringify(plan.issues)}`);
    assert.ok(plan.sqlPlan, item.label);
    const serialized = toRuntimeApplyPayload(plan);
    assert.equal(serialized.ok, true, item.label);
    if (!serialized.ok || !plan.sqlPlan) continue;
    const parsed = parseCertifiedSqlSemantics(plan.sqlPlan.sql);
    assert.deepEqual(
      serialized.payload.productUpdates.map((update) => ({
        productId: update.productId,
        changes: update.changes.map((change) => ({ column: change.column, previous: change.previous, next: change.next })),
      })),
      parsed.productUpdates,
      item.label,
    );
    assert.deepEqual(
      serialized.payload.variantUpdates.map((update) => ({
        variantId: update.variantId,
        productId: update.productId,
        changes: update.changes.map((change) => ({ column: change.column, previous: change.previous, next: change.next })),
      })),
      parsed.variantUpdates,
      item.label,
    );
    assert.deepEqual(
      serialized.payload.collectionUpdates.map((update) => ({
        collectionId: update.collectionId,
        name: update.name,
        previousName: update.previousName,
      })),
      parsed.collectionUpdates,
      item.label,
    );
    assert.deepEqual(
      [...serialized.payload.membershipAdds].sort((a, b) => `${a.collectionId}:${a.productId}`.localeCompare(`${b.collectionId}:${b.productId}`)),
      [...parsed.membershipAdds].sort((a, b) => `${a.collectionId}:${a.productId}`.localeCompare(`${b.collectionId}:${b.productId}`)),
      item.label,
    );
    assert.deepEqual(
      [...serialized.payload.membershipRemoves].sort((a, b) => `${a.collectionId}:${a.productId}`.localeCompare(`${b.collectionId}:${b.productId}`)),
      [...parsed.membershipRemoves].sort((a, b) => `${a.collectionId}:${a.productId}`.localeCompare(`${b.collectionId}:${b.productId}`)),
      item.label,
    );
    if (item.label === "variant sku") {
      assert.deepEqual(parsed.skuTargets, [{ sku: "DFC-SOFA-02-G3", variantId: DEMO_SOFA_STONE_VARIANT_ID }]);
      const skuChange = serialized.payload.variantUpdates[0]?.changes.find((change) => change.column === "sku");
      assert.equal(skuChange?.next, "DFC-SOFA-02-G3");
    }
  }

  const unsupportedCreates: PartnerCatalogSyncPlan = {
    ok: true,
    noOp: false,
    issues: [],
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    partnerStatusTransition: null,
    productCreates: [{
      product: catalog.products[0]!,
      sortOrder: 0,
    }],
    productUpdates: [],
    variantCreates: [],
    variantUpdates: [],
    collectionCreates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
    productDeactivations: [],
    productReactivations: [],
    variantDeactivations: [],
    variantReactivations: [],
    sqlPlan: null,
    nextState: null,
  };
  assert.deepEqual(g3UnsupportedPublishOperations(unsupportedCreates), ["productCreates"]);
  assert.equal(toRuntimeApplyPayload(unsupportedCreates).ok, false);

  const categoryPlan: PartnerCatalogSyncPlan = {
    ...unsupportedCreates,
    productCreates: [],
    productUpdates: [{
      productId: DEMO_SOFA_PRODUCT_ID,
      changes: [{ column: "category_id", previous: "living-room", next: "bedroom" }],
    }],
  };
  assert.equal(toRuntimeApplyPayload(categoryPlan).ok, false);
});

test("PI-5G3 RPC is one transaction and Node publish paths do not issue commercial DML", () => {
  const sql = source(PUBLISH_SQL);
  const fn = sql.slice(sql.indexOf("create or replace function public.vibode_stage_apply_partner_patch"));
  assert.match(fn, /language plpgsql/);
  assert.match(fn, /pg_advisory_xact_lock/);
  assert.match(fn, /for update/);
  assert.match(fn, /insert into public\.vibode_stage_partner_publishes/);
  assert.match(fn, /status = 'published'/);
  assert.match(fn, /raise exception 'VIBODE_STAGE_PUBLISH:STALE_SYNC'/);
  const nodeFiles = [
    "lib/vibode-stage/partner-catalog-publish.ts",
    "lib/vibode-stage/partner-catalog-publish.server.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.ts",
    "lib/vibode-stage/partner-catalog-runtime-executor.server.ts",
    "app/api/vibode/partner/drafts/[draftId]/publish/route.ts",
  ];
  for (const file of nodeFiles) {
    const text = source(file);
    assert.doesNotMatch(text, /\.from\("vibode_stage_products"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_variants"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_collections"\)/);
    assert.doesNotMatch(text, /\.from\("vibode_stage_product_collections"\)/);
    assert.doesNotMatch(text, /writeFileAtomic|writeFileSync|importPartnerCatalogSync/);
  }
  assert.match(source("lib/vibode-stage/partner-catalog-runtime-executor.server.ts"), /supabase\.rpc\(STAGE_PARTNER_APPLY_RPC/);
});

test("PI-5G3 audit covers accepted, noop, rejected, failed, and insert-only grants", async () => {
  const accepted = await openNamedDraft({ name: "Audit Sofa" });
  const published = await publishPartnerPatchDraft({
    auth: authOk(),
    store: accepted.store,
    catalog: accepted.catalogLoad,
    audit: accepted.audit,
    apply: accepted.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(published.status, 200);
  const acceptedRow = accepted.audit.rows.find((row) => row.status === "accepted");
  assert.ok(acceptedRow);
  assert.equal(acceptedRow?.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(acceptedRow?.userId, USER_A);
  assert.equal(acceptedRow?.draftId, DRAFT_A);
  assert.equal(acceptedRow?.draftRevision, 2);
  assert.equal(acceptedRow?.source, "portal");
  assert.equal(acceptedRow?.mode, "patch");
  assert.ok(acceptedRow?.document);
  assert.equal(acceptedRow?.postPublishCatalogHash, null);

  const noopHarness = publishHarness();
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: noopHarness.store,
    catalog: noopHarness.catalogLoad,
    draftId: DRAFT_A,
  });
  const noop = await publishPartnerPatchDraft({
    auth: authOk(),
    store: noopHarness.store,
    catalog: noopHarness.catalogLoad,
    audit: noopHarness.audit,
    apply: noopHarness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 1 },
  });
  assert.equal(noop.status, 200);
  assert.equal((noop.body as { status?: string }).status, "noop");
  assert.equal(draftFrom((await getPartnerDraft({
    auth: authOk(),
    store: noopHarness.store,
    draftId: DRAFT_A,
  })).body).status, "published");
  assert.equal(noopHarness.audit.rows.some((row) => row.status === "noop"), true);

  const rejected = await openNamedDraft({ sku: "DFC-SOFA-01" });
  await publishPartnerPatchDraft({
    auth: authOk(),
    store: rejected.store,
    catalog: rejected.catalogLoad,
    audit: rejected.audit,
    apply: rejected.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(rejected.audit.rows.some((row) => row.status === "rejected"), true);

  const failedHarness = await openNamedDraft({ name: "Fail Sofa" });
  const failed = await publishPartnerPatchDraft({
    auth: authOk(),
    store: failedHarness.store,
    catalog: failedHarness.catalogLoad,
    audit: failedHarness.audit,
    apply: async () => ({ ok: false, errorCode: "STALE_SYNC" }),
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 2 },
  });
  assert.equal(failed.status, 409);
  assert.equal(failedHarness.audit.rows.some((row) => row.status === "failed" && row.errorCode === "STALE_SYNC"), true);
  assert.equal(draftFrom((await getPartnerDraft({
    auth: authOk(),
    store: failedHarness.store,
    draftId: DRAFT_A,
  })).body).status, "open");

  const sql = source(PUBLISH_SQL);
  assert.match(sql, /grant select, insert on table public\.vibode_stage_partner_publishes\s+to service_role/);
  assert.doesNotMatch(sql, /create policy/);
  assert.equal(parseRuntimeApplyRpcError("VIBODE_STAGE_PUBLISH:STALE_SYNC"), "STALE_SYNC");
});

test("PI-5G3 unsupported operations and planner issues do not execute", async () => {
  const { load } = certifiedScopedCatalog();
  const harness = publishHarness(load);
  await getOrCreatePartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    draftId: DRAFT_A,
  });
  harness.store.rows[0] = {
    ...harness.store.rows[0]!,
    document: {
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      mode: "patch",
      products: { update: [], deactivate: [{ productId: DEMO_SOFA_PRODUCT_ID }], reactivate: [] },
      variants: { create: [], update: [], deactivate: [], reactivate: [] },
      collections: { update: [], membershipAdd: [], membershipRemove: [] },
    },
  };
  const unsupported = await publishPartnerPatchDraft({
    auth: authOk(),
    store: harness.store,
    catalog: load,
    audit: harness.audit,
    apply: harness.apply,
    draftId: DRAFT_A,
    body: { expectedDraftRevision: 1 },
  });
  assert.equal(unsupported.status, 400);
  assert.equal((unsupported.body as { code?: string }).code, "UNSUPPORTED_PUBLISH_OPERATION");
  assert.equal(harness.store.rows[0]?.status, "open");
  assert.equal(harness.audit.rows.some((row) => row.status === "accepted"), false);
});

test("PI-5G3 UI publish action and zero forbidden mutation surface", () => {
  const workspace = source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx");
  assert.match(workspace, /Publish/);
  assert.match(workspace, /expectedDraftRevision/);
  assert.match(workspace, /\/api\/vibode\/partner\/drafts\/\$\{draft\.draftId\}\/publish/);
  assert.match(workspace, /Publishing updates the live catalog/);
  assert.match(workspace, /router\.push\("\/partner\/catalog"\)/);
  assert.match(workspace, /STALE_LIVE_FIELD/);
  assert.match(source("app/partner/catalog/drafts/[draftId]/page.tsx"), /status === "published"/);
  assert.match(source("app/api/vibode/partner/drafts/[draftId]/publish/route.ts"), /partnerPortalDraftPublishResponse/);
  assert.match(source("package.json"), /test:afc-v2-pi5g3/);
  const joined = PI5G3_FILES.map((file) => source(file)).join("\n");
  assert.doesNotMatch(joined, /writeFileAtomic|writeGeneratedFurnitureAssetRegistry|importPartnerCatalogSnapshot/);
  assert.doesNotMatch(joined, /from\("vibode_stage_assets"\)|from\("vibode_3d_scenes"\)/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-catalog-publish.ts"), /renderPartnerCatalogSyncSql/);
  assert.ok(detectPartnerPublishConflicts);
  assert.ok(parsePartnerDraftTouchedBase);
  assert.equal(typeof partnerCatalogCommercialFingerprint, "function");
});
