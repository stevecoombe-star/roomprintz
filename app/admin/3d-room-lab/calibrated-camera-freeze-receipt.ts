import {
  parseCalibratedCameraAppliedAuthority,
  type AuthorityCameraPose,
  type AuthorityFloorPolygon,
  type AuthorityFrameSize,
  type CalibratedCameraAppliedAuthority,
  type ParsedCalibratedCameraAppliedAuthority,
} from "./calibrated-camera-applied-authority";
import { FLOOR_SOURCE_COORDINATE_EXTENT } from "./floor-coordinate-extent";
import {
  canonicalStringify,
  sha256Hex,
  type Json,
} from "../../../lib/sceneHash";

export const CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION =
  "afc-sr1-calibrated-camera-freeze-receipt/v1" as const;
export const CALIBRATED_CAMERA_FREEZE_CANONICALIZATION =
  "roomprintz-canonical-json-sort-keys/v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type CalibratedCameraFreezeImageIdentity = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;

export type CalibratedCameraFreezeReceiptPayload = Readonly<{
  frozenAtIso: string;
  authority: CalibratedCameraAppliedAuthority;
  original: CalibratedCameraFreezeImageIdentity &
    Readonly<{ basisKind: "original" }>;
  empty: CalibratedCameraFreezeImageIdentity;
  afc: Readonly<{
    productVersion: "afc-sr1-complete-product-attempt/v2";
    attemptId: string;
    resultId: string;
    labLoadGeneration: number;
    geometryMode: "tiled-perspective-core";
    geometryAuthority: "tiled_perspective_reader";
    perspectiveAuthority: "tiled_perspective_core";
    metricScaleAuthority: "provisional_reference_depth";
    referenceDepthM: number;
    acceptedReferenceDepthEvidence: Readonly<{
      kind: "afc-live-metric-reference-depth";
      referenceDepthM: number;
    }>;
    tiled: Readonly<{
      image: CalibratedCameraFreezeImageIdentity;
      readerVersion: "afc-sr1-tiled-perspective-reader/s1";
      lineageDigest: string;
      transfer: "identity_source_normalized";
      originalCompatibilityTier:
        | "exact_grid_compatible"
        | "aspect_compatible_rescaled";
      readerSourceFloorQuad: AuthorityFloorPolygon;
      acceptanceBasis: Readonly<{
        basisFingerprint: string;
        decodedWidth: number;
        decodedHeight: number;
        orientation: 1;
        transferKind:
          | "paired_cross_role_exact_grid"
          | "paired_cross_role_aspect_rescaled";
        transferProvenance: string;
      }>;
      perspectiveAdjustment: Readonly<{
        mode: "tiled_symmetric_near_edge_v1";
        committedDelta: number;
        adjustmentCount: number;
      }> | null;
    }>;
  }>;
  acceptedCalibration: Readonly<{
    sourceFloorPolygon: AuthorityFloorPolygon;
    worldWidth: number;
    worldDepth: number;
    verticalFovDeg: number;
    applyFrame: AuthorityFrameSize;
    appliedPose: AuthorityCameraPose;
  }>;
  applyEvidence: Readonly<{
    transaction: Readonly<{
      validation: "passed";
      token: number;
      floorAuthorityKey: string;
      committedWorldWidth: number;
      committedWorldDepth: number;
      committedVerticalFovDeg: number;
      rendererFrame: AuthorityFrameSize;
    }>;
    ratioFovSettle: Readonly<{
      applySafe: true;
      winningCellId: string;
      widthDepthRatio: number;
      referenceDepthM: number;
      worldWidthM: number;
      worldDepthM: number;
      verticalFovDeg: number;
      evaluatedCellCount: number;
      applySafeCellCount: number;
      observability: Readonly<{
        available: true;
        firstFailingGate: "none";
        reason: string;
        displayAvgPx: number;
        displayMaxPx: number;
        averageDeltaPx: number;
        maximumDeltaPx: number;
      }>;
    }>;
    freshCandidateValidation: Readonly<{
      basisQualified: true;
      available: true;
      firstFailingGate: "none";
      reason: string;
      confidence: "high";
      cvAvgPx: number;
      cvMaxPx: number;
      displayAvgPx: number;
      displayMaxPx: number;
      averageDeltaPx: number;
      maximumDeltaPx: number;
      scaleRatio: number;
      frameSize: AuthorityFrameSize;
    }>;
    cameraApply: Readonly<{
      writer: "applyCalibratedCameraSnapshotFromCandidate";
      succeeded: true;
      labState: "applied";
      imageBasisQualified: true;
      imageBasisKind: "original";
      snapshotFrameMatchedRenderer: true;
      capturedBeforeSubsequentMutation: true;
    }>;
  }>;
}>;

