import "server-only";

import { createHash } from "node:crypto";

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import type { EmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_SOURCE_SPACE,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_TARGET_SPACE,
  EMPTY_ORIGINAL_REGISTRATION_REASON,
  REGISTRATION_DISPLAY_IDENTITY_LOCK_PX,
  REGISTRATION_MAX_IDENTITY_RESIDUAL,
  REGISTRATION_SEARCH_WINDOW,
  freezeEmptyOriginalRegistrationReceipt,
  registrationCollisionPromotionEligible,
  type AfcV2EmptyOriginalRegistrationAuthorityReceipt,
  type EmptyOriginalCompatibilityTier,
  type EmptyOriginalRegistrationClass,
  type EmptyOriginalRegistrationCorrespondence,
  type EmptyOriginalRegistrationRawSample,
  type EmptyOriginalRegistrationTransformKind,
} from "./empty-original-registration-authority-contract";
import {
  acuteAngle,
  aggregateHybridEvidenceUnits,
  evaluateHybridRegistrationGates,
  identityResidual,
  perpendicular,
  spreadSamplesForUnits,
  type HybridGateEvaluation,
  type HybridSampleMatch,
} from "./empty-original-registration-geometry";
import {
  collectArchitectureRegistrationPriors,
  priorsHaveRequiredStructureDiversity,
  type ArchitectureRegistrationPrior,
} from "./empty-original-registration-priors";
import {
  fitLocalOriginalLine,
  localizePointAnchorNcc,
  localizeRidgeNormalNcc,
  matcherPatchRadius,
  normalize2,
  structureRaster,
} from "./empty-original-ncc-localizer";
import {
  decodeEmptyOriginalGreyscale,
  resizeEmptyOriginalGreyscale,
} from "./empty-original-raster.server";

export const AFC_V2_EMPTY_ORIGINAL_REGISTRATION_NCC_MATCHER_VERSION =
  "afc-v2-empty-original-registration-ncc-matcher/v2" as const;

export type EmptyOriginalRegistrationIdentity = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
}>;

export type EmptyOriginalRegistrationConstructionInput = Readonly<{
  emptyIdentity: EmptyOriginalRegistrationIdentity | null;
  originalIdentity: EmptyOriginalRegistrationIdentity | null;
  emptyBytes: Uint8Array | null;
  originalBytes: Uint8Array | null;
  observation: EmptyRoomObservationEvidence | null;
}>;

export async function constructEmptyOriginalRegistrationAuthority(
  input: EmptyOriginalRegistrationConstructionInput,
): Promise<AfcV2EmptyOriginalRegistrationAuthorityReceipt> {
  try {
    return await constructUnchecked(input);
  } catch {
    return failedReceipt(input, "unavailable", [
      EMPTY_ORIGINAL_REGISTRATION_REASON.constructionFailedClosed,
    ]);
  }
}

