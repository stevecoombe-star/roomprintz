import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyWorldTransformToPoint, footprintFromLocalAabb } from "./collision-footprint";
import { resolveSceneObjectCollision } from "./collision-resolver";
import {
  clippedMinInteriorDistance,
  prepareCollisionWall,
} from "./collision-geometry";
import { PI3A_REAR_WALL, PI3A_RIGHT_WALL } from "./pi3a-test-fixture";
import {
  collisionWallTangentAngleDeg,
  idlePushAlignSession,
  nearestWallRelativeYaw,
  planCanonicalMoveDrag,
  PUSH_ALIGN_ENGAGE_M,
  resolveExplicitYaw,
  SHIFT_ROTATE_DEGREES_PER_PIXEL,
  shiftRotateYawFromPointerX,
  wallRelativeQuarterYaws,
  worldPointFromLocalContact,
  type PushAlignSession,
  type ShiftRotateBaseline,
} from "./move-gesture";
import type { LocalAabb, RuntimeCollisionWall, RuntimeTransformMode, WorldTransform } from "./types";
import { wrapSceneRotationDeg } from "./viewport-interaction";

function pixelsForDegrees(degrees: number): number {
  return degrees / SHIFT_ROTATE_DEGREES_PER_PIXEL;
}

const BOX: LocalAabb = Object.freeze({
  min: Object.freeze({ x: -0.5, y: 0, z: -0.25 }),
  max: Object.freeze({ x: 0.5, y: 0.7, z: 0.25 }),
});

function pose(x: number, z: number, yaw: number): WorldTransform {
  return {
    position: { x, y: 0, z },
    rotationDeg: { x: 0, y: yaw, z: 0 },
    uniformScale: 1,
  };
}

function angledWall(
  tangentDeg: number,
  through: Readonly<{ x: number; z: number }> = { x: 1, z: 0 },
): RuntimeCollisionWall {
  const rad = (tangentDeg * Math.PI) / 180;
  const tx = Math.cos(rad);
  const tz = Math.sin(rad);
  const ix = -tz;
  const iz = tx;
  const interiorConstant = -(ix * through.x + iz * through.z);
  const sideSign = -1 as const;
  return {
    id: `wall-${tangentDeg}`,
    sourceBoundaryId: `wall-${tangentDeg}`,
    sourceSeamId: `seam-${tangentDeg}`,
    a: { x: through.x - tx * 4, z: through.z - tz * 4 },
    b: { x: through.x + tx * 4, z: through.z + tz * 4 },
    supportPlaneNormal: { x: -ix, y: 0, z: -iz },
    supportPlaneConstant: interiorConstant / sideSign,
    sideSign,
  };
}

function clearance(
  transform: WorldTransform,
  walls: readonly RuntimeCollisionWall[],
): number {
  const footprint = footprintFromLocalAabb(BOX, transform);
  let min = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    const prepared = prepareCollisionWall(wall);
    if (!prepared) continue;
    const distance = clippedMinInteriorDistance(footprint, prepared);
    if (distance !== null) min = Math.min(min, distance);
  }
  return min;
}

type Sim = {
  current: WorldTransform;
  assist: PushAlignSession;
  baseline: ShiftRotateBaseline | null;
  lastDesired: { x: number; z: number } | null;
};

function simAt(transform: WorldTransform): Sim {
  return {
    current: transform,
    assist: idlePushAlignSession(),
    baseline: null,
    lastDesired: null,
  };
}

function step(
  sim: Sim,
  input: Readonly<{
    desiredX: number;
    desiredZ: number;
    mode?: RuntimeTransformMode;
    shiftHeld?: boolean;
    pointerX?: number;
    pointerDelta?: { x: number; z: number } | null;
    walls: readonly RuntimeCollisionWall[];
  }>,
) {
  const pointerDelta = input.pointerDelta === undefined
    ? (sim.lastDesired
      ? {
        x: input.desiredX - sim.lastDesired.x,
        z: input.desiredZ - sim.lastDesired.z,
      }
      : null)
    : input.pointerDelta;
  const plan = planCanonicalMoveDrag({
    mode: input.mode ?? "move",
    shiftHeld: input.shiftHeld === true,
    current: sim.current,
    desiredPosition: { x: input.desiredX, y: 0, z: input.desiredZ },
    pointerX: input.pointerX ?? 0,
    pointerWorld: { x: input.desiredX, z: input.desiredZ },
    pointerDelta,
    shiftBaseline: sim.baseline,
    localAabb: BOX,
    walls: input.walls,
    assist: sim.assist,
  });
  sim.current = plan.transform;
  sim.assist = plan.assist;
  sim.baseline = plan.shiftBaseline;
  sim.lastDesired = plan.releaseGrab
    ? { x: plan.transform.position.x, z: plan.transform.position.z }
    : { x: input.desiredX, z: input.desiredZ };
  return plan;
}

