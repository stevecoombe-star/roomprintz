/**
 * REMOVE-1C provider-independent object segmentation.
 *
 * Roboflow serverless `concept_segment` was re-read on 18 Oct 2026 from
 * https://docs.roboflow.com/models/supported-models/sam3 (OpenAPI info
 * version 0.64.4). This module does not call that endpoint.
 *
 * Documented and decoded:
 * - `POST https://serverless.roboflow.com/sam3/concept_segment`
 * - Bearer token in `Authorization`. The query `api_key` is not used.
 * - `model_id` `sam3/sam3_final`
 * - At most 16 text prompts.
 * - Image `{ type: "base64", value }` in the submitted file's pixel space.
 * - `format: "polygon"`: `predictions[].masks` is an array of rings of `[x, y]`.
 * - `output_prob_thresh` default 0.5. Provider NMS is left unset, which the
 *   docs define as disabled, so duplicate decisions stay in our algebra.
 * - Response envelope `prompt_results[]` plus optional `time` in seconds.
 *   One captured polygon response also included `resolved_model`,
 *   `frame_id`, and `inference_id`. Those fields are ignored.
 *
 * Not decoded:
 * - `format: "rle"`. The public inference server encodes this with
 *   pycocotools on a Fortran mask (`size`, `counts`). The serverless OpenAPI
 *   types that field as an open object. The captured call requested polygons,
 *   so `decodeRoboflowRleMask` still refuses RLE.
 * - `format: "json"`, which appears only in the self-hosted SDK example.
 *
 * Polygon pixels use the image origin at the top-left, the same orientation
 * as Roboflow's top-left box coordinates. Rings are filled even-odd at pixel
 * centers. The packed mask is then owned by `packRemoveObjectMaskAtOriginal`.
 */

import { createHash } from "node:crypto";

