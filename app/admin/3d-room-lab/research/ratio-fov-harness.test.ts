import assert from "node:assert/strict";
import test from "node:test";

import roomA from "./fixtures/room-a-floor-control.json";
import roomB from "./fixtures/room-b-floor-control.json";
import roomC from "./fixtures/room-c-floor-control.json";
import {
  classifyRatioFovBasin,
  componentRefinementRegions,
  competitiveCoarseComponentsCoveredByRegions,
  evaluateRatioFovCell,
  gridAwareComponents,
  mergeRefinementRegions,
  normalizedCenteredColumnOrthogonality,
  ratioFovInputFingerprint,
  refinementRegions,
  refinementRegionsOverlapOrTouch,
  runRatioFovExperiment,
  strictRefinedCellsByCoarseCoverage,
  type RatioFovClassificationSignals,
  type RatioFovEnvelope,
  type RatioFovExperimentInput,
  type RatioFovExperimentSuccess,
  type RatioFovFailureCode,
  type RatioFovRefinementRegion,
  type RatioFovSuccessfulCell,
} from "./ratio-fov-harness";

type ControlFixture = typeof roomA;

function inputFor(fixture: ControlFixture, perturbation = false): RatioFovExperimentInput {
  const clone = structuredClone(fixture);
  assert.deepEqual(clone.semanticOrder, ["NL", "NR", "FR", "FL"]);
  assert.equal(clone.sourceFloorPolygon.length, 4);
  assert.equal(clone.imageBasis.basisKind, "original");
  assert.equal(clone.coordinateSpace, "source-normalized/v1");
  const [nl, nr, fr, fl] = clone.sourceFloorPolygon;
  return {
    contractVersion: "ratio-fov-harness/v1",
    fixtureId: clone.fixtureId,
    imageBasis: {
      basisId: clone.imageBasis.basisId,
      basisFingerprint: clone.imageBasis.basisFingerprint,
      decodedWidth: clone.imageBasis.decodedWidth,
      decodedHeight: clone.imageBasis.decodedHeight,
      coordinateSpaceVersion: {
        decoderId: clone.imageBasis.coordinateSpaceVersion.decoderId,
        normalizationPolicyVersion: clone.imageBasis.coordinateSpaceVersion.normalizationPolicyVersion,
        orientationApplied: clone.imageBasis.coordinateSpaceVersion.orientationApplied,
      },
      basisKind: "original",
    },
    frameSize: { ...clone.frameSize },
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon: [
      { x: nl.x, y: nl.y },
      { x: nr.x, y: nr.y },
      { x: fr.x, y: fr.y },
      { x: fl.x, y: fl.y },
    ],
    ratioDomain: { min: 0.5, max: 2, step: 0.05 },
    fovDomain: { minDeg: 20, maxDeg: 90, stepDeg: 1 },
    referenceDepth: 1,
    ...(perturbation ? { perturbation: { enabled: true } } : {}),
  };
}

function expectedRegime(fixture: ControlFixture) {
  switch (fixture.expectedIdentifiabilityRegime) {
    case "isolated_optimum":
    case "degenerate_valley":
      return fixture.expectedIdentifiabilityRegime;
    default:
      assert.fail(`Unsupported fixture regime: ${fixture.expectedIdentifiabilityRegime}`);
  }
}

function expectedFramePoint(fixture: ControlFixture, index: number) {
  const point = fixture.sourceFloorPolygon[index];
  const scale = Math.max(fixture.frameSize.width / fixture.imageBasis.decodedWidth, fixture.frameSize.height / fixture.imageBasis.decodedHeight);
  return {
    x: point.x * fixture.imageBasis.decodedWidth * scale + (fixture.frameSize.width - fixture.imageBasis.decodedWidth * scale) / 2,
    y: point.y * fixture.imageBasis.decodedHeight * scale + (fixture.frameSize.height - fixture.imageBasis.decodedHeight * scale) / 2,
  };
}

function success(input: RatioFovExperimentInput): RatioFovExperimentSuccess {
  const result = runRatioFovExperiment(input);
  if (result.status === "failure") assert.fail(result.message);
  return result;
}

function successfulCell(
  result: RatioFovExperimentSuccess,
  ratio: number,
  fovDeg: number,
  referenceDepth = 1
): RatioFovSuccessfulCell {
  const cell = evaluateRatioFovCell({
    frameSize: result.inputSummary.frameSize,
    frameFloorPolygonPx: result.frameFloorPolygonPx,
    ratio,
    fovDeg,
    referenceDepth,
  });
  if (cell.status === "failure") assert.fail(cell.failureReason);
  return cell;
}

