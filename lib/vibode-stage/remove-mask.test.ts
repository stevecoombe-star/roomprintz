import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  acceptRemoveBrushBitmaps,
  applyRemoveCoverage,
  composeMaskCoverage,
  formatRemoveMaskedCoverage,
  initialRemoveStrokeState,
  mapOriginalRectToDisplay,
  mapRemovePointer,
  paintRemoveBrush,
  planRemoveMaskHold,
  reduceRemoveStroke,
  removeBrushAdmission,
  removeBrushCoverage,
  removeBrushScreenDiameter,
  removeBrushSegmentPoints,
  removeMaskedCoveragePercent,
  resampleCoverageToOriginal,
  type RemoveMaskHoldIdentity,
  type RemovePoint,
  type RemoveStrokeState,
} from "./remove-mask";

const IDENTITY = {
  sessionSerial: 4,
  roomId: "room-1",
  generationId: "22222222-2222-4222-8222-222222222222",
};

function paintAt(
  mask: Uint8Array,
  width: number,
  height: number,
  point: RemovePoint,
  tool: "reveal" | "restore",
  diameterPx: number,
  featherPx: number,
  from: RemovePoint | null = null,
) {
  return paintRemoveBrush({
    mask,
    width,
    height,
    from,
    to: point,
    diameterPx,
    featherPx,
    tool,
  });
}

test("coverage is idempotent, hard at feather 0, and smooth through a partial edge", () => {
  assert.equal(removeBrushCoverage(4, 10, 0), 255);
  assert.equal(removeBrushCoverage(10, 10, 0), 255);
  assert.equal(removeBrushCoverage(10.001, 10, 0), 0);
  assert.equal(removeBrushCoverage(6, 10, 4), 255);
  assert.equal(removeBrushCoverage(10, 10, 4), 0);
  assert.equal(removeBrushCoverage(5, 10, 10), 128);

  const width = 24;
  const height = 24;
  const center = { x: 12.5, y: 12.5 };
  const once = new Uint8Array(width * height);
  paintAt(once, width, height, center, "reveal", 21, 10);
  const twice = once.slice();
  paintAt(twice, width, height, center, "reveal", 21, 10);
  assert.deepEqual(twice, once);

  const core = once[12 * width + 12] ?? 0;
  assert.equal(core, 255);
  const edgeDistance = Math.hypot(18.5 - 12.5, 12.5 - 12.5);
  const edge = once[12 * width + 18] ?? 0;
  assert.equal(edge, removeBrushCoverage(edgeDistance, 10.5, 10));
  assert.ok(edge > 0 && edge < 255);
});

test("same-tool overlaps commute and do not add coverage", () => {
  const width = 32;
  const height = 16;
  const left = { x: 10.5, y: 8.5 };
  const right = { x: 16.5, y: 8.5 };
  const revealAB = new Uint8Array(width * height);
  const revealBA = new Uint8Array(width * height);
  const revealA = new Uint8Array(width * height);
  const revealB = new Uint8Array(width * height);
  paintAt(revealAB, width, height, left, "reveal", 12, 4);
  paintAt(revealAB, width, height, right, "reveal", 12, 4);
  paintAt(revealBA, width, height, right, "reveal", 12, 4);
  paintAt(revealBA, width, height, left, "reveal", 12, 4);
  paintAt(revealA, width, height, left, "reveal", 12, 4);
  paintAt(revealB, width, height, right, "reveal", 12, 4);
  assert.deepEqual(revealAB, revealBA);
  for (let index = 0; index < revealAB.length; index += 1) {
    assert.equal(revealAB[index], Math.max(revealA[index] ?? 0, revealB[index] ?? 0));
  }

  const restoreAB = new Uint8Array(width * height).fill(255);
  const restoreBA = new Uint8Array(width * height).fill(255);
  const restoreA = new Uint8Array(width * height).fill(255);
  const restoreB = new Uint8Array(width * height).fill(255);
  paintAt(restoreAB, width, height, left, "restore", 12, 4);
  paintAt(restoreAB, width, height, right, "restore", 12, 4);
  paintAt(restoreBA, width, height, right, "restore", 12, 4);
  paintAt(restoreBA, width, height, left, "restore", 12, 4);
  paintAt(restoreA, width, height, left, "restore", 12, 4);
  paintAt(restoreB, width, height, right, "restore", 12, 4);
  assert.deepEqual(restoreAB, restoreBA);
  for (let index = 0; index < restoreAB.length; index += 1) {
    assert.equal(restoreAB[index], Math.min(restoreA[index] ?? 0, restoreB[index] ?? 0));
  }
});

