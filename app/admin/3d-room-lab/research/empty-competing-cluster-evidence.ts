import sharp from "sharp";

import {
  P2_S1B_FROZEN_PARAMETERS,
  type BackWallSeamDetectorParameters,
  type DecodedAppearance,
  patchMeanRgb,
  pixelLuma,
} from "./empty-back-wall-seam-candidate";
import {
  EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION,
  type CertifiedEmptyColumnFieldIdentity,
  type ColumnTransitionCandidate,
  type MultiResponseColumn,
  readCertifiedEmptyMultiResponseColumnField,
} from "./empty-multi-response-column-field";

export const EMPTY_COMPETING_CLUSTER_EVIDENCE_VERSION = "p2-s1e/v1" as const;

export type CandidateYOrder = "singleton" | "highest" | "middle" | "lowest";

export type CompetingClusterContextEvidence = Readonly<{
  x: number;
  y: number;
  rankInColumn: number;
  clusterIndexInColumn: number;
  score: number;
  lumaDrop: number;
  rgbDistance: number;
  scoreMarginToRank1: number;
  clusterYMin: number;
  clusterYMax: number;
  clusterWidthPx: number;
  offsetFromClusterTopPx: number;
  offsetFromClusterBottomPx: number;
  competingClusterCount: number;
  yOrderInColumn: CandidateYOrder;
  gapToNearestClusterAbovePx: number | null;
  gapToNearestClusterBelowPx: number | null;
  neighborDx1Exists: boolean;
  neighborDx1AbsDy: number | null;
  neighborDx1SignedDy: number | null;
  neighborDx1ScoreDelta: number | null;
  neighborDx1RankDelta: number | null;
  neighborDx1ClusterWidthDelta: number | null;
}>;

export type SamePatchAppearanceStatistics = Readonly<{
  aboveMeanRgb: readonly [number, number, number];
  belowMeanRgb: readonly [number, number, number];
  aboveLumaMean: number;
  belowLumaMean: number;
  aboveLumaVariance: number;
  belowLumaVariance: number;
}>;

export type CompetingClusterEvidence =
  CompetingClusterContextEvidence & SamePatchAppearanceStatistics;

export type EmptyCompetingClusterEvidenceReadResult =
  | Readonly<{
      ok: true;
      version: typeof EMPTY_COMPETING_CLUSTER_EVIDENCE_VERSION;
      sourceFieldVersion: typeof EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION;
      roomId: string;
      emptyImageSha256: string;
      coordinateSpace: "empty-source-pixels/v1";
      dimensions: Readonly<{ width: number; height: number }>;
      records: readonly CompetingClusterEvidence[];
    }>
  | Readonly<{ ok: false; reason: "decode_failed" | "fixture_identity_mismatch" }>;

function verticalCandidates(
  column: MultiResponseColumn
): readonly ColumnTransitionCandidate[] {
  return [...column.candidates].sort((left, right) =>
    left.clusterYMin - right.clusterYMin ||
    left.clusterYMax - right.clusterYMax ||
    left.y - right.y ||
    left.clusterIndexInColumn - right.clusterIndexInColumn
  );
}

/**
 * This is a one-column comparison only. The nearest x+1 candidate is ordered
 * by |dy|, then higher score, smaller y, and lower cluster index.
 */
function nearestCandidateInNextColumn(
  candidate: ColumnTransitionCandidate,
  nextCandidates: readonly ColumnTransitionCandidate[]
): ColumnTransitionCandidate | null {
  let nearest: ColumnTransitionCandidate | null = null;
  for (const neighbor of nextCandidates) {
    if (!nearest) {
      nearest = neighbor;
      continue;
    }
    const neighborAbsDy = Math.abs(neighbor.y - candidate.y);
    const nearestAbsDy = Math.abs(nearest.y - candidate.y);
    if (
      neighborAbsDy < nearestAbsDy ||
      (
        neighborAbsDy === nearestAbsDy &&
        (
          neighbor.score > nearest.score ||
          (
            neighbor.score === nearest.score &&
            (
              neighbor.y < nearest.y ||
              (
                neighbor.y === nearest.y &&
                neighbor.clusterIndexInColumn < nearest.clusterIndexInColumn
              )
            )
          )
        )
      )
    ) nearest = neighbor;
  }
  return nearest;
}

