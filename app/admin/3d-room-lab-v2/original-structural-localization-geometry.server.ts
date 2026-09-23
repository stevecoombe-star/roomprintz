import {
  REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD,
  REGISTRATION_MIN_RIDGE_MATCH_FRACTION,
  REGISTRATION_MIN_RIDGE_MATCHED_SAMPLES,
  REGISTRATION_SEARCH_WINDOW,
  type EmptyOriginalNormalizedUv,
} from "./empty-original-registration-authority-contract";
import { detectBimodalOffsets } from "./empty-original-registration-geometry";
import { imagePolylineLineFit } from "./room-boundary-line-fit.server";
import { ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL } from "./room-boundary-authority-contract";
import type { SourceNormalizedPoint } from "./empty-room-observation-contract";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  emptySourcePoint,
  originalSourcePoint,
  type OriginalLocalizationStatus,
  type OriginalLocalizedStructure,
  type OriginalSourceNormalizedPoint,
} from "./original-structural-localization-authority-contract";

export type OriginalLocalizationSample = Readonly<{
  priorId: string;
  structureId: string;
  parentStructureId: string | null;
  structureKind: string;
  evidenceClass: "point_anchor" | "ridge_normal";
  empty: EmptyOriginalNormalizedUv;
  tangent: EmptyOriginalNormalizedUv | null;
  original: EmptyOriginalNormalizedUv | null;
  ncc: number | null;
  orientationResidual: number | null;
  strongBandDiameter: number | null;
  searchDisplacement: number | null;
  searchBoundHit: boolean;
  signedNormalOffset: number | null;
  matched: boolean;
  failReason: "no_match" | "ambiguous" | "rejected" | null;
}>;

export type FiniteOriginalSpan = Readonly<{
  polyline: readonly OriginalSourceNormalizedPoint[];
  construction: "supported_contiguous_samples";
  interpolated: false;
  hiddenContinuation: false;
  clusterCount: number;
  sampleCount: number;
  matchedSampleCount: number;
  localFitResidual: number | null;
}>;

/**
 * Arc-length parameter of a point's nearest location on a polyline.
 * Used only to order EMPTY priors; it is not an ORIGINAL physical t.
 */
export function nearestPolylineParameter(
  polyline: readonly SourceNormalizedPoint[],
  point: Readonly<{ x: number; y: number }>,
): number {
  if (polyline.length === 0) return 0;
  if (polyline.length === 1) return 0;
  let total = 0;
  const lengths: number[] = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const length = Math.hypot(
      polyline[index + 1]!.x - polyline[index]!.x,
      polyline[index + 1]!.y - polyline[index]!.y,
    );
    lengths.push(length);
    total += length;
  }
  if (total <= 1e-12) return 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestT = 0;
  let cursor = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    const abx = end.x - start.x;
    const aby = end.y - start.y;
    const length = lengths[index]!;
    const local = length <= 1e-18
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * abx + (point.y - start.y) * aby) / (length * length)));
    const proj = { x: start.x + abx * local, y: start.y + aby * local };
    const dist = Math.hypot(point.x - proj.x, point.y - proj.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = (cursor + local * length) / total;
    }
    cursor += length;
  }
  return bestT;
}

function sampleAccepted(sample: OriginalLocalizationSample): boolean {
  return sample.matched &&
    !sample.searchBoundHit &&
    sample.original !== null &&
    sample.failReason === null;
}

/**
 * Conservative finite ORIGINAL span:
 * - order samples by EMPTY prior parameter
 * - keep only contiguous localized runs
 * - never interpolate through no-match
 * - never bridge separated clusters
 * - never extend to EMPTY endpoints
 * If two or more clusters each have ≥2 samples: fail closed (ambiguous).
 */
