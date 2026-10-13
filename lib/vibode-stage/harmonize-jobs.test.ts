import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { readHarmonizeWorkerProcessEnv } from "@/harmonize-worker/src/http-api";
import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import { classifyNanoBananaProAspectRatio } from "@/lib/afc-image-models";
import {
  HARMONIZE_ASPECT_RELATIVE_TOLERANCE,
  decideHarmonizeExportFrame,
  harmonizeExportObject,
  harmonizeSceneCanonical,
  sha256HexBytes,
  sortHarmonizeObjects,
  type HarmonizeExportCamera,
} from "@/lib/vibode-stage/harmonize-export";
import {
  resolveHarmonizeMaterials,
  type HarmonizeMaterialCatalog,
} from "@/lib/vibode-stage/harmonize-materials";
import { HARMONIZE_NBP_OUTPUT_MAX_EDGE, HarmonizeNbpProofError } from "@/lib/vibode-stage/harmonize-nbp-proof";
import { assembleHarmonizePrompt } from "@/lib/vibode-stage/harmonize-prompt";
import { effectiveMetricScale } from "@/lib/vibode-stage/room-scale";

import {
  claimNextHarmonizeJob,
  completeHarmonizeJob,
  createHarmonizeJobDatabase,
  enqueueHarmonizeJob,
  failHarmonizeJob,
  heartbeatHarmonizeJob,
  markHarmonizeProviderContact,
  type HarmonizeJobDatabase,
} from "./harmonize-jobs/engine";
import { executeHarmonizeClaim } from "./harmonize-jobs/execute";
import { createHarmonizeFakeJpeg, HARMONIZE_FAKE_JPEG_COMMENT } from "./harmonize-jobs/fake-jpeg";
import { createMemoryHarmonizeWorkerApi } from "./harmonize-jobs/memory-api";
import { assessHarmonizeJobOutput } from "./harmonize-jobs/output";
import { planHarmonizeEnqueue } from "./harmonize-jobs/plan";
import { harmonizeProviderAcceptsComposite } from "./harmonize-jobs/provider-capability";
import {
  HARMONIZE_COMPOSITE_MAX_BYTES,
  HARMONIZE_COMPOSITE_MAX_EDGE,
  HARMONIZE_JOB_CLAIM_LEASE_MS,
  HARMONIZE_PRECONTACT_BACKOFF_MS,
} from "./harmonize-jobs/policy";
import {
  createHarmonizeFakeProvider,
  readHarmonizeWorkerProviderMode,
  type HarmonizeProvider,
} from "./harmonize-jobs/provider";
import { redactHarmonizeDiagnostic } from "./harmonize-jobs/redaction";
import { harmonizeStatusFromRecord } from "./harmonize-jobs/status";
import type { HarmonizeJobInsert, HarmonizeTrustedRoom } from "./harmonize-jobs/types";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "66666666-6666-4666-8666-666666666666";
const ROOM = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const GENERATION = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";

const CAMERA: HarmonizeExportCamera = {
  projection: "frozen-production-perspective",
  verticalFovDeg: 50,
  aspect: 1200 / 900,
  near: AFC_V2_RUNTIME_CAMERA_NEAR,
  far: AFC_V2_RUNTIME_CAMERA_FAR,
  frame: { width: 1200, height: 900 },
  pose: {
    position: { x: 0, y: 1.4, z: 4 },
    lookAt: { x: 0, y: 0.4, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  },
};

test("authorization rejects signed-out, non-admin, and disabled callers before any read", async () => {
  let reads = 0;
  const loadTrusted = async () => {
    reads += 1;
    return { ok: false as const, code: "not_found" as const };
  };
  await withAdmin(async () => {
    const disabled = await planHarmonizeEnqueue({
      actor: { userId: USER, email: "admin@example.com" },
      submission: {},
      composite: png(1200, 896),
      loadTrusted,
      mode: "off",
    });
    assert.equal(disabled.ok, false);
    if (!disabled.ok) assert.equal(disabled.code, "disabled");
    const stranger = await planHarmonizeEnqueue({
      actor: { userId: OTHER, email: "person@example.com" },
      submission: {},
      composite: png(1200, 896),
      loadTrusted,
      mode: "admin",
    });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.code, "forbidden");
    const signedOut = await planHarmonizeEnqueue({
      actor: { userId: null, email: null },
      submission: {},
      composite: png(1200, 896),
      loadTrusted,
      mode: "admin",
    });
    assert.equal(signedOut.ok, false);
    if (!signedOut.ok) assert.equal(signedOut.code, "unauthenticated");
  });
  assert.equal(reads, 0);
});

test("cross-room and cross-user captures are rejected", async () => {
  const fixture = await matchingFixture();
  await withAdmin(async () => {
    const otherRoom = await planHarmonizeEnqueue({
      actor: admin(),
      submission: fixture.submission,
      composite: fixture.composite,
      loadTrusted: async () => ({ ok: true, room: { ...fixture.room, sourceRoomId: OTHER } }),
      mode: "admin",
    });
    assert.equal(otherRoom.ok, false);
    if (!otherRoom.ok) assert.equal(otherRoom.code, "source_version_not_found");
    const otherUser = await planHarmonizeEnqueue({
      actor: admin(),
      submission: fixture.submission,
      composite: fixture.composite,
      loadTrusted: async () => ({ ok: true, room: { ...fixture.room, userId: OTHER } }),
      mode: "admin",
    });
    assert.equal(otherUser.ok, false);
    if (!otherUser.ok) assert.equal(otherUser.code, "not_found");
  });
});

