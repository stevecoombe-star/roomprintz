import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { classifyNanoBananaProAspectRatio } from "@/lib/afc-image-models";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { HARMONIZE_NBP_ENDPOINT } from "@/lib/vibode-stage/harmonize-nbp-proof";
import {
  buildAuthorizedRemoveCleanupNbpRequest,
  REMOVE_CLEANUP_NBP_DEFAULT_RESOLUTION_CLASS,
  REMOVE_CLEANUP_NBP_PROVIDER_ID,
  requestRemoveCleanupNbpCandidate,
  removeCleanupNbpOutputConfig,
  type RemoveCleanupNbpFailure,
} from "@/lib/vibode-stage/remove-cleanup-nbp.server";
import {
  prepareAuthorizedRemoveCleanupInput,
  removeCleanupInputIdentityMaterial,
  removeCleanupPaidRequestFingerprint,
  type RemoveCleanupExportDeps,
  type RemoveCleanupGenerationInputSnapshot,
  type RemoveCleanupProviderOutputConfig,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY = "test-gemini-key-not-real";

const FAMILIES = [
  ["1:1", 8, 8],
  ["3:2", 30, 20],
  ["2:3", 20, 30],
  ["3:4", 9, 12],
  ["4:3", 12, 9],
  ["4:5", 8, 10],
  ["5:4", 10, 8],
  ["9:16", 9, 16],
  ["16:9", 32, 18],
  ["21:9", 21, 9],
] as const;

type FetchCall = Readonly<{
  url: string;
  method: string;
  body: string | null;
  apiKey: string | null;
}>;

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function pack(indexes: readonly number[], width: number, height: number): Uint8Array {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (const index of indexes) bits[index >> 3] |= 1 << (index & 7);
  return bits;
}

function selectedObject(concept: string, bits: Uint8Array, ordinal = 0, confidence = 0.93) {
  const digest = createHash("sha256").update(bits).update(JSON.stringify(confidence)).digest("hex").slice(0, 8);
  return {
    id: `v1-${concept.replaceAll(" ", "-")}-${ordinal}-${digest}`,
    concept,
    confidence,
    maskSha256: sha256Hex(bits),
    bits: Buffer.from(bits).toString("base64"),
  };
}

async function png(width: number, height: number): Promise<Uint8Array> {
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgb[pixel * 3] = 10;
    rgb[pixel * 3 + 1] = 20;
    rgb[pixel * 3 + 2] = 30;
  }
  return new Uint8Array(await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

async function jpeg(width: number, height: number, orientation?: number): Promise<Uint8Array> {
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(50);
  let pipeline = sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 });
  if (orientation != null) pipeline = pipeline.withMetadata({ orientation });
  return new Uint8Array(await pipeline.toBuffer());
}

function deps(width: number, height: number, bytes: Uint8Array): RemoveCleanupExportDeps {
  const generation = {
    id: GENERATION,
    roomId: ROOM,
    userId: ADMIN,
    status: "ready",
    original: {
      sha256: sha256Hex(bytes),
      byteCount: bytes.byteLength,
      decodedWidth: width,
      decodedHeight: height,
      mimeType: "image/png" as const,
      orientation: 1 as const,
    },
    empty: null,
  } as AfcGenerationRecord;
  const room: AfcRoomPointer = {
    id: ROOM,
    userId: ADMIN,
    currentAfcGenerationId: GENERATION,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
  return {
    getAdmin: async () => ({ id: ADMIN }),
    createStore: () => ({
      async getRoom() {
        return room;
      },
      async getGeneration() {
        return generation;
      },
    }),
    createService: () => ({ service: true }),
    loadOriginal: async () => ({ ok: true, bytes }),
  };
}

async function snapshotFor(width: number, height: number): Promise<RemoveCleanupGenerationInputSnapshot> {
  const bytes = await png(width, height);
  const prepared = await prepareAuthorizedRemoveCleanupInput(
    new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: ROOM,
        generationId: GENERATION,
        originalSha256: sha256Hex(bytes),
        originalDecodedWidth: width,
        originalDecodedHeight: height,
        provider: "roboflow",
        modelId: "sam3/sam3_final",
        conceptSet: "remove-segmentation-concepts/v1",
        schema: "roboflow-serverless-concept-segment-polygon/0.64.4",
        coordinateBasis: "original-decoded-pixels-v1",
        referenceExpansionPx: 0,
        selectedObjects: [selectedObject("table", pack([0], width, height), 4)],
      }),
    }),
    deps(width, height, bytes),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("snapshot failed");
  return prepared.snapshot;
}

