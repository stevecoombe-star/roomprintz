import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("QA browser state route authenticates then reads via the AFD-3B primitive", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/qa/state/route.ts"),
    "utf8",
  );
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(route, /handleAfcQaBrowserStateGet/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function PUT|export async function PATCH/);
  assert.doesNotMatch(route, /submit-tester-case|submitAfcDiagnosticTesterCase/);
  assert.doesNotMatch(route, /runProductionAfcAnalysis|production-adapter|production-persistence/);
  assert.doesNotMatch(route, /retry-episode-signal|getAfcDiagnosticRetryEpisodeSignal/);
  assert.doesNotMatch(route, /getRoom|createProductionAfcStoreFromEnv/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(route, /sessionId|attemptCount|latestAttempt|issueCodes/);
});
