import assert from "node:assert/strict";
import test from "node:test";

import { ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE } from "@/app/admin/3d-room-lab/afc-lab-geometry-candidate";
import { settleAfcFixedSeamCalibration } from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import {
  AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  projectAfcV2SettleDecisionDiagnostic,
} from "@/lib/afc-v2-production/settle-decision-diagnostic";

import { mapAfcDiagnosticAdminSettleDecision } from "./admin-settle-decision";
import {
  AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION,
  parseAfcDiagnosticAdminSettleDecisionDto,
} from "./admin-settle-decision-dto";
import {
  buildAfcDiagnosticSelectedAttemptExport,
  type AfcDiagnosticSelectedAttemptExportSource,
} from "./admin-selected-attempt-export";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  mapAfcDiagnosticAdminGenerationEvidence,
  parseAfcDiagnosticAdminGenerationRecord,
} from "./admin-read-model";

const EXPORTED_AT = "2026-09-28T18:00:00.000Z";
const GEN_ID = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";

function recordedRaw() {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) throw new Error("Room C fixture did not parse.");
  const candidate = ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
  const polygon = candidate.sourceNormalizedPolygon;
  const settle = settleAfcFixedSeamCalibration({
    sourceNormalizedPolygon: polygon,
    sourceImageSize: {
      width: candidate.acceptanceBasis.decodedWidth,
      height: candidate.acceptanceBasis.decodedHeight,
    },
    frameSize: { width: 1118, height: 698 },
    referenceDepthM: candidate.referenceDepthM,
    ratioSearch: { min: 0.5, max: 0.5, step: 0.1 },
    fovSearch: { minDeg: 80, maxDeg: 80, stepDeg: 1 },
  });
  return projectAfcV2SettleDecisionDiagnostic({
    settle,
    sourceNormalizedPolygon: polygon,
  });
}

function generation(settleDecision: unknown) {
  return {
    generationId: GEN_ID,
    roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "22222222-2222-4222-8222-222222222222",
    parentGenerationId: null,
    lineageSeq: 1,
    runId: "run-1",
    intent: "analyze",
    status: "failed",
    createdAt: "2026-09-28T00:00:00.000Z",
    completedAt: "2026-09-28T00:00:01.000Z",
    frame: { width: 1200, height: 800 },
    failureReason: "AFC settle failed closed: no_apply_safe_candidate.",
    metricStatus: "none",
    collisionStatus: "none",
    analysisStatus: "failed",
    analysisReason: "AFC settle failed closed: no_apply_safe_candidate.",
    recoverySafeFailureState: null,
    metricDecision: null,
    settleDecision,
    cameraRealizability: null,
    legacyMetricConclusion: null,
    engineFingerprint: null,
    original: null,
    empty: { present: false, sha256: null, artifactSource: null },
    tiled: { present: false, sha256: null, artifactSource: null },
  } as AfcDiagnosticSelectedAttemptExportSource["generation"];
}

function source(settleDecision: unknown): AfcDiagnosticSelectedAttemptExportSource {
  const current = generation(settleDecision);
  return {
    caseDetail: {
      caseId: "dcd4dbd9-916f-4d70-ac12-bd718be3adce",
      submittedAt: "2026-09-28T00:10:00.000Z",
      roomId: current.roomId,
      sessionId: "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a",
      reporterUserId: current.userId,
      reportedGenerationId: GEN_ID,
      reportedAttemptOrdinal: 1,
      trigger: "manual_report",
      origin: "tester",
      taxonomyVersion: "afc-qa-issue-taxonomy/v1",
      issueCodes: ["perspective_off"],
      notes: null,
      machineStatusSnapshot: "failed",
      source: {
        originalSha256: "ab".repeat(32),
        decodedWidth: 1200,
        decodedHeight: 800,
        byteCount: 10,
        mimeType: "image/jpeg",
        orientation: 1,
        baseAssetId: null,
      },
      review: {
        reviewStatus: "new",
        reviewerUserId: null,
        reviewNotes: null,
        reviewedAt: null,
      },
      session: {
        sessionId: "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a",
        status: "open",
        sessionUserId: current.userId,
        roomId: current.roomId,
        originalSha256: "ab".repeat(32),
        attemptCount: 1,
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:01.000Z",
      },
      reportedGeneration: current,
    },
    session: null,
    attempt: null,
    generation: current,
    associatedAt: null,
    attemptOrdinal: 1,
  };
}