function near(actual: number, expected: number, tolerance: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `Expected ${actual} within ${tolerance} of ${expected}.`);
}

function magnitude(value: { x: number; y: number; z: number }): number {
  return Math.hypot(value.x, value.y, value.z);
}

test("Room A retains its manual diagnostics but reports a non-authoritative degenerate valley", () => {
  const result = success(inputFor(roomA));
  const manual = successfulCell(result, roomA.manualControl.ratio, roomA.manualControl.fovDeg);
  near(manual.cvAvgPx, roomA.manualControl.diagnosticsReference.cvAvgPx, 0.02);
  near(manual.cvMaxPx, roomA.manualControl.diagnosticsReference.cvMaxPx, 0.02);
  assert.equal(result.basin.classification, "degenerate_valley");
  assert.equal(result.basin.classification, expectedRegime(roomA));
  assert.equal(result.ranking.isolatedResearchRecommendation, null);
  assert.ok((result.basin.extendedValleyEnvelope10x.ratioWidth ?? 0) >= 0.75);
  assert.ok((result.basin.extendedValleyEnvelope10x.fovWidthDeg ?? 0) >= 30);
  assert.ok((result.basin.extendedValleyEnvelope10x.correlation ?? 0) > 0.99);
  assert.equal(result.basin.extendedValleyEnvelope10x.componentCount, 1);
  assert.ok((result.basin.extendedValleyEnvelope10x.fittedFovPerRatio ?? 0) > 20, "extended surface retains a diagonal ratio/FOV trend");
  assert.equal(result.closedForm.classificationHint, "weakly_conditioned");
  assert.ok((result.closedForm.orthogonalityObservabilityNormalized ?? Infinity) < 0.8);
  assert.equal(result.basin.classificationSignals.weakClosedFormObservability, true);
  assert.equal(result.basin.classificationSignals.broadExtendedValley, true);
  assert.equal(result.basin.classificationSignals.strongValleyCorrelation, true);
  assert.deepEqual(result.safety, {
    applied: false,
    authoritative: false,
    persisted: false,
    activeCameraUnchanged: true,
  });
});

test("Room B recovers its control and an isolated refined optimum with available gates", () => {
  const result = success(inputFor(roomB));
  const manual = successfulCell(result, roomB.manualControl.ratio, roomB.manualControl.fovDeg);
  near(manual.cvAvgPx, roomB.manualControl.diagnosticsReference.cvAvgPx, 0.03);
  near(manual.cvMaxPx, roomB.manualControl.diagnosticsReference.cvMaxPx, 0.03);
  const best = result.ranking.globallyRankedBest;
  assert.ok(best);
  near(best.ratio, 1.19, 0.01);
  near(best.fovDeg, 58.4, 0.15);
  assert.equal(result.basin.classification, "isolated_optimum");
  assert.equal(result.basin.classification, expectedRegime(roomB));
  assert.equal(result.ranking.isolatedResearchRecommendation?.ratio, best.ratio);
  assert.equal(best.applyObservability.available, true);
  assert.equal(best.applyObservability.firstFailingGate, "none");
  near(result.closedForm.selectedClosedFormGridRatio ?? 0, 1.2, 0.001);
  near(result.closedForm.estimatedVerticalFovDeg ?? 0, 58.4, 0.2);
  assert.ok(
    (result.basin.extendedValleyEnvelope10x.ratioWidth ?? Infinity) <
      (success(inputFor(roomA)).basin.extendedValleyEnvelope10x.ratioWidth ?? 0)
  );
});

test("Room C preserves its unusual semantic order and recovers an isolated optimum", () => {
  const result = success(inputFor(roomC));
  const manual = successfulCell(result, roomC.manualControl.ratio, roomC.manualControl.fovDeg);
  near(manual.cvAvgPx, roomC.manualControl.diagnosticsReference.cvAvgPx, 0.02);
  near(manual.cvMaxPx, roomC.manualControl.diagnosticsReference.cvMaxPx, 0.02);
  assert.equal(result.inputSummary.semanticOrder[0], "NL");
  assert.equal(result.inputSummary.semanticOrder[1], "NR");
  assert.ok(result.frameFloorPolygonPx[1].y < result.frameFloorPolygonPx[3].y, "NR remains above FL in screen space");
  const best = result.ranking.globallyRankedBest;
  assert.ok(best);
  near(best.ratio, 1.195, 0.01);
  near(best.fovDeg, 79, 0.15);
  assert.equal(result.basin.classification, "isolated_optimum");
  assert.equal(result.basin.classification, expectedRegime(roomC));
  near(result.closedForm.selectedClosedFormGridRatio ?? 0, 1.2, 0.001);
  near(result.closedForm.estimatedVerticalFovDeg ?? 0, 79, 0.2);
  assert.ok(result.basin.failureSummary.totalFailedCellCount > 0);
  assert.ok(result.basin.failureSummary.fovValuesWithAnyFailure.includes(20));
  assert.ok(result.basin.failureSummary.fovValuesWithAnyFailure.includes(90));
});

