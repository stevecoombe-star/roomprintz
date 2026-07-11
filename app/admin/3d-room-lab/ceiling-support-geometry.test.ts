import assert from "node:assert/strict";
import test from "node:test";
import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  buildCeilingPolygonKey,
  createCeilingConfirmationStamp,
  deriveCeilingSupport,
  isCeilingConfirmationCurrent,
  type CeilingPolygon,
  type CeilingRay,
} from "./ceiling-support-geometry";

const FRAME = { width: 1000, height: 800 };
const CAMERA = { x: 0, y: 1.5, z: 0 };
const POLYGON: CeilingPolygon = [
  { x: 0.3, y: 0.7 },
  { x: 0.7, y: 0.7 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.3 },
];

function rayTo(point: { x: number; y: number; z: number }): CeilingRay {
  return { origin: CAMERA, direction: { x: point.x - CAMERA.x, y: point.y - CAMERA.y, z: point.z - CAMERA.z } };
}

function input(overrides: Partial<Parameters<typeof deriveCeilingSupport>[0]> = {}) {
  return {
    polygonSourceNorm: POLYGON,
    polygonContainerNorm: POLYGON,
    frameSize: FRAME,
    cameraPosition: CAMERA,
    roomHeight: 2.5,
    rays: [
      rayTo({ x: -2, y: 2.5, z: -2 }),
      rayTo({ x: 2, y: 2.5, z: -2 }),
      rayTo({ x: 2, y: 2.5, z: 2 }),
      rayTo({ x: -2, y: 2.5, z: 2 }),
    ] as const,
    projectWorldToPixels: (point: { x: number; y: number; z: number }) => ({
      x: point.x * 100 + 500,
      y: point.z < 0 ? 560 : 240,
    }),
    floorBounds: { minX: -2.5, maxX: 2.5, minZ: -2.5, maxZ: 2.5 },
    ...overrides,
  };
}

function reasons(result: ReturnType<typeof deriveCeilingSupport>) {
  if (result.ok) throw new Error("expected refusal");
  return result.reasons;
}

function basis(): CalibrationImageBasis {
  return {
    basisId: "basis-1",
    basisFingerprint: "fingerprint-1",
    sourceImageUrl: "https://example.test/room.jpg",
    decodedWidth: 1600,
    decodedHeight: 900,
    encodedOrientation: 1,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: { decoderId: "sharp/v1", normalizationPolicyVersion: "orientation/v1", orientationApplied: false },
    basisKind: "original",
  };
}

test("derives finite world ceiling geometry using deterministic +X/+Z UV", () => {
  const result = deriveCeilingSupport(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plane.normal, { x: 0, y: -1, z: 0 });
  assert.deepEqual(result.plane.basisU, { x: 1, y: 0, z: 0 });
  assert.deepEqual(result.plane.basisV, { x: 0, y: 0, z: 1 });
  assert.ok(result.boundaryWorld.every((point) => point.y === 2.5));
  assert.equal(result.diagnostics.cameraClearance, 1);
  assert.equal(result.diagnostics.ceilingWidthU, 4);
  assert.equal(result.diagnostics.ceilingDepthV, 4);
});

test("refuses invalid height, below-camera height, and insufficient clearance", () => {
  assert.deepEqual(reasons(deriveCeilingSupport(input({ roomHeight: Number.NaN }))), ["ceiling_height_invalid"]);
  assert.deepEqual(reasons(deriveCeilingSupport(input({ roomHeight: 1.4 }))), ["ceiling_height_below_camera"]);
  assert.deepEqual(reasons(deriveCeilingSupport(input({ roomHeight: 1.55 }))), ["ceiling_camera_clearance_insufficient"]);
});

