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
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { createGenerationDatabase } from "@/lib/vibode-furniture/generation/engine";
import {
  getFurnitureGeneration,
  getFurnitureGenerationAllowance,
  postFurnitureGeneration,
  postFurnitureGenerationRecovery,
  type GenerationHttpDeps,
} from "@/lib/vibode-furniture/generation/http";
import { createMemoryGenerationCommands } from "@/lib/vibode-furniture/generation/memory-commands";
import { createMemoryBucketStore } from "@/lib/vibode-furniture/generation/objects";

import {
  claimBetaSubmission,
  customerEntitlement,
  customerJobCopy,
  isCertifiedBetaFurnitureSettings,
  nextPollDelayMs,
  shouldRefreshAllowance,
  submissionKeyAfterOutcome,
} from "./beta-generation";
import { readBetaGeneration, submitBetaGeneration } from "./beta-generation-client";

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
  assert.equal((unpaid.body as { error: string }).error, "A paid generation is not authorized.");
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
  assert.doesNotMatch(panel, /fetch\(|api\.meshy\.ai|discard\(/);
  assert.doesNotMatch(client, /api\.meshy\.ai|MESHY_API_KEY/);
  assert.match(production, /enforceCertifiedProfile: true/);
  assert.match(production, /isAdminEmail/);
  assert.doesNotMatch(readFileSync("app/api/vibode/furniture-generations/allowance/route.ts", "utf8"), /grant_|adminAuthorize/);
});

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
