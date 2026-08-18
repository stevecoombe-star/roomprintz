/**
 * Read-only AFC-SR1 V3 Reader evidence retention and projective forensics.
 *
 * Nothing in this module grants geometry authority.  It only projects already
 * validated V3 evidence into a bounded public contract and derives display
 * observations from that immutable evidence.
 */
import {
  convertAfcSr1PixelLineToSourceNormalized,
  deriveAfcSr1FloorVanishingLineCrossRoom,
} from "./research/afc-sr1-floor-vanishing-line-cross-room";
import {
  euclideanizeFinitePoint,
  finitePointToHomogeneous,
  intersectLines,
  isFiniteHomogeneousPoint,
  lineThroughPoints,
  normalizeCanonicalLine,
  normalizePointForDiagnostics,
  type HomogeneousLine2,
  type HomogeneousPoint2,
} from "./research/afc-sr1-homogeneous-geometry";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

export const AFC_SR1_V3_READER_DIAGNOSTICS_CONTRACT_VERSION =
  "afc-sr1-v3-reader-diagnostics/v1" as const;

export type AfcSr1V3ReaderFamilyDiagnosticV1 = Readonly<{
  vpClass: "finite" | "directional";
  normalizedHomogeneousVp: readonly [number, number, number];
  direction: readonly [number, number] | null;
  rho: number;
  supportCount: number;
  supportTotalLengthPx: number;
  cappedSupportLengthPx: number;
  medianResidualPx: number;
  p90ResidualPx: number;
}>;

export type AfcSr1V3ReaderPairDiagnosticV1 = Readonly<{
  familyIndices: readonly [number, number];
  floorLineAnalysis: readonly [number, number, number];
  families: readonly [
    AfcSr1V3ReaderFamilyDiagnosticV1,
    AfcSr1V3ReaderFamilyDiagnosticV1,
  ];
  basinSupport: number;
  stability: Readonly<{
    stable: boolean;
    classPreserving: boolean | null;
    maxSplitVsFullProbeDistancePx: number;
  }>;
  distinctness: Readonly<{
    chordal: number | null;
    directionAngleDegrees: number | null;
  }> | null;
}>;

export type AfcSr1V3InvalidPairDiagnosticV1 = Readonly<{
  familyIndices: readonly [number, number];
  reason: string;
  stability: Readonly<{
    stable: boolean | null;
    classPreserving: boolean | null;
    maxSplitVsFullProbeDistancePx: number | null;
  }> | null;
  distinctness: Readonly<{
    chordal: number | null;
    directionAngleDegrees: number | null;
  }> | null;
}>;

export type AfcSr1V3SupportSegment = Readonly<{
  detectorIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;

export type AfcSr1V3FamilySupportMembership = Readonly<{
  familyIndex: number;
  supporterDetectorIndices: readonly number[];
}>;

export type AfcSr1V3FamilySupportGeometry = Readonly<{
  coordinateSpace: "analysis-pixel/v1";
  authority: "none";
  role: "observation_only";
  excludedFromCanonicalEvidence: true;
  segments: readonly AfcSr1V3SupportSegment[];
  families: readonly AfcSr1V3FamilySupportMembership[];
}>;

export type AfcSr1V3FamilyOrientationSummary = Readonly<{
  familyIndex: number;
  supporterCount: number;
  axialMeanDegrees: number | null;
  axialMedianDegrees: number | null;
  axialCircularStdDevDegrees: number | null;
  axialIqrDegrees: number | null;
}>;

export type AfcSr1V3ResidualSummary = Readonly<{
  supporterCount: number;
  medianResidualPx: number | null;
  p90ResidualPx: number | null;
  withinExistingInlierBandCount: number;
}>;

export type AfcSr1V3DirectionFieldDisagreementSummary = Readonly<{
  supporterCount: number;
  medianDegrees: number | null;
  p90Degrees: number | null;
}>;

export type AfcSr1V3FamilyPairIndependenceDiagnostic = Readonly<{
  familyIndices: readonly [number, number];
  overlap: Readonly<{
    sharedSupporterCount: number;
    unionSupporterCount: number;
    jaccard: number | null;
    overlapFractionOfSmaller: number | null;
    familyASupporterCount: number;
    familyBSupporterCount: number;
  }>;
  exclusiveSupport: Readonly<{
    sharedSupportLengthPx: number;
    firstOnlySupporterCount: number;
    secondOnlySupporterCount: number;
    firstOnlySupportLengthPx: number;
    secondOnlySupportLengthPx: number;
  }>;
  crossFit: Readonly<{
    firstSupportersAgainstSecond: AfcSr1V3ResidualSummary | null;
    secondSupportersAgainstFirst: AfcSr1V3ResidualSummary | null;
  }>;
  predictedDirectionFieldDisagreement: Readonly<{
    onFirstSupporterMidpoints: AfcSr1V3DirectionFieldDisagreementSummary | null;
    onSecondSupporterMidpoints: AfcSr1V3DirectionFieldDisagreementSummary | null;
    onUnionSupporterMidpoints: AfcSr1V3DirectionFieldDisagreementSummary | null;
    onSharedSupporterMidpoints: AfcSr1V3DirectionFieldDisagreementSummary | null;
  }>;
}>;

export type AfcSr1V3FamilyPairIndependenceDiagnostics = Readonly<{
  contractVersion: "afc-sr1-family-pair-independence-diagnostics/v1";
  coordinateSpace: "analysis-pixel/v1";
  authority: "none";
  role: "observation_only";
  excludedFromCanonicalEvidence: true;
  familyOrientationSummaries: readonly AfcSr1V3FamilyOrientationSummary[];
  pairs: readonly AfcSr1V3FamilyPairIndependenceDiagnostic[];
}>;

export type AfcSr1V3ReaderDiagnosticsV1 = Readonly<{
  contractVersion: typeof AFC_SR1_V3_READER_DIAGNOSTICS_CONTRACT_VERSION;
  authority: "none";
  role: "observation_only";
  excludedFromCanonicalEvidence: true;
  readerRole: "rawReader" | "childReader";
  receiptEvidenceDigest: string;
  imageIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
  }>;
  analysisIdentity: Readonly<{
    mode: "identity" | "downscale_long_edge";
    analysisWidth: number;
    analysisHeight: number;
    scaleX: number;
    scaleY: number;
  }>;
  roiIdentity: Readonly<{
    roiDigest: string;
  }>;
  readerIdentity: Readonly<{
    schemaVersion: string;
    researchProfile: string;
    policyVersion: string;
    readerModuleVersion: string;
    runtime: Readonly<{
      opencvVersion: string;
      numpyVersion: string;
    }>;
  }>;
  floorVanishingLinePixel: Readonly<{ a: number; b: number; c: number }>;
  winningPair: AfcSr1V3ReaderPairDiagnosticV1;
  validPairUniverse: readonly AfcSr1V3ReaderPairDiagnosticV1[];
  invalidPairs: readonly AfcSr1V3InvalidPairDiagnosticV1[];
  validFamilyCount: number;
  candidateUnorderedPairCount: number;
  validPairCount: number;
  familySupportGeometry: AfcSr1V3FamilySupportGeometry | null;
  familyPairIndependenceDiagnostics: AfcSr1V3FamilyPairIndependenceDiagnostics | null;
  segmentCounts: Readonly<{
    raw: number | null;
    admittedAllNineInside: number | null;
    roiOverlapDiagnosticAtLeastSevenOfNine: number | null;
  }>;
}>;

