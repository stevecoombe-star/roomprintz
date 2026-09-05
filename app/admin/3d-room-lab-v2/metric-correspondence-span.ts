/**
 * Pure host extraction of one metric-correspondence span.
 *
 * Canonical geometry authority: accepted S4A floor_wall wall-base
 * geometry. ORIGINAL Localization may annotate same-seam ORIGINAL
 * correspondence only. OL cluster length never becomes canonicalLength.
 *
 * Shadow only. No provider call. No live Auto. No Floor/TILED/collision
 * candidate path.
 */

import type { OriginalLocalizedBoundaryCandidate } from "./original-localized-boundary-authority-contract";
import type { RoomBoundaryCandidate } from "./room-boundary-authority-contract";
import {
  ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M,
  ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD,
  ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO,
  ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY,
  ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
  type RoomBoundaryWorldGeometry,
} from "./room-boundary-authority-contract";
import {
  buildMetricCorrespondenceSelection,
  canonicalWorldSpanLength,
  emptyMetricCorrespondenceSelection,
  imageSpanLengthNormalized,
  METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED,
  METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
  type MetricCorrespondenceEndpointClass,
  type MetricCorrespondenceImagePoint,
  type MetricCorrespondenceRejectedAlternative,
  type MetricCorrespondenceRejectionReason,
  type MetricCorrespondenceSelection,
  type MetricCorrespondenceSpan,
  type MetricCorrespondenceSpanRole,
  type MetricSpanCorrespondenceSource,
  type MetricCorrespondenceWorldXz,
} from "./metric-correspondence-span-contract";

export type MetricCorrespondenceCameraPose = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>;
  lookAt: Readonly<{ x: number; y: number; z: number }>;
}>;

export type MetricCorrespondenceSelectionInput = Readonly<{
  roomBoundary: {
    readonly candidates: readonly RoomBoundaryCandidate[];
    readonly lineage?: {
      readonly camera?: {
        readonly pose?: MetricCorrespondenceCameraPose;
      };
    };
  } | null | undefined;
  registration: {
    readonly registrationClass: string;
  } | null | undefined;
  originalLocalizedBoundary: {
    readonly candidates: readonly OriginalLocalizedBoundaryCandidate[];
    readonly camera?: {
      readonly pose?: MetricCorrespondenceCameraPose;
    };
    readonly lineage?: {
      readonly originalLocalizationClass?: string | null;
    };
  } | null | undefined;
  originalLocalizationClass?: string | null;
}>;

type RankedEligible = Readonly<{
  span: MetricCorrespondenceSpan;
  residualRank: number;
}>;

const ROLE_RANK: Readonly<Record<MetricCorrespondenceSpanRole, number>> = {
  back_floor_wall: 0,
  left_floor_wall: 1,
  right_floor_wall: 1,
  other_floor_wall: 2,
};

function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function pointIsFrameAdjacent(
  point: MetricCorrespondenceImagePoint,
): boolean {
  return Math.min(point.x, 1 - point.x, point.y, 1 - point.y) <=
    ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY;
}

function identityRegistrationCertified(
  registrationClass: string | null,
): boolean {
  return registrationClass === "exact_grid_registered" ||
    registrationClass === "certified_rescaled_registered";
}

function originalLocalizationCertified(
  localizationClass: string | null,
): boolean {
  return localizationClass === "certified_original_localized";
}

function reject(
  id: string,
  role: MetricCorrespondenceSpanRole | "unknown",
  reason: MetricCorrespondenceRejectionReason,
): MetricCorrespondenceRejectedAlternative {
  return Object.freeze({ id, role, reason });
}

function truncationFromEndpoints(
  endpointAClass: MetricCorrespondenceEndpointClass,
  endpointBClass: MetricCorrespondenceEndpointClass,
): "none" | "one_end" | "both_ends" {
  const a = endpointAClass === "frame_adjacent";
  const b = endpointBClass === "frame_adjacent";
  if (a && b) return "both_ends";
  if (a || b) return "one_end";
  return "none";
}

