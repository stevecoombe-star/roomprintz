import type {
  EmptyObservedJunction,
  EmptyObservedOpening,
  EmptyObservedPlane,
  EmptyObservedSeam,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";

export const AFC_V2_EMPTY_ROOM_OBSERVATION_NORMALIZATION_VERSION =
  "afc-v2-empty-room-observation-normalization/v1" as const;

export type EmptyObservationEvidenceKind =
  | "plane"
  | "seam"
  | "opening"
  | "junction";

export type EmptyObservationRejection = Readonly<{
  kind: EmptyObservationEvidenceKind;
  rawId: string | null;
  reason: string;
}>;

export type EmptyObservationAdjacency = Readonly<{
  id: string;
  planeAId: string;
  planeBId: string;
  seamId: string;
  confidence: number;
  evidenceClass: "visible_seam_supported_adjacency";
}>;

export type EmptyRoomObservationNormalizationDiagnostics = Readonly<{
  version: typeof AFC_V2_EMPTY_ROOM_OBSERVATION_NORMALIZATION_VERSION;
  rawCounts: Readonly<{
    planes: number;
    seams: number;
    openings: number;
    junctions: number;
  }>;
  normalizedCounts: Readonly<{
    planes: number;
    seams: number;
    openings: number;
    junctions: number;
    adjacency: number;
  }>;
  rejectedEvidence: readonly EmptyObservationRejection[];
  unresolvedTopology: readonly Readonly<{
    kind: "seam_support" | "opening_support" | "junction_support";
    rawIds: readonly string[];
    reason: string;
  }>[];
  geometryManufactured: false;
  hiddenContinuationAdded: false;
}>;

type Input = Readonly<{
  planes: readonly EmptyObservedPlane[];
  seams: readonly EmptyObservedSeam[];
  openings: readonly EmptyObservedOpening[];
  junctions: readonly EmptyObservedJunction[];
  parserRejections: readonly EmptyObservationRejection[];
}>;

type Result = Readonly<{
  planes: readonly EmptyObservedPlane[];
  seams: readonly EmptyObservedSeam[];
  openings: readonly EmptyObservedOpening[];
  junctions: readonly EmptyObservedJunction[];
  adjacency: readonly EmptyObservationAdjacency[];
  diagnostics: EmptyRoomObservationNormalizationDiagnostics;
}>;

const MIN_POLYGON_AREA = 0.000001;
const MIN_POLYLINE_LENGTH = 0.0001;
const MAX_DIAGNOSTICS = 96;

function distance(a: SourceNormalizedPoint, b: SourceNormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points: readonly SourceNormalizedPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function orientation(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsIntersect(
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
  c: SourceNormalizedPoint,
  d: SourceNormalizedPoint,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function selfIntersects(points: readonly SourceNormalizedPoint[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first ||
        (first === 0 && secondNext === 0)
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          points[first],
          points[firstNext],
          points[second],
          points[secondNext],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function validPolygon(points: readonly SourceNormalizedPoint[]): boolean {
  return points.length >= 3 &&
    polygonArea(points) >= MIN_POLYGON_AREA &&
    !selfIntersects(points);
}

function validPolyline(points: readonly SourceNormalizedPoint[]): boolean {
  if (points.length < 2) return false;
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index]);
    if (segmentLength === 0) return false;
    length += segmentLength;
  }
  return length >= MIN_POLYLINE_LENGTH;
}

function seamCategoryMatchesPlanes(
  seam: EmptyObservedSeam,
  planes: ReadonlyMap<string, EmptyObservedPlane>,
): boolean {
  if (seam.category === "unknown") return true;
  if (seam.planeIds.length !== 2) return false;
  const categories = seam.planeIds
    .map((planeId) => planes.get(planeId)?.category)
    .filter((value): value is EmptyObservedPlane["category"] => Boolean(value))
    .sort()
    .join(":");
  return seam.category === "floor_wall"
    ? categories === "floor:wall"
    : seam.category === "wall_wall"
    ? categories === "wall:wall"
    : seam.category === "wall_ceiling"
    ? categories === "ceiling:wall"
    : false;
}

function bounded<T>(values: readonly T[]): readonly T[] {
  return Object.freeze(values.slice(0, MAX_DIAGNOSTICS));
}

/**
 * This gate can reject or relate provider evidence, but it never extends,
 * closes, merges, projects, or otherwise manufactures image geometry.
 */
export function normalizeEmptyRoomObservationEvidence(input: Input): Result {
  const rejected: EmptyObservationRejection[] = [...input.parserRejections];
  const unresolved: {
    kind: "seam_support" | "opening_support" | "junction_support";
    rawIds: readonly string[];
    reason: string;
  }[] = [];

  const planes = input.planes.filter((plane) => {
    if (validPolygon(plane.sourceNormalizedPolygon)) return true;
    rejected.push({
      kind: "plane",
      rawId: plane.id,
      reason: "degenerate_or_self_intersecting_visible_plane_region",
    });
    return false;
  });
  const planeById = new Map(planes.map((plane) => [plane.id, plane]));

  const seams = input.seams.filter((seam) => {
    if (!validPolyline(seam.sourceNormalizedPolyline)) {
      rejected.push({
        kind: "seam",
        rawId: seam.id,
        reason: "degenerate_visible_seam_polyline",
      });
      return false;
    }
    if (
      seam.planeIds.length === 0 ||
      seam.planeIds.some((planeId) => !planeById.has(planeId)) ||
      !seamCategoryMatchesPlanes(seam, planeById)
    ) {
      rejected.push({
        kind: "seam",
        rawId: seam.id,
        reason: "seam_has_invalid_plane_binding_or_category",
      });
      unresolved.push({
        kind: "seam_support",
        rawIds: [seam.id, ...seam.planeIds],
        reason: "visible_seam_not_accepted_without_matching_visible_planes",
      });
      return false;
    }
    return true;
  });
  const seamIds = new Set(seams.map((seam) => seam.id));

  const openings = input.openings.filter((opening) => {
    const boundaryValid = opening.boundaryClosure === "complete_visible_outline"
      ? validPolygon(opening.sourceNormalizedBoundary)
      : validPolyline(opening.sourceNormalizedBoundary);
    if (
      !boundaryValid ||
      (opening.hostPlaneId !== null && !planeById.has(opening.hostPlaneId))
    ) {
      rejected.push({
        kind: "opening",
        rawId: opening.id,
        reason: "opening_has_invalid_visible_boundary_or_host_plane",
      });
      unresolved.push({
        kind: "opening_support",
        rawIds: [opening.id],
        reason: "opening_not_accepted_without_a_valid_visible_boundary",
      });
      return false;
    }
    return true;
  });
  const openingIds = new Set(openings.map((opening) => opening.id));

  const junctions = input.junctions.filter((junction) => {
    const referencesValid =
      junction.seamIds.every((id) => seamIds.has(id)) &&
      junction.openingIds.every((id) => openingIds.has(id));
    if (
      !referencesValid ||
      (junction.category !== "room_corner" &&
        junction.seamIds.length === 0 &&
        junction.openingIds.length === 0)
    ) {
      rejected.push({
        kind: "junction",
        rawId: junction.id,
        reason: "junction_has_invalid_or_missing_visible_evidence_binding",
      });
      unresolved.push({
        kind: "junction_support",
        rawIds: [junction.id, ...junction.seamIds, ...junction.openingIds],
        reason: "junction_not_accepted_without_bound_visible_evidence",
      });
      return false;
    }
    return true;
  });

  const adjacency = seams
    .filter((seam) => seam.planeIds.length === 2)
    .map((seam) => Object.freeze({
      id: `adj_${seam.id}`.slice(0, 80),
      planeAId: seam.planeIds[0],
      planeBId: seam.planeIds[1],
      seamId: seam.id,
      confidence: seam.confidence,
      evidenceClass: "visible_seam_supported_adjacency" as const,
    }));

  return Object.freeze({
    planes: Object.freeze(planes),
    seams: Object.freeze(seams),
    openings: Object.freeze(openings),
    junctions: Object.freeze(junctions),
    adjacency: Object.freeze(adjacency),
    diagnostics: Object.freeze({
      version: AFC_V2_EMPTY_ROOM_OBSERVATION_NORMALIZATION_VERSION,
      rawCounts: Object.freeze({
        planes: input.planes.length,
        seams: input.seams.length,
        openings: input.openings.length,
        junctions: input.junctions.length,
      }),
      normalizedCounts: Object.freeze({
        planes: planes.length,
        seams: seams.length,
        openings: openings.length,
        junctions: junctions.length,
        adjacency: adjacency.length,
      }),
      rejectedEvidence: bounded(rejected),
      unresolvedTopology: bounded(unresolved),
      geometryManufactured: false,
      hiddenContinuationAdded: false,
    }),
  });
}
