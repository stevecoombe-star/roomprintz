import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import type { DetectedRoomObjectLabel } from "@/lib/vibodeRoomObjectLabels";
import type { CompletionDecision, ReservationDecision, StorageDownloadResult } from "@/lib/vibodeRoomImageObjectSecurity";
import { POST as roomReadPost } from "../room-read/route";
import {
  handleRoomImageObjectsRequest,
  readAuthorizedRoomImage,
  type RoomImageObjectsDependencies,
} from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";
const OTHER_ROOM = "55555555-5555-4555-8555-555555555555";
const OTHER_ASSET = "66666666-6666-4666-8666-666666666666";
const ATTEMPT = "77777777-7777-4777-8777-777777777777";
const HOSTILE = "https://hostile.example/room.jpg?token=signed-secret";
const SUPABASE = "https://sec20c-offline.example";
const OFFLINE_KEY = "sec20c-offline-not-a-credential";

const HOSTILE_URLS = [
  HOSTILE,
  "http://127.0.0.1/room.jpg",
  "http://localhost/room.jpg",
  "http://[::1]/room.jpg",
  "http://169.254.169.254/latest/meta-data/",
  "http://[fe80::1]/room.jpg",
  "http://10.0.0.8/room.jpg",
  "data:image/png;base64,AAAA",
];

type CacheRow = {
  label: string;
  confidence: number | null;
  center_x: number | null;
  center_y: number | null;
  bbox: unknown;
};

type World = {
  auth: "ok" | "no";
  rows: CacheRow[];
  cacheOk: boolean;
  reservation: ReservationDecision;
  download: StorageDownloadResult;
  objects: DetectedRoomObjectLabel[];
  calls: string[];
  ownedArgs: unknown[];
  reserveArgs: unknown[];
  completeArgs: unknown[];
  downloadArgs: unknown[];
  readArgs: unknown[];
  stored: unknown[];
  completion: CompletionDecision | null;
  completionThrows: boolean;
  storeThrows: boolean;
  storageBucket: string | null;
  storagePath: string | null;
  ownedImageUrl: string | null;
};

function jpeg(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[30] = 0xff;
  bytes[31] = 0xd9;
  return bytes;
}

function world(): World {
  return {
    auth: "ok",
    rows: [],
    cacheOk: true,
    reservation: { status: "reserved", attemptId: ATTEMPT },
    download: { ok: true, bytes: jpeg(), contentType: "image/jpeg" },
    objects: [{ label: "sofa", confidence: 0.91 }],
    calls: [],
    ownedArgs: [],
    reserveArgs: [],
    completeArgs: [],
    downloadArgs: [],
    readArgs: [],
    stored: [],
    completion: null,
    completionThrows: false,
    storeThrows: false,
    storageBucket: "vibode-base-images",
    storagePath: `users/${USER}/scene_1/base.jpg`,
    ownedImageUrl: HOSTILE,
  };
}

let state = world();
let fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalWarn = console.warn;
const logs: unknown[][] = [];
const envKeys = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;
const previousEnv = envKeys.map((key) => [key, process.env[key]] as const);

