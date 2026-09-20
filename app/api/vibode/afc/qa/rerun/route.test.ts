import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("QA READY rerun route authenticates, authorizes, then reuses production analyze", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/qa/rerun/route.ts"),
    "utf8",
  );
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(route, /handleAfcQaReadyRerunPost/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /runProductionAfcAnalysis/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(route, /intent: input\.intent/);
  assert.match(route, /intent: "run_again"/);
  assert.match(route, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(route, /createGeneration\(/);
  assert.doesNotMatch(route, /ensureAfcDiagnosticSessionMembership/);
  assert.doesNotMatch(route, /insertTesterCase|closeStaleOpenSessions/);
  assert.doesNotMatch(route, /ready_reread|qa_reread|reprocess|retry_ready/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(route, /sessionId|parent_generation_id|lineage_seq/);
});
