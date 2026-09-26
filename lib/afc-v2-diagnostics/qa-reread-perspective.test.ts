import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import type { AfcDiagnosticSessionRecord } from "./contracts";
import type { AfcQaCapabilityEnv } from "./qa-capability.server";
import {
  handleAfcQaPerspectiveRereadPost,
  type AfcQaPerspectiveRereadAnalysisResult,
  type AfcQaPerspectiveRereadStartInput,
} from "./qa-reread-perspective.server";
import type { AfcQaReadyRerunStore } from "./qa-rerun.server";
import type { AfcDiagnosticRetryEpisodeSignal } from "./retry-episode-signal.server";
import {
  AFC_QA_PERSPECTIVE_REREAD_PATH,
  AFC_QA_READY_RERUN_PATH,
  AFC_QA_TESTER_COPY,
  afcQaPerspectiveRereadErrorMessage,
  buildAfcQaPerspectiveRereadBody,
  collectAfcQaPerspectiveRereadBodyPrivacyViolations,
  createInitialAfcQaTesterReportModel,
  deriveAfcQaTesterReportView,
  reduceAfcQaTesterReport,
  type AfcQaBrowserState,
} from "./tester-report.client";

const ROOT = process.cwd();
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_1 = "11111111-1111-4111-8111-111111111111";
const GEN_PARENT = "12121212-1212-4121-8121-121212121212";
const SESSION_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHA_A = "a".repeat(64);

const QA_ALL: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "all" };
const QA_OFF: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "off" };
const QA_ALLOW: AfcQaCapabilityEnv = {
  VIBODE_AFC_QA_MODE: "allowlist",
  VIBODE_AFC_QA_USER_IDS: USER_A,
};

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function authorized(userId: string): ProductionAfcAuth {
  return { ok: true, userId };
}

function unauthorized(): ProductionAfcAuth {
  return {
    ok: false,
    response: productionAfcJson({ error: "Unauthorized." }, 401),
  };
}

