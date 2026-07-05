import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint, qualifyCalibrationImageBasis } from "@/lib/vibodeCalibrationImageBasis";
import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import {
  CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX,
  CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO,
} from "@/app/admin/3d-room-lab/calibrated-camera-apply";
import {
  containerNormToSourceNorm,
  getCoverCrop,
  sourceNormToContainerNorm,
  sourceNormToContainerNormUnclamped,
  type ImageFrameSize,
} from "@/app/admin/3d-room-lab/image-space";
import { evaluateQuadSolvability } from "@/app/admin/3d-room-lab/quad-solvability";
import { startG0LoopbackAssetServer } from "../harness";
import { G0_SYNTHETIC_ASSETS } from "../assets-and-lineage";
import {
  assertDerivedPStalePreconditionV2CornersMatchSpec,
  derivePStalePreconditionV2SourceCorners,
  P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH,
  P_STALE_PRECONDITION_V2_DECLARED_CORNERS,
  P_STALE_PRECONDITION_V2_MARKER_SIZE_SOURCE_PX,
  P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH,
  P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH,
  P_STALE_PRECONDITION_V2_SOURCE_SIZE,
  type PStalePreconditionV2CornerKey,
} from "../p-stale-precondition-v2-spec";

const SOURCE_SIZE = P_STALE_PRECONDITION_V2_SOURCE_SIZE;
const FLOOR_DIMENSIONS = { worldWidth: 4, worldDepth: 4 } as const;
const SCAN_CONFIG = { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 } as const;

function sourcePxToNorm(point: { x: number; y: number }) {
  return { x: point.x / SOURCE_SIZE.width, y: point.y / SOURCE_SIZE.height };
}

function sourceCornerNormsByOrder() {
  return (["NL", "NR", "FR", "FL"] as const).map((key) => sourcePxToNorm(P_STALE_PRECONDITION_V2_DECLARED_CORNERS[key].px));
}

function buildContainerCornersFromSource(frame: ImageFrameSize) {
  return sourceCornerNormsByOrder().map((sourceNorm) => {
    const container = sourceNormToContainerNorm(sourceNorm, SOURCE_SIZE, frame);
    assert.ok(container, "source->container conversion must succeed");
    return container;
  });
}

function approxEqual(actual: number, expected: number, tolerance: number) {
  return Math.abs(actual - expected) <= tolerance;
}

function assertPracticalMarkerClearance(frame: ImageFrameSize) {
  const halfMarkerPx = P_STALE_PRECONDITION_V2_MARKER_SIZE_SOURCE_PX / 2;
  for (const key of ["NL", "NR", "FR", "FL"] as const) {
    const centerSourcePx = P_STALE_PRECONDITION_V2_DECLARED_CORNERS[key].px;
    const centerSourceNorm = sourcePxToNorm(centerSourcePx);
    const clamped = sourceNormToContainerNorm(centerSourceNorm, SOURCE_SIZE, frame);
    const unclamped = sourceNormToContainerNormUnclamped(centerSourceNorm, SOURCE_SIZE, frame);
    assert.ok(clamped && unclamped);

    assert.equal(clamped.x > 0 && clamped.x < 1, true);
    assert.equal(clamped.y > 0 && clamped.y < 1, true);
    assert.ok(Math.abs(clamped.x - unclamped.x) < 1e-12);
    assert.ok(Math.abs(clamped.y - unclamped.y) < 1e-12);

    const markerBoxCorners = [
      { x: centerSourcePx.x - halfMarkerPx, y: centerSourcePx.y - halfMarkerPx },
      { x: centerSourcePx.x + halfMarkerPx, y: centerSourcePx.y - halfMarkerPx },
      { x: centerSourcePx.x + halfMarkerPx, y: centerSourcePx.y + halfMarkerPx },
      { x: centerSourcePx.x - halfMarkerPx, y: centerSourcePx.y + halfMarkerPx },
    ];
    for (const sourceCornerPx of markerBoxCorners) {
      const sourceNorm = sourcePxToNorm(sourceCornerPx);
      const container = sourceNormToContainerNorm(sourceNorm, SOURCE_SIZE, frame);
      assert.ok(container);
      assert.equal(container.x > 0 && container.x < 1, true);
      assert.equal(container.y > 0 && container.y < 1, true);
    }
  }

  const crop = getCoverCrop(SOURCE_SIZE, frame);
  assert.ok(crop);
  const markerContainerPx = P_STALE_PRECONDITION_V2_MARKER_SIZE_SOURCE_PX * crop.scale;
  assert.ok(markerContainerPx >= 12);
}

