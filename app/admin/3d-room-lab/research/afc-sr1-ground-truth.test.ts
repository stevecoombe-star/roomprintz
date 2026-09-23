import assert from "node:assert/strict";
import test from "node:test";

import roomA from "./fixtures/afc-sr1-room-a-ground-truth.v1.json";
import roomB from "./fixtures/afc-sr1-room-b-ground-truth.v1.json";
import roomC from "./fixtures/afc-sr1-room-c-ground-truth.v1.json";
import {
  deriveRecordedCameraDiagnostics,
  fingerprintSourceNormalizedPolygon,
  isCollinearWithinSourceNormTolerance,
  parseAfcSr1GroundTruthFixtureV1,
  pointOnNearToFarSeam,
  projectPointOntoNearToFarSeam,
} from "./afc-sr1-ground-truth";

function validFixture() {
  // JSON imports preserve `null` literals, while this test deliberately fills
  // those fields to exercise the complete-fixture parser branch.
  return structuredClone(roomC) as any;
}

function certifiedFixture() {
  const fixture = validFixture();
  fixture.photoClass.classification = "supported_full_back_wall";
  fixture.photoClass.provenance = "manual_observation";
  fixture.rawFloor.source = "empty_receipt";
  fixture.rawFloor.receiptFileName = "room-c-empty-receipt.json";
  fixture.rawFloor.receiptSha256 = "a".repeat(64);
  fixture.rawFloor.requestId = "room-c-empty-request";
  fixture.rawFloor.sourceBasisFingerprint = fixture.imageBasis.fingerprint;
  fixture.rawFloor.sourceDecodedWidth = fixture.imageBasis.decodedWidth;
  fixture.rawFloor.sourceDecodedHeight = fixture.imageBasis.decodedHeight;
  fixture.rawFloor.sourceOrientation = fixture.imageBasis.orientation;
  fixture.rawFloor.projectedToImageBasis = true;
  fixture.rawFloor.provenance = "receipt_replay";
  fixture.rawToOriginalPlacement = {
    status: "same_basis",
    method: "documented_source_normalized_transfer",
    originalBasisFingerprint: fixture.imageBasis.fingerprint,
    sourcePolygonFingerprint: "13457889890e7ca7a47d6bbf0505117a3e4f86dbd2159b712bb437b626032b5d",
    provenance: "manual_observation",
    evidenceReference: "test://documented-transfer",
  };
  const seamStart = fixture.rawFloor.polygon[1];
  const seamEnd = fixture.rawFloor.polygon[2];
  const acceptedCorner = fixture.acceptedFloor.polygon[1];
  const projection = projectPointOntoNearToFarSeam(seamStart, seamEnd, acceptedCorner);
  assert.ok(projection);
  fixture.seamRefinement = {
    adjustableCorner: "NR",
    side: "right",
    direction: "near_to_far",
    seamStart,
    seamEnd,
    rawCorner: seamStart,
    acceptedCorner,
    seamT: projection.t,
    perpendicularErrorSourceNormResearchOnly: projection.perpendicularErrorSourceNorm,
    collinearWithinTolerance: true,
    toleranceSourceNormResearchOnly: 0.002,
    provenance: "derived_from_recorded_values",
    notes: [],
  };
  fixture.uncertifiedReceiptSeamEvidence = { status: "none" };
  fixture.calibration.displayAveragePx = 1.62;
  fixture.calibration.displayMaximumPx = 3.28;
  fixture.calibration.scaleRatio = 1.0119014164972706;
  fixture.calibration.cameraApplySafe = true;
  fixture.calibration.cameraAppliedSuccessfully = true;
  fixture.calibration.cameraApplyEvidence = {
    status: "afc_bound_cp2b_applied",
    provenance: ["manual_observation", "live_ui_diagnostics", "scene_state_export"],
    notes: [],
  };
  fixture.afcAuthorityPathStatus = "cp2b_applied";
  fixture.calibration.provenance = "live_ui_diagnostics";
  fixture.manualProcess.widthFovIterationCount = 3;
  fixture.manualProcess.visuallyAccepted = true;
  fixture.manualProcess.provenance = "manual_observation";
  fixture.completeness.status = "certified";
  fixture.completeness.missingFields = [];
  return fixture;
}

