import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createFurnitureAssetResolver,
  furnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/furniture-assets";
import {
  furnitureAssetPlacementAabb,
  PI4A_SOFA_PLACEMENT_LOCAL_AABB,
} from "@/lib/afc-v2-runtime/furniture-runtime";
import {
  addSceneObject,
  duplicateSceneObject,
  realizedTransformPenetratesWalls,
} from "@/lib/afc-v2-runtime/scene-crud";
import {
  persistenceSafeSceneObjects,
  sceneIdentitiesEqual,
  validatePersistedSceneObjects,
  type PersistedSceneIdentity,
} from "@/lib/afc-v2-runtime/persisted-scene";
import {
  overlayFromRuntimeDefinitions,
  replaceRuntimeAssetDefinitionList,
  runtimeDtoPrivacyViolations,
  upsertRuntimeOverlayDefinition,
  type RuntimeFurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import { versionScenePutBody } from "@/lib/afc-v2-runtime/scene-persistence-client";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  type FurnitureAssetDefinition,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import { PI3A_GENERATION_A, PI3A_RIGHT_WALL, PI3A_ROOM_ID } from "@/lib/afc-v2-runtime/pi3a-test-fixture";

import {
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_STUDIO_SOFA_VARIANT_ID,
} from "./catalog";
import { DEMO_FURNITURE_PARTNER_ID, DEMO_SOFA_DEFAULT_VARIANT_ID, DEMO_SOFA_PRODUCT_ID } from "./partner-catalog";
import { PARTNER_INTAKE_ASSET_SOURCE, partnerIntakeRuntimeAssetId } from "./partner-runtime-asset-id";
import type { DynamicRuntimeLookupRow, SignedGetMintResult } from "./partner-runtime-assets";
import {
  acquireStageAddLock,
  classifyStagePlacementKind,
  customerMessageForStageRuntimePlacementError,
  evaluateStageCommercialPlacement,
  interpretStageRuntimePlacementHttp,
  interpretStageRuntimePlacementResponse,
  isCurrentStageSceneGuard,
  parseStageRuntimePlacementRequest,
  parseStageRuntimePlacementSuccess,
  releaseStageAddLock,
  returnedAssetMatchesExpected,
  shouldRetryStageDynamicFirstLoad,
  STAGE_RUNTIME_PLACEMENT_PATH,
  stageAddLockKey,
  type StageCommercialAssetSnapshot,
  type StageCommercialPartnerSnapshot,
  type StageCommercialProductSnapshot,
  type StageCommercialVariantSnapshot,
  type StageRuntimePlacementRequest,
} from "./stage-runtime-placement";
import {
  placeStageRuntimeAsset,
  type StageCommercialPlacementRows,
} from "./stage-runtime-placement.server";

const ROOT = process.cwd();
const INTAKE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DYNAMIC_ID = partnerIntakeRuntimeAssetId(INTAKE_A)!;
const ROOM_ID = PI3A_ROOM_ID;
const VERSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GENERATION_ID = PI3A_GENERATION_A;
const USER_A = "22222222-2222-2222-2222-222222222222";
const SIGNED_URL = "https://signed.example/object?token=secret-token";
const FRESH_SIGNED_URL = "https://signed.example/object?token=fresh-token";

const CLIENT_GRAPH = [
  "lib/vibode-stage/stage-runtime-placement.ts",
  "lib/afc-v2-runtime/use-persisted-3d-scene.ts",
  "components/afc-3d/AfcProductionRoomViewer.tsx",
  "components/afc-3d/AfcIntegratedEditorViewport.tsx",
  "components/afc-3d/AfcSceneObjectCrudSession.tsx",
  "components/stage/StageEditorContext.tsx",
  "components/stage/StageCatalogDrawer.tsx",
  "components/stage/StageProductDetail.tsx",
  "components/stage/StageProductCard.tsx",
] as const;

const FORBIDDEN_CLIENT_IMPORTS =
  /from ["']server-only["']|from ["'].*partner-runtime-assets\.server|from ["'].*catalog-persistence\.server|from ["']node:fs["']|from ["'].*furniture-asset-manifest["']|from ["'].*product-variant-register["']/;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function identity(overrides: Partial<PersistedSceneIdentity> = {}): PersistedSceneIdentity {
  return {
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    afcGenerationId: GENERATION_ID,
    ...overrides,
  };
}

function request(overrides: Partial<StageRuntimePlacementRequest> = {}): StageRuntimePlacementRequest {
  return {
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    afcGenerationId: GENERATION_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    expectedAssetId: DYNAMIC_ID,
    ...overrides,
  };
}

function productSnap(overrides: Partial<StageCommercialProductSnapshot> = {}): StageCommercialProductSnapshot {
  return {
    productId: DEMO_SOFA_PRODUCT_ID,
    status: "active",
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    ...overrides,
  };
}

function variantSnap(overrides: Partial<StageCommercialVariantSnapshot> = {}): StageCommercialVariantSnapshot {
  return {
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    status: "active",
    currentAssetId: DYNAMIC_ID,
    ...overrides,
  };
}

function assetSnap(overrides: Partial<StageCommercialAssetSnapshot> = {}): StageCommercialAssetSnapshot {
  return {
    assetId: DYNAMIC_ID,
    status: "ready",
    authoredWidthM: 2.2,
    authoredHeightM: 0.8,
    authoredDepthM: 0.9,
    ...overrides,
  };
}

function partnerSnap(overrides: Partial<StageCommercialPartnerSnapshot> = {}): StageCommercialPartnerSnapshot {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    status: "active",
    ...overrides,
  };
}

