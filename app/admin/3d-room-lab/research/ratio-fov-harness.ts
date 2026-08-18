/**
 * AFC-R1 — Read-only Ratio × FOV Research Harness.
 *
 * This module is deliberately isolated from the lab UI and authority paths. It
 * evaluates labeled Floor evidence only; it neither registers nor changes a
 * renderer camera, invokes Apply, persists data, or mutates caller input.
 */
import {
  evaluateCalibratedCameraApply,
  type CalibratedCameraApplyFirstFailingGate,
} from "../calibrated-camera-apply";
import { getCoverCrop } from "../image-space";
import {
  decomposeHomographyToCameraPose,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  projectFloorPointThroughPose,
  solvePlaneHomography,
  validateOrderedFloorCorners,
  type CameraPose,
  type Vec2,
  type Vec3,
} from "../perspective-solve";

export const RATIO_FOV_HARNESS_CONTRACT_VERSION = "ratio-fov-harness/v1" as const;
// R1H2 adds fail-closed observability and refinement-coverage semantics.
export const RATIO_FOV_RESEARCH_CONFIG_VERSION = "afc-r1h-research-config/v3" as const;
/**
 * Exploratory, dimensionless research threshold for normalized centered-column
 * orthogonality observability. It is not a production camera-quality gate.
 */
export const RATIO_FOV_WEAK_ORTHOGONALITY_OBSERVABILITY_NORMALIZED = 0.8;
export const RATIO_FOV_EXTENDED_VALLEY_FACTORS = Object.freeze({ fourX: 4, tenX: 10 });

const MIN_FOV_DEG = 20;
const MAX_FOV_DEG = 90;
const DEFAULT_REFINEMENT = Object.freeze({
  enabled: true,
  ratioStep: 0.005,
  fovStepDeg: 0.1,
  basinFactor: 1.25,
  additivePxAllowance: 0.25,
});
const DEFAULT_RATIO_DOMAIN = Object.freeze({ min: 0.5, max: 2, step: 0.05 });
const DEFAULT_FOV_DOMAIN = Object.freeze({ minDeg: 20, maxDeg: 90, stepDeg: 1 });

export type RatioFovPoint = Readonly<{ x: number; y: number }>;
export type RatioFovFrameSize = Readonly<{ width: number; height: number }>;
export type RatioFovSemanticOrder = readonly ["NL", "NR", "FR", "FL"];

export type RatioFovExperimentInput = Readonly<{
  contractVersion: typeof RATIO_FOV_HARNESS_CONTRACT_VERSION;
  fixtureId?: string;
  imageBasis: Readonly<{
    basisId: string;
    basisFingerprint: string;
    decodedWidth: number;
    decodedHeight: number;
    coordinateSpaceVersion: Readonly<{
      decoderId: string;
      normalizationPolicyVersion: string;
      orientationApplied: boolean;
    }>;
    basisKind: "original";
  }>;
  frameSize: RatioFovFrameSize;
  coordinateSpace: "source-normalized/v1";
  /** Labeled semantic perimeter. Never infer or sort it from screen position. */
  semanticOrder: RatioFovSemanticOrder;
  sourceFloorPolygon: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint];
  ratioDomain: Readonly<{ min: number; max: number; step: number }>;
  fovDomain: Readonly<{ minDeg: number; maxDeg: number; stepDeg: number }>;
  referenceDepth: 1;
  refinement?: Readonly<{
    enabled: boolean;
    ratioStep: number;
    fovStepDeg: number;
    basinFactor: number;
    additivePxAllowance: number;
  }>;
  perturbation?: Readonly<{ enabled: boolean }>;
}>;

export type RatioFovFailureCode =
  | "contract_version"
  | "coordinate_space"
  | "semantic_order"
  | "floor_polygon"
  | "intrinsic_dimensions"
  | "frame_dimensions"
  | "basis_kind"
  | "orientation"
  | "basis_identity"
  | "ratio_domain"
  | "fov_domain"
  | "reference_depth"
  | "refinement"
  | "cover_crop";

export type RatioFovResearchSafety = Readonly<{
  applied: false;
  authoritative: false;
  persisted: false;
  activeCameraUnchanged: true;
}>;

export type RatioFovApplyObservability = Readonly<{
  available: boolean;
  firstFailingGate: CalibratedCameraApplyFirstFailingGate;
  reason: string;
  displayAvgPx: number;
  displayMaxPx: number;
  averageDeltaPx: number;
  maximumDeltaPx: number;
}>;

export type RatioFovSuccessfulCell = Readonly<{
  status: "success";
  ratio: number;
  fovDeg: number;
  confidence: "high" | "low";
  cvAvgPx: number;
  cvMaxPx: number;
  perCornerCvReprojectionPx: readonly number[];
  columnScaleRatio: number;
  /** Guard-parity only: it is near zero after Gram-Schmidt by construction. */
  orthonormalityError: number;
  rotationDeterminant: number;
  selectedScaleSign: 1 | -1;
  candidatesPassingCheirality: number;
  minimumPositiveDepth: number;
  cameraHeight: number;
  cameraHeightOverReferenceDepth: number;
  position: Readonly<Vec3>;
  lookAt: Readonly<Vec3>;
  up: Readonly<Vec3>;
  normalizedLookDirection: Readonly<Vec3>;
  normalizedTranslationDirection: Readonly<Vec3>;
  applyObservability: RatioFovApplyObservability;
  solverWarning: string | null;
}>;

export type RatioFovFailedCell = Readonly<{
  status: "failure";
  ratio: number;
  fovDeg: number;
  failureReason: string;
}>;

export type RatioFovCell = RatioFovSuccessfulCell | RatioFovFailedCell;

export type RatioFovClosedForm = Readonly<{
  methodVersion: "afc-r1h-centered-principal-point/v2";
  /** Coarse ratio-grid selection minimizing finite equal-norm discrepancy. */
  selectedClosedFormGridRatio: number | null;
  conditioningDotNumerator: number | null;
  conditioningDotDenominator: number | null;
  conditioningEqualNormNumerator: number | null;
  conditioningEqualNormDenominator: number | null;
  /**
   * |c1·c2| / (||c1|| ||c2||), where c1=(h11-cx*h31,h21-cy*h31) and
   * c2=(h12-cx*h32,h22-cy*h32) are centered floor->image homography columns.
   * It is dimensionless and invariant to homography and uniform metric scale.
   */
  orthogonalityObservabilityNormalized: number | null;
  /**
   * |dotNumerator × dotDenominator| at reference depth 1. It is metric-scale
   * dependent and observability-only; it must never independently classify.
   */
  rawOrthogonalityProductAtReferenceDepth1: number | null;
  equalNormDiscrepancy: number | null;
  sign: -1 | 0 | 1;
  finiteFocalEstimate: boolean;
  estimatedFocalLengthFramePx: number | null;
  estimatedVerticalFovDeg: number | null;
  classificationHint: "well_conditioned" | "weakly_conditioned" | "degenerate";
  numericalWarnings: readonly string[];
}>;

export type RatioFovBasin = Readonly<{
  classification:
    | "isolated_optimum"
    | "degenerate_valley"
    | "multiple_competing_basins"
    | "unstable_branch"
    | "no_valid_solution";
  classificationSignals: RatioFovClassificationSignals;
  strictCompetitiveEnvelope: RatioFovEnvelope;
  extendedValleyEnvelope4x: RatioFovEnvelope;
  extendedValleyEnvelope10x: RatioFovEnvelope;
  failureSummary: RatioFovFailureSummary;
}>;

export type RatioFovClassificationSignals = Readonly<{
  weakClosedFormObservability: boolean;
  /** No finite normalized closed-form observability was available. */
  observabilityUnavailable: boolean;
  broadExtendedValley: boolean;
  strongValleyCorrelation: boolean;
  multipleDisconnectedBasins: boolean;
  scaleSignDiscontinuity: boolean;
  perturbationInstability: boolean;
  gateInstability: boolean;
  nestedClassificationInstability: boolean;
  refinementCoverageIncomplete: boolean;
}>;

