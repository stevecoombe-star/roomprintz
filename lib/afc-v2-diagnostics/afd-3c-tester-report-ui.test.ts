import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AFC_QA_ISSUE_CODES } from "./taxonomy";
import {
  AFC_QA_BROWSER_STATE_PATH,
  AFC_QA_TESTER_CASE_PATH,
  AFC_QA_TESTER_COPY,
  AFC_QA_TESTER_ISSUE_OPTIONS,
  AFC_QA_TESTER_NOTES_MAX_CHARS,
  afcQaBrowserStateUrl,
  afcQaTesterSubmitErrorMessage,
  buildAfcQaTesterCaseBody,
  canShowAfcQaAutomaticOffer,
  canShowAfcQaManualReport,
  collectAfcQaTesterCaseBodyPrivacyViolations,
  createInitialAfcQaTesterReportModel,
  deriveAfcQaTesterReportView,
  parseAfcQaBrowserState,
  reduceAfcQaTesterReport,
  shouldRefreshAfcQaStateAfterPrepareSettle,
  type AfcQaBrowserState,
  type AfcQaTesterReportEvent,
  type AfcQaTesterReportModel,
} from "./tester-report.client";

const ROOT = process.cwd();
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GEN_A = "11111111-1111-4111-8111-111111111111";
const GEN_B = "12121212-1212-4121-8121-121212121212";
const SESSION_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const FORBIDDEN_BODY_FIELDS = [
  "sessionId",
  "reporterUserId",
  "taxonomyVersion",
  "machineStatusSnapshot",
  "originalSha256",
  "originalIdentity",
  "reviewStatus",
  "reviewerUserId",
  "reviewNotes",
  "reviewedAt",
];

const UI_SOURCE = "components/afc-qa/AfcQaTesterReport.tsx";

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function projection(overrides: Partial<AfcQaBrowserState> = {}): AfcQaBrowserState {
  return {
    enabled: true,
    canReport: true,
    offerFeedback: false,
    reportGenerationId: GEN_A,
    ...overrides,
  };
}

function ready(
  model: AfcQaTesterReportModel,
  state: AfcQaBrowserState,
): AfcQaTesterReportModel {
  return reduceAfcQaTesterReport(model, {
    type: "projection_ready",
    projection: state,
  }).state;
}

function apply(
  model: AfcQaTesterReportModel,
  events: readonly AfcQaTesterReportEvent[],
) {
  let current = model;
  let lastEffect = reduceAfcQaTesterReport(current, { type: "clear_success" }).effect;
  for (const event of events) {
    const result = reduceAfcQaTesterReport(current, event);
    current = result.state;
    lastEffect = result.effect;
  }
  return { state: current, effect: lastEffect, view: deriveAfcQaTesterReportView(current) };
}

function reportableModel(state: AfcQaBrowserState = projection()) {
  return ready(createInitialAfcQaTesterReportModel(ROOM_A), state);
}

test("1) QA disabled hides report button, prompt, and form", () => {
  const { view } = apply(createInitialAfcQaTesterReportModel(ROOM_A), [
    {
      type: "projection_ready",
      projection: projection({
        enabled: false,
        canReport: false,
        offerFeedback: false,
        reportGenerationId: null,
      }),
    },
  ]);
  assert.equal(view.showManualReport, false);
  assert.equal(view.showAutomaticPrompt, false);
  assert.equal(view.showForm, false);
});

test("2-4) enabled without a reportable generation shows no QA chrome", () => {
  const { view } = apply(createInitialAfcQaTesterReportModel(ROOM_A), [
    {
      type: "projection_ready",
      projection: projection({
        canReport: false,
        offerFeedback: false,
        reportGenerationId: null,
      }),
    },
  ]);
  assert.equal(canShowAfcQaManualReport(projection({ canReport: false, reportGenerationId: null })), false);
  assert.equal(view.showManualReport, false);
  assert.equal(view.showAutomaticPrompt, false);
});

