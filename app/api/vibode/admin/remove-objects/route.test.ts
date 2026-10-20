import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";

import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";
import {
  handleRemoveObjectsAdmin,
  type RemoveObjectsAdminDeps,
  type RemoveObjectsAdminStore,
} from "@/lib/vibode-stage/remove-segmentation-admin";
import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  ROBOFLOW_CONCEPT_SEGMENT_URL,
} from "@/lib/vibode-stage/remove-segmentation";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPTY_PATH = "secret/empty-object";
const API_KEY = "roboflow-test-key";

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
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Uint8Array.from(Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

const EMPTY_PNG = png(32, 32);
const ORIGINAL_BYTES = Uint8Array.from([9, 9, 9, 9]);
const ORIGINAL_SHA = sha256Hex(ORIGINAL_BYTES);
const EMPTY_SHA = sha256Hex(EMPTY_PNG);

function identity(sha256: string, byteCount: number, width = 32, height = 32) {
  return {
    sha256,
    byteCount,
    decodedWidth: width,
    decodedHeight: height,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  };
}

function generation(patch: Partial<AfcGenerationRecord> = {}): AfcGenerationRecord {
  return {
    id: GENERATION,
    roomId: ROOM,
    userId: ADMIN,
    status: "ready",
    original: identity(ORIGINAL_SHA, ORIGINAL_BYTES.byteLength),
    empty: identity(EMPTY_SHA, EMPTY_PNG.byteLength),
    emptyArtifactSource: "durable",
    emptyStoragePath: EMPTY_PATH,
    frame: { width: 32, height: 32 },
    productionAuthority: {
      status: "ready",
      generationId: GENERATION,
      frame: { width: 32, height: 32 },
      frozenCamera: { frame: { width: 32, height: 32 } },
    },
    artifactLineage: null,
    ...patch,
  } as AfcGenerationRecord;
}

function room(userId = ADMIN): AfcRoomPointer {
  return {
    id: ROOM,
    userId,
    currentAfcGenerationId: GENERATION,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
}

function polygonResponse() {
  return {
    time: 0.4,
    prompt_results: REMOVE_SEGMENTATION_CONCEPTS_V1.map((text, promptIndex) => ({
      prompt_index: promptIndex,
      echo: { prompt_index: promptIndex, type: "text", text, num_boxes: 0 },
      predictions: text === "chair"
        ? [{
          format: "polygon",
          confidence: 0.93,
          masks: [[[2, 2], [28, 2], [28, 22], [2, 22]]],
        }]
        : [],
    })),
  };
}

function post(body: unknown, contentLength?: string): Request {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("http://127.0.0.1/api/vibode/admin/remove-objects", {
    method: "POST",
    headers,
    body: payload,
  });
}

function harness(patch: {
  admin?: { id: string } | null;
  store?: RemoveObjectsAdminStore | null;
  service?: unknown;
  originalBytes?: Uint8Array | null;
  fetchImpl?: typeof fetch;
  provider?: RemoveObjectsAdminDeps["provider"];
} = {}) {
  const calls = {
    admin: 0,
    room: 0,
    generation: 0,
    artifact: [] as string[],
    original: 0,
    fetch: 0,
  };
  const provider = patch.provider ?? createRoboflowRemoveSegmentationProvider({
    apiKey: API_KEY,
    fetch: patch.fetchImpl ?? (async () => {
      calls.fetch += 1;
      return Response.json(polygonResponse());
    }),
  });
  const deps: RemoveObjectsAdminDeps = {
    getAdmin: async () => {
      calls.admin += 1;
      return patch.admin === undefined ? { id: ADMIN } : patch.admin;
    },
    createStore: () => {
      if (patch.store === null) return null;
      return patch.store ?? {
        async getRoom() {
          calls.room += 1;
          return room();
        },
        async getGeneration() {
          calls.generation += 1;
          return generation();
        },
        async getArtifact(artifactPath) {
          calls.artifact.push(artifactPath);
          return EMPTY_PNG;
        },
      };
    },
    createService: () => (patch.service === undefined ? { service: true } : patch.service),
    loadOriginal: async () => {
      calls.original += 1;
      if (patch.originalBytes === null) return { ok: false };
      return { ok: true, bytes: patch.originalBytes ?? ORIGINAL_BYTES };
    },
    provider,
  };
  return { calls, deps };
}

test("REMOVE object route is an admin POST with no browser image and no writes", () => {
  const route = source("app/api/vibode/admin/remove-objects/route.ts");
  const handler = source("lib/vibode-stage/remove-segmentation-admin.ts");
  const client = source("lib/vibode-stage/remove-segmentation-roboflow.server.ts");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET|export async function PUT|export async function PATCH/);
  assert.match(route, /getAuthenticatedAdminUser/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.doesNotMatch(route, /ROBOFLOW_API_KEY|serverless\.roboflow\.com|fal\.ai|gemini|openai/i);
  assert.match(handler, /room\.userId !== admin\.id/);
  assert.match(handler, /assessRemoveAlignment/);
  assert.match(handler, /assertProductionPayloadPrivacy/);
  assert.match(handler, /REMOVE_SEGMENTATION_CONCEPTS_V1/);
  assert.doesNotMatch(handler, /updateGeneration|activateGeneration|putArtifact|publishDurable|enqueue/);
  assert.equal(client.match(/fetchImpl\(/g)?.length, 1);
  assert.doesNotMatch(client, /retry|fallback|visual_segment|fal\.ai|api_key=/i);
  for (const relativePath of [
    "components/stage/RemoveBrushCanvas.tsx",
    "components/stage/RemoveAlignmentSession.tsx",
    "lib/vibode-stage/remove-mask.ts",
    "lib/vibode-stage/harmonize-export-client.ts",
  ]) {
    assert.equal(source(relativePath).includes("remove-segmentation"), false);
  }
});

test("admin, ownership, stale generation, and ORIGINAL identity block inference", async () => {
  const anonymous = harness({ admin: null });
  const hidden = await handleRemoveObjectsAdmin(post({ roomId: ROOM, generationId: GENERATION }), anonymous.deps);
  assert.equal(hidden.status, 403);
  assert.equal(anonymous.calls.room, 0);
  assert.equal(anonymous.calls.fetch, 0);

  const foreign = harness({
    store: {
      async getRoom() {
        foreign.calls.room += 1;
        return room("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      },
      async getGeneration() {
        foreign.calls.generation += 1;
        return generation();
      },
      async getArtifact() {
        return EMPTY_PNG;
      },
    },
  });
  const missingRoom = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    foreign.deps,
  );
  assert.equal(missingRoom.status, 404);
  assert.equal(foreign.calls.generation, 0);
  assert.equal(foreign.calls.original, 0);

  const stale = harness();
  const staleResponse = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: OTHER }),
    stale.deps,
  );
  assert.equal(staleResponse.status, 404);
  assert.equal(stale.calls.original, 0);
  assert.deepEqual(stale.calls.artifact, []);
  assert.equal(stale.calls.fetch, 0);

  const mismatch = harness({ originalBytes: Uint8Array.from([4, 4, 4, 4]) });
  const mismatchResponse = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    mismatch.deps,
  );
  assert.equal(mismatchResponse.status, 200);
  const mismatchBody = await mismatchResponse.json() as { usable: boolean; reason: string };
  assert.equal(mismatchBody.usable, false);
  assert.match(mismatchBody.reason, /integrity/i);
  assert.equal(mismatch.calls.fetch, 0);

  const notReady = harness({
    store: {
      async getRoom() {
        return room();
      },
      async getGeneration() {
        notReady.calls.generation += 1;
        return generation({ status: "failed" });
      },
      async getArtifact(artifactPath) {
        notReady.calls.artifact.push(artifactPath);
        return EMPTY_PNG;
      },
    },
  });
  const waiting = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    notReady.deps,
  );
  assert.equal(waiting.status, 200);
  assert.equal((await waiting.json() as { usable: boolean }).usable, false);
  assert.equal(notReady.calls.original, 0);
  assert.deepEqual(notReady.calls.artifact, []);
});