function classifyObservedEndpoint(
  point: MetricCorrespondenceImagePoint,
  hostFrameAdjacent: boolean,
): MetricCorrespondenceEndpointClass {
  if (hostFrameAdjacent || pointIsFrameAdjacent(point)) {
    return "frame_adjacent";
  }
  return "observed_interior";
}

function orderWorldToImage(
  imageAWorld: MetricCorrespondenceWorldXz | null,
  worldA: MetricCorrespondenceWorldXz,
  worldB: MetricCorrespondenceWorldXz,
): readonly [MetricCorrespondenceWorldXz, MetricCorrespondenceWorldXz] {
  if (!imageAWorld) return [worldA, worldB];
  const toA = Math.hypot(imageAWorld.x - worldA.x, imageAWorld.z - worldA.z);
  const toB = Math.hypot(imageAWorld.x - worldB.x, imageAWorld.z - worldB.z);
  return toB < toA ? [worldB, worldA] : [worldA, worldB];
}

/**
 * Camera-relative back/side from canonical XZ geometry. Camera at typical
 * +Z looking toward the origin has +X as view-right, so negative mean X
 * is left. Farther along the look vector is the back wall.
 *
 * Missing or vertical-only look → other_floor_wall. No TILED/room constants.
 */
export function deriveMetricCorrespondenceSpanRole(
  geometry: RoomBoundaryWorldGeometry,
  cameraPose: MetricCorrespondenceCameraPose | null | undefined,
): MetricCorrespondenceSpanRole {
  const tangentLength = Math.hypot(geometry.tangent.x, geometry.tangent.z);
  if (!finiteNumber(tangentLength) || tangentLength <= 1e-12) {
    return "other_floor_wall";
  }
  const tangent = {
    x: geometry.tangent.x / tangentLength,
    z: geometry.tangent.z / tangentLength,
  };
  const meanX = (geometry.baseStart.x + geometry.baseEnd.x) / 2;
  const meanZ = (geometry.baseStart.z + geometry.baseEnd.z) / 2;
  if (!cameraPose) return "other_floor_wall";

  const lookX = cameraPose.lookAt.x - cameraPose.position.x;
  const lookZ = cameraPose.lookAt.z - cameraPose.position.z;
  const lookLength = Math.hypot(lookX, lookZ);
  if (!finiteNumber(lookLength) || lookLength <= 1e-12) {
    return "other_floor_wall";
  }
  const look = { x: lookX / lookLength, z: lookZ / lookLength };
  const right = { x: -look.z, z: look.x };
  const absAlongLook = Math.abs(tangent.x * look.x + tangent.z * look.z);
  const absAlongRight = Math.abs(tangent.x * right.x + tangent.z * right.z);
  const fromCameraX = meanX - cameraPose.position.x;
  const fromCameraZ = meanZ - cameraPose.position.z;
  const side = fromCameraX * right.x + fromCameraZ * right.z;

  if (absAlongRight >= absAlongLook) {
    return "back_floor_wall";
  }
  if (side < 0) return "left_floor_wall";
  if (side > 0) return "right_floor_wall";
  return "other_floor_wall";
}

