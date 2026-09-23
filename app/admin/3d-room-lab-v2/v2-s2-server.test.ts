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
  assert.doesNotMatch(analyzeRoute, /executeAfcV2S3Analysis|FULLY_TILED/);
});

test("live V2 restores the certified floor-only TILED representation", () => {
  const representation = source("admin/3d-room-lab-v2/representation-state.ts");
  const client = source("admin/3d-room-lab-v2/RoomLabV2.tsx");
  const floor = source("admin/3d-room-lab-v2/afc-v2-analysis.server.ts");

  assert.match(representation, /TILED has not been generated from this EMPTY/);
  assert.match(floor, /executeAfcSr1TiledLiveProductAttempt/);
  assert.match(floor, /AFC_SR1_TILE_GRID_SCAFFOLD_PRESET/);
  assert.match(floor, /input: "full_tiled_raster"/);
  assert.doesNotMatch(
    `${representation}\n${client}\n${floor}`,
    /generateFullyTiledFromOriginal|executeAfcV2FullyTiledFloorAnalysis/,
  );
});

test("Re-read Room Perspective is an explicit secondary Analyze intent", () => {
  const client = source("admin/3d-room-lab-v2/RoomLabV2.tsx");
  const analyzeRoute = source("api/admin/3d-room-lab-v2/analyze/route.ts");
  const analysis = source("admin/3d-room-lab-v2/afc-v2-analysis.server.ts");
  const analyzeBlock = client.slice(
    client.indexOf("async function analyzeAndApply"),
    client.indexOf("function downloadAnalysisEvidence"),
  );
  const primaryClick = client.slice(
    client.indexOf("Analyze &amp; Apply AFC") - 500,
    client.indexOf("Analyze &amp; Apply AFC"),
  );
  const rereadClick = client.slice(
    client.indexOf("Re-read Room Perspective") - 700,
    client.indexOf("Re-read Room Perspective"),
  );

  assert.match(client, /Re-read Room Perspective/);
  assert.match(
    client,
    /Re-read the room perspective if the 3D view doesn’t line up well with the photo\./,
  );
  assert.match(analyzeBlock, /forceTiledRegeneration: analysisIntent\.forceTiledRegeneration === true/);
  assert.match(primaryClick, /onClick=\{\(\) => void analyzeAndApply\(\)\}/);
  assert.match(
    rereadClick,
    /onClick=\{\(\) => void analyzeAndApply\(\{ forceTiledRegeneration: true \}\)\}/,
  );
  assert.doesNotMatch(
    rereadClick,
    /Regenerate Floor Evidence|Retry TILED|Refresh NBP|Re-run Reader|Camera Recalibration/,
  );
  assert.match(analyzeRoute, /forceTiledRegeneration: value\.forceTiledRegeneration === true/);
  assert.match(analysis, /forceTiledRegeneration: input\.forceTiledRegeneration === true/);
});
