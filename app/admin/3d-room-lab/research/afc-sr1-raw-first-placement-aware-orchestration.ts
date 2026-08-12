import "server-only";

/**
 * PATH A orchestration: contract-valid evidence plus validator-issued,
 * process-local capabilities. Offline callers may inject trusted replay
 * receipts, but every receipt still passes its frozen canonical validator.
 */
import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  callCompositorAfcSr1TileFloorReader,
} from "@/lib/callCompositorAfcSr1TileFloorReader";
import {
  callCompositorAfcSr1Ts0ChildProjectivePlacement,
  type AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1,
  type CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs,
} from "@/lib/callCompositorAfcSr1Ts0ChildProjectivePlacement";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION,
  buildAfcSr1BasisBoundSourcePolygon,
  validateAfcSr1BasisBoundSourcePolygon,
  type AfcSr1BasisBoundSourcePolygonV1,
} from "./afc-sr1-basis-bound-source-polygon";
import {
  AFC_SR1_COMMON_BASIS_TR0_HANDOFF_VERSION,
  buildAfcSr1CommonBasisTr0Handoff,
  validateAfcSr1ValidatedCommonBasisTr0Handoff,
  type AfcSr1CommonBasisTr0HandoffResultV1,
  type AfcSr1ExplicitAnchorAuthorityV1,
} from "./afc-sr1-common-basis-tr0-handoff";
import type {
  AfcSr1CrossRoomTruncatedAnchorV1,
} from "./afc-sr1-cross-room-prior";
import {
  deriveAfcSr1FloorVanishingLineCrossRoom,
  type AfcSr1FloorVanishingLineCrossRoomResultV1,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  AFC_SR1_PLACEMENT_BOUND_TR0_HANDOFF_VERSION,
  buildAfcSr1PlacementBoundTr0Handoff,
  validateAfcSr1ValidatedPlacementBoundTr0Handoff,
  type AfcSr1PlacementBoundTr0HandoffResultV1,
} from "./afc-sr1-placement-bound-tr0-handoff";
import {
  AFC_SR1_TR2_READER_TIMEOUT_MS,
  AFC_SR1_TR2_V3_POLICY_VERSION,
  AFC_SR1_TR2_V3_RESEARCH_PROFILE,
  AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION,
  getAfcSr1ValidatedTr2UsableReaderAuthority,
  validateAfcSr1Tr2ReaderReceipt,
  type AfcSr1Tr2ExecutionInput,
} from "./afc-sr1-tile-floor-reader-execution";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  vibodeTileGridScaffoldAssist,
  type AfcSr1TileGridScaffoldArgs,
  type AfcSr1TileGridScaffoldImageIdentity,
  type AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";
import {
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
  AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
  AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
  getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority,
  validateAfcSr1Ts0ChildProjectivePlacementReceipt,
  type AfcSr1Ts0ChildProjectivePlacementReceiptV1,
  type AfcSr1Ts0LineageIdentityV1,
  type AfcSr1Ts0PlacementExpectedIdentityV1,
} from "./afc-sr1-ts0-child-projective-placement";
import {
  AFC_SR1_TS0_PARENT_CHILD_LINEAGE_EVIDENCE_VERSION,
  validateAfcSr1GeneratedTs0ParentChildLineage,
  type AfcSr1ValidatedTs0ParentChildLineageAuthorityV1,
} from "./afc-sr1-ts0-parent-child-lineage-authority";

export const AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_POLICY_VERSION =
  "afc-sr1-raw-first-placement-aware-orchestration-policy/v1" as const;
export const AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_VERSION =
  "afc-sr1-raw-first-placement-aware-orchestration/v1" as const;
export const AFC_SR1_PLACEMENT_TIMEOUT_MS = 15_000;

export const AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS = Object.freeze([
  "insufficient_segments",
  "no_stable_valid_pair",
  "degenerate_vanishing_line",
] as const);

export const AFC_SR1_V3_HARD_REJECTION_REASONS = Object.freeze([
  "unsupported_policy_version",
  "invalid_input_image",
  "source_raster_too_large",
  "below_reference_analysis_long_edge",
  "invalid_roi",
  "impossible_eroded_roi",
] as const);

export type AfcSr1RawOutcomeClassV1 =
  | "success"
  | "evidence_rejected_fallback_eligible"
  | "hard_rejected";

export type AfcSr1RawFirstPlacementAwareModeV1 =
  | "raw-direct"
  | "tiled-placement"
  | "rejected";