test("intrinsic-pixel perturbations separate Room A instability from stable Rooms B and C", () => {
  const a = success(inputFor(roomA, true));
  const b = success(inputFor(roomB, true));
  const c = success(inputFor(roomC, true));
  assert.equal(a.basin.classification, "degenerate_valley");
  assert.equal(a.perturbation?.enabled, true);
  assert.ok((a.perturbation?.maximumRatioDrift ?? 0) > 0.1);
  assert.ok((a.perturbation?.maximumFovDriftDeg ?? 0) > 5);
  assert.equal(a.perturbation?.failedRunCount, 0);
  assert.equal(a.perturbation?.scaleSignChangeCount, 0);
  assert.equal(a.perturbation?.gateChangeCount, 0);
  assert.equal(a.basin.classificationSignals.perturbationInstability, false);
  assert.equal(a.perturbation?.samples.length, 16);
  assert.deepEqual(
    a.perturbation?.samples.map((sample) => `${sample.corner}:${sample.axis}:${sample.deltaIntrinsicPx}`),
    [
      "NL:x:1", "NL:x:-1", "NL:y:1", "NL:y:-1",
      "NR:x:1", "NR:x:-1", "NR:y:1", "NR:y:-1",
      "FR:x:1", "FR:x:-1", "FR:y:1", "FR:y:-1",
      "FL:x:1", "FL:x:-1", "FL:y:1", "FL:y:-1",
    ]
  );

  for (const stable of [b, c]) {
    assert.equal(stable.perturbation?.enabled, true);
    assert.ok((stable.perturbation?.maximumRatioDrift ?? Infinity) <= 0.025);
    assert.ok((stable.perturbation?.maximumFovDriftDeg ?? Infinity) <= 0.5);
    assert.equal(stable.perturbation?.failedRunCount, 0);
    assert.equal(stable.perturbation?.scaleSignChangeCount, 0);
    assert.equal(stable.perturbation?.gateChangeCount, 0);
  }
  console.log(
    `Perturbation drift: A=${a.perturbation?.maximumRatioDrift?.toFixed(3)}/${a.perturbation?.maximumFovDriftDeg?.toFixed(1)}° ` +
      `B=${b.perturbation?.maximumRatioDrift?.toFixed(3)}/${b.perturbation?.maximumFovDriftDeg?.toFixed(1)}° ` +
      `C=${c.perturbation?.maximumRatioDrift?.toFixed(3)}/${c.perturbation?.maximumFovDriftDeg?.toFixed(1)}°`
  );
});

test("ratio is independent of metric scale while translation scales linearly", () => {
  const result = success(inputFor(roomB));
  for (const [ratio, fov, scales] of [
    [1, 58, [1, 2, 4, 10]],
    [1.2, 58, [1, 2, 4, 10]],
  ] as const) {
    const base = successfulCell(result, ratio, fov, scales[0]);
    for (const scale of scales.slice(1)) {
      const candidate = successfulCell(result, ratio, fov, scale);
      near(candidate.cvAvgPx, base.cvAvgPx, 1e-9);
      near(candidate.cvMaxPx, base.cvMaxPx, 1e-9);
      candidate.perCornerCvReprojectionPx.forEach((value, index) => near(value, base.perCornerCvReprojectionPx[index], 1e-9));
      near(candidate.columnScaleRatio, base.columnScaleRatio, 1e-12);
      near(candidate.normalizedLookDirection.x, base.normalizedLookDirection.x, 1e-12);
      near(candidate.normalizedLookDirection.y, base.normalizedLookDirection.y, 1e-12);
      near(candidate.normalizedLookDirection.z, base.normalizedLookDirection.z, 1e-12);
      near(candidate.up.x, base.up.x, 1e-12);
      near(candidate.up.y, base.up.y, 1e-12);
      near(candidate.up.z, base.up.z, 1e-12);
      assert.equal(candidate.selectedScaleSign, base.selectedScaleSign);
      assert.equal(candidate.candidatesPassingCheirality, base.candidatesPassingCheirality);
      near(magnitude(candidate.position) / magnitude(base.position), scale, 1e-10);
      near(candidate.cameraHeight / base.cameraHeight, scale, 1e-10);
      near(candidate.cameraHeightOverReferenceDepth / base.cameraHeightOverReferenceDepth, 1, 1e-12);
    }
  }
});

