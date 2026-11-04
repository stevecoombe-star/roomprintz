import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  buildHarmonizeForeground,
  composeHarmonizeScene,
  embedHarmonizeForeground,
  harmonizeForegroundFailureMessage,
  readHarmonizeForegroundRequest,
  scaleBringForwardRgba,
  splitHarmonizeForeground,
  type HarmonizeForegroundSnapshot,
} from "@/lib/vibode-stage/harmonize-bring-forward";
import { compositeHarmonizeForegroundOntoJpeg } from "@/lib/vibode-stage/harmonize-bring-forward-output";
import type { BringForwardScan } from "@/lib/vibode-stage/bring-forward-cutout";
import {
  decodePngRgba,
  encodeRgbaPng,
  furnitureMatteRgba,
} from "@/lib/vibode-stage/harmonize-export";
import {
  packRemoveMask,
  prepareRemoveObjectMasks,
  type RemoveObjectRecord,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const SHA = "ab".repeat(32);

function mustPack(width: number, height: number, fill: (x: number, y: number) => boolean): RemovePackedMask {
  const coverage = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) coverage[y * width + x] = fill(x, y) ? 255 : 0;
  }
  const packed = packRemoveMask(coverage, width, height);
  assert.ok(packed);
  return packed;
}

function record(id: string, mask: RemovePackedMask): RemoveObjectRecord {
  const prepared = prepareRemoveObjectMasks({
    candidates: [{ id, confidence: 0.91, concept: "sofa", mask }],
    thresholds: { minAreaPx: 1 },
  }).eligible[0];
  assert.ok(prepared);
  return prepared;
}

function rgba(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = paint(x, y);
      const offset = (y * width + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}

function pixel(pixels: Uint8Array | Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0, pixels[offset + 3] ?? 0];
}

function scan(objects: readonly RemoveObjectRecord[], width = 4, height = 4): BringForwardScan {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    original: { sha256: SHA, width, height },
    objects,
    diagnostics: null,
    conceptSet: "remove-segmentation-concepts/v2",
    vocabularyRevision: 0,
  };
}

function snapshot(input: HarmonizeForegroundSnapshot): HarmonizeForegroundSnapshot {
  return input;
}

