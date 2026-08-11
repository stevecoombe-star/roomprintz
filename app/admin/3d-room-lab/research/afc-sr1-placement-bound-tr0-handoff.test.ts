/* eslint-disable @typescript-eslint/no-explicit-any */
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
  type AfcSr1CommonBasisTr0HandoffInputV1,
} from "./afc-sr1-common-basis-tr0-handoff";
import {
  deriveAfcSr1FloorVanishingLineCrossRoom,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  buildAfcSr1PlacementBoundTr0Handoff,
  validateAfcSr1ValidatedPlacementBoundTr0Handoff,
  type AfcSr1PlacementBoundTr0HandoffInputV1,
} from "./afc-sr1-placement-bound-tr0-handoff";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";
import {
  AFC_SR1_TR2_V3_POLICY_VERSION,
  AFC_SR1_TR2_V3_RESEARCH_PROFILE,
  AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION,
  getAfcSr1ValidatedTr2UsableReaderAuthority,
  validateAfcSr1Tr2ReaderReceipt,
} from "./afc-sr1-tile-floor-reader-execution";
import {
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
  AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
  AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
  AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1,
  deriveAfcSr1Ts0ChildProjectivePlacementHNorm,
  getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority,
  validateAfcSr1Ts0ChildProjectivePlacementReceipt,
} from "./afc-sr1-ts0-child-projective-placement";
import {
  makeSyntheticGeneratedTs0Lineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority.test-helpers";
import type {
  AfcSr1ValidatedTs0ParentChildLineageAuthorityV1,
} from "./afc-sr1-ts0-parent-child-lineage-authority";

const otherChildBytes = new TextEncoder().encode("different-ts0-child");
let parentBytes!: Uint8Array;
let childBytes!: Uint8Array;
let childSha!: string;
let parentSha!: string;
let lineageAuthority!: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
let sourceImageBasis!: Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;
let targetImageBasis!: typeof sourceImageBasis;
let lineage!: Readonly<{
  parent: typeof sourceImageBasis;
  child: typeof targetImageBasis;
}>;
const maskSha = createHash("sha256").update("registration-mask-A-B-D").digest("hex");
const polygon: AfcSr1SourcePolygon = Object.freeze([
  Object.freeze({ x: 0.1, y: 0.8 }),
  Object.freeze({ x: 0.9, y: 0.9 }),
  Object.freeze({ x: 0.7, y: 0.4 }),
  Object.freeze({ x: 0.3, y: 0.4 }),
]) as AfcSr1SourcePolygon;
const childFloorLine = Object.freeze({
  a: 0,
  b: 1 / 400,
  c: -370 / 400,
});

test.before(async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 1000,
    parentHeight: 500,
    childWidth: 800,
    childHeight: 400,
  });
  parentBytes = fixture.parentBytes;
  childBytes = fixture.childBytes;
  childSha = fixture.child.sha256;
  parentSha = fixture.parent.sha256;
  lineageAuthority = fixture.authority;
  sourceImageBasis = Object.freeze({
    sha256: parentSha,
    byteCount: parentBytes.byteLength,
    decodedWidth: 1000,
    decodedHeight: 500,
    orientation: 1,
  });
  targetImageBasis = Object.freeze({
    sha256: childSha,
    byteCount: childBytes.byteLength,
    decodedWidth: 800,
    decodedHeight: 400,
    orientation: 1,
  });
  lineage = Object.freeze({
    parent: sourceImageBasis,
    child: targetImageBasis,
  });
});

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readerReceipt(bytes = childBytes) {
  const imageIdentity = {
    sha256: sha256(bytes),
    byteCount: bytes.byteLength,
    decodedWidth: 800,
    decodedHeight: 400,
  };
  const roiBase = {
    coordinateSpace: "source-normalized/v1" as const,
    polygon: polygon.map(({ x, y }) => [x, y] as const),
  };
  const roiIdentity = {
    ...roiBase,
    roiDigest: sha256HexUtf8(canonicalizeRfc8785Jcs(roiBase)),
  };
  const runtimeIdentity = {
    readerModuleVersion: "afc-sr1-tile-floor-reader/v3",
    opencvVersion: "4.11.0",
    numpyVersion: "2.4.6",
  };
  const analysisIdentity = {
    mode: "identity",
    analysisWidth: 800,
    analysisHeight: 400,
    scaleX: 1,
    scaleY: 1,
    referenceLongEdge: 1264,
    resampler: "identity",
    pixelFormat: "bgr8",
    pixelBufferSha256: "e".repeat(64),
  };
  const family = {
    vpClass: "finite",
    rho: 0.7,
    normalizedHomogeneousVp: [1, 1, 0.001],
    supportCount: 2,
    supportTotalLengthPx: 100,
    cappedSupportLengthPx: 100,
    medianResidualPx: 1,
    p90ResidualPx: 2,
  };
  const pair = {
    familyIndices: [0, 1],
    families: [family, family],
    floorLineAnalysis: [0, 1, -370],
    basinSupport: 1,
    stability: { stable: true, maxSplitVsFullProbeDistancePx: 1 },
  };
  const diagnostics = {
    segmentCounts: { raw: 4, admittedAllNineInside: 4 },
    candidateDiscovery: { finalFamilies: [family, family] },
    validFamilyCount: 2,
    candidateUnorderedPairCount: 1,
    validPairCount: 1,
    invalidPairs: [],
    validPairUniverse: [pair],
    winningPair: pair,
  };
  const diagnosticSubset = {
    segmentCounts: diagnostics.segmentCounts,
    candidateDiscovery: diagnostics.candidateDiscovery,
    validFamilyCount: diagnostics.validFamilyCount,
    candidateUnorderedPairCount: diagnostics.candidateUnorderedPairCount,
    validPairCount: diagnostics.validPairCount,
    invalidPairs: diagnostics.invalidPairs,
    validPairUniverse: diagnostics.validPairUniverse,
    finalFamilies: diagnostics.candidateDiscovery.finalFamilies,
    winningPair: diagnostics.winningPair,
  };
  const preimage = {
    schemaVersion: AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION,
    researchProfile: AFC_SR1_TR2_V3_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_V3_POLICY_VERSION,
    image: imageIdentity,
    roi: roiIdentity,
    runtime: runtimeIdentity,
    status: "usable",
    diagnostics: diagnosticSubset,
    analysisIdentity,
    floorVanishingLinePixel: childFloorLine,
  };
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  return {
    schemaVersion: preimage.schemaVersion,
    researchProfile: preimage.researchProfile,
    policyVersion: preimage.policyVersion,
    status: "usable",
    imageIdentity,
    roiIdentity,
    runtimeIdentity,
    analysisIdentity,
    floorVanishingLinePixel: childFloorLine,
    diagnostics,
    evidenceCanonicalJson,
    evidenceDigest: {
      algorithm: "sha256",
      encoding: "hex",
      value: sha256HexUtf8(evidenceCanonicalJson),
    },
    elapsedMs: 1,
  };
}

