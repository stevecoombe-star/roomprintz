import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  AFC_V2_REFERENCE_DEPTH_M,
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  acceptMetricRoomPrior,
  CANONICAL_PROJECTIVE_DEPTH_GAUGE_M,
  deriveShadowAutoMetricScale,
  METRIC_PRIOR_MIN_MODEL_CONFIDENCE,
} from "./metric-room-prior-acceptance";
import {
  AFC_V2_METRIC_ROOM_PRIOR_AUTHORITY,
  AFC_V2_METRIC_ROOM_PRIOR_EVIDENCE_VERSION,
  AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION,
  AUTO_METRIC_SCALE_SOURCE,
  buildMetricRoomPriorReceipt,
  formatMetricMetres,
  METRIC_ROOM_PRIOR_ACCEPTED_STATUS_COPY,
  METRIC_ROOM_PRIOR_NOT_APPLIED_COPY,
  METRIC_ROOM_PRIOR_UNRELIABLE_COPY,
  parseMetricRoomPriorModelEstimate,
  type MetricRoomPriorModelEstimate,
  type MetricRoomPriorReceipt,
} from "./metric-room-prior-contract";
import {
  AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL,
  estimateMetricRoomPrior,
  metricRoomPriorPrompt,
} from "./metric-room-prior.server";
import {
  AUTO_METRIC_SCALE,
  computeMetricScale,
  USER_WORLD_SCALE_MAX,
  USER_WORLD_SCALE_MIN,
} from "./scene-metric-world-realization";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function readV2(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const originalIdentity = {
  sha256: sha(ORIGINAL_BYTES),
  byteCount: ORIGINAL_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const originalBasis = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const emptyBasis = {
  sha256: sha(EMPTY_BYTES),
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const tiledBasis = {
  sha256: "c".repeat(64),
  byteCount: 3,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const input: AfcV2AnalyzeInput = {
  attemptId: "v2-ux3a-metric-prior",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 21,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function acceptedRawEstimate(overrides: Record<string, unknown> = {}) {
  return {
    observability: "recoverable",
    estimatedRoomDepthM: { low: 5.2, best: 6.0, high: 6.8 },
    estimatedRoomWidthM: { low: 10.0, best: 12.0, high: 14.0 },
    estimatedCeilingHeightM: 2.7,
    modelConfidence: 0.82,
    limitations: ["Door height used as a soft cue, not a fixed standard."],
    notes: null,
    ...overrides,
  };
}

function parsedEstimate(
  raw: unknown = acceptedRawEstimate(),
): MetricRoomPriorModelEstimate {
  const parsed = parseMetricRoomPriorModelEstimate(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("metric prior parse failed");
  return parsed.estimate;
}

function observationEvidence() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [{
      id: "visible_floor",
      category: "floor",
      sourceNormalizedPolygon: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 0.8, y: 0.62 },
        { x: 0.2, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedSeams: [],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-02T12:00:00.000Z",
  });
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-ux3a-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: input.sourceImageUrl,
      basis: originalBasis,
    }),
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: EMPTY_BYTES,
      generated: true,
    }),
    generateTiled: async () => ({
      status: "generated",
      input: emptyBasis,
      tiled: {
        base64: Buffer.from([1, 2, 3]).toString("base64"),
        identity: tiledBasis,
      },
      provenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: "v2-ux3a-generation",
        generatedAt: "2026-09-02T12:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
    } as never),
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => ({
      status: "ok",
      decodedIdentity: tiledBasis,
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      authoritativeQuadSourceNormalized: authoritativeFloorQuad,
      authoritativeQuadPixel: [
        { x: 120, y: 720 },
        { x: 1080, y: 720 },
        { x: 780, y: 440 },
        { x: 420, y: 440 },
      ],
      authoritativeCore: {
        rows: 2,
        columns: 2,
        j0: 0,
        i0: 0,
        cellIds: [1, 2, 3, 4],
      },
      selectedComponentTileCount: 4,
      rawQuadrilateralCount: 4,
      deduplicatedCellCount: 4,
      reprojectionMeanPx: 0.5,
      reprojectionMaxPx: 1,
    }),
  };
}

