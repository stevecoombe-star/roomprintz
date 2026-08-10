import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import fixture from "./fixtures/afc-sr1-ts2-development-parity.v1.json";
import {
  AFC_SR1_TR2_POLICY_VERSION,
  AFC_SR1_TR2_RESEARCH_PROFILE,
  AFC_SR1_TR2_RESULT_SCHEMA_VERSION,
  AFC_SR1_TR2_V2_POLICY_VERSION,
  AFC_SR1_TR2_V2_RESEARCH_PROFILE,
  AFC_SR1_TR2_V2_RESULT_SCHEMA_VERSION,
  executeAfcSr1TileFloorReader,
  validateAfcSr1Tr2ReaderReceipt,
} from "./afc-sr1-tile-floor-reader-execution";
import { deriveAfcSr1FloorVanishingLineCrossRoom } from "./afc-sr1-floor-vanishing-line-cross-room";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const row = fixture.cases[0];

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function receipt(status: "usable" | "rejected" = "usable", caseRow = row) {
  const roiPolygon = caseRow.sourcePolygon.map(({ x, y }) => [x, y] as [number, number]);
  const imageIdentity = {
    sha256: sha256(bytes),
    byteCount: bytes.byteLength,
    decodedWidth: 1264,
    decodedHeight: 848,
  };
  const roiIdentity = {
    coordinateSpace: "source-normalized/v1",
    polygon: roiPolygon,
    roiDigest: "d".repeat(64),
  };
  const runtimeIdentity = {
    readerModuleVersion: "afc-sr1-tile-floor-reader/v1",
    opencvVersion: "4.11.0",
    numpyVersion: "2.4.6",
  };
  const diagnostics = {
    segmentCounts: { raw: 823, admittedAllNineInside: 87 },
    firstFamily: {
      support_count: 28, median_residual_px: 1.46, p90_residual_px: 2.66, hypothesis_strategy: "exhaustive",
    },
    secondFamily: {
      support_count: 27, median_residual_px: 1.07, p90_residual_px: 3.14, hypothesis_strategy: "exhaustive",
    },
    stability: { max_split_vs_full_probe_distance_px: 1.43 },
  };
  const preimage = {
    schemaVersion: AFC_SR1_TR2_RESULT_SCHEMA_VERSION,
    researchProfile: AFC_SR1_TR2_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_POLICY_VERSION,
    image: imageIdentity,
    roi: roiIdentity,
    runtime: runtimeIdentity,
    status,
    diagnostics: {
      rawSegmentCount: 823,
      admittedAllNineInsideCount: 87,
      familySupportCounts: [28, 27],
      familyMedianResidualsPx: [1.46, 1.07],
      familyP90ResidualsPx: [2.66, 3.14],
      stabilityMaxProbeDistancePx: 1.43,
      hypothesisStrategies: ["exhaustive", "exhaustive"],
    },
    ...(status === "usable"
      ? { floorVanishingLinePixel: caseRow.floorVanishingLinePixel }
      : { reason: "near_identical_vanishing_points" }),
  };
  const evidenceCanonicalJson = canonical(preimage);
  return {
    schemaVersion: AFC_SR1_TR2_RESULT_SCHEMA_VERSION,
    researchProfile: AFC_SR1_TR2_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_POLICY_VERSION,
    status,
    imageIdentity,
    roiIdentity,
    runtimeIdentity,
    diagnostics,
    ...(status === "usable" ? { floorVanishingLinePixel: caseRow.floorVanishingLinePixel } :
      { reason: "near_identical_vanishing_points" }),
    evidenceCanonicalJson,
    evidenceDigest: { algorithm: "sha256", encoding: "hex", value: sha256(evidenceCanonicalJson) },
    elapsedMs: 2.5,
  };
}

function input(caseRow = row) {
  const roiPolygon = caseRow.sourcePolygon.map(({ x, y }) => [x, y] as [number, number]);
  return {
    tiledImageBytes: bytes,
    roi: { coordinateSpace: "source-normalized/v1" as const, polygon: roiPolygon },
    expectedImageIdentity: {
      sha256: sha256(bytes), byteCount: bytes.byteLength, decodedWidth: 1264, decodedHeight: 848,
    },
    sourcePolygon: caseRow.sourcePolygon as unknown as AfcSr1SourcePolygon,
    truncatedAnchor: caseRow.truncatedAnchor as "NL" | "NR",
  };
}

