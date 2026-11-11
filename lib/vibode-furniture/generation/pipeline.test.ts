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
  getFurnitureGenerationOperator,
  postFurnitureGeneration,
  postFurnitureGenerationAllowance,
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
import { betaFrontPhotoBytesAllowed, FIRST_GENERATION_JPEG_MAX_BYTES, imagesFitGenerationTransport } from "./transport";

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

async function allowOne(ctx: { commands: { grantPaidSubmission(acknowledge: boolean): Promise<{ ok: boolean }> } }) {
  const granted = await ctx.commands.grantPaidSubmission(true);
  assert.equal(granted.ok, true);
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
  await allowOne(ctx);
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
  const previewAgain = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    ctx.deps,
    createdBody.job.jobId,
  );
  assert.equal(previewAgain.status, 200);
  const stored = ctx.db.jobs[0];
  assert.ok(stored);
  const checksum = stored.outputSha256;
  const byteSize = stored.outputByteSize;
  const expiresAt = stored.outputExpiresAtMs;
  stored.outputExpiresAtMs = ctx.clock.nowMs - 1;
  const expired = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    ctx.deps,
    createdBody.job.jobId,
  );
  assert.equal(expired.status, 404);
  assert.equal(stored.status, "ready");
  assert.equal(stored.outputSha256, checksum);
  assert.equal(stored.outputByteSize, byteSize);
  stored.outputExpiresAtMs = expiresAt;
  const stranger = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    asCaller(ctx.deps, USER_B, "admin@example.com"),
    createdBody.job.jobId,
  );
  assert.equal(stranger.status, 404);

  const next = await postFurnitureGeneration(request("idem-key-0002", bytes), ctx.deps);
  assert.equal(next.status, 200);
  assert.equal((next.body as { created: boolean }).created, true);
  assert.equal(ctx.db.jobs[0]?.status, "ready");
  assert.equal(ctx.db.controls.creditsConsumed, 20);
  assert.equal(provider.posts(), 1);

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
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
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
  await allowOne(failed);
  await postFurnitureGeneration(request("idem-key-0001", await png()), failed.deps);
  const failure = scripted([
    response(202, { result: TASK_ID }),
    response(200, { id: TASK_ID, status: "FAILED", progress: 0, consumed_credits: 0, task_error: { type: "failed", code: "no_mesh" } }),
  ]);
  assert.equal((await runPass(failed, failure, okGlb)).action, "submitted");
  assert.equal((await runPass(failed, failure, okGlb)).action, "failed");
  assert.equal(failed.db.jobs[0]?.status, "failed");
  assert.equal(failed.db.controls.creditsReserved, 0);
  assert.equal(failed.db.controls.creditsConsumed, 0);
  assert.equal(failed.db.controls.paidSubmissionsUsed, 1);

  const oversized = harness();
  await allowOne(oversized);
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
  assert.equal(oversized.db.jobs[0]?.providerStatus, "SUCCEEDED");
  assert.equal(oversized.db.jobs[0]?.consumedCredits, 20);
  assert.equal(oversized.db.controls.creditsConsumed, 20);
  assert.equal(oversized.db.controls.paidSubmissionsUsed, 1);
  const oversizedJobId = oversized.db.jobs[0]?.jobId ?? "";
  const operator = await getFurnitureGenerationOperator(
    new Request("https://vibode.local/operator"),
    oversized.deps,
    oversizedJobId,
  );
  const operatorText = JSON.stringify(operator.body);
  assert.equal(operator.status, 200);
  assert.equal((operator.body as { job: { providerStatus: string; consumedCredits: number; errorClass: string } }).job.providerStatus, "SUCCEEDED");
  assert.equal((operator.body as { job: { consumedCredits: number } }).job.consumedCredits, 20);
  assert.equal((operator.body as { job: { errorClass: string } }).job.errorClass, "oversized_output");
  assert.equal(operatorText.includes(TASK_ID) || operatorText.includes("http") || operatorText.includes("data:image"), false);
  const ownerOperator = await getFurnitureGenerationOperator(
    new Request("https://vibode.local/operator"),
    asCaller(oversized.deps, USER_A, "person@example.com"),
    oversizedJobId,
  );
  assert.equal(ownerOperator.status, 401);

  const compressed = harness();
  await allowOne(compressed);
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
  assert.equal(compressed.db.jobs[0]?.providerStatus, "SUCCEEDED");
  assert.equal(compressed.db.jobs[0]?.consumedCredits, 20);
  assert.equal(compressed.db.jobs[0]?.status, "failed");
  assert.equal(compressed.db.controls.paidSubmissionsUsed, 1);
});

