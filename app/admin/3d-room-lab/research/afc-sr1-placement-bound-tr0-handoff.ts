import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  validateAfcSr1BasisBoundSourcePolygon,
  type AfcSr1BasisBoundSourcePolygonV1,
  type AfcSr1EvidenceDigestV1,
} from "./afc-sr1-basis-bound-source-polygon";
import type {
  AfcSr1ExplicitAnchorAuthorityV1,
} from "./afc-sr1-common-basis-tr0-handoff";
import type {
  AfcSr1FloorVanishingLineCrossRoomInputV1,
  AfcSr1PixelLineV1,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  normalizeCanonicalLine,
} from "./afc-sr1-homogeneous-geometry";
import {
  AFC_SR1_COORDINATE_SPACE,
  fingerprintAfcSr1SourcePolygon,
  validateAfcSr1SourcePolygon,
  type AfcSr1SourcePolygon,
} from "./afc-sr1-semantic-prior";
import {
  isAfcSr1ValidatedTr2UsableReaderAuthority,
  type AfcSr1ValidatedTr2UsableReaderAuthorityV1,
} from "./afc-sr1-tile-floor-reader-execution";
import {
  isAfcSr1ValidatedTs0ParentChildLineageAuthority,
  validateAfcSr1Ts0ParentChildLineageEvidence,
  type AfcSr1Ts0ParentChildLineageEvidenceV1,
  type AfcSr1ValidatedTs0ParentChildLineageAuthorityV1,
} from "./afc-sr1-ts0-parent-child-lineage-authority";
import {
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
  AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
  AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
  AFC_SR1_TS0_PLACEMENT_ORIENTATION,
  deriveAfcSr1Ts0ChildProjectivePlacementHNorm,
  isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority,
  transferAfcSr1ChildPixelLineToParentPixel,
  type AfcSr1Ts0PlacementDecodedImageBasisV1,
  type AfcSr1Ts0PlacementHNormV1,
  type AfcSr1Ts0PlacementRegistrationMaskIdentityV1,
  type AfcSr1Ts0PlacementTranslationPxV1,
  type AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1,
} from "./afc-sr1-ts0-child-projective-placement";

export const AFC_SR1_PLACEMENT_BOUND_TR0_HANDOFF_VERSION =
  "afc-sr1-placement-bound-tr0-handoff/v1" as const;

export type AfcSr1PlacementBoundTr0HandoffRejectReasonV1 =
  | "invalid_reader_authority"
  | "invalid_placement_authority"
  | "invalid_ts0_lineage"
  | "reader_child_basis_mismatch"
  | "placement_lineage_mismatch"
  | "invalid_basis_bound_polygon"
  | "parent_polygon_basis_mismatch"
  | "non_empty_parent_polygon"
  | "anchor_authority_unresolved"
  | "invalid_anchor_authority"
  | "line_transfer_failed";

export type AfcSr1PlacementBoundTr0HandoffInputV1 = Readonly<{
  readerAuthority: AfcSr1ValidatedTr2UsableReaderAuthorityV1;
  placementAuthority: AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1;
  lineageAuthority: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
  basisBoundSourcePolygon: AfcSr1BasisBoundSourcePolygonV1;
  truncatedAnchor: "NL" | "NR";
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1;
}>;

