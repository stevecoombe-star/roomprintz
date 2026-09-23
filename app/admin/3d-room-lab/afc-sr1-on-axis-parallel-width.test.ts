import assert from "node:assert/strict";
import test from "node:test";
import { deriveAfcSr1OnAxisParallelWidthFloor } from "./afc-sr1-on-axis-parallel-width";

const roomA = [
  { x: 0.10837393593189963, y: 0.9249876495993743 },
  { x: 1, y: 0.93 },
  { x: 0.688, y: 0.648 },
  { x: 0.356, y: 0.648 },
] as const;

function cross(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>
): number {
  return first.x * second.y - first.y * second.x;
}

test("derives the audited Room A NL-fixed parallel-width result", () => {
  const result = deriveAfcSr1OnAxisParallelWidthFloor(roomA);
  assert.equal(result.status, "derived");
  if (result.status !== "derived") return;
  assert.equal(result.construction, "NL_fixed");
  assert.equal(result.adjustableCorner, "NR");
  assert.ok(Math.abs(result.correctedPolygon[1].x - 0.994454) < 1e-6);
  assert.ok(Math.abs(result.correctedPolygon[1].y - 0.924988) < 1e-6);
  assert.ok(Math.abs(result.constructionSeamT - 0.01777) < 1e-4);
  const nearDirection = {
    x: result.correctedPolygon[1].x - result.correctedPolygon[0].x,
    y: result.correctedPolygon[1].y - result.correctedPolygon[0].y,
  };
  const farDirection = {
    x: result.correctedPolygon[2].x - result.correctedPolygon[3].x,
    y: result.correctedPolygon[2].y - result.correctedPolygon[3].y,
  };
  assert.ok(Math.abs(cross(nearDirection, farDirection)) < 1e-9);
});

test("accepts an already-parallel trapezoid with zero adjustment", () => {
  const polygon = [
    { x: 0.08, y: 0.92 },
    { x: 0.92, y: 0.92 },
    { x: 0.7, y: 0.62 },
    { x: 0.3, y: 0.62 },
  ] as const;
  const result = deriveAfcSr1OnAxisParallelWidthFloor(polygon);
  assert.equal(result.status, "derived");
  if (result.status !== "derived") return;
  assert.equal(result.construction, "NL_fixed");
  assert.equal(result.constructionSeamT, 0);
  assert.deepEqual(result.correctedPolygon, polygon);
});

test("uses the deterministic NR-fixed fallback for mirrored Room A", () => {
  const mirrored = [
    { x: 1 - roomA[1].x, y: roomA[1].y },
    { x: 1 - roomA[0].x, y: roomA[0].y },
    { x: 1 - roomA[3].x, y: roomA[3].y },
    { x: 1 - roomA[2].x, y: roomA[2].y },
  ] as const;
  const result = deriveAfcSr1OnAxisParallelWidthFloor(mirrored);
  assert.equal(result.status, "derived");
  if (result.status !== "derived") return;
  assert.equal(result.construction, "NR_fixed");
  assert.equal(result.adjustableCorner, "NL");
  assert.ok(result.constructionSeamT > 0 && result.constructionSeamT < 1);
});

test("reports a collapsed far-width edge explicitly", () => {
  const result = deriveAfcSr1OnAxisParallelWidthFloor([
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.9 },
    { x: 0.5, y: 0.6 },
    { x: 0.5, y: 0.6 },
  ]);
  assert.deepEqual(result, {
    status: "rejected",
    derivationVersion: "afc-sr1-on-axis-parallel-width/v1",
    reason: "collapsed_far_width",
  });
});

test("fails closed when no legal side-seam intersection exists", () => {
  const result = deriveAfcSr1OnAxisParallelWidthFloor([
    { x: 0.1949561708494479, y: 0.823290451141031 },
    { x: 0.9068983425482975, y: 0.9072484680170072 },
    { x: 0.5527803538737814, y: 0.6566909918875623 },
    { x: 0.3594968591111618, y: 0.5199330025229518 },
  ]);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.reason, "no_legal_parallel_width_construction");
  }
});

test("rejects an invalid source quad without attempting correction", () => {
  const result = deriveAfcSr1OnAxisParallelWidthFloor([
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.9 },
    { x: 0.2, y: 0.6 },
    { x: 0.8, y: 0.6 },
  ]);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.reason, "invalid_source_polygon");
});
