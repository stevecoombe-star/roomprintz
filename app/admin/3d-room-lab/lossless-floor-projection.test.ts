import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLOOR_SOURCE_COORDINATE_EXTENT,
  FLOOR_SOURCE_COORDINATE_MAX,
  FLOOR_SOURCE_COORDINATE_MIN,
  isFloorSourcePointWithinExtent,
  validateFloorSourcePointExtent,
  validateFloorSourcePolygonExtent,
} from "./floor-coordinate-extent";
import {
  containerNormToSourceNorm,
  containerNormToSourceNormUnclamped,
  sourceNormToContainerNorm,
  sourceNormToContainerNormUnclamped,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import { SCENE_STATE_SCHEMA_VERSION } from "./scene-state";
import type { FloorPoint } from "./scene-state";

// AFC-CP1A — Lossless Floor Projection Foundation.
//
// The canonical Floor authority is source-image normalized. Container geometry
// is a derived editing/display projection. Before AFC-CP1A both directions of
// the Floor projection pair clamped to [0,1], so a legitimate source corner
// that projected outside the visible frame was silently rewritten whenever any
// OTHER corner was edited in container space.

const TOLERANCE = 1e-9;

// 4:3 source image inside the fixed 16:10 lab frame. Under object-cover the
// rendered image is 1600x1200 in a 1600x1000 frame, so offsetY = -100 and a
// source corner at y=1.0 lands at container y=1.1 — below the visible frame.
const INTRINSIC_4_3: ImageIntrinsicSize = { width: 1600, height: 1200 };
const FRAME_16_10: ImageFrameSize = { width: 1600, height: 1000 };

// Semantic Floor corner order used throughout the lab.
const CORNER_ORDER = ["NL", "NR", "FR", "FL"] as const;
const NL = 0;
const FR = 2;

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= TOLERANCE,
    `${message}: expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`
  );
}

// Pure model of the ThreeRoomLab Floor authority callbacks. It has the exact
// shape of the production useCallback bodies (map -> null filter -> length
// check) and calls the same exported transforms. The source-inspection tests
// further below prove the production callbacks use these same transforms.
function projectSourcePolygonToContainer(
  polygon: FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] | null {
  const projected = polygon
    .map((point) => sourceNormToContainerNormUnclamped(point, intrinsic, frame))
    .filter((point): point is FloorPoint => point !== null);
  return projected.length === polygon.length ? projected : null;
}

function projectContainerPolygonToSource(
  polygon: FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] | null {
  const projected = polygon
    .map((point) => containerNormToSourceNormUnclamped(point, intrinsic, frame))
    .filter((point): point is FloorPoint => point !== null);
  return projected.length === polygon.length ? projected : null;
}

// The clamped pair, modelling the pre-AFC-CP1A behaviour, kept only so the
// regression proves the corruption it removes.
function projectSourcePolygonToContainerClamped(
  polygon: FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] {
  return polygon.map((point) => sourceNormToContainerNorm(point, intrinsic, frame) as FloorPoint);
}

function projectContainerPolygonToSourceClamped(
  polygon: FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] {
  return polygon.map((point) => containerNormToSourceNorm(point, intrinsic, frame) as FloorPoint);
}

// Source-normalized Floor quad whose near corners sit exactly on the bottom
// boundary of the source image (y = 1.0) — valid authority geometry that is
// NOT visible in the 16:10 frame.
function makeSourceFloorPolygon(): FloorPoint[] {
  return [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.7, y: 0.55 },
    { x: 0.3, y: 0.55 },
  ];
}

// --- 1. Shared source-coordinate extent contract ----------------------------

test("CP1A extent: exported bounds are -0.25 / 1.25 and immutable", () => {
  assert.equal(FLOOR_SOURCE_COORDINATE_MIN, -0.25);
  assert.equal(FLOOR_SOURCE_COORDINATE_MAX, 1.25);
  assert.equal(FLOOR_SOURCE_COORDINATE_EXTENT.minX, -0.25);
  assert.equal(FLOOR_SOURCE_COORDINATE_EXTENT.maxX, 1.25);
  assert.equal(FLOOR_SOURCE_COORDINATE_EXTENT.minY, -0.25);
  assert.equal(FLOOR_SOURCE_COORDINATE_EXTENT.maxY, 1.25);
  assert.equal(Object.isFrozen(FLOOR_SOURCE_COORDINATE_EXTENT), true);
});

