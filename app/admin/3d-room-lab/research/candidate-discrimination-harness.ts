/**
 * AFC-R2 — read-only multi-candidate Floor-hypothesis discrimination.
 *
 * This is a research comparison layer around AFC-R1H2.  It has no Apply path,
 * no camera/Floor authority, and treats all provenance as report-only.
 */
import {
  RATIO_FOV_DEFAULT_DOMAINS,
  RATIO_FOV_HARNESS_CONTRACT_VERSION,
  RATIO_FOV_RESEARCH_CONFIG_VERSION,
  ratioFovInputFingerprint,
  runRatioFovExperiment,
  type RatioFovExperimentInput,
  type RatioFovExperimentResult,
  type RatioFovFrameSize,
  type RatioFovPoint,
  type RatioFovSemanticOrder,
} from "./ratio-fov-harness";

export const CANDIDATE_DISCRIMINATION_CONTRACT_VERSION = "candidate-discrimination-harness/v1" as const;
export const CANDIDATE_DISCRIMINATION_RESEARCH_CONFIG_VERSION = "afc-r2-geometry-only/v1" as const;
export const CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION = "afc-r2-selection-policy/v1" as const;
export const CANDIDATE_EQUIVALENCE_POLICY_VERSION = "afc-r2-equivalence-policy/v1" as const;

export const CANDIDATE_DISCRIMINATION_POLICY = Object.freeze({
  label: "exploratory, research-only, fixed AFC-R2 v1 policy",
  nearDuplicateToleranceIntrinsicPx: 1.5,
  minimumPolygonRmsSpreadFramePx: 50,
  minimumEdgeLengthFramePx: 20,
  minimumInteriorAngleDeg: 15,
  minimumForeshorteningRatio: 1.05,
  minimumCameraHeightOverReferenceDepthExclusive: 0,
  minimumPositiveDepth: 0.1,
  maximumFovDifferenceDeg: 0.5,
  maximumLogRatioDifference: 0.01,
  maximumLookElevationDifferenceDeg: 0.5,
  maximumUpTiltDifferenceDeg: 0.5,
  highOverlapEquivalenceIou: 0.9,
  lowOverlapDifferentFloorIou: 0.5,
  residualSignificanceMultiplier: 2,
  numericalFloor: 1e-9,
  paretoTolerance: 1e-9,
  extendedEnvelopeOnlyCensoring: "reduced reliability; blocks unique selection in v1 because no calibrated widened-margin multiplier exists",
  fixedPolicyVariants: Object.freeze({
    nominal: Object.freeze({ nearDuplicate: 1, residual: 1, extent: 1, cameraEquivalence: 1 }),
    conservative: Object.freeze({ nearDuplicate: 0.8, residual: 1.2, extent: 1.2, cameraEquivalence: 0.8 }),
    permissive: Object.freeze({ nearDuplicate: 1.2, residual: 0.8, extent: 0.8, cameraEquivalence: 1.2 }),
  }),
  excludedDiagnostics: Object.freeze([
    "raw cvAvgPx: candidate extent changes its scale; not a cross-candidate ranking axis",
    "raw cvMaxPx: candidate extent changes its scale; not a cross-candidate ranking axis",
    "basin classification: hard validity gate, not a score",
    "recommendation availability: hard validity gate, not a score",
    "equal-norm discrepancy: correlated closed-form diagnostic, not an independent vote",
    "column-scale ratio: solver diagnostic, not an independent vote",
    "rotation determinant: guard-parity diagnostic, not an independent vote",
    "display/CV delta: Apply observability only, not geometric evidence",
    "Apply-gate count: Apply observability only, not a score",
    "raw extended-envelope widths: candidate extents differ; not independent ranking votes",
    "full pose distance: candidate-local world gauges are not comparable",
    "constructive plane-similarity proof: future diagnostic; AFC-R2 does not import homography internals",
    "synchronized perturbation winner frequency: public samples lack per-label candidate results",
  ]),
});

export type FloorCandidateSource =
  | "operator"
  | "approved-control"
  | "fixture-derived"
  | "research-probe"
  | "gemini-proposal";

export type FloorCandidateInput = Readonly<{
  candidateId: string;
  candidateSource: FloorCandidateSource;
  coordinateSpace: "source-normalized/v1";
  semanticOrder: RatioFovSemanticOrder;
  sourceFloorPolygon: readonly [RatioFovPoint, RatioFovPoint, RatioFovPoint, RatioFovPoint];
  candidateFamilyHint?: string;
  parentCandidateId?: string;
  role?: string;
  notes?: string;
  transformSpec?: Readonly<Record<string, unknown>>;
}>;

export type SharedCandidateComparisonContext = Readonly<{
  ratioFovContractVersion: typeof RATIO_FOV_HARNESS_CONTRACT_VERSION;
  basisId: string;
  basisFingerprint: string;
  decoderId: string;
  normalizationPolicyVersion: "source-normalized/v1";
  decodedWidth: number;
  decodedHeight: number;
  frameSize: RatioFovFrameSize;
  orientationApplied: false;
  basisKind: "original";
  ratioDomain: RatioFovExperimentInput["ratioDomain"];
  fovDomain: RatioFovExperimentInput["fovDomain"];
  refinement: NonNullable<RatioFovExperimentInput["refinement"]>;
  referenceDepth: 1;
}>;

export type FloorCandidateComparisonInput = Readonly<{
  contractVersion: typeof CANDIDATE_DISCRIMINATION_CONTRACT_VERSION;
  comparisonId?: string;
  sharedContext: SharedCandidateComparisonContext;
  candidates: readonly FloorCandidateInput[];
  selectionPolicyVersion: typeof CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION;
}>;

type CandidateValidityLayer = "input_invalid" | "solver_invalid" | "valid_non_recommendable" | "isolated";
type SearchBoundaryContact = "ratio_min" | "ratio_max" | "fov_min" | "fov_max";
type SelectionState =
  | "comparison_context_invalid"
  | "no_valid_candidate"
  | "equivalent_candidate_family"
  | "unique_candidate"
  | "multiple_plausible_candidates"
  | "insufficient_discrimination";

export type CandidateHardGates = Readonly<{
  contextValid: boolean;
  harnessSuccess: boolean;
  bestCellAvailable: boolean;
  isolatedClassification: boolean;
  isolatedRecommendationAvailable: boolean;
  normalizedObservabilityAvailable: boolean;
  polygonRmsSpreadSufficient: boolean;
  minimumEdgeSufficient: boolean;
  minimumAngleSufficient: boolean;
  foreshorteningSufficient: boolean;
  cameraHeightPositive: boolean;
  minimumDepthSufficient: boolean;
  refinementCoverageComplete: boolean;
  bestRatioInterior: boolean;
  bestFovInterior: boolean;
  strictEnvelopeRatioInterior: boolean;
  strictEnvelopeFovInterior: boolean;
  applyObservabilityAvailable: boolean;
  confirmationPerturbationEnabled: boolean;
  confirmationClassificationStable: boolean;
  candidateInputValid: boolean;
}>;

type PolygonMetrics = Readonly<{
  centroid: RatioFovPoint | null;
  rmsCornerSpreadFramePx: number | null;
  edgeLengthsFramePx: readonly number[];
  minimumEdgeLengthFramePx: number | null;
  interiorAnglesDeg: readonly number[];
  minimumInteriorAngleDeg: number | null;
  /** Semantic NL → NR projected edge. */
  nearEdgeLengthPx: number | null;
  /** Semantic FL → FR projected edge. */
  farEdgeLengthPx: number | null;
  nearToFarEdgeRatio: number | null;
  signedAreaFramePx2: number | null;
  absoluteAreaFramePx2: number | null;
  diagonalExtentFramePx: number | null;
}>;

type NormalizedDiagnostics = Readonly<{
  rhoAvg: number | null;
  rhoMax: number | null;
  beta: number | null;
  omega: number | null;
  kappaRatio: number | null;
  kappaFov: number | null;
  residualNoiseScale: number | null;
}>;

type BoundarySummary = Readonly<{
  searchBoundaryContact: readonly SearchBoundaryContact[];
  optimumRatioBoundaryContact: boolean;
  optimumFovBoundaryContact: boolean;
  strictEnvelopeRatioBoundaryContact: boolean;
  strictEnvelopeFovBoundaryContact: boolean;
  optimumAtBoundary: boolean;
  strictEnvelopeBoundaryContact: boolean;
  extendedEnvelopeCensored: boolean;
  comparisonReliability: "full" | "reduced" | "unusable";
}>;

export type FamilyComparableGateSnapshot = Readonly<{
  candidateInputValid: boolean;
  harnessSuccess: boolean;
  bestCellAvailable: boolean;
  isolatedClassification: boolean;
  isolatedRecommendationAvailable: boolean;
  normalizedObservabilityAvailable: boolean;
  polygonRmsSpreadSufficient: boolean;
  minimumEdgeSufficient: boolean;
  minimumAngleSufficient: boolean;
  foreshorteningSufficient: boolean;
  cameraHeightPositive: boolean;
  minimumDepthSufficient: boolean;
  refinementCoverageComplete: boolean;
  bestRatioInterior: boolean;
  bestFovInterior: boolean;
  strictEnvelopeRatioInterior: boolean;
  strictEnvelopeFovInterior: boolean;
  applyObservabilityAvailable: boolean;
}>;

