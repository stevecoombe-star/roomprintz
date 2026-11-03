import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  removePackedBit,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";
import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_MAX_POLYGON_POINTS,
  REMOVE_SEGMENTATION_MAX_RINGS,
  normalizeRoboflowConceptSegment,
  type RemoveSegmentationSuccess,
} from "@/lib/vibode-stage/remove-segmentation";

const WIDTH = 48;
const HEIGHT = 40;
const RECT = rect(8, 8, 36, 28);
const SHORT: number[][] = [[0, 0], [47, 39]];
const OUTER = rect(4, 4, 40, 30);
const HOLE = rect(12, 12, 24, 22);

function rect(x0: number, y0: number, x1: number, y1: number): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function prediction(confidence: number, masks: readonly unknown[]) {
  return { format: "polygon", confidence, masks };
}

function documented(input: Readonly<{
  concepts: readonly string[];
  predictions: Readonly<Record<string, readonly unknown[]>>;
}>) {
  return {
    time: 0.2,
    prompt_results: input.concepts.map((text, promptIndex) => ({
      prompt_index: promptIndex,
      echo: { prompt_index: promptIndex, type: "text", text, num_boxes: 0 },
      predictions: input.predictions[text] ?? [],
    })),
  };
}

function normalize(input: Readonly<{
  concepts?: readonly string[];
  predictions: Readonly<Record<string, readonly unknown[]>>;
  width?: number;
  height?: number;
}>): RemoveSegmentationSuccess {
  const concepts = input.concepts ?? ["chair"];
  const result = normalizeRoboflowConceptSegment({
    payload: documented({ concepts, predictions: input.predictions }),
    concepts,
    originalWidth: input.width ?? WIDTH,
    originalHeight: input.height ?? HEIGHT,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("normalize");
  return result;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function firstDifference(actual: RemovePackedMask, expected: RemovePackedMask): string | null {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return `grid ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`;
  }
  for (let y = 0; y < actual.height; y += 1) {
    for (let x = 0; x < actual.width; x += 1) {
      const left = removePackedBit(actual, x, y);
      const right = removePackedBit(expected, x, y);
      if (left !== right) return `${x},${y} ${String(left)} vs ${String(right)}`;
    }
  }
  return null;
}

function assertSameMask(actual: RemovePackedMask, expected: RemovePackedMask) {
  assert.equal(actual.areaPx, expected.areaPx);
  assert.deepEqual(actual.bounds, expected.bounds);
  assert.equal(sameBytes(actual.bits, expected.bits), true);
  assert.equal(firstDifference(actual, expected), null);
}

function rectangleMask() {
  return normalize({ predictions: { chair: [prediction(0.91, [RECT])] } });
}

function repeatedRectangle(extraPoints: number): number[][] {
  const ring = rect(8, 8, 36, 28);
  for (let index = 0; index < extraPoints; index += 1) ring.push([8, 8]);
  return ring;
}

test("a lone two-point ring remains rejected", () => {
  const result = normalize({
    predictions: { chair: [prediction(0.91, [[[4, 4], [8, 4]]])] },
  });
  assert.equal(result.preparation.eligible.length, 0);
  assert.equal(result.preparation.rejected.length, 0);
  assert.deepEqual(result.predictionRejections, [{
    concept: "chair",
    conceptIndex: 0,
    ordinal: 0,
    reason: "degenerate_polygon",
  }]);
});

test("an empty masks array retains empty_mask", () => {
  const result = normalize({
    predictions: { chair: [prediction(0.9, [])] },
  });
  assert.equal(result.predictionRejections.length, 0);
  assert.equal(result.preparation.eligible.length, 0);
  assert.equal(result.preparation.rejected.length, 1);
  const rejected = result.preparation.rejected[0];
  assert.ok(rejected);
  if (!rejected) return;
  assert.equal(rejected.confidence, 0.9);
  assert.equal(rejected.eligibility.reasons.includes("empty_mask"), true);
  assert.equal(rejected.mask.areaPx, 0);
  assert.deepEqual(rejected.mask.bounds, { x: 0, y: 0, width: 0, height: 0 });
});

test("a valid rectangle followed by a short ring yields that rectangle", () => {
  const control = rectangleMask();
  const result = normalize({
    predictions: { chair: [prediction(0.91, [RECT, SHORT])] },
  });
  assert.equal(result.predictionRejections.length, 0);
  assert.equal(result.preparation.rejected.length, 0);
  const actual = result.preparation.eligible[0];
  const expected = control.preparation.eligible[0];
  assert.ok(actual && expected);
  if (!actual || !expected) return;
  assert.equal(actual.id, expected.id);
  assert.equal(actual.confidence, 0.91);
  assert.equal(actual.mask.areaPx, 560);
  assert.deepEqual(actual.mask.bounds, { x: 8, y: 8, width: 28, height: 20 });
  assertSameMask(actual.mask, expected.mask);
  assert.equal(removePackedBit(actual.mask, 0, 0), false);
  assert.equal(removePackedBit(actual.mask, 47, 39), false);
  assert.equal(removePackedBit(actual.mask, 10, 10), true);
});

test("a short ring followed by a valid rectangle yields the same pixels", () => {
  const control = rectangleMask();
  const result = normalize({
    predictions: { chair: [prediction(0.91, [SHORT, RECT])] },
  });
  const actual = result.preparation.eligible[0];
  const expected = control.preparation.eligible[0];
  assert.ok(actual && expected);
  if (!actual || !expected) return;
  assert.equal(result.predictionRejections.length, 0);
  assert.equal(actual.id, expected.id);
  assertSameMask(actual.mask, expected.mask);
  assert.equal(removePackedBit(actual.mask, 0, 0), false);
  assert.equal(removePackedBit(actual.mask, 47, 39), false);
});

test("a short ring between two valid rings preserves even-odd holes", () => {
  const solid = normalize({ predictions: { chair: [prediction(0.91, [OUTER])] } });
  const holed = normalize({ predictions: { chair: [prediction(0.91, [OUTER, HOLE])] } });
  const salvaged = normalize({
    predictions: { chair: [prediction(0.91, [OUTER, SHORT, HOLE])] },
  });
  const solidMask = solid.preparation.eligible[0]?.mask;
  const holedMask = holed.preparation.eligible[0]?.mask;
  const salvagedObject = salvaged.preparation.eligible[0];
  const holedObject = holed.preparation.eligible[0];
  assert.ok(solidMask && holedMask && salvagedObject && holedObject);
  if (!solidMask || !holedMask || !salvagedObject || !holedObject) return;
  assert.equal(salvaged.predictionRejections.length, 0);
  assert.equal(solidMask.areaPx, 936);
  assert.equal(holedMask.areaPx, 816);
  assert.equal(removePackedBit(solidMask, 16, 16), true);
  assert.equal(removePackedBit(holedMask, 6, 6), true);
  assert.equal(removePackedBit(holedMask, 16, 16), false);
  assert.equal(removePackedBit(holedMask, 0, 0), false);
  assert.equal(salvagedObject.id, holedObject.id);
  assertSameMask(salvagedObject.mask, holedMask);
  assert.equal(removePackedBit(salvagedObject.mask, 16, 16), false);
  assert.equal(removePackedBit(salvagedObject.mask, 0, 0), false);
  assert.equal(removePackedBit(salvagedObject.mask, 47, 39), false);

  const doubled = normalize({ predictions: { chair: [prediction(0.91, [RECT, RECT])] } });
  const doubledWithShort = normalize({
    predictions: { chair: [prediction(0.91, [RECT, SHORT, RECT])] },
  });
  const doubledMask = doubled.preparation.rejected[0]?.mask;
  const doubledShortMask = doubledWithShort.preparation.rejected[0]?.mask;
  assert.equal(doubled.predictionRejections.length, 0);
  assert.equal(doubledWithShort.predictionRejections.length, 0);
  assert.equal(doubled.preparation.eligible.length, 0);
  assert.equal(doubled.preparation.rejected[0]?.eligibility.reasons.includes("empty_mask"), true);
  assert.ok(doubledMask && doubledShortMask);
  if (!doubledMask || !doubledShortMask) return;
  assert.equal(doubledMask.areaPx, 0);
  assertSameMask(doubledShortMask, doubledMask);
});

test("a non-array ring still rejects the prediction", () => {
  const control = normalize({
    concepts: ["chair", "lamp"],
    predictions: { lamp: [prediction(0.91, [RECT])] },
  });
  const expected = control.preparation.eligible[0];
  assert.ok(expected);
  if (!expected) return;
  const masks: readonly unknown[][] = [
    [RECT, null],
    [null, RECT],
    [RECT, "ab"],
    [RECT, { length: 2 }],
    [null],
    ["ab", RECT],
  ];
  for (const ringSet of masks) {
    const result = normalize({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [prediction(0.91, ringSet)],
        lamp: [prediction(0.91, [RECT])],
      },
    });
    assert.deepEqual(result.predictionRejections, [{
      concept: "chair",
      conceptIndex: 0,
      ordinal: 0,
      reason: "degenerate_polygon",
    }]);
    assert.equal(result.preparation.rejected.length, 0);
    assert.equal(result.preparation.eligible.length, 1);
    const lamp = result.preparation.eligible[0];
    assert.ok(lamp);
    if (!lamp) return;
    assert.equal(lamp.concept, "lamp");
    assert.equal(lamp.id, expected.id);
    assertSameMask(lamp.mask, expected.mask);
  }
});

test("empty and one-point rings follow the short-ring rule", () => {
  for (const ring of [[], [[4, 4]]]) {
    const alone = normalize({ predictions: { chair: [prediction(0.91, [ring])] } });
    assert.equal(alone.preparation.eligible.length, 0);
    assert.equal(alone.preparation.rejected.length, 0);
    assert.equal(alone.predictionRejections[0]?.reason, "degenerate_polygon");
  }
  const control = rectangleMask();
  const result = normalize({
    predictions: {
      chair: [prediction(0.91, [[], [[4, 4]], RECT, [[Number.NaN, 1], [2, 2]], [[1, 2, 3], "x"]])],
    },
  });
  const actual = result.preparation.eligible[0];
  const expected = control.preparation.eligible[0];
  assert.ok(actual && expected);
  if (!actual || !expected) return;
  assert.equal(result.predictionRejections.length, 0);
  assertSameMask(actual.mask, expected.mask);
});

test("invalid sibling geometry and unwrapped points still reject the prediction", () => {
  const lamp = prediction(0.91, [RECT]);
  const cases: ReadonlyArray<Readonly<{ masks: readonly unknown[]; reason: string }>> = [
    { masks: [RECT, [[0, 0], [80, 0], [80, 10], [0, 10]]], reason: "invalid_rasterization" },
    { masks: [[[0, 0], [80, 0], [80, 10], [0, 10]], RECT], reason: "invalid_rasterization" },
    { masks: [RECT, [[1, 1], [8, 1], [8, 8, 9]]], reason: "invalid_polygon" },
    { masks: [[[1, 1], [8, 1], [Number.NaN, 8]], RECT], reason: "invalid_polygon" },
    { masks: [[1, 1, 30, 1, 30, 22, 1, 22]], reason: "invalid_polygon" },
    { masks: [RECT, [1, 1, 30, 1, 30, 22, 1, 22]], reason: "invalid_polygon" },
    { masks: [1, 1, 30, 1, 30, 22, 1, 22], reason: "degenerate_polygon" },
  ];
  for (const item of cases) {
    const result = normalize({
      concepts: ["chair", "lamp"],
      predictions: {
        chair: [prediction(0.88, item.masks)],
        lamp: [lamp],
      },
    });
    assert.equal(result.predictionRejections.length, 1);
    assert.equal(result.predictionRejections[0]?.concept, "chair");
    assert.equal(result.predictionRejections[0]?.reason, item.reason);
    assert.equal(result.preparation.eligible.length, 1);
    assert.equal(result.preparation.eligible[0]?.concept, "lamp");
    assert.equal(result.preparation.rejected.length, 0);
  }
});

test("short rings still consume the ring ceiling and real point overruns stay rejected", () => {
  const control = rectangleMask();
  const under: unknown[] = Array.from(
    { length: REMOVE_SEGMENTATION_MAX_RINGS - 1 },
    () => [[0, 0], [47, 39]],
  );
  under.splice(20, 0, RECT);
  assert.equal(under.length, REMOVE_SEGMENTATION_MAX_RINGS);
  const kept = normalize({ predictions: { chair: [prediction(0.91, under)] } });
  const keptMask = kept.preparation.eligible[0]?.mask;
  const controlMask = control.preparation.eligible[0]?.mask;
  assert.equal(kept.predictionRejections.length, 0);
  assert.ok(keptMask && controlMask);
  if (!keptMask || !controlMask) return;
  assertSameMask(keptMask, controlMask);

  const over: unknown[] = Array.from(
    { length: REMOVE_SEGMENTATION_MAX_RINGS },
    () => [[0, 0], [47, 39]],
  );
  over.push(RECT);
  const crowded = normalize({
    concepts: ["chair", "lamp"],
    predictions: {
      chair: [prediction(0.91, over)],
      lamp: [prediction(0.91, [RECT])],
    },
  });
  assert.equal(crowded.predictionRejections[0]?.reason, "polygon_ring_ceiling");
  assert.equal(crowded.preparation.eligible.length, 1);
  assert.equal(crowded.preparation.eligible[0]?.concept, "lamp");
  assert.equal(crowded.preparation.rejected.length, 0);

  const atCeiling = repeatedRectangle(REMOVE_SEGMENTATION_MAX_POLYGON_POINTS - 4);
  assert.equal(atCeiling.length, REMOVE_SEGMENTATION_MAX_POLYGON_POINTS);
  const withShort = normalize({
    predictions: { chair: [prediction(0.91, [SHORT, atCeiling])] },
  });
  const cappedMask = withShort.preparation.eligible[0]?.mask;
  assert.equal(withShort.predictionRejections.length, 0);
  assert.ok(cappedMask);
  if (!cappedMask) return;
  assertSameMask(cappedMask, controlMask);

  const overrun = normalize({
    concepts: ["chair", "lamp"],
    predictions: {
      chair: [prediction(0.91, [RECT, atCeiling])],
      lamp: [prediction(0.91, [RECT])],
    },
  });
  assert.equal(overrun.predictionRejections[0]?.reason, "polygon_point_ceiling");
  assert.deepEqual(overrun.preparation.eligible.map((item) => item.concept), ["lamp"]);
  assert.equal(overrun.preparation.rejected.length, 0);
});

test("the captured 960×640 fixture keeps bit-exact eligible and suppressed masks", () => {
  const payload = JSON.parse(readFileSync(
    new URL("./fixtures/roboflow-sam3-polygon-live.json", import.meta.url),
    "utf8",
  ));
  const result = normalizeRoboflowConceptSegment({
    payload,
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    originalWidth: 960,
    originalHeight: 640,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.predictionRejections.length, 0);
  assert.equal(result.preparation.rejected.length, 0);

  const fingerprint = (item: {
    id: string;
    concept: string;
    confidence: number;
    mask: RemovePackedMask;
  }) => ({
    id: item.id,
    concept: item.concept,
    confidence: item.confidence,
    areaPx: item.mask.areaPx,
    bounds: item.mask.bounds,
    sha256: createHash("sha256").update(item.mask.bits).digest("hex"),
  });

  assert.deepEqual(result.preparation.eligible.map(fingerprint), [
    {
      id: "v1-chair-0-1071deee",
      concept: "chair",
      confidence: 0.734375,
      areaPx: 23745,
      bounds: { x: 648, y: 377, width: 202, height: 185 },
      sha256: "56a55eb46300cb45e1a59dfea0eba2af734c8dad2c21d685374d0d50e91822e3",
    },
    {
      id: "v1-sofa-0-5b27cdb7",
      concept: "sofa",
      confidence: 0.875,
      areaPx: 27178,
      bounds: { x: 127, y: 357, width: 273, height: 227 },
      sha256: "db2763f47568e2be311c75e3a7535fd34b264466501a8da9b3010d73b72c3632",
    },
    {
      id: "v1-table-0-58e7055a",
      concept: "table",
      confidence: 0.8828125,
      areaPx: 20309,
      bounds: { x: 16, y: 482, width: 272, height: 157 },
      sha256: "4407c5a6b663aa417bea39a59bd1c82c6a3aec9027c82812aef46678c65589e5",
    },
    {
      id: "v1-table-1-bfa1f2b0",
      concept: "table",
      confidence: 0.87890625,
      areaPx: 15157,
      bounds: { x: 397, y: 406, width: 159, height: 137 },
      sha256: "4677a6e3501742bd3806bdb46f809883bd3d87e88ce3f1b41d4110ea17cf6270",
    },
    {
      id: "v1-table-2-4b855453",
      concept: "table",
      confidence: 0.8203125,
      areaPx: 1041,
      bounds: { x: 689, y: 380, width: 80, height: 21 },
      sha256: "b40a232b12cfa8b6c3f8f3feda2a3be65376b6e7b8899817772589232e7f143a",
    },
    {
      id: "v1-lamp-0-714eb5d0",
      concept: "lamp",
      confidence: 0.9296875,
      areaPx: 7287,
      bounds: { x: 110, y: 338, width: 91, height: 177 },
      sha256: "c373c7afe3f244235a37126bddf0c5a7a1879ff5a6333e11787f355a495b84e1",
    },
    {
      id: "v1-lamp-1-ac6fd5aa",
      concept: "lamp",
      confidence: 0.91796875,
      areaPx: 14886,
      bounds: { x: 829, y: 222, width: 93, height: 387 },
      sha256: "9bf2f186fa4aab880b99b7ba0727454b7c98d0d0898bcdd704735c0ba06d0df2",
    },
    {
      id: "v1-lamp-2-097cc706",
      concept: "lamp",
      confidence: 0.76953125,
      areaPx: 830,
      bounds: { x: 334, y: 320, width: 28, height: 56 },
      sha256: "0060e4e7d98b1577a529d13f84cef3ef593ff81d73223ceca92967a82420b085",
    },
    {
      id: "v1-rug-0-24e97bb4",
      concept: "rug",
      confidence: 0.7890625,
      areaPx: 42882,
      bounds: { x: 281, y: 443, width: 431, height: 181 },
      sha256: "10916aac8ae186b4cb9af256b16e8826dc668e7cc894ef2e3cc45cf3d388b733",
    },
    {
      id: "v1-pillow-0-a4f23e71",
      concept: "pillow",
      confidence: 0.88671875,
      areaPx: 2881,
      bounds: { x: 208, y: 367, width: 63, height: 72 },
      sha256: "4dc87032628015a9139d0bf5aeaefeadfe6766638326ff8bb9d8694a66257388",
    },
  ]);
  assert.deepEqual(result.preparation.suppressed.map((item) => ({
    ...fingerprint(item.object),
    duplicateOf: item.duplicateOf,
    retainedId: item.retainedId,
    reason: item.reason,
    iou: item.iou,
  })), [{
    id: "v1-sofa-1-965e8553",
    concept: "sofa",
    confidence: 0.68359375,
    areaPx: 23865,
    bounds: { x: 648, y: 377, width: 203, height: 185 },
    sha256: "e27bf3d9c52b45995d977927cb8b6e4421adc60e1501e3a9ec24ecf246dd27c8",
    duplicateOf: "v1-chair-0-1071deee",
    retainedId: "v1-chair-0-1071deee",
    reason: "higher_confidence",
    iou: 0.9944702777428679,
  }]);
});
