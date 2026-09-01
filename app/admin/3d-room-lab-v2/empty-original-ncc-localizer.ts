import {
  REGISTRATION_SEARCH_WINDOW,
  type EmptyOriginalFittedLine,
  type EmptyOriginalNormalizedUv,
} from "./empty-original-registration-authority-contract";
import { fittedHesseLine, perpendicular } from "./empty-original-registration-geometry";

export const NCC_MIN = 0.55;
export const NCC_STRONG_RELATIVE = 0.95;
/** Strong-band diameter above this is treated as a repetitive/underconstrained anchor. */
export const ANCHOR_STRONG_BAND_MAX_DIAMETER = 0.02;
/**
 * Minimum ORIGINAL-space gap between two competing ridge families.
 * This is a uniqueness gate between ORIGINAL peaks, not an EMPTY identity
 * displacement limit.
 */
export const RIDGE_COMPETING_FAMILY_MIN_SEPARATION = 0.003;

export type GreyscaleRaster = Readonly<{
  width: number;
  height: number;
  pixels: Float64Array;
}>;

export type PointAnchorLocalization =
  | Readonly<{
      matched: true;
      originalUv: EmptyOriginalNormalizedUv;
      ncc: number;
      strongBandDiameter: number;
      searchBoundHit: boolean;
      searchDisplacement: number;
      pixelDelta: number;
    }>
  | Readonly<{
      matched: false;
      reason: "no_match" | "ambiguous";
      searchBoundHit: boolean;
    }>;

export type RidgeNormalLocalization =
  | Readonly<{
      matched: true;
      originalUv: EmptyOriginalNormalizedUv;
      ncc: number;
      refinedK: number;
      signedNormalOffsetUv: number;
      searchBoundHit: boolean;
      searchDisplacement: number;
    }>
  | Readonly<{
      matched: false;
      reason: "no_match" | "ambiguous";
      searchBoundHit: boolean;
    }>;

export function matcherPatchRadius(width: number, height: number): number {
  return Math.max(4, Math.min(10, Math.round(0.018 * Math.min(width, height))));
}

export function sobelMagnitude(raster: GreyscaleRaster): GreyscaleRaster {
  const { width, height, pixels } = raster;
  const out = new Float64Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -pixels[i - width - 1]! + pixels[i - width + 1]! +
        -2 * pixels[i - 1]! + 2 * pixels[i + 1]! +
        -pixels[i + width - 1]! + pixels[i + width + 1]!;
      const gy =
        -pixels[i - width - 1]! - 2 * pixels[i - width]! - pixels[i - width + 1]! +
        pixels[i + width - 1]! + 2 * pixels[i + width]! + pixels[i + width + 1]!;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return { width, height, pixels: out };
}

export function structureRaster(grey: GreyscaleRaster): GreyscaleRaster {
  const sobel = sobelMagnitude(grey);
  let maxSobel = 1e-9;
  for (const value of sobel.pixels) {
    if (value > maxSobel) maxSobel = value;
  }
  const pixels = new Float64Array(grey.pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = grey.pixels[index]! + sobel.pixels[index]! / maxSobel;
  }
  return { width: grey.width, height: grey.height, pixels };
}

export function extractPatch(
  raster: GreyscaleRaster,
  cx: number,
  cy: number,
  radius: number,
): Float64Array | null {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  if (
    x0 - radius < 0 || y0 - radius < 0 ||
    x0 + radius >= raster.width || y0 + radius >= raster.height
  ) {
    return null;
  }
  const size = radius * 2 + 1;
  const patch = new Float64Array(size * size);
  let index = 0;
  for (let y = y0 - radius; y <= y0 + radius; y += 1) {
    for (let x = x0 - radius; x <= x0 + radius; x += 1) {
      patch[index] = raster.pixels[y * raster.width + x]!;
      index += 1;
    }
  }
  return patch;
}

/**
 * Samples a 1-D profile. Callers pass the EMPTY ridge *normal* as (tu, tv).
 */
