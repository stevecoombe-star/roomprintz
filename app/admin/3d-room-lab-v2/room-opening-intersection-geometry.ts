import type {
  EmptyObservedOpening,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";

export const OPENING_ON_BOUNDARY_ABS = 1e-12;
export const OPENING_COLLINEAR_CROSS_ABS = 1e-14;
export const OPENING_PARAM_MERGE_ABS = 1e-12;
export const OPENING_ENDPOINT_PARAM_EPS = 1e-9;

export type OpeningParameterInterval = Readonly<{ t0: number; t1: number }>;

/**
 * Whole-boundary opening veto used by certified S4B. Touching a jamb or
 * opening endpoint is not a crossing. Behavior must remain identical to the
 * S4B extraction source.
 */
export function floorWallPolylineCrossesOpeningInterior(
  polyline: readonly SourceNormalizedPoint[],
  openings: readonly EmptyObservedOpening[],
): boolean {
  if (polyline.length < 2 || openings.length === 0) return false;
  for (const opening of openings) {
    const boundary = opening.sourceNormalizedBoundary;
    if (boundary.length < 2) continue;
    if (opening.boundaryClosure === "complete_visible_outline" && boundary.length >= 3) {
      if (polylineCrossesPolygonInterior(polyline, boundary)) return true;
      continue;
    }
    if (polylineProperlyCrossesPolyline(polyline, boundary)) return true;
  }
  return false;
}

export function polylineArcLength(polyline: readonly SourceNormalizedPoint[]): number {
  let length = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    length += Math.hypot(
      polyline[index + 1].x - polyline[index].x,
      polyline[index + 1].y - polyline[index].y,
    );
  }
  return length;
}

export function openingInteriorIntervalsAlongPolyline(
  polyline: readonly SourceNormalizedPoint[],
  opening: EmptyObservedOpening,
): readonly OpeningParameterInterval[] {
  const total = polylineArcLength(polyline);
  if (polyline.length < 2 || total <= 1e-12) return Object.freeze([]);
  const boundary = opening.sourceNormalizedBoundary;
  if (boundary.length < 2) return Object.freeze([]);
  if (opening.boundaryClosure === "complete_visible_outline" && boundary.length >= 3) {
    return Object.freeze(mergeParameterIntervals(
      polygonInteriorIntervalsAlongPolyline(polyline, boundary, total),
    ));
  }
  return Object.freeze(mergeParameterIntervals(
    properIntersectionSpanAlongPolyline(polyline, boundary),
  ));
}

export function properSeamOpeningIntersectionParameters(
  polyline: readonly SourceNormalizedPoint[],
  opening: EmptyObservedOpening,
): readonly number[] {
  const closed = opening.boundaryClosure === "complete_visible_outline" &&
    opening.sourceNormalizedBoundary.length >= 3;
  return properPolylineIntersectionParameters(
    polyline,
    opening.sourceNormalizedBoundary,
    closed,
  );
}

export function polylineCrossesPolygonInterior(
  polyline: readonly SourceNormalizedPoint[],
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  for (const point of polyline) {
    if (strictlyInsidePolygon(point, polygon)) return true;
  }
  for (let index = 0; index < polyline.length - 1; index += 1) {
    if (segmentCrossesPolygonInterior(polyline[index], polyline[index + 1], polygon)) {
      return true;
    }
  }
  return false;
}

export function strictlyInsidePolygon(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  return pointInPolygon(point, polygon) && !pointOnPolygonBoundary(point, polygon);
}

export function pointOnPolygonBoundary(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) {
      return true;
    }
  }
  return false;
}

export function mergeParameterIntervals(
  intervals: readonly OpeningParameterInterval[],
): OpeningParameterInterval[] {
  const sorted = intervals
    .map((interval) => ({
      t0: Math.min(interval.t0, interval.t1),
      t1: Math.max(interval.t0, interval.t1),
    }))
    .filter((interval) => interval.t1 - interval.t0 > OPENING_PARAM_MERGE_ABS)
    .sort((left, right) => left.t0 - right.t0 || left.t1 - right.t1);
  const merged: OpeningParameterInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.t0 > last.t1 + OPENING_PARAM_MERGE_ABS) {
      merged.push({ t0: interval.t0, t1: interval.t1 });
      continue;
    }
    merged[merged.length - 1] = {
      t0: last.t0,
      t1: Math.max(last.t1, interval.t1),
    };
  }
  return merged;
}

function polygonInteriorIntervalsAlongPolyline(
  polyline: readonly SourceNormalizedPoint[],
  polygon: readonly SourceNormalizedPoint[],
  totalLength: number,
): OpeningParameterInterval[] {
  const intervals: OpeningParameterInterval[] = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength <= 1e-18) continue;
    const prefix = prefixLength(polyline, index);
    const params = [0, 1];
    for (let edge = 0; edge < polygon.length; edge += 1) {
      const hit = closedSegmentIntersectionParameter(
        start,
        end,
        polygon[edge],
        polygon[(edge + 1) % polygon.length],
      );
      if (hit !== null) params.push(hit);
    }
    params.sort((left, right) => left - right);
    const unique = uniqueParams(params);
    for (let cursor = 0; cursor < unique.length - 1; cursor += 1) {
      const t0 = unique[cursor];
      const t1 = unique[cursor + 1];
      if (t1 - t0 <= OPENING_PARAM_MERGE_ABS) continue;
      const mid = {
        x: start.x + (end.x - start.x) * ((t0 + t1) / 2),
        y: start.y + (end.y - start.y) * ((t0 + t1) / 2),
      };
      if (!strictlyInsidePolygon(mid, polygon)) continue;
      intervals.push({
        t0: (prefix + t0 * segmentLength) / totalLength,
        t1: (prefix + t1 * segmentLength) / totalLength,
      });
    }
  }
  return intervals;
}