function session(): AfcDiagnosticSessionRecord {
  return {
    id: SESSION_A,
    roomId: ROOM_A,
    userId: USER_A,
    originalSha256: SHA_A,
    baseAssetId: null,
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function readySignal(): AfcDiagnosticRetryEpisodeSignal {
  return {
    sessionId: SESSION_A,
    sessionStatus: "open",
    attemptCount: 1,
    latestAttempt: {
      generationId: GEN_1,
      attemptOrdinal: 1,
      intent: "analyze",
      machineStatus: "ready",
    },
    hasMultipleAttempts: false,
    hasFailedAttempt: false,
    hasReadyAttempt: true,
  };
}

function store(): AfcQaReadyRerunStore {
  return {
    async findRoom(roomId) {
      if (roomId === ROOM_A) return { id: ROOM_A, userId: USER_A };
      if (roomId === ROOM_B) return { id: ROOM_B, userId: USER_B };
      return null;
    },
    async findGeneration(generationId) {
      if (generationId !== GEN_1) return null;
      return {
        id: GEN_1,
        userId: USER_A,
        roomId: ROOM_A,
        status: "ready",
        originalSha256: SHA_A,
      };
    },
    async findMembershipByGenerationId(generationId) {
      if (generationId !== GEN_1) return null;
      return { sessionId: SESSION_A, generationId: GEN_1 };
    },
    async findSessionById(sessionId) {
      return sessionId === SESSION_A ? session() : null;
    },
    async listOpenSessionsByUserAndRoom(input) {
      if (input.userId === USER_A && input.roomId === ROOM_A) {
        return [{ id: SESSION_A }];
      }
      return [];
    },
  };
}

function projection(
  overrides: Partial<AfcQaBrowserState> = {},
): AfcQaBrowserState {
  return {
    enabled: true,
    canReport: true,
    offerFeedback: false,
    reportGenerationId: GEN_1,
    ...overrides,
  };
}

function readyModel() {
  return reduceAfcQaTesterReport(createInitialAfcQaTesterReportModel(ROOM_A), {
    type: "projection_ready",
    projection: projection(),
  }).state;
}

const READY_CONTEXT = {
  preparePhase: "ready",
  prepareGenerationId: GEN_1,
};

async function postReread(args: {
  userId?: string | null;
  body?: unknown;
  env?: AfcQaCapabilityEnv;
  start?: (
    input: AfcQaPerspectiveRereadStartInput,
  ) => Promise<AfcQaPerspectiveRereadAnalysisResult>;
}) {
  const calls: AfcQaPerspectiveRereadStartInput[] = [];
  const response = await handleAfcQaPerspectiveRereadPost({
    request: new Request("http://test/api/vibode/afc/qa/reread-perspective", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body:
        args.body === undefined
          ? JSON.stringify({ roomId: ROOM_A, generationId: GEN_1 })
          : typeof args.body === "string"
            ? args.body
            : JSON.stringify(args.body),
    }),
    authorize: async () =>
      args.userId ? authorized(args.userId) : unauthorized(),
    env: args.env ?? QA_ALL,
    store: store(),
    retrySignal: async () => readySignal(),
    startProductionAnalysis: async (input) => {
      calls.push(input);
      if (args.start) return args.start(input);
      return {
        status: "ready" as const,
        generationId: GEN_PARENT,
        currentGenerationId: GEN_PARENT,
        authority: { schemaVersion: "afc-v2-production-room-authority/v1" },
        failureReason: null,
        frame: { width: 8, height: 8 },
      };
    },
  });
  return { response, calls };
}

test("QA-disabled projection hides Re-read Room Perspective and Re-run room read", () => {
  const view = deriveAfcQaTesterReportView(
    reduceAfcQaTesterReport(createInitialAfcQaTesterReportModel(ROOM_A), {
      type: "projection_ready",
      projection: projection({
        enabled: false,
        canReport: false,
        reportGenerationId: null,
      }),
    }).state,
    READY_CONTEXT,
  );
  assert.equal(view.showPerspectiveReread, false);
  assert.equal(view.showRerun, false);
  const client = source("lib/afc-v2-diagnostics/tester-report.client.ts");
  assert.doesNotMatch(client, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
});

test("QA-enabled ready room shows both controls as separate actions", () => {
  const view = deriveAfcQaTesterReportView(readyModel(), READY_CONTEXT);
  assert.equal(view.showPerspectiveReread, true);
  assert.equal(view.showRerun, true);
  assert.equal(view.perspectiveRereadLabel, "Re-read Room Perspective");
  assert.equal(AFC_QA_TESTER_COPY.rerunButton, "Re-run room read");
  assert.notEqual(view.perspectiveRereadLabel, AFC_QA_TESTER_COPY.rerunButton);

  const hidden = deriveAfcQaTesterReportView(readyModel(), {
    preparePhase: "idle",
    prepareGenerationId: GEN_1,
  });
  assert.equal(hidden.showPerspectiveReread, false);
  assert.equal(hidden.showRerun, false);
});

test("Re-read posts the QA perspective path and Re-run stays on run_again", () => {
  const first = reduceAfcQaTesterReport(readyModel(), {
    type: "perspective_reread_requested",
    ...READY_CONTEXT,
  });
  assert.equal(first.effect.type, "post_perspective_reread");
  if (first.effect.type !== "post_perspective_reread") return;
  assert.equal(first.effect.url, AFC_QA_PERSPECTIVE_REREAD_PATH);
  assert.notEqual(first.effect.url, AFC_QA_READY_RERUN_PATH);
  assert.deepEqual(first.effect.body, {
    roomId: ROOM_A,
    generationId: GEN_1,
  });
  assert.deepEqual(
    collectAfcQaPerspectiveRereadBodyPrivacyViolations({
      ...buildAfcQaPerspectiveRereadBody({
        roomId: ROOM_A,
        generationId: GEN_1,
      }),
      intent: "run_again",
    }),
    ["intent"],
  );

  const rerun = reduceAfcQaTesterReport(readyModel(), {
    type: "rerun_requested",
    ...READY_CONTEXT,
  });
  assert.equal(rerun.effect.type, "post_rerun");
  if (rerun.effect.type !== "post_rerun") return;
  assert.equal(rerun.effect.url, AFC_QA_READY_RERUN_PATH);
});

test("in-flight Re-read blocks a second Re-read and a conflicting Re-run", () => {
  const first = reduceAfcQaTesterReport(readyModel(), {
    type: "perspective_reread_requested",
    ...READY_CONTEXT,
  });
  assert.equal(first.state.perspectiveRereadPending, true);
  const duplicate = reduceAfcQaTesterReport(first.state, {
    type: "perspective_reread_requested",
    ...READY_CONTEXT,
  });
  assert.equal(duplicate.effect.type, "none");
  const rerun = reduceAfcQaTesterReport(first.state, {
    type: "rerun_requested",
    ...READY_CONTEXT,
  });
  assert.equal(rerun.effect.type, "none");
  const view = deriveAfcQaTesterReportView(first.state, READY_CONTEXT);
  assert.equal(view.perspectiveRereadBusy, true);
  assert.equal(view.perspectiveRereadDisabled, true);
  assert.equal(view.perspectiveRereadLabel, AFC_QA_TESTER_COPY.rereadPending);
  assert.equal(view.rerunDisabled, true);

  const rerunFirst = reduceAfcQaTesterReport(readyModel(), {
    type: "rerun_requested",
    ...READY_CONTEXT,
  });
  const blockedReread = reduceAfcQaTesterReport(rerunFirst.state, {
    type: "perspective_reread_requested",
    ...READY_CONTEXT,
  });
  assert.equal(blockedReread.effect.type, "none");
});

test("success refreshes QA state and keeps the editor on the settled room read", () => {
  const pending = reduceAfcQaTesterReport(readyModel(), {
    type: "perspective_reread_requested",
    ...READY_CONTEXT,
  }).state;
  const succeeded = reduceAfcQaTesterReport(pending, {
    type: "perspective_reread_succeeded",
  });
  assert.equal(succeeded.effect.type, "refresh_qa");
  assert.equal(succeeded.state.perspectiveRereadPending, false);
  assert.equal(succeeded.state.successMessage, AFC_QA_TESTER_COPY.rereadSuccess);
  const editor = source("app/editor/page.tsx");
  const runtime = source("lib/afc-v2-runtime/use-afc-production-runtime.ts");
  assert.match(
    editor,
    /onPerspectiveRereadStart=\{\(\) => prepare3d\.requestRunningFromReady\(\)\}/,
  );
  assert.match(
    editor,
    /onPerspectiveRereadSettled=\{\(result\) => prepare3d\.settleRunning\(result\)\}/,
  );
  assert.match(
    editor,
    /onPerspectiveRereadReverted=\{\(\) => prepare3d\.revertRunningToReady\(\)\}/,
  );
  assert.match(editor, /onRerunStart=\{\(\) => prepare3d\.requestRunningFromReady\(\)\}/);
  assert.match(runtime, /\[enabled, roomId, reloadKey\]/);
  assert.doesNotMatch(editor, /VIBODE_AFC_QA_MODE|reread_perspective/);
});

test("failure restores the pending control and does not invent a new authority", () => {
  const pending = reduceAfcQaTesterReport(readyModel(), {
    type: "perspective_reread_requested",
    ...READY_CONTEXT,
  }).state;
  const failed = reduceAfcQaTesterReport(pending, {
    type: "perspective_reread_http_error",
    status: 500,
  });
  assert.equal(failed.state.perspectiveRereadPending, false);
  assert.equal(failed.state.noticeMessage, AFC_QA_TESTER_COPY.rereadError500);
  assert.equal(failed.effect.type, "none");
  const view = deriveAfcQaTesterReportView(failed.state, READY_CONTEXT);
  assert.equal(view.perspectiveRereadDisabled, false);
  assert.equal(view.showRerun, true);

  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const failedFn = adapter.slice(
    adapter.indexOf("async function persistFailedGeneration"),
  );
  assert.doesNotMatch(failedFn, /activateGeneration|publishDurableTiled|publishDurableEmpty/);
  assert.match(adapter, /currentGenerationId: parentId/);
  assert.match(adapter, /authority: parentAuthority/);
});

test("allowlisted user can re-read; QA-off, other users, and anonymous calls cannot", async () => {
  const allowed = await postReread({ userId: USER_A, env: QA_ALLOW });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.calls.length, 1);
  assert.equal(allowed.calls[0]?.intent, "reread_perspective");
  assert.equal(allowed.calls[0]?.roomId, ROOM_A);

  const allMode = await postReread({ userId: USER_A, env: QA_ALL });
  assert.equal(allMode.response.status, 200);
  assert.equal(allMode.calls[0]?.intent, "reread_perspective");

  const disabled = await postReread({ userId: USER_A, env: QA_OFF });
  assert.equal(disabled.response.status, 404);
  assert.deepEqual(await disabled.response.json(), { error: "Not available." });
  assert.equal(disabled.calls.length, 0);

  const stranger = await postReread({ userId: USER_B, env: QA_ALLOW });
  assert.equal(stranger.response.status, 404);
  assert.equal(stranger.calls.length, 0);

  const anonymous = await postReread({ userId: null, env: QA_ALL });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.calls.length, 0);
});