test("move without Shift translates and Shift rotates around Y", () => {
  const open: RuntimeCollisionWall[] = [];
  const moving = simAt(pose(0, 0, 0));
  const translated = step(moving, { desiredX: 0.4, desiredZ: -0.2, walls: open });
  assert.equal(translated.kind, "translate");
  assert.equal(translated.transform.rotationDeg.y, 0);
  assert.ok(Math.abs(translated.transform.position.x - 0.4) < 1e-9);
  assert.ok(Math.abs(translated.transform.position.z + 0.2) < 1e-9);

  const rotating = simAt(pose(0.4, -0.2, 0));
  rotating.baseline = { yawDeg: 0, pointerX: 0 };
  const shifted = step(rotating, {
    desiredX: 1.5,
    desiredZ: 1.5,
    shiftHeld: true,
    pointerX: pixelsForDegrees(25),
    walls: open,
  });
  assert.equal(shifted.kind, "shift-rotate");
  assert.equal(shifted.transform.rotationDeg.y, 25);
  assert.equal(shifted.transform.position.x, 0.4);
  assert.equal(shifted.transform.position.z, -0.2);
  assert.equal(shifted.assist.phase, "idle");

  const released = step(rotating, {
    desiredX: 0.7,
    desiredZ: -0.5,
    shiftHeld: false,
    walls: open,
  });
  assert.equal(released.kind, "translate");
  assert.equal(released.transform.rotationDeg.y, 25);
  assert.ok(Math.abs(released.transform.position.x - 0.7) < 1e-9);
  assert.ok(Math.abs(released.transform.position.z + 0.5) < 1e-9);
  assert.equal(released.shiftBaseline, null);
});

test("pressing Shift mid-move rebases at the current pointer X, including a later re-press", () => {
  const open: RuntimeCollisionWall[] = [];
  const current = pose(0.4, -0.2, 12);
  const pressed = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current,
    desiredPosition: { x: 2, y: 0, z: 2 },
    pointerX: 400,
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: null,
    localAabb: BOX,
    walls: open,
    assist: idlePushAlignSession(),
  });
  assert.equal(pressed.kind, "shift-rotate");
  assert.equal(pressed.transform.rotationDeg.y, 12);
  assert.equal(pressed.transform.position.x, 0.4);
  assert.equal(pressed.shiftBaseline?.pointerX, 400);
  assert.equal(pressed.shiftBaseline?.yawDeg, 12);

  const dragged = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current: pressed.transform,
    desiredPosition: { x: 3, y: 0, z: 3 },
    pointerX: 400 + pixelsForDegrees(20),
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: pressed.shiftBaseline,
    localAabb: BOX,
    walls: open,
    assist: pressed.assist,
  });
  assert.equal(dragged.transform.rotationDeg.y, 32);
  assert.equal(dragged.transform.position.x, 0.4);

  const released = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: false,
    current: dragged.transform,
    desiredPosition: { x: 0.15, y: 0, z: 0.05 },
    pointerX: 900,
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: null,
    localAabb: BOX,
    walls: open,
    assist: dragged.assist,
  });
  assert.equal(released.kind, "translate");
  assert.equal(released.transform.rotationDeg.y, 32);
  assert.ok(Math.abs(released.transform.position.x - 0.15) < 1e-9);
  assert.equal(released.shiftBaseline, null);

  const repressed = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current: released.transform,
    desiredPosition: { x: 0.15, y: 0, z: 0.05 },
    pointerX: 1200,
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: null,
    localAabb: BOX,
    walls: open,
    assist: idlePushAlignSession(),
  });
  assert.equal(repressed.transform.rotationDeg.y, 32);
  assert.equal(repressed.shiftBaseline?.pointerX, 1200);
  assert.equal(repressed.shiftBaseline?.yawDeg, 32);

  const continued = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current: repressed.transform,
    desiredPosition: { x: 0.15, y: 0, z: 0.05 },
    pointerX: 1200 + pixelsForDegrees(15),
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: repressed.shiftBaseline,
    localAabb: BOX,
    walls: open,
    assist: repressed.assist,
  });
  assert.equal(continued.transform.rotationDeg.y, 47);
  assert.equal(continued.transform.position.x, 0.15);
});