export type AfcSr1ValidatedPlacementBoundTr0HandoffV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_PLACEMENT_BOUND_TR0_HANDOFF_VERSION;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  basisRelation: "validated_ts0_child_projective_placement";
  readerChildBasis: Readonly<{
    fingerprint: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
    policyVersion: "afc-sr1-ts2-extractor-policy/v4";
    receiptEvidenceDigest: string;
    floorVanishingLinePixel: AfcSr1PixelLineV1;
  }>;
  placement: Readonly<{
    schemaVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION;
    policyVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION;
    transformType: "translation";
    transformDirection: "parent_to_child";
    receiptEvidenceDigest: string;
    sourceImageBasis: AfcSr1Ts0PlacementDecodedImageBasisV1;
    targetImageBasis: AfcSr1Ts0PlacementDecodedImageBasisV1;
    registrationMaskIdentity: AfcSr1Ts0PlacementRegistrationMaskIdentityV1;
    translationPx: AfcSr1Ts0PlacementTranslationPxV1;
    H_norm: AfcSr1Ts0PlacementHNormV1;
  }>;
  parentBasis: AfcSr1Ts0PlacementDecodedImageBasisV1;
  ts0LineageEvidence: AfcSr1Ts0ParentChildLineageEvidenceV1;
  basisBoundSourcePolygon: AfcSr1BasisBoundSourcePolygonV1;
  transferredParentFloorVanishingLinePixel: AfcSr1PixelLineV1;
  truncatedAnchor: "NL" | "NR";
  anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1;
  tr0Input: AfcSr1FloorVanishingLineCrossRoomInputV1;
  evidenceCanonicalJson: string;
  evidenceDigest: AfcSr1EvidenceDigestV1;
}>;

