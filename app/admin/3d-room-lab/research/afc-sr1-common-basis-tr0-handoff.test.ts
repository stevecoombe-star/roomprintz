import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  buildAfcSr1BasisBoundSourcePolygon,
} from "./afc-sr1-basis-bound-source-polygon";
import {
  buildAfcSr1CommonBasisTr0Handoff,
  validateAfcSr1ValidatedCommonBasisTr0Handoff,
} from "./afc-sr1-common-basis-tr0-handoff";
import { deriveAfcSr1FloorVanishingLineCrossRoom } from "./afc-sr1-floor-vanishing-line-cross-room";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";
import type { AfcSr1Tr2ReaderReceipt } from "./afc-sr1-tile-floor-reader-execution";

const readerFingerprint = createHash("sha256").update("raw-reader-image").digest("hex");
const parentFingerprint = createHash("sha256").update("empty-parent-image").digest("hex");
const otherFingerprint = createHash("sha256").update("same-size-different-image").digest("hex");
const polygon: AfcSr1SourcePolygon = Object.freeze([
  Object.freeze({ x: 0.1, y: 0.8 }),
  Object.freeze({ x: 0.9, y: 0.9 }),
  Object.freeze({ x: 0.7, y: 0.4 }),
  Object.freeze({ x: 0.3, y: 0.4 }),
]) as AfcSr1SourcePolygon;
const line = Object.freeze({ a: 0, b: 1 / 500, c: -0.8 });

function receipt(fingerprint = readerFingerprint): AfcSr1Tr2ReaderReceipt {
  const imageIdentity = {
    sha256: fingerprint,
    byteCount: 101,
    decodedWidth: 1000,
    decodedHeight: 500,
  };
  const preimage = {
    schemaVersion: "afc-sr1-tr2-tile-floor-reader-result/v3",
    researchProfile: "afc-sr1-tr2-tile-floor-reader/v3",
    policyVersion: "afc-sr1-ts2-extractor-policy/v3",
    status: "usable",
    image: imageIdentity,
    floorVanishingLinePixel: line,
  };
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  return {
    schemaVersion: preimage.schemaVersion,
    researchProfile: preimage.researchProfile,
    policyVersion: preimage.policyVersion,
    status: "usable",
    imageIdentity,
    floorVanishingLinePixel: line,
    evidenceCanonicalJson,
    evidenceDigest: {
      algorithm: "sha256",
      encoding: "hex",
      value: sha256HexUtf8(evidenceCanonicalJson),
    },
  } as AfcSr1Tr2ReaderReceipt;
}

function bound(fingerprint = readerFingerprint, width = 1000, height = 500) {
  return buildAfcSr1BasisBoundSourcePolygon({
    polygon,
    basis: { fingerprint, decodedWidth: width, decodedHeight: height, orientation: 1 },
    provenance: { kind: "explicit_development_capture", evidenceReference: "synthetic/A" },
  });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    readerReceipt: receipt(),
    readerImageKind: "raw_input",
    basisBoundSourcePolygon: bound(),
    basisRelation: "identical_input",
    truncatedAnchor: "NL",
    anchorAuthority: {
      kind: "predeclared_truncated_anchor",
      truncatedAnchor: "NL",
      evidenceReference: "synthetic/anchor-NL",
    },
    ...overrides,
  };
}

function rejected(overrides: Record<string, unknown>, reason: string) {
  const result = buildAfcSr1CommonBasisTr0Handoff(input(overrides));
  assert.deepEqual(result, { status: "rejected", reason });
}

test("RAW exact image basis validates and opens unchanged TR0", () => {
  const result = buildAfcSr1CommonBasisTr0Handoff(input());
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  validateAfcSr1ValidatedCommonBasisTr0Handoff(result.handoff);
  assert.equal(result.handoff.readerBasis.fingerprint, readerFingerprint);
  assert.equal(result.handoff.readerBasis.orientation, 1);
  assert.equal(result.handoff.tr0Input.analysisImage.decodedWidth, 1000);
  assert.equal(deriveAfcSr1FloorVanishingLineCrossRoom(result.handoff.tr0Input).status, "usable");
});

