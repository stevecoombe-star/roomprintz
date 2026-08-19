import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLACEMENT_CONSTRAINT,
  applyPlacementConstraint,
  type PlacementConstraint,
} from "./placement-constraint";

test("unbounded ground-plane placement accepts finite X/Z unchanged", () => {
  const candidate = { x: 1.25, z: -3.5 };
  assert.deepEqual(applyPlacementConstraint(DEFAULT_PLACEMENT_CONSTRAINT, candidate), {
    ok: true,
    positionXZ: candidate,
  });
});

test("unbounded ground-plane placement accepts positions beyond a conceptual Floor quad", () => {
  for (const candidate of [
    { x: -20, z: 0 }, // left
    { x: 20, z: 0 }, // right
    { x: 0, z: -20 }, // nearer
    { x: 0, z: 20 }, // farther
    { x: -1_000_000, z: 1_000_000 },
    { x: 1_000_000, z: -1_000_000 },
  ]) {
    assert.deepEqual(applyPlacementConstraint(DEFAULT_PLACEMENT_CONSTRAINT, candidate), {
      ok: true,
      positionXZ: candidate,
    });
  }
});

test("unbounded ground-plane placement rejects non-finite candidates", () => {
  for (const candidate of [
    { x: Number.NaN, z: 0 },
    { x: 0, z: Number.NaN },
    { x: Number.POSITIVE_INFINITY, z: 0 },
    { x: 0, z: Number.NEGATIVE_INFINITY },
  ]) {
    assert.deepEqual(applyPlacementConstraint(DEFAULT_PLACEMENT_CONSTRAINT, candidate), {
      ok: false,
      reason: "candidate X/Z must be finite",
    });
  }
});

const roomBoundary: PlacementConstraint = {
  kind: "room_boundary",
  polygonWorldXZ: [
    { x: -2, z: -1 },
    { x: 3, z: -1 },
    { x: 3, z: 4 },
    { x: -2, z: 4 },
  ],
  resolution: "reject",
};

test("room-boundary placement accepts an inside world-XZ candidate unchanged", () => {
  const candidate = { x: 0, z: 1 };
  assert.deepEqual(applyPlacementConstraint(roomBoundary, candidate), {
    ok: true,
    positionXZ: candidate,
  });
});

test("room-boundary placement rejects an outside world-XZ candidate", () => {
  assert.deepEqual(applyPlacementConstraint(roomBoundary, { x: 3.01, z: 1 }), {
    ok: false,
    reason: "outside room boundary",
  });
});

test("room-boundary placement deterministically treats polygon edges and vertices as inside", () => {
  for (const candidate of [
    { x: 3, z: 1 },
    { x: -2, z: -1 },
  ]) {
    assert.deepEqual(applyPlacementConstraint(roomBoundary, candidate), {
      ok: true,
      positionXZ: candidate,
    });
  }
});
