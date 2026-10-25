import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  REMOVE_SEGMENTATION_CONCEPT_SET,
  REMOVE_SEGMENTATION_MODEL_ID,
  REMOVE_SEGMENTATION_PROVIDER_ID,
  ROBOFLOW_SAM3_POLYGON_SCHEMA,
} from "@/lib/vibode-stage/remove-segmentation";
import {
  REMOVE_CLEANUP_CONCEPT_SET,
  REMOVE_CLEANUP_COORDINATE_BASIS,
  REMOVE_CLEANUP_EXCLUSION_COPY,
  REMOVE_CLEANUP_EXPORT_PATH,
  REMOVE_CLEANUP_FILL_OPACITY,
  REMOVE_CLEANUP_MAGENTA,
  REMOVE_CLEANUP_MODEL_ID,
  REMOVE_CLEANUP_PROMPT_VERSION,
  REMOVE_CLEANUP_PROVIDER_ID,
  REMOVE_CLEANUP_REFERENCE_EXPANSION_PX,
  REMOVE_CLEANUP_SCHEMA,
  beginRemoveCleanupDownload,
  blendRemoveCleanupRgb,
  buildRemoveCleanupExportBody,
  finishRemoveCleanupExport,
  hiddenRemoveCleanupObjects,
  initialRemoveCleanupUiState,
  mixRemoveCleanupChannel,
  openRemoveCleanupConfirmation,
  removeCleanupConfirmationSummary,
  removeCleanupExportAvailability,
  removeCleanupObjectPhrase,
  renderRemoveCleanupPrompt,
  requestRemoveCleanupExport,
  sameRemoveCleanupFlight,
  snapshotRemoveCleanupObjects,
} from "@/lib/vibode-stage/remove-cleanup-contract";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function pack(width: number, height: number, indexes: readonly number[]): Uint8Array {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (const index of indexes) bits[index >> 3] |= 1 << (index & 7);
  return bits;
}

function rgb(width: number, height: number, red: number, green: number, blue: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    bytes[pixel * 3] = red;
    bytes[pixel * 3 + 1] = green;
    bytes[pixel * 3 + 2] = blue;
  }
  return bytes;
}

test("cleanup vocabulary matches the SAM 3 contract without importing it into the browser module", () => {
  assert.equal(REMOVE_CLEANUP_PROVIDER_ID, REMOVE_SEGMENTATION_PROVIDER_ID);
  assert.equal(REMOVE_CLEANUP_MODEL_ID, REMOVE_SEGMENTATION_MODEL_ID);
  assert.equal(REMOVE_CLEANUP_CONCEPT_SET, REMOVE_SEGMENTATION_CONCEPT_SET);
  assert.equal(REMOVE_CLEANUP_SCHEMA, ROBOFLOW_SAM3_POLYGON_SCHEMA);
  assert.equal(REMOVE_CLEANUP_COORDINATE_BASIS, "original-decoded-pixels-v1");
  assert.equal(REMOVE_CLEANUP_REFERENCE_EXPANSION_PX, 0);
  assert.equal(REMOVE_CLEANUP_FILL_OPACITY, 0.45);
  assert.equal(REMOVE_CLEANUP_PROMPT_VERSION, "remove-cleanup-prompt/v1");
  const contract = source("lib/vibode-stage/remove-cleanup-contract.ts");
  assert.equal(contract.includes("node:crypto"), false);
  assert.equal(contract.includes('from "@/lib/vibode-stage/remove-segmentation"'), false);
});

test("spatial phrases use concept text and image thirds only", () => {
  assert.equal(removeCleanupObjectPhrase({
    concept: "table",
    bounds: { x: 30, y: 30, width: 30, height: 30 },
    width: 90,
    height: 90,
  }), "table near the centre of the photograph");
  assert.equal(removeCleanupObjectPhrase({
    concept: "sofa",
    bounds: { x: 0, y: 30, width: 10, height: 30 },
    width: 90,
    height: 90,
  }), "sofa on the left side of the photograph");
  assert.equal(removeCleanupObjectPhrase({
    concept: "lamp",
    bounds: { x: 70, y: 70, width: 10, height: 10 },
    width: 90,
    height: 90,
  }), "lamp in the lower-right of the photograph");
  const prompt = renderRemoveCleanupPrompt([
    "table near the centre of the photograph",
  ]);
  assert.equal(prompt, [
    "Image 1 is the authoritative original room photograph. Image 2 is the same photograph with the objects to remove highlighted in bright magenta.",
    "",
    "Remove only the magenta-highlighted objects from Image 1. Naturally reconstruct the rug, flooring, walls and other background surfaces behind them so the room looks as if those objects had never been there.",
    "",
    "Preserve every unhighlighted piece of furniture and décor. Preserve the original architecture, walls, windows, doors, trim, floor, ceiling, materials, lighting, camera framing and perspective. Do not move, replace, restyle, redesign or add objects.",
    "",
    "The highlighted objects are: table near the centre of the photograph.",
    "",
    "If the descriptive text and magenta highlights disagree, follow the magenta highlights.",
    "",
    "Return one realistic photograph of the same room, without magenta markings, outlines, labels or other annotations.",
    "",
  ].join("\n"));
  assert.equal(prompt.includes("colour"), false);
  assert.equal(prompt.includes("wood"), false);
  assert.equal(prompt.includes("wall behind"), false);
});

