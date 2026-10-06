import {
  footprintFromLocalAabb,
  type Vec2,
} from "./collision-footprint";
import {
  interiorSignedDistance,
  prepareCollisionWall,
  type PreparedCollisionWall,
} from "./collision-geometry";
import {
  resolveSceneObjectCollision,
  type SceneCollisionResult,
} from "./collision-resolver";
import type { LocalAabb, RuntimeCollisionWall, RuntimeTransformMode, WorldTransform } from "./types";
import { wrapSceneRotationDeg } from "./viewport-interaction";

/** Blocked inward travel required before wall-assisted rotation starts. */
export const PUSH_ALIGN_ENGAGE_M = 0.05;

/** Pointer motion back into the room that cancels an active assist. */
export const PUSH_ALIGN_PULL_AWAY_M = 0.004;

/** Degrees of yaw applied per metre of continued inward pointer travel. */
export const PUSH_ALIGN_DEGREES_PER_METRE = 90;

export const PUSH_ALIGN_MAX_STEP_DEG = 8;

/** Remaining yaw at which the assist snaps to the locked quarter-turn. */
export const PUSH_ALIGN_SETTLE_DEG = 0.35;

/**
 * Objects already this close to a wall-relative quarter-turn do not start
 * assist, so a flush piece does not twitch.
 */
export const PUSH_ALIGN_ALIGNED_SKIP_DEG = 1.5;

export type PushAlignPhase = "idle" | "aligning" | "settled";

export type PushAlignSession = Readonly<{
  phase: PushAlignPhase;
  wallId: string | null;
  targetYawDeg: number | null;
  contactWorldX: number | null;
  contactWorldZ: number | null;
  contactLocalX: number | null;
  contactLocalZ: number | null;
}>;

export type ShiftRotateBaseline = Readonly<{
  yawDeg: number;
  pointerX: number;
}>;

/**
 * Yaw degrees added per pixel of horizontal pointer travel while Shift is held.
 *
 * The explicit Rotate slider covers a full turn in roughly 176px (~2°/px)
 * because that control is short. A viewport drag stays slower so a small
 * correction remains precise: 0.5°/px turns 180° in 360px and two full
 * revolutions in 1440px. The mapping is linear. There is no speed curve.
 *
 * Positive pointer X increases yaw. In this project's XYZ Euler, positive yaw
 * swings local +X toward world -Z, which is counter-clockwise when the room
 * camera looks in from +Z.
 */
export const SHIFT_ROTATE_DEGREES_PER_PIXEL = 0.5;

export type MoveGestureKind = "translate" | "shift-rotate" | "push-align";

export type MoveGesturePlan = Readonly<{
  kind: MoveGestureKind;
  transform: WorldTransform;
  assist: PushAlignSession;
  shiftBaseline: ShiftRotateBaseline | null;
  /**
   * The applied pose moved the object off the pointer grab. The caller
   * recaptures the grab so the next sample does not jump.
   */
  releaseGrab: boolean;
}>;

export function idlePushAlignSession(): PushAlignSession {
  return {
    phase: "idle",
    wallId: null,
    targetYawDeg: null,
    contactWorldX: null,
    contactWorldZ: null,
    contactLocalX: null,
    contactLocalZ: null,
  };
}

/**
 * Unwrapped yaw for a Shift drag. Horizontal pixels accumulate without a
 * ±180° clamp, so one gesture can pass 360° and keep going. Vertical pointer
 * movement is not an input. `resolveExplicitYaw` wraps only the stored pose.
 */
export function shiftRotateYawFromPointerX(
  baselineYawDeg: number,
  baselinePointerX: number,
  pointerX: number,
): number {
  return baselineYawDeg +
    (pointerX - baselinePointerX) * SHIFT_ROTATE_DEGREES_PER_PIXEL;
}