async function constructUnchecked(
  input: EmptyOriginalRegistrationConstructionInput,
): Promise<AfcV2EmptyOriginalRegistrationAuthorityReceipt> {
  const compatibility = classifyCompatibility(input);
  if (
    !input.emptyIdentity ||
    !input.originalIdentity ||
    input.emptyIdentity.orientation !== 1 ||
    input.originalIdentity.orientation !== 1
  ) {
    return failedReceipt(input, compatibility, [
      input.emptyIdentity && input.originalIdentity
        ? EMPTY_ORIGINAL_REGISTRATION_REASON.orientationMismatch
        : EMPTY_ORIGINAL_REGISTRATION_REASON.malformedRaster,
    ], "rejected");
  }
  if (compatibility === "incompatible") {
    return failedReceipt(input, compatibility, [
      EMPTY_ORIGINAL_REGISTRATION_REASON.incompatiblePair,
    ], "rejected");
  }
  if (compatibility === "exact_grid_compatible") {
    return acceptedReceipt(input, {
      registrationClass: "exact_grid_registered",
      rasterProofAttempted: false,
      reasons: [EMPTY_ORIGINAL_REGISTRATION_REASON.exactGridRegistered],
    });
  }
  if (compatibility !== "aspect_compatible_rescaled") {
    return failedReceipt(input, compatibility, [
      EMPTY_ORIGINAL_REGISTRATION_REASON.incompatiblePair,
    ], "rejected");
  }
  if (!input.emptyBytes || !input.originalBytes) {
    return failedReceipt(input, compatibility, [
      EMPTY_ORIGINAL_REGISTRATION_REASON.rasterProofRequired,
    ], "insufficient");
  }

  const originalGrey = await decodeEmptyOriginalGreyscale(
    input.originalBytes,
    input.originalIdentity,
  );
  const emptyGrey = await decodeEmptyOriginalGreyscale(
    input.emptyBytes,
    input.emptyIdentity,
  );
  if (!originalGrey || !emptyGrey) {
    return failedReceipt(input, compatibility, [
      EMPTY_ORIGINAL_REGISTRATION_REASON.decodeFailed,
    ], "rejected");
  }
  const resizedEmpty = await resizeEmptyOriginalGreyscale(
    input.emptyBytes,
    emptyGrey,
    originalGrey.width,
    originalGrey.height,
  );
  if (!resizedEmpty) {
    return failedReceipt(input, compatibility, [
      EMPTY_ORIGINAL_REGISTRATION_REASON.decodeFailed,
    ], "rejected");
  }

  const priors = collectArchitectureRegistrationPriors(input.observation);
  if (!priorsHaveRequiredStructureDiversity(priors)) {
    return failedReceipt(input, compatibility, [
      EMPTY_ORIGINAL_REGISTRATION_REASON.insufficientPriors,
    ], "insufficient", {
      rasterProofAttempted: true,
    });
  }

  const emptyStructure = structureRaster(resizedEmpty);
  const originalStructure = structureRaster(originalGrey);
  const samples: HybridSampleMatch[] = priors.map((prior) =>
    prior.evidenceClass === "point_anchor"
      ? matchPointAnchor({
        prior,
        empty: emptyStructure,
        original: originalStructure,
      })
      : matchRidgeSample({
        prior,
        emptyGrey: resizedEmpty,
        originalGrey,
        originalStructure,
      })
  );
  const units = aggregateHybridEvidenceUnits(samples);
  const evaluation = evaluateHybridRegistrationGates(
    units,
    spreadSamplesForUnits(units, samples),
  );
  return receiptFromEvaluation(input, compatibility, units, samples, evaluation);
}

function classifyCompatibility(
  input: EmptyOriginalRegistrationConstructionInput,
): EmptyOriginalCompatibilityTier {
  if (!input.emptyIdentity || !input.originalIdentity) return "unavailable";
  const classified = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: input.originalIdentity.sha256,
      decodedWidth: input.originalIdentity.decodedWidth,
      decodedHeight: input.originalIdentity.decodedHeight,
      orientation: input.originalIdentity.orientation,
    },
    {
      fingerprint: input.emptyIdentity.sha256,
      decodedWidth: input.emptyIdentity.decodedWidth,
      decodedHeight: input.emptyIdentity.decodedHeight,
      orientation: input.emptyIdentity.orientation,
    },
  );
  return classified.tier;
}

function matchPointAnchor(input: {
  prior: ArchitectureRegistrationPrior;
  empty: ReturnType<typeof structureRaster>;
  original: ReturnType<typeof structureRaster>;
}): HybridSampleMatch {
  const located = localizePointAnchorNcc({
    emptyUv: input.prior.empty,
    emptyStructure: input.empty,
    originalStructure: input.original,
    searchWindow: REGISTRATION_SEARCH_WINDOW,
  });
  if (!located.matched) return unmatchedSample(input.prior);
  const residual = identityResidual(input.prior.empty, located.originalUv);
  const strongRadius = located.strongBandDiameter / 2;
  if (
    residual.r > REGISTRATION_MAX_IDENTITY_RESIDUAL &&
    residual.r <= strongRadius + REGISTRATION_MAX_IDENTITY_RESIDUAL
  ) {
    return unmatchedSample(input.prior);
  }
  return Object.freeze({
    priorId: input.prior.priorId,
    structureId: input.prior.structureId,
    parentStructureId: input.prior.parentStructureId,
    structureKind: input.prior.structureKind,
    evidenceClass: "point_anchor" as const,
    empty: Object.freeze({ ...input.prior.empty }),
    tangent: null,
    emptyLine: input.prior.emptyLine,
    original: Object.freeze(located.originalUv),
    originalLine: null,
    ncc: located.ncc,
    pointResidual: residual,
    normalResidual: null,
    orientationResidual: null,
    tangentDiagnostic: null,
    tangentLocalization: "localized" as const,
    displaySnapped: located.pixelDelta <= REGISTRATION_DISPLAY_IDENTITY_LOCK_PX,
    matched: true,
  });
}

