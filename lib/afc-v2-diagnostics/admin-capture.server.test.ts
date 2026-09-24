import assert from "node:assert/strict";
import test from "node:test";

import { afcDiagnosticsAdminJson } from "./admin-auth.server";
import {
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_INSERT_COLUMNS,
  createSupabaseAfcDiagnosticAdminCaptureStore,
  deriveAfcDiagnosticAdminCaptureInsert,
  handleAfcDiagnosticsAdminCapturePost,
  type AfcDiagnosticAdminCaptureInsert,
  type AfcDiagnosticAdminCaptureStore,
} from "./admin-capture.server";
import { parseAfcDiagnosticAdminCaptureRequest } from "./admin-capture";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  type AfcDiagnosticAdminGenerationEvidence,
  type AfcDiagnosticAdminMembershipRecord,
  type AfcDiagnosticAdminSessionRecord,
} from "./admin-read-model";
import {
  AFC_GENERATION_TABLE,
  type AfcDiagnosticAdminReadStore,
} from "./admin-read-model.server";
import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  type AfcDiagnosticSessionRecord,
} from "./contracts";
import { AFC_QA_ISSUE_TAXONOMY_VERSION } from "./taxonomy";
import { buildAfcDiagnosticOriginalIdentity } from "./submit-tester-case.server";
import type { AfcDiagnosticGenerationEvidence } from "./submit-tester-case.server";
import type { AfcDiagnosticsAdminAuth } from "./admin-auth.server";

const USER_A = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_A = "99999999-9999-4999-8999-999999999999";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const GEN_RUN = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const GEN_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CASE_TESTER = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const CASE_ADMIN = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const EMPTY_SHA = "e".repeat(64);
const TILED_SHA = "f".repeat(64);
const NOW = "2026-09-20T18:00:00.000Z";

function jsonBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function unauthorized(): AfcDiagnosticsAdminAuth {
  return {
    ok: false,
    response: afcDiagnosticsAdminJson({ error: "Unauthorized." }, 401),
  };
}

function forbidden(): AfcDiagnosticsAdminAuth {
  return {
    ok: false,
    response: afcDiagnosticsAdminJson({ error: "Admin access required." }, 403),
  };
}

function adminOk(userId = ADMIN_ID): AfcDiagnosticsAdminAuth {
  return {
    ok: true,
    admin: Object.freeze({
      userId,
      email: "admin@example.com",
    }),
  };
}

function fingerprint() {
  return Object.freeze({
    fingerprintSchemaVersion: "afc-v2-engine-fingerprint/v1",
    productionSchemaVersion: "afc-v2-production-room-authority/v1",
    gitSha: "abc123",
    observationModelId: "obs-model",
    engineVersions: Object.freeze({
      liveProduct: "lp",
      autoMetric: "am",
      cameraCalibration: "cc",
      cameraAuthority: "ca",
      collision: "col",
      emptyAuthoritativeCollision: "eac",
    }),
    tiled: Object.freeze({
      generatorId: "gen",
      profileId: "prof",
      researchPreset: "preset",
      requestedModelId: "model",
      readerVersion: null,
    }),
  });
}

function captureGeneration(
  overrides: Partial<AfcDiagnosticGenerationEvidence> = {},
): AfcDiagnosticGenerationEvidence {
  return {
    id: GEN_1,
    userId: USER_A,
    roomId: ROOM_A,
    status: "ready",
    originalSha256: SHA_A,
    originalDecodedWidth: 1200,
    originalDecodedHeight: 800,
    originalByteCount: 1234,
    originalMimeType: "image/jpeg",
    originalOrientation: 1,
    ...overrides,
  };
}

function adminGeneration(
  overrides: Partial<AfcDiagnosticAdminGenerationEvidence> = {},
): AfcDiagnosticAdminGenerationEvidence {
  return Object.freeze({
    generationId: GEN_1,
    roomId: ROOM_A,
    userId: USER_A,
    parentGenerationId: null,
    lineageSeq: 1,
    runId: "run-1",
    intent: "analyze",
    status: "ready",
    createdAt: "2026-09-18T12:00:00.000Z",
    completedAt: "2026-09-18T12:00:01.000Z",
    frame: Object.freeze({ width: 1200, height: 800 }),
    failureReason: null,
    metricStatus: "path_a",
    collisionStatus: "empty_authoritative",
    analysisStatus: "applied",
    analysisReason: null,
    recoverySafeFailureState: "none",
    metricDecision: null,
    legacyMetricConclusion: null,
    engineFingerprint: fingerprint(),
    original: Object.freeze({
      originalSha256: SHA_A,
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 1234,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: null,
    }),
    empty: Object.freeze({
      present: true,
      sha256: EMPTY_SHA,
      artifactSource: "generated",
    }),
    tiled: Object.freeze({
      present: true,
      sha256: TILED_SHA,
      artifactSource: "durable",
    }),
    ...overrides,
  });
}