test("5) first READY: manual report visible, no automatic prompt", () => {
  const { view } = apply(reportableModel(projection({ offerFeedback: false })), []);
  assert.equal(view.showManualReport, true);
  assert.equal(view.showAutomaticPrompt, false);
  assert.equal(view.showRerun, false);
});

test("6) first FAILED projection is identical: manual only", () => {
  const { view } = apply(
    reportableModel(projection({ canReport: true, offerFeedback: false })),
    [],
  );
  assert.equal(view.showManualReport, true);
  assert.equal(view.showAutomaticPrompt, false);
  assert.equal(view.showRerun, false);
});

test("7) repeated unsuccessful shows automatic prompt and keeps manual entry", () => {
  const { view } = apply(
    reportableModel(projection({ offerFeedback: true })),
    [],
  );
  assert.equal(view.showManualReport, true);
  assert.equal(view.showAutomaticPrompt, true);
});

test("8) Not now dismisses the prompt locally without a POST", () => {
  const start = reportableModel(projection({ offerFeedback: true }));
  const dismissed = apply(start, [{ type: "dismiss_automatic" }]);
  assert.equal(dismissed.effect.type, "none");
  assert.equal(dismissed.view.showAutomaticPrompt, false);
  assert.equal(dismissed.view.showManualReport, true);
  const rerender = deriveAfcQaTesterReportView(dismissed.state);
  assert.equal(rerender.showAutomaticPrompt, false);
});

test("9) a new reportGenerationId can show the automatic prompt again", () => {
  const dismissed = apply(reportableModel(projection({ offerFeedback: true })), [
    { type: "dismiss_automatic" },
  ]).state;
  const next = apply(dismissed, [
    {
      type: "projection_ready",
      projection: projection({
        offerFeedback: true,
        reportGenerationId: GEN_B,
      }),
    },
  ]);
  assert.equal(next.view.showAutomaticPrompt, true);
  assert.equal(next.view.showManualReport, true);
});

test("10-15) manual form opens the shared multi-select with optional notes", () => {
  const opened = apply(reportableModel(), [{ type: "open_manual" }]);
  assert.equal(opened.state.form?.trigger, "manual_report");
  assert.equal(opened.view.showForm, true);
  assert.equal(opened.view.showAutomaticPrompt, false);
  assert.deepEqual(opened.view.selectedCodes, []);
  assert.equal(opened.view.canSubmit, false);

  const selected = apply(opened.state, [
    { type: "toggle_issue", code: "perspective_off" },
    { type: "toggle_issue", code: "scale_incorrect" },
  ]);
  assert.deepEqual([...selected.view.selectedCodes], [
    "perspective_off",
    "scale_incorrect",
  ]);
  assert.equal(selected.view.canSubmit, true);

  const notes = apply(selected.state, [{ type: "set_notes", notes: "  optional  " }]);
  assert.equal(notes.state.form?.notes, "  optional  ");
});

test("16-17) manual submit payload is exactly the frozen browser contract", () => {
  const result = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
  ]);
  assert.equal(result.effect.type, "post_case");
  if (result.effect.type !== "post_case") return;
  assert.equal(result.effect.url, AFC_QA_TESTER_CASE_PATH);
  assert.deepEqual(result.effect.body, {
    roomId: ROOM_A,
    generationId: GEN_A,
    issueCodes: ["perspective_off"],
    trigger: "manual_report",
  });
  assert.deepEqual(Object.keys(result.effect.body), [
    "roomId",
    "generationId",
    "issueCodes",
    "trigger",
  ]);
  assert.deepEqual(collectAfcQaTesterCaseBodyPrivacyViolations(result.effect.body), []);
});