/**
 * Describes P2-S1D candidates in their existing column/rank order. Gaps are
 * distances between the nearest cluster boundaries; no gap is accepted or
 * rejected. Delta fields are x+1 neighbor values minus current values.
 */
export function describeCompetingClusterContext(
  columns: readonly MultiResponseColumn[]
): readonly CompetingClusterContextEvidence[] {
  const columnByX = new Map(columns.map(column => [column.x, column]));
  const records: CompetingClusterContextEvidence[] = [];

  for (const column of columns) {
    const vertical = verticalCandidates(column);
    const verticalIndex = new Map(
      vertical.map((candidate, index) => [candidate, index])
    );
    const nextCandidates = columnByX.get(column.x + 1)?.candidates ?? [];

    for (const candidate of column.candidates) {
      const index = verticalIndex.get(candidate);
      if (index === undefined) {
        throw new Error("P2-S1E candidate context invariant failed");
      }
      const above = index === 0 ? null : vertical[index - 1];
      const below = index === vertical.length - 1 ? null : vertical[index + 1];
      const neighbor = nearestCandidateInNextColumn(candidate, nextCandidates);
      const signedDy = neighbor ? neighbor.y - candidate.y : null;
      const yOrderInColumn: CandidateYOrder = vertical.length === 1
        ? "singleton"
        : index === 0
          ? "highest"
          : index === vertical.length - 1
            ? "lowest"
            : "middle";

      records.push(Object.freeze({
        x: candidate.x,
        y: candidate.y,
        rankInColumn: candidate.rankInColumn,
        clusterIndexInColumn: candidate.clusterIndexInColumn,
        score: candidate.score,
        lumaDrop: candidate.lumaDrop,
        rgbDistance: candidate.rgbDistance,
        scoreMarginToRank1: candidate.scoreMarginToRank1,
        clusterYMin: candidate.clusterYMin,
        clusterYMax: candidate.clusterYMax,
        clusterWidthPx: candidate.clusterWidthPx,
        offsetFromClusterTopPx: candidate.y - candidate.clusterYMin,
        offsetFromClusterBottomPx: candidate.clusterYMax - candidate.y,
        competingClusterCount: column.candidates.length - 1,
        yOrderInColumn,
        gapToNearestClusterAbovePx:
          above ? candidate.clusterYMin - above.clusterYMax : null,
        gapToNearestClusterBelowPx:
          below ? below.clusterYMin - candidate.clusterYMax : null,
        neighborDx1Exists: neighbor !== null,
        neighborDx1AbsDy: signedDy === null ? null : Math.abs(signedDy),
        neighborDx1SignedDy: signedDy,
        neighborDx1ScoreDelta: neighbor ? neighbor.score - candidate.score : null,
        neighborDx1RankDelta:
          neighbor ? neighbor.rankInColumn - candidate.rankInColumn : null,
        neighborDx1ClusterWidthDelta:
          neighbor ? neighbor.clusterWidthPx - candidate.clusterWidthPx : null,
      }));
    }
  }

  return Object.freeze(records);
}

function patchLumaVariance(
  image: DecodedAppearance,
  x: number,
  yStart: number,
  yEnd: number,
  horizontalRadius: number,
  lumaMean: number
): number {
  let squaredDeviation = 0;
  let count = 0;
  for (let y = yStart; y <= yEnd; y += 1) {
    for (
      let sampleX = x - horizontalRadius;
      sampleX <= x + horizontalRadius;
      sampleX += 1
    ) {
      const offset = (y * image.width + sampleX) * image.channels;
      const luma = pixelLuma(
        image.pixels[offset],
        image.pixels[offset + 1],
        image.pixels[offset + 2]
      );
      squaredDeviation += (luma - lumaMean) ** 2;
      count += 1;
    }
  }
  return squaredDeviation / count;
}

