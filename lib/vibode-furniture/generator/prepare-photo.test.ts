import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FurnitureGeneratorPanel } from "@/components/stage/FurnitureGeneratorPanel";
import {
  MAX_INPUT_BYTES,
  MAX_LONGEST_SIDE_PX,
  MAX_OUTPUT_BYTES,
  PRIMARY_QUALITY,
  prepareRoomImageForUpload,
  PrepareRoomImageError,
  RETRY_QUALITY,
  scaleRoomImageToLongestSide,
} from "@/lib/prepareRoomImageForUpload";
import { detectStillMagic, inspectJpeg, jpegCanPassThrough } from "@/lib/stillImageKind";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { FIRST_GENERATION_JPEG_MAX_BYTES } from "@/lib/vibode-furniture/generation/transport";
import { SUPPORTED_STILL_IMAGE_ACCEPT_ATTR } from "@/lib/uploadImageFileTypes";

import { heicPreparationBodyStatus, handleFurnitureHeicPreparation } from "./heic-preparation";
import {
  FURNITURE_HEIC_REQUEST_MAX_BYTES,
  FURNITURE_HEIC_SERVER_MAX_BYTES,
  FURNITURE_JPEG_MATTE_CSS,
  FURNITURE_PHOTO_MAX_EDGE_PX,
  FURNITURE_PHOTO_MAX_INPUT_BYTES,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  FURNITURE_PHOTO_PREPARATION_PATH,
} from "./photo-limits";
import { createPhotoPreparationGate, FURNITURE_PHOTO_MESSAGES, planFurniturePhoto } from "./photo-plan";
import {
  furnitureBrowserEncodeOptions,
  FurniturePhotoPreparationError,
  prepareFurniturePhoto,
} from "./prepare-photo";

const ROOT = process.cwd();
const LIMITS = {
  maxBytes: FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  maxEdgePx: FURNITURE_PHOTO_MAX_EDGE_PX,
  minEdgePx: 32,
};

test("New Room still normalizes JPEG, PNG, and WebP in the browser and leaves HEIC to the server", async () => {
  assert.equal(MAX_INPUT_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_OUTPUT_BYTES, 3.25 * 1024 * 1024);
  assert.equal(MAX_LONGEST_SIDE_PX, 2048);
  assert.equal(PRIMARY_QUALITY, 0.85);
  assert.equal(RETRY_QUALITY, 0.75);
  assert.deepEqual(scaleRoomImageToLongestSide(4032, 3024, 2048), { width: 2048, height: 1536 });
  assert.deepEqual(scaleRoomImageToLongestSide(3024, 4032, 2048), { width: 1536, height: 2048 });
  assert.deepEqual(scaleRoomImageToLongestSide(800, 600, 2048), { width: 800, height: 600 });

  const gif = new File([Uint8Array.of(1, 2, 3)], "room.gif", { type: "image/gif" });
  await assert.rejects(() => prepareRoomImageForUpload(gif), (error: unknown) => {
    assert.ok(error instanceof PrepareRoomImageError);
    assert.equal(error.code, "INVALID_TYPE");
    assert.equal(error.message, "Please upload a JPG, PNG, or WebP image.");
    return true;
  });

  const huge = { name: "room.jpg", type: "image/jpeg", size: MAX_INPUT_BYTES + 1 } as File;
  await assert.rejects(() => prepareRoomImageForUpload(huge), (error: unknown) => {
    assert.ok(error instanceof PrepareRoomImageError);
    assert.equal(error.code, "INPUT_TOO_LARGE");
    assert.equal(error.message, "This image is too large. Please upload a photo under 25MB.");
    return true;
  });

  const jpeg = new File([await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#888888" },
  }).jpeg().toBuffer()], "room.jpg", { type: "image/jpeg" });
  await assert.rejects(() => prepareRoomImageForUpload(jpeg), (error: unknown) => {
    assert.ok(error instanceof PrepareRoomImageError);
    assert.equal(error.code, "PROCESSING_FAILED");
    assert.equal(error.message, "We couldn’t process this image. Try a smaller or lower-resolution photo.");
    return true;
  });

  const editor = readFileSync(path.join(ROOT, "app/editor/page.tsx"), "utf8");
  const upload = readFileSync(path.join(ROOT, "app/api/vibode/upload-base/route.ts"), "utf8");
  assert.match(editor, /prepareRoomImageForUpload/);
  assert.match(editor, /isHeicLikeFile/);
  assert.match(editor, /SUPPORTED_STILL_IMAGE_ACCEPT_ATTR/);
  assert.doesNotMatch(editor, /prepareFurniturePhoto|furniture-photo-preparation/);
  assert.match(upload, /convertHeicBufferToJpeg\(/);
  assert.doesNotMatch(upload, /convertHeicBufferToBoundedJpeg/);
});

