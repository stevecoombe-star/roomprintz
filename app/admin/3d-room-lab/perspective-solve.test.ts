import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQuadSolvability } from "./quad-solvability";
import {
  applyHomography,
  applyInverseHomography,
  canonicalizeUnlabelledFloorQuad,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  solvePlaneHomography,
  validateOrderedFloorCorners,
  type SolveResult,
  type Vec2,
} from "./perspective-solve";

const ROOM_C_BASELINE_SOURCE_QUAD = [
  { x: 0.045000000000000005, y: 0.9653019205454482 }, // NL
  { x: 0.6912032370071685, y: 0.7138032156053693 }, // NR
  { x: 0.4119999999999999, y: 0.617 }, // FR
  { x: 0.07800000000000003, y: 0.6950000000000001 }, // FL
] as const;

const ROOM_C_CORRECTED_SOURCE_QUAD = [
  ROOM_C_BASELINE_SOURCE_QUAD[0],
  { x: 0.573835912998432, y: 0.6727902522367901 }, // corrected NR, index 1
  ROOM_C_BASELINE_SOURCE_QUAD[2],
  ROOM_C_BASELINE_SOURCE_QUAD[3],
] as const;

const FRAME = { width: 1118, height: 698 };

function pixels(points: readonly Vec2[]): Vec2[] {
  return points.map((point) => ({ x: point.x * FRAME.width, y: point.y * FRAME.height }));
}