export type RatioFovEnvelope = Readonly<{
  label: "strict" | "extended_4x" | "extended_10x";
  gridSource: "coarse" | "refined" | "combined";
  cellCount: number;
  ratioSpan: readonly [number, number] | null;
  fovSpanDeg: readonly [number, number] | null;
  ratioWidth: number | null;
  fovWidthDeg: number | null;
  correlation: number | null;
  fittedFovPerRatio: number | null;
  componentCount: number;
  confidenceComposition: Readonly<{ high: number; low: number }>;
  scaleSignBranches: readonly (1 | -1)[];
}>;

export type RatioFovFailureSummary = Readonly<{
  gridSource: "coarse";
  totalFailedCellCount: number;
  decompositionFailureCount: number;
  fovValuesWithAnyFailure: readonly number[];
  fovFailureIntervals: readonly (readonly [number, number])[];
  fovValuesAllRatiosFailed: readonly number[];
  fovValuesPartiallyFailed: readonly number[];
}>;

export type RatioFovPerturbationSample = Readonly<{
  corner: "NL" | "NR" | "FR" | "FL";
  axis: "x" | "y";
  deltaIntrinsicPx: -1 | 1;
  resultStatus: "success" | "failure";
  bestRatioDrift: number | null;
  bestFovDriftDeg: number | null;
  bestAvgPxChange: number | null;
  classification: RatioFovBasin["classification"] | null;
  selectedScaleSignChanged: boolean | null;
  firstFailingGateChanged: boolean | null;
}>;

export type RatioFovPerturbationSummary = Readonly<{
  enabled: boolean;
  samples: readonly RatioFovPerturbationSample[];
  maximumRatioDrift: number | null;
  maximumFovDriftDeg: number | null;
  scaleSignChangeCount: number;
  gateChangeCount: number;
  nestedClassificationChangeCount: number;
  failedRunCount: number;
  unstableSampleCount: number;
  driftConsistentWithDegenerateValley: boolean | null;
  instabilityInconsistentWithIsolatedOptimum: boolean | null;
}>;

export type RatioFovExperimentSuccess = Readonly<{
  status: "success";
  contractVersion: typeof RATIO_FOV_HARNESS_CONTRACT_VERSION;
  researchConfigVersion: typeof RATIO_FOV_RESEARCH_CONFIG_VERSION;
  safety: RatioFovResearchSafety;
  inputFingerprint: string;
  inputSummary: Readonly<{
    fixtureId: string | null;
    imageBasisFingerprint: string;
    coordinateSpace: "source-normalized/v1";
    frameSize: RatioFovFrameSize;
    semanticOrder: RatioFovSemanticOrder;
    referenceDepth: 1;
  }>;
  /** Exact one-time source-normalized -> source pixels -> object-cover frame pixels conversion. */
  frameFloorPolygonPx: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint];
  closedForm: RatioFovClosedForm;
  coarseSearch: Readonly<{ cells: readonly RatioFovCell[]; ratioDomain: RatioFovExperimentInput["ratioDomain"]; fovDomain: RatioFovExperimentInput["fovDomain"] }>;
  refinement: Readonly<{
    enabled: boolean;
    regions: readonly Readonly<{ ratio: readonly [number, number]; fovDeg: readonly [number, number] }>[];
    cells: readonly RatioFovCell[];
    competitiveCoarseComponentsCovered: boolean;
  }>;
  ranking: Readonly<{
    globallyRankedBest: RatioFovSuccessfulCell | null;
    /** Null unless the surface supports an isolated research recommendation. */
    isolatedResearchRecommendation: RatioFovSuccessfulCell | null;
    competitiveCells: readonly RatioFovSuccessfulCell[];
  }>;
  basin: RatioFovBasin;
  perturbation: RatioFovPerturbationSummary | null;
  warnings: readonly string[];
}>;

export type RatioFovExperimentFailure = Readonly<{
  status: "failure";
  contractVersion: typeof RATIO_FOV_HARNESS_CONTRACT_VERSION;
  researchConfigVersion: typeof RATIO_FOV_RESEARCH_CONFIG_VERSION;
  safety: RatioFovResearchSafety;
  code: RatioFovFailureCode;
  message: string;
  inputSummary: Readonly<{ fixtureId: string | null; imageBasisFingerprint: string | null }> | null;
}>;

export type RatioFovExperimentResult = RatioFovExperimentSuccess | RatioFovExperimentFailure;

type InternalRefinement = Readonly<{
  enabled: boolean;
  ratioStep: number;
  fovStepDeg: number;
  basinFactor: number;
  additivePxAllowance: number;
}>;

type CellEvaluationInput = Readonly<{
  frameSize: RatioFovFrameSize;
  frameFloorPolygonPx: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint];
  ratio: number;
  fovDeg: number;
  referenceDepth: number;
  /** Derived from validated research-input evidence; never live authority state. */
  researchBasisQualified?: boolean;
}>;

type ClosedFormCandidate = Readonly<{
  ratio: number;
  dotNumerator: number;
  dotDenominator: number;
  equalNormNumerator: number;
  equalNormDenominator: number;
  focalDot: number | null;
  focalEqualNorm: number | null;
  focalEstimate: number | null;
  discrepancy: number;
  orthogonalityObservabilityNormalized: number | null;
  rawOrthogonalityProductAtReferenceDepth1: number;
}>;

