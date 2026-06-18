import type { Vec2 } from "./perspective-solve";
import {
  isValidImageSize,
  sourceNormToContainerNorm,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import {
  mapRawVisionFloorResponseToDetectionResult,
  type MapRawVisionOptions,
} from "./auto-floor-vision-schema";
import type { AutoFloorDetectionResult } from "./auto-floor-detection";

// --- Phase 2F-E: Disabled real vision-model provider scaffold ---------------
// Pure, side-effect-free scaffolding for a FUTURE Gemini vision-model provider.
//
// HARD GUARANTEES FOR THIS PHASE:
// - Nothing here calls Gemini, any network, any API route, or reads API keys.
// - Nothing here fetches an image URL or normalizes image bytes (no `sharp`).
// - Nothing here is wired into the provider registry as `available`.
// - The active provider remains "mock-local"; this file is not imported by the
//   UI and changes no existing behavior.
//
// What it DOES establish (the clean boundary Phase 2F-F will fill in):
// 1. Future model configuration/types.
// 2. The future Gemini structured-output (responseSchema) contract, aligned to
//    Phase 2F-B's RawVisionFloorResponse / RawVisionCandidate.
// 3. A pure server-side prompt builder.
// 4. A pure source-normalized -> container-normalized-v0 quad adapter built on
//    the existing image-space cover-crop helpers.
// 5. A pure result-adapter boundary that converts raw model coordinates into
//    container space and then defers ALL validation/canonicalization/scoring to
//    the existing Phase 2F-B mapper (the source of truth).
//
// COORDINATE-SPACE SAFETY RULE (load-bearing):
// The model sees the ORIGINAL/intrinsic image pixels and therefore returns
// coordinates normalized to that image ("intrinsic-source-normalized-v0").
// The lab overlay / floor polygon / geometry scoring all operate in
// "container-normalized-v0" (after object-cover crop). Raw model coordinates
// MUST be converted source->container BEFORE entering the Phase 2F-B mapper.
// Any future server-side orientation/resolution normalization (Phase 2F-F)
// MUST be reflected in the `sourceSize` passed to the converter; never convert
// using stale/original dimensions after transforming the image.

// ---------------------------------------------------------------------------
// 1. Future model configuration / request types
// ---------------------------------------------------------------------------

export type AutoFloorVisionModelId = "gemini-2.5-flash" | "gemini-3-flash-preview";

export type AutoFloorVisionCoordinateSpace = "intrinsic-source-normalized-v0";

export type AutoFloorVisionModelConfig = {
  // `string` is permitted so a future env-driven model id can flow through the
  // existing gemini model validator without a type change here.
  model: AutoFloorVisionModelId | string;
  maxCandidates: number;
  temperature: number;
  maxOutputTokens: number;
  coordinateSpace: AutoFloorVisionCoordinateSpace;
};

export type AutoFloorVisionPromptInput = {
  frameSize: ImageFrameSize;
  intrinsicSize: ImageIntrinsicSize;
  // Optional, weak, non-authoritative hint. Container-normalized-v0 (as used by
  // the lab today). MUST NOT be echoed back by the model.
  currentFloorPolygon?: Vec2[];
  maxCandidates: number;
};

// Phase 2F-D decision: stable GA baseline + preview comparison model.
export const DEFAULT_AUTO_FLOOR_VISION_MODEL: AutoFloorVisionModelId = "gemini-2.5-flash";
export const COMPARISON_AUTO_FLOOR_VISION_MODEL: AutoFloorVisionModelId = "gemini-3-flash-preview";

// Mirrors existing room-read conventions (low temperature, JSON output) and the
// Phase 2F-B candidate cap (3).
export const DEFAULT_AUTO_FLOOR_VISION_CONFIG: AutoFloorVisionModelConfig = {
  model: DEFAULT_AUTO_FLOOR_VISION_MODEL,
  maxCandidates: 3,
  temperature: 0.1,
  maxOutputTokens: 1024,
  coordinateSpace: "intrinsic-source-normalized-v0",
};

// ---------------------------------------------------------------------------
// 2. Future Gemini structured-output (responseSchema) contract
// ---------------------------------------------------------------------------
// Documentary constant only. Phase 2F-F will pass this as
// generationConfig.responseSchema (Gemini's OpenAPI-subset schema) alongside
// responseMimeType: "application/json". It intentionally describes ONLY the
// untrusted raw contract from Phase 2F-B (RawVisionFloorResponse /
// RawVisionCandidate). It does NOT introduce a new schema framework — it is a
// plain object literal matching the style Gemini already expects.
//
// All fields are advisory/untrusted. Vibode re-derives corner order, confidence,
// and selection locally; the model's claims here never bypass the mapper.

export const AUTO_FLOOR_VISION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      description:
        "Up to maxCandidates proposed rectangular floor-plane calibration quads. May be empty.",
      items: {
        type: "object",
        properties: {
          quad: {
            type: "array",
            description:
              "Exactly 4 points in intrinsic-source-normalized coordinates (x,y in 0..1, x left->right, y top->bottom). Point order is advisory; Vibode re-orders locally.",
            items: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
            },
          },
          label: { type: "string", nullable: true },
          confidence: {
            type: "number",
            nullable: true,
            description: "Advisory only (0..1). Geometry scoring is authoritative.",
          },
          confidenceBand: {
            type: "string",
            nullable: true,
            description: "Advisory only: 'high' | 'medium' | 'low'.",
          },
          notes: { type: "array", items: { type: "string" }, nullable: true },
          risks: { type: "array", items: { type: "string" }, nullable: true },
          occluded: {
            type: "boolean",
            nullable: true,
            description: "True if any corner was inferred through occlusion.",
          },
        },
        required: ["quad"],
      },
    },
    visibleFloorRegionNorm: {
      type: "array",
      nullable: true,
      description: "Advisory only; ignored by the current mapper.",
      items: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
    },
    horizonHint: {
      type: "object",
      nullable: true,
      description: "Advisory only; ignored by the current mapper.",
    },
    modelNotes: { type: "array", items: { type: "string" }, nullable: true },
    failureReasons: { type: "array", items: { type: "string" }, nullable: true },
  },
  required: ["candidates"],
} as const;

