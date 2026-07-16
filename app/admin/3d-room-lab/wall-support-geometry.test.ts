import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
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
const ROOM_B_FRAME = { width: 1118, height: 698 };
const ROOM_B_CAMERA = {
  position: { x: 0.8650443337121687, y: 1.026730078232466, z: 5.25605633824082 },
  lookAt: { x: 0.5658053560585476, y: 0.986461021903263, z: 4.30272825339533 },
  up: { x: -0.0400329432323816, y: 0.9987591746229256, z: -0.029622197127919917 },
};
const ROOM_B_RIGHT_POLYGON: WallPolygon = [
  { x: 0.8362350190412188, y: 0.6374625576375754 },
  { x: 0.9899999999999998, y: 0.8700000000000001 },
  { x: 0.9629816308243727, y: 0.06522786308142993 },
  { x: 0.8270469310035844, y: 0.28637880620461126 },
];
const ROOM_B_RIGHT_SEAM = [
  { x: 1.9, y: 0, z: -2 },
  { x: 1.9, y: 0, z: 2 },
] as const;

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

function makeRoomBCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(47, ROOM_B_FRAME.width / ROOM_B_FRAME.height);
  camera.position.set(ROOM_B_CAMERA.position.x, ROOM_B_CAMERA.position.y, ROOM_B_CAMERA.position.z);
  camera.up.set(ROOM_B_CAMERA.up.x, ROOM_B_CAMERA.up.y, ROOM_B_CAMERA.up.z);
  camera.lookAt(ROOM_B_CAMERA.lookAt.x, ROOM_B_CAMERA.lookAt.y, ROOM_B_CAMERA.lookAt.z);
  camera.updateMatrixWorld(true);
  return camera;
}

function roomBRay(camera: THREE.PerspectiveCamera, point: { x: number; y: number }): WallRay {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const rayPoint = new THREE.Vector3(point.x * 2 - 1, 1 - point.y * 2, 0.5).unproject(camera);
  return {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    direction: rayPoint.sub(origin).normalize(),
  };
}

function roomBProject(camera: THREE.PerspectiveCamera, point: { x: number; y: number; z: number }) {
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return {
    x: ((projected.x + 1) / 2) * ROOM_B_FRAME.width,
    y: ((1 - projected.y) / 2) * ROOM_B_FRAME.height,
  };
}

function rayAtAngleFromBackWallSeam(angle: number): WallRay {
  const towardSeam = new THREE.Vector3(-2, -1.5, -3).normalize();
  const orthogonal = new THREE.Vector3().crossVectors(towardSeam, new THREE.Vector3(0, 1, 0)).normalize();
  const direction = towardSeam.multiplyScalar(Math.cos(angle)).addScaledVector(orthogonal, Math.sin(angle));
  return {
    origin: CAMERA,
    direction: { x: direction.x, y: direction.y, z: direction.z },
  };
}

function projectBoundaryToReviewedCorner(point: { x: number; y: number; z: number }) {
  if (point.y > 0.5) return point.x < 0 ? { x: 300, y: 240 } : { x: 700, y: 240 };
  return point.x < 0 ? { x: 300, y: 480 } : { x: 700, y: 480 };
}

function makeRoomBRightWallInput(
  overrides: Partial<Parameters<typeof deriveWallSupport>[0]> = {}
): Parameters<typeof deriveWallSupport>[0] {
  const camera = makeRoomBCamera();
  const lowerStartPixel = {
    x: ROOM_B_RIGHT_POLYGON[0].x * ROOM_B_FRAME.width,
    y: ROOM_B_RIGHT_POLYGON[0].y * ROOM_B_FRAME.height,
  };
  const lowerEndPixel = {
    x: ROOM_B_RIGHT_POLYGON[1].x * ROOM_B_FRAME.width,
    y: ROOM_B_RIGHT_POLYGON[1].y * ROOM_B_FRAME.height,
  };
  return {
    kind: "wall_right",
    polygonSourceNorm: ROOM_B_RIGHT_POLYGON,
    polygonContainerNorm: ROOM_B_RIGHT_POLYGON,
    frameSize: ROOM_B_FRAME,
    // The Floor-derived lower seam is authoritative: FR -> NR.
    mapImagePixelToFloor: (point) =>
      Math.abs(point.x - lowerStartPixel.x) < 1e-6 && Math.abs(point.y - lowerStartPixel.y) < 1e-6
        ? { x: ROOM_B_RIGHT_SEAM[0].x, y: ROOM_B_RIGHT_SEAM[0].z }
        : Math.abs(point.x - lowerEndPixel.x) < 1e-6 && Math.abs(point.y - lowerEndPixel.y) < 1e-6
          ? { x: ROOM_B_RIGHT_SEAM[1].x, y: ROOM_B_RIGHT_SEAM[1].z }
          : null,
    cameraPosition: ROOM_B_CAMERA.position,
    rays: ROOM_B_RIGHT_POLYGON.map((point) => roomBRay(camera, point)) as [
      WallRay,
      WallRay,
      WallRay,
      WallRay,
    ],
    projectWorldToPixels: (point) => roomBProject(camera, point),
    floorBounds: { minX: -1.9, maxX: 1.9, minZ: -2, maxZ: 2 },
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

function assertApproximately(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) <= 1e-9, `expected ${actual} ≈ ${expected}`);
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
  assert.deepEqual(result.seamNormal, { x: 0, y: 0, z: 1 });
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
    assert.deepEqual(result.seamNormal, crossUV);
    assert.equal(result.plane.basisU.x * result.plane.normal.x + result.plane.basisU.z * result.plane.normal.z, 0);
    assert.equal(result.plane.basisV.y, 1);
    assert.ok(Object.values(result.diagnostics).filter((value) => typeof value === "number").every(Number.isFinite));
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
  assert.deepEqual(result.seamNormal, { x: 0, y: 0, z: 1 });
  assert.notDeepEqual(result.seamNormal, result.plane.normal);
});

