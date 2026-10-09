import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectProductionPayloadPrivacyViolations } from "@/lib/afc-v2-production/privacy";
import { createPi3aAuthority } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { buildProductionPerspectiveCamera } from "@/lib/afc-v2-runtime/frozen-camera";
import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";

import {
  decodeHarmonizeBackground,
  displayedHarmonizeBackgroundUrl,
  executeHarmonizeExport,
} from "./harmonize-export-client";
import { stageCameraMatchesRealized } from "./harmonize-export-scene";
import {
  HARMONIZE_EXPORT_FILES,
  HARMONIZE_EXPORT_VERSION,
  HarmonizeExportError,
  buildHarmonizeZip,
  classifyHarmonizeBackground,
  crc32,
  decideHarmonizeExportFrame,
  decodePngRgba,
  encodeRgbaPng,
  furnitureMatteRgba,
  harmonizeBackgroundFileName,
  harmonizeBackgroundMediaType,
  harmonizeCameraRecord,
  harmonizeExportFileName,
  harmonizeExportObject,
  harmonizeScaleRefusal,
  requireHarmonizePixelFrame,
  pngSamplesToRgba,
  readPngSize,
  sha256HexBytes,
  unfilterPngImage,
  type HarmonizeExportAuthority,
  type HarmonizeFrameSuccess,
  type HarmonizeFurnitureCapture,
} from "./harmonize-export";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION_ID = "22222222-2222-4222-8222-222222222222";
const VIEWPORT_URL = "https://images.example.test/viewport.png";
const ORIGINAL_URL = "https://images.example.test/original.png";

