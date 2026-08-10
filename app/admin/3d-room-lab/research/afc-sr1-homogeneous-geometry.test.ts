import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_SR1_HOMOGENEOUS_EPSILON,
  euclideanizeFinitePoint,
  finitePointToHomogeneous,
  intersectLines,
  isFiniteHomogeneousPoint,
  lineThroughPoints,
  normalizeCanonicalLine,
  normalizePointForDiagnostics,
} from "./afc-sr1-homogeneous-geometry";

test("canonical line normalization makes opposite homogeneous scales identical", () => {
  const first = normalizeCanonicalLine({ a: 3, b: -4, c: 10 });
  const second = normalizeCanonicalLine({ a: -21, b: 28, c: -70 });
  const tinyScale = normalizeCanonicalLine({ a: 3e-20, b: -4e-20, c: 1e-19 });

  assert.deepEqual(first, second);
  assert.ok(first);
  assert.ok(tinyScale);
  assert.ok(Math.abs(first.a - tinyScale.a) < 1e-15);
  assert.ok(Math.abs(first.b - tinyScale.b) < 1e-15);
  assert.ok(Math.abs(first.c - tinyScale.c) < 1e-15);
  assert.ok(Math.abs(Math.hypot(first.a, first.b) - 1) < 1e-15);
  assert.ok(first.b > 0);
  assert.ok(Object.isFrozen(first));
});

test("homogeneous cross products preserve a line through a finite point and infinity", () => {
  const anchor = finitePointToHomogeneous({ x: 0.2, y: 0.8 });
  assert.ok(anchor);
  const horizontalInfinity = normalizePointForDiagnostics({ x: 1, y: 0, w: 0 });
  assert.ok(horizontalInfinity);

  const horizontal = lineThroughPoints(anchor, horizontalInfinity);
  assert.ok(horizontal);
  assert.ok(Math.abs(horizontal.a) < 1e-15);
  assert.ok(Math.abs(horizontal.b * 0.8 + horizontal.c) < 1e-15);

  const vertical = normalizeCanonicalLine({ a: 1, b: 0, c: -0.6 });
  assert.ok(vertical);
  const finiteIntersection = intersectLines(horizontal, vertical);
  assert.ok(finiteIntersection);
  assert.equal(isFiniteHomogeneousPoint(finiteIntersection), true);
  assert.deepEqual(euclideanizeFinitePoint(finiteIntersection), { x: 0.6, y: 0.8 });
});

test("infinite homogeneous points remain non-Euclidean while finite points require normalized w", () => {
  const infinite = normalizePointForDiagnostics({ x: -5, y: 2, w: 0 });
  assert.ok(infinite);
  assert.equal(infinite.w, 0);
  assert.equal(isFiniteHomogeneousPoint(infinite), false);
  assert.equal(euclideanizeFinitePoint(infinite), null);

  const nearInfiniteButFinite = normalizePointForDiagnostics({ x: 1, y: 0, w: 1e-7 });
  assert.ok(nearInfiniteButFinite);
  assert.ok(Math.abs(nearInfiniteButFinite.w) > AFC_SR1_HOMOGENEOUS_EPSILON);
  assert.equal(isFiniteHomogeneousPoint(nearInfiniteButFinite), true);
  assert.ok(euclideanizeFinitePoint(nearInfiniteButFinite));
});

test("degenerate or non-finite homogeneous inputs fail closed", () => {
  assert.equal(normalizeCanonicalLine({ a: 0, b: 0, c: 1 }), null);
  assert.equal(normalizeCanonicalLine({ a: Number.NaN, b: 1, c: 0 }), null);
  assert.equal(normalizePointForDiagnostics({ x: 0, y: 0, w: 0 }), null);
  assert.equal(lineThroughPoints({ x: 0, y: 0, w: 1 }, { x: 0, y: 0, w: 1 }), null);
  assert.equal(
    intersectLines({ a: 0, b: 1, c: -0.4 }, { a: 0, b: 2, c: -0.8 }),
    null
  );
});
