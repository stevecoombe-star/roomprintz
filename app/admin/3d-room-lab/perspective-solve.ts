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
  lookAt: Vec3;
  up: Vec3;
  quaternion?: [number, number, number, number];
};

export type CameraPoseDiagnostics = {
  focalLengthPx: number;
  lambda: number;
  selectedScaleSign: 1 | -1;
  selectedNormalSign: -1;
  columnScaleRatio: number;
  determinant: number;
  orthonormalityError: number;
  cameraHeight: number;
  cameraZ: number;
  averageCameraPoseReprojectionPx: number;
  maxCameraPoseReprojectionPx: number;
  perCornerCvReprojectionPx?: number[];
  candidatesPassingCheirality?: number;
  bestCandidateSummary?: string;
  candidateSummaries?: string[];
  reason?: string;
};

export type CameraPoseDecomposition = {
  pose: CameraPose;
  diagnostics: CameraPoseDiagnostics;
  cvProjection: CameraPoseCvProjection;
};

export type CameraPoseCvProjection = {
  rotationPlaneToCv: Matrix3x3;
  translationCv: Vec3;
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
const MIN_FOV_DEG = 20;
const MAX_FOV_DEG = 90;
const MIN_CAMERA_HEIGHT = 0.05;
const MIN_COLUMN_NORM = 1e-6;
const MAX_COLUMN_SCALE_RATIO_HARD = 10;
const MAX_COLUMN_SCALE_RATIO_LOW_CONFIDENCE = 2.5;
const MAX_ORTHONORMALITY_ERROR_HARD = 0.25;
const MAX_ORTHONORMALITY_ERROR_LOW_CONFIDENCE = 0.05;
const MAX_CAMERA_POSE_REPROJECTION_HARD_PX = 400;
const MAX_CAMERA_POSE_REPROJECTION_LOW_CONFIDENCE_PX = 24;

export type Matrix3x3 = [number, number, number, number, number, number, number, number, number];

type CameraIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  matrix: Matrix3x3;
  inverse: Matrix3x3;
};

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

function vec3Length(value: Vec3): number {
  return Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

function normalizeVec3(value: Vec3): Vec3 | null {
  const length = vec3Length(value);
  if (!isFiniteNumber(length) || length < EPSILON) return null;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec3(value: Vec3, scalar: number): Vec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function getColumn(matrix: Matrix3x3, index: 0 | 1 | 2): Vec3 {
  return {
    x: matrix[index],
    y: matrix[index + 3],
    z: matrix[index + 6],
  };
}

function matrixFromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Matrix3x3 {
  return [c0.x, c1.x, c2.x, c0.y, c1.y, c2.y, c0.z, c1.z, c2.z];
}

function matrixMultiply3x3(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  const out: number[] = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[col + 3] + a[row * 3 + 2] * b[col + 6];
    }
  }
  return out as Matrix3x3;
}

function matrixTranspose3x3(matrix: Matrix3x3): Matrix3x3 {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

function multiplyMatrixVec3(matrix: Matrix3x3, vector: Vec3): Vec3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

function orthonormalityError(columns: [Vec3, Vec3, Vec3]): number {
  const [c0, c1, c2] = columns;
  const d00 = Math.abs(dotVec3(c0, c0) - 1);
  const d11 = Math.abs(dotVec3(c1, c1) - 1);
  const d22 = Math.abs(dotVec3(c2, c2) - 1);
  const d01 = Math.abs(dotVec3(c0, c1));
  const d02 = Math.abs(dotVec3(c0, c2));
  const d12 = Math.abs(dotVec3(c1, c2));
  return d00 + d11 + d22 + d01 + d02 + d12;
}

function sanitizeHomographyMatrix(matrix: HomographyMatrix): Matrix3x3 {
  return [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5], matrix[6], matrix[7], matrix[8]];
}

function mapPlaneDirectionToWorld(direction: Vec3): Vec3 {
  return {
    x: direction.x,
    // Natural floor-plane basis is axis0=X, axis1=Z, normal=XxZ=-Y.
    y: -direction.z,
    z: direction.y,
  };
}

/**
 * Builds a pinhole intrinsics approximation from visible frame size and vertical FOV.
 * Assumptions:
 * - square pixels (fx = fy),
 * - no skew,
 * - principal point at the visible frame center.
 */
