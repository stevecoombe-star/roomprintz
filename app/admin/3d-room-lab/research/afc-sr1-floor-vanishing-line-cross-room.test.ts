import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  finitePointToHomogeneous,
  intersectLines,
  lineThroughPoints,
  type HomogeneousLine2,
} from "./afc-sr1-homogeneous-geometry";
import {
  convertAfcSr1PixelLineToSourceNormalized,
  deriveAfcSr1FloorVanishingLineCrossRoom,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";

const image = Object.freeze({ decodedWidth: 1000, decodedHeight: 500 });

const polygon: AfcSr1SourcePolygon = Object.freeze([
  Object.freeze({ x: 0.1, y: 0.8 }),
  Object.freeze({ x: 0.9, y: 0.9 }),
  Object.freeze({ x: 0.7, y: 0.4 }),
  Object.freeze({ x: 0.3, y: 0.4 }),
]) as AfcSr1SourcePolygon;

function sourceLineThrough(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>
): HomogeneousLine2 {
  const firstPoint = finitePointToHomogeneous(first);
  const secondPoint = finitePointToHomogeneous(second);
  assert.ok(firstPoint);
  assert.ok(secondPoint);
  const line = lineThroughPoints(firstPoint, secondPoint);
  assert.ok(line);
  return line;
}

function pixelLineForSourceLine(line: HomogeneousLine2) {
  return {
    a: line.a / image.decodedWidth,
    b: line.b / image.decodedHeight,
    c: line.c,
  };
}

function input(
  sourcePolygon: AfcSr1SourcePolygon,
  sourceFloorLine: HomogeneousLine2,
  truncatedAnchor: "NL" | "NR" = "NL"
) {
  return {
    analysisImage: image,
    floorVanishingLinePixel: pixelLineForSourceLine(sourceFloorLine),
    sourcePolygon,
    truncatedAnchor,
  };
}

function usable(value: unknown) {
  const result = deriveAfcSr1FloorVanishingLineCrossRoom(value);
  if (result.status !== "usable") assert.fail(`Expected usable bridge result, received ${result.reason}`);
  return result;
}

function pointOnPixelLine(line: Readonly<{ a: number; b: number; c: number }>, x: number) {
  return { x, y: -(line.a * x + line.c) / line.b };
}

function lineIncidence(line: HomogeneousLine2, point: Readonly<{ x: number; y: number }>) {
  return line.a * point.x + line.b * point.y + line.c;
}

test("pixel-to-source line conversion preserves incidence for sloped, horizontal, and vertical lines", () => {
  const slopedPixel = { a: 2, b: -3, c: 120 };
  const slopedSource = convertAfcSr1PixelLineToSourceNormalized(image, slopedPixel);
  assert.ok(slopedSource);
  for (const pixelPoint of [pointOnPixelLine(slopedPixel, 0), pointOnPixelLine(slopedPixel, 300)]) {
    const sourcePoint = {
      x: pixelPoint.x / image.decodedWidth,
      y: pixelPoint.y / image.decodedHeight,
    };
    assert.ok(Math.abs(lineIncidence(slopedSource, sourcePoint)) < 1e-12);
  }

  for (const [pixelLine, points] of [
    [{ a: 0, b: 1, c: -125 }, [{ x: 0, y: 125 }, { x: 999, y: 125 }]],
    [{ a: 1, b: 0, c: -250 }, [{ x: 250, y: 0 }, { x: 250, y: 499 }]],
  ] as const) {
    const sourceLine = convertAfcSr1PixelLineToSourceNormalized(image, pixelLine);
    assert.ok(sourceLine);
    for (const point of points) {
      assert.ok(Math.abs(lineIncidence(sourceLine, {
        x: point.x / image.decodedWidth,
        y: point.y / image.decodedHeight,
      })) < 1e-12);
    }
  }
});

test("finite width VP derives independently constructed legal NR-to-FR seam evidence", () => {
  const expectedOpposite = { x: 0.78, y: 0.6 }; // NR + 0.6 * (FR - NR)
  const anchorToExpected = sourceLineThrough(polygon[0], expectedOpposite);
  const farWidth = sourceLineThrough(polygon[3], polygon[2]);
  const widthVp = intersectLines(anchorToExpected, farWidth);
  assert.ok(widthVp);
  const floorSourceLine = lineThroughPoints(widthVp, finitePointToHomogeneous({ x: 0.5, y: 0.7 })!);
  assert.ok(floorSourceLine);

  const result = usable(input(polygon, floorSourceLine));
  assert.equal(result.widthVanishingPoint.finite, true);
  assert.ok(Math.abs(result.oppositeEndpoint.x - expectedOpposite.x) < 1e-12);
  assert.ok(Math.abs(result.oppositeEndpoint.y - expectedOpposite.y) < 1e-12);
  assert.ok(Math.abs(result.prior.seamT - 0.6) < 1e-12);
  assert.equal(result.prior.canonicalSeamId, "NR_to_FR");
});

test("an infinite width VP stays homogeneous and produces finite Track 1a evidence", () => {
  const horizontalFloor = sourceLineThrough({ x: 0, y: 0.8 }, { x: 1, y: 0.8 });
  const result = usable(input(polygon, horizontalFloor));

  assert.equal(result.widthVanishingPoint.finite, false);
  assert.ok(Math.abs(result.widthVanishingPoint.homogeneous.w) <= 1e-8);
  assert.ok(Math.abs(result.crossRoomLine.a) < 1e-12);
  assert.ok(Math.abs(lineIncidence(result.crossRoomLine, polygon[0])) < 1e-12);
  assert.ok(Math.abs(result.oppositeEndpoint.x - 0.86) < 1e-12);
  assert.ok(Math.abs(result.oppositeEndpoint.y - 0.8) < 1e-12);
  assert.ok(Math.abs(result.prior.seamT - 0.2) < 1e-12);
});

test("near-infinite finite VPs remain projective until their finite endpoint handoff", () => {
  const nearInfiniteFloor = { a: 0.01, b: -1, c: 0.4 - 0.01 * 10_000_000 };
  const result = usable(input(polygon, nearInfiniteFloor));

  assert.equal(result.widthVanishingPoint.finite, true);
  assert.ok(Math.abs(result.widthVanishingPoint.homogeneous.w) > 1e-8);
  assert.ok(Math.abs(result.widthVanishingPoint.homogeneous.w) < 1e-6);
  assert.ok(Math.abs(result.prior.seamT - 0.2) < 1e-7);
});

test("mirrored semantic orientations use existing NL/NR seam mapping", () => {
  const horizontalFloor = sourceLineThrough({ x: 0, y: 0.8 }, { x: 1, y: 0.8 });
  const mirrored: AfcSr1SourcePolygon = Object.freeze([
    Object.freeze({ x: 0.1, y: 0.9 }),
    Object.freeze({ x: 0.9, y: 0.8 }),
    Object.freeze({ x: 0.7, y: 0.4 }),
    Object.freeze({ x: 0.3, y: 0.4 }),
  ]) as AfcSr1SourcePolygon;

  const nlTruncated = usable(input(polygon, horizontalFloor, "NL"));
  const nrTruncated = usable(input(mirrored, horizontalFloor, "NR"));
  assert.equal(nlTruncated.prior.canonicalSeamId, "NR_to_FR");
  assert.equal(nrTruncated.prior.canonicalSeamId, "NL_to_FL");
  assert.ok(Math.abs(nlTruncated.prior.seamT - nrTruncated.prior.seamT) < 1e-12);
  assert.ok(Math.abs(nlTruncated.oppositeEndpoint.x + nrTruncated.oppositeEndpoint.x - 1) < 1e-12);
  assert.ok(Math.abs(nlTruncated.oppositeEndpoint.y - nrTruncated.oppositeEndpoint.y) < 1e-12);
});

test("floor-line sign invariance certifies future VP family-order invariance", () => {
  const floor = sourceLineThrough({ x: 0, y: 0.8 }, { x: 1, y: 0.8 });
  const positive = usable(input(polygon, floor));
  const negative = usable(input(polygon, { a: -floor.a, b: -floor.b, c: -floor.c }));

  assert.deepEqual(positive.floorVanishingLineSourceNorm, negative.floorVanishingLineSourceNorm);
  assert.deepEqual(positive.farWidthLine, negative.farWidthLine);
  assert.deepEqual(positive.oppositeEndpoint, negative.oppositeEndpoint);
  assert.equal(positive.prior.seamT, negative.prior.seamT);
});

test("a finite off-frame endpoint within the certified source extent reaches Track 1a unclamped", () => {
  const offFramePolygon: AfcSr1SourcePolygon = Object.freeze([
    Object.freeze({ x: 0.1, y: 0.8 }),
    Object.freeze({ x: 1.2, y: 0.9 }),
    Object.freeze({ x: 0.9, y: 0.4 }),
    Object.freeze({ x: 0.3, y: 0.4 }),
  ]) as AfcSr1SourcePolygon;
  const floor = sourceLineThrough({ x: 0, y: 0.8 }, { x: 1, y: 0.8 });
  const result = usable(input(offFramePolygon, floor));

  assert.ok(result.oppositeEndpoint.x > 1);
  assert.ok(result.oppositeEndpoint.x < 1.25);
  assert.equal(result.crossRoomEvidence.oppositeEndpoint.x, result.oppositeEndpoint.x);
  assert.ok(Math.abs(result.prior.seamT - 0.2) < 1e-12);
});

test("invalid inputs and projective degeneracies fail closed with narrow stable reasons", () => {
  const horizontalFloor = sourceLineThrough({ x: 0, y: 0.8 }, { x: 1, y: 0.8 });
  const farWidthFloor = sourceLineThrough(polygon[3], polygon[2]);
  const collapsedSeam = [
    polygon[0],
    polygon[1],
    polygon[2],
    polygon[0],
  ];
  const farWidthThroughAnchor: AfcSr1SourcePolygon = Object.freeze([
    Object.freeze({ x: 0.1, y: 0.8 }),
    Object.freeze({ x: 0.9, y: 0.9 }),
    Object.freeze({ x: 0.7, y: 0.4 }),
    Object.freeze({ x: 0.3, y: 0.6666666666666666 }),
  ]) as AfcSr1SourcePolygon;
  const anchorOnFarWidthFloor = sourceLineThrough(
    farWidthThroughAnchor[0],
    { x: 0.4, y: 0.7 }
  );
  const parallelToOppositeSeam = sourceLineThrough(polygon[1], polygon[2]);
  const anchorParallelLine = sourceLineThrough(polygon[0], {
    x: polygon[0].x + (polygon[2].x - polygon[1].x),
    y: polygon[0].y + (polygon[2].y - polygon[1].y),
  });
  const parallelVp = intersectLines(
    anchorParallelLine,
    sourceLineThrough(polygon[3], polygon[2])
  );
  assert.ok(parallelVp);
  const floorForParallelResult = lineThroughPoints(parallelVp, finitePointToHomogeneous({ x: 0.4, y: 0.7 })!);
  assert.ok(floorForParallelResult);

  const cases: readonly [unknown, string][] = [
    [{ ...input(polygon, horizontalFloor), analysisImage: { decodedWidth: 0, decodedHeight: 500 } }, "invalid_analysis_image"],
    [{ ...input(polygon, horizontalFloor), floorVanishingLinePixel: { a: 0, b: 0, c: 0 } }, "invalid_floor_vanishing_line"],
    [{ ...input(polygon, horizontalFloor), floorVanishingLinePixel: { a: Number.NaN, b: 1, c: 0 } }, "invalid_floor_vanishing_line"],
    [input(polygon, farWidthFloor), "degenerate_width_vanishing_point"],
    [{ ...input(polygon, horizontalFloor), sourcePolygon: collapsedSeam }, "invalid_source_polygon"],
    [input(farWidthThroughAnchor, anchorOnFarWidthFloor), "degenerate_cross_room_line"],
    [input(polygon, floorForParallelResult), "non_finite_opposite_endpoint"],
  ];
  for (const [bridgeInput, reason] of cases) {
    const result = deriveAfcSr1FloorVanishingLineCrossRoom(bridgeInput);
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, reason);
    assert.ok(Object.isFrozen(result));
  }

  // This construct makes the projective endpoint exactly NR, so Track 1a's
  // strict 0 < seamT < 1 gate remains the final rejection authority.
  const endpointAtNr = sourceLineThrough(polygon[0], polygon[1]);
  const endpointVp = intersectLines(endpointAtNr, sourceLineThrough(polygon[3], polygon[2]));
  assert.ok(endpointVp);
  const floorForNr = lineThroughPoints(endpointVp, finitePointToHomogeneous({ x: 0.5, y: 0.7 })!);
  assert.ok(floorForNr);
  const track1aRejected = deriveAfcSr1FloorVanishingLineCrossRoom(input(polygon, floorForNr));
  assert.equal(track1aRejected.status, "rejected");
  assert.equal(track1aRejected.reason, "track1a_rejected");
  assert.equal(track1aRejected.prior?.status, "rejected");
  assert.equal(track1aRejected.prior?.status === "rejected" && track1aRejected.prior.reason,
    "projected_seam_t_outside_domain");
  assert.ok(parallelToOppositeSeam);
});