export type AutoFloorVisionResponseSchema = typeof AUTO_FLOOR_VISION_RESPONSE_SCHEMA;

// ---------------------------------------------------------------------------
// 3. Pure prompt builder (server-side; never imported by ThreeRoomLab.tsx)
// ---------------------------------------------------------------------------

/**
 * Builds the future floor-plane proposal prompt. Pure string construction; no
 * model call. Coordinates requested in intrinsic-source-normalized-v0 because
 * the model sees the original image; Vibode converts + re-orders locally.
 */
export function buildAutoFloorVisionPrompt(input: AutoFloorVisionPromptInput): string {
  const maxCandidates = Math.max(1, Math.trunc(input.maxCandidates) || 1);

  // The manual polygon is intentionally surfaced only qualitatively (count), not
  // as raw coordinates. It is in container-normalized-v0 while the model works
  // in intrinsic-source space, so embedding raw coordinates here would mix two
  // coordinate spaces AND invite echoing.
  // TODO(Phase 2F-F): if a qualitative hint proves insufficient during prompt
  // tuning, convert the polygon container->source via containerNormToSourceNorm
  // (using frameSize + intrinsicSize) before embedding any coordinates.
  const hintLine =
    input.currentFloorPolygon && input.currentFloorPolygon.length >= 3
      ? `A rough manual floor outline with ${input.currentFloorPolygon.length} points exists as a WEAK hint of where floor is. Treat it only as a loose suggestion. Do NOT copy, trace, or echo it.`
      : "No manual floor hint is provided.";

  return [
    "You analyze a single room photograph to propose floor-plane CALIBRATION QUADS.",
    "",
    `Propose up to ${maxCandidates} clean four-corner rectangular patches that lie flat on the room's floor plane.`,
    "Each quad must represent a plausible RECTANGULAR region of the real floor (as it would be in the real world), seen in perspective.",
    "",
    "STRICT RULES:",
    "- Do NOT trace the irregular visible floor outline.",
    "- Do NOT treat furniture silhouettes, rug outlines, shadows, baseboards, or jagged occlusion edges as calibration boundaries.",
    "- Each candidate must be exactly 4 corner points of one rectangular floor patch.",
    "- Prefer large, clearly-visible, unobstructed rectangular floor areas.",
    "- A corner may be inferred behind occlusion (furniture/rug) ONLY if you disclose this in that candidate's `risks` (e.g. \"corner inferred through occlusion\") and set `occluded` to true.",
    "- If you cannot confidently propose any rectangular floor patch, return an empty `candidates` array. NEVER invent floor geometry.",
    "",
    "COORDINATES:",
    "- Use coordinates normalized to THIS image: x = 0..1 left to right, y = 0..1 top to bottom.",
    "- Point order within a quad is advisory only; it will be re-ordered downstream.",
    "",
    "HINT:",
    `- ${hintLine}`,
    "",
    "OUTPUT:",
    "- Return JSON only, matching the provided response schema. No prose, no markdown fences.",
    "- `label`, `confidence`, `confidenceBand`, and any region/horizon hints are advisory only.",
    "",
    "VALID example behavior: one large rectangular patch of open floor between a sofa and a wall, returned as 4 corner points.",
    "INVALID example behavior: a many-sided outline hugging a rug's fringe, a sofa footprint, or the entire jagged visible-floor boundary.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 4. Image-coordinate adapter: intrinsic-source-normalized -> container-norm
// ---------------------------------------------------------------------------

export type SourceToContainerQuadInput = {
  sourceSize: ImageIntrinsicSize;
  containerSize: ImageFrameSize;
};

/**
 * Converts a 4-corner quad from intrinsic-source-normalized-v0 into
 * container-normalized-v0 using the existing cover-crop helper
 * (sourceNormToContainerNorm). Returns null if dimensions are invalid or any
 * point fails to convert, so callers fail closed.
 *
 * NOTE (clamping): sourceNormToContainerNorm clamps inputs/outputs to [0,1].
 * This means mildly/grossly out-of-frame model coordinates lose their
 * out-of-range magnitude here, which weakens the Phase 2F-B mapper's
 * clamp-vs-reject range logic for converted points.
 * TODO(Phase 2F-F): when the real route is wired and exercised against real
 * images, decide whether to switch to a non-clamping getCoverCrop-based affine
 * so the mapper's GROSS_BOUND_MIN/MAX rejection stays meaningful end to end.
 */
export function sourceNormalizedQuadToContainerNormalizedQuad(
  quad: [Vec2, Vec2, Vec2, Vec2],
  input: SourceToContainerQuadInput
): [Vec2, Vec2, Vec2, Vec2] | null {
  if (!isValidImageSize(input.sourceSize) || !isValidImageSize(input.containerSize)) {
    return null;
  }

  const converted: Vec2[] = [];
  for (const point of quad) {
    const next = sourceNormToContainerNorm(point, input.sourceSize, input.containerSize);
    if (!next) return null;
    converted.push({ x: next.x, y: next.y });
  }

  return [converted[0], converted[1], converted[2], converted[3]];
}

// ---------------------------------------------------------------------------
// 5. Future real-provider result-adapter boundary
// ---------------------------------------------------------------------------
// Handoff this phase makes explicit (NOT invoked against a model yet):
//   raw Gemini JSON (already parsed)
//   -> source-normalized candidate coordinates
//   -> source->container coordinate conversion (section 4)
//   -> mapRawVisionFloorResponseToDetectionResult(...) [Phase 2F-B authority]
//
// The Phase 2F-B mapper remains the SOLE authority for raw candidate
// validation/canonicalization/scoring/selection. This adapter only performs the
// coordinate-space conversion the mapper cannot do for itself, then delegates.

export type AutoFloorVisionResultAdapterInput = {
  sourceSize: ImageIntrinsicSize;
  containerSize: ImageFrameSize;
  floorRect: { widthMeters: number; depthMeters: number };
  maxCandidates?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function convertRawPoint(
  value: unknown,
  input: SourceToContainerQuadInput
): unknown {
  if (!isRecord(value)) return value;
  const { x, y } = value;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return value;
  }
  const next = sourceNormToContainerNorm({ x, y }, input.sourceSize, input.containerSize);
  if (!next) return value;
  return { ...value, x: next.x, y: next.y };
}

function convertRawCandidatePoints(
  candidate: unknown,
  input: SourceToContainerQuadInput
): unknown {
  if (!isRecord(candidate)) return candidate;
  const next: Record<string, unknown> = { ...candidate };

  if (Array.isArray(candidate.quad)) {
    next.quad = candidate.quad.map((point) => convertRawPoint(point, input));
  }

  if (isRecord(candidate.corners)) {
    const corners = candidate.corners;
    const convertedCorners: Record<string, unknown> = { ...corners };
    for (const key of ["nearLeft", "nearRight", "farRight", "farLeft"]) {
      if (key in corners) {
        convertedCorners[key] = convertRawPoint(corners[key], input);
      }
    }
    next.corners = convertedCorners;
  }

  return next;
}

/**
 * Pure adapter: converts already-parsed raw vision JSON from
 * intrinsic-source-normalized-v0 into container-normalized-v0 and delegates to
 * the Phase 2F-B mapper. Never throws; never calls a model or the network.
 *
 * Fails closed (failed result) when source/container dimensions are invalid, so
 * we never feed mismatched coordinates into geometry scoring.
 */
export function mapSourceNormalizedRawVisionResponseToDetectionResult(
  rawParsedJson: unknown,
  input: AutoFloorVisionResultAdapterInput
): AutoFloorDetectionResult {
  if (!isValidImageSize(input.sourceSize) || !isValidImageSize(input.containerSize)) {
    return {
      status: "failed",
      candidates: [],
      selectedCandidateId: null,
      notes: [],
      failureReasons: [
        "Invalid source/container dimensions for source->container coordinate conversion.",
      ],
    };
  }

  const conversion: SourceToContainerQuadInput = {
    sourceSize: input.sourceSize,
    containerSize: input.containerSize,
  };

  // Convert candidate coordinates in place where possible; leave everything else
  // (and any unparseable points) untouched so the Phase 2F-B mapper performs all
  // validation/rejection exactly as it does for the mock-api path.
  let containerSpaceRaw: unknown = rawParsedJson;
  if (isRecord(rawParsedJson) && Array.isArray(rawParsedJson.candidates)) {
    containerSpaceRaw = {
      ...rawParsedJson,
      candidates: rawParsedJson.candidates.map((candidate) =>
        convertRawCandidatePoints(candidate, conversion)
      ),
    };
  }

  const mapperOptions: MapRawVisionOptions = {
    frameSize: input.containerSize,
    floorRect: input.floorRect,
    maxCandidates: input.maxCandidates,
  };

  return mapRawVisionFloorResponseToDetectionResult(containerSpaceRaw, mapperOptions);
}
