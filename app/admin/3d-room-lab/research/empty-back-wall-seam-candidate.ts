import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
  type EmptyPhysicalBoundaryFixture,
  verifyEmptyPhysicalBoundaryFixtureIdentity,
} from "./empty-physical-boundary-read";

export const BACK_WALL_SEAM_PROPOSAL_FAMILY = "local-wall-floor-transition-scan" as const;
export const BACK_WALL_SEAM_PROPOSAL_VERSION = "p2-s1b/v1" as const;

export type SourcePoint = Readonly<{ x: number; y: number }>;
export type CandidateStatus = "proposed" | "rejected" | "accepted_research";
export type CandidateRejectionReason =
  | "too_short"
  | "touches_image_border_margin"
  | "angle_outside_back_wall_family"
  | "weak_aggregate_appearance"
  | "ambiguous_competing_parallel_response"
  | "dominated_by_competing_parallel_response";

export type BackWallSeamDetectorParameters = Readonly<{
  roiYMinNormalized: number;
  roiYMaxNormalized: number;
  borderMarginPx: number;
  horizontalSampleRadiusPx: number;
  sampleOffsetPx: number;
  sampleHalfHeightPx: number;
  minimumLumaDrop: number;
  minimumRgbDistance: number;
  maxYJumpPx: number;
  maxJoinGapPx: number;
  minimumRunLengthPx: number;
  maximumAbsAngleDeg: number;
  localHeadingSupportPx: number;
  minimumAcceptedMeanLumaDrop: number;
  minimumAcceptedMeanRgbDistance: number;
  competitionMinimumRunLengthPx: number;
  competitionMinimumXOverlapFraction: number;
  competitionMaximumAngleDifferenceDeg: number;
  competitionMaximumMedianSeparationPx: number;
  appearanceDominanceRatio: number;
  requireUniqueLateralResponse: boolean;
}>;

/**
 * Frozen only after the Room A development pass. The ROI and lateral-family
 * limit are proposal restrictions, not wall evidence. Appearance thresholds,
 * linking, and competition margins are experiment hypotheses, not certified
 * geometry. The six-pixel oracle corridor is intentionally absent.
 */
export const P2_S1B_FROZEN_PARAMETERS: BackWallSeamDetectorParameters = Object.freeze({
  roiYMinNormalized: 0.55,
  roiYMaxNormalized: 0.82,
  borderMarginPx: 8,
  horizontalSampleRadiusPx: 1,
  sampleOffsetPx: 3,
  sampleHalfHeightPx: 3,
  minimumLumaDrop: 10,
  minimumRgbDistance: 18,
  maxYJumpPx: 2,
  maxJoinGapPx: 1,
  minimumRunLengthPx: 32,
  maximumAbsAngleDeg: 15,
  localHeadingSupportPx: 8,
  minimumAcceptedMeanLumaDrop: 16,
  minimumAcceptedMeanRgbDistance: 25,
  competitionMinimumRunLengthPx: 32,
  competitionMinimumXOverlapFraction: 0.4,
  competitionMaximumAngleDifferenceDeg: 4,
  competitionMaximumMedianSeparationPx: 80,
  appearanceDominanceRatio: 1.4,
  requireUniqueLateralResponse: true,
});

export type ColumnTransitionResponse = Readonly<{
  x: number;
  y: number;
  lumaDrop: number;
  rgbDistance: number;
  score: number;
}>;

export type LinkedTransitionRun = Readonly<{
  points: readonly ColumnTransitionResponse[];
}>;

export type LocalHeadingSplit = Readonly<{
  originalRunIndex: number;
  splitPointSourcePx: SourcePoint;
  transition: "outside_to_inside" | "inside_to_outside";
  fromWindowAngleDeg: number;
  toWindowAngleDeg: number;
}>;