export type CandidateDiscriminationCandidateResult = Readonly<{
  candidateGeometryFingerprint: string;
  candidateId: string;
  canonicalPolygonKey: string;
  stageA: RatioFovExperimentResult;
  stageB: RatioFovExperimentResult | null;
  effectiveStage: "stageA" | "stageB";
  validityLayer: CandidateValidityLayer;
  polygonMetrics: PolygonMetrics;
  hardGates: CandidateHardGates;
  familyComparableStageAGates: FamilyComparableGateSnapshot;
  normalizedDiagnostics: NormalizedDiagnostics;
  boundary: BoundarySummary;
  comparisonRelevant: boolean;
  rankingEligible: boolean;
  refusalReasons: readonly string[];
  familyFingerprint: string | null;
}>;

export type CandidateFamilyResult = Readonly<{
  familyFingerprint: string;
  representativeFingerprint: string;
  memberFingerprints: readonly string[];
  exactDuplicateCount: number;
  nearDuplicateCount: number;
  totalReportingCandidateCount: number;
  familyStageAGateDisagreement: boolean;
  representativeConfirmationFailure: boolean;
  metricDispersion: Readonly<{ rhoAvg: number | null; beta: number | null; omega: number | null; kappaRatio: number | null; kappaFov: number | null }>;
  epsilonBoundaryInstability: boolean;
}>;

export type PairwiseCandidateComparison = Readonly<{
  familyAFingerprint: string;
  familyBFingerprint: string;
  polygonIoU: number | null;
  cameraInvariantComparison: Readonly<{
    fovDifferenceDeg: number | null;
    logRatioDifference: number | null;
    lookElevationDifferenceDeg: number | null;
    upTiltDifferenceDeg: number | null;
    equivalentWithinPolicy: boolean;
  }>;
  projectivelyEquivalentHighOverlap: boolean;
  cameraEquivalentLowOverlap: boolean;
  equivalentCameraDifferentFloor: boolean;
  cameraEquivalentAmbiguousOverlap: boolean;
  distinctCompetingCandidate: boolean;
  hardGateDominance: "a" | "b" | "neither";
  normalizedResidualDifference: number | null;
  residualNoiseScale: number | null;
  residualDifferenceSignificant: boolean;
  paretoRelation: "a_dominates" | "b_dominates" | "non_dominated" | "unavailable";
  outcome: "a_wins" | "b_wins" | "equivalent" | "incomparable";
  reasons: readonly string[];
}>;

export type CandidateDiscriminationResult = Readonly<{
  status: SelectionState;
  selectionState: SelectionState;
  contractVersion: typeof CANDIDATE_DISCRIMINATION_CONTRACT_VERSION;
  researchConfigVersion: typeof CANDIDATE_DISCRIMINATION_RESEARCH_CONFIG_VERSION;
  selectionPolicyVersion: typeof CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION;
  equivalencePolicyVersion: typeof CANDIDATE_EQUIVALENCE_POLICY_VERSION;
  comparisonFingerprint: string;
  sharedContextSummary: SharedCandidateComparisonContext | null;
  safety: Readonly<{ applied: false; authoritative: false; persisted: false; activeCameraUnchanged: true }>;
  policy: typeof CANDIDATE_DISCRIMINATION_POLICY;
  candidateResults: readonly CandidateDiscriminationCandidateResult[];
  candidateFamilies: readonly CandidateFamilyResult[];
  pairwiseComparisons: readonly PairwiseCandidateComparison[];
  policyVariantResults: readonly Readonly<{ name: "nominal" | "conservative" | "permissive"; familyFingerprints: readonly string[]; selectionState: SelectionState; selectedFamilyFingerprint: string | null; afcR1H2Reevaluated: false }>[];
  rankingStages: Readonly<{ exactDistinctCandidateCount: number; stageAEvaluationCount: number; comparisonRelevantFamilyCount: number; stageBEvaluationCount: number; exactDuplicateEvaluationReuse: number; pairwiseComparisonCount: number }>;
  comparisonRelevantCandidates: readonly string[];
  rankingEligibleCandidates: readonly string[];
  rejectedCandidates: readonly string[];
  selectedCandidateFingerprint: string | null;
  selectedFamilyFingerprint: string | null;
  selectionMarginEvidence: readonly string[];
  diagnosticsUsed: readonly string[];
  diagnosticsExcluded: readonly string[];
  refusalReasons: readonly string[];
  warnings: readonly string[];
}>;

const SAFETY = Object.freeze({ applied: false as const, authoritative: false as const, persisted: false as const, activeCameraUnchanged: true as const });
const EPSILON = 1e-9;

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (visited.has(object)) return value;
    visited.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, visited);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

/** Locale-independent UTF-16 code-unit ordering for canonical artifacts. */
export function compareCanonicalStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical serialization intentionally preserves array order (semantic perimeter order). */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort(compareCanonicalStrings).map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`).join(",")}}`;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}
function finitePositiveInteger(value: unknown): value is number {
  return positive(value) && Number.isInteger(value);
}
function exactOrder(value: unknown): value is RatioFovSemanticOrder {
  return Array.isArray(value) && value.length === 4 && value[0] === "NL" && value[1] === "NR" && value[2] === "FR" && value[3] === "FL";
}
function pointValid(point: unknown): point is RatioFovPoint {
  return !!point && typeof point === "object" && finite((point as RatioFovPoint).x) && finite((point as RatioFovPoint).y);
}

function validContext(context: SharedCandidateComparisonContext | undefined): context is SharedCandidateComparisonContext {
  return !!context &&
    context.ratioFovContractVersion === RATIO_FOV_HARNESS_CONTRACT_VERSION &&
    context.basisKind === "original" &&
    context.orientationApplied === false &&
    context.normalizationPolicyVersion === "source-normalized/v1" &&
    !!context.basisId && !!context.basisFingerprint && !!context.decoderId &&
    finitePositiveInteger(context.decodedWidth) && finitePositiveInteger(context.decodedHeight) &&
    finitePositiveInteger(context.frameSize?.width) && finitePositiveInteger(context.frameSize?.height) &&
    positive(context.ratioDomain?.min) && positive(context.ratioDomain?.max) && positive(context.ratioDomain?.step) &&
    context.ratioDomain.min <= context.ratioDomain.max &&
    finite(context.fovDomain?.minDeg) && finite(context.fovDomain?.maxDeg) && positive(context.fovDomain?.stepDeg) &&
    context.fovDomain.minDeg >= 20 && context.fovDomain.maxDeg <= 90 && context.fovDomain.minDeg <= context.fovDomain.maxDeg &&
    !!context.refinement && positive(context.refinement.ratioStep) && positive(context.refinement.fovStepDeg) &&
    positive(context.refinement.basinFactor) && finite(context.refinement.additivePxAllowance) && context.refinement.additivePxAllowance >= 0 &&
    context.referenceDepth === 1;
}

function cloneContext(context: SharedCandidateComparisonContext): SharedCandidateComparisonContext {
  return {
    ratioFovContractVersion: context.ratioFovContractVersion,
    basisId: context.basisId,
    basisFingerprint: context.basisFingerprint,
    decoderId: context.decoderId,
    normalizationPolicyVersion: context.normalizationPolicyVersion,
    decodedWidth: context.decodedWidth,
    decodedHeight: context.decodedHeight,
    frameSize: { ...context.frameSize },
    orientationApplied: context.orientationApplied,
    basisKind: context.basisKind,
    ratioDomain: { ...context.ratioDomain },
    fovDomain: { ...context.fovDomain },
    refinement: { ...context.refinement },
    referenceDepth: context.referenceDepth,
  };
}

function contextFingerprint(context: SharedCandidateComparisonContext): string {
  return fnv1a32(stableSerialize(context));
}

export function candidateCanonicalPolygon(candidate: FloorCandidateInput): string {
  return stableSerialize({ coordinateSpace: candidate.coordinateSpace, semanticOrder: candidate.semanticOrder, sourceFloorPolygon: candidate.sourceFloorPolygon });
}

function candidateInputValid(candidate: FloorCandidateInput): boolean {
  return !!candidate && typeof candidate.candidateId === "string" && candidate.candidateId.trim().length > 0 &&
    candidate.coordinateSpace === "source-normalized/v1" && exactOrder(candidate.semanticOrder) &&
    Array.isArray(candidate.sourceFloorPolygon) && candidate.sourceFloorPolygon.length === 4 &&
    candidate.sourceFloorPolygon.every(pointValid);
}