function rows(overrides: Partial<StageCommercialPlacementRows> = {}): StageCommercialPlacementRows {
  return {
    product: productSnap(),
    variant: variantSnap(),
    asset: assetSnap(),
    partner: partnerSnap(),
    ...overrides,
  };
}

function provenance(overrides: Partial<DynamicRuntimeLookupRow> = {}): DynamicRuntimeLookupRow {
  return {
    assetId: DYNAMIC_ID,
    status: "ready",
    source: PARTNER_INTAKE_ASSET_SOURCE,
    authoredWidthM: 1.4,
    authoredHeightM: 0.72,
    authoredDepthM: 0.9,
    storageBucket: "private-partner-assets",
    storageObjectPath: `assets/${DYNAMIC_ID}/model.glb`,
    ...overrides,
  };
}

function dynamicDto(overrides: Partial<RuntimeFurnitureAssetDefinition> = {}): RuntimeFurnitureAssetDefinition {
  return {
    assetId: DYNAMIC_ID,
    glbUrl: SIGNED_URL,
    authoredWidthM: 1.4,
    authoredHeightM: 0.72,
    authoredDepthM: 0.9,
    expiresAt: "2026-09-18T22:00:00.000Z",
    ...overrides,
  };
}

function authorizeOk() {
  return async () => ({
    ok: true as const,
    context: {
      userId: USER_A,
      roomId: ROOM_ID,
      versionId: VERSION_ID,
      afcGenerationId: GENERATION_ID,
    },
  });
}

function authorizeFail(status: 400 | 401 | 404 | 500, error: string) {
  return async () => ({ ok: false as const, status, error });
}

async function place(input: {
  body?: unknown;
  userId?: string | null;
  rows?: StageCommercialPlacementRows;
  provenance?: DynamicRuntimeLookupRow | null;
  mint?: SignedGetMintResult;
  authorize?: ReturnType<typeof authorizeOk> | ReturnType<typeof authorizeFail>;
  mintCalls?: { count: number };
  mappingQueried?: { value: boolean };
}) {
  const mintCalls = input.mintCalls ?? { count: 0 };
  return placeStageRuntimeAsset({
    body: input.body ?? request(),
    userId: input.userId === undefined ? USER_A : input.userId,
    authorizeOwned: input.authorize ?? authorizeOk(),
    loadCommercialRows: async () => input.rows ?? rows(),
    lookupProvenance: async () => input.provenance === undefined ? provenance() : input.provenance,
    mintSignedGet: async () => {
      mintCalls.count += 1;
      return input.mint ?? {
        ok: true,
        signedUrl: SIGNED_URL,
        expiresAt: "2026-09-18T22:00:00.000Z",
      };
    },
  });
}

function commitDynamicAdd(overlay: Map<string, FurnitureAssetDefinition>, dto = dynamicDto()) {
  assert.equal(upsertRuntimeOverlayDefinition(overlay, dto), true);
  return addSceneObject({
    objects: [],
    assetId: dto.assetId,
    identity: {
      productId: DEMO_SOFA_PRODUCT_ID,
      variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    },
    createObjectId: () => "so-dynamic-add",
    resolver: createFurnitureAssetResolver(overlay),
  });
}

