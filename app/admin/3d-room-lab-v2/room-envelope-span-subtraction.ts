import { ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M } from "./room-boundary-authority-contract";
import { mergeParameterIntervals } from "./room-opening-intersection-geometry";

export type ParameterInterval = Readonly<{ t0: number; t1: number }>;

export type WorldXzSegment = Readonly<{
  a: Readonly<{ x: number; z: number }>;
  b: Readonly<{ x: number; z: number }>;
}>;

const ZERO_WIDTH = 1e-12;

/**
 * Subtract merged opening intervals from the source finite span t ∈ [0, 1].
 * Never extends outside the original interval. World residuals are lerps of
 * the existing S4A world segment using the same t.
 */
export function subtractParameterIntervals(
  source: ParameterInterval,
  gaps: readonly ParameterInterval[],
): readonly ParameterInterval[] {
  const origin = clampInterval({
    t0: Math.min(source.t0, source.t1),
    t1: Math.max(source.t0, source.t1),
  });
  const merged = mergeParameterIntervals(
    gaps.map((gap) => clampInterval({
      t0: Math.max(origin.t0, Math.min(gap.t0, gap.t1)),
      t1: Math.min(origin.t1, Math.max(gap.t0, gap.t1)),
    })),
  );
  const residuals: ParameterInterval[] = [];
  let cursor = origin.t0;
  for (const gap of merged) {
    if (gap.t0 > cursor + ZERO_WIDTH) {
      residuals.push({ t0: cursor, t1: Math.min(gap.t0, origin.t1) });
    }
    cursor = Math.max(cursor, gap.t1);
  }
  if (origin.t1 > cursor + ZERO_WIDTH) {
    residuals.push({ t0: cursor, t1: origin.t1 });
  }
  return Object.freeze(
    residuals
      .map(clampInterval)
      .filter((interval) => interval.t1 - interval.t0 > ZERO_WIDTH)
      .sort((left, right) => left.t0 - right.t0 || left.t1 - right.t1),
  );
}

export function lerpWorldXzSegment(
  segment: WorldXzSegment,
  t: number,
): Readonly<{ x: number; z: number }> {
  const clamped = Math.min(1, Math.max(0, t));
  return Object.freeze({
    x: segment.a.x + (segment.b.x - segment.a.x) * clamped,
    z: segment.a.z + (segment.b.z - segment.a.z) * clamped,
  });
}

export function residualWorldSegments(
  segment: WorldXzSegment,
  residuals: readonly ParameterInterval[],
): readonly WorldXzSegment[] {
  return Object.freeze(
    residuals
      .map((interval) => {
        const a = lerpWorldXzSegment(segment, interval.t0);
        const b = lerpWorldXzSegment(segment, interval.t1);
        return Object.freeze({ a, b });
      })
      .filter((item) => worldLength(item) >= ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M),
  );
}

export function worldLength(segment: WorldXzSegment): number {
  return Math.hypot(segment.b.x - segment.a.x, segment.b.z - segment.a.z);
}

function clampInterval(interval: ParameterInterval): ParameterInterval {
  return {
    t0: Math.min(1, Math.max(0, interval.t0)),
    t1: Math.min(1, Math.max(0, interval.t1)),
  };
}