export function buildCameraIntrinsicsFromFov(
  frameSize: { width: number; height: number },
  verticalFovDeg: number
): SolveResult<CameraIntrinsics> {
  if (!isFiniteNumber(frameSize.width) || !isFiniteNumber(frameSize.height) || frameSize.width <= 0 || frameSize.height <= 0) {
    return { ok: false, reason: "Frame size must be positive finite values." };
  }
  if (!isFiniteNumber(verticalFovDeg) || verticalFovDeg < MIN_FOV_DEG || verticalFovDeg > MAX_FOV_DEG) {
    return { ok: false, reason: `verticalFovDeg must be within ${MIN_FOV_DEG}-${MAX_FOV_DEG} degrees.` };
  }

  const fovRad = (verticalFovDeg * Math.PI) / 180;
  const fy = frameSize.height / (2 * Math.tan(fovRad / 2));
  const fx = fy;
  const cx = frameSize.width / 2;
  const cy = frameSize.height / 2;
  if (![fx, fy, cx, cy].every(isFiniteNumber) || fx <= 0 || fy <= 0) {
    return { ok: false, reason: "Could not derive a valid focal length from the provided FOV/frame." };
  }

  const matrix: Matrix3x3 = [fx, 0, cx, 0, fy, cy, 0, 0, 1];
  const inverse: Matrix3x3 = [1 / fx, 0, -cx / fx, 0, 1 / fy, -cy / fy, 0, 0, 1];

  return {
    ok: true,
    value: { fx, fy, cx, cy, matrix, inverse },
    confidence: "high",
  };
}

function projectFloorPointThroughPoseWithCameraIntrinsics(
  pose: CameraPose,
  cameraIntrinsics: CameraIntrinsics,
  floorPoint2D: Vec2
): SolveResult<Vec2> {
  if (
    !isValidVec2(floorPoint2D) ||
    ![pose.position.x, pose.position.y, pose.position.z, pose.lookAt.x, pose.lookAt.y, pose.lookAt.z, pose.up.x, pose.up.y, pose.up.z].every(
      isFiniteNumber
    )
  ) {
    return { ok: false, reason: "Pose projection failed: input values must be finite." };
  }

  const zAxis = normalizeVec3(subtractVec3(pose.position, pose.lookAt));
  if (!zAxis) {
    return { ok: false, reason: "Pose projection failed: camera position and lookAt are degenerate." };
  }
  const xAxis = normalizeVec3(crossVec3(pose.up, zAxis));
  if (!xAxis) {
    return { ok: false, reason: "Pose projection failed: camera up vector is degenerate." };
  }
  const yAxis = normalizeVec3(crossVec3(zAxis, xAxis));
  if (!yAxis) {
    return { ok: false, reason: "Pose projection failed: could not build camera view basis." };
  }

  // floorPoint2D uses floor-plane coordinates: {x, y} => world {x, y:0, z:y}
  const worldPoint: Vec3 = { x: floorPoint2D.x, y: 0, z: floorPoint2D.y };
  const worldFromCamera = subtractVec3(worldPoint, pose.position);
  const xCam = dotVec3(worldFromCamera, xAxis);
  const yCam = dotVec3(worldFromCamera, yAxis);
  const zCam = dotVec3(worldFromCamera, zAxis);
  if (!isFiniteNumber(xCam) || !isFiniteNumber(yCam) || !isFiniteNumber(zCam)) {
    return { ok: false, reason: "Pose projection failed: non-finite camera-space coordinates." };
  }
  if (zCam >= -EPSILON) {
    return { ok: false, reason: "Pose projection failed: point is behind camera." };
  }

  const perspectiveScale = 1 / -zCam;
  const xPx = cameraIntrinsics.fx * (xCam * perspectiveScale) + cameraIntrinsics.cx;
  // Camera y is up while image y increases downward, so projected y is inverted.
  const yPx = cameraIntrinsics.cy - cameraIntrinsics.fy * (yCam * perspectiveScale);
  if (!isFiniteNumber(xPx) || !isFiniteNumber(yPx)) {
    return { ok: false, reason: "Pose projection failed: non-finite projected pixel coordinates." };
  }

  return {
    ok: true,
    value: { x: xPx, y: yPx },
    confidence: "high",
  };
}

