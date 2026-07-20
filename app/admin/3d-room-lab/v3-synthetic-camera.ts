import {
  decomposeHomographyToCameraPose,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  solvePlaneHomography,
  type CameraPose,
  type CameraPoseDecomposition,
} from "./perspective-solve";

/**
 * Test-only reference pinhole convention.
 *
 * World coordinates are Y-up and the Floor is Y=0 using X/Z coordinates.
 * Camera rotation is world-to-camera with camera axes (+X right, +Y down,
 * +Z forward). Pixels are y-down:
 *   u = fx * Xc / Zc + cx, v = fy * Yc / Zc + cy.
 *
 * `rollDeg` is clockwise in y-down image coordinates: a positive roll puts
 * the upper endpoint of a world +Y segment to image-right of its lower end.
 * `tiltDeg` is positive when the camera looks upward. All vertical segments
 * extend along world +Y. Source-normalized points are derived only from
 * intrinsic-pixel projections.
 *
 * This module deliberately does not import or use the production v2 solver
 * while generating evidence. `runProductionV2FloorSolve` is the explicit,
 * separate hand-off from independently projected Floor pixels to v2 math.
 */

export type SyntheticVec2 = Readonly<{ x: number; y: number }>;
export type SyntheticVec3 = Readonly<{ x: number; y: number; z: number }>;
export type SyntheticMatrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type SyntheticIntrinsics = Readonly<{
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  verticalFovDeg: number;
}>;

export type SyntheticCamera = Readonly<{
  intrinsics: SyntheticIntrinsics;
  position: SyntheticVec3;
  /** Row-major rotation taking (world - position) into camera coordinates. */
  worldToCamera: SyntheticMatrix3;
  forwardWorld: SyntheticVec3;
  rightWorld: SyntheticVec3;
  downWorld: SyntheticVec3;
  rollDeg: number;
  tiltDeg: number;
}>;

export type ProjectedPoint = Readonly<
  | { ok: true; pixel: SyntheticVec2; cameraPoint: SyntheticVec3 }
  | { ok: false; reason: "non_finite" | "behind_camera" }
>;

export type SyntheticVerticalSegment = Readonly<{
  id: string;
  physicalVerticalId: "back_left" | "back_right" | "front_left" | "front_right";
  wallKind: "wall_back" | "wall_left" | "wall_right";
  lowerWorld: SyntheticVec3;
  heightMeters: number;
}>;

export type ProjectedVerticalSegment = Readonly<{
  id: string;
  physicalVerticalId: SyntheticVerticalSegment["physicalVerticalId"];
  wallKind: SyntheticVerticalSegment["wallKind"];
  lowerWorld: SyntheticVec3;
  lowerPixel: SyntheticVec2;
  upperPixel: SyntheticVec2;
  lowerSourceNormalized: SyntheticVec2;
  upperSourceNormalized: SyntheticVec2;
}>;

export type ProductionV2FloorSolve = Readonly<
  | { ok: true; decomposition: CameraPoseDecomposition }
  | { ok: false; reason: string }
>;

export type FloorReprojectionMetrics = Readonly<{
  averagePx: number;
  maximumPx: number;
  perCornerPx: readonly number[];
}>;

export type VerticalResidual = Readonly<{
  id: string;
  physicalVerticalId: SyntheticVerticalSegment["physicalVerticalId"];
  observedTiltDeg: number;
  predictedTiltDeg: number;
  residualDeg: number;
}>;

export type RecoveredCameraComparison = Readonly<{
  positionErrorMeters: number;
  forwardDirectionAngularErrorDeg: number;
  worldUpDirectionAngularErrorDeg: number;
  truthOpticalAxisRollDeg: number;
  recoveredOpticalAxisRollDeg: number;
  signedImageWorldUpDisagreementDeg: number;
  floor: FloorReprojectionMetrics;
  verticals: readonly VerticalResidual[];
  verticalResidualSummary: Readonly<{
    count: number;
    minimumDeg: number | null;
    maximumDeg: number | null;
    rangeDeg: number | null;
    averageDeg: number | null;
    averageAbsoluteDeg: number | null;
    weightedAverageDeg: number | null;
    weightedAverageAbsoluteDeg: number | null;
  }>;
}>;