test("an ambiguous create stays held after administrator recovery", async () => {
  const ctx = harness();
  await allowOne(ctx);
  const bytes = await png();
  const created = await postFurnitureGeneration(request("idem-key-0001", bytes), ctx.deps);
  const jobId = (created.body as { job: { jobId: string } }).job.jobId;
  const provider = scripted([
    { kind: "timeout" },
    response(200, []),
    response(200, []),
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
  const blocked = await runPass(ctx, provider, okGlb);
  assert.equal(blocked.action, "submission_not_authorized");
  assert.equal(provider.posts(), 1);
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
  assert.equal(ctx.db.jobs[0]?.status, "reserved");
  const closed = await ctx.commands.grantPaidSubmission(true);
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.code, "allowance_closed");
});

test("a second worker cannot post while a submit claim is outstanding", async () => {
  const ctx = harness();
  await allowOne(ctx);
  await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  const first = await ctx.commands.claimNext(true, ctx.clock.nowMs);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.outcome, "claimed");
  const provider = scripted([response(202, { result: TASK_ID })]);
  const blocked = await runPass(ctx, provider, okGlb);
  assert.equal(blocked.action, "idle");
  assert.equal(provider.posts(), 0);
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
  const job = ctx.db.jobs[0];
  assert.ok(job);
  job.claimExpiresAtMs = ctx.clock.nowMs - 1;
  const recovered = await runPass(ctx, scripted([response(200, [])]), okGlb);
  assert.equal(recovered.action, "waiting");
  assert.equal(ctx.db.jobs[0]?.status, "ambiguous");
  assert.equal(provider.posts(), 0);
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
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
  await allowOne(ctx);
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

test("the paid allowance starts at zero and is not replenished", async () => {
  const blocked = harness();
  await postFurnitureGeneration(request("idem-key-0001", await png()), blocked.deps);
  const none = scripted([response(202, { result: TASK_ID })]);
  assert.equal((await runPass(blocked, none, okGlb)).action, "submission_not_authorized");
  assert.equal(none.posts(), 0);
  assert.equal(blocked.db.jobs[0]?.attemptCount, 0);
  assert.equal(blocked.db.controls.paidSubmissionsUsed, 0);

  const refused = harness();
  await allowOne(refused);
  await postFurnitureGeneration(request("idem-key-0001", await png()), refused.deps);
  const payment = scripted([response(402, { message: "Payment Required" })]);
  assert.equal((await runPass(refused, payment, okGlb)).action, "failed");
  assert.equal(payment.posts(), 1);
  assert.equal(refused.db.controls.paidSubmissionsUsed, 1);
  assert.equal(refused.db.controls.creditsConsumed, 0);
  const next = await postFurnitureGeneration(request("idem-key-0002", await png()), refused.deps);
  assert.equal(next.status, 200);
  const second = scripted([response(202, { result: "018a210d-8ba4-705c-b111-1f1776f7f580" })]);
  assert.equal((await runPass(refused, second, okGlb)).action, "submission_not_authorized");
  assert.equal(second.posts(), 0);
  assert.equal(refused.db.controls.paidSubmissionsUsed, 1);

  const limited = harness();
  await allowOne(limited);
  await postFurnitureGeneration(request("idem-key-0001", await png()), limited.deps);
  const rate = scripted([response(429, { message: "Too Many Requests" })]);
  assert.equal((await runPass(limited, rate, okGlb)).action, "rate_limited");
  assert.equal(rate.posts(), 1);
  assert.equal(limited.db.controls.paidSubmissionsAuthorized, 1);
  assert.equal(limited.db.controls.paidSubmissionsUsed, 1);
  assert.equal(limited.db.controls.creditsReserved, 0);
  assert.equal(limited.db.controls.creditsConsumed, 0);
  assert.equal(limited.db.jobs[0]?.status, "failed");
  assert.equal(limited.db.jobs[0]?.errorClass, "rate_limited");
  assert.equal(limited.db.jobs[0]?.providerTaskId, null);
  assert.equal(limited.db.jobs[0]?.consumedCredits, 0);
  assert.equal(limited.db.jobs[0]?.attemptCount, 1);
  for (let pass = 0; pass < 3; pass += 1) {
    const repeat = scripted([response(202, { result: TASK_ID })]);
    assert.equal((await runPass(limited, repeat, okGlb)).action, "idle");
    assert.equal(repeat.posts(), 0);
  }
  const restarted = {
    ...limited,
    commands: createMemoryGenerationCommands(limited.db, limited.clock),
  };
  const afterRestart = scripted([response(202, { result: TASK_ID })]);
  assert.equal((await runPass(restarted, afterRestart, okGlb)).action, "idle");
  assert.equal(afterRestart.posts(), 0);
  assert.equal(limited.db.controls.paidSubmissionsUsed, 1);
  const another = await postFurnitureGeneration(request("idem-key-0002", await png()), limited.deps);
  assert.equal(another.status, 200);
  const blockedRetry = scripted([response(202, { result: "018a210d-8ba4-705c-b111-1f1776f7f580" })]);
  assert.equal((await runPass(limited, blockedRetry, okGlb)).action, "submission_not_authorized");
  assert.equal(blockedRetry.posts(), 0);
  assert.equal(limited.db.controls.paidSubmissionsUsed, 1);
});

test("an owner cannot grant a paid submission and a restart does not replenish it", async () => {
  const ctx = harness();
  const owner = await postFurnitureGenerationAllowance(
    new Request("https://vibode.local/allowance", {
      method: "POST",
      body: JSON.stringify({ paidSubmissionAuthorized: true }),
    }),
    asCaller(ctx.deps, USER_A, "person@example.com"),
  );
  assert.equal(owner.status, 401);
  const missing = await postFurnitureGenerationAllowance(
    new Request("https://vibode.local/allowance", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    ctx.deps,
  );
  assert.equal(missing.status, 409);
  const duplicate = await postFurnitureGenerationAllowance(
    new Request("https://vibode.local/allowance", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
    }),
    ctx.deps,
  );
  assert.equal(duplicate.status, 400);
  assert.equal(ctx.db.controls.paidSubmissionsAuthorized, 0);
  const granted = await postFurnitureGenerationAllowance(
    new Request("https://vibode.local/allowance", {
      method: "POST",
      body: JSON.stringify({ paidSubmissionAuthorized: true }),
    }),
    ctx.deps,
  );
  assert.equal(granted.status, 200);
  assert.equal((granted.body as { maxEstimatedCredits: number }).maxEstimatedCredits, 40);
  const again = await postFurnitureGenerationAllowance(
    new Request("https://vibode.local/allowance", {
      method: "POST",
      body: JSON.stringify({ paidSubmissionAuthorized: true }),
    }),
    ctx.deps,
  );
  assert.equal(again.status, 409);
  await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  const provider = scripted([response(202, { result: TASK_ID }), succeededTask(20)]);
  await runPass(ctx, provider, okGlb);
  await runPass(ctx, provider, okGlb);
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
  const discarded = await postFurnitureGenerationDiscard(
    new Request("https://vibode.local/discard", { method: "POST", body: "{}" }),
    ctx.deps,
    ctx.db.jobs[0]?.jobId ?? "",
  );
  assert.equal(discarded.status, 200);
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
  const restarted = scripted([response(202, { result: "018a210d-8ba4-705c-b111-1f1776f7f580" })]);
  const created = await postFurnitureGeneration(request("idem-key-0002", await png()), ctx.deps);
  assert.equal(created.status, 200);
  assert.equal((await runPass(ctx, restarted, okGlb)).action, "submission_not_authorized");
  assert.equal(restarted.posts(), 0);
  assert.equal(ctx.db.controls.paidSubmissionsUsed, 1);
});

test("quota blocks another reservation after the budget is consumed", async () => {
  const ctx = harness();
  ctx.db.controls.creditsConsumed = 30;
  const result = await postFurnitureGeneration(request("idem-key-0001", await png()), ctx.deps);
  assert.equal(result.status, 409);
  assert.equal(ctx.db.jobs.length, 0);
});

test("a photo over 3 MB is refused before a reservation", async () => {
  const bytes = await jpegJustOverBetaLimit();
  assert.equal(betaFrontPhotoBytesAllowed(bytes.byteLength), false);
  assert.equal(imagesFitGenerationTransport([bytes.byteLength]), true);
  const ctx = harness();
  await allowOne(ctx);
  const result = await postFurnitureGeneration(
    request("idem-key-oversize", bytes, defaultFurnitureGeneratorSettings()),
    ctx.deps,
  );
  assert.equal(result.status, 400);
  assert.equal((result.body as { error: string }).error, "The photo is too large to send.");
  assert.equal(ctx.db.jobs.length, 0);
  assert.equal(ctx.db.controls.creditsReserved, 0);
});

async function jpegJustOverBetaLimit(): Promise<Uint8Array> {
  const jpeg = new Uint8Array(await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 80, b: 120 } },
  }).jpeg().toBuffer());
  const target = FIRST_GENERATION_JPEG_MAX_BYTES + 1024;
  const chunks: Uint8Array[] = [jpeg.subarray(0, 2)];
  let size = jpeg.byteLength;
  while (size < target) {
    const need = Math.min(65533, target - size - 4);
    const marker = new Uint8Array(4 + need);
    marker[0] = 0xff;
    marker[1] = 0xfe;
    const length = need + 2;
    marker[2] = (length >> 8) & 0xff;
    marker[3] = length & 0xff;
    chunks.push(marker);
    size += marker.byteLength;
  }
  chunks.push(jpeg.subarray(2));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

