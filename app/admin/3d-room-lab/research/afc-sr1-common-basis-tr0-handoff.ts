import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import type {
  AfcSr1FloorVanishingLineCrossRoomInputV1,
  AfcSr1PixelLineV1,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  validateAfcSr1BasisBoundSourcePolygon,
  type AfcSr1BasisBoundSourcePolygonV1,
  type AfcSr1EvidenceDigestV1,
} from "./afc-sr1-basis-bound-source-polygon";
import {
  AFC_SR1_COORDINATE_SPACE,
  fingerprintAfcSr1SourcePolygon,
  validateAfcSr1SourcePolygon,
} from "./afc-sr1-semantic-prior";
import type { AfcSr1CrossRoomTruncatedAnchorV1 } from "./afc-sr1-cross-room-prior";
import {
  isAfcSr1ValidatedTr2UsableReaderAuthority,
  type AfcSr1ValidatedTr2UsableReaderAuthorityV1,
} from "./afc-sr1-tile-floor-reader-execution";

export const AFC_SR1_COMMON_BASIS_TR0_HANDOFF_VERSION =
  "afc-sr1-common-basis-tr0-handoff/v1" as const;

/**
 * This is deliberately narrow in v1. The wider conceptual relation vocabulary
 * is not represented as an executable authority until independently certified.
 */
export type AfcSr1BasisRelationV1 = "identical_input";

export type AfcSr1ExplicitAnchorAuthorityV1 = Readonly<{
  kind:
    | "gt_adjustable_corner_derived"
    | "predeclared_truncated_anchor"
    | "lab_manual_advanced_calibration"
    | "supported_domain_near_side_derived";
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  evidenceReference: string;
}>;

export type AfcSr1CommonBasisTr0HandoffRejectReasonV1 =
  | "invalid_basis_bound_polygon"
  | "invalid_reader_receipt"
  | "reader_basis_mismatch"
  | "unsupported_basis_relation"
  | "projective_basis_unproven"
  | "anchor_authority_unresolved"
  | "invalid_anchor_authority";

export type AfcSr1ValidatedCommonBasisTr0HandoffV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_COMMON_BASIS_TR0_HANDOFF_VERSION;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  basisRelation: "identical_input";
  resolvedBasisMode: "identical_input";
  readerBasis: Readonly<{
    fingerprint: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
    receiptEvidenceDigest: string;
    floorVanishingLinePixel: AfcSr1PixelLineV1;
  }>;
  polygonBasisFingerprint: string;
  polygonFingerprint: string;
  polygonEvidenceDigest: string;
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1;
  tr0Input: AfcSr1FloorVanishingLineCrossRoomInputV1;
  evidenceCanonicalJson: string;
  evidenceDigest: AfcSr1EvidenceDigestV1;
}>;

export type AfcSr1CommonBasisTr0HandoffResultV1 =
  | Readonly<{ status: "validated"; handoff: AfcSr1ValidatedCommonBasisTr0HandoffV1 }>
  | Readonly<{ status: "rejected"; reason: AfcSr1CommonBasisTr0HandoffRejectReasonV1 }>;

