import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  P2_S1B_FROZEN_PARAMETERS,
  type BackWallSeamDetectorParameters,
  type ColumnTransitionResponse,
  type DecodedAppearance,
  patchMeanRgb,
  pixelLuma,
  scanLocalWallFloorTransitions,
} from "./empty-back-wall-seam-candidate";

export const EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION = "p2-s1d/v1" as const;
export const EMPTY_SOURCE_PIXEL_COORDINATE_SPACE = "empty-source-pixels/v1" as const;

export type CertifiedEmptyColumnFieldIdentity = Readonly<{
  roomId: string;
  sha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
}>;

export type ColumnTransitionCandidate = Readonly<{
  x: number;
  y: number;
  lumaDrop: number;
  rgbDistance: number;
  score: number;
  rankInColumn: number;
  clusterIndexInColumn: number;
  clusterYMin: number;
  clusterYMax: number;
  clusterWidthPx: number;
  equalsCertifiedWinner: boolean;
  scoreMarginToRank1: number;
}>;

export type MultiResponseColumn = Readonly<{
  x: number;
  certifiedWinner: ColumnTransitionResponse | null;
  candidates: readonly ColumnTransitionCandidate[];
}>;

export type EmptyMultiResponseColumnFieldReadResult =
  | Readonly<{
      ok: true;
      version: typeof EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION;
      roomId: string;
      emptyImageSha256: string;
      coordinateSpace: typeof EMPTY_SOURCE_PIXEL_COORDINATE_SPACE;
      dimensions: Readonly<{ width: number; height: number }>;
      parameters: BackWallSeamDetectorParameters;
      columns: readonly MultiResponseColumn[];
      winnerMismatchCount: number;
    }>
  | Readonly<{ ok: false; reason: "decode_failed" | "fixture_identity_mismatch" }>;

function responsePrecedes(
  left: ColumnTransitionResponse,
  right: ColumnTransitionResponse
): boolean {
  return left.score > right.score || (left.score === right.score && left.y < right.y);
}

function sameResponse(
  left: ColumnTransitionResponse,
  right: ColumnTransitionResponse
): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.lumaDrop === right.lumaDrop &&
    left.rgbDistance === right.rgbDistance &&
    left.score === right.score;
}

/**
 * Collapses only consecutive qualifying source rows. A missing qualifying row
 * always starts a new cluster. Cluster indexes are one-based in ascending y;
 * returned candidates are ordered by diagnostic score rank.
 */
export function clusterQualifyingColumnResponses(
  qualifyingResponses: readonly ColumnTransitionResponse[],
  certifiedWinner: ColumnTransitionResponse | null
): readonly ColumnTransitionCandidate[] {
  if (qualifyingResponses.length === 0) return Object.freeze([]);

  const ordered = [...qualifyingResponses].sort((left, right) =>
    left.y - right.y ||
    right.score - left.score
  );
  const clusters: ColumnTransitionResponse[][] = [];
  for (const response of ordered) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || response.y !== previous.y + 1) {
      clusters.push([response]);
    } else {
      current.push(response);
    }
  }

  const representatives = clusters.map((cluster, index) => {
    let representative = cluster[0];
    for (const response of cluster.slice(1)) {
      if (responsePrecedes(response, representative)) representative = response;
    }
    return {
      representative,
      clusterIndexInColumn: index + 1,
      clusterYMin: cluster[0].y,
      clusterYMax: cluster.at(-1)?.y ?? cluster[0].y,
    };
  });
  representatives.sort((left, right) =>
    right.representative.score - left.representative.score ||
    left.representative.y - right.representative.y ||
    left.clusterIndexInColumn - right.clusterIndexInColumn
  );
  const rank1Score = representatives[0].representative.score;

  return Object.freeze(representatives.map((cluster, index) => Object.freeze({
    ...cluster.representative,
    rankInColumn: index + 1,
    clusterIndexInColumn: cluster.clusterIndexInColumn,
    clusterYMin: cluster.clusterYMin,
    clusterYMax: cluster.clusterYMax,
    clusterWidthPx: cluster.clusterYMax - cluster.clusterYMin + 1,
    equalsCertifiedWinner: certifiedWinner !== null &&
      sameResponse(cluster.representative, certifiedWinner),
    scoreMarginToRank1: index === 0 ? 0 : rank1Score - cluster.representative.score,
  })));
}