test("magenta blend keeps unselected pixels and does not dilate", () => {
  assert.equal(mixRemoveCleanupChannel(10, 255), 120);
  assert.equal(mixRemoveCleanupChannel(20, 0), 11);
  assert.equal(mixRemoveCleanupChannel(30, 255), 131);
  const width = 4;
  const height = 2;
  const source = rgb(width, height, 10, 20, 30);
  const edge = pack(width, height, [0, width * height - 1]);
  const thin = pack(width, height, [3]);
  const overlap = pack(width, height, [0, 3]);
  const beforeEdge = Uint8Array.from(edge);
  const beforeThin = Uint8Array.from(thin);
  const beforeOverlap = Uint8Array.from(overlap);
  const blended = blendRemoveCleanupRgb({
    rgb: source,
    width,
    height,
    masks: [edge, thin, overlap],
  });
  assert.ok(blended);
  if (!blended) return;
  assert.equal(blended.overlay.length, source.length);
  assert.equal(blended.unionPixels, 3);
  assert.deepEqual(edge, beforeEdge);
  assert.deepEqual(thin, beforeThin);
  assert.deepEqual(overlap, beforeOverlap);
  const selected = new Set([0, 3, width * height - 1]);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 3;
    if (!selected.has(pixel)) {
      assert.equal(blended.overlay[offset], 10);
      assert.equal(blended.overlay[offset + 1], 20);
      assert.equal(blended.overlay[offset + 2], 30);
      assert.equal(blended.diagnostic[offset], 0);
      continue;
    }
    assert.equal(blended.overlay[offset], REMOVE_CLEANUP_MAGENTA.red === 255
      ? mixRemoveCleanupChannel(10, 255)
      : -1);
    assert.equal(blended.overlay[offset], 120);
    assert.equal(blended.overlay[offset + 1], 11);
    assert.equal(blended.overlay[offset + 2], 131);
    assert.equal(blended.diagnostic[offset], 255);
    assert.equal(blended.diagnostic[offset + 1], 255);
    assert.equal(blended.diagnostic[offset + 2], 255);
  }
  assert.equal(blended.overlay[1 * 3], 10);
  assert.equal(blended.overlay[2 * 3], 10);
  assert.equal(blended.overlay[4 * 3], 10);
});

test("cleanup confirmation snapshots hidden masks and ignores a stale completion", () => {
  const tableBits = Uint8Array.from([0b0000_0010]);
  const hidden = hiddenRemoveCleanupObjects([
    {
      id: "v1-sofa-0-aaaaaaaa",
      concept: "sofa",
      confidence: 0.8,
      eligibility: { eligible: true },
      mask: { width: 2, height: 2, bits: Uint8Array.from([0b0000_0101]) },
    },
    {
      id: "v1-table-0-bbbbbbbb",
      concept: "table",
      confidence: 0.9,
      eligibility: { eligible: true },
      mask: { width: 2, height: 2, bits: tableBits },
    },
    {
      id: "v1-rug-0-cccccccc",
      concept: "rug",
      confidence: 0.7,
      eligibility: { eligible: false },
      mask: { width: 2, height: 2, bits: Uint8Array.from([0b0000_1000]) },
    },
  ], new Set(["v1-table-0-bbbbbbbb", "v1-rug-0-cccccccc"]));
  assert.deepEqual(hidden.map((object) => object.id), ["v1-table-0-bbbbbbbb"]);
  const snapshot = snapshotRemoveCleanupObjects(hidden);
  tableBits[0] = 0;
  assert.equal(snapshot[0]?.bits[0], 0b0000_0010);
  assert.equal(removeCleanupExportAvailability({
    segmentationPhase: "loading",
    hiddenCount: 1,
    exporting: false,
  }), false);
  assert.equal(removeCleanupExportAvailability({
    segmentationPhase: "ready",
    hiddenCount: 0,
    exporting: false,
  }), false);
  assert.equal(removeCleanupExportAvailability({
    segmentationPhase: "ready",
    hiddenCount: 1,
    exporting: true,
  }), false);
  assert.equal(removeCleanupConfirmationSummary(snapshot), "Export 1 hidden object: table.");
  assert.equal(
    REMOVE_CLEANUP_EXCLUSION_COPY,
    "Only objects hidden in Objects mode are included. Brush edits are not included.",
  );
  const confirming = openRemoveCleanupConfirmation(initialRemoveCleanupUiState(), true);
  const first = beginRemoveCleanupDownload({ state: confirming, claimed: false });
  const second = beginRemoveCleanupDownload({ state: first.state, claimed: first.claimed });
  assert.equal(first.begin, true);
  assert.equal(second.begin, false);
  const selected = new Set(["v1-table-0-bbbbbbbb"]);
  const failed = finishRemoveCleanupExport(first.state, first.state.flightId, {
    ok: false,
    reason: "Clean Up export failed.",
  });
  assert.equal(failed.phase, "idle");
  assert.equal(failed.error, "Clean Up export failed.");
  assert.equal(selected.has("v1-table-0-bbbbbbbb"), true);
  const reset = initialRemoveCleanupUiState();
  assert.equal(finishRemoveCleanupExport(reset, first.state.flightId, {
    ok: false,
    reason: "stale",
  }), reset);
  const flight = {
    roomId: "room",
    generationId: "generation",
    sessionSerial: 1,
    requestSerial: 2,
  };
  assert.equal(sameRemoveCleanupFlight(flight, { ...flight, generationId: "other" }), false);
  assert.equal(sameRemoveCleanupFlight(flight, { ...flight, sessionSerial: 3 }), false);
  assert.equal(sameRemoveCleanupFlight(flight, null), false);
});

