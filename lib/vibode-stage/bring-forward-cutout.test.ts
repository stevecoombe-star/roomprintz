import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assessBringForwardDisplay,
  bringForwardImageIdentity,
  compositeBringForwardRgba,
  emptyBringForwardSession,
  initialBringForwardSelection,
  retainBringForwardSession,
  type BringForwardImageIdentity,
  type BringForwardObservation,
  type BringForwardSnapshot,
} from "./bring-forward-cutout";
import {
  packRemoveMask,
  prepareRemoveObjectMasks,
  type RemoveObjectRecord,
  type RemovePackedMask,
} from "./remove-objects";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const SHA = "ab".repeat(32);

function mustPack(
  width: number,
  height: number,
  fill: (x: number, y: number) => boolean,
): RemovePackedMask {
  const coverage = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (fill(x, y)) coverage[y * width + x] = 255;
    }
  }
  const packed = packRemoveMask(coverage, width, height);
  assert.ok(packed);
  return packed;
}

function record(
  id: string,
  mask: RemovePackedMask,
  eligible = true,
): RemoveObjectRecord {
  const prepared = prepareRemoveObjectMasks({
    candidates: [{ id, confidence: 0.91, concept: "chair", mask }],
    thresholds: { minAreaPx: 1 },
  }).eligible[0];
  assert.ok(prepared);
  if (eligible) return prepared;
  return {
    ...prepared,
    eligibility: {
      ...prepared.eligibility,
      eligible: false,
      reasons: ["confidence"],
    },
  };
}

function rgba(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = paint(x, y);
      const offset = (y * width + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [
    pixels[offset] ?? 0,
    pixels[offset + 1] ?? 0,
    pixels[offset + 2] ?? 0,
    pixels[offset + 3] ?? 0,
  ];
}

function image(sha256 = SHA, width = 4, height = 4): BringForwardImageIdentity {
  const identity = bringForwardImageIdentity({ sha256, width, height });
  assert.ok(identity);
  return identity;
}

function observation(
  objects: readonly RemoveObjectRecord[],
  phase: BringForwardObservation["phase"] = "ready",
): BringForwardObservation {
  return {
    phase,
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: 4,
    originalHeight: 4,
    objects,
  };
}

test("mask coverage becomes alpha and leaves original color in place", () => {
  const width = 4;
  const height = 4;
  const chair = record("chair", mustPack(width, height, (x, y) => x === 1 && y === 1));
  const lamp = record("lamp", mustPack(width, height, (x, y) => x === 3 && y === 2));
  const source = rgba(width, height, (x, y) => (x === 1 && y === 1 ? [10, 20, 30] : [4, 5, 6]));
  const before = source.slice();
  const single = compositeBringForwardRgba({
    rgba: source,
    width,
    height,
    objects: [chair, lamp],
    selectedIds: new Set(["chair"]),
  });
  assert.ok(single);
  assert.deepEqual(pixel(single, width, 1, 1), [10, 20, 30, 255]);
  assert.deepEqual(pixel(single, width, 3, 2), [4, 5, 6, 0]);
  assert.deepEqual(source, before);

  const both = compositeBringForwardRgba({
    rgba: source,
    width,
    height,
    objects: [chair, lamp],
    selectedIds: new Set(["chair", "lamp"]),
  });
  assert.ok(both);
  assert.deepEqual(pixel(both, width, 1, 1), [10, 20, 30, 255]);
  assert.deepEqual(pixel(both, width, 3, 2), [4, 5, 6, 255]);
  assert.equal(compositeBringForwardRgba({
    rgba: source,
    width,
    height,
    objects: [chair],
    selectedIds: new Set(),
  }), null);
  assert.equal(compositeBringForwardRgba({
    rgba: source,
    width,
    height,
    objects: [chair],
    selectedIds: new Set(["missing"]),
  }), null);
  assert.equal(compositeBringForwardRgba({
    rgba: source,
    width,
    height: 3,
    objects: [chair],
    selectedIds: new Set(["chair"]),
  }), null);
});

test("an ineligible mask is not composited", () => {
  const hidden = record("chair", mustPack(4, 4, (x, y) => x === 0 && y === 0), false);
  assert.equal(compositeBringForwardRgba({
    rgba: rgba(4, 4, () => [1, 2, 3]),
    width: 4,
    height: 4,
    objects: [hidden],
    selectedIds: new Set(["chair"]),
  }), null);
});

test("display is shown only for the verified original outside remove", () => {
  const snapshot: BringForwardSnapshot = {
    roomId: ROOM,
    generationId: GENERATION,
    original: image(),
    objects: [],
  };
  const displayed = image(SHA.toUpperCase());
  const source = image();
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    displayed,
    source,
    removeActive: false,
  }), "show");
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    displayed,
    source,
    removeActive: true,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    displayed: image("cd".repeat(32)),
    source,
    removeActive: false,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    displayed: image(SHA, 5, 4),
    source,
    removeActive: false,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: "other-room",
    generationId: GENERATION,
    displayed,
    source,
    removeActive: false,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: ROOM,
    generationId: "other-generation",
    displayed,
    source,
    removeActive: false,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    displayed: null,
    source,
    removeActive: false,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    snapshot: null,
    roomId: ROOM,
    generationId: GENERATION,
    displayed,
    source,
    removeActive: false,
  }), "hide");
});

