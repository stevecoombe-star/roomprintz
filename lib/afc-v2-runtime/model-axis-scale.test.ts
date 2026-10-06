import assert from "node:assert/strict";
import test from "node:test";

import { TEST_CUBE_PLACEMENT_LOCAL_AABB, footprintFromLocalAabb } from "./collision-footprint";
import { registerModelAxisScaleLookup } from "./model-axis-scale";
import { createOneMetreCubeMesh, localAabbDimensions } from "./object-runtime";
import { applyLiveUserSizeMultiplier, mountLiveRuntimeSceneObject } from "./scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  DEFAULT_WORLD_TRANSFORM,
  type RuntimeSceneObject,
} from "./types";

function descriptor(variantId?: string): RuntimeSceneObject {
  return {
    roomId: "room-ux13",
    generationId: "generation-ux13",
    objectId: "object-ux13",
    assetIdentity: { kind: "test_cube", id: "asset-ux13" },
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: DEFAULT_WORLD_TRANSFORM,
    variantId,
  };
}

function extent(points: readonly { x: number; z: number }[], axis: "x" | "z"): number {
  const values = points.map((point) => point[axis]);
  return Math.max(...values) - Math.min(...values);
}

test("an uncorrected model mounts at native size exactly once", () => {
  const live = mountLiveRuntimeSceneObject({
    descriptor: descriptor(),
    imported: createOneMetreCubeMesh(),
    metricScale: 1,
  });
  assert.deepEqual(live.importPlacement.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(live.localAabb?.min, TEST_CUBE_PLACEMENT_LOCAL_AABB.min);
  assert.deepEqual(live.localAabb?.max, TEST_CUBE_PLACEMENT_LOCAL_AABB.max);
  const size = localAabbDimensions(live.localAabb!);
  assert.ok(Math.abs(size.width - 1) < 1e-6);
  const footprint = footprintFromLocalAabb(live.localAabb!, DEFAULT_WORLD_TRANSFORM);
  assert.ok(Math.abs(extent(footprint, "x") - 1) < 1e-6);
  assert.ok(Math.abs(extent(footprint, "z") - 1) < 1e-6);
});

test("derived axis scale changes the rendered model and collision footprint once", () => {
  const live = mountLiveRuntimeSceneObject({
    descriptor: descriptor(),
    imported: createOneMetreCubeMesh(),
    metricScale: 1,
    modelAxisScale: { x: 2, y: 1, z: 1.5 },
  });
  assert.deepEqual(live.importPlacement.scale.toArray(), [2, 1, 1.5]);
  const size = localAabbDimensions(live.localAabb!);
  assert.ok(Math.abs(size.width - 2) < 1e-6);
  assert.ok(Math.abs(size.height - 1) < 1e-6);
  assert.ok(Math.abs(size.depth - 1.5) < 1e-6);
  const footprint = footprintFromLocalAabb(live.localAabb!, live.realizedTransform);
  assert.ok(Math.abs(extent(footprint, "x") - 2) < 1e-6);
  assert.ok(Math.abs(extent(footprint, "z") - 1.5) < 1e-6);

  applyLiveUserSizeMultiplier(live, 2);
  assert.deepEqual(live.importPlacement.scale.toArray(), [4, 2, 3]);
  applyLiveUserSizeMultiplier(live, 2);
  assert.deepEqual(live.importPlacement.scale.toArray(), [4, 2, 3]);
});

test("a registered variant lookup scales the matching asset and leaves others native", () => {
  const unregister = registerModelAxisScaleLookup(({ assetId, variantId }) => {
    if (assetId === "asset-ux13" && variantId === "variant-ux13") return { x: 2, y: 2, z: 2 };
    return { x: 1, y: 1, z: 1 };
  });
  try {
    const scaled = mountLiveRuntimeSceneObject({
      descriptor: descriptor("variant-ux13"),
      imported: createOneMetreCubeMesh(),
      metricScale: 1,
    });
    assert.deepEqual(scaled.importPlacement.scale.toArray(), [2, 2, 2]);
    const untouched = mountLiveRuntimeSceneObject({
      descriptor: descriptor("variant-other"),
      imported: createOneMetreCubeMesh(),
      metricScale: 1,
    });
    assert.deepEqual(untouched.importPlacement.scale.toArray(), [1, 1, 1]);
  } finally {
    unregister();
  }
});
