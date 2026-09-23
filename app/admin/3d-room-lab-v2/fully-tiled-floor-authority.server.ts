import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";

import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  buildCalibrationImageBasisId,
  type CalibrationImageBasis,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import {
  settleAfcFixedSeamCalibrationWithRatioExtension,
} from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import {
  validatePendingAfcLabCameraApply,
} from "@/app/admin/3d-room-lab/afc-lab-apply-transaction";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
  parseCalibratedCameraAppliedAuthority,
  type AuthorityFloorPolygon,
  type CalibratedCameraAppliedAuthority,
  type ParsedCalibratedCameraAppliedAuthority,
} from "@/app/admin/3d-room-lab/calibrated-camera-applied-authority";
import type {
  AppliedCalibratedCameraSnapshot,
} from "@/app/admin/3d-room-lab/afc-calibrated-camera-authority-freeze";
import {
  evaluateCalibratedCameraIdentityRestore,
} from "@/app/admin/3d-room-lab/calibrated-camera-restore-authority";
import {
  afcSr1LiveSourceIdentityMatches,
  cloneAfcSr1LivePolygon,
  isValidAfcSr1LiveAnalyzeRequest,
  isValidAfcSr1LiveProductPolygon,
  qualifyAfcSr1LiveOriginalDefault,
  resolveAfcSr1LiveEmptyDefault,
  retainAfcSr1LiveAttemptEmptyEvidence,
  type AfcSr1QualifiedOriginal,
  type AfcSr1ResolvedEmpty,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product";
import type {
  AfcSr1LiveAnalyzeRequest,
  AfcSr1LiveBasis,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import type {
  AfcSr1SourcePolygon,
} from "@/app/admin/3d-room-lab/research/afc-sr1-semantic-prior";
import {
  classifyAfcR3cImagePairCompatibility,
} from "@/app/admin/3d-room-lab/research/gemini-floor-proposal-composition";
import {
  buildDurableSourceFloorAuthorityKey,
} from "@/app/admin/3d-room-lab/floor-source-authority";
import {
  evaluateQuadSolvability,
} from "@/app/admin/3d-room-lab/quad-solvability";
import {
  callCompositorAfcSr1TiledPerspectiveReader,
  type AfcSr1TiledPerspectiveReaderIdentity,
  type AfcSr1TiledPerspectiveReaderResponse,
} from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";
import {
  canonicalStringify,
  sha256Hex,
  type Json,
} from "@/lib/sceneHash";
import type {
  AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import type {
  FullyTiledGeneration,
} from "./fully-tiled-generation.server";

export const AFC_V2_FULLY_TILED_FLOOR_PRODUCT_VERSION =
  "afc-v2-fully-tiled-floor-authority/v1" as const;
export const AFC_V2_FULLY_TILED_CAMERA_FREEZE_VERSION =
  "afc-v2-fully-tiled-camera-freeze/v1" as const;
export const AFC_V2_FULLY_TILED_FLOOR_CROP_LEFT_SOURCE_NORMALIZED = 0.2;
export const AFC_V2_FULLY_TILED_FLOOR_CROP_RIGHT_SOURCE_NORMALIZED = 0.8;
export const AFC_V2_FULLY_TILED_FLOOR_CROP_TOP_SOURCE_NORMALIZED = 0.5;

export type AfcV2FullyTiledFloorReaderInput = Readonly<{
  bytes: Uint8Array;
  identity: AfcSr1TiledPerspectiveReaderIdentity;
  crop: Readonly<{
    kind: "lower_center_floor_region_crop";
    leftSourceNormalized:
      typeof AFC_V2_FULLY_TILED_FLOOR_CROP_LEFT_SOURCE_NORMALIZED;
    rightSourceNormalized:
      typeof AFC_V2_FULLY_TILED_FLOOR_CROP_RIGHT_SOURCE_NORMALIZED;
    topSourceNormalized:
      typeof AFC_V2_FULLY_TILED_FLOOR_CROP_TOP_SOURCE_NORMALIZED;
    sourceIdentitySha256: string;
    sourceNormalizedTransform:
      "x_source=left+x_crop*(right-left);y_source=top+y_crop*(1-top)";
  }>;
}>;

export type PreparedAfcV2FloorInputs = Readonly<{
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
  original: AfcSr1QualifiedOriginal;
  empty: AfcSr1ResolvedEmpty;
}>;

export type AfcV2FullyTiledFloorProduct = Readonly<{
  status: "authoritative_floor";
  productVersion: typeof AFC_V2_FULLY_TILED_FLOOR_PRODUCT_VERSION;
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
  originalBasis: AfcSr1LiveBasis;
  emptyBasis: AfcSr1LiveBasis;
  floorObservationSource: Readonly<{
    kind: "FULLY_TILED";
    imageIdentity: AfcSr1TiledPerspectiveReaderIdentity;
    generationId: string;
    generatedFrom: "ORIGINAL";
    parentOriginalSha256: string;
    readerVersion: "afc-sr1-tiled-perspective-reader/s1";
    readerInput: Readonly<{
      identity: AfcSr1TiledPerspectiveReaderIdentity;
      crop: AfcV2FullyTiledFloorReaderInput["crop"];
    }>;
    authoritativeQuadSourceNormalized: AfcSr1SourcePolygon;
    transferToOriginal:
      "aspect_compatible_source_normalized_not_pixel_verified";
  }>;
  metric: Readonly<{
    metricScaleAuthority: "provisional_reference_depth";
    referenceDepthM: number;
  }>;
  readerDiagnostics: Readonly<{
    core: Readonly<{
      rows: number;
      columns: number;
      j0: number;
      i0: number;
      cellIds: readonly number[];
    }>;
    selectedComponentTileCount: number;
    rawQuadrilateralCount: number;
    deduplicatedCellCount: number;
    reprojectionMeanPx: number;
    reprojectionMaxPx: number;
  }>;
}>;

export type AfcV2FullyTiledCameraFreezeReceipt = Readonly<{
  receiptVersion: typeof AFC_V2_FULLY_TILED_CAMERA_FREEZE_VERSION;
  payload: Readonly<{
    frozenAtIso: string;
    authority: ParsedCalibratedCameraAppliedAuthority;
    original: AfcSr1LiveBasis;
    empty: AfcSr1LiveBasis;
    floorObservation: AfcV2FullyTiledFloorProduct["floorObservationSource"];
    floorAuthorityKey: string;
    ratioFovSettle: Readonly<{
      applySafe: true;
      winningCellId: string;
      widthDepthRatio: number;
      referenceDepthM: number;
      worldWidthM: number;
      worldDepthM: number;
      verticalFovDeg: number;
    }>;
    cameraApply: Readonly<{
      validation: "passed";
      confidence: "high";
      sourceBasis: "ORIGINAL";
      snapshotFrameMatchedRenderer: true;
    }>;
  }>;
  integrity: Readonly<{
    algorithm: "sha256";
    canonicalization: "roomprintz-canonical-json-sort-keys/v1";
    payloadSha256: string;
  }>;
}>;

export type AfcV2FullyTiledFloorAnalyzeResult =
  | Readonly<{
      status: "failed";
      reason: string;
      product: AfcV2FullyTiledFloorProduct | null;
    }>
  | Readonly<{
      status: "applied";
      product: AfcV2FullyTiledFloorProduct;
      floor: Readonly<{
        authorityKey: string;
        sourceNormalizedPolygon: AfcSr1SourcePolygon;
        worldWidthM: number;
        referenceDepthM: number;
        widthDepthRatio: number;
      }>;
      camera: Readonly<{
        applied: true;
        verticalFovDeg: number;
        pose: AppliedCalibratedCameraSnapshot["pose"];
        frame: Readonly<{ width: number; height: number }>;
        originalBasisRestored: true;
      }>;
      analysisMode: "live" | "controlled_replay";
      freezeReceipt: AfcV2FullyTiledCameraFreezeReceipt;
    }>;

export type PrepareAfcV2FloorDependencies = Readonly<{
  qualifyOriginal?: (
    request: AfcSr1LiveAnalyzeRequest,
  ) => Promise<AfcSr1QualifiedOriginal | null>;
  resolveEmpty?: (
    original: AfcSr1QualifiedOriginal,
  ) => Promise<AfcSr1ResolvedEmpty | null>;
}>;

export type FullyTiledFloorAnalysisDependencies = Readonly<{
  readTiledPerspective?: (args: {
    imageBase64: string;
    claimedIdentity: AfcSr1TiledPerspectiveReaderIdentity;
  }) => Promise<AfcSr1TiledPerspectiveReaderResponse>;
  prepareFloorReaderInput?: (
    generation: FullyTiledGeneration,
  ) => Promise<AfcV2FullyTiledFloorReaderInput>;
  now?: () => Date;
  analysisMode?: "live" | "controlled_replay";
}>;

function request(input: AfcV2AnalyzeInput): AfcSr1LiveAnalyzeRequest {
  return {
    attemptId: input.attemptId,
    sourceImageUrl: input.sourceImageUrl,
    sourceImageIdentity: input.sourceImageIdentity,
    labLoadGeneration: input.loadGeneration,
    referenceDepthM: input.referenceDepthM,
  };
}

function identityMatches(
  left: AfcSr1TiledPerspectiveReaderIdentity,
  right: AfcSr1TiledPerspectiveReaderIdentity,
): boolean {
  return left.sha256 === right.sha256 &&
    left.byteCount === right.byteCount &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.mimeType === right.mimeType &&
    left.orientation === right.orientation;
}

function sourcePolygon(
  response: Extract<AfcSr1TiledPerspectiveReaderResponse, { status: "ok" }>,
  crop: AfcV2FullyTiledFloorReaderInput["crop"],
): AfcSr1SourcePolygon | null {
  const polygon = response.authoritativeQuadSourceNormalized.map((point) =>
    Object.freeze({
      x: crop.leftSourceNormalized +
        point.x *
          (crop.rightSourceNormalized - crop.leftSourceNormalized),
      y: crop.topSourceNormalized +
        point.y * (1 - crop.topSourceNormalized),
    })
  ) as unknown as AfcSr1SourcePolygon;
  return isValidAfcSr1LiveProductPolygon(polygon) &&
      polygon.every((point) =>
        point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
      ) &&
      Math.max(...polygon.map((point) => point.y)) >= 0.85 &&
      polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length >=
        0.7
    ? cloneAfcSr1LivePolygon(polygon)
    : null;
}

async function prepareLowerFloorRegionReaderInput(
  generation: FullyTiledGeneration,
): Promise<AfcV2FullyTiledFloorReaderInput> {
  const left = Math.floor(
    generation.identity.decodedWidth *
      AFC_V2_FULLY_TILED_FLOOR_CROP_LEFT_SOURCE_NORMALIZED,
  );
  const right = Math.floor(
    generation.identity.decodedWidth *
      AFC_V2_FULLY_TILED_FLOOR_CROP_RIGHT_SOURCE_NORMALIZED,
  );
  const top = Math.floor(
    generation.identity.decodedHeight *
      AFC_V2_FULLY_TILED_FLOOR_CROP_TOP_SOURCE_NORMALIZED,
  );
  const decodedWidth = right - left;
  const decodedHeight = generation.identity.decodedHeight - top;
  if (left <= 0 || decodedWidth <= 0 || top <= 0 || decodedHeight <= 0) {
    throw new Error("FULLY_TILED floor crop dimensions were invalid.");
  }
  const bytes = await sharp(Buffer.from(generation.bytes))
    .extract({
      left,
      top,
      width: decodedWidth,
      height: decodedHeight,
    })
    .png()
    .toBuffer();
  const identity = Object.freeze({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteCount: bytes.byteLength,
    decodedWidth,
    decodedHeight,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  });
  return Object.freeze({
    bytes: Uint8Array.from(bytes),
    identity,
    crop: Object.freeze({
      kind: "lower_center_floor_region_crop" as const,
      leftSourceNormalized:
        AFC_V2_FULLY_TILED_FLOOR_CROP_LEFT_SOURCE_NORMALIZED,
      rightSourceNormalized:
        AFC_V2_FULLY_TILED_FLOOR_CROP_RIGHT_SOURCE_NORMALIZED,
      topSourceNormalized:
        AFC_V2_FULLY_TILED_FLOOR_CROP_TOP_SOURCE_NORMALIZED,
      sourceIdentitySha256: generation.identity.sha256,
      sourceNormalizedTransform:
        "x_source=left+x_crop*(right-left);y_source=top+y_crop*(1-top)" as const,
    }),
  });
}

function originalBasis(
  input: AfcV2AnalyzeInput,
  basis: AfcSr1LiveBasis,
): CalibrationImageBasis {
  return {
    basisId: buildCalibrationImageBasisId({
      sourceImageUrl: input.sourceImageUrl,
      basisFingerprint: basis.sha256,
      decodedWidth: basis.decodedWidth,
      decodedHeight: basis.decodedHeight,
    }),
    basisFingerprint: basis.sha256,
    sourceImageUrl: input.sourceImageUrl,
    decodedWidth: basis.decodedWidth,
    decodedHeight: basis.decodedHeight,
    encodedOrientation: 1,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
  };
}

function authorityPolygon(
  points: readonly { x: number; y: number }[],
): AuthorityFloorPolygon | null {
  return points.length === 4
    ? points.map((point) => ({ ...point })) as unknown as AuthorityFloorPolygon
    : null;
}

async function freezeFullyTiledCamera(args: {
  snapshot: AppliedCalibratedCameraSnapshot;
  product: AfcV2FullyTiledFloorProduct;
  floorAuthorityKey: string;
  pending: {
    worldWidthM: number;
    worldDepthM: number;
  };
  settle: Extract<
    ReturnType<typeof settleAfcFixedSeamCalibrationWithRatioExtension>,
    { ok: true }
  >;
  candidate: NonNullable<
    ReturnType<typeof evaluateQuadSolvability>["applyCandidate"]
  >;
  candidateAvailable: boolean;
  frozenAtIso: string;
}): Promise<
  | {
      ok: true;
      receipt: AfcV2FullyTiledCameraFreezeReceipt;
      authority: ParsedCalibratedCameraAppliedAuthority;
    }
  | { ok: false; reason: string }
> {
  const sourceFloorPolygon = authorityPolygon(args.snapshot.sourceFloorPolygon);
  if (
    !sourceFloorPolygon ||
    !args.settle.applyObservability.available ||
    args.settle.applyObservability.firstFailingGate !== "none" ||
    !args.candidateAvailable ||
    args.candidate.confidence !== "high" ||
    args.candidate.displayAvgPx === null ||
    args.candidate.displayMaxPx === null
  ) {
    return { ok: false, reason: "apply_evidence_unavailable" };
  }

  const authority: CalibratedCameraAppliedAuthority = {
    authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
    appliedAtIso: args.snapshot.appliedAtIso,
    verticalFovDeg: args.snapshot.fovDeg,
    frameSize: { ...args.snapshot.frameSize },
    pose: {
      position: { ...args.snapshot.pose.position },
      lookAt: { ...args.snapshot.pose.lookAt },
      up: { ...args.snapshot.pose.up },
    },
    imageBasis: structuredClone(args.snapshot.imageBasis),
    sourceFloorPolygon,
    floorMapping: {
      worldWidth: args.pending.worldWidthM,
      worldDepth: args.pending.worldDepthM,
    },
    calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
    solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
    diagnosticsSummary: args.snapshot.diagnosticsSummary,
  };
  const parsedAuthority = parseCalibratedCameraAppliedAuthority(authority);
  if (!parsedAuthority.ok) {
    return { ok: false, reason: `camera_authority_${parsedAuthority.reason}` };
  }
  const payload = Object.freeze({
    frozenAtIso: args.frozenAtIso,
    authority: parsedAuthority.value,
    original: args.product.originalBasis,
    empty: args.product.emptyBasis,
    floorObservation: args.product.floorObservationSource,
    floorAuthorityKey: args.floorAuthorityKey,
    ratioFovSettle: Object.freeze({
      applySafe: true as const,
      winningCellId: args.settle.winningCellId,
      widthDepthRatio: args.settle.widthDepthRatio,
      referenceDepthM: args.settle.referenceDepthM,
      worldWidthM: args.settle.worldWidthM,
      worldDepthM: args.settle.worldDepthM,
      verticalFovDeg: args.settle.verticalFovDeg,
    }),
    cameraApply: Object.freeze({
      validation: "passed" as const,
      confidence: "high" as const,
      sourceBasis: "ORIGINAL" as const,
      snapshotFrameMatchedRenderer: true as const,
    }),
  });
  const payloadSha256 = await sha256Hex(
    canonicalStringify(payload as unknown as Json),
  );
  return {
    ok: true,
    authority: parsedAuthority.value,
    receipt: Object.freeze({
      receiptVersion: AFC_V2_FULLY_TILED_CAMERA_FREEZE_VERSION,
      payload,
      integrity: Object.freeze({
        algorithm: "sha256" as const,
        canonicalization:
          "roomprintz-canonical-json-sort-keys/v1" as const,
        payloadSha256,
      }),
    }),
  };
}

export async function prepareAfcV2OriginalAndEmpty(
  input: AfcV2AnalyzeInput,
  resultId: string,
  dependencies: PrepareAfcV2FloorDependencies = {},
): Promise<
  | Readonly<{ status: "prepared"; value: PreparedAfcV2FloorInputs }>
  | Readonly<{ status: "failed"; reason: string }>
> {
  const analyzeRequest = request(input);
  if (!isValidAfcSr1LiveAnalyzeRequest(analyzeRequest)) {
    return { status: "failed", reason: "request_contract_invalid" };
  }
  const original = await (
    dependencies.qualifyOriginal ?? qualifyAfcSr1LiveOriginalDefault
  )(analyzeRequest);
  if (!original) {
    return { status: "failed", reason: "original_refetch_or_decode_failed" };
  }
  if (!afcSr1LiveSourceIdentityMatches(analyzeRequest, original)) {
    return { status: "failed", reason: "qualified_source_basis_mismatch" };
  }
  const empty = await (
    dependencies.resolveEmpty ?? resolveAfcSr1LiveEmptyDefault
  )(original);
  if (!empty) {
    return { status: "failed", reason: "empty_generation_or_decode_failed" };
  }
  const emptyCompatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: original.basis.sha256,
      decodedWidth: original.basis.decodedWidth,
      decodedHeight: original.basis.decodedHeight,
      orientation: original.basis.orientation,
    },
    {
      fingerprint: empty.basis.sha256,
      decodedWidth: empty.basis.decodedWidth,
      decodedHeight: empty.basis.decodedHeight,
      orientation: empty.basis.orientation,
    },
  );
  if (emptyCompatibility.tier === "incompatible") {
    return { status: "failed", reason: "original_empty_incompatible" };
  }
  retainAfcSr1LiveAttemptEmptyEvidence({
    attemptId: input.attemptId,
    resultId,
    labLoadGeneration: input.loadGeneration,
    originalBasis: original.basis,
    empty,
  });
  return {
    status: "prepared",
    value: Object.freeze({
      attemptId: input.attemptId,
      resultId,
      labLoadGeneration: input.loadGeneration,
      original,
      empty,
    }),
  };
}

export async function executeAfcV2FullyTiledFloorAnalysis(
  input: AfcV2AnalyzeInput,
  prepared: PreparedAfcV2FloorInputs,
  generation: FullyTiledGeneration,
  dependencies: FullyTiledFloorAnalysisDependencies = {},
): Promise<AfcV2FullyTiledFloorAnalyzeResult> {
  const preparedBasis = prepared.original.basis;
  const generatedOriginal = generation.originalIdentity;
  const originalRatio =
    preparedBasis.decodedWidth / preparedBasis.decodedHeight;
  const fullyTiledRatio =
    generation.identity.decodedWidth / generation.identity.decodedHeight;
  if (
    prepared.attemptId !== input.attemptId ||
    prepared.labLoadGeneration !== input.loadGeneration ||
    prepared.original.sourceImageUrl !== input.sourceImageUrl ||
    preparedBasis.sha256 !== input.sourceImageIdentity.sha256 ||
    preparedBasis.decodedWidth !== input.sourceImageIdentity.decodedWidth ||
    preparedBasis.decodedHeight !== input.sourceImageIdentity.decodedHeight ||
    preparedBasis.orientation !== input.sourceImageIdentity.orientation ||
    !identityMatches(preparedBasis, generatedOriginal) ||
    generation.provenance.parentOriginalSha256 !==
      preparedBasis.sha256 ||
    generation.provenance.generatedFrom !== "ORIGINAL" ||
    Math.abs(fullyTiledRatio - originalRatio) / originalRatio > 0.015
  ) {
    return {
      status: "failed",
      reason: "FULLY_TILED floor acceptance binding failed.",
      product: null,
    };
  }

  let readerInput: AfcV2FullyTiledFloorReaderInput;
  try {
    readerInput = await (
      dependencies.prepareFloorReaderInput ??
      prepareLowerFloorRegionReaderInput
    )(generation);
  } catch {
    return {
      status: "failed",
      reason: "FULLY_TILED floor-region reader input failed.",
      product: null,
    };
  }
  if (
    readerInput.crop.sourceIdentitySha256 !== generation.identity.sha256
  ) {
    return {
      status: "failed",
      reason: "FULLY_TILED floor-region reader input identity mismatch.",
      product: null,
    };
  }
  const claimedIdentity = readerInput.identity;
  let reader: AfcSr1TiledPerspectiveReaderResponse;
  try {
    reader = await (
      dependencies.readTiledPerspective ??
      callCompositorAfcSr1TiledPerspectiveReader
    )({
      imageBase64: Buffer.from(readerInput.bytes).toString("base64"),
      claimedIdentity,
    });
  } catch {
    return {
      status: "failed",
      reason: "FULLY_TILED floor reader transport or contract failed.",
      product: null,
    };
  }
  if (!identityMatches(reader.decodedIdentity, claimedIdentity)) {
    return {
      status: "failed",
      reason: "FULLY_TILED floor reader identity mismatch.",
      product: null,
    };
  }
  if (reader.status !== "ok") {
    return {
      status: "failed",
      reason: `FULLY_TILED floor reader failed: ${reader.reason}.`,
      product: null,
    };
  }
  const polygon = sourcePolygon(
    reader,
    readerInput.crop,
  );
  if (!polygon) {
    return {
      status: "failed",
      reason:
        "FULLY_TILED floor reader returned no admissible lower-center floor quad.",
      product: null,
    };
  }

  const product: AfcV2FullyTiledFloorProduct = Object.freeze({
    status: "authoritative_floor",
    productVersion: AFC_V2_FULLY_TILED_FLOOR_PRODUCT_VERSION,
    attemptId: input.attemptId,
    resultId: prepared.resultId,
    labLoadGeneration: input.loadGeneration,
    originalBasis: prepared.original.basis,
    emptyBasis: prepared.empty.basis,
    floorObservationSource: Object.freeze({
      kind: "FULLY_TILED",
      imageIdentity: generation.identity,
      generationId: generation.provenance.generationId,
      generatedFrom: "ORIGINAL",
      parentOriginalSha256: generation.provenance.parentOriginalSha256,
      readerVersion: reader.readerVersion,
      readerInput: Object.freeze({
        identity: readerInput.identity,
        crop: readerInput.crop,
      }),
      authoritativeQuadSourceNormalized: polygon,
      transferToOriginal:
        "aspect_compatible_source_normalized_not_pixel_verified",
    }),
    metric: Object.freeze({
      metricScaleAuthority: "provisional_reference_depth",
      referenceDepthM: input.referenceDepthM,
    }),
    readerDiagnostics: Object.freeze({
      core: reader.authoritativeCore,
      selectedComponentTileCount: reader.selectedComponentTileCount,
      rawQuadrilateralCount: reader.rawQuadrilateralCount,
      deduplicatedCellCount: reader.deduplicatedCellCount,
      reprojectionMeanPx: reader.reprojectionMeanPx,
      reprojectionMaxPx: reader.reprojectionMaxPx,
    }),
  });

  const settle = settleAfcFixedSeamCalibrationWithRatioExtension({
    sourceNormalizedPolygon: polygon,
    sourceImageSize: {
      width: prepared.original.basis.decodedWidth,
      height: prepared.original.basis.decodedHeight,
    },
    frameSize: input.frame,
    referenceDepthM: input.referenceDepthM,
  });
  if (!settle.ok || !settle.applyObservability.available) {
    return {
      status: "failed",
      reason: settle.ok
        ? "AFC settle is not Apply-safe."
        : `AFC settle failed closed: ${settle.reason}.`,
      product,
    };
  }

  const floorAuthorityKey = buildDurableSourceFloorAuthorityKey(polygon);
  const pending = {
    token: 1,
    floorAuthorityKey,
    basisFingerprint: prepared.original.basis.sha256,
    decodedWidth: prepared.original.basis.decodedWidth,
    decodedHeight: prepared.original.basis.decodedHeight,
    worldWidthM: settle.worldWidthM,
    worldDepthM: settle.worldDepthM,
    verticalFovDeg: settle.verticalFovDeg,
    frameWidth: input.frame.width,
    frameHeight: input.frame.height,
  } as const;
  const transaction = validatePendingAfcLabCameraApply(pending, {
    currentToken: pending.token,
    floorAuthorityKey,
    basis: {
      basisFingerprint: pending.basisFingerprint,
      decodedWidth: pending.decodedWidth,
      decodedHeight: pending.decodedHeight,
    },
    worldWidthM: pending.worldWidthM,
    worldDepthM: pending.worldDepthM,
    verticalFovDeg: pending.verticalFovDeg,
    frameWidth: pending.frameWidth,
    frameHeight: pending.frameHeight,
    isCalibratedCameraActive: false,
  });
  if (!transaction.valid) {
    return { status: "failed", reason: transaction.reason, product };
  }

  const solved = evaluateQuadSolvability({
    quadNorm: [...polygon],
    frameSize: input.frame,
    floorDimensions: {
      worldWidth: settle.worldWidthM,
      worldDepth: settle.worldDepthM,
    },
    currentVerticalFovDeg: settle.verticalFovDeg,
    fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
  });
  const candidate = solved.applyCandidate;
  if (!candidate || !solved.applyEvaluation.available) {
    return {
      status: "failed",
      reason:
        `AFC camera Apply failed closed: ${solved.applyEvaluation.reason}.`,
      product,
    };
  }

  const now = dependencies.now ?? (() => new Date());
  const snapshot: AppliedCalibratedCameraSnapshot = {
    pose: candidate.pose,
    fovDeg: settle.verticalFovDeg,
    frameSize: input.frame,
    diagnosticsSummary:
      `cv avg=${candidate.cvAvgPx} max=${candidate.cvMaxPx} scale=${candidate.scaleRatio}`,
    appliedAtIso: now().toISOString(),
    imageBasis: originalBasis(input, prepared.original.basis),
    sourceFloorPolygon: polygon,
  };
  const freeze = await freezeFullyTiledCamera({
    snapshot,
    product,
    floorAuthorityKey,
    pending,
    settle,
    candidate,
    candidateAvailable: solved.applyEvaluation.available,
    frozenAtIso: now().toISOString(),
  });
  if (!freeze.ok) {
    return {
      status: "failed",
      reason: `AFC camera freeze failed closed: ${freeze.reason}.`,
      product,
    };
  }
  const restore = evaluateCalibratedCameraIdentityRestore({
    authority: freeze.authority,
    currentImageBasis: snapshot.imageBasis,
    currentFrameSize: snapshot.frameSize,
    currentSourceFloorPolygon: snapshot.sourceFloorPolygon,
    currentFloorMapping: {
      worldWidth: settle.worldWidthM,
      worldDepth: settle.worldDepthM,
    },
    currentFovDeg: snapshot.fovDeg,
    freshCandidatePose: candidate.pose,
  });
  if (!restore.ok) {
    return {
      status: "failed",
      reason: `AFC camera restore identity failed closed: ${restore.reason}.`,
      product,
    };
  }

  return {
    status: "applied",
    product,
    floor: Object.freeze({
      authorityKey: floorAuthorityKey,
      sourceNormalizedPolygon: polygon,
      worldWidthM: settle.worldWidthM,
      referenceDepthM: settle.referenceDepthM,
      widthDepthRatio: settle.widthDepthRatio,
    }),
    camera: Object.freeze({
      applied: true,
      verticalFovDeg: snapshot.fovDeg,
      pose: snapshot.pose,
      frame: snapshot.frameSize,
      originalBasisRestored: true,
    }),
    analysisMode: dependencies.analysisMode ?? "live",
    freezeReceipt: freeze.receipt,
  };
}