export type AfcSr1RawFirstPlacementAwareFinalReasonV1 =
  | "invalid_orchestration_input"
  | "transport_failure"
  | "raw_receipt_invalid"
  | "raw_reader_rejected"
  | "common_basis_rejected"
  | "raw_projective_execution_failed"
  | "ts0_generation_failed"
  | "ts0_lineage_invalid"
  | "placement_receipt_invalid"
  | "placement_rejected"
  | "tiled_reader_receipt_invalid"
  | "tiled_reader_rejected"
  | "placement_handoff_rejected"
  | "tiled_projective_rejected"
  | "tiled_projective_execution_failed";

type EvidenceDigestStatus = Readonly<{
  evidenceDigest: string;
  status: "usable" | "rejected";
  reason: string | null;
}>;

type HandoffTrace = Readonly<{
  status: "validated" | "rejected";
  evidenceDigest: string | null;
  reason: string | null;
}>;

type ProjectiveTrace = Readonly<{
  status: "usable" | "rejected";
  reason: string | null;
  seamT: number | null;
}>;

export type AfcSr1RawAttemptTraceV1 = Readonly<{
  receipt: EvidenceDigestStatus | null;
  commonBasisHandoff: HandoffTrace | null;
  projective: ProjectiveTrace | null;
  fallbackEligibilityClass: AfcSr1RawOutcomeClassV1;
}>;

export type AfcSr1FallbackAttemptTraceV1 = Readonly<{
  lineage: Readonly<{
    status: "validated" | "rejected";
    evidenceDigest: string | null;
  }>;
  childImageIdentity: AfcSr1TileGridScaffoldImageIdentity | null;
  placement: EvidenceDigestStatus | null;
  childReader: EvidenceDigestStatus | null;
  placementBoundHandoff: HandoffTrace | null;
  finalProjective: ProjectiveTrace | null;
}>;

export type AfcSr1OrchestrationAttemptCountsV1 = Readonly<{
  rawReader: number;
  ts0: number;
  placement: number;
  childReader: number;
  placementBoundHandoff: number;
  tiledProjective: number;
}>;

export type AfcSr1RawFirstPlacementAwareOrchestrationResultV1 = Readonly<{
  schemaVersion:
    typeof AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_VERSION;
  policyVersion:
    typeof AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_POLICY_VERSION;
  parentImageIdentity: Readonly<{
    sha256: string;
    byteCount: number;
    decodedWidth: number | null;
    decodedHeight: number | null;
    orientation: 1 | null;
  }>;
  semanticPolygonIdentity: Readonly<{
    schemaVersion: string | null;
    polygonFingerprint: string | null;
    evidenceDigest: string | null;
    basisFingerprint: string | null;
  }>;
  truncatedAnchor: "NL" | "NR" | null;
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1 | null;
  rawAttempt: AfcSr1RawAttemptTraceV1;
  fallbackAttempt: AfcSr1FallbackAttemptTraceV1 | null;
  attemptCounts: AfcSr1OrchestrationAttemptCountsV1;
  mode: AfcSr1RawFirstPlacementAwareModeV1;
  finalReason: AfcSr1RawFirstPlacementAwareFinalReasonV1 | null;
  evidenceCanonicalJson: string;
  evidenceDigest: Readonly<{
    algorithm: "sha256";
    encoding: "hex";
    value: string;
  }>;
}>;

export type AfcSr1RawFirstPlacementAwareOrchestrationInputV1 = Readonly<{
  parentImageBytes: Uint8Array;
  parentImageIdentity: AfcSr1TileGridScaffoldImageIdentity;
  basisBoundSourcePolygon: AfcSr1BasisBoundSourcePolygonV1;
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1;
  ts0ScaffoldOptions: Omit<AfcSr1TileGridScaffoldArgs, "empty">;
}>;

type ReaderTransport = (args: Readonly<{
  payload: unknown;
  signal?: AbortSignal;
}>) => Promise<unknown>;

type Ts0Executor = (
  args: AfcSr1TileGridScaffoldArgs
) => Promise<AfcSr1TileGridScaffoldResult>;

export type AfcSr1RawFirstPlacementAwareDependenciesV1 = Readonly<{
  callRawReader?: ReaderTransport;
  executeTs0?: Ts0Executor;
  callPlacement?: (
    args: CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs
  ) => Promise<unknown>;
  callChildReader?: ReaderTransport;
  buildCommonBasis?: typeof buildAfcSr1CommonBasisTr0Handoff;
  deriveProjective?: typeof deriveAfcSr1FloorVanishingLineCrossRoom;
  buildPlacementBoundHandoff?: typeof buildAfcSr1PlacementBoundTr0Handoff;
}>;

