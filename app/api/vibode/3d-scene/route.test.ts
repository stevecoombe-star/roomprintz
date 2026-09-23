import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("3D scene route is authenticated owner persistence and cannot analyze", () => {
  const route = source("app/api/vibode/3d-scene/route.ts");
  assert.match(route, /authorizeProductionAfcUser/);
  assert.match(route, /parseRoomId/);
  assert.match(route, /parseVersionId/);
  assert.match(route, /parseAfcGenerationId/);
  assert.match(route, /resolveOwnedVersionScene/);
  assert.match(route, /saveOwnedVersionScene/);
  assert.match(route, /validatePersistedSceneObjects/);
  assert.doesNotMatch(route, /executeAfcV2Analysis/);
  assert.doesNotMatch(route, /runProductionAfcAnalysis/);
  assert.doesNotMatch(route, /observeRoom|generateTiled|readTiledPerspective/);
  assert.doesNotMatch(route, /inheritFromVersionId|parentScene/);
});

test("3D scene server store uses service-role after owner authorization", () => {
  const store = source("lib/afc-v2-runtime/scene-persistence.server.ts");
  assert.match(store, /authorizeOwned3dSceneContext/);
  assert.match(store, /createProductionAfcStoreFromEnv/);
  assert.match(store, /getServiceRoleSupabaseClient/);
  assert.match(store, /vibode_room_assets/);
  assert.match(store, /onConflict: "room_id,version_id"/);
  assert.doesNotMatch(store, /executeAfcV2Analysis/);
  assert.doesNotMatch(store, /from\("vibode_afc_generations"\)\.update/);
});
