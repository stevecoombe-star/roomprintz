import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
  REGISTRATION_MAX_IDENTITY_RESIDUAL,
  REGISTRATION_SEARCH_WINDOW,
  type AfcV2EmptyOriginalRegistrationAuthorityReceipt,
} from "./empty-original-registration-authority-contract";
import {
  aggregateHybridEvidenceUnits,
  identityResidual,
  type HybridSampleMatch,
} from "./empty-original-registration-geometry";
import {
  ANCHOR_STRONG_BAND_MAX_DIAMETER,
  localizePointAnchorNcc,
  localizeRidgeNormalNcc,
  ridgeComponentsSeparated,
  strongBandDiameter,
  structureRaster,
  type GreyscaleRaster,
} from "./empty-original-ncc-localizer";
import {
  constructOriginalLocalizedFiniteSpan,
  aggregateOriginalLocalizedPointAnchor,
  aggregateOriginalLocalizedRidge,
  type OriginalLocalizationSample,
} from "./original-structural-localization-geometry.server";
import {
  AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION,
  AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION,
  shouldAttemptOriginalStructuralLocalization,
} from "./original-structural-localization-authority-contract";
import { constructOriginalStructuralLocalizationAuthority } from "./original-structural-localization.server";

const V2 = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function identityReceipt(
  registrationClass: AfcV2EmptyOriginalRegistrationAuthorityReceipt["registrationClass"],
  oldCompatibilityTier: AfcV2EmptyOriginalRegistrationAuthorityReceipt["oldCompatibilityTier"],
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  const eligible = registrationClass === "exact_grid_registered" ||
    registrationClass === "certified_rescaled_registered";
  return {
    schemaVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
    sourceSpace: "empty-source-normalized-image/v1",
    targetSpace: "original-source-normalized-image/v1",
    authority: "empty_original_registration_authority",
    methodVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
    registrationClass,
    transformKind: eligible ? "identity_normalized" : "none",
    transform: eligible
      ? { kind: "identity_normalized", su: 1, sv: 1, tu: 0, tv: 0 }
      : null,
    oldCompatibilityTier,
    collisionPromotionEligible: eligible,
    geometryManufactured: false,
    residuals: {
      max: null, rms: null, maxAbsU: null, maxAbsV: null,
      anchorMax: null, anchorRms: null, ridgeNormalMax: null, ridgeNormalRms: null,
      diagnosticSimilarity: null, diagnosticRidgeScale: null,
      diagnosticRidgeScaleAbsFromIdentity: null,
    },
    correspondenceCount: 0,
    attemptedCorrespondenceCount: 0,
    inlierFraction: null,
    correspondenceSpread: null,
    outlierCount: 0,
    correspondences: [],
    rawPointDiagnostics: [],
    anchorCount: 0,
    anchorInlierCount: 0,
    ridgeStructureCount: 0,
    ridgeInlierCount: 0,
    independentEvidenceUnitCount: 0,
    attemptedEvidenceUnitCount: 0,
    orientationBinCount: null,
    zoomLockSatisfied: null,
    zoomLockConfiguration: "not_applicable",
    contradictionCount: 0,
    limitations: {
      globalOnly: true,
      localAuthority: false,
      fittedTransformNotAuthoritative: true,
      rasterProofRequiredForRescaled: true,
      ridgeTangentNonAuthoritative: true,
      diagnosticSimilarityClassAOnly: true,
    },
    lineage: {
      methodVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
      emptyIdentity: {
        sha256: "e".repeat(64),
        decodedWidth: 64,
        decodedHeight: 64,
        orientation: 1,
      },
      originalIdentity: {
        sha256: "o".repeat(64),
        decodedWidth: 96,
        decodedHeight: 64,
        orientation: 1,
      },
      emptySha256: "e".repeat(64),
      originalSha256: "o".repeat(64),
      observationSchemaVersion: null,
      observationEvidenceId: "ol",
      rasterProofAttempted: false,
    },
    constructionReasons: [],
    receiptSha256: "r".repeat(64),
  };
}

function makeRaster(width: number, height: number, fill = 0.2): GreyscaleRaster {
  return { width, height, pixels: Float64Array.from({ length: width * height }, () => fill) };
}

function stampBox(
  raster: GreyscaleRaster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x >= 0 && y >= 0 && x < raster.width && y < raster.height) {
        raster.pixels[y * raster.width + x] = value;
      }
    }
  }
}