test("GT0 parser accepts a complete valid fixture", () => {
  const result = parseAfcSr1GroundTruthFixtureV1(certifiedFixture());
  assert.equal(result.ok, true);
});

test("GT0 parser rejects an unknown schema version", () => {
  const fixture = validFixture();
  fixture.schemaVersion = "afc-sr1-ground-truth/v2";
  const result = parseAfcSr1GroundTruthFixtureV1(fixture);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /schema version/);
});

test("GT0 parser rejects malformed semantic polygon ordering, length, and non-finite coordinates", () => {
  const malformedOrder = validFixture();
  malformedOrder.acceptedFloor.polygon = [
    malformedOrder.acceptedFloor.polygon[1],
    malformedOrder.acceptedFloor.polygon[2],
    malformedOrder.acceptedFloor.polygon[3],
    malformedOrder.acceptedFloor.polygon[0],
  ];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(malformedOrder).ok, false);

  const wrongLength = validFixture();
  wrongLength.acceptedFloor.polygon = wrongLength.acceptedFloor.polygon.slice(0, 3) as never;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(wrongLength).ok, false);

  const nonFinite = validFixture();
  nonFinite.acceptedFloor.polygon[0].x = Number.NaN;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(nonFinite).ok, false);
});

test("GT0 parser rejects inconsistent dimensions, inverse, illegal FOV, and contradictory seam fields", () => {
  const inconsistentRatio = validFixture();
  inconsistentRatio.calibration.widthDepthRatio = 1.1;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(inconsistentRatio).ok, false);

  const inconsistentInverse = validFixture();
  inconsistentInverse.calibration.depthWidthAspect = 0.9;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(inconsistentInverse).ok, false);

  const illegalFov = validFixture();
  illegalFov.calibration.verticalFovDeg = 91;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(illegalFov).ok, false);

  const contradictorySeam = validFixture();
  contradictorySeam.seamRefinement.side = "left";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(contradictorySeam).ok, false);
});

test("GT0 parser rejects certified fixtures with missing required evidence", () => {
  const fixture = validFixture();
  fixture.calibration.scaleRatio = null;
  fixture.calibration.scaleRatioProvenance = null;
  fixture.completeness.status = "certified";
  fixture.completeness.missingFields = [];
  const result = parseAfcSr1GroundTruthFixtureV1(fixture);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /certified/);
});

test("GT0 parser rejects claimed camera Apply without Apply-safe captured provenance", () => {
  const unsafe = validFixture();
  unsafe.calibration.cameraApplySafe = false;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(unsafe).ok, false);

  const unacceptedProvenance = validFixture();
  unacceptedProvenance.calibration.cameraApplyEvidence.provenance = ["manual_observation"];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(unacceptedProvenance).ok, false);
});

test("Room C keeps historical cross-basis arithmetic non-authoritative beside canonical same-basis seam evidence", () => {
  const result = parseAfcSr1GroundTruthFixtureV1(roomC);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.rawToOriginalPlacement.status, "same_basis");
  assert.equal(result.value.seamRefinement.adjustableCorner, "NR");
  assert.equal(result.value.seamRefinement.side, "right");
  assert.equal(result.value.seamRefinement.seamT, 0.7063703325987577);
  assert.equal(result.value.seamRefinement.perpendicularErrorSourceNormResearchOnly, 0.000360303150254346);
  assert.equal(result.value.uncertifiedReceiptSeamEvidence.status, "cross_basis_unprojected");
  if (result.value.uncertifiedReceiptSeamEvidence.status === "cross_basis_unprojected") {
    assert.equal(result.value.uncertifiedReceiptSeamEvidence.usableAsGroundTruth, false);
    assert.equal(result.value.uncertifiedReceiptSeamEvidence.unprojectedReceiptSeamT, 0.7315669848921734);
    assert.equal(result.value.uncertifiedReceiptSeamEvidence.perpendicularErrorSourceNormResearchOnly, 0.00021654106334196836);
  }
});

test("Room C CP2A raw polygon has a stable canonical SHA-256 identity", async () => {
  const fingerprint = await fingerprintSourceNormalizedPolygon(
    roomC.rawFloor.polygon as unknown as Parameters<typeof fingerprintSourceNormalizedPolygon>[0]
  );
  assert.equal(fingerprint, "13457889890e7ca7a47d6bbf0505117a3e4f86dbd2159b712bb437b626032b5d");
  assert.equal(roomC.rawToOriginalPlacement.sourcePolygonFingerprint, fingerprint);
});

