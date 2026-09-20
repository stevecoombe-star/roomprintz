import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const VISUAL =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx";
const INSPECTOR =
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx";
const CLIENT = "lib/afc-v2-diagnostics/admin-visual-overlay.client.ts";
const SERVER = "lib/afc-v2-diagnostics/admin-visual-overlay.server.ts";
const PROJECTION = "lib/afc-v2-runtime/world-to-image-projection.ts";
const ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/overlay/route.ts";
const ARTIFACT_ROUTE =
  "app/api/admin/afc-diagnostics/cases/[caseId]/generations/[generationId]/artifacts/[kind]/route.ts";
const ARTIFACT_SERVER = "lib/afc-v2-diagnostics/admin-visual-evidence.server.ts";

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
const projection = source(PROJECTION);
const route = source(ROUTE);
const artifactRoute = source(ARTIFACT_ROUTE);
const uiSources = [visual, client].join("\n");

test("overlay controls, SVG, and copy are wired into visual evidence", () => {
  assert.equal(existsSync(path.join(ROOT, VISUAL)), true);
  assert.equal(existsSync(path.join(ROOT, CLIENT)), true);
  assert.equal(existsSync(path.join(ROOT, SERVER)), true);
  assert.equal(existsSync(path.join(ROOT, PROJECTION)), true);
  assert.equal(existsSync(path.join(ROOT, ROUTE)), true);
  assert.match(visual, /AfcDiagnosticVisualEvidence/);
  assert.match(inspector, /AfcDiagnosticVisualEvidence/);
  assert.match(uiSources, /Floor quad/);
  assert.match(uiSources, /Collision wall edges/);
  assert.match(uiSources, /Certified perspective floor boundary/);
  assert.match(
    uiSources,
    /Runtime collision segments projected onto this image\. Not raw wall detection/,
  );
  assert.match(visual, /type="checkbox"/);
  assert.match(visual, /useState\(true\)/);
  assert.match(visual, /<svg/);
  assert.match(visual, /<polygon/);
  assert.match(visual, /<polyline/);
  assert.match(visual, /viewBox="0 0 1 1"/);
  assert.match(visual, /preserveAspectRatio="none"/);
  assert.match(visual, /object-contain/);
  assert.match(visual, /aspectRatio/);
  assert.match(uiSources, /Overlay basis: ORIGINAL frame/);
  assert.match(uiSources, /identity UV from ORIGINAL/);
  assert.match(uiSources, /Overlays unavailable for this artifact basis/);
  assert.match(uiSources, /Couldn't load overlays/);
  assert.match(uiSources, /Retry overlays/);
  assert.match(uiSources, /Loading overlays/);
  assert.match(visual, /afcDiagnosticVisualOverlayBasisLabel/);
  assert.match(visual, /disabled=\{!floorAvailable\}/);
  assert.match(visual, /disabled=\{!collisionAvailable\}/);
  assert.match(visual, /aria-hidden="true"/);
  assert.match(visual, /aria-describedby="afc-overlay-floor-help"/);
  assert.match(visual, /aria-live="polite"/);
  assert.match(visual, /overlayRetryNonce/);
});

test("image fetch and overlay fetch stay independent and tuple-scoped", () => {
  assert.match(visual, /buildAfcDiagnosticVisualArtifactUrl/);
  assert.match(visual, /buildAfcDiagnosticVisualOverlayUrl/);
  assert.match(visual, /createAfcDiagnosticVisualEvidenceCoordinator/);
  assert.match(visual, /createAfcDiagnosticVisualOverlayCoordinator/);
  assert.match(visual, /parseAfcAdminVisualOverlayV1/);
  assert.match(visual, /overlayCoordinatorRef\.current\.isCurrent/);
  assert.match(visual, /afcDiagnosticVisualEvidenceTupleKey/);
  assert.match(visual, /overlayCommittedKey === identityKey/);
  assert.match(
    visual,
    /\[caseId, generationId, kind, retryNonce\]/,
  );
  assert.match(
    visual,
    /\[caseId, generationId, kind, overlayRetryNonce\]/,
  );
  assert.doesNotMatch(
    visual,
    /\[caseId, generationId, kind, retryNonce, overlayRetryNonce, showFloor/,
  );
  assert.match(client, /createAfcDiagnosticVisualEvidenceCoordinator/);
});

test("AFD-4C2B stays GET-only SVG overlay and does not leak authority", () => {
  assert.doesNotMatch(uiSources, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.doesNotMatch(visual, /<canvas|WebGL|THREE\.|from ["']three["']/);
  assert.doesNotMatch(client, /<canvas|WebGL|from ["']three["']/);
  assert.doesNotMatch(visual, /production_authority|productionAuthority|frozenCamera/);
  assert.doesNotMatch(client, /production_authority|productionAuthority|frozenCamera/);
  assert.doesNotMatch(uiSources, /sourceNormalizedPolygon/);
  assert.doesNotMatch(client, /worldXz|signedUrl|storage_path/);
  assert.doesNotMatch(
    uiSources,
    /Detected walls|Gemini walls|Wall recognition result/,
  );
  assert.doesNotMatch(
    uiSources,
    /Close case|Assign reviewer|Save review|admin capture|Rerun room/i,
  );
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function PATCH/);
  assert.match(server, /authorizeAfcDiagnosticsAdmin/);
  assert.doesNotMatch(server, /authorizeProductionAfcUser|VIBODE_AFC_QA_/);
  assert.doesNotMatch(server, /createSignedUrl/);
  assert.match(server, /OVERLAY_FORBIDDEN_KEYS/);
  assert.match(server, /Cache-Control", "private, no-store"/);
  assert.match(server, /X-Content-Type-Options", "nosniff"/);
  assert.match(server, /classifyAfcR3cImagePairCompatibility/);
  assert.match(server, /realizeProductionWorld/);
  assert.match(server, /buildProductionPerspectiveCamera/);
  assert.match(projection, /clipCameraSegmentToNearPlane/);
  assert.match(projection, /AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN = -0.05/);
  assert.doesNotMatch(projection, /from ["']@\/app\/admin\/3d-room-lab\/ThreeRoomLab/);
});

test("4C2A artifact byte route remains unchanged and overlay is a separate JSON route", () => {
  assert.match(artifactRoute, /handleAfcDiagnosticsAdminVisualArtifactGet/);
  assert.doesNotMatch(artifactRoute, /overlay/);
  assert.doesNotMatch(source(ARTIFACT_SERVER), /AFC_ADMIN_VISUAL_OVERLAY_VERSION/);
  assert.match(server, /searchParams.get\("artifact"\)/);
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 6);
  assert.doesNotMatch(artifactRoute, /export async function PATCH/);
  assert.doesNotMatch(route, /export async function PATCH/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?4c2b|visual.?overlay/i.test(name)),
    false,
  );
});
