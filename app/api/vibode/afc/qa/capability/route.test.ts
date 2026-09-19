import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("QA capability route authenticates then resolves eligibility", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/qa/capability/route.ts"),
    "utf8",
  );
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(route, /handleAfcQaCapabilityGet/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /getRoom|createProductionAfcStoreFromEnv/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.doesNotMatch(route, /searchParams|parseRoomId/);
});
