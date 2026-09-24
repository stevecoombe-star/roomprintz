import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { addSceneObject } from "./scene-crud";
import {
  interpretVersionSceneLoadResponse,
  resolveProductionFurnitureSnapshot,
  EMPTY_PRODUCTION_FURNITURE_OBJECTS,
} from "./scene-persistence-client";
import {
  completeSceneVisitLoad,
  createUnloadedSceneVisit,
  toPersistedVersionScene,
  type PersistedSceneIdentity,
} from "./persisted-scene";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  AFC_V2_RUNTIME_PI4B_SOFA_A_OBJECT_ID,
  AFC_V2_RUNTIME_PI4B_SOFA_B_OBJECT_ID,
  DEFAULT_WORLD_TRANSFORM,
  type SceneObjectDefinition,
} from "./types";
import {
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_CHAIR_VARIANT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_STUDIO_SOFA_VARIANT_ID,
  stageProductById,
  stageVariantById,
} from "@/lib/vibode-stage/catalog";
import { buildStageSummary } from "@/lib/vibode-stage/summary";

const ROOT = process.cwd();

const IDENTITY: PersistedSceneIdentity = {
  roomId: "room-new-upload",
  versionId: "version-new-upload",
  afcGenerationId: "generation-afc-ready",
};

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function load(payload: unknown, ok = true) {
  return interpretVersionSceneLoadResponse({ ok, payload });
}

function resolutionFor(payload: unknown, ok = true, identity = IDENTITY) {
  return resolveProductionFurnitureSnapshot({
    interpreted: load(payload, ok),
    requestIdentity: identity,
  });
}

function snapshotFor(payload: unknown, ok = true, identity = IDENTITY) {
  const resolution = resolutionFor(payload, ok, identity);
  assert.equal(resolution.status, "authoritative");
  if (resolution.status !== "authoritative") {
    throw new Error("expected an authoritative furniture snapshot");
  }
  return resolution.snapshot;
}

function readyPayload(
  objects: readonly SceneObjectDefinition[],
  identity: PersistedSceneIdentity = IDENTITY,
  origin?: "persisted" | "inherited",
) {
  return {
    status: "ready",
    origin,
    currentAfcGenerationId: identity.afcGenerationId,
    scene: toPersistedVersionScene(identity, { objects }),
  };
}

