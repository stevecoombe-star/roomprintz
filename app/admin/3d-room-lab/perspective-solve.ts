import type { FloorPoint } from "./scene-state";

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type FloorCornerOrder = "nearLeft" | "nearRight" | "farRight" | "farLeft";

export type OrderedFloorCorners<T> = {
  nearLeft: T;
  nearRight: T;
  farRight: T;
  farLeft: T;
  asArray: [T, T, T, T];
};

export type FloorRectAssumption = {
  widthMeters: number;
  depthMeters: number;
};

export type HomographyMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type CameraIntrinsicsAssumption = {
  verticalFovDeg: number;
};

export type CameraPose = {
  position: Vec3;
  quaternion: { x: number; y: number; z: number; w: number };
};

export type SolveResult<T> =
  | { ok: true; value: T; confidence: "high" | "low"; note?: string }
  | { ok: false; reason: string };

export type ReprojectionError = {
  sampleCount: number;
  averageTargetUnits: number;
  maxTargetUnits: number;
  averageSourcePixels: number | null;
  maxSourcePixels: number | null;
};

const EPSILON = 1e-9;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isValidVec2(point: Vec2): boolean {
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function distance2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function polygonSignedArea2D(points: Vec2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return area / 2;
}

function crossZ(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const o1 = crossZ(a1, a2, b1);
  const o2 = crossZ(a1, a2, b2);
  const o3 = crossZ(b1, b2, a1);
  const o4 = crossZ(b1, b2, a2);
  return o1 * o2 < -EPSILON && o3 * o4 < -EPSILON;
}

function isConvexOrderedQuad(points: [Vec2, Vec2, Vec2, Vec2]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = crossZ(a, b, c);
    if (Math.abs(cross) < EPSILON) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (currentSign !== sign) {
      return false;
    }
  }
  return sign !== 0;
}

function hasDuplicatePoints(points: Vec2[]): boolean {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (distance2(points[i], points[j]) < 1e-6) return true;
    }
  }
  return false;
}

function gaussianSolve8x8(a: number[][], b: number[]): number[] | null {
  const n = 8;
  const mat = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let pivotAbs = Math.abs(mat[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(mat[row][col]);
      if (candidate > pivotAbs) {
        pivotAbs = candidate;
        pivotRow = row;
      }
    }
    if (pivotAbs < EPSILON) return null;
    if (pivotRow !== col) {
      const temp = mat[col];
      mat[col] = mat[pivotRow];
      mat[pivotRow] = temp;
    }

    const pivot = mat[col][col];
    for (let j = col; j <= n; j += 1) {
      mat[col][j] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = mat[row][col];
      if (Math.abs(factor) < EPSILON) continue;
      for (let j = col; j <= n; j += 1) {
        mat[row][j] -= factor * mat[col][j];
      }
    }
  }

  return mat.map((row) => row[n]);
}

function determinant3x3(m: HomographyMatrix): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * Orders a 4-point floor polygon in visible-frame/container normalized coordinates.
 * Assumes image-space y-down (larger y is nearer/front).
 */
export function orderFloorCorners(polygon: FloorPoint[]): SolveResult<OrderedFloorCorners<FloorPoint>> {
  if (!Array.isArray(polygon) || polygon.length !== 4) {
    return { ok: false, reason: "Expected exactly 4 floor polygon points." };
  }
  if (!polygon.every(isValidVec2)) {
    return { ok: false, reason: "Floor polygon contains non-finite points." };
  }
  if (hasDuplicatePoints(polygon)) {
    return { ok: false, reason: "Floor polygon points are degenerate (duplicates)." };
  }
  const area = Math.abs(polygonSignedArea2D(polygon));
  if (!isFiniteNumber(area) || area < 1e-6) {
    return { ok: false, reason: "Floor polygon area is degenerate." };
  }

  const sortedByYDesc = [...polygon].sort((a, b) => b.y - a.y);
  const nearCandidates = [sortedByYDesc[0], sortedByYDesc[1]].sort((a, b) => a.x - b.x);
  const farCandidates = [sortedByYDesc[2], sortedByYDesc[3]].sort((a, b) => a.x - b.x);

  const nearLeft = nearCandidates[0];
  const nearRight = nearCandidates[1];
  const farLeft = farCandidates[0];
  const farRight = farCandidates[1];

  const nearAvgY = (nearLeft.y + nearRight.y) / 2;
  const farAvgY = (farLeft.y + farRight.y) / 2;
  const nearWidth = Math.abs(nearRight.x - nearLeft.x);
  const farWidth = Math.abs(farRight.x - farLeft.x);
  const orderedQuad: [FloorPoint, FloorPoint, FloorPoint, FloorPoint] = [
    nearLeft,
    nearRight,
    farRight,
    farLeft,
  ];
  const hasBowTie = segmentsIntersect(nearLeft, nearRight, farRight, farLeft);
  const isConvex = isConvexOrderedQuad(orderedQuad);

  let confidence: "high" | "low" = "high";
  let note: string | undefined;

  if (nearAvgY <= farAvgY || nearWidth < EPSILON || farWidth < EPSILON) {
    confidence = "low";
    note = "Near/far ordering is weak or edge widths are narrow.";
  }
  if (hasBowTie || !isConvex) {
    confidence = "low";
    note = note
      ? `${note} Quad appears non-convex or self-intersecting.`
      : "Quad appears non-convex or self-intersecting.";
  }

  return {
    ok: true,
    value: {
      nearLeft,
      nearRight,
      farRight,
      farLeft,
      asArray: [nearLeft, nearRight, farRight, farLeft],
    },
    confidence,
    note,
  };
}