function geometryFingerprint(context: SharedCandidateComparisonContext, candidate: FloorCandidateInput, fixtureId: string): string {
  return fnv1a32(stableSerialize({
    sharedContextFingerprint: contextFingerprint(context),
    polygon: candidateCanonicalPolygon(candidate),
    syntheticFixtureId: fixtureId,
    ratioFovExperimentFingerprint: ratioFovInputFingerprint(experimentInput(context, candidate, fixtureId, false)),
    ratioFovContractVersion: RATIO_FOV_HARNESS_CONTRACT_VERSION,
    ratioFovResearchConfigVersion: RATIO_FOV_RESEARCH_CONFIG_VERSION,
  }));
}

function experimentInput(context: SharedCandidateComparisonContext, candidate: FloorCandidateInput, fixtureId: string, perturbation: boolean): RatioFovExperimentInput {
  return {
    contractVersion: RATIO_FOV_HARNESS_CONTRACT_VERSION,
    fixtureId,
    imageBasis: {
      basisId: context.basisId,
      basisFingerprint: context.basisFingerprint,
      decodedWidth: context.decodedWidth,
      decodedHeight: context.decodedHeight,
      coordinateSpaceVersion: { decoderId: context.decoderId, normalizationPolicyVersion: context.normalizationPolicyVersion, orientationApplied: false },
      basisKind: "original",
    },
    frameSize: { ...context.frameSize },
    coordinateSpace: "source-normalized/v1",
    semanticOrder: candidate.semanticOrder,
    sourceFloorPolygon: candidate.sourceFloorPolygon,
    ratioDomain: { ...context.ratioDomain },
    fovDomain: { ...context.fovDomain },
    refinement: { ...context.refinement },
    referenceDepth: 1,
    perturbation: { enabled: perturbation },
  };
}

function distance(a: RatioFovPoint, b: RatioFovPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function signedArea(points: readonly RatioFovPoint[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}
function cross(a: RatioFovPoint, b: RatioFovPoint, c: RatioFovPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function validConvexPolygon(points: readonly RatioFovPoint[]): boolean {
  if (points.length !== 4 || !points.every(pointValid) || Math.abs(signedArea(points)) <= EPSILON) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const value = cross(points[index], points[(index + 1) % points.length], points[(index + 2) % points.length]);
    if (Math.abs(value) <= EPSILON) return false;
    if (sign && Math.sign(value) !== sign) return false;
    sign = Math.sign(value);
  }
  return true;
}

export function convexPolygonIoU(a: readonly RatioFovPoint[], b: readonly RatioFovPoint[]): number | null {
  if (!validConvexPolygon(a) || !validConvexPolygon(b)) return null;
  const clipOrientation = Math.sign(signedArea(b));
  let output = a.map((point) => ({ ...point }));
  for (let index = 0; index < b.length; index += 1) {
    const clipStart = b[index];
    const clipEnd = b[(index + 1) % b.length];
    const input = output;
    output = [];
    for (let pointIndex = 0; pointIndex < input.length; pointIndex += 1) {
      const current = input[pointIndex];
      const previous = input[(pointIndex + input.length - 1) % input.length];
      const currentInside = clipOrientation * cross(clipStart, clipEnd, current) >= -EPSILON;
      const previousInside = clipOrientation * cross(clipStart, clipEnd, previous) >= -EPSILON;
      if (currentInside !== previousInside) {
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const ex = clipEnd.x - clipStart.x;
        const ey = clipEnd.y - clipStart.y;
        const denominator = dx * ey - dy * ex;
        if (Math.abs(denominator) > EPSILON) {
          const t = ((clipStart.x - previous.x) * ey - (clipStart.y - previous.y) * ex) / denominator;
          output.push({ x: previous.x + t * dx, y: previous.y + t * dy });
        }
      }
      if (currentInside) output.push({ ...current });
    }
  }
  const intersection = output.length >= 3 ? Math.abs(signedArea(output)) : 0;
  const union = Math.abs(signedArea(a)) + Math.abs(signedArea(b)) - intersection;
  return union > EPSILON ? intersection / union : null;
}

function polygonMetrics(result: RatioFovExperimentResult): PolygonMetrics {
  if (result.status === "failure") return deepFreeze({ centroid: null, rmsCornerSpreadFramePx: null, edgeLengthsFramePx: [], minimumEdgeLengthFramePx: null, interiorAnglesDeg: [], minimumInteriorAngleDeg: null, nearEdgeLengthPx: null, farEdgeLengthPx: null, nearToFarEdgeRatio: null, signedAreaFramePx2: null, absoluteAreaFramePx2: null, diagonalExtentFramePx: null });
  const points = result.frameFloorPolygonPx;
  const centroid = { x: points.reduce((sum, point) => sum + point.x, 0) / 4, y: points.reduce((sum, point) => sum + point.y, 0) / 4 };
  const spread = Math.sqrt(points.reduce((sum, point) => sum + (point.x - centroid.x) ** 2 + (point.y - centroid.y) ** 2, 0) / 4);
  const edgeLengths = points.map((point, index) => distance(point, points[(index + 1) % 4]));
  const angles = points.map((point, index) => {
    const previous = points[(index + 3) % 4];
    const next = points[(index + 1) % 4];
    const first = { x: previous.x - point.x, y: previous.y - point.y };
    const second = { x: next.x - point.x, y: next.y - point.y };
    const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
    return denominator > EPSILON ? Math.acos(Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator))) * 180 / Math.PI : null;
  });
  // Semantic Floor order is [NL, NR, FR, FL]: the near projected edge is
  // NL→NR and the far projected edge is FL→FR. This corrects labels only;
  // the locked exploratory 1.05 threshold is unchanged.
  const near = edgeLengths[0];
  const far = edgeLengths[2];
  return deepFreeze({
    centroid,
    rmsCornerSpreadFramePx: spread,
    edgeLengthsFramePx: edgeLengths,
    minimumEdgeLengthFramePx: Math.min(...edgeLengths),
    interiorAnglesDeg: angles.filter((value): value is number => value !== null),
    minimumInteriorAngleDeg: angles.every((value) => value !== null) ? Math.min(...(angles as number[])) : null,
    nearEdgeLengthPx: near,
    farEdgeLengthPx: far,
    nearToFarEdgeRatio: far > EPSILON ? near / far : null,
    signedAreaFramePx2: signedArea(points),
    absoluteAreaFramePx2: Math.abs(signedArea(points)),
    diagonalExtentFramePx: Math.max(distance(points[0], points[2]), distance(points[1], points[3])),
  });
}

function boundarySummary(context: SharedCandidateComparisonContext, result: RatioFovExperimentResult): BoundarySummary {
  if (result.status === "failure") return deepFreeze({ searchBoundaryContact: [], optimumRatioBoundaryContact: false, optimumFovBoundaryContact: false, strictEnvelopeRatioBoundaryContact: false, strictEnvelopeFovBoundaryContact: false, optimumAtBoundary: false, strictEnvelopeBoundaryContact: false, extendedEnvelopeCensored: false, comparisonReliability: "unusable" });
  const best = result.ranking.globallyRankedBest;
  const contacts = new Set<SearchBoundaryContact>();
  const at = (value: number | null | undefined, target: number) => value !== null && value !== undefined && Math.abs(value - target) <= EPSILON;
  const optimumRatioBoundaryContact = !!best && (at(best.ratio, context.ratioDomain.min) || at(best.ratio, context.ratioDomain.max));
  const optimumFovBoundaryContact = !!best && (at(best.fovDeg, context.fovDomain.minDeg) || at(best.fovDeg, context.fovDomain.maxDeg));
  if (best && at(best.ratio, context.ratioDomain.min)) contacts.add("ratio_min");
  if (best && at(best.ratio, context.ratioDomain.max)) contacts.add("ratio_max");
  if (best && at(best.fovDeg, context.fovDomain.minDeg)) contacts.add("fov_min");
  if (best && at(best.fovDeg, context.fovDomain.maxDeg)) contacts.add("fov_max");
  const strict = result.basin.strictCompetitiveEnvelope;
  const strictEnvelopeRatioBoundaryContact = at(strict.ratioSpan?.[0], context.ratioDomain.min) || at(strict.ratioSpan?.[1], context.ratioDomain.max);
  const strictEnvelopeFovBoundaryContact = at(strict.fovSpanDeg?.[0], context.fovDomain.minDeg) || at(strict.fovSpanDeg?.[1], context.fovDomain.maxDeg);
  if (at(strict.ratioSpan?.[0], context.ratioDomain.min)) contacts.add("ratio_min");
  if (at(strict.ratioSpan?.[1], context.ratioDomain.max)) contacts.add("ratio_max");
  if (at(strict.fovSpanDeg?.[0], context.fovDomain.minDeg)) contacts.add("fov_min");
  if (at(strict.fovSpanDeg?.[1], context.fovDomain.maxDeg)) contacts.add("fov_max");
  const extended = result.basin.extendedValleyEnvelope10x;
  const extendedCensored = at(extended.ratioSpan?.[0], context.ratioDomain.min) || at(extended.ratioSpan?.[1], context.ratioDomain.max) || at(extended.fovSpanDeg?.[0], context.fovDomain.minDeg) || at(extended.fovSpanDeg?.[1], context.fovDomain.maxDeg);
  return deepFreeze({
    searchBoundaryContact: [...contacts].sort(compareCanonicalStrings),
    optimumRatioBoundaryContact,
    optimumFovBoundaryContact,
    strictEnvelopeRatioBoundaryContact,
    strictEnvelopeFovBoundaryContact,
    optimumAtBoundary: optimumRatioBoundaryContact || optimumFovBoundaryContact,
    strictEnvelopeBoundaryContact: strictEnvelopeRatioBoundaryContact || strictEnvelopeFovBoundaryContact,
    extendedEnvelopeCensored: extendedCensored,
    comparisonReliability: optimumRatioBoundaryContact || optimumFovBoundaryContact || strictEnvelopeRatioBoundaryContact || strictEnvelopeFovBoundaryContact ? "unusable" : extendedCensored ? "reduced" : "full",
  });
}

