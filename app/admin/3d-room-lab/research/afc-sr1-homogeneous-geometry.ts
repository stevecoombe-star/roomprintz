/**
 * Small, browser-safe homogeneous kernel for AFC-SR1 projective evidence.
 *
 * Points and lines intentionally retain their homogeneous representation:
 * vanishing points may have w = 0 and must not be Euclideanized prematurely.
 */

export const AFC_SR1_HOMOGENEOUS_EPSILON = 1e-8;

export type HomogeneousPoint2 = Readonly<{
  x: number;
  y: number;
  w: number;
}>;

export type HomogeneousLine2 = Readonly<{
  a: number;
  b: number;
  c: number;
}>;

export type EuclideanPoint2 = Readonly<{
  x: number;
  y: number;
}>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePoint(point: HomogeneousPoint2): boolean {
  return finite(point.x) && finite(point.y) && finite(point.w);
}

function finiteLine(line: HomogeneousLine2): boolean {
  return finite(line.a) && finite(line.b) && finite(line.c);
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}

function freezePoint(x: number, y: number, w: number): HomogeneousPoint2 {
  return Object.freeze({
    x: canonicalZero(x),
    y: canonicalZero(y),
    w: canonicalZero(w),
  });
}

function freezeLine(a: number, b: number, c: number): HomogeneousLine2 {
  return Object.freeze({
    a: canonicalZero(a),
    b: canonicalZero(b),
    c: canonicalZero(c),
  });
}

/**
 * Applies deterministic normal-length and sign normalization to a line.
 * `l` and `-l` therefore produce exactly the same representation.
 */
export function normalizeCanonicalLine(
  line: HomogeneousLine2,
  epsilon = AFC_SR1_HOMOGENEOUS_EPSILON
): HomogeneousLine2 | null {
  if (!finiteLine(line) || !finite(epsilon) || epsilon <= 0) return null;
  const normalLength = Math.hypot(line.a, line.b);
  if (!finite(normalLength) || normalLength === 0) return null;

  let a = line.a / normalLength;
  let b = line.b / normalLength;
  let c = line.c / normalLength;
  if (!finite(a) || !finite(b) || !finite(c)) return null;

  if (b < -epsilon || (Math.abs(b) <= epsilon && a < 0)) {
    a = -a;
    b = -b;
    c = -c;
  }
  return freezeLine(a, b, c);
}

/**
 * Canonically L2-normalizes a point for observability and scale-invariant
 * finite-point checks. It never converts w to one.
 */
export function normalizePointForDiagnostics(
  point: HomogeneousPoint2,
  epsilon = AFC_SR1_HOMOGENEOUS_EPSILON
): HomogeneousPoint2 | null {
  if (!finitePoint(point) || !finite(epsilon) || epsilon <= 0) return null;
  const length = Math.hypot(point.x, point.y, point.w);
  if (!finite(length) || length === 0) return null;

  let x = point.x / length;
  let y = point.y / length;
  let w = point.w / length;
  if (!finite(x) || !finite(y) || !finite(w)) return null;

  const firstSignificant = Math.abs(x) > epsilon ? x : Math.abs(y) > epsilon ? y : w;
  if (firstSignificant < 0) {
    x = -x;
    y = -y;
    w = -w;
  }
  return freezePoint(x, y, w);
}

export function isFiniteHomogeneousPoint(
  point: HomogeneousPoint2,
  epsilon = AFC_SR1_HOMOGENEOUS_EPSILON
): boolean {
  const normalized = normalizePointForDiagnostics(point, epsilon);
  return normalized !== null && Math.abs(normalized.w) > epsilon;
}

export function euclideanizeFinitePoint(
  point: HomogeneousPoint2,
  epsilon = AFC_SR1_HOMOGENEOUS_EPSILON
): EuclideanPoint2 | null {
  const normalized = normalizePointForDiagnostics(point, epsilon);
  if (!normalized || Math.abs(normalized.w) <= epsilon) return null;
  const x = normalized.x / normalized.w;
  const y = normalized.y / normalized.w;
  if (!finite(x) || !finite(y)) return null;
  return Object.freeze({ x, y });
}

export function finitePointToHomogeneous(point: EuclideanPoint2): HomogeneousPoint2 | null {
  if (!finite(point.x) || !finite(point.y)) return null;
  return freezePoint(point.x, point.y, 1);
}

/** Returns the canonical homogeneous line p × q. */
export function lineThroughPoints(
  first: HomogeneousPoint2,
  second: HomogeneousPoint2,
  epsilon = AFC_SR1_HOMOGENEOUS_EPSILON
): HomogeneousLine2 | null {
  if (!finitePoint(first) || !finitePoint(second)) return null;
  const normalizedFirst = normalizePointForDiagnostics(first, epsilon);
  const normalizedSecond = normalizePointForDiagnostics(second, epsilon);
  if (!normalizedFirst || !normalizedSecond) return null;
  const line = {
    a: normalizedFirst.y * normalizedSecond.w - normalizedFirst.w * normalizedSecond.y,
    b: normalizedFirst.w * normalizedSecond.x - normalizedFirst.x * normalizedSecond.w,
    c: normalizedFirst.x * normalizedSecond.y - normalizedFirst.y * normalizedSecond.x,
  };
  if (Math.hypot(line.a, line.b) <= epsilon) return null;
  return normalizeCanonicalLine(line, epsilon);
}

/** Returns the canonically L2-normalized homogeneous intersection l × m. */
export function intersectLines(
  first: HomogeneousLine2,
  second: HomogeneousLine2,
  epsilon = AFC_SR1_HOMOGENEOUS_EPSILON
): HomogeneousPoint2 | null {
  if (!finiteLine(first) || !finiteLine(second)) return null;
  const normalizedFirst = normalizeCanonicalLine(first, epsilon);
  const normalizedSecond = normalizeCanonicalLine(second, epsilon);
  if (!normalizedFirst || !normalizedSecond) return null;
  const point = {
    x: normalizedFirst.b * normalizedSecond.c - normalizedFirst.c * normalizedSecond.b,
    y: normalizedFirst.c * normalizedSecond.a - normalizedFirst.a * normalizedSecond.c,
    w: normalizedFirst.a * normalizedSecond.b - normalizedFirst.b * normalizedSecond.a,
  };
  if (Math.hypot(point.x, point.y, point.w) <= epsilon) return null;
  return normalizePointForDiagnostics(point, epsilon);
}