test("fixtures independently reproduce the one-time centered object-cover frame conversion", () => {
  for (const fixture of [roomA, roomB, roomC]) {
    const result = success(inputFor(fixture));
    fixture.sourceFloorPolygon.forEach((_, index) => {
      const expected = expectedFramePoint(fixture, index);
      near(result.frameFloorPolygonPx[index].x, expected.x, 1e-10);
      near(result.frameFloorPolygonPx[index].y, expected.y, 1e-10);
    });
  }
});

test("coarse search retains the complete deterministic default grid and separate refinement", () => {
  const result = success(inputFor(roomB));
  const cells = result.coarseSearch.cells;
  assert.equal(cells.length, 2201);
  assert.equal(cells[0].ratio, 0.5);
  assert.equal(cells[0].fovDeg, 20);
  assert.equal(cells.at(-1)?.ratio, 2);
  assert.equal(cells.at(-1)?.fovDeg, 90);
  for (let index = 1; index < cells.length; index += 1) {
    assert.ok(cells[index].ratio > cells[index - 1].ratio || (cells[index].ratio === cells[index - 1].ratio && cells[index].fovDeg > cells[index - 1].fovDeg));
  }
  assert.ok(result.refinement.cells.length > 0);
  assert.ok(result.refinement.regions.length > 0);
  assert.equal(result.basin.strictCompetitiveEnvelope.gridSource, "refined");
  assert.equal(result.basin.extendedValleyEnvelope10x.gridSource, "coarse");
});

test("normalized centered-column observability is dimensionless and scale invariant", () => {
  const h = [2, 3, 5, 7, 11, 13, 0.01, -0.02, 1];
  const frame = { width: 1118, height: 698 };
  const base = normalizedCenteredColumnOrthogonality(h, frame);
  const homographyScaled = normalizedCenteredColumnOrthogonality(h.map((value) => value * 17), frame);
  const uniformWorldScaleEquivalent = normalizedCenteredColumnOrthogonality(h.map((value) => value / 4), frame);
  assert.ok(base !== null && homographyScaled !== null && uniformWorldScaleEquivalent !== null);
  near(homographyScaled, base, 1e-12);
  near(uniformWorldScaleEquivalent, base, 1e-12);

  const a = success(inputFor(roomA)).closedForm.orthogonalityObservabilityNormalized;
  const b = success(inputFor(roomB)).closedForm.orthogonalityObservabilityNormalized;
  const c = success(inputFor(roomC)).closedForm.orthogonalityObservabilityNormalized;
  assert.ok((a ?? Infinity) < 0.5);
  assert.ok((b ?? 0) > 0.95);
  assert.ok((c ?? 0) > 0.95);
});

test("all primary basin classifications are reachable through pure summaries", () => {
  const envelope = (cellCount: number, componentCount = 1): RatioFovEnvelope => ({
    label: "strict",
    gridSource: "coarse",
    cellCount,
    ratioSpan: cellCount ? [1, 1.1] : null,
    fovSpanDeg: cellCount ? [58, 60] : null,
    ratioWidth: cellCount ? 0.1 : null,
    fovWidthDeg: cellCount ? 2 : null,
    correlation: cellCount ? 0.99 : null,
    fittedFovPerRatio: cellCount ? 20 : null,
    componentCount,
    confidenceComposition: { high: cellCount, low: 0 },
    scaleSignBranches: [-1],
  });
  const signals = (overrides: Partial<RatioFovClassificationSignals> = {}): RatioFovClassificationSignals => ({
    weakClosedFormObservability: false,
    observabilityUnavailable: false,
    broadExtendedValley: false,
    strongValleyCorrelation: false,
    multipleDisconnectedBasins: false,
    scaleSignDiscontinuity: false,
    perturbationInstability: false,
    gateInstability: false,
    nestedClassificationInstability: false,
    refinementCoverageIncomplete: false,
    ...overrides,
  });
  assert.equal(classifyRatioFovBasin(envelope(0), signals()), "no_valid_solution");
  assert.equal(classifyRatioFovBasin(envelope(0), signals({ perturbationInstability: true })), "no_valid_solution");
  assert.equal(classifyRatioFovBasin(envelope(1), signals({ perturbationInstability: true })), "unstable_branch");
  assert.equal(
    classifyRatioFovBasin(envelope(1), signals({ perturbationInstability: true, multipleDisconnectedBasins: true })),
    "unstable_branch"
  );
  assert.equal(classifyRatioFovBasin(envelope(1), signals({ multipleDisconnectedBasins: true })), "multiple_competing_basins");
  assert.equal(
    classifyRatioFovBasin(envelope(1), signals({ weakClosedFormObservability: true, broadExtendedValley: true })),
    "degenerate_valley"
  );
  assert.equal(classifyRatioFovBasin(envelope(1), signals({ weakClosedFormObservability: true })), "isolated_optimum");
  assert.equal(classifyRatioFovBasin(envelope(1), signals({ observabilityUnavailable: true })), "degenerate_valley");
  assert.equal(
    classifyRatioFovBasin(envelope(1), signals({ observabilityUnavailable: true, perturbationInstability: true })),
    "unstable_branch"
  );
  assert.equal(
    classifyRatioFovBasin(envelope(1), signals({ observabilityUnavailable: true, multipleDisconnectedBasins: true })),
    "multiple_competing_basins"
  );
  assert.equal(classifyRatioFovBasin(envelope(1), signals({ refinementCoverageIncomplete: true })), "unstable_branch");
  assert.equal(classifyRatioFovBasin(envelope(1), signals()), "isolated_optimum");
});