const EPSILON = 1e-9;
const DEG_PER_RAD = 180 / Math.PI;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function subtract(a: SyntheticVec3, b: SyntheticVec3): SyntheticVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: SyntheticVec3, b: SyntheticVec3): SyntheticVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(value: SyntheticVec3, scalar: number): SyntheticVec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function dot(a: SyntheticVec3, b: SyntheticVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: SyntheticVec3, b: SyntheticVec3): SyntheticVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(value: SyntheticVec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: SyntheticVec3): SyntheticVec3 {
  const magnitude = length(value);
  if (!finite(magnitude) || magnitude <= EPSILON) throw new Error("Synthetic camera vector is degenerate.");
  return scale(value, 1 / magnitude);
}

function multiply(matrix: SyntheticMatrix3, vector: SyntheticVec3): SyntheticVec3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

function degrees(value: number): number {
  return value * DEG_PER_RAD;
}

function angleDeg(left: SyntheticVec3, right: SyntheticVec3): number {
  const denominator = length(left) * length(right);
  if (denominator <= EPSILON) return Number.NaN;
  return degrees(Math.acos(Math.max(-1, Math.min(1, dot(left, right) / denominator))));
}

function cameraDirectionFromPose(pose: CameraPose): SyntheticVec3 {
  return normalize({
    x: pose.lookAt.x - pose.position.x,
    y: pose.lookAt.y - pose.position.y,
    z: pose.lookAt.z - pose.position.z,
  });
}

function worldUpInCamera(camera: SyntheticCamera): SyntheticVec3 {
  return multiply(camera.worldToCamera, { x: 0, y: 1, z: 0 });
}

function worldUpInRecoveredCamera(decomposition: CameraPoseDecomposition): SyntheticVec3 {
  const rotation = decomposition.cvProjection.rotationPlaneToCv;
  // Production CV plane basis is [world +X, world +Z, plane normal=-world +Y].
  return { x: -rotation[2], y: -rotation[5], z: -rotation[8] };
}

function toSyntheticPose(pose: CameraPose, intrinsics: SyntheticIntrinsics): SyntheticCamera {
  const forward = cameraDirectionFromPose(pose);
  const right = normalize(cross(forward, pose.up));
  const up = normalize(cross(right, forward));
  const down = scale(up, -1);
  return {
    intrinsics,
    position: pose.position,
    worldToCamera: [
      right.x, right.y, right.z,
      down.x, down.y, down.z,
      forward.x, forward.y, forward.z,
    ],
    forwardWorld: forward,
    rightWorld: right,
    downWorld: down,
    rollDeg: 0,
    tiltDeg: 0,
  };
}

export function buildSyntheticIntrinsicsFromFov(
  size: Readonly<{ width: number; height: number }>,
  verticalFovDeg: number,
  principalPoint?: Readonly<{ cx: number; cy: number }>
): SyntheticIntrinsics {
  if (![size.width, size.height, verticalFovDeg].every(finite) || size.width <= 0 || size.height <= 0 || verticalFovDeg <= 0 || verticalFovDeg >= 180) {
    throw new Error("Synthetic intrinsics require positive finite dimensions and a FOV between 0 and 180 degrees.");
  }
  const fy = size.height / (2 * Math.tan((verticalFovDeg * Math.PI) / 360));
  const fx = fy;
  return {
    width: size.width,
    height: size.height,
    fx,
    fy,
    cx: principalPoint?.cx ?? size.width / 2,
    cy: principalPoint?.cy ?? size.height / 2,
    verticalFovDeg,
  };
}

