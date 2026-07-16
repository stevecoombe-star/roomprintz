import assert from "node:assert/strict";
import test from "node:test";

import type { ManualPhysicalSeam } from "./manual-floor-support-types";
import {
  buildUsableSeam,
  checkCoupledSeamConstraints,
  distanceToUsableSeamSourcePx,
  gateTrialQuad,
  isNearFrameEdge,
  nearestPointOnUsableSeam,
  pointAtArcPx,
  pointAtT,
  separationSourcePx,
  sourceToContainerForTrial,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./manual-floor-support-trial-geometry";
import type { TrialQuadNorm } from "./manual-floor-support-trial-types";

const INTRINSIC: ImageIntrinsicSize = { width: 1000, height: 1000 };

function straightSeam(): ManualPhysicalSeam {
  return {
    id: "seam-1",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.0, y: 0.5 },
      { x: 0.6, y: 0.5 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 1 },
    corridor: { halfWidthSourcePx: 6 },
  };
}

function bentSeam(): ManualPhysicalSeam {
  return {
    id: "seam-bent",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.0, y: 0.5 },
      { x: 0.3, y: 0.5 },
      { x: 0.3, y: 0.8 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 2 },
    corridor: { halfWidthSourcePx: 6 },
  };
}

// Canonical [NL, NR, FR, FL], y-down (near corners have larger y).
const BASELINE: TrialQuadNorm = [
  { x: 0.2, y: 0.8 },
  { x: 0.8, y: 0.8 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.3 },
];

test("buildUsableSeam computes source-pixel arc length", () => {
  const usable = buildUsableSeam(straightSeam(), INTRINSIC);
  assert.ok(usable);
  assert.ok(Math.abs(usable.totalArcPx - 600) < 1e-6);
});

test("buildUsableSeam returns null for invalid span / dims", () => {
  assert.equal(buildUsableSeam(straightSeam(), { width: 0, height: 0 }), null);
  const bad = straightSeam();
  bad.usableSpan = { startVertexIndex: 1, endVertexIndex: 0 };
  assert.equal(buildUsableSeam(bad, INTRINSIC), null);
});

test("pointAtT maps by arc length on a straight seam", () => {
  const usable = buildUsableSeam(straightSeam(), INTRINSIC)!;
  const mid = pointAtT(usable, 0.5);
  assert.ok(Math.abs(mid.x - 0.3) < 1e-9);
  assert.ok(Math.abs(mid.y - 0.5) < 1e-9);
});

test("pointAtArcPx supports bent multi-segment polylines", () => {
  const usable = buildUsableSeam(bentSeam(), INTRINSIC)!;
  assert.ok(Math.abs(usable.totalArcPx - 600) < 1e-6);
  const p = pointAtArcPx(usable, 450); // 150 px into the 2nd (vertical) segment
  assert.ok(Math.abs(p.x - 0.3) < 1e-9);
  assert.ok(Math.abs(p.y - 0.65) < 1e-9);
});

test("nearestPointOnUsableSeam projects in source-pixel space", () => {
  const usable = buildUsableSeam(straightSeam(), INTRINSIC)!;
  const near = nearestPointOnUsableSeam(usable, { x: 0.3, y: 0.6 });
  assert.ok(Math.abs(near.pointSourceNorm.x - 0.3) < 1e-9);
  assert.ok(Math.abs(near.pointSourceNorm.y - 0.5) < 1e-9);
  assert.ok(Math.abs(near.distanceSourcePx - 100) < 1e-6); // 0.1 * 1000
});

test("distanceToUsableSeamSourcePx + separationSourcePx are source-pixel measures (corridor compliance)", () => {
  const usable = buildUsableSeam(straightSeam(), INTRINSIC)!;
  assert.ok(distanceToUsableSeamSourcePx(usable, { x: 0.5, y: 0.5 }) < 1e-6);
  assert.ok(Math.abs(distanceToUsableSeamSourcePx(usable, { x: 0.5, y: 0.51 }) - 10) < 1e-6);
  assert.ok(Math.abs(separationSourcePx(usable, 0.0, 1.0) - 600) < 1e-6);
});