test("unavailable closed-form observability fails closed without a recommendation", () => {
  const input: RatioFovExperimentInput = {
    ...inputFor(roomC),
    ratioDomain: { min: 0.5, max: 0.6, step: 0.05 },
  };
  const result = success(input);
  assert.equal(result.closedForm.orthogonalityObservabilityNormalized, null);
  assert.equal(result.closedForm.selectedClosedFormGridRatio, null);
  assert.equal(result.closedForm.classificationHint, "degenerate");
  assert.ok(result.closedForm.numericalWarnings.length > 0);
  assert.equal(result.basin.classificationSignals.observabilityUnavailable, true);
  assert.notEqual(result.basin.classification, "isolated_optimum");
  assert.equal(result.ranking.isolatedResearchRecommendation, null);
  assert.equal("authority" in result, false);
  assert.equal("apply" in result, false);
  assert.deepEqual(result.safety, {
    applied: false,
    authoritative: false,
    persisted: false,
    activeCameraUnchanged: true,
  });
});

test("refinement-region merge is symmetric, transitive, clipped, and order independent", () => {
  const region = (ratio: readonly [number, number], fovDeg: readonly [number, number]): RatioFovRefinementRegion => ({ ratio, fovDeg });
  const overlapLeft = region([1, 1.1], [20, 30]);
  const overlapRight = region([1.05, 1.2], [29, 40]);
  assert.equal(refinementRegionsOverlapOrTouch(overlapLeft, overlapRight, 0.05, 1), true);
  assert.equal(refinementRegionsOverlapOrTouch(overlapRight, overlapLeft, 0.05, 1), true);
  assert.deepEqual(mergeRefinementRegions([overlapLeft, overlapRight], 0.05, 1), [{ ratio: [1, 1.2], fovDeg: [20, 40] }]);

  const transitive = [
    region([0.5, 0.6], [20, 25]),
    region([0.65, 0.75], [25, 30]),
    region([0.8, 0.9], [30, 35]),
  ];
  const forward = mergeRefinementRegions(transitive, 0.05, 1);
  const reverse = mergeRefinementRegions([...transitive].reverse(), 0.05, 1);
  const shuffled = mergeRefinementRegions([transitive[1], transitive[2], transitive[0]], 0.05, 1);
  assert.deepEqual(forward, [{ ratio: [0.5, 0.9], fovDeg: [20, 35] }]);
  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
  assert.equal(JSON.stringify(forward), JSON.stringify(shuffled));

  const disjoint = mergeRefinementRegions([region([0.5, 0.6], [20, 25]), region([1.4, 1.5], [70, 75])], 0.05, 1);
  assert.equal(disjoint.length, 2);
});

