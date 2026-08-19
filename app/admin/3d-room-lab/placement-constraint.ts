export type PlacementPointXZ = Readonly<{
  x: number;
  z: number;
}>;

export type PlacementConstraint =
  | Readonly<{
      kind: "unbounded_ground_plane";
    }>
  | Readonly<{
      kind: "room_boundary";
      polygonWorldXZ: readonly PlacementPointXZ[];
      resolution: "reject";
    }>;

export type PlacementConstraintResult =
  | Readonly<{
      ok: true;
      positionXZ: PlacementPointXZ;
    }>
  | Readonly<{
      ok: false;
      reason: string;
    }>;

export const DEFAULT_PLACEMENT_CONSTRAINT: PlacementConstraint = Object.freeze({
  kind: "unbounded_ground_plane",
});

const BOUNDARY_EPSILON = 1e-9;

function isFinitePoint(point: PlacementPointXZ): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

function isPointOnSegment(candidate: PlacementPointXZ, start: PlacementPointXZ, end: PlacementPointXZ): boolean {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const segmentLengthSquared = dx * dx + dz * dz;
  if (segmentLengthSquared <= BOUNDARY_EPSILON) {
    return (
      Math.abs(candidate.x - start.x) <= BOUNDARY_EPSILON &&
      Math.abs(candidate.z - start.z) <= BOUNDARY_EPSILON
    );
  }

  const candidateDx = candidate.x - start.x;
  const candidateDz = candidate.z - start.z;
  const cross = candidateDx * dz - candidateDz * dx;
  if (Math.abs(cross) > BOUNDARY_EPSILON) return false;

  const dot = candidateDx * dx + candidateDz * dz;
  return dot >= -BOUNDARY_EPSILON && dot <= segmentLengthSquared + BOUNDARY_EPSILON;
}

function isPointInsideOrOnPolygon(candidate: PlacementPointXZ, polygon: readonly PlacementPointXZ[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (isPointOnSegment(candidate, previous, current)) return true;

    const crossesCandidateZ = (current.z > candidate.z) !== (previous.z > candidate.z);
    if (
      crossesCandidateZ &&
      candidate.x < ((previous.x - current.x) * (candidate.z - current.z)) / (previous.z - current.z) + current.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function isUsableWorldPolygon(polygon: readonly PlacementPointXZ[]): boolean {
  return polygon.length >= 3 && polygon.every(isFinitePoint);
}

/**
 * Applies only the detached object's world-X/Z placement policy. It deliberately
 * has no knowledge of source-normalized image geometry or the calibrated Floor quad.
 */
export function applyPlacementConstraint(
  constraint: PlacementConstraint,
  candidateXZ: PlacementPointXZ
): PlacementConstraintResult {
  if (!isFinitePoint(candidateXZ)) {
    return { ok: false, reason: "candidate X/Z must be finite" };
  }

  if (constraint.kind === "unbounded_ground_plane") {
    return { ok: true, positionXZ: candidateXZ };
  }

  if (!isUsableWorldPolygon(constraint.polygonWorldXZ)) {
    return { ok: false, reason: "room boundary polygon must contain at least three finite world X/Z points" };
  }

  if (!isPointInsideOrOnPolygon(candidateXZ, constraint.polygonWorldXZ)) {
    return { ok: false, reason: "outside room boundary" };
  }

  return { ok: true, positionXZ: candidateXZ };
}