test("file headers identify JPEG, PNG, WebP, HEIC, and misleading names", async () => {
  const jpeg = await sharp({
    create: { width: 40, height: 64, channels: 3, background: "#224488" },
  }).jpeg().toBuffer();
  const oriented = await sharp({
    create: { width: 40, height: 90, channels: 3, background: "#224488" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const wide = await sharp({
    create: { width: 2400, height: 800, channels: 3, background: "#224488" },
  }).jpeg().toBuffer();
  const png = await sharp({
    create: { width: 40, height: 40, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  }).png().toBuffer();
  const webp = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#abcdef" },
  }).webp().toBuffer();

  assert.equal(detectStillMagic(jpeg), "jpeg");
  assert.equal(detectStillMagic(png), "png");
  assert.equal(detectStillMagic(webp), "webp");
  const plain = inspectJpeg(jpeg);
  assert.ok(plain);
  assert.equal(plain.orientation, 1);
  assert.equal(plain.components, 3);
  assert.equal(plain.displayedWidthPx, 40);
  assert.equal(plain.displayedHeightPx, 64);
  assert.equal(jpegCanPassThrough(plain, jpeg.byteLength, LIMITS), true);

  const turned = inspectJpeg(oriented);
  assert.ok(turned);
  assert.equal(turned.orientation, 6);
  assert.equal(turned.widthPx, 40);
  assert.equal(turned.heightPx, 90);
  assert.equal(turned.displayedWidthPx, 90);
  assert.equal(turned.displayedHeightPx, 40);
  assert.equal(jpegCanPassThrough(turned, oriented.byteLength, LIMITS), false);

  const landscape = inspectJpeg(wide);
  assert.ok(landscape);
  assert.equal(jpegCanPassThrough(landscape, wide.byteLength, LIMITS), false);
  assert.equal(inspectJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)), null);

  const heic = readFileSync(path.join(ROOT, "lib/vibode-furniture/generator/fixtures/apple-sips-48x64.heic"));
  assert.equal(detectStillMagic(heic), "heic");
  assert.equal(detectStillMagic(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "gif");
  const avif = new Uint8Array(24);
  avif.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
  assert.equal(detectStillMagic(avif), "avif");
  const mov = new Uint8Array(24);
  mov.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
  assert.equal(detectStillMagic(mov), "mov");

  assert.equal(planFurniturePhoto({
    fileName: "chair.png",
    mimeType: "image/jpeg",
    byteLength: png.byteLength,
    magic: "png",
    jpeg: null,
  }).action, "browser");
  assert.equal(planFurniturePhoto({
    fileName: "clip.mov",
    mimeType: "video/quicktime",
    byteLength: 32,
    magic: "mov",
    jpeg: null,
  }).action, "reject");
  assert.equal(planFurniturePhoto({
    fileName: "room.avif",
    mimeType: "image/avif",
    byteLength: 32,
    magic: "avif",
    jpeg: null,
  }).action, "reject");
});

test("a compliant JPEG is kept and every other supported photo is prepared without a generation request", async () => {
  assert.equal(FURNITURE_PHOTO_MAX_OUTPUT_BYTES, FIRST_GENERATION_JPEG_MAX_BYTES);
  assert.equal(FURNITURE_PHOTO_MAX_OUTPUT_BYTES, 3 * 1024 * 1024);
  assert.equal(FURNITURE_PHOTO_MAX_INPUT_BYTES, 25 * 1024 * 1024);
  assert.equal(furnitureBrowserEncodeOptions.jpegBackground, FURNITURE_JPEG_MATTE_CSS);
  assert.equal(furnitureBrowserEncodeOptions.outputMimeType, "image/jpeg");
  assert.equal(furnitureBrowserEncodeOptions.shrinkUntilFit, true);
  assert.equal(furnitureBrowserEncodeOptions.maxOutputBytes, FIRST_GENERATION_JPEG_MAX_BYTES);

  const jpeg = await sharp({
    create: { width: 48, height: 64, channels: 3, background: "#336699" },
  }).jpeg().toBuffer();
  const passthrough = new File([jpeg], "Chair.JPG", { type: "image/jpeg" });
  let encodes = 0;
  let fetches = 0;
  const prepared = await prepareFurniturePhoto(passthrough, {
    encodeFile: async () => {
      encodes += 1;
      throw new Error("encode");
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  });
  assert.equal(prepared, passthrough);
  assert.equal(encodes, 0);
  assert.equal(fetches, 0);
  assert.deepEqual(new Uint8Array(await prepared.arrayBuffer()), new Uint8Array(jpeg));

  const oriented = await sharp({
    create: { width: 48, height: 96, channels: 3, background: "#336699" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const normalized = jpegFile(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 0xff, 0xd9));
  const rotated = await prepareFurniturePhoto(new File([oriented], "turned.jpg", { type: "image/jpeg" }), {
    encodeFile: async () => {
      encodes += 1;
      return normalized;
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  });
  assert.equal(encodes, 1);
  assert.equal(fetches, 0);
  assert.equal(rotated.type, "image/jpeg");

  const png = await sharp({
    create: { width: 36, height: 36, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  await prepareFurniturePhoto(new File([png], "chair.jpg", { type: "image/jpeg" }), {
    encodeFile: async (file) => {
      encodes += 1;
      assert.equal(detectStillMagic(new Uint8Array(await file.arrayBuffer())), "png");
      return normalized;
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  });
  assert.equal(encodes, 2);
  assert.equal(fetches, 0);

  const heic = readFileSync(path.join(ROOT, "lib/vibode-furniture/generator/fixtures/apple-sips-48x64.heic"));
  const serverJpeg = await sharp({
    create: { width: 48, height: 64, channels: 3, background: "#112233" },
  }).jpeg().toBuffer();
  let requestUrl = "";
  let authorization = "";
  const converted = await prepareFurniturePhoto(new File([heic], "IMG_0001.HEIC", { type: "" }), {
    encodeFile: async () => {
      throw new FurniturePhotoPreparationError("browser-cannot-decode");
    },
    readToken: async () => "owner-token",
    fetchImpl: async (input, init) => {
      fetches += 1;
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof FormData);
      return new Response(serverJpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
    },
  });
  assert.equal(fetches, 1);
  assert.equal(requestUrl, FURNITURE_PHOTO_PREPARATION_PATH);
  assert.equal(requestUrl.includes("furniture-generations"), false);
  assert.equal(authorization, "Bearer owner-token");
  assert.equal(converted.type, "image/jpeg");
  assert.equal(converted.name, "IMG_0001.jpg");

  fetches = 0;
  await assert.rejects(() => prepareFurniturePhoto(new File([heic], "IMG_0002.heic", { type: "image/heic" }), {
    encodeFile: async () => {
      throw new Error("decode");
    },
    readToken: async () => null,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  }), (error: unknown) => {
    assert.ok(error instanceof FurniturePhotoPreparationError);
    assert.equal(error.message, FURNITURE_PHOTO_MESSAGES.signIn);
    return true;
  });
  assert.equal(fetches, 0);

  const oversized = new Uint8Array(FURNITURE_HEIC_SERVER_MAX_BYTES + 1);
  oversized.set(heic.subarray(0, 32));
  await assert.rejects(() => prepareFurniturePhoto(new File([oversized], "large.heic", { type: "image/heic" }), {
    encodeFile: async () => {
      throw new Error("decode");
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  }), (error: unknown) => {
    assert.ok(error instanceof FurniturePhotoPreparationError);
    assert.equal(error.message, FURNITURE_PHOTO_MESSAGES.heicTooLarge);
    return true;
  });
  assert.equal(fetches, 0);

  await assert.rejects(() => prepareFurniturePhoto(new File([Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)], "animated.gif", { type: "image/gif" })), (error: unknown) => {
    assert.ok(error instanceof FurniturePhotoPreparationError);
    assert.equal(error.message, FURNITURE_PHOTO_MESSAGES.unsupported);
    return true;
  });
  await assert.rejects(() => prepareFurniturePhoto(new File([Uint8Array.of(1)], "clip.mov", { type: "video/quicktime" })), (error: unknown) => {
    assert.ok(error instanceof FurniturePhotoPreparationError);
    assert.equal(error.message, FURNITURE_PHOTO_MESSAGES.livePhoto);
    return true;
  });
  const tooBig = { name: "huge.jpg", type: "image/jpeg", size: FURNITURE_PHOTO_MAX_INPUT_BYTES + 1, slice() { throw new Error("read"); } } as unknown as File;
  await assert.rejects(() => prepareFurniturePhoto(tooBig), (error: unknown) => {
    assert.ok(error instanceof FurniturePhotoPreparationError);
    assert.equal(error.message, FURNITURE_PHOTO_MESSAGES.tooLarge);
    return true;
  });

  let corruptFetches = 0;
  await assert.rejects(() => prepareFurniturePhoto(new File([Uint8Array.of(0xff, 0xd8, 0xff, 0x00)], "broken.jpg", { type: "image/jpeg" }), {
    encodeFile: async () => {
      throw new Error("The file could not be decoded.");
    },
    fetchImpl: async () => {
      corruptFetches += 1;
      throw new Error("fetch");
    },
  }), (error: unknown) => {
    assert.ok(error instanceof FurniturePhotoPreparationError);
    assert.equal(error.message, FURNITURE_PHOTO_MESSAGES.prepareFailed);
    return true;
  });
  assert.equal(corruptFetches, 0);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => prepareFurniturePhoto(passthrough, { signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    return true;
  });
});

test("an older photo preparation cannot replace a newer selection", async () => {
  const gate = createPhotoPreparationGate();
  const first = gate.begin();
  let releaseFirst: () => void = () => undefined;
  const firstDone = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const second = gate.begin();
  const applied: number[] = [];
  const finish = async (token: number, done: Promise<void>) => {
    await done;
    if (gate.isCurrent(token)) applied.push(token);
  };
  const firstTask = finish(first, firstDone);
  const secondTask = finish(second, Promise.resolve());
  releaseFirst();
  await Promise.all([firstTask, secondTask]);
  assert.deepEqual(applied, [second]);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test("HEIC preparation rejects misleading files before conversion and returns only a bounded JPEG", async () => {
  assert.equal(heicPreparationBodyStatus(null), "ok");
  assert.equal(heicPreparationBodyStatus(String(FURNITURE_HEIC_REQUEST_MAX_BYTES)), "ok");
  assert.equal(heicPreparationBodyStatus(String(FURNITURE_HEIC_REQUEST_MAX_BYTES + 1)), "too_large");
  assert.equal(heicPreparationBodyStatus("nope"), "unreadable");

  let conversions = 0;
  const authorize = async () => ({ ok: true as const });
  const convert = async (bytes: Uint8Array) => {
    conversions += 1;
    assert.equal(detectStillMagic(bytes), "heic");
    return { bytes: await sharp({ create: { width: 48, height: 48, channels: 3, background: "#111111" } }).jpeg().toBuffer() };
  };

  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
  }).png().toBuffer();
  const mislabeled = await handleFurnitureHeicPreparation(formRequest(new File([png], "photo.heic", { type: "image/heic" })), {
    authorize,
    convert,
  });
  assert.equal(mislabeled.status, 400);
  assert.equal(conversions, 0);

  const mov = await handleFurnitureHeicPreparation(formRequest(new File([Uint8Array.of(1, 2, 3)], "live.mov", { type: "video/quicktime" })), {
    authorize,
    convert,
  });
  assert.equal(mov.status, 400);
  if ("error" in mov) assert.equal(mov.error, FURNITURE_PHOTO_MESSAGES.livePhoto);
  assert.equal(conversions, 0);

  let authorized = 0;
  const tooLarge = await handleFurnitureHeicPreparation(new Request("https://vibode.test/prepare", {
    method: "POST",
    headers: { "content-length": String(FURNITURE_HEIC_REQUEST_MAX_BYTES + 1) },
    body: new Uint8Array([1]),
  }), {
    authorize: async () => {
      authorized += 1;
      return { ok: true as const };
    },
    convert,
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(authorized, 0);
  assert.equal(conversions, 0);

  const anonymous = await handleFurnitureHeicPreparation(formRequest(new File([png], "photo.heic", { type: "image/heic" })), {
    authorize: async () => ({ ok: false as const, status: 401, error: "Unauthorized." }),
    convert,
  });
  assert.equal(anonymous.status, 401);
  assert.equal(conversions, 0);

  const heic = readFileSync(path.join(ROOT, "lib/vibode-furniture/generator/fixtures/apple-sips-oriented.heic"));
  const prepared = await handleFurnitureHeicPreparation(formRequest(new File([heic], "oriented.heic", { type: "image/heic" })), {
    authorize,
    convert,
  });
  assert.equal(prepared.status, 200);
  assert.equal(conversions, 1);
  if ("bytes" in prepared) {
    assert.equal(prepared.contentType, "image/jpeg");
    assert.equal(detectStillMagic(prepared.bytes), "jpeg");
    assert.ok(prepared.bytes.byteLength <= FURNITURE_PHOTO_MAX_OUTPUT_BYTES);
  }

  const rejected = await handleFurnitureHeicPreparation(formRequest(new File([heic], "bad.heic", { type: "image/heic" })), {
    authorize,
    convert: async () => ({ bytes: png }),
  });
  assert.equal(rejected.status, 422);
  if ("error" in rejected) {
    assert.equal(rejected.error, FURNITURE_PHOTO_MESSAGES.heicFailed);
    assert.equal(/meshy|credit|https?:/i.test(rejected.error), false);
  }
});

test("the generator accepts the New Room formats and keeps preparation off the generation route", () => {
  const html = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    initialState: {
      photos: {
        front: {
          slot: "front",
          fileName: "chair.jpg",
          mimeType: "image/jpeg",
          byteLength: 128,
          widthPx: 64,
          heightPx: 64,
        },
        left: null,
        right: null,
        back: null,
      },
      previewUrls: { front: "blob:prepared-photo" },
      settings: defaultFurnitureGeneratorSettings(),
      notices: [],
      slotErrors: {},
    },
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 1,
        reserved: 0,
        consumed: 0,
        remaining: 1,
        reason: null,
      },
    },
  }));
  assert.match(html, /image\/heic/);
  assert.match(html, /\.png/);
  assert.match(html, /\.webp/);
  assert.match(html, /prepared automatically/);
  assert.match(html, /one front photo/);
  assert.match(html, /data-generate="ready"/);
  assert.match(html, /object-contain/);
  assert.equal(html.includes(SUPPORTED_STILL_IMAGE_ACCEPT_ATTR), true);
  assert.doesNotMatch(html, /credit|queue|estimated/i);

  const preparing = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 1,
        reserved: 0,
        consumed: 0,
        remaining: 1,
        reason: null,
      },
      preparingFront: true,
    },
  }));
  assert.match(preparing, /data-front-preparing="true"/);
  assert.match(preparing, /data-photo-status="preparing"/);
  assert.match(preparing, /Preparing this photo/);
  assert.match(preparing, /data-generate="unavailable"/);

  const panel = readFileSync(path.join(ROOT, "components/stage/FurnitureGeneratorPanel.tsx"), "utf8");
  const route = readFileSync(path.join(ROOT, "app/api/vibode/furniture-photo-preparation/route.ts"), "utf8");
  const client = readFileSync(path.join(ROOT, "lib/vibode-furniture/generator/prepare-photo.ts"), "utf8");
  const pipeline = readFileSync(path.join(ROOT, "lib/vibode-furniture/generation/pipeline.ts"), "utf8");
  assert.match(panel, /prepareFurniturePhoto/);
  assert.match(panel, /isCurrent\(token\)/);
  assert.match(panel, /SUPPORTED_STILL_IMAGE_ACCEPT_ATTR/);
  assert.match(panel, /onDrop/);
  assert.doesNotMatch(panel, /fetch\(/);
  assert.doesNotMatch(panel, /heic-convert|heicServerConversion|from "sharp"|credit/);
  assert.match(client, /FURNITURE_PHOTO_PREPARATION_PATH/);
  assert.doesNotMatch(client, /furniture-generations|submitBetaGeneration|createOwnedGeneration/);
  assert.match(route, /convertHeicBufferToBoundedJpeg/);
  assert.doesNotMatch(route, /createOwnedGeneration|reserve\(|stripe|chargeVibode|MESHY_API/);
  assert.match(pipeline, /The beta uses one front JPEG/);
  assert.match(pipeline, /betaFrontPhotoBytesAllowed/);
});

function jpegFile(bytes: Uint8Array): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], "prepared.jpg", { type: "image/jpeg" });
}

function formRequest(file: File): Request {
  const body = new FormData();
  body.set("file", file);
  return new Request("https://vibode.test/api/vibode/furniture-photo-preparation", {
    method: "POST",
    body,
  });
}
