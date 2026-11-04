import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  claimNextThumbnailJob,
  createThumbnailJobDatabase,
  enqueueThumbnailJob,
  publishThumbnailJob,
} from "@/lib/vibode-thumbnail-jobs/engine";
import { thumbnailJobFailureIsRetryable } from "@/lib/vibode-thumbnail-jobs/policy";
import { compositeBringForwardRgba } from "@/lib/vibode-stage/bring-forward-cutout";
import {
  canonicalBringForwardSnapshot,
  handleBringForwardState,
  MemoryBringForwardStore,
  readStoredSelectedIds,
  type BringForwardAuthority,
  type BringForwardStoredIdentity,
} from "@/lib/vibode-stage/bring-forward-store";
import { isMissingBringForwardRelation } from "@/lib/vibode-stage/bring-forward-store.server";
import { packRemoveMask, type RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";
import { thumbnailContentToken } from "@/lib/vibode-thumbnail-render/payload.server";

import {
  decideThumbnailForegroundPaint,
  placeBringForwardCutoutOver,
  thumbnailForegroundTokenField,
  type ThumbnailForegroundClaim,
} from "./foreground";

const WIDTH = 32;
const HEIGHT = 32;
const SHA = "ab".repeat(32);
const OTHER_SHA = "cd".repeat(32);
const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";

function object(id: string, paint: (x: number) => boolean): RemoveObjectRecord {
  const coverage = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (paint(x)) coverage[y * WIDTH + x] = 255;
    }
  }
  const mask = packRemoveMask(coverage, WIDTH, HEIGHT);
  assert.ok(mask);
  return {
    id,
    concept: id,
    confidence: 0.9,
    mask,
    eligibility: {
      eligible: true,
      reasons: [],
      notices: [],
      confidence: 0.9,
      areaPx: mask.areaPx,
      areaFraction: mask.areaPx / (WIDTH * HEIGHT),
      edgeTouches: 0,
      bounds: mask.bounds,
    },
  };
}

function photo(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 200;
    rgba[index + 1] = 40;
    rgba[index + 2] = 10;
    rgba[index + 3] = 255;
  }
  return rgba;
}

function furniture(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  rgba.fill(0);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 8;
    rgba[index + 1] = 40;
    rgba[index + 2] = 180;
    rgba[index + 3] = 255;
  }
  return rgba;
}

function pixel(rgba: Uint8ClampedArray, x: number, y: number): number[] {
  const index = (y * WIDTH + x) * 4;
  return [rgba[index] ?? 0, rgba[index + 1] ?? 0, rgba[index + 2] ?? 0, rgba[index + 3] ?? 0];
}

function claim(kind: ThumbnailForegroundClaim["kind"], sha: string | null = SHA): ThumbnailForegroundClaim {
  return { kind, roomId: ROOM, generationId: GENERATION, originalSha256: sha };
}

test("one selected object sits above the furniture and several objects union", () => {
  const rgba = photo();
  const scene = furniture();
  const sofa = object("sofa", (x) => x < 16);
  const lamp = object("lamp", (x) => x >= 16);
  const one = compositeBringForwardRgba({
    rgba,
    width: WIDTH,
    height: HEIGHT,
    objects: [sofa, lamp],
    selectedIds: new Set(["sofa"]),
  });
  assert.ok(one);
  const single = placeBringForwardCutoutOver(scene, one);
  assert.ok(single);
  assert.deepEqual(pixel(single, 1, 1), [200, 40, 10, 255]);
  assert.deepEqual(pixel(single, 20, 1), [8, 40, 180, 255]);
  const both = compositeBringForwardRgba({
    rgba,
    width: WIDTH,
    height: HEIGHT,
    objects: [sofa, lamp],
    selectedIds: new Set(["sofa", "lamp"]),
  });
  assert.ok(both);
  const union = placeBringForwardCutoutOver(scene, both);
  assert.ok(union);
  assert.deepEqual(pixel(union, 1, 1), [200, 40, 10, 255]);
  assert.deepEqual(pixel(union, 20, 1), [200, 40, 10, 255]);
});

