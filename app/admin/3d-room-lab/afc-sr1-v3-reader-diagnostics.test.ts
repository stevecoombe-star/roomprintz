import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAfcSr1V3ReaderForensics,
  mapAfcSr1V3AnalysisPointToDecodedPixel,
  mapAfcSr1V3DecodedPointToSourceNormalized,
  mapAfcSr1V3AnalysisLineToDecodedPixel,
  retainAfcSr1V3ReaderDiagnostics,
} from "./afc-sr1-v3-reader-diagnostics";

function receipt() {
  const pair = {
    familyIndices: [4, 9],
    floorLineAnalysis: [0, 1, -100],
    families: [
      {
        vpClass: "finite",
        normalizedHomogeneousVp: [1, 0, 0.01],
        direction: null,
        rho: 1,
        supportCount: 12,
        supportTotalLengthPx: 100,
        cappedSupportLengthPx: 90,
        medianResidualPx: 1,
        p90ResidualPx: 2,
      },
      {
        vpClass: "directional",
        normalizedHomogeneousVp: [0, 1, 0],
        direction: [0, 1],
        rho: 999,
        supportCount: 8,
        supportTotalLengthPx: 80,
        cappedSupportLengthPx: 75,
        medianResidualPx: 1.5,
        p90ResidualPx: 2.5,
      },
    ],
    basinSupport: 2,
    stability: {
      stable: true,
      classPreserving: true,
      maxSplitVsFullProbeDistancePx: 3,
    },
    distinctness: { chordal: 0.7, directionAngleDegrees: 90 },
  };
  return {
    schemaVersion: "afc-sr1-tr2-tile-floor-reader-result/v3",
    status: "usable",
    researchProfile: "afc-sr1-tr2-tile-floor-reader/v3",
    policyVersion: "afc-sr1-ts2-extractor-policy/v3",
    imageIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 1000,
      decodedHeight: 600,
    },
    analysisIdentity: {
      mode: "downscale_long_edge",
      analysisWidth: 500,
      analysisHeight: 300,
      scaleX: 2,
      scaleY: 2,
    },
    roiIdentity: { roiDigest: "b".repeat(64) },
    runtimeIdentity: {
      readerModuleVersion: "v3-test",
      opencvVersion: "4",
      numpyVersion: "2",
    },
    evidenceDigest: { value: "c".repeat(64) },
    floorVanishingLinePixel: { a: 0, b: 1, c: -200 },
    diagnostics: {
      validFamilyCount: 3,
      candidateUnorderedPairCount: 3,
      validPairCount: 2,
      segmentCounts: { raw: 21, admittedAllNineInside: 15 },
      invalidPairs: [{
        familyIndices: [1, 2],
        reason: "unstable_vanishing_line",
        stability: { stable: false, classPreserving: true, maxSplitVsFullProbeDistancePx: 22 },
      }],
      validPairUniverse: [
        pair,
        {
          ...pair,
          familyIndices: [5, 9],
          floorLineAnalysis: [0, 1, -80],
        },
      ],
      winningPair: pair,
      familySupportGeometry: {
        coordinateSpace: "analysis-pixel/v1",
        authority: "none",
        role: "observation_only",
        excludedFromCanonicalEvidence: true,
        segments: [
          { detectorIndex: 17, x1: 10, y1: 20, x2: 30, y2: 40, providerJunk: true },
          { detectorIndex: 23, x1: 50, y1: 60, x2: 70, y2: 80 },
        ],
        families: [
          { familyIndex: 4, supporterDetectorIndices: [17, 23], other: "drop" },
          { familyIndex: 9, supporterDetectorIndices: [17] },
        ],
      },
      familyPairIndependenceDiagnostics: {
        contractVersion: "afc-sr1-family-pair-independence-diagnostics/v1",
        coordinateSpace: "analysis-pixel/v1",
        authority: "none",
        role: "observation_only",
        excludedFromCanonicalEvidence: true,
        familyOrientationSummaries: [
          {
            familyIndex: 4,
            supporterCount: 12,
            axialMeanDegrees: 179,
            axialMedianDegrees: 179,
            axialCircularStdDevDegrees: 1,
            axialIqrDegrees: 2,
          },
          {
            familyIndex: 9,
            supporterCount: 8,
            axialMeanDegrees: 1,
            axialMedianDegrees: 1,
            axialCircularStdDevDegrees: 1,
            axialIqrDegrees: 2,
          },
        ],
        pairs: [{
          familyIndices: [4, 9],
          overlap: {
            sharedSupporterCount: 3,
            unionSupporterCount: 17,
            jaccard: 3 / 17,
            overlapFractionOfSmaller: 3 / 8,
            familyASupporterCount: 12,
            familyBSupporterCount: 8,
          },
          exclusiveSupport: {
            sharedSupportLengthPx: 30,
            firstOnlySupporterCount: 9,
            secondOnlySupporterCount: 5,
            firstOnlySupportLengthPx: 90,
            secondOnlySupportLengthPx: 50,
          },
          crossFit: {
            firstSupportersAgainstSecond: {
              supporterCount: 12,
              medianResidualPx: 13.97,
              p90ResidualPx: 20,
              withinExistingInlierBandCount: 1,
            },
            secondSupportersAgainstFirst: {
              supporterCount: 8,
              medianResidualPx: 14.85,
              p90ResidualPx: 21,
              withinExistingInlierBandCount: 1,
            },
          },
          predictedDirectionFieldDisagreement: {
            onFirstSupporterMidpoints: { supporterCount: 12, medianDegrees: 1, p90Degrees: 2 },
            onSecondSupporterMidpoints: { supporterCount: 8, medianDegrees: 1.2, p90Degrees: 2.2 },
            onUnionSupporterMidpoints: { supporterCount: 17, medianDegrees: 1.1, p90Degrees: 2.1 },
            onSharedSupporterMidpoints: { supporterCount: 3, medianDegrees: 0.5, p90Degrees: 1 },
          },
        }],
      },
      arbitraryProviderEnvelope: { mustNotEscape: true },
    },
  };
}