function properPolylineIntersectionParameters(
  polyline: readonly SourceNormalizedPoint[],
  boundary: readonly SourceNormalizedPoint[],
  closed: boolean,
): readonly number[] {
  const total = polylineArcLength(polyline);
  if (polyline.length < 2 || total <= 1e-12 || boundary.length < 2) {
    return Object.freeze([]);
  }
  const hits: number[] = [];
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const start = polyline[i];
    const end = polyline[i + 1];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength <= 1e-18) continue;
    const prefix = prefixLength(polyline, i);
    const edgeCount = closed ? boundary.length : boundary.length - 1;
    for (let j = 0; j < edgeCount; j += 1) {
      const edgeStart = boundary[j];
      const edgeEnd = closed
        ? boundary[(j + 1) % boundary.length]
        : boundary[j + 1];
      const hit = segmentIntersection(start, end, edgeStart, edgeEnd, false);
      if (!hit) continue;
      hits.push((prefix + hit.t * segmentLength) / total);
    }
  }
  hits.sort((left, right) => left - right);
  return Object.freeze(uniqueParams(hits));
}

function properIntersectionSpanAlongPolyline(
  polyline: readonly SourceNormalizedPoint[],
  boundary: readonly SourceNormalizedPoint[],
): OpeningParameterInterval[] {
  const hits = properPolylineIntersectionParameters(polyline, boundary, false);
  if (hits.length < 2) return [];
  return [{ t0: hits[0]!, t1: hits[hits.length - 1]! }];
}

function prefixLength(
  polyline: readonly SourceNormalizedPoint[],
  segmentIndex: number,
): number {
  let length = 0;
  for (let index = 0; index < segmentIndex; index += 1) {
    length += Math.hypot(
      polyline[index + 1].x - polyline[index].x,
      polyline[index + 1].y - polyline[index].y,
    );
  }
  return length;
}

function segmentCrossesPolygonInterior(
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  const params = [0, 1];
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const hit = closedSegmentIntersectionParameter(start, end, edgeStart, edgeEnd);
    if (hit !== null) params.push(hit);
  }
  params.sort((left, right) => left - right);
  const unique = uniqueParams(params);
  for (let index = 0; index < unique.length - 1; index += 1) {
    const t0 = unique[index];
    const t1 = unique[index + 1];
    if (t1 - t0 <= OPENING_PARAM_MERGE_ABS) continue;
    const mid = {
      x: start.x + (end.x - start.x) * ((t0 + t1) / 2),
      y: start.y + (end.y - start.y) * ((t0 + t1) / 2),
    };
    if (strictlyInsidePolygon(mid, polygon)) return true;
  }
  return false;
}

function polylineProperlyCrossesPolyline(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): boolean {
  for (let i = 0; i < first.length - 1; i += 1) {
    for (let j = 0; j < second.length - 1; j += 1) {
      if (segmentsProperlyIntersect(first[i], first[i + 1], second[j], second[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

function pointInPolygon(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): boolean {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const apx = point.x - start.x;
  const apy = point.y - start.y;
  const cross = abx * apy - aby * apx;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 1e-24) {
    return Math.hypot(apx, apy) <= OPENING_ON_BOUNDARY_ABS;
  }
  if (Math.abs(cross) > OPENING_ON_BOUNDARY_ABS * Math.sqrt(lengthSq)) return false;
  const dot = apx * abx + apy * aby;
  return dot >= -OPENING_ON_BOUNDARY_ABS && dot <= lengthSq + OPENING_ON_BOUNDARY_ABS;
}

function closedSegmentIntersectionParameter(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
): number | null {
  const hit = segmentIntersection(a, b, c, d, true);
  return hit ? hit.t : null;
}

function segmentsProperlyIntersect(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
): boolean {
  return segmentIntersection(a, b, c, d, false) !== null;
}

function segmentIntersection(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
  inclusive: boolean,
): { t: number; u: number } | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const denom = abx * cdy - aby * cdx;
  if (Math.abs(denom) <= OPENING_COLLINEAR_CROSS_ABS) return null;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const t = (acx * cdy - acy * cdx) / denom;
  const u = (acx * aby - acy * abx) / denom;
  if (inclusive) {
    if (t < -OPENING_PARAM_MERGE_ABS || t > 1 + OPENING_PARAM_MERGE_ABS) return null;
    if (u < -OPENING_PARAM_MERGE_ABS || u > 1 + OPENING_PARAM_MERGE_ABS) return null;
    return { t: Math.min(1, Math.max(0, t)), u };
  }
  if (t <= OPENING_PARAM_MERGE_ABS || t >= 1 - OPENING_PARAM_MERGE_ABS) return null;
  if (u <= OPENING_PARAM_MERGE_ABS || u >= 1 - OPENING_PARAM_MERGE_ABS) return null;
  return { t, u };
}

function uniqueParams(values: readonly number[]): number[] {
  const unique: number[] = [];
  for (const value of values) {
    const last = unique[unique.length - 1];
    if (last === undefined || Math.abs(value - last) > OPENING_PARAM_MERGE_ABS) {
      unique.push(value);
    }
  }
  return unique;
}
