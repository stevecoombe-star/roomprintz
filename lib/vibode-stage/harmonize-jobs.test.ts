import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import {
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
import { HarmonizeNbpProofError } from "@/lib/vibode-stage/harmonize-nbp-proof";
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
import { createMemoryHarmonizeWorkerApi } from "./harmonize-jobs/memory-api";
import { assessHarmonizeJobOutput } from "./harmonize-jobs/output";
import { planHarmonizeEnqueue } from "./harmonize-jobs/plan";
import { harmonizeProviderAcceptsComposite } from "./harmonize-jobs/provider-capability";
import {
  HARMONIZE_COMPOSITE_MAX_BYTES,
  HARMONIZE_JOB_CLAIM_LEASE_MS,
  HARMONIZE_PRECONTACT_BACKOFF_MS,
} from "./harmonize-jobs/policy";
import type { HarmonizeProvider } from "./harmonize-jobs/provider";
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

test("oversized and non-4:3 composites are refused", async () => {
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
    const threeTwo = await planHarmonizeEnqueue({
      actor: admin(),
      submission: { ...fixture.submission, compositeSha256: "22".repeat(32) },
      composite: png(1264, 848),
      loadTrusted: async () => ({ ok: true, room: fixture.room }),
      mode: "admin",
    });
    assert.equal(threeTwo.ok, false);
    if (!threeTwo.ok) assert.equal(threeTwo.code, "unsupported_aspect");
  });
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
      return jpegResult();
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
    return jpegResult();
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
      return jpegResult();
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
      return jpegResult();
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
  const sql = source("supabase/migrations/20261012090000_vibode_harmonize_generations.sql");
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
  assert.match(sql, /p_output_width/);
  assert.match(sql, /p_output_height/);
  assert.doesNotMatch(plan, /4 \/ 3/);
  assert.match(source("lib/vibode-stage/harmonize-jobs/provider-capability.ts"), /HARMONIZE_NBP_ASPECT_RATIO/);
  const completion = server.slice(
    server.indexOf("export async function completeHarmonizeGeneration"),
    server.indexOf("export async function failHarmonizeGeneration"),
  );
  const uploadAt = completion.indexOf(".upload(");
  const rpcAt = completion.indexOf("complete_vibode_harmonize_generation");
  assert.ok(uploadAt > 0 && rpcAt > uploadAt);
  assert.match(completion, /unavailable/);
});

test("the job row stores measured dimensions while 4:3 stays a provider gate", async () => {
  const approved = harmonizeProviderAcceptsComposite(1200, 896);
  const wide = harmonizeProviderAcceptsComposite(1264, 848);
  assert.equal(approved.ok && approved.aspectRatio, "4:3");
  assert.equal(wide.ok, false);
  if (!wide.ok) assert.equal(wide.code, "unsupported_aspect");
  const rejected = await assessHarmonizeJobOutput(jpeg(800, 600), 1200, 896);
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

async function matchingFixture(variantPrimary: string | null = null): Promise<Fixture> {
  const composite = png(1200, 896);
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
  const room = trustedRoom(background, catalog);
  const materials = resolveHarmonizeMaterials({ objects, camera: CAMERA, catalog }).map((entry) => ({
    objectId: entry.objectId,
    primaryText: entry.primary.text,
    secondaryText: entry.secondary.text,
    primaryProvenance: entry.primary.provenance,
    secondaryProvenance: entry.secondary.provenance,
  }));
  const assembled = assembleHarmonizePrompt({ objects, camera: CAMERA, catalog });
  if (!assembled.text) throw new Error("prompt");
  const promptSha256 = await sha256HexBytes(new TextEncoder().encode(assembled.text));
  const sceneSnapshotSha256 = await sha256HexBytes(new TextEncoder().encode(harmonizeSceneCanonical({
    generationId: GENERATION,
    roomScaleMultiplier: 1,
    certifiedMetricScale: 1,
    effectiveMetricScale: effectiveMetricScale(1, 1),
    camera: CAMERA,
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
    camera: CAMERA,
    objects: objects.map((entry) => ({ ...entry, uniformScale: 1 })),
    unmountedObjectIds: [],
    materials,
  };
  return { room, submission, composite };
}

function trustedRoom(background: Uint8Array, catalog: HarmonizeMaterialCatalog): HarmonizeTrustedRoom {
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
      verticalFovDeg: CAMERA.verticalFovDeg,
      frame: CAMERA.frame,
      pose: CAMERA.pose,
    },
    sourceUserId: USER,
    sourceRoomId: ROOM,
    background,
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

function jpegResult() {
  return {
    output: jpeg(2400, 1792),
    outputMime: "image/jpeg",
    returnedModel: "gemini-3-pro-image",
    providerStatus: "completed",
    httpStatus: 200,
    latencyMs: 30,
  };
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
