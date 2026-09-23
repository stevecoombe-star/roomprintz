import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import {
  createFurnitureAssetResolver,
  furnitureAssetDefinition,
  uniqueRegisteredFurnitureAssetIds,
} from "@/lib/afc-v2-runtime/furniture-assets";
import { createFurnitureTemplateCache } from "@/lib/afc-v2-runtime/furniture-template-cache";
import { instantiateSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import {
  addSceneObject,
  duplicateSceneObject,
} from "@/lib/afc-v2-runtime/scene-crud";
import {
  persistenceSafeSceneObjects,
  PI4C_MAX_SCENE_OBJECTS,
  validatePersistedSceneObjects,
} from "@/lib/afc-v2-runtime/persisted-scene";
import {
  overlayFromRuntimeDefinitions,
  parseRuntimeFurnitureAssetDefinition,
  runtimeDtoPrivacyViolations,
  RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC,
  type RuntimeFurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
  type FurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/types";
import { interpretVersionSceneLoadResponse } from "@/lib/afc-v2-runtime/scene-persistence-client";
import { PI3A_GENERATION_A, PI3A_ROOM_ID } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "@/lib/afc-v2-runtime/pi4a-sofa-geometry";
import { installNodeGltfFileReader } from "@/lib/afc-v2-runtime/node-gltf-file-reader";

import { createStageCatalogSnapshot } from "./catalog";
import { DEMO_FURNITURE_PARTNER_ID } from "./partner-catalog";
import { isPartnerReadyAssetId } from "./partner-portal-assets";
import {
  createMemoryPartnerAssetIntakeStore,
  createMemoryPartnerAssetObjectStore,
  createPartnerAssetIntake,
  finalizePartnerAssetIntake,
} from "./partner-asset-intake";
import {
  createMemoryPartnerAssetRegistry,
  registerPartnerAsset,
} from "./partner-asset-register";
import {
  activatePartnerAsset,
  applyPartnerAssetActivation,
  createMemoryPartnerRuntimeActivationStore,
  expiresAtFromNow,
  intersectRequestedSceneAssetIds,
  memoryLookupFromRegistry,
  parseRuntimeAssetResolveBody,
  resolveSceneRuntimeAssets,
  runtimeDefinitionLeaksProvenance,
  splitStaticAndDynamicAssetIds,
  STAGE_ACTIVATE_PARTNER_ASSET_RPC,
} from "./partner-runtime-assets";
import {
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
} from "./partner-portal-auth";
import { partnerIntakeRuntimeAssetId } from "./partner-runtime-asset-id";
import { validateTargetAsset } from "./product-variant-register";
import type { StagePartner } from "./types";

const ROOT = process.cwd();
const ACTIVATE_SQL = "supabase/migrations/20260919200000_vibode_stage_partner_asset_activation.sql";
const REGISTER_SQL = "supabase/migrations/20260919100000_vibode_stage_partner_asset_registration.sql";
const SOFA_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb");
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const INTAKE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYNAMIC_ID = partnerIntakeRuntimeAssetId(INTAKE_A)!;
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GENERATION_ID = PI3A_GENERATION_A;

const FROZEN_EXECUTORS = [
  "lib/vibode-stage/partner-catalog-runtime-executor.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v3.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v4.ts",
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

function sceneObject(objectId: string, assetId: string) {
  return {
    objectId,
    assetId,
    transform: DEFAULT_WORLD_TRANSFORM,
  };
}

function furnitureAssetDefinitionFromOverlay(): FurnitureAssetDefinition {
  return {
    assetId: DYNAMIC_ID,
    glbUrl: "https://signed.example/dynamic.glb",
    authoredWidthM: 2.2,
    authoredHeightM: 0.8,
    authoredDepthM: 0.9,
  };
}

function dynamicDto(overrides: Partial<RuntimeFurnitureAssetDefinition> = {}): RuntimeFurnitureAssetDefinition {
  return {
    assetId: DYNAMIC_ID,
    glbUrl: "https://signed.example/object?token=secret-token",
    authoredWidthM: 2.2,
    authoredHeightM: 0.8,
    authoredDepthM: 0.9,
    expiresAt: expiresAtFromNow(1_700_000_000_000),
    ...overrides,
  };
}

async function createRegisteredUnavailable() {
  const bytes = sofaBytes();
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const auth = authOk();
  const created = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: INTAKE_A,
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
    intakeId: INTAKE_A,
  });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  const registry = createMemoryPartnerAssetRegistry(store);
  const registered = await registerPartnerAsset({
    auth,
    store,
    objects,
    registry,
    intakeId: INTAKE_A,
  });
  assert.equal(registered.status, 200, JSON.stringify(registered.body));
  return { store, objects, auth, registry, bytes };
}

function mintOk() {
  return async () => ({
    ok: true as const,
    signedUrl: "https://signed.example/object?token=secret-token",
    expiresAt: expiresAtFromNow(),
  });
}

function proveOk() {
  return async () => ({ ok: true as const, status: 200, byteLength: 12 });
}

test("PI-5G5B2 resolver is static-first and overlay is additive", () => {
  const overlay = new Map<string, FurnitureAssetDefinition>([
    [DYNAMIC_ID, furnitureAssetDefinitionFromOverlay()],
    [AFC_V2_RUNTIME_FURNITURE_ASSET_ID, {
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      glbUrl: "https://evil.example/shadow.glb?token=x",
      authoredWidthM: 9,
      authoredHeightM: 9,
      authoredDepthM: 9,
    }],
  ]);
  const resolver = createFurnitureAssetResolver(overlay);
  const sofa = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID)!;
  assert.equal(resolver(AFC_V2_RUNTIME_FURNITURE_ASSET_ID)?.glbUrl, sofa.glbUrl);
  assert.equal(resolver(DYNAMIC_ID)?.glbUrl, "https://signed.example/dynamic.glb");
  assert.equal(resolver("missing-dynamic"), null);
  assert.equal(furnitureAssetDefinition(DYNAMIC_ID), null);
});