test("A) projected v2 corners round-trip exactly and solve/scan/apply at 3 frames stays centered at 60deg", () => {
  const derived = derivePStalePreconditionV2SourceCorners();
  assertDerivedPStalePreconditionV2CornersMatchSpec(derived);
  for (const key of ["NL", "NR", "FR", "FL"] as const) {
    const expected = P_STALE_PRECONDITION_V2_DECLARED_CORNERS[key];
    const actual = derived[key];
    assert.ok(approxEqual(actual.x, expected.px.x, 0.02));
    assert.ok(approxEqual(actual.y, expected.px.y, 0.02));
    const norm = sourcePxToNorm(actual);
    assert.ok(approxEqual(norm.x, expected.sourceNorm.x, 5e-4));
    assert.ok(approxEqual(norm.y, expected.sourceNorm.y, 5e-4));
  }

  for (const frame of [
    { width: 1118, height: 698 },
    { width: 960, height: 600 },
    { width: 640, height: 400 },
  ] satisfies ImageFrameSize[]) {
    const containerCorners = buildContainerCornersFromSource(frame);
    for (let i = 0; i < containerCorners.length; i += 1) {
      const backToSource = containerNormToSourceNorm(containerCorners[i], SOURCE_SIZE, frame);
      assert.ok(backToSource, "container->source round-trip must succeed");
      const expectedSourceNorm = sourceCornerNormsByOrder()[i];
      assert.ok(approxEqual(backToSource.x, expectedSourceNorm.x, 1e-12));
      assert.ok(approxEqual(backToSource.y, expectedSourceNorm.y, 1e-12));
    }

    const result = evaluateQuadSolvability({
      quadNorm: containerCorners,
      frameSize: frame,
      floorDimensions: FLOOR_DIMENSIONS,
      currentVerticalFovDeg: 60,
      fovScanConfig: SCAN_CONFIG,
    });

    assert.equal(result.confidence, "high");
    assert.equal(result.applyEvaluation.firstFailingGate, "none");
    assert.equal(result.applyEvaluation.available, true);
    assert.equal(result.fovScan.scan?.bestFovDeg, 60);
    assert.equal(result.fovScan.scan?.bestConfidence, "high");
    assert.ok(result.cv.averagePx !== null && result.cv.averagePx <= 0.01);
    assert.ok(result.cv.maximumPx !== null && result.cv.maximumPx <= 0.01);
    assert.ok(result.delta.averagePx !== null && result.delta.averagePx <= 1e-9);
    assert.ok(result.delta.maximumPx !== null && result.delta.maximumPx <= 1e-9);
    assert.ok(result.scaleRatio !== null && Math.abs(result.scaleRatio - 1) <= 1e-4);
    const highConfidenceRange = result.fovScan.scan?.highConfidenceFovRange;
    assert.ok(highConfidenceRange !== null);
    assert.ok(highConfidenceRange[0] > 20);
    assert.ok(highConfidenceRange[1] < 90);
  }
});

test("B) exhaustive +-1 container-pixel perturbations at 1118x698 keep apply-safe envelope", () => {
  const frame = { width: 1118, height: 698 } satisfies ImageFrameSize;
  const baseContainerCorners = buildContainerCornersFromSource(frame);
  const basePixels = baseContainerCorners.map((point) => ({
    x: point.x * frame.width,
    y: point.y * frame.height,
  }));

  const offsets = [-1, 0, 1] as const;
  let failureCount = 0;
  let worstCvAvg = 0;
  let worstCvMax = 0;
  let worstScaleRatio = 0;
  let minRecommendedFov = Number.POSITIVE_INFINITY;
  let maxRecommendedFov = Number.NEGATIVE_INFINITY;
  let combinationCount = 0;

  for (const d0x of offsets)
    for (const d0y of offsets)
      for (const d1x of offsets)
        for (const d1y of offsets)
          for (const d2x of offsets)
            for (const d2y of offsets)
              for (const d3x of offsets)
                for (const d3y of offsets) {
                  combinationCount += 1;
                  const perturbedContainerNorm = [
                    { x: (basePixels[0].x + d0x) / frame.width, y: (basePixels[0].y + d0y) / frame.height },
                    { x: (basePixels[1].x + d1x) / frame.width, y: (basePixels[1].y + d1y) / frame.height },
                    { x: (basePixels[2].x + d2x) / frame.width, y: (basePixels[2].y + d2y) / frame.height },
                    { x: (basePixels[3].x + d3x) / frame.width, y: (basePixels[3].y + d3y) / frame.height },
                  ];

                  const convertedCorners = perturbedContainerNorm.map((point) => {
                    const sourceNorm = containerNormToSourceNorm(point, SOURCE_SIZE, frame);
                    assert.ok(sourceNorm, "container->source conversion must succeed");
                    const containerNorm = sourceNormToContainerNorm(sourceNorm, SOURCE_SIZE, frame);
                    assert.ok(containerNorm, "source->container conversion must succeed");
                    return containerNorm;
                  });

                  const result = evaluateQuadSolvability({
                    quadNorm: convertedCorners,
                    frameSize: frame,
                    floorDimensions: FLOOR_DIMENSIONS,
                    currentVerticalFovDeg: 60,
                    fovScanConfig: SCAN_CONFIG,
                  });

                  const cvAvg = result.cv.averagePx ?? Number.POSITIVE_INFINITY;
                  const cvMax = result.cv.maximumPx ?? Number.POSITIVE_INFINITY;
                  const scaleRatio = result.scaleRatio ?? Number.POSITIVE_INFINITY;
                  worstCvAvg = Math.max(worstCvAvg, cvAvg);
                  worstCvMax = Math.max(worstCvMax, cvMax);
                  worstScaleRatio = Math.max(worstScaleRatio, scaleRatio);

                  const recommendedFov = result.fovScan.scan?.bestFovDeg ?? null;
                  if (recommendedFov !== null) {
                    minRecommendedFov = Math.min(minRecommendedFov, recommendedFov);
                    maxRecommendedFov = Math.max(maxRecommendedFov, recommendedFov);
                  }

                  const isFailure =
                    result.applyEvaluation.firstFailingGate !== "none" ||
                    !result.applyEvaluation.available ||
                    recommendedFov === null;
                  if (isFailure) {
                    failureCount += 1;
                  }
                }

  assert.equal(combinationCount, 6561);
  assert.equal(failureCount, 0);
  assert.ok(worstCvAvg <= 2.5);
  assert.ok(worstCvMax < 10);
  assert.ok(worstScaleRatio > 1.0072);
  assert.ok(worstScaleRatio <= CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO);
  assert.ok(minRecommendedFov > 25);
  assert.ok(maxRecommendedFov < 85);
});

