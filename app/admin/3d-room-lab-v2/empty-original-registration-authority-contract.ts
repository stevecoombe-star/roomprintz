export const AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION =
  "afc-v2-empty-original-registration-authority/v1" as const;
export const AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION =
  "afc-v2-empty-original-registration-identity/v2" as const;
export const AFC_V2_EMPTY_ORIGINAL_REGISTRATION_SOURCE_SPACE =
  "empty-source-normalized-image/v1" as const;
export const AFC_V2_EMPTY_ORIGINAL_REGISTRATION_TARGET_SPACE =
  "original-source-normalized-image/v1" as const;

/**
 * Versioned identity-uv gates. These are fail-closed engineering thresholds,
 * not calibrated probabilities. Do not loosen them to force Rooms 2/3.
 *
 * v1 used REGISTRATION_MIN_IDENTITY_INLIERS against raw sampled points.
 * v2 does not use that count as a certification gate; inlier fraction 0.70 is
 * applied to independent evidence units (structureId × evidenceClass).
 */
export const REGISTRATION_MIN_IDENTITY_INLIERS = 8;
export const REGISTRATION_MIN_INLIER_FRACTION = 0.7;
export const REGISTRATION_MAX_IDENTITY_RESIDUAL = 0.003;
export const REGISTRATION_MAX_RMS_RESIDUAL = 0.0015;
export const REGISTRATION_MIN_QUADRANT_COUNT = 3;
export const REGISTRATION_MIN_HULL_AREA = 0.12;
/**
 * Quadrant membership ignores a central box so a tiny cluster straddling
 * (0.5, 0.5) cannot satisfy image-coverage spread. Audited alternative
 * remains hull area >= 0.12.
 */
export const REGISTRATION_QUADRANT_CENTER_INSET = 0.15;
export const REGISTRATION_MIN_SECOND_PCA_RATIO = 0.05;
export const REGISTRATION_DIAGNOSTIC_SCALE_ABS_MAX = 0.006;
export const REGISTRATION_DIAGNOSTIC_TX_ABS_MAX = 0.004;
export const REGISTRATION_DIAGNOSTIC_TY_ABS_MAX = 0.004;
export const REGISTRATION_SEARCH_WINDOW = 0.04;
export const REGISTRATION_MIN_DISTINCT_STRUCTURES = 2;
/**
 * Same 15° competing-orientation idea as S4A, defined locally so
 * registration does not import S4A world/line-fit modules.
 */
export const REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD = (15 * Math.PI) / 180;
export const REGISTRATION_MIN_ORIENTATION_BINS = 2;
export const REGISTRATION_MIN_POINT_ANCHORS = 2;
export const REGISTRATION_MIN_SAME_OBJECT_ANCHORS = 3;
export const REGISTRATION_MIN_ANCHOR_SEPARATION = 0.15;
export const REGISTRATION_MIN_PARALLEL_RIDGE_SEPARATION = 0.15;
export const REGISTRATION_MIN_RIDGE_MATCHED_SAMPLES = 2;
export const REGISTRATION_MIN_RIDGE_MATCH_FRACTION = 0.5;
export const REGISTRATION_MIN_ANCHOR_TURN_RAD = (30 * Math.PI) / 180;
export const REGISTRATION_MIN_OPENING_EDGE_LENGTH = 0.04;
export const REGISTRATION_MIN_RIDGE_SUPPORT_FOR_ANCHOR_ZOOM = 1;
/**
 * UI-only. Never applied to certification residuals.
 */
export const REGISTRATION_DISPLAY_IDENTITY_LOCK_PX = 1.5;

export type EmptyOriginalRegistrationClass =
  | "exact_grid_registered"
  | "certified_rescaled_registered"
  | "insufficient"
  | "rejected";

export type EmptyOriginalRegistrationTransformKind =
  | "identity_normalized"
  | "none";

export type EmptyOriginalCompatibilityTier =
  | "exact_grid_compatible"
  | "aspect_compatible_rescaled"
  | "incompatible"
  | "unavailable";

export type EmptyOriginalRegistrationEvidenceClass =
  | "point_anchor"
  | "ridge_normal";

export type EmptyOriginalRegistrationEvidenceStatus =
  | "inlier"
  | "no_match"
  | "contradiction"
  | "ambiguous";

export type EmptyOriginalRegistrationTangentLocalization =
  | "localized"
  | "ambiguous"
  | "not_applicable";

export type EmptyOriginalRegistrationZoomLockConfiguration =
  | "anchors_plus_ridges"
  | "parallel_pair_plus_nonparallel"
  | "unsatisfied"
  | "not_applicable";