/**
 * Uses the frozen P2-S1B x radius, sample offset, and half-height at the exact
 * candidate coordinate. Variance is population variance of per-pixel luma.
 */
export function computeSamePatchAppearanceStatistics(
  image: DecodedAppearance,
  candidate: Pick<ColumnTransitionCandidate, "x" | "y">,
  parameters: BackWallSeamDetectorParameters = P2_S1B_FROZEN_PARAMETERS
): SamePatchAppearanceStatistics {
  const aboveYStart =
    candidate.y - parameters.sampleOffsetPx - parameters.sampleHalfHeightPx + 1;
  const aboveYEnd = candidate.y - parameters.sampleOffsetPx;
  const belowYStart = candidate.y + parameters.sampleOffsetPx;
  const belowYEnd =
    candidate.y + parameters.sampleOffsetPx + parameters.sampleHalfHeightPx - 1;
  const aboveMeanRgb = patchMeanRgb(
    image,
    candidate.x,
    aboveYStart,
    aboveYEnd,
    parameters.horizontalSampleRadiusPx
  );
  const belowMeanRgb = patchMeanRgb(
    image,
    candidate.x,
    belowYStart,
    belowYEnd,
    parameters.horizontalSampleRadiusPx
  );
  const aboveLumaMean = pixelLuma(...aboveMeanRgb);
  const belowLumaMean = pixelLuma(...belowMeanRgb);

  return Object.freeze({
    aboveMeanRgb: Object.freeze([...aboveMeanRgb]) as readonly [number, number, number],
    belowMeanRgb: Object.freeze([...belowMeanRgb]) as readonly [number, number, number],
    aboveLumaMean,
    belowLumaMean,
    aboveLumaVariance: patchLumaVariance(
      image,
      candidate.x,
      aboveYStart,
      aboveYEnd,
      parameters.horizontalSampleRadiusPx,
      aboveLumaMean
    ),
    belowLumaVariance: patchLumaVariance(
      image,
      candidate.x,
      belowYStart,
      belowYEnd,
      parameters.horizontalSampleRadiusPx,
      belowLumaMean
    ),
  });
}

/**
 * Reads exact EMPTY bytes through P2-S1D, then adds one diagnostic record per
 * preserved candidate. The identity-only input contains no evaluation data.
 */
export async function readCertifiedEmptyCompetingClusterEvidence(
  imageBytes: Uint8Array,
  identity: CertifiedEmptyColumnFieldIdentity
): Promise<EmptyCompetingClusterEvidenceReadResult> {
  const field = await readCertifiedEmptyMultiResponseColumnField(
    imageBytes,
    identity
  );
  if (!field.ok) return field;

  try {
    const decoded = await sharp(imageBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== field.dimensions.width ||
      decoded.info.height !== field.dimensions.height ||
      decoded.info.channels < 3
    ) return { ok: false, reason: "fixture_identity_mismatch" };
    const image: DecodedAppearance = Object.freeze({
      roomId: field.roomId,
      sha256: field.emptyImageSha256,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      pixels: decoded.data,
    });
    const contextRecords = describeCompetingClusterContext(field.columns);
    const records = contextRecords.map(record => Object.freeze({
      ...record,
      ...computeSamePatchAppearanceStatistics(image, record, field.parameters),
    }));

    return Object.freeze({
      ok: true,
      version: EMPTY_COMPETING_CLUSTER_EVIDENCE_VERSION,
      sourceFieldVersion: field.version,
      roomId: field.roomId,
      emptyImageSha256: field.emptyImageSha256,
      coordinateSpace: field.coordinateSpace,
      dimensions: field.dimensions,
      records: Object.freeze(records),
    });
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
}