test("Shift yaw follows horizontal pixels and ignores vertical movement", () => {
  const right = shiftRotateYawFromPointerX(0, 100, 100 + pixelsForDegrees(40));
  const left = shiftRotateYawFromPointerX(0, 100, 100 - pixelsForDegrees(40));
  const vertical = shiftRotateYawFromPointerX(10, 100, 100);
  assert.equal(right, 40);
  assert.equal(left, -40);
  assert.equal(vertical, 10);
  assert.ok(right > 0);
  assert.ok(left < 0);

  const before = applyWorldTransformToPoint({ x: 1, y: 0, z: 0 }, pose(0, 0, 0));
  const afterRight = applyWorldTransformToPoint({ x: 1, y: 0, z: 0 }, pose(0, 0, right));
  const afterLeft = applyWorldTransformToPoint({ x: 1, y: 0, z: 0 }, pose(0, 0, left));
  assert.ok(afterRight.z < before.z);
  assert.ok(afterLeft.z > before.z);

  const open: RuntimeCollisionWall[] = [];
  const held = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current: pose(0, 0, 10),
    desiredPosition: { x: 0, y: 0, z: 0 },
    pointerX: 100,
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: { yawDeg: 10, pointerX: 100 },
    localAabb: BOX,
    walls: open,
    assist: idlePushAlignSession(),
  });
  assert.equal(held.transform.rotationDeg.y, 10);
});

test("one Shift drag accumulates past a full turn without reversing", () => {
  const open: RuntimeCollisionWall[] = [];
  const baseline: ShiftRotateBaseline = { yawDeg: 0, pointerX: 0 };
  let previous = 0;
  for (let degrees = 30; degrees <= 720; degrees += 30) {
    const unwrapped = shiftRotateYawFromPointerX(0, 0, pixelsForDegrees(degrees));
    assert.equal(unwrapped, degrees);
    const plan = planCanonicalMoveDrag({
      mode: "move",
      shiftHeld: true,
      current: pose(0, 0, previous),
      desiredPosition: { x: 1, y: 0, z: 1 },
      pointerX: pixelsForDegrees(degrees),
      pointerWorld: null,
      pointerDelta: null,
      shiftBaseline: baseline,
      localAabb: BOX,
      walls: open,
      assist: idlePushAlignSession(),
    });
    const stored = plan.transform.rotationDeg.y;
    assert.ok(Math.abs(stored - wrapSceneRotationDeg(degrees)) < 1e-9);
    assert.ok(Math.abs(wrapSceneRotationDeg(stored - previous) - 30) < 1e-6);
    assert.equal(plan.transform.position.x, 0);
    assert.equal(plan.shiftBaseline?.yawDeg, 0);
    assert.equal(plan.shiftBaseline?.pointerX, 0);
    previous = stored;
  }
  assert.equal(shiftRotateYawFromPointerX(0, 0, pixelsForDegrees(180)), 180);
  assert.equal(shiftRotateYawFromPointerX(0, 0, pixelsForDegrees(360)), 360);
  assert.equal(shiftRotateYawFromPointerX(0, 0, pixelsForDegrees(720)), 720);
});

test("explicit Rotate uses the same yaw pose path as Shift", () => {
  const open: RuntimeCollisionWall[] = [];
  const explicit = resolveExplicitYaw({
    current: pose(0.2, 0.1, 10),
    yawDeg: 40,
    localAabb: BOX,
    walls: open,
  });
  const shifted = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current: pose(0.2, 0.1, 10),
    desiredPosition: { x: 9, y: 0, z: 9 },
    pointerX: pixelsForDegrees(30),
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: { yawDeg: 10, pointerX: 0 },
    localAabb: BOX,
    walls: open,
    assist: idlePushAlignSession(),
  });
  assert.equal(explicit.transform.rotationDeg.y, 40);
  assert.equal(shifted.transform.rotationDeg.y, 40);
  assert.equal(shifted.transform.position.x, explicit.transform.position.x);
  assert.equal(shifted.kind, "shift-rotate");

  const blocked = resolveExplicitYaw({
    current: pose(0.7, 0, 90),
    yawDeg: 0,
    localAabb: BOX,
    walls: [PI3A_RIGHT_WALL],
  });
  const blockedShift = planCanonicalMoveDrag({
    mode: "move",
    shiftHeld: true,
    current: pose(0.7, 0, 90),
    desiredPosition: { x: 0.7, y: 0, z: 0 },
    pointerX: -pixelsForDegrees(90),
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: { yawDeg: 90, pointerX: 0 },
    localAabb: BOX,
    walls: [PI3A_RIGHT_WALL],
    assist: idlePushAlignSession(),
  });
  assert.equal(blocked.status, "rejected_pose");
  assert.equal(blocked.transform.rotationDeg.y, 90);
  assert.equal(blockedShift.transform.rotationDeg.y, 90);
  assert.equal(blockedShift.transform.position.x, 0.7);

  const rotateMode = planCanonicalMoveDrag({
    mode: "rotate",
    shiftHeld: true,
    current: pose(0, 0, 15),
    desiredPosition: { x: 0.3, y: 0, z: 0.1 },
    pointerX: pixelsForDegrees(80),
    pointerWorld: null,
    pointerDelta: null,
    shiftBaseline: null,
    localAabb: BOX,
    walls: open,
    assist: idlePushAlignSession(),
  });
  assert.equal(rotateMode.kind, "translate");
  assert.equal(rotateMode.transform.rotationDeg.y, 15);
  assert.ok(Math.abs(rotateMode.transform.position.x - 0.3) < 1e-9);
});