test("client intent is ignored and a non-owned room is rejected before analysis", async () => {
  const coerced = await postReread({
    userId: USER_A,
    env: QA_ALLOW,
    body: {
      roomId: ROOM_A,
      generationId: GEN_1,
      intent: "run_again",
      sourceImageUrl: "https://example.test/furnished.jpg",
    },
  });
  assert.equal(coerced.response.status, 200);
  assert.equal(coerced.calls[0]?.intent, "reread_perspective");
  assert.equal("sourceImageUrl" in (coerced.calls[0] ?? {}), false);

  const wrongRoom = await postReread({
    userId: USER_A,
    env: QA_ALL,
    body: { roomId: ROOM_B, generationId: GEN_1 },
  });
  assert.equal(wrongRoom.response.status, 404);
  assert.deepEqual(await wrongRoom.response.json(), { error: "Room not found." });
  assert.equal(wrongRoom.calls.length, 0);
});

test("analysis failure returns the parent generation unchanged", async () => {
  const parentAuthority = { schemaVersion: "afc-v2-production-room-authority/v1", generationId: GEN_1 };
  const failed = await postReread({
    userId: USER_A,
    env: QA_ALL,
    start: async () => ({
      status: "failed",
      generationId: GEN_PARENT,
      currentGenerationId: GEN_1,
      authority: parentAuthority,
      failureReason: "AFC analysis failed.",
      frame: { width: 8, height: 8 },
    }),
  });
  assert.equal(failed.response.status, 422);
  const body = await failed.response.json() as {
    currentGenerationId: string;
    authority: { generationId: string };
    status: string;
  };
  assert.equal(body.status, "failed");
  assert.equal(body.currentGenerationId, GEN_1);
  assert.equal(body.authority.generationId, GEN_1);
  assert.equal(
    afcQaPerspectiveRereadErrorMessage(422),
    AFC_QA_TESTER_COPY.rereadError500,
  );
});