test("gateTrialQuad accepts the baseline quad", () => {
  const status = gateTrialQuad({ quad: BASELINE, baselineQuad: BASELINE, changedCornerIndices: [] });
  assert.equal(status.canEvaluate, true, status.hardReasons.join(" | "));
});

test("gateTrialQuad hard-rejects fixed-corner mutation", () => {
  const moved: TrialQuadNorm = [
    { x: 0.25, y: 0.8 }, // NL changed but not permitted
    BASELINE[1],
    BASELINE[2],
    BASELINE[3],
  ];
  const status = gateTrialQuad({ quad: moved, baselineQuad: BASELINE, changedCornerIndices: [3] });
  assert.equal(status.canEvaluate, false);
  assert.ok(status.hardReasons.some((r) => /fixed corner/.test(r)));
});

test("gateTrialQuad hard-rejects self-intersecting / non-convex quads", () => {
  const bowtie: TrialQuadNorm = [
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.3, y: 0.3 }, // FR and FL swapped -> crossing
    { x: 0.7, y: 0.3 },
  ];
  const status = gateTrialQuad({ quad: bowtie, baselineQuad: BASELINE, changedCornerIndices: [2, 3] });
  assert.equal(status.canEvaluate, false);
});

test("gateTrialQuad hard-rejects degenerate (near-zero area) quads", () => {
  const tiny: TrialQuadNorm = [
    { x: 0.5, y: 0.5 },
    { x: 0.51, y: 0.5 },
    { x: 0.51, y: 0.505 },
    { x: 0.5, y: 0.505 },
  ];
  const status = gateTrialQuad({ quad: tiny, baselineQuad: tiny, changedCornerIndices: [0, 1, 2, 3] });
  assert.equal(status.canEvaluate, false);
  assert.ok(status.hardReasons.some((r) => /area/.test(r)));
});

test("gateTrialQuad hard-rejects orientation flip against baseline", () => {
  const reversed: TrialQuadNorm = [BASELINE[3], BASELINE[2], BASELINE[1], BASELINE[0]];
  const status = gateTrialQuad({
    quad: reversed,
    baselineQuad: BASELINE,
    changedCornerIndices: [0, 1, 2, 3],
  });
  assert.equal(status.canEvaluate, false);
});

test("checkCoupledSeamConstraints flags collapse and inversion", () => {
  const ok = checkCoupledSeamConstraints({
    arcFL: 100,
    arcFR: 500,
    baselineArcFL: 100,
    baselineArcFR: 500,
    minSeparationSourcePx: 8,
    maxRelativeAlongSeamDeltaSourcePx: 12,
  });
  assert.equal(ok.canEvaluate, true);

  const collapsed = checkCoupledSeamConstraints({
    arcFL: 300,
    arcFR: 303,
    baselineArcFL: 100,
    baselineArcFR: 500,
    minSeparationSourcePx: 8,
    maxRelativeAlongSeamDeltaSourcePx: 12,
  });
  assert.equal(collapsed.canEvaluate, false);

  const inverted = checkCoupledSeamConstraints({
    arcFL: 500,
    arcFR: 100,
    baselineArcFL: 100,
    baselineArcFR: 500,
    minSeparationSourcePx: 8,
    maxRelativeAlongSeamDeltaSourcePx: 12,
  });
  assert.equal(inverted.canEvaluate, false);
});

test("isNearFrameEdge + diagnostic conversion: off-frame vs near-edge classification", () => {
  // Short frame crops the top/bottom, pushing low source-y off the frame.
  const shortFrame: ImageFrameSize = { width: 1000, height: 400 };
  const offFrame = sourceToContainerForTrial({ x: 0.5, y: 0.1 }, INTRINSIC, shortFrame);
  assert.ok(offFrame);
  assert.equal(offFrame.visibleInFrame, false);

  const inFrame = sourceToContainerForTrial({ x: 0.5, y: 0.5 }, INTRINSIC, shortFrame);
  assert.ok(inFrame);
  assert.equal(inFrame.visibleInFrame, true);

  assert.equal(isNearFrameEdge({ x: 0.5, y: 0.005 }), true);
  assert.equal(isNearFrameEdge({ x: 0.5, y: 0.5 }), false);
});
