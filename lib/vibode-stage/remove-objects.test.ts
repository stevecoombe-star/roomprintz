import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mapRemovePointer } from "./remove-mask";
import {
  REMOVE_OBJECT_ELIGIBILITY_DEFAULTS,
  assessRemoveObjectEligibility,
  hideAllRemoveObjects,
  hitTestRemoveObjects,
  packRemoveMask,
  packRemoveObjectMaskAtOriginal,
  paintRemoveEffectiveCoverage,
  paintRemoveObjectUnion,
  prepareRemoveObjectMasks,
  removeMaskOverlap,
  removeObjectFrameBounds,
  removeObjectPixel,
  removePackedBit,
  removePackedByteLength,
  showAllRemoveObjects,
  toggleRemoveObjectSelection,
  unionRemoveObjectBounds,
  unpackRemoveMask,
  type RemoveObjectCandidate,
  type RemoveObjectRecord,
  type RemovePackedMask,
} from "./remove-objects";

const SMALL = { minAreaPx: 1 } as const;

function rectCoverage(
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): Uint8Array {
  const coverage = new Uint8Array(width * height);
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) coverage[py * width + px] = 255;
  }
  return coverage;
}

function mustPack(coverage: Uint8Array, width: number, height: number): RemovePackedMask {
  const packed = packRemoveMask(coverage, width, height);
  assert.ok(packed);
  return packed;
}

function rectMask(
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): RemovePackedMask {
  return mustPack(rectCoverage(width, height, x, y, rectWidth, rectHeight), width, height);
}

function candidate(
  id: string,
  mask: RemovePackedMask,
  confidence = 0.9,
  concept = "chair",
): RemoveObjectCandidate {
  return { id, confidence, concept, mask };
}

function ids(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}

function records(candidates: readonly RemoveObjectCandidate[]): readonly RemoveObjectRecord[] {
  return prepareRemoveObjectMasks({ candidates, thresholds: SMALL }).eligible;
}

test("packed bits round-trip at ORIGINAL indexes", () => {
  assert.equal(removePackedByteLength(3, 3), 2);
  const row = mustPack(Uint8Array.of(255, 0, 255), 3, 1);
  assert.equal(row.areaPx, 2);
  assert.deepEqual(row.bounds, { x: 0, y: 0, width: 3, height: 1 });
  assert.equal(row.bits[0], 0b101);
  assert.equal(removePackedBit(row, 0, 0), true);
  assert.equal(removePackedBit(row, 1, 0), false);
  assert.equal(removePackedBit(row, 2, 0), true);
  assert.deepEqual(unpackRemoveMask(row), Uint8Array.of(255, 0, 255));

  const soft = mustPack(Uint8Array.of(0, 127, 128, 255), 4, 1);
  assert.deepEqual(unpackRemoveMask(soft), Uint8Array.of(0, 0, 255, 255));
  const placed = rectMask(6, 5, 2, 3, 4, 1);
  assert.equal(placed.areaPx, 4);
  assert.deepEqual(placed.bounds, { x: 2, y: 3, width: 4, height: 1 });
});

test("provider grids resample onto ORIGINAL pixels with nearest thresholding", () => {
  const scaled = packRemoveObjectMaskAtOriginal({
    source: Uint8Array.of(0, 255),
    sourceWidth: 2,
    sourceHeight: 1,
    originalWidth: 4,
    originalHeight: 1,
  });
  assert.ok(scaled);
  assert.deepEqual(unpackRemoveMask(scaled), Uint8Array.of(0, 0, 255, 255));
  assert.equal(scaled.width, 4);
  assert.equal(scaled.height, 1);

  const same = packRemoveObjectMaskAtOriginal({
    source: Uint8Array.of(0, 127, 128, 255),
    sourceWidth: 4,
    sourceHeight: 1,
    originalWidth: 4,
    originalHeight: 1,
  });
  assert.deepEqual(unpackRemoveMask(same ?? rectMask(1, 1, 0, 0, 1, 1)), Uint8Array.of(0, 0, 255, 255));
});