function outputFor(
  snapshot: RemoveCleanupGenerationInputSnapshot,
  resolutionClass: RemoveCleanupProviderOutputConfig["resolutionClass"] = "2K",
): RemoveCleanupProviderOutputConfig {
  const output = removeCleanupNbpOutputConfig(snapshot, resolutionClass);
  assert.ok(output);
  if (!output) throw new Error("output config failed");
  return output;
}

function completed(bytes: Uint8Array, id = "interaction-1") {
  return {
    id,
    status: "completed",
    model: "gemini-3-pro-image",
    usage: { total_input_tokens: 1200, total_output_tokens: 1120, note: "do-not-keep" },
    steps: [{
      type: "model_output",
      content: [
        { type: "text", text: "ignored" },
        { type: "image", mime_type: "image/jpeg", data: Buffer.from(bytes).toString("base64") },
      ],
    }],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function scripted(handler: (call: FetchCall, index: number) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      apiKey: headers.get("x-goog-api-key"),
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetchImpl };
}

function posts(calls: readonly FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === "POST");
}

test("the adapter stays isolated from Harmonize's one-image request and from jobs", () => {
  const adapter = source("lib/vibode-stage/remove-cleanup-nbp.server.ts");
  const proof = source("lib/vibode-stage/harmonize-nbp-proof.ts");
  assert.doesNotMatch(adapter, /["']3:2["']|2528|1696|buildHarmonizeNbpRequest|callHarmonizeNbpProof|assessHarmonizeNbpFraming|publishHarmonize|vibode_harmonize_generations/);
  assert.match(adapter, /removeCleanupPaidRequestFingerprint/);
  const builder = proof.slice(
    proof.indexOf("export function buildHarmonizeNbpRequest"),
    proof.indexOf("export function assessHarmonizeNbpFraming"),
  );
  assert.equal(builder.match(/type: "image"/g)?.length, 2);
  assert.match(builder, /pngBase64/);
  assert.doesNotMatch(builder, /overlayPng|magenta/);
});

test("every supported family keeps the snapshot aspect and the frozen two-image bytes", async () => {
  for (const [family, width, height] of FAMILIES) {
    const classified = classifyNanoBananaProAspectRatio(width, height);
    assert.equal(classified.ok, true, family);
    const snapshot = await snapshotFor(width, height);
    const before = snapshot.inputFingerprint;
    const output = outputFor(snapshot, "1K");
    const built = buildAuthorizedRemoveCleanupNbpRequest({ snapshot, output });
    assert.equal(built.ok, true, family);
    if (!built.ok) continue;
    assert.equal(built.request.model, "gemini-3-pro-image");
    assert.equal(built.request.input.length, 3);
    assert.equal(built.request.input[0].type, "text");
    assert.equal(built.request.input[0].text, snapshot.prompt.text);
    assert.equal(built.request.input[1].type, "image");
    assert.equal(built.request.input[1].mime_type, snapshot.original.mimeType);
    assert.equal(built.request.input[2].type, "image");
    assert.equal(built.request.input[2].mime_type, "image/png");
    assert.deepEqual(Buffer.from(built.request.input[1].data, "base64"), Buffer.from(snapshot.artifacts.originalBytes()));
    assert.deepEqual(Buffer.from(built.request.input[2].data, "base64"), Buffer.from(snapshot.artifacts.overlayPng()));
    assert.equal(built.request.response_format.aspect_ratio, family);
    assert.equal(built.request.response_format.image_size, "1K");
    assert.equal(built.request.response_format.mime_type, "image/jpeg");
    assert.equal(built.request.response_format.type, "image");
    assert.deepEqual(Object.keys(built.request).sort(), ["input", "model", "response_format"]);
    assert.equal(JSON.stringify(built.request).includes("brushReveal"), false);
    assert.equal(JSON.stringify(built.request).includes("emptyImage"), false);
    assert.equal(snapshot.original.decodedWidth, width);
    assert.equal(snapshot.original.decodedHeight, height);
    assert.equal(snapshot.inputFingerprint, before);
    assert.equal(snapshot.providerOutput, null);
    assert.equal(removeCleanupInputIdentityMaterial(snapshot).includes("1K"), false);
    assert.equal(built.paidRequestFingerprint, removeCleanupPaidRequestFingerprint(snapshot.inputFingerprint, output));
  }
});

test("resolution changes the paid fingerprint and not the input identity", async () => {
  const snapshot = await snapshotFor(30, 20);
  const low = outputFor(snapshot, "1K");
  const high = outputFor(snapshot, "2K");
  assert.equal(removeCleanupNbpOutputConfig(snapshot)?.resolutionClass, REMOVE_CLEANUP_NBP_DEFAULT_RESOLUTION_CLASS);
  const ultra = outputFor(snapshot, "4K");
  const first = buildAuthorizedRemoveCleanupNbpRequest({ snapshot, output: low });
  const second = buildAuthorizedRemoveCleanupNbpRequest({ snapshot, output: high });
  const third = buildAuthorizedRemoveCleanupNbpRequest({ snapshot, output: ultra });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  if (!first.ok || !second.ok || !third.ok) return;
  assert.notEqual(first.paidRequestFingerprint, second.paidRequestFingerprint);
  assert.notEqual(second.paidRequestFingerprint, third.paidRequestFingerprint);
  assert.equal(first.request.input[1].data, second.request.input[1].data);
  assert.equal(first.request.input[2].data, third.request.input[2].data);
  assert.equal(first.request.response_format.image_size, "1K");
  assert.equal(second.request.response_format.image_size, "2K");
  assert.equal(third.request.response_format.image_size, "4K");
  assert.equal(first.request.response_format.aspect_ratio, second.request.response_format.aspect_ratio);
});

test("inadmissible and contradictory aspects are rejected before transport", async () => {
  const extreme = await snapshotFor(8, 2);
  assert.equal(extreme.aspect.providerFamily.admissible, false);
  assert.equal(removeCleanupNbpOutputConfig(extreme), null);
  const forged = {
    schemaVersion: "remove-cleanup-output-config/v1",
    providerId: REMOVE_CLEANUP_NBP_PROVIDER_ID,
    modelId: "gemini-3-pro-image",
    aspectRatioFamily: "16:9",
    resolutionClass: "2K",
    mimeType: "image/jpeg",
  } as const;
  const calls: string[] = [];
  const rejected = await requestRemoveCleanupNbpCandidate({
    snapshot: extreme,
    output: forged,
    apiKey: API_KEY,
    fetchImpl: async () => {
      calls.push("fetch");
      throw new Error("fetch");
    },
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.phase, "before_contact");
  assert.equal(rejected.code, "inadmissible_aspect");
  assert.equal(rejected.postCount, 0);
  assert.equal(rejected.retryable, false);
  assert.deepEqual(calls, []);

  const snapshot = await snapshotFor(30, 20);
  const conflict = buildAuthorizedRemoveCleanupNbpRequest({
    snapshot,
    output: { ...outputFor(snapshot), aspectRatioFamily: "4:3" },
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.code, "aspect_conflict");
  assert.equal(conflict.postCount, 0);
  const pngOutput = buildAuthorizedRemoveCleanupNbpRequest({
    snapshot,
    output: { ...outputFor(snapshot), mimeType: "image/png" },
  });
  assert.equal(pngOutput.ok, false);
  if (pngOutput.ok) return;
  assert.equal(pngOutput.code, "unsupported_output");
  const otherModel = buildAuthorizedRemoveCleanupNbpRequest({
    snapshot,
    output: { ...outputFor(snapshot), modelId: "other-model" },
  });
  assert.equal(otherModel.ok, false);
  if (otherModel.ok) return;
  assert.equal(otherModel.code, "unsupported_output");
});

test("a completed two-image response returns an unregistered candidate without rescaling", async () => {
  const snapshot = await snapshotFor(30, 20);
  const image = await jpeg(1800, 1200);
  const transport = scripted(() => jsonResponse(completed(image)));
  const result = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output: outputFor(snapshot, "2K"),
    apiKey: API_KEY,
    fetchImpl: transport.fetchImpl,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(posts(transport.calls).length, 1);
  assert.equal(transport.calls[0]?.url, HARMONIZE_NBP_ENDPOINT);
  assert.equal(transport.calls[0]?.apiKey, API_KEY);
  assert.equal(transport.calls[0]?.body?.includes(API_KEY), false);
  const sent = JSON.parse(transport.calls[0]?.body ?? "{}") as {
    input: Array<{ type: string; text?: string }>;
  };
  assert.equal(sent.input.filter((part) => part.type === "image").length, 2);
  assert.equal(sent.input[0]?.text, snapshot.prompt.text);
  assert.equal(result.outputWidth, 1800);
  assert.equal(result.outputHeight, 1200);
  assert.notEqual(result.outputWidth, snapshot.original.decodedWidth);
  assert.equal(result.outputSha256, sha256Hex(image));
  assert.deepEqual(result.outputBytes(), image);
  const mutated = result.outputBytes();
  mutated[0] = (mutated[0] ?? 0) ^ 0xff;
  assert.equal(sha256Hex(result.outputBytes()), result.outputSha256);
  assert.equal(result.stageRegistration, "not-assessed");
  assert.equal(result.dimensionAssessment.exactOutputGrid, "unverified");
  assert.equal(result.dimensionAssessment.twoKLongEdgeFloor, 1792);
  assert.deepEqual(result.usage, { total_input_tokens: 1200, total_output_tokens: 1120 });
  assert.equal(result.inputFingerprint, snapshot.inputFingerprint);
  assert.equal(result.promptSha256, snapshot.prompt.sha256);
  assert.equal(result.originalSha256, snapshot.original.sha256);
  assert.equal(result.overlaySha256, snapshot.overlay.sha256);
  assert.equal(result.postCount, 1);
  assert.equal(result.getCount, 0);
  assert.equal("historyAssetId" in result, false);
  assert.equal("publicUrl" in result, false);
  assert.equal(snapshot.providerOutput, null);
});

test("portrait and 4:3 responses are accepted without a fixed pixel grid", async () => {
  const portrait = await snapshotFor(20, 30);
  const portraitImage = await jpeg(1200, 1800);
  const portraitResult = await requestRemoveCleanupNbpCandidate({
    snapshot: portrait,
    output: outputFor(portrait, "2K"),
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(portraitImage)),
  });
  assert.equal(portraitResult.ok, true);
  if (!portraitResult.ok) return;
  assert.equal(portraitResult.requestedAspectRatio, "2:3");
  assert.equal(portraitResult.outputWidth, 1200);
  assert.equal(portraitResult.outputHeight, 1800);

  const landscape = await snapshotFor(12, 9);
  const landscapeImage = await jpeg(2000, 1500);
  const landscapeResult = await requestRemoveCleanupNbpCandidate({
    snapshot: landscape,
    output: outputFor(landscape, "2K"),
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(landscapeImage)),
  });
  assert.equal(landscapeResult.ok, true);
  if (!landscapeResult.ok) return;
  assert.equal(landscapeResult.requestedAspectRatio, "4:3");
  assert.equal(landscapeResult.outputWidth, 2000);
  assert.equal(landscapeResult.outputHeight, 1500);
  assert.equal(landscapeResult.dimensionAssessment.exactOutputGrid, "unverified");
});

test("polling reads one interaction and does not create another", async () => {
  const snapshot = await snapshotFor(30, 20);
  const image = await jpeg(1800, 1200);
  const transport = scripted((call, index) => {
    if (index === 0) return jsonResponse({ id: "interaction-9", status: "queued" });
    assert.equal(call.url, `${HARMONIZE_NBP_ENDPOINT}/interaction-9`);
    assert.equal(call.method, "GET");
    assert.equal(call.body, null);
    assert.equal(call.url.includes(API_KEY), false);
    return jsonResponse(completed(image, "interaction-9"));
  });
  const result = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output: outputFor(snapshot),
    apiKey: API_KEY,
    pollIntervalMs: 0,
    fetchImpl: transport.fetchImpl,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(posts(transport.calls).length, 1);
  assert.equal(result.getCount, 1);
  assert.equal(result.interactionId, "interaction-9");
});

test("provider failures, bad payloads, and transport errors do not send a second POST", async () => {
  const snapshot = await snapshotFor(30, 20);
  const output = outputFor(snapshot);
  const prompt = snapshot.prompt.text;
  const cases: Array<Readonly<{
    name: string;
    respond: () => Response | Promise<Response>;
    phase: RemoveCleanupNbpFailure["phase"];
    code: string;
  }>> = [
    {
      name: "failed",
      respond: () => jsonResponse({ id: "interaction-1", status: "failed" }),
      phase: "provider_rejected",
      code: "provider_status",
    },
    {
      name: "requires-action",
      respond: () => jsonResponse({ id: "interaction-1", status: "requires_action" }),
      phase: "provider_rejected",
      code: "provider_status",
    },
    {
      name: "content-policy",
      respond: () => jsonResponse({
        id: "interaction-1",
        status: "failed",
        promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
        error: { message: prompt },
      }),
      phase: "provider_rejected",
      code: "content_refused",
    },
    {
      name: "http-400",
      respond: () => jsonResponse({ error: { status: "INVALID_ARGUMENT", message: `${prompt} ${API_KEY}` } }, 400),
      phase: "provider_rejected",
      code: "provider_rejected",
    },
    {
      name: "http-429",
      respond: () => jsonResponse({ error: { status: "RESOURCE_EXHAUSTED" } }, 429),
      phase: "provider_uncertain",
      code: "provider_uncertain",
    },
    {
      name: "http-500",
      respond: () => jsonResponse({ error: { message: prompt } }, 500),
      phase: "provider_uncertain",
      code: "provider_uncertain",
    },
    {
      name: "malformed-json",
      respond: () => new Response("not-json", { status: 200 }),
      phase: "provider_uncertain",
      code: "unexpected_output",
    },
    {
      name: "missing-image",
      respond: () => jsonResponse({ id: "interaction-1", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "none" }] }] }),
      phase: "provider_rejected",
      code: "unexpected_output",
    },
    {
      name: "bad-base64",
      respond: () => jsonResponse({
        id: "interaction-1",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: "!!!!" }] }],
      }),
      phase: "provider_rejected",
      code: "unexpected_output",
    },
  ];
  for (const item of cases) {
    const transport = scripted(() => item.respond());
    const result = await requestRemoveCleanupNbpCandidate({
      snapshot,
      output,
      apiKey: API_KEY,
      fetchImpl: transport.fetchImpl,
    });
    assert.equal(result.ok, false, item.name);
    if (result.ok) continue;
    assert.equal(result.phase, item.phase, item.name);
    assert.equal(result.code, item.code, item.name);
    assert.equal(result.retryable, false, item.name);
    assert.equal(posts(transport.calls).length, 1, item.name);
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes(prompt), false, item.name);
    assert.equal(encoded.includes(API_KEY), false, item.name);
  }

  const imageA = await jpeg(1800, 1200);
  const imageB = await jpeg(1800, 1200);
  imageB[imageB.length - 2] = (imageB[imageB.length - 2] ?? 0) ^ 0xff;
  const multiple = scripted(() => jsonResponse({
    id: "interaction-1",
    status: "completed",
    steps: [{
      type: "model_output",
      content: [
        { type: "image", mime_type: "image/jpeg", data: Buffer.from(imageA).toString("base64") },
        { type: "image", mime_type: "image/jpeg", data: Buffer.from(imageB).toString("base64") },
      ],
    }],
  }));
  const many = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: multiple.fetchImpl,
  });
  assert.equal(many.ok, false);
  if (!many.ok) {
    assert.equal(many.code, "unexpected_output");
    assert.equal(posts(multiple.calls).length, 1);
  }

  const disconnected = scripted(() => {
    throw new Error("socket hang up");
  });
  const dropped = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: disconnected.fetchImpl,
  });
  assert.equal(dropped.ok, false);
  if (!dropped.ok) {
    assert.equal(dropped.phase, "provider_uncertain");
    assert.equal(dropped.code, "transport");
    assert.equal(dropped.postCount, 1);
    assert.equal(posts(disconnected.calls).length, 1);
  }
});

