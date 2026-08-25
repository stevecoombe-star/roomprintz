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
  assert.match(analyzeRoute, /executeAfcV2S3Analysis/);
  const s3 = source("admin/3d-room-lab-v2/afc-v2-s3-analysis.server.ts");
  assert.match(s3, /executeAfcV2FullyTiledFloorAnalysis/);
  assert.doesNotMatch(s3, /executeAfcV2Analysis|generateTiled/);
});

test("live V2 exposes no floor-only TILED representation or dependency", () => {
  const representation = source("admin/3d-room-lab-v2/representation-state.ts");
  const client = source("admin/3d-room-lab-v2/RoomLabV2.tsx");
  const s3 = source("admin/3d-room-lab-v2/afc-v2-s3-analysis.server.ts");
  const floor = source(
    "admin/3d-room-lab-v2/fully-tiled-floor-authority.server.ts",
  );

  assert.match(representation, /FULLY TILED has not been generated/);
  assert.doesNotMatch(
    `${representation}\n${client}\n${s3}\n${floor}`,
    /tile_grid_scaffold|vibodeTileGridScaffoldAssist/,
  );
});
