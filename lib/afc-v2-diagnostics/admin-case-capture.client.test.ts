import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY,
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_ISSUE_OPTIONS,
  afcDiagnosticAdminCaptureErrorMessage,
  buildAfcDiagnosticAdminCaptureBody,
  buildAfcDiagnosticAdminCaptureCasePageUrl,
  buildAfcDiagnosticAdminCaptureSessionPageUrl,
  buildAfcDiagnosticAdminCaptureUrl,
  canSubmitAfcDiagnosticAdminCapture,
  defaultAfcDiagnosticAdminCaptureAttemptOrdinal,
  postAfcDiagnosticAdminCaptureCase,
} from "./admin-case-capture.client";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const NEW_CASE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "22222222-2222-4222-8222-222222222222";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const GEN_RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_A = "99999999-9999-4999-8999-999999999999";
const SHA_A = "a".repeat(64);
const EMPTY_SHA = "e".repeat(64);
const TILED_SHA = "f".repeat(64);

function fingerprint() {
  return {
    fingerprintSchemaVersion: "afc-v2-engine-fingerprint/v1",
    productionSchemaVersion: "afc-v2-production-room-authority/v1",
    gitSha: "abc123def456",
    observationModelId: "obs-model",
    engineVersions: {
      liveProduct: "lp",
      autoMetric: "am",
      cameraCalibration: "cc",
      cameraAuthority: "ca",
      collision: "col",
      emptyAuthoritativeCollision: "eac",
    },
    tiled: {
      generatorId: "gen",
      profileId: "prof",
      researchPreset: "preset",
      requestedModelId: "model",
      readerVersion: null,
    },
  };
}

function generation(overrides: Record<string, unknown> = {}) {
  return {
    generationId: GEN_1,
    roomId: ROOM_A,
    userId: USER_A,
    parentGenerationId: null,
    lineageSeq: 32,
    runId: "run-1",
    intent: "analyze",
    status: "ready",
    createdAt: "2026-09-18T12:00:00.000Z",
    completedAt: "2026-09-18T12:00:01.000Z",
    frame: { width: 1200, height: 800 },
    failureReason: null,
    metricStatus: "path_a",
    collisionStatus: "empty_authoritative",
    analysisStatus: "applied",
    analysisReason: null,
    recoverySafeFailureState: "none",
    engineFingerprint: fingerprint(),
    original: {
      originalSha256: SHA_A,
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 98016,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: null,
    },
    empty: { present: true, sha256: EMPTY_SHA, artifactSource: "generated" },
    tiled: { present: true, sha256: TILED_SHA, artifactSource: "durable" },
    ...overrides,
  };
}

function caseDetail(overrides: Record<string, unknown> = {}) {
  return {
    caseId: NEW_CASE,
    submittedAt: "2026-09-20T18:00:00.000Z",
    roomId: ROOM_A,
    sessionId: SESSION_A,
    reporterUserId: USER_A,
    reportedGenerationId: GEN_1,
    reportedAttemptOrdinal: 1,
    trigger: "admin_capture",
    origin: "admin",
    taxonomyVersion: "afc-qa-issue-taxonomy/v1",
    issueCodes: ["perspective_off"],
    notes: "capture note",
    machineStatusSnapshot: "ready",
    source: {
      originalSha256: SHA_A,
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 98016,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: ASSET_A,
    },
    review: {
      reviewStatus: "new",
      reviewerUserId: null,
      reviewNotes: null,
      reviewedAt: null,
    },
    session: {
      sessionId: SESSION_A,
      status: "open",
      sessionUserId: USER_A,
      roomId: ROOM_A,
      originalSha256: SHA_A,
      attemptCount: 2,
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:05:00.000Z",
    },
    reportedGeneration: generation(),
    ...overrides,
  };
}

test("URL builder encodes the Session ID on the nested cases path", () => {
  assert.equal(
    buildAfcDiagnosticAdminCaptureUrl(SESSION_A),
    `/api/admin/afc-diagnostics/sessions/${SESSION_A}/cases`,
  );
  assert.equal(
    buildAfcDiagnosticAdminCaptureUrl("sess/ion?x=1"),
    "/api/admin/afc-diagnostics/sessions/sess%2Fion%3Fx%3D1/cases",
  );
  assert.equal(
    buildAfcDiagnosticAdminCaptureCasePageUrl(CASE_1),
    `/admin/afc-diagnostics/cases/${CASE_1}`,
  );
  assert.equal(
    buildAfcDiagnosticAdminCaptureSessionPageUrl(SESSION_A, GEN_2),
    `/admin/afc-diagnostics/sessions/${SESSION_A}?generationId=${GEN_2}`,
  );
});

test("POST body is exact and notes are normalized", () => {
  assert.deepEqual(
    buildAfcDiagnosticAdminCaptureBody({
      generationId: GEN_1,
      issueCodes: ["perspective_off", "other"],
      notes: "  looking off  ",
    }),
    {
      generationId: GEN_1,
      issueCodes: ["perspective_off", "other"],
      notes: "looking off",
    },
  );
  assert.deepEqual(
    buildAfcDiagnosticAdminCaptureBody({
      generationId: GEN_1,
      issueCodes: ["other"],
      notes: "   ",
    }),
    {
      generationId: GEN_1,
      issueCodes: ["other"],
      notes: null,
    },
  );
});