test("PI-5G5B2 overlay collision ignores generated IDs", () => {
  const overlay = overlayFromRuntimeDefinitions([
    dynamicDto({ assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }),
    dynamicDto(),
  ]);
  assert.equal(overlay.has(AFC_V2_RUNTIME_FURNITURE_ASSET_ID), false);
  assert.equal(overlay.has(DYNAMIC_ID), true);
});

test("PI-5G5B2 static-only scene does not query dynamic lookup", async () => {
  let lookups = 0;
  const resolved = await resolveSceneRuntimeAssets({
    assetIds: [AFC_V2_RUNTIME_FURNITURE_ASSET_ID, AFC_V2_RUNTIME_FURNITURE_ASSET_ID],
    lookupDynamicAssets: async () => {
      lookups += 1;
      throw new Error("should not lookup static IDs");
    },
    mintSignedGet: async () => ({ ok: false }),
  });
  assert.equal(lookups, 0);
  assert.equal(resolved.queriedIds, null);
  assert.equal(resolved.assetDefinitions.length, 0);
  assert.equal(resolved.assetIssues.length, 0);
});

test("PI-5G5B2 mixed scene batches one dynamic lookup and keeps static zero-DB", { timeout: 60_000 }, async () => {
  const { registry } = await createRegisteredUnavailable();
  registry.assets[0] = { ...registry.assets[0]!, status: "ready" };
  let lookups = 0;
  let mintCalls = 0;
  const resolved = await resolveSceneRuntimeAssets({
    assetIds: [
      AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      DYNAMIC_ID,
      AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    ],
    lookupDynamicAssets: async (ids) => {
      lookups += 1;
      assert.deepEqual([...ids], [DYNAMIC_ID]);
      return memoryLookupFromRegistry(registry)(ids);
    },
    mintSignedGet: async (row) => {
      mintCalls += 1;
      assert.equal(row.assetId, DYNAMIC_ID);
      assert.equal(row.status, "ready");
      return {
        ok: true,
        signedUrl: "https://signed.example/object?token=secret-token",
        expiresAt: expiresAtFromNow(),
      };
    },
  });
  assert.equal(lookups, 1);
  assert.equal(mintCalls, 1);
  assert.equal(resolved.assetDefinitions.length, 1);
  assert.equal(resolved.assetDefinitions[0]?.assetId, DYNAMIC_ID);
  assert.equal(runtimeDefinitionLeaksProvenance(resolved.assetDefinitions[0]!), false);
  assert.deepEqual(runtimeDtoPrivacyViolations(resolved.assetDefinitions[0]!), []);
  assert.doesNotMatch(JSON.stringify(resolved.assetDefinitions), /storage_object_path|sha256|partner_id|intake_id/);
});