test("wall-relative quarter turns follow the wall tangent", () => {
  assert.deepEqual(wallRelativeQuarterYaws(0), [0, 90, 180, -90]);
  assert.deepEqual(wallRelativeQuarterYaws(90), [-90, 0, 90, 180]);
  assert.deepEqual(wallRelativeQuarterYaws(17), [-17, 73, 163, -107]);

  assert.equal(nearestWallRelativeYaw(10, 0), 0);
  assert.equal(nearestWallRelativeYaw(80, 0), 90);
  assert.equal(nearestWallRelativeYaw(170, 0), 180);
  assert.equal(nearestWallRelativeYaw(-100, 0), -90);
  assert.equal(nearestWallRelativeYaw(45, 0), 0);

  assert.equal(nearestWallRelativeYaw(20, 90), 0);
  assert.equal(nearestWallRelativeYaw(60, 90), 90);
  assert.equal(nearestWallRelativeYaw(-20, 90), 0);
  assert.equal(nearestWallRelativeYaw(160, 90), 180);

  assert.equal(nearestWallRelativeYaw(0, 17), -17);
  assert.equal(nearestWallRelativeYaw(30, 17), 73);
  assert.equal(nearestWallRelativeYaw(35, 17), 73);
  assert.equal(nearestWallRelativeYaw(170, 17), 163);
  assert.equal(nearestWallRelativeYaw(-10, 17), -17);

  const right = collisionWallTangentAngleDeg(PI3A_RIGHT_WALL);
  assert.equal(right, 90);
  const angled = angledWall(17);
  const angledTangent = collisionWallTangentAngleDeg(angled);
  assert.ok(angledTangent !== null && Math.abs(angledTangent - 17) < 1e-6);
});

test("push-to-align waits for real inward pressure, then pivots to the wall", () => {
  const walls = [PI3A_RIGHT_WALL];
  const free = step(simAt(pose(0, 0, 35)), {
    desiredX: 0.15,
    desiredZ: 0,
    walls,
  });
  assert.equal(free.kind, "translate");
  assert.equal(free.assist.phase, "idle");
  assert.equal(free.transform.rotationDeg.y, 35);

  const resting = simAt(pose(0.2, 0, 35));
  const contacted = step(resting, { desiredX: 3, desiredZ: 0, walls });
  assert.equal(contacted.kind, "push-align");
  const contactYaw = contacted.transform.rotationDeg.y;
  assert.ok(contactYaw < 35);
  assert.ok(contactYaw > 35 - 8.01);
  assert.equal(contacted.assist.targetYawDeg, 0);
  assert.equal(contacted.assist.wallId, PI3A_RIGHT_WALL.id);
  assert.ok(clearance(contacted.transform, walls) >= -1e-6);

  const barely = step(simAt(contacted.transform), {
    desiredX: contacted.transform.position.x + PUSH_ALIGN_ENGAGE_M * 0.4,
    desiredZ: contacted.transform.position.z,
    walls,
    pointerDelta: { x: 0.01, z: 0 },
  });
  assert.equal(barely.assist.phase, "idle");
  assert.equal(barely.transform.rotationDeg.y, contactYaw);

  const aligned = simAt(pose(0.2, 0, 0.4));
  const skip = step(aligned, { desiredX: 3, desiredZ: 0, walls });
  assert.equal(skip.kind, "translate");
  assert.equal(skip.transform.rotationDeg.y, 0.4);
  assert.equal(skip.assist.phase, "idle");
});

