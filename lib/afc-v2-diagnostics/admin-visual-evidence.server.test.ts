import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { AFC_V2_ORIGINAL_STORAGE_BUCKET } from "@/lib/afc-v2-production/production-store";
import { afcDiagnosticsAdminJson } from "./admin-auth.server";
import {
  AFC_DIAGNOSTIC_ORIGINAL_HISTORY_LIMIT,
  AFC_DIAGNOSTIC_VISUAL_MAX_BYTES,
  detectAllowedImageMime,
  handleAfcDiagnosticsAdminVisualArtifactGet,
  parseAfcDiagnosticVisualArtifactKind,
  resolveAfcDiagnosticVisualArtifact,
  type AfcDiagnosticVisualCaseRecord,
  type AfcDiagnosticVisualDurableEmptyRecord,
  type AfcDiagnosticVisualDurableTiledRecord,
  type AfcDiagnosticVisualEvidenceLog,
  type AfcDiagnosticVisualEvidenceStore,
  type AfcDiagnosticVisualGenerationRecord,
  type AfcDiagnosticVisualMembershipRecord,
  type AfcDiagnosticVisualRoomAssetRecord,
  type AfcDiagnosticVisualRoomPointer,
  type AfcDiagnosticVisualSessionRecord,
} from "./admin-visual-evidence.server";

const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_SESSION = "99999999-9999-4999-8999-999999999999";
const ASSET_CURRENT = "88888888-8888-4888-8888-888888888888";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";

function jpegBytes(tag = 1): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, tag, 10, 20, 30]);
}

function pngBytes(tag = 1): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag,
  ]);
}

function webpBytes(tag = 1): Uint8Array {
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, tag, 1, 2, 3,
  ]);
}

function heicBytes(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
  ]);
}

function jsonBytes(): Uint8Array {
  return new TextEncoder().encode('{"error":true}');
}

const JPEG = jpegBytes(1);
const JPEG_B = jpegBytes(2);
const PNG = pngBytes(1);
const WEBP = webpBytes(1);
const HEIC = heicBytes();
const JSON_BYTES = jsonBytes();
const JPEG_SHA = sha256Hex(JPEG);
const JPEG_B_SHA = sha256Hex(JPEG_B);
const PNG_SHA = sha256Hex(PNG);
const WEBP_SHA = sha256Hex(WEBP);
const HEIC_SHA = sha256Hex(HEIC);
const JSON_SHA = sha256Hex(JSON_BYTES);

function ownedPath(userId: string, name: string): string {
  return `users/${userId}/${name}`;
}

function objectKey(bucket: string, path: string): string {
  return `${bucket}::${path}`;
}

class MemoryVisualStore implements AfcDiagnosticVisualEvidenceStore {
  downloads: string[] = [];
  listedLimits: number[] = [];
  cases = new Map<string, AfcDiagnosticVisualCaseRecord>();
  sessions = new Map<string, AfcDiagnosticVisualSessionRecord>();
  memberships = new Map<string, AfcDiagnosticVisualMembershipRecord>();
  generations = new Map<string, AfcDiagnosticVisualGenerationRecord>();
  assets = new Map<string, AfcDiagnosticVisualRoomAssetRecord>();
  rooms = new Map<string, AfcDiagnosticVisualRoomPointer>();
  durableEmpty = new Map<string, AfcDiagnosticVisualDurableEmptyRecord>();
  durableTiled = new Map<string, AfcDiagnosticVisualDurableTiledRecord>();
  objects = new Map<string, Uint8Array>();
  failNext = false;

  putObject(bucket: string, path: string, bytes: Uint8Array) {
    this.objects.set(objectKey(bucket, path), bytes);
  }

