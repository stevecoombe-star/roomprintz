import type {
  RoomEnvelopeAnchorChoice,
  RoomEnvelopeBlocker,
  RoomEnvelopeCandidateFaces,
  RoomEnvelopeCeilingGeometry,
  RoomEnvelopeConditioning,
  RoomEnvelopeCornerClosureResidual,
  RoomEnvelopeDerivationStatus,
  RoomEnvelopeDimensions,
  RoomEnvelopeFace,
  RoomEnvelopeFaceId,
  RoomEnvelopeFrame,
  RoomEnvelopeGeometryInput,
  RoomEnvelopeNumericPolicy,
  RoomEnvelopeReconciliationResult,
  RoomEnvelopeResolvedAnchor,
  RoomEnvelopeResiduals,
  RoomEnvelopeSupportKind,
  RoomEnvelopeWallGeometry,
  RoomEnvelopeWallKind,
} from "./room-envelope-types";
import { ROOM_ENVELOPE_FACE_ORDER, ROOM_ENVELOPE_SUPPORT_ORDER } from "./room-envelope-types";
import type { SupportVec3 } from "./support-plane-math";

export const ROOM_ENVELOPE_NUMERIC_POLICY: RoomEnvelopeNumericPolicy = {
  angularToleranceDegrees: 2,
  worldDistanceTolerance: 0.05,
  minimumUsableDimension: 0.05,
  maximumBoundedDimension: 50,
  normalizationEpsilon: 1e-9,
  lineConditioningThreshold: 1e-6,
};

export const ROOM_ENVELOPE_BLOCKER_ORDER: readonly RoomEnvelopeBlocker[] = [
  "non_finite_input",
  "floor_missing",
  "explicit_anchor_missing",
  "explicit_anchor_excluded",
  "canonical_frame_unavailable",
  "degenerate_normal",
  "degenerate_wall_seam",
  "wall_not_vertical",
  "support_role_inconsistent",
  "left_right_order_invalid",
  "left_right_nonparallel",
  "back_left_nonorthogonal",
  "back_right_nonorthogonal",
  "floor_ceiling_nonparallel",
  "wall_ceiling_plane_inconsistent",
  "wall_floor_seam_error",
  "support_plane_offset",
  "corner_ill_conditioned",
  "corner_closure_error",
  "boundary_outside_envelope",
  "foreground_cap_requires_back",
  "foreground_cap_invalid",
  "dimension_out_of_bounds",
];

const UP: SupportVec3 = { x: 0, y: 1, z: 0 };
const ORIGIN: SupportVec3 = { x: 0, y: 0, z: 0 };
const EMPTY_FACE: RoomEnvelopeFace = { present: false };
type MutableCandidateFaces = Record<RoomEnvelopeFaceId, RoomEnvelopeFace>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteVec(value: SupportVec3 | null | undefined): value is SupportVec3 {
  return !!value && finite(value.x) && finite(value.y) && finite(value.z);
}

