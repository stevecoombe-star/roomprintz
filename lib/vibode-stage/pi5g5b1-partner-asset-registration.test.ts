import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-runtime/furniture-asset-validate";
import { installNodeGltfFileReader } from "@/lib/afc-v2-runtime/node-gltf-file-reader";
import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "@/lib/afc-v2-runtime/pi4a-sofa-geometry";
import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";

import {
  createMemoryPartnerAssetIntakeStore,
  createMemoryPartnerAssetObjectStore,
  createPartnerAssetIntake,
  finalizePartnerAssetIntake,
  PARTNER_ASSET_INTAKE_BUCKET,
  validatorAssetIdForIntake,
} from "./partner-asset-intake";
import {
  applyPartnerAssetRegistration,
  backfillPartnerAssetMappings,
  buildPartnerAssetRegisterRpcPayload,
  createMemoryPartnerAssetRegistry,
  formatSha256Prefix,
  listPartnerRegisteredAssets,
  parseGlbPlaceholderAssetPath,
  partnerAssetGlbPlaceholderResponse,
  PARTNER_INTAKE_REGISTRATION_STATUS,
  PARTNER_RUNTIME_ASSET_CONTENT_TYPE,
  registerPartnerAsset,
  registrationPreconditions,
  STAGE_ASSET_STORAGE_TABLE,
  STAGE_PARTNER_ASSETS_TABLE,
  STAGE_REGISTER_PARTNER_ASSET_RPC,
} from "./partner-asset-register";
import { DEMO_FURNITURE_PARTNER_ID } from "./partner-catalog";
import {
  resolvePartnerPortalAuth,
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
  type StagePartnerMembershipRow,
} from "./partner-portal-auth";
import {
  CERTIFIED_STATIC_ASSET_SOURCE,
  isForbiddenBrowserUploadObjectPath,
  isPartnerIntakeRuntimeAssetId,
  isValidatorIntakeAssetId,
  PARTNER_INTAKE_ASSET_SOURCE,
  PARTNER_INTAKE_RUNTIME_ASSET_ID_PREFIX,
  partnerIntakeRuntimeAssetId,
  partnerRuntimeAssetGlbRoute,
  partnerRuntimeAssetObjectPath,
} from "./partner-runtime-asset-id";
import { isUuidLike } from "./product-variant-register";
import { isPartnerReadyAssetId } from "./partner-portal-assets";
import { createStageCatalogSnapshot } from "./catalog";
import type { StagePartner } from "./types";

const ROOT = process.cwd();
const REGISTER_SQL = "supabase/migrations/20260919100000_vibode_stage_partner_asset_registration.sql";
const CATALOG_SQL = "supabase/migrations/20260914120000_vibode_stage_catalog.sql";
const INTAKE_SQL = "supabase/migrations/20260918100000_vibode_stage_partner_asset_intakes.sql";
const SOFA_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb");
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const INTAKE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INTAKE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PI5F2_COFFEE = "afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1";
const PI5D_CHAIR = "afc-v2-runtime/test-fixtures/pi5d-lounge-chair";

const PI5G5B1_FILES = [
  REGISTER_SQL,
  "lib/vibode-stage/partner-runtime-asset-id.ts",
  "lib/vibode-stage/partner-asset-register.ts",
  "lib/vibode-stage/partner-asset-register.server.ts",
  "app/api/vibode/partner/assets/intakes/[intakeId]/register/route.ts",
  "app/api/vibode/partner/assets/route.ts",
  "app/api/vibode/assets/[...assetPath]/route.ts",
  "app/partner/assets/PartnerAssetWorkspaceClient.tsx",
  "app/partner/assets/page.tsx",
  "package.json",
];

const FROZEN_EXECUTORS = [
  "lib/vibode-stage/partner-catalog-runtime-executor.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v3.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v4.ts",
];

const UNTOUCHED_RUNTIME = [
  "lib/afc-v2-runtime/furniture-assets.ts",
  "lib/vibode-stage/partner-portal-assets.ts",
  "lib/vibode-stage/product-variant-register.ts",
  "app/api/vibode/3d-scene/route.ts",
];

