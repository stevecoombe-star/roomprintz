import assert from "node:assert/strict";
import test from "node:test";
import { sourceNormToContainerNorm } from "./image-space";
import {
  WALL_FLOOR_SEAM_SNAP_ENTER_PX,
  WALL_FLOOR_SEAM_SNAP_RELEASE_PX,
  WALL_FLOOR_SNAP_ENTER_PX,
  WALL_FLOOR_SNAP_RELEASE_PX,
  getWallFloorSeamTarget,
  getWallFloorSnapTarget,
  getWallLowerPointRole,
  projectSourceNormPointToSegment,
  resolveWallFloorPointSnap,
  type WallFloorPointSnapInput,
  type WallFloorSnapKind,
} from "./wall-floor-point-snap";

const INTRINSIC = { width: 1000, height: 800 };
const FRAME = { width: 1000, height: 800 };
const FLOOR = {
  NL: { x: 0.2, y: 0.8 },
  NR: { x: 0.8, y: 0.8 },
  FR: { x: 0.7, y: 0.3 },
  FL: { x: 0.3, y: 0.3 },
} as const;
const EPSILON = 1e-12;

function input(overrides: Partial<WallFloorPointSnapInput> = {}): WallFloorPointSnapInput {
  return {
    available: true,
    wallKind: "wall_back",
    wallPointRole: "lower_left",
    activeSnapKind: null,
    unsnappedWallPointSourceNorm: { x: 0.1, y: 0.1 },
    pointerContainerNorm: { x: 0.3, y: 0.3 },
    floorSourceCorners: FLOOR,
    intrinsicSize: INTRINSIC,
    frameSize: FRAME,
    ...overrides,
  };
}

