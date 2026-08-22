import { createHash } from "node:crypto";

import {
  EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION,
  P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS,
  type BoundaryFragmentClassificationReason,
  type BoundaryFragmentVerification,
  type EmptyRegionBoundaryFragment,
  type EmptyRegionBoundaryFragmentParameters,
  type EmptyRegionBoundaryFragmentReadResult,
  readCertifiedEmptyRegionBoundaryFragments,
} from "./empty-region-boundary-fragments";
import {
  EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
  EMPTY_PHYSICAL_BOUNDARY_FIXTURE_VERSION,
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  type EmptyVisibleFloorRegionParameters,
  type Rgb,
  type SourcePixelPoint,
} from "./empty-visible-floor-region";
import {
  type P2S2BHoldoutIdentity,
  parseP2S2BHoldoutIdentity,
} from "./p2-s2b-holdout-identity";

export const P2_S2B_FROZEN_PREDICTION_VERSION =
  "p2-s2b-frozen-prediction/v1" as const;
export const P2_S2B_CERTIFIED_UI_GIT_SHA =
  "f5223fd27340283fc16577d6d229361110e85c48" as const;
export const P2_S2B_CERTIFIED_REGION_MODULE_BLOB =
  "dc139f5adf0f66ceaff7773e18d687d335739ed8" as const;
export const P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB =
  "20940459fc86a06c6a72a7ce8099bb6a5c1e893a" as const;

export const P2_S2B_CERTIFIED_READER_IDENTITY = Object.freeze({
  uiGitSha: P2_S2B_CERTIFIED_UI_GIT_SHA,
  regionVersion: EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  fragmentVersion: EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION,
  regionModuleBlob: P2_S2B_CERTIFIED_REGION_MODULE_BLOB,
  fragmentModuleBlob: P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB,
});

type CertifiedReaderIdentity = typeof P2_S2B_CERTIFIED_READER_IDENTITY;
type FailClosedReason = Extract<
  EmptyRegionBoundaryFragmentReadResult,
  { ok: false }
>["reason"];

export type P2S2BRegionPrediction = Readonly<{
  seed: Readonly<{
    pointSourcePx: SourcePixelPoint;
    patchMeanRgb: Rgb;
    patchMeanLuma: number;
    patchMeanWarmChroma: number;
    effectiveMinimumWarmChroma: number;
    effectiveMaximumLuma: number;
    appearancePrototypes: readonly Rgb[];
  }>;
  componentPixelCount: number;
  componentFraction: number;
  componentBoundsSourcePx: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  boundaryPixelCount: number;
  upperPerimeterSpanCount: number;
  frameContactSpanCount: number;
  componentMaskSha256: string;
}>;

export type P2S2BPredictionOutcome =
  | Readonly<{
      status: "ok";
      region: P2S2BRegionPrediction;
      fragments: readonly EmptyRegionBoundaryFragment[];
    }>
  | Readonly<{
      status: "failed_closed";
      reason: FailClosedReason;
    }>;

export type P2S2BFrozenPredictionReceipt = Readonly<{
  version: typeof P2_S2B_FROZEN_PREDICTION_VERSION;
  detector: CertifiedReaderIdentity;
  input: P2S2BHoldoutIdentity;
  frozenParameters: Readonly<{
    region: EmptyVisibleFloorRegionParameters;
    fragments: EmptyRegionBoundaryFragmentParameters;
  }>;
  outcome: P2S2BPredictionOutcome;
}>;

export type P2S2BFrozenPredictionReceiptParseResult =
  | Readonly<{ ok: true; receipt: P2S2BFrozenPredictionReceipt }>
  | Readonly<{ ok: false; reason: string }>;

export type P2S2BDummyFixtureVariant = "a" | "b";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