/**
 * Yaw values that put a furniture edge parallel to a wall.
 * `tangentAngleDeg` is atan2(tangent.z, tangent.x) in degrees.
 * Targets are ` -tangent + 90° * k `, wrapped to (-180, 180].
 */
export function wallRelativeQuarterYaws(tangentAngleDeg: number): readonly number[] {
  const base = wrapSceneRotationDeg(-tangentAngleDeg);
  return [0, 90, 180, 270].map((quarter) => wrapSceneRotationDeg(base + quarter));
}

export function nearestWallRelativeYaw(
  currentYawDeg: number,
  tangentAngleDeg: number,
): number {
  const targets = wallRelativeQuarterYaws(tangentAngleDeg);
  let best = targets[0] ?? 0;
  let bestAbs = Number.POSITIVE_INFINITY;
  let bestSigned = 0;
  for (const target of targets) {
    const signed = wrapSceneRotationDeg(target - currentYawDeg);
    const abs = Math.abs(signed);
    const closer = abs < bestAbs - 1e-9;
    const tiePrefersDecreasing = Math.abs(abs - bestAbs) <= 1e-9 && signed < bestSigned;
    if (closer || tiePrefersDecreasing) {
      best = target;
      bestAbs = abs;
      bestSigned = signed;
    }
  }
  return wrapSceneRotationDeg(best);
}

export function collisionWallTangentAngleDeg(
  wall: RuntimeCollisionWall,
): number | null {
  const prepared = prepareCollisionWall(wall);
  if (!prepared) return null;
  return wrapSceneRotationDeg(
    (Math.atan2(prepared.tangent.z, prepared.tangent.x) * 180) / Math.PI,
  );
}

/**
 * World position of a placement-local contact after a yaw change.
 * Uses the same XYZ Euler Y mapping as the footprint.
 */
export function worldPointFromLocalContact(
  center: Readonly<{ x: number; z: number }>,
  yawDeg: number,
  local: Readonly<{ x: number; z: number }>,
): { x: number; z: number } {
  const rotated = rotateLocalOffset(local, yawDeg);
  return { x: center.x + rotated.x, z: center.z + rotated.z };
}

/**
 * Shared pose authority for the explicit Rotate control and for Shift-rotate.
 * Position is unchanged. Wall collision accepts or rejects the whole pose.
 */
export function resolveExplicitYaw(input: Readonly<{
  current: WorldTransform;
  yawDeg: number;
  localAabb: LocalAabb | null;
  walls: readonly RuntimeCollisionWall[];
}>): SceneCollisionResult {
  return resolvePoseTransform({
    current: input.current,
    proposed: {
      ...input.current,
      rotationDeg: {
        ...input.current.rotationDeg,
        y: wrapSceneRotationDeg(input.yawDeg),
      },
      uniformScale: 1,
    },
    localAabb: input.localAabb,
    walls: input.walls,
  });
}

export function planCanonicalMoveDrag(input: Readonly<{
  mode: RuntimeTransformMode;
  shiftHeld: boolean;
  current: WorldTransform;
  desiredPosition: Readonly<{ x: number; y: number; z: number }>;
  pointerX: number;
  pointerWorld: Readonly<{ x: number; z: number }> | null;
  pointerDelta: Readonly<{ x: number; z: number }> | null;
  shiftBaseline: ShiftRotateBaseline | null;
  localAabb: LocalAabb | null;
  walls: readonly RuntimeCollisionWall[];
  assist: PushAlignSession;
}>): MoveGesturePlan {
  if (input.mode === "move" && input.shiftHeld) {
    const baseline = input.shiftBaseline ?? {
      yawDeg: input.current.rotationDeg.y,
      pointerX: input.pointerX,
    };
    const yaw = shiftRotateYawFromPointerX(
      baseline.yawDeg,
      baseline.pointerX,
      input.pointerX,
    );
    const resolved = resolveExplicitYaw({
      current: input.current,
      yawDeg: yaw,
      localAabb: input.localAabb,
      walls: input.walls,
    });
    return {
      kind: "shift-rotate",
      transform: forceScale(resolved.transform),
      assist: idlePushAlignSession(),
      shiftBaseline: baseline,
      releaseGrab: false,
    };
  }

  if (input.mode !== "move") {
    return translatePlan(input, idlePushAlignSession(), false);
  }

  if (input.assist.phase === "aligning" || input.assist.phase === "settled") {
    return continueAssist(input);
  }

  return maybeEngageAssist(input);
}