test("accepts Room B's exact Floor-snapped grazing right wall while retaining raw disagreement diagnostics", () => {
  const result = deriveWallSupport(makeRoomBRightWallInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.seamWorld, ROOM_B_RIGHT_SEAM);
  assertApproximately(result.diagnostics.lowerSeamDisagreementStartWorld, 0.17082545236212116);
  assertApproximately(result.diagnostics.lowerSeamDisagreementEndWorld, 0.0567337344423187);
  assertApproximately(result.diagnostics.maxLowerSeamDisagreementWorld, 0.17082545236212116);
  assertApproximately(result.diagnostics.lowerSeamRayPlaneDenominatorStart, -0.1368814758452134);
  assertApproximately(result.diagnostics.lowerSeamRayPlaneDenominatorEnd, -0.29081239864871);
  assertApproximately(result.diagnostics.lowerSeamCameraAngleStartRad, 0.008034166543566902);
  assertApproximately(result.diagnostics.lowerSeamCameraAngleEndRad, 0.01573498745732104);
  assert.ok(result.diagnostics.maxLowerSeamCameraAngleRad <= result.diagnostics.maxLowerSeamCameraAngleThresholdRad);
  assert.ok(result.diagnostics.wallWidth > 0);
  assert.ok(result.diagnostics.wallHeight > 0);
  assert.ok(Object.values(result.diagnostics).filter((value) => typeof value === "number").every(Number.isFinite));
});

test("rejects genuinely camera-inconsistent lower seam rays", () => {
  const inconsistentRays = [...makeInput().rays] as WallRays;
  inconsistentRays[0] = rayTo({ x: -1, y: 0, z: 0 });
  const result = deriveWallSupport(makeInput({ rays: inconsistentRays }));
  assert.deepEqual(refusalReasons(result), ["wall_seam_camera_inconsistent"]);
  if (!result.ok) {
    assert.ok(
      (result.diagnostics?.maxLowerSeamCameraAngleRad ?? 0) >
        (result.diagnostics?.maxLowerSeamCameraAngleThresholdRad ?? Number.POSITIVE_INFINITY)
    );
  }
});

test("uses an angular camera-consistency boundary with exact-threshold acceptance", () => {
  const angle = Math.PI / 90;
  const exactlyAtThreshold = deriveWallSupport(
    makeInput({
      rays: [
        rayAtAngleFromBackWallSeam(angle),
        ...makeInput().rays.slice(1),
      ] as WallRays,
      projectWorldToPixels: projectBoundaryToReviewedCorner,
    })
  );
  assert.equal(exactlyAtThreshold.ok, true);
  if (exactlyAtThreshold.ok) {
    assertApproximately(exactlyAtThreshold.diagnostics.maxLowerSeamCameraAngleRad, angle);
  }

  const justAboveThreshold = deriveWallSupport(
    makeInput({
      rays: [
        rayAtAngleFromBackWallSeam(angle + 1e-4),
        ...makeInput().rays.slice(1),
      ] as WallRays,
      projectWorldToPixels: projectBoundaryToReviewedCorner,
    })
  );
  assert.deepEqual(refusalReasons(justAboveThreshold), ["wall_seam_camera_inconsistent"]);
});

test("requires both corresponding upper corners to clear the height minimum", () => {
  const upperStartBelow = [...makeInput().rays] as WallRays;
  upperStartBelow[3] = rayTo({ x: -2, y: 0.04, z: 0 });
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: upperStartBelow }))), ["wall_upper_below_seam"]);

  const upperEndBelow = [...makeInput().rays] as WallRays;
  upperEndBelow[2] = rayTo({ x: 2, y: 0.04, z: 0 });
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: upperEndBelow }))), ["wall_upper_below_seam"]);

  const exactlyMinimum = [...makeInput().rays] as WallRays;
  exactlyMinimum[3] = rayTo({ x: -2, y: 0.05, z: 0 });
  assert.deepEqual(refusalReasons(deriveWallSupport(makeInput({ rays: exactlyMinimum }))), ["wall_upper_below_seam"]);
});

test("accepts trapezoidal per-corner heights but rejects an invalid corner hidden by average height", () => {
  const trapezoid = [...makeInput().rays] as WallRays;
  trapezoid[2] = rayTo({ x: 2, y: 4, z: 0 });
  trapezoid[3] = rayTo({ x: -2, y: 0.1, z: 0 });
  const valid = deriveWallSupport(makeInput({ rays: trapezoid }));
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.diagnostics.upperEndHeight, 4);
    assertApproximately(valid.diagnostics.upperStartHeight, 0.1);
    assertApproximately(valid.diagnostics.wallHeight, 0.1);
  }

  const averageWouldPass = [...makeInput().rays] as WallRays;
  averageWouldPass[2] = rayTo({ x: 2, y: 2, z: 0 });
  averageWouldPass[3] = rayTo({ x: -2, y: -0.1, z: 0 });
  assert.deepEqual(
    refusalReasons(deriveWallSupport(makeInput({ rays: averageWouldPass }))),
    ["wall_upper_below_seam"]
  );
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
