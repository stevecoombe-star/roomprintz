import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { AfcDiagnosticSessionRecord } from "./contracts";
import {
  getAfcDiagnosticBrowserQaState,
  handleAfcQaBrowserStateGet,
  type AfcDiagnosticBrowserQaStateStore,
} from "./browser-qa-state.server";
import { afcQaAccessConfig } from "./qa-access";
import { prepareCurrentGenerationDiagnosticMembership } from "./qa-current-generation.server";
import {
  AfcQaReadyRerunGenerationError,
  AfcQaReadyRerunMembershipError,
  authorizeAfcQaReadyRerun,
  handleAfcQaReadyRerunPost,
  type AfcQaReadyRerunStore,
} from "./qa-rerun.server";
import {
  AFC_QA_TESTER_COPY,
  createInitialAfcQaTesterReportModel,
  deriveAfcQaTesterReportView,
  reduceAfcQaTesterReport,
  type AfcQaBrowserState,
} from "./tester-report.client";

const ADMIN = "55555555-5555-4555-8555-555555555555";
const MEMBER = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN = "11111111-1111-4111-8111-111111111111";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHA = "ab".repeat(32);
const ALLOW = afcQaAccessConfig(true, ADMIN, MEMBER);
const READY = { preparePhase: "ready", prepareGenerationId: GEN };

function ownedRoomStore(userId: string): AfcDiagnosticBrowserQaStateStore {
  return {
    async findRoom(roomId) {
      return { id: roomId, userId };
    },
    async listOpenSessionsByUserAndRoom() {
      return [];
    },
  };
}

function stageView(projection: AfcQaBrowserState | null, roomId = ROOM_A) {
  const ready = reduceAfcQaTesterReport(createInitialAfcQaTesterReportModel(roomId), {
    type: "projection_ready",
    projection: projection ?? {
      enabled: false,
      canReport: false,
      offerFeedback: false,
      reportGenerationId: null,
    },
  });
  return deriveAfcQaTesterReportView(ready.state, READY);
}

test("allowlisted admin and non-admin see the same STAGE QA controls", async () => {
  const seen: string[] = [];
  for (const userId of [ADMIN, MEMBER]) {
    const state = await getAfcDiagnosticBrowserQaState(
      { userId, roomId: ROOM_A },
      {
        qaAccess: ALLOW,
        store: ownedRoomStore(userId),
        loadCurrentGeneration: async (input) => {
          seen.push(input.userId);
          return { generationId: GEN, status: "ready" };
        },
      },
    );
    assert.equal(state.enabled, true);
    assert.equal(state.canReport, true);
    assert.equal(state.reportGenerationId, GEN);
    const view = stageView(state);
    assert.equal(view.showManualReport, true);
    assert.equal(view.showPerspectiveReread, true);
    assert.equal(view.showRerun, true);
    assert.equal(view.perspectiveRereadLabel, AFC_QA_TESTER_COPY.rereadButton);
  }
  assert.deepEqual(seen, [ADMIN, MEMBER]);
});

test("non-allowlisted user and disabled QA mode hide the controls", async () => {
  let loads = 0;
  const loadCurrentGeneration = async () => {
    loads += 1;
    return { generationId: GEN, status: "ready" };
  };
  const denied = await getAfcDiagnosticBrowserQaState(
    { userId: OTHER, roomId: ROOM_A },
    {
      qaAccess: ALLOW,
      store: ownedRoomStore(OTHER),
      loadCurrentGeneration,
    },
  );
  const disabled = await getAfcDiagnosticBrowserQaState(
    { userId: MEMBER, roomId: ROOM_A },
    {
      qaAccess: afcQaAccessConfig(false, ADMIN, MEMBER),
      store: ownedRoomStore(MEMBER),
      loadCurrentGeneration,
    },
  );
  assert.equal(loads, 0);
  assert.equal(denied.enabled, false);
  assert.equal(disabled.enabled, false);
  for (const state of [denied, disabled]) {
    const view = stageView(state);
    assert.equal(view.showManualReport, false);
    assert.equal(view.showPerspectiveReread, false);
    assert.equal(view.showRerun, false);
  }
});

