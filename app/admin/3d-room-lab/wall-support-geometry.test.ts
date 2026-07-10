import assert from "node:assert/strict";
import test from "node:test";
import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  buildWallPolygonKey,
  createWallConfirmationStamp,
  deriveWallSupport,
  isWallConfirmationCurrent,
  type WallRay,
  type WallPolygon,
} from "./wall-support-geometry";

const FRAME = { width: 1000, height: 800 };
const CAMERA = { x: 0, y: 1.5, z: 3 };
const POLYGON: WallPolygon = [
  { x: 0.3, y: 0.6 },
  { x: 0.7, y: 0.6 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.3 },
];

function rayTo(point: { x: number; y: number; z: number }) {
  return {
    origin: CAMERA,
    direction: { x: point.x - CAMERA.x, y: point.y - CAMERA.y, z: point.z - CAMERA.z },
  };
}

function makeInput(overrides: Partial<Parameters<typeof deriveWallSupport>[0]> = {}) {
  return {
    kind: "wall_back" as const,
    polygonSourceNorm: POLYGON,
    polygonContainerNorm: POLYGON,
    frameSize: FRAME,
    mapImagePixelToFloor: (point: { x: number; y: number }) => ({ x: (point.x - 500) / 100, y: 0 }),
    cameraPosition: CAMERA,
    rays: [
      rayTo({ x: -2, y: 0, z: 0 }),
      rayTo({ x: 2, y: 0, z: 0 }),
      rayTo({ x: 2, y: 2, z: 0 }),
      rayTo({ x: -2, y: 2, z: 0 }),
    ] as const,
    projectWorldToPixels: (point: { x: number; y: number; z: number }) => ({
      x: point.x * 100 + 500,
      y: point.y === 0 ? 480 : 240,
    }),
    floorBounds: { minX: -2.5, maxX: 2.5, minZ: -2, maxZ: 2 },
    ...overrides,
  };
}

function makeBasis(): CalibrationImageBasis {
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
    coordinateSpaceVersion: {
      decoderId: "sharp-metadata/v1",
      normalizationPolicyVersion: "orientation-normal/v1",
      orientationApplied: false,
    },
    basisKind: "original",
  };
}

function refusalReasons(result: ReturnType<typeof deriveWallSupport>) {
  if (result.ok) throw new Error("expected wall derivation refusal");
  return result.reasons;
}

type WallRays = [WallRay | null, WallRay | null, WallRay | null, WallRay | null];

test("derives a bounded back-wall plane and seam-up local boundary", () => {
  const result = deriveWallSupport(makeInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.diagnostics.mappedSeamWorldLength, 4);
  assert.equal(result.diagnostics.wallWidth, 4);
  assert.equal(result.diagnostics.wallHeight, 2);
  assert.equal(result.boundaryUV[2].y > result.boundaryUV[0].y, true);
  assert.deepEqual(result.plane.normal, { x: 0, y: 0, z: 1 });
  assert.equal(result.plane.basisU.x, 1);
  assert.equal(result.plane.basisV.y, 1);
});

test("uses one deterministic seam-up local convention for back, left, and right wall kinds", () => {
  for (const kind of ["wall_back", "wall_left", "wall_right"] as const) {
    const result = deriveWallSupport(makeInput({ kind }));
    assert.equal(result.ok, true, `${kind} should derive`);
    if (!result.ok) continue;
    const crossUV = {
      x: result.plane.basisU.y * result.plane.basisV.z - result.plane.basisU.z * result.plane.basisV.y,
      y: result.plane.basisU.z * result.plane.basisV.x - result.plane.basisU.x * result.plane.basisV.z,
      z: result.plane.basisU.x * result.plane.basisV.y - result.plane.basisU.y * result.plane.basisV.x,
    };
    assert.deepEqual(crossUV, { x: 0, y: 0, z: 1 });
    assert.equal(result.plane.basisU.x * result.plane.normal.x + result.plane.basisU.z * result.plane.normal.z, 0);
    assert.equal(result.plane.basisV.y, 1);
  }
});

test("keeps local U/V tied to reviewed seam when the camera is on the opposite side", () => {
  const oppositeCamera = { x: 0, y: 1.5, z: -3 };
  const result = deriveWallSupport(
    makeInput({
      cameraPosition: oppositeCamera,
      rays: [
        { origin: oppositeCamera, direction: { x: -2, y: -1.5, z: 3 } },
        { origin: oppositeCamera, direction: { x: 2, y: -1.5, z: 3 } },
        { origin: oppositeCamera, direction: { x: 2, y: 0.5, z: 3 } },
        { origin: oppositeCamera, direction: { x: -2, y: 0.5, z: 3 } },
      ],
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plane.normal, { x: 0, y: 0, z: -1 });
  assert.deepEqual(result.plane.basisU, { x: 1, y: 0, z: 0 });
  assert.deepEqual(result.plane.basisV, { x: 0, y: 1, z: 0 });
});

test("validates source polygon finiteness, bounds, shape, and image seam", () => {
  const nonFinite: WallPolygon = [{ ...POLYGON[0] }, { ...POLYGON[1] }, { ...POLYGON[2] }, { ...POLYGON[3] }];
  nonFinite[0] = { x: Number.NaN, y: 0.6 };
  assert.deepEqual(deriveWallSupport(makeInput({ polygonSourceNorm: nonFinite })), {
    ok: false,
    reasons: ["wall_polygon_invalid"],
    diagnostics: undefined,
  });
  const outOfRange: WallPolygon = [{ ...POLYGON[0] }, { ...POLYGON[1] }, { ...POLYGON[2] }, { ...POLYGON[3] }];
  outOfRange[0] = { x: 1.2, y: 0.6 };
  assert.equal(deriveWallSupport(makeInput({ polygonSourceNorm: outOfRange })).ok, false);
  const bowTie: WallPolygon = [POLYGON[0], POLYGON[2], POLYGON[1], POLYGON[3]];
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ polygonSourceNorm: bowTie }))), ["wall_polygon_self_intersecting"]);
  const zeroArea: WallPolygon = [
    { x: 0.3, y: 0.6 },
    { x: 0.5, y: 0.6 },
    { x: 0.7, y: 0.6 },
    { x: 0.4, y: 0.6 },
  ];
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ polygonSourceNorm: zeroArea }))), ["wall_polygon_zero_area"]);
  const short: WallPolygon = [
    { x: 0.5, y: 0.6 },
    { x: 0.506, y: 0.6 },
    { x: 0.506, y: 0.3 },
    { x: 0.5, y: 0.3 },
  ];
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ polygonSourceNorm: short, polygonContainerNorm: short }))), [
    "wall_seam_too_short_image",
  ]);
});