test("no foreground selection leaves the legacy furniture composite", () => {
  const room = rgba(4, 4, () => [10, 20, 30, 255]);
  const furniture = rgba(4, 4, (x, y) => (x === 1 && y === 1 ? [240, 120, 20, 255] : [0, 0, 0, 0]));
  const legacy = composeHarmonizeScene(new Uint8Array(room), new Uint8Array(furniture), null);
  assert.deepEqual(pixel(legacy, 4, 1, 1), [240, 120, 20, 255]);
  assert.deepEqual(pixel(legacy, 4, 0, 0), [10, 20, 30, 255]);
  const decision = readHarmonizeForegroundRequest({
    session: {
      editing: false,
      committedIds: new Set(),
      verified: null,
      scan: null,
      display: "idle",
    },
    roomId: ROOM,
    generationId: GENERATION,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.snapshot, null);
  assert.equal(readHarmonizeForegroundRequest({
    session: null,
    roomId: ROOM,
    generationId: GENERATION,
  }).ok, true);
});

test("one or more photographed objects stay above the furniture and off the matte", () => {
  const sofa = record("sofa", mustPack(4, 4, (x, y) => x === 1 && y === 1));
  const table = record("table", mustPack(4, 4, (x, y) => x === 2 && y === 2));
  const original = rgba(4, 4, (x, y) => {
    if (x === 1 && y === 1) return [90, 40, 20, 255];
    if (x === 2 && y === 2) return [20, 80, 40, 255];
    return [1, 1, 1, 255];
  });
  const removedRoom = new Uint8Array(4 * 4 * 4);
  for (let index = 0; index < removedRoom.length; index += 4) {
    removedRoom[index + 3] = 255;
  }
  const furniture = new Uint8Array(4 * 4 * 4);
  furniture[1 * 4 * 4 + 1 * 4] = 240;
  furniture[1 * 4 * 4 + 1 * 4 + 1] = 120;
  furniture[1 * 4 * 4 + 1 * 4 + 2] = 20;
  furniture[1 * 4 * 4 + 1 * 4 + 3] = 255;
  const both = buildHarmonizeForeground({
    snapshot: snapshot({
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: SHA,
      originalWidth: 4,
      originalHeight: 4,
      rgba: original,
      width: 4,
      height: 4,
      objects: [sofa, table],
      selectedIds: ["sofa", "table"],
    }),
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    targetWidth: 4,
    targetHeight: 4,
  });
  assert.equal(both.ok, true);
  if (!both.ok || !both.rgba) return;
  const scene = composeHarmonizeScene(removedRoom, furniture, both.rgba);
  assert.deepEqual(pixel(scene, 4, 1, 1), [90, 40, 20, 255]);
  assert.deepEqual(pixel(scene, 4, 2, 2), [20, 80, 40, 255]);
  assert.deepEqual(pixel(furniture, 4, 1, 1), [240, 120, 20, 255]);
  const matte = furnitureMatteRgba(furniture);
  assert.deepEqual(pixel(matte, 4, 1, 1), [255, 255, 255, 255]);
  assert.deepEqual(pixel(matte, 4, 2, 2), [0, 0, 0, 255]);
  const one = buildHarmonizeForeground({
    snapshot: snapshot({
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: SHA,
      originalWidth: 4,
      originalHeight: 4,
      rgba: original,
      width: 4,
      height: 4,
      objects: [sofa, table],
      selectedIds: ["sofa"],
    }),
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA.toUpperCase(),
    targetWidth: 4,
    targetHeight: 4,
  });
  assert.equal(one.ok, true);
  if (!one.ok || !one.rgba) return;
  assert.deepEqual(pixel(one.rgba, 4, 1, 1), [90, 40, 20, 255]);
  assert.equal(pixel(one.rgba, 4, 2, 2)[3], 0);
});

test("foreground capture rejects the wrong room, mask, or frame and freezes the selection", () => {
  const sofa = record("sofa", mustPack(4, 4, (x, y) => x === 0 && y === 0));
  const pixels = rgba(4, 4, () => [90, 40, 20, 255]);
  const committed = new Set(["sofa"]);
  const verified = { rgba: pixels, width: 4, height: 4 };
  const objects = [sofa];
  const decision = readHarmonizeForegroundRequest({
    session: {
      editing: false,
      committedIds: committed,
      verified,
      scan: scan(objects),
      display: "show",
    },
    roomId: ROOM,
    generationId: GENERATION,
  });
  assert.equal(decision.ok, true);
  if (!decision.ok || !decision.snapshot) return;
  committed.delete("sofa");
  committed.add("later");
  pixels[0] = 1;
  objects.pop();
  assert.deepEqual(decision.snapshot.selectedIds, ["sofa"]);
  assert.equal(decision.snapshot.rgba[0], 90);
  assert.equal(decision.snapshot.objects.length, 1);
  const built = buildHarmonizeForeground({
    snapshot: decision.snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    targetWidth: 4,
    targetHeight: 4,
  });
  assert.equal(built.ok, true);
  if (built.ok && built.rgba) assert.equal(pixel(built.rgba, 4, 0, 0)[0], 90);
  const editing = readHarmonizeForegroundRequest({
    session: {
      editing: true,
      committedIds: new Set(["sofa"]),
      verified,
      scan: scan([sofa]),
      display: "show",
    },
    roomId: ROOM,
    generationId: GENERATION,
  });
  assert.equal(editing.ok, false);
  if (!editing.ok) {
    assert.equal(editing.reason, "editing");
    assert.equal(harmonizeForegroundFailureMessage(editing.reason), "Finish Bring Forward before Harmonize.");
  }
  const otherRoom = readHarmonizeForegroundRequest({
    session: {
      editing: false,
      committedIds: new Set(["sofa"]),
      verified,
      scan: scan([sofa]),
      display: "show",
    },
    roomId: "other-room",
    generationId: GENERATION,
  });
  assert.equal(otherRoom.ok, false);
  if (!otherRoom.ok) assert.equal(otherRoom.reason, "identity");
  const wrongSha = buildHarmonizeForeground({
    snapshot: decision.snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: "cd".repeat(32),
    targetWidth: 4,
    targetHeight: 4,
  });
  assert.equal(wrongSha.ok, false);
  if (!wrongSha.ok) assert.equal(wrongSha.reason, "identity");
  const badMask = buildHarmonizeForeground({
    snapshot: {
      ...decision.snapshot,
      originalWidth: 5,
      width: 5,
      rgba: rgba(5, 4, () => [1, 1, 1, 255]),
    },
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    targetWidth: 5,
    targetHeight: 4,
  });
  assert.equal(badMask.ok, false);
  if (!badMask.ok) assert.equal(badMask.reason, "mask");
  const badFrame = buildHarmonizeForeground({
    snapshot: decision.snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    targetWidth: 5,
    targetHeight: 4,
  });
  assert.equal(badFrame.ok, false);
  if (!badFrame.ok) assert.equal(badFrame.reason, "alignment");
  assert.equal(scaleBringForwardRgba(decision.snapshot.rgba, 4, 4, 400, 401)?.length, 400 * 401 * 4);
});

test("the provider scene keeps the cutout and the result stamps it back on", async () => {
  const width = 4;
  const height = 4;
  const room = new Uint8Array(width * height * 4);
  const furniture = new Uint8Array(width * height * 4);
  for (let index = 0; index < room.length; index += 4) {
    room[index + 2] = 255;
    room[index + 3] = 255;
  }
  const foreground = rgba(width, height, (x) => (x < 2 ? [0, 255, 0, 255] : [0, 0, 0, 0]));
  const scene = composeHarmonizeScene(room, furniture, new Uint8Array(foreground));
  const scenePng = await encodeRgbaPng(scene, width, height);
  const foregroundPng = await encodeRgbaPng(new Uint8Array(foreground), width, height);
  const packed = embedHarmonizeForeground(scenePng, foregroundPng);
  const split = splitHarmonizeForeground(packed);
  assert.equal(split.ok, true);
  if (!split.ok || !split.foreground) return;
  const stripped = splitHarmonizeForeground(split.scene);
  assert.equal(stripped.ok, true);
  if (stripped.ok) assert.equal(stripped.foreground, null);
  const shown = await decodePngRgba(split.scene);
  assert.deepEqual(pixel(shown.rgba, width, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(shown.rgba, width, 3, 0), [0, 0, 255, 255]);
  const providerJpeg = await sharp({
    create: { width, height, channels: 3, background: { r: 240, g: 120, b: 20 } },
  }).jpeg({ quality: 95 }).toBuffer();
  const finished = await compositeHarmonizeForegroundOntoJpeg({
    jpeg: new Uint8Array(providerJpeg),
    foregroundPng: split.foreground,
    inputWidth: width,
    inputHeight: height,
  });
  assert.equal(finished.ok, true);
  if (!finished.ok) return;
  const output = await sharp(finished.jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const left = pixel(output.data, width, 0, 0);
  const right = pixel(output.data, width, 3, 0);
  assert.ok(left[1] > 200 && left[0] < 40);
  assert.ok(right[0] > 200 && right[1] > 80);
  const mismatched = await compositeHarmonizeForegroundOntoJpeg({
    jpeg: new Uint8Array(await sharp({
      create: { width: 30, height: 10, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()),
    foregroundPng: split.foreground,
    inputWidth: width,
    inputHeight: height,
  });
  assert.equal(mismatched.ok, false);
});
