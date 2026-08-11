import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import fixture from "./fixtures/afc-sr1-ts2-development-parity.v1.json";
import {
  AFC_SR1_TR2_V3_POLICY_VERSION,
  AFC_SR1_TR2_V3_RESEARCH_PROFILE,
  AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION,
  executeAfcSr1RawFirstTileFloorReader,
  executeAfcSr1TileFloorReader,
  validateAfcSr1Tr2ReaderReceipt,
} from "./afc-sr1-tile-floor-reader-execution";
import { buildAfcSr1BasisBoundSourcePolygon } from "./afc-sr1-basis-bound-source-polygon";
import { deriveAfcSr1FloorVanishingLineCrossRoom } from "./afc-sr1-floor-vanishing-line-cross-room";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const row = fixture.cases[0];

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function input() {
  return {
    readerVersion: "v3" as const,
    tiledImageBytes: bytes,
    roi: {
      coordinateSpace: "source-normalized/v1" as const,
      polygon: row.sourcePolygon.map(({ x, y }) => [x, y] as const),
    },
    legacyUnboundTr0Handoff: {
      sourcePolygon: row.sourcePolygon as unknown as AfcSr1SourcePolygon,
      truncatedAnchor: row.truncatedAnchor as "NL" | "NR",
    },
  };
}

function strictInput(readerImageKind: "raw_input" | "ts0_child" = "raw_input") {
  const legacy = input();
  return {
    ...legacy,
    legacyUnboundTr0Handoff: undefined,
    strictTr0Handoff: {
      readerImageKind,
      basisBoundSourcePolygon: buildAfcSr1BasisBoundSourcePolygon({
        polygon: row.sourcePolygon as unknown as AfcSr1SourcePolygon,
        basis: {
          fingerprint: sha256(bytes),
          decodedWidth: 1264,
          decodedHeight: 848,
          orientation: 1,
        },
        provenance: {
          kind: "explicit_development_capture",
          evidenceReference: "synthetic/v3-raw",
        },
      }),
      basisRelation: "identical_input" as const,
      truncatedAnchor: row.truncatedAnchor as "NL" | "NR",
      anchorAuthority: {
        kind: "predeclared_truncated_anchor" as const,
        truncatedAnchor: row.truncatedAnchor as "NL" | "NR",
        evidenceReference: "synthetic/v3-anchor",
      },
    },
  };
}

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

function family(vpClass: "finite" | "directional", vp: [number, number, number]) {
  return {
    vpClass,
    rho: vpClass === "directional" ? 65_000 : 0.7,
    normalizedHomogeneousVp: vp,
    direction: vpClass === "directional" ? vp.slice(0, 2) : null,
    supportCount: 12,
    supportTotalLengthPx: 840,
    cappedSupportLengthPx: 840,
    medianResidualPx: 1.2,
    p90ResidualPx: 2.4,
    refinement: "two_round_reselect_refit",
  };
}

function validDiagnostics() {
  const families = [
    family("directional", [1, 0, 0]),
    family("finite", [0.8, 0.6, 0.001]),
  ];
  const pair = {
    familyIndices: [0, 1],
    families,
    floorLineAnalysis: [0, 1, -400],
    basinSupport: 1,
    stability: {
      stable: true,
      classPreserving: true,
      splitFloorLines: [[0, 1, -399], [0, 1, -401]],
      splitVsFullProbeDistancesPx: [[1, 1, 1, 1], [1, 1, 1, 1]],
      maxSplitVsFullProbeDistancePx: 1,
    },
    distinctness: { chordal: 0.5, directionAngleDegrees: 180 },
  };
  return {
    segmentCounts: { raw: 100, admittedAllNineInside: 24 },
    candidateDiscovery: { finalFamilies: families, attempts: [] },
    validFamilyCount: 2,
    candidateUnorderedPairCount: 1,
    validPairCount: 1,
    invalidPairs: [],
    validPairUniverse: [pair],
    winningPair: pair,
  };
}

function v3Subset(diagnostics: Record<string, unknown>) {
  const discovery = diagnostics.candidateDiscovery as Record<string, unknown> | undefined;
  return {
    segmentCounts: diagnostics.segmentCounts ?? null,
    candidateDiscovery: diagnostics.candidateDiscovery ?? null,
    validFamilyCount: diagnostics.validFamilyCount ?? null,
    candidateUnorderedPairCount: diagnostics.candidateUnorderedPairCount ?? null,
    validPairCount: diagnostics.validPairCount ?? null,
    invalidPairs: diagnostics.invalidPairs ?? null,
    validPairUniverse: diagnostics.validPairUniverse ?? null,
    finalFamilies: discovery?.finalFamilies ?? null,
    winningPair: diagnostics.winningPair ?? null,
  };
}

