import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_DIAGNOSTIC_INSPECTOR_COPY,
  AFC_DIAGNOSTIC_INSPECTOR_CASE_API_PATH,
  AFC_DIAGNOSTIC_INSPECTOR_SESSION_API_PATH,
  afcDiagnosticInspectorArtifactSourceLabel,
  afcDiagnosticInspectorAttemptOriginalDiffers,
  afcDiagnosticInspectorCaseErrorMessage,
  afcDiagnosticInspectorIntentLabel,
  afcDiagnosticInspectorIssueChips,
  afcDiagnosticInspectorIssueLabel,
  afcDiagnosticInspectorParentAttemptOrdinal,
  afcDiagnosticInspectorRecoveryLabel,
  afcDiagnosticInspectorSessionErrorMessage,
  afcDiagnosticInspectorSessionSentence,
  buildAfcDiagnosticInspectorCaseUrl,
  buildAfcDiagnosticInspectorSessionUrl,
  createAfcDiagnosticInspectorRequestCoordinator,
  defaultAfcDiagnosticInspectorAttemptOrdinal,
  formatAfcDiagnosticInspectorBytes,
  formatAfcDiagnosticInspectorTimestamp,
  isAfcDiagnosticInspectorAbortError,
  isAfcDiagnosticInspectorUuid,
  parseAfcDiagnosticInspectorCaseDetail,
  parseAfcDiagnosticInspectorSessionDetail,
  parseAfcDiagnosticInspectorUuid,
  shortAfcDiagnosticInspectorSha,
  shortAfcDiagnosticInspectorUuid,
} from "./admin-case-inspector.client";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "22222222-2222-4222-8222-222222222222";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const ASSET_A = "99999999-9999-4999-8999-999999999999";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const EMPTY_SHA = "e".repeat(64);
const TILED_SHA = "f".repeat(64);

function fingerprint(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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
    extra: "ignored",
    ...overrides,
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
    notes: null,
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
    extra: true,
    ...overrides,
  };
}

function sessionDetail(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_A,
    status: "open",
    roomId: ROOM_A,
    sessionUserId: USER_A,
    originalSha256: SHA_A,
    baseAssetId: ASSET_A,
    attemptCount: 2,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:05:00.000Z",
    attempts: [
      {
        generationId: GEN_1,
        attemptOrdinal: 1,
        intent: "analyze",
        associatedAt: "2026-09-18T12:00:00.000Z",
        generation: generation(),
      },
      {
        generationId: GEN_2,
        attemptOrdinal: 2,
        intent: "run_again",
        associatedAt: "2026-09-18T12:05:00.000Z",
        generation: generation({
          generationId: GEN_2,
          parentGenerationId: GEN_1,
          lineageSeq: 33,
          intent: "run_again",
          runId: "run-2",
        }),
      },
    ],
    extra: true,
    ...overrides,
  };
}

test("UUID validation accepts canonical UUIDs and lowercases them", () => {
  assert.equal(isAfcDiagnosticInspectorUuid(CASE_1), true);
  assert.equal(parseAfcDiagnosticInspectorUuid(CASE_1.toUpperCase()), CASE_1);
  assert.equal(parseAfcDiagnosticInspectorUuid("not-a-uuid"), null);
  assert.equal(
    parseAfcDiagnosticInspectorUuid(" dcd4dbd9-916f-4d70-ac12-bd718be3adce "),
    CASE_1,
  );
});

test("short UUID and short SHA show the first 8 characters", () => {
  assert.equal(shortAfcDiagnosticInspectorUuid(CASE_1), "dcd4dbd9");
  assert.equal(shortAfcDiagnosticInspectorSha(SHA_A), "aaaaaaaa");
  assert.equal(shortAfcDiagnosticInspectorSha("abc123"), "abc123");
});

test("timestamp formatting uses local display and keeps ISO in title", () => {
  const valid = formatAfcDiagnosticInspectorTimestamp("2026-09-18T12:00:00.000Z");
  assert.equal(valid.title, "2026-09-18T12:00:00.000Z");
  assert.notEqual(valid.display, "—");
  assert.match(valid.display, /2026/);
  const invalid = formatAfcDiagnosticInspectorTimestamp("not-a-date");
  assert.equal(invalid.display, "—");
  assert.equal(invalid.title, "not-a-date");
  const empty = formatAfcDiagnosticInspectorTimestamp(null);
  assert.equal(empty.display, "—");
});

