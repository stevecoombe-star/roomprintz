import type { EmptyOriginalCompatibilityTier } from "./empty-original-registration-authority-contract";

export const AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION =
  "afc-v2-original-structural-localization-authority/v1" as const;
export const AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION =
  "afc-v2-original-structure-localizer/v1" as const;
export const EMPTY_SOURCE_NORMALIZED_IMAGE_SPACE =
  "empty-source-normalized-image/v1" as const;
export const ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE =
  "original-source-normalized-image/v1" as const;

export type EmptySourceNormalizedPoint = Readonly<{
  basis: typeof EMPTY_SOURCE_NORMALIZED_IMAGE_SPACE;
  x: number;
  y: number;
}>;

export type OriginalSourceNormalizedPoint = Readonly<{
  basis: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
  x: number;
  y: number;
}>;

export function emptySourcePoint(x: number, y: number): EmptySourceNormalizedPoint {
  return { basis: EMPTY_SOURCE_NORMALIZED_IMAGE_SPACE, x, y };
}

export function originalSourcePoint(
  x: number,
  y: number,
): OriginalSourceNormalizedPoint {
  return { basis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE, x, y };
}

export function untagSourcePoint(
  point: EmptySourceNormalizedPoint | OriginalSourceNormalizedPoint | Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return { x: point.x, y: point.y };
}

export type OriginalStructuralLocalizationClass =
  | "certified_original_localized"
  | "original_localization_insufficient"
  | "original_localization_rejected"
  | "not_attempted";

export type OriginalLocalizationStatus =
  | "localized"
  | "no_match"
  | "ambiguous"
  | "rejected";

export type OriginalLocalizationClassKind = "point_anchor" | "ridge_normal";

export type OriginalLocalizationCollisionRelevance =
  | "floor_wall"
  | "opening_floor_reaching"
  | "opening_non_floor_reaching"
  | "wall_wall_diagnostic"
  | "other";

export const ORIGINAL_LOCALIZATION_REASON = {
  notAttemptedExactGrid: "ol_not_attempted_exact_grid",
  notAttemptedIdentityCertified: "ol_not_attempted_identity_certified",
  notAttemptedIncompatible: "ol_not_attempted_incompatible",
  rasterRequired: "ol_raster_proof_required",
  decodeFailed: "ol_raster_decode_failed",
  orientationMismatch: "ol_orientation_mismatch",
  malformedRaster: "ol_malformed_raster",
  constructionFailedClosed: "ol_construction_failed_closed",
  noCollisionRelevantStructure: "ol_no_collision_relevant_structure_localized",
  certifiedPartial: "certified_original_localized_partial",
} as const;

export type OriginalLocalizedEmptyPrior = Readonly<{
  basis: typeof EMPTY_SOURCE_NORMALIZED_IMAGE_SPACE;
  point: EmptySourceNormalizedPoint | null;
  polyline: readonly EmptySourceNormalizedPoint[] | null;
}>;

export type OriginalLocalizedEvidence = Readonly<{
  basis: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
  point: OriginalSourceNormalizedPoint | null;
  line: Readonly<{
    origin: OriginalSourceNormalizedPoint;
    direction: Readonly<{ x: number; y: number }>;
  }> | null;
  polyline: readonly OriginalSourceNormalizedPoint[] | null;
}>;

export type OriginalLocalizationMatcherDiagnostics = Readonly<{
  ncc: number | null;
  sampleCount: number | null;
  matchedSampleCount: number | null;
  matchedFraction: number | null;
  orientationResidual: number | null;
  strongBandDiameter: number | null;
  bimodalOffsetDetected: boolean;
  localFitResidual: number | null;
  searchDisplacement: number | null;
  searchBoundHit: boolean;
}>;

export type OriginalLocalizedStructure = Readonly<{
  id: string;
  sourceObservationStructureId: string;
  structureKind: string;
  localizationClass: OriginalLocalizationClassKind;
  collisionRelevance: OriginalLocalizationCollisionRelevance;
  sourcePlaneIds: readonly string[];
  sourceWallPlaneId: string | null;
  sourceFloorPlaneId: string | null;
  sourceOpeningId: string | null;
  emptyPrior: OriginalLocalizedEmptyPrior;
  status: OriginalLocalizationStatus;
  originalEvidence: OriginalLocalizedEvidence;
  matcherDiagnostics: OriginalLocalizationMatcherDiagnostics;
  span: Readonly<{
    construction: "supported_contiguous_samples" | "none";
    interpolated: false;
    hiddenContinuation: false;
    clusterCount: number;
    sampleCount: number;
    matchedSampleCount: number;
  }> | null;
  limitations: readonly string[];
}>;