test("parser rejects a stale raw source-polygon fingerprint", () => {
  const stale = validFixture();
  stale.rawToOriginalPlacement.sourcePolygonFingerprint = "0".repeat(64);
  const result = parseAfcSr1GroundTruthFixtureV1(stale);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "raw_polygon_fingerprint_mismatch");
});

test("Room C records ordinary Apply and visual acceptance without misclassifying CP2B", () => {
  const result = parseAfcSr1GroundTruthFixtureV1(roomC);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.calibration.cameraApplyEvidence.status, "ordinary_calibrated_camera_applied");
  assert.equal(result.value.afcAuthorityPathStatus, "not_yet_exercisable");
  assert.equal(result.value.calibration.cameraAppliedSuccessfully, true);
  assert.equal(result.value.manualProcess.visuallyAccepted, true);
  assert.deepEqual(result.value.completeness.missingFields, []);
  assert.equal(result.value.completeness.status, "certified");
});

test("AFC authority-path status validates CP2B separately from empirical certification", () => {
  const falseCp2b = validFixture();
  falseCp2b.afcAuthorityPathStatus = "cp2b_applied";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(falseCp2b).ok, false);

  const contradictoryNotYet = validFixture();
  contradictoryNotYet.calibration.cameraApplyEvidence.status = "afc_bound_cp2b_applied";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(contradictoryNotYet).ok, false);

  const parsedA = parseAfcSr1GroundTruthFixtureV1(roomA);
  const parsedB = parseAfcSr1GroundTruthFixtureV1(roomB);
  assert.equal(parsedA.ok, true);
  assert.equal(parsedB.ok, true);
  if (parsedA.ok && parsedB.ok) {
    assert.equal(parsedA.value.afcAuthorityPathStatus, "not_tested");
    assert.equal(parsedB.value.afcAuthorityPathStatus, "not_tested");
  }
});

test("Room C canonical right seam recomputes from raw NR to raw FR", () => {
  const projection = projectPointOntoNearToFarSeam(
    roomC.rawFloor.polygon[1],
    roomC.rawFloor.polygon[2],
    roomC.acceptedFloor.polygon[1]
  );
  assert.ok(projection);
  assert.ok(Math.abs(projection.t - roomC.seamRefinement.seamT) < 1e-12);
  assert.ok(Math.abs(projection.point.x - 0.5867733554297268) < 1e-12);
  assert.ok(Math.abs(projection.point.y - 0.6759004521498534) < 1e-12);
  assert.ok(Math.abs(projection.perpendicularErrorSourceNorm - 0.000360303150254346) < 1e-15);
});

test("Room C derives scale ratio and reprojection parity through cover-crop camera evaluation", () => {
  const input = {
    polygon: roomC.acceptedFloor.polygon,
    worldWidthMeters: roomC.calibration.worldWidthMeters,
    worldDepthMeters: roomC.calibration.worldDepthMeters,
    verticalFovDeg: roomC.calibration.verticalFovDeg,
    context: roomC.calibration.cameraDiagnosticsContext,
  } as unknown as Parameters<typeof deriveRecordedCameraDiagnostics>[0];
  const derived = deriveRecordedCameraDiagnostics(input);
  assert.ok(derived);
  if (!derived) return;
  assert.ok(Math.abs(derived.scaleRatio - 1.0119014164972706) < 1e-12);
  assert.ok(Math.abs(derived.cvAveragePx - 1.62) <= 0.01);
  assert.ok(Math.abs(derived.cvMaximumPx - 3.28) <= 0.01);
  assert.ok(Math.abs(derived.scaleRatio - (roomC.calibration.scaleRatio ?? Infinity)) < 1e-12);

  const changedFrame = deriveRecordedCameraDiagnostics({
    ...input,
    context: { ...input.context, frameWidth: 1119 },
  });
  assert.ok(changedFrame);
  assert.ok(Math.abs((changedFrame?.cvAveragePx ?? 1.62) - 1.62) > 0.01);

  const uniformlyScaled = deriveRecordedCameraDiagnostics({
    ...input,
    worldWidthMeters: 9.2,
    worldDepthMeters: 8,
  });
  assert.ok(uniformlyScaled);
  assert.ok(Math.abs((uniformlyScaled?.scaleRatio ?? Infinity) - derived.scaleRatio) < 1e-12);
});

