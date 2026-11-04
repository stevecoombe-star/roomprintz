import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  buildHarmonizeForeground,
  readHarmonizeForegroundRequest,
} from "@/lib/vibode-stage/harmonize-bring-forward";
import {
  cancelBringForward,
  loadBringForwardScan,
  resetBringForwardScansForTests,
  restoreBringForwardSelection,
  scanFromStoredBringForward,
  type BringForwardScan,
} from "@/lib/vibode-stage/bring-forward-cutout";
import {
  acceptBringForwardSnapshot,
  canonicalBringForwardSnapshot,
  handleBringForwardState,
  MemoryBringForwardStore,
  planBringForwardSelectionWrite,
  readBringForwardStateResponse,
  requestBringForwardSave,
  requestStoredBringForwardScan,
  type BringForwardAuthority,
  type BringForwardStoredIdentity,
} from "@/lib/vibode-stage/bring-forward-store";
import { packRemoveMask, type RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";

const WIDTH = 32;
const HEIGHT = 32;
const SHA = "ab".repeat(32);
const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OTHER_ROOM = "33333333-3333-4333-8333-333333333333";

function identity(profile: BringForwardStoredIdentity["vocabularyProfile"] = "default"): BringForwardStoredIdentity {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: WIDTH,
    originalHeight: HEIGHT,
    vocabularyProfile: profile,
  };
}

function packed(paint: (x: number, y: number) => boolean) {
  const coverage = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (paint(x, y)) coverage[y * WIDTH + x] = 255;
    }
  }
  const mask = packRemoveMask(coverage, WIDTH, HEIGHT);
  assert.ok(mask);
  return mask;
}

function record(id: string, paint: (x: number, y: number) => boolean): RemoveObjectRecord {
  const mask = packed(paint);
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

const sofa = () => record("sofa", (x) => x < 16);
const lamp = () => record("lamp", (x) => x >= 16);

function scanDocument(objects: readonly RemoveObjectRecord[], roomId = ROOM) {
  const canonical = canonicalBringForwardSnapshot({
    identity: { ...identity(), roomId },
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    objects,
  });
  assert.ok(canonical);
  assert.equal(canonical.includes("rgba"), false);
  return JSON.parse(canonical) as Record<string, unknown>;
}

function harness(
  store = new MemoryBringForwardStore(),
  authorize: BringForwardAuthority = async (input) => {
    if (input.userId !== "user" || input.roomId !== ROOM || input.generationId !== GENERATION) {
      return { ok: false, status: 404, reason: "Room not found." };
    }
    return { ok: true, identity: identity() };
  },
) {
  return {
    store,
    deps: {
      getActor: async () => ({ id: "user" }),
      authorize,
      store,
      hash: (text: string) => sha256Hex(new TextEncoder().encode(text)),
    },
  };
}

function put(body: unknown) {
  return new Request("http://127.0.0.1/api/vibode/bring-forward", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function get() {
  return new Request(`http://127.0.0.1/api/vibode/bring-forward?roomId=${ROOM}&generationId=${GENERATION}`);
}

test("a committed selection keeps its snapshot and reloads the same objects", async () => {
  const { deps, store } = harness();
  const saved = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa(), lamp()]),
  }), deps);
  assert.equal(saved.status, 200);
  const body = await saved.json() as { ok: boolean; revision: number; snapshotId: string };
  assert.equal(body.ok, true);
  assert.equal(body.revision, 1);
  const row = store.selection({ userId: "user", identity: identity() });
  assert.equal(row?.snapshotId, body.snapshotId);
  assert.deepEqual(row?.selectedIds, ["sofa"]);

  const loaded = await handleBringForwardState(get(), deps);
  const payload = await loaded.json() as { recovery: string; selectedIds: string[]; scan: { objects: { id: string }[] } };
  assert.equal(payload.recovery, "ready");
  assert.deepEqual(payload.selectedIds, ["sofa"]);
  assert.deepEqual(payload.scan.objects.map((object) => object.id), ["lamp", "sofa"]);
  const again = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 1,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa(), lamp()]),
  }), deps);
  const reused = await again.json() as { snapshotId: string };
  assert.equal(reused.snapshotId, body.snapshotId);
});