type Preflight = Readonly<{
  parentImageBytes: Uint8Array;
  parentIdentity: AfcSr1TileGridScaffoldImageIdentity;
  basisBoundSourcePolygon: AfcSr1BasisBoundSourcePolygonV1;
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1;
  roi: AfcSr1Tr2ExecutionInput["roi"];
  registrationExclusion:
    AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1;
}>;

const FALLBACK_REASON_SET = new Set<string>(
  AFC_SR1_V3_FALLBACK_ELIGIBLE_REASONS
);
const ANCHOR_AUTHORITY_KINDS = new Set([
  "gt_adjustable_corner_derived",
  "predeclared_truncated_anchor",
  "lab_manual_advanced_calibration",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeRfc8785Jcs(left) === canonicalizeRfc8785Jcs(right);
}

export function classifyAfcSr1V3ReaderRejectionReason(
  reason: string
): Exclude<AfcSr1RawOutcomeClassV1, "success"> {
  return FALLBACK_REASON_SET.has(reason)
    ? "evidence_rejected_fallback_eligible"
    : "hard_rejected";
}

function safeParentIdentity(
  input: AfcSr1RawFirstPlacementAwareOrchestrationInputV1
): AfcSr1RawFirstPlacementAwareOrchestrationResultV1["parentImageIdentity"] {
  const bytes = input?.parentImageBytes;
  const identity = input?.parentImageIdentity;
  const validBytes = bytes instanceof Uint8Array;
  return Object.freeze({
    sha256: validBytes ? sha256(bytes) : "",
    byteCount: validBytes ? bytes.byteLength : 0,
    decodedWidth: Number.isInteger(identity?.decodedWidth)
      ? identity.decodedWidth
      : null,
    decodedHeight: Number.isInteger(identity?.decodedHeight)
      ? identity.decodedHeight
      : null,
    orientation: identity?.orientation === 1 ? 1 : null,
  });
}

function safePolygonIdentity(
  input: AfcSr1RawFirstPlacementAwareOrchestrationInputV1
): AfcSr1RawFirstPlacementAwareOrchestrationResultV1["semanticPolygonIdentity"] {
  const polygon = input?.basisBoundSourcePolygon;
  return Object.freeze({
    schemaVersion:
      typeof polygon?.schemaVersion === "string" ? polygon.schemaVersion : null,
    polygonFingerprint:
      typeof polygon?.polygonFingerprint === "string"
        ? polygon.polygonFingerprint
        : null,
    evidenceDigest:
      typeof polygon?.evidenceDigest?.value === "string"
        ? polygon.evidenceDigest.value
        : null,
    basisFingerprint:
      typeof polygon?.basis?.fingerprint === "string"
        ? polygon.basis.fingerprint
        : null,
  });
}

function validAnchorAuthority(
  value: unknown,
  truncatedAnchor: unknown
): value is AfcSr1ExplicitAnchorAuthorityV1 {
  return isPlainRecord(value) &&
    hasExactKeys(value, ["kind", "truncatedAnchor", "evidenceReference"]) &&
    typeof value.kind === "string" &&
    ANCHOR_AUTHORITY_KINDS.has(value.kind) &&
    (value.truncatedAnchor === "NL" || value.truncatedAnchor === "NR") &&
    value.truncatedAnchor === truncatedAnchor &&
    typeof value.evidenceReference === "string" &&
    value.evidenceReference.length > 0;
}

function frozenVersionsAreExact(): boolean {
  return AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION ===
      "afc-sr1-basis-bound-source-polygon/v1" &&
    AFC_SR1_COMMON_BASIS_TR0_HANDOFF_VERSION ===
      "afc-sr1-common-basis-tr0-handoff/v1" &&
    AFC_SR1_TR2_V3_RESEARCH_PROFILE ===
      "afc-sr1-tr2-tile-floor-reader/v3" &&
    AFC_SR1_TR2_V3_POLICY_VERSION ===
      "afc-sr1-ts2-extractor-policy/v3" &&
    AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION ===
      "afc-sr1-tr2-tile-floor-reader-result/v3" &&
    AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE ===
      "afc-sr1-tile-grid-scaffold/v1" &&
    AFC_SR1_TS0_PARENT_CHILD_LINEAGE_EVIDENCE_VERSION ===
      "afc-sr1-ts0-parent-child-lineage-evidence/v1" &&
    AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION ===
      "afc-sr1-ts0-child-projective-placement/v1" &&
    AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION ===
      "afc-sr1-ts0-child-projective-placement-policy/v1" &&
    AFC_SR1_PLACEMENT_BOUND_TR0_HANDOFF_VERSION ===
      "afc-sr1-placement-bound-tr0-handoff/v1";
}

async function semanticPreflight(
  input: AfcSr1RawFirstPlacementAwareOrchestrationInputV1
): Promise<Preflight | null> {
  if (!frozenVersionsAreExact() ||
      !isPlainRecord(input) ||
      !hasExactKeys(input, [
        "parentImageBytes",
        "parentImageIdentity",
        "basisBoundSourcePolygon",
        "truncatedAnchor",
        "anchorAuthority",
        "ts0ScaffoldOptions",
      ]) ||
      !(input.parentImageBytes instanceof Uint8Array) ||
      input.parentImageBytes.byteLength === 0 ||
      !isPlainRecord(input.parentImageIdentity) ||
      !hasExactKeys(input.parentImageIdentity, [
        "sha256",
        "byteCount",
        "decodedWidth",
        "decodedHeight",
        "mimeType",
        "orientation",
      ]) ||
      !/^[0-9a-f]{64}$/.test(input.parentImageIdentity.sha256) ||
      input.parentImageIdentity.byteCount !== input.parentImageBytes.byteLength ||
      input.parentImageIdentity.sha256 !== sha256(input.parentImageBytes) ||
      !Number.isInteger(input.parentImageIdentity.decodedWidth) ||
      input.parentImageIdentity.decodedWidth <= 0 ||
      !Number.isInteger(input.parentImageIdentity.decodedHeight) ||
      input.parentImageIdentity.decodedHeight <= 0 ||
      (input.parentImageIdentity.mimeType !== "image/jpeg" &&
       input.parentImageIdentity.mimeType !== "image/png" &&
       input.parentImageIdentity.mimeType !== "image/webp") ||
      input.parentImageIdentity.orientation !== 1 ||
      (input.truncatedAnchor !== "NL" && input.truncatedAnchor !== "NR") ||
      !validAnchorAuthority(input.anchorAuthority, input.truncatedAnchor) ||
      !isPlainRecord(input.ts0ScaffoldOptions)) {
    return null;
  }

  try {
    validateAfcSr1BasisBoundSourcePolygon(input.basisBoundSourcePolygon);
  } catch {
    return null;
  }
  const polygon = input.basisBoundSourcePolygon;
  if (polygon.provenance.kind !== "empty_room_read" ||
      polygon.basis.fingerprint !== input.parentImageIdentity.sha256 ||
      polygon.basis.decodedWidth !== input.parentImageIdentity.decodedWidth ||
      polygon.basis.decodedHeight !== input.parentImageIdentity.decodedHeight ||
      polygon.basis.orientation !== input.parentImageIdentity.orientation) {
    return null;
  }
  const roiPolygon = polygon.polygon.map((point) =>
    Object.freeze([point.x, point.y] as const)
  );
  if (roiPolygon.length < 3 ||
      !roiPolygon.every((point) =>
        point.every((coordinate) =>
          Number.isFinite(coordinate) &&
          coordinate >= 0 &&
          coordinate <= 1))) {
    return null;
  }

  try {
    const metadata = await sharp(Buffer.from(input.parentImageBytes)).metadata();
    const mimeType = metadata.format === "jpeg"
      ? "image/jpeg"
      : metadata.format === "png"
        ? "image/png"
        : metadata.format === "webp"
          ? "image/webp"
          : null;
    if (metadata.width !== input.parentImageIdentity.decodedWidth ||
        metadata.height !== input.parentImageIdentity.decodedHeight ||
        (metadata.orientation ?? 1) !== input.parentImageIdentity.orientation ||
        mimeType !== input.parentImageIdentity.mimeType) {
      return null;
    }
  } catch {
    return null;
  }

  const frozenPolygon = Object.freeze(roiPolygon);
  const basisBoundSourcePolygon = buildAfcSr1BasisBoundSourcePolygon({
    polygon: polygon.polygon,
    basis: polygon.basis,
    provenance: polygon.provenance,
  });
  return Object.freeze({
    parentImageBytes: Uint8Array.from(input.parentImageBytes),
    parentIdentity: Object.freeze({ ...input.parentImageIdentity }),
    basisBoundSourcePolygon,
    truncatedAnchor: input.truncatedAnchor,
    anchorAuthority: Object.freeze({ ...input.anchorAuthority }),
    roi: Object.freeze({
      coordinateSpace: "source-normalized/v1" as const,
      polygon: frozenPolygon,
    }),
    registrationExclusion: Object.freeze({
      coordinateSpace: AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
      role: AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
      evidenceLabel:
        "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY" as const,
      polygon: frozenPolygon,
    }),
  });
}

function readerPayload(
  bytes: Uint8Array,
  roi: AfcSr1Tr2ExecutionInput["roi"]
): unknown {
  return Object.freeze({
    researchProfile: AFC_SR1_TR2_V3_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_V3_POLICY_VERSION,
    imageBase64: Buffer.from(bytes).toString("base64"),
    roi,
  });
}

async function callReaderOnce(
  caller: ReaderTransport,
  bytes: Uint8Array,
  roi: AfcSr1Tr2ExecutionInput["roi"]
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AFC_SR1_TR2_READER_TIMEOUT_MS
  );
  try {
    return await caller({
      payload: readerPayload(bytes, roi),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callPlacementOnce(
  caller: NonNullable<
    AfcSr1RawFirstPlacementAwareDependenciesV1["callPlacement"]
  >,
  args: Omit<
    CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs,
    "signal"
  >
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AFC_SR1_PLACEMENT_TIMEOUT_MS
  );
  try {
    return await caller({ ...args, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function receiptTrace(
  receipt: Readonly<{
    evidenceDigest: Readonly<{ value: string }>;
    status: "usable" | "rejected";
    reason?: string | null;
  }>
): EvidenceDigestStatus {
  return Object.freeze({
    evidenceDigest: receipt.evidenceDigest.value,
    status: receipt.status,
    reason: receipt.status === "rejected" ? receipt.reason ?? null : null,
  });
}

function projectiveTrace(
  result: AfcSr1FloorVanishingLineCrossRoomResultV1
): ProjectiveTrace {
  return Object.freeze(result.status === "usable"
    ? {
        status: "usable" as const,
        reason: null,
        seamT: result.prior.seamT,
      }
    : {
        status: "rejected" as const,
        reason: result.reason,
        seamT: null,
      });
}

function lineageIdentity(
  authority: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1
): AfcSr1Ts0LineageIdentityV1 {
  const { parent, child } = authority.evidence;
  const project = (identity: typeof parent) => Object.freeze({
    sha256: identity.sha256,
    byteCount: identity.byteCount,
    decodedWidth: identity.decodedWidth,
    decodedHeight: identity.decodedHeight,
    orientation: identity.orientation,
  });
  return Object.freeze({
    parent: project(parent),
    child: project(child),
  });
}

function rejectedPlacementExpectedIdentity(
  value: unknown
): AfcSr1Ts0PlacementExpectedIdentityV1 {
  if (!isPlainRecord(value)) {
    throw new Error("placement receipt shape unavailable");
  }
  return {
    sourceImageBasis: value.sourceImageBasis as
      AfcSr1Ts0PlacementExpectedIdentityV1["sourceImageBasis"],
    targetImageBasis: value.targetImageBasis as
      AfcSr1Ts0PlacementExpectedIdentityV1["targetImageBasis"],
    ts0Lineage: value.ts0Lineage as
      AfcSr1Ts0PlacementExpectedIdentityV1["ts0Lineage"],
    registrationMaskIdentity: value.registrationMaskIdentity as
      AfcSr1Ts0PlacementExpectedIdentityV1["registrationMaskIdentity"],
  };
}

function placementBindsRequest(
  receipt: AfcSr1Ts0ChildProjectivePlacementReceiptV1,
  lineage: AfcSr1Ts0LineageIdentityV1,
  exclusion: AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1
): boolean {
  if (!equalJson(receipt.ts0Lineage, lineage) ||
      receipt.sourceImageBasis.sha256 !== lineage.parent.sha256 ||
      receipt.sourceImageBasis.byteCount !== lineage.parent.byteCount ||
      receipt.targetImageBasis.sha256 !== lineage.child.sha256 ||
      receipt.targetImageBasis.byteCount !== lineage.child.byteCount) {
    return false;
  }
  const mask = receipt.registrationMaskIdentity;
  return mask === null ||
    (mask.coordinateSpace === exclusion.coordinateSpace &&
     mask.role === exclusion.role &&
     mask.evidenceLabel === exclusion.evidenceLabel &&
     equalJson(mask.polygon, exclusion.polygon));
}

export async function executeAfcSr1RawFirstPlacementAwareOrchestration(
  input: AfcSr1RawFirstPlacementAwareOrchestrationInputV1,
  dependencies: AfcSr1RawFirstPlacementAwareDependenciesV1 = {}
): Promise<AfcSr1RawFirstPlacementAwareOrchestrationResultV1> {
  const counts = {
    rawReader: 0,
    ts0: 0,
    placement: 0,
    childReader: 0,
    placementBoundHandoff: 0,
    tiledProjective: 0,
  };
  let parentImageIdentity = safeParentIdentity(input);
  let semanticPolygonIdentity = safePolygonIdentity(input);
  let truncatedAnchor =
    input?.truncatedAnchor === "NL" || input?.truncatedAnchor === "NR"
      ? input.truncatedAnchor
      : null;
  let anchorAuthority = validAnchorAuthority(
    input?.anchorAuthority,
    truncatedAnchor
  )
    ? Object.freeze({ ...input.anchorAuthority })
    : null;
  let rawAttempt: AfcSr1RawAttemptTraceV1 = Object.freeze({
    receipt: null,
    commonBasisHandoff: null,
    projective: null,
    fallbackEligibilityClass: "hard_rejected",
  });
  let fallbackAttempt: AfcSr1FallbackAttemptTraceV1 | null = null;

  const finish = (
    mode: AfcSr1RawFirstPlacementAwareModeV1,
    finalReason: AfcSr1RawFirstPlacementAwareFinalReasonV1 | null
  ): AfcSr1RawFirstPlacementAwareOrchestrationResultV1 => {
    const preimage = {
      schemaVersion:
        AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_VERSION,
      policyVersion:
        AFC_SR1_RAW_FIRST_PLACEMENT_AWARE_ORCHESTRATION_POLICY_VERSION,
      parentImageIdentity,
      semanticPolygonIdentity,
      truncatedAnchor,
      anchorAuthority,
      rawAttempt,
      fallbackAttempt,
      attemptCounts: Object.freeze({ ...counts }),
      mode,
      finalReason,
    };
    const evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
    return Object.freeze({
      ...preimage,
      evidenceCanonicalJson,
      evidenceDigest: Object.freeze({
        algorithm: "sha256" as const,
        encoding: "hex" as const,
        value: sha256HexUtf8(evidenceCanonicalJson),
      }),
    });
  };

  const preflight = await semanticPreflight(input);
  if (preflight === null) {
    return finish("rejected", "invalid_orchestration_input");
  }
  parentImageIdentity = Object.freeze({ ...preflight.parentIdentity });
  semanticPolygonIdentity = Object.freeze({
    schemaVersion: preflight.basisBoundSourcePolygon.schemaVersion,
    polygonFingerprint:
      preflight.basisBoundSourcePolygon.polygonFingerprint,
    evidenceDigest:
      preflight.basisBoundSourcePolygon.evidenceDigest.value,
    basisFingerprint:
      preflight.basisBoundSourcePolygon.basis.fingerprint,
  });
  truncatedAnchor = preflight.truncatedAnchor;
  anchorAuthority = preflight.anchorAuthority;

  const rawExpected = {
    readerVersion: "v3" as const,
    tiledImageBytes: preflight.parentImageBytes,
    roi: preflight.roi,
    expectedImageIdentity: {
      sha256: preflight.parentIdentity.sha256,
      byteCount: preflight.parentIdentity.byteCount,
      decodedWidth: preflight.parentIdentity.decodedWidth,
      decodedHeight: preflight.parentIdentity.decodedHeight,
    },
  };
  let rawWireReceipt: unknown;
  counts.rawReader += 1;
  try {
    rawWireReceipt = await callReaderOnce(
      dependencies.callRawReader ?? callCompositorAfcSr1TileFloorReader,
      preflight.parentImageBytes,
      preflight.roi
    );
  } catch {
    return finish("rejected", "transport_failure");
  }

  let rawReceipt;
  try {
    rawReceipt = validateAfcSr1Tr2ReaderReceipt(
      rawWireReceipt,
      rawExpected
    );
  } catch {
    return finish("rejected", "raw_receipt_invalid");
  }
  if (rawReceipt.status === "rejected") {
    const classification = classifyAfcSr1V3ReaderRejectionReason(
      rawReceipt.reason
    );
    rawAttempt = Object.freeze({
      receipt: receiptTrace(rawReceipt),
      commonBasisHandoff: null,
      projective: null,
      fallbackEligibilityClass: classification,
    });
    if (classification === "hard_rejected") {
      return finish("rejected", "raw_reader_rejected");
    }
  } else {
    const readerAuthority =
      getAfcSr1ValidatedTr2UsableReaderAuthority(rawReceipt);
    if (readerAuthority === null) {
      return finish("rejected", "raw_receipt_invalid");
    }
    let commonBasis: AfcSr1CommonBasisTr0HandoffResultV1;
    try {
      commonBasis = (
        dependencies.buildCommonBasis ?? buildAfcSr1CommonBasisTr0Handoff
      )({
        readerAuthority,
        readerImageKind: "raw_input",
        basisBoundSourcePolygon: preflight.basisBoundSourcePolygon,
        basisRelation: "identical_input",
        truncatedAnchor: preflight.truncatedAnchor,
        anchorAuthority: preflight.anchorAuthority,
      });
    } catch {
      return finish("rejected", "common_basis_rejected");
    }
    const commonTrace: HandoffTrace = Object.freeze(
      commonBasis.status === "validated"
        ? {
            status: "validated" as const,
            evidenceDigest: commonBasis.handoff.evidenceDigest.value,
            reason: null,
          }
        : {
            status: "rejected" as const,
            evidenceDigest: null,
            reason: commonBasis.reason,
          }
    );
    rawAttempt = Object.freeze({
      receipt: receiptTrace(rawReceipt),
      commonBasisHandoff: commonTrace,
      projective: null,
      fallbackEligibilityClass: "hard_rejected",
    });
    if (commonBasis.status === "rejected") {
      return finish("rejected", "common_basis_rejected");
    }
    try {
      validateAfcSr1ValidatedCommonBasisTr0Handoff(
        commonBasis.handoff
      );
    } catch {
      return finish("rejected", "common_basis_rejected");
    }

    let rawProjective: AfcSr1FloorVanishingLineCrossRoomResultV1;
    try {
      rawProjective = (
        dependencies.deriveProjective ??
        deriveAfcSr1FloorVanishingLineCrossRoom
      )(commonBasis.handoff.tr0Input);
    } catch {
      return finish("rejected", "raw_projective_execution_failed");
    }
    rawAttempt = Object.freeze({
      receipt: receiptTrace(rawReceipt),
      commonBasisHandoff: commonTrace,
      projective: projectiveTrace(rawProjective),
      fallbackEligibilityClass:
        rawProjective.status === "usable"
          ? "success"
          : "evidence_rejected_fallback_eligible",
    });
    if (rawProjective.status === "usable") {
      return finish("raw-direct", null);
    }
  }

  const fallback = {
    lineage: {
      status: "rejected" as "validated" | "rejected",
      evidenceDigest: null as string | null,
    },
    childImageIdentity: null as AfcSr1TileGridScaffoldImageIdentity | null,
    placement: null as EvidenceDigestStatus | null,
    childReader: null as EvidenceDigestStatus | null,
    placementBoundHandoff: null as HandoffTrace | null,
    finalProjective: null as ProjectiveTrace | null,
  };
  const freezeFallback = (): AfcSr1FallbackAttemptTraceV1 => Object.freeze({
    lineage: Object.freeze({ ...fallback.lineage }),
    childImageIdentity: fallback.childImageIdentity === null
      ? null
      : Object.freeze({ ...fallback.childImageIdentity }),
    placement: fallback.placement,
    childReader: fallback.childReader,
    placementBoundHandoff: fallback.placementBoundHandoff,
    finalProjective: fallback.finalProjective,
  });
  fallbackAttempt = freezeFallback();

  counts.ts0 += 1;
  let ts0Result: AfcSr1TileGridScaffoldResult;
  try {
    ts0Result = await (dependencies.executeTs0 ?? vibodeTileGridScaffoldAssist)({
      ...input.ts0ScaffoldOptions,
      empty: {
        base64: Buffer.from(preflight.parentImageBytes).toString("base64"),
        identity: preflight.parentIdentity,
      },
    });
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "ts0_generation_failed");
  }
  if (ts0Result.status !== "generated") {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "ts0_generation_failed");
  }
  const childBytes = Buffer.from(ts0Result.tiled.base64, "base64");
  fallback.childImageIdentity = ts0Result.tiled.identity;

  let lineageAuthority: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
  try {
    lineageAuthority =
      await validateAfcSr1GeneratedTs0ParentChildLineage(
        ts0Result,
        preflight.parentImageBytes,
        childBytes
      );
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "ts0_lineage_invalid");
  }
  fallback.lineage = {
    status: "validated",
    evidenceDigest: lineageAuthority.lineageEvidenceDigest,
  };
  fallbackAttempt = freezeFallback();
  const lineage = lineageIdentity(lineageAuthority);

  counts.placement += 1;
  let placementWireReceipt: unknown;
  try {
    placementWireReceipt = await callPlacementOnce(
      dependencies.callPlacement ??
        callCompositorAfcSr1Ts0ChildProjectivePlacement,
      {
        parentImageBytes: Uint8Array.from(preflight.parentImageBytes),
        childImageBytes: Uint8Array.from(childBytes),
        policyVersion:
          AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
        registrationExclusion: preflight.registrationExclusion,
        ts0Lineage: lineage,
      }
    );
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "transport_failure");
  }

  let placementReceipt: AfcSr1Ts0ChildProjectivePlacementReceiptV1;
  try {
    const status = isPlainRecord(placementWireReceipt)
      ? placementWireReceipt.status
      : null;
    placementReceipt =
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(
        placementWireReceipt,
        status === "usable"
          ? {
              parentBytes: preflight.parentImageBytes,
              childBytes,
              lineageAuthority,
            }
          : {
              expectedRejectedIdentity:
                rejectedPlacementExpectedIdentity(placementWireReceipt),
            }
      );
    if (!placementBindsRequest(
      placementReceipt,
      lineage,
      preflight.registrationExclusion
    )) {
      throw new Error("placement request binding mismatch");
    }
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "placement_receipt_invalid");
  }
  fallback.placement = receiptTrace(placementReceipt);
  fallbackAttempt = freezeFallback();
  if (placementReceipt.status === "rejected") {
    return finish("rejected", "placement_rejected");
  }
  const placementAuthority =
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(placementReceipt);
  if (placementAuthority === null) {
    return finish("rejected", "placement_receipt_invalid");
  }

  counts.childReader += 1;
  let childWireReceipt: unknown;
  try {
    childWireReceipt = await callReaderOnce(
      dependencies.callChildReader ?? callCompositorAfcSr1TileFloorReader,
      childBytes,
      preflight.roi
    );
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "transport_failure");
  }

  let childReceipt;
  try {
    childReceipt = validateAfcSr1Tr2ReaderReceipt(childWireReceipt, {
      readerVersion: "v3",
      tiledImageBytes: childBytes,
      roi: preflight.roi,
      expectedImageIdentity: {
        sha256: lineage.child.sha256,
        byteCount: lineage.child.byteCount,
        decodedWidth: lineage.child.decodedWidth ?? undefined,
        decodedHeight: lineage.child.decodedHeight ?? undefined,
      },
    });
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "tiled_reader_receipt_invalid");
  }
  fallback.childReader = receiptTrace(childReceipt);
  fallbackAttempt = freezeFallback();
  if (childReceipt.status === "rejected") {
    return finish("rejected", "tiled_reader_rejected");
  }
  const childReaderAuthority =
    getAfcSr1ValidatedTr2UsableReaderAuthority(childReceipt);
  if (childReaderAuthority === null) {
    return finish("rejected", "tiled_reader_receipt_invalid");
  }

  counts.placementBoundHandoff += 1;
  let placementHandoff: AfcSr1PlacementBoundTr0HandoffResultV1;
  try {
    placementHandoff = (
      dependencies.buildPlacementBoundHandoff ??
      buildAfcSr1PlacementBoundTr0Handoff
    )({
      readerAuthority: childReaderAuthority,
      placementAuthority,
      lineageAuthority,
      basisBoundSourcePolygon: preflight.basisBoundSourcePolygon,
      truncatedAnchor: preflight.truncatedAnchor,
      anchorAuthority: preflight.anchorAuthority,
    });
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "placement_handoff_rejected");
  }
  fallback.placementBoundHandoff = Object.freeze(
    placementHandoff.status === "validated"
      ? {
          status: "validated" as const,
          evidenceDigest: placementHandoff.handoff.evidenceDigest.value,
          reason: null,
        }
      : {
          status: "rejected" as const,
          evidenceDigest: null,
          reason: placementHandoff.reason,
        }
  );
  fallbackAttempt = freezeFallback();
  if (placementHandoff.status === "rejected") {
    return finish("rejected", "placement_handoff_rejected");
  }
  try {
    validateAfcSr1ValidatedPlacementBoundTr0Handoff(
      placementHandoff.handoff
    );
  } catch {
    return finish("rejected", "placement_handoff_rejected");
  }

  counts.tiledProjective += 1;
  let tiledProjective: AfcSr1FloorVanishingLineCrossRoomResultV1;
  try {
    tiledProjective = (
      dependencies.deriveProjective ??
      deriveAfcSr1FloorVanishingLineCrossRoom
    )(placementHandoff.handoff.tr0Input);
  } catch {
    fallbackAttempt = freezeFallback();
    return finish("rejected", "tiled_projective_execution_failed");
  }
  fallback.finalProjective = projectiveTrace(tiledProjective);
  fallbackAttempt = freezeFallback();
  return tiledProjective.status === "usable"
    ? finish("tiled-placement", null)
    : finish("rejected", "tiled_projective_rejected");
}