test("18-20) automatic submit payload uses repeated_unsuccessful", () => {
  const result = apply(reportableModel(projection({ offerFeedback: true })), [
    { type: "open_automatic" },
    { type: "toggle_issue", code: "scale_incorrect" },
    { type: "submit_requested" },
  ]);
  assert.equal(result.effect.type, "post_case");
  if (result.effect.type !== "post_case") return;
  assert.deepEqual(result.effect.body, {
    roomId: ROOM_A,
    generationId: GEN_A,
    issueCodes: ["scale_incorrect"],
    trigger: "repeated_unsuccessful",
  });
});

test("21) multiple codes preserve canonical taxonomy order", () => {
  const result = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "scale_incorrect" },
    { type: "toggle_issue", code: "wall_edges_unrecognized" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
  ]);
  assert.equal(result.effect.type, "post_case");
  if (result.effect.type !== "post_case") return;
  assert.deepEqual([...result.effect.body.issueCodes], [
    "perspective_off",
    "wall_edges_unrecognized",
    "scale_incorrect",
  ]);
  assert.deepEqual([...AFC_QA_ISSUE_CODES], [
    "perspective_off",
    "wall_edges_unrecognized",
    "scale_incorrect",
    "other",
  ]);
});

test("22-23) blank notes are omitted and non-blank notes are browser evidence only", () => {
  const blank = buildAfcQaTesterCaseBody({
    roomId: ROOM_A,
    generationId: GEN_A,
    issueCodes: ["other"],
    trigger: "manual_report",
    notes: "   ",
  });
  assert.equal("notes" in blank, false);
  const withNotes = buildAfcQaTesterCaseBody({
    roomId: ROOM_A,
    generationId: GEN_A,
    issueCodes: ["other"],
    trigger: "manual_report",
    notes: " lighting feels off ",
  });
  assert.equal(withNotes.notes, "lighting feels off");
  assert.deepEqual(collectAfcQaTesterCaseBodyPrivacyViolations(withNotes), []);
});

test("24) other may be submitted without notes", () => {
  const result = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "other" },
    { type: "submit_requested" },
  ]);
  assert.equal(result.effect.type, "post_case");
  if (result.effect.type !== "post_case") return;
  assert.deepEqual([...result.effect.body.issueCodes], ["other"]);
  assert.equal("notes" in result.effect.body, false);
});

test("25-26) submit pending disables repeats and does not POST twice", () => {
  const pending = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
  ]);
  assert.equal(pending.view.submitting, true);
  assert.equal(pending.view.canSubmit, false);
  const repeat = reduceAfcQaTesterReport(pending.state, { type: "submit_requested" });
  assert.equal(repeat.effect.type, "none");
});

test("27-29) success acknowledges, closes the form, and suppresses the prompt", () => {
  const submitted = apply(reportableModel(projection({ offerFeedback: true })), [
    { type: "open_automatic" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
    { type: "submit_succeeded" },
  ]);
  assert.equal(submitted.effect.type, "refresh_qa");
  assert.equal(submitted.view.showForm, false);
  assert.equal(submitted.view.showAutomaticPrompt, false);
  assert.equal(submitted.view.showManualReport, true);
  assert.equal(submitted.view.successMessage, AFC_QA_TESTER_COPY.success);
});

test("30) 400 shows a friendly validation error", () => {
  const missing = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "submit_requested" },
  ]);
  assert.equal(missing.effect.type, "none");
  assert.equal(missing.view.formError, AFC_QA_TESTER_COPY.error400);
  const http = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
    { type: "submit_http_error", status: 400 },
  ]);
  assert.equal(http.view.showForm, true);
  assert.equal(http.view.formError, AFC_QA_TESTER_COPY.error400);
  assert.equal(http.view.submitting, false);
});

test("31-33) 404 closes the form, refreshes QA, and stays generic", () => {
  const result = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
    { type: "submit_http_error", status: 404 },
  ]);
  assert.equal(result.effect.type, "refresh_qa");
  assert.equal(result.view.showForm, false);
  assert.equal(result.view.noticeMessage, AFC_QA_TESTER_COPY.error404);
});