function continueAssist(input: Readonly<{
  current: WorldTransform;
  desiredPosition: Readonly<{ x: number; y: number; z: number }>;
  pointerWorld: Readonly<{ x: number; z: number }> | null;
  pointerDelta: Readonly<{ x: number; z: number }> | null;
  localAabb: LocalAabb | null;
  walls: readonly RuntimeCollisionWall[];
  assist: PushAlignSession;
}>): MoveGesturePlan {
  const wall = preparedById(input.walls, input.assist.wallId);
  if (!wall || !hasContact(input.assist)) {
    return resumeMove(input, idlePushAlignSession());
  }
  const inward = input.pointerDelta
    ? inwardMetres(input.pointerDelta, wall.interiorNormal)
    : 0;
  if (inward < -PUSH_ALIGN_PULL_AWAY_M) {
    // The floor grab captured on the last rotation/settle step is still the
    // baseline. pointerDelta is only the pull detector: lastDesired may sit
    // on the unclamped through-wall target while the object is collision-held,
    // and adding that delta would replay the slack as translation.
    return resumeMove(input, idlePushAlignSession());
  }
  if (input.assist.phase === "settled") {
    return translatePlan(input, input.assist, false);
  }
  const push = Math.max(0, inward);
  const advanced = advanceAlignment(input.current, input.assist, push, input);
  return {
    kind: advanced.moved ? "push-align" : "translate",
    transform: advanced.transform,
    assist: advanced.assist,
    shiftBaseline: null,
    releaseGrab: advanced.moved || advanced.assist.phase === "settled",
  };
}

function maybeEngageAssist(input: Readonly<{
  current: WorldTransform;
  desiredPosition: Readonly<{ x: number; y: number; z: number }>;
  pointerWorld: Readonly<{ x: number; z: number }> | null;
  pointerDelta: Readonly<{ x: number; z: number }> | null;
  localAabb: LocalAabb | null;
  walls: readonly RuntimeCollisionWall[];
  assist: PushAlignSession;
}>): MoveGesturePlan {
  const moved = resolveSceneObjectCollision({
    current: input.current,
    proposed: proposedTranslation(input.current, input.desiredPosition),
    localAabb: input.localAabb,
    walls: input.walls,
    mode: "move",
  });
  const translated = forceScale(moved.transform);
  const choice = chooseContactWall({
    current: input.current,
    translated,
    desired: input.desiredPosition,
    contactWallIds: moved.contactWallIds,
    walls: input.walls,
  });
  if (!choice || choice.inwardBlocked < PUSH_ALIGN_ENGAGE_M || !input.localAabb) {
    return {
      kind: "translate",
      transform: translated,
      assist: idlePushAlignSession(),
      shiftBaseline: null,
      releaseGrab: false,
    };
  }
  const tangent = wrapSceneRotationDeg(
    (Math.atan2(choice.wall.tangent.z, choice.wall.tangent.x) * 180) / Math.PI,
  );
  const targetYaw = nearestWallRelativeYaw(translated.rotationDeg.y, tangent);
  const remaining = Math.abs(wrapSceneRotationDeg(targetYaw - translated.rotationDeg.y));
  if (remaining <= PUSH_ALIGN_ALIGNED_SKIP_DEG) {
    return {
      kind: "translate",
      transform: translated,
      assist: idlePushAlignSession(),
      shiftBaseline: null,
      releaseGrab: false,
    };
  }
  const footprint = footprintFromLocalAabb(input.localAabb, translated);
  const contact = footprintContactPoint(footprint, choice.wall, input.pointerWorld);
  if (!contact) {
    return {
      kind: "translate",
      transform: translated,
      assist: idlePushAlignSession(),
      shiftBaseline: null,
      releaseGrab: false,
    };
  }
  const local = inverseRotateOffset(
    {
      x: contact.x - translated.position.x,
      z: contact.z - translated.position.z,
    },
    translated.rotationDeg.y,
  );
  const assist: PushAlignSession = {
    phase: "aligning",
    wallId: choice.wall.id,
    targetYawDeg: targetYaw,
    contactWorldX: contact.x,
    contactWorldZ: contact.z,
    contactLocalX: local.x,
    contactLocalZ: local.z,
  };
  const push = Math.max(
    choice.inwardBlocked,
    input.pointerDelta ? inwardMetres(input.pointerDelta, choice.wall.interiorNormal) : 0,
  );
  const advanced = advanceAlignment(translated, assist, push, input);
  if (!advanced.moved) {
    return {
      kind: "translate",
      transform: translated,
      assist: idlePushAlignSession(),
      shiftBaseline: null,
      releaseGrab: false,
    };
  }
  return {
    kind: "push-align",
    transform: advanced.transform,
    assist: advanced.assist,
    shiftBaseline: null,
    releaseGrab: true,
  };
}