export type CalibratedCameraFreezeReceipt = Readonly<{
  receiptVersion: typeof CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION;
  payload: CalibratedCameraFreezeReceiptPayload;
  integrity: Readonly<{
    algorithm: "sha256";
    canonicalization: typeof CALIBRATED_CAMERA_FREEZE_CANONICALIZATION;
    payloadSha256: string;
  }>;
}>;

declare const parsedReceiptBrand: unique symbol;
export type ParsedCalibratedCameraFreezeReceipt =
  CalibratedCameraFreezeReceipt & {
    readonly payload: Omit<
      CalibratedCameraFreezeReceiptPayload,
      "authority"
    > & {
      readonly authority: ParsedCalibratedCameraAppliedAuthority;
    };
    readonly [parsedReceiptBrand]: true;
  };

export type CalibratedCameraFreezeReceiptFailureReason =
  | "receipt_not_object"
  | "receipt_version"
  | "payload_invalid"
  | "frozen_at_iso"
  | "camera_authority"
  | "original_identity"
  | "original_authority_mismatch"
  | "empty_identity"
  | "tiled_provenance"
  | "accepted_calibration_mismatch"
  | "apply_evidence"
  | "integrity"
  | "checksum"
  | "expected_original_mismatch"
  | "expected_empty_mismatch"
  | "expected_tiled_mismatch";

export type CalibratedCameraFreezeReceiptResult =
  | { ok: true; value: ParsedCalibratedCameraFreezeReceipt }
  | {
      ok: false;
      reason: CalibratedCameraFreezeReceiptFailureReason;
      detail: string;
    };

export type CalibratedCameraFreezeExpectedBindings = Readonly<{
  original?: CalibratedCameraFreezeImageIdentity;
  empty?: CalibratedCameraFreezeImageIdentity;
  tiled?: CalibratedCameraFreezeImageIdentity;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function strictIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  );
}

function parseImageIdentity(
  value: unknown
): CalibratedCameraFreezeImageIdentity | null {
  if (
    !isRecord(value) ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    !Number.isInteger(value.decodedWidth) ||
    !Number.isInteger(value.decodedHeight) ||
    (value.decodedWidth as number) <= 0 ||
    (value.decodedHeight as number) <= 0 ||
    value.orientation !== 1
  ) {
    return null;
  }
  return {
    sha256: value.sha256,
    decodedWidth: value.decodedWidth as number,
    decodedHeight: value.decodedHeight as number,
    orientation: 1,
  };
}

function imageIdentityEquals(
  left: CalibratedCameraFreezeImageIdentity,
  right: CalibratedCameraFreezeImageIdentity
): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.orientation === right.orientation
  );
}

function polygonEquals(
  left: readonly { x: number; y: number }[],
  right: readonly { x: number; y: number }[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        point.x === right[index].x && point.y === right[index].y
    )
  );
}

function poseEquals(
  left: AuthorityCameraPose,
  right: AuthorityCameraPose
): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.position.z === right.position.z &&
    left.lookAt.x === right.lookAt.x &&
    left.lookAt.y === right.lookAt.y &&
    left.lookAt.z === right.lookAt.z &&
    left.up.x === right.up.x &&
    left.up.y === right.up.y &&
    left.up.z === right.up.z
  );
}

function frameEquals(
  left: AuthorityFrameSize,
  right: AuthorityFrameSize
): boolean {
  return left.width === right.width && left.height === right.height;
}

function clonePolygon(
  value: readonly { x: number; y: number }[]
): AuthorityFloorPolygon {
  return value.map((point) => ({
    x: point.x,
    y: point.y,
  })) as unknown as AuthorityFloorPolygon;
}

