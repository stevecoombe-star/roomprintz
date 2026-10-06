import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("QA perspective re-read route authenticates, then reuses production analyze", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/qa/reread-perspective/route.ts"),
    "utf8",
  );
  const rerun = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/qa/rerun/route.ts"),
    "utf8",
  );
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(route, /handleAfcQaPerspectiveRereadPost/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /runProductionAfcAnalysis/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(route, /intent: "reread_perspective"/);
  assert.match(route, /intent: input\.intent/);
  assert.match(route, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(route, /createGeneration\(/);
  assert.doesNotMatch(route, /sourceImageUrl:\s*record|body\.sourceImageUrl|record\.image/);
  assert.doesNotMatch(route, /\/api\/admin\/3d-room-lab/);
  assert.doesNotMatch(route, /handleAfcQaReadyRerunPost/);
  assert.doesNotMatch(route, /intent: "run_again"/);
  assert.match(rerun, /intent: "run_again"/);
  assert.doesNotMatch(rerun, /reread_perspective|reread-perspective/);
});
