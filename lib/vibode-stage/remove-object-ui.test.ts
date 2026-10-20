import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  normalizeRoboflowConceptSegment,
} from "@/lib/vibode-stage/remove-segmentation";
import {
  REMOVE_OBJECT_EXPANSION_DEFAULT_PX,
  REMOVE_OBJECT_EXPANSION_MAX_PX,
  applyRemoveObjectClick,
  clampRemoveObjectExpansion,
  dilateRemoveCoverage,
  expandRemoveDirtyRect,
  failRemoveObjectLoad,
  formatRemoveObjectInferenceTime,
  formatRemoveObjectRejected,
  formatRemoveObjectSuppressed,
  hideAllRemoveObjectUi,
  highlightRemoveObject,
  initialRemoveObjectUiState,
  mapOriginalBoxToBacking,
  readRemoveObjectUiPayload,
  reduceRemoveObjectSession,
  removeInspectionBackingSize,
  removeObjectBoundaryPixels,
  removeObjectExpansionIncludesOffset,
  removeObjectOutlineColor,
  removeObjectOutlineRender,
  removeObjectOutlineTone,
  requestRemoveObjects,
  settleRemoveObjectLoad,
  showAllRemoveObjectUi,
  syncRemoveInspectionCoverage,
  type RemoveObjectUiIdentity,
  type RemoveObjectUiState,
} from "@/lib/vibode-stage/remove-object-ui";
import {
  packRemoveMask,
  removePackedBit,
  type RemoveObjectRecord,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";

const IDENTITY: RemoveObjectUiIdentity = {
  roomId: "00000000-0000-4000-8000-000000000001",
  generationId: "00000000-0000-4000-8000-000000000002",
  originalSha256: "a".repeat(64),
  originalWidth: 960,
  originalHeight: 640,
  sessionSerial: 1,
};

function bitsToBase64(bits: Uint8Array): string {
  let binary = "";
  for (const byte of bits) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function wireRecord(record: RemoveObjectRecord) {
  return {
    id: record.id,
    concept: record.concept,
    confidence: record.confidence,
    mask: {
      width: record.mask.width,
      height: record.mask.height,
      areaPx: record.mask.areaPx,
      bounds: record.mask.bounds,
      bits: bitsToBase64(record.mask.bits),
    },
    eligibility: record.eligibility,
  };
}

function livePayload(includeDuplicateInObjects: boolean) {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/roboflow-sam3-polygon-live.json", import.meta.url),
    "utf8",
  )) as { time?: number };
  const normalized = normalizeRoboflowConceptSegment({
    payload: fixture,
    concepts: REMOVE_SEGMENTATION_CONCEPTS_V1,
    originalWidth: 960,
    originalHeight: 640,
  });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("fixture");
  const prepared = normalized.preparation;
  const duplicate = prepared.suppressed[0]?.object;
  const objects = includeDuplicateInObjects && duplicate
    ? [...prepared.eligible, duplicate]
    : prepared.eligible;
  return {
    prepared,
    payload: {
      usable: true,
      provider: "roboflow",
      modelId: "sam3/sam3_final",
      roomId: IDENTITY.roomId,
      generationId: IDENTITY.generationId,
      original: {
        sha256: IDENTITY.originalSha256,
        decodedWidth: 960,
        decodedHeight: 640,
      },
      providerTimeSec: fixture.time ?? null,
      objects: objects.map(wireRecord),
      rejected: prepared.rejected.map(wireRecord),
      suppressed: prepared.suppressed.map((item) => ({
        suppressedId: item.suppressedId,
        suppressedConcept: item.suppressedConcept,
        retainedId: item.retainedId,
        retainedConcept: item.retainedConcept,
        reason: item.reason,
        iou: item.iou,
      })),
    },
  };
}

function readyFrom(payload: unknown, identity = IDENTITY): RemoveObjectUiState {
  const loading = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity,
  });
  assert.equal(loading.command, "fetch");
  return settleRemoveObjectLoad({
    state: loading.state,
    requestSerial: loading.state.requestSerial,
    identity,
    payload,
    elapsedMs: 5126,
  });
}

function rectMask(
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): RemovePackedMask {
  const coverage = new Uint8Array(width * height);
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      coverage[row * width + column] = 255;
    }
  }
  const mask = packRemoveMask(coverage, width, height);
  assert.ok(mask);
  if (!mask) throw new Error("mask");
  return mask;
}

