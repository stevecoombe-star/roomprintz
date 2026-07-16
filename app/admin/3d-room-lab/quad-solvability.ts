import {
  evaluateCalibratedCameraApply,
  type CalibratedCameraApplyCandidate,
  type CalibratedCameraApplyEvaluation,
} from "./calibrated-camera-apply";
import { normToPixels, type ImageFrameSize } from "./image-space";
import {
  buildCameraIntrinsicsFromFov,
  decomposeHomographyToCameraPose,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  orderFloorCorners,
  projectFloorPointThroughPose,
  scanCameraPoseOverFov,
  solvePlaneHomography,
  type CameraPose,
  type CameraPoseDiagnostics,
  type CameraPoseCvProjection,
  type FovScanResult,
  type HomographyMatrix,
  type Vec2,
} from "./perspective-solve";
import type { FloorPoint } from "./scene-state";

type OrderedQuad = [FloorPoint, FloorPoint, FloorPoint, FloorPoint];

export type QuadSolvabilityFovScanConfig = {
  minFovDeg: number;
  maxFovDeg: number;
  stepDeg: number;
};

export type QuadSolvabilityPrecomputedHomography = {
  orderedCornersNorm: OrderedQuad | null;
  homographyMatrixForPlacement: HomographyMatrix | null;
  homographySolveStatus: "ok" | "fail";
  placementFallbackReason: string;
};

export type QuadSolvabilityInput = {
  quadNorm: FloorPoint[];
  frameSize: ImageFrameSize | null;
  floorDimensions: {
    worldWidth: number;
    worldDepth: number;
  };
  currentVerticalFovDeg: number;
  fovScanConfig: QuadSolvabilityFovScanConfig;
  precomputedHomography?: QuadSolvabilityPrecomputedHomography;
};

export type QuadWorstCorner = { index: number; value: number } | null;

export type RenderedCameraReprojectionResult = {
  perCornerResidualPx: (number | null)[];
  averagePx: number | null;
  maximumPx: number | null;
  count: number;
};

export type QuadSolvabilityResult = {
  prerequisitesAvailable: boolean;
  unavailableReason: string | null;
  orderedCornersNorm: OrderedQuad | null;
  imagePointsPx: Vec2[] | null;
  floorPlanePoints2D: Vec2[] | null;
  homographyAvailable: boolean;
  homographyMatrixForPlacement: HomographyMatrix | null;
  decomposition:
    | {
        confidence: "high" | "low";
        frameSize: ImageFrameSize;
        cvProjection: CameraPoseCvProjection;
        pose: CameraPose;
        diagnostics: CameraPoseDiagnostics;
        note?: string;
      }
    | null;
  poseAvailable: boolean;
  confidence: "high" | "low" | null;
  scaleRatio: number | null;
  cv: {
    averagePx: number | null;
    maximumPx: number | null;
    perCornerResidualPx: (number | null)[] | null;
  };
  rendered: {
    averagePx: number | null;
    maximumPx: number | null;
    perCornerResidualPx: (number | null)[] | null;
    count: number;
  };
  delta: {
    averagePx: number | null;
    maximumPx: number | null;
  };
  applyCandidate: (CalibratedCameraApplyCandidate & { pose: CameraPose }) | null;
  applyEvaluation: CalibratedCameraApplyEvaluation;
  fovScan: {
    scan: FovScanResult | null;
    unavailableReason: string | null;
    validSampleIntervals: [number, number][] | null;
    highConfidenceSampleIntervals: [number, number][] | null;
    validSampleCount: number;
    highConfidenceSampleCount: number;
    sampleCount: number;
    sampleStepDeg: number;
  };
  worstCorner: {
    cv: QuadWorstCorner;
    rendered: QuadWorstCorner;
    difference: QuadWorstCorner;
  };
};

export function computeRenderedCameraReprojection(
  pose: CameraPose,
  frameSize: ImageFrameSize,
  verticalFovDeg: number,
  floorPlanePoints2D: Vec2[],
  imagePointsPx: Vec2[]
): RenderedCameraReprojectionResult {
  let total = 0;
  let max = 0;
  let count = 0;
  const perCornerResidualPx: (number | null)[] = new Array(floorPlanePoints2D.length).fill(null);
  for (let i = 0; i < floorPlanePoints2D.length; i += 1) {
    const projected = projectFloorPointThroughPose(pose, frameSize, { verticalFovDeg }, floorPlanePoints2D[i]);
    if (!projected.ok) continue;
    const error = Math.hypot(projected.value.x - imagePointsPx[i].x, projected.value.y - imagePointsPx[i].y);
    if (!Number.isFinite(error)) continue;
    perCornerResidualPx[i] = error;
    total += error;
    if (error > max) max = error;
    count += 1;
  }
  return {
    perCornerResidualPx,
    averagePx: count > 0 ? total / count : null,
    maximumPx: count > 0 ? max : null,
    count,
  };
}