/**
 * Search ORIGINAL only along the EMPTY ridge normal. Tangent is not a
 * degree of freedom of this localizer.
 */
function matchRidgeSample(input: {
  prior: ArchitectureRegistrationPrior;
  emptyGrey: ReturnType<typeof structureRaster>;
  originalGrey: ReturnType<typeof structureRaster>;
  originalStructure: ReturnType<typeof structureRaster>;
}): HybridSampleMatch {
  const tangent = input.prior.tangent;
  if (!tangent) return unmatchedSample(input.prior);
  const located = localizeRidgeNormalNcc({
    emptyUv: input.prior.empty,
    tangentUv: tangent,
    emptyGrey: input.emptyGrey,
    originalGrey: input.originalGrey,
    searchWindow: REGISTRATION_SEARCH_WINDOW,
  });
  if (!located.matched) return unmatchedSample(input.prior);
  const width = input.originalGrey.width;
  const height = input.originalGrey.height;
  const tPix = normalize2(
    tangent.u * (width - 1),
    tangent.v * (height - 1),
  );
  if (!tPix) return unmatchedSample(input.prior);
  const nPix = { x: -tPix.y, y: tPix.x };
  const halfWidth = matcherPatchRadius(width, height);
  const matchX = located.originalUv.u * (width - 1);
  const matchY = located.originalUv.v * (height - 1);
  const originalLine = fitLocalOriginalLine(
    input.originalStructure,
    matchX,
    matchY,
    tPix.x,
    tPix.y,
    nPix.x,
    nPix.y,
    halfWidth,
    width,
    height,
  );
  const normal = perpendicular(tangent);
  const orientationResidual = originalLine && input.prior.emptyLine
    ? acuteAngle(originalLine.theta, input.prior.emptyLine.theta)
    : originalLine
    ? acuteAngle(
      Math.atan2(perpendicular(originalLine.direction).v, perpendicular(originalLine.direction).u),
      Math.atan2(normal.v, normal.u),
    )
    : null;
  return Object.freeze({
    priorId: input.prior.priorId,
    structureId: input.prior.structureId,
    parentStructureId: input.prior.parentStructureId,
    structureKind: input.prior.structureKind,
    evidenceClass: "ridge_normal" as const,
    empty: Object.freeze({ ...input.prior.empty }),
    tangent: Object.freeze({ ...tangent }),
    emptyLine: input.prior.emptyLine,
    original: Object.freeze(located.originalUv),
    originalLine,
    ncc: located.ncc,
    pointResidual: null,
    normalResidual: located.signedNormalOffsetUv,
    orientationResidual,
    tangentDiagnostic: null,
    tangentLocalization: "ambiguous" as const,
    displaySnapped: false,
    matched: true,
  });
}

function unmatchedSample(prior: ArchitectureRegistrationPrior): HybridSampleMatch {
  return Object.freeze({
    priorId: prior.priorId,
    structureId: prior.structureId,
    parentStructureId: prior.parentStructureId,
    structureKind: prior.structureKind,
    evidenceClass: prior.evidenceClass,
    empty: Object.freeze({ ...prior.empty }),
    tangent: prior.tangent,
    emptyLine: prior.emptyLine,
    original: null,
    originalLine: null,
    ncc: null,
    pointResidual: null,
    normalResidual: null,
    orientationResidual: null,
    tangentDiagnostic: null,
    tangentLocalization: prior.evidenceClass === "ridge_normal"
      ? "ambiguous" as const
      : "not_applicable" as const,
    displaySnapped: false,
    matched: false,
  });
}

function acceptedReceipt(
  input: EmptyOriginalRegistrationConstructionInput,
  options: {
    registrationClass: Extract<
      EmptyOriginalRegistrationClass,
      "exact_grid_registered" | "certified_rescaled_registered"
    >;
    rasterProofAttempted: boolean;
    reasons: readonly string[];
    correspondences?: readonly EmptyOriginalRegistrationCorrespondence[];
    samples?: readonly HybridSampleMatch[];
    evaluation?: HybridGateEvaluation;
  },
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  const transformKind: EmptyOriginalRegistrationTransformKind = "identity_normalized";
  return finalizeReceipt(input, {
    registrationClass: options.registrationClass,
    transformKind,
    transform: { kind: transformKind, su: 1, sv: 1, tu: 0, tv: 0 },
    collisionPromotionEligible: true,
    rasterProofAttempted: options.rasterProofAttempted,
    correspondences: options.correspondences ?? [],
    samples: options.samples ?? [],
    evaluation: options.evaluation,
    reasons: options.reasons,
    oldCompatibilityTier: classifyCompatibility(input),
  });
}

