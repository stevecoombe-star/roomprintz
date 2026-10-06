import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";
import {
  canonicalizeObjectWorldTransform,
  realizeCollisionWalls,
  realizeObjectWorldTransform,
} from "@/lib/afc-v2-runtime/metric-world-realization";
import { createPi3aAuthority, PI3A_RIGHT_WALL } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import {
  realizedTransformPenetratesWalls,
  resolveCollisionFreeCanonicalTransform,
} from "@/lib/afc-v2-runtime/scene-crud";
import type { LocalAabb, WorldTransform } from "@/lib/afc-v2-runtime/types";

import { deriveModelAxisScale, resolveEffectiveModelDimensions } from "./model-dimensions";
import {
  ROOM_SCALE_DEFAULT,
  ROOM_SCALE_MAX,
  ROOM_SCALE_MIN,
  ROOM_SCALE_RANGE_ERROR,
  clampRoomScaleMultiplier,
  createMemoryRoomScaleStore,
  effectiveMetricScale,
  formatRoomScaleMultiplier,
  parseRoomScaleMultiplier,
  roomScaleButtonLabel,
  stepRoomScaleMultiplier,
} from "./room-scale";

const CHAIR = Object.freeze({
  widthM: 0.9,
  heightM: 0.8,
  depthM: 0.7,
});

const BOX: LocalAabb = Object.freeze({
  min: Object.freeze({ x: -0.5, y: 0, z: -0.5 }),
  max: Object.freeze({ x: 0.5, y: 0.9, z: 0.5 }),
});

function canonicalPose(x: number, z: number): WorldTransform {
  return {
    position: { x, y: 0.4, z },
    rotationDeg: { x: 0, y: 15, z: 0 },
    uniformScale: 1,
  };
}