test("continued push settles on the locked quarter turn without crossing the wall", () => {
  const walls = [PI3A_RIGHT_WALL];
  const sim = simAt(pose(0.2, 0, 35));
  let target: number | null = null;
  let contact: { x: number; z: number } | null = null;
  for (let i = 0; i < 12; i += 1) {
    const plan = step(sim, {
      desiredX: sim.current.position.x + 0.2,
      desiredZ: sim.current.position.z,
      walls,
      pointerDelta: { x: 0.2, z: 0 },
    });
    assert.ok(clearance(plan.transform, walls) >= -1e-6);
    if (plan.assist.phase !== "idle") {
      target = plan.assist.targetYawDeg;
      assert.equal(target, 0);
      contact = {
        x: plan.assist.contactWorldX ?? 0,
        z: plan.assist.contactWorldZ ?? 0,
      };
      if (
        plan.assist.contactLocalX !== null &&
        plan.assist.contactLocalZ !== null
      ) {
        const pinned = worldPointFromLocalContact(
          plan.transform.position,
          plan.transform.rotationDeg.y,
          { x: plan.assist.contactLocalX, z: plan.assist.contactLocalZ },
        );
        assert.ok(Math.abs(pinned.x - contact.x) < 1e-6);
        assert.ok(Math.abs(pinned.z - contact.z) < 1e-6);
      }
    }
  }
  assert.equal(sim.assist.phase, "settled");
  assert.ok(Math.abs(sim.current.rotationDeg.y) < 0.5);
  assert.equal(target, 0);
  assert.ok(clearance(sim.current, walls) >= -1e-6);

  const held = step(sim, {
    desiredX: sim.current.position.x + 0.15,
    desiredZ: sim.current.position.z,
    walls,
    pointerDelta: { x: 0.15, z: 0 },
  });
  assert.equal(held.kind, "translate");
  assert.ok(Math.abs(held.transform.rotationDeg.y) < 0.5);
  assert.ok(clearance(held.transform, walls) >= -1e-6);
});

test("pulling away cancels assist and the opposite yaw still settles", () => {
  const walls = [PI3A_RIGHT_WALL];
  const sim = simAt(pose(0.2, 0, 35));
  const first = step(sim, {
    desiredX: 3,
    desiredZ: 0,
    walls,
    pointerDelta: { x: 0.3, z: 0 },
  });
  assert.equal(first.assist.phase, "aligning");
  const partial = first.transform.rotationDeg.y;

  const pulled = step(sim, {
    desiredX: sim.current.position.x - 0.2,
    desiredZ: sim.current.position.z,
    walls,
    pointerDelta: { x: -0.08, z: 0 },
  });
  assert.equal(pulled.kind, "translate");
  assert.equal(pulled.assist.phase, "idle");
  assert.equal(pulled.transform.rotationDeg.y, partial);
  assert.ok(pulled.transform.position.x < first.transform.position.x + 1e-6);

  const other = simAt(pose(0.2, 0, -40));
  for (let i = 0; i < 12; i += 1) {
    const plan = step(other, {
      desiredX: other.current.position.x + 0.2,
      desiredZ: 0,
      walls,
      pointerDelta: { x: 0.2, z: 0 },
    });
    assert.ok(clearance(plan.transform, walls) >= -1e-6);
    if (plan.assist.targetYawDeg !== null) {
      assert.equal(plan.assist.targetYawDeg, 0);
    }
  }
  assert.equal(other.assist.phase, "settled");
  assert.ok(Math.abs(other.current.rotationDeg.y) < 0.5);
  assert.ok(other.current.rotationDeg.y > -40);
});

test("a locked target does not flip at the quarter-turn boundary", () => {
  const walls = [PI3A_RIGHT_WALL];
  assert.equal(nearestWallRelativeYaw(45, 90), 0);
  assert.equal(nearestWallRelativeYaw(45.2, 90), 90);

  const tied = simAt(pose(0.2, 0, 45));
  const first = step(tied, {
    desiredX: 3,
    desiredZ: 0,
    walls,
    pointerDelta: { x: 0.25, z: 0 },
  });
  assert.equal(first.assist.targetYawDeg, 0);
  const second = step(tied, {
    desiredX: tied.current.position.x + 0.2,
    desiredZ: 0,
    walls,
    pointerDelta: { x: 0.2, z: 0 },
  });
  assert.equal(second.assist.targetYawDeg, 0);
  assert.ok(second.transform.rotationDeg.y < 45);

  const justOver = simAt(pose(0.2, 0, 45.2));
  const over = step(justOver, {
    desiredX: 3,
    desiredZ: 0,
    walls,
    pointerDelta: { x: 0.25, z: 0 },
  });
  assert.equal(over.assist.targetYawDeg, 90);
  assert.ok(over.transform.rotationDeg.y > 45.2);
});