test("ORIGINAL, REMOVE, and CLEAN UP paint, and the wrong identity does not", () => {
  const shared = {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: WIDTH,
    originalHeight: HEIGHT,
    displayedWidth: WIDTH,
    displayedHeight: HEIGHT,
  };
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: true,
    backgroundClaim: null,
  }), "paint");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: false,
    backgroundClaim: claim("remove"),
  }), "paint");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: false,
    backgroundClaim: claim("cleanup"),
  }), "paint");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: false,
    backgroundClaim: claim("history", null),
  }), "paint");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: false,
    backgroundClaim: claim("remove", OTHER_SHA),
  }), "omit");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    displayedWidth: WIDTH * 2,
    displayedHeight: 4,
    backgroundIsOriginal: false,
    backgroundClaim: claim("cleanup"),
  }), "omit");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: false,
    backgroundClaim: { ...claim("remove"), roomId: "33333333-3333-4333-8333-333333333333" },
  }), "omit");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    backgroundIsOriginal: false,
    backgroundClaim: { ...claim("remove"), generationId: "44444444-4444-4444-8444-444444444444" },
  }), "omit");
  assert.equal(decideThumbnailForegroundPaint({
    ...shared,
    displayedWidth: 0,
    backgroundIsOriginal: true,
    backgroundClaim: null,
  }), "unmeasured");
});

test("a saved selection changes the thumbnail token and a draft does not", () => {
  const camera = { metricScale: 1.25, verticalFovDeg: 50 };
  const identity = {
    snapshotId: "55555555-5555-4555-8555-555555555555",
    payloadSha256: SHA,
    originalSha256: SHA,
    originalWidth: WIDTH,
    originalHeight: HEIGHT,
  };
  const sofa = thumbnailForegroundTokenField({ ...identity, selectedIds: ["sofa"] });
  const both = thumbnailForegroundTokenField({ ...identity, selectedIds: ["lamp", "sofa"] });
  const flipped = thumbnailForegroundTokenField({ ...identity, selectedIds: ["sofa", "lamp"] });
  assert.ok(sofa && both && flipped);
  const legacy = thumbnailContentToken({ camera, background: "rooms/original.jpg" });
  const selected = thumbnailContentToken({ camera, background: "rooms/original.jpg", foreground: sofa });
  const union = thumbnailContentToken({ camera, background: "rooms/original.jpg", foreground: both });
  const sameUnion = thumbnailContentToken({ camera, background: "rooms/original.jpg", foreground: flipped });
  assert.notEqual(selected, legacy);
  assert.notEqual(union, selected);
  assert.equal(sameUnion, union);
  assert.equal(thumbnailContentToken({ camera, background: "rooms/original.jpg" }), legacy);
  assert.equal(camera.metricScale, 1.25);
  const session = readFileSync(new URL("../../components/stage/BringForwardSession.tsx", import.meta.url), "utf8");
  const cancelAt = session.indexOf("const cancel = useCallback");
  const toggleAt = session.indexOf("const toggle = useCallback");
  assert.doesNotMatch(session.slice(cancelAt, toggleAt), /requestBringForwardSave|scheduleThumbnailAfterBringForwardCommit/);
  const route = readFileSync(new URL("../../app/api/vibode/bring-forward/route.ts", import.meta.url), "utf8");
  assert.match(route, /scheduleThumbnailAfterBringForwardCommit/);
  assert.doesNotMatch(route, /requestRemoveObjects|reserveSegmentation/);
});