export type AfcSr1PlacementBoundTr0HandoffResultV1 =
  | Readonly<{
      status: "validated";
      handoff: AfcSr1ValidatedPlacementBoundTr0HandoffV1;
    }>
  | Readonly<{
      status: "rejected";
      reason: AfcSr1PlacementBoundTr0HandoffRejectReasonV1;
    }>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ANCHOR_KINDS = new Set([
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
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeRfc8785Jcs(left) === canonicalizeRfc8785Jcs(right);
}

function validLine(value: unknown): value is AfcSr1PixelLineV1 {
  return isPlainRecord(value) && hasExactKeys(value, ["a", "b", "c"]) &&
    finite(value.a) && finite(value.b) && finite(value.c);
}

function validAnchorAuthority(
  value: unknown
): value is AfcSr1ExplicitAnchorAuthorityV1 {
  return isPlainRecord(value) &&
    hasExactKeys(value, ["kind", "truncatedAnchor", "evidenceReference"]) &&
    typeof value.kind === "string" &&
    ANCHOR_KINDS.has(value.kind) &&
    (value.truncatedAnchor === "NL" || value.truncatedAnchor === "NR") &&
    typeof value.evidenceReference === "string" &&
    value.evidenceReference.length > 0;
}

function rejection(
  reason: AfcSr1PlacementBoundTr0HandoffRejectReasonV1
): AfcSr1PlacementBoundTr0HandoffResultV1 {
  return Object.freeze({ status: "rejected" as const, reason });
}

function freezeLine(line: AfcSr1PixelLineV1): AfcSr1PixelLineV1 {
  return Object.freeze({ a: line.a, b: line.b, c: line.c });
}

function freezeBasis(
  basis: AfcSr1Ts0PlacementDecodedImageBasisV1
): AfcSr1Ts0PlacementDecodedImageBasisV1 {
  return Object.freeze({ ...basis });
}

function freezePolygon(polygon: AfcSr1SourcePolygon): AfcSr1SourcePolygon {
  return Object.freeze(polygon.map((point) => Object.freeze({ ...point })) as
    unknown as AfcSr1SourcePolygon);
}

function freezeBasisBoundPolygon(
  value: AfcSr1BasisBoundSourcePolygonV1
): AfcSr1BasisBoundSourcePolygonV1 {
  return Object.freeze({
    ...value,
    polygon: freezePolygon(value.polygon),
    basis: Object.freeze({ ...value.basis }),
    provenance: Object.freeze({ ...value.provenance }),
    evidenceDigest: Object.freeze({ ...value.evidenceDigest }),
  });
}

function freezeHNorm(value: AfcSr1Ts0PlacementHNormV1): AfcSr1Ts0PlacementHNormV1 {
  return Object.freeze(value.map((row) => Object.freeze([...row])) as unknown as
    AfcSr1Ts0PlacementHNormV1);
}

function freezeMask(
  value: AfcSr1Ts0PlacementRegistrationMaskIdentityV1
): AfcSr1Ts0PlacementRegistrationMaskIdentityV1 {
  return Object.freeze({
    ...value,
    polygon: Object.freeze(value.polygon.map((point) =>
      Object.freeze([...point]) as readonly [number, number])),
    rasterization: Object.freeze({
      ...value.rasterization,
      dilationKernel: Object.freeze([9, 9] as const),
    }),
  });
}

function transferSerializedLine(
  childLine: AfcSr1PixelLineV1,
  source: AfcSr1Ts0PlacementDecodedImageBasisV1,
  target: AfcSr1Ts0PlacementDecodedImageBasisV1,
  H: AfcSr1Ts0PlacementHNormV1
): AfcSr1PixelLineV1 | null {
  const lcn = [
    childLine.a * target.decodedWidth,
    childLine.b * target.decodedHeight,
    childLine.c,
  ] as const;
  const lpn = [
    H[0][0] * lcn[0] + H[1][0] * lcn[1] + H[2][0] * lcn[2],
    H[0][1] * lcn[0] + H[1][1] * lcn[1] + H[2][1] * lcn[2],
    H[0][2] * lcn[0] + H[1][2] * lcn[1] + H[2][2] * lcn[2],
  ] as const;
  return normalizeCanonicalLine({
    a: lpn[0] / source.decodedWidth,
    b: lpn[1] / source.decodedHeight,
    c: lpn[2],
  });
}

export function buildAfcSr1PlacementBoundTr0Handoff(
  input: AfcSr1PlacementBoundTr0HandoffInputV1
): AfcSr1PlacementBoundTr0HandoffResultV1 {
  if (!isPlainRecord(input) ||
      !hasExactKeys(input, [
        "readerAuthority", "placementAuthority", "lineageAuthority",
        "basisBoundSourcePolygon", "truncatedAnchor", "anchorAuthority",
      ]) ||
      !isAfcSr1ValidatedTr2UsableReaderAuthority(input.readerAuthority)) {
    return rejection("invalid_reader_authority");
  }
  if (!isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(
    input.placementAuthority
  )) {
    return rejection("invalid_placement_authority");
  }
  if (!isAfcSr1ValidatedTs0ParentChildLineageAuthority(
    input.lineageAuthority
  )) {
    return rejection("invalid_ts0_lineage");
  }

  const reader = input.readerAuthority;
  const placement = input.placementAuthority;
  const lineageEvidence = input.lineageAuthority.evidence;
  if (reader.policyVersion !== "afc-sr1-ts2-extractor-policy/v4") {
    return rejection("reader_child_basis_mismatch");
  }
  const lineageParent = {
    sha256: lineageEvidence.parent.sha256,
    byteCount: lineageEvidence.parent.byteCount,
    decodedWidth: lineageEvidence.parent.decodedWidth,
    decodedHeight: lineageEvidence.parent.decodedHeight,
    orientation: lineageEvidence.parent.orientation,
  };
  const lineageChild = {
    sha256: lineageEvidence.child.sha256,
    byteCount: lineageEvidence.child.byteCount,
    decodedWidth: lineageEvidence.child.decodedWidth,
    decodedHeight: lineageEvidence.child.decodedHeight,
    orientation: lineageEvidence.child.orientation,
  };
  if (reader.imageIdentity.sha256 !== placement.targetImageBasis.sha256 ||
      reader.imageIdentity.decodedWidth !== placement.targetImageBasis.decodedWidth ||
      reader.imageIdentity.decodedHeight !== placement.targetImageBasis.decodedHeight ||
      reader.imageIdentity.orientation !== 1 ||
      reader.imageIdentity.sha256 !== lineageChild.sha256 ||
      reader.imageIdentity.decodedWidth !== lineageChild.decodedWidth ||
      reader.imageIdentity.decodedHeight !== lineageChild.decodedHeight ||
      lineageChild.orientation !== 1) {
    return rejection("reader_child_basis_mismatch");
  }
  if (!equalJson(placement.ts0Lineage, {
        parent: lineageParent,
        child: lineageChild,
      }) ||
      !equalJson(placement.sourceImageBasis, lineageParent) ||
      !equalJson(placement.targetImageBasis, lineageChild)) {
    return rejection("placement_lineage_mismatch");
  }

  try {
    validateAfcSr1BasisBoundSourcePolygon(input.basisBoundSourcePolygon);
  } catch {
    return rejection("invalid_basis_bound_polygon");
  }
  const polygon = input.basisBoundSourcePolygon;
  if (polygon.basis.fingerprint !== placement.sourceImageBasis.sha256 ||
      polygon.basis.decodedWidth !== placement.sourceImageBasis.decodedWidth ||
      polygon.basis.decodedHeight !== placement.sourceImageBasis.decodedHeight ||
      polygon.basis.orientation !== 1 ||
      placement.sourceImageBasis.orientation !== AFC_SR1_TS0_PLACEMENT_ORIENTATION) {
    return rejection("parent_polygon_basis_mismatch");
  }
  if (polygon.provenance.kind !== "empty_room_read") {
    return rejection("non_empty_parent_polygon");
  }
  if (input.anchorAuthority === undefined || input.anchorAuthority === null) {
    return rejection("anchor_authority_unresolved");
  }
  if ((input.truncatedAnchor !== "NL" && input.truncatedAnchor !== "NR") ||
      !validAnchorAuthority(input.anchorAuthority)) {
    return rejection("invalid_anchor_authority");
  }
  if (input.anchorAuthority.truncatedAnchor !== input.truncatedAnchor) {
    return rejection("anchor_authority_unresolved");
  }

  const transferred = transferAfcSr1ChildPixelLineToParentPixel(
    reader.floorVanishingLinePixel,
    placement
  );
  if (transferred === null) return rejection("line_transfer_failed");
  const parentLine = freezeLine(transferred);
  const sourcePolygon = freezePolygon(polygon.polygon);
  const truncatedAnchor = input.truncatedAnchor;
  const anchorAuthority = Object.freeze({ ...input.anchorAuthority });
  const tr0Input: AfcSr1FloorVanishingLineCrossRoomInputV1 = Object.freeze({
    analysisImage: Object.freeze({
      decodedWidth: placement.sourceImageBasis.decodedWidth,
      decodedHeight: placement.sourceImageBasis.decodedHeight,
    }),
    floorVanishingLinePixel: parentLine,
    sourcePolygon,
    truncatedAnchor,
  });
  const serializedPolygon = freezeBasisBoundPolygon(polygon);
  const withoutEvidence: Omit<
    AfcSr1ValidatedPlacementBoundTr0HandoffV1,
    "evidenceCanonicalJson" | "evidenceDigest"
  > = {
    schemaVersion: AFC_SR1_PLACEMENT_BOUND_TR0_HANDOFF_VERSION,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    basisRelation: "validated_ts0_child_projective_placement",
    readerChildBasis: Object.freeze({
      fingerprint: reader.imageIdentity.sha256,
      decodedWidth: reader.imageIdentity.decodedWidth,
      decodedHeight: reader.imageIdentity.decodedHeight,
      orientation: reader.imageIdentity.orientation,
      policyVersion: reader.policyVersion,
      receiptEvidenceDigest: reader.receiptEvidenceDigest,
      floorVanishingLinePixel: freezeLine(reader.floorVanishingLinePixel),
    }),
    placement: Object.freeze({
      schemaVersion: placement.schemaVersion,
      policyVersion: placement.policyVersion,
      transformType: placement.transformType,
      transformDirection: placement.transformDirection,
      receiptEvidenceDigest: placement.receiptEvidenceDigest,
      sourceImageBasis: freezeBasis(placement.sourceImageBasis),
      targetImageBasis: freezeBasis(placement.targetImageBasis),
      registrationMaskIdentity: freezeMask(placement.registrationMaskIdentity),
      translationPx: Object.freeze({ ...placement.translationPx }),
      H_norm: freezeHNorm(placement.H_norm),
    }),
    parentBasis: freezeBasis(placement.sourceImageBasis),
    ts0LineageEvidence: lineageEvidence,
    basisBoundSourcePolygon: serializedPolygon,
    transferredParentFloorVanishingLinePixel: parentLine,
    truncatedAnchor,
    anchorAuthority,
    tr0Input,
  };
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(withoutEvidence);
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

function validateSerializedImageBasis(
  value: unknown
): asserts value is AfcSr1Ts0PlacementDecodedImageBasisV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "sha256", "byteCount", "decodedWidth", "decodedHeight", "orientation",
      ]) ||
      !isSha256(value.sha256) ||
      typeof value.byteCount !== "number" ||
      !Number.isInteger(value.byteCount) ||
      value.byteCount < 0 ||
      !positiveInteger(value.decodedWidth) ||
      !positiveInteger(value.decodedHeight) ||
      value.orientation !== AFC_SR1_TS0_PLACEMENT_ORIENTATION) {
    throw new Error("AFC-SR1 placement-bound TR0 handoff: image_basis_invalid");
  }
}

