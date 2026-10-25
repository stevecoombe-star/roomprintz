import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { classifyNanoBananaProAspectRatio } from "@/lib/afc-image-models";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import {
  REMOVE_CLEANUP_MAGENTA,
  REMOVE_CLEANUP_PROMPT_VERSION,
  blendRemoveCleanupRgb,
  renderRemoveCleanupPrompt,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import { handleRemoveCleanupExport } from "@/lib/vibode-stage/remove-cleanup-export.server";
import {
  REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION,
  REMOVE_CLEANUP_SNAPSHOT_VERSION,
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
const OTHER_ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function pack(indexes: readonly number[], width: number, height: number): Uint8Array {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (const index of indexes) bits[index >> 3] |= 1 << (index & 7);
  return bits;
}

function selectedObject(
  concept: string,
  ordinal: number,
  bits: Uint8Array,
  confidence = 0.93,
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
  };
}

function requestBody(
  width: number,
  height: number,
  sha256: string,
  objects: ReturnType<typeof selectedObject>[],
  patch: Record<string, unknown> = {},
) {
  return {
    roomId: ROOM,
    generationId: GENERATION,
    originalSha256: sha256,
    originalDecodedWidth: width,
    originalDecodedHeight: height,
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

function post(body: unknown): Request {
  return new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function harness(input: Readonly<{
  width: number;
  height: number;
  bytes: Uint8Array;
  adminId?: string;
  now?: () => string;
  generationPatch?: Partial<AfcGenerationRecord>;
}>): RemoveCleanupExportDeps {
  const fileSha = sha256Hex(input.bytes);
  const generation = {
    id: GENERATION,
    roomId: ROOM,
    userId: input.adminId ?? ADMIN,
    status: "ready",
    original: {
      sha256: fileSha,
      byteCount: input.bytes.byteLength,
      decodedWidth: input.width,
      decodedHeight: input.height,
      mimeType: "image/png" as const,
      orientation: 1 as const,
    },
    empty: null,
    ...input.generationPatch,
  } as AfcGenerationRecord;
  const room: AfcRoomPointer = {
    id: ROOM,
    userId: input.adminId ?? ADMIN,
    currentAfcGenerationId: GENERATION,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
  return {
    getAdmin: async () => ({ id: input.adminId ?? ADMIN }),
    createStore: () => ({
      async getRoom() {
        return room;
      },
      async getGeneration() {
        return generation;
      },
    }),
    createService: () => ({ service: true }),
    loadOriginal: async () => ({ ok: true, bytes: input.bytes }),
    now: input.now,
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

async function prepareOne(input: Readonly<{
  width: number;
  height: number;
  objects?: ReadonlyArray<Readonly<{
    concept: string;
    ordinal: number;
    indexes: readonly number[];
    confidence?: number;
  }>>;
  order?: "forward" | "reverse";
  adminId?: string;
  now?: () => string;
  patch?: Record<string, unknown>;
  bytes?: Uint8Array;
}>): Promise<RemoveCleanupGenerationInputSnapshot> {
  const width = input.width;
  const height = input.height;
  const bytes = input.bytes ?? await png(width, height);
  const specs = input.objects ?? [{ concept: "table", ordinal: 4, indexes: [0] }];
  const objects = specs.map((spec) => selectedObject(
    spec.concept,
    spec.ordinal,
    pack(spec.indexes, width, height),
    spec.confidence ?? 0.93,
  ));
  const ordered = input.order === "reverse" ? [...objects].reverse() : objects;
  const prepared = await prepareAuthorizedRemoveCleanupInput(
    post(requestBody(width, height, sha256Hex(bytes), ordered, input.patch)),
    harness({ width, height, bytes, adminId: input.adminId, now: input.now }),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("preparation failed");
  return prepared.snapshot;
}

test("preparation stays inside the authorized shared boundary", () => {
  const prepare = source("lib/vibode-stage/remove-cleanup-snapshot.server.ts");
  const handler = source("lib/vibode-stage/remove-cleanup-export.server.ts");
  assert.equal(prepare.match(/export async function/g)?.length, 1);
  assert.match(prepare, /export async function prepareAuthorizedRemoveCleanupInput/);
  assert.doesNotMatch(prepare, /3:2|image_size|aspect_ratio|gemini-3-pro-image|generativelanguage|api\.openai|serverless\.roboflow|concept_segment|supabase|process\.env|storage\.from/);
  const body = prepare.slice(
    prepare.indexOf("export async function prepareAuthorizedRemoveCleanupInput"),
    prepare.indexOf("export function removeCleanupInputIdentityMaterial"),
  );
  assert.equal(body.includes("removeCleanupPaidRequestFingerprint"), false);
  assert.equal(body.includes("OUTPUT_RESOLUTION_CLASSES"), false);
  assert.match(handler, /prepareAuthorizedRemoveCleanupInput/);
  assert.doesNotMatch(handler, /sharp\(|blendRemoveCleanupRgb|renderRemoveCleanupPrompt/);
});

test("snapshot hashes, ids, and fingerprint ignore order, clock, and caller buffers", async () => {
  const width = 30;
  const height = 20;
  const bytes = await png(width, height);
  const tableBits = pack([0, 4], width, height);
  const lampBits = pack([8], width, height);
  const objects = [
    selectedObject("table", 4, tableBits),
    selectedObject("lamp", 1, lampBits, 0.81),
  ];
  const body = requestBody(width, height, sha256Hex(bytes), objects);
  const prepared = await prepareAuthorizedRemoveCleanupInput(
    post(body),
    harness({ width, height, bytes, now: () => "2026-10-20T00:00:00.000Z" }),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const snapshot = prepared.snapshot;
  assert.equal(snapshot.schemaVersion, REMOVE_CLEANUP_SNAPSHOT_VERSION);
  assert.equal(snapshot.providerOutput, null);
  assert.equal(snapshot.aspect.stageRegistration, "not-assessed");
  assert.equal(snapshot.aspect.sourceWidth, width);
  assert.equal(snapshot.aspect.sourceHeight, height);
  assert.equal(snapshot.overlay.color, "#FF00FF");
  assert.equal(snapshot.overlay.color, REMOVE_CLEANUP_MAGENTA.hex);
  assert.equal(snapshot.overlay.opacity, 0.45);
  assert.equal(snapshot.overlay.referenceExpansionPx, 0);
  assert.equal(snapshot.overlay.outline, "none");
  assert.equal(snapshot.overlay.decodedWidth, width);
  assert.equal(snapshot.overlay.decodedHeight, height);
  assert.equal(snapshot.prompt.version, REMOVE_CLEANUP_PROMPT_VERSION);
  assert.equal(snapshot.prompt.text, renderRemoveCleanupPrompt(snapshot.prompt.phrases));
  assert.equal(snapshot.prompt.sha256, sha256Hex(new TextEncoder().encode(snapshot.prompt.text)));
  assert.equal(snapshot.original.sha256, sha256Hex(snapshot.artifacts.originalBytes()));
  assert.deepEqual(snapshot.artifacts.originalBytes(), bytes);
  assert.equal(snapshot.overlay.sha256, sha256Hex(snapshot.artifacts.overlayPng()));
  assert.deepEqual(
    snapshot.selection.objects.map((object) => object.id),
    [objects[1]?.id, objects[0]?.id],
  );
  assert.equal(snapshot.selection.objects[1]?.id, objects[0]?.id);
  assert.match(snapshot.selection.objects[1]?.id ?? "", /-4-/);
  const masks = snapshot.artifacts.selectedMasks();
  assert.deepEqual(masks.map((mask) => mask.id), snapshot.selection.objects.map((object) => object.id));
  for (const mask of masks) {
    const recorded = snapshot.selection.objects.find((object) => object.id === mask.id);
    assert.equal(sha256Hex(mask.bits), recorded?.maskSha256);
  }
  const material = removeCleanupInputIdentityMaterial(snapshot);
  assert.equal(sha256Hex(new TextEncoder().encode(material)), snapshot.inputFingerprint);
  assert.equal(material.includes("brush"), false);
  assert.equal(material.includes("stageRegistration"), false);
  assert.equal(material.includes("providerOutput"), false);
  assert.equal(material.includes("resolutionClass"), false);
  if (snapshot.aspect.providerFamily.admissible) {
    assert.equal(material.includes(snapshot.aspect.providerFamily.family), false);
  }
  const parsed = JSON.parse(material) as { selectedObjects: Array<{ id: string }> };
  assert.deepEqual(parsed.selectedObjects.map((object) => object.id), [
    objects[1]?.id,
    objects[0]?.id,
  ]);

  const reversed = await prepareOne({
    width,
    height,
    bytes,
    objects: [
      { concept: "table", ordinal: 4, indexes: [0, 4], confidence: 0.93 },
      { concept: "lamp", ordinal: 1, indexes: [8], confidence: 0.81 },
    ],
    order: "reverse",
    now: () => "2030-01-01T00:00:00.000Z",
  });
  assert.equal(reversed.inputFingerprint, snapshot.inputFingerprint);
  assert.equal(removeCleanupInputIdentityMaterial(reversed), material);

  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  tableBits[0] = (tableBits[0] ?? 0) ^ 0xff;
  const returnedOriginal = snapshot.artifacts.originalBytes();
  const returnedOverlay = snapshot.artifacts.overlayPng();
  const returnedMask = snapshot.artifacts.selectedMasks()[0];
  assert.ok(returnedMask);
  returnedOriginal[0] = (returnedOriginal[0] ?? 0) ^ 0xff;
  returnedOverlay[0] = (returnedOverlay[0] ?? 0) ^ 0xff;
  returnedMask.bits[0] = (returnedMask.bits[0] ?? 0) ^ 0xff;
  assert.equal(sha256Hex(snapshot.artifacts.originalBytes()), snapshot.original.sha256);
  assert.equal(sha256Hex(snapshot.artifacts.overlayPng()), snapshot.overlay.sha256);
  assert.equal(
    sha256Hex(snapshot.artifacts.selectedMasks()[0]?.bits ?? new Uint8Array()),
    snapshot.selection.objects[0]?.maskSha256,
  );
  assert.notEqual(snapshot.artifacts.originalBytes(), snapshot.artifacts.originalBytes());
});

test("different hidden masks and users change the input fingerprint", async () => {
  const first = await prepareOne({ width: 12, height: 9, objects: [{ concept: "table", ordinal: 4, indexes: [0] }] });
  const second = await prepareOne({ width: 12, height: 9, objects: [{ concept: "table", ordinal: 4, indexes: [1] }] });
  const otherUser = await prepareOne({
    width: 12,
    height: 9,
    adminId: OTHER_ADMIN,
    objects: [{ concept: "table", ordinal: 4, indexes: [0] }],
  });
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
  assert.notEqual(first.inputFingerprint, otherUser.inputFingerprint);
  assert.notEqual(first.selection.unionSha256, second.selection.unionSha256);
  assert.match(first.selection.objects[0]?.id ?? "", /-4-/);
});

test("brush fields and an empty or unauthorized selection do not produce a snapshot", async () => {
  const bytes = await png(8, 8);
  const body = requestBody(8, 8, sha256Hex(bytes), [selectedObject("table", 0, pack([0], 8, 8))]);
  const brush = await prepareAuthorizedRemoveCleanupInput(
    post({ ...body, brushReveal: true, objectExpansionPx: 2, protectObjects: true }),
    harness({ width: 8, height: 8, bytes }),
  );
  assert.equal(brush.ok, false);
  if (brush.ok) return;
  assert.equal(brush.status, 400);
  assert.equal(brush.reason, "Cleanup export request has an unknown field.");

  const empty = await prepareAuthorizedRemoveCleanupInput(
    post({ ...body, selectedObjects: [] }),
    harness({ width: 8, height: 8, bytes }),
  );
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.equal(empty.reason, "Select a hidden object before exporting.");

  const expansion = await prepareAuthorizedRemoveCleanupInput(
    post({ ...body, referenceExpansionPx: 2 }),
    harness({ width: 8, height: 8, bytes }),
  );
  assert.equal(expansion.ok, false);
  if (expansion.ok) return;
  assert.equal(expansion.reason, "Reference mask expansion is not supported.");

  const anonymous = await prepareAuthorizedRemoveCleanupInput(post(body), {
    ...harness({ width: 8, height: 8, bytes }),
    getAdmin: async () => null,
  });
  assert.equal(anonymous.ok, false);
  if (anonymous.ok) return;
  assert.equal(anonymous.status, 403);

  const stale = await prepareAuthorizedRemoveCleanupInput(post(body), harness({
    width: 8,
    height: 8,
    bytes,
    generationPatch: { id: "33333333-3333-4333-8333-333333333333" },
  }));
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.status, 404);
});

test("supported NBP aspect families keep exact ORIGINAL pixels", async () => {
  const families = [
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
  for (const [family, width, height] of families) {
    const classified = classifyNanoBananaProAspectRatio(width, height);
    assert.equal(classified.ok, true, family);
    if (!classified.ok) continue;
    assert.equal(classified.ratio, family);
    const bytes = await png(width, height);
    const bits = pack([0], width, height);
    const prepared = await prepareAuthorizedRemoveCleanupInput(
      post(requestBody(width, height, sha256Hex(bytes), [selectedObject("table", 0, bits)])),
      harness({ width, height, bytes }),
    );
    assert.equal(prepared.ok, true, family);
    if (!prepared.ok) continue;
    const snapshot = prepared.snapshot;
    assert.equal(snapshot.original.decodedWidth, width);
    assert.equal(snapshot.original.decodedHeight, height);
    assert.equal(snapshot.overlay.decodedWidth, width);
    assert.equal(snapshot.overlay.decodedHeight, height);
    assert.equal(snapshot.aspect.providerFamily.admissible, true);
    if (!snapshot.aspect.providerFamily.admissible) continue;
    assert.equal(snapshot.aspect.providerFamily.family, classified.ratio);
    assert.equal(snapshot.aspect.providerFamily.classifier, "classifyNanoBananaProAspectRatio");
    assert.equal(snapshot.aspect.stageRegistration, "not-assessed");
    assert.notEqual(snapshot.overlay.decodedWidth, snapshot.aspect.providerFamily.documented1kGridWidth);
    const overlay = await sharp(snapshot.artifacts.overlayPng()).raw().toBuffer({ resolveWithObject: true });
    assert.equal(overlay.info.width, width);
    assert.equal(overlay.info.height, height);
    const expected = blendRemoveCleanupRgb({
      rgb: await sharp(bytes).raw().toBuffer(),
      width,
      height,
      masks: [bits],
    });
    assert.ok(expected);
    assert.deepEqual(overlay.data, Buffer.from(expected?.overlay ?? new Uint8Array()));
  }

  const extremeWidth = 8;
  const extremeHeight = 2;
  const extreme = await png(extremeWidth, extremeHeight);
  const refused = classifyNanoBananaProAspectRatio(extremeWidth, extremeHeight);
  assert.equal(refused.ok, false);
  const prepared = await prepareAuthorizedRemoveCleanupInput(
    post(requestBody(
      extremeWidth,
      extremeHeight,
      sha256Hex(extreme),
      [selectedObject("table", 0, pack([0], extremeWidth, extremeHeight))],
    )),
    harness({ width: extremeWidth, height: extremeHeight, bytes: extreme }),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok || refused.ok) return;
  assert.equal(prepared.snapshot.aspect.providerFamily.admissible, false);
  if (prepared.snapshot.aspect.providerFamily.admissible) return;
  assert.equal(prepared.snapshot.aspect.providerFamily.reason, refused.reason);
  assert.equal(prepared.snapshot.overlay.decodedWidth, extremeWidth);
  assert.equal(prepared.snapshot.overlay.decodedHeight, extremeHeight);
});

test("export ZIP keeps the REMOVE-2B manifest and uses the shared snapshot", async () => {
  const width = 12;
  const height = 9;
  const bytes = await png(width, height);
  const bits = pack([0, 3], width, height);
  const body = requestBody(width, height, sha256Hex(bytes), [selectedObject("table", 4, bits)]);
  const deps = harness({ width, height, bytes, now: () => "2026-10-20T12:00:00.000Z" });
  const prepared = await prepareAuthorizedRemoveCleanupInput(post(body), deps);
  const response = await handleRemoveCleanupExport(post(body), deps);
  assert.equal(prepared.ok, true);
  assert.equal(response.status, 200);
  if (!prepared.ok) return;
  const files = unzip(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual([...files.keys()], [
    "01-original.png",
    "02-selected-overlay.png",
    "03-selected-mask.png",
    "manifest.json",
    "prompt.txt",
  ]);
  assert.deepEqual(files.get("01-original.png"), bytes);
  assert.deepEqual(files.get("02-selected-overlay.png"), prepared.snapshot.artifacts.overlayPng());
  assert.equal(new TextDecoder().decode(files.get("prompt.txt")), prepared.snapshot.prompt.text);
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as Record<string, unknown>;
  assert.deepEqual(Object.keys(manifest), [
    "schemaVersion",
    "createdAt",
    "roomId",
    "generationId",
    "original",
    "segmentation",
    "selection",
    "overlay",
    "diagnosticMask",
    "prompt",
    "exclusions",
  ]);
  assert.equal(manifest.schemaVersion, "remove-cleanup-export/v1");
  assert.equal(Object.hasOwn(manifest, "inputFingerprint"), false);
  assert.equal(Object.hasOwn(manifest, "providerOutput"), false);
  const selection = manifest.selection as Record<string, unknown>;
  assert.deepEqual(Object.keys(selection), ["count", "objects", "unionPixels", "unionCoveragePercent"]);
  assert.equal(selection.unionPixels, prepared.snapshot.selection.unionPixels);
  const diagnostic = manifest.diagnosticMask as { modelInput: boolean; sha256: string };
  assert.equal(diagnostic.modelInput, false);
  assert.equal(diagnostic.sha256, sha256Hex(prepared.copyDiagnosticPng()));
  assert.equal(prepared.snapshot.exclusions.brushReveal, "excluded");
  assert.equal(prepared.snapshot.exclusions.interactiveMaskExpansion, "excluded");
});

test("paid-request fingerprint is separate from the input fingerprint", async () => {
  const snapshot = await prepareOne({ width: 16, height: 9 });
  const base: RemoveCleanupProviderOutputConfig = {
    schemaVersion: REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION,
    providerId: "provider-a",
    modelId: "model-a",
    aspectRatioFamily: "4:3",
    resolutionClass: "1K",
    mimeType: "image/png",
  };
  const landscape = removeCleanupPaidRequestFingerprint(snapshot.inputFingerprint, base);
  const widescreen = removeCleanupPaidRequestFingerprint(snapshot.inputFingerprint, {
    ...base,
    aspectRatioFamily: "16:9",
  });
  const larger = removeCleanupPaidRequestFingerprint(snapshot.inputFingerprint, {
    ...base,
    resolutionClass: "4K",
  });
  assert.equal(typeof landscape, "string");
  assert.notEqual(landscape, snapshot.inputFingerprint);
  assert.notEqual(landscape, widescreen);
  assert.notEqual(landscape, larger);
  assert.equal(landscape, removeCleanupPaidRequestFingerprint(snapshot.inputFingerprint, base));
  assert.equal(removeCleanupPaidRequestFingerprint("not-a-fingerprint", base), null);
  assert.equal(snapshot.providerOutput, null);
});

function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const copy = Uint8Array.from(bytes);
  const view = new DataView(copy.buffer);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= copy.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    assert.equal(signature, 0x04034b50);
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