test("capability uses the authenticated user id after login", async () => {
  const seen: string[] = [];
  const response = await handleAfcQaBrowserStateGet({
    request: new Request(`http://test/api/vibode/afc/qa/state?roomId=${ROOM_A}`),
    authorize: async () => ({ ok: true, userId: MEMBER }),
    qaAccess: ALLOW,
    store: ownedRoomStore(MEMBER),
    loadCurrentGeneration: async (input) => {
      seen.push(input.userId);
      return { generationId: GEN, status: "ready" };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    canReport: true,
    offerFeedback: false,
    reportGenerationId: GEN,
  });
  assert.deepEqual(seen, [MEMBER]);
});

test("opening another room keeps authorization and still requires a generation", async () => {
  const stateFor = (roomId: string, generationId: string | null) =>
    getAfcDiagnosticBrowserQaState(
      { userId: MEMBER, roomId },
      {
        qaAccess: ALLOW,
        store: ownedRoomStore(MEMBER),
        loadCurrentGeneration: async (input) => {
          assert.equal(input.userId, MEMBER);
          assert.equal(input.roomId, roomId);
          return generationId
            ? { generationId, status: "ready" as const }
            : null;
        },
      },
    );
  const first = await stateFor(ROOM_A, GEN);
  const second = await stateFor(ROOM_B, null);
  const third = await stateFor(ROOM_A, GEN);
  assert.equal(first.enabled, true);
  assert.equal(first.canReport, true);
  assert.equal(second.enabled, true);
  assert.equal(second.canReport, false);
  assert.equal(third.canReport, true);
  assert.equal(stageView(second).showRerun, false);
  assert.equal(stageView(third).showRerun, true);
});

test("an existing diagnostic generation is not replaced by the current pointer", async () => {
  const diagnosticId = "12121212-1212-4121-8121-121212121212";
  let loaded = false;
  const store: AfcDiagnosticBrowserQaStateStore = {
    async findRoom() {
      return { id: ROOM_A, userId: MEMBER };
    },
    async listOpenSessionsByUserAndRoom() {
      return [{ id: SESSION }];
    },
  };
  const state = await getAfcDiagnosticBrowserQaState(
    { userId: MEMBER, roomId: ROOM_A },
    {
      qaAccess: ALLOW,
      store,
      retrySignal: async () => ({
        sessionId: SESSION,
        sessionStatus: "open",
        attemptCount: 1,
        latestAttempt: {
          generationId: diagnosticId,
          attemptOrdinal: 1,
          intent: "analyze",
          machineStatus: "ready",
        },
        hasMultipleAttempts: false,
        hasFailedAttempt: false,
        hasReadyAttempt: true,
      }),
      loadCurrentGeneration: async () => {
        loaded = true;
        return { generationId: GEN, status: "ready" };
      },
    },
  );
  assert.equal(loaded, false);
  assert.equal(state.reportGenerationId, diagnosticId);
});

test("unauthorized rerun is rejected before membership repair", async () => {
  let prepared = false;
  const response = await handleAfcQaReadyRerunPost({
    request: new Request("http://test/api/vibode/afc/qa/rerun", {
      method: "POST",
      body: JSON.stringify({ roomId: ROOM_A, generationId: GEN }),
    }),
    authorize: async () => ({ ok: true, userId: OTHER }),
    startProductionAnalysis: async () => {
      throw new Error("analysis must not start");
    },
    qaAccess: ALLOW,
    prepareCurrentGenerationMembership: async () => {
      prepared = true;
    },
    store: {
      async findRoom() {
        throw new Error("room lookup must not run");
      },
      async findGeneration() {
        return null;
      },
      async findMembershipByGenerationId() {
        return null;
      },
      async findSessionById() {
        return null;
      },
      async listOpenSessionsByUserAndRoom() {
        return [];
      },
    },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not available." });
  assert.equal(prepared, false);
});

test("a ready current generation becomes eligible only after membership repair", async () => {
  let membership: { sessionId: string; generationId: string } | null = null;
  const session: AfcDiagnosticSessionRecord = {
    id: SESSION,
    roomId: ROOM_A,
    userId: MEMBER,
    originalSha256: SHA,
    baseAssetId: null,
    status: "open",
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
  const store: AfcQaReadyRerunStore = {
    async findRoom() {
      return { id: ROOM_A, userId: MEMBER };
    },
    async findGeneration() {
      return {
        id: GEN,
        userId: MEMBER,
        roomId: ROOM_A,
        status: "ready",
        originalSha256: SHA,
      };
    },
    async findMembershipByGenerationId() {
      return membership;
    },
    async findSessionById() {
      return session;
    },
    async listOpenSessionsByUserAndRoom() {
      return membership ? [{ id: SESSION }] : [];
    },
  };
  const retrySignal = async () => ({
    sessionId: SESSION,
    sessionStatus: "open" as const,
    attemptCount: 1,
    latestAttempt: {
      generationId: GEN,
      attemptOrdinal: 1,
      intent: "analyze" as const,
      machineStatus: "ready" as const,
    },
    hasMultipleAttempts: false,
    hasFailedAttempt: false,
    hasReadyAttempt: true,
  });
  await assert.rejects(
    () => authorizeAfcQaReadyRerun(
      { userId: MEMBER, roomId: ROOM_A, generationId: GEN },
      { qaAccess: ALLOW, store, retrySignal },
    ),
    (error: unknown) => error instanceof AfcQaReadyRerunMembershipError,
  );
  const authorized = await authorizeAfcQaReadyRerun(
    { userId: MEMBER, roomId: ROOM_A, generationId: GEN },
    {
      qaAccess: ALLOW,
      store,
      retrySignal,
      prepareCurrentGenerationMembership: async () => {
        membership = { sessionId: SESSION, generationId: GEN };
      },
    },
  );
  assert.equal(authorized.userId, MEMBER);
  assert.equal(authorized.generationId, GEN);
  assert.equal(authorized.intent, "run_again");
});

test("a generation that is not ready does not become a rerun target", async () => {
  let prepared = false;
  await assert.rejects(
    () => authorizeAfcQaReadyRerun(
      { userId: MEMBER, roomId: ROOM_A, generationId: GEN },
      {
        qaAccess: ALLOW,
        prepareCurrentGenerationMembership: async () => {
          prepared = true;
        },
        store: {
          async findRoom() {
            return { id: ROOM_A, userId: MEMBER };
          },
          async findGeneration() {
            return {
              id: GEN,
              userId: MEMBER,
              roomId: ROOM_A,
              status: "running",
              originalSha256: SHA,
            };
          },
          async findMembershipByGenerationId() {
            return null;
          },
          async findSessionById() {
            return null;
          },
          async listOpenSessionsByUserAndRoom() {
            return [];
          },
        },
      },
    ),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_ineligible",
  );
  assert.equal(prepared, false);
});

test("membership repair attaches only the caller's current generation", async () => {
  const attached: string[] = [];
  const current = {
    generationId: GEN,
    status: "ready" as const,
    intent: "analyze",
    originalSha256: SHA,
    baseAssetId: null,
  };
  await prepareCurrentGenerationDiagnosticMembership(
    { userId: MEMBER, roomId: ROOM_A, generationId: GEN, qaAccess: ALLOW },
    {
      readCurrent: async (input) => {
        assert.equal(input.userId, MEMBER);
        return current;
      },
      ensureMembership: async (input) => {
        attached.push(String(input.generationId));
        assert.equal(input.userId, MEMBER);
        return {
          enabled: true,
          sessionId: SESSION,
          generationId: GEN,
          attemptOrdinal: 1,
          sessionCreated: true,
          membershipCreated: true,
          staleSessionsClosed: 0,
        };
      },
    },
  );
  await prepareCurrentGenerationDiagnosticMembership(
    {
      userId: MEMBER,
      roomId: ROOM_A,
      generationId: "12121212-1212-4121-8121-121212121212",
      qaAccess: ALLOW,
    },
    {
      readCurrent: async () => current,
      ensureMembership: async () => {
        attached.push("unexpected");
        return { enabled: false };
      },
    },
  );
  assert.deepEqual(attached, [GEN]);
});

test("STAGE QA wiring does not use admin email or legacy QA env", () => {
  const root = process.cwd();
  const files = [
    "lib/afc-v2-diagnostics/qa-current-generation.server.ts",
    "lib/afc-v2-diagnostics/browser-qa-state.server.ts",
    "app/api/vibode/afc/qa/state/route.ts",
    "app/api/vibode/afc/qa/rerun/route.ts",
    "app/api/vibode/afc/qa/reread-perspective/route.ts",
    "app/api/vibode/afc/qa/cases/route.ts",
    "components/afc-qa/AfcQaTesterReport.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
    assert.doesNotMatch(source, /isAdminEmail|VIBODE_ADMIN_EMAIL|getAuthenticatedAdminUser/);
  }
  assert.match(
    readFileSync(path.join(root, "app/api/vibode/afc/qa/state/route.ts"), "utf8"),
    /loadCurrentGeneration: readOwnedCurrentTerminalGeneration/,
  );
});