export function extractTangentStrip(
  raster: GreyscaleRaster,
  cx: number,
  cy: number,
  tu: number,
  tv: number,
  halfLength: number,
): Float64Array | null {
  const strip = new Float64Array(halfLength * 2 + 1);
  for (let t = -halfLength; t <= halfLength; t += 1) {
    const x = Math.round(cx + tu * t);
    const y = Math.round(cy + tv * t);
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;
    strip[t + halfLength] = raster.pixels[y * raster.width + x]!;
  }
  return strip;
}

export function normalizedCrossCorrelation(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < n; index += 1) {
    meanA += a[index]!;
    meanB += b[index]!;
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let index = 0; index < n; index += 1) {
    const da = a[index]! - meanA;
    const db = b[index]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (!(den > 1e-12)) return 0;
  return num / den;
}

export function refinePeak(
  original: GreyscaleRaster,
  emptyPatch: Float64Array,
  x: number,
  y: number,
  radius: number,
): { x: number; y: number } {
  const samples: Array<{ x: number; y: number; ncc: number }> = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const patch = extractPatch(original, x + dx, y + dy, radius);
      if (!patch) continue;
      samples.push({
        x: x + dx,
        y: y + dy,
        ncc: Math.max(0, normalizedCrossCorrelation(emptyPatch, patch)),
      });
    }
  }
  let weight = 0;
  let sx = 0;
  let sy = 0;
  for (const sample of samples) {
    weight += sample.ncc;
    sx += sample.x * sample.ncc;
    sy += sample.y * sample.ncc;
  }
  if (!(weight > 1e-9)) return { x, y };
  return { x: sx / weight, y: sy / weight };
}

export function normalize2(x: number, y: number): { x: number; y: number } | null {
  const length = Math.hypot(x, y);
  if (!(length > 1e-18)) return null;
  return { x: x / length, y: y / length };
}

export function strongBandDiameter(
  strong: readonly Readonly<{ x: number; y: number }>[],
  width: number,
  height: number,
): number {
  if (strong.length === 0) return 0;
  let minU = 1;
  let maxU = 0;
  let minV = 1;
  let maxV = 0;
  for (const point of strong) {
    const u = point.x / (width - 1);
    const v = point.y / (height - 1);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return Math.hypot(maxU - minU, maxV - minV);
}

export function contiguousComponent(ks: readonly number[], peakK: number): Set<number> {
  const unique = [...new Set(ks)].sort((left, right) => left - right);
  const present = new Set(unique);
  const component = new Set<number>();
  const queue = [peakK];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (!present.has(current) || component.has(current)) continue;
    component.add(current);
    queue.push(current - 1, current + 1);
  }
  return component;
}

export function ridgeComponentsSeparated(
  primary: ReadonlySet<number>,
  other: readonly number[],
  stepNorm: number,
): boolean {
  if (primary.size === 0 || other.length === 0) return false;
  const primaryList = [...primary];
  let minGap = Number.POSITIVE_INFINITY;
  for (const k of other) {
    for (const peak of primaryList) {
      minGap = Math.min(minGap, Math.abs(k - peak) * stepNorm);
    }
  }
  return minGap > RIDGE_COMPETING_FAMILY_MIN_SEPARATION;
}

export function centroidK(
  scores: readonly Readonly<{ energy: number; k: number }>[],
  peakK: number,
): number {
  let weight = 0;
  let sk = 0;
  for (const sample of scores) {
    const energy = Math.max(0, sample.energy);
    weight += energy;
    sk += sample.k * energy;
  }
  if (!(weight > 1e-9)) return peakK;
  return sk / weight;
}

/**
 * Independent 2-D NCC localization of a unique EMPTY prior in ORIGINAL.
 * Does not apply the identity residual 0.003 gate.
 */
