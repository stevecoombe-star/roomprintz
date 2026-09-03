import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  acceptMetricCorrespondenceEstimate,
  METRIC_SPAN_MIN_MODEL_CONFIDENCE,
} from "./metric-correspondence-estimate-acceptance";
import {
  AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_AUTHORITY,
  AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION,
  AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_VERSION,
  buildMetricCorrespondenceEstimateReceipt,
  deriveMetricScaleFromSpan,
  formatCandidateMetricScale,
  METRIC_SPAN_ESTIMATE_NOT_APPLIED_COPY,
  METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY,
  METRIC_SPAN_ESTIMATE_UNRELIABLE_COPY,
  parseMetricCorrespondencePhysicalEstimate,
  type MetricCorrespondencePhysicalEstimate,
} from "./metric-correspondence-estimate-contract";
import {
  AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_DEFAULT_MODEL,
  estimateMetricCorrespondenceSpan,
  metricCorrespondenceEstimatorPrompt,
  metricCorrespondenceProviderSpanMetadata,
} from "./metric-correspondence-estimate.server";
import {
  buildMetricCorrespondenceOverlaySvg,
  composeMetricCorrespondenceOverlay,
  METRIC_CORRESPONDENCE_OVERLAY_CAPTION,
  normalizedToPixel,
} from "./metric-correspondence-overlay.server";
import {
  METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
  type MetricCorrespondenceSpan,
} from "./metric-correspondence-span-contract";
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

const ROOM4_CANONICAL_LENGTH = 13.949164;
const ROOM4_PHYSICAL_BEST_M = 3.6;
const ROOM4_CANDIDATE_SCALE = ROOM4_PHYSICAL_BEST_M / ROOM4_CANONICAL_LENGTH;

const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
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
const analyzeInput: AfcV2AnalyzeInput = {
  attemptId: "v2-ux3b1-span-estimate",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 41,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function room4Span(
  overrides: Partial<MetricCorrespondenceSpan> = {},
): MetricCorrespondenceSpan {
  return {
    id: "mcs_floor_back_wall_seam",
    source: "s4a_floor_wall",
    role: "back_floor_wall",
    imageSpace: METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
    overlaySafeOnOriginal: true,
    imageA: { x: 0.531, y: 0.662 },
    imageB: { x: 0.925, y: 0.759 },
    canonicalWorldA: { x: -6.974582, z: 0 },
    canonicalWorldB: { x: 6.974582, z: 0 },
    canonicalLength: ROOM4_CANONICAL_LENGTH,
    endpointAClass: "observed_interior",
    endpointBClass: "observed_interior",
    truncation: "none",
    imageLengthNormalized: 0.406,
    confidence: 0.95,
    selectionReasons: ["role_back_floor_wall"],
    lineage: {
      s4aCandidateId: "rb_floor_back_wall_seam",
      sourceSeamId: "floor_back_wall_seam",
      registrationClass: "exact_grid_registered",
    },
    ...overrides,
  };
}

function acceptedRawEstimate(overrides: Record<string, unknown> = {}) {
  return {
    observability: "recoverable",
    estimatedLengthM: { low: 3.2, best: ROOM4_PHYSICAL_BEST_M, high: 4.0 },
    modelConfidence: 0.82,
    limitations: ["Door width used as a soft cue, not a fixed standard."],
    notes: null,
    ...overrides,
  };
}

function parsedEstimate(
  raw: unknown = acceptedRawEstimate(),
): MetricCorrespondencePhysicalEstimate {
  const parsed = parseMetricCorrespondencePhysicalEstimate(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("span estimate parse failed");
  return parsed.estimate;
}

async function originalRaster(
  width = 200,
  height = 100,
): Promise<{
  bytes: Uint8Array;
  identity: {
    sha256: string;
    byteCount: number;
    decodedWidth: number;
    decodedHeight: number;
    mimeType: "image/png";
    orientation: 1;
  };
}> {
  const bytes = Uint8Array.from(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 36, g: 36, b: 40 },
      },
    }).png().toBuffer(),
  );
  return {
    bytes,
    identity: {
      sha256: sha(bytes),
      byteCount: bytes.byteLength,
      decodedWidth: width,
      decodedHeight: height,
      mimeType: "image/png",
      orientation: 1,
    },
  };
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-ux3b1-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: analyzeInput.sourceImageUrl,
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
        runId: "v2-ux3b1-generation",
        generatedAt: "2026-09-02T18:00:00.000Z",
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