function projectFloorPointWithRtCv(
  rotationPlaneToCv: Matrix3x3,
  translationCv: Vec3,
  cameraIntrinsics: CameraIntrinsics,
  floorPoint2D: Vec2
): SolveResult<{ pointPx: Vec2; depthZ: number }> {
  if (!isValidVec2(floorPoint2D)) {
    return { ok: false, reason: "CV reprojection failed: floor point must be finite." };
  }

  // floor-plane 2D {x, y} is represented in decomposition plane coordinates as [X, Z, 0].
  const planePoint: Vec3 = { x: floorPoint2D.x, y: floorPoint2D.y, z: 0 };
  const cameraPoint = addVec3(multiplyMatrixVec3(rotationPlaneToCv, planePoint), translationCv);
  if (![cameraPoint.x, cameraPoint.y, cameraPoint.z].every(isFiniteNumber)) {
    return { ok: false, reason: "CV reprojection failed: non-finite camera-space point." };
  }
  if (cameraPoint.z <= EPSILON) {
    return { ok: false, reason: "CV reprojection failed: point is not in front of camera (cheirality)." };
  }

  const xPx = cameraIntrinsics.fx * (cameraPoint.x / cameraPoint.z) + cameraIntrinsics.cx;
  const yPx = cameraIntrinsics.fy * (cameraPoint.y / cameraPoint.z) + cameraIntrinsics.cy;
  if (!isFiniteNumber(xPx) || !isFiniteNumber(yPx)) {
    return { ok: false, reason: "CV reprojection failed: non-finite projected pixel coordinates." };
  }

  return {
    ok: true,
    value: { pointPx: { x: xPx, y: yPx }, depthZ: cameraPoint.z },
    confidence: "high",
  };
}

/**
 * Projects a floor-plane 2D point through recovered CV decomposition parameters.
 * This uses the same validated CV convention as decomposition candidate checks:
 * - floor point {x, y} -> plane vector [X=x, Z=y, 0]
 * - camera point Pc = R * [X, Z, 0] + t
 * - cheirality requires Pc.z > 0
 * - image projection uses u = fx * Pc.x / Pc.z + cx, v = fy * Pc.y / Pc.z + cy
 */
export function projectFloorPointThroughCameraPoseCv(
  cvProjection: CameraPoseCvProjection,
  frameSize: { width: number; height: number },
  intrinsics: CameraIntrinsicsAssumption,
  floorPoint2D: Vec2
): SolveResult<Vec2> {
  if (
    !isFiniteNumber(frameSize.width) ||
    !isFiniteNumber(frameSize.height) ||
    frameSize.width <= 0 ||
    frameSize.height <= 0
  ) {
    return { ok: false, reason: "CV projection failed: frame size must be positive finite values." };
  }
  const intrinsicsResult = buildCameraIntrinsicsFromFov(frameSize, intrinsics.verticalFovDeg);
  if (!intrinsicsResult.ok) {
    return { ok: false, reason: intrinsicsResult.reason };
  }
  const projected = projectFloorPointWithRtCv(
    cvProjection.rotationPlaneToCv,
    cvProjection.translationCv,
    intrinsicsResult.value,
    floorPoint2D
  );
  if (!projected.ok) return { ok: false, reason: projected.reason };
  return {
    ok: true,
    value: projected.value.pointPx,
    confidence: projected.confidence,
  };
}

/**
 * Projects a floor-plane 2D point through a camera pose into visible-frame pixel coordinates.
 * Conventions:
 * - floorPoint2D uses floor-plane {x, y} where y corresponds to world Z.
 * - pose uses world-space vectors with Y-up.
 * - image/frame pixels are y-down.
 * - projection uses a pinhole model from vertical FOV and frame size.
 * - this helper is for display-style projection from lookAt/up pose conventions.
 *   CV decomposition validation uses recovered R/t directly via projectFloorPointWithRtCv.
 */
