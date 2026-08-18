import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAfcSr1LiveFloorReadOverlayModel,
  buildAfcSr1LiveFloorSupporterOverlayModel,
  type AfcSr1LiveFinalGeometryOverlay,
} from "./AfcSr1LiveFloorReadOverlay";
import type { AfcSr1V3ReaderDiagnosticsV1 } from "./afc-sr1-v3-reader-diagnostics";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

const source = readFileSync(
  new URL("./AfcSr1LiveFloorReadOverlay.tsx", import.meta.url),
  "utf8"
);

const raw = [
  { x: 0, y: 0.856 },
  { x: 1, y: 0.791 },
  { x: 0.885, y: 0.624 },
  { x: 0.431, y: 0.591 },
] as const satisfies AfcSr1SourcePolygon;
const final = [
  { x: 0.339329185702014, y: 0.6473637257284601 },
  raw[1],
  raw[2],
  raw[3],
] as const satisfies AfcSr1SourcePolygon;

const supportDiagnostics = {
  analysisIdentity: {
    mode: "downscale_long_edge",
    analysisWidth: 50,
    analysisHeight: 25,
    scaleX: 2,
    scaleY: 4,
  },
  imageIdentity: { sha256: "a".repeat(64), decodedWidth: 100, decodedHeight: 100 },
  familySupportGeometry: {
    coordinateSpace: "analysis-pixel/v1",
    authority: "none",
    role: "observation_only",
    excludedFromCanonicalEvidence: true,
    segments: [
      { detectorIndex: 17, x1: 10, y1: 5, x2: 20, y2: 10 },
      { detectorIndex: 23, x1: 30, y1: 15, x2: 40, y2: 20 },
    ],
    families: [
      { familyIndex: 0, supporterDetectorIndices: [17] },
      { familyIndex: 2, supporterDetectorIndices: [17, 23] },
    ],
  },
} as unknown as AfcSr1V3ReaderDiagnosticsV1;

test("live Floor read overlay keeps raw Gemini and final AFC polygons as distinct ordered inputs", () => {
  const finalGeometry: AfcSr1LiveFinalGeometryOverlay = {
    polygon: final,
    fixedAnchor: "NR",
    adjustableCorner: "NL",
    baselineSeamT: 0.7873066953643014,
  };
  const model = buildAfcSr1LiveFloorReadOverlayModel({
    rawPolygon: raw,
    finalGeometry,
  });
  assert.equal(model.rawPolygon, raw);
  assert.equal(model.finalPolygon, final);
  assert.notDeepEqual(model.rawPolygon, model.finalPolygon);
  assert.deepEqual(model.rawPolygon, [raw[0], raw[1], raw[2], raw[3]]);
  assert.equal(model.fixedAnchor, "NR");
  assert.equal(model.adjustableCorner, "NL");
  assert.equal(model.baselineSeamT, 0.7873066953643014);
});

test("live Floor read overlay omits final geometry when no authoritative geometry exists", () => {
  const model = buildAfcSr1LiveFloorReadOverlayModel({
    rawPolygon: raw,
    finalGeometry: null,
  });
  assert.equal(model.finalPolygon, null);
  assert.equal(model.fixedAnchor, null);
  assert.equal(model.adjustableCorner, null);
  assert.equal(model.baselineSeamT, null);
});

test("live Floor read overlay identifies EMPTY as the Assist analysis basis and Original as preview only", () => {
  assert.match(source, /EMPTY — analysis basis/);
  assert.match(source, /ORIGINAL — preview only/);
  assert.match(
    source,
    /detector analyzed EMPTY/
  );
  assert.match(source, /Current qualified Original preview/);
  assert.match(source, /diagnostic\.emptyImage\.url/);
  assert.match(source, /Automatic Floor read — Empty-Room Assist/);
  assert.match(source, /Final AFC geometry — cyan/);
  assert.match(source, /RAW V3 floor horizon — violet \(parent EMPTY\)/);
  assert.match(source, /rawV3ReaderDiagnostics/);
  assert.match(source, /familySupportGeometry/);
  assert.match(source, /!showOriginal \? supporterSegments/);
  assert.match(source, /Show all final-family supporters/);
  assert.match(source, /Hide supporters/);
  assert.match(source, /RAW V3 winning pair: \[/);
  assert.match(source, /model\.baselineSeamT\?\.toFixed\(4\)/);
});

test("supporter overlay maps only selected RAW final-family identities onto EMPTY", () => {
  const all = buildAfcSr1LiveFloorSupporterOverlayModel({
    diagnostics: supportDiagnostics,
    selectedFamilyIndices: [0, 2],
  });
  assert.equal(all.length, 2);
  assert.deepEqual(all[0], {
    detectorIndex: 17,
    first: { x: 0.2, y: 0.2 },
    second: { x: 0.4, y: 0.4 },
    familyIndices: [0, 2],
  });
  assert.deepEqual(
    buildAfcSr1LiveFloorSupporterOverlayModel({
      diagnostics: supportDiagnostics,
      selectedFamilyIndices: [2],
    }).map((segment) => [segment.detectorIndex, segment.familyIndices]),
    [[17, [2]], [23, [2]]]
  );
  assert.deepEqual(
    buildAfcSr1LiveFloorSupporterOverlayModel({
      diagnostics: supportDiagnostics,
      selectedFamilyIndices: [],
    }),
    []
  );
});

test("live Floor read overlay renders raw semantic corner labels without Floor authority access", () => {
  for (const corner of ["NL", "NR", "FR", "FL"]) {
    assert.match(source, new RegExp(`"${corner}"`));
  }
  assert.match(source, /diagnostic\.polygon/);
  assert.doesNotMatch(
    source,
    /realizeAfcLabGeometry|applySourceNormalizedFloorPolygon|commitFloorAuthorityMutation|onClick=.*apply/i
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|executePathA|settleAfcFixedSeamCalibration/);
  assert.doesNotMatch(source, /applySourceNormalizedFloorPolygon|commitFloorAuthorityMutation/);
});

test("overlay accepts only explicitly RAW V3 diagnostics, never child pixels", () => {
  assert.match(source, /rawV3ReaderDiagnostics/);
  assert.doesNotMatch(source, /childV3ReaderDiagnostics/);
  assert.match(source, /RAW V3 floor horizon/);
  assert.doesNotMatch(source, /\[0,\s*3\]|\[1,\s*2\]/);
});