function selectable(
  id: string,
  concept: string,
  confidence: number,
  mask: RemovePackedMask,
  eligible = true,
): RemoveObjectRecord {
  return {
    id,
    concept,
    confidence,
    mask,
    eligibility: {
      eligible,
      reasons: eligible ? [] : ["min_area"],
      notices: [],
      confidence,
      areaPx: mask.areaPx,
      areaFraction: 0,
      edgeTouches: 0,
      bounds: mask.bounds,
    },
  };
}

test("captured polygon masks select, hide, restore, and keep duplicates out", () => {
  const live = livePayload(false);
  const duplicate = live.prepared.suppressed[0];
  assert.ok(duplicate);
  if (!duplicate) return;
  const ready = readyFrom(live.payload);
  assert.equal(ready.phase, "ready");
  assert.equal(ready.objects.length, 10);
  assert.equal(ready.diagnostics?.maskCount, 11);
  assert.equal(ready.diagnostics?.eligibleCount, 10);
  assert.equal(ready.diagnostics?.rejected.length, 0);
  assert.equal(ready.diagnostics?.provider, "roboflow");
  assert.equal(ready.diagnostics?.modelId, "sam3/sam3_final");
  assert.equal(formatRemoveObjectInferenceTime({
    elapsedMs: ready.diagnostics?.elapsedMs ?? 0,
    providerTimeSec: ready.diagnostics?.providerTimeSec ?? null,
  }), "5.1 s (provider 0.30 s)");
  assert.equal(ready.objects.some((item) => item.id === duplicate.suppressedId), false);
  assert.equal(ready.objects.every((item) => item.mask.width === 960 && item.mask.height === 640), true);
  assert.match(formatRemoveObjectSuppressed(ready.diagnostics?.suppressed ?? []), /sofa duplicate of chair, higher_confidence/);

  const chair = ready.objects.find((item) => item.concept === "chair");
  assert.ok(chair);
  if (!chair) return;
  assert.equal(highlightRemoveObject(ready, 750.2, 450.2), chair.id);
  assert.equal(highlightRemoveObject(ready, 750.2, 450.2), chair.id);
  assert.equal(highlightRemoveObject(ready, 10.2, 10.2), null);
  assert.equal(removeObjectOutlineTone(false), "yellow");
  assert.equal(removeObjectOutlineColor("yellow"), "#f5c518");

  const hidden = applyRemoveObjectClick(ready, 750.2, 450.2);
  assert.equal(hidden.requestSerial, ready.requestSerial);
  assert.equal(hidden.selectedIds.has(chair.id), true);
  assert.equal(removeObjectOutlineTone(true), "blue");
  assert.equal(removeObjectOutlineColor("blue"), "#3d7eff");
  const restored = applyRemoveObjectClick(hidden, 750.2, 450.2);
  assert.equal(restored.selectedIds.has(chair.id), false);
  assert.equal(removeObjectOutlineTone(restored.selectedIds.has(chair.id)), "yellow");

  const allHidden = hideAllRemoveObjectUi(ready);
  assert.equal(allHidden.selectedIds.size, 10);
  assert.equal(allHidden.selectedIds.has(duplicate.suppressedId), false);
  const allShown = showAllRemoveObjectUi(allHidden);
  assert.equal(allShown.selectedIds.size, 0);
  assert.equal(showAllRemoveObjectUi(allShown), allShown);

  const boundary = removeObjectBoundaryPixels(chair.mask);
  const boundaryKeys = new Set(boundary.map((point) => `${point.x},${point.y}`));
  assert.equal(boundaryKeys.has("750,450"), false);
  assert.ok(boundary.length > 0);
  const edge = boundary[0];
  assert.ok(edge);
  if (!edge) return;
  assert.equal(removePackedBit(chair.mask, edge.x, edge.y), true);

  const injected = readyFrom(livePayload(true).payload);
  assert.equal(injected.objects.length, 10);
  assert.equal(injected.objects.some((item) => item.id === duplicate.suppressedId), false);
  assert.equal(highlightRemoveObject(injected, 750.2, 450.2), chair.id);
});

