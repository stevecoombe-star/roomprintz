import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
  buildAfcV2ArtifactLineageDiagnostic,
  unknownAfcV2ArtifactLineageEmpty,
  unknownAfcV2ArtifactLineageReader,
  unknownAfcV2ArtifactLineageTiled,
} from "@/lib/afc-v2-production/artifact-lineage-diagnostic";

import { AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS } from "./admin-read-model.server";
import { mapAfcDiagnosticAdminArtifactLineage } from "./admin-artifact-lineage";
import { parseAfcDiagnosticAdminArtifactLineageDto } from "./admin-artifact-lineage-dto";
import { parseAfcDiagnosticInspectorGenerationEvidence } from "./admin-case-inspector.client";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  mapAfcDiagnosticAdminGenerationEvidence,
  parseAfcDiagnosticAdminGenerationRecord,
} from "./admin-read-model";
import {
  buildAfcDiagnosticSelectedAttemptExport,
  type AfcDiagnosticSelectedAttemptExportSource,
} from "./admin-selected-attempt-export";

const GEN_ID = "4d690811-a9d8-4194-87db-2644ea095ce7";
const PUBLISHER_ID = "33333333-3333-4333-8333-333333333333";
const EXPORTED_AT = "2026-09-28T20:00:00.000Z";
const SHA = "ab".repeat(32);
const BAD_POLYGON = [
  { x: 0.19433574484340907, y: 0.9992958566241903 },
  { x: 0.30440890550742766, y: 0.9142958069427229 },
  { x: 0.1876279696638781, y: 0.7325327273739121 },
  { x: 0.09595426095204106, y: 0.751388285412524 },
] as const;

function recordedRaw() {
  return buildAfcV2ArtifactLineageDiagnostic({
    empty: {
      ...unknownAfcV2ArtifactLineageEmpty(),
      sha256: SHA,
      byteCount: 1200,
      width: 896,
      height: 1200,
      source: "durable",
      reusedFromGenerationId: PUBLISHER_ID,
    },
    tiled: {
      ...unknownAfcV2ArtifactLineageTiled(),
      sha256: "cd".repeat(32),
      byteCount: 896,
      width: 896,
      height: 1200,
      source: "generated",
      generatorId: "vibode-tile-grid-scaffold/stage2/v1",
      profileId: "afc-sr1-tile-grid-scaffold/v1",
      researchPreset: "tile_grid_scaffold",
      requestedModelId: "NBP",
      provenanceRunId: "stage2-run",
    },
    reader: {
      ...unknownAfcV2ArtifactLineageReader(),
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      status: "ok",
      rawQuadCount: 14,
      deduplicatedCellCount: 14,
      selectedComponentTileCount: 7,
      selectedCore: { rows: 4, columns: 1, j0: 0, i0: -1 },
      latticeReprojectionMeanPx: 11.42760589387132,
      latticeReprojectionMaxPx: 48.01957277261079,
      selectedPolygon: BAD_POLYGON,
    },
  });
}

function generation(artifactLineage: unknown) {
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
    frame: { width: 1144, height: 1534 },
    failureReason: "AFC settle failed closed: no_apply_safe_candidate.",
    metricStatus: "none",
    collisionStatus: "none",
    analysisStatus: "failed",
    analysisReason: "AFC settle failed closed: no_apply_safe_candidate.",
    recoverySafeFailureState: null,
    metricDecision: null,
    settleDecision: null,
    cameraRealizability: null,
    artifactLineage,
    legacyMetricConclusion: null,
    engineFingerprint: null,
    original: null,
    empty: { present: false, sha256: null, artifactSource: null },
    tiled: { present: false, sha256: null, artifactSource: null },
  };
}