test("byte formatting covers B/KB/MB and invalid fallback", () => {
  assert.equal(formatAfcDiagnosticInspectorBytes(0).display, "0 B");
  assert.equal(formatAfcDiagnosticInspectorBytes(950).display, "950 B");
  assert.equal(formatAfcDiagnosticInspectorBytes(1229).display, "1.2 KB");
  assert.equal(formatAfcDiagnosticInspectorBytes(98016).display, "95.7 KB");
  assert.equal(formatAfcDiagnosticInspectorBytes(1.4 * 1024 * 1024).display, "1.4 MB");
  assert.equal(formatAfcDiagnosticInspectorBytes(98016).title, "98016 bytes");
  assert.equal(formatAfcDiagnosticInspectorBytes(null).display, "—");
  assert.equal(formatAfcDiagnosticInspectorBytes(-1).display, "—");
});

test("issue labels reuse tester-facing copy and keep unknown codes out of the chip", () => {
  assert.equal(
    afcDiagnosticInspectorIssueLabel("perspective_off").label,
    "Perspective looks wrong",
  );
  assert.equal(
    afcDiagnosticInspectorIssueLabel("wall_edges_unrecognized").label,
    "Wall edges aren’t being recognized",
  );
  assert.equal(
    afcDiagnosticInspectorIssueLabel("scale_incorrect").label,
    "Scale looks incorrect",
  );
  assert.equal(afcDiagnosticInspectorIssueLabel("other").label, "Other");
  const unknown = afcDiagnosticInspectorIssueLabel("not_a_real_issue");
  assert.equal(unknown.label, "Unknown issue");
  assert.equal(unknown.title, "not_a_real_issue");
  const chips = afcDiagnosticInspectorIssueChips([
    "other",
    "perspective_off",
    "scale_incorrect",
    "not_a_real_issue",
  ]);
  assert.equal(chips.length, 4);
  assert.equal(chips[0]?.label, "Perspective looks wrong");
  assert.equal(chips.some((chip) => chip.label === "Unknown issue"), true);
});

test("intent, recovery, and artifact-source labels", () => {
  assert.equal(afcDiagnosticInspectorIntentLabel("analyze"), "Initial analysis");
  assert.equal(afcDiagnosticInspectorIntentLabel("run_again"), "Run again");
  assert.equal(
    afcDiagnosticInspectorIntentLabel("reread_perspective"),
    "Re-read perspective",
  );
  assert.equal(afcDiagnosticInspectorIntentLabel("custom_intent"), "custom_intent");
  assert.equal(afcDiagnosticInspectorRecoveryLabel("none"), "None");
  assert.equal(afcDiagnosticInspectorRecoveryLabel("metric_fallback"), "Metric fallback");
  assert.equal(afcDiagnosticInspectorRecoveryLabel("collision_empty"), "Collision empty");
  assert.equal(afcDiagnosticInspectorRecoveryLabel(null), "—");
  assert.equal(afcDiagnosticInspectorRecoveryLabel("mystery"), "mystery");
  assert.equal(afcDiagnosticInspectorArtifactSourceLabel("generated"), "Generated");
  assert.equal(afcDiagnosticInspectorArtifactSourceLabel("durable"), "Durable");
  assert.equal(afcDiagnosticInspectorArtifactSourceLabel(null), "—");
  assert.equal(afcDiagnosticInspectorArtifactSourceLabel("other"), "other");
  assert.equal(afcDiagnosticInspectorSessionSentence("open"), "Session open");
  assert.equal(afcDiagnosticInspectorSessionSentence("closed"), "Session closed");
});

test("default attempt selection prefers reported ordinal, then generation, then first", () => {
  const attempts = [
    { attemptOrdinal: 2, generationId: GEN_2 },
    { attemptOrdinal: 1, generationId: GEN_1 },
  ];
  assert.equal(
    defaultAfcDiagnosticInspectorAttemptOrdinal({
      attempts,
      reportedAttemptOrdinal: 2,
      reportedGenerationId: GEN_1,
    }),
    2,
  );
  assert.equal(
    defaultAfcDiagnosticInspectorAttemptOrdinal({
      attempts,
      reportedAttemptOrdinal: 9,
      reportedGenerationId: GEN_2,
    }),
    2,
  );
  assert.equal(
    defaultAfcDiagnosticInspectorAttemptOrdinal({
      attempts,
      reportedAttemptOrdinal: null,
      reportedGenerationId: "00000000-0000-4000-8000-000000000000",
    }),
    1,
  );
  assert.equal(
    defaultAfcDiagnosticInspectorAttemptOrdinal({
      attempts: [],
      reportedAttemptOrdinal: 1,
      reportedGenerationId: GEN_1,
    }),
    null,
  );
  assert.equal(
    defaultAfcDiagnosticInspectorAttemptOrdinal({
      attempts,
      reportedAttemptOrdinal: 1,
      reportedGenerationId: GEN_1,
      preserveOrdinal: 2,
    }),
    2,
  );
  assert.equal(
    defaultAfcDiagnosticInspectorAttemptOrdinal({
      attempts,
      reportedAttemptOrdinal: 1,
      reportedGenerationId: GEN_1,
      preserveOrdinal: 9,
    }),
    1,
  );
});