test("results are immutable and input geometry is not mutated", () => {
  const floor = sourceLineThrough({ x: 0, y: 0.8 }, { x: 1, y: 0.8 });
  const bridgeInput = Object.freeze({
    analysisImage: Object.freeze({ ...image }),
    floorVanishingLinePixel: Object.freeze(pixelLineForSourceLine(floor)),
    sourcePolygon: Object.freeze(polygon.map(point => Object.freeze({ ...point }))) as AfcSr1SourcePolygon,
    truncatedAnchor: "NL" as const,
  });
  const before = structuredClone(bridgeInput);
  const result = usable(bridgeInput);

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.floorVanishingLineSourceNorm));
  assert.ok(Object.isFrozen(result.widthVanishingPoint));
  assert.ok(Object.isFrozen(result.crossRoomEvidence));
  assert.deepEqual(bridgeInput, before);
});

test("TR0 modules are pure geometry-only containment boundaries", () => {
  for (const file of [
    "afc-sr1-homogeneous-geometry.ts",
    "afc-sr1-floor-vanishing-line-cross-room.ts",
  ]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8").toLowerCase();
    for (const forbiddenDependency of [
      "three-room-lab",
      "compositor",
      "opencv",
      "gemini",
      "server-only",
      "child_process",
      "scene-state",
      "perspective-adjust",
      "floor-apply",
      "camera-apply",
    ]) {
      assert.equal(source.includes(forbiddenDependency), false, `${file}: ${forbiddenDependency}`);
    }
  }
});