function emptyObservation() {
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
    attemptId: analyzeInput.attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-02T18:00:00.000Z",
  });
}

function eligibleFloorWallObservation() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 },
        { x: 0.5, y: 0.62 },
        { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: analyzeInput.attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-02T18:00:00.000Z",
  });
}

test("normalized ORIGINAL coordinates convert to overlay pixels", () => {
  const pixelA = normalizedToPixel({ x: 0.531, y: 0.662 }, 1200, 800);
  const pixelB = normalizedToPixel({ x: 0.925, y: 0.759 }, 1200, 800);
  assert.equal(pixelA.x, 0.531 * 1200);
  assert.equal(pixelA.y, 0.662 * 800);
  assert.equal(pixelB.x, 0.925 * 1200);
  assert.equal(pixelB.y, 0.759 * 800);
});

test("provider overlay places A/B from the selected span and is deterministic", async () => {
  const span = room4Span({
    imageA: { x: 0.2, y: 0.5 },
    imageB: { x: 0.8, y: 0.5 },
  });
  const original = await originalRaster(200, 100);
  const first = await composeMetricCorrespondenceOverlay({
    originalBytes: original.bytes,
    imageA: span.imageA,
    imageB: span.imageB,
    width: 200,
    height: 100,
    format: "png",
  });
  const second = await composeMetricCorrespondenceOverlay({
    originalBytes: original.bytes,
    imageA: span.imageA,
    imageB: span.imageB,
    width: 200,
    height: 100,
    format: "png",
  });
  assert.ok(first);
  assert.ok(second);
  assert.equal(first!.sha256, second!.sha256);
  assert.notEqual(first!.sha256, original.identity.sha256);
  assert.deepEqual(first!.pixelA, normalizedToPixel(span.imageA, 200, 100));
  assert.deepEqual(first!.pixelB, normalizedToPixel(span.imageB, 200, 100));
  assert.match(first!.svg, new RegExp(first!.pixelA.x.toFixed(2)));
  assert.match(first!.svg, new RegExp(first!.pixelB.x.toFixed(2)));
  assert.match(first!.svg, />A</);
  assert.match(first!.svg, />B</);
  assert.match(first!.svg, new RegExp(METRIC_CORRESPONDENCE_OVERLAY_CAPTION));
  const decoded = await sharp(Buffer.from(first!.bytes)).raw().toBuffer({
    resolveWithObject: true,
  });
  const sample = (x: number, y: number) => {
    const px = Math.round(x);
    const py = Math.round(y);
    const channels = decoded.info.channels;
    const index = (py * decoded.info.width + px) * channels;
    return {
      r: decoded.data[index] ?? 0,
      g: decoded.data[index + 1] ?? 0,
      b: decoded.data[index + 2] ?? 0,
    };
  };
  const aroundA = sample(first!.pixelA.x, first!.pixelA.y);
  assert.ok(aroundA.r > 180 && aroundA.g > 160, "endpoint A should be high-contrast yellow");
});