import {
  packRemoveObjectMaskAtOriginal,
  prepareRemoveObjectMasks,
  type RemoveObjectPreparation,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";

export const REMOVE_SEGMENTATION_PROVIDER_ID = "roboflow" as const;
export const REMOVE_SEGMENTATION_MODEL_ID = "sam3/sam3_final" as const;
export const REMOVE_SEGMENTATION_CONCEPT_SET = "remove-segmentation-concepts/v1" as const;
export const ROBOFLOW_SAM3_POLYGON_SCHEMA =
  "roboflow-serverless-concept-segment-polygon/0.64.4" as const;
export const ROBOFLOW_SAM3_RLE_CONTRACT = "unverified" as const;

export const REMOVE_SEGMENTATION_MAX_CONCEPTS = 16;
export const REMOVE_SEGMENTATION_MAX_IMAGE_BYTES = 12_000_000;
export const REMOVE_SEGMENTATION_MAX_PIXELS = 16_000_000;
export const REMOVE_SEGMENTATION_MAX_EDGE = 8192;
export const REMOVE_SEGMENTATION_TIMEOUT_MS = 20_000;
export const REMOVE_SEGMENTATION_MAX_RESPONSE_BYTES = 8_000_000;
export const REMOVE_SEGMENTATION_MAX_PREDICTIONS = 48;
export const REMOVE_SEGMENTATION_MAX_POLYGON_POINTS = 4_000;
export const REMOVE_SEGMENTATION_MAX_RINGS = 64;
export const REMOVE_SEGMENTATION_MAX_PACKED_BYTES = 3_000_000;
export const REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH = 0.5;

export const ROBOFLOW_CONCEPT_SEGMENT_URL =
  "https://serverless.roboflow.com/sam3/concept_segment";

export const REMOVE_SEGMENTATION_CONCEPTS_V1 = Object.freeze([
  "chair",
  "sofa",
  "table",
  "lamp",
  "rug",
  "curtain",
  "plant",
  "wall art",
  "bed",
  "pillow",
  "decoration",
  "cabinet",
  "television",
  "mirror",
  "stool",
  "bookshelf",
] as const);

export const REMOVE_SEGMENTATION_ERRORS = Object.freeze([
  "credentials_missing",
  "request_rejected",
  "provider_timeout",
  "provider_unauthorized",
  "provider_http",
  "provider_network",
  "response_invalid",
  "response_unbounded",
  "rle_contract_unverified",
  "mask_dimensions",
] as const);

export type RemoveSegmentationError = (typeof REMOVE_SEGMENTATION_ERRORS)[number];

export type RemoveSegmentationRejectDetail =
  | "concepts"
  | "image_bytes"
  | "image_pixels"
  | "image_edge"
  | "image_type"
  | "image_empty"
  | "image_identity";

export type RemoveSegmentationImage = Readonly<{
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}>;

export type RemoveSegmentationFailure = Readonly<{
  ok: false;
  error: RemoveSegmentationError;
  providerStatus?: number;
  detail?: RemoveSegmentationRejectDetail;
}>;

export type RemoveSegmentationSuccess = Readonly<{
  ok: true;
  provider: string;
  modelId: string;
  conceptSet: string;
  schema: string;
  maskEncoding: "polygon";
  unverifiedEncodings: readonly ["rle"];
  outputProbThresh: number;
  providerNms: "disabled";
  providerTimeSec: number | null;
  preparation: RemoveObjectPreparation;
}>;

export type RemoveSegmentationResult = RemoveSegmentationSuccess | RemoveSegmentationFailure;

export interface RemoveSegmentationProvider {
  readonly id: string;
  readonly modelId: string;
  segment(
    image: RemoveSegmentationImage,
    concepts: readonly string[],
  ): Promise<RemoveSegmentationResult>;
}

type PolygonRing = readonly (readonly [number, number])[];

type DecodedPolygon = Readonly<{
  concept: string;
  conceptIndex: number;
  confidence: number;
  sourceOrdinal: number;
  mask: RemovePackedMask;
  digest: string;
}>;

export function isRemoveSegmentationVocabulary(concepts: readonly string[]): boolean {
  return concepts.length === REMOVE_SEGMENTATION_CONCEPTS_V1.length
    && concepts.every((concept, index) => concept === REMOVE_SEGMENTATION_CONCEPTS_V1[index]);
}

export function segmentationImageRejection(
  image: RemoveSegmentationImage,
): RemoveSegmentationRejectDetail | null {
  if (
    image.mimeType !== "image/jpeg"
    && image.mimeType !== "image/png"
    && image.mimeType !== "image/webp"
  ) {
    return "image_type";
  }
  if (!/^[0-9a-f]{64}$/.test(image.sha256)) return "image_identity";
  if (image.bytes.byteLength === 0) return "image_empty";
  if (image.bytes.byteLength > REMOVE_SEGMENTATION_MAX_IMAGE_BYTES) return "image_bytes";
  if (!originalGrid(image.width, image.height)) {
    if (
      Number.isInteger(image.width)
      && Number.isInteger(image.height)
      && (image.width > REMOVE_SEGMENTATION_MAX_EDGE || image.height > REMOVE_SEGMENTATION_MAX_EDGE)
    ) {
      return "image_edge";
    }
    return "image_pixels";
  }
  return null;
}

/**
 * Coverage at `sourceWidth` by `sourceHeight` becomes an ORIGINAL identity
 * mask. Equal sizes still pass through the algebra packer, which thresholds
 * them. A different grid uses its nearest-neighbor resample.
 */
export function packSegmentationCoverageAtOriginal(input: Readonly<{
  source: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  originalWidth: number;
  originalHeight: number;
}>): RemovePackedMask | null {
  return packRemoveObjectMaskAtOriginal(input);
}

/**
 * RLE hook. The serverless schema does not specify `counts` layout, axis
 * order, or whether `size` is `[height, width]`. A captured fixture has to
 * land before this function may expand a mask.
 */
export function decodeRoboflowRleMask(masks: unknown): RemoveSegmentationFailure {
  if (!masks || typeof masks !== "object" || Array.isArray(masks)) {
    return { ok: false, error: "response_invalid" };
  }
  return { ok: false, error: "rle_contract_unverified" };
}

export function buildRoboflowConceptSegmentRequest(input: Readonly<{
  image: RemoveSegmentationImage;
  concepts: readonly string[];
  requestId: string;
}>): { ok: true; body: string } | RemoveSegmentationFailure {
  const imageDetail = segmentationImageRejection(input.image);
  if (imageDetail) return { ok: false, error: "request_rejected", detail: imageDetail };
  if (!isRemoveSegmentationVocabulary(input.concepts)) {
    return { ok: false, error: "request_rejected", detail: "concepts" };
  }
  if (input.requestId.trim().length === 0 || input.requestId.length > 80) {
    return { ok: false, error: "request_rejected", detail: "concepts" };
  }
  const body = {
    id: input.requestId,
    model_id: REMOVE_SEGMENTATION_MODEL_ID,
    format: "polygon",
    output_prob_thresh: REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH,
    image: {
      type: "base64",
      value: Buffer.from(input.image.bytes).toString("base64"),
    },
    prompts: input.concepts.map((text) => ({ type: "text", text })),
  };
  return { ok: true, body: JSON.stringify(body) };
}

export function normalizeRoboflowConceptSegment(input: Readonly<{
  payload: unknown;
  concepts: readonly string[];
  originalWidth: number;
  originalHeight: number;
}>): RemoveSegmentationResult {
  if (!originalGrid(input.originalWidth, input.originalHeight)) {
    return { ok: false, error: "mask_dimensions" };
  }
  if (input.concepts.length === 0 || input.concepts.length > REMOVE_SEGMENTATION_MAX_CONCEPTS) {
    return { ok: false, error: "request_rejected", detail: "concepts" };
  }
  const payload = record(input.payload);
  if (!payload) return { ok: false, error: "response_invalid" };
  const providerTimeSec = readTime(payload.time);
  if (providerTimeSec === "invalid") return { ok: false, error: "response_invalid" };
  if (!Array.isArray(payload.prompt_results) || payload.prompt_results.length !== input.concepts.length) {
    return { ok: false, error: "response_invalid" };
  }

  const byIndex = new Map<number, Record<string, unknown>>();
  for (const entry of payload.prompt_results) {
    const prompt = record(entry);
    if (!prompt || !Number.isInteger(prompt.prompt_index)) {
      return { ok: false, error: "response_invalid" };
    }
    const promptIndex = prompt.prompt_index as number;
    if (promptIndex < 0 || promptIndex >= input.concepts.length || byIndex.has(promptIndex)) {
      return { ok: false, error: "response_invalid" };
    }
    byIndex.set(promptIndex, prompt);
  }

  const decoded: DecodedPolygon[] = [];
  let predictionCount = 0;
  let packedBytes = 0;
  const coverage = new Uint8Array(input.originalWidth * input.originalHeight);

  for (let conceptIndex = 0; conceptIndex < input.concepts.length; conceptIndex += 1) {
    const prompt = byIndex.get(conceptIndex);
    const concept = input.concepts[conceptIndex];
    if (!prompt || concept === undefined) return { ok: false, error: "response_invalid" };
    const echo = readEcho(prompt.echo, concept, conceptIndex);
    if (echo === "invalid") return { ok: false, error: "response_invalid" };
    if (!Array.isArray(prompt.predictions)) return { ok: false, error: "response_invalid" };
    predictionCount += prompt.predictions.length;
    if (predictionCount > REMOVE_SEGMENTATION_MAX_PREDICTIONS) {
      return { ok: false, error: "response_unbounded" };
    }
    for (let ordinal = 0; ordinal < prompt.predictions.length; ordinal += 1) {
      const prediction = record(prompt.predictions[ordinal]);
      if (!prediction) return { ok: false, error: "response_invalid" };
      const confidence = readConfidence(prediction.confidence);
      if (confidence === null) return { ok: false, error: "response_invalid" };
      const encoding = polygonEncoding(prediction.format, prediction.masks);
      if (encoding === "invalid") return { ok: false, error: "response_invalid" };
      if (encoding === "rle") return decodeRoboflowRleMask(prediction.masks);
      const rings = readRings(prediction.masks, input.originalWidth, input.originalHeight);
      if (!rings.ok) return rings;
      coverage.fill(0);
      const filled = rasterizeRings(rings.rings, coverage, input.originalWidth, input.originalHeight);
      if (filled === "invalid") return { ok: false, error: "response_invalid" };
      const mask = packSegmentationCoverageAtOriginal({
        source: coverage,
        sourceWidth: input.originalWidth,
        sourceHeight: input.originalHeight,
        originalWidth: input.originalWidth,
        originalHeight: input.originalHeight,
      });
      if (!mask) return { ok: false, error: "response_invalid" };
      packedBytes += mask.bits.byteLength;
      if (packedBytes > REMOVE_SEGMENTATION_MAX_PACKED_BYTES) {
        return { ok: false, error: "response_unbounded" };
      }
      decoded.push({
        concept,
        conceptIndex,
        confidence,
        sourceOrdinal: conceptIndex * REMOVE_SEGMENTATION_MAX_PREDICTIONS + ordinal,
        mask,
        digest: createHash("sha256")
          .update(mask.bits)
          .update(JSON.stringify(confidence))
          .digest("hex")
          .slice(0, 8),
      });
    }
  }

  decoded.sort(compareDecoded);
  const seen = new Map<string, number>();
  const preparation = prepareRemoveObjectMasks({
    candidates: decoded.map((item) => {
      const next = seen.get(item.concept) ?? 0;
      seen.set(item.concept, next + 1);
      const slug = item.concept.replaceAll(" ", "-");
      return {
        id: `v1-${slug}-${next}-${item.digest}`,
        concept: item.concept,
        confidence: item.confidence,
        mask: item.mask,
      };
    }),
  });

  return {
    ok: true,
    provider: REMOVE_SEGMENTATION_PROVIDER_ID,
    modelId: REMOVE_SEGMENTATION_MODEL_ID,
    conceptSet: isRemoveSegmentationVocabulary(input.concepts)
      ? REMOVE_SEGMENTATION_CONCEPT_SET
      : "remove-segmentation-concepts/unversioned",
    schema: ROBOFLOW_SAM3_POLYGON_SCHEMA,
    maskEncoding: "polygon",
    unverifiedEncodings: ["rle"],
    outputProbThresh: REMOVE_SEGMENTATION_OUTPUT_PROB_THRESH,
    providerNms: "disabled",
    providerTimeSec,
    preparation,
  };
}

function compareDecoded(left: DecodedPolygon, right: DecodedPolygon): number {
  if (left.conceptIndex !== right.conceptIndex) return left.conceptIndex - right.conceptIndex;
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  const bounds = left.mask.bounds;
  const other = right.mask.bounds;
  if (bounds.x !== other.x) return bounds.x - other.x;
  if (bounds.y !== other.y) return bounds.y - other.y;
  if (bounds.width !== other.width) return bounds.width - other.width;
  if (bounds.height !== other.height) return bounds.height - other.height;
  if (left.digest !== right.digest) return left.digest < right.digest ? -1 : 1;
  return left.sourceOrdinal - right.sourceOrdinal;
}

function originalGrid(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width >= 1
    && height >= 1
    && width <= REMOVE_SEGMENTATION_MAX_EDGE
    && height <= REMOVE_SEGMENTATION_MAX_EDGE
    && width * height <= REMOVE_SEGMENTATION_MAX_PIXELS;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readTime(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "invalid";
  return value;
}

function readConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

function readEcho(
  value: unknown,
  concept: string,
  conceptIndex: number,
): "ok" | "invalid" {
  if (value === undefined || value === null) return "ok";
  const echo = record(value);
  if (!echo) return "invalid";
  if (echo.prompt_index !== undefined && echo.prompt_index !== conceptIndex) return "invalid";
  if (echo.type !== undefined && echo.type !== null && echo.type !== "text") return "invalid";
  if (typeof echo.text === "string" && echo.text !== concept) return "invalid";
  if (echo.text !== undefined && echo.text !== null && typeof echo.text !== "string") return "invalid";
  if (echo.num_boxes !== undefined && echo.num_boxes !== null && echo.num_boxes !== 0) return "invalid";
  return "ok";
}

function polygonEncoding(format: unknown, masks: unknown): "polygon" | "rle" | "invalid" {
  if (format !== undefined && format !== null && format !== "polygon" && format !== "rle") {
    return "invalid";
  }
  const objectMask = masks !== null && typeof masks === "object" && !Array.isArray(masks);
  if (format === "rle") return objectMask ? "rle" : "invalid";
  if (objectMask) return format === undefined || format === null ? "rle" : "invalid";
  if (!Array.isArray(masks)) return "invalid";
  return "polygon";
}

function readRings(
  masks: unknown,
  width: number,
  height: number,
): { ok: true; rings: PolygonRing[] } | RemoveSegmentationFailure {
  if (!Array.isArray(masks)) return { ok: false, error: "response_invalid" };
  if (masks.length > REMOVE_SEGMENTATION_MAX_RINGS) {
    return { ok: false, error: "response_unbounded" };
  }
  const rings: PolygonRing[] = [];
  let points = 0;
  for (const ring of masks) {
    if (!Array.isArray(ring) || ring.length < 3) return { ok: false, error: "response_invalid" };
    const parsed: Array<[number, number]> = [];
    for (const point of ring) {
      if (!Array.isArray(point) || point.length !== 2) return { ok: false, error: "response_invalid" };
      const x = point[0];
      const y = point[1];
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, error: "response_invalid" };
      }
      if (x < -1 || y < -1 || x > width + 1 || y > height + 1) {
        return { ok: false, error: "mask_dimensions" };
      }
      points += 1;
      if (points > REMOVE_SEGMENTATION_MAX_POLYGON_POINTS) {
        return { ok: false, error: "response_unbounded" };
      }
      parsed.push([x, y]);
    }
    rings.push(parsed);
  }
  return { ok: true, rings };
}