export function constructOriginalLocalizedFiniteSpan(
  samples: readonly OriginalLocalizationSample[],
  emptyPolyline: readonly SourceNormalizedPoint[],
): FiniteOriginalSpan | { status: "no_match" | "ambiguous"; clusterCount: number } {
  if (samples.length === 0) {
    return { status: "no_match", clusterCount: 0 };
  }
  const ordered = [...samples].sort((left, right) =>
    nearestPolylineParameter(emptyPolyline, { x: left.empty.u, y: left.empty.v }) -
    nearestPolylineParameter(emptyPolyline, { x: right.empty.u, y: right.empty.v })
  );
  const runs: OriginalLocalizationSample[][] = [];
  let current: OriginalLocalizationSample[] = [];
  for (const sample of ordered) {
    if (sampleAccepted(sample)) {
      current.push(sample);
      continue;
    }
    if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  const spanRuns = runs.filter((run) => run.length >= 2);
  if (spanRuns.length === 0) {
    return { status: "no_match", clusterCount: runs.length };
  }
  if (spanRuns.length > 1) {
    return { status: "ambiguous", clusterCount: spanRuns.length };
  }
  const run = spanRuns[0]!;
  const polyline = run.map((sample) =>
    originalSourcePoint(sample.original!.u, sample.original!.v)
  );
  const fit = imagePolylineLineFit(polyline.map((point) => ({ x: point.x, y: point.y })));
  return {
    polyline,
    construction: "supported_contiguous_samples",
    interpolated: false,
    hiddenContinuation: false,
    clusterCount: 1,
    sampleCount: samples.length,
    matchedSampleCount: run.length,
    localFitResidual: fit?.residual.maxDistance ?? null,
  };
}

export function aggregateOriginalLocalizedPointAnchor(
  samples: readonly OriginalLocalizationSample[],
): {
  status: OriginalLocalizationStatus;
  original: OriginalSourceNormalizedPoint | null;
  ncc: number | null;
  strongBandDiameter: number | null;
  searchDisplacement: number | null;
  searchBoundHit: boolean;
  limitations: string[];
} {
  const first = samples[0];
  if (!first) {
    return {
      status: "no_match",
      original: null,
      ncc: null,
      strongBandDiameter: null,
      searchDisplacement: null,
      searchBoundHit: false,
      limitations: ["no_samples"],
    };
  }
  const accepted = samples.filter(sampleAccepted);
  if (accepted.length === 0) {
    const ambiguous = samples.some((sample) => sample.failReason === "ambiguous");
    const rejected = samples.some((sample) => sample.failReason === "rejected");
    const boundHit = samples.some((sample) => sample.searchBoundHit);
    return {
      status: rejected ? "rejected" : ambiguous || boundHit ? (boundHit && !ambiguous ? "no_match" : "ambiguous") : "no_match",
      original: null,
      ncc: first.ncc,
      strongBandDiameter: first.strongBandDiameter,
      searchDisplacement: first.searchDisplacement,
      searchBoundHit: boundHit,
      limitations: boundHit ? ["search_bound_hit"] : [],
    };
  }
  const representative = accepted[0]!;
  return {
    status: "localized",
    original: originalSourcePoint(representative.original!.u, representative.original!.v),
    ncc: representative.ncc,
    strongBandDiameter: representative.strongBandDiameter,
    searchDisplacement: representative.searchDisplacement,
    searchBoundHit: false,
    limitations: [],
  };
}

export function aggregateOriginalLocalizedRidge(
  samples: readonly OriginalLocalizationSample[],
  emptyPolyline: readonly SourceNormalizedPoint[],
): {
  status: OriginalLocalizationStatus;
  span: FiniteOriginalSpan | null;
  ncc: number | null;
  sampleCount: number;
  matchedSampleCount: number;
  matchedFraction: number;
  orientationResidual: number | null;
  bimodalOffsetDetected: boolean;
  localFitResidual: number | null;
  searchDisplacement: number | null;
  searchBoundHit: boolean;
  limitations: string[];
} {
  const sampleCount = samples.length;
  const matched = samples.filter(sampleAccepted);
  const matchedSampleCount = matched.length;
  const matchedFraction = sampleCount === 0 ? 0 : matchedSampleCount / sampleCount;
  const offsets = matched
    .map((sample) => sample.signedNormalOffset)
    .filter((value): value is number => value !== null);
  const orientations = matched
    .map((sample) => sample.orientationResidual)
    .filter((value): value is number => value !== null);
  const bimodal = detectBimodalOffsets(offsets);
  const searchBoundHit = samples.some((sample) => sample.searchBoundHit);
  const medianOrientation = orientations.length === 0
    ? null
    : [...orientations].sort((left, right) => left - right)[
      Math.floor(orientations.length / 2)
    ]!;
  const medianNcc = matched.length === 0
    ? null
    : [...matched.map((sample) => sample.ncc ?? 0)].sort((left, right) => left - right)[
      Math.floor(matched.length / 2)
    ]!;
  const medianDisplacement = offsets.length === 0
    ? null
    : medianAbs(offsets);

  if (
    matchedSampleCount < REGISTRATION_MIN_RIDGE_MATCHED_SAMPLES ||
    matchedFraction < REGISTRATION_MIN_RIDGE_MATCH_FRACTION
  ) {
    return {
      status: searchBoundHit && matchedSampleCount === 0 ? "no_match" : "no_match",
      span: null,
      ncc: medianNcc,
      sampleCount,
      matchedSampleCount,
      matchedFraction,
      orientationResidual: medianOrientation,
      bimodalOffsetDetected: bimodal,
      localFitResidual: null,
      searchDisplacement: medianDisplacement,
      searchBoundHit,
      limitations: searchBoundHit ? ["search_bound_hit"] : ["insufficient_ridge_support"],
    };
  }
  if (bimodal) {
    return {
      status: "ambiguous",
      span: null,
      ncc: medianNcc,
      sampleCount,
      matchedSampleCount,
      matchedFraction,
      orientationResidual: medianOrientation,
      bimodalOffsetDetected: true,
      localFitResidual: null,
      searchDisplacement: medianDisplacement,
      searchBoundHit,
      limitations: ["bimodal_parallel_family"],
    };
  }
  if (
    medianOrientation !== null &&
    medianOrientation > REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD
  ) {
    return {
      status: "rejected",
      span: null,
      ncc: medianNcc,
      sampleCount,
      matchedSampleCount,
      matchedFraction,
      orientationResidual: medianOrientation,
      bimodalOffsetDetected: false,
      localFitResidual: null,
      searchDisplacement: medianDisplacement,
      searchBoundHit,
      limitations: ["orientation_contradicts_prior"],
    };
  }
  const span = constructOriginalLocalizedFiniteSpan(samples, emptyPolyline);
  if ("status" in span) {
    return {
      status: span.status,
      span: null,
      ncc: medianNcc,
      sampleCount,
      matchedSampleCount,
      matchedFraction,
      orientationResidual: medianOrientation,
      bimodalOffsetDetected: bimodal,
      localFitResidual: null,
      searchDisplacement: medianDisplacement,
      searchBoundHit,
      limitations: span.status === "ambiguous"
        ? ["separated_localized_clusters_not_bridged"]
        : ["finite_span_unsupported"],
    };
  }
  if (
    span.localFitResidual !== null &&
    span.localFitResidual > ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL
  ) {
    return {
      status: "rejected",
      span: null,
      ncc: medianNcc,
      sampleCount,
      matchedSampleCount,
      matchedFraction,
      orientationResidual: medianOrientation,
      bimodalOffsetDetected: false,
      localFitResidual: span.localFitResidual,
      searchDisplacement: medianDisplacement,
      searchBoundHit,
      limitations: ["original_line_fit_unstable"],
    };
  }
  return {
    status: "localized",
    span,
    ncc: medianNcc,
    sampleCount,
    matchedSampleCount,
    matchedFraction,
    orientationResidual: medianOrientation,
    bimodalOffsetDetected: false,
    localFitResidual: span.localFitResidual,
    searchDisplacement: medianDisplacement,
    searchBoundHit: false,
    limitations: ["ridge_tangent_non_authoritative"],
  };
}

function medianAbs(values: readonly number[]): number {
  const sorted = [...values].map((value) => Math.abs(value)).sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function emptyPriorPolyline(
  polyline: readonly SourceNormalizedPoint[],
): OriginalLocalizedStructure["emptyPrior"] {
  return {
    basis: "empty-source-normalized-image/v1",
    point: null,
    polyline: polyline.map((point) => emptySourcePoint(point.x, point.y)),
  };
}

export function emptyPriorPoint(
  point: Readonly<{ x: number; y: number }>,
): OriginalLocalizedStructure["emptyPrior"] {
  return {
    basis: "empty-source-normalized-image/v1",
    point: emptySourcePoint(point.x, point.y),
    polyline: null,
  };
}

export function originalEvidenceFromSpan(
  span: FiniteOriginalSpan | null,
  point: OriginalSourceNormalizedPoint | null,
): OriginalLocalizedStructure["originalEvidence"] {
  if (span) {
    const start = span.polyline[0]!;
    const end = span.polyline[span.polyline.length - 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    return {
      basis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      point: null,
      line: length > 1e-12
        ? {
          origin: start,
          direction: { x: dx / length, y: dy / length },
        }
        : null,
      polyline: span.polyline,
    };
  }
  return {
    basis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
    point,
    line: null,
    polyline: null,
  };
}

export const ORIGINAL_LOCALIZATION_SEARCH_WINDOW = REGISTRATION_SEARCH_WINDOW;
