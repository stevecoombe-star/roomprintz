import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BRING_FORWARD_BACKGROUND_MESSAGE,
  assessBringForwardDisplay,
  bringForwardImageIdentity,
  bringForwardScanKey,
  bringForwardStatusMessage,
  readBringForwardBackgroundClaim,
  cancelBringForward,
  compositeBringForwardRgba,
  doneBringForward,
  emptyBringForwardEditor,
  enterBringForward,
  installBringForwardScan,
  loadBringForwardScan,
  readBringForwardScan,
  rememberBringForwardScan,
  resetBringForwardScansForTests,
  toggleBringForwardId,
  visibleBringForwardIds,
  type BringForwardImageIdentity,
  type BringForwardScan,
  type BringForwardSnapshot,
} from "./bring-forward-cutout";
import {
  initialRemoveObjectUiState,
  reduceRemoveObjectSession,
  reuseRemoveObjectScan,
  type RemoveObjectUiIdentity,
} from "./remove-object-ui";
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

function scan(objects: readonly RemoveObjectRecord[], conceptSet = "remove-segmentation-concepts/v2"): BringForwardScan {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    original: image(),
    vocabularyRevision: 0,
    conceptSet,
    objects,
    diagnostics: null,
  };
}

function identity(sessionSerial = 1, vocabularyRevision = 0): RemoveObjectUiIdentity {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: 4,
    originalHeight: 4,
    sessionSerial,
    vocabularyRevision,
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

test("compatible room backgrounds keep the original cutout and reject unknown images", () => {
  const snapshot: BringForwardSnapshot = {
    roomId: ROOM,
    generationId: GENERATION,
    original: image(),
    objects: [],
  };
  const source = image();
  const removed = image("cd".repeat(32));
  const cleaned = image("ef".repeat(32), 400, 401);
  const base = {
    snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    source,
    removeActive: false,
  };
  const remove = readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: {
      room_id: ROOM,
      image_url: "https://example.test/remove.png",
      metadata: {
        removeEditFingerprint: "12".repeat(32),
        sourceRoomId: ROOM,
        sourceAfcGenerationId: GENERATION,
        originalSha256: SHA.toUpperCase(),
      },
    },
  });
  const cleanup = readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: {
      room_id: ROOM,
      image_url: "https://example.test/cleanup.png",
      metadata: {
        cleanupJobId: "33333333-3333-4333-8333-333333333333",
        sourceRoomId: ROOM,
        sourceAfcGenerationId: GENERATION,
        originalSha256: SHA,
      },
    },
  });
  const history = readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: {
      room_id: ROOM,
      image_url: "https://example.test/history.png",
      metadata: {},
    },
  });
  assert.equal(remove?.kind, "remove");
  assert.equal(remove?.originalSha256, SHA);
  assert.equal(cleanup?.kind, "cleanup");
  assert.equal(history?.kind, "history");
  assert.equal(history?.generationId, GENERATION);
  assert.equal(assessBringForwardDisplay({ ...base, displayed: image(), background: null }), "show");
  assert.equal(assessBringForwardDisplay({ ...base, displayed: removed, background: remove }), "show");
  assert.equal(assessBringForwardDisplay({ ...base, displayed: cleaned, background: cleanup }), "show");
  assert.equal(assessBringForwardDisplay({ ...base, displayed: removed, background: history }), "show");
  assert.equal(assessBringForwardDisplay({ ...base, displayed: removed, background: null }), "hide");
  assert.equal(assessBringForwardDisplay({
    ...base,
    displayed: image("cd".repeat(32), 5, 4),
    background: history,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    ...base,
    displayed: removed,
    background: remove ? { ...remove, roomId: "other-room" } : null,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    ...base,
    displayed: removed,
    background: remove ? { ...remove, generationId: "other-generation" } : null,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    ...base,
    displayed: removed,
    source: image("cd".repeat(32)),
    background: remove,
  }), "hide");
  assert.equal(assessBringForwardDisplay({
    ...base,
    displayed: removed,
    background: remove ? { ...remove, originalSha256: "cd".repeat(32) } : null,
  }), "hide");
  assert.equal(readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: {
      room_id: "other-room",
      image_url: "https://example.test/remove.png",
      metadata: {
        removeEditFingerprint: "12".repeat(32),
        sourceAfcGenerationId: GENERATION,
        originalSha256: SHA,
      },
    },
  }), null);
  assert.equal(readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: {
      room_id: ROOM,
      image_url: "https://example.test/remove.png",
      metadata: {
        removeEditFingerprint: "12".repeat(32),
        sourceAfcGenerationId: "other-generation",
        originalSha256: SHA,
      },
    },
  }), null);
  assert.equal(readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: {
      room_id: ROOM,
      image_url: "https://example.test/history.png",
      metadata: { sourceAfcGenerationId: "other-generation" },
    },
  }), null);
  assert.equal(readBringForwardBackgroundClaim({
    roomId: ROOM,
    generationId: GENERATION,
    asset: { image_url: "https://example.test/external.png" },
  }), null);

  const chair = record("chair", mustPack(4, 4, (x, y) => x === 1 && y === 1));
  const originalPixels = rgba(4, 4, (x, y) => (x === 1 && y === 1 ? [10, 20, 30] : [1, 1, 1]));
  const cutout = compositeBringForwardRgba({
    rgba: originalPixels,
    width: 4,
    height: 4,
    objects: [chair],
    selectedIds: new Set(["chair"]),
  });
  assert.ok(cutout);
  assert.deepEqual(pixel(cutout, 4, 1, 1), [10, 20, 30, 255]);
  assert.equal(compositeBringForwardRgba({
    rgba: originalPixels,
    width: 4,
    height: 3,
    objects: [chair],
    selectedIds: new Set(["chair"]),
  }), null);
  assert.equal(bringForwardScanKey({
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: 4,
    originalHeight: 4,
    vocabularyRevision: 0,
  }), bringForwardScanKey({
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA.toUpperCase(),
    originalWidth: 4,
    originalHeight: 4,
    vocabularyRevision: 0,
  }));
  assert.equal(
    bringForwardStatusMessage({ display: "hide", scanReady: true, objectCount: 1, error: null }),
    BRING_FORWARD_BACKGROUND_MESSAGE,
  );
  assert.equal(BRING_FORWARD_BACKGROUND_MESSAGE, "Bring Forward isn't available for this room image.");
});

