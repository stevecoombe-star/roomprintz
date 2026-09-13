import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_USER_SIZE_DEFAULT,
  DEFAULT_WORLD_TRANSFORM,
} from "./types";
import {
  cloneSceneObjectDefinition,
  persistenceSafeSceneObjects,
  validatePersistedSceneObjects,
} from "./persisted-scene";
import { addSceneObject, duplicateSceneObject } from "./scene-crud";
import { createPi4bSceneObjectDefinitions } from "./furniture-runtime";

const PRODUCT_ID = "prod-vibode-studio-sofa";
const VARIANT_ID = "var-vibode-studio-sofa-default";

test("PI-5B certified objects still persist as objectId/assetId/transform", () => {
  for (const object of persistenceSafeSceneObjects(createPi4bSceneObjectDefinitions())) {
    assert.deepEqual(Object.keys(object).sort(), ["assetId", "objectId", "transform"]);
    assert.equal(object.transform.uniformScale, 1);
    assert.equal(object.productId, undefined);
    assert.equal(object.userSizeMultiplier, undefined);
  }
});

test("PI-5B product identity is optional and omitted at authored size", () => {
  const linked = cloneSceneObjectDefinition({
    objectId: "so-linked",
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    transform: DEFAULT_WORLD_TRANSFORM,
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    userSizeMultiplier: AFC_V2_USER_SIZE_DEFAULT,
  });
  assert.equal(linked.productId, PRODUCT_ID);
  assert.equal(linked.variantId, VARIANT_ID);
  assert.equal("userSizeMultiplier" in linked, false);
  assert.equal(linked.transform.uniformScale, 1);

  const validated = validatePersistedSceneObjects([linked]);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.objects[0]?.productId, PRODUCT_ID);
  assert.deepEqual(Object.keys(validated.objects[0] ?? {}).sort(), [
    "assetId",
    "objectId",
    "productId",
    "transform",
    "variantId",
  ]);
});

test("PI-5B user size multiplier persists without rewriting uniformScale", () => {
  const sized = cloneSceneObjectDefinition({
    objectId: "so-sized",
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    transform: DEFAULT_WORLD_TRANSFORM,
    productId: PRODUCT_ID,
    userSizeMultiplier: 1.25,
  });
  assert.equal(sized.userSizeMultiplier, 1.25);
  assert.equal(sized.transform.uniformScale, 1);
  const validated = validatePersistedSceneObjects([sized]);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.objects[0]?.userSizeMultiplier, 1.25);
  assert.equal(validated.objects[0]?.transform.uniformScale, 1);
});

test("PI-5B add and duplicate copy product identity", () => {
  const added = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    identity: { productId: PRODUCT_ID, variantId: VARIANT_ID, userSizeMultiplier: 1.1 },
    createObjectId: () => "so-identity-a",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.productId, PRODUCT_ID);
  assert.equal(added.object.variantId, VARIANT_ID);
  assert.equal(added.object.userSizeMultiplier, 1.1);
  assert.equal(added.object.transform.uniformScale, 1);

  const duplicated = duplicateSceneObject({
    objects: added.objects,
    objectId: added.object.objectId,
    createObjectId: () => "so-identity-b",
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.notEqual(duplicated.object.objectId, added.object.objectId);
  assert.equal(duplicated.object.productId, PRODUCT_ID);
  assert.equal(duplicated.object.variantId, VARIANT_ID);
  assert.equal(duplicated.object.userSizeMultiplier, 1.1);
  assert.equal(duplicated.object.assetId, added.object.assetId);
});

test("PI-5B validation still rejects non-portable runtime fields", () => {
  const result = validatePersistedSceneObjects([
    {
      objectId: "so-bad",
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: DEFAULT_WORLD_TRANSFORM,
      productId: PRODUCT_ID,
      placement: {},
    },
  ]);
  assert.equal(result.ok, false);
});

test("PI-5B invalid identity ids fail closed without dropping the scene object silently", () => {
  const result = validatePersistedSceneObjects([
    {
      objectId: "so-bad-id",
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: DEFAULT_WORLD_TRANSFORM,
      productId: "not a valid id",
    },
  ]);
  assert.equal(result.ok, false);
});
