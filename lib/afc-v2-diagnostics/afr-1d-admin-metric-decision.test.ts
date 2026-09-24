import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION } from "@/lib/afc-v2-production/metric-decision-diagnostic";

import {
  AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
  parseAfcDiagnosticAdminMetricDecisionDto,
} from "./admin-metric-decision-dto";
import { mapAfcDiagnosticAdminMetricDecision } from "./admin-metric-decision";
import {
  AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID,
  hardFallbackMetricDecisionRaw,
  roomPriorFailureMetricDecisionRaw,
} from "./admin-metric-decision.fixture";
import { AFC_QA_ISSUE_TAXONOMY_VERSION } from "./taxonomy";
import { afcDiagnosticsAdminJson } from "./admin-auth.server";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  mapAfcDiagnosticAdminGenerationEvidence,
  parseAfcDiagnosticAdminCaseListQuery,
  parseAfcDiagnosticAdminGenerationRecord,
  type AfcDiagnosticAdminCaseDetailRecord,
  type AfcDiagnosticAdminCaseListRecord,
  type AfcDiagnosticAdminGenerationEvidence,
  type AfcDiagnosticAdminMembershipRecord,
  type AfcDiagnosticAdminSessionRecord,
} from "./admin-read-model";
import {
  AFC_DIAGNOSTIC_ADMIN_CASE_LIST_COLUMNS,
  AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS,
  getAfcDiagnosticAdminCaseDetail,
  getAfcDiagnosticAdminSessionDetail,
  handleAfcDiagnosticsAdminCaseDetailGet,
  handleAfcDiagnosticsAdminCasesGet,
  handleAfcDiagnosticsAdminSessionDetailGet,
  listAfcDiagnosticAdminCaseSummaries,
  type AfcDiagnosticAdminReadStore,
} from "./admin-read-model.server";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "22222222-2222-4222-8222-222222222222";
const GEN_1 = AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID;
const SHA_A = "a".repeat(64);

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    found.push(key);
    keysOf(child, found);
  }
  return found;
}

function generationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GEN_1,
    room_id: ROOM_A,
    user_id: USER_A,
    parent_generation_id: null,
    lineage_seq: 1,
    run_id: "run-1",
    intent: "analyze",
    status: "ready",
    created_at: "2026-09-18T12:00:00.000Z",
    completed_at: "2026-09-18T12:00:01.000Z",
    frame_width: 1200,
    frame_height: 800,
    failure_reason: null,
    metric_status: "none",
    collision_status: null,
    diagnostic_payload: { analysisStatus: "applied", reason: null },
    engine_fingerprint: null,
    production_authority: null,
    original_sha256: SHA_A,
    original_decoded_width: 1200,
    original_decoded_height: 800,
    original_byte_count: 1200,
    original_mime_type: "image/jpeg",
    original_orientation: 1,
    empty_sha256: null,
    empty_artifact_source: null,
    tiled_sha256: null,
    tiled_artifact_source: null,
    ...overrides,
  };
}

function evidenceFrom(overrides: Record<string, unknown> = {}): AfcDiagnosticAdminGenerationEvidence {
  const record = parseAfcDiagnosticAdminGenerationRecord(generationRow(overrides));
  assert.ok(record);
  return mapAfcDiagnosticAdminGenerationEvidence(record);
}

function caseListRecord(): AfcDiagnosticAdminCaseListRecord {
  return {
    id: CASE_1,
    submittedAt: "2026-09-19T12:00:00.000Z",
    reviewStatus: "new",
    trigger: "manual_report",
    issueCodes: ["perspective_off"],
    taxonomyVersion: AFC_QA_ISSUE_TAXONOMY_VERSION,
    notes: null,
    roomId: ROOM_A,
    sessionId: SESSION_A,
    reportedGenerationId: GEN_1,
    machineStatusSnapshot: "ready",
    reporterUserId: USER_A,
  };
}

