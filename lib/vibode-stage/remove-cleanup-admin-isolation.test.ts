import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import sharp from "sharp";

import type { AfcGenerationRecord, AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { isAdminEmail } from "@/lib/adminAccess";
import { RemoveCleanupAdminGate } from "@/components/stage/RemoveCleanupAdminGate";
import {
  cleanupAdminAccessConfirmed,
  readCleanupAdminAccess,
  REMOVE_CLEANUP_ADMIN_ACCESS_PATH,
} from "@/lib/vibode-stage/remove-cleanup-admin-access";
import { handleRemoveCleanupExport } from "@/lib/vibode-stage/remove-cleanup-export.server";
import { createMemoryCleanupArtifacts } from "@/lib/vibode-stage/remove-cleanup-jobs/artifacts";
import { enqueuePreparedCleanupJob } from "@/lib/vibode-stage/remove-cleanup-jobs/enqueue";
import { executeCleanupClaim } from "@/lib/vibode-stage/remove-cleanup-jobs/execute";
import {
  handleRemoveCleanupAccept,
  handleRemoveCleanupCandidate,
  handleRemoveCleanupDiscard,
  handleRemoveCleanupEnqueue,
  handleRemoveCleanupJobStatus,
  handleRemoveCleanupRetry,
  handleRemoveCleanupRoomStatus,
  type CleanupHttpDeps,
} from "@/lib/vibode-stage/remove-cleanup-jobs/http";
import { createMemoryCleanupControl, type CleanupControl } from "@/lib/vibode-stage/remove-cleanup-jobs/runtime";
import { authorizeCleanupWorkerClaim, type CleanupWorkerUserLookup } from "@/lib/vibode-stage/remove-cleanup-jobs/worker-auth";
import {
  prepareAuthorizedRemoveCleanupInput,
  type RemoveCleanupExportDeps,
  type RemoveCleanupGenerationInputSnapshot,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";
import { handleRemoveObjectsAdmin, type RemoveObjectsAdminDeps } from "@/lib/vibode-stage/remove-segmentation-admin";

const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FOREIGN_JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN_EMAIL = "admin@example.com";
const OWNER_EMAIL = "owner@example.com";

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

function cleanupBody(bytes: Uint8Array, width: number, height: number, index = 0): Record<string, unknown> {
  return {
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
  };
}

function cleanupRequest(bytes: Uint8Array, width = 30, height = 20, index = 0): Request {
  return new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cleanupBody(bytes, width, height, index)),
  });
}

function closedPrepare(admin: { id: string } | null = null): RemoveCleanupExportDeps & { calls: { store: number; service: number; original: number } } {
  const calls = { store: 0, service: 0, original: 0 };
  return {
    calls,
    getAdmin: async () => admin,
    createStore: () => {
      calls.store += 1;
      throw new Error("cleanup store was reached");
    },
    createService: () => {
      calls.service += 1;
      throw new Error("cleanup service was reached");
    },
    loadOriginal: async () => {
      calls.original += 1;
      throw new Error("cleanup original was reached");
    },
  };
}

function closedControl(): CleanupControl {
  const deny = async (): Promise<never> => {
    throw new Error("cleanup control was reached");
  };
  return {
    now: () => 0,
    artifacts: { put: deny, get: deny, remove: deny },
    enqueue: deny,
    readJob: deny,
    readRoom: deny,
    discard: deny,
    retry: deny,
    claim: deny,
    heartbeat: deny,
    contact: deny,
    fail: deny,
    complete: deny,
    settle: deny,
    recoverable: deny,
    accept: deny,
  } as CleanupControl;
}

function closedDeps(admin: { id: string } | null = null): CleanupHttpDeps & { prepare: ReturnType<typeof closedPrepare> } {
  const prepare = closedPrepare(admin);
  return {
    prepare,
    getAdmin: async () => admin,
    prepareDeps: prepare,
    control: closedControl(),
  };
}

