import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCeilingPlane,
  deriveVerticalWallPlane,
  intersectRayWithPlane,
} from "./support-plane-math";

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

test("intersects a floor-style horizontal plane", () => {
  const result = intersectRayWithPlane({
    rayOrigin: { x: 0, y: 2, z: 0 },
    rayDirection: { x: 0, y: -2, z: 0 },
    planePoint: { x: 0, y: 0, z: 0 },
    planeNormal: { x: 0, y: 1, z: 0 },
  });
  assert.deepEqual(result, { ok: true, point: { x: 0, y: 0, z: 0 }, distance: 2 });
});

test("intersects a vertical wall plane", () => {
  const result = intersectRayWithPlane({
    rayOrigin: { x: 0, y: 1, z: 2 },
    rayDirection: { x: 0, y: 0, z: -1 },
    planePoint: { x: 0, y: 0, z: 0 },
    planeNormal: { x: 0, y: 0, z: 1 },
  });
  assert.deepEqual(result, { ok: true, point: { x: 0, y: 1, z: 0 }, distance: 2 });
});

test("refuses near-parallel rays and intersections behind the origin", () => {
  assert.deepEqual(
    intersectRayWithPlane({
      rayOrigin: { x: 0, y: 1, z: 0 },
      rayDirection: { x: 1, y: 1e-12, z: 0 },
      planePoint: { x: 0, y: 0, z: 0 },
      planeNormal: { x: 0, y: 1, z: 0 },
    }),
    { ok: false, reason: "ray_parallel_to_plane" }
  );
  assert.deepEqual(
    intersectRayWithPlane({
      rayOrigin: { x: 0, y: 1, z: 0 },
      rayDirection: { x: 0, y: 1, z: 0 },
      planePoint: { x: 0, y: 0, z: 0 },
      planeNormal: { x: 0, y: 1, z: 0 },
    }),
    { ok: false, reason: "intersection_behind_ray" }
  );
});

test("refuses non-finite intersection inputs", () => {
  assert.deepEqual(
    intersectRayWithPlane({
      rayOrigin: { x: Number.NaN, y: 1, z: 0 },
      rayDirection: { x: 0, y: -1, z: 0 },
      planePoint: { x: 0, y: 0, z: 0 },
      planeNormal: { x: 0, y: 1, z: 0 },
    }),
    { ok: false, reason: "non_finite_input" }
  );
});

test("derives a camera-facing wall plane with an orthonormal seam basis", () => {
  const result = deriveVerticalWallPlane(
    { x: -2, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 0, y: 1.5, z: -3 }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plane.point, { x: -2, y: 0, z: 0 });
  assert.ok(dot(result.plane.normal, { x: 2, y: 1.5, z: -3 }) > 0);
  assert.equal(length(result.plane.basisU), 1);
  assert.equal(length(result.plane.basisV), 1);
  assert.equal(dot(result.plane.basisU, result.plane.basisV), 0);
  assert.equal(dot(result.plane.basisU, result.plane.normal), 0);
  assert.equal(dot(result.plane.basisV, result.plane.normal), 0);
});

test("rejects degenerate wall seams and deterministically flips the normal toward camera", () => {
  assert.deepEqual(
    deriveVerticalWallPlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }),
    { ok: false, reason: "invalid_wall_seam" }
  );
  assert.deepEqual(
    deriveVerticalWallPlane(
      { x: 0, y: 0, z: 0 },
      { x: 5e-7, y: 0, z: 0 },
      { x: 0, y: 1, z: 1 }
    ),
    { ok: false, reason: "invalid_wall_seam" }
  );
  const towardPositiveZ = deriveVerticalWallPlane(
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 2 }
  );
  const towardNegativeZ = deriveVerticalWallPlane(
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: -2 }
  );
  assert.equal(towardPositiveZ.ok, true);
  assert.equal(towardNegativeZ.ok, true);
  if (!towardPositiveZ.ok || !towardNegativeZ.ok) return;
  assert.deepEqual(towardPositiveZ.plane.normal, { x: 0, y: 0, z: 1 });
  assert.deepEqual(towardNegativeZ.plane.normal, { x: 0, y: 0, z: -1 });
});

test("derives a valid ceiling plane and rejects invalid heights", () => {
  assert.deepEqual(deriveCeilingPlane(2.6), {
    ok: true,
    plane: {
      point: { x: 0, y: 2.6, z: 0 },
      normal: { x: 0, y: -1, z: 0 },
      basisU: { x: 1, y: 0, z: 0 },
      basisV: { x: 0, y: 0, z: 1 },
    },
  });
  assert.deepEqual(deriveCeilingPlane(0), { ok: false, reason: "invalid_ceiling_height" });
  assert.deepEqual(deriveCeilingPlane(50), { ok: false, reason: "invalid_ceiling_height" });
});