function readerAuthority(bytes = childBytes) {
  const receipt = validateAfcSr1Tr2ReaderReceipt(readerReceipt(bytes), {
    readerVersion: "v3",
    tiledImageBytes: bytes,
    roi: {
      coordinateSpace: "source-normalized/v1",
      polygon: polygon.map(({ x, y }) => [x, y] as const),
    },
  });
  const authority = getAfcSr1ValidatedTr2UsableReaderAuthority(receipt);
  assert.notEqual(authority, null);
  return authority!;
}

const maskPreimage = {
  coordinateSpace: AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
  role: AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
  evidenceLabel:
    "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY" as const,
  polygon: polygon.map(({ x, y }) => [x, y] as const),
  rasterization: {
    pixelConversion: "int(round(norm * dimension))" as const,
    dilationKernel: [9, 9] as const,
    dilationIterations: 2 as const,
    usableMaskConvention: "inverse_uint8_255" as const,
  },
  parentUsableMaskSha256: maskSha,
  childUsableMaskSha256: "f".repeat(64),
};
const mask = Object.freeze({
  ...maskPreimage,
  maskDigest: sha256HexUtf8(canonicalizeRfc8785Jcs(maskPreimage)),
});

function placementReceipt() {
  const translationPx = { tx: 40, ty: -30 };
  const preimage = {
    schemaVersion: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
    policyVersion: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
    sourceImageBasis,
    targetImageBasis,
    ts0Lineage: lineage,
    registrationMaskIdentity: mask,
    transformType: "translation",
    transformDirection: "parent_to_child",
    translationPx,
    H_norm: deriveAfcSr1Ts0ChildProjectivePlacementHNorm(
      sourceImageBasis,
      targetImageBasis,
      translationPx
    ),
    diagnostics: {
      sift: {
        parentKeypoints: 500,
        childKeypoints: 480,
        goodMatches: 100,
        finalInliers: 80,
        inlierRule: "residual_px < 3.0",
        fitP90Px: 0.8,
      },
      holdout: {
        partition: "4x4_even_odd",
        fitCount: 60,
        validationCount: 40,
        fitTranslationPx: translationPx,
        validationP90Px: 1.2,
      },
      coverage: {
        occupiedCells: 10,
        quadrants: 4,
        xExtentFraction: 0.8,
        yExtentFraction: 0.7,
        collinearityScore: 0.2,
        maxCellP90Px: 1.5,
      },
      akaze: {
        parentKeypoints: 300,
        childKeypoints: 290,
        goodMatches: 60,
        transferP90Px: 1.4,
        refitApplied: false,
      },
      canny: {
        supportCount: 4_000,
        hitCount: 3_000,
        hitRate: 0.75,
        refitApplied: false,
      },
      thresholds: AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1,
    },
    runtimeIdentity: {
      placementModuleVersion: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
      opencvVersion: "4.11.0",
      numpyVersion: "2.4.6",
      cvRngSeed: 0,
      cvNumThreads: 1,
    },
    status: "usable",
    reason: null,
  };
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  return {
    ...preimage,
    evidenceCanonicalJson,
    evidenceDigest: {
      algorithm: "sha256",
      encoding: "hex",
      value: sha256HexUtf8(evidenceCanonicalJson),
    },
    elapsedMs: 5,
  };
}