test("an angled wall aligns to its own tangent and stays the chosen wall", () => {
  const wall = angledWall(17, { x: 0, z: 0 });
  const tangent = collisionWallTangentAngleDeg(wall);
  assert.ok(tangent !== null && Math.abs(tangent - 17) < 1e-6);
  const yaw = 35;
  const expected = nearestWallRelativeYaw(yaw, 17);
  assert.equal(expected, 73);
  const rad = (17 * Math.PI) / 180;
  const into = { x: -Math.sin(rad), z: Math.cos(rad) };
  const start = pose(into.x * 0.85, into.z * 0.85, yaw);
  const sim = simAt(start);
  let seen: number | null = null;
  for (let i = 0; i < 14; i += 1) {
    const plan = step(sim, {
      desiredX: sim.current.position.x - into.x * 0.25,
      desiredZ: sim.current.position.z - into.z * 0.25,
      walls: [wall],
      pointerDelta: { x: -into.x * 0.2, z: -into.z * 0.2 },
    });
    assert.ok(clearance(plan.transform, [wall]) >= -1e-6, `clearance ${clearance(plan.transform, [wall])}`);
    if (plan.assist.targetYawDeg !== null) {
      if (seen === null) seen = plan.assist.targetYawDeg;
      assert.equal(plan.assist.targetYawDeg, seen);
      assert.equal(plan.assist.wallId, wall.id);
      if (
        plan.assist.contactLocalX !== null &&
        plan.assist.contactLocalZ !== null &&
        plan.assist.contactWorldX !== null &&
        plan.assist.contactWorldZ !== null
      ) {
        const pinned = worldPointFromLocalContact(
          plan.transform.position,
          plan.transform.rotationDeg.y,
          { x: plan.assist.contactLocalX, z: plan.assist.contactLocalZ },
        );
        assert.ok(Math.abs(pinned.x - plan.assist.contactWorldX) < 1e-6);
        assert.ok(Math.abs(pinned.z - plan.assist.contactWorldZ) < 1e-6);
      }
    }
  }
  assert.equal(seen, 73);
  assert.equal(sim.assist.phase, "settled");
  assert.ok(Math.abs(sim.current.rotationDeg.y - 73) < 0.5);
});

test("two walls pick the contacted wall and keep that target", () => {
  const right = PI3A_RIGHT_WALL;
  const sim = simAt(pose(0.2, 0, 35));
  const plan = step(sim, {
    desiredX: 3,
    desiredZ: 0,
    walls: [PI3A_REAR_WALL, right],
  });
  assert.equal(plan.assist.wallId, right.id);
  assert.equal(plan.assist.targetYawDeg, 0);
  const again = step(sim, {
    desiredX: sim.current.position.x + 0.2,
    desiredZ: 0,
    walls: [PI3A_REAR_WALL, right],
    pointerDelta: { x: 0.2, z: 0 },
  });
  assert.equal(again.assist.wallId, right.id);
  assert.equal(again.assist.targetYawDeg, 0);
});

test("a corner push does not cross either wall and repeats the same result", () => {
  const walls = [PI3A_REAR_WALL, PI3A_RIGHT_WALL];
  const start = pose(0.15, -1.2, 20);
  const moved = resolveSceneObjectCollision({
    current: start,
    proposed: { ...start, position: { x: 2, y: 0, z: -3 } },
    localAabb: BOX,
    walls,
    mode: "move",
  });
  assert.deepEqual([...moved.contactWallIds], ["rb_back", "rb_right"]);
  assert.ok(clearance(moved.transform, walls) >= -1e-6);

  const once = step(simAt(start), {
    desiredX: 2,
    desiredZ: -3,
    walls,
    pointerDelta: { x: 0.5, z: -0.5 },
  });
  const twice = step(simAt(start), {
    desiredX: 2,
    desiredZ: -3,
    walls,
    pointerDelta: { x: 0.5, z: -0.5 },
  });
  assert.equal(once.kind, twice.kind);
  assert.equal(once.assist.wallId, twice.assist.wallId);
  assert.equal(once.assist.targetYawDeg, twice.assist.targetYawDeg);
  assert.equal(once.transform.rotationDeg.y, twice.transform.rotationDeg.y);
  assert.ok(clearance(once.transform, walls) >= -1e-6);
  assert.ok(clearance(twice.transform, walls) >= -1e-6);
  if (once.kind === "translate") {
    assert.equal(once.transform.rotationDeg.y, 20);
  }
});

/**
 * Mirrors the viewer grab: desired = hit − offset, and releaseGrab recaptures
 * offset from the placed pose. lastDesired follows the unclamped desired when
 * the grab is not recaptured, which is how through-wall slack used to become
 * a later translation.
 */