function advanceAlignment(
  base: WorldTransform,
  assist: PushAlignSession,
  pushMetres: number,
  input: Readonly<{
    localAabb: LocalAabb | null;
    walls: readonly RuntimeCollisionWall[];
  }>,
): { transform: WorldTransform; assist: PushAlignSession; moved: boolean } {
  const target = assist.targetYawDeg;
  if (target === null || !hasContact(assist)) {
    return { transform: base, assist, moved: false };
  }
  const remaining = wrapSceneRotationDeg(target - base.rotationDeg.y);
  if (Math.abs(remaining) <= PUSH_ALIGN_SETTLE_DEG) {
    return acceptYaw(base, target, assist, input, true);
  }
  if (pushMetres <= 0) {
    return { transform: base, assist, moved: false };
  }
  let magnitude = Math.min(
    Math.abs(remaining),
    PUSH_ALIGN_MAX_STEP_DEG,
    pushMetres * PUSH_ALIGN_DEGREES_PER_METRE,
  );
  const sign = remaining < 0 ? -1 : 1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (magnitude < 0.05) break;
    const yaw = wrapSceneRotationDeg(base.rotationDeg.y + sign * magnitude);
    const proposed = pivotTransform(base, yaw, assist);
    const resolved = resolvePoseTransform({
      current: base,
      proposed,
      localAabb: input.localAabb,
      walls: input.walls,
    });
    if (resolved.status !== "rejected_pose") {
      const applied = forceScale(resolved.transform);
      const left = Math.abs(wrapSceneRotationDeg(target - applied.rotationDeg.y));
      if (left <= PUSH_ALIGN_SETTLE_DEG) {
        return acceptYaw(base, target, assist, input, false);
      }
      return {
        transform: applied,
        assist: { ...assist, phase: "aligning" },
        moved: true,
      };
    }
    magnitude *= 0.5;
  }
  return { transform: base, assist, moved: false };
}

function acceptYaw(
  base: WorldTransform,
  targetYaw: number,
  assist: PushAlignSession,
  input: Readonly<{
    localAabb: LocalAabb | null;
    walls: readonly RuntimeCollisionWall[];
  }>,
  fromRemainder: boolean,
): { transform: WorldTransform; assist: PushAlignSession; moved: boolean } {
  const proposed = pivotTransform(base, targetYaw, assist);
  const resolved = resolvePoseTransform({
    current: base,
    proposed,
    localAabb: input.localAabb,
    walls: input.walls,
  });
  if (resolved.status === "rejected_pose") {
    return {
      transform: base,
      assist: { ...assist, phase: "settled" },
      moved: fromRemainder ? false : true,
    };
  }
  return {
    transform: forceScale(resolved.transform),
    assist: { ...assist, phase: "settled" },
    moved: true,
  };
}