test("CP1A extent: in-extent points are accepted without modification", () => {
  for (const point of [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0.5, y: 0.5 },
    { x: -0.25, y: 1.25 },
    { x: 1.25, y: -0.25 },
  ]) {
    const result = validateFloorSourcePointExtent(point);
    assert.equal(result.ok, true, `expected ${JSON.stringify(point)} to be in extent`);
    if (result.ok) {
      assert.equal(result.point.x, point.x);
      assert.equal(result.point.y, point.y);
    }
    assert.equal(isFloorSourcePointWithinExtent(point), true);
  }
});

test("CP1A extent: every out-of-extent case has a distinct structured reason", () => {
  const cases: Array<[FloorPoint, string]> = [
    [{ x: Number.NaN, y: 0.5 }, "source_x_not_finite"],
    [{ x: Number.POSITIVE_INFINITY, y: 0.5 }, "source_x_not_finite"],
    [{ x: 0.5, y: Number.NaN }, "source_y_not_finite"],
    [{ x: -0.26, y: 0.5 }, "source_x_below_min"],
    [{ x: 1.26, y: 0.5 }, "source_x_above_max"],
    [{ x: 0.5, y: -0.26 }, "source_y_below_min"],
    [{ x: 0.5, y: 1.26 }, "source_y_above_max"],
  ];
  for (const [point, reason] of cases) {
    const result = validateFloorSourcePointExtent(point);
    assert.equal(result.ok, false, `expected ${JSON.stringify(point)} to be rejected`);
    if (!result.ok) assert.equal(result.reason, reason);
  }
});

test("CP1A extent: validation never clamps a rejected point into range", () => {
  const result = validateFloorSourcePointExtent({ x: 5, y: 5 });
  assert.equal(result.ok, false);
  assert.equal("point" in result, false, "a rejected result must not carry a substituted point");
});

test("CP1B-1H extent: polygon validation distinguishes corner count from extent failure", () => {
  const quad: FloorPoint[] = [
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.7, y: 0.2 },
    { x: 0.3, y: 0.2 },
  ];
  assert.deepEqual(validateFloorSourcePolygonExtent(quad.slice(0, 3)), {
    ok: false,
    rejectedCornerIndex: null,
    reason: "source_corner_count",
  });
  assert.deepEqual(validateFloorSourcePolygonExtent([...quad, { x: 0.5, y: 0.5 }]), {
    ok: false,
    rejectedCornerIndex: null,
    reason: "source_corner_count",
  });
  assert.deepEqual(
    validateFloorSourcePolygonExtent([
      quad[0],
      quad[1],
      { x: 1.26, y: quad[2].y },
      quad[3],
    ]),
    {
      ok: false,
      rejectedCornerIndex: 2,
      reason: "source_x_above_max",
    }
  );
});

// --- 2. Corruption-loop regression -----------------------------------------