function viewportInput(
  bytes: Uint8Array,
  urls: Readonly<{ backgroundUrl?: string; originalImageUrl?: string | null }> = {},
) {
  return {
    backgroundUrl: urls.backgroundUrl ?? VIEWPORT_URL,
    originalImageUrl: "originalImageUrl" in urls ? urls.originalImageUrl : ORIGINAL_URL,
    fetchBackground: async () => bytes,
  };
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    assert.equal(method, 0);
    files.set(name, Uint8Array.from(bytes.subarray(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}

function authority(
  width: number,
  height: number,
  sha256: string,
): HarmonizeExportAuthority {
  return {
    generationId: GENERATION_ID,
    empty: { sha256, decodedWidth: width, decodedHeight: height },
    frame: { width, height },
    frozenCamera: { frame: { width, height } },
  };
}

function captureFor(
  rgba: Uint8Array,
  width: number,
  height: number,
  frame: Readonly<{ width: number; height: number }> = { width, height },
): HarmonizeFurnitureCapture {
  return {
    rgba,
    width,
    height,
    contactShadowsHidden: 2,
    objects: [
      {
        objectId: "b",
        assetId: "asset-b",
        productId: "prod-b",
        variantId: "var-b",
        positionM: { x: 1, y: 0, z: 2 },
        rotationDeg: { x: 0, y: 90, z: 0 },
        userSizeMultiplier: 1,
        effectiveDimensionsM: { width: 2, height: 0.8, depth: 0.9 },
      },
      {
        objectId: "a",
        assetId: "asset-a",
        productId: null,
        variantId: null,
        positionM: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        userSizeMultiplier: 1.25,
        effectiveDimensionsM: null,
      },
    ],
    unmountedObjectIds: ["z-skipped", "m-skipped"],
    camera: {
      projection: "frozen-production-perspective",
      verticalFovDeg: 50,
      aspect: frame.width / frame.height,
      near: 0.1,
      far: 100,
      frame: { width: frame.width, height: frame.height },
      pose: {
        position: { x: 0, y: 1, z: 3 },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
    },
    roomScaleMultiplier: 1.1,
    certifiedMetricScale: 1,
    effectiveMetricScale: 1.1,
    generationId: GENERATION_ID,
  };
}

test("frame decision admits a 1200×896 viewport background on a 2048×1536 camera", () => {
  const matched = decideHarmonizeExportFrame({
    imageWidth: 1200,
    imageHeight: 896,
    frameWidth: 2048,
    frameHeight: 1536,
    authorityFrameWidth: 2048,
    authorityFrameHeight: 1536,
    imageOrientation: 1,
    originalOrientation: 1,
  });
  assert.equal(matched.ok, true);
  if (!matched.ok) return;
  assert.equal(matched.width, 1200);
  assert.equal(matched.height, 896);
  assert.deepEqual(matched.certifiedFrame, { width: 2048, height: 1536 });
  assert.equal(matched.compatibilityTier, "aspect_compatible_rescaled");
  assert.equal(matched.mapping, "identity-normalized");
  assert.equal(matched.exportResolutionSource, "active-viewport");
  assert.equal(matched.backgroundResampled, false);
  assert.equal(matched.cameraProjectionModified, false);
  const expectedError = Math.abs((1200 / 896) - (2048 / 1536)) / (2048 / 1536);
  assert.equal(matched.relativeAspectError, expectedError);
  assert.ok(expectedError > 0.004 && expectedError < 0.005);
  assert.ok(expectedError <= 0.015);

  const equal = decideHarmonizeExportFrame({
    imageWidth: 1200,
    imageHeight: 800,
    frameWidth: 1200,
    frameHeight: 800,
    authorityFrameWidth: 1200,
    authorityFrameHeight: 800,
  });
  assert.equal(equal.ok, true);
  if (!equal.ok) return;
  assert.equal(equal.compatibilityTier, "exact_grid_compatible");
  assert.equal(equal.relativeAspectError, 0);

  const mismatched = decideHarmonizeExportFrame({
    imageWidth: 1000,
    imageHeight: 800,
    frameWidth: 1200,
    frameHeight: 800,
    authorityFrameWidth: 1200,
    authorityFrameHeight: 800,
  });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.match(mismatched.reason, /stopped instead of scaling/);

  const inconsistent = decideHarmonizeExportFrame({
    imageWidth: 1200,
    imageHeight: 896,
    frameWidth: 2048,
    frameHeight: 1536,
    authorityFrameWidth: 1200,
    authorityFrameHeight: 896,
  });
  assert.equal(inconsistent.ok, false);
  if (!inconsistent.ok) assert.match(inconsistent.reason, /room authority/);

  const turned = decideHarmonizeExportFrame({
    imageWidth: 1200,
    imageHeight: 896,
    frameWidth: 2048,
    frameHeight: 1536,
    authorityFrameWidth: 2048,
    authorityFrameHeight: 1536,
    imageOrientation: 6,
  });
  assert.equal(turned.ok, false);
  if (!turned.ok) assert.match(turned.reason, /orientation/);

  assert.equal(harmonizeScaleRefusal({
    actualWidth: 10,
    actualHeight: 8,
    expectedWidth: 12,
    expectedHeight: 8,
  })?.includes("stopped instead of scaling"), true);
  assert.equal(harmonizeExportFileName(ROOM_ID), `vibode-harmonize-${ROOM_ID}.zip`);
});

test("PNG roundtrip keeps samples and rejects conversion cases", async () => {
  const rgba = Uint8Array.of(
    10, 20, 30, 255,
    40, 50, 60, 128,
    0, 0, 0, 0,
    255, 255, 255, 255,
  );
  const encoded = await encodeRgbaPng(rgba, 2, 2);
  assert.deepEqual(readPngSize(encoded), { width: 2, height: 2 });
  const decoded = await decodePngRgba(encoded);
  assert.deepEqual(decoded.rgba, rgba);

  const interlaced = Uint8Array.from(encoded);
  interlaced[28] = 1;
  const checksum = crc32(interlaced.subarray(12, 29));
  new DataView(interlaced.buffer).setUint32(29, checksum);
  await assert.rejects(decodePngRgba(interlaced), /without conversion/);
});

test("PNG filters and transparency keys reconstruct RGBA", () => {
  const sub = Uint8Array.of(1, 10, 20, 30, 30, 30, 30);
  assert.deepEqual(
    unfilterPngImage(sub, 2, 1, 3),
    Uint8Array.of(10, 20, 30, 40, 50, 60),
  );
  const keyed = pngSamplesToRgba({
    colorType: 2,
    raw: Uint8Array.of(9, 8, 7, 1, 2, 3),
    width: 2,
    height: 1,
    transparency: Uint8Array.of(0, 1, 0, 2, 0, 3),
  });
  assert.deepEqual(keyed, Uint8Array.of(9, 8, 7, 255, 1, 2, 3, 0));
});

test("package aligns B C and D to the active EMPTY viewport and preserves its samples", async () => {
  const room = Uint8Array.of(
    10, 20, 30, 255,
    40, 50, 60, 255,
    1, 2, 3, 255,
    9, 9, 9, 255,
  );
  const furniture = Uint8Array.of(
    255, 0, 0, 255,
    0, 0, 0, 0,
    255, 0, 0, 128,
    0, 0, 0, 0,
  );
  const emptyBytes = await encodeRgbaPng(room, 2, 2);
  const sha = await sha256HexBytes(emptyBytes);
  let captured: { width: number; height: number; orientation: number } | null = null;
  const saved: { fileName: string; bytes: Uint8Array }[] = [];
  await executeHarmonizeExport({
    roomId: ROOM_ID,
    authority: authority(2, 2, sha),
    now: () => new Date("2026-10-08T12:00:00.000Z"),
    ...viewportInput(emptyBytes),
    save: (fileName, bytes) => {
      saved.push({ fileName, bytes });
    },
    captureFurniture: (size) => {
      captured = size;
      return captureFor(furniture, size.width, size.height);
    },
  });
  assert.deepEqual(captured, { width: 2, height: 2, orientation: 1 });
  const zip = saved[0];
  assert.ok(zip);
  assert.equal(zip.fileName, `vibode-harmonize-${ROOM_ID}.zip`);
  const files = readZip(zip.bytes);
  assert.deepEqual([...files.keys()], [
    HARMONIZE_EXPORT_FILES.empty,
    HARMONIZE_EXPORT_FILES.composite,
    HARMONIZE_EXPORT_FILES.furniture,
    HARMONIZE_EXPORT_FILES.matte,
    HARMONIZE_EXPORT_FILES.manifest,
  ]);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.empty), emptyBytes);
  const composite = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.composite)!);
  const cutout = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.furniture)!);
  const matte = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.matte)!);
  assert.equal(composite.width, 2);
  assert.equal(cutout.width, 2);
  assert.equal(matte.width, 2);
  assert.deepEqual(cutout.rgba, furniture);
  assert.deepEqual(matte.rgba, furnitureMatteRgba(furniture));
  assert.deepEqual(composite.rgba.subarray(0, 4), Uint8Array.of(255, 0, 0, 255));
  assert.deepEqual(composite.rgba.subarray(4, 8), room.subarray(4, 8));
  assert.deepEqual(composite.rgba.subarray(8, 12), Uint8Array.of(128, 1, 1, 255));
  assert.deepEqual(composite.rgba.subarray(12, 16), room.subarray(12, 16));
  assert.deepEqual(matte.rgba.subarray(0, 4), Uint8Array.of(255, 255, 255, 255));
  assert.deepEqual(matte.rgba.subarray(4, 8), Uint8Array.of(0, 0, 0, 255));

  const manifest = JSON.parse(new TextDecoder().decode(files.get(HARMONIZE_EXPORT_FILES.manifest))) as {
    exportVersion: string;
    alignment: {
      background: {
        source: string;
        width: number;
        height: number;
        matchesEmpty: boolean;
        matchesOriginal: boolean;
      };
      certifiedFrame: { width: number; height: number };
      compatibilityTier: string;
      relativeAspectError: number;
      mapping: string;
      exportResolutionSource: string;
      backgroundResampled: boolean;
      cameraProjectionModified: boolean;
      backgroundMatchesCertifiedFrame: boolean;
    };
    emptyReference: string;
    images: Record<string, { width: number; height: number; reencoded: boolean; role: string }>;
    contactShadows: string;
    selectionDecorations: string;
    roomOccluders: string;
    objects: { objectId: string }[];
    sceneSnapshotSha256: string;
    roomScaleMultiplier: number;
  };
  assert.equal(manifest.exportVersion, HARMONIZE_EXPORT_VERSION);
  assert.equal(manifest.alignment.backgroundResampled, false);
  assert.equal(manifest.alignment.cameraProjectionModified, false);
  assert.equal(manifest.emptyReference, "same-as-background");
  assert.deepEqual(manifest.alignment, {
    background: {
      source: "empty",
      width: 2,
      height: 2,
      matchesEmpty: true,
      matchesOriginal: false,
    },
    certifiedFrame: { width: 2, height: 2 },
    compatibilityTier: "exact_grid_compatible",
    relativeAspectError: 0,
    mapping: "identity-normalized",
    exportResolutionSource: "active-viewport",
    backgroundResampled: false,
    cameraProjectionModified: false,
    backgroundMatchesCertifiedFrame: true,
  });
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.empty].role, "authoritative-empty");
  for (const image of Object.values(manifest.images)) {
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
  }
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.empty].reencoded, false);
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.composite].reencoded, true);
  assert.equal(manifest.contactShadows, "excluded");
  assert.equal(manifest.selectionDecorations, "excluded");
  assert.equal(manifest.roomOccluders, "none-in-stage-renderer");
  assert.deepEqual(manifest.objects.map((object) => object.objectId), ["a", "b"]);
  assert.equal(manifest.roomScaleMultiplier, 1.1);
  assert.match(manifest.sceneSnapshotSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(collectProductionPayloadPrivacyViolations(manifest), []);
});

