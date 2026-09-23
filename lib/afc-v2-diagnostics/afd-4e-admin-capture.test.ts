import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const CAPTURE_LOGIC = "lib/afc-v2-diagnostics/admin-capture.ts";
const CAPTURE_SERVER = "lib/afc-v2-diagnostics/admin-capture.server.ts";
const CAPTURE_CLIENT = "lib/afc-v2-diagnostics/admin-case-capture.client.ts";
const CAPTURE_PANEL =
  "app/admin/afc-diagnostics/AfcDiagnosticAdminCapturePanel.tsx";
const SESSION_PAGE =
  "app/admin/afc-diagnostics/sessions/[sessionId]/page.tsx";
const SESSION_INSPECTOR =
  "app/admin/afc-diagnostics/sessions/[sessionId]/AfcDiagnosticSessionInspector.tsx";
const INSPECTOR =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const REVIEW_PANEL =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticAdminReviewPanel.tsx";
const INBOX = "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx";
const READ_MODEL_SERVER = "lib/afc-v2-diagnostics/admin-read-model.server.ts";
const LIST_ROUTE = "app/api/admin/afc-diagnostics/cases/route.ts";
const CASE_ROUTE = "app/api/admin/afc-diagnostics/cases/[caseId]/route.ts";
const REVIEW_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/review/route.ts";
const SESSION_ROUTE =
  "app/api/admin/afc-diagnostics/sessions/[sessionId]/route.ts";
const CAPTURE_ROUTE =
  "app/api/admin/afc-diagnostics/sessions/[sessionId]/cases/route.ts";
const ARTIFACT_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/artifacts/[kind]/route.ts";
const OVERLAY_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/overlay/route.ts";
const TESTER_SERVER = "lib/afc-v2-diagnostics/submit-tester-case.server.ts";
const VISUAL =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx";

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

const logic = source(CAPTURE_LOGIC);
const server = source(CAPTURE_SERVER);
const client = source(CAPTURE_CLIENT);
const panel = source(CAPTURE_PANEL);
const sessionPage = source(SESSION_PAGE);
const sessionInspector = source(SESSION_INSPECTOR);
const inspector = source(INSPECTOR);
const reviewPanel = source(REVIEW_PANEL);
const inbox = source(INBOX);
const readModelServer = source(READ_MODEL_SERVER);
const testerServer = source(TESTER_SERVER);
const visual = source(VISUAL);