test("an older thumbnail job cannot publish over a newer foreground token", () => {
  const plain = thumbnailContentToken({ scene: "furniture" });
  const next = thumbnailContentToken({
    scene: "furniture",
    foreground: { snapshotId: "sofa", selectedIds: ["sofa"] },
  });
  assert.notEqual(plain, next);
  const room = "11111111-1111-4111-8111-111111111111";
  const version = "22222222-2222-4222-8222-222222222222";
  const generation = "33333333-3333-4333-8333-333333333333";
  const db = createThumbnailJobDatabase();
  db.scene = {
    empty: false,
    afcGenerationId: generation,
    objectsKey: plain,
    backgroundBucket: "room-images",
    backgroundPath: "rooms/bg.jpg",
    sceneUpdatedAtMs: 0,
  };
  const first = enqueueThumbnailJob(db, {
    roomId: room,
    versionId: version,
    afcGenerationId: generation,
    contentToken: plain,
    notBeforeMs: 0,
    nowMs: 0,
  });
  const claimed = claimNextThumbnailJob(db, 0);
  assert.equal(claimed?.claimContentToken, plain);
  db.scene = { ...db.scene, objectsKey: next, sceneUpdatedAtMs: 50 };
  const newer = enqueueThumbnailJob(db, {
    roomId: room,
    versionId: version,
    afcGenerationId: generation,
    contentToken: next,
    notBeforeMs: 50,
    nowMs: 50,
    sceneUpdatedAtMs: 50,
  });
  assert.equal(newer.claimContentToken, plain);
  assert.equal(newer.contentToken, next);
  const stale = publishThumbnailJob(db, {
    jobId: first.id,
    claimNonce: first.claimNonce ?? "",
    contentToken: plain,
    afcGenerationId: generation,
    objectsKey: plain,
    backgroundBucket: "room-images",
    backgroundPath: "rooms/bg.jpg",
    sceneUpdatedAtMs: 0,
    nowMs: 80,
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.code, "stale_publish");
  assert.equal(db.pointers.length, 0);
});

test("thumbnail foreground does not infer, and a missing table is not a corrupt snapshot", () => {
  assert.equal(thumbnailJobFailureIsRetryable("foreground_unrestored"), false);
  assert.equal(isMissingBringForwardRelation({ code: "PGRST205", message: "" }), true);
  assert.equal(isMissingBringForwardRelation({ code: "42P01", message: "relation missing" }), true);
  assert.equal(isMissingBringForwardRelation({ code: "23505", message: "duplicate" }), false);
  assert.equal(readStoredSelectedIds(["sofa", "lamp"])?.join(","), "sofa,lamp");
  assert.equal(readStoredSelectedIds(["sofa", 1]), null);
  const frame = readFileSync(new URL("../../app/internal/vibode-thumbnail-render/ThumbnailRenderFrame.tsx", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("./still-renderer.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("./foreground.server.ts", import.meta.url), "utf8");
  const jobs = readFileSync(new URL("../vibode-thumbnail-jobs/jobs.server.ts", import.meta.url), "utf8");
  assert.match(frame, /compositeBringForwardRgba/);
  assert.match(frame, /data-bring-forward-canvas/);
  assert.match(frame, /realizeFrozenCamera/);
  assert.match(frame, /payload\.camera\.metricScale/);
  assert.doesNotMatch(frame, /requestRemoveObjects|reserveSegmentation/);
  assert.doesNotMatch(server, /requestRemoveObjects|reserveSegmentation|segment\(/);
  assert.match(jobs, /scheduleVibodeThumbnailAfterSceneSave/);
  assert.doesNotMatch(renderer, /bring-forward|bringForward/);
  const renderAt = frame.indexOf("renderer.render(scene, built.camera)");
  const canvasAt = frame.indexOf("mountForegroundCanvas");
  assert.ok(renderAt > 0 && canvasAt > renderAt);
});

test("Done schedules a refresh and Cancel's failed save does not", async () => {
  const store = new MemoryBringForwardStore();
  const identity: BringForwardStoredIdentity = {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: WIDTH,
    originalHeight: HEIGHT,
    vocabularyProfile: "default",
  };
  const authorize: BringForwardAuthority = async () => ({ ok: true, identity });
  let commits = 0;
  const scan = JSON.parse(canonicalBringForwardSnapshot({
    identity,
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "stored",
    modelId: "sam3",
    objects: [object("sofa", (x) => x < 16)],
  }) ?? "");
  const deps = {
    getActor: async () => ({ id: "user" }),
    authorize,
    store,
    hash: (text: string) => sha256Hex(new TextEncoder().encode(text)),
    afterCommit: async () => {
      commits += 1;
    },
  };
  const saved = await handleBringForwardState(new Request("http://127.0.0.1/api/vibode/bring-forward", {
    method: "PUT",
    body: JSON.stringify({
      roomId: ROOM,
      generationId: GENERATION,
      expectedRevision: 0,
      selectedIds: ["sofa"],
      scan,
    }),
  }), deps);
  assert.equal(saved.status, 200);
  assert.equal(commits, 1);
  const conflict = await handleBringForwardState(new Request("http://127.0.0.1/api/vibode/bring-forward", {
    method: "PUT",
    body: JSON.stringify({
      roomId: ROOM,
      generationId: GENERATION,
      expectedRevision: 0,
      selectedIds: [],
      scan,
    }),
  }), deps);
  assert.equal(conflict.status, 409);
  assert.equal(commits, 1);
  const cleared = await handleBringForwardState(new Request("http://127.0.0.1/api/vibode/bring-forward", {
    method: "PUT",
    body: JSON.stringify({
      roomId: ROOM,
      generationId: GENERATION,
      expectedRevision: 1,
      selectedIds: [],
      scan,
    }),
  }), {
    ...deps,
    afterCommit: async () => {
      commits += 1;
      throw new Error("refresh down");
    },
  });
  assert.equal(cleared.status, 200);
  assert.equal(commits, 2);
  const kept = store.selection({ userId: "user", identity });
  assert.deepEqual(kept?.selectedIds, []);
});