function verticalRidge(raster: GreyscaleRaster, u: number, value = 1) {
  const x = Math.round(u * (raster.width - 1));
  stampBox(raster, x - 1, 4, x + 1, raster.height - 5, value);
}

function ridgeSample(
  structureId: string,
  empty: { u: number; v: number },
  options: {
    matched?: boolean;
    original?: { u: number; v: number } | null;
    signedNormalOffset?: number;
    orientationResidual?: number;
    searchBoundHit?: boolean;
    failReason?: OriginalLocalizationSample["failReason"];
  } = {},
): OriginalLocalizationSample {
  const matched = options.matched ?? true;
  return {
    priorId: `${structureId}:${empty.v}`,
    structureId,
    parentStructureId: null,
    structureKind: "floor_wall",
    evidenceClass: "ridge_normal",
    empty,
    tangent: { u: 1, v: 0 },
    original: options.original ?? (matched
      ? { u: empty.u + (options.signedNormalOffset ?? 0), v: empty.v }
      : null),
    ncc: matched ? 0.9 : null,
    orientationResidual: matched ? options.orientationResidual ?? 0.02 : null,
    strongBandDiameter: null,
    searchDisplacement: options.signedNormalOffset ?? null,
    searchBoundHit: options.searchBoundHit ?? false,
    signedNormalOffset: matched ? options.signedNormalOffset ?? 0 : null,
    matched,
    failReason: options.failReason ?? null,
  };
}

test("exact-grid identity does not attempt OL as authority", async () => {
  const receipt = await constructOriginalStructuralLocalizationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 64,
      decodedHeight: 64,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "o".repeat(64),
      decodedWidth: 64,
      decodedHeight: 64,
      orientation: 1,
    },
    emptyBytes: Uint8Array.from([1]),
    originalBytes: Uint8Array.from([1]),
    observation: null,
    identityRegistration: identityReceipt("exact_grid_registered", "exact_grid_compatible"),
  });
  assert.equal(receipt.registrationClass, "not_attempted");
  assert.equal(receipt.collisionPromotionEligible, false);
  assert.equal(receipt.transformKind, "none");
  assert.equal(receipt.noGlobalTransformApplied, true);
  assert.equal(receipt.globalImageRegistrationProven, false);
  assert.ok(receipt.constructionReasons.includes("ol_not_attempted_exact_grid"));
});

test("identity-certified rescaled does not attempt OL", async () => {
  const receipt = await constructOriginalStructuralLocalizationAuthority({
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 64,
      decodedHeight: 43,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "o".repeat(64),
      decodedWidth: 96,
      decodedHeight: 64,
      orientation: 1,
    },
    emptyBytes: Uint8Array.from([1]),
    originalBytes: Uint8Array.from([1]),
    observation: null,
    identityRegistration: identityReceipt(
      "certified_rescaled_registered",
      "aspect_compatible_rescaled",
    ),
  });
  assert.equal(receipt.registrationClass, "not_attempted");
  assert.ok(receipt.constructionReasons.includes("ol_not_attempted_identity_certified"));
});

test("identity-rejected rescaled attempts OL", () => {
  assert.equal(
    shouldAttemptOriginalStructuralLocalization({
      oldCompatibilityTier: "aspect_compatible_rescaled",
      identityRegistrationClass: "rejected",
    }),
    true,
  );
  assert.equal(
    shouldAttemptOriginalStructuralLocalization({
      oldCompatibilityTier: "exact_grid_compatible",
      identityRegistrationClass: "exact_grid_registered",
    }),
    false,
  );
});

test("point anchor displaced from EMPTY remains OL localized", () => {
  const empty = { u: 0.356, v: 0.511 };
  const original = { u: 0.368, v: 0.510 };
  assert.ok(identityResidual(empty, original).r > REGISTRATION_MAX_IDENTITY_RESIDUAL);
  const identityUnits = aggregateHybridEvidenceUnits([{
    priorId: "corner",
    structureId: "opening:door:corner:0",
    parentStructureId: "door",
    structureKind: "opening_doorway",
    evidenceClass: "point_anchor",
    empty,
    tangent: null,
    emptyLine: null,
    original,
    originalLine: null,
    ncc: 0.91,
    pointResidual: identityResidual(empty, original),
    normalResidual: null,
    orientationResidual: null,
    tangentDiagnostic: null,
    tangentLocalization: "localized",
    displaySnapped: false,
    matched: true,
  }]);
  assert.equal(identityUnits[0]?.status, "contradiction");
  const ol = aggregateOriginalLocalizedPointAnchor([{
    priorId: "corner",
    structureId: "opening:door:corner:0",
    parentStructureId: "door",
    structureKind: "opening_doorway",
    evidenceClass: "point_anchor",
    empty,
    tangent: null,
    original,
    ncc: 0.91,
    orientationResidual: null,
    strongBandDiameter: 0.004,
    searchDisplacement: identityResidual(empty, original).r,
    searchBoundHit: false,
    signedNormalOffset: null,
    matched: true,
    failReason: null,
  }]);
  assert.equal(ol.status, "localized");
  assert.equal(ol.original?.x, original.u);
});

