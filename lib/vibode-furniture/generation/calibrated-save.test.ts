import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateFurnitureAsset } from "@/lib/afc-v2-runtime/furniture-asset-validate";
import { authoredPlacementLocalAabb } from "@/lib/afc-v2-runtime/furniture-runtime";
import { encodeGlb, glbBinaryChunk, inspectGlbJsonChunk } from "@/lib/afc-v2-runtime/glb-binary";
import { PERSONAL_FURNITURE_BUCKET, personalFurniturePermanentPath } from "@/lib/vibode-furniture/asset-id";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { personalLibraryItemLeaksStorage, type PersonalFurnitureAssetRecord } from "@/lib/vibode-furniture/library";
import {
  archivePersonalFurniture,
  listPersonalFurniture,
  placePersonalFurniture,
} from "@/lib/vibode-furniture/operations";
import type { PersonalFurnitureStore, PersonalObjectStore } from "@/lib/vibode-furniture/store";

import { bakeUniformGlbScale } from "./bake-glb-scale";
import {
  calibrateUniformDimensions,
  canonicalCalibrationTargetM,
  type CalibrationAxis,
} from "./calibrate";
import type { BucketObjectStore } from "./contracts";
import { createGenerationDatabase, type GenerationJob } from "./engine";
import { createMemoryGenerationCommands } from "./memory-commands";
import { createMemoryBucketStore, generationObjectAllowed } from "./objects";
import { generationCandidatePath } from "./output";
import { MESHY_PROVIDER_ID } from "./policy";
import {
  calibratedFurnitureAssetId,
  postCalibratedFurnitureSave,
  saveCalibratedFurnitureCandidate,
  type CalibratedSaveRequest,
} from "./save";
import { createSqlGenerationCommands } from "./sql-commands";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const HEIGHT_JOB = "c097b220-ed48-463e-aca0-5403d3ca0414";
const WIDTH_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DEPTH_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const NOW = Date.parse("2026-11-08T18:00:00.000Z");
const EXPIRES = Date.parse("2026-11-15T00:12:37.268Z");
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
));

const CHAIR = { widthM: 1.798, heightM: 1.903, depthM: 1.486 };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function chairGlb(): Uint8Array {
  const positions = new Float32Array([
    0, 0, 0,
    CHAIR.widthM, 0, 0,
    0, CHAIR.heightM, CHAIR.depthM,
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
  ]);
  const times = new Float32Array([0, 1]);
  const translations = new Float32Array([
    0.2, 0.4, 0.1,
    0.2, 0.5, 0.1,
  ]);
  const rotations = new Float32Array([
    0, 0, 0, 1,
    0, 0, 0, 1,
  ]);
  const parts = [
    new Uint8Array(positions.buffer),
    new Uint8Array(normals.buffer),
    new Uint8Array(uvs.buffer),
    new Uint8Array(times.buffer),
    new Uint8Array(translations.buffer),
    new Uint8Array(rotations.buffer),
    PNG,
  ];
  const bin = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  const offsets: number[] = [];
  let cursor = 0;
  for (const part of parts) {
    offsets.push(cursor);
    bin.set(part, cursor);
    cursor += part.byteLength;
  }
  const view = (index: number) => ({
    buffer: 0,
    byteOffset: offsets[index],
    byteLength: parts[index].byteLength,
  });
  return encodeGlb({
    asset: { version: "2.0", generator: "fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "root", children: [1], translation: [0.2, 0.4, 0.1], scale: [1, 1, 1] },
      { name: "seat", mesh: 0 },
    ],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        material: 0,
      }],
    }],
    materials: [{
      name: "fabric",
      pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
    }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 6, mimeType: "image/png" }],
    animations: [{
      name: "settle",
      channels: [
        { sampler: 0, target: { node: 0, path: "translation" } },
        { sampler: 1, target: { node: 0, path: "rotation" } },
      ],
      samplers: [
        { input: 3, output: 4, interpolation: "LINEAR" },
        { input: 3, output: 5, interpolation: "LINEAR" },
      ],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [CHAIR.widthM, CHAIR.heightM, CHAIR.depthM] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: 3, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 4, componentType: 5126, count: 2, type: "VEC3" },
      { bufferView: 5, componentType: 5126, count: 2, type: "VEC4" },
    ],
    bufferViews: [0, 1, 2, 3, 4, 5, 6].map(view),
    buffers: [{ byteLength: bin.byteLength }],
  }, bin);
}