test("enqueue is idempotent, blocks a second active job, and does not call a provider", async () => {
  const fixture = await matchingFixture();
  const db = createHarmonizeJobDatabase();
  let providerCalls = 0;
  const provider = () => {
    providerCalls += 1;
    throw new Error("provider");
  };
  await withAdmin(async () => {
    const planned = await planHarmonizeEnqueue({
      actor: admin(),
      submission: fixture.submission,
      composite: fixture.composite,
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    const first = enqueueHarmonizeJob(db, planned.insert, 0);
    const replay = enqueueHarmonizeJob(db, planned.insert, 0);
    const second = enqueueHarmonizeJob(db, {
      ...planned.insert,
      idempotencyKey: key(2),
    }, 0);
    const conflict = enqueueHarmonizeJob(db, {
      ...planned.insert,
      requestSha256: "ab".repeat(32),
    }, 0);
    assert.equal(first.ok && first.created, true);
    assert.equal(replay.ok && replay.created, false);
    if (first.ok && replay.ok) assert.equal(replay.job.id, first.job.id);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "active_job");
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.code, "idempotency_conflict");
    assert.equal(db.jobs.length, 1);
    assert.equal(db.jobs[0]?.status, "queued");
    assert.equal(db.jobs[0]?.providerStartedAtMs, null);
    assert.equal(fixture.room.scene.objects[0]?.transform.position.x, 0);
  });
  assert.equal(providerCalls, 0);
  void provider;
});