  async findCaseById(caseId: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("boom");
    }
    return this.cases.get(caseId) ?? null;
  }
  async findSessionById(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }
  async findMembership(sessionId: string, generationId: string) {
    return this.memberships.get(`${sessionId}:${generationId}`) ?? null;
  }
  async findGenerationById(generationId: string) {
    return this.generations.get(generationId) ?? null;
  }
  async findRoomAssetById(assetId: string) {
    return this.assets.get(assetId) ?? null;
  }
  async findRoomPointer(roomId: string) {
    return this.rooms.get(roomId) ?? null;
  }
  async listRecentRoomAssets(roomId: string, userId: string, limit: number) {
    this.listedLimits.push(limit);
    return [...this.assets.values()]
      .filter(
        (asset) =>
          asset.roomId === roomId &&
          asset.userId === userId &&
          !!asset.storagePath,
      )
      .sort((left, right) =>
        String(right.createdAt).localeCompare(String(left.createdAt)),
      )
      .slice(0, limit);
  }
  async findDurableEmpty(userId: string, originalSha256: string) {
    return this.durableEmpty.get(`${userId}:${originalSha256}`) ?? null;
  }
  async findDurableTiled(userId: string, cacheKey: string) {
    return this.durableTiled.get(`${userId}:${cacheKey}`) ?? null;
  }
  async download(bucket: string, path: string) {
    this.downloads.push(objectKey(bucket, path));
    const bytes = this.objects.get(objectKey(bucket, path));
    return bytes ? Uint8Array.from(bytes) : null;
  }
}

function typicalGeneration(
  overrides: Partial<AfcDiagnosticVisualGenerationRecord> = {},
): AfcDiagnosticVisualGenerationRecord {
  return {
    id: GEN_1,
    roomId: ROOM_A,
    userId: USER_A,
    originalSha256: JPEG_SHA,
    originalDecodedWidth: 1200,
    originalDecodedHeight: 800,
    originalByteCount: JPEG.byteLength,
    originalMimeType: "image/jpeg",
    emptySha256: PNG_SHA,
    emptyDecodedWidth: 1200,
    emptyDecodedHeight: 800,
    emptyByteCount: PNG.byteLength,
    emptyMimeType: "image/png",
    emptyStorageBucket: "vibode-afc-v2",
    emptyStoragePath: `users/${USER_A}/empty.png`,
    tiledSha256: WEBP_SHA,
    tiledDecodedWidth: 1200,
    tiledDecodedHeight: 800,
    tiledByteCount: WEBP.byteLength,
    tiledMimeType: "image/webp",
    tiledStorageBucket: "vibode-afc-v2",
    tiledStoragePath: `users/${USER_A}/tiled.webp`,
    tiledCacheKey: `cache-${PNG_SHA}`,
    ...overrides,
  };
}

function typicalStore(overrides?: {
  generation?: Partial<AfcDiagnosticVisualGenerationRecord>;
}): MemoryVisualStore {
  const store = new MemoryVisualStore();
  store.cases.set(CASE_1, {
    id: CASE_1,
    sessionId: SESSION_A,
    roomId: ROOM_A,
  });
  store.sessions.set(SESSION_A, {
    id: SESSION_A,
    roomId: ROOM_A,
    userId: USER_A,
    baseAssetId: ASSET_SESSION,
  });
  store.memberships.set(`${SESSION_A}:${GEN_1}`, {
    sessionId: SESSION_A,
    generationId: GEN_1,
  });
  store.generations.set(GEN_1, typicalGeneration(overrides?.generation));
  store.assets.set(ASSET_SESSION, {
    id: ASSET_SESSION,
    roomId: ROOM_A,
    userId: USER_A,
    storageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
    storagePath: ownedPath(USER_A, "session.jpg"),
    createdAt: "2026-09-18T12:00:00.000Z",
  });
  store.assets.set(ASSET_CURRENT, {
    id: ASSET_CURRENT,
    roomId: ROOM_A,
    userId: USER_A,
    storageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
    storagePath: ownedPath(USER_A, "current.jpg"),
    createdAt: "2026-09-18T13:00:00.000Z",
  });
  store.rooms.set(ROOM_A, {
    id: ROOM_A,
    userId: USER_A,
    baseAssetId: ASSET_CURRENT,
  });
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "session.jpg"),
    JPEG,
  );
  store.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, PNG);
  store.putObject("vibode-afc-v2", `users/${USER_A}/tiled.webp`, WEBP);
  return store;
}

