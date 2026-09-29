import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAfcV2CameraRealizability } from "@/lib/afc-v2-production/camera-realizability-diagnostic";

import { mapAfcDiagnosticAdminCameraRealizability } from "./admin-camera-realizability";
import {
  parseAfcDiagnosticAdminCameraRealizabilityDto,
  type AfcDiagnosticAdminCameraRealizability,
} from "./admin-camera-realizability-dto";
import { parseAfcDiagnosticInspectorGenerationEvidence } from "./admin-case-inspector.client";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
} from "./admin-read-model";
import {
  mapAfcDiagnosticAdminGenerationEvidence,
  parseAfcDiagnosticAdminGenerationRecord,
} from "./admin-read-model";
import {
  buildAfcDiagnosticSelectedAttemptExport,
  type AfcDiagnosticSelectedAttemptExportSource,
} from "./admin-selected-attempt-export";

const GEN_ID = "4d690811-a9d8-4194-87db-2644ea095ce7";
const EXPORTED_AT = "2026-09-28T01:00:00.000Z";

const IMAGE_1 = [
  { x: 0.2370453644228819, y: 0.9948381096093489 },
  { x: 0.6620500770539771, y: 0.7572163483736456 },
  { x: 0.44763728824207566, y: 0.6652712265752749 },
  { x: 0.12746642239141576, y: 0.7509666920045333 },
] as const;

function recorded(): AfcDiagnosticAdminCameraRealizability {
  return mapAfcDiagnosticAdminCameraRealizability(evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: IMAGE_1,
    sourceImageSize: { width: 1144, height: 1534 },
    frameSize: { width: 1144, height: 1534 },
    aspectBasis: { kind: "best_rejected_ratio", widthDepthRatio: 1.23 },
  }));
}

function generation(cameraRealizability: unknown) {
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
    frame: { width: 896, height: 1200 },
    failureReason: "AFC settle failed closed: no_apply_safe_candidate.",
    metricStatus: "none",
    collisionStatus: "none",
    analysisStatus: "failed",
    analysisReason: "AFC settle failed closed: no_apply_safe_candidate.",
    recoverySafeFailureState: null,
    metricDecision: null,
    settleDecision: null,
    cameraRealizability,
    legacyMetricConclusion: null,
    engineFingerprint: null,
    original: null,
    empty: { present: false, sha256: null, artifactSource: null },
    tiled: { present: false, sha256: null, artifactSource: null },
  };
}