const SAFETY: RatioFovResearchSafety = Object.freeze({
  applied: false,
  authoritative: false,
  persisted: false,
  activeCameraUnchanged: true,
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function finitePositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function inputSummary(input: Partial<RatioFovExperimentInput> | null | undefined) {
  return input
    ? freeze({
        fixtureId: typeof input.fixtureId === "string" ? input.fixtureId : null,
        imageBasisFingerprint:
          input.imageBasis && typeof input.imageBasis.basisFingerprint === "string" ? input.imageBasis.basisFingerprint : null,
      })
    : null;
}

function failure(input: Partial<RatioFovExperimentInput> | null | undefined, code: RatioFovFailureCode, message: string) {
  return freeze({
    status: "failure" as const,
    contractVersion: RATIO_FOV_HARNESS_CONTRACT_VERSION,
    researchConfigVersion: RATIO_FOV_RESEARCH_CONFIG_VERSION,
    safety: SAFETY,
    code,
    message,
    inputSummary: inputSummary(input),
  });
}

function exactSemanticOrder(value: readonly string[] | undefined): value is RatioFovSemanticOrder {
  return !!value && value.length === 4 && value[0] === "NL" && value[1] === "NR" && value[2] === "FR" && value[3] === "FL";
}

function normalizeRefinement(input: RatioFovExperimentInput): InternalRefinement | RatioFovExperimentFailure {
  const refinement = input.refinement ? { ...DEFAULT_REFINEMENT, ...input.refinement } : DEFAULT_REFINEMENT;
  if (
    !finitePositive(refinement.ratioStep) ||
    !finitePositive(refinement.fovStepDeg) ||
    !finitePositive(refinement.basinFactor) ||
    !Number.isFinite(refinement.additivePxAllowance) ||
    refinement.additivePxAllowance < 0
  ) {
    return failure(input, "refinement", "Refinement steps and basin controls must be finite and positive (allowance may be zero).");
  }
  return freeze(refinement);
}

function validateInput(input: RatioFovExperimentInput): RatioFovExperimentFailure | InternalRefinement {
  if (input.contractVersion !== RATIO_FOV_HARNESS_CONTRACT_VERSION) {
    return failure(input, "contract_version", `Expected ${RATIO_FOV_HARNESS_CONTRACT_VERSION}.`);
  }
  if (input.coordinateSpace !== "source-normalized/v1") {
    return failure(input, "coordinate_space", "Only source-normalized/v1 Floor evidence is accepted.");
  }
  if (!exactSemanticOrder(input.semanticOrder)) {
    return failure(input, "semantic_order", "Labeled Floor evidence must declare semantic order [NL, NR, FR, FL].");
  }
  const validated = validateOrderedFloorCorners(input.sourceFloorPolygon.map((point) => ({ ...point })));
  if (!validated.ok) return failure(input, "floor_polygon", validated.reason);
  if (!finitePositiveInteger(input.imageBasis.decodedWidth) || !finitePositiveInteger(input.imageBasis.decodedHeight)) {
    return failure(input, "intrinsic_dimensions", "Decoded intrinsic dimensions must be finite positive integers.");
  }
  if (!finitePositiveInteger(input.frameSize.width) || !finitePositiveInteger(input.frameSize.height)) {
    return failure(input, "frame_dimensions", "Renderer-frame dimensions must be finite positive integers.");
  }
  if (input.imageBasis.basisKind !== "original") {
    return failure(input, "basis_kind", "Research input must use an original image basis.");
  }
  if (input.imageBasis.coordinateSpaceVersion.orientationApplied) {
    return failure(input, "orientation", "Research fixtures require orientationApplied=false.");
  }
  if (
    !input.imageBasis.basisId ||
    !input.imageBasis.basisFingerprint ||
    !input.imageBasis.coordinateSpaceVersion.decoderId ||
    !input.imageBasis.coordinateSpaceVersion.normalizationPolicyVersion
  ) {
    return failure(input, "basis_identity", "Image-basis identity and coordinate-space fields must be present.");
  }
  if (
    !finitePositive(input.ratioDomain.min) ||
    !finitePositive(input.ratioDomain.max) ||
    !finitePositive(input.ratioDomain.step) ||
    input.ratioDomain.min > input.ratioDomain.max
  ) {
    return failure(input, "ratio_domain", "Ratio domain must be finite, positive, ascending, and have a positive step.");
  }
  if (
    !finitePositive(input.fovDomain.stepDeg) ||
    !Number.isFinite(input.fovDomain.minDeg) ||
    !Number.isFinite(input.fovDomain.maxDeg) ||
    input.fovDomain.minDeg > input.fovDomain.maxDeg ||
    input.fovDomain.minDeg < MIN_FOV_DEG ||
    input.fovDomain.maxDeg > MAX_FOV_DEG
  ) {
    return failure(input, "fov_domain", "FOV domain must remain within the production-supported inclusive [20°, 90°] interval.");
  }
  if (input.referenceDepth !== 1) return failure(input, "reference_depth", "AFC-R1 requires referenceDepth exactly equal to 1.");
  return normalizeRefinement(input);
}

function sourcePolygonToFramePixels(input: RatioFovExperimentInput): readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint] | null {
  const crop = getCoverCrop(
    { width: input.imageBasis.decodedWidth, height: input.imageBasis.decodedHeight },
    input.frameSize
  );
  if (!crop) return null;
  // Deliberately not sourceNormToContainerNorm: diagnostics must retain any
  // legitimate out-of-frame magnitude instead of UI-oriented clamping.
  return freeze(
    input.sourceFloorPolygon.map((point) =>
      freeze({
        x: point.x * input.imageBasis.decodedWidth * crop.scale + crop.offsetX,
        y: point.y * input.imageBasis.decodedHeight * crop.scale + crop.offsetY,
      })
    ) as [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint]
  );
}

function vectorDirection(from: Vec3, to: Vec3): Vec3 {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const z = to.z - from.z;
  const length = Math.hypot(x, y, z);
  return length > 0 ? { x: x / length, y: y / length, z: z / length } : { x: 0, y: 0, z: 0 };
}

function normalized(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : { x: 0, y: 0, z: 0 };
}

function minPositiveDepth(rotation: readonly number[], translation: Vec3, planePoints: readonly Vec2[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const point of planePoints) {
    const depth = rotation[6] * point.x + rotation[7] * point.y + translation.z;
    if (depth > 0 && depth < minimum) minimum = depth;
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function renderedReprojection(
  pose: CameraPose,
  frameSize: RatioFovFrameSize,
  fovDeg: number,
  floorPlanePoints: readonly Vec2[],
  imagePoints: readonly Vec2[]
): { average: number; maximum: number } | null {
  let total = 0;
  let maximum = 0;
  for (let index = 0; index < floorPlanePoints.length; index += 1) {
    const projection = projectFloorPointThroughPose(pose, frameSize, { verticalFovDeg: fovDeg }, floorPlanePoints[index]);
    if (!projection.ok) return null;
    const error = Math.hypot(projection.value.x - imagePoints[index].x, projection.value.y - imagePoints[index].y);
    if (!Number.isFinite(error)) return null;
    total += error;
    maximum = Math.max(maximum, error);
  }
  return { average: total / floorPlanePoints.length, maximum };
}

/**
 * Public pure cell evaluator. Tests use referenceDepth values other than one to
 * prove scale invariance; the top-level harness intentionally fixes it at one.
 */
export function evaluateRatioFovCell(input: CellEvaluationInput): RatioFovCell {
  const rectangle = getFloorRectCorners({ widthMeters: input.ratio * input.referenceDepth, depthMeters: input.referenceDepth });
  if (!rectangle.ok) return freeze({ status: "failure", ratio: input.ratio, fovDeg: input.fovDeg, failureReason: rectangle.reason });
  const floorPlanePoints = rectangle.value.asArray.map(floorVec3ToPlane2D);
  const homography = solvePlaneHomography([...input.frameFloorPolygonPx], floorPlanePoints);
  if (!homography.ok) return freeze({ status: "failure", ratio: input.ratio, fovDeg: input.fovDeg, failureReason: homography.reason });
  const decomposition = decomposeHomographyToCameraPose(
    homography.value,
    input.frameSize,
    { verticalFovDeg: input.fovDeg },
    { floorPlanePoints2D: floorPlanePoints, imagePointsPx: [...input.frameFloorPolygonPx] }
  );
  if (!decomposition.ok) {
    return freeze({ status: "failure", ratio: input.ratio, fovDeg: input.fovDeg, failureReason: decomposition.reason });
  }

  const diagnostics = decomposition.value.diagnostics;
  const perCorner = diagnostics.perCornerCvReprojectionPx;
  if (!perCorner || perCorner.length !== 4 || !perCorner.every(Number.isFinite)) {
    return freeze({ status: "failure", ratio: input.ratio, fovDeg: input.fovDeg, failureReason: "CV per-corner diagnostics unavailable." });
  }
  const display = renderedReprojection(
    decomposition.value.pose,
    input.frameSize,
    input.fovDeg,
    floorPlanePoints,
    input.frameFloorPolygonPx
  );
  if (!display) return freeze({ status: "failure", ratio: input.ratio, fovDeg: input.fovDeg, failureReason: "Display reprojection diagnostics unavailable." });

  const apply = evaluateCalibratedCameraApply(
    {
      confidence: decomposition.confidence,
      cvAvgPx: diagnostics.averageCameraPoseReprojectionPx,
      cvMaxPx: diagnostics.maxCameraPoseReprojectionPx,
      displayAvgPx: display.average,
      displayMaxPx: display.maximum,
      scaleRatio: diagnostics.columnScaleRatio,
      frameSize: input.frameSize,
    },
    null,
    {
      basisQualified: input.researchBasisQualified ?? false,
      basisUnavailableReason: "research input basis qualification was not established",
    }
  );
  const pose = decomposition.value.pose;
  const translation = decomposition.value.cvProjection.translationCv;
  const direction = vectorDirection(pose.position, pose.lookAt);
  return freeze({
    status: "success" as const,
    ratio: input.ratio,
    fovDeg: input.fovDeg,
    confidence: decomposition.confidence,
    cvAvgPx: diagnostics.averageCameraPoseReprojectionPx,
    cvMaxPx: diagnostics.maxCameraPoseReprojectionPx,
    perCornerCvReprojectionPx: [...perCorner],
    columnScaleRatio: diagnostics.columnScaleRatio,
    orthonormalityError: diagnostics.orthonormalityError,
    rotationDeterminant: diagnostics.determinant,
    selectedScaleSign: diagnostics.selectedScaleSign,
    candidatesPassingCheirality: diagnostics.candidatesPassingCheirality ?? 0,
    minimumPositiveDepth: minPositiveDepth(decomposition.value.cvProjection.rotationPlaneToCv, translation, floorPlanePoints),
    cameraHeight: pose.position.y,
    cameraHeightOverReferenceDepth: pose.position.y / input.referenceDepth,
    position: { ...pose.position },
    lookAt: { ...pose.lookAt },
    up: { ...pose.up },
    normalizedLookDirection: direction,
    normalizedTranslationDirection: normalized(translation),
    applyObservability: {
      available: apply.available,
      firstFailingGate: apply.firstFailingGate,
      reason: apply.reason,
      displayAvgPx: display.average,
      displayMaxPx: display.maximum,
      averageDeltaPx: Math.abs(display.average - diagnostics.averageCameraPoseReprojectionPx),
      maximumDeltaPx: Math.abs(display.maximum - diagnostics.maxCameraPoseReprojectionPx),
    },
    solverWarning: decomposition.note ?? diagnostics.reason ?? null,
  });
}

function valuesInRange(minimum: number, maximum: number, step: number): number[] {
  const count = Math.floor((maximum - minimum) / step + 1e-9);
  const values: number[] = [];
  for (let index = 0; index <= count; index += 1) values.push(Number((minimum + index * step).toPrecision(14)));
  return values;
}

function evaluateGrid(
  frameSize: RatioFovFrameSize,
  polygon: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint],
  ratios: readonly number[],
  fovs: readonly number[],
  researchBasisQualified: boolean
): RatioFovCell[] {
  const cells: RatioFovCell[] = [];
  // Ascending ratio, then ascending FOV is part of the deterministic contract.
  for (const ratio of ratios) {
    for (const fovDeg of fovs) {
      cells.push(
        evaluateRatioFovCell({
          frameSize,
          frameFloorPolygonPx: polygon,
          ratio,
          fovDeg,
          referenceDepth: 1,
          researchBasisQualified,
        })
      );
    }
  }
  return cells;
}

function rankCells(cells: readonly RatioFovSuccessfulCell[]): RatioFovSuccessfulCell[] {
  return [...cells].sort((left, right) => {
    if (left.confidence !== right.confidence) return left.confidence === "high" ? -1 : 1;
    if (left.cvAvgPx !== right.cvAvgPx) return left.cvAvgPx - right.cvAvgPx;
    if (left.cvMaxPx !== right.cvMaxPx) return left.cvMaxPx - right.cvMaxPx;
    if (left.fovDeg !== right.fovDeg) return left.fovDeg - right.fovDeg;
    return left.ratio - right.ratio;
  });
}

function successful(cells: readonly RatioFovCell[]): RatioFovSuccessfulCell[] {
  return cells.filter((cell): cell is RatioFovSuccessfulCell => cell.status === "success");
}

function competitiveCells(
  cells: readonly RatioFovCell[],
  refinement: Pick<InternalRefinement, "basinFactor" | "additivePxAllowance">
): RatioFovSuccessfulCell[] {
  const ranked = rankCells(successful(cells));
  const best = ranked[0];
  if (!best) return [];
  const allowedConfidence = best.confidence;
  const threshold = Math.max(best.cvAvgPx * refinement.basinFactor, best.cvAvgPx + refinement.additivePxAllowance);
  return ranked.filter((cell) => cell.confidence === allowedConfidence && cell.cvAvgPx <= threshold);
}

/**
 * Grid-aware connectivity. A two-ratio-step/five-FOV-step allowance keeps
 * a sampled diagonal ridge connected when its expected slope crosses more than
 * one FOV sample per ratio sample, while still separating genuinely distant
 * islands. Coarse and refined grids are never mixed in one invocation.
 */
export function gridAwareComponents(
  candidates: readonly RatioFovSuccessfulCell[],
  ratioStep: number,
  fovStep: number
): RatioFovSuccessfulCell[][] {
  const remaining = new Map(candidates.map((cell) => [`${cell.ratio}|${cell.fovDeg}`, cell]));
  const components: RatioFovSuccessfulCell[][] = [];
  const adjacent = (left: RatioFovSuccessfulCell, right: RatioFovSuccessfulCell) =>
    Math.abs(left.ratio - right.ratio) <= ratioStep * 2 + 1e-8 &&
    Math.abs(left.fovDeg - right.fovDeg) <= fovStep * 5 + 1e-8 &&
    (left.ratio !== right.ratio || left.fovDeg !== right.fovDeg);
  while (remaining.size) {
    const first = remaining.values().next().value as RatioFovSuccessfulCell;
    remaining.delete(`${first.ratio}|${first.fovDeg}`);
    const component = [first];
    for (let index = 0; index < component.length; index += 1) {
      const current = component[index];
      for (const [key, candidate] of remaining) {
        if (adjacent(current, candidate)) {
          remaining.delete(key);
          component.push(candidate);
        }
      }
    }
    components.push(component.sort((a, b) => a.ratio - b.ratio || a.fovDeg - b.fovDeg));
  }
  return components;
}

export type RatioFovRefinementRegion = Readonly<{ ratio: readonly [number, number]; fovDeg: readonly [number, number] }>;

const REFINEMENT_REGION_EPSILON = 1e-8;

/**
 * Two rectangles merge only when both dimensions overlap or touch within one
 * coarse search step. The predicate is symmetric and inclusive; that halo is
 * the existing refinement-region merge tolerance, not grid connectivity.
 */
export function refinementRegionsOverlapOrTouch(
  left: RatioFovRefinementRegion,
  right: RatioFovRefinementRegion,
  ratioTolerance: number,
  fovTolerance: number
): boolean {
  return (
    left.ratio[0] <= right.ratio[1] + ratioTolerance + REFINEMENT_REGION_EPSILON &&
    right.ratio[0] <= left.ratio[1] + ratioTolerance + REFINEMENT_REGION_EPSILON &&
    left.fovDeg[0] <= right.fovDeg[1] + fovTolerance + REFINEMENT_REGION_EPSILON &&
    right.fovDeg[0] <= left.fovDeg[1] + fovTolerance + REFINEMENT_REGION_EPSILON
  );
}

function unionRefinementRegions(left: RatioFovRefinementRegion, right: RatioFovRefinementRegion): RatioFovRefinementRegion {
  return {
    ratio: [Math.min(left.ratio[0], right.ratio[0]), Math.max(left.ratio[1], right.ratio[1])],
    fovDeg: [Math.min(left.fovDeg[0], right.fovDeg[0]), Math.max(left.fovDeg[1], right.fovDeg[1])],
  };
}

/** Pure transitive, order-independent rectangle union. */
export function mergeRefinementRegions(
  regions: readonly RatioFovRefinementRegion[],
  ratioTolerance: number,
  fovTolerance: number
): RatioFovRefinementRegion[] {
  const pending = regions
    .map((region) => ({ ratio: [...region.ratio] as [number, number], fovDeg: [...region.fovDeg] as [number, number] }))
    .sort((left, right) => left.ratio[0] - right.ratio[0] || left.fovDeg[0] - right.fovDeg[0]);
  const merged: RatioFovRefinementRegion[] = [];
  for (const region of pending) {
    let union: RatioFovRefinementRegion = region;
    let foundMerge = true;
    // Restart after each union so a bridging region merges every connected
    // predecessor, not merely the most recently appended rectangle.
    while (foundMerge) {
      foundMerge = false;
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (refinementRegionsOverlapOrTouch(union, merged[index], ratioTolerance, fovTolerance)) {
          union = unionRefinementRegions(union, merged[index]);
          merged.splice(index, 1);
          foundMerge = true;
        }
      }
    }
    merged.push(union);
  }
  return merged
    .sort((left, right) => left.ratio[0] - right.ratio[0] || left.fovDeg[0] - right.fovDeg[0])
    .map((region) => freeze({ ratio: [...region.ratio] as [number, number], fovDeg: [...region.fovDeg] as [number, number] }));
}

/** One clamped, padded coverage rectangle per competitive coarse component. */
export function componentRefinementRegions(
  components: readonly RatioFovSuccessfulCell[][],
  input: RatioFovExperimentInput
): RatioFovRefinementRegion[] {
  return components.map((component) =>
    freeze({
    ratio: [
      Math.max(input.ratioDomain.min, Math.min(...component.map((cell) => cell.ratio)) - input.ratioDomain.step),
      Math.min(input.ratioDomain.max, Math.max(...component.map((cell) => cell.ratio)) + input.ratioDomain.step),
    ] as [number, number],
    fovDeg: [
      Math.max(input.fovDomain.minDeg, Math.min(...component.map((cell) => cell.fovDeg)) - input.fovDomain.stepDeg),
      Math.min(input.fovDomain.maxDeg, Math.max(...component.map((cell) => cell.fovDeg)) + input.fovDomain.stepDeg),
    ] as [number, number],
    })
  );
}

export function refinementRegions(
  components: readonly RatioFovSuccessfulCell[][],
  input: RatioFovExperimentInput
): RatioFovRefinementRegion[] {
  return mergeRefinementRegions(componentRefinementRegions(components, input), input.ratioDomain.step, input.fovDomain.stepDeg);
}

function componentCoveredByRegion(component: readonly RatioFovSuccessfulCell[], regions: readonly RatioFovRefinementRegion[]): boolean {
  return component.every((cell) =>
    regions.some(
      (region) =>
        cell.ratio >= region.ratio[0] - REFINEMENT_REGION_EPSILON &&
        cell.ratio <= region.ratio[1] + REFINEMENT_REGION_EPSILON &&
        cell.fovDeg >= region.fovDeg[0] - REFINEMENT_REGION_EPSILON &&
        cell.fovDeg <= region.fovDeg[1] + REFINEMENT_REGION_EPSILON
    )
  );
}

export function competitiveCoarseComponentsCoveredByRegions(
  components: readonly RatioFovSuccessfulCell[][],
  regions: readonly RatioFovRefinementRegion[]
): boolean {
  return components.every((component) => componentCoveredByRegion(component, regions));
}

function successfulCellsWithinRegion(
  refinedCells: readonly RatioFovCell[],
  region: RatioFovRefinementRegion
): RatioFovSuccessfulCell[] {
  return successful(refinedCells).filter(
    (cell) =>
      cell.ratio >= region.ratio[0] - REFINEMENT_REGION_EPSILON &&
      cell.ratio <= region.ratio[1] + REFINEMENT_REGION_EPSILON &&
      cell.fovDeg >= region.fovDeg[0] - REFINEMENT_REGION_EPSILON &&
      cell.fovDeg <= region.fovDeg[1] + REFINEMENT_REGION_EPSILON
  );
}

/**
 * Preserve every competitive coarse component through refinement. Each
 * component is re-thresholded within its own original coverage rectangle;
 * a sharper result in another component therefore cannot erase this basin.
 */
export function strictRefinedCellsByCoarseCoverage(
  refinedCells: readonly RatioFovCell[],
  coarseComponents: readonly RatioFovSuccessfulCell[][],
  componentRegions: readonly RatioFovRefinementRegion[],
  refinement: Readonly<{ basinFactor: number; additivePxAllowance: number }>
): RatioFovSuccessfulCell[] {
  const selected = coarseComponents.flatMap((component, index) => {
    const componentRefined = successfulCellsWithinRegion(refinedCells, componentRegions[index]);
    return componentRefined.length > 0 ? competitiveCells(componentRefined, refinement) : component;
  });
  const unique = new Map<string, RatioFovSuccessfulCell>();
  for (const cell of selected) unique.set(`${cell.ratio}|${cell.fovDeg}`, cell);
  return [...unique.values()].sort((left, right) => left.ratio - right.ratio || left.fovDeg - right.fovDeg);
}

function inverseHomographyForClosedForm(floorPoints: readonly Vec2[], imagePoints: readonly Vec2[]): number[] | null {
  const inverse = solvePlaneHomography([...floorPoints], [...imagePoints]);
  return inverse.ok ? inverse.value : null;
}

/**
 * Dimensionless centered-column orthogonality observable for a floor->image
 * homography. Uniform world scaling changes both floor->image columns by the
 * same reciprocal factor; arbitrary H scaling changes them by the same factor.
 * Both cancel in this normalized dot product.
 */
export function normalizedCenteredColumnOrthogonality(
  floorToImageHomography: readonly number[],
  frameSize: RatioFovFrameSize
): number | null {
  if (floorToImageHomography.length !== 9) return null;
  const [h11, h12, , h21, h22, , h31, h32] = floorToImageHomography;
  const a = h11 - (frameSize.width / 2) * h31;
  const d = h21 - (frameSize.height / 2) * h31;
  const b = h12 - (frameSize.width / 2) * h32;
  const e = h22 - (frameSize.height / 2) * h32;
  const denominator = Math.hypot(a, d) * Math.hypot(b, e);
  const numerator = Math.abs(a * b + d * e);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? Math.min(1, numerator / denominator)
    : null;
}

/**
 * For floor->image H and centered K, the first two K⁻¹H columns must be
 * orthogonal and equal-norm. Each equation independently estimates f².
 * The difference between those estimates is observability only, never authority.
 */
function closedFormForRatio(
  ratio: number,
  polygon: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint],
  frameSize: RatioFovFrameSize
): ClosedFormCandidate | null {
  const rectangle = getFloorRectCorners({ widthMeters: ratio, depthMeters: 1 });
  if (!rectangle.ok) return null;
  const floorPoints = rectangle.value.asArray.map(floorVec3ToPlane2D);
  const h = inverseHomographyForClosedForm(floorPoints, polygon);
  if (!h) return null;
  const cx = frameSize.width / 2;
  const cy = frameSize.height / 2;
  const a = h[0] - cx * h[6];
  const d = h[3] - cy * h[6];
  const b = h[1] - cx * h[7];
  const e = h[4] - cy * h[7];
  const dotNumerator = -(a * b + d * e);
  const dotDenominator = h[6] * h[7];
  const equalNormNumerator = -((a * a + d * d) - (b * b + e * e));
  const equalNormDenominator = h[6] * h[6] - h[7] * h[7];
  const squaredDot = dotDenominator === 0 ? null : dotNumerator / dotDenominator;
  const squaredEqual = equalNormDenominator === 0 ? null : equalNormNumerator / equalNormDenominator;
  const focalDot = squaredDot !== null && squaredDot > 0 && Number.isFinite(squaredDot) ? Math.sqrt(squaredDot) : null;
  const focalEqualNorm =
    squaredEqual !== null && squaredEqual > 0 && Number.isFinite(squaredEqual) ? Math.sqrt(squaredEqual) : null;
  // The orthogonality equation is the primary focal estimate. Equal-norm is
  // intentionally retained as an independent conditioning residual: averaging
  // the two would turn its Euclidean-model mismatch into a biased estimate.
  const focalEstimate = focalDot ?? focalEqualNorm;
  const discrepancy =
    focalDot !== null && focalEqualNorm !== null ? Math.abs(focalDot - focalEqualNorm) / Math.max(focalDot, focalEqualNorm) : Number.POSITIVE_INFINITY;
  // c1/c2 are the first two centered image-plane components of floor->image H.
  // Their normalized dot is dimensionless and is unchanged by H -> kH or by
  // uniformly scaling the assumed world rectangle (both columns scale equally).
  const orthogonalityObservabilityNormalized = normalizedCenteredColumnOrthogonality(h, frameSize);
  return {
    ratio,
    dotNumerator,
    dotDenominator,
    equalNormNumerator,
    equalNormDenominator,
    focalDot,
    focalEqualNorm,
    focalEstimate,
    discrepancy,
    orthogonalityObservabilityNormalized,
    rawOrthogonalityProductAtReferenceDepth1: Math.abs(dotNumerator * dotDenominator),
  };
}

