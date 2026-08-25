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
        /\.(?:ts|tsx)$/.test(fileName) && !fileName.endsWith(".test.ts"),
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

test("V2-S1 route and clean shell render", () => {
  const routeMarkup = renderToStaticMarkup(
    createElement(AdminAfcV2Page),
  );
  const shellMarkup = renderToStaticMarkup(createElement(RoomLabV2));

  assert.match(routeMarkup, /3D Room Lab v2/);
  assert.match(shellMarkup, /Analyze &amp; Apply AFC/);
  assert.match(shellMarkup, /Load Original/);
  assert.match(shellMarkup, /Original/);
  assert.match(shellMarkup, /EMPTY/);
  assert.match(shellMarkup, /FULLY TILED/);
  assert.match(shellMarkup, /AFC Status/);
  assert.match(shellMarkup, /Floor/);
  assert.match(shellMarkup, /Camera/);
  assert.match(shellMarkup, /Room Boundaries/);
  assert.match(shellMarkup, /Supports/);
  assert.match(shellMarkup, /AFC geometry is not implemented in V2-S1/);
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
      type: "local-file",
      fileName: "room.jpg",
      mimeType: "image/jpeg",
    },
  });
  assert.equal(loaded.ORIGINAL.availability, "available");
  assert.equal(loaded.EMPTY.availability, "unavailable");
  assert.equal(loaded.FULLY_TILED.availability, "unavailable");
  assert.notEqual(loaded.ORIGINAL, loaded.EMPTY);
  assert.notEqual(loaded.ORIGINAL, loaded.FULLY_TILED);
});

test("analysis request reports the V2-S1 boundary without geometry state", () => {
  const loaded = reduceAfcOrchestrationState(
    INITIAL_AFC_ORCHESTRATION_STATE,
    { type: "original_loaded" },
  );
  assert.deepEqual(loaded, {
    selectedRepresentation: "ORIGINAL",
    status: "original_loaded",
  });

  const requested = reduceAfcOrchestrationState(loaded, {
    type: "analysis_requested",
  });
  assert.deepEqual(requested, {
    selectedRepresentation: "ORIGINAL",
    status: "not_implemented",
  });
  assert.deepEqual(Object.keys(requested).sort(), [
    "selectedRepresentation",
    "status",
  ]);
});

test("v2 runtime imports remain isolated from v1 and geometry execution", () => {
  const runtimeSources = readRuntimeSources();
  const imports = runtimeSources.flatMap(({ source }) =>
    importSpecifiers(source),
  );
  const allowedImports = new Set([
    "next",
    "next/image",
    "react",
    "./RoomLabV2",
    "./orchestration-state",
    "./representation-state",
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
  assert.doesNotMatch(combinedSource, /\bcompositor\b/i);
  assert.doesNotMatch(combinedSource, /live-analyze|tile_grid_scaffold/i);
  assert.doesNotMatch(combinedSource, /\bfetch\s*\(|\/api\//);
  assert.doesNotMatch(combinedSource, /localStorage|scene-state:v0/);
  assert.doesNotMatch(
    combinedSource,
    /setCalibratedCamera|applyContainerFloor|live-collision-blockers/i,
  );
});