test("a later opposite tool does not replace a partial edge", () => {
  assert.equal(applyRemoveCoverage(200, 100, "restore"), 155);
  assert.notEqual(applyRemoveCoverage(200, 100, "restore"), 0);
  assert.equal(applyRemoveCoverage(155, 100, "reveal"), 155);

  const mask = Uint8Array.of(200);
  assert.equal(composeMaskCoverage(mask, Uint8Array.of(100), "restore"), true);
  assert.equal(mask[0], 155);
  assert.equal(composeMaskCoverage(mask, Uint8Array.of(100), "reveal"), true);
  assert.equal(mask[0], 155);
  assert.equal(composeMaskCoverage(mask, Uint8Array.of(0, 0), "reveal"), false);
  assert.equal(mask[0], 155);
});

test("feather 0 and the fully covered core restore exactly", () => {
  const width = 21;
  const height = 21;
  const center = { x: 10.5, y: 10.5 };
  const hard = new Uint8Array(width * height);
  paintAt(hard, width, height, center, "reveal", 11, 0);
  assert.equal(hard[10 * width + 10], 255);
  assert.equal(hard[10 * width + 16], 0);
  const outsideDistance = Math.hypot(16.5 - 10.5, 10.5 - 10.5);
  assert.ok(outsideDistance > 5.5);

  const restored = hard.slice();
  paintAt(restored, width, height, center, "restore", 11, 0);
  assert.equal(restored[10 * width + 10], 0);
  assert.equal(applyRemoveCoverage(255, 255, "restore"), 0);

  const filled = new Uint8Array(width * height).fill(255);
  paintAt(filled, width, height, center, "restore", 11, 6);
  assert.equal(filled[10 * width + 10], 0);
  const partialDistance = Math.hypot(14.5 - 10.5, 10.5 - 10.5);
  const partial = filled[10 * width + 14] ?? 255;
  assert.equal(partial, 255 - removeBrushCoverage(partialDistance, 5.5, 5));
  assert.ok(partial > 0 && partial < 255);
  assert.equal(filled[10 * width + 20], 255);
});

test("segment interpolation fills a fast stroke and a null origin does not bridge a gap", () => {
  const points = removeBrushSegmentPoints({ x: 0.5, y: 2.5 }, { x: 10.5, y: 2.5 }, 8);
  assert.equal(points.length, 10);
  assert.equal(points[0]?.x, 1.5);
  assert.equal(points[9]?.x, 10.5);
  assert.deepEqual(removeBrushSegmentPoints(null, { x: 15.5, y: 2.5 }, 8), [{ x: 15.5, y: 2.5 }]);

  const width = 24;
  const height = 5;
  const mask = new Uint8Array(width * height);
  paintRemoveBrush({
    mask,
    width,
    height,
    from: { x: 1.5, y: 2.5 },
    to: { x: 18.5, y: 2.5 },
    diameterPx: 3,
    featherPx: 0,
    tool: "reveal",
  });
  assert.equal(mask[2 * width + 8], 255);
  const reentry = new Uint8Array(width * height);
  paintAt(reentry, width, height, { x: 1.5, y: 2.5 }, "reveal", 3, 0);
  paintAt(reentry, width, height, { x: 18.5, y: 2.5 }, "reveal", 3, 0);
  assert.equal(reentry[2 * width + 1], 255);
  assert.equal(reentry[2 * width + 18], 255);
  assert.equal(reentry[2 * width + 8], 0);
});

test("pointer mapping follows the certified CSS frame and ignores pixel ratio", () => {
  const original = { originalWidth: 1200, originalHeight: 800 };
  assert.deepEqual(mapRemovePointer({
    clientX: 250,
    clientY: 150,
    rect: { left: 100, top: 50, width: 300, height: 200 },
    ...original,
  }), { status: "inside", x: 600, y: 400 });
  assert.deepEqual(mapRemovePointer({
    clientX: 400,
    clientY: 200,
    rect: { left: 100, top: 0, width: 600, height: 400 },
    ...original,
  }), { status: "inside", x: 600, y: 400 });
  assert.equal(mapRemovePointer.toString().includes("devicePixelRatio"), false);
  assert.equal(mapRemovePointer.toString().includes("backingStore"), false);
  assert.deepEqual(mapRemovePointer({
    clientX: 10,
    clientY: 150,
    rect: { left: 50, top: 50, width: 300, height: 200 },
    ...original,
  }), { status: "outside" });
  assert.deepEqual(mapRemovePointer({
    clientX: 350,
    clientY: 150,
    rect: { left: 50, top: 50, width: 300, height: 200 },
    ...original,
  }), { status: "inside", x: 1200, y: 400 });
  assert.deepEqual(mapRemovePointer({
    clientX: 350.1,
    clientY: 150,
    rect: { left: 50, top: 50, width: 300, height: 200 },
    ...original,
  }), { status: "outside" });
  assert.deepEqual(mapRemovePointer({
    clientX: 10,
    clientY: 10,
    rect: { left: 0, top: 0, width: 0, height: 100 },
    ...original,
  }), { status: "unavailable" });
  assert.equal(removeBrushScreenDiameter({
    diameterPx: 64,
    frameWidth: 300,
    originalWidth: 1200,
  }), 16);
  assert.deepEqual(mapOriginalRectToDisplay({
    dirty: { x: 0, y: 0, width: 1200, height: 800 },
    maskWidth: 1200,
    maskHeight: 800,
    displayWidth: 600,
    displayHeight: 400,
    pad: 1,
  }), { x: 0, y: 0, width: 600, height: 400 });
});