function v3Receipt(options: Readonly<{
  status?: "usable" | "rejected";
  line?: Readonly<{ a: number; b: number; c: number }>;
  early?: boolean;
  reason?: "invalid_input_image" | "invalid_roi";
}> = {}) {
  const status = options.status ?? "usable";
  const early = options.early ?? false;
  const reason = early ? options.reason ?? "invalid_input_image" : "insufficient_segments";
  const imageIdentity = {
    sha256: sha256(bytes),
    byteCount: bytes.byteLength,
    decodedWidth: reason === "invalid_input_image" ? null : 1264,
    decodedHeight: reason === "invalid_input_image" ? null : 848,
  };
  const roiBase = {
    coordinateSpace: "source-normalized/v1",
    polygon: input().roi.polygon,
  };
  const roiIdentity = { ...roiBase, roiDigest: sha256(canonical(roiBase)) };
  const runtimeIdentity = {
    readerModuleVersion: "afc-sr1-tile-floor-reader/v3",
    opencvVersion: "4.11.0",
    numpyVersion: "2.4.6",
  };
  const diagnostics = early
    ? {}
    : status === "usable"
      ? validDiagnostics()
      : { segmentCounts: { raw: 0, admittedAllNineInside: 0 } };
  const line = options.line ?? row.floorVanishingLinePixel;
  const preimage = {
    schemaVersion: AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION,
    researchProfile: AFC_SR1_TR2_V3_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_V3_POLICY_VERSION,
    image: imageIdentity,
    roi: roiIdentity,
    runtime: runtimeIdentity,
    status,
    diagnostics: v3Subset(diagnostics),
    ...(!early ? { analysisIdentity } : {}),
    ...(status === "usable" ? { floorVanishingLinePixel: line } : { reason }),
  };
  const evidenceCanonicalJson = canonical(preimage);
  return {
    schemaVersion: AFC_SR1_TR2_V3_RESULT_SCHEMA_VERSION,
    researchProfile: AFC_SR1_TR2_V3_RESEARCH_PROFILE,
    policyVersion: AFC_SR1_TR2_V3_POLICY_VERSION,
    status,
    imageIdentity,
    roiIdentity,
    runtimeIdentity,
    diagnostics,
    ...(!early ? { analysisIdentity } : {}),
    ...(status === "usable" ? { floorVanishingLinePixel: line } : { reason }),
    evidenceCanonicalJson,
    evidenceDigest: {
      algorithm: "sha256",
      encoding: "hex",
      value: sha256(evidenceCanonicalJson),
    },
    elapsedMs: 2.5,
  };
}

function rebind(value: any): void {
  const preimage = JSON.parse(value.evidenceCanonicalJson);
  preimage.diagnostics = v3Subset(value.diagnostics);
  value.evidenceCanonicalJson = canonical(preimage);
  value.evidenceDigest.value = sha256(value.evidenceCanonicalJson);
}

test("V3 valid receipt, canonical digest, identities, and pair evidence are accepted", () => {
  const result = validateAfcSr1Tr2ReaderReceipt(v3Receipt(), input());
  assert.equal(result.status, "usable");
});

test("V3 profile, policy, schema, module, image, and ROI mismatches fail closed", () => {
  for (const mutate of [
    (value: any) => { value.researchProfile = "afc-sr1-tr2-tile-floor-reader/v2"; },
    (value: any) => { value.policyVersion = "afc-sr1-ts2-extractor-policy/v2"; },
    (value: any) => { value.schemaVersion = "afc-sr1-tr2-tile-floor-reader-result/v2"; },
    (value: any) => { value.runtimeIdentity.readerModuleVersion = "afc-sr1-tile-floor-reader/v2"; },
    (value: any) => { value.imageIdentity.sha256 = "b".repeat(64); },
    (value: any) => { value.roiIdentity.roiDigest = "b".repeat(64); },
  ]) {
    const value = structuredClone(v3Receipt());
    mutate(value);
    assert.throws(() => validateAfcSr1Tr2ReaderReceipt(value, input()));
  }
});