function unitView(position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) {
  const x = lookAt.x - position.x;
  const y = lookAt.y - position.y;
  const z = lookAt.z - position.z;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

test("effective scale is certified 1.00 × room 1.10", () => {
  const authority = createPi3aAuthority({ metricScale: 1 });
  const world = realizeProductionWorld(authority, 1.1);
  assert.equal(world.certifiedMetricScale, 1);
  assert.equal(world.roomScaleMultiplier, 1.1);
  assert.equal(world.metricScale, 1.1);
  assert.equal(world.metricScale, effectiveMetricScale(1, 1.1));
});

test("non-unit certified scale is 0.95 × room 1.10", () => {
  const authority = createPi3aAuthority({ metricScale: 0.95 });
  const world = realizeProductionWorld(authority, 1.1);
  assert.equal(world.certifiedMetricScale, 0.95);
  assert.equal(world.metricScale, 0.95 * 1.1);
  assert.ok(Math.abs(world.metricScale - 1.045) < 1e-12);
});

test("effective scale is applied exactly once", () => {
  const certified = 0.95;
  const room = 1.1;
  const authority = createPi3aAuthority({
    metricScale: certified,
    floor: { worldWidthM: 4, referenceDepthM: 5 },
    walls: [PI3A_RIGHT_WALL],
  });
  const world = realizeProductionWorld(authority, room);
  const effective = certified * room;
  const once = realizeCollisionWalls(authority.collision.walls, effective);
  const twice = realizeCollisionWalls(once, room);
  assert.equal(world.floor.worldWidthM, 4 * effective);
  assert.equal(world.floor.referenceDepthM, 5 * effective);
  assert.notEqual(world.floor.worldWidthM, 4 * effective * room);
  assert.equal(world.collisionWalls[0]?.a.x, once[0]?.a.x);
  assert.notEqual(world.collisionWalls[0]?.a.x, twice[0]?.a.x);
  const source = readFileSync("lib/afc-v2-runtime/production-world.ts", "utf8");
  assert.equal(source.match(/realizeFloorRectangle\(/g)?.length, 1);
  assert.equal(source.match(/realizeCollisionWalls\(/g)?.length, 1);
  assert.equal(source.match(/realizeFrozenCamera\(/g)?.length, 1);
});

test("floor and world bounds use effectiveMetricScale", () => {
  const authority = createPi3aAuthority({
    metricScale: 0.95,
    floor: { worldWidthM: 4, referenceDepthM: 5 },
  });
  const world = realizeProductionWorld(authority, 1.1);
  const effective = world.metricScale;
  assert.equal(world.floor.worldWidthM, 4 * effective);
  assert.equal(world.floor.referenceDepthM, 5 * effective);
});

test("collision wall endpoints and plane constants use effectiveMetricScale", () => {
  const authority = createPi3aAuthority({ metricScale: 0.95, walls: [PI3A_RIGHT_WALL] });
  const world = realizeProductionWorld(authority, 1.1);
  const wall = world.collisionWalls[0];
  assert.ok(wall);
  const effective = 0.95 * 1.1;
  assert.equal(wall.a.x, PI3A_RIGHT_WALL.a.x * effective);
  assert.equal(wall.a.z, PI3A_RIGHT_WALL.a.z * effective);
  assert.equal(wall.b.x, PI3A_RIGHT_WALL.b.x * effective);
  assert.equal(wall.b.z, PI3A_RIGHT_WALL.b.z * effective);
  assert.equal(wall.supportPlaneConstant, PI3A_RIGHT_WALL.supportPlaneConstant * effective);
  assert.deepEqual(wall.supportPlaneNormal, PI3A_RIGHT_WALL.supportPlaneNormal);
});

test("camera position and lookAt use effectiveMetricScale", () => {
  const authority = createPi3aAuthority({ metricScale: 0.95 });
  const world = realizeProductionWorld(authority, 1.1);
  const effective = 0.95 * 1.1;
  const pose = authority.frozenCamera.pose;
  assert.equal(world.camera.pose.position.x, pose.position.x * effective);
  assert.equal(world.camera.pose.position.y, pose.position.y * effective);
  assert.equal(world.camera.pose.position.z, pose.position.z * effective);
  assert.equal(world.camera.pose.lookAt.x, pose.lookAt.x * effective);
  assert.equal(world.camera.pose.lookAt.y, pose.lookAt.y * effective);
  assert.equal(world.camera.pose.lookAt.z, pose.lookAt.z * effective);
});

test("camera FOV and orientation stay unchanged", () => {
  const authority = createPi3aAuthority({ metricScale: 0.95, verticalFovDeg: 52 });
  const identity = realizeProductionWorld(authority, 1);
  const scaled = realizeProductionWorld(authority, 1.1);
  assert.equal(scaled.camera.verticalFovDeg, authority.frozenCamera.verticalFovDeg);
  assert.equal(scaled.camera.verticalFovDeg, identity.camera.verticalFovDeg);
  assert.deepEqual(scaled.camera.pose.up, authority.frozenCamera.pose.up);
  const scaledView = unitView(scaled.camera.pose.position, scaled.camera.pose.lookAt);
  const identityView = unitView(identity.camera.pose.position, identity.camera.pose.lookAt);
  assert.ok(Math.abs(scaledView.x - identityView.x) < 1e-12);
  assert.ok(Math.abs(scaledView.y - identityView.y) < 1e-12);
  assert.ok(Math.abs(scaledView.z - identityView.z) < 1e-12);
});

test("furniture realized X/Z use effectiveMetricScale and Y stays canonical", () => {
  const canonical = canonicalPose(1.2, -0.8);
  const effective = effectiveMetricScale(0.95, 1.1);
  const realized = realizeObjectWorldTransform(canonical, effective);
  assert.equal(realized.position.x, 1.2 * effective);
  assert.equal(realized.position.z, -0.8 * effective);
  assert.equal(realized.position.y, 0.4);
  assert.equal(realized.uniformScale, 1);
  assert.deepEqual(realized.rotationDeg, canonical.rotationDeg);
});

test("furniture save recovers canonical X/Z by the same effectiveMetricScale", () => {
  const canonical = canonicalPose(1.2, -0.8);
  const effective = effectiveMetricScale(0.95, 1.1);
  const realized = realizeObjectWorldTransform(canonical, effective);
  const saved = canonicalizeObjectWorldTransform(realized, effective);
  assert.equal(saved.position.x, canonical.position.x);
  assert.equal(saved.position.y, canonical.position.y);
  assert.equal(saved.position.z, canonical.position.z);
  assert.equal(saved.uniformScale, 1);
});

test("room scale changes resolve from canonical authority without drift", () => {
  const canonical = canonicalPose(1.2, -0.8);
  const certified = 0.95;
  const baseline = realizeObjectWorldTransform(canonical, effectiveMetricScale(certified, 1));
  let previous = 1;
  for (const room of [2, 0.25, 1.5, 0.5, 1]) {
    const realized = realizeObjectWorldTransform(canonical, effectiveMetricScale(certified, room));
    const recovered = canonicalizeObjectWorldTransform(
      realized,
      effectiveMetricScale(certified, room),
    );
    assert.deepEqual(recovered, canonical);
    previous = room;
    if (room === 1) assert.deepEqual(realized, baseline);
  }
  assert.equal(previous, 1);
  assert.deepEqual(
    realizeObjectWorldTransform(canonical, effectiveMetricScale(certified, 1)),
    baseline,
  );
});

test("furniture dimensions stay identical at every room scale", () => {
  const asset = { authoredWidthM: 0.9, authoredHeightM: 0.8, authoredDepthM: 0.7 };
  const variant = {
    modelWidthM: CHAIR.widthM,
    modelHeightM: CHAIR.heightM,
    modelDepthM: CHAIR.depthM,
    modelSizingMode: "exact",
  };
  const roomScales = [0.25, 1, 2];
  const sizes = roomScales.map(() => resolveEffectiveModelDimensions(variant, asset));
  for (const size of sizes) assert.deepEqual(size, CHAIR);
  const axes = roomScales.map(() => deriveModelAxisScale({
    native: CHAIR,
    effective: CHAIR,
  }));
  for (const axis of axes) assert.deepEqual(axis, axes[0]);
  const source = readFileSync("lib/afc-v2-runtime/production-world.ts", "utf8");
  assert.doesNotMatch(source, /deriveModelAxisScale|userSizeMultiplier/);
  for (const room of roomScales) {
    const realized = realizeObjectWorldTransform(canonicalPose(0, 0), effectiveMetricScale(1, room));
    assert.equal(realized.uniformScale, 1);
  }
});

test("persisted AFC metricScale is unchanged", () => {
  const authority = createPi3aAuthority({ metricScale: 0.95 });
  const before = authority.metric.metricScale;
  const world = realizeProductionWorld(authority, 1.1);
  assert.equal(authority.metric.metricScale, before);
  assert.equal(authority.metric.metricScale, 0.95);
  assert.equal(world.certifiedMetricScale, 0.95);
  assert.notEqual(world.metricScale, authority.metric.metricScale);
});

test("roomScaleMultiplier round-trips independently per room", async () => {
  const store = createMemoryRoomScaleStore([
    { roomId: "room-a", userId: "user-1" },
    { roomId: "room-b", userId: "user-1", roomScaleMultiplier: 1.08 },
  ]);
  const initialA = await store.read("user-1", "room-a");
  assert.equal(initialA.ok && initialA.roomScaleMultiplier, ROOM_SCALE_DEFAULT);
  const written = await store.write("user-1", "room-a", 1.1);
  assert.equal(written.ok && written.roomScaleMultiplier, 1.1);
  const roomA = await store.read("user-1", "room-a");
  const roomB = await store.read("user-1", "room-b");
  assert.equal(roomA.ok && roomA.roomScaleMultiplier, 1.1);
  assert.equal(roomB.ok && roomB.roomScaleMultiplier, 1.08);
  const acceptedLow = await store.write("user-1", "room-a", ROOM_SCALE_MIN);
  const acceptedHigh = await store.write("user-1", "room-a", ROOM_SCALE_MAX);
  assert.equal(acceptedLow.ok && acceptedLow.roomScaleMultiplier, 0.25);
  assert.equal(acceptedHigh.ok && acceptedHigh.roomScaleMultiplier, 2);
  const rejectedLow = await store.write("user-1", "room-a", 0.24);
  const rejected = await store.write("user-1", "room-a", 2.01);
  assert.equal(rejectedLow.ok, false);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error, ROOM_SCALE_RANGE_ERROR);
  const still = await store.read("user-1", "room-a");
  assert.equal(still.ok && still.roomScaleMultiplier, 2);
  const foreign = await store.read("user-2", "room-a");
  assert.equal(foreign.ok, false);
  const server = readFileSync("lib/vibode-stage/room-scale.server.ts", "utf8");
  const appliedMigration = readFileSync(
    "supabase/migrations/20261003160000_vibode_room_scale_multiplier.sql",
    "utf8",
  );
  const rangeMigration = readFileSync(
    "supabase/migrations/20261003170000_vibode_room_scale_multiplier_range.sql",
    "utf8",
  );
  const betaMigration = readFileSync(
    "supabase/migrations/20261003180000_vibode_room_scale_multiplier_beta_range.sql",
    "utf8",
  );
  assert.match(server, /room_scale_multiplier/);
  assert.doesNotMatch(server, /vibode_afc_generations|metricScale/);
  assert.match(appliedMigration, /room_scale_multiplier double precision not null default 1\.0/);
  assert.match(appliedMigration, />= 0\.75/);
  assert.match(appliedMigration, /<= 1\.25/);
  assert.match(rangeMigration, />= 0\.50/);
  assert.match(rangeMigration, /<= 1\.50/);
  assert.match(betaMigration, />= 0\.25/);
  assert.match(betaMigration, /<= 2\.00/);
  const control = readFileSync("components/stage/RoomScaleControl.tsx", "utf8");
  assert.match(control, /min=\{ROOM_SCALE_MIN\}/);
  assert.match(control, /max=\{ROOM_SCALE_MAX\}/);
  assert.match(control, /step=\{ROOM_SCALE_STEP\}/);
});

test("room scale accepts 0.25 and 2.00 and rejects or clamps outside that range", () => {
  assert.equal(parseRoomScaleMultiplier(0.25), 0.25);
  assert.equal(parseRoomScaleMultiplier(2), 2);
  assert.equal(parseRoomScaleMultiplier(0.24), null);
  assert.equal(parseRoomScaleMultiplier(2.01), null);
  assert.equal(clampRoomScaleMultiplier(0.24), ROOM_SCALE_MIN);
  assert.equal(clampRoomScaleMultiplier(2.01), ROOM_SCALE_MAX);
  assert.equal(stepRoomScaleMultiplier(0.25, -1), 0.25);
  assert.equal(stepRoomScaleMultiplier(2, 1), 2);
  assert.equal(stepRoomScaleMultiplier(0.25, 1), 0.26);
  assert.equal(stepRoomScaleMultiplier(2, -1), 1.99);
  const authority = createPi3aAuthority({
    metricScale: 0.95,
    floor: { worldWidthM: 4, referenceDepthM: 5 },
    walls: [PI3A_RIGHT_WALL],
  });
  for (const room of [0.25, 2]) {
    const world = realizeProductionWorld(authority, room);
    const effective = 0.95 * room;
    const once = realizeCollisionWalls(authority.collision.walls, effective);
    const twice = realizeCollisionWalls(once, room);
    assert.equal(world.metricScale, effective);
    assert.equal(world.floor.worldWidthM, 4 * effective);
    assert.equal(world.floor.referenceDepthM, 5 * effective);
    assert.notEqual(world.floor.worldWidthM, 4 * effective * room);
    assert.equal(world.collisionWalls[0]?.a.x, once[0]?.a.x);
    assert.notEqual(world.collisionWalls[0]?.a.x, twice[0]?.a.x);
    assert.equal(world.certifiedMetricScale, 0.95);
  }
  assert.equal(authority.metric.metricScale, 0.95);
});

test("reset returns the multiplier to exactly 1.00", async () => {
  const store = createMemoryRoomScaleStore([{ roomId: "room-a", userId: "user-1", roomScaleMultiplier: 1.1 }]);
  const reset = await store.write("user-1", "room-a", 1);
  assert.equal(reset.ok && reset.roomScaleMultiplier, 1);
  assert.equal(clampRoomScaleMultiplier(1), 1);
  assert.equal(parseRoomScaleMultiplier(1), 1);
  assert.equal(formatRoomScaleMultiplier(1), "1.00×");
  assert.equal(roomScaleButtonLabel(1), "Room Scale");
  assert.equal(roomScaleButtonLabel(1.08), "Room Scale 1.08×");
});

test("placement search uses the realized walls from effectiveMetricScale", () => {
  const authority = createPi3aAuthority({ metricScale: 1, walls: [PI3A_RIGHT_WALL] });
  const preferred: WorldTransform = {
    position: { x: 0.52, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    uniformScale: 1,
  };
  const atIdentity = realizeProductionWorld(authority, 1);
  const atRoom = realizeProductionWorld(authority, 1.1);
  assert.equal(realizedTransformPenetratesWalls({
    realized: realizeObjectWorldTransform(preferred, atIdentity.metricScale),
    localAabb: BOX,
    realizedWalls: atIdentity.collisionWalls,
  }), true);
  assert.equal(realizedTransformPenetratesWalls({
    realized: realizeObjectWorldTransform(preferred, atRoom.metricScale),
    localAabb: BOX,
    realizedWalls: atRoom.collisionWalls,
  }), false);
  const blocked = resolveCollisionFreeCanonicalTransform({
    preferredCanonical: preferred,
    metricScale: atIdentity.metricScale,
    realizedWalls: atIdentity.collisionWalls,
    localAabb: BOX,
  });
  const clear = resolveCollisionFreeCanonicalTransform({
    preferredCanonical: preferred,
    metricScale: atRoom.metricScale,
    realizedWalls: atRoom.collisionWalls,
    localAabb: BOX,
  });
  assert.notEqual(blocked.position.x, preferred.position.x);
  assert.equal(clear.position.x, preferred.position.x);
  assert.equal(clear.position.z, preferred.position.z);

  for (const room of [0.25, 2]) {
    const world = realizeProductionWorld(authority, room);
    const wall = world.collisionWalls[0];
    assert.ok(wall);
    assert.equal(wall.a.x, PI3A_RIGHT_WALL.a.x * room);
    assert.equal(wall.supportPlaneConstant, PI3A_RIGHT_WALL.supportPlaneConstant * room);
    const penetrates = realizedTransformPenetratesWalls({
      realized: realizeObjectWorldTransform(preferred, world.metricScale),
      localAabb: BOX,
      realizedWalls: world.collisionWalls,
    });
    const resolved = resolveCollisionFreeCanonicalTransform({
      preferredCanonical: preferred,
      metricScale: world.metricScale,
      realizedWalls: world.collisionWalls,
      localAabb: BOX,
    });
    if (room === 0.25) {
      assert.equal(penetrates, true);
      assert.notEqual(resolved.position.x, preferred.position.x);
    } else {
      assert.equal(penetrates, false);
      assert.equal(resolved.position.x, preferred.position.x);
    }
  }
});

test("viewer re-realizes from canonical coordinates through the shared world", () => {
  const viewer = readFileSync("components/afc-3d/AfcProductionRoomViewer.tsx", "utf8");
  assert.match(viewer, /realizeProductionWorld\(authority\)/);
  assert.match(viewer, /world\.collisionWalls/);
  assert.match(viewer, /realizeProductionWorld\(authority, multiplier\)/);
  assert.match(viewer, /object\.canonicalTransform/);
  const applyRoomScale = viewer.slice(
    viewer.indexOf("const applyRoomScale ="),
    viewer.indexOf("applyRoomScaleRef.current = applyRoomScale"),
  );
  assert.match(applyRoomScale, /canonicalTransform/);
  assert.doesNotMatch(applyRoomScale, /emitCommittedScene|canonicalTransform =/);
  const header = readFileSync("components/stage/StageEditorHeader.tsx", "utf8");
  assert.match(header, /<RoomScaleControl \/>\s*<button[\s\S]*aria-label="Undo"/);
});
