import "server-only";

import type {
  EmptyObservedJunction,
  EmptyObservedSeam,
  EmptyRoomObservationAcceptedEvidence,
  EmptyRoomObservationEvidence,
  FocusedSideCeilingWallMergeReceipt,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import type {
  FocusedSideCeilingWallEvidence,
  FocusedSideCeilingWallSeam,
} from "./empty-side-ceiling-wall-observation-contract";

const MAX_SEAMS = 48;
const DUPLICATE_THRESHOLD = 0.045;
const VERTICAL_DIRECTION_RATIO = 0.22;
const HORIZONTAL_DIRECTION_RATIO = 0.22;
const SAME_RUN_DIRECTION_AGREEMENT = 0.9;
const SAME_RUN_OVERLAP = 0.5;
const PELMET_DIRECTION_AGREEMENT = 0.85;
const PELMET_OVERLAP = 0.4;
const PELMET_MIN_MEAN_DY = 0.028;
const PELMET_MAX_MEAN_DY = 0.22;
const JUNCTION_ON_SEAM = 0.032;
const JUNCTION_BELOW_ENDPOINT_MIN = 0.04;
const JUNCTION_BELOW_ENDPOINT_MAX = 0.2;

export const MERGE_REASON = {
  focusedDuplicateKeepGeneral:
    "focused_duplicate_suppressed:same_run_keep_general",
  generalDuplicateKeepFocused:
    "general_duplicate_suppressed:same_run_keep_focused",
  focusedRejectedWallWall: "focused_rejected:wall_wall_substitution",
  focusedRejectedPelmet:
    "focused_rejected:lower_interior_edge_below_ceiling_envelope",
  generalSuppressedPelmet:
    "general_suppressed:lower_interior_edge_below_ceiling_envelope",
  focusedSkippedAmbiguousSameRun:
    "focused_duplicate_suppressed:ambiguous_multiple_same_run_matches",
  focusedSkippedFocusedDuplicate:
    "focused_duplicate_suppressed:same_run_existing_focused",
  junctionOmittedSuppressedSeam:
    "junction_omitted:attached_to_suppressed_interior_edge",
  junctionOmittedBelowEnvelope:
    "junction_omitted:below_ceiling_envelope_not_on_seam",
  focusedClippedMaxSeams: "focused_rejected:max_seams",
} as const;

function distance(a: SourceNormalizedPoint, b: SourceNormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestPointOnSegment(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): SourceNormalizedPoint {
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  const span = spanX * spanX + spanY * spanY;
  if (span === 0) return start;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * spanX + (point.y - start.y) * spanY) / span),
  );
  return { x: start.x + spanX * t, y: start.y + spanY * t };
}

function nearestPointOnPolyline(
  point: SourceNormalizedPoint,
  line: readonly SourceNormalizedPoint[],
): SourceNormalizedPoint {
  let nearest = line[0];
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const candidate = nearestPointOnSegment(point, line[index - 1], line[index]);
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < minimum) {
      minimum = candidateDistance;
      nearest = candidate;
    }
  }
  return nearest;
}

function pointToSegmentDistance(
  point: SourceNormalizedPoint,
  start: SourceNormalizedPoint,
  end: SourceNormalizedPoint,
): number {
  return distance(point, nearestPointOnSegment(point, start, end));
}

function pointToPolylineDistance(
  point: SourceNormalizedPoint,
  line: readonly SourceNormalizedPoint[],
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    minimum = Math.min(
      minimum,
      pointToSegmentDistance(point, line[index - 1], line[index]),
    );
  }
  return minimum;
}

function meanPointToPolylineDistance(
  points: readonly SourceNormalizedPoint[],
  line: readonly SourceNormalizedPoint[],
): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  return points.reduce(
    (sum, point) => sum + pointToPolylineDistance(point, line),
    0,
  ) / points.length;
}

function polylineLength(line: readonly SourceNormalizedPoint[]): number {
  let length = 0;
  for (let index = 1; index < line.length; index += 1) {
    length += distance(line[index - 1], line[index]);
  }
  return length;
}