function rasterizeRings(
  rings: readonly PolygonRing[],
  coverage: Uint8Array,
  width: number,
  height: number,
): "ok" | "invalid" {
  const edges: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      if (!start || !end) return "invalid";
      if (start[1] !== end[1]) {
        edges.push({ x0: start[0], y0: start[1], x1: end[0], y1: end[1] });
      }
      if (start[1] < minY) minY = start[1];
      if (start[1] > maxY) maxY = start[1];
    }
  }
  if (edges.length === 0) return "ok";
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(height - 1, Math.floor(maxY));
  const crossings: number[] = [];
  for (let y = yStart; y <= yEnd; y += 1) {
    const scanY = y + 0.5;
    crossings.length = 0;
    for (const edge of edges) {
      const yMin = edge.y0 < edge.y1 ? edge.y0 : edge.y1;
      const yMax = edge.y0 < edge.y1 ? edge.y1 : edge.y0;
      if (scanY < yMin || scanY >= yMax) continue;
      const span = edge.y1 - edge.y0;
      if (span === 0) continue;
      crossings.push(edge.x0 + ((scanY - edge.y0) / span) * (edge.x1 - edge.x0));
    }
    if (crossings.length % 2 !== 0) return "invalid";
    crossings.sort((left, right) => left - right);
    const row = y * width;
    for (let pair = 0; pair < crossings.length; pair += 2) {
      const left = crossings[pair];
      const right = crossings[pair + 1];
      if (left === undefined || right === undefined) return "invalid";
      const from = Math.max(0, Math.ceil(left - 0.5));
      const to = Math.min(width - 1, Math.floor(right - 0.5 - 1e-9));
      for (let x = from; x <= to; x += 1) coverage[row + x] = 255;
    }
  }
  return "ok";
}