function competingSameWall(
  first: RoomBoundaryWorldGeometry,
  second: RoomBoundaryWorldGeometry,
): boolean {
  const firstLength = Math.hypot(first.tangent.x, first.tangent.z);
  const secondLength = Math.hypot(second.tangent.x, second.tangent.z);
  if (firstLength <= 1e-12 || secondLength <= 1e-12) return false;
  const firstTangent = {
    x: first.tangent.x / firstLength,
    z: first.tangent.z / firstLength,
  };
  const secondTangent = {
    x: second.tangent.x / secondLength,
    z: second.tangent.z / secondLength,
  };
  const absDot = Math.min(
    1,
    Math.abs(
      firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z,
    ),
  );
  const orientation = Math.acos(absDot);
  if (orientation > ROOM_BOUNDARY_COMPETING_MAX_ORIENTATION_RAD) return false;

  const lateral = Math.max(
    pointToInfiniteXzLineDistance(first.baseStart, second),
    pointToInfiniteXzLineDistance(first.baseEnd, second),
    pointToInfiniteXzLineDistance(second.baseStart, first),
    pointToInfiniteXzLineDistance(second.baseEnd, first),
  );
  if (lateral > ROOM_BOUNDARY_COMPETING_MAX_LATERAL_OFFSET_M) return false;

  const aligned =
    firstTangent.x * secondTangent.x + firstTangent.z * secondTangent.z >= 0;
  const axis = {
    x: firstTangent.x + (aligned ? secondTangent.x : -secondTangent.x),
    z: firstTangent.z + (aligned ? secondTangent.z : -secondTangent.z),
  };
  const axisLength = Math.hypot(axis.x, axis.z);
  if (axisLength <= 1e-12) return false;
  const unit = { x: axis.x / axisLength, z: axis.z / axisLength };
  const firstA = first.baseStart.x * unit.x + first.baseStart.z * unit.z;
  const firstB = first.baseEnd.x * unit.x + first.baseEnd.z * unit.z;
  const secondA = second.baseStart.x * unit.x + second.baseStart.z * unit.z;
  const secondB = second.baseEnd.x * unit.x + second.baseEnd.z * unit.z;
  const overlap = intervalOverlap(firstA, firstB, secondA, secondB);
  const minSpan = Math.min(Math.abs(firstB - firstA), Math.abs(secondB - secondA));
  if (minSpan <= 1e-12) return false;
  return overlap / minSpan >= ROOM_BOUNDARY_COMPETING_MIN_SPAN_OVERLAP_RATIO;
}

function pointToInfiniteXzLineDistance(
  point: Readonly<{ x: number; z: number }>,
  geometry: RoomBoundaryWorldGeometry,
): number {
  const length = Math.hypot(geometry.tangent.x, geometry.tangent.z);
  if (length <= 1e-12) return Number.POSITIVE_INFINITY;
  const unit = { x: geometry.tangent.x / length, z: geometry.tangent.z / length };
  return Math.abs(
    (point.x - geometry.baseStart.x) * unit.z -
      (point.z - geometry.baseStart.z) * unit.x,
  );
}

function intervalOverlap(a0: number, a1: number, b0: number, b1: number): number {
  const left = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const right = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, right - left);
}

function s4aOriginalEndpoints(
  candidate: RoomBoundaryCandidate,
): {
  imageA: MetricCorrespondenceImagePoint;
  imageB: MetricCorrespondenceImagePoint;
  worldA: MetricCorrespondenceWorldXz;
  worldB: MetricCorrespondenceWorldXz;
} | null {
  const points = candidate.projection.points;
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first?.ok || !last?.ok) return null;
  const imageA = first.originalSourceNormalized;
  const imageB = last.originalSourceNormalized;
  if (
    !finiteNumber(imageA.x) || !finiteNumber(imageA.y) ||
    !finiteNumber(imageB.x) || !finiteNumber(imageB.y)
  ) {
    return null;
  }
  return {
    imageA: Object.freeze({ x: imageA.x, y: imageA.y }),
    imageB: Object.freeze({ x: imageB.x, y: imageB.y }),
    worldA: Object.freeze({ x: first.world.x, z: first.world.z }),
    worldB: Object.freeze({ x: last.world.x, z: last.world.z }),
  };
}

function freezeSpan(span: MetricCorrespondenceSpan): MetricCorrespondenceSpan {
  return Object.freeze({
    ...span,
    imageA: Object.freeze({ ...span.imageA }),
    imageB: Object.freeze({ ...span.imageB }),
    canonicalWorldA: Object.freeze({ ...span.canonicalWorldA }),
    canonicalWorldB: Object.freeze({ ...span.canonicalWorldB }),
    selectionReasons: Object.freeze([...span.selectionReasons]),
    lineage: Object.freeze({ ...span.lineage }),
  });
}