const SHA_1 = /^[a-f0-9]{40}$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const FAIL_CLOSED_REASONS = new Set<FailClosedReason>([
  "decode_failed",
  "fixture_identity_mismatch",
  "lower_center_seed_not_floor_like",
  "empty_seed_component",
]);
const BOUNDARY_STATES = new Set([
  "physical_wall",
  "frame_truncated",
  "unknown",
]);
const CLASSIFICATION_REASONS = new Set<BoundaryFragmentClassificationReason>([
  "verified_floor_termination",
  "image_frame_contact",
  "insufficient_finite_support",
  "irregular_region_perimeter",
  "inside_not_seed_floor_like",
  "outside_still_floor_like",
  "weak_inside_outside_transition",
  "unsupported_region_sides",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
}

function point(
  value: unknown,
  normalized = false
): value is Readonly<{ x: number; y: number }> {
  return record(value) &&
    exactKeys(value, ["x", "y"]) &&
    finite(value.x) &&
    finite(value.y) &&
    (!normalized ||
      (value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1));
}

function rgb(value: unknown): value is Rgb {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every(finite);
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finite(value);
}

function endpoint(value: unknown): boolean {
  return record(value) &&
    exactKeys(value, ["status", "frameContact"]) &&
    typeof value.status === "string" &&
    ["visible", "frame_truncated"].includes(value.status) &&
    typeof value.frameContact === "string" &&
    ["no_frame_contact", "contacts_frame"].includes(
      value.frameContact
    );
}

function verification(
  value: unknown
): value is BoundaryFragmentVerification {
  return record(value) &&
    exactKeys(value, [
      "sourcePixelLength",
      "sourcePixelXSpan",
      "sampleCount",
      "maximumLineResidualPx",
      "insideFloorLikeFraction",
      "outsideFloorLikeFraction",
      "meanInsideSeedRgbDistance",
      "meanOutsideSeedRgbDistance",
      "meanOutsideToInsideLumaDrop",
      "meanOutsideToInsideRgbDistance",
      "meanInsideToOutsideWarmChromaDrop",
      "insideRegionSupportFraction",
      "outsideRegionExclusionFraction",
    ]) &&
    finite(value.sourcePixelLength) &&
    finite(value.sourcePixelXSpan) &&
    nonNegativeInteger(value.sampleCount) &&
    nullableFinite(value.maximumLineResidualPx) &&
    nullableFinite(value.insideFloorLikeFraction) &&
    nullableFinite(value.outsideFloorLikeFraction) &&
    nullableFinite(value.meanInsideSeedRgbDistance) &&
    nullableFinite(value.meanOutsideSeedRgbDistance) &&
    nullableFinite(value.meanOutsideToInsideLumaDrop) &&
    nullableFinite(value.meanOutsideToInsideRgbDistance) &&
    nullableFinite(value.meanInsideToOutsideWarmChromaDrop) &&
    nullableFinite(value.insideRegionSupportFraction) &&
    nullableFinite(value.outsideRegionExclusionFraction);
}

function fragment(
  value: unknown,
  input: P2S2BHoldoutIdentity
): value is EmptyRegionBoundaryFragment {
  return record(value) &&
    exactKeys(value, [
      "id",
      "roomId",
      "emptyImageSha256",
      "coordinateSpace",
      "proposalVersion",
      "sourceRegionVersion",
      "sourcePerimeterSpanId",
      "geometryKind",
      "boundaryState",
      "classificationReasons",
      "startEndpoint",
      "endEndpoint",
      "touchesImageFrame",
      "pointsSourceNormalized",
      "verification",
    ]) &&
    typeof value.id === "string" &&
    value.roomId === input.roomId &&
    value.emptyImageSha256 === input.emptySha256 &&
    value.coordinateSpace ===
      EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE &&
    value.proposalVersion === EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION &&
    value.sourceRegionVersion === EMPTY_VISIBLE_FLOOR_REGION_VERSION &&
    typeof value.sourcePerimeterSpanId === "string" &&
    value.geometryKind === "finite_open_observed_perimeter_span" &&
    typeof value.boundaryState === "string" &&
    BOUNDARY_STATES.has(value.boundaryState) &&
    Array.isArray(value.classificationReasons) &&
    value.classificationReasons.length > 0 &&
    value.classificationReasons.every(reason =>
      typeof reason === "string" &&
      CLASSIFICATION_REASONS.has(reason as BoundaryFragmentClassificationReason)
    ) &&
    endpoint(value.startEndpoint) &&
    endpoint(value.endEndpoint) &&
    typeof value.touchesImageFrame === "boolean" &&
    Array.isArray(value.pointsSourceNormalized) &&
    value.pointsSourceNormalized.length >= 2 &&
    value.pointsSourceNormalized.every(valuePoint => point(valuePoint, true)) &&
    verification(value.verification);
}

function seed(
  value: unknown
): value is P2S2BRegionPrediction["seed"] {
  return record(value) &&
    exactKeys(value, [
      "pointSourcePx",
      "patchMeanRgb",
      "patchMeanLuma",
      "patchMeanWarmChroma",
      "effectiveMinimumWarmChroma",
      "effectiveMaximumLuma",
      "appearancePrototypes",
    ]) &&
    point(value.pointSourcePx) &&
    rgb(value.patchMeanRgb) &&
    finite(value.patchMeanLuma) &&
    finite(value.patchMeanWarmChroma) &&
    finite(value.effectiveMinimumWarmChroma) &&
    finite(value.effectiveMaximumLuma) &&
    Array.isArray(value.appearancePrototypes) &&
    value.appearancePrototypes.every(rgb);
}

function bounds(
  value: unknown
): value is P2S2BRegionPrediction["componentBoundsSourcePx"] {
  return record(value) &&
    exactKeys(value, ["minX", "minY", "maxX", "maxY"]) &&
    nonNegativeInteger(value.minX) &&
    nonNegativeInteger(value.minY) &&
    nonNegativeInteger(value.maxX) &&
    nonNegativeInteger(value.maxY);
}

function region(
  value: unknown,
  input: P2S2BHoldoutIdentity
): value is P2S2BRegionPrediction {
  if (!record(value)) return false;
  const seedValue = value.seed;
  const boundsValue = value.componentBoundsSourcePx;
  const area = input.emptyDimensions.width * input.emptyDimensions.height;
  return exactKeys(value, [
      "seed",
      "componentPixelCount",
      "componentFraction",
      "componentBoundsSourcePx",
      "boundaryPixelCount",
      "upperPerimeterSpanCount",
      "frameContactSpanCount",
      "componentMaskSha256",
    ]) &&
    seed(seedValue) &&
    Number.isInteger(seedValue.pointSourcePx.x) &&
    Number.isInteger(seedValue.pointSourcePx.y) &&
    seedValue.pointSourcePx.x >= 0 &&
    seedValue.pointSourcePx.x < input.emptyDimensions.width &&
    seedValue.pointSourcePx.y >= 0 &&
    seedValue.pointSourcePx.y < input.emptyDimensions.height &&
    nonNegativeInteger(value.componentPixelCount) &&
    value.componentPixelCount <= area &&
    finite(value.componentFraction) &&
    value.componentFraction === value.componentPixelCount / area &&
    bounds(boundsValue) &&
    boundsValue.minX <= boundsValue.maxX &&
    boundsValue.minY <= boundsValue.maxY &&
    boundsValue.maxX < input.emptyDimensions.width &&
    boundsValue.maxY < input.emptyDimensions.height &&
    nonNegativeInteger(value.boundaryPixelCount) &&
    nonNegativeInteger(value.upperPerimeterSpanCount) &&
    nonNegativeInteger(value.frameContactSpanCount) &&
    typeof value.componentMaskSha256 === "string" &&
    SHA_256.test(value.componentMaskSha256);
}

function canonicalize(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON rejects non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (record(value)) {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (typeof item === "undefined") {
        throw new TypeError("canonical JSON rejects undefined values");
      }
      output[key] = canonicalize(item);
    }
    return output;
  }
  throw new TypeError("canonical JSON accepts JSON values only");
}