test("PI-5G5B2 unavailable, unknown, and mint failure emit issues without definitions", { timeout: 60_000 }, async () => {
  const { registry } = await createRegisteredUnavailable();
  const unavailable = await resolveSceneRuntimeAssets({
    assetIds: [DYNAMIC_ID],
    lookupDynamicAssets: memoryLookupFromRegistry(registry),
    mintSignedGet: mintOk(),
  });
  assert.equal(unavailable.assetDefinitions.length, 0);
  assert.equal(unavailable.assetIssues[0]?.code, "RUNTIME_ASSET_NOT_READY");

  const missing = await resolveSceneRuntimeAssets({
    assetIds: ["vibode-stage/partner-intake/ffffffff-ffff-ffff-ffff-ffffffffffff"],
    lookupDynamicAssets: memoryLookupFromRegistry(registry),
    mintSignedGet: mintOk(),
  });
  assert.equal(missing.assetIssues[0]?.code, "RUNTIME_ASSET_NOT_FOUND");

  registry.assets[0] = { ...registry.assets[0]!, status: "ready" };
  const mintFailed = await resolveSceneRuntimeAssets({
    assetIds: [DYNAMIC_ID],
    lookupDynamicAssets: memoryLookupFromRegistry(registry),
    mintSignedGet: async () => ({ ok: false }),
  });
  assert.equal(mintFailed.assetDefinitions.length, 0);
  assert.equal(mintFailed.assetIssues[0]?.code, "RUNTIME_ASSET_URL_MINT_FAILED");
  assert.doesNotMatch(JSON.stringify(mintFailed.assetIssues), /token=|storage_object_path/);
});

test("PI-5G5B2 scene JSON privacy strips runtime-only fields", () => {
  const validated = validatePersistedSceneObjects([
    {
      objectId: "so-dynamic",
      assetId: DYNAMIC_ID,
      transform: DEFAULT_WORLD_TRANSFORM,
      glbUrl: "https://signed.example/object?token=secret-token",
      signedUrl: "https://signed.example/object?token=secret-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      authoredWidthM: 2.2,
      storageBucket: "vibode-stage-assets",
      storageObjectPath: "assets/secret/model.glb",
      sha256: "abc",
      partnerId: DEMO_FURNITURE_PARTNER_ID,
    },
  ]);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const object = validated.objects[0]!;
  assert.equal(object.assetId, DYNAMIC_ID);
  assert.equal("glbUrl" in object, false);
  assert.equal("signedUrl" in object, false);
  assert.equal("expiresAt" in object, false);
  assert.equal("authoredWidthM" in object, false);
  assert.equal("storageBucket" in object, false);
  assert.equal("sha256" in object, false);
  assert.equal("partnerId" in object, false);
  const json = JSON.stringify(persistenceSafeSceneObjects(validated.objects));
  assert.doesNotMatch(json, /signedUrl|expiresAt|storageObjectPath|token=|sha256|partnerId/);
});

test("PI-5G5B2 inherited and persisted object lists use the same enrichment path", async () => {
  const split = splitStaticAndDynamicAssetIds([
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    DYNAMIC_ID,
  ]);
  assert.deepEqual(split.staticIds, [AFC_V2_RUNTIME_FURNITURE_ASSET_ID]);
  assert.deepEqual(split.dynamicMisses, [DYNAMIC_ID]);
  const route = source("app/api/vibode/3d-scene/route.ts");
  assert.match(route, /enrichOwnedSceneRuntimeAssets\(resolved\.scene\.objects\)/);
  assert.match(route, /origin: resolved\.origin/);
  assert.doesNotMatch(route, /partner-asset-register|vibode_stage_partner_assets|vibode_stage_asset_storage/);
});