test("captured strokes keep capture outside the frame and do not bridge the excursion", () => {
  let state: RemoveStrokeState = initialRemoveStrokeState();
  const down = reduceRemoveStroke(state, {
    type: "down",
    pointerId: 7,
    primary: true,
    button: 0,
    location: { status: "inside", x: 1.5, y: 2.5 },
  });
  state = down.state;
  assert.equal(down.effect.capturePointerId, 7);
  assert.deepEqual(down.effect.paint, { from: null, to: { x: 1.5, y: 2.5 } });

  const ignored = reduceRemoveStroke(state, {
    type: "down",
    pointerId: 8,
    primary: true,
    button: 0,
    location: { status: "inside", x: 3, y: 3 },
  });
  assert.equal(ignored.state.pointerId, 7);
  assert.equal(ignored.effect.capturePointerId, null);

  const outside = reduceRemoveStroke(state, {
    type: "move",
    pointerId: 7,
    location: { status: "outside" },
  });
  state = outside.state;
  assert.equal(state.phase, "active");
  assert.equal(state.lastInside, null);
  assert.equal(outside.effect.paint, null);
  assert.equal(outside.effect.releasePointerId, null);

  const reentry = reduceRemoveStroke(state, {
    type: "move",
    pointerId: 7,
    location: { status: "inside", x: 18.5, y: 2.5 },
  });
  state = reentry.state;
  assert.deepEqual(reentry.effect.paint, { from: null, to: { x: 18.5, y: 2.5 } });

  const width = 24;
  const height = 5;
  const mask = new Uint8Array(width * height);
  for (const paint of [down.effect.paint, reentry.effect.paint]) {
    if (!paint) continue;
    paintRemoveBrush({
      mask,
      width,
      height,
      from: paint.from,
      to: paint.to,
      diameterPx: 3,
      featherPx: 0,
      tool: "reveal",
    });
  }
  assert.equal(mask[2 * width + 1], 255);
  assert.equal(mask[2 * width + 18], 255);
  assert.equal(mask[2 * width + 8], 0);

  const upOutside = reduceRemoveStroke(state, {
    type: "move",
    pointerId: 7,
    location: { status: "outside" },
  });
  const released = reduceRemoveStroke(upOutside.state, {
    type: "up",
    pointerId: 7,
    location: { status: "outside" },
  });
  assert.equal(released.state.phase, "idle");
  assert.equal(released.effect.releasePointerId, 7);
  assert.equal(released.effect.paint, null);
});

test("cancel, lost capture, a missing rectangle, and end release without painting", () => {
  const active = reduceRemoveStroke(initialRemoveStrokeState(), {
    type: "down",
    pointerId: 3,
    primary: true,
    button: 0,
    location: { status: "inside", x: 4, y: 4 },
  }).state;
  const cancel = reduceRemoveStroke(active, { type: "cancel", pointerId: 3 });
  assert.equal(cancel.state.phase, "idle");
  assert.equal(cancel.effect.releasePointerId, 3);
  assert.equal(cancel.effect.paint, null);

  const lost = reduceRemoveStroke(active, { type: "lostcapture", pointerId: 3 });
  assert.equal(lost.effect.releasePointerId, 3);
  assert.equal(lost.effect.paint, null);
  assert.equal(reduceRemoveStroke(lost.state, { type: "lostcapture", pointerId: 3 }).effect.releasePointerId, null);

  const missing = reduceRemoveStroke(active, { type: "unavailable", pointerId: 3 });
  assert.equal(missing.state.phase, "idle");
  assert.equal(missing.effect.paint, null);

  const ended = reduceRemoveStroke(active, { type: "end" });
  assert.equal(ended.effect.releasePointerId, 3);
  assert.equal(ended.effect.paint, null);
  assert.equal(reduceRemoveStroke(initialRemoveStrokeState(), {
    type: "down",
    pointerId: 1,
    primary: false,
    button: 0,
    location: { status: "inside", x: 1, y: 1 },
  }).state.phase, "idle");
});

