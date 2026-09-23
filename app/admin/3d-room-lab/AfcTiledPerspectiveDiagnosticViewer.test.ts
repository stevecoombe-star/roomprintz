import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAfcTiledPerspectiveDiagnosticViewerModel,
  selectAfcTiledPerspectiveDiagnosticBasis,
} from "./AfcTiledPerspectiveDiagnosticViewer";
import type {
  AfcSr1LiveAuthoritativeGeometry,
} from "./afc-sr1-live-product-contract";

const source = readFileSync(
  new URL("./AfcTiledPerspectiveDiagnosticViewer.tsx", import.meta.url),
  "utf8"
);

const result = {
  originalBasis: {
    sha256: "a".repeat(64), byteCount: 1, decodedWidth: 1200, decodedHeight: 800,
    mimeType: "image/png", orientation: 1,
  },
  emptyBasis: {
    sha256: "b".repeat(64), byteCount: 1, decodedWidth: 1264, decodedHeight: 848,
    mimeType: "image/png", orientation: 1,
  },
  diagnosticImages: {
    emptyUrl: "/api/admin/3d-room-lab/afc-sr1/live-attempt-empty?attemptId=test",
    tiledUrl: "/api/admin/3d-room-lab/afc-sr1/live-attempt-tiled?attemptId=test",
  },
  geometry: {
    sourceNormalizedPolygon: [
      { x: 0.625, y: 0.917 },
      { x: 0.747, y: 0.745 },
      { x: 0.548, y: 0.672 },
      { x: 0.4, y: 0.742 },
    ],
    tiledPerspective: {
      tiledBasis: {
        sha256: "c".repeat(64), byteCount: 1, decodedWidth: 1264, decodedHeight: 848,
        mimeType: "image/png", orientation: 1,
      },
      emptyToOriginalCompatibilityTier: "aspect_compatible_rescaled",
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      core: { rows: 3, columns: 5, j0: 0, i0: 0, cellIds: [1] },
      selectedComponentTileCount: 42,
      rawQuadrilateralCount: 55,
      deduplicatedCellCount: 50,
      reprojectionMeanPx: 4.18,
      reprojectionMaxPx: 22.41,
    },
  },
} as unknown as AfcSr1LiveAuthoritativeGeometry;

test("TILED diagnostic model keeps the reader quad and compact core diagnostics", () => {
  const model = buildAfcTiledPerspectiveDiagnosticViewerModel(result);
  assert.ok(model);
  assert.equal(model.polygon, result.geometry.sourceNormalizedPolygon);
  assert.equal(model.tiledBasis.decodedWidth, 1264);
  assert.equal(model.core.rows, 3);
  assert.equal(model.winningTiles, 42);
  assert.equal(model.emptyToOriginal, "aspect-rescaled");
});

test("basis selection defaults and falls back without substituting another attempt", () => {
  assert.equal(
    selectAfcTiledPerspectiveDiagnosticBasis({
      requested: "tiled",
      originalAvailable: true,
      emptyAvailable: true,
      tiledAvailable: true,
    }),
    "tiled"
  );
  assert.equal(
    selectAfcTiledPerspectiveDiagnosticBasis({
      requested: "tiled",
      originalAvailable: true,
      emptyAvailable: true,
      tiledAvailable: false,
    }),
    "empty"
  );
  assert.equal(
    selectAfcTiledPerspectiveDiagnosticBasis({
      requested: "empty",
      originalAvailable: true,
      emptyAvailable: false,
      tiledAvailable: false,
    }),
    "original"
  );
});

test("viewer is read-only and presents all three bases around one authority", () => {
  assert.match(source, /Floor Read — TILED Perspective/);
  assert.match(source, /Authority: TILED\. ORIGINAL and EMPTY are basis views only\./);
  assert.match(source, /useState<DiagnosticBasis>\("tiled"\)/);
  assert.match(source, /\["original", "empty", "tiled"\]/);
  assert.match(source, /data-authoritative-polygon=\{points\}/);
  assert.match(source, /pointer-events-none/);
  assert.match(source, /CORNERS = \["NL", "NR", "FR", "FL"\]/);
  assert.match(source, /Perspective: \{adjusted/);
  assert.match(source, /Reader succeeded\. Lab settle did not apply\./);
  assert.doesNotMatch(source, /onPointerDown|onPointerMove|onDrag|contentEditable/);
});