test("PI-5G5B2 refresh intersects requested IDs with the authorized scene and fails closed on extra keys", () => {
  const allowed = intersectRequestedSceneAssetIds({
    requestedAssetIds: [DYNAMIC_ID, "not-in-scene", AFC_V2_RUNTIME_FURNITURE_ASSET_ID],
    sceneAssetIds: [AFC_V2_RUNTIME_FURNITURE_ASSET_ID, DYNAMIC_ID],
  });
  assert.deepEqual(allowed, [DYNAMIC_ID, AFC_V2_RUNTIME_FURNITURE_ASSET_ID]);
  const extra = parseRuntimeAssetResolveBody({
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    afcGenerationId: GENERATION_ID,
    assetIds: [DYNAMIC_ID],
    extra: true,
  });
  assert.equal(extra.ok, false);
  const nested = parseRuntimeAssetResolveBody({
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    afcGenerationId: GENERATION_ID,
    assetIds: [{ id: DYNAMIC_ID }],
  });
  assert.equal(nested.ok, false);
  const ok = parseRuntimeAssetResolveBody({
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    afcGenerationId: GENERATION_ID,
    assetIds: [DYNAMIC_ID],
  });
  assert.equal(ok.ok, true);
  const resolveRoute = source("app/api/vibode/runtime/assets/resolve/route.ts");
  assert.match(resolveRoute, /authorizeProductionAfcUser/);
  assert.match(resolveRoute, /resolveOwnedVersionScene/);
  assert.match(resolveRoute, /intersectRequestedSceneAssetIds/);
});

test("PI-5G5B2 overlay lifecycle resets with room/version/generation and cache key is assetId", async () => {
  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  assert.match(hook, /overlayRef\.current = new Map\(\)/);
  assert.match(hook, /overlayFromRuntimeDefinitions/);
  assert.match(hook, /RUNTIME_ASSET_RESOLVE_PATH/);
  const cache = source("lib/afc-v2-runtime/furniture-template-cache.ts");
  assert.match(cache, /templates\.set\(assetId, result\.scene\)/);
  assert.match(cache, /refreshDynamicAsset/);
  assert.match(cache, /RUNTIME_ASSET_LOAD_FAILED/);
  const unique = uniqueRegisteredFurnitureAssetIds(
    [DYNAMIC_ID, DYNAMIC_ID, AFC_V2_RUNTIME_FURNITURE_ASSET_ID],
    createFurnitureAssetResolver(new Map([[DYNAMIC_ID, furnitureAssetDefinitionFromOverlay()]])),
  );
  assert.deepEqual(unique, [DYNAMIC_ID, AFC_V2_RUNTIME_FURNITURE_ASSET_ID]);
  let loads = 0;
  const templateCache = createFurnitureTemplateCache({
    resolver: createFurnitureAssetResolver(new Map([
      [DYNAMIC_ID, furnitureAssetDefinitionFromOverlay()],
    ])),
    load: async () => {
      loads += 1;
      return { ok: true, scene: new THREE.Group() };
    },
  });
  await templateCache.ensure([DYNAMIC_ID, DYNAMIC_ID]);
  assert.equal(loads, 1);
  assert.equal(templateCache.loadedAssetIds().has(DYNAMIC_ID), true);
  templateCache.dispose();
});