export function projectFloorPointThroughPose(
  pose: CameraPose,
  frameSize: { width: number; height: number },
  intrinsics: CameraIntrinsicsAssumption,
  floorPoint2D: Vec2
): SolveResult<Vec2> {
  const intrinsicsResult = buildCameraIntrinsicsFromFov(frameSize, intrinsics.verticalFovDeg);
  if (!intrinsicsResult.ok) {
    return { ok: false, reason: intrinsicsResult.reason };
  }
  return projectFloorPointThroughPoseWithCameraIntrinsics(pose, intrinsicsResult.value, floorPoint2D);
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

/**
 * Decomposes an image->floor homography into an approximate camera pose in Three.js world convention.
 *
 * Inputs:
 * - imageToFloorHomography maps image/frame pixels -> floor-plane 2D coordinates (X/Z plane units).
 * - frameSize is the visible render frame in pixels (same space used to solve homography).
 * - intrinsics.verticalFovDeg defines the pinhole camera intrinsics approximation.
 *
 * Internally this function inverts image->floor H to floor->image H, then applies planar decomposition.
 * The plane basis is {axis0=world +X, axis1=world +Z, normal=world +Y}.
 */
export function decomposeHomographyToCameraPose(
  imageToFloorHomography: HomographyMatrix,
  frameSize: { width: number; height: number },
  intrinsics: CameraIntrinsicsAssumption,
  correspondences?: {
    floorPlanePoints2D: Vec2[];
    imagePointsPx: Vec2[];
  }
): SolveResult<CameraPoseDecomposition> {
  const intrinsicsResult = buildCameraIntrinsicsFromFov(frameSize, intrinsics.verticalFovDeg);
  if (!intrinsicsResult.ok) {
    return { ok: false, reason: intrinsicsResult.reason };
  }
  const cameraIntrinsics = intrinsicsResult.value;
  const kInverse = intrinsicsResult.value.inverse;

  const floorToImage = invertHomography(imageToFloorHomography);
  if (!floorToImage) {
    return { ok: false, reason: "Could not invert image->floor homography for pose decomposition." };
  }

  const m = matrixMultiply3x3(kInverse, sanitizeHomographyMatrix(floorToImage));
  const m1 = getColumn(m, 0);
  const m2 = getColumn(m, 1);
  const m3 = getColumn(m, 2);

  const m1Norm = vec3Length(m1);
  const m2Norm = vec3Length(m2);
  if (!isFiniteNumber(m1Norm) || !isFiniteNumber(m2Norm) || m1Norm < MIN_COLUMN_NORM || m2Norm < MIN_COLUMN_NORM) {
    return { ok: false, reason: "Homography decomposition failed: invalid normalized column magnitudes." };
  }

  const columnScaleRatio = Math.max(m1Norm / m2Norm, m2Norm / m1Norm);
  if (!isFiniteNumber(columnScaleRatio) || columnScaleRatio > MAX_COLUMN_SCALE_RATIO_HARD) {
    return { ok: false, reason: "Homography decomposition failed: severe column scale mismatch." };
  }

  const lambdaMagnitude = 2 / (m1Norm + m2Norm);
  if (!isFiniteNumber(lambdaMagnitude) || lambdaMagnitude <= EPSILON) {
    return { ok: false, reason: "Homography decomposition failed: invalid lambda scale." };
  }

  const hasValidationCorrespondences =
    !!correspondences &&
    Array.isArray(correspondences.floorPlanePoints2D) &&
    Array.isArray(correspondences.imagePointsPx) &&
    correspondences.floorPlanePoints2D.length >= 4 &&
    correspondences.floorPlanePoints2D.length === correspondences.imagePointsPx.length &&
    correspondences.floorPlanePoints2D.every(isValidVec2) &&
    correspondences.imagePointsPx.every(isValidVec2);
  const floorValidationPoints = hasValidationCorrespondences ? correspondences.floorPlanePoints2D : null;
  const imageValidationPoints = hasValidationCorrespondences ? correspondences.imagePointsPx : null;

  type Candidate = {
    pose: CameraPose;
    diagnostics: CameraPoseDiagnostics;
    cvProjection: CameraPoseCvProjection;
    averageReprojectionErrorPx: number | null;
    maxReprojectionErrorPx: number | null;
    perCornerCvReprojectionPx: number[] | null;
    summary: string;
  };

  const candidateFailures: string[] = [];
  const candidateSummaries: string[] = [];
  const candidates: Candidate[] = [];
  let candidatesPassingCheirality = 0;
  // Homography decomposition has a scale-sign ambiguity: ±lambda produce mathematically valid
  // candidates. Evaluate both and choose by cheirality + reprojection error.
  for (const scaleSign of [1, -1] as const) {
    const signedLambda = lambdaMagnitude * scaleSign;
    const r1Raw = scaleVec3(m1, signedLambda);
    const r2Raw = scaleVec3(m2, signedLambda);
    const t = scaleVec3(m3, signedLambda);

    const u1 = normalizeVec3(r1Raw);
    if (!u1) {
      candidateFailures.push(`scale ${scaleSign}: first rotation axis is degenerate`);
      continue;
    }
    const r2Ortho = subtractVec3(r2Raw, scaleVec3(u1, dotVec3(r2Raw, u1)));
    const u2 = normalizeVec3(r2Ortho);
    if (!u2) {
      candidateFailures.push(`scale ${scaleSign}: second rotation axis is degenerate`);
      continue;
    }

    const rawCross = crossVec3(r1Raw, r2Raw);
    const u3Unaligned = crossVec3(u1, u2);
    const u3Aligned = dotVec3(u3Unaligned, rawCross) < 0 ? scaleVec3(u3Unaligned, -1) : u3Unaligned;
    const u3 = normalizeVec3(u3Aligned);
    if (!u3) {
      candidateFailures.push(`scale ${scaleSign}: third rotation axis is degenerate`);
      continue;
    }

    const rotationPlaneBasis = matrixFromColumns(u1, u2, u3);
    const determinant = determinant3x3(rotationPlaneBasis);
    if (!isFiniteNumber(determinant) || determinant <= EPSILON) {
      candidateFailures.push(`scale ${scaleSign}: non right-handed rotation basis`);
      continue;
    }

    const orthoError = orthonormalityError([u1, u2, u3]);
    if (!isFiniteNumber(orthoError) || orthoError > MAX_ORTHONORMALITY_ERROR_HARD) {
      candidateFailures.push(`scale ${scaleSign}: orthonormality error too high`);
      continue;
    }

    const rotationTranspose = matrixTranspose3x3(rotationPlaneBasis);
    const cameraCenterPlaneBasis = scaleVec3(multiplyMatrixVec3(rotationTranspose, t), -1);
    if (![cameraCenterPlaneBasis.x, cameraCenterPlaneBasis.y, cameraCenterPlaneBasis.z].every(isFiniteNumber)) {
      candidateFailures.push(`scale ${scaleSign}: non-finite camera center`);
      continue;
    }

    // Deterministic world lift for floor-plane basis:
    // plane x -> world X, plane y -> world Z, plane normal -> -world Y.
    const cameraPositionWorld: Vec3 = {
      x: cameraCenterPlaneBasis.x,
      y: -cameraCenterPlaneBasis.z,
      z: cameraCenterPlaneBasis.y,
    };
    if (![cameraPositionWorld.x, cameraPositionWorld.y, cameraPositionWorld.z].every(isFiniteNumber)) {
      candidateFailures.push(`scale ${scaleSign}: non-finite world camera position`);
      continue;
    }

    const cvToPlane = matrixTranspose3x3(rotationPlaneBasis);
    const cvYAxisWorld = mapPlaneDirectionToWorld(getColumn(cvToPlane, 1));
    const cvZAxisWorld = mapPlaneDirectionToWorld(getColumn(cvToPlane, 2));
    const glZAxisWorld = normalizeVec3(scaleVec3(cvZAxisWorld, -1));
    const glUpWorld = normalizeVec3(scaleVec3(cvYAxisWorld, -1));
    const glForwardWorld = glZAxisWorld ? scaleVec3(glZAxisWorld, -1) : null;
    if (!glZAxisWorld || !glUpWorld || !glForwardWorld) {
      candidateFailures.push(`scale ${scaleSign}: could not derive display orientation from recovered basis`);
      continue;
    }

    const pose: CameraPose = {
      position: cameraPositionWorld,
      lookAt: addVec3(cameraPositionWorld, glForwardWorld),
      up: glUpWorld,
    };

    let minDepthZ = Number.POSITIVE_INFINITY;
    let maxDepthZ = Number.NEGATIVE_INFINITY;
    let averageReprojectionErrorPx: number | null = null;
    let maxReprojectionErrorPx: number | null = null;
    let perCornerCvReprojectionPx: number[] | null = null;

    if (hasValidationCorrespondences && floorValidationPoints && imageValidationPoints) {
      let totalReprojectionErrorPx = 0;
      let maxErrorPx = 0;
      let cheiralityValid = true;
      perCornerCvReprojectionPx = [];
      for (let i = 0; i < floorValidationPoints.length; i += 1) {
        const projected = projectFloorPointWithRtCv(rotationPlaneBasis, t, cameraIntrinsics, floorValidationPoints[i]);
        if (!projected.ok) {
          cheiralityValid = false;
          candidateFailures.push(`scale ${scaleSign}: ${projected.reason}`);
          break;
        }
        minDepthZ = Math.min(minDepthZ, projected.value.depthZ);
        maxDepthZ = Math.max(maxDepthZ, projected.value.depthZ);
        const error = distance2(projected.value.pointPx, imageValidationPoints[i]);
        perCornerCvReprojectionPx.push(error);
        totalReprojectionErrorPx += error;
        if (error > maxErrorPx) maxErrorPx = error;
      }
      if (!cheiralityValid) continue;

      candidatesPassingCheirality += 1;
      averageReprojectionErrorPx = totalReprojectionErrorPx / floorValidationPoints.length;
      maxReprojectionErrorPx = maxErrorPx;
      if (
        !isFiniteNumber(averageReprojectionErrorPx) ||
        !isFiniteNumber(maxReprojectionErrorPx) ||
        maxReprojectionErrorPx > MAX_CAMERA_POSE_REPROJECTION_HARD_PX
      ) {
        candidateFailures.push(
          `scale ${scaleSign}: reprojection error too high (avg=${averageReprojectionErrorPx.toFixed(
            2
          )}, max=${maxReprojectionErrorPx.toFixed(2)})`
        );
        continue;
      }
    } else {
      const originDepthZ = t.z;
      minDepthZ = originDepthZ;
      maxDepthZ = originDepthZ;
      if (!isFiniteNumber(originDepthZ) || originDepthZ <= EPSILON) {
        candidateFailures.push(
          `scale ${scaleSign}: origin depth is not positive (z=${
            isFiniteNumber(originDepthZ) ? originDepthZ.toFixed(4) : "non-finite"
          })`
        );
        continue;
      }
      candidatesPassingCheirality += 1;
    }

    const summary =
      `scale ${scaleSign}: pass stage=${hasValidationCorrespondences ? "cv-correspondences" : "origin-depth-fallback"} ` +
      `depthZ[min=${minDepthZ.toFixed(3)},max=${maxDepthZ.toFixed(3)}] ` +
      `reproj[avg=${
        averageReprojectionErrorPx === null ? "n/a" : averageReprojectionErrorPx.toFixed(2)
      },max=${maxReprojectionErrorPx === null ? "n/a" : maxReprojectionErrorPx.toFixed(2)}] ` +
      `cameraCenterPlane=(${cameraCenterPlaneBasis.x.toFixed(3)},${cameraCenterPlaneBasis.y.toFixed(
        3
      )},${cameraCenterPlaneBasis.z.toFixed(3)}) ` +
      `worldPos=(${cameraPositionWorld.x.toFixed(3)},${cameraPositionWorld.y.toFixed(3)},${cameraPositionWorld.z.toFixed(
        3
      )})`;
    candidateSummaries.push(summary);

    candidates.push({
      pose,
      diagnostics: {
        focalLengthPx: cameraIntrinsics.fy,
        lambda: signedLambda,
        selectedScaleSign: scaleSign,
        selectedNormalSign: -1,
        columnScaleRatio,
        determinant,
        orthonormalityError: orthoError,
        cameraHeight: cameraPositionWorld.y,
        cameraZ: cameraPositionWorld.z,
        averageCameraPoseReprojectionPx: averageReprojectionErrorPx ?? 0,
        maxCameraPoseReprojectionPx: maxReprojectionErrorPx ?? 0,
        ...(perCornerCvReprojectionPx !== null ? { perCornerCvReprojectionPx } : {}),
      },
      cvProjection: {
        rotationPlaneToCv: rotationPlaneBasis,
        translationCv: t,
      },
      averageReprojectionErrorPx,
      maxReprojectionErrorPx,
      perCornerCvReprojectionPx,
      summary,
    });
  }

  if (candidates.length === 0) {
    const failureText = candidateFailures.length > 0 ? candidateFailures.join(" | ") : "no candidate details";
    return {
      ok: false,
      reason: `Homography decomposition failed: no candidate passed cheirality/reprojection checks [${failureText}]`,
    };
  }

  const bestCandidate = candidates.reduce((best, current) => {
    const currentAvg = current.averageReprojectionErrorPx ?? Number.POSITIVE_INFINITY;
    const bestAvg = best.averageReprojectionErrorPx ?? Number.POSITIVE_INFINITY;
    if (currentAvg < bestAvg) {
      return current;
    }
    if (currentAvg > bestAvg) return best;
    const currentMax = current.maxReprojectionErrorPx ?? Number.POSITIVE_INFINITY;
    const bestMax = best.maxReprojectionErrorPx ?? Number.POSITIVE_INFINITY;
    if (
      currentAvg === bestAvg &&
      currentMax < bestMax
    ) {
      return current;
    }
    return best;
  });

  let confidence: "high" | "low" = "high";
  let note: string | undefined;
  if (
    bestCandidate.diagnostics.columnScaleRatio > MAX_COLUMN_SCALE_RATIO_LOW_CONFIDENCE ||
    bestCandidate.diagnostics.orthonormalityError > MAX_ORTHONORMALITY_ERROR_LOW_CONFIDENCE ||
    (hasValidationCorrespondences &&
      bestCandidate.maxReprojectionErrorPx !== null &&
      bestCandidate.maxReprojectionErrorPx > MAX_CAMERA_POSE_REPROJECTION_LOW_CONFIDENCE_PX)
  ) {
    confidence = "low";
    note =
      "Pose solved but is numerically weak (column-scale mismatch, orthonormality drift, or elevated reprojection error).";
    bestCandidate.diagnostics.reason = note;
  }
  if (!hasValidationCorrespondences) {
    confidence = "low";
    const fallbackNote =
      "Pose solved with origin-depth fallback only (no explicit correspondences); reprojection diagnostics are not available.";
    bestCandidate.diagnostics.reason = bestCandidate.diagnostics.reason
      ? `${bestCandidate.diagnostics.reason} ${fallbackNote}`
      : fallbackNote;
    note = note ? `${note} ${fallbackNote}` : fallbackNote;
  }
  if (bestCandidate.diagnostics.cameraHeight <= MIN_CAMERA_HEIGHT) {
    confidence = "low";
    const heightNote = "Derived world camera height is near/below floor after deterministic lift.";
    bestCandidate.diagnostics.reason = bestCandidate.diagnostics.reason
      ? `${bestCandidate.diagnostics.reason} ${heightNote}`
      : heightNote;
    note = note ? `${note} ${heightNote}` : heightNote;
  }
  bestCandidate.diagnostics.candidatesPassingCheirality = candidatesPassingCheirality;
  bestCandidate.diagnostics.bestCandidateSummary = bestCandidate.summary;
  bestCandidate.diagnostics.candidateSummaries = candidateSummaries;

  return {
    ok: true,
    value: {
      pose: bestCandidate.pose,
      diagnostics: bestCandidate.diagnostics,
      cvProjection: bestCandidate.cvProjection,
    },
    confidence,
    note,
  };
}

// --- Canonical FOV scan (shared, pure) ---------------------------------------
// The 3D Room Lab calibration path does NOT assume a single FOV: it scans a
// plausible vertical-FOV range and accepts calibration when ANY scanned FOV
// yields a valid camera-pose decomposition, selecting the best by
// (confidence high-first, then lowest average reprojection, then lowest max).
//
// This helper extracts that exact scan + selection so multiple call sites (the
// lab debug panel and the lab-only empty-room-assist validity gate) share ONE
// implementation rather than duplicating divergent camera/FOV math. It is pure
// and side-effect free.

export const DEFAULT_FOV_SCAN_MIN_DEG = 20;
export const DEFAULT_FOV_SCAN_MAX_DEG = 90;
export const DEFAULT_FOV_SCAN_STEP_DEG = 1;

export type FovScanOptions = {
  minFovDeg?: number;
  maxFovDeg?: number;
  stepDeg?: number;
};

export type FovScanSample = {
  fov: number;
  ok: boolean;
  confidence?: "high" | "low";
  avgPx?: number;
  maxPx?: number;
  scaleRatio?: number;
  reason?: string;
};

export type FovScanResult = {
  // True when at least one scanned FOV produced a valid decomposition.
  ok: boolean;
  samples: FovScanSample[];
  validCount: number;
  highConfidenceCount: number;
  // Best valid candidate (confidence high-first, then lowest avg/max reproj).
  bestFovDeg: number | null;
  bestConfidence: "high" | "low" | null;
  bestAvgPx: number | null;
  bestMaxPx: number | null;
  bestScaleRatio: number | null;
  bestPose: CameraPoseDecomposition | null;
  // Inclusive [min,max] FOV ranges (degrees) of valid / high-confidence samples.
  validFovRange: [number, number] | null;
  highConfidenceFovRange: [number, number] | null;
  // First failing sample reason (useful when no FOV is valid).
  firstFailureReason: string | null;
};

function rangeOf(values: number[]): [number, number] | null {
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

/**
 * Scans plausible vertical FOVs and decomposes the image->floor homography at
 * each, returning the best valid camera pose. Selection matches the lab
 * calibration path exactly: confidence high-first, then lowest average
 * reprojection, then lowest max reprojection.
 *
 * The gate is NOT relaxed: each FOV still runs the full
 * decomposeHomographyToCameraPose validity checks (cheirality, reprojection,
 * scale/orthonormality). A pass simply means at least one physically plausible
 * FOV in the scanned range yields a valid pose.
 */
export function scanCameraPoseOverFov(
  imageToFloorHomography: HomographyMatrix,
  frameSize: { width: number; height: number },
  correspondences: { floorPlanePoints2D: Vec2[]; imagePointsPx: Vec2[] },
  options?: FovScanOptions
): FovScanResult {
  const minFov = options?.minFovDeg ?? DEFAULT_FOV_SCAN_MIN_DEG;
  const maxFov = options?.maxFovDeg ?? DEFAULT_FOV_SCAN_MAX_DEG;
  const step = options?.stepDeg ?? DEFAULT_FOV_SCAN_STEP_DEG;

  const samples: FovScanSample[] = [];
  const poseByFov = new Map<number, CameraPoseDecomposition>();

  for (let fov = minFov; fov <= maxFov; fov += step) {
    const decomposition = decomposeHomographyToCameraPose(
      imageToFloorHomography,
      frameSize,
      { verticalFovDeg: fov },
      correspondences
    );
    if (!decomposition.ok) {
      samples.push({ fov, ok: false, reason: decomposition.reason });
      continue;
    }
    poseByFov.set(fov, decomposition.value);
    samples.push({
      fov,
      ok: true,
      confidence: decomposition.confidence,
      avgPx: decomposition.value.diagnostics.averageCameraPoseReprojectionPx,
      maxPx: decomposition.value.diagnostics.maxCameraPoseReprojectionPx,
      scaleRatio: decomposition.value.diagnostics.columnScaleRatio,
    });
  }

  const valid = samples.filter((s) => s.ok && s.avgPx !== undefined && s.maxPx !== undefined);
  const high = valid.filter((s) => s.confidence === "high");

  const sorted = [...valid].sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    if (a.avgPx! !== b.avgPx!) return a.avgPx! - b.avgPx!;
    return a.maxPx! - b.maxPx!;
  });
  const best = sorted[0] ?? null;
  const firstFailureReason = samples.find((s) => !s.ok)?.reason ?? null;

  return {
    ok: !!best,
    samples,
    validCount: valid.length,
    highConfidenceCount: high.length,
    bestFovDeg: best?.fov ?? null,
    bestConfidence: best?.confidence ?? null,
    bestAvgPx: best?.avgPx ?? null,
    bestMaxPx: best?.maxPx ?? null,
    bestScaleRatio: best?.scaleRatio ?? null,
    bestPose: best ? poseByFov.get(best.fov) ?? null : null,
    validFovRange: rangeOf(valid.map((s) => s.fov)),
    highConfidenceFovRange: rangeOf(high.map((s) => s.fov)),
    firstFailureReason,
  };
}