/**
 * Builds floor-rectangle corners on the world floor plane (Y=0),
 * ordered as near-left, near-right, far-right, far-left.
 * Units are meters (or consistent relative floor units).
 */
export function getFloorRectCorners(rect: FloorRectAssumption): SolveResult<OrderedFloorCorners<Vec3>> {
  if (
    !isFiniteNumber(rect.widthMeters) ||
    !isFiniteNumber(rect.depthMeters) ||
    rect.widthMeters <= 0 ||
    rect.depthMeters <= 0
  ) {
    return { ok: false, reason: "widthMeters and depthMeters must be positive finite values." };
  }

  const halfWidth = rect.widthMeters / 2;
  const halfDepth = rect.depthMeters / 2;

  const nearLeft: Vec3 = { x: -halfWidth, y: 0, z: halfDepth };
  const nearRight: Vec3 = { x: halfWidth, y: 0, z: halfDepth };
  const farRight: Vec3 = { x: halfWidth, y: 0, z: -halfDepth };
  const farLeft: Vec3 = { x: -halfWidth, y: 0, z: -halfDepth };

  return {
    ok: true,
    value: {
      nearLeft,
      nearRight,
      farRight,
      farLeft,
      asArray: [nearLeft, nearRight, farRight, farLeft],
    },
    confidence: "high",
  };
}

/**
 * Projects a world-space floor point onto 2D floor-plane coordinates for homography targets.
 * Uses X/Z plane convention: Vec3.x -> Vec2.x, Vec3.z -> Vec2.y.
 */
export function floorVec3ToPlane2D(point: Vec3): Vec2 {
  return { x: point.x, y: point.z };
}

/**
 * Solves image-to-floor planar homography H from exactly 4 correspondences.
 * - sourceImagePointsPx: image/frame pixel coordinates.
 * - targetFloorPoints2D: floor-plane 2D coordinates (typically X/Z via floorVec3ToPlane2D).
 * Output matrix is row-major with h33 fixed to 1, mapping image pixels -> floor-plane coordinates.
 */
export function solvePlaneHomography(
  sourceImagePointsPx: Vec2[],
  targetFloorPoints2D: Vec2[]
): SolveResult<HomographyMatrix> {
  if (!Array.isArray(sourceImagePointsPx) || !Array.isArray(targetFloorPoints2D)) {
    return { ok: false, reason: "Input points must be arrays." };
  }
  if (sourceImagePointsPx.length !== 4 || targetFloorPoints2D.length !== 4) {
    return { ok: false, reason: "Expected exactly 4 source and 4 target points." };
  }
  if (!sourceImagePointsPx.every(isValidVec2) || !targetFloorPoints2D.every(isValidVec2)) {
    return { ok: false, reason: "Input points must be finite." };
  }
  if (hasDuplicatePoints(sourceImagePointsPx) || hasDuplicatePoints(targetFloorPoints2D)) {
    return { ok: false, reason: "Point correspondences are degenerate (duplicates)." };
  }

  const sourceArea = Math.abs(polygonSignedArea2D(sourceImagePointsPx));
  const targetArea = Math.abs(polygonSignedArea2D(targetFloorPoints2D));
  if (sourceArea < 1e-3 || targetArea < 1e-8) {
    return { ok: false, reason: "Point sets are degenerate for homography solve." };
  }

  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const src = sourceImagePointsPx[i];
    const dst = targetFloorPoints2D[i];
    const x = src.x;
    const y = src.y;
    const u = dst.x;
    const v = dst.y;

    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const solution = gaussianSolve8x8(a, b);
  if (!solution) {
    return { ok: false, reason: "Homography solve failed (singular linear system)." };
  }

  const matrix: HomographyMatrix = [
    solution[0],
    solution[1],
    solution[2],
    solution[3],
    solution[4],
    solution[5],
    solution[6],
    solution[7],
    1,
  ];

  const det = determinant3x3(matrix);
  if (!isFiniteNumber(det) || Math.abs(det) < EPSILON) {
    return { ok: false, reason: "Solved homography is singular." };
  }

  return {
    ok: true,
    value: matrix,
    confidence: "high",
  };
}