function deps(): RoomImageObjectsDependencies {
  return {
    async authenticate() {
      state.calls.push("authenticate");
      return state.auth === "ok" ? { userId: USER } : null;
    },
    async fetchCachedObjects() {
      state.calls.push("cache");
      return state.cacheOk ? { ok: true, rows: state.rows } : { ok: false };
    },
    async loadOwnedAsset(args) {
      state.calls.push("owned");
      state.ownedArgs.push(args);
      if (args.userId === USER && args.roomId === ROOM && args.assetId === ASSET) {
        return {
          ok: true,
          storageBucket: state.storageBucket,
          storagePath: state.storagePath,
          imageUrl: state.ownedImageUrl,
        };
      }
      return { ok: false, reason: "not_found" };
    },
    async reserve(args) {
      state.calls.push("reserve");
      state.reserveArgs.push(args);
      return state.reservation;
    },
    async complete(args) {
      state.calls.push("complete");
      state.completeArgs.push(args);
      if (state.completionThrows) throw new Error("completion-broke");
      return state.completion ?? { status: "completed", attemptId: args.attemptId, outcome: args.outcome };
    },
    async downloadOwnedImage(args) {
      state.calls.push("download");
      state.downloadArgs.push(args);
      return state.download;
    },
    async readRoom(args) {
      state.calls.push("read");
      state.readArgs.push(args);
      return state.objects;
    },
    async storeObjects(rows) {
      state.calls.push("store");
      state.stored.push(rows);
      if (state.storeThrows) throw new Error("store-broke");
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://127.0.0.1/api/vibode/room-image-objects", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    imageUrl: HOSTILE,
    imageHash: "caller-controlled-hash",
    modelVersion: "gemini-2.5-pro",
    storageBucket: "vibode-thumbnails",
    storagePath: "users/someone-else/secret.jpg",
    roomId: ROOM,
    assetId: ASSET,
    versionId: ASSET,
    allowRoomReadOnMiss: true,
    mode: "labels_only",
    purpose: "remove-mode",
    ...overrides,
  };
}

async function invoke(body: unknown, headers?: Record<string, string>) {
  return handleRoomImageObjectsRequest(request(body, headers), deps());
}

test.before(() => {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push(url);
    return Response.json({ error: "offline" }, { status: 401 });
  };
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
  console.warn = (...args: unknown[]) => {
    logs.push(["warn", ...args]);
  };
});

test.after(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.warn = originalWarn;
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test.beforeEach(() => {
  state = world();
  fetchCalls = [];
  logs.length = 0;
  process.env.SUPABASE_URL = SUPABASE;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_ANON_KEY = "sec20c-offline-anon";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
});

test("anonymous and invalid tokens are rejected before the body is parsed", async () => {
  const { POST } = await import("./route");
  const anonymous = await POST(request("{"));
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: "Unauthorized" });
  assert.equal(fetchCalls.length, 0);

  fetchCalls = [];
  const invalid = await POST(
    request(providerBody(), { authorization: "Bearer sec20c-offline-invalid-token" }),
  );
  assert.equal(invalid.status, 401);
  assert.equal(fetchCalls.every((url) => url.startsWith(SUPABASE)), true);
  assert.equal(fetchCalls.some((url) => url.includes("hostile.example")), false);
  assert.equal(fetchCalls.some((url) => url.includes("generativelanguage")), false);

  let parsed = 0;
  const probing = request("{");
  const originalJson = probing.json.bind(probing);
  probing.json = async () => {
    parsed += 1;
    return originalJson();
  };
  state.auth = "no";
  const denied = await handleRoomImageObjectsRequest(probing, deps());
  assert.equal(denied.status, 401);
  assert.equal(parsed, 0);
  assert.deepEqual(state.calls, ["authenticate"]);
});

test("malformed bodies are rejected before cache or provider work", async () => {
  for (const body of ["{", "not-json", "null", "[]", "\"text\""]) {
    state = world();
    const response = await invoke(body);
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: "Invalid request." });
    assert.deepEqual(state.calls, ["authenticate"]);
  }
});

test("caller image URLs cannot trigger a fetch or a provider call", async () => {
  for (const imageUrl of HOSTILE_URLS) {
    state = world();
    fetchCalls = [];
    const response = await invoke({ imageUrl, allowRoomReadOnMiss: true, modelVersion: "gemini-2.5-pro" });
    assert.equal(response.status, 403, imageUrl);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
    assert.equal(state.calls.includes("reserve"), false, imageUrl);
    assert.equal(state.calls.includes("complete"), false, imageUrl);
    assert.equal(state.calls.includes("download"), false, imageUrl);
    assert.equal(state.calls.includes("read"), false, imageUrl);
    assert.equal(fetchCalls.length, 0, imageUrl);
  }
});

