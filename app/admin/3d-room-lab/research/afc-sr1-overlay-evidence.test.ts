import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import sharp from "sharp";

import roomC from "./fixtures/afc-sr1-room-c-ground-truth.v1.json";
import {
  AFC_SR1_DEFAULT_OVERLAY_STYLE_V1,
  analyzeAfcSr1OverlayVisibility,
  buildAfcSr1CanonicalSvg,
  composeAfcSr1OriginalPlusOverlay,
  digestAfcSr1OverlayStyle,
  mapAfcSr1SourcePointToOriginalPixels,
  rasterizeAfcSr1Overlay,
  serializeAfcSr1SvgNumber,
  validateAfcSr1OverlayStyle,
  verifyAfcSr1OriginalImage,
} from "./afc-sr1-overlay-evidence";
import {
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1OverlayDescriptor,
} from "./afc-sr1-semantic-prior";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 45, b: 60 } },
  }).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: false, palette: false }).toBuffer();
  const basis = {
    fingerprint: hash(bytes), decodedWidth: 64, decodedHeight: 48, orientation: 1 as const,
  };
  const descriptor = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: basis,
    rawSourcePolygon: [
      { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.86 }, { x: 0.68, y: 0.34 }, { x: 0.28, y: 0.42 },
    ],
    overlayGenerationId: "overlay-test",
  });
  const placement = buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "already_original_basis",
    sourceEmptyBasis: basis,
    targetOriginalBasis: basis,
    compatibilityTier: "exact_grid_compatible",
    transferRecordFingerprint: "f".repeat(64),
  });
  return { bytes, basis, descriptor, placement };
}

test("P1 style is immutable, explicit, and digest-stable", () => {
  assert.equal(Object.isFrozen(AFC_SR1_DEFAULT_OVERLAY_STYLE_V1), true);
  assert.equal(Object.isFrozen(AFC_SR1_DEFAULT_OVERLAY_STYLE_V1.seamDashPatternPx), true);
  const digest = digestAfcSr1OverlayStyle(AFC_SR1_DEFAULT_OVERLAY_STYLE_V1);
  assert.equal(digest, digestAfcSr1OverlayStyle(AFC_SR1_DEFAULT_OVERLAY_STYLE_V1));
  const changed = Object.freeze({
    ...AFC_SR1_DEFAULT_OVERLAY_STYLE_V1,
    polygonStroke: "#000000",
    seamDashPatternPx: Object.freeze([...AFC_SR1_DEFAULT_OVERLAY_STYLE_V1.seamDashPatternPx]),
  });
  assert.notEqual(digest, digestAfcSr1OverlayStyle(changed));
});

test("P1 accepts only frozen #RRGGBB style colors before hashing or rendering", async () => {
  const { descriptor, placement } = await fixture();
  const valid = Object.freeze({
    ...AFC_SR1_DEFAULT_OVERLAY_STYLE_V1,
    polygonStroke: "#123456",
    seamDashPatternPx: Object.freeze([...AFC_SR1_DEFAULT_OVERLAY_STYLE_V1.seamDashPatternPx]),
  });
  assert.doesNotThrow(() => validateAfcSr1OverlayStyle(valid));
  assert.notEqual(
    digestAfcSr1OverlayStyle(AFC_SR1_DEFAULT_OVERLAY_STYLE_V1),
    digestAfcSr1OverlayStyle(valid),
  );
  assert.notEqual(
    buildAfcSr1CanonicalSvg({ descriptor, placement }).metadata.svgUtf8Sha256,
    buildAfcSr1CanonicalSvg({ descriptor, placement, style: valid }).metadata.svgUtf8Sha256,
  );
  const injection = Object.freeze({
    ...valid,
    polygonStroke: `#000000" /><script>alert(1)</script><path stroke="#000000`,
  });
  assert.throws(
    () => buildAfcSr1CanonicalSvg({ descriptor, placement, style: injection }),
    /overlay_style_color_invalid/,
  );
  for (const unsafeColor of ["red", "rgb(0,0,0)", "url(#paint)", "#FFF", "#FFFFFFFF"]) {
    const unsafe = Object.freeze({ ...valid, polygonStroke: unsafeColor });
    assert.throws(() => digestAfcSr1OverlayStyle(unsafe), /overlay_style_color_invalid/);
  }
});

test("P1 maps directly to Original pixels and canonicalizes SVG numbers", () => {
  const mapped = mapAfcSr1SourcePointToOriginalPixels(
    { x: -0.25, y: 1.25 },
    { fingerprint: "a".repeat(64), decodedWidth: 64, decodedHeight: 48, orientation: 1 },
  );
  assert.deepEqual(mapped, { x: -16, y: 60 });
  assert.equal(serializeAfcSr1SvgNumber(-0), "0");
  assert.equal(serializeAfcSr1SvgNumber(1.2), "1.2");
  assert.equal(serializeAfcSr1SvgNumber(1 / 3), "0.333");
  assert.equal(serializeAfcSr1SvgNumber(1000000000), "1000000000");
});