test("ridge displaced normally from EMPTY remains OL localized", () => {
  const polyline = [
    { x: 0.2, y: 0.62 },
    { x: 0.5, y: 0.62 },
    { x: 0.8, y: 0.62 },
  ];
  const samples = [
    ridgeSample("back", { u: 0.3, v: 0.62 }, { signedNormalOffset: 0.012 }),
    ridgeSample("back", { u: 0.5, v: 0.62 }, { signedNormalOffset: 0.011 }),
    ridgeSample("back", { u: 0.7, v: 0.62 }, { signedNormalOffset: 0.013 }),
  ];
  const identityLike: HybridSampleMatch[] = samples.map((sample) => ({
    priorId: sample.priorId,
    structureId: sample.structureId,
    parentStructureId: null,
    structureKind: "floor_wall",
    evidenceClass: "ridge_normal",
    empty: sample.empty,
    tangent: sample.tangent,
    emptyLine: {
      theta: Math.PI / 2,
      rho: 0.62,
      origin: { u: 0.5, v: 0.62 },
      direction: { u: 1, v: 0 },
    },
    original: sample.original,
    originalLine: null,
    ncc: sample.ncc,
    pointResidual: null,
    normalResidual: sample.signedNormalOffset,
    orientationResidual: sample.orientationResidual,
    tangentDiagnostic: null,
    tangentLocalization: "ambiguous",
    displaySnapped: false,
    matched: true,
  }));
  const identityUnits = aggregateHybridEvidenceUnits(identityLike);
  assert.equal(identityUnits[0]?.status, "contradiction");
  const ol = aggregateOriginalLocalizedRidge(samples, polyline);
  assert.equal(ol.status, "localized");
  assert.ok(ol.span);
  assert.equal(ol.span?.interpolated, false);
  assert.equal(ol.span?.hiddenContinuation, false);
});

test("ridge orientation beyond 15° is rejected", () => {
  const polyline = [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }];
  const samples = [
    ridgeSample("back", { u: 0.3, v: 0.62 }, { orientationResidual: 0.4 }),
    ridgeSample("back", { u: 0.5, v: 0.62 }, { orientationResidual: 0.42 }),
    ridgeSample("back", { u: 0.7, v: 0.62 }, { orientationResidual: 0.41 }),
  ];
  const ol = aggregateOriginalLocalizedRidge(samples, polyline);
  assert.equal(ol.status, "rejected");
});

test("bimodal parallel family is ambiguous", () => {
  const polyline = [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }];
  const samples = [
    ridgeSample("back", { u: 0.25, v: 0.62 }, { signedNormalOffset: 0.001 }),
    ridgeSample("back", { u: 0.35, v: 0.62 }, { signedNormalOffset: 0.0005 }),
    ridgeSample("back", { u: 0.55, v: 0.62 }, { signedNormalOffset: 0.018 }),
    ridgeSample("back", { u: 0.7, v: 0.62 }, { signedNormalOffset: 0.019 }),
  ];
  const ol = aggregateOriginalLocalizedRidge(samples, polyline);
  assert.equal(ol.status, "ambiguous");
});

test("missing structure is no_match", () => {
  const polyline = [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }];
  const samples = [
    ridgeSample("back", { u: 0.3, v: 0.62 }, { matched: false, failReason: "no_match" }),
    ridgeSample("back", { u: 0.5, v: 0.62 }, { matched: false, failReason: "no_match" }),
  ];
  const ol = aggregateOriginalLocalizedRidge(samples, polyline);
  assert.equal(ol.status, "no_match");
});

