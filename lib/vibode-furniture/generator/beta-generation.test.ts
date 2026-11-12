/**
 * Beta tester generation. Fake ledger and local markup. No provider call.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

import { FurnitureGeneratorPanel } from "@/components/stage/FurnitureGeneratorPanel";
import { PERSONAL_FURNITURE_BUCKET } from "@/lib/vibode-furniture/asset-id";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { createGenerationDatabase, type GenerationJob } from "@/lib/vibode-furniture/generation/engine";
import {
  getFurnitureGeneration,
  getFurnitureGenerationAllowance,
  getFurnitureGenerationRecent,
  postFurnitureGeneration,
  postFurnitureGenerationPreview,
  postFurnitureGenerationRecovery,
  type GenerationHttpDeps,
} from "@/lib/vibode-furniture/generation/http";
import { createMemoryGenerationCommands } from "@/lib/vibode-furniture/generation/memory-commands";
import { createMemoryBucketStore } from "@/lib/vibode-furniture/generation/objects";

import {
  canOfferBetaGeneration,
  claimBetaSubmission,
  customerEntitlement,
  customerJobCopy,
  isCertifiedBetaFurnitureSettings,
  mergeRecentGenerationResponse,
  nextPollDelayMs,
  recoverableGenerationsFromPayload,
  shouldApplyGenerationRead,
  shouldRefreshAllowance,
  submissionKeyAfterOutcome,
  submissionKeyAfterRestore,
  type CustomerEntitlement,
  type RecoverableGeneration,
} from "./beta-generation";
import { readBetaGeneration, readRecentBetaGenerations, submitBetaGeneration } from "./beta-generation-client";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("beta entitlement fails closed and does not invent a balance", () => {
  assert.equal(customerEntitlement({
    approved: false,
    enabled: false,
    authorized: 0,
    reserved: 0,
    consumed: 0,
    remaining: 0,
    generationEnabled: true,
    liveEnabled: true,
  }).state, "unapproved");
  assert.equal(customerEntitlement({
    approved: true,
    enabled: false,
    authorized: 3,
    reserved: 0,
    consumed: 0,
    remaining: 3,
    generationEnabled: true,
    liveEnabled: true,
  }).state, "disabled");
  assert.equal(customerEntitlement({
    approved: true,
    enabled: true,
    authorized: 1,
    reserved: 0,
    consumed: 1,
    remaining: 0,
    generationEnabled: true,
    liveEnabled: true,
  }).state, "exhausted");
  const ready = customerEntitlement({
    approved: true,
    enabled: true,
    authorized: 3,
    reserved: 1,
    consumed: 1,
    remaining: 1,
    generationEnabled: true,
    liveEnabled: true,
  });
  assert.equal(ready.canGenerate, true);
  assert.equal(ready.remaining, 1);
  assert.equal(customerEntitlement({
    approved: true,
    enabled: true,
    authorized: 3,
    reserved: 1,
    consumed: 1,
    remaining: 1,
    generationEnabled: false,
    liveEnabled: true,
  }).state, "generation_off");
  assert.equal(customerEntitlement({
    approved: true,
    enabled: true,
    authorized: 3,
    reserved: 0,
    consumed: 0,
    remaining: 3,
    generationEnabled: true,
    liveEnabled: false,
  }).canGenerate, false);
  assert.equal(isCertifiedBetaFurnitureSettings(defaultFurnitureGeneratorSettings()), true);
  assert.equal(isCertifiedBetaFurnitureSettings({
    ...defaultFurnitureGeneratorSettings(),
    shouldTexture: false,
  }), false);
  assert.equal(customerJobCopy({ jobId: JOB, status: "reserved", errorClass: null, progress: 0 }).title, "Preparing your photo");
  assert.equal(customerJobCopy({ jobId: JOB, status: "needs_review", errorClass: "needs_review", progress: 0 }).title, "Awaiting operator review");
  assert.match(customerJobCopy({ jobId: JOB, status: "failed", errorClass: "provider_failed", progress: 0 }).detail, /could not be generated/);
  assert.equal(nextPollDelayMs(2_000), 4_000);
  assert.equal(nextPollDelayMs(8_000), 15_000);
  const first = claimBetaSubmission({ busy: false, key: null }, () => "beta-key-0001");
  assert.equal(first?.key, "beta-key-0001");
  assert.equal(claimBetaSubmission({ busy: true, key: "beta-key-0001" }, () => "beta-key-0002"), null);
  assert.equal(submissionKeyAfterOutcome("beta-key-0001", "uncertain"), "beta-key-0001");
  assert.equal(submissionKeyAfterOutcome("beta-key-0001", "started"), "beta-key-0001");
  assert.equal(submissionKeyAfterOutcome("beta-key-0001", "refused"), null);
  assert.equal(shouldRefreshAllowance("failed"), true);
  assert.equal(shouldRefreshAllowance("needs_review"), false);
  assert.equal(shouldRefreshAllowance("reserved"), false);
});

test("allowance admission is the signed-in tester and ignores an administrator flag", async () => {
  const jpeg = await jpegBytes();
  const missing = harness([]);
  const unapproved = await postFurnitureGeneration(generationRequest("beta-key-0001", jpeg), missing.deps);
  assert.equal(unapproved.status, 409);
  assert.equal(missing.db.jobs.length, 0);

  const disabled = harness([{ userId: USER_A, enabled: false, authorized: 3, reserved: 0, consumed: 0 }]);
  const turnedOff = await postFurnitureGeneration(generationRequest("beta-key-0002", jpeg), disabled.deps);
  assert.equal(turnedOff.status, 409);
  assert.equal(disabled.db.jobs.length, 0);

  const spent = harness([{ userId: USER_A, enabled: true, authorized: 1, reserved: 0, consumed: 1 }]);
  const exhausted = await postFurnitureGeneration(generationRequest("beta-key-0003", jpeg), spent.deps);
  assert.equal(exhausted.status, 409);
  assert.equal(spent.db.jobs.length, 0);

  const closed = harness([{ userId: USER_A, enabled: true, authorized: 2, reserved: 0, consumed: 0 }], { live: false });
  assert.equal((await postFurnitureGeneration(generationRequest("beta-key-0004", jpeg), closed.deps)).status, 403);
  assert.equal(closed.db.allowances?.[0]?.reserved, 0);

  const envOff = harness([{ userId: USER_A, enabled: true, authorized: 2, reserved: 0, consumed: 0 }], { env: "false" });
  assert.equal((await postFurnitureGeneration(generationRequest("beta-key-0005", jpeg), envOff.deps)).status, 403);

  const png = new Uint8Array(await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 1, g: 2, b: 3 } },
  }).png().toBuffer());
  const wrongPhoto = harness([{ userId: USER_A, enabled: true, authorized: 2, reserved: 0, consumed: 0 }]);
  const rejectedPhoto = await postFurnitureGeneration(generationRequest("beta-key-0006", png), wrongPhoto.deps);
  assert.equal(rejectedPhoto.status, 400);
  assert.equal(wrongPhoto.db.jobs.length, 0);

  const wrongSettings = harness([{ userId: USER_A, enabled: true, authorized: 2, reserved: 0, consumed: 0 }]);
  const rejectedSettings = await postFurnitureGeneration(
    generationRequest("beta-key-0007", jpeg, { ...defaultFurnitureGeneratorSettings(), geometryResolution: "2k" }),
    wrongSettings.deps,
  );
  assert.equal(rejectedSettings.status, 400);
  assert.equal(wrongSettings.db.jobs.length, 0);

  const ready = harness([{ userId: USER_A, enabled: true, authorized: 2, reserved: 0, consumed: 0 }]);
  ready.db.controls.creditsConsumed = 20;
  const overBudget = await postFurnitureGeneration(generationRequest("beta-key-0008", jpeg), ready.deps);
  assert.equal(overBudget.status, 409);
  assert.equal(ready.db.jobs.length, 0);
  ready.db.controls.creditsConsumed = 0;

  ready.db.controls.paidSubmissionsAuthorized = 0;
  const unpaid = await postFurnitureGeneration(generationRequest("beta-key-unpaid", jpeg), ready.deps);
  assert.equal(unpaid.status, 409);
  assert.equal((unpaid.body as { error: string }).error, "AI generation is temporarily unavailable.");
  assert.equal(ready.db.jobs.length, 0);
  assert.equal(ready.db.allowances?.[0]?.reserved, 0);
  assert.equal(ready.db.controls.creditsReserved, 0);
  assert.equal(ready.db.controls.paidSubmissionsUsed, 0);
  ready.db.controls.paidSubmissionsAuthorized = 1;
  ready.db.controls.paidSubmissionsUsed = 1;
  const spentBudget = await postFurnitureGeneration(generationRequest("beta-key-spent", jpeg), ready.deps);
  assert.equal(spentBudget.status, 409);
  assert.equal(ready.db.jobs.length, 0);
  assert.equal(ready.db.controls.creditsReserved, 0);
  assert.equal(ready.db.controls.paidSubmissionsUsed, 1);
  ready.db.controls.paidSubmissionsUsed = 0;

  const created = await postFurnitureGeneration(generationRequest("beta-key-0009", jpeg), ready.deps);
  assert.equal(created.status, 200);
  assert.equal((created.body as { created: boolean }).created, true);
  ready.db.controls.paidSubmissionsUsed = 1;
  const replay = await postFurnitureGeneration(generationRequest("beta-key-0009", jpeg), ready.deps);
  assert.equal((replay.body as { created: boolean }).created, false);
  assert.equal(ready.db.jobs.length, 1);
  assert.equal(ready.db.allowances?.[0]?.reserved, 1);
  assert.equal(ready.db.controls.creditsReserved, 30);
  const otherJpeg = new Uint8Array(await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 9, g: 9, b: 9 } },
  }).jpeg({ quality: 80 }).toBuffer());
  const conflict = await postFurnitureGeneration(generationRequest("beta-key-0009", otherJpeg), ready.deps);
  assert.equal(conflict.status, 409);
  assert.equal(ready.db.jobs.length, 1);
  assert.equal(ready.db.allowances?.[0]?.reserved, 1);
  ready.db.controls.paidSubmissionsUsed = 0;

  const hidden = await getFurnitureGeneration(
    new Request("https://vibode.local/generation"),
    asCaller(ready.deps, USER_B, "person@example.com"),
    ready.db.jobs[0]?.jobId ?? "",
  );
  assert.equal(hidden.status, 404);

  const recovery = await postFurnitureGenerationRecovery(
    new Request("https://vibode.local/recover", {
      method: "POST",
      body: JSON.stringify({ duplicateChargeRiskAccepted: true }),
    }),
    { ...ready.deps, isAdmin: () => false },
    ready.db.jobs[0]?.jobId ?? "",
  );
  assert.equal(recovery.status, 401);
});

test("the allowance read is owner scoped and a poll does not submit", async () => {
  const db = createGenerationDatabase();
  db.controls.liveEnabled = true;
  db.allowances = [
    { userId: USER_A, enabled: true, authorized: 3, reserved: 1, consumed: 1 },
    { userId: USER_B, enabled: true, authorized: 9, reserved: 0, consumed: 0 },
  ];
  const commands = createMemoryGenerationCommands(db, { nowMs: 1 });
  const reads: string[] = [];
  const deps: GenerationHttpDeps = {
    authorize: async () => ({ ok: true, userId: USER_A, email: "ada@example.com" }),
    commands: {
      ...commands,
      async readOwnAllowance(userId) {
        reads.push(userId);
        return commands.readOwnAllowance(userId);
      },
    },
    objects: createMemoryBucketStore(),
    env: { VIBODE_MESHY_GENERATION_ENABLED: "true" },
    isAdmin: () => false,
    nowMs: () => 1,
    enforceCertifiedProfile: true,
  };
  const blocked = await getFurnitureGenerationAllowance(
    new Request("https://vibode.local/allowance?userId=" + USER_B),
    deps,
  );
  assert.equal(blocked.status, 400);
  assert.equal(reads.length, 0);
  const own = await getFurnitureGenerationAllowance(new Request("https://vibode.local/allowance"), deps);
  assert.equal(own.status, 200);
  const entitlement = (own.body as { entitlement: { remaining: number; state: string } }).entitlement;
  assert.equal(entitlement.remaining, 1);
  assert.equal(entitlement.state, "ready");
  assert.equal(reads[0], USER_A);
  assert.equal(JSON.stringify(own.body).includes("meshy"), false);
  assert.equal(JSON.stringify(own.body).includes("credit"), false);

  let method = "";
  let url = "";
  const polled = await readBetaGeneration({
    token: "token",
    jobId: JOB,
    fetchImpl: async (input, init) => {
      method = init?.method ?? "GET";
      url = String(input);
      return new Response(JSON.stringify({
        ok: true,
        job: { jobId: JOB, status: "running", errorClass: null, progress: 40 },
      }), { status: 200 });
    },
  });
  assert.equal(method, "GET");
  assert.equal(url, `/api/vibode/furniture-generations/${JOB}`);
  assert.equal(polled.ok, true);

  let posts = 0;
  const uncertain = await submitBetaGeneration({
    token: "token",
    idempotencyKey: "beta-key-0010",
    jpegBytes: new Uint8Array([1, 2, 3]),
    fetchImpl: async () => {
      posts += 1;
      throw new Error("socket_closed");
    },
  });
  assert.equal(uncertain.ok, false);
  if (uncertain.ok) return;
  assert.equal(uncertain.uncertain, true);
  assert.equal(posts, 1);
});

test("the generator shows disabled, eligible, preparing, failed, and ready states", () => {
  const disabled = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: false,
        state: "disabled",
        authorized: 3,
        reserved: 0,
        consumed: 0,
        remaining: 3,
        reason: "AI generation is turned off for this account.",
      },
    },
  }));
  assert.match(disabled, /data-eligibility="disabled"/);
  assert.match(disabled, /data-generate="unavailable"/);
  assert.match(disabled, /AI Generations Remaining: 3/);
  assert.match(disabled, /turned off for this account/);
  assert.doesNotMatch(disabled, /credit|queue|estimated|api\.meshy\.ai/i);

  const eligible = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    initialState: {
      photos: {
        front: {
          slot: "front",
          fileName: "chair.jpg",
          mimeType: "image/jpeg",
          byteLength: 128,
          widthPx: 64,
          heightPx: 64,
        },
        left: null,
        right: null,
        back: null,
      },
      previewUrls: {},
      settings: defaultFurnitureGeneratorSettings(),
      notices: [],
      slotErrors: {},
    },
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 3,
        reserved: 0,
        consumed: 0,
        remaining: 3,
        reason: null,
      },
    },
  }));
  assert.match(eligible, /data-generation-available="true"/);
  assert.match(eligible, /data-generate="ready"/);
  assert.match(eligible, /AI Generations Remaining: 3/);

  const preparing = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 3,
        reserved: 1,
        consumed: 0,
        remaining: 2,
        reason: null,
      },
      job: { jobId: JOB, status: "reserved", errorClass: null, progress: 0 },
    },
  }));
  assert.match(preparing, /data-generation-phase="reserved"/);
  assert.match(preparing, /Preparing your photo/);
  assert.match(preparing, /has not started yet/);
  assert.match(preparing, /data-generate="unavailable"/);

  const failed = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 3,
        reserved: 0,
        consumed: 1,
        remaining: 2,
        reason: null,
      },
      job: { jobId: JOB, status: "failed", errorClass: "provider_failed", progress: 0 },
    },
  }));
  assert.match(failed, /The generation did not finish/);
  assert.match(failed, /could not be generated/);

  const review = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: false,
        state: "exhausted",
        authorized: 1,
        reserved: 0,
        consumed: 1,
        remaining: 0,
        reason: "No AI generations remain.",
      },
      job: { jobId: JOB, status: "needs_review", errorClass: "needs_review", progress: 0 },
    },
  }));
  assert.match(review, /Awaiting operator review/);
  assert.match(review, /will not start again/);

  const ready = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 3,
        reserved: 0,
        consumed: 0,
        remaining: 3,
        reason: null,
      },
      job: { jobId: JOB, status: "ready", errorClass: null, progress: 100 },
    },
  }));
  assert.match(ready, /Ready to preview/);
  assert.match(ready, /data-preview-ready="true"/);
  assert.match(ready, /Preview model/);

  const panel = readFileSync("components/stage/FurnitureGeneratorPanel.tsx", "utf8");
  const client = readFileSync("lib/vibode-furniture/generator/beta-generation-client.ts", "utf8");
  const production = readFileSync("lib/vibode-furniture/generation/production.server.ts", "utf8");
  const recentRoute = readFileSync("app/api/vibode/furniture-generations/recent/route.ts", "utf8");
  const recentMigration = readFileSync(
    "supabase/migrations/20261112160000_vibode_furniture_generation_owner_recent.sql",
    "utf8",
  );
  assert.doesNotMatch(panel, /fetch\(|api\.meshy\.ai|discard\(|localStorage|sessionStorage/);
  assert.doesNotMatch(client, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.match(panel, /readRecentBetaGenerations\(/);
  const restore = panel.slice(panel.indexOf("readRecentBetaGenerations({"), panel.indexOf("async function generate"));
  assert.doesNotMatch(restore, /submitBetaGeneration|claimBetaSubmission|betaSubmissionKey\(/);
  assert.match(production, /enforceCertifiedProfile: true/);
  assert.match(production, /isAdminEmail/);
  assert.doesNotMatch(readFileSync("app/api/vibode/furniture-generations/allowance/route.ts", "utf8"), /grant_|adminAuthorize/);
  assert.match(recentRoute, /getFurnitureGenerationRecent/);
  assert.doesNotMatch(recentRoute, /adminAuthorize|reserve_vibode|api\.meshy\.ai|MESHY_API_KEY/);
  assert.match(recentMigration, /limit 20/);
  assert.doesNotMatch(recentMigration, /set\s+live_enabled|set\s+credit_ceiling|set\s+max_concurrent|set\s+paid_submissions_authorized/i);
  assert.doesNotMatch(recentMigration, /api\.meshy\.ai|MESHY_API_KEY|grant execute on function public\.read_vibode_furniture_generation_owner_recent\(uuid\) to anon|to authenticated/);
});

test("recent generations restore the active job and every unsaved ready candidate", () => {
  const now = Date.parse("2026-11-12T00:00:00.000Z");
  const running = recoverable({
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    status: "running",
    createdAt: "2026-11-12T18:00:00.000Z",
    previewAvailable: false,
  });
  const readyNew = recoverable({
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    status: "ready",
    createdAt: "2026-11-12T17:00:00.000Z",
    outputExpiresAt: "2026-12-01T00:00:00.000Z",
    previewAvailable: true,
  });
  const readyOld = recoverable({
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    status: "ready",
    createdAt: "2026-11-10T17:00:00.000Z",
    outputExpiresAt: "2026-12-01T00:00:00.000Z",
    previewAvailable: true,
  });
  const parsed = recoverableGenerationsFromPayload({
    ok: true,
    limit: 100,
    jobs: [
      { ...running, outputObjectPath: "users/hidden/secret", providerTaskId: "task-secret-1", errorClass: "users/hidden/secret" },
      { ...readyNew, errorClass: "credit_unreported" },
      readyOld,
      { ...readyOld, jobId: "not-a-job", status: "failed" },
      { ...readyOld, jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", status: "saved" },
      { ...readyOld, jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", status: "discarded" },
      { ...readyOld, jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", outputExpiresAt: "2026-10-01T00:00:00.000Z" },
      ...Array.from({ length: 21 }, (_, index) => recoverable({
        jobId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
        status: "ready",
        createdAt: `2026-11-01T${String(index).padStart(2, "0")}:00:00.000Z`,
        outputExpiresAt: "2026-12-01T00:00:00.000Z",
        previewAvailable: true,
      })),
    ],
  }, now);
  assert.ok(parsed);
  assert.equal(parsed.length, 20);
  assert.equal(parsed[0]?.jobId, running.jobId);
  assert.equal(parsed[0]?.errorClass, null);
  assert.equal(parsed[1]?.errorClass, "needs_review");
  assert.equal(parsed.some((job) => job.jobId === readyOld.jobId), true);
  assert.equal(JSON.stringify(parsed).includes("hidden"), false);
  assert.equal(JSON.stringify(parsed).includes("task-secret"), false);
  assert.equal(JSON.stringify(parsed).includes("credit"), false);
  const restored = mergeRecentGenerationResponse({
    jobs: [running, readyNew, readyOld],
    selectedJobId: null,
    userSelected: false,
  });
  assert.equal(restored.selectedJobId, running.jobId);
  assert.deepEqual(restored.jobs.map((job) => job.jobId), [running.jobId, readyNew.jobId, readyOld.jobId]);
  const chosen = mergeRecentGenerationResponse({
    jobs: [running, readyNew, readyOld],
    selectedJobId: readyOld.jobId,
    userSelected: true,
  });
  assert.equal(chosen.selectedJobId, readyOld.jobId);
  const staleIgnored = shouldApplyGenerationRead(1, 2)
    ? mergeRecentGenerationResponse({ jobs: [readyOld], selectedJobId: readyNew.jobId, userSelected: true })
    : chosen;
  assert.equal(staleIgnored.selectedJobId, readyOld.jobId);
  assert.equal(staleIgnored.jobs.some((job) => job.jobId === running.jobId), true);
  assert.equal(submissionKeyAfterRestore("beta-kept-key-0001"), "beta-kept-key-0001");
  assert.equal(submissionKeyAfterOutcome("beta-kept-key-0001", "uncertain"), "beta-kept-key-0001");
  assert.equal("key" in chosen, false);
  const entitled: CustomerEntitlement = {
    canGenerate: true,
    state: "ready",
    authorized: 1,
    reserved: 0,
    consumed: 0,
    remaining: 1,
    reason: null,
  };
  assert.equal(canOfferBetaGeneration({
    entitlement: entitled,
    recentReady: false,
    blocking: false,
    busy: false,
    frontReady: true,
  }), false);
  assert.equal(customerJobCopy(running).poll, true);
  assert.equal(customerJobCopy(readyNew).poll, false);
  assert.equal(customerJobCopy({ jobId: JOB, status: "needs_review", errorClass: "needs_review", progress: 0 }).poll, false);
});

test("an owner can restore a ready candidate without another generation", async () => {
  const jpeg = await jpegBytes();
  const ctx = harness([
    { userId: USER_A, enabled: true, authorized: 2, reserved: 0, consumed: 0 },
    { userId: USER_B, enabled: true, authorized: 2, reserved: 0, consumed: 0 },
  ]);
  const created = await postFurnitureGeneration(generationRequest("beta-recent-0001", jpeg), ctx.deps);
  assert.equal(created.status, 200);
  const reserved = ctx.db.jobs[0];
  assert.ok(reserved);
  const readyNewId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const readyOldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const reviewId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
  const now = 1_700_000_000_000;
  reserved.createdAtMs = now;
  reserved.status = "running";
  reserved.progress = 40;
  reserved.errorClass = "users/hidden/secret" as GenerationJob["errorClass"];
  reserved.providerTaskId = "task-secret-1";
  placeJob(ctx.db.jobs, reserved, {
    jobId: readyNewId,
    createdAtMs: now - 1_000,
    status: "ready",
    progress: 100,
    quotaState: "released",
    errorClass: "credit_unreported",
    outputExpiresAtMs: now + 60_000,
  });
  placeJob(ctx.db.jobs, reserved, {
    jobId: readyOldId,
    createdAtMs: now - 2_000,
    status: "ready",
    progress: 100,
    quotaState: "released",
    outputExpiresAtMs: now + 60_000,
  });
  placeJob(ctx.db.jobs, reserved, {
    jobId: reviewId,
    createdAtMs: now - 500,
    status: "needs_review",
    errorClass: "needs_review",
    providerTaskId: null,
  });
  placeJob(ctx.db.jobs, reserved, {
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    createdAtMs: now + 5_000,
    status: "saved",
    savedAssetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    outputExpiresAtMs: now + 60_000,
  });
  placeJob(ctx.db.jobs, reserved, {
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
    status: "discarded",
    errorClass: "discarded",
  });
  placeJob(ctx.db.jobs, reserved, {
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
    status: "ready",
    outputExpiresAtMs: now - 1,
  });
  placeJob(ctx.db.jobs, reserved, {
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
    userId: USER_B,
    status: "ready",
    outputExpiresAtMs: now + 60_000,
  });
  for (const jobId of [readyNewId, readyOldId]) {
    const path = `users/${USER_A}/generations/${jobId}/candidate.glb`;
    await ctx.deps.objects.put({
      bucket: PERSONAL_FURNITURE_BUCKET,
      path,
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "model/gltf-binary",
    });
  }
  const allowance = ctx.db.allowances?.[0];
  assert.ok(allowance);
  allowance.authorized = 1;
  allowance.reserved = 0;
  allowance.consumed = 1;
  allowance.enabled = false;
  ctx.db.controls.liveEnabled = false;
  ctx.db.controls.paidSubmissionsUsed = 1;
  let adminCalls = 0;
  const lists: string[] = [];
  const off: GenerationHttpDeps = {
    ...ctx.deps,
    env: { VIBODE_MESHY_GENERATION_ENABLED: "false" },
    commands: {
      ...ctx.deps.commands,
      async listOwnerRecent(userId) {
        lists.push(userId);
        return ctx.deps.commands.listOwnerRecent(userId);
      },
      async adminAuthorize(jobId, accepted) {
        adminCalls += 1;
        return ctx.deps.commands.adminAuthorize(jobId, accepted);
      },
    },
  };
  const before = footprint(ctx.db);
  const rejected = await getFurnitureGenerationRecent(
    new Request(`https://vibode.local/recent?userId=${USER_B}`),
    off,
  );
  assert.equal(rejected.status, 400);
  assert.equal(lists.length, 0);
  const missing = await getFurnitureGenerationRecent(
    new Request("https://vibode.local/recent"),
    { ...off, authorize: async () => ({ ok: false, response: { status: 401, body: { ok: false, error: "Sign in is required." } } }) },
  );
  assert.equal(missing.status, 401);
  const listed = await getFurnitureGenerationRecent(new Request("https://vibode.local/recent"), off);
  assert.equal(listed.status, 200);
  assert.equal(lists[0], USER_A);
  const body = listed.body as { limit: number; jobs: { jobId: string; status: string; previewAvailable: boolean; errorClass: string | null }[] };
  assert.equal(body.limit, 20);
  assert.deepEqual(body.jobs.map((job) => job.jobId), [reserved.jobId, reviewId, readyNewId, readyOldId]);
  assert.equal(body.jobs[0]?.status, "running");
  assert.equal(body.jobs[0]?.errorClass, null);
  assert.equal(body.jobs[1]?.status, "needs_review");
  assert.equal(body.jobs[2]?.previewAvailable, true);
  assert.equal(body.jobs[3]?.previewAvailable, true);
  const encoded = JSON.stringify(listed.body);
  assert.equal(encoded.includes("credit"), false);
  assert.equal(encoded.includes("meshy"), false);
  assert.equal(encoded.includes("task-secret-1"), false);
  assert.equal(encoded.includes("candidate.glb"), false);
  assert.equal(encoded.includes("hidden"), false);
  assert.equal(encoded.includes("idempotency"), false);
  assert.deepEqual(footprint(ctx.db), before);
  assert.equal(adminCalls, 0);
  const preview = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    off,
    readyOldId,
  );
  assert.equal(preview.status, 200);
  const stranger = await getFurnitureGenerationRecent(
    new Request("https://vibode.local/recent"),
    asCaller(off, USER_B, "person@example.com"),
  );
  const strangerJobs = (stranger.body as { jobs: { jobId: string }[] }).jobs;
  assert.equal(strangerJobs.some((job) => job.jobId === readyNewId || job.jobId === reserved.jobId), false);
  const hiddenPreview = await postFurnitureGenerationPreview(
    new Request("https://vibode.local/preview", { method: "POST" }),
    asCaller(off, USER_B, "person@example.com"),
    readyOldId,
  );
  assert.equal(hiddenPreview.status, 404);
  assert.deepEqual(footprint(ctx.db), before);
});

test("the generator keeps a ready candidate available when no generations remain", () => {
  const readyNew = recoverable({
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    status: "ready",
    createdAt: "2026-11-12T17:00:00.000Z",
    outputExpiresAt: "2026-12-01T00:00:00.000Z",
    previewAvailable: true,
  });
  const readyOld = recoverable({
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    status: "ready",
    createdAt: "2026-11-10T17:00:00.000Z",
    outputExpiresAt: "2026-12-01T00:00:00.000Z",
    previewAvailable: true,
  });
  const exhausted = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: false,
        state: "exhausted",
        authorized: 1,
        reserved: 0,
        consumed: 1,
        remaining: 0,
        reason: "No AI generations remain.",
      },
      recent: [readyNew, readyOld],
    },
  }));
  assert.match(exhausted, /Recent generations/);
  assert.match(exhausted, /data-recent-count="2"/);
  assert.match(exhausted, /Ready to preview · 2026-11-12/);
  assert.match(exhausted, /Ready to preview · 2026-11-10/);
  assert.match(exhausted, /data-preview-ready="true"/);
  assert.match(exhausted, /No AI generations remain/);
  assert.match(exhausted, /data-generate="unavailable"/);
  const pressed = exhausted.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0] ?? "";
  assert.match(pressed, new RegExp(readyNew.jobId));

  const active = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: true,
        state: "ready",
        authorized: 2,
        reserved: 0,
        consumed: 0,
        remaining: 2,
        reason: null,
      },
      recent: [
        recoverable({
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
          status: "running",
          createdAt: "2026-11-12T18:00:00.000Z",
          previewAvailable: false,
        }),
        readyOld,
      ],
    },
  }));
  assert.match(active, /data-generation-phase="running"/);
  assert.match(active, /data-recent-job="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"/);
  assert.doesNotMatch(active, /data-preview-ready/);

  const review = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: false,
        state: "generation_off",
        authorized: 1,
        reserved: 0,
        consumed: 1,
        remaining: 0,
        reason: "AI generation is temporarily unavailable.",
      },
      job: {
        jobId: readyOld.jobId,
        status: "ready",
        errorClass: null,
        progress: 100,
        outputExpiresAt: readyOld.outputExpiresAt,
        previewAvailable: true,
      },
      recent: [
        recoverable({
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8",
          status: "needs_review",
          createdAt: "2026-11-12T18:00:00.000Z",
          errorClass: "needs_review",
          previewAvailable: false,
        }),
        readyOld,
      ],
    },
  }));
  assert.match(review, /Awaiting operator review/);
  assert.match(review, /AI generation is temporarily unavailable/);
  assert.match(review, /data-generation-phase="ready"/);
  assert.match(review, /data-preview-ready="true"/);

  const disabled = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: false,
        state: "disabled",
        authorized: 1,
        reserved: 0,
        consumed: 0,
        remaining: 1,
        reason: "AI generation is turned off for this account.",
      },
      job: {
        jobId: readyOld.jobId,
        status: "ready",
        errorClass: null,
        progress: 100,
        previewAvailable: true,
      },
    },
  }));
  assert.match(disabled, /turned off for this account/);
  assert.match(disabled, /data-preview-ready="true"/);

  const expired = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    fixture: {
      entitlement: {
        canGenerate: false,
        state: "exhausted",
        authorized: 1,
        reserved: 0,
        consumed: 1,
        remaining: 0,
        reason: "No AI generations remain.",
      },
      job: {
        jobId: readyOld.jobId,
        status: "ready",
        errorClass: null,
        progress: 100,
        outputExpiresAt: "2026-10-01T00:00:00.000Z",
        previewAvailable: true,
      },
    },
  }));
  assert.match(expired, /This preview expired/);
  assert.doesNotMatch(expired, /data-preview-ready/);
});

test("a failed recent read does not submit a generation", async () => {
  let posts = 0;
  const recent = await readRecentBetaGenerations({
    token: "token",
    nowMs: Date.parse("2026-11-12T00:00:00.000Z"),
    fetchImpl: async (input, init) => {
      if (init?.method === "POST") posts += 1;
      assert.equal(String(input), "/api/vibode/furniture-generations/recent");
      assert.equal(init?.method, "GET");
      assert.equal(String(input).includes("userId"), false);
      throw new Error("socket_closed");
    },
  });
  assert.equal(recent.ok, false);
  assert.equal(posts, 0);
  if (recent.ok) return;
  assert.equal(recent.uncertain, true);
  assert.equal(canOfferBetaGeneration({
    entitlement: {
      canGenerate: true,
      state: "ready",
      authorized: 1,
      reserved: 0,
      consumed: 0,
      remaining: 1,
      reason: null,
    },
    recentReady: false,
    blocking: false,
    busy: false,
    frontReady: true,
  }), false);
});

function recoverable(input: Partial<RecoverableGeneration> & Pick<RecoverableGeneration, "jobId" | "status" | "createdAt">): RecoverableGeneration {
  return {
    jobId: input.jobId,
    status: input.status,
    errorClass: input.errorClass ?? null,
    progress: input.progress ?? (input.status === "ready" ? 100 : 0),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    outputExpiresAt: input.outputExpiresAt ?? null,
    previewAvailable: input.previewAvailable ?? input.status === "ready",
  };
}

function placeJob(jobs: GenerationJob[], source: GenerationJob, patch: Partial<GenerationJob> & { jobId: string }) {
  const output = patch.status === "ready" || patch.status === "saved"
    ? `users/${patch.userId ?? source.userId}/generations/${patch.jobId}/candidate.glb`
    : null;
  jobs.push({
    ...source,
    providerTaskId: null,
    savedAssetId: null,
    outputBucket: output ? PERSONAL_FURNITURE_BUCKET : null,
    outputObjectPath: output,
    outputExpiresAtMs: null,
    errorClass: null,
    errorCode: null,
    claimNonce: null,
    ...patch,
    providerTaskName: `vibode-${patch.jobId}`,
    idempotencyKey: patch.idempotencyKey ?? `recent-${patch.jobId.slice(0, 8)}`,
  });
}

function footprint(db: ReturnType<typeof createGenerationDatabase>) {
  return {
    jobs: db.jobs.length,
    creditsReserved: db.controls.creditsReserved,
    creditsConsumed: db.controls.creditsConsumed,
    paidAuthorized: db.controls.paidSubmissionsAuthorized,
    paidUsed: db.controls.paidSubmissionsUsed,
    allowances: db.allowances?.map((row) => ({ ...row })),
  };
}

function harness(
  allowances: { userId: string; enabled: boolean; authorized: number; reserved: number; consumed: number }[],
  options?: { live?: boolean; env?: string },
) {
  const db = createGenerationDatabase();
  db.controls.liveEnabled = options?.live ?? true;
  db.controls.paidSubmissionsAuthorized = 1;
  db.allowances = allowances;
  const commands = createMemoryGenerationCommands(db, { nowMs: 1_700_000_000_000 });
  let sequence = 0;
  const deps: GenerationHttpDeps = {
    authorize: async () => ({ ok: true, userId: USER_A, email: "ada@example.com" }),
    commands,
    objects: createMemoryBucketStore(),
    env: { VIBODE_MESHY_GENERATION_ENABLED: options?.env ?? "true" },
    isAdmin: () => true,
    nowMs: () => 1_700_000_000_000,
    newJobId: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(sequence++).padStart(12, "b")}`,
    enforceCertifiedProfile: true,
  };
  return { db, deps };
}

function asCaller(deps: GenerationHttpDeps, userId: string, email: string): GenerationHttpDeps {
  return { ...deps, authorize: async () => ({ ok: true, userId, email }) };
}

function generationRequest(key: string, bytes: Uint8Array, settings = defaultFurnitureGeneratorSettings()) {
  return new Request("https://vibode.local/generation", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: key,
      settings,
      images: [{ slot: "front", base64: Buffer.from(bytes).toString("base64") }],
    }),
  });
}

async function jpegBytes(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 40, g: 90, b: 120 } },
  }).jpeg({ quality: 80 }).toBuffer());
}
