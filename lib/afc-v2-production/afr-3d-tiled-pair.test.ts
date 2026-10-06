import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { settleAfcFixedSeamCalibrationWithRatioExtension } from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import { AFC_V2_REFERENCE_DEPTH_M } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { callCompositorAfcSr1TiledPerspectiveReader } from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";

import {
  buildAfcV2ArtifactLineageDiagnostic,
  unknownAfcV2ArtifactLineageEmpty,
  unknownAfcV2ArtifactLineageTiled,
} from "./artifact-lineage-diagnostic";

/**
 * Canonical reader results measured from the historical BAD and GOOD TILED
 * bytes of one original/EMPTY lineage. These numbers are regression evidence.
 * They are not acceptance thresholds.
 *
 * Original eda79066bd6b2603ae2039be8cd1dacfec320f0bc8f525d0f6a322d4c668cd90
 * EMPTY    4d2d12a7d7bb9558971214ac2123ed41c51901f54b4c2a14f79e6a4ad6b3786d
 */
const ORIGINAL_SIZE = { width: 1144, height: 1534 } as const;
const BAD_TILED_SHA = "b1265b2e22304a483a136a1ac6d3aa08068a1f34ac12c42c4e4c68086973b2b1";
const GOOD_TILED_SHA = "a1e1e2102daa59da9cd9aca40706094c7a1fbf9878e6401107bde605c535b5f0";
const READER_VERSION = "afc-sr1-tiled-perspective-reader/s1";

const BAD_POLYGON = [
  { x: 0.19433574484340907, y: 0.9992958566241903 },
  { x: 0.30440890550742766, y: 0.9142958069427229 },
  { x: 0.1876279696638781, y: 0.7325327273739121 },
  { x: 0.09595426095204106, y: 0.751388285412524 },
] as const;

const GOOD_POLYGON = [
  { x: 0.10345641758985938, y: 0.8502281159111699 },
  { x: 0.285650487293239, y: 0.7847795955191518 },
  { x: 0.22908210999228484, y: 0.7216762120066194 },
  { x: 0.08215266106703666, y: 0.7655805115886138 },
] as const;

const BAD_READER = {
  rawQuadCount: 14,
  deduplicatedCellCount: 14,
  selectedComponentTileCount: 7,
  rows: 4,
  columns: 1,
  j0: 0,
  i0: -1,
  mean: 11.42760589387132,
  max: 48.01957277261079,
  polygon: BAD_POLYGON,
} as const;

const GOOD_READER = {
  rawQuadCount: 9,
  deduplicatedCellCount: 9,
  selectedComponentTileCount: 5,
  rows: 2,
  columns: 2,
  j0: 0,
  i0: 0,
  mean: 2.7529807954136793,
  max: 4.996301540721732,
  polygon: GOOD_POLYGON,
} as const;

function settle(polygon: readonly { x: number; y: number }[]) {
  return settleAfcFixedSeamCalibrationWithRatioExtension({
    sourceNormalizedPolygon: polygon as readonly [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ],
    sourceImageSize: ORIGINAL_SIZE,
    frameSize: ORIGINAL_SIZE,
    referenceDepthM: AFC_V2_REFERENCE_DEPTH_M,
  });
}

type HistoricalReader = {
  rawQuadCount: number;
  deduplicatedCellCount: number;
  selectedComponentTileCount: number;
  rows: number;
  columns: number;
  j0: number;
  i0: number;
  mean: number;
  max: number;
  polygon: readonly { x: number; y: number }[];
};

function fourPointPolygon(points: readonly { x: number; y: number }[]) {
  const [first, second, third, fourth] = points;
  if (!first || !second || !third || !fourth || points.length !== 4) {
    throw new Error("historical polygon is not four points");
  }
  return [first, second, third, fourth] as const;
}

function lineageFor(reader: HistoricalReader) {
  return buildAfcV2ArtifactLineageDiagnostic({
    empty: unknownAfcV2ArtifactLineageEmpty(),
    tiled: unknownAfcV2ArtifactLineageTiled(),
    reader: {
      readerVersion: READER_VERSION,
      status: "ok",
      rawQuadCount: reader.rawQuadCount,
      deduplicatedCellCount: reader.deduplicatedCellCount,
      selectedComponentTileCount: reader.selectedComponentTileCount,
      selectedCore: {
        rows: reader.rows,
        columns: reader.columns,
        j0: reader.j0,
        i0: reader.i0,
      },
      latticeReprojectionMeanPx: reader.mean,
      latticeReprojectionMaxPx: reader.max,
      selectedPolygon: fourPointPolygon(reader.polygon),
    },
  });
}