test("bitmap identity rejects stale sessions and dimension mismatches before a mask plan", () => {
  const size = { width: 1200, height: 800 };
  const accepted = acceptRemoveBrushBitmaps({
    requested: IDENTITY,
    current: IDENTITY,
    active: true,
    original: size,
    empty: size,
    expectedOriginal: size,
    expectedEmpty: size,
  });
  assert.deepEqual(accepted, { accept: true });
  const next = { ...IDENTITY, width: 1200, height: 800, epoch: 2 };
  const existing: RemoveMaskHoldIdentity = { ...next, epoch: 2 };
  assert.equal(planRemoveMaskHold({
    disposition: accepted,
    existing,
    next,
  }), "keep");
  assert.equal(planRemoveMaskHold({
    disposition: accepted,
    existing,
    next: { ...next, epoch: 3 },
  }), "reset");
  assert.equal(planRemoveMaskHold({
    disposition: accepted,
    existing: null,
    next,
  }), "allocate");

  const staleGeneration = acceptRemoveBrushBitmaps({
    requested: IDENTITY,
    current: { ...IDENTITY, generationId: "33333333-3333-4333-8333-333333333333" },
    active: true,
    original: size,
    empty: size,
    expectedOriginal: size,
    expectedEmpty: size,
  });
  assert.deepEqual(staleGeneration, { accept: false, reason: "stale" });
  const staleRoom = acceptRemoveBrushBitmaps({
    requested: IDENTITY,
    current: { ...IDENTITY, roomId: "room-2" },
    active: true,
    original: size,
    empty: size,
    expectedOriginal: size,
    expectedEmpty: size,
  });
  assert.equal(staleRoom.accept, false);
  if (!staleRoom.accept) assert.equal(staleRoom.reason, "stale");
  const inactive = acceptRemoveBrushBitmaps({
    requested: IDENTITY,
    current: IDENTITY,
    active: false,
    original: size,
    empty: size,
    expectedOriginal: size,
    expectedEmpty: size,
  });
  assert.equal(inactive.accept, false);
  if (!inactive.accept) assert.equal(inactive.reason, "stale");
  assert.equal(planRemoveMaskHold({
    disposition: staleGeneration,
    existing,
    next,
  }), "ignore");
  assert.equal(planRemoveMaskHold({
    disposition: inactive,
    existing,
    next: { ...next, sessionSerial: 99 },
  }), "ignore");

  const mismatched = acceptRemoveBrushBitmaps({
    requested: IDENTITY,
    current: IDENTITY,
    active: true,
    original: { width: 600, height: 400 },
    empty: size,
    expectedOriginal: size,
    expectedEmpty: size,
  });
  assert.deepEqual(mismatched, { accept: false, reason: "dimensions" });
  assert.equal(planRemoveMaskHold({
    disposition: mismatched,
    existing,
    next,
  }), "ignore");
});

test("brush admission and an external mask share the ORIGINAL coverage grid", () => {
  assert.deepEqual(removeBrushAdmission({
    gridCompatibility: "exact_grid_compatible",
    originalDisagreement: null,
    emptyDisagreement: null,
  }), { allowed: true, aspectRescaling: false });
  assert.deepEqual(removeBrushAdmission({
    gridCompatibility: "aspect_compatible_rescaled",
    originalDisagreement: null,
    emptyDisagreement: null,
  }), { allowed: true, aspectRescaling: true });
  assert.equal(removeBrushAdmission({
    gridCompatibility: "incompatible",
    originalDisagreement: null,
    emptyDisagreement: null,
  }).allowed, false);
  assert.equal(removeBrushAdmission({
    gridCompatibility: "exact_grid_compatible",
    originalDisagreement: "Displayed 1×1 differs from certified 2×2.",
    emptyDisagreement: null,
  }).allowed, false);

  const binary = resampleCoverageToOriginal({
    source: Uint8Array.of(0, 255),
    sourceWidth: 2,
    sourceHeight: 1,
    originalWidth: 4,
    originalHeight: 1,
    filter: "nearest",
  });
  assert.deepEqual(binary, Uint8Array.of(0, 0, 255, 255));
  const soft = resampleCoverageToOriginal({
    source: Uint8Array.of(0, 255),
    sourceWidth: 2,
    sourceHeight: 1,
    originalWidth: 1,
    originalHeight: 1,
    filter: "bilinear",
  });
  assert.deepEqual(soft, Uint8Array.of(128));
  const mask = new Uint8Array(4);
  assert.equal(binary !== null && composeMaskCoverage(mask, binary, "reveal"), true);
  assert.deepEqual(mask, Uint8Array.of(0, 0, 255, 255));
  assert.equal(formatRemoveMaskedCoverage(removeMaskedCoveragePercent(mask)), "50.00%");
  assert.equal(formatRemoveMaskedCoverage(removeMaskedCoveragePercent(new Uint8Array())), "0.00%");
});