function placementAuthority() {
  const receipt = validateAfcSr1Ts0ChildProjectivePlacementReceipt(
    placementReceipt(),
    {
      parentBytes,
      childBytes,
      lineageAuthority,
    }
  );
  const authority =
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(receipt);
  assert.notEqual(authority, null);
  return authority!;
}

function boundParent(fingerprint = parentSha, provenanceKind = "empty_room_read") {
  return buildAfcSr1BasisBoundSourcePolygon({
    polygon,
    basis: {
      fingerprint,
      decodedWidth: 1000,
      decodedHeight: 500,
      orientation: 1,
    },
    provenance: {
      kind: provenanceKind as "empty_room_read",
      evidenceReference: "synthetic/EMPTY",
    },
  });
}

const anchorAuthority = Object.freeze({
  kind: "predeclared_truncated_anchor" as const,
  truncatedAnchor: "NL" as const,
  evidenceReference: "synthetic/anchor-NL",
});

function handoffInput(overrides: Record<string, unknown> = {}) {
  return {
    readerAuthority: readerAuthority(),
    placementAuthority: placementAuthority(),
    lineageAuthority,
    basisBoundSourcePolygon: boundParent(),
    truncatedAnchor: "NL",
    anchorAuthority,
    ...overrides,
  } as unknown as AfcSr1PlacementBoundTr0HandoffInputV1;
}

function expectRejected(
  overrides: Record<string, unknown>,
  reason: string
): void {
  assert.deepEqual(
    buildAfcSr1PlacementBoundTr0Handoff(handoffInput(overrides)),
    { status: "rejected", reason }
  );
}

test("placement-bound handoff transfers child line to parent and opens unchanged TR0/Track1a", () => {
  const result = buildAfcSr1PlacementBoundTr0Handoff(handoffInput());
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  validateAfcSr1ValidatedPlacementBoundTr0Handoff(result.handoff);
  assert.deepEqual(result.handoff.transferredParentFloorVanishingLinePixel, {
    a: 0,
    b: 1,
    c: -400,
  });
  assert.deepEqual(result.handoff.tr0Input.analysisImage, {
    decodedWidth: 1000,
    decodedHeight: 500,
  });
  const downstream = deriveAfcSr1FloorVanishingLineCrossRoom(
    result.handoff.tr0Input
  );
  assert.equal(downstream.status, "usable");
  assert.doesNotMatch(
    result.handoff.evidenceCanonicalJson,
    /elapsedMs|capability|seamT/
  );
});

test("serialized placement-bound handoff validates on replay", () => {
  const result = buildAfcSr1PlacementBoundTr0Handoff(handoffInput());
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  const replay = structuredClone(result.handoff);
  validateAfcSr1ValidatedPlacementBoundTr0Handoff(replay);
  assert.deepEqual(replay, result.handoff);
});

