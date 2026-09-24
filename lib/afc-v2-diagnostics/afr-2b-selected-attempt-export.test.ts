import assert from "node:assert/strict";
import test from "node:test";

import { mapAfcDiagnosticAdminMetricDecision } from "./admin-metric-decision";
import type { AfcDiagnosticAdminMetricDecision } from "./admin-metric-decision-dto";
import {
  hardFallbackMetricDecisionRaw,
  pathAAcceptedMetricDecisionRaw,
  pathBAcceptedMetricDecisionRaw,
  roomPriorFailureMetricDecisionRaw,
} from "./admin-metric-decision.fixture";
import {
  AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION,
  buildAfcDiagnosticSelectedAttemptExport,
  serializeAfcDiagnosticSelectedAttemptExport,
  type AfcDiagnosticSelectedAttemptExportSource,
} from "./admin-selected-attempt-export";
import type { AfcDiagnosticAdminLegacyMetricConclusion } from "./admin-metric-decision-dto";

const EXPORTED_AT = "2026-09-24T03:00:00.000Z";
const CASE_ID = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SESSION_ID = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "99999999-9999-4999-8999-999999999999";
const GEN_ID = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const PARENT_ID = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const SHA = "ab".repeat(32);
const EMPTY_SHA = "cd".repeat(32);
const TILED_SHA = "ef".repeat(32);

const SENTINELS = [
  "RAW_PROMPT_SENTINEL",
  "https://signed.example/object",
  "storage_path_SENTINEL",
  "service_role_SENTINEL",
  "Bearer SECRET_SENTINEL",
  "RAW_PROVIDER_RESPONSE_SENTINEL",
  "data:image/png;base64,SENTINEL_IMAGE",
  "NOTES_SENTINEL",
  "LIMITATIONS_SENTINEL",
  "BASIS_SENTINEL",
  "AMBIGUITY_SENTINEL",
];

function recorded(raw: unknown): AfcDiagnosticAdminMetricDecision {
  return mapAfcDiagnosticAdminMetricDecision(raw);
}

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
      readerVersion: "reader-1",
    },
  };
}

function source(
  overrides: {
    generation?: Record<string, unknown>;
    caseDetail?: Record<string, unknown>;
    attemptOrdinal?: number | null;
    session?: AfcDiagnosticSelectedAttemptExportSource["session"];
  } = {},
): AfcDiagnosticSelectedAttemptExportSource {
  const generation = {
    generationId: GEN_ID,
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: PARENT_ID,
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
    analysisReason: "metric_applied",
    recoverySafeFailureState: "none",
    metricDecision: recorded(pathAAcceptedMetricDecisionRaw()),
    legacyMetricConclusion: null,
    engineFingerprint: fingerprint(),
    original: {
      originalSha256: SHA,
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 98016,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: ASSET_ID,
    },
    empty: { present: true, sha256: EMPTY_SHA, artifactSource: "generated" },
    tiled: { present: true, sha256: TILED_SHA, artifactSource: "durable" },
    ...overrides.generation,
  };
  const caseDetail = {
    caseId: CASE_ID,
    submittedAt: "2026-09-18T12:10:00.000Z",
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    reporterUserId: USER_ID,
    reportedGenerationId: GEN_ID,
    reportedAttemptOrdinal: 1,
    trigger: "manual_report",
    origin: "tester",
    taxonomyVersion: "afc-qa-issue-taxonomy/v1",
    issueCodes: ["perspective_off"],
    notes: null,
    machineStatusSnapshot: "ready",
    source: {
      originalSha256: SHA,
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 98016,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: ASSET_ID,
    },
    review: {
      reviewStatus: "new",
      reviewerUserId: null,
      reviewNotes: null,
      reviewedAt: null,
    },
    session: {
      sessionId: SESSION_ID,
      status: "open",
      sessionUserId: USER_ID,
      roomId: ROOM_ID,
      originalSha256: SHA,
      attemptCount: 2,
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:05:00.000Z",
    },
    reportedGeneration: generation,
    ...overrides.caseDetail,
  };
  return {
    caseDetail: caseDetail as AfcDiagnosticSelectedAttemptExportSource["caseDetail"],
    session: overrides.session === undefined ? null : overrides.session,
    attempt: {
      generationId: generation.generationId,
      attemptOrdinal: overrides.attemptOrdinal ?? 1,
      intent: generation.intent,
      associatedAt: "2026-09-18T12:00:00.000Z",
      generation: generation as AfcDiagnosticSelectedAttemptExportSource["generation"],
    },
    generation: generation as AfcDiagnosticSelectedAttemptExportSource["generation"],
    associatedAt: "2026-09-18T12:00:00.000Z",
    attemptOrdinal: overrides.attemptOrdinal ?? 1,
  };
}