test("refuses seam mapping, ray, height, width, distance, and reprojection failures", () => {
  assert.deepEqual(
    refusalReasons(deriveWallSupport(makeInput({ mapImagePixelToFloor: () => null }))),
    ["wall_homography_invalid"]
  );
  assert.deepEqual(
    refusalReasons(deriveWallSupport(makeInput({ mapImagePixelToFloor: () => ({ x: 0, y: 0 }) }))),
    ["wall_seam_too_short_world"]
  );
  const parallelRays = [...makeInput().rays] as WallRays;
  parallelRays[2] = { origin: CAMERA, direction: { x: 1, y: 0, z: 0 } };
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: parallelRays }))), ["wall_ray_parallel"]);
  const behindRays = [...makeInput().rays] as WallRays;
  behindRays[2] = { origin: CAMERA, direction: { x: 0, y: 1, z: 1 } };
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: behindRays }))), ["wall_intersection_behind_camera"]);
  const below = [...makeInput().rays] as WallRays;
  below[2] = rayTo({ x: 2, y: -1, z: 0 });
  below[3] = rayTo({ x: -2, y: -1, z: 0 });
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: below }))), ["wall_upper_below_seam"]);
  const far = [...makeInput().rays] as WallRays;
  far[2] = rayTo({ x: 2, y: 25, z: 0 });
  far[3] = rayTo({ x: -2, y: 25, z: 0 });
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: far }))), ["wall_height_excessive"]);
  const wide = [...makeInput().rays] as WallRays;
  wide[2] = rayTo({ x: 30, y: 2, z: 0 });
  wide[3] = rayTo({ x: -30, y: 2, z: 0 });
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: wide }))), ["wall_width_excessive"]);
  const distantCamera = { x: 0, y: 1.5, z: 100 };
  const distantRays: WallRays = [
    { origin: distantCamera, direction: { x: -2, y: -1.5, z: -100 } },
    { origin: distantCamera, direction: { x: 2, y: -1.5, z: -100 } },
    { origin: distantCamera, direction: { x: 2, y: 0.5, z: -100 } },
    { origin: distantCamera, direction: { x: -2, y: 0.5, z: -100 } },
  ];
  assert.deepEqual(
    refusalReasons(deriveWallSupport(makeInput({ cameraPosition: distantCamera, rays: distantRays }))),
    ["wall_camera_distance_excessive"]
  );
  assert.deepEqual(
    refusalReasons(deriveWallSupport(makeInput({ floorBounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } }))),
    ["wall_excessive_extrapolation"]
  );
  assert.deepEqual(
    refusalReasons(deriveWallSupport(makeInput({ projectWorldToPixels: () => ({ x: 0, y: 0 }) }))),
    ["wall_reprojection_error"]
  );
});

test("confirmation binds exactly to polygon, basis, camera snapshot, and frame", () => {
  const basis = makeBasis();
  const stamp = createWallConfirmationStamp(POLYGON, basis, "2026-07-10T00:00:00.000Z", FRAME);
  assert.equal(
    isWallConfirmationCurrent({
      stamp,
      polygon: POLYGON,
      basis,
      cameraAppliedAtIso: "2026-07-10T00:00:00.000Z",
      frameSize: FRAME,
    }),
    true
  );
  assert.equal(buildWallPolygonKey(POLYGON), stamp.wallPolygonKey);
  assert.equal(
    isWallConfirmationCurrent({
      stamp,
      polygon: [{ x: 0.31, y: 0.6 }, POLYGON[1], POLYGON[2], POLYGON[3]],
      basis,
      cameraAppliedAtIso: "2026-07-10T00:00:00.000Z",
      frameSize: FRAME,
    }),
    false
  );
  assert.equal(
    isWallConfirmationCurrent({
      stamp,
      polygon: POLYGON,
      basis,
      cameraAppliedAtIso: "2026-07-10T00:00:01.000Z",
      frameSize: FRAME,
    }),
    false
  );
  assert.equal(
    isWallConfirmationCurrent({
      stamp,
      polygon: POLYGON,
      basis: { ...basis, basisFingerprint: "other" },
      cameraAppliedAtIso: "2026-07-10T00:00:00.000Z",
      frameSize: FRAME,
    }),
    false
  );
});