test("provider overlay does not contain canonical length or scale text", () => {
  const span = room4Span();
  const svg = buildMetricCorrespondenceOverlaySvg(
    span.imageA,
    span.imageB,
    1200,
    800,
  );
  assert.doesNotMatch(svg, /gauge/i);
  assert.doesNotMatch(svg, /canonical/i);
  assert.doesNotMatch(svg, /13\.95/);
  assert.doesNotMatch(svg, /13\.949/);
  assert.doesNotMatch(svg, /referenceDepth/i);
  assert.doesNotMatch(svg, /worldWidth/i);
  assert.doesNotMatch(svg, /metricScale/i);
  assert.doesNotMatch(svg, /TILED/);
  assert.doesNotMatch(svg, /Floor/);
  assert.doesNotMatch(svg, /\bm\b/);
});

test("provider A/B metadata matches the selected span and omits canonical fields", () => {
  const span = room4Span();
  const metadata = metricCorrespondenceProviderSpanMetadata(span);
  assert.equal(metadata.spanRole, span.role);
  assert.deepEqual(metadata.endpointA, span.imageA);
  assert.deepEqual(metadata.endpointB, span.imageB);
  assert.equal("canonicalLength" in metadata, false);
  const serialized = JSON.stringify(metadata);
  assert.doesNotMatch(serialized, /canonicalLength|canonicalWorld|referenceDepthM|worldWidthM|candidateMetricScale/);
});

test("estimator prompt is exact-span only and does not leak canonical or room-prior fields", () => {
  const prompt = metricCorrespondenceEstimatorPrompt(
    metricCorrespondenceProviderSpanMetadata(room4Span()),
  );
  assert.match(prompt, /exact highlighted line segment from endpoint A to endpoint B/i);
  assert.match(prompt, /Estimate A↔B only/);
  assert.match(prompt, /not_recoverable/);
  assert.match(prompt, /Do not infer hidden continuation/);
  assert.match(prompt, /Do not extend the segment to the frame edges/);
  assert.match(prompt, /Do not estimate whole-room width unless/);
  assert.match(prompt, /Do not estimate room depth/);
  assert.match(prompt, /one decimal metre/);
  assert.doesNotMatch(prompt, /canonicalLength/);
  assert.doesNotMatch(prompt, /referenceDepthM/);
  assert.doesNotMatch(prompt, /worldWidthM/);
  assert.doesNotMatch(prompt, /candidateMetricScale/);
  assert.doesNotMatch(prompt, /autoMetricScale/);
  assert.doesNotMatch(prompt, /estimatedRoomDepthM/);
  assert.doesNotMatch(prompt, /13\.95/);
  assert.doesNotMatch(prompt, /approximate physical depth of the visible room/);
  assert.doesNotMatch(prompt, /Inspect only the visible architectural evidence/);
  assert.equal(
    AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION,
    "afc-v2-metric-correspondence-estimator/v1",
  );
  assert.equal(
    AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_DEFAULT_MODEL,
    "gemini-3.5-flash",
  );
});

test("valid Room 4 estimate yields candidate scale ≈ 0.258 and stays accepted below 0.50", () => {
  const estimate = parsedEstimate();
  const acceptance = acceptMetricCorrespondenceEstimate(
    estimate,
    ROOM4_CANONICAL_LENGTH,
  );
  assert.equal(acceptance.class, "accepted");
  assert.equal(acceptance.candidateMetricScale, ROOM4_CANDIDATE_SCALE);
  assert.ok(Math.abs((acceptance.candidateMetricScale ?? 0) - 0.25808) < 1e-5);
  assert.ok((acceptance.candidateMetricScale ?? 1) < USER_WORLD_SCALE_MIN);
  assert.ok((acceptance.candidateMetricScale ?? 1) < USER_WORLD_SCALE_MAX);
  assert.equal(formatCandidateMetricScale(ROOM4_CANDIDATE_SCALE), "0.26×");
  const acceptanceSource = readV2("metric-correspondence-estimate-acceptance.ts");
  assert.doesNotMatch(acceptanceSource, /USER_WORLD_SCALE/);
  assert.doesNotMatch(acceptanceSource, /derived_auto_metric_scale_outside_certified_band/);
});