test("search bound hit is no_match and does not auto-widen", () => {
  assert.equal(REGISTRATION_SEARCH_WINDOW, 0.04);
  const sample: OriginalLocalizationSample = {
    priorId: "a",
    structureId: "corner",
    parentStructureId: null,
    structureKind: "room_corner",
    evidenceClass: "point_anchor",
    empty: { u: 0.3, v: 0.3 },
    tangent: null,
    original: { u: 0.34, v: 0.3 },
    ncc: 0.9,
    orientationResidual: null,
    strongBandDiameter: 0.004,
    searchDisplacement: 0.04,
    searchBoundHit: true,
    signedNormalOffset: null,
    matched: false,
    failReason: "no_match",
  };
  const ol = aggregateOriginalLocalizedPointAnchor([sample]);
  assert.equal(ol.status, "no_match");
});

test("NCC localizer does not apply identity residual 0.003", () => {
  const empty = makeRaster(64, 64, 0.15);
  const original = makeRaster(64, 64, 0.15);
  stampBox(empty, 18, 18, 22, 22, 1);
  stampBox(original, 20, 18, 24, 22, 1);
  const located = localizePointAnchorNcc({
    emptyUv: { u: 20 / 63, v: 20 / 63 },
    emptyStructure: structureRaster(empty),
    originalStructure: structureRaster(original),
  });
  assert.equal(located.matched, true);
  if (!located.matched) return;
  assert.ok(
    Math.hypot(located.originalUv.u - 20 / 63, located.originalUv.v - 20 / 63) >
      REGISTRATION_MAX_IDENTITY_RESIDUAL,
  );
});

test("ridge localizer finds a normally displaced line without identity contradiction", () => {
  const empty = makeRaster(80, 64, 0.12);
  const original = makeRaster(80, 64, 0.12);
  verticalRidge(empty, 0.4);
  verticalRidge(original, 0.42);
  const located = localizeRidgeNormalNcc({
    emptyUv: { u: 0.4, v: 0.5 },
    tangentUv: { u: 0, v: 1 },
    emptyGrey: empty,
    originalGrey: original,
  });
  assert.equal(located.matched, true);
  if (!located.matched) return;
  assert.ok(Math.abs(located.signedNormalOffsetUv) > REGISTRATION_MAX_IDENTITY_RESIDUAL);
});

test("wrong parallel ridge family is ambiguous", () => {
  const primary = new Set([0, 1]);
  const competing = [8, 9];
  assert.equal(ridgeComponentsSeparated(primary, competing, 0.005), true);
  const samples = [
    ridgeSample("back", { u: 0.25, v: 0.62 }, { signedNormalOffset: 0.001 }),
    ridgeSample("back", { u: 0.35, v: 0.62 }, { signedNormalOffset: 0.0005 }),
    ridgeSample("back", { u: 0.55, v: 0.62 }, { signedNormalOffset: 0.018 }),
    ridgeSample("back", { u: 0.7, v: 0.62 }, { signedNormalOffset: 0.019 }),
  ];
  const ol = aggregateOriginalLocalizedRidge(samples, [
    { x: 0.2, y: 0.62 },
    { x: 0.8, y: 0.62 },
  ]);
  assert.equal(ol.status, "ambiguous");
  const localizer = readFileSync(path.join(V2, "empty-original-ncc-localizer.ts"), "utf8");
  assert.match(localizer, /reason: "ambiguous"/);
  assert.match(localizer, /ridgeComponentsSeparated/);
});

test("repetitive point-anchor strong band is ambiguous", () => {
  const diameter = strongBandDiameter(
    [{ x: 10, y: 20 }, { x: 18, y: 20 }, { x: 26, y: 20 }],
    64,
    64,
  );
  assert.ok(diameter > ANCHOR_STRONG_BAND_MAX_DIAMETER);
  const localizer = readFileSync(path.join(V2, "empty-original-ncc-localizer.ts"), "utf8");
  assert.match(localizer, /diameter > ANCHOR_STRONG_BAND_MAX_DIAMETER/);
  assert.match(localizer, /reason: "ambiguous"/);
});

test("localizer does not chase a structure outside ±0.04", () => {
  const empty = makeRaster(80, 64, 0.12);
  const original = makeRaster(80, 64, 0.12);
  verticalRidge(empty, 0.3);
  verticalRidge(original, 0.5);
  const located = localizeRidgeNormalNcc({
    emptyUv: { u: 0.3, v: 0.5 },
    tangentUv: { u: 0, v: 1 },
    emptyGrey: empty,
    originalGrey: original,
  });
  assert.equal(located.matched === false || located.searchBoundHit, true);
});