function receiptFromEstimate(
  estimate: MetricRoomPriorModelEstimate,
): MetricRoomPriorReceipt {
  return buildMetricRoomPriorReceipt({
    sourceImageHash: originalBasis.sha256,
    originalAncestorSha256: originalBasis.sha256,
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    provider: "controlled_fixture",
    model: "fixture",
  }, estimate, acceptMetricRoomPrior(estimate), null);
}

test("parser accepts a valid estimate including optional ceiling and limitations", () => {
  const parsed = parseMetricRoomPriorModelEstimate(acceptedRawEstimate());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.estimate.observability, "recoverable");
  assert.deepEqual(parsed.estimate.estimatedRoomDepthM, {
    low: 5.2,
    best: 6,
    high: 6.8,
  });
  assert.equal(parsed.estimate.estimatedCeilingHeightM, 2.7);
  assert.equal(parsed.estimate.modelConfidence, 0.82);
  assert.equal(parsed.estimate.limitations.length, 1);
  assert.equal(parsed.estimate.notes, null);
});

test("parser accepts not_recoverable with null ranges", () => {
  const parsed = parseMetricRoomPriorModelEstimate({
    observability: "not_recoverable",
    estimatedRoomDepthM: null,
    estimatedRoomWidthM: null,
    estimatedCeilingHeightM: null,
    modelConfidence: 0.1,
    limitations: ["No reliable physical cues."],
    notes: null,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.estimate.observability, "not_recoverable");
  assert.equal(parsed.estimate.estimatedRoomDepthM, null);
  assert.equal(parsed.estimate.estimatedRoomWidthM, null);
});

test("parser accepts missing optional ceiling", () => {
  const parsed = parseMetricRoomPriorModelEstimate({
    ...acceptedRawEstimate(),
    estimatedCeilingHeightM: undefined,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.estimate.estimatedCeilingHeightM, null);
});

test("parser keeps one-decimal and raw high-precision values without snapping", () => {
  const oneDecimal = parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: 5.8, best: 5.8, high: 5.8 },
  }));
  assert.equal(oneDecimal.ok, true);
  if (oneDecimal.ok) {
    assert.equal(oneDecimal.estimate.estimatedRoomDepthM?.best, 5.8);
  }
  const precise = parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: 5.8, best: 5.827314, high: 6.1 },
  }));
  assert.equal(precise.ok, true);
  if (precise.ok) {
    assert.equal(precise.estimate.estimatedRoomDepthM?.best, 5.827314);
  }
});

test("parser rejects malformed JSON shapes, non-finite, and invalid confidence", () => {
  assert.equal(parseMetricRoomPriorModelEstimate("not-json").ok, false);
  assert.equal(parseMetricRoomPriorModelEstimate(null).ok, false);
  assert.equal(parseMetricRoomPriorModelEstimate({}).ok, false);
  assert.equal(
    parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
      estimatedRoomDepthM: { low: 5, best: Number.NaN, high: 6 },
    })).ok,
    false,
  );
  assert.equal(
    parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
      estimatedRoomDepthM: { low: 5, best: Infinity, high: 6 },
    })).ok,
    false,
  );
  assert.equal(
    parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
      modelConfidence: 1.4,
    })).ok,
    false,
  );
  assert.equal(
    parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
      limitations: "not-an-array",
    })).ok,
    false,
  );
});

test("parser retains negative and inverted ranges for host rejection", () => {
  const negative = parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: -2, best: -1, high: 0 },
  }));
  assert.equal(negative.ok, true);
  const inverted = parseMetricRoomPriorModelEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: 7, best: 6, high: 5 },
  }));
  assert.equal(inverted.ok, true);
});