test("parent matching is identity comparison against another attempt", () => {
  const attempts = [
    { attemptOrdinal: 1, generationId: GEN_1 },
    { attemptOrdinal: 2, generationId: GEN_2 },
  ];
  assert.equal(
    afcDiagnosticInspectorParentAttemptOrdinal(attempts, GEN_1, 2),
    1,
  );
  assert.equal(
    afcDiagnosticInspectorParentAttemptOrdinal(attempts, GEN_1.toUpperCase(), 2),
    null,
  );
  assert.equal(afcDiagnosticInspectorParentAttemptOrdinal(attempts, null, 2), null);
  assert.equal(
    afcDiagnosticInspectorParentAttemptOrdinal(attempts, GEN_2, 2),
    null,
  );
  assert.equal(afcDiagnosticInspectorAttemptOriginalDiffers(SHA_A, SHA_A), false);
  assert.equal(afcDiagnosticInspectorAttemptOriginalDiffers(SHA_A, SHA_B), true);
  assert.equal(afcDiagnosticInspectorAttemptOriginalDiffers(SHA_A, null), false);
});

test("parser accepts a valid Case detail and ignores extra fields", () => {
  const parsed = parseAfcDiagnosticInspectorCaseDetail(caseDetail());
  assert.ok(parsed);
  assert.equal(parsed.caseId, CASE_1);
  assert.equal(parsed.notes, null);
  assert.equal(parsed.reportedAttemptOrdinal, 1);
  assert.equal(parsed.review.reviewStatus, "new");
  assert.equal(parsed.source.originalSha256, SHA_A);
  assert.equal(parsed.source.baseAssetId, ASSET_A);
  assert.equal(parsed.reportedGeneration.lineageSeq, 32);
  assert.equal(parsed.reportedGeneration.engineFingerprint?.gitSha, "abc123def456");
  assert.equal("extra" in parsed, false);
});

test("parser rejects an invalid Case detail", () => {
  assert.equal(parseAfcDiagnosticInspectorCaseDetail(null), null);
  assert.equal(parseAfcDiagnosticInspectorCaseDetail({}), null);
  assert.equal(
    parseAfcDiagnosticInspectorCaseDetail(caseDetail({ caseId: "bad" })),
    null,
  );
  assert.equal(
    parseAfcDiagnosticInspectorCaseDetail(caseDetail({ source: null })),
    null,
  );
  assert.equal(
    parseAfcDiagnosticInspectorCaseDetail(
      caseDetail({ reportedGeneration: generation({ generationId: "bad" }) }),
    ),
    null,
  );
});

test("parser accepts a valid Session detail and ignores extra fields", () => {
  const parsed = parseAfcDiagnosticInspectorSessionDetail(sessionDetail());
  assert.ok(parsed);
  assert.equal(parsed.sessionId, SESSION_A);
  assert.equal(parsed.attemptCount, 2);
  assert.equal(parsed.attempts[0]?.attemptOrdinal, 1);
  assert.equal(parsed.attempts[1]?.generation.parentGenerationId, GEN_1);
  assert.equal(parsed.attempts[1]?.generation.lineageSeq, 33);
  assert.equal("extra" in parsed, false);
});

test("parser rejects an invalid Session detail", () => {
  assert.equal(parseAfcDiagnosticInspectorSessionDetail(null), null);
  assert.equal(
    parseAfcDiagnosticInspectorSessionDetail(sessionDetail({ attempts: "nope" })),
    null,
  );
  assert.equal(
    parseAfcDiagnosticInspectorSessionDetail(
      sessionDetail({
        attempts: [
          {
            generationId: GEN_1,
            attemptOrdinal: 1,
            intent: "analyze",
            associatedAt: "2026-09-18T12:00:00.000Z",
            generation: { bad: true },
          },
        ],
      }),
    ),
    null,
  );
});