type RecordValue = Record<string, unknown>;
type Line = Readonly<{ a: number; b: number; c: number }>;

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function tuple2(value: unknown): readonly [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every(finite)
    ? Object.freeze([value[0], value[1]] as const)
    : null;
}

function tuple3(value: unknown): readonly [number, number, number] | null {
  return Array.isArray(value) && value.length === 3 && value.every(finite)
    ? Object.freeze([value[0], value[1], value[2]] as const)
    : null;
}

function sanitizeFamily(value: unknown): AfcSr1V3ReaderFamilyDiagnosticV1 | null {
  if (!record(value) ||
      (value.vpClass !== "finite" && value.vpClass !== "directional") ||
      !tuple3(value.normalizedHomogeneousVp) || !finite(value.rho) ||
      !positiveInteger(value.supportCount) || !finite(value.supportTotalLengthPx) ||
      !finite(value.cappedSupportLengthPx) || !finite(value.medianResidualPx) ||
      !finite(value.p90ResidualPx)) return null;
  const direction = value.direction === null ? null : tuple2(value.direction);
  if (value.direction !== null && direction === null) return null;
  return Object.freeze({
    vpClass: value.vpClass,
    normalizedHomogeneousVp: tuple3(value.normalizedHomogeneousVp)!,
    direction,
    rho: value.rho,
    supportCount: value.supportCount,
    supportTotalLengthPx: value.supportTotalLengthPx,
    cappedSupportLengthPx: value.cappedSupportLengthPx,
    medianResidualPx: value.medianResidualPx,
    p90ResidualPx: value.p90ResidualPx,
  });
}

function sanitizeDistinctness(value: unknown): AfcSr1V3ReaderPairDiagnosticV1["distinctness"] {
  if (!record(value)) return null;
  return Object.freeze({
    chordal: finite(value.chordal) ? value.chordal : null,
    directionAngleDegrees: finite(value.directionAngleDegrees)
      ? value.directionAngleDegrees
      : null,
  });
}

function sanitizeStability(value: unknown): AfcSr1V3ReaderPairDiagnosticV1["stability"] | null {
  if (!record(value) || !finite(value.maxSplitVsFullProbeDistancePx) ||
      typeof value.stable !== "boolean") return null;
  return Object.freeze({
    stable: value.stable,
    classPreserving: typeof value.classPreserving === "boolean"
      ? value.classPreserving
      : null,
    maxSplitVsFullProbeDistancePx: value.maxSplitVsFullProbeDistancePx,
  });
}