async function resolve(
  store: AfcDiagnosticVisualEvidenceStore,
  kind: "original" | "empty" | "tiled",
  inspect?: (bytes: Uint8Array) => Promise<{ width: number; height: number } | null>,
) {
  return resolveAfcDiagnosticVisualArtifact({
    store,
    caseId: CASE_1,
    generationId: GEN_1,
    kind,
    inspectDimensions: inspect ?? (async () => ({ width: 1200, height: 800 })),
  });
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("kind parser accepts only original/empty/tiled", () => {
  assert.equal(parseAfcDiagnosticVisualArtifactKind("original"), "original");
  assert.equal(parseAfcDiagnosticVisualArtifactKind("empty"), "empty");
  assert.equal(parseAfcDiagnosticVisualArtifactKind("tiled"), "tiled");
  assert.equal(parseAfcDiagnosticVisualArtifactKind("ORIGINAL"), null);
  assert.equal(parseAfcDiagnosticVisualArtifactKind("overlay"), null);
  assert.equal(parseAfcDiagnosticVisualArtifactKind(""), null);
});

test("MIME detector accepts jpeg/png/webp and rejects HEIC/JSON", () => {
  assert.equal(detectAllowedImageMime(JPEG), "image/jpeg");
  assert.equal(detectAllowedImageMime(PNG), "image/png");
  assert.equal(detectAllowedImageMime(WEBP), "image/webp");
  assert.equal(detectAllowedImageMime(HEIC), null);
  assert.equal(detectAllowedImageMime(JSON_BYTES), null);
  assert.equal(detectAllowedImageMime(new Uint8Array()), null);
});

test("membership chain: missing case/session/membership is 404", async () => {
  const missingCase = typicalStore();
  missingCase.cases.clear();
  await assert.rejects(() => resolve(missingCase, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });

  const missingSession = typicalStore();
  missingSession.sessions.clear();
  await assert.rejects(() => resolve(missingSession, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });

  const missingMembership = typicalStore();
  missingMembership.memberships.clear();
  await assert.rejects(() => resolve(missingMembership, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });
  assert.equal(missingMembership.downloads.length, 0);
});

test("cross-session generation is 404 and does not reveal existence", async () => {
  const store = typicalStore();
  store.sessions.set(SESSION_B, {
    id: SESSION_B,
    roomId: ROOM_A,
    userId: USER_A,
    baseAssetId: null,
  });
  store.generations.set(GEN_2, typicalGeneration({ id: GEN_2 }));
  store.memberships.set(`${SESSION_B}:${GEN_2}`, {
    sessionId: SESSION_B,
    generationId: GEN_2,
  });
  await assert.rejects(
    () =>
      resolveAfcDiagnosticVisualArtifact({
        store,
        caseId: CASE_1,
        generationId: GEN_2,
        kind: "empty",
      }),
    { name: "AfcDiagnosticVisualNotFoundError" },
  );
  assert.equal(store.downloads.length, 0);
});

test("wrong room or user is 404", async () => {
  const wrongRoom = typicalStore({
    generation: { roomId: ROOM_B },
  });
  await assert.rejects(() => resolve(wrongRoom, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });

  const wrongUser = typicalStore({
    generation: { userId: USER_B },
  });
  await assert.rejects(() => resolve(wrongUser, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });
});

test("ORIGINAL session base asset exact hash match wins", async () => {
  const store = typicalStore();
  const result = await resolve(store, "original");
  assert.equal(result.mimeType, "image/jpeg");
  assert.deepEqual([...result.bytes], [...JPEG]);
  assert.equal(
    store.downloads[0],
    objectKey(AFC_V2_ORIGINAL_STORAGE_BUCKET, ownedPath(USER_A, "session.jpg")),
  );
  assert.equal(store.listedLimits.length, 0);
});

test("ORIGINAL current room asset exact hash match is used after session miss", async () => {
  const store = typicalStore();
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "session.jpg"),
    JPEG_B,
  );
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "current.jpg"),
    JPEG,
  );
  const result = await resolve(store, "original");
  assert.deepEqual([...result.bytes], [...JPEG]);
  assert.ok(
    store.downloads.includes(
      objectKey(AFC_V2_ORIGINAL_STORAGE_BUCKET, ownedPath(USER_A, "current.jpg")),
    ),
  );
});