test("V3 nonfinite line and analysis identity mismatch or omission fail closed", () => {
  const nonfinite = structuredClone(v3Receipt()) as any;
  nonfinite.floorVanishingLinePixel.a = Number.POSITIVE_INFINITY;
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(nonfinite, input()));

  const mismatch = structuredClone(v3Receipt()) as any;
  mismatch.analysisIdentity.scaleX = 2;
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(mismatch, input()));

  const missing = structuredClone(v3Receipt()) as any;
  delete missing.analysisIdentity;
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(missing, input()));
});

test("V3 tampered family, pair, canonical text, or digest evidence fails closed", () => {
  const familyTamper = structuredClone(v3Receipt()) as any;
  familyTamper.diagnostics.winningPair.families[0].vpClass = "unknown";
  familyTamper.diagnostics.validPairUniverse[0].families[0].vpClass = "unknown";
  rebind(familyTamper);
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(familyTamper, input()));

  const pairTamper = structuredClone(v3Receipt()) as any;
  pairTamper.diagnostics.winningPair.stability.maxSplitVsFullProbeDistancePx = 19;
  pairTamper.diagnostics.validPairUniverse[0].stability.maxSplitVsFullProbeDistancePx = 19;
  rebind(pairTamper);
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(pairTamper, input()));

  const noncanonical = structuredClone(v3Receipt()) as any;
  noncanonical.evidenceCanonicalJson += " ";
  noncanonical.evidenceDigest.value = sha256(noncanonical.evidenceCanonicalJson);
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(noncanonical, input()));

  const digest = structuredClone(v3Receipt()) as any;
  digest.evidenceDigest.value = "0".repeat(64);
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(digest, input()));
});

test("V3 early rejection may omit analysis identity; later rejection may not", () => {
  assert.equal(validateAfcSr1Tr2ReaderReceipt(v3Receipt({ status: "rejected", early: true }), input()).status, "rejected");
  assert.equal(validateAfcSr1Tr2ReaderReceipt(
    v3Receipt({ status: "rejected", early: true, reason: "invalid_roi" }),
    input()
  ).status, "rejected");
  assert.equal(validateAfcSr1Tr2ReaderReceipt(v3Receipt({ status: "rejected" }), input()).status, "rejected");
  const missing = structuredClone(v3Receipt({ status: "rejected" })) as any;
  delete missing.analysisIdentity;
  assert.throws(() => validateAfcSr1Tr2ReaderReceipt(missing, input()));
});

test("historical V3 legacy-unbound bridge invokes unchanged TR0 and skips rejected receipts", async () => {
  const direct = deriveAfcSr1FloorVanishingLineCrossRoom({
    analysisImage: row.analysisImage,
    floorVanishingLinePixel: row.floorVanishingLinePixel,
    sourcePolygon: row.sourcePolygon,
    truncatedAnchor: row.truncatedAnchor,
  });
  const usable = await executeAfcSr1TileFloorReader(input(), {
    callCompositor: async () => structuredClone(v3Receipt()),
  });
  assert.deepEqual(usable.legacyUnboundProjectiveHandoff, direct);

  const rejected = await executeAfcSr1TileFloorReader(input(), {
    callCompositor: async () => structuredClone(v3Receipt({ status: "rejected", early: true })),
  });
  assert.equal(rejected.legacyUnboundProjectiveHandoff, null);
});

test("strict execution opens TR0 only through common-basis authority", async () => {
  const strict = await executeAfcSr1TileFloorReader(strictInput(), {
    callCompositor: async () => structuredClone(v3Receipt()),
  });
  assert.equal(strict.commonBasisHandoff?.status, "validated");
  assert.equal(strict.projectiveHandoff?.status, "usable");
  assert.equal(strict.legacyUnboundProjectiveHandoff, null);

  const tiled = await executeAfcSr1TileFloorReader({
    ...strictInput("ts0_child"),
    strictTr0Handoff: {
      ...strictInput("ts0_child").strictTr0Handoff!,
      basisBoundSourcePolygon: buildAfcSr1BasisBoundSourcePolygon({
        polygon: row.sourcePolygon as unknown as AfcSr1SourcePolygon,
        basis: {
          fingerprint: "b".repeat(64),
          decodedWidth: 1264,
          decodedHeight: 848,
          orientation: 1,
        },
        provenance: {
          kind: "empty_room_read",
          evidenceReference: "synthetic/empty-parent",
        },
      }),
    },
  }, {
    callCompositor: async () => structuredClone(v3Receipt()),
  });
  assert.deepEqual(tiled.commonBasisHandoff, {
    status: "rejected",
    reason: "projective_basis_unproven",
  });
  assert.equal(tiled.projectiveHandoff, null);
});