function sanitizePair(value: unknown): AfcSr1V3ReaderPairDiagnosticV1 | null {
  if (!record(value) || !tuple2(value.familyIndices) ||
      !tuple3(value.floorLineAnalysis) || !Array.isArray(value.families) ||
      value.families.length !== 2 || !positiveInteger(value.basinSupport)) return null;
  const familyIndices = tuple2(value.familyIndices);
  if (familyIndices === null || !familyIndices.every(Number.isInteger) ||
      familyIndices.some((index) => index < 0)) {
    return null;
  }
  const first = sanitizeFamily(value.families[0]);
  const second = sanitizeFamily(value.families[1]);
  const stability = sanitizeStability(value.stability);
  if (!first || !second || !stability) return null;
  return Object.freeze({
    familyIndices,
    floorLineAnalysis: tuple3(value.floorLineAnalysis)!,
    families: Object.freeze([first, second] as const),
    basinSupport: value.basinSupport,
    stability,
    distinctness: sanitizeDistinctness(value.distinctness),
  });
}

function sanitizeInvalidPair(value: unknown): AfcSr1V3InvalidPairDiagnosticV1 | null {
  if (!record(value) || !tuple2(value.familyIndices) || typeof value.reason !== "string") {
    return null;
  }
  const familyIndices = tuple2(value.familyIndices);
  if (familyIndices === null || !familyIndices.every(Number.isInteger) ||
      familyIndices.some((index) => index < 0)) {
    return null;
  }
  const stability = record(value.stability)
    ? Object.freeze({
        stable: typeof value.stability.stable === "boolean" ? value.stability.stable : null,
        classPreserving: typeof value.stability.classPreserving === "boolean"
          ? value.stability.classPreserving
          : null,
        maxSplitVsFullProbeDistancePx: finite(value.stability.maxSplitVsFullProbeDistancePx)
          ? value.stability.maxSplitVsFullProbeDistancePx
          : null,
      })
    : null;
  return Object.freeze({
    familyIndices,
    reason: value.reason,
    stability,
    distinctness: sanitizeDistinctness(value.distinctness),
  });
}

function sanitizeFamilySupportGeometry(value: unknown): AfcSr1V3FamilySupportGeometry | null {
  if (!record(value) || value.coordinateSpace !== "analysis-pixel/v1" ||
      value.authority !== "none" || value.role !== "observation_only" ||
      value.excludedFromCanonicalEvidence !== true ||
      !Array.isArray(value.segments) || !Array.isArray(value.families)) return null;
  const detectorIndices = new Set<number>();
  const segments: AfcSr1V3SupportSegment[] = [];
  for (const item of value.segments) {
    if (!record(item) || !nonNegativeInteger(item.detectorIndex) ||
        !finite(item.x1) || !finite(item.y1) || !finite(item.x2) || !finite(item.y2) ||
        detectorIndices.has(item.detectorIndex)) return null;
    detectorIndices.add(item.detectorIndex);
    segments.push(Object.freeze({
      detectorIndex: item.detectorIndex,
      x1: item.x1,
      y1: item.y1,
      x2: item.x2,
      y2: item.y2,
    }));
  }
  const familyIndices = new Set<number>();
  const families: AfcSr1V3FamilySupportMembership[] = [];
  for (const item of value.families) {
    if (!record(item) || !nonNegativeInteger(item.familyIndex) ||
        familyIndices.has(item.familyIndex) ||
        !Array.isArray(item.supporterDetectorIndices) ||
        !item.supporterDetectorIndices.every(
          (index) => nonNegativeInteger(index) && detectorIndices.has(index)
        )) return null;
    familyIndices.add(item.familyIndex);
    families.push(Object.freeze({
      familyIndex: item.familyIndex,
      supporterDetectorIndices: Object.freeze([...item.supporterDetectorIndices]),
    }));
  }
  return Object.freeze({
    coordinateSpace: "analysis-pixel/v1",
    authority: "none",
    role: "observation_only",
    excludedFromCanonicalEvidence: true,
    segments: Object.freeze(segments),
    families: Object.freeze(families),
  });
}

function finiteOrNull(value: unknown): number | null | undefined {
  return value === null ? null : finite(value) ? value : undefined;
}

function sanitizeResidualSummary(value: unknown): AfcSr1V3ResidualSummary | null {
  if (!record(value) || !nonNegativeInteger(value.supporterCount) ||
      !nonNegativeInteger(value.withinExistingInlierBandCount) ||
      value.withinExistingInlierBandCount > value.supporterCount) return null;
  const medianResidualPx = finiteOrNull(value.medianResidualPx);
  const p90ResidualPx = finiteOrNull(value.p90ResidualPx);
  if (medianResidualPx === undefined || p90ResidualPx === undefined) return null;
  return Object.freeze({
    supporterCount: value.supporterCount,
    medianResidualPx,
    p90ResidualPx,
    withinExistingInlierBandCount: value.withinExistingInlierBandCount,
  });
}

function sanitizeDirectionFieldSummary(
  value: unknown
): AfcSr1V3DirectionFieldDisagreementSummary | null {
  if (!record(value) || !nonNegativeInteger(value.supporterCount)) return null;
  const medianDegrees = finiteOrNull(value.medianDegrees);
  const p90Degrees = finiteOrNull(value.p90Degrees);
  if (medianDegrees === undefined || p90Degrees === undefined ||
      (medianDegrees !== null && (medianDegrees < 0 || medianDegrees > 90)) ||
      (p90Degrees !== null && (p90Degrees < 0 || p90Degrees > 90))) return null;
  return Object.freeze({ supporterCount: value.supporterCount, medianDegrees, p90Degrees });
}

