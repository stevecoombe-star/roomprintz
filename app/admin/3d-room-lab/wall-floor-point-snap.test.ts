import assert from "node:assert/strict";
import test from "node:test";
import {
  WALL_FLOOR_SNAP_ENTER_PX,
  WALL_FLOOR_SNAP_RELEASE_PX,
  getWallFloorSnapTarget,
  getWallLowerPointRole,
  resolveWallFloorPointSnap,
  type WallFloorPointSnapInput,
} from "./wall-floor-point-snap";

const INTRINSIC = { width: 1000, height: 800 };
const FRAME = { width: 1000, height: 800 };
const FLOOR = {
  NL: { x: 0.2, y: 0.8 },
  NR: { x: 0.8, y: 0.8 },
  FR: { x: 0.7, y: 0.3 },
  FL: { x: 0.3, y: 0.3 },
} as const;

function input(overrides: Partial<WallFloorPointSnapInput> = {}): WallFloorPointSnapInput {
  return {
    available: true,
    wallKind: "wall_back",
    wallPointRole: "lower_left",
    isSnapped: false,
    unsnappedWallPointSourceNorm: { x: 0.1, y: 0.1 },
    pointerContainerNorm: { x: 0.3, y: 0.3 },
    floorSourceCorners: FLOOR,
    intrinsicSize: INTRINSIC,
    frameSize: FRAME,
    ...overrides,
  };
}

test("maps every committed lower vertex role to its pinned Floor corner", () => {
  assert.equal(getWallFloorSnapTarget("wall_back", "lower_left"), "FL");
  assert.equal(getWallFloorSnapTarget("wall_back", "lower_right"), "FR");
  assert.equal(getWallFloorSnapTarget("wall_left", "lower_left"), "NL");
  assert.equal(getWallFloorSnapTarget("wall_left", "lower_right"), "FL");
  assert.equal(getWallFloorSnapTarget("wall_right", "lower_left"), "FR");
  assert.equal(getWallFloorSnapTarget("wall_right", "lower_right"), "NR");
});

test("upper vertices and unsupported roles fail closed", () => {
  assert.equal(getWallLowerPointRole(0), "lower_left");
  assert.equal(getWallLowerPointRole(1), "lower_right");
  assert.equal(getWallLowerPointRole(2), null);
  assert.equal(getWallLowerPointRole(3), null);
  assert.equal(getWallFloorSnapTarget("wall_back", null), null);
  assert.equal(getWallFloorSnapTarget("wall_back", "unsupported" as never), null);
});

test("uses inclusive enter threshold in displayed overlay pixels", () => {
  const target = FLOOR.FL;
  const justAbove = resolveWallFloorPointSnap(
    input({ pointerContainerNorm: { x: target.x + (WALL_FLOOR_SNAP_ENTER_PX + 0.01) / FRAME.width, y: target.y } })
  );
  const exact = resolveWallFloorPointSnap(
    input({ pointerContainerNorm: { x: target.x + WALL_FLOOR_SNAP_ENTER_PX / FRAME.width, y: target.y } })
  );
  const justBelow = resolveWallFloorPointSnap(
    input({ pointerContainerNorm: { x: target.x + (WALL_FLOOR_SNAP_ENTER_PX - 0.01) / FRAME.width, y: target.y } })
  );
  assert.equal(justAbove.snapped, false);
  assert.equal(exact.snapped, true);
  assert.equal(justBelow.snapped, true);
});

test("measures against object-cover display pixels rather than source-normalized distance", () => {
  const floor = { ...FLOOR, FL: { x: 0.25, y: 0.5 } };
  const exact = resolveWallFloorPointSnap(
    input({
      floorSourceCorners: floor,
      intrinsicSize: { width: 2000, height: 1000 },
      frameSize: { width: 1000, height: 1000 },
      pointerContainerNorm: { x: WALL_FLOOR_SNAP_ENTER_PX / 1000, y: 0.5 },
    })
  );
  const outside = resolveWallFloorPointSnap(
    input({
      floorSourceCorners: floor,
      intrinsicSize: { width: 2000, height: 1000 },
      frameSize: { width: 1000, height: 1000 },
      pointerContainerNorm: { x: (WALL_FLOOR_SNAP_ENTER_PX + 0.01) / 1000, y: 0.5 },
    })
  );
  assert.equal(exact.snapped, true);
  assert.equal(outside.snapped, false);
});

test("holds a snapped point through the release threshold and re-enters after release", () => {
  const target = FLOOR.FL;
  const held = resolveWallFloorPointSnap(
    input({
      isSnapped: true,
      pointerContainerNorm: { x: target.x + (WALL_FLOOR_SNAP_ENTER_PX + 1) / FRAME.width, y: target.y },
    })
  );
  const exactRelease = resolveWallFloorPointSnap(
    input({
      isSnapped: true,
      pointerContainerNorm: { x: target.x + WALL_FLOOR_SNAP_RELEASE_PX / FRAME.width, y: target.y },
    })
  );
  const released = resolveWallFloorPointSnap(
    input({
      isSnapped: true,
      pointerContainerNorm: { x: target.x + (WALL_FLOOR_SNAP_RELEASE_PX + 0.01) / FRAME.width, y: target.y },
    })
  );
  const reentered = resolveWallFloorPointSnap(
    input({
      isSnapped: released.snapped,
      pointerContainerNorm: { x: target.x + (WALL_FLOOR_SNAP_ENTER_PX - 0.01) / FRAME.width, y: target.y },
    })
  );
  assert.equal(held.snapped, true);
  assert.equal(exactRelease.snapped, true);
  assert.equal(released.snapped, false);
  assert.equal(reentered.snapped, true);
});

test("returns the exact mapped Floor source coordinate without averaging or rounding", () => {
  const floor = { ...FLOOR, FL: { x: 0.300000001, y: 0.299999999 } };
  const result = resolveWallFloorPointSnap(input({ floorSourceCorners: floor }));
  assert.equal(result.snapped, true);
  assert.deepEqual(result.pointSourceNorm, floor.FL);
  assert.notEqual(result.pointSourceNorm, floor.FL);
  assert.notDeepEqual(result.pointSourceNorm, { x: 0.3, y: 0.3 });
  assert.deepEqual(floor.FL, { x: 0.300000001, y: 0.299999999 });
});

test("considers only the explicit semantic target, not a nearer Floor corner", () => {
  const result = resolveWallFloorPointSnap(
    input({
      pointerContainerNorm: FLOOR.NL,
      floorSourceCorners: {
        ...FLOOR,
        FL: { x: 0.5, y: 0.5 },
      },
    })
  );
  assert.equal(result.floorCorner, "FL");
  assert.equal(result.snapped, false);
  assert.deepEqual(result.pointSourceNorm, { x: 0.1, y: 0.1 });
});

test("missing authority, invalid geometry, and upper-point drag leave the draft unchanged", () => {
  const missing = resolveWallFloorPointSnap(input({ floorSourceCorners: { ...FLOOR, FL: undefined } }));
  const invalidFrame = resolveWallFloorPointSnap(input({ frameSize: { width: Number.NaN, height: 800 } }));
  const missingContext = resolveWallFloorPointSnap(input({ intrinsicSize: null }));
  const upper = resolveWallFloorPointSnap(input({ wallPointRole: null }));
  for (const result of [missing, invalidFrame, missingContext, upper]) {
    assert.equal(result.snapped, false);
    assert.deepEqual(result.pointSourceNorm, { x: 0.1, y: 0.1 });
  }
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