test("malformed grids and dimension mismatches produce no mask", () => {
  assert.equal(packRemoveMask(new Uint8Array(3), 2, 2), null);
  assert.equal(packRemoveMask(new Uint8Array(4), 0, 2), null);
  assert.equal(packRemoveMask(new Uint8Array(4), 2.5, 2), null);
  assert.equal(packRemoveMask(Uint8Array.of(255), 1, 1, Number.NaN), null);
  assert.equal(unpackRemoveMask({
    width: 2,
    height: 2,
    areaPx: 1,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    bits: new Uint8Array(1),
  }), null);
  assert.equal(packRemoveObjectMaskAtOriginal({
    source: new Uint8Array(3),
    sourceWidth: 2,
    sourceHeight: 2,
    originalWidth: 4,
    originalHeight: 4,
  }), null);
  assert.equal(packRemoveObjectMaskAtOriginal({
    source: Uint8Array.of(255),
    sourceWidth: 1,
    sourceHeight: 1,
    originalWidth: 0,
    originalHeight: 1,
  }), null);
  assert.equal(removeObjectPixel({ x: Number.NaN, y: 0, width: 4, height: 4 }), null);
  assert.equal(removeObjectPixel({ x: -0.1, y: 0, width: 4, height: 4 }), null);
  assert.equal(removeObjectPixel({ x: 4.1, y: 0, width: 4, height: 4 }), null);
});

test("continuous ORIGINAL coordinates land on the containing pixel, including the far edge", () => {
  assert.deepEqual(removeObjectPixel({ x: 0, y: 0, width: 4, height: 4 }), { x: 0, y: 0 });
  assert.deepEqual(removeObjectPixel({ x: 1, y: 0.2, width: 4, height: 4 }), { x: 1, y: 0 });
  const corner = mapRemovePointer({
    clientX: 10,
    clientY: 20,
    rect: { left: 0, top: 0, width: 10, height: 20 },
    originalWidth: 4,
    originalHeight: 5,
  });
  assert.equal(corner.status, "inside");
  if (corner.status !== "inside") return;
  assert.deepEqual(
    removeObjectPixel({ x: corner.x, y: corner.y, width: 4, height: 5 }),
    { x: 3, y: 4 },
  );
});

test("overlapping selections stay reversible and brush pixels stay intact", () => {
  const width = 8;
  const height = 4;
  const table = rectMask(width, height, 0, 0, 5, 4);
  const lamp = rectMask(width, height, 3, 0, 4, 2);
  const objects = records([
    candidate("table", table, 0.8, "table"),
    candidate("lamp", lamp, 0.95, "lamp"),
  ]);
  const brush = new Uint8Array(width * height);
  brush[0] = 180;
  brush[3] = 90;
  brush[5] = 40;
  const brushBefore = brush.slice();
  const lampBits = lamp.bits.slice();
  const union = new Uint8Array(width * height);
  const effective = new Uint8Array(width * height);
  const frame = removeObjectFrameBounds(width, height);
  const both = hideAllRemoveObjects(objects);
  assert.deepEqual(ids(both), ["lamp", "table"]);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: both,
    bounds: frame,
  }), true);
  assert.equal(paintRemoveEffectiveCoverage({
    brush,
    objectUnion: union,
    destination: effective,
    width,
    height,
    bounds: frame,
  }), true);
  assert.equal(union[0], 255);
  assert.equal(union[3], 255);
  assert.equal(union[5], 255);
  assert.equal(effective[0], 255);
  assert.equal(effective[3], 255);
  assert.equal(effective[5], 255);

  const lampOff = toggleRemoveObjectSelection(both, objects, "lamp");
  assert.deepEqual(ids(both), ["lamp", "table"]);
  assert.equal(lampOff.has("table"), true);
  assert.equal(lampOff.has("lamp"), false);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: lampOff,
    bounds: lamp.bounds,
  }), true);
  assert.equal(paintRemoveEffectiveCoverage({
    brush,
    objectUnion: union,
    destination: effective,
    width,
    height,
    bounds: lamp.bounds,
  }), true);
  assert.equal(union[5], 0);
  assert.equal(union[3], 255);
  assert.equal(union[0], 255);
  assert.equal(effective[5], 40);
  assert.equal(effective[3], 255);
  assert.equal(effective[0], 255);

  const none = showAllRemoveObjects();
  assert.equal(none.size, 0);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: none,
    bounds: table.bounds,
  }), true);
  assert.equal(paintRemoveEffectiveCoverage({
    brush,
    objectUnion: union,
    destination: effective,
    width,
    height,
    bounds: table.bounds,
  }), true);
  assert.equal(union[0], 0);
  assert.equal(union[3], 0);
  assert.equal(effective[0], 180);
  assert.equal(effective[3], 90);
  assert.equal(union[5], 0);
  assert.deepEqual(brush, brushBefore);
  assert.deepEqual(lamp.bits, lampBits);
});