test("accepted recoverable width yields a legacy depth/gauge diagnostic and does not change the fallback Auto constant", () => {
  const estimate = parsedEstimate();
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "accepted");
  assert.ok(acceptance.reasons.includes("host_accepted_width_prior"));
  assert.ok(acceptance.reasons.includes("depth_retained_as_diagnostic"));
  assert.equal(acceptance.derivedAutoMetricScale, 1.5);
  assert.equal(deriveShadowAutoMetricScale(6), 1.5);
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(computeMetricScale(AUTO_METRIC_SCALE, 1), 1);
});

test("low model confidence is host-rejected even when the model is confident in wording", () => {
  const estimate = parsedEstimate(acceptedRawEstimate({
    modelConfidence: METRIC_PRIOR_MIN_MODEL_CONFIDENCE - 0.2,
  }));
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "weak_rejected");
  assert.ok(acceptance.reasons.includes("model_confidence_below_host_minimum"));
  assert.equal(acceptance.derivedAutoMetricScale, 1.5);
});

test("not_recoverable is unobservable_rejected", () => {
  const estimate = parsedEstimate({
    observability: "not_recoverable",
    estimatedRoomDepthM: null,
    estimatedRoomWidthM: null,
    estimatedCeilingHeightM: null,
    modelConfidence: 0.9,
    limitations: [],
    notes: null,
  });
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "unobservable_rejected");
  assert.equal(acceptance.derivedAutoMetricScale, null);
});

test("implausible physical depth is rejected without clamping", () => {
  const estimate = parsedEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: 38, best: 40, high: 42 },
  }));
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "implausible_rejected");
  assert.equal(estimate.estimatedRoomDepthM?.best, 40);
  assert.equal(acceptance.derivedAutoMetricScale, 10);
});

test("legacy depth/gauge ratio outside 0.50–2.00 is not an acceptance gate", () => {
  const estimate = parsedEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: 8.5, best: 9, high: 9.5 },
  }));
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "accepted");
  assert.equal(acceptance.derivedAutoMetricScale, 2.25);
  assert.ok(acceptance.derivedAutoMetricScale! > USER_WORLD_SCALE_MAX);
  assert.equal(
    acceptance.reasons.includes("derived_auto_metric_scale_outside_certified_band"),
    false,
  );
  assert.equal(USER_WORLD_SCALE_MIN, 0.5);
  assert.equal(USER_WORLD_SCALE_MAX, 2);
  const acceptanceSource = readV2("metric-room-prior-acceptance.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(
    acceptanceSource,
    /derived_auto_metric_scale_outside_certified_band/,
  );
  assert.doesNotMatch(
    acceptanceSource,
    /derivedScaleInCertifiedBand/,
  );
});

test("width that disagrees with a TILED-like Floor ratio is not an acceptance input", () => {
  const acceptanceSource = readV2("metric-room-prior-acceptance.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(acceptanceSource, /widthDepthRatio/);
  assert.doesNotMatch(acceptanceSource, /tiled/i);
  assert.match(
    acceptanceSource,
    /export function acceptMetricRoomPrior\(\s*estimate:/,
  );
  const estimate = parsedEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: { low: 5.2, best: 6.0, high: 6.8 },
    estimatedRoomWidthM: { low: 18, best: 20, high: 22 },
  }));
  const tiledLikeRatio = 6 / 4;
  const priorRatio = 20 / 6;
  assert.notEqual(Number(priorRatio.toFixed(3)), Number(tiledLikeRatio.toFixed(3)));
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "accepted");
  assert.equal(acceptance.derivedAutoMetricScale, 1.5);
});

