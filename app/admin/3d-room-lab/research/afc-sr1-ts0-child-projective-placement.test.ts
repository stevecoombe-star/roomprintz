/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  finitePointToHomogeneous,
  lineThroughPoints,
} from "./afc-sr1-homogeneous-geometry";
import {
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
  AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
  AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
  AFC_SR1_TS0_PLACEMENT_ORIENTATION,
  AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1,
  deriveAfcSr1Ts0ChildProjectivePlacementHNorm,
  getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority,
  isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority,
  transferAfcSr1ChildPixelLineToParentPixel,
  validateAfcSr1Ts0ChildProjectivePlacementReceipt,
  type AfcSr1Ts0LineageIdentityV1,
  type AfcSr1Ts0PlacementDecodedImageBasisV1,
  type AfcSr1Ts0PlacementExpectedIdentityV1,
  type AfcSr1Ts0PlacementRegistrationMaskIdentityV1,
} from "./afc-sr1-ts0-child-projective-placement";
import {
  makeSyntheticGeneratedTs0Lineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority.test-helpers";
import type {
  AfcSr1ValidatedTs0ParentChildLineageAuthorityV1,
} from "./afc-sr1-ts0-parent-child-lineage-authority";

let sourceBytes!: Uint8Array;
let targetBytes!: Uint8Array;
let lineageAuthority!: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
let sourceImageBasis!: AfcSr1Ts0PlacementDecodedImageBasisV1;
let targetImageBasis!: AfcSr1Ts0PlacementDecodedImageBasisV1;
let ts0Lineage!: AfcSr1Ts0LineageIdentityV1;

test.before(async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage({
    parentWidth: 1000,
    parentHeight: 500,
    childWidth: 800,
    childHeight: 400,
  });
  sourceBytes = fixture.parentBytes;
  targetBytes = fixture.childBytes;
  lineageAuthority = fixture.authority;
  sourceImageBasis = Object.freeze({
    sha256: fixture.parent.sha256,
    byteCount: fixture.parent.byteCount,
    decodedWidth: fixture.parent.decodedWidth,
    decodedHeight: fixture.parent.decodedHeight,
    orientation: AFC_SR1_TS0_PLACEMENT_ORIENTATION,
  });
  targetImageBasis = Object.freeze({
    sha256: fixture.child.sha256,
    byteCount: fixture.child.byteCount,
    decodedWidth: fixture.child.decodedWidth,
    decodedHeight: fixture.child.decodedHeight,
    orientation: AFC_SR1_TS0_PLACEMENT_ORIENTATION,
  });
  ts0Lineage = Object.freeze({
    parent: sourceImageBasis,
    child: targetImageBasis,
  });
});

function maskIdentity(
  label: AfcSr1Ts0PlacementRegistrationMaskIdentityV1["evidenceLabel"] =
    "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY"
): AfcSr1Ts0PlacementRegistrationMaskIdentityV1 {
  const preimage = {
    coordinateSpace: AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE,
    role: AFC_SR1_TS0_PLACEMENT_MASK_ROLE,
    evidenceLabel: label,
    polygon: [[0.1, 0.8], [0.9, 0.9], [0.7, 0.4], [0.3, 0.4]] as const,
    rasterization: {
      pixelConversion: "int(round(norm * dimension))" as const,
      dilationKernel: [9, 9] as const,
      dilationIterations: 2 as const,
      usableMaskConvention: "inverse_uint8_255" as const,
    },
    parentUsableMaskSha256: "c".repeat(64),
    childUsableMaskSha256: "d".repeat(64),
  };
  return Object.freeze({
    ...preimage,
    maskDigest: sha256HexUtf8(canonicalizeRfc8785Jcs(preimage)),
  });
}

const registrationMaskIdentity = maskIdentity();

function validationContext() {
  return { parentBytes: sourceBytes, childBytes: targetBytes, lineageAuthority };
}

function rejectedExpected(
  registrationMask:
    AfcSr1Ts0PlacementRegistrationMaskIdentityV1 | null =
      registrationMaskIdentity
) {
  const expected: AfcSr1Ts0PlacementExpectedIdentityV1 = {
    sourceImageBasis,
    targetImageBasis,
    ts0Lineage,
    registrationMaskIdentity: registrationMask,
  };
  return { expectedRejectedIdentity: expected };
}