test("reader child, placement lineage, and explicit lineage must agree exactly", async () => {
  expectRejected(
    { readerAuthority: readerAuthority(otherChildBytes) },
    "reader_child_basis_mismatch"
  );
  const otherChild = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 1000,
    parentHeight: 500,
    childWidth: 800,
    childHeight: 400,
    childRed: 10,
  });
  expectRejected(
    { lineageAuthority: otherChild.authority },
    "reader_child_basis_mismatch"
  );
  const otherParent = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 1000,
    parentHeight: 500,
    childWidth: 800,
    childHeight: 400,
    parentRed: 10,
  });
  expectRejected(
    { lineageAuthority: otherParent.authority },
    "placement_lineage_mismatch"
  );
  expectRejected({ lineageAuthority: undefined }, "invalid_ts0_lineage");
});

test("only the exact EMPTY parent polygon basis is accepted", () => {
  expectRejected(
    { basisBoundSourcePolygon: boundParent("d".repeat(64)) },
    "parent_polygon_basis_mismatch"
  );
  expectRejected(
    { basisBoundSourcePolygon: boundParent(parentSha, "lab_floor_capture") },
    "non_empty_parent_polygon"
  );
  const tampered = structuredClone(boundParent()) as any;
  tampered.polygon[0].x += 0.01;
  expectRejected(
    { basisBoundSourcePolygon: tampered },
    "invalid_basis_bound_polygon"
  );
});

test("anchor authority is explicit, exact, and independent of placement mask", () => {
  expectRejected({ anchorAuthority: undefined }, "anchor_authority_unresolved");
  expectRejected({
    anchorAuthority: { ...anchorAuthority, truncatedAnchor: "NR" },
  }, "anchor_authority_unresolved");
  expectRejected({
    anchorAuthority: {
      kind: "registration_mask",
      truncatedAnchor: "NL",
      evidenceReference: mask.maskDigest,
    },
  }, "invalid_anchor_authority");
  expectRejected({
    placementAuthority: mask,
  }, "invalid_placement_authority");
});

test("fabricated reader and placement capability objects fail closed", () => {
  expectRejected({
    readerAuthority: structuredClone(readerAuthority()),
  }, "invalid_reader_authority");
  expectRejected({
    placementAuthority: structuredClone(placementAuthority()),
  }, "invalid_placement_authority");
  expectRejected({
    lineageAuthority: structuredClone(lineageAuthority),
  }, "invalid_ts0_lineage");
});

test("strict common-basis v1 remains separate and cannot consume parent EMPTY for child", () => {
  const common = buildAfcSr1CommonBasisTr0Handoff({
    readerAuthority: readerAuthority(),
    readerImageKind: "ts0_child",
    basisBoundSourcePolygon: boundParent(),
    basisRelation: "identical_input",
    truncatedAnchor: "NL",
    anchorAuthority,
  } as AfcSr1CommonBasisTr0HandoffInputV1);
  assert.deepEqual(common, {
    status: "rejected",
    reason: "projective_basis_unproven",
  });
  assert.equal(
    buildAfcSr1PlacementBoundTr0Handoff(handoffInput()).status,
    "validated"
  );
});

test("handoff validator rejects transferred line, placement, basis, and evidence tampering", () => {
  const result = buildAfcSr1PlacementBoundTr0Handoff(handoffInput());
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  for (const mutate of [
    (value: any) => {
      value.transferredParentFloorVanishingLinePixel.c += 1;
    },
    (value: any) => { value.placement.translationPx.tx += 1; },
    (value: any) => { value.placement.H_norm[0][2] += 0.01; },
    (value: any) => { value.parentBasis.sha256 = "d".repeat(64); },
    (value: any) => {
      value.readerChildBasis.receiptEvidenceDigest = "d".repeat(64);
    },
    (value: any) => {
      value.basisBoundSourcePolygon.evidenceDigest.value = "d".repeat(64);
    },
    (value: any) => {
      value.ts0LineageEvidence.provenance.runId = "tampered";
    },
    (value: any) => { value.anchorAuthority.evidenceReference = "tampered"; },
    (value: any) => { value.tr0Input.sourcePolygon[0].x += 0.01; },
    (value: any) => { value.evidenceCanonicalJson += " "; },
    (value: any) => { value.evidenceDigest.value = "0".repeat(64); },
  ]) {
    const value = structuredClone(result.handoff) as any;
    mutate(value);
    assert.throws(
      () => validateAfcSr1ValidatedPlacementBoundTr0Handoff(value)
    );
  }
});