test("overlapping objects stay reversible and brush coverage stays separate", () => {
  const large = selectable("large", "sofa", 0.9, rectMask(8, 8, 0, 0, 6, 6));
  const small = selectable("small", "pillow", 0.8, rectMask(8, 8, 2, 2, 2, 2));
  const rejected = selectable("rejected", "lamp", 0.2, rectMask(8, 8, 2, 2, 2, 2), false);
  const left = selectable("left", "table", 0.7, rectMask(8, 1, 0, 0, 3, 1));
  const right = selectable("right", "table", 0.6, rectMask(8, 1, 2, 0, 3, 1));
  const nested: RemoveObjectUiState = {
    phase: "ready",
    identity: null,
    requestSerial: 4,
    objects: [large, small, rejected],
    selectedIds: new Set(),
    error: null,
    diagnostics: null,
  };
  const hidden = hideAllRemoveObjectUi(nested);
  assert.equal(hidden.selectedIds.has("rejected"), false);
  assert.equal(applyRemoveObjectClick(nested, 2.2, 2.2).selectedIds.has("rejected"), false);
  const peeled = applyRemoveObjectClick(hidden, 2.2, 2.2);
  assert.equal(peeled.selectedIds.has("small"), false);
  assert.equal(peeled.selectedIds.has("large"), true);
  const brush = new Uint8Array(64);
  brush[0] = 180;
  const union = new Uint8Array(64);
  const destination = new Uint8Array(64);
  assert.ok(syncRemoveInspectionCoverage({
    brush,
    objectUnion: union,
    destination,
    width: 8,
    height: 8,
    objects: nested.objects,
    selectedIds: peeled.selectedIds,
    bounds: { x: 0, y: 0, width: 8, height: 8 },
  }));
  assert.equal(brush[0], 180);
  assert.equal(destination[0], 255);
  assert.equal(destination[2 * 8 + 2], 255);
  const clearedBrush = new Uint8Array(64);
  assert.ok(syncRemoveInspectionCoverage({
    brush: clearedBrush,
    objectUnion: union,
    destination,
    width: 8,
    height: 8,
    objects: nested.objects,
    selectedIds: peeled.selectedIds,
    bounds: { x: 0, y: 0, width: 8, height: 8 },
  }));
  assert.equal(destination[0], 255);
  assert.equal(peeled.selectedIds.has("large"), true);

  const overlap: RemoveObjectUiState = {
    ...nested,
    objects: [left, right],
    selectedIds: new Set(["left", "right"]),
  };
  const overlapBrush = new Uint8Array(8);
  overlapBrush[6] = 200;
  const overlapDestination = new Uint8Array(8);
  assert.ok(syncRemoveInspectionCoverage({
    brush: overlapBrush,
    objectUnion: new Uint8Array(8),
    destination: overlapDestination,
    width: 8,
    height: 1,
    objects: overlap.objects,
    selectedIds: overlap.selectedIds,
    bounds: { x: 0, y: 0, width: 8, height: 1 },
  }));
  const withoutLeft = applyRemoveObjectClick(overlap, 0.2, 0.2);
  assert.equal(withoutLeft.selectedIds.has("left"), false);
  assert.equal(withoutLeft.selectedIds.has("right"), true);
  assert.ok(syncRemoveInspectionCoverage({
    brush: overlapBrush,
    objectUnion: new Uint8Array(8),
    destination: overlapDestination,
    width: 8,
    height: 1,
    objects: overlap.objects,
    selectedIds: withoutLeft.selectedIds,
    bounds: { x: 0, y: 0, width: 8, height: 1 },
  }));
  assert.equal(overlapBrush[6], 200);
  assert.equal(overlapDestination[0], 0);
  assert.equal(overlapDestination[2], 255);
  assert.equal(overlapDestination[4], 255);
  assert.equal(overlapDestination[6], 200);
});

