import type {
  ObservedAdjacency,
  ObservedGridFamily,
  ObservedOpening,
  ObservedPlane,
  ObservedSeam,
  SourceNormalizedPoint,
} from "./room-observation-contract";

export const AFC_V2_ROOM_OBSERVATION_NORMALIZATION_VERSION =
  "afc-v2-room-observation-normalization/v1" as const;

export type PlaneContinuityEvidence = Readonly<{
  id: string;
  planeIds: readonly [string, string];
  assessment: "continuous" | "discontinuous" | "unresolved";
  gridCompatibility: "compatible" | "incompatible" | "insufficient";
  boundaryEvidence:
    | "uninterrupted_tiled_field"
    | "projective_discontinuity"
    | "architectural_break"
    | "opening"
    | "unclear";
  confidence: number;
  ambiguity: string | null;
}>;

export type NormalizationRejection = Readonly<{
  kind: "plane" | "grid_family" | "seam" | "opening" | "continuity";
  rawId: string | null;
  reason: string;
}>;

export type RoomObservationNormalizationDiagnostics = Readonly<{
  version: typeof AFC_V2_ROOM_OBSERVATION_NORMALIZATION_VERSION;
  rawCounts: Readonly<{
    planes: number;
    gridFamilies: number;
    seams: number;
    openings: number;
    adjacencySuggestions: number;
    continuityClaims: number;
  }>;
  normalizedCounts: Readonly<{
    planes: number;
    gridFamilies: number;
    seams: number;
    openings: number;
    adjacency: number;
  }>;
  merges: readonly Readonly<{
    normalizedPlaneId: string;
    rawPlaneIds: readonly string[];
    continuityEvidenceId: string;
    reasons: readonly string[];
  }>[];
  continuityAssessments: readonly PlaneContinuityEvidence[];
  rejectedEvidence: readonly NormalizationRejection[];
  unresolvedTopology: readonly Readonly<{
    kind: "plane_continuity" | "seam_support" | "grid_evidence";
    rawIds: readonly string[];
    reason: string;
  }>[];
}>;

type NormalizationInput = Readonly<{
  planes: readonly ObservedPlane[];
  gridFamilies: readonly ObservedGridFamily[];
  seams: readonly ObservedSeam[];
  openings: readonly ObservedOpening[];
  continuity: readonly PlaneContinuityEvidence[];
  rawAdjacencyCount: number;
  parserRejections: readonly NormalizationRejection[];
  imageAspectRatio: number;
}>;

type NormalizationResult = Readonly<{
  planes: readonly ObservedPlane[];
  gridFamilies: readonly ObservedGridFamily[];
  seams: readonly ObservedSeam[];
  openings: readonly ObservedOpening[];
  adjacency: readonly ObservedAdjacency[];
  diagnostics: RoomObservationNormalizationDiagnostics;
}>;

const CONTACT_TOLERANCE = 0.012;
const MIN_CONTACT_LENGTH = 0.025;
const GRID_DIRECTION_TOLERANCE_RAD = 18 * Math.PI / 180;
const STRONG_GRID_DIRECTION_TOLERANCE_RAD = 10 * Math.PI / 180;
const MIN_MERGE_CONFIDENCE = 0.82;
const MAX_DIAGNOSTIC_ENTRIES = 64;

function distance(a: SourceNormalizedPoint, b: SourceNormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointSegmentDistance(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function polygonEdges(
  polygon: readonly SourceNormalizedPoint[],
): readonly (readonly [SourceNormalizedPoint, SourceNormalizedPoint])[] {
  return polygon.map((point, index) =>
    [point, polygon[(index + 1) % polygon.length]] as const
  );
}

function contactPoints(
  a: readonly SourceNormalizedPoint[],
  b: readonly SourceNormalizedPoint[],
): readonly SourceNormalizedPoint[] {
  const contacts: SourceNormalizedPoint[] = [];
  const addIfNear = (
    point: SourceNormalizedPoint,
    polygon: readonly SourceNormalizedPoint[],
  ) => {
    const near = polygonEdges(polygon).some(([start, end]) =>
      pointSegmentDistance(point, start, end) <= CONTACT_TOLERANCE
    );
    if (
      near &&
      !contacts.some((candidate) => distance(candidate, point) <= CONTACT_TOLERANCE)
    ) {
      contacts.push(point);
    }
  };
  a.forEach((point) => addIfNear(point, b));
  b.forEach((point) => addIfNear(point, a));
  return contacts;
}

function farthestPair(
  points: readonly SourceNormalizedPoint[],
): readonly [SourceNormalizedPoint, SourceNormalizedPoint] | null {
  let result: readonly [SourceNormalizedPoint, SourceNormalizedPoint] | null =
    null;
  let maximum = 0;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      const candidate = distance(points[a], points[b]);
      if (candidate > maximum) {
        maximum = candidate;
        result = [points[a], points[b]];
      }
    }
  }
  return maximum >= MIN_CONTACT_LENGTH ? result : null;
}

