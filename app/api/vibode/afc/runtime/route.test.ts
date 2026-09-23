import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("runtime restore route uses PI-2 restore and does not analyze", () => {
  const route = readFileSync(
    path.join(ROOT, "app/api/vibode/afc/runtime/route.ts"),
    "utf8",
  );
  assert.match(route, /restoreProductionAfcRoom/);
  assert.match(route, /validateProductionRuntimeAuthority/);
  assert.match(route, /signOwnedOriginalDisplayUrl/);
  assert.doesNotMatch(route, /executeAfcV2Analysis/);
  assert.doesNotMatch(route, /runProductionAfcAnalysis/);
  assert.doesNotMatch(route, /observeRoom|generateTiled|readTiledPerspective/);
  assert.doesNotMatch(route, /loadOwnedOriginalForProductionAnalysis/);
});