function diagnostics(context: SharedCandidateComparisonContext, metrics: PolygonMetrics, result: RatioFovExperimentResult): NormalizedDiagnostics {
  if (result.status === "failure" || !result.ranking.globallyRankedBest) return deepFreeze({ rhoAvg: null, rhoMax: null, beta: null, omega: null, kappaRatio: null, kappaFov: null, residualNoiseScale: null });
  const best = result.ranking.globallyRankedBest;
  const spread = metrics.rmsCornerSpreadFramePx;
  const rhoAvg = spread && spread > EPSILON ? best.cvAvgPx / spread : null;
  const rhoMax = spread && spread > EPSILON ? best.cvMaxPx / spread : null;
  const beta = best.cvAvgPx > EPSILON ? best.cvMaxPx / best.cvAvgPx : best.cvMaxPx <= EPSILON ? 1 : null;
  const perturbation = result.perturbation;
  const sampleChanges = perturbation?.samples.flatMap((sample) => sample.bestAvgPxChange === null ? [] : [Math.abs(sample.bestAvgPxChange)]) ?? [];
  return deepFreeze({
    rhoAvg,
    rhoMax,
    beta,
    omega: result.closedForm.orthogonalityObservabilityNormalized === null ? null : 1 - result.closedForm.orthogonalityObservabilityNormalized,
    kappaRatio: perturbation?.maximumRatioDrift === null || perturbation?.maximumRatioDrift === undefined ? null : perturbation.maximumRatioDrift / (context.ratioDomain.max - context.ratioDomain.min),
    kappaFov: perturbation?.maximumFovDriftDeg === null || perturbation?.maximumFovDriftDeg === undefined ? null : perturbation.maximumFovDriftDeg / (context.fovDomain.maxDeg - context.fovDomain.minDeg),
    residualNoiseScale: spread && spread > EPSILON && sampleChanges.length ? Math.max(...sampleChanges) / spread : null,
  });
}