/**
 * Normal Move from the caller's floor grab (`desiredPosition` is hit − offset).
 * Recapture that grab only when the object actually arrives there. A
 * collision-clamped pose must keep the existing offset; recapturing
 * hit − clampedPosition would store the through-wall slack as the next drag.
 */
function resumeMove(
  input: Readonly<{
    current: WorldTransform;
    desiredPosition: Readonly<{ x: number; y: number; z: number }>;
    localAabb: LocalAabb | null;
    walls: readonly RuntimeCollisionWall[];
  }>,
  assist: PushAlignSession,
): MoveGesturePlan {
  const plan = translatePlan(input, assist, true);
  const dx = plan.transform.position.x - input.desiredPosition.x;
  const dz = plan.transform.position.z - input.desiredPosition.z;
  if (dx * dx + dz * dz > 0.005 * 0.005) {
    return { ...plan, releaseGrab: false };
  }
  return plan;
}

function translatePlan(
  input: Readonly<{
    current: WorldTransform;
    desiredPosition: Readonly<{ x: number; y: number; z: number }>;
    localAabb: LocalAabb | null;
    walls: readonly RuntimeCollisionWall[];
  }>,
  assist: PushAlignSession,
  releaseGrab: boolean,
): MoveGesturePlan {
  const resolved = resolveSceneObjectCollision({
    current: input.current,
    proposed: proposedTranslation(input.current, input.desiredPosition),
    localAabb: input.localAabb,
    walls: input.walls,
    mode: "move",
  });
  return {
    kind: "translate",
    transform: forceScale(resolved.transform),
    assist,
    shiftBaseline: null,
    releaseGrab,
  };
}

function proposedTranslation(
  current: WorldTransform,
  desired: Readonly<{ x: number; y: number; z: number }>,
): WorldTransform {
  return {
    ...current,
    position: {
      x: desired.x,
      y: current.position.y,
      z: desired.z,
    },
    uniformScale: 1,
  };
}

function resolvePoseTransform(input: Readonly<{
  current: WorldTransform;
  proposed: WorldTransform;
  localAabb: LocalAabb | null;
  walls: readonly RuntimeCollisionWall[];
}>): SceneCollisionResult {
  return resolveSceneObjectCollision({
    current: input.current,
    proposed: { ...input.proposed, uniformScale: 1 },
    localAabb: input.localAabb,
    walls: input.walls,
    mode: "pose",
  });
}

function chooseContactWall(input: Readonly<{
  current: WorldTransform;
  translated: WorldTransform;
  desired: Readonly<{ x: number; z: number }>;
  contactWallIds: readonly string[];
  walls: readonly RuntimeCollisionWall[];
}>): { wall: PreparedCollisionWall; inwardBlocked: number } | null {
  if (input.contactWallIds.length === 0) return null;
  const blocked = {
    x: input.desired.x - input.translated.position.x,
    z: input.desired.z - input.translated.position.z,
  };
  const ids = new Set(input.contactWallIds);
  let best: { wall: PreparedCollisionWall; inwardBlocked: number } | null = null;
  for (const wall of input.walls) {
    if (!ids.has(wall.id)) continue;
    const prepared = prepareCollisionWall(wall);
    if (!prepared) continue;
    const inwardBlocked = inwardMetres(blocked, prepared.interiorNormal);
    if (
      !best ||
      inwardBlocked > best.inwardBlocked + 1e-9 ||
      (
        Math.abs(inwardBlocked - best.inwardBlocked) <= 1e-9 &&
        prepared.id.localeCompare(best.wall.id) < 0
      )
    ) {
      best = { wall: prepared, inwardBlocked };
    }
  }
  return best;
}