test("aspect-compatible viewport background exports on its own grid with the certified camera", async () => {
  const backgroundWidth = 75;
  const backgroundHeight = 56;
  const frameWidth = 128;
  const frameHeight = 96;
  const room = new Uint8Array(backgroundWidth * backgroundHeight * 4);
  room.set([10, 20, 30, 255], 0);
  room.set([40, 50, 60, 255], 4);
  room.set([9, 9, 9, 255], room.length - 4);
  const furniture = new Uint8Array(room.length);
  furniture.set([255, 0, 0, 255], 0);
  furniture.set([255, 0, 0, 128], 8);
  const backgroundBytes = await encodeRgbaPng(room, backgroundWidth, backgroundHeight);
  const referenceBytes = await encodeRgbaPng(Uint8Array.of(7, 8, 9, 255), 1, 1);
  const referenceSha = await sha256HexBytes(referenceBytes);
  let capturedAspect = 0;
  const saved: { bytes: Uint8Array }[] = [];
  await executeHarmonizeExport({
    roomId: ROOM_ID,
    authority: {
      generationId: GENERATION_ID,
      empty: { sha256: referenceSha, decodedWidth: 1, decodedHeight: 1, orientation: 1 },
      original: { sha256: "b".repeat(64), orientation: 1 },
      frame: { width: frameWidth, height: frameHeight },
      frozenCamera: { frame: { width: frameWidth, height: frameHeight } },
    },
    ...viewportInput(backgroundBytes),
    fetchEmpty: async () => referenceBytes,
    save: (_fileName, bytes) => {
      saved.push({ bytes });
    },
    captureFurniture: (size) => {
      const capture = captureFor(furniture, size.width, size.height, {
        width: frameWidth,
        height: frameHeight,
      });
      capturedAspect = capture.camera.aspect;
      return capture;
    },
  });
  assert.equal(capturedAspect, frameWidth / frameHeight);
  assert.notEqual(capturedAspect, backgroundWidth / backgroundHeight);
  const zip = saved[0];
  assert.ok(zip);
  const files = readZip(zip.bytes);
  assert.equal(files.has(HARMONIZE_EXPORT_FILES.empty), false);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.backgroundPng), backgroundBytes);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.referenceEmpty), referenceBytes);
  const composite = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.composite)!);
  const cutout = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.furniture)!);
  const matte = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.matte)!);
  assert.equal(composite.width, backgroundWidth);
  assert.equal(composite.height, backgroundHeight);
  assert.equal(cutout.width, backgroundWidth);
  assert.equal(cutout.height, backgroundHeight);
  assert.equal(matte.width, backgroundWidth);
  assert.equal(matte.height, backgroundHeight);
  assert.deepEqual(cutout.rgba, furniture);
  assert.deepEqual(matte.rgba, furnitureMatteRgba(furniture));
  assert.deepEqual(composite.rgba.subarray(0, 4), Uint8Array.of(255, 0, 0, 255));
  assert.deepEqual(composite.rgba.subarray(4, 8), room.subarray(4, 8));
  assert.deepEqual(composite.rgba.subarray(room.length - 4), room.subarray(room.length - 4));
  const manifest = JSON.parse(new TextDecoder().decode(files.get(HARMONIZE_EXPORT_FILES.manifest))) as {
    alignment: {
      background: {
        source: string;
        width: number;
        height: number;
        matchesEmpty: boolean;
        matchesOriginal: boolean;
      };
      certifiedFrame: { width: number; height: number };
      compatibilityTier: string;
      mapping: string;
      backgroundResampled: boolean;
      cameraProjectionModified: boolean;
      backgroundMatchesCertifiedFrame: boolean;
    };
    emptyReference: string;
    camera: { aspect: number; frame: { width: number; height: number }; verticalFovDeg: number };
    images: Record<string, { width: number; height: number; reencoded: boolean; role: string }>;
  };
  assert.deepEqual(manifest.alignment.background, {
    source: "room-state",
    width: backgroundWidth,
    height: backgroundHeight,
    matchesEmpty: false,
    matchesOriginal: false,
  });
  assert.deepEqual(manifest.alignment.certifiedFrame, { width: frameWidth, height: frameHeight });
  assert.equal(manifest.alignment.compatibilityTier, "aspect_compatible_rescaled");
  assert.equal(manifest.alignment.mapping, "identity-normalized");
  assert.equal(manifest.alignment.backgroundResampled, false);
  assert.equal(manifest.alignment.cameraProjectionModified, false);
  assert.equal(manifest.alignment.backgroundMatchesCertifiedFrame, false);
  assert.equal(manifest.emptyReference, "included");
  assert.equal(manifest.camera.aspect, frameWidth / frameHeight);
  assert.equal(manifest.camera.verticalFovDeg, 50);
  assert.deepEqual(manifest.camera.frame, { width: frameWidth, height: frameHeight });
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.backgroundPng].reencoded, false);
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.backgroundPng].role, "viewport-background");
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.referenceEmpty].width, 1);
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.referenceEmpty].height, 1);
  assert.equal(manifest.images[HARMONIZE_EXPORT_FILES.referenceEmpty].role, "authoritative-empty");
  for (const name of [
    HARMONIZE_EXPORT_FILES.backgroundPng,
    HARMONIZE_EXPORT_FILES.composite,
    HARMONIZE_EXPORT_FILES.furniture,
    HARMONIZE_EXPORT_FILES.matte,
  ]) {
    assert.equal(manifest.images[name].width, backgroundWidth);
    assert.equal(manifest.images[name].height, backgroundHeight);
  }
  assert.deepEqual(collectProductionPayloadPrivacyViolations(manifest), []);
  assert.doesNotMatch(JSON.stringify(manifest), /images\.example|token=|storage\/v1\/object/);
});