export type BackWallSeamProposal = Readonly<{
  id: string;
  roomId: string;
  emptyImageSha256: string;
  coordinateSpace: typeof EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE;
  proposalFamily: typeof BACK_WALL_SEAM_PROPOSAL_FAMILY;
  proposalVersion: typeof BACK_WALL_SEAM_PROPOSAL_VERSION;
  status: CandidateStatus;
  rejectionReasons: readonly CandidateRejectionReason[];
  pointsSourceNormalized: readonly SourcePoint[];
  sourcePixelLength: number;
  imageSpaceAngleDeg: number;
  evidence: Readonly<{
    supportColumnCount: number;
    xSpanPx: number;
    supportColumnFraction: number;
    meanLumaDrop: number;
    minimumLumaDrop: number;
    meanRgbDistance: number;
    minimumRgbDistance: number;
    meanTransitionScore: number;
  }>;
}>;

export type BackWallSeamReadResult =
  | Readonly<{
      ok: true;
      observedIdentity: Readonly<{
        sha256: string;
        dimensions: Readonly<{ width: number; height: number }>;
      }>;
      parameters: BackWallSeamDetectorParameters;
      localHeadingSplits: readonly LocalHeadingSplit[];
      proposals: readonly BackWallSeamProposal[];
      accepted: readonly BackWallSeamProposal[];
    }>
  | Readonly<{ ok: false; reason: "decode_failed" | "fixture_identity_mismatch" }>;

type DecodedAppearance = Readonly<{
  roomId: string;
  sha256: string;
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}>;

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function polylineLength(points: readonly SourcePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function angleDeg(points: readonly SourcePoint[]): number {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 0;
  return Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI;
}

function pixelLuma(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function patchMeanRgb(
  image: DecodedAppearance,
  x: number,
  yStart: number,
  yEnd: number,
  horizontalRadius: number
): readonly [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let sampleX = x - horizontalRadius; sampleX <= x + horizontalRadius; sampleX += 1) {
      const offset = (y * image.width + sampleX) * image.channels;
      red += image.pixels[offset];
      green += image.pixels[offset + 1];
      blue += image.pixels[offset + 2];
      count += 1;
    }
  }
  return [red / count, green / count, blue / count];
}

/**
 * Produces at most one locally strongest wall-above/floor-below transition per
 * source column. This function has no fixture/oracle input.
 */
export function scanLocalWallFloorTransitions(
  image: DecodedAppearance,
  parameters: BackWallSeamDetectorParameters
): readonly (ColumnTransitionResponse | null)[] {
  const responses: (ColumnTransitionResponse | null)[] = Array.from({ length: image.width }, () => null);
  const patchReach = parameters.sampleOffsetPx + parameters.sampleHalfHeightPx;
  const yMin = Math.max(patchReach, Math.ceil(image.height * parameters.roiYMinNormalized));
  const yMax = Math.min(image.height - 1 - patchReach, Math.floor(image.height * parameters.roiYMaxNormalized));
  const xMin = parameters.horizontalSampleRadiusPx;
  const xMax = image.width - 1 - parameters.horizontalSampleRadiusPx;

  for (let x = xMin; x <= xMax; x += 1) {
    let best: ColumnTransitionResponse | null = null;
    for (let y = yMin; y <= yMax; y += 1) {
      const above = patchMeanRgb(
        image,
        x,
        y - parameters.sampleOffsetPx - parameters.sampleHalfHeightPx + 1,
        y - parameters.sampleOffsetPx,
        parameters.horizontalSampleRadiusPx
      );
      const below = patchMeanRgb(
        image,
        x,
        y + parameters.sampleOffsetPx,
        y + parameters.sampleOffsetPx + parameters.sampleHalfHeightPx - 1,
        parameters.horizontalSampleRadiusPx
      );
      const lumaDrop = pixelLuma(...above) - pixelLuma(...below);
      const rgbDistance = Math.hypot(
        above[0] - below[0],
        above[1] - below[1],
        above[2] - below[2]
      );
      if (lumaDrop < parameters.minimumLumaDrop || rgbDistance < parameters.minimumRgbDistance) continue;
      const score = lumaDrop + 0.25 * rgbDistance;
      if (!best || score > best.score || (score === best.score && y < best.y)) {
        best = Object.freeze({ x, y, lumaDrop, rgbDistance, score });
      }
    }
    responses[x] = best;
  }
  return Object.freeze(responses);
}

/**
 * Tiny gaps may keep one run, but no points are synthesized. Larger gaps and
 * excessive vertical jumps always split.
 */