function closedFormObservability(
  ratios: readonly number[],
  polygon: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint],
  frameSize: RatioFovFrameSize
): RatioFovClosedForm {
  const candidates = ratios
    .map((ratio) => closedFormForRatio(ratio, polygon, frameSize))
    .filter((candidate): candidate is ClosedFormCandidate => candidate !== null);
  const usable = candidates.filter((candidate) => candidate.focalEstimate !== null && Number.isFinite(candidate.discrepancy));
  const selected = [...usable].sort((a, b) => a.discrepancy - b.discrepancy || a.ratio - b.ratio)[0] ?? null;
  const warnings: string[] = [];
  if (!selected) {
    warnings.push("No positive finite focal estimate with finite equal-norm discrepancy exists under the centered-principal-point assumption.");
  }
  const observability = selected?.orthogonalityObservabilityNormalized ?? null;
  // This normalized signal is research-only and is corroborated by surface
  // geometry/perturbations before it can contribute to classification.
  const hint =
    !selected || observability === null || !Number.isFinite(observability)
      ? "degenerate"
      : observability < RATIO_FOV_WEAK_ORTHOGONALITY_OBSERVABILITY_NORMALIZED || selected.discrepancy > 0.2
        ? "weakly_conditioned"
        : "well_conditioned";
  if (hint !== "well_conditioned") warnings.push("Conditioning threshold is exploratory and not a production camera-quality gate.");
  const focal = selected?.focalEstimate ?? null;
  const fov = focal && focal > 0 ? (2 * Math.atan(frameSize.height / (2 * focal)) * 180) / Math.PI : null;
  return freeze({
    methodVersion: "afc-r1h-centered-principal-point/v2" as const,
    selectedClosedFormGridRatio: selected?.ratio ?? null,
    conditioningDotNumerator: selected?.dotNumerator ?? null,
    conditioningDotDenominator: selected?.dotDenominator ?? null,
    conditioningEqualNormNumerator: selected?.equalNormNumerator ?? null,
    conditioningEqualNormDenominator: selected?.equalNormDenominator ?? null,
    orthogonalityObservabilityNormalized: observability,
    rawOrthogonalityProductAtReferenceDepth1: selected?.rawOrthogonalityProductAtReferenceDepth1 ?? null,
    equalNormDiscrepancy: selected?.discrepancy ?? null,
    sign: !selected || selected.dotNumerator * selected.dotDenominator === 0 ? 0 : selected.dotNumerator * selected.dotDenominator > 0 ? 1 : -1,
    finiteFocalEstimate: focal !== null,
    estimatedFocalLengthFramePx: focal,
    estimatedVerticalFovDeg: fov,
    classificationHint: hint,
    numericalWarnings: warnings,
  });
}