test("34) 500 shows a generic retry message", () => {
  const result = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
    { type: "submit_http_error", status: 500 },
  ]);
  assert.equal(result.view.showForm, true);
  assert.equal(result.view.formError, AFC_QA_TESTER_COPY.error500);
  assert.equal(afcQaTesterSubmitErrorMessage(503), AFC_QA_TESTER_COPY.error500);
});

test("35-36) QA state fetch failure hides diagnostics without requiring editor chrome", () => {
  const result = apply(createInitialAfcQaTesterReportModel(ROOM_A), [
    { type: "projection_error" },
  ]);
  assert.equal(result.view.showManualReport, false);
  assert.equal(result.view.showAutomaticPrompt, false);
  assert.equal(result.view.showForm, false);
});

test("37) stale generation is not submitted against a newly changed id", () => {
  const open = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
  ]).state;
  assert.equal(open.form?.boundGenerationId, GEN_A);
  const changed = apply(open, [
    {
      type: "projection_ready",
      projection: projection({ reportGenerationId: GEN_B, offerFeedback: true }),
    },
  ]);
  assert.equal(changed.view.showForm, false);
  assert.equal(changed.state.form, null);
  assert.equal(changed.view.showAutomaticPrompt, true);

  const staleFormStillOpen: AfcQaTesterReportModel = {
    ...open,
    projection: projection({ reportGenerationId: GEN_B }),
  };
  const blocked = reduceAfcQaTesterReport(staleFormStillOpen, {
    type: "submit_requested",
  });
  assert.notEqual(blocked.effect.type, "post_case");
  assert.equal(blocked.effect.type, "refresh_qa");
  assert.equal(blocked.state.form, null);
  assert.equal(blocked.state.noticeMessage, AFC_QA_TESTER_COPY.error404);
});

test("security: browser body never includes authority or review fields", () => {
  const body = buildAfcQaTesterCaseBody({
    roomId: ROOM_A,
    generationId: GEN_A,
    issueCodes: ["perspective_off", "other"],
    trigger: "manual_report",
    notes: "ok",
  });
  const serialized = JSON.stringify(body);
  for (const field of FORBIDDEN_BODY_FIELDS) {
    assert.equal(field in body, false, field);
    assert.equal(serialized.includes(field), false, field);
  }
  assert.equal(serialized.includes(SESSION_A), false);
  assert.deepEqual(collectAfcQaTesterCaseBodyPrivacyViolations({
    ...body,
    sessionId: SESSION_A,
    reporterUserId: "user",
  }), ["sessionId", "reporterUserId"]);
});

test("security: UI copy is human-facing and does not interpolate internals", () => {
  const ui = source(UI_SOURCE);
  assert.match(ui, /AFC_QA_TESTER_COPY\.manualButton/);
  assert.match(ui, /AFC_QA_TESTER_COPY\.promptTitle/);
  assert.match(ui, /type="checkbox"/);
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /aria-busy=\{view\.submitting\}/);
  assert.match(ui, /disabled=\{!view\.canSubmit\}/);
  assert.doesNotMatch(ui, /type="radio"/);
  assert.doesNotMatch(ui, /value=\{option\.code\}/);
  assert.doesNotMatch(ui, /reportGenerationId|sessionId|attemptCount|machineStatus/);
  assert.doesNotMatch(ui, /\{GEN_|session_not_found|taxonomyVersion/);
  assert.equal(AFC_QA_TESTER_COPY.manualButton, "Report an issue");
  assert.equal(AFC_QA_TESTER_COPY.promptTitle, "Still not looking right?");
  assert.equal(
    AFC_QA_TESTER_ISSUE_OPTIONS[0]?.label,
    "Perspective looks wrong",
  );
});