test("perspective re-read reaches the Lab force-TILED primitive and not the admin route", () => {
  const lab = source("app/admin/3d-room-lab-v2/RoomLabV2.tsx");
  const analysis = source("app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts");
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const route = source("app/api/vibode/afc/qa/reread-perspective/route.ts");
  const handler = source("lib/afc-v2-diagnostics/qa-reread-perspective.server.ts");
  const rerunRoute = source("app/api/vibode/afc/qa/rerun/route.ts");
  const original = source("lib/afc-v2-production/production-original.ts");
  const analyze = source("app/api/vibode/afc/analyze/route.ts");

  assert.match(lab, /analyzeAndApply\(\{ forceTiledRegeneration: true \}\)/);
  assert.match(analysis, /executeAfcSr1TiledLiveProductAttempt/);
  assert.match(analysis, /forceTiledRegeneration: input\.forceTiledRegeneration === true/);
  assert.match(adapter, /const forceTiledRegeneration = intent === "reread_perspective"/);
  assert.match(adapter, /executeAfcV2Analysis|const analyze = input\.analyze \?\? executeAfcV2Analysis/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(route, /intent: "reread_perspective"/);
  assert.match(route, /runProductionAfcAnalysis/);
  assert.doesNotMatch(route, /\/api\/admin\/3d-room-lab/);
  assert.match(handler, /intent: AFC_QA_PERSPECTIVE_REREAD_INTENT/);
  assert.doesNotMatch(handler, /run_again|insertTesterCase|vibode_afc_diagnostic_cases|\.insert\(|\.update\(|\.delete\(/);
  assert.match(rerunRoute, /intent: "run_again"/);
  assert.doesNotMatch(rerunRoute, /reread_perspective/);
  assert.match(original, /bucket !== AFC_V2_ORIGINAL_STORAGE_BUCKET/);
  assert.match(original, /isOwnedOriginalStoragePath/);
  assert.match(analyze, /parseProductionAfcIntent/);
  assert.doesNotMatch(analyze, /qa\/reread-perspective|handleAfcQaPerspectiveRereadPost/);

  const ui = source("components/afc-qa/AfcQaTesterReport.tsx");
  assert.match(ui, /data-afc-qa-perspective-reread/);
  assert.match(ui, /data-afc-qa-ready-rerun/);
  assert.match(ui, /post_perspective_reread/);
  assert.match(ui, /post_rerun/);
  assert.doesNotMatch(ui, /reread_perspective|VIBODE_AFC_QA_/);
});

test("historical diagnostic case rows are not written by the perspective adapter", () => {
  const handler = source("lib/afc-v2-diagnostics/qa-reread-perspective.server.ts");
  const route = source("app/api/vibode/afc/qa/reread-perspective/route.ts");
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.match(route, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(
    `${handler}\n${route}`,
    /insertTesterCase|vibode_afc_diagnostic_cases|updateGeneration\(/,
  );
  assert.match(lifecycle, /\.neq\("original_sha256", input\.originalSha256\)/);
});