test("parser rejects recorded camera diagnostics that fail derivation parity", () => {
  const scaleMismatch = validFixture();
  scaleMismatch.calibration.scaleRatio = 1;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(scaleMismatch).ok, false);

  const averageMismatch = validFixture();
  averageMismatch.calibration.cvAveragePx = 2;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(averageMismatch).ok, false);

  const maximumMismatch = validFixture();
  maximumMismatch.calibration.cvMaximumPx = 4;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(maximumMismatch).ok, false);
});

function nlAdjustedFixture() {
  const fixture = certifiedFixture();
  fixture.acceptedFloor.polygon = structuredClone(fixture.rawFloor.polygon);
  fixture.acceptedFloor.polygon[0] = { x: 0.0482, y: 0.9694 };
  const seamStart = fixture.rawFloor.polygon[0];
  const seamEnd = fixture.rawFloor.polygon[3];
  const acceptedCorner = fixture.acceptedFloor.polygon[0];
  const projection = projectPointOntoNearToFarSeam(seamStart, seamEnd, acceptedCorner);
  assert.ok(projection);
  fixture.seamRefinement = {
    adjustableCorner: "NL",
    side: "left",
    direction: "near_to_far",
    seamStart,
    seamEnd,
    rawCorner: seamStart,
    acceptedCorner,
    seamT: projection.t,
    perpendicularErrorSourceNormResearchOnly: projection.perpendicularErrorSourceNorm,
    collinearWithinTolerance: true,
    toleranceSourceNormResearchOnly: 0.002,
    provenance: "derived_from_recorded_values",
    notes: [],
  };
  fixture.calibration.scaleRatio = null;
  fixture.calibration.scaleRatioProvenance = null;
  fixture.calibration.cameraDiagnosticsContext = null;
  fixture.completeness.status = "partial";
  fixture.completeness.missingFields = ["calibration.scaleRatio"];
  return fixture;
}

test("canonical one-corner refinement preserves every non-adjusted source corner exactly", () => {
  const roomC = validFixture();
  assert.deepEqual(roomC.acceptedFloor.polygon[0], roomC.rawFloor.polygon[0]);
  assert.deepEqual(roomC.acceptedFloor.polygon[2], roomC.rawFloor.polygon[2]);
  assert.deepEqual(roomC.acceptedFloor.polygon[3], roomC.rawFloor.polygon[3]);

  const frUlp = validFixture();
  frUlp.acceptedFloor.polygon[2].x = 0.4149999999999999;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(frUlp).ok, false);

  const nlChanged = validFixture();
  nlChanged.acceptedFloor.polygon[0].x = 0.045000000000000005;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(nlChanged).ok, false);

  const flChanged = validFixture();
  flChanged.acceptedFloor.polygon[3].x = 0.07700000000000001;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(flChanged).ok, false);

  assert.equal(parseAfcSr1GroundTruthFixtureV1(nlAdjustedFixture()).ok, true);
});