function sanitizeFamilyPairIndependenceDiagnostics(
  value: unknown
): AfcSr1V3FamilyPairIndependenceDiagnostics | null {
  if (!record(value) ||
      value.contractVersion !== "afc-sr1-family-pair-independence-diagnostics/v1" ||
      value.coordinateSpace !== "analysis-pixel/v1" || value.authority !== "none" ||
      value.role !== "observation_only" || value.excludedFromCanonicalEvidence !== true ||
      !Array.isArray(value.familyOrientationSummaries) || !Array.isArray(value.pairs)) return null;
  const familyIndices = new Set<number>();
  const familyOrientationSummaries: AfcSr1V3FamilyOrientationSummary[] = [];
  for (const item of value.familyOrientationSummaries) {
    if (!record(item) || !nonNegativeInteger(item.familyIndex) ||
        familyIndices.has(item.familyIndex) || !nonNegativeInteger(item.supporterCount)) return null;
    const axialMeanDegrees = finiteOrNull(item.axialMeanDegrees);
    const axialMedianDegrees = finiteOrNull(item.axialMedianDegrees);
    const axialCircularStdDevDegrees = finiteOrNull(item.axialCircularStdDevDegrees);
    const axialIqrDegrees = finiteOrNull(item.axialIqrDegrees);
    if (axialMeanDegrees === undefined || axialMedianDegrees === undefined ||
        axialCircularStdDevDegrees === undefined || axialIqrDegrees === undefined) return null;
    familyIndices.add(item.familyIndex);
    familyOrientationSummaries.push(Object.freeze({
      familyIndex: item.familyIndex,
      supporterCount: item.supporterCount,
      axialMeanDegrees,
      axialMedianDegrees,
      axialCircularStdDevDegrees,
      axialIqrDegrees,
    }));
  }
  const pairIds = new Set<string>();
  const pairs: AfcSr1V3FamilyPairIndependenceDiagnostic[] = [];
  for (const item of value.pairs) {
    if (!record(item) || !tuple2(item.familyIndices) || !record(item.overlap) ||
        !record(item.exclusiveSupport) || !record(item.crossFit) ||
        !record(item.predictedDirectionFieldDisagreement)) return null;
    const pair = tuple2(item.familyIndices);
    if (!pair || !pair.every(nonNegativeInteger) || pair[0] >= pair[1] ||
        !familyIndices.has(pair[0]) || !familyIndices.has(pair[1]) ||
        pairIds.has(pair.join(":"))) return null;
    const overlap = item.overlap;
    const exclusive = item.exclusiveSupport;
    if (!nonNegativeInteger(overlap.sharedSupporterCount) ||
        !nonNegativeInteger(overlap.unionSupporterCount) ||
        !nonNegativeInteger(overlap.familyASupporterCount) ||
        !nonNegativeInteger(overlap.familyBSupporterCount) ||
        finiteOrNull(overlap.jaccard) === undefined ||
        finiteOrNull(overlap.overlapFractionOfSmaller) === undefined ||
        !finite(exclusive.sharedSupportLengthPx) ||
        !nonNegativeInteger(exclusive.firstOnlySupporterCount) ||
        !nonNegativeInteger(exclusive.secondOnlySupporterCount) ||
        !finite(exclusive.firstOnlySupportLengthPx) ||
        !finite(exclusive.secondOnlySupportLengthPx)) return null;
    const jaccard = finiteOrNull(overlap.jaccard);
    const overlapFractionOfSmaller = finiteOrNull(overlap.overlapFractionOfSmaller);
    if (jaccard === undefined || overlapFractionOfSmaller === undefined ||
        (jaccard !== null && (jaccard < 0 || jaccard > 1)) ||
        (overlapFractionOfSmaller !== null &&
          (overlapFractionOfSmaller < 0 || overlapFractionOfSmaller > 1))) return null;
    const firstSupportersAgainstSecond = item.crossFit.firstSupportersAgainstSecond === null
      ? null : sanitizeResidualSummary(item.crossFit.firstSupportersAgainstSecond);
    const secondSupportersAgainstFirst = item.crossFit.secondSupportersAgainstFirst === null
      ? null : sanitizeResidualSummary(item.crossFit.secondSupportersAgainstFirst);
    const field = item.predictedDirectionFieldDisagreement;
    const onFirstSupporterMidpoints = field.onFirstSupporterMidpoints === null
      ? null : sanitizeDirectionFieldSummary(field.onFirstSupporterMidpoints);
    const onSecondSupporterMidpoints = field.onSecondSupporterMidpoints === null
      ? null : sanitizeDirectionFieldSummary(field.onSecondSupporterMidpoints);
    const onUnionSupporterMidpoints = field.onUnionSupporterMidpoints === null
      ? null : sanitizeDirectionFieldSummary(field.onUnionSupporterMidpoints);
    const onSharedSupporterMidpoints = field.onSharedSupporterMidpoints === null
      ? null : sanitizeDirectionFieldSummary(field.onSharedSupporterMidpoints);
    if ((item.crossFit.firstSupportersAgainstSecond !== null && !firstSupportersAgainstSecond) ||
        (item.crossFit.secondSupportersAgainstFirst !== null && !secondSupportersAgainstFirst) ||
        (field.onFirstSupporterMidpoints !== null && !onFirstSupporterMidpoints) ||
        (field.onSecondSupporterMidpoints !== null && !onSecondSupporterMidpoints) ||
        (field.onUnionSupporterMidpoints !== null && !onUnionSupporterMidpoints) ||
        (field.onSharedSupporterMidpoints !== null && !onSharedSupporterMidpoints)) return null;
    pairIds.add(pair.join(":"));
    pairs.push(Object.freeze({
      familyIndices: pair,
      overlap: Object.freeze({
        sharedSupporterCount: overlap.sharedSupporterCount,
        unionSupporterCount: overlap.unionSupporterCount,
        jaccard,
        overlapFractionOfSmaller,
        familyASupporterCount: overlap.familyASupporterCount,
        familyBSupporterCount: overlap.familyBSupporterCount,
      }),
      exclusiveSupport: Object.freeze({
        sharedSupportLengthPx: exclusive.sharedSupportLengthPx,
        firstOnlySupporterCount: exclusive.firstOnlySupporterCount,
        secondOnlySupporterCount: exclusive.secondOnlySupporterCount,
        firstOnlySupportLengthPx: exclusive.firstOnlySupportLengthPx,
        secondOnlySupportLengthPx: exclusive.secondOnlySupportLengthPx,
      }),
      crossFit: Object.freeze({ firstSupportersAgainstSecond, secondSupportersAgainstFirst }),
      predictedDirectionFieldDisagreement: Object.freeze({
        onFirstSupporterMidpoints,
        onSecondSupporterMidpoints,
        onUnionSupporterMidpoints,
        onSharedSupporterMidpoints,
      }),
    }));
  }
  return Object.freeze({
    contractVersion: "afc-sr1-family-pair-independence-diagnostics/v1",
    coordinateSpace: "analysis-pixel/v1",
    authority: "none",
    role: "observation_only",
    excludedFromCanonicalEvidence: true,
    familyOrientationSummaries: Object.freeze(familyOrientationSummaries),
    pairs: Object.freeze(pairs),
  });
}