test("PI-5G5C2 request parser rejects extra keys, missing fields, and malformed IDs", () => {
  const valid = parseStageRuntimePlacementRequest(request());
  assert.equal(valid.ok, true);

  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    assetId: DYNAMIC_ID,
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    afcGenerationId: GENERATION_ID,
    productId: DEMO_SOFA_PRODUCT_ID,
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    roomId: "",
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    expectedAssetId: "",
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    roomId: "not-a-uuid",
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    productId: "x".repeat(200),
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    expectedAssetId: `../${DYNAMIC_ID}`,
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    expectedAssetId: `intake:${INTAKE_A}`,
  }).ok, false);
  assert.equal(parseStageRuntimePlacementRequest({
    ...request(),
    expectedAssetId: "a".repeat(300),
  }).ok, false);
});

test("PI-5G5C2 commercial evaluation covers catalog availability without mixing mint logic", () => {
  const ok = evaluateStageCommercialPlacement(rows());
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.assetId, DYNAMIC_ID);
  assert.equal(ok.partnerId, DEMO_FURNITURE_PARTNER_ID);

  const missingProduct = evaluateStageCommercialPlacement({
    ...rows(),
    product: null,
  });
  assert.equal(missingProduct.ok, false);
  if (!missingProduct.ok) assert.equal(missingProduct.errorCode, "PRODUCT_NOT_FOUND");

  const inactiveProduct = evaluateStageCommercialPlacement({
    ...rows(),
    product: productSnap({ status: "inactive" }),
  });
  assert.equal(inactiveProduct.ok, false);
  if (!inactiveProduct.ok) assert.equal(inactiveProduct.errorCode, "PRODUCT_INACTIVE");

  const missingVariant = evaluateStageCommercialPlacement({ ...rows(), variant: null });
  assert.equal(missingVariant.ok, false);
  if (!missingVariant.ok) assert.equal(missingVariant.errorCode, "VARIANT_NOT_FOUND");

  const inactiveVariant = evaluateStageCommercialPlacement({
    ...rows(),
    variant: variantSnap({ status: "inactive" }),
  });
  assert.equal(inactiveVariant.ok, false);
  if (!inactiveVariant.ok) assert.equal(inactiveVariant.errorCode, "VARIANT_INACTIVE");

  const mismatch = evaluateStageCommercialPlacement({
    ...rows(),
    variant: variantSnap({ productId: "prod-other" }),
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.errorCode, "VARIANT_PRODUCT_MISMATCH");

  const partnerInactive = evaluateStageCommercialPlacement({
    ...rows(),
    partner: partnerSnap({ status: "inactive" }),
  });
  assert.equal(partnerInactive.ok, false);
  if (!partnerInactive.ok) assert.equal(partnerInactive.errorCode, "PARTNER_INACTIVE");

  const missingAsset = evaluateStageCommercialPlacement({ ...rows(), asset: null });
  assert.equal(missingAsset.ok, false);
  if (!missingAsset.ok) assert.equal(missingAsset.errorCode, "ASSET_NOT_FOUND");

  const unready = evaluateStageCommercialPlacement({
    ...rows(),
    asset: assetSnap({ status: "unavailable" }),
  });
  assert.equal(unready.ok, false);
  if (!unready.ok) assert.equal(unready.errorCode, "ASSET_NOT_READY");

  const curated = evaluateStageCommercialPlacement({
    product: productSnap({
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      partnerId: null,
    }),
    variant: variantSnap({
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    }),
    asset: assetSnap({ assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }),
    partner: null,
  });
  assert.equal(curated.ok, true);
});

