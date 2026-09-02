import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RoomLabV2, { containedDisplayFrame } from "./RoomLabV2";
import {
  INITIAL_AFC_ORCHESTRATION_STATE,
  reduceAfcOrchestrationState,
} from "./orchestration-state";
import AdminAfcV2Page from "./page";
import {
  REPRESENTATION_KINDS,
  createInitialRepresentationState,
  setEmptyRepresentation,
  setOriginalRepresentation,
  setTiledRepresentation,
} from "./representation-state";

const V2_DIRECTORY = path.join(
  process.cwd(),
  "app/admin/3d-room-lab-v2",
);

function readRuntimeSources() {
  return readdirSync(V2_DIRECTORY)
    .filter(
      (fileName) =>
        /\.(?:ts|tsx)$/.test(fileName) &&
        !fileName.endsWith(".test.ts") &&
        !fileName.endsWith(".server.ts"),
    )
    .map((fileName) => ({
      fileName,
      source: readFileSync(path.join(V2_DIRECTORY, fileName), "utf8"),
    }));
}

function importSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g),
    (match) => match[1],
  );
}

test("V2-S3D route renders separated EMPTY observation and TILED authority", () => {
  const routeMarkup = renderToStaticMarkup(
    createElement(AdminAfcV2Page),
  );
  const shellMarkup = renderToStaticMarkup(createElement(RoomLabV2));

  assert.match(routeMarkup, /3D Room Lab v2/);
  assert.match(shellMarkup, /Analyze &amp; Apply AFC/);
  assert.match(shellMarkup, /Prepare Original/);
  assert.match(shellMarkup, /Original/);
  assert.match(shellMarkup, /EMPTY/);
  assert.match(shellMarkup, /TILED/);
  assert.match(shellMarkup, /AFC Status/);
  assert.match(shellMarkup, /Floor/);
  assert.match(shellMarkup, /Camera/);
  assert.match(shellMarkup, /Room Observations/);
  assert.match(shellMarkup, /Room Boundaries/);
  assert.match(shellMarkup, /Scene \/ Models/);
  assert.match(shellMarkup, /Selected Model/);
  assert.match(shellMarkup, /Show Floor Quad/);
  assert.match(shellMarkup, /Show Wall Boundary/);
  assert.match(shellMarkup, /Show Collision Boundary/);
  assert.match(shellMarkup, /Add Test Cube/);
  assert.match(shellMarkup, /Load Model \/ GLB/);
  assert.match(shellMarkup, />Move</);
  assert.match(shellMarkup, />Rotate</);
  assert.match(shellMarkup, />Scale</);
  assert.match(shellMarkup, /Supports/);
  assert.match(shellMarkup, /EMPTY now supplies conservative visible-room/i);
  assert.match(shellMarkup, /sole Floor and Camera authority path/i);
  assert.match(shellMarkup, /No retained EMPTY observation basis was available/i);
  assert.doesNotMatch(shellMarkup, /FULLY TILED/i);
});

test("representation contract keeps Original, EMPTY, and TILED distinct", () => {
  assert.deepEqual(REPRESENTATION_KINDS, [
    "ORIGINAL",
    "EMPTY",
    "TILED",
  ]);

  const initial = createInitialRepresentationState();
  assert.equal(initial.ORIGINAL.kind, "ORIGINAL");
  assert.equal(initial.EMPTY.kind, "EMPTY");
  assert.equal(initial.TILED.kind, "TILED");
  assert.equal(initial.EMPTY.availability, "unavailable");
  assert.equal(initial.TILED.availability, "unavailable");
  assert.equal("imageUrl" in initial.EMPTY, false);
  assert.equal("imageUrl" in initial.TILED, false);

  const loaded = setOriginalRepresentation(initial, {
    imageUrl: "blob:original-room",
    source: {
      type: "hosted-url",
      imageUrl: "https://example.test/room.jpg",
    },
  });
  assert.equal(loaded.ORIGINAL.availability, "available");
  assert.equal(loaded.EMPTY.availability, "unavailable");
  assert.equal(loaded.TILED.availability, "unavailable");
  assert.notEqual(loaded.ORIGINAL, loaded.EMPTY);
  assert.notEqual(loaded.ORIGINAL, loaded.TILED);
});

test("diagnostic image frame preserves each representation aspect ratio", () => {
  assert.deepEqual(
    containedDisplayFrame(
      { width: 1000, height: 600 },
      { width: 1200, height: 800 },
    ),
    { width: 900, height: 600 },
  );
  assert.deepEqual(
    containedDisplayFrame(
      { width: 600, height: 1000 },
      { width: 1200, height: 800 },
    ),
    { width: 600, height: 400 },
  );
  assert.deepEqual(
    containedDisplayFrame(
      { width: 0, height: 0 },
      { width: 1200, height: 800 },
    ),
    { width: 0, height: 0 },
  );
});