export function buildSyntheticIntrinsicsFromFocal(
  size: Readonly<{ width: number; height: number }>,
  focal: Readonly<{ fx: number; fy: number }>,
  principalPoint?: Readonly<{ cx: number; cy: number }>
): SyntheticIntrinsics {
  if (![size.width, size.height, focal.fx, focal.fy].every(finite) || size.width <= 0 || size.height <= 0 || focal.fx <= 0 || focal.fy <= 0) {
    throw new Error("Synthetic intrinsics require positive finite dimensions and focal lengths.");
  }
  return {
    width: size.width,
    height: size.height,
    fx: focal.fx,
    fy: focal.fy,
    cx: principalPoint?.cx ?? size.width / 2,
    cy: principalPoint?.cy ?? size.height / 2,
    verticalFovDeg: degrees(2 * Math.atan(size.height / (2 * focal.fy))),
  };
}

export function createSyntheticCamera(input: Readonly<{
  intrinsics: SyntheticIntrinsics;
  position: SyntheticVec3;
  lookAt: SyntheticVec3;
  rollDeg?: number;
}>): SyntheticCamera {
  const forward = normalize(subtract(input.lookAt, input.position));
  const baseRight = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const baseDown = normalize(cross(forward, baseRight));
  const rollRad = ((input.rollDeg ?? 0) * Math.PI) / 180;
  // Positive roll moves the upper end of a +Y world segment to image-right.
  const right = normalize(add(scale(baseRight, Math.cos(rollRad)), scale(baseDown, -Math.sin(rollRad))));
  const down = normalize(add(scale(baseRight, Math.sin(rollRad)), scale(baseDown, Math.cos(rollRad))));
  return {
    intrinsics: input.intrinsics,
    position: { ...input.position },
    worldToCamera: [
      right.x, right.y, right.z,
      down.x, down.y, down.z,
      forward.x, forward.y, forward.z,
    ],
    forwardWorld: forward,
    rightWorld: right,
    downWorld: down,
    rollDeg: input.rollDeg ?? 0,
    tiltDeg: degrees(Math.asin(forward.y)),
  };
}

export function projectSyntheticWorldPoint(camera: SyntheticCamera, point: SyntheticVec3): ProjectedPoint {
  if (![point.x, point.y, point.z].every(finite)) return { ok: false, reason: "non_finite" };
  const cameraPoint = multiply(camera.worldToCamera, subtract(point, camera.position));
  if (![cameraPoint.x, cameraPoint.y, cameraPoint.z].every(finite)) return { ok: false, reason: "non_finite" };
  if (cameraPoint.z <= EPSILON) return { ok: false, reason: "behind_camera" };
  return {
    ok: true,
    cameraPoint,
    pixel: {
      x: camera.intrinsics.fx * cameraPoint.x / cameraPoint.z + camera.intrinsics.cx,
      y: camera.intrinsics.fy * cameraPoint.y / cameraPoint.z + camera.intrinsics.cy,
    },
  };
}

export function intrinsicPixelsToSourceNormalized(
  pixels: SyntheticVec2,
  intrinsics: SyntheticIntrinsics
): SyntheticVec2 {
  return { x: pixels.x / intrinsics.width, y: pixels.y / intrinsics.height };
}

/**
 * Independent metric Floor geometry for reference evidence generation.
 * Its order is near-left, near-right, far-right, far-left in world X/Z.
 */
export function buildSyntheticFloorWorldCorners(
  dimensions: Readonly<{ widthMeters: number; depthMeters: number }>
): readonly SyntheticVec3[] {
  if (![dimensions.widthMeters, dimensions.depthMeters].every(finite) || dimensions.widthMeters <= 0 || dimensions.depthMeters <= 0) {
    throw new Error("Synthetic Floor dimensions must be positive finite values.");
  }
  const halfWidth = dimensions.widthMeters / 2;
  const halfDepth = dimensions.depthMeters / 2;
  return [
    { x: -halfWidth, y: 0, z: halfDepth },
    { x: halfWidth, y: 0, z: halfDepth },
    { x: halfWidth, y: 0, z: -halfDepth },
    { x: -halfWidth, y: 0, z: -halfDepth },
  ];
}

