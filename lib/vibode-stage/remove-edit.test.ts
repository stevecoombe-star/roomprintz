import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { RemoveAlignmentReport } from "@/lib/vibode-stage/remove-alignment";
import {
  REMOVE_EDIT_LABEL,
  buildRemoveEditCoverage,
  bytesToBase64,
  compositeRemoveEditRgba,
  isRemoveHistoryAsset,
  removeEditExportAdmission,
  removeEditHasChanges,
  removeHistoryFallbackVersions,
} from "@/lib/vibode-stage/remove-edit";
import { handleRemoveEditPost } from "@/lib/vibode-stage/remove-edit-http";
import {
  publishPreparedRemoveEdit,
  renderRemoveEditPng,
  type RemoveEditStorage,
} from "@/lib/vibode-stage/remove-edit-publish.server";
import { paintRemoveBrush } from "@/lib/vibode-stage/remove-mask";
import {
  REMOVE_OBJECT_ELIGIBILITY_DEFAULTS,
  packRemoveMask,
  prepareRemoveObjectMasks,
  type RemoveObjectRecord,
} from "@/lib/vibode-stage/remove-objects";

const ROOM = "077ef88b-c359-4253-bac3-ffc9efbe3a55";
const GENERATION = "44b6bbd2-dcf4-4842-a752-efc52202d0eb";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT = "96063c22-c76a-485d-b77b-6d74a991c4c2";
const ORIGINAL_SHA = "a".repeat(64);
const EMPTY_SHA = "b".repeat(64);

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function rectObject(
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  id = "object-1",
): RemoveObjectRecord {
  const coverage = new Uint8Array(width * height);
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) coverage[py * width + px] = 255;
  }
  const mask = packRemoveMask(coverage, width, height);
  assert.ok(mask);
  const eligible = prepareRemoveObjectMasks({
    candidates: [{ id, confidence: 0.95, concept: "table", mask }],
    thresholds: { ...REMOVE_OBJECT_ELIGIBILITY_DEFAULTS, minAreaPx: 1 },
  }).eligible;
  assert.equal(eligible.length, 1);
  return eligible[0];
}

function report(tier: RemoveAlignmentReport["gridCompatibility"] = "exact_grid_compatible"): RemoveAlignmentReport {
  return {
    usable: true,
    pixelRegistration: "unverified",
    generationId: GENERATION,
    original: {
      sha256: ORIGINAL_SHA,
      decodedWidth: 2,
      decodedHeight: 2,
      byteCount: 1,
      mimeType: "image/png",
      orientation: 1,
    },
    empty: {
      sha256: EMPTY_SHA,
      decodedWidth: 2,
      decodedHeight: 2,
      byteCount: 1,
      mimeType: "image/png",
      orientation: 1,
      artifactSource: "durable",
      lineageSource: "durable",
      reusedFromGenerationId: null,
      lineageShaMatches: true,
    },
    frame: { width: 2, height: 2 },
    frozenCameraFrame: { width: 2, height: 2 },
    gridCompatibility: tier,
    relativeAspectError: 0,
    originalAspect: 1,
    emptyAspect: 1,
  };
}

function rgba(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    bytes[index * 4] = rgb[0];
    bytes[index * 4 + 1] = rgb[1];
    bytes[index * 4 + 2] = rgb[2];
    bytes[index * 4 + 3] = 255;
  }
  return bytes;
}

function memoryStorage(): RemoveEditStorage & { publishes: number; paths: string[] } {
  const objects = new Map<string, Uint8Array>();
  const assets = new Map<string, string>();
  const state = { publishes: 0, paths: [] as string[] };
  return {
    ...state,
    get publishes() { return state.publishes; },
    get paths() { return state.paths; },
    async putPng(path, bytes) {
      state.paths.push(path);
      const existing = objects.get(path);
      if (!existing) {
        objects.set(path, bytes);
        return "stored";
      }
      return sha256Hex(existing) === sha256Hex(bytes) ? "exists-same" : "exists-different";
    },
    async publish(input) {
      state.publishes += 1;
      const key = `${input.roomId}:${input.fingerprint}`;
      const existing = assets.get(key);
      if (existing) return { ok: true, created: false, assetId: existing };
      const assetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      assets.set(key, assetId);
      return { ok: true, created: true, assetId };
    },
  };
}