function meanY(line: readonly SourceNormalizedPoint[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  return line.reduce((sum, point) => sum + point.y, 0) / line.length;
}

function unitDirection(
  line: readonly SourceNormalizedPoint[],
): SourceNormalizedPoint | null {
  if (line.length < 2) return null;
  const start = line[0];
  const end = line[line.length - 1];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 1e-9) return null;
  return { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
}

function directionAgreement(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): number {
  const firstDir = unitDirection(first);
  const secondDir = unitDirection(second);
  if (!firstDir || !secondDir) return 0;
  return Math.abs(firstDir.x * secondDir.x + firstDir.y * secondDir.y);
}

function midpointX(line: readonly SourceNormalizedPoint[]): number {
  if (line.length === 0) return 0.5;
  return (line[0].x + line[line.length - 1].x) / 2;
}

function imageSide(
  line: readonly SourceNormalizedPoint[],
): "left" | "right" | "center" {
  const x = midpointX(line);
  if (x <= 0.4) return "left";
  if (x >= 0.6) return "right";
  return "center";
}

function isCenterRun(line: readonly SourceNormalizedPoint[]): boolean {
  return imageSide(line) === "center";
}

function sameSide(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): boolean {
  const firstSide = imageSide(first);
  const secondSide = imageSide(second);
  return firstSide !== "center" && firstSide === secondSide;
}

function overlapAlongRun(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): number {
  const longer = polylineLength(first) >= polylineLength(second) ? first : second;
  const direction = unitDirection(longer);
  if (!direction) return 0;
  const origin = longer[0];
  const project = (line: readonly SourceNormalizedPoint[]) => {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const point of line) {
      const scalar =
        (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;
      minimum = Math.min(minimum, scalar);
      maximum = Math.max(maximum, scalar);
    }
    return { min: minimum, max: maximum, span: Math.max(0, maximum - minimum) };
  };
  const firstRange = project(first);
  const secondRange = project(second);
  const overlap = Math.max(
    0,
    Math.min(firstRange.max, secondRange.max) -
      Math.max(firstRange.min, secondRange.min),
  );
  const minSpan = Math.min(firstRange.span, secondRange.span);
  if (minSpan < 1e-6) return 0;
  return overlap / minSpan;
}

function backEndpoint(
  line: readonly SourceNormalizedPoint[],
): SourceNormalizedPoint {
  const start = line[0];
  const end = line[line.length - 1];
  return Math.abs(start.x - 0.5) <= Math.abs(end.x - 0.5) ? start : end;
}

function coveredBy(
  points: readonly SourceNormalizedPoint[],
  line: readonly SourceNormalizedPoint[],
  threshold = DUPLICATE_THRESHOLD,
): boolean {
  return points.length >= 2 &&
    points.every((point) => pointToPolylineDistance(point, line) <= threshold);
}

function polylinesAreNearDuplicate(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): boolean {
  if (first.length < 2 || second.length < 2) return false;
  const meanFirst = meanPointToPolylineDistance(first, second);
  const meanSecond = meanPointToPolylineDistance(second, first);
  const firstEnds = Math.max(
    pointToPolylineDistance(first[0], second),
    pointToPolylineDistance(first[first.length - 1], second),
  );
  const secondEnds = Math.max(
    pointToPolylineDistance(second[0], first),
    pointToPolylineDistance(second[second.length - 1], first),
  );
  return meanFirst <= DUPLICATE_THRESHOLD &&
    meanSecond <= DUPLICATE_THRESHOLD &&
    firstEnds <= DUPLICATE_THRESHOLD * 1.5 &&
    secondEnds <= DUPLICATE_THRESHOLD * 1.5;
}

function areClearlySameRun(
  first: readonly SourceNormalizedPoint[],
  second: readonly SourceNormalizedPoint[],
): boolean {
  if (first.length < 2 || second.length < 2) return false;
  if (!sameSide(first, second)) return false;
  const agreement = directionAgreement(first, second);
  if (agreement < SAME_RUN_DIRECTION_AGREEMENT) return false;
  const overlap = overlapAlongRun(first, second);
  if (overlap < SAME_RUN_OVERLAP) return false;
  const meanFirst = meanPointToPolylineDistance(first, second);
  const meanSecond = meanPointToPolylineDistance(second, first);
  const maxMean = Math.max(meanFirst, meanSecond);
  const minMean = Math.min(meanFirst, meanSecond);
  const firstEnds = Math.max(
    pointToPolylineDistance(first[0], second),
    pointToPolylineDistance(first[first.length - 1], second),
  );
  const secondEnds = Math.max(
    pointToPolylineDistance(second[0], first),
    pointToPolylineDistance(second[second.length - 1], first),
  );
  const firstCovered = coveredBy(first, second, 0.05);
  const secondCovered = coveredBy(second, first, 0.05);
  const backDistance = distance(backEndpoint(first), backEndpoint(second));
  if (
    meanFirst <= 0.055 &&
    meanSecond <= 0.055 &&
    firstEnds <= 0.085 &&
    secondEnds <= 0.085
  ) {
    return true;
  }
  if ((firstCovered || secondCovered) && minMean <= 0.045 && overlap >= 0.55) {
    return true;
  }
  if (maxMean <= 0.07 && backDistance <= 0.06 && overlap >= 0.55) {
    return true;
  }
  if (overlap >= 0.7 && agreement >= 0.94 && maxMean <= 0.08) {
    return true;
  }
  return false;
}

function isNearlyVertical(line: readonly SourceNormalizedPoint[]): boolean {
  if (line.length < 2) return false;
  const start = line[0];
  const end = line[line.length - 1];
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const length = Math.hypot(dx, dy);
  return length > 0 && dx / length < VERTICAL_DIRECTION_RATIO;
}

function isNearlyHorizontal(line: readonly SourceNormalizedPoint[]): boolean {
  if (line.length < 2) return false;
  const start = line[0];
  const end = line[line.length - 1];
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const length = Math.hypot(dx, dy);
  return length > 0 && dy / length < HORIZONTAL_DIRECTION_RATIO;
}

function contradictsWallWall(
  candidate: readonly SourceNormalizedPoint[],
  wallWalls: readonly EmptyObservedSeam[],
): boolean {
  if (!isNearlyVertical(candidate)) return false;
  return wallWalls.some((seam) =>
    polylinesAreNearDuplicate(candidate, seam.sourceNormalizedPolyline)
  );
}

function meanVerticalOffsetBelow(
  candidate: readonly SourceNormalizedPoint[],
  envelope: readonly SourceNormalizedPoint[],
): { meanDy: number; fractionBelow: number } {
  if (candidate.length === 0) {
    return { meanDy: Number.POSITIVE_INFINITY, fractionBelow: 0 };
  }
  let sum = 0;
  let below = 0;
  for (const point of candidate) {
    const nearest = nearestPointOnPolyline(point, envelope);
    const dy = point.y - nearest.y;
    sum += dy;
    if (dy >= 0.015) below += 1;
  }
  return {
    meanDy: sum / candidate.length,
    fractionBelow: below / candidate.length,
  };
}

function isLowerInteriorEdgeBelowEnvelope(
  candidate: readonly SourceNormalizedPoint[],
  envelope: readonly SourceNormalizedPoint[],
): boolean {
  if (!sameSide(candidate, envelope)) return false;
  if (directionAgreement(candidate, envelope) < PELMET_DIRECTION_AGREEMENT) {
    return false;
  }
  if (overlapAlongRun(candidate, envelope) < PELMET_OVERLAP) return false;
  if (meanY(envelope) >= 0.48 || meanY(candidate) >= 0.58) return false;
  const { meanDy, fractionBelow } = meanVerticalOffsetBelow(candidate, envelope);
  return meanDy >= PELMET_MIN_MEAN_DY &&
    meanDy <= PELMET_MAX_MEAN_DY &&
    fractionBelow >= 0.75;
}

function chooseSameRunWinner(
  general: readonly SourceNormalizedPoint[],
  focused: readonly SourceNormalizedPoint[],
): "general" | "focused" {
  if (isNearlyVertical(general) && !isNearlyVertical(focused) &&
    !isNearlyHorizontal(focused)
  ) {
    return "focused";
  }
  if (isNearlyVertical(focused) && !isNearlyVertical(general)) {
    return "general";
  }
  const generalSide = imageSide(general);
  if (
    generalSide !== "center" &&
    isNearlyHorizontal(general) &&
    !isNearlyHorizontal(focused) &&
    !isNearlyVertical(focused)
  ) {
    return "focused";
  }
  const generalLength = polylineLength(general);
  const focusedLength = polylineLength(focused);
  const generalCovered = coveredBy(general, focused, 0.05);
  if (
    generalCovered &&
    focusedLength >= generalLength * 1.35 &&
    focusedLength - generalLength >= 0.04
  ) {
    return "focused";
  }
  return "general";
}

function uniqueSeamId(rawId: string, used: Set<string>): string {
  const base = /^[A-Za-z]/.test(rawId) ? rawId : `fscw_${rawId}`;
  const prefixed = base.startsWith("fscw_") ? base.slice(0, 80) : `fscw_${base}`.slice(0, 80);
  if (!used.has(prefixed)) {
    used.add(prefixed);
    return prefixed;
  }
  for (let index = 2; index < 32; index += 1) {
    const candidate = `${prefixed.slice(0, 76)}_${index}`.slice(0, 80);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `fscw_side_${used.size}`.slice(0, 80);
  used.add(fallback);
  return fallback;
}

function toEmptySeam(
  seam: FocusedSideCeilingWallSeam,
  usedIds: Set<string>,
): EmptyObservedSeam {
  return Object.freeze({
    id: uniqueSeamId(seam.id, usedIds),
    category: "wall_ceiling",
    planeIds: [] as const,
    sourceNormalizedPolyline: seam.sourceNormalizedPolyline,
    endpointPolicy: "preserve_observed_open_endpoints",
    confidence: seam.confidence,
    ambiguity: seam.ambiguity,
    evidenceClass: "provider_reported_visible_evidence",
    observationSource: "focused_side_ceiling_wall",
  });
}

function focusedReceipt(args: {
  focused: FocusedSideCeilingWallEvidence | null;
  addedSeamIds?: readonly string[];
  skippedDuplicateSeamIds?: readonly string[];
  rejectedSeamIds?: readonly string[];
  suppressedGeneralSeamIds?: readonly string[];
  skippedJunctionIds?: readonly string[];
  resolutionReasons?: readonly string[];
}): FocusedSideCeilingWallMergeReceipt {
  const addedSeamIds = args.addedSeamIds ?? [];
  const skippedDuplicateSeamIds = args.skippedDuplicateSeamIds ?? [];
  const rejectedSeamIds = args.rejectedSeamIds ?? [];
  const suppressedGeneralSeamIds = args.suppressedGeneralSeamIds ?? [];
  const skippedJunctionIds = args.skippedJunctionIds ?? [];
  const resolutionReasons = args.resolutionReasons ?? [];
  if (!args.focused) {
    return Object.freeze({
      observerStatus: "not_run",
      promptVersion: null,
      emptyIdentitySha256: null,
      addedSeamIds: Object.freeze(addedSeamIds),
      skippedDuplicateSeamIds: Object.freeze(skippedDuplicateSeamIds),
      rejectedSeamIds: Object.freeze(rejectedSeamIds),
      suppressedGeneralSeamIds: Object.freeze(suppressedGeneralSeamIds),
      skippedJunctionIds: Object.freeze(skippedJunctionIds),
      resolutionReasons: Object.freeze(resolutionReasons),
      geometryManufactured: false,
      hiddenContinuationAdded: false,
      failure: null,
    });
  }
  const observerStatus = args.focused.observerStatus === "failed"
    ? "failed" as const
    : args.focused.observedSeams.length === 0
    ? "empty" as const
    : args.focused.observerStatus;
  return Object.freeze({
    observerStatus,
    promptVersion: args.focused.observer.promptVersion,
    emptyIdentitySha256: args.focused.basis.identity.sha256,
    addedSeamIds: Object.freeze(addedSeamIds),
    skippedDuplicateSeamIds: Object.freeze(skippedDuplicateSeamIds),
    rejectedSeamIds: Object.freeze(rejectedSeamIds),
    suppressedGeneralSeamIds: Object.freeze(suppressedGeneralSeamIds),
    skippedJunctionIds: Object.freeze(skippedJunctionIds),
    resolutionReasons: Object.freeze(resolutionReasons),
    geometryManufactured: false,
    hiddenContinuationAdded: false,
    failure: args.focused.failure,
  });
}

type FocusedSideCeilingWallAcceptedEvidenceLike = Extract<
  FocusedSideCeilingWallEvidence,
  { observerStatus: "observed" | "partial" }
>;

function wallCeilingSeams(
  seams: readonly EmptyObservedSeam[],
): EmptyObservedSeam[] {
  return seams.filter((seam) => seam.category === "wall_ceiling");
}

function suppressGeneral(
  keptGeneral: EmptyObservedSeam[],
  usedIds: Set<string>,
  seam: EmptyObservedSeam,
  suppressedGeneralSeams: EmptyObservedSeam[],
  suppressedGeneralSeamIds: string[],
  resolutionReasons: string[],
  reason: string,
) {
  const index = keptGeneral.findIndex((candidate) => candidate.id === seam.id);
  if (index < 0) return;
  keptGeneral.splice(index, 1);
  usedIds.delete(seam.id);
  suppressedGeneralSeams.push(seam);
  suppressedGeneralSeamIds.push(seam.id);
  resolutionReasons.push(reason);
}

function resolveFocusedAgainstGeneral(
  generalSeams: readonly EmptyObservedSeam[],
  focused: FocusedSideCeilingWallAcceptedEvidenceLike,
): {
  keptGeneral: EmptyObservedSeam[];
  added: EmptyObservedSeam[];
  skippedDuplicateSeamIds: string[];
  rejectedSeamIds: string[];
  suppressedGeneralSeamIds: string[];
  suppressedGeneralSeams: EmptyObservedSeam[];
  resolutionReasons: string[];
} {
  const keptGeneral = [...generalSeams];
  const wallWalls = generalSeams.filter((seam) => seam.category === "wall_wall");
  const usedIds = new Set(generalSeams.map((seam) => seam.id));
  const added: EmptyObservedSeam[] = [];
  const skippedDuplicateSeamIds: string[] = [];
  const rejectedSeamIds: string[] = [];
  const suppressedGeneralSeamIds: string[] = [];
  const suppressedGeneralSeams: EmptyObservedSeam[] = [];
  const resolutionReasons: string[] = [];

  for (const seam of focused.observedSeams) {
    const candidate = seam.sourceNormalizedPolyline;
    if (contradictsWallWall(candidate, wallWalls)) {
      rejectedSeamIds.push(seam.id);
      resolutionReasons.push(MERGE_REASON.focusedRejectedWallWall);
      continue;
    }

    const currentWallCeiling = [
      ...wallCeilingSeams(keptGeneral),
      ...added,
    ];
    const envelopeAbove = currentWallCeiling.find((existing) =>
      isLowerInteriorEdgeBelowEnvelope(
        candidate,
        existing.sourceNormalizedPolyline,
      )
    );
    if (envelopeAbove) {
      rejectedSeamIds.push(seam.id);
      resolutionReasons.push(MERGE_REASON.focusedRejectedPelmet);
      continue;
    }

    const lowerGenerals = wallCeilingSeams(keptGeneral).filter((existing) =>
      !isCenterRun(existing.sourceNormalizedPolyline) &&
      isLowerInteriorEdgeBelowEnvelope(
        existing.sourceNormalizedPolyline,
        candidate,
      )
    );
    if (lowerGenerals.length > 0) {
      for (const lower of lowerGenerals) {
        suppressGeneral(
          keptGeneral,
          usedIds,
          lower,
          suppressedGeneralSeams,
          suppressedGeneralSeamIds,
          resolutionReasons,
          MERGE_REASON.generalSuppressedPelmet,
        );
      }
      added.push(toEmptySeam(seam, usedIds));
      continue;
    }

    const currentAfterPelmet = [
      ...wallCeilingSeams(keptGeneral),
      ...added,
    ];
    const centerDuplicate = isCenterRun(candidate) &&
      currentAfterPelmet.some((existing) => {
        const line = existing.sourceNormalizedPolyline;
        if (!isCenterRun(line)) return false;
        const agreement = directionAgreement(candidate, line);
        const overlap = overlapAlongRun(candidate, line);
        const maxMean = Math.max(
          meanPointToPolylineDistance(candidate, line),
          meanPointToPolylineDistance(line, candidate),
        );
        return (
          polylinesAreNearDuplicate(candidate, line) ||
          coveredBy(candidate, line) ||
          (agreement >= 0.92 && overlap >= 0.5 && maxMean <= 0.08)
        );
      });
    if (centerDuplicate) {
      skippedDuplicateSeamIds.push(seam.id);
      resolutionReasons.push(MERGE_REASON.focusedDuplicateKeepGeneral);
      continue;
    }

    const sameRunMatches = currentAfterPelmet.filter((existing) =>
      !isCenterRun(existing.sourceNormalizedPolyline) &&
      areClearlySameRun(candidate, existing.sourceNormalizedPolyline)
    );
    if (sameRunMatches.length > 1) {
      skippedDuplicateSeamIds.push(seam.id);
      resolutionReasons.push(MERGE_REASON.focusedSkippedAmbiguousSameRun);
      continue;
    }
    if (sameRunMatches.length === 1) {
      const match = sameRunMatches[0];
      if (match.observationSource === "focused_side_ceiling_wall") {
        skippedDuplicateSeamIds.push(seam.id);
        resolutionReasons.push(MERGE_REASON.focusedSkippedFocusedDuplicate);
        continue;
      }
      const winner = chooseSameRunWinner(
        match.sourceNormalizedPolyline,
        candidate,
      );
      if (winner === "focused") {
        suppressGeneral(
          keptGeneral,
          usedIds,
          match,
          suppressedGeneralSeams,
          suppressedGeneralSeamIds,
          resolutionReasons,
          MERGE_REASON.generalDuplicateKeepFocused,
        );
        added.push(toEmptySeam(seam, usedIds));
      } else {
        skippedDuplicateSeamIds.push(seam.id);
        resolutionReasons.push(MERGE_REASON.focusedDuplicateKeepGeneral);
      }
      continue;
    }

    const subsetOfExisting = currentAfterPelmet.some((existing) =>
      coveredBy(candidate, existing.sourceNormalizedPolyline) ||
      polylinesAreNearDuplicate(candidate, existing.sourceNormalizedPolyline)
    );
    if (subsetOfExisting) {
      skippedDuplicateSeamIds.push(seam.id);
      resolutionReasons.push(MERGE_REASON.focusedDuplicateKeepGeneral);
      continue;
    }

    added.push(toEmptySeam(seam, usedIds));
  }

  return {
    keptGeneral,
    added,
    skippedDuplicateSeamIds,
    rejectedSeamIds,
    suppressedGeneralSeamIds,
    suppressedGeneralSeams,
    resolutionReasons,
  };
}

function junctionOnSeam(
  junction: EmptyObservedJunction,
  seam: EmptyObservedSeam,
  threshold = JUNCTION_ON_SEAM,
): boolean {
  return pointToPolylineDistance(
    junction.sourceNormalizedPoint,
    seam.sourceNormalizedPolyline,
  ) <= threshold;
}

function junctionBelowEnvelopeEndpoint(
  junction: EmptyObservedJunction,
  envelope: EmptyObservedSeam,
): boolean {
  if (envelope.category !== "wall_ceiling") return false;
  const point = junction.sourceNormalizedPoint;
  if (point.y >= 0.55) return false;
  const line = envelope.sourceNormalizedPolyline;
  const ends = [line[0], line[line.length - 1]];
  return ends.some((end) =>
    Math.abs(end.x - point.x) <= 0.08 &&
    point.y - end.y >= JUNCTION_BELOW_ENDPOINT_MIN &&
    point.y - end.y <= JUNCTION_BELOW_ENDPOINT_MAX &&
    end.y < 0.45
  );
}

function selectJunctions(args: {
  junctions: readonly EmptyObservedJunction[];
  remainingSeams: readonly EmptyObservedSeam[];
  suppressedGeneralSeams: readonly EmptyObservedSeam[];
  resolutionReasons: string[];
}): {
  kept: EmptyObservedJunction[];
  skippedJunctionIds: string[];
} {
  const remainingWallCeiling = wallCeilingSeams(args.remainingSeams);
  const kept: EmptyObservedJunction[] = [];
  const skippedJunctionIds: string[] = [];
  for (const junction of args.junctions) {
    if (
      junction.openingIds.length > 0 ||
      junction.category === "opening_boundary_intersection"
    ) {
      kept.push(junction);
      continue;
    }
    if (remainingWallCeiling.some((seam) => junctionOnSeam(junction, seam))) {
      kept.push(junction);
      continue;
    }
    if (
      args.suppressedGeneralSeams.some((seam) =>
        junctionOnSeam(junction, seam, 0.035)
      )
    ) {
      skippedJunctionIds.push(junction.id);
      args.resolutionReasons.push(MERGE_REASON.junctionOmittedSuppressedSeam);
      continue;
    }
    if (
      (junction.category === "room_corner" ||
        junction.category === "seam_junction") &&
      remainingWallCeiling.some((seam) =>
        junctionBelowEnvelopeEndpoint(junction, seam)
      )
    ) {
      skippedJunctionIds.push(junction.id);
      args.resolutionReasons.push(MERGE_REASON.junctionOmittedBelowEnvelope);
      continue;
    }
    kept.push(junction);
  }
  return { kept, skippedJunctionIds };
}

function withMergedSeams(
  general: EmptyRoomObservationAcceptedEvidence,
  focused: FocusedSideCeilingWallEvidence,
): EmptyRoomObservationAcceptedEvidence {
  if (focused.observerStatus === "failed") {
    return Object.freeze({
      ...general,
      qualityGate: Object.freeze({
        ...general.qualityGate,
        focusedSideCeilingWall: focusedReceipt({ focused }),
      }),
    });
  }
  if (focused.observedSeams.length === 0) {
    const resolutionReasons: string[] = [];
    const junctions = selectJunctions({
      junctions: general.observedJunctions,
      remainingSeams: general.observedSeams,
      suppressedGeneralSeams: [],
      resolutionReasons,
    });
    return Object.freeze({
      ...general,
      observedJunctions: Object.freeze(junctions.kept),
      qualityGate: Object.freeze({
        ...general.qualityGate,
        focusedSideCeilingWall: focusedReceipt({
          focused,
          skippedJunctionIds: junctions.skippedJunctionIds,
          resolutionReasons,
        }),
      }),
    });
  }
  const selected = resolveFocusedAgainstGeneral(general.observedSeams, focused);
  const remaining = MAX_SEAMS - selected.keptGeneral.length;
  const added = selected.added.slice(0, Math.max(0, remaining));
  const clipped = selected.added.slice(added.length);
  if (clipped.length > 0) {
    selected.rejectedSeamIds.push(...clipped.map((seam) => seam.id));
    selected.resolutionReasons.push(
      ...clipped.map(() => MERGE_REASON.focusedClippedMaxSeams),
    );
  }
  const remainingSeams = Object.freeze([...selected.keptGeneral, ...added]);
  const junctions = selectJunctions({
    junctions: general.observedJunctions,
    remainingSeams,
    suppressedGeneralSeams: selected.suppressedGeneralSeams,
    resolutionReasons: selected.resolutionReasons,
  });
  return Object.freeze({
    ...general,
    observedSeams: remainingSeams,
    observedJunctions: Object.freeze(junctions.kept),
    qualityGate: Object.freeze({
      ...general.qualityGate,
      focusedSideCeilingWall: focusedReceipt({
        focused,
        addedSeamIds: added.map((seam) => seam.id),
        skippedDuplicateSeamIds: selected.skippedDuplicateSeamIds,
        rejectedSeamIds: selected.rejectedSeamIds,
        suppressedGeneralSeamIds: selected.suppressedGeneralSeamIds,
        skippedJunctionIds: junctions.skippedJunctionIds,
        resolutionReasons: selected.resolutionReasons,
      }),
    }),
  });
}

/**
 * Conservatively merge focused side wall-ceiling seams onto general EMPTY
 * evidence. Duplicate same-run pairs keep one already-observed polyline;
 * coordinates are never averaged, snapped, or interpolated. Center
 * (typically back) wall-ceiling seams are never suppressed. Focused
 * additions keep empty planeIds rather than inventing plane binding.
 */
export function mergeFocusedSideCeilingWallSeams(args: {
  general: EmptyRoomObservationEvidence | null;
  focused: FocusedSideCeilingWallEvidence | null;
}): EmptyRoomObservationEvidence | null {
  const { general, focused } = args;
  if (!general) return null;
  if (!focused) {
    if (general.observerStatus === "failed") return general;
    return Object.freeze({
      ...general,
      qualityGate: Object.freeze({
        ...general.qualityGate,
        focusedSideCeilingWall: focusedReceipt({ focused: null }),
      }),
    });
  }
  if (general.observerStatus === "failed") {
    return general;
  }
  return withMergedSeams(general, focused);
}