test("rewriting the camera aspect to the viewport aspect does not save a package", async () => {
  const emptyBytes = await encodeRgbaPng(Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255), 2, 1);
  const sha = await sha256HexBytes(emptyBytes);
  let saved = false;
  await assert.rejects(
    executeHarmonizeExport({
      roomId: ROOM_ID,
      authority: {
        ...authority(2, 1, sha),
        frame: { width: 4, height: 2 },
        frozenCamera: { frame: { width: 4, height: 2 } },
      },
      ...viewportInput(emptyBytes),
      save: () => {
        saved = true;
      },
      captureFurniture: (size) => captureFor(
        Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0),
        size.width,
        size.height,
      ),
    }),
    /stopped instead of scaling/,
  );
  assert.equal(saved, false);
});

test("misaligned viewport background never captures or saves a scaled package", async () => {
  const emptyBytes = await encodeRgbaPng(Uint8Array.of(1, 2, 3, 255), 1, 1);
  const sha = await sha256HexBytes(emptyBytes);
  let captured = false;
  let saved = false;
  await assert.rejects(
    executeHarmonizeExport({
      roomId: ROOM_ID,
      authority: {
        ...authority(1, 1, sha),
        frame: { width: 2, height: 1 },
        frozenCamera: { frame: { width: 2, height: 1 } },
      },
      ...viewportInput(emptyBytes),
      save: () => {
        saved = true;
      },
      captureFurniture: () => {
        captured = true;
        throw new Error("capture should not run");
      },
    }),
    /stopped instead of scaling/,
  );
  assert.equal(captured, false);
  assert.equal(saved, false);
});

