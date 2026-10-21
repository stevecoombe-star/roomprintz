import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("REMOVE-1A route is an admin read of certified ORIGINAL and validated EMPTY", () => {
  const route = readFileSync(
    path.join(process.cwd(), "app/api/vibode/admin/remove-alignment/route.ts"),
    "utf8",
  );
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|export async function PUT|export async function PATCH|export async function DELETE/);
  assert.match(route, /readRemoveActor\(\)/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.match(route, /room\.userId !== admin\.id/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(route, /selectHarmonizeEmptyBytes/);
  assert.match(route, /assessRemoveAlignment/);
  assert.match(route, /assertProductionPayloadPrivacy/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /signOwnedOriginalDisplayUrl|emptyImageUrl|originalImageUrl|storagePath|storage_path/);
  assert.doesNotMatch(route, /updateGeneration|activateGeneration|publishDurable|enqueue|openai|gemini|fetch\(/i);
});