test("unowned room, unowned asset, outside asset, and version mismatch fail closed", async () => {
  const cases = [
    providerBody({ roomId: OTHER_ROOM }),
    providerBody({ assetId: OTHER_ASSET, versionId: OTHER_ASSET }),
    providerBody({ roomId: ROOM, assetId: ASSET, versionId: OTHER_ASSET }),
    providerBody({ roomId: "not-a-uuid", assetId: ASSET }),
  ];
  for (const body of cases) {
    state = world();
    const response = await invoke(body);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
    assert.equal(state.calls.includes("reserve"), false);
    assert.equal(state.calls.includes("download"), false);
    assert.equal(state.calls.includes("read"), false);
    assert.equal(fetchCalls.length, 0);
  }
  assert.equal(state.calls.includes("owned"), false);
});

test("a missing authorized storage path returns an empty object list and does not reserve", async () => {
  state.storageBucket = null;
  state.storagePath = null;
  state.ownedImageUrl = "https://hostile.example/not-storage.jpg";
  const response = await invoke(providerBody());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { objects: [] });
  assert.equal(state.calls.includes("reserve"), false);
  assert.equal(state.calls.includes("complete"), false);
  assert.equal(state.calls.includes("download"), false);
  assert.equal(fetchCalls.length, 0);
});

test("an owned asset is read from its stored bucket and path with bounded bytes", async () => {
  const response = await invoke(providerBody());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { objects: [{ label: "sofa", confidence: 0.91 }] });
  assert.deepEqual(state.downloadArgs, [
    {
      userId: USER,
      roomId: ROOM,
      bucket: "vibode-base-images",
      objectPath: `users/${USER}/scene_1/base.jpg`,
    },
  ]);
  assert.deepEqual(state.calls, ["authenticate", "cache", "owned", "download", "reserve", "read", "store", "complete"]);
  assert.deepEqual(state.completeArgs, [{ userId: USER, attemptId: ATTEMPT, outcome: "succeeded" }]);
  assert.equal((state.readArgs[0] as { attemptId?: string }).attemptId, ATTEMPT);
  const stored = state.stored[0] as Array<{ image_url: string | null; image_hash: string; room_id: string }>;
  assert.equal(stored[0]?.image_url, null);
  assert.equal(stored[0]?.room_id, ROOM);
  assert.equal(
    stored[0]?.image_hash,
    createHash("sha256").update(`${ROOM}|${ASSET}|${ASSET}`).digest("hex"),
  );
  assert.equal(JSON.stringify(state.stored).includes("hostile.example"), false);
  assert.equal(JSON.stringify(state.readArgs).includes("gemini-2.5-pro"), false);
  assert.equal(fetchCalls.length, 0);
});

