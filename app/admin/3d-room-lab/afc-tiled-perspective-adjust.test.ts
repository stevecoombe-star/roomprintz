import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT,
  buildAfcTiledPerspectiveAdjustPolygon,
  clampAfcTiledPerspectiveDelta,
  computeAfcTiledPerspectiveAdjustmentRange,
  isValidAfcTiledPerspectivePolygon,
  type AfcTiledPerspectivePolygon,
} from "./afc-tiled-perspective-adjust";

const strongOffAxis = [
  { x: 0.08, y: 0.94 },
  { x: 0.94, y: 0.82 },
  { x: 0.7, y: 0.42 },
  { x: 0.26, y: 0.47 },
] as const satisfies AfcTiledPerspectivePolygon;

function build(polygon: AfcTiledPerspectivePolygon, delta: number) {
  const result = buildAfcTiledPerspectiveAdjustPolygon(polygon, delta);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("TILED adjustment did not construct.");
  return result;
}

test("zero TILED adjustment returns an exact copy of Automatic", () => {
  const result = build(strongOffAxis, 0);
  assert.deepEqual(result.sourceNormalizedPolygon, strongOffAxis);
  assert.notEqual(result.sourceNormalizedPolygon, strongOffAxis);
});

test("symmetric TILED adjustment moves both near corners on their Automatic rays only", () => {
  const result = build(strongOffAxis, 0.1).sourceNormalizedPolygon;
  assert.deepEqual(result[2], strongOffAxis[2]);
  assert.deepEqual(result[3], strongOffAxis[3]);
  const ratio = (result[0].x - strongOffAxis[3].x) /
    (strongOffAxis[0].x - strongOffAxis[3].x);
  const rightRatio = (result[1].y - strongOffAxis[2].y) /
    (strongOffAxis[1].y - strongOffAxis[2].y);
  assert.ok(Math.abs(ratio - 0.9) <= 1e-12);
  assert.ok(Math.abs(rightRatio - 0.9) <= 1e-12);
});

test("positive delta moves near corners toward far and negative moves away", () => {
  const positive = build(strongOffAxis, 0.1).sourceNormalizedPolygon;
  const negative = build(strongOffAxis, -0.1).sourceNormalizedPolygon;
  const distance = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    Math.hypot(from.x - to.x, from.y - to.y);
  assert.ok(distance(positive[0], strongOffAxis[3]) < distance(strongOffAxis[0], strongOffAxis[3]));
  assert.ok(distance(negative[1], strongOffAxis[2]) > distance(strongOffAxis[1], strongOffAxis[2]));
});

test("computed range preserves convex valid geometry at both endpoints", () => {
  const range = computeAfcTiledPerspectiveAdjustmentRange(strongOffAxis);
  assert.ok(range?.usable);
  assert.equal(range?.minDelta, -AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT);
  assert.equal(range?.maxDelta, AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT);
  assert.equal(isValidAfcTiledPerspectivePolygon(build(strongOffAxis, range!.minDelta).sourceNormalizedPolygon), true);
  assert.equal(isValidAfcTiledPerspectivePolygon(build(strongOffAxis, range!.maxDelta).sourceNormalizedPolygon), true);
});

test("on-axis and narrow lattice-style quads retain valid symmetric travel", () => {
  const cases: readonly AfcTiledPerspectivePolygon[] = [
    [
      { x: 0.1, y: 0.85 }, { x: 0.9, y: 0.85 },
      { x: 0.8, y: 0.4 }, { x: 0.2, y: 0.4 },
    ],
    [
      { x: 0.45, y: 0.92 }, { x: 0.55, y: 0.9 },
      { x: 0.54, y: 0.38 }, { x: 0.46, y: 0.4 },
    ],
    [
      { x: 0.03, y: 0.88 }, { x: 0.97, y: 0.84 },
      { x: 0.94, y: 0.6 }, { x: 0.06, y: 0.62 },
    ],
  ];
  for (const polygon of cases) {
    const range = computeAfcTiledPerspectiveAdjustmentRange(polygon);
    assert.ok(range?.usable);
    assert.equal(isValidAfcTiledPerspectivePolygon(build(polygon, range!.minDelta).sourceNormalizedPolygon), true);
    assert.equal(isValidAfcTiledPerspectivePolygon(build(polygon, range!.maxDelta).sourceNormalizedPolygon), true);
  }
});

test("range-aware clamp never returns invalid slider travel", () => {
  const range = { minDelta: -0.03, maxDelta: 0.08, usable: true } as const;
  assert.equal(clampAfcTiledPerspectiveDelta(-1, range), -0.03);
  assert.equal(clampAfcTiledPerspectiveDelta(1, range), 0.08);
  assert.equal(clampAfcTiledPerspectiveDelta(0.02, range), 0.02);
  assert.equal(clampAfcTiledPerspectiveDelta(0, { ...range, usable: false }), null);
});