test("selection starts empty and done and cancel keep their own sets", () => {
  const chair = record("chair", mustPack(4, 4, (x, y) => x === 1 && y === 1));
  const lamp = record("lamp", mustPack(4, 4, (x, y) => x === 3 && y === 2));
  const installed = installBringForwardScan(emptyBringForwardEditor(), scan([chair, lamp]));
  assert.equal(installed.committedIds.size, 0);
  assert.equal(installed.draftIds.size, 0);
  assert.equal(installed.scan?.objects.length, 2);
  const editing = enterBringForward(installed);
  assert.equal(editing.draftIds.size, 0);
  const both = {
    ...editing,
    draftIds: toggleBringForwardId(toggleBringForwardId(editing.draftIds, "chair"), "lamp"),
  };
  assert.deepEqual([...both.draftIds].sort(), ["chair", "lamp"]);
  const removed = { ...both, draftIds: toggleBringForwardId(both.draftIds, "chair") };
  assert.deepEqual([...removed.draftIds], ["lamp"]);
  const committed = doneBringForward(removed);
  assert.equal(committed.editing, false);
  assert.deepEqual([...visibleBringForwardIds(committed)], ["lamp"]);
  const again = enterBringForward(committed);
  const draft = { ...again, draftIds: toggleBringForwardId(again.draftIds, "chair") };
  const cancelled = cancelBringForward(draft);
  assert.equal(cancelled.editing, false);
  assert.deepEqual([...visibleBringForwardIds(cancelled)], ["lamp"]);
  const otherRoom = installBringForwardScan(cancelled, {
    ...scan([chair]),
    roomId: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(otherRoom.committedIds.size, 0);
  const objects = [chair];
  const copied = installBringForwardScan(emptyBringForwardEditor(), scan(objects));
  objects.pop();
  assert.equal(copied.scan?.objects.length, 1);
});

test("a cached scan is shared across session serials and is not requested twice", async () => {
  resetBringForwardScansForTests();
  const chair = record("chair", mustPack(4, 4, (x) => x === 0));
  const key = bringForwardScanKey(identity(1));
  assert.equal(key, bringForwardScanKey(identity(2)));
  assert.notEqual(key, bringForwardScanKey(identity(1, 1)));
  rememberBringForwardScan(scan([chair]));
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ usable: false, reason: "unused" }), { status: 500 });
  };
  const first = await loadBringForwardScan({ identity: identity(1), fetchImpl });
  const second = await loadBringForwardScan({ identity: identity(4), fetchImpl });
  assert.equal(calls, 0);
  assert.equal(first?.objects[0]?.id, "chair");
  assert.equal(second, first);
  assert.equal(readBringForwardScan(key ?? ""), first);
  resetBringForwardScansForTests();
  let posts = 0;
  const failing: typeof fetch = async (input, init) => {
    posts += 1;
    assert.equal(String(input), "/api/vibode/admin/remove-objects");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({
      usable: false,
      reason: "Daily Remove detection limit reached.",
    }), { status: 429 });
  };
  const [left, right] = await Promise.all([
    loadBringForwardScan({ identity: identity(), fetchImpl: failing }),
    loadBringForwardScan({ identity: identity(), fetchImpl: failing }),
  ]);
  assert.equal(posts, 1);
  assert.equal(left, null);
  assert.equal(right, null);
  assert.equal(bringForwardStatusMessage({
    display: "show",
    scanReady: false,
    objectCount: 0,
    error: "Daily Remove detection limit reached.",
  }), "Daily Remove detection limit reached.");
  const loading = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity: identity(),
  }).state;
  const reused = reuseRemoveObjectScan({
    state: loading,
    requestSerial: loading.requestSerial,
    identity: identity(),
    objects: [chair],
    diagnostics: null,
  });
  assert.equal(reused.phase, "ready");
  assert.equal(reused.selectedIds.size, 0);
  assert.equal(reused.objects[0]?.id, "chair");
  resetBringForwardScansForTests();
});

