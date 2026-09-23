import assert from "node:assert/strict";
import test from "node:test";

import { afcDiagnosticsAdminJson } from "./admin-auth.server";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  type AfcDiagnosticAdminCaseDetailRecord,
  type AfcDiagnosticAdminGenerationEvidence,
  type AfcDiagnosticAdminMembershipRecord,
  type AfcDiagnosticAdminSessionRecord,
} from "./admin-read-model";
import {
  AFC_GENERATION_TABLE,
  type AfcDiagnosticAdminReadStore,
} from "./admin-read-model.server";
import { AFC_DIAGNOSTIC_CASE_TABLE } from "./contracts";
import { AFC_QA_ISSUE_TAXONOMY_VERSION } from "./taxonomy";
import {
  AFC_DIAGNOSTIC_ADMIN_REVIEW_COLUMNS,
  createSupabaseAfcDiagnosticAdminReviewStore,
  handleAfcDiagnosticsAdminCaseReviewPatch,
  type AfcDiagnosticAdminReviewStore,
} from "./admin-review.server";
import type { AfcDiagnosticsAdminAuth } from "./admin-auth.server";
import type { AfcDiagnosticAdminReviewUpdate } from "./admin-review";

const USER_A = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ADMIN = "66666666-6666-4666-8666-666666666666";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_A = "99999999-9999-4999-8999-999999999999";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SHA_A = "a".repeat(64);
const EMPTY_SHA = "e".repeat(64);
const TILED_SHA = "f".repeat(64);
const NOW = "2026-09-20T18:00:00.000Z";
const REVIEWED_AT = "2026-09-19T13:00:00.000Z";
const MISSING_CASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";

const EVIDENCE_FIELDS = [
  "issueCodes",
  "notes",
  "trigger",
  "reportedGenerationId",
  "taxonomyVersion",
  "machineStatusSnapshot",
  "submittedAt",
  "reporterUserId",
  "roomId",
  "sessionId",
  "originalSha256",
  "originalIdentity",
] as const;

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

function generationEvidence(): AfcDiagnosticAdminGenerationEvidence {
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
  });
}