test("admin export stays on the existing admin check and the live scene", () => {
  const header = source("components/stage/StageEditorHeader.tsx");
  const button = source("components/stage/HarmonizeExportButton.tsx");
  const route = source("app/api/vibode/admin/harmonize-export/empty/route.ts");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");

  assert.match(header, /<HarmonizeExportButton \/>/);
  assert.doesNotMatch(header, /Download/);
  assert.match(header, /<RoomScaleControl \/>\s*<button[\s\S]*aria-label="Undo"/);
  assert.match(button, /\/api\/auth\/admin-access/);
  assert.match(button, /isAdmin === true/);
  assert.doesNotMatch(button, /isAdminEmail|VIBODE_ADMIN_EMAIL/);
  assert.match(shell, /HarmonizeExportProvider/);
  assert.match(route, /getAuthenticatedAdminUser/);
  assert.match(route, /selectHarmonizeEmptyBytes/);
  assert.doesNotMatch(route, /VIBODE_ADMIN_EMAIL|sharp\(|openai|gemini|CREATE TABLE/i);

  const animate = viewer.slice(
    viewer.indexOf("const animate = () => {"),
    viewer.indexOf("const trustedPathOverlay"),
  );
  const lock = animate.indexOf("if (exportLocked) return;");
  const render = animate.indexOf("renderer.render(scene, camera)");
  assert.ok(lock >= 0 && lock < render);
  const capture = viewer.slice(
    viewer.indexOf("harmonizeCaptureRef.current ="),
    viewer.indexOf("animate();"),
  );
  assert.match(capture, /renderHarmonizeFurniturePixels/);
  assert.match(capture, /requireHarmonizePixelFrame/);
  assert.match(capture, /decideHarmonizeExportFrame/);
  assert.match(capture, /subject: "viewport-background"/);
  assert.match(capture, /imageOrientation: orientation/);
  assert.match(viewer, /backgroundUrl: displayedHarmonizeBackgroundUrl/);
  assert.match(viewer, /do not add visualImageUrl/);
  assert.match(capture, /exportLocked = true/);
  assert.match(capture, /exportLocked = false/);
  assert.doesNotMatch(capture, /camera\.aspect\s*=|camera\.fov\s*=|renderer\.setSize/);
  assert.doesNotMatch(capture, /emitCommittedScene|setSelectedObjectId|applyWorldTransform/);
  assert.match(viewer, /harmonizeCaptureRef\.current = null/);
});

function productionAuthority(
  frame: Readonly<{ width: number; height: number }>,
  empty: Readonly<{ width: number; height: number }>,
  sha256: string,
) {
  const base = createPi3aAuthority({ frame, generationId: GENERATION_ID });
  return {
    ...base,
    empty: {
      ...base.empty,
      decodedWidth: empty.width,
      decodedHeight: empty.height,
      sha256,
    },
  };
}

function chairObjects() {
  return [
    harmonizeExportObject({
      objectId: "nico-b",
      assetId: "nico-chair",
      productId: "nico",
      variantId: "chair-b",
      positionM: { x: 0.4, y: 0, z: 1.2 },
      rotationDeg: { x: 0, y: 20, z: 0 },
      userSizeMultiplier: 1,
      localAabb: {
        min: { x: -0.3, y: 0, z: -0.3 },
        max: { x: 0.3, y: 0.8, z: 0.3 },
      },
    }),
    harmonizeExportObject({
      objectId: "nico-a",
      assetId: "nico-chair",
      productId: "nico",
      variantId: "chair-a",
      positionM: { x: -0.5, y: 0, z: 0.8 },
      rotationDeg: { x: 0, y: -10, z: 0 },
      userSizeMultiplier: 1,
      localAabb: {
        min: { x: -0.3, y: 0, z: -0.3 },
        max: { x: 0.3, y: 0.8, z: 0.3 },
      },
    }),
  ];
}

async function exportRealizedStage(input: Readonly<{
  frame: Readonly<{ width: number; height: number }>;
  empty: Readonly<{ width: number; height: number }>;
}>) {
  const room = new Uint8Array(input.empty.width * input.empty.height * 4);
  room[0] = 12;
  room[1] = 24;
  room[2] = 36;
  room[3] = 255;
  const furniture = new Uint8Array(room.length);
  furniture[0] = 255;
  furniture[3] = 255;
  const emptyBytes = await encodeRgbaPng(room, input.empty.width, input.empty.height);
  const sha = await sha256HexBytes(emptyBytes);
  const authority = productionAuthority(input.frame, input.empty, sha);
  const world = realizeProductionWorld(authority);
  const built = buildProductionPerspectiveCamera(world.camera);
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("certified camera did not build");
  const saved: { bytes: Uint8Array }[] = [];
  await executeHarmonizeExport({
    roomId: ROOM_ID,
    authority,
    ...viewportInput(emptyBytes),
    save: (_fileName, bytes) => {
      saved.push({ bytes });
    },
    captureFurniture: (size) => {
      const liveFrame = requireHarmonizePixelFrame(
        world.camera.frame,
        "Certified camera frame is missing from the STAGE scene. Export stopped instead of scaling.",
      );
      const authorityFrame = requireHarmonizePixelFrame(
        authority.frame,
        "Certified camera frame is missing from the room authority. Export stopped instead of scaling.",
      );
      const decision = decideHarmonizeExportFrame({
        imageWidth: size.width,
        imageHeight: size.height,
        frameWidth: liveFrame.width,
        frameHeight: liveFrame.height,
        authorityFrameWidth: authorityFrame.width,
        authorityFrameHeight: authorityFrame.height,
        imageOrientation: authority.empty.orientation,
        originalOrientation: authority.original.orientation,
      });
      if (!decision.ok) throw new HarmonizeExportError(decision.reason);
      if (!stageCameraMatchesRealized(built.camera, world.camera)) {
        throw new HarmonizeExportError(
          "STAGE camera does not match the certified projection. Export stopped.",
        );
      }
      return {
        rgba: furniture,
        width: size.width,
        height: size.height,
        contactShadowsHidden: 2,
        objects: chairObjects(),
        unmountedObjectIds: [],
        camera: harmonizeCameraRecord(world.camera),
        roomScaleMultiplier: world.roomScaleMultiplier,
        certifiedMetricScale: world.certifiedMetricScale,
        effectiveMetricScale: world.metricScale,
        generationId: world.generationId,
      };
    },
  });
  const zip = saved[0];
  assert.ok(zip);
  const files = readZip(zip.bytes);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.empty), emptyBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files.get(HARMONIZE_EXPORT_FILES.manifest))) as {
    alignment: {
      background: { source: string; width: number; height: number };
      certifiedFrame: { width: number; height: number };
      compatibilityTier: string;
      mapping: string;
    };
    camera: { aspect: number; frame: { width: number; height: number } };
  };
  assert.equal(manifest.alignment.background.source, "empty");
  assert.deepEqual(
    { width: manifest.alignment.background.width, height: manifest.alignment.background.height },
    input.empty,
  );
  assert.deepEqual(manifest.alignment.certifiedFrame, input.frame);
  assert.equal(manifest.alignment.mapping, "identity-normalized");
  assert.equal(manifest.camera.aspect, input.frame.width / input.frame.height);
  assert.deepEqual(manifest.camera.frame, input.frame);
  if (input.empty.width !== input.frame.width || input.empty.height !== input.frame.height) {
    assert.notEqual(manifest.camera.aspect, input.empty.width / input.empty.height);
  }
  return manifest;
}