function usableDiagnostics() {
  return {
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
      fitTranslationPx: { tx: 40, ty: -30 },
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
  } as const;
}

function placementReceipt(options: Readonly<{
  source?: AfcSr1Ts0PlacementDecodedImageBasisV1;
  target?: AfcSr1Ts0PlacementDecodedImageBasisV1;
  lineage?: AfcSr1Ts0LineageIdentityV1;
  mask?: AfcSr1Ts0PlacementRegistrationMaskIdentityV1 | null;
  tx?: number;
  ty?: number;
  status?: "usable" | "rejected";
  reason?: string | null;
  elapsedMs?: number;
}> = {}) {
  const source = options.source ?? sourceImageBasis;
  const target = options.target ?? targetImageBasis;
  const lineage = options.lineage ?? ts0Lineage;
  const mask = options.mask === undefined
    ? registrationMaskIdentity
    : options.mask;
  const status = options.status ?? "usable";
  const translationPx = status === "usable"
    ? { tx: options.tx ?? 40, ty: options.ty ?? -30 }
    : null;
  const preimage = {
    schemaVersion: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
    policyVersion: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION,
    sourceImageBasis: source,
    targetImageBasis: target,
    ts0Lineage: lineage,
    registrationMaskIdentity: mask,
    transformType: "translation",
    transformDirection: "parent_to_child",
    translationPx,
    H_norm: translationPx === null
      ? null
      : deriveAfcSr1Ts0ChildProjectivePlacementHNorm(
          source,
          target,
          translationPx
        ),
    diagnostics: usableDiagnostics(),
    runtimeIdentity: {
      placementModuleVersion: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION,
      opencvVersion: "4.11.0",
      numpyVersion: "2.4.6",
      cvRngSeed: 0,
      cvNumThreads: 1,
    },
    status,
    reason: status === "usable"
      ? null
      : options.reason ?? "validation_residual_exceeds_limit",
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
    elapsedMs: options.elapsedMs ?? 12.5,
  };
}

function recertify(value: any): void {
  const {
    evidenceCanonicalJson: _canonical,
    evidenceDigest: _digest,
    elapsedMs: _elapsed,
    ...preimage
  } = value;
  void _canonical;
  void _digest;
  void _elapsed;
  value.evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  value.evidenceDigest = {
    algorithm: "sha256",
    encoding: "hex",
    value: sha256HexUtf8(value.evidenceCanonicalJson),
  };
}

function authority(options: Parameters<typeof placementReceipt>[0] = {}) {
  const receipt = validateAfcSr1Ts0ChildProjectivePlacementReceipt(
    placementReceipt(options),
    validationContext()
  );
  const result =
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(receipt);
  assert.notEqual(result, null);
  return result!;
}

function close(
  actual: Readonly<{ a: number; b: number; c: number }>,
  expectedLine: Readonly<{ a: number; b: number; c: number }>,
  tolerance = 1e-12
): void {
  assert.ok(Math.abs(actual.a - expectedLine.a) <= tolerance);
  assert.ok(Math.abs(actual.b - expectedLine.b) <= tolerance);
  assert.ok(Math.abs(actual.c - expectedLine.c) <= tolerance);
}

test("strict usable placement receipt issues immutable process-local authority", () => {
  const raw = placementReceipt();
  const validated = validateAfcSr1Ts0ChildProjectivePlacementReceipt(
    structuredClone(raw),
    validationContext()
  );
  const placementAuthority =
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(validated);
  assert.notEqual(placementAuthority, null);
  assert.ok(isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(
    placementAuthority
  ));
  assert.ok(Object.isFrozen(placementAuthority));
  assert.deepEqual(placementAuthority!.H_norm, [
    [1.25, 0, 0.05],
    [0, 1.25, -0.075],
    [0, 0, 1],
  ]);

  const replay = validateAfcSr1Ts0ChildProjectivePlacementReceipt(
    structuredClone(raw),
    validationContext()
  );
  const replayAuthority =
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(replay);
  assert.notEqual(replayAuthority, placementAuthority);
  assert.deepEqual(replayAuthority, placementAuthority);
});

