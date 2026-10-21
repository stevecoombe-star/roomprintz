import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { REMOVE_CLEANUP_EXCLUSION_COPY } from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  describeCleanupGenerationSelection,
  removeCleanupGenerationAvailability,
} from "@/lib/vibode-stage/remove-cleanup-generation-ui";
import { createMemoryCleanupArtifacts } from "@/lib/vibode-stage/remove-cleanup-jobs/artifacts";
import { enqueuePreparedCleanupJob } from "@/lib/vibode-stage/remove-cleanup-jobs/enqueue";
import { executeCleanupClaim } from "@/lib/vibode-stage/remove-cleanup-jobs/execute";
import {
  handleRemoveCleanupCandidate,
  handleRemoveCleanupDiscard,
  handleRemoveCleanupEnqueue,
  handleRemoveCleanupJobStatus,
} from "@/lib/vibode-stage/remove-cleanup-jobs/http";
import {
  REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT,
  REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT,
  REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS,
  REMOVE_CLEANUP_JOB_MAX_PRECONTACT_ATTEMPTS,
} from "@/lib/vibode-stage/remove-cleanup-jobs/policy";
import { createMemoryCleanupControl } from "@/lib/vibode-stage/remove-cleanup-jobs/runtime";
import { requestRemoveCleanupNbpCandidate } from "@/lib/vibode-stage/remove-cleanup-nbp.server";
import {
  prepareAuthorizedRemoveCleanupInput,
  type RemoveCleanupExportDeps,
  type RemoveCleanupGenerationInputSnapshot,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function pack(index: number, width: number, height: number): Uint8Array {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  bits[index >> 3] |= 1 << (index & 7);
  return bits;
}

function selected(width: number, height: number, index: number) {
  const bits = pack(index, width, height);
  const digest = createHash("sha256").update(bits).update(JSON.stringify(0.93)).digest("hex").slice(0, 8);
  return {
    id: `v1-table-4-${digest}`,
    concept: "table",
    confidence: 0.93,
    maskSha256: sha256Hex(bits),
    bits: Buffer.from(bits).toString("base64"),
  };
}

async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer());
}

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 50, b: 50 } },
  }).jpeg().toBuffer());
}

function deps(width: number, height: number, bytes: Uint8Array, adminId = ADMIN): RemoveCleanupExportDeps {
  const generation = {
    id: GENERATION,
    roomId: ROOM,
    userId: adminId,
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
    userId: adminId,
    currentAfcGenerationId: GENERATION,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
  return {
    getAdmin: async () => ({ id: adminId }),
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

function requestFor(width: number, height: number, bytes: Uint8Array, index = 0): Request {
  return new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-jobs", {
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
      selectedObjects: [selected(width, height, index)],
    }),
  });
}

async function snapshot(width = 30, height = 20, index = 0): Promise<RemoveCleanupGenerationInputSnapshot> {
  const bytes = await png(width, height);
  const prepared = await prepareAuthorizedRemoveCleanupInput(requestFor(width, height, bytes, index), deps(width, height, bytes));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("snapshot failed");
  return prepared.snapshot;
}

function control() {
  let now = Date.parse("2026-10-20T12:00:00.000Z");
  const artifacts = createMemoryCleanupArtifacts();
  const runtime = createMemoryCleanupControl({ artifacts, now: () => now });
  return {
    artifacts,
    runtime,
    advance(ms: number) {
      now += ms;
    },
  };
}