test("CP1A regression: editing corner FR leaves boundary corner NL at source y=1.0", () => {
  const source = makeSourceFloorPolygon();

  const container = projectSourcePolygonToContainer(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container, "source -> container projection must succeed");

  // The boundary corners are genuinely outside the visible frame.
  assertClose(container[NL].y, 1.1, "NL projects below the visible frame");
  assert.ok(container[NL].y > 1);

  // Only corner B (FR) is edited, exactly as a container-space drag would.
  const edited = container.map((point, index) =>
    index === FR ? { x: 0.62, y: point.y } : point
  );

  const roundTripped = projectContainerPolygonToSource(edited, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(roundTripped, "container -> source projection must succeed");

  // Corner A is untouched and must survive bit-for-bit within tolerance.
  assertClose(roundTripped[NL].y, 1, "corner NL must remain at source y=1.0");
  assertClose(roundTripped[NL].x, source[NL].x, "corner NL x must be unchanged");
});

test("CP1A regression: all three untouched source corners are preserved", () => {
  const source = makeSourceFloorPolygon();
  const container = projectSourcePolygonToContainer(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  const edited = container.map((point, index) =>
    index === FR ? { x: 0.62, y: point.y } : point
  );
  const roundTripped = projectContainerPolygonToSource(edited, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(roundTripped);

  for (const index of [0, 1, 3]) {
    assertClose(roundTripped[index].x, source[index].x, `${CORNER_ORDER[index]} x preserved`);
    assertClose(roundTripped[index].y, source[index].y, `${CORNER_ORDER[index]} y preserved`);
  }
  // The edited corner did move, so the test is not passing vacuously.
  assert.ok(Math.abs(roundTripped[FR].x - source[FR].x) > 1e-3, "corner FR must actually have moved");
});

test("CP1A regression: the clamped pair still exhibits the pre-CP1A corruption", () => {
  // Documents the behaviour at baseline dfb5dea, where both Floor projection
  // callbacks used the clamped helpers.
  const source = makeSourceFloorPolygon();
  const container = projectSourcePolygonToContainerClamped(source, INTRINSIC_4_3, FRAME_16_10);
  const edited = container.map((point, index) =>
    index === FR ? { x: 0.62, y: point.y } : point
  );
  const roundTripped = projectContainerPolygonToSourceClamped(edited, INTRINSIC_4_3, FRAME_16_10);

  // The untouched boundary corner is silently rewritten from 1.0 to ~0.9167.
  assertClose(roundTripped[NL].y, 1100 / 1200, "clamped path corrupts NL");
  assert.ok(
    Math.abs(roundTripped[NL].y - 1) > 1e-3,
    "the clamped path must demonstrably lose the boundary corner"
  );
});

test("CP1A regression: semantic corner order NL/NR/FR/FL is preserved end to end", () => {
  const source = makeSourceFloorPolygon();
  const container = projectSourcePolygonToContainer(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  const roundTripped = projectContainerPolygonToSource(container, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(roundTripped);

  assert.equal(roundTripped.length, source.length);
  assert.equal(container.length, source.length);
  // Near corners stay near (larger y), far corners stay far.
  assert.ok(roundTripped[0].y > roundTripped[3].y, "NL must remain nearer than FL");
  assert.ok(roundTripped[1].y > roundTripped[2].y, "NR must remain nearer than FR");
  assert.ok(roundTripped[0].x < roundTripped[1].x, "NL must remain left of NR");
  assert.ok(roundTripped[3].x < roundTripped[2].x, "FL must remain left of FR");
});

test("CP1A regression: projection does not mutate the input array or its points", () => {
  const source = makeSourceFloorPolygon();
  const snapshot = JSON.stringify(source);
  const container = projectSourcePolygonToContainer(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  assert.equal(JSON.stringify(source), snapshot, "source polygon must not be mutated");
  assert.notEqual(container, source, "projection must return a new array");
  for (let i = 0; i < source.length; i += 1) {
    assert.notEqual(container[i], source[i], "projection must return new point objects");
  }

  const containerSnapshot = JSON.stringify(container);
  const back = projectContainerPolygonToSource(container, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(back);
  assert.equal(JSON.stringify(container), containerSnapshot, "container polygon must not be mutated");
});

test("CP1A regression: no hidden rounding is applied to projected coordinates", () => {
  const source = [{ x: 0.123456789012345, y: 0.987654321098765 }];
  const container = projectSourcePolygonToContainer(source, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(container);
  const back = projectContainerPolygonToSource(container, INTRINSIC_4_3, FRAME_16_10);
  assert.ok(back);
  assert.ok(
    Math.abs(back[0].x - source[0].x) <= 1e-12,
    "full precision must survive the x round trip"
  );
  assert.ok(
    Math.abs(back[0].y - source[0].y) <= 1e-12,
    "full precision must survive the y round trip"
  );
  // A rounded implementation would collapse these onto a coarse grid.
  assert.notEqual(back[0].x, Number(source[0].x.toFixed(4)));
  assert.notEqual(back[0].y, Number(source[0].y.toFixed(4)));
});

test("CP1A regression: an invalid conversion still returns null for the whole polygon", () => {
  const source = makeSourceFloorPolygon();
  assert.equal(projectSourcePolygonToContainer(source, { width: 0, height: 0 }, FRAME_16_10), null);
  assert.equal(projectContainerPolygonToSource(source, INTRINSIC_4_3, { width: 0, height: 0 }), null);
  assert.equal(
    projectSourcePolygonToContainer(
      [{ x: 0.5, y: 0.5 }, { x: Number.NaN, y: 0.5 }],
      INTRINSIC_4_3,
      FRAME_16_10
    ),
    null,
    "a single non-finite point must fail the whole polygon"
  );
});

// --- 3. Scope containment (source inspection) -------------------------------
//
// Narrowly scoped source assertions over the lab UI, following the repository's
// established source-inspection convention.

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_SOURCE = readFileSync(path.join(LAB_DIR, "ThreeRoomLab.tsx"), "utf8");
const QUAD_SOLVABILITY_SOURCE = readFileSync(path.join(LAB_DIR, "quad-solvability.ts"), "utf8");
const IMAGE_SPACE_SOURCE = readFileSync(path.join(LAB_DIR, "image-space.ts"), "utf8");
const EXTENT_SOURCE = readFileSync(path.join(LAB_DIR, "floor-coordinate-extent.ts"), "utf8");

/**
 * Extracts a single `const <name> = useCallback( ... );` block from the UI
 * source, from the declaration up to its closing `\n  );` at hook indentation.
 */
function extractCallbackBlock(name: string): string {
  const start = UI_SOURCE.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} must exist in ThreeRoomLab.tsx`);
  const end = UI_SOURCE.indexOf("\n  );", start);
  assert.ok(end > start, `${name} must be a closed useCallback block`);
  return UI_SOURCE.slice(start, end);
}

const CONTAINER_TO_SOURCE_BLOCK = extractCallbackBlock("projectFloorContainerPolygonToSource");
const SOURCE_TO_CONTAINER_BLOCK = extractCallbackBlock("projectFloorSourcePolygonToContainer");

test("CP1A containment: projectFloorContainerPolygonToSource uses only the unclamped transform", () => {
  assert.ok(
    /containerNormToSourceNormUnclamped\s*\(/.test(CONTAINER_TO_SOURCE_BLOCK),
    "projectFloorContainerPolygonToSource must call containerNormToSourceNormUnclamped"
  );
  assert.ok(
    !/containerNormToSourceNorm\s*\(/.test(CONTAINER_TO_SOURCE_BLOCK),
    "projectFloorContainerPolygonToSource must not call the clamped containerNormToSourceNorm"
  );
});

test("CP1A containment: projectFloorSourcePolygonToContainer uses only the unclamped transform", () => {
  assert.ok(
    /sourceNormToContainerNormUnclamped\s*\(/.test(SOURCE_TO_CONTAINER_BLOCK),
    "projectFloorSourcePolygonToContainer must call sourceNormToContainerNormUnclamped"
  );
  assert.ok(
    !/sourceNormToContainerNorm\s*\(/.test(SOURCE_TO_CONTAINER_BLOCK),
    "projectFloorSourcePolygonToContainer must not call the clamped sourceNormToContainerNorm"
  );
});

test("CP1A containment: the Floor callbacks keep their existing null contract and shape", () => {
  for (const block of [CONTAINER_TO_SOURCE_BLOCK, SOURCE_TO_CONTAINER_BLOCK]) {
    assert.ok(
      /if \(!imageIntrinsicSize \|\| !frameSizeForImageSpace\) return null;/.test(block),
      "the callback must still fail closed on a missing intrinsic or frame size"
    );
    assert.ok(
      /\.filter\(\(point\): point is FloorPoint => point !== null\)/.test(block),
      "the callback must still drop null conversions"
    );
    assert.ok(
      /return projected\.length === polygon\.length \? projected : null;/.test(block),
      "the callback must still return null when any point failed to convert"
    );
    assert.ok(
      /\[frameSizeForImageSpace, imageIntrinsicSize\]/.test(block),
      "the callback dependency list must be unchanged"
    );
    assert.ok(!/toFixed|Math\.round|sort\(/.test(block), "the callback must not round or re-sort");
  }
});

test("CP1C-A containment: Floor authority and live solver seams use unclamped transforms only where required", () => {
  // Wall and Ceiling callbacks remain presentation-safe. The Floor authority
  // callbacks plus the live Floor homography are the only UI-side unclamped
  // paths sanctioned by CP1C-A.
  const genericContainerToSource = extractCallbackBlock("projectContainerPolygonToSource");
  const genericSourceToContainer = extractCallbackBlock("projectSourcePolygonToContainer");

  for (const [name, block] of [
    ["projectContainerPolygonToSource", genericContainerToSource],
    ["projectSourcePolygonToContainer", genericSourceToContainer],
  ] as const) {
    assert.ok(!/Unclamped\s*\(/.test(block), `${name} must not call any unclamped transform`);
  }
  assert.ok(/containerNormToSourceNorm\s*\(/.test(genericContainerToSource));
  assert.ok(/sourceNormToContainerNorm\s*\(/.test(genericSourceToContainer));

  const floorBlocks = CONTAINER_TO_SOURCE_BLOCK + SOURCE_TO_CONTAINER_BLOCK;
  const unclampedCallsInFloorBlocks = (floorBlocks.match(/\w+Unclamped\s*\(/g) ?? []).length;
  assert.ok(unclampedCallsInFloorBlocks >= 2, "both Floor callbacks must use an unclamped transform");
  assert.ok(
    /const pixels = normToPixelsUnclamped\(point, frameSize\);/.test(UI_SOURCE),
    "the live Floor homography must preserve off-frame container magnitude"
  );
  assert.ok(
    (QUAD_SOLVABILITY_SOURCE.match(/normToPixelsUnclamped\(point, frameSize\)/g) ?? []).length === 2,
    "homography construction and pose preparation must share the unclamped Floor pixels"
  );
});

test("CP1C-A containment: the live Floor solver uses unclamped pixels while UI-safe helpers remain clamped", () => {
  assert.ok(
    /const pixels = normToPixelsUnclamped\(point, frameSize\);/.test(UI_SOURCE),
    "the live homography path must use normToPixelsUnclamped"
  );
  assert.ok(
    /const anchorPixels = normToPixels\(lastAcceptedFloorClick, frameSize\);/.test(UI_SOURCE),
    "bounded diagnostic anchor conversion remains UI-safe"
  );
});

test("CP1A containment: no solver policy or scene schema changed", () => {
  assert.equal(SCENE_STATE_SCHEMA_VERSION, "vibode-3d-room-lab-scene-state/v1");
  // Camera intrinsics stay defined against the visible frame, not the source image.
  assert.ok(
    !/verticalFovDeg[^\n]*imageIntrinsicSize/.test(UI_SOURCE),
    "vertical FOV must not be re-based onto source-image dimensions"
  );
});

test("CP1A containment: the new geometry modules stay dependency neutral", () => {
  // Only module specifiers are inspected; prose in doc comments is not a
  // dependency.
  const forbiddenSpecifier = /provider|compositor|capture|proposal|gemini/i;
  const specifiersOf = (source: string): string[] =>
    (source.match(/^import[^\n]*?from\s+"([^"]+)";$/gm) ?? []).map(
      (line) => (line.match(/from\s+"([^"]+)";$/) as RegExpMatchArray)[1]
    );

  const extentImports = EXTENT_SOURCE.match(/^import\b/gm) ?? [];
  assert.equal(extentImports.length, 0, "floor-coordinate-extent.ts must have no imports");

  const imageSpaceSpecifiers = specifiersOf(IMAGE_SPACE_SOURCE);
  assert.deepEqual(
    imageSpaceSpecifiers,
    ["./scene-state"],
    "image-space.ts must keep its single type-only import"
  );
  for (const specifier of [...specifiersOf(EXTENT_SOURCE), ...imageSpaceSpecifiers]) {
    assert.ok(
      !forbiddenSpecifier.test(specifier),
      `must not import a provider/compositor/capture/proposal module: ${specifier}`
    );
  }
});

test("CP1A containment: image-space documents the clamped/unclamped authority split", () => {
  assert.ok(/UI-SAFE helpers/.test(IMAGE_SPACE_SOURCE));
  assert.ok(/GEOMETRY\/AUTHORITY transforms/.test(IMAGE_SPACE_SOURCE));
  // The policy is stated per support kind, not as a blanket rule, because only
  // Floor authority projection was switched to the unclamped transforms.
  assert.ok(/FLOOR authority projection uses the UNCLAMPED transforms/.test(IMAGE_SPACE_SOURCE));
  assert.ok(/WALL, CEILING, seam, Type B, Empty-Room-Assist/.test(IMAGE_SPACE_SOURCE));
});