function bundle(input = source()) {
  return buildAfcDiagnosticSelectedAttemptExport(input, EXPORTED_AT);
}

function json(input = source()) {
  return serializeAfcDiagnosticSelectedAttemptExport(bundle(input));
}

test("schemaVersion is the v1 selected-attempt export", () => {
  assert.equal(
    bundle().schemaVersion,
    "vibode-afc-selected-attempt-export/v1",
  );
  assert.equal(
    bundle().schemaVersion,
    AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION,
  );
});

test("export structure and property order are stable", () => {
  const value = bundle();
  assert.deepEqual(Object.keys(value), [
    "schemaVersion",
    "exportedAt",
    "case",
    "session",
    "attempt",
    "generation",
    "analysis",
    "engineFingerprint",
    "productionAuthority",
    "metricDecision",
    "legacyMetricConclusion",
    "artifacts",
  ]);
  const again = bundle();
  assert.equal(serializeAfcDiagnosticSelectedAttemptExport(value), serializeAfcDiagnosticSelectedAttemptExport(again));
});

test("exportedAt is the injected ISO 8601 UTC timestamp", () => {
  assert.equal(bundle().exportedAt, EXPORTED_AT);
  assert.throws(
    () => buildAfcDiagnosticSelectedAttemptExport(source(), "2026-09-24T03:00:00Z"),
    /ISO 8601 UTC/,
  );
});

test("case and attempt identity come from the selected attempt", () => {
  const value = bundle();
  assert.equal(value.case.caseId, CASE_ID);
  assert.equal(value.case.reviewStatus, "new");
  assert.equal(value.case.origin, "tester");
  assert.equal(value.case.trigger, "manual_report");
  assert.deepEqual(value.case.issueCodes, ["perspective_off"]);
  assert.equal(value.case.reportedGenerationId, GEN_ID);
  assert.equal(value.session.sessionId, SESSION_ID);
  assert.equal(value.session.status, "open");
  assert.equal(value.session.roomId, ROOM_ID);
  assert.equal(value.attempt.attemptOrdinal, 1);
  assert.equal(value.attempt.reported, true);
  assert.equal(value.attempt.generationId, GEN_ID);
  assert.equal(value.attempt.parentGenerationId, PARENT_ID);
  assert.equal(value.attempt.runId, "run-1");
  assert.equal(value.attempt.lineageSeq, 32);
});

test("generation conclusions and engine fingerprint are projected", () => {
  const value = bundle();
  assert.equal(value.generation.status, "ready");
  assert.equal(value.analysis.metricStatus, "path_a");
  assert.equal(value.analysis.collisionStatus, "empty_authoritative");
  assert.equal(value.analysis.analysisStatus, "applied");
  assert.equal(value.analysis.analysisReason, "metric_applied");
  assert.equal(value.analysis.recoverySafeFailureState, "none");
  assert.deepEqual(value.analysis.frame, { width: 1200, height: 800 });
  assert.equal(value.engineFingerprint?.observationModelId, "obs-model");
  assert.equal(value.engineFingerprint?.engineVersions.cameraAuthority, "ca");
  assert.equal(value.productionAuthority.metricStatus, "path_a");
  assert.equal(value.productionAuthority.camera?.authorityVersion, "ca");
  assert.equal(value.productionAuthority.collision?.emptyAuthoritativeVersion, "eac");
});

test("recorded Path A metric decision keeps sanitized path evidence", () => {
  const decision = bundle().metricDecision;
  assert.equal(decision?.kind, "recorded");
  if (decision?.kind !== "recorded") return;
  assert.equal(decision.value.finalDecision.selectedPath, "path_a");
  assert.equal(decision.value.finalDecision.fallbackApplied, false);
  assert.equal(decision.value.pathA.geometryCorrespondence.selectedSpan?.id, "span-back");
  assert.deepEqual(decision.value.pathA.geometryCorrespondence.selectedSpan?.imageA, {
    x: 0.123,
    y: 0.842,
  });
  assert.equal(decision.value.pathB.launchDisposition, "suppressed_complete_back_geometry");
});