test("ORIGINAL historical room asset exact hash match wins after earlier misses", async () => {
  const store = typicalStore();
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "session.jpg"),
    JPEG_B,
  );
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "current.jpg"),
    JPEG_B,
  );
  const historicalId = "77777777-7777-4777-8777-777777777777";
  store.assets.set(historicalId, {
    id: historicalId,
    roomId: ROOM_A,
    userId: USER_A,
    storageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
    storagePath: ownedPath(USER_A, "history.jpg"),
    createdAt: "2026-09-17T12:00:00.000Z",
  });
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "history.jpg"),
    JPEG,
  );
  const result = await resolve(store, "original");
  assert.deepEqual([...result.bytes], [...JPEG]);
});

test("ORIGINAL all candidates missing is 404", async () => {
  const store = typicalStore();
  store.objects.clear();
  await assert.rejects(() => resolve(store, "original"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });
});

test("ORIGINAL all candidates mismatched is 409", async () => {
  const store = typicalStore();
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "session.jpg"),
    JPEG_B,
  );
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "current.jpg"),
    JPEG_B,
  );
  await assert.rejects(() => resolve(store, "original"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
});

test("ORIGINAL historical scan is bounded to 8", async () => {
  const store = typicalStore();
  store.sessions.set(SESSION_A, {
    id: SESSION_A,
    roomId: ROOM_A,
    userId: USER_A,
    baseAssetId: null,
  });
  store.rooms.set(ROOM_A, {
    id: ROOM_A,
    userId: USER_A,
    baseAssetId: null,
  });
  store.objects.clear();
  for (let index = 0; index < 12; index += 1) {
    const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const path = ownedPath(USER_A, `hist-${index}.jpg`);
    store.assets.set(id, {
      id,
      roomId: ROOM_A,
      userId: USER_A,
      storageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
      storagePath: path,
      createdAt: `2026-09-${String(18 - index).padStart(2, "0")}T12:00:00.000Z`,
    });
    store.putObject(AFC_V2_ORIGINAL_STORAGE_BUCKET, path, JPEG_B);
  }
  await assert.rejects(() => resolve(store, "original"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
  assert.deepEqual(store.listedLimits, [AFC_DIAGNOSTIC_ORIGINAL_HISTORY_LIMIT]);
  assert.equal(store.downloads.length, AFC_DIAGNOSTIC_ORIGINAL_HISTORY_LIMIT);
});

test("ORIGINAL current room mismatch is never displayed when a later candidate matches", async () => {
  const store = typicalStore();
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "session.jpg"),
    JPEG_B,
  );
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "current.jpg"),
    JPEG_B,
  );
  const historicalId = "66666666-6666-4666-8666-666666666666";
  store.assets.set(historicalId, {
    id: historicalId,
    roomId: ROOM_A,
    userId: USER_A,
    storageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
    storagePath: ownedPath(USER_A, "older.jpg"),
    createdAt: "2026-09-10T12:00:00.000Z",
  });
  store.putObject(
    AFC_V2_ORIGINAL_STORAGE_BUCKET,
    ownedPath(USER_A, "older.jpg"),
    JPEG,
  );
  const result = await resolve(store, "original");
  assert.deepEqual([...result.bytes], [...JPEG]);
  assert.notDeepEqual([...result.bytes], [...JPEG_B]);
});