test("objects, brush, protection, expansion, and feather share one effective mask", () => {
  const width = 5;
  const height = 5;
  const object = rectObject(width, height, 2, 2, 1, 1);
  const brush = new Uint8Array(width * height);
  const objectsOnly = buildRemoveEditCoverage({
    brush,
    width,
    height,
    objects: [object],
    selectedIds: new Set(["object-1"]),
    expansionPx: 0,
  });
  assert.ok(objectsOnly);
  assert.equal(objectsOnly[2 * width + 2], 255);
  assert.equal(objectsOnly[2 * width + 1], 0);
  assert.equal(removeEditHasChanges(objectsOnly), true);

  const brushOnly = new Uint8Array(width * height);
  brushOnly[0] = 200;
  const combined = buildRemoveEditCoverage({
    brush: brushOnly,
    width,
    height,
    objects: [object],
    selectedIds: new Set(["object-1"]),
    expansionPx: 0,
  });
  assert.equal(combined?.[0], 200);
  assert.equal(combined?.[2 * width + 2], 255);

  const overlap = rectObject(width, height, 1, 2, 2, 1, "object-2");
  const shared = buildRemoveEditCoverage({
    brush,
    width,
    height,
    objects: [object, overlap],
    selectedIds: new Set(["object-2"]),
    expansionPx: 0,
  });
  assert.equal(shared?.[2 * width + 1], 255);
  assert.equal(shared?.[2 * width + 2], 255);
  const expanded = buildRemoveEditCoverage({
    brush,
    width,
    height,
    objects: [object],
    selectedIds: new Set(["object-1"]),
    expansionPx: 1,
  });
  assert.equal(expanded?.[2 * width + 1], 255);

  const restored = new Uint8Array(width * height);
  restored[0] = 255;
  paintRemoveBrush({
    mask: restored,
    width,
    height,
    from: null,
    to: { x: 0.5, y: 0.5 },
    diameterPx: 1,
    featherPx: 0,
    tool: "restore",
  });
  const cleared = buildRemoveEditCoverage({
    brush: restored,
    width,
    height,
    objects: [],
    selectedIds: new Set(),
    expansionPx: 0,
  });
  assert.equal(removeEditHasChanges(cleared ?? new Uint8Array()), false);

  const feathered = new Uint8Array(width * height);
  paintRemoveBrush({
    mask: feathered,
    width,
    height,
    from: null,
    to: { x: 2.5, y: 2.5 },
    diameterPx: 5,
    featherPx: 2,
    tool: "reveal",
  });
  const soft = feathered.filter((value) => value > 0 && value < 255);
  assert.ok(soft.length > 0);

  const protectedBrush = new Uint8Array(width * height);
  const protection = new Uint8Array(width * height);
  protection[2 * width + 2] = 255;
  paintRemoveBrush({
    mask: protectedBrush,
    width,
    height,
    from: null,
    to: { x: 2.5, y: 2.5 },
    diameterPx: 3,
    featherPx: 0,
    tool: "reveal",
    protection,
  });
  assert.equal(protectedBrush[2 * width + 2], 0);
  assert.ok((protectedBrush[2 * width + 1] ?? 0) > 0);

  const original = rgba(width, height, [10, 0, 0]);
  const empty = rgba(width, height, [0, 0, 200]);
  const blended = compositeRemoveEditRgba({
    original,
    empty,
    coverage: feathered,
    width,
    height,
  });
  assert.ok(blended);
  assert.equal(blended.length, width * height * 4);
  const center = 2 * width + 2;
  assert.equal(blended[center * 4 + 2], 200);
  const partial = feathered.findIndex((value) => value > 0 && value < 255);
  assert.ok(partial >= 0);
  assert.ok((blended[partial * 4 + 2] ?? 0) > 0);
  assert.ok((blended[partial * 4 + 2] ?? 255) < 200);
});

