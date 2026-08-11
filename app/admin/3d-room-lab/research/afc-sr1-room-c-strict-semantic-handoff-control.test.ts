import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  buildAfcSr1BasisBoundSourcePolygon,
  validateAfcSr1BasisBoundSourcePolygon,
} from "./afc-sr1-basis-bound-source-polygon";
import {
  buildAfcSr1CommonBasisTr0Handoff,
  type AfcSr1CommonBasisTr0HandoffInputV1,
} from "./afc-sr1-common-basis-tr0-handoff";
import { deriveAfcSr1AdjustableCornerFromTruncatedAnchor } from "./afc-sr1-cross-room-prior";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";
import {
  executeAfcSr1TileFloorReader,
  getAfcSr1ValidatedTr2UsableReaderAuthority,
  validateAfcSr1Tr2ReaderReceipt,
} from "./afc-sr1-tile-floor-reader-execution";

const fixtureDirectory = new URL(
  "./fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1/",
  import.meta.url
);
const control = JSON.parse(readFileSync(new URL("control.json", fixtureDirectory), "utf8")) as any;
const gt0 = JSON.parse(readFileSync(
  new URL("./fixtures/afc-sr1-room-c-ground-truth.v1.json", import.meta.url),
  "utf8"
)) as any;

function bytesFor(label: "C-RAW" | "C-T1" | "C-T2" | "C-T3"): Uint8Array {
  return readFileSync(new URL(
    control.realCompositorV3Evidence[label].imageFixtureFile,
    fixtureDirectory
  ));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngDimensions(bytes: Uint8Array): Readonly<{ width: number; height: number }> {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

function strictInput(
  bytes: Uint8Array,
  overrides: Record<string, unknown> = {}
) {
  const authority = control.authority;
  return {
    readerVersion: "v3" as const,
    tiledImageBytes: bytes,
    roi: authority.readerRoi,
    expectedImageIdentity: labelIdentity("C-RAW"),
    strictTr0Handoff: {
      readerImageKind: authority.readerImageKind,
      basisBoundSourcePolygon: authority.basisBoundSourcePolygon,
      basisRelation: authority.basisRelation,
      truncatedAnchor: authority.truncatedAnchor,
      anchorAuthority: authority.anchorAuthority,
      ...overrides,
    },
  };
}

function labelIdentity(label: "C-RAW" | "C-T1" | "C-T2" | "C-T3") {
  const image = control.realCompositorV3Evidence[label].receipt.imageIdentity;
  return {
    sha256: image.sha256,
    byteCount: image.byteCount,
    decodedWidth: image.decodedWidth,
    decodedHeight: image.decodedHeight,
  };
}

function rejectedReceiptFromUsable() {
  const receipt = structuredClone(control.realCompositorV3Evidence["C-RAW"].receipt);
  const preimage = JSON.parse(receipt.evidenceCanonicalJson);
  receipt.status = "rejected";
  receipt.reason = "insufficient_segments";
  delete receipt.floorVanishingLinePixel;
  preimage.status = "rejected";
  preimage.reason = receipt.reason;
  delete preimage.floorVanishingLinePixel;
  receipt.evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  receipt.evidenceDigest.value = sha256HexUtf8(receipt.evidenceCanonicalJson);
  return receipt;
}

test("Room C control packages exact EMPTY bytes, polygon, and GT-derived NL anchor", () => {
  assert.equal(
    control.schemaVersion,
    "afc-sr1-room-c-strict-semantic-handoff-control/v1"
  );
  const bytes = bytesFor("C-RAW");
  assert.equal(sha256(bytes), control.authority.rawImage.sha256);
  assert.equal(bytes.byteLength, 1_183_523);
  assert.deepEqual(pngDimensions(bytes), { width: 1264, height: 848 });
  assert.equal(control.authority.rawImage.orientation, 1);

  const rebuilt = buildAfcSr1BasisBoundSourcePolygon({
    polygon: control.authority.basisBoundSourcePolygon.polygon,
    basis: control.authority.basisBoundSourcePolygon.basis,
    provenance: control.authority.basisBoundSourcePolygon.provenance,
  });
  assert.deepEqual(rebuilt, control.authority.basisBoundSourcePolygon);
  validateAfcSr1BasisBoundSourcePolygon(rebuilt);
  assert.deepEqual(rebuilt.polygon, [
    { x: 0.045, y: 1 },
    { x: 1, y: 0.82 },
    { x: 0.415, y: 0.616 },
    { x: 0.077, y: 0.694 },
  ]);
  assert.equal(
    rebuilt.polygonFingerprint,
    "13457889890e7ca7a47d6bbf0505117a3e4f86dbd2159b712bb437b626032b5d"
  );
  assert.equal(rebuilt.basis.fingerprint, control.authority.rawImage.sha256);
  assert.equal(rebuilt.provenance.kind, "empty_room_read");

  assert.equal(gt0.seamRefinement.adjustableCorner, "NR");
  assert.equal(control.authority.anchorAuthority.kind, "gt_adjustable_corner_derived");
  assert.equal(control.authority.anchorAuthority.truncatedAnchor, "NL");
  assert.equal(deriveAfcSr1AdjustableCornerFromTruncatedAnchor("NL"), "NR");
  assert.match(control.authority.anchorAuthority.evidenceReference, /ground-truth.*adjustableCorner=NR/);
  assert.equal(control.authority.providerGeneration, "forbidden");
});

test("real C-RAW V3 receipt opens strict common basis, unchanged TR0, and Track 1a", async () => {
  const bytes = bytesFor("C-RAW");
  const receipt = control.realCompositorV3Evidence["C-RAW"].receipt;
  const started = performance.now();
  const first = await executeAfcSr1TileFloorReader(strictInput(bytes), {
    callCompositor: async () => structuredClone(receipt),
  });
  const uiReplayMs = performance.now() - started;
  const second = await executeAfcSr1TileFloorReader(strictInput(bytes), {
    callCompositor: async () => structuredClone(receipt),
  });

  assert.equal(first.readerExecution.status, "usable");
  assert.equal(first.readerExecution.evidenceDigest.value, "2c07926f4e2e86ea67027f000bbdf1e123da71b18086b842321e7b1b13078e5e");
  assert.equal(first.commonBasisHandoff?.status, "validated");
  assert.equal(first.projectiveHandoff?.status, "usable");
  assert.equal(first.legacyUnboundProjectiveHandoff, null);
  assert.deepEqual(first, second);
  if (first.projectiveHandoff?.status !== "usable") return;

  const seamT = first.projectiveHandoff.prior.seamT;
  const error = Math.abs(seamT - control.evaluation.gt0SeamT);
  assert.equal(seamT, 0.7037731582393056);
  assert.equal(error, 0.002597174359452059);
  assert.ok(error <= control.evaluation.absoluteTolerance);
  assert.ok(receipt.elapsedMs + uiReplayMs < 15_000);
});

test("same Room C numbers on Original basis reject before TR0", async () => {
  const originalBound = buildAfcSr1BasisBoundSourcePolygon({
    polygon: control.negativeControls.originalBasis.polygon as AfcSr1SourcePolygon,
    basis: {
      fingerprint: control.negativeControls.originalBasis.fingerprint,
      decodedWidth: control.negativeControls.originalBasis.decodedWidth,
      decodedHeight: control.negativeControls.originalBasis.decodedHeight,
      orientation: control.negativeControls.originalBasis.orientation,
    },
    provenance: {
      kind: "gt_derived_same_image_capture",
      evidenceReference: "afc-sr1-room-c-ground-truth.v1.json#/rawToOriginalPlacement",
    },
  });
  const result = await executeAfcSr1TileFloorReader(strictInput(bytesFor("C-RAW"), {
    basisBoundSourcePolygon: originalBound,
  }), {
    callCompositor: async () =>
      structuredClone(control.realCompositorV3Evidence["C-RAW"].receipt),
  });
  assert.deepEqual(result.commonBasisHandoff, {
    status: "rejected",
    reason: "reader_basis_mismatch",
  });
  assert.equal(result.projectiveHandoff, null);
});

test("preserved C-T1, C-T2, and C-T3 receipts cannot use the parent EMPTY polygon", async () => {
  for (const child of control.negativeControls.ts0Children) {
    const label = child.label as "C-T1" | "C-T2" | "C-T3";
    const bytes = bytesFor(label);
    assert.equal(sha256(bytes), child.fingerprint);
    const result = await executeAfcSr1TileFloorReader({
      ...strictInput(bytes, { readerImageKind: "ts0_child" }),
      expectedImageIdentity: labelIdentity(label),
    }, {
      callCompositor: async () =>
        structuredClone(control.realCompositorV3Evidence[label].receipt),
    });
    assert.deepEqual(result.commonBasisHandoff, {
      status: "rejected",
      reason: "projective_basis_unproven",
    });
    assert.equal(result.projectiveHandoff, null);
  }
});

test("TR2 tamper bars and opaque reader authority prevent handoff bypass", async () => {
  const bytes = bytesFor("C-RAW");
  const receipt = control.realCompositorV3Evidence["C-RAW"].receipt;
  const expected = {
    readerVersion: "v3" as const,
    tiledImageBytes: bytes,
    roi: control.authority.readerRoi,
    expectedImageIdentity: labelIdentity("C-RAW"),
  };
  const validated = validateAfcSr1Tr2ReaderReceipt(structuredClone(receipt), expected);
  const authority = getAfcSr1ValidatedTr2UsableReaderAuthority(validated);
  assert.notEqual(authority, null);
  const replayValidated = validateAfcSr1Tr2ReaderReceipt(structuredClone(receipt), expected);
  assert.deepEqual(
    getAfcSr1ValidatedTr2UsableReaderAuthority(replayValidated),
    authority
  );

  for (const mutate of [
    (value: any) => { value.schemaVersion = "afc-sr1-tr2-tile-floor-reader-result/v2"; },
    (value: any) => { value.researchProfile = "afc-sr1-tr2-tile-floor-reader/v2"; },
    (value: any) => { value.policyVersion = "afc-sr1-ts2-extractor-policy/v2"; },
    (value: any) => { value.imageIdentity.sha256 = "0".repeat(64); },
    (value: any) => { value.floorVanishingLinePixel.c += 1; },
    (value: any) => { value.evidenceDigest.value = "0".repeat(64); },
  ]) {
    const tampered = structuredClone(receipt);
    mutate(tampered);
    assert.throws(() => validateAfcSr1Tr2ReaderReceipt(tampered, expected));
  }

  const fabricated = structuredClone(authority);
  const bypass = buildAfcSr1CommonBasisTr0Handoff({
    readerAuthority: fabricated,
    readerImageKind: "raw_input",
    basisBoundSourcePolygon: control.authority.basisBoundSourcePolygon,
    basisRelation: "identical_input",
    truncatedAnchor: "NL",
    anchorAuthority: control.authority.anchorAuthority,
  } as unknown as AfcSr1CommonBasisTr0HandoffInputV1);
  assert.deepEqual(bypass, { status: "rejected", reason: "invalid_reader_receipt" });

  const rejectedReceipt = rejectedReceiptFromUsable();
  const rejected = validateAfcSr1Tr2ReaderReceipt(rejectedReceipt, expected);
  assert.equal(rejected.status, "rejected");
  assert.equal(getAfcSr1ValidatedTr2UsableReaderAuthority(rejected), null);
  const execution = await executeAfcSr1TileFloorReader(strictInput(bytes), {
    callCompositor: async () => structuredClone(rejectedReceipt),
  });
  assert.equal(execution.commonBasisHandoff, null);
  assert.equal(execution.projectiveHandoff, null);
});