function residualRank(
  lineResidualClass: "supported" | "underdetermined" | null,
): number {
  return lineResidualClass === "supported" ? 0 : 1;
}

function compareEligible(left: RankedEligible, right: RankedEligible): number {
  const role = ROLE_RANK[left.span.role] - ROLE_RANK[right.span.role];
  if (role !== 0) return role;
  const confidence = right.span.confidence - left.span.confidence;
  if (confidence !== 0) return confidence;
  const residual = left.residualRank - right.residualRank;
  if (residual !== 0) return residual;
  const image = right.span.imageLengthNormalized - left.span.imageLengthNormalized;
  if (image !== 0) return image;
  const id = left.span.id.localeCompare(right.span.id);
  if (id !== 0) return id;
  return (left.span.lineage.sourceSeamId ?? "").localeCompare(
    right.span.lineage.sourceSeamId ?? "",
  );
}

function evaluateS4aCandidate(input: {
  candidate: RoomBoundaryCandidate;
  cameraPose: MetricCorrespondenceCameraPose | null;
  identityCertified: boolean;
  registrationClass: string | null;
}):
  | { ok: true; eligible: RankedEligible }
  | { ok: false; rejected: MetricCorrespondenceRejectedAlternative }
{
  const candidate = input.candidate;
  const roleGuess = candidate.worldGeometry
    ? deriveMetricCorrespondenceSpanRole(candidate.worldGeometry, input.cameraPose)
    : "unknown";

  if (candidate.source.category !== "floor_wall") {
    return { ok: false, rejected: reject(candidate.id, roleGuess, "not_floor_wall") };
  }
  if (candidate.status === "ambiguous" &&
      candidate.reasons.includes("competing_same_wall_trace")) {
    return {
      ok: false,
      rejected: reject(candidate.id, roleGuess, "ambiguous_competing_trace"),
    };
  }
  if (candidate.status !== "accepted") {
    return { ok: false, rejected: reject(candidate.id, roleGuess, "not_accepted") };
  }
  if (!candidate.worldGeometry) {
    return {
      ok: false,
      rejected: reject(candidate.id, roleGuess, "missing_world_geometry"),
    };
  }
  if (
    candidate.limitations.hiddenContinuation ||
    candidate.limitations.geometryManufactured ||
    candidate.limitations.completeWall
  ) {
    return { ok: false, rejected: reject(candidate.id, roleGuess, "other") };
  }
  const endpoints = s4aOriginalEndpoints(candidate);
  if (!endpoints) {
    return {
      ok: false,
      rejected: reject(candidate.id, roleGuess, "missing_world_geometry"),
    };
  }
  const hostFrameAdjacent = candidate.limitations.frameAdjacentEndpoint;
  const endpointAClass = classifyObservedEndpoint(
    endpoints.imageA,
    hostFrameAdjacent,
  );
  const endpointBClass = classifyObservedEndpoint(
    endpoints.imageB,
    hostFrameAdjacent,
  );
  if (
    endpointAClass === "inferred" ||
    endpointBClass === "inferred"
  ) {
    return { ok: false, rejected: reject(candidate.id, roleGuess, "other") };
  }
  const truncation = truncationFromEndpoints(endpointAClass, endpointBClass);
  if (truncation !== "none" || hostFrameAdjacent) {
    return { ok: false, rejected: reject(candidate.id, roleGuess, "frame_truncated") };
  }

  const [canonicalWorldA, canonicalWorldB] = orderWorldToImage(
    endpoints.worldA,
    {
      x: candidate.worldGeometry.baseStart.x,
      z: candidate.worldGeometry.baseStart.z,
    },
    {
      x: candidate.worldGeometry.baseEnd.x,
      z: candidate.worldGeometry.baseEnd.z,
    },
  );
  const canonicalLength = canonicalWorldSpanLength(
    canonicalWorldA,
    canonicalWorldB,
  );
  if (
    !finiteNumber(canonicalLength) ||
    canonicalLength < ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M
  ) {
    return { ok: false, rejected: reject(candidate.id, roleGuess, "degenerate") };
  }
  const imageLength = imageSpanLengthNormalized(endpoints.imageA, endpoints.imageB);
  if (
    !finiteNumber(imageLength) ||
    imageLength < METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED
  ) {
    return {
      ok: false,
      rejected: reject(candidate.id, roleGuess, "too_short_in_image"),
    };
  }

  const role = deriveMetricCorrespondenceSpanRole(
    candidate.worldGeometry,
    input.cameraPose,
  );
  const overlaySafeOnOriginal = input.identityCertified;
  const correspondenceSource: MetricSpanCorrespondenceSource = overlaySafeOnOriginal
    ? "identity_uv"
    : "none";
  const spanTrust = overlaySafeOnOriginal ? "trusted" : "candidate";
  const span = freezeSpan({
    id: candidate.id,
    source: "s4a_floor_wall",
    correspondenceSource,
    spanTrust,
    role,
    imageSpace: METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
    overlaySafeOnOriginal,
    imageA: endpoints.imageA,
    imageB: endpoints.imageB,
    canonicalWorldA,
    canonicalWorldB,
    canonicalLength,
    endpointAClass,
    endpointBClass,
    truncation: "none",
    imageLengthNormalized: imageLength,
    confidence: candidate.source.confidence,
    selectionReasons: Object.freeze([
      "accepted_s4a_floor_wall",
      overlaySafeOnOriginal
        ? "identity_certified_original_overlay"
        : "candidate_uncertified_correspondence",
      `role_${role}`,
    ]),
    lineage: {
      s4aCandidateId: candidate.id,
      sourceSeamId: candidate.sourceSeamId,
      registrationClass: input.registrationClass,
      olCandidateId: null,
    },
  });
  return {
    ok: true,
    eligible: {
      span,
      residualRank: residualRank(candidate.imageEvidence.lineResidualClass),
    },
  };
}