function completed(bytes: Uint8Array): Response {
  return new Response(JSON.stringify({
    id: "interaction-1",
    status: "completed",
    usage: { total_output_tokens: 1120 },
    steps: [{
      type: "model_output",
      content: [{ type: "image", mime_type: "image/jpeg", data: Buffer.from(bytes).toString("base64") }],
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("migration, routes, and worker stay private and isolated", () => {
  const sql = source("supabase/migrations/20261020193000_vibode_cleanup_generations.sql");
  const worker = source("cleanup-worker/src/index.ts");
  const route = source("app/api/vibode/admin/remove-cleanup-jobs/route.ts");
  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const component = source("components/stage/RemoveCleanupGeneration.tsx");
  assert.match(sql, /vibode_cleanup_user_daily_provider_limit\(\)[\s\S]*select 5;/);
  assert.match(sql, /vibode_cleanup_global_daily_provider_limit\(\)[\s\S]*select 5;/);
  assert.match(sql, /vibode_cleanup_precontact_attempt_limit\(\)[\s\S]*select 3;/);
  assert.match(sql, /vibode_cleanup_one_active_user/);
  assert.match(sql, /vibode_cleanup_one_running/);
  assert.match(sql, /provider contact is immutable/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_cleanup_generations to service_role/);
  assert.equal(sql.includes("alter table public.vibode_harmonize"), false);
  assert.match(sql, /'vibode-cleanup',\s*\n\s*'vibode-cleanup',\s*\n\s*false/);
  assert.match(route, /getAuthenticatedAdminUser|createRemoveCleanupRouteDeps/);
  assert.doesNotMatch(route, /generativelanguage|publishHarmonize|vibode-generations/);
  assert.match(worker, /--provider/);
  assert.doesNotMatch(worker, /publishHarmonize|vibode_harmonize_generations/);
  assert.match(session, /RemoveCleanupGeneration/);
  assert.match(component, /Clean Up Room/);
  assert.match(component, /REMOVE_CLEANUP_EXCLUSION_COPY/);
  assert.equal(
    REMOVE_CLEANUP_EXCLUSION_COPY,
    "Only objects hidden in Objects mode are included. Brush edits are not included.",
  );
  assert.doesNotMatch(component, /Accept|Image History|publishHarmonize/);
  assert.equal(REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT, 5);
  assert.equal(REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT, 5);
  assert.equal(REMOVE_CLEANUP_JOB_MAX_PRECONTACT_ATTEMPTS, 3);
});

test("enqueue freezes the snapshot and a duplicate does not create another job", async () => {
  const prepared = await snapshot();
  const first = control();
  const http = {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: first.runtime,
  };
  const created = await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), http);
  const createdBody = await created.json() as { created: boolean; job: { jobId: string; status: string; stageRegistration: string } };
  assert.equal(created.status, 200);
  assert.equal(createdBody.created, true);
  assert.equal(createdBody.job.status, "queued");
  assert.equal(createdBody.job.stageRegistration, "not-assessed");
  const job = first.runtime.database.jobs[0];
  assert.ok(job);
  assert.equal(job.resolutionClass, "2K");
  assert.deepEqual(await first.artifacts.get(job.originalPath), prepared.artifacts.originalBytes());
  assert.deepEqual(await first.artifacts.get(job.overlayPath), prepared.artifacts.overlayPng());
  assert.equal(new TextDecoder().decode(await first.artifacts.get(job.promptPath) ?? new Uint8Array()), prepared.prompt.text);
  const again = await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), http);
  const againBody = await again.json() as { created: boolean; job: { jobId: string } };
  assert.equal(againBody.created, false);
  assert.equal(againBody.job.jobId, createdBody.job.jobId);
  assert.equal(first.runtime.database.jobs.length, 1);

  const other = await handleRemoveCleanupEnqueue(
    requestFor(30, 20, prepared.artifacts.originalBytes(), 1),
    http,
  );
  assert.equal(other.status, 409);
});

test("non-admin, wrong owner, stale generation, and foreign candidate access are rejected", async () => {
  const bytes = await png(30, 20);
  const anonymous = await handleRemoveCleanupEnqueue(requestFor(30, 20, bytes), {
    getAdmin: async () => null,
    prepareDeps: { ...deps(30, 20, bytes), getAdmin: async () => null },
    control: control().runtime,
  });
  assert.equal(anonymous.status, 403);
  const foreign = await handleRemoveCleanupEnqueue(requestFor(30, 20, bytes), {
    getAdmin: async () => ({ id: OTHER }),
    prepareDeps: { ...deps(30, 20, bytes), getAdmin: async () => ({ id: OTHER }) },
    control: control().runtime,
  });
  assert.equal(foreign.status, 404);
  const staleDeps = deps(30, 20, bytes);
  const staleStore = staleDeps.createStore();
  assert.ok(staleStore);
  const stale = await handleRemoveCleanupEnqueue(requestFor(30, 20, bytes), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: {
      ...staleDeps,
      createStore: () => ({
        getRoom: async () => {
          const room = await staleStore.getRoom(ROOM);
          return room ? { ...room, currentAfcGenerationId: "33333333-3333-4333-8333-333333333333" } : null;
        },
        getGeneration: async (generationId: string) => {
          const generation = await staleStore.getGeneration(generationId);
          return generation ? { ...generation, id: generationId } : null;
        },
      }),
    },
    control: control().runtime,
  });
  assert.equal(stale.status, 404);

  const live = control();
  const prepared = await snapshot();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: live.runtime,
  });
  const image = await jpeg(1800, 1200);
  const ran = await executeCleanupClaim({
    control: live.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async ({ snapshot: frozen, signal }) => requestRemoveCleanupNbpCandidate({
      snapshot: frozen,
      output: {
        schemaVersion: "remove-cleanup-output-config/v1",
        providerId: "google-gemini-interactions",
        modelId: "gemini-3-pro-image",
        aspectRatioFamily: frozen.aspect.providerFamily.admissible ? frozen.aspect.providerFamily.family : "3:2",
        resolutionClass: "2K",
        mimeType: "image/jpeg",
      },
      apiKey: "test-key",
      signal,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: Array<{ type: string; data?: string }>;
          response_format: { image_size?: string };
        };
        assert.equal(body.input.filter((part) => part.type === "image").length, 2);
        assert.equal(body.response_format.image_size, "2K");
        return completed(image);
      },
    }),
  });
  assert.equal(ran.outcome, "succeeded");
  assert.equal(ran.posts, 1);
  const jobId = live.runtime.database.jobs[0]?.id ?? "";
  const candidate = await handleRemoveCleanupCandidate({
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: live.runtime,
  }, jobId);
  assert.equal(candidate.status, 200);
  assert.equal(candidate.headers.get("cache-control"), "no-store");
  assert.equal(candidate.headers.get("content-type"), "image/jpeg");
  const hidden = await handleRemoveCleanupCandidate({
    getAdmin: async () => ({ id: OTHER }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: live.runtime,
  }, jobId);
  assert.equal(hidden.status, 404);
  const status = await handleRemoveCleanupJobStatus(new Request("http://127.0.0.1/jobs"), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: live.runtime,
  }, jobId);
  const statusBody = await status.json() as { job: { candidateAvailable: boolean; stageRegistration: string } };
  assert.equal(statusBody.job.candidateAvailable, true);
  assert.equal(statusBody.job.stageRegistration, "not-assessed");
  assert.equal(JSON.stringify(statusBody).includes(prepared.prompt.text), false);
  assert.equal(JSON.stringify(statusBody).includes("rooms/"), false);
  const discarded = await handleRemoveCleanupDiscard({
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: live.runtime,
  }, jobId);
  const discardedBody = await discarded.json() as { job: { status: string; candidateAvailable: boolean } };
  assert.equal(discardedBody.job.status, "discarded");
  assert.equal(discardedBody.job.candidateAvailable, false);
  assert.equal(live.runtime.database.jobs[0]?.status, "succeeded");
  const hiddenAfterDiscard = await handleRemoveCleanupCandidate({
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: live.runtime,
  }, jobId);
  assert.equal(hiddenAfterDiscard.status, 404);
});