test("refinement regions retain both Opus counterexample basins and cover competitive components", () => {
  const result = success(inputFor(roomB));
  const base = successfulCell(result, 1.2, 58);
  const first: RatioFovSuccessfulCell = { ...base, ratio: 1.2, fovDeg: 62 };
  const second: RatioFovSuccessfulCell = { ...base, ratio: 1.25, fovDeg: 26 };
  const components = [[first], [second]];
  const input = inputFor(roomB);
  const regions = refinementRegions(components, input);
  assert.equal(regions.length, 2);
  assert.ok(regions.some((region) => region.fovDeg[0] <= 26 && region.fovDeg[1] >= 26));
  assert.ok(regions.some((region) => region.fovDeg[0] <= 62 && region.fovDeg[1] >= 62));
  assert.equal(competitiveCoarseComponentsCoveredByRegions(components, regions), true);
  assert.ok(regions.every((region) => region.ratio[0] >= input.ratioDomain.min && region.ratio[1] <= input.ratioDomain.max));
  assert.ok(regions.every((region) => region.fovDeg[0] >= input.fovDomain.minDeg && region.fovDeg[1] <= input.fovDomain.maxDeg));

  const coverageRegions = componentRefinementRegions(components, input);
  const strictByCoverage = strictRefinedCellsByCoarseCoverage(
    [
      { ...first, cvAvgPx: 0.1 },
      // This is globally much worse than the first refined minimum, but it
      // belongs to the independently competitive lower-FOV coarse basin.
      { ...second, cvAvgPx: 0.9 },
    ],
    components,
    coverageRegions,
    { basinFactor: 1.25, additivePxAllowance: 0.25 }
  );
  assert.equal(strictByCoverage.length, 2);
  assert.ok(strictByCoverage.some((cell) => cell.fovDeg === 26));
  assert.ok(strictByCoverage.some((cell) => cell.fovDeg === 62));

  const clipped = refinementRegions(
    [
      [{ ...base, ratio: input.ratioDomain.min, fovDeg: input.fovDomain.minDeg }],
      [{ ...base, ratio: input.ratioDomain.max, fovDeg: input.fovDomain.maxDeg }],
    ],
    input
  );
  assert.deepEqual(clipped, [
    { ratio: [input.ratioDomain.min, input.ratioDomain.min + input.ratioDomain.step], fovDeg: [input.fovDomain.minDeg, input.fovDomain.minDeg + input.fovDomain.stepDeg] },
    { ratio: [input.ratioDomain.max - input.ratioDomain.step, input.ratioDomain.max], fovDeg: [input.fovDomain.maxDeg - input.fovDomain.stepDeg, input.fovDomain.maxDeg] },
  ]);

  const strictEnvelope: RatioFovEnvelope = {
    label: "strict",
    gridSource: "refined",
    cellCount: strictByCoverage.length,
    ratioSpan: [1.2, 1.25],
    fovSpanDeg: [26, 62],
    ratioWidth: 0.05,
    fovWidthDeg: 36,
    correlation: 0,
    fittedFovPerRatio: 0,
    componentCount: gridAwareComponents(strictByCoverage, input.ratioDomain.step, input.fovDomain.stepDeg).length,
    confidenceComposition: { high: 2, low: 0 },
    scaleSignBranches: [-1],
  };
  assert.equal(
    classifyRatioFovBasin(strictEnvelope, {
      weakClosedFormObservability: false,
      observabilityUnavailable: false,
      broadExtendedValley: false,
      strongValleyCorrelation: false,
      multipleDisconnectedBasins: strictEnvelope.componentCount > 1,
      scaleSignDiscontinuity: false,
      perturbationInstability: false,
      gateInstability: false,
      nestedClassificationInstability: false,
      refinementCoverageIncomplete: false,
    }),
    "multiple_competing_basins"
  );
});

test("grid-aware connectivity preserves a sloped ridge and separates islands", () => {
  const result = success(inputFor(roomB));
  const base = successfulCell(result, 1.2, 58);
  const cell = (ratio: number, fovDeg: number): RatioFovSuccessfulCell => ({ ...base, ratio, fovDeg });
  const slopedCoarse = [cell(1, 50), cell(1.05, 54), cell(1.1, 58)];
  assert.equal(gridAwareComponents(slopedCoarse, 0.05, 1).length, 1);
  const islands = [...slopedCoarse, cell(1.6, 80), cell(1.65, 84)];
  assert.equal(gridAwareComponents(islands, 0.05, 1).length, 2);
  const slopedRefined = [cell(1, 50), cell(1.005, 50.4), cell(1.01, 50.8)];
  assert.equal(gridAwareComponents(slopedRefined, 0.005, 0.1).length, 1);
});

test("fingerprints cover material research inputs", () => {
  const base = inputFor(roomB);
  const fingerprint = ratioFovInputFingerprint(base);
  assert.equal(fingerprint, ratioFovInputFingerprint(structuredClone(base)));
  assert.notEqual(fingerprint, ratioFovInputFingerprint({ ...base, perturbation: { enabled: true } }));
  assert.notEqual(fingerprint, ratioFovInputFingerprint({ ...base, imageBasis: { ...base.imageBasis, basisId: "changed" } }));
  assert.notEqual(
    fingerprint,
    ratioFovInputFingerprint({
      ...base,
      imageBasis: {
        ...base.imageBasis,
        coordinateSpaceVersion: { ...base.imageBasis.coordinateSpaceVersion, decoderId: "other-decoder" },
      },
    })
  );
  assert.notEqual(
    fingerprint,
    ratioFovInputFingerprint({
      ...base,
      sourceFloorPolygon: [{ ...base.sourceFloorPolygon[0], x: base.sourceFloorPolygon[0].x + 1e-12 }, ...base.sourceFloorPolygon.slice(1)] as [
        typeof base.sourceFloorPolygon[0],
        typeof base.sourceFloorPolygon[1],
        typeof base.sourceFloorPolygon[2],
        typeof base.sourceFloorPolygon[3],
      ],
    })
  );
});