export type EmptyOriginalNormalizedUv = Readonly<{
  u: number;
  v: number;
}>;

export type EmptyOriginalFittedLine = Readonly<{
  theta: number;
  rho: number;
  origin: EmptyOriginalNormalizedUv;
  direction: EmptyOriginalNormalizedUv;
}>;

export type EmptyOriginalPointResidual = Readonly<{
  du: number;
  dv: number;
  magnitude: number;
}>;

export type EmptyOriginalRidgeResidual = Readonly<{
  normal: number;
  orientation: number | null;
  tangentDiagnostic: number | null;
}>;

export type EmptyOriginalRidgeSampleDiagnostics = Readonly<{
  sampleCount: number;
  matchedSampleCount: number;
  medianNormalResidual: number | null;
  maxNormalResidual: number | null;
  rmsNormalResidual: number | null;
  orientationResidual: number | null;
  normalResidualVariance: number | null;
  bimodalOffsetDetected: boolean;
}>;

/**
 * Independent evidence unit (structureId × evidenceClass). Overlay and
 * certification consume these, not raw sampled points.
 */
export type EmptyOriginalRegistrationCorrespondence = Readonly<{
  priorId: string;
  structureId: string;
  parentStructureId: string | null;
  structureKind: string;
  kind: EmptyOriginalRegistrationEvidenceClass;
  empty: EmptyOriginalNormalizedUv;
  original: EmptyOriginalNormalizedUv | null;
  residual: number | null;
  inlier: boolean;
  status: EmptyOriginalRegistrationEvidenceStatus;
  emptyLine: EmptyOriginalFittedLine | null;
  originalLine: EmptyOriginalFittedLine | null;
  pointResidual: EmptyOriginalPointResidual | null;
  ridgeResidual: EmptyOriginalRidgeResidual | null;
  tangentLocalization: EmptyOriginalRegistrationTangentLocalization;
  sampleDiagnostics: EmptyOriginalRidgeSampleDiagnostics | null;
  displaySnapped: boolean;
}>;

/**
 * RAW sample/point diagnostics. Not the independent-evidence denominator.
 */
export type EmptyOriginalRegistrationRawSample = Readonly<{
  priorId: string;
  structureId: string;
  structureKind: string;
  evidenceClass: EmptyOriginalRegistrationEvidenceClass;
  empty: EmptyOriginalNormalizedUv;
  original: EmptyOriginalNormalizedUv | null;
  residual: number | null;
  ncc: number | null;
  status: "matched" | "no_match";
}>;

export type EmptyOriginalDiagnosticSimilarity = Readonly<{
  scale: number;
  tx: number;
  ty: number;
  scaleAbsFromIdentity: number;
  txAbs: number;
  tyAbs: number;
  input: "class_a_raw_anchors";
}>;

export const EMPTY_ORIGINAL_REGISTRATION_REASON = {
  exactGridRegistered: "exact_grid_registered",
  certifiedRescaledRegistered: "certified_rescaled_registered",
  rasterProofRequired: "raw_aspect_metadata_without_raster_proof",
  incompatiblePair: "empty_original_incompatible",
  orientationMismatch: "orientation_mismatch",
  decodeFailed: "raster_decode_failed",
  malformedRaster: "malformed_raster",
  insufficientPriors: "insufficient_distinct_architectural_structures",
  tooFewInliers: "too_few_identity_inliers",
  inlierFractionLow: "attempted_inlier_fraction_below_gate",
  residualExceedsMax: "identity_residual_exceeds_max",
  residualExceedsRms: "identity_rms_residual_exceeds_max",
  insufficientSpread: "correspondence_spread_insufficient",
  collinearCorrespondences: "correspondences_collinear_or_one_wall",
  diagnosticSimilarityDivergent: "diagnostic_similarity_non_identity",
  edgeDivergenceHidden: "divergent_edges_not_discardable",
  shiftedOrZoomed: "shifted_crop_or_zoom_or_warp",
  constructionFailedClosed: "registration_construction_failed_closed",
  ridgeNormalContradiction: "ridge_normal_contradiction",
  pointAnchorContradiction: "point_anchor_contradiction",
  ridgeBimodalParallelFamily: "ridge_bimodal_parallel_family",
  orientationDiversityInsufficient: "orientation_diversity_insufficient",
  zoomLockUnsatisfied: "zoom_lock_unsatisfied",
  insufficientPointAnchors: "insufficient_point_anchors",
  insufficientIndependentGeometry: "insufficient_independent_evidence_geometry",
  ridgeScaleNonIdentity: "diagnostic_ridge_scale_non_identity",
} as const;