test("recorded Path B metric decision keeps host geometry", () => {
  const value = bundle(source({
    generation: {
      metricStatus: "path_b",
      metricDecision: recorded(pathBAcceptedMetricDecisionRaw()),
    },
  }));
  assert.equal(value.metricDecision?.kind, "recorded");
  if (value.metricDecision?.kind !== "recorded") return;
  assert.equal(value.metricDecision.value.finalDecision.selectedPath, "path_b");
  assert.equal(value.metricDecision.value.pathB.hostGeometry?.floorAuthorityKey, "floor-authority-1");
  assert.equal(value.metricDecision.value.pathB.estimatorLaunched, true);
});

test("hard fallback keeps rejected candidate and numeric fallback", () => {
  const value = bundle(source({
    generation: {
      metricStatus: "none",
      recoverySafeFailureState: "metric_fallback",
      metricDecision: recorded(hardFallbackMetricDecisionRaw()),
    },
  }));
  assert.equal(value.metricDecision?.kind, "recorded");
  if (value.metricDecision?.kind !== "recorded") return;
  assert.equal(value.metricDecision.value.finalDecision.fallbackApplied, true);
  assert.equal(value.metricDecision.value.finalDecision.rejectedCandidatePresent, true);
  assert.equal(value.metricDecision.value.finalDecision.rejectedCandidateScale, 0.42);
  assert.equal(value.metricDecision.value.fallback.used, true);
  assert.equal(value.metricDecision.value.fallback.numericFallback, 1);
  assert.equal(value.metricDecision.value.fallback.constantName, "AUTO_METRIC_SCALE");
  assert.deepEqual(value.metricDecision.value.finalDecision.winningReasonCodes, [
    "lab_trust_not_enabled",
    "completeness_not_certified",
  ]);
});

test("legacy pre-capture export does not fabricate path evidence", () => {
  const legacy: AfcDiagnosticAdminLegacyMetricConclusion = {
    metricScale: 1,
    autoMetricScale: 1,
    accepted: false,
    path: "none",
    authority: "none",
    fallbackApplied: true,
    safeFailureState: "metric_fallback",
  };
  const value = bundle(source({
    generation: {
      metricDecision: null,
      legacyMetricConclusion: legacy,
      metricStatus: "none",
    },
  }));
  assert.equal(value.metricDecision, null);
  assert.deepEqual(value.legacyMetricConclusion, legacy);
  const serialized = serializeAfcDiagnosticSelectedAttemptExport(value);
  assert.equal(serialized.includes("pathA"), false);
  assert.equal(serialized.includes("pathB"), false);
  assert.equal(serialized.includes("imageA"), false);
});

test("capture_failed, unsupported_schema, and unreadable stay distinct", () => {
  const failed = bundle(source({
    generation: {
      metricDecision: {
        kind: "capture_failed",
        schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
        generationId: GEN_ID,
        prompt: "RAW_PROMPT_SENTINEL",
      },
    },
  }));
  assert.deepEqual(failed.metricDecision, {
    kind: "capture_failed",
    schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
    generationId: GEN_ID,
  });

  const unsupported = bundle(source({
    generation: {
      metricDecision: {
        kind: "unsupported_schema",
        schemaVersion: "afc-v2-metric-decision-diagnostic/v9",
        notes: "NOTES_SENTINEL",
      },
    },
  }));
  assert.deepEqual(unsupported.metricDecision, {
    kind: "unsupported_schema",
    schemaVersion: "afc-v2-metric-decision-diagnostic/v9",
  });

  const unreadable = bundle(source({
    generation: { metricDecision: { kind: "unreadable", basis: "BASIS_SENTINEL" } },
  }));
  assert.deepEqual(unreadable.metricDecision, { kind: "unreadable" });
});

test("failed generation still exports status and available decision", () => {
  const value = bundle(source({
    generation: {
      status: "failed",
      failureReason: "analysis_failed",
      completedAt: "2026-09-18T12:00:02.000Z",
      metricDecision: {
        kind: "capture_failed",
        schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
        generationId: GEN_ID,
      },
    },
  }));
  assert.equal(value.generation.status, "failed");
  assert.equal(value.generation.failureReason, "analysis_failed");
  assert.equal(value.metricDecision?.kind, "capture_failed");
});

