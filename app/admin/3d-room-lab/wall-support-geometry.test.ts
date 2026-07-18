import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { CalibrationImageBasis } from "./calibration-image-basis";
import { sourceNormToContainerNorm } from "./image-space";
import { applyHomography, getFloorRectCorners, solvePlaneHomography } from "./perspective-solve";
import {
  buildWallPolygonKey,
  createWallConfirmationStamp,
  deriveWallSupport,
  isWallConfirmationCurrent,
  LEGACY_WALL_GEOMETRY_POLICY_VERSION,
  WALL_GEOMETRY_POLICY_VERSION,
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

test("confirmation binds exactly to polygon, basis, camera snapshot, frame, and active geometry policy", () => {
  const basis = makeBasis();
  const stamp = createWallConfirmationStamp(POLYGON, basis, "2026-07-10T00:00:00.000Z", FRAME);
  assert.deepEqual(stamp, {
    wallPolygonKey: "0.30000000,0.60000000|0.70000000,0.60000000|0.70000000,0.30000000|0.30000000,0.30000000",
    imageBasisId: "basis-1",
    imageBasisFingerprint: "fingerprint-1",
    cameraAppliedAtIso: "2026-07-10T00:00:00.000Z",
    frameWidth: 1000,
    frameHeight: 800,
    wallGeometryPolicyVersion: "wall-support-geometry-policy/v1",
  });
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

test("wall confirmation policy is an exact authority match with a v1 legacy baseline alias", () => {
  const basis = makeBasis();
  const stamp = createWallConfirmationStamp(POLYGON, basis, "2026-07-10T00:00:00.000Z", FRAME);
  const currentInput = {
    stamp,
    polygon: POLYGON,
    basis,
    cameraAppliedAtIso: "2026-07-10T00:00:00.000Z",
    frameSize: FRAME,
  };
  assert.equal(isWallConfirmationCurrent(currentInput, WALL_GEOMETRY_POLICY_VERSION), true);
  assert.equal(
    isWallConfirmationCurrent({
      ...currentInput,
      stamp: { ...stamp, wallGeometryPolicyVersion: "wall-support-geometry-policy/v0" },
    }),
    false
  );
  assert.equal(
    isWallConfirmationCurrent({
      ...currentInput,
      stamp: { ...stamp, wallGeometryPolicyVersion: "wall-support-geometry-policy/v999" },
    }),
    false
  );
  assert.equal(isWallConfirmationCurrent(currentInput, "wall-support-geometry-policy/v2"), false);
  assert.equal(isWallConfirmationCurrent(currentInput, "*"), false);

  const { wallGeometryPolicyVersion: _policyVersion, ...legacyStamp } = stamp;
  const legacyInput = { ...currentInput, stamp: legacyStamp };
  assert.equal(isWallConfirmationCurrent(legacyInput), true);
  assert.equal(isWallConfirmationCurrent(legacyInput, LEGACY_WALL_GEOMETRY_POLICY_VERSION), true);
  assert.equal(isWallConfirmationCurrent(legacyInput, "wall-support-geometry-policy/v2"), false);
  assert.equal(isWallConfirmationCurrent({ ...currentInput, stamp: null }), false);
});

// Golden baseline guardrail. These fixtures deliberately use literal expected
// geometry and projections; none of those expectations are derived by
// deriveWallSupport. Room A controls and the Room B Back/Left controls are
// synthetic camera-consistent walls because no persisted scene record exists.
// Room B Right is the committed persisted fixture. Room C uses the supplied
// camera/Floor authority; its ordinary-wall controls are synthetic because the
// persisted Back/Right polygons are not committed in this baseline.
type GoldenPoint = readonly [number, number];
type GoldenPoint3 = readonly [number, number, number];
type GoldenFixture = {
  name: string;
  kind: "wall_back" | "wall_left" | "wall_right";
  camera: THREE.PerspectiveCamera;
  frame: { width: number; height: number };
  polygon: WallPolygon;
  containerPolygon?: WallPolygon;
  seam: readonly [GoldenPoint3, GoldenPoint3];
  expected: {
    planePoint: GoldenPoint3;
    normal: GoldenPoint3;
    boundaryWorld: readonly GoldenPoint3[];
    boundaryUV: readonly GoldenPoint[];
    metrics: readonly [number, number, number, number, number, number];
    // The lower/upper rows and both side edges are pinned by the four literal
    // structural projections; this additionally pins the interpolated centre.
    centerVertical: readonly [GoldenPoint, GoldenPoint];
    angles?: readonly [number, number, number, number, number];
  };
};

function goldenCamera(
  fov: number,
  frame: { width: number; height: number },
  position: GoldenPoint3,
  lookAt: GoldenPoint3,
  up: GoldenPoint3
) {
  const camera = new THREE.PerspectiveCamera(fov, frame.width / frame.height);
  camera.position.set(...position);
  camera.up.set(...up);
  camera.lookAt(...lookAt);
  camera.updateMatrixWorld(true);
  return camera;
}

function goldenRay(camera: THREE.PerspectiveCamera, point: { x: number; y: number }): WallRay {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const target = new THREE.Vector3(point.x * 2 - 1, 1 - point.y * 2, 0.5).unproject(camera);
  const direction = target.sub(origin).normalize();
  return { origin: { x: origin.x, y: origin.y, z: origin.z }, direction: { x: direction.x, y: direction.y, z: direction.z } };
}

function goldenProject(camera: THREE.PerspectiveCamera, point: { x: number; y: number; z: number }): GoldenPoint {
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return [(projected.x + 1) / 2, (1 - projected.y) / 2];
}

function assertGoldenNumbers(actual: readonly number[], expected: readonly number[], tolerance: number, label: string) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${label}[${index}]: ${value} !== ${expected[index]}`)
  );
}

function assertGoldenPoints(
  actual: readonly { x: number; y: number }[],
  expected: readonly GoldenPoint[],
  tolerance: number,
  label: string
) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((point, index) => assertGoldenNumbers([point.x, point.y], expected[index], tolerance, `${label}[${index}]`));
}

function assertGoldenPoints3(
  actual: readonly { x: number; y: number; z: number }[],
  expected: readonly GoldenPoint3[],
  tolerance: number,
  label: string
) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((point, index) => assertGoldenNumbers([point.x, point.y, point.z], expected[index], tolerance, `${label}[${index}]`));
}

function goldenGrid(result: Extract<ReturnType<typeof deriveWallSupport>, { ok: true }>, camera: THREE.PerspectiveCamera) {
  const projectUv = (uv: { x: number; y: number }): GoldenPoint =>
    goldenProject(camera, {
      x: result.plane.point.x + result.plane.basisU.x * uv.x + result.plane.basisV.x * uv.y,
      y: result.plane.point.y + result.plane.basisU.y * uv.x + result.plane.basisV.y * uv.y,
      z: result.plane.point.z + result.plane.basisU.z * uv.x + result.plane.basisV.z * uv.y,
    });
  const interpolate = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const horizontal = (t: number) => [projectUv(interpolate(result.boundaryUV[0], result.boundaryUV[3], t)), projectUv(interpolate(result.boundaryUV[1], result.boundaryUV[2], t))] as const;
  const vertical = (t: number) => [projectUv(interpolate(result.boundaryUV[0], result.boundaryUV[1], t)), projectUv(interpolate(result.boundaryUV[3], result.boundaryUV[2], t))] as const;
  return [horizontal(0), vertical(0), vertical(0.5), horizontal(1), vertical(1)] as const;
}

function angleDegrees([start, end]: readonly [GoldenPoint, GoldenPoint]) {
  return Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
}

const GOLDEN_A_FRAME = { width: 1000, height: 800 };
const GOLDEN_A_CAMERA = goldenCamera(60, GOLDEN_A_FRAME, [0, 1.5, 6], [0, 1, 0], [0, 1, 0]);
const GOLDEN_B_CAMERA = makeRoomBCamera();
const GOLDEN_C_FRAME = { width: 1118, height: 698 };
const GOLDEN_C_CAMERA = goldenCamera(
  48,
  GOLDEN_C_FRAME,
  [-1.2417974535677727, 1.016316494972545, 4.842226413206968],
  [-0.7491661350031878, 0.9784274514653173, 3.9728135053482077],
  [0.0896839986318533, 0.9959426755230188, 0.007414004414120281]
);

function goldenDirectMap(fixture: GoldenFixture) {
  const polygon = fixture.containerPolygon ?? fixture.polygon;
  return (point: { x: number; y: number }) => {
    for (let index = 0; index < 2; index += 1) {
      if (Math.abs(point.x - polygon[index].x * fixture.frame.width) < 1e-6 && Math.abs(point.y - polygon[index].y * fixture.frame.height) < 1e-6) {
        return { x: fixture.seam[index][0], y: fixture.seam[index][2] };
      }
    }
    return null;
  };
}

const GOLDEN_FIXTURES: readonly GoldenFixture[] = [
  {
    name: "Room A Back — synthetic centered control",
    kind: "wall_back", camera: GOLDEN_A_CAMERA, frame: GOLDEN_A_FRAME,
    polygon: [{ x: 0.3288684831621398, y: 0.5888231183368655 }, { x: 0.6711315168378602, y: 0.5888231183368655 }, { x: 0.6579052639592243, y: 0.32879834289014254 }, { x: 0.3338463653343103, y: 0.36201691679744796 }],
    seam: [[-2, 0, -2], [2, 0, -2]],
    expected: { planePoint: [-2, 0, -2], normal: [0, 0, 1], boundaryWorld: [[-2, 0, -2], [2, 0, -2], [1.8, 2.4, -2], [-1.9, 2.1, -2]], boundaryUV: [[0, 0], [4, 0], [3.8, 2.4], [0.1, 2.1]], metrics: [4, 4, 2.1, 2.1, 2.4, 8.381527307120106], centerVertical: [[0.5, 0.5888231183368654], [0.49562065015966106, 0.34543378620120246]] },
  },
  {
    name: "Room A Left — synthetic centered control",
    kind: "wall_left", camera: GOLDEN_A_CAMERA, frame: GOLDEN_A_FRAME,
    polygon: [{ x: 0.3288684831621398, y: 0.5888231183368655 }, { x: 0.16292276986482085, y: 0.7449364778380231 }, { x: 0.16427921747099855, y: 0.2804442638292972 }, { x: 0.3198129277355144, y: 0.31482394173939643 }],
    seam: [[-2, 0, -2], [-2, 0, 2]],
    expected: { planePoint: [-2, 0, -2], normal: [1, 0, 0], boundaryWorld: [[-2, 0, -2], [-2, 0, 2], [-2, 2.2, 1.8], [-2, 2.5, -1.8]], boundaryUV: [[0, 0], [4, 0], [3.8, 2.2], [0.2, 2.5]], metrics: [4, 4, 2.2, 2.5, 2.2, 8.381527307120102], centerVertical: [[0.27298880419467514, 0.6413919026586838], [0.26549089400293224, 0.3028164224693194]] },
  },
  {
    name: "Room A Right — synthetic centered control",
    kind: "wall_right", camera: GOLDEN_A_CAMERA, frame: GOLDEN_A_FRAME,
    polygon: [{ x: 0.8370772301351792, y: 0.7449364778380231 }, { x: 0.6711315168378602, y: 0.5888231183368655 }, { x: 0.6810669874301831, y: 0.3313059577001555 }, { x: 0.8394775766366505, y: 0.2894404155600399 }],
    seam: [[2, 0, 2], [2, 0, -2]],
    expected: { planePoint: [2, 0, 2], normal: [-1, 0, 0], boundaryWorld: [[2, 0, 2], [2, 0, -2], [2, 2.35, -1.75], [2, 2.15, 1.85]], boundaryUV: [[0, 0], [4, 0], [3.75, 2.35], [0.15, 2.15]], metrics: [4, 4, 2.15, 2.15, 2.35, 8.381527307120102], centerVertical: [[0.7270111958053249, 0.6413919026586838], [0.736168759967323, 0.31674338589416345]] },
  },
  {
    name: "Room B Back — synthetic mildly off-axis control",
    kind: "wall_back", camera: GOLDEN_B_CAMERA, frame: ROOM_B_FRAME,
    polygon: [{ x: 0.45520570091643114, y: 0.6033553848198226 }, { x: 0.8387035240998748, y: 0.6473403587710026 }, { x: 0.8262297190989316, y: 0.273674906651006 }, { x: 0.4729749253566281, y: 0.3287326090024627 }],
    seam: [[-1.9, 0, -2], [1.9, 0, -2]],
    expected: { planePoint: [-1.9, 0, -2], normal: [0, 0, 1], boundaryWorld: [[-1.9, 0, -2], [1.9, 0, -2], [1.7, 2.15, -2], [-1.75, 1.85, -2]], boundaryUV: [[0, 0], [3.8, 0], [3.6, 2.15], [0.15, 1.85]], metrics: [3.8, 3.8, 1.85, 1.85, 2.15, 7.832623979527284], centerVertical: [[0.6318499266650253, 0.623615452018331], [0.6366918159499204, 0.3032159677795639]] },
  },
  {
    name: "Room B Left — synthetic mildly off-axis control",
    kind: "wall_left", camera: GOLDEN_B_CAMERA, frame: ROOM_B_FRAME,
    polygon: [{ x: 0.45520570091643114, y: 0.6033553848198226 }, { x: 0.19501236321189225, y: 0.7368564947531127 }, { x: 0.23027407079504303, y: 0.1274097986770471 }, { x: 0.45144915904780714, y: 0.31678156556526343 }],
    seam: [[-1.9, 0, -2], [-1.9, 0, 2]],
    expected: { planePoint: [-1.9, 0, -2], normal: [1, 0, 0], boundaryWorld: [[-1.9, 0, -2], [-1.9, 0, 2], [-1.9, 2.15, 1.75], [-1.9, 1.9, -1.75]], boundaryUV: [[0, 0], [4, 0], [3.75, 2.15], [0.25, 1.9]], metrics: [4, 4, 1.9, 1.9, 2.15, 7.8326239795272725], centerVertical: [[0.3672979240501075, 0.6484594827454533], [0.3727784722733965, 0.24942313440346026]] },
  },
  {
    name: "Room B Right — persisted grazing reference",
    kind: "wall_right", camera: GOLDEN_B_CAMERA, frame: ROOM_B_FRAME, polygon: ROOM_B_RIGHT_POLYGON, seam: [[1.9, 0, -2], [1.9, 0, 2]],
    expected: { planePoint: [1.9, 0, -2], normal: [-1, 0, 0], boundaryWorld: [[1.9, 0.033258135392821186, -2.167556651926791], [1.9, 0.05620447010424712, 1.9922686246972345], [1.9, 2.254015119384989, 1.2656442083807624], [1.9, 2.3131769948747074, -3.6305329647522706]], boundaryUV: [[-0.16755665192679103, 0.033258135392821186], [3.9922686246972345, 0.05620447010424712], [3.2656442083807624, 2.254015119384989], [-1.6305329647522706, 2.3131769948747074]], metrics: [4, 4.8965345948150345, 2.1978106492807417, 2.279918859481886, 2.1978106492807417, 9.038669611208878], centerVertical: [[0.8815095996023156, 0.7059309117586687], [0.8675736704243676, 0.22044621756882105]], angles: [56.52539818087453, -58.42223340793413, -91.49912528608625, -91.9228514926351, -91.64423458366713] },
  },
];

const ROOM_C_INTRINSIC = { width: 7360, height: 4912 };
function roomCContainer(polygon: WallPolygon): WallPolygon {
  return polygon.map((point) => {
    const value = sourceNormToContainerNorm(point, ROOM_C_INTRINSIC, GOLDEN_C_FRAME);
    if (!value) throw new Error("Room C source-to-container projection failed");
    return value;
  }) as WallPolygon;
}

const ROOM_C_ORDINARY_FIXTURES: readonly GoldenFixture[] = [
  {
    name: "Room C Back — synthetic off-axis control",
    kind: "wall_back", camera: GOLDEN_C_CAMERA, frame: GOLDEN_C_FRAME,
    polygon: [{ x: 0.18898176453219945, y: 0.8481810634346472 }, { x: 0.6314295689059719, y: 0.6934985717416059 }, { x: 0.5833409666041142, y: 0.13514967322418625 }, { x: 0.1834004385940915, y: 0.1948178251487197 }],
    containerPolygon: [{ x: 0.18898176453219945, y: 0.8721963176729164 }, { x: 0.6314295689059719, y: 0.7068448386214786 }, { x: 0.5833409666041142, y: 0.10998468214166157 }, { x: 0.1834004385940915, y: 0.1737683532281502 }],
    seam: [[-1, 0, 1.5], [1.5, 0, 1.5]],
    expected: { planePoint: [-1, 0, 1.5], normal: [0, 0, 1], boundaryWorld: [[-1, 0, 1.5], [1.5, 0, 1.5], [1.35, 2.25, 1.5], [-0.85, 1.9, 1.5]], boundaryUV: [[0, 0], [2.5, 0], [2.35, 2.25], [0.15, 1.9]], metrics: [2.5, 2.5, 1.9, 1.9, 2.25, 4.4408141023333], centerVertical: [[0.44723211690712383, 0.7756830627564681], [0.4130984689678616, 0.13713544760222257]], angles: [-20.491708325978895, -9.061385901216596, -90.45785625669724, -94.60633058842355, -93.05984130443531] },
  },
  {
    name: "Room C Right — synthetic off-axis control",
    kind: "wall_right", camera: GOLDEN_C_CAMERA, frame: GOLDEN_C_FRAME,
    polygon: [{ x: 0.7535267705103106, y: 0.689955438952378 }, { x: 0.45459066209915744, y: 0.6069618056349875 }, { x: 0.4485612256364594, y: 0.2943068897386816 }, { x: 0.7050898852424861, y: 0.2133561491969544 }],
    containerPolygon: [{ x: 0.7535267705103106, y: 0.7030573236883918 }, { x: 0.45459066209915744, y: 0.6143393319449179 }, { x: 0.4485612256364594, y: 0.28011952328842904 }, { x: 0.7050898852424861, y: 0.19358532971307385 }],
    seam: [[2, 0, 2], [2, 0, -2]],
    expected: { planePoint: [2, 0, 2], normal: [-1, 0, 0], boundaryWorld: [[2, 0, 2], [2, 0, -2], [2, 2.2, -1.72], [2, 1.9, 1.8]], boundaryUV: [[0, 0], [4, 0], [3.72, 2.2], [0.2, 1.9]], metrics: [4, 4, 1.9, 1.9, 2.2, 7.63925469123126], centerVertical: [[0.559596684329162, 0.6455029256062215], [0.5427180919454554, 0.2483578148378227]], angles: [-163.47021144713025, 161.35933011645002, -95.4309414223444, -91.03352279943167, -92.43359532539675] },
  },
];

test("pins Vibode wall-support world, local, and projected-grid geometry", () => {
  for (const fixture of [...GOLDEN_FIXTURES, ...ROOM_C_ORDINARY_FIXTURES]) {
    const container = fixture.containerPolygon ?? fixture.polygon;
    const result = deriveWallSupport({
      kind: fixture.kind,
      polygonSourceNorm: fixture.polygon,
      polygonContainerNorm: container,
      frameSize: fixture.frame,
      mapImagePixelToFloor: goldenDirectMap(fixture),
      cameraPosition: (() => {
        const position = fixture.camera.getWorldPosition(new THREE.Vector3());
        return { x: position.x, y: position.y, z: position.z };
      })(),
      rays: container.map((point) => goldenRay(fixture.camera, point)) as [WallRay, WallRay, WallRay, WallRay],
      projectWorldToPixels: (point) => {
        const projected = goldenProject(fixture.camera, point);
        return { x: projected[0] * fixture.frame.width, y: projected[1] * fixture.frame.height };
      },
      floorBounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    });
    assert.equal(result.ok, true, fixture.name);
    if (!result.ok) continue;
    assertGoldenNumbers([result.plane.point.x, result.plane.point.y, result.plane.point.z], fixture.expected.planePoint, 1e-9, `${fixture.name} plane`);
    assertGoldenNumbers([result.plane.normal.x, result.plane.normal.y, result.plane.normal.z], fixture.expected.normal, 1e-9, `${fixture.name} normal`);
    assertGoldenPoints3(result.seamWorld, fixture.seam, 1e-9, `${fixture.name} seam`);
    assertGoldenPoints3(result.boundaryWorld, fixture.expected.boundaryWorld, 1e-9, `${fixture.name} boundaryWorld`);
    assertGoldenPoints(result.boundaryUV, fixture.expected.boundaryUV, 1e-9, `${fixture.name} boundaryUV`);
    assertGoldenNumbers(
      [result.diagnostics.mappedSeamWorldLength, result.diagnostics.wallWidth, result.diagnostics.wallHeight, result.diagnostics.upperStartHeight, result.diagnostics.upperEndHeight, result.diagnostics.maxCameraDistance],
      fixture.expected.metrics, 1e-9, `${fixture.name} metrics`
    );
    const projectedStructural = result.boundaryWorld.map((point) => goldenProject(fixture.camera, point));
    assertGoldenPoints(projectedStructural.map(([x, y]) => ({ x, y })), container.map((point) => [point.x, point.y]), 1e-6, `${fixture.name} structural projection`);
    const grid = goldenGrid(result, fixture.camera);
    assertGoldenNumbers([...grid[2][0], ...grid[2][1]], [...fixture.expected.centerVertical[0], ...fixture.expected.centerVertical[1]], 1e-6, `${fixture.name} centre grid`);
    if (fixture.expected.angles) {
      const [lower, upper, left, right, center] = fixture.expected.angles;
      assertGoldenNumbers(grid.map((line) => angleDegrees(line)), [lower, left, center, upper, right], 0.01, `${fixture.name} projected angles`);
    }
  }
});

const ROOM_C_FLOOR_SOURCE: WallPolygon = [
  { x: 0.045000000000000005, y: 0.9653019205454482 },
  { x: 0.6912032370071685, y: 0.7138032156053693 },
  { x: 0.4119999999999999, y: 0.617 },
  { x: 0.07800000000000003, y: 0.6950000000000001 },
];

function roomCFloorMap() {
  const rect = getFloorRectCorners({ widthMeters: 3, depthMeters: 4 });
  assert.equal(rect.ok, true);
  if (!rect.ok) throw new Error("Room C Floor rectangle fixture is invalid");
  const solve = solvePlaneHomography(
    roomCContainer(ROOM_C_FLOOR_SOURCE).map((point) => ({ x: point.x * GOLDEN_C_FRAME.width, y: point.y * GOLDEN_C_FRAME.height })),
    rect.value.asArray.map((point) => ({ x: point.x, y: point.z }))
  );
  assert.equal(solve.ok, true);
  if (!solve.ok) throw new Error("Room C Floor homography fixture is invalid");
  return (point: { x: number; y: number }) => applyHomography(solve.value, point);
}

function deriveRoomCWall(kind: "wall_back" | "wall_left" | "wall_right", polygon: WallPolygon) {
  const container = roomCContainer(polygon);
  return deriveWallSupport({
    kind,
    polygonSourceNorm: polygon,
    polygonContainerNorm: container,
    frameSize: GOLDEN_C_FRAME,
    mapImagePixelToFloor: roomCFloorMap(),
    cameraPosition: (() => {
      const point = GOLDEN_C_CAMERA.getWorldPosition(new THREE.Vector3());
      return { x: point.x, y: point.y, z: point.z };
    })(),
    rays: container.map((point) => goldenRay(GOLDEN_C_CAMERA, point)) as [WallRay, WallRay, WallRay, WallRay],
    projectWorldToPixels: (point) => {
      const projected = goldenProject(GOLDEN_C_CAMERA, point);
      return { x: projected[0] * GOLDEN_C_FRAME.width, y: projected[1] * GOLDEN_C_FRAME.height };
    },
    floorBounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
  });
}

function deriveRoomCLeft(polygon: WallPolygon) {
  return deriveRoomCWall("wall_left", polygon);
}

test("Room C extreme compressed Left wall keeps its baseline width refusal", () => {
  const result = deriveRoomCLeft([
    { x: 0.06258421957488214, y: 0.8212701532004936 },
    { x: 0.07800000000000003, y: 0.6950000000000001 },
    { x: 0.07833851366487456, y: 0.22163347825024032 },
    { x: 0.0631, y: 0.03226154195777707 },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.reasons, ["wall_width_excessive"]);
  assertGoldenNumbers(
    [
      result.diagnostics?.mappedSeamWorldLength ?? Number.NaN,
      result.diagnostics?.wallWidth ?? Number.NaN,
      result.diagnostics?.wallHeight ?? Number.NaN,
      result.diagnostics?.upperStartHeight ?? Number.NaN,
      result.diagnostics?.upperEndHeight ?? Number.NaN,
      result.diagnostics?.lowerSeamRayPlaneDenominatorStart ?? Number.NaN,
      result.diagnostics?.lowerSeamRayPlaneDenominatorEnd ?? Number.NaN,
      result.diagnostics?.maxLowerSeamCameraAngleRad ?? Number.NaN,
    ],
    [2.7306332695496174, 27.539647838391385, 17.990261248832965, 18.268551397806252, 17.990261248832965, -0.06144444658560525, -0.038083344200869715, 0.0007884341551257884],
    1e-9,
    "Room C extreme diagnostics"
  );
});

test("Room C Left baseline fail-open manifest — not an accepted physical wall", () => {
  const result = deriveRoomCLeft([
    { x: 0.06015660002240144, y: 0.8186771943162083 },
    { x: 0.07800000000000003, y: 0.6950000000000001 },
    { x: 0.07829716726870521, y: 0.2217541460689261 },
    { x: 0.06197515781635025, y: 0.03226154195777707 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assertGoldenPoints3(result.boundaryWorld, [[-1.5123408318449818, 0.0094084933450993, 0.7225143072393507], [-1.5005711655377656, 0.018068594093000545, -1.8739950136342038], [-1.3706401755201358, 9.370413648181556, -30.538106454436925], [-1.417273615462988, 10.767669398413364, -20.25029044373371]], 1e-9, "Room C fail-open boundaryWorld");
  assertGoldenPoints(result.boundaryUV, [[-0.03697307793319957, 0.0094084933450993], [2.559562918048414, 0.018068594093000545], [31.22396883815993, 9.370413648181556], [20.936047136095794, 10.767669398413364]], 1e-9, "Room C fail-open boundaryUV");
  assertGoldenNumbers([result.diagnostics.wallWidth, result.diagnostics.wallHeight, result.diagnostics.upperStartHeight, result.diagnostics.upperEndHeight, result.diagnostics.maxCameraDistance], [10.382372396488103, 9.352345054088556, 10.758260905068266, 9.352345054088556, 36.35347979929209], 1e-9, "Room C fail-open diagnostics");
  const projected = result.boundaryWorld.map((point) => goldenProject(GOLDEN_C_CAMERA, point));
  assertGoldenNumbers(projected.flat(), [0.06015660002240175, 0.8406574644835392, 0.07800000000000007, 0.7084498255886382, 0.07829716726870528, 0.2025625655246459, 0.061975157816350046, 0], 1e-6, "Room C fail-open structural projection");
});

const ROOM_C_OPERATOR_FIXTURES = [
  {
    name: "operator-exported Room C Back-wall baseline fixture",
    kind: "wall_back" as const,
    polygon: [{ x: 0.07800000000000003, y: 0.6950000000000001 }, { x: 0.4119999999999999, y: 0.617 }, { x: 0.41012042739485327, y: 0.3338783144276417 }, { x: 0.07842623802923387, y: 0.22181302540863798 }] as WallPolygon,
    container: [[0.07800000000000001, 0.7084498255886384], [0.41199999999999987, 0.625069895353183], [0.41012042739485327, 0.3224203262356477], [0.07842623802923387, 0.20262550597640833]] as GoldenPoint[],
    planePoint: [-1.4999999999999998, 0, -2.0000000000000036] as GoldenPoint3,
    normal: [7.401486830834377e-16, 0, 1] as GoldenPoint3,
    seamNormal: [7.401486830834377e-16, 0, 1] as GoldenPoint3,
    seam: [[-1.4999999999999998, 0, -2.0000000000000036], [1.5, 0, -2.0000000000000058]] as GoldenPoint3[],
    boundaryWorld: [[-1.5054260945188582, -0.0006598255265972686, -2.0000000000000036], [1.503183498940499, -0.0006598255265990449, -2.0000000000000053], [1.66564592348547, 1.971585320267801, -2.000000000000006], [-1.2658096253454658, 2.6316303115234927, -2.0000000000000036]] as GoldenPoint3[],
    boundaryUV: [[-0.005426094518858449, -0.0006598255265972686], [3.0031834989404986, -0.0006598255265990449], [3.16564592348547, 1.971585320267801], [0.23419037465453396, 2.6316303115234927]] as GoldenPoint[],
    metrics: [3.008609593459357, 1.9722451457944001, 2.6322901370500897, 1.9722451457944001, 7.495453809406001] as const,
    grid: [[[0.07800000000000001, 0.7084498255886382], [0.4119999999999999, 0.625069895353183]], [[0.07800000000000001, 0.7084498255886382], [0.07842623802923376, 0.20262550597640866]], [[0.2637556673342179, 0.6620776861180768], [0.26270316565783536, 0.26917904273089144]], [[0.07842623802923376, 0.20262550597640866], [0.4101204273948531, 0.32242032623564765]], [[0.4119999999999999, 0.625069895353183], [0.4101204273948531, 0.32242032623564765]]] as readonly (readonly [GoldenPoint, GoldenPoint])[],
    angles: [-14.01685615563203, 19.85771476029062, -89.95171913762196, -90.35582470310946, -90.15348426561178] as const,
  },
  {
    name: "operator-exported Room C Right-wall baseline fixture",
    kind: "wall_right" as const,
    polygon: [{ x: 0.4119999999999999, y: 0.617 }, { x: 0.6912032370071685, y: 0.7138032156053693 }, { x: 0.6885487546202959, y: 0.1791307897367448 }, { x: 0.4102434274543571, y: 0.3331937243038378 }] as WallPolygon,
    container: [[0.41199999999999987, 0.625069895353183], [0.6912032370071685, 0.7285499641191244], [0.6885487546202957, 0.15699932863518118], [0.4102434274543571, 0.3216885175592034]] as GoldenPoint[],
    planePoint: [1.5, 0, -2.0000000000000058] as GoldenPoint3,
    normal: [-1, 0, -2.2204460492503116e-16] as GoldenPoint3,
    seamNormal: [-1, 0, -2.2204460492503116e-16] as GoldenPoint3,
    seam: [[1.5, 0, -2.0000000000000058], [1.4999999999999991, 0, 1.999999999999997]] as GoldenPoint3[],
    boundaryWorld: [[1.5000000000000004, 0.0005196154585425106, -1.9920647097688677], [1.4999999999999991, 0.001944190476993457, 2.0010062947177945], [1.4999999999999991, 1.906264771593984, 2.1678372085690856], [1.5000000000000004, 1.9210761182815173, -1.6061180288861792]] as GoldenPoint3[],
    boundaryUV: [[0.007935290231138037, 0.0005196154585425106], [4.001006294717801, 0.001944190476993457], [4.167837208569091, 1.906264771593984], [0.3938819711138266, 1.9210761182815173]] as GoldenPoint[],
    metrics: [3.9930712586035964, 1.9043205811169905, 1.9205565028229747, 1.9043205811169905, 7.4334939113721905] as const,
    grid: [[[0.412, 0.625069895353183], [0.6912032370071688, 0.7285499641191246]], [[0.412, 0.625069895353183], [0.4102434274543572, 0.32168851755920386]], [[0.5082916788329102, 0.6607581260987373], [0.5061866902975194, 0.26491339829983185]], [[0.4102434274543572, 0.32168851755920386], [0.688548754620296, 0.1569993286351809]], [[0.6912032370071688, 0.7285499641191246], [0.688548754620296, 0.1569993286351809]]] as readonly (readonly [GoldenPoint, GoldenPoint])[],
    angles: [20.33603169990655, -30.615231596347606, -90.33173779276392, -90.26609985992405, -90.30467962235417] as const,
  },
] as const;

test("pins operator-exported Room C wall geometry and projected grids", () => {
  for (const fixture of ROOM_C_OPERATOR_FIXTURES) {
    const result = deriveRoomCWall(fixture.kind, fixture.polygon);
    assert.equal(result.ok, true, fixture.name);
    if (!result.ok) continue;
    assertGoldenNumbers([result.plane.point.x, result.plane.point.y, result.plane.point.z], fixture.planePoint, 1e-9, `${fixture.name} plane point`);
    assertGoldenNumbers([result.plane.normal.x, result.plane.normal.y, result.plane.normal.z], fixture.normal, 1e-9, `${fixture.name} plane normal`);
    assertGoldenNumbers([result.seamNormal.x, result.seamNormal.y, result.seamNormal.z], fixture.seamNormal, 1e-9, `${fixture.name} seam normal`);
    assertGoldenPoints3(result.seamWorld, fixture.seam, 1e-9, `${fixture.name} seam`);
    assertGoldenPoints3(result.boundaryWorld, fixture.boundaryWorld, 1e-9, `${fixture.name} boundaryWorld`);
    assertGoldenPoints(result.boundaryUV, fixture.boundaryUV, 1e-9, `${fixture.name} boundaryUV`);
    assertGoldenNumbers([result.diagnostics.wallWidth, result.diagnostics.wallHeight, result.diagnostics.upperStartHeight, result.diagnostics.upperEndHeight, result.diagnostics.maxCameraDistance], fixture.metrics, 1e-9, `${fixture.name} diagnostics`);
    const structural = result.boundaryWorld.map((point) => goldenProject(GOLDEN_C_CAMERA, point));
    assertGoldenPoints(structural.map(([x, y]) => ({ x, y })), fixture.container, 1e-6, `${fixture.name} structural projection`);
    const grid = goldenGrid(result, GOLDEN_C_CAMERA);
    grid.forEach((line, index) => assertGoldenNumbers([...line[0], ...line[1]], [...fixture.grid[index][0], ...fixture.grid[index][1]], 1e-6, `${fixture.name} grid ${index}`));
    assertGoldenNumbers([angleDegrees(grid[0]), angleDegrees(grid[3]), angleDegrees(grid[1]), angleDegrees(grid[4]), angleDegrees(grid[2])], fixture.angles, 0.01, `${fixture.name} angles`);
  }
});

test("Room C operator fixtures reject forced vertical-extrusion upper U coordinates", () => {
  for (const fixture of ROOM_C_OPERATOR_FIXTURES) {
    const result = deriveRoomCWall(fixture.kind, fixture.polygon);
    assert.equal(result.ok, true, fixture.name);
    if (!result.ok) continue;
    const seamLength = result.diagnostics.mappedSeamWorldLength;
    assert.ok(Math.abs(result.boundaryUV[3].x) > 0.1, `${fixture.name} upper-start U is not a forced zero`);
    assert.ok(Math.abs(result.boundaryUV[2].x - seamLength) > 0.1, `${fixture.name} upper-end U is not a forced seam endpoint`);
    const projectUv = (uv: { x: number; y: number }) =>
      goldenProject(GOLDEN_C_CAMERA, {
        x: result.plane.point.x + result.plane.basisU.x * uv.x + result.plane.basisV.x * uv.y,
        y: result.plane.point.y + result.plane.basisU.y * uv.x + result.plane.basisV.y * uv.y,
        z: result.plane.point.z + result.plane.basisU.z * uv.x + result.plane.basisV.z * uv.y,
      });
    const forcedUpper = [projectUv({ x: seamLength, y: result.boundaryUV[2].y }), projectUv({ x: 0, y: result.boundaryUV[3].y })];
    const actualUpper = [goldenProject(GOLDEN_C_CAMERA, result.boundaryWorld[2]), goldenProject(GOLDEN_C_CAMERA, result.boundaryWorld[3])];
    assert.ok(Math.max(...forcedUpper.map((point, index) => Math.hypot(point[0] - actualUpper[index][0], point[1] - actualUpper[index][1]))) > 0.01, `${fixture.name} forced extrusion materially changes projected structure`);
  }
});

test("Room B Right golden upper U values reject vertical-extrusion reinterpretation", () => {
  const real = GOLDEN_FIXTURES[5];
  const expected = real.expected.boundaryUV;
  // The rolled-back reinterpretation forced these to the lower seam's U
  // endpoints (0 and 4). Baseline free rays are materially displaced.
  assert.ok(Math.abs(expected[3][0]) > 1);
  assert.ok(Math.abs(expected[2][0] - 4) > 0.5);
});