test("a scan is retained after remove exits and selects only the first eligible object", () => {
  const first = record("first", mustPack(4, 4, (x, y) => x < 2 && y < 2));
  const second = record("second", mustPack(4, 4, (x, y) => x > 1 && y > 1));
  const rejected = record("rejected", mustPack(4, 4, () => true), false);
  const ready = retainBringForwardSession(emptyBringForwardSession(), {
    roomId: ROOM,
    generationId: GENERATION,
    observed: observation([rejected, first, second]),
  });
  assert.deepEqual([...ready.selectedIds], ["first"]);
  assert.equal(ready.snapshot?.objects.length, 3);
  const exited = retainBringForwardSession(ready, {
    roomId: ROOM,
    generationId: GENERATION,
    observed: null,
  });
  assert.equal(exited, ready);
  const loading = retainBringForwardSession(ready, {
    roomId: ROOM,
    generationId: GENERATION,
    observed: observation([first], "loading"),
  });
  assert.equal(loading, ready);
  const owned = retainBringForwardSession({
    ...ready,
    selectedIds: new Set(["second"]),
  }, {
    roomId: ROOM,
    generationId: GENERATION,
    observed: observation([rejected, first, second]),
  });
  assert.deepEqual([...owned.selectedIds], ["second"]);
  const objects = [first];
  const copied = retainBringForwardSession(emptyBringForwardSession(), {
    roomId: ROOM,
    generationId: GENERATION,
    observed: observation(objects),
  });
  objects.pop();
  assert.equal(copied.snapshot?.objects.length, 1);
  assert.equal(retainBringForwardSession(copied, {
    roomId: "other-room",
    generationId: GENERATION,
    observed: null,
  }).snapshot, null);
  assert.equal(initialBringForwardSelection([
    record("wrong-size", mustPack(2, 2, () => true)),
  ], 4, 4).size, 0);
});

test("the foreground canvas is mounted above the furniture frame without a second camera", () => {
  const viewer = readFileSync(new URL("../../components/afc-3d/AfcProductionRoomViewer.tsx", import.meta.url), "utf8");
  const layer = readFileSync(new URL("../../components/stage/BringForwardLayer.tsx", import.meta.url), "utf8");
  const cutout = readFileSync(new URL("./bring-forward-cutout.ts", import.meta.url), "utf8");
  const mount = viewer.indexOf("ref={mountRef}");
  const foreground = viewer.indexOf("<BringForwardLayer", mount);
  const loading = viewer.indexOf('furniturePhase === "loading"', foreground);
  assert.ok(mount >= 0 && foreground > mount && loading > foreground);
  assert.match(viewer, /backgroundUrl=\{visualImageUrl\}/);
  assert.equal(viewer.match(/new THREE\.WebGLRenderer/g)?.length, 1);
  assert.match(layer, /pointer-events-none absolute inset-0 z-\[15\]/);
  assert.match(layer, /data-bring-forward-canvas="true"/);
  assert.match(layer, /width: "100%", height: "100%"/);
  assert.match(layer, /canvas\.width = width/);
  assert.doesNotMatch(layer, /objectUi\.selectedIds|devicePixelRatio|containFitRect|WebGLRenderer|remove-objects/);
  assert.match(cutout, /unpackRemoveMask/);
  assert.doesNotMatch(cutout, /resampleCoverageToOriginal|dilateRemoveCoverage|roboflow|WebGLRenderer/);
});