test("Apply observability can fail a policy gate without invoking Apply", () => {
  const result = success(inputFor(roomB));
  const standalone = evaluateRatioFovCell({
    frameSize: result.inputSummary.frameSize,
    frameFloorPolygonPx: result.frameFloorPolygonPx,
    ratio: 1.2,
    fovDeg: 58,
    referenceDepth: 1,
    researchBasisQualified: false,
  });
  assert.equal(standalone.status, "success");
  if (standalone.status === "success") {
    assert.equal(standalone.applyObservability.available, false);
    assert.equal(standalone.applyObservability.firstFailingGate, "basis");
  }
});

test("invalid research inputs fail before a grid is returned", () => {
  const base = inputFor(roomB);
  const invalid: readonly [string, object, RatioFovFailureCode][] = [
    ["bow tie", { ...base, sourceFloorPolygon: [base.sourceFloorPolygon[0], base.sourceFloorPolygon[2], base.sourceFloorPolygon[1], base.sourceFloorPolygon[3]] }, "floor_polygon"],
    ["duplicate", { ...base, sourceFloorPolygon: [base.sourceFloorPolygon[0], base.sourceFloorPolygon[0], base.sourceFloorPolygon[2], base.sourceFloorPolygon[3]] }, "floor_polygon"],
    [
      "non-finite",
      {
        ...base,
        sourceFloorPolygon: [
          { x: Number.NaN, y: 0 },
          base.sourceFloorPolygon[1],
          base.sourceFloorPolygon[2],
          base.sourceFloorPolygon[3],
        ],
      }, "floor_polygon",
    ],
    ["semantic order", { ...base, semanticOrder: ["NR", "NL", "FR", "FL"] }, "semantic_order"],
    ["coordinate space", { ...base, coordinateSpace: "container-normalized/v1" }, "coordinate_space"],
    ["low FOV", { ...base, fovDomain: { ...base.fovDomain, minDeg: 19 } }, "fov_domain"],
    ["high FOV", { ...base, fovDomain: { ...base.fovDomain, maxDeg: 91 } }, "fov_domain"],
    ["zero ratio", { ...base, ratioDomain: { ...base.ratioDomain, min: 0 } }, "ratio_domain"],
    ["zero ratio step", { ...base, ratioDomain: { ...base.ratioDomain, step: 0 } }, "ratio_domain"],
    ["invalid frame", { ...base, frameSize: { width: 0, height: 698 } }, "frame_dimensions"],
    ["derivative basis", { ...base, imageBasis: { ...base.imageBasis, basisKind: "derivative" } }, "basis_kind"],
    ["orientation", { ...base, imageBasis: { ...base.imageBasis, coordinateSpaceVersion: { ...base.imageBasis.coordinateSpaceVersion, orientationApplied: true } } }, "orientation"],
    ["reference depth", { ...base, referenceDepth: 2 }, "reference_depth"],
  ];
  for (const [name, input, code] of invalid) {
    const result = runRatioFovExperiment(input as RatioFovExperimentInput);
    assert.equal(result.status, "failure", name);
    assert.ok(!("coarseSearch" in result), `${name} must not evaluate partial cells`);
    assert.equal(result.code, code);
    assert.match(result.message, /.+/);
    assert.equal(result.inputSummary?.fixtureId, roomB.fixtureId);
    assert.deepEqual(result.safety, {
      applied: false,
      authoritative: false,
      persisted: false,
      activeCameraUnchanged: true,
    });
  }
});