test("effective coverage is max(brush, union) and does not accumulate", () => {
  const width = 4;
  const height = 1;
  const mask = mustPack(Uint8Array.of(255, 255, 0, 0), width, height);
  const objects = records([candidate("sofa", mask, 0.9, "sofa")]);
  const selected = hideAllRemoveObjects(objects);
  const brush = Uint8Array.of(200, 20, 100, 0);
  const union = new Uint8Array(4);
  const effective = new Uint8Array(4);
  const bounds = removeObjectFrameBounds(width, height);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: selected,
    bounds,
  }), true);
  const firstUnion = union.slice();
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: selected,
    bounds,
  }), true);
  assert.deepEqual(union, firstUnion);
  assert.deepEqual(union, Uint8Array.of(255, 255, 0, 0));
  assert.equal(paintRemoveEffectiveCoverage({
    brush,
    objectUnion: union,
    destination: effective,
    width,
    height,
    bounds,
  }), true);
  assert.deepEqual(effective, Uint8Array.of(255, 255, 100, 0));
  assert.equal(paintRemoveEffectiveCoverage({
    brush,
    objectUnion: union,
    destination: effective,
    width,
    height,
    bounds,
  }), true);
  assert.deepEqual(effective, Uint8Array.of(255, 255, 100, 0));
  assert.deepEqual(brush, Uint8Array.of(200, 20, 100, 0));

  const again = toggleRemoveObjectSelection(
    toggleRemoveObjectSelection(selected, objects, "sofa"),
    objects,
    "sofa",
  );
  assert.deepEqual(ids(again), ["sofa"]);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: again,
    bounds,
  }), true);
  assert.deepEqual(union, Uint8Array.of(255, 255, 0, 0));
});

test("bounds-limited rebuild leaves pixels outside the rect untouched", () => {
  const width = 6;
  const height = 2;
  const left = rectMask(width, height, 0, 0, 2, 2);
  const right = rectMask(width, height, 4, 0, 2, 2);
  const objects = records([
    candidate("left", left, 0.9, "chair"),
    candidate("right", right, 0.9, "chair"),
  ]);
  const union = new Uint8Array(width * height).fill(7);
  const selected = hideAllRemoveObjects(objects);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: selected,
    bounds: unionRemoveObjectBounds(objects),
  }), true);
  assert.equal(union[0], 255);
  assert.equal(union[4], 255);
  assert.equal(union[3], 0);
  const rightOff = toggleRemoveObjectSelection(selected, objects, "right");
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects,
    selectedIds: rightOff,
    bounds: right.bounds,
  }), true);
  assert.equal(union[0], 255);
  assert.equal(union[4], 0);
  assert.equal(union[3], 0);
});