export type EmptyOriginalRegistrationLimitations = Readonly<{
  globalOnly: true;
  localAuthority: false;
  fittedTransformNotAuthoritative: true;
  rasterProofRequiredForRescaled: true;
  ridgeTangentNonAuthoritative: true;
  diagnosticSimilarityClassAOnly: true;
}>;

export type EmptyOriginalRegistrationLineage = Readonly<{
  methodVersion: typeof AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION;
  emptyIdentity: Readonly<{
    sha256: string | null;
    decodedWidth: number | null;
    decodedHeight: number | null;
    orientation: number | null;
  }>;
  originalIdentity: Readonly<{
    sha256: string | null;
    decodedWidth: number | null;
    decodedHeight: number | null;
    orientation: number | null;
  }>;
  emptySha256: string | null;
  originalSha256: string | null;
  observationSchemaVersion: string | null;
  observationEvidenceId: string | null;
  rasterProofAttempted: boolean;
}>;

export type EmptyOriginalRegistrationResiduals = Readonly<{
  max: number | null;
  rms: number | null;
  maxAbsU: number | null;
  maxAbsV: number | null;
  anchorMax: number | null;
  anchorRms: number | null;
  ridgeNormalMax: number | null;
  ridgeNormalRms: number | null;
  diagnosticSimilarity: EmptyOriginalDiagnosticSimilarity | null;
  diagnosticRidgeScale: number | null;
  diagnosticRidgeScaleAbsFromIdentity: number | null;
}>;

export type EmptyOriginalRegistrationSpread = Readonly<{
  quadrantCount: number;
  hullArea: number;
  secondPcaRatio: number;
  distinctStructureCount: number;
}>;

export type AfcV2EmptyOriginalRegistrationAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION;
  sourceSpace: typeof AFC_V2_EMPTY_ORIGINAL_REGISTRATION_SOURCE_SPACE;
  targetSpace: typeof AFC_V2_EMPTY_ORIGINAL_REGISTRATION_TARGET_SPACE;
  authority: "empty_original_registration_authority";
  methodVersion: typeof AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION;
  registrationClass: EmptyOriginalRegistrationClass;
  transformKind: EmptyOriginalRegistrationTransformKind;
  transform: Readonly<{
    kind: EmptyOriginalRegistrationTransformKind;
    su: number;
    sv: number;
    tu: number;
    tv: number;
  }> | null;
  oldCompatibilityTier: EmptyOriginalCompatibilityTier;
  collisionPromotionEligible: boolean;
  geometryManufactured: false;
  residuals: EmptyOriginalRegistrationResiduals;
  /**
   * RAW matched sample/point count. Diagnostic only. Not the independent
   * evidence numerator.
   */
  correspondenceCount: number;
  /**
   * RAW attempted sample/point count. Diagnostic only. Not the independent
   * evidence denominator.
   */
  attemptedCorrespondenceCount: number;
  /**
   * Structure-level inlier fraction: independent inlier units / attempted
   * independent evidence units.
   */
  inlierFraction: number | null;
  correspondenceSpread: EmptyOriginalRegistrationSpread | null;
  outlierCount: number;
  correspondences: readonly EmptyOriginalRegistrationCorrespondence[];
  rawPointDiagnostics: readonly EmptyOriginalRegistrationRawSample[];
  anchorCount: number;
  anchorInlierCount: number;
  ridgeStructureCount: number;
  ridgeInlierCount: number;
  independentEvidenceUnitCount: number;
  attemptedEvidenceUnitCount: number;
  orientationBinCount: number | null;
  zoomLockSatisfied: boolean | null;
  zoomLockConfiguration: EmptyOriginalRegistrationZoomLockConfiguration;
  contradictionCount: number;
  limitations: EmptyOriginalRegistrationLimitations;
  lineage: EmptyOriginalRegistrationLineage;
  constructionReasons: readonly string[];
  receiptSha256: string;
}>;

export function freezeEmptyOriginalRegistrationReceipt(
  receipt: AfcV2EmptyOriginalRegistrationAuthorityReceipt,
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  return deepFreeze(receipt);
}

export function registrationCollisionPromotionEligible(
  registrationClass: EmptyOriginalRegistrationClass,
): boolean {
  return registrationClass === "exact_grid_registered" ||
    registrationClass === "certified_rescaled_registered";
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(object as Record<string, unknown>)) {
      deepFreeze(child, seen);
    }
    if (!Object.isFrozen(object)) Object.freeze(object);
  }
  return value;
}