test("selected attempt export includes recorded settle diagnostics", () => {
  const raw = recordedRaw();
  const mapped = mapAfcDiagnosticAdminSettleDecision(raw);
  assert.equal(mapped?.kind, "recorded");
  const exported = buildAfcDiagnosticSelectedAttemptExport(source(mapped), EXPORTED_AT);
  assert.equal(exported.analysis.analysisStatus, "failed");
  assert.equal(
    exported.analysis.analysisReason,
    "AFC settle failed closed: no_apply_safe_candidate.",
  );
  assert.equal(exported.analysis.metricStatus, "none");
  assert.equal(exported.analysis.collisionStatus, "none");
  assert.equal(exported.settleDecision?.kind, "recorded");
  if (exported.settleDecision?.kind !== "recorded") return;
  assert.equal(
    exported.settleDecision.schemaVersion,
    AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION,
  );
  assert.equal(exported.settleDecision.value.reached, true);
  if (!exported.settleDecision.value.reached) return;
  assert.equal(exported.settleDecision.value.result.reason, "no_apply_safe_candidate");
  assert.equal(exported.settleDecision.value.applySafeCellCount, 0);
  assert.equal(exported.settleDecision.value.successfulCellCount, 2);
  assert.equal(exported.settleDecision.value.bestRejectedCandidate?.firstFailingGate, "confidence");
  assert.equal(exported.settleDecision.value.sourceNormalizedPolygon.length, 4);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes("NaN"), false);
  assert.doesNotMatch(serialized, /focalDisagreement|verticalFovFromOrthogonalityDeg/);
});

test("historical generations and not-reached settle stay distinct in the export", () => {
  const historical = buildAfcDiagnosticSelectedAttemptExport(source(null), EXPORTED_AT);
  assert.equal(historical.settleDecision, null);
  const notReached = mapAfcDiagnosticAdminSettleDecision({
    schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    reached: false,
  });
  const exported = buildAfcDiagnosticSelectedAttemptExport(source(notReached), EXPORTED_AT);
  assert.equal(exported.settleDecision?.kind, "recorded");
  if (exported.settleDecision?.kind !== "recorded") return;
  assert.deepEqual(exported.settleDecision.value, { reached: false });
  assert.deepEqual(
    parseAfcDiagnosticAdminSettleDecisionDto({ kind: "unreadable", basis: "SENTINEL" }),
    { kind: "unreadable" },
  );
});

test("a generation row without settle_decision still maps", () => {
  const record = parseAfcDiagnosticAdminGenerationRecord({
    id: GEN_ID,
    room_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user_id: "22222222-2222-4222-8222-222222222222",
    parent_generation_id: null,
    lineage_seq: 1,
    run_id: "run-1",
    intent: "analyze",
    status: "failed",
    created_at: "2026-09-28T00:00:00.000Z",
    completed_at: "2026-09-28T00:00:01.000Z",
    failure_reason: "older failure",
    metric_status: "none",
    collision_status: "none",
    diagnostic_payload: {
      analysisStatus: "failed",
      reason: "older failure",
    },
  });
  assert.ok(record);
  if (!record) return;
  assert.equal(record.settleDecision, null);
  const evidence = mapAfcDiagnosticAdminGenerationEvidence(record);
  assert.equal(evidence.settleDecision, null);
  assert.equal(evidence.analysisReason, "older failure");
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: evidence,
  }));
});

test("recorded settle diagnostics pass the case-detail privacy gate", () => {
  const recorded = mapAfcDiagnosticAdminSettleDecision(recordedRaw());
  assert.equal(recorded?.kind, "recorded");
  const caseDetail = {
    reportedGeneration: { settleDecision: recorded },
  };
  const sessionDetail = {
    attempts: [{ generation: { settleDecision: recorded } }],
  };
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy(caseDetail));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy(sessionDetail));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: { settleDecision: null },
  }));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: {
      settleDecision: mapAfcDiagnosticAdminSettleDecision({
        schemaVersion: "afc-v2-settle-decision-diagnostic/v9",
        reached: true,
      }),
    },
  }));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: {
      settleDecision: mapAfcDiagnosticAdminSettleDecision({
        schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
        reached: true,
        result: { ok: false },
      }),
    },
  }));
  assert.throws(
    () => assertAfcDiagnosticAdminPayloadPrivacy({
      reason: "no_apply_safe_candidate",
      sourceNormalizedPolygon: [{ x: 0, y: 0 }],
    }),
    /reported privileged fields|leaked privileged fields/,
  );
});