test("cleanup request body excludes brush state and calls only the cleanup route", async () => {
  const bits = Uint8Array.from([1, 0]);
  const body = JSON.parse(await buildRemoveCleanupExportBody({
    roomId: "11111111-1111-4111-8111-111111111111",
    generationId: "22222222-2222-4222-8222-222222222222",
    originalSha256: "ab".repeat(32),
    originalDecodedWidth: 8,
    originalDecodedHeight: 8,
    objects: [{
      id: "v1-table-0-aaaaaaaa",
      concept: "table",
      confidence: 0.93,
      width: 8,
      height: 8,
      bits,
    }],
  })) as Record<string, unknown>;
  assert.equal(body.referenceExpansionPx, 0);
  assert.equal(Object.hasOwn(body, "brushCoverage"), false);
  assert.equal(Object.hasOwn(body, "brushReveal"), false);
  assert.equal(Object.hasOwn(body, "objectExpansionPx"), false);
  assert.equal(Object.hasOwn(body, "storagePath"), false);
  assert.equal(Object.hasOwn(body, "imageUrl"), false);
  const urls: string[] = [];
  const denied = await requestRemoveCleanupExport({
    body: "{}",
    signal: new AbortController().signal,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json({ usable: false, reason: "Select a hidden object before exporting." }, { status: 400 });
    },
  });
  assert.deepEqual(urls, [REMOVE_CLEANUP_EXPORT_PATH]);
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.reason, "Select a hidden object before exporting.");
});

test("Objects panel exports the confirmed snapshot without segmentation or generation calls", () => {
  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const route = source("app/api/vibode/admin/remove-cleanup-export/route.ts");
  assert.match(session, /data-remove-cleanup="export"/);
  assert.match(session, /data-remove-cleanup="confirm"/);
  assert.match(session, /data-remove-cleanup="download"/);
  assert.match(session, /REMOVE_CLEANUP_EXCLUSION_COPY/);
  assert.match(session, /removeCleanupExportLabel/);
  assert.match(session, /snapshotRemoveCleanupObjects/);
  assert.match(session, /trackedCleanupKey/);
  assert.match(session, /cleanupController\?\.abort\(\)/);
  assert.match(session, /controller\.signal\.aborted/);
  assert.equal(session.match(/requestRemoveObjects\(/g)?.length, 1);
  assert.match(session, /requestRemoveCleanupExport/);
  assert.doesNotMatch(session, /remove-segmentation|serverless\.roboflow|generativelanguage|api\.openai|concept_segment/i);
  const download = session.slice(
    session.indexOf("const downloadCleanupExport"),
    session.indexOf("const noteDisplayedSize"),
  );
  assert.equal(download.includes("objectExpansionPx"), false);
  assert.equal(download.includes("setObjectUi"), false);
  assert.equal(download.includes("requestRemoveObjects"), false);
  assert.equal(download.includes("dispatch"), false);
  assert.match(download, /cleanupSnapshot/);
  assert.match(download, /if \(controller\.signal\.aborted\) return;/);
  assert.doesNotMatch(route, /createRoboflowRemoveSegmentationProvider|ROBOFLOW_API_KEY|generativelanguage|api\.openai/i);
  const effectStart = session.indexOf("useEffect(() => {\n    const decision = reduceRemoveObjectSession");
  const effectEnd = session.indexOf("}, [objectIdentity]);", effectStart);
  const effect = session.slice(effectStart, effectEnd);
  assert.equal(effect.includes("requestRemoveCleanupExport"), false);
  assert.equal(effect.includes("objectExpansionPx"), false);
});
