import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mapAfcDiagnosticAdminMetricDecision } from "./admin-metric-decision";
import { pathAAcceptedMetricDecisionRaw } from "./admin-metric-decision.fixture";
import {
  AfcDiagnosticSelectedAttemptCopyJsonButton,
  afcDiagnosticSelectedAttemptCopyLabel,
} from "./admin-selected-attempt-export-button";
import {
  AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION,
  copyAfcDiagnosticSelectedAttemptExport,
  type AfcDiagnosticSelectedAttemptExportSource,
} from "./admin-selected-attempt-export";

const EXPORTED_AT = "2026-09-24T03:00:00.000Z";
const CASE_ID = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SESSION_ID = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";

const INSPECTOR = "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const SESSION = "app/admin/afc-diagnostics/sessions/[sessionId]/AfcDiagnosticSessionInspector.tsx";
const INBOX = "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx";
const BUTTON = "lib/afc-v2-diagnostics/admin-selected-attempt-export-button.tsx";
const EXPORT = "lib/afc-v2-diagnostics/admin-selected-attempt-export.ts";

function generation(generationId: string) {
  return {
    generationId,
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: generationId === GEN_2 ? GEN_1 : null,
    lineageSeq: generationId === GEN_2 ? 33 : 32,
    runId: generationId === GEN_2 ? "run-2" : "run-1",
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
    metricDecision: mapAfcDiagnosticAdminMetricDecision(pathAAcceptedMetricDecisionRaw()),
    legacyMetricConclusion: null,
    engineFingerprint: null,
    original: null,
    empty: { present: false, sha256: null, artifactSource: null },
    tiled: { present: false, sha256: null, artifactSource: null },
  };
}

function exportSource(generationId: string, attemptOrdinal: number): AfcDiagnosticSelectedAttemptExportSource {
  const current = generation(generationId);
  const caseDetail = {
    caseId: CASE_ID,
    submittedAt: "2026-09-18T12:10:00.000Z",
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    reporterUserId: USER_ID,
    reportedGenerationId: GEN_1,
    reportedAttemptOrdinal: 1,
    trigger: "manual_report",
    origin: "tester",
    taxonomyVersion: "afc-qa-issue-taxonomy/v1",
    issueCodes: ["perspective_off"],
    notes: "NOTES_SENTINEL",
    machineStatusSnapshot: "ready",
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
      sessionId: SESSION_ID,
      status: "open",
      sessionUserId: USER_ID,
      roomId: ROOM_ID,
      originalSha256: "ab".repeat(32),
      attemptCount: 2,
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:05:00.000Z",
    },
    reportedGeneration: generation(GEN_1),
  };
  return {
    caseDetail: caseDetail as AfcDiagnosticSelectedAttemptExportSource["caseDetail"],
    session: null,
    attempt: {
      generationId,
      attemptOrdinal,
      intent: "analyze",
      associatedAt: "2026-09-18T12:00:00.000Z",
      generation: current as AfcDiagnosticSelectedAttemptExportSource["generation"],
    },
    generation: current as AfcDiagnosticSelectedAttemptExportSource["generation"],
    associatedAt: "2026-09-18T12:00:00.000Z",
    attemptOrdinal,
  };
}

test("Copy JSON button is on the selected attempt and idle markup is Copy JSON", () => {
  const inspector = readFileSync(INSPECTOR, "utf8");
  const selected = inspector.split("Selected attempt")[1] ?? "";
  const summary = inspector.split("Case summary")[1]?.split("Reported issue")[0] ?? "";
  assert.match(selected, /AfcDiagnosticSelectedAttemptCopyJsonButton/);
  assert.doesNotMatch(summary, /Copy JSON|AfcDiagnosticSelectedAttemptCopyJsonButton/);
  const html = renderToStaticMarkup(createElement(AfcDiagnosticSelectedAttemptCopyJsonButton, {
    source: exportSource(GEN_1, 1),
  }));
  assert.match(html, /Copy JSON/);
  assert.match(html, /aria-label="Copy selected attempt JSON"/);
  assert.equal(afcDiagnosticSelectedAttemptCopyLabel("idle"), "Copy JSON");
});

test("copy activation writes one pretty JSON payload", async () => {
  const writes: string[] = [];
  const result = await copyAfcDiagnosticSelectedAttemptExport(exportSource(GEN_1, 1), {
    now: () => new Date(EXPORTED_AT),
    writeText: async (text) => {
      writes.push(text);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  const parsed = JSON.parse(writes[0] ?? "") as {
    schemaVersion: string;
    attempt: { generationId: string };
  };
  assert.equal(parsed.schemaVersion, AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION);
  assert.equal(parsed.attempt.generationId, GEN_1);
  assert.match(writes[0] ?? "", /^{\n  "schemaVersion":/);
});

test("copy success and failure labels are local feedback", () => {
  assert.equal(afcDiagnosticSelectedAttemptCopyLabel("copied"), "Copied");
  assert.equal(afcDiagnosticSelectedAttemptCopyLabel("failed"), "Copy failed");
});

test("clipboard failure returns failed without throwing", async () => {
  const result = await copyAfcDiagnosticSelectedAttemptExport(exportSource(GEN_1, 1), {
    now: () => new Date(EXPORTED_AT),
    writeText: async () => {
      throw new Error("denied");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.text ?? "", /vibode-afc-selected-attempt-export\/v1/);
});

test("copy does not fetch and follows the selected attempt", async () => {
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  try {
    const first = await copyAfcDiagnosticSelectedAttemptExport(exportSource(GEN_1, 1), {
      now: () => new Date(EXPORTED_AT),
      writeText: async () => undefined,
    });
    const second = await copyAfcDiagnosticSelectedAttemptExport(exportSource(GEN_2, 2), {
      now: () => new Date(EXPORTED_AT),
      writeText: async () => undefined,
    });
    assert.equal(fetches, 0);
    assert.notEqual(first.text, second.text);
    const parsed = JSON.parse(second.text ?? "") as { attempt: { generationId: string; attemptOrdinal: number } };
    assert.equal(parsed.attempt.generationId, GEN_2);
    assert.equal(parsed.attempt.attemptOrdinal, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("case summary, inbox, and session inspector do not gain the export action", () => {
  const inspector = readFileSync(INSPECTOR, "utf8");
  const summary = inspector.split("Case summary")[1]?.split("Reported issue")[0] ?? "";
  assert.doesNotMatch(summary, /metricDecision|Copy JSON/);
  assert.doesNotMatch(readFileSync(INBOX, "utf8"), /Copy JSON|vibode-afc-selected-attempt-export/);
  assert.doesNotMatch(readFileSync(SESSION, "utf8"), /Copy JSON|admin-selected-attempt-export/);
  const button = readFileSync(BUTTON, "utf8");
  const exporter = readFileSync(EXPORT, "utf8");
  assert.match(button, /copyAfcDiagnosticSelectedAttemptExport\(source\)/);
  assert.equal((exporter.match(/navigator\.clipboard/g) ?? []).length, 2);
  assert.doesNotMatch(`${button}\n${exporter}`, /\bfetch\s*\(/);
  assert.doesNotMatch(`${button}\n${exporter}`, /supabase|createClient|migration/i);
});