function scanQualifyingResponses(
  image: DecodedAppearance,
  parameters: BackWallSeamDetectorParameters
): readonly (readonly ColumnTransitionResponse[])[] {
  const responses: ColumnTransitionResponse[][] =
    Array.from({ length: image.width }, () => []);
  const patchReach = parameters.sampleOffsetPx + parameters.sampleHalfHeightPx;
  const yMin = Math.max(
    patchReach,
    Math.ceil(image.height * parameters.roiYMinNormalized)
  );
  const yMax = Math.min(
    image.height - 1 - patchReach,
    Math.floor(image.height * parameters.roiYMaxNormalized)
  );
  const xMin = parameters.horizontalSampleRadiusPx;
  const xMax = image.width - 1 - parameters.horizontalSampleRadiusPx;

  for (let x = xMin; x <= xMax; x += 1) {
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
      if (
        lumaDrop < parameters.minimumLumaDrop ||
        rgbDistance < parameters.minimumRgbDistance
      ) continue;
      const score = lumaDrop + 0.25 * rgbDistance;
      responses[x].push(Object.freeze({ x, y, lumaDrop, rgbDistance, score }));
    }
  }
  return Object.freeze(responses.map(column => Object.freeze(column)));
}

async function decodeCertifiedEmpty(
  imageBytes: Uint8Array,
  identity: CertifiedEmptyColumnFieldIdentity
): Promise<DecodedAppearance | "decode_failed" | "fixture_identity_mismatch"> {
  try {
    const decoded = await sharp(imageBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sha256 = createHash("sha256").update(imageBytes).digest("hex");
    if (
      sha256 !== identity.sha256 ||
      decoded.info.width !== identity.dimensions.width ||
      decoded.info.height !== identity.dimensions.height ||
      decoded.info.channels < 3
    ) return "fixture_identity_mismatch";
    return Object.freeze({
      roomId: identity.roomId,
      sha256,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      pixels: decoded.data,
    });
  } catch {
    return "decode_failed";
  }
}

/**
 * Reads exact certified EMPTY bytes into an unlinked source-pixel candidate
 * field. Input contains image identity only; candidate construction has no
 * annotation or evaluation inputs.
 */
export async function readCertifiedEmptyMultiResponseColumnField(
  imageBytes: Uint8Array,
  identity: CertifiedEmptyColumnFieldIdentity
): Promise<EmptyMultiResponseColumnFieldReadResult> {
  const image = await decodeCertifiedEmpty(imageBytes, identity);
  if (typeof image === "string") return { ok: false, reason: image };

  const parameters = P2_S1B_FROZEN_PARAMETERS;
  const certifiedWinners = scanLocalWallFloorTransitions(image, parameters);
  const qualifyingByColumn = scanQualifyingResponses(image, parameters);
  let winnerMismatchCount = 0;
  const columns = qualifyingByColumn.map((qualifying, x) => {
    const certifiedWinner = certifiedWinners[x];
    const candidates = clusterQualifyingColumnResponses(
      qualifying,
      certifiedWinner
    );
    const marked = candidates.filter(candidate => candidate.equalsCertifiedWinner);
    const rank1 = candidates[0];
    if (
      certifiedWinner
        ? marked.length !== 1 || !rank1 || !sameResponse(rank1, certifiedWinner)
        : marked.length !== 0 || candidates.length !== 0
    ) winnerMismatchCount += 1;
    return Object.freeze({ x, certifiedWinner, candidates });
  });

  return Object.freeze({
    ok: true,
    version: EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION,
    roomId: image.roomId,
    emptyImageSha256: image.sha256,
    coordinateSpace: EMPTY_SOURCE_PIXEL_COORDINATE_SPACE,
    dimensions: Object.freeze({ width: image.width, height: image.height }),
    parameters,
    columns: Object.freeze(columns),
    winnerMismatchCount,
  });
}
