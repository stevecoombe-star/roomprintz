import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const PAGE = "app/admin/afc-diagnostics/page.tsx";
const INBOX = "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx";
const DETAIL_PAGE = "app/admin/afc-diagnostics/cases/[caseId]/page.tsx";
const INSPECTOR =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const HELPER = "lib/afc-v2-diagnostics/admin-case-inspector.client.ts";
const COPY = "lib/afc-v2-diagnostics/admin-diagnostics-copy-button.tsx";
const INBOX_HELPER = "lib/afc-v2-diagnostics/admin-case-inbox.client.ts";
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

const page = source(DETAIL_PAGE);
const inspector = source(INSPECTOR);
const helper = source(HELPER);
const copy = source(COPY);
const inbox = source(INBOX);
const inboxPage = source(PAGE);
const inboxHelper = source(INBOX_HELPER);
const inspectorSources = [page, inspector, helper, copy].join("\n");
const helperWithoutTypeImport = helper.replace(
  /import type\s*\{[\s\S]*?\}\s*from\s*["']\.\/admin-read-model["'];?/,
  "",
);

test("detail route is a server shell that renders the client inspector", () => {
  assert.equal(existsSync(path.join(ROOT, DETAIL_PAGE)), true);
  assert.equal(existsSync(path.join(ROOT, INSPECTOR)), true);
  assert.doesNotMatch(page, /["']use client["']/);
  assert.match(page, /AfcDiagnosticCaseInspector/);
  assert.match(inspector, /["']use client["']/);
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /getServiceRoleSupabaseClient|cookies\(/);
  assert.doesNotMatch(page, /createClient|from\("vibode_afc_diagnostic/);
  assert.doesNotMatch(inspector, /Full case inspection is not in this view yet/);
  assert.doesNotMatch(page, /Full case inspection is not in this view yet/);
});

test("explicit AFC Diagnostics Link replaces router.back-only navigation", () => {
  assert.match(inspector, /AFC_DIAGNOSTIC_INSPECTOR_COPY\.inboxLink/);
  assert.match(inspector, /href=\{AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH\}/);
  assert.match(helper, /inboxLink: "AFC Diagnostics"/);
  assert.match(helper, /AFC_DIAGNOSTIC_INBOX_PAGE_PATH/);
  assert.doesNotMatch(inspector, /router\.back/);
  assert.doesNotMatch(page, /router\.back/);
  assert.doesNotMatch(inspector, /useRouter/);
  assert.doesNotMatch(inspector, /Back to AFC Diagnostics/);
});

test("inspector fetches Case then Session and never uses the list API", () => {
  assert.match(inspector, /buildAfcDiagnosticInspectorCaseUrl/);
  assert.match(inspector, /buildAfcDiagnosticInspectorSessionUrl/);
  assert.match(inspector, /credentials:\s*"same-origin"/);
  assert.match(inspector, /cache:\s*"no-store"/);
  assert.match(
    inspector,
    /loadSession\(started\.seq, parsed\.sessionId, "follow"\)/,
  );
  assert.match(helper, /\/api\/admin\/afc-diagnostics\/cases/);
  assert.match(helper, /\/api\/admin\/afc-diagnostics\/sessions/);
  assert.doesNotMatch(inspector, /buildAfcDiagnosticInboxListUrl/);
  assert.doesNotMatch(inspector, /parseAfcDiagnosticInboxListPayload/);
  assert.doesNotMatch(inspector, /nextCursor/);
  assert.doesNotMatch(helper, /searchParams\.get\("cursor"\)/);
  assert.match(inbox, /buildAfcDiagnosticInboxListUrl/);
  assert.doesNotMatch(inbox, /\/api\/admin\/afc-diagnostics\/cases\//);
  assert.doesNotMatch(inbox, /\/api\/admin\/afc-diagnostics\/sessions/);
});

test("inspector stays browser-safe and does not import server read primitives", () => {
  assert.doesNotMatch(inspectorSources, /admin-read-model\.server/);
  assert.doesNotMatch(helperWithoutTypeImport, /admin-read-model/);
  assert.doesNotMatch(inspector, /from ["']@\/lib\/afc-v2-diagnostics\/admin-read-model["']/);
  assert.doesNotMatch(helper, /\bBuffer\b/);
  assert.doesNotMatch(inspectorSources, /getServiceRoleSupabaseClient|createBrowserClient|getCookieSupabaseClient/);
  assert.doesNotMatch(inspectorSources, /createClient\(/);
});

test("inspector is GET-only and has no review, capture, or overlay controls", () => {
  assert.doesNotMatch(
    inspectorSources,
    /method:\s*["'](POST|PATCH|PUT|DELETE)["']/,
  );
  assert.doesNotMatch(
    inspectorSources,
    /export async function (POST|PATCH|PUT|DELETE)/,
  );
  assert.doesNotMatch(
    inspector,
    /Close case|Assign reviewer|Create Case|Delete case|Rerun room|Mark in review|Start review|Save review/i,
  );
  assert.doesNotMatch(inspector, /<textarea|<input/);
  assert.doesNotMatch(inspector, /admin capture|capture case/i);
  assert.doesNotMatch(
    inspectorSources,
    /next\/image|signedUrl|createSignedUrl|canvas|quad overlay|wall collision/i,
  );
  assert.doesNotMatch(inspectorSources, /production_authority|productionAuthority/);
  assert.doesNotMatch(inspectorSources, /frozenCamera|sourceNormalizedPolygon/);
  assert.doesNotMatch(inspectorSources, /reporterEmail|storage_path|storagePath|providerProvenance|diagnosticPayload/);
  assert.match(inspector, /AfcDiagnosticVisualEvidence/);
  assert.match(source(CASE_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(CASE_ROUTE), /export async function POST/);
  assert.match(source(SESSION_ROUTE), /export async function GET/);
  assert.doesNotMatch(source(LIST_ROUTE), /export async function POST/);
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 4);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?4c|case.?inspector/i.test(name)),
    false,
  );
});

test("native details, attempt buttons, reported marker, and lineage wording exist", () => {
  assert.match(inspector, /<details/);
  assert.match(inspector, /<summary[^>]*>\s*Technical details\s*<\/summary>/);
  assert.match(inspector, /<summary[^>]*>\s*Session technical details\s*<\/summary>/);
  assert.match(inspector, /<summary[^>]*>\s*Engine details\s*<\/summary>/);
  assert.match(inspector, /<ul/);
  assert.match(inspector, /<button/);
  assert.match(inspector, /aria-pressed=\{selected\}/);
  assert.match(inspector, /aria-current=\{selected \? "true" : undefined\}/);
  assert.match(inspector, /AFC_DIAGNOSTIC_INSPECTOR_COPY\.reported/);
  assert.match(inspector, /Attempt #\{/);
  assert.match(inspector, /AFC lineage \$\{/);
  assert.match(inspector, /Parent generation/);
  assert.match(inspector, /same as Attempt #\{parentMatch\}/);
  assert.match(helper, /Prior successful authority at creation time/);
  assert.match(inspector, /AFC_DIAGNOSTIC_INSPECTOR_COPY\.parentHelper/);
  assert.match(helper, /This is the attempt the tester reported/);
  assert.match(inspector, /AFC_DIAGNOSTIC_INSPECTOR_COPY\.reportedHelper/);
  assert.doesNotMatch(inspector, /Retry parent|Previous attempt|Parent attempt/);
  assert.doesNotMatch(inspector, /bad attempt|failed attempt|problematic attempt|wrong attempt/i);
  assert.doesNotMatch(inspector, /role=["']tablist["']/);
});

test("accessibility, copy, and read-only review/source copy are present", () => {
  assert.match(inspector, /<h1/);
  assert.match(helper, /title: AFC_DIAGNOSTIC_INBOX_COPY\.detailTitle/);
  assert.match(inspector, /<h2/);
  assert.match(inspector, /<dl/);
  assert.match(inspector, /role="alert"/);
  assert.match(inspector, /aria-busy=\{sessionBusy\}/);
  assert.match(inspector, /focus-visible:ring-2/);
  assert.match(inspector, /whitespace-pre-wrap/);
  assert.match(copy, /aria-label=\{ariaLabel\}/);
  assert.match(inspector, /ariaLabel="Copy Case ID"/);
  assert.match(inspector, /ariaLabel="Copy Session ID"/);
  assert.match(inspector, /ariaLabel="Copy Generation ID"/);
  assert.match(inspector, /ariaLabel="Copy SHA-256"/);
  assert.match(inspector, /ariaLabel="Copy Room ID"/);
  assert.match(inspector, /ariaLabel="Copy Reporter ID"/);
  assert.match(helper, /No notes provided/);
  assert.match(helper, /Not reviewed yet/);
  assert.match(helper, /No review notes/);
  assert.match(inspector, /Source photograph/);
  assert.match(inspector, /Admin review/);
  assert.match(inspector, /Reported issue/);
  assert.match(inspector, /Selected attempt/);
  assert.match(inspector, /Diagnostic session/);
  assert.match(inspector, /label="EMPTY"/);
  assert.match(inspector, /label="TILED"/);
  assert.match(helper, /Not present/);
  assert.doesNotMatch(inspector, /setInterval/);
  assert.doesNotMatch(inspector, /addEventListener\(\s*["']focus["']/);
  assert.match(inspector, /lg:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
});

test("queue filters and inbox behavior remain untouched", () => {
  assert.match(inboxPage, /AfcDiagnosticCaseInbox/);
  assert.match(inbox, /replaceSelect\("reviewStatus"/);
  assert.match(inbox, /runFetch\("page1"/);
  assert.match(inbox, /runFetch\("more"/);
  assert.match(inboxHelper, /overflowCount/);
  assert.match(inbox, /\+\{issues\.overflowCount\}/);
  assert.doesNotMatch(helper, /overflowCount/);
  assert.match(inbox, /href=\{`\/admin\/afc-diagnostics\/cases\/\$\{item\.caseId\}`\}/);
});