function validHNorm(value: unknown): value is AfcSr1Ts0PlacementHNormV1 {
  return Array.isArray(value) && value.length === 3 &&
    value.every((row) => Array.isArray(row) && row.length === 3) &&
    (value as unknown[][]).flat().every(finite);
}

export function validateAfcSr1ValidatedPlacementBoundTr0Handoff(
  value: unknown
): asserts value is AfcSr1ValidatedPlacementBoundTr0HandoffV1 {
  const fail = (reason: string): never => {
    throw new Error(`AFC-SR1 placement-bound TR0 handoff: ${reason}`);
  };
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "schemaVersion", "coordinateSpace", "basisRelation", "readerChildBasis",
        "placement", "parentBasis", "ts0LineageEvidence",
        "basisBoundSourcePolygon", "transferredParentFloorVanishingLinePixel",
        "truncatedAnchor", "anchorAuthority", "tr0Input",
        "evidenceCanonicalJson", "evidenceDigest",
      ]) ||
      value.schemaVersion !== AFC_SR1_PLACEMENT_BOUND_TR0_HANDOFF_VERSION ||
      value.coordinateSpace !== AFC_SR1_COORDINATE_SPACE ||
      value.basisRelation !== "validated_ts0_child_projective_placement" ||
      !isPlainRecord(value.readerChildBasis) ||
      !hasExactKeys(value.readerChildBasis, [
        "fingerprint", "decodedWidth", "decodedHeight", "orientation",
        "policyVersion", "receiptEvidenceDigest", "floorVanishingLinePixel",
      ]) ||
      !isSha256(value.readerChildBasis.fingerprint) ||
      !positiveInteger(value.readerChildBasis.decodedWidth) ||
      !positiveInteger(value.readerChildBasis.decodedHeight) ||
      value.readerChildBasis.orientation !== 1 ||
      value.readerChildBasis.policyVersion !== "afc-sr1-ts2-extractor-policy/v4" ||
      !isSha256(value.readerChildBasis.receiptEvidenceDigest) ||
      !validLine(value.readerChildBasis.floorVanishingLinePixel) ||
      !isPlainRecord(value.placement) ||
      !hasExactKeys(value.placement, [
        "schemaVersion", "policyVersion", "transformType", "transformDirection",
        "receiptEvidenceDigest", "sourceImageBasis", "targetImageBasis",
        "registrationMaskIdentity", "translationPx", "H_norm",
      ]) ||
      value.placement.schemaVersion !== AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION ||
      value.placement.policyVersion !==
        AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION ||
      value.placement.transformType !== "translation" ||
      value.placement.transformDirection !== "parent_to_child" ||
      !isSha256(value.placement.receiptEvidenceDigest) ||
      !isPlainRecord(value.placement.translationPx) ||
      !hasExactKeys(value.placement.translationPx, ["tx", "ty"]) ||
      !finite(value.placement.translationPx.tx) ||
      !finite(value.placement.translationPx.ty) ||
      !validHNorm(value.placement.H_norm) ||
      !validLine(value.transferredParentFloorVanishingLinePixel) ||
      (value.truncatedAnchor !== "NL" && value.truncatedAnchor !== "NR") ||
      !validAnchorAuthority(value.anchorAuthority) ||
      value.anchorAuthority.truncatedAnchor !== value.truncatedAnchor ||
      typeof value.evidenceCanonicalJson !== "string" ||
      !isPlainRecord(value.evidenceDigest) ||
      !hasExactKeys(value.evidenceDigest, ["algorithm", "encoding", "value"]) ||
      value.evidenceDigest.algorithm !== "sha256" ||
      value.evidenceDigest.encoding !== "hex" ||
      !isSha256(value.evidenceDigest.value)) {
    fail("shape_invalid");
  }

  const handoff = value as unknown as AfcSr1ValidatedPlacementBoundTr0HandoffV1;
  validateSerializedImageBasis(handoff.placement.sourceImageBasis);
  validateSerializedImageBasis(handoff.placement.targetImageBasis);
  validateSerializedImageBasis(handoff.parentBasis);
  try {
    validateAfcSr1Ts0ParentChildLineageEvidence(
      handoff.ts0LineageEvidence
    );
  } catch {
    fail("lineage_evidence_invalid");
  }
  try {
    validateAfcSr1BasisBoundSourcePolygon(
      handoff.basisBoundSourcePolygon
    );
  } catch {
    fail("basis_bound_polygon_invalid");
  }
  const mask = handoff.placement.registrationMaskIdentity;
  if (!isPlainRecord(mask) ||
      !hasExactKeys(mask, [
        "coordinateSpace", "role", "evidenceLabel", "polygon", "rasterization",
        "parentUsableMaskSha256", "childUsableMaskSha256", "maskDigest",
      ]) ||
      mask.coordinateSpace !== AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE ||
      mask.role !== AFC_SR1_TS0_PLACEMENT_MASK_ROLE ||
      (mask.evidenceLabel !==
        "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY" &&
       mask.evidenceLabel !== "NON_AUTHORITATIVE_RESEARCH_MASK_ONLY") ||
      !Array.isArray(mask.polygon) ||
      mask.polygon.length < 3 ||
      !mask.polygon.every((point) =>
        Array.isArray(point) && point.length === 2 && point.every(finite)) ||
      !isPlainRecord(mask.rasterization) ||
      !hasExactKeys(mask.rasterization, [
        "pixelConversion", "dilationKernel", "dilationIterations",
        "usableMaskConvention",
      ]) ||
      mask.rasterization.pixelConversion !== "int(round(norm * dimension))" ||
      !equalJson(mask.rasterization.dilationKernel, [9, 9]) ||
      mask.rasterization.dilationIterations !== 2 ||
      mask.rasterization.usableMaskConvention !== "inverse_uint8_255" ||
      !isSha256(mask.parentUsableMaskSha256) ||
      !isSha256(mask.childUsableMaskSha256) ||
      !isSha256(mask.maskDigest)) {
    fail("mask_identity_invalid");
  }
  const { maskDigest, ...maskPreimage } = mask;
  if (maskDigest !== sha256HexUtf8(canonicalizeRfc8785Jcs(maskPreimage))) {
    fail("mask_identity_invalid");
  }

  const placement = handoff.placement as unknown as
    AfcSr1ValidatedPlacementBoundTr0HandoffV1["placement"];
  const expectedH = deriveAfcSr1Ts0ChildProjectivePlacementHNorm(
    placement.sourceImageBasis,
    placement.targetImageBasis,
    placement.translationPx
  );
  const lineageParent = handoff.ts0LineageEvidence.parent;
  const lineageChild = handoff.ts0LineageEvidence.child;
  if (!equalJson(placement.H_norm, expectedH) ||
      !equalJson(handoff.parentBasis, placement.sourceImageBasis) ||
      handoff.readerChildBasis.fingerprint !== placement.targetImageBasis.sha256 ||
      handoff.readerChildBasis.decodedWidth !== placement.targetImageBasis.decodedWidth ||
      handoff.readerChildBasis.decodedHeight !== placement.targetImageBasis.decodedHeight ||
      lineageParent.sha256 !== placement.sourceImageBasis.sha256 ||
      lineageParent.byteCount !== placement.sourceImageBasis.byteCount ||
      lineageParent.decodedWidth !== placement.sourceImageBasis.decodedWidth ||
      lineageParent.decodedHeight !== placement.sourceImageBasis.decodedHeight ||
      lineageParent.orientation !== placement.sourceImageBasis.orientation ||
      lineageChild.sha256 !== placement.targetImageBasis.sha256 ||
      lineageChild.byteCount !== placement.targetImageBasis.byteCount ||
      lineageChild.decodedWidth !== placement.targetImageBasis.decodedWidth ||
      lineageChild.decodedHeight !== placement.targetImageBasis.decodedHeight ||
      lineageChild.orientation !== placement.targetImageBasis.orientation) {
    fail("basis_binding_invalid");
  }
  const expectedLine = transferSerializedLine(
    handoff.readerChildBasis.floorVanishingLinePixel as AfcSr1PixelLineV1,
    placement.sourceImageBasis,
    placement.targetImageBasis,
    placement.H_norm
  );
  if (expectedLine === null ||
      !equalJson(expectedLine, handoff.transferredParentFloorVanishingLinePixel)) {
    fail("line_transfer_invalid");
  }
  if (!isPlainRecord(handoff.tr0Input) ||
      !hasExactKeys(handoff.tr0Input, [
        "analysisImage", "floorVanishingLinePixel", "sourcePolygon", "truncatedAnchor",
      ]) ||
      !isPlainRecord(handoff.tr0Input.analysisImage) ||
      !hasExactKeys(handoff.tr0Input.analysisImage, ["decodedWidth", "decodedHeight"]) ||
      handoff.tr0Input.analysisImage.decodedWidth !== placement.sourceImageBasis.decodedWidth ||
      handoff.tr0Input.analysisImage.decodedHeight !== placement.sourceImageBasis.decodedHeight ||
      !equalJson(
        handoff.tr0Input.floorVanishingLinePixel,
        handoff.transferredParentFloorVanishingLinePixel
      ) ||
      handoff.tr0Input.truncatedAnchor !== handoff.truncatedAnchor) {
    fail("tr0_input_invalid");
  }
  validateAfcSr1SourcePolygon(handoff.tr0Input.sourcePolygon);
  if (fingerprintAfcSr1SourcePolygon(handoff.tr0Input.sourcePolygon) !==
      handoff.basisBoundSourcePolygon.polygonFingerprint ||
      !equalJson(
        handoff.tr0Input.sourcePolygon,
        handoff.basisBoundSourcePolygon.polygon
      ) ||
      handoff.basisBoundSourcePolygon.basis.fingerprint !==
        placement.sourceImageBasis.sha256 ||
      handoff.basisBoundSourcePolygon.basis.decodedWidth !==
        placement.sourceImageBasis.decodedWidth ||
      handoff.basisBoundSourcePolygon.basis.decodedHeight !==
        placement.sourceImageBasis.decodedHeight ||
      handoff.basisBoundSourcePolygon.basis.orientation !== 1 ||
      handoff.basisBoundSourcePolygon.provenance.kind !== "empty_room_read") {
    fail("polygon_fingerprint_mismatch");
  }

  const {
    evidenceCanonicalJson,
    evidenceDigest,
    ...preimage
  } = handoff;
  const canonical = canonicalizeRfc8785Jcs(preimage);
  if (evidenceCanonicalJson !== canonical ||
      evidenceDigest.value !== sha256HexUtf8(canonical)) {
    fail("evidence_invalid");
  }
}