test("known-span helper is the same ratio as the Gemini physical best", () => {
  const fromEstimate = deriveMetricScaleFromSpan(
    ROOM4_CANONICAL_LENGTH,
    ROOM4_PHYSICAL_BEST_M,
  );
  const fromKnownSpan = deriveMetricScaleFromSpan(ROOM4_CANONICAL_LENGTH, 3.6);
  const fromSensor = deriveMetricScaleFromSpan(ROOM4_CANONICAL_LENGTH, 4.2);
  assert.equal(fromEstimate, ROOM4_CANDIDATE_SCALE);
  assert.equal(fromKnownSpan, fromEstimate);
  assert.equal(fromSensor, 4.2 / ROOM4_CANONICAL_LENGTH);
  assert.equal(deriveMetricScaleFromSpan(0, 3.6), null);
  assert.equal(deriveMetricScaleFromSpan(ROOM4_CANONICAL_LENGTH, 0), null);
});

test("weak and unobservable estimates are rejected", () => {
  assert.equal(
    acceptMetricCorrespondenceEstimate(
      parsedEstimate(acceptedRawEstimate({ observability: "weak" })),
      ROOM4_CANONICAL_LENGTH,
    ).class,
    "weak_rejected",
  );
  assert.equal(
    acceptMetricCorrespondenceEstimate(
      parsedEstimate(acceptedRawEstimate({
        observability: "not_recoverable",
        estimatedLengthM: null,
      })),
      ROOM4_CANONICAL_LENGTH,
    ).class,
    "unobservable_rejected",
  );
  assert.equal(
    acceptMetricCorrespondenceEstimate(
      parsedEstimate(acceptedRawEstimate({
        modelConfidence: METRIC_SPAN_MIN_MODEL_CONFIDENCE - 0.2,
      })),
      ROOM4_CANONICAL_LENGTH,
    ).class,
    "weak_rejected",
  );
});

test("invalid ranges fail closed", () => {
  assert.equal(
    acceptMetricCorrespondenceEstimate(
      parsedEstimate(acceptedRawEstimate({
        estimatedLengthM: { low: 4, best: 3.6, high: 3.2 },
      })),
      ROOM4_CANONICAL_LENGTH,
    ).class,
    "unavailable",
  );
  assert.equal(
    acceptMetricCorrespondenceEstimate(
      parsedEstimate(acceptedRawEstimate({
        estimatedLengthM: { low: -1, best: 3.6, high: 4 },
      })),
      ROOM4_CANONICAL_LENGTH,
    ).class,
    "unavailable",
  );
  assert.equal(
    acceptMetricCorrespondenceEstimate(null, ROOM4_CANONICAL_LENGTH).class,
    "unavailable",
  );
});

test("accepted estimate consumes overlay bytes, not stored ORIGINAL, and records overlay hash", async () => {
  const original = await originalRaster(200, 100);
  const span = room4Span({
    imageA: { x: 0.2, y: 0.5 },
    imageB: { x: 0.8, y: 0.5 },
  });
  let suppliedPrompt = "";
  let suppliedBase64 = "";
  const result = await estimateMetricCorrespondenceSpan({
    attemptId: analyzeInput.attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    original,
    span,
  }, {
    model: "fixture",
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      suppliedBase64 = args.imageBase64;
      assert.equal(args.model, "fixture");
      assert.match(args.mimeType, /image\/(jpeg|png)/);
      return acceptedRawEstimate();
    },
  });
  assert.equal(result.authority, AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_AUTHORITY);
  assert.equal(result.schemaVersion, AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_VERSION);
  assert.equal(result.promptVersion, AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION);
  assert.equal(result.sourceImageKind, "ORIGINAL_OVERLAY");
  assert.equal(result.correspondenceSpanId, span.id);
  assert.equal(result.sourceImageHash, original.identity.sha256);
  assert.notEqual(result.overlayImageHash, "");
  assert.notEqual(result.overlayImageHash, original.identity.sha256);
  assert.equal(result.hostAcceptance.class, "accepted");
  assert.equal(result.hostAcceptance.candidateMetricScale, ROOM4_CANDIDATE_SCALE);
  assert.notEqual(suppliedBase64, Buffer.from(original.bytes).toString("base64"));
  assert.match(suppliedPrompt, /exact highlighted line segment/);
  assert.match(suppliedPrompt, /"spanRole":"back_floor_wall"/);
});