test("elapsed time is excluded from placement evidence identity", () => {
  const first = placementReceipt({ elapsedMs: 1 });
  const second = placementReceipt({ elapsedMs: 9_999 });
  assert.equal(first.evidenceCanonicalJson, second.evidenceCanonicalJson);
  assert.equal(first.evidenceDigest.value, second.evidenceDigest.value);
  validateAfcSr1Ts0ChildProjectivePlacementReceipt(first, validationContext());
  validateAfcSr1Ts0ChildProjectivePlacementReceipt(second, validationContext());
});

test("parent, child, lineage, and exact raster mask digests are independently bound", () => {
  for (const mutate of [
    (value: any) => { value.sourceImageBasis.sha256 = "e".repeat(64); },
    (value: any) => { value.targetImageBasis.sha256 = "e".repeat(64); },
    (value: any) => { value.ts0Lineage.parent.sha256 = "e".repeat(64); },
    (value: any) => { value.ts0Lineage.child.sha256 = "e".repeat(64); },
    (value: any) => {
      value.registrationMaskIdentity.parentUsableMaskSha256 = "e".repeat(64);
    },
    (value: any) => {
      value.registrationMaskIdentity.rasterization.dilationIterations = 1;
    },
    (value: any) => { value.registrationMaskIdentity.maskDigest = "e".repeat(64); },
  ]) {
    const value = structuredClone(placementReceipt()) as any;
    mutate(value);
    recertify(value);
    assert.throws(() =>
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(value, validationContext())
    );
  }
});

test("usable receipts require exact bytes and the live lineage capability", () => {
  const receipt = placementReceipt();
  assert.throws(() =>
    validateAfcSr1Ts0ChildProjectivePlacementReceipt(receipt, {
      expectedRejectedIdentity: {
        sourceImageBasis,
        targetImageBasis,
        ts0Lineage,
        registrationMaskIdentity,
      },
    })
  );
  assert.throws(() =>
    validateAfcSr1Ts0ChildProjectivePlacementReceipt(receipt, {
      parentBytes: sourceBytes,
      childBytes: targetBytes,
      lineageAuthority: structuredClone(lineageAuthority),
    })
  );
  assert.throws(() =>
    validateAfcSr1Ts0ChildProjectivePlacementReceipt(receipt, {
      parentBytes: new Uint8Array(sourceBytes),
      childBytes: new Uint8Array([1, 2, 3]),
      lineageAuthority,
    })
  );
});

test("missing mask is a validated rejection and grants no placement authority", () => {
  const raw = placementReceipt({
    status: "rejected",
    reason: "registration_mask_missing",
    mask: null,
  });
  const rejected = validateAfcSr1Ts0ChildProjectivePlacementReceipt(
    raw,
    rejectedExpected(null)
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "registration_mask_missing");
  assert.equal(
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(rejected),
    null
  );
});

test("wrong policy, runtime, direction, and non-translation transforms fail closed", () => {
  for (const mutate of [
    (value: any) => { value.policyVersion = "wrong-policy"; },
    (value: any) => { value.runtimeIdentity.opencvVersion = "4.12.0"; },
    (value: any) => { value.runtimeIdentity.numpyVersion = "2.4.5"; },
    (value: any) => { value.runtimeIdentity.cvNumThreads = 2; },
    (value: any) => { value.transformDirection = "child_to_parent"; },
    (value: any) => { value.transformType = "similarity"; },
    (value: any) => { value.transformType = "affine"; },
    (value: any) => { value.transformType = "homography"; },
  ]) {
    const value = structuredClone(placementReceipt()) as any;
    mutate(value);
    recertify(value);
    assert.throws(() =>
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(value, validationContext())
    );
  }
});

