import "server-only";

import { createHash } from "node:crypto";

import { callCompositorAfcSr1TileFloorReader } from "@/lib/callCompositorAfcSr1TileFloorReader";

import {
  deriveAfcSr1FloorVanishingLineCrossRoom,
  type AfcSr1FloorVanishingLineCrossRoomResultV1,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import type { AfcSr1CrossRoomTruncatedAnchorV1 } from "./afc-sr1-cross-room-prior";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";

export const AFC_SR1_TR2_RESEARCH_PROFILE = "afc-sr1-tr2-tile-floor-reader/v1" as const;
export const AFC_SR1_TR2_POLICY_VERSION = "afc-sr1-ts2-extractor-policy/v1" as const;
export const AFC_SR1_TR2_RESULT_SCHEMA_VERSION =
  "afc-sr1-tr2-tile-floor-reader-result/v1" as const;
export const AFC_SR1_TR2_READER_TIMEOUT_MS = 15_000;

type ImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number | null;
  decodedHeight: number | null;
}>;
type RoiIdentity = Readonly<{
  coordinateSpace: "source-normalized/v1";
  polygon: readonly (readonly [number, number])[];
  roiDigest: string;
}>;
type RuntimeIdentity = Readonly<{
  readerModuleVersion: string;
  opencvVersion: string;
  numpyVersion: string;
}>;
type PixelLine = Readonly<{ a: number; b: number; c: number }>;

export type AfcSr1Tr2ReaderReceipt =
  | Readonly<{
      schemaVersion: typeof AFC_SR1_TR2_RESULT_SCHEMA_VERSION;
      researchProfile: typeof AFC_SR1_TR2_RESEARCH_PROFILE;
      policyVersion: typeof AFC_SR1_TR2_POLICY_VERSION;
      status: "usable";
      imageIdentity: ImageIdentity;
      roiIdentity: RoiIdentity;
      runtimeIdentity: RuntimeIdentity;
      floorVanishingLinePixel: PixelLine;
      diagnostics: unknown;
      evidenceCanonicalJson: string;
      evidenceDigest: Readonly<{ algorithm: "sha256"; encoding: "hex"; value: string }>;
      elapsedMs: number;
    }>
  | Readonly<{
      schemaVersion: typeof AFC_SR1_TR2_RESULT_SCHEMA_VERSION;
      researchProfile: typeof AFC_SR1_TR2_RESEARCH_PROFILE;
      policyVersion: typeof AFC_SR1_TR2_POLICY_VERSION;
      status: "rejected";
      reason: string;
      imageIdentity: ImageIdentity;
      roiIdentity: RoiIdentity;
      runtimeIdentity: RuntimeIdentity;
      diagnostics: unknown;
      evidenceCanonicalJson: string;
      evidenceDigest: Readonly<{ algorithm: "sha256"; encoding: "hex"; value: string }>;
      elapsedMs: number;
    }>;

type ExpectedImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth?: number;
  decodedHeight?: number;
}>;

export type AfcSr1Tr2ExecutionInput = Readonly<{
  tiledImageBytes: Uint8Array;
  roi: Readonly<{
    coordinateSpace: "source-normalized/v1";
    polygon: readonly (readonly [number, number])[];
  }>;
  expectedImageIdentity?: ExpectedImageIdentity;
  sourcePolygon?: AfcSr1SourcePolygon;
  truncatedAnchor?: AfcSr1CrossRoomTruncatedAnchorV1;
}>;

export type AfcSr1Tr2ExecutionResult = Readonly<{
  readerExecution: AfcSr1Tr2ReaderReceipt;
  projectiveHandoff: AfcSr1FloorVanishingLineCrossRoomResultV1 | null;
}>;

type CompositorCaller = typeof callCompositorAfcSr1TileFloorReader;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validImageIdentity(value: unknown): value is ImageIdentity {
  const positiveInteger = (candidate: unknown): candidate is number =>
    typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0;
  return isRecord(value) &&
    isSha256(value.sha256) &&
    typeof value.byteCount === "number" && Number.isInteger(value.byteCount) && value.byteCount >= 0 &&
    (value.decodedWidth === null || positiveInteger(value.decodedWidth)) &&
    (value.decodedHeight === null || positiveInteger(value.decodedHeight));
}

