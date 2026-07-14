export type FloorProjectionCornerKind = "far_left" | "far_right" | "near_right" | "near_left";

export type FloorProjectionAgreementEdgeKind = "far" | "near" | "left" | "right";

export type FloorProjectionVec2 = Readonly<{ x: number; y: number }>;

export type FloorProjectionVec3 = Readonly<{ x: number; y: number; z: number }>;

export type FloorProjectionAgreementCornerInput = Readonly<{
  sourceNormalized: FloorProjectionVec2;
  containerNormalized: FloorProjectionVec2;
  reviewedDisplayPx: FloorProjectionVec2;
  world: FloorProjectionVec3;
  projectedNormalized: FloorProjectionVec2;
  projectedDisplayPx: FloorProjectionVec2;
}>;

export type FloorProjectionAgreementInput = Readonly<{
  frameWidthPx: number;
  frameHeightPx: number;
  corners: Readonly<Partial<Record<FloorProjectionCornerKind, FloorProjectionAgreementCornerInput>>>;
}>;

export type FloorProjectionCornerAgreement = Readonly<{
  corner: FloorProjectionCornerKind;
  sourceNormalized: FloorProjectionVec2;
  containerNormalized: FloorProjectionVec2;
  reviewedDisplayPx: FloorProjectionVec2;
  world: FloorProjectionVec3;
  projectedNormalized: FloorProjectionVec2;
  projectedDisplayPx: FloorProjectionVec2;
  deltaXPx: number;
  deltaYPx: number;
  distancePx: number;
}>;

export type FloorProjectionEdgeAgreement = Readonly<{
  edge: FloorProjectionAgreementEdgeKind;
  reviewedLengthPx: number;
  projectedLengthPx: number;
  signedLengthDifferencePx: number;
  endpointMaxDistancePx: number;
  endpointRmsDistancePx: number;
}>;

export type FloorProjectionAgreementObservation =
  | "near_and_far_similar"
  | "far_exceeds_near"
  | "near_exceeds_far"
  | "unavailable";

export type FloorProjectionAgreementResult = Readonly<{
  available: boolean;
  unavailableReasons: readonly string[];
  frameWidthPx: number;
  frameHeightPx: number;
  corners: readonly FloorProjectionCornerAgreement[];
  edges: readonly FloorProjectionEdgeAgreement[];
  maximumDistancePx: number;
  rmsDistancePx: number;
  averageDeltaXPx: number;
  averageDeltaYPx: number;
  reviewedCentroidPx: FloorProjectionVec2;
  projectedCentroidPx: FloorProjectionVec2;
  centroidDeltaXPx: number;
  centroidDeltaYPx: number;
  centroidDistancePx: number;
  nearEdgeRmsDistancePx: number;
  farEdgeRmsDistancePx: number;
  farMinusNearRmsPx: number;
  observation: FloorProjectionAgreementObservation;
}>;

export type OrderedReviewedFloorCorners<T> = Readonly<{
  nearLeft: T;
  nearRight: T;
  farRight: T;
  farLeft: T;
}>;

export const FLOOR_PROJECTION_CORNER_ORDER = Object.freeze([
  "far_left",
  "far_right",
  "near_right",
  "near_left",
] as const);

export const FLOOR_PROJECTION_AGREEMENT_OBSERVATION_EPSILON_PX = 1e-6;

const EDGE_ENDPOINTS: Readonly<Record<FloorProjectionAgreementEdgeKind, readonly [FloorProjectionCornerKind, FloorProjectionCornerKind]>> =
  Object.freeze({
    far: ["far_left", "far_right"],
    near: ["near_right", "near_left"],
    left: ["far_left", "near_left"],
    right: ["far_right", "near_right"],
  });

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteVec2(point: FloorProjectionVec2 | null | undefined): point is FloorProjectionVec2 {
  return !!point && finite(point.x) && finite(point.y);
}

function finiteVec3(point: FloorProjectionVec3 | null | undefined): point is FloorProjectionVec3 {
  return !!point && finite(point.x) && finite(point.y) && finite(point.z);
}