export function buildContiguousFovIntervals(
  values: FovScanResult["samples"],
  stepDeg: number,
  qualifies: (sample: FovScanResult["samples"][number]) => boolean
): [number, number][] {
  const intervals: [number, number][] = [];
  let startFov: number | null = null;
  let previousFov: number | null = null;
  for (const sample of values) {
    if (!qualifies(sample)) {
      if (startFov !== null && previousFov !== null) intervals.push([startFov, previousFov]);
      startFov = null;
      previousFov = null;
      continue;
    }
    if (startFov === null) {
      startFov = sample.fov;
      previousFov = sample.fov;
      continue;
    }
    const isContiguous = previousFov !== null && Math.abs(sample.fov - previousFov - stepDeg) <= Number.EPSILON * 8;
    if (!isContiguous) {
      intervals.push([startFov, previousFov ?? startFov]);
      startFov = sample.fov;
    }
    previousFov = sample.fov;
  }
  if (startFov !== null && previousFov !== null) intervals.push([startFov, previousFov]);
  return intervals;
}

export function pickLargestFiniteCorner(values: (number | null)[] | null): QuadWorstCorner {
  if (!values) return null;
  let best: { index: number; value: number } | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) continue;
    if (!best || value > best.value) {
      best = { index: i, value };
    }
  }
  return best;
}

export function pickLargestPerCornerDifference(
  cvResiduals: (number | null)[] | null,
  renderedResiduals: (number | null)[] | null
): QuadWorstCorner {
  if (!cvResiduals || !renderedResiduals) return null;
  const count = Math.min(cvResiduals.length, renderedResiduals.length);
  let best: { index: number; value: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const cvResidual = cvResiduals[i];
    const renderedResidual = renderedResiduals[i];
    if (
      cvResidual === null ||
      renderedResidual === null ||
      !Number.isFinite(cvResidual) ||
      !Number.isFinite(renderedResidual)
    ) {
      continue;
    }
    const difference = Math.abs(renderedResidual - cvResidual);
    if (!best || difference > best.value) {
      best = { index: i, value: difference };
    }
  }
  return best;
}

