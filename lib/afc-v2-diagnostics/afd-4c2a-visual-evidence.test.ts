import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const VISUAL =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx";
const INSPECTOR =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const CLIENT = "lib/afc-v2-diagnostics/admin-visual-evidence.client.ts";
const SERVER = "lib/afc-v2-diagnostics/admin-visual-evidence.server.ts";
const ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/artifacts/[kind]/route.ts";

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

const visual = source(VISUAL);
const inspector = source(INSPECTOR);
const client = source(CLIENT);
const server = source(SERVER);
const route = source(ROUTE);
const uiSources = [visual, inspector, client].join("\n");
const newFiles = [visual, inspector, client, server, route].join("\n");

test("visual evidence section is wired into the selected attempt inspector", () => {
  assert.equal(existsSync(path.join(ROOT, VISUAL)), true);
  assert.match(inspector, /AfcDiagnosticVisualEvidence/);
  assert.match(inspector, /Selected attempt/);
  assert.match(uiSources, /Visual evidence/);
  assert.match(uiSources, /original: "Original"/);
  assert.match(uiSources, /empty: "Empty"/);
  assert.match(uiSources, /tiled: "Tiled"/);
  assert.match(visual, /aria-pressed=\{kind === candidate\}/);
  assert.match(visual, /<img/);
  assert.match(visual, /object-contain/);
  assert.match(visual, /credentials:\s*"same-origin"/);
  assert.match(visual, /cache:\s*"no-store"/);
  assert.match(visual, /response\.blob\(\)/);
  assert.match(visual, /URL\.createObjectURL\(blob\)/);
  assert.match(visual, /revokeAfcDiagnosticVisualObjectUrl/);
  assert.match(visual, /afcDiagnosticVisualEvidenceTupleKey/);
  assert.match(visual, /isCommitted && phase === "ready" && imageUrl/);
  assert.match(uiSources, /Retry visual evidence/);
  assert.match(visual, /role="alert"/);
  assert.match(visual, /aria-live="polite"/);
  assert.match(uiSources, /Loading visual evidence/);
  assert.match(visual, /focus-visible:ring-2/);
  assert.match(inspector, /label="EMPTY"/);
  assert.match(inspector, /label="TILED"/);
});

test("browser loading uses fetch blob object URLs rather than direct img src routes", () => {
  assert.match(visual, /buildAfcDiagnosticVisualArtifactUrl/);
  assert.match(visual, /createAfcDiagnosticVisualEvidenceCoordinator/);
  assert.doesNotMatch(
    visual,
    /<img[^>]+src=\{buildAfcDiagnosticVisualArtifactUrl/,
  );
  assert.doesNotMatch(visual, /next\/image/);
  assert.match(visual, /credentials:\s*"same-origin"/);
  assert.match(client, /AbortController/);
});

test("AFD-4C2A stays GET-only and does not add mutations or signed URLs", () => {
  assert.doesNotMatch(
    newFiles,
    /method:\s*["'](POST|PATCH|PUT|DELETE)["']/,
  );
  assert.doesNotMatch(
    newFiles,
    /export async function (POST|PATCH|PUT|DELETE)/,
  );
  assert.doesNotMatch(uiSources, /createSignedUrl|signedUrl|signed_url/);
  assert.doesNotMatch(route, /createSignedUrl|signedUrl/);
  assert.doesNotMatch(server, /createSignedUrl|signedUrl/);
  assert.doesNotMatch(uiSources, /production_authority|productionAuthority/);
  assert.doesNotMatch(uiSources, /frozenCamera|sourceNormalizedPolygon/);
  assert.doesNotMatch(visual, /<canvas|from ["']three["']|WebGL/);
  assert.doesNotMatch(client, /<canvas|floor polygon/);
  assert.doesNotMatch(inspector, /<canvas/);
  assert.doesNotMatch(
    newFiles,
    /Close case|Assign reviewer|Save review|admin capture|Rerun room/i,
  );
  assert.match(route, /export async function GET/);
  assert.match(server, /authorizeAfcDiagnosticsAdmin/);
  assert.doesNotMatch(server, /authorizeProductionAfcUser|VIBODE_AFC_QA_/);
});

test("artifact route never returns storage identity in JSON contracts", () => {
  assert.match(
    server,
    /Cache-Control", "private, no-store"/,
  );
  assert.match(server, /X-Content-Type-Options", "nosniff"/);
  assert.doesNotMatch(
    server,
    /NextResponse\.json\([^\)]*storage_path/,
  );
  assert.doesNotMatch(
    server,
    /NextResponse\.json\([^\)]*storage_bucket/,
  );
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 5);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?4c2a|visual.?evidence/i.test(name)),
    false,
  );
});
