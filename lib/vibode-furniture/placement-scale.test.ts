import assert from "node:assert/strict";
import test from "node:test";

import { registerModelAxisScaleLookup } from "@/lib/afc-v2-runtime/model-axis-scale";
import { createOneMetreCubeMesh } from "@/lib/afc-v2-runtime/object-runtime";
import {
  applyLiveUserSizeMultiplier,
  createRuntimeSceneCollection,
  mountLiveRuntimeSceneObject,
  serializeRuntimeScene,
  setLiveSceneObject,
} from "@/lib/afc-v2-runtime/scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  DEFAULT_WORLD_TRANSFORM,
  type RuntimeSceneObject,
} from "@/lib/afc-v2-runtime/types";
import { roundModelMetres } from "@/lib/vibode-stage/model-dimensions";

import { personalPlacementScale } from "./dimension-edit";

const MODEL_A = {
  authoredWidthM: 1.2,
  authoredHeightM: 0.408,
  authoredDepthM: 0.615,
};

const MODEL_B = {
  authoredWidthM: 0.5834554135799408,
  authoredHeightM: 0.45000000298023224,
  authoredDepthM: 0.3094782084226608,
  displayWidthM: 1.175,
  displayHeightM: 0.907,
  displayDepthM: 0.623,
  sizingMode: "uniform" as const,
};

function descriptor(input?: Partial<RuntimeSceneObject>): RuntimeSceneObject {
  return {
    roomId: "room-dimensions",
    generationId: "generation-dimensions",
    objectId: "so-dimensions",
    assetIdentity: { kind: "test_cube", id: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: DEFAULT_WORLD_TRANSFORM,
    ...input,
  };
}

function mountSaved(input: RuntimeSceneObject, scale: { x: number; y: number; z: number } | null) {
  const live = mountLiveRuntimeSceneObject({
    descriptor: input,
    imported: createOneMetreCubeMesh(),
    metricScale: 1,
    ...(scale ? { modelAxisScale: scale } : {}),
  });
  const scene = createRuntimeSceneCollection();
  setLiveSceneObject(scene, live);
  return { live, saved: serializeRuntimeScene(scene).objects[0]! };
}

test("an unedited model places at its authored size and records no scale", () => {
  assert.equal(personalPlacementScale(MODEL_A), null);
  const { live, saved } = mountSaved(descriptor(), null);
  assert.deepEqual(live.importPlacement.scale.toArray(), [1, 1, 1]);
  assert.equal(live.userSizeMultiplier, 1);
  assert.equal(saved.modelAxisScale, undefined);
  assert.equal(saved.userSizeMultiplier, undefined);
  assert.equal(saved.transform.uniformScale, 1);
});

test("the resized coffee table places at its saved dimensions exactly once", () => {
  const scale = personalPlacementScale(MODEL_B);
  assert.ok(scale);
  if (!scale) return;
  const native = {
    widthM: roundModelMetres(MODEL_B.authoredWidthM),
    heightM: roundModelMetres(MODEL_B.authoredHeightM),
    depthM: roundModelMetres(MODEL_B.authoredDepthM),
  };
  assert.ok(Math.abs(native.widthM * scale.x - MODEL_B.displayWidthM) < 1e-9);
  assert.ok(Math.abs(native.heightM * scale.y - MODEL_B.displayHeightM) < 1e-9);
  assert.ok(Math.abs(native.depthM * scale.z - MODEL_B.displayDepthM) < 1e-9);
  assert.ok(Math.abs(scale.x - scale.y) > 1e-6 || Math.abs(scale.y - scale.z) > 1e-6);

  const { live, saved } = mountSaved(descriptor(), scale);
  assert.deepEqual(live.importPlacement.scale.toArray(), [scale.x, scale.y, scale.z]);
  assert.equal(live.userSizeMultiplier, 1);
  assert.deepEqual(saved.modelAxisScale, scale);
  assert.equal(saved.userSizeMultiplier, undefined);

  const reloaded = mountLiveRuntimeSceneObject({
    descriptor: descriptor({ userSizeMultiplier: saved.userSizeMultiplier }),
    imported: createOneMetreCubeMesh(),
    metricScale: 1.7,
    modelAxisScale: saved.modelAxisScale,
  });
  assert.deepEqual(reloaded.importPlacement.scale.toArray(), [scale.x, scale.y, scale.z]);
  assert.equal(reloaded.userSizeMultiplier, 1);

  applyLiveUserSizeMultiplier(live, 1.25);
  const scene = createRuntimeSceneCollection();
  setLiveSceneObject(scene, live);
  const sized = serializeRuntimeScene(scene).objects[0]!;
  assert.equal(sized.userSizeMultiplier, 1.25);
  assert.deepEqual(sized.modelAxisScale, scale);
  const withSize = mountLiveRuntimeSceneObject({
    descriptor: descriptor({ userSizeMultiplier: sized.userSizeMultiplier }),
    imported: createOneMetreCubeMesh(),
    metricScale: 1,
    modelAxisScale: sized.modelAxisScale,
  });
  assert.ok(Math.abs(withSize.importPlacement.scale.x - scale.x * 1.25) < 1e-9);
  assert.ok(Math.abs(withSize.importPlacement.scale.y - scale.y * 1.25) < 1e-9);
  assert.ok(Math.abs(withSize.importPlacement.scale.z - scale.z * 1.25) < 1e-9);
});

test("uniform scaling uses one factor and exact scaling keeps an edited height", () => {
  const uniform = personalPlacementScale({
    ...MODEL_A,
    displayWidthM: 2.4,
    displayHeightM: 0.816,
    displayDepthM: 1.23,
    sizingMode: "uniform",
  });
  assert.ok(uniform);
  if (!uniform) return;
  assert.equal(uniform.x, uniform.y);
  assert.equal(uniform.y, uniform.z);

  const exact = personalPlacementScale({
    ...MODEL_A,
    displayWidthM: MODEL_A.authoredWidthM,
    displayHeightM: 0.907,
    displayDepthM: MODEL_A.authoredDepthM,
    sizingMode: "exact",
  });
  assert.ok(exact);
  if (!exact) return;
  assert.equal(exact.x, 1);
  assert.ok(Math.abs(0.408 * exact.y - 0.907) < 1e-9);
  assert.equal(exact.z, 1);
  const { saved } = mountSaved(descriptor({ objectId: "so-exact" }), exact);
  assert.deepEqual(saved.modelAxisScale, { x: exact.x, y: exact.y, z: exact.z });
});

test("a catalog lookup scales the view without becoming the saved placement", () => {
  const unregister = registerModelAxisScaleLookup(() => ({ x: 2, y: 2, z: 2 }));
  try {
    const { live, saved } = mountSaved(descriptor({
      assetIdentity: { kind: "test_furniture_glb", id: "partner-sofa" },
      variantId: "variant-sofa",
    }), null);
    assert.deepEqual(live.importPlacement.scale.toArray(), [2, 2, 2]);
    assert.equal(saved.modelAxisScale, undefined);
    assert.equal(saved.variantId, "variant-sofa");
  } finally {
    unregister();
  }
});