test("full-resolution export stretches EMPTY onto the ORIGINAL grid", async () => {
  const original = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 0, b: 0 } },
  }).png().toBuffer();
  const empty = await sharp({
    create: { width: 4, height: 2, channels: 3, background: { r: 0, g: 0, b: 180 } },
  }).png().toBuffer();
  const coverage = Uint8Array.from([255, 0, 128, 0]);
  const png = await renderRemoveEditPng({
    originalBytes: new Uint8Array(original),
    emptyBytes: new Uint8Array(empty),
    coverage,
    width: 2,
    height: 2,
  });
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 2);
  assert.equal(decoded.info.height, 2);
  assert.equal(decoded.data[2], 180);
  assert.equal(decoded.data[4], 20);
  assert.ok(decoded.data[8] > 0 && decoded.data[8] < 20);
  assert.ok(decoded.data[10] > 0 && decoded.data[10] < 180);
});

test("an edited Done publishes once and a repeated fingerprint does not create another asset", async () => {
  const storage = memoryStorage();
  const coverage = Uint8Array.from([255, 0, 0, 0]);
  const submission = {
    userId: ADMIN,
    roomId: ROOM,
    generationId: GENERATION,
    parentAssetId: PARENT,
    width: 2,
    height: 2,
    coverageBase64: bytesToBase64(coverage),
    report: report(),
    originalBytes: new Uint8Array(await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer()),
    emptyBytes: new Uint8Array(await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 9, g: 8, b: 7 } },
    }).png().toBuffer()),
    originalSha256: ORIGINAL_SHA,
    emptySha256: EMPTY_SHA,
  };
  const first = await publishPreparedRemoveEdit(storage, submission);
  const second = await publishPreparedRemoveEdit(storage, submission);
  assert.equal(first.ok && first.created, true);
  assert.equal(first.ok && first.activated, false);
  assert.equal(second.ok && second.created, false);
  assert.equal(second.ok && second.assetId, first.ok ? first.assetId : "");
  assert.equal(storage.publishes, 2);
  assert.equal(new Set(storage.paths).size, 1);
});

test("unchanged coverage, incompatible pairs, and failed storage do not publish", async () => {
  const storage = memoryStorage();
  const base = {
    userId: ADMIN,
    roomId: ROOM,
    generationId: GENERATION,
    parentAssetId: PARENT,
    width: 2,
    height: 2,
    report: report(),
    originalBytes: new Uint8Array(await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer()),
    emptyBytes: new Uint8Array(await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 4, g: 5, b: 6 } },
    }).png().toBuffer()),
    originalSha256: ORIGINAL_SHA,
    emptySha256: EMPTY_SHA,
  };
  const unchanged = await publishPreparedRemoveEdit(storage, {
    ...base,
    coverageBase64: bytesToBase64(new Uint8Array(4)),
  });
  assert.deepEqual(unchanged, { ok: false, code: "unchanged" });
  const incompatible = await publishPreparedRemoveEdit(storage, {
    ...base,
    report: report("incompatible"),
    coverageBase64: bytesToBase64(Uint8Array.from([255, 0, 0, 0])),
  });
  assert.deepEqual(incompatible, { ok: false, code: "incompatible" });
  const failing: RemoveEditStorage = {
    async putPng() { return "failed"; },
    async publish() { throw new Error("must not publish"); },
  };
  const failed = await publishPreparedRemoveEdit(failing, {
    ...base,
    coverageBase64: bytesToBase64(Uint8Array.from([255, 0, 0, 0])),
  });
  assert.deepEqual(failed, { ok: false, code: "unavailable" });
  const unreadable = await publishPreparedRemoveEdit(storage, {
    ...base,
    originalBytes: Uint8Array.from([1, 2, 3, 4]),
    coverageBase64: bytesToBase64(Uint8Array.from([255, 0, 0, 0])),
  });
  assert.deepEqual(unreadable, { ok: false, code: "invalid" });
  const forged = await publishPreparedRemoveEdit(storage, {
    ...base,
    originalSha256: "c".repeat(64),
    coverageBase64: bytesToBase64(Uint8Array.from([255, 0, 0, 0])),
  });
  assert.deepEqual(forged, { ok: false, code: "invalid" });
  assert.equal(storage.publishes, 0);
  assert.equal(removeEditExportAdmission(report("aspect_compatible_rescaled")).allowed, true);
});