test("orchestration tracks the V2-S2 certified floor lifecycle", () => {
  const loaded = reduceAfcOrchestrationState(
    INITIAL_AFC_ORCHESTRATION_STATE,
    { type: "original_preparation_started" },
  );
  assert.deepEqual(loaded, {
    selectedRepresentation: "ORIGINAL",
    status: "preparing_original",
  });

  const requested = reduceAfcOrchestrationState(loaded, {
    type: "original_ready",
  });
  assert.deepEqual(requested, {
    selectedRepresentation: "ORIGINAL",
    status: "original_ready",
  });
  const applying = reduceAfcOrchestrationState(requested, {
    type: "analysis_stage",
    status: "generating_empty",
  });
  assert.equal(applying.status, "generating_empty");
  assert.equal(
    reduceAfcOrchestrationState(applying, { type: "analysis_applied" }).status,
    "applied",
  );
});

test("v2 browser runtime remains isolated from v1 UI and research", () => {
  const runtimeSources = readRuntimeSources();
  const imports = runtimeSources.flatMap(({ source }) =>
    importSpecifiers(source),
  );
  const allowedImports = new Set([
    "next",
    "next/image",
    "react",
    "three",
    "./RoomLabV2",
    "./CalibratedRoomViewer",
    "./RoomEvidenceOverlay",
    "./empty-room-observation-contract",
    "./empty-room-observation-normalization",
    "./room-boundary-authority-contract",
    "./room-collision-authority-contract",
    "./empty-original-registration-authority-contract",
    "./empty-original-registration-geometry",
    "./empty-original-registration-priors",
    "./room-envelope-authority-contract",
    "./room-envelope-collision-authority-contract",
    "./original-structural-localization-authority-contract",
    "./original-localized-boundary-authority-contract",
    "./original-localized-collision-authority-contract",
    "./empty-authoritative-collision-authority-contract",
    "./room-envelope-opening-qualification",
    "./room-envelope-span-subtraction",
    "./room-opening-intersection-geometry",
    "./room-collision-footprint",
    "./room-collision-geometry",
    "./scene-collision-resolver",
    "./orchestration-state",
    "./representation-state",
    "./room-observation-contract",
    "./room-observation-normalization",
    "@/app/admin/3d-room-lab/calibrated-camera-readonly-projection",
    "./scene-object-import-bounds",
    "./scene-layer-state",
    "./scene-movement-control-range",
    "./scene-object-runtime",
    "./scene-viewport-interaction",
    "three/examples/jsm/loaders/GLTFLoader.js",
    "three/examples/jsm/controls/TransformControls.js",
  ]);

  for (const imported of imports) {
    assert.ok(
      allowedImports.has(imported),
      `unexpected v2 runtime import: ${imported}`,
    );
    assert.doesNotMatch(imported, /ThreeRoomLab|research/);
  }

  const combinedSource = runtimeSources
    .map(({ fileName, source }) => `// ${fileName}\n${source}`)
    .join("\n");

  assert.doesNotMatch(combinedSource, /(?:^|[/"])research(?:[/"]|$)/m);
  assert.doesNotMatch(combinedSource, /ThreeRoomLab/);
  assert.doesNotMatch(combinedSource, /\/api\/admin\/3d-room-lab\/afc-sr1/);
  assert.doesNotMatch(combinedSource, /tile_grid_scaffold/i);
  assert.doesNotMatch(combinedSource, /localStorage|scene-state:v0/);
  assert.doesNotMatch(
    combinedSource,
    /setCalibratedCamera|applyContainerFloor|live-collision-blockers|evaluateQuadSolvability/i,
  );
  assert.doesNotMatch(combinedSource, /computeAutoBoundsNormalization|AUTO_NORMALIZE_TARGET_SIZE/);
  assert.doesNotMatch(combinedSource, /3d-room-lab\/model-bounds/);
  assert.equal(
    imports.includes("@/app/admin/3d-room-lab/model-bounds"),
    false,
  );
});

test("EMPTY stays distinct and only real generation enables TILED", () => {
  const withOriginal = setOriginalRepresentation(createInitialRepresentationState(), {
    imageUrl: "https://example.test/room.jpg",
    source: { type: "hosted-url", imageUrl: "https://example.test/room.jpg" },
  });
  const withEmpty = setEmptyRepresentation(
    withOriginal,
    "/api/admin/3d-room-lab-v2/attempt-empty?attemptId=attempt",
  );
  assert.equal(withEmpty.EMPTY.availability, "available");
  assert.equal(withEmpty.TILED.availability, "unavailable");
  assert.match(
    "reason" in withEmpty.TILED ? withEmpty.TILED.reason : "",
    /not been generated/,
  );
  const withTiled = setTiledRepresentation(
    withEmpty,
    "/api/admin/3d-room-lab-v2/attempt-tiled?attemptId=attempt",
  );
  assert.equal(withTiled.TILED.availability, "available");
  assert.notEqual(withTiled.EMPTY, withTiled.TILED);
});
