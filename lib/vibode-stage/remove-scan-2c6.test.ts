import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { REMOVE_CLEANUP_CONCEPT_SET } from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  initialRemoveObjectUiState,
  reduceRemoveObjectSession,
  removeObjectUiRequestBody,
  type RemoveObjectUiIdentity,
  type RemoveObjectUiState,
} from "@/lib/vibode-stage/remove-object-ui";
import {
  handleRemoveObjectsAdmin,
  type RemoveObjectsAdminDeps,
  type RemoveVocabularyProfileRead,
} from "@/lib/vibode-stage/remove-segmentation-admin";
import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";
import {
  REMOVE_SEGMENTATION_CONCEPT_SET,
  REMOVE_SEGMENTATION_CONCEPTS_BEDROOM,
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_CONCEPTS_V2,
  selectRemoveScanVocabulary,
} from "@/lib/vibode-stage/remove-segmentation";
import {
  REMOVE_VOCABULARY_PROFILE_PATH,
  REMOVE_VOCABULARY_SAVE_ERROR,
  REMOVE_VOCABULARY_SCAN_CONFIRMATION,
  applyRemoveVocabularySave,
  displayedRemoveVocabularyChoice,
  initialRemoveVocabularyConfirmState,
  readRemoveVocabularyProfileResponse,
  removeVocabularyProfileRequestBody,
  requestRemoveVocabularyChange,
  requestRemoveVocabularyProfile,
  saveRemoveVocabularyProfile,
} from "@/lib/vibode-stage/remove-vocabulary-profile";
import {
  REMOVE_VOCABULARY_ORIGINAL_SHA_COLUMN,
  REMOVE_VOCABULARY_PROFILE_COLUMN,
  handleRemoveVocabularyProfileGet,
  handleRemoveVocabularyProfilePost,
  readStoredRemoveVocabularyProfile,
  writeStoredRemoveVocabularyProfile,
  type RemoveVocabularyProfileDeps,
} from "@/lib/vibode-stage/remove-vocabulary-profile.server";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const LATER = "33333333-3333-4333-8333-333333333333";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGINAL_BYTES = Uint8Array.from([9, 9, 9, 9]);
const ORIGINAL_SHA = sha256Hex(ORIGINAL_BYTES);
const OTHER_SHA = "cd".repeat(32);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height, 20);
  for (let y = 0; y < height; y += 1) raw[y * stride] = 0;
  return Uint8Array.from(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

const EMPTY_PNG = png(32, 32);
const EMPTY_SHA = sha256Hex(EMPTY_PNG);

function identity(sha256: string, byteCount: number) {
  return {
    sha256,
    byteCount,
    decodedWidth: 32,
    decodedHeight: 32,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  };
}

function generation(id = GENERATION, sha = ORIGINAL_SHA, byteCount = ORIGINAL_BYTES.byteLength): AfcGenerationRecord {
  return {
    id,
    roomId: ROOM,
    userId: ACTOR,
    status: "ready",
    original: identity(sha, byteCount),
    empty: identity(EMPTY_SHA, EMPTY_PNG.byteLength),
    emptyArtifactSource: "durable",
    emptyStoragePath: "secret/empty-object",
    frame: { width: 32, height: 32 },
    productionAuthority: {
      status: "ready",
      generationId: id,
      frame: { width: 32, height: 32 },
      frozenCamera: { frame: { width: 32, height: 32 } },
    },
    artifactLineage: null,
  } as AfcGenerationRecord;
}

function room(userId = ACTOR, generationId: string | null = GENERATION): AfcRoomPointer {
  return {
    id: ROOM,
    userId,
    currentAfcGenerationId: generationId,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
}

function promptsFor(concepts: readonly string[]) {
  return {
    time: 0.2,
    prompt_results: concepts.map((text, promptIndex) => ({
      prompt_index: promptIndex,
      echo: { prompt_index: promptIndex, type: "text", text, num_boxes: 0 },
      predictions: [],
    })),
  };
}

function scanHarness(input: {
  profile?: RemoveVocabularyProfileRead;
  generationId?: string;
  originalSha?: string;
  userId?: string;
} = {}) {
  const calls = { reserve: 0, fetch: 0, profile: 0 };
  const sent: string[] = [];
  const activeGeneration = input.generationId ?? GENERATION;
  const activeSha = input.originalSha ?? ORIGINAL_SHA;
  const deps: RemoveObjectsAdminDeps = {
    getAdmin: async () => ({ id: input.userId ?? ACTOR }),
    createStore: () => ({
      async getRoom() {
        return room(input.userId ?? ACTOR, activeGeneration);
      },
      async getGeneration() {
        return generation(activeGeneration, activeSha);
      },
      async getArtifact() {
        return EMPTY_PNG;
      },
    }),
    createService: () => ({ service: true }),
    loadOriginal: async () => ({ ok: true, bytes: ORIGINAL_BYTES }),
    readVocabularyProfile: async () => {
      calls.profile += 1;
      return input.profile ?? { ok: true, profile: null, originalSha256: null };
    },
    reserveSegmentation: async () => {
      calls.reserve += 1;
      return { ok: true };
    },
    provider: createRoboflowRemoveSegmentationProvider({
      apiKey: "roboflow-test-key",
      fetch: async (_url, init) => {
        calls.fetch += 1;
        const body = String(init?.body);
        sent.push(body);
        const concepts = (JSON.parse(body) as { prompts: Array<{ text: string }> }).prompts.map((prompt) => prompt.text);
        return Response.json(promptsFor(concepts));
      },
    }),
  };
  return { calls, deps, sent };
}

async function scan(input: Parameters<typeof scanHarness>[0] = {}) {
  const world = scanHarness(input);
  const response = await handleRemoveObjectsAdmin(new Request("http://127.0.0.1/api/vibode/admin/remove-objects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: ROOM, generationId: input.generationId ?? GENERATION }),
  }), world.deps);
  return { response, ...world };
}

function post(body: unknown): Request {
  return new Request(`http://127.0.0.1${REMOVE_VOCABULARY_PROFILE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function conceptsSent(sent: string): string[] {
  return (JSON.parse(sent) as { prompts: Array<{ text: string }> }).prompts.map((prompt) => prompt.text);
}

test("missing, malformed, and stale profiles scan with V2", async () => {
  const cases: RemoveVocabularyProfileRead[] = [
    { ok: true, profile: null, originalSha256: null },
    { ok: true, profile: "default", originalSha256: null },
    { ok: true, profile: "kitchen", originalSha256: ORIGINAL_SHA },
    { ok: true, profile: "bedroom", originalSha256: OTHER_SHA },
    { ok: true, profile: "BEDROOM", originalSha256: ORIGINAL_SHA },
  ];
  for (const profile of cases) {
    const result = await scan({ profile });
    assert.equal(result.response.status, 200, JSON.stringify(profile));
    assert.equal(result.calls.profile, 1);
    assert.equal(result.calls.reserve, 1);
    assert.equal(result.calls.fetch, 1);
    assert.deepEqual(conceptsSent(result.sent[0] ?? ""), [...REMOVE_SEGMENTATION_CONCEPTS_V2]);
  }
});

test("a matching bedroom profile selects the bedroom list and a matching default stays on V2", async () => {
  const bedroom = await scan({
    profile: { ok: true, profile: "bedroom", originalSha256: ORIGINAL_SHA },
  });
  assert.equal(bedroom.response.status, 200);
  assert.equal(bedroom.calls.reserve, 1);
  assert.equal(bedroom.calls.fetch, 1);
  assert.deepEqual(conceptsSent(bedroom.sent[0] ?? ""), [...REMOVE_SEGMENTATION_CONCEPTS_BEDROOM]);
  const payload = await bedroom.response.json() as { conceptSet?: string };
  assert.equal(payload.conceptSet, REMOVE_SEGMENTATION_CONCEPT_SET);

  const explicitDefault = await scan({
    profile: { ok: true, profile: "default", originalSha256: ORIGINAL_SHA },
  });
  assert.deepEqual(conceptsSent(explicitDefault.sent[0] ?? ""), [...REMOVE_SEGMENTATION_CONCEPTS_V2]);
  assert.equal(explicitDefault.calls.fetch, 1);
});

test("the same ORIGINAL hash stays valid on a later generation and a different hash uses V2", async () => {
  const later = await scan({
    generationId: LATER,
    profile: { ok: true, profile: "bedroom", originalSha256: ORIGINAL_SHA },
  });
  assert.equal(later.response.status, 200);
  assert.deepEqual(conceptsSent(later.sent[0] ?? ""), [...REMOVE_SEGMENTATION_CONCEPTS_BEDROOM]);
  assert.equal(later.calls.fetch, 1);

  assert.deepEqual([...selectRemoveScanVocabulary({
    profile: "bedroom",
    originalSha256: ORIGINAL_SHA,
    verifiedOriginalSha256: OTHER_SHA,
  })], [...REMOVE_SEGMENTATION_CONCEPTS_V2]);
});

test("a profile read failure returns 503 before quota reservation", async () => {
  const failed = await scan({ profile: { ok: false, code: "unavailable" } });
  assert.equal(failed.response.status, 503);
  assert.equal(failed.calls.profile, 1);
  assert.equal(failed.calls.reserve, 0);
  assert.equal(failed.calls.fetch, 0);
  const missing = await scan({ profile: { ok: false, code: "not_found" } });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.calls.reserve, 0);
});

test("profile writes are owner-only, exact, and conditional on the current generation", async () => {
  const calls = { load: 0, read: 0, write: 0, generationId: "" };
  let currentGeneration: string | null = GENERATION;
  let owner = ACTOR;
  let race = false;
  const deps = (): RemoveVocabularyProfileDeps => ({
    getActor: async () => ({ id: ACTOR }),
    createStore: () => ({
      async getRoom() {
        return room(owner, currentGeneration);
      },
      async getGeneration(id) {
        return generation(id);
      },
    }),
    loadOriginal: async () => {
      calls.load += 1;
      return { ok: true, bytes: ORIGINAL_BYTES };
    },
    readProfile: async () => {
      calls.read += 1;
      return { ok: true, profile: "bedroom", originalSha256: ORIGINAL_SHA };
    },
    writeProfile: async (input) => {
      calls.write += 1;
      calls.generationId = input.generationId;
      assert.equal(input.originalSha256, ORIGINAL_SHA);
      assert.equal(input.userId, ACTOR);
      if (race) {
        currentGeneration = LATER;
        return { ok: false, code: "conflict" };
      }
      if (input.generationId !== currentGeneration) return { ok: false, code: "conflict" };
      return { ok: true };
    },
  });

  const stranger = await handleRemoveVocabularyProfileGet(
    new Request(`http://127.0.0.1${REMOVE_VOCABULARY_PROFILE_PATH}?roomId=${ROOM}`),
    { ...deps(), getActor: async () => ({ id: OTHER }) },
  );
  assert.equal(stranger.status, 404);
  assert.equal(calls.read, 0);
  assert.equal(calls.write, 0);

  owner = OTHER;
  const foreign = await handleRemoveVocabularyProfilePost(
    post({ roomId: ROOM, profile: "bedroom" }),
    deps(),
  );
  assert.equal(foreign.status, 404);
  assert.equal(calls.write, 0);
  assert.equal(calls.load, 0);
  owner = ACTOR;

  for (const body of [
    { roomId: ROOM, profile: "kitchen" },
    { roomId: ROOM, profile: "bedroom", originalSha256: ORIGINAL_SHA },
    { roomId: ROOM, profile: "bedroom", generationId: GENERATION },
    { roomId: ROOM, profile: "living" },
  ]) {
    const rejected = await handleRemoveVocabularyProfilePost(post(body), deps());
    assert.equal(rejected.status, 400, JSON.stringify(body));
  }
  assert.equal(calls.write, 0);
  assert.equal(calls.load, 0);

  const saved = await handleRemoveVocabularyProfilePost(post({ roomId: ROOM, profile: "bedroom" }), deps());
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { profile: "bedroom", bound: true });
  assert.equal(calls.write, 1);
  assert.equal(calls.generationId, GENERATION);
  assert.equal(calls.load, 1);

  race = true;
  const raced = await handleRemoveVocabularyProfilePost(post({ roomId: ROOM, profile: "default" }), deps());
  assert.equal(raced.status, 409);
  assert.equal(calls.write, 2);

  const loadsBeforeRead = calls.load;
  const read = await handleRemoveVocabularyProfileGet(
    new Request(`http://127.0.0.1${REMOVE_VOCABULARY_PROFILE_PATH}?roomId=${ROOM}`),
    deps(),
  );
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { profile: "bedroom", bound: true });
  assert.equal(calls.load, loadsBeforeRead);
  assert.equal(calls.read, 1);
});

