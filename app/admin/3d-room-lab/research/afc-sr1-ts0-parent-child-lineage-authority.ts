import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  classifyAfcR3cImagePairCompatibility,
  type AfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import type {
  AfcSr1TileGridScaffoldImageIdentity,
  AfcSr1TileGridScaffoldProvenance,
  AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";

export const AFC_SR1_TS0_PARENT_CHILD_LINEAGE_EVIDENCE_VERSION =
  "afc-sr1-ts0-parent-child-lineage-evidence/v1" as const;

export type AfcSr1Ts0ParentChildLineageEvidenceV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_TS0_PARENT_CHILD_LINEAGE_EVIDENCE_VERSION;
  status: "generated";
  parent: AfcSr1TileGridScaffoldImageIdentity;
  child: AfcSr1TileGridScaffoldImageIdentity & Readonly<{ mimeType: "image/png" }>;
  provenance: AfcSr1TileGridScaffoldProvenance;
  compatibility: AfcR3cImagePairCompatibility;
  evidenceCanonicalJson: string;
  evidenceDigest: Readonly<{
    algorithm: "sha256";
    encoding: "hex";
    value: string;
  }>;
}>;

declare const AFC_SR1_VALIDATED_TS0_PARENT_CHILD_LINEAGE_AUTHORITY:
  unique symbol;

export type AfcSr1ValidatedTs0ParentChildLineageAuthorityV1 = Readonly<{
  evidence: AfcSr1Ts0ParentChildLineageEvidenceV1;
  lineageEvidenceDigest: string;
  readonly [AFC_SR1_VALIDATED_TS0_PARENT_CHILD_LINEAGE_AUTHORITY]:
    "afc-sr1-validated-ts0-parent-child-lineage-authority/v1";
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const lineageAuthorities = new WeakSet<object>();

function fail(reason: string): never {
  throw new Error(`AFC-SR1 TS0 parent-child lineage: ${reason}`);
}

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
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeRfc8785Jcs(left) === canonicalizeRfc8785Jcs(right);
}

function validateIdentity(
  value: unknown,
  requiredPng = false
): asserts value is AfcSr1TileGridScaffoldImageIdentity {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "sha256", "byteCount", "decodedWidth", "decodedHeight", "mimeType",
        "orientation",
      ]) ||
      !isSha256(value.sha256) ||
      !positiveInteger(value.byteCount) ||
      !positiveInteger(value.decodedWidth) ||
      !positiveInteger(value.decodedHeight) ||
      (value.mimeType !== "image/jpeg" &&
       value.mimeType !== "image/png" &&
       value.mimeType !== "image/webp") ||
      (requiredPng && value.mimeType !== "image/png") ||
      value.orientation !== 1) {
    fail("image_identity_invalid");
  }
}

function validateProvenance(
  value: unknown
): asserts value is AfcSr1TileGridScaffoldProvenance {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "generatorId", "profileId", "researchPreset", "requestedModelId",
        "runId", "generatedAt", "appliedAspectRatio", "imageTransport",
        "generationStatus",
      ]) ||
      value.generatorId !== "vibode-tile-grid-scaffold/stage2/v1" ||
      value.profileId !== "afc-sr1-tile-grid-scaffold/v1" ||
      value.researchPreset !== "tile_grid_scaffold" ||
      value.requestedModelId !== "NBP" ||
      typeof value.runId !== "string" ||
      value.runId.length === 0 ||
      typeof value.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.generatedAt)) ||
      new Date(value.generatedAt).toISOString() !== value.generatedAt ||
      (value.appliedAspectRatio !== null &&
       (typeof value.appliedAspectRatio !== "string" ||
        !/^[A-Za-z0-9:._-]{1,32}$/.test(value.appliedAspectRatio))) ||
      (value.imageTransport !== "data_url" && value.imageTransport !== "http_url") ||
      value.generationStatus !== "generated") {
    fail("provenance_invalid");
  }
}

function validateCompatibility(
  value: unknown,
  parent: AfcSr1TileGridScaffoldImageIdentity,
  child: AfcSr1TileGridScaffoldImageIdentity
): asserts value is AfcR3cImagePairCompatibility {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "version", "tier", "originalDecodedDimensions", "inputDecodedDimensions",
        "originalOrientation", "inputOrientation", "originalAspect", "inputAspect",
        "relativeAspectErrorRaw", "relativeAspectError", "reason",
      ]) ||
      value.tier === "incompatible") {
    fail("compatibility_invalid");
  }
  const expected = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: parent.sha256,
      decodedWidth: parent.decodedWidth,
      decodedHeight: parent.decodedHeight,
      orientation: parent.orientation,
    },
    {
      fingerprint: child.sha256,
      decodedWidth: child.decodedWidth,
      decodedHeight: child.decodedHeight,
      orientation: child.orientation,
    }
  );
  if (!equalJson(value, expected)) fail("compatibility_mismatch");
}

function freezeIdentity<T extends AfcSr1TileGridScaffoldImageIdentity>(
  value: T
): T {
  return Object.freeze({ ...value });
}

function freezeCompatibility(
  value: AfcR3cImagePairCompatibility
): AfcR3cImagePairCompatibility {
  return Object.freeze({
    ...value,
    originalDecodedDimensions: value.originalDecodedDimensions === null
      ? null
      : Object.freeze({ ...value.originalDecodedDimensions }),
    inputDecodedDimensions: value.inputDecodedDimensions === null
      ? null
      : Object.freeze({ ...value.inputDecodedDimensions }),
  });
}