test("reloading a saved scan does not call Roboflow and REMOVE can reuse it", async () => {
  resetBringForwardScansForTests();
  const { deps } = harness();
  const saved = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()]),
  }), deps);
  const payload = await (await handleBringForwardState(get(), deps)).json();
  assert.equal(saved.status, 200);
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("remove-objects")) {
      providerCalls += 1;
      throw new Error("provider");
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const restored = await requestStoredBringForwardScan({
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    originalWidth: WIDTH,
    originalHeight: HEIGHT,
    fetchImpl,
  });
  assert.equal(restored.recovery, "ready");
  if (restored.recovery !== "ready") return;
  assert.deepEqual(restored.selectedIds, ["sofa"]);
  const scan = await loadBringForwardScan({
    identity: {
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: SHA,
      originalWidth: WIDTH,
      originalHeight: HEIGHT,
      sessionSerial: 4,
      vocabularyRevision: 0,
    },
    fetchImpl,
  });
  assert.equal(providerCalls, 0);
  assert.equal(scan?.objects[0]?.id, "sofa");
  resetBringForwardScansForTests();
});

test("Done persists and Cancel does not", async () => {
  const { deps, store } = harness();
  let posts = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    posts += 1;
    assert.equal(init?.method, "PUT");
    const body = JSON.parse(String(init?.body)) as { selectedIds: string[] };
    assert.deepEqual(body.selectedIds, ["sofa"]);
    assert.equal(JSON.stringify(body).includes("rgba"), false);
    return handleBringForwardState(put(body), deps);
  };
  const saved = await requestBringForwardSave({
    identity: identity(),
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    objects: [sofa()],
    selectedIds: ["sofa"],
    expectedRevision: 0,
    fetchImpl,
  });
  assert.equal(posts, 1);
  assert.equal(saved.ok, true);
  const editor = {
    editing: true,
    committedIds: new Set(["sofa"]),
    draftIds: new Set<string>(),
    scan: null,
  };
  const cancelled = cancelBringForward(editor);
  assert.deepEqual([...cancelled.draftIds], ["sofa"]);
  assert.deepEqual(store.selection({ userId: "user", identity: identity() })?.selectedIds, ["sofa"]);
  const session = readFileSync(new URL("../../components/stage/BringForwardSession.tsx", import.meta.url), "utf8");
  const doneAt = session.indexOf("const done = useCallback");
  const cancelAt = session.indexOf("const cancel = useCallback");
  const toggleAt = session.indexOf("const toggle = useCallback");
  assert.match(session.slice(doneAt, cancelAt), /requestBringForwardSave/);
  assert.doesNotMatch(session.slice(cancelAt, toggleAt), /requestBringForwardSave/);
});

test("Done with an empty selection clears the saved objects", async () => {
  const { deps } = harness();
  const first = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()]),
  }), deps);
  assert.equal(first.status, 200);
  const cleared = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 1,
    selectedIds: [],
    scan: scanDocument([sofa()]),
  }), deps);
  assert.equal(cleared.status, 200);
  const payload = await (await handleBringForwardState(get(), deps)).json() as { selectedIds: string[]; revision: number };
  assert.equal(payload.revision, 2);
  assert.deepEqual(payload.selectedIds, []);
});

test("a different room, generation, or ORIGINAL is rejected", async () => {
  const { deps, store } = harness();
  const otherRoom = await handleBringForwardState(put({
    roomId: OTHER_ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()], OTHER_ROOM),
  }), deps);
  assert.equal(otherRoom.status, 404);
  const otherOriginal = harness(store, async () => ({
    ok: true,
    identity: { ...identity(), originalSha256: "cd".repeat(32) },
  }));
  const mismatch = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()]),
  }), otherOriginal.deps);
  assert.equal(mismatch.status, 409);
  assert.equal(store.selection({ userId: "user", identity: identity() }), null);
});

