import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { blendRemoveCleanupRgb } from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  REMOVE_CLEANUP_MAX_BODY_BYTES,
  handleRemoveCleanupExport,
  type RemoveCleanupExportDeps,
  type RemoveCleanupExportStore,
} from "@/lib/vibode-stage/remove-cleanup-export.server";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WIDTH = 8;
const HEIGHT = 8;

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function pack(indexes: readonly number[], width = WIDTH, height = HEIGHT): Uint8Array {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (const index of indexes) bits[index >> 3] |= 1 << (index & 7);
  return bits;
}

function selectedObject(
  concept: string,
  ordinal: number,
  bits: Uint8Array,
  confidence = 0.93,
  patch: Record<string, unknown> = {},
) {
  const digest = createHash("sha256")
    .update(bits)
    .update(JSON.stringify(confidence))
    .digest("hex")
    .slice(0, 8);
  const slug = concept.replaceAll(" ", "-");
  return {
    id: `v1-${slug}-${ordinal}-${digest}`,
    concept,
    confidence,
    maskSha256: sha256Hex(bits),
    bits: Buffer.from(bits).toString("base64"),
    ...patch,
  };
}

function requestBody(patch: Record<string, unknown> = {}, objects = [selectedObject("table", 0, pack([36, 0, 63]))]) {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: "ab".repeat(32),
    originalDecodedWidth: WIDTH,
    originalDecodedHeight: HEIGHT,
    provider: "roboflow",
    modelId: "sam3/sam3_final",
    conceptSet: "remove-segmentation-concepts/v1",
    schema: "roboflow-serverless-concept-segment-polygon/0.64.4",
    coordinateBasis: "original-decoded-pixels-v1",
    referenceExpansionPx: 0,
    selectedObjects: objects,
    ...patch,
  };
}

function identity(sha256: string, byteCount: number, width = WIDTH, height = HEIGHT) {
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
    original: identity("ab".repeat(32), 4),
    empty: null,
    ...patch,
  } as AfcGenerationRecord;
}

function room(userId = ADMIN, generationId: string | null = GENERATION): AfcRoomPointer {
  return {
    id: ROOM,
    userId,
    currentAfcGenerationId: generationId,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
}

function post(body: unknown, contentLength?: string): Request {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-export", {
    method: "POST",
    headers,
    body: payload,
  });
}

function harness(patch: {
  admin?: { id: string } | null;
  store?: RemoveCleanupExportStore | null;
  service?: unknown;
  originalBytes?: Uint8Array | null;
  generation?: AfcGenerationRecord;
  room?: AfcRoomPointer | null;
} = {}) {
  const calls = { admin: 0, room: 0, generation: 0, original: 0, artifact: 0 };
  const deps: RemoveCleanupExportDeps = {
    getAdmin: async () => {
      calls.admin += 1;
      return patch.admin === undefined ? { id: ADMIN } : patch.admin;
    },
    createStore: () => {
      if (patch.store === null) return null;
      return patch.store ?? {
        async getRoom() {
          calls.room += 1;
          return patch.room === undefined ? room() : patch.room;
        },
        async getGeneration() {
          calls.generation += 1;
          return patch.generation ?? generation();
        },
        async getArtifact() {
          calls.artifact += 1;
          return null;
        },
      } as RemoveCleanupExportStore;
    },
    createService: () => (patch.service === undefined ? { service: true } : patch.service),
    loadOriginal: async () => {
      calls.original += 1;
      if (patch.originalBytes === null) return { ok: false };
      return { ok: true, bytes: patch.originalBytes ?? Uint8Array.from([1, 2, 3, 4]) };
    },
  };
  return { calls, deps };
}

async function reasonOf(response: Response): Promise<string> {
  const body = await response.json() as { usable: boolean; reason: string };
  assert.equal(body.usable, false);
  assertProductionPayloadPrivacy(body);
  return body.reason;
}