test("canonical seam endpoints bind to the raw semantic far corner", () => {
  const arbitraryEnd = validFixture();
  arbitraryEnd.seamRefinement.seamEnd = { x: 0.5, y: 0.65 };
  const arbitraryProjection = projectPointOntoNearToFarSeam(
    arbitraryEnd.seamRefinement.seamStart,
    arbitraryEnd.seamRefinement.seamEnd,
    arbitraryEnd.seamRefinement.acceptedCorner
  );
  assert.ok(arbitraryProjection);
  arbitraryEnd.seamRefinement.seamT = arbitraryProjection.t;
  arbitraryEnd.seamRefinement.perpendicularErrorSourceNormResearchOnly = arbitraryProjection.perpendicularErrorSourceNorm;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(arbitraryEnd).ok, false);

  const rightAtFl = validFixture();
  rightAtFl.seamRefinement.seamEnd = rightAtFl.rawFloor.polygon[3];
  const rightProjection = projectPointOntoNearToFarSeam(
    rightAtFl.seamRefinement.seamStart,
    rightAtFl.seamRefinement.seamEnd,
    rightAtFl.seamRefinement.acceptedCorner
  );
  assert.ok(rightProjection);
  rightAtFl.seamRefinement.seamT = rightProjection.t;
  rightAtFl.seamRefinement.perpendicularErrorSourceNormResearchOnly = rightProjection.perpendicularErrorSourceNorm;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(rightAtFl).ok, false);

  const leftAtFr = nlAdjustedFixture();
  leftAtFr.seamRefinement.seamEnd = leftAtFr.rawFloor.polygon[2];
  const leftProjection = projectPointOntoNearToFarSeam(
    leftAtFr.seamRefinement.seamStart,
    leftAtFr.seamRefinement.seamEnd,
    leftAtFr.seamRefinement.acceptedCorner
  );
  assert.ok(leftProjection);
  leftAtFr.seamRefinement.seamT = leftProjection.t;
  leftAtFr.seamRefinement.perpendicularErrorSourceNormResearchOnly = leftProjection.perpendicularErrorSourceNorm;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(leftAtFr).ok, false);
});

test("cross-basis receipts cannot populate canonical seam evidence or certify by boolean flip", () => {
  const numeric = validFixture();
  numeric.rawFloor.projectedToImageBasis = false;
  numeric.rawFloor.sourceBasisFingerprint = "b7283bb606d09bc7803543bfcbca14aa5f2041cfb91c5eb590d69d167355243f";
  numeric.rawFloor.sourceDecodedWidth = 1264;
  numeric.rawFloor.sourceDecodedHeight = 848;
  numeric.rawToOriginalPlacement = { status: "not_projected" };
  numeric.seamRefinement = {
    adjustableCorner: "NR",
    side: "right",
    direction: "near_to_far",
    seamStart: numeric.rawFloor.polygon[1],
    seamEnd: numeric.rawFloor.polygon[2],
    rawCorner: numeric.rawFloor.polygon[1],
    acceptedCorner: numeric.acceptedFloor.polygon[1],
    seamT: 0.7315669848921734,
    perpendicularErrorSourceNormResearchOnly: 0.00021654106334196836,
    collinearWithinTolerance: true,
    toleranceSourceNormResearchOnly: 0.002,
    provenance: "derived_from_recorded_values",
    notes: [],
  };
  assert.equal(parseAfcSr1GroundTruthFixtureV1(numeric).ok, false);

  const booleanFlip = certifiedFixture();
  booleanFlip.rawToOriginalPlacement = { status: "not_projected" };
  booleanFlip.calibration.cameraApplySafe = true;
  booleanFlip.calibration.cameraAppliedSuccessfully = true;
  booleanFlip.completeness.status = "certified";
  booleanFlip.completeness.missingFields = [];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(booleanFlip).ok, false);
});

test("uncertified seam evidence rejects authority claims and incomplete basis identity", () => {
  const authorityClaim = validFixture();
  authorityClaim.uncertifiedReceiptSeamEvidence.usableAsGroundTruth = true;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(authorityClaim).ok, false);

  const missingEmpty = validFixture();
  missingEmpty.uncertifiedReceiptSeamEvidence.emptyBasisFingerprint = "";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(missingEmpty).ok, false);

  const missingOriginal = validFixture();
  missingOriginal.uncertifiedReceiptSeamEvidence.originalBasisFingerprint = "";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(missingOriginal).ok, false);
});

test("canonical seam evidence requires a matching documented same-basis placement", () => {
  assert.equal(parseAfcSr1GroundTruthFixtureV1(certifiedFixture()).ok, true);

  const mismatch = certifiedFixture();
  mismatch.rawToOriginalPlacement.originalBasisFingerprint = "different-original-basis";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(mismatch).ok, false);

  const rawBasisMismatch = certifiedFixture();
  rawBasisMismatch.rawFloor.sourceBasisFingerprint = "different-original-basis";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(rawBasisMismatch).ok, false);
});

test("completeness requires every computed certification gap", () => {
  const incomplete = validFixture();
  incomplete.calibration.scaleRatio = null;
  incomplete.calibration.scaleRatioProvenance = null;
  incomplete.completeness.status = "partial";
  incomplete.completeness.missingFields = [];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(incomplete).ok, false);
});