function near(actual: number, expected: number, tolerance: number) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} was not within ${tolerance} of ${expected}`,
  );
}

test("the same original frame settles the historical BAD and GOOD reader polygons differently", () => {
  assert.equal(AFC_V2_REFERENCE_DEPTH_M, 4);
  const bad = settle(BAD_POLYGON);
  const good = settle(GOOD_POLYGON);
  assert.equal(bad.ok, false);
  if (bad.ok || bad.reason !== "no_apply_safe_candidate") {
    assert.fail(`BAD settle changed: ${bad.ok ? "success" : bad.reason}`);
  }
  assert.equal(bad.applySafeCellCount, 0);
  assert.ok(bad.diagnostics.bestRejectedCandidate);
  near(bad.diagnostics.bestRejectedCandidate.ratio, 0.71, 0.0001);
  near(bad.diagnostics.bestRejectedCandidate.verticalFovDeg, 90, 0.05);
  near(bad.diagnostics.bestRejectedCandidate.cvAvgPx, 81.812, 0.001);
  near(bad.diagnostics.bestRejectedCandidate.cvMaxPx, 111.369, 0.001);

  assert.equal(good.ok, true);
  if (!good.ok) return;
  near(good.widthDepthRatio, 0.72, 0.0001);
  near(good.verticalFovDeg, 84.9, 0.05);
  assert.equal(good.applySafeCellCount, 332);
  near(good.applyObservability.displayAvgPx, 0.0943, 0.0001);
  near(good.applyObservability.displayMaxPx, 0.1703, 0.0001);
});

test("reader-core diagnostics lock the historical BAD and GOOD cores without gating them", () => {
  for (const reader of [BAD_READER, GOOD_READER]) {
    const diagnostic = lineageFor(reader);
    assert.equal(diagnostic.reader.rawQuadCount, reader.rawQuadCount);
    assert.equal(diagnostic.reader.deduplicatedCellCount, reader.deduplicatedCellCount);
    assert.equal(diagnostic.reader.selectedComponentTileCount, reader.selectedComponentTileCount);
    assert.equal(diagnostic.reader.selectedCore?.rows, reader.rows);
    assert.equal(diagnostic.reader.selectedCore?.columns, reader.columns);
    assert.equal(diagnostic.reader.selectedCore?.j0, reader.j0);
    assert.equal(diagnostic.reader.selectedCore?.i0, reader.i0);
    near(diagnostic.reader.latticeReprojectionMeanPx ?? Number.NaN, reader.mean, 1e-9);
    near(diagnostic.reader.latticeReprojectionMaxPx ?? Number.NaN, reader.max, 1e-9);
    assert.deepEqual(diagnostic.reader.selectedPolygon, reader.polygon);
    assert.equal(Number(reader.mean.toFixed(3)), reader === BAD_READER ? 11.428 : 2.753);
    assert.equal(Number(reader.max.toFixed(3)), reader === BAD_READER ? 48.02 : 4.996);
  }
});

function envValue(name: string): string | null {
  const current = process.env[name]?.trim();
  if (current) return current;
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) return null;
  const value = line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  return value || null;
}

const BAD_TILED_PATH = process.env.AFR_3D_BAD_TILED_PATH ?? "/tmp/afr3c/bad-tiled.png";
const GOOD_TILED_PATH = process.env.AFR_3D_GOOD_TILED_PATH ?? "/tmp/afr3c/good-tiled.png";
const replayReady = existsSync(BAD_TILED_PATH)
  && existsSync(GOOD_TILED_PATH)
  && envValue("ROOMPRINTZ_COMPOSITOR_URL") != null
  && envValue("ROOMPRINTZ_COMPOSITOR_API_KEY") != null;

test(
  "current reader matches the historical BAD and GOOD cores when local bytes are available",
  { skip: replayReady ? false : "local TILED bytes or compositor env unavailable", timeout: 120_000 },
  async () => {
    const previousUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
    const previousKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    process.env.ROOMPRINTZ_COMPOSITOR_URL = envValue("ROOMPRINTZ_COMPOSITOR_URL") ?? "";
    process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = envValue("ROOMPRINTZ_COMPOSITOR_API_KEY") ?? "";
    try {
      await replay(BAD_TILED_PATH, BAD_TILED_SHA, BAD_READER);
      await replay(GOOD_TILED_PATH, GOOD_TILED_SHA, GOOD_READER);
    } finally {
      if (previousUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
      else process.env.ROOMPRINTZ_COMPOSITOR_URL = previousUrl;
      if (previousKey === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
      else process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = previousKey;
    }
  },
);

async function replay(
  filePath: string,
  expectedSha: string,
  reader: HistoricalReader,
) {
  const bytes = new Uint8Array(readFileSync(filePath));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, expectedSha);
  const metadata = await inspectImageMetadata(Buffer.from(bytes));
  assert.equal(metadata.ok, true);
  if (!metadata.ok) return;
  assert.equal(metadata.width, 896);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.orientation, 1);
  const response = await callCompositorAfcSr1TiledPerspectiveReader({
    imageBase64: Buffer.from(bytes).toString("base64"),
    claimedIdentity: {
      sha256: digest,
      byteCount: bytes.byteLength,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      mimeType: "image/png",
      orientation: 1,
    },
  });
  assert.equal(response.status, "ok");
  if (response.status !== "ok") return;
  assert.equal(response.readerVersion, READER_VERSION);
  assert.equal(response.rawQuadrilateralCount, reader.rawQuadCount);
  assert.equal(response.deduplicatedCellCount, reader.deduplicatedCellCount);
  assert.equal(response.selectedComponentTileCount, reader.selectedComponentTileCount);
  assert.equal(response.authoritativeCore.rows, reader.rows);
  assert.equal(response.authoritativeCore.columns, reader.columns);
  assert.equal(response.authoritativeCore.j0, reader.j0);
  assert.equal(response.authoritativeCore.i0, reader.i0);
  near(response.reprojectionMeanPx, reader.mean, 1e-6);
  near(response.reprojectionMaxPx, reader.max, 1e-6);
  assert.equal(response.authoritativeQuadSourceNormalized.length, 4);
  response.authoritativeQuadSourceNormalized.forEach((point, index) => {
    near(point.x, reader.polygon[index].x, 1e-9);
    near(point.y, reader.polygon[index].y, 1e-9);
  });
}