test("corrupt packed masks are rejected and a damaged snapshot stays recoverable", async () => {
  const broken = scanDocument([sofa()]) as { objects: { mask: { bits: string } }[] };
  broken.objects[0].mask.bits = "!!!!";
  const { deps, store } = harness();
  const rejected = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: broken,
  }), deps);
  assert.equal(rejected.status, 422);
  assert.equal(store.selection({ userId: "user", identity: identity() }), null);

  const saved = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()]),
  }), deps);
  const body = await saved.json() as { snapshotId: string };
  const lampCanonical = canonicalBringForwardSnapshot({
    identity: identity(),
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    objects: [lamp()],
  });
  assert.ok(lampCanonical);
  await store.putSnapshot({
    userId: "user",
    identity: identity(),
    conceptSet: "remove-segmentation-concepts/v1",
    payload: lampCanonical,
    payloadSha256: sha256Hex(new TextEncoder().encode(lampCanonical)),
  });
  store.damage(body.snapshotId);
  const loaded = await handleBringForwardState(get(), deps);
  const payload = await loaded.json() as { recovery: string; scan?: unknown };
  assert.equal(payload.recovery, "corrupt");
  assert.equal(payload.scan, undefined);
  assert.deepEqual(store.selection({ userId: "user", identity: identity() })?.selectedIds, ["sofa"]);
  const accepted = acceptBringForwardSnapshot(broken, identity());
  assert.equal(accepted.ok, false);
});

test("old selections cannot bind to a different snapshot", async () => {
  const { deps, store } = harness();
  await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()]),
  }), deps);
  const lampCanonical = canonicalBringForwardSnapshot({
    identity: identity(),
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    objects: [lamp()],
  });
  assert.ok(lampCanonical);
  const lampSnapshot = await store.putSnapshot({
    userId: "user",
    identity: identity(),
    conceptSet: "remove-segmentation-concepts/v1",
    payload: lampCanonical,
    payloadSha256: sha256Hex(new TextEncoder().encode(lampCanonical)),
  });
  assert.equal(lampSnapshot.ok, true);
  if (!lampSnapshot.ok) return;
  const rebound = await store.writeSelection({
    userId: "user",
    identity: identity(),
    snapshotId: lampSnapshot.id,
    selectedIds: ["sofa"],
    expectedRevision: 1,
  });
  assert.equal(rebound.ok, false);
  if (!rebound.ok) assert.equal(rebound.code, "mask");
  assert.deepEqual(store.selection({ userId: "user", identity: identity() })?.selectedIds, ["sofa"]);
});

test("an older save cannot replace a newer selection", async () => {
  assert.deepEqual(planBringForwardSelectionWrite({ currentRevision: 2, expectedRevision: 1 }), {
    action: "conflict",
    revision: 2,
  });
  const { deps, store } = harness();
  const scan = scanDocument([sofa(), lamp()]);
  const first = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan,
  }), deps);
  assert.equal(first.status, 200);
  const second = await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["lamp"],
    scan,
  }), deps);
  assert.equal(second.status, 409);
  assert.deepEqual(store.selection({ userId: "user", identity: identity() })?.selectedIds, ["sofa"]);
  const retry = await requestBringForwardSave({
    identity: identity(),
    conceptSet: "remove-segmentation-concepts/v1",
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    objects: [sofa(), lamp()],
    selectedIds: ["lamp"],
    expectedRevision: 0,
    fetchImpl: async (_input, init) => handleBringForwardState(put(JSON.parse(String(init?.body))), deps),
  });
  assert.equal(retry.ok, false);
  assert.deepEqual(store.selection({ userId: "user", identity: identity() })?.selectedIds, ["sofa"]);
});

test("a room switch cannot apply another room's foreground", () => {
  const scan: BringForwardScan = scanFromStoredBringForward({
    identity: {
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: SHA,
      originalWidth: WIDTH,
      originalHeight: HEIGHT,
      sessionSerial: 0,
      vocabularyRevision: 0,
    },
    conceptSet: "remove-segmentation-concepts/v1",
    objects: [sofa()],
    provider: "roboflow",
    modelId: "sam3/sam3_final",
  });
  const editor = {
    editing: false,
    committedIds: new Set(["sofa"]),
    draftIds: new Set(["sofa"]),
    scan,
  };
  assert.equal(restoreBringForwardSelection(editor, scan, ["sofa"], 1, 2, {
    roomId: ROOM,
    generationId: GENERATION,
  }), editor);
  assert.equal(restoreBringForwardSelection(editor, scan, ["sofa"], 3, 2, {
    roomId: OTHER_ROOM,
    generationId: GENERATION,
  }), null);
  assert.equal(restoreBringForwardSelection(editor, scan, ["missing"], 3, 2, {
    roomId: ROOM,
    generationId: GENERATION,
  }), null);
  assert.deepEqual([...editor.committedIds], ["sofa"]);
});