test("derived-scale context and empirical Apply evidence are certification requirements", () => {
  const onlyScaleMissing = validFixture();
  onlyScaleMissing.calibration.scaleRatio = null;
  onlyScaleMissing.calibration.scaleRatioProvenance = null;
  onlyScaleMissing.completeness.status = "partial";
  onlyScaleMissing.completeness.missingFields = ["calibration.scaleRatio"];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(onlyScaleMissing).ok, true);

  const missingContext = validFixture();
  missingContext.calibration.cameraDiagnosticsContext = null;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(missingContext).ok, false);

  const missingOrdinaryApply = validFixture();
  missingOrdinaryApply.calibration.cameraAppliedSuccessfully = false;
  missingOrdinaryApply.calibration.cameraApplyEvidence.status = "not_applied";
  missingOrdinaryApply.afcAuthorityPathStatus = "not_tested";
  assert.equal(parseAfcSr1GroundTruthFixtureV1(missingOrdinaryApply).ok, false);
});

test("CV diagnostics are explicit empirical certification requirements", () => {
  const missingAverage = validFixture();
  missingAverage.calibration.cvAveragePx = null;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(missingAverage).ok, false);

  const missingMaximum = validFixture();
  missingMaximum.calibration.cvMaximumPx = null;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(missingMaximum).ok, false);

  const partialMissingCv = validFixture();
  partialMissingCv.calibration.cvAveragePx = null;
  partialMissingCv.completeness.status = "partial";
  partialMissingCv.completeness.missingFields = ["calibration.cvDiagnostics"];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(partialMissingCv).ok, true);
});

test("GT0 source-coordinate extent accepts valid off-frame points and rejects out-of-extent geometry", async () => {
  const withinExtent = validFixture();
  withinExtent.rawFloor.polygon[0].x = -0.1;
  withinExtent.acceptedFloor.polygon[0].x = -0.1;
  withinExtent.rawToOriginalPlacement.sourcePolygonFingerprint = await fingerprintSourceNormalizedPolygon(
    withinExtent.rawFloor.polygon as Parameters<typeof fingerprintSourceNormalizedPolygon>[0]
  );
  withinExtent.calibration.scaleRatio = null;
  withinExtent.calibration.scaleRatioProvenance = null;
  withinExtent.calibration.cameraDiagnosticsContext = null;
  withinExtent.completeness.status = "partial";
  withinExtent.completeness.missingFields = ["calibration.scaleRatio"];
  assert.equal(parseAfcSr1GroundTruthFixtureV1(withinExtent).ok, true);

  const xTooLow = validFixture();
  xTooLow.rawFloor.polygon[0].x = -0.3;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(xTooLow).ok, false);

  const yTooHigh = validFixture();
  yTooHigh.uncertifiedReceiptSeamEvidence.seamEndOnEmptyBasis.y = 1.3;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(yTooHigh).ok, false);
});

test("GT0 parser rejects unknown top-level and nested keys", () => {
  const extraTopLevel = validFixture();
  extraTopLevel.unexpected = true;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(extraTopLevel).ok, false);

  const extraNested = validFixture();
  extraNested.rawFloor.unexpected = true;
  assert.equal(parseAfcSr1GroundTruthFixtureV1(extraNested).ok, false);
});

test("seam helpers retain explicit right and left near-to-far endpoint ordering", () => {
  const rightStart = { x: 0.8, y: 0.8 }; // raw NR
  const rightEnd = { x: 0.6, y: 0.4 }; // raw FR
  const leftStart = { x: 0.2, y: 0.8 }; // raw NL
  const leftEnd = { x: 0.4, y: 0.4 }; // raw FL
  assert.deepEqual(pointOnNearToFarSeam(rightStart, rightEnd, 0), rightStart);
  assert.deepEqual(pointOnNearToFarSeam(rightStart, rightEnd, 1), rightEnd);
  assert.deepEqual(pointOnNearToFarSeam(leftStart, leftEnd, 0), leftStart);
  assert.deepEqual(pointOnNearToFarSeam(leftStart, leftEnd, 1), leftEnd);
});