test("same strict inputs replay to an exact handoff identity", () => {
  const first = buildAfcSr1CommonBasisTr0Handoff(input());
  const second = buildAfcSr1CommonBasisTr0Handoff(input());
  assert.deepEqual(first, second);
});

test("same dimensions, aspect compatibility, or missing basis do not authorize TR0", () => {
  rejected({ basisBoundSourcePolygon: bound(otherFingerprint) }, "reader_basis_mismatch");
  rejected({ basisBoundSourcePolygon: bound(otherFingerprint, 2000, 1000) }, "reader_basis_mismatch");
  rejected({ basisBoundSourcePolygon: undefined }, "invalid_basis_bound_polygon");
});

test("TS0 child with parent-bound or exact-grid parent polygon fails projective basis proof", () => {
  rejected({
    readerImageKind: "ts0_child",
    basisBoundSourcePolygon: bound(parentFingerprint),
  }, "projective_basis_unproven");
  rejected({
    readerImageKind: "ts0_child",
    basisBoundSourcePolygon: bound(parentFingerprint, 1000, 500),
  }, "projective_basis_unproven");
  rejected({
    readerImageKind: "ts0_child",
    basisBoundSourcePolygon: bound(otherFingerprint),
  }, "projective_basis_unproven");
});

test("only explicit NL and NR anchor authorities open v1", () => {
  for (const truncatedAnchor of ["NL", "NR"] as const) {
    const result = buildAfcSr1CommonBasisTr0Handoff(input({
      truncatedAnchor,
      anchorAuthority: {
        kind: "gt_adjustable_corner_derived",
        truncatedAnchor,
        evidenceReference: `synthetic/${truncatedAnchor}`,
      },
    }));
    assert.equal(result.status, "validated");
  }
  rejected({ anchorAuthority: undefined }, "anchor_authority_unresolved");
  rejected({
    anchorAuthority: {
      kind: "unknown",
      truncatedAnchor: "NL",
      evidenceReference: "synthetic/unknown",
    },
  }, "invalid_anchor_authority");
  rejected({
    anchorAuthority: {
      kind: "FROZEN_DEFAULT_NL",
      truncatedAnchor: "NL",
      evidenceReference: "synthetic/default",
    },
  }, "invalid_anchor_authority");
  rejected({
    anchorAuthority: {
      kind: "predeclared_truncated_anchor",
      truncatedAnchor: "NR",
      evidenceReference: "synthetic/wrong-anchor",
    },
  }, "anchor_authority_unresolved");
});

test("unsupported relation and tampered reader or bound-polygon evidence fail closed", () => {
  rejected({ basisRelation: "certified_placement" }, "unsupported_basis_relation");
  const tamperedReceipt = structuredClone(receipt()) as any;
  tamperedReceipt.imageIdentity.sha256 = otherFingerprint;
  rejected({ readerReceipt: tamperedReceipt }, "invalid_reader_receipt");

  const tamperedPolygon = structuredClone(bound()) as any;
  tamperedPolygon.basis.fingerprint = otherFingerprint;
  rejected({ basisBoundSourcePolygon: tamperedPolygon }, "invalid_basis_bound_polygon");
});

test("validated handoff rejects individual evidence tampering", () => {
  const result = buildAfcSr1CommonBasisTr0Handoff(input());
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  for (const mutate of [
    (value: any) => { value.tr0Input.sourcePolygon[0].x = 0.11; },
    (value: any) => { value.polygonBasisFingerprint = otherFingerprint; },
    (value: any) => { value.basisRelation = "certified_placement"; },
    (value: any) => { value.truncatedAnchor = "NR"; },
    (value: any) => { value.anchorAuthority.evidenceReference = "tampered"; },
    (value: any) => { value.evidenceCanonicalJson += " "; },
    (value: any) => { value.evidenceDigest.value = otherFingerprint; },
  ]) {
    const value = structuredClone(result.handoff) as any;
    mutate(value);
    assert.throws(() => validateAfcSr1ValidatedCommonBasisTr0Handoff(value));
  }
});