/**
 * Applies forward homography H to map image/frame pixel coordinates -> floor-plane 2D coordinates.
 */
export function applyHomography(matrix: HomographyMatrix, point: Vec2): Vec2 | null {
  if (!isValidVec2(point)) return null;
  const x = point.x;
  const y = point.y;
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (!isFiniteNumber(denominator) || Math.abs(denominator) < EPSILON) return null;
  const outX = (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator;
  const outY = (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator;
  if (!isFiniteNumber(outX) || !isFiniteNumber(outY)) return null;
  return { x: outX, y: outY };
}

export function invertHomography(matrix: HomographyMatrix): HomographyMatrix | null {
  const det = determinant3x3(matrix);
  if (!isFiniteNumber(det) || Math.abs(det) < EPSILON) return null;
  const invDet = 1 / det;

  const m00 = (matrix[4] * matrix[8] - matrix[5] * matrix[7]) * invDet;
  const m01 = (matrix[2] * matrix[7] - matrix[1] * matrix[8]) * invDet;
  const m02 = (matrix[1] * matrix[5] - matrix[2] * matrix[4]) * invDet;

  const m10 = (matrix[5] * matrix[6] - matrix[3] * matrix[8]) * invDet;
  const m11 = (matrix[0] * matrix[8] - matrix[2] * matrix[6]) * invDet;
  const m12 = (matrix[2] * matrix[3] - matrix[0] * matrix[5]) * invDet;

  const m20 = (matrix[3] * matrix[7] - matrix[4] * matrix[6]) * invDet;
  const m21 = (matrix[1] * matrix[6] - matrix[0] * matrix[7]) * invDet;
  const m22 = (matrix[0] * matrix[4] - matrix[1] * matrix[3]) * invDet;

  if (![m00, m01, m02, m10, m11, m12, m20, m21, m22].every(isFiniteNumber)) return null;

  return [m00, m01, m02, m10, m11, m12, m20, m21, m22];
}

/**
 * Applies inverse homography to map floor-plane 2D coordinates -> image/frame pixel coordinates.
 */
export function applyInverseHomography(matrix: HomographyMatrix, point: Vec2): Vec2 | null {
  const inverse = invertHomography(matrix);
  if (!inverse) return null;
  return applyHomography(inverse, point);
}

/**
 * Computes reprojection diagnostics for paired correspondences.
 * - average/max target error are in target floor-plane units.
 * - average/max source error are in image/frame pixels (when inverse is valid).
 */
export function computeReprojectionError(
  matrix: HomographyMatrix,
  sourceImagePointsPx: Vec2[],
  targetFloorPoints2D: Vec2[]
): SolveResult<ReprojectionError> {
  if (sourceImagePointsPx.length !== targetFloorPoints2D.length || sourceImagePointsPx.length === 0) {
    return { ok: false, reason: "Source and target arrays must have equal non-zero length." };
  }
  if (!sourceImagePointsPx.every(isValidVec2) || !targetFloorPoints2D.every(isValidVec2)) {
    return { ok: false, reason: "Reprojection inputs must be finite." };
  }

  const inverse = invertHomography(matrix);
  let totalTargetError = 0;
  let maxTargetError = 0;
  let totalSourceError = 0;
  let maxSourceError = 0;
  let sourceErrorCount = 0;

  for (let i = 0; i < sourceImagePointsPx.length; i += 1) {
    const source = sourceImagePointsPx[i];
    const target = targetFloorPoints2D[i];

    const projected = applyHomography(matrix, source);
    if (!projected) {
      return { ok: false, reason: "Forward homography projection failed for one or more points." };
    }
    const targetError = distance2(projected, target);
    totalTargetError += targetError;
    if (targetError > maxTargetError) maxTargetError = targetError;

    if (inverse) {
      const projectedBack = applyHomography(inverse, target);
      if (projectedBack) {
        const sourceError = distance2(projectedBack, source);
        totalSourceError += sourceError;
        if (sourceError > maxSourceError) maxSourceError = sourceError;
        sourceErrorCount += 1;
      }
    }
  }

  return {
    ok: true,
    value: {
      sampleCount: sourceImagePointsPx.length,
      averageTargetUnits: totalTargetError / sourceImagePointsPx.length,
      maxTargetUnits: maxTargetError,
      averageSourcePixels: sourceErrorCount > 0 ? totalSourceError / sourceErrorCount : null,
      maxSourcePixels: sourceErrorCount > 0 ? maxSourceError : null,
    },
    confidence: "high",
  };
}

export function decomposeHomographyToCameraPose(): SolveResult<CameraPose> {
  return {
    ok: false,
    reason: "Deferred: homography-to-camera decomposition is planned for a later phase.",
  };
}