/**
 * Same-seam ORIGINAL correspondence evidence only. Never supplies
 * canonical world endpoints, canonicalLength, or overlay-safe mapping.
 * Cluster endpoints are interior samples, not the S4A wall gauge.
 */
function sameSeamOlCorrespondence(
  span: MetricCorrespondenceSpan,
  olCandidates: readonly OriginalLocalizedBoundaryCandidate[],
  olCertified: boolean,
  cameraPose: MetricCorrespondenceCameraPose | null,
): OriginalLocalizedBoundaryCandidate | null {
  if (!olCertified) return null;
  const seamId = span.lineage.sourceSeamId;
  if (!seamId) return null;
  const matches: OriginalLocalizedBoundaryCandidate[] = [];
  for (const candidate of olCandidates) {
    if (candidate.sourceObservationSeamId !== seamId) continue;
    if (candidate.status !== "accepted") continue;
    if (!candidate.worldGeometry) continue;
    if (
      candidate.limitations.hiddenContinuation ||
      candidate.limitations.geometryManufactured
    ) {
      continue;
    }
    const role = deriveMetricCorrespondenceSpanRole(
      candidate.worldGeometry,
      cameraPose,
    );
    if (role !== span.role) continue;
    matches.push(candidate);
  }
  matches.sort((left, right) => left.id.localeCompare(right.id));
  return matches[0] ?? null;
}

function annotateUntrustedCorrespondence(
  span: MetricCorrespondenceSpan,
  olCandidate: OriginalLocalizedBoundaryCandidate | null,
): MetricCorrespondenceSpan {
  if (span.overlaySafeOnOriginal || span.spanTrust === "trusted") {
    return span;
  }
  if (!olCandidate) return span;
  return freezeSpan({
    ...span,
    correspondenceSource: "original_localization",
    selectionReasons: Object.freeze([
      ...span.selectionReasons,
      "ol_same_seam_correspondence_incomplete",
    ]),
    lineage: {
      ...span.lineage,
      olCandidateId: olCandidate.id,
    },
  });
}