function grabDrag(start: WorldTransform, walls: readonly RuntimeCollisionWall[]) {
  let current = start;
  let assist = idlePushAlignSession();
  let offsetX = 0;
  let offsetZ = 0;
  let lastDesired: { x: number; z: number } | null = null;
  const sample = (hitX: number, hitZ: number) => {
    const desiredX = hitX - offsetX;
    const desiredZ = hitZ - offsetZ;
    const pointerDelta = lastDesired
      ? { x: desiredX - lastDesired.x, z: desiredZ - lastDesired.z }
      : null;
    const beforeX = current.position.x;
    const beforeZ = current.position.z;
    const plan = planCanonicalMoveDrag({
      mode: "move",
      shiftHeld: false,
      current,
      desiredPosition: { x: desiredX, y: 0, z: desiredZ },
      pointerX: 0,
      pointerWorld: { x: hitX, z: hitZ },
      pointerDelta,
      shiftBaseline: null,
      localAabb: BOX,
      walls,
      assist,
    });
    current = plan.transform;
    assist = plan.assist;
    if (plan.releaseGrab) {
      offsetX = hitX - current.position.x;
      offsetZ = hitZ - current.position.z;
      lastDesired = { x: current.position.x, z: current.position.z };
    } else {
      lastDesired = { x: desiredX, z: desiredZ };
    }
    const moved = Math.hypot(current.position.x - beforeX, current.position.z - beforeZ);
    const replayedDebt = pointerDelta
      ? Math.hypot(
        current.position.x - (beforeX + pointerDelta.x),
        current.position.z - (beforeZ + pointerDelta.z),
      )
      : 0;
    return { plan, pointerDelta, moved, replayedDebt, beforeX, beforeZ };
  };
  return {
    sample,
    pose: () => current,
    assist: () => assist,
    offset: () => ({ x: offsetX, z: offsetZ }),
  };
}

function pushUntilSettled(walls: readonly RuntimeCollisionWall[]) {
  const drag = grabDrag(pose(0.2, 0, 35), walls);
  let hitX = 0.2;
  for (let i = 0; i < 24 && drag.assist().phase !== "settled"; i += 1) {
    hitX += 0.1;
    drag.sample(hitX, 0);
  }
  assert.equal(drag.assist().phase, "settled");
  return { drag, hitX };
}

test("through-wall pointer travel is not translation debt when assist releases", () => {
  const walls = [PI3A_RIGHT_WALL];

  const pullAfterExtraPush = (extraMetres: number, pullMetres: number) => {
    const { drag, hitX: settledHit } = pushUntilSettled(walls);
    const settledX = drag.pose().position.x;
    const settledOffsetX = drag.offset().x;
    let hitX = settledHit;
    const steps = Math.max(1, Math.round(extraMetres / 0.1));
    for (let i = 0; i < steps; i += 1) {
      hitX += extraMetres / steps;
      const pushed = drag.sample(hitX, 0);
      assert.ok(pushed.moved < 0.05);
      assert.equal(drag.assist().phase, "settled");
    }
    const slack = (hitX - settledOffsetX) - drag.pose().position.x;
    assert.ok(slack > extraMetres * 0.5, `expected stored slack, got ${slack}`);
    const released = drag.sample(hitX - pullMetres, 0);
    return { drag, released, settledX, settledOffsetX, slack, hitX: hitX - pullMetres };
  };

  const small = pullAfterExtraPush(0.12, 0.05);
  assert.equal(small.released.plan.assist.phase, "idle");
  assert.equal(small.released.plan.kind, "translate");
  assert.ok(Math.abs(small.drag.pose().rotationDeg.y) < 0.5);
  assert.ok(
    small.released.moved < 0.02,
    `small push pull moved ${small.released.moved}`,
  );
  assert.ok(Math.abs(small.drag.pose().position.x - small.settledX) < 0.02);
  assert.ok(Math.abs(small.drag.offset().x - small.settledOffsetX) < 1e-9);

  const overrun = pullAfterExtraPush(0.12, 0.3);
  const overrunTarget = overrun.hitX - overrun.settledOffsetX;
  assert.ok(
    Math.abs(overrun.drag.pose().position.x - overrunTarget) < 0.02,
    `overrun landed at ${overrun.drag.pose().position.x}, grab target ${overrunTarget}`,
  );
  assert.ok(overrun.released.moved < 0.25);
  assert.ok(overrun.slack < 0.25);

  const large = pullAfterExtraPush(4, 1);
  assert.equal(large.released.plan.assist.phase, "idle");
  assert.ok(Math.abs(large.drag.pose().rotationDeg.y) < 0.5);
  assert.ok(
    large.released.moved < 0.02,
    `large push pull moved ${large.released.moved} (slack ${large.slack})`,
  );
  assert.ok(large.slack > 3);
  assert.ok(Math.abs(large.drag.offset().x - large.settledOffsetX) < 1e-9);
  const debtReplay = large.released.pointerDelta
    ? Math.hypot(
      large.drag.pose().position.x - (large.released.beforeX + large.released.pointerDelta.x),
      large.drag.pose().position.z - (large.released.beforeZ + large.released.pointerDelta.z),
    )
    : 0;
  assert.ok(debtReplay > 0.5);

  const huge = pullAfterExtraPush(8, 2);
  assert.ok(huge.released.moved < 0.02, `huge push pull moved ${huge.released.moved}`);
  assert.ok(Math.abs(huge.drag.pose().position.x - huge.settledX) < 0.02);

  const { drag, hitX: settledHit } = pushUntilSettled(walls);
  const settledX = drag.pose().position.x;
  const settledOffsetX = drag.offset().x;
  let hitX = settledHit;
  for (let i = 0; i < 40; i += 1) {
    hitX += 0.1;
    drag.sample(hitX, 0);
  }
  while (hitX - settledOffsetX > settledX - 0.2) {
    hitX -= 0.1;
    const frame = drag.sample(hitX, 0);
    assert.equal(frame.plan.assist.phase, "idle");
    assert.ok(
      drag.pose().position.x > settledX - 0.35,
      `object ran to ${drag.pose().position.x} from ${settledX}`,
    );
  }
  assert.ok(Math.abs(drag.pose().position.x - (settledX - 0.2)) < 0.08);
  const before = drag.pose().position.x;
  hitX -= 0.12;
  const followed = drag.sample(hitX, 0);
  assert.ok(Math.abs(followed.moved - 0.12) < 0.03, `1:1 move was ${followed.moved}`);
  assert.ok(Math.abs(drag.pose().position.x - (before - 0.12)) < 0.03);
  hitX -= 0.12;
  const followedAgain = drag.sample(hitX, 0);
  assert.ok(Math.abs(followedAgain.moved - 0.12) < 0.03);
});

