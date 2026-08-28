import type { SourceNormalizedPoint } from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_LINE_FIT_VERSION,
  type RoomBoundaryLineResidual,
  type RoomBoundaryWorldXz,
  type RoomBoundaryWorldXyz,
} from "./room-boundary-authority-contract";

export { AFC_V2_ROOM_BOUNDARY_LINE_FIT_VERSION };

const SPREAD_EPSILON = 1e-12;

export type FittedImageLine = Readonly<{
  origin: SourceNormalizedPoint;
  direction: SourceNormalizedPoint;
  residual: RoomBoundaryLineResidual;
}>;

export type FittedWorldXzLine = Readonly<{
  origin: RoomBoundaryWorldXz;
  direction: RoomBoundaryWorldXz;
  residual: RoomBoundaryLineResidual;
}>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Orthogonal residuals from a best-fit infinite image-space line.
 * All samples are evaluated; the fit never drops intermediate points.
 */
export function imagePolylineLineFit(
  points: readonly SourceNormalizedPoint[],
): FittedImageLine | null {
  if (points.length < 2 || !points.every((point) => finite(point.x) && finite(point.y))) {
    return null;
  }
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  const covariance = points.reduce((sum, point) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return { xx: sum.xx + x * x, xy: sum.xy + x * y, yy: sum.yy + y * y };
  }, { xx: 0, xy: 0, yy: 0 });
  const angle = 0.5 * Math.atan2(2 * covariance.xy, covariance.xx - covariance.yy);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const spread = covariance.xx + covariance.yy;
  if (!finite(spread) || spread <= SPREAD_EPSILON) return null;
  const distances = points.map((point) =>
    Math.abs((point.x - center.x) * direction.y - (point.y - center.y) * direction.x)
  );
  return {
    origin: center,
    direction,
    residual: {
      meanDistance: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
      maxDistance: Math.max(...distances),
      sampleCount: points.length,
    },
  };
}

/**
 * Orthogonal residuals from a best-fit infinite world XZ line. Adapted from
 * the historical P2 idea without importing fixture/oracle architecture.
 */
export function worldXzLineFit(
  points: readonly RoomBoundaryWorldXz[],
): FittedWorldXzLine | null {
  if (points.length < 2 || !points.every((point) => finite(point.x) && finite(point.z))) {
    return null;
  }
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
  const covariance = points.reduce((sum, point) => {
    const x = point.x - center.x;
    const z = point.z - center.z;
    return { xx: sum.xx + x * x, xz: sum.xz + x * z, zz: sum.zz + z * z };
  }, { xx: 0, xz: 0, zz: 0 });
  const angle = 0.5 * Math.atan2(2 * covariance.xz, covariance.xx - covariance.zz);
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  const spread = covariance.xx + covariance.zz;
  if (!finite(spread) || spread <= SPREAD_EPSILON) return null;
  const distances = points.map((point) =>
    Math.abs((point.x - center.x) * direction.z - (point.z - center.z) * direction.x)
  );
  return {
    origin: center,
    direction,
    residual: {
      meanDistance: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
      maxDistance: Math.max(...distances),
      sampleCount: points.length,
    },
  };
}

/**
 * Finite span covering only the observed samples along the fitted line.
 * Never extends past the projected observed range.
 */
export function finiteWorldSpanAlongLine(
  points: readonly RoomBoundaryWorldXz[],
  origin: RoomBoundaryWorldXz,
  direction: RoomBoundaryWorldXz,
): Readonly<{ start: RoomBoundaryWorldXyz; end: RoomBoundaryWorldXyz; length: number }> | null {
  if (points.length < 2) return null;
  const directionLength = Math.hypot(direction.x, direction.z);
  if (!finite(directionLength) || directionLength <= SPREAD_EPSILON) return null;
  const unit = { x: direction.x / directionLength, z: direction.z / directionLength };
  const scalars = points.map((point) =>
    (point.x - origin.x) * unit.x + (point.z - origin.z) * unit.z
  );
  if (!scalars.every(finite)) return null;
  const min = Math.min(...scalars);
  const max = Math.max(...scalars);
  const length = max - min;
  if (!finite(length) || length <= 0) return null;
  return {
    start: { x: origin.x + unit.x * min, y: 0, z: origin.z + unit.z * min },
    end: { x: origin.x + unit.x * max, y: 0, z: origin.z + unit.z * max },
    length,
  };
}

export function polylineLength(
  points: readonly SourceNormalizedPoint[],
): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return length;
}

export function horizontalRunRatio(
  points: readonly SourceNormalizedPoint[],
): number | null {
  if (points.length < 2) return null;
  const length = polylineLength(points);
  if (!finite(length) || length <= SPREAD_EPSILON) return null;
  const xs = points.map((point) => point.x);
  const horizontalRun = Math.max(...xs) - Math.min(...xs);
  if (!finite(horizontalRun)) return null;
  return horizontalRun / length;
}