test("failed, mismatched, stale, and repeated loads do not select or refetch", () => {
  const live = livePayload(false);
  const loading = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity: IDENTITY,
  });
  const failed = settleRemoveObjectLoad({
    state: loading.state,
    requestSerial: loading.state.requestSerial,
    identity: IDENTITY,
    payload: { usable: false, reason: "Segmentation provider is not configured." },
    elapsedMs: 20,
  });
  assert.equal(failed.phase, "error");
  assert.equal(failed.objects.length, 0);
  assert.equal(failed.selectedIds.size, 0);
  assert.equal(reduceRemoveObjectSession({
    state: failed,
    active: true,
    identity: IDENTITY,
  }).command, "none");
  assert.equal(applyRemoveObjectClick(failed, 750.2, 450.2), failed);

  const mismatched = settleRemoveObjectLoad({
    state: loading.state,
    requestSerial: loading.state.requestSerial,
    identity: IDENTITY,
    payload: {
      ...live.payload,
      roomId: "00000000-0000-4000-8000-000000000099",
    },
    elapsedMs: 20,
  });
  assert.equal(mismatched.phase, "error");
  assert.equal(mismatched.error, "Segmentation result did not match this room.");
  assert.equal(mismatched.objects.length, 0);

  const rle = readRemoveObjectUiPayload({
    ...live.payload,
    objects: [{
      id: "v1-chair-0-rle",
      concept: "chair",
      confidence: 0.8,
      mask: { width: 960, height: 640, counts: "abc", size: [640, 960] },
    }],
  }, IDENTITY);
  assert.equal(rle.ok, false);

  const offline = failRemoveObjectLoad({
    state: loading.state,
    requestSerial: loading.state.requestSerial,
    identity: IDENTITY,
  });
  assert.equal(offline.error, "Segmentation provider did not respond.");

  const ready = readyFrom(live.payload);
  const switched = reduceRemoveObjectSession({ state: ready, active: true, identity: IDENTITY });
  assert.equal(switched.command, "none");
  assert.equal(switched.state, ready);
  const hidden = hideAllRemoveObjectUi(ready);
  const exited = reduceRemoveObjectSession({ state: hidden, active: false, identity: null });
  assert.equal(exited.command, "abort");
  assert.equal(exited.state.phase, "idle");
  assert.equal(exited.state.selectedIds.size, 0);
  assert.equal(exited.state.objects.length, 0);
  const late = settleRemoveObjectLoad({
    state: exited.state,
    requestSerial: loading.state.requestSerial,
    identity: IDENTITY,
    payload: live.payload,
    elapsedMs: 20,
  });
  assert.equal(late.objects.length, 0);
  assert.equal(late.phase, "idle");

  const nextSession = { ...IDENTITY, sessionSerial: 2 };
  assert.equal(reduceRemoveObjectSession({
    state: ready,
    active: true,
    identity: nextSession,
  }).command, "fetch");
  assert.equal(formatRemoveObjectRejected([]), "0");
  assert.equal(formatRemoveObjectSuppressed([]), "0");
});

test("the segmentation request is one POST for the room and generation", async () => {
  let calls = 0;
  let body = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(String(input), "/api/vibode/admin/remove-objects");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({
      usable: false,
      reason: "Segmentation provider is not configured.",
    }), { status: 500 });
  };
  const result = await requestRemoveObjects({
    identity: IDENTITY,
    signal: new AbortController().signal,
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(body), {
    roomId: IDENTITY.roomId,
    generationId: IDENTITY.generationId,
  });
  assert.equal(body.includes(IDENTITY.originalSha256), false);
  const loading = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity: IDENTITY,
  });
  const settled = settleRemoveObjectLoad({
    state: loading.state,
    requestSerial: loading.state.requestSerial,
    identity: IDENTITY,
    payload: result.payload,
    elapsedMs: result.elapsedMs,
  });
  assert.equal(settled.phase, "error");
  assert.equal(reduceRemoveObjectSession({
    state: settled,
    active: true,
    identity: IDENTITY,
  }).command, "none");
});

test("outlines use the ORIGINAL frame and the capped backing store", () => {
  assert.deepEqual(removeInspectionBackingSize(100, 50, 3), { width: 200, height: 100 });
  assert.deepEqual(removeInspectionBackingSize(100, 50, 0), { width: 100, height: 50 });
  assert.equal(removeInspectionBackingSize(0, 50, 2), null);
  assert.deepEqual(mapOriginalBoxToBacking({
    box: { x: 648, y: 377, width: 202, height: 185 },
    originalWidth: 960,
    originalHeight: 640,
    backingWidth: 1920,
    backingHeight: 1280,
  }), { x: 1296, y: 754, width: 404, height: 370 });
  const single = rectMask(3, 3, 1, 1, 1, 1);
  assert.deepEqual(removeObjectBoundaryPixels(single), [{ x: 1, y: 1 }]);
});

function coverageCount(buffer: Uint8Array): number {
  let count = 0;
  for (const value of buffer) if (value > 0) count += 1;
  return count;
}

function diskCount(radius: number): number {
  let count = 0;
  const limit = radius * radius;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= limit) count += 1;
    }
  }
  return count;
}

function reveal(input: Readonly<{
  width: number;
  height: number;
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  brush?: Uint8Array;
  expansionPx?: number;
  bounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
  objectUnion?: Uint8Array;
  dilated?: Uint8Array;
  destination?: Uint8Array;
}>): Uint8Array {
  const pixels = input.width * input.height;
  const destination = input.destination ?? new Uint8Array(pixels);
  assert.ok(syncRemoveInspectionCoverage({
    brush: input.brush ?? new Uint8Array(pixels),
    objectUnion: input.objectUnion ?? new Uint8Array(pixels),
    dilated: input.dilated ?? new Uint8Array(pixels),
    destination,
    width: input.width,
    height: input.height,
    objects: input.objects,
    selectedIds: input.selectedIds,
    bounds: input.bounds ?? { x: 0, y: 0, width: input.width, height: input.height },
    expansionPx: input.expansionPx ?? 0,
  }));
  return destination;
}

