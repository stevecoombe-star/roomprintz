/**
 * Meshy 7.1 provider foundation.
 * Uses a scripted transport and a memory ledger. No network and no provider key.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { encodeUntexturedFurnitureProbeGlb } from "@/lib/afc-v2-runtime/textured-furniture-probe-glb";
import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";
import {
  defaultFurnitureGeneratorSettings,
  type FurnitureGeneratorSettings,
} from "@/lib/vibode-furniture/generator/settings";
import { previewLoadPlan } from "@/lib/vibode-furniture/generator/preview";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

import { estimateMeshy71Credits } from "./credits";
import { claimGeneration, createGenerationDatabase } from "./engine";
import { furnitureImageDimensionIssue, inspectFurnitureImage } from "./images";
import { createMeshyAdapter } from "./meshy-adapter";
import {
  matchListedMeshyTask,
  meshyAssetUrlDecision,
  normalizeMeshyHttpFailure,
  parseMeshyTask,
  type MeshyTransport,
  type MeshyTransportCall,
  type MeshyTransportResult,
} from "./meshy-task";
import { createMeshyFetchTransport, meshyApiKeyFromEnv } from "./meshy-transport";
import { buildMeshyCreateRequest, meshyTaskNameForJob } from "./payload";
import {
  GENERATION_INPUT_BUCKET,
  MESHY_ASSET_HOST,
  MESHY_TEST_CREDIT_CEILING,
  generationAccessDecision,
  generationEnabledFromEnv,
  meshyPollWaitMs,
} from "./policy";
import { mapMeshyGenerationDraft } from "@/lib/vibode-furniture/generator/request";
import { emptyFurniturePhotoSet, setFurniturePhoto, type FurniturePhotoRecord, type FurnitureViewSlot } from "@/lib/vibode-furniture/generator/images";
import { meshyWebhookTask } from "./webhook";
import {
  advanceFurnitureGeneration,
  authorizeFurnitureGenerationResubmit,
  createFurnitureGeneration,
  createMemoryObjectStore,
  discardFurnitureGeneration,
  expireFurnitureGeneration,
  offerGenerationPreview,
  submitFurnitureGeneration,
} from "./workflow";

const ROOT = process.cwd();
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "018a210d-8ba4-705c-b111-1f1776f7f578";
const ADMIN = "admin@example.com";
const asAdmin = (email: string | null | undefined) => email === ADMIN;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function scripted(steps: MeshyTransportResult[]): MeshyTransport & { calls: MeshyTransportCall[] } {
  const calls: MeshyTransportCall[] = [];
  return {
    calls,
    async request(call) {
      calls.push(call);
      const next = steps.shift();
      if (!next) throw new Error(`unexpected Meshy ${call.method} ${call.path}`);
      return next;
    },
  };
}

async function jpeg(width = 48, height = 48): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 120 } },
  }).jpeg({ quality: 80 }).toBuffer());
}

async function png(width = 48, height = 48): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer());
}

function photo(slot: FurnitureViewSlot, bytes: Uint8Array): FurniturePhotoRecord {
  return {
    slot,
    fileName: `${slot}.jpg`,
    mimeType: "image/jpeg",
    byteLength: bytes.byteLength,
    widthPx: 48,
    heightPx: 48,
  };
}

function enabledDb() {
  const db = createGenerationDatabase();
  db.controls.liveEnabled = true;
  return db;
}

async function createJob(input?: {
  jobId?: string;
  userId?: string | null;
  email?: string | null;
  env?: string;
  live?: boolean;
  settings?: FurnitureGeneratorSettings;
  images?: readonly { slot: FurnitureViewSlot; bytes: Uint8Array }[];
  idempotencyKey?: string;
  nowMs?: number;
}) {
  const db = createGenerationDatabase();
  db.controls.liveEnabled = input?.live ?? true;
  const objects = createMemoryObjectStore();
  const front = input?.images ?? [{ slot: "front" as const, bytes: await jpeg() }];
  const created = await createFurnitureGeneration({
    db,
    objects,
    actor: { userId: input && "userId" in input ? input.userId ?? null : USER_A, email: input && "email" in input ? input.email ?? null : ADMIN },
    generationEnabledEnv: input && "env" in input ? input.env : "true",
    isAdmin: asAdmin,
    idempotencyKey: input?.idempotencyKey ?? "idem-key-0001",
    jobId: input?.jobId ?? JOB_A,
    settings: input?.settings ?? defaultFurnitureGeneratorSettings(),
    images: front,
    nowMs: input?.nowMs ?? 1_000,
  });
  return { db, objects, created, front };
}

test("generation stays off unless the admin and both switches agree", () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    assert.equal(generationEnabledFromEnv({}), false);
    assert.equal(generationEnabledFromEnv({ VIBODE_MESHY_GENERATION_ENABLED: "TRUE" }), false);
    assert.equal(generationEnabledFromEnv({ VIBODE_MESHY_GENERATION_ENABLED: "true" }), true);
    assert.equal(generationAccessDecision({
      userId: null,
      email: ADMIN,
      generationEnabledEnv: "true",
      liveEnabled: true,
    }), "unauthorized");
    assert.equal(generationAccessDecision({
      userId: USER_A,
      email: "shopper@example.com",
      generationEnabledEnv: "true",
      liveEnabled: true,
    }), "unauthorized");
    assert.equal(generationAccessDecision({
      userId: USER_A,
      email: ADMIN,
      generationEnabledEnv: "true",
      liveEnabled: false,
    }), "disabled");
    assert.equal(generationAccessDecision({
      userId: USER_A,
      email: ADMIN,
      generationEnabledEnv: "true",
      liveEnabled: true,
    }), "ok");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
  assert.equal(meshyApiKeyFromEnv({}), null);
  assert.equal(meshyApiKeyFromEnv({ MESHY_API_KEY: "   " }), null);
  assert.equal(MESHY_TEST_CREDIT_CEILING, 40);
  assert.equal(estimateMeshy71Credits(defaultFurnitureGeneratorSettings(), "image-to-3d"), 30);
  const mesh = { ...defaultFurnitureGeneratorSettings(), shouldTexture: false };
  assert.equal(estimateMeshy71Credits(mesh, "multi-image-to-3d"), 20);
  const maxed = {
    ...defaultFurnitureGeneratorSettings(),
    geometryResolution: "4k" as const,
    textureResolution: "8k" as const,
  };
  assert.equal(estimateMeshy71Credits(maxed, "image-to-3d"), 40);
  assert.equal(estimateMeshy71Credits(maxed, "multi-image-to-3d"), null);
  assert.equal(meshyPollWaitMs("12"), 12_000);
  assert.equal(meshyPollWaitMs(null), 5_000);
});

test("unauthorized and disabled callers do not create a job", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const stranger = await createJob({ email: "shopper@example.com" });
    assert.equal(stranger.created.ok, false);
    if (!stranger.created.ok) assert.equal(stranger.created.errorClass, "unauthorized");
    assert.equal(stranger.db.jobs.length, 0);
    const signedOut = await createJob({ userId: null });
    assert.equal(signedOut.created.ok, false);
    if (!signedOut.created.ok) assert.equal(signedOut.created.errorClass, "unauthorized");
    const switchedOff = await createJob({ env: undefined, live: true });
    assert.equal(switchedOff.created.ok, false);
    if (!switchedOff.created.ok) assert.equal(switchedOff.created.errorClass, "disabled");
    assert.equal(switchedOff.db.jobs.length, 0);
    const databaseOff = await createJob({ live: false });
    assert.equal(databaseOff.created.ok, false);
    if (!databaseOff.created.ok) assert.equal(databaseOff.created.errorClass, "disabled");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("server image checks ignore client metadata and reject bad files", async () => {
  const good = await inspectFurnitureImage({ slot: "front", bytes: await jpeg(40, 64) });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.image.mimeType, "image/jpeg");
    assert.equal(good.image.widthPx, 40);
    assert.equal(good.image.heightPx, 64);
    assert.equal(good.image.sha256.length, 64);
  }
  const tiny = await inspectFurnitureImage({ slot: "front", bytes: await png(16, 40) });
  assert.equal(tiny.ok, false);
  const labeled = new Uint8Array([0, 1, 2, 3, 4]);
  const fake = await inspectFurnitureImage({ slot: "left", bytes: labeled });
  assert.equal(fake.ok, false);
  if (!fake.ok) assert.match(fake.message, /JPEG, PNG, or WebP/);
  const oversized = await inspectFurnitureImage({
    slot: "front",
    bytes: new Uint8Array(20 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.match(oversized.message, /20 MB/);
  assert.equal(furnitureImageDimensionIssue({ widthPx: 32, heightPx: 32 }), null);
  assert.equal(GENERATION_INPUT_BUCKET, "vibode-furniture-generation-inputs");
});

test("single and multi-image requests map to the documented Meshy bodies", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const front = await jpeg();
    const side = await png();
    const single = await createJob({ images: [{ slot: "front", bytes: front }] });
    assert.equal(single.created.ok, true);
    if (!single.created.ok) return;
    const singleDraft = mapMeshyGenerationDraft({
      photos: setFurniturePhoto(emptyFurniturePhotoSet(), photo("front", front)),
      settings: defaultFurnitureGeneratorSettings(),
    });
    assert.equal(singleDraft.ok, true);
    if (!singleDraft.ok) return;
    const inspectedFront = await inspectFurnitureImage({ slot: "front", bytes: front });
    assert.equal(inspectedFront.ok, true);
    if (!inspectedFront.ok) return;
    const singleBody = buildMeshyCreateRequest({
      draft: singleDraft.draft,
      images: [inspectedFront.image],
      taskName: meshyTaskNameForJob(JOB_A) ?? "",
    });
    assert.equal(singleBody.ok, true);
    if (!singleBody.ok) return;
    assert.equal(singleBody.request.path, "/v1/image-to-3d");
    assert.equal(singleBody.request.body.image_urls, undefined);
    assert.match(String(singleBody.request.body.image_url), /^data:image\/jpeg;base64,/);
    assert.equal(singleBody.request.body.name, `vibode-${JOB_A}`);
    assert.deepEqual(singleBody.request.body.target_formats, ["glb"]);
    assert.equal(singleBody.request.body.ai_model, "meshy-7.1");
    assert.equal("remove_lighting" in singleBody.request.body, false);
    assert.equal("pose_mode" in singleBody.request.body, false);
    assert.equal("ultra_mode" in singleBody.request.body, false);

    const multiSettings = defaultFurnitureGeneratorSettings();
    const multi = await createJob({
      jobId: JOB_B,
      idempotencyKey: "idem-key-0002",
      images: [
        { slot: "back", bytes: side },
        { slot: "front", bytes: front },
      ],
      settings: multiSettings,
    });
    assert.equal(multi.created.ok, true);
    if (!multi.created.ok) return;
    assert.equal(multi.created.job.operation, "multi-image-to-3d");
    assert.deepEqual(multi.created.job.imageSlots, ["front", "back"]);
    const ultra = {
      ...defaultFurnitureGeneratorSettings(),
      geometryResolution: "4k" as const,
    };
    const rejected = await createJob({
      jobId: JOB_B,
      idempotencyKey: "idem-key-0003",
      images: [
        { slot: "front", bytes: front },
        { slot: "left", bytes: side },
      ],
      settings: ultra,
    });
    assert.equal(rejected.created.ok, false);
    if (!rejected.created.ok) assert.equal(rejected.created.errorClass, "unsupported_settings");
    assert.equal(rejected.db.jobs.length, 0);
    const n1 = {
      ...defaultFurnitureGeneratorSettings(),
      textureModel: "meshy-n1" as const,
      enablePbr: true,
    };
    const n1Rejected = await createJob({
      settings: n1,
      idempotencyKey: "idem-key-0004",
      jobId: JOB_B,
    });
    assert.equal(n1Rejected.created.ok, false);
    if (!n1Rejected.created.ok) assert.equal(n1Rejected.created.errorClass, "unsupported_settings");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("provider errors are normalized and a timeout is not submitted twice", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const rejectedHttp = normalizeMeshyHttpFailure({
      status: 400,
      method: "POST",
      body: { message: "bad data:image/jpeg;base64,aaaa msy_secret https://assets.meshy.ai/private" },
    });
    assert.equal(rejectedHttp.errorClass, "provider_rejected");
    assert.equal(rejectedHttp.ambiguous, false);
    assert.doesNotMatch(rejectedHttp.message, /base64|msy_secret|assets\.meshy\.ai/);
    assert.equal(normalizeMeshyHttpFailure({ status: 402, method: "POST", body: {} }).errorClass, "provider_payment");
    assert.equal(normalizeMeshyHttpFailure({ status: 401, method: "POST", body: {} }).errorClass, "provider_auth");
    assert.equal(normalizeMeshyHttpFailure({ status: 403, method: "POST", body: {} }).errorClass, "provider_forbidden");
    assert.equal(normalizeMeshyHttpFailure({ status: 429, method: "POST", body: {} }).errorClass, "rate_limited");
    assert.equal(normalizeMeshyHttpFailure({ status: 503, method: "POST", body: {} }).ambiguous, true);
    assert.equal(normalizeMeshyHttpFailure({ status: 503, method: "GET", body: {} }).ambiguous, false);

    const failedTask = parseMeshyTask({
      id: TASK_ID,
      status: "FAILED",
      progress: 0,
      consumed_credits: 0,
      task_error: { type: "invalid_input", code: "image_too_complex", message: "too complex" },
    });
    assert.ok(failedTask);
    assert.equal(failedTask?.consumedCredits, 0);
    assert.equal(failedTask?.taskError?.code, "image_too_complex");

    const { db, objects, created } = await createJob();
    assert.equal(created.ok, true);
    const transport = scripted([{ kind: "timeout" }]);
    const adapter = createMeshyAdapter(transport);
    const first = await submitFurnitureGeneration({
      db,
      objects,
      adapter,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 2_000,
    });
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.errorClass, "ambiguous_timeout");
    assert.equal(db.controls.creditsReserved, 30);
    assert.equal(transport.calls.filter((call) => call.method === "POST").length, 1);
    const second = await submitFurnitureGeneration({
      db,
      objects,
      adapter,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 3_000,
    });
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.action, "reconcile");
    assert.equal(transport.calls.filter((call) => call.method === "POST").length, 1);

    const listed = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: [{
          id: TASK_ID,
          name: `vibode-${JOB_A}`,
          type: "image-to-3d",
          status: "PENDING",
          progress: 0,
          created_at: 2_000,
          consumed_credits: null,
        }],
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 4_000,
    });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      assert.equal(listed.action, "reconciled");
      assert.equal(listed.job.providerTaskId, TASK_ID);
      assert.equal(listed.job.status, "running");
    }
    assert.equal(transport.calls.filter((call) => call.method === "POST").length, 1);
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("duplicate reservations and quota exhaustion do not double-charge", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const first = await createJob();
    assert.equal(first.created.ok, true);
    const replay = await createFurnitureGeneration({
      db: first.db,
      objects: first.objects,
      actor: { userId: USER_A, email: ADMIN },
      generationEnabledEnv: "true",
      isAdmin: asAdmin,
      idempotencyKey: "idem-key-0001",
      jobId: JOB_B,
      settings: defaultFurnitureGeneratorSettings(),
      images: first.front,
      nowMs: 1_500,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.created, false);
    assert.equal(first.db.jobs.length, 1);
    assert.equal(first.db.controls.creditsReserved, 30);

    const changed = await jpeg(64, 64);
    const conflict = await createFurnitureGeneration({
      db: first.db,
      objects: first.objects,
      actor: { userId: USER_A, email: ADMIN },
      generationEnabledEnv: "true",
      isAdmin: asAdmin,
      idempotencyKey: "idem-key-0001",
      jobId: JOB_B,
      settings: defaultFurnitureGeneratorSettings(),
      images: [{ slot: "front", bytes: changed }],
      nowMs: 1_600,
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.errorClass, "idempotency_conflict");

    const other = await createFurnitureGeneration({
      db: first.db,
      objects: first.objects,
      actor: { userId: USER_B, email: ADMIN },
      generationEnabledEnv: "true",
      isAdmin: asAdmin,
      idempotencyKey: "idem-key-0002",
      jobId: JOB_B,
      settings: defaultFurnitureGeneratorSettings(),
      images: first.front,
      nowMs: 1_700,
    });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.errorClass, "concurrency_limited");

    const quiet = enabledDb();
    quiet.controls.creditsConsumed = 21;
    const objects = createMemoryObjectStore();
    const exhausted = await createFurnitureGeneration({
      db: quiet,
      objects,
      actor: { userId: USER_A, email: ADMIN },
      generationEnabledEnv: "true",
      isAdmin: asAdmin,
      idempotencyKey: "idem-key-0008",
      jobId: JOB_A,
      settings: { ...defaultFurnitureGeneratorSettings(), shouldTexture: false },
      images: first.front,
      nowMs: 1_800,
    });
    assert.equal(exhausted.ok, false);
    if (!exhausted.ok) assert.equal(exhausted.errorClass, "quota_exhausted");
    assert.equal(quiet.jobs.length, 0);
    assert.equal(quiet.controls.creditsReserved, 0);
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("task progress, failure, and a missing credit report stay server-owned", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const { db, objects, created } = await createJob();
    assert.equal(created.ok, true);
    const createdTransport = scripted([{
      kind: "response",
      status: 202,
      headers: {},
      unparsed: false,
      body: { result: TASK_ID },
    }]);
    const submitted = await submitFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(createdTransport),
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 5_000,
    });
    assert.equal(submitted.ok, true);
    if (submitted.ok) assert.equal(submitted.action, "submitted");
    const again = await submitFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([])),
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 6_000,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.action, "poll");

    const running = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: { "retry-after": "5" },
        unparsed: false,
        body: {
          id: TASK_ID,
          name: `vibode-${JOB_A}`,
          status: "IN_PROGRESS",
          progress: 45,
          consumed_credits: null,
        },
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 7_000,
    });
    assert.equal(running.ok, true);
    if (running.ok) {
      assert.equal(running.action, "running");
      assert.equal(running.job.progress, 45);
      assert.equal(running.job.providerStatus, "IN_PROGRESS");
    }

    const unreported = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: { id: TASK_ID, status: "SUCCEEDED", progress: 100, model_urls: { glb: glbUrl(90_000) } },
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 8_000,
    });
    assert.equal(unreported.ok, false);
    if (!unreported.ok) assert.equal(unreported.errorClass, "credit_unreported");
    assert.equal(db.jobs[0]?.status, "needs_review");
    assert.equal(db.jobs[0]?.consumedCredits, null);
    assert.equal(db.controls.creditsReserved > 0, true);
    assert.equal(db.jobs[0]?.savedAssetId, null);

    const failed = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: {
          id: TASK_ID,
          status: "FAILED",
          progress: 0,
          consumed_credits: 0,
          task_error: { type: "server_error", message: "An internal error occurred." },
        },
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 9_000,
    });
    assert.equal(failed.ok, true);
    if (failed.ok) assert.equal(failed.action, "failed");
    assert.equal(db.jobs[0]?.errorClass, "provider_failed");
    assert.equal(db.jobs[0]?.quotaState, "released");
    assert.equal(db.controls.creditsReserved, 0);
    assert.equal(db.controls.creditsConsumed, 0);
    assert.notEqual(db.jobs[0]?.savedAssetId, "client-declared");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("temporary output is private, size-limited, and not a saved asset", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const { db, objects } = await createJob();
    await submitFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 202,
        headers: {},
        unparsed: false,
        body: { result: TASK_ID },
      }])),
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 10_000,
    });
    const glb = encodeUntexturedFurnitureProbeGlb();
    const accepted = await validatePersonalFurnitureGlb({
      bytes: glb,
      assetId: "vibode-furniture/generation/probe",
    });
    assert.equal(accepted.accepted, true);
    const ready = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: {
          id: TASK_ID,
          status: "SUCCEEDED",
          progress: 100,
          consumed_credits: 30,
          expires_at: 80_000,
          model_urls: { glb: glbUrl(80_000) },
        },
      }])),
      download: async () => ({ kind: "ok", status: 200, body: glb, contentLength: glb.byteLength }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 20_000,
    });
    assert.equal(ready.ok, true);
    if (ready.ok) {
      assert.equal(ready.action, "ready");
      assert.equal(ready.job.savedAssetId, null);
      assert.equal(ready.job.outputBucket, "vibode-furniture-assets");
      assert.equal(ready.job.quotaState, "reconciled");
    }
    assert.equal(db.controls.creditsConsumed, 30);
    assert.equal(db.controls.creditsReserved, 0);
    const offer = offerGenerationPreview({ db, objects, actorUserId: USER_A, jobId: JOB_A });
    assert.equal(offer.ok, true);
    if (offer.ok) {
      assert.equal(offer.savedAssetId, null);
      assert.match(offer.url, /^signed:\/\/vibode-private\/users\/11111111-/);
    }
    const stranger = offerGenerationPreview({ db, objects, actorUserId: USER_B, jobId: JOB_A });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.code, "not_found");
    const outputPath = db.jobs[0]?.outputObjectPath ?? "";
    assert.equal(objects.sign(outputPath, USER_B), null);
    assert.equal(await objects.get(outputPath) instanceof Uint8Array, true);

    const badHost = meshyAssetUrlDecision({
      url: "https://evil.example/tasks/model.glb",
      nowMs: 1,
      expiresAtMs: 10_000,
    });
    assert.equal(badHost, "host");
    assert.equal(meshyAssetUrlDecision({
      url: glbUrl(1_000),
      nowMs: 2_000,
      expiresAtMs: 5_000,
    }), "expired");
    const hostile = await advanceOnFresh({
      body: {
        id: TASK_ID,
        status: "SUCCEEDED",
        progress: 100,
        consumed_credits: 30,
        expires_at: 90_000,
        model_urls: { glb: "https://user:pass@assets.meshy.ai/tasks/abc/model.glb?Expires=90" },
      },
      download: async () => ({ kind: "ok", status: 200, body: glb, contentLength: glb.byteLength }),
    });
    assert.equal(hostile.ok, false);
    if (!hostile.ok) assert.equal(hostile.errorClass, "invalid_output");

    const oversized = await advanceOnFresh({
      body: {
        id: TASK_ID,
        status: "SUCCEEDED",
        progress: 100,
        consumed_credits: 30,
        expires_at: 90_000,
        model_urls: { glb: glbUrl(90_000) },
      },
      download: async () => ({ kind: "too_large" }),
    });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.equal(oversized.errorClass, "oversized_output");
    assert.ok(PERSONAL_FURNITURE_GLB_MAX_BYTES === 25 * 1024 * 1024);

    const invalid = await advanceOnFresh({
      body: {
        id: TASK_ID,
        status: "SUCCEEDED",
        progress: 100,
        consumed_credits: 30,
        expires_at: 90_000,
        model_urls: { glb: glbUrl(90_000) },
      },
      download: async () => ({
        kind: "ok",
        status: 200,
        body: new Uint8Array([1, 2, 3, 4]),
        contentLength: 4,
      }),
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.errorClass, "invalid_output");
    assert.equal(previewLoadPlan({
      kind: "candidate",
      label: "Generated",
      url: "https://assets.meshy.ai/model.glb",
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }).action, "refuse");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("an ambiguous create is reconciled read-only and does not post again", async () => {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN;
  try {
    const { db, objects, created } = await createJob();
    assert.equal(created.ok, true);
    const posts: MeshyTransportResult[] = [{ kind: "timeout" }, {
      kind: "response",
      status: 202,
      headers: {},
      unparsed: false,
      body: { result: TASK_ID },
    }];
    const transport = scripted(posts);
    const adapter = createMeshyAdapter(transport);
    await submitFurnitureGeneration({
      db, objects, adapter, actorUserId: USER_A, jobId: JOB_A, nowMs: 1_000,
    });
    const early = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: [],
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 30_000,
    });
    assert.equal(early.ok, true);
    if (early.ok) assert.equal(early.action, "waiting");
    assert.equal(db.jobs[0]?.status, "ambiguous");
    const incomplete = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: Array.from({ length: 50 }, () => ({ id: "not-our-task-id", status: "PENDING", progress: 0 })),
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 70_000,
    });
    assert.equal(incomplete.ok, true);
    if (incomplete.ok) assert.equal(incomplete.action, "waiting");
    assert.equal(db.jobs[0]?.status, "ambiguous");
    const review = await advanceFurnitureGeneration({
      db,
      objects,
      adapter: createMeshyAdapter(scripted([{
        kind: "response",
        status: 200,
        headers: {},
        unparsed: false,
        body: [],
      }])),
      download: async () => ({ kind: "network" }),
      validate: validatePersonalFurnitureGlb,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 70_000,
    });
    assert.equal(review.ok, true);
    if (review.ok) assert.equal(review.action, "needs_review");
    assert.equal(db.jobs[0]?.status, "needs_review");
    assert.equal(db.controls.creditsReserved, 30);
    const blocked = await submitFurnitureGeneration({
      db, objects, adapter, actorUserId: USER_A, jobId: JOB_A, nowMs: 80_000,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.errorClass, "not_claimable");
    assert.equal(transport.calls.filter((call) => call.method === "POST").length, 1);
    const refused = authorizeFurnitureGenerationResubmit({
      db,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 81_000,
      duplicateChargeRiskAccepted: false,
    });
    assert.equal(refused.ok, false);
    const stranger = authorizeFurnitureGenerationResubmit({
      db,
      actorUserId: USER_B,
      jobId: JOB_A,
      nowMs: 81_000,
      duplicateChargeRiskAccepted: true,
    });
    assert.equal(stranger.ok, false);
    const authorized = authorizeFurnitureGenerationResubmit({
      db,
      actorUserId: USER_A,
      jobId: JOB_A,
      nowMs: 82_000,
      duplicateChargeRiskAccepted: true,
    });
    assert.equal(authorized.ok, true);
    const retried = await submitFurnitureGeneration({
      db, objects, adapter, actorUserId: USER_A, jobId: JOB_A, nowMs: 83_000,
    });
    assert.equal(retried.ok, true);
    if (retried.ok) assert.equal(retried.action, "submitted");
    assert.equal(transport.calls.filter((call) => call.method === "POST").length, 2);
    assert.equal(matchListedMeshyTask({
      tasks: [],
      taskName: `vibode-${JOB_A}`,
      contactedAtMs: 1_000,
      pageFull: true,
    }).kind, "incomplete");
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("a crashed submit lease cannot be posted by a second worker", async () => {
  const { db, objects, created } = await createJob({ nowMs: 1_000 });
  assert.equal(created.ok, true);
  const first = claimGeneration(db, { userId: USER_A, jobId: JOB_A, nowMs: 1_000, intent: "submit" });
  assert.equal(first.ok, true);
  const transport = scripted([{
    kind: "response",
    status: 202,
    headers: {},
    unparsed: false,
    body: { result: TASK_ID },
  }]);
  const adapter = createMeshyAdapter(transport);
  const overlapping = await submitFurnitureGeneration({
    db, objects, adapter, actorUserId: USER_A, jobId: JOB_A, nowMs: 1_500,
  });
  assert.equal(overlapping.ok, false);
  if (!overlapping.ok) assert.equal(overlapping.errorClass, "lease_held");
  assert.equal(transport.calls.length, 0);
  const afterCrash = await submitFurnitureGeneration({
    db, objects, adapter, actorUserId: USER_A, jobId: JOB_A, nowMs: 1_000 + 120_000 + 1,
  });
  assert.equal(afterCrash.ok, true);
  if (afterCrash.ok) assert.equal(afterCrash.action, "reconcile");
  assert.equal(db.jobs[0]?.status, "ambiguous");
  assert.equal(transport.calls.length, 0);
});

test("discard and expiry free the generation slot without refunding a completed charge", async () => {
  const { db, objects, front } = await createJob({ nowMs: 1_000 });
  const reserved = db.jobs[0];
  assert.ok(reserved);
  reserved.outputExpiresAtMs = 5_000;
  reserved.status = "ready";
  reserved.outputObjectPath = `users/${USER_A}/generations/${JOB_A}/candidate.glb`;
  reserved.outputBucket = "vibode-furniture-assets";
  reserved.quotaState = "reconciled";
  reserved.consumedCredits = 30;
  db.controls.creditsReserved = 0;
  db.controls.creditsConsumed = 30;
  const stranger = discardFurnitureGeneration({ db, actorUserId: USER_B, jobId: JOB_A, nowMs: 2_000 });
  assert.equal(stranger.ok, false);
  const tooSoon = expireFurnitureGeneration({ db, actorUserId: USER_A, jobId: JOB_A, nowMs: 2_000 });
  assert.equal(tooSoon.ok, false);
  const discarded = discardFurnitureGeneration({ db, actorUserId: USER_A, jobId: JOB_A, nowMs: 2_000 });
  assert.equal(discarded.ok, true);
  if (discarded.ok) assert.equal(discarded.providerCreditsRefunded, false);
  assert.equal(db.jobs[0]?.status, "discarded");
  assert.equal(db.jobs[0]?.savedAssetId, null);
  assert.equal(db.controls.creditsConsumed, 30);
  const blockedByQuota = await createFurnitureGeneration({
    db,
    objects,
    actor: { userId: USER_A, email: ADMIN },
    generationEnabledEnv: "true",
    isAdmin: asAdmin,
    idempotencyKey: "idem-key-0009",
    jobId: JOB_B,
    settings: { ...defaultFurnitureGeneratorSettings(), shouldTexture: false },
    images: front,
    nowMs: 3_000,
  });
  assert.equal(blockedByQuota.ok, false);
  if (!blockedByQuota.ok) assert.equal(blockedByQuota.errorClass, "quota_exhausted");
  const open = await createJob({ nowMs: 3_000 });
  const beforeContact = discardFurnitureGeneration({ db: open.db, actorUserId: USER_A, jobId: JOB_A, nowMs: 3_100 });
  assert.equal(beforeContact.ok, true);
  if (beforeContact.ok) assert.equal(beforeContact.job.status, "cancelled");
  assert.equal(open.db.controls.creditsReserved, 0);

  const held = await createJob({ nowMs: 4_000 });
  const candidate = held.db.jobs[0];
  assert.ok(candidate);
  candidate.status = "ready";
  candidate.outputExpiresAtMs = 4_500;
  candidate.outputObjectPath = `users/${USER_A}/generations/${JOB_A}/candidate.glb`;
  candidate.quotaState = "reconciled";
  candidate.consumedCredits = 30;
  held.db.controls.creditsReserved = 0;
  held.db.controls.creditsConsumed = 30;
  const expired = expireFurnitureGeneration({ db: held.db, actorUserId: USER_A, jobId: JOB_A, nowMs: 4_500 });
  assert.equal(expired.ok, true);
  if (expired.ok) assert.equal(expired.providerCreditsRefunded, false);
  assert.equal(held.db.controls.creditsConsumed, 30);
  const afterExpiry = await createFurnitureGeneration({
    db: held.db,
    objects,
    actor: { userId: USER_A, email: ADMIN },
    generationEnabledEnv: "true",
    isAdmin: asAdmin,
    idempotencyKey: "idem-key-0010",
    jobId: JOB_B,
    settings: { ...defaultFurnitureGeneratorSettings(), shouldTexture: false },
    images: held.front,
    nowMs: 4_600,
  });
  assert.equal(afterExpiry.ok, false);
  if (!afterExpiry.ok) assert.equal(afterExpiry.errorClass, "quota_exhausted");
  assert.equal(held.db.jobs.some((job) => job.status === "ready"), false);
});

test("webhook checks and fetch transport keep secrets out of results", async () => {
  const secret = "webhook-test-secret";
  const task = {
    id: TASK_ID,
    status: "SUCCEEDED",
    progress: 100,
    consumed_credits: 30,
    name: `vibode-${JOB_A}`,
  };
  assert.equal(meshyWebhookTask({
    expectedSecret: secret,
    providedSecret: "nope",
    version: "v1",
    body: task,
  }), null);
  assert.equal(meshyWebhookTask({
    expectedSecret: secret,
    providedSecret: secret,
    version: "v0",
    body: task,
  }), null);
  const accepted = meshyWebhookTask({
    expectedSecret: secret,
    providedSecret: secret,
    version: "v1",
    body: task,
  });
  assert.equal(accepted?.id, TASK_ID);
  assert.equal(accepted && "savedAssetId" in accepted, false);

  const key = "msy_test_fixture_not_live";
  let seenAuth = "";
  const transport = createMeshyFetchTransport({
    apiKey: key,
    fetchImpl: async (_url, init) => {
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ result: TASK_ID }), { status: 202 });
    },
  });
  const outcome = await createMeshyAdapter(transport).createTask({
    operation: "image-to-3d",
    path: "/v1/image-to-3d",
    taskName: `vibode-${JOB_A}`,
    body: { ai_model: "meshy-7.1", image_url: "data:image/jpeg;base64,aaaa" },
  });
  assert.equal(outcome.kind, "created");
  assert.equal(seenAuth, `Bearer ${key}`);
  assert.equal(JSON.stringify(outcome).includes(key), false);
  assert.equal(JSON.stringify(outcome).includes("base64"), false);
  assert.throws(() => createMeshyFetchTransport({ apiKey: " ", fetchImpl: fetch }), /meshy_transport_unconfigured/);
});

test("the foundation does not enable Generate or write the personal library", () => {
  assert.equal(existsSync(path.join(ROOT, "app/api/vibode/furniture-generation")), false);
  const panel = source("components/stage/FurnitureGeneratorPanel.tsx");
  assert.match(panel, /data-generate="unavailable"/);
  assert.match(panel, /disabled/);
  const migration = source("supabase/migrations/20261106234500_vibode_furniture_generation.sql");
  const furniture = source("supabase/migrations/20261105180000_vibode_furniture_assets.sql");
  assert.match(furniture, /origin = 'uploaded'/);
  assert.doesNotMatch(migration, /insert into public\.vibode_furniture_assets|create table public\.vibode_furniture_assets/);
  assert.match(migration, /grant execute on function public\.reserve_vibode_furniture_generation/);
  assert.match(migration, /live_enabled boolean not null default false/);
  assert.match(migration, /credit_ceiling integer not null default 40/);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete|all) on table public\.vibode_furniture_generation_(jobs|controls|inputs)/);
  const gateway = source("lib/vibode-furniture/generation/gateway.server.ts");
  assert.match(gateway, /reserve_vibode_furniture_generation/);
  assert.match(gateway, /read_vibode_furniture_generation/);
  assert.match(migration, /function public\.reserve_vibode_furniture_generation/);
  assert.match(migration, /function public\.read_vibode_furniture_generation/);
  const adapter = source("lib/vibode-furniture/generation/meshy-adapter.ts");
  assert.doesNotMatch(adapter, /MESHY_API_KEY|msy_/);
  const workflow = source("lib/vibode-furniture/generation/workflow.ts");
  assert.doesNotMatch(workflow, /MESHY_API_KEY|api\.meshy\.ai/);
  assert.doesNotMatch(`${workflow}\n${migration}`, /vibode_furniture_assets\)/);
  assert.equal(MESHY_ASSET_HOST, "assets.meshy.ai");
});

function glbUrl(expiresAtMs: number): string {
  return `https://${MESHY_ASSET_HOST}/tasks/${TASK_ID}/output/model.glb?Expires=${Math.floor(expiresAtMs / 1000)}`;
}

async function advanceOnFresh(input: {
  body: unknown;
  download: NonNullable<Parameters<typeof advanceFurnitureGeneration>[0]["download"]>;
}) {
  const { db, objects } = await createJob({ idempotencyKey: `idem-key-${Math.random().toString(16).slice(2, 10)}` });
  await submitFurnitureGeneration({
    db,
    objects,
    adapter: createMeshyAdapter(scripted([{
      kind: "response",
      status: 202,
      headers: {},
      unparsed: false,
      body: { result: TASK_ID },
    }])),
    actorUserId: USER_A,
    jobId: JOB_A,
    nowMs: 10_000,
  });
  return advanceFurnitureGeneration({
    db,
    objects,
    adapter: createMeshyAdapter(scripted([{
      kind: "response",
      status: 200,
      headers: {},
      unparsed: false,
      body: input.body,
    }])),
    download: input.download,
    validate: validatePersonalFurnitureGlb,
    actorUserId: USER_A,
    jobId: JOB_A,
    nowMs: 20_000,
  });
}