test("the foreground canvas is mounted above the furniture frame without a second camera", () => {
  const viewer = readFileSync(new URL("../../components/afc-3d/AfcProductionRoomViewer.tsx", import.meta.url), "utf8");
  const layer = readFileSync(new URL("../../components/stage/BringForwardLayer.tsx", import.meta.url), "utf8");
  const selection = readFileSync(new URL("../../components/stage/BringForwardSelection.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../../components/stage/StageEditorHeader.tsx", import.meta.url), "utf8");
  const controls = readFileSync(new URL("../../components/stage/BringForwardSession.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/api/vibode/admin/remove-objects/route.ts", import.meta.url), "utf8");
  const cutout = readFileSync(new URL("./bring-forward-cutout.ts", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../../app/editor/page.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../components/stage/StageEditorShell.tsx", import.meta.url), "utf8");
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
  assert.match(selection, /hitTestRemoveObjects/);
  assert.match(selection, /mapRemovePointer/);
  assert.match(selection, /RemoveObjectOutlines/);
  assert.match(selection, /pointerEvents: "auto"/);
  assert.match(header, /<BringForwardControl \/>/);
  assert.match(controls, /aria-label="Bring Forward"/);
  assert.match(controls, /data-bring-forward="done"/);
  assert.match(controls, /data-bring-forward="cancel"/);
  assert.match(controls, /background: activeClaim/);
  assert.match(editor, /readBringForwardBackgroundClaim/);
  assert.match(shell, /background=\{bringForwardBackground\}/);
  assert.equal(cutout.match(/requestRemoveObjects\(/g)?.length, 1);
  const scanKey = cutout.slice(
    cutout.indexOf("export function bringForwardScanKey"),
    cutout.indexOf("export function bringForwardDisplayKey"),
  );
  assert.doesNotMatch(scanKey, /backgroundUrl|displayed/);
  const assess = cutout.slice(
    cutout.indexOf("export function assessBringForwardDisplay"),
    cutout.indexOf("export function readBringForwardBackgroundClaim"),
  );
  assert.doesNotMatch(assess, /requestRemoveObjects|loadBringForwardScan/);
  assert.match(route, /readRemoveActor/);
  assert.match(route, /reserveSegmentation/);
  assert.doesNotMatch(route, /bringForward|bring-forward/);
  assert.match(cutout, /unpackRemoveMask/);
  assert.doesNotMatch(cutout, /initialBringForwardSelection|resampleCoverageToOriginal|dilateRemoveCoverage|roboflow|WebGLRenderer/);
});
