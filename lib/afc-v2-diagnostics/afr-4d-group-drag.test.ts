import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOOR_SOURCE_COORDINATE_MAX,
  FLOOR_SOURCE_COORDINATE_MIN,
} from "@/app/admin/3d-room-lab/floor-coordinate-extent";
import {
  MANUAL_PERSPECTIVE_CORNERS,
  imagePointsEqual,
  manualPerspectiveBootstrapQuad,
  manualPerspectiveDragTarget,
  translateManualPerspectiveImagePoints,
  type ManualPerspectiveImagePoints,
} from "./manual-perspective-geometry";
import {
  commitManualPerspectiveSolve,
  editManualPerspectiveImagePoints,
  editManualPerspectivePoint,
  manualPerspectiveApplyAllowed,
  manualPerspectiveRecoveryAllowed,
  revertManualPerspectiveSession,
  type ManualPerspectiveSession,
} from "./manual-perspective";
import {
  solveManualPerspectiveCalibration,
  type ManualPerspectiveSolveResult,
} from "./manual-perspective-solve";

const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const RESTORED = Object.freeze({
  NL: Object.freeze({ x: 0.1, y: 0.9 }),
  NR: Object.freeze({ x: 0.9, y: 0.9 }),
  FR: Object.freeze({ x: 0.65, y: 0.55 }),
  FL: Object.freeze({ x: 0.35, y: 0.55 }),
});

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
}

function assertSameShape(
  moved: ManualPerspectiveImagePoints,
  start: ManualPerspectiveImagePoints,
) {
  for (const left of MANUAL_PERSPECTIVE_CORNERS) {
    for (const right of MANUAL_PERSPECTIVE_CORNERS) {
      close(moved[left].x - moved[right].x, start[left].x - start[right].x);
      close(moved[left].y - moved[right].y, start[left].y - start[right].y);
    }
  }
}

function session(
  mode: ManualPerspectiveSession["mode"],
  opened: ManualPerspectiveImagePoints,
): ManualPerspectiveSession {
  return {
    baseGenerationId: GENERATION_ID,
    automaticPoints: mode === "adjust" ? opened : manualPerspectiveBootstrapQuad(),
    openedPoints: opened,
    imagePoints: opened,
    sourceImageSize: { width: 1200, height: 800 },
    frameSize: { width: 1200, height: 800 },
    referenceDepthM: 4,
    baselineFovDeg: mode === "adjust" ? 50 : 0,
    mode,
    runtime: mode === "adjust" ? "overlay" : "diagnostic_only",
    status: "converged",
    solveRequestId: 2,
    solution: null,
  };
}

function solvedResult(
  points: ManualPerspectiveImagePoints,
  status: ManualPerspectiveSolveResult["status"] = "converged",
): ManualPerspectiveSolveResult {
  return {
    status,
    imagePoints: points,
    worldRectangle: null,
    verticalFovDeg: status === "converged" ? 50 : null,
    pose: null,
    objectivePx: 1,
    iterationCount: 3,
    convergenceReason: "ok",
    elapsedMs: 4,
    applySafe: false,
  };
}

test("a group delta translates every corner and keeps pairwise offsets", () => {
  const start = manualPerspectiveBootstrapQuad();
  const moved = translateManualPerspectiveImagePoints(start, 0.05, -0.03);
  close(moved.NL.x, 0.27);
  close(moved.NL.y, 0.87);
  close(moved.NR.x, 0.83);
  close(moved.NR.y, 0.87);
  close(moved.FR.x, 0.69);
  close(moved.FR.y, 0.55);
  close(moved.FL.x, 0.41);
  close(moved.FL.y, 0.55);
  assertSameShape(moved, start);
});

test("a corner hit is not a group drag, and the interior and exterior are distinct", () => {
  const quad = manualPerspectiveBootstrapQuad();
  assert.equal(manualPerspectiveDragTarget(quad.NL, quad), "NL");
  assert.equal(manualPerspectiveDragTarget({ x: quad.NL.x + 0.01, y: quad.NL.y }, quad), "NL");
  assert.equal(manualPerspectiveDragTarget({ x: 0.5, y: 0.74 }, quad), "body");
  assert.equal(manualPerspectiveDragTarget({ x: 0.5, y: 0.9 }, quad), "body");
  assert.equal(manualPerspectiveDragTarget({ x: 0.5, y: 0.2 }, quad), "outside");
  assert.equal(manualPerspectiveDragTarget({ x: 0.05, y: 0.74 }, quad), "outside");

  const opened = session("adjust", quad);
  const corner = editManualPerspectivePoint(opened, "NL", 0.3, 0.88);
  assert.equal(corner.imagePoints.NL.x, 0.3);
  assert.equal(corner.imagePoints.NR.x, quad.NR.x);
  assert.equal(corner.imagePoints.FR.y, quad.FR.y);
  assert.equal(corner.imagePoints.FL.x, quad.FL.x);
  assert.equal(corner.solveRequestId, opened.solveRequestId + 1);
  const outsideCorner = editManualPerspectivePoint(opened, "NR", 2, 0.4);
  assert.equal(outsideCorner.imagePoints.NR.x, 2);
  assert.equal(outsideCorner.imagePoints.NL.x, quad.NL.x);
});