function readyJob(jobId: string, bytes: Uint8Array): GenerationJob {
  return {
    jobId,
    userId: USER_A,
    provider: MESHY_PROVIDER_ID,
    aiModel: "meshy-7.1",
    operation: "image-to-3d",
    idempotencyKey: `idem-${jobId.slice(0, 8)}`,
    requestSha256: "cd".repeat(32),
    settings: defaultFurnitureGeneratorSettings(),
    imageSlots: ["front"],
    providerTaskName: `vibode-${jobId}`,
    providerTaskId: "018a210d-8ba4-705c-b111-1f1776f7f580",
    providerStatus: "SUCCEEDED",
    status: "ready",
    progress: 100,
    claimNonce: null,
    claimExpiresAtMs: null,
    attemptCount: 1,
    providerContactedAtMs: NOW - 1000,
    absenceReconciledAtMs: null,
    resubmitAuthorized: false,
    quotaState: "reconciled",
    reservedCredits: 30,
    consumedCredits: 30,
    outputBucket: PERSONAL_FURNITURE_BUCKET,
    outputObjectPath: generationCandidatePath(USER_A, jobId),
    outputSha256: sha256(bytes),
    outputByteSize: bytes.byteLength,
    outputExpiresAtMs: EXPIRES,
    errorClass: null,
    errorCode: null,
    savedAssetId: null,
    createdAtMs: NOW - 2000,
    updatedAtMs: NOW - 1000,
  };
}

type MutableAsset = { -readonly [K in keyof PersonalFurnitureAssetRecord]: PersonalFurnitureAssetRecord[K] };

class LibraryRecords implements PersonalFurnitureStore {
  assets: MutableAsset[] = [];

  async countOpenUploads(): Promise<number> {
    throw new Error("unexpected upload read");
  }

  async expireUploads(): Promise<readonly string[]> {
    throw new Error("unexpected upload expiry");
  }

  async insertUpload(): Promise<void> {
    throw new Error("unexpected upload insert");
  }

  async readUpload(): Promise<null> {
    throw new Error("unexpected upload read");
  }

  async claimUpload(): Promise<null> {
    throw new Error("unexpected upload claim");
  }

  async markUploadFinalized(): Promise<void> {
    throw new Error("unexpected upload finalize");
  }

  async markUploadRejected(): Promise<void> {
    throw new Error("unexpected upload reject");
  }

  async findAssetBySha(userId: string, sha: string) {
    return this.assets.find((asset) => asset.userId === userId && asset.sha256 === sha) ?? null;
  }

  async findOwnedAsset(userId: string, assetId: string) {
    return this.assets.find((asset) => asset.userId === userId && asset.assetId === assetId) ?? null;
  }

  async insertAsset(asset: PersonalFurnitureAssetRecord) {
    if (this.assets.some((item) => item.assetId === asset.assetId || (item.userId === asset.userId && item.sha256 === asset.sha256))) {
      return "exists" as const;
    }
    this.assets.push({ ...asset });
    return "inserted" as const;
  }

  async listActive(userId: string) {
    return this.assets.filter((asset) => asset.userId === userId && asset.libraryVisibility === "active");
  }

  async archiveAsset(userId: string, assetId: string) {
    const asset = this.assets.find((item) => item.userId === userId && item.assetId === assetId);
    if (!asset) return "missing" as const;
    asset.libraryVisibility = "archived";
    return "archived" as const;
  }

  async ownedAssetIds(userId: string, assetIds: readonly string[]) {
    return new Set(this.assets.filter((asset) => asset.userId === userId && assetIds.includes(asset.assetId)).map((asset) => asset.assetId));
  }
}

class LibraryObjects implements PersonalObjectStore {
  readonly bytes = new Map<string, Uint8Array>();
  writes = 0;
  removes: string[] = [];

  async createPendingUploadUrl() {
    return null;
  }

  async read(path: string) {
    const found = this.bytes.get(path);
    return found ? Uint8Array.from(found) : null;
  }

  async writePermanent(path: string, bytes: Uint8Array): Promise<"written" | "exists" | "failed"> {
    this.writes += 1;
    if (this.bytes.has(path)) return "exists" as const;
    this.bytes.set(path, Uint8Array.from(bytes));
    return "written" as const;
  }

  async remove(path: string) {
    this.removes.push(path);
    this.bytes.delete(path);
  }

