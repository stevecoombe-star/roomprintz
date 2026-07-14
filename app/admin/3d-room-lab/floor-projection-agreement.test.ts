import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_PROJECTION_CORNER_ORDER,
  calculateFloorProjectionAgreement,
  mapFloorAttachmentBoundaryToAgreementOrder,
  mapReviewedFloorCornersToAgreementOrder,
  type FloorProjectionAgreementInput,
} from "./floor-projection-agreement";

function makeInput(): FloorProjectionAgreementInput {
  const point = (x: number, y: number) => ({ x, y });
  const corner = (x: number, y: number) => ({
    sourceNormalized: point(x / 100, y / 100),
    containerNormalized: point(x / 100, y / 100),
    reviewedDisplayPx: point(x, y),
    world: { x, y: 0, z: y },
    projectedNormalized: point(x / 100, y / 100),
    projectedDisplayPx: point(x, y),
  });
  return {
    frameWidthPx: 100,
    frameHeightPx: 100,
    corners: {
      far_left: corner(0, 0),
      far_right: corner(10, 0),
      near_right: corner(10, 10),
      near_left: corner(0, 10),
    },
  };
}

function withProjectedOffset(
  input: FloorProjectionAgreementInput,
  corner: keyof FloorProjectionAgreementInput["corners"],
  dx: number,
  dy: number
): FloorProjectionAgreementInput {
  const value = input.corners[corner]!;
  return {
    ...input,
    corners: {
      ...input.corners,
      [corner]: {
        ...value,
        projectedNormalized: {
          x: value.projectedNormalized.x + dx / input.frameWidthPx,
          y: value.projectedNormalized.y + dy / input.frameHeightPx,
        },
        projectedDisplayPx: {
          x: value.projectedDisplayPx.x + dx,
          y: value.projectedDisplayPx.y + dy,
        },
      },
    },
  };
}

