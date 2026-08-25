import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RoomLabV2 from "./RoomLabV2";
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

test("V2-S2 route and clean shell render", () => {
  const routeMarkup = renderToStaticMarkup(
    createElement(AdminAfcV2Page),
  );
  const shellMarkup = renderToStaticMarkup(createElement(RoomLabV2));

  assert.match(routeMarkup, /3D Room Lab v2/);
  assert.match(shellMarkup, /Analyze &amp; Apply AFC/);
  assert.match(shellMarkup, /Prepare Original/);
  assert.match(shellMarkup, /Original/);
  assert.match(shellMarkup, /EMPTY/);
  assert.match(shellMarkup, /FULLY TILED/);
  assert.match(shellMarkup, /AFC Status/);
  assert.match(shellMarkup, /Floor/);
  assert.match(shellMarkup, /Camera/);
  assert.match(shellMarkup, /Room Boundaries/);
  assert.match(shellMarkup, /Supports/);
  assert.match(shellMarkup, /Floor-only TILED remains internal evidence/);
});

test("representation contract keeps Original, EMPTY, and FULLY_TILED distinct", () => {
  assert.deepEqual(REPRESENTATION_KINDS, [
    "ORIGINAL",
    "EMPTY",
    "FULLY_TILED",
  ]);

  const initial = createInitialRepresentationState();
  assert.equal(initial.ORIGINAL.kind, "ORIGINAL");
  assert.equal(initial.EMPTY.kind, "EMPTY");
  assert.equal(initial.FULLY_TILED.kind, "FULLY_TILED");
  assert.equal(initial.EMPTY.availability, "unavailable");
  assert.equal(initial.FULLY_TILED.availability, "unavailable");
  assert.equal("imageUrl" in initial.EMPTY, false);
  assert.equal("imageUrl" in initial.FULLY_TILED, false);

  const loaded = setOriginalRepresentation(initial, {
    imageUrl: "blob:original-room",
    source: {
      type: "hosted-url",
      imageUrl: "https://example.test/room.jpg",
    },
  });
  assert.equal(loaded.ORIGINAL.availability, "available");
  assert.equal(loaded.EMPTY.availability, "unavailable");
  assert.equal(loaded.FULLY_TILED.availability, "unavailable");
  assert.notEqual(loaded.ORIGINAL, loaded.EMPTY);
  assert.notEqual(loaded.ORIGINAL, loaded.FULLY_TILED);
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
    "./orchestration-state",
    "./representation-state",
    "@/app/admin/3d-room-lab/calibrated-camera-readonly-projection",
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
});

test("floor-only TILED stays internal and never enables FULLY_TILED", () => {
  const withOriginal = setOriginalRepresentation(createInitialRepresentationState(), {
    imageUrl: "https://example.test/room.jpg",
    source: { type: "hosted-url", imageUrl: "https://example.test/room.jpg" },
  });
  const withEmpty = setEmptyRepresentation(
    withOriginal,
    "/api/admin/3d-room-lab-v2/attempt-empty?attemptId=attempt",
  );
  assert.equal(withEmpty.EMPTY.availability, "available");
  assert.equal(withEmpty.FULLY_TILED.availability, "unavailable");
  assert.match(
    "reason" in withEmpty.FULLY_TILED ? withEmpty.FULLY_TILED.reason : "",
    /V2-S2/,
  );
});