function covarianceSlope(cells: readonly RatioFovSuccessfulCell[]): { slope: number | null; correlation: number | null } {
  if (cells.length < 2) return { slope: null, correlation: null };
  const meanRatio = cells.reduce((sum, cell) => sum + cell.ratio, 0) / cells.length;
  const meanFov = cells.reduce((sum, cell) => sum + cell.fovDeg, 0) / cells.length;
  let ratioVariance = 0;
  let fovVariance = 0;
  let covariance = 0;
  for (const cell of cells) {
    const ratioDelta = cell.ratio - meanRatio;
    const fovDelta = cell.fovDeg - meanFov;
    ratioVariance += ratioDelta * ratioDelta;
    fovVariance += fovDelta * fovDelta;
    covariance += ratioDelta * fovDelta;
  }
  return {
    slope: ratioVariance > 0 ? covariance / ratioVariance : null,
    correlation: ratioVariance > 0 && fovVariance > 0 ? covariance / Math.sqrt(ratioVariance * fovVariance) : null,
  };
}

function envelope(
  label: RatioFovEnvelope["label"],
  gridSource: RatioFovEnvelope["gridSource"],
  cells: readonly RatioFovSuccessfulCell[],
  ratioStep: number,
  fovStep: number
): RatioFovEnvelope {
  if (cells.length === 0) {
    return freeze({
      label,
      gridSource,
      cellCount: 0,
      ratioSpan: null,
      fovSpanDeg: null,
      ratioWidth: null,
      fovWidthDeg: null,
      correlation: null,
      fittedFovPerRatio: null,
      componentCount: 0,
      confidenceComposition: { high: 0, low: 0 },
      scaleSignBranches: [],
    });
  }
  const ratios = cells.map((cell) => cell.ratio);
  const fovs = cells.map((cell) => cell.fovDeg);
  const ratioSpan: [number, number] = [Math.min(...ratios), Math.max(...ratios)];
  const fovSpanDeg: [number, number] = [Math.min(...fovs), Math.max(...fovs)];
  const covariance = covarianceSlope(cells);
  return freeze({
    label,
    gridSource,
    cellCount: cells.length,
    ratioSpan,
    fovSpanDeg,
    ratioWidth: ratioSpan[1] - ratioSpan[0],
    fovWidthDeg: fovSpanDeg[1] - fovSpanDeg[0],
    correlation: covariance.correlation,
    fittedFovPerRatio: covariance.slope,
    componentCount: gridAwareComponents(cells, ratioStep, fovStep).length,
    confidenceComposition: {
      high: cells.filter((cell) => cell.confidence === "high").length,
      low: cells.filter((cell) => cell.confidence === "low").length,
    },
    scaleSignBranches: [...new Set(cells.map((cell) => cell.selectedScaleSign))].sort(),
  });
}

