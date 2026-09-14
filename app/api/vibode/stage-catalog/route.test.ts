import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("STAGE catalog route is a read-only production catalog loader", () => {
  const route = source("app/api/vibode/stage-catalog/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /loadStageCatalogFromEnv/);
  assert.match(route, /serializeStageCatalogPayload/);
  assert.doesNotMatch(route, /export async function POST|export async function PUT/);
  assert.doesNotMatch(route, /vibode_user_furniture|vibode_furniture_collection_items/);
  assert.doesNotMatch(route, /executeAfcV2Analysis|runProductionAfcAnalysis/);
});

test("STAGE catalog server store reads vibode_stage_* through the service role", () => {
  const store = source("lib/vibode-stage/catalog-persistence.server.ts");
  assert.match(store, /getServiceRoleSupabaseClient/);
  assert.match(store, /assembleStageCatalogFromRows/);
  assert.match(store, /resolveLoadedStageCatalog/);
  assert.match(store, /missing_service_role/);
  assert.match(store, /durable_load_failed/);
  assert.doesNotMatch(store, /from\("vibode_user_furniture"\)/);
  assert.doesNotMatch(store, /from\("vibode_furniture_collection_items"\)/);
  assert.doesNotMatch(store, /from\("vibode_3d_scenes"\)/);
});
