import assert from "node:assert/strict";
import test from "node:test";

import {
  containerNormToSourceNorm,
  containerNormToSourceNormUnclamped,
  corridorHalfWidthToOverlayStrokeWidth,
  getCoverCrop,
  normToPixels,
  normToPixelsUnclamped,
  sourceNormToContainerNorm,
  sourceNormToContainerNormDiagnostic,
  sourceNormToContainerNormUnclamped,
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

// --- Phase 2O-D: sourceNormToContainerNormDiagnostic ------------------------
// INTRINSIC (1600x1000) and FRAME (800x500) share the same aspect ratio, so the
// object-cover crop has zero offset and source-normalized maps 1:1 into
// container-normalized space, which makes the expected values easy to reason
// about while still exercising the real getCoverCrop math.

test("diagnostic conversion: valid inside-frame point is visible with zero overshoot", () => {
  const result = sourceNormToContainerNormDiagnostic({ x: 0.5, y: 0.5 }, INTRINSIC, FRAME);
  assert.ok(result);
  assert.ok(Math.abs(result.container.x - 0.5) < 1e-9);
  assert.ok(Math.abs(result.container.y - 0.5) < 1e-9);
  assert.equal(result.visibleInFrame, true);
  assert.equal(result.maxOvershoot, 0);
});

test("diagnostic conversion: near-edge inside-frame point stays visible", () => {
  const result = sourceNormToContainerNormDiagnostic({ x: 0.995, y: 0.01 }, INTRINSIC, FRAME);
  assert.ok(result);
  assert.equal(result.visibleInFrame, true);
  assert.equal(result.maxOvershoot, 0);
  assert.ok(result.container.x <= 1 && result.container.x >= 0);
  assert.ok(result.container.y <= 1 && result.container.y >= 0);
});

test("diagnostic conversion: off-frame point is not visible and reports overshoot", () => {
  const result = sourceNormToContainerNormDiagnostic({ x: 1.3, y: 0.5 }, INTRINSIC, FRAME);
  assert.ok(result);
  assert.equal(result.visibleInFrame, false);
  // Equal-aspect mapping: source x 1.3 -> container x 1.3 -> overshoot 0.3.
  assert.ok(result.maxOvershoot > 0);
  assert.ok(Math.abs(result.maxOvershoot - 0.3) < 1e-9);
});

test("diagnostic conversion: negative off-frame point reports overshoot below zero edge", () => {
  const result = sourceNormToContainerNormDiagnostic({ x: 0.5, y: -0.2 }, INTRINSIC, FRAME);
  assert.ok(result);
  assert.equal(result.visibleInFrame, false);
  assert.ok(Math.abs(result.maxOvershoot - 0.2) < 1e-9);
});

test("diagnostic conversion: invalid dimensions or non-finite point return null", () => {
  assert.equal(sourceNormToContainerNormDiagnostic({ x: 0.5, y: 0.5 }, { width: 0, height: 0 }, FRAME), null);
  assert.equal(sourceNormToContainerNormDiagnostic({ x: 0.5, y: 0.5 }, INTRINSIC, { width: 0, height: 0 }), null);
  assert.equal(sourceNormToContainerNormDiagnostic({ x: Number.NaN, y: 0.5 }, INTRINSIC, FRAME), null);
});

// --- AFC-CP1A: lossless (unclamped) source <-> container transforms ---------
//
// The lab frame is a fixed 16:10 viewport. A 4:3 source image is TALLER than
// the frame under object-cover, so the frame crops the top and bottom of the
// image and a source point at y=1.0 projects BELOW the visible frame. A 2:1
// source image is WIDER than the frame, so the frame crops the left and right
// and a source point at x=0.0 projects LEFT of the visible frame. Those two
// fixtures exercise the crop in both axes.

const FRAME_16_10: ImageFrameSize = { width: 1600, height: 1000 };
const INTRINSIC_4_3: ImageIntrinsicSize = { width: 1600, height: 1200 };
const INTRINSIC_2_1: ImageIntrinsicSize = { width: 2000, height: 1000 };

const ROUND_TRIP_TOLERANCE = 1e-9;

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= ROUND_TRIP_TOLERANCE,
    `${message}: expected ${expected}, got ${actual}`
  );
}