export function localizePointAnchorNcc(input: {
  emptyUv: EmptyOriginalNormalizedUv;
  emptyStructure: GreyscaleRaster;
  originalStructure: GreyscaleRaster;
  searchWindow?: number;
}): PointAnchorLocalization {
  const searchWindow = input.searchWindow ?? REGISTRATION_SEARCH_WINDOW;
  const width = input.originalStructure.width;
  const height = input.originalStructure.height;
  const emptyX = input.emptyUv.u * (width - 1);
  const emptyY = input.emptyUv.v * (height - 1);
  const patchRadius = matcherPatchRadius(width, height);
  const emptyPatch = extractPatch(input.emptyStructure, emptyX, emptyY, patchRadius);
  if (!emptyPatch) {
    return { matched: false, reason: "no_match", searchBoundHit: false };
  }
  const searchXu = searchWindow * (width - 1);
  const searchYv = searchWindow * (height - 1);
  const minX = Math.max(patchRadius, Math.floor(emptyX - searchXu));
  const maxX = Math.min(width - 1 - patchRadius, Math.ceil(emptyX + searchXu));
  const minY = Math.max(patchRadius, Math.floor(emptyY - searchYv));
  const maxY = Math.min(height - 1 - patchRadius, Math.ceil(emptyY + searchYv));
  if (minX > maxX || minY > maxY) {
    return { matched: false, reason: "no_match", searchBoundHit: false };
  }

  const scores: Array<{ ncc: number; x: number; y: number }> = [];
  let bestNcc = -1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const originalPatch = extractPatch(input.originalStructure, x, y, patchRadius);
      if (!originalPatch) continue;
      const ncc = normalizedCrossCorrelation(emptyPatch, originalPatch);
      scores.push({ ncc, x, y });
      if (ncc > bestNcc) bestNcc = ncc;
    }
  }
  if (!(bestNcc >= NCC_MIN) || scores.length === 0) {
    return { matched: false, reason: "no_match", searchBoundHit: false };
  }
  const strong = scores.filter((score) => score.ncc >= bestNcc * NCC_STRONG_RELATIVE);
  const diameter = strongBandDiameter(strong, width, height);
  if (diameter > ANCHOR_STRONG_BAND_MAX_DIAMETER) {
    return { matched: false, reason: "ambiguous", searchBoundHit: false };
  }
  const peak = strong.reduce((best, score) => score.ncc > best.ncc ? score : best);
  let weight = 0;
  let sx = 0;
  let sy = 0;
  for (const score of strong) {
    const ncc = Math.max(0, score.ncc);
    weight += ncc;
    sx += score.x * ncc;
    sy += score.y * ncc;
  }
  const refined = weight > 1e-9
    ? { x: sx / weight, y: sy / weight }
    : refinePeak(input.originalStructure, emptyPatch, peak.x, peak.y, patchRadius);
  const originalUv = {
    u: refined.x / (width - 1),
    v: refined.y / (height - 1),
  };
  const searchDisplacement = Math.hypot(
    originalUv.u - input.emptyUv.u,
    originalUv.v - input.emptyUv.v,
  );
  const searchBoundHit = searchDisplacement >= searchWindow - 1e-9;
  return {
    matched: true,
    originalUv,
    ncc: peak.ncc,
    strongBandDiameter: diameter,
    searchBoundHit,
    searchDisplacement,
    pixelDelta: Math.hypot(refined.x - emptyX, refined.y - emptyY),
  };
}

/**
 * Independent 1-D NCC localization along the EMPTY ridge normal.
 * Tangent is not a degree of freedom. Does not apply the identity residual gate.
 */