test("stored profile IO rejects a generation change and never calls a provider", async () => {
  const filters: Record<string, string> = {};
  const supabase = {
    from(table: string) {
      assert.equal(table, "vibode_rooms");
      const query = {
        update(values: Record<string, string>) {
          assert.equal(values[REMOVE_VOCABULARY_PROFILE_COLUMN], "bedroom");
          assert.equal(values[REMOVE_VOCABULARY_ORIGINAL_SHA_COLUMN], ORIGINAL_SHA);
          return query;
        },
        select() {
          return query;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
  };
  const written = await writeStoredRemoveVocabularyProfile(supabase as never, {
    userId: ACTOR,
    roomId: ROOM,
    generationId: GENERATION,
    profile: "bedroom",
    originalSha256: ORIGINAL_SHA.toUpperCase(),
  });
  assert.deepEqual(written, { ok: false, code: "conflict" });
  assert.equal(filters.user_id, ACTOR);
  assert.equal(filters.id, ROOM);
  assert.equal(filters.current_afc_generation_id, GENERATION);

  const reader = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              user_id: ACTOR,
              remove_vocabulary_profile: "bedroom",
              remove_vocabulary_original_sha256: ORIGINAL_SHA,
            },
            error: null,
          });
        },
      };
    },
  };
  const stored = await readStoredRemoveVocabularyProfile(reader as never, { userId: ACTOR, roomId: ROOM });
  assert.deepEqual(stored, { ok: true, profile: "bedroom", originalSha256: ORIGINAL_SHA });

  const route = source("app/api/vibode/admin/remove-vocabulary/route.ts");
  const server = source("lib/vibode-stage/remove-vocabulary-profile.server.ts");
  const quota = source("lib/vibode-stage/remove-segmentation-quota.server.ts");
  const limits = source("supabase/migrations/20261021180000_vibode_remove_segmentation_limits.sql");
  const cleanup = source("lib/vibode-stage/remove-cleanup-contract.ts");
  const worker = source("cleanup-worker/src/index.ts");
  assert.doesNotMatch(`${route}\n${server}`, /roboflow|gemini|generativelanguage|reserve_vibode_remove_segmentation|concept_segment/i);
  assert.doesNotMatch(quota, /remove_vocabulary_profile/);
  assert.doesNotMatch(limits, /remove_vocabulary_profile/);
  assert.equal(cleanup.includes(REMOVE_CLEANUP_CONCEPT_SET), true);
  assert.equal(REMOVE_CLEANUP_CONCEPT_SET, "remove-segmentation-concepts/v1");
  assert.doesNotMatch(worker, /remove_vocabulary_profile|nightstand/);
  assert.equal(source("lib/vibode-stage/remove-segmentation.ts").includes(REMOVE_SEGMENTATION_CONCEPTS_V1[7] ?? ""), true);
});