test("refuses invalid source geometry and finite ceiling derivation failures", () => {
  const bowTie: CeilingPolygon = [POLYGON[0], POLYGON[2], POLYGON[1], POLYGON[3]];
  assert.deepEqual(reasons(deriveCeilingSupport(input({ polygonSourceNorm: bowTie }))), ["ceiling_polygon_self_intersecting"]);
  const outside: CeilingPolygon = [{ x: -0.1, y: 0.7 }, POLYGON[1], POLYGON[2], POLYGON[3]];
  assert.deepEqual(reasons(deriveCeilingSupport(input({ polygonSourceNorm: outside }))), ["ceiling_polygon_out_of_range"]);
  const zero: CeilingPolygon = [
    { x: 0.3, y: 0.7 }, { x: 0.4, y: 0.7 }, { x: 0.5, y: 0.7 }, { x: 0.6, y: 0.7 },
  ];
  assert.deepEqual(reasons(deriveCeilingSupport(input({ polygonSourceNorm: zero }))), ["ceiling_polygon_zero_area"]);
  const parallel = [...input().rays] as CeilingRay[];
  parallel[0] = { origin: CAMERA, direction: { x: 1, y: 0, z: 0 } };
  assert.deepEqual(reasons(deriveCeilingSupport(input({ rays: parallel as never }))), ["ceiling_ray_parallel"]);
  const behind = [...input().rays] as CeilingRay[];
  behind[0] = { origin: CAMERA, direction: { x: 0, y: -1, z: 0 } };
  assert.deepEqual(reasons(deriveCeilingSupport(input({ rays: behind as never }))), ["ceiling_intersection_behind_camera"]);
});

test("refuses excessive dimensions, camera distance, and reprojection error", () => {
  const wide = [
    rayTo({ x: -30, y: 2.5, z: -2 }), rayTo({ x: 30, y: 2.5, z: -2 }),
    rayTo({ x: 30, y: 2.5, z: 2 }), rayTo({ x: -30, y: 2.5, z: 2 }),
  ] as const;
  assert.deepEqual(reasons(deriveCeilingSupport(input({ rays: wide }))), ["ceiling_width_excessive"]);
  const depth = [
    rayTo({ x: -2, y: 2.5, z: -30 }), rayTo({ x: 2, y: 2.5, z: -30 }),
    rayTo({ x: 2, y: 2.5, z: 30 }), rayTo({ x: -2, y: 2.5, z: 30 }),
  ] as const;
  assert.deepEqual(reasons(deriveCeilingSupport(input({ rays: depth }))), ["ceiling_depth_excessive"]);
  assert.deepEqual(reasons(deriveCeilingSupport(input({ projectWorldToPixels: () => ({ x: 0, y: 0 }) }))), ["ceiling_reprojection_error"]);
});

test("confirmation binds polygon, stable height, camera, basis, and frame exactly", () => {
  const stamp = createCeilingConfirmationStamp(POLYGON, 2.5, basis(), "2026-07-11T00:00:00.000Z", FRAME);
  const current = {
    stamp, polygon: POLYGON, roomHeight: 2.5, basis: basis(), cameraAppliedAtIso: "2026-07-11T00:00:00.000Z", frameSize: FRAME,
  };
  assert.equal(isCeilingConfirmationCurrent(current), true);
  assert.equal(buildCeilingPolygonKey(POLYGON), stamp.ceilingPolygonKey);
  assert.equal(isCeilingConfirmationCurrent({ ...current, roomHeight: 2.500001 }), false);
  assert.equal(isCeilingConfirmationCurrent({ ...current, polygon: [{ x: 0.31, y: 0.7 }, ...POLYGON.slice(1)] as CeilingPolygon }), false);
  assert.equal(isCeilingConfirmationCurrent({ ...current, cameraAppliedAtIso: "later" }), false);
  assert.equal(isCeilingConfirmationCurrent({ ...current, basis: { ...basis(), basisFingerprint: "other" } }), false);
  assert.equal(isCeilingConfirmationCurrent({ ...current, frameSize: { width: 999, height: 800 } }), false);
});