function gates(sharedContext: SharedCandidateComparisonContext, contextValid: boolean, candidateValid: boolean, metrics: PolygonMetrics, result: RatioFovExperimentResult, confirmed: RatioFovExperimentResult | null, boundary: BoundarySummary): CandidateHardGates {
  const effective = confirmed ?? result;
  const success = effective.status === "success";
  const best = success ? effective.ranking.globallyRankedBest : null;
  const recommendation = success ? effective.ranking.isolatedResearchRecommendation : null;
  const signals = success ? effective.basin.classificationSignals : null;
  return deepFreeze({
    contextValid,
    harnessSuccess: success,
    bestCellAvailable: !!best,
    isolatedClassification: success && effective.basin.classification === "isolated_optimum",
    isolatedRecommendationAvailable: !!recommendation,
    normalizedObservabilityAvailable: success && effective.closedForm.orthogonalityObservabilityNormalized !== null,
    polygonRmsSpreadSufficient: (metrics.rmsCornerSpreadFramePx ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumPolygonRmsSpreadFramePx,
    minimumEdgeSufficient: (metrics.minimumEdgeLengthFramePx ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumEdgeLengthFramePx,
    minimumAngleSufficient: (metrics.minimumInteriorAngleDeg ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumInteriorAngleDeg,
    foreshorteningSufficient: (metrics.nearToFarEdgeRatio ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumForeshorteningRatio,
    cameraHeightPositive: !!best && best.cameraHeightOverReferenceDepth > CANDIDATE_DISCRIMINATION_POLICY.minimumCameraHeightOverReferenceDepthExclusive,
    minimumDepthSufficient: !!best && best.minimumPositiveDepth >= CANDIDATE_DISCRIMINATION_POLICY.minimumPositiveDepth,
    refinementCoverageComplete: success && effective.refinement.competitiveCoarseComponentsCovered && !signals?.refinementCoverageIncomplete,
    bestRatioInterior: success && !boundary.optimumRatioBoundaryContact,
    bestFovInterior: success && !boundary.optimumFovBoundaryContact,
    strictEnvelopeRatioInterior: success && !boundary.strictEnvelopeRatioBoundaryContact,
    strictEnvelopeFovInterior: success && !boundary.strictEnvelopeFovBoundaryContact,
    applyObservabilityAvailable: !!best?.applyObservability.available,
    confirmationPerturbationEnabled: !!confirmed && confirmed.status === "success" && confirmed.perturbation?.enabled === true,
    confirmationClassificationStable: !!confirmed && confirmed.status === "success" && confirmed.basin.classification === "isolated_optimum" && (confirmed.perturbation?.failedRunCount ?? 1) === 0 && (confirmed.perturbation?.unstableSampleCount ?? 1) === 0 && (confirmed.perturbation?.gateChangeCount ?? 1) === 0 && (confirmed.perturbation?.nestedClassificationChangeCount ?? 1) === 0 && (confirmed.perturbation?.scaleSignChangeCount ?? 1) === 0,
    candidateInputValid: candidateValid,
  });
}

function stageAComparableGates(gate: CandidateHardGates): FamilyComparableGateSnapshot {
  return deepFreeze({
    candidateInputValid: gate.candidateInputValid,
    harnessSuccess: gate.harnessSuccess,
    bestCellAvailable: gate.bestCellAvailable,
    isolatedClassification: gate.isolatedClassification,
    isolatedRecommendationAvailable: gate.isolatedRecommendationAvailable,
    normalizedObservabilityAvailable: gate.normalizedObservabilityAvailable,
    polygonRmsSpreadSufficient: gate.polygonRmsSpreadSufficient,
    minimumEdgeSufficient: gate.minimumEdgeSufficient,
    minimumAngleSufficient: gate.minimumAngleSufficient,
    foreshorteningSufficient: gate.foreshorteningSufficient,
    cameraHeightPositive: gate.cameraHeightPositive,
    minimumDepthSufficient: gate.minimumDepthSufficient,
    refinementCoverageComplete: gate.refinementCoverageComplete,
    bestRatioInterior: gate.bestRatioInterior,
    bestFovInterior: gate.bestFovInterior,
    strictEnvelopeRatioInterior: gate.strictEnvelopeRatioInterior,
    strictEnvelopeFovInterior: gate.strictEnvelopeFovInterior,
    applyObservabilityAvailable: gate.applyObservabilityAvailable,
  });
}

function refusalReasons(gate: CandidateHardGates, result: RatioFovExperimentResult, boundary: BoundarySummary): string[] {
  const reasons: string[] = [];
  if (!gate.candidateInputValid || result.status === "failure") {
    reasons.push("candidate_input_invalid");
    if (result.status === "failure") reasons.push(`input_or_harness_failure:${result.code}`);
    return reasons;
  }
  if (gate.harnessSuccess && !gate.bestCellAvailable) reasons.push("no_successful_cells");
  if (!gate.polygonRmsSpreadSufficient) reasons.push("polygon_rms_spread_insufficient");
  if (!gate.minimumEdgeSufficient) reasons.push("minimum_edge_insufficient");
  if (!gate.minimumAngleSufficient) reasons.push("minimum_interior_angle_insufficient");
  if (!gate.foreshorteningSufficient) reasons.push("foreshortening_insufficient");
  if (!gate.cameraHeightPositive) reasons.push("camera_below_floor");
  if (!gate.minimumDepthSufficient) reasons.push("minimum_positive_depth_insufficient");
  if (!gate.refinementCoverageComplete) reasons.push("refinement_coverage_incomplete");
  if (!gate.isolatedClassification) reasons.push("not_isolated");
  if (!gate.isolatedRecommendationAvailable) reasons.push("isolated_recommendation_unavailable");
  if (!gate.normalizedObservabilityAvailable) reasons.push("observability_unavailable");
  if (!gate.bestRatioInterior || !gate.bestFovInterior || !gate.strictEnvelopeRatioInterior || !gate.strictEnvelopeFovInterior) reasons.push("search_boundary_censored");
  if (!gate.applyObservabilityAvailable) reasons.push("apply_observability_unavailable");
  if (!gate.confirmationPerturbationEnabled) reasons.push("perturbation_confirmation_unavailable");
  if (gate.confirmationPerturbationEnabled && !gate.confirmationClassificationStable) reasons.push("perturbation_instability");
  if (boundary.extendedEnvelopeCensored) reasons.push("extended_envelope_censored");
  return [...new Set(reasons)];
}

function layer(gate: CandidateHardGates, result: RatioFovExperimentResult): CandidateValidityLayer {
  if (!gate.candidateInputValid || result.status === "failure") return "input_invalid";
  if (!gate.bestCellAvailable) return "solver_invalid";
  if (gate.isolatedClassification && gate.isolatedRecommendationAvailable && gate.confirmationClassificationStable) return "isolated";
  return "valid_non_recommendable";
}

function comparisonRelevant(gate: CandidateHardGates): boolean {
  return gate.harnessSuccess && gate.bestCellAvailable && gate.polygonRmsSpreadSufficient && gate.minimumEdgeSufficient && gate.minimumAngleSufficient && gate.foreshorteningSufficient && gate.cameraHeightPositive && gate.minimumDepthSufficient && gate.refinementCoverageComplete;
}
function rankingEligible(gate: CandidateHardGates, boundary: BoundarySummary): boolean {
  // AFC-R2 v1 has no calibrated widened-margin multiplier, so extended-only
  // censoring is intentionally a fail-closed unique-selection blocker.
  return comparisonRelevant(gate) && gate.isolatedClassification && gate.isolatedRecommendationAvailable && gate.normalizedObservabilityAvailable && gate.bestRatioInterior && gate.bestFovInterior && gate.strictEnvelopeRatioInterior && gate.strictEnvelopeFovInterior && gate.applyObservabilityAvailable && gate.confirmationPerturbationEnabled && gate.confirmationClassificationStable && boundary.comparisonReliability === "full";
}

function intrinsicDistance(context: SharedCandidateComparisonContext, a: FloorCandidateInput, b: FloorCandidateInput): number {
  return Math.max(...a.sourceFloorPolygon.map((point, index) => Math.hypot((point.x - b.sourceFloorPolygon[index].x) * context.decodedWidth, (point.y - b.sourceFloorPolygon[index].y) * context.decodedHeight)));
}

type Distinct = { key: string; fingerprint: string; candidate: FloorCandidateInput; members: FloorCandidateInput[]; stageA: RatioFovExperimentResult; stageB: RatioFovExperimentResult | null; canonical: string };
type Family = { members: Distinct[]; fingerprint: string; representative: Distinct; epsilonBoundaryInstability: boolean };

function completeLinkFamilies(context: SharedCandidateComparisonContext, distinct: readonly Distinct[], epsilon: number): Family[] {
  const sorted = [...distinct].sort((a, b) => compareCanonicalStrings(a.canonical, b.canonical));
  const families: Family[] = [];
  for (const item of sorted) {
    const join = families.find((family) => family.members.every((member) => intrinsicDistance(context, item.candidate, member.candidate) <= epsilon + EPSILON));
    if (join) join.members.push(item);
    else families.push({ members: [item], fingerprint: "", representative: item, epsilonBoundaryInstability: false });
  }
  for (const family of families) {
    family.members.sort((a, b) => compareCanonicalStrings(a.canonical, b.canonical));
    family.representative = family.members[0];
    family.fingerprint = fnv1a32(stableSerialize({ equivalencePolicyVersion: CANDIDATE_EQUIVALENCE_POLICY_VERSION, members: family.members.map((member) => member.fingerprint).sort(compareCanonicalStrings) }));
  }
  // A graph component spanning families is an explicit single-linkage boundary warning.
  for (const family of families) {
    const reached = new Set<Distinct>(family.members);
    const queue = [...family.members];
    while (queue.length) {
      const current = queue.pop()!;
      for (const other of sorted) {
        if (!reached.has(other) && intrinsicDistance(context, current.candidate, other.candidate) <= epsilon + EPSILON) {
          reached.add(other);
          queue.push(other);
        }
      }
    }
    if (new Set([...reached].map((member) => families.findIndex((other) => other.members.includes(member)))).size > 1) family.epsilonBoundaryInstability = true;
  }
  return families.sort((a, b) => compareCanonicalStrings(a.fingerprint, b.fingerprint));
}

function effectiveResultFor(candidate: CandidateDiscriminationCandidateResult): RatioFovExperimentResult {
  return candidate.effectiveStage === "stageB" && candidate.stageB ? candidate.stageB : candidate.stageA;
}

function cameraInvariants(result: CandidateDiscriminationCandidateResult): { fov: number; logRatio: number; lookElevation: number; upTilt: number } | null {
  const source = effectiveResultFor(result);
  if (source.status === "failure" || !source.ranking.isolatedResearchRecommendation) return null;
  const cell = source.ranking.isolatedResearchRecommendation;
  if (cell.ratio <= 0) return null;
  return {
    fov: cell.fovDeg,
    logRatio: Math.log(cell.ratio),
    lookElevation: Math.asin(Math.max(-1, Math.min(1, cell.normalizedLookDirection.y))) * 180 / Math.PI,
    upTilt: Math.asin(Math.max(-1, Math.min(1, cell.up.y))) * 180 / Math.PI,
  };
}

function availableAxes(result: CandidateDiscriminationCandidateResult): (keyof Pick<NormalizedDiagnostics, "rhoAvg" | "beta" | "omega" | "kappaRatio" | "kappaFov">)[] {
  return (["rhoAvg", "beta", "omega", "kappaRatio", "kappaFov"] as const).filter((key) => result.normalizedDiagnostics[key] !== null);
}

function pairwise(
  a: CandidateFamilyResult,
  b: CandidateFamilyResult,
  byFingerprint: ReadonlyMap<string, CandidateDiscriminationCandidateResult>,
  candidates: ReadonlyMap<string, FloorCandidateInput>,
  factors: PolicyVariantFactors = CANDIDATE_DISCRIMINATION_POLICY.fixedPolicyVariants.nominal,
  eligibility: ReadonlyMap<string, boolean> | null = null
): PairwiseCandidateComparison {
  const aResult = byFingerprint.get(a.representativeFingerprint)!;
  const bResult = byFingerprint.get(b.representativeFingerprint)!;
  const aCandidate = candidates.get(a.representativeFingerprint)!;
  const bCandidate = candidates.get(b.representativeFingerprint)!;
  const reasons: string[] = [];
  const iou = convexPolygonIoU(aCandidate.sourceFloorPolygon, bCandidate.sourceFloorPolygon);
  const ai = cameraInvariants(aResult);
  const bi = cameraInvariants(bResult);
  const fovDifferenceDeg = ai && bi ? Math.abs(ai.fov - bi.fov) : null;
  const logRatioDifference = ai && bi ? Math.abs(ai.logRatio - bi.logRatio) : null;
  const lookElevationDifferenceDeg = ai && bi ? Math.abs(ai.lookElevation - bi.lookElevation) : null;
  const upTiltDifferenceDeg = ai && bi ? Math.abs(ai.upTilt - bi.upTilt) : null;
  const equivalent = fovDifferenceDeg !== null && logRatioDifference !== null && lookElevationDifferenceDeg !== null && upTiltDifferenceDeg !== null &&
    fovDifferenceDeg <= CANDIDATE_DISCRIMINATION_POLICY.maximumFovDifferenceDeg * factors.cameraEquivalence &&
    logRatioDifference <= CANDIDATE_DISCRIMINATION_POLICY.maximumLogRatioDifference * factors.cameraEquivalence &&
    lookElevationDifferenceDeg <= CANDIDATE_DISCRIMINATION_POLICY.maximumLookElevationDifferenceDeg * factors.cameraEquivalence &&
    upTiltDifferenceDeg <= CANDIDATE_DISCRIMINATION_POLICY.maximumUpTiltDifferenceDeg * factors.cameraEquivalence;
  const high = equivalent && iou !== null && iou >= CANDIDATE_DISCRIMINATION_POLICY.highOverlapEquivalenceIou;
  const low = equivalent && iou !== null && iou < CANDIDATE_DISCRIMINATION_POLICY.lowOverlapDifferentFloorIou;
  const ambiguousOverlap = equivalent && iou !== null && !high && !low;
  if (low) reasons.push("equivalent_camera_different_floor");
  if (ambiguousOverlap) reasons.push("camera_equivalent_ambiguous_overlap");
  const noiseA = aResult.normalizedDiagnostics.residualNoiseScale;
  const noiseB = bResult.normalizedDiagnostics.residualNoiseScale;
  const diff = aResult.normalizedDiagnostics.rhoAvg !== null && bResult.normalizedDiagnostics.rhoAvg !== null ? aResult.normalizedDiagnostics.rhoAvg - bResult.normalizedDiagnostics.rhoAvg : null;
  const noise = noiseA !== null && noiseB !== null ? Math.max(noiseA, noiseB, CANDIDATE_DISCRIMINATION_POLICY.numericalFloor) : null;
  const significant = diff !== null && noise !== null && Math.abs(diff) > CANDIDATE_DISCRIMINATION_POLICY.residualSignificanceMultiplier * factors.residual * noise;
  if (diff !== null && !significant) reasons.push("normalized_residual_margin_not_significant");
  const axes = [...new Set([...availableAxes(aResult), ...availableAxes(bResult)])];
  const pareto = axes.length === 5 && axes.every((axis) => aResult.normalizedDiagnostics[axis] !== null && bResult.normalizedDiagnostics[axis] !== null)
    ? (() => {
        const aNoWorse = axes.every((axis) => aResult.normalizedDiagnostics[axis]! <= bResult.normalizedDiagnostics[axis]! + CANDIDATE_DISCRIMINATION_POLICY.paretoTolerance);
        const bNoWorse = axes.every((axis) => bResult.normalizedDiagnostics[axis]! <= aResult.normalizedDiagnostics[axis]! + CANDIDATE_DISCRIMINATION_POLICY.paretoTolerance);
        const aBetter = axes.some((axis) => aResult.normalizedDiagnostics[axis]! < bResult.normalizedDiagnostics[axis]! - CANDIDATE_DISCRIMINATION_POLICY.paretoTolerance);
        const bBetter = axes.some((axis) => bResult.normalizedDiagnostics[axis]! < aResult.normalizedDiagnostics[axis]! - CANDIDATE_DISCRIMINATION_POLICY.paretoTolerance);
        return aNoWorse && aBetter ? "a_dominates" as const : bNoWorse && bBetter ? "b_dominates" as const : "non_dominated" as const;
      })()
    : "unavailable" as const;
  const aGate = eligibility?.get(a.representativeFingerprint) ?? aResult.rankingEligible;
  const bGate = eligibility?.get(b.representativeFingerprint) ?? bResult.rankingEligible;
  const hardGateDominance = aGate && !bGate ? "a" as const : bGate && !aGate ? "b" as const : "neither" as const;
  let outcome: PairwiseCandidateComparison["outcome"] = "incomparable";
  if (high) outcome = "equivalent";
  else if (!low && !ambiguousOverlap && aGate && bGate && significant && pareto === "a_dominates" && diff! < 0) outcome = "a_wins";
  else if (!low && !ambiguousOverlap && aGate && bGate && significant && pareto === "b_dominates" && diff! > 0) outcome = "b_wins";
  else if (!aGate && !bGate && equivalent) outcome = "equivalent";
  if (outcome === "incomparable") reasons.push("no_defensible_pairwise_winner");
  return deepFreeze({
    familyAFingerprint: a.familyFingerprint,
    familyBFingerprint: b.familyFingerprint,
    polygonIoU: iou,
    cameraInvariantComparison: { fovDifferenceDeg, logRatioDifference, lookElevationDifferenceDeg, upTiltDifferenceDeg, equivalentWithinPolicy: equivalent },
    projectivelyEquivalentHighOverlap: high,
    cameraEquivalentLowOverlap: low,
    equivalentCameraDifferentFloor: low,
    cameraEquivalentAmbiguousOverlap: ambiguousOverlap,
    distinctCompetingCandidate: iou !== null && !high && !low && !ambiguousOverlap && !equivalent,
    hardGateDominance,
    normalizedResidualDifference: diff,
    residualNoiseScale: noise,
    residualDifferenceSignificant: significant,
    paretoRelation: pareto,
    outcome,
    reasons,
  });
}

function dispersion(members: readonly CandidateDiscriminationCandidateResult[]): CandidateFamilyResult["metricDispersion"] {
  const spread = (key: keyof NormalizedDiagnostics) => {
    const values = members.flatMap((member) => member.normalizedDiagnostics[key] === null ? [] : [member.normalizedDiagnostics[key]!]);
    return values.length ? Math.max(...values) - Math.min(...values) : null;
  };
  return deepFreeze({ rhoAvg: spread("rhoAvg"), beta: spread("beta"), omega: spread("omega"), kappaRatio: spread("kappaRatio"), kappaFov: spread("kappaFov") });
}

type PolicyVariantName = keyof typeof CANDIDATE_DISCRIMINATION_POLICY.fixedPolicyVariants;
type PolicyVariantFactors = (typeof CANDIDATE_DISCRIMINATION_POLICY.fixedPolicyVariants)[PolicyVariantName];

function comparisonRelevantForVariant(result: CandidateDiscriminationCandidateResult, factors: PolicyVariantFactors): boolean {
  const gate = result.hardGates;
  const metrics = result.polygonMetrics;
  return gate.harnessSuccess && gate.bestCellAvailable &&
    (metrics.rmsCornerSpreadFramePx ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumPolygonRmsSpreadFramePx * factors.extent &&
    (metrics.minimumEdgeLengthFramePx ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumEdgeLengthFramePx * factors.extent &&
    (metrics.minimumInteriorAngleDeg ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumInteriorAngleDeg * factors.extent &&
    (metrics.nearToFarEdgeRatio ?? -Infinity) >= CANDIDATE_DISCRIMINATION_POLICY.minimumForeshorteningRatio * factors.extent &&
    gate.cameraHeightPositive && gate.minimumDepthSufficient && gate.refinementCoverageComplete;
}

function rankingEligibleForVariant(result: CandidateDiscriminationCandidateResult, factors: PolicyVariantFactors): boolean {
  const gate = result.hardGates;
  return comparisonRelevantForVariant(result, factors) && gate.isolatedClassification && gate.isolatedRecommendationAvailable &&
    gate.normalizedObservabilityAvailable && gate.bestRatioInterior && gate.bestFovInterior &&
    gate.strictEnvelopeRatioInterior && gate.strictEnvelopeFovInterior && gate.applyObservabilityAvailable &&
    gate.confirmationPerturbationEnabled && gate.confirmationClassificationStable && result.boundary.comparisonReliability === "full";
}

type SelectionEvaluation = Readonly<{
  selectionState: SelectionState;
  selectedFamilyFingerprint: string | null;
  refusalReasons: readonly string[];
  eligibleFamilyFingerprints: readonly string[];
  comparisonRelevantFamilyFingerprints: readonly string[];
}>;

function evaluateSelection(
  families: readonly CandidateFamilyResult[],
  pairs: readonly PairwiseCandidateComparison[],
  comparisonRelevantForFamily: (family: CandidateFamilyResult) => boolean,
  rankingEligibleForFamily: (family: CandidateFamilyResult) => boolean
): SelectionEvaluation {
  const relevant = families.filter(comparisonRelevantForFamily);
  const eligible = relevant.filter((family) => !family.familyStageAGateDisagreement && !family.representativeConfirmationFailure && rankingEligibleForFamily(family));
  const relevantFingerprints = new Set(relevant.map((family) => family.familyFingerprint));
  const relevantPairs = pairs.filter((pair) => relevantFingerprints.has(pair.familyAFingerprint) && relevantFingerprints.has(pair.familyBFingerprint));
  const familyStageAGateDisagreements = relevant.filter((family) => family.familyStageAGateDisagreement);
  const representativeConfirmationFailures = relevant.filter((family) => family.representativeConfirmationFailure);
  const epsilonBoundaryInstabilities = relevant.filter((family) => family.epsilonBoundaryInstability);
  const competitiveNonEligibleBlockers = relevant.filter((family) => !rankingEligibleForFamily(family));
  const cameraEquivalentDifferentFloorBlockers = relevantPairs.filter((pair) => pair.equivalentCameraDifferentFloor);
  const cameraEquivalentAmbiguousOverlapBlockers = relevantPairs.filter((pair) => pair.cameraEquivalentAmbiguousOverlap);
  const refusalReasons: string[] = [];
  let selectionState: SelectionState;
  let selectedFamilyFingerprint: string | null = null;
  if (!relevant.length) {
    selectionState = "no_valid_candidate";
    refusalReasons.push("no_valid_candidate");
  }
  else if (familyStageAGateDisagreements.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("family_stage_a_gate_disagreement");
  } else if (representativeConfirmationFailures.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("representative_confirmation_failure");
  } else if (epsilonBoundaryInstabilities.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("epsilon_boundary_instability");
  } else if (competitiveNonEligibleBlockers.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("competitive_non_eligible_blocker");
  } else if (cameraEquivalentDifferentFloorBlockers.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("equivalent_camera_different_floor");
  } else if (cameraEquivalentAmbiguousOverlapBlockers.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("camera_equivalent_ambiguous_overlap");
  } else if (!eligible.length) {
    selectionState = "insufficient_discrimination";
    refusalReasons.push("no_ranking_eligible_family");
  } else if (eligible.length === 1) {
    const winner = eligible[0];
    if (winner.totalReportingCandidateCount > 1) {
      selectionState = "equivalent_candidate_family";
    } else {
      selectionState = "unique_candidate";
      selectedFamilyFingerprint = winner.familyFingerprint;
    }
  } else {
    const winners = eligible.filter((family) => eligible.every((other) =>
      other === family || pairs.some((pair) =>
        (pair.familyAFingerprint === family.familyFingerprint && pair.familyBFingerprint === other.familyFingerprint && pair.outcome === "a_wins") ||
        (pair.familyBFingerprint === family.familyFingerprint && pair.familyAFingerprint === other.familyFingerprint && pair.outcome === "b_wins")
      )
    ));
    if (winners.length === 1) {
      selectionState = "unique_candidate";
      selectedFamilyFingerprint = winners[0].familyFingerprint;
    } else if (relevantPairs.some((pair) => pair.outcome === "incomparable")) {
      selectionState = "insufficient_discrimination";
      refusalReasons.push("pairwise_comparison_incomplete_or_equivalent_camera");
    } else selectionState = "multiple_plausible_candidates";
  }
  return deepFreeze({
    selectionState,
    selectedFamilyFingerprint,
    refusalReasons: [...new Set(refusalReasons)].sort(compareCanonicalStrings),
    eligibleFamilyFingerprints: eligible.map((family) => family.familyFingerprint).sort(compareCanonicalStrings),
    comparisonRelevantFamilyFingerprints: relevant.map((family) => family.familyFingerprint).sort(compareCanonicalStrings),
  });
}

function variantSelection(
  groups: readonly Family[],
  byGeometry: ReadonlyMap<string, CandidateDiscriminationCandidateResult>,
  factors: PolicyVariantFactors
): SelectionEvaluation & Readonly<{ pairwiseComparisons: readonly PairwiseCandidateComparison[] }> {
  const families = groups.map((group) => {
    const members = group.members.map((member) => byGeometry.get(member.canonical)!);
    const representative = byGeometry.get(group.representative.canonical)!;
    return deepFreeze({
      familyFingerprint: group.fingerprint,
      representativeFingerprint: group.representative.fingerprint,
      memberFingerprints: group.members.map((member) => member.fingerprint).sort(compareCanonicalStrings),
      exactDuplicateCount: group.members.reduce((count, member) => count + member.members.length, 0) - group.members.length,
      nearDuplicateCount: group.members.length,
      totalReportingCandidateCount: group.members.reduce((count, member) => count + member.members.length, 0),
      familyStageAGateDisagreement: new Set(members.map((member) => stableSerialize(member.familyComparableStageAGates))).size > 1,
      representativeConfirmationFailure: representative.stageB !== null && !representative.hardGates.confirmationClassificationStable,
      metricDispersion: dispersion(members),
      epsilonBoundaryInstability: group.epsilonBoundaryInstability,
    });
  }).sort((a, b) => compareCanonicalStrings(a.familyFingerprint, b.familyFingerprint));
  const candidateByFingerprint = new Map<string, FloorCandidateInput>();
  const eligibility = new Map<string, boolean>();
  for (const group of groups) for (const member of group.members) candidateByFingerprint.set(member.fingerprint, member.candidate);
  for (const group of groups) eligibility.set(group.representative.fingerprint, rankingEligibleForVariant(byGeometry.get(group.representative.canonical)!, factors));
  const representatives = new Map<string, CandidateDiscriminationCandidateResult>();
  for (const family of families) representatives.set(family.representativeFingerprint, byGeometry.get(groups.find((group) => group.fingerprint === family.familyFingerprint)!.representative.canonical)!);
  const pairs: PairwiseCandidateComparison[] = [];
  for (let index = 0; index < families.length; index += 1) for (let other = index + 1; other < families.length; other += 1) pairs.push(pairwise(families[index], families[other], representatives, candidateByFingerprint, factors, eligibility));
  return deepFreeze({
    ...evaluateSelection(
      families,
      pairs,
      (family) => comparisonRelevantForVariant(representatives.get(family.representativeFingerprint)!, factors),
      (family) => rankingEligibleForVariant(representatives.get(family.representativeFingerprint)!, factors)
    ),
    pairwiseComparisons: pairs,
  });
}

function invalidResult(input: FloorCandidateComparisonInput, reason: string): CandidateDiscriminationResult {
  const comparisonFingerprint = fnv1a32(stableSerialize({ invalid: true, context: input.sharedContext ?? null, candidates: (input.candidates ?? []).map(candidateCanonicalPolygon).sort(compareCanonicalStrings), policy: CANDIDATE_DISCRIMINATION_POLICY, selectionPolicyVersion: input.selectionPolicyVersion ?? null }));
  return deepFreeze({
    status: "comparison_context_invalid", selectionState: "comparison_context_invalid",
    contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION, researchConfigVersion: CANDIDATE_DISCRIMINATION_RESEARCH_CONFIG_VERSION, selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION, equivalencePolicyVersion: CANDIDATE_EQUIVALENCE_POLICY_VERSION,
    comparisonFingerprint, sharedContextSummary: null, safety: SAFETY, policy: CANDIDATE_DISCRIMINATION_POLICY,
    candidateResults: [], candidateFamilies: [], pairwiseComparisons: [], policyVariantResults: [],
    rankingStages: { exactDistinctCandidateCount: 0, stageAEvaluationCount: 0, comparisonRelevantFamilyCount: 0, stageBEvaluationCount: 0, exactDuplicateEvaluationReuse: 0, pairwiseComparisonCount: 0 },
    comparisonRelevantCandidates: [], rankingEligibleCandidates: [], rejectedCandidates: [], selectedCandidateFingerprint: null, selectedFamilyFingerprint: null,
    selectionMarginEvidence: [], diagnosticsUsed: [], diagnosticsExcluded: CANDIDATE_DISCRIMINATION_POLICY.excludedDiagnostics, refusalReasons: [reason], warnings: ["AFC-R2 is research-only and has no Apply authority."],
  });
}

/** Runs deterministic, read-only Stage A and necessary Stage B AFC-R1H2 experiments. */
export function runCandidateDiscriminationExperiment(input: FloorCandidateComparisonInput): CandidateDiscriminationResult {
  if (!input || input.contractVersion !== CANDIDATE_DISCRIMINATION_CONTRACT_VERSION) return invalidResult(input ?? ({} as FloorCandidateComparisonInput), "comparison_contract_invalid");
  if (input.selectionPolicyVersion !== CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION) return invalidResult(input, "selection_policy_invalid");
  if (!validContext(input.sharedContext)) return invalidResult(input, "shared_context_invalid");
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) return invalidResult(input, "candidates_required");
  const ids = input.candidates.map((candidate) => candidate?.candidateId);
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) return invalidResult(input, "candidate_ids_must_be_unique_non_empty");
  const context = input.sharedContext;
  const keyed = new Map<string, { candidate: FloorCandidateInput; canonical: string }>();
  for (const candidate of input.candidates) {
    const canonical = candidateInputValid(candidate) ? candidateCanonicalPolygon(candidate) : stableSerialize({ invalid: true, candidateId: candidate.candidateId });
    if (!keyed.has(canonical)) keyed.set(canonical, { candidate, canonical });
  }
  const distinct: Distinct[] = [...keyed.values()].map(({ candidate, canonical }) => {
    const preliminary = fnv1a32(stableSerialize({ context: contextFingerprint(context), polygon: canonical, semanticOrder: candidate.semanticOrder, coordinateSpace: candidate.coordinateSpace }));
    const fixtureId = `afc-r2-candidate:${preliminary}`;
    const fingerprint = geometryFingerprint(context, candidate, fixtureId);
    const stageA = runRatioFovExperiment(experimentInput(context, candidate, fixtureId, false));
    return { key: canonical, fingerprint, candidate, members: input.candidates.filter((member) => candidateInputValid(member) ? candidateCanonicalPolygon(member) === canonical : member === candidate), stageA, stageB: null, canonical };
  }).sort((a, b) => compareCanonicalStrings(a.canonical, b.canonical));
  const families = completeLinkFamilies(context, distinct, CANDIDATE_DISCRIMINATION_POLICY.nearDuplicateToleranceIntrinsicPx);
  for (const family of families) {
    const representative = family.representative;
    const metrics = polygonMetrics(representative.stageA);
    const preliminaryBoundary = boundarySummary(context, representative.stageA);
    const preliminaryGates = gates(context, true, candidateInputValid(representative.candidate), metrics, representative.stageA, null, preliminaryBoundary);
    if (comparisonRelevant(preliminaryGates)) {
      const fixtureId = `afc-r2-candidate:${fnv1a32(stableSerialize({ context: contextFingerprint(context), polygon: representative.canonical, semanticOrder: representative.candidate.semanticOrder, coordinateSpace: representative.candidate.coordinateSpace }))}`;
      representative.stageB = runRatioFovExperiment(experimentInput(context, representative.candidate, fixtureId, true));
    }
  }
  const byGeometry = new Map<string, CandidateDiscriminationCandidateResult>();
  const candidatesByFingerprint = new Map<string, FloorCandidateInput>();
  for (const item of distinct) {
    const family = families.find((group) => group.members.includes(item))!;
    const stageB = item === family.representative ? item.stageB : null;
    const effective = stageB ?? item.stageA;
    const metrics = polygonMetrics(item.stageA);
    const stageABoundary = boundarySummary(context, item.stageA);
    const stageAGate = gates(context, true, candidateInputValid(item.candidate), metrics, item.stageA, null, stageABoundary);
    const boundary = boundarySummary(context, effective);
    const gate = gates(context, true, candidateInputValid(item.candidate), metrics, item.stageA, stageB, boundary);
    const result: CandidateDiscriminationCandidateResult = deepFreeze({
      candidateGeometryFingerprint: item.fingerprint,
      candidateId: item.members.map((member) => member.candidateId).sort(compareCanonicalStrings)[0],
      canonicalPolygonKey: item.canonical,
      stageA: item.stageA,
      stageB,
      effectiveStage: stageB ? "stageB" : "stageA",
      validityLayer: layer(gate, item.stageA),
      polygonMetrics: metrics,
      hardGates: gate,
      familyComparableStageAGates: stageAComparableGates(stageAGate),
      normalizedDiagnostics: diagnostics(context, metrics, effective),
      boundary,
      comparisonRelevant: comparisonRelevant(gate),
      rankingEligible: rankingEligible(gate, boundary),
      refusalReasons: refusalReasons(gate, effective, boundary),
      familyFingerprint: family.fingerprint,
    });
    byGeometry.set(item.canonical, result);
    candidatesByFingerprint.set(item.fingerprint, item.candidate);
  }
  const perCandidate = input.candidates.map((candidate) => {
    const canonical = candidateInputValid(candidate) ? candidateCanonicalPolygon(candidate) : stableSerialize({ invalid: true, candidateId: candidate.candidateId });
    const underlying = byGeometry.get(canonical);
    if (underlying) return deepFreeze({ ...underlying, candidateId: candidate.candidateId });
    throw new Error("Validated candidate geometry was not evaluated.");
  }).sort((a, b) => compareCanonicalStrings(a.candidateGeometryFingerprint, b.candidateGeometryFingerprint) || compareCanonicalStrings(a.candidateId, b.candidateId));
  const representativeResults = new Map<string, CandidateDiscriminationCandidateResult>();
  for (const family of families) representativeResults.set(family.representative.fingerprint, byGeometry.get(family.representative.canonical)!);
  const familyResults: CandidateFamilyResult[] = families.map((family) => {
    const memberResults = family.members.map((member) => byGeometry.get(member.canonical)!);
    const representative = byGeometry.get(family.representative.canonical)!;
    const disagreement = new Set(memberResults.map((member) => stableSerialize(member.familyComparableStageAGates))).size > 1;
    return deepFreeze({
      familyFingerprint: family.fingerprint,
      representativeFingerprint: family.representative.fingerprint,
      memberFingerprints: family.members.map((member) => member.fingerprint).sort(compareCanonicalStrings),
      exactDuplicateCount: family.members.reduce((sum, member) => sum + member.members.length, 0) - family.members.length,
      nearDuplicateCount: family.members.length,
      totalReportingCandidateCount: family.members.reduce((sum, member) => sum + member.members.length, 0),
      familyStageAGateDisagreement: disagreement,
      representativeConfirmationFailure: representative.stageB !== null && !representative.hardGates.confirmationClassificationStable,
      metricDispersion: dispersion(memberResults),
      epsilonBoundaryInstability: family.epsilonBoundaryInstability,
    });
  }).sort((a, b) => compareCanonicalStrings(a.familyFingerprint, b.familyFingerprint));
  const pairs: PairwiseCandidateComparison[] = [];
  for (let index = 0; index < familyResults.length; index += 1) for (let other = index + 1; other < familyResults.length; other += 1) pairs.push(pairwise(familyResults[index], familyResults[other], representativeResults, candidatesByFingerprint));
  const nominalSelection = evaluateSelection(
    familyResults,
    pairs,
    (family) => !!representativeResults.get(family.representativeFingerprint)?.comparisonRelevant,
    (family) => !!representativeResults.get(family.representativeFingerprint)?.rankingEligible
  );
  let selectionState = nominalSelection.selectionState;
  let selectedFamily = nominalSelection.selectedFamilyFingerprint;
  const refusal = [...nominalSelection.refusalReasons];
  // Fixed AFC-R2-only variants re-group existing evidence without new AFC-R1H2 executions.
  const variants = (["nominal", "conservative", "permissive"] as const).map((name) => {
    const factors = CANDIDATE_DISCRIMINATION_POLICY.fixedPolicyVariants[name];
    const variantFamilies = completeLinkFamilies(context, distinct, CANDIDATE_DISCRIMINATION_POLICY.nearDuplicateToleranceIntrinsicPx * factors.nearDuplicate);
    const variant = variantSelection(variantFamilies, byGeometry, factors);
    return deepFreeze({
      name,
      familyFingerprints: variantFamilies.map((family) => family.fingerprint).sort(compareCanonicalStrings),
      selectionState: variant.selectionState,
      selectedFamilyFingerprint: variant.selectedFamilyFingerprint,
      afcR1H2Reevaluated: false as const,
    });
  });
  const allNoValid = variants.every((variant) => variant.selectionState === "no_valid_candidate");
  const materialVariantDisagreement = !allNoValid && variants.some((variant) =>
    variant.selectionState !== variants[0].selectionState ||
    variant.selectedFamilyFingerprint !== variants[0].selectedFamilyFingerprint ||
    stableSerialize(variant.familyFingerprints) !== stableSerialize(variants[0].familyFingerprints)
  );
  if (materialVariantDisagreement) {
    selectionState = "insufficient_discrimination";
    selectedFamily = null;
    refusal.push("policy_variant_disagreement");
  }
  const winner = selectedFamily ? familyResults.find((family) => family.familyFingerprint === selectedFamily) : null;
  const comparisonFingerprint = fnv1a32(stableSerialize({
    sharedContext: context, geometries: distinct.map((item) => item.canonical).sort(compareCanonicalStrings), selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
    equivalencePolicyVersion: CANDIDATE_EQUIVALENCE_POLICY_VERSION, policy: CANDIDATE_DISCRIMINATION_POLICY, researchConfigVersion: CANDIDATE_DISCRIMINATION_RESEARCH_CONFIG_VERSION,
  }));
  return deepFreeze({
    status: selectionState, selectionState,
    contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION, researchConfigVersion: CANDIDATE_DISCRIMINATION_RESEARCH_CONFIG_VERSION, selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION, equivalencePolicyVersion: CANDIDATE_EQUIVALENCE_POLICY_VERSION,
    comparisonFingerprint, sharedContextSummary: cloneContext(context), safety: SAFETY, policy: CANDIDATE_DISCRIMINATION_POLICY,
    candidateResults: perCandidate, candidateFamilies: familyResults, pairwiseComparisons: pairs,
    policyVariantResults: variants,
    rankingStages: { exactDistinctCandidateCount: distinct.length, stageAEvaluationCount: distinct.length, comparisonRelevantFamilyCount: nominalSelection.comparisonRelevantFamilyFingerprints.length, stageBEvaluationCount: distinct.filter((item) => item.stageB !== null).length, exactDuplicateEvaluationReuse: input.candidates.length - distinct.length, pairwiseComparisonCount: pairs.length },
    comparisonRelevantCandidates: perCandidate.filter((candidate) => candidate.comparisonRelevant).map((candidate) => candidate.candidateGeometryFingerprint),
    rankingEligibleCandidates: perCandidate.filter((candidate) => candidate.rankingEligible).map((candidate) => candidate.candidateGeometryFingerprint),
    rejectedCandidates: perCandidate.filter((candidate) => !candidate.rankingEligible).map((candidate) => candidate.candidateGeometryFingerprint),
    selectedCandidateFingerprint: winner?.representativeFingerprint ?? null, selectedFamilyFingerprint: selectedFamily,
    selectionMarginEvidence: pairs.map((pair) => `${pair.familyAFingerprint}/${pair.familyBFingerprint}:${pair.outcome}:${pair.normalizedResidualDifference ?? "unavailable"}`),
    diagnosticsUsed: ["rhoAvg (cvAvgPx / polygon RMS spread)", "beta (cvMaxPx / cvAvgPx)", "omega (1 - normalized orthogonality observability)", "kappaRatio", "kappaFov", "public camera invariants", "polygon IoU only for equivalence/ambiguity"],
    diagnosticsExcluded: CANDIDATE_DISCRIMINATION_POLICY.excludedDiagnostics,
    // Candidate-local rejection diagnostics remain on each candidate result.
    // Top-level refusals describe only the selector's final decision.
    refusalReasons: [...new Set(refusal)].sort(compareCanonicalStrings),
    warnings: ["AFC-R2 is exploratory, deterministic, read-only, geometry-only research.", "selectedCandidateFingerprint is comparison output only; it is not Floor or Apply authority.", "Provenance fields including candidateId, source, role, notes, and transformSpec do not affect geometry fingerprints or ranking."],
  });
}

export const CANDIDATE_DISCRIMINATION_DEFAULT_CONTEXT = Object.freeze({
  ratioDomain: RATIO_FOV_DEFAULT_DOMAINS.ratio,
  fovDomain: RATIO_FOV_DEFAULT_DOMAINS.fov,
  refinement: RATIO_FOV_DEFAULT_DOMAINS.refinement,
});