/**
 * Projects only explicitly allowlisted V3 receipt fields.  The caller invokes
 * this after the existing canonical receipt validator; invalid/unexpected
 * diagnostics simply produce no sidecar rather than altering PATH A.
 */
export function retainAfcSr1V3ReaderDiagnostics(
  receipt: unknown,
  readerRole: AfcSr1V3ReaderDiagnosticsV1["readerRole"]
): AfcSr1V3ReaderDiagnosticsV1 | null {
  if (!record(receipt) || receipt.schemaVersion !== "afc-sr1-tr2-tile-floor-reader-result/v3" ||
      receipt.status !== "usable" || !record(receipt.imageIdentity) ||
      !record(receipt.analysisIdentity) || !record(receipt.roiIdentity) ||
      !record(receipt.runtimeIdentity) || !record(receipt.evidenceDigest) ||
      !record(receipt.diagnostics) || !record(receipt.floorVanishingLinePixel) ||
      !finite(receipt.floorVanishingLinePixel.a) ||
      !finite(receipt.floorVanishingLinePixel.b) ||
      !finite(receipt.floorVanishingLinePixel.c) ||
      typeof receipt.imageIdentity.sha256 !== "string" ||
      !positiveInteger(receipt.imageIdentity.decodedWidth) ||
      !positiveInteger(receipt.imageIdentity.decodedHeight) ||
      (receipt.analysisIdentity.mode !== "identity" &&
       receipt.analysisIdentity.mode !== "downscale_long_edge") ||
      !positiveInteger(receipt.analysisIdentity.analysisWidth) ||
      !positiveInteger(receipt.analysisIdentity.analysisHeight) ||
      !finite(receipt.analysisIdentity.scaleX) || !finite(receipt.analysisIdentity.scaleY) ||
      receipt.analysisIdentity.scaleX <= 0 || receipt.analysisIdentity.scaleY <= 0 ||
      typeof receipt.roiIdentity.roiDigest !== "string" ||
      typeof receipt.evidenceDigest.value !== "string" ||
      typeof receipt.researchProfile !== "string" || typeof receipt.policyVersion !== "string" ||
      typeof receipt.runtimeIdentity.readerModuleVersion !== "string" ||
      typeof receipt.runtimeIdentity.opencvVersion !== "string" ||
      typeof receipt.runtimeIdentity.numpyVersion !== "string") return null;

  const diagnostics = receipt.diagnostics;
  if (!positiveInteger(diagnostics.validFamilyCount) ||
      !positiveInteger(diagnostics.candidateUnorderedPairCount) ||
      !positiveInteger(diagnostics.validPairCount) ||
      !Array.isArray(diagnostics.validPairUniverse) ||
      diagnostics.validPairUniverse.length !== diagnostics.validPairCount ||
      !Array.isArray(diagnostics.invalidPairs)) return null;
  const winningPair = sanitizePair(diagnostics.winningPair);
  const validPairCandidates = diagnostics.validPairUniverse.map(sanitizePair);
  if (!winningPair || validPairCandidates.some((pair) => pair === null)) return null;
  const validPairUniverse = validPairCandidates.filter(
    (pair): pair is AfcSr1V3ReaderPairDiagnosticV1 => pair !== null
  );
  const invalidPairs = diagnostics.invalidPairs
    .map(sanitizeInvalidPair)
    .filter((pair): pair is AfcSr1V3InvalidPairDiagnosticV1 => pair !== null);
  const segmentCounts = record(diagnostics.segmentCounts) ? diagnostics.segmentCounts : {};

  return Object.freeze({
    contractVersion: AFC_SR1_V3_READER_DIAGNOSTICS_CONTRACT_VERSION,
    authority: "none",
    role: "observation_only",
    excludedFromCanonicalEvidence: true,
    readerRole,
    receiptEvidenceDigest: receipt.evidenceDigest.value,
    imageIdentity: Object.freeze({
      sha256: receipt.imageIdentity.sha256,
      decodedWidth: receipt.imageIdentity.decodedWidth,
      decodedHeight: receipt.imageIdentity.decodedHeight,
    }),
    analysisIdentity: Object.freeze({
      mode: receipt.analysisIdentity.mode,
      analysisWidth: receipt.analysisIdentity.analysisWidth,
      analysisHeight: receipt.analysisIdentity.analysisHeight,
      scaleX: receipt.analysisIdentity.scaleX,
      scaleY: receipt.analysisIdentity.scaleY,
    }),
    roiIdentity: Object.freeze({ roiDigest: receipt.roiIdentity.roiDigest }),
    readerIdentity: Object.freeze({
      schemaVersion: receipt.schemaVersion,
      researchProfile: receipt.researchProfile,
      policyVersion: receipt.policyVersion,
      readerModuleVersion: receipt.runtimeIdentity.readerModuleVersion,
      runtime: Object.freeze({
        opencvVersion: receipt.runtimeIdentity.opencvVersion,
        numpyVersion: receipt.runtimeIdentity.numpyVersion,
      }),
    }),
    floorVanishingLinePixel: Object.freeze({
      a: receipt.floorVanishingLinePixel.a,
      b: receipt.floorVanishingLinePixel.b,
      c: receipt.floorVanishingLinePixel.c,
    }),
    winningPair,
    validPairUniverse: Object.freeze(validPairUniverse),
    invalidPairs: Object.freeze(invalidPairs),
    validFamilyCount: diagnostics.validFamilyCount,
    candidateUnorderedPairCount: diagnostics.candidateUnorderedPairCount,
    validPairCount: diagnostics.validPairCount,
    familySupportGeometry: sanitizeFamilySupportGeometry(
      diagnostics.familySupportGeometry
    ),
    familyPairIndependenceDiagnostics: sanitizeFamilyPairIndependenceDiagnostics(
      diagnostics.familyPairIndependenceDiagnostics
    ),
    segmentCounts: Object.freeze({
      raw: finite(segmentCounts.raw) ? segmentCounts.raw : null,
      admittedAllNineInside: finite(segmentCounts.admittedAllNineInside)
        ? segmentCounts.admittedAllNineInside
        : null,
      roiOverlapDiagnosticAtLeastSevenOfNine: finite(
        segmentCounts.roiOverlapDiagnosticAtLeastSevenOfNine
      ) ? segmentCounts.roiOverlapDiagnosticAtLeastSevenOfNine : null,
    }),
  });
}

