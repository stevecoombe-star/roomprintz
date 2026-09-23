import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("QA tester Case route authenticates then submits via the AFD-3A primitive", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/qa/cases/route.ts"),
    "utf8",
  );
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(route, /handleAfcQaTesterCasePost/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.doesNotMatch(route, /getRoom|createProductionAfcStoreFromEnv/);
  assert.doesNotMatch(route, /production-adapter|production-persistence/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(route, /sessionId|reporterUserId|taxonomyVersion/);
});
