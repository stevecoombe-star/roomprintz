// lib/renderVibodeRemoveOverlay.ts
// Renders red X markers over a base image for Vibode Remove v1 (canonical grounding).
// Produces marked.png: base image + ONLY red X markers (+ optional 1..N labels).
//
// TODO: Overlay rendering should move to compositor.
// Sharp is used here only as a temporary step; ensure runtime is nodejs.

import sharp from "sharp";
import type { RemoveMarkV2 } from "./freezePayloadV2Types";

/**
 * Derives width/height from actual image bytes (avoids payload defaults desync).
 * Uses sharp metadata only; no new native deps.
 */
export async function getImageDimensionsFromBuffer(
  buf: Buffer
): Promise<{ widthPx: number; heightPx: number }> {
  const meta = await sharp(buf).metadata();
  const w = typeof meta.width === "number" && meta.width > 0 ? meta.width : 800;
  const h = typeof meta.height === "number" && meta.height > 0 ? meta.height : 600;
  return { widthPx: w, heightPx: h };
}

/** Red X marker color (opaque) */
const RED = "#dc2626";

/**
 * Build SVG overlay with red X marks at each (x, y) with radius r.
 * Coordinates are in image-space pixels.
 */
function buildOverlaySvg(
  widthPx: number,
  heightPx: number,
  marks: RemoveMarkV2[]
): string {
  const parts: string[] = [];

  for (const m of marks) {
    const { x, y, r } = m;
    const x1 = x - r;
    const y1 = y - r;
    const x2 = x + r;
    const y2 = y + r;
    const strokeWidth = Math.max(2, r * 0.15);

    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${RED}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      `<line x1="${x1}" y1="${y2}" x2="${x2}" y2="${y1}" stroke="${RED}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`
    );

    if (m.labelIndex != null && m.labelIndex > 0) {
      const tx = x + r + 6;
      const ty = y - 4;
      const fontSize = Math.max(12, r * 0.6);
      parts.push(
        `<text x="${tx}" y="${ty}" font-size="${fontSize}" fill="${RED}" font-family="sans-serif" font-weight="bold">${m.labelIndex}</text>`
      );
    }
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
  ${parts.join("\n  ")}
</svg>`;
}

/**
 * Renders marked.png by drawing red X markers over the base image.
 * Returns PNG buffer.
 */
export async function renderVibodeRemoveOverlay(
  baseImageBuffer: Buffer,
  marks: RemoveMarkV2[],
  widthPx: number,
  heightPx: number
): Promise<Buffer> {
  if (marks.length === 0) {
    return baseImageBuffer;
  }

  const svgOverlay = buildOverlaySvg(widthPx, heightPx, marks);
  const overlayBuffer = Buffer.from(svgOverlay);

  const overlayPng = await sharp(overlayBuffer).png().toBuffer();

  const composed = await sharp(baseImageBuffer)
    .composite([{ input: overlayPng, blend: "over" }])
    .png()
    .toBuffer();

  return composed;
}