function validRoiIdentity(value: unknown): value is RoiIdentity {
  return isRecord(value) &&
    value.coordinateSpace === "source-normalized/v1" &&
    Array.isArray(value.polygon) &&
    isSha256(value.roiDigest);
}

function validRuntimeIdentity(value: unknown): value is RuntimeIdentity {
  return isRecord(value) &&
    ["readerModuleVersion", "opencvVersion", "numpyVersion"].every(
      (key) => typeof value[key] === "string" && value[key].length > 0
    );
}

function validPixelLine(value: unknown): value is PixelLine {
  return isRecord(value) && finiteNumber(value.a) && finiteNumber(value.b) && finiteNumber(value.c);
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((entry, index) => equalJson(entry, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord).sort();
    return keys.length === Object.keys(rightRecord).length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        equalJson(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function receiptDiagnosticSubset(diagnostics: unknown): Record<string, unknown> {
  const root = isRecord(diagnostics) ? diagnostics : {};
  const counts = isRecord(root.segmentCounts) ? root.segmentCounts : {};
  const first = isRecord(root.firstFamily) ? root.firstFamily : {};
  const second = isRecord(root.secondFamily) ? root.secondFamily : {};
  const stability = isRecord(root.stability) ? root.stability : {};
  return {
    rawSegmentCount: counts.raw ?? null,
    admittedAllNineInsideCount: counts.admittedAllNineInside ?? null,
    familySupportCounts: [first.support_count ?? null, second.support_count ?? null],
    familyMedianResidualsPx: [first.median_residual_px ?? null, second.median_residual_px ?? null],
    familyP90ResidualsPx: [first.p90_residual_px ?? null, second.p90_residual_px ?? null],
    stabilityMaxProbeDistancePx: stability.max_split_vs_full_probe_distance_px ?? null,
    hypothesisStrategies: [first.hypothesis_strategy ?? null, second.hypothesis_strategy ?? null],
  };
}

function expectedBytesIdentity(bytes: Uint8Array): Pick<ImageIdentity, "sha256" | "byteCount"> {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteCount: bytes.byteLength,
  };
}

function assertExpectedImageIdentity(
  actual: ImageIdentity,
  expected: ExpectedImageIdentity | undefined,
  bytes: Uint8Array
): void {
  const actualBytes = expectedBytesIdentity(bytes);
  if (actual.sha256 !== actualBytes.sha256 || actual.byteCount !== actualBytes.byteCount) {
    throw new Error("TR2 receipt image identity does not match supplied tiled bytes.");
  }
  if (!expected) return;
  if (actual.sha256 !== expected.sha256 || actual.byteCount !== expected.byteCount ||
      (expected.decodedWidth !== undefined && actual.decodedWidth !== expected.decodedWidth) ||
      (expected.decodedHeight !== undefined && actual.decodedHeight !== expected.decodedHeight)) {
    throw new Error("TR2 receipt image identity does not match caller-known identity.");
  }
}

export function validateAfcSr1Tr2ReaderReceipt(
  value: unknown,
  expected: Pick<AfcSr1Tr2ExecutionInput, "tiledImageBytes" | "roi" | "expectedImageIdentity">
): AfcSr1Tr2ReaderReceipt {
  if (!isRecord(value) ||
      value.schemaVersion !== AFC_SR1_TR2_RESULT_SCHEMA_VERSION ||
      value.researchProfile !== AFC_SR1_TR2_RESEARCH_PROFILE ||
      value.policyVersion !== AFC_SR1_TR2_POLICY_VERSION ||
      (value.status !== "usable" && value.status !== "rejected") ||
      !validImageIdentity(value.imageIdentity) ||
      !validRoiIdentity(value.roiIdentity) ||
      !validRuntimeIdentity(value.runtimeIdentity) ||
      typeof value.evidenceCanonicalJson !== "string" ||
      !isRecord(value.evidenceDigest) ||
      value.evidenceDigest.algorithm !== "sha256" ||
      value.evidenceDigest.encoding !== "hex" ||
      !isSha256(value.evidenceDigest.value) ||
      !finiteNumber(value.elapsedMs)) {
    throw new Error("TR2 receipt has an invalid schema.");
  }
  const digest = createHash("sha256").update(value.evidenceCanonicalJson, "utf8").digest("hex");
  if (digest !== value.evidenceDigest.value) throw new Error("TR2 receipt evidence digest does not match.");

  let preimage: unknown;
  try {
    preimage = JSON.parse(value.evidenceCanonicalJson);
  } catch {
    throw new Error("TR2 receipt evidence canonical JSON is invalid.");
  }
  if (!isRecord(preimage) ||
      preimage.schemaVersion !== value.schemaVersion ||
      preimage.researchProfile !== value.researchProfile ||
      preimage.policyVersion !== value.policyVersion ||
      preimage.status !== value.status ||
      !equalJson(preimage.image, value.imageIdentity) ||
      !equalJson(preimage.roi, value.roiIdentity) ||
      !equalJson(preimage.runtime, value.runtimeIdentity) ||
      !equalJson(preimage.diagnostics, receiptDiagnosticSubset(value.diagnostics))) {
    throw new Error("TR2 receipt response does not agree with its evidence preimage.");
  }
  if (value.roiIdentity.coordinateSpace !== expected.roi.coordinateSpace ||
      !equalJson(value.roiIdentity.polygon, expected.roi.polygon)) {
    throw new Error("TR2 receipt ROI identity does not match request.");
  }
  assertExpectedImageIdentity(value.imageIdentity, expected.expectedImageIdentity, expected.tiledImageBytes);

  if (value.status === "usable") {
    if (!validPixelLine(value.floorVanishingLinePixel) ||
        !equalJson(preimage.floorVanishingLinePixel, value.floorVanishingLinePixel)) {
      throw new Error("TR2 usable receipt has an invalid pixel floor vanishing line.");
    }
    return value as AfcSr1Tr2ReaderReceipt;
  }
  if (typeof value.reason !== "string" || value.reason.length === 0 || preimage.reason !== value.reason ||
      Object.prototype.hasOwnProperty.call(value, "floorVanishingLinePixel")) {
    throw new Error("TR2 rejected receipt has an invalid rejection envelope.");
  }
  return value as AfcSr1Tr2ReaderReceipt;
}

export async function executeAfcSr1TileFloorReader(
  input: AfcSr1Tr2ExecutionInput,
  dependencies: Readonly<{ callCompositor?: CompositorCaller }> = {}
): Promise<AfcSr1Tr2ExecutionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AFC_SR1_TR2_READER_TIMEOUT_MS);
  const payload = {
    researchProfile: AFC_SR1_TR2_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_POLICY_VERSION,
    imageBase64: Buffer.from(input.tiledImageBytes).toString("base64"),
    roi: input.roi,
  };
  try {
    const rawReceipt = await (dependencies.callCompositor ?? callCompositorAfcSr1TileFloorReader)({
      payload,
      signal: controller.signal,
    });
    const readerExecution = validateAfcSr1Tr2ReaderReceipt(rawReceipt, input);
    if (readerExecution.status === "rejected") {
      return Object.freeze({ readerExecution, projectiveHandoff: null });
    }
    if ((input.sourcePolygon === undefined) !== (input.truncatedAnchor === undefined)) {
      throw new Error("TR0 handoff requires both sourcePolygon and truncatedAnchor.");
    }
    if (readerExecution.imageIdentity.decodedWidth === null ||
        readerExecution.imageIdentity.decodedHeight === null) {
      throw new Error("TR2 usable receipt is missing decoded dimensions.");
    }
    const projectiveHandoff = input.sourcePolygon === undefined
      ? null
      : deriveAfcSr1FloorVanishingLineCrossRoom({
          analysisImage: {
            decodedWidth: readerExecution.imageIdentity.decodedWidth,
            decodedHeight: readerExecution.imageIdentity.decodedHeight,
          },
          floorVanishingLinePixel: readerExecution.floorVanishingLinePixel,
          sourcePolygon: input.sourcePolygon,
          truncatedAnchor: input.truncatedAnchor,
        });
    return Object.freeze({ readerExecution, projectiveHandoff });
  } finally {
    clearTimeout(timeout);
  }
}