test("provider throw becomes a typed unavailable receipt", async () => {
  const original = await originalRaster(200, 100);
  const result = await estimateMetricCorrespondenceSpan({
    attemptId: analyzeInput.attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    original,
    span: room4Span({
      imageA: { x: 0.2, y: 0.5 },
      imageB: { x: 0.8, y: 0.5 },
    }),
  }, {
    callProvider: async () => {
      throw new Error("controlled provider throw");
    },
  });
  assert.equal(result.hostAcceptance.class, "unavailable");
  assert.equal(result.estimate, null);
  assert.match(result.failure?.safeDetail ?? "", /controlled provider throw/);
});

test("overlay failure becomes a typed unavailable receipt and does not call the provider", async () => {
  const original = await originalRaster(200, 100);
  let providerCalls = 0;
  const result = await estimateMetricCorrespondenceSpan({
    attemptId: analyzeInput.attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    original,
    span: room4Span(),
  }, {
    composeOverlay: async () => null,
    callProvider: async () => {
      providerCalls += 1;
      return acceptedRawEstimate();
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.hostAcceptance.class, "unavailable");
  assert.equal(result.failure?.failureClass, "overlay_generation");
  assert.equal(result.failure?.contractValidationReason, "overlay_generation_failed");
});

test("no selected span does not invoke the matched-span provider", async () => {
  let providerCalls = 0;
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => emptyObservation(),
    estimateMetricCorrespondence: async () => {
      providerCalls += 1;
      throw new Error("span estimator must not run");
    },
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(providerCalls, 0);
  assert.equal(result.metricCorrespondence?.selected, null);
  assert.equal(result.metricCorrespondenceEstimate, null);
  assert.equal(result.camera.applied, true);
});

test("provider or overlay failure does not block AFC Apply", async () => {
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => eligibleFloorWallObservation(),
    estimateMetricCorrespondence: async () => {
      throw new Error("span estimator boom");
    },
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.floor);
  assert.equal(result.camera.applied, true);
  assert.equal(result.camera.originalBasisRestored, true);
  assert.ok(result.roomBoundaries);
  assert.ok(result.roomCollision);
  if (result.metricCorrespondence?.selected) {
    assert.equal(result.metricCorrespondenceEstimate?.hostAcceptance.class, "unavailable");
    assert.match(
      result.metricCorrespondenceEstimate?.failure?.safeDetail ?? "",
      /span estimator boom/,
    );
  }
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(METRIC_SPAN_ESTIMATE_UNRELIABLE_COPY, "Couldn't estimate highlighted span reliably");
});

test("live Auto is not wired from matched-span candidateMetricScale", async () => {
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => eligibleFloorWallObservation(),
    estimateMetricCorrespondence: async (input) =>
      buildMetricCorrespondenceEstimateReceipt(
        {
          correspondenceSpanId: input.span.id,
          sourceImageHash: analyzeInput.sourceImageIdentity.sha256,
          overlayImageHash: "e".repeat(64),
          attemptId: input.attemptId,
          loadGeneration: input.loadGeneration,
          provider: "controlled_fixture",
          model: "fixture",
        },
        parsedEstimate(),
        acceptMetricCorrespondenceEstimate(parsedEstimate(), input.span.canonicalLength),
        null,
      ),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(computeMetricScale(AUTO_METRIC_SCALE, 1), 1);
  assert.equal(result.floor.referenceDepthM, 4);
  const roomLabSource = readV2("RoomLabV2.tsx");
  const realizationSource = readV2("scene-metric-world-realization.ts");
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  const autoScaleSource = readV2("metric-auto-scale.ts");
  const autoContract = readV2("metric-auto-scale-contract.ts");
  assert.match(roomLabSource, /deriveAutoMetricScale\(/);
  assert.match(
    roomLabSource,
    /computeMetricScale\(autoMetricScale, userWorldScale\)/,
  );
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*candidateMetricScale/);
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*metricCorrespondenceEstimate/);
  assert.doesNotMatch(realizationSource, /candidateMetricScale|metricCorrespondenceEstimate/);
  assert.doesNotMatch(autoScaleSource, /candidateMetricScale|estimatedLengthM|metricCorrespondenceEstimate/);
  assert.doesNotMatch(autoContract, /candidateMetricScale|estimatedLengthM/);
  assert.doesNotMatch(
    analysisSource,
    /settleAfcFixedSeamCalibrationWithRatioExtension\([\s\S]{0,400}metricCorrespondenceEstimate/,
  );
  assert.doesNotMatch(
    analysisSource,
    /constructAfcV2RoomBoundaryAuthority\([\s\S]{0,500}metricCorrespondenceEstimate/,
  );
});

test("provider output cannot alter the selected UX-3b0 span", async () => {
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => eligibleFloorWallObservation(),
    estimateMetricCorrespondence: async (input) =>
      buildMetricCorrespondenceEstimateReceipt(
        {
          correspondenceSpanId: "injected-other-span",
          sourceImageHash: analyzeInput.sourceImageIdentity.sha256,
          overlayImageHash: "f".repeat(64),
          attemptId: input.attemptId,
          loadGeneration: input.loadGeneration,
          provider: "controlled_fixture",
          model: "fixture",
        },
        parsedEstimate(),
        acceptMetricCorrespondenceEstimate(
          parsedEstimate(),
          input.span.canonicalLength,
        ),
        null,
      ),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.metricCorrespondence?.selected);
  assert.notEqual(result.metricCorrespondence?.selected?.id, "injected-other-span");
  assert.equal(
    result.metricCorrespondenceEstimate?.correspondenceSpanId,
    "injected-other-span",
  );
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  const selectIndex = analysisSource.indexOf("selectMetricCorrespondenceSpan");
  const estimateIndex = analysisSource.indexOf("startMetricCorrespondenceEstimate");
  assert.ok(selectIndex > 0 && estimateIndex > selectIndex);
  assert.match(
    analysisSource,
    /if \(!selected\) return null/,
  );
});

test("UX-3a generic prior cannot alter the matched-span candidate scale", async () => {
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => eligibleFloorWallObservation(),
    estimateMetricRoom: async () => {
      throw new Error("ux3a must not feed ux3b1");
    },
    estimateMetricCorrespondence: async (input) =>
      buildMetricCorrespondenceEstimateReceipt(
        {
          correspondenceSpanId: input.span.id,
          sourceImageHash: analyzeInput.sourceImageIdentity.sha256,
          overlayImageHash: "a1".repeat(32),
          attemptId: input.attemptId,
          loadGeneration: input.loadGeneration,
          provider: "controlled_fixture",
          model: "fixture",
        },
        parsedEstimate(),
        acceptMetricCorrespondenceEstimate(
          parsedEstimate(),
          input.span.canonicalLength,
        ),
        null,
      ),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  const candidate = result.metricCorrespondenceEstimate?.hostAcceptance.candidateMetricScale;
  if (candidate !== null && candidate !== undefined) {
    const expected = deriveMetricScaleFromSpan(
      result.metricCorrespondence?.selected?.canonicalLength ?? 0,
      ROOM4_PHYSICAL_BEST_M,
    );
    assert.equal(candidate, expected);
    assert.notEqual(candidate, 1.5);
  }
  const acceptance = readV2("metric-correspondence-estimate-acceptance.ts");
  const estimator = readV2("metric-correspondence-estimate.server.ts");
  assert.doesNotMatch(acceptance, /metric-room-prior/);
  assert.doesNotMatch(acceptance, /derivedAutoMetricScale/);
  assert.doesNotMatch(acceptance, /estimatedRoomDepthM/);
  assert.doesNotMatch(estimator, /derivedAutoMetricScale/);
  assert.doesNotMatch(acceptance, /CANONICAL_PROJECTIVE_DEPTH_GAUGE_M/);
});

test("diagnostic UI keeps canonical gauge, physical metres, and candidate scale separate", () => {
  const roomLabSource = readV2("RoomLabV2.tsx");
  const overlaySource = readV2("RoomEvidenceOverlay.tsx");
  assert.match(roomLabSource, /Physical span estimate:/);
  assert.match(roomLabSource, /Diagnostic candidate scale:/);
  assert.doesNotMatch(roomLabSource, /Candidate metric scale:/);
  assert.match(roomLabSource, /Download Span Estimate/);
  assert.match(roomLabSource, /afc-v2-metric-correspondence-estimate\.json/);
  assert.match(roomLabSource, /METRIC_SPAN_ESTIMATE_UNRELIABLE_COPY/);
  assert.match(roomLabSource, /formatCanonicalGaugeUnits/);
  assert.match(roomLabSource, /formatCandidateMetricScale/);
  assert.match(roomLabSource, /formatMetricMetres/);
  assert.equal(METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY, "Shadow only");
  assert.equal(METRIC_SPAN_ESTIMATE_NOT_APPLIED_COPY, "Not applied");
  assert.doesNotMatch(overlaySource, /metricCorrespondenceEstimate/);
  assert.match(overlaySource, /metricCorrespondenceSpan\.imageA/);
  assert.match(overlaySource, /metricCorrespondenceSpan\.imageB/);
  const panel = roomLabSource.slice(
    roomLabSource.indexOf("Metric Correspondence"),
    roomLabSource.indexOf("Download Span Estimate"),
  );
  assert.doesNotMatch(panel, /Canonical length:[\s\S]{0,80}\bm\b/);
  assert.match(panel, /formatCanonicalGaugeUnits/);
  assert.match(panel, /formatMetricMetres/);
  assert.match(panel, /formatCandidateMetricScale/);
});

test("matched-span estimator is not imported by Floor, FOV, S4, or collision authority", () => {
  const forbidden = [
    "fully-tiled-floor-authority.server.ts",
    "room-boundary-authority.server.ts",
    "room-collision-qualification.server.ts",
    "room-collision-geometry.ts",
    "scene-collision-resolver.ts",
    "empty-authoritative-collision-qualification.server.ts",
    "scene-metric-world-realization.ts",
    "CalibratedRoomViewer.tsx",
    "room-envelope-authority.server.ts",
    "original-localized-boundary.server.ts",
    "room-boundary-projection.server.ts",
    "metric-correspondence-span.ts",
    "metric-room-prior-acceptance.ts",
    "metric-auto-scale.ts",
    "metric-auto-scale-contract.ts",
  ];
  for (const fileName of forbidden) {
    const source = readV2(fileName);
    assert.doesNotMatch(
      source,
      /metric-correspondence-estimate/,
      `${fileName} must not import the matched-span estimator`,
    );
  }
  const combined = readdirSync(V2_DIRECTORY)
    .filter((fileName) => /\.(?:ts|tsx)$/.test(fileName) && !fileName.endsWith(".test.ts"))
    .map((fileName) => readV2(fileName))
    .join("\n");
  assert.doesNotMatch(combined, /geminiMetricScale|geminiSpanLength|geminiAutoScale/);
});