function certifiedFrozenParameters(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, ["region", "fragments"])
  ) return false;
  try {
    return JSON.stringify(canonicalize(value.region)) ===
        JSON.stringify(canonicalize(P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS)) &&
      JSON.stringify(canonicalize(value.fragments)) ===
        JSON.stringify(canonicalize(P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS));
  } catch {
    return false;
  }
}

function uniqueFragmentIds(values: readonly unknown[]): boolean {
  const ids = values.map(value =>
    record(value) && typeof value.id === "string" ? value.id : null
  );
  return ids.every((id): id is string => id !== null) &&
    new Set(ids).size === ids.length;
}

export function canonicalP2S2BPredictionReceiptJson(
  receipt: P2S2BFrozenPredictionReceipt
): string {
  return JSON.stringify(canonicalize(receipt));
}

export function hashP2S2BPredictionReceipt(
  receipt: P2S2BFrozenPredictionReceipt
): string {
  return createHash("sha256")
    .update(canonicalP2S2BPredictionReceiptJson(receipt), "utf8")
    .digest("hex");
}

export function prettyP2S2BPredictionReceiptJson(
  receipt: P2S2BFrozenPredictionReceipt
): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

/**
 * Creates the parser-required fixture entirely in memory. Its one annotation
 * is non-collision, unknown, and semantically ignored by the certified reader.
 */