test("legacy owned image_url recovery never fetches the signed URL", async () => {
  state.storageBucket = null;
  state.storagePath = null;
  state.ownedImageUrl =
    `${SUPABASE}/storage/v1/object/sign/vibode-generations/rooms/${ROOM}/stage_1/out.jpg?token=signed-secret`;
  const response = await invoke(providerBody({ imageUrl: "http://169.254.169.254/latest/meta-data/" }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.downloadArgs[0], {
    userId: USER,
    roomId: ROOM,
    bucket: "vibode-generations",
    objectPath: `rooms/${ROOM}/stage_1/out.jpg`,
  });
  assert.equal(fetchCalls.length, 0);
  assert.equal(JSON.stringify(logs).includes("signed-secret"), false);
});

test("oversized, corrupt, and unsupported images are rejected before Gemini", async () => {
  state.download = { ok: false, reason: "too_large" };
  assert.equal((await invoke(providerBody())).status, 400);
  assert.equal(state.calls.includes("reserve"), false);
  assert.equal(state.calls.includes("read"), false);
  assert.equal(state.calls.includes("complete"), false);

  state = world();
  state.download = { ok: false, reason: "unavailable" };
  assert.equal((await invoke(providerBody())).status, 503);
  assert.equal(state.calls.includes("reserve"), false);
  assert.equal(state.calls.includes("complete"), false);

  state = world();
  state.download = { ok: true, bytes: new TextEncoder().encode("not-an-image"), contentType: "image/gif" };
  const unsupported = await invoke(providerBody());
  assert.equal(unsupported.status, 400);
  assert.deepEqual(await unsupported.json(), { error: "Invalid image." });
  assert.equal(state.calls.includes("reserve"), false);
  assert.equal(state.calls.includes("read"), false);
  assert.equal(state.calls.includes("complete"), false);

  state = world();
  state.download = { ok: true, bytes: jpeg(), contentType: "image/png" };
  assert.equal((await invoke(providerBody())).status, 400);
  assert.equal(state.calls.includes("reserve"), false);
  assert.equal(state.calls.includes("read"), false);
  assert.equal(state.calls.includes("complete"), false);

  state = world();
  state.download = { ok: true, bytes: new Uint8Array(), contentType: "image/jpeg" };
  assert.equal((await invoke(providerBody())).status, 400);
  assert.equal(state.calls.includes("reserve"), false);
  assert.equal(state.calls.includes("complete"), false);
});

test("cache hits, a false provider flag, and geometry replay do not reserve", async () => {
  state.rows = [{ label: "Chair", confidence: 0.8, center_x: null, center_y: null, bbox: null }];
  const labels = await invoke(providerBody({ allowRoomReadOnMiss: false, mode: "labels_only" }));
  assert.equal(labels.status, 200);
  assert.deepEqual(await labels.json(), { objects: [{ label: "chair", confidence: 0.8 }] });
  assert.deepEqual(state.calls, ["authenticate", "cache"]);

  state = world();
  const miss = await invoke(providerBody({ allowRoomReadOnMiss: false, imageUrl: HOSTILE }));
  assert.deepEqual(await miss.json(), { objects: [] });
  assert.deepEqual(state.calls, ["authenticate", "cache"]);

  state = world();
  state.rows = [{
    label: "sofa",
    confidence: 0.9,
    center_x: 0.4,
    center_y: 0.6,
    bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  }];
  const replay = await invoke(providerBody({ mode: "geometry" }));
  assert.equal(replay.status, 200);
  const replayBody = await replay.json() as { objects: Array<{ bbox?: { w: number } }> };
  assert.equal(replayBody.objects[0]?.bbox?.w, 0.3);
  assert.equal(state.calls.includes("reserve"), false);
});

test("insufficient geometry still authorizes and reserves before a fresh read", async () => {
  state.rows = [{ label: "sofa", confidence: 0.4, center_x: null, center_y: null, bbox: null }];
  state.objects = [{ label: "sofa", confidence: 0.95, centerX: 0.2, centerY: 0.3 }];
  const response = await invoke(providerBody({ mode: "geometry" }));
  assert.equal(response.status, 200);
  assert.equal(state.calls.includes("reserve"), true);
  assert.ok(state.calls.indexOf("download") < state.calls.indexOf("reserve"));
  assert.ok(state.calls.indexOf("reserve") < state.calls.indexOf("read"));
  assert.ok(state.calls.indexOf("read") < state.calls.indexOf("complete"));
  assert.deepEqual(state.completeArgs, [{ userId: USER, attemptId: ATTEMPT, outcome: "succeeded" }]);
});

test("quota, overlap, and a broken reservation do not call Gemini", async () => {
  state.reservation = { status: "quota" };
  assert.equal((await invoke(providerBody())).status, 429);
  assert.equal(state.calls.includes("download"), true);
  assert.equal(state.calls.includes("reserve"), true);
  assert.equal(state.calls.includes("read"), false);
  assert.equal(state.calls.includes("complete"), false);

  state = world();
  state.reservation = { status: "busy" };
  const busy = await invoke(providerBody());
  assert.equal(busy.status, 429);
  assert.deepEqual(await busy.json(), { error: "Too many requests." });
  assert.equal(state.calls.includes("read"), false);
  assert.equal(state.calls.includes("complete"), false);

  state = world();
  state.reservation = { status: "unavailable" };
  const missing = await invoke(providerBody());
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { error: "Room image object retrieval failed." });
  assert.equal(state.calls.includes("read"), false);
  assert.equal(state.calls.includes("complete"), false);

  let held = false;
  let reads = 0;
  const overlapping = deps();
  overlapping.reserve = async (args) => {
    state.reserveArgs.push(args);
    if (held) return { status: "busy" };
    held = true;
    return { status: "reserved", attemptId: ATTEMPT };
  };
  overlapping.readRoom = async () => {
    reads += 1;
    return [{ label: "sofa", confidence: 0.5 }];
  };
  const [first, second] = await Promise.all([
    handleRoomImageObjectsRequest(request(providerBody()), overlapping),
    handleRoomImageObjectsRequest(request(providerBody()), overlapping),
  ]);
  const statuses = [(first.status), (second.status)].sort();
  assert.deepEqual(statuses, [200, 429]);
  assert.equal(reads, 1);
  assert.deepEqual(state.completeArgs, [{ userId: USER, attemptId: ATTEMPT, outcome: "succeeded" }]);
});