function sub(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: SupportVec3, value: number): SupportVec3 {
  const result = { x: a.x * value, y: a.y * value, z: a.z * value };
  return {
    x: result.x === 0 ? 0 : result.x,
    y: result.y === 0 ? 0 : result.y,
    z: result.z === 0 ? 0 : result.z,
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

function length(a: SupportVec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: SupportVec3): SupportVec3 | null {
  const magnitude = length(a);
  if (!finite(magnitude) || magnitude <= ROOM_ENVELOPE_NUMERIC_POLICY.normalizationEpsilon) return null;
  const normalized = scale(a, 1 / magnitude);
  const result = {
    x: normalized.x === 0 ? 0 : normalized.x,
    y: normalized.y === 0 ? 0 : normalized.y,
    z: normalized.z === 0 ? 0 : normalized.z,
  };
  return finiteVec(result) ? result : null;
}

function horizontalNormal(normal: SupportVec3): SupportVec3 | null {
  return normalize({ x: normal.x, y: 0, z: normal.z });
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function angleBetween(a: SupportVec3, b: SupportVec3, signInsensitive: boolean): number | null {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return null;
  const crossLength = length(cross(left, right));
  const rawDot = dot(left, right);
  if (!finite(crossLength) || !finite(rawDot)) return null;
  return degrees(Math.atan2(crossLength, signInsensitive ? Math.abs(rawDot) : rawDot));
}

function parallelDeviation(a: SupportVec3, b: SupportVec3): number {
  return angleBetween(a, b, true) ?? 0;
}

function orthogonalityDeviation(a: SupportVec3, b: SupportVec3): number {
  const angle = angleBetween(a, b, true);
  return angle === null ? 0 : Math.abs(90 - angle);
}

function wallVerticality(normal: SupportVec3): number {
  const horizontal = Math.hypot(normal.x, normal.z);
  return finite(horizontal) && finite(normal.y) ? degrees(Math.atan2(Math.abs(normal.y), horizontal)) : 0;
}

function wallKinds(): readonly RoomEnvelopeWallKind[] {
  return ["wall_back", "wall_left", "wall_right"];
}

function faceRecord(): MutableCandidateFaces {
  return {
    floor: EMPTY_FACE,
    ceiling: EMPTY_FACE,
    left: EMPTY_FACE,
    right: EMPTY_FACE,
    back: EMPTY_FACE,
    front: EMPTY_FACE,
  };
}

function emptyDimensions(): RoomEnvelopeDimensions {
  return {
    width: { present: false },
    visibleReviewedDepth: { present: false },
    assumedCappedDepth: { present: false },
    roomHeight: { present: false },
  };
}

function emptyResiduals(): RoomEnvelopeResiduals {
  return {
    wallVerticality: [],
    floorCeilingParallelism: { available: false, degrees: 0 },
    leftRightParallelism: { available: false, degrees: 0 },
    adjacentWallOrthogonality: {
      backLeft: { available: false, degrees: 0 },
      backRight: { available: false, degrees: 0 },
    },
    wallFloorSeams: [],
    wallCeilingPlaneOrthogonality: [],
    wallCeilingCoverage: [],
    supportPlaneOffsets: [],
    maxAbsSupportPlaneOffset: 0,
    cornerClosure: [],
    maxBoundaryToEnvelopeDistance: 0,
    rmsBoundaryToEnvelopeDistance: 0,
    excludedSupportResiduals: [],
  };
}

function emptyConditioning(input: RoomEnvelopeGeometryInput): RoomEnvelopeConditioning {
  return {
    wallSeamLengths: [],
    cornerIntersectionSinTheta: [],
    normalizationFailures: [],
    candidateDimensionBounds: [],
    includedSupportKinds: ROOM_ENVELOPE_SUPPORT_ORDER.filter((kind) => input.included[kind]),
    includedFaceIds: [],
  };
}

function orderedBlockers(blockers: readonly RoomEnvelopeBlocker[]): RoomEnvelopeBlocker[] {
  const set = new Set(blockers);
  return ROOM_ENVELOPE_BLOCKER_ORDER.filter((blocker) => set.has(blocker));
}

function wallFor(input: RoomEnvelopeGeometryInput, kind: RoomEnvelopeWallKind): RoomEnvelopeWallGeometry | null {
  const support = input.supports[kind];
  return support && support.kind === kind ? support : null;
}

function isAnchorPresentAndIncluded(
  input: RoomEnvelopeGeometryInput,
  anchor: RoomEnvelopeResolvedAnchor["kind"]
): boolean {
  return anchor === "floor_axes"
    ? input.supports.floor !== null && input.included.floor
    : input.supports[anchor] !== null && input.included[anchor];
}

export function selectRoomEnvelopeAnchor(input: RoomEnvelopeGeometryInput): {
  resolvedAnchor: RoomEnvelopeResolvedAnchor | null;
  blockers: RoomEnvelopeBlocker[];
} {
  const choice: RoomEnvelopeAnchorChoice = input.anchorChoice;
  if (choice.mode === "explicit") {
    if (!isAnchorPresentAndIncluded(input, choice.anchor)) {
      const present = choice.anchor === "floor_axes" ? input.supports.floor !== null : input.supports[choice.anchor] !== null;
      return { resolvedAnchor: null, blockers: [present ? "explicit_anchor_excluded" : "explicit_anchor_missing"] };
    }
    return { resolvedAnchor: { kind: choice.anchor, selection: "explicit" }, blockers: [] };
  }
  for (const anchor of ["wall_back", "wall_left", "wall_right", "floor_axes"] as const) {
    if (isAnchorPresentAndIncluded(input, anchor)) {
      return { resolvedAnchor: { kind: anchor, selection: "default" }, blockers: [] };
    }
  }
  return { resolvedAnchor: null, blockers: ["canonical_frame_unavailable"] };
}

export function buildRoomEnvelopeCanonicalFrame(input: RoomEnvelopeGeometryInput): {
  frame: RoomEnvelopeFrame | null;
  resolvedAnchor: RoomEnvelopeResolvedAnchor | null;
  blockers: RoomEnvelopeBlocker[];
} {
  const selected = selectRoomEnvelopeAnchor(input);
  if (!selected.resolvedAnchor) return { frame: null, resolvedAnchor: null, blockers: selected.blockers };
  const resolvedAnchor = selected.resolvedAnchor;
  if (resolvedAnchor.kind === "floor_axes") {
    return {
      frame: {
        originWorld: ORIGIN,
        xAxisWorld: { x: 1, y: 0, z: 0 },
        yAxisWorld: UP,
        zAxisWorld: { x: 0, y: 0, z: 1 },
        resolvedAnchor,
      },
      resolvedAnchor,
      blockers: [],
    };
  }
  const wall = wallFor(input, resolvedAnchor.kind);
  if (!wall || !finiteVec(wall.plane.normal) || !finiteVec(wall.seamWorld[0]) || !finiteVec(wall.seamWorld[1])) {
    return { frame: null, resolvedAnchor, blockers: ["canonical_frame_unavailable"] };
  }
  const normal = horizontalNormal(wall.plane.normal);
  if (!normal) return { frame: null, resolvedAnchor, blockers: ["degenerate_normal", "canonical_frame_unavailable"] };
  const midpoint = scale(add(wall.seamWorld[0], wall.seamWorld[1]), 0.5);
  const originWorld = { x: midpoint.x, y: 0, z: midpoint.z };
  let xAxisWorld: SupportVec3;
  let zAxisWorld: SupportVec3;
  if (resolvedAnchor.kind === "wall_back") {
    zAxisWorld = normal;
    xAxisWorld = normalize(cross(UP, zAxisWorld)) ?? ORIGIN;
  } else {
    xAxisWorld = resolvedAnchor.kind === "wall_left" ? normal : scale(normal, -1);
    zAxisWorld = normalize(cross(xAxisWorld, UP)) ?? ORIGIN;
  }
  if (!normalize(xAxisWorld) || !normalize(zAxisWorld)) {
    return { frame: null, resolvedAnchor, blockers: ["canonical_frame_unavailable"] };
  }
  return {
    frame: { originWorld, xAxisWorld, yAxisWorld: UP, zAxisWorld, resolvedAnchor },
    resolvedAnchor,
    blockers: [],
  };
}

function coordinate(point: SupportVec3, frame: RoomEnvelopeFrame): { x: number; y: number; z: number } {
  const relative = sub(point, frame.originWorld);
  return { x: dot(relative, frame.xAxisWorld), y: point.y, z: dot(relative, frame.zAxisWorld) };
}

function wallFaceId(kind: RoomEnvelopeWallKind): "left" | "right" | "back" {
  return kind === "wall_back" ? "back" : kind === "wall_left" ? "left" : "right";
}

function wallOffset(wall: RoomEnvelopeWallGeometry, frame: RoomEnvelopeFrame): number {
  const a = coordinate(wall.seamWorld[0], frame);
  const b = coordinate(wall.seamWorld[1], frame);
  return wall.kind === "wall_back" ? (a.z + b.z) / 2 : (a.x + b.x) / 2;
}

function boundaryPoints(input: RoomEnvelopeGeometryInput, kind: RoomEnvelopeSupportKind): readonly SupportVec3[] {
  const support = input.supports[kind];
  if (!support) return [];
  if (support.kind === "floor" || support.kind === "ceiling") return support.boundaryWorld;
  return [...support.boundaryWorld, support.seamWorld[0], support.seamWorld[1]];
}

function outsideDistance(
  point: SupportVec3,
  frame: RoomEnvelopeFrame,
  faces: RoomEnvelopeCandidateFaces,
  includeVerticalBounds = true
): number {
  const projected = coordinate(point, frame);
  const distances: number[] = [];
  if (includeVerticalBounds && faces.floor.present) distances.push(Math.max(0, -projected.y));
  if (includeVerticalBounds && faces.ceiling.present) distances.push(Math.max(0, projected.y - faces.ceiling.offset));
  if (faces.left.present) distances.push(Math.max(0, faces.left.offset - projected.x));
  if (faces.right.present) distances.push(Math.max(0, projected.x - faces.right.offset));
  if (faces.back.present) distances.push(Math.max(0, faces.back.offset - projected.z));
  if (faces.front.present) distances.push(Math.max(0, projected.z - faces.front.offset));
  return Math.hypot(...distances);
}

function lineIntersection(
  a0: { x: number; z: number },
  a1: { x: number; z: number },
  b0: { x: number; z: number },
  b1: { x: number; z: number }
): { available: boolean; sinTheta: number; point: { x: number; z: number } | null } {
  const da = { x: a1.x - a0.x, z: a1.z - a0.z };
  const db = { x: b1.x - b0.x, z: b1.z - b0.z };
  const la = Math.hypot(da.x, da.z);
  const lb = Math.hypot(db.x, db.z);
  if (!finite(la) || !finite(lb) || la <= ROOM_ENVELOPE_NUMERIC_POLICY.normalizationEpsilon || lb <= ROOM_ENVELOPE_NUMERIC_POLICY.normalizationEpsilon) {
    return { available: false, sinTheta: 0, point: null };
  }
  const denominator = da.x * db.z - da.z * db.x;
  const sinTheta = Math.abs(denominator) / (la * lb);
  if (!finite(sinTheta) || sinTheta <= ROOM_ENVELOPE_NUMERIC_POLICY.lineConditioningThreshold) {
    return { available: false, sinTheta: finite(sinTheta) ? sinTheta : 0, point: null };
  }
  const delta = { x: b0.x - a0.x, z: b0.z - a0.z };
  const t = (delta.x * db.z - delta.z * db.x) / denominator;
  const point = { x: a0.x + t * da.x, z: a0.z + t * da.z };
  return finite(point.x) && finite(point.z) ? { available: true, sinTheta, point } : { available: false, sinTheta, point: null };
}

function allFiniteGeometry(support: NonNullable<RoomEnvelopeGeometryInput["supports"][RoomEnvelopeSupportKind]>): boolean {
  const plane = support.plane;
  const points = support.kind === "floor" || support.kind === "ceiling"
    ? support.boundaryWorld
    : [...support.boundaryWorld, support.seamWorld[0], support.seamWorld[1]];
  return finiteVec(plane.point) && finiteVec(plane.normal) && finiteVec(plane.basisU) && finiteVec(plane.basisV) &&
    points.every(finiteVec) && (support.kind !== "ceiling" || finite(support.roomHeight));
}

function dimensionValid(value: number | null): boolean {
  return value !== null &&
    finite(value) &&
    value >= ROOM_ENVELOPE_NUMERIC_POLICY.minimumUsableDimension &&
    value <= ROOM_ENVELOPE_NUMERIC_POLICY.maximumBoundedDimension;
}

function expectedNormal(kind: RoomEnvelopeWallKind): SupportVec3 {
  return kind === "wall_back" ? { x: 0, y: 0, z: 1 } : kind === "wall_left" ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 };
}

function isIncluded(input: RoomEnvelopeGeometryInput, kind: RoomEnvelopeSupportKind): boolean {
  return input.included[kind] && input.supports[kind] !== null;
}

export function reconcileRoomEnvelope(input: RoomEnvelopeGeometryInput): RoomEnvelopeReconciliationResult {
  const blockers: RoomEnvelopeBlocker[] = [];
  const residuals = emptyResiduals();
  const conditioning = emptyConditioning(input);
  const faces = faceRecord();
  const dimensions = emptyDimensions();
  const includedKinds = ROOM_ENVELOPE_SUPPORT_ORDER.filter((kind) => isIncluded(input, kind));

  if (!isIncluded(input, "floor")) blockers.push("floor_missing");
  for (const kind of includedKinds) {
    const support = input.supports[kind]!;
    if (!allFiniteGeometry(support)) blockers.push("non_finite_input");
    if (!normalize(support.plane.normal)) blockers.push("degenerate_normal");
  }

  const frameBuild = buildRoomEnvelopeCanonicalFrame(input);
  blockers.push(...frameBuild.blockers);
  const frame = frameBuild.frame;
  if (!frame || blockers.includes("floor_missing")) {
    return {
      status: "unavailable",
      frame,
      faces,
      dimensions,
      residuals,
      conditioning,
      blockers: orderedBlockers(blockers),
      resolvedAnchor: frameBuild.resolvedAnchor,
      hasCeiling: false,
      hasForegroundCap: false,
      isCompleteCappedEnvelope: false,
    };
  }

  for (const kind of wallKinds()) {
    const wall = wallFor(input, kind);
    if (!wall || !isIncluded(input, kind)) continue;
    if (!allFiniteGeometry(wall)) continue;
    const seamLength = length(sub(wall.seamWorld[1], wall.seamWorld[0]));
    conditioning.wallSeamLengths.push({ wallKind: kind, length: finite(seamLength) ? seamLength : 0 });
    if (!finite(seamLength) || seamLength <= ROOM_ENVELOPE_NUMERIC_POLICY.normalizationEpsilon) blockers.push("degenerate_wall_seam");
    const normal = normalize(wall.plane.normal);
    if (!normal) continue;
    const verticality = wallVerticality(normal);
    residuals.wallVerticality.push({ wallKind: kind, degreesFromVerticalPlane: verticality });
    if (verticality > ROOM_ENVELOPE_NUMERIC_POLICY.angularToleranceDegrees) blockers.push("wall_not_vertical");
    const seamA = coordinate(wall.seamWorld[0], frame);
    const seamB = coordinate(wall.seamWorld[1], frame);
    const offset = wallOffset(wall, frame);
    residuals.wallFloorSeams.push({
      wallKind: kind,
      maxAbsY: Math.max(Math.abs(wall.seamWorld[0].y), Math.abs(wall.seamWorld[1].y)),
      faceOffsetSpread: Math.abs((kind === "wall_back" ? seamA.z : seamA.x) - (kind === "wall_back" ? seamB.z : seamB.x)),
    });
    // `expectedNormal` is expressed in the canonical room frame, not world
    // coordinates. The anchor establishes that frame, so every non-anchor
    // role comparison must project its world normal before semantic checks.
    const normalCanonical = {
      x: dot(normal, frame.xAxisWorld),
      y: dot(normal, frame.yAxisWorld),
      z: dot(normal, frame.zAxisWorld),
    };
    const expected = expectedNormal(kind);
    const anchorKind = frame.resolvedAnchor.kind;
    const expectedComponent = dot(normalCanonical, expected);
    const dominantHorizontalComponent = Math.max(Math.abs(normalCanonical.x), Math.abs(normalCanonical.z));
    if (
      anchorKind !== kind &&
      (expectedComponent <= 0 || Math.abs(expectedComponent) < dominantHorizontalComponent / Math.SQRT2)
    ) {
      blockers.push("support_role_inconsistent");
    }
    const faceId = wallFaceId(kind);
    faces[faceId] = { present: true, source: "support", supportKind: kind, offset };
    const planeCoordinate = kind === "wall_back"
      ? coordinate(wall.plane.point, frame).z
      : coordinate(wall.plane.point, frame).x;
    const signedOffset = finite(planeCoordinate) && finite(offset) ? planeCoordinate - offset : 0;
    residuals.supportPlaneOffsets.push({ wallKind: kind, signedOffset, absoluteOffset: Math.abs(signedOffset) });
  }
  faces.floor = { present: true, source: "support", supportKind: "floor", offset: 0 };

  const ceiling = input.supports.ceiling;
  if (isIncluded(input, "ceiling") && ceiling && allFiniteGeometry(ceiling)) {
    faces.ceiling = { present: true, source: "support", supportKind: "ceiling", offset: ceiling.roomHeight };
    dimensions.roomHeight = { present: true, value: ceiling.roomHeight, provenance: "machine_derived_world_extent" };
    const floor = input.supports.floor!;
    const angle = parallelDeviation(floor.plane.normal, ceiling.plane.normal);
    residuals.floorCeilingParallelism = { available: true, degrees: angle };
    if (angle > ROOM_ENVELOPE_NUMERIC_POLICY.angularToleranceDegrees) blockers.push("floor_ceiling_nonparallel");
    for (const kind of wallKinds()) {
      const wall = wallFor(input, kind);
      if (!wall || !isIncluded(input, kind)) continue;
      const deviation = orthogonalityDeviation(wall.plane.normal, ceiling.plane.normal);
      residuals.wallCeilingPlaneOrthogonality.push({ available: true, degrees: deviation });
      if (deviation > ROOM_ENVELOPE_NUMERIC_POLICY.angularToleranceDegrees) blockers.push("wall_ceiling_plane_inconsistent");
      const upper = wall.boundaryWorld.filter((point) => point.y > Math.max(wall.seamWorld[0].y, wall.seamWorld[1].y) + ROOM_ENVELOPE_NUMERIC_POLICY.normalizationEpsilon);
      residuals.wallCeilingCoverage.push({ wallKind: kind, upperCornerGaps: upper.map((point) => ceiling.roomHeight - point.y) });
    }
  }

  const left = wallFor(input, "wall_left");
  const right = wallFor(input, "wall_right");
  const back = wallFor(input, "wall_back");
  if (left && right && isIncluded(input, "wall_left") && isIncluded(input, "wall_right")) {
    const angle = parallelDeviation(left.plane.normal, right.plane.normal);
    residuals.leftRightParallelism = { available: true, degrees: angle };
    if (angle > ROOM_ENVELOPE_NUMERIC_POLICY.angularToleranceDegrees) blockers.push("left_right_nonparallel");
    const leftOffset = faces.left.present ? faces.left.offset : 0;
    const rightOffset = faces.right.present ? faces.right.offset : 0;
    const width = rightOffset - leftOffset;
    dimensions.width = { present: true, value: width, provenance: "machine_derived_world_extent" };
    if (width <= 0) blockers.push("left_right_order_invalid");
  }
  for (const [sideKind, key] of [
    ["wall_left", "backLeft"],
    ["wall_right", "backRight"],
  ] as const) {
    const side = wallFor(input, sideKind);
    if (!back || !side || !isIncluded(input, "wall_back") || !isIncluded(input, sideKind)) continue;
    const deviation = orthogonalityDeviation(back.plane.normal, side.plane.normal);
    residuals.adjacentWallOrthogonality[key] = { available: true, degrees: deviation };
    if (deviation > ROOM_ENVELOPE_NUMERIC_POLICY.angularToleranceDegrees) {
      blockers.push(key === "backLeft" ? "back_left_nonorthogonal" : "back_right_nonorthogonal");
    }
    const a0 = coordinate(back.seamWorld[0], frame);
    const a1 = coordinate(back.seamWorld[1], frame);
    const b0 = coordinate(side.seamWorld[0], frame);
    const b1 = coordinate(side.seamWorld[1], frame);
    const intersection = lineIntersection(a0, a1, b0, b1);
    const pair = sideKind === "wall_left" ? "wall_back:wall_left" : "wall_back:wall_right";
    conditioning.cornerIntersectionSinTheta.push({ pair, value: intersection.sinTheta });
    if (!intersection.available) blockers.push("corner_ill_conditioned");
    const expectedX = sideKind === "wall_left" && faces.left.present
      ? faces.left.offset
      : sideKind === "wall_right" && faces.right.present
        ? faces.right.offset
        : 0;
    const expectedZ = faces.back.present ? faces.back.offset : 0;
    const error = intersection.point ? Math.hypot(intersection.point.x - expectedX, intersection.point.z - expectedZ) : 0;
    const closure: RoomEnvelopeCornerClosureResidual = {
      pair,
      available: intersection.available,
      intersectionSinTheta: intersection.sinTheta,
      worldDistanceError: finite(error) ? error : 0,
    };
    residuals.cornerClosure.push(closure);
    if (closure.available && closure.worldDistanceError > ROOM_ENVELOPE_NUMERIC_POLICY.worldDistanceTolerance) {
      blockers.push("corner_closure_error");
    }
  }

  for (const seam of residuals.wallFloorSeams) {
    if (seam.maxAbsY > ROOM_ENVELOPE_NUMERIC_POLICY.worldDistanceTolerance || seam.faceOffsetSpread > ROOM_ENVELOPE_NUMERIC_POLICY.worldDistanceTolerance) {
      blockers.push("wall_floor_seam_error");
    }
  }
  residuals.maxAbsSupportPlaneOffset = residuals.supportPlaneOffsets.reduce((maximum, residual) => Math.max(maximum, residual.absoluteOffset), 0);
  if (residuals.maxAbsSupportPlaneOffset > ROOM_ENVELOPE_NUMERIC_POLICY.worldDistanceTolerance) blockers.push("support_plane_offset");

  if (input.foregroundCap) {
    if (!isIncluded(input, "wall_back") || !faces.back.present) {
      blockers.push("foreground_cap_requires_back");
    } else if (
      !finite(input.foregroundCap.depthWorld) ||
      input.foregroundCap.depthWorld < ROOM_ENVELOPE_NUMERIC_POLICY.minimumUsableDimension ||
      input.foregroundCap.depthWorld > ROOM_ENVELOPE_NUMERIC_POLICY.maximumBoundedDimension
    ) {
      blockers.push("foreground_cap_invalid");
    } else {
      faces.front = {
        present: true,
        source: "operator_assumption",
        assumptionKind: "foreground_depth_from_back",
        offset: faces.back.offset + input.foregroundCap.depthWorld,
      };
      dimensions.assumedCappedDepth = {
        present: true,
        value: input.foregroundCap.depthWorld,
        provenance: "operator_assumption",
      };
    }
  }

  const includedDistances: number[] = [];
  for (const kind of includedKinds) {
    for (const point of boundaryPoints(input, kind)) {
      if (!finiteVec(point)) continue;
      includedDistances.push(outsideDistance(point, frame, faces, kind === "floor" || kind === "ceiling"));
    }
  }
  residuals.maxBoundaryToEnvelopeDistance = includedDistances.reduce((maximum, value) => Math.max(maximum, value), 0);
  residuals.rmsBoundaryToEnvelopeDistance = includedDistances.length === 0
    ? 0
    : Math.sqrt(includedDistances.reduce((sum, value) => sum + value * value, 0) / includedDistances.length);
  if (residuals.maxBoundaryToEnvelopeDistance > ROOM_ENVELOPE_NUMERIC_POLICY.worldDistanceTolerance) {
    blockers.push("boundary_outside_envelope");
  }

  if (faces.back.present) {
    const allZ = includedKinds.flatMap((kind) => boundaryPoints(input, kind).filter(finiteVec).map((point) => coordinate(point, frame).z));
    const visibleDepth = allZ.length > 0 ? Math.max(0, Math.max(...allZ) - faces.back.offset) : 0;
    dimensions.visibleReviewedDepth = { present: true, value: visibleDepth, provenance: "machine_derived_world_extent" };
  }
  for (const [name, dimension] of Object.entries(dimensions) as [keyof RoomEnvelopeDimensions, RoomEnvelopeDimensions[keyof RoomEnvelopeDimensions]][]) {
    const value = dimension.present ? dimension.value : null;
    const valid = value === null || dimensionValid(value);
    conditioning.candidateDimensionBounds.push({ name, value, valid });
    if (value !== null && !valid) blockers.push("dimension_out_of_bounds");
  }
  conditioning.includedFaceIds = ROOM_ENVELOPE_FACE_ORDER.filter((id) => faces[id].present);

  for (const kind of ROOM_ENVELOPE_SUPPORT_ORDER) {
    if (!input.supports[kind] || input.included[kind]) continue;
    const support = input.supports[kind]!;
    const points = boundaryPoints(input, kind).filter(finiteVec);
    const maxBoundaryOutsideDistance = points.reduce((maximum, point) => Math.max(maximum, outsideDistance(point, frame, faces)), 0);
    const planeOffset = support.kind === "floor" || support.kind === "ceiling"
      ? null
      : (() => {
          const face = faces[wallFaceId(support.kind)];
          if (!face.present || !finiteVec(support.plane.point)) return null;
          const location = coordinate(support.plane.point, frame);
          const offset = support.kind === "wall_back" ? location.z : location.x;
          return finite(offset) ? offset - face.offset : null;
        })();
    residuals.excludedSupportResiduals.push({ supportKind: kind, available: frame !== null, maxBoundaryOutsideDistance, supportPlaneOffset: planeOffset });
  }

  const hasMandatory = ["floor", "wall_back", "wall_left", "wall_right"].every((kind) => isIncluded(input, kind as RoomEnvelopeSupportKind));
  const ordered = orderedBlockers(blockers);
  const status: RoomEnvelopeDerivationStatus = ordered.length > 0
    ? "inconsistent"
    : hasMandatory
      ? "candidate"
      : "partial";
  const hasCeiling = faces.ceiling.present;
  const hasForegroundCap = faces.front.present;
  return {
    status,
    frame,
    faces,
    dimensions,
    residuals,
    conditioning,
    blockers: ordered,
    resolvedAnchor: frame.resolvedAnchor,
    hasCeiling,
    hasForegroundCap,
    isCompleteCappedEnvelope: status === "candidate" && hasMandatory && hasCeiling && hasForegroundCap,
  };
}