function orientationDifference(a: number, b: number): number {
  const raw = Math.abs(a - b) % Math.PI;
  return Math.min(raw, Math.PI - raw);
}

function familyDirections(
  family: ObservedGridFamily,
  imageAspectRatio: number,
): readonly number[] {
  return family.lineSegments.map(({ start, end }) =>
    Math.atan2(
      end.y - start.y,
      (end.x - start.x) * imageAspectRatio,
    )
  );
}

function gridsSupportContinuity(
  planeAId: string,
  planeBId: string,
  families: readonly ObservedGridFamily[],
  imageAspectRatio: number,
): boolean {
  const a = families.filter((family) => family.planeId === planeAId);
  const b = families.filter((family) => family.planeId === planeBId);
  if (a.length === 0 || b.length === 0) return false;
  return a.some((familyA) =>
    b.some((familyB) =>
      familyDirections(familyA, imageAspectRatio).some((directionA) =>
        familyDirections(familyB, imageAspectRatio).some((directionB) =>
          orientationDifference(directionA, directionB) <=
            GRID_DIRECTION_TOLERANCE_RAD
        )
      )
    )
  );
}

function representativeFamilyDirection(
  family: ObservedGridFamily,
  imageAspectRatio: number,
): number {
  const directions = familyDirections(family, imageAspectRatio);
  const doubledX = directions.reduce((sum, angle) => sum + Math.cos(2 * angle), 0);
  const doubledY = directions.reduce((sum, angle) => sum + Math.sin(2 * angle), 0);
  return Math.atan2(doubledY, doubledX) / 2;
}

function gridsStronglySupportContinuity(
  planeAId: string,
  planeBId: string,
  families: readonly ObservedGridFamily[],
  imageAspectRatio: number,
): boolean {
  const forPlane = (planeId: string) =>
    families
      .filter((family) =>
        family.planeId === planeId && family.axis !== "unresolved"
      )
      .slice(0, 2);
  const a = forPlane(planeAId);
  const b = forPlane(planeBId);
  if (a.length !== 2 || b.length !== 2) return false;
  const directionsA = a.map((family) =>
    representativeFamilyDirection(family, imageAspectRatio)
  );
  const directionsB = b.map((family) =>
    representativeFamilyDirection(family, imageAspectRatio)
  );
  const direct = Math.max(
    orientationDifference(directionsA[0], directionsB[0]),
    orientationDifference(directionsA[1], directionsB[1]),
  );
  const swapped = Math.max(
    orientationDifference(directionsA[0], directionsB[1]),
    orientationDifference(directionsA[1], directionsB[0]),
  );
  return Math.min(direct, swapped) <= STRONG_GRID_DIRECTION_TOLERANCE_RAD;
}