export function linkColumnTransitionResponses(
  responses: readonly (ColumnTransitionResponse | null)[],
  maxYJumpPx: number,
  maxJoinGapPx: number
): readonly LinkedTransitionRun[] {
  const runs: LinkedTransitionRun[] = [];
  let current: ColumnTransitionResponse[] = [];
  let last: ColumnTransitionResponse | null = null;

  const finish = () => {
    if (current.length > 0) runs.push(Object.freeze({ points: Object.freeze(current) }));
    current = [];
    last = null;
  };

  for (const response of responses) {
    if (!response) continue;
    if (last) {
      const unsupportedColumns = response.x - last.x - 1;
      const allowedYJump = maxYJumpPx * (unsupportedColumns + 1);
      if (unsupportedColumns > maxJoinGapPx || Math.abs(response.y - last.y) > allowedYJump) finish();
    }
    current.push(response);
    last = response;
  }
  finish();
  return Object.freeze(runs);
}

type LocalHeadingWindow = Readonly<{
  startIndex: number;
  endIndex: number;
  angleDeg: number;
  insideBackWallFamily: boolean;
}>;

function robustLocalAngleDeg(
  points: readonly ColumnTransitionResponse[],
  startIndex: number,
  endIndex: number
): number {
  const slopes: number[] = [];
  for (let leftIndex = startIndex; leftIndex < endIndex; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex <= endIndex; rightIndex += 1) {
      const dx = points[rightIndex].x - points[leftIndex].x;
      if (dx > 0) slopes.push((points[rightIndex].y - points[leftIndex].y) / dx);
    }
  }
  slopes.sort((left, right) => left - right);
  const middle = Math.floor(slopes.length / 2);
  const medianSlope = slopes.length % 2 === 0
    ? (slopes[middle - 1] + slopes[middle]) / 2
    : slopes[middle];
  return Math.atan(medianSlope ?? 0) * 180 / Math.PI;
}

function localHeadingWindows(
  run: LinkedTransitionRun,
  supportPx: number,
  maximumAbsAngleDeg: number
): readonly LocalHeadingWindow[] {
  const windows: LocalHeadingWindow[] = [];
  for (let startIndex = 0; startIndex < run.points.length - 1; startIndex += 1) {
    let endIndex = startIndex + 1;
    while (
      endIndex < run.points.length &&
      run.points[endIndex].x - run.points[startIndex].x < supportPx
    ) endIndex += 1;
    if (endIndex >= run.points.length) break;
    const localAngleDeg = robustLocalAngleDeg(run.points, startIndex, endIndex);
    windows.push(Object.freeze({
      startIndex,
      endIndex,
      angleDeg: localAngleDeg,
      insideBackWallFamily: Math.abs(localAngleDeg) <= maximumAbsAngleDeg,
    }));
  }
  return Object.freeze(windows);
}

/**
 * A full support window is the persistence requirement: individual point
 * slopes never trigger a split. When overlapping local windows cross the
 * existing back-wall angle boundary, the run is split at the fail-closed edge
 * of that transition before the ordinary proposal gates are reapplied.
 */
export function splitLinkedTransitionRunsAtLocalHeadingTransitions(
  runs: readonly LinkedTransitionRun[],
  supportPx: number,
  maximumAbsAngleDeg: number
): Readonly<{
  runs: readonly LinkedTransitionRun[];
  splits: readonly LocalHeadingSplit[];
}> {
  const fragments: LinkedTransitionRun[] = [];
  const splits: LocalHeadingSplit[] = [];

  for (let originalRunIndex = 0; originalRunIndex < runs.length; originalRunIndex += 1) {
    const run = runs[originalRunIndex];
    const windows = localHeadingWindows(run, supportPx, maximumAbsAngleDeg);
    const splitByIndex = new Map<number, LocalHeadingSplit>();
    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const current = windows[index];
      if (previous.insideBackWallFamily === current.insideBackWallFamily) continue;
      const outsideToInside = !previous.insideBackWallFamily && current.insideBackWallFamily;
      const splitIndex = outsideToInside ? previous.endIndex : current.startIndex;
      if (splitIndex <= 0 || splitIndex >= run.points.length - 1) continue;
      const splitPoint = run.points[splitIndex];
      if (splitByIndex.has(splitIndex)) continue;
      splitByIndex.set(splitIndex, Object.freeze({
        originalRunIndex,
        splitPointSourcePx: Object.freeze({ x: splitPoint.x, y: splitPoint.y }),
        transition: outsideToInside ? "outside_to_inside" : "inside_to_outside",
        fromWindowAngleDeg: previous.angleDeg,
        toWindowAngleDeg: current.angleDeg,
      }));
    }

    const splitIndexes = [...splitByIndex.keys()].sort((left, right) => left - right);
    for (const splitIndex of splitIndexes) {
      const diagnostic = splitByIndex.get(splitIndex);
      if (diagnostic) splits.push(diagnostic);
    }
    let fragmentStartIndex = 0;
    for (const splitIndex of splitIndexes) {
      fragments.push(Object.freeze({
        points: Object.freeze(run.points.slice(fragmentStartIndex, splitIndex + 1)),
      }));
      fragmentStartIndex = splitIndex;
    }
    fragments.push(Object.freeze({
      points: Object.freeze(run.points.slice(fragmentStartIndex)),
    }));
  }

  return Object.freeze({
    runs: Object.freeze(fragments),
    splits: Object.freeze(splits),
  });
}

