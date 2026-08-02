import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFloorFitPreviewGridPolylines } from "./floor-fit-preview-grid";
import { normToPixels, normToPixelsUnclamped, type ImageFrameSize } from "./image-space";
import {
  applyHomography,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  invertHomography,
  solvePlaneHomography,
  validateOrderedFloorCorners,
} from "./perspective-solve";
import type { FloorPoint } from "./scene-state";

const EPSILON = 1e-9;
const FRAME: ImageFrameSize = { width: 1600, height: 1000 };
const WORLD_WIDTH = 6;
const WORLD_DEPTH = 5;
const GRID_LINE_COUNT = 7;
const SAMPLES_PER_LINE = 20;

const OFF_FRAME_FLOOR: FloorPoint[] = [
  { x: 0.38, y: 1.141 },
  { x: 0.62, y: 1.141 },
  { x: 0.82, y: 0.778 },
  { x: 0.18, y: 0.778 },
];

const CLAMP_DEGENERATE_FLOOR: FloorPoint[] = [
  { x: 1.1, y: 1.2 },
  { x: 1.25, y: 1.2 },
  { x: 0.9, y: 0.6 },
  { x: 0.55, y: 0.6 },
];

function assertClose(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${label}: expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`
  );
}

function assertPointClose(actual: FloorPoint, expected: FloorPoint, label: string): void {
  assertClose(actual.x, expected.x, `${label}.x`);
  assertClose(actual.y, expected.y, `${label}.y`);
}

function orderedCorners(points: FloorPoint[]): [FloorPoint, FloorPoint, FloorPoint, FloorPoint] {
  const result = validateOrderedFloorCorners(points);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.value.asArray;
}

function buildGrid(points: FloorPoint[]): FloorPoint[][] {
  return buildFloorFitPreviewGridPolylines({
    orderedCornersNorm: orderedCorners(points),
    frameSize: FRAME,
    worldWidth: WORLD_WIDTH,
    worldDepth: WORLD_DEPTH,
    gridLineCount: GRID_LINE_COUNT,
    samplesPerLine: SAMPLES_PER_LINE,
  });
}

function cross(a: FloorPoint, b: FloorPoint, point: FloorPoint): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function legacyClampedGrid(points: FloorPoint[]): FloorPoint[][] {
  const corners = orderedCorners(points);
  const sourcePx = corners.map((point) => normToPixels(point, FRAME));
  assert.ok(sourcePx.every((point): point is FloorPoint => point !== null));

  const floorRect = getFloorRectCorners({ widthMeters: WORLD_WIDTH, depthMeters: WORLD_DEPTH });
  assert.ok(floorRect.ok, floorRect.ok ? "" : floorRect.reason);
  const solved = solvePlaneHomography(
    sourcePx,
    floorRect.value.asArray.map((point) => floorVec3ToPlane2D(point))
  );
  assert.ok(solved.ok, solved.ok ? "" : solved.reason);
  const inverse = invertHomography(solved.value);
  assert.ok(inverse);

  const halfWidth = WORLD_WIDTH / 2;
  const halfDepth = WORLD_DEPTH / 2;
  const lines: FloorPoint[][] = [];
  const addLine = (axis: "x" | "z", fixed: number, variableMin: number, variableMax: number) => {
    const line: FloorPoint[] = [];
    for (let index = 0; index <= SAMPLES_PER_LINE; index += 1) {
      const t = index / SAMPLES_PER_LINE;
      const variable = variableMin + (variableMax - variableMin) * t;
      const projected = applyHomography(
        inverse,
        axis === "x" ? { x: fixed, y: variable } : { x: variable, y: fixed }
      );
      assert.ok(projected);
      line.push({ x: projected.x / FRAME.width, y: projected.y / FRAME.height });
    }
    lines.push(line);
  };

  for (let index = 0; index < GRID_LINE_COUNT; index += 1) {
    const t = index / (GRID_LINE_COUNT - 1);
    addLine("x", -halfWidth + halfWidth * 2 * t, -halfDepth, halfDepth);
  }
  for (let index = 0; index < GRID_LINE_COUNT; index += 1) {
    const t = index / (GRID_LINE_COUNT - 1);
    addLine("z", -halfDepth + halfDepth * 2 * t, -halfWidth, halfWidth);
  }
  return lines;
}

test("AFC-CP1B-H1: outer grid boundaries retain the truthful off-frame Floor sides", () => {
  const grid = buildGrid(OFF_FRAME_FLOOR);
  assert.equal(grid.length, GRID_LINE_COUNT * 2);

  const leftBoundary = grid[0];
  const rightBoundary = grid[GRID_LINE_COUNT - 1];
  assertPointClose(leftBoundary[0], OFF_FRAME_FLOOR[3], "left far endpoint");
  assertPointClose(leftBoundary.at(-1)!, OFF_FRAME_FLOOR[0], "left near endpoint");
  assertPointClose(rightBoundary[0], OFF_FRAME_FLOOR[2], "right far endpoint");
  assertPointClose(rightBoundary.at(-1)!, OFF_FRAME_FLOOR[1], "right near endpoint");

  for (const point of leftBoundary) {
    assert.ok(Math.abs(cross(OFF_FRAME_FLOOR[3], OFF_FRAME_FLOOR[0], point)) <= EPSILON, "left point on truthful side");
  }
  for (const point of rightBoundary) {
    assert.ok(Math.abs(cross(OFF_FRAME_FLOOR[2], OFF_FRAME_FLOOR[1], point)) <= EPSILON, "right point on truthful side");
  }
  assert.ok(leftBoundary.at(-1)!.y > 1);
  assert.ok(rightBoundary.at(-1)!.y > 1);
  assert.notEqual(leftBoundary.at(-1)!.y, 1, "left near endpoint must not collapse to its proxy");
  assert.notEqual(rightBoundary.at(-1)!.y, 1, "right near endpoint must not collapse to its proxy");
});

test("AFC-CP1B-H1: internal samples use the truthful projective preview homography", () => {
  const grid = buildGrid(OFF_FRAME_FLOOR);
  const sourcePx = orderedCorners(OFF_FRAME_FLOOR).map((point) => ({
    x: point.x * FRAME.width,
    y: point.y * FRAME.height,
  }));
  const floorRect = getFloorRectCorners({ widthMeters: WORLD_WIDTH, depthMeters: WORLD_DEPTH });
  assert.ok(floorRect.ok, floorRect.ok ? "" : floorRect.reason);
  const solved = solvePlaneHomography(
    sourcePx,
    floorRect.value.asArray.map((point) => floorVec3ToPlane2D(point))
  );
  assert.ok(solved.ok, solved.ok ? "" : solved.reason);
  const inverse = invertHomography(solved.value);
  assert.ok(inverse);

  const sampleIndex = 7;
  const expectedPx = applyHomography(inverse, {
    x: 0,
    y: -WORLD_DEPTH / 2 + WORLD_DEPTH * (sampleIndex / SAMPLES_PER_LINE),
  });
  assert.ok(expectedPx);
  assertPointClose(
    grid[3][sampleIndex],
    { x: expectedPx.x / FRAME.width, y: expectedPx.y / FRAME.height },
    "center longitudinal sample"
  );

  const expectedTransversePx = applyHomography(inverse, {
    x: -WORLD_WIDTH / 2 + WORLD_WIDTH * (sampleIndex / SAMPLES_PER_LINE),
    y: 0,
  });
  assert.ok(expectedTransversePx);
  assertPointClose(
    grid[GRID_LINE_COUNT + 3][sampleIndex],
    { x: expectedTransversePx.x / FRAME.width, y: expectedTransversePx.y / FRAME.height },
    "center transverse sample"
  );
});

test("AFC-CP1B-H1: preview helper contract excludes presentation data", () => {
  const helperSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "floor-fit-preview-grid.ts"), "utf8");
  assert.match(helperSource, /orderedCornersNorm: readonly \[FloorPoint, FloorPoint, FloorPoint, FloorPoint\]/);
  for (const forbidden of ["floorHandlePresentations", "resolveFloorHandlePresentation", "floor-handle-presentation"]) {
    assert.ok(!helperSource.includes(forbidden), `preview helper must not reference ${forbidden}`);
  }
});

test("AFC-CP1B-H1: in-frame preview is equivalent to the existing clamped path", () => {
  const inFrameFloor: FloorPoint[] = [
    { x: 0.25, y: 0.9 },
    { x: 0.75, y: 0.9 },
    { x: 0.85, y: 0.45 },
    { x: 0.15, y: 0.45 },
  ];
  const preview = buildGrid(inFrameFloor);
  const legacy = legacyClampedGrid(inFrameFloor);
  assert.equal(preview.length, legacy.length);
  for (let lineIndex = 0; lineIndex < preview.length; lineIndex += 1) {
    assert.equal(preview[lineIndex].length, legacy[lineIndex].length);
    for (let pointIndex = 0; pointIndex < preview[lineIndex].length; pointIndex += 1) {
      assertPointClose(preview[lineIndex][pointIndex], legacy[lineIndex][pointIndex], `line ${lineIndex} point ${pointIndex}`);
    }
  }
});

test("AFC-CP1B-H1: finite off-frame preview samples are retained without clamping", () => {
  const grid = buildGrid(OFF_FRAME_FLOOR);
  const offFramePoints = grid.flat().filter((point) => point.y > 1);
  assert.ok(offFramePoints.length > 0, "valid below-frame points must remain in the rendered polylines");
  assert.ok(offFramePoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(offFramePoints.some((point) => Math.abs(point.y - 1.141) <= EPSILON));
});

test("AFC-CP1B-H1: invalid preview inputs fail closed without non-finite geometry", () => {
  const degenerate: [FloorPoint, FloorPoint, FloorPoint, FloorPoint] = [
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.5, y: 0.8 },
    { x: 0.3, y: 0.8 },
  ];
  assert.deepEqual(
    buildFloorFitPreviewGridPolylines({
      orderedCornersNorm: degenerate,
      frameSize: FRAME,
      worldWidth: WORLD_WIDTH,
      worldDepth: WORLD_DEPTH,
      gridLineCount: GRID_LINE_COUNT,
      samplesPerLine: SAMPLES_PER_LINE,
    }),
    []
  );
  assert.deepEqual(
    buildFloorFitPreviewGridPolylines({
      orderedCornersNorm: [
        { x: Number.NaN, y: 0.8 },
        { x: 0.8, y: 0.8 },
        { x: 0.7, y: 0.4 },
        { x: 0.3, y: 0.4 },
      ],
      frameSize: FRAME,
      worldWidth: WORLD_WIDTH,
      worldDepth: WORLD_DEPTH,
      gridLineCount: GRID_LINE_COUNT,
      samplesPerLine: SAMPLES_PER_LINE,
    }),
    []
  );
  assert.deepEqual(
    buildFloorFitPreviewGridPolylines({
      orderedCornersNorm: orderedCorners(OFF_FRAME_FLOOR),
      frameSize: { width: 0, height: FRAME.height },
      worldWidth: WORLD_WIDTH,
      worldDepth: WORLD_DEPTH,
      gridLineCount: GRID_LINE_COUNT,
      samplesPerLine: SAMPLES_PER_LINE,
    }),
    []
  );
});

test("AFC-CP1C-A: truthful preview and live solver preserve the same off-frame Floor geometry", () => {
  const previewLines = buildGrid(CLAMP_DEGENERATE_FLOOR);
  assert.equal(previewLines.length, GRID_LINE_COUNT * 2, "truthful preview homography must remain valid");

  const solverPixels = orderedCorners(CLAMP_DEGENERATE_FLOOR).map((point) => normToPixelsUnclamped(point, FRAME));
  assert.ok(solverPixels.every((point): point is FloorPoint => point !== null));
  assert.deepEqual(solverPixels[0], { x: 1760.0000000000002, y: 1200 });
  assert.deepEqual(solverPixels[1], { x: 2000, y: 1200 });
  const floorRect = getFloorRectCorners({ widthMeters: WORLD_WIDTH, depthMeters: WORLD_DEPTH });
  assert.ok(floorRect.ok, floorRect.ok ? "" : floorRect.reason);
  const solverSolve = solvePlaneHomography(
    solverPixels,
    floorRect.value.asArray.map((point) => floorVec3ToPlane2D(point))
  );
  assert.equal(solverSolve.ok, true, "the live solver must accept the same truthful corners as the preview");

  const clampedPixels = orderedCorners(CLAMP_DEGENERATE_FLOOR).map((point) => normToPixels(point, FRAME));
  assert.ok(clampedPixels.every((point): point is FloorPoint => point !== null));
  assert.deepEqual(clampedPixels[0], clampedPixels[1], "the UI-safe helper must remain clamped");

  const labDir = path.dirname(fileURLToPath(import.meta.url));
  const uiSource = readFileSync(path.join(labDir, "ThreeRoomLab.tsx"), "utf8");
  const gridInitialization = uiSource.indexOf("let gridPolylinesNorm: FloorPoint[][] = [];");
  const placementFailure = uiSource.indexOf("if (!solveResult.ok)");
  const helperCall = uiSource.indexOf("gridPolylinesNorm = buildFloorFitPreviewGridPolylines");
  assert.ok(gridInitialization >= 0 && placementFailure > gridInitialization && helperCall > placementFailure);
  assert.match(
    uiSource.slice(placementFailure, helperCall),
    /return \{[\s\S]*?gridPolylinesNorm,[\s\S]*?homographyMatrixForPlacement,/
  );
  assert.equal(
    (uiSource.slice(gridInitialization, helperCall).match(/gridPolylinesNorm\s*=/g) ?? []).length,
    0,
    "placement failure returns the initialized empty preview grid"
  );
  assert.ok(/const pixels = normToPixelsUnclamped\(point, frameSize\);/.test(uiSource));
  assert.ok(
    /gridPolylinesNorm = buildFloorFitPreviewGridPolylines\(\{[\s\S]*?orderedCornersNorm: orderedCornersResult\.value\.asArray/.test(
      uiSource
    )
  );
});