test("provider exceptions are generic and logs omit secrets and signed URLs", async () => {
  const secret = "upstream-secret-token";
  const signed = "https://sec20c-offline.example/storage/v1/object/sign/vibode-base-images/a.jpg?token=signed-secret";
  const failure = new Error(`Gemini room-read failed (500): ${secret} ${signed}`) as Error & { code?: string };
  failure.code = "HTTP_500";
  const custom = deps();
  custom.readRoom = async () => {
    throw failure;
  };
  const response = await handleRoomImageObjectsRequest(request(providerBody()), custom);
  assert.equal(response.status, 500);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body, { error: "Room image object retrieval failed." });
  assert.equal("message" in body, false);
  const rendered = JSON.stringify(logs);
  assert.equal(rendered.includes(secret), false);
  assert.equal(rendered.includes("signed-secret"), false);
  assert.equal(rendered.includes(OFFLINE_KEY), false);
  assert.equal(rendered.includes("completion-broke"), false);
  assert.deepEqual(state.completeArgs, [{ userId: USER, attemptId: ATTEMPT, outcome: "failed" }]);
  assert.equal(state.calls.includes("reserve"), true);
});

test("empty provider results and label-store failure still complete as succeeded", async () => {
  state.objects = [];
  const empty = await invoke(providerBody());
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { objects: [] });
  assert.equal(state.calls.includes("store"), false);
  assert.deepEqual(state.completeArgs, [{ userId: USER, attemptId: ATTEMPT, outcome: "succeeded" }]);

  state = world();
  state.storeThrows = true;
  const stored = await invoke(providerBody());
  assert.equal(stored.status, 200);
  assert.deepEqual(await stored.json(), { objects: [{ label: "sofa", confidence: 0.91 }] });
  assert.equal(state.calls.includes("store"), true);
  assert.deepEqual(state.completeArgs, [{ userId: USER, attemptId: ATTEMPT, outcome: "succeeded" }]);
});

test("a failed completion keeps the client response and logs only a safe reason", async () => {
  state.completion = { status: "unavailable" };
  const unavailable = await invoke(providerBody());
  assert.equal(unavailable.status, 200);
  assert.deepEqual(await unavailable.json(), { objects: [{ label: "sofa", confidence: 0.91 }] });
  const unavailableLogs = JSON.stringify(logs);
  assert.equal(unavailableLogs.includes("completion_failed"), true);
  assert.equal(unavailableLogs.includes("unavailable"), true);
  assert.equal(unavailableLogs.includes("signed-secret"), false);
  assert.equal(unavailableLogs.includes(HOSTILE), false);

  state = world();
  logs.length = 0;
  state.completionThrows = true;
  const thrown = await invoke(providerBody());
  assert.equal(thrown.status, 200);
  assert.deepEqual(await thrown.json(), { objects: [{ label: "sofa", confidence: 0.91 }] });
  const thrownLogs = JSON.stringify(logs);
  assert.equal(thrownLogs.includes("completion_failed"), true);
  assert.equal(thrownLogs.includes("exception"), true);
  assert.equal(thrownLogs.includes("completion-broke"), false);
});

