import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const ROOT = process.cwd();
const ROUTE =
  "app/api/admin/afc-diagnostics/sessions/[sessionId]/cases/route.ts";

test("admin diagnostics session case capture route is POST-only Node runtime", () => {
  const route = readFileSync(path.join(ROOT, ROUTE), "utf8");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /handleAfcDiagnosticsAdminCapturePost/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function PATCH/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.doesNotMatch(route, /export async function PUT/);
  assert.doesNotMatch(route, /authorizeProductionAfcUser|VIBODE_AFC_QA_/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser/);
  assert.doesNotMatch(route, /resolveAfcQaCapability|submitAfcDiagnosticTesterCase/);
});