function sessionRecord(
  overrides: Partial<AfcDiagnosticSessionRecord> = {},
): AfcDiagnosticSessionRecord {
  return {
    id: SESSION_A,
    roomId: ROOM_A,
    userId: USER_A,
    originalSha256: SHA_A,
    baseAssetId: ASSET_A,
    status: "open",
    createdAt: "2026-09-18T11:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
    ...overrides,
  };
}

function adminSession(
  session: AfcDiagnosticSessionRecord,
): AfcDiagnosticAdminSessionRecord {
  return Object.freeze({
    id: session.id,
    status: session.status,
    roomId: session.roomId,
    userId: session.userId,
    originalSha256: session.originalSha256,
    baseAssetId: session.baseAssetId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

type CaseRow = {
  id: string;
  submittedAt: string;
  reviewStatus: "new" | "in_review" | "closed";
  trigger: "manual_report" | "repeated_unsuccessful" | "admin_capture";
  issueCodes: readonly string[];
  taxonomyVersion: string;
  notes: string | null;
  roomId: string;
  sessionId: string;
  reportedGenerationId: string;
  machineStatusSnapshot: "ready" | "failed" | "running";
  reporterUserId: string;
  originalSha256: string;
  originalIdentity: unknown;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
};

function existingCase(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: CASE_TESTER,
    submittedAt: "2026-09-19T12:00:00.000Z",
    reviewStatus: "new",
    trigger: "manual_report",
    issueCodes: Object.freeze(["perspective_off"]),
    taxonomyVersion: AFC_QA_ISSUE_TAXONOMY_VERSION,
    notes: "tester notes",
    roomId: ROOM_A,
    sessionId: SESSION_A,
    reportedGenerationId: GEN_1,
    machineStatusSnapshot: "ready",
    reporterUserId: USER_A,
    originalSha256: SHA_A,
    originalIdentity: Object.freeze({
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 1234,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: ASSET_A,
    }),
    reviewerUserId: null,
    reviewNotes: null,
    reviewedAt: null,
    ...overrides,
  };
}

type WorldOptions = {
  session?: AfcDiagnosticSessionRecord;
  memberships?: AfcDiagnosticAdminMembershipRecord[];
  captureGenerations?: AfcDiagnosticGenerationEvidence[];
  adminGenerations?: AfcDiagnosticAdminGenerationEvidence[];
  cases?: CaseRow[];
  omitGenerationAfterMembership?: boolean;
};

function world(options: WorldOptions = {}) {
  const session = options.session ?? sessionRecord();
  const memberships = options.memberships ?? [
    Object.freeze({
      sessionId: SESSION_A,
      generationId: GEN_1,
      attemptOrdinal: 1,
      intent: "analyze" as const,
      associatedAt: "2026-09-18T12:00:00.000Z",
    }),
    Object.freeze({
      sessionId: SESSION_A,
      generationId: GEN_2,
      attemptOrdinal: 2,
      intent: "run_again" as const,
      associatedAt: "2026-09-18T12:05:00.000Z",
    }),
  ];
  const captureGenerations = options.captureGenerations ?? [
    captureGeneration(),
    captureGeneration({
      id: GEN_2,
      status: "failed",
    }),
  ];
  const adminGenerations = options.adminGenerations ?? [
    adminGeneration(),
    adminGeneration({
      generationId: GEN_2,
      lineageSeq: 2,
      intent: "run_again",
      status: "failed",
      runId: "run-2",
    }),
  ];
  const cases = [...(options.cases ?? [])];
  const inserts: AfcDiagnosticAdminCaptureInsert[] = [];
  const generationLookups: string[] = [];
  const sessionWrites: string[] = [];
  const membershipWrites: string[] = [];
  const generationWrites: string[] = [];
  const roomWrites: string[] = [];
  const caseUpdates: string[] = [];
  const storageWrites: string[] = [];
  let nextId = 1;
  const preCases = structuredClone(cases);
  const preSession = structuredClone(session);
  const preGenerations = structuredClone(captureGenerations);

  const captureStore: AfcDiagnosticAdminCaptureStore = {
    async findSessionById(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async findMembership(sessionId, generationId) {
      if (sessionId !== session.id) return null;
      const found = memberships.find(
        (row) => row.generationId === generationId && row.sessionId === sessionId,
      );
      return found
        ? { sessionId: found.sessionId, generationId: found.generationId }
        : null;
    },
    async findGenerationById(generationId) {
      generationLookups.push(generationId);
      if (options.omitGenerationAfterMembership) return null;
      return captureGenerations.find((row) => row.id === generationId) ?? null;
    },
    async insertAdminCaptureCase(input) {
      inserts.push(input);
      const id = `c0000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
      nextId += 1;
      cases.push({
        id,
        submittedAt: NOW,
        reviewStatus: "new",
        trigger: input.trigger,
        issueCodes: input.issue_codes,
        taxonomyVersion: input.taxonomy_version,
        notes: input.notes,
        roomId: input.room_id,
        sessionId: input.session_id,
        reportedGenerationId: input.reported_generation_id,
        machineStatusSnapshot: input.machine_status_snapshot,
        reporterUserId: input.reporter_user_id,
        originalSha256: input.original_sha256,
        originalIdentity: input.original_identity,
        reviewerUserId: null,
        reviewNotes: null,
        reviewedAt: null,
      });
      return id;
    },
  };

  const readStore: AfcDiagnosticAdminReadStore = {
    async listCases() {
      throw new Error("listCases should not run during capture POST");
    },
    async findCaseById(caseId) {
      return cases.find((row) => row.id === caseId) ?? null;
    },
    async findSessionById(sessionId) {
      return sessionId === session.id ? adminSession(session) : null;
    },
    async listSessionStatusesByIds() {
      throw new Error("listSessionStatusesByIds should not run during capture POST");
    },
    async listMembershipSessionIds() {
      throw new Error("listMembershipSessionIds should not run during capture POST");
    },
    async listMembershipsBySessionId(sessionId) {
      return sessionId === session.id ? memberships : [];
    },
    async findGenerationById(generationId) {
      return adminGenerations.find((row) => row.generationId === generationId) ?? null;
    },
    async listGenerationsByIds() {
      throw new Error("listGenerationsByIds should not run during capture POST");
    },
  };

  return {
    session,
    memberships,
    captureGenerations,
    cases,
    captureStore,
    readStore,
    inserts,
    generationLookups,
    sessionWrites,
    membershipWrites,
    generationWrites,
    roomWrites,
    caseUpdates,
    storageWrites,
    preCases,
    preSession,
    preGenerations,
  };
}

async function capturePost(input: {
  sessionId?: string;
  body?: unknown;
  rawBody?: string;
  authorize?: () => Promise<AfcDiagnosticsAdminAuth>;
  world?: ReturnType<typeof world>;
  getCaptureStore?: () => AfcDiagnosticAdminCaptureStore | null;
  getReadStore?: () => AfcDiagnosticAdminReadStore | null;
}) {
  const current = input.world ?? world();
  const sessionId = input.sessionId ?? SESSION_A;
  const request =
    input.rawBody != null
      ? new Request(
          `http://test/api/admin/afc-diagnostics/sessions/${sessionId}/cases`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: input.rawBody,
          },
        )
      : new Request(
          `http://test/api/admin/afc-diagnostics/sessions/${sessionId}/cases`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              input.body ?? {
                generationId: GEN_1,
                issueCodes: ["perspective_off"],
              },
            ),
          },
        );
  const response = await handleAfcDiagnosticsAdminCapturePost({
    request,
    sessionId,
    authorize: input.authorize ?? (async () => adminOk()),
    captureStore:
      input.getCaptureStore || input.getReadStore ? undefined : current.captureStore,
    readStore:
      input.getCaptureStore || input.getReadStore ? undefined : current.readStore,
    getCaptureStore: input.getCaptureStore,
    getReadStore: input.getReadStore,
  });
  return { response, world: current };
}

test("401 unauthenticated does not construct stores", async () => {
  let built = 0;
  const current = world();
  const { response } = await capturePost({
    authorize: async () => unauthorized(),
    getCaptureStore: () => {
      built += 1;
      return current.captureStore;
    },
    getReadStore: () => {
      built += 1;
      return current.readStore;
    },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await jsonBody(response), { error: "Unauthorized." });
  assert.equal(built, 0);
  assert.equal(current.inserts.length, 0);
});

test("403 non-admin does not construct stores", async () => {
  let built = 0;
  const current = world();
  const { response } = await capturePost({
    authorize: async () => forbidden(),
    getCaptureStore: () => {
      built += 1;
      return current.captureStore;
    },
    getReadStore: () => {
      built += 1;
      return current.readStore;
    },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await jsonBody(response), { error: "Admin access required." });
  assert.equal(built, 0);
});

test("malformed authenticated requests do not construct the store", async () => {
  let built = 0;
  const current = world();
  const getters = {
    getCaptureStore: () => {
      built += 1;
      return current.captureStore;
    },
    getReadStore: () => {
      built += 1;
      return current.readStore;
    },
  };

  const badJson = await capturePost({ rawBody: "{", ...getters });
  assert.equal(badJson.response.status, 400);
  assert.deepEqual(await jsonBody(badJson.response), { error: "Invalid request." });

  const badSession = await capturePost({ sessionId: "not-a-uuid", ...getters });
  assert.equal(badSession.response.status, 400);

  const unknownKey = await capturePost({
    body: {
      generationId: GEN_1,
      issueCodes: ["other"],
      trigger: "admin_capture",
    },
    ...getters,
  });
  assert.equal(unknownKey.response.status, 400);
  assert.equal(built, 0);
  assert.equal(current.inserts.length, 0);
});

test("Session missing, membership missing, and generation-not-member are opaque 404s", async () => {
  const missingSession = await capturePost({
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
  });
  assert.equal(missingSession.response.status, 404);
  assert.deepEqual(await jsonBody(missingSession.response), { error: "Not found." });
  assert.equal(missingSession.world.inserts.length, 0);

  const missingMembership = await capturePost({
    body: { generationId: GEN_OTHER, issueCodes: ["other"] },
  });
  assert.equal(missingMembership.response.status, 404);
  assert.equal(missingMembership.world.generationLookups.length, 0);
  assert.equal(missingMembership.world.inserts.length, 0);

  const current = world({
    memberships: [
      Object.freeze({
        sessionId: SESSION_A,
        generationId: GEN_1,
        attemptOrdinal: 1,
        intent: "analyze",
        associatedAt: "2026-09-18T12:00:00.000Z",
      }),
    ],
  });
  const notMember = await capturePost({
    world: current,
    body: { generationId: GEN_2, issueCodes: ["other"] },
  });
  assert.equal(notMember.response.status, 404);
  assert.equal(current.generationLookups.length, 0);
});

test("generation missing after membership is an opaque 404", async () => {
  const { response, world: current } = await capturePost({
    world: world({ omitGenerationAfterMembership: true }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await jsonBody(response), { error: "Not found." });
  assert.equal(current.generationLookups.length, 1);
  assert.equal(current.inserts.length, 0);
});

test("room, user, SHA, and running mismatches are opaque 404s", async () => {
  const wrongRoom = await capturePost({
    world: world({
      captureGenerations: [captureGeneration({ roomId: ROOM_B })],
    }),
  });
  assert.equal(wrongRoom.response.status, 404);
  assert.equal(wrongRoom.world.inserts.length, 0);

  const wrongUser = await capturePost({
    world: world({
      captureGenerations: [
        captureGeneration({ userId: "33333333-3333-4333-8333-333333333333" }),
      ],
    }),
  });
  assert.equal(wrongUser.response.status, 404);

  const invalidSha = await capturePost({
    world: world({
      captureGenerations: [captureGeneration({ originalSha256: "not-a-sha" })],
    }),
  });
  assert.equal(invalidSha.response.status, 404);

  const shaMismatch = await capturePost({
    world: world({
      captureGenerations: [captureGeneration({ originalSha256: SHA_B })],
    }),
  });
  assert.equal(shaMismatch.response.status, 404);

  const running = await capturePost({
    world: world({
      memberships: [
        Object.freeze({
          sessionId: SESSION_A,
          generationId: GEN_RUN,
          attemptOrdinal: 3,
          intent: "run_again" as const,
          associatedAt: "2026-09-18T12:10:00.000Z",
        }),
      ],
      captureGenerations: [
        captureGeneration({ id: GEN_RUN, status: "running" }),
      ],
    }),
    body: { generationId: GEN_RUN, issueCodes: ["other"] },
  });
  assert.equal(running.response.status, 404);
  assert.equal(running.world.inserts.length, 0);
});

test("READY and FAILED capture succeed with server-derived provenance", async () => {
  const ready = await capturePost({
    body: {
      generationId: GEN_1,
      issueCodes: ["perspective_off", "other"],
      notes: "  capture note  ",
    },
  });
  assert.equal(ready.response.status, 201);
  const readyBody = await jsonBody(ready.response);
  assert.equal(readyBody.trigger, "admin_capture");
  assert.equal(readyBody.origin, "admin");
  assert.equal(readyBody.reporterUserId, USER_A);
  assert.notEqual(readyBody.reporterUserId, ADMIN_ID);
  assert.equal(readyBody.reportedGenerationId, GEN_1);
  assert.equal(readyBody.sessionId, SESSION_A);
  assert.equal(readyBody.roomId, ROOM_A);
  assert.equal(readyBody.taxonomyVersion, AFC_QA_ISSUE_TAXONOMY_VERSION);
  assert.equal(readyBody.machineStatusSnapshot, "ready");
  assert.deepEqual(readyBody.issueCodes, ["perspective_off", "other"]);
  assert.equal(readyBody.notes, "capture note");
  assert.equal((readyBody.review as Record<string, unknown>).reviewStatus, "new");
  assert.equal((readyBody.review as Record<string, unknown>).reviewerUserId, null);
  assert.equal((readyBody.review as Record<string, unknown>).reviewNotes, null);
  assert.equal((readyBody.review as Record<string, unknown>).reviewedAt, null);
  assertAfcDiagnosticAdminPayloadPrivacy(readyBody);

  const insert = ready.world.inserts[0];
  const generation = ready.world.captureGenerations[0];
  const parsed = parseAfcDiagnosticAdminCaptureRequest({
    generationId: GEN_1,
    issueCodes: ["perspective_off", "other"],
    notes: "  capture note  ",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const expected = deriveAfcDiagnosticAdminCaptureInsert({
    session: ready.world.session,
    generation,
    request: parsed.value,
    originalSha256: SHA_A,
  });
  assert.deepEqual(insert, expected);
  assert.equal(insert.reporter_user_id, USER_A);
  assert.notEqual(insert.reporter_user_id, ADMIN_ID);
  assert.equal(insert.trigger, "admin_capture");
  assert.equal(insert.original_sha256, SHA_A);
  assert.deepEqual(
    insert.original_identity,
    buildAfcDiagnosticOriginalIdentity({
      generation,
      session: ready.world.session,
    }),
  );
  assert.equal("submitted_at" in insert, false);
  assert.equal("review_status" in insert, false);
  assert.equal("reviewer_user_id" in insert, false);
  assert.equal("review_notes" in insert, false);
  assert.equal("reviewed_at" in insert, false);
  assert.deepEqual(Object.keys(insert).sort(), [...AFC_DIAGNOSTIC_ADMIN_CAPTURE_INSERT_COLUMNS].sort());

  const failed = await capturePost({
    body: { generationId: GEN_2, issueCodes: ["scale_incorrect"] },
  });
  assert.equal(failed.response.status, 201);
  const failedBody = await jsonBody(failed.response);
  assert.equal(failedBody.reportedGenerationId, GEN_2);
  assert.equal(failedBody.machineStatusSnapshot, "failed");
  assert.equal(failed.world.inserts[0].machine_status_snapshot, "failed");
});

test("closed Sessions and historical non-latest members are capturable", async () => {
  const closed = await capturePost({
    world: world({ session: sessionRecord({ status: "closed" }) }),
    body: { generationId: GEN_1, issueCodes: ["other"] },
  });
  assert.equal(closed.response.status, 201);

  const historical = await capturePost({
    body: { generationId: GEN_1, issueCodes: ["wall_edges_unrecognized"] },
  });
  assert.equal(historical.response.status, 201);
  assert.equal(historical.world.inserts[0].reported_generation_id, GEN_1);
});

test("existing tester or admin_capture Cases do not block a new insert and there is no 409 path", async () => {
  const current = world({
    cases: [
      existingCase(),
      existingCase({
        id: CASE_ADMIN,
        trigger: "admin_capture",
        notes: "prior admin",
      }),
    ],
  });
  const first = await capturePost({
    world: current,
    body: { generationId: GEN_1, issueCodes: ["other"], notes: "one" },
  });
  assert.equal(first.response.status, 201);
  const second = await capturePost({
    world: current,
    body: { generationId: GEN_1, issueCodes: ["other"], notes: "one" },
  });
  assert.equal(second.response.status, 201);
  assert.notEqual(second.response.status, 409);
  assert.equal(current.inserts.length, 2);
  assert.equal(
    current.cases.filter((row) => row.trigger === "admin_capture").length,
    3,
  );
  assert.equal(
    current.preCases.find((row) => row.id === CASE_TESTER)?.trigger,
    "manual_report",
  );
  assert.equal(
    current.cases.find((row) => row.id === CASE_TESTER)?.notes,
    "tester notes",
  );
});

test("capture does not write Sessions, membership, Generations, Rooms, Storage, or existing Cases", async () => {
  const current = world({ cases: [existingCase()] });
  const { response } = await capturePost({
    world: current,
    body: { generationId: GEN_2, issueCodes: ["other"] },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(current.session, current.preSession);
  assert.deepEqual(current.captureGenerations, current.preGenerations);
  assert.equal(current.sessionWrites.length, 0);
  assert.equal(current.membershipWrites.length, 0);
  assert.equal(current.generationWrites.length, 0);
  assert.equal(current.roomWrites.length, 0);
  assert.equal(current.caseUpdates.length, 0);
  assert.equal(current.storageWrites.length, 0);
  assert.equal(current.cases.find((row) => row.id === CASE_TESTER)?.id, CASE_TESTER);
});

test("store failure after auth is a generic 500", async () => {
  const current = world();
  current.captureStore.findSessionById = async () => {
    throw new Error("db down");
  };
  const { response } = await capturePost({ world: current });
  assert.equal(response.status, 500);
  const body = await jsonBody(response);
  assert.deepEqual(body, { error: "Server error." });
  assert.doesNotMatch(JSON.stringify(body), /db down|service_role|SQL/);
});

test("supabase capture insert uses the exact column allowlist", async () => {
  const ops: Array<{ table: string; action: string; payload?: Record<string, unknown> }> =
    [];
  const client = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        insert(payload: Record<string, unknown>) {
          ops.push({ table, action: "insert", payload: { ...payload } });
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: { id: CASE_ADMIN },
            error: null,
          });
        },
      };
    },
  };
  const store = createSupabaseAfcDiagnosticAdminCaptureStore(client);
  await store.insertAdminCaptureCase({
    session_id: SESSION_A,
    room_id: ROOM_A,
    reporter_user_id: USER_A,
    reported_generation_id: GEN_1,
    original_sha256: SHA_A,
    original_identity: { decodedWidth: 1200 },
    taxonomy_version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    issue_codes: ["other"],
    notes: null,
    trigger: "admin_capture",
    machine_status_snapshot: "ready",
  });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].table, AFC_DIAGNOSTIC_CASE_TABLE);
  assert.notEqual(ops[0].table, AFC_GENERATION_TABLE);
  assert.deepEqual(
    Object.keys(ops[0].payload ?? {}).sort(),
    [...AFC_DIAGNOSTIC_ADMIN_CAPTURE_INSERT_COLUMNS].sort(),
  );
  assert.equal(ops[0].payload?.trigger, "admin_capture");
  assert.equal(ops[0].payload?.reporter_user_id, USER_A);
  assert.equal("submitted_at" in (ops[0].payload ?? {}), false);
  assert.equal("review_status" in (ops[0].payload ?? {}), false);
});

test("Cache-Control is no-store on success and mapped errors", async () => {
  const created = await capturePost({});
  assert.equal(created.response.headers.get("Cache-Control"), "no-store");
  const notFound = await capturePost({
    body: { generationId: GEN_OTHER, issueCodes: ["other"] },
  });
  assert.equal(notFound.response.headers.get("Cache-Control"), "no-store");
});