test("protected reveal skips identity pixels and restore stays open", () => {
  const width = 8;
  const height = 1;
  const protection = new Uint8Array(width);
  protection[3] = 255;
  const mask = new Uint8Array(width);
  mask[3] = 90;
  const dirty = paintRemoveBrush({
    mask,
    width,
    height,
    from: { x: 0.5, y: 0.5 },
    to: { x: 6.5, y: 0.5 },
    diameterPx: 1,
    featherPx: 0,
    tool: "reveal",
    protection,
  });
  assert.ok(dirty);
  assert.equal(mask[1], 255);
  assert.equal(mask[2], 255);
  assert.equal(mask[3], 90);
  assert.equal(mask[4], 255);
  assert.equal(mask[5], 255);
  assert.equal(mask[6], 255);
  const kept = mask.slice();
  paintRemoveBrush({
    mask,
    width,
    height,
    from: null,
    to: { x: 3.5, y: 0.5 },
    diameterPx: 1,
    featherPx: 0,
    tool: "reveal",
    protection,
  });
  assert.deepEqual(mask, kept);

  const open = new Uint8Array(width);
  paintRemoveBrush({
    mask: open,
    width,
    height,
    from: null,
    to: { x: 3.5, y: 0.5 },
    diameterPx: 1,
    featherPx: 0,
    tool: "reveal",
  });
  assert.equal(open[3], 255);

  paintRemoveBrush({
    mask,
    width,
    height,
    from: null,
    to: { x: 3.5, y: 0.5 },
    diameterPx: 1,
    featherPx: 0,
    tool: "restore",
    protection,
  });
  assert.equal(mask[3], 0);
  assert.equal(mask[1], 255);
});

test("brush compositing stays off the History image and the WebGL scene", () => {
  const brush = readFileSync(new URL("../../components/stage/RemoveBrushCanvas.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../../components/stage/RemoveAlignmentSession.tsx", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../../components/afc-3d/AfcProductionRoomViewer.tsx", import.meta.url), "utf8");
  const integrated = readFileSync(new URL("../../components/afc-3d/AfcIntegratedEditorViewport.tsx", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("../../components/stage/StageFurnitureToolbar.tsx", import.meta.url), "utf8");

  assert.match(brush, /acceptRemoveBrushBitmaps/);
  assert.match(brush, /planRemoveMaskHold/);
  assert.match(brush, /removeAlignmentArtifactPath/);
  assert.match(brush, /setPointerCapture/);
  assert.match(brush, /lostpointercapture/);
  assert.match(brush, /pointercancel/);
  assert.match(brush, /releasePointerCapture/);
  assert.match(brush, /type: "end"/);
  assert.match(brush, /destination-in/);
  assert.match(brush, /\.close\(\)/);
  assert.doesNotMatch(brush, /<img|visualImageUrl|originalImageUrl|WebGLRenderer|querySelector\("img"\)/);
  assert.match(session, /data-remove-mode=/);
  assert.match(integrated, /scenePointerEvents=\{/);
  assert.match(viewer, /scenePointerEventsRef\.current === "none" \? "none" : "auto"/);
  assert.match(toolbar, /data-remove-brush-pointer=/);
  assert.match(toolbar, /\[&_\*\]:pointer-events-none/);
  const capture = viewer.slice(
    viewer.indexOf("harmonizeCaptureRef.current ="),
    viewer.indexOf("animate();"),
  );
  assert.doesNotMatch(capture, /RemoveBrush|maskHold|destination-in/);
  assert.match(viewer, /querySelector\("img"\)/);
  assert.match(viewer, /backgroundUrl: displayedHarmonizeBackgroundUrl/);
  const historyImage = viewer.indexOf("src={visualImageUrl}");
  const overlay = viewer.indexOf("{inspectionOverlay}", historyImage);
  const webglMount = viewer.indexOf("ref={mountRef}", overlay);
  assert.ok(historyImage >= 0 && overlay > historyImage && webglMount > overlay);
});