test("PI-5G5B2 dynamic instantiation and duplicate work through the resolver; add stays generated-only", () => {
  const overlay = new Map([[DYNAMIC_ID, furnitureAssetDefinitionFromOverlay()]]);
  const resolver = createFurnitureAssetResolver(overlay);
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: GENERATION_ID,
    definitions: [
      sceneObject("so-static", AFC_V2_RUNTIME_FURNITURE_ASSET_ID),
      sceneObject("so-dynamic", DYNAMIC_ID),
    ],
    resolver,
  });
  assert.equal(instantiated.objects.length, 2);
  assert.equal(instantiated.skipped.length, 0);
  const skipped = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: GENERATION_ID,
    definitions: [sceneObject("so-dynamic", DYNAMIC_ID)],
  });
  assert.equal(skipped.objects.length, 0);
  assert.equal(skipped.skipped[0]?.reason, "unknown_asset");

  const added = addSceneObject({
    objects: [],
    assetId: DYNAMIC_ID,
    createObjectId: () => "so-add-dynamic",
  });
  assert.equal(added.ok, false);
  if (!added.ok) assert.equal(added.reason, "unknown_asset");

  const persisted = [sceneObject("so-dynamic", DYNAMIC_ID)];
  const withoutResolver = duplicateSceneObject({
    objects: persisted,
    objectId: "so-dynamic",
    createObjectId: () => "so-dup",
  });
  assert.equal(withoutResolver.ok, false);
  const duplicated = duplicateSceneObject({
    objects: persisted,
    objectId: "so-dynamic",
    createObjectId: () => "so-dup",
    resolver,
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.equal(duplicated.object.assetId, DYNAMIC_ID);
  assert.notEqual(duplicated.object.objectId, "so-dynamic");
  assert.equal("glbUrl" in duplicated.object, false);
});