test("V3 diagnostic contract retains only bounded explicit evidence and preserves discovery order", () => {
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(receipt(), "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  assert.equal(diagnostics.floorVanishingLinePixel.c, -200);
  assert.deepEqual(diagnostics.winningPair.familyIndices, [4, 9]);
  assert.deepEqual(
    diagnostics.validPairUniverse.map((pair) => pair.familyIndices),
    [[4, 9], [5, 9]]
  );
  assert.equal(diagnostics.invalidPairs[0]?.reason, "unstable_vanishing_line");
  assert.doesNotMatch(JSON.stringify(diagnostics), /arbitraryProviderEnvelope|mustNotEscape/);
  assert.equal(diagnostics.authority, "none");
  assert.equal(diagnostics.excludedFromCanonicalEvidence, true);
  assert.deepEqual(diagnostics.familySupportGeometry, {
    coordinateSpace: "analysis-pixel/v1",
    authority: "none",
    role: "observation_only",
    excludedFromCanonicalEvidence: true,
    segments: [
      { detectorIndex: 17, x1: 10, y1: 20, x2: 30, y2: 40 },
      { detectorIndex: 23, x1: 50, y1: 60, x2: 70, y2: 80 },
    ],
    families: [
      { familyIndex: 4, supporterDetectorIndices: [17, 23] },
      { familyIndex: 9, supporterDetectorIndices: [17] },
    ],
  });
  assert.deepEqual(
    mapAfcSr1V3AnalysisLineToDecodedPixel(
      diagnostics.winningPair,
      diagnostics.analysisIdentity
    ),
    diagnostics.floorVanishingLinePixel
  );
  assert.deepEqual(
    diagnostics.familyPairIndependenceDiagnostics?.familyOrientationSummaries.map(
      (summary) => summary.familyIndex
    ),
    [4, 9]
  );
  assert.deepEqual(
    diagnostics.familyPairIndependenceDiagnostics?.pairs.map((pair) => pair.familyIndices),
    [[4, 9]]
  );
  assert.equal(
    diagnostics.familyPairIndependenceDiagnostics?.pairs[0]?.predictedDirectionFieldDisagreement
      .onUnionSupporterMidpoints?.p90Degrees,
    2.1
  );
});

test("malformed optional family support geometry drops without invalidating Reader science", () => {
  const value = receipt();
  value.diagnostics.familySupportGeometry.segments[0].detectorIndex = -1;
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(value, "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  assert.equal(diagnostics.familySupportGeometry, null);
  assert.deepEqual(diagnostics.winningPair.familyIndices, [4, 9]);
  assert.equal(diagnostics.receiptEvidenceDigest, "c".repeat(64));
});

test("malformed optional pair-independence sidecar drops without invalidating Reader science", () => {
  const value = receipt();
  value.diagnostics.familyPairIndependenceDiagnostics.pairs[0]
    .predictedDirectionFieldDisagreement.onUnionSupporterMidpoints.p90Degrees = 91;
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(value, "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  assert.equal(diagnostics.familyPairIndependenceDiagnostics, null);
  assert.deepEqual(diagnostics.winningPair.familyIndices, [4, 9]);
  assert.equal(diagnostics.receiptEvidenceDigest, "c".repeat(64));
});

test("supporter points multiply analysis scale, then normalize exact decoded EMPTY pixels", () => {
  const identity = {
    mode: "downscale_long_edge" as const,
    analysisWidth: 500,
    analysisHeight: 300,
    scaleX: 2,
    scaleY: 4,
  };
  const image = { sha256: "a".repeat(64), decodedWidth: 1000, decodedHeight: 1200 };
  assert.deepEqual(
    mapAfcSr1V3AnalysisPointToDecodedPixel({ x: 10, y: 20 }, {
      ...identity, scaleX: 1, scaleY: 1,
    }),
    { x: 10, y: 20 }
  );
  assert.deepEqual(
    mapAfcSr1V3AnalysisPointToDecodedPixel({ x: 10, y: 20 }, {
      ...identity, scaleX: 3, scaleY: 3,
    }),
    { x: 30, y: 60 }
  );
  const decoded = mapAfcSr1V3AnalysisPointToDecodedPixel({ x: 10, y: 20 }, identity);
  assert.deepEqual(decoded, { x: 20, y: 80 });
  assert.deepEqual(
    decoded && mapAfcSr1V3DecodedPointToSourceNormalized(decoded, image),
    { x: 0.02, y: 80 / 1200 }
  );
});

test("analysis-to-decoded mapper applies the identity dual transform", () => {
  const value = receipt();
  value.imageIdentity.decodedWidth = 1000;
  value.imageIdentity.decodedHeight = 600;
  value.analysisIdentity.analysisWidth = 1000;
  value.analysisIdentity.analysisHeight = 600;
  value.analysisIdentity.scaleX = 1;
  value.analysisIdentity.scaleY = 1;
  value.floorVanishingLinePixel = { a: 0, b: 1, c: -100 };
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(value, "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  assert.deepEqual(
    mapAfcSr1V3AnalysisLineToDecodedPixel(
      diagnostics.winningPair,
      diagnostics.analysisIdentity
    ),
    { a: 0, b: 1, c: -100 }
  );
});

test("analysis-to-decoded mapper uses the inverse dual for uniform downscale", () => {
  const value = receipt();
  value.imageIdentity.decodedWidth = 2000;
  value.imageIdentity.decodedHeight = 1000;
  value.analysisIdentity.analysisWidth = 1000;
  value.analysisIdentity.analysisHeight = 500;
  value.analysisIdentity.scaleX = 2;
  value.analysisIdentity.scaleY = 2;
  value.floorVanishingLinePixel = { a: 0, b: 1, c: -200 };
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(value, "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  assert.deepEqual(
    mapAfcSr1V3AnalysisLineToDecodedPixel(
      diagnostics.winningPair,
      diagnostics.analysisIdentity
    ),
    diagnostics.floorVanishingLinePixel
  );
});

test("analysis-to-decoded mapper handles anisotropic point scaling with the dual", () => {
  const value = receipt();
  value.imageIdentity.decodedWidth = 2000;
  value.imageIdentity.decodedHeight = 1200;
  value.analysisIdentity.analysisWidth = 1000;
  value.analysisIdentity.analysisHeight = 300;
  value.analysisIdentity.scaleX = 2;
  value.analysisIdentity.scaleY = 4;
  value.diagnostics.winningPair.floorLineAnalysis = [3, 4, -20];
  value.diagnostics.validPairUniverse[0].floorLineAnalysis = [3, 4, -20];
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(value, "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  const mapped = mapAfcSr1V3AnalysisLineToDecodedPixel(
    diagnostics.winningPair,
    diagnostics.analysisIdentity
  );
  const length = Math.hypot(1.5, 1);
  assert.ok(mapped);
  assert.ok(Math.abs((mapped?.a ?? 0) - 1.5 / length) < 1e-12);
  assert.ok(Math.abs((mapped?.b ?? 0) - 1 / length) < 1e-12);
  assert.ok(Math.abs((mapped?.c ?? 0) + 20 / length) < 1e-12);
});

test("long-edge-1264 downscale winning line reproduces the retained decoded line", () => {
  const value = receipt();
  value.imageIdentity.decodedWidth = 2528;
  value.imageIdentity.decodedHeight = 1696;
  value.analysisIdentity.analysisWidth = 1264;
  value.analysisIdentity.analysisHeight = 848;
  value.analysisIdentity.scaleX = 2;
  value.analysisIdentity.scaleY = 2;
  value.diagnostics.winningPair.floorLineAnalysis = [0.6, 0.8, -400];
  value.diagnostics.validPairUniverse[0].floorLineAnalysis = [0.6, 0.8, -400];
  value.floorVanishingLinePixel = { a: 0.6, b: 0.8, c: -800 };
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(value, "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  assert.deepEqual(
    mapAfcSr1V3AnalysisLineToDecodedPixel(
      diagnostics.winningPair,
      diagnostics.analysisIdentity
    ),
    diagnostics.floorVanishingLinePixel
  );
});

test("analysis-to-decoded mapping, counterfactual replay, and horizon residuals are local diagnostics", () => {
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(receipt(), "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  const rawPolygon = [
    { x: 0, y: 0.8 },
    { x: 1, y: 0.7 },
    { x: 0.8, y: 0.35 },
    { x: 0.2, y: 0.45 },
  ] as const;
  const result = deriveAfcSr1V3ReaderForensics({
    diagnostics,
    rawPolygon,
    finalPolygon: [
      { x: 0.3, y: 0.6 },
      rawPolygon[1],
      rawPolygon[2],
      rawPolygon[3],
    ],
    fixedAnchor: "NR",
    authoritativeSeamT: null,
  });
  assert.deepEqual(result.sourceNormalizedHorizon, { a: 0, b: 1, c: -1 / 3 });
  assert.equal(result.authoritativeWidthVp.horizonResidual.decodedPixelDistance, 0);
  assert.equal(result.otherValidPairs.length, 1);
  assert.deepEqual(result.otherValidPairs[0]?.floorLineDecodedPixel, { a: 0, b: 1, c: -160 });
  assert.equal(result.otherValidPairs[0]?.counterfactualDiagnosticOnly, true);
});

test("directional VPs stay homogeneous and use angular incidence rather than pixels", () => {
  const diagnostics = retainAfcSr1V3ReaderDiagnostics(receipt(), "rawReader");
  assert.ok(diagnostics);
  if (!diagnostics) return;
  const result = deriveAfcSr1V3ReaderForensics({
    diagnostics,
    rawPolygon: [
      { x: 0, y: 0.8 },
      { x: 1, y: 0.8 },
      { x: 1, y: 0.4 },
      { x: 0, y: 0.4 },
    ],
    finalPolygon: null,
    fixedAnchor: "NL",
    authoritativeSeamT: null,
  });
  assert.equal(result.rawWidthVp.kind, "directional");
  assert.equal(result.rawWidthVp.side, "directional");
  assert.equal(result.rawWidthVp.horizonResidual.decodedPixelDistance, null);
  assert.ok(
    (result.rawWidthVp.horizonResidual.directionalAngularDegrees ?? Infinity) < 1e-10
  );
});
