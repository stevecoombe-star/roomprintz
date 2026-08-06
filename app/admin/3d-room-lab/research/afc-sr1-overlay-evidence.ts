import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  buildAfcSr1OriginalBasisPlacement,
  fingerprintAfcSr1OverlayDescriptor,
  validateAfcSr1ImageBasis,
  validateAfcSr1OverlayDescriptor,
  type AfcSr1ImageBasisV1,
  type AfcSr1OriginalBasisPlacementV1,
  type AfcSr1OverlayDescriptorV1,
  type AfcSr1Point,
} from "./afc-sr1-semantic-prior";
import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";

export const AFC_SR1_OVERLAY_STYLE_VERSION =
  "afc-sr1-overlay-style/v1" as const;
export const AFC_SR1_VERIFIED_ORIGINAL_IMAGE_VERSION =
  "afc-sr1-verified-original-image/v1" as const;
export const AFC_SR1_CANONICAL_SVG_VERSION =
  "afc-sr1-canonical-svg/v1" as const;
export const AFC_SR1_RENDERED_OVERLAY_VERSION =
  "afc-sr1-rendered-overlay/v1" as const;
export const AFC_SR1_COMPOSITE_IMAGE_VERSION =
  "afc-sr1-composite-image/v1" as const;
export const AFC_SR1_OVERLAY_VISIBILITY_VERSION =
  "afc-sr1-overlay-visibility/v1" as const;

export type AfcSr1OverlayStyleV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_OVERLAY_STYLE_VERSION;
  polygonStroke: string;
  polygonFill: string;
  polygonFillOpacity: number;
  polygonLineWidthPx: number;
  nlSeamStroke: string;
  nrSeamStroke: string;
  seamLineWidthPx: number;
  seamDashPatternPx: readonly number[];
  arrowLengthPx: number;
  arrowWidthPx: number;
  cornerMarkerRadiusPx: number;
  showFullPolygon: true;
  showCornerMarkers: true;
  showNlCandidateSeam: true;
  showNrCandidateSeam: true;
  showNearToFarDirection: true;
  showLegend: true;
  clipToImageBounds: true;
}>;

export const AFC_SR1_DEFAULT_OVERLAY_STYLE_V1: AfcSr1OverlayStyleV1 =
  Object.freeze({
    schemaVersion: AFC_SR1_OVERLAY_STYLE_VERSION,
    polygonStroke: "#f8fafc",
    polygonFill: "#0f172a",
    polygonFillOpacity: 0.20,
    polygonLineWidthPx: 2,
    nlSeamStroke: "#06b6d4",
    nrSeamStroke: "#f97316",
    seamLineWidthPx: 3,
    seamDashPatternPx: Object.freeze([8, 4]),
    arrowLengthPx: 10,
    arrowWidthPx: 7,
    cornerMarkerRadiusPx: 4,
    showFullPolygon: true,
    showCornerMarkers: true,
    showNlCandidateSeam: true,
    showNrCandidateSeam: true,
    showNearToFarDirection: true,
    showLegend: true,
    clipToImageBounds: true,
  });

export type AfcSr1VerifiedOriginalImageV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_VERIFIED_ORIGINAL_IMAGE_VERSION;
  basis: AfcSr1ImageBasisV1;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteCount: number;
  sha256: string;
}>;

export type AfcSr1CanonicalSvgArtifactV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_CANONICAL_SVG_VERSION;
  overlayDescriptorFingerprint: string;
  styleVersion: typeof AFC_SR1_OVERLAY_STYLE_VERSION;
  styleDigest: string;
  width: number;
  height: number;
  svgUtf8Sha256: string;
  svgUtf8ByteLength: number;
  overlayGenerationId: string;
}>;

export type AfcSr1RenderedOverlayArtifactV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_RENDERED_OVERLAY_VERSION;
  overlayDescriptorFingerprint: string;
  styleVersion: typeof AFC_SR1_OVERLAY_STYLE_VERSION;
  styleDigest: string;
  width: number;
  height: number;
  svgUtf8Sha256: string;
  overlayPngSha256: string;
  overlayPngByteLength: number;
  overlayGenerationId: string;
}>;

export type AfcSr1CompositeImageArtifactV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_COMPOSITE_IMAGE_VERSION;
  composition: "original_plus_advisory_overlay/v1";
  mimeType: "image/png";
  width: number;
  height: number;
  originalImageSha256: string;
  overlayPngSha256: string;
  compositePngSha256: string;
  compositePngByteLength: number;
}>;