function receiptFromEvaluation(
  input: EmptyOriginalRegistrationConstructionInput,
  compatibility: EmptyOriginalCompatibilityTier,
  correspondences: readonly EmptyOriginalRegistrationCorrespondence[],
  samples: readonly HybridSampleMatch[],
  evaluation: HybridGateEvaluation,
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  if (evaluation.accepted) {
    return acceptedReceipt(input, {
      registrationClass: "certified_rescaled_registered",
      rasterProofAttempted: true,
      reasons: [EMPTY_ORIGINAL_REGISTRATION_REASON.certifiedRescaledRegistered],
      correspondences,
      samples,
      evaluation,
    });
  }
  const rejected = evaluation.contradictionCount > 0 ||
    evaluation.reasons.includes(
      EMPTY_ORIGINAL_REGISTRATION_REASON.diagnosticSimilarityDivergent,
    ) ||
    evaluation.reasons.includes(EMPTY_ORIGINAL_REGISTRATION_REASON.ridgeScaleNonIdentity) ||
    evaluation.reasons.includes(EMPTY_ORIGINAL_REGISTRATION_REASON.ridgeNormalContradiction) ||
    evaluation.reasons.includes(EMPTY_ORIGINAL_REGISTRATION_REASON.pointAnchorContradiction);
  return finalizeReceipt(input, {
    registrationClass: rejected ? "rejected" : "insufficient",
    transformKind: "none",
    transform: null,
    collisionPromotionEligible: false,
    rasterProofAttempted: true,
    correspondences,
    samples,
    evaluation,
    reasons: evaluation.reasons,
    oldCompatibilityTier: compatibility,
  });
}