function extendedCells(cells: readonly RatioFovCell[], factor: number, allowance: number): RatioFovSuccessfulCell[] {
  const ranked = rankCells(successful(cells));
  const best = ranked[0];
  if (!best) return [];
  const threshold = Math.max(best.cvAvgPx * factor, best.cvAvgPx + allowance);
  return ranked.filter((cell) => cell.confidence === best.confidence && cell.cvAvgPx <= threshold);
}

function failureSummary(cells: readonly RatioFovCell[], fovStep: number): RatioFovFailureSummary {
  const failures = cells.filter((cell): cell is RatioFovFailedCell => cell.status === "failure");
  const byFov = new Map<number, { success: number; failure: number }>();
  for (const cell of cells) {
    const counts = byFov.get(cell.fovDeg) ?? { success: 0, failure: 0 };
    counts[cell.status] += 1;
    byFov.set(cell.fovDeg, counts);
  }
  const fovValuesWithAnyFailure = [...byFov.entries()]
    .filter(([, counts]) => counts.failure > 0)
    .map(([fov]) => fov)
    .sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (const fov of fovValuesWithAnyFailure) {
    const last = intervals[intervals.length - 1];
    if (last && Math.abs(fov - last[1] - fovStep) <= 1e-8) last[1] = fov;
    else intervals.push([fov, fov]);
  }
  return freeze({
    gridSource: "coarse" as const,
    totalFailedCellCount: failures.length,
    // Production decomposition reports a combined cheirality/reprojection
    // umbrella reason, so this intentionally does not claim cheirality alone.
    decompositionFailureCount: failures.length,
    fovValuesWithAnyFailure,
    fovFailureIntervals: intervals,
    fovValuesAllRatiosFailed: [...byFov.entries()]
      .filter(([, counts]) => counts.failure > 0 && counts.success === 0)
      .map(([fov]) => fov)
      .sort((a, b) => a - b),
    fovValuesPartiallyFailed: [...byFov.entries()]
      .filter(([, counts]) => counts.failure > 0 && counts.success > 0)
      .map(([fov]) => fov)
      .sort((a, b) => a - b),
  });
}

export function classifyRatioFovBasin(
  strictEnvelope: RatioFovEnvelope,
  signals: RatioFovClassificationSignals
): RatioFovBasin["classification"] {
  if (strictEnvelope.cellCount === 0) return "no_valid_solution";
  if (
    signals.scaleSignDiscontinuity ||
    signals.perturbationInstability ||
    signals.gateInstability ||
    signals.nestedClassificationInstability ||
    signals.refinementCoverageIncomplete
  ) {
    return "unstable_branch";
  }
  if (signals.multipleDisconnectedBasins) return "multiple_competing_basins";
  if (signals.observabilityUnavailable) return "degenerate_valley";
  if (
    signals.weakClosedFormObservability &&
    (signals.broadExtendedValley || signals.strongValleyCorrelation || signals.perturbationInstability)
  ) {
    return "degenerate_valley";
  }
  return "isolated_optimum";
}

