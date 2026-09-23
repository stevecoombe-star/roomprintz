import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

export const METRIC_CORRESPONDENCE_OVERLAY_CAPTION =
  "Estimate this exact span" as const;

export type MetricCorrespondenceOverlayPoint = Readonly<{
  x: number;
  y: number;
}>;

export type MetricCorrespondenceOverlayInput = Readonly<{
  originalBytes: Uint8Array;
  imageA: MetricCorrespondenceOverlayPoint;
  imageB: MetricCorrespondenceOverlayPoint;
  width: number;
  height: number;
  format?: "png" | "jpeg";
  caption?: string;
}>;

export type MetricCorrespondenceOverlayResult = Readonly<{
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  sha256: string;
  pixelA: MetricCorrespondenceOverlayPoint;
  pixelB: MetricCorrespondenceOverlayPoint;
  svg: string;
}>;

export function normalizedToPixel(
  point: MetricCorrespondenceOverlayPoint,
  width: number,
  height: number,
): MetricCorrespondenceOverlayPoint {
  return Object.freeze({
    x: point.x * width,
    y: point.y * height,
  });
}

function formatSvgNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0";
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMetricCorrespondenceOverlaySvg(
  imageA: MetricCorrespondenceOverlayPoint,
  imageB: MetricCorrespondenceOverlayPoint,
  width: number,
  height: number,
  caption: string = METRIC_CORRESPONDENCE_OVERLAY_CAPTION,
): string {
  const pixelA = normalizedToPixel(imageA, width, height);
  const pixelB = normalizedToPixel(imageB, width, height);
  const minDim = Math.min(width, height);
  const lineWidth = Math.max(4, Math.round(minDim * 0.007));
  const underStroke = lineWidth * 2;
  const radius = Math.max(6, Math.round(minDim * 0.012));
  const fontSize = Math.max(14, Math.round(minDim * 0.028));
  const captionSize = Math.max(12, Math.round(minDim * 0.022));
  const midX = (pixelA.x + pixelB.x) / 2;
  const midY = (pixelA.y + pixelB.y) / 2;
  const captionY = Math.max(captionSize + 8, midY - Math.max(18, minDim * 0.045));
  const labelOffset = radius + fontSize * 0.85;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<line x1="${formatSvgNumber(pixelA.x)}" y1="${formatSvgNumber(pixelA.y)}" x2="${formatSvgNumber(pixelB.x)}" y2="${formatSvgNumber(pixelB.y)}" stroke="#111827" stroke-width="${underStroke}" stroke-linecap="round"/>`,
    `<line x1="${formatSvgNumber(pixelA.x)}" y1="${formatSvgNumber(pixelA.y)}" x2="${formatSvgNumber(pixelB.x)}" y2="${formatSvgNumber(pixelB.y)}" stroke="#FFE14D" stroke-width="${lineWidth}" stroke-linecap="round"/>`,
    `<circle cx="${formatSvgNumber(pixelA.x)}" cy="${formatSvgNumber(pixelA.y)}" r="${radius}" fill="#FFE14D" stroke="#111827" stroke-width="${Math.max(2, Math.round(lineWidth / 2))}"/>`,
    `<circle cx="${formatSvgNumber(pixelB.x)}" cy="${formatSvgNumber(pixelB.y)}" r="${radius}" fill="#FFE14D" stroke="#111827" stroke-width="${Math.max(2, Math.round(lineWidth / 2))}"/>`,
    `<text x="${formatSvgNumber(pixelA.x)}" y="${formatSvgNumber(pixelA.y - labelOffset)}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFE14D" stroke="#111827" stroke-width="3" paint-order="stroke">A</text>`,
    `<text x="${formatSvgNumber(pixelB.x)}" y="${formatSvgNumber(pixelB.y - labelOffset)}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFE14D" stroke="#111827" stroke-width="3" paint-order="stroke">B</text>`,
    `<text x="${formatSvgNumber(midX)}" y="${formatSvgNumber(captionY)}" text-anchor="middle" font-family="sans-serif" font-size="${captionSize}" font-weight="700" fill="#FFE14D" stroke="#111827" stroke-width="3" paint-order="stroke">${escapeSvgText(caption)}</text>`,
    `</svg>`,
  ].join("");
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Deterministic ORIGINAL overlay. Does not mutate stored ORIGINAL bytes.
 * Does not include canonical length, gauge units, candidate scale, TILED
 * information, Floor dimensions, or referenceDepthM.
 */
export async function composeMetricCorrespondenceOverlay(
  input: MetricCorrespondenceOverlayInput,
): Promise<MetricCorrespondenceOverlayResult | null> {
  const width = input.width;
  const height = input.height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 2 ||
    height < 2 ||
    !Number.isFinite(input.imageA.x) ||
    !Number.isFinite(input.imageA.y) ||
    !Number.isFinite(input.imageB.x) ||
    !Number.isFinite(input.imageB.y)
  ) {
    return null;
  }
  try {
    const metadata = await sharp(Buffer.from(input.originalBytes), {
      failOn: "error",
      animated: false,
    }).metadata();
    if (metadata.width !== width || metadata.height !== height) {
      return null;
    }
    const svg = buildMetricCorrespondenceOverlaySvg(
      input.imageA,
      input.imageB,
      width,
      height,
      input.caption ?? METRIC_CORRESPONDENCE_OVERLAY_CAPTION,
    );
    const pixelA = normalizedToPixel(input.imageA, width, height);
    const pixelB = normalizedToPixel(input.imageB, width, height);
    const format = input.format === "png" ? "png" as const : "jpeg" as const;
    const pipeline = sharp(Buffer.from(input.originalBytes), {
      failOn: "error",
      animated: false,
    }).composite([{
      input: Buffer.from(svg),
      blend: "over",
    }]);
    const bytes = Uint8Array.from(
      format === "png"
        ? await pipeline.png().toBuffer()
        : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer(),
    );
    return Object.freeze({
      bytes,
      mimeType: format === "png" ? "image/png" : "image/jpeg",
      sha256: hash(bytes),
      pixelA,
      pixelB,
      svg,
    });
  } catch {
    return null;
  }
}