test("PI-5G5B2 placeholder GLB route remains a non-oracle", () => {
  const route = source("app/api/vibode/assets/[...assetPath]/route.ts");
  assert.match(route, /partnerAssetGlbPlaceholderResponse/);
  assert.doesNotMatch(route, /createSignedUrl|download\(|storage\.from|redirect|stream/);
  assert.match(route, /runtime = "nodejs"/);
});

test("PI-5G5B2 activation mapping auth, mint failure, unavailable→ready, ready→ready, technical fields unchanged", { timeout: 60_000 }, async () => {
  const seeded = await createRegisteredUnavailable();
  const store = createMemoryPartnerRuntimeActivationStore(seeded.registry);
  const width = seeded.registry.assets[0]!.authoredWidthM;
  const objectPath = seeded.registry.storage[0]!.storageObjectPath;
  const mapping = seeded.registry.mappings[0]!;

  const unauth = await activatePartnerAsset({
    auth: authFail("unauthenticated", 401),
    store,
    assetId: DYNAMIC_ID,
    mintSignedGet: mintOk(),
    proveSignedGet: proveOk(),
  });
  assert.equal(unauth.status, 401);

  const foreign = await activatePartnerAsset({
    auth: authOk(otherPartner()),
    store,
    assetId: DYNAMIC_ID,
    mintSignedGet: mintOk(),
    proveSignedGet: proveOk(),
  });
  assert.equal(foreign.status, 403);
  assert.equal((foreign.body as { errorCode?: string }).errorCode, "FORBIDDEN");
  assert.equal(seeded.registry.assets[0]?.status, "unavailable");

  const mintFail = await activatePartnerAsset({
    auth: seeded.auth,
    store,
    assetId: DYNAMIC_ID,
    mintSignedGet: async () => ({ ok: false }),
    proveSignedGet: proveOk(),
  });
  assert.equal(mintFail.status, 409);
  assert.equal((mintFail.body as { errorCode?: string }).errorCode, "TRANSPORT_PROOF_FAILED");
  assert.equal(seeded.registry.assets[0]?.status, "unavailable");

  const fetchFail = await activatePartnerAsset({
    auth: seeded.auth,
    store,
    assetId: DYNAMIC_ID,
    mintSignedGet: mintOk(),
    proveSignedGet: async () => ({ ok: false }),
  });
  assert.equal(fetchFail.status, 409);
  assert.equal(seeded.registry.assets[0]?.status, "unavailable");

  const first = await activatePartnerAsset({
    auth: seeded.auth,
    store,
    assetId: DYNAMIC_ID,
    mintSignedGet: mintOk(),
    proveSignedGet: proveOk(),
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal((first.body as { asset?: { status?: string } }).asset?.status, "ready");
  assert.equal((first.body as { idempotent?: boolean }).idempotent, false);
  assert.equal(seeded.registry.assets[0]?.status, "ready");
  assert.equal(seeded.registry.assets[0]?.authoredWidthM, width);
  assert.equal(seeded.registry.storage[0]?.storageObjectPath, objectPath);
  assert.equal(seeded.registry.mappings[0]?.partnerId, mapping.partnerId);
  assert.equal(seeded.store.rows[0]?.assetId, DYNAMIC_ID);

  const second = await activatePartnerAsset({
    auth: seeded.auth,
    store,
    assetId: DYNAMIC_ID,
    mintSignedGet: mintOk(),
    proveSignedGet: proveOk(),
  });
  assert.equal(second.status, 200);
  assert.equal((second.body as { idempotent?: boolean }).idempotent, true);
  assert.equal(seeded.registry.assets[0]?.status, "ready");
  assert.equal(seeded.registry.assets.length, 1);
  assert.equal(JSON.stringify(second.body).includes("signedUrl"), false);
});

test("PI-5G5B2 activation RPC SQL is service-role-only and status-only", () => {
  const sql = source(ACTIVATE_SQL);
  assert.match(sql, /create or replace function public\.vibode_stage_activate_partner_asset\(p_activate jsonb\)/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /for update/);
  assert.match(sql, /revoke all on function public\.vibode_stage_activate_partner_asset\(jsonb\)/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.vibode_stage_activate_partner_asset\(jsonb\)\s+to service_role/);
  assert.match(sql, /set status = 'ready'/);
  assert.doesNotMatch(sql, /authored_width_m\s*=/);
  assert.doesNotMatch(sql, /storage_object_path\s*=/);
  assert.doesNotMatch(sql, /create table|alter table/);
  assert.doesNotMatch(sql, /planVersion/);
  assert.doesNotMatch(sql, /execute immediate|format\(/);
  assert.equal(STAGE_ACTIVATE_PARTNER_ASSET_RPC, "vibode_stage_activate_partner_asset");
  assert.doesNotMatch(source(REGISTER_SQL), /vibode_stage_activate_partner_asset/);
});

test("PI-5G5B2 picker remains closed after ready and validateTargetAsset is unchanged", { timeout: 60_000 }, async () => {
  const { registry } = await createRegisteredUnavailable();
  registry.assets[0] = { ...registry.assets[0]!, status: "ready" };
  const catalog = createStageCatalogSnapshot({
    authority: "durable",
    fallbackReason: null,
    products: [],
    variants: [],
    assets: [{
      assetId: DYNAMIC_ID,
      glbUrl: `/api/vibode/assets/${DYNAMIC_ID}/glb`,
      authoredWidthM: 2.2,
      authoredHeightM: 0.8,
      authoredDepthM: 0.9,
      status: "ready",
    }],
    collections: [],
    partners: [],
  });
  assert.equal(isPartnerReadyAssetId(catalog, DYNAMIC_ID), false);
  const errors: { code: string; message: string }[] = [];
  validateTargetAsset(DYNAMIC_ID, { catalog }, errors);
  assert.ok(errors.some((item) => (
    item.code === "UNKNOWN_ASSET" ||
    item.code === "RUNTIME_MISSING_ASSET" ||
    item.code === "UNKNOWN_RUNTIME_DEFINITION"
  )));
  assert.doesNotMatch(source("lib/vibode-stage/product-variant-register.ts"), /partner-runtime-assets/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-assets.ts"), /partner-runtime-assets/);
});

test("PI-5G5B2 does not add planVersion 5, picker wiring, or generated registry mutation", () => {
  const files = [
    "lib/afc-v2-runtime/runtime-furniture-assets.ts",
    "lib/vibode-stage/partner-runtime-assets.ts",
    "lib/vibode-stage/partner-runtime-assets.server.ts",
    "app/api/vibode/runtime/assets/resolve/route.ts",
    "app/api/vibode/partner/assets/[...assetPath]/route.ts",
    "app/api/vibode/3d-scene/route.ts",
    "app/partner/assets/PartnerAssetWorkspaceClient.tsx",
    ACTIVATE_SQL,
  ];
  const joined = files.map((file) => source(file)).join("\n");
  assert.doesNotMatch(joined, /planVersion['":\s]*5/);
  assert.doesNotMatch(joined, /validateTargetAsset/);
  assert.doesNotMatch(joined, /partner-catalog-runtime-executor/);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts"), /partner-intake/);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-asset-manifest.json"), /partner-intake/);
  for (const file of FROZEN_EXECUTORS) {
    assert.doesNotMatch(source(file), /partner-runtime-assets|Activate Runtime|planVersion: 5/);
  }
  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  assert.match(client, /Activate Runtime/);
  assert.match(client, /Runtime ready/);
  assert.match(client, /Make this registered Asset available to the Vibode room runtime/);
  assert.doesNotMatch(client, /available in catalog|selectable for Product|published/i);
  assert.doesNotMatch(client, /productId|variantId|collectionId|planVersion/);
  assert.equal(RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC, 3600);
});

test("PI-5G5B2 signed URL logging privacy and client scene-load retain overlay fields", () => {
  const server = source("lib/vibode-stage/partner-runtime-assets.server.ts");
  const runtime = source("lib/vibode-stage/partner-runtime-assets.ts");
  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(runtime, /warnRuntimeAssetIssue/);
  assert.doesNotMatch(runtime, /console\.(?:log|warn|error)\([^)]*signedUrl/);
  assert.doesNotMatch(server, /console\.(?:log|warn|error)\([^)]*signedUrl/);
  assert.doesNotMatch(hook, /console\.warn\([^)]*glbUrl/);
  assert.match(source("lib/afc-v2-runtime/scene-persistence-client.ts"), /assetDefinitions/);
  assert.match(source("lib/afc-v2-runtime/scene-persistence-client.ts"), /assetIssues/);
  const interpreted = interpretVersionSceneLoadResponse({
    ok: true,
    payload: {
      status: "ready",
      scene: {
        roomId: ROOM_ID,
        versionId: VERSION_ID,
        afcGenerationId: GENERATION_ID,
        coordinateSpace: "calibrated-world-xz/v1",
        objects: [sceneObject("so-a", AFC_V2_RUNTIME_FURNITURE_ASSET_ID)],
      },
      origin: "inherited",
      currentAfcGenerationId: GENERATION_ID,
      assetDefinitions: [dynamicDto()],
    },
  });
  assert.equal(interpreted.status, "ready");
  if (interpreted.status !== "ready") return;
  assert.equal(interpreted.origin, "inherited");
  assert.equal(interpreted.assetDefinitions?.[0]?.assetId, DYNAMIC_ID);
  assert.match(viewer, /createFurnitureAssetResolver/);
  assert.match(viewer, /furnitureAssetDefinition\(assetId\)/);
  assert.match(source("components/afc-3d/AfcIntegratedEditorViewport.tsx"), /runtimeAssetOverlay=\{persistedScene\.runtimeAssetOverlay\}/);
  assert.match(source("package.json"), /test:afc-v2-pi5g5b2/);
  assert.equal(parseRuntimeFurnitureAssetDefinition(dynamicDto())?.assetId, DYNAMIC_ID);
  assert.equal(PI4C_MAX_SCENE_OBJECTS, 32);
  const applied = applyPartnerAssetActivation({
    payload: { partnerId: DEMO_FURNITURE_PARTNER_ID, assetId: DYNAMIC_ID },
    assets: [],
    storage: [],
    mappings: [],
  });
  assert.equal(applied.ok, false);
});

test("PI-5G5B2 cache refresh retries dynamic load once then stops", async () => {
  let loads = 0;
  let refreshes = 0;
  const cache = createFurnitureTemplateCache({
    resolver: createFurnitureAssetResolver(new Map([
      [DYNAMIC_ID, furnitureAssetDefinitionFromOverlay()],
    ])),
    refreshDynamicAsset: async () => {
      refreshes += 1;
      return {
        assetId: DYNAMIC_ID,
        glbUrl: "https://signed.example/refreshed.glb",
        authoredWidthM: 2.2,
        authoredHeightM: 0.8,
        authoredDepthM: 0.9,
      };
    },
    load: async (url) => {
      loads += 1;
      if (url.includes("refreshed")) {
        return { ok: true, scene: new THREE.Group() };
      }
      return { ok: false, message: "expired" };
    },
  });
  const outcomes = await cache.ensure([DYNAMIC_ID]);
  assert.equal(loads, 2);
  assert.equal(refreshes, 1);
  assert.equal(outcomes[0]?.ok, true);
  cache.dispose();
});