function v2Receipt(status: "usable" | "rejected" = "usable", caseRow = row) {
  const value = receipt(status, caseRow) as any;
  const analysisIdentity = {
    mode: "identity",
    analysisWidth: 1264,
    analysisHeight: 848,
    scaleX: 1,
    scaleY: 1,
    referenceLongEdge: 1264,
    resampler: "identity",
    pixelFormat: "bgr8",
    pixelBufferSha256: "a".repeat(64),
  };
  value.schemaVersion = AFC_SR1_TR2_V2_RESULT_SCHEMA_VERSION;
  value.researchProfile = AFC_SR1_TR2_V2_RESEARCH_PROFILE;
  value.policyVersion = AFC_SR1_TR2_V2_POLICY_VERSION;
  value.runtimeIdentity.readerModuleVersion = "afc-sr1-tile-floor-reader/v2";
  value.analysisIdentity = analysisIdentity;
  const preimage = JSON.parse(value.evidenceCanonicalJson);
  preimage.schemaVersion = value.schemaVersion;
  preimage.researchProfile = value.researchProfile;
  preimage.policyVersion = value.policyVersion;
  preimage.runtime = value.runtimeIdentity;
  preimage.analysisIdentity = analysisIdentity;
  value.evidenceCanonicalJson = canonical(preimage);
  value.evidenceDigest.value = sha256(value.evidenceCanonicalJson);
  return value;
}

test("TR2 receipt validates canonical text digest and response/preimage binding", () => {
  const result = validateAfcSr1Tr2ReaderReceipt(receipt(), input());
  assert.equal(result.status, "usable");
});

test("TR2 receipt rejects a tampered digest, preimage, image identity, or ROI", () => {
  for (const mutate of [
    (value: any) => { value.evidenceDigest.value = "0".repeat(64); },
    (value: any) => { value.floorVanishingLinePixel.c += 1; },
    (value: any) => { value.imageIdentity.sha256 = "a".repeat(64); },
    (value: any) => { value.roiIdentity.polygon = [[0, 0], [1, 0], [0, 1]]; },
  ]) {
    const value = JSON.parse(JSON.stringify(receipt()));
    mutate(value);
    assert.throws(() => validateAfcSr1Tr2ReaderReceipt(value, input()));
  }
});

test("TR2 v2 receipt binds a valid analysis identity and rejects tampering", () => {
  const v2Input = { ...input(), readerVersion: "v2" as const };
  assert.equal(validateAfcSr1Tr2ReaderReceipt(v2Receipt(), v2Input).status, "usable");
  for (const mutate of [
    (value: any) => { value.analysisIdentity.pixelBufferSha256 = "z".repeat(64); },
    (value: any) => { value.analysisIdentity.scaleX = 2; },
    (value: any) => { value.analysisIdentity.resampler = "opencv-inter-area/v1"; },
  ]) {
    const value = JSON.parse(JSON.stringify(v2Receipt()));
    mutate(value);
    assert.throws(() => validateAfcSr1Tr2ReaderReceipt(value, v2Input));
  }
});

test("TR2 reader rejection skips TR0 and usable receipt invokes certified TR0", async () => {
  const rejected = await executeAfcSr1TileFloorReader(input(), {
    callCompositor: async () => receipt("rejected"),
  });
  assert.equal(rejected.readerExecution.status, "rejected");
  assert.equal(rejected.projectiveHandoff, null);

  let outbound: unknown;
  const usable = await executeAfcSr1TileFloorReader(input(), {
    callCompositor: async ({ payload }) => {
      outbound = payload;
      return receipt();
    },
  });
  assert.equal(usable.readerExecution.status, "usable");
  assert.ok(usable.projectiveHandoff);
  assert.equal(usable.projectiveHandoff?.status, "usable");
  assert.deepEqual(Object.keys(outbound as object).sort(), ["imageBase64", "policyVersion", "researchProfile", "roi"]);
  assert.equal(JSON.stringify(outbound).includes("truncatedAnchor"), false);
});