function selectUnchecked(
  input: MetricCorrespondenceSelectionInput,
): MetricCorrespondenceSelection {
  const s4aCandidates = input.roomBoundary?.candidates ?? [];
  const olCandidates = input.originalLocalizedBoundary?.candidates ?? [];
  const registrationClass = input.registration?.registrationClass ?? null;
  const localizationClass = input.originalLocalizationClass ??
    input.originalLocalizedBoundary?.lineage?.originalLocalizationClass ??
    null;
  const identityCertified = identityRegistrationCertified(registrationClass);
  const olCertified = originalLocalizationCertified(localizationClass);
  const cameraPose = input.roomBoundary?.lineage?.camera?.pose ??
    input.originalLocalizedBoundary?.camera?.pose ??
    null;

  const rejected: MetricCorrespondenceRejectedAlternative[] = [];
  const eligible: RankedEligible[] = [];

  for (const candidate of s4aCandidates) {
    const result = evaluateS4aCandidate({
      candidate,
      cameraPose,
      identityCertified,
      registrationClass,
    });
    if (result.ok) {
      eligible.push(result.eligible);
    } else {
      rejected.push(result.rejected);
    }
  }

  for (let index = 0; index < eligible.length; index += 1) {
    const item = eligible[index]!;
    const ol = sameSeamOlCorrespondence(
      item.span,
      olCandidates,
      olCertified,
      cameraPose,
    );
    eligible[index] = {
      ...item,
      span: annotateUntrustedCorrespondence(item.span, ol),
    };
  }

  const competingIds = new Set<string>();
  for (let first = 0; first < eligible.length; first += 1) {
    for (let second = first + 1; second < eligible.length; second += 1) {
      const left = eligible[first]!.span;
      const right = eligible[second]!.span;
      const leftGeometry = worldGeometryFromSpan(left);
      const rightGeometry = worldGeometryFromSpan(right);
      if (leftGeometry && rightGeometry && competingSameWall(leftGeometry, rightGeometry)) {
        competingIds.add(left.id);
        competingIds.add(right.id);
      }
    }
  }
  const remaining: RankedEligible[] = [];
  for (const item of eligible) {
    if (competingIds.has(item.span.id)) {
      rejected.push(reject(item.span.id, item.span.role, "ambiguous_competing_trace"));
    } else {
      remaining.push(item);
    }
  }

  remaining.sort(compareEligible);
  const selected = remaining[0]?.span ?? null;
  if (!selected) {
    return buildMetricCorrespondenceSelection(
      null,
      rejected,
      s4aCandidates.length === 0
        ? ["no_s4a_floor_wall_candidates"]
        : ["no_eligible_finite_span"],
    );
  }
  return buildMetricCorrespondenceSelection(
    selected,
    rejected,
    Object.freeze([
      ...selected.selectionReasons,
      "ranked_best_eligible",
    ]),
  );
}

function worldGeometryFromSpan(
  span: MetricCorrespondenceSpan,
): RoomBoundaryWorldGeometry | null {
  const dx = span.canonicalWorldB.x - span.canonicalWorldA.x;
  const dz = span.canonicalWorldB.z - span.canonicalWorldA.z;
  const length = Math.hypot(dx, dz);
  if (!finiteNumber(length) || length <= 1e-12) return null;
  return {
    baseStart: { x: span.canonicalWorldA.x, y: 0, z: span.canonicalWorldA.z },
    baseEnd: { x: span.canonicalWorldB.x, y: 0, z: span.canonicalWorldB.z },
    tangent: { x: dx / length, y: 0, z: dz / length },
    supportPlaneNormal: { x: -dz / length, y: 0, z: dx / length },
    supportPlaneConstant: 0,
  };
}

/**
 * Fail-closed. Extraction errors become no_eligible_finite_span.
 * Never throws into Analyze / Apply.
 */
export function selectMetricCorrespondenceSpan(
  input: MetricCorrespondenceSelectionInput,
): MetricCorrespondenceSelection {
  try {
    return selectUnchecked(input);
  } catch {
    return emptyMetricCorrespondenceSelection(["extraction_failed_closed"]);
  }
}
