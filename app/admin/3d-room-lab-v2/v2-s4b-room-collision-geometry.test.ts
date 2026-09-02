import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import type { RoomCollisionEnabledWall } from "./room-collision-authority-contract";
import {
  TEST_CUBE_PLACEMENT_LOCAL_AABB,
  aabbCorners,
  applyWorldTransformToPoint,
  footprintFromLocalAabb,
} from "./room-collision-footprint";
import {
  NUMERICAL_DISTANCE_EPSILON,
  clippedMinInteriorDistance,
  overlapPenetration,
  prepareCollisionWall,
  resolveSweptConvexTranslation,
} from "./room-collision-geometry";
import { DEFAULT_WORLD_TRANSFORM, type WorldTransform } from "./scene-layer-state";
import { applyWorldTransform } from "./scene-object-runtime";

function wall(input: Partial<RoomCollisionEnabledWall> & Pick<RoomCollisionEnabledWall, "id" | "a" | "b">): RoomCollisionEnabledWall {
  const dx = input.b.x - input.a.x;
  const dz = input.b.z - input.a.z;
  const length = Math.hypot(dx, dz) || 1;
  const tangentX = dx / length;
  const tangentZ = dz / length;
  const normal = input.supportPlaneNormal ?? { x: -tangentZ, y: 0, z: tangentX };
  const sideSign = input.sideSign ?? 1;
  const constant = input.supportPlaneConstant ??
    -(normal.x * input.a.x + normal.z * input.a.z);
  return {
    id: input.id,
    sourceBoundaryId: input.sourceBoundaryId ?? input.id,
    sourceSeamId: input.sourceSeamId ?? input.id,
    a: input.a,
    b: input.b,
    supportPlaneNormal: normal,
    supportPlaneConstant: constant,
    sideSign,
  };
}

function cubeFootprint(transform: WorldTransform = DEFAULT_WORLD_TRANSFORM) {
  return footprintFromLocalAabb(TEST_CUBE_PLACEMENT_LOCAL_AABB, transform);
}

function moveX(x: number): WorldTransform {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y: 0, z: 0 },
  };
}

const xWallAt1 = wall({
  id: "x-wall",
  a: { x: 1, z: -2 },
  b: { x: 1, z: 2 },
  supportPlaneNormal: { x: 1, y: 0, z: 0 },
  supportPlaneConstant: -1,
  sideSign: -1,
});

test("Test Cube stops at FACE, not center", () => {
  const start = cubeFootprint(moveX(0));
  const result = resolveSweptConvexTranslation({
    startVertices: start,
    translation: { x: 3, z: 0 },
    walls: [xWallAt1],
    allowSlide: true,
  });
  assert.ok(result.translation.x < 3);
  assert.ok(Math.abs(result.translation.x - 0.5) < 1e-6);
  const stopped = cubeFootprint(moveX(result.translation.x));
  const prepared = prepareCollisionWall(xWallAt1);
  assert.ok(prepared);
  const minD = clippedMinInteriorDistance(stopped, prepared);
  assert.ok(minD !== null);
  assert.ok(minD! >= -NUMERICAL_DISTANCE_EPSILON);
  assert.ok(minD! < 0.05);
});

test("conservative footprint comes from cached AABB corners", () => {
  const corners = aabbCorners(TEST_CUBE_PLACEMENT_LOCAL_AABB);
  assert.equal(corners.length, 8);
  const footprint = cubeFootprint();
  assert.ok(footprint.length >= 4);
  const xs = footprint.map((point) => point.x);
  assert.ok(Math.abs(Math.max(...xs) - 0.5) < 1e-9);
  assert.ok(Math.abs(Math.min(...xs) + 0.5) < 1e-9);
});

test("uniform scale updates footprint", () => {
  const scaled = cubeFootprint({
    ...DEFAULT_WORLD_TRANSFORM,
    uniformScale: 2,
  });
  const xs = scaled.map((point) => point.x);
  assert.ok(Math.abs(Math.max(...xs) - 1) < 1e-9);
});

test("yaw updates footprint", () => {
  const yawed = cubeFootprint({
    ...DEFAULT_WORLD_TRANSFORM,
    rotationDeg: { x: 0, y: 45, z: 0 },
  });
  const xs = yawed.map((point) => point.x);
  assert.ok(Math.max(...xs) > 0.65);
});

test("X/Z tilt projected hull remains conservative", () => {
  const tilted = cubeFootprint({
    ...DEFAULT_WORLD_TRANSFORM,
    rotationDeg: { x: 25, y: 0, z: 18 },
  });
  assert.ok(tilted.length >= 4);
  const xs = tilted.map((point) => point.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 1 - 1e-6);
});

test("TRS matches Three.js XYZ euler", () => {
  const transform: WorldTransform = {
    position: { x: 0.4, y: 0.2, z: -0.3 },
    rotationDeg: { x: 15, y: -40, z: 8 },
    uniformScale: 1.25,
  };
  const local = { x: 0.3, y: 0.1, z: -0.2 };
  const ours = applyWorldTransformToPoint(local, transform);
  const object = new THREE.Group();
  applyWorldTransform(object, transform);
  object.updateMatrixWorld(true);
  const three = new THREE.Vector3(local.x, local.y, local.z).applyMatrix4(object.matrixWorld);
  assert.ok(Math.abs(ours.x - three.x) < 1e-10);
  assert.ok(Math.abs(ours.y - three.y) < 1e-10);
  assert.ok(Math.abs(ours.z - three.z) < 1e-10);
});