function assertPointNear(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  epsilon = EPSILON
) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `x ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `y ${actual.y} !== ${expected.y}`);
}

function resolveAt(
  pointer: { x: number; y: number },
  activeSnapKind: WallFloorSnapKind | null
) {
  return resolveWallFloorPointSnap(
    input({
      unsnappedWallPointSourceNorm: pointer,
      pointerContainerNorm: pointer,
      activeSnapKind,
    })
  );
}

test("maps every committed lower vertex role to its pinned Floor corner and seam", () => {
  assert.equal(getWallFloorSnapTarget("wall_back", "lower_left"), "FL");
  assert.equal(getWallFloorSnapTarget("wall_back", "lower_right"), "FR");
  assert.equal(getWallFloorSnapTarget("wall_left", "lower_left"), "NL");
  assert.equal(getWallFloorSnapTarget("wall_left", "lower_right"), "FL");
  assert.equal(getWallFloorSnapTarget("wall_right", "lower_left"), "FR");
  assert.equal(getWallFloorSnapTarget("wall_right", "lower_right"), "NR");
  assert.deepEqual(getWallFloorSeamTarget("wall_back"), {
    startFloorCorner: "FL",
    endFloorCorner: "FR",
  });
  assert.deepEqual(getWallFloorSeamTarget("wall_left"), {
    startFloorCorner: "NL",
    endFloorCorner: "FL",
  });
  assert.deepEqual(getWallFloorSeamTarget("wall_right"), {
    startFloorCorner: "FR",
    endFloorCorner: "NR",
  });
});

test("upper vertices and unsupported roles fail closed", () => {
  assert.equal(getWallLowerPointRole(0), "lower_left");
  assert.equal(getWallLowerPointRole(1), "lower_right");
  assert.equal(getWallLowerPointRole(2), null);
  assert.equal(getWallLowerPointRole(3), null);
  assert.equal(getWallFloorSnapTarget("wall_back", null), null);
  assert.equal(getWallFloorSnapTarget("wall_back", "unsupported" as never), null);
});

test("corner snapping remains inclusive and wins when both corner and seam are eligible", () => {
  const target = FLOOR.NL;
  const justAbove = resolveWallFloorPointSnap(
    input({
      wallKind: "wall_left",
      wallPointRole: "lower_left",
      pointerContainerNorm: {
        x: target.x + (WALL_FLOOR_SNAP_ENTER_PX + 0.01) / FRAME.width,
        y: target.y,
      },
    })
  );
  const exact = resolveWallFloorPointSnap(
    input({
      wallKind: "wall_left",
      wallPointRole: "lower_left",
      pointerContainerNorm: {
        x: target.x + WALL_FLOOR_SNAP_ENTER_PX / FRAME.width,
        y: target.y,
      },
    })
  );
  const bothEligible = resolveWallFloorPointSnap(
    input({
      wallKind: "wall_left",
      wallPointRole: "lower_left",
      unsnappedWallPointSourceNorm: target,
      pointerContainerNorm: target,
    })
  );
  assert.equal(justAbove.snapped, false);
  assert.equal(exact.snapped, true);
  assert.equal(exact.snapKind, "corner");
  assert.equal(bothEligible.snapKind, "corner");
  assert.deepEqual(bothEligible.pointSourceNorm, FLOOR.NL);
});

test("corner output copies the authoritative source coordinate bit-for-bit", () => {
  const floor = { ...FLOOR, FL: { x: 0.300000001, y: 0.299999999 } };
  const result = resolveWallFloorPointSnap(
    input({
      floorSourceCorners: floor,
      pointerContainerNorm: floor.FL,
      unsnappedWallPointSourceNorm: floor.FL,
    })
  );
  assert.equal(result.snapKind, "corner");
  assert.equal(result.floorCorner, "FL");
  assert.equal(result.floorSeam, null);
  assert.equal(result.seamT, null);
  assert.deepEqual(result.pointSourceNorm, floor.FL);
  assert.notEqual(result.pointSourceNorm, floor.FL);
});

test("projects an interior point onto the finite Floor seam in source pixels", () => {
  const dragged = { x: 0.2548507125007267, y: 0.5515158476564771 };
  const result = resolveWallFloorPointSnap(
    input({
      wallKind: "wall_left",
      wallPointRole: "lower_right",
      unsnappedWallPointSourceNorm: dragged,
      pointerContainerNorm: dragged,
    })
  );
  assert.equal(result.snapped, true);
  assert.equal(result.snapKind, "seam");
  assert.deepEqual(result.floorSeam, {
    startFloorCorner: "NL",
    endFloorCorner: "FL",
  });
  assert.equal(result.seamT, 0.5);
  assertPointNear(result.pointSourceNorm, { x: 0.25, y: 0.55 });
  const cross =
    (result.pointSourceNorm.x - FLOOR.NL.x) * (FLOOR.FL.y - FLOOR.NL.y) -
    (result.pointSourceNorm.y - FLOOR.NL.y) * (FLOOR.FL.x - FLOOR.NL.x);
  assert.ok(Math.abs(cross) <= EPSILON);
});

test("clamps source-pixel segment projections at both endpoints", () => {
  const before = projectSourceNormPointToSegment(
    { x: 0.2, y: 0.95 },
    FLOOR.NL,
    FLOOR.FL,
    INTRINSIC
  );
  const after = projectSourceNormPointToSegment(
    { x: 0.3, y: 0.1 },
    FLOOR.NL,
    FLOOR.FL,
    INTRINSIC
  );
  assert.ok(before);
  assert.ok(after);
  assert.equal(before.t, 0);
  assert.deepEqual(before.pointSourceNorm, FLOOR.NL);
  assert.equal(after.t, 1);
  assert.deepEqual(after.pointSourceNorm, FLOOR.FL);
});

test("Room C left-wall lower-front projects continuously along NL–FL", () => {
  const roomC = {
    NL: { x: 0.045000000000000005, y: 0.9653019205454482 },
    FL: { x: 0.07800000000000003, y: 0.6950000000000001 },
  };
  const dragged = { x: 0.06015660002240144, y: 0.8186771943162083 };
  const rawCross =
    (dragged.x - roomC.NL.x) * (roomC.FL.y - roomC.NL.y) -
    (dragged.y - roomC.NL.y) * (roomC.FL.x - roomC.NL.x);
  const projection = projectSourceNormPointToSegment(dragged, roomC.NL, roomC.FL, INTRINSIC);
  const result = resolveWallFloorPointSnap(
    input({
      wallKind: "wall_left",
      wallPointRole: "lower_right",
      floorSourceCorners: { ...FLOOR, ...roomC },
      unsnappedWallPointSourceNorm: dragged,
      pointerContainerNorm: dragged,
    })
  );
  assert.ok(Math.abs(rawCross) > EPSILON);
  assert.ok(projection);
  assert.ok(Math.abs(projection.t - 0.5412) < 0.001);
  assert.equal(result.snapKind, "seam");
  assert.equal(result.seamT, projection.t);
  assertPointNear(result.pointSourceNorm, projection.pointSourceNorm);
  const snappedCross =
    (result.pointSourceNorm.x - roomC.NL.x) * (roomC.FL.y - roomC.NL.y) -
    (result.pointSourceNorm.y - roomC.NL.y) * (roomC.FL.x - roomC.NL.x);
  assert.ok(Math.abs(snappedCross) <= EPSILON);
  assert.notDeepEqual(result.pointSourceNorm, roomC.NL);
  assert.notDeepEqual(result.pointSourceNorm, roomC.FL);
});

test("uses tri-state hysteresis without corner, seam, or free flicker", () => {
  const free = resolveAt({ x: 0.5, y: 0.33 }, null);
  const corner = resolveAt({ x: 0.31, y: 0.3 }, free.snapKind);
  const cornerHeld = resolveAt({ x: 0.32, y: 0.3 }, corner.snapKind);
  const seam = resolveAt({ x: 0.33, y: 0.305 }, cornerHeld.snapKind);
  const seamHeld = resolveAt({ x: 0.33, y: 0.319 }, seam.snapKind);
  const released = resolveAt({ x: 0.33, y: 0.321 }, seamHeld.snapKind);
  const cornerReentered = resolveAt({ x: 0.31, y: 0.3 }, released.snapKind);
  assert.equal(free.snapKind, null);
  assert.equal(corner.snapKind, "corner");
  assert.equal(cornerHeld.snapKind, "corner");
  assert.equal(seam.snapKind, "seam");
  assert.equal(seamHeld.snapKind, "seam");
  assert.equal(released.snapKind, null);
  assert.equal(cornerReentered.snapKind, "corner");
  assert.equal(WALL_FLOOR_SNAP_RELEASE_PX, 22);
  assert.equal(WALL_FLOOR_SEAM_SNAP_RELEASE_PX, 16);
});

test("snap hysteresis is not reused across wall handles", () => {
  const withinOnlyTheSeamReleaseBand = { x: 0.5, y: 0.315 };
  const firstHandle = resolveWallFloorPointSnap(
    input({
      activeSnapKind: "seam",
      unsnappedWallPointSourceNorm: withinOnlyTheSeamReleaseBand,
      pointerContainerNorm: withinOnlyTheSeamReleaseBand,
    })
  );
  const nextHandle = resolveWallFloorPointSnap(
    input({
      wallKind: "wall_back",
      wallPointRole: "lower_right",
      activeSnapKind: null,
      unsnappedWallPointSourceNorm: withinOnlyTheSeamReleaseBand,
      pointerContainerNorm: withinOnlyTheSeamReleaseBand,
    })
  );
  assert.equal(firstHandle.snapKind, "seam");
  assert.equal(nextHandle.snapKind, null);
  assert.equal(WALL_FLOOR_SEAM_SNAP_ENTER_PX, 10);
});

test("persists the same source-normalized seam projection across displays", () => {
  const dragged = { x: 0.2519402850002907, y: 0.5506063390625909 };
  const expectedProjection = projectSourceNormPointToSegment(
    dragged,
    FLOOR.NL,
    FLOOR.FL,
    INTRINSIC
  );
  assert.ok(expectedProjection);
  const frames = [
    { width: 1000, height: 800 },
    { width: 1500, height: 1200 },
    { width: 1200, height: 600 },
  ];
  const results = frames.map((frameSize) => {
    const pointerContainerNorm = sourceNormToContainerNorm(dragged, INTRINSIC, frameSize);
    assert.ok(pointerContainerNorm);
    return resolveWallFloorPointSnap(
      input({
        wallKind: "wall_left",
        wallPointRole: "lower_right",
        unsnappedWallPointSourceNorm: dragged,
        pointerContainerNorm,
        frameSize,
      })
    );
  });
  for (const result of results) {
    assert.equal(result.snapKind, "seam");
    assertPointNear(result.pointSourceNorm, expectedProjection.pointSourceNorm);
  }
  assert.deepEqual(results[0].pointSourceNorm, results[1].pointSourceNorm);
  assert.deepEqual(results[1].pointSourceNorm, results[2].pointSourceNorm);
});

test("fails closed for unavailable authority, invalid context, bad geometry, and upper handles", () => {
  const draft = { x: 0.1, y: 0.1 };
  const degenerateFloor = { ...FLOOR, NL: FLOOR.FL };
  const cases = [
    resolveWallFloorPointSnap(input({ available: false })),
    resolveWallFloorPointSnap(input({ floorSourceCorners: { ...FLOOR, FL: undefined } })),
    resolveWallFloorPointSnap(input({ intrinsicSize: { width: 0, height: 800 } })),
    resolveWallFloorPointSnap(input({ frameSize: { width: Number.NaN, height: 800 } })),
    resolveWallFloorPointSnap(
      input({
        wallKind: "wall_left",
        wallPointRole: "lower_right",
        floorSourceCorners: degenerateFloor,
        pointerContainerNorm: { x: 0.5, y: 0.5 },
      })
    ),
    resolveWallFloorPointSnap(input({ pointerContainerNorm: { x: Number.NaN, y: 0.3 } })),
    resolveWallFloorPointSnap(input({ wallPointRole: null })),
  ];
  for (const result of cases) {
    assert.equal(result.snapped, false);
    assert.equal(result.snapKind, null);
    assert.deepEqual(result.pointSourceNorm, draft);
  }
  const nonFiniteDraft = { x: Number.NaN, y: 0.1 };
  const nonFinite = resolveWallFloorPointSnap(
    input({ unsnappedWallPointSourceNorm: nonFiniteDraft })
  );
  assert.equal(nonFinite.snapped, false);
  assert.deepEqual(nonFinite.pointSourceNorm, nonFiniteDraft);
  assert.equal(projectSourceNormPointToSegment(draft, FLOOR.NL, FLOOR.FL, null), null);
  assert.equal(projectSourceNormPointToSegment(draft, FLOOR.NL, FLOOR.NL, INTRINSIC), null);
});

test("repeated calls are deterministic and never mutate deep-frozen inputs", () => {
  const frozen = Object.freeze({
    ...input({
      floorSourceCorners: Object.freeze({
        NL: Object.freeze({ ...FLOOR.NL }),
        NR: Object.freeze({ ...FLOOR.NR }),
        FR: Object.freeze({ ...FLOOR.FR }),
        FL: Object.freeze({ ...FLOOR.FL }),
      }),
      unsnappedWallPointSourceNorm: Object.freeze({ x: 0.1, y: 0.1 }),
      pointerContainerNorm: Object.freeze({ x: 0.3, y: 0.3 }),
      intrinsicSize: Object.freeze({ ...INTRINSIC }),
      frameSize: Object.freeze({ ...FRAME }),
    }),
  });
  const before = structuredClone(frozen);
  assert.deepEqual(resolveWallFloorPointSnap(frozen), resolveWallFloorPointSnap(frozen));
  resolveWallFloorPointSnap(frozen);
  assert.deepEqual(frozen, before);
});