test("nonfinite translation and caller-authored H_norm fail closed", () => {
  for (const mutate of [
    (value: any) => { value.translationPx.tx = Number.NaN; },
    (value: any) => { value.translationPx.ty = Number.POSITIVE_INFINITY; },
    (value: any) => { value.H_norm[0][0] = 1; },
    (value: any) => { value.H_norm[0][2] += 0.01; },
  ]) {
    const value = structuredClone(placementReceipt()) as any;
    mutate(value);
    assert.throws(() =>
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(value, validationContext())
    );
  }
});

test("frozen diagnostics and inclusive threshold gates are strict", () => {
  for (const mutate of [
    (value: any) => {
      value.diagnostics.thresholds.minimumFinalInliers = 1;
    },
    (value: any) => { value.diagnostics.sift.inlierRule = "residual_px <= 3.0"; },
    (value: any) => { value.diagnostics.sift.finalInliers = 39; },
    (value: any) => { value.diagnostics.holdout.validationP90Px = 3.5001; },
    (value: any) => { value.diagnostics.coverage.occupiedCells = 3; },
    (value: any) => { value.diagnostics.coverage.collinearityScore = 0.851; },
    (value: any) => { value.diagnostics.akaze.refitApplied = true; },
    (value: any) => { value.diagnostics.akaze.transferP90Px = 3.5001; },
    (value: any) => { value.diagnostics.canny.supportCount = 1_999; },
    (value: any) => { value.diagnostics.canny.hitRate = 0.749; },
  ]) {
    const value = structuredClone(placementReceipt()) as any;
    mutate(value);
    recertify(value);
    assert.throws(() =>
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(value, validationContext())
    );
  }
});

test("duplicate train matches remain allowed by the frozen matching policy", () => {
  const value = structuredClone(placementReceipt()) as any;
  value.diagnostics.sift.childKeypoints = 50;
  value.diagnostics.akaze.childKeypoints = 40;
  recertify(value);
  assert.doesNotThrow(() =>
    validateAfcSr1Ts0ChildProjectivePlacementReceipt(
      value,
      validationContext()
    )
  );
});

test("recanonicalized impossible diagnostic relationships fail closed", () => {
  for (const mutate of [
    (value: any) => { value.diagnostics.coverage.occupiedCells = 17; },
    (value: any) => { value.diagnostics.coverage.quadrants = 5; },
    (value: any) => { value.diagnostics.coverage.xExtentFraction = 1.01; },
    (value: any) => { value.diagnostics.coverage.yExtentFraction = -0.01; },
    (value: any) => { value.diagnostics.coverage.collinearityScore = -0.01; },
    (value: any) => { value.diagnostics.coverage.maxCellP90Px = -0.01; },
    (value: any) => { value.diagnostics.sift.fitP90Px = -0.01; },
    (value: any) => { value.diagnostics.sift.finalInliers = 101; },
    (value: any) => { value.diagnostics.sift.goodMatches = 481; },
    (value: any) => { value.diagnostics.holdout.fitCount = 61; },
    (value: any) => { value.diagnostics.holdout.validationP90Px = -0.01; },
    (value: any) => { value.diagnostics.akaze.goodMatches = 301; },
    (value: any) => { value.diagnostics.akaze.transferP90Px = -0.01; },
    (value: any) => { value.diagnostics.canny.hitCount = 4_001; },
    (value: any) => { value.diagnostics.canny.hitRate = 1.01; },
  ]) {
    const value = structuredClone(placementReceipt()) as any;
    mutate(value);
    recertify(value);
    assert.throws(() =>
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(
        value,
        validationContext()
      )
    );
  }
});

test("canonical JSON, digest, unknown fields, and rejection taxonomy fail closed", () => {
  for (const mutate of [
    (value: any) => { value.unknown = true; },
    (value: any) => { value.evidenceCanonicalJson += " "; },
    (value: any) => { value.evidenceDigest.value = "0".repeat(64); },
    (value: any) => {
      value.status = "rejected";
      value.reason = "failed";
      value.translationPx = null;
      value.H_norm = null;
    },
  ]) {
    const value = structuredClone(placementReceipt()) as any;
    mutate(value);
    if (value.reason === "failed") recertify(value);
    assert.throws(() =>
      validateAfcSr1Ts0ChildProjectivePlacementReceipt(value, validationContext())
    );
  }
});

