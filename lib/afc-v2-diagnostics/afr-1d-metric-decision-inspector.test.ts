import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AfcDiagnosticMetricDecisionPanel from "@/app/admin/afc-diagnostics/AfcDiagnosticMetricDecisionPanel";
import { mapAfcDiagnosticAdminMetricDecision } from "@/lib/afc-v2-diagnostics/admin-metric-decision";
import type {
  AfcDiagnosticAdminLegacyMetricConclusion,
  AfcDiagnosticAdminMetricDecision,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision-dto";
import {
  AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID,
  hardFallbackMetricDecisionRaw,
  minimalMetricDecisionRaw,
  pathAAcceptedMetricDecisionRaw,
  pathBAcceptedMetricDecisionRaw,
  pathBLaunchedUnusableMetricDecisionRaw,
  roomPriorFailureMetricDecisionRaw,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision.fixture";

const PANEL = "app/admin/afc-diagnostics/AfcDiagnosticMetricDecisionPanel.tsx";
const INSPECTOR = "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const SESSION = "app/admin/afc-diagnostics/sessions/[sessionId]/AfcDiagnosticSessionInspector.tsx";
const INBOX = "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx";

function recorded(raw: unknown): Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }> {
  const mapped = mapAfcDiagnosticAdminMetricDecision(raw);
  assert.equal(mapped?.kind, "recorded");
  if (mapped?.kind !== "recorded") {
    throw new Error("expected recorded metric decision");
  }
  return mapped;
}

function markup(
  metricDecision: AfcDiagnosticAdminMetricDecision,
  legacy: AfcDiagnosticAdminLegacyMetricConclusion | null = null,
  metricStatus: string | null = "none",
) {
  return renderToStaticMarkup(createElement(AfcDiagnosticMetricDecisionPanel, {
    metricStatus,
    metricDecision,
    legacyMetricConclusion: legacy,
  }));
}

test("recorded V1 final result shows the applied conclusion", () => {
  const html = markup(recorded(pathAAcceptedMetricDecisionRaw()), null, "path_a");
  assert.match(html, /Metric Decision/);
  assert.match(html, /Final result/);
  assert.match(html, /Metric status/);
  assert.match(html, /Selected path/);
  assert.match(html, /Path A/);
  assert.match(html, /Accepted/);
  assert.match(html, />Yes</);
  assert.match(html, /gemini_width_back_span_experimental/);
  assert.match(html, /Metric scale/);
  assert.match(html, />1\.25</);
  assert.match(html, /Auto metric scale/);
  assert.match(html, /Fallback applied/);
  assert.match(html, /Safe failure state/);
  assert.match(html, />None</);
});

test("Path A accepted shows prior, correspondence, and derivation", () => {
  const html = markup(recorded(pathAAcceptedMetricDecisionRaw()), null, "path_a");
  assert.match(html, /Room prior/);
  assert.match(html, /gemini-3\.5-flash/);
  assert.match(html, /afc-v2-metric-room-prior\/v1/);
  assert.match(html, /best 4\.1/);
  assert.match(html, /80%/);
  assert.match(html, /Correspondence/);
  assert.match(html, /span-back/);
  assert.match(html, /\(0\.123, 0\.842\)/);
  assert.match(html, /\(0\.774, 0\.837\)/);
  assert.match(html, /s4a-1/);
  assert.match(html, /seam-1/);
  assert.match(html, /span-left/);
  assert.match(html, /too_short_in_image/);
  assert.match(html, /Parsed width best/);
  assert.match(html, /Physical metres used/);
  assert.match(html, /Canonical gauge length/);
  assert.match(html, /Candidate scale before fallback/);
});

test("Path A rejected with width retained still shows the width estimate", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  assert.match(html, /best 4\.1/);
  assert.match(html, /Parsed width best/);
  assert.match(html, />4\.1</);
  assert.match(html, /Derivation/);
  const derivation = html.split("Derivation")[1] ?? "";
  assert.match(derivation, /Accepted/);
  assert.match(derivation, />No</);
});

