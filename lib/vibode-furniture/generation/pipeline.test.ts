/**
 * MESHY-1C.2A dry run. The provider transport is scripted. No test calls Meshy.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

import { encodeGlb } from "@/lib/afc-v2-runtime/glb-binary";
import { encodeUntexturedFurnitureProbeGlb } from "@/lib/afc-v2-runtime/textured-furniture-probe-glb";
import { PERSONAL_FURNITURE_BUCKET, PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

import type { GenerationHttpDeps } from "./http";
import {
  getFurnitureGeneration,
  postFurnitureGeneration,
  postFurnitureGenerationDiscard,
  postFurnitureGenerationPreview,
  postFurnitureGenerationRecovery,
} from "./http";
import { createMemoryGenerationCommands } from "./memory-commands";
import { createMeshyAdapter } from "./meshy-adapter";
import type { MeshyTransport, MeshyTransportCall, MeshyTransportResult } from "./meshy-task";
import { createMemoryBucketStore } from "./objects";
import { cleanupTemporaryGenerationObjects, executeFurnitureGenerationClaim } from "./pipeline";
import { createGenerationDatabase } from "./engine";
import { GENERATION_INPUT_BUCKET } from "./policy";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "018a210d-8ba4-705c-b111-1f1776f7f578";
const GLB_URL = `https://assets.meshy.ai/tasks/${TASK_ID}/model.glb?Expires=9999999999`;

function meshSettings() {
  return { ...defaultFurnitureGeneratorSettings(), shouldTexture: false };
}

async function png(width = 48, height = 48): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } },
  }).png().toBuffer());
}

function harness(options?: { live?: boolean; env?: string }) {
  const db = createGenerationDatabase();
  db.controls.liveEnabled = options?.live ?? true;
  const clock = { nowMs: 1_700_000_000_000 };
  let sequence = 0;
  const commands = createMemoryGenerationCommands(db, clock);
  const objects = createMemoryBucketStore();
  const deps: GenerationHttpDeps = {
    authorize: async () => ({ ok: true, userId: USER_A, email: "admin@example.com" }),
    commands,
    objects,
    env: { VIBODE_MESHY_GENERATION_ENABLED: options?.env ?? "true" },
    isAdmin: (email) => email === "admin@example.com",
    nowMs: () => clock.nowMs,
    newJobId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence++).padStart(12, "a")}`,
  };
  return { db, clock, commands, objects, deps };
}

function asCaller(deps: GenerationHttpDeps, userId: string, email: string): GenerationHttpDeps {
  return { ...deps, authorize: async () => ({ ok: true, userId, email }) };
}

function request(key: string, bytes: Uint8Array, settings = meshSettings(), slot = "front") {
  return new Request("https://vibode.local/generation", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: key,
      settings,
      images: [{ slot, base64: Buffer.from(bytes).toString("base64") }],
    }),
  });
}

function scripted(results: readonly MeshyTransportResult[]) {
  const calls: MeshyTransportCall[] = [];
  const transport: MeshyTransport = {
    async request(call) {
      calls.push(call);
      const next = results[calls.length - 1];
      if (!next) throw new Error("unexpected_provider_call");
      return next;
    },
  };
  return {
    adapter: createMeshyAdapter(transport),
    calls,
    posts: () => calls.filter((call) => call.method === "POST").length,
  };
}

const response = (status: number, body: unknown, unparsed = false): MeshyTransportResult => ({
  kind: "response",
  status,
  headers: {},
  body,
  unparsed,
});

function succeededTask(credits: number) {
  return response(200, {
    id: TASK_ID,
    status: "SUCCEEDED",
    progress: 100,
    consumed_credits: credits,
    expires_at: 1_800_000_000_000,
    model_urls: { glb: GLB_URL },
  });
}

async function runPass(
  ctx: ReturnType<typeof harness>,
  provider: ReturnType<typeof scripted>,
  download: () => Promise<Awaited<ReturnType<typeof okGlb>>>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live_fetch_refused");
  };
  try {
    return await executeFurnitureGenerationClaim({
      commands: ctx.commands,
      objects: ctx.objects,
      adapter: provider.adapter,
      download,
      validate: validatePersonalFurnitureGlb,
      nowMs: ctx.clock.nowMs,
      submitAllowed: true,
    });
  } finally {
    globalThis.fetch = previous;
  }
}

async function okGlb() {
  return {
    kind: "ok" as const,
    status: 200,
    body: encodeUntexturedFurnitureProbeGlb(),
    contentLength: encodeUntexturedFurnitureProbeGlb().byteLength,
  };
}

test("disabled and unauthorized callers do not create a job", async () => {
  const off = harness({ live: false, env: undefined });
  const disabled = await postFurnitureGeneration(request("idem-key-0001", await png()), off.deps);
  assert.equal(disabled.status, 403);
  assert.equal(off.db.jobs.length, 0);

  const closed = harness({ live: true, env: "TRUE" });
  const stillOff = await postFurnitureGeneration(request("idem-key-0001", await png()), closed.deps);
  assert.equal(stillOff.status, 403);
  assert.equal(closed.db.jobs.length, 0);

  const live = harness();
  const stranger = await postFurnitureGeneration(
    request("idem-key-0001", await png()),
    asCaller(live.deps, USER_B, "person@example.com"),
  );
  assert.equal(stranger.status, 401);
  assert.equal(live.db.jobs.length, 0);
});

test("invalid photos and settings are rejected before reservation", async () => {
  const ctx = harness();
  const tiny = await postFurnitureGeneration(request("idem-key-0001", await png(8, 48)), ctx.deps);
  assert.equal(tiny.status, 400);
  const bad = await postFurnitureGeneration(
    request("idem-key-0002", await png(), {
      ...defaultFurnitureGeneratorSettings(),
      textureModel: "meshy-n1",
      textureResolution: "4k",
    }),
    ctx.deps,
  );
  assert.equal(bad.status, 400);
  const owned = await postFurnitureGeneration(
    new Request("https://vibode.local/generation", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "idem-key-0003",
        userId: USER_B,
        reservedCredits: 1,
        settings: meshSettings(),
        images: [{ slot: "front", base64: Buffer.from(await png()).toString("base64") }],
      }),
    }),
    ctx.deps,
  );
  assert.equal(owned.status, 400);
  assert.equal(ctx.db.jobs.length, 0);
});

test("a single image reaches a private preview without a second post", async () => {
  const ctx = harness();
  const bytes = await png();
  const created = await postFurnitureGeneration(request("idem-key-0001", bytes), ctx.deps);
  assert.equal(created.status, 200);
  const createdBody = created.body as { created: boolean; job: { jobId: string; status: string } };
  assert.equal(createdBody.created, true);
  assert.equal(createdBody.job.status, "reserved");
  const replay = await postFurnitureGeneration(request("idem-key-0001", bytes), ctx.deps);
  assert.equal((replay.body as { created: boolean }).created, false);
  assert.equal(ctx.db.jobs.length, 1);
  const conflict = await postFurnitureGeneration(request("idem-key-0001", await png(64, 64)), ctx.deps);
  assert.equal(conflict.status, 409);

  const provider = scripted([response(202, { result: TASK_ID }), succeededTask(20)]);
  const submitted = await runPass(ctx, provider, okGlb);
  assert.equal(submitted.action, "submitted");
  assert.equal(provider.posts(), 1);
  const ready = await runPass(ctx, provider, okGlb);
  assert.equal(ready.action, "ready");
  assert.equal(provider.posts(), 1);
  assert.equal(ctx.db.controls.creditsConsumed, 20);

  const status = await getFurnitureGeneration(
    new Request("https://vibode.local/generation"),
    ctx.deps,
    createdBody.job.jobId,
  );
  const statusText = JSON.stringify(status.body);
  assert.equal(status.status, 200);
  assert.equal(statusText.includes("provider_task") || statusText.includes(TASK_ID), false);
  assert.equal(statusText.includes("http"), false);
  assert.equal(statusText.includes("signed:"), false);

  const preview = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    ctx.deps,
    createdBody.job.jobId,
  );
  assert.equal(preview.status, 200);
  assert.match((preview.body as { previewUrl: string }).previewUrl, /^signed:\/\/vibode-private\//);
  const stranger = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    asCaller(ctx.deps, USER_B, "admin@example.com"),
    createdBody.job.jobId,
  );
  assert.equal(stranger.status, 404);

  const blocked = await postFurnitureGeneration(request("idem-key-0002", bytes), ctx.deps);
  assert.equal(blocked.status, 409);

  const discarded = await postFurnitureGenerationDiscard(
    new Request("https://vibode.local/discard", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: true, reservedCredits: 0 }),
    }),
    ctx.deps,
    createdBody.job.jobId,
  );
  assert.equal(discarded.status, 200);
  assert.equal((discarded.body as { providerCreditsRefunded: boolean }).providerCreditsRefunded, false);
  assert.equal(ctx.db.controls.creditsConsumed, 20);
  assert.equal(ctx.db.jobs[0]?.savedAssetId, null);

  const cleaned = await cleanupTemporaryGenerationObjects({
    commands: ctx.commands,
    objects: ctx.objects,
    nowMs: ctx.clock.nowMs,
  });
  assert.equal(cleaned.removed, 1);
  const again = await cleanupTemporaryGenerationObjects({
    commands: ctx.commands,
    objects: ctx.objects,
    nowMs: ctx.clock.nowMs,
  });
  assert.equal(again.removed, 0);
  assert.equal(await ctx.objects.get({
    bucket: PERSONAL_FURNITURE_BUCKET,
    path: `users/${USER_A}/generations/${createdBody.job.jobId}/candidate.glb`,
  }), null);
});

test("provider failure, oversized output, and compressed GLBs free the slot", async () => {
  const failed = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), failed.deps);
  const failure = scripted([
    response(202, { result: TASK_ID }),
    response(200, { id: TASK_ID, status: "FAILED", progress: 0, consumed_credits: 0, task_error: { type: "failed", code: "no_mesh" } }),
  ]);
  assert.equal((await runPass(failed, failure, okGlb)).action, "submitted");
  assert.equal((await runPass(failed, failure, okGlb)).action, "failed");
  assert.equal(failed.db.jobs[0]?.status, "failed");
  assert.equal(failed.db.controls.creditsReserved, 0);

  const oversized = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), oversized.deps);
  const huge = scripted([response(202, { result: TASK_ID }), succeededTask(20)]);
  await runPass(oversized, huge, okGlb);
  await runPass(oversized, huge, async () => ({
    kind: "ok",
    status: 200,
    body: new Uint8Array([1, 2, 3, 4]),
    contentLength: PERSONAL_FURNITURE_GLB_MAX_BYTES + 1,
  }));
  assert.equal(oversized.db.jobs[0]?.status, "failed");
  assert.equal(oversized.db.jobs[0]?.errorClass, "oversized_output");
  assert.equal(oversized.db.controls.creditsConsumed, 20);

  const compressed = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), compressed.deps);
  const draco = scripted([response(202, { result: TASK_ID }), succeededTask(20)]);
  const dracoBytes = encodeGlb({
    asset: { version: "2.0" },
    extensionsRequired: ["KHR_draco_mesh_compression"],
  });
  await runPass(compressed, draco, okGlb);
  await runPass(compressed, draco, async () => ({
    kind: "ok",
    status: 200,
    body: dracoBytes,
    contentLength: dracoBytes.byteLength,
  }));
  assert.equal(compressed.db.jobs[0]?.errorClass, "invalid_output");
  assert.equal(compressed.db.jobs[0]?.status, "failed");
});

test("an ambiguous create is not posted again until an administrator authorizes it", async () => {
  const ctx = harness();
  const bytes = await png();
  const created = await postFurnitureGeneration(request("idem-key-0001", bytes), ctx.deps);
  const jobId = (created.body as { job: { jobId: string } }).job.jobId;
  const provider = scripted([
    { kind: "timeout" },
    response(200, []),
    response(200, []),
    response(202, { result: TASK_ID }),
  ]);
  assert.equal((await runPass(ctx, provider, okGlb)).action, "ambiguous");
  assert.equal((await runPass(ctx, provider, okGlb)).action, "waiting");
  assert.equal(provider.posts(), 1);
  ctx.clock.nowMs += 70_000;
  assert.equal((await runPass(ctx, provider, okGlb)).action, "needs_review");
  assert.equal(provider.posts(), 1);
  const ownerDiscard = await postFurnitureGenerationDiscard(
    new Request("https://vibode.local/discard", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
    }),
    ctx.deps,
    jobId,
  );
  assert.equal(ownerDiscard.status, 409);
  assert.equal(ctx.db.jobs[0]?.status, "needs_review");
  const stranger = await postFurnitureGenerationRecovery(
    new Request("https://vibode.local/recover", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
    }),
    asCaller(ctx.deps, USER_B, "person@example.com"),
    jobId,
  );
  assert.equal(stranger.status, 401);
  const missingFlag = await postFurnitureGenerationRecovery(
    new Request("https://vibode.local/recover", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: false }),
    }),
    ctx.deps,
    jobId,
  );
  assert.equal(missingFlag.status, 409);
  assert.equal(provider.posts(), 1);
  const authorized = await postFurnitureGenerationRecovery(
    new Request("https://vibode.local/recover", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
    }),
    ctx.deps,
    jobId,
  );
  assert.equal(authorized.status, 200);
  assert.equal((authorized.body as { duplicateChargeRisk: boolean }).duplicateChargeRisk, true);
  assert.equal((await runPass(ctx, provider, okGlb)).action, "submitted");
  assert.equal(provider.posts(), 2);
});

test("a second worker cannot post while a submit claim is outstanding", async () => {
  const ctx = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  const first = await ctx.commands.claimNext(true, ctx.clock.nowMs);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.outcome, "claimed");
  const provider = scripted([response(202, { result: TASK_ID })]);
  const blocked = await runPass(ctx, provider, okGlb);
  assert.equal(blocked.action, "idle");
  assert.equal(provider.posts(), 0);
  const job = ctx.db.jobs[0];
  assert.ok(job);
  job.claimExpiresAtMs = ctx.clock.nowMs - 1;
  const recovered = await runPass(ctx, scripted([response(200, [])]), okGlb);
  assert.equal(recovered.action, "waiting");
  assert.equal(ctx.db.jobs[0]?.status, "ambiguous");
  assert.equal(provider.posts(), 0);
});

test("a disabled worker does not submit a reserved job", async () => {
  const ctx = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  const provider = scripted([response(202, { result: TASK_ID })]);
  const held = await executeFurnitureGenerationClaim({
    commands: ctx.commands,
    objects: ctx.objects,
    adapter: provider.adapter,
    download: okGlb,
    validate: validatePersonalFurnitureGlb,
    nowMs: ctx.clock.nowMs,
    submitAllowed: false,
  });
  assert.equal(held.action, "disabled");
  assert.equal(provider.calls.length, 0);
  assert.equal(ctx.db.jobs[0]?.status, "reserved");
});

test("expiry removes the candidate and keeps the consumed credits", async () => {
  const ctx = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  const provider = scripted([response(202, { result: TASK_ID }), succeededTask(20)]);
  await runPass(ctx, provider, okGlb);
  await runPass(ctx, provider, okGlb);
  const input = ctx.db.inputs[0];
  assert.ok(input);
  input.expiresAtMs = ctx.clock.nowMs - 1;
  const inputsRemoved = await cleanupTemporaryGenerationObjects({
    commands: ctx.commands,
    objects: ctx.objects,
    nowMs: ctx.clock.nowMs,
  });
  assert.equal(inputsRemoved.removed, 1);
  assert.equal(ctx.db.jobs[0]?.status, "ready");
  const job = ctx.db.jobs[0];
  assert.ok(job);
  job.outputExpiresAtMs = ctx.clock.nowMs - 1;
  const expired = await cleanupTemporaryGenerationObjects({
    commands: ctx.commands,
    objects: ctx.objects,
    nowMs: ctx.clock.nowMs,
  });
  assert.equal(expired.removed, 1);
  assert.equal(ctx.db.jobs[0]?.status, "expired");
  assert.equal(ctx.db.controls.creditsConsumed, 20);
  const next = await postFurnitureGeneration(request("idem-key-0002", await png()), ctx.deps);
  assert.equal(next.status, 200);
});

test("quota blocks another reservation after the budget is consumed", async () => {
  const ctx = harness();
  ctx.db.controls.creditsConsumed = 30;
  const result = await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  assert.equal(result.status, 409);
  assert.equal(ctx.db.jobs.length, 0);
});

test("routes keep recovery separate and the worker cannot post", () => {
  const root = process.cwd();
  const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
  const panel = read("components/stage/FurnitureGeneratorPanel.tsx");
  assert.match(panel, /data-generate="unavailable"/);
  const discard = read("app/api/vibode/furniture-generations/[jobId]/discard/route.ts");
  assert.doesNotMatch(discard, /duplicateChargeRisk|adminAuthorize|recover/);
  const recover = read("app/api/vibode/admin/furniture-generations/[jobId]/recover/route.ts");
  assert.match(recover, /postFurnitureGenerationRecovery/);
  const production = read("lib/vibode-furniture/generation/production.server.ts");
  assert.match(production, /auth\.getUser\(/);
  assert.match(production, /isAdminEmail/);
  assert.doesNotMatch(production, /MESHY_API_KEY|api\.meshy\.ai/);
  const worker = read("furniture-generation-worker/src/index.ts");
  assert.match(worker, /WORKER_POSTS_ENABLED = false/);
  assert.doesNotMatch(worker, /MESHY_API_KEY|api\.meshy\.ai|msy_/);
  for (const path of [
    "lib/vibode-furniture/generation/pipeline.ts",
    "lib/vibode-furniture/generation/http.ts",
    "lib/vibode-furniture/generation/sql-commands.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /api\.meshy\.ai|MESHY_API_KEY/);
  }
  assert.equal(GENERATION_INPUT_BUCKET.includes("generation-inputs"), true);
});