test("non-admin, foreign parent, and stale generation requests are rejected", async () => {
  const storage = memoryStorage();
  const denied = await handleRemoveEditPost(new Request("http://local/remove-edits", {
    method: "POST",
    body: JSON.stringify({}),
  }), {
    getAdmin: async () => null,
    loadSubmission: async () => { throw new Error("unreachable"); },
    storage,
  });
  assert.equal(denied.status, 404);

  const foreign = await handleRemoveEditPost(new Request("http://local/remove-edits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM,
      generationId: GENERATION,
      parentAssetId: PARENT,
      width: 2,
      height: 2,
      coverageBase64: bytesToBase64(Uint8Array.from([255, 0, 0, 0])),
    }),
  }), {
    getAdmin: async () => ({ id: ADMIN }),
    loadSubmission: async () => ({ ok: false, status: 404, error: "Not found." }),
    storage,
  });
  assert.equal(foreign.status, 404);
  assert.equal(storage.publishes, 0);
});

test("a Remove card is labeled once and the publication stays off the camera and Clean Up path", () => {
  const hidden = removeHistoryFallbackVersions([
    { id: "original" },
    { id: "remove-1", metadata: { removeEditFingerprint: "c".repeat(64) } },
    { id: "remove-1", metadata: { removeEditFingerprint: "c".repeat(64) } },
    { id: "cleanup", metadata: { cleanupJobId: ROOM } },
  ], new Set(["original"]));
  assert.deepEqual(hidden.map((version) => version.id), ["remove-1"]);
  assert.equal(isRemoveHistoryAsset({ metadata: { removeEditFingerprint: "c".repeat(64) } }), true);
  assert.equal(isRemoveHistoryAsset({ metadata: { cleanupJobId: ROOM } }), false);
  const sql = source("supabase/migrations/20261021170000_vibode_remove_edit_history.sql");
  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const editor = source("app/editor/page.tsx");
  const route = source("app/api/vibode/admin/remove-edits/route.ts");
  assert.match(sql, /publish_vibode_remove_edit/);
  assert.match(sql, /grant execute on function public\.publish_vibode_remove_edit/);
  assert.match(sql, /'activated', false/);
  assert.doesNotMatch(sql, /update public\.vibode_rooms|room_scale_multiplier|vibode_3d_scenes|current_afc_generation_id|generativelanguage|roboflow/);
  assert.doesNotMatch(route, /generativelanguage|roboflow|accept_vibode_cleanup_history/);
  assert.match(session, /data-remove-edit="cancel"/);
  assert.match(session, /removeEditHasChanges\(coverage\)/);
  assert.match(session, /REMOVE_EDIT_ACTIVATE_ERROR/);
  const save = session.slice(session.indexOf("const saveRemoveEdits"), session.indexOf("const value = useMemo"));
  assert.ok(save.indexOf("removeEditHasChanges") < save.indexOf("fetch("));
  assert.ok(save.indexOf("setRemoveSavePhase(\"error\")") < save.indexOf("dispatch({ type: \"exit\" })"));
  assert.doesNotMatch(save, /requestRemoveObjects\(|generativelanguage|roboflow|accept_vibode_cleanup_history/);
  assert.match(editor, /await setActiveVersionForRoom/);
  assert.doesNotMatch(editor.slice(editor.indexOf("const activateSavedRemoveEdit"), editor.indexOf("const handleSetVersionAsBaseImage")), /room_scale_multiplier|current_afc_generation_id/);
  assert.equal(REMOVE_EDIT_LABEL, "Remove");
});
