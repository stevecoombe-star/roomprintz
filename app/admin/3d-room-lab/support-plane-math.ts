export type SupportVec3 = { x: number; y: number; z: number };

export type RayPlaneIntersectionReason =
  | "non_finite_input"
  | "invalid_ray_direction"
  | "invalid_plane_normal"
  | "ray_parallel_to_plane"
  | "intersection_behind_ray"
  | "non_finite_intersection";

export type RayPlaneIntersectionResult =
  | { ok: true; point: SupportVec3; distance: number }
  | { ok: false; reason: RayPlaneIntersectionReason };

export type SupportPlane = {
  point: SupportVec3;
  normal: SupportVec3;
  basisU: SupportVec3;
  basisV: SupportVec3;
};

export type SupportPlaneDerivationResult =
  | { ok: true; plane: SupportPlane }
  | { ok: false; reason: "non_finite_input" | "invalid_wall_seam" | "invalid_camera_position" | "invalid_basis" | "invalid_ceiling_height" };

const EPSILON = 1e-9;
const MIN_WALL_SEAM_LENGTH = 1e-6;

// Deliberately broad lab-only bounds. This is a sanity check, not an image
// evidence inference or a physical measurement claim.
export const CEILING_HEIGHT_MIN_WORLD_UNITS = 0.1;
export const CEILING_HEIGHT_MAX_WORLD_UNITS = 20;

function isFiniteVec3(value: SupportVec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function subtract(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addScaled(a: SupportVec3, direction: SupportVec3, scalar: number): SupportVec3 {
  return {
    x: a.x + direction.x * scalar,
    y: a.y + direction.y * scalar,
    z: a.z + direction.z * scalar,
  };
}

function dot(a: SupportVec3, b: SupportVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(value: SupportVec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: SupportVec3): SupportVec3 | null {
  const valueLength = length(value);
  if (!Number.isFinite(valueLength) || valueLength <= EPSILON) return null;
  const normalized = {
    x: value.x === 0 ? 0 : value.x / valueLength,
    y: value.y === 0 ? 0 : value.y / valueLength,
    z: value.z === 0 ? 0 : value.z / valueLength,
  };
  return isFiniteVec3(normalized) ? normalized : null;
}

export function intersectRayWithPlane(input: {
  rayOrigin: SupportVec3;
  rayDirection: SupportVec3;
  planePoint: SupportVec3;
  planeNormal: SupportVec3;
}): RayPlaneIntersectionResult {
  const { rayOrigin, rayDirection, planePoint, planeNormal } = input;
  if (!isFiniteVec3(rayOrigin) || !isFiniteVec3(rayDirection) || !isFiniteVec3(planePoint) || !isFiniteVec3(planeNormal)) {
    return { ok: false, reason: "non_finite_input" };
  }

  const direction = normalize(rayDirection);
  if (!direction) return { ok: false, reason: "invalid_ray_direction" };
  const normal = normalize(planeNormal);
  if (!normal) return { ok: false, reason: "invalid_plane_normal" };

  const denominator = dot(direction, normal);
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= EPSILON) {
    return { ok: false, reason: "ray_parallel_to_plane" };
  }

  const distance = dot(subtract(planePoint, rayOrigin), normal) / denominator;
  if (!Number.isFinite(distance)) return { ok: false, reason: "non_finite_intersection" };
  if (distance <= EPSILON) return { ok: false, reason: "intersection_behind_ray" };

  const point = addScaled(rayOrigin, direction, distance);
  if (!isFiniteVec3(point)) return { ok: false, reason: "non_finite_intersection" };
  return { ok: true, point, distance };
}

/**
 * `basisU` preserves the declared seam direction (first point to second point)
 * and `basisV` is world up. `normal` is flipped to face the camera. Therefore
 * `basisU × basisV` is the unflipped seam normal and may oppose `normal` after
 * the camera-facing flip; this explicit convention keeps seam orientation stable.
 */
export function deriveVerticalWallPlane(
  seamStart: SupportVec3,
  seamEnd: SupportVec3,
  cameraPosition: SupportVec3
): SupportPlaneDerivationResult {
  if (!isFiniteVec3(seamStart) || !isFiniteVec3(seamEnd)) {
    return { ok: false, reason: "non_finite_input" };
  }
  if (!isFiniteVec3(cameraPosition)) return { ok: false, reason: "invalid_camera_position" };
  if (Math.abs(seamStart.y) > EPSILON || Math.abs(seamEnd.y) > EPSILON) {
    return { ok: false, reason: "invalid_wall_seam" };
  }

  const basisU = normalize(subtract(seamEnd, seamStart));
  if (!basisU || length(subtract(seamEnd, seamStart)) < MIN_WALL_SEAM_LENGTH) {
    return { ok: false, reason: "invalid_wall_seam" };
  }

  const basisV = { x: 0, y: 1, z: 0 };
  const unflippedNormal = normalize(cross(basisU, basisV));
  if (!unflippedNormal) return { ok: false, reason: "invalid_basis" };

  const cameraOffset = subtract(cameraPosition, seamStart);
  const facingDot = dot(unflippedNormal, cameraOffset);
  const normal =
    facingDot < 0
      ? {
          x: unflippedNormal.x === 0 ? 0 : -unflippedNormal.x,
          y: unflippedNormal.y === 0 ? 0 : -unflippedNormal.y,
          z: unflippedNormal.z === 0 ? 0 : -unflippedNormal.z,
        }
      : unflippedNormal;
  if (!isFiniteVec3(normal) || Math.abs(dot(basisU, basisV)) > EPSILON || Math.abs(dot(basisU, normal)) > EPSILON) {
    return { ok: false, reason: "invalid_basis" };
  }

  return {
    ok: true,
    plane: {
      point: { x: seamStart.x, y: 0, z: seamStart.z },
      normal,
      basisU,
      basisV,
    },
  };
}

/**
 * World Y is up. The ceiling's downward-facing normal with U=+X and V=+Z gives
 * a right-handed basis (`basisU × basisV = normal`).
 */
export function deriveCeilingPlane(roomHeight: number): SupportPlaneDerivationResult {
  if (
    !Number.isFinite(roomHeight) ||
    roomHeight < CEILING_HEIGHT_MIN_WORLD_UNITS ||
    roomHeight > CEILING_HEIGHT_MAX_WORLD_UNITS
  ) {
    return { ok: false, reason: "invalid_ceiling_height" };
  }

  const plane: SupportPlane = {
    point: { x: 0, y: roomHeight, z: 0 },
    normal: { x: 0, y: -1, z: 0 },
    basisU: { x: 1, y: 0, z: 0 },
    basisV: { x: 0, y: 0, z: 1 },
  };
  if (
    !isFiniteVec3(plane.point) ||
    !isFiniteVec3(plane.normal) ||
    !isFiniteVec3(plane.basisU) ||
    !isFiniteVec3(plane.basisV) ||
    Math.abs(dot(cross(plane.basisU, plane.basisV), plane.normal) - 1) > EPSILON
  ) {
    return { ok: false, reason: "invalid_basis" };
  }
  return { ok: true, plane };
}