export function createP2S2BEphemeralIdentityAdapter(
  identity: P2S2BHoldoutIdentity,
  variant: P2S2BDummyFixtureVariant
): EmptyPhysicalBoundaryFixture {
  const offset = variant === "a" ? 0.1 : 0.67;
  const rawFixture = {
    version: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_VERSION,
    roomId: identity.roomId,
    coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
    emptyImage: {
      sha256: identity.emptySha256,
      dimensions: identity.emptyDimensions,
      generatorId: identity.generatorId,
      generatedFromOriginalSha256: identity.originalSha256,
      manifestFileName: identity.manifestFileName,
    },
    evaluationCorridorSourcePx: 1,
    annotations: [
      {
        id: `p2-s2b-ephemeral-identity-adapter-${variant}`,
        pointsSourceNormalized: [
          { x: offset, y: 0.12 },
          { x: Math.min(0.97, offset + 0.21), y: variant === "a" ? 0.31 : 0.88 },
        ],
        interpretation: "side_floor_boundary",
        evidenceKind: "partially_visible",
        boundaryState: "unknown",
        collisionEligible: false,
        startEndpoint: {
          status: "unresolved",
          frameContact: "unknown",
        },
        endEndpoint: {
          status: "unresolved",
          frameContact: "unknown",
        },
        notes:
          "Ephemeral parser-signature adapter only; not holdout evidence or scoring geometry.",
      },
    ],
  };
  const parsed = parseEmptyPhysicalBoundaryFixture(rawFixture);
  if (!parsed.ok) {
    throw new Error(`invalid ephemeral identity adapter: ${parsed.reason}`);
  }
  return parsed.fixture;
}

export async function readP2S2BFrozenHoldout(
  imageBytes: Uint8Array,
  identity: P2S2BHoldoutIdentity,
  dummyVariant: P2S2BDummyFixtureVariant = "a"
): Promise<EmptyRegionBoundaryFragmentReadResult> {
  return readCertifiedEmptyRegionBoundaryFragments(
    imageBytes,
    createP2S2BEphemeralIdentityAdapter(identity, dummyVariant)
  );
}

