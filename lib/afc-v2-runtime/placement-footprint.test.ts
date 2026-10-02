import assert from "node:assert/strict";
import test from "node:test";

import { footprintFromLocalAabb } from "./collision-footprint";
import {
  authoredPlacementLocalAabb,
  furnitureAssetPlacementAabb,
} from "./furniture-runtime";
import { beginPlacementFootprint } from "./model-axis-scale";
import { createOneMetreCubeMesh, localAabbDimensions } from "./object-runtime";
import { addSceneObject } from "./scene-crud";
import { mountLiveRuntimeSceneObject } from "./scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  DEFAULT_WORLD_TRANSFORM,
  type FurnitureAssetDefinition,
  type LocalAabb,
  type RuntimeCollisionWall,
  type RuntimeSceneObject,
} from "./types";
import { deriveModelAxisScale } from "@/lib/vibode-stage/model-dimensions";

const ASSET_ID = "asset-ux13a";
const NATIVE = { widthM: 0.6, heightM: 0.8, depthM: 0.7 };
const ENLARGED = { widthM: 1.2, heightM: 1.6, depthM: 1.4 };
const REDUCED = { widthM: 0.4, heightM: 0.8, depthM: 0.7 };
const EXACT = { widthM: 0.9, heightM: 0.82, depthM: 0.75 };

function asset(): FurnitureAssetDefinition {
  return {
    assetId: ASSET_ID,
    glbUrl: "/ux13a.glb",
    authoredWidthM: NATIVE.widthM,
    authoredHeightM: NATIVE.heightM,
    authoredDepthM: NATIVE.depthM,
  };
}

function resolver(assetId: string): FurnitureAssetDefinition | null {
  return assetId === ASSET_ID ? asset() : null;
}

function scaleFor(effective: { widthM: number; heightM: number; depthM: number }) {
  const derived = deriveModelAxisScale({ native: NATIVE, effective });
  assert.equal(derived.ok, true);
  if (!derived.ok) throw new Error("scale failed");
  return derived.scale;
}

function withFootprint<T>(
  effective: { widthM: number; heightM: number; depthM: number } | null,
  run: () => T,
): T {
  const end = effective
    ? beginPlacementFootprint({ assetId: ASSET_ID, scale: scaleFor(effective) })
    : null;
  try {
    return run();
  } finally {
    end?.();
  }
}

function extents(aabb: LocalAabb) {
  const footprint = footprintFromLocalAabb(aabb, DEFAULT_WORLD_TRANSFORM);
  const xs = footprint.map((point) => point.x);
  const zs = footprint.map((point) => point.z);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...zs) - Math.min(...zs),
  };
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);
}

function wallAtX(x: number): RuntimeCollisionWall {
  return {
    id: "ux13a-right",
    sourceBoundaryId: "ux13a-right",
    sourceSeamId: "ux13a-right",
    a: { x, z: -2 },
    b: { x, z: 2 },
    supportPlaneNormal: { x: 1, y: 0, z: 0 },
    supportPlaneConstant: -x,
    sideSign: -1,
  };
}

function placedX(effective: { widthM: number; heightM: number; depthM: number } | null, wallX: number) {
  return withFootprint(effective, () => {
    const placed = addSceneObject({
      objects: [],
      assetId: ASSET_ID,
      resolver,
      placement: { metricScale: 1, realizedWalls: [wallAtX(wallX)] },
    });
    assert.equal(placed.ok, true);
    if (!placed.ok) throw new Error("placement failed");
    assert.equal(placed.object.transform.rotationDeg.x, 0);
    assert.equal(placed.object.transform.rotationDeg.y, 0);
    assert.equal(placed.object.transform.rotationDeg.z, 0);
    assert.equal(placed.object.transform.uniformScale, 1);
    return placed.object.transform.position.x;
  });
}

test("a legacy variant searches with the native asset footprint", () => {
  const native = authoredPlacementLocalAabb(asset());
  const searched = furnitureAssetPlacementAabb(ASSET_ID, resolver);
  assert.deepEqual(searched, native);
  const size = localAabbDimensions(searched!);
  close(size.width, NATIVE.widthM);
  close(size.height, NATIVE.heightM);
  close(size.depth, NATIVE.depthM);
  assert.equal(placedX(null, 0.4), 0);
});

test("an enlarged variant searches with the enlarged footprint before mount", () => {
  const searched = withFootprint(ENLARGED, () => furnitureAssetPlacementAabb(ASSET_ID, resolver));
  const size = localAabbDimensions(searched!);
  close(size.width, ENLARGED.widthM);
  close(size.height, ENLARGED.heightM);
  close(size.depth, ENLARGED.depthM);
  assert.equal(placedX(null, 0.4), 0);
  assert.equal(placedX(ENLARGED, 0.4), -0.4);
});

test("a reduced variant searches with the reduced footprint before mount", () => {
  const searched = withFootprint(REDUCED, () => furnitureAssetPlacementAabb(ASSET_ID, resolver));
  close(localAabbDimensions(searched!).width, REDUCED.widthM);
  assert.notEqual(placedX(null, 0.25), 0);
  assert.equal(placedX(REDUCED, 0.25), 0);
});

test("exact correction uses corrected width and depth at the default rotation", () => {
  const searched = withFootprint(EXACT, () => furnitureAssetPlacementAabb(ASSET_ID, resolver));
  const size = localAabbDimensions(searched!);
  close(size.width, EXACT.widthM);
  close(size.height, EXACT.heightM);
  close(size.depth, EXACT.depthM);
  const footprint = extents(searched!);
  close(footprint.width, EXACT.widthM);
  close(footprint.depth, EXACT.depthM);
});

test("the mounted model and the initial search use the same physical size once", () => {
  const metre = {
    assetId: "asset-ux13a-metre",
    glbUrl: "/metre.glb",
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
  };
  const effective = { widthM: 1.5, heightM: 1.025, depthM: 0.75 };
  const scale = deriveModelAxisScale({
    native: { widthM: 1, heightM: 1, depthM: 1 },
    effective,
  });
  assert.equal(scale.ok, true);
  if (!scale.ok) return;
  const end = beginPlacementFootprint({ assetId: metre.assetId, scale: scale.scale });
  const searched = furnitureAssetPlacementAabb(metre.assetId, (assetId) => (
    assetId === metre.assetId ? metre : null
  ));
  end();
  const descriptor: RuntimeSceneObject = {
    roomId: "room-ux13a",
    generationId: "generation-ux13a",
    objectId: "object-ux13a",
    assetIdentity: { kind: "test_cube", id: metre.assetId },
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: DEFAULT_WORLD_TRANSFORM,
  };
  const live = mountLiveRuntimeSceneObject({
    descriptor,
    imported: createOneMetreCubeMesh(),
    metricScale: 1,
    modelAxisScale: scale.scale,
  });
  const searchedSize = localAabbDimensions(searched!);
  const mountedSize = localAabbDimensions(live.localAabb!);
  close(searchedSize.width, mountedSize.width);
  close(searchedSize.height, mountedSize.height);
  close(searchedSize.depth, mountedSize.depth);
  close(mountedSize.width, effective.widthM);
  assert.deepEqual(live.importPlacement.scale.toArray(), [scale.scale.x, scale.scale.y, scale.scale.z]);
  assert.ok(Math.abs(live.importPlacement.scale.x - scale.scale.x * scale.scale.x) > 1e-6);
});