test("Path A exact-grid and completeness reason codes render as emitted codes", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  assert.match(html, /lab_trust_not_enabled/);
  assert.match(html, /completeness_not_certified/);
  assert.doesNotMatch(html, /independent check/i);
});

test("Path A candidate before fallback stays visible beside the applied scale", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  assert.match(html, /Candidate scale before fallback/);
  assert.match(html, />0\.42</);
  assert.match(html, /Metric scale/);
  assert.match(html, />1</);
  assert.match(html, /Candidate scale before fallback is recorded separately from the applied scale/);
});

test("Path B suppressed keeps its launch disposition", () => {
  const html = markup(recorded(pathAAcceptedMetricDecisionRaw()), null, "path_a");
  assert.match(html, /Path B outcome: Never launched/);
  assert.match(html, /Suppressed by complete back geometry/);
  assert.match(html, /Estimator launched/);
  assert.doesNotMatch(html, /Not run|not run/);
});

test("Path B launched but unusable is distinct from never launched", () => {
  const html = markup(recorded(pathBLaunchedUnusableMetricDecisionRaw()), null, "none");
  assert.match(html, /Path B outcome: Launched but unusable/);
  assert.match(html, /Launch disposition/);
  assert.match(html, />Launched</);
  assert.match(html, /estimate_unusable/);
});

test("Path B accepted shows geometry and model estimate", () => {
  const html = markup(recorded(pathBAcceptedMetricDecisionRaw()), null, "path_b");
  assert.match(html, /Path B outcome: Accepted/);
  assert.match(html, /Host geometry/);
  assert.match(html, /span-observed/);
  assert.match(html, /floor-authority-1/);
  assert.match(html, /Estimated physical length/);
  assert.match(html, /best 2\.4/);
  assert.match(html, /gemini_observed_span_physical_estimate/);
});

test("hard fallback shows the numeric fallback value", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  assert.match(html, /Fallback was applied\. Numeric fallback value: 1/);
  assert.match(html, /Fallback used/);
  assert.match(html, /Numeric fallback/);
  assert.match(html, /AUTO_METRIC_SCALE/);
  assert.match(html, /Winning path/);
  assert.doesNotMatch(html, /good|bad|plausible|likely correct/i);
});

test("rejected candidate summary stays non-evaluative", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  assert.match(html, /Rejected candidate/);
  assert.match(html, /Rejected candidate scale/);
  assert.match(html, />0\.42</);
  assert.match(html, /Candidate finite/);
  assert.match(html, />Yes</);
  assert.doesNotMatch(html, /plausible|likely correct|estimated authority/i);
});

test("legacy null with a historical conclusion does not invent path evidence", () => {
  const html = markup(null, {
    metricScale: 1,
    autoMetricScale: 1,
    accepted: false,
    path: "none",
    authority: "none",
    fallbackApplied: true,
    safeFailureState: "metric_fallback",
  }, "none");
  assert.match(html, /Metric decision unavailable/);
  assert.match(html, /Path-level metric evidence was not retained for this generation/);
  assert.match(html, /Metric scale/);
  assert.match(html, />1</);
  assert.match(html, /Fallback applied/);
  assert.match(html, /Metric fallback/);
  assert.doesNotMatch(html, /Room prior|Gemini estimate|trust reason/i);
  assert.doesNotMatch(html, /Path A<\/summary>/);
});

test("legacy null without authority does not show a fake scale", () => {
  const html = markup(null, null, "none");
  assert.match(html, /Metric decision unavailable/);
  assert.match(html, /Path-level metric evidence was not retained for this generation/);
  assert.doesNotMatch(html, /Metric scale/);
  assert.doesNotMatch(html, />0</);
  assert.doesNotMatch(html, /Path A<\/summary>/);
});