test("an already-aborted signal makes no paid POST", async () => {
  const snapshot = await snapshotFor(30, 20);
  const calls: string[] = [];
  const cancelled = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output: outputFor(snapshot),
    apiKey: API_KEY,
    signal: AbortSignal.abort(),
    fetchImpl: async () => {
      calls.push("fetch");
      throw new Error("paid POST");
    },
  });
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) {
    assert.equal(cancelled.phase, "before_contact");
    assert.equal(cancelled.code, "cancelled");
    assert.equal(cancelled.postCount, 0);
    assert.equal(cancelled.retryable, false);
  }
  assert.deepEqual(calls, []);
});

test("timeout and cancellation stay at one POST", async () => {
  const snapshot = await snapshotFor(30, 20);
  const output = outputFor(snapshot);
  const waiting = scripted(() => jsonResponse({ id: "interaction-1", status: "queued" }));
  const timedOut = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    timeoutMs: 300,
    pollIntervalMs: 5,
    fetchImpl: waiting.fetchImpl,
  });
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) {
    assert.equal(timedOut.phase, "provider_uncertain");
    assert.equal(timedOut.code, "timeout");
    assert.equal(timedOut.retryable, false);
    assert.equal(posts(waiting.calls).length, 1);
    assert.ok(timedOut.getCount >= 1);
  }

  const early = scripted(() => {
    throw new Error("should not fetch");
  });
  const cancelled = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    signal: AbortSignal.abort(),
    fetchImpl: early.fetchImpl,
  });
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) {
    assert.equal(cancelled.phase, "before_contact");
    assert.equal(cancelled.code, "cancelled");
    assert.equal(cancelled.postCount, 0);
    assert.equal(early.calls.length, 0);
  }

  const caller = new AbortController();
  const during = scripted((call) => {
    if (call.method === "POST") {
      caller.abort();
      return jsonResponse({ id: "interaction-1", status: "queued" });
    }
    throw new Error("second request");
  });
  const abandoned = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    signal: caller.signal,
    pollIntervalMs: 1_000,
    fetchImpl: during.fetchImpl,
  });
  assert.equal(abandoned.ok, false);
  if (!abandoned.ok) {
    assert.equal(abandoned.phase, "provider_uncertain");
    assert.equal(abandoned.code, "cancelled");
    assert.equal(posts(during.calls).length, 1);
    assert.equal(during.calls.length, 1);
  }
});