test("realized STAGE camera exports equal and rescaled viewport frames", async () => {
  const equal = await exportRealizedStage({
    frame: { width: 80, height: 60 },
    empty: { width: 80, height: 60 },
  });
  assert.equal(equal.alignment.compatibilityTier, "exact_grid_compatible");

  const rescaled = await exportRealizedStage({
    frame: { width: 128, height: 96 },
    empty: { width: 75, height: 56 },
  });
  assert.equal(rescaled.alignment.compatibilityTier, "aspect_compatible_rescaled");

  const certified = createPi3aAuthority({
    frame: { width: 2048, height: 1536 },
    generationId: GENERATION_ID,
  });
  const world = realizeProductionWorld(certified);
  const camera = harmonizeCameraRecord(world.camera);
  const decision = decideHarmonizeExportFrame({
    imageWidth: 1200,
    imageHeight: 896,
    frameWidth: world.camera.frame.width,
    frameHeight: world.camera.frame.height,
    authorityFrameWidth: certified.frame.width,
    authorityFrameHeight: certified.frame.height,
    imageOrientation: certified.empty.orientation,
    originalOrientation: certified.original.orientation,
  });
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.width, 1200);
  assert.equal(decision.height, 896);
  assert.equal(certifiedCameraMatches(camera, decision), true);
  assert.deepEqual(camera.frame, { width: 2048, height: 1536 });
});