function freezeVec2(point: FloorProjectionVec2): FloorProjectionVec2 {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeVec3(point: FloorProjectionVec3): FloorProjectionVec3 {
  return Object.freeze({ x: point.x, y: point.y, z: point.z });
}

function distance(a: FloorProjectionVec2, b: FloorProjectionVec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rms(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function centroid(points: readonly FloorProjectionVec2[]): FloorProjectionVec2 {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function unavailable(
  reasons: readonly string[],
  frameWidthPx = 0,
  frameHeightPx = 0
): FloorProjectionAgreementResult {
  return Object.freeze({
    available: false,
    unavailableReasons: Object.freeze([...new Set(reasons)]),
    frameWidthPx: finite(frameWidthPx) ? frameWidthPx : 0,
    frameHeightPx: finite(frameHeightPx) ? frameHeightPx : 0,
    corners: Object.freeze([]),
    edges: Object.freeze([]),
    maximumDistancePx: 0,
    rmsDistancePx: 0,
    averageDeltaXPx: 0,
    averageDeltaYPx: 0,
    reviewedCentroidPx: freezeVec2({ x: 0, y: 0 }),
    projectedCentroidPx: freezeVec2({ x: 0, y: 0 }),
    centroidDeltaXPx: 0,
    centroidDeltaYPx: 0,
    centroidDistancePx: 0,
    nearEdgeRmsDistancePx: 0,
    farEdgeRmsDistancePx: 0,
    farMinusNearRmsPx: 0,
    observation: "unavailable",
  });
}

/**
 * Maps the solver's reviewed ordering (near-left, near-right, far-right,
 * far-left) to the fixed diagnostic ordering.
 */
export function mapReviewedFloorCornersToAgreementOrder<T>(
  corners: OrderedReviewedFloorCorners<T>
): Readonly<Record<FloorProjectionCornerKind, T>> {
  return Object.freeze({
    far_left: corners.farLeft,
    far_right: corners.farRight,
    near_right: corners.nearRight,
    near_left: corners.nearLeft,
  });
}

/**
 * The floor attachment frame boundary is constructed in this order:
 * far-left, far-right, near-right, near-left.
 */
export function mapFloorAttachmentBoundaryToAgreementOrder<T>(
  boundary: readonly T[]
): Readonly<Record<FloorProjectionCornerKind, T>> | null {
  if (boundary.length < FLOOR_PROJECTION_CORNER_ORDER.length) return null;
  return Object.freeze({
    far_left: boundary[0],
    far_right: boundary[1],
    near_right: boundary[2],
    near_left: boundary[3],
  });
}

export function createUnavailableFloorProjectionAgreement(
  reasons: readonly string[],
  frameSize?: Readonly<{ width: number; height: number }> | null
): FloorProjectionAgreementResult {
  return unavailable(reasons, frameSize?.width ?? 0, frameSize?.height ?? 0);
}

/**
 * Calculates observational agreement between reviewed Floor display points and
 * calibrated-camera projected world-Floor points. Signed deltas are projected
 * display pixels minus reviewed display pixels.
 */
export function calculateFloorProjectionAgreement(
  input: FloorProjectionAgreementInput
): FloorProjectionAgreementResult {
  const reasons: string[] = [];
  if (!finite(input.frameWidthPx) || input.frameWidthPx <= 0) reasons.push("invalid_frame_width_px");
  if (!finite(input.frameHeightPx) || input.frameHeightPx <= 0) reasons.push("invalid_frame_height_px");

  for (const corner of FLOOR_PROJECTION_CORNER_ORDER) {
    const value = input.corners[corner];
    if (!value) {
      reasons.push(`missing_corner:${corner}`);
      continue;
    }
    if (!finiteVec2(value.sourceNormalized)) reasons.push(`non_finite_source_normalized:${corner}`);
    if (!finiteVec2(value.containerNormalized)) reasons.push(`non_finite_container_normalized:${corner}`);
    if (!finiteVec2(value.reviewedDisplayPx)) reasons.push(`non_finite_reviewed_display_px:${corner}`);
    if (!finiteVec3(value.world)) reasons.push(`non_finite_world_point:${corner}`);
    if (!finiteVec2(value.projectedNormalized)) reasons.push(`non_finite_projected_normalized:${corner}`);
    if (!finiteVec2(value.projectedDisplayPx)) reasons.push(`non_finite_projected_display_px:${corner}`);
  }
  if (reasons.length > 0) return unavailable(reasons, input.frameWidthPx, input.frameHeightPx);

  const corners = FLOOR_PROJECTION_CORNER_ORDER.map((corner) => {
    const value = input.corners[corner]!;
    const deltaXPx = value.projectedDisplayPx.x - value.reviewedDisplayPx.x;
    const deltaYPx = value.projectedDisplayPx.y - value.reviewedDisplayPx.y;
    return Object.freeze({
      corner,
      sourceNormalized: freezeVec2(value.sourceNormalized),
      containerNormalized: freezeVec2(value.containerNormalized),
      reviewedDisplayPx: freezeVec2(value.reviewedDisplayPx),
      world: freezeVec3(value.world),
      projectedNormalized: freezeVec2(value.projectedNormalized),
      projectedDisplayPx: freezeVec2(value.projectedDisplayPx),
      deltaXPx,
      deltaYPx,
      distancePx: Math.hypot(deltaXPx, deltaYPx),
    });
  });
  const byCorner = Object.fromEntries(corners.map((corner) => [corner.corner, corner])) as Record<
    FloorProjectionCornerKind,
    FloorProjectionCornerAgreement
  >;
  const edges = (Object.keys(EDGE_ENDPOINTS) as FloorProjectionAgreementEdgeKind[]).map((edge) => {
    const [first, second] = EDGE_ENDPOINTS[edge];
    const firstCorner = byCorner[first];
    const secondCorner = byCorner[second];
    const reviewedLengthPx = distance(firstCorner.reviewedDisplayPx, secondCorner.reviewedDisplayPx);
    const projectedLengthPx = distance(firstCorner.projectedDisplayPx, secondCorner.projectedDisplayPx);
    return Object.freeze({
      edge,
      reviewedLengthPx,
      projectedLengthPx,
      signedLengthDifferencePx: projectedLengthPx - reviewedLengthPx,
      endpointMaxDistancePx: Math.max(firstCorner.distancePx, secondCorner.distancePx),
      endpointRmsDistancePx: rms([firstCorner.distancePx, secondCorner.distancePx]),
    });
  });
  const edgeByKind = Object.fromEntries(edges.map((edge) => [edge.edge, edge])) as Record<
    FloorProjectionAgreementEdgeKind,
    FloorProjectionEdgeAgreement
  >;
  const reviewedCentroidPx = centroid(corners.map((corner) => corner.reviewedDisplayPx));
  const projectedCentroidPx = centroid(corners.map((corner) => corner.projectedDisplayPx));
  const centroidDeltaXPx = projectedCentroidPx.x - reviewedCentroidPx.x;
  const centroidDeltaYPx = projectedCentroidPx.y - reviewedCentroidPx.y;
  const nearEdgeRmsDistancePx = edgeByKind.near.endpointRmsDistancePx;
  const farEdgeRmsDistancePx = edgeByKind.far.endpointRmsDistancePx;
  const farMinusNearRmsPx = farEdgeRmsDistancePx - nearEdgeRmsDistancePx;
  const observation: FloorProjectionAgreementObservation =
    farMinusNearRmsPx > FLOOR_PROJECTION_AGREEMENT_OBSERVATION_EPSILON_PX
      ? "far_exceeds_near"
      : farMinusNearRmsPx < -FLOOR_PROJECTION_AGREEMENT_OBSERVATION_EPSILON_PX
        ? "near_exceeds_far"
        : "near_and_far_similar";

  return Object.freeze({
    available: true,
    unavailableReasons: Object.freeze([]),
    frameWidthPx: input.frameWidthPx,
    frameHeightPx: input.frameHeightPx,
    corners: Object.freeze(corners),
    edges: Object.freeze(edges),
    maximumDistancePx: Math.max(...corners.map((corner) => corner.distancePx)),
    rmsDistancePx: rms(corners.map((corner) => corner.distancePx)),
    averageDeltaXPx: corners.reduce((sum, corner) => sum + corner.deltaXPx, 0) / corners.length,
    averageDeltaYPx: corners.reduce((sum, corner) => sum + corner.deltaYPx, 0) / corners.length,
    reviewedCentroidPx: freezeVec2(reviewedCentroidPx),
    projectedCentroidPx: freezeVec2(projectedCentroidPx),
    centroidDeltaXPx,
    centroidDeltaYPx,
    centroidDistancePx: Math.hypot(centroidDeltaXPx, centroidDeltaYPx),
    nearEdgeRmsDistancePx,
    farEdgeRmsDistancePx,
    farMinusNearRmsPx,
    observation,
  });
}