test("eligibility requires a terminal attempt and at least one issue", () => {
  const base = {
    generationId: GEN_1,
    issueCodes: ["perspective_off"],
    notes: "",
    submitting: false,
  };
  assert.equal(
    canSubmitAfcDiagnosticAdminCapture({ ...base, status: "ready" }),
    true,
  );
  assert.equal(
    canSubmitAfcDiagnosticAdminCapture({ ...base, status: "failed" }),
    true,
  );
  assert.equal(
    canSubmitAfcDiagnosticAdminCapture({ ...base, status: "running" }),
    false,
  );
  assert.equal(
    canSubmitAfcDiagnosticAdminCapture({
      ...base,
      status: "ready",
      issueCodes: [],
    }),
    false,
  );
  assert.equal(
    canSubmitAfcDiagnosticAdminCapture({
      ...base,
      status: "ready",
      generationId: null,
    }),
    false,
  );
  assert.equal(
    canSubmitAfcDiagnosticAdminCapture({
      ...base,
      status: "ready",
      submitting: true,
    }),
    false,
  );
});

test("default attempt prefers query member, else latest terminal", () => {
  const attempts = [
    {
      attemptOrdinal: 1,
      generationId: GEN_1,
      generation: { status: "ready" as const },
    },
    {
      attemptOrdinal: 2,
      generationId: GEN_2,
      generation: { status: "failed" as const },
    },
    {
      attemptOrdinal: 3,
      generationId: GEN_RUN,
      generation: { status: "running" as const },
    },
  ];
  assert.equal(
    defaultAfcDiagnosticAdminCaptureAttemptOrdinal({
      attempts,
      preferredGenerationId: GEN_1,
    }),
    1,
  );
  assert.equal(
    defaultAfcDiagnosticAdminCaptureAttemptOrdinal({
      attempts,
      preferredGenerationId: "00000000-0000-4000-8000-000000000000",
    }),
    2,
  );
  assert.equal(
    defaultAfcDiagnosticAdminCaptureAttemptOrdinal({ attempts }),
    2,
  );
  assert.equal(
    defaultAfcDiagnosticAdminCaptureAttemptOrdinal({
      attempts,
      preferredGenerationId: GEN_RUN,
    }),
    3,
  );
  assert.equal(
    defaultAfcDiagnosticAdminCaptureAttemptOrdinal({
      attempts,
      preserveOrdinal: 1,
    }),
    1,
  );
});

test("error copy is generic and status-mapped", () => {
  assert.equal(
    afcDiagnosticAdminCaptureErrorMessage(400),
    "Invalid Case capture request.",
  );
  assert.equal(
    afcDiagnosticAdminCaptureErrorMessage(401),
    "You need to sign in to access AFC Diagnostics.",
  );
  assert.equal(
    afcDiagnosticAdminCaptureErrorMessage(403),
    "You don't have admin access to AFC Diagnostics.",
  );
  assert.equal(
    afcDiagnosticAdminCaptureErrorMessage(404),
    "That Session attempt isn't available for capture.",
  );
  assert.equal(
    afcDiagnosticAdminCaptureErrorMessage(500),
    "Couldn't create Case. Try again.",
  );
  assert.equal(
    afcDiagnosticAdminCaptureErrorMessage("network"),
    "Couldn't create Case. Try again.",
  );
  assert.equal(
    AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.title,
    "Create Case from this attempt",
  );
  assert.deepEqual(
    AFC_DIAGNOSTIC_ADMIN_CAPTURE_ISSUE_OPTIONS.map((option) => option.code),
    ["perspective_off", "wall_edges_unrecognized", "scale_incorrect", "other"],
  );
});

test("POST helper sends the exact body with same-origin credentials and parses Case detail", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const payload = caseDetail();
  const result = await postAfcDiagnosticAdminCaptureCase({
    sessionId: SESSION_A,
    generationId: GEN_1,
    issueCodes: ["perspective_off"],
    notes: "  capture note  ",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(payload), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.detail.caseId, NEW_CASE);
  assert.equal(result.detail.trigger, "admin_capture");
  assert.equal(result.detail.origin, "admin");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `/api/admin/afc-diagnostics/sessions/${SESSION_A}/cases`,
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(
    calls[0].init.body,
    JSON.stringify({
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      notes: "capture note",
    }),
  );
});

test("POST helper rejects malformed success and maps errors without leaking details", async () => {
  const malformed = await postAfcDiagnosticAdminCaptureCase({
    sessionId: SESSION_A,
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: "",
    fetchImpl: async () =>
      new Response(JSON.stringify({ submitted: true }), { status: 201 }),
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.status, 500);
    assert.equal(malformed.message, AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.errorGeneric);
  }

  for (const status of [400, 401, 403, 404, 500] as const) {
    const result = await postAfcDiagnosticAdminCaptureCase({
      sessionId: SESSION_A,
      generationId: GEN_1,
      issueCodes: ["other"],
      notes: "keep me",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "secret internals" }), { status }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, status);
    assert.equal(result.message, afcDiagnosticAdminCaptureErrorMessage(status));
    assert.doesNotMatch(result.message, /secret internals/);
  }

  const network = await postAfcDiagnosticAdminCaptureCase({
    sessionId: SESSION_A,
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: "keep me",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(network.ok, false);
  if (!network.ok) {
    assert.equal(network.status, "network");
    assert.equal(network.message, AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.errorGeneric);
  }
});