function caseDetailRecord(): AfcDiagnosticAdminCaseDetailRecord {
  return {
    ...caseListRecord(),
    originalSha256: SHA_A,
    originalIdentity: null,
    reviewerUserId: null,
    reviewNotes: null,
    reviewedAt: null,
  };
}

function sessionRecord(): AfcDiagnosticAdminSessionRecord {
  return {
    id: SESSION_A,
    status: "open",
    roomId: ROOM_A,
    userId: USER_A,
    originalSha256: SHA_A,
    baseAssetId: null,
    createdAt: "2026-09-18T11:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  };
}

function membershipRecord(): AfcDiagnosticAdminMembershipRecord {
  return {
    sessionId: SESSION_A,
    generationId: GEN_1,
    attemptOrdinal: 1,
    intent: "analyze",
    associatedAt: "2026-09-18T12:00:00.000Z",
  };
}

function detailStore(
  generation: AfcDiagnosticAdminGenerationEvidence,
): AfcDiagnosticAdminReadStore {
  return {
    async listCases() {
      return [caseListRecord()];
    },
    async findCaseById() {
      return caseDetailRecord();
    },
    async findSessionById() {
      return sessionRecord();
    },
    async listSessionStatusesByIds() {
      return [{ id: SESSION_A, status: "open" }];
    },
    async listMembershipSessionIds() {
      return [SESSION_A];
    },
    async listMembershipsBySessionId() {
      return [membershipRecord()];
    },
    async findGenerationById() {
      return generation;
    },
    async listGenerationsByIds() {
      return [generation];
    },
  };
}

test("schema constants match the persisted V1 contract", () => {
  assert.equal(
    AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
    AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  );
});

test("recorded V1 maps safely and round-trips through the client DTO parser", () => {
  const mapped = mapAfcDiagnosticAdminMetricDecision(hardFallbackMetricDecisionRaw());
  assert.equal(mapped?.kind, "recorded");
  if (mapped?.kind !== "recorded") return;
  assert.equal(mapped.value.finalDecision.selectedPath, "none");
  assert.equal(mapped.value.finalDecision.accepted, false);
  assert.equal(mapped.value.finalDecision.fallbackApplied, true);
  assert.equal(mapped.value.finalDecision.metricScale, 1);
  assert.equal(mapped.value.pathA.derivation.candidateScaleBeforeFallback, 0.42);
  assert.equal(mapped.value.fallback.numericFallback, 1);
  assert.equal(mapped.value.fallback.constantName, "AUTO_METRIC_SCALE");
  const roundTrip = parseAfcDiagnosticAdminMetricDecisionDto(
    JSON.parse(JSON.stringify(mapped)),
  );
  assert.deepEqual(roundTrip, mapped);
});

test("capture_failed maps safely", () => {
  const mapped = mapAfcDiagnosticAdminMetricDecision({
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    captureStatus: "capture_failed",
    generationId: GEN_1,
  });
  assert.deepEqual(mapped, {
    kind: "capture_failed",
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    generationId: GEN_1,
  });
  const contaminated = mapAfcDiagnosticAdminMetricDecision({
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    captureStatus: "capture_failed",
    generationId: GEN_1,
    notes: "LEAK_NOTES",
  });
  assert.deepEqual(contaminated, { kind: "unreadable" });
  assert.equal(JSON.stringify(contaminated).includes("LEAK_NOTES"), false);
});

test("null legacy maps safely and does not invent path evidence", () => {
  const mapped = mapAfcDiagnosticAdminMetricDecision(null);
  assert.equal(mapped, null);
  const evidence = evidenceFrom({
    metric_decision: null,
    production_authority: {
      metric: {
        metricScale: 1,
        autoMetricScale: 1,
        accepted: false,
        path: "none",
        authority: "none",
        fallbackApplied: true,
        estimatedRoomWidthM: { best: 9 },
      },
      recovery: { safeFailureState: "metric_fallback" },
      frozenCamera: { applied: true },
    },
  });
  assert.equal(evidence.metricDecision, null);
  assert.deepEqual(evidence.legacyMetricConclusion, {
    metricScale: 1,
    autoMetricScale: 1,
    accepted: false,
    path: "none",
    authority: "none",
    fallbackApplied: true,
    safeFailureState: "metric_fallback",
  });
  assert.equal("estimatedRoomWidthM" in (evidence.legacyMetricConclusion ?? {}), false);
});

test("unsupported schema maps safely", () => {
  const mapped = mapAfcDiagnosticAdminMetricDecision({
    schemaVersion: "afc-v2-metric-decision-diagnostic/v2",
    captureStatus: "recorded",
    notes: "LEAK_NOTES",
    pathA: { disposition: "evaluated" },
  });
  assert.deepEqual(mapped, {
    kind: "unsupported_schema",
    schemaVersion: "afc-v2-metric-decision-diagnostic/v2",
  });
});

test("malformed stored JSON does not crash and stays unreadable", () => {
  for (const value of ["nope", 1, [], { schemaVersion: "" }, { captureStatus: "recorded" }]) {
    const mapped = mapAfcDiagnosticAdminMetricDecision(value);
    assert.deepEqual(mapped, { kind: "unreadable" });
    const evidence = evidenceFrom({ metric_decision: value, production_authority: null });
    assert.deepEqual(evidence.metricDecision, { kind: "unreadable" });
    assert.equal(JSON.stringify(evidence).includes("nope"), false);
  }
});

test("failed legacy generation with no authority has a null legacy conclusion", () => {
  const evidence = evidenceFrom({
    status: "failed",
    metric_decision: null,
    production_authority: null,
    metric_status: "none",
  });
  assert.equal(evidence.metricDecision, null);
  assert.equal(evidence.legacyMetricConclusion, null);
});

test("forbidden and private keys are absent from the browser DTO", () => {
  const base = hardFallbackMetricDecisionRaw();
  const leaked = {
    ...base,
    notes: "LEAK_NOTES",
    prompt: "LEAK_PROMPT_TEXT",
    limitations: "LEAK_LIMITATIONS",
    basis: "LEAK_BASIS",
    ambiguity: "LEAK_AMBIGUITY",
    signedUrl: "https://signed.example/object?token=abc",
    storage_path: "vibode-afc-v2/private/original.jpg",
    rawResponse: { text: "LEAK_RAW_JSON" },
    imageBytes: "LEAK_IMAGE_BYTES",
  };
  const mapped = mapAfcDiagnosticAdminMetricDecision(leaked);
  const serialized = JSON.stringify(mapped);
  const keys = keysOf(mapped);
  for (const key of [
    "reason",
    "notes",
    "prompt",
    "limitations",
    "basis",
    "ambiguity",
    "signedUrl",
    "storage_path",
    "rawResponse",
    "imageBytes",
  ]) {
    assert.equal(keys.includes(key), false, key);
  }
  assert.equal(serialized.includes("LEAK_"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("token="), false);
  assert.equal(serialized.includes("The model wrote a long note"), false);
  assert.equal(serialized.includes("lab_trust_not_enabled"), true);
  assert.equal(serialized.includes("afc-v2-metric-room-prior/v1"), true);

  const failure = roomPriorFailureMetricDecisionRaw();
  const unsafeFailure = {
    ...failure,
    pathA: {
      ...failure.pathA,
      roomPrior: {
        ...failure.pathA.roomPrior,
        failure: {
          ...failure.pathA.roomPrior.failure,
          safeDetail: "see https://evil.example/path?token=secret",
        },
      },
    },
  };
  const failureMapped = mapAfcDiagnosticAdminMetricDecision(unsafeFailure);
  assert.equal(failureMapped?.kind, "recorded");
  if (failureMapped?.kind === "recorded") {
    assert.equal(failureMapped.value.pathA.roomPrior.failure?.safeDetail, null);
    assert.equal(failureMapped.value.pathA.roomPrior.failure?.failureClass, "provider_http");
  }
  assert.equal(JSON.stringify(failureMapped).includes("https://"), false);
  const evidence = evidenceFrom({ metric_decision: leaked });
  assertAfcDiagnosticAdminPayloadPrivacy(evidence);
});

test("inbox list payload does not gain metricDecision", async () => {
  assert.equal(AFC_DIAGNOSTIC_ADMIN_CASE_LIST_COLUMNS.includes("metric_decision"), false);
  assert.equal(AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS.includes("metric_decision"), true);
  const parsed = parseAfcDiagnosticAdminCaseListQuery(new URLSearchParams());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const result = await listAfcDiagnosticAdminCaseSummaries(
    detailStore(evidenceFrom()),
    parsed.value,
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("metricDecision"), false);
  assert.equal(serialized.includes("metric_decision"), false);
  const response = await handleAfcDiagnosticsAdminCasesGet({
    request: new Request("http://test/api/admin/afc-diagnostics/cases"),
    authorize: async () => ({
      ok: true,
      admin: { userId: USER_A, email: "admin@example.com" },
    }),
    store: detailStore(evidenceFrom()),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { items: unknown[] };
  assert.equal(body.items.length > 0, true);
  assert.equal(JSON.stringify(body).includes("metricDecision"), false);
});

test("public analyze response source does not gain metricDecision", () => {
  const files = [
    "app/api/vibode/afc/analyze/route.ts",
    "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx",
    "lib/afc-v2-diagnostics/admin-case-inbox.client.ts",
    "components/afc-qa/AfcQaTesterReport.tsx",
  ];
  for (const relativePath of files) {
    const source = readFileSync(relativePath, "utf8");
    assert.equal(/metric_decision|metricDecision|AfcV2MetricDecision/.test(source), false, relativePath);
  }
});

test("unauthorized and non-admin detail requests stay rejected", async () => {
  const unauthorized = await handleAfcDiagnosticsAdminCaseDetailGet({
    request: new Request("http://test/cases"),
    caseId: CASE_1,
    authorize: async () => ({
      ok: false,
      response: afcDiagnosticsAdminJson({ error: "Unauthorized." }, 401),
    }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(JSON.stringify(await unauthorized.json()).includes("metricDecision"), false);

  const forbidden = await handleAfcDiagnosticsAdminSessionDetailGet({
    request: new Request("http://test/sessions"),
    sessionId: SESSION_A,
    authorize: async () => ({
      ok: false,
      response: afcDiagnosticsAdminJson({ error: "Admin access required." }, 403),
    }),
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: "Admin access required." });
});

test("case detail and session detail use the same metricDecision shape", async () => {
  const generation = evidenceFrom({
    metric_decision: hardFallbackMetricDecisionRaw(),
    metric_status: "none",
    production_authority: {
      metric: {
        metricScale: 1,
        autoMetricScale: 1,
        accepted: false,
        path: "none",
        authority: "none",
        fallbackApplied: true,
      },
      recovery: { safeFailureState: "metric_fallback" },
    },
  });
  const store = detailStore(generation);
  const caseDetail = await getAfcDiagnosticAdminCaseDetail(store, CASE_1);
  const sessionDetail = await getAfcDiagnosticAdminSessionDetail(store, SESSION_A);
  assert.equal(caseDetail.reportedGeneration.metricDecision?.kind, "recorded");
  assert.deepEqual(
    caseDetail.reportedGeneration.metricDecision,
    sessionDetail.attempts[0]?.generation.metricDecision,
  );
  assert.deepEqual(
    caseDetail.reportedGeneration.legacyMetricConclusion,
    sessionDetail.attempts[0]?.generation.legacyMetricConclusion,
  );
  assertAfcDiagnosticAdminPayloadPrivacy(caseDetail);
  assertAfcDiagnosticAdminPayloadPrivacy(sessionDetail);
  const clientCase = parseAfcDiagnosticAdminMetricDecisionDto(
    caseDetail.reportedGeneration.metricDecision,
  );
  const clientSession = parseAfcDiagnosticAdminMetricDecisionDto(
    sessionDetail.attempts[0]?.generation.metricDecision,
  );
  assert.deepEqual(clientCase, clientSession);
  assert.equal(clientCase?.kind, "recorded");
});