test("the migration constrains the pair and blocks authenticated writes", () => {
  const sql = source("supabase/migrations/20261102190000_vibode_remove_vocabulary_profile.sql");
  assert.match(sql, /add column if not exists remove_vocabulary_profile text/);
  assert.match(sql, /add column if not exists remove_vocabulary_original_sha256 text/);
  assert.match(sql, /remove_vocabulary_profile is null[\s\S]*remove_vocabulary_original_sha256 is null/);
  assert.match(sql, /remove_vocabulary_profile in \('default', 'bedroom'\)/);
  assert.match(sql, /remove_vocabulary_original_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /auth\.role\(\) = 'authenticated'/);
  assert.match(sql, /raise exception 'remove vocabulary profile is server-managed'/);
  assert.match(sql, /before insert or update on public\.vibode_rooms/);
  assert.doesNotMatch(sql, /metadata|reserve_vibode_remove_segmentation|vibode_remove_segmentation_calls|vibode_cleanup/i);
  const prior = source("supabase/migrations/20261021180000_vibode_remove_segmentation_limits.sql");
  assert.doesNotMatch(prior, /remove_vocabulary_profile/);
});

test("a confirmed profile change scans once and a failed save scans zero times", async () => {
  assert.equal(
    displayedRemoveVocabularyChoice({ profile: "bedroom", bound: false }),
    "default",
  );
  assert.equal(displayedRemoveVocabularyChoice(null), "default");
  assert.equal(
    displayedRemoveVocabularyChoice({ profile: "bedroom", bound: true }),
    "bedroom",
  );
  const idle = initialRemoveVocabularyConfirmState();
  assert.deepEqual(requestRemoveVocabularyChange(idle, { displayed: "default", requested: "default" }), idle);
  const confirming = requestRemoveVocabularyChange(idle, { displayed: "default", requested: "bedroom" });
  assert.deepEqual(confirming, { phase: "confirming", requested: "bedroom" });
  assert.deepEqual(applyRemoveVocabularySave({
    requested: "bedroom",
    result: { ok: false, reason: REMOVE_VOCABULARY_SAVE_ERROR },
  }), { scan: false, view: null });
  assert.deepEqual(applyRemoveVocabularySave({
    requested: "bedroom",
    result: { ok: true, profile: "bedroom", bound: true },
  }), { scan: true, view: { profile: "bedroom", bound: true } });

  let fetches = 0;
  const failed = await saveRemoveVocabularyProfile({
    roomId: ROOM,
    profile: "bedroom",
    fetchImpl: async (url, init) => {
      fetches += 1;
      assert.equal(String(url), REMOVE_VOCABULARY_PROFILE_PATH);
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { roomId: ROOM, profile: "bedroom" });
      return Response.json({ usable: false, reason: "Room not found." }, { status: 404 });
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(fetches, 1);
  assert.equal(applyRemoveVocabularySave({ requested: "bedroom", result: failed }).scan, false);

  const saved = await saveRemoveVocabularyProfile({
    roomId: ROOM,
    profile: "default",
    fetchImpl: async () => Response.json({ profile: "default", bound: true }),
  });
  assert.deepEqual(saved, { ok: true, profile: "default", bound: true });
  const lookedUp = await requestRemoveVocabularyProfile({
    roomId: ROOM,
    fetchImpl: async (url, init) => {
      assert.equal(init?.method, "GET");
      assert.match(String(url), /^\/api\/vibode\/admin\/remove-vocabulary\?roomId=/);
      assert.doesNotMatch(String(url), /roboflow|gemini/i);
      return Response.json({ profile: null, bound: false });
    },
  });
  assert.deepEqual(lookedUp, { profile: null, bound: false });
  assert.equal(readRemoveVocabularyProfileResponse({ profile: "bedroom", bound: true, originalSha256: ORIGINAL_SHA }), null);

  const identity: RemoveObjectUiIdentity = {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: ORIGINAL_SHA,
    originalWidth: 32,
    originalHeight: 32,
    sessionSerial: 2,
    vocabularyRevision: 0,
  };
  const ready: RemoveObjectUiState = {
    phase: "ready",
    identity,
    requestSerial: 1,
    objects: [],
    selectedIds: new Set(),
    error: null,
    diagnostics: null,
  };
  const held = reduceRemoveObjectSession({ state: ready, active: true, identity });
  assert.equal(held.command, "none");
  const changed = reduceRemoveObjectSession({
    state: ready,
    active: true,
    identity: { ...identity, vocabularyRevision: 1 },
  });
  assert.equal(changed.command, "fetch");
  assert.equal(changed.state.phase, "loading");
  const again = reduceRemoveObjectSession({
    state: changed.state,
    active: true,
    identity: { ...identity, vocabularyRevision: 1 },
  });
  assert.equal(again.command, "none");
  assert.deepEqual(JSON.parse(removeObjectUiRequestBody(identity)), {
    roomId: ROOM,
    generationId: GENERATION,
  });
  assert.equal(removeVocabularyProfileRequestBody(ROOM, "bedroom").includes(ORIGINAL_SHA), false);

  const session = source("components/stage/RemoveAlignmentSession.tsx");
  assert.match(session, /REMOVE_VOCABULARY_SCAN_CONFIRMATION/);
  assert.equal(session.match(/setVocabularyRevision\(\(current\) => current \+ 1\)/g)?.length, 1);
  assert.match(session, /vocabularyRevision/);
  assert.equal(session.includes("serverless.roboflow"), false);
  assert.equal(REMOVE_VOCABULARY_SCAN_CONFIRMATION.includes("one reservation"), true);
  const initial = reduceRemoveObjectSession({
    state: initialRemoveObjectUiState(),
    active: true,
    identity,
  });
  assert.equal(initial.command, "fetch");
});