function source(artifactLineage: unknown): AfcDiagnosticSelectedAttemptExportSource {
  const current = generation(artifactLineage) as AfcDiagnosticSelectedAttemptExportSource["generation"];
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
        originalSha256: SHA,
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
        originalSha256: SHA,
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

function row(artifactLineage: unknown, present: boolean) {
  return {
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
    diagnostic_payload: { analysisStatus: "failed", reason: "older failure" },
    ...(present ? { artifact_lineage_decision: artifactLineage } : {}),
  };
}

test("selected attempt export records artifact lineage on a whitelist", () => {
  const mapped = mapAfcDiagnosticAdminArtifactLineage(recordedRaw());
  assert.equal(mapped?.kind, "recorded");
  const exported = buildAfcDiagnosticSelectedAttemptExport(source(mapped), EXPORTED_AT);
  assert.equal(exported.artifactLineage?.kind, "recorded");
  if (exported.artifactLineage?.kind !== "recorded") return;
  assert.equal(
    exported.artifactLineage.schemaVersion,
    AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
  );
  assert.equal(exported.artifactLineage.value.empty.source, "durable");
  assert.equal(exported.artifactLineage.value.empty.reusedFromGenerationId, PUBLISHER_ID);
  assert.equal(exported.artifactLineage.value.tiled.source, "generated");
  assert.equal(exported.artifactLineage.value.tiled.provenanceRunId, "stage2-run");
  assert.equal(
    exported.artifactLineage.value.tiled.generatorId,
    "vibode-tile-grid-scaffold/stage2/v1",
  );
  assert.equal(exported.artifactLineage.value.reader.selectedCore?.rows, 4);
  assert.equal(exported.artifactLineage.value.reader.selectedCore?.columns, 1);
  assert.equal(exported.artifactLineage.value.reader.selectedCore?.i0, -1);
  assert.equal(exported.artifactLineage.value.reader.selectedPolygon?.length, 4);
  assert.equal("schemaVersion" in exported.artifactLineage.value, false);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes("NaN"), false);
  assert.doesNotMatch(serialized, /storage_path|storage_bucket|signedUrl|https?:\/\//);
  const keys = Object.keys(exported);
  assert.deepEqual(
    keys.slice(keys.indexOf("cameraRealizability"), keys.indexOf("legacyMetricConclusion") + 1),
    ["cameraRealizability", "artifactLineage", "legacyMetricConclusion"],
  );
});

test("historical null, unknown schema, and malformed lineage export distinctly", () => {
  const historical = buildAfcDiagnosticSelectedAttemptExport(source(null), EXPORTED_AT);
  assert.equal(historical.artifactLineage, null);

  const unknown = mapAfcDiagnosticAdminArtifactLineage({
    schemaVersion: "afc-v2-artifact-lineage-diagnostic/v9",
    empty: {},
  });
  assert.equal(unknown?.kind, "unsupported_schema");
  const unknownExport = buildAfcDiagnosticSelectedAttemptExport(source(unknown), EXPORTED_AT);
  assert.equal(unknownExport.artifactLineage?.kind, "unsupported_schema");

  const malformed = mapAfcDiagnosticAdminArtifactLineage({
    schemaVersion: AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
    empty: { sha256: SHA, source: "generated" },
    tiled: {},
    reader: {},
    storagePath: "users/private/original.jpg",
  });
  assert.equal(malformed?.kind, "unreadable");
  const malformedExport = buildAfcDiagnosticSelectedAttemptExport(source(malformed), EXPORTED_AT);
  assert.equal(malformedExport.artifactLineage?.kind, "unreadable");
  assert.equal(JSON.stringify(malformedExport).includes("users/private"), false);
  assert.deepEqual(
    parseAfcDiagnosticAdminArtifactLineageDto({ kind: "unreadable", storagePath: "secret" }),
    { kind: "unreadable" },
  );
});

test("the live admin generation select returns recorded lineage to Selected Attempt", () => {
  const columns = AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS.split(", ");
  assert.equal(columns.includes("artifact_lineage_decision"), true);
  const stored = {
    ...row(recordedRaw(), true),
    settle_decision: null,
    camera_realizability_decision: null,
  };
  const selected: Record<string, unknown> = {};
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(stored, column)) {
      selected[column] = stored[column as keyof typeof stored];
    }
  }
  const record = parseAfcDiagnosticAdminGenerationRecord(selected);
  assert.ok(record);
  if (!record) return;
  const evidence = mapAfcDiagnosticAdminGenerationEvidence(record);
  const exported = buildAfcDiagnosticSelectedAttemptExport(
    source(evidence.artifactLineage),
    EXPORTED_AT,
  );
  assert.equal(exported.artifactLineage?.kind, "recorded");
  if (exported.artifactLineage?.kind !== "recorded") return;
  assert.equal(exported.artifactLineage.value.empty.source, "durable");
  assert.equal(exported.artifactLineage.value.tiled.source, "generated");
  assert.equal(exported.artifactLineage.value.reader.selectedCore?.i0, -1);

  const omitted = columns.filter((column) => column !== "artifact_lineage_decision");
  const dropped: Record<string, unknown> = {};
  for (const column of omitted) {
    if (Object.prototype.hasOwnProperty.call(stored, column)) {
      dropped[column] = stored[column as keyof typeof stored];
    }
  }
  const hidden = parseAfcDiagnosticAdminGenerationRecord(dropped);
  assert.equal(hidden?.artifactLineage, null);
  assert.equal(
    buildAfcDiagnosticSelectedAttemptExport(
      source(mapAfcDiagnosticAdminGenerationEvidence(hidden!).artifactLineage),
      EXPORTED_AT,
    ).artifactLineage,
    null,
  );
});