export type AfcSr1OverlayVisibilityV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_OVERLAY_VISIBILITY_VERSION;
  polygonVisibleEdgeLengthPx: number;
  nlSeam: Readonly<{
    totalLengthPx: number;
    visibleLengthPx: number;
    visibleFraction: number;
  }>;
  nrSeam: Readonly<{
    totalLengthPx: number;
    visibleLengthPx: number;
    visibleFraction: number;
  }>;
  status: "supported" | "unsupported_visibility";
}>;

type PixelPoint = Readonly<{ x: number; y: number }>;
type ClippedLine = Readonly<{ start: PixelPoint; end: PixelPoint }> | null;

const SHA256_HEX = /^[0-9a-f]{64}$/;
export const AFC_SR1_HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_OPTIONS = Object.freeze({
  compressionLevel: 9,
  effort: 10,
  adaptiveFiltering: false,
  palette: false,
  force: true,
});
const MIN_VISIBLE_SEAM_FRACTION = 0.02;

function fail(reason: string): never {
  throw new Error(`AFC-SR1 overlay evidence: ${reason}`);
}

function byteSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function frozenBasis(basis: AfcSr1ImageBasisV1): AfcSr1ImageBasisV1 {
  return Object.freeze({ ...basis });
}

function assertFiniteDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) fail(`${name}_invalid`);
}

function mimeFromMagic(bytes: Uint8Array): AfcSr1VerifiedOriginalImageV1["mimeType"] | null {
  if (bytes.length >= PNG_SIGNATURE.length && Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 &&
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function pixelPoint(point: AfcSr1Point, width: number, height: number): PixelPoint {
  return Object.freeze({ x: point.x * width, y: point.y * height });
}

function lineLength(start: PixelPoint, end: PixelPoint): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

/** Liang–Barsky clipping preserves source geometry and only returns visual pixels. */
function clipLineToBounds(start: PixelPoint, end: PixelPoint, width: number, height: number): ClippedLine {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [start.x, width - start.x, start.y, height - start.y];
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return null;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) {
      if (ratio > upper) return null;
      lower = Math.max(lower, ratio);
    } else {
      if (ratio < lower) return null;
      upper = Math.min(upper, ratio);
    }
  }
  return Object.freeze({
    start: Object.freeze({ x: start.x + lower * dx, y: start.y + lower * dy }),
    end: Object.freeze({ x: start.x + upper * dx, y: start.y + upper * dy }),
  });
}

function clampVisualAnchor(point: PixelPoint, width: number, height: number): PixelPoint {
  return Object.freeze({
    x: Math.min(width, Math.max(0, point.x)),
    y: Math.min(height, Math.max(0, point.y)),
  });
}

export function serializeAfcSr1SvgNumber(value: number): string {
  if (!Number.isFinite(value)) fail("svg_number_non_finite");
  const rounded = Math.round(value * 1000) / 1000;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const serialized = normalized.toFixed(3).replace(/\.?0+$/, "");
  if (serialized.includes("e") || serialized.includes("E") || serialized === "-0") {
    fail("svg_number_serialization_invalid");
  }
  return serialized;
}

function pathPoint(point: PixelPoint): string {
  return `${serializeAfcSr1SvgNumber(point.x)} ${serializeAfcSr1SvgNumber(point.y)}`;
}

export function mapAfcSr1SourcePointToOriginalPixels(
  point: AfcSr1Point,
  basis: AfcSr1ImageBasisV1
): PixelPoint {
  assertFiniteDimension(basis.decodedWidth, "basis_width");
  assertFiniteDimension(basis.decodedHeight, "basis_height");
  if (basis.orientation !== 1) fail("basis_orientation_invalid");
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) fail("source_point_invalid");
  return pixelPoint(point, basis.decodedWidth, basis.decodedHeight);
}