export function projectSyntheticFloorRectangle(
  camera: SyntheticCamera,
  dimensions: Readonly<{ widthMeters: number; depthMeters: number }>
): readonly SyntheticVec2[] {
  return buildSyntheticFloorWorldCorners(dimensions).map((corner) => {
    const projected = projectSyntheticWorldPoint(camera, corner);
    if (!projected.ok) throw new Error(`Synthetic Floor corner projection failed: ${projected.reason}`);
    return projected.pixel;
  });
}

export function projectSyntheticVerticalSegment(
  camera: SyntheticCamera,
  segment: SyntheticVerticalSegment
): ProjectedVerticalSegment {
  const lower = projectSyntheticWorldPoint(camera, segment.lowerWorld);
  const upper = projectSyntheticWorldPoint(camera, {
    x: segment.lowerWorld.x,
    y: segment.lowerWorld.y + segment.heightMeters,
    z: segment.lowerWorld.z,
  });
  if (!lower.ok || !upper.ok) throw new Error(`Synthetic vertical ${segment.id} projection failed.`);
  return {
    id: segment.id,
    physicalVerticalId: segment.physicalVerticalId,
    wallKind: segment.wallKind,
    lowerWorld: segment.lowerWorld,
    lowerPixel: lower.pixel,
    upperPixel: upper.pixel,
    lowerSourceNormalized: intrinsicPixelsToSourceNormalized(lower.pixel, camera.intrinsics),
    upperSourceNormalized: intrinsicPixelsToSourceNormalized(upper.pixel, camera.intrinsics),
  };
}

export function applySyntheticPixelPerturbation(
  point: SyntheticVec2,
  perturbation: Readonly<{ x: number; y: number }>
): SyntheticVec2 {
  return { x: point.x + perturbation.x, y: point.y + perturbation.y };
}

export function signedImageVerticalTiltDeg(lower: SyntheticVec2, upper: SyntheticVec2): number {
  return degrees(Math.atan2(upper.x - lower.x, lower.y - upper.y));
}

export function runProductionV2FloorSolve(input: Readonly<{
  floorPixels: readonly SyntheticVec2[];
  dimensions: Readonly<{ widthMeters: number; depthMeters: number }>;
  intrinsics: SyntheticIntrinsics;
}>): ProductionV2FloorSolve {
  if (input.floorPixels.length !== 4) return { ok: false, reason: "Synthetic Floor needs four pixels." };
  const rect = getFloorRectCorners(input.dimensions);
  if (!rect.ok) return { ok: false, reason: rect.reason };
  const floorPlanePoints = rect.value.asArray.map(floorVec3ToPlane2D);
  const homography = solvePlaneHomography([...input.floorPixels], floorPlanePoints);
  if (!homography.ok) return { ok: false, reason: homography.reason };
  const decomposition = decomposeHomographyToCameraPose(
    homography.value,
    { width: input.intrinsics.width, height: input.intrinsics.height },
    { verticalFovDeg: input.intrinsics.verticalFovDeg },
    { floorPlanePoints2D: floorPlanePoints, imagePointsPx: [...input.floorPixels] }
  );
  return decomposition.ok ? { ok: true, decomposition: decomposition.value } : { ok: false, reason: decomposition.reason };
}