function clonePose(value: AuthorityCameraPose): AuthorityCameraPose {
  return {
    position: { ...value.position },
    lookAt: { ...value.lookAt },
    up: { ...value.up },
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function canonicalPayload(
  receiptVersion: typeof CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
  payload: CalibratedCameraFreezeReceiptPayload
): string {
  return canonicalStringify({
    receiptVersion,
    payload,
  } as unknown as Json);
}

function fail(
  reason: CalibratedCameraFreezeReceiptFailureReason,
  detail: string
): CalibratedCameraFreezeReceiptResult {
  return { ok: false, reason, detail };
}

function parsePayload(
  raw: unknown
): CalibratedCameraFreezeReceiptResult | {
  payload: CalibratedCameraFreezeReceiptPayload;
} {
  if (!isRecord(raw)) return fail("payload_invalid", "Payload must be an object.");
  if (!strictIso(raw.frozenAtIso)) {
    return fail("frozen_at_iso", "Freeze timestamp is not strict UTC ISO milliseconds.");
  }
  const parsedAuthority = parseCalibratedCameraAppliedAuthority(
    raw.authority,
    FLOOR_SOURCE_COORDINATE_EXTENT
  );
  if (!parsedAuthority.ok) {
    return fail(
      "camera_authority",
      `Applied camera authority rejected: ${parsedAuthority.reason}.`
    );
  }
  const original = parseImageIdentity(raw.original);
  if (
    !original ||
    !isRecord(raw.original) ||
    raw.original.basisKind !== "original"
  ) {
    return fail("original_identity", "Original identity is invalid.");
  }
  if (
    parsedAuthority.value.imageBasis.basisKind !== "original" ||
    parsedAuthority.value.imageBasis.basisFingerprint !== original.sha256 ||
    parsedAuthority.value.imageBasis.decodedWidth !== original.decodedWidth ||
    parsedAuthority.value.imageBasis.decodedHeight !== original.decodedHeight ||
    parsedAuthority.value.imageBasis.encodedOrientation !== original.orientation
  ) {
    return fail(
      "original_authority_mismatch",
      "Original identity does not match the applied camera image basis."
    );
  }
  const empty = parseImageIdentity(raw.empty);
  if (!empty) return fail("empty_identity", "EMPTY identity is invalid.");

  if (!isRecord(raw.afc) || !isRecord(raw.afc.tiled)) {
    return fail("tiled_provenance", "TILED AFC provenance is missing.");
  }
  const afc = raw.afc;
  const tiled = afc.tiled as Record<string, unknown>;
  const tiledImage = parseImageIdentity(tiled.image);
  const readerQuadAuthority = parseCalibratedCameraAppliedAuthority({
    ...parsedAuthority.value,
    sourceFloorPolygon: tiled.readerSourceFloorQuad,
  }, FLOOR_SOURCE_COORDINATE_EXTENT);
  const acceptanceBasis = isRecord(tiled.acceptanceBasis)
    ? tiled.acceptanceBasis
    : null;
  const adjustment = tiled.perspectiveAdjustment;
  const adjustmentValid =
    adjustment === null ||
    (isRecord(adjustment) &&
      adjustment.mode === "tiled_symmetric_near_edge_v1" &&
      finite(adjustment.committedDelta) &&
      Number.isInteger(adjustment.adjustmentCount) &&
      (adjustment.adjustmentCount as number) >= 0);
  if (
    afc.productVersion !== "afc-sr1-complete-product-attempt/v2" ||
    !nonEmptyString(afc.attemptId) ||
    !nonEmptyString(afc.resultId) ||
    !Number.isInteger(afc.labLoadGeneration) ||
    (afc.labLoadGeneration as number) < 0 ||
    afc.geometryMode !== "tiled-perspective-core" ||
    afc.geometryAuthority !== "tiled_perspective_reader" ||
    afc.perspectiveAuthority !== "tiled_perspective_core" ||
    afc.metricScaleAuthority !== "provisional_reference_depth" ||
    !finite(afc.referenceDepthM) ||
    afc.referenceDepthM <= 0 ||
    !isRecord(afc.acceptedReferenceDepthEvidence) ||
    afc.acceptedReferenceDepthEvidence.kind !==
      "afc-live-metric-reference-depth" ||
    afc.acceptedReferenceDepthEvidence.referenceDepthM !==
      afc.referenceDepthM ||
    !tiledImage ||
    tiled.readerVersion !== "afc-sr1-tiled-perspective-reader/s1" ||
    typeof tiled.lineageDigest !== "string" ||
    !SHA256_PATTERN.test(tiled.lineageDigest) ||
    tiled.transfer !== "identity_source_normalized" ||
    (tiled.originalCompatibilityTier !== "exact_grid_compatible" &&
      tiled.originalCompatibilityTier !==
        "aspect_compatible_rescaled") ||
    !readerQuadAuthority.ok ||
    !acceptanceBasis ||
    !nonEmptyString(acceptanceBasis.basisFingerprint) ||
    !Number.isInteger(acceptanceBasis.decodedWidth) ||
    !Number.isInteger(acceptanceBasis.decodedHeight) ||
    (acceptanceBasis.decodedWidth as number) <= 0 ||
    (acceptanceBasis.decodedHeight as number) <= 0 ||
    acceptanceBasis.orientation !== 1 ||
    (acceptanceBasis.transferKind !==
      "paired_cross_role_exact_grid" &&
      acceptanceBasis.transferKind !==
        "paired_cross_role_aspect_rescaled") ||
    !nonEmptyString(acceptanceBasis.transferProvenance) ||
    !adjustmentValid
  ) {
    return fail("tiled_provenance", "TILED AFC provenance is invalid.");
  }

  const accepted = isRecord(raw.acceptedCalibration)
    ? raw.acceptedCalibration
    : null;
  const acceptedAuthority = accepted
    ? parseCalibratedCameraAppliedAuthority({
        ...parsedAuthority.value,
        sourceFloorPolygon: accepted.sourceFloorPolygon,
        floorMapping: {
          worldWidth: accepted.worldWidth,
          worldDepth: accepted.worldDepth,
        },
        verticalFovDeg: accepted.verticalFovDeg,
        frameSize: accepted.applyFrame,
        pose: accepted.appliedPose,
      }, FLOOR_SOURCE_COORDINATE_EXTENT)
    : null;
  if (
    !accepted ||
    !acceptedAuthority?.ok ||
    !polygonEquals(
      acceptedAuthority.value.sourceFloorPolygon,
      parsedAuthority.value.sourceFloorPolygon
    ) ||
    acceptedAuthority.value.floorMapping.worldWidth !==
      parsedAuthority.value.floorMapping.worldWidth ||
    acceptedAuthority.value.floorMapping.worldDepth !==
      parsedAuthority.value.floorMapping.worldDepth ||
    acceptedAuthority.value.verticalFovDeg !==
      parsedAuthority.value.verticalFovDeg ||
    !frameEquals(
      acceptedAuthority.value.frameSize,
      parsedAuthority.value.frameSize
    ) ||
    !poseEquals(
      acceptedAuthority.value.pose,
      parsedAuthority.value.pose
    )
  ) {
    return fail(
      "accepted_calibration_mismatch",
      "Accepted calibration does not exactly match applied authority."
    );
  }

  const evidence = isRecord(raw.applyEvidence)
    ? raw.applyEvidence
    : null;
  const transaction =
    evidence && isRecord(evidence.transaction)
      ? evidence.transaction
      : null;
  const settle =
    evidence && isRecord(evidence.ratioFovSettle)
      ? evidence.ratioFovSettle
      : null;
  const observability =
    settle && isRecord(settle.observability)
      ? settle.observability
      : null;
  const candidate =
    evidence && isRecord(evidence.freshCandidateValidation)
      ? evidence.freshCandidateValidation
      : null;
  const cameraApply =
    evidence && isRecord(evidence.cameraApply)
      ? evidence.cameraApply
      : null;
  const candidateFrame =
    candidate && isRecord(candidate.frameSize)
      ? candidate.frameSize
      : null;
  const rendererFrame =
    transaction && isRecord(transaction.rendererFrame)
      ? transaction.rendererFrame
      : null;
  const finiteEvidence = [
    transaction?.committedWorldWidth,
    transaction?.committedWorldDepth,
    transaction?.committedVerticalFovDeg,
    settle?.widthDepthRatio,
    settle?.referenceDepthM,
    settle?.worldWidthM,
    settle?.worldDepthM,
    settle?.verticalFovDeg,
    observability?.displayAvgPx,
    observability?.displayMaxPx,
    observability?.averageDeltaPx,
    observability?.maximumDeltaPx,
    candidate?.cvAvgPx,
    candidate?.cvMaxPx,
    candidate?.displayAvgPx,
    candidate?.displayMaxPx,
    candidate?.averageDeltaPx,
    candidate?.maximumDeltaPx,
    candidate?.scaleRatio,
  ].every(finite);
  if (
    !transaction ||
    transaction.validation !== "passed" ||
    !Number.isInteger(transaction.token) ||
    (transaction.token as number) <= 0 ||
    !nonEmptyString(transaction.floorAuthorityKey) ||
    !rendererFrame ||
    !finite(rendererFrame.width) ||
    !finite(rendererFrame.height) ||
    !settle ||
    settle.applySafe !== true ||
    !nonEmptyString(settle.winningCellId) ||
    !Number.isInteger(settle.evaluatedCellCount) ||
    !Number.isInteger(settle.applySafeCellCount) ||
    (settle.applySafeCellCount as number) <= 0 ||
    !observability ||
    observability.available !== true ||
    observability.firstFailingGate !== "none" ||
    !nonEmptyString(observability.reason) ||
    !candidate ||
    candidate.basisQualified !== true ||
    candidate.available !== true ||
    candidate.firstFailingGate !== "none" ||
    !nonEmptyString(candidate.reason) ||
    candidate.confidence !== "high" ||
    !candidateFrame ||
    !finite(candidateFrame.width) ||
    !finite(candidateFrame.height) ||
    !cameraApply ||
    cameraApply.writer !==
      "applyCalibratedCameraSnapshotFromCandidate" ||
    cameraApply.succeeded !== true ||
    cameraApply.labState !== "applied" ||
    cameraApply.imageBasisQualified !== true ||
    cameraApply.imageBasisKind !== "original" ||
    cameraApply.snapshotFrameMatchedRenderer !== true ||
    cameraApply.capturedBeforeSubsequentMutation !== true ||
    !finiteEvidence ||
    transaction.committedWorldWidth !==
      parsedAuthority.value.floorMapping.worldWidth ||
    transaction.committedWorldDepth !==
      parsedAuthority.value.floorMapping.worldDepth ||
    transaction.committedVerticalFovDeg !==
      parsedAuthority.value.verticalFovDeg ||
    !frameEquals(
      rendererFrame as AuthorityFrameSize,
      parsedAuthority.value.frameSize
    ) ||
    settle.referenceDepthM !== afc.referenceDepthM ||
    settle.worldWidthM !==
      parsedAuthority.value.floorMapping.worldWidth ||
    settle.worldDepthM !==
      parsedAuthority.value.floorMapping.worldDepth ||
    settle.verticalFovDeg !== parsedAuthority.value.verticalFovDeg ||
    !frameEquals(
      candidateFrame as AuthorityFrameSize,
      parsedAuthority.value.frameSize
    )
  ) {
    return fail(
      "apply_evidence",
      "Structured apply evidence is invalid or contradicts applied authority."
    );
  }

  return {
    payload: {
      frozenAtIso: raw.frozenAtIso,
      authority: parsedAuthority.value,
      original: { ...original, basisKind: "original" },
      empty,
      afc: {
        productVersion: "afc-sr1-complete-product-attempt/v2",
        attemptId: afc.attemptId,
        resultId: afc.resultId,
        labLoadGeneration: afc.labLoadGeneration as number,
        geometryMode: "tiled-perspective-core",
        geometryAuthority: "tiled_perspective_reader",
        perspectiveAuthority: "tiled_perspective_core",
        metricScaleAuthority: "provisional_reference_depth",
        referenceDepthM: afc.referenceDepthM,
        acceptedReferenceDepthEvidence: {
          kind: "afc-live-metric-reference-depth",
          referenceDepthM: afc.referenceDepthM,
        },
        tiled: {
          image: tiledImage,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1",
          lineageDigest: tiled.lineageDigest as string,
          transfer: "identity_source_normalized",
          originalCompatibilityTier:
            tiled.originalCompatibilityTier as
              | "exact_grid_compatible"
              | "aspect_compatible_rescaled",
          readerSourceFloorQuad:
            readerQuadAuthority.value.sourceFloorPolygon,
          acceptanceBasis: {
            basisFingerprint: acceptanceBasis.basisFingerprint,
            decodedWidth: acceptanceBasis.decodedWidth as number,
            decodedHeight: acceptanceBasis.decodedHeight as number,
            orientation: 1,
            transferKind: acceptanceBasis.transferKind,
            transferProvenance: acceptanceBasis.transferProvenance,
          },
          perspectiveAdjustment:
            adjustment === null
              ? null
              : {
                  mode: "tiled_symmetric_near_edge_v1",
                  committedDelta: adjustment.committedDelta as number,
                  adjustmentCount:
                    adjustment.adjustmentCount as number,
                },
        },
      },
      acceptedCalibration: {
        sourceFloorPolygon: clonePolygon(
          parsedAuthority.value.sourceFloorPolygon
        ),
        worldWidth:
          parsedAuthority.value.floorMapping.worldWidth,
        worldDepth:
          parsedAuthority.value.floorMapping.worldDepth,
        verticalFovDeg: parsedAuthority.value.verticalFovDeg,
        applyFrame: { ...parsedAuthority.value.frameSize },
        appliedPose: clonePose(parsedAuthority.value.pose),
      },
      applyEvidence: structuredClone(raw.applyEvidence) as
        CalibratedCameraFreezeReceiptPayload["applyEvidence"],
    },
  };
}

export async function createCalibratedCameraFreezeReceipt(
  payloadInput: CalibratedCameraFreezeReceiptPayload
): Promise<CalibratedCameraFreezeReceiptResult> {
  // Parse/copy before the first await so live React objects cannot mutate while
  // Web Crypto computes the checksum.
  const parsed = parsePayload(structuredClone(payloadInput));
  if ("ok" in parsed) return parsed;
  const payload = deepFreeze(parsed.payload) as
    CalibratedCameraFreezeReceiptPayload;
  const payloadSha256 = await sha256Hex(
    canonicalPayload(
      CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
      payload
    )
  );
  return {
    ok: true,
    value: deepFreeze({
      receiptVersion: CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
      payload,
      integrity: {
        algorithm: "sha256",
        canonicalization:
          CALIBRATED_CAMERA_FREEZE_CANONICALIZATION,
        payloadSha256,
      },
    }) as ParsedCalibratedCameraFreezeReceipt,
  };
}

export async function parseCalibratedCameraFreezeReceipt(
  raw: unknown,
  expected: CalibratedCameraFreezeExpectedBindings = {}
): Promise<CalibratedCameraFreezeReceiptResult> {
  if (!isRecord(raw)) {
    return fail("receipt_not_object", "Receipt must be an object.");
  }
  if (
    raw.receiptVersion !==
    CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION
  ) {
    return fail("receipt_version", "Receipt version is not supported.");
  }
  const parsed = parsePayload(raw.payload);
  if ("ok" in parsed) return parsed;
  if (
    !isRecord(raw.integrity) ||
    raw.integrity.algorithm !== "sha256" ||
    raw.integrity.canonicalization !==
      CALIBRATED_CAMERA_FREEZE_CANONICALIZATION ||
    typeof raw.integrity.payloadSha256 !== "string" ||
    !SHA256_PATTERN.test(raw.integrity.payloadSha256)
  ) {
    return fail("integrity", "Receipt integrity metadata is invalid.");
  }
  const actualChecksum = await sha256Hex(
    canonicalPayload(
      CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
      parsed.payload
    )
  );
  if (actualChecksum !== raw.integrity.payloadSha256) {
    return fail("checksum", "Receipt payload checksum does not match.");
  }
  if (
    expected.original &&
    !imageIdentityEquals(expected.original, parsed.payload.original)
  ) {
    return fail(
      "expected_original_mismatch",
      "Receipt Original identity does not match the expected input."
    );
  }
  if (
    expected.empty &&
    !imageIdentityEquals(expected.empty, parsed.payload.empty)
  ) {
    return fail(
      "expected_empty_mismatch",
      "Receipt EMPTY identity does not match the expected input."
    );
  }
  if (
    expected.tiled &&
    !imageIdentityEquals(
      expected.tiled,
      parsed.payload.afc.tiled.image
    )
  ) {
    return fail(
      "expected_tiled_mismatch",
      "Receipt TILED identity does not match the expected input."
    );
  }
  return {
    ok: true,
    value: deepFreeze({
      receiptVersion: CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
      payload: parsed.payload,
      integrity: {
        algorithm: "sha256",
        canonicalization:
          CALIBRATED_CAMERA_FREEZE_CANONICALIZATION,
        payloadSha256: actualChecksum,
      },
    }) as ParsedCalibratedCameraFreezeReceipt,
  };
}

export function serializeCalibratedCameraFreezeReceipt(
  receipt: CalibratedCameraFreezeReceipt
): string {
  return canonicalStringify(receipt as unknown as Json);
}

export function extractCalibratedCameraAppliedAuthority(
  receipt: ParsedCalibratedCameraFreezeReceipt
): ParsedCalibratedCameraAppliedAuthority {
  return receipt.payload.authority;
}

export function buildCalibratedCameraFreezeReceiptFilename(
  receipt: CalibratedCameraFreezeReceipt
): string {
  const stableInputIdentity = receipt.payload.original.sha256.slice(0, 16);
  return `afc-sr1-${stableInputIdentity}-calibrated-camera-authority.v1.json`;
}