test("AFD-4E files exist and capture is hosted on Session + Case Inspector, not Inbox", () => {
  for (const relative of [
    CAPTURE_LOGIC,
    CAPTURE_SERVER,
    CAPTURE_CLIENT,
    CAPTURE_PANEL,
    SESSION_PAGE,
    SESSION_INSPECTOR,
    CAPTURE_ROUTE,
  ]) {
    assert.equal(existsSync(path.join(ROOT, relative)), true, relative);
  }
  assert.equal((inspector.match(/<AfcDiagnosticAdminCapturePanel/g) ?? []).length, 1);
  assert.equal(
    (sessionInspector.match(/<AfcDiagnosticAdminCapturePanel/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(inbox, /AfcDiagnosticAdminCapturePanel|Create Case/);
  assert.doesNotMatch(inbox, /postAfcDiagnosticAdminCaptureCase/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?4e|admin.?capture/i.test(name)),
    false,
  );
});

test("browser surfaces never construct service-role clients or insert Cases directly", () => {
  const browser = [client, panel, inspector, sessionInspector, inbox].join("\n");
  assert.doesNotMatch(
    browser,
    /getServiceRoleSupabaseClient|createBrowserClient|getCookieSupabaseClient/,
  );
  assert.doesNotMatch(browser, /\.from\(\s*["']vibode_afc_diagnostic/);
  assert.doesNotMatch(logic, /getServiceRoleSupabaseClient|from\("vibode_afc_diagnostic/);
  assert.doesNotMatch(client, /admin-capture\.server|admin-read-model\.server/);
  assert.doesNotMatch(panel, /admin-capture\.server|admin-read-model\.server/);
});

test("capture insert is an explicit allowlist and never spreads req.body", () => {
  assert.doesNotMatch(server, /insert\(\s*req\.body|insert\(\s*body|insert\(\s*parsed/);
  assert.match(
    server,
    /const payload = \{\s*session_id: input\.session_id,\s*room_id: input\.room_id,\s*reporter_user_id: input\.reporter_user_id,\s*reported_generation_id: input\.reported_generation_id,\s*original_sha256: input\.original_sha256,\s*original_identity: input\.original_identity,\s*taxonomy_version: input\.taxonomy_version,\s*issue_codes: \[\.\.\.input\.issue_codes\],\s*notes: input\.notes,\s*trigger: input\.trigger,\s*machine_status_snapshot: input\.machine_status_snapshot,\s*\}/,
  );
  assert.match(server, /authorizeAfcDiagnosticsAdmin/);
  assert.match(server, /getServiceRoleSupabaseClient/);
  assert.match(
    server,
    /const auth = await authorizeOrReject\(args\);[\s\S]*const stores = resolveStores\(args\);/,
  );
  assert.doesNotMatch(
    server,
    /submitAfcDiagnosticTesterCase|handleAfcQaTesterCasePost/,
  );
  assert.match(server, /buildAfcDiagnosticOriginalIdentity/);
  assert.match(server, /reporter_user_id: input\.session\.userId/);
  assert.doesNotMatch(server, /reporter_user_id: auth\.admin\.userId/);
  assert.doesNotMatch(readModelServer, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("POST exists only on the Session-scoped cases route; prior routes keep their verbs", () => {
  assert.match(source(LIST_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(LIST_ROUTE), /export async function POST/);
  assert.match(source(CASE_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(CASE_ROUTE), /export async function POST/);
  assert.match(source(SESSION_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(SESSION_ROUTE), /export async function POST/);
  assert.match(source(REVIEW_ROUTE), /export async function PATCH/);
  assert.doesNotMatch(source(REVIEW_ROUTE), /export async function POST/);
  assert.match(source(ARTIFACT_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(ARTIFACT_ROUTE), /export async function POST/);
  assert.match(source(OVERLAY_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(OVERLAY_ROUTE), /export async function POST/);
  const captureRoute = source(CAPTURE_ROUTE);
  assert.match(captureRoute, /export async function POST/);
  assert.doesNotMatch(captureRoute, /export async function GET/);
  assert.doesNotMatch(captureRoute, /export async function PATCH/);
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 7);
  const postFiles = apiFiles.filter((file) =>
    /export async function POST/.test(readFileSync(file, "utf8")),
  );
  assert.equal(postFiles.length, 1);
  assert.match(postFiles[0], /sessions\/\[sessionId\]\/cases\/route\.ts$/);
  const patchFiles = apiFiles.filter((file) =>
    /export async function PATCH/.test(readFileSync(file, "utf8")),
  );
  assert.equal(patchFiles.length, 1);
  assert.match(patchFiles[0], /review\/route\.ts$/);
});

test("tester submission still rejects admin_capture and uniqueness is unchanged", () => {
  assert.match(testerServer, /admin_capture_rejected/);
  assert.match(testerServer, /findTesterCase/);
  assert.doesNotMatch(server, /findTesterCase|unique_tester_conflict|409/);
});

test("capture panel is explicit submit only with taxonomy controls and single-flight", () => {
  assert.match(panel, /AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY\.title/);
  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /<textarea/);
  assert.match(panel, /AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY\.create/);
  assert.match(panel, /AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY\.cancel/);
  assert.match(panel, /aria-busy=\{submitting\}/);
  assert.match(panel, /inFlightRef/);
  assert.match(panel, /postAfcDiagnosticAdminCaptureCase/);
  assert.match(panel, /router\.push\(buildAfcDiagnosticAdminCaptureCasePageUrl/);
  assert.match(panel, /disabled=\{!createEnabled\}/);
  assert.doesNotMatch(panel, /setInterval|onChange=\{[^}]*postAfcDiagnosticAdminCaptureCase/);
  assert.match(client, /method:\s*["']POST["']/);
  assert.doesNotMatch(sessionInspector, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(sessionInspector, /AfcDiagnosticVisualEvidence|overlay/);
  assert.doesNotMatch(sessionInspector, /patchAfcDiagnosticAdminCaseReview|Save review/);
  assert.match(sessionInspector, /buildAfcDiagnosticInspectorSessionUrl/);
  assert.match(sessionInspector, /defaultAfcDiagnosticAdminCaptureAttemptOrdinal/);
  assert.match(sessionPage, /AfcDiagnosticSessionInspector/);
  assert.doesNotMatch(sessionPage, /["']use client["']/);
});

test("Case Inspector hosts capture beside unchanged review and visual evidence", () => {
  assert.match(inspector, /AfcDiagnosticAdminCapturePanel/);
  assert.match(inspector, /AfcDiagnosticAdminReviewPanel/);
  assert.match(inspector, /AfcDiagnosticVisualEvidence/);
  assert.match(reviewPanel, /Save review|AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY\.save/);
  const reported =
    inspector.split("Reported issue")[1]?.split("AfcDiagnosticAdminReviewPanel")[0] ??
    "";
  assert.doesNotMatch(reported, /<textarea|<input|<select/);
  assert.match(inspector, /afcDiagnosticInspectorNotesText\(caseDetail\.notes\)/);
  assert.doesNotMatch(visual, /postAfcDiagnosticAdminCaptureCase|Create Case/);
  assert.match(inspector, /AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY\.openSession/);
});

test("Inbox remains fetch-on-navigation with no capture mutation", () => {
  assert.doesNotMatch(inbox, /postAfcDiagnosticAdminCaptureCase|method:\s*["']POST["']/);
  assert.doesNotMatch(inbox, /setInterval/);
  assert.doesNotMatch(client, /BroadcastChannel|localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /AfcDiagnosticCaseInbox/);
});