test("seam projection derives unclamped t and perpendicular source-normalized error", () => {
  const start = { x: 0, y: 0 };
  const end = { x: 2, y: 0 };
  const midpoint = projectPointOntoNearToFarSeam(start, end, { x: 1, y: 0 });
  assert.deepEqual(midpoint, { t: 0.5, point: { x: 1, y: 0 }, perpendicularErrorSourceNorm: 0 });

  const offset = projectPointOntoNearToFarSeam(start, end, { x: 0.5, y: 0.25 });
  assert.deepEqual(offset, { t: 0.25, point: { x: 0.5, y: 0 }, perpendicularErrorSourceNorm: 0.25 });
  assert.equal(isCollinearWithinSourceNormTolerance(start, end, { x: 0.5, y: 0.25 }, 0.25), true);

  const offFrame = projectPointOntoNearToFarSeam({ x: -0.2, y: 1.1 }, { x: 1.2, y: -0.1 }, { x: 1.55, y: -0.4 });
  assert.ok(offFrame && offFrame.t > 1, "off-frame projection remains valid and unclamped");
  assert.deepEqual(pointOnNearToFarSeam(start, end, 1.5), { x: 3, y: 0 });
});

test("degenerate seams fail closed", () => {
  const point = { x: 0.4, y: 0.6 };
  assert.equal(projectPointOntoNearToFarSeam(point, point, point), null);
  assert.equal(pointOnNearToFarSeam(point, point, 0), null);
  assert.equal(isCollinearWithinSourceNormTolerance(point, point, point, 0), null);
});

test("Room fixtures preserve their evidence boundaries", () => {
  const parsedA = parseAfcSr1GroundTruthFixtureV1(roomA);
  const parsedB = parseAfcSr1GroundTruthFixtureV1(roomB);
  const parsedC = parseAfcSr1GroundTruthFixtureV1(roomC);
  assert.equal(parsedA.ok, true);
  assert.equal(parsedB.ok, true);
  assert.equal(parsedC.ok, true);
  if (!parsedA.ok || !parsedB.ok || !parsedC.ok) return;

  assert.equal(parsedC.value.calibration.worldWidthMeters, 4.6);
  assert.equal(parsedC.value.calibration.worldDepthMeters, 4);
  assert.equal(parsedC.value.calibration.widthDepthRatio, 1.15);
  assert.ok(Math.abs((parsedC.value.calibration.depthWidthAspect ?? 0) - 0.8695652173913043) < 1e-12);
  assert.equal(parsedC.value.calibration.verticalFovDeg, 79);
  assert.equal(parsedC.value.calibration.cvAveragePx, 1.62);
  assert.equal(parsedC.value.calibration.cvMaximumPx, 3.28);
  assert.equal(parsedC.value.calibration.displayAveragePx, 1.62);
  assert.equal(parsedC.value.calibration.displayMaximumPx, 3.28);
  assert.equal(parsedC.value.calibration.scaleRatio, 1.0119014164972706);
  assert.equal(parsedC.value.calibration.scaleRatioProvenance, "derived_from_recorded_values");
  assert.equal(parsedC.value.calibration.cameraApplyEvidence.status, "ordinary_calibrated_camera_applied");
  assert.equal(parsedC.value.calibration.cameraAppliedSuccessfully, true);
  assert.equal(parsedC.value.rawFloor.provenance, "scene_state_export");
  assert.equal(parsedC.value.acceptedFloor.provenance, "scene_state_export");
  assert.equal(parsedC.value.rawFloor.source, "empty_receipt");
  assert.equal(parsedC.value.rawFloor.requestId, "afc-r3c.c4ef8721-5dca-4d4f-b26f-ab5510481245.empty");
  assert.equal(parsedC.value.seamRefinement.adjustableCorner, "NR");
  assert.equal(parsedC.value.uncertifiedReceiptSeamEvidence.status, "cross_basis_unprojected");
  assert.equal(parsedC.value.completeness.status, "certified");
  assert.deepEqual(parsedC.value.completeness.missingFields, []);
  assert.equal(parsedA.value.seamRefinement.adjustableCorner, "unknown");
  assert.equal(parsedB.value.seamRefinement.adjustableCorner, "unknown");

  for (const fixture of [parsedA.value, parsedB.value]) {
    assert.notEqual(fixture.calibration.cameraAppliedSuccessfully, true);
  }
});