export function validateAfcSr1OverlayStyle(
  style: unknown
): asserts style is AfcSr1OverlayStyleV1 {
  if (!style || typeof style !== "object" ||
      Object.keys(style).sort().join("\u0000") !== [
        "schemaVersion", "polygonStroke", "polygonFill", "polygonFillOpacity",
        "polygonLineWidthPx", "nlSeamStroke", "nrSeamStroke", "seamLineWidthPx",
        "seamDashPatternPx", "arrowLengthPx", "arrowWidthPx", "cornerMarkerRadiusPx",
        "showFullPolygon", "showCornerMarkers", "showNlCandidateSeam",
        "showNrCandidateSeam", "showNearToFarDirection", "showLegend", "clipToImageBounds",
      ].sort().join("\u0000")) {
    fail("overlay_style_shape_invalid");
  }
  const value = style as AfcSr1OverlayStyleV1;
  if (value.schemaVersion !== AFC_SR1_OVERLAY_STYLE_VERSION ||
      !Object.isFrozen(style) ||
      !Array.isArray(value.seamDashPatternPx) ||
      !Object.isFrozen(value.seamDashPatternPx)) {
    fail("overlay_style_invalid");
  }
  for (const color of [
    value.polygonStroke, value.polygonFill, value.nlSeamStroke, value.nrSeamStroke,
  ]) {
    if (typeof color !== "string" || !AFC_SR1_HEX_COLOR_PATTERN.test(color)) {
      fail("overlay_style_color_invalid");
    }
  }
  if (!Number.isFinite(value.polygonFillOpacity) ||
      value.polygonFillOpacity < 0 || value.polygonFillOpacity > 1 ||
      ![value.polygonLineWidthPx, value.seamLineWidthPx, value.arrowLengthPx,
        value.arrowWidthPx, value.cornerMarkerRadiusPx]
        .every(number => Number.isFinite(number) && number > 0) ||
      value.seamDashPatternPx.length === 0 ||
      !value.seamDashPatternPx.every(number => Number.isFinite(number) && number >= 0) ||
      value.showFullPolygon !== true ||
      value.showCornerMarkers !== true ||
      value.showNlCandidateSeam !== true ||
      value.showNrCandidateSeam !== true ||
      value.showNearToFarDirection !== true ||
      value.showLegend !== true ||
      value.clipToImageBounds !== true) {
    fail("overlay_style_values_invalid");
  }
}

export function digestAfcSr1OverlayStyle(style: AfcSr1OverlayStyleV1): string {
  validateAfcSr1OverlayStyle(style);
  return sha256HexUtf8(canonicalizeRfc8785Jcs(style));
}

export function analyzeAfcSr1OverlayVisibility(
  descriptor: AfcSr1OverlayDescriptorV1
): AfcSr1OverlayVisibilityV1 {
  validateAfcSr1OverlayDescriptor(descriptor);
  const { decodedWidth: width, decodedHeight: height } = descriptor.originalTargetBasis;
  const polygon = descriptor.rawSourcePolygon.map(point => pixelPoint(point, width, height));
  const polygonVisibleEdgeLengthPx = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const clipped = clipLineToBounds(point, next, width, height);
    return sum + (clipped ? lineLength(clipped.start, clipped.end) : 0);
  }, 0);
  const seamVisibility = (key: "NL" | "NR") => {
    const seam = descriptor.hypotheses[key];
    const start = pixelPoint(seam.seamStartNear, width, height);
    const end = pixelPoint(seam.seamEndFar, width, height);
    const totalLengthPx = lineLength(start, end);
    const clipped = clipLineToBounds(start, end, width, height);
    const visibleLengthPx = clipped ? lineLength(clipped.start, clipped.end) : 0;
    return Object.freeze({
      totalLengthPx,
      visibleLengthPx,
      visibleFraction: totalLengthPx === 0 ? 0 : visibleLengthPx / totalLengthPx,
    });
  };
  const nlSeam = seamVisibility("NL");
  const nrSeam = seamVisibility("NR");
  return Object.freeze({
    schemaVersion: AFC_SR1_OVERLAY_VISIBILITY_VERSION,
    polygonVisibleEdgeLengthPx,
    nlSeam,
    nrSeam,
    status: polygonVisibleEdgeLengthPx > 0 &&
      (nlSeam.visibleFraction >= MIN_VISIBLE_SEAM_FRACTION ||
        nrSeam.visibleFraction >= MIN_VISIBLE_SEAM_FRACTION)
      ? "supported"
      : "unsupported_visibility",
  });
}

function glyphPath(letter: "N" | "L" | "R" | "F", x: number, y: number, scale: number): string {
  const p = (dx: number, dy: number) =>
    `${serializeAfcSr1SvgNumber(x + dx * scale)} ${serializeAfcSr1SvgNumber(y + dy * scale)}`;
  switch (letter) {
    case "N": return `M${p(0, 5)} L${p(0, 0)} L${p(4, 5)} L${p(4, 0)}`;
    case "L": return `M${p(0, 0)} L${p(0, 5)} L${p(4, 5)}`;
    case "R": return `M${p(0, 5)} L${p(0, 0)} L${p(3, 0)} L${p(3, 2.5)} L${p(0, 2.5)} M${p(2, 2.5)} L${p(4, 5)}`;
    case "F": return `M${p(0, 5)} L${p(0, 0)} L${p(4, 0)} M${p(0, 2.5)} L${p(3, 2.5)}`;
  }
}