export type AfcSr1V3VpObservationV1 = Readonly<{
  homogeneous: HomogeneousPoint2 | null;
  kind: "finite" | "directional" | "degenerate";
  sourceNormalized: Readonly<{ x: number; y: number }> | null;
  side: "left" | "in_frame" | "right" | "directional" | "unavailable";
  horizonResidual: Readonly<{
    decodedPixelDistance: number | null;
    directionalAngularDegrees: number | null;
  }>;
}>;

export type AfcSr1V3CounterfactualPairDiagnosticV1 = Readonly<{
  counterfactualDiagnosticOnly: true;
  familyIndices: readonly [number, number];
  pair: AfcSr1V3ReaderPairDiagnosticV1;
  floorLineDecodedPixel: Line | null;
  impliedWidthVp: AfcSr1V3VpObservationV1;
  track1aStatus: "usable" | "rejected" | "unavailable";
  track1aReason: string | null;
  seamT: number | null;
}>;

export type AfcSr1V3ReaderForensicsV1 = Readonly<{
  sourceNormalizedHorizon: HomogeneousLine2 | null;
  rawWidthVp: AfcSr1V3VpObservationV1;
  depthVp: AfcSr1V3VpObservationV1;
  authoritativeWidthVp: AfcSr1V3VpObservationV1;
  widthVpSideChanged: boolean | null;
  nearEdgeOrientationChanged: boolean | null;
  winningPairReplay: Readonly<{
    status: "match" | "mismatch" | "unavailable";
    seamT: number | null;
  }>;
  otherValidPairs: readonly AfcSr1V3CounterfactualPairDiagnosticV1[];
}>;