  async signGet(path: string) {
    if (!this.bytes.has(path)) return null;
    return {
      signedUrl: `https://signed.example/get?object=${encodeURIComponent(path)}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  }
}

function watch(store: BucketObjectStore): { store: BucketObjectStore; counts: { get: number; remove: number; sign: number } } {
  const counts = { get: 0, remove: 0, sign: 0 };
  return {
    counts,
    store: {
      async put(input) {
        return store.put(input);
      },
      async get(input) {
        counts.get += 1;
        return store.get(input);
      },
      async remove(input) {
        counts.remove += 1;
        return store.remove(input);
      },
      async sign(input) {
        counts.sign += 1;
        return store.sign(input);
      },
    },
  };
}

function harness(bytes = chairGlb()) {
  const db = createGenerationDatabase();
  const job = readyJob(HEIGHT_JOB, bytes);
  db.jobs.push(job);
  const inner = createMemoryBucketStore();
  const library = new LibraryRecords();
  const libraryObjects = new LibraryObjects();
  const watched = watch(inner);
  const commands = createMemoryGenerationCommands(db, { nowMs: NOW });
  const request = (overrides: Partial<CalibratedSaveRequest> = {}): CalibratedSaveRequest => ({
    userId: USER_A,
    jobId: HEIGHT_JOB,
    displayName: "Armchair",
    category: "seating",
    axis: "height",
    targetM: 0.85,
    nowMs: NOW,
    commands,
    objects: watched.store,
    library,
    libraryObjects,
    ...overrides,
  });
  return { db, job, bytes, inner, watched, library, libraryObjects, commands, request };
}

async function seed(inner: BucketObjectStore, job: GenerationJob, bytes: Uint8Array) {
  await inner.put({
    bucket: job.outputBucket!,
    path: job.outputObjectPath!,
    bytes,
    contentType: "model/gltf-binary",
  });
}

test("uniform calibration preserves proportions for every axis", () => {
  const height = calibrateUniformDimensions({ measured: CHAIR, axis: "height", targetM: 0.85 });
  assert.equal(height.ok, true);
  if (!height.ok) return;
  assert.ok(Math.abs(height.calibration.factor - 0.4467) < 0.0001);
  assert.ok(Math.abs(height.calibration.heightM - 0.85) < 1e-9);
  assert.ok(Math.abs(height.calibration.widthM - 0.803) < 0.001);
  assert.ok(Math.abs(height.calibration.depthM - 0.664) < 0.001);
  assert.ok(Math.abs(height.calibration.widthM / CHAIR.widthM - height.calibration.factor) < 1e-12);
  assert.ok(Math.abs(height.calibration.depthM / CHAIR.depthM - height.calibration.factor) < 1e-12);

  const width = calibrateUniformDimensions({ measured: CHAIR, axis: "width", targetM: 0.9 });
  assert.equal(width.ok, true);
  if (!width.ok) return;
  assert.ok(Math.abs(width.calibration.widthM - 0.9) < 1e-9);
  assert.ok(Math.abs(width.calibration.heightM - CHAIR.heightM * (0.9 / CHAIR.widthM)) < 1e-9);
  assert.ok(Math.abs(width.calibration.depthM - CHAIR.depthM * (0.9 / CHAIR.widthM)) < 1e-9);

  const depth = calibrateUniformDimensions({ measured: CHAIR, axis: "depth", targetM: 0.7 });
  assert.equal(depth.ok, true);
  if (!depth.ok) return;
  assert.ok(Math.abs(depth.calibration.depthM - 0.7) < 1e-9);
  assert.ok(Math.abs(depth.calibration.widthM - CHAIR.widthM * (0.7 / CHAIR.depthM)) < 1e-9);
  assert.ok(Math.abs(depth.calibration.heightM - CHAIR.heightM * (0.7 / CHAIR.depthM)) < 1e-9);

  assert.equal(canonicalCalibrationTargetM(0.85), canonicalCalibrationTargetM(0.8500004));
  for (const target of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(calibrateUniformDimensions({ measured: CHAIR, axis: "height", targetM: target }).ok, false);
  }
  for (const [axis, target, code] of [
    ["height", 0.04, "implausible_result"],
    ["height", 9, "implausible_result"],
    ["width", 0.05, "implausible_result"],
    ["diagonal", 0.85, "invalid_axis"],
  ] as const) {
    const rejected = calibrateUniformDimensions({ measured: CHAIR, axis, targetM: target });
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.code, code);
  }
});

test("the baked GLB scales positions and keeps textures, normals, and rotations", () => {
  const bytes = chairGlb();
  const before = Uint8Array.from(bytes);
  const baked = bakeUniformGlbScale(bytes, 0.5);
  assert.equal(baked.ok, true);
  if (!baked.ok) return;
  assert.deepEqual(bytes, before);
  const again = bakeUniformGlbScale(bytes, 0.5);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(baked.bytes, again.bytes);

  const sourceBin = glbBinaryChunk(bytes);
  const bakedBin = glbBinaryChunk(baked.bytes);
  assert.ok(sourceBin && bakedBin);
  if (!sourceBin || !bakedBin) return;
  assert.notDeepEqual(bakedBin.subarray(0, 36), sourceBin.subarray(0, 36));
  assert.deepEqual(bakedBin.subarray(36, 36 + 36 + 24), sourceBin.subarray(36, 36 + 36 + 24));
  assert.notDeepEqual(bakedBin.subarray(36 + 36 + 24 + 8, 36 + 36 + 24 + 8 + 24), sourceBin.subarray(36 + 36 + 24 + 8, 36 + 36 + 24 + 8 + 24));
  assert.deepEqual(
    bakedBin.subarray(36 + 36 + 24 + 8 + 24, 36 + 36 + 24 + 8 + 24 + 32),
    sourceBin.subarray(36 + 36 + 24 + 8 + 24, 36 + 36 + 24 + 8 + 24 + 32),
  );
  assert.deepEqual(bakedBin.subarray(160, 160 + PNG.byteLength), PNG);

  const json = inspectGlbJsonChunk(baked.bytes);
  assert.equal(json.ok, true);
  if (!json.ok) return;
  const document = json.json as {
    nodes?: Array<{ translation?: number[]; scale?: number[] }>;
    extensionsRequired?: string[];
    materials?: Array<{ name?: string }>;
  };
  assert.deepEqual(document.nodes?.[0]?.scale, [1, 1, 1]);
  assert.ok(Math.abs((document.nodes?.[0]?.translation?.[0] ?? 0) - 0.1) < 1e-6);
  assert.equal(document.extensionsRequired, undefined);
  assert.equal(document.materials?.[0]?.name, "fabric");
  assert.equal(baked.bytes.byteLength <= 25 * 1024 * 1024, true);

  const draco = encodeGlb({
    asset: { version: "2.0" },
    extensionsRequired: ["KHR_draco_mesh_compression"],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  }, new Uint8Array(36));
  assert.equal(bakeUniformGlbScale(draco, 0.5).ok, false);
  const zero = bakeUniformGlbScale(bytes, 0);
  const nan = bakeUniformGlbScale(bytes, Number.NaN);
  assert.equal(zero.ok, false);
  assert.equal(nan.ok, false);
  if (zero.ok || nan.ok) return;
  assert.equal(zero.code, "invalid_scale");
  assert.equal(nan.code, "invalid_scale");
});

test("interleaved positions scale without changing the neighbouring normals", () => {
  const interleaved = new Float32Array([
    0, 0, 0, 0, 1, 0,
    1, 0, 0, 0, 1, 0,
    0, 1, 1, 0, 1, 0,
  ]);
  const bin = new Uint8Array(interleaved.buffer);
  const bytes = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: "VEC3" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, byteStride: 24 }],
    buffers: [{ byteLength: bin.byteLength }],
  }, bin);
  const withSkin = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 1] },
      {
        bufferView: 1,
        componentType: 5126,
        count: 1,
        type: "MAT4",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 64 },
    ],
    buffers: [{ byteLength: 100 }],
    skins: [{ inverseBindMatrices: 1, joints: [0] }],
  }, (() => {
    const skinBin = new Uint8Array(100);
    skinBin.set(bin.subarray(0, 36), 0);
    const matrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      2, 0, 0, 1,
    ]);
    skinBin.set(new Uint8Array(matrix.buffer), 36);
    return skinBin;
  })());
  const scaled = bakeUniformGlbScale(bytes, 0.5);
  assert.equal(scaled.ok, true);
  if (!scaled.ok) return;
  const out = glbBinaryChunk(scaled.bytes);
  assert.ok(out);
  if (!out) return;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assert.equal(view.getFloat32(0, true), 0);
  assert.equal(view.getFloat32(24, true), 0.5);
  assert.equal(view.getFloat32(12, true), 0);
  assert.equal(view.getFloat32(16, true), 1);
  const bakedJson = inspectGlbJsonChunk(scaled.bytes);
  assert.equal(bakedJson.ok, true);
  if (!bakedJson.ok) return;
  const matrix = (bakedJson.json as { nodes?: Array<{ matrix?: number[] }> }).nodes?.[0]?.matrix;
  assert.equal(matrix?.[12], 2);
  assert.equal(matrix?.[13], 2.5);
  assert.equal(matrix?.[14], 3);
  assert.equal(matrix?.[0], 1);

  const skinned = bakeUniformGlbScale(withSkin, 0.5);
  assert.equal(skinned.ok, true);
  if (!skinned.ok) return;
  const skinBin = glbBinaryChunk(skinned.bytes);
  assert.ok(skinBin);
  if (!skinBin) return;
  const skinView = new DataView(skinBin.buffer, skinBin.byteOffset, skinBin.byteLength);
  assert.equal(skinView.getFloat32(36 + 48, true), 1);

  const sparse = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", sparse: { count: 1 } }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  }, new Uint8Array(36));
  const sparseResult = bakeUniformGlbScale(sparse, 0.5);
  assert.equal(sparseResult.ok, false);
  if (sparseResult.ok) return;
  assert.equal(sparseResult.code, "unsupported");
  const quantized = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5123, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteLength: 18 }],
    buffers: [{ byteLength: 18 }],
  }, new Uint8Array(20));
  const quantizedResult = bakeUniformGlbScale(quantized, 0.5);
  assert.equal(quantizedResult.ok, false);
  if (quantizedResult.ok) return;
  assert.equal(quantizedResult.code, "unsupported");
});

test("a ready candidate becomes one permanent scaled asset", async () => {
  const ctx = harness();
  await seed(ctx.inner, ctx.job, ctx.bytes);
  const candidateSha = ctx.job.outputSha256;
  const saved = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.idempotent, false);
  assert.equal(saved.item.displayName, "Armchair");
  assert.equal(saved.item.category, "seating");
  assert.ok(Math.abs(saved.item.authoredHeightM - 0.85) < 1e-3);
  assert.ok(Math.abs(saved.item.authoredWidthM - 0.803) < 1e-3);
  assert.ok(Math.abs(saved.item.authoredDepthM - 0.664) < 1e-3);
  assert.equal(personalLibraryItemLeaksStorage(saved.item), false);
  assert.equal(JSON.stringify(saved).includes(candidateSha ?? ""), false);
  assert.equal(JSON.stringify(saved).includes("candidate.glb"), false);
  assert.equal(ctx.library.assets.length, 1);
  assert.equal(ctx.library.assets[0]?.origin, "uploaded");
  assert.equal(ctx.library.assets[0]?.libraryVisibility, "active");
  assert.equal(ctx.job.status, "saved");
  assert.equal(ctx.job.savedAssetId, saved.item.assetId);
  assert.equal(ctx.job.outputSha256, candidateSha);
  assert.equal(ctx.job.outputByteSize, ctx.bytes.byteLength);
  assert.equal(ctx.job.outputExpiresAtMs, EXPIRES);
  assert.equal(sha256(await ctx.inner.get({ bucket: ctx.job.outputBucket!, path: ctx.job.outputObjectPath! }) ?? new Uint8Array()), candidateSha);
  assert.equal(ctx.watched.counts.remove, 0);
  assert.equal(ctx.watched.counts.sign, 0);

  const storedPath = ctx.library.assets[0]?.storageObjectPath ?? "";
  assert.equal(storedPath.includes("/assets/"), true);
  assert.equal(storedPath.includes("/generations/"), false);
  const stored = await ctx.libraryObjects.read(storedPath);
  assert.ok(stored);
  if (!stored) return;
  assert.notEqual(sha256(stored), candidateSha);
  assert.equal(stored.byteLength, ctx.library.assets[0]?.byteSize);
  const validated = await validateFurnitureAsset({
    bytes: stored,
    glbPath: "saved-furniture.glb",
    assetId: saved.item.assetId,
    dimensionAuthority: "measured",
    maxBytes: 25 * 1024 * 1024,
  });
  assert.equal(validated.accepted, true, validated.errors.map((item) => item.code).join(","));
  assert.equal(validated.placementScale, 1);
  assert.ok(validated.measured);
  assert.ok(Math.abs((validated.measured?.heightM ?? 0) - saved.item.authoredHeightM) < 1e-6);
  assert.ok(Math.abs((validated.measured?.widthM ?? 0) - saved.item.authoredWidthM) < 1e-6);
  assert.ok(Math.abs((validated.measured?.depthM ?? 0) - saved.item.authoredDepthM) < 1e-6);

  const placed = await placePersonalFurniture({
    userId: USER_A,
    assetId: saved.item.assetId,
    store: ctx.library,
    objects: ctx.libraryObjects,
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(placed.runtimeAsset.authoredHeightM, saved.item.authoredHeightM);
  const aabb = authoredPlacementLocalAabb(placed.runtimeAsset);
  assert.ok(aabb);
  assert.ok(Math.abs((aabb?.max.y ?? 0) - (aabb?.min.y ?? 0) - placed.runtimeAsset.authoredHeightM) < 1e-9);
  assert.equal(JSON.stringify(placed.runtimeAsset).includes("candidate.glb"), false);

  const preview = await ctx.commands.previewSource(USER_A, HEIGHT_JOB);
  assert.equal(preview.ok, false);
  const repeated = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.item.assetId, saved.item.assetId);
  assert.equal(ctx.library.assets.length, 1);
  assert.equal(ctx.libraryObjects.writes, 1);
  assert.equal(ctx.job.outputSha256, candidateSha);

  const different = await saveCalibratedFurnitureCandidate(ctx.request({ targetM: 0.9 }));
  assert.equal(different.ok, false);
  if (different.ok) return;
  assert.equal(different.errorCode, "ALREADY_SAVED");
  assert.equal(ctx.library.assets.length, 1);

  await ctx.commands.sweep(EXPIRES + 1000);
  assert.equal(ctx.job.status, "saved");
  assert.equal(ctx.job.outputSha256, candidateSha);
  assert.equal(ctx.job.outputExpiresAtMs, EXPIRES);
  const temporary = await ctx.commands.listTemporaryObjects(10);
  assert.equal(temporary.some((item) => item.kind === "candidate"), false);
  assert.equal(await ctx.commands.markTemporaryPurged({
    kind: "candidate",
    bucket: PERSONAL_FURNITURE_BUCKET,
    path: ctx.job.outputObjectPath!,
    jobId: HEIGHT_JOB,
    userId: USER_A,
    slot: null,
  }), false);
  await ctx.inner.remove({ bucket: ctx.job.outputBucket!, path: ctx.job.outputObjectPath! });
  const afterCleanup = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(afterCleanup.ok, true);
  if (!afterCleanup.ok) return;
  assert.equal(afterCleanup.item.assetId, saved.item.assetId);
  const stillThere = await placePersonalFurniture({
    userId: USER_A,
    assetId: saved.item.assetId,
    store: ctx.library,
    objects: ctx.libraryObjects,
  });
  assert.equal(stillThere.ok, true);

  await archivePersonalFurniture({ userId: USER_A, assetId: saved.item.assetId, store: ctx.library });
  assert.equal((await listPersonalFurniture({
    userId: USER_A,
    store: ctx.library,
    objects: ctx.libraryObjects,
  })).length, 0);
  const archived = await placePersonalFurniture({
    userId: USER_A,
    assetId: saved.item.assetId,
    store: ctx.library,
    objects: ctx.libraryObjects,
  });
  assert.equal(archived.ok, false);
});

test("width and depth calibration bake the same uniform scale into the GLB", async () => {
  for (const [axis, target, jobId] of [
    ["width", 0.9, WIDTH_JOB],
    ["depth", 0.7, DEPTH_JOB],
  ] as const) {
    const bytes = chairGlb();
    const db = createGenerationDatabase();
    const job = readyJob(jobId, bytes);
    db.jobs.push(job);
    const inner = createMemoryBucketStore();
    await seed(inner, job, bytes);
    const library = new LibraryRecords();
    const libraryObjects = new LibraryObjects();
    const saved = await saveCalibratedFurnitureCandidate({
      userId: USER_A,
      jobId,
      displayName: "Armchair",
      axis,
      targetM: target,
      nowMs: NOW,
      commands: createMemoryGenerationCommands(db, { nowMs: NOW }),
      objects: inner,
      library,
      libraryObjects,
    });
    assert.equal(saved.ok, true, axis);
    if (!saved.ok) return;
    const expected = axis === "width" ? saved.item.authoredWidthM : saved.item.authoredDepthM;
    assert.ok(Math.abs(expected - target) < 1e-3);
    const factor = target / (axis === "width" ? CHAIR.widthM : CHAIR.depthM);
    assert.ok(Math.abs(saved.item.authoredWidthM - CHAIR.widthM * factor) < 1e-3);
    assert.ok(Math.abs(saved.item.authoredHeightM - CHAIR.heightM * factor) < 1e-3);
    assert.ok(Math.abs(saved.item.authoredDepthM - CHAIR.depthM * factor) < 1e-3);
    const stored = await libraryObjects.read(library.assets[0]?.storageObjectPath ?? "");
    assert.ok(stored);
    if (!stored) return;
    const validated = await validateFurnitureAsset({
      bytes: stored,
      glbPath: "saved-furniture.glb",
      assetId: saved.item.assetId,
      dimensionAuthority: "measured",
    });
    assert.equal(validated.placementScale, 1);
    assert.equal(validated.accepted, true);
    assert.equal(job.outputSha256, sha256(bytes));
    assert.equal(job.status, "saved");
  }
});

test("invalid, foreign, expired, and mismatched candidates do not write an asset", async () => {
  const ctx = harness();
  await seed(ctx.inner, ctx.job, ctx.bytes);
  const sha = ctx.job.outputSha256;
  const expired = await saveCalibratedFurnitureCandidate(ctx.request({ nowMs: EXPIRES }));
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.errorCode, "CANDIDATE_EXPIRED");
  assert.equal(ctx.job.status, "ready");
  assert.equal(ctx.job.outputExpiresAtMs, EXPIRES);
  assert.equal(ctx.library.assets.length, 0);
  assert.equal(ctx.libraryObjects.writes, 0);

  const extreme = await saveCalibratedFurnitureCandidate(ctx.request({ targetM: 9 }));
  assert.equal(extreme.ok, false);
  if (extreme.ok) return;
  assert.equal(extreme.errorCode, "IMPLAUSIBLE_SIZE");
  const unnamed = await saveCalibratedFurnitureCandidate(ctx.request({ displayName: "   " }));
  assert.equal(unnamed.ok, false);
  if (unnamed.ok) return;
  assert.equal(unnamed.errorCode, "INVALID_NAME");
  assert.equal(ctx.watched.counts.get, 0);

  const foreign = await saveCalibratedFurnitureCandidate(ctx.request({ userId: USER_B }));
  assert.equal(foreign.ok, false);
  if (foreign.ok) return;
  assert.equal(foreign.status, 404);
  assert.equal(ctx.library.assets.length, 0);

  ctx.job.outputSha256 = "ab".repeat(32);
  const mismatch = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.errorCode, "SOURCE_MISMATCH");
  ctx.job.outputSha256 = sha;
  assert.equal(sha256(await ctx.inner.get({
    bucket: ctx.job.outputBucket!,
    path: ctx.job.outputObjectPath!,
  }) ?? new Uint8Array()), sha);

  const missingCtx = harness();
  missingCtx.db.jobs.push(missingCtx.job);
  const missing = await saveCalibratedFurnitureCandidate(missingCtx.request());
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.errorCode, "CANDIDATE_MISSING");
  assert.equal(missingCtx.job.status, "ready");
  assert.equal(missingCtx.library.assets.length, 0);
});

test("a database failure after the upload does not create a second asset or change the candidate", async () => {
  const ctx = harness();
  await seed(ctx.inner, ctx.job, ctx.bytes);
  const sha = ctx.job.outputSha256;
  let fail = true;
  const original = ctx.library.insertAsset.bind(ctx.library);
  ctx.library.insertAsset = async (asset) => {
    if (fail) {
      fail = false;
      throw new Error("database unavailable");
    }
    return original(asset);
  };
  const first = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.status, 500);
  assert.equal(ctx.library.assets.length, 0);
  assert.equal(ctx.job.status, "ready");
  assert.equal(ctx.job.savedAssetId, null);
  assert.equal(ctx.job.outputSha256, sha);
  assert.equal(ctx.watched.counts.remove, 0);
  const second = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.idempotent, false);
  assert.equal(ctx.library.assets.length, 1);
  assert.equal(ctx.libraryObjects.bytes.size, 1);
  assert.equal(ctx.job.status, "saved");
  assert.equal(ctx.job.outputSha256, sha);
  const third = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.idempotent, true);
  assert.equal(third.item.assetId, second.item.assetId);
});

test("a link failure after the asset insert is recovered by the same request", async () => {
  const ctx = harness();
  await seed(ctx.inner, ctx.job, ctx.bytes);
  const sha = ctx.job.outputSha256;
  let fail = true;
  const original = ctx.commands.linkSavedAsset.bind(ctx.commands);
  ctx.commands.linkSavedAsset = async (input) => {
    if (fail) {
      fail = false;
      return { ok: false, code: "unavailable" };
    }
    return original(input);
  };
  const first = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.errorCode, "SAVE_INCOMPLETE");
  assert.equal(ctx.library.assets.length, 1);
  assert.equal(ctx.job.status, "ready");
  assert.equal(ctx.job.savedAssetId, null);
  assert.equal(ctx.job.outputSha256, sha);
  assert.equal(ctx.watched.counts.remove, 0);
  const second = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.idempotent, true);
  assert.equal(ctx.library.assets.length, 1);
  assert.equal(ctx.job.status, "saved");
  assert.equal(ctx.job.savedAssetId, second.item.assetId);
  assert.equal(ctx.job.outputSha256, sha);
});

test("a storage failure and an occupied path leave the candidate unchanged", async () => {
  const ctx = harness();
  await seed(ctx.inner, ctx.job, ctx.bytes);
  const sha = ctx.job.outputSha256;
  ctx.libraryObjects.writePermanent = async () => "failed";
  const failed = await saveCalibratedFurnitureCandidate(ctx.request());
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.errorCode, "STORE_FAILED");
  assert.equal(ctx.library.assets.length, 0);
  assert.equal(ctx.job.status, "ready");
  assert.equal(ctx.job.outputSha256, sha);

  const occupied = harness();
  await seed(occupied.inner, occupied.job, occupied.bytes);
  const assetId = calibratedFurnitureAssetId({
    userId: USER_A,
    jobId: HEIGHT_JOB,
    axis: "height",
    targetM: 0.85,
    sourceSha256: occupied.job.outputSha256!,
  });
  const path = personalFurniturePermanentPath(USER_A, assetId!);
  assert.ok(path);
  occupied.libraryObjects.bytes.set(path!, Uint8Array.from([1, 2, 3, 4]));
  const clash = await saveCalibratedFurnitureCandidate(occupied.request());
  assert.equal(clash.ok, false);
  if (clash.ok) return;
  assert.equal(clash.errorCode, "ASSET_EXISTS");
  assert.deepEqual(occupied.libraryObjects.bytes.get(path!), Uint8Array.from([1, 2, 3, 4]));
  assert.equal(occupied.job.status, "ready");
  assert.equal(occupied.job.outputSha256, sha256(occupied.bytes));
  assert.equal(occupied.libraryObjects.removes.length, 0);
  assert.equal(generationObjectAllowed(
    PERSONAL_FURNITURE_BUCKET,
    generationCandidatePath(USER_A, HEIGHT_JOB),
    USER_A,
  ), true);
});

test("the save route authenticates the owner and does not enable generation", async () => {
  const ctx = harness();
  await seed(ctx.inner, ctx.job, ctx.bytes);
  const unauthorized = await postCalibratedFurnitureSave(new Request("https://vibode.local/save", {
    method: "POST",
    body: JSON.stringify({ displayName: "Armchair", axis: "height", targetM: 0.85 }),
  }), {
    authorize: async () => ({ ok: false, response: { status: 401, body: { ok: false, error: "Unauthorized." } } }),
    commands: ctx.commands,
    objects: ctx.watched.store,
    library: ctx.library,
    libraryObjects: ctx.libraryObjects,
    nowMs: () => NOW,
  }, HEIGHT_JOB);
  assert.equal(unauthorized.status, 401);
  assert.equal(ctx.watched.counts.get, 0);

  const saved = await postCalibratedFurnitureSave(new Request("https://vibode.local/save", {
    method: "POST",
    body: JSON.stringify({ displayName: "Armchair", category: "seating", axis: "height", targetM: 0.85 }),
  }), {
    authorize: async () => ({ ok: true, userId: USER_A, email: null }),
    commands: ctx.commands,
    objects: ctx.watched.store,
    library: ctx.library,
    libraryObjects: ctx.libraryObjects,
    nowMs: () => NOW,
  }, HEIGHT_JOB);
  assert.equal(saved.status, 200);
  assert.equal(JSON.stringify(saved.body).includes("candidate.glb"), false);
  assert.equal(JSON.stringify(saved.body).includes(ctx.job.outputSha256 ?? ""), false);

  const forged = await postCalibratedFurnitureSave(new Request("https://vibode.local/save", {
    method: "POST",
    body: JSON.stringify({ displayName: "Armchair", axis: "height", targetM: 0.85, assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  }), {
    authorize: async () => ({ ok: true, userId: USER_A, email: null }),
    commands: ctx.commands,
    objects: ctx.watched.store,
    library: ctx.library,
    libraryObjects: ctx.libraryObjects,
    nowMs: () => NOW,
  }, HEIGHT_JOB);
  assert.equal(forged.status, 400);
  assert.equal(ctx.library.assets.length, 1);

  const calls: Array<{ fn: string; values: readonly unknown[] }> = [];
  const commands = createSqlGenerationCommands(async (fn, values) => {
    calls.push({ fn, values });
    if (fn === "read_vibode_furniture_generation_save_source") {
      return {
        ok: true,
        status: "ready",
        saved_asset_id: null,
        output_bucket: PERSONAL_FURNITURE_BUCKET,
        output_object_path: generationCandidatePath(USER_A, HEIGHT_JOB),
        output_sha256: "ab".repeat(32),
        output_byte_size: 128,
        output_expires_at: "2026-11-15T00:12:37.268Z",
        previewUrl: "https://signed.example/should-not-pass",
      };
    }
    return { ok: true, status: "saved", idempotent: false };
  });
  const read = await commands.readSaveSource(USER_A, HEIGHT_JOB);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.sha256, "ab".repeat(32));
  assert.equal("previewUrl" in read, false);
  const linked = await commands.linkSavedAsset({
    userId: USER_A,
    jobId: HEIGHT_JOB,
    assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceSha256: "ab".repeat(32),
    sourceByteSize: 128,
    assetSha256: "cd".repeat(32),
    assetByteSize: 64,
    nowMs: NOW,
  });
  assert.equal(linked.ok, true);
  assert.deepEqual(calls.map((call) => call.fn), [
    "read_vibode_furniture_generation_save_source",
    "link_vibode_furniture_generation_saved_asset",
  ]);
  assert.deepEqual(calls[1]?.values, [
    USER_A,
    HEIGHT_JOB,
    "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "ab".repeat(32),
    128,
    "cd".repeat(32),
    64,
  ]);

  const sql = source("supabase/migrations/20261108110000_vibode_furniture_generation_calibrated_save.sql");
  const update = sql.slice(sql.indexOf("update public.vibode_furniture_generation_jobs"), sql.indexOf("get diagnostics"));
  const set = update.slice(update.indexOf("set"), update.indexOf("where"));
  assert.match(set, /status = 'saved'/);
  assert.match(set, /saved_asset_id = p_asset_id/);
  assert.doesNotMatch(set, /output_/);
  assert.match(sql, /output_expires_at > now\(\)/);
  assert.match(sql, /from public\.vibode_furniture_assets/);
  assert.doesNotMatch(sql, /insert into public\.vibode_furniture_assets/i);
  assert.doesNotMatch(sql, /storage\.objects|createSignedUrl|delete from/i);
  assert.match(sql, /grant execute on function public\.link_vibode_furniture_generation_saved_asset/);
  assert.doesNotMatch(sql, /to anon|to authenticated|to public/);
  const saveSource = source("lib/vibode-furniture/generation/save.ts");
  const route = source("app/api/vibode/furniture-generations/[jobId]/save/route.ts");
  assert.doesNotMatch(`${saveSource}\n${route}`, /api\.meshy\.ai|MESHY_API_KEY|console\.(log|info|debug|warn|error)/);
  assert.match(source("components/stage/FurnitureGeneratorPanel.tsx"), /data-generate="unavailable"/);
});

test("axis is part of the stable asset identity", () => {
  const sha = "ab".repeat(32);
  const height = calibratedFurnitureAssetId({
    userId: USER_A,
    jobId: HEIGHT_JOB,
    axis: "height" satisfies CalibrationAxis,
    targetM: 0.85,
    sourceSha256: sha,
  });
  const same = calibratedFurnitureAssetId({
    userId: USER_A.toUpperCase(),
    jobId: HEIGHT_JOB,
    axis: "height",
    targetM: 0.8500004,
    sourceSha256: sha,
  });
  const width = calibratedFurnitureAssetId({
    userId: USER_A,
    jobId: HEIGHT_JOB,
    axis: "width",
    targetM: 0.85,
    sourceSha256: sha,
  });
  assert.equal(height, same);
  assert.notEqual(height, width);
});