test("input is immutable, deterministic, and does not screen-sort a cyclic semantic declaration", () => {
  const input = inputFor(roomC);
  const before = structuredClone(input);
  const first = success(input);
  const second = success(input);
  assert.deepEqual(input, before);
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  assert.equal(first.inputFingerprint, ratioFovInputFingerprint(input));
  assert.deepEqual(first.frameFloorPolygonPx, second.frameFloorPolygonPx);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.frameFloorPolygonPx));
  const representative = first.ranking.globallyRankedBest;
  assert.ok(representative);
  assert.throws(() => (first.ranking.competitiveCells as RatioFovSuccessfulCell[]).push(representative));
  assert.throws(() => ((representative.position as { x: number }).x = 100));
  assert.throws(() => (representative.perCornerCvReprojectionPx as number[]).push(100));
  assert.throws(() => (first.basin.failureSummary.fovFailureIntervals as [number, number][]).push([0, 0]));
  assert.throws(() => (first.warnings as string[]).push("mutation"));
  assert.throws(() => ((first.safety as { applied: boolean }).applied = true));

  const shifted: RatioFovExperimentInput = {
    ...input,
    sourceFloorPolygon: [
      input.sourceFloorPolygon[1],
      input.sourceFloorPolygon[2],
      input.sourceFloorPolygon[3],
      input.sourceFloorPolygon[0],
    ],
  };
  const shiftedResult = success(shifted);
  assert.notDeepEqual(shiftedResult.frameFloorPolygonPx, first.frameFloorPolygonPx);
  near(shiftedResult.frameFloorPolygonPx[0].x, first.frameFloorPolygonPx[1].x, 1e-12);
  near(shiftedResult.frameFloorPolygonPx[0].y, first.frameFloorPolygonPx[1].y, 1e-12);
});

test("AFC-R1 deterministic control summary", () => {
  for (const fixture of [roomA, roomB, roomC]) {
    const result = success(inputFor(fixture, true));
    const best = result.ranking.globallyRankedBest;
    const manual = fixture.manualControl;
    const manualCell = successfulCell(result, manual.ratio, manual.fovDeg);
    const coarseBest = result.coarseSearch.cells
      .filter((cell): cell is RatioFovSuccessfulCell => cell.status === "success")
      .sort((left, right) => left.cvAvgPx - right.cvAvgPx || left.fovDeg - right.fovDeg || left.ratio - right.ratio)[0];
    assert.equal(result.basin.classification, expectedRegime(fixture));
    assert.ok(best);
    assert.ok(coarseBest);
    assert.equal(result.coarseSearch.cells.length, 2201);
    assert.ok(result.basin.strictCompetitiveEnvelope.cellCount > 0);
    assert.ok(result.basin.extendedValleyEnvelope10x.cellCount > 0);
    assert.ok(result.perturbation?.enabled);
    const failureIntervals = result.basin.failureSummary.fovFailureIntervals
      .map(([minimum, maximum]) => `${minimum.toFixed(1)}–${maximum.toFixed(1)}°`)
      .join(", ");
    console.log(
      `${fixture.roomLabel}: manual=${manualCell.cvAvgPx.toFixed(2)}/${manualCell.cvMaxPx.toFixed(2)} ` +
        `coarse=${coarseBest?.ratio.toFixed(3) ?? "none"}/${coarseBest?.fovDeg.toFixed(1) ?? "none"} ` +
        `refined=${best?.ratio.toFixed(3) ?? "none"}/${best?.fovDeg.toFixed(1) ?? "none"} ` +
        `regime=${result.basin.classification} signals=${JSON.stringify(result.basin.classificationSignals)} ` +
        `strict=${result.basin.strictCompetitiveEnvelope.ratioWidth?.toFixed(3) ?? "none"}/${result.basin.strictCompetitiveEnvelope.fovWidthDeg?.toFixed(1) ?? "none"}° ` +
        `4x=${result.basin.extendedValleyEnvelope4x.ratioWidth?.toFixed(3) ?? "none"}/${result.basin.extendedValleyEnvelope4x.fovWidthDeg?.toFixed(1) ?? "none"}° ` +
        `10x=${result.basin.extendedValleyEnvelope10x.ratioWidth?.toFixed(3) ?? "none"}/${result.basin.extendedValleyEnvelope10x.fovWidthDeg?.toFixed(1) ?? "none"}° ` +
        `closed=${result.closedForm.selectedClosedFormGridRatio?.toFixed(3) ?? "none"}/${result.closedForm.estimatedVerticalFovDeg?.toFixed(1) ?? "none"}° ` +
        `observability=${result.closedForm.orthogonalityObservabilityNormalized?.toFixed(3) ?? "none"} raw=${result.closedForm.rawOrthogonalityProductAtReferenceDepth1?.toFixed(2) ?? "none"} ` +
        `drift=${result.perturbation?.maximumRatioDrift?.toFixed(3) ?? "none"}/${result.perturbation?.maximumFovDriftDeg?.toFixed(1) ?? "none"}° ` +
        `recommendation=${result.ranking.isolatedResearchRecommendation ? "available" : "none"} failures=${failureIntervals || "none"}`
    );
  }
});