test("the paid route wrapper forces gemini-3-flash-preview", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(input instanceof URL ? input.toString() : String(input));
    return Response.json({
      candidates: [{ content: { parts: [{ text: "{\"objects\":[{\"label\":\"sofa\",\"confidence\":0.4}]}" }] } }],
    });
  };
  process.env.GEMINI_API_KEY = OFFLINE_KEY;
  try {
    const bytes = jpeg();
    await readAuthorizedRoomImage({
      imageBytes: bytes,
      mimeType: "image/jpeg",
      mode: "geometry",
      purpose: "suggested-placement",
      userId: USER,
      roomId: ROOM,
      assetId: ASSET,
      versionId: ASSET,
      attemptId: ATTEMPT,
      requestId: "sec20c-offline-request",
      sourceTrigger: "suggested-placement",
      ...({ modelVersion: "gemini-2.5-pro" } as object),
    } as Parameters<typeof readAuthorizedRoomImage>[0]);
    assert.match(calls[0] ?? "", /\/models\/gemini-3-flash-preview:generateContent/);
    assert.equal((calls[0] ?? "").includes("gemini-2.5-pro"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("room-read stays a 404 and this patch does not edit unrelated product paths", async () => {
  const denied = await roomReadPost();
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: "Not found." });
  assert.equal(fetchCalls.length, 0);

  const route = readFileSync(path.join(process.cwd(), "app/api/vibode/room-image-objects/route.ts"), "utf8");
  assert.equal(route.includes("runGeminiRoomReadFromImageUrl"), false);
  assert.equal(route.includes("body.modelVersion"), false);
  assert.match(route, /image_url: null/);
  const reserveAt = route.indexOf("await deps.reserve");
  const downloadAt = route.indexOf("await deps.downloadOwnedImage");
  const readAt = route.indexOf("await deps.readRoom");
  const completeAt = route.indexOf("await deps.complete");
  assert.equal(downloadAt > 0 && downloadAt < reserveAt && reserveAt < readAt && readAt < completeAt, true);

  const changed = spawnSync("git", ["status", "--porcelain"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(changed.status, 0);
  const allowed = new Set([
    "app/api/vibode/room-image-objects/route.ts",
    "app/api/vibode/room-image-objects/route.test.ts",
    "app/api/vibode/room-read/route.test.ts",
    "lib/vibodeGeminiRoomRead.ts",
    "lib/vibodeGeminiRoomRead.test.ts",
    "lib/vibodeRoomImageObjectSecurity.ts",
    "lib/vibodeRoomImageObjectSecurity.test.ts",
    "supabase/migrations/20261023170000_reserve_vibode_room_image_read.sql",
    "supabase/migrations/20261023170000_reserve_vibode_room_image_read.postgres.test.ts",
  ]);
  for (const line of changed.stdout.split("\n")) {
    if (line.length < 4) continue;
    const file = line.slice(3).trim();
    assert.equal(allowed.has(file), true, line);
  }
  for (const file of [
    "app/api/vibode/room-read/route.ts",
    "app/api/stripe/topup/route.ts",
    "app/api/stripe/checkout/route.ts",
    "app/api/stripe/portal/route.ts",
  ]) {
    const head = spawnSync("git", ["show", `HEAD:${file}`], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(head.status, 0, file);
    assert.equal(readFileSync(path.join(process.cwd(), file), "utf8"), head.stdout, file);
  }
});