function finalizeReceipt(
  input: EmptyOriginalRegistrationConstructionInput,
  options: {
    registrationClass: EmptyOriginalRegistrationClass;
    transformKind: EmptyOriginalRegistrationTransformKind;
    transform: AfcV2EmptyOriginalRegistrationAuthorityReceipt["transform"];
    collisionPromotionEligible: boolean;
    rasterProofAttempted: boolean;
    correspondences: readonly EmptyOriginalRegistrationCorrespondence[];
    samples: readonly HybridSampleMatch[];
    evaluation?: HybridGateEvaluation;
    reasons: readonly string[];
    oldCompatibilityTier: EmptyOriginalCompatibilityTier;
  },
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  const evaluation = options.evaluation;
  const observation = input.observation;
  const rawPointDiagnostics = Object.freeze(options.samples.map(toRawSample));
  const unsigned = {
    schemaVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
    sourceSpace: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_SOURCE_SPACE,
    targetSpace: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_TARGET_SPACE,
    authority: "empty_original_registration_authority" as const,
    methodVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
    registrationClass: options.registrationClass,
    transformKind: options.transformKind,
    transform: options.transform,
    oldCompatibilityTier: options.oldCompatibilityTier,
    collisionPromotionEligible: options.collisionPromotionEligible &&
      registrationCollisionPromotionEligible(options.registrationClass),
    geometryManufactured: false as const,
    residuals: Object.freeze({
      max: evaluation?.residuals.max ?? null,
      rms: evaluation?.residuals.rms ?? null,
      maxAbsU: evaluation?.residuals.maxAbsU ?? null,
      maxAbsV: evaluation?.residuals.maxAbsV ?? null,
      anchorMax: evaluation?.residuals.anchorMax ?? null,
      anchorRms: evaluation?.residuals.anchorRms ?? null,
      ridgeNormalMax: evaluation?.residuals.ridgeNormalMax ?? null,
      ridgeNormalRms: evaluation?.residuals.ridgeNormalRms ?? null,
      diagnosticSimilarity: evaluation?.residuals.diagnosticSimilarity ?? null,
      diagnosticRidgeScale: evaluation?.residuals.diagnosticRidgeScale ?? null,
      diagnosticRidgeScaleAbsFromIdentity:
        evaluation?.residuals.diagnosticRidgeScaleAbsFromIdentity ?? null,
    }),
    correspondenceCount: rawPointDiagnostics.filter((item) => item.status === "matched").length,
    attemptedCorrespondenceCount: rawPointDiagnostics.length,
    inlierFraction: evaluation ? evaluation.inlierFraction : null,
    correspondenceSpread: evaluation
      ? Object.freeze({
        quadrantCount: evaluation.spread.quadrantCount,
        hullArea: evaluation.spread.hullArea,
        secondPcaRatio: evaluation.spread.secondPcaRatio,
        distinctStructureCount: evaluation.attemptedEvidenceUnitCount,
      })
      : null,
    outlierCount: evaluation?.outlierCount ?? 0,
    correspondences: Object.freeze([...options.correspondences]),
    rawPointDiagnostics,
    anchorCount: evaluation?.anchorCount ?? 0,
    anchorInlierCount: evaluation?.anchorInlierCount ?? 0,
    ridgeStructureCount: evaluation?.ridgeStructureCount ?? 0,
    ridgeInlierCount: evaluation?.ridgeInlierCount ?? 0,
    independentEvidenceUnitCount: evaluation?.independentEvidenceUnitCount ?? 0,
    attemptedEvidenceUnitCount: evaluation?.attemptedEvidenceUnitCount ?? 0,
    orientationBinCount: evaluation?.orientationBinCount ?? null,
    zoomLockSatisfied: evaluation ? evaluation.zoomLock.satisfied : null,
    zoomLockConfiguration: evaluation?.zoomLock.configuration ?? "not_applicable",
    contradictionCount: evaluation?.contradictionCount ?? 0,
    limitations: Object.freeze({
      globalOnly: true as const,
      localAuthority: false as const,
      fittedTransformNotAuthoritative: true as const,
      rasterProofRequiredForRescaled: true as const,
      ridgeTangentNonAuthoritative: true as const,
      diagnosticSimilarityClassAOnly: true as const,
    }),
    lineage: Object.freeze({
      methodVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
      emptyIdentity: Object.freeze({
        sha256: input.emptyIdentity?.sha256 ?? null,
        decodedWidth: input.emptyIdentity?.decodedWidth ?? null,
        decodedHeight: input.emptyIdentity?.decodedHeight ?? null,
        orientation: input.emptyIdentity?.orientation ?? null,
      }),
      originalIdentity: Object.freeze({
        sha256: input.originalIdentity?.sha256 ?? null,
        decodedWidth: input.originalIdentity?.decodedWidth ?? null,
        decodedHeight: input.originalIdentity?.decodedHeight ?? null,
        orientation: input.originalIdentity?.orientation ?? null,
      }),
      emptySha256: input.emptyIdentity?.sha256 ?? null,
      originalSha256: input.originalIdentity?.sha256 ?? null,
      observationSchemaVersion: observation?.schemaVersion ?? null,
      observationEvidenceId: observation?.basis.attemptId ?? null,
      rasterProofAttempted: options.rasterProofAttempted,
    }),
    constructionReasons: Object.freeze([...options.reasons]),
  };
  const receiptSha256 = createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
  return freezeEmptyOriginalRegistrationReceipt({
    ...unsigned,
    receiptSha256,
  });
}

function failedReceipt(
  input: EmptyOriginalRegistrationConstructionInput,
  compatibility: EmptyOriginalCompatibilityTier,
  reasons: readonly string[],
  registrationClass: Extract<
    EmptyOriginalRegistrationClass,
    "insufficient" | "rejected"
  > = "insufficient",
  extra?: { rasterProofAttempted?: boolean },
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  return finalizeReceipt(input, {
    registrationClass,
    transformKind: "none",
    transform: null,
    collisionPromotionEligible: false,
    rasterProofAttempted: extra?.rasterProofAttempted ?? false,
    correspondences: [],
    samples: [],
    reasons,
    oldCompatibilityTier: compatibility,
  });
}

function toRawSample(sample: HybridSampleMatch): EmptyOriginalRegistrationRawSample {
  return Object.freeze({
    priorId: sample.priorId,
    structureId: sample.structureId,
    structureKind: sample.structureKind,
    evidenceClass: sample.evidenceClass,
    empty: sample.empty,
    original: sample.original,
    residual: sample.evidenceClass === "point_anchor"
      ? sample.pointResidual?.r ?? null
      : sample.normalResidual === null
      ? null
      : Math.abs(sample.normalResidual),
    ncc: sample.ncc,
    status: sample.matched ? "matched" as const : "no_match" as const,
  });
}