test("Hide All and Show All use eligible masks only", () => {
  const width = 100;
  const height = 100;
  const sofa = rectMask(width, height, 10, 10, 70, 70);
  const speck = rectMask(width, height, 10, 10, 4, 4);
  const prepared = prepareRemoveObjectMasks({
    candidates: [
      candidate("sofa", sofa, 0.91, "sofa"),
      candidate("speck", speck, 0.99, "decoration"),
    ],
  });
  assert.deepEqual(prepared.eligible.map((object) => object.id), ["sofa"]);
  assert.equal(prepared.rejected[0]?.id, "speck");
  assert.equal(prepared.rejected[0]?.eligibility.reasons.includes("min_area"), true);
  const hidden = hideAllRemoveObjects([...prepared.eligible, ...prepared.rejected]);
  assert.deepEqual(ids(hidden), ["sofa"]);
  const union = new Uint8Array(width * height);
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects: [...prepared.eligible, ...prepared.rejected],
    selectedIds: new Set(["sofa", "speck"]),
    bounds: removeObjectFrameBounds(width, height),
  }), true);
  assert.equal(union[10 * width + 10], 255);
  assert.equal(union[0], 0);
  const shown = showAllRemoveObjects();
  assert.equal(paintRemoveObjectUnion({
    destination: union,
    width,
    height,
    objects: prepared.eligible,
    selectedIds: shown,
    bounds: sofa.bounds,
  }), true);
  assert.equal(union[10 * width + 10], 0);
  assert.equal(toggleRemoveObjectSelection(hidden, prepared.rejected, "speck"), hidden);
  assert.equal(toggleRemoveObjectSelection(hidden, prepared.eligible, "missing"), hidden);
});

test("default eligibility keeps large and edge-touching objects and records why", () => {
  const width = 100;
  const height = 100;
  const sofa = rectMask(width, height, 10, 10, 70, 70);
  const sofaDecision = assessRemoveObjectEligibility(sofa, 0.5);
  assert.equal(sofaDecision.eligible, true);
  assert.deepEqual(sofaDecision.reasons, []);
  assert.deepEqual(sofaDecision.notices, ["large_area"]);
  assert.equal(sofaDecision.areaPx, 4900);

  const exactLarge = rectCoverage(width, height, 5, 5, 90, 50);
  const above = assessRemoveObjectEligibility(mustPack(exactLarge, width, height), 0.8);
  const belowCoverage = exactLarge.slice();
  belowCoverage[5 * width + 5] = 0;
  const below = assessRemoveObjectEligibility(mustPack(belowCoverage, width, height), 0.8);
  assert.equal(above.notices.includes("large_area"), true);
  assert.equal(below.areaPx, 4499);
  assert.equal(below.notices.includes("large_area"), false);
  assert.equal(below.eligible, true);

  const rug = rectMask(width, height, 10, 92, 80, 8);
  const rugDecision = assessRemoveObjectEligibility(rug, 0.8);
  assert.equal(rugDecision.eligible, true);
  assert.deepEqual(rugDecision.notices, ["edge_touch"]);
  assert.equal(rugDecision.edgeTouches, 1);

  const wallToWall = rectMask(width, height, 0, 80, 100, 20);
  const wallToWallDecision = assessRemoveObjectEligibility(wallToWall, 0.8);
  assert.equal(wallToWallDecision.eligible, true);
  assert.deepEqual(wallToWallDecision.notices, ["edge_touch", "structural_edges"]);

  const bed = rectMask(width, height, 5, 5, 90, 90);
  const bedDecision = assessRemoveObjectEligibility(bed, 0.8);
  assert.equal(bedDecision.eligible, true);
  assert.deepEqual(bedDecision.notices, ["large_area", "full_frame"]);

  const opted = assessRemoveObjectEligibility(bed, 0.8, { rejectNotices: ["full_frame"] });
  assert.equal(opted.eligible, false);
  assert.equal(opted.reasons.includes("full_frame"), true);
  assert.equal(opted.notices.includes("full_frame"), true);
  const sofaStillKept = assessRemoveObjectEligibility(sofa, 0.8, {
    rejectNotices: ["structural_edges"],
  });
  assert.equal(sofaStillKept.eligible, true);
  const rugRejected = assessRemoveObjectEligibility(wallToWall, 0.8, {
    rejectNotices: ["structural_edges"],
  });
  assert.equal(rugRejected.eligible, false);
  assert.equal(rugRejected.reasons.includes("structural_edges"), true);

  const areaRejected = assessRemoveObjectEligibility(sofa, 0.8, { rejectNotices: ["large_area"] });
  assert.equal(areaRejected.eligible, false);
  assert.deepEqual(REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.rejectNotices, []);
});