export function localizeRidgeNormalNcc(input: {
  emptyUv: EmptyOriginalNormalizedUv;
  tangentUv: EmptyOriginalNormalizedUv;
  emptyGrey: GreyscaleRaster;
  originalGrey: GreyscaleRaster;
  searchWindow?: number;
}): RidgeNormalLocalization {
  const searchWindow = input.searchWindow ?? REGISTRATION_SEARCH_WINDOW;
  const width = input.originalGrey.width;
  const height = input.originalGrey.height;
  const emptyX = input.emptyUv.u * (width - 1);
  const emptyY = input.emptyUv.v * (height - 1);
  const tPix = normalize2(
    input.tangentUv.u * (width - 1),
    input.tangentUv.v * (height - 1),
  );
  if (!tPix) {
    return { matched: false, reason: "no_match", searchBoundHit: false };
  }
  const nPix = { x: -tPix.y, y: tPix.x };
  const halfWidth = matcherPatchRadius(width, height);
  const emptyProfile = extractTangentStrip(
    input.emptyGrey,
    emptyX,
    emptyY,
    nPix.x,
    nPix.y,
    halfWidth,
  );
  if (!emptyProfile) {
    return { matched: false, reason: "no_match", searchBoundHit: false };
  }
  const stepNorm = Math.hypot(nPix.x / (width - 1), nPix.y / (height - 1));
  const searchPx = Math.max(
    1,
    Math.floor(searchWindow / Math.max(stepNorm, 1e-9)),
  );
  const scores: Array<{ ncc: number; k: number }> = [];
  let bestNcc = -1;
  for (let k = -searchPx; k <= searchPx; k += 1) {
    const originalProfile = extractTangentStrip(
      input.originalGrey,
      emptyX + nPix.x * k,
      emptyY + nPix.y * k,
      nPix.x,
      nPix.y,
      halfWidth,
    );
    if (!originalProfile) continue;
    const ncc = normalizedCrossCorrelation(emptyProfile, originalProfile);
    scores.push({ ncc, k });
    if (ncc > bestNcc) bestNcc = ncc;
  }
  if (!(bestNcc >= NCC_MIN) || scores.length === 0) {
    return { matched: false, reason: "no_match", searchBoundHit: false };
  }
  const strong = scores.filter((score) => score.ncc >= bestNcc * NCC_STRONG_RELATIVE);
  const peak = strong.reduce((best, score) => score.ncc > best.ncc ? score : best);
  const component = contiguousComponent(strong.map((score) => score.k), peak.k);
  const otherStrong = strong.filter((score) => !component.has(score.k));
  if (
    otherStrong.length >= 2 &&
    ridgeComponentsSeparated(component, otherStrong.map((score) => score.k), stepNorm)
  ) {
    return { matched: false, reason: "ambiguous", searchBoundHit: false };
  }
  const refinedK = centroidK(
    scores
      .filter((score) => component.has(score.k))
      .map((score) => ({ energy: Math.max(0, score.ncc), k: score.k })),
    peak.k,
  );
  const matchX = emptyX + nPix.x * refinedK;
  const matchY = emptyY + nPix.y * refinedK;
  const originalUv = {
    u: matchX / (width - 1),
    v: matchY / (height - 1),
  };
  const normal = perpendicular(input.tangentUv);
  const signedNormalOffsetUv =
    (originalUv.u - input.emptyUv.u) * normal.u +
    (originalUv.v - input.emptyUv.v) * normal.v;
  const searchDisplacement = Math.abs(signedNormalOffsetUv);
  const searchBoundHit = Math.abs(refinedK) >= searchPx - 0.5 ||
    searchDisplacement >= searchWindow - 1e-9;
  return {
    matched: true,
    originalUv,
    ncc: peak.ncc,
    refinedK,
    signedNormalOffsetUv,
    searchBoundHit,
    searchDisplacement,
  };
}

export function fitLocalOriginalLine(
  structure: GreyscaleRaster,
  cx: number,
  cy: number,
  tu: number,
  tv: number,
  nu: number,
  nv: number,
  halfLength: number,
  width: number,
  height: number,
): EmptyOriginalFittedLine | null {
  const points: Array<{ u: number; v: number }> = [];
  let maxVal = 0;
  const candidates: Array<{ u: number; v: number; value: number }> = [];
  for (let t = -halfLength; t <= halfLength; t += 1) {
    for (let s = -2; s <= 2; s += 1) {
      const x = Math.round(cx + tu * t + nu * s);
      const y = Math.round(cy + tv * t + nv * s);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const value = structure.pixels[y * width + x]!;
      candidates.push({
        u: x / (width - 1),
        v: y / (height - 1),
        value,
      });
      if (value > maxVal) maxVal = value;
    }
  }
  const threshold = maxVal * 0.7;
  for (const candidate of candidates) {
    if (candidate.value >= threshold) {
      points.push({ u: candidate.u, v: candidate.v });
    }
  }
  return fittedHesseLine(points);
}