test("width-only recoverable estimate is accepted as the Auto physical source", () => {
  const estimate = parsedEstimate(acceptedRawEstimate({
    estimatedRoomDepthM: null,
    estimatedRoomWidthM: { low: 5, best: 6, high: 7 },
  }));
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "accepted");
  assert.equal(acceptance.derivedAutoMetricScale, null);
  assert.ok(acceptance.reasons.includes("host_accepted_width_prior"));
  assert.equal(
    acceptance.reasons.includes("depth_unavailable_width_only_not_used_for_auto"),
    false,
  );
});

test("depth-only recoverable estimate is not accepted as an Auto physical source", () => {
  const estimate = parsedEstimate(acceptedRawEstimate({
    estimatedRoomWidthM: null,
  }));
  const acceptance = acceptMetricRoomPrior(estimate);
  assert.equal(acceptance.class, "weak_rejected");
  assert.equal(acceptance.derivedAutoMetricScale, 1.5);
  assert.ok(
    acceptance.reasons.includes("width_unavailable_depth_only_not_used_for_auto"),
  );
});

test("unusual ceiling height does not by itself reject a valid depth prior", () => {
  const vaulted = parsedEstimate(acceptedRawEstimate({
    estimatedCeilingHeightM: 8.5,
  }));
  const acceptance = acceptMetricRoomPrior(vaulted);
  assert.equal(acceptance.class, "accepted");
  assert.ok(
    acceptance.reasons.includes(
      "ceiling_outside_soft_plausibility_not_used_for_rejection",
    ),
  );
});

test("negative and inverted ranges fail closed as unavailable", () => {
  assert.equal(
    acceptMetricRoomPrior(parsedEstimate(acceptedRawEstimate({
      estimatedRoomDepthM: { low: -1, best: 6, high: 7 },
    }))).class,
    "unavailable",
  );
  assert.equal(
    acceptMetricRoomPrior(parsedEstimate(acceptedRawEstimate({
      estimatedRoomDepthM: { low: 7, best: 6, high: 5 },
    }))).class,
    "unavailable",
  );
});

test("canonical projective depth gauge remains 4 and is not rewritten as physical metres", () => {
  assert.equal(CANONICAL_PROJECTIVE_DEPTH_GAUGE_M, 4);
  assert.equal(AFC_V2_REFERENCE_DEPTH_M, 4);
  assert.equal(CANONICAL_PROJECTIVE_DEPTH_GAUGE_M, AFC_V2_REFERENCE_DEPTH_M);
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  assert.match(analysisSource, /export const AFC_V2_REFERENCE_DEPTH_M = 4/);
  const acceptanceExecutable = readV2("metric-room-prior-acceptance.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(acceptanceExecutable, /physical metres/i);
});

test("Gemini metric-prior call consumes ORIGINAL bytes and a separate prompt", async () => {
  let suppliedPrompt = "";
  let suppliedMime = "";
  let suppliedBase64 = "";
  const result = await estimateMetricRoomPrior({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    original: { bytes: ORIGINAL_BYTES, identity: originalIdentity },
  }, {
    model: "fixture",
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      suppliedMime = args.mimeType;
      suppliedBase64 = args.imageBase64;
      assert.equal(args.model, "fixture");
      return acceptedRawEstimate();
    },
  });
  assert.equal(result.authority, AFC_V2_METRIC_ROOM_PRIOR_AUTHORITY);
  assert.equal(result.schemaVersion, AFC_V2_METRIC_ROOM_PRIOR_EVIDENCE_VERSION);
  assert.equal(result.promptVersion, AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION);
  assert.equal(result.sourceImageKind, "ORIGINAL");
  assert.equal(result.sourceImageHash, originalIdentity.sha256);
  assert.equal(result.hostAcceptance.class, "accepted");
  assert.equal(result.hostAcceptance.derivedAutoMetricScale, 1.5);
  assert.equal(result.autoMetricScaleSource, AUTO_METRIC_SCALE_SOURCE.metric_prior);
  assert.equal(suppliedMime, "image/jpeg");
  assert.equal(suppliedBase64, Buffer.from(ORIGINAL_BYTES).toString("base64"));
  assert.notEqual(suppliedBase64, Buffer.from(EMPTY_BYTES).toString("base64"));
  assert.match(suppliedPrompt, /soft physical-size prior/i);
  assert.match(suppliedPrompt, /not_recoverable/);
  assert.match(suppliedPrompt, /Do not output autoMetricScale/);
  assert.match(suppliedPrompt, /Do not infer FOV/);
  assert.match(suppliedPrompt, /ORIGINAL photograph/);
  assert.doesNotMatch(suppliedPrompt, /Inspect only the visible architectural evidence/);
});