type MutableClassification = {
  proposal: BackWallSeamProposal;
  reasons: CandidateRejectionReason[];
};

function xRange(proposal: BackWallSeamProposal, width: number): readonly [number, number] {
  const xs = proposal.pointsSourceNormalized.map(point => point.x * width);
  return [Math.min(...xs), Math.max(...xs)];
}

function medianYAtOverlap(
  proposal: BackWallSeamProposal,
  overlapMin: number,
  overlapMax: number,
  width: number,
  height: number
): number {
  const ys = proposal.pointsSourceNormalized
    .filter(point => point.x * width >= overlapMin && point.x * width <= overlapMax)
    .map(point => point.y * height)
    .sort((left, right) => left - right);
  if (ys.length === 0) return Number.POSITIVE_INFINITY;
  return ys[Math.floor(ys.length / 2)];
}

/**
 * Applies only explicit research gates. A surviving status is not a physical
 * wall assertion and has no collision semantics.
 */
export function classifyBackWallSeamProposals(
  proposed: readonly BackWallSeamProposal[],
  dimensions: Readonly<{ width: number; height: number }>,
  parameters: BackWallSeamDetectorParameters
): readonly BackWallSeamProposal[] {
  const classified: MutableClassification[] = proposed.map(proposal => {
    const reasons: CandidateRejectionReason[] = [];
    const [minimumX, maximumX] = xRange(proposal, dimensions.width);
    if (proposal.evidence.xSpanPx < parameters.minimumRunLengthPx) reasons.push("too_short");
    if (minimumX <= parameters.borderMarginPx || maximumX >= dimensions.width - 1 - parameters.borderMarginPx) {
      reasons.push("touches_image_border_margin");
    }
    if (Math.abs(proposal.imageSpaceAngleDeg) > parameters.maximumAbsAngleDeg) {
      reasons.push("angle_outside_back_wall_family");
    }
    if (
      proposal.evidence.meanLumaDrop < parameters.minimumAcceptedMeanLumaDrop ||
      proposal.evidence.meanRgbDistance < parameters.minimumAcceptedMeanRgbDistance
    ) {
      reasons.push("weak_aggregate_appearance");
    }
    return { proposal, reasons };
  });

  const competitionEligible = classified.filter(item =>
    item.proposal.evidence.xSpanPx >= parameters.competitionMinimumRunLengthPx &&
    Math.abs(item.proposal.imageSpaceAngleDeg) <= parameters.maximumAbsAngleDeg &&
    !item.reasons.includes("touches_image_border_margin")
  );

  for (let leftIndex = 0; leftIndex < competitionEligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < competitionEligible.length; rightIndex += 1) {
      const left = competitionEligible[leftIndex];
      const right = competitionEligible[rightIndex];
      const [leftMin, leftMax] = xRange(left.proposal, dimensions.width);
      const [rightMin, rightMax] = xRange(right.proposal, dimensions.width);
      const overlapMin = Math.max(leftMin, rightMin);
      const overlapMax = Math.min(leftMax, rightMax);
      const overlap = Math.max(0, overlapMax - overlapMin);
      const shorterSpan = Math.min(leftMax - leftMin, rightMax - rightMin);
      if (shorterSpan <= 0 || overlap / shorterSpan < parameters.competitionMinimumXOverlapFraction) continue;
      if (
        Math.abs(left.proposal.imageSpaceAngleDeg - right.proposal.imageSpaceAngleDeg) >
        parameters.competitionMaximumAngleDifferenceDeg
      ) continue;
      const separation = Math.abs(
        medianYAtOverlap(left.proposal, overlapMin, overlapMax, dimensions.width, dimensions.height) -
        medianYAtOverlap(right.proposal, overlapMin, overlapMax, dimensions.width, dimensions.height)
      );
      if (separation > parameters.competitionMaximumMedianSeparationPx) continue;

      const leftScore = left.proposal.evidence.meanTransitionScore;
      const rightScore = right.proposal.evidence.meanTransitionScore;
      if (leftScore >= rightScore * parameters.appearanceDominanceRatio) {
        right.reasons.push("dominated_by_competing_parallel_response");
      } else if (rightScore >= leftScore * parameters.appearanceDominanceRatio) {
        left.reasons.push("dominated_by_competing_parallel_response");
      } else {
        left.reasons.push("ambiguous_competing_parallel_response");
        right.reasons.push("ambiguous_competing_parallel_response");
      }
    }
  }

  if (parameters.requireUniqueLateralResponse) {
    const viable = classified
      .filter(item => item.reasons.length === 0)
      .sort((left, right) =>
        right.proposal.evidence.meanTransitionScore - left.proposal.evidence.meanTransitionScore ||
        left.proposal.id.localeCompare(right.proposal.id)
      );
    if (viable.length > 1) {
      const strongest = viable[0];
      const runnerUp = viable[1];
      if (
        strongest.proposal.evidence.meanTransitionScore >=
        runnerUp.proposal.evidence.meanTransitionScore * parameters.appearanceDominanceRatio
      ) {
        for (const item of viable.slice(1)) item.reasons.push("dominated_by_competing_parallel_response");
      } else {
        for (const item of viable) item.reasons.push("ambiguous_competing_parallel_response");
      }
    }
  }

  return Object.freeze(classified.map(({ proposal, reasons }) => Object.freeze({
    ...proposal,
    status: reasons.length === 0 ? "accepted_research" as const : "rejected" as const,
    rejectionReasons: Object.freeze([...new Set(reasons)]),
  })));
}