test("candidate bytes must be an upright JPEG within the requested aspect and bounds", async () => {
  const snapshot = await snapshotFor(30, 20);
  const output = outputFor(snapshot, "2K");
  const small = await jpeg(120, 80);
  const lowClass = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(small)),
  });
  assert.equal(lowClass.ok, false);
  if (!lowClass.ok) assert.equal(lowClass.code, "resolution_class");

  const oneK = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output: outputFor(snapshot, "1K"),
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(small)),
  });
  assert.equal(oneK.ok, true);
  if (oneK.ok) {
    assert.equal(oneK.outputWidth, 120);
    assert.equal(oneK.outputHeight, 80);
    assert.equal(oneK.requestedResolutionClass, "1K");
  }

  const square = await jpeg(1792, 1792);
  const mismatched = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(square)),
  });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.code, "aspect_mismatch");

  const pngBytes = await png(8, 8);
  const notJpeg = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(pngBytes)),
  });
  assert.equal(notJpeg.ok, false);
  if (!notJpeg.ok) assert.equal(notJpeg.code, "corrupt_output");

  const corrupt = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(Uint8Array.of(1, 2, 3, 4))),
  });
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) assert.equal(corrupt.code, "corrupt_output");

  const oversize = Uint8Array.of(
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11,
    0x08,
    0x13, 0x88,
    0x03, 0xe8,
    0x00,
  );
  const huge = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(oversize)),
  });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.code, "output_bounds");

  const turned = await jpeg(1800, 1200, 6);
  const oriented = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse(completed(turned)),
  });
  assert.equal(oriented.ok, false);
  if (!oriented.ok) assert.equal(oriented.code, "output_orientation");
});