test("finite ORIGINAL span uses only contiguous localized samples", () => {
  const polyline = [
    { x: 0.1, y: 0.7 },
    { x: 0.5, y: 0.7 },
    { x: 0.9, y: 0.7 },
  ];
  const full = constructOriginalLocalizedFiniteSpan([
    ridgeSample("w", { u: 0.2, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.4, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.6, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.8, v: 0.7 }, { signedNormalOffset: 0.01 }),
  ], polyline);
  assert.equal("status" in full, false);
  if ("status" in full) return;
  assert.equal(full.polyline.length, 4);
  assert.equal(full.interpolated, false);
  assert.equal(full.hiddenContinuation, false);
});

test("partial support uses the contiguous subspan and does not extend", () => {
  const polyline = [
    { x: 0.1, y: 0.7 },
    { x: 0.5, y: 0.7 },
    { x: 0.9, y: 0.7 },
  ];
  const partial = constructOriginalLocalizedFiniteSpan([
    ridgeSample("w", { u: 0.2, v: 0.7 }, { matched: false, failReason: "no_match" }),
    ridgeSample("w", { u: 0.4, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.55, v: 0.7 }, { signedNormalOffset: 0.011 }),
    ridgeSample("w", { u: 0.8, v: 0.7 }, { matched: false, failReason: "no_match" }),
  ], polyline);
  assert.equal("status" in partial, false);
  if ("status" in partial) return;
  assert.equal(partial.polyline.length, 2);
  assert.ok(partial.polyline[0]!.x > 0.3);
  assert.ok(partial.polyline[partial.polyline.length - 1]!.x < 0.7);
});

test("separated localized clusters are not bridged", () => {
  const polyline = [
    { x: 0.1, y: 0.7 },
    { x: 0.5, y: 0.7 },
    { x: 0.9, y: 0.7 },
  ];
  const separated = constructOriginalLocalizedFiniteSpan([
    ridgeSample("w", { u: 0.15, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.25, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.5, v: 0.7 }, { matched: false, failReason: "no_match" }),
    ridgeSample("w", { u: 0.7, v: 0.7 }, { signedNormalOffset: 0.012 }),
    ridgeSample("w", { u: 0.85, v: 0.7 }, { signedNormalOffset: 0.012 }),
  ], polyline);
  assert.equal("status" in separated, true);
  if (!("status" in separated)) return;
  assert.equal(separated.status, "ambiguous");
});

test("unsupported endpoint is not extended to the EMPTY corner", () => {
  const polyline = [
    { x: 0.1, y: 0.7 },
    { x: 0.9, y: 0.7 },
  ];
  const span = constructOriginalLocalizedFiniteSpan([
    ridgeSample("w", { u: 0.4, v: 0.7 }, { signedNormalOffset: 0.01 }),
    ridgeSample("w", { u: 0.55, v: 0.7 }, { signedNormalOffset: 0.01 }),
  ], polyline);
  assert.equal("status" in span, false);
  if ("status" in span) return;
  assert.ok(span.polyline.every((point) => point.x > 0.3 && point.x < 0.7));
});

test("OL contract forbids transform authority", () => {
  const source = readFileSync(
    path.join(V2, "original-structural-localization-authority-contract.ts"),
    "utf8",
  );
  const server = readFileSync(
    path.join(V2, "original-structural-localization.server.ts"),
    "utf8",
  );
  assert.match(source, /afc-v2-original-structural-localization-authority\/v1/);
  assert.match(source, /afc-v2-original-structure-localizer\/v1/);
  assert.match(source, /certified_original_localized/);
  assert.doesNotMatch(source, /similarity|affine|homography|thin-plate|warp mesh/i);
  assert.doesNotMatch(server, /fittedHesseLine\(\[[\s\S]*empty/);
  assert.equal(AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION,
    "afc-v2-original-structural-localization-authority/v1");
  assert.equal(AFC_V2_ORIGINAL_STRUCTURE_LOCALIZER_VERSION,
    "afc-v2-original-structure-localizer/v1");
});

test("identity matcher still lives in the extracted localizer", () => {
  const registration = readFileSync(
    path.join(V2, "empty-original-registration.server.ts"),
    "utf8",
  );
  assert.match(registration, /localizePointAnchorNcc/);
  assert.match(registration, /localizeRidgeNormalNcc/);
  assert.match(registration, /REGISTRATION_MAX_IDENTITY_RESIDUAL/);
  assert.doesNotMatch(registration, /function extractPatch/);
});