function proposalsFromRuns(
  image: DecodedAppearance,
  runs: readonly LinkedTransitionRun[]
): readonly BackWallSeamProposal[] {
  return Object.freeze(runs.map((run, index) => {
    const sourcePoints = run.points.map(point => Object.freeze({
      x: point.x / image.width,
      y: point.y / image.height,
    }));
    const lumaDrops = run.points.map(point => point.lumaDrop);
    const rgbDistances = run.points.map(point => point.rgbDistance);
    const scores = run.points.map(point => point.score);
    const first = run.points[0];
    const last = run.points.at(-1) ?? first;
    const xSpanPx = last.x - first.x;
    return Object.freeze({
      id: `${BACK_WALL_SEAM_PROPOSAL_VERSION}:${image.roomId}:${String(index).padStart(4, "0")}`,
      roomId: image.roomId,
      emptyImageSha256: image.sha256,
      coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
      proposalFamily: BACK_WALL_SEAM_PROPOSAL_FAMILY,
      proposalVersion: BACK_WALL_SEAM_PROPOSAL_VERSION,
      status: "proposed" as const,
      rejectionReasons: Object.freeze([]),
      pointsSourceNormalized: Object.freeze(sourcePoints),
      sourcePixelLength: polylineLength(run.points),
      imageSpaceAngleDeg: angleDeg(run.points),
      evidence: Object.freeze({
        supportColumnCount: run.points.length,
        xSpanPx,
        supportColumnFraction: run.points.length / (xSpanPx + 1),
        meanLumaDrop: mean(lumaDrops),
        minimumLumaDrop: Math.min(...lumaDrops),
        meanRgbDistance: mean(rgbDistances),
        minimumRgbDistance: Math.min(...rgbDistances),
        meanTransitionScore: mean(scores),
      }),
    });
  }));
}