function badge(
  label: "NL" | "NR" | "FR" | "FL",
  point: PixelPoint,
  width: number,
  height: number,
  style: AfcSr1OverlayStyleV1
): string {
  const anchor = clampVisualAnchor(point, width, height);
  const x = anchor.x + (anchor.x > width - 22 ? -20 : 8);
  const y = anchor.y + (anchor.y > height - 16 ? -12 : 8);
  const first = label[0] as "N" | "F";
  const second = label[1] as "L" | "R";
  return `<g data-corner="${label}"><circle cx="${serializeAfcSr1SvgNumber(anchor.x)}" cy="${serializeAfcSr1SvgNumber(anchor.y)}" r="${serializeAfcSr1SvgNumber(style.cornerMarkerRadiusPx)}" fill="#ffffff" stroke="#111827" stroke-width="1"/><rect x="${serializeAfcSr1SvgNumber(x - 3)}" y="${serializeAfcSr1SvgNumber(y - 7)}" width="16" height="10" rx="2" fill="#111827"/><path d="${glyphPath(first, x, y - 5, 1.3)} ${glyphPath(second, x + 7, y - 5, 1.3)}" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function arrowForClippedLine(clipped: ClippedLine, color: string, style: AfcSr1OverlayStyleV1): string {
  if (!clipped) return "";
  const dx = clipped.end.x - clipped.start.x;
  const dy = clipped.end.y - clipped.start.y;
  const length = Math.hypot(dx, dy);
  if (length < style.arrowLengthPx) return "";
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const tip = clipped.end;
  const base = { x: tip.x - ux * style.arrowLengthPx, y: tip.y - uy * style.arrowLengthPx };
  const left = { x: base.x + px * style.arrowWidthPx / 2, y: base.y + py * style.arrowWidthPx / 2 };
  const right = { x: base.x - px * style.arrowWidthPx / 2, y: base.y - py * style.arrowWidthPx / 2 };
  return `<path d="M${pathPoint(tip)} L${pathPoint(left)} L${pathPoint(right)} Z" fill="${color}"/>`;
}

export function buildAfcSr1CanonicalSvg(input: Readonly<{
  descriptor: AfcSr1OverlayDescriptorV1;
  placement: AfcSr1OriginalBasisPlacementV1;
  style?: AfcSr1OverlayStyleV1;
}>): Readonly<{ metadata: AfcSr1CanonicalSvgArtifactV1; svgUtf8: string }> {
  validateAfcSr1OverlayDescriptor(input.descriptor);
  const placement = buildAfcSr1OriginalBasisPlacement(input.placement);
  const targetBasis = input.descriptor.originalTargetBasis;
  if (placement.status !== "placed_on_original_basis" ||
      placement.targetOriginalBasis.fingerprint !== targetBasis.fingerprint ||
      placement.targetOriginalBasis.decodedWidth !== targetBasis.decodedWidth ||
      placement.targetOriginalBasis.decodedHeight !== targetBasis.decodedHeight ||
      placement.targetOriginalBasis.orientation !== targetBasis.orientation) {
    fail("placement_original_basis_mismatch");
  }
  const style = input.style ?? AFC_SR1_DEFAULT_OVERLAY_STYLE_V1;
  const styleDigest = digestAfcSr1OverlayStyle(style);
  const { decodedWidth: width, decodedHeight: height } = input.descriptor.originalTargetBasis;
  const descriptorFingerprint = fingerprintAfcSr1OverlayDescriptor(input.descriptor);
  const polygon = input.descriptor.rawSourcePolygon.map(point => pixelPoint(point, width, height));
  const nl = input.descriptor.hypotheses.NL;
  const nr = input.descriptor.hypotheses.NR;
  const nlStart = pixelPoint(nl.seamStartNear, width, height);
  const nlEnd = pixelPoint(nl.seamEndFar, width, height);
  const nrStart = pixelPoint(nr.seamStartNear, width, height);
  const nrEnd = pixelPoint(nr.seamEndFar, width, height);
  const nlClipped = clipLineToBounds(nlStart, nlEnd, width, height);
  const nrClipped = clipLineToBounds(nrStart, nrEnd, width, height);
  const polygonPoints = polygon.map(pathPoint).join(" ");
  const dash = style.seamDashPatternPx.map(serializeAfcSr1SvgNumber).join(" ");
  const svgUtf8 = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden">`,
    `<g>`,
    `<polygon points="${polygonPoints}" fill="${style.polygonFill}" fill-opacity="${serializeAfcSr1SvgNumber(style.polygonFillOpacity)}" stroke="${style.polygonStroke}" stroke-width="${serializeAfcSr1SvgNumber(style.polygonLineWidthPx)}" stroke-linejoin="round"/>`,
    `<path d="M${pathPoint(nlStart)} L${pathPoint(nlEnd)}" fill="none" stroke="${style.nlSeamStroke}" stroke-width="${serializeAfcSr1SvgNumber(style.seamLineWidthPx)}" stroke-dasharray="${dash}" stroke-linecap="butt"/>`,
    `<path d="M${pathPoint(nrStart)} L${pathPoint(nrEnd)}" fill="none" stroke="${style.nrSeamStroke}" stroke-width="${serializeAfcSr1SvgNumber(style.seamLineWidthPx)}" stroke-dasharray="${dash}" stroke-linecap="butt"/>`,
    arrowForClippedLine(nlClipped, style.nlSeamStroke, style),
    arrowForClippedLine(nrClipped, style.nrSeamStroke, style),
    `</g>`,
    badge("NL", polygon[0], width, height, style),
    badge("NR", polygon[1], width, height, style),
    badge("FR", polygon[2], width, height, style),
    badge("FL", polygon[3], width, height, style),
    `<g data-legend="semantic-corner-and-near-to-far"><rect x="6" y="6" width="74" height="22" rx="3" fill="#111827" fill-opacity="0.88"/><path d="M12 13 L32 13" fill="none" stroke="${style.nlSeamStroke}" stroke-width="${serializeAfcSr1SvgNumber(style.seamLineWidthPx)}" stroke-dasharray="${dash}"/><path d="M12 22 L32 22" fill="none" stroke="${style.nrSeamStroke}" stroke-width="${serializeAfcSr1SvgNumber(style.seamLineWidthPx)}" stroke-dasharray="${dash}"/><path d="${glyphPath("N", 40, 10, 1.5)} ${glyphPath("L", 48, 10, 1.5)} ${glyphPath("N", 58, 10, 1.5)} ${glyphPath("R", 66, 10, 1.5)}" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>`,
    `</svg>`,
  ].join("");
  const metadata: AfcSr1CanonicalSvgArtifactV1 = Object.freeze({
    schemaVersion: AFC_SR1_CANONICAL_SVG_VERSION,
    overlayDescriptorFingerprint: descriptorFingerprint,
    styleVersion: AFC_SR1_OVERLAY_STYLE_VERSION,
    styleDigest,
    width,
    height,
    svgUtf8Sha256: sha256HexUtf8(svgUtf8),
    svgUtf8ByteLength: Buffer.byteLength(svgUtf8, "utf8"),
    overlayGenerationId: input.descriptor.overlayGenerationId,
  });
  return Object.freeze({ metadata, svgUtf8 });
}