test("ten provider-started jobs block another enqueue, including rejected attempts", async () => {
  const fixture = await matchingFixture();
  const db = createHarmonizeJobDatabase();
  await withAdmin(async () => {
    const planned = await planHarmonizeEnqueue({
      actor: admin(),
      submission: fixture.submission,
      composite: fixture.composite,
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    for (let index = 0; index < 10; index += 1) {
      const enqueued = enqueueHarmonizeJob(db, { ...planned.insert, idempotencyKey: key(index) }, index);
      assert.equal(enqueued.ok, true);
      if (!enqueued.ok) return;
      const claimed = claimNextHarmonizeJob(db, index);
      assert.ok(claimed);
      const contact = markHarmonizeProviderContact(db, {
        jobId: claimed.jobId,
        claimNonce: claimed.claimNonce,
        nowMs: index,
      });
      assert.equal(contact.ok, true);
      const failed = failHarmonizeJob(db, {
        jobId: claimed.jobId,
        claimNonce: claimed.claimNonce,
        nowMs: index,
        code: "provider_rejected",
        message: "rejected",
        retryable: true,
      });
      assert.equal(failed.ok && failed.disposition, "failed");
    }
    const blocked = enqueueHarmonizeJob(db, { ...planned.insert, idempotencyKey: key(11) }, 20);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "daily_limit");
  });
});

test("oversized and off-grid composites are refused", async () => {
  const fixture = await matchingFixture();
  await withAdmin(async () => {
    const tooBig = await planHarmonizeEnqueue({
      actor: admin(),
      submission: fixture.submission,
      composite: new Uint8Array(HARMONIZE_COMPOSITE_MAX_BYTES + 1),
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(tooBig.ok, false);
    if (!tooBig.ok) assert.equal(tooBig.code, "composite_too_large");
    const wide = await planHarmonizeEnqueue({
      actor: admin(),
      submission: { ...fixture.submission, compositeSha256: "11".repeat(32) },
      composite: png(5000, 3750),
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(wide.ok, false);
    if (!wide.ok) assert.equal(wide.code, "unsupported_dimensions");
    const offGrid = png(1800, 1600);
    const refused = await planHarmonizeEnqueue({
      actor: admin(),
      submission: { ...fixture.submission, compositeSha256: await sha256HexBytes(offGrid) },
      composite: offGrid,
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "unsupported_aspect");
  });
});

test("a geometry-compatible frame outside the ratio family still uses the composite ratio", async () => {
  const frame = { width: 911, height: 670 };
  const compositeSize = { width: 951, height: 700 };
  const frameClass = classifyNanoBananaProAspectRatio(frame.width, frame.height);
  const compositeClass = classifyNanoBananaProAspectRatio(compositeSize.width, compositeSize.height);
  assert.equal(frameClass.ok, false);
  assert.equal(compositeClass.ok && compositeClass.ratio, "4:3");
  const frameAspect = frame.width / frame.height;
  const compositeAspect = compositeSize.width / compositeSize.height;
  const geometryError = Math.abs(compositeAspect - frameAspect) / frameAspect;
  assert.ok(geometryError <= HARMONIZE_ASPECT_RELATIVE_TOLERANCE);
  const alignment = decideHarmonizeExportFrame({
    imageWidth: compositeSize.width,
    imageHeight: compositeSize.height,
    frameWidth: frame.width,
    frameHeight: frame.height,
    authorityFrameWidth: frame.width,
    authorityFrameHeight: frame.height,
  });
  assert.equal(alignment.ok, true);
  const fixture = await matchingFixture(null, {
    frameWidth: frame.width,
    frameHeight: frame.height,
    compositeWidth: compositeSize.width,
    compositeHeight: compositeSize.height,
  });
  const planned = await withAdmin(() => accept(fixture, fixture.room));
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.insert.compositeWidth, compositeSize.width);
  assert.equal(planned.insert.compositeHeight, compositeSize.height);
});

test("1264x848 is accepted when the certified frame is the same 3:2 family", async () => {
  const fixture = await matchingFixture(null, {
    frameWidth: 1264,
    frameHeight: 848,
    compositeWidth: 1264,
    compositeHeight: 848,
  });
  const planned = await withAdmin(() => accept(fixture, fixture.room));
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.insert.compositeWidth, 1264);
  assert.equal(planned.insert.compositeHeight, 848);
});

test("scene, generation, background, and catalog changes are stale", async () => {
  const fixture = await matchingFixture();
  await withAdmin(async () => {
    const moved: HarmonizeTrustedRoom = {
      ...fixture.room,
      scene: {
        ...fixture.room.scene,
        objects: fixture.room.scene.objects.map((object, index) => index === 0 ? {
          ...object,
          transform: {
            ...object.transform,
            position: { ...object.transform.position, x: 2 },
          },
        } : object),
      },
    };
    assert.equal(codeOf(await accept(fixture, moved)), "stale_scene");
    const generation: HarmonizeTrustedRoom = {
      ...fixture.room,
      scene: { ...fixture.room.scene, afcGenerationId: OTHER },
    };
    assert.equal(codeOf(await accept(fixture, generation)), "stale_generation");
    const background = { ...fixture.room, background: new TextEncoder().encode("different-room") };
    assert.equal(codeOf(await accept(fixture, background)), "stale_background");
    const catalog: HarmonizeTrustedRoom = {
      ...fixture.room,
      catalog: {
        ...fixture.room.catalog,
        products: fixture.room.catalog.products.map((product, index) => (
          index === 0 ? { ...product, primaryMaterial: "Blue Velvet" } : product
        )),
      },
    };
    assert.equal(codeOf(await accept(fixture, catalog)), "stale_materials");
    const prompt = {
      ...fixture.submission,
      promptSha256: "ab".repeat(32),
    };
    const stalePrompt = await planHarmonizeEnqueue({
      actor: admin(),
      submission: prompt,
      composite: fixture.composite,
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(stalePrompt.ok, false);
    if (!stalePrompt.ok) assert.equal(stalePrompt.code, "stale_prompt");
  });
});

test("publication backdrop and canonical objects are trusted, then a missing authority does not enqueue", async () => {
  const fixture = await matchingFixture();
  const backgroundSha = String(fixture.submission.backgroundSha256);
  const originalSha = "22".repeat(32);
  const otherSha = "33".repeat(32);
  const planSource = source("lib/vibode-stage/harmonize-jobs/plan.ts");
  const serverSource = source("lib/vibode-stage/harmonize-jobs/jobs.server.ts");
  assert.match(planSource, /harmonizePublicationFields/);
  assert.match(planSource, /sceneObjects: publication\.sceneObjects/);
  assert.doesNotMatch(planSource, /value\.backdropKind|submission\.backdropKind|sceneObjects:\s*objects\.objects/);
  const readyAt = serverSource.indexOf("vibode_harmonize_publication_enqueue_ready");
  const enqueueAt = serverSource.indexOf("enqueue_vibode_harmonize_generation");
  assert.ok(readyAt > 0 && enqueueAt > readyAt);
  await withAdmin(async () => {
    const cases = [
      { emptySha256: backgroundSha, originalSha256: originalSha, kind: "afc_empty" },
      { emptySha256: backgroundSha, originalSha256: backgroundSha, kind: "afc_empty" },
      { emptySha256: otherSha, originalSha256: backgroundSha, kind: "afc_original" },
      { emptySha256: otherSha, originalSha256: originalSha, kind: "room_asset" },
    ] as const;
    for (const item of cases) {
      const planned = await planHarmonizeEnqueue({
        actor: admin(),
        submission: { ...fixture.submission, backdropKind: "afc_empty" },
        composite: fixture.composite,
        loadTrusted: async () => ({
          ok: true,
          room: { ...fixture.room, emptySha256: item.emptySha256, originalSha256: item.originalSha256 },
        }),
        mode: "admin",
      });
      assert.equal(planned.ok, true, item.kind);
      if (!planned.ok) continue;
      assert.equal(planned.insert.backdropKind, item.kind);
      assert.deepEqual(planned.insert.sceneObjects, fixture.room.persistedObjects);
      assert.notEqual(planned.insert.sceneObjects, fixture.room.scene.objects);
    }
    const db = createHarmonizeJobDatabase();
    const missing = await planHarmonizeEnqueue({
      actor: admin(),
      submission: fixture.submission,
      composite: fixture.composite,
      loadTrusted: async () => ({
        ok: true,
        room: { ...fixture.room, emptySha256: null, originalSha256: null },
      }),
      mode: "admin",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "publication_authority_unavailable");
    assert.equal(db.jobs.length, 0);
    const rejected = enqueueHarmonizeJob(db, {
      ...(await acceptOk(fixture)),
      backdropKind: "client-label",
    } as unknown as HarmonizeJobInsert, 0);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "invalid_submission");
    assert.equal(db.jobs.length, 0);
    assert.equal(db.jobs[0]?.providerStartedAtMs ?? null, null);
  });
});

test("materials inherit, override, and intentionally clear", async () => {
  const inherited = await matchingFixture(null);
  const overridden = await matchingFixture("Top-grain leather");
  const cleared = await matchingFixture("");
  await withAdmin(async () => {
    const inherit = await acceptOk(inherited);
    assert.match(inherit.snapshot.prompt, /Chenille Helios/);
    assert.equal(inherit.snapshot.materials[0]?.primaryProvenance, "product");
    const override = await acceptOk(overridden);
    assert.match(override.snapshot.prompt, /Top-grain leather/);
    assert.equal(override.snapshot.materials[0]?.primaryProvenance, "variant");
    const clear = await acceptOk(cleared);
    assert.equal(clear.snapshot.materials[0]?.primaryProvenance, "cleared");
    assert.equal(clear.snapshot.materials[0]?.primaryText, null);
    assert.doesNotMatch(clear.snapshot.prompt, /Chenille Helios/);
  });
});

test("a queued job survives enqueue and one fake provider call finishes it", async () => {
  const { db, job, composite } = await queuedJob();
  assert.equal(job.status, "queued");
  assert.equal(job.providerStartedAtMs, null);
  const clock = { nowMs: 0 };
  const composites = new Map([[job.id, composite]]);
  const outputs = new Map<string, Uint8Array>();
  let calls = 0;
  const result = await executeHarmonizeClaim({
    api: createMemoryHarmonizeWorkerApi({ db, composites, outputs, clock }),
    provider: async () => {
      calls += 1;
      assert.notEqual(db.jobs[0]?.providerStartedAtMs, null);
      return await jpegResult();
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "succeeded");
  assert.equal(db.jobs[0]?.status, "succeeded");
  assert.equal(db.jobs[0]?.outputWidth, 2400);
  assert.equal(db.jobs[0]?.outputHeight, 1792);
  assert.equal(db.jobs[0]?.outputMime, "image/jpeg");
  assert.equal(outputs.size, 1);
  const nonce = db.jobs[0]?.claimNonce ?? "";
  const again = completeHarmonizeJob(db, {
    jobId: job.id,
    claimNonce: nonce,
    nowMs: 1,
    outputSha256: "cd".repeat(32),
    outputMime: "image/jpeg",
    outputWidth: 2400,
    outputHeight: 1792,
    outputPath: "ignored",
    returnedModelId: null,
    providerStatus: null,
    providerHttpStatus: null,
    latencyMs: 1,
  });
  assert.equal(again.ok && again.code, "already_complete");
  assert.notEqual(db.jobs[0]?.outputSha256, "cd".repeat(32));
});

test("a crash before provider contact can run once later, and a crash after cannot", async () => {
  const first = await queuedJob();
  const clock = { nowMs: 0 };
  const composites = new Map<string, Uint8Array>();
  const outputs = new Map<string, Uint8Array>();
  let calls = 0;
  const provider: HarmonizeProvider = async () => {
    calls += 1;
    return await jpegResult();
  };
  const api = createMemoryHarmonizeWorkerApi({ db: first.db, composites, outputs, clock });
  const crashed = await executeHarmonizeClaim({ api, provider, heartbeatIntervalMs: 60_000 });
  assert.equal(crashed.code, "worker_interrupted");
  assert.equal(calls, 0);
  assert.equal(first.db.jobs[0]?.providerStartedAtMs, null);
  clock.nowMs += HARMONIZE_PRECONTACT_BACKOFF_MS;
  composites.set(first.job.id, first.composite);
  const recovered = await executeHarmonizeClaim({ api, provider, heartbeatIntervalMs: 60_000 });
  assert.equal(recovered.outcome, "succeeded");
  assert.equal(calls, 1);

  const second = await queuedJob();
  const later = { nowMs: 0 };
  let paid = 0;
  const failing = createMemoryHarmonizeWorkerApi({
    db: second.db,
    composites: new Map([[second.job.id, second.composite]]),
    outputs,
    clock: later,
  });
  const lost = await executeHarmonizeClaim({
    api: failing,
    provider: async () => {
      paid += 1;
      throw new HarmonizeNbpProofError("timeout", "Nano Banana Pro did not finish before the timeout.", null);
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(lost.code, "provider_uncertain");
  assert.equal(second.db.jobs[0]?.status, "failed");
  const retry = await executeHarmonizeClaim({
    api: failing,
    provider: async () => {
      paid += 1;
      return await jpegResult();
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(retry.outcome, "idle");
  assert.equal(paid, 1);
});

test("provider rejection and lease loss do not pay twice or let a stale worker finish", async () => {
  const rejected = await queuedJob();
  let calls = 0;
  const api = createMemoryHarmonizeWorkerApi({
    db: rejected.db,
    composites: new Map([[rejected.job.id, rejected.composite]]),
    outputs: new Map(),
    clock: { nowMs: 0 },
  });
  const failure = await executeHarmonizeClaim({
    api,
    provider: async () => {
      calls += 1;
      throw new HarmonizeNbpProofError("provider_http", "Nano Banana Pro returned HTTP 400.", 400, {
        providerStatus: "INVALID_ARGUMENT",
      });
    },
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(failure.code, "provider_rejected");
  assert.equal(calls, 1);
  assert.equal((await executeHarmonizeClaim({
    api,
    provider: async () => {
      calls += 1;
      return await jpegResult();
    },
    heartbeatIntervalMs: 60_000,
  })).outcome, "idle");

  const db = createHarmonizeJobDatabase();
  const fixture = await matchingFixture();
  const planned = await withAdmin(() => planHarmonizeEnqueue({
    actor: admin(),
    submission: fixture.submission,
    composite: fixture.composite,
    loadTrusted: async () => ({ ok: true, room: fixture.room }),
    mode: "admin",
  }));
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const enqueued = enqueueHarmonizeJob(db, planned.insert, 0);
  assert.equal(enqueued.ok, true);
  if (!enqueued.ok) return;
  const first = claimNextHarmonizeJob(db, 0);
  assert.ok(first);
  const contact = markHarmonizeProviderContact(db, {
    jobId: first.jobId,
    claimNonce: first.claimNonce,
    nowMs: 0,
  });
  assert.equal(contact.ok, true);
  assert.equal(claimNextHarmonizeJob(db, HARMONIZE_JOB_CLAIM_LEASE_MS), null);
  assert.equal(db.jobs[0]?.status, "failed");
  assert.equal(db.jobs[0]?.failureCode, "provider_uncertain");
  const stale = completeHarmonizeJob(db, {
    jobId: first.jobId,
    claimNonce: first.claimNonce,
    nowMs: HARMONIZE_JOB_CLAIM_LEASE_MS + 1,
    outputSha256: "aa".repeat(32),
    outputMime: "image/jpeg",
    outputWidth: 2400,
    outputHeight: 1792,
    outputPath: "rooms/x",
    returnedModelId: null,
    providerStatus: null,
    providerHttpStatus: 200,
    latencyMs: 1,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "stale_claim");

  const live = createHarmonizeJobDatabase();
  const queued = enqueueHarmonizeJob(live, { ...planned.insert, idempotencyKey: key(4) }, 0);
  assert.equal(queued.ok, true);
  const claimed = claimNextHarmonizeJob(live, 0);
  assert.ok(claimed);
  assert.equal(heartbeatHarmonizeJob(live, {
    jobId: claimed.jobId,
    claimNonce: claimed.claimNonce,
    nowMs: 200_000,
  }), true);
  assert.equal(heartbeatHarmonizeJob(live, {
    jobId: claimed.jobId,
    claimNonce: "not-the-nonce",
    nowMs: 200_000,
  }), false);
  const expired = claimNextHarmonizeJob(live, 200_000 + HARMONIZE_JOB_CLAIM_LEASE_MS);
  assert.ok(expired);
  assert.notEqual(expired.claimNonce, claimed.claimNonce);
  const oldComplete = completeHarmonizeJob(live, {
    jobId: claimed.jobId,
    claimNonce: claimed.claimNonce,
    nowMs: 200_000 + HARMONIZE_JOB_CLAIM_LEASE_MS,
    outputSha256: "bb".repeat(32),
    outputMime: "image/jpeg",
    outputWidth: 2400,
    outputHeight: 1792,
    outputPath: "rooms/old",
    returnedModelId: null,
    providerStatus: null,
    providerHttpStatus: 200,
    latencyMs: 1,
  });
  assert.equal(oldComplete.ok, false);
});

test("status and diagnostics omit prompts, keys, and image bytes", () => {
  const view = harmonizeStatusFromRecord({
    id: GENERATION,
    status: "failed",
    requested_model_id: "gemini-3-pro-image",
    created_at: "2026-10-12T00:00:00.000Z",
    failure_code: "provider_rejected",
    failure_message: "HTTP 400",
    provider_http_status: 400,
    provider_status: "INVALID_ARGUMENT",
    snapshot: { prompt: "UNIQUE_PROMPT_SENTINEL" },
    output_bytes: "not-an-image",
  });
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /UNIQUE_PROMPT_SENTINEL|not-an-image/);
  assert.match(json, /provider_rejected/);
  const redacted = redactHarmonizeDiagnostic(
    "HTTP 400 AIzaSySECRETSECRET before Photorealistic Furniture Harmonization secret prompt",
  );
  assert.doesNotMatch(redacted, /AIza|Photorealistic|secret prompt/);
});

test("migration and routes stay isolated from thumbnails, scenes, and the paid provider", () => {
  const sql = [
    source("supabase/migrations/20261012090000_vibode_harmonize_generations.sql"),
    source("supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql"),
  ].join("\n");
  const server = source("lib/vibode-stage/harmonize-jobs/jobs.server.ts");
  const plan = source("lib/vibode-stage/harmonize-jobs/plan.ts");
  const worker = source("harmonize-worker/src/index.ts");
  const provider = source("lib/vibode-stage/harmonize-jobs/provider.ts");
  const auth = source("lib/vibode-stage/harmonize-jobs/worker-auth.server.ts");
  const internal = source("app/api/internal/vibode-harmonize-jobs/route.ts");
  const enqueue = source("app/api/vibode/harmonize/jobs/route.ts");
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /provider_started_at is null/);
  assert.match(sql, /provider_uncertain/);
  assert.match(sql, /interval '240 seconds'/);
  assert.match(sql, /vibode_harmonize_one_active_user/);
  assert.match(sql, /revoke all on table public\.vibode_harmonize_generations from public, anon, authenticated/);
  assert.match(sql, /vibode-harmonize/);
  assert.match(sql, /harmonize snapshot is immutable/);
  assert.doesNotMatch(sql, /alter table public\.vibode_3d_scenes|alter table public\.vibode_3d_thumbnail|alter table public\.vibode_room_assets|alter table public\.vibode_afc/);
  assert.doesNotMatch(server, /saveOwnedVersionScene|resolveOwnedVersionScene|callHarmonizeNbpProof|generativelanguage|VIBODE_THUMBNAIL_WORKER_SECRET|claim_next_vibode_3d_thumbnail_job/);
  assert.doesNotMatch(plan, /saveOwnedVersionScene|vibode_3d_scenes|callHarmonizeNbpProof/);
  assert.match(worker, /createHarmonizeNbpProvider/);
  assert.doesNotMatch(worker, /VIBODE_THUMBNAIL|claim_next_vibode_3d_thumbnail|delivery/);
  assert.match(provider, /callHarmonizeNbpProof/);
  assert.doesNotMatch(provider, /delivery/);
  assert.match(auth, /VIBODE_HARMONIZE_WORKER_SECRET/);
  assert.doesNotMatch(auth, /VIBODE_THUMBNAIL_WORKER_SECRET/);
  assert.match(internal, /harmonizeWorkerAuthorization/);
  assert.match(enqueue, /readHarmonizeActor/);
  assert.doesNotMatch(enqueue, /callHarmonizeNbpProof|generativelanguage/);
  assert.doesNotMatch(sql, /2400|1792|4:3/);
  assert.doesNotMatch(sql, /aspect_ratio/);
  assert.match(sql, /p_output_width/);
  assert.match(sql, /p_output_height/);
  assert.doesNotMatch(plan, /4 \/ 3/);
  assert.equal(HARMONIZE_NBP_OUTPUT_MAX_EDGE, HARMONIZE_COMPOSITE_MAX_EDGE);
  assert.match(source("lib/vibode-stage/harmonize-jobs/provider-capability.ts"), /classifyNanoBananaProAspectRatio/);
  assert.doesNotMatch(source("lib/vibode-stage/harmonize-nbp-proof.ts"), /\.resize\(|\.extract\(/);
  const completion = server.slice(
    server.indexOf("export async function completeHarmonizeGeneration"),
    server.indexOf("export async function failHarmonizeGeneration"),
  );
  const uploadAt = completion.indexOf(".upload(");
  const rpcAt = completion.indexOf("complete_vibode_harmonize_generation");
  const assessAt = completion.indexOf("assessHarmonizeJobOutput");
  assert.ok(assessAt > 0 && uploadAt > assessAt && rpcAt > uploadAt);
  assert.match(completion, /declaredMime/);
  assert.match(completion, /unavailable/);
  assert.match(internal, /declaredMime: request.headers.get\("content-type"\)/);
});

test("the job row stores measured dimensions for every standard ratio family", async () => {
  const families = [
    ["1:1", 1024, 1024],
    ["3:2", 1264, 848],
    ["2:3", 848, 1264],
    ["4:3", 1200, 896],
    ["3:4", 896, 1200],
    ["5:4", 1152, 928],
    ["4:5", 928, 1152],
    ["16:9", 1376, 768],
    ["9:16", 768, 1376],
    ["21:9", 1584, 672],
  ] as const;
  for (const [ratio, width, height] of families) {
    const approved = harmonizeProviderAcceptsComposite(width, height);
    assert.equal(approved.ok && approved.aspectRatio, ratio);
  }
  const offGrid = harmonizeProviderAcceptsComposite(1800, 1600);
  assert.equal(offGrid.ok, false);
  if (!offGrid.ok) assert.equal(offGrid.code, "unsupported_aspect");
  const approved = harmonizeProviderAcceptsComposite(1200, 896);
  const wide = harmonizeProviderAcceptsComposite(1264, 848);
  assert.equal(approved.ok && approved.aspectRatio, "4:3");
  assert.equal(wide.ok && wide.aspectRatio, "3:2");
  const wrongFrame = await solidJpeg(800, 600);
  const wrongMeta = await sharp(wrongFrame).metadata();
  assert.equal(wrongMeta.format, "jpeg");
  assert.equal(wrongMeta.width, 800);
  assert.equal(wrongMeta.height, 600);
  const rejected = await assessHarmonizeJobOutput(wrongFrame, 1200, 896, "image/jpeg");
  assert.equal(rejected.ok, false);
  const { db, job } = await queuedJob();
  const claim = claimNextHarmonizeJob(db, 0);
  if (!claim) throw new Error("expected a claim");
  const contact = markHarmonizeProviderContact(db, {
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    nowMs: 1,
  });
  assert.equal(contact.ok, true);
  const completed = completeHarmonizeJob(db, {
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    nowMs: 2,
    outputSha256: "ab".repeat(32),
    outputMime: "image/jpeg",
    outputWidth: 800,
    outputHeight: 600,
    outputPath: "rooms/measured.jpg",
    returnedModelId: "gemini-3-pro-image",
    providerStatus: "completed",
    providerHttpStatus: 200,
    latencyMs: 10,
  });
  assert.equal(completed.ok && completed.code, "completed");
  assert.equal(db.jobs[0]?.outputWidth, 800);
  assert.equal(db.jobs[0]?.outputHeight, 600);
  assert.equal(job.id, claim.jobId);
});

test("the fake provider is worker configuration and is refused in production", async () => {
  const google = readHarmonizeWorkerProviderMode({ NODE_ENV: "test" });
  assert.equal(google.ok && google.mode, "google");
  const allowAlone = readHarmonizeWorkerProviderMode({
    NODE_ENV: "development",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
  });
  assert.equal(allowAlone.ok && allowAlone.mode, "google");
  const local = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "fake",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
    NODE_ENV: "development",
  });
  assert.equal(local.ok && local.mode, "fake");
  const wrongAllow = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "fake",
    VIBODE_HARMONIZE_ALLOW_FAKE: "true",
    NODE_ENV: "development",
  });
  assert.equal(wrongAllow.ok, false);
  if (!wrongAllow.ok) assert.equal(wrongAllow.code, "fake_forbidden");
  const missingAllow = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "fake",
    NODE_ENV: "development",
  });
  assert.equal(missingAllow.ok, false);
  if (!missingAllow.ok) assert.equal(missingAllow.code, "fake_forbidden");
  const missingNodeEnv = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "fake",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(missingNodeEnv.ok, false);
  if (!missingNodeEnv.ok) assert.equal(missingNodeEnv.code, "fake_forbidden");
  const production = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "fake",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
    NODE_ENV: "production",
  });
  assert.equal(production.ok, false);
  if (!production.ok) assert.equal(production.code, "fake_forbidden");
  const unknown = readHarmonizeWorkerProviderMode({
    VIBODE_HARMONIZE_PROVIDER: "other",
    VIBODE_HARMONIZE_ALLOW_FAKE: "1",
    NODE_ENV: "test",
  });
  assert.equal(unknown.ok, false);
  const withoutKey = readHarmonizeWorkerProcessEnv({
    VIBODE_APP_BASE_URL: "http://127.0.0.1:3000",
    VIBODE_HARMONIZE_WORKER_SECRET: "local-test-secret",
    NODE_ENV: "test",
  }, { requireProviderCredentials: false });
  assert.equal(withoutKey.ok, true);
  const keyStillRequired = readHarmonizeWorkerProcessEnv({
    VIBODE_APP_BASE_URL: "http://127.0.0.1:3000",
    VIBODE_HARMONIZE_WORKER_SECRET: "local-test-secret",
    NODE_ENV: "test",
  });
  assert.equal(keyStillRequired.ok, false);
  const fake = createHarmonizeFakeProvider();
  const generated = await fake({
    prompt: "Photorealistic Furniture Harmonization",
    png: png(1200, 896),
    signal: new AbortController().signal,
  });
  assert.equal(generated.providerStatus, "FAKE");
  assert.equal(generated.returnedModel, "fake-harmonize");
  assert.equal(generated.outputMime, "image/jpeg");
  const again = await createHarmonizeFakeJpeg();
  assert.deepEqual(generated.output, again);
  assert.ok(Buffer.from(generated.output).includes(Buffer.from(HARMONIZE_FAKE_JPEG_COMMENT)));
  const meta = await sharp(generated.output).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 2400);
  assert.equal(meta.height, 1792);
  const raster = await sharp(generated.output).raw().toBuffer({ resolveWithObject: true });
  assert.equal(raster.info.width, 2400);
  assert.equal(raster.info.height, 1792);
  const assessed = await assessHarmonizeJobOutput(generated.output, 1200, 896, generated.outputMime);
  assert.equal(assessed.ok, true);
  if (assessed.ok) {
    assert.equal(assessed.width, 2400);
    assert.equal(assessed.height, 1792);
    assert.equal(assessed.mime, "image/jpeg");
  }
  const declaredMismatch = await assessHarmonizeJobOutput(generated.output, 1200, 896, "image/png");
  assert.equal(declaredMismatch.ok, false);
  const headerOnly = await assessHarmonizeJobOutput(jpeg(2400, 1792), 1200, 896, "image/jpeg");
  assert.equal(headerOnly.ok, false);
  const threeTwo = await solidJpeg(2528, 1696);
  const threeTwoMeta = await sharp(threeTwo).metadata();
  assert.equal(threeTwoMeta.format, "jpeg");
  assert.equal(threeTwoMeta.width, 2528);
  assert.equal(threeTwoMeta.height, 1696);
  const acceptedThreeTwo = await assessHarmonizeJobOutput(threeTwo, 1264, 848, "image/jpeg");
  assert.equal(acceptedThreeTwo.ok, true);
  if (acceptedThreeTwo.ok) {
    assert.equal(acceptedThreeTwo.width, 2528);
    assert.equal(acceptedThreeTwo.height, 1696);
  }
  const fourThreeOnThreeTwo = await assessHarmonizeJobOutput(generated.output, 1264, 848, "image/jpeg");
  assert.equal(fourThreeOnThreeTwo.ok, false);
  const lowResolution = await assessHarmonizeJobOutput(await solidJpeg(1264, 848), 1264, 848, "image/jpeg");
  assert.equal(lowResolution.ok, false);
  const portrait = await assessHarmonizeJobOutput(await solidJpeg(1536, 2752), 768, 1376, "image/jpeg");
  assert.equal(portrait.ok, true);
  if (portrait.ok) {
    assert.equal(portrait.width, 1536);
    assert.equal(portrait.height, 2752);
  }
  const ultrawide = await assessHarmonizeJobOutput(await solidJpeg(3168, 1344), 1584, 672, "image/jpeg");
  assert.equal(ultrawide.ok, true);
  if (ultrawide.ok) {
    assert.equal(ultrawide.width, 3168);
    assert.equal(ultrawide.height, 1344);
  }
  await assert.rejects(() => sharp(jpeg(2400, 1792)).raw().toBuffer());
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => fake({
    prompt: "Photorealistic Furniture Harmonization",
    png: png(1200, 896),
    signal: aborted.signal,
  }));
  const routes = [
    "app/api/vibode/harmonize/jobs/route.ts",
    "app/api/vibode/harmonize/jobs/upload/route.ts",
    "app/api/internal/vibode-harmonize-jobs/route.ts",
    "components/stage/HarmonizeExportButton.tsx",
    "components/stage/HarmonizeQaButton.tsx",
    "lib/vibode-stage/harmonize-qa.ts",
  ];
  for (const file of routes) {
    assert.doesNotMatch(source(file), /VIBODE_HARMONIZE_PROVIDER|VIBODE_HARMONIZE_ALLOW_FAKE/);
  }
  assert.match(source("harmonize-worker/src/index.ts"), /readHarmonizeWorkerProviderMode/);
  assert.match(source("harmonize-worker/src/index.ts"), /createHarmonizeFakeProvider/);
  assert.match(source("harmonize-worker/src/index.ts"), /requireProviderCredentials: providerMode.mode === "google"/);
  assert.match(source("lib/vibode-stage/harmonize-jobs/provider.ts"), /VIBODE_HARMONIZE_ALLOW_FAKE/);
  assert.match(source("lib/vibode-stage/harmonize-jobs/provider.ts"), /callHarmonizeNbpProof/);
  assert.doesNotMatch(source("lib/vibode-stage/harmonize-jobs/provider.ts"), /generativelanguage.googleapis.com/);
  assert.match(source("lib/vibode-stage/harmonize-jobs/output.ts"), /decoded.info.width !== meta.width/);
  assert.doesNotMatch(source("lib/vibode-stage/harmonize-jobs/plan.ts"), /harmonizeCompositeMatchesCertifiedFrame/);
  assert.doesNotMatch(source("lib/vibode-stage/harmonize-jobs/fake-jpeg.ts"), /GEMINI_API_KEY|GOOGLE_API_KEY|generativelanguage/);
});

test("the fake provider labels every standard ratio and still refuses an off-grid composite", async () => {
  const families = [
    [1024, 1024],
    [1264, 848],
    [848, 1264],
    [1200, 896],
    [896, 1200],
    [1152, 928],
    [928, 1152],
    [1376, 768],
    [768, 1376],
    [1584, 672],
  ] as const;
  const fake = createHarmonizeFakeProvider();
  for (const [width, height] of families) {
    const generated = await fake({
      prompt: "Photorealistic Furniture Harmonization",
      png: png(width, height),
      signal: new AbortController().signal,
    });
    const again = await createHarmonizeFakeJpeg(width * 2, height * 2);
    assert.deepEqual(generated.output, again);
    assert.equal(generated.providerStatus, "FAKE");
    assert.ok(Buffer.from(generated.output).includes(Buffer.from(HARMONIZE_FAKE_JPEG_COMMENT)));
    const assessed = await assessHarmonizeJobOutput(generated.output, width, height, "image/jpeg");
    assert.equal(assessed.ok, true);
    if (!assessed.ok) continue;
    assert.equal(assessed.width, width * 2);
    assert.equal(assessed.height, height * 2);
    const raster = await sharp(generated.output).raw().toBuffer();
    let visibleLabel = false;
    for (let index = 0; index < raster.length; index += 3) {
      if (raster[index] === 255 && raster[index + 1] === 255 && raster[index + 2] === 255) {
        visibleLabel = true;
        break;
      }
    }
    assert.equal(visibleLabel, true);
  }
  const fourThree = await createHarmonizeFakeJpeg();
  assert.deepEqual(fourThree, await createHarmonizeFakeJpeg(2400, 1792));
  await assert.rejects(
    () => fake({
      prompt: "Photorealistic Furniture Harmonization",
      png: png(1800, 1600),
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof HarmonizeNbpProofError && error.code === "invalid_package",
  );
});

test("a JPEG header without a decodable image does not complete the job", async () => {
  const { db, job, composite } = await queuedJob();
  const outputs = new Map<string, Uint8Array>();
  const result = await executeHarmonizeClaim({
    api: createMemoryHarmonizeWorkerApi({
      db,
      composites: new Map([[job.id, composite]]),
      outputs,
      clock: { nowMs: 0 },
    }),
    provider: async () => ({
      output: jpeg(2400, 1792),
      outputMime: "image/jpeg",
      returnedModel: "fake-harmonize",
      providerStatus: "FAKE",
      httpStatus: 200,
      latencyMs: 1,
    }),
    heartbeatIntervalMs: 60_000,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.code, "unexpected_output");
  assert.equal(db.jobs[0]?.status, "failed");
  assert.equal(outputs.size, 0);
  assert.notEqual(db.jobs[0]?.providerStartedAtMs, null);
});

async function accept(fixture: Fixture, room: HarmonizeTrustedRoom) {
  return withAdmin(() => planHarmonizeEnqueue({
    actor: admin(),
    submission: fixture.submission,
    composite: fixture.composite,
    loadTrusted: async () => ({ ok: true, room }),
    mode: "admin",
  }));
}

async function acceptOk(fixture: Fixture): Promise<HarmonizeJobInsert> {
  const planned = await accept(fixture, fixture.room);
  if (!planned.ok) throw new Error(planned.code);
  return planned.insert;
}

async function queuedJob(): Promise<{ db: HarmonizeJobDatabase; job: { id: string; status: string; providerStartedAtMs: number | null }; composite: Uint8Array }> {
  const fixture = await matchingFixture();
  const db = createHarmonizeJobDatabase();
  const insert = await withAdmin(() => acceptOk(fixture));
  const enqueued = enqueueHarmonizeJob(db, insert, 0);
  if (!enqueued.ok) throw new Error(enqueued.code);
  return { db, job: enqueued.job, composite: fixture.composite };
}

type Fixture = {
  room: HarmonizeTrustedRoom;
  submission: Record<string, unknown>;
  composite: Uint8Array;
};

async function matchingFixture(
  variantPrimary: string | null = null,
  pixels?: Readonly<{
    frameWidth: number;
    frameHeight: number;
    compositeWidth: number;
    compositeHeight: number;
  }>,
): Promise<Fixture> {
  const camera: HarmonizeExportCamera = pixels ? {
    ...CAMERA,
    aspect: pixels.frameWidth / pixels.frameHeight,
    frame: { width: pixels.frameWidth, height: pixels.frameHeight },
  } : CAMERA;
  const composite = png(pixels?.compositeWidth ?? 1200, pixels?.compositeHeight ?? 896);
  const background = new TextEncoder().encode("viewport-background");
  const object = harmonizeExportObject({
    objectId: "chair-1",
    assetId: "asset-chair-1",
    productId: "nico",
    variantId: "nico-helios",
    positionM: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    userSizeMultiplier: 1,
    localAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.8, z: 0.9 } },
  });
  const objects = sortHarmonizeObjects([object]);
  const catalog = chairCatalog(variantPrimary);
  const room = trustedRoom(background, catalog, camera);
  const materials = resolveHarmonizeMaterials({ objects, camera, catalog }).map((entry) => ({
    objectId: entry.objectId,
    primaryText: entry.primary.text,
    secondaryText: entry.secondary.text,
    primaryProvenance: entry.primary.provenance,
    secondaryProvenance: entry.secondary.provenance,
  }));
  const assembled = assembleHarmonizePrompt({ objects, camera, catalog });
  if (!assembled.text) throw new Error("prompt");
  const promptSha256 = await sha256HexBytes(new TextEncoder().encode(assembled.text));
  const sceneSnapshotSha256 = await sha256HexBytes(new TextEncoder().encode(harmonizeSceneCanonical({
    generationId: GENERATION,
    roomScaleMultiplier: 1,
    certifiedMetricScale: 1,
    effectiveMetricScale: effectiveMetricScale(1, 1),
    camera,
    objects,
    unmountedObjectIds: [],
  })));
  const submission = {
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    compositeSha256: await sha256HexBytes(composite),
    backgroundSha256: await sha256HexBytes(background),
    sceneSnapshotSha256,
    promptSha256,
    generationId: GENERATION,
    roomScaleMultiplier: 1,
    certifiedMetricScale: 1,
    effectiveMetricScale: effectiveMetricScale(1, 1),
    camera,
    objects: objects.map((entry) => ({ ...entry, uniformScale: 1 })),
    unmountedObjectIds: [],
    materials,
  };
  return { room, submission, composite };
}

function trustedRoom(
  background: Uint8Array,
  catalog: HarmonizeMaterialCatalog,
  camera: HarmonizeExportCamera = CAMERA,
): HarmonizeTrustedRoom {
  const sceneObject: SceneObjectDefinition = {
    objectId: "chair-1",
    assetId: "asset-chair-1",
    productId: "nico",
    variantId: "nico-helios",
    userSizeMultiplier: 1,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      uniformScale: 1,
    },
  };
  return {
    userId: USER,
    currentAfcGenerationId: GENERATION,
    roomScaleMultiplier: 1,
    certifiedMetricScale: 1,
    camera: {
      verticalFovDeg: camera.verticalFovDeg,
      frame: camera.frame,
      pose: camera.pose,
    },
    sourceUserId: USER,
    sourceRoomId: ROOM,
    background,
    emptySha256: "11".repeat(32),
    originalSha256: "22".repeat(32),
    persistedObjects: [sceneObject],
    scene: { afcGenerationId: GENERATION, objects: [sceneObject] },
    catalog,
  };
}

function chairCatalog(variantPrimary: string | null): HarmonizeMaterialCatalog {
  return {
    products: [{
      productId: "nico",
      name: "Nico Chair",
      primaryMaterial: "Chenille Helios",
      secondaryMaterial: "black metal legs",
    }],
    variants: [{
      variantId: "nico-helios",
      productId: "nico",
      finishLabel: "Helios",
      primaryMaterial: variantPrimary,
      secondaryMaterial: null,
    }],
  };
}

async function jpegResult() {
  return {
    output: await createHarmonizeFakeJpeg(),
    outputMime: "image/jpeg",
    returnedModel: "gemini-3-pro-image",
    providerStatus: "completed",
    httpStatus: 200,
    latencyMs: 30,
  };
}

async function solidJpeg(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3, 40);
  const encoded = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 80, chromaSubsampling: "4:4:4", mozjpeg: false, progressive: false })
    .toBuffer();
  return new Uint8Array(encoded);
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes[4] = 0x00;
  bytes[5] = 0x11;
  bytes[6] = 0x08;
  bytes[7] = (height >> 8) & 255;
  bytes[8] = height & 255;
  bytes[9] = (width >> 8) & 255;
  bytes[10] = width & 255;
  return bytes;
}

function codeOf(result: { ok: boolean; code?: string }): string {
  return result.ok ? "ok" : result.code ?? "unknown";
}

function key(index: number): string {
  return `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`;
}

function admin() {
  return { userId: USER, email: "admin@example.com" };
}

async function withAdmin<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = "admin@example.com";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
}

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}