test("credentials are resolved without a new environment variable and are not returned", async () => {
  const snapshot = await snapshotFor(30, 20);
  const output = outputFor(snapshot);
  const missing = scripted(() => {
    throw new Error("fetch");
  });
  const absent = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    env: {},
    fetchImpl: missing.fetchImpl,
  });
  assert.equal(absent.ok, false);
  if (!absent.ok) {
    assert.equal(absent.phase, "before_contact");
    assert.equal(absent.code, "missing_credentials");
    assert.equal(missing.calls.length, 0);
  }

  const blank = scripted(() => {
    throw new Error("fetch");
  });
  const ignored = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    apiKey: " ",
    env: { GEMINI_API_KEY: "env-key-should-not-be-used" },
    fetchImpl: blank.fetchImpl,
  });
  assert.equal(ignored.ok, false);
  if (!ignored.ok) assert.equal(blank.calls.length, 0);

  const image = await jpeg(1800, 1200);
  const gemini = scripted(() => jsonResponse(completed(image)));
  const fromGemini = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    env: { GEMINI_API_KEY: "gemini-env-key", GOOGLE_API_KEY: "google-env-key" },
    fetchImpl: gemini.fetchImpl,
  });
  assert.equal(fromGemini.ok, true);
  assert.equal(gemini.calls[0]?.apiKey, "gemini-env-key");
  const google = scripted(() => jsonResponse(completed(image)));
  const fromGoogle = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output,
    env: { GOOGLE_API_KEY: "google-env-key" },
    fetchImpl: google.fetchImpl,
  });
  assert.equal(fromGoogle.ok, true);
  assert.equal(google.calls[0]?.apiKey, "google-env-key");
});

