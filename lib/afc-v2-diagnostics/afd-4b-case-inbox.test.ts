import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const PAGE = "app/admin/afc-diagnostics/page.tsx";
const INBOX = "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx";
const DETAIL = "app/admin/afc-diagnostics/cases/[caseId]/page.tsx";
const HELPER = "lib/afc-v2-diagnostics/admin-case-inbox.client.ts";
const ADMIN_HOME = "app/admin/AdminControls.tsx";
const LIST_ROUTE = "app/api/admin/afc-diagnostics/cases/route.ts";
const CASE_ROUTE = "app/api/admin/afc-diagnostics/cases/[caseId]/route.ts";
const SESSION_ROUTE = "app/api/admin/afc-diagnostics/sessions/[sessionId]/route.ts";

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

const page = source(PAGE);
const inbox = source(INBOX);
const detail = source(DETAIL);
const helper = source(HELPER);
const adminHome = source(ADMIN_HOME);
const queueSources = [page, inbox, detail, helper].join("\n");
const helperWithoutTypeImport = helper.replace(
  /import type\s*\{[\s\S]*?\}\s*from\s*["']\.\/admin-read-model["'];?/,
  "",
);

test("2-4) admin diagnostics page, home link, and case detail route exist", () => {
  assert.equal(existsSync(path.join(ROOT, PAGE)), true);
  assert.equal(existsSync(path.join(ROOT, INBOX)), true);
  assert.equal(existsSync(path.join(ROOT, DETAIL)), true);
  assert.match(page, /AfcDiagnosticCaseInbox/);
  assert.match(page, /Suspense/);
  assert.match(adminHome, /AFC Diagnostics/);
  assert.match(
    adminHome,
    /Review tester-reported room analysis issues and retry history/,
  );
  assert.match(adminHome, /Open AFC Diagnostics/);
  assert.match(adminHome, /href="\/admin\/afc-diagnostics"/);
  assert.match(helper, /detailTitle: "Case detail"/);
  assert.match(detail, /AfcDiagnosticCaseInspector/);
});

test("5-6) inbox consumes the list API only and does not import server read primitives", () => {
  assert.match(helper, /\/api\/admin\/afc-diagnostics\/cases/);
  assert.match(inbox, /buildAfcDiagnosticInboxListUrl/);
  assert.match(inbox, /credentials:\s*"same-origin"/);
  assert.match(inbox, /cache:\s*"no-store"/);
  assert.doesNotMatch(inbox, /\/api\/admin\/afc-diagnostics\/cases\//);
  assert.doesNotMatch(inbox, /\/api\/admin\/afc-diagnostics\/sessions/);
  assert.doesNotMatch(queueSources, /admin-read-model\.server/);
  assert.doesNotMatch(helperWithoutTypeImport, /admin-read-model/);
  assert.doesNotMatch(inbox, /from ["']@\/lib\/afc-v2-diagnostics\/admin-read-model["']/);
  assert.doesNotMatch(page, /getServiceRoleSupabaseClient|cookies\(/);
  assert.doesNotMatch(detail, /getServiceRoleSupabaseClient|cookies\(/);
  assert.doesNotMatch(helper, /\bBuffer\b/);
});

test("7-18) default list fetch, URL filters, drafts, validation, and clear", () => {
  assert.match(inbox, /runFetch\("page1"/);
  assert.match(helper, /reviewStatus/);
  assert.match(helper, /issueCode/);
  assert.match(helper, /machineStatusSnapshot/);
  assert.match(helper, /submittedFrom/);
  assert.match(helper, /submittedTo/);
  assert.match(helper, /buildAfcDiagnosticInboxPageHref/);
  assert.match(helper, /params\.set\("cursor"/);
  assert.doesNotMatch(
    helper.split("buildAfcDiagnosticInboxPageHref")[1]?.split("export function")[0] ?? "",
    /cursor|limit/,
  );
  assert.match(inbox, /replaceSelect\("reviewStatus"/);
  assert.match(inbox, /replaceSelect\("issueCode"/);
  assert.match(inbox, /replaceSelect\("trigger"/);
  assert.match(inbox, /replaceSelect\("machineStatusSnapshot"/);
  assert.match(inbox, /draftRoomId/);
  assert.match(inbox, /draftSubmittedFrom/);
  assert.match(inbox, /validateAfcDiagnosticInboxDraftFilters/);
  assert.match(inbox, /type="submit"/);
  assert.match(helper, /Enter a valid room ID/);
  assert.match(inbox, /validationMessage/);
  assert.match(helper, /Clear filters/);
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_COPY\.clearFilters/);
  assert.match(inbox, /emptyAfcDiagnosticInboxCommittedFilters/);
  assert.doesNotMatch(inbox, /origin filter|reporter filter|free-text|notes search/i);
  assert.doesNotMatch(helper, /searchParams\.get\("origin"\)/);
  assert.doesNotMatch(helper, /searchParams\.get\("cursor"\)/);
  assert.doesNotMatch(helper, /searchParams\.get\("limit"\)/);
});

test("19-24) refresh, loading, load-more, error, and retry copy", () => {
  assert.match(inbox, /runFetch\("refresh"/);
  assert.match(helper, /Refreshing\.\.\./);
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_COPY\.refreshing/);
  assert.match(helper, /Loading cases\.\.\./);
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_COPY\.loading/);
  assert.match(inbox, /aria-busy=\{busy\}/);
  assert.match(inbox, /runFetch\("more"/);
  assert.match(helper, /loadMoreLoading: "Loading\.\.\."/);
  assert.match(inbox, /role="alert"/);
  assert.match(helper, /Session expired\. Sign in again/);
  assert.match(helper, /Admin access required/);
  assert.match(helper, /Those filters aren’t valid/);
  assert.match(helper, /Couldn’t load diagnostic cases/);
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_COPY\.retry/);
  assert.match(inbox, /afcDiagnosticInboxLoadErrorMessage\(response\.status\)/);
  assert.doesNotMatch(inbox, /payload\.error|body\.error|await response\.text\(\)/);
});

test("25-38) empty copy, human labels, attempts, and notes presence only", () => {
  assert.match(helper, /No diagnostic cases yet/);
  assert.match(helper, /No cases match these filters/);
  assert.match(inbox, /emptyUnfiltered|emptyFiltered/);
  assert.match(helper, /AFC_QA_TESTER_ISSUE_OPTIONS/);
  assert.match(
    source("lib/afc-v2-diagnostics/tester-report.client.ts"),
    /Perspective looks wrong/,
  );
  assert.match(
    source("lib/afc-v2-diagnostics/tester-report.client.ts"),
    /Wall edges aren’t being recognized/,
  );
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_ISSUE_OPTIONS/);
  assert.match(helper, /Unknown issue/);
  assert.match(helper, /overflowCount/);
  assert.match(inbox, /\+\{issues\.overflowCount\}/);
  assert.match(helper, /In review/);
  assert.match(helper, /Manual report/);
  assert.match(helper, /Repeated unsuccessful/);
  assert.match(helper, /\$\{afcDiagnosticInboxOriginLabel\(origin\)\} · \$\{afcDiagnosticInboxTriggerLabel\(trigger\)\}/);
  assert.match(helper, /origin === "tester"\) return "Tester"/);
  assert.match(helper, /trigger === "admin_capture"\) return "Capture"/);
  assert.match(helper, /Running/);
  assert.match(helper, /Ready/);
  assert.match(helper, /Failed/);
  assert.match(helper, /1 attempt/);
  assert.match(helper, /\$\{count\} attempts/);
  assert.match(inbox, /hasNotes/);
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_COPY\.notes/);
  assert.doesNotMatch(inbox, /item\.notes|reviewNotes|notes body/i);
  assert.doesNotMatch(queueSources, /AFC_QA_ISSUE_CODE_LABELS/);
});

test("39-47) UUID shortening, copy, local time, semantic table, and explicit Open", () => {
  assert.match(helper, /id\.slice\(0, 8\)/);
  assert.match(inbox, /font-mono text-\[11px\]/);
  assert.match(inbox, /aria-label=\{ariaLabel\}/);
  assert.match(inbox, /ariaLabel="Copy Case ID"/);
  assert.match(inbox, /ariaLabel="Copy Room ID"/);
  assert.match(inbox, /ariaLabel="Copy Session ID"/);
  assert.match(inbox, /ariaLabel="Copy Generation ID"/);
  assert.match(inbox, /ariaLabel="Copy Reporter ID"/);
  assert.match(inbox, /clipboard\.writeText\(value\)/);
  assert.match(inbox, /"Copied"/);
  assert.match(inbox, /Submitted \(local\)/);
  assert.match(helper, /toLocaleString/);
  assert.match(inbox, /formatAfcDiagnosticInboxSubmittedAt/);
  assert.match(inbox, /<table/);
  assert.match(inbox, /<thead/);
  assert.match(inbox, /<th scope="col"/);
  assert.match(inbox, /<tbody/);
  assert.match(inbox, />\s*Open\s*</);
  assert.match(inbox, /href=\{`\/admin\/afc-diagnostics\/cases\/\$\{item\.caseId\}`\}/);
  assert.doesNotMatch(inbox, /<tr[^>]*onClick/);
  assert.doesNotMatch(inbox, /onClick=\{[^}]*router\.(push|replace)/);
  assert.match(inbox, /hidden[\s\S]*md:table-cell/);
  assert.doesNotMatch(inbox, /aria-sort|sortable/);
  assert.doesNotMatch(inbox, /totalCount|total cases/i);
});

test("48-57) load more, cursor API-only, append/dedupe, abort, and stale protection", () => {
  assert.doesNotMatch(inbox, /Page \{|pageNumbers|Previous|Next page/);
  assert.match(inbox, /nextCursor \?/);
  assert.match(helper, /loadMore: "Load more"/);
  assert.match(inbox, /AFC_DIAGNOSTIC_INBOX_COPY\.loadMore/);
  assert.match(inbox, /buildAfcDiagnosticInboxListUrl\(filters, cursor\)/);
  assert.match(helper, /mergeAfcDiagnosticInboxItems/);
  assert.match(inbox, /setNextCursor\(null\)/);
  assert.match(inbox, /createAfcDiagnosticInboxRequestCoordinator/);
  assert.match(inbox, /isCurrent\(started\.seq\)/);
  assert.match(inbox, /isAfcDiagnosticInboxAbortError/);
  assert.doesNotMatch(
    source("lib/afc-v2-diagnostics/admin-case-inbox.client.ts")
      .split("buildAfcDiagnosticInboxPageHref")[1]
      ?.split("export function")[0] ?? "cursor",
    /cursor/,
  );
});

test("58-62) mapped status copy and no raw API error printing", () => {
  assert.match(helper, /Session expired\. Sign in again/);
  assert.match(helper, /Admin access required/);
  assert.match(helper, /Those filters aren’t valid\. Clear filters and try again/);
  assert.match(helper, /Couldn’t load diagnostic cases\. Try again/);
  assert.doesNotMatch(inbox, /JSON\.stringify\(payload\)/);
  assert.doesNotMatch(detail, /error:\s*["']Server error/);
});

test("63-75) detail inspector is GET-only, inbox stays read-only, and scope stays UI-only", () => {
  assert.doesNotMatch(detail, /\bfetch\s*\(/);
  assert.doesNotMatch(detail, /\/api\/admin\/afc-diagnostics/);
  const inspector = source(
    "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx",
  );
  assert.match(inspector, /\bfetch\s*\(/);
  assert.match(inspector, /buildAfcDiagnosticInspectorCaseUrl/);
  assert.match(inspector, /buildAfcDiagnosticInspectorSessionUrl/);
  const detailSources = [detail, inspector].join("\n");
  assert.doesNotMatch(queueSources, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(queueSources, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.doesNotMatch(detailSources, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(inbox, /Close case|Assign reviewer|Create Case|Delete case|Rerun room/i);
  assert.doesNotMatch(inspector, /Close case|Assign reviewer|Create Case|Delete case|Rerun room/i);
  assert.doesNotMatch(inbox, /reviewStatus:\s*["']closed["']\s*,/);
  assert.doesNotMatch(queueSources, /<img|next\/image|signedUrl|createSignedUrl/);
  assert.doesNotMatch(detailSources, /<img|next\/image|signedUrl|createSignedUrl/);
  assert.doesNotMatch(queueSources, /createBrowserClient|getServiceRoleSupabaseClient|getCookieSupabaseClient/);
  assert.doesNotMatch(page, /admin layout|AdminSidebar|sidebar/i);
  assert.doesNotMatch(inbox, /setInterval/);
  assert.doesNotMatch(inbox, /addEventListener\(\s*["']focus["']/);
  assert.doesNotMatch(inbox, /reporterEmail|reviewNotes|engineFingerprint|storage_path|storagePath|providerProvenance|diagnosticPayload/);
  assert.doesNotMatch(detail, /reporterEmail|reviewNotes|engineFingerprint|notes body|diagnosticPayload/);
  assert.doesNotMatch(inspector, /reporterEmail|diagnosticPayload|storage_path|storagePath|providerProvenance/);
  assert.match(source(LIST_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(LIST_ROUTE), /export async function POST/);
  assert.match(source(CASE_ROUTE), /handleAfcDiagnosticsAdminCaseDetailGet/);
  assert.match(source(SESSION_ROUTE), /handleAfcDiagnosticsAdminSessionDetailGet/);
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 3);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?4b|case.?inbox/i.test(name)),
    false,
  );
});

test("accessibility and filter control labels are present", () => {
  assert.match(inbox, />Review</);
  assert.match(inbox, />Issue</);
  assert.match(inbox, />Trigger</);
  assert.match(inbox, />Machine</);
  assert.match(inbox, />Room ID</);
  assert.match(inbox, /Submitted from \(local\)/);
  assert.match(inbox, /Submitted to \(local\)/);
  assert.match(inbox, /type="button"/);
  assert.match(inbox, /focus-visible:ring-2/);
  assert.match(inbox, /overflow-x-auto/);
  assert.doesNotMatch(adminHome, /AdminSidebar|new design system/i);
});