function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const copy = Uint8Array.from(bytes);
  const view = new DataView(copy.buffer);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= copy.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    assert.equal(signature, 0x04034b50);
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(copy.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    files.set(name, copy.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

async function png(width: number, height: number, red = 10, green = 20, blue = 30): Promise<Uint8Array> {
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgb[pixel * 3] = red;
    rgb[pixel * 3 + 1] = green;
    rgb[pixel * 3 + 2] = blue;
  }
  return new Uint8Array(await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

test("cleanup route loads ORIGINAL itself and does not call a provider", () => {
  const route = source("app/api/vibode/admin/remove-cleanup-export/route.ts");
  const handler = source("lib/vibode-stage/remove-cleanup-export.server.ts");
  const prepare = source("lib/vibode-stage/remove-cleanup-snapshot.server.ts");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(route, /readRemoveActor/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(route, /export async function GET|createRoboflowRemoveSegmentationProvider/);
  assert.match(handler, /prepareAuthorizedRemoveCleanupInput/);
  assert.match(handler, /Cache-Control": "no-store"/);
  assert.match(prepare, /room\.userId !== admin\.id/);
  assert.match(prepare, /REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION/);
  assert.equal(prepare.match(/export async function/g)?.length, 1);
  const forbidden = /serverless\.roboflow\.com|generativelanguage|api\.openai\.com|concept_segment|publishHarmonize|vibode_harmonize|getArtifact\(|selectHarmonizeEmpty|assessRemoveAlignment/;
  assert.doesNotMatch(handler, forbidden);
  assert.doesNotMatch(prepare, forbidden);
  assert.doesNotMatch(prepare, /supabase|process\.env|storage\.from/);
  assert.match(
    source("lib/vibode-stage/remove-cleanup-contract.ts"),
    /not cryptographically authenticated as Roboflow outputs/,
  );
});

test("non-admin, non-owner, unknown room, stale generation, and unready generation are rejected", async () => {
  const anonymous = harness({ admin: null });
  const hidden = await handleRemoveCleanupExport(post(requestBody()), anonymous.deps);
  assert.equal(hidden.status, 403);
  assert.equal(await reasonOf(hidden), "Sign in required.");
  assert.equal(anonymous.calls.room, 0);
  assert.equal(anonymous.calls.original, 0);

  const foreign = harness({ room: room("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") });
  const foreignResponse = await handleRemoveCleanupExport(post(requestBody()), foreign.deps);
  assert.equal(foreignResponse.status, 404);
  assert.equal(await reasonOf(foreignResponse), "Room not found.");
  assert.equal(foreign.calls.original, 0);

  const missing = harness({ room: null });
  const missingResponse = await handleRemoveCleanupExport(post(requestBody()), missing.deps);
  assert.equal(missingResponse.status, 404);
  assert.equal(await reasonOf(missingResponse), "Room not found.");
  assert.equal(missing.calls.generation, 0);

  const stale = harness();
  const staleResponse = await handleRemoveCleanupExport(
    post(requestBody({ generationId: OTHER })),
    stale.deps,
  );
  assert.equal(staleResponse.status, 404);
  assert.equal(await reasonOf(staleResponse), "Authoritative images are unavailable.");
  assert.equal(stale.calls.original, 0);
  assert.equal(stale.calls.artifact, 0);

  const running = harness({ generation: generation({ status: "running" }) });
  const runningResponse = await handleRemoveCleanupExport(post(requestBody()), running.deps);
  assert.equal(runningResponse.status, 422);
  assert.equal(await reasonOf(runningResponse), "This room has no production-ready AFC generation.");
  assert.equal(running.calls.original, 0);
});

test("ORIGINAL identity, bytes, dimensions, and orientation are verified from the loaded file", async () => {
  const file = await png(WIDTH, HEIGHT);
  const fileSha = sha256Hex(file);
  const oriented = new Uint8Array(await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 9, g: 8, b: 7 } },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
  const orientedMeta = await sharp(oriented).metadata();
  assert.equal(orientedMeta.orientation, 6);

  const forged = `${fileSha.slice(0, 63)}${fileSha.endsWith("0") ? "1" : "0"}`;
  const shaMismatch = harness({
    generation: generation({ original: identity(forged, file.byteLength) }),
    originalBytes: file,
  });
  const shaResponse = await handleRemoveCleanupExport(
    post(requestBody({ originalSha256: forged })),
    shaMismatch.deps,
  );
  assert.equal(shaResponse.status, 422);
  assert.equal(await reasonOf(shaResponse), "ORIGINAL SHA-256 does not match.");

  const countMismatch = harness({
    generation: generation({ original: identity(fileSha, file.byteLength + 1) }),
    originalBytes: file,
  });
  const countResponse = await handleRemoveCleanupExport(
    post(requestBody({ originalSha256: fileSha })),
    countMismatch.deps,
  );
  assert.equal(countResponse.status, 422);
  assert.equal(await reasonOf(countResponse), "ORIGINAL byte count does not match.");

  const small = await png(4, 4);
  const smallSha = sha256Hex(small);
  const dimensions = harness({
    generation: generation({ original: identity(smallSha, small.byteLength, WIDTH, HEIGHT) }),
    originalBytes: small,
  });
  const dimensionResponse = await handleRemoveCleanupExport(
    post(requestBody({ originalSha256: smallSha })),
    dimensions.deps,
  );
  assert.equal(dimensionResponse.status, 422);
  assert.equal(await reasonOf(dimensionResponse), "ORIGINAL dimensions do not match.");

  const turned = harness({
    generation: generation({
      original: identity(sha256Hex(oriented), oriented.byteLength),
    }),
    originalBytes: oriented,
  });
  const turnedResponse = await handleRemoveCleanupExport(
    post(requestBody({ originalSha256: sha256Hex(oriented) })),
    turned.deps,
  );
  assert.equal(turnedResponse.status, 422);
  assert.equal(await reasonOf(turnedResponse), "ORIGINAL orientation is not supported.");

  const stored = harness({
    generation: generation({
      original: {
        ...identity(fileSha, file.byteLength),
        orientation: 6,
      } as unknown as AfcGenerationRecord["original"],
    }),
    originalBytes: file,
  });
  const storedResponse = await handleRemoveCleanupExport(
    post(requestBody({ originalSha256: fileSha })),
    stored.deps,
  );
  assert.equal(storedResponse.status, 422);
  assert.equal(await reasonOf(storedResponse), "ORIGINAL orientation is not supported.");
  assert.equal(stored.calls.original, 0);
});

test("client image locations, brush fields, and invalid selections never reach ORIGINAL bytes", async () => {
  const bits = pack([36]);
  const cases: Array<readonly [unknown, string]> = [
    [requestBody({ storagePath: "users/secret/original.jpg" }), "Cleanup export request has an unknown field."],
    [requestBody({ imageUrl: "https://example.test/original.jpg" }), "Cleanup export request has an unknown field."],
    [requestBody({ signedUrl: "https://example.test/signed" }), "Cleanup export request has an unknown field."],
    [requestBody({ bytes: "aaaa" }), "Cleanup export request has an unknown field."],
    [requestBody({ brushReveal: true }), "Cleanup export request has an unknown field."],
    [requestBody({ brushRestore: [1] }), "Cleanup export request has an unknown field."],
    [requestBody({ protectObjects: true }), "Cleanup export request has an unknown field."],
    [requestBody({ eligibleObjects: [] }), "Cleanup export request has an unknown field."],
    [requestBody({ selectedObjects: [] }), "Select a hidden object before exporting."],
    [requestBody({}, [selectedObject("table", 0, bits), selectedObject("table", 0, bits)]), "Selected object ids must be unique."],
    [requestBody({}, [{ ...selectedObject("table", 0, bits), bits: "AAAA" }]), "Selected mask dimensions are invalid."],
    [requestBody({}, [{ ...selectedObject("table", 0, bits), maskSha256: `${"ab".repeat(31)}cd` }]), "Selected mask does not match its digest."],
    [requestBody({}, [{ ...selectedObject("table", 0, bits), id: "v1-table-0-deadbeef" }]), "Selected object id does not match its mask."],
    [requestBody({ coordinateBasis: "display-pixels" }), "Cleanup coordinate basis is not supported."],
    [requestBody({}, [selectedObject("ottoman", 0, bits)]), "Segmentation concept is not supported."],
    [requestBody({ provider: "fal" }), "Segmentation provider is not supported."],
    [requestBody({ modelId: "sam2" }), "Segmentation provider is not supported."],
    [requestBody({ conceptSet: "remove-segmentation-concepts/v0" }), "Segmentation provider is not supported."],
    [requestBody({ referenceExpansionPx: 2 }), "Reference mask expansion is not supported."],
    [requestBody({
      originalDecodedWidth: 3,
      originalDecodedHeight: 1,
    }, [selectedObject("table", 0, Uint8Array.from([0x81]))]), "Selected mask dimensions are invalid."],
    [requestBody({}, [selectedObject("table", 0, pack([]))]), "Selected mask is empty."],
  ];

  for (const [body, expected] of cases) {
    const run = harness();
    const response = await handleRemoveCleanupExport(post(body), run.deps);
    assert.equal(response.status, 400, expected);
    assert.equal(await reasonOf(response), expected);
    assert.equal(run.calls.original, 0, expected);
    assert.equal(run.calls.artifact, 0, expected);
  }

  const oversized = harness();
  const tooLarge = await handleRemoveCleanupExport(
    post(requestBody(), String(REMOVE_CLEANUP_MAX_BODY_BYTES + 1)),
    oversized.deps,
  );
  assert.equal(tooLarge.status, 400);
  assert.equal(await reasonOf(tooLarge), "Request body is too large.");
  assert.equal(oversized.calls.admin, 0);
  assert.equal(oversized.calls.original, 0);
});

test("export ZIP contains only the submitted masks, the ORIGINAL bytes, and the diagnostic mask", async () => {
  const file = await png(WIDTH, HEIGHT, 10, 20, 30);
  const fileSha = sha256Hex(file);
  const tableBits = pack([36, 0, 63]);
  const sofaBits = pack([1, 2]);
  const overlapBits = pack([36, 3]);
  const beforeTable = Uint8Array.from(tableBits);
  const beforeOverlap = Uint8Array.from(overlapBits);
  assert.notDeepEqual(tableBits, sofaBits);
  const body = requestBody({ originalSha256: fileSha }, [
    selectedObject("table", 0, tableBits),
    selectedObject("lamp", 1, overlapBits, 0.81),
  ]);
  assert.equal(JSON.stringify(body).includes("sofa"), false);
  const run = harness({
    generation: generation({
      original: identity(fileSha, file.byteLength),
      empty: null,
    }),
    originalBytes: file,
  });
  const response = await handleRemoveCleanupExport(post(body), run.deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition") ?? "", /vibode-cleanup-inputs\.zip/);
  assert.equal(run.calls.original, 1);
  assert.equal(run.calls.artifact, 0);
  assert.deepEqual(tableBits, beforeTable);
  assert.deepEqual(overlapBits, beforeOverlap);

  const files = unzip(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual([...files.keys()], [
    "01-original.png",
    "02-selected-overlay.png",
    "03-selected-mask.png",
    "manifest.json",
    "prompt.txt",
  ]);
  assert.deepEqual(files.get("01-original.png"), file);
  const overlayMeta = await sharp(files.get("02-selected-overlay.png")).metadata();
  const diagnosticMeta = await sharp(files.get("03-selected-mask.png")).metadata();
  assert.equal(overlayMeta.width, WIDTH);
  assert.equal(overlayMeta.height, HEIGHT);
  assert.equal(overlayMeta.hasAlpha, false);
  assert.equal(diagnosticMeta.width, WIDTH);
  assert.equal(diagnosticMeta.height, HEIGHT);
  assert.equal(diagnosticMeta.hasAlpha, false);
  const overlay = await sharp(files.get("02-selected-overlay.png")).raw().toBuffer({ resolveWithObject: true });
  const diagnostic = await sharp(files.get("03-selected-mask.png")).raw().toBuffer({ resolveWithObject: true });
  assert.equal(overlay.info.channels, 3);
  assert.equal(diagnostic.info.channels, 3);
  const expected = blendRemoveCleanupRgb({
    rgb: await sharp(file).raw().toBuffer(),
    width: WIDTH,
    height: HEIGHT,
    masks: [tableBits, overlapBits],
  });
  assert.ok(expected);
  if (!expected) return;
  assert.deepEqual(overlay.data, Buffer.from(expected.overlay));
  assert.deepEqual(diagnostic.data, Buffer.from(expected.diagnostic));
  assert.equal(overlay.data[1 * 3], 10);
  assert.equal(overlay.data[1 * 3 + 1], 20);
  assert.equal(overlay.data[1 * 3 + 2], 30);
  assert.equal(overlay.data[2 * 3], 10);
  assert.equal(overlay.data[2 * 3 + 1], 20);
  assert.equal(overlay.data[4 * 3], 10);

  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as {
    schemaVersion: string;
    original: { sha256: string; fileName: string; orientation: number };
    selection: { count: number; unionPixels: number; objects: Array<{ id: string; concept: string }> };
    overlay: { color: string; opacity: number; outline: string; referenceExpansionPx: number; sha256: string };
    diagnosticMask: { sha256: string; modelInput: boolean };
    segmentation: { maskProvenanceLimitation: string };
    exclusions: { brushReveal: string; instantComposite: string; emptyImage: string; modelInputs: string[] };
    prompt: { version: string; fileName: string };
  };
  assert.equal(manifest.schemaVersion, "remove-cleanup-export/v1");
  assert.equal(manifest.original.sha256, fileSha);
  assert.equal(manifest.original.fileName, "01-original.png");
  assert.equal(manifest.original.orientation, 1);
  assert.equal(manifest.selection.count, 2);
  assert.equal(manifest.selection.unionPixels, expected.unionPixels);
  assert.deepEqual(manifest.selection.objects.map((object) => object.concept).sort(), ["lamp", "table"]);
  assert.equal(manifest.overlay.color, "#FF00FF");
  assert.equal(manifest.overlay.opacity, 0.45);
  assert.equal(manifest.overlay.outline, "none");
  assert.equal(manifest.overlay.referenceExpansionPx, 0);
  assert.equal(manifest.overlay.sha256, sha256Hex(files.get("02-selected-overlay.png") ?? new Uint8Array()));
  assert.equal(manifest.diagnosticMask.modelInput, false);
  assert.equal(manifest.diagnosticMask.sha256, sha256Hex(files.get("03-selected-mask.png") ?? new Uint8Array()));
  assert.match(manifest.segmentation.maskProvenanceLimitation, /not cryptographically authenticated as Roboflow outputs/);
  assert.equal(manifest.exclusions.brushReveal, "excluded");
  assert.equal(manifest.exclusions.instantComposite, "excluded");
  assert.equal(manifest.exclusions.emptyImage, "excluded");
  assert.deepEqual(manifest.exclusions.modelInputs, ["01-original.png", "02-selected-overlay.png"]);
  assert.equal(manifest.prompt.version, "remove-cleanup-prompt/v1");
  assert.equal(manifest.prompt.fileName, "prompt.txt");
  const prompt = new TextDecoder().decode(files.get("prompt.txt"));
  assert.match(prompt, /table near the centre of the photograph/);
  assert.match(prompt, /follow the magenta highlights/);
  assert.equal(prompt.includes("sofa"), false);
  const walk = (value: unknown, key = ""): void => {
    if (typeof value === "string") assert.equal(/https?:\/\//.test(value), false, key);
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) {
      assert.equal(/storage|signedUrl|apiKey|imageUrl/i.test(childKey), false, childKey);
      walk(child, childKey);
    }
  };
  walk(manifest);
  assert.equal(sofaBits.byteLength, tableBits.byteLength);
});