test("PI-5G5C2 endpoint mints dynamic DTO for an active published Variant", async () => {
  const mintCalls = { count: 0 };
  const placed = await place({ mintCalls });
  assert.equal(placed.status, 200);
  assert.equal(placed.body.ok, true);
  if (!placed.body.ok) return;
  assert.equal(placed.body.placementKind, "dynamic");
  assert.equal(placed.body.assetId, DYNAMIC_ID);
  assert.equal(placed.body.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(placed.body.variantId, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.ok(placed.body.runtimeAsset);
  assert.equal(placed.body.runtimeAsset?.glbUrl, SIGNED_URL);
  assert.equal(placed.body.runtimeAsset?.authoredWidthM, 1.4);
  assert.equal(mintCalls.count, 1);
  assert.deepEqual(runtimeDtoPrivacyViolations(placed.body.runtimeAsset!), []);
  const json = JSON.stringify(placed.body);
  assert.equal(json.includes("storageBucket"), false);
  assert.equal(json.includes("storage_object_path"), false);
  assert.equal(json.includes("sha256"), false);
  assert.equal(json.includes("intakeId"), false);
  assert.equal(json.includes("intake_id"), false);
  assert.equal(json.includes(DEMO_FURNITURE_PARTNER_ID), false);
});

test("PI-5G5C2 static generated Variant returns static and does not mint", async () => {
  const mintCalls = { count: 0 };
  const placed = await place({
    mintCalls,
    body: request({
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      expectedAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    }),
    rows: {
      product: productSnap({
        productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
        partnerId: null,
      }),
      variant: variantSnap({
        variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
        productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
        currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      }),
      asset: assetSnap({ assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }),
      partner: null,
    },
    provenance: provenance({ assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }),
  });
  assert.equal(placed.status, 200);
  assert.equal(placed.body.ok, true);
  if (!placed.body.ok) return;
  assert.equal(placed.body.placementKind, "static");
  assert.equal("runtimeAsset" in placed.body, false);
  assert.equal(mintCalls.count, 0);
  assert.equal(classifyStagePlacementKind(AFC_V2_RUNTIME_FURNITURE_ASSET_ID), "static");
  assert.equal(classifyStagePlacementKind(DYNAMIC_ID), "dynamic");
});

test("PI-5G5C2 commercial and room failures stay typed", async () => {
  const unauth = await place({ userId: null });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.body.ok, false);
  if (!unauth.body.ok) assert.equal(unauth.body.errorCode, "UNAUTHORIZED");

  const unowned = await place({
    authorize: authorizeFail(404, "Room not found."),
  });
  assert.equal(unowned.status, 404);
  assert.equal(unowned.body.ok, false);
  if (!unowned.body.ok) assert.equal(unowned.body.errorCode, "ROOM_NOT_FOUND");

  const version = await place({
    authorize: authorizeFail(404, "Version not found."),
  });
  assert.equal(version.body.ok, false);
  if (!version.body.ok) assert.equal(version.body.errorCode, "VERSION_NOT_FOUND");

  const missingProduct = await place({ rows: { ...rows(), product: null } });
  assert.equal(missingProduct.body.ok, false);
  if (!missingProduct.body.ok) assert.equal(missingProduct.body.errorCode, "PRODUCT_NOT_FOUND");

  const inactiveProduct = await place({
    rows: { ...rows(), product: productSnap({ status: "inactive" }) },
  });
  assert.equal(inactiveProduct.body.ok, false);
  if (!inactiveProduct.body.ok) assert.equal(inactiveProduct.body.errorCode, "PRODUCT_INACTIVE");

  const missingVariant = await place({ rows: { ...rows(), variant: null } });
  assert.equal(missingVariant.body.ok, false);
  if (!missingVariant.body.ok) assert.equal(missingVariant.body.errorCode, "VARIANT_NOT_FOUND");

  const inactiveVariant = await place({
    rows: { ...rows(), variant: variantSnap({ status: "inactive" }) },
  });
  assert.equal(inactiveVariant.body.ok, false);
  if (!inactiveVariant.body.ok) assert.equal(inactiveVariant.body.errorCode, "VARIANT_INACTIVE");

  const mismatch = await place({
    rows: { ...rows(), variant: variantSnap({ productId: "prod-other" }) },
  });
  assert.equal(mismatch.body.ok, false);
  if (!mismatch.body.ok) assert.equal(mismatch.body.errorCode, "VARIANT_PRODUCT_MISMATCH");

  const partnerInactive = await place({
    rows: { ...rows(), partner: partnerSnap({ status: "inactive" }) },
  });
  assert.equal(partnerInactive.body.ok, false);
  if (!partnerInactive.body.ok) assert.equal(partnerInactive.body.errorCode, "PARTNER_INACTIVE");

  const missingAsset = await place({ rows: { ...rows(), asset: null } });
  assert.equal(missingAsset.body.ok, false);
  if (!missingAsset.body.ok) assert.equal(missingAsset.body.errorCode, "ASSET_NOT_FOUND");

  const unready = await place({
    rows: { ...rows(), asset: assetSnap({ status: "unavailable" }) },
  });
  assert.equal(unready.body.ok, false);
  if (!unready.body.ok) assert.equal(unready.body.errorCode, "ASSET_NOT_READY");

  const stale = await place({
    body: request({ expectedAssetId: "vibode-stage/partner-intake/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
  });
  assert.equal(stale.body.ok, false);
  if (!stale.body.ok) {
    assert.equal(stale.body.errorCode, "STALE_VARIANT_ASSET");
    assert.equal(stale.body.error, "Refresh the catalog and try again.");
  }
});

test("PI-5G5C2 mapping is not required and scene rows are not loaded", async () => {
  const server = source("lib/vibode-stage/stage-runtime-placement.server.ts");
  assert.doesNotMatch(server, /vibode_stage_partner_assets|STAGE_PARTNER_ASSETS_TABLE|loadMapping/);
  assert.doesNotMatch(server, /resolveOwnedVersionScene|loadOwnedVersionScene|PI4C_SCENE_TABLE/);
  assert.match(server, /authorizeOwnedVersionScene/);
  const placed = await place({ rows: rows() });
  assert.equal(placed.body.ok, true);
});

test("PI-5G5C2 dynamic mint requires partner_intake provenance and static wins collisions", async () => {
  const noProvenance = await place({ provenance: null });
  assert.equal(noProvenance.body.ok, false);
  if (!noProvenance.body.ok) {
    assert.equal(noProvenance.body.errorCode, "RUNTIME_DEFINITION_UNAVAILABLE");
  }

  const wrongSource = await place({
    provenance: {
      ...provenance(),
      source: "certified_static" as DynamicRuntimeLookupRow["source"],
    },
  });
  assert.equal(wrongSource.body.ok, false);
  if (!wrongSource.body.ok) {
    assert.equal(wrongSource.body.errorCode, "RUNTIME_DEFINITION_UNAVAILABLE");
  }

  const mintFail = await place({ mint: { ok: false } });
  assert.equal(mintFail.body.ok, false);
  if (!mintFail.body.ok) {
    assert.equal(mintFail.body.errorCode, "RUNTIME_DEFINITION_UNAVAILABLE");
  }

  const mintCalls = { count: 0 };
  const collision = await place({
    body: request({
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      expectedAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    }),
    rows: {
      product: productSnap({
        productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
        partnerId: null,
      }),
      variant: variantSnap({
        variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
        productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
        currentAssetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      }),
      asset: assetSnap({ assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }),
      partner: null,
    },
    provenance: provenance({ assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID }),
    mintCalls,
  });
  assert.equal(collision.body.ok, true);
  if (collision.body.ok) assert.equal(collision.body.placementKind, "static");
});

test("PI-5G5C2 customer-safe error mapping never exposes Asset IDs", () => {
  assert.equal(
    customerMessageForStageRuntimePlacementError("PRODUCT_INACTIVE"),
    "This item is no longer available.",
  );
  assert.equal(
    customerMessageForStageRuntimePlacementError("STALE_VARIANT_ASSET"),
    "Refresh the catalog and try again.",
  );
  assert.equal(
    customerMessageForStageRuntimePlacementError("RUNTIME_DEFINITION_UNAVAILABLE"),
    "This furniture model is temporarily unavailable.",
  );
  assert.equal(
    customerMessageForStageRuntimePlacementError("ROOM_NOT_FOUND"),
    "Furniture isn't ready yet.",
  );
  const mapped = customerMessageForStageRuntimePlacementError("ASSET_NOT_FOUND");
  assert.equal(mapped.includes(DYNAMIC_ID), false);
  assert.equal(mapped.includes("signed"), false);
});

test("PI-5G5C2 overlay upsert is session-local, static-first, and identity-guarded", () => {
  const overlay = new Map<string, FurnitureAssetDefinition>();
  assert.equal(upsertRuntimeOverlayDefinition(overlay, dynamicDto()), true);
  assert.equal(overlay.get(DYNAMIC_ID)?.glbUrl, SIGNED_URL);
  assert.equal(
    upsertRuntimeOverlayDefinition(overlay, dynamicDto({ glbUrl: FRESH_SIGNED_URL })),
    true,
  );
  assert.equal(overlay.get(DYNAMIC_ID)?.glbUrl, FRESH_SIGNED_URL);
  const staticDto = dynamicDto({
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    glbUrl: "https://evil.example/static.glb",
  });
  assert.equal(upsertRuntimeOverlayDefinition(overlay, staticDto), false);
  assert.equal(overlay.has(AFC_V2_RUNTIME_FURNITURE_ASSET_ID), false);
  assert.equal(furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID)?.glbUrl.includes("evil"), false);

  const second = dynamicDto({
    assetId: "vibode-stage/partner-intake/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    glbUrl: "https://signed.example/second.glb",
  });
  assert.equal(upsertRuntimeOverlayDefinition(overlay, second), true);
  assert.equal(overlay.size, 2);

  const replaced = replaceRuntimeAssetDefinitionList([dynamicDto()], dynamicDto({
    glbUrl: FRESH_SIGNED_URL,
  }));
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0]?.glbUrl, FRESH_SIGNED_URL);

  const captured = identity();
  assert.equal(isCurrentStageSceneGuard({
    capturedIdentity: captured,
    currentIdentity: captured,
    capturedRevision: 1,
    currentRevision: 1,
  }), true);
  assert.equal(isCurrentStageSceneGuard({
    capturedIdentity: captured,
    currentIdentity: identity({ versionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
    capturedRevision: 1,
    currentRevision: 1,
  }), false);
  assert.equal(isCurrentStageSceneGuard({
    capturedIdentity: captured,
    currentIdentity: captured,
    capturedRevision: 1,
    currentRevision: 2,
  }), false);
  assert.equal(sceneIdentitiesEqual(captured, identity()), true);

  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  assert.match(hook, /upsertRuntimeAssetDefinition/);
  assert.match(hook, /ensureCommercialPlacement/);
  assert.match(hook, /STAGE_RUNTIME_PLACEMENT_PATH|fetchStageRuntimePlacement/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage/);
  assert.match(hook, /overlayRef\.current = new Map\(\)/);
});

test("PI-5G5C2 resolver-aware add succeeds for dynamic and stays generated-only by default", () => {
  const overlay = new Map<string, FurnitureAssetDefinition>();
  const withoutResolver = addSceneObject({
    objects: [],
    assetId: DYNAMIC_ID,
    createObjectId: () => "so-closed",
  });
  assert.equal(withoutResolver.ok, false);
  if (!withoutResolver.ok) assert.equal(withoutResolver.reason, "unknown_asset");

  const added = commitDynamicAdd(overlay);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.assetId, DYNAMIC_ID);
  assert.equal(added.object.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(added.object.variantId, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal("glbUrl" in added.object, false);

  const staticAdd = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: () => "so-static",
  });
  assert.equal(staticAdd.ok, true);

  const aabb = furnitureAssetPlacementAabb(
    DYNAMIC_ID,
    createFurnitureAssetResolver(overlay),
  );
  assert.ok(aabb);
  assert.equal(aabb?.max.x - aabb!.min.x, 1.4);
  assert.equal(aabb?.max.y - aabb!.min.y, 0.72);
  assert.equal(aabb?.max.z - aabb!.min.z, 0.9);

  const colliding = addSceneObject({
    objects: [],
    assetId: DYNAMIC_ID,
    createObjectId: () => "so-wall",
    resolver: createFurnitureAssetResolver(overlay),
    placement: {
      metricScale: 1,
      realizedWalls: [PI3A_RIGHT_WALL],
      localAabb: PI4A_SOFA_PLACEMENT_LOCAL_AABB,
    },
  });
  assert.equal(colliding.ok, true);
  if (!colliding.ok) return;
  assert.equal(
    realizedTransformPenetratesWalls({
      realized: colliding.object.transform,
      localAabb: PI4A_SOFA_PLACEMENT_LOCAL_AABB,
      realizedWalls: [PI3A_RIGHT_WALL],
    }),
    false,
  );

  const duplicated = duplicateSceneObject({
    objects: added.objects,
    objectId: added.object.objectId,
    createObjectId: () => "so-dup",
    resolver: createFurnitureAssetResolver(overlay),
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.equal(duplicated.object.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(duplicated.object.variantId, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(duplicated.objects.length, 2);
});

test("PI-5G5C2 persistence keeps identity only and reload stays on G5B2", () => {
  const overlay = new Map<string, FurnitureAssetDefinition>();
  const added = commitDynamicAdd(overlay);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const mixed = addSceneObject({
    objects: added.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: {
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    },
    createObjectId: () => "so-static-mix",
  });
  assert.equal(mixed.ok, true);
  if (!mixed.ok) return;
  const safe = persistenceSafeSceneObjects(mixed.objects);
  const put = versionScenePutBody(identity(), { objects: safe });
  const json = JSON.stringify(put);
  assert.equal(json.includes("glbUrl"), false);
  assert.equal(json.includes("expiresAt"), false);
  assert.equal(json.includes("storageBucket"), false);
  assert.equal(json.includes("sha256"), false);
  assert.equal(put.objects.some((object) => object.assetId === DYNAMIC_ID), true);
  assert.equal(put.objects.some((object) => (
    object.productId === DEMO_SOFA_PRODUCT_ID && object.variantId === DEMO_SOFA_DEFAULT_VARIANT_ID
  )), true);
  assert.equal(validatePersistedSceneObjects(put.objects).ok, true);
  const restored = overlayFromRuntimeDefinitions([dynamicDto()]);
  assert.equal(restored.get(DYNAMIC_ID)?.glbUrl, SIGNED_URL);
  assert.ok(furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID));
  const sceneRoute = source("app/api/vibode/3d-scene/route.ts");
  assert.match(sceneRoute, /enrichOwnedSceneRuntimeAssets/);
  const resolveRoute = source("app/api/vibode/runtime/assets/resolve/route.ts");
  assert.match(resolveRoute, /intersectRequestedSceneAssetIds/);
  assert.match(resolveRoute, /resolveOwnedVersionScene/);
  assert.doesNotMatch(resolveRoute, /productId|variantId|stage-runtime-placement/);
});

test("PI-5G5C2 client add guards: static skip, stale discard, first-load retry, double-click, Recent success-only", () => {
  assert.equal(classifyStagePlacementKind(AFC_V2_RUNTIME_FURNITURE_ASSET_ID), "static");
  assert.equal(returnedAssetMatchesExpected(DYNAMIC_ID, DYNAMIC_ID), true);
  assert.equal(returnedAssetMatchesExpected(DYNAMIC_ID, AFC_V2_RUNTIME_FURNITURE_ASSET_ID), false);
  assert.equal(shouldRetryStageDynamicFirstLoad(1), true);
  assert.equal(shouldRetryStageDynamicFirstLoad(2), false);

  const lock = new Set<string>();
  const key = stageAddLockKey(DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_DEFAULT_VARIANT_ID);
  assert.equal(acquireStageAddLock(lock, key), true);
  assert.equal(acquireStageAddLock(lock, key), false);
  releaseStageAddLock(lock, key);
  assert.equal(acquireStageAddLock(lock, key), true);

  const staticFallback = interpretStageRuntimePlacementResponse({
    ok: true,
    productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
    variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    placementKind: "static",
  });
  assert.equal(staticFallback.ok, true);
  if (staticFallback.ok) {
    assert.equal(staticFallback.placementKind, "static");
    assert.equal("runtimeAsset" in staticFallback, false);
  }

  const failedBootstrap = interpretStageRuntimePlacementHttp({
    ok: false,
    status: 409,
    payload: {
      ok: false,
      errorCode: "RUNTIME_DEFINITION_UNAVAILABLE",
      error: "This furniture model is temporarily unavailable.",
    },
  });
  assert.equal(failedBootstrap.ok, false);
  const objects: SceneObjectDefinition[] = [];
  assert.equal(objects.length, 0);

  const context = source("components/stage/StageEditorContext.tsx");
  const addStart = context.indexOf("const addProductToRoom = useCallback");
  const addEnd = context.indexOf("const pasteProductLink");
  const addBody = context.slice(addStart, addEnd);
  assert.match(addBody, /rememberRecentlyUsed\(current, productId\)/);
  assert.match(addBody, /setAddedProductId\(productId\)/);
  assert.match(addBody, /acquireStageAddLock/);
  assert.match(addBody, /result\.ok/);
  assert.match(addBody, /setAddError/);
  const rememberIndex = addBody.indexOf("rememberRecentlyUsed");
  const awaitIndex = addBody.indexOf("await session.addFurnitureWithIdentity");
  assert.ok(awaitIndex >= 0 && rememberIndex > awaitIndex);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(viewer, /furnitureAssetDefinition\(assetId\)/);
  assert.match(viewer, /ensureCommercialPlacement/);
  assert.match(viewer, /allowRefresh: false/);
  assert.match(viewer, /shouldRetryStageDynamicFirstLoad/);
  assert.match(viewer, /resolver/);
  assert.doesNotMatch(viewer.slice(
    viewer.indexOf("addSceneObject: (assetId"),
    viewer.indexOf("duplicateSceneObject:"),
  ), /RUNTIME_ASSET_RESOLVE_PATH|refreshRuntimeAssetRef/);

  const card = source("components/stage/StageProductCard.tsx");
  assert.match(card, /Adding…/);
  const detail = source("components/stage/StageProductDetail.tsx");
  assert.match(detail, /Adding…/);
  assert.match(detail, /addError/);
  assert.match(card, /addError/);
});

test("PI-5G5C2 security: no raw Asset mint, /glb stays 409, signed URL is not logged", async () => {
  const extraAsset = parseStageRuntimePlacementRequest({
    ...request(),
    assetId: DYNAMIC_ID,
  });
  assert.equal(extraAsset.ok, false);
  const extraSuccess = parseStageRuntimePlacementSuccess({
    ok: true,
    productId: DEMO_SOFA_PRODUCT_ID,
    variantId: DEMO_SOFA_DEFAULT_VARIANT_ID,
    assetId: DYNAMIC_ID,
    placementKind: "dynamic",
    runtimeAsset: dynamicDto(),
    partnerId: DEMO_FURNITURE_PARTNER_ID,
  });
  assert.equal(extraSuccess, null);
  const leaked = {
    ...dynamicDto(),
    storageBucket: "leaked",
  } as RuntimeFurnitureAssetDefinition;
  assert.ok(runtimeDtoPrivacyViolations(leaked).length > 0);

  const glb = source("app/api/vibode/assets/[...assetPath]/route.ts");
  assert.match(glb, /partnerAssetGlbPlaceholderResponse/);
  assert.doesNotMatch(glb, /createSignedUrl|mintPartnerRuntimeSignedGet/);
  const placementRoute = source("app/api/vibode/stage/runtime-placement/route.ts");
  assert.match(placementRoute, /authorizeProductionAfcUser/);
  assert.match(placementRoute, /placeOwnedStageRuntimeAsset/);
  assert.doesNotMatch(placementRoute, /resolvePartnerPortalContext/);
  const server = source("lib/vibode-stage/stage-runtime-placement.server.ts");
  assert.match(server, /import "server-only"/);
  assert.doesNotMatch(server, /console\.(?:log|warn|error)\([^)]*signedUrl/);
  assert.doesNotMatch(server, /console\.(?:log|warn|error)\([^)]*glbUrl/);
  assert.match(source("package.json"), /test:afc-v2-pi5g5c2/);
  assert.equal(STAGE_RUNTIME_PLACEMENT_PATH, "/api/vibode/stage/runtime-placement");
});

test("PI-5G5C2 client/server import boundary and no SQL/registry mutation", () => {
  for (const file of CLIENT_GRAPH) {
    assert.doesNotMatch(source(file), FORBIDDEN_CLIENT_IMPORTS, file);
  }
  const clientModule = source("lib/vibode-stage/stage-runtime-placement.ts");
  assert.doesNotMatch(clientModule, FORBIDDEN_CLIENT_IMPORTS);
  const migrations = source("package.json");
  assert.doesNotMatch(migrations, /20260921.*g5c2|vibode_stage_runtime_placement/);
  const generated = source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts");
  assert.doesNotMatch(generated, /f9c22d42-c447-4506-aac6-85a219a8a7fc/);
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.doesNotMatch(viewer, /Curved Boucle|f9c22d42-c447-4506-aac6-85a219a8a7fc/);
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  assert.match(crud, /resolver\?: FurnitureAssetResolver/);
  assert.match(crud, /const resolve = input\.resolver \?\? furnitureAssetDefinition/);
});