test("rejected receipts never issue authority", () => {
  const rejected = validateAfcSr1Ts0ChildProjectivePlacementReceipt(
    placementReceipt({
      status: "rejected",
      reason: "validation_residual_exceeds_limit",
    }),
    rejectedExpected()
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(
    getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(rejected),
    null
  );
});

test("fabricated authority and registration mask grant no transfer authority", () => {
  const real = authority();
  const fabricated = structuredClone(real);
  assert.equal(
    isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(fabricated),
    false
  );
  assert.equal(
    transferAfcSr1ChildPixelLineToParentPixel(
      { a: 1, b: 0, c: -10 },
      fabricated
    ),
    null
  );
  assert.equal(
    isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(maskIdentity(
      "NON_AUTHORITATIVE_RESEARCH_MASK_ONLY"
    )),
    false
  );
});

test("no forbidden max-translation gate is introduced", () => {
  const large = authority({ tx: 700, ty: -400 });
  assert.deepEqual(large.translationPx, { tx: 700, ty: -400 });
  assert.equal(
    Object.keys(large).some((key) => /max.*translation/i.test(key)),
    false
  );
});

test("Architecture L handles identity, signed translations, and unequal dimensions", () => {
  const identity = authority({
    tx: 0,
    ty: 0,
  });
  close(
    transferAfcSr1ChildPixelLineToParentPixel(
      { a: 3, b: 4, c: -20 },
      identity
    )!,
    { a: 0.6, b: 0.8, c: -4 }
  );
  close(
    transferAfcSr1ChildPixelLineToParentPixel(
      { a: 0, b: 1, c: -100 },
      authority({ tx: 50, ty: 25 })
    )!,
    { a: 0, b: 1, c: -75 }
  );
  close(
    transferAfcSr1ChildPixelLineToParentPixel(
      { a: 1, b: 0, c: -100 },
      authority({ tx: -50, ty: -25 })
    )!,
    { a: 1, b: 0, c: -150 }
  );
  const unequal = authority({ tx: 40, ty: -30 });
  const normal = Math.hypot(2, -1);
  close(
    transferAfcSr1ChildPixelLineToParentPixel(
      { a: 2, b: -1, c: -30 },
      unequal
    )!,
    { a: -2 / normal, b: 1 / normal, c: -80 / normal }
  );
});

test("Architecture L preserves off-frame incidence through transformed points", () => {
  const placement = authority({ tx: 40, ty: -30 });
  const parentPoints = [
    { x: -250, y: 700 },
    { x: 1_400, y: -125 },
  ] as const;
  const childPoints = parentPoints.map((point) => ({
    x: point.x + placement.translationPx.tx,
    y: point.y + placement.translationPx.ty,
  }));
  const childLine = lineThroughPoints(
    finitePointToHomogeneous(childPoints[0])!,
    finitePointToHomogeneous(childPoints[1])!
  )!;
  const parentLine =
    transferAfcSr1ChildPixelLineToParentPixel(childLine, placement)!;
  for (const point of parentPoints) {
    assert.ok(Math.abs(
      parentLine.a * point.x + parentLine.b * point.y + parentLine.c
    ) <= 1e-12);
  }
});

test("Architecture P forward-point oracle agrees with Architecture L", () => {
  const placement = authority({ tx: -120, ty: 80 });
  const parentPoints = [
    { x: 75, y: 90 },
    { x: 1_275, y: 525 },
  ] as const;
  const childPoints = parentPoints.map(({ x, y }) => ({
    x: x + placement.translationPx.tx,
    y: y + placement.translationPx.ty,
  }));
  const childLine = lineThroughPoints(
    finitePointToHomogeneous(childPoints[0])!,
    finitePointToHomogeneous(childPoints[1])!
  )!;
  const architectureL =
    transferAfcSr1ChildPixelLineToParentPixel(childLine, placement)!;
  const architectureP = lineThroughPoints(
    finitePointToHomogeneous(parentPoints[0])!,
    finitePointToHomogeneous(parentPoints[1])!
  )!;
  close(architectureL, architectureP, 1e-12);
});