test("TR2 v2 invokes unchanged TR0 with original input dimensions", async () => {
  const receiptValue = v2Receipt() as any;
  receiptValue.imageIdentity.decodedWidth = 2528;
  receiptValue.imageIdentity.decodedHeight = 1696;
  receiptValue.analysisIdentity = {
    ...receiptValue.analysisIdentity,
    mode: "downscale_long_edge",
    scaleX: 2,
    scaleY: 2,
    resampler: "opencv-inter-area/v1",
  };
  receiptValue.floorVanishingLinePixel = {
    ...receiptValue.floorVanishingLinePixel,
    c: receiptValue.floorVanishingLinePixel.c * 2,
  };
  const preimage = JSON.parse(receiptValue.evidenceCanonicalJson);
  preimage.image = receiptValue.imageIdentity;
  preimage.analysisIdentity = receiptValue.analysisIdentity;
  preimage.floorVanishingLinePixel = receiptValue.floorVanishingLinePixel;
  receiptValue.evidenceCanonicalJson = canonical(preimage);
  receiptValue.evidenceDigest.value = sha256(receiptValue.evidenceCanonicalJson);
  const v2Input = {
    ...input(),
    readerVersion: "v2" as const,
    expectedImageIdentity: { sha256: sha256(bytes), byteCount: bytes.byteLength },
  };
  const direct = deriveAfcSr1FloorVanishingLineCrossRoom({
    analysisImage: { decodedWidth: 2528, decodedHeight: 1696 },
    floorVanishingLinePixel: receiptValue.floorVanishingLinePixel,
    sourcePolygon: row.sourcePolygon as unknown as AfcSr1SourcePolygon,
    truncatedAnchor: row.truncatedAnchor,
  });
  const result = await executeAfcSr1TileFloorReader(v2Input, {
    callCompositor: async () => receiptValue,
  });
  assert.equal(result.readerExecution.status, "usable");
  assert.equal(result.projectiveHandoff?.status, "usable");
  assert.deepEqual(result.projectiveHandoff, direct);
});

test("TR2 float JSON handoff preserves the certified direct seamT within 1e-12", async () => {
  const direct = deriveAfcSr1FloorVanishingLineCrossRoom({
    analysisImage: row.analysisImage,
    floorVanishingLinePixel: row.floorVanishingLinePixel,
    sourcePolygon: row.sourcePolygon as unknown as AfcSr1SourcePolygon,
    truncatedAnchor: row.truncatedAnchor,
  });
  assert.equal(direct.status, "usable");
  const throughReceipt = await executeAfcSr1TileFloorReader(input(), {
    callCompositor: async () => JSON.parse(JSON.stringify(receipt())),
  });
  assert.equal(throughReceipt.projectiveHandoff?.status, "usable");
  if (direct.status === "usable" && throughReceipt.projectiveHandoff?.status === "usable") {
    assert.ok(Math.abs(direct.prior.seamT - throughReceipt.projectiveHandoff.prior.seamT) <= 1e-12);
  }
});

test("all six frozen C/D JSON receipt handoffs preserve certified seamT", async () => {
  for (const caseRow of fixture.cases) {
    const result = await executeAfcSr1TileFloorReader(input(caseRow), {
      callCompositor: async () => JSON.parse(JSON.stringify(receipt("usable", caseRow))),
    });
    assert.equal(result.readerExecution.status, "usable", `${caseRow.room}-${caseRow.generation}`);
    assert.equal(result.projectiveHandoff?.status, "usable", `${caseRow.room}-${caseRow.generation}`);
    if (result.projectiveHandoff?.status === "usable") {
      assert.ok(
        Math.abs(result.projectiveHandoff.prior.seamT - caseRow.expectedSeamT) <= 1e-12,
        `${caseRow.room}-${caseRow.generation}`
      );
    }
  }
});

test("TR2 execution and client are server-only and contain no TS0 route use", async () => {
  const [executionSource, clientSource] = await Promise.all([
    readFile(new URL("./afc-sr1-tile-floor-reader-execution.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../lib/callCompositorAfcSr1TileFloorReader.ts", import.meta.url), "utf8"),
  ]);
  assert.match(executionSource, /import "server-only";/);
  assert.match(clientSource, /import "server-only";/);
  assert.doesNotMatch(executionSource, /callCompositorVibodeStageRun|tile_grid_scaffold|seamT:/);
  assert.match(clientSource, /\/api\/research\/afc-sr1\/tile-floor-vanishing-line/);
});
