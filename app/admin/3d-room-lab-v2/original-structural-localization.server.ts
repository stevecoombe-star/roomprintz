import "server-only";

import { createHash } from "node:crypto";

import type { EmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import { FLOOR_REACHING_OPENING_CATEGORIES } from "./room-envelope-authority-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import { REGISTRATION_SEARCH_WINDOW } from "./empty-original-registration-authority-contract";
import { acuteAngle, perpendicular } from "./empty-original-registration-geometry";
import {
  collectArchitectureRegistrationPriors,
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
import type { EmptyOriginalRegistrationIdentity } from "./empty-original-registration.server";
import {
  AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION,
  AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION,
  ORIGINAL_LOCALIZATION_REASON,
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  freezeOriginalStructuralLocalizationReceipt,
  originalLocalizationCollisionPromotionEligible,
  shouldAttemptOriginalStructuralLocalization,
  type AfcV2OriginalStructuralLocalizationAuthorityReceipt,
  type OriginalLocalizationCollisionRelevance,
  type OriginalLocalizedStructure,
  type OriginalStructuralLocalizationClass,
} from "./original-structural-localization-authority-contract";
import {
  aggregateOriginalLocalizedPointAnchor,
  aggregateOriginalLocalizedRidge,
  emptyPriorPoint,
  emptyPriorPolyline,
  originalEvidenceFromSpan,
  type OriginalLocalizationSample,
} from "./original-structural-localization-geometry.server";

const FLOOR_REACHING = new Set<string>(FLOOR_REACHING_OPENING_CATEGORIES);

export type OriginalStructuralLocalizationConstructionInput = Readonly<{
  emptyIdentity: EmptyOriginalRegistrationIdentity | null;
  originalIdentity: EmptyOriginalRegistrationIdentity | null;
  emptyBytes: Uint8Array | null;
  originalBytes: Uint8Array | null;
  observation: EmptyRoomObservationEvidence | null;
  identityRegistration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  attemptId?: string | null;
  frozenCameraReceiptIdentity?: string | null;
  floorAuthorityKey?: string | null;
}>;

export async function constructOriginalStructuralLocalizationAuthority(
  input: OriginalStructuralLocalizationConstructionInput,
): Promise<AfcV2OriginalStructuralLocalizationAuthorityReceipt> {
  try {
    return await constructUnchecked(input);
  } catch {
    return failedReceipt(input, "original_localization_rejected", [
      ORIGINAL_LOCALIZATION_REASON.constructionFailedClosed,
    ]);
  }
}

async function constructUnchecked(
  input: OriginalStructuralLocalizationConstructionInput,
): Promise<AfcV2OriginalStructuralLocalizationAuthorityReceipt> {
  const identity = input.identityRegistration;
  const compatibility = identity?.oldCompatibilityTier ?? "unavailable";
  if (!shouldAttemptOriginalStructuralLocalization({
    oldCompatibilityTier: compatibility,
    identityRegistrationClass: identity?.registrationClass ?? null,
  })) {
    const reason = identity?.registrationClass === "exact_grid_registered" ||
        compatibility === "exact_grid_compatible"
      ? ORIGINAL_LOCALIZATION_REASON.notAttemptedExactGrid
      : identity?.registrationClass === "certified_rescaled_registered"
      ? ORIGINAL_LOCALIZATION_REASON.notAttemptedIdentityCertified
      : ORIGINAL_LOCALIZATION_REASON.notAttemptedIncompatible;
    return failedReceipt(input, "not_attempted", [reason]);
  }
  if (
    !input.emptyIdentity ||
    !input.originalIdentity ||
    input.emptyIdentity.orientation !== 1 ||
    input.originalIdentity.orientation !== 1
  ) {
    return failedReceipt(input, "original_localization_rejected", [
      input.emptyIdentity && input.originalIdentity
        ? ORIGINAL_LOCALIZATION_REASON.orientationMismatch
        : ORIGINAL_LOCALIZATION_REASON.malformedRaster,
    ]);
  }
  if (!input.emptyBytes || !input.originalBytes) {
    return failedReceipt(input, "original_localization_insufficient", [
      ORIGINAL_LOCALIZATION_REASON.rasterRequired,
    ]);
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
    return failedReceipt(input, "original_localization_rejected", [
      ORIGINAL_LOCALIZATION_REASON.decodeFailed,
    ]);
  }
  const resizedEmpty = await resizeEmptyOriginalGreyscale(
    input.emptyBytes,
    emptyGrey,
    originalGrey.width,
    originalGrey.height,
  );
  if (!resizedEmpty) {
    return failedReceipt(input, "original_localization_rejected", [
      ORIGINAL_LOCALIZATION_REASON.decodeFailed,
    ]);
  }

  const emptyStructure = structureRaster(resizedEmpty);
  const originalStructure = structureRaster(originalGrey);
  const priors = collectArchitectureRegistrationPriors(input.observation)
    .filter((prior) => collisionRelevantPrior(prior, input.observation));
  const samples = priors.map((prior) =>
    localizePrior({
      prior,
      emptyStructure,
      originalStructure,
      emptyGrey: resizedEmpty,
      originalGrey,
    })
  );
  const structures = aggregateStructures(samples, input.observation);
  const localized = structures.filter((item) => item.status === "localized");
  const collisionLocalized = localized.filter((item) =>
    item.collisionRelevance === "floor_wall" ||
    item.collisionRelevance === "opening_floor_reaching"
  );
  const registrationClass: OriginalStructuralLocalizationClass =
    collisionLocalized.length > 0
      ? "certified_original_localized"
      : "original_localization_insufficient";
  return finalizeReceipt(input, {
    registrationClass,
    structures,
    reasons: collisionLocalized.length > 0
      ? [ORIGINAL_LOCALIZATION_REASON.certifiedPartial]
      : [ORIGINAL_LOCALIZATION_REASON.noCollisionRelevantStructure],
  });
}

function collisionRelevantPrior(
  prior: ArchitectureRegistrationPrior,
  observation: EmptyRoomObservationEvidence | null,
): boolean {
  if (prior.structureKind === "floor_wall") return true;
  if (prior.structureKind === "wall_wall") return true;
  if (prior.parentStructureId) {
    const opening = observation?.observedOpenings.find(
      (item) => item.id === prior.parentStructureId,
    );
    if (!opening || opening.ambiguity) return false;
    return true;
  }
  return prior.structureKind.startsWith("opening_");
}

function collisionRelevance(
  prior: Pick<ArchitectureRegistrationPrior, "structureKind" | "parentStructureId">,
  observation: EmptyRoomObservationEvidence | null,
): OriginalLocalizationCollisionRelevance {
  if (prior.structureKind === "floor_wall") return "floor_wall";
  if (prior.structureKind === "wall_wall") return "wall_wall_diagnostic";
  const openingId = prior.parentStructureId;
  const opening = openingId
    ? observation?.observedOpenings.find((item) => item.id === openingId)
    : null;
  if (opening) {
    return FLOOR_REACHING.has(opening.category)
      ? "opening_floor_reaching"
      : "opening_non_floor_reaching";
  }
  if (prior.structureKind.startsWith("opening_")) {
    const category = prior.structureKind.slice("opening_".length);
    return FLOOR_REACHING.has(category)
      ? "opening_floor_reaching"
      : "opening_non_floor_reaching";
  }
  return "other";
}

function localizePrior(input: {
  prior: ArchitectureRegistrationPrior;
  emptyStructure: ReturnType<typeof structureRaster>;
  originalStructure: ReturnType<typeof structureRaster>;
  emptyGrey: ReturnType<typeof structureRaster>;
  originalGrey: ReturnType<typeof structureRaster>;
}): OriginalLocalizationSample {
  const prior = input.prior;
  if (prior.evidenceClass === "point_anchor") {
    const located = localizePointAnchorNcc({
      emptyUv: prior.empty,
      emptyStructure: input.emptyStructure,
      originalStructure: input.originalStructure,
      searchWindow: REGISTRATION_SEARCH_WINDOW,
    });
    if (!located.matched) {
      return sampleFromPrior(prior, {
        matched: false,
        failReason: located.reason,
        searchBoundHit: located.searchBoundHit,
      });
    }
    if (located.searchBoundHit) {
      return sampleFromPrior(prior, {
        matched: false,
        failReason: "no_match",
        searchBoundHit: true,
        original: located.originalUv,
        ncc: located.ncc,
        strongBandDiameter: located.strongBandDiameter,
        searchDisplacement: located.searchDisplacement,
      });
    }
    return sampleFromPrior(prior, {
      matched: true,
      failReason: null,
      original: located.originalUv,
      ncc: located.ncc,
      strongBandDiameter: located.strongBandDiameter,
      searchDisplacement: located.searchDisplacement,
      searchBoundHit: false,
    });
  }
  const tangent = prior.tangent;
  if (!tangent) {
    return sampleFromPrior(prior, { matched: false, failReason: "no_match", searchBoundHit: false });
  }
  const located = localizeRidgeNormalNcc({
    emptyUv: prior.empty,
    tangentUv: tangent,
    emptyGrey: input.emptyGrey,
    originalGrey: input.originalGrey,
    searchWindow: REGISTRATION_SEARCH_WINDOW,
  });
  if (!located.matched) {
    return sampleFromPrior(prior, {
      matched: false,
      failReason: located.reason,
      searchBoundHit: located.searchBoundHit,
    });
  }
  if (located.searchBoundHit) {
    return sampleFromPrior(prior, {
      matched: false,
      failReason: "no_match",
      searchBoundHit: true,
      original: located.originalUv,
      ncc: located.ncc,
      signedNormalOffset: located.signedNormalOffsetUv,
      searchDisplacement: located.searchDisplacement,
    });
  }
  const width = input.originalGrey.width;
  const height = input.originalGrey.height;
  const tPix = normalize2(tangent.u * (width - 1), tangent.v * (height - 1));
  const nPix = tPix ? { x: -tPix.y, y: tPix.x } : null;
  const halfWidth = matcherPatchRadius(width, height);
  const originalLine = tPix && nPix
    ? fitLocalOriginalLine(
      input.originalStructure,
      located.originalUv.u * (width - 1),
      located.originalUv.v * (height - 1),
      tPix.x,
      tPix.y,
      nPix.x,
      nPix.y,
      halfWidth,
      width,
      height,
    )
    : null;
  const normal = perpendicular(tangent);
  const orientationResidual = originalLine && prior.emptyLine
    ? acuteAngle(originalLine.theta, prior.emptyLine.theta)
    : originalLine
    ? acuteAngle(
      Math.atan2(perpendicular(originalLine.direction).v, perpendicular(originalLine.direction).u),
      Math.atan2(normal.v, normal.u),
    )
    : null;
  return sampleFromPrior(prior, {
    matched: true,
    failReason: null,
    original: located.originalUv,
    ncc: located.ncc,
    orientationResidual,
    signedNormalOffset: located.signedNormalOffsetUv,
    searchDisplacement: located.searchDisplacement,
    searchBoundHit: false,
  });
}

function sampleFromPrior(
  prior: ArchitectureRegistrationPrior,
  extra: Partial<OriginalLocalizationSample> & {
    matched: boolean;
    failReason: OriginalLocalizationSample["failReason"];
    searchBoundHit: boolean;
  },
): OriginalLocalizationSample {
  return {
    priorId: prior.priorId,
    structureId: prior.structureId,
    parentStructureId: prior.parentStructureId,
    structureKind: prior.structureKind,
    evidenceClass: prior.evidenceClass,
    empty: prior.empty,
    tangent: prior.tangent,
    original: extra.original ?? null,
    ncc: extra.ncc ?? null,
    orientationResidual: extra.orientationResidual ?? null,
    strongBandDiameter: extra.strongBandDiameter ?? null,
    searchDisplacement: extra.searchDisplacement ?? null,
    searchBoundHit: extra.searchBoundHit,
    signedNormalOffset: extra.signedNormalOffset ?? null,
    matched: extra.matched,
    failReason: extra.failReason,
  };
}

function aggregateStructures(
  samples: readonly OriginalLocalizationSample[],
  observation: EmptyRoomObservationEvidence | null,
): OriginalLocalizedStructure[] {
  const groups = new Map<string, OriginalLocalizationSample[]>();
  for (const sample of samples) {
    const key = `${sample.evidenceClass}:${sample.structureId}`;
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }
  const structures: OriginalLocalizedStructure[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const relevance = collisionRelevance(first, observation);
    const openingId = first.parentStructureId && first.structureKind.startsWith("opening_")
      ? first.parentStructureId
      : null;
    const seam = observation?.observedSeams.find((item) => item.id === first.structureId);
    const opening = openingId
      ? observation?.observedOpenings.find((item) => item.id === openingId)
      : null;
    const planeIds = seam?.planeIds ?? [];
    const floorPlaneId = seam
      ? observation?.observedPlanes.find((plane) =>
        plane.id === seam.planeIds[0] || plane.id === seam.planeIds[1]
      )?.category === "floor"
        ? seam.planeIds.find((id) =>
          observation?.observedPlanes.find((plane) => plane.id === id)?.category === "floor"
        ) ?? null
        : seam.planeIds.find((id) =>
          observation?.observedPlanes.find((plane) => plane.id === id)?.category === "floor"
        ) ?? null
      : null;
    const wallPlaneId = seam
      ? seam.planeIds.find((id) =>
        observation?.observedPlanes.find((plane) => plane.id === id)?.category === "wall"
      ) ?? null
      : opening?.hostPlaneId ?? null;

    if (first.evidenceClass === "point_anchor") {
      const aggregated = aggregateOriginalLocalizedPointAnchor(group);
      structures.push(Object.freeze({
        id: `ol_${first.structureId}`,
        sourceObservationStructureId: first.structureId,
        structureKind: first.structureKind,
        localizationClass: "point_anchor",
        collisionRelevance: relevance,
        sourcePlaneIds: Object.freeze([...planeIds]),
        sourceWallPlaneId: wallPlaneId,
        sourceFloorPlaneId: floorPlaneId,
        sourceOpeningId: openingId,
        emptyPrior: emptyPriorPoint({ x: first.empty.u, y: first.empty.v }),
        status: aggregated.status,
        originalEvidence: originalEvidenceFromSpan(null, aggregated.original),
        matcherDiagnostics: Object.freeze({
          ncc: aggregated.ncc,
          sampleCount: group.length,
          matchedSampleCount: aggregated.status === "localized" ? 1 : 0,
          matchedFraction: aggregated.status === "localized" ? 1 : 0,
          orientationResidual: null,
          strongBandDiameter: aggregated.strongBandDiameter,
          bimodalOffsetDetected: false,
          localFitResidual: null,
          searchDisplacement: aggregated.searchDisplacement,
          searchBoundHit: aggregated.searchBoundHit,
        }),
        span: null,
        limitations: Object.freeze([...aggregated.limitations]),
      }));
      continue;
    }

    const emptyPolyline = seam?.sourceNormalizedPolyline ??
      opening?.sourceNormalizedBoundary ??
      group.map((sample) => ({ x: sample.empty.u, y: sample.empty.v }));
    const aggregated = aggregateOriginalLocalizedRidge(group, emptyPolyline);
    structures.push(Object.freeze({
      id: `ol_${first.structureId}`,
      sourceObservationStructureId: first.structureId,
      structureKind: first.structureKind,
      localizationClass: "ridge_normal",
      collisionRelevance: relevance,
      sourcePlaneIds: Object.freeze([...planeIds]),
      sourceWallPlaneId: wallPlaneId,
      sourceFloorPlaneId: floorPlaneId,
      sourceOpeningId: openingId,
      emptyPrior: emptyPriorPolyline(emptyPolyline),
      status: aggregated.status,
      originalEvidence: originalEvidenceFromSpan(
        aggregated.span,
        null,
      ),
      matcherDiagnostics: Object.freeze({
        ncc: aggregated.ncc,
        sampleCount: aggregated.sampleCount,
        matchedSampleCount: aggregated.matchedSampleCount,
        matchedFraction: aggregated.matchedFraction,
        orientationResidual: aggregated.orientationResidual,
        strongBandDiameter: null,
        bimodalOffsetDetected: aggregated.bimodalOffsetDetected,
        localFitResidual: aggregated.localFitResidual,
        searchDisplacement: aggregated.searchDisplacement,
        searchBoundHit: aggregated.searchBoundHit,
      }),
      span: aggregated.span
        ? Object.freeze({
          construction: aggregated.span.construction,
          interpolated: false as const,
          hiddenContinuation: false as const,
          clusterCount: aggregated.span.clusterCount,
          sampleCount: aggregated.span.sampleCount,
          matchedSampleCount: aggregated.span.matchedSampleCount,
        })
        : null,
      limitations: Object.freeze([...aggregated.limitations]),
    }));
  }
  return structures;
}

function failedReceipt(
  input: OriginalStructuralLocalizationConstructionInput,
  registrationClass: OriginalStructuralLocalizationClass,
  reasons: readonly string[],
): AfcV2OriginalStructuralLocalizationAuthorityReceipt {
  return finalizeReceipt(input, {
    registrationClass,
    structures: [],
    reasons,
  });
}

function finalizeReceipt(
  input: OriginalStructuralLocalizationConstructionInput,
  options: {
    registrationClass: OriginalStructuralLocalizationClass;
    structures: readonly OriginalLocalizedStructure[];
    reasons: readonly string[];
  },
): AfcV2OriginalStructuralLocalizationAuthorityReceipt {
  const identity = input.identityRegistration;
  const structures = Object.freeze(options.structures);
  const summary = Object.freeze({
    attempted: structures.length,
    localized: structures.filter((item) => item.status === "localized").length,
    noMatch: structures.filter((item) => item.status === "no_match").length,
    ambiguous: structures.filter((item) => item.status === "ambiguous").length,
    rejected: structures.filter((item) => item.status === "rejected").length,
    localizedFloorWalls: structures.filter((item) =>
      item.status === "localized" && item.collisionRelevance === "floor_wall"
    ).length,
    localizedFloorReachingOpenings: structures.filter((item) =>
      item.status === "localized" && item.collisionRelevance === "opening_floor_reaching"
    ).length,
  });
  const unsigned = {
    schemaVersion: AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION,
    authority: "partial_original_structural_localization_authority" as const,
    methodVersion: AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION,
    coordinateSpace: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
    registrationClass: options.registrationClass,
    transformKind: "none" as const,
    geometryManufactured: false as const,
    collisionPromotionEligible: originalLocalizationCollisionPromotionEligible(
      options.registrationClass,
    ),
    emptyCoordinatesAuthoritative: false as const,
    originalCoordinatesAuthoritative: true as const,
    noInterpolation: true as const,
    noLocalWarpField: true as const,
    fittedTransformAuthoritative: false as const,
    noGlobalTransformApplied: true as const,
    globalImageRegistrationProven: false as const,
    globalTransformApplied: false as const,
    partialStructureAuthority: true as const,
    oldCompatibilityTier: identity?.oldCompatibilityTier ?? "unavailable",
    structures,
    summary,
    limitations: Object.freeze({
      globalImageRegistrationProven: false as const,
      globalTransformApplied: false as const,
      partialStructureAuthority: true as const,
      emptyCoordinatesAuthoritative: false as const,
      originalCoordinatesAuthoritative: true as const,
      noInterpolation: true as const,
      noLocalWarpField: true as const,
      fittedTransformAuthoritative: false as const,
      noGlobalTransformApplied: true as const,
      ridgeTangentNonAuthoritative: true as const,
      boundedSearchWindow: REGISTRATION_SEARCH_WINDOW,
    }),
    lineage: Object.freeze({
      attemptId: input.attemptId ?? identity?.lineage.observationEvidenceId ?? null,
      emptyObservationSchemaVersion: input.observation?.schemaVersion ?? null,
      emptyObservationEvidenceId: input.observation?.basis.attemptId ?? null,
      emptySha256: input.emptyIdentity?.sha256 ?? null,
      originalSha256: input.originalIdentity?.sha256 ?? null,
      originalDecodedWidth: input.originalIdentity?.decodedWidth ?? null,
      originalDecodedHeight: input.originalIdentity?.decodedHeight ?? null,
      originalOrientation: input.originalIdentity?.orientation ?? null,
      oldCompatibilityTier: identity?.oldCompatibilityTier ?? "unavailable",
      identityRegistrationReceiptSha256: identity?.receiptSha256 ?? null,
      identityRegistrationClass: identity?.registrationClass ?? null,
      matcherMethodVersion: AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION,
      frozenCameraReceiptIdentity: input.frozenCameraReceiptIdentity ?? null,
      floorAuthorityKey: input.floorAuthorityKey ?? null,
    }),
    constructionReasons: Object.freeze([...options.reasons]),
  };
  const receiptSha256 = createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
  return freezeOriginalStructuralLocalizationReceipt({
    ...unsigned,
    receiptSha256,
  });
}