test("a generation row without artifact_lineage_decision stays null", () => {
  const record = parseAfcDiagnosticAdminGenerationRecord(row(null, false));
  assert.ok(record);
  if (!record) return;
  assert.equal(record.artifactLineage, null);
  const evidence = mapAfcDiagnosticAdminGenerationEvidence(record);
  assert.equal(evidence.artifactLineage, null);
  const explicit = parseAfcDiagnosticAdminGenerationRecord(row(null, true));
  assert.equal(explicit?.artifactLineage, null);
  assert.equal(
    mapAfcDiagnosticAdminGenerationEvidence(explicit!).artifactLineage,
    null,
  );
});

test("recorded artifact lineage passes case-detail and session-detail privacy gates", () => {
  const mapped = mapAfcDiagnosticAdminArtifactLineage(recordedRaw());
  assert.equal(mapped?.kind, "recorded");
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: { artifactLineage: mapped },
  }));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    attempts: [{ generation: { artifactLineage: mapped } }],
  }));
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy({
    reportedGeneration: { artifactLineage: null },
  }));
  assert.throws(
    () => assertAfcDiagnosticAdminPayloadPrivacy({
      artifactLineage: {
        storagePath: "users/private/tiled.png",
        sourceNormalizedPolygon: BAD_POLYGON,
      },
    }),
    /leaked privileged fields/,
  );
});

test("the client parser reads a recorded diagnostic and treats a missing key as null", () => {
  const mapped = mapAfcDiagnosticAdminArtifactLineage(recordedRaw());
  const parsed = parseAfcDiagnosticInspectorGenerationEvidence(generation(mapped));
  assert.ok(parsed);
  assert.equal(parsed?.artifactLineage?.kind, "recorded");
  if (parsed?.artifactLineage?.kind !== "recorded") return;
  assert.equal(parsed.artifactLineage.value.reader.status, "ok");
  assert.equal(parsed.artifactLineage.value.reader.selectedCore?.i0, -1);
  assert.equal(parsed.artifactLineage.value.empty.source, "durable");
  const { artifactLineage: _omitted, ...historical } = generation(null);
  const missing = parseAfcDiagnosticInspectorGenerationEvidence(historical);
  assert.equal(missing?.artifactLineage, null);
  const unreadable = parseAfcDiagnosticInspectorGenerationEvidence(generation({
    kind: "recorded",
    schemaVersion: AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
    value: { empty: { source: "generated" } },
  }));
  assert.equal(unreadable?.artifactLineage?.kind, "unreadable");
});
