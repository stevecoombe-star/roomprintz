import assert from "node:assert/strict";
import test from "node:test";

import { buildProductionPerspectiveCamera } from "./frozen-camera";
import { realizeCollisionWalls } from "./metric-world-realization";
import {
  createPi3aAuthority,
  PI3A_REAR_WALL,
  PI3A_RIGHT_WALL,
} from "./pi3a-test-fixture";
import { realizeProductionWorld } from "./production-world";
import {
  AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
  AFC_ADMIN_WORLD_TO_IMAGE_PROJECTION_VERSION,
  clipNormalizedSegmentToRange,
  ndcToNormalizedImage,
  projectWorldPointToNormalizedImage,
  projectWorldSegmentToNormalizedImage,
} from "./world-to-image-projection";

function productionCamera(authority = createPi3aAuthority()) {
  const world = realizeProductionWorld(authority);
  const built = buildProductionPerspectiveCamera(world.camera);
  if (!built.ok) {
    assert.fail(built.reason);
  }
  return { authority, world, camera: built.camera };
}

test("projection version and image clip padding are stable", () => {
  assert.equal(
    AFC_ADMIN_WORLD_TO_IMAGE_PROJECTION_VERSION,
    "afc-admin-world-to-image/v1",
  );
  assert.equal(AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN, -0.05);
  assert.equal(AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX, 1.05);
  assert.deepEqual(ndcToNormalizedImage({ x: 0, y: 0 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(ndcToNormalizedImage({ x: -1, y: 1 }), { x: 0, y: 0 });
  assert.deepEqual(ndcToNormalizedImage({ x: 1, y: -1 }), { x: 1, y: 1 });
});

test("lookAt projects to image center and left/right/y conventions are stable", () => {
  const { camera, world } = productionCamera();
  const center = projectWorldPointToNormalizedImage(camera, world.camera.pose.lookAt);
  assert.ok(center);
  assert.ok(Math.abs(center.x - 0.5) < 1e-6);
  assert.ok(Math.abs(center.y - 0.5) < 1e-6);

  const left = projectWorldPointToNormalizedImage(camera, { x: -1, y: 0, z: 0 });
  const right = projectWorldPointToNormalizedImage(camera, { x: 1, y: 0, z: 0 });
  assert.ok(left && right);
  assert.ok(left.x < 0.5);
  assert.ok(right.x > 0.5);
  assert.ok(Math.abs(left.y - right.y) < 1e-6);
  assert.deepEqual(left, projectWorldPointToNormalizedImage(camera, { x: -1, y: 0, z: 0 }));

  const above = projectWorldPointToNormalizedImage(camera, { x: 0, y: 1, z: 0 });
  const below = projectWorldPointToNormalizedImage(camera, { x: 0, y: -1, z: 0 });
  assert.ok(above && below);
  assert.ok(above.y < 0.5);
  assert.ok(below.y > 0.5);
});

test("segments both in front project; both behind are omitted", () => {
  const { camera } = productionCamera(
    createPi3aAuthority({ walls: [PI3A_RIGHT_WALL, PI3A_REAR_WALL] }),
  );
  const visible = projectWorldSegmentToNormalizedImage(
    camera,
    { x: PI3A_RIGHT_WALL.a.x, y: 0, z: PI3A_RIGHT_WALL.a.z },
    { x: PI3A_RIGHT_WALL.b.x, y: 0, z: PI3A_RIGHT_WALL.b.z },
  );
  assert.ok(visible);
  assert.equal(visible.points.length, 2);
  for (const point of visible.points) {
    assert.ok(point.x >= AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN);
    assert.ok(point.x <= AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX);
    assert.ok(point.y >= AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN);
    assert.ok(point.y <= AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX);
  }

  const behind = projectWorldSegmentToNormalizedImage(
    camera,
    { x: 0, y: 0, z: 8 },
    { x: 1, y: 0, z: 9 },
  );
  assert.equal(behind, null);
});

test("one-behind segments clip to the near plane instead of inverting", () => {
  const { camera } = productionCamera();
  const front = { x: 0, y: 0, z: 0 };
  const back = { x: 0, y: 0, z: 8 };
  const projected = projectWorldSegmentToNormalizedImage(camera, front, back);
  assert.ok(projected);
  const frontImage = projectWorldPointToNormalizedImage(camera, front);
  assert.ok(frontImage);
  const dx0 = Math.abs(projected.points[0].x - frontImage.x);
  const dy0 = Math.abs(projected.points[0].y - frontImage.y);
  const dx1 = Math.abs(projected.points[1].x - frontImage.x);
  const dy1 = Math.abs(projected.points[1].y - frontImage.y);
  const nearerStart = dx0 + dy0 < dx1 + dy1;
  const clipped = nearerStart ? projected.points[1] : projected.points[0];
  const kept = nearerStart ? projected.points[0] : projected.points[1];
  assert.ok(Math.abs(kept.x - frontImage.x) < 1e-5);
  assert.ok(Math.abs(kept.y - frontImage.y) < 1e-5);
  assert.ok(Math.abs(clipped.x - frontImage.x) + Math.abs(clipped.y - frontImage.y) > 1e-4);
  assert.ok(clipped.x > -0.5 && clipped.x < 1.5);
  assert.ok(clipped.y > -0.5 && clipped.y < 1.5);
});

test("image-bound clipping keeps crossing segments and omits fully outside ones", () => {
  const crossing = clipNormalizedSegmentToRange(
    { x: -0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  );
  assert.ok(crossing);
  assert.ok(Math.abs(crossing.points[0].x - AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN) < 1e-12);
  assert.equal(crossing.points[1].x, 0.5);

  const outside = clipNormalizedSegmentToRange(
    { x: -2, y: 0.5 },
    { x: -1, y: 0.5 },
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  );
  assert.equal(outside, null);

  const nearEdge = clipNormalizedSegmentToRange(
    { x: 0.99, y: 0.5 },
    { x: 1.2, y: 0.5 },
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
    AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  );
  assert.ok(nearEdge);
  assert.ok(Math.abs(nearEdge.points[1].x - AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX) < 1e-12);

  const { camera } = productionCamera();
  const farRight = projectWorldSegmentToNormalizedImage(
    camera,
    { x: 80, y: 0, z: -2 },
    { x: 81, y: 0, z: -2 },
  );
  assert.equal(farRight, null);

  const crossingWorld = projectWorldSegmentToNormalizedImage(
    camera,
    { x: -40, y: 0, z: -1 },
    { x: 40, y: 0, z: -1 },
  );
  assert.ok(crossingWorld);
});

test("projection uses realized metric camera once and does not double-scale walls", () => {
  const scaled = createPi3aAuthority({ metricScale: 2, walls: [PI3A_RIGHT_WALL] });
  const { camera, world } = productionCamera(scaled);
  const realized = projectWorldSegmentToNormalizedImage(
    camera,
    { x: world.collisionWalls[0].a.x, y: 0, z: world.collisionWalls[0].a.z },
    { x: world.collisionWalls[0].b.x, y: 0, z: world.collisionWalls[0].b.z },
  );
  const doubleScaledWall = realizeCollisionWalls(world.collisionWalls, 2)[0];
  const doubled = projectWorldSegmentToNormalizedImage(
    camera,
    { x: doubleScaledWall.a.x, y: 0, z: doubleScaledWall.a.z },
    { x: doubleScaledWall.b.x, y: 0, z: doubleScaledWall.b.z },
  );
  assert.ok(realized);
  assert.ok(doubled);
  assert.notDeepEqual(realized.points, doubled.points);
});