test("partial pull-away keeps the post-pivot grab and does not multiply the pull", () => {
  const walls = [PI3A_RIGHT_WALL];
  const drag = grabDrag(pose(0.2, 0, 35), walls);
  let hitX = 0.2;
  let partialYaw = 35;
  for (let i = 0; i < 3; i += 1) {
    hitX += 0.15;
    const frame = drag.sample(hitX, 0);
    partialYaw = frame.plan.transform.rotationDeg.y;
  }
  assert.equal(drag.assist().phase, "aligning");
  const released = drag.sample(hitX - 0.2, 0);
  assert.equal(released.plan.assist.phase, "idle");
  assert.equal(released.plan.transform.rotationDeg.y, partialYaw);
  assert.ok(released.moved < 0.25, `partial pull moved ${released.moved}`);
  const before = drag.pose().position.x;
  const followed = drag.sample(hitX - 0.3, 0);
  assert.equal(followed.plan.assist.phase, "idle");
  assert.equal(followed.plan.transform.rotationDeg.y, partialYaw);
  assert.ok(Math.abs(followed.moved - 0.1) < 0.03, `follow moved ${followed.moved}`);
  assert.ok(Math.abs(drag.pose().position.x - (before - 0.1)) < 0.03);
});

test("an already aligned wall collision does not inherit assist translation", () => {
  const walls = [PI3A_RIGHT_WALL];
  const drag = grabDrag(pose(0.2, 0, 0), walls);
  let hitX = 0.2;
  for (let i = 0; i < 50; i += 1) {
    hitX += 0.1;
    const frame = drag.sample(hitX, 0);
    assert.equal(frame.plan.assist.phase, "idle");
    assert.equal(frame.plan.kind, "translate");
    assert.equal(drag.pose().rotationDeg.y, 0);
    assert.ok(drag.pose().position.x < 0.55);
  }
  const heldX = drag.pose().position.x;
  hitX -= 1;
  const pulled = drag.sample(hitX, 0);
  assert.ok(Math.abs(drag.pose().position.x - heldX) < 0.02);
  assert.ok(pulled.moved < 0.02);
  while (hitX > 0.25) {
    hitX -= 0.2;
    drag.sample(hitX, 0);
  }
  assert.ok(Math.abs(drag.pose().position.x - hitX) < 0.05);
  assert.equal(drag.pose().rotationDeg.y, 0);
});

test("the production viewer keeps explicit rotate and routes Move drags through the planner", () => {
  const viewer = readFileSync(
    "components/afc-3d/AfcProductionRoomViewer.tsx",
    "utf8",
  );
  assert.match(viewer, /resolveExplicitYaw/);
  assert.match(viewer, /planCanonicalMoveDrag/);
  assert.match(viewer, /resolveSceneObjectCollision/);
  assert.match(viewer, /commitRotationYDeg/);
  assert.match(viewer, /liveSceneObjectForBodyDrag/);
  assert.match(viewer, /shiftKey/);
  assert.match(viewer, /visibilitychange/);
  assert.match(viewer, /pointerX: clientX/);
  assert.match(viewer, /setPointerCapture/);
  assert.doesNotMatch(viewer, /pointerYawAngleDeg|pointerAngleDeg/);
});