test("mask expansion grows on a Euclidean disk and radius 0 stays exact", () => {
  assert.equal(REMOVE_OBJECT_EXPANSION_DEFAULT_PX, 4);
  assert.equal(REMOVE_OBJECT_EXPANSION_MAX_PX, 6);
  assert.equal(clampRemoveObjectExpansion(0), 0);
  assert.equal(clampRemoveObjectExpansion(6), 6);
  assert.equal(clampRemoveObjectExpansion(6.4), 6);
  assert.equal(clampRemoveObjectExpansion(7), 6);
  assert.equal(clampRemoveObjectExpansion(-2), 0);
  assert.equal(clampRemoveObjectExpansion(Number.NaN), 0);
  assert.equal(removeObjectExpansionIncludesOffset(1, 0, 1), true);
  assert.equal(removeObjectExpansionIncludesOffset(1, 1, 1), false);
  assert.equal(removeObjectExpansionIncludesOffset(1, 1, 2), true);
  assert.equal(removeObjectExpansionIncludesOffset(2, 1, 2), false);
  assert.equal(removeObjectExpansionIncludesOffset(4, 4, 6), true);
  assert.equal(removeObjectExpansionIncludesOffset(5, 4, 6), false);
  assert.deepEqual(
    expandRemoveDirtyRect({ x: 0, y: 0, width: 2, height: 2 }, 6, 5, 4),
    { x: 0, y: 0, width: 5, height: 4 },
  );
  assert.deepEqual(
    expandRemoveDirtyRect({ x: 3, y: 2, width: 2, height: 2 }, 1, 5, 4),
    { x: 2, y: 1, width: 3, height: 3 },
  );

  const width = 21;
  const height = 21;
  const center = rectMask(width, height, 10, 10, 1, 1);
  const object = selectable("point", "lamp", 0.8, center);
  const selected = new Set(["point"]);
  const sample = (radius: number) => reveal({
    width,
    height,
    objects: [object],
    selectedIds: selected,
    expansionPx: radius,
  });
  const at = (buffer: Uint8Array, x: number, y: number) => buffer[y * width + x];
  const exact = sample(0);
  const radius1 = sample(1);
  const radius2 = sample(2);
  const radius4 = sample(4);
  const radius6 = sample(6);
  assert.deepEqual(exact, sample(0));
  assert.deepEqual(radius1, sample(1));
  assert.deepEqual(radius2, sample(2));
  assert.deepEqual(radius4, sample(4));
  assert.deepEqual(radius6, sample(6));
  assert.equal(coverageCount(exact), 1);
  assert.equal(coverageCount(radius1), diskCount(1));
  assert.equal(coverageCount(radius2), diskCount(2));
  assert.equal(coverageCount(radius4), diskCount(4));
  assert.equal(coverageCount(radius6), diskCount(6));
  assert.equal(at(exact, 10, 10), 255);
  assert.equal(at(exact, 11, 10), 0);
  assert.equal(at(radius1, 11, 10), 255);
  assert.equal(at(radius1, 11, 11), 0);
  assert.equal(at(radius2, 11, 11), 255);
  assert.equal(at(radius2, 12, 10), 255);
  assert.equal(at(radius2, 12, 11), 0);
  assert.equal(at(radius4, 14, 10), 255);
  assert.equal(at(radius4, 13, 12), 255);
  assert.equal(at(radius4, 13, 13), 0);
  assert.equal(at(radius6, 16, 10), 255);
  assert.equal(at(radius6, 14, 14), 255);
  assert.equal(at(radius6, 15, 14), 0);
  assert.equal(at(radius6, 0, 0), 0);
  assert.ok(coverageCount(exact) < coverageCount(radius1));
  assert.ok(coverageCount(radius1) < coverageCount(radius2));
  assert.ok(coverageCount(radius2) < coverageCount(radius4));
  assert.ok(coverageCount(radius4) < coverageCount(radius6));

  const returned = reveal({
    width,
    height,
    objects: [object],
    selectedIds: selected,
    expansionPx: 0,
  });
  assert.deepEqual(returned, exact);
  const bits = center.bits.slice();
  assert.deepEqual(center.bits, bits);
});