test("hash mismatch fails before contact and a pre-contact interruption can run once later", async () => {
  const prepared = await snapshot();
  const box = control();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: box.runtime,
  });
  const job = box.runtime.database.jobs[0];
  assert.ok(job);
  await box.artifacts.put(job.originalPath, Uint8Array.of(1, 2, 3, 4), "image/png");
  let posts = 0;
  const failed = await executeCleanupClaim({
    control: box.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async () => {
      posts += 1;
      throw new Error("provider");
    },
  });
  assert.equal(failed.code, "invalid_artifact");
  assert.equal(posts, 0);
  assert.equal(box.runtime.database.jobs[0]?.providerStartedAtMs, null);
  assert.equal(box.runtime.database.jobs[0]?.status, "failed");

  const retry = control();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: retry.runtime,
  });
  const stored = retry.runtime.database.jobs[0];
  assert.ok(stored);
  await retry.artifacts.remove([stored.originalPath]);
  const interrupted = await executeCleanupClaim({
    control: retry.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async () => {
      posts += 1;
      throw new Error("provider");
    },
  });
  assert.equal(interrupted.code, "worker_interrupted");
  assert.equal(retry.runtime.database.jobs[0]?.status, "queued");
  await retry.artifacts.put(stored.originalPath, prepared.artifacts.originalBytes(), "image/png");
  retry.advance(20_000);
  const image = await jpeg(1800, 1200);
  const finished = await executeCleanupClaim({
    control: retry.runtime,
    heartbeatIntervalMs: 60_000,
    generate: ({ snapshot: frozen, signal }) => requestRemoveCleanupNbpCandidate({
      snapshot: frozen,
      output: {
        schemaVersion: "remove-cleanup-output-config/v1",
        providerId: "google-gemini-interactions",
        modelId: "gemini-3-pro-image",
        aspectRatioFamily: "3:2",
        resolutionClass: "2K",
        mimeType: "image/jpeg",
      },
      apiKey: "test-key",
      signal,
      fetchImpl: async () => completed(image),
    }),
  });
  assert.equal(finished.outcome, "succeeded");
  assert.equal(finished.posts, 1);
});