test("null fingerprint and absent artifacts parse without becoming errors", () => {
  const parsed = parseAfcDiagnosticInspectorCaseDetail(
    caseDetail({
      reportedGeneration: generation({
        engineFingerprint: null,
        empty: { present: false, sha256: null, artifactSource: null },
        tiled: { present: false, sha256: null, artifactSource: null },
        frame: null,
        completedAt: null,
        original: null,
      }),
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.reportedGeneration.engineFingerprint, null);
  assert.equal(parsed.reportedGeneration.empty.present, false);
  assert.equal(parsed.reportedGeneration.tiled.present, false);
  assert.equal(parsed.reportedGeneration.frame, null);
  assert.equal(parsed.reportedGeneration.original, null);
});

test("AbortError is recognized and should not be treated as a user error", () => {
  assert.equal(isAfcDiagnosticInspectorAbortError({ name: "AbortError" }), true);
  assert.equal(isAfcDiagnosticInspectorAbortError(new Error("boom")), false);
  assert.equal(isAfcDiagnosticInspectorAbortError(null), false);
});

test("coordinator stale Case responses cannot commit", () => {
  const coordinator = createAfcDiagnosticInspectorRequestCoordinator();
  const first = coordinator.beginCase();
  const second = coordinator.beginCase();
  assert.equal(first.signal.aborted, true);
  assert.equal(coordinator.isCurrentCase(first.seq), false);
  assert.equal(coordinator.isCurrentCase(second.seq), true);
  assert.equal(coordinator.beginSession(first.seq, SESSION_A).started, false);
});

test("coordinator stale Session responses cannot commit", () => {
  const coordinator = createAfcDiagnosticInspectorRequestCoordinator();
  const first = coordinator.beginCase();
  const session = coordinator.beginSession(first.seq, SESSION_A);
  assert.equal(session.started, true);
  if (!session.started) return;
  assert.equal(coordinator.shouldCommitSession(first.seq, SESSION_A), true);
  assert.equal(coordinator.shouldCommitSession(first.seq, SESSION_B), false);
  coordinator.beginCase();
  assert.equal(session.signal.aborted, true);
  assert.equal(coordinator.shouldCommitSession(first.seq, SESSION_A), false);
});

test("coordinator refresh aborts in-flight Case and Session requests", () => {
  const coordinator = createAfcDiagnosticInspectorRequestCoordinator();
  const first = coordinator.beginCase();
  const session = coordinator.beginSession(first.seq, SESSION_A);
  assert.equal(session.started, true);
  if (!session.started) return;
  const refresh = coordinator.beginCase();
  assert.equal(first.signal.aborted, true);
  assert.equal(session.signal.aborted, true);
  assert.equal(coordinator.isCurrentCase(first.seq), false);
  const nextSession = coordinator.beginSession(refresh.seq, SESSION_A);
  assert.equal(nextSession.started, true);
  assert.equal(coordinator.shouldCommitSession(refresh.seq, SESSION_A), true);
  assert.equal(coordinator.shouldCommitSession(first.seq, SESSION_A), false);
});

test("session-only retry keeps the current Case sequence and session binding", () => {
  const coordinator = createAfcDiagnosticInspectorRequestCoordinator();
  const first = coordinator.beginCase();
  const session = coordinator.beginSession(first.seq, SESSION_A);
  assert.equal(session.started, true);
  if (!session.started) return;
  const retry = coordinator.retrySession();
  assert.equal(retry.started, true);
  if (!retry.started) return;
  assert.equal(session.signal.aborted, true);
  assert.equal(retry.seq, first.seq);
  assert.equal(retry.sessionId, SESSION_A);
  assert.equal(coordinator.shouldCommitSession(first.seq, SESSION_A), true);
});

test("error mapping never prints raw API bodies", () => {
  assert.equal(
    afcDiagnosticInspectorCaseErrorMessage(401),
    AFC_DIAGNOSTIC_INSPECTOR_COPY.error401,
  );
  assert.equal(
    afcDiagnosticInspectorCaseErrorMessage(403),
    AFC_DIAGNOSTIC_INSPECTOR_COPY.error403,
  );
  assert.equal(
    afcDiagnosticInspectorCaseErrorMessage(400),
    AFC_DIAGNOSTIC_INSPECTOR_COPY.errorNotFound,
  );
  assert.equal(
    afcDiagnosticInspectorCaseErrorMessage(404),
    AFC_DIAGNOSTIC_INSPECTOR_COPY.errorNotFound,
  );
  assert.equal(
    afcDiagnosticInspectorCaseErrorMessage(500),
    AFC_DIAGNOSTIC_INSPECTOR_COPY.errorCaseGeneric,
  );
  assert.equal(
    afcDiagnosticInspectorSessionErrorMessage(404),
    AFC_DIAGNOSTIC_INSPECTOR_COPY.errorSessionGeneric,
  );
  assert.doesNotMatch(AFC_DIAGNOSTIC_INSPECTOR_COPY.errorCaseGeneric, /Invalid request/);
});

test("detail URLs are Case/Session paths, not the list endpoint", () => {
  assert.equal(
    buildAfcDiagnosticInspectorCaseUrl(CASE_1),
    `${AFC_DIAGNOSTIC_INSPECTOR_CASE_API_PATH}/${CASE_1}`,
  );
  assert.equal(
    buildAfcDiagnosticInspectorSessionUrl(SESSION_A),
    `${AFC_DIAGNOSTIC_INSPECTOR_SESSION_API_PATH}/${SESSION_A}`,
  );
  assert.notEqual(
    buildAfcDiagnosticInspectorCaseUrl(CASE_1),
    AFC_DIAGNOSTIC_INSPECTOR_CASE_API_PATH,
  );
});