function certifiedCameraMatches(
  camera: HarmonizeFurnitureCapture["camera"],
  decision: HarmonizeFrameSuccess,
): boolean {
  return camera.frame.width === decision.certifiedFrame.width
    && camera.frame.height === decision.certifiedFrame.height
    && camera.aspect === decision.certifiedFrame.width / decision.certifiedFrame.height;
}

test("a width-only export decision does not read a missing certified frame", async () => {
  const emptyBytes = await encodeRgbaPng(Uint8Array.of(1, 2, 3, 255), 1, 1);
  const decision = decideHarmonizeExportFrame({
    imageWidth: 1,
    imageHeight: 1,
    frameWidth: 1,
    frameHeight: 1,
    authorityFrameWidth: 1,
    authorityFrameHeight: 1,
  });
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  const widthOnly = {
    ok: decision.ok,
    width: decision.width,
    height: decision.height,
    compatibilityTier: decision.compatibilityTier,
    relativeAspectError: decision.relativeAspectError,
    mapping: decision.mapping,
    exportResolutionSource: decision.exportResolutionSource,
    backgroundResampled: decision.backgroundResampled,
    cameraProjectionModified: decision.cameraProjectionModified,
  } as HarmonizeFrameSuccess;
  const capture = captureFor(Uint8Array.of(0, 0, 0, 0), 1, 1);
  await assert.rejects(
    () => buildHarmonizeZip({
      roomId: ROOM_ID,
      generatedAt: "2026-10-09T00:00:00.000Z",
      generationId: GENERATION_ID,
      background: {
        bytes: emptyBytes,
        fileName: HARMONIZE_EXPORT_FILES.backgroundPng,
        role: "viewport-background",
        source: "room-state",
        matchesEmpty: false,
        matchesOriginal: false,
      },
      roomRgba: Uint8Array.of(1, 2, 3, 255),
      capture,
      alignment: widthOnly as HarmonizeFrameSuccess,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarmonizeExportError);
      assert.equal(error instanceof TypeError, false);
      assert.match(error.message, /certified camera frame/);
      assert.doesNotMatch(error.message, /reading 'width'/);
      return true;
    },
  );
});

test("background identity distinguishes EMPTY, original, and another room image", () => {
  const emptySha = "a".repeat(64);
  const originalSha = "b".repeat(64);
  const otherSha = "c".repeat(64);
  assert.deepEqual(classifyHarmonizeBackground({
    sha256: emptySha,
    emptySha256: emptySha,
    originalSha256: originalSha,
    backgroundUrl: VIEWPORT_URL,
    originalImageUrl: ORIGINAL_URL,
  }), { source: "empty", matchesEmpty: true, matchesOriginal: false });
  assert.deepEqual(classifyHarmonizeBackground({
    sha256: originalSha,
    emptySha256: emptySha,
    originalSha256: originalSha,
    backgroundUrl: VIEWPORT_URL,
    originalImageUrl: ORIGINAL_URL,
  }), { source: "original", matchesEmpty: false, matchesOriginal: true });
  assert.deepEqual(classifyHarmonizeBackground({
    sha256: otherSha,
    emptySha256: emptySha,
    originalSha256: originalSha,
    backgroundUrl: ORIGINAL_URL,
    originalImageUrl: ORIGINAL_URL,
  }), { source: "original", matchesEmpty: false, matchesOriginal: true });
  assert.deepEqual(classifyHarmonizeBackground({
    sha256: otherSha,
    emptySha256: emptySha,
    originalSha256: originalSha,
    backgroundUrl: VIEWPORT_URL,
    originalImageUrl: ORIGINAL_URL,
  }), { source: "room-state", matchesEmpty: false, matchesOriginal: false });
  assert.equal(harmonizeBackgroundFileName({
    source: "empty",
    mediaType: "image/png",
  }), HARMONIZE_EXPORT_FILES.empty);
  assert.equal(harmonizeBackgroundFileName({
    source: "room-state",
    mediaType: "image/jpeg",
  }), HARMONIZE_EXPORT_FILES.backgroundJpeg);
  assert.equal(
    harmonizeBackgroundMediaType(Uint8Array.of(0xff, 0xd8, 0xff, 0x00)),
    "image/jpeg",
  );
  assert.equal(displayedHarmonizeBackgroundUrl({
    image: {
      currentSrc: "https://images.example.test/shown.png",
      getAttribute: () => "https://images.example.test/preferred.png",
    },
    fallbackUrl: "https://images.example.test/prop.png",
  }), "https://images.example.test/shown.png");
});