test("one contacted job never receives a second POST, and a stored candidate can be settled", async () => {
  const prepared = await snapshot();
  const box = control();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: box.runtime,
  });
  let calls = 0;
  const uncertain = await executeCleanupClaim({
    control: box.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async () => {
      calls += 1;
      return {
        ok: false,
        phase: "provider_uncertain",
        code: "timeout",
        message: "The provider did not finish before the timeout.",
        retryable: false,
        httpStatus: null,
        providerStatus: null,
        providerFields: [],
        postCount: 1,
        getCount: 1,
      };
    },
  });
  assert.equal(uncertain.code, "timeout");
  assert.equal(calls, 1);
  assert.equal(box.runtime.database.jobs[0]?.failureCode, "provider_uncertain");
  const image = await jpeg(1800, 1200);
  const job = box.runtime.database.jobs[0];
  assert.ok(job);
  await box.artifacts.put(`rooms/${job.roomId}/jobs/${job.id}/candidate.jpg`, image, "image/jpeg");
  const recovered = await executeCleanupClaim({
    control: box.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async () => {
      calls += 1;
      throw new Error("second post");
    },
  });
  assert.equal(recovered.outcome, "recovered");
  assert.equal(recovered.posts, 0);
  assert.equal(calls, 1);
  assert.equal(box.runtime.database.jobs[0]?.status, "succeeded");
  assert.equal(box.runtime.database.jobs[0]?.stageRegistration, "not-assessed");
});

test("daily ceilings, one running job, and discard do not create another provider call", async () => {
  const box = control();
  for (let index = 0; index < 5; index += 1) {
    const prepared = await snapshot(30, 20, index);
    const queued = await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes(), index), {
      getAdmin: async () => ({ id: ADMIN }),
      prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
      control: box.runtime,
    });
    assert.equal(queued.status, 200, String(index));
    const image = await jpeg(1800, 1200);
    const done = await executeCleanupClaim({
      control: box.runtime,
      heartbeatIntervalMs: 60_000,
      generate: ({ snapshot: frozen, signal }) => requestRemoveCleanupNbpCandidate({
        snapshot: frozen,
        output: {
          schemaVersion: "remove-cleanup-output-config/v1",
          providerId: "google-gemini-interactions",
          modelId: "gemini-3-pro-image",
          aspectRatioFamily: "3:2",
          resolutionClass: "2K",
          mimeType: "image/jpeg",
        },
        apiKey: "test-key",
        signal,
        fetchImpl: async () => completed(image),
      }),
    });
    assert.equal(done.outcome, "succeeded", String(index));
  }
  const sixth = await snapshot(30, 20, 6);
  const limited = await handleRemoveCleanupEnqueue(requestFor(30, 20, sixth.artifacts.originalBytes(), 6), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, sixth.artifacts.originalBytes()),
    control: box.runtime,
  });
  assert.equal(limited.status, 429);
  const globalBytes = await png(20, 30);
  const globalPrepared = await prepareAuthorizedRemoveCleanupInput(
    requestFor(20, 30, globalBytes),
    deps(20, 30, globalBytes, OTHER),
  );
  assert.equal(globalPrepared.ok, true);
  if (globalPrepared.ok) {
    const globalLimit = await enqueuePreparedCleanupJob(box.runtime, globalPrepared.snapshot, {
      userId: OTHER,
      roomUserId: OTHER,
      currentGenerationId: GENERATION,
    });
    assert.equal(globalLimit.ok, false);
    if (!globalLimit.ok) assert.equal(globalLimit.code, "global_daily_limit");
  }

  const running = control();
  const first = await snapshot(30, 20, 0);
  const secondBytes = await png(20, 30);
  await handleRemoveCleanupEnqueue(requestFor(30, 20, first.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, first.artifacts.originalBytes()),
    control: running.runtime,
  });
  const claimed = await running.runtime.claim();
  assert.ok(claimed);
  const otherAdmin = createMemoryCleanupControl({
    artifacts: running.artifacts,
    database: running.runtime.database,
    now: () => Date.parse("2026-10-20T12:00:00.000Z"),
  });
  const portrait = await prepareAuthorizedRemoveCleanupInput(
    requestFor(20, 30, secondBytes),
    deps(20, 30, secondBytes, OTHER),
  );
  assert.equal(portrait.ok, true);
  if (!portrait.ok) return;
  const queuedOther = await enqueuePreparedCleanupJob(otherAdmin, portrait.snapshot, {
    userId: OTHER,
    roomUserId: OTHER,
    currentGenerationId: GENERATION,
  });
  assert.equal(queuedOther.ok, true);
  assert.equal(await otherAdmin.claim(), null);

  const discardBox = control();
  const fresh = await snapshot();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, fresh.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, fresh.artifacts.originalBytes()),
    control: discardBox.runtime,
  });
  const jobId = discardBox.runtime.database.jobs[0]?.id ?? "";
  const discarded = await handleRemoveCleanupDiscard({
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, fresh.artifacts.originalBytes()),
    control: discardBox.runtime,
  }, jobId);
  const discardedBody = await discarded.json() as { job: { status: string } };
  assert.equal(discardedBody.job.status, "discarded");
  let posts = 0;
  const idle = await executeCleanupClaim({
    control: discardBox.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async () => {
      posts += 1;
      throw new Error("post");
    },
  });
  assert.equal(idle.outcome, "idle");
  assert.equal(posts, 0);

  const lease = control();
  const leased = await snapshot();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, leased.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, leased.artifacts.originalBytes()),
    control: lease.runtime,
  });
  const firstClaim = await lease.runtime.claim();
  assert.ok(firstClaim);
  lease.advance(REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS + 1);
  const secondClaim = await lease.runtime.claim();
  assert.ok(secondClaim);
  assert.equal(lease.runtime.database.jobs[0]?.providerStartedAtMs, null);
  assert.equal(lease.runtime.database.jobs[0]?.attemptCount, 2);
  await lease.runtime.contact(secondClaim.jobId, secondClaim.claimNonce);
  lease.advance(REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS + 1);
  assert.equal(await lease.runtime.claim(), null);
  assert.equal(lease.runtime.database.jobs[0]?.status, "failed");
  assert.equal(lease.runtime.database.jobs[0]?.failureCode, "provider_uncertain");
});