function valueOrThrow<T>(result: SolveResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function solveRoomCHomography(quad: readonly Vec2[]) {
  const ordered = valueOrThrow(validateOrderedFloorCorners([...quad]));
  const floorRect = valueOrThrow(getFloorRectCorners({ widthMeters: 3, depthMeters: 4 }));
  const homography = valueOrThrow(solvePlaneHomography(pixels(ordered.asArray), floorRect.asArray.map(floorVec3ToPlane2D)));
  return { ordered, homography };
}

function isCyclicPermutationOrReversal(candidate: readonly Vec2[], perimeter: readonly Vec2[]): boolean {
  const indexByPoint = candidate.map((point) => perimeter.indexOf(point));
  if (indexByPoint.some((index) => index < 0) || new Set(indexByPoint).size !== 4) return false;
  const direction = (indexByPoint[1] - indexByPoint[0] + 4) % 4;
  if (direction !== 1 && direction !== 3) return false;
  return indexByPoint.every((index, offset) => index === (indexByPoint[0] + direction * offset + 8) % 4);
}

test("Room C baseline preserves established semantic corner identities", () => {
  const inspection = validateOrderedFloorCorners([...ROOM_C_BASELINE_SOURCE_QUAD]);
  if (inspection.ok) {
    assert.equal(inspection.confidence, "high");
    assert.equal(inspection.note, undefined);
  }
  const result = valueOrThrow(inspection);
  assert.equal(result.nearLeft, ROOM_C_BASELINE_SOURCE_QUAD[0]);
  assert.equal(result.nearRight, ROOM_C_BASELINE_SOURCE_QUAD[1]);
  assert.equal(result.farRight, ROOM_C_BASELINE_SOURCE_QUAD[2]);
  assert.equal(result.farLeft, ROOM_C_BASELINE_SOURCE_QUAD[3]);
  assert.deepEqual(result.asArray, ROOM_C_BASELINE_SOURCE_QUAD);

  const { homography } = solveRoomCHomography(ROOM_C_BASELINE_SOURCE_QUAD);
  assert.ok(homography);
});

test("Room C corrected NR remains NR despite appearing above FL", () => {
  assert.ok(ROOM_C_CORRECTED_SOURCE_QUAD[1].y < ROOM_C_CORRECTED_SOURCE_QUAD[3].y);

  const inspection = validateOrderedFloorCorners([...ROOM_C_CORRECTED_SOURCE_QUAD]);
  if (inspection.ok) {
    assert.equal(inspection.confidence, "high");
    assert.equal(inspection.note, undefined);
  }
  const result = valueOrThrow(inspection);
  assert.equal(result.nearLeft, ROOM_C_CORRECTED_SOURCE_QUAD[0]);
  assert.equal(result.nearRight, ROOM_C_CORRECTED_SOURCE_QUAD[1]);
  assert.equal(result.farRight, ROOM_C_CORRECTED_SOURCE_QUAD[2]);
  assert.equal(result.farLeft, ROOM_C_CORRECTED_SOURCE_QUAD[3]);
  assert.notDeepEqual(result.asArray, [
    ROOM_C_CORRECTED_SOURCE_QUAD[0],
    ROOM_C_CORRECTED_SOURCE_QUAD[3],
    ROOM_C_CORRECTED_SOURCE_QUAD[1],
    ROOM_C_CORRECTED_SOURCE_QUAD[2],
  ]);
  const { homography } = solveRoomCHomography(ROOM_C_CORRECTED_SOURCE_QUAD);
  const projectedInterior = applyInverseHomography(homography, { x: 0, y: 0 });
  assert.ok(projectedInterior);
  assert.ok(Number.isFinite(projectedInterior.x) && Number.isFinite(projectedInterior.y));
  assert.ok(Math.abs(projectedInterior.x) < 1e6 && Math.abs(projectedInterior.y) < 1e6);
});

test("Room C corrected quad remains truthfully ineligible for Apply", () => {
  const result = evaluateQuadSolvability({
    quadNorm: [...ROOM_C_CORRECTED_SOURCE_QUAD],
    frameSize: FRAME,
    floorDimensions: { worldWidth: 3, worldDepth: 4 },
    currentVerticalFovDeg: 48,
    fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
  });

  assert.deepEqual(result.orderedCornersNorm, ROOM_C_CORRECTED_SOURCE_QUAD);
  assert.equal(result.homographyAvailable, true);
  assert.ok(result.homographyMatrixForPlacement);
  assert.ok(result.fovScan.scan);
  assert.equal(result.applyEvaluation.available, false);
  assert.doesNotMatch(
    result.applyEvaluation.reason,
    /corner ordering|self-intersect|non-convex|bow.?tie/i,
    "refusal must arise from pose/reprojection geometry, not manufactured perimeter invalidity"
  );
});

test("quad solvability preserves bounded off-frame Floor pixels through homography and pose preparation", () => {
  const frame = { width: 800, height: 1000 };
  const cases = [
    {
      name: "one near corner below the frame",
      quad: [
        { x: 0.2, y: 1.1 },
        { x: 0.8, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "one far corner above the frame",
      quad: [
        { x: 0.2, y: 0.9 },
        { x: 0.8, y: 0.9 },
        { x: 0.7, y: -0.1 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "one corner left of the frame",
      quad: [
        { x: -0.1, y: 0.9 },
        { x: 0.8, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.1, y: 0.45 },
      ],
    },
    {
      name: "one corner right of the frame",
      quad: [
        { x: 0.2, y: 0.9 },
        { x: 1.1, y: 0.9 },
        { x: 0.9, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "two below-frame corners",
      quad: [
        { x: 0.2, y: 1.1 },
        { x: 0.8, y: 1.1 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "mixed in-frame and off-frame corners",
      quad: [
        { x: -0.1, y: 1.1 },
        { x: 1.1, y: 0.9 },
        { x: 0.8, y: 0.45 },
        { x: 0.2, y: 0.45 },
      ],
    },
    {
      name: "exact approved source extent limits",
      quad: [
        { x: -0.25, y: 1.25 },
        { x: 1.25, y: 1.25 },
        { x: 1, y: 0.25 },
        { x: 0, y: 0.25 },
      ],
    },
    {
      name: "ordinary in-frame quad",
      quad: [
        { x: 0.2, y: 0.9 },
        { x: 0.8, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
  ];

  for (const { name, quad } of cases) {
    const result = evaluateQuadSolvability({
      quadNorm: quad,
      frameSize: frame,
      floorDimensions: { worldWidth: 3, worldDepth: 4 },
      currentVerticalFovDeg: 48,
      fovScanConfig: { minFovDeg: 20, maxFovDeg: 22, stepDeg: 1 },
    });
    assert.ok(result.homographyAvailable, `${name}: homography must remain available`);
    assert.ok(result.homographyMatrixForPlacement, `${name}: homography matrix must be available`);
    assert.ok(result.imagePointsPx, `${name}: pose preparation must receive image points`);

    const expectedPixels = result.orderedCornersNorm?.map((point) => ({
      x: point.x * frame.width,
      y: point.y * frame.height,
    }));
    assert.deepEqual(result.imagePointsPx, expectedPixels, `${name}: pose inputs must retain exact pixel magnitude`);

    const expectedFloorPoints = result.floorPlanePoints2D;
    assert.ok(expectedFloorPoints, `${name}: floor-plane points must be available`);
    for (let index = 0; index < result.imagePointsPx.length; index += 1) {
      const projected = applyHomography(result.homographyMatrixForPlacement, result.imagePointsPx[index]);
      assert.ok(projected, `${name}: homography must map solver input corner ${index}`);
      assert.ok(Math.abs(projected.x - expectedFloorPoints[index].x) < 1e-7, `${name}: homography x ${index}`);
      assert.ok(Math.abs(projected.y - expectedFloorPoints[index].y) < 1e-7, `${name}: homography y ${index}`);
    }
  }
});

test("quad solvability retains fail-closed geometry gates for invalid Floor quads", () => {
  const invalidQuads = [
    {
      name: "non-finite point",
      quad: [
        { x: Number.NaN, y: 0.9 },
        { x: 0.8, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "duplicate point",
      quad: [
        { x: 0.2, y: 0.9 },
        { x: 0.2, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "nearly zero edge",
      quad: [
        { x: 0.2, y: 0.9 },
        { x: 0.2000001, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
    },
    {
      name: "nearly zero area",
      quad: [
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5000001 },
        { x: 0.7, y: 0.5000002 },
        { x: 0.3, y: 0.5000001 },
      ],
    },
    {
      name: "self-intersecting perimeter",
      quad: [
        { x: 0.2, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.8, y: 0.9 },
        { x: 0.3, y: 0.45 },
      ],
    },
  ];

  for (const { name, quad } of invalidQuads) {
    const result = evaluateQuadSolvability({
      quadNorm: quad,
      frameSize: { width: 800, height: 1000 },
      floorDimensions: { worldWidth: 3, worldDepth: 4 },
      currentVerticalFovDeg: 48,
      fovScanConfig: { minFovDeg: 20, maxFovDeg: 22, stepDeg: 1 },
    });
    assert.equal(result.homographyAvailable, false, `${name}: homography must remain unavailable`);
    assert.equal(result.poseAvailable, false, `${name}: pose must remain unavailable`);
    assert.equal(result.applyEvaluation.available, false, `${name}: apply must remain unavailable`);
  }

  const floorRect = valueOrThrow(getFloorRectCorners({ widthMeters: 3, depthMeters: 4 }));
  const singular = solvePlaneHomography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    floorRect.asArray.map(floorVec3ToPlane2D)
  );
  assert.equal(singular.ok, false, "singular homography input must remain rejected");
});

test("semantic self-crossing perimeter is rejected without repair", () => {
  const selfCrossing = [
    ROOM_C_BASELINE_SOURCE_QUAD[0],
    ROOM_C_BASELINE_SOURCE_QUAD[2],
    ROOM_C_BASELINE_SOURCE_QUAD[1],
    ROOM_C_BASELINE_SOURCE_QUAD[3],
  ];
  const result = validateOrderedFloorCorners(selfCrossing);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /self-intersects|non-convex/);
});

test("unlabelled provider input is canonicalized once into a cyclic semantic quad", () => {
  const unlabelled = [
    ROOM_C_BASELINE_SOURCE_QUAD[2],
    ROOM_C_BASELINE_SOURCE_QUAD[0],
    ROOM_C_BASELINE_SOURCE_QUAD[3],
    ROOM_C_BASELINE_SOURCE_QUAD[1],
  ];
  const result = valueOrThrow(canonicalizeUnlabelledFloorQuad(unlabelled));
  assert.deepEqual(result.asArray, ROOM_C_BASELINE_SOURCE_QUAD);
  assert.equal(validateOrderedFloorCorners(result.asArray).ok, true);
});

test("unlabelled canonicalization is always cyclic while semantic input is unchanged", () => {
  const perimeter = [
    { x: 0.2, y: 0.9 },
    { x: 0.8, y: 0.88 },
    { x: 0.68, y: 0.4 },
    { x: 0.3, y: 0.42 },
  ];
  const variants = [
    perimeter,
    [perimeter[1], perimeter[2], perimeter[3], perimeter[0]],
    [perimeter[0], perimeter[3], perimeter[2], perimeter[1]],
    [perimeter[2], perimeter[1], perimeter[0], perimeter[3]],
  ];

  for (const variant of variants) {
    const canonical = valueOrThrow(canonicalizeUnlabelledFloorQuad(variant));
    assert.ok(isCyclicPermutationOrReversal(canonical.asArray, perimeter));
  }

  const semantic = valueOrThrow(validateOrderedFloorCorners([...ROOM_C_CORRECTED_SOURCE_QUAD]));
  assert.equal(semantic.nearRight, ROOM_C_CORRECTED_SOURCE_QUAD[1]);
  assert.equal(semantic.farLeft, ROOM_C_CORRECTED_SOURCE_QUAD[3]);
});
