import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY,
  AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS,
  afcDiagnosticAdminReviewErrorMessage,
  afcDiagnosticAdminReviewStatusLabel,
  allowedAfcDiagnosticAdminReviewTargets,
  buildAfcDiagnosticAdminReviewPatchBody,
  buildAfcDiagnosticAdminReviewUrl,
  createAfcDiagnosticAdminReviewDraft,
  isAfcDiagnosticAdminReviewDraftDirty,
  isAfcDiagnosticAdminReviewTargetDisabled,
  parseAfcDiagnosticAdminReviewSaved,
  patchAfcDiagnosticAdminCaseReview,
} from "./admin-case-review.client";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
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

function generation() {
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
  };
}

function caseDetail(overrides: Record<string, unknown> = {}) {
  return {
    caseId: CASE_1,
    submittedAt: "2026-09-18T12:10:00.000Z",
    roomId: ROOM_A,
    sessionId: SESSION_A,
    reporterUserId: USER_A,
    reportedGenerationId: GEN_1,
    reportedAttemptOrdinal: 1,
    trigger: "manual_report",
    origin: "tester",
    taxonomyVersion: "afc-qa-issue-taxonomy/v1",
    issueCodes: ["perspective_off"],
    notes: "tester notes stay put",
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
      reviewStatus: "in_review",
      reviewerUserId: ADMIN_ID,
      reviewNotes: "checking walls",
      reviewedAt: "2026-09-19T13:00:00.000Z",
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

test("status labels stay New / In review / Closed", () => {
  assert.equal(afcDiagnosticAdminReviewStatusLabel("new"), "New");
  assert.equal(afcDiagnosticAdminReviewStatusLabel("in_review"), "In review");
  assert.equal(afcDiagnosticAdminReviewStatusLabel("closed"), "Closed");
  assert.equal(AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS.new, "New");
  assert.doesNotMatch(JSON.stringify(AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS), /Resolved|Fixed|Done/);
});

test("URL builder is case-scoped review PATCH path", () => {
  assert.equal(
    buildAfcDiagnosticAdminReviewUrl(CASE_1),
    `/api/admin/afc-diagnostics/cases/${CASE_1}/review`,
  );
});

test("saved review, draft, dirty, reset, and whitespace normalization", () => {
  const saved = parseAfcDiagnosticAdminReviewSaved({
    reviewStatus: "new",
    reviewerUserId: null,
    reviewNotes: "hello",
    reviewedAt: null,
  });
  assert.ok(saved);
  if (!saved) return;
  const draft = createAfcDiagnosticAdminReviewDraft(saved);
  assert.deepEqual(draft, { reviewStatus: "new", reviewNotes: "hello" });
  assert.equal(isAfcDiagnosticAdminReviewDraftDirty(saved, draft), false);

  assert.equal(
    isAfcDiagnosticAdminReviewDraftDirty(saved, {
      reviewStatus: "in_review",
      reviewNotes: "hello",
    }),
    true,
  );
  assert.equal(
    isAfcDiagnosticAdminReviewDraftDirty(saved, {
      reviewStatus: "new",
      reviewNotes: "changed",
    }),
    true,
  );
  assert.equal(
    isAfcDiagnosticAdminReviewDraftDirty(saved, {
      reviewStatus: "new",
      reviewNotes: "  hello  ",
    }),
    false,
  );
  assert.equal(
    isAfcDiagnosticAdminReviewDraftDirty(
      { ...saved, reviewNotes: null },
      { reviewStatus: "new", reviewNotes: "   " },
    ),
    false,
  );

  const reset = createAfcDiagnosticAdminReviewDraft(saved);
  assert.deepEqual(reset, draft);
});

test("transition controls hide New once a Case has left New", () => {
  assert.deepEqual([...allowedAfcDiagnosticAdminReviewTargets("new")], [
    "new",
    "in_review",
    "closed",
  ]);
  assert.deepEqual([...allowedAfcDiagnosticAdminReviewTargets("in_review")], [
    "in_review",
    "closed",
  ]);
  assert.deepEqual([...allowedAfcDiagnosticAdminReviewTargets("closed")], [
    "in_review",
    "closed",
  ]);
  assert.equal(isAfcDiagnosticAdminReviewTargetDisabled("new", "closed"), false);
  assert.equal(isAfcDiagnosticAdminReviewTargetDisabled("in_review", "new"), true);
  assert.equal(isAfcDiagnosticAdminReviewTargetDisabled("closed", "new"), true);
  assert.equal(isAfcDiagnosticAdminReviewTargetDisabled("closed", "in_review"), false);
});

test("patch body is exact and normalized", () => {
  assert.deepEqual(
    buildAfcDiagnosticAdminReviewPatchBody({
      reviewStatus: "closed",
      reviewNotes: "  done  ",
    }),
    { reviewStatus: "closed", reviewNotes: "done" },
  );
  assert.deepEqual(
    buildAfcDiagnosticAdminReviewPatchBody({
      reviewStatus: "new",
      reviewNotes: "   ",
    }),
    { reviewStatus: "new", reviewNotes: null },
  );
});

test("error copy is generic and status-mapped", () => {
  assert.equal(afcDiagnosticAdminReviewErrorMessage(400), "Invalid review request.");
  assert.equal(
    afcDiagnosticAdminReviewErrorMessage(401),
    "You need to sign in to access AFC Diagnostics.",
  );
  assert.equal(
    afcDiagnosticAdminReviewErrorMessage(403),
    "You don't have admin access to AFC Diagnostics.",
  );
  assert.equal(afcDiagnosticAdminReviewErrorMessage(404), "Case not found.");
  assert.equal(
    afcDiagnosticAdminReviewErrorMessage(409),
    "That review change isn't allowed.",
  );
  assert.equal(
    afcDiagnosticAdminReviewErrorMessage(500),
    "Couldn't save review. Try again.",
  );
  assert.equal(
    afcDiagnosticAdminReviewErrorMessage("network"),
    "Couldn't save review. Try again.",
  );
  assert.equal(AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.saved, "Review saved.");
  assert.equal(AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.unsaved, "Unsaved changes");
});

test("PATCH helper sends exact body and returns Case detail", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const payload = caseDetail();
  const result = await patchAfcDiagnosticAdminCaseReview({
    caseId: CASE_1,
    draft: { reviewStatus: "closed", reviewNotes: "  wrapping up  " },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.detail.caseId, CASE_1);
  assert.equal(result.detail.notes, "tester notes stay put");
  assert.deepEqual(result.detail.issueCodes, ["perspective_off"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api/admin/afc-diagnostics/cases/${CASE_1}/review`);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.body, JSON.stringify({
    reviewStatus: "closed",
    reviewNotes: "wrapping up",
  }));
});

test("PATCH helper keeps the draft caller-side and maps 409/401/403/404/500", async () => {
  for (const status of [409, 401, 403, 404, 500] as const) {
    const result = await patchAfcDiagnosticAdminCaseReview({
      caseId: CASE_1,
      draft: { reviewStatus: "closed", reviewNotes: "x" },
      fetchImpl: async () => new Response("{}", { status }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, status);
    assert.equal(result.message, afcDiagnosticAdminReviewErrorMessage(status));
  }

  const network = await patchAfcDiagnosticAdminCaseReview({
    caseId: CASE_1,
    draft: { reviewStatus: "closed", reviewNotes: "x" },
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(network.ok, false);
  if (network.ok) return;
  assert.equal(network.status, "network");
  assert.equal(network.message, AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.errorGeneric);
});