installNodeGltfFileReader();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sofaBytes(): Uint8Array {
  return new Uint8Array(readFileSync(SOFA_GLB));
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

function membership(overrides: Partial<StagePartnerMembershipRow> = {}): StagePartnerMembershipRow {
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
    membershipId: "11111111-1111-1111-1111-111111111111",
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

async function createValidatedIntake(input: Readonly<{
  bytes?: Uint8Array;
  intakeId?: string;
  auth?: PartnerPortalAuthResult;
}> = {}) {
  const bytes = input.bytes ?? sofaBytes();
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const auth = input.auth ?? authOk();
  const created = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: input.intakeId ?? INTAKE_A,
    body: {
      originalFileName: "sofa.glb",
      byteSize: bytes.byteLength,
      authoredWidthM: PI4A_SOFA_AUTHORED_WIDTH_M,
      authoredHeightM: PI4A_SOFA_AUTHORED_HEIGHT_M,
      authoredDepthM: PI4A_SOFA_AUTHORED_DEPTH_M,
    },
  });
  assert.equal(created.status, 201);
  const objectPath = (created.body as { objectPath?: string }).objectPath!;
  objects.put(objectPath, bytes);
  const finalized = await finalizePartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: input.intakeId ?? INTAKE_A,
  });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  const registry = createMemoryPartnerAssetRegistry(store);
  return { store, objects, auth, registry, bytes, objectPath };
}

test("PI-5G5B1 deterministic Asset ID is server-derived and intake-scoped", () => {
  const first = partnerIntakeRuntimeAssetId(INTAKE_A);
  const again = partnerIntakeRuntimeAssetId(INTAKE_A.toUpperCase());
  const other = partnerIntakeRuntimeAssetId(INTAKE_B);
  assert.equal(first, `vibode-stage/partner-intake/${INTAKE_A}`);
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.equal(isPartnerIntakeRuntimeAssetId(first!), true);
  assert.equal(first!.includes(DEMO_FURNITURE_PARTNER_ID), false);
  assert.equal(first!.includes("public/"), false);
  assert.equal(first!.includes("afc-v2-runtime"), false);
  assert.equal(isValidatorIntakeAssetId(first!), false);
  assert.notEqual(first, validatorAssetIdForIntake(INTAKE_A));
  assert.ok(first!.length <= 256);
  assert.match(first!, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/);
  assert.equal(isUuidLike(INTAKE_A), true);
  assert.equal(partnerIntakeRuntimeAssetId("not-a-uuid"), null);
  assert.equal(partnerRuntimeAssetObjectPath(first!), `assets/${first}/model.glb`);
  assert.equal(partnerRuntimeAssetGlbRoute(first!), `/api/vibode/assets/${first}/glb`);
  assert.equal(isForbiddenBrowserUploadObjectPath(`assets/${first}/model.glb`), true);
  assert.equal(isForbiddenBrowserUploadObjectPath(`partners/${DEMO_FURNITURE_PARTNER_ID}/intakes/${INTAKE_A}/model.glb`), false);
});