async function assertDecodedIdentity(
  bytes: Uint8Array,
  identity: AfcSr1TileGridScaffoldImageIdentity
): Promise<void> {
  const metadata = await sharp(Buffer.from(bytes)).metadata();
  const mimeType = metadata.format === "jpeg"
    ? "image/jpeg"
    : metadata.format === "png"
      ? "image/png"
      : metadata.format === "webp"
        ? "image/webp"
        : null;
  if (metadata.width !== identity.decodedWidth ||
      metadata.height !== identity.decodedHeight ||
      (metadata.orientation ?? 1) !== identity.orientation ||
      mimeType !== identity.mimeType) {
    fail("decoded_image_identity_mismatch");
  }
}

function stableEvidencePreimage(
  value: Omit<
    AfcSr1Ts0ParentChildLineageEvidenceV1,
    "evidenceCanonicalJson" | "evidenceDigest"
  >
) {
  return value;
}

export async function validateAfcSr1GeneratedTs0ParentChildLineage(
  result: AfcSr1TileGridScaffoldResult,
  parentBytes: Uint8Array,
  childBytes: Uint8Array
): Promise<AfcSr1ValidatedTs0ParentChildLineageAuthorityV1> {
  if (!isPlainRecord(result) ||
      !hasExactKeys(result, [
        "status", "input", "tiled", "provenance", "compatibility",
      ]) ||
      result.status !== "generated" ||
      !isPlainRecord(result.tiled) ||
      !hasExactKeys(result.tiled, ["base64", "identity"])) {
    fail("generated_result_invalid");
  }
  validateIdentity(result.input);
  validateIdentity(result.tiled.identity, true);
  validateProvenance(result.provenance);
  validateCompatibility(result.compatibility, result.input, result.tiled.identity);

  if (!(parentBytes instanceof Uint8Array) ||
      !(childBytes instanceof Uint8Array) ||
      parentBytes.byteLength === 0 ||
      childBytes.byteLength === 0 ||
      typeof result.tiled.base64 !== "string" ||
      result.tiled.base64.length === 0 ||
      result.tiled.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(result.tiled.base64) ||
      Buffer.from(result.tiled.base64, "base64").toString("base64") !==
        result.tiled.base64) {
    fail("exact_bytes_invalid");
  }
  const decodedBase64 = Buffer.from(result.tiled.base64, "base64");
  if (!decodedBase64.equals(Buffer.from(childBytes)) ||
      result.input.byteCount !== parentBytes.byteLength ||
      result.tiled.identity.byteCount !== childBytes.byteLength ||
      result.input.sha256 !==
        createHash("sha256").update(parentBytes).digest("hex") ||
      result.tiled.identity.sha256 !==
        createHash("sha256").update(childBytes).digest("hex")) {
    fail("exact_bytes_identity_mismatch");
  }
  await Promise.all([
    assertDecodedIdentity(parentBytes, result.input),
    assertDecodedIdentity(childBytes, result.tiled.identity),
  ]);

  const withoutEvidence = {
    schemaVersion: AFC_SR1_TS0_PARENT_CHILD_LINEAGE_EVIDENCE_VERSION,
    status: "generated" as const,
    parent: freezeIdentity(result.input),
    child: freezeIdentity(result.tiled.identity),
    provenance: Object.freeze({ ...result.provenance }),
    compatibility: freezeCompatibility(result.compatibility),
  };
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(
    stableEvidencePreimage(withoutEvidence)
  );
  const evidence = Object.freeze({
    ...withoutEvidence,
    evidenceCanonicalJson,
    evidenceDigest: Object.freeze({
      algorithm: "sha256" as const,
      encoding: "hex" as const,
      value: sha256HexUtf8(evidenceCanonicalJson),
    }),
  });
  const authority = Object.freeze({
    evidence,
    lineageEvidenceDigest: evidence.evidenceDigest.value,
  }) as AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
  lineageAuthorities.add(authority);
  return authority;
}

export function isAfcSr1ValidatedTs0ParentChildLineageAuthority(
  value: unknown
): value is AfcSr1ValidatedTs0ParentChildLineageAuthorityV1 {
  return typeof value === "object" && value !== null &&
    lineageAuthorities.has(value);
}

export function validateAfcSr1Ts0ParentChildLineageEvidence(
  value: unknown
): asserts value is AfcSr1Ts0ParentChildLineageEvidenceV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "schemaVersion", "status", "parent", "child", "provenance",
        "compatibility", "evidenceCanonicalJson", "evidenceDigest",
      ]) ||
      value.schemaVersion !== AFC_SR1_TS0_PARENT_CHILD_LINEAGE_EVIDENCE_VERSION ||
      value.status !== "generated") {
    fail("serialized_evidence_invalid");
  }
  validateIdentity(value.parent);
  validateIdentity(value.child, true);
  validateProvenance(value.provenance);
  validateCompatibility(value.compatibility, value.parent, value.child);
  if (!isPlainRecord(value.evidenceDigest) ||
      !hasExactKeys(value.evidenceDigest, ["algorithm", "encoding", "value"]) ||
      value.evidenceDigest.algorithm !== "sha256" ||
      value.evidenceDigest.encoding !== "hex" ||
      !isSha256(value.evidenceDigest.value) ||
      typeof value.evidenceCanonicalJson !== "string") {
    fail("serialized_evidence_invalid");
  }
  const { evidenceCanonicalJson, evidenceDigest, ...preimage } = value;
  const canonical = canonicalizeRfc8785Jcs(preimage);
  if (evidenceCanonicalJson !== canonical ||
      evidenceDigest.value !== sha256HexUtf8(canonical)) {
    fail("serialized_evidence_digest_invalid");
  }
}