test("an HTTPS image URI is read once and an HTTP URI is refused", async () => {
  const snapshot = await snapshotFor(30, 20);
  const image = await jpeg(1800, 1200);
  const transport = scripted((call) => {
    if (call.method === "POST") {
      return jsonResponse({
        id: "interaction-1",
        status: "completed",
        output_image: { type: "image", mime_type: "image/jpeg", uri: "https://images.example.test/candidate.jpg" },
      });
    }
    assert.equal(call.apiKey, null);
    assert.equal(call.url, "https://images.example.test/candidate.jpg");
    return new Response(Buffer.from(image), { status: 200, headers: { "content-type": "image/jpeg" } });
  });
  const result = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output: outputFor(snapshot),
    apiKey: API_KEY,
    fetchImpl: transport.fetchImpl,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(posts(transport.calls).length, 1);
    assert.equal(result.outputSha256, sha256Hex(image));
  }

  const insecure = await requestRemoveCleanupNbpCandidate({
    snapshot,
    output: outputFor(snapshot),
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({
      id: "interaction-1",
      status: "completed",
      output_image: { type: "image", mime_type: "image/jpeg", uri: "http://images.example.test/candidate.jpg" },
    }),
  });
  assert.equal(insecure.ok, false);
  if (!insecure.ok) {
    assert.equal(insecure.code, "unexpected_output");
    assert.equal(insecure.message.includes("http://"), false);
  }
});