test("routes keep recovery separate and the worker cannot post", () => {
  const root = process.cwd();
  const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
  const panel = read("components/stage/FurnitureGeneratorPanel.tsx");
  assert.match(panel, /data-generate="unavailable"/);
  assert.doesNotMatch(panel, /paidSubmissionAuthorized|grantPaidSubmission/);
  const discard = read("app/api/vibode/furniture-generations/[jobId]/discard/route.ts");
  assert.doesNotMatch(discard, /duplicateChargeRisk|adminAuthorize|recover|paidSubmissionAuthorized/);
  const create = read("app/api/vibode/furniture-generations/route.ts");
  assert.match(create, /export const maxDuration = 60;/);
  const allowance = read("app/api/vibode/admin/furniture-generations/allowance/route.ts");
  assert.match(allowance, /postFurnitureGenerationAllowance/);
  const recover = read("app/api/vibode/admin/furniture-generations/[jobId]/recover/route.ts");
  assert.match(recover, /postFurnitureGenerationRecovery/);
  const production = read("lib/vibode-furniture/generation/production.server.ts");
  assert.match(production, /auth\.getUser\(/);
  assert.match(production, /isAdminEmail/);
  assert.doesNotMatch(production, /MESHY_API_KEY|api\.meshy\.ai/);
  const worker = read("furniture-generation-worker/src/index.ts");
  const providerMode = read("furniture-generation-worker/src/provider.ts");
  assert.match(worker, /submitAllowed: runtime.runtime.submitAllowed/);
  assert.doesNotMatch(worker, /MESHY_API_KEY|api\.meshy\.ai|msy_/);
  assert.match(providerMode, /mode: "fake",\s*submitAllowed: false/);
  assert.match(providerMode, /selected === "" \|\| selected === "fake"/);
  for (const path of [
    "lib/vibode-furniture/generation/pipeline.ts",
    "lib/vibode-furniture/generation/http.ts",
    "lib/vibode-furniture/generation/sql-commands.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /api\.meshy\.ai|MESHY_API_KEY/);
  }
  assert.equal(GENERATION_INPUT_BUCKET.includes("generation-inputs"), true);
  const onePost = read("supabase/migrations/20261107231500_vibode_furniture_generation_one_post.sql");
  assert.match(onePost, /status = 'failed'/);
  assert.match(onePost, /error_class = 'rate_limited'/);
  assert.doesNotMatch(onePost, /paid_submissions_used\s*=/);
  const memory = read("lib/vibode-furniture/generation/memory-commands.ts");
  assert.doesNotMatch(memory, /paidSubmissionsUsed - 1/);
});