test("RAW-first case A returns raw-direct and does not call fallback", async () => {
  let fallbackCalls = 0;
  const result = await executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => {
      fallbackCalls += 1;
      return input();
    },
    { callCompositor: async () => structuredClone(v3Receipt()) }
  );
  assert.equal(result.mode, "raw-direct");
  assert.equal(fallbackCalls, 0);
  assert.equal(result.tiled, null);
});

test("RAW-first cases B and D use one fallback after a RAW reader rejection", async () => {
  let compositorCalls = 0;
  let fallbackCalls = 0;
  const result = await executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => {
      fallbackCalls += 1;
      return input();
    },
    {
      callCompositor: async () => structuredClone(
        compositorCalls++ === 0 ? v3Receipt({ status: "rejected", early: true }) : v3Receipt()
      ),
    }
  );
  assert.equal(result.mode, "tiled-fallback");
  assert.equal(compositorCalls, 2);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.tiled?.legacyUnboundProjectiveHandoff?.status, "usable");
});

test("RAW-first case C falls back when RAW downstream rejects", async () => {
  const rejectedLine = { a: 1, b: 0, c: 0 };
  const rawDownstream = deriveAfcSr1FloorVanishingLineCrossRoom({
    analysisImage: row.analysisImage,
    floorVanishingLinePixel: rejectedLine,
    sourcePolygon: row.sourcePolygon,
    truncatedAnchor: row.truncatedAnchor,
  });
  assert.equal(rawDownstream.status, "rejected");
  let compositorCalls = 0;
  const result = await executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => input(),
    {
      callCompositor: async () => structuredClone(
        compositorCalls++ === 0 ? v3Receipt({ line: rejectedLine }) : v3Receipt()
      ),
    }
  );
  assert.equal(result.mode, "tiled-fallback");
  assert.equal(compositorCalls, 2);
});

test("RAW-first case E fails closed when fallback reader rejects", async () => {
  let compositorCalls = 0;
  const result = await executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => input(),
    {
      callCompositor: async () => structuredClone(
        compositorCalls++ === 0 ? v3Receipt({ status: "rejected", early: true }) :
          v3Receipt({ status: "rejected", early: true })
      ),
    }
  );
  assert.equal(result.mode, "rejected");
  assert.equal(result.tiled?.legacyUnboundProjectiveHandoff, null);
});

test("RAW-first case E also fails closed when fallback downstream rejects", async () => {
  let compositorCalls = 0;
  const result = await executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => input(),
    {
      callCompositor: async () => structuredClone(
        compositorCalls++ === 0 ? v3Receipt({ status: "rejected", early: true }) :
          v3Receipt({ line: { a: 1, b: 0, c: 0 } })
      ),
    }
  );
  assert.equal(result.mode, "rejected");
  assert.equal(result.tiled?.legacyUnboundProjectiveHandoff?.status, "rejected");
});

test("RAW-first missing required TR0 inputs is caller failure, not fallback evidence", async () => {
  let fallbackCalls = 0;
  let compositorCalls = 0;
  await assert.rejects(() => executeAfcSr1RawFirstTileFloorReader(
    { ...input(), legacyUnboundTr0Handoff: undefined },
    async () => {
      fallbackCalls += 1;
      return input();
    },
    {
      callCompositor: async () => {
        compositorCalls += 1;
        return structuredClone(v3Receipt());
      },
    }
  ));
  assert.equal(fallbackCalls, 0);
  assert.equal(compositorCalls, 0);
});

test("RAW-first fallback missing required TR0 inputs is caller failure", async () => {
  await assert.rejects(() => executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => ({ ...input(), legacyUnboundTr0Handoff: undefined }),
    {
      callCompositor: async () => structuredClone(v3Receipt({ status: "rejected", early: true })),
    }
  ));
});

test("RAW-first cases F and G expose one line with no runner-up or target-aware authority", async () => {
  const source = await readFile(new URL("./afc-sr1-tile-floor-reader-execution.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /runner.?up|GT0|expectedSeam|targetSeam|floorVanishingLineCandidates/i);
  const result = await executeAfcSr1RawFirstTileFloorReader(
    input(),
    async () => input(),
    { callCompositor: async () => structuredClone(v3Receipt()) }
  );
  assert.equal(result.raw.readerExecution.status, "usable");
  if (result.raw.readerExecution.status === "usable") {
    assert.deepEqual(Object.keys(result.raw.readerExecution.floorVanishingLinePixel).sort(), ["a", "b", "c"]);
  }
});