test("expanded coverage stays inside the image and keeps thin structure", () => {
  const cornerMask = rectMask(4, 4, 0, 0, 1, 1);
  const cornerBits = cornerMask.bits.slice();
  const corner = selectable("corner", "table", 0.7, cornerMask);
  const cornerCoverage = reveal({
    width: 4,
    height: 4,
    objects: [corner],
    selectedIds: new Set(["corner"]),
    expansionPx: 6,
  });
  assert.equal(cornerCoverage.length, 16);
  assert.equal(coverageCount(cornerCoverage), 16);
  assert.deepEqual(cornerMask.bits, cornerBits);
  const clipped = reveal({
    width: 4,
    height: 4,
    objects: [corner],
    selectedIds: new Set(["corner"]),
    expansionPx: 1,
  });
  assert.equal(clipped[0], 255);
  assert.equal(clipped[1], 255);
  assert.equal(clipped[4], 255);
  assert.equal(clipped[5], 0);
  assert.equal(clipped[3], 0);

  const legWidth = 11;
  const legHeight = 15;
  const legMask = rectMask(legWidth, legHeight, 5, 4, 1, 7);
  const leg = selectable("leg", "table", 0.7, legMask);
  const narrow = reveal({
    width: legWidth,
    height: legHeight,
    objects: [leg],
    selectedIds: new Set(["leg"]),
    expansionPx: 2,
  });
  const legAt = (x: number, y: number) => narrow[y * legWidth + x];
  assert.equal(legAt(5, 4), 255);
  assert.equal(legAt(3, 4), 255);
  assert.equal(legAt(2, 4), 0);
  assert.equal(legAt(7, 4), 255);
  assert.equal(legAt(5, 2), 255);
  assert.equal(legAt(5, 1), 0);
  assert.equal(legAt(3, 2), 0);
  const plus = reveal({
    width: legWidth,
    height: legHeight,
    objects: [leg],
    selectedIds: new Set(["leg"]),
    expansionPx: 1,
  });
  assert.equal(plus[4 * legWidth + 6], 255);
  assert.equal(plus[3 * legWidth + 6], 0);

  const edgeMask = rectMask(8, 8, 0, 2, 1, 5);
  const edge = selectable("edge", "lamp", 0.6, edgeMask);
  const edgeCoverage = reveal({
    width: 8,
    height: 8,
    objects: [edge],
    selectedIds: new Set(["edge"]),
    expansionPx: 4,
  });
  assert.equal(edgeCoverage[2 * 8], 255);
  assert.equal(edgeCoverage[2 * 8 + 4], 255);
  assert.equal(edgeCoverage[2 * 8 + 5], 0);
  assert.equal(edgeCoverage[0], 255);
});