test("QA state URL is room-scoped and cache-free by contract", () => {
  assert.equal(
    afcQaBrowserStateUrl(ROOM_A),
    `${AFC_QA_BROWSER_STATE_PATH}?roomId=${ROOM_A}`,
  );
  const parsed = parseAfcQaBrowserState({
    enabled: true,
    canReport: true,
    offerFeedback: true,
    reportGenerationId: GEN_A,
    sessionId: SESSION_A,
    attemptCount: 9,
    machineStatus: "failed",
  });
  assert.deepEqual(parsed, {
    enabled: true,
    canReport: true,
    offerFeedback: true,
    reportGenerationId: GEN_A,
  });
  assert.deepEqual(Object.keys(parsed ?? {}), [
    "enabled",
    "canReport",
    "offerFeedback",
    "reportGenerationId",
  ]);
  assert.equal(parseAfcQaBrowserState(null), null);
});

test("browser does not invent automatic-offer eligibility", () => {
  assert.equal(
    canShowAfcQaAutomaticOffer(
      projection({ offerFeedback: false, canReport: true }),
    ),
    false,
  );
  assert.equal(
    canShowAfcQaAutomaticOffer(
      projection({ offerFeedback: true, canReport: true }),
    ),
    true,
  );
  const client = source("lib/afc-v2-diagnostics/tester-report.client.ts");
  assert.doesNotMatch(client, /attemptCount\s*>=\s*2/);
  assert.doesNotMatch(client, /retryCount/);
  assert.doesNotMatch(client, /machineStatus === ["']failed["']/);
});

test("prepare settle refreshes QA without polling", () => {
  assert.equal(
    shouldRefreshAfcQaStateAfterPrepareSettle({
      previousPhase: "running",
      nextPhase: "ready",
    }),
    true,
  );
  assert.equal(
    shouldRefreshAfcQaStateAfterPrepareSettle({
      previousPhase: "running",
      nextPhase: "error",
    }),
    true,
  );
  assert.equal(
    shouldRefreshAfcQaStateAfterPrepareSettle({
      previousPhase: "idle",
      nextPhase: "ready",
    }),
    false,
  );
  const ui = source("components/afc-qa/AfcQaTesterReport.tsx");
  assert.match(ui, /shouldRefreshAfcQaStateAfterPrepareSettle/);
  assert.doesNotMatch(ui, /setInterval/);
});

test("taxonomy v1 options match certified codes with tester-facing labels", () => {
  assert.deepEqual(
    AFC_QA_TESTER_ISSUE_OPTIONS.map((option) => option.code),
    [...AFC_QA_ISSUE_CODES],
  );
  assert.equal(AFC_QA_TESTER_NOTES_MAX_CHARS, 2000);
});

test("cancel and dismiss do not create Cases or close Sessions", () => {
  const model = reportableModel(projection({ offerFeedback: true }));
  const dismissed = reduceAfcQaTesterReport(model, { type: "dismiss_automatic" });
  const cancelled = apply(model, [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "cancel_form" },
  ]);
  assert.equal(dismissed.effect.type, "none");
  assert.equal(cancelled.effect.type, "none");
  assert.equal(cancelled.view.showForm, false);
  assert.equal(cancelled.view.showManualReport, true);
});

test("401 uses the existing session-expired wording", () => {
  const result = apply(reportableModel(), [
    { type: "open_manual" },
    { type: "toggle_issue", code: "perspective_off" },
    { type: "submit_requested" },
    { type: "submit_http_error", status: 401 },
  ]);
  assert.equal(result.effect.type, "unauthorized");
  assert.equal(result.view.formError, AFC_QA_TESTER_COPY.sessionExpired);
});

test("AFD-3C mounts in Editor chrome without touching STAGE drawers or canvas size", () => {
  const editor = source("app/editor/page.tsx");
  const header = source("components/stage/StageEditorHeader.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");
  assert.match(editor, /<AfcQaTesterReport/);
  assert.match(editor, /roomId=\{editorRoomId\}/);
  assert.match(editor, /preparePhase=\{prepare3dPhase\}/);
  assert.match(editor, /h-\[70vh\] w-\[70vw\] max-w-\[1200px\]/);
  assert.match(editor, /<StageEditorShell active=\{viewportMode === "3d"\}>/);
  assert.match(editor, /<ImageHistoryTimeline/);
  assert.doesNotMatch(editor, /Re-run room read|canRerun|run_again/);
  assert.doesNotMatch(header, /AfcQaTesterReport|Report an issue/);
  assert.doesNotMatch(shell, /AfcQaTesterReport|Report an issue/);
});

test("AFD-3C does not expand backend contracts or add a migration", () => {
  const stateRoute = source("app/api/vibode/afc/qa/state/route.ts");
  const caseRoute = source("app/api/vibode/afc/qa/cases/route.ts");
  const capability = source("app/api/vibode/afc/qa/capability/route.ts");
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  assert.match(stateRoute, /handleAfcQaBrowserStateGet/);
  assert.match(stateRoute, /export async function GET/);
  assert.doesNotMatch(stateRoute, /export async function POST/);
  assert.match(caseRoute, /handleAfcQaTesterCasePost/);
  assert.match(caseRoute, /export async function POST/);
  assert.doesNotMatch(caseRoute, /export async function GET/);
  assert.match(capability, /handleAfcQaCapabilityGet/);
  assert.doesNotMatch(capability, /AfcQaTesterReport|tester-report/);
  assert.match(analyze, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(analyze, /tester-report|AfcQaTesterReport/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?3c|tester.?report/i.test(name)),
    false,
  );
  assert.equal(existsSync(path.join(ROOT, "app/admin/afc-qa")), false);
});

test("AFD-3C UI has no Session, Case, or AFC authority logic", () => {
  const files = [
    path.join(ROOT, "lib/afc-v2-diagnostics/tester-report.client.ts"),
    path.join(ROOT, "lib/afc-v2-diagnostics/use-afc-qa-state.ts"),
    path.join(ROOT, "components/afc-qa/AfcQaTesterReport.tsx"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /getServiceRoleSupabaseClient/);
    assert.doesNotMatch(
      text,
      /session-lifecycle|closeStaleOpenSessions|insertOpenSession|ensureAfcDiagnosticSessionMembership|session-attach/,
    );
    assert.doesNotMatch(
      text,
      /submitAfcDiagnosticTesterCase|handleAfcQaTesterCasePost|insertTesterCase/,
    );
    assert.doesNotMatch(
      text,
      /runProductionAfcAnalysis|production-adapter|production-persistence|production-authority-contract/,
    );
    assert.doesNotMatch(text, /canRerun|admin_capture/);
    assert.doesNotMatch(text, /findTesterCase|idempotent/);
    assert.doesNotMatch(text, /corpus|regression fixture|screenshot/);
  }
  const hook = source("lib/afc-v2-diagnostics/use-afc-qa-state.ts");
  assert.match(hook, /getSupabaseBrowserAccessToken/);
  assert.match(hook, /cache: "no-store"/);
  assert.match(hook, /afcQaBrowserStateUrl/);
  const ui = source("components/afc-qa/AfcQaTesterReport.tsx");
  assert.match(ui, /JSON\.stringify\(effect\.body\)/);
  assert.doesNotMatch(ui, /localStorage/);
});

test("production runtime and STAGE files stay free of tester-report internals", () => {
  const files = [
    ...walkTs(path.join(ROOT, "lib/afc-v2-runtime")),
    ...walkTs(path.join(ROOT, "lib/afc-v2-production")),
    ...walkTs(path.join(ROOT, "components/stage")),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /tester-report|AfcQaTesterReport|\/api\/vibode\/afc\/qa\/state|\/api\/vibode\/afc\/qa\/cases|\/api\/vibode\/afc\/qa\/rerun/,
      path.relative(ROOT, file),
    );
  }
});
