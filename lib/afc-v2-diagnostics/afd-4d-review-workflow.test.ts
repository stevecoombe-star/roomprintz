import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const REVIEW_LOGIC = "lib/afc-v2-diagnostics/admin-review.ts";
const REVIEW_SERVER = "lib/afc-v2-diagnostics/admin-review.server.ts";
const REVIEW_CLIENT = "lib/afc-v2-diagnostics/admin-case-review.client.ts";
const REVIEW_PANEL =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticAdminReviewPanel.tsx";
const INSPECTOR =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const INBOX = "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx";
const READ_MODEL_SERVER = "lib/afc-v2-diagnostics/admin-read-model.server.ts";
const LIST_ROUTE = "app/api/admin/afc-diagnostics/cases/route.ts";
const CASE_ROUTE = "app/api/admin/afc-diagnostics/cases/[caseId]/route.ts";
const REVIEW_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/review/route.ts";
const SESSION_ROUTE =
  "app/api/admin/afc-diagnostics/sessions/[sessionId]/route.ts";
const ARTIFACT_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/artifacts/[kind]/route.ts";
const OVERLAY_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/overlay/route.ts";
const TESTER_CLIENT = "lib/afc-v2-diagnostics/tester-report.client.ts";
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

const logic = source(REVIEW_LOGIC);
const server = source(REVIEW_SERVER);
const client = source(REVIEW_CLIENT);
const panel = source(REVIEW_PANEL);
const inspector = source(INSPECTOR);
const inbox = source(INBOX);
const readModelServer = source(READ_MODEL_SERVER);
const visual = source(VISUAL);

test("AFD-4D files exist and the inspector hosts one dedicated review panel", () => {
  for (const relative of [
    REVIEW_LOGIC,
    REVIEW_SERVER,
    REVIEW_CLIENT,
    REVIEW_PANEL,
    REVIEW_ROUTE,
  ]) {
    assert.equal(existsSync(path.join(ROOT, relative)), true, relative);
  }
  assert.match(inspector, /import AfcDiagnosticAdminReviewPanel from "\.\/AfcDiagnosticAdminReviewPanel"/);
  assert.equal((inspector.match(/<AfcDiagnosticAdminReviewPanel/g) ?? []).length, 1);
  assert.doesNotMatch(inbox, /AfcDiagnosticAdminReviewPanel|Save review/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(migrations.some((name) => /afd.?4d|review.?workflow/i.test(name)), false);
});

test("browser surfaces never construct service-role clients or mutate diagnostics directly", () => {
  const browser = [client, panel, inspector, inbox].join("\n");
  assert.doesNotMatch(browser, /getServiceRoleSupabaseClient|createBrowserClient|getCookieSupabaseClient/);
  assert.doesNotMatch(browser, /\.from\(\s*["']vibode_afc_diagnostic/);
  assert.doesNotMatch(logic, /getServiceRoleSupabaseClient|from\("vibode_afc_diagnostic/);
  assert.doesNotMatch(client, /admin-review\.server/);
  assert.doesNotMatch(panel, /admin-review\.server|admin-read-model\.server/);
});

test("review mutation is a four-column whitelist and never spreads req.body", () => {
  assert.doesNotMatch(server, /update\(\s*req\.body|update\(\s*body|update\(\s*parsed/);
  assert.match(
    server,
    /const payload = \{\s*review_status: update\.review_status,\s*reviewer_user_id: update\.reviewer_user_id,\s*review_notes: update\.review_notes,\s*reviewed_at: update\.reviewed_at,\s*\}/,
  );
  assert.match(server, /authorizeAfcDiagnosticsAdmin/);
  assert.match(server, /getServiceRoleSupabaseClient/);
  assert.match(
    server,
    /const auth = await authorizeOrReject\(args\);[\s\S]*const stores = resolveStores\(args\);/,
  );
  assert.doesNotMatch(readModelServer, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("PATCH exists only on the nested review route", () => {
  for (const relative of [
    LIST_ROUTE,
    CASE_ROUTE,
    SESSION_ROUTE,
    ARTIFACT_ROUTE,
    OVERLAY_ROUTE,
  ]) {
    const route = source(relative);
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function PATCH/);
  }
  const reviewRoute = source(REVIEW_ROUTE);
  assert.match(reviewRoute, /export async function PATCH/);
  assert.doesNotMatch(reviewRoute, /export async function GET/);
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 6);
  const patchFiles = apiFiles.filter((file) =>
    /export async function PATCH/.test(readFileSync(file, "utf8")),
  );
  assert.equal(patchFiles.length, 1);
  assert.match(patchFiles[0], /review\/route\.ts$/);
});

test("tester submission still cannot send review fields", () => {
  const testerClient = source(TESTER_CLIENT);
  const testerServer = source(TESTER_SERVER);
  for (const key of [
    "reviewStatus",
    "review_status",
    "reviewerUserId",
    "reviewer_user_id",
    "reviewNotes",
    "review_notes",
    "reviewedAt",
    "reviewed_at",
  ]) {
    assert.match(testerClient, new RegExp(`"${key}"`));
  }
  assert.doesNotMatch(
    testerServer,
    /review_status:|reviewer_user_id:|review_notes:|reviewed_at:/,
  );
});

test("review panel is explicit-save only and keeps Reported issue read-only", () => {
  assert.match(panel, /AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY\.title/);
  assert.match(panel, /<select/);
  assert.match(panel, /<textarea/);
  assert.match(panel, /Save review|AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY\.save/);
  assert.match(panel, /AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY\.reset/);
  assert.match(panel, /AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY\.unsaved/);
  assert.match(panel, /aria-busy=\{saving\}/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /onSaved\(result\.detail\)/);
  assert.match(panel, /disabled=\{saveDisabled\}/);
  assert.match(panel, /disabled=\{resetDisabled\}/);
  assert.match(panel, /isAfcDiagnosticAdminReviewTargetDisabled/);
  assert.doesNotMatch(panel, /setInterval|onChange=\{[^}]*patchAfcDiagnosticAdminCaseReview/);
  assert.doesNotMatch(panel, /window\.confirm|confirm\(/);
  assert.doesNotMatch(panel, /Resolved|Fixed|\bDone\b/);
  assert.match(client, /method:\s*["']PATCH["']/);
  assert.doesNotMatch(inspector, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(inspector, /<textarea|<input/);

  const reported = inspector.split("Reported issue")[1]?.split("Admin review")[0]
    ?? inspector.split("Reported issue")[1]?.split("AfcDiagnosticAdminReviewPanel")[0]
    ?? "";
  assert.match(inspector, /Reported issue/);
  assert.match(inspector, /Tester notes/);
  assert.doesNotMatch(reported, /<textarea|<input|<select/);
  assert.match(inspector, /afcDiagnosticInspectorNotesText\(caseDetail\.notes\)/);
  assert.doesNotMatch(visual, /patchAfcDiagnosticAdminCaseReview|Save review/);
});

test("inbox remains fetch-on-navigation and has no live review sync", () => {
  assert.doesNotMatch(inbox, /patchAfcDiagnosticAdminCaseReview|method:\s*["']PATCH["']/);
  assert.doesNotMatch(inbox, /setInterval/);
  assert.doesNotMatch(client, /BroadcastChannel|localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /AfcDiagnosticCaseInbox/);
});