/** Maps a retained V3 pair line from analysis pixels to decoded EMPTY pixels. */
export function mapAfcSr1V3AnalysisLineToDecodedPixel(
  pair: AfcSr1V3ReaderPairDiagnosticV1,
  identity: AfcSr1V3ReaderDiagnosticsV1["analysisIdentity"]
): Line | null {
  // V3 maps analysis points to decoded EMPTY pixels with
  // H = diag(scaleX, scaleY, 1), where scale = decoded / analysis.
  // Lines therefore use the dual H^(-T), not H^T.
  return normalizeCanonicalLine({
    a: pair.floorLineAnalysis[0] / identity.scaleX,
    b: pair.floorLineAnalysis[1] / identity.scaleY,
    c: pair.floorLineAnalysis[2],
  });
}

/** Maps an analysis-pixel point with H = diag(scaleX, scaleY, 1). */
export function mapAfcSr1V3AnalysisPointToDecodedPixel(
  point: Readonly<{ x: number; y: number }>,
  identity: AfcSr1V3ReaderDiagnosticsV1["analysisIdentity"]
): Readonly<{ x: number; y: number }> | null {
  if (!finite(point.x) || !finite(point.y)) return null;
  return Object.freeze({
    x: point.x * identity.scaleX,
    y: point.y * identity.scaleY,
  });
}

/** Normalizes a decoded EMPTY pixel point against that exact decoded raster. */
export function mapAfcSr1V3DecodedPointToSourceNormalized(
  point: Readonly<{ x: number; y: number }>,
  image: AfcSr1V3ReaderDiagnosticsV1["imageIdentity"]
): Readonly<{ x: number; y: number }> | null {
  if (!finite(point.x) || !finite(point.y)) return null;
  return Object.freeze({
    x: point.x / image.decodedWidth,
    y: point.y / image.decodedHeight,
  });
}

function observation(
  point: HomogeneousPoint2 | null,
  horizon: Line,
  image: AfcSr1V3ReaderDiagnosticsV1["imageIdentity"]
): AfcSr1V3VpObservationV1 {
  const normalized = point ? normalizePointForDiagnostics(point) : null;
  if (!normalized) {
    return Object.freeze({
      homogeneous: null, kind: "degenerate", sourceNormalized: null, side: "unavailable",
      horizonResidual: Object.freeze({ decodedPixelDistance: null, directionalAngularDegrees: null }),
    });
  }
  if (isFiniteHomogeneousPoint(normalized)) {
    const finitePoint = euclideanizeFinitePoint(normalized);
    if (!finitePoint) {
      return Object.freeze({
        homogeneous: normalized, kind: "degenerate", sourceNormalized: null, side: "unavailable",
        horizonResidual: Object.freeze({ decodedPixelDistance: null, directionalAngularDegrees: null }),
      });
    }
    const side = finitePoint.x < 0 ? "left" : finitePoint.x > 1 ? "right" : "in_frame";
    return Object.freeze({
      homogeneous: normalized,
      kind: "finite",
      sourceNormalized: finitePoint,
      side,
      horizonResidual: Object.freeze({
        decodedPixelDistance: Math.abs(
          horizon.a * finitePoint.x * image.decodedWidth +
          horizon.b * finitePoint.y * image.decodedHeight + horizon.c
        ),
        directionalAngularDegrees: null,
      }),
    });
  }
  const denominator = Math.hypot(horizon.a, horizon.b) * Math.hypot(normalized.x, normalized.y);
  const ratio = denominator === 0 ? null :
    Math.min(1, Math.max(0, Math.abs(horizon.a * normalized.x + horizon.b * normalized.y) / denominator));
  return Object.freeze({
    homogeneous: normalized,
    kind: "directional",
    sourceNormalized: null,
    side: "directional",
    horizonResidual: Object.freeze({
      decodedPixelDistance: null,
      directionalAngularDegrees: ratio === null ? null : Math.asin(ratio) * 180 / Math.PI,
    }),
  });
}

function intersectPolygonEdges(
  polygon: AfcSr1SourcePolygon,
  first: readonly [number, number],
  second: readonly [number, number]
): HomogeneousPoint2 | null {
  const firstLine = lineThroughPoints(
    finitePointToHomogeneous(polygon[first[0]])!,
    finitePointToHomogeneous(polygon[first[1]])!
  );
  const secondLine = lineThroughPoints(
    finitePointToHomogeneous(polygon[second[0]])!,
    finitePointToHomogeneous(polygon[second[1]])!
  );
  return firstLine && secondLine ? intersectLines(firstLine, secondLine) : null;
}

function samePair(
  first: AfcSr1V3ReaderPairDiagnosticV1,
  second: AfcSr1V3ReaderPairDiagnosticV1
): boolean {
  return first.familyIndices[0] === second.familyIndices[0] &&
    first.familyIndices[1] === second.familyIndices[1] &&
    first.floorLineAnalysis.every((value, index) => value === second.floorLineAnalysis[index]);
}

/**
 * Pure, local display derivation.  It never mutates or supplies a value to
 * PATH A, TR0 authority, Floor Apply, Camera Apply, or Perspective Adjust.
 */