test("unclamped: in-frame source -> container -> source round trip is lossless", () => {
  const source = { x: 0.375, y: 0.625 };
  const container = sourceNormToContainerNormUnclamped(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  const restored = containerNormToSourceNormUnclamped(container, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(restored);
  assertClose(restored.x, source.x, "round-trip x");
  assertClose(restored.y, source.y, "round-trip y");
});

test("unclamped: 4:3 source boundary y=1.0 in a 16:10 frame survives the round trip", () => {
  const source = { x: 0.5, y: 1 };
  const container = sourceNormToContainerNormUnclamped(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  // renderedHeight 1200 vs frame height 1000 -> offsetY -100 -> container y 1.1.
  assertClose(container.y, 1.1, "container y is below the visible frame");
  assert.ok(container.y > 1, "container y must be preserved outside [0,1]");
  const restored = containerNormToSourceNormUnclamped(container, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(restored);
  assertClose(restored.y, 1, "unclamped inverse restores the boundary source value");
  assertClose(restored.x, 0.5, "unclamped inverse restores the untouched axis");
});

test("unclamped: 2:1 source boundary x=0.0 in a 16:10 frame survives the round trip", () => {
  const source = { x: 0, y: 0.5 };
  const container = sourceNormToContainerNormUnclamped(source, INTRINSIC_2_1, FRAME_16_10);
  assert.ok(container);
  // renderedWidth 2000 vs frame width 1600 -> offsetX -200 -> container x -0.125.
  assertClose(container.x, -0.125, "container x is left of the visible frame");
  assert.ok(container.x < 0, "container x must be preserved outside [0,1]");
  const restored = containerNormToSourceNormUnclamped(container, INTRINSIC_2_1, FRAME_16_10);
  assert.ok(restored);
  assertClose(restored.x, 0, "unclamped inverse restores the boundary source value");
  assertClose(restored.y, 0.5, "unclamped inverse restores the untouched axis");
});

test("unclamped: off-frame source points round trip exactly across the CP1A extent", () => {
  const offFrameSources = [
    { x: -0.05, y: 0.5 },
    { x: -0.25, y: 0.5 },
    { x: 1.25, y: 0.5 },
    { x: 0.5, y: -0.25 },
    { x: 0.5, y: 1.25 },
  ];
  for (const source of offFrameSources) {
    const container = sourceNormToContainerNormUnclamped(source, INTRINSIC_4_3, FRAME_16_10);
    assert.ok(container, `container projection for ${JSON.stringify(source)}`);
    const restored = containerNormToSourceNormUnclamped(container, INTRINSIC_4_3, FRAME_16_10);
    assert.ok(restored, `source projection for ${JSON.stringify(source)}`);
    assertClose(restored.x, source.x, `off-frame round-trip x for ${JSON.stringify(source)}`);
    assertClose(restored.y, source.y, `off-frame round-trip y for ${JSON.stringify(source)}`);
  }
});

test("unclamped: container output is allowed below 0 and above 1", () => {
  const below = sourceNormToContainerNormUnclamped({ x: -0.25, y: 0.5 }, INTRINSIC_4_3, FRAME_16_10);
  const above = sourceNormToContainerNormUnclamped({ x: 0.5, y: 1.25 }, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(below && above);
  assert.ok(below.x < 0, "container x below 0 must not be clamped");
  assert.ok(above.y > 1, "container y above 1 must not be clamped");
});

test("unclamped: source output is allowed below 0 and above 1", () => {
  const below = containerNormToSourceNormUnclamped({ x: -0.4, y: 0.5 }, INTRINSIC_4_3, FRAME_16_10);
  const above = containerNormToSourceNormUnclamped({ x: 0.5, y: 1.4 }, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(below && above);
  assert.ok(below.x < 0, "source x below 0 must not be clamped");
  assert.ok(above.y > 1, "source y above 1 must not be clamped");
});

test("unclamped: containerNormToSourceNormUnclamped fails closed", () => {
  assert.equal(
    containerNormToSourceNormUnclamped({ x: 0.5, y: 0.5 }, { width: 0, height: 0 }, FRAME_16_10),
    null
  );
  assert.equal(
    containerNormToSourceNormUnclamped({ x: 0.5, y: 0.5 }, INTRINSIC_4_3, { width: 0, height: 0 }),
    null
  );
  assert.equal(
    containerNormToSourceNormUnclamped({ x: 0.5, y: 0.5 }, INTRINSIC_4_3, { width: Number.NaN, height: 1000 }),
    null
  );
  assert.equal(containerNormToSourceNormUnclamped({ x: Number.NaN, y: 0.5 }, INTRINSIC_4_3, FRAME_16_10), null);
  assert.equal(containerNormToSourceNormUnclamped({ x: 0.5, y: Number.NaN }, INTRINSIC_4_3, FRAME_16_10), null);
  assert.equal(
    containerNormToSourceNormUnclamped({ x: Number.POSITIVE_INFINITY, y: 0.5 }, INTRINSIC_4_3, FRAME_16_10),
    null
  );
});

// --- AFC-CP1A: the clamped helpers must keep clamping exactly as before -----

test("clamped: containerNormToSourceNorm still clamps input and output to [0,1]", () => {
  const fromOffFrameInput = containerNormToSourceNorm({ x: -0.4, y: 1.4 }, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(fromOffFrameInput);
  assert.ok(fromOffFrameInput.x >= 0 && fromOffFrameInput.x <= 1);
  assert.ok(fromOffFrameInput.y >= 0 && fromOffFrameInput.y <= 1);
  // Container y is clamped to 1 first, which maps to source y 1100/1200.
  assertClose(fromOffFrameInput.y, 1100 / 1200, "clamped source y");
  assertClose(fromOffFrameInput.x, 0, "clamped source x");
});

test("clamped: sourceNormToContainerNorm still clamps input and output to [0,1]", () => {
  const boundary = sourceNormToContainerNorm({ x: 0.5, y: 1 }, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(boundary);
  // The unclamped transform yields 1.1; the UI-safe helper must clamp to 1.
  assertClose(boundary.y, 1, "clamped container y");
  const offFrame = sourceNormToContainerNorm({ x: -0.25, y: 1.25 }, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(offFrame);
  assert.ok(offFrame.x >= 0 && offFrame.x <= 1);
  assert.ok(offFrame.y >= 0 && offFrame.y <= 1);
});

test("clamped: the clamped pair is the documented lossy round trip the unclamped pair replaces", () => {
  const source = { x: 0.5, y: 1 };
  const container = sourceNormToContainerNorm(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  const restored = containerNormToSourceNorm(container, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(restored);
  // The clamped round trip loses the boundary corner (1.0 -> ~0.9167).
  assertClose(restored.y, 1100 / 1200, "clamped round trip corrupts the boundary corner");
  assert.ok(Math.abs(restored.y - source.y) > 1e-3);
});

// --- AFC-CP1A: normToPixelsUnclamped ---------------------------------------

test("normToPixelsUnclamped preserves off-frame normalized values", () => {
  const size: ImageIntrinsicSize = { width: 1600, height: 1200 };
  const negative = normToPixelsUnclamped({ x: -0.25, y: -0.05 }, size);
  assert.ok(negative);
  assertClose(negative.x, -400, "negative x pixels");
  assertClose(negative.y, -60, "negative y pixels");
  const beyond = normToPixelsUnclamped({ x: 1.25, y: 1.1 }, size);
  assert.ok(beyond);
  assertClose(beyond.x, 2000, "beyond-one x pixels");
  assertClose(beyond.y, 1320, "beyond-one y pixels");
});

test("normToPixelsUnclamped matches normToPixels for in-frame values", () => {
  const size: ImageIntrinsicSize = { width: 1600, height: 1200 };
  const point = { x: 0.25, y: 0.75 };
  const clamped = normToPixels(point, size);
  const unclamped = normToPixelsUnclamped(point, size);
  assert.ok(clamped && unclamped);
  assert.equal(unclamped.x, clamped.x);
  assert.equal(unclamped.y, clamped.y);
});

test("normToPixelsUnclamped fails closed on invalid size or non-finite point", () => {
  assert.equal(normToPixelsUnclamped({ x: 0.5, y: 0.5 }, { width: 0, height: 1200 }), null);
  assert.equal(normToPixelsUnclamped({ x: 0.5, y: 0.5 }, { width: 1600, height: Number.NaN }), null);
  assert.equal(normToPixelsUnclamped({ x: Number.NaN, y: 0.5 }, { width: 1600, height: 1200 }), null);
  assert.equal(
    normToPixelsUnclamped({ x: 0.5, y: Number.NEGATIVE_INFINITY }, { width: 1600, height: 1200 }),
    null
  );
});

test("normToPixels still clamps exactly as before", () => {
  const size: ImageIntrinsicSize = { width: 1600, height: 1200 };
  const negative = normToPixels({ x: -0.25, y: -0.05 }, size);
  assert.ok(negative);
  assert.equal(negative.x, 0);
  assert.equal(negative.y, 0);
  const beyond = normToPixels({ x: 1.25, y: 1.1 }, size);
  assert.ok(beyond);
  assert.equal(beyond.x, 1600);
  assert.equal(beyond.y, 1200);
  assert.equal(normToPixels({ x: 0.5, y: 0.5 }, { width: 0, height: 1200 }), null);
});