function sessionRecord(): AfcDiagnosticAdminSessionRecord {
  return Object.freeze({
    id: SESSION_A,
    status: "open",
    roomId: ROOM_A,
    userId: USER_A,
    originalSha256: SHA_A,
    baseAssetId: ASSET_A,
    createdAt: "2026-09-18T11:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  });
}

function membershipRecord(): AfcDiagnosticAdminMembershipRecord {
  return Object.freeze({
    sessionId: SESSION_A,
    generationId: GEN_1,
    attemptOrdinal: 1,
    intent: "analyze",
    associatedAt: "2026-09-18T12:00:00.000Z",
  });
}

type MutableCaseDetail = {
  id: string;
  submittedAt: string;
  reviewStatus: AfcDiagnosticAdminCaseDetailRecord["reviewStatus"];
  trigger: AfcDiagnosticAdminCaseDetailRecord["trigger"];
  issueCodes: readonly string[];
  taxonomyVersion: string;
  notes: string | null;
  roomId: string;
  sessionId: string;
  reportedGenerationId: string;
  machineStatusSnapshot: AfcDiagnosticAdminCaseDetailRecord["machineStatusSnapshot"];
  reporterUserId: string;
  originalSha256: string;
  originalIdentity: unknown;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
};

function caseRecord(
  overrides: Partial<MutableCaseDetail> = {},
): MutableCaseDetail {
  return {
    id: CASE_1,
    submittedAt: "2026-09-19T12:00:00.000Z",
    reviewStatus: "new",
    trigger: "manual_report",
    issueCodes: Object.freeze(["perspective_off"]),
    taxonomyVersion: AFC_QA_ISSUE_TAXONOMY_VERSION,
    notes: "looks tilted",
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

function evidenceSnapshot(row: MutableCaseDetail) {
  const snapshot: Record<string, unknown> = { id: row.id };
  for (const field of EVIDENCE_FIELDS) {
    snapshot[field] = row[field];
  }
  return snapshot;
}

function world(overrides: Partial<MutableCaseDetail> = {}) {
  const row = caseRecord(overrides);
  const session = sessionRecord();
  const membership = membershipRecord();
  const generation = generationEvidence();
  const updates: Array<{ caseId: string; update: AfcDiagnosticAdminReviewUpdate }> =
    [];
  const sessionMutations: string[] = [];
  const generationMutations: string[] = [];

  const reviewStore: AfcDiagnosticAdminReviewStore = {
    async findCaseReviewById(caseId) {
      if (caseId !== row.id) return null;
      return {
        reviewStatus: row.reviewStatus,
        reviewerUserId: row.reviewerUserId,
        reviewNotes: row.reviewNotes,
        reviewedAt: row.reviewedAt,
      };
    },
    async updateCaseReview(caseId, update) {
      updates.push({ caseId, update });
      if (caseId !== row.id) return;
      row.reviewStatus = update.review_status;
      row.reviewerUserId = update.reviewer_user_id;
      row.reviewNotes = update.review_notes;
      row.reviewedAt = update.reviewed_at;
    },
  };

  const readStore: AfcDiagnosticAdminReadStore = {
    async listCases() {
      throw new Error("listCases should not run during review PATCH");
    },
    async findCaseById(caseId) {
      return caseId === row.id ? row : null;
    },
    async findSessionById(sessionId) {
      return sessionId === session.id ? session : null;
    },
    async listSessionStatusesByIds() {
      throw new Error("listSessionStatusesByIds should not run during review PATCH");
    },
    async listMembershipSessionIds() {
      throw new Error("listMembershipSessionIds should not run during review PATCH");
    },
    async listMembershipsBySessionId(sessionId) {
      return sessionId === session.id ? [membership] : [];
    },
    async findGenerationById(generationId) {
      return generationId === generation.generationId ? generation : null;
    },
    async listGenerationsByIds() {
      throw new Error("listGenerationsByIds should not run during review PATCH");
    },
  };

  return {
    row,
    session,
    generation,
    reviewStore,
    readStore,
    updates,
    sessionMutations,
    generationMutations,
    preEvidence: evidenceSnapshot(row),
    preSession: structuredClone(session),
    preGeneration: structuredClone(generation),
  };
}

async function patchReview(input: {
  caseId?: string;
  body?: unknown;
  rawBody?: string;
  authorize?: () => Promise<AfcDiagnosticsAdminAuth>;
  world?: ReturnType<typeof world>;
  getReviewStore?: () => AfcDiagnosticAdminReviewStore | null;
  getReadStore?: () => AfcDiagnosticAdminReadStore | null;
}) {
  const current = input.world ?? world();
  const request =
    input.rawBody != null
      ? new Request(`http://test/api/admin/afc-diagnostics/cases/${input.caseId ?? CASE_1}/review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: input.rawBody,
        })
      : new Request(`http://test/api/admin/afc-diagnostics/cases/${input.caseId ?? CASE_1}/review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input.body ?? { reviewStatus: "new", reviewNotes: null }),
        });
  const response = await handleAfcDiagnosticsAdminCaseReviewPatch({
    request,
    caseId: input.caseId ?? CASE_1,
    authorize: input.authorize ?? (async () => adminOk()),
    reviewStore: input.getReviewStore || input.getReadStore ? undefined : current.reviewStore,
    readStore: input.getReviewStore || input.getReadStore ? undefined : current.readStore,
    getReviewStore: input.getReviewStore,
    getReadStore: input.getReadStore,
    now: () => NOW,
  });
  return { response, world: current };
}

test("401 unauthenticated does not construct stores", async () => {
  let built = 0;
  const current = world();
  const { response } = await patchReview({
    authorize: async () => unauthorized(),
    getReviewStore: () => {
      built += 1;
      return current.reviewStore;
    },
    getReadStore: () => {
      built += 1;
      return current.readStore;
    },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await jsonBody(response), { error: "Unauthorized." });
  assert.equal(built, 0);
  assert.equal(current.updates.length, 0);
});

test("403 non-admin does not construct stores", async () => {
  let built = 0;
  const current = world();
  const { response } = await patchReview({
    authorize: async () => forbidden(),
    getReviewStore: () => {
      built += 1;
      return current.reviewStore;
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

test("malformed JSON, invalid UUID, unknown key, bad status, and long note are 400", async () => {
  let built = 0;
  const current = world();
  const getters = {
    getReviewStore: () => {
      built += 1;
      return current.reviewStore;
    },
    getReadStore: () => {
      built += 1;
      return current.readStore;
    },
  };

  const badJson = await patchReview({ rawBody: "{", ...getters });
  assert.equal(badJson.response.status, 400);
  assert.deepEqual(await jsonBody(badJson.response), { error: "Invalid request." });

  const invalidUuid = await patchReview({
    caseId: "not-a-uuid",
    ...getters,
  });
  assert.equal(invalidUuid.response.status, 400);

  const unknownKey = await patchReview({
    body: {
      reviewStatus: "new",
      reviewNotes: null,
      reviewerUserId: ADMIN_ID,
    },
    ...getters,
  });
  assert.equal(unknownKey.response.status, 400);

  const badStatus = await patchReview({
    body: { reviewStatus: "resolved", reviewNotes: null },
    ...getters,
  });
  assert.equal(badStatus.response.status, 400);

  const longNote = await patchReview({
    body: { reviewStatus: "new", reviewNotes: "a".repeat(2001) },
    ...getters,
  });
  assert.equal(longNote.response.status, 400);
  assert.equal(built, 0);
  assert.equal(current.updates.length, 0);
});

test("nonexistent Case is an opaque 404", async () => {
  const { response, world: current } = await patchReview({
    caseId: MISSING_CASE,
    body: { reviewStatus: "in_review", reviewNotes: null },
  });
  assert.equal(response.status, 404);
  const missingBody = await jsonBody(response);
  assert.deepEqual(missingBody, { error: "Not found." });
  assert.doesNotMatch(JSON.stringify(missingBody), /SQL|postgres|service_role/i);
  assert.equal(current.updates.length, 0);
});

test("every allowed transition persists and returns Case detail", async () => {
  const cases: Array<{
    from: AfcDiagnosticAdminCaseDetailRecord["reviewStatus"];
    body: { reviewStatus: "new" | "in_review" | "closed"; reviewNotes: string | null };
    expectedStatus: "new" | "in_review" | "closed";
    expectedReviewer: string | null;
    expectedReviewedAt: string | null;
  }> = [
    {
      from: "new",
      body: { reviewStatus: "new", reviewNotes: "note" },
      expectedStatus: "new",
      expectedReviewer: null,
      expectedReviewedAt: null,
    },
    {
      from: "new",
      body: { reviewStatus: "in_review", reviewNotes: null },
      expectedStatus: "in_review",
      expectedReviewer: ADMIN_ID,
      expectedReviewedAt: NOW,
    },
    {
      from: "new",
      body: { reviewStatus: "closed", reviewNotes: null },
      expectedStatus: "closed",
      expectedReviewer: ADMIN_ID,
      expectedReviewedAt: NOW,
    },
    {
      from: "in_review",
      body: { reviewStatus: "in_review", reviewNotes: "edit" },
      expectedStatus: "in_review",
      expectedReviewer: ADMIN_ID,
      expectedReviewedAt: NOW,
    },
    {
      from: "in_review",
      body: { reviewStatus: "closed", reviewNotes: "closing" },
      expectedStatus: "closed",
      expectedReviewer: ADMIN_ID,
      expectedReviewedAt: NOW,
    },
    {
      from: "closed",
      body: { reviewStatus: "closed", reviewNotes: "still closed" },
      expectedStatus: "closed",
      expectedReviewer: ADMIN_ID,
      expectedReviewedAt: NOW,
    },
    {
      from: "closed",
      body: { reviewStatus: "in_review", reviewNotes: "reopen" },
      expectedStatus: "in_review",
      expectedReviewer: ADMIN_ID,
      expectedReviewedAt: NOW,
    },
  ];

  for (const entry of cases) {
    const current = world({
      reviewStatus: entry.from,
      reviewerUserId: entry.from === "new" ? null : OTHER_ADMIN,
      reviewNotes: entry.from === "new" ? null : "prior",
      reviewedAt: entry.from === "new" ? null : REVIEWED_AT,
    });
    const before = evidenceSnapshot(current.row);
    const { response } = await patchReview({
      world: current,
      body: entry.body,
    });
    assert.equal(response.status, 200, `${entry.from} -> ${entry.body.reviewStatus}`);
    const body = await jsonBody(response);
    assert.equal(body.caseId, CASE_1);
    assert.equal((body.review as Record<string, unknown>).reviewStatus, entry.expectedStatus);
    assert.equal((body.review as Record<string, unknown>).reviewerUserId, entry.expectedReviewer);
    assert.equal((body.review as Record<string, unknown>).reviewedAt, entry.expectedReviewedAt);
    assert.equal((body.review as Record<string, unknown>).reviewNotes, entry.body.reviewNotes);
    assert.deepEqual(evidenceSnapshot(current.row), before);
    assert.deepEqual(current.session, current.preSession);
    assert.deepEqual(current.generation, current.preGeneration);
    assert.equal(current.updates.length, 1);
    assert.deepEqual(Object.keys(current.updates[0].update).sort(), [
      ...AFC_DIAGNOSTIC_ADMIN_REVIEW_COLUMNS,
    ].sort());
    assertAfcDiagnosticAdminPayloadPrivacy(body);
  }
});

test("forbidden transitions are 409 and do not write", async () => {
  for (const entry of [
    { from: "in_review" as const, to: "new" as const },
    { from: "closed" as const, to: "new" as const },
  ]) {
    const current = world({
      reviewStatus: entry.from,
      reviewerUserId: OTHER_ADMIN,
      reviewNotes: "prior",
      reviewedAt: REVIEWED_AT,
    });
    const before = evidenceSnapshot(current.row);
    const { response } = await patchReview({
      world: current,
      body: { reviewStatus: entry.to, reviewNotes: "nope" },
    });
    assert.equal(response.status, 409, `${entry.from} -> ${entry.to}`);
    assert.deepEqual(await jsonBody(response), { error: "Conflict." });
    assert.equal(current.updates.length, 0);
    assert.deepEqual(evidenceSnapshot(current.row), before);
    assert.equal(current.row.reviewStatus, entry.from);
    assert.equal(current.row.reviewerUserId, OTHER_ADMIN);
    assert.equal(current.row.reviewedAt, REVIEWED_AT);
  }
});

test("same-state no-op skips UPDATE and leaves reviewer/reviewed_at unchanged", async () => {
  const current = world({
    reviewStatus: "in_review",
    reviewerUserId: OTHER_ADMIN,
    reviewNotes: "same",
    reviewedAt: REVIEWED_AT,
  });
  const { response } = await patchReview({
    world: current,
    body: { reviewStatus: "in_review", reviewNotes: "  same  " },
  });
  assert.equal(response.status, 200);
  assert.equal(current.updates.length, 0);
  const body = await jsonBody(response);
  assert.equal((body.review as Record<string, unknown>).reviewStatus, "in_review");
  assert.equal((body.review as Record<string, unknown>).reviewerUserId, OTHER_ADMIN);
  assert.equal((body.review as Record<string, unknown>).reviewedAt, REVIEWED_AT);
  assert.equal((body.review as Record<string, unknown>).reviewNotes, "same");
  assert.equal(body.notes, "looks tilted");
  assert.deepEqual(body.issueCodes, ["perspective_off"]);
  assertAfcDiagnosticAdminPayloadPrivacy(body);
});

test("new notes-only writes notes and keeps reviewer/timestamp unset", async () => {
  const current = world();
  const { response } = await patchReview({
    world: current,
    body: { reviewStatus: "new", reviewNotes: "  admin note  " },
  });
  assert.equal(response.status, 200);
  assert.equal(current.updates.length, 1);
  assert.deepEqual(current.updates[0].update, {
    review_status: "new",
    reviewer_user_id: null,
    review_notes: "admin note",
    reviewed_at: null,
  });
  const body = await jsonBody(response);
  assert.equal((body.review as Record<string, unknown>).reviewStatus, "new");
  assert.equal((body.review as Record<string, unknown>).reviewerUserId, null);
  assert.equal((body.review as Record<string, unknown>).reviewedAt, null);
  assert.equal((body.review as Record<string, unknown>).reviewNotes, "admin note");
});

test("update payload never includes evidence fields and does not mutate Session/Generation", async () => {
  const current = world();
  await patchReview({
    world: current,
    body: { reviewStatus: "in_review", reviewNotes: "checking" },
  });
  assert.equal(current.updates.length, 1);
  const payload = current.updates[0].update as Record<string, unknown>;
  for (const forbidden of [
    "issue_codes",
    "notes",
    "trigger",
    "reported_generation_id",
    "taxonomy_version",
    "machine_status_snapshot",
    "submitted_at",
    "reporter_user_id",
    "room_id",
    "session_id",
    "original_sha256",
    "original_identity",
    "id",
  ]) {
    assert.equal(forbidden in payload, false, forbidden);
  }
  assert.deepEqual(current.session, current.preSession);
  assert.deepEqual(current.generation, current.preGeneration);
  assert.equal(current.sessionMutations.length, 0);
  assert.equal(current.generationMutations.length, 0);
});

test("store failure after auth is a generic 500", async () => {
  const current = world();
  current.reviewStore.findCaseReviewById = async () => {
    throw new Error("db down");
  };
  const { response } = await patchReview({
    world: current,
    body: { reviewStatus: "in_review", reviewNotes: null },
  });
  assert.equal(response.status, 500);
  const body = await jsonBody(response);
  assert.deepEqual(body, { error: "Server error." });
  assert.doesNotMatch(JSON.stringify(body), /db down|service_role|SQL/);
});

test("supabase review store update uses the exact four-column whitelist", async () => {
  const ops: Array<{ table: string; action: string; payload?: Record<string, unknown> }> =
    [];
  const client = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        update(payload: Record<string, unknown>) {
          ops.push({ table, action: "update", payload: { ...payload } });
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              review_status: "new",
              reviewer_user_id: null,
              review_notes: null,
              reviewed_at: null,
            },
            error: null,
          });
        },
        then(
          onfulfilled?: (value: { data: null; error: null }) => unknown,
          onrejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({ data: null, error: null }).then(
            onfulfilled,
            onrejected,
          );
        },
      };
    },
  };
  const store = createSupabaseAfcDiagnosticAdminReviewStore(client);
  await store.updateCaseReview(CASE_1, {
    review_status: "closed",
    reviewer_user_id: ADMIN_ID,
    review_notes: "done",
    reviewed_at: NOW,
  });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].table, AFC_DIAGNOSTIC_CASE_TABLE);
  assert.notEqual(ops[0].table, AFC_GENERATION_TABLE);
  assert.deepEqual(Object.keys(ops[0].payload ?? {}).sort(), [
    "review_notes",
    "review_status",
    "reviewed_at",
    "reviewer_user_id",
  ]);
  assert.deepEqual(ops[0].payload, {
    review_status: "closed",
    reviewer_user_id: ADMIN_ID,
    review_notes: "done",
    reviewed_at: NOW,
  });
});