function cross(
  origin: SourceNormalizedPoint,
  a: SourceNormalizedPoint,
  b: SourceNormalizedPoint,
): number {
  return (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(
  points: readonly SourceNormalizedPoint[],
): readonly SourceNormalizedPoint[] {
  const unique = [...new Map(
    points.map((point) => [`${point.x.toFixed(8)}:${point.y.toFixed(8)}`, point]),
  ).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 3) return Object.freeze(unique);
  const lower: SourceNormalizedPoint[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: SourceNormalizedPoint[] = [];
  for (const point of [...unique].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  return Object.freeze([...lower.slice(0, -1), ...upper.slice(0, -1)]);
}

function polygonArea(polygon: readonly SourceNormalizedPoint[]): number {
  return Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function pointInPolygon(
  point: SourceNormalizedPoint,
  polygon: readonly SourceNormalizedPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x <
        (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) +
          a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentCrossesOpening(
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
  opening: ObservedOpening,
): boolean {
  return [0.2, 0.4, 0.6, 0.8].some((t) =>
    pointInPolygon({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    }, opening.imageBoundary)
  );
}

function polylineCrossesOpening(
  polyline: readonly SourceNormalizedPoint[],
  openings: readonly ObservedOpening[],
): boolean {
  for (let index = 0; index < polyline.length - 1; index += 1) {
    if (
      openings.some((opening) =>
        segmentCrossesOpening(polyline[index], polyline[index + 1], opening)
      )
    ) {
      return true;
    }
  }
  return false;
}

function categoriesSupportSeam(
  seam: ObservedSeam,
  planeById: ReadonlyMap<string, ObservedPlane>,
): boolean {
  if (seam.category === "unknown") return true;
  if (seam.planeIds.length !== 2) return false;
  const categories = seam.planeIds
    .map((planeId) => planeById.get(planeId)?.category)
    .filter(Boolean)
    .sort();
  const key = categories.join(":");
  return seam.category === "floor_wall"
    ? key === "floor:wall"
    : seam.category === "wall_ceiling"
    ? key === "ceiling:wall"
    : seam.category === "wall_wall"
    ? key === "wall:wall"
    : false;
}

function continuityKey(planeIds: readonly string[]): string {
  return [...planeIds].sort().join(":");
}

function bounded<T>(entries: readonly T[]): readonly T[] {
  return Object.freeze(entries.slice(0, MAX_DIAGNOSTIC_ENTRIES));
}

export function normalizeRoomObservationEvidence(
  input: NormalizationInput,
): NormalizationResult {
  const rejected: NormalizationRejection[] = [...input.parserRejections];
  const unresolved: {
    kind: "plane_continuity" | "seam_support" | "grid_evidence";
    rawIds: readonly string[];
    reason: string;
  }[] = [];
  const merges: {
    normalizedPlaneId: string;
    rawPlaneIds: readonly string[];
    continuityEvidenceId: string;
    reasons: readonly string[];
  }[] = [];
  const rawPlaneById = new Map(input.planes.map((plane) => [plane.id, plane]));
  const planeById = new Map(rawPlaneById);
  const remappedPlaneIds = new Map(input.planes.map((plane) =>
    [plane.id, plane.id]
  ));
  const groupMembers = new Map(input.planes.map((plane) =>
    [plane.id, new Set([plane.id])]
  ));
  const mergedRawPlaneIds = new Set<string>();

  for (
    const claim of [...input.continuity].sort((a, b) =>
      b.confidence - a.confidence
    )
  ) {
    const [planeAId, planeBId] = claim.planeIds;
    const rawPlaneA = rawPlaneById.get(planeAId);
    const rawPlaneB = rawPlaneById.get(planeBId);
    const mappedPlaneAId = remappedPlaneIds.get(planeAId);
    const mappedPlaneBId = remappedPlaneIds.get(planeBId);
    const planeA = mappedPlaneAId
      ? planeById.get(mappedPlaneAId)
      : undefined;
    const planeB = mappedPlaneBId
      ? planeById.get(mappedPlaneBId)
      : undefined;
    const fail = (reason: string) => {
      unresolved.push({
        kind: "plane_continuity",
        rawIds: [claim.id, planeAId, planeBId],
        reason,
      });
    };
    if (
      !rawPlaneA ||
      !rawPlaneB ||
      !planeA ||
      !planeB ||
      !mappedPlaneAId ||
      !mappedPlaneBId ||
      planeAId === planeBId
    ) {
      rejected.push({
        kind: "continuity",
        rawId: claim.id,
        reason: "continuity_references_invalid_planes",
      });
      continue;
    }
    if (mappedPlaneAId === mappedPlaneBId) {
      continue;
    }
    if (rawPlaneA.category !== "wall" || rawPlaneB.category !== "wall") {
      fail("merge_is_limited_to_wall_planes");
      continue;
    }
    const areaA = polygonArea(rawPlaneA.imagePolygon);
    const areaB = polygonArea(rawPlaneB.imagePolygon);
    const narrowStripRatio = Math.min(areaA, areaB) /
      Math.max(areaA, areaB, Number.EPSILON);
    const narrowStripOverride =
      claim.assessment === "discontinuous" &&
      claim.confidence >= MIN_MERGE_CONFIDENCE &&
      claim.gridCompatibility === "compatible" &&
      claim.boundaryEvidence === "architectural_break" &&
      Math.min(areaA, areaB) <= 0.04 &&
      narrowStripRatio <= 0.15 &&
      gridsStronglySupportContinuity(
        planeAId,
        planeBId,
        input.gridFamilies,
        input.imageAspectRatio,
      );
    const providerContinuous =
      claim.assessment === "continuous" &&
      claim.confidence >= MIN_MERGE_CONFIDENCE &&
      claim.gridCompatibility === "compatible" &&
      claim.boundaryEvidence === "uninterrupted_tiled_field";
    if (!providerContinuous && !narrowStripOverride) {
      if (claim.assessment === "unresolved") {
        fail("provider_continuity_unresolved");
      } else if (claim.assessment === "continuous") {
        fail("continuity_claim_lacks_required_multi_signal_support");
      }
      continue;
    }
    const contact = farthestPair(
      contactPoints(rawPlaneA.imagePolygon, rawPlaneB.imagePolygon),
    );
    if (!contact) {
      fail("reported_plane_polygons_do_not_share_a_supported_boundary");
      continue;
    }
    const gridSupported = narrowStripOverride
      ? gridsStronglySupportContinuity(
        planeAId,
        planeBId,
        input.gridFamilies,
        input.imageAspectRatio,
      )
      : gridsSupportContinuity(
        planeAId,
        planeBId,
        input.gridFamilies,
        input.imageAspectRatio,
      );
    if (!gridSupported) {
      fail("sampled_grid_directions_do_not_support_continuity");
      continue;
    }
    const separatingOpening = input.openings.some((opening) =>
      (opening.hostPlaneId === null ||
        opening.hostPlaneId === planeAId ||
        opening.hostPlaneId === planeBId) &&
      segmentCrossesOpening(contact[0], contact[1], opening)
    );
    if (separatingOpening) {
      fail("opening_interrupts_reported_plane_boundary");
      continue;
    }
    const strongCornerSeam = input.seams.some((seam) =>
      continuityKey(seam.planeIds) === continuityKey(claim.planeIds) &&
      seam.category === "wall_wall" &&
      seam.confidence >= 0.65 &&
      (seam.boundaryEvidence === "projective_discontinuity" ||
        (!narrowStripOverride &&
          seam.boundaryEvidence === "architectural_break") ||
        seam.gridCompatibility === "incompatible")
    );
    if (strongCornerSeam) {
      fail("accepted_projective_or_architectural_corner_evidence_blocks_merge");
      continue;
    }
    const hull = convexHull([...planeA.imagePolygon, ...planeB.imagePolygon]);
    const sourceArea = polygonArea(planeA.imagePolygon) +
      polygonArea(planeB.imagePolygon);
    if (
      hull.length < 3 ||
      sourceArea <= 0 ||
      polygonArea(hull) > sourceArea * 1.12
    ) {
      fail("combined_visible_extent_would_bridge_unsupported_image_area");
      continue;
    }
    const normalizedPlaneId = [mappedPlaneAId, mappedPlaneBId].sort()[0];
    const mergedMembers = new Set([
      ...(groupMembers.get(mappedPlaneAId) ?? [planeAId]),
      ...(groupMembers.get(mappedPlaneBId) ?? [planeBId]),
    ]);
    const mergedPlane: ObservedPlane = Object.freeze({
      id: normalizedPlaneId,
      category: "wall",
      imagePolygon: hull,
      gridFamilyIds: Object.freeze([]),
      confidence: Math.min(
        planeA.confidence,
        planeB.confidence,
        claim.confidence,
      ),
      ambiguity: planeA.ambiguity ?? planeB.ambiguity ?? claim.ambiguity,
      evidenceClass: "conservative_normalized_visible_evidence",
    });
    planeById.set(normalizedPlaneId, mergedPlane);
    if (normalizedPlaneId !== mappedPlaneAId) planeById.delete(mappedPlaneAId);
    if (normalizedPlaneId !== mappedPlaneBId) planeById.delete(mappedPlaneBId);
    groupMembers.delete(mappedPlaneAId);
    groupMembers.delete(mappedPlaneBId);
    groupMembers.set(normalizedPlaneId, mergedMembers);
    for (const rawPlaneId of mergedMembers) {
      remappedPlaneIds.set(rawPlaneId, normalizedPlaneId);
      mergedRawPlaneIds.add(rawPlaneId);
    }
    merges.push({
      normalizedPlaneId,
      rawPlaneIds: Object.freeze([...mergedMembers]),
      continuityEvidenceId: claim.id,
      reasons: Object.freeze([
        "same_wall_category",
        "shared_visible_boundary",
        narrowStripOverride
          ? "two_family_grid_alignment_rejects_narrow_false_split"
          : "compatible_sampled_grid_directions",
        narrowStripOverride
          ? "provider_architectural_break_conflicts_with_projective_grid_evidence"
          : "provider_reported_uninterrupted_tiled_field",
        "no_separating_opening",
        "no_supported_corner_seam",
      ]),
    });
  }

  const claimedPairs = new Set(
    input.continuity.map((claim) => continuityKey(claim.planeIds)),
  );
  const rawWalls = input.planes.filter((plane) => plane.category === "wall");
  for (let a = 0; a < rawWalls.length; a += 1) {
    for (let b = a + 1; b < rawWalls.length; b += 1) {
      const pair = [rawWalls[a].id, rawWalls[b].id];
      if (
        !claimedPairs.has(continuityKey(pair)) &&
        farthestPair(
          contactPoints(rawWalls[a].imagePolygon, rawWalls[b].imagePolygon),
        )
      ) {
        unresolved.push({
          kind: "plane_continuity",
          rawIds: pair,
          reason: "neighboring_wall_pair_has_no_provider_continuity_assessment",
        });
      }
    }
  }

  const seenGridAxes = new Set<string>();
  const gridFamilies: ObservedGridFamily[] = [];
  for (
    const family of [...input.gridFamilies].sort((a, b) =>
      b.confidence - a.confidence
    )
  ) {
    const planeId = remappedPlaneIds.get(family.planeId);
    if (!planeId || !planeById.has(planeId)) {
      rejected.push({
        kind: "grid_family",
        rawId: family.id,
        reason: "grid_family_lost_plane_binding",
      });
      continue;
    }
    const axisKey = `${planeId}:${family.axis}`;
    if (family.axis !== "unresolved" && seenGridAxes.has(axisKey)) {
      const existingIndex = gridFamilies.findIndex((candidate) =>
        candidate.planeId === planeId && candidate.axis === family.axis
      );
      if (mergedRawPlaneIds.has(family.planeId) && existingIndex >= 0) {
        const existing = gridFamilies[existingIndex];
        gridFamilies[existingIndex] = Object.freeze({
          ...existing,
          lineSegments: Object.freeze(
            [...existing.lineSegments, ...family.lineSegments].slice(0, 64),
          ),
          confidence: Math.min(existing.confidence, family.confidence),
        });
        continue;
      }
      rejected.push({
        kind: "grid_family",
        rawId: family.id,
        reason: "duplicate_principal_axis_for_plane",
      });
      continue;
    }
    const countForPlane = gridFamilies.filter((candidate) =>
      candidate.planeId === planeId
    ).length;
    if (countForPlane >= 2) {
      rejected.push({
        kind: "grid_family",
        rawId: family.id,
        reason: "more_than_two_principal_grid_families",
      });
      continue;
    }
    seenGridAxes.add(axisKey);
    gridFamilies.push(Object.freeze({ ...family, planeId }));
  }

  const openings = input.openings.map((opening) =>
    Object.freeze({
      ...opening,
      hostPlaneId: opening.hostPlaneId === null
        ? null
        : remappedPlaneIds.get(opening.hostPlaneId) ?? null,
    })
  );

  const seams: ObservedSeam[] = [];
  for (const seam of input.seams) {
    const planeIds = [...new Set(
      seam.planeIds.map((planeId) => remappedPlaneIds.get(planeId))
        .filter((planeId): planeId is string => Boolean(planeId)),
    )];
    const normalizedSeam = Object.freeze({ ...seam, planeIds });
    if (planeIds.length === 0 || (seam.planeIds.length > 1 && planeIds.length < 2)) {
      rejected.push({
        kind: "seam",
        rawId: seam.id,
        reason: "seam_collapsed_or_lost_plane_binding_after_normalization",
      });
      continue;
    }
    if (!categoriesSupportSeam(normalizedSeam, planeById)) {
      rejected.push({
        kind: "seam",
        rawId: seam.id,
        reason: "seam_category_does_not_match_referenced_planes",
      });
      continue;
    }
    if (polylineCrossesOpening(seam.imagePolyline, openings)) {
      rejected.push({
        kind: "seam",
        rawId: seam.id,
        reason: "seam_polyline_crosses_visible_opening",
      });
      continue;
    }
    if (
      seam.category === "wall_wall" &&
      seam.boundaryEvidence !== "legacy_unstructured" &&
      seam.boundaryEvidence !== "projective_discontinuity" &&
      seam.boundaryEvidence !== "architectural_break"
    ) {
      rejected.push({
        kind: "seam",
        rawId: seam.id,
        reason: seam.boundaryEvidence === "uninterrupted_tiled_field"
          ? "continuous_tiled_field_rejects_provider_wall_wall_seam"
          : "wall_wall_seam_lacks_projective_or_architectural_support",
      });
      unresolved.push({
        kind: "seam_support",
        rawIds: [seam.id, ...seam.planeIds],
        reason: "provider_wall_wall_boundary_not_accepted_as_a_true_corner",
      });
      continue;
    }
    seams.push(normalizedSeam);
  }

  for (const claim of input.continuity) {
    const normalizedClaimPlaneIds = claim.planeIds.map((planeId) =>
      remappedPlaneIds.get(planeId)
    );
    if (
      claim.assessment === "discontinuous" &&
      normalizedClaimPlaneIds[0] !== normalizedClaimPlaneIds[1] &&
      !seams.some((seam) =>
        seam.category === "wall_wall" &&
        continuityKey(seam.planeIds) === continuityKey(
          normalizedClaimPlaneIds.filter(
            (planeId): planeId is string => Boolean(planeId),
          ),
        )
      )
    ) {
      unresolved.push({
        kind: "plane_continuity",
        rawIds: [claim.id, ...claim.planeIds],
        reason:
          "discontinuous_continuity_claim_has_no_accepted_wall_wall_seam",
      });
    }
  }

  const planes = [...planeById.values()].map((plane) =>
    Object.freeze({
      ...plane,
      gridFamilyIds: Object.freeze(
        gridFamilies.filter((family) => family.planeId === plane.id)
          .map((family) => family.id),
      ),
    })
  );
  for (const plane of planes) {
    if (
      plane.category !== "unknown" &&
      plane.confidence >= 0.7 &&
      plane.gridFamilyIds.length === 0
    ) {
      unresolved.push({
        kind: "grid_evidence",
        rawIds: [plane.id],
        reason: "confident_visible_plane_has_no_accepted_grid_family",
      });
    }
  }
  const adjacency = seams
    .filter((seam) => seam.planeIds.length === 2)
    .map((seam) =>
      Object.freeze({
        id: `adj_${seam.id}`.slice(0, 80),
        planeAId: seam.planeIds[0],
        planeBId: seam.planeIds[1],
        seamId: seam.id,
        confidence: seam.confidence,
        evidenceClass: "conservative_seam_supported_inference" as const,
      })
    );

  return Object.freeze({
    planes: Object.freeze(planes),
    gridFamilies: Object.freeze(gridFamilies),
    seams: Object.freeze(seams),
    openings: Object.freeze(openings),
    adjacency: Object.freeze(adjacency),
    diagnostics: Object.freeze({
      version: AFC_V2_ROOM_OBSERVATION_NORMALIZATION_VERSION,
      rawCounts: Object.freeze({
        planes: input.planes.length,
        gridFamilies: input.gridFamilies.length,
        seams: input.seams.length,
        openings: input.openings.length,
        adjacencySuggestions: input.rawAdjacencyCount,
        continuityClaims: input.continuity.length,
      }),
      normalizedCounts: Object.freeze({
        planes: planes.length,
        gridFamilies: gridFamilies.length,
        seams: seams.length,
        openings: openings.length,
        adjacency: adjacency.length,
      }),
      merges: bounded(merges),
      continuityAssessments: bounded(input.continuity),
      rejectedEvidence: bounded(rejected),
      unresolvedTopology: bounded(unresolved),
    }),
  });
}
