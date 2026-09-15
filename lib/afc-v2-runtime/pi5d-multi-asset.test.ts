import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import {
  furnitureAssetDefinition,
  furnitureAssetGlbUrl,
  uniqueRegisteredFurnitureAssetIds,
} from "./furniture-assets";
import { cloneFurnitureGlbScene, parseFurnitureGlb } from "./furniture-glb-loader";
import {
  authoredPlacementLocalAabb,
  furnitureAssetPlacementAabb,
  instantiateSceneObjectDefinitions,
  PI4A_SOFA_PLACEMENT_LOCAL_AABB,
} from "./furniture-runtime";
import {
  createFurnitureTemplateCache,
  mergeMountedAndSkippedSceneObjects,
} from "./furniture-template-cache";
import { computeImportPlacement } from "./object-import-bounds";
import {
  attachImportedObject,
  createSceneObjectRoot,
  localAabbDimensions,
  measurePlacementLocalAabb,
} from "./object-runtime";
import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "./pi4a-sofa-geometry";
import {
  createPi5dLoungeChairObject3D,
  PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
} from "./pi5d-lounge-chair-geometry";
import { PI5D2_SIDE_TABLE_ASSET_ID } from "./pi5d2-side-table-geometry";
import { createPi3aAuthority, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import { validatePersistedSceneObjects } from "./persisted-scene";
import {
  addSceneObject,
  duplicateSceneObject,
} from "./scene-crud";
import {
  createRuntimeSceneCollection,
  mountLiveRuntimeSceneObject,
  serializeRuntimeScene,
  setLiveSceneObject,
} from "./scene-runtime";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH,
  DEFAULT_WORLD_TRANSFORM,
  type SceneObjectDefinition,
} from "./types";
import {
  resolveStagePlacement,
  STAGE_SEED_CATALOG,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_CHAIR_VARIANT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_VARIANT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_STUDIO_SOFA_VARIANT_ID,
} from "@/lib/vibode-stage/catalog";
import { buildStageSummary } from "@/lib/vibode-stage/summary";

const ROOT = process.cwd();
const SOFA_GLB_PATH = path.join(
  ROOT,
  "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb",
);
const CHAIR_GLB_PATH = path.join(
  ROOT,
  "public/afc-v2-runtime/test-fixtures/pi5d-lounge-chair.glb",
);
const PI5D_MIGRATION =
  "supabase/migrations/20260914140000_vibode_stage_catalog_lounge_chair_asset.sql";
const PI5C_MIGRATION = "supabase/migrations/20260914120000_vibode_stage_catalog.sql";
const DIMENSION_TOLERANCE_M = 1e-3;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayBufferFromFile(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!found && mesh.isMesh) found = mesh;
  });
  assert.ok(found, "expected a mesh");
  return found as THREE.Mesh;
}

function definition(input: Readonly<{
  objectId: string;
  assetId: string;
  productId?: string;
  variantId?: string;
  x?: number;
}>): SceneObjectDefinition {
  return {
    objectId: input.objectId,
    assetId: input.assetId,
    transform: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: input.x ?? 0, y: 0, z: 0 },
      uniformScale: 1,
    },
    productId: input.productId,
    variantId: input.variantId,
  };
}

function mixedSceneDefinitions(): readonly SceneObjectDefinition[] {
  return [
    definition({
      objectId: "so-pi5d-a1",
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      x: -1.1,
    }),
    definition({
      objectId: "so-pi5d-b",
      assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
      productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
      variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
      x: 0.4,
    }),
    definition({
      objectId: "so-pi5d-a2",
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
      variantId: STAGE_STUDIO_SETTEE_VARIANT_ID,
      x: 1.2,
    }),
  ];
}

async function parseFixture(filePath: string) {
  const loaded = await parseFurnitureGlb(arrayBufferFromFile(filePath));
  if (!loaded.ok) {
    throw new Error(loaded.message);
  }
  return loaded.scene;
}