test("malformed provider JSON becomes an unavailable receipt, not a throw", async () => {
  const result = await estimateMetricRoomPrior({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    original: { bytes: ORIGINAL_BYTES, identity: originalIdentity },
  }, {
    callProvider: async () => "{not json",
  });
  assert.equal(result.hostAcceptance.class, "unavailable");
  assert.equal(result.estimate, null);
  assert.equal(result.failure?.failureClass, "contract_validation");
});

test("metric provider fixture throw is receipted as unavailable", async () => {
  const result = await estimateMetricRoomPrior({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    original: { bytes: ORIGINAL_BYTES, identity: originalIdentity },
  }, {
    callProvider: async () => {
      throw new Error("controlled provider throw");
    },
  });
  assert.equal(result.hostAcceptance.class, "unavailable");
  assert.match(result.failure?.safeDetail ?? "", /controlled provider throw/);
});

test("metric provider failure does not block AFC Apply, Floor, camera, or S4", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => observationEvidence(),
    estimateMetricRoom: async () => {
      throw new Error("metric provider boom");
    },
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.floor);
  assert.equal(result.camera.applied, true);
  assert.equal(result.camera.originalBasisRestored, true);
  assert.ok(result.roomBoundaries);
  assert.ok(result.roomCollision);
  assert.equal(result.metricRoomPrior?.hostAcceptance.class, "unavailable");
  assert.match(
    result.metricRoomPrior?.failure?.safeDetail ?? "",
    /metric provider boom/,
  );
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(computeMetricScale(AUTO_METRIC_SCALE, 1.25), 1.25);
  assert.equal(METRIC_ROOM_PRIOR_UNRELIABLE_COPY, "Couldn't estimate reliably");
});

test("accepted width prior stays off live autoMetricScale until UX-3C0 trust wiring", async () => {
  const estimate = parsedEstimate();
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => observationEvidence(),
    estimateMetricRoom: async () => receiptFromEstimate(estimate),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.metricRoomPrior?.hostAcceptance.class, "accepted");
  assert.equal(result.metricRoomPrior?.hostAcceptance.derivedAutoMetricScale, 1.5);
  assert.equal(result.metricRoomPrior?.autoMetricScaleSource, "metric_prior");
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(computeMetricScale(AUTO_METRIC_SCALE, 1), 1);
  assert.equal(result.floor.referenceDepthM, 4);
  const roomLabSource = readV2("RoomLabV2.tsx");
  const realizationSource = readV2("scene-metric-world-realization.ts");
  const autoScaleSource = readV2("metric-auto-scale.ts");
  assert.match(roomLabSource, /deriveAutoMetricScale\(/);
  assert.match(
    roomLabSource,
    /computeMetricScale\(autoMetricScale, userWorldScale\)/,
  );
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*metricRoomPrior/);
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*derivedAutoMetricScale/);
  assert.doesNotMatch(realizationSource, /metricRoomPrior|derivedAutoMetricScale/);
  assert.doesNotMatch(autoScaleSource, /derivedAutoMetricScale/);
  assert.doesNotMatch(autoScaleSource, /CANONICAL_PROJECTIVE_DEPTH_GAUGE_M/);
  assert.equal(result.product.metric.referenceDepthM, 4);
});