test("collision applies only while tangent-overlapping the finite span", () => {
  const shortWall = wall({
    id: "short",
    a: { x: 1, z: -0.2 },
    b: { x: 1, z: 0.2 },
    supportPlaneNormal: { x: 1, y: 0, z: 0 },
    supportPlaneConstant: -1,
    sideSign: -1,
  });
  const overlapping = resolveSweptConvexTranslation({
    startVertices: cubeFootprint(moveX(0)),
    translation: { x: 3, z: 0 },
    walls: [shortWall],
    allowSlide: false,
  });
  assert.notEqual(overlapping.status, "accepted");
  const beside = resolveSweptConvexTranslation({
    startVertices: cubeFootprint({
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0, y: 0, z: 4 },
    }),
    translation: { x: 3, z: 0 },
    walls: [shortWall],
    allowSlide: false,
  });
  assert.equal(beside.status, "accepted");
  assert.equal(beside.translation.x, 3);
});

test("large object extent still contacts a finite endpoint", () => {
  const result = resolveSweptConvexTranslation({
    startVertices: cubeFootprint({
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0, y: 0, z: 2.2 },
    }),
    translation: { x: 3, z: 0 },
    walls: [xWallAt1],
    allowSlide: false,
  });
  assert.ok(result.translation.x < 3);
  assert.ok(result.translation.x > 0);
});

test("no hidden continuation past the finite endpoint", () => {
  const result = resolveSweptConvexTranslation({
    startVertices: cubeFootprint({
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0, y: 0, z: 3.5 },
    }),
    translation: { x: 3, z: 0 },
    walls: [xWallAt1],
    allowSlide: false,
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.translation.x, 3);
});

test("large teleporting drag cannot tunnel through a wall", () => {
  const result = resolveSweptConvexTranslation({
    startVertices: cubeFootprint(moveX(0)),
    translation: { x: 20, z: 0 },
    walls: [xWallAt1],
    allowSlide: false,
  });
  assert.ok(result.translation.x < 1);
  assert.ok(Math.abs(result.translation.x - 0.5) < 1e-6);
});

test("exact contact is allowed and arithmetic epsilon is stable", () => {
  const flush = cubeFootprint(moveX(0.5));
  const prepared = prepareCollisionWall(xWallAt1)!;
  const minD = clippedMinInteriorDistance(flush, prepared);
  assert.ok(minD !== null);
  assert.ok(Math.abs(minD!) <= 1e-9);
  const still = resolveSweptConvexTranslation({
    startVertices: flush,
    translation: { x: 0, z: 0.4 },
    walls: [xWallAt1],
    allowSlide: true,
  });
  assert.equal(still.status, "accepted");
});

test("inward motion stops the normal component and preserves tangent slide", () => {
  const result = resolveSweptConvexTranslation({
    startVertices: cubeFootprint(moveX(0)),
    translation: { x: 3, z: 1.2 },
    walls: [xWallAt1],
    allowSlide: true,
  });
  assert.ok(Math.abs(result.translation.x - 0.5) < 1e-6);
  assert.ok(result.translation.z > 1);
  assert.equal(result.status, "slid");
});

test("one-pass slide stops at a second wall without oscillating", () => {
  const second = wall({
    id: "z-wall",
    a: { x: -2, z: 1.5 },
    b: { x: 4, z: 1.5 },
    supportPlaneNormal: { x: 0, y: 0, z: 1 },
    supportPlaneConstant: -1.5,
    sideSign: -1,
  });
  const result = resolveSweptConvexTranslation({
    startVertices: cubeFootprint(moveX(0)),
    translation: { x: 3, z: 3 },
    walls: [xWallAt1, second],
    allowSlide: true,
  });
  assert.equal(result.status, "slid_then_stopped");
  assert.ok(result.contactWallIds.length >= 2);
  assert.ok(result.translation.x < 3);
  assert.ok(result.translation.z < 3);
});

test("natural corner does not synthesize connecting geometry", () => {
  const geometrySource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-geometry.ts"),
    "utf8",
  );
  assert.doesNotMatch(geometrySource, /joinGaps|closeRoom|hiddenContinuation|endpointCap/);
  assert.match(geometrySource, /one-sided/);
});

test("start overlapping does not pop out and refuses deeper motion", () => {
  const overlapping = cubeFootprint(moveX(1));
  const prepared = prepareCollisionWall(xWallAt1)!;
  assert.ok(overlapPenetration(overlapping, prepared) > 0);
  const deeper = resolveSweptConvexTranslation({
    startVertices: overlapping,
    translation: { x: 1, z: 0 },
    walls: [xWallAt1],
    allowSlide: true,
  });
  assert.equal(deeper.status, "start_overlapping");
  assert.equal(deeper.translation.x, 0);
  assert.equal(deeper.unresolvedOverlap, true);
  const escape = resolveSweptConvexTranslation({
    startVertices: overlapping,
    translation: { x: -1, z: 0 },
    walls: [xWallAt1],
    allowSlide: true,
  });
  assert.equal(escape.translation.x, -1);
});

test("malformed walls are skipped and not repaired", () => {
  const bad = {
    ...xWallAt1,
    a: { x: Number.NaN, z: 0 },
  };
  const result = resolveSweptConvexTranslation({
    startVertices: cubeFootprint(moveX(0)),
    translation: { x: 3, z: 0 },
    walls: [bad],
    allowSlide: true,
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.translation.x, 3);
  assert.equal(result.skippedInvalidWallCount, 1);
});

test("geometry kernel stays free of React, observation, and S4A qualification", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-geometry.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /react|THREE|empty-room-observation|room-boundary-qualification/);
  assert.doesNotMatch(source, /constructAfcV2RoomBoundaryAuthority/);
});