export type OriginalStructuralLocalizationLimitations = Readonly<{
  globalImageRegistrationProven: false;
  globalTransformApplied: false;
  partialStructureAuthority: true;
  emptyCoordinatesAuthoritative: false;
  originalCoordinatesAuthoritative: true;
  noInterpolation: true;
  noLocalWarpField: true;
  fittedTransformAuthoritative: false;
  noGlobalTransformApplied: true;
  ridgeTangentNonAuthoritative: true;
  boundedSearchWindow: number;
}>;

export type OriginalStructuralLocalizationLineage = Readonly<{
  attemptId: string | null;
  emptyObservationSchemaVersion: string | null;
  emptyObservationEvidenceId: string | null;
  emptySha256: string | null;
  originalSha256: string | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  originalOrientation: number | null;
  oldCompatibilityTier: EmptyOriginalCompatibilityTier;
  identityRegistrationReceiptSha256: string | null;
  identityRegistrationClass: string | null;
  matcherMethodVersion: typeof AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION;
  frozenCameraReceiptIdentity: string | null;
  floorAuthorityKey: string | null;
}>;

export type AfcV2OriginalStructuralLocalizationAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION;
  authority: "partial_original_structural_localization_authority";
  methodVersion: typeof AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION;
  coordinateSpace: typeof ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE;
  registrationClass: OriginalStructuralLocalizationClass;
  transformKind: "none";
  geometryManufactured: false;
  collisionPromotionEligible: boolean;
  emptyCoordinatesAuthoritative: false;
  originalCoordinatesAuthoritative: true;
  noInterpolation: true;
  noLocalWarpField: true;
  fittedTransformAuthoritative: false;
  noGlobalTransformApplied: true;
  globalImageRegistrationProven: false;
  globalTransformApplied: false;
  partialStructureAuthority: true;
  oldCompatibilityTier: EmptyOriginalCompatibilityTier;
  structures: readonly OriginalLocalizedStructure[];
  summary: Readonly<{
    attempted: number;
    localized: number;
    noMatch: number;
    ambiguous: number;
    rejected: number;
    localizedFloorWalls: number;
    localizedFloorReachingOpenings: number;
  }>;
  limitations: OriginalStructuralLocalizationLimitations;
  lineage: OriginalStructuralLocalizationLineage;
  constructionReasons: readonly string[];
  receiptSha256: string;
}>;

export function freezeOriginalStructuralLocalizationReceipt(
  receipt: AfcV2OriginalStructuralLocalizationAuthorityReceipt,
): AfcV2OriginalStructuralLocalizationAuthorityReceipt {
  return deepFreeze(receipt);
}

export function shouldAttemptOriginalStructuralLocalization(input: {
  oldCompatibilityTier: EmptyOriginalCompatibilityTier | null | undefined;
  identityRegistrationClass: string | null | undefined;
}): boolean {
  if (input.oldCompatibilityTier !== "aspect_compatible_rescaled") return false;
  return input.identityRegistrationClass !== "certified_rescaled_registered" &&
    input.identityRegistrationClass !== "exact_grid_registered";
}

export function originalLocalizationCollisionPromotionEligible(
  registrationClass: OriginalStructuralLocalizationClass,
): boolean {
  return registrationClass === "certified_original_localized";
}

export type ActiveRegistrationPath =
  | "exact_grid"
  | "certified_rescaled_identity"
  | "original_localized"
  | "none";

export function activeRegistrationPath(input: {
  identityRegistrationClass: string | null | undefined;
  originalLocalizationClass: OriginalStructuralLocalizationClass | null | undefined;
}): ActiveRegistrationPath {
  if (input.identityRegistrationClass === "exact_grid_registered") {
    return "exact_grid";
  }
  if (input.identityRegistrationClass === "certified_rescaled_registered") {
    return "certified_rescaled_identity";
  }
  if (input.originalLocalizationClass === "certified_original_localized") {
    return "original_localized";
  }
  return "none";
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