test("geometry observer prompts stay metric-free and uncombined", () => {
  const general = readV2("empty-room-observation.server.ts");
  const ceiling = readV2("empty-side-ceiling-wall-observation.server.ts");
  const floor = readV2("empty-side-floor-wall-observation.server.ts");
  const metricPrompt = metricRoomPriorPrompt();
  for (const source of [general, ceiling, floor]) {
    assert.doesNotMatch(source, /estimatedRoomDepthM/);
    assert.doesNotMatch(source, /afc-v2-metric-room-prior/);
    assert.doesNotMatch(source, /autoMetricScaleSource/);
    assert.doesNotMatch(source, /metricRoomPriorPrompt/);
  }
  assert.match(general, /Never return world coordinates, metric dimensions/);
  assert.match(ceiling, /Inspect only the supplied EMPTY image pixels/);
  assert.match(floor, /EMPTY room image only for visible left and right/);
  assert.match(metricPrompt, /ORIGINAL photograph only/);
  assert.doesNotMatch(metricPrompt, /Inspect only the visible architectural evidence in the supplied EMPTY/);
  assert.equal(
    AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION,
    "afc-v2-metric-room-prior/v1",
  );
  assert.equal(AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL, "gemini-3.5-flash");
});

test("metric prior is not imported by Floor, FOV, camera, S4, or collision authority", () => {
  const forbidden = [
    "fully-tiled-floor-authority.server.ts",
    "room-boundary-authority.server.ts",
    "room-collision-qualification.server.ts",
    "room-collision-geometry.ts",
    "scene-collision-resolver.ts",
    "empty-authoritative-collision-qualification.server.ts",
    "empty-room-observation.server.ts",
    "empty-side-ceiling-wall-observation.server.ts",
    "empty-side-floor-wall-observation.server.ts",
    "scene-metric-world-realization.ts",
    "CalibratedRoomViewer.tsx",
    "room-envelope-authority.server.ts",
    "original-localized-boundary.server.ts",
    "room-boundary-projection.server.ts",
  ];
  for (const fileName of forbidden) {
    const source = readV2(fileName);
    assert.doesNotMatch(
      source,
      /metric-room-prior/,
      `${fileName} must not import the metric prior`,
    );
  }
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  assert.match(analysisSource, /startMetricRoomPrior/);
  assert.doesNotMatch(
    analysisSource,
    /constructAfcV2RoomBoundaryAuthority\([\s\S]{0,500}metricRoomPrior/,
  );
  assert.doesNotMatch(
    analysisSource,
    /settleAfcFixedSeamCalibrationWithRatioExtension\([\s\S]{0,400}metricRoomPrior/,
  );
});

test("future Auto source naming stays provider-agnostic", () => {
  const contract = readV2("metric-room-prior-contract.ts");
  const combined = readdirSync(V2_DIRECTORY)
    .filter((fileName) => /\.(?:ts|tsx)$/.test(fileName) && !fileName.endsWith(".test.ts"))
    .map((fileName) => readV2(fileName))
    .join("\n");
  assert.doesNotMatch(combined, /geminiMetricScale|geminiAutoScale/);
  assert.match(contract, /autoMetricScaleSource/);
  assert.match(contract, /"metric_prior"/);
  assert.match(contract, /known_span/);
  assert.match(contract, /depth_metadata/);
  assert.match(contract, /catalogue_reference/);
  assert.equal(AUTO_METRIC_SCALE_SOURCE.none, "none");
  assert.equal(AUTO_METRIC_SCALE_SOURCE.metric_prior, "metric_prior");
});

test("World Scale UI exposes width/depth diagnostics without applying the legacy depth/gauge ratio", () => {
  const roomLabSource = readV2("RoomLabV2.tsx");
  assert.match(roomLabSource, /Room Size Prior/);
  assert.match(roomLabSource, /METRIC_ROOM_PRIOR_UNRELIABLE_COPY/);
  assert.match(roomLabSource, /METRIC_ROOM_PRIOR_ACCEPTED_STATUS_COPY/);
  assert.match(roomLabSource, /METRIC_ROOM_PRIOR_NOT_APPLIED_COPY/);
  assert.match(roomLabSource, /Download Metric Prior/);
  assert.match(roomLabSource, /afc-v2-metric-room-prior-evidence\.json/);
  assert.match(roomLabSource, /Approx\. width:/);
  assert.match(roomLabSource, /Width range:/);
  assert.match(roomLabSource, /Approx\. depth:/);
  assert.match(roomLabSource, /Depth range:/);
  assert.match(roomLabSource, /Confidence:/);
  assert.doesNotMatch(roomLabSource, /Room-prior shadow ratio/);
  assert.doesNotMatch(roomLabSource, /derivedShadowAuto/);
  assert.match(roomLabSource, /deriveAutoMetricScale\(/);
  assert.match(
    roomLabSource,
    /computeMetricScale\(autoMetricScale, userWorldScale\)/,
  );
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*derivedShadowAuto/);
  assert.doesNotMatch(roomLabSource, /Gemini/);
  assert.equal(METRIC_ROOM_PRIOR_ACCEPTED_STATUS_COPY, "Approximate estimate");
  assert.equal(METRIC_ROOM_PRIOR_NOT_APPLIED_COPY, "Not applied");
  assert.equal(METRIC_ROOM_PRIOR_UNRELIABLE_COPY, "Couldn't estimate reliably");
  assert.equal(formatMetricMetres(5.827), "5.8 m");
  const priorPanel = roomLabSource.slice(
    roomLabSource.indexOf("Room Size Prior"),
    roomLabSource.indexOf("Download Metric Prior"),
  );
  const rejectedBlock = priorPanel.slice(
    priorPanel.lastIndexOf("METRIC_ROOM_PRIOR_UNRELIABLE_COPY"),
  );
  assert.match(rejectedBlock, /METRIC_ROOM_PRIOR_UNRELIABLE_COPY/);
  assert.match(rejectedBlock, /METRIC_ROOM_PRIOR_NOT_APPLIED_COPY/);
  assert.doesNotMatch(rejectedBlock, /Room-prior shadow ratio/);
  assert.doesNotMatch(rejectedBlock, /Approx\. width/);
  assert.doesNotMatch(rejectedBlock, /Approx\. depth/);
  assert.doesNotMatch(rejectedBlock, /derivedShadowAuto/);
  assert.match(
    roomLabSource,
    /Calibrated · width \$\{realizedFloor\?\.worldWidthM\.toFixed\(2\)\} m/,
  );
  assert.doesNotMatch(
    roomLabSource,
    /realizedFloor[\s\S]{0,200}estimatedRoomDepthM/,
  );
  assert.match(roomLabSource, /setPipeline\(null\)/);
  assert.match(roomLabSource, /setUserWorldScale\(USER_WORLD_SCALE_DEFAULT\)/);
});

test("same-session Analyze replaces the metric receipt and does not reset World Scale", () => {
  const roomLabSource = readV2("RoomLabV2.tsx");
  const analyzeBlock = roomLabSource.slice(
    roomLabSource.indexOf("async function analyzeAndApply"),
    roomLabSource.indexOf("function downloadAnalysisEvidence"),
  );
  assert.match(analyzeBlock, /setPipeline\(null\)/);
  assert.doesNotMatch(analyzeBlock, /setUserWorldScale/);
  const prepareBlock = roomLabSource.slice(
    roomLabSource.indexOf("async function prepareOriginal"),
    roomLabSource.indexOf("async function analyzeAndApply"),
  );
  assert.match(prepareBlock, /setPipeline\(null\)/);
  assert.match(prepareBlock, /setUserWorldScale\(USER_WORLD_SCALE_DEFAULT\)/);
});