test("PI-5G5B1 schema adds private mapping, storage provenance, intake link, and service-role RPC", () => {
  const sql = source(REGISTER_SQL);
  assert.match(sql, /create table public\.vibode_stage_partner_assets/);
  assert.match(sql, /create table public\.vibode_stage_asset_storage/);
  assert.match(sql, /add column asset_id text null references public\.vibode_stage_assets/);
  assert.match(sql, /primary key \(partner_id, asset_id\)/);
  assert.match(sql, /unique index vibode_stage_partner_assets_intake_id_uidx/);
  assert.match(sql, /unique index vibode_stage_partner_asset_intakes_asset_id_uidx/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.vibode_stage_partner_assets/);
  assert.match(sql, /revoke all on table public\.vibode_stage_asset_storage/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_stage_partner_assets\s+to service_role/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_stage_asset_storage\s+to service_role/);
  assert.doesNotMatch(sql, /create policy[\s\S]*on public\.vibode_stage_partner_assets/);
  assert.doesNotMatch(sql, /create policy[\s\S]*on public\.vibode_stage_asset_storage/);
  assert.match(sql, /create or replace function public\.vibode_stage_register_partner_asset/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /revoke all on function public\.vibode_stage_register_partner_asset\(jsonb\)/);
  assert.match(sql, /grant execute on function public\.vibode_stage_register_partner_asset\(jsonb\)\s+to service_role/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_source is distinct from 'partner_intake'/);
  assert.match(sql, /'unavailable'/);
  assert.match(sql, /vibode-stage\/partner-intake\//);
  assert.match(sql, /assets\/' \|\| v_expected_asset_id \|\| '\/model\.glb'/);
  assert.doesNotMatch(sql, /insert into public\.vibode_stage_products/);
  assert.doesNotMatch(sql, /update public\.vibode_stage_products/);
  assert.doesNotMatch(sql, /update public\.vibode_stage_variants/);
  assert.doesNotMatch(sql, /planVersion/);
  assert.doesNotMatch(sql, /alter table public\.vibode_stage_assets\s+add column/);
  assert.equal(STAGE_PARTNER_ASSETS_TABLE, "vibode_stage_partner_assets");
  assert.equal(STAGE_ASSET_STORAGE_TABLE, "vibode_stage_asset_storage");
  assert.equal(STAGE_REGISTER_PARTNER_ASSET_RPC, "vibode_stage_register_partner_asset");
  assert.match(source(CATALOG_SQL), /create policy "vibode_stage_assets_public_select"/);
  assert.doesNotMatch(source(INTAKE_SQL), /create table public\.vibode_stage_partner_assets/);
});

test("PI-5G5B1 mapping backfill is distinct Partner catalog eligibility and does not map curated-only Assets", () => {
  const sql = source(REGISTER_SQL);
  assert.match(sql, /insert into public\.vibode_stage_partner_assets/);
  assert.match(sql, /products\.source = 'partner_catalog'/);
  assert.match(sql, /products\.partner_id is not null/);
  assert.match(sql, /variants\.current_asset_id is not null/);
  assert.match(sql, /on conflict \(partner_id, asset_id\) do nothing/);
  const rows = backfillPartnerAssetMappings({
    products: [
      { productId: "prod-partner-a", partnerId: DEMO_FURNITURE_PARTNER_ID, source: "partner_catalog" },
      { productId: "prod-partner-b", partnerId: DEMO_FURNITURE_PARTNER_ID, source: "partner_catalog" },
      { productId: "prod-curated", partnerId: null, source: "vibode_curated" },
      { productId: "prod-other", partnerId: OTHER_PARTNER_ID, source: "partner_catalog" },
    ],
    variants: [
      { productId: "prod-partner-a", currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID },
      { productId: "prod-partner-a", currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID },
      { productId: "prod-partner-b", currentAssetId: PI5F2_COFFEE },
      { productId: "prod-curated", currentAssetId: PI5D_CHAIR },
      { productId: "prod-other", currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID },
    ],
  });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((item) => item.assetId === AFC_V2_RUNTIME_FURNITURE_ASSET_ID).length, 2);
  assert.equal(rows.some((item) => item.partnerId === DEMO_FURNITURE_PARTNER_ID && item.assetId === PI5F2_COFFEE), true);
  assert.equal(rows.some((item) => item.assetId === PI5D_CHAIR), false);
  assert.equal(rows.every((item) => item.intakeId === null), true);
});

test("PI-5G5B1 immutability triggers protect Partner-intake Assets and leave static rows unconstrained", () => {
  const sql = source(REGISTER_SQL);
  assert.match(sql, /vibode_stage_protect_partner_intake_asset_row/);
  assert.match(sql, /IMMUTABLE_PARTNER_INTAKE_ASSET/);
  assert.match(sql, /STORAGE_IMMUTABLE/);
  assert.match(sql, /INTAKE_ASSET_ID_IMMUTABLE/);
  assert.match(sql, /storage\.source = 'partner_intake'/);
  assert.match(sql, /NEW\.glb_url is distinct from OLD\.glb_url/);
  assert.match(sql, /NEW\.sha256 is distinct from OLD\.sha256/);
  assert.doesNotMatch(sql, /NEW\.status is distinct from OLD\.status/);
  assert.match(source(CATALOG_SQL), /status in \('ready', 'unavailable'\)/);
});

test("PI-5G5B1 registration preconditions reject unvalidated intakes", { timeout: 60_000 }, async () => {
  const { store, objects, auth, registry } = await createValidatedIntake();
  const createdOnly = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: INTAKE_B,
    body: {
      originalFileName: "other.glb",
      byteSize: 12,
      authoredWidthM: 1,
      authoredHeightM: 1,
      authoredDepthM: 1,
    },
  });
  assert.equal(createdOnly.status, 201);
  const unauth = await registerPartnerAsset({
    auth: authFail("unauthenticated", 401),
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(unauth.status, 401);
  const none = await registerPartnerAsset({
    auth: resolvePartnerPortalAuth({
      userId: USER_A,
      memberships: { ok: true, rows: [] },
      partner: demoPartner(),
    }),
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(none.status, 403);
  const foreign = await registerPartnerAsset({
    auth: authOk(otherPartner()),
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(foreign.status, 403);
  assert.equal((foreign.body as { errorCode?: string }).errorCode, "FORBIDDEN");
  const missing = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: INTAKE_B,
  });
  assert.equal(missing.status, 409);
  assert.equal((missing.body as { errorCode?: string }).errorCode, "INTAKE_NOT_VALIDATED");
  const unknown = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  });
  assert.equal(unknown.status, 404);
  const current = store.rows.find((item) => item.intakeId === INTAKE_A)!;
  const index = store.rows.indexOf(current);
  assert.equal(registrationPreconditions({ ...current, sha256: null }).ok, false);
  assert.equal(
    (registrationPreconditions({ ...current, measuredWidthM: null }) as { errorCode?: string }).errorCode,
    "INTAKE_MISSING_MEASURED_DIMENSIONS",
  );
  assert.equal(
    (registrationPreconditions({ ...current, placementScale: 0.5 }) as { errorCode?: string }).errorCode,
    "INVALID_PLACEMENT_SCALE",
  );
  assert.equal(index >= 0, true);
});

test("PI-5G5B1 register copies verified bytes to an immutable final path and inserts unavailable Asset", { timeout: 60_000 }, async () => {
  const { store, objects, auth, registry, bytes, objectPath } = await createValidatedIntake();
  const expectedId = partnerIntakeRuntimeAssetId(INTAKE_A)!;
  const expectedPath = partnerRuntimeAssetObjectPath(expectedId)!;
  const expectedSha = sha256Hex(bytes);
  const result = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const body = result.body as {
    ok?: boolean;
    idempotent?: boolean;
    asset?: {
      assetId: string;
      status: string;
      originalFileName: string;
      measuredWidthM: number;
      sha256: string;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.idempotent, false);
  assert.equal(body.asset?.assetId, expectedId);
  assert.equal(body.asset?.status, "unavailable");
  assert.equal(body.asset?.originalFileName, "sofa.glb");
  assert.equal(body.asset?.sha256, expectedSha);
  assert.equal(store.rows[0]?.assetId, expectedId);
  assert.equal(store.rows[0]?.status, "validated");
  assert.equal(registry.assets.length, 1);
  assert.equal(registry.assets[0]?.status, "unavailable");
  assert.equal(registry.assets[0]?.glbUrl, `/api/vibode/assets/${expectedId}/glb`);
  assert.equal(registry.assets[0]?.authoredWidthM, body.asset?.measuredWidthM);
  assert.equal(registry.storage[0]?.storageObjectPath, expectedPath);
  assert.equal(registry.storage[0]?.source, PARTNER_INTAKE_ASSET_SOURCE);
  assert.equal(registry.storage[0]?.sha256, expectedSha);
  assert.equal(registry.mappings.length, 1);
  assert.equal(registry.mappings[0]?.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(registry.mappings[0]?.intakeId, INTAKE_A);
  const finalBytes = objects.objects.get(expectedPath);
  assert.ok(finalBytes);
  assert.equal(sha256Hex(finalBytes), expectedSha);
  assert.notEqual(objectPath, expectedPath);
  assert.equal(objects.objects.get(objectPath) != null, true);
  const signed = await objects.createSignedUpload({ objectPath: expectedPath, upsert: false });
  assert.equal(signed.ok, false);
  const listed = await listPartnerRegisteredAssets({ auth, registry });
  const assets = (listed.body as { assets?: Array<{ origin?: string; status?: string }> }).assets ?? [];
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.origin, "partner_intake");
  assert.equal(assets[0]?.status, "unavailable");
});

test("PI-5G5B1 source overwrite after validation fails closed with no Asset, mapping, or intake link", { timeout: 60_000 }, async () => {
  const { store, objects, auth, registry, objectPath, bytes } = await createValidatedIntake();
  const other = new Uint8Array(bytes);
  other[other.length - 1] = (other[other.length - 1] ^ 0xff) & 0xff;
  objects.put(objectPath, other);
  assert.equal(other.byteLength, bytes.byteLength);
  assert.notEqual(sha256Hex(other), sha256Hex(bytes));
  const result = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(result.status, 409);
  assert.equal((result.body as { errorCode?: string }).errorCode, "SOURCE_SHA_MISMATCH");
  assert.equal(store.rows[0]?.assetId ?? null, null);
  assert.equal(registry.assets.length, 0);
  assert.equal(registry.mappings.length, 0);
  assert.equal(registry.storage.length, 0);
  assert.equal(objects.objects.has(partnerRuntimeAssetObjectPath(partnerIntakeRuntimeAssetId(INTAKE_A)!)!), false);
});

test("PI-5G5B1 source byte-size mismatch and missing object fail closed", { timeout: 60_000 }, async () => {
  const missing = await createValidatedIntake();
  missing.objects.objects.delete(missing.objectPath);
  const missingResult = await registerPartnerAsset({
    auth: missing.auth,
    store: missing.store,
    objects: missing.objects,
    registry: missing.registry,
    intakeId: INTAKE_A,
  });
  assert.equal(missingResult.status, 409);
  assert.equal((missingResult.body as { errorCode?: string }).errorCode, "SOURCE_OBJECT_MISSING");
  assert.equal(missing.store.rows[0]?.assetId ?? null, null);

  const sized = await createValidatedIntake({ intakeId: INTAKE_B });
  sized.objects.put(sized.objectPath, sofaBytes().subarray(0, 40));
  const sizedResult = await registerPartnerAsset({
    auth: sized.auth,
    store: sized.store,
    objects: sized.objects,
    registry: sized.registry,
    intakeId: INTAKE_B,
  });
  assert.equal(sizedResult.status, 409);
  assert.equal((sizedResult.body as { errorCode?: string }).errorCode, "SOURCE_BYTE_SIZE_MISMATCH");
  assert.equal(sized.store.rows[0]?.assetId ?? null, null);
  assert.equal(sized.registry.assets.length, 0);
});

test("PI-5G5B1 existing final object is idempotent on same SHA and fails closed on conflict", { timeout: 60_000 }, async () => {
  const same = await createValidatedIntake();
  const expectedId = partnerIntakeRuntimeAssetId(INTAKE_A)!;
  const expectedPath = partnerRuntimeAssetObjectPath(expectedId)!;
  same.objects.put(expectedPath, same.bytes);
  const ok = await registerPartnerAsset({
    auth: same.auth,
    store: same.store,
    objects: same.objects,
    registry: same.registry,
    intakeId: INTAKE_A,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(same.registry.assets.length, 1);
  assert.equal(sha256Hex(same.objects.objects.get(expectedPath)!), sha256Hex(same.bytes));

  const conflict = await createValidatedIntake({ intakeId: INTAKE_B });
  const conflictId = partnerIntakeRuntimeAssetId(INTAKE_B)!;
  const conflictPath = partnerRuntimeAssetObjectPath(conflictId)!;
  conflict.objects.put(conflictPath, new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
  const failed = await registerPartnerAsset({
    auth: conflict.auth,
    store: conflict.store,
    objects: conflict.objects,
    registry: conflict.registry,
    intakeId: INTAKE_B,
  });
  assert.equal(failed.status, 409);
  assert.equal((failed.body as { errorCode?: string }).errorCode, "FINAL_OBJECT_CONFLICT");
  assert.equal(conflict.store.rows[0]?.assetId ?? null, null);
  assert.equal(conflict.registry.assets.length, 0);
  assert.equal(conflict.registry.mappings.length, 0);
  assert.deepEqual(
    [...conflict.objects.objects.get(conflictPath)!],
    [9, 9, 9, 9, 9, 9, 9, 9],
  );
});

test("PI-5G5B1 retry after RPC failure reuses the existing final object", { timeout: 60_000 }, async () => {
  const { store, objects, auth, registry, bytes } = await createValidatedIntake();
  registry.failNextRegister = true;
  const first = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(first.status, 409);
  assert.equal((first.body as { errorCode?: string }).errorCode, "REGISTRATION_CONFLICT");
  const expectedPath = partnerRuntimeAssetObjectPath(partnerIntakeRuntimeAssetId(INTAKE_A)!)!;
  assert.equal(store.rows[0]?.assetId ?? null, null);
  assert.equal(registry.assets.length, 0);
  assert.equal(objects.objects.has(expectedPath), true);
  assert.equal(sha256Hex(objects.objects.get(expectedPath)!), sha256Hex(bytes));
  const writesBefore = objects.objects.get(expectedPath);
  const second = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(store.rows[0]?.assetId, partnerIntakeRuntimeAssetId(INTAKE_A));
  assert.equal(registry.assets.length, 1);
  assert.equal(registry.mappings.length, 1);
  assert.equal(objects.objects.get(expectedPath), writesBefore);
});

test("PI-5G5B1 idempotent re-register verifies the final object and does not recopy source", { timeout: 60_000 }, async () => {
  const { store, objects, auth, registry, objectPath } = await createValidatedIntake();
  const first = await registerPartnerAsset({ auth, store, objects, registry, intakeId: INTAKE_A });
  assert.equal(first.status, 200);
  objects.put(objectPath, new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7]));
  const second = await registerPartnerAsset({ auth, store, objects, registry, intakeId: INTAKE_A });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const body = second.body as { idempotent?: boolean; asset?: { assetId: string } };
  assert.equal(body.idempotent, true);
  assert.equal(body.asset?.assetId, partnerIntakeRuntimeAssetId(INTAKE_A));
  assert.equal(registry.assets.length, 1);
  assert.equal(registry.mappings.length, 1);
  assert.equal(store.rows.filter((item) => item.assetId).length, 1);
});

test("PI-5G5B1 concurrent register attempts converge on one Asset, mapping, and final object", { timeout: 60_000 }, async () => {
  const { store, objects, auth, registry } = await createValidatedIntake();
  const [left, right] = await Promise.all([
    registerPartnerAsset({ auth, store, objects, registry, intakeId: INTAKE_A }),
    registerPartnerAsset({ auth, store, objects, registry, intakeId: INTAKE_A }),
  ]);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(right.status, 200, JSON.stringify(right.body));
  const leftId = (left.body as { asset?: { assetId: string } }).asset?.assetId;
  const rightId = (right.body as { asset?: { assetId: string } }).asset?.assetId;
  assert.equal(leftId, rightId);
  assert.equal(leftId, partnerIntakeRuntimeAssetId(INTAKE_A));
  assert.equal(registry.assets.length, 1);
  assert.equal(registry.storage.length, 1);
  assert.equal(registry.mappings.length, 1);
  assert.equal(store.rows.filter((item) => item.assetId === leftId).length, 1);
  assert.equal(registry.assets[0]?.status, "unavailable");
});

test("PI-5G5B1 RPC payload is derived from intake measured geometry and rejects validator IDs", { timeout: 60_000 }, async () => {
  const { store } = await createValidatedIntake();
  const intake = store.rows[0]!;
  const payload = buildPartnerAssetRegisterRpcPayload({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    intake,
    sha256: intake.sha256!,
  });
  assert.equal("ok" in payload && payload.ok === false, false);
  if ("ok" in payload) throw new Error("expected payload");
  assert.equal(payload.assetId, partnerIntakeRuntimeAssetId(INTAKE_A));
  assert.equal(payload.status, PARTNER_INTAKE_REGISTRATION_STATUS);
  assert.equal(payload.source, PARTNER_INTAKE_ASSET_SOURCE);
  assert.equal(payload.authoredWidthM, intake.measuredWidthM);
  assert.equal(payload.authoredHeightM, intake.measuredHeightM);
  assert.equal(payload.authoredDepthM, intake.measuredDepthM);
  assert.equal(payload.storageBucket, PARTNER_ASSET_INTAKE_BUCKET);
  assert.equal(payload.glbUrl.startsWith("/api/vibode/assets/"), true);
  assert.doesNotMatch(payload.glbUrl, /token=|supabase|storage\/v1/);
  assert.equal(isValidatorIntakeAssetId(payload.assetId), false);
  const bad = await applyPartnerAssetRegistration({
    payload: { ...payload, assetId: validatorAssetIdForIntake(INTAKE_A) },
    assets: [],
    storage: [],
    mappings: [],
    intakes: store,
  });
  assert.equal(bad.ok, false);
});

test("PI-5G5B1 listing is Partner-scoped and includes catalog-linked mappings without intake actions", () => {
  const store = createMemoryPartnerAssetIntakeStore();
  const registry = createMemoryPartnerAssetRegistry(store, {
    assets: [
      {
        assetId: PI5F2_COFFEE,
        glbUrl: "/afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1.glb",
        authoredWidthM: 1.2,
        authoredHeightM: 0.4,
        authoredDepthM: 0.6,
        status: "ready",
        createdAt: "2026-09-15T00:00:00.000Z",
      },
    ],
    mappings: [
      {
        partnerId: DEMO_FURNITURE_PARTNER_ID,
        assetId: PI5F2_COFFEE,
        intakeId: null,
        createdAt: "2026-09-15T00:00:00.000Z",
      },
      {
        partnerId: OTHER_PARTNER_ID,
        assetId: PI5F2_COFFEE,
        intakeId: null,
        createdAt: "2026-09-15T00:00:00.000Z",
      },
    ],
  });
  return Promise.all([
    listPartnerRegisteredAssets({ auth: authOk(), registry }),
    listPartnerRegisteredAssets({ auth: authOk(otherPartner()), registry }),
  ]).then(([demo, other]) => {
    const demoAssets = (demo.body as { assets: Array<{ assetId: string; origin: string; originalFileName: string | null }> }).assets;
    const otherAssets = (other.body as { assets: Array<{ assetId: string }> }).assets;
    assert.equal(demoAssets.length, 1);
    assert.equal(otherAssets.length, 1);
    assert.equal(demoAssets[0]?.origin, "catalog_linked");
    assert.equal(demoAssets[0]?.originalFileName, null);
    assert.equal(CERTIFIED_STATIC_ASSET_SOURCE, "certified_static");
  });
});

test("PI-5G5B1 GLB route is a not-ready placeholder and does not stream bytes", () => {
  const parsed = parseGlbPlaceholderAssetPath([
    "vibode-stage",
    "partner-intake",
    INTAKE_A,
    "glb",
  ]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.assetId, partnerIntakeRuntimeAssetId(INTAKE_A));
  const response = partnerAssetGlbPlaceholderResponse();
  assert.equal(response.status, 409);
  assert.equal((response.body as { errorCode?: string }).errorCode, "ASSET_UNAVAILABLE");
  const route = source("app/api/vibode/assets/[...assetPath]/route.ts");
  assert.match(route, /runtime = "nodejs"/);
  assert.doesNotMatch(route, /download\(|createSignedUrl|storage\.from/);
  assert.doesNotMatch(route, /model\/gltf-binary/);
  assert.match(source("app/api/vibode/partner/assets/intakes/[intakeId]/register/route.ts"), /maxDuration = 300/);
  assert.match(source("app/api/vibode/partner/assets/intakes/[intakeId]/register/route.ts"), /runtime = "nodejs"/);
});

test("PI-5G5B1 portal copy distinguishes validated vs registered and does not claim ready", () => {
  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  const page = source("app/partner/assets/page.tsx");
  assert.match(client, /Register Asset/);
  assert.match(client, /GLB intake passed validation/);
  assert.match(client, /Immutable Vibode Asset created\. Runtime activation is still pending/);
  assert.match(client, /status = unavailable \/ not runtime-ready yet/);
  assert.match(client, /Catalog-linked Assets/);
  assert.doesNotMatch(client, /use in Product|use in Variant|Available in catalog|Usable in room/);
  assert.doesNotMatch(client, /productId|variantId|collectionId|planVersion/);
  assert.match(page, /runtime activation is still pending/);
  assert.equal(formatSha256Prefix("abcdef0123456789", 12), "abcdef012345");
});

test("PI-5G5B1 does not add runtime overlay, picker wiring, planVersion 5, or frozen executor changes", () => {
  const joined = PI5G5B1_FILES.map((file) => source(file)).join("\n");
  assert.doesNotMatch(joined, /planVersion['":\s]*5/);
  assert.doesNotMatch(joined, /furniture-asset-registry\.generated/);
  assert.doesNotMatch(joined, /furnitureAssetDefinition/);
  assert.doesNotMatch(joined, /validateTargetAsset/);
  assert.doesNotMatch(joined, /partner-catalog-runtime-executor/);
  assert.doesNotMatch(joined, /vibode_stage_apply_partner_patch/);
  assert.doesNotMatch(joined, /from\("vibode_stage_products"\)/);
  assert.doesNotMatch(joined, /from\("vibode_stage_variants"\)/);
  assert.doesNotMatch(joined, /from\("vibode_3d_scenes"\)/);
  assert.doesNotMatch(joined, /createSignedUploadUrl/);
  assert.match(source("lib/vibode-stage/partner-asset-register.ts"), /upsert: false/);
  assert.match(source("lib/vibode-stage/partner-asset-register.ts"), /PARTNER_RUNTIME_ASSET_CONTENT_TYPE/);
  assert.match(source("lib/vibode-stage/partner-asset-register.server.ts"), /upsert: false/);
  assert.match(source("lib/vibode-stage/partner-asset-register.server.ts"), /import "server-only"/);
  assert.match(source("package.json"), /test:afc-v2-pi5g5b1/);
  for (const file of FROZEN_EXECUTORS) {
    assert.doesNotMatch(source(file), /vibode_stage_partner_assets|partner-asset-register|partner-intake/);
  }
  for (const file of UNTOUCHED_RUNTIME) {
    assert.doesNotMatch(source(file), /partner-asset-register|vibode_stage_partner_assets|vibode_stage_asset_storage/);
  }
  const catalog = createStageCatalogSnapshot({
    authority: "durable",
    fallbackReason: null,
    products: [],
    variants: [],
    assets: [{
      assetId: partnerIntakeRuntimeAssetId(INTAKE_A)!,
      glbUrl: partnerRuntimeAssetGlbRoute(partnerIntakeRuntimeAssetId(INTAKE_A)!)!,
      authoredWidthM: 1,
      authoredHeightM: 1,
      authoredDepthM: 1,
      status: "unavailable",
    }],
    collections: [],
    partners: [],
  });
  assert.equal(isPartnerReadyAssetId(catalog, partnerIntakeRuntimeAssetId(INTAKE_A)!), false);
});