export function deriveAfcSr1V3ReaderForensics(input: Readonly<{
  diagnostics: AfcSr1V3ReaderDiagnosticsV1;
  rawPolygon: AfcSr1SourcePolygon;
  finalPolygon: AfcSr1SourcePolygon | null;
  fixedAnchor: "NL" | "NR" | null;
  authoritativeSeamT: number | null;
}>): AfcSr1V3ReaderForensicsV1 {
  const { diagnostics, rawPolygon } = input;
  const horizon = convertAfcSr1PixelLineToSourceNormalized(
    { decodedWidth: diagnostics.imageIdentity.decodedWidth, decodedHeight: diagnostics.imageIdentity.decodedHeight },
    diagnostics.floorVanishingLinePixel
  );
  const rawWidth = intersectPolygonEdges(rawPolygon, [0, 1], [3, 2]);
  const depth = intersectPolygonEdges(rawPolygon, [0, 3], [1, 2]);
  const farWidthLine = lineThroughPoints(
    finitePointToHomogeneous(rawPolygon[3])!,
    finitePointToHomogeneous(rawPolygon[2])!
  );
  const authoritativeWidth = horizon && farWidthLine ? intersectLines(horizon, farWidthLine) : null;
  const rawWidthVp = observation(rawWidth, diagnostics.floorVanishingLinePixel, diagnostics.imageIdentity);
  const depthVp = observation(depth, diagnostics.floorVanishingLinePixel, diagnostics.imageIdentity);
  const authoritativeWidthVp = observation(authoritativeWidth, diagnostics.floorVanishingLinePixel, diagnostics.imageIdentity);
  const rawNearOrientation = Math.sign(
    (rawPolygon[1].y - rawPolygon[0].y) * (rawPolygon[1].x - rawPolygon[0].x)
  );
  const finalNearOrientation = input.finalPolygon
    ? Math.sign(
        (input.finalPolygon[1].y - input.finalPolygon[0].y) *
        (input.finalPolygon[1].x - input.finalPolygon[0].x)
      )
    : 0;
  const counterfactual = (pair: AfcSr1V3ReaderPairDiagnosticV1): AfcSr1V3CounterfactualPairDiagnosticV1 => {
    const floorLineDecodedPixel = mapAfcSr1V3AnalysisLineToDecodedPixel(
      pair,
      diagnostics.analysisIdentity
    );
    const derived = floorLineDecodedPixel && input.fixedAnchor
      ? deriveAfcSr1FloorVanishingLineCrossRoom({
          analysisImage: {
            decodedWidth: diagnostics.imageIdentity.decodedWidth,
            decodedHeight: diagnostics.imageIdentity.decodedHeight,
          },
          floorVanishingLinePixel: floorLineDecodedPixel,
          sourcePolygon: rawPolygon,
          truncatedAnchor: input.fixedAnchor,
        })
      : null;
    const implied = derived?.status === "usable"
      ? derived.widthVanishingPoint.homogeneous
      : floorLineDecodedPixel && farWidthLine
        ? intersectLines(
            convertAfcSr1PixelLineToSourceNormalized(
              { decodedWidth: diagnostics.imageIdentity.decodedWidth, decodedHeight: diagnostics.imageIdentity.decodedHeight },
              floorLineDecodedPixel
            )!,
            farWidthLine
          )
        : null;
    return Object.freeze({
      counterfactualDiagnosticOnly: true,
      familyIndices: pair.familyIndices,
      pair,
      floorLineDecodedPixel,
      impliedWidthVp: observation(implied, floorLineDecodedPixel ?? diagnostics.floorVanishingLinePixel, diagnostics.imageIdentity),
      track1aStatus: derived === null ? "unavailable" : derived.status,
      track1aReason: derived?.status === "rejected" ? derived.reason : null,
      seamT: derived?.status === "usable" ? derived.prior.seamT : null,
    });
  };
  const winning = counterfactual(diagnostics.winningPair);
  const replay = winning.seamT === null || input.authoritativeSeamT === null
    ? Object.freeze({ status: "unavailable" as const, seamT: winning.seamT })
    : Object.freeze({
        status: Math.abs(winning.seamT - input.authoritativeSeamT) <= 1e-10
          ? "match" as const
          : "mismatch" as const,
        seamT: winning.seamT,
      });
  return Object.freeze({
    sourceNormalizedHorizon: horizon,
    rawWidthVp,
    depthVp,
    authoritativeWidthVp,
    widthVpSideChanged: rawWidthVp.side === "unavailable" ||
        authoritativeWidthVp.side === "unavailable"
      ? null
      : rawWidthVp.side !== authoritativeWidthVp.side,
    nearEdgeOrientationChanged: !input.finalPolygon ||
        rawNearOrientation === 0 || finalNearOrientation === 0
      ? null
      : rawNearOrientation !== finalNearOrientation,
    winningPairReplay: replay,
    otherValidPairs: Object.freeze(
      diagnostics.validPairUniverse
        .filter((pair) => !samePair(pair, diagnostics.winningPair))
        .map(counterfactual)
    ),
  });
}