export type AfcSr1CommonBasisTr0HandoffInputV1 = Readonly<{
  readerAuthority: AfcSr1ValidatedTr2UsableReaderAuthorityV1;
  readerImageKind: "raw_input" | "ts0_child";
  basisBoundSourcePolygon: AfcSr1BasisBoundSourcePolygonV1;
  basisRelation: AfcSr1BasisRelationV1;
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1;
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ANCHOR_AUTHORITY_KINDS = new Set<AfcSr1ExplicitAnchorAuthorityV1["kind"]>([
  "gt_adjustable_corner_derived",
  "predeclared_truncated_anchor",
  "lab_manual_advanced_calibration",
  "supported_domain_near_side_derived",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validLine(value: unknown): value is AfcSr1PixelLineV1 {
  return isPlainRecord(value) && hasExactKeys(value, ["a", "b", "c"]) &&
    [value.a, value.b, value.c].every((coefficient) =>
      typeof coefficient === "number" && Number.isFinite(coefficient));
}

function validDigest(value: unknown): value is AfcSr1EvidenceDigestV1 {
  return isPlainRecord(value) && hasExactKeys(value, ["algorithm", "encoding", "value"]) &&
    value.algorithm === "sha256" && value.encoding === "hex" && isSha256(value.value);
}

function validAnchorAuthority(
  value: unknown
): value is AfcSr1ExplicitAnchorAuthorityV1 {
  return isPlainRecord(value) && hasExactKeys(value, ["kind", "truncatedAnchor", "evidenceReference"]) &&
    typeof value.kind === "string" &&
    ANCHOR_AUTHORITY_KINDS.has(value.kind as AfcSr1ExplicitAnchorAuthorityV1["kind"]) &&
    (value.truncatedAnchor === "NL" || value.truncatedAnchor === "NR") &&
    typeof value.evidenceReference === "string" && value.evidenceReference.length > 0;
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeRfc8785Jcs(left) === canonicalizeRfc8785Jcs(right);
}

function rejection(
  reason: AfcSr1CommonBasisTr0HandoffRejectReasonV1
): AfcSr1CommonBasisTr0HandoffResultV1 {
  return Object.freeze({ status: "rejected" as const, reason });
}

function evidencePreimage(handoff: Omit<
  AfcSr1ValidatedCommonBasisTr0HandoffV1,
  "evidenceCanonicalJson" | "evidenceDigest"
>) {
  return handoff;
}

function freezeLine(line: AfcSr1PixelLineV1): AfcSr1PixelLineV1 {
  return Object.freeze({ ...line });
}

export function buildAfcSr1CommonBasisTr0Handoff(
  input: AfcSr1CommonBasisTr0HandoffInputV1
): AfcSr1CommonBasisTr0HandoffResultV1 {
  if (!isPlainRecord(input)) return rejection("invalid_reader_receipt");
  if (!isAfcSr1ValidatedTr2UsableReaderAuthority(input.readerAuthority)) {
    return rejection("invalid_reader_receipt");
  }
  const reader = input.readerAuthority;
  try {
    validateAfcSr1BasisBoundSourcePolygon(input.basisBoundSourcePolygon);
  } catch {
    return rejection("invalid_basis_bound_polygon");
  }
  const polygon = input.basisBoundSourcePolygon;
  if (input.basisRelation !== "identical_input") return rejection("unsupported_basis_relation");
  if (input.anchorAuthority === undefined || input.anchorAuthority === null) {
    return rejection("anchor_authority_unresolved");
  }
  if (!validAnchorAuthority(input.anchorAuthority) ||
      (input.truncatedAnchor !== "NL" && input.truncatedAnchor !== "NR")) {
    return rejection("invalid_anchor_authority");
  }
  if (input.anchorAuthority.truncatedAnchor !== input.truncatedAnchor) {
    return rejection("anchor_authority_unresolved");
  }
  if (input.readerImageKind !== "raw_input" && input.readerImageKind !== "ts0_child") {
    return rejection("projective_basis_unproven");
  }
  if (polygon.basis.fingerprint !== reader.imageIdentity.sha256 ||
      polygon.basis.decodedWidth !== reader.imageIdentity.decodedWidth ||
      polygon.basis.decodedHeight !== reader.imageIdentity.decodedHeight ||
      polygon.basis.orientation !== 1) {
    return rejection(input.readerImageKind === "ts0_child"
      ? "projective_basis_unproven"
      : "reader_basis_mismatch");
  }
  const truncatedAnchor = input.truncatedAnchor as AfcSr1CrossRoomTruncatedAnchorV1;
  const anchorAuthority = input.anchorAuthority as AfcSr1ExplicitAnchorAuthorityV1;
  const tr0Input: AfcSr1FloorVanishingLineCrossRoomInputV1 = Object.freeze({
    analysisImage: Object.freeze({
      decodedWidth: reader.imageIdentity.decodedWidth,
      decodedHeight: reader.imageIdentity.decodedHeight,
    }),
    floorVanishingLinePixel: reader.floorVanishingLinePixel,
    sourcePolygon: polygon.polygon,
    truncatedAnchor,
  });
  const withoutEvidence: Omit<
    AfcSr1ValidatedCommonBasisTr0HandoffV1,
    "evidenceCanonicalJson" | "evidenceDigest"
  > = {
    schemaVersion: AFC_SR1_COMMON_BASIS_TR0_HANDOFF_VERSION,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    basisRelation: "identical_input" as const,
    resolvedBasisMode: "identical_input" as const,
    readerBasis: Object.freeze({
      fingerprint: reader.imageIdentity.sha256,
      decodedWidth: reader.imageIdentity.decodedWidth,
      decodedHeight: reader.imageIdentity.decodedHeight,
      orientation: 1 as const,
      receiptEvidenceDigest: reader.receiptEvidenceDigest,
      floorVanishingLinePixel: freezeLine(reader.floorVanishingLinePixel),
    }),
    polygonBasisFingerprint: polygon.basis.fingerprint,
    polygonFingerprint: polygon.polygonFingerprint,
    polygonEvidenceDigest: polygon.evidenceDigest.value,
    truncatedAnchor,
    anchorAuthority: Object.freeze({ ...anchorAuthority }),
    tr0Input,
  };
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(evidencePreimage(withoutEvidence));
  const handoff = Object.freeze({
    ...withoutEvidence,
    evidenceCanonicalJson,
    evidenceDigest: Object.freeze({
      algorithm: "sha256" as const,
      encoding: "hex" as const,
      value: sha256HexUtf8(evidenceCanonicalJson),
    }),
  });
  return Object.freeze({ status: "validated" as const, handoff });
}

export function validateAfcSr1ValidatedCommonBasisTr0Handoff(
  value: unknown
): asserts value is AfcSr1ValidatedCommonBasisTr0HandoffV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "schemaVersion",
    "coordinateSpace",
    "basisRelation",
    "resolvedBasisMode",
    "readerBasis",
    "polygonBasisFingerprint",
    "polygonFingerprint",
    "polygonEvidenceDigest",
    "truncatedAnchor",
    "anchorAuthority",
    "tr0Input",
    "evidenceCanonicalJson",
    "evidenceDigest",
  ]) || value.schemaVersion !== AFC_SR1_COMMON_BASIS_TR0_HANDOFF_VERSION ||
      value.coordinateSpace !== AFC_SR1_COORDINATE_SPACE ||
      value.basisRelation !== "identical_input" ||
      value.resolvedBasisMode !== "identical_input" ||
      !isPlainRecord(value.readerBasis) ||
      !hasExactKeys(value.readerBasis, [
        "fingerprint", "decodedWidth", "decodedHeight", "orientation",
        "receiptEvidenceDigest", "floorVanishingLinePixel",
      ]) ||
      !isSha256(value.readerBasis.fingerprint) ||
      !isPositiveInteger(value.readerBasis.decodedWidth) ||
      !isPositiveInteger(value.readerBasis.decodedHeight) ||
      value.readerBasis.orientation !== 1 ||
      !isSha256(value.readerBasis.receiptEvidenceDigest) ||
      !validLine(value.readerBasis.floorVanishingLinePixel) ||
      !isSha256(value.polygonBasisFingerprint) ||
      value.polygonBasisFingerprint !== value.readerBasis.fingerprint ||
      !isSha256(value.polygonFingerprint) ||
      !isSha256(value.polygonEvidenceDigest) ||
      (value.truncatedAnchor !== "NL" && value.truncatedAnchor !== "NR") ||
      !validAnchorAuthority(value.anchorAuthority) ||
      value.anchorAuthority.truncatedAnchor !== value.truncatedAnchor ||
      !isPlainRecord(value.tr0Input) ||
      !hasExactKeys(value.tr0Input, [
        "analysisImage", "floorVanishingLinePixel", "sourcePolygon", "truncatedAnchor",
      ]) ||
      !isPlainRecord(value.tr0Input.analysisImage) ||
      !hasExactKeys(value.tr0Input.analysisImage, ["decodedWidth", "decodedHeight"]) ||
      value.tr0Input.analysisImage.decodedWidth !== value.readerBasis.decodedWidth ||
      value.tr0Input.analysisImage.decodedHeight !== value.readerBasis.decodedHeight ||
      !validLine(value.tr0Input.floorVanishingLinePixel) ||
      !equalJson(value.tr0Input.floorVanishingLinePixel, value.readerBasis.floorVanishingLinePixel) ||
      value.tr0Input.truncatedAnchor !== value.truncatedAnchor ||
      typeof value.evidenceCanonicalJson !== "string" ||
      !validDigest(value.evidenceDigest)) {
    throw new Error("AFC-SR1 common-basis TR0 handoff: shape_invalid");
  }
  const handoff = value as AfcSr1ValidatedCommonBasisTr0HandoffV1;
  validateAfcSr1SourcePolygon(handoff.tr0Input.sourcePolygon);
  if (fingerprintAfcSr1SourcePolygon(handoff.tr0Input.sourcePolygon) !== handoff.polygonFingerprint) {
    throw new Error("AFC-SR1 common-basis TR0 handoff: polygon_fingerprint_mismatch");
  }
  const { evidenceCanonicalJson, evidenceDigest, ...preimage } = handoff;
  const canonical = canonicalizeRfc8785Jcs(preimage);
  if (evidenceCanonicalJson !== canonical || evidenceDigest.value !== sha256HexUtf8(canonical)) {
    throw new Error("AFC-SR1 common-basis TR0 handoff: evidence_invalid");
  }
}