test("confidence, empty masks, and specks reject with explicit reasons", () => {
  const width = 100;
  const height = 100;
  const sofa = rectMask(width, height, 10, 10, 70, 70);
  const low = assessRemoveObjectEligibility(sofa, 0.49);
  assert.equal(low.eligible, false);
  assert.deepEqual(low.reasons, ["confidence"]);
  assert.equal(low.notices.includes("large_area"), true);
  const missing = assessRemoveObjectEligibility(sofa, Number.NaN);
  assert.equal(missing.reasons.includes("confidence"), true);

  const empty = assessRemoveObjectEligibility(mustPack(new Uint8Array(width * height), width, height), 0.9);
  assert.deepEqual(empty.reasons, ["empty_mask"]);
  assert.equal(empty.eligible, false);

  const speck = assessRemoveObjectEligibility(rectMask(width, height, 40, 40, 19, 21), 0.9);
  assert.equal(speck.areaPx, 399);
  assert.deepEqual(speck.reasons, ["min_area"]);
  const kept = assessRemoveObjectEligibility(rectMask(width, height, 40, 40, 20, 20), 0.9);
  assert.equal(kept.areaPx, 400);
  assert.equal(kept.eligible, true);
  assert.deepEqual(kept.notices, []);
});

test("concept metadata is stored and does not classify the mask", () => {
  const mask = rectMask(40, 40, 8, 8, 20, 20);
  const prepared = prepareRemoveObjectMasks({
    candidates: [candidate("floor-like", mask, 0.88, "floor")],
    thresholds: SMALL,
  });
  assert.equal(prepared.eligible.length, 1);
  assert.equal(prepared.eligible[0]?.concept, "floor");
  assert.equal(prepared.eligible[0]?.eligibility.eligible, true);
});

