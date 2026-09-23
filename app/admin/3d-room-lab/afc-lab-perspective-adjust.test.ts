import assert from "node:assert/strict";
import test from "node:test";
import controlFixture from "./research/fixtures/afc-sr1-room-c-lab-apply-control.v1.json";
import { settleAfcFixedSeamCalibration } from "./afc-fixed-seam-calibration";
import {
  buildAfcLabGeometryCandidate,
  ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE,
} from "./afc-lab-geometry-candidate";
import {
  AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT,
  buildAfcPerspectiveAdjustCandidate,
  shouldInvalidateAfcPerspectiveSessionForFloorCommit,
} from "./afc-lab-perspective-adjust";

function roomC() {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) throw new Error("Room C fixture did not parse.");
  return ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function adjusted(delta: number) {
  const candidate = roomC();
  const result = buildAfcPerspectiveAdjustCandidate({
    rawSourceNormalizedPolygon: candidate.rawSourceNormalizedPolygon,
    baselineSeamT: candidate.baselineSeamT,
    requestedDeltaSeamT: delta,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Room C Perspective candidate did not construct.");
  return result.candidate;
}

function settle(delta: number) {
  const candidate = roomC();
  const perspective = adjusted(delta);
  return settleAfcFixedSeamCalibration({
    sourceNormalizedPolygon: perspective.sourceNormalizedPolygon,
    sourceImageSize: {
      width: candidate.acceptanceBasis.decodedWidth,
      height: candidate.acceptanceBasis.decodedHeight,
    },
    frameSize: { width: 1118, height: 698 },
    referenceDepthM: candidate.referenceDepthM,
  });
}

test("zero Perspective Adjust reconstructs the automatic AFC baseline polygon exactly", () => {
  const candidate = roomC();
  const perspective = adjusted(0);
  assert.equal(perspective.candidateSeamT, candidate.baselineSeamT);
  assert.equal(perspective.committedDeltaSeamT, 0);
  assert.deepEqual(perspective.sourceNormalizedPolygon, candidate.sourceNormalizedPolygon);
});

test("Perspective Adjust moves only NR along the established NR to FR seam", () => {
  const candidate = roomC();
  const negative = adjusted(-0.05);
  const positive = adjusted(0.05);
  for (const perspective of [negative, positive]) {
    assert.deepEqual(perspective.sourceNormalizedPolygon[0], candidate.rawSourceNormalizedPolygon[0]);
    assert.deepEqual(perspective.sourceNormalizedPolygon[2], candidate.rawSourceNormalizedPolygon[2]);
    assert.deepEqual(perspective.sourceNormalizedPolygon[3], candidate.rawSourceNormalizedPolygon[3]);
  }
  assert.ok(negative.candidateSeamT < candidate.baselineSeamT);
  assert.ok(positive.candidateSeamT > candidate.baselineSeamT);
});

test("live right-near Perspective Adjust moves only NL along NL to FL", () => {
  const candidate = roomC();
  const raw = [
    { x: 1 - candidate.rawSourceNormalizedPolygon[1].x, y: candidate.rawSourceNormalizedPolygon[1].y },
    { x: 1 - candidate.rawSourceNormalizedPolygon[0].x, y: candidate.rawSourceNormalizedPolygon[0].y },
    { x: 1 - candidate.rawSourceNormalizedPolygon[3].x, y: candidate.rawSourceNormalizedPolygon[3].y },
    { x: 1 - candidate.rawSourceNormalizedPolygon[2].x, y: candidate.rawSourceNormalizedPolygon[2].y },
  ] as const;
  const result = buildAfcPerspectiveAdjustCandidate({
    rawSourceNormalizedPolygon: raw,
    baselineSeamT: candidate.baselineSeamT,
    requestedDeltaSeamT: 0.01,
    adjustableCorner: "NL",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidate.adjustableCorner, "NL");
  assert.notDeepEqual(result.candidate.sourceNormalizedPolygon[0], raw[0]);
  assert.deepEqual(result.candidate.sourceNormalizedPolygon[1], raw[1]);
  assert.deepEqual(result.candidate.sourceNormalizedPolygon[2], raw[2]);
  assert.deepEqual(result.candidate.sourceNormalizedPolygon[3], raw[3]);
});

test("Perspective Adjust clamps the engineering UX delta range", () => {
  const candidate = roomC();
  const positive = adjusted(1);
  const negative = adjusted(-1);
  assert.equal(positive.committedDeltaSeamT, AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT);
  assert.equal(negative.committedDeltaSeamT, -AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT);
  assert.equal(positive.candidateSeamT, candidate.baselineSeamT + AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT);
  assert.equal(negative.candidateSeamT, candidate.baselineSeamT - AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT);
});

test("Perspective Adjust rejects exclusive seam endpoints and malformed source polygons", () => {
  const candidate = roomC();
  assert.deepEqual(
    buildAfcPerspectiveAdjustCandidate({
      rawSourceNormalizedPolygon: candidate.rawSourceNormalizedPolygon,
      baselineSeamT: 0.95,
      requestedDeltaSeamT: 0.05,
    }),
    { ok: false, reason: "candidate_seam_out_of_domain" }
  );
  assert.deepEqual(
    buildAfcPerspectiveAdjustCandidate({
      rawSourceNormalizedPolygon: [{ x: 0, y: 0 }] as unknown,
      baselineSeamT: candidate.baselineSeamT,
      requestedDeltaSeamT: 0,
    }),
    { ok: false, reason: "source_polygon_invalid" }
  );
});

test("Perspective construction is deterministic and has no C-P04/P90 input", () => {
  const first = adjusted(0.02);
  const second = adjusted(0.02);
  assert.deepEqual(second, first);
  assert.equal("validationP90Px" in first, false);
});

test("changing the C-P04 P90 sidecar cannot affect a Perspective candidate or settle", () => {
  const changedControl = clone(controlFixture);
  changedControl.diagnosticControls["C-P04"].validationP90Px = 0.01;
  const baseline = buildAfcLabGeometryCandidate(controlFixture);
  const changed = buildAfcLabGeometryCandidate(changedControl);
  assert.equal(baseline.ok, true);
  assert.equal(changed.ok, true);
  if (!baseline.ok || !changed.ok) return;
  const build = (candidate: typeof baseline.candidate) =>
    buildAfcPerspectiveAdjustCandidate({
      rawSourceNormalizedPolygon: candidate.rawSourceNormalizedPolygon,
      baselineSeamT: candidate.baselineSeamT,
      requestedDeltaSeamT: 0.03,
    });
  const baselinePerspective = build(baseline.candidate);
  const changedPerspective = build(changed.candidate);
  assert.equal(baselinePerspective.ok, true);
  assert.equal(changedPerspective.ok, true);
  if (!baselinePerspective.ok || !changedPerspective.ok) return;
  assert.deepEqual(changedPerspective.candidate, baselinePerspective.candidate);
  const settleInput = (candidate: typeof baseline.candidate, sourceNormalizedPolygon: typeof baselinePerspective.candidate.sourceNormalizedPolygon) => ({
    sourceNormalizedPolygon,
    sourceImageSize: {
      width: candidate.acceptanceBasis.decodedWidth,
      height: candidate.acceptanceBasis.decodedHeight,
    },
    frameSize: { width: 1118, height: 698 },
    referenceDepthM: candidate.referenceDepthM,
  });
  assert.deepEqual(
    settleAfcFixedSeamCalibration(settleInput(changed.candidate, changedPerspective.candidate.sourceNormalizedPolygon)),
    settleAfcFixedSeamCalibration(settleInput(baseline.candidate, baselinePerspective.candidate.sourceNormalizedPolygon))
  );
});

test("neutral Perspective Adjust settles to the committed automatic Room C control", () => {
  const result = settle(0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.widthDepthRatio, 1.155);
  assert.equal(result.worldWidthM, 4.62);
  assert.equal(result.worldDepthM, 4);
  assert.equal(result.verticalFovDeg, 78.4);
  assert.equal(result.winningCellId, "ratio=1.155;fov=78.4");
  assert.equal(result.applyObservability.available, true);
});

test("Perspective direction controls produce Apply-safe lower and higher settles", () => {
  const negative = settle(-0.05);
  const neutral = settle(0);
  const positive = settle(0.05);
  assert.equal(negative.ok, true);
  assert.equal(neutral.ok, true);
  assert.equal(positive.ok, true);
  if (!negative.ok || !neutral.ok || !positive.ok) return;
  assert.equal(negative.applyObservability.available, true);
  assert.equal(positive.applyObservability.available, true);
  assert.deepEqual(
    {
      width: negative.worldWidthM,
      depth: negative.worldDepthM,
      fov: negative.verticalFovDeg,
      winningCell: negative.winningCellId,
    },
    { width: 4.2, depth: 4, fov: 70.2, winningCell: "ratio=1.050;fov=70.2" }
  );
  assert.deepEqual(
    {
      width: positive.worldWidthM,
      depth: positive.worldDepthM,
      fov: positive.verticalFovDeg,
      winningCell: positive.winningCellId,
    },
    { width: 5.1, depth: 4, fov: 88.1, winningCell: "ratio=1.275;fov=88.1" }
  );
});

test("manual Floor authority commits invalidate Perspective sessions while intended commits preserve them", () => {
  assert.equal(shouldInvalidateAfcPerspectiveSessionForFloorCommit(), true);
  assert.equal(shouldInvalidateAfcPerspectiveSessionForFloorCommit({ preservePerspectiveSession: false }), true);
  assert.equal(shouldInvalidateAfcPerspectiveSessionForFloorCommit({ preservePerspectiveSession: true }), false);
});
