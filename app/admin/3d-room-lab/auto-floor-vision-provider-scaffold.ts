import type { Vec2 } from "./perspective-solve";
import {
  isValidImageSize,
  sourceNormToContainerNormUnclamped,
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

export type AutoFloorVisionModelId =
  | "gemini-3.5-flash"
  | "gemini-2.5-flash"
  | "gemini-3-flash-preview";

export type AutoFloorVisionCoordinateSpace = "intrinsic-source-normalized-v0";

export type AutoFloorVisionModelConfig = {
  // `string` is permitted so a future env-driven model id can flow through the
  // existing gemini model validator without a type change here.
  model: AutoFloorVisionModelId | string;
  maxCandidates: number;
  temperature: number;
  maxOutputTokens: number;
  // Gemini 3.5-only tuning for structured JSON completion. Omit for other
  // models unless explicitly needed.
  thinkingLevel?: "minimal";
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

// Phase 2F-F3: baseline moved to gemini-3.5-flash. gemini-2.5-flash remains a
// valid server-only AUTO_FLOOR_VISION_MODEL override; gemini-3-flash-preview is
// kept as an optional future comparison model.
export const DEFAULT_AUTO_FLOOR_VISION_MODEL: AutoFloorVisionModelId = "gemini-3.5-flash";
export const COMPARISON_AUTO_FLOOR_VISION_MODEL: AutoFloorVisionModelId = "gemini-3-flash-preview";

// Auto-floor expects short structured JSON, and Vibode geometry scoring (not
// long model reasoning) is the authority. For gemini-3.5-flash we therefore
// prefer minimal thinking and a larger output budget so JSON can complete.
export const DEFAULT_AUTO_FLOOR_VISION_CONFIG: AutoFloorVisionModelConfig = {
  model: DEFAULT_AUTO_FLOOR_VISION_MODEL,
  maxCandidates: 3,
  temperature: 0.1,
  maxOutputTokens: 4096,
  thinkingLevel: "minimal",
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
          intent: {
            type: "string",
            nullable: true,
            description:
              "Advisory only: candidate extent intent — 'maximal_main_floor' | 'conservative_visible_patch' | 'alternate_opening'. Diagnostic metadata; never used for selection/scoring.",
          },
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
      properties: {
        yNorm: { type: "number", nullable: true },
      },
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
    "You analyze a single room photograph to propose floor-plane CALIBRATION QUADS for the MAIN ROOM the camera is standing in.",
    "",
    "PRIMARY GOAL:",
    "- Return the LARGEST RELIABLE, CONVEX, four-corner CALIBRATION REGION that lies fully WITHIN the floor plane of the MAIN room the camera is in, seen in perspective.",
    "- This quad is a CALIBRATION SURFACE, not a room-outline polygon. It does NOT need to reach every visible wall-floor edge, and it should NOT trace the room's full visual footprint.",
    "- When the full visible footprint has doorway notches, cropped boundaries, openings, or other concavities and CANNOT be represented safely as one convex quad, choose the LARGEST RELIABLE CONTAINED CONVEX region of that same floor instead — do NOT force the irregular perimeter into four corners.",
    "- Each quad is exactly 4 corner points of one planar floor surface (not a hugged outline).",
    "",
    `CANDIDATES (propose up to ${maxCandidates}, with DISTINCT intents — set each candidate's \`intent\`):`,
    "- `maximal_main_floor`: the largest reliable contained CONVEX calibration region on the main-room floor plane (PREFERRED primary candidate).",
    "- `conservative_visible_patch`: a deliberately smaller, safe in-room calibration region (safe fallback).",
    "- `alternate_opening`: an alternate CONTAINED main-room interpretation near an ambiguous doorway, threshold, crop, or opening. It must NEVER intentionally include an adjacent room or trace an invalid shell.",
    "- Prefer returning DISTINCT alternatives over collapsing to a single conservative sub-floor when openings make the extent ambiguous.",
    "",
    "FLOOR EXTENT — MAIN-ROOM SHELL AND OPENINGS:",
    "- The target is the LARGEST RELIABLE CONVEX four-corner region contained on the floor plane of the room CONTAINING THE CAMERA — broad and well-distributed for stable calibration, but it need not reach the full wall-floor perimeter.",
    "- Interior frames are NOT automatic floor boundaries: door jambs, closet frames, cased openings, pass-through trim, and interior vertical trim lines may interrupt the visible WALL line without ending the main-room floor.",
    "- Extend the region BESIDE, AROUND, or PAST such frames WHEN the SAME main-room floor continues visibly and coplanarly beside them. A closet frame bordering the same floor must NOT prematurely truncate the region.",
    "- Distinguish: a TRUE main-room wall-floor boundary (the floor meets a continuous vertical WALL surface); an OPENING FRAME may interrupt the visible wall line without truncating the same main-room floor; a DOORWAY APERTURE separates the camera's room from an ADJACENT room.",
    "",
    "STOP AT DOORWAY APERTURES (DO NOT OVER-EXTEND):",
    "- A doorway aperture / threshold into another room is a BOUNDARY of the main-room floor.",
    "- NEVER extend the quad THROUGH a doorway aperture, and NEVER include floor visible BEYOND that aperture in an adjacent room.",
    "- This holds EVEN IF the adjacent room's floor appears coplanar or shares the same material — adjacent-room floor is not part of the camera's room.",
    "- Do NOT extend through a true wall. Material, height, and threshold changes are CONFIRMING stop cues, not the sole test — stop at the aperture/threshold even without a material change.",
    "- When the opening/threshold is ambiguous, prefer stopping at the genuine main-room wall-floor / threshold limit and express the uncertainty using an `alternate_opening` candidate rather than guessing.",
    "",
    "STRICT RULES:",
    "- Each candidate must be a SINGLE valid CONVEX four-corner region lying on ONE planar floor surface, contained within the camera room's floor plane. No concave, self-intersecting, or irregular shapes.",
    "- Do NOT trace the irregular visible floor outline, and do NOT force a doorway notch, cropped boundary, concavity, or irregular room perimeter into four corners.",
    "- Do NOT treat furniture silhouettes, rug outlines, shadows, baseboards, or jagged occlusion edges as calibration boundaries.",
    "- ANTI-SHRINK: make the contained convex region as LARGE as safely possible and span a BROAD, well-distributed portion of the main-room floor. Do NOT return a tiny, narrow, or overly conservative rectangle when a clearly larger valid convex in-room region is visibly available — prefer broad, well-conditioned coverage over a small unobstructed patch.",
    "- A corner may be inferred behind occlusion (furniture/rug) ONLY if you disclose this in that candidate's `risks` (e.g. \"corner inferred through occlusion\") and set `occluded` to true.",
    "- If you cannot confidently propose any valid convex contained floor region, return an empty `candidates` array. NEVER invent floor geometry.",
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
    "- `intent`, `label`, `confidence`, `confidenceBand`, and any region/horizon hints are advisory only.",
    "",
    "VALID example behavior: in a room whose full visible footprint is NOT a simple quadrilateral (doorway notch, cropped edge, closet frames), choose ONE broad, convex floor quad CONTAINED inside the main-room hardwood — extending PAST/AROUND the closet/opening frames where the same floor continues, STOPPING at the doorway threshold so the adjacent room is EXCLUDED, without tracing the notch or inferring aggressive off-image corners — returned as 4 corner points tagged `maximal_main_floor`.",
    "INVALID example behavior: forcing an irregular/concave room shell into four points; extending THROUGH a doorway aperture into an adjacent room (even if it looks coplanar or same-material); stopping at a doorway jamb or closet frame when the same main-room floor plainly continues beside it; selecting a tiny easy rectangle when a much larger valid convex in-room region is visible; or tracing a rug/furniture/shadow outline.",
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
 * container-normalized-v0 using the NON-CLAMPING cover-crop helper
 * (sourceNormToContainerNormUnclamped). Returns null if dimensions are invalid
 * or any point fails to convert, so callers fail closed.
 *
 * Non-clamping is required (Phase 2F-F): out-of-frame magnitude must be
 * preserved so the Phase 2F-B mapper can distinguish mildly out-of-frame
 * corners (clamp + risk) from grossly invalid ones (reject) using its own
 * GROSS_BOUND_MIN/MAX policy. Converting through a clamping helper would hide
 * that signal.
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
    const next = sourceNormToContainerNormUnclamped(point, input.sourceSize, input.containerSize);
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
  // Non-clamping conversion preserves out-of-frame magnitude so the Phase 2F-B
  // mapper can apply its own clamp-vs-reject policy on the converted point.
  const next = sourceNormToContainerNormUnclamped({ x, y }, input.sourceSize, input.containerSize);
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