async function decodeCertifiedAppearance(
  imageBytes: Uint8Array,
  fixture: EmptyPhysicalBoundaryFixture
): Promise<DecodedAppearance | null> {
  try {
    const decoded = await sharp(imageBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sha256 = createHash("sha256").update(imageBytes).digest("hex");
    const observed = {
      sha256,
      dimensions: { width: decoded.info.width, height: decoded.info.height },
    };
    if (!verifyEmptyPhysicalBoundaryFixtureIdentity(fixture, observed) || decoded.info.channels < 3) return null;
    return Object.freeze({
      roomId: fixture.roomId,
      sha256,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      pixels: decoded.data,
    });
  } catch {
    return null;
  }
}

/**
 * Fixture access ends at identity verification. Detection receives only native
 * decoded appearance and sanitized room/image identity.
 */
export async function readCertifiedEmptyBackWallSeamCandidates(
  imageBytes: Uint8Array,
  fixture: EmptyPhysicalBoundaryFixture,
  parameters: BackWallSeamDetectorParameters = P2_S1B_FROZEN_PARAMETERS
): Promise<BackWallSeamReadResult> {
  const image = await decodeCertifiedAppearance(imageBytes, fixture);
  if (!image) return { ok: false, reason: "fixture_identity_mismatch" };
  const responses = scanLocalWallFloorTransitions(image, parameters);
  const linkedRuns = linkColumnTransitionResponses(responses, parameters.maxYJumpPx, parameters.maxJoinGapPx);
  const localHeading = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    linkedRuns,
    parameters.localHeadingSupportPx,
    parameters.maximumAbsAngleDeg
  );
  const proposals = classifyBackWallSeamProposals(
    proposalsFromRuns(image, localHeading.runs),
    { width: image.width, height: image.height },
    parameters
  );
  return Object.freeze({
    ok: true,
    observedIdentity: Object.freeze({
      sha256: image.sha256,
      dimensions: Object.freeze({ width: image.width, height: image.height }),
    }),
    parameters,
    localHeadingSplits: localHeading.splits,
    proposals,
    accepted: Object.freeze(proposals.filter(proposal => proposal.status === "accepted_research")),
  });
}

type PixelPolyline = readonly SourcePoint[];

export type BackWallSeamRoomEvaluation = Readonly<{
  roomId: string;
  proposedRunCount: number;
  rejectedRunCount: number;
  rejectionReasonCounts: Readonly<Partial<Record<CandidateRejectionReason, number>>>;
  acceptedResearchCount: number;
  acceptedSourcePixelLengths: readonly number[];
  oracleCoverageFraction: number;
  acceptedSupportedLengthFraction: number;
  offOracleFraction: number;
  meanCandidateToOracleDistanceForSupportedSamples: number | null;
  maxCandidateToOracleDistance: number | null;
  hardFail: boolean;
  illegalBridge: boolean;
}>;

function toPixelPolyline(points: readonly SourcePoint[], width: number, height: number): PixelPolyline {
  return points.map(point => ({ x: point.x * width, y: point.y * height }));
}

function samplePolyline(points: PixelPolyline, spacingPx = 1): readonly SourcePoint[] {
  const samples: SourcePoint[] = [];
  for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
    const start = points[segmentIndex - 1];
    const end = points[segmentIndex];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(length / spacingPx));
    for (let step = segmentIndex === 1 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      samples.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    }
  }
  return samples;
}