export async function verifyAfcSr1OriginalImage(input: Readonly<{
  bytes: Uint8Array;
  expectedBasis: AfcSr1ImageBasisV1;
}>): Promise<AfcSr1VerifiedOriginalImageV1> {
  const bytes = Buffer.from(input.bytes);
  validateAfcSr1ImageBasis(input.expectedBasis);
  if (bytes.byteLength === 0) fail("original_image_empty");
  const mimeType = mimeFromMagic(bytes);
  if (!mimeType) fail("original_image_magic_unsupported");
  const metadata = await sharp(bytes, { animated: false, failOn: "error" }).metadata();
  const formatMime = metadata.format === "jpeg" ? "image/jpeg" :
    metadata.format === "png" ? "image/png" :
    metadata.format === "webp" ? "image/webp" : null;
  if (formatMime !== mimeType) fail("original_image_magic_metadata_mismatch");
  const orientation = metadata.orientation ?? 1;
  const sha256 = byteSha256(bytes);
  if (metadata.width !== input.expectedBasis.decodedWidth ||
      metadata.height !== input.expectedBasis.decodedHeight ||
      orientation !== 1 ||
      sha256 !== input.expectedBasis.fingerprint) {
    fail("original_image_basis_mismatch");
  }
  return Object.freeze({
    schemaVersion: AFC_SR1_VERIFIED_ORIGINAL_IMAGE_VERSION,
    basis: frozenBasis(input.expectedBasis),
    mimeType,
    byteCount: bytes.byteLength,
    sha256,
  });
}