test("PI-5D1 Asset A and Asset B resolve to distinct GLB URLs and unknown Assets fail closed", () => {
  const sofa = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  const chair = furnitureAssetDefinition(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.ok(sofa);
  assert.ok(chair);
  assert.equal(sofa.glbUrl, AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH);
  assert.equal(chair.glbUrl, AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH);
  assert.notEqual(sofa.glbUrl, chair.glbUrl);
  assert.equal(furnitureAssetGlbUrl("not-a-registered-asset"), null);
  assert.equal(furnitureAssetDefinition("not-a-registered-asset"), null);

  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: createPi3aAuthority().generationId,
    definitions: [
      definition({ objectId: "so-known", assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID }),
      definition({ objectId: "so-unknown", assetId: "missing-runtime-asset" }),
    ],
  });
  assert.equal(instantiated.objects.length, 1);
  assert.equal(instantiated.objects[0]?.assetIdentity.id, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(instantiated.skipped.length, 1);
  assert.equal(instantiated.skipped[0]?.reason, "unknown_asset");
  assert.equal(instantiated.skipped[0]?.assetId, "missing-runtime-asset");
});

test("PI-5D1 A/B/A unique Asset load is de-duplicated and clones share one template", async () => {
  const sofaScene = await parseFixture(SOFA_GLB_PATH);
  const chairScene = await parseFixture(CHAIR_GLB_PATH);
  let loads = 0;
  const cache = createFurnitureTemplateCache({
    load: async (url) => {
      loads += 1;
      if (url === AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH) {
        return { ok: true, scene: chairScene };
      }
      if (url === AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH) {
        return { ok: true, scene: sofaScene };
      }
      return { ok: false, message: `unexpected url ${url}` };
    },
  });
  const ids = mixedSceneDefinitions().map((object) => object.assetId);
  assert.deepEqual(
    uniqueRegisteredFurnitureAssetIds(ids),
    [AFC_V2_RUNTIME_FURNITURE_ASSET_ID, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID],
  );
  const outcomes = await cache.ensure(ids);
  assert.equal(loads, 2);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes.every((outcome) => outcome.ok), true);
  assert.equal(cache.loadedAssetIds().size, 2);

  const sofaTemplate = cache.template(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  const chairTemplate = cache.template(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.ok(sofaTemplate);
  assert.ok(chairTemplate);
  const sofaCloneA = cloneFurnitureGlbScene(sofaTemplate);
  const sofaCloneB = cloneFurnitureGlbScene(sofaTemplate);
  const chairClone = cloneFurnitureGlbScene(chairTemplate);
  assert.notEqual(sofaCloneA, sofaCloneB);
  assert.equal(firstMesh(sofaCloneA).geometry, firstMesh(sofaTemplate).geometry);
  assert.equal(firstMesh(sofaCloneB).geometry, firstMesh(sofaTemplate).geometry);
  assert.notEqual(firstMesh(chairClone).geometry, firstMesh(sofaTemplate).geometry);
  cache.dispose();
});

test("PI-5D1 sofa and chair keep authored metres with uniformScale 1 and no fit-to-box", async () => {
  const sofa = await parseFixture(SOFA_GLB_PATH);
  const chair = await parseFixture(CHAIR_GLB_PATH);
  const sofaPlacement = computeImportPlacement(sofa);
  const chairPlacement = computeImportPlacement(chair);
  assert.equal(sofaPlacement.ok, true);
  assert.equal(chairPlacement.ok, true);
  assert.equal(sofaPlacement.scale, 1);
  assert.equal(chairPlacement.scale, 1);
  assert.ok(Math.abs(sofaPlacement.measuredSize.x - PI4A_SOFA_AUTHORED_WIDTH_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(chairPlacement.measuredSize.x - PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M) < DIMENSION_TOLERANCE_M);
  assert.ok(chairPlacement.measuredSize.x < sofaPlacement.measuredSize.x - 0.5);

  const sofaRoot = createSceneObjectRoot();
  attachImportedObject(sofaRoot.importPlacement, sofa);
  const chairRoot = createSceneObjectRoot();
  attachImportedObject(chairRoot.importPlacement, createPi5dLoungeChairObject3D());
  const sofaAabb = measurePlacementLocalAabb(sofaRoot.placement, sofaRoot.importPlacement);
  const chairAabb = measurePlacementLocalAabb(chairRoot.placement, chairRoot.importPlacement);
  assert.ok(sofaAabb && chairAabb);
  const sofaSize = localAabbDimensions(sofaAabb);
  const chairSize = localAabbDimensions(chairAabb);
  assert.ok(Math.abs(sofaSize.width - PI4A_SOFA_AUTHORED_WIDTH_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(sofaSize.height - PI4A_SOFA_AUTHORED_HEIGHT_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(sofaSize.depth - PI4A_SOFA_AUTHORED_DEPTH_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(chairSize.width - PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(chairSize.height - PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M) < DIMENSION_TOLERANCE_M);
  assert.ok(Math.abs(chairSize.depth - PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M) < DIMENSION_TOLERANCE_M);
  assert.deepEqual(sofaRoot.importPlacement.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(chairRoot.importPlacement.scale.toArray(), [1, 1, 1]);

  const loader = source("lib/afc-v2-runtime/furniture-glb-loader.ts");
  const importBounds = source("lib/afc-v2-runtime/object-import-bounds.ts");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const geometry = source("lib/afc-v2-runtime/pi5d-lounge-chair-geometry.ts");
  for (const text of [loader, importBounds, viewer, geometry]) {
    assert.doesNotMatch(text, /fit-to-1\.5|fitToRoom|userWorldScale|DEFAULT_PX_PER_IN|autoBounds|normalize-to-room/);
  }
  assert.match(importBounds, /const scale = 1/);
});

test("PI-5D1 Add and Duplicate use per-Asset authored placement AABB", () => {
  const sofaBox = furnitureAssetPlacementAabb(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  const chairBox = furnitureAssetPlacementAabb(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.deepEqual(sofaBox, PI4A_SOFA_PLACEMENT_LOCAL_AABB);
  assert.deepEqual(
    chairBox,
    authoredPlacementLocalAabb({
      authoredWidthM: PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
      authoredHeightM: PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
      authoredDepthM: PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
    }),
  );
  assert.ok(sofaBox && chairBox);
  assert.notEqual(sofaBox.max.x, chairBox.max.x);
  assert.equal(furnitureAssetPlacementAabb("missing-runtime-asset"), null);

  const sofa = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: {
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    },
    createObjectId: () => "so-pi5d-add-sofa",
  });
  assert.equal(sofa.ok, true);
  if (!sofa.ok) return;
  const chair = addSceneObject({
    objects: sofa.objects,
    assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
    identity: {
      productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
      variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
    },
    createObjectId: () => "so-pi5d-add-chair",
  });
  assert.equal(chair.ok, true);
  if (!chair.ok) return;
  assert.equal(chair.object.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(chair.object.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(chair.object.variantId, STAGE_STUDIO_CHAIR_VARIANT_ID);
  assert.equal(chair.object.transform.uniformScale, 1);
  const duplicated = duplicateSceneObject({
    objects: chair.objects,
    objectId: chair.object.objectId,
    createObjectId: () => "so-pi5d-dup-chair",
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.equal(duplicated.object.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(duplicated.object.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(duplicated.object.variantId, STAGE_STUDIO_CHAIR_VARIANT_ID);
  assert.equal(duplicated.object.userSizeMultiplier, undefined);
});

test("PI-5D1 mixed Scene Objects restore exact Asset IDs without schema change", () => {
  const definitions = mixedSceneDefinitions();
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: createPi3aAuthority().generationId,
    definitions,
  });
  assert.equal(instantiated.objects.length, 3);
  assert.deepEqual(
    instantiated.objects.map((object) => object.assetIdentity.id),
    [
      AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
      AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    ],
  );
  assert.equal(instantiated.objects[0]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(instantiated.objects[1]?.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(instantiated.objects[2]?.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  for (const object of instantiated.objects) {
    assert.equal(object.transform.uniformScale, 1);
    assert.equal(object.assetIdentity.kind, "test_furniture_glb");
  }

  const validated = validatePersistedSceneObjects(definitions);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  for (const object of validated.objects) {
    assert.equal("objectId" in object, true);
    assert.equal("assetId" in object, true);
    assert.equal("transform" in object, true);
    assert.equal(object.transform.uniformScale, 1);
    assert.equal("glbUrl" in object, false);
    assert.equal("authoredWidthM" in object, false);
    assert.equal("templateId" in object, false);
  }
  const json = JSON.stringify(validated.objects);
  assert.doesNotMatch(json, /glbUrl|authoredWidthM|templateId|signedUrl/);
});

test("PI-5D1 mixed restore clones the correct template per object", async () => {
  const sofaScene = await parseFixture(SOFA_GLB_PATH);
  const chairScene = await parseFixture(CHAIR_GLB_PATH);
  const cache = createFurnitureTemplateCache({
    load: async (url) => {
      if (url === AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH) {
        return { ok: true, scene: chairScene };
      }
      return { ok: true, scene: sofaScene };
    },
  });
  const definitions = mixedSceneDefinitions();
  await cache.ensure(definitions.map((object) => object.assetId));
  const live = createRuntimeSceneCollection();
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: createPi3aAuthority().generationId,
    definitions,
  });
  for (const descriptor of instantiated.objects) {
    const template = cache.template(descriptor.assetIdentity.id);
    assert.ok(template, descriptor.objectId);
    setLiveSceneObject(live, mountLiveRuntimeSceneObject({
      descriptor,
      imported: cloneFurnitureGlbScene(template),
      metricScale: 1,
    }));
  }
  assert.equal(live.size, 3);
  const sofaTemplate = cache.template(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  const chairTemplate = cache.template(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.ok(sofaTemplate && chairTemplate);
  const sofaA = live.get("so-pi5d-a1");
  const chair = live.get("so-pi5d-b");
  const sofaB = live.get("so-pi5d-a2");
  assert.ok(sofaA && chair && sofaB);
  assert.equal(firstMesh(sofaA.importPlacement).geometry, firstMesh(sofaTemplate).geometry);
  assert.equal(firstMesh(sofaB.importPlacement).geometry, firstMesh(sofaTemplate).geometry);
  assert.equal(firstMesh(chair.importPlacement).geometry, firstMesh(chairTemplate).geometry);
  assert.notEqual(firstMesh(chair.importPlacement).geometry, firstMesh(sofaTemplate).geometry);
  const serialized = serializeRuntimeScene(live);
  assert.deepEqual(
    serialized.objects.map((object) => object.assetId),
    [
      AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
      AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    ],
  );
  cache.dispose();
});

test("PI-5D1 failed Asset B load does not drop Asset A or rewrite persistence", async () => {
  const sofaScene = await parseFixture(SOFA_GLB_PATH);
  const cache = createFurnitureTemplateCache({
    load: async (url) => {
      if (url === AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH) {
        return { ok: false, message: "simulated chair load failure" };
      }
      return { ok: true, scene: sofaScene };
    },
  });
  const definitions = mixedSceneDefinitions();
  const outcomes = await cache.ensure(definitions.map((object) => object.assetId));
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.equal(outcomes.filter((outcome) => !outcome.ok).length, 1);
  assert.ok(cache.template(AFC_V2_RUNTIME_FURNITURE_ASSET_ID));
  assert.equal(cache.template(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID), null);

  const live = createRuntimeSceneCollection();
  const skipped = new Map<string, SceneObjectDefinition>();
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: createPi3aAuthority().generationId,
    definitions,
  });
  for (const descriptor of instantiated.objects) {
    const template = cache.template(descriptor.assetIdentity.id);
    if (!template) {
      const source = definitions.find((object) => object.objectId === descriptor.objectId);
      if (source) skipped.set(source.objectId, source);
      continue;
    }
    setLiveSceneObject(live, mountLiveRuntimeSceneObject({
      descriptor,
      imported: cloneFurnitureGlbScene(template),
      metricScale: 1,
    }));
  }
  assert.equal(live.size, 2);
  assert.equal(skipped.size, 1);
  assert.equal(skipped.get("so-pi5d-b")?.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  const merged = mergeMountedAndSkippedSceneObjects({
    order: definitions,
    mounted: serializeRuntimeScene(live).objects,
    skipped,
  });
  assert.equal(merged.length, 3);
  assert.equal(merged[1]?.objectId, "so-pi5d-b");
  assert.equal(merged[1]?.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(merged[1]?.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  cache.dispose();
});

test("PI-5D1 Summary stays Product/Variant based for mixed Sofa/Settee Scene Objects", () => {
  const sofa = resolveStagePlacement({
    productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  const settee = resolveStagePlacement({
    productId: STAGE_STUDIO_SETTEE_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  const chair = resolveStagePlacement({
    productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
    catalog: STAGE_SEED_CATALOG,
  });
  assert.ok(sofa && settee && chair);
  assert.equal(sofa.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(settee.assetId, PI5D2_SIDE_TABLE_ASSET_ID);
  assert.equal(chair.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(sofa.product.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(settee.product.productId, STAGE_STUDIO_SETTEE_PRODUCT_ID);
  assert.equal(chair.product.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(sofa.variant.variantId, STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.equal(chair.variant.variantId, STAGE_STUDIO_CHAIR_VARIANT_ID);

  const summary = buildStageSummary({
    catalog: STAGE_SEED_CATALOG,
    objects: mixedSceneDefinitions(),
  });
  assert.equal(summary.lines.length, 3);
  assert.equal(
    summary.lines.find((line) => line.productId === STAGE_STUDIO_SOFA_PRODUCT_ID)?.assetId,
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  );
  assert.equal(
    summary.lines.find((line) => line.productId === STAGE_STUDIO_SETTEE_PRODUCT_ID)?.assetId,
    AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  );
  assert.equal(
    summary.lines.find((line) => line.productId === STAGE_STUDIO_CHAIR_PRODUCT_ID)?.assetId,
    AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  );
  assert.equal(summary.estimatedTotal, 2495 + 1895 + 895);
});

test("PI-5D1 viewer resolves by assetId through the template cache and does not hardcode the sofa GLB", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const cache = source("lib/afc-v2-runtime/furniture-template-cache.ts");
  const assets = source("lib/afc-v2-runtime/furniture-assets.ts");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const session = source("components/afc-3d/AfcSceneObjectCrudSession.tsx");
  assert.match(viewer, /createFurnitureTemplateCache/);
  assert.match(viewer, /templateCache\.template\(definition\.assetId\)/);
  assert.match(viewer, /cloneFurnitureGlbScene\(template\)/);
  assert.match(viewer, /furnitureAssetDefinition/);
  assert.doesNotMatch(viewer, /loadFurnitureGlb\(pi4aFurnitureGlbPublicPath\(\)\)/);
  assert.doesNotMatch(viewer, /productId.*glbUrl|glbUrl.*productId/);
  assert.doesNotMatch(viewer, /from\("@\/lib\/supabase/);
  assert.doesNotMatch(viewer, /stage-catalog|vibode_stage_assets/);
  assert.match(cache, /Promise\.allSettled/);
  assert.match(cache, /Map<string, import\("three"\)\.Group>/);
  assert.doesNotMatch(cache, /lru|LRU|module\.exports cache|globalThis/);
  assert.match(assets, /PI5D_LOUNGE_CHAIR_FURNITURE_ASSET/);
  assert.match(crud, /furnitureAssetPlacementAabb\(assetId\)/);
  assert.match(session, /Promise\.resolve\(host\.addSceneObject/);
  assert.doesNotMatch(assets, /signed url|IMPROVED_ASSET/i);
});

test("PI-5D1 migration adds Asset B after PI-5C without rewriting Product IDs", () => {
  const sql = source(PI5D_MIGRATION);
  const frozen = source(PI5C_MIGRATION);
  assert.match(sql, /afc-v2-runtime\/test-fixtures\/pi5d-lounge-chair/);
  assert.match(sql, /\/afc-v2-runtime\/test-fixtures\/pi5d-lounge-chair\.glb/);
  assert.match(sql, /var-vibode-studio-chair-default/);
  assert.match(sql, /prod-vibode-studio-lounge-chair/);
  assert.doesNotMatch(sql, /prod-vibode-studio-sofa/);
  assert.doesNotMatch(sql, /alter table public.vibode_stage_assets/);
  assert.doesNotMatch(sql, /create table/);
  assert.match(frozen, /'afc-v2-runtime\/test-fixtures\/pi4a-sofa'/);
  assert.match(
    frozen,
    /'var-vibode-studio-chair-default'[\s\S]*'afc-v2-runtime\/test-fixtures\/pi4a-sofa'/,
  );
});