function pointToFiniteSegmentDistance(point: SourcePoint, start: SourcePoint, end: SourcePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointToFinitePolylinesDistance(point: SourcePoint, polylines: readonly PixelPolyline[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const polyline of polylines) {
    for (let index = 1; index < polyline.length; index += 1) {
      minimum = Math.min(minimum, pointToFiniteSegmentDistance(point, polyline[index - 1], polyline[index]));
    }
  }
  return minimum;
}

/**
 * Post-acceptance scorer. It alone reads P2-S1A coordinates and its six-pixel
 * corridor, and measures against finite trusted polylines rather than fitted
 * or infinite lines.
 */
export function evaluateBackWallSeamCandidates(
  proposals: readonly BackWallSeamProposal[],
  fixture: EmptyPhysicalBoundaryFixture
): BackWallSeamRoomEvaluation {
  const { width, height } = fixture.emptyImage.dimensions;
  const rearAnnotations = fixture.annotations.filter(annotation => annotation.interpretation === "rear_floor_wall_seam");
  const oraclePolylines = rearAnnotations.map(annotation =>
    toPixelPolyline(annotation.pointsSourceNormalized, width, height)
  );
  const accepted = proposals.filter(proposal => proposal.status === "accepted_research");
  const acceptedSamplesByProposal = accepted.map(proposal =>
    samplePolyline(toPixelPolyline(proposal.pointsSourceNormalized, width, height))
  );
  const acceptedSamples = acceptedSamplesByProposal.flat();
  const candidateDistances = acceptedSamples.map(sample => pointToFinitePolylinesDistance(sample, oraclePolylines));
  const supportedDistances = candidateDistances.filter(distance => distance <= fixture.evaluationCorridorSourcePx);
  const oracleSamples = oraclePolylines.flatMap(polyline => samplePolyline(polyline));
  const coveredOracleSamples = oracleSamples.filter(sample =>
    acceptedSamplesByProposal.some(candidateSamples =>
      pointToFinitePolylinesDistance(sample, [candidateSamples]) <= fixture.evaluationCorridorSourcePx
    )
  );

  let illegalBridge = false;
  if (fixture.roomId === "room-c" && rearAnnotations.length > 1) {
    for (let proposalIndex = 0; proposalIndex < accepted.length; proposalIndex += 1) {
      const samples = acceptedSamplesByProposal[proposalIndex];
      const touchedAnnotations = rearAnnotations.filter(annotation => {
        const polyline = toPixelPolyline(annotation.pointsSourceNormalized, width, height);
        return samples.some(sample => pointToFinitePolylinesDistance(sample, [polyline]) <= fixture.evaluationCorridorSourcePx);
      });
      if (touchedAnnotations.length > 1) illegalBridge = true;
    }
    const sorted = oraclePolylines
      .map(polyline => ({ polyline, minX: Math.min(...polyline.map(point => point.x)), maxX: Math.max(...polyline.map(point => point.x)) }))
      .sort((left, right) => left.minX - right.minX);
    for (let index = 1; index < sorted.length; index += 1) {
      const gapStart = sorted[index - 1].maxX;
      const gapEnd = sorted[index].minX;
      if (acceptedSamples.some(sample =>
        sample.x > gapStart && sample.x < gapEnd &&
        pointToFinitePolylinesDistance(sample, oraclePolylines) > fixture.evaluationCorridorSourcePx
      )) illegalBridge = true;
    }
  }

  const rejectionReasonCounts: Partial<Record<CandidateRejectionReason, number>> = {};
  for (const proposal of proposals.filter(item => item.status === "rejected")) {
    for (const reason of proposal.rejectionReasons) {
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] ?? 0) + 1;
    }
  }
  const offOracleCount = candidateDistances.length - supportedDistances.length;
  return Object.freeze({
    roomId: fixture.roomId,
    proposedRunCount: proposals.length,
    rejectedRunCount: proposals.filter(proposal => proposal.status === "rejected").length,
    rejectionReasonCounts: Object.freeze(rejectionReasonCounts),
    acceptedResearchCount: accepted.length,
    acceptedSourcePixelLengths: Object.freeze(accepted.map(proposal => proposal.sourcePixelLength)),
    oracleCoverageFraction: oracleSamples.length === 0 ? 0 : coveredOracleSamples.length / oracleSamples.length,
    acceptedSupportedLengthFraction: candidateDistances.length === 0 ? 0 : supportedDistances.length / candidateDistances.length,
    offOracleFraction: candidateDistances.length === 0 ? 0 : offOracleCount / candidateDistances.length,
    meanCandidateToOracleDistanceForSupportedSamples:
      supportedDistances.length === 0 ? null : mean(supportedDistances),
    maxCandidateToOracleDistance: candidateDistances.length === 0 ? null : Math.max(...candidateDistances),
    hardFail: offOracleCount > 0 || illegalBridge,
    illegalBridge,
  });
}