test("original viewport composites that image and keeps EMPTY as a reference", async () => {
  const original = Uint8Array.of(11, 22, 33, 255, 44, 55, 66, 255);
  const empty = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
  const furniture = Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0);
  const originalBytes = await encodeRgbaPng(original, 2, 1);
  const emptyBytes = await encodeRgbaPng(empty, 2, 1);
  const originalSha = await sha256HexBytes(originalBytes);
  const emptySha = await sha256HexBytes(emptyBytes);
  const saved: { bytes: Uint8Array }[] = [];
  await executeHarmonizeExport({
    roomId: ROOM_ID,
    authority: {
      ...authority(2, 1, emptySha),
      original: { sha256: originalSha, orientation: 1 },
    },
    ...viewportInput(originalBytes, { backgroundUrl: ORIGINAL_URL, originalImageUrl: ORIGINAL_URL }),
    fetchEmpty: async () => emptyBytes,
    save: (_fileName, bytes) => {
      saved.push({ bytes });
    },
    captureFurniture: (size) => captureFor(furniture, size.width, size.height, { width: 2, height: 1 }),
  });
  const files = readZip(saved[0].bytes);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.backgroundPng), originalBytes);
  assert.equal(files.has(HARMONIZE_EXPORT_FILES.empty), false);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.referenceEmpty), emptyBytes);
  const composite = await decodePngRgba(files.get(HARMONIZE_EXPORT_FILES.composite)!);
  assert.deepEqual(composite.rgba.subarray(0, 4), Uint8Array.of(255, 0, 0, 255));
  assert.deepEqual(composite.rgba.subarray(4, 8), original.subarray(4, 8));
  const manifest = JSON.parse(new TextDecoder().decode(files.get(HARMONIZE_EXPORT_FILES.manifest))) as {
    alignment: { background: { source: string; matchesEmpty: boolean; matchesOriginal: boolean } };
    emptyReference: string;
  };
  assert.equal(manifest.alignment.background.source, "original");
  assert.equal(manifest.alignment.background.matchesEmpty, false);
  assert.equal(manifest.alignment.background.matchesOriginal, true);
  assert.equal(manifest.emptyReference, "included");
  assert.doesNotMatch(JSON.stringify(manifest), /images\.example|token=|storage\/v1\/object/);
});

test("a missing EMPTY reference does not block the active viewport export", async () => {
  const room = Uint8Array.of(9, 8, 7, 255);
  const backgroundBytes = await encodeRgbaPng(room, 1, 1);
  const saved: { bytes: Uint8Array }[] = [];
  await executeHarmonizeExport({
    roomId: ROOM_ID,
    authority: authority(1, 1, "d".repeat(64)),
    ...viewportInput(backgroundBytes),
    fetchEmpty: async () => {
      throw new HarmonizeExportError("Authoritative EMPTY image is unavailable.");
    },
    save: (_fileName, bytes) => {
      saved.push({ bytes });
    },
    captureFurniture: (size) => captureFor(Uint8Array.of(0, 0, 0, 0), size.width, size.height),
  });
  const files = readZip(saved[0].bytes);
  assert.equal(files.has(HARMONIZE_EXPORT_FILES.referenceEmpty), false);
  assert.deepEqual(files.get(HARMONIZE_EXPORT_FILES.backgroundPng), backgroundBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files.get(HARMONIZE_EXPORT_FILES.manifest))) as {
    alignment: { background: { source: string } };
    emptyReference: string;
  };
  assert.equal(manifest.alignment.background.source, "room-state");
  assert.equal(manifest.emptyReference, "unavailable");
});

test("a jpeg viewport background fails closed when it cannot be decoded", async () => {
  await assert.rejects(
    decodeHarmonizeBackground(Uint8Array.of(0xff, 0xd8, 0xff, 0x00)),
    (error: unknown) => {
      assert.ok(error instanceof HarmonizeExportError);
      assert.match(error.message, /cannot be read/);
      assert.doesNotMatch(error.message, /images\.example|token=/);
      return true;
    },
  );
});
