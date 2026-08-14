import assert from "node:assert/strict";
import test from "node:test";
import { ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE } from "./afc-lab-geometry-candidate";
import {
  compareAfcFixedSeamCalibrationCells,
  settleAfcFixedSeamCalibration,
} from "./afc-fixed-seam-calibration";
import type { RatioFovSuccessfulCell } from "./research/ratio-fov-harness";

function roomCInput() {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) throw new Error("Room C fixture did not parse.");
  const candidate = ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
  return {
    sourceNormalizedPolygon: candidate.sourceNormalizedPolygon,
    sourceImageSize: {
      width: candidate.acceptanceBasis.decodedWidth,
      height: candidate.acceptanceBasis.decodedHeight,
    },
    frameSize: { width: 1118, height: 698 },
    referenceDepthM: candidate.referenceDepthM,
  };
}

test("fixed-seam calibration is deterministic and maps ratio to explicit Room C metric depth", () => {
  const first = settleAfcFixedSeamCalibration(roomCInput());
  const second = settleAfcFixedSeamCalibration(roomCInput());
  assert.deepEqual(second, first);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.widthDepthRatio, 1.155);
  assert.equal(first.referenceDepthM, 4);
  assert.equal(first.worldWidthM, 4.62);
  assert.equal(first.worldDepthM, 4);
  assert.equal(first.verticalFovDeg, 78.4);
  assert.ok(first.applyObservability.available);
  assert.equal(first.winningCellId, "ratio=1.155;fov=78.4");
  assert.ok(Math.abs(first.applyObservability.displayAvgPx - 0.348687) < 0.001);
  assert.ok(Math.abs(first.applyObservability.displayMaxPx - 0.699020) < 0.001);
});

function rankingCell(input: {
  available: boolean;
  confidence: "high" | "low";
  cvAvgPx: number;
  cvMaxPx: number;
  fovDeg: number;
  ratio: number;
}): RatioFovSuccessfulCell {
  return {
    status: "success",
    ratio: input.ratio,
    fovDeg: input.fovDeg,
    confidence: input.confidence,
    cvAvgPx: input.cvAvgPx,
    cvMaxPx: input.cvMaxPx,
    applyObservability: {
      available: input.available,
      firstFailingGate: input.available ? "none" : "residual",
      reason: input.available ? "available" : "residual",
      displayAvgPx: input.cvAvgPx,
      displayMaxPx: input.cvMaxPx,
      averageDeltaPx: input.cvAvgPx,
      maximumDeltaPx: input.cvMaxPx,
    },
  } as RatioFovSuccessfulCell;
}

test("fixed-seam ranking prefers an Apply-safe candidate over a lower-residual Apply-unsafe candidate", () => {
  const applySafe = rankingCell({
    available: true,
    confidence: "high",
    cvAvgPx: 0.4,
    cvMaxPx: 0.8,
    fovDeg: 78.4,
    ratio: 1.155,
  });
  const applyUnsafeLowerResidual = rankingCell({
    available: false,
    confidence: "high",
    cvAvgPx: 0.1,
    cvMaxPx: 0.2,
    fovDeg: 78.3,
    ratio: 1.15,
  });
  assert.ok(compareAfcFixedSeamCalibrationCells(applySafe, applyUnsafeLowerResidual) < 0);
  assert.equal(
    [applyUnsafeLowerResidual, applySafe].sort(compareAfcFixedSeamCalibrationCells)[0],
    applySafe
  );
});

test("fixed-seam settle fails closed when no metric-domain candidate can be evaluated", () => {
  const result = settleAfcFixedSeamCalibration({
    ...roomCInput(),
    ratioSearch: { min: 3.1, max: 3.1, step: 0.1 },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "no_apply_safe_candidate",
    evaluatedCellCount: 0,
    applySafeCellCount: 0,
  });
});

test("fixed-seam settle rejects an invalid source polygon without moving a seam", () => {
  const input = roomCInput();
  const result = settleAfcFixedSeamCalibration({
    ...input,
    sourceNormalizedPolygon: [
      input.sourceNormalizedPolygon[0],
      input.sourceNormalizedPolygon[0],
      input.sourceNormalizedPolygon[2],
      input.sourceNormalizedPolygon[3],
    ],
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "invalid_polygon",
    evaluatedCellCount: 0,
    applySafeCellCount: 0,
  });
});