test("a provider refusal is terminal and is not posted again", async () => {
  const prepared = await snapshot();
  const box = control();
  await handleRemoveCleanupEnqueue(requestFor(30, 20, prepared.artifacts.originalBytes()), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: deps(30, 20, prepared.artifacts.originalBytes()),
    control: box.runtime,
  });
  let posts = 0;
  const refused = await executeCleanupClaim({
    control: box.runtime,
    heartbeatIntervalMs: 60_000,
    generate: ({ snapshot: frozen, signal }) => {
      posts += 1;
      return requestRemoveCleanupNbpCandidate({
        snapshot: frozen,
        output: {
          schemaVersion: "remove-cleanup-output-config/v1",
          providerId: "google-gemini-interactions",
          modelId: "gemini-3-pro-image",
          aspectRatioFamily: "3:2",
          resolutionClass: "2K",
          mimeType: "image/jpeg",
        },
        apiKey: "test-key",
        signal,
        fetchImpl: async () => new Response(JSON.stringify({ id: "interaction-1", status: "failed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      });
    },
  });
  assert.equal(refused.posts, 1);
  assert.equal(posts, 1);
  assert.equal(box.runtime.database.jobs[0]?.failureCode, "provider_rejected");
  const again = await executeCleanupClaim({
    control: box.runtime,
    heartbeatIntervalMs: 60_000,
    generate: async () => {
      posts += 1;
      throw new Error("second post");
    },
  });
  assert.equal(again.outcome, "idle");
  assert.equal(posts, 1);
});

test("confirmation keeps the frozen selection", () => {
  const frozen = describeCleanupGenerationSelection([{ concept: "table" }, { concept: "lamp" }]);
  const later = describeCleanupGenerationSelection([{ concept: "sofa" }]);
  assert.deepEqual(frozen.concepts, ["lamp", "table"]);
  assert.equal(frozen.count, 2);
  assert.deepEqual(later.concepts, ["sofa"]);
  assert.equal(removeCleanupGenerationAvailability({
    segmentationPhase: "ready",
    hiddenCount: 1,
    busy: false,
  }), true);
  assert.equal(removeCleanupGenerationAvailability({
    segmentationPhase: "ready",
    hiddenCount: 0,
    busy: false,
  }), false);
});
