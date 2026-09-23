import { TEST_CUBE_EDGE_M, type WorldTransform } from "./scene-layer-state";

export type Vec2 = Readonly<{ x: number; z: number }>;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type LocalAabb = Readonly<{
  min: Vec3;
  max: Vec3;
}>;

/**
 * Placement-local AABB of the 1 m Test Cube after XZ centering and floor contact.
 * Geometry edge = TEST_CUBE_EDGE_M; wrapper scale = 1; floor at Y = 0.
 */
const TEST_CUBE_HALF_EDGE_M = TEST_CUBE_EDGE_M / 2;
export const TEST_CUBE_PLACEMENT_LOCAL_AABB: LocalAabb = Object.freeze({
  min: Object.freeze({ x: -TEST_CUBE_HALF_EDGE_M, y: 0, z: -TEST_CUBE_HALF_EDGE_M }),
  max: Object.freeze({ x: TEST_CUBE_HALF_EDGE_M, y: TEST_CUBE_EDGE_M, z: TEST_CUBE_HALF_EDGE_M }),
});

const HULL_COLLINEAR_ABS = 1e-12;

export function aabbIsValid(aabb: LocalAabb | null | undefined): aabb is LocalAabb {
  if (!aabb) return false;
  const values = [
    aabb.min.x, aabb.min.y, aabb.min.z,
    aabb.max.x, aabb.max.y, aabb.max.z,
  ];
  return values.every(Number.isFinite) &&
    aabb.max.x >= aabb.min.x &&
    aabb.max.y >= aabb.min.y &&
    aabb.max.z >= aabb.min.z;
}

export function aabbCorners(aabb: LocalAabb): readonly Vec3[] {
  const xs = [aabb.min.x, aabb.max.x];
  const ys = [aabb.min.y, aabb.max.y];
  const zs = [aabb.min.z, aabb.max.z];
  const corners: Vec3[] = [];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        corners.push({ x, y, z });
      }
    }
  }
  return corners;
}

/**
 * Three.js Euler order XYZ: R maps local → parent as used by Object3D.
 */
export function applyWorldTransformToPoint(
  local: Vec3,
  transform: WorldTransform,
): Vec3 {
  const sx = local.x * transform.uniformScale;
  const sy = local.y * transform.uniformScale;
  const sz = local.z * transform.uniformScale;
  const x = (transform.rotationDeg.x * Math.PI) / 180;
  const y = (transform.rotationDeg.y * Math.PI) / 180;
  const z = (transform.rotationDeg.z * Math.PI) / 180;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return {
    x: c * e * sx + (-c * f) * sy + d * sz + transform.position.x,
    y: (af + be * d) * sx + (ae - bf * d) * sy + (-b * c) * sz + transform.position.y,
    z: (bf - ae * d) * sx + (be + af * d) * sy + a * c * sz + transform.position.z,
  };
}

export function convexHullXz(points: readonly Vec2[]): Vec2[] {
  const filtered = points.filter((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.z)
  );
  if (filtered.length === 0) return [];
  const unique: Vec2[] = [];
  for (const point of filtered) {
    if (
      unique.some((existing) =>
        Math.abs(existing.x - point.x) <= HULL_COLLINEAR_ABS &&
        Math.abs(existing.z - point.z) <= HULL_COLLINEAR_ABS
      )
    ) {
      continue;
    }
    unique.push(point);
  }
  if (unique.length <= 2) return unique;
  const sorted = [...unique].sort((left, right) =>
    left.x === right.x ? left.z - right.z : left.x - right.x
  );

  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <=
        HULL_COLLINEAR_ABS
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <=
        HULL_COLLINEAR_ABS
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function footprintFromLocalAabb(
  aabb: LocalAabb,
  transform: WorldTransform,
): Vec2[] {
  const projected = aabbCorners(aabb).map((corner) => {
    const world = applyWorldTransformToPoint(corner, transform);
    return { x: world.x, z: world.z };
  });
  return convexHullXz(projected);
}

function cross(origin: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
}