export async function createP2S2BFrozenPredictionReceipt(
  imageBytes: Uint8Array,
  identity: P2S2BHoldoutIdentity,
  dummyVariant: P2S2BDummyFixtureVariant = "a"
): Promise<P2S2BFrozenPredictionReceipt> {
  const read = await readP2S2BFrozenHoldout(
    imageBytes,
    identity,
    dummyVariant
  );
  const outcome: P2S2BPredictionOutcome = read.ok
    ? Object.freeze({
        status: "ok",
        region: Object.freeze({
          seed: Object.freeze({
            pointSourcePx: read.region.seed.pointSourcePx,
            patchMeanRgb: read.region.seed.patchMeanRgb,
            patchMeanLuma: read.region.seed.patchMeanLuma,
            patchMeanWarmChroma: read.region.seed.patchMeanWarmChroma,
            effectiveMinimumWarmChroma:
              read.region.seed.effectiveMinimumWarmChroma,
            effectiveMaximumLuma: read.region.seed.effectiveMaximumLuma,
            appearancePrototypes: read.region.seed.appearancePrototypes,
          }),
          componentPixelCount: read.region.componentPixelCount,
          componentFraction: read.region.componentFraction,
          componentBoundsSourcePx: read.region.componentBoundsSourcePx,
          boundaryPixelCount: read.region.boundaryPixelCount,
          upperPerimeterSpanCount: read.region.upperPerimeterSpans.length,
          frameContactSpanCount: read.region.frameContactSpans.length,
          componentMaskSha256: createHash("sha256")
            .update(read.region.componentMask)
            .digest("hex"),
        }),
        fragments: read.fragments,
      })
    : Object.freeze({
        status: "failed_closed",
        reason: read.reason,
      });
  return Object.freeze({
    version: P2_S2B_FROZEN_PREDICTION_VERSION,
    detector: P2_S2B_CERTIFIED_READER_IDENTITY,
    input: identity,
    frozenParameters: Object.freeze({
      region: P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
      fragments: P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS,
    }),
    outcome,
  });
}

export function parseP2S2BFrozenPredictionReceipt(
  value: unknown
): P2S2BFrozenPredictionReceiptParseResult {
  if (!record(value) || !exactKeys(value, [
    "version",
    "detector",
    "input",
    "frozenParameters",
    "outcome",
  ])) {
    return { ok: false, reason: "prediction receipt shape is invalid" };
  }
  if (value.version !== P2_S2B_FROZEN_PREDICTION_VERSION) {
    return { ok: false, reason: "prediction receipt version is invalid" };
  }
  if (
    !record(value.detector) ||
    !exactKeys(value.detector, [
      "uiGitSha",
      "regionVersion",
      "fragmentVersion",
      "regionModuleBlob",
      "fragmentModuleBlob",
    ]) ||
    value.detector.uiGitSha !== P2_S2B_CERTIFIED_UI_GIT_SHA ||
    value.detector.regionVersion !== EMPTY_VISIBLE_FLOOR_REGION_VERSION ||
    value.detector.fragmentVersion !==
      EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION ||
    value.detector.regionModuleBlob !== P2_S2B_CERTIFIED_REGION_MODULE_BLOB ||
    value.detector.fragmentModuleBlob !==
      P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB ||
    !SHA_1.test(String(value.detector.regionModuleBlob)) ||
    !SHA_1.test(String(value.detector.fragmentModuleBlob))
  ) {
    return { ok: false, reason: "prediction detector identity is invalid" };
  }
  const input = parseP2S2BHoldoutIdentity(value.input);
  if (!input.ok) {
    return { ok: false, reason: `prediction input is invalid: ${input.reason}` };
  }
  if (
    !certifiedFrozenParameters(value.frozenParameters)
  ) {
    return { ok: false, reason: "prediction parameters are not certified" };
  }
  if (!record(value.outcome) || typeof value.outcome.status !== "string") {
    return { ok: false, reason: "prediction outcome is invalid" };
  }
  if (value.outcome.status === "failed_closed") {
    if (
      !exactKeys(value.outcome, ["status", "reason"]) ||
      typeof value.outcome.reason !== "string" ||
      !FAIL_CLOSED_REASONS.has(value.outcome.reason as FailClosedReason)
    ) {
      return { ok: false, reason: "fail-closed outcome is invalid" };
    }
  } else if (value.outcome.status === "ok") {
    if (
      !exactKeys(value.outcome, ["status", "region", "fragments"]) ||
      !region(value.outcome.region, input.identity) ||
      !Array.isArray(value.outcome.fragments) ||
      !value.outcome.fragments.every(valueFragment =>
        fragment(valueFragment, input.identity)
      ) ||
      !uniqueFragmentIds(value.outcome.fragments)
    ) {
      return { ok: false, reason: "successful prediction outcome is invalid" };
    }
  } else {
    return { ok: false, reason: "prediction outcome status is invalid" };
  }
  return {
    ok: true,
    receipt: value as P2S2BFrozenPredictionReceipt,
  };
}