function ownedDeps(bytes: Uint8Array, width: number, height: number, roomUserId = ADMIN): RemoveCleanupExportDeps {
  const generation = {
    id: GENERATION,
    roomId: ROOM,
    userId: roomUserId,
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
    userId: roomUserId,
    currentAfcGenerationId: GENERATION,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
  return {
    getAdmin: async () => ({ id: ADMIN }),
    createStore: () => ({
      async getRoom() { return room; },
      async getGeneration() { return generation; },
    }),
    createService: () => ({ service: true }),
    loadOriginal: async () => ({ ok: true, bytes }),
  };
}

function memoryControl() {
  const artifacts = createMemoryCleanupArtifacts();
  const runtime = createMemoryCleanupControl({ artifacts, now: () => Date.parse("2026-10-23T12:00:00.000Z") });
  return { artifacts, runtime };
}

async function preparedSnapshot(): Promise<RemoveCleanupGenerationInputSnapshot> {
  const bytes = await png(30, 20);
  const prepared = await prepareAuthorizedRemoveCleanupInput(
    cleanupRequest(bytes),
    ownedDeps(bytes, 30, 20),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("snapshot failed");
  return prepared.snapshot;
}

async function withAdminEmail<T>(email: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  if (email === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
  else process.env.VIBODE_ADMIN_EMAIL = email;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
}

function providerFailure() {
  return {
    ok: false as const,
    phase: "provider_rejected" as const,
    code: "refused",
    message: "The provider refused the request.",
    retryable: false as const,
    httpStatus: 400,
    providerStatus: "failed",
    providerFields: [],
    postCount: 1,
    getCount: 0,
  };
}

test("cleanup routes use the admin actor and leave instant REMOVE on readRemoveActor", () => {
  const deps = source("lib/vibode-stage/remove-cleanup-jobs/route-deps.ts");
  const exportRoute = source("app/api/vibode/admin/remove-cleanup-export/route.ts");
  assert.match(deps, /getAuthenticatedAdminUser/);
  assert.doesNotMatch(deps, /readRemoveActor/);
  assert.match(exportRoute, /getAuthenticatedAdminUser/);
  assert.doesNotMatch(exportRoute, /readRemoveActor/);
  for (const relativePath of [
    "app/api/vibode/admin/remove-cleanup-jobs/route.ts",
    "app/api/vibode/admin/remove-cleanup-jobs/[jobId]/route.ts",
    "app/api/vibode/admin/remove-cleanup-jobs/[jobId]/candidate/route.ts",
    "app/api/vibode/admin/remove-cleanup-jobs/[jobId]/retry/route.ts",
    "app/api/vibode/admin/remove-cleanup-jobs/[jobId]/accept/route.ts",
    "app/api/vibode/admin/remove-cleanup-jobs/[jobId]/discard/route.ts",
  ]) {
    const route = source(relativePath);
    assert.match(route, /createRemoveCleanupRouteDeps/);
    assert.doesNotMatch(route, /readRemoveActor/);
  }
  const objects = source("app/api/vibode/admin/remove-objects/route.ts");
  const alignment = source("app/api/vibode/admin/remove-alignment/route.ts");
  const actor = source("lib/vibode-stage/remove-access.server.ts");
  assert.match(objects, /readRemoveActor/);
  assert.match(alignment, /readRemoveActor/);
  assert.doesNotMatch(objects, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(alignment, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(actor, /isAdminEmail|VIBODE_ADMIN_EMAIL|getAuthenticatedAdminUser/);
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = ADMIN_EMAIL;
  try {
    assert.equal(isAdminEmail(OWNER_EMAIL), false);
    assert.equal(isAdminEmail(null), false);
    assert.equal(isAdminEmail(ADMIN_EMAIL), true);
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
});

test("anonymous and authenticated non-admin cleanup calls fail before service writes", async () => {
  const tiny = new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: ROOM }),
  });
  const statusUrl = new Request(`http://127.0.0.1/api/vibode/admin/remove-cleanup-jobs?roomId=${ROOM}`);
  const jobUrl = new Request("http://127.0.0.1/api/vibode/admin/remove-cleanup-jobs/job");
  for (const actor of ["anonymous", "authenticated-non-admin"] as const) {
    const deps = closedDeps(null);
    const enqueue = await handleRemoveCleanupEnqueue(tiny.clone(), deps);
    const listed = await handleRemoveCleanupRoomStatus(statusUrl.clone(), deps);
    const status = await handleRemoveCleanupJobStatus(jobUrl.clone(), deps, FOREIGN_JOB);
    const candidate = await handleRemoveCleanupCandidate(deps, FOREIGN_JOB);
    const retry = await handleRemoveCleanupRetry(deps, FOREIGN_JOB);
    const accept = await handleRemoveCleanupAccept(deps, FOREIGN_JOB);
    const discard = await handleRemoveCleanupDiscard(deps, FOREIGN_JOB);
    const exported = await handleRemoveCleanupExport(tiny.clone(), deps.prepare);
    assert.equal(enqueue.status, 403, actor);
    assert.equal(exported.status, 403, actor);
    assert.equal((await exported.json() as { reason: string }).reason, "Sign in required.");
    for (const response of [listed, status, candidate, retry, accept, discard]) {
      assert.equal(response.status, 404, actor);
    }
    assert.equal(deps.prepare.calls.store, 0, actor);
    assert.equal(deps.prepare.calls.service, 0, actor);
    assert.equal(deps.prepare.calls.original, 0, actor);
  }
});

test("an admin can enqueue an owned room and cannot enqueue another user's room", async () => {
  const bytes = await png(30, 20);
  const box = memoryControl();
  let originals = 0;
  const owned = ownedDeps(bytes, 30, 20, ADMIN);
  const created = await handleRemoveCleanupEnqueue(cleanupRequest(bytes), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: {
      ...owned,
      loadOriginal: async () => {
        originals += 1;
        return { ok: true, bytes };
      },
    },
    control: box.runtime,
  });
  assert.equal(created.status, 200);
  assert.equal(originals, 1);
  assert.equal(box.runtime.database.jobs.length, 1);
  assert.equal(box.runtime.database.jobs[0]?.userId, ADMIN);

  let foreignOriginals = 0;
  let foreignEnqueues = 0;
  const foreign = ownedDeps(bytes, 30, 20, OWNER);
  const rejected = await handleRemoveCleanupEnqueue(cleanupRequest(bytes), {
    getAdmin: async () => ({ id: ADMIN }),
    prepareDeps: {
      ...foreign,
      getAdmin: async () => ({ id: ADMIN }),
      loadOriginal: async () => {
        foreignOriginals += 1;
        throw new Error("foreign original was loaded");
      },
    },
    control: {
      ...box.runtime,
      enqueue: async () => {
        foreignEnqueues += 1;
        throw new Error("foreign enqueue");
      },
    },
  });
  assert.equal(rejected.status, 404);
  assert.equal((await rejected.json() as { error: string }).error, "Room not found.");
  assert.equal(foreignOriginals, 0);
  assert.equal(foreignEnqueues, 0);
  assert.equal(box.runtime.database.jobs.length, 1);
});

test("forged ids, foreign jobs, and cleanup mutations stay inside the admin owner boundary", async () => {
  const prepared = await preparedSnapshot();
  const box = memoryControl();
  const queued = await enqueuePreparedCleanupJob(box.runtime, prepared, {
    userId: ADMIN,
    roomUserId: ADMIN,
    currentGenerationId: GENERATION,
  });
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  const jobId = queued.job.id;
  const http = (admin: { id: string } | null): CleanupHttpDeps => ({
    getAdmin: async () => admin,
    prepareDeps: ownedDeps(prepared.artifacts.originalBytes(), 30, 20),
    control: box.runtime,
  });
  const admin = http({ id: ADMIN });
  const stranger = http({ id: OWNER });
  const anonymous = http(null);

  const listed = await handleRemoveCleanupRoomStatus(
    new Request(`http://127.0.0.1/jobs?roomId=${ROOM}`),
    admin,
  );
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as { job: { jobId: string } }).job.jobId, jobId);
  const hiddenList = await handleRemoveCleanupRoomStatus(
    new Request(`http://127.0.0.1/jobs?roomId=${ROOM}`),
    stranger,
  );
  assert.equal(hiddenList.status, 200);
  assert.equal((await hiddenList.json() as { job: unknown }).job, null);
  assert.equal((await handleRemoveCleanupRoomStatus(
    new Request(`http://127.0.0.1/jobs?roomId=${ROOM}`),
    anonymous,
  )).status, 404);

  assert.equal((await handleRemoveCleanupJobStatus(new Request("http://127.0.0.1/job"), admin, jobId)).status, 200);
  assert.equal((await handleRemoveCleanupJobStatus(new Request("http://127.0.0.1/job"), stranger, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupJobStatus(new Request("http://127.0.0.1/job"), anonymous, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupJobStatus(new Request("http://127.0.0.1/job"), admin, "not-a-job")).status, 404);
  assert.equal((await handleRemoveCleanupJobStatus(new Request("http://127.0.0.1/job"), admin, FOREIGN_JOB)).status, 404);

  let artifactReads = 0;
  const watched: CleanupHttpDeps = {
    ...admin,
    control: {
      ...box.runtime,
      artifacts: {
        ...box.artifacts,
        get: async (artifactPath: string) => {
          artifactReads += 1;
          return box.artifacts.get(artifactPath);
        },
      },
    },
  };
  assert.equal((await handleRemoveCleanupCandidate(anonymous, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupCandidate(stranger, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupCandidate(admin, "not-a-job")).status, 404);
  assert.equal((await handleRemoveCleanupCandidate(watched, jobId)).status, 404);
  assert.equal(artifactReads, 0);

  assert.equal((await handleRemoveCleanupRetry(anonymous, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupRetry(stranger, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupRetry(admin, "not-a-job")).status, 404);
  assert.equal((await handleRemoveCleanupRetry(admin, FOREIGN_JOB)).status, 404);
  const premature = await handleRemoveCleanupRetry(admin, jobId);
  assert.equal(premature.status, 409);
  assert.equal(box.runtime.database.jobs.length, 1);

  assert.equal((await handleRemoveCleanupAccept(anonymous, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupAccept(stranger, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupAccept(admin, "not-a-job")).status, 404);
  assert.equal((await handleRemoveCleanupAccept(admin, FOREIGN_JOB)).status, 404);
  const unready = await handleRemoveCleanupAccept(admin, jobId);
  assert.equal(unready.status, 409);
  assert.equal(box.runtime.ledger.assets.length, 0);

  assert.equal((await handleRemoveCleanupDiscard(anonymous, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupDiscard(stranger, jobId)).status, 404);
  assert.equal((await handleRemoveCleanupDiscard(admin, "not-a-job")).status, 404);
  assert.equal((await handleRemoveCleanupDiscard(admin, FOREIGN_JOB)).status, 404);
  assert.equal(box.runtime.database.jobs[0]?.status, "queued");
  const discarded = await handleRemoveCleanupDiscard(admin, jobId);
  assert.equal(discarded.status, 200);
  assert.equal((await discarded.json() as { job: { status: string } }).job.status, "discarded");

  const failed = box.runtime.database.jobs[0];
  assert.ok(failed);
  failed.status = "failed";
  failed.failureCode = "provider_rejected";
  failed.discardedAtMs = null;
  const retried = await handleRemoveCleanupRetry(admin, jobId);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json() as { created: boolean; job: { status: string } }).job.status, "queued");
  assert.equal((await handleRemoveCleanupRetry(stranger, jobId)).status, 404);
});

test("non-admin cleanup export is rejected before the original is loaded", async () => {
  const prepare = closedPrepare(null);
  const response = await handleRemoveCleanupExport(new Request("http://127.0.0.1/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: ROOM }),
  }), prepare);
  assert.equal(response.status, 403);
  assert.equal((await response.json() as { reason: string }).reason, "Sign in required.");
  assert.equal(prepare.calls.store, 0);
  assert.equal(prepare.calls.service, 0);
  assert.equal(prepare.calls.original, 0);

  const bytes = await png(30, 20);
  let loaded = 0;
  const foreign = await handleRemoveCleanupExport(cleanupRequest(bytes), {
    ...ownedDeps(bytes, 30, 20, OWNER),
    getAdmin: async () => ({ id: ADMIN }),
    loadOriginal: async () => {
      loaded += 1;
      throw new Error("foreign original");
    },
  });
  assert.equal(foreign.status, 404);
  assert.equal(loaded, 0);
});

test("cleanup controls mount and poll only after a confirmed admin-access response", async () => {
  const deniedPayloads: unknown[] = [
    null,
    [],
    {},
    { isAdmin: false },
    { isAdmin: "true" },
    { isAdmin: 1 },
    { admin: true },
  ];
  for (const payload of deniedPayloads) assert.equal(cleanupAdminAccessConfirmed(payload), false);
  assert.equal(cleanupAdminAccessConfirmed({ isAdmin: true }), true);
  assert.equal(cleanupAdminAccessConfirmed({ isAdmin: true, email: OWNER_EMAIL }), true);

  const fetches: string[] = [];
  const denied = await readCleanupAdminAccess(async (input) => {
    fetches.push(String(input));
    return new Response("not-json", { status: 200 });
  });
  assert.equal(denied, false);
  assert.deepEqual(fetches, [REMOVE_CLEANUP_ADMIN_ACCESS_PATH]);

  const unavailable = await readCleanupAdminAccess(async () => new Response(JSON.stringify({ isAdmin: true }), { status: 503 }));
  assert.equal(unavailable, false);
  const thrown = await readCleanupAdminAccess(async () => {
    throw new Error("offline");
  });
  assert.equal(thrown, false);
  const confirmed = await readCleanupAdminAccess(async () => Response.json({ isAdmin: true }));
  assert.equal(confirmed, true);

  let mounted = 0;
  const polls: string[] = [];
  function PollProbe() {
    mounted += 1;
    polls.push("/api/vibode/admin/remove-cleanup-jobs?roomId=probe");
    return createElement("div", { "data-remove-cleanup-generation": "panel" });
  }
  const hidden = renderToStaticMarkup(createElement(
    RemoveCleanupAdminGate,
    { confirmed: denied },
    createElement(PollProbe),
  ));
  assert.equal(hidden, "");
  assert.equal(mounted, 0);
  assert.deepEqual(polls, []);
  const shown = renderToStaticMarkup(createElement(
    RemoveCleanupAdminGate,
    { confirmed },
    createElement(PollProbe),
  ));
  assert.match(shown, /data-remove-cleanup-generation="panel"/);
  assert.equal(mounted, 1);
  assert.deepEqual(polls, ["/api/vibode/admin/remove-cleanup-jobs?roomId=probe"]);

  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const generation = source("components/stage/RemoveCleanupGeneration.tsx");
  assert.match(session, /readCleanupAdminAccess\(\)/);
  assert.match(session, /setCleanupAdmin\(confirmed === true\)/);
  assert.match(session, /<RemoveCleanupAdminGate confirmed=\{session\.cleanupAdmin\}>/);
  assert.doesNotMatch(session, /VIBODE_ADMIN_EMAIL|isAdminEmail|getAuthenticatedAdminUser/);
  const withoutGate = session.replace(/<RemoveCleanupAdminGate[\s\S]*?<\/RemoveCleanupAdminGate>/, "");
  assert.equal(withoutGate.includes("<RemoveCleanupGeneration"), false);
  assert.equal(withoutGate.includes('data-remove-cleanup="export"'), false);
  assert.match(withoutGate, /aria-label="Remove"/);
  assert.match(withoutGate, /Hide All/);
  assert.match(withoutGate, /Show All/);
  assert.match(withoutGate, /data-remove-objects="done"/);
  assert.match(withoutGate, /"Done"/);
  assert.match(withoutGate, />\s*Brush\s*</);
  assert.match(withoutGate, />\s*Objects\s*</);
  const roomPoll = generation.slice(
    generation.indexOf("useEffect(() => {"),
    generation.indexOf("}, [roomId, generationId]);"),
  );
  assert.match(roomPoll, /loadRoomJob/);
  assert.match(generation, /remove-cleanup-jobs\?roomId/);
});

test("the worker denies a queued non-admin before contact and does not retry it", async () => {
  const prepared = await preparedSnapshot();
  await withAdminEmail(ADMIN_EMAIL, async () => {
    const box = memoryControl();
    const queued = await enqueuePreparedCleanupJob(box.runtime, prepared, {
      userId: ADMIN,
      roomUserId: ADMIN,
      currentGenerationId: GENERATION,
    });
    assert.equal(queued.ok, true);
    const events: string[] = [];
    const denied = await executeCleanupClaim({
      control: {
        ...box.runtime,
        contact: async () => {
          events.push("contact");
          throw new Error("provider contact");
        },
      },
      authorizeClaim: (claim) => authorizeCleanupWorkerClaim(async (userId) => {
        events.push(`authorize:${userId}`);
        return { data: { user: { email: OWNER_EMAIL } }, error: null };
      }, claim.userId),
      heartbeatIntervalMs: 60_000,
      generate: async () => {
        events.push("generate");
        throw new Error("Gemini contacted");
      },
    });
    assert.equal(denied.outcome, "failed");
    assert.equal(denied.code, "unauthorized");
    assert.equal(denied.posts, 0);
    assert.deepEqual(events, [`authorize:${ADMIN}`]);
    const job = box.runtime.database.jobs[0];
    assert.equal(job?.status, "failed");
    assert.equal(job?.failureCode, "unauthorized");
    assert.equal(job?.providerStartedAtMs, null);
    assert.equal(job?.failureMessage?.includes(OWNER_EMAIL), false);
    const again = await executeCleanupClaim({
      control: box.runtime,
      authorizeClaim: async () => {
        events.push("authorize-again");
        return true;
      },
      heartbeatIntervalMs: 60_000,
      generate: async () => {
        events.push("generate");
        throw new Error("Gemini contacted");
      },
    });
    assert.equal(again.outcome, "idle");
    assert.deepEqual(events, [`authorize:${ADMIN}`]);
  });
});

test("missing admin configuration, missing users, and lookup errors fail closed before Gemini", async () => {
  const prepared = await preparedSnapshot();
  const cases: Array<readonly [string, string | undefined, CleanupWorkerUserLookup]> = [
    ["missing-config", undefined, async () => {
      throw new Error("lookup");
    }],
    ["lookup-error", ADMIN_EMAIL, async () => {
      throw new Error("auth unavailable");
    }],
    ["missing-user", ADMIN_EMAIL, async () => ({ data: { user: null }, error: { message: "missing" } })],
    ["blank-email", ADMIN_EMAIL, async () => ({ data: { user: { email: "  " } }, error: null })],
  ];
  for (const [label, email, lookup] of cases) {
    await withAdminEmail(email, async () => {
      assert.equal(await authorizeCleanupWorkerClaim(lookup, ADMIN), false, label);
      const box = memoryControl();
      const queued = await enqueuePreparedCleanupJob(box.runtime, prepared, {
        userId: ADMIN,
        roomUserId: ADMIN,
        currentGenerationId: GENERATION,
      });
      assert.equal(queued.ok, true, label);
      const events: string[] = [];
      const result = await executeCleanupClaim({
        control: {
          ...box.runtime,
          contact: async () => {
            events.push("contact");
            throw new Error("provider contact");
          },
        },
        authorizeClaim: (claim) => authorizeCleanupWorkerClaim(lookup, claim.userId),
        heartbeatIntervalMs: 60_000,
        generate: async () => {
          events.push("generate");
          throw new Error("Gemini contacted");
        },
      });
      assert.equal(result.code, "unauthorized", label);
      assert.deepEqual(events, [], label);
      assert.equal(box.runtime.database.jobs[0]?.providerStartedAtMs, null, label);
      assert.equal(box.runtime.database.jobs[0]?.status, "failed", label);
    });
  }
});

test("an authorized administrator is checked before provider contact and Gemini", async () => {
  const prepared = await preparedSnapshot();
  await withAdminEmail(ADMIN_EMAIL, async () => {
    const box = memoryControl();
    const queued = await enqueuePreparedCleanupJob(box.runtime, prepared, {
      userId: OWNER,
      roomUserId: OWNER,
      currentGenerationId: GENERATION,
    });
    assert.equal(queued.ok, true);
    const order: string[] = [];
    const result = await executeCleanupClaim({
      control: {
        ...box.runtime,
        contact: async (jobId: string, nonce: string) => {
          order.push("contact");
          return box.runtime.contact(jobId, nonce);
        },
      },
      authorizeClaim: (claim) => {
        order.push("authorize");
        return authorizeCleanupWorkerClaim(async (userId) => {
          assert.equal(userId, OWNER);
          return { data: { user: { email: "Admin@Example.com" } }, error: null };
        }, claim.userId);
      },
      heartbeatIntervalMs: 60_000,
      generate: async () => {
        order.push("generate");
        return providerFailure();
      },
    });
    assert.deepEqual(order, ["authorize", "contact", "generate"]);
    assert.equal(result.outcome, "failed");
    assert.equal(result.code, "refused");
    assert.equal(box.runtime.database.jobs[0]?.providerStartedAtMs == null, false);
    const executeSource = source("lib/vibode-stage/remove-cleanup-jobs/execute.ts");
    const worker = source("cleanup-worker/src/index.ts");
    const authAt = executeSource.indexOf("cleanupClaimAuthorized");
    const contactAt = executeSource.indexOf("input.control.contact");
    const generateAt = executeSource.indexOf("await generate(");
    assert.ok(authAt > 0 && authAt < contactAt && contactAt < generateAt);
    assert.match(worker, /authorizeCleanupWorkerClaim/);
    assert.match(source("lib/vibode-stage/remove-cleanup-jobs/worker-auth.ts"), /isAdminEmail/);
  });
});

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

function emptyPng(width: number, height: number): Uint8Array {
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

test("instant REMOVE stays available to an authenticated owner without administrator email", async () => {
  const empty = emptyPng(32, 32);
  const original = Uint8Array.from([9, 9, 9, 9]);
  const originalSha = sha256Hex(original);
  const emptySha = sha256Hex(empty);
  const identity = (sha256: string, byteCount: number) => ({
    sha256,
    byteCount,
    decodedWidth: 32,
    decodedHeight: 32,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  });
  const generation = {
    id: GENERATION,
    roomId: ROOM,
    userId: OWNER,
    status: "ready",
    original: identity(originalSha, original.byteLength),
    empty: identity(emptySha, empty.byteLength),
    emptyArtifactSource: "durable",
    emptyStoragePath: "secret/empty-object",
    frame: { width: 32, height: 32 },
    productionAuthority: {
      status: "ready",
      generationId: GENERATION,
      frame: { width: 32, height: 32 },
      frozenCamera: { frame: { width: 32, height: 32 } },
    },
    artifactLineage: null,
  } as AfcGenerationRecord;
  const room: AfcRoomPointer = {
    id: ROOM,
    userId: OWNER,
    currentAfcGenerationId: GENERATION,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  };
  const request = new Request("http://127.0.0.1/api/vibode/admin/remove-objects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: ROOM, generationId: GENERATION }),
  });
  await withAdminEmail(undefined, async () => {
    let anonymousSegments = 0;
    const anonymousDeps: RemoveObjectsAdminDeps = {
      getAdmin: async () => null,
      createStore: () => { throw new Error("store"); },
      createService: () => { throw new Error("service"); },
      loadOriginal: async () => { throw new Error("original"); },
      reserveSegmentation: async () => { throw new Error("reservation"); },
      provider: {
        id: "roboflow",
        modelId: "sam3/sam3_final",
        segment: async () => {
          anonymousSegments += 1;
          throw new Error("Roboflow contacted");
        },
      },
    };
    const anonymous = await handleRemoveObjectsAdmin(request.clone(), anonymousDeps);
    assert.equal(anonymous.status, 403);
    assert.equal(anonymousSegments, 0);
    assert.equal(isAdminEmail(OWNER_EMAIL), false);

    let reserves = 0;
    let segments = 0;
    const ownerDeps: RemoveObjectsAdminDeps = {
      getAdmin: async () => ({ id: OWNER }),
      createStore: () => ({
        async getRoom() { return room; },
        async getGeneration() { return generation; },
        async getArtifact() { return empty; },
      }),
      createService: () => ({ service: true }),
      loadOriginal: async () => ({ ok: true, bytes: original }),
      reserveSegmentation: async (input) => {
        reserves += 1;
        assert.equal(input.userId, OWNER);
        return { ok: true };
      },
      provider: {
        id: "roboflow",
        modelId: "sam3/sam3_final",
        segment: async () => {
          segments += 1;
          return { ok: false, error: "provider_http", providerStatus: 599 };
        },
      },
    };
    const owner = await handleRemoveObjectsAdmin(request.clone(), ownerDeps);
    assert.equal(owner.status, 502);
    assert.equal(reserves, 1);
    assert.equal(segments, 1);
  });
});