function resultEdge(result: ReturnType<typeof calculateFloorProjectionAgreement>, edge: string) {
  return result.edges.find((value) => value.edge === edge)!;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

test("exact agreement returns all zero corner and aggregate deltas", () => {
  const result = calculateFloorProjectionAgreement(makeInput());
  assert.equal(result.available, true);
  assert.deepEqual(result.corners.map((corner) => corner.corner), FLOOR_PROJECTION_CORNER_ORDER);
  assert.ok(result.corners.every((corner) => corner.deltaXPx === 0 && corner.deltaYPx === 0 && corner.distancePx === 0));
  assert.equal(result.maximumDistancePx, 0);
  assert.equal(result.rmsDistancePx, 0);
});

test("one-corner X displacement has signed delta and Euclidean distance", () => {
  const result = calculateFloorProjectionAgreement(withProjectedOffset(makeInput(), "far_left", 3, 0));
  assert.deepEqual(result.corners[0].deltaXPx, 3);
  assert.deepEqual(result.corners[0].deltaYPx, 0);
  assert.equal(result.corners[0].distancePx, 3);
});

test("one-corner Y displacement has signed delta and Euclidean distance", () => {
  const result = calculateFloorProjectionAgreement(withProjectedOffset(makeInput(), "far_left", 0, -4));
  assert.equal(result.corners[0].deltaXPx, 0);
  assert.equal(result.corners[0].deltaYPx, -4);
  assert.equal(result.corners[0].distancePx, 4);
});

test("multiple-corner fixture produces exact maximum and RMS", () => {
  let input = makeInput();
  input = withProjectedOffset(input, "far_right", 3, 0);
  input = withProjectedOffset(input, "near_right", 0, 4);
  input = withProjectedOffset(input, "near_left", 5, 0);
  const result = calculateFloorProjectionAgreement(input);
  assert.equal(result.maximumDistancePx, 5);
  assert.equal(result.rmsDistancePx, Math.sqrt(12.5));
});

test("average signed displacement is correct", () => {
  let input = makeInput();
  input = withProjectedOffset(input, "far_left", 4, -2);
  input = withProjectedOffset(input, "far_right", -2, 6);
  const result = calculateFloorProjectionAgreement(input);
  assert.equal(result.averageDeltaXPx, 0.5);
  assert.equal(result.averageDeltaYPx, 1);
});

test("centroid displacement is correct", () => {
  let input = makeInput();
  for (const corner of FLOOR_PROJECTION_CORNER_ORDER) input = withProjectedOffset(input, corner, 2, -3);
  const result = calculateFloorProjectionAgreement(input);
  assert.deepEqual(result.reviewedCentroidPx, { x: 5, y: 5 });
  assert.deepEqual(result.projectedCentroidPx, { x: 7, y: 2 });
  assert.equal(result.centroidDeltaXPx, 2);
  assert.equal(result.centroidDeltaYPx, -3);
  assert.ok(Math.abs(result.centroidDistancePx - Math.sqrt(13)) < 1e-12);
});

test("all available numeric output values remain finite", () => {
  const result = calculateFloorProjectionAgreement(withProjectedOffset(makeInput(), "near_right", 7, -9));
  const serializedNumbers = JSON.stringify(result).match(/-?\d+(?:\.\d+)?/g) ?? [];
  assert.ok(serializedNumbers.every((value) => Number.isFinite(Number(value))));
});

test("exact edge lengths match", () => {
  const result = calculateFloorProjectionAgreement(makeInput());
  for (const edge of result.edges) {
    assert.equal(edge.reviewedLengthPx, edge.projectedLengthPx);
    assert.equal(edge.signedLengthDifferencePx, 0);
  }
});

test("projected far edge shorter than reviewed returns a negative signed difference", () => {
  let input = withProjectedOffset(makeInput(), "far_left", 1, 0);
  input = withProjectedOffset(input, "far_right", -1, 0);
  assert.equal(resultEdge(calculateFloorProjectionAgreement(input), "far").signedLengthDifferencePx, -2);
});

test("projected near edge longer than reviewed returns a positive signed difference", () => {
  let input = withProjectedOffset(makeInput(), "near_left", -2, 0);
  input = withProjectedOffset(input, "near_right", 2, 0);
  assert.equal(resultEdge(calculateFloorProjectionAgreement(input), "near").signedLengthDifferencePx, 4);
});

test("endpoint maximum and RMS are correct for every edge", () => {
  let input = makeInput();
  input = withProjectedOffset(input, "far_left", 3, 4);
  input = withProjectedOffset(input, "far_right", 0, 6);
  input = withProjectedOffset(input, "near_right", 8, 0);
  const result = calculateFloorProjectionAgreement(input);
  assert.deepEqual(
    result.edges.map((edge) => [edge.edge, edge.endpointMaxDistancePx, edge.endpointRmsDistancePx]),
    [
      ["far", 6, Math.sqrt(30.5)],
      ["near", 8, Math.sqrt(32)],
      ["left", 5, Math.sqrt(12.5)],
      ["right", 8, Math.sqrt(50)],
    ]
  );
});

test("fixed semantic endpoint pairing is far-left/far-right, near-right/near-left, and fixed side rails", () => {
  let input = makeInput();
  input = withProjectedOffset(input, "far_left", 4, 0);
  input = withProjectedOffset(input, "near_right", 8, 0);
  const result = calculateFloorProjectionAgreement(input);
  assert.equal(resultEdge(result, "far").endpointMaxDistancePx, 4);
  assert.equal(resultEdge(result, "near").endpointMaxDistancePx, 8);
  assert.equal(resultEdge(result, "left").endpointMaxDistancePx, 4);
  assert.equal(resultEdge(result, "right").endpointMaxDistancePx, 8);
});

test("far RMS greater than near RMS returns far_exceeds_near", () => {
  let input = withProjectedOffset(makeInput(), "far_left", 6, 0);
  input = withProjectedOffset(input, "far_right", 8, 0);
  assert.equal(calculateFloorProjectionAgreement(input).observation, "far_exceeds_near");
});

test("near RMS greater than far RMS returns near_exceeds_far", () => {
  let input = withProjectedOffset(makeInput(), "near_left", 6, 0);
  input = withProjectedOffset(input, "near_right", 8, 0);
  assert.equal(calculateFloorProjectionAgreement(input).observation, "near_exceeds_far");
});

test("equal near and far values within diagnostic epsilon return near_and_far_similar", () => {
  let input = withProjectedOffset(makeInput(), "far_left", 2, 0);
  input = withProjectedOffset(input, "far_right", 2, 0);
  input = withProjectedOffset(input, "near_left", 2 + 5e-7, 0);
  input = withProjectedOffset(input, "near_right", 2 + 5e-7, 0);
  assert.equal(calculateFloorProjectionAgreement(input).observation, "near_and_far_similar");
});

test("observation has no blocker, pass, or fail field", () => {
  const result = calculateFloorProjectionAgreement(makeInput());
  assert.equal("blocker" in result, false);
  assert.equal("pass" in result, false);
  assert.equal("fail" in result, false);
});

test("invalid frame dimensions are unavailable", () => {
  const result = calculateFloorProjectionAgreement({ ...makeInput(), frameWidthPx: 0 });
  assert.deepEqual(result.unavailableReasons, ["invalid_frame_width_px"]);
});

test("missing semantic corner is unavailable", () => {
  const input = makeInput();
  const corners = { ...input.corners };
  delete corners.far_left;
  const result = calculateFloorProjectionAgreement({ ...input, corners });
  assert.deepEqual(result.unavailableReasons, ["missing_corner:far_left"]);
});

test("non-finite reviewed point is unavailable", () => {
  const input = makeInput();
  const value = input.corners.near_left!;
  const result = calculateFloorProjectionAgreement({
    ...input,
    corners: { ...input.corners, near_left: { ...value, reviewedDisplayPx: { x: Number.NaN, y: 10 } } },
  });
  assert.deepEqual(result.unavailableReasons, ["non_finite_reviewed_display_px:near_left"]);
});

test("non-finite world point is unavailable", () => {
  const input = makeInput();
  const value = input.corners.near_left!;
  const result = calculateFloorProjectionAgreement({
    ...input,
    corners: { ...input.corners, near_left: { ...value, world: { x: 0, y: Infinity, z: 1 } } },
  });
  assert.deepEqual(result.unavailableReasons, ["non_finite_world_point:near_left"]);
});

test("non-finite projected point is unavailable", () => {
  const input = makeInput();
  const value = input.corners.near_left!;
  const result = calculateFloorProjectionAgreement({
    ...input,
    corners: { ...input.corners, near_left: { ...value, projectedDisplayPx: { x: Number.NaN, y: 10 } } },
  });
  assert.deepEqual(result.unavailableReasons, ["non_finite_projected_display_px:near_left"]);
});

test("repeated calls are deeply equal", () => {
  const input = withProjectedOffset(makeInput(), "far_left", 3, -4);
  assert.deepEqual(calculateFloorProjectionAgreement(input), calculateFloorProjectionAgreement(input));
});

test("input insertion order does not change fixed corner output order", () => {
  const input = makeInput();
  const reordered = {
    near_left: input.corners.near_left!,
    far_right: input.corners.far_right!,
    near_right: input.corners.near_right!,
    far_left: input.corners.far_left!,
  };
  assert.deepEqual(calculateFloorProjectionAgreement({ ...input, corners: reordered }).corners.map((corner) => corner.corner), FLOOR_PROJECTION_CORNER_ORDER);
});

test("deep-frozen inputs are not mutated", () => {
  const input = deepFreeze(makeInput());
  assert.doesNotThrow(() => calculateFloorProjectionAgreement(input));
  assert.deepEqual(input, makeInput());
});

test("adapter mapping helpers preserve the committed reviewed and world semantic orders", () => {
  assert.deepEqual(
    mapReviewedFloorCornersToAgreementOrder({
      nearLeft: "near_left",
      nearRight: "near_right",
      farRight: "far_right",
      farLeft: "far_left",
    }),
    {
      far_left: "far_left",
      far_right: "far_right",
      near_right: "near_right",
      near_left: "near_left",
    }
  );
  assert.deepEqual(mapFloorAttachmentBoundaryToAgreementOrder(["far_left", "far_right", "near_right", "near_left"]), {
    far_left: "far_left",
    far_right: "far_right",
    near_right: "near_right",
    near_left: "near_left",
  });
  assert.equal(mapFloorAttachmentBoundaryToAgreementOrder(["only", "three", "points"]), null);
});