function source(cameraRealizability: unknown): AfcDiagnosticSelectedAttemptExportSource {
  const current = generation(cameraRealizability) as AfcDiagnosticSelectedAttemptExportSource["generation"];
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
        decodedWidth: 1144,
        decodedHeight: 1534,
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

test("selected attempt export records the camera-realizability diagnostic", () => {
  const mapped = recorded();
  assert.equal(mapped?.kind, "recorded");
  const exported = buildAfcDiagnosticSelectedAttemptExport(source(mapped), EXPORTED_AT);
  assert.equal(exported.cameraRealizability?.kind, "recorded");
  if (exported.cameraRealizability?.kind !== "recorded") return;
  assert.equal(
    exported.cameraRealizability.schemaVersion,
    "afc-v2-camera-realizability-diagnostic/v2",
  );
  assert.equal(exported.cameraRealizability.value.evaluated, true);
  assert.equal(exported.cameraRealizability.value.status, "computed");
  assert.equal(exported.cameraRealizability.value.aspectBasis?.kind, "best_rejected_ratio");
  assert.equal(exported.cameraRealizability.value.aspectBasis?.widthDepthRatio, 1.23);
  assert.ok((exported.cameraRealizability.value.focalDisagreement ?? 0) > 0.5);
  const keys = Object.keys(exported);
  assert.deepEqual(keys.slice(keys.indexOf("settleDecision"), keys.indexOf("legacyMetricConclusion") + 1), [
    "settleDecision",
    "cameraRealizability",
    "legacyMetricConclusion",
  ]);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes("NaN"), false);
  assert.doesNotMatch(serialized, /storage_path|storage_bucket|signedUrl|https?:\/\//);
});

test("historical null, unknown schema, and malformed camera diagnostics export distinctly", () => {
  const historical = buildAfcDiagnosticSelectedAttemptExport(source(null), EXPORTED_AT);
  assert.equal(historical.cameraRealizability, null);

  const superseded = mapAfcDiagnosticAdminCameraRealizability({
    schemaVersion: "afc-v2-camera-realizability-diagnostic/v1",
    evaluated: true,
    status: "computed",
    focalFromOrthogonalityPx: 837.9433201070881,
    focalFromEqualNormPx: 273.3268268800335,
    verticalFovFromOrthogonalityDeg: 84.93800373652283,
    verticalFovFromEqualNormDeg: 140.77210379351334,
    focalDisagreement: 0.6738122730722377,
  });
  assert.equal(superseded?.kind, "unsupported_schema");
  if (superseded?.kind === "unsupported_schema") {
    assert.equal(superseded.schemaVersion, "afc-v2-camera-realizability-diagnostic/v1");
  }
  const unknown = mapAfcDiagnosticAdminCameraRealizability({
    schemaVersion: "afc-v2-camera-realizability-diagnostic/v9",
    evaluated: true,
  });
  assert.equal(unknown?.kind, "unsupported_schema");
  const unknownExport = buildAfcDiagnosticSelectedAttemptExport(source(unknown), EXPORTED_AT);
  assert.equal(unknownExport.cameraRealizability?.kind, "unsupported_schema");

  const malformed = mapAfcDiagnosticAdminCameraRealizability({
    schemaVersion: "afc-v2-camera-realizability-diagnostic/v2",
    evaluated: true,
    status: "computed",
  });
  assert.equal(malformed?.kind, "unreadable");
  assert.deepEqual(
    parseAfcDiagnosticAdminCameraRealizabilityDto({ kind: "unreadable", extra: true }),
    { kind: "unreadable" },
  );
});

test("a generation row without camera_realizability_decision still maps", () => {
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
  assert.equal(record.cameraRealizability, null);
  const evidence = mapAfcDiagnosticAdminGenerationEvidence(record);
  assert.equal(evidence.cameraRealizability, null);
});

test("recorded camera diagnostics pass case-detail and session-detail privacy gates", () => {
  const mapped = recorded();
  assert.equal(mapped?.kind, "recorded");
  const caseDetail = {
    reportedGeneration: { cameraRealizability: mapped },
  };
  const sessionDetail = {
    attempts: [{ generation: { cameraRealizability: mapped } }],
  };
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy(caseDetail));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy(sessionDetail));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: { cameraRealizability: null },
  }));
  assert.throws(
    () => assertAfcDiagnosticAdminPayloadPrivacy({
      reason: "no_apply_safe_candidate",
      sourceNormalizedPolygon: [{ x: 0, y: 0 }],
      storagePath: "private/original.jpg",
    }),
    /leaked privileged fields/,
  );
});

test("the client parser reads a recorded diagnostic and treats a missing key as null", () => {
  const mapped = recorded();
  const parsed = parseAfcDiagnosticInspectorGenerationEvidence(generation(mapped));
  assert.ok(parsed);
  assert.equal(parsed?.cameraRealizability?.kind, "recorded");
  if (parsed?.cameraRealizability?.kind !== "recorded") return;
  assert.equal(parsed.cameraRealizability.value.status, "computed");
  const { cameraRealizability: _omitted, ...historical } = generation(null);
  const missing = parseAfcDiagnosticInspectorGenerationEvidence(historical);
  assert.equal(missing?.cameraRealizability, null);
  const unreadable = parseAfcDiagnosticInspectorGenerationEvidence(generation({
    kind: "recorded",
    schemaVersion: "afc-v2-camera-realizability-diagnostic/v2",
    value: { evaluated: true },
  }));
  assert.equal(unreadable?.cameraRealizability?.kind, "unreadable");
});