test("translation near the source extent clamps the shared delta and does not reshape", () => {
  const near = {
    NL: { x: 0.9, y: 0.4 },
    NR: { x: 1.14, y: 0.4 },
    FR: { x: 1.02, y: 0.2 },
    FL: { x: 0.78, y: 0.2 },
  } as const;
  const moved = translateManualPerspectiveImagePoints(near, 0.2, -0.04);
  const appliedX = moved.NR.x - near.NR.x;
  close(appliedX, 0.11);
  close(Math.max(moved.NL.x, moved.NR.x, moved.FR.x, moved.FL.x), FLOOR_SOURCE_COORDINATE_MAX);
  for (const corner of MANUAL_PERSPECTIVE_CORNERS) {
    close(moved[corner].x - near[corner].x, appliedX);
    close(moved[corner].y - near[corner].y, -0.04);
  }
  assertSameShape(moved, near);

  const outside = {
    NL: { x: 1.3, y: 0.2 },
    NR: { x: 1.4, y: 0.2 },
    FR: { x: 1.4, y: 0.4 },
    FL: { x: 1.3, y: 0.4 },
  } as const;
  assert.ok(outside.NR.x > FLOOR_SOURCE_COORDINATE_MAX);
  assert.ok(FLOOR_SOURCE_COORDINATE_MIN < 0);
  const shifted = translateManualPerspectiveImagePoints(outside, 0.05, 0.02);
  for (const corner of MANUAL_PERSPECTIVE_CORNERS) {
    close(shifted[corner].x - outside[corner].x, 0.05);
    close(shifted[corner].y - outside[corner].y, 0.02);
  }
});

test("one group update schedules one solve and a completed solve does not move the quad", () => {
  const opened = session("bootstrap", manualPerspectiveBootstrapQuad());
  const translated = translateManualPerspectiveImagePoints(opened.imagePoints, 0.05, -0.03);
  const moved = editManualPerspectiveImagePoints(opened, translated);
  assert.equal(moved.solveRequestId, opened.solveRequestId + 1);
  assert.equal(moved.status, "solving");
  assert.equal(imagePointsEqual(moved.imagePoints, translated), true);
  assert.equal(manualPerspectiveApplyAllowed(moved), false);
  assert.equal(manualPerspectiveRecoveryAllowed(moved, true), false);

  let corners = opened;
  for (const corner of MANUAL_PERSPECTIVE_CORNERS) {
    const point = corners.imagePoints[corner];
    corners = editManualPerspectivePoint(corners, corner, point.x + 0.01, point.y);
  }
  assert.equal(corners.solveRequestId, opened.solveRequestId + MANUAL_PERSPECTIVE_CORNERS.length);

  const stale = commitManualPerspectiveSolve(
    moved,
    moved.solveRequestId - 1,
    solvedResult(moved.imagePoints),
  );
  assert.equal(stale, moved);
  const mismatched = commitManualPerspectiveSolve(
    moved,
    moved.solveRequestId,
    solvedResult(opened.imagePoints),
  );
  assert.equal(mismatched, moved);

  const solved = solveManualPerspectiveCalibration({
    imagePoints: moved.imagePoints,
    sourceImageSize: moved.sourceImageSize,
    frameSize: moved.frameSize,
    referenceDepthM: moved.referenceDepthM,
  });
  assert.equal(imagePointsEqual(solved.imagePoints, moved.imagePoints), true);
  const completed = commitManualPerspectiveSolve(moved, moved.solveRequestId, solved);
  assert.equal(completed.status, solved.status);
  assert.equal(imagePointsEqual(completed.imagePoints, moved.imagePoints), true);
  assert.notEqual(completed.imagePoints, solved.imagePoints);
});

test("group drag reverts to the opened baseline in every manual mode", () => {
  const existing = session("adjust", manualPerspectiveBootstrapQuad());
  const bootstrap = session("bootstrap", manualPerspectiveBootstrapQuad());
  const restored = session("bootstrap", RESTORED);
  for (const opened of [existing, bootstrap, restored]) {
    const moved = editManualPerspectiveImagePoints(
      opened,
      translateManualPerspectiveImagePoints(opened.imagePoints, 0.05, -0.03),
    );
    assert.equal(imagePointsEqual(moved.imagePoints, opened.openedPoints), false);
    const reverted = revertManualPerspectiveSession(moved);
    assert.equal(imagePointsEqual(reverted.imagePoints, opened.openedPoints), true);
    assert.equal(reverted.mode, opened.mode);
  }
  assert.equal(imagePointsEqual(restored.openedPoints, manualPerspectiveBootstrapQuad()), false);
});
