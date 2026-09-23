import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  AFC_SR1_COORDINATE_SPACE,
  fingerprintAfcSr1SourcePolygon,
  validateAfcSr1ImageBasis,
  validateAfcSr1SourcePolygon,
  type AfcSr1ImageBasisV1,
  type AfcSr1SourcePolygon,
} from "./afc-sr1-semantic-prior";

export const AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION =
  "afc-sr1-basis-bound-source-polygon/v1" as const;

export type AfcSr1SourcePolygonProvenanceKindV1 =
  | "empty_room_read"
  | "lab_floor_capture"
  | "explicit_development_capture"
  | "bound_floor_support"
  | "gt_derived_same_image_capture";

export type AfcSr1SourcePolygonProvenanceV1 = Readonly<{
  kind: AfcSr1SourcePolygonProvenanceKindV1;
  evidenceReference: string | null;
}>;

export type AfcSr1EvidenceDigestV1 = Readonly<{
  algorithm: "sha256";
  encoding: "hex";
  value: string;
}>;

export type AfcSr1BasisBoundSourcePolygonV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  polygon: AfcSr1SourcePolygon;
  basis: AfcSr1ImageBasisV1;
  polygonFingerprint: string;
  provenance: AfcSr1SourcePolygonProvenanceV1;
  evidenceCanonicalJson: string;
  evidenceDigest: AfcSr1EvidenceDigestV1;
}>;

export type AfcSr1BasisBoundSourcePolygonInputV1 = Readonly<{
  polygon: AfcSr1SourcePolygon;
  basis: AfcSr1ImageBasisV1;
  provenance: AfcSr1SourcePolygonProvenanceV1;
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PROVENANCE_KINDS = new Set<AfcSr1SourcePolygonProvenanceKindV1>([
  "empty_room_read",
  "lab_floor_capture",
  "explicit_development_capture",
  "bound_floor_support",
  "gt_derived_same_image_capture",
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

function fail(reason: string): never {
  throw new Error(`AFC-SR1 basis-bound source polygon: ${reason}`);
}

function validateProvenance(value: unknown): asserts value is AfcSr1SourcePolygonProvenanceV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["kind", "evidenceReference"]) ||
      typeof value.kind !== "string" || !PROVENANCE_KINDS.has(value.kind as AfcSr1SourcePolygonProvenanceKindV1) ||
      (value.evidenceReference !== null &&
       (typeof value.evidenceReference !== "string" || value.evidenceReference.length === 0))) {
    fail("provenance_invalid");
  }
}

function validateDigest(value: unknown): asserts value is AfcSr1EvidenceDigestV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["algorithm", "encoding", "value"]) ||
      value.algorithm !== "sha256" || value.encoding !== "hex" ||
      typeof value.value !== "string" || !SHA256_HEX.test(value.value)) {
    fail("evidence_digest_invalid");
  }
}

function freezePolygon(polygon: AfcSr1SourcePolygon): AfcSr1SourcePolygon {
  return Object.freeze(polygon.map((point) => Object.freeze({ x: point.x, y: point.y })) as
    unknown as AfcSr1SourcePolygon);
}

function freezeBasis(basis: AfcSr1ImageBasisV1): AfcSr1ImageBasisV1 {
  return Object.freeze({ ...basis });
}

function freezeProvenance(
  provenance: AfcSr1SourcePolygonProvenanceV1
): AfcSr1SourcePolygonProvenanceV1 {
  return Object.freeze({ ...provenance });
}

function evidencePreimage(input: Readonly<{
  polygon: AfcSr1SourcePolygon;
  basis: AfcSr1ImageBasisV1;
  polygonFingerprint: string;
  provenance: AfcSr1SourcePolygonProvenanceV1;
}>) {
  return {
    schemaVersion: AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    polygon: input.polygon,
    basis: input.basis,
    polygonFingerprint: input.polygonFingerprint,
    provenance: input.provenance,
  };
}

export function buildAfcSr1BasisBoundSourcePolygon(
  input: AfcSr1BasisBoundSourcePolygonInputV1
): AfcSr1BasisBoundSourcePolygonV1 {
  validateAfcSr1SourcePolygon(input.polygon);
  validateAfcSr1ImageBasis(input.basis);
  validateProvenance(input.provenance);
  const polygon = freezePolygon(input.polygon);
  const basis = freezeBasis(input.basis);
  const provenance = freezeProvenance(input.provenance);
  const polygonFingerprint = fingerprintAfcSr1SourcePolygon(polygon);
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(evidencePreimage({
    polygon,
    basis,
    polygonFingerprint,
    provenance,
  }));
  return Object.freeze({
    schemaVersion: AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    polygon,
    basis,
    polygonFingerprint,
    provenance,
    evidenceCanonicalJson,
    evidenceDigest: Object.freeze({
      algorithm: "sha256" as const,
      encoding: "hex" as const,
      value: sha256HexUtf8(evidenceCanonicalJson),
    }),
  });
}

export function validateAfcSr1BasisBoundSourcePolygon(
  value: unknown
): asserts value is AfcSr1BasisBoundSourcePolygonV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "schemaVersion",
    "coordinateSpace",
    "polygon",
    "basis",
    "polygonFingerprint",
    "provenance",
    "evidenceCanonicalJson",
    "evidenceDigest",
  ]) || value.schemaVersion !== AFC_SR1_BASIS_BOUND_SOURCE_POLYGON_VERSION ||
      value.coordinateSpace !== AFC_SR1_COORDINATE_SPACE ||
      typeof value.polygonFingerprint !== "string" || !SHA256_HEX.test(value.polygonFingerprint) ||
      typeof value.evidenceCanonicalJson !== "string") {
    fail("shape_invalid");
  }
  validateAfcSr1SourcePolygon(value.polygon);
  validateAfcSr1ImageBasis(value.basis);
  validateProvenance(value.provenance);
  validateDigest(value.evidenceDigest);
  if (fingerprintAfcSr1SourcePolygon(value.polygon) !== value.polygonFingerprint) {
    fail("polygon_fingerprint_mismatch");
  }
  const canonical = canonicalizeRfc8785Jcs(evidencePreimage({
    polygon: value.polygon,
    basis: value.basis,
    polygonFingerprint: value.polygonFingerprint,
    provenance: value.provenance,
  }));
  if (value.evidenceCanonicalJson !== canonical) fail("evidence_canonical_json_mismatch");
  if (sha256HexUtf8(canonical) !== value.evidenceDigest.value) fail("evidence_digest_mismatch");
}