function basinSummary(
  strictCompetitiveEnvelope: RatioFovEnvelope,
  extendedValleyEnvelope4x: RatioFovEnvelope,
  extendedValleyEnvelope10x: RatioFovEnvelope,
  failure: RatioFovFailureSummary,
  closedForm: RatioFovClosedForm,
  perturbation: RatioFovPerturbationSummary | null,
  refinementCoverageIncomplete: boolean
): RatioFovBasin {
  const observabilityUnavailable =
    closedForm.orthogonalityObservabilityNormalized === null ||
    !Number.isFinite(closedForm.orthogonalityObservabilityNormalized);
  const weakClosedFormObservability =
    !observabilityUnavailable &&
    closedForm.orthogonalityObservabilityNormalized < RATIO_FOV_WEAK_ORTHOGONALITY_OBSERVABILITY_NORMALIZED;
  const broadExtendedValley =
    (extendedValleyEnvelope10x.ratioWidth ?? 0) >= 0.4 || (extendedValleyEnvelope10x.fovWidthDeg ?? 0) >= 15;
  const strongValleyCorrelation =
    Math.abs(extendedValleyEnvelope10x.correlation ?? 0) >= 0.9 &&
    (extendedValleyEnvelope10x.ratioWidth ?? 0) >= 0.2 &&
    (extendedValleyEnvelope10x.fovWidthDeg ?? 0) >= 10;
  const valleyStructure = weakClosedFormObservability && (broadExtendedValley || strongValleyCorrelation);
  const failedRunCount = perturbation?.failedRunCount ?? 0;
  const scaleSignDiscontinuity =
    strictCompetitiveEnvelope.scaleSignBranches.length > 1 || (perturbation?.scaleSignChangeCount ?? 0) > 0;
  const gateInstability = (perturbation?.gateChangeCount ?? 0) > 0;
  const nestedClassificationInstability =
    (perturbation?.nestedClassificationChangeCount ?? 0) > 0 && !valleyStructure;
  const driftTooLargeForIsolated =
    (perturbation?.maximumRatioDrift ?? 0) > 0.025 || (perturbation?.maximumFovDriftDeg ?? 0) > 0.5;
  const perturbationInstability =
    failedRunCount > 0 || (driftTooLargeForIsolated && !valleyStructure) || (perturbation?.instabilityInconsistentWithIsolatedOptimum ?? false);
  const signals = freeze({
    weakClosedFormObservability,
    observabilityUnavailable,
    broadExtendedValley,
    strongValleyCorrelation,
    multipleDisconnectedBasins: strictCompetitiveEnvelope.componentCount > 1,
    scaleSignDiscontinuity,
    perturbationInstability,
    gateInstability,
    nestedClassificationInstability,
    refinementCoverageIncomplete,
  });
  return freeze({
    classification: classifyRatioFovBasin(strictCompetitiveEnvelope, signals),
    classificationSignals: signals,
    strictCompetitiveEnvelope,
    extendedValleyEnvelope4x,
    extendedValleyEnvelope10x,
    failureSummary: failure,
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function ratioFovInputFingerprint(input: RatioFovExperimentInput): string {
  return fnv1a32(
    stableStringify({
      contractVersion: input.contractVersion,
      researchConfigVersion: RATIO_FOV_RESEARCH_CONFIG_VERSION,
      fixtureId: input.fixtureId ?? null,
      coordinateSpace: input.coordinateSpace,
      basisId: input.imageBasis.basisId,
      basisFingerprint: input.imageBasis.basisFingerprint,
      decodedWidth: input.imageBasis.decodedWidth,
      decodedHeight: input.imageBasis.decodedHeight,
      decoderId: input.imageBasis.coordinateSpaceVersion.decoderId,
      normalizationPolicyVersion: input.imageBasis.coordinateSpaceVersion.normalizationPolicyVersion,
      orientationApplied: input.imageBasis.coordinateSpaceVersion.orientationApplied,
      basisKind: input.imageBasis.basisKind,
      frameSize: input.frameSize,
      semanticOrder: input.semanticOrder,
      sourceFloorPolygon: input.sourceFloorPolygon,
      ratioDomain: input.ratioDomain,
      fovDomain: input.fovDomain,
      refinement: input.refinement ?? DEFAULT_REFINEMENT,
      referenceDepth: input.referenceDepth,
      perturbation: input.perturbation ?? { enabled: false },
    })
  );
}

function deriveResearchBasisQualification(input: RatioFovExperimentInput): boolean {
  const ordered = validateOrderedFloorCorners(input.sourceFloorPolygon.map((point) => ({ ...point })));
  return (
    input.coordinateSpace === "source-normalized/v1" &&
    input.imageBasis.basisKind === "original" &&
    input.imageBasis.coordinateSpaceVersion.orientationApplied === false &&
    input.imageBasis.basisId.length > 0 &&
    input.imageBasis.basisFingerprint.length > 0 &&
    input.imageBasis.coordinateSpaceVersion.decoderId.length > 0 &&
    input.imageBasis.coordinateSpaceVersion.normalizationPolicyVersion.length > 0 &&
    finitePositiveInteger(input.imageBasis.decodedWidth) &&
    finitePositiveInteger(input.imageBasis.decodedHeight) &&
    ordered.ok
  );
}

function perturbationSummary(
  input: RatioFovExperimentInput,
  baseline: RatioFovExperimentSuccess
): RatioFovPerturbationSummary {
  if (!input.perturbation?.enabled) {
    return freeze({
      enabled: false,
      samples: [],
      maximumRatioDrift: null,
      maximumFovDriftDeg: null,
      scaleSignChangeCount: 0,
      gateChangeCount: 0,
      nestedClassificationChangeCount: 0,
      failedRunCount: 0,
      unstableSampleCount: 0,
      driftConsistentWithDegenerateValley: null,
      instabilityInconsistentWithIsolatedOptimum: null,
    });
  }
  const baselineBest = baseline.ranking.globallyRankedBest;
  const axes = [
    ["x", 1],
    ["x", -1],
    ["y", 1],
    ["y", -1],
  ] as const;
  const labels = ["NL", "NR", "FR", "FL"] as const;
  const samples: RatioFovPerturbationSample[] = [];
  for (let index = 0; index < input.sourceFloorPolygon.length; index += 1) {
    for (const [axis, deltaIntrinsicPx] of axes) {
      const polygon = input.sourceFloorPolygon.map((point) => ({ ...point })) as [
        RatioFovPoint,
        RatioFovPoint,
        RatioFovPoint,
        RatioFovPoint,
      ];
      polygon[index] = {
        ...polygon[index],
        [axis]: polygon[index][axis] + deltaIntrinsicPx / (axis === "x" ? input.imageBasis.decodedWidth : input.imageBasis.decodedHeight),
      };
      const run = runRatioFovExperiment({ ...input, sourceFloorPolygon: polygon, perturbation: { enabled: false } });
      const candidate = run.status === "success" ? run.ranking.globallyRankedBest : null;
      samples.push(
        freeze({
          corner: labels[index],
          axis,
          deltaIntrinsicPx,
          resultStatus: run.status,
          bestRatioDrift: baselineBest && candidate ? Math.abs(candidate.ratio - baselineBest.ratio) : null,
          bestFovDriftDeg: baselineBest && candidate ? Math.abs(candidate.fovDeg - baselineBest.fovDeg) : null,
          bestAvgPxChange: baselineBest && candidate ? candidate.cvAvgPx - baselineBest.cvAvgPx : null,
          classification: run.status === "success" ? run.basin.classification : null,
          selectedScaleSignChanged: baselineBest && candidate ? candidate.selectedScaleSign !== baselineBest.selectedScaleSign : null,
          firstFailingGateChanged:
            baselineBest && candidate
              ? candidate.applyObservability.firstFailingGate !== baselineBest.applyObservability.firstFailingGate
              : null,
        })
      );
    }
  }
  const ratioDrifts = samples.flatMap((sample) => (sample.bestRatioDrift === null ? [] : [sample.bestRatioDrift]));
  const fovDrifts = samples.flatMap((sample) => (sample.bestFovDriftDeg === null ? [] : [sample.bestFovDriftDeg]));
  return freeze({
    enabled: true,
    samples,
    maximumRatioDrift: ratioDrifts.length ? Math.max(...ratioDrifts) : null,
    maximumFovDriftDeg: fovDrifts.length ? Math.max(...fovDrifts) : null,
    scaleSignChangeCount: samples.filter((sample) => sample.selectedScaleSignChanged).length,
    gateChangeCount: samples.filter((sample) => sample.firstFailingGateChanged).length,
    nestedClassificationChangeCount: samples.filter((sample) => sample.classification !== baseline.basin.classification).length,
    failedRunCount: samples.filter((sample) => sample.resultStatus === "failure").length,
    unstableSampleCount: samples.filter(
      (sample) => sample.selectedScaleSignChanged || sample.classification === "unstable_branch" || sample.classification === "no_valid_solution"
    ).length,
    driftConsistentWithDegenerateValley:
      baseline.basin.classification === "degenerate_valley" &&
      samples.every(
        (sample) =>
          sample.resultStatus === "success" &&
          sample.classification === "degenerate_valley" &&
          !sample.selectedScaleSignChanged &&
          !sample.firstFailingGateChanged
      ),
    instabilityInconsistentWithIsolatedOptimum:
      baseline.basin.classification === "isolated_optimum" &&
      samples.some(
        (sample) =>
          sample.resultStatus === "failure" ||
          sample.selectedScaleSignChanged ||
          sample.firstFailingGateChanged ||
          sample.classification !== "isolated_optimum"
      ),
  });
}

export function runRatioFovExperiment(input: RatioFovExperimentInput): RatioFovExperimentResult {
  const validated = validateInput(input);
  if ("status" in validated) return validated;
  const framePolygon = sourcePolygonToFramePixels(input);
  if (!framePolygon) return failure(input, "cover_crop", "Could not derive a finite centered object-cover transform.");

  const ratios = valuesInRange(input.ratioDomain.min, input.ratioDomain.max, input.ratioDomain.step);
  const fovs = valuesInRange(input.fovDomain.minDeg, input.fovDomain.maxDeg, input.fovDomain.stepDeg);
  const researchBasisQualified = deriveResearchBasisQualification(input);
  const coarseCells = evaluateGrid(input.frameSize, framePolygon, ratios, fovs, researchBasisQualified);
  const coarseCompetitive = competitiveCells(coarseCells, validated);
  const coarseBasinComponents = gridAwareComponents(coarseCompetitive, input.ratioDomain.step, input.fovDomain.stepDeg);
  const componentRegions = validated.enabled ? componentRefinementRegions(coarseBasinComponents, input) : [];
  const regions = validated.enabled
    ? mergeRefinementRegions(componentRegions, input.ratioDomain.step, input.fovDomain.stepDeg)
    : [];
  const competitiveCoarseComponentsCovered =
    !validated.enabled || competitiveCoarseComponentsCoveredByRegions(coarseBasinComponents, regions);
  const refinedCells: RatioFovCell[] = [];
  if (validated.enabled) {
    for (const region of regions) {
      refinedCells.push(
        ...evaluateGrid(
          input.frameSize,
          framePolygon,
          valuesInRange(region.ratio[0], region.ratio[1], validated.ratioStep),
          valuesInRange(region.fovDeg[0], region.fovDeg[1], validated.fovStepDeg),
          researchBasisQualified
        )
      );
    }
  }
  const allCells = [...coarseCells, ...refinedCells];
  const ranked = rankCells(successful(allCells));
  const componentsWithoutSuccessfulRefinement =
    validated.enabled && refinedCells.length > 0
      ? coarseBasinComponents.filter((_, index) => successfulCellsWithinRegion(refinedCells, componentRegions[index]).length === 0)
      : [];
  // A valid coarse component is retained when its requested refinement region
  // evaluates no successful cells, preventing partial refinement from erasing
  // otherwise competitive basin evidence.
  const strictCells =
    refinedCells.length > 0
      ? strictRefinedCellsByCoarseCoverage(refinedCells, coarseBasinComponents, componentRegions, validated)
      : competitiveCells(coarseCells, validated);
  const strictGridSource: RatioFovEnvelope["gridSource"] =
    componentsWithoutSuccessfulRefinement.length > 0 ? "combined" : refinedCells.length > 0 ? "refined" : "coarse";
  const extended4Cells = extendedCells(coarseCells, RATIO_FOV_EXTENDED_VALLEY_FACTORS.fourX, validated.additivePxAllowance);
  const extended10Cells = extendedCells(coarseCells, RATIO_FOV_EXTENDED_VALLEY_FACTORS.tenX, validated.additivePxAllowance);
  const strictEnvelope = envelope(
    "strict",
    strictGridSource,
    strictCells,
    strictGridSource === "refined" ? validated.ratioStep : input.ratioDomain.step,
    strictGridSource === "refined" ? validated.fovStepDeg : input.fovDomain.stepDeg
  );
  const extended4Envelope = envelope("extended_4x", "coarse", extended4Cells, input.ratioDomain.step, input.fovDomain.stepDeg);
  const extended10Envelope = envelope("extended_10x", "coarse", extended10Cells, input.ratioDomain.step, input.fovDomain.stepDeg);
  const failures = failureSummary(coarseCells, input.fovDomain.stepDeg);
  const closedForm = closedFormObservability(ratios, framePolygon, input.frameSize);
  const provisionalBasin = basinSummary(
    strictEnvelope,
    extended4Envelope,
    extended10Envelope,
    failures,
    closedForm,
    null,
    !competitiveCoarseComponentsCovered
  );
  const base = freeze({
    status: "success" as const,
    contractVersion: RATIO_FOV_HARNESS_CONTRACT_VERSION,
    researchConfigVersion: RATIO_FOV_RESEARCH_CONFIG_VERSION,
    safety: SAFETY,
    inputFingerprint: ratioFovInputFingerprint(input),
    inputSummary: {
      fixtureId: input.fixtureId ?? null,
      imageBasisFingerprint: input.imageBasis.basisFingerprint,
      coordinateSpace: input.coordinateSpace,
      frameSize: { ...input.frameSize },
      semanticOrder: [...input.semanticOrder] as RatioFovSemanticOrder,
      referenceDepth: input.referenceDepth,
    },
    frameFloorPolygonPx: framePolygon,
    closedForm,
    coarseSearch: { cells: coarseCells, ratioDomain: { ...input.ratioDomain }, fovDomain: { ...input.fovDomain } },
    refinement: {
      enabled: validated.enabled,
      regions: regions.map((region) => ({ ratio: [...region.ratio] as [number, number], fovDeg: [...region.fovDeg] as [number, number] })),
      cells: refinedCells,
      competitiveCoarseComponentsCovered,
    },
    ranking: {
      globallyRankedBest: ranked[0] ?? null,
      isolatedResearchRecommendation:
        provisionalBasin.classification === "isolated_optimum" && !provisionalBasin.classificationSignals.observabilityUnavailable
          ? ranked[0] ?? null
          : null,
      competitiveCells: strictCells,
    },
    basin: provisionalBasin,
    perturbation: null,
    warnings: [
      "Floor corner semantics are upstream evidence; cyclicly plausible relabeling is intentionally not repaired.",
      "orthonormalityError is retained for guard parity and is not a ranking signal.",
    ],
  });
  const perturbation = perturbationSummary(input, base);
  const finalBasin = basinSummary(
    strictEnvelope,
    extended4Envelope,
    extended10Envelope,
    failures,
    closedForm,
    perturbation,
    !competitiveCoarseComponentsCovered
  );
  return freeze({
    ...base,
    ranking: {
      ...base.ranking,
      isolatedResearchRecommendation:
        finalBasin.classification === "isolated_optimum" && !finalBasin.classificationSignals.observabilityUnavailable
          ? ranked[0] ?? null
          : null,
    },
    basin: finalBasin,
    perturbation: input.perturbation?.enabled ? perturbation : null,
    warnings: [
      ...base.warnings,
      ...(!competitiveCoarseComponentsCovered
        ? ["One or more competitive coarse components lacked refinement coverage; isolated recommendation is fail-closed."]
        : []),
    ],
  });
}

export const RATIO_FOV_DEFAULT_DOMAINS = Object.freeze({
  ratio: DEFAULT_RATIO_DOMAIN,
  fov: DEFAULT_FOV_DOMAIN,
  refinement: DEFAULT_REFINEMENT,
  weakOrthogonalityObservabilityNormalized: RATIO_FOV_WEAK_ORTHOGONALITY_OBSERVABILITY_NORMALIZED,
  extendedValleyFactors: RATIO_FOV_EXTENDED_VALLEY_FACTORS,
});