test("a restored foreground reaches Harmonize and an unfinished restore does not", async () => {
  const { deps } = harness();
  await handleBringForwardState(put({
    roomId: ROOM,
    generationId: GENERATION,
    expectedRevision: 0,
    selectedIds: ["sofa"],
    scan: scanDocument([sofa()]),
  }), deps);
  const payload = await (await handleBringForwardState(get(), deps)).json();
  const read = readBringForwardStateResponse(payload, identity());
  assert.equal(read.recovery, "ready");
  if (read.recovery !== "ready") return;
  const scan = scanFromStoredBringForward({
    identity: {
      roomId: ROOM,
      generationId: GENERATION,
      originalSha256: SHA,
      originalWidth: WIDTH,
      originalHeight: HEIGHT,
      sessionSerial: 0,
      vocabularyRevision: 0,
    },
    conceptSet: read.conceptSet,
    objects: read.objects,
    provider: read.provider,
    modelId: read.modelId,
  });
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 12;
    rgba[index + 1] = 34;
    rgba[index + 2] = 56;
    rgba[index + 3] = 255;
  }
  const decision = readHarmonizeForegroundRequest({
    session: {
      editing: false,
      recovery: "ready",
      committedIds: new Set(read.selectedIds),
      verified: { rgba, width: WIDTH, height: HEIGHT },
      scan,
      display: "show",
    },
    roomId: ROOM,
    generationId: GENERATION,
  });
  assert.equal(decision.ok, true);
  if (!decision.ok || !decision.snapshot) return;
  assert.deepEqual(decision.snapshot.selectedIds, ["sofa"]);
  const built = buildHarmonizeForeground({
    snapshot: decision.snapshot,
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: SHA,
    targetWidth: WIDTH,
    targetHeight: HEIGHT,
  });
  assert.equal(built.ok, true);
  if (!built.ok || !built.rgba) return;
  assert.equal(built.rgba[3], 255);
  assert.equal(built.rgba[(31 * 4) + 3], 0);
});

test("persistence does not reserve a segmentation quota", () => {
  const route = readFileSync(new URL("../../app/api/vibode/bring-forward/route.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("./bring-forward-store.server.ts", import.meta.url), "utf8");
  const handler = readFileSync(new URL("./remove-segmentation-admin.ts", import.meta.url), "utf8");
  const removeRoute = readFileSync(new URL("../../app/api/vibode/admin/remove-objects/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261103190000_vibode_bring_forward.sql", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../../components/afc-3d/AfcProductionRoomViewer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(route, /reserveSegmentation|reserve_vibode_remove_segmentation|roboflow/);
  assert.doesNotMatch(server, /reserveSegmentation|reserve_vibode_remove_segmentation|\.delete\(|vibode_rooms\.metadata/);
  assert.match(server, /\.eq\("revision", input\.expectedRevision\)/);
  assert.match(removeRoute, /reserveSegmentation/);
  const reservedAt = handler.indexOf("const reserved = await deps.reserveSegmentation");
  const storedAt = handler.indexOf("deps.storeScan");
  assert.ok(reservedAt >= 0 && storedAt > reservedAt);
  assert.match(viewer, /recovery: session\.recovery/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.vibode_bring_forward_snapshots from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.vibode_bring_forward_selections from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.vibode_bring_forward_snapshots to service_role/);
  assert.match(migration, /grant select, insert, update, delete on table public\.vibode_bring_forward_selections to service_role/);
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /revision > 0/);
  assert.match(migration, /vibode_rooms\.metadata document is not updated/);
  assert.doesNotMatch(migration, /update public\.vibode_rooms|insert into storage\.buckets|create policy /i);
});