export async function rasterizeAfcSr1Overlay(input: Readonly<{
  canonicalSvg: Readonly<{ metadata: AfcSr1CanonicalSvgArtifactV1; svgUtf8: string }>;
}>): Promise<Readonly<{ metadata: AfcSr1RenderedOverlayArtifactV1; pngBytes: Buffer }>> {
  const { metadata: svg, svgUtf8 } = input.canonicalSvg;
  if (svg.svgUtf8Sha256 !== sha256HexUtf8(svgUtf8) ||
      svg.svgUtf8ByteLength !== Buffer.byteLength(svgUtf8, "utf8")) {
    fail("canonical_svg_digest_mismatch");
  }
  const pngBytes = await sharp(Buffer.from(svgUtf8, "utf8"), { density: 72, limitInputPixels: false })
    .ensureAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();
  return Object.freeze({
    metadata: Object.freeze({
      schemaVersion: AFC_SR1_RENDERED_OVERLAY_VERSION,
      overlayDescriptorFingerprint: svg.overlayDescriptorFingerprint,
      styleVersion: AFC_SR1_OVERLAY_STYLE_VERSION,
      styleDigest: svg.styleDigest,
      width: svg.width,
      height: svg.height,
      svgUtf8Sha256: svg.svgUtf8Sha256,
      overlayPngSha256: byteSha256(pngBytes),
      overlayPngByteLength: pngBytes.byteLength,
      overlayGenerationId: svg.overlayGenerationId,
    }),
    pngBytes,
  });
}

export async function composeAfcSr1OriginalPlusOverlay(input: Readonly<{
  originalBytes: Uint8Array;
  originalImage: AfcSr1VerifiedOriginalImageV1;
  renderedOverlay: Readonly<{ metadata: AfcSr1RenderedOverlayArtifactV1; pngBytes: Uint8Array }>;
}>): Promise<Readonly<{ metadata: AfcSr1CompositeImageArtifactV1; pngBytes: Buffer }>> {
  const originalBytes = Buffer.from(input.originalBytes);
  const overlayBytes = Buffer.from(input.renderedOverlay.pngBytes);
  if (byteSha256(originalBytes) !== input.originalImage.sha256 ||
      input.originalImage.sha256 !== input.originalImage.basis.fingerprint ||
      byteSha256(overlayBytes) !== input.renderedOverlay.metadata.overlayPngSha256) {
    fail("composite_input_digest_mismatch");
  }
  const overlayMetadata = await sharp(overlayBytes).metadata();
  if (overlayMetadata.width !== input.originalImage.basis.decodedWidth ||
      overlayMetadata.height !== input.originalImage.basis.decodedHeight) {
    fail("composite_overlay_dimensions_mismatch");
  }
  const pngBytes = await sharp(originalBytes, { animated: false, failOn: "error" })
    .ensureAlpha()
    .composite([{ input: overlayBytes, blend: "over" }])
    .png(PNG_OPTIONS)
    .toBuffer();
  return Object.freeze({
    metadata: Object.freeze({
      schemaVersion: AFC_SR1_COMPOSITE_IMAGE_VERSION,
      composition: "original_plus_advisory_overlay/v1",
      mimeType: "image/png",
      width: input.originalImage.basis.decodedWidth,
      height: input.originalImage.basis.decodedHeight,
      originalImageSha256: input.originalImage.sha256,
      overlayPngSha256: input.renderedOverlay.metadata.overlayPngSha256,
      compositePngSha256: byteSha256(pngBytes),
      compositePngByteLength: pngBytes.byteLength,
    }),
    pngBytes,
  });
}

export function validateAfcSr1VerifiedOriginalImage(value: unknown): asserts value is AfcSr1VerifiedOriginalImageV1 {
  if (!value || typeof value !== "object") fail("verified_original_shape_invalid");
  const image = value as AfcSr1VerifiedOriginalImageV1;
  try {
    validateAfcSr1ImageBasis(image.basis);
  } catch {
    fail("verified_original_basis_invalid");
  }
  if (image.schemaVersion !== AFC_SR1_VERIFIED_ORIGINAL_IMAGE_VERSION ||
      !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) ||
      !Number.isInteger(image.byteCount) || image.byteCount <= 0 ||
      !SHA256_HEX.test(image.sha256) ||
      image.sha256 !== image.basis.fingerprint) {
    fail("verified_original_invalid");
  }
}
