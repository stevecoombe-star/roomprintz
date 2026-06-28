import assert from "node:assert/strict";
import test from "node:test";

import {
  corridorHalfWidthToOverlayStrokeWidth,
  getCoverCrop,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";

// Phase 2O-B1 corridor-width render fix: the manual seam corridor band stroke
// width must be derived from the source-pixel half-width, not a fixed value.

const INTRINSIC: ImageIntrinsicSize = { width: 1600, height: 1000 };
const FRAME: ImageFrameSize = { width: 800, height: 500 };

test("corridor stroke width is null for non-positive or non-finite half-width", () => {
  assert.equal(corridorHalfWidthToOverlayStrokeWidth(0, INTRINSIC, FRAME), null);
  assert.equal(corridorHalfWidthToOverlayStrokeWidth(-5, INTRINSIC, FRAME), null);
  assert.equal(corridorHalfWidthToOverlayStrokeWidth(Number.NaN, INTRINSIC, FRAME), null);
});

test("corridor stroke width is null for invalid image/frame dimensions", () => {
  assert.equal(corridorHalfWidthToOverlayStrokeWidth(6, { width: 0, height: 0 }, FRAME), null);
  assert.equal(corridorHalfWidthToOverlayStrokeWidth(6, INTRINSIC, { width: 0, height: 0 }), null);
});

test("a larger source-pixel half-width produces a larger display width (same context)", () => {
  const small = corridorHalfWidthToOverlayStrokeWidth(6, INTRINSIC, FRAME);
  const large = corridorHalfWidthToOverlayStrokeWidth(100, INTRINSIC, FRAME);
  assert.ok(small !== null && large !== null);
  assert.ok((large as number) > (small as number));
  // The default (6) and the smoke-test value (100) must NOT render identically.
  assert.notEqual(small, large);
});

test("display width is linearly proportional to the source-pixel half-width", () => {
  const base = corridorHalfWidthToOverlayStrokeWidth(6, INTRINSIC, FRAME);
  const scaled = corridorHalfWidthToOverlayStrokeWidth(60, INTRINSIC, FRAME);
  assert.ok(base !== null && scaled !== null);
  // 10x the half-width -> 10x the rendered stroke width for a fixed context.
  assert.ok(Math.abs((scaled as number) - (base as number) * 10) < 1e-9);
});

test("conversion matches the documented source-px -> container-px -> viewBox pipeline", () => {
  const crop = getCoverCrop(INTRINSIC, FRAME);
  assert.ok(crop);
  const halfWidth = 25;
  const expectedFullContainerPx = 2 * halfWidth * (crop as { scale: number }).scale;
  const expectedAvgUnitsPerPx = (100 / FRAME.width + 100 / FRAME.height) / 2;
  const expected = expectedFullContainerPx * expectedAvgUnitsPerPx;
  const actual = corridorHalfWidthToOverlayStrokeWidth(halfWidth, INTRINSIC, FRAME);
  assert.ok(actual !== null);
  assert.ok(Math.abs((actual as number) - expected) < 1e-9);
});