test("artifact metadata includes presence, hash, and source without bytes", () => {
  const value = bundle();
  assert.deepEqual(value.artifacts.empty, {
    present: true,
    sha256: EMPTY_SHA,
    artifactSource: "generated",
  });
  assert.deepEqual(value.artifacts.tiled, {
    present: true,
    sha256: TILED_SHA,
    artifactSource: "durable",
  });
  assert.equal(value.artifacts.original?.sha256, SHA);
  assert.equal(value.artifacts.original?.mimeType, "image/jpeg");
  assert.equal(JSON.stringify(value.artifacts).includes("base64"), false);
});

test("serialization is pretty JSON without undefined", () => {
  const text = json();
  assert.equal(text.includes("undefined"), false);
  assert.match(text, /^{\n  "schemaVersion": "vibode-afc-selected-attempt-export\/v1",\n/);
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2));
  const parsed = JSON.parse(text) as { schemaVersion: string };
  assert.equal(parsed.schemaVersion, AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION);
});

test("privacy sentinels never appear in the serialized bundle", () => {
  const decision = recorded(roomPriorFailureMetricDecisionRaw());
  assert.equal(decision?.kind, "recorded");
  const contaminatedDecision = decision?.kind === "recorded"
    ? {
        ...decision,
        prompt: "RAW_PROMPT_SENTINEL",
        value: {
          ...decision.value,
          notes: "NOTES_SENTINEL",
          limitations: "LIMITATIONS_SENTINEL",
          basis: "BASIS_SENTINEL",
          ambiguity: "AMBIGUITY_SENTINEL",
          providerResponse: { raw: "RAW_PROVIDER_RESPONSE_SENTINEL" },
        },
      }
    : decision;
  const input = source({
    generation: {
      metricDecision: contaminatedDecision,
      failureReason: "Bearer SECRET_SENTINEL",
      analysisReason: "https://signed.example/object",
      userId: USER_ID,
      prompt: "RAW_PROMPT_SENTINEL",
      storage_path: "storage_path_SENTINEL",
      service_role: "service_role_SENTINEL",
      image: "data:image/png;base64,SENTINEL_IMAGE",
    },
    caseDetail: {
      notes: "NOTES_SENTINEL",
      review: {
        reviewStatus: "new",
        reviewerUserId: USER_ID,
        reviewNotes: "LIMITATIONS_SENTINEL BASIS_SENTINEL AMBIGUITY_SENTINEL",
        reviewedAt: null,
      },
    },
  });
  const text = json(input);
  for (const sentinel of SENTINELS) {
    assert.equal(text.includes(sentinel), false, sentinel);
  }
  assert.equal(text.includes(USER_ID), false);
  assert.equal(text.includes(ASSET_ID), false);
  assert.equal(/https?:\/\//i.test(text), false);
  assert.equal(text.includes("storage_path"), false);
  assert.equal(text.includes("service_role"), false);
  assert.equal(text.includes("Bearer"), false);
  const parsed = JSON.parse(text) as {
    metricDecision: { kind: string; value: { pathA: { roomPrior: { failure: { safeDetail: string | null } } } } };
  };
  assert.equal(parsed.metricDecision.kind, "recorded");
  assert.equal(
    parsed.metricDecision.value.pathA.roomPrior.failure.safeDetail,
    "provider_status_503",
  );
});

test("approved fallback reason codes remain after contamination", () => {
  const decision = recorded(hardFallbackMetricDecisionRaw());
  const input = source({
    generation: {
      metricDecision: decision && decision.kind === "recorded"
        ? { ...decision, limitations: "LIMITATIONS_SENTINEL" }
        : decision,
      metricStatus: "none",
    },
  });
  const text = json(input);
  assert.equal(text.includes("LIMITATIONS_SENTINEL"), false);
  assert.equal(text.includes("lab_trust_not_enabled"), true);
  assert.equal(text.includes("completeness_not_certified"), true);
});

test("builder does not mutate the source DTO", () => {
  const input = source();
  const before = JSON.stringify(input);
  buildAfcDiagnosticSelectedAttemptExport(input, EXPORTED_AT);
  assert.equal(JSON.stringify(input), before);
});

test("representative hard-fallback bundle stays compact", () => {
  const text = json(source({
    generation: {
      metricStatus: "none",
      recoverySafeFailureState: "metric_fallback",
      analysisReason: "completeness_not_certified",
      metricDecision: recorded(hardFallbackMetricDecisionRaw()),
    },
  }));
  const bytes = Buffer.byteLength(text);
  assert.ok(bytes < 50_000, `bundle is ${bytes} bytes`);
  assert.equal(text.length, bytes);
});