test("the browser cannot supply an image, and limits stop before the provider", async () => {
  const extra = harness();
  const rejected = await handleRemoveObjectsAdmin(post({
    roomId: ROOM,
    generationId: GENERATION,
    imageUrl: "https://example.test/room.jpg",
  }), extra.deps);
  assert.equal(rejected.status, 400);
  assert.equal(extra.calls.admin, 0);
  assert.equal(extra.calls.fetch, 0);

  const invalidId = harness();
  assert.equal(
    (await handleRemoveObjectsAdmin(post({ roomId: ROOM, generationId: "stale" }), invalidId.deps)).status,
    400,
  );
  const bulky = harness();
  assert.equal(
    (await handleRemoveObjectsAdmin(
      post({ roomId: ROOM, generationId: GENERATION }, "5000"),
      bulky.deps,
    )).status,
    400,
  );

  const oversized = harness({
    store: {
      async getRoom() {
        return room();
      },
      async getGeneration() {
        return generation({
          original: identity(ORIGINAL_SHA, ORIGINAL_BYTES.byteLength, 8000, 2001),
        });
      },
      async getArtifact() {
        return EMPTY_PNG;
      },
    },
  });
  const limited = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    oversized.deps,
  );
  assert.equal(limited.status, 422);
  assert.match((await limited.json() as { reason: string }).reason, /exceeds the segmentation limit/);
  assert.equal(oversized.calls.fetch, 0);

  const unconfigured = harness({
    provider: createRoboflowRemoveSegmentationProvider({ apiKey: "", fetch: async () => {
      unconfigured.calls.fetch += 1;
      return Response.json({});
    } }),
  });
  const missingKey = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    unconfigured.deps,
  );
  assert.equal(missingKey.status, 500);
  assert.equal(missingKey.headers.get("cache-control"), "no-store");
  assert.match((await missingKey.json() as { reason: string }).reason, /not configured/);
  assert.equal(unconfigured.calls.fetch, 0);
});