test("capture_failed does not render empty path panels", () => {
  const mapped = mapAfcDiagnosticAdminMetricDecision({
    schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
    captureStatus: "capture_failed",
    generationId: AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID,
  });
  const html = markup(mapped, null, "none");
  assert.match(html, /Metric decision capture failed/);
  assert.match(html, new RegExp(AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID));
  assert.match(html, /afc-v2-metric-decision-diagnostic\/v1/);
  assert.doesNotMatch(html, /Path A<\/summary>|Path B<\/summary>|Room prior/);
});

test("unsupported schema does not render as V1", () => {
  const mapped = mapAfcDiagnosticAdminMetricDecision({
    schemaVersion: "afc-v2-metric-decision-diagnostic/v2",
    captureStatus: "recorded",
    pathA: { estimatedRoomWidthM: { low: 0, best: 0, high: 0 } },
  });
  const html = markup(mapped, null, "none");
  assert.match(html, /Metric decision schema not supported by this Inspector version/);
  assert.match(html, /afc-v2-metric-decision-diagnostic\/v2/);
  assert.doesNotMatch(html, /Path A<\/summary>|Final result|Room prior/);
});

test("malformed metric decision renders as unreadable", () => {
  const html = markup(mapAfcDiagnosticAdminMetricDecision("not-json"), null, "none");
  assert.match(html, /Metric decision could not be read/);
  assert.doesNotMatch(html, /Path A<\/summary>|not-json|Final result/);
});

test("absent fields render as not available rather than zero", () => {
  const html = markup(recorded(minimalMetricDecisionRaw()), null, "none");
  assert.match(html, /Ceiling estimate/);
  assert.match(html, /Not available/);
  assert.match(html, /Candidate scale before fallback/);
  assert.doesNotMatch(html, />0</);
  const failure = markup(recorded(roomPriorFailureMetricDecisionRaw()), null, "none");
  assert.match(failure, /Failure class/);
  assert.match(failure, /provider_http/);
  assert.match(failure, /provider_status_503/);
  assert.match(failure, />503</);
});

test("reason arrays render without free-form provider prose", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  assert.match(html, /<li[^>]*>lab_trust_not_enabled<\/li>/);
  assert.match(html, /<li[^>]*>completeness_not_certified<\/li>/);
  assert.doesNotMatch(html, /The model wrote a long note/);
  assert.doesNotMatch(html, /<pre|JSON\.stringify/);
});

test("inspector does not dump raw metric decision JSON", () => {
  const html = markup(recorded(hardFallbackMetricDecisionRaw()), null, "none");
  const source = readFileSync(PANEL, "utf8");
  assert.doesNotMatch(html, /\{"schemaVersion"/);
  assert.doesNotMatch(source, /JSON\.stringify/);
  assert.doesNotMatch(html, /<pre/);
});

test("case summary stays free of the metric decision section", () => {
  const inspector = readFileSync(INSPECTOR, "utf8");
  const session = readFileSync(SESSION, "utf8");
  const summary = inspector.split("Case summary")[1]?.split("Reported issue")[0] ?? "";
  assert.doesNotMatch(summary, /Metric Decision|metricDecision/);
  assert.match(inspector, /AfcDiagnosticMetricDecisionPanel/);
  assert.match(session, /AfcDiagnosticMetricDecisionPanel/);
  assert.match(inspector, /<summary[^>]*>\s*Metric Decision\s*<\/summary>|AfcDiagnosticMetricDecisionPanel/);
});

test("case inbox source stays unchanged", () => {
  const inbox = readFileSync(INBOX, "utf8");
  assert.doesNotMatch(inbox, /metricDecision|metric_decision|Metric Decision|AfcDiagnosticMetricDecisionPanel/);
  assert.match(inbox, /AfcDiagnosticCaseInbox|replaceSelect\("reviewStatus"/);
});