export function evaluateQuadSolvability(input: QuadSolvabilityInput): QuadSolvabilityResult {
  const frameSize = input.frameSize;
  const hasPrecomputedHomography = input.precomputedHomography !== undefined;
  let orderedCornersNorm: OrderedQuad | null = input.precomputedHomography?.orderedCornersNorm ?? null;
  let homographyMatrixForPlacement: HomographyMatrix | null =
    input.precomputedHomography?.homographyMatrixForPlacement ?? null;
  let homographyAvailable =
    input.precomputedHomography?.homographySolveStatus === "ok" && homographyMatrixForPlacement !== null;
  let homographyUnavailableReason = input.precomputedHomography?.placementFallbackReason ?? "homography solve not attempted";

  if (!hasPrecomputedHomography) {
    if (input.quadNorm.length !== 4) {
      homographyUnavailableReason = `floor polygon requires 4 points (got ${input.quadNorm.length})`;
    } else {
      const orderedCornersResult = orderFloorCorners(input.quadNorm);
      if (!orderedCornersResult.ok) {
        homographyUnavailableReason = `corner ordering failed: ${orderedCornersResult.reason}`;
      } else {
        orderedCornersNorm = orderedCornersResult.value.asArray;
      }
      if (orderedCornersNorm && frameSize) {
        const sourceImagePointsPx: Vec2[] = [];
        let sourceConversionOk = true;
        for (const point of orderedCornersNorm) {
          const pixels = normToPixels(point, frameSize);
          if (!pixels) {
            sourceConversionOk = false;
            break;
          }
          sourceImagePointsPx.push(pixels);
        }
        if (!sourceConversionOk) {
          homographyUnavailableReason = "could not convert ordered corners to frame pixels";
        } else {
          const floorRectResult = getFloorRectCorners({
            widthMeters: input.floorDimensions.worldWidth,
            depthMeters: input.floorDimensions.worldDepth,
          });
          if (!floorRectResult.ok) {
            homographyUnavailableReason = `floor rect assumption invalid: ${floorRectResult.reason}`;
          } else {
            const floorPlanePoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));
            const solveResult = solvePlaneHomography(sourceImagePointsPx, floorPlanePoints2D);
            if (!solveResult.ok) {
              homographyUnavailableReason = `homography solve failed: ${solveResult.reason}`;
            } else {
              homographyMatrixForPlacement = solveResult.value;
              homographyAvailable = true;
              homographyUnavailableReason = "none";
            }
          }
        }
      }
    }
  }

  let imagePointsPx: Vec2[] | null = null;
  let floorPlanePoints2D: Vec2[] | null = null;
  let sharedPrerequisiteReason: string | null = null;
  if (!frameSize) {
    sharedPrerequisiteReason = "frame pixel size unavailable";
  } else if (!homographyAvailable || !homographyMatrixForPlacement) {
    sharedPrerequisiteReason = homographyUnavailableReason;
  } else if (!orderedCornersNorm) {
    sharedPrerequisiteReason = "ordered homography corners unavailable";
  } else {
    const points: Vec2[] = [];
    let conversionFailed = false;
    for (const point of orderedCornersNorm) {
      const pixels = normToPixels(point, frameSize);
      if (!pixels) {
        conversionFailed = true;
        break;
      }
      points.push(pixels);
    }
    if (conversionFailed) {
      sharedPrerequisiteReason = "could not convert ordered corners from normalized -> pixels";
    } else {
      imagePointsPx = points;
      const floorRectResult = getFloorRectCorners({
        widthMeters: input.floorDimensions.worldWidth,
        depthMeters: input.floorDimensions.worldDepth,
      });
      if (!floorRectResult.ok) {
        sharedPrerequisiteReason = floorRectResult.reason;
      } else {
        floorPlanePoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));
      }
    }
  }

  let decomposition:
    | {
        confidence: "high" | "low";
        frameSize: ImageFrameSize;
        cvProjection: CameraPoseCvProjection;
        pose: CameraPose;
        diagnostics: CameraPoseDiagnostics;
        note?: string;
      }
    | null = null;
  let unavailableReason: string | null = null;
  if (!frameSize) {
    unavailableReason = "frame pixel size unavailable";
  } else if (!homographyAvailable || !homographyMatrixForPlacement) {
    unavailableReason = homographyUnavailableReason;
  } else {
    const intrinsicsResult = buildCameraIntrinsicsFromFov(frameSize, input.currentVerticalFovDeg);
    if (!intrinsicsResult.ok) {
      unavailableReason = intrinsicsResult.reason;
    } else if (sharedPrerequisiteReason) {
      unavailableReason = sharedPrerequisiteReason;
    } else if (imagePointsPx && floorPlanePoints2D) {
      const decompositionResult = decomposeHomographyToCameraPose(
        homographyMatrixForPlacement,
        frameSize,
        { verticalFovDeg: input.currentVerticalFovDeg },
        { floorPlanePoints2D, imagePointsPx }
      );
      if (!decompositionResult.ok) {
        unavailableReason = decompositionResult.reason;
      } else {
        decomposition = {
          confidence: decompositionResult.confidence,
          frameSize,
          cvProjection: decompositionResult.value.cvProjection,
          pose: decompositionResult.value.pose,
          diagnostics: decompositionResult.value.diagnostics,
          ...(decompositionResult.note ? { note: decompositionResult.note } : {}),
        };
      }
    }
  }

  let perCornerCvResidualPx: (number | null)[] | null = null;
  let cvAveragePx: number | null = null;
  let cvMaximumPx: number | null = null;
  let scaleRatio: number | null = null;
  if (decomposition && floorPlanePoints2D) {
    cvAveragePx = decomposition.diagnostics.averageCameraPoseReprojectionPx;
    cvMaximumPx = decomposition.diagnostics.maxCameraPoseReprojectionPx;
    scaleRatio = decomposition.diagnostics.columnScaleRatio;
    const perCorner = decomposition.diagnostics.perCornerCvReprojectionPx;
    perCornerCvResidualPx =
      Array.isArray(perCorner) && perCorner.length === floorPlanePoints2D.length
        ? perCorner.map((value) => (Number.isFinite(value) ? value : null))
        : null;
  }

  let renderedReprojection: RenderedCameraReprojectionResult | null = null;
  if (decomposition && imagePointsPx && floorPlanePoints2D) {
    renderedReprojection = computeRenderedCameraReprojection(
      decomposition.pose,
      decomposition.frameSize,
      input.currentVerticalFovDeg,
      floorPlanePoints2D,
      imagePointsPx
    );
  }

  const applyCandidate =
    decomposition && cvAveragePx !== null && cvMaximumPx !== null && scaleRatio !== null
      ? {
          confidence: decomposition.confidence,
          cvAvgPx: cvAveragePx,
          cvMaxPx: cvMaximumPx,
          displayAvgPx: renderedReprojection?.averagePx ?? null,
          displayMaxPx: renderedReprojection?.maximumPx ?? null,
          scaleRatio,
          frameSize: decomposition.frameSize,
          pose: decomposition.pose,
        }
      : null;
  const applyEvaluation = evaluateCalibratedCameraApply(applyCandidate, unavailableReason);

  const avgDeltaPx =
    applyCandidate &&
    applyCandidate.displayAvgPx !== null &&
    Number.isFinite(applyCandidate.displayAvgPx) &&
    Number.isFinite(applyCandidate.cvAvgPx)
      ? Math.abs(applyCandidate.displayAvgPx - applyCandidate.cvAvgPx)
      : null;
  const maxDeltaPx =
    applyCandidate &&
    applyCandidate.displayMaxPx !== null &&
    Number.isFinite(applyCandidate.displayMaxPx) &&
    Number.isFinite(applyCandidate.cvMaxPx)
      ? Math.abs(applyCandidate.displayMaxPx - applyCandidate.cvMaxPx)
      : null;

  const scanUnavailableReason = sharedPrerequisiteReason;
  let scan: FovScanResult | null = null;
  if (!scanUnavailableReason && frameSize && homographyMatrixForPlacement && imagePointsPx && floorPlanePoints2D) {
    scan = scanCameraPoseOverFov(
      homographyMatrixForPlacement,
      frameSize,
      { floorPlanePoints2D, imagePointsPx },
      {
        minFovDeg: input.fovScanConfig.minFovDeg,
        maxFovDeg: input.fovScanConfig.maxFovDeg,
        stepDeg: input.fovScanConfig.stepDeg,
      }
    );
  }
  const isValidSample = (sample: FovScanResult["samples"][number]) =>
    sample.ok && sample.avgPx !== undefined && sample.maxPx !== undefined;
  const validSampleIntervals = scan
    ? buildContiguousFovIntervals(scan.samples, input.fovScanConfig.stepDeg, isValidSample)
    : null;
  const highConfidenceSampleIntervals = scan
    ? buildContiguousFovIntervals(
        scan.samples,
        input.fovScanConfig.stepDeg,
        (sample) => isValidSample(sample) && sample.confidence === "high"
      )
    : null;

  const worstCvCorner = pickLargestFiniteCorner(perCornerCvResidualPx);
  const worstRenderedCorner = pickLargestFiniteCorner(renderedReprojection?.perCornerResidualPx ?? null);
  const worstDifferenceCorner = pickLargestPerCornerDifference(
    perCornerCvResidualPx,
    renderedReprojection?.perCornerResidualPx ?? null
  );

  return {
    prerequisitesAvailable: !sharedPrerequisiteReason,
    unavailableReason,
    orderedCornersNorm,
    imagePointsPx,
    floorPlanePoints2D,
    homographyAvailable,
    homographyMatrixForPlacement,
    decomposition,
    poseAvailable: decomposition !== null,
    confidence: decomposition?.confidence ?? null,
    scaleRatio,
    cv: {
      averagePx: cvAveragePx,
      maximumPx: cvMaximumPx,
      perCornerResidualPx: perCornerCvResidualPx,
    },
    rendered: {
      averagePx: renderedReprojection?.averagePx ?? null,
      maximumPx: renderedReprojection?.maximumPx ?? null,
      perCornerResidualPx: renderedReprojection?.perCornerResidualPx ?? null,
      count: renderedReprojection?.count ?? 0,
    },
    delta: {
      averagePx: avgDeltaPx,
      maximumPx: maxDeltaPx,
    },
    applyCandidate,
    applyEvaluation,
    fovScan: {
      scan,
      unavailableReason: scanUnavailableReason,
      validSampleIntervals,
      highConfidenceSampleIntervals,
      validSampleCount: scan?.validCount ?? 0,
      highConfidenceSampleCount: scan?.highConfidenceCount ?? 0,
      sampleCount: scan?.samples.length ?? 0,
      sampleStepDeg: input.fovScanConfig.stepDeg,
    },
    worstCorner: {
      cv: worstCvCorner,
      rendered: worstRenderedCorner,
      difference: worstDifferenceCorner,
    },
  };
}