test("new uploaded room with no scene row initializes an empty furniture scene", () => {
  const missing = snapshotFor({
    status: "none",
    scene: null,
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });
  const again = snapshotFor({
    status: "none",
    scene: null,
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });

  assert.equal(missing.origin, "default");
  assert.equal(missing.objects.length, 0);
  assert.equal(missing.objects, EMPTY_PRODUCTION_FURNITURE_OBJECTS);
  assert.equal(again.objects, missing.objects);

  const visit = completeSceneVisitLoad(
    createUnloadedSceneVisit(),
    IDENTITY,
    missing.objects,
    missing.origin,
  );
  assert.equal(visit.sceneReady, true);
  assert.equal(visit.loading, false);
  assert.equal(visit.objects.length, 0);

  const summary = buildStageSummary({ objects: visit.objects });
  assert.equal(summary.itemCount, 0);
  assert.equal(summary.lines.length, 0);
  assert.equal(
    summary.lines.some((line) => line.productId === STAGE_STUDIO_SOFA_PRODUCT_ID),
    false,
  );
  assert.equal(
    visit.objects.some((object) => object.variantId === STAGE_STUDIO_SOFA_VARIANT_ID),
    false,
  );
  assert.equal(
    visit.objects.some((object) => object.assetId === AFC_V2_RUNTIME_FURNITURE_ASSET_ID),
    false,
  );
  assert.equal(
    visit.objects.some((object) => (
      object.objectId === AFC_V2_RUNTIME_PI4B_SOFA_A_OBJECT_ID ||
      object.objectId === AFC_V2_RUNTIME_PI4B_SOFA_B_OBJECT_ID
    )),
    false,
  );

  const sofa = stageProductById(STAGE_STUDIO_SOFA_PRODUCT_ID);
  const warmOak = stageVariantById(STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.equal(sofa?.name, "Studio Sofa");
  assert.equal(warmOak?.finishLabel, "Warm oak");
  assert.equal(warmOak?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
});

test("generation mismatch initializes an empty scene for this generation", () => {
  const incompatible = snapshotFor({
    status: "incompatible",
    scene: null,
    reason: "Stored 3D scene belongs to a different AFC generation.",
    storedAfcGenerationId: "generation-other",
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });
  assert.equal(incompatible.origin, "default");
  assert.equal(incompatible.objects, EMPTY_PRODUCTION_FURNITURE_OBJECTS);

  const otherGeneration = snapshotFor({
    status: "ready",
    currentAfcGenerationId: IDENTITY.afcGenerationId,
    scene: toPersistedVersionScene(
      { ...IDENTITY, afcGenerationId: "generation-other" },
      {
        objects: [{
          objectId: "so-other-generation",
          assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
          productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
          variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
          transform: DEFAULT_WORLD_TRANSFORM,
        }],
      },
    ),
  });
  assert.equal(otherGeneration.origin, "default");
  assert.equal(otherGeneration.objects, EMPTY_PRODUCTION_FURNITURE_OBJECTS);
  assert.equal(
    otherGeneration.objects.some((object) => object.objectId === "so-other-generation"),
    false,
  );
});

test("persisted and inherited furniture restores with the same product identity", () => {
  const persisted: SceneObjectDefinition[] = [
    {
      objectId: "so-kept-sofa",
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
      transform: DEFAULT_WORLD_TRANSFORM,
    },
    {
      objectId: "so-kept-chair",
      assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
      productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
      variantId: STAGE_STUDIO_CHAIR_VARIANT_ID,
      transform: {
        ...DEFAULT_WORLD_TRANSFORM,
        position: { x: 1.1, y: 0, z: -0.4 },
      },
    },
  ];

  const restored = snapshotFor(readyPayload(persisted));
  assert.equal(restored.origin, "persisted");
  assert.equal(restored.objects.length, 2);
  assert.equal(restored.objects[0]?.objectId, "so-kept-sofa");
  assert.equal(restored.objects[0]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(restored.objects[0]?.variantId, STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.equal(restored.objects[1]?.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(restored.objects[1]?.variantId, STAGE_STUDIO_CHAIR_VARIANT_ID);
  assert.equal(restored.objects[1]?.transform.position.x, 1.1);

  const inherited = snapshotFor(readyPayload(persisted, IDENTITY, "inherited"));
  assert.equal(inherited.origin, "persisted");
  assert.deepEqual(
    inherited.objects.map((object) => object.objectId),
    ["so-kept-sofa", "so-kept-chair"],
  );

  const emptied = snapshotFor(readyPayload([]));
  assert.equal(emptied.origin, "persisted");
  assert.deepEqual(emptied.objects, []);
  const emptiedVisit = completeSceneVisitLoad(
    createUnloadedSceneVisit(),
    IDENTITY,
    emptied.objects,
    emptied.origin,
  );
  assert.equal(emptiedVisit.sceneReady, true);
  assert.equal(emptiedVisit.objects.length, 0);
});

test("one explicit catalog add from an empty new scene creates one object", () => {
  const opened = snapshotFor({
    status: "none",
    scene: null,
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });
  assert.equal(opened.objects.length, 0);

  let sequence = 0;
  const first = addSceneObject({
    objects: opened.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: {
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    },
    createObjectId: () => `so-explicit-${++sequence}`,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.objects.length, 1);
  assert.equal(first.object.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(first.object.variantId, STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.equal(first.object.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(
    first.objects.some((object) => object.objectId === AFC_V2_RUNTIME_PI4B_SOFA_B_OBJECT_ID),
    false,
  );

  const second = addSceneObject({
    objects: first.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: {
      productId: STAGE_STUDIO_SOFA_PRODUCT_ID,
      variantId: STAGE_STUDIO_SOFA_VARIANT_ID,
    },
    createObjectId: () => `so-explicit-${++sequence}`,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.objects.length, 2);
  assert.notEqual(second.objects[0]?.objectId, second.objects[1]?.objectId);
  assert.equal(second.objects[0]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(second.objects[1]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);

  const summary = buildStageSummary({ objects: second.objects });
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.lines.length, 1);
  assert.equal(summary.lines[0]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);
  assert.equal(summary.lines[0]?.variantId, STAGE_STUDIO_SOFA_VARIANT_ID);
  assert.equal(summary.lines[0]?.quantity, 2);
});

test("error and malformed loads stay unresolved and do not authorize a scene write", () => {
  const failed = resolutionFor({ error: "Failed to load 3D scene." }, false);
  const malformed = resolutionFor({
    status: "malformed",
    scene: null,
    reason: "Stored 3D scene is malformed.",
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });
  const invalidReady = resolutionFor({
    status: "ready",
    scene: { objects: "not-an-array" },
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });
  for (const resolution of [failed, malformed, invalidReady]) {
    assert.equal(resolution.status, "unavailable");
  }

  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  const unavailable = hook.match(
    /if \(resolution\.status !== "authoritative"\) \{[\s\S]*?return;/,
  );
  assert.ok(unavailable);
  assert.match(unavailable[0], /setLoading\(false\)/);
  assert.doesNotMatch(unavailable[0], /commitResolvedSnapshot|persistIdentity/);
  const caught = hook.match(/catch \(error\) \{[\s\S]*?\n    \}/);
  assert.ok(caught);
  assert.match(caught[0], /setLoading\(false\)/);
  assert.doesNotMatch(caught[0], /commitResolvedSnapshot|persistIdentity/);
  assert.match(
    hook,
    /if \(!current \|\| !loaded \|\| !sceneIdentitiesEqual\(loaded\.identity, current\)\) \{\s*return;\s*\}/,
  );
});

test("production scene load does not bootstrap PI-4B sofas or treat empty as uninitialized", () => {
  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  const client = source("lib/afc-v2-runtime/scene-persistence-client.ts");
  assert.match(hook, /resolveProductionFurnitureSnapshot/);
  assert.match(hook, /resolution\.status !== "authoritative"/);
  assert.match(hook, /objects: sceneReady \? objects : EMPTY_PERSISTED_SCENE_OBJECTS/);
  assert.doesNotMatch(hook, /createPi4bSceneObjectDefinitions/);
  assert.doesNotMatch(hook, /EMPTY_PRODUCTION_FURNITURE_OBJECTS/);
  assert.doesNotMatch(hook, /objects\.length\s*===\s*0/);
  assert.doesNotMatch(hook, /nextObjects\.length/);
  assert.match(client, /objects: parsed\.scene\.objects/);
  assert.match(client, /EMPTY_PRODUCTION_FURNITURE_OBJECTS/);
  assert.match(client, /status: "unavailable"/);
  assert.doesNotMatch(client, /createPi4bSceneObjectDefinitions/);
});