test("a verified ORIGINAL is segmented once and the response keeps no path or credential", async () => {
  let fetches = 0;
  let sentBytes = "";
  const world = harness({
    fetchImpl: async (url, init) => {
      fetches += 1;
      assert.equal(String(url), ROBOFLOW_CONCEPT_SEGMENT_URL);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${API_KEY}`);
      const body = JSON.parse(String(init?.body)) as {
        format: string;
        nms_iou_threshold?: number;
        api_key?: string;
        image: { type: string; value: string };
      };
      assert.equal(body.format, "polygon");
      assert.equal(body.nms_iou_threshold, undefined);
      assert.equal(body.api_key, undefined);
      assert.equal(body.image.type, "base64");
      sentBytes = body.image.value;
      return Response.json(polygonResponse());
    },
  });
  const response = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    world.deps,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json() as {
    usable: boolean;
    provider: string;
    modelId: string;
    conceptSet: string;
    rleContract?: string;
    unverifiedEncodings: string[];
    original: { sha256: string; decodedWidth: number; decodedHeight: number };
    objects: Array<{ id: string; concept: string; mask: { width: number; areaPx: number; bits: string } }>;
    providerNms: string;
  };
  assertProductionPayloadPrivacy(payload);
  assert.equal(payload.usable, true);
  assert.equal(payload.provider, "roboflow");
  assert.equal(payload.modelId, "sam3/sam3_final");
  assert.equal(payload.conceptSet, "remove-segmentation-concepts/v1");
  assert.deepEqual(payload.unverifiedEncodings, ["rle"]);
  assert.equal(payload.providerNms, "disabled");
  assert.equal(payload.original.sha256, ORIGINAL_SHA);
  assert.equal(payload.original.decodedWidth, 32);
  assert.equal(payload.objects.length, 1);
  assert.equal(payload.objects[0]?.concept, "chair");
  assert.equal(payload.objects[0]?.mask.areaPx, 520);
  assert.equal(payload.objects[0]?.mask.width, 32);
  assert.equal(typeof payload.objects[0]?.mask.bits, "string");
  assert.equal(fetches, 1);
  assert.equal(Buffer.from(sentBytes, "base64").equals(Buffer.from(ORIGINAL_BYTES)), true);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(EMPTY_PATH), false);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes("http"), false);
  assert.equal(createHash("sha256").update(EMPTY_PNG).digest("hex"), EMPTY_SHA);
});

test("provider failures stay classified and are not followed by another call", async () => {
  let fetches = 0;
  const http = harness({
    fetchImpl: async () => {
      fetches += 1;
      return new Response("upstream", { status: 500 });
    },
  });
  const failed = await handleRemoveObjectsAdmin(post({ roomId: ROOM, generationId: GENERATION }), http.deps);
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.match((await failed.json() as { reason: string }).reason, /HTTP 500/);
  assert.equal(fetches, 1);

  const rle = harness({
    fetchImpl: async () => {
      fetches += 1;
      return Response.json({
        time: 0.2,
        prompt_results: REMOVE_SEGMENTATION_CONCEPTS_V1.map((text, promptIndex) => ({
          prompt_index: promptIndex,
          predictions: text === "chair"
            ? [{ format: "rle", confidence: 0.9, masks: { size: [32, 32], counts: "synthetic" } }]
            : [],
        })),
      });
    },
  });
  const unverified = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    rle.deps,
  );
  assert.equal(unverified.status, 502);
  assert.match((await unverified.json() as { reason: string }).reason, /unverified mask encoding/);
  assert.equal(fetches, 2);

  let thrown = 0;
  const exploding = harness({
    provider: {
      id: "roboflow",
      modelId: "sam3/sam3_final",
      async segment() {
        thrown += 1;
        throw new Error("provider exploded");
      },
    },
  });
  const crashed = await handleRemoveObjectsAdmin(
    post({ roomId: ROOM, generationId: GENERATION }),
    exploding.deps,
  );
  const crashedBody = await crashed.json() as { reason: string };
  assert.equal(crashed.status, 502);
  assert.match(crashedBody.reason, /did not respond/);
  assert.equal(crashedBody.reason.includes("provider exploded"), false);
  assert.equal(thrown, 1);
});