test("EMPTY generation-local bytes match", async () => {
  const result = await resolve(typicalStore(), "empty");
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual([...result.bytes], [...PNG]);
});

test("EMPTY generation-local mismatch is 409 and skips durable", async () => {
  const store = typicalStore();
  store.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, JPEG);
  store.durableEmpty.set(`${USER_A}:${JPEG_SHA}`, {
    userId: USER_A,
    originalSha256: JPEG_SHA,
    emptySha256: PNG_SHA,
    byteCount: PNG.byteLength,
    mimeType: "image/png",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-empty.png`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-empty.png`, PNG);
  await assert.rejects(() => resolve(store, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
  assert.equal(
    store.downloads.includes(
      objectKey("vibode-afc-v2", `users/${USER_A}/durable-empty.png`),
    ),
    false,
  );
});

test("EMPTY missing generation-local object falls back to durable exact SHA", async () => {
  const store = typicalStore();
  store.durableEmpty.set(`${USER_A}:${JPEG_SHA}`, {
    userId: USER_A,
    originalSha256: JPEG_SHA,
    emptySha256: PNG_SHA,
    byteCount: PNG.byteLength,
    mimeType: "image/png",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-empty.png`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-empty.png`, PNG);
  store.objects.delete(objectKey("vibode-afc-v2", `users/${USER_A}/empty.png`));
  const result = await resolve(store, "empty");
  assert.deepEqual([...result.bytes], [...PNG]);
  assert.ok(
    store.downloads.includes(
      objectKey("vibode-afc-v2", `users/${USER_A}/durable-empty.png`),
    ),
  );
});

test("EMPTY missing generation-local path falls back to durable exact SHA", async () => {
  const store = typicalStore({
    generation: { emptyStoragePath: null, emptyStorageBucket: null },
  });
  store.durableEmpty.set(`${USER_A}:${JPEG_SHA}`, {
    userId: USER_A,
    originalSha256: JPEG_SHA,
    emptySha256: PNG_SHA,
    byteCount: PNG.byteLength,
    mimeType: "image/png",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-empty.png`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-empty.png`, PNG);
  const result = await resolve(store, "empty");
  assert.deepEqual([...result.bytes], [...PNG]);
});

test("EMPTY generation-local wins when durable also exists", async () => {
  const store = typicalStore();
  store.durableEmpty.set(`${USER_A}:${JPEG_SHA}`, {
    userId: USER_A,
    originalSha256: JPEG_SHA,
    emptySha256: PNG_SHA,
    byteCount: PNG.byteLength,
    mimeType: "image/png",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-empty.png`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-empty.png`, PNG);
  const result = await resolve(store, "empty");
  assert.deepEqual([...result.bytes], [...PNG]);
  assert.equal(
    store.downloads.includes(
      objectKey("vibode-afc-v2", `users/${USER_A}/durable-empty.png`),
    ),
    false,
  );
});

test("EMPTY durable fallback with wrong SHA is 409", async () => {
  const store = typicalStore({
    generation: { emptyStoragePath: null },
  });
  store.durableEmpty.set(`${USER_A}:${JPEG_SHA}`, {
    userId: USER_A,
    originalSha256: JPEG_SHA,
    emptySha256: JPEG_B_SHA,
    byteCount: JPEG_B.byteLength,
    mimeType: "image/jpeg",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-empty.png`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-empty.png`, JPEG_B);
  await assert.rejects(() => resolve(store, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
});

test("EMPTY missing bytes is 404", async () => {
  const store = typicalStore({
    generation: { emptyStoragePath: null, emptySha256: PNG_SHA },
  });
  await assert.rejects(() => resolve(store, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });
});

test("running generation without EMPTY SHA is 404", async () => {
  const store = typicalStore({
    generation: {
      emptySha256: null,
      emptyStoragePath: null,
      emptyByteCount: null,
    },
  });
  await assert.rejects(() => resolve(store, "empty"), {
    name: "AfcDiagnosticVisualNotFoundError",
  });
});

test("TILED generation-local bytes match", async () => {
  const result = await resolve(typicalStore(), "tiled");
  assert.equal(result.mimeType, "image/webp");
  assert.deepEqual([...result.bytes], [...WEBP]);
});

test("TILED generation-local mismatch is 409", async () => {
  const store = typicalStore();
  store.putObject("vibode-afc-v2", `users/${USER_A}/tiled.webp`, PNG);
  await assert.rejects(() => resolve(store, "tiled"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
});

test("TILED missing generation-local uses durable exact SHA", async () => {
  const store = typicalStore({
    generation: { tiledStoragePath: null, tiledStorageBucket: null },
  });
  store.durableTiled.set(`${USER_A}:cache-${PNG_SHA}`, {
    userId: USER_A,
    cacheKey: `cache-${PNG_SHA}`,
    emptySha256: PNG_SHA,
    tiledSha256: WEBP_SHA,
    byteCount: WEBP.byteLength,
    mimeType: "image/webp",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-tiled.webp`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-tiled.webp`, WEBP);
  const result = await resolve(store, "tiled");
  assert.deepEqual([...result.bytes], [...WEBP]);
});

test("TILED durable EMPTY SHA incompatibility is 409", async () => {
  const store = typicalStore({
    generation: { tiledStoragePath: null },
  });
  store.durableTiled.set(`${USER_A}:cache-${PNG_SHA}`, {
    userId: USER_A,
    cacheKey: `cache-${PNG_SHA}`,
    emptySha256: JPEG_B_SHA,
    tiledSha256: WEBP_SHA,
    byteCount: WEBP.byteLength,
    mimeType: "image/webp",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-tiled.webp`,
  });
  store.putObject("vibode-afc-v2", `users/${USER_A}/durable-tiled.webp`, WEBP);
  await assert.rejects(() => resolve(store, "tiled"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
});

test("TILED durable wrong SHA is 409", async () => {
  const store = typicalStore({
    generation: { tiledStoragePath: null },
  });
  store.durableTiled.set(`${USER_A}:cache-${PNG_SHA}`, {
    userId: USER_A,
    cacheKey: `cache-${PNG_SHA}`,
    emptySha256: PNG_SHA,
    tiledSha256: JPEG_B_SHA,
    byteCount: 1,
    mimeType: "image/jpeg",
    storageBucket: "vibode-afc-v2",
    storagePath: `users/${USER_A}/durable-tiled.webp`,
  });
  await assert.rejects(() => resolve(store, "tiled"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
});

test("integrity: SHA mismatch, byte count, MIME, stored MIME, zero-byte, oversize", async () => {
  const shaMismatch = typicalStore();
  shaMismatch.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, JPEG);
  await assert.rejects(() => resolve(shaMismatch, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });

  const byteCount = typicalStore({
    generation: { emptyByteCount: PNG.byteLength + 5 },
  });
  await assert.rejects(() => resolve(byteCount, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });

  const storedMime = typicalStore({
    generation: { emptyMimeType: "image/jpeg" },
  });
  await assert.rejects(() => resolve(storedMime, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });

  const zero = typicalStore();
  zero.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, new Uint8Array());
  await assert.rejects(() => resolve(zero, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });

  const oversize = typicalStore({
    generation: { emptyByteCount: AFC_DIAGNOSTIC_VISUAL_MAX_BYTES + 1 },
  });
  await assert.rejects(() => resolve(oversize, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
  assert.equal(oversize.downloads.length, 0);

  const heic = typicalStore({
    generation: {
      emptySha256: HEIC_SHA,
      emptyByteCount: HEIC.byteLength,
      emptyMimeType: null,
    },
  });
  heic.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, HEIC);
  await assert.rejects(() => resolve(heic, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });

  const json = typicalStore({
    generation: {
      emptySha256: JSON_SHA,
      emptyByteCount: JSON_BYTES.byteLength,
      emptyMimeType: null,
    },
  });
  json.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, JSON_BYTES);
  await assert.rejects(() => resolve(json, "empty"), {
    name: "AfcDiagnosticVisualIntegrityError",
  });
});

test("valid jpeg/png/webp succeed", async () => {
  const jpeg = await resolve(typicalStore(), "original");
  assert.equal(jpeg.mimeType, "image/jpeg");
  const png = await resolve(typicalStore(), "empty");
  assert.equal(png.mimeType, "image/png");
  const webp = await resolve(typicalStore(), "tiled");
  assert.equal(webp.mimeType, "image/webp");
});

test("route handle maps auth, validation, missing, integrity, and success headers", async () => {
  const logs: AfcDiagnosticVisualEvidenceLog[] = [];
  const inspect = async () => ({ width: 1200, height: 800 });

  const unauth = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
    store: typicalStore(),
    authorize: async () => ({
      ok: false,
      response: afcDiagnosticsAdminJson({ error: "Unauthorized." }, 401),
    }),
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(unauth.status, 401);

  const forbidden = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
    store: typicalStore(),
    authorize: async () => ({
      ok: false,
      response: afcDiagnosticsAdminJson(
        { error: "Admin access required." },
        403,
      ),
    }),
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(forbidden.status, 403);

  const admin = {
    ok: true as const,
    admin: { userId: ADMIN_ID, email: "admin@example.com" },
  };

  const invalidCase = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: "not-a-uuid",
    generationId: GEN_1,
    kind: "empty",
    store: typicalStore(),
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(invalidCase.status, 400);
  assert.deepEqual(await jsonBody(invalidCase), { error: "Invalid request." });

  const invalidGen = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: "bad",
    kind: "empty",
    store: typicalStore(),
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(invalidGen.status, 400);

  const invalidKind = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "overlay",
    store: typicalStore(),
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(invalidKind.status, 400);

  const missing = typicalStore();
  missing.cases.clear();
  const notFound = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
    store: missing,
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(notFound.status, 404);
  assert.deepEqual(await jsonBody(notFound), { error: "Not found." });

  const mismatchStore = typicalStore();
  mismatchStore.putObject("vibode-afc-v2", `users/${USER_A}/empty.png`, JPEG);
  const conflict = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
    store: mismatchStore,
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(conflict.status, 409);
  const conflictBody = await jsonBody(conflict);
  assert.deepEqual(conflictBody, {
    error: "Artifact evidence could not be verified.",
  });
  assert.doesNotMatch(JSON.stringify(conflictBody), /storage_path|vibode-afc-v2|sha256/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.kind, "empty");
  assert.equal(logs[0]?.caseId, CASE_1);
  assert.doesNotMatch(JSON.stringify(logs[0]), /users\/|storage_path|service_role/);

  const boom = typicalStore();
  boom.failNext = true;
  const serverError = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
    store: boom,
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(serverError.status, 500);
  assert.deepEqual(await jsonBody(serverError), { error: "Server error." });

  const success = await handleAfcDiagnosticsAdminVisualArtifactGet({
    request: new Request("http://localhost/x"),
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
    store: typicalStore(),
    authorize: async () => admin,
    inspectDimensions: inspect,
    log: (entry) => logs.push(entry),
  });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("Content-Type"), "image/png");
  assert.equal(success.headers.get("Cache-Control"), "private, no-store");
  assert.equal(success.headers.get("X-Content-Type-Options"), "nosniff");
  const bytes = new Uint8Array(await success.arrayBuffer());
  assert.deepEqual([...bytes], [...PNG]);
  const headerBlob = [
    ...success.headers.entries(),
  ]
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
  assert.doesNotMatch(
    headerBlob,
    /signedUrl|storage_path|vibode-afc-v2|production_authority/i,
  );
});