test("C) marker usability and object-cover visibility hold at 1118x698 and 640x400", () => {
  assertPracticalMarkerClearance({ width: 1118, height: 698 });
  assertPracticalMarkerClearance({ width: 640, height: 400 });
});

test("D) v2 canonical bytes, basis eligibility, and public path integrity are pinned", async () => {
  const canonicalPath = path.join(process.cwd(), P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH);
  const publicPath = path.join(
    process.cwd(),
    "public",
    new URL(`http://localhost${P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH}`).pathname.replace(/^\/+/, "")
  );
  const expectedMirrorPath = path.join(process.cwd(), P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH);
  const canonical = await readFile(canonicalPath);
  const mirror = await readFile(publicPath);
  assert.deepEqual(mirror, canonical);
  assert.equal(publicPath, expectedMirrorPath);

  const canonicalDigest = computeCalibrationImageFingerprint(canonical);
  const mirrorDigest = computeCalibrationImageFingerprint(mirror);
  const asset = G0_SYNTHETIC_ASSETS["P-stale-precondition-v2"];
  assert.equal(canonicalDigest, asset.sha256);
  assert.equal(mirrorDigest, asset.sha256);

  const metadata = await inspectImageMetadata(canonical);
  assert.equal(metadata.ok, true);
  if (metadata.ok) {
    assert.equal(metadata.width, 1280);
    assert.equal(metadata.height, 720);
    assert.equal(metadata.orientation, 1);
  }

  const server = await startG0LoopbackAssetServer();
  try {
    const qualified = await qualifyCalibrationImageBasis({
      imageUrl: `${server.origin}/${asset.fileName}`,
      browserDimensions: { width: 1280, height: 720 },
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      basisKind: "original",
      fetch: {
        allowedHosts: [],
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 5000,
        allowLocalhostHttp: true,
      },
    });
    assert.equal(qualified.ok, true);
    if (qualified.ok) {
      assert.equal(qualified.basis.encodedOrientation, 1);
      assert.equal(qualified.basis.decodedOrientationNormal, true);
      assert.equal(qualified.basis.basisKind, "original");
      assert.equal(qualified.basis.basisFingerprint, asset.sha256);
    }
  } finally {
    await server.close();
  }
});

test("spec constants preserve NL/NR/FR/FL declaration ordering", () => {
  const keys = Object.keys(P_STALE_PRECONDITION_V2_DECLARED_CORNERS) as PStalePreconditionV2CornerKey[];
  assert.deepEqual(keys, ["NL", "NR", "FR", "FL"]);
  const sourceNorms = keys.map((key) => P_STALE_PRECONDITION_V2_DECLARED_CORNERS[key].sourceNorm);
  for (const sourceNorm of sourceNorms) {
    assert.ok(sourceNorm.x > 0 && sourceNorm.x < 1);
    assert.ok(sourceNorm.y > 0 && sourceNorm.y < 1);
  }
});