test("P1 emits deterministic font-free clipped SVG and PNG evidence", async () => {
  const { bytes, basis, descriptor, placement } = await fixture();
  const original = await verifyAfcSr1OriginalImage({ bytes, expectedBasis: basis });
  const firstSvg = buildAfcSr1CanonicalSvg({ descriptor, placement });
  const secondSvg = buildAfcSr1CanonicalSvg({ descriptor, placement });
  assert.equal(firstSvg.svgUtf8, secondSvg.svgUtf8);
  assert.equal(firstSvg.svgUtf8.includes("<text"), false);
  assert.equal(firstSvg.svgUtf8.includes("-0"), false);
  assert.ok(firstSvg.svgUtf8.includes('overflow="hidden"'));
  assert.ok(firstSvg.svgUtf8.includes('data-corner="NL"'));
  assert.ok(firstSvg.svgUtf8.includes('data-corner="NR"'));
  for (const unsafeSvgContent of ["<script", "javascript:", "url(", "<foreignObject", "onload=", "onclick="]) {
    assert.equal(firstSvg.svgUtf8.includes(unsafeSvgContent), false, unsafeSvgContent);
  }
  const firstOverlay = await rasterizeAfcSr1Overlay({ canonicalSvg: firstSvg });
  const secondOverlay = await rasterizeAfcSr1Overlay({ canonicalSvg: secondSvg });
  assert.deepEqual(firstOverlay.pngBytes, secondOverlay.pngBytes);
  const firstComposite = await composeAfcSr1OriginalPlusOverlay({
    originalBytes: bytes, originalImage: original, renderedOverlay: firstOverlay,
  });
  const secondComposite = await composeAfcSr1OriginalPlusOverlay({
    originalBytes: bytes, originalImage: original, renderedOverlay: secondOverlay,
  });
  assert.deepEqual(firstComposite.pngBytes, secondComposite.pngBytes);
  assert.equal(firstComposite.metadata.mimeType, "image/png");
});

test("P1 visibility is geometry-preserving and fail-closed", async () => {
  const { basis, descriptor, placement } = await fixture();
  assert.equal(analyzeAfcSr1OverlayVisibility(descriptor).status, "supported");
  const offFrame = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: basis,
    rawSourcePolygon: [
      { x: -0.25, y: 1.2 }, { x: -0.1, y: 1.18 }, { x: -0.2, y: 1.05 }, { x: -0.25, y: 1.08 },
    ],
    overlayGenerationId: "off-frame",
  });
  assert.equal(analyzeAfcSr1OverlayVisibility(offFrame).status, "unsupported_visibility");
  const svg = buildAfcSr1CanonicalSvg({ descriptor: offFrame, placement }).svgUtf8;
  assert.ok(svg.includes("-16"));
});

test("P1 verifies Original bytes against magic, digest, decoded basis, and orientation", async () => {
  const { bytes, basis } = await fixture();
  await assert.doesNotReject(() => verifyAfcSr1OriginalImage({ bytes, expectedBasis: basis }));
  await assert.rejects(
    () => verifyAfcSr1OriginalImage({ bytes, expectedBasis: { ...basis, fingerprint: "0".repeat(64) } }),
    /basis_mismatch/,
  );
  await assert.rejects(
    () => verifyAfcSr1OriginalImage({ bytes: Buffer.from("not an image"), expectedBasis: basis }),
    /magic_unsupported/,
  );
});

test("P1 keeps Room C's certified raw geometry as identity-only visibility evidence", () => {
  const basis = {
    fingerprint: roomC.imageBasis.fingerprint!,
    decodedWidth: roomC.imageBasis.decodedWidth!,
    decodedHeight: roomC.imageBasis.decodedHeight!,
    orientation: 1 as const,
  };
  const descriptor = buildAfcSr1OverlayDescriptor({
    originalTargetBasis: basis,
    rawSourcePolygon: roomC.rawFloor.polygon as any,
    overlayGenerationId: "room-c-identity-only",
  });
  const placement = buildAfcSr1OriginalBasisPlacement({
    schemaVersion: "afc-sr1-original-basis-placement/v1",
    status: "placed_on_original_basis",
    method: "already_original_basis",
    sourceEmptyBasis: basis,
    targetOriginalBasis: basis,
    compatibilityTier: "exact_grid_compatible",
    transferRecordFingerprint: "f".repeat(64),
  });
  const visibility = analyzeAfcSr1OverlayVisibility(descriptor);
  assert.equal(visibility.status, "supported");
  assert.ok(visibility.nrSeam.visibleLengthPx > 0);
  const svg = buildAfcSr1CanonicalSvg({ descriptor, placement }).svgUtf8;
  assert.equal(svg.includes("0.7063703325987577"), false);
  assert.equal(svg.includes("verticalFov"), false);
  assert.equal(svg.includes("worldWidth"), false);
});