test("duplicate suppression keeps nested objects and drops near-copies", () => {
  const width = 10;
  const height = 10;
  const shared = rectMask(width, height, 0, 0, 8, 8);
  const reversed = prepareRemoveObjectMasks({
    candidates: [
      candidate("low", shared, 0.6, "sofa"),
      candidate("high", shared, 0.9, "furniture"),
    ],
    thresholds: SMALL,
  });
  const forward = prepareRemoveObjectMasks({
    candidates: [
      candidate("high", shared, 0.9, "furniture"),
      candidate("low", shared, 0.6, "sofa"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(reversed.eligible.map((object) => object.id), ["high"]);
  assert.deepEqual(forward.eligible.map((object) => object.id), ["high"]);
  assert.equal(reversed.suppressed[0]?.duplicateOf, "high");
  assert.equal(reversed.suppressed[0]?.object.id, "low");
  assert.equal(reversed.nested.length, 0);

  const tied = prepareRemoveObjectMasks({
    candidates: [
      candidate("b", shared, 0.8, "sofa"),
      candidate("a", shared, 0.8, "sofa"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(tied.eligible.map((object) => object.id), ["a"]);
  assert.equal(tied.suppressed[0]?.duplicateOf, "a");

  const outer = rectMask(width, height, 0, 0, 8, 8);
  const inner = rectMask(width, height, 2, 2, 2, 2);
  const nested = prepareRemoveObjectMasks({
    candidates: [
      candidate("lamp", inner, 0.92, "lamp"),
      candidate("table", outer, 0.7, "table"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(nested.eligible.map((object) => object.id), ["lamp", "table"]);
  assert.deepEqual(nested.suppressed, []);
  assert.deepEqual(nested.nested, [{
    innerId: "lamp",
    outerId: "table",
    iou: 4 / 64,
    containment: 1,
  }]);
  const overlap = removeMaskOverlap(inner, outer);
  assert.equal(overlap?.intersection, 4);
  assert.equal(overlap?.union, 64);

  const almost = rectCoverage(width, height, 0, 0, 10, 10);
  almost[0] = 0;
  const conflict = prepareRemoveObjectMasks({
    candidates: [
      candidate("parent", rectMask(width, height, 0, 0, 10, 10), 0.9, "sofa"),
      candidate("child", mustPack(almost, width, height), 0.95, "cushion"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(conflict.eligible.map((object) => object.id), ["child"]);
  assert.equal(conflict.suppressed[0]?.object.id, "parent");
  assert.equal(conflict.nested.length, 0);
  assert.ok((conflict.suppressed[0]?.iou ?? 0) >= 0.7);
});

function suppressionReport(candidates: readonly RemoveObjectCandidate[]) {
  return prepareRemoveObjectMasks({ candidates, thresholds: SMALL }).suppressed.map((item) => ({
    suppressedId: item.suppressedId,
    suppressedConcept: item.suppressedConcept,
    suppressedConfidence: item.suppressedConfidence,
    retainedId: item.retainedId,
    retainedConcept: item.retainedConcept,
    retainedConfidence: item.retainedConfidence,
    iou: item.iou,
    reason: item.reason,
    duplicateOf: item.duplicateOf,
  }));
}

test("a higher-confidence near-duplicate suppresses the lower-confidence candidate", () => {
  const shared = rectMask(8, 8, 0, 0, 8, 8);
  const report = suppressionReport([
    candidate("sofa", shared, 0.61, "sofa"),
    candidate("copy", shared, 0.9, "object"),
  ]);
  assert.deepEqual(report, [{
    suppressedId: "sofa",
    suppressedConcept: "sofa",
    suppressedConfidence: 0.61,
    retainedId: "copy",
    retainedConcept: "object",
    retainedConfidence: 0.9,
    iou: 1,
    reason: "higher_confidence",
    duplicateOf: "copy",
  }]);
});

test("equal-confidence duplicates keep the lesser id", () => {
  const shared = rectMask(8, 8, 1, 1, 5, 5);
  const report = suppressionReport([
    candidate("b", shared, 0.8, "sofa"),
    candidate("a", shared, 0.8, "rug"),
  ]);
  assert.deepEqual(report, [{
    suppressedId: "b",
    suppressedConcept: "sofa",
    suppressedConfidence: 0.8,
    retainedId: "a",
    retainedConcept: "rug",
    retainedConfidence: 0.8,
    iou: 1,
    reason: "equal_confidence_lesser_id",
    duplicateOf: "a",
  }]);
});

test("nested objects stay independently selectable when they are not duplicates", () => {
  const outer = rectMask(10, 10, 0, 0, 8, 8);
  const inner = rectMask(10, 10, 2, 2, 2, 2);
  const prepared = prepareRemoveObjectMasks({
    candidates: [
      candidate("table", outer, 0.7, "table"),
      candidate("lamp", inner, 0.92, "lamp"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(prepared.suppressed, []);
  const objects = prepared.eligible;
  assert.deepEqual(ids(new Set(objects.map((object) => object.id))), ["lamp", "table"]);
  const lampOnly = toggleRemoveObjectSelection(new Set(), objects, "lamp");
  assert.deepEqual(ids(lampOnly), ["lamp"]);
  const both = toggleRemoveObjectSelection(lampOnly, objects, "table");
  assert.deepEqual(ids(both), ["lamp", "table"]);
  const tableOnly = toggleRemoveObjectSelection(both, objects, "lamp");
  assert.deepEqual(ids(tableOnly), ["table"]);
  assert.equal(hitTestRemoveObjects({
    objects,
    selectedIds: new Set(),
    x: 2,
    y: 2,
  }), "lamp");
  assert.equal(hitTestRemoveObjects({
    objects,
    selectedIds: tableOnly,
    x: 2,
    y: 2,
  }), "table");
});

test("duplicate diagnostics stay the same for every input order", () => {
  const shared = rectMask(8, 8, 0, 0, 6, 6);
  const nested = rectMask(8, 8, 1, 1, 2, 2);
  const keeper = candidate("keeper", shared, 0.92, "furniture");
  const mid = candidate("mid", shared, 0.7, "sofa");
  const later = candidate("z", shared, 0.7, "lamp");
  const inner = candidate("lamp", nested, 0.95, "lamp");
  const orders = [
    [keeper, mid, later, inner],
    [later, inner, mid, keeper],
    [inner, later, keeper, mid],
    [mid, keeper, inner, later],
  ];
  const expected = suppressionReport(orders[0] ?? []);
  assert.deepEqual(expected, [
    {
      suppressedId: "mid",
      suppressedConcept: "sofa",
      suppressedConfidence: 0.7,
      retainedId: "keeper",
      retainedConcept: "furniture",
      retainedConfidence: 0.92,
      iou: 1,
      reason: "higher_confidence",
      duplicateOf: "keeper",
    },
    {
      suppressedId: "z",
      suppressedConcept: "lamp",
      suppressedConfidence: 0.7,
      retainedId: "keeper",
      retainedConcept: "furniture",
      retainedConfidence: 0.92,
      iou: 1,
      reason: "higher_confidence",
      duplicateOf: "keeper",
    },
  ]);
  for (const order of orders) {
    assert.deepEqual(suppressionReport(order), expected);
    const prepared = prepareRemoveObjectMasks({ candidates: order, thresholds: SMALL });
    assert.deepEqual(
      prepared.eligible.map((object) => object.id).sort(),
      ["keeper", "lamp"],
    );
  }
});

test("hit testing peels the selected mask, otherwise the smallest, then confidence and id", () => {
  const width = 8;
  const height = 4;
  const table = rectMask(width, height, 0, 0, 5, 4);
  const lamp = rectMask(width, height, 3, 0, 4, 2);
  const objects = records([
    candidate("table", table, 0.8, "table"),
    candidate("lamp", lamp, 0.95, "lamp"),
  ]);
  const none = new Set<string>();
  assert.equal(hitTestRemoveObjects({ objects, selectedIds: none, x: 3, y: 0 }), "lamp");
  assert.equal(hitTestRemoveObjects({ objects, selectedIds: none, x: 0, y: 1 }), "table");
  assert.equal(hitTestRemoveObjects({ objects, selectedIds: none, x: 7, y: 3 }), null);
  const both = hideAllRemoveObjects(objects);
  assert.equal(hitTestRemoveObjects({ objects, selectedIds: both, x: 3, y: 0 }), "lamp");
  const tableOnly = toggleRemoveObjectSelection(both, objects, "lamp");
  assert.equal(hitTestRemoveObjects({ objects, selectedIds: tableOnly, x: 3, y: 0 }), "table");
  assert.equal(hitTestRemoveObjects({ objects, selectedIds: tableOnly, x: 5, y: 0 }), "lamp");

  const low = mustPack(Uint8Array.of(0, 255, 0, 255), 4, 1);
  const high = mustPack(Uint8Array.of(0, 255, 255, 0), 4, 1);
  const tiedArea = records([
    candidate("low", low, 0.6, "chair"),
    candidate("high", high, 0.8, "lamp"),
  ]);
  assert.equal(hitTestRemoveObjects({
    objects: tiedArea,
    selectedIds: none,
    x: 1,
    y: 0,
  }), "high");
  const sameScore = records([
    candidate("m", low, 0.8, "chair"),
    candidate("a", high, 0.8, "lamp"),
  ]);
  assert.equal(hitTestRemoveObjects({
    objects: sameScore,
    selectedIds: none,
    x: 1,
    y: 0,
  }), "a");
  const selectedLoser = records([
    candidate("sharp", low, 0.99, "lamp"),
    candidate("hidden", high, 0.5, "table"),
  ]);
  assert.equal(hitTestRemoveObjects({
    objects: selectedLoser,
    selectedIds: new Set(["hidden"]),
    x: 1,
    y: 0,
  }), "hidden");

  const corner = rectMask(4, 5, 3, 4, 1, 1);
  const edgeObjects = records([candidate("edge", corner, 0.9, "plant")]);
  const edge = edgeObjects[0];
  assert.ok(edge);
  assert.equal(hitTestRemoveObjects({
    objects: edgeObjects,
    selectedIds: none,
    x: 4,
    y: 5,
  }), "edge");
  assert.equal(hitTestRemoveObjects({
    objects: edgeObjects,
    selectedIds: none,
    x: Number.NaN,
    y: 0,
  }), null);
  assert.equal(hitTestRemoveObjects({
    objects: [
      edge,
      {
        ...edge,
        id: "other",
        mask: rectMask(3, 3, 0, 0, 1, 1),
      },
    ],
    selectedIds: none,
    x: 0,
    y: 0,
  }), null);
  assert.equal(hitTestRemoveObjects({ objects: [], selectedIds: none, x: 0, y: 0 }), null);
});

test("empty, mismatched, and ineligible inputs do not write or select", () => {
  const prepared = prepareRemoveObjectMasks({ candidates: [] });
  assert.deepEqual(prepared, { eligible: [], rejected: [], suppressed: [], nested: [] });
  assert.equal(hideAllRemoveObjects([]).size, 0);
  assert.equal(unionRemoveObjectBounds([]).width, 0);

  const blank = prepareRemoveObjectMasks({
    candidates: [candidate("  ", rectMask(4, 4, 0, 0, 4, 4), 0.9, "chair")],
    thresholds: SMALL,
  });
  assert.equal(blank.rejected[0]?.eligibility.reasons.includes("malformed"), true);

  const repeated = prepareRemoveObjectMasks({
    candidates: [
      candidate("same", rectMask(4, 4, 0, 0, 2, 2), 0.9, "chair"),
      candidate("same", rectMask(4, 4, 2, 2, 2, 2), 0.9, "lamp"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(repeated.eligible.map((object) => object.id), ["same"]);
  assert.equal(repeated.rejected[0]?.eligibility.reasons.includes("duplicate_id"), true);

  const mixed = prepareRemoveObjectMasks({
    candidates: [
      candidate("native", rectMask(4, 4, 0, 0, 4, 4), 0.9, "bed"),
      candidate("other", rectMask(5, 5, 0, 0, 5, 5), 0.9, "bed"),
    ],
    thresholds: SMALL,
  });
  assert.deepEqual(mixed.eligible.map((object) => object.id), ["native"]);
  assert.equal(mixed.rejected[0]?.eligibility.reasons.includes("dimensions"), true);

  const destination = new Uint8Array(4).fill(7);
  const object = records([candidate("chair", rectMask(2, 2, 0, 0, 2, 2), 0.9, "chair")])[0];
  assert.ok(object);
  assert.equal(paintRemoveObjectUnion({
    destination,
    width: 2,
    height: 2,
    objects: [object],
    selectedIds: new Set(["chair"]),
    bounds: { x: 0, y: 0, width: 3, height: 1 },
  }), false);
  assert.deepEqual(destination, Uint8Array.of(7, 7, 7, 7));
  assert.equal(paintRemoveEffectiveCoverage({
    brush: new Uint8Array(3),
    objectUnion: new Uint8Array(4),
    destination: new Uint8Array(4),
    width: 2,
    height: 2,
    bounds: removeObjectFrameBounds(2, 2),
  }), false);
  const low = assessRemoveObjectEligibility(rectMask(8, 8, 1, 1, 2, 2), 0.1);
  assert.equal(low.eligible, false);
  const quiet = new Uint8Array(64);
  assert.equal(paintRemoveObjectUnion({
    destination: quiet,
    width: 8,
    height: 8,
    objects: [{
      id: "dim",
      confidence: 0.1,
      concept: "lamp",
      mask: rectMask(8, 8, 1, 1, 2, 2),
      eligibility: low,
    }],
    selectedIds: new Set(["dim"]),
    bounds: removeObjectFrameBounds(8, 8),
  }), true);
  assert.equal(quiet[9], 0);
});

test("object algebra does not use brush reveal or restore", () => {
  const source = readFileSync(new URL("./remove-objects.ts", import.meta.url), "utf8");
  assert.match(source, /resampleCoverageToOriginal/);
  assert.match(source, /Math\.max\(input\.brush\[index\] \?\? 0, input\.objectUnion\[index\] \?\? 0\)/);
  assert.doesNotMatch(source, /applyRemoveCoverage|paintRemoveBrush|featherPx/);
});
