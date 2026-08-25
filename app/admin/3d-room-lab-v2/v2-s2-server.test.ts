import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.join(process.cwd(), "app");

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("V2 analysis calls only the certified tiled product, never PATH A", () => {
  const analysis = source("admin/3d-room-lab-v2/afc-v2-analysis.server.ts");

  assert.match(analysis, /executeAfcSr1TiledLiveProductAttempt/);
  assert.match(analysis, /product\.geometry\.sourceNormalizedPolygon/);
  assert.doesNotMatch(analysis, /executeAfcSr1CompleteProductAttempt|PATH A/i);
  assert.match(analysis, /validateAfcSr1LiveResultAcceptance/);
  assert.match(analysis, /settleAfcFixedSeamCalibrationWithRatioExtension/);
  assert.match(analysis, /validatePendingAfcLabCameraApply/);
  assert.match(analysis, /freezeAppliedTiledAfcCamera/);
});

test("V2 API owns browser seams and keeps V1 endpoints out of the client", () => {
  const client = source("admin/3d-room-lab-v2/RoomLabV2.tsx");
  const analyzeRoute = source("api/admin/3d-room-lab-v2/analyze/route.ts");

  assert.match(client, /\/api\/admin\/3d-room-lab-v2\/prepare-original/);
  assert.match(client, /\/api\/admin\/3d-room-lab-v2\/analyze/);
  assert.doesNotMatch(client, /\/api\/admin\/3d-room-lab\/afc-sr1/);
  assert.match(analyzeRoute, /executeAfcV2Analysis/);
});

test("floor-only TILED remains an internal evidence artifact", () => {
  const representation = source("admin/3d-room-lab-v2/representation-state.ts");
  const client = source("admin/3d-room-lab-v2/RoomLabV2.tsx");

  assert.match(representation, /FULLY TILED is not implemented in V2-S2/);
  assert.match(representation, /Floor-only TILED is an internal calibration artifact/);
  assert.doesNotMatch(client, /FULLY_TILED.*tile_grid_scaffold/);
  assert.doesNotMatch(client, /tile_grid_scaffold/);
});