test("expanded objects stay reversible without changing brush or identity masks", () => {
  const width = 16;
  const height = 16;
  const maskA = rectMask(width, height, 5, 5, 1, 1);
  const maskB = rectMask(width, height, 8, 5, 1, 1);
  const bitsA = maskA.bits.slice();
  const bitsB = maskB.bits.slice();
  const boundaryA = removeObjectBoundaryPixels(maskA);
  const objects = [
    selectable("a", "chair", 0.8, maskA),
    selectable("b", "sofa", 0.7, maskB),
  ];
  const both = new Set(["a", "b"]);
  const brush = new Uint8Array(width * height);
  brush[1 * width + 1] = 200;
  brush[2 * width + 1] = 40;
  const objectUnion = new Uint8Array(width * height);
  const dilated = new Uint8Array(width * height);
  const destination = new Uint8Array(width * height);
  const painted = (expansionPx: number, selectedIds: ReadonlySet<string>, bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => reveal({
    width,
    height,
    objects,
    selectedIds,
    brush,
    expansionPx,
    bounds,
    objectUnion,
    dilated,
    destination,
  });
  const at = (x: number, y: number) => destination[y * width + x];

  painted(0, both);
  assert.equal(at(5, 5), 255);
  assert.equal(at(8, 5), 255);
  assert.equal(at(6, 5), 0);
  assert.equal(at(5, 2), 0);
  assert.equal(at(1, 1), 200);
  assert.equal(objectUnion[2 * width + 5], 0);

  painted(3, both);
  assert.equal(at(5, 2), 255);
  assert.equal(at(8, 8), 255);
  assert.equal(at(6, 5), 255);
  assert.equal(at(5, 5), 255);
  assert.equal(at(1, 1), 200);
  assert.equal(brush[1 * width + 1], 200);
  assert.equal(brush[2 * width + 1], 40);
  assert.equal(at(1, 2), 40);
  assert.equal(at(5, 2), 255);
  assert.equal(objectUnion[2 * width + 5], 0);
  assert.equal(objectUnion[5 * width + 5], 255);
  assert.deepEqual(maskA.bits, bitsA);
  assert.deepEqual(maskB.bits, bitsB);
  assert.deepEqual(removeObjectBoundaryPixels(maskA), boundaryA);

  const onlyB = new Set(["b"]);
  painted(3, onlyB);
  assert.equal(at(5, 2), 0);
  assert.equal(at(5, 5), 255);
  assert.equal(at(8, 5), 255);
  assert.equal(at(8, 8), 255);
  assert.equal(at(1, 1), 200);
  assert.equal(at(1, 2), 40);
  assert.equal(brush[2 * width + 1], 40);
  assert.deepEqual(maskA.bits, bitsA);

  painted(0, both);
  assert.equal(at(5, 2), 0);
  assert.equal(at(6, 5), 0);
  assert.equal(at(5, 5), 255);
  assert.equal(at(8, 5), 255);
  assert.equal(at(1, 1), 200);
  brush[14 * width] = 255;
  painted(6, both);
  assert.equal(at(0, 14), 255);
  assert.equal(at(1, 14), 0);
  assert.equal(at(0, 13), 0);
  assert.equal(brush[14 * width], 255);
  assert.equal(at(5, 2), 255);

  painted(3, both);
  brush[0] = 180;
  painted(3, both, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(destination[0], 180);
  assert.equal(brush[0], 180);
  assert.equal(at(8, 8), 255);
  assert.equal(at(5, 2), 255);
  assert.equal(dilateRemoveCoverage({
    source: objectUnion,
    destination: objectUnion,
    width,
    height,
    radiusPx: 3,
    bounds: { x: 0, y: 0, width, height },
  }), false);
  assert.equal(objectUnion[5 * width + 5], 255);
  assert.equal(syncRemoveInspectionCoverage({
    brush,
    objectUnion,
    destination,
    width,
    height,
    objects,
    selectedIds: both,
    bounds: { x: 0, y: 0, width, height },
    expansionPx: 3,
  }), null);

  const source = new Uint8Array(24 * 24);
  source[6 * 24 + 4] = 255;
  const sourceCopy = source.slice();
  const full = new Uint8Array(source.length);
  const tight = new Uint8Array(source.length);
  const frame = { x: 0, y: 0, width: 24, height: 24 };
  assert.equal(dilateRemoveCoverage({
    source,
    destination: full,
    width: 24,
    height: 24,
    radiusPx: 4,
    bounds: frame,
  }), true);
  assert.equal(dilateRemoveCoverage({
    source,
    destination: tight,
    width: 24,
    height: 24,
    radiusPx: 4,
    bounds: frame,
    sourceBounds: { x: 4, y: 6, width: 1, height: 1 },
  }), true);
  assert.deepEqual(full, tight);
  assert.deepEqual(source, sourceCopy);
});

test("a full ORIGINAL frame dilates from the mask bounds within one slider step", () => {
  const width = 960;
  const height = 640;
  const coverage = new Uint8Array(width * height);
  for (let y = 100; y < 180; y += 1) {
    coverage[y * width + 40] = 255;
    for (let x = 100; x < 300; x += 1) coverage[y * width + x] = 255;
  }
  const mask = packRemoveMask(coverage, width, height);
  assert.ok(mask);
  if (!mask) return;
  const bits = mask.bits.slice();
  const object = selectable("sofa", "sofa", 0.9, mask);
  const pixels = width * height;
  const brush = new Uint8Array(pixels);
  brush[10] = 175;
  const started = performance.now();
  const destination = reveal({
    width,
    height,
    objects: [object],
    selectedIds: new Set(["sofa"]),
    brush,
    expansionPx: 6,
  });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `dilation took ${elapsed.toFixed(1)}ms`);
  assert.equal(destination[140 * width + 299], 255);
  assert.equal(destination[140 * width + 305], 255);
  assert.equal(destination[140 * width + 306], 0);
  assert.equal(destination[183 * width + 303], 255);
  assert.equal(destination[184 * width + 304], 0);
  assert.equal(destination[140 * width + 34], 255);
  assert.equal(destination[140 * width + 33], 0);
  assert.equal(destination[96 * width + 36], 255);
  assert.equal(destination[94 * width + 35], 0);
  assert.equal(destination[10], 175);
  assert.equal(brush[10], 175);
  assert.deepEqual(mask.bits, bits);
  const exact = reveal({
    width,
    height,
    objects: [object],
    selectedIds: new Set(["sofa"]),
    brush,
    expansionPx: 0,
  });
  assert.equal(exact[140 * width + 299], 255);
  assert.equal(exact[140 * width + 300], 0);
  assert.equal(exact[140 * width + 40], 255);
  assert.equal(exact[10], 175);
});

test("hidden outlines keep selection and hit testing", () => {
  const hiddenOutline = removeObjectOutlineRender({
    outlinesVisible: false,
    hidden: true,
    hovered: true,
  });
  assert.deepEqual(hiddenOutline, {
    rendered: false,
    tone: null,
    color: null,
    emphasized: false,
  });
  assert.equal(removeObjectOutlineRender({
    outlinesVisible: false,
    hidden: false,
    hovered: true,
  }).rendered, false);
  const visible = removeObjectOutlineRender({
    outlinesVisible: true,
    hidden: false,
    hovered: true,
  });
  assert.equal(visible.rendered, true);
  assert.equal(visible.tone, "yellow");
  assert.equal(visible.color, "#f5c518");
  assert.equal(visible.emphasized, true);
  const hidden = removeObjectOutlineRender({
    outlinesVisible: true,
    hidden: true,
    hovered: false,
  });
  assert.equal(hidden.tone, "blue");
  assert.equal(hidden.color, "#3d7eff");
  assert.equal(hidden.emphasized, false);

  const ready = readyFrom(livePayload(false).payload);
  const chair = ready.objects.find((item) => item.concept === "chair");
  assert.ok(chair);
  if (!chair) return;
  const serial = ready.requestSerial;
  const selected = applyRemoveObjectClick(ready, 750.2, 450.2);
  assert.equal(selected.selectedIds.has(chair.id), true);
  assert.equal(selected.requestSerial, serial);
  assert.equal(highlightRemoveObject(selected, 750.2, 450.2), chair.id);
  assert.equal(reduceRemoveObjectSession({
    state: selected,
    active: true,
    identity: IDENTITY,
  }).command, "none");
  assert.equal(removeObjectOutlineRender({
    outlinesVisible: true,
    hidden: selected.selectedIds.has(chair.id),
    hovered: false,
  }).tone, "blue");
});

test("Objects mode wiring keeps segmentation off the brush and the scene", () => {
  const session = readFileSync(new URL("../../components/stage/RemoveAlignmentSession.tsx", import.meta.url), "utf8");
  const brush = readFileSync(new URL("../../components/stage/RemoveBrushCanvas.tsx", import.meta.url), "utf8");
  const outlines = readFileSync(new URL("../../components/stage/RemoveObjectOutlines.tsx", import.meta.url), "utf8");
  const viewport = readFileSync(new URL("../../components/afc-3d/AfcIntegratedEditorViewport.tsx", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("../../components/stage/StageFurnitureToolbar.tsx", import.meta.url), "utf8");
  assert.match(session, /Finding objects…/);
  assert.match(session, /Hide All/);
  assert.match(session, /Show All/);
  assert.match(session, /Done/);
  assert.match(session, /\[objectIdentity\]/);
  assert.match(session, /requestRemoveObjects/);
  assert.match(session, /reduceRemoveObjectSession/);
  assert.match(session, /controller\.abort\(\)/);
  assert.match(session, /type: "clear-mask"/);
  assert.match(session, /Mask Expansion/);
  assert.match(session, /Show Mask Outlines/);
  assert.match(session, /onObjectClick=\{\(point\) => session\.clickObject\(point\.x, point\.y\)\}/);
  assert.equal(session.match(/requestRemoveObjects\(/g)?.length, 1);
  assert.equal(session.match(/\}, \[objectIdentity\]\);/g)?.length, 1);
  const effectStart = session.indexOf("useEffect(() => {\n    const decision = reduceRemoveObjectSession");
  const effectEnd = session.indexOf("}, [objectIdentity]);", effectStart);
  const effect = session.slice(effectStart, effectEnd);
  assert.match(effect, /requestRemoveObjects/);
  assert.equal(effect.includes("objectExpansionPx"), false);
  assert.equal(effect.includes("objectOutlinesVisible"), false);
  assert.doesNotMatch(session, /remove-segmentation|retry|ROBOFLOW|api_key/i);
  assert.match(brush, /syncRemoveInspectionCoverage/);
  assert.match(brush, /expansionPx: expansionRef.current/);
  assert.match(brush, /paintRemoveBrush/);
  assert.match(brush, /watchRemoveDevicePixelRatio/);
  assert.match(outlines, /mapOriginalBoxToBacking/);
  assert.match(outlines, /removeObjectOutlineRender/);
  assert.match(outlines, /pointer-events-none/);
  assert.match(viewport, /mode === "objects"/);
  assert.match(toolbar, /mode === "objects"/);
});