export function compareRecoveredV2Camera(input: Readonly<{
  truth: SyntheticCamera;
  recovered: CameraPoseDecomposition;
  floorPixels: readonly SyntheticVec2[];
  floorDimensions: Readonly<{ widthMeters: number; depthMeters: number }>;
  verticals: readonly ProjectedVerticalSegment[];
}>): RecoveredCameraComparison {
  const recoveredCamera = toSyntheticPose(input.recovered.pose, input.truth.intrinsics);
  const positionErrorMeters = length(subtract(input.recovered.pose.position, input.truth.position));
  const forwardDirectionAngularErrorDeg = angleDeg(input.truth.forwardWorld, cameraDirectionFromPose(input.recovered.pose));
  const worldUpDirectionAngularErrorDeg = angleDeg(worldUpInCamera(input.truth), worldUpInRecoveredCamera(input.recovered));
  const perCornerPx = buildSyntheticFloorWorldCorners(input.floorDimensions).map((corner, index) => {
    const projected = projectSyntheticWorldPoint(recoveredCamera, corner);
    if (!projected.ok) return Number.POSITIVE_INFINITY;
    return Math.hypot(projected.pixel.x - input.floorPixels[index].x, projected.pixel.y - input.floorPixels[index].y);
  });
  const verticals = input.verticals.map((vertical) => {
    const recoveredProjection = projectSyntheticVerticalSegment(recoveredCamera, {
      id: vertical.id,
      physicalVerticalId: vertical.physicalVerticalId,
      wallKind: vertical.wallKind,
      lowerWorld: vertical.lowerWorld,
      heightMeters: 1,
    });
    const observedTiltDeg = signedImageVerticalTiltDeg(vertical.lowerPixel, vertical.upperPixel);
    const predictedTiltDeg = signedImageVerticalTiltDeg(recoveredProjection.lowerPixel, recoveredProjection.upperPixel);
    return {
      id: vertical.id,
      physicalVerticalId: vertical.physicalVerticalId,
      observedTiltDeg,
      predictedTiltDeg,
      residualDeg: predictedTiltDeg - observedTiltDeg,
    };
  });
  const residuals = verticals.map((vertical) => vertical.residualDeg);
  const weights = input.verticals.map((vertical) =>
    Math.hypot(vertical.upperPixel.x - vertical.lowerPixel.x, vertical.upperPixel.y - vertical.lowerPixel.y)
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const truthRoll = opticalAxisWorldUpTiltDeg(input.truth);
  const recoveredRoll = opticalAxisWorldUpTiltDeg(recoveredCamera);
  return {
    positionErrorMeters,
    forwardDirectionAngularErrorDeg,
    worldUpDirectionAngularErrorDeg,
    truthOpticalAxisRollDeg: truthRoll,
    recoveredOpticalAxisRollDeg: recoveredRoll,
    signedImageWorldUpDisagreementDeg: recoveredRoll - truthRoll,
    floor: {
      averagePx: perCornerPx.reduce((sum, value) => sum + value, 0) / perCornerPx.length,
      maximumPx: Math.max(...perCornerPx),
      perCornerPx,
    },
    verticals,
    verticalResidualSummary: {
      count: residuals.length,
      minimumDeg: residuals.length ? Math.min(...residuals) : null,
      maximumDeg: residuals.length ? Math.max(...residuals) : null,
      rangeDeg: residuals.length ? Math.max(...residuals) - Math.min(...residuals) : null,
      averageDeg: residuals.length ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length : null,
      averageAbsoluteDeg: residuals.length ? residuals.reduce((sum, value) => sum + Math.abs(value), 0) / residuals.length : null,
      weightedAverageDeg: totalWeight > 0
        ? residuals.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight
        : null,
      weightedAverageAbsoluteDeg: totalWeight > 0
        ? residuals.reduce((sum, value, index) => sum + Math.abs(value) * weights[index], 0) / totalWeight
        : null,
    },
  };
}

export function opticalAxisWorldUpTiltDeg(camera: SyntheticCamera): number {
  const lower = add(camera.position, scale(camera.forwardWorld, 5));
  const upper = add(lower, { x: 0, y: 1, z: 0 });
  const lowerProjection = projectSyntheticWorldPoint(camera, lower);
  const upperProjection = projectSyntheticWorldPoint(camera, upper);
  if (!lowerProjection.ok || !upperProjection.ok) throw new Error("Synthetic optical-axis vertical projection failed.");
  return signedImageVerticalTiltDeg(lowerProjection.pixel, upperProjection.pixel);
}