function footprintContactPoint(
  vertices: readonly Vec2[],
  wall: PreparedCollisionWall,
  pointer: Readonly<{ x: number; z: number }> | null,
): Vec2 | null {
  let bestDist = Number.POSITIVE_INFINITY;
  const candidates: Array<{
    point: Vec2;
    dist: number;
    along: number;
    pointer: number;
  }> = [];
  for (const vertex of vertices) {
    const along = wall.tangent.x * vertex.x + wall.tangent.z * vertex.z;
    if (along < wall.sMin - 1e-4 || along > wall.sMax + 1e-4) continue;
    const dist = interiorSignedDistance(vertex, wall);
    bestDist = Math.min(bestDist, dist);
    const pointerDistance = pointer
      ? Math.hypot(vertex.x - pointer.x, vertex.z - pointer.z)
      : 0;
    candidates.push({ point: vertex, dist, along, pointer: pointerDistance });
  }
  const near = candidates.filter((candidate) => candidate.dist <= bestDist + 1e-3);
  if (near.length === 0) return null;
  near.sort((a, b) =>
    a.pointer - b.pointer ||
    a.along - b.along ||
    a.point.x - b.point.x ||
    a.point.z - b.point.z
  );
  return near[0]?.point ?? null;
}

function pivotTransform(
  base: WorldTransform,
  nextYawDeg: number,
  assist: PushAlignSession,
): WorldTransform {
  const rotated = rotateLocalOffset(
    { x: assist.contactLocalX ?? 0, z: assist.contactLocalZ ?? 0 },
    nextYawDeg,
  );
  return {
    position: {
      x: (assist.contactWorldX ?? base.position.x) - rotated.x,
      y: base.position.y,
      z: (assist.contactWorldZ ?? base.position.z) - rotated.z,
    },
    rotationDeg: {
      ...base.rotationDeg,
      y: wrapSceneRotationDeg(nextYawDeg),
    },
    uniformScale: 1,
  };
}

function rotateLocalOffset(
  local: Readonly<{ x: number; z: number }>,
  yawDeg: number,
): Vec2 {
  const y = (yawDeg * Math.PI) / 180;
  const c = Math.cos(y);
  const s = Math.sin(y);
  return {
    x: c * local.x + s * local.z,
    z: -s * local.x + c * local.z,
  };
}

function inverseRotateOffset(
  worldOffset: Readonly<{ x: number; z: number }>,
  yawDeg: number,
): Vec2 {
  const y = (yawDeg * Math.PI) / 180;
  const c = Math.cos(y);
  const s = Math.sin(y);
  return {
    x: c * worldOffset.x - s * worldOffset.z,
    z: s * worldOffset.x + c * worldOffset.z,
  };
}

function inwardMetres(
  delta: Readonly<{ x: number; z: number }>,
  interiorNormal: Readonly<{ x: number; z: number }>,
): number {
  return -(delta.x * interiorNormal.x + delta.z * interiorNormal.z);
}

function preparedById(
  walls: readonly RuntimeCollisionWall[],
  wallId: string | null,
): PreparedCollisionWall | null {
  if (!wallId) return null;
  for (const wall of walls) {
    if (wall.id !== wallId) continue;
    return prepareCollisionWall(wall);
  }
  return null;
}

function hasContact(assist: PushAlignSession): boolean {
  return assist.contactWorldX !== null &&
    assist.contactWorldZ !== null &&
    assist.contactLocalX !== null &&
    assist.contactLocalZ !== null &&
    assist.targetYawDeg !== null;
}

function forceScale(transform: WorldTransform): WorldTransform {
  return {
    position: { ...transform.position },
    rotationDeg: { ...transform.rotationDeg },
    uniformScale: 1,
  };
}
