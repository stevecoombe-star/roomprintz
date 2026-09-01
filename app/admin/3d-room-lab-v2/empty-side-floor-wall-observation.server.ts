import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import type { EmptyRoomObservationFailureDiagnostic } from "./empty-room-observation-contract";
import type { EmptyRoomObservationInput } from "./empty-room-observation.server";
import {
  AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
} from "./empty-room-observation.server";
import {
  buildEmptyFocusedSideFloorWallEvidence,
  buildFailedFocusedSideFloorWallEvidence,
  buildFocusedSideFloorWallEvidence,
  type FocusedSideFloorWallEvidence,
  type FocusedSideFloorWallEvidenceContext,
} from "./empty-side-floor-wall-observation-contract";

export const AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION =
  "afc-v2-empty-side-floor-wall-observer/v2" as const;
export const AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROFILE =
  "empty-side-floor-wall-conservative/v1" as const;

const TIMEOUT_MS = 60_000;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["observedSides", "unresolved"],
  properties: {
    observedSides: {
      type: "array",
      items: {
        type: "object",
        required: ["side", "wallPlaneVisible", "confidence", "visibility"],
        properties: {
          side: { type: "string", enum: ["left", "right"] },
          wallPlaneVisible: { type: "boolean" },
          sourceNormalizedWallPolygon: { $ref: "#/$defs/polygon" },
          sourceNormalizedFloorWallPolyline: { $ref: "#/$defs/polyline" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
          frameTruncated: { type: "boolean" },
          noEvidenceReason: { type: ["string", "null"] },
        },
      },
    },
    unresolved: {
      type: "array",
      items: { type: "string" },
    },
  },
  $defs: {
    point: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    polyline: {
      type: "array",
      minItems: 2,
      items: { $ref: "#/$defs/point" },
    },
    polygon: {
      type: "array",
      minItems: 3,
      items: { $ref: "#/$defs/point" },
    },
  },
} as const;

class FocusedObservationError extends Error {
  readonly failureClass: EmptyRoomObservationFailureDiagnostic["failureClass"];
  readonly failureStage: EmptyRoomObservationFailureDiagnostic["failureStage"];
  readonly providerStatus: number | null;
  readonly contractValidationReason: string | null;

  constructor(args: {
    failureClass: EmptyRoomObservationFailureDiagnostic["failureClass"];
    failureStage: EmptyRoomObservationFailureDiagnostic["failureStage"];
    detail: string;
    providerStatus?: number | null;
    contractValidationReason?: string | null;
  }) {
    super(args.detail);
    this.name = "FocusedObservationError";
    this.failureClass = args.failureClass;
    this.failureStage = args.failureStage;
    this.providerStatus = args.providerStatus ?? null;
    this.contractValidationReason = args.contractValidationReason ?? null;
  }
}

function safeDetail(value: unknown): string {
  const text = typeof value === "string"
    ? value
    : value instanceof Error
    ? value.message
    : "Unknown focused side-floor-wall observation failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown focused side-floor-wall observation failure.";
}

function focusedPrompt(): string {
  return `You are examining an EMPTY room image only for visible left and right architectural side walls and their floor-wall contacts.

Inspect only the supplied EMPTY image pixels. It is not TILED. It contains no camera, Floor authority, FOV, pose, ORIGINAL, or world-geometry input. Observation-only. Return image-space coordinates normalized to this exact EMPTY image: x=0 left, x=1 right, y=0 top, y=1 bottom.

Inspect the left side and the right side independently.

A side wall plane is the visible architectural lateral wall bounding the room. If the wall visibly continues toward the foreground / lower frame, include that visible continuation. A small or narrow wedge is valid ONLY when that is genuinely all that is visible. Do not reduce a larger visible side wall to a compact back-corner patch. Do not invent hidden geometry. Do not complete occluded or unseen wall regions. Do not infer beyond visible evidence. Do not infer a wall merely because a room "should" have one.

floor_wall is the visible physical contact where the visible floor region meets the side wall plane. It is not the bottom edge of an arbitrarily chosen wall polygon, not the shortest wall-patch edge, not a wall extent line, not a frame-clipping edge, not a wall-wall seam, and not a line to the nearest image frame. Trace that architectural floor-wall contact independently.

The wall polygon and floor-wall seam are related but independently observed. Do not automatically use the wall polygon's lower edge as the floor-wall seam. The floor-wall polyline must coincide with the visible floor boundary where it touches that side wall.

At a visible side/back/floor room corner, three structural directions exist:
- upward = wall-wall; do not report as floor_wall
- toward image-right or image-left across the rear = back floor-wall; do not report as this side's floor_wall
- toward the foreground / lower frame along the visible floor boundary = the side floor-wall seam
The side floor-wall seam is the edge leaving the corner toward the foreground along the visible floor boundary. Do not choose wall-wall, the rear floor-wall, an arbitrary patch-bottom, or an arbitrary nearest-frame cut.

A seam may terminate at the image frame ONLY when the actual visible floor-wall contact itself reaches that frame. Do not choose a frame endpoint merely because the wall patch touches the frame. The endpoint must be the last visible point of the true architectural contact. In a perspective side wall, that may be near the lower image frame rather than the nearest left or right image frame. Hidden continuation beyond the frame is forbidden. If the true contact cannot be identified, omit that side.

Before reporting a side floor-wall seam, verify visually that floor is on one side, that side wall is on the other, and the polyline follows their visible shared contact. If only one endpoint touches the floor-wall junction but the rest of the line departs from the visible floor boundary, do not report that line as a floor-wall seam.

Do not omit a visible side wall merely because the floor polygon already traces that same boundary. The floor polygon is not a substitute for an explicit floor-wall seam and a visible side wall plane.

Do not report:
- the back wall
- ceiling planes
- wall-ceiling seams
- wall-wall corners as floor-wall seams
- windows unless needed only as local negative evidence that you do not emit
- camera, Floor, TILED, ORIGINAL, world geometry, or room topology completion
- baseboards, radiator bottoms, window sills, floorboard diagonals, or other interior edges as floor-wall seams

Do not force both sides. If only one side is clearly visible, return one. If evidence is weak, contradictory, occluded, or merely topological, omit that side. Prefer omission over a fabricated wall or seam. Never snap, extend, or infer a hidden continuation. Never compute an off-frame intercept.

Confidence is certainty that the reported wall polygon and floor-wall polyline follow the actual visible architectural side wall and its floor junction. Set visibility to "observed" exactly. Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new FocusedObservationError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Focused side-floor-wall observer returned no response envelope.",
    });
  }
  const candidates = Array.isArray((payload as Record<string, unknown>).candidates)
    ? (payload as Record<string, unknown>).candidates as unknown[]
    : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts as unknown[] : [];
  const text = parts
    .filter((part) =>
      part !== null &&
      typeof part === "object" &&
      (part as Record<string, unknown>).thought !== true
    )
    .map((part) =>
      typeof (part as Record<string, unknown>).text === "string"
        ? (part as Record<string, unknown>).text as string
        : ""
    )
    .join("")
    .trim();
  if (!text) {
    throw new FocusedObservationError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Focused side-floor-wall observer returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new FocusedObservationError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      detail: "Focused side-floor-wall observer candidate text was not valid JSON.",
    });
  }
}

async function callGeminiJson(args: {
  apiKey: string;
  model: string;
  prompt: string;
  imageBase64: string;
  mimeType: string;
  fetch: typeof fetch;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
    };
    if (/(?:^|\/)gemini-3\.5-flash$/i.test(args.model)) {
      generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
    }
    let response: Response;
    try {
      response = await args.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: args.prompt },
                {
                  inlineData: {
                    mimeType: args.mimeType,
                    data: args.imageBase64,
                  },
                },
              ],
            }],
            generationConfig,
          }),
        },
      );
    } catch (error) {
      const timedOut = controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      throw new FocusedObservationError({
        failureClass: timedOut ? "timeout" : "transport",
        failureStage: "provider_invocation",
        detail: timedOut
          ? "Focused side-floor-wall observer request timed out."
          : `Focused side-floor-wall observer transport failed: ${safeDetail(error)}`,
      });
    }
    if (!response.ok) {
      throw new FocusedObservationError({
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: `Focused side-floor-wall observer failed with HTTP ${response.status}.`,
      });
    }
    try {
      return extractJson(JSON.parse(await response.text()));
    } catch (error) {
      if (error instanceof FocusedObservationError) throw error;
      throw new FocusedObservationError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Focused side-floor-wall observer returned an invalid JSON response envelope.",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function failureDiagnostic(args: {
  error: unknown;
  provider: EmptyRoomObservationFailureDiagnostic["provider"];
  model: string;
}): EmptyRoomObservationFailureDiagnostic {
  const error = args.error;
  return Object.freeze({
    failureClass: error instanceof FocusedObservationError
      ? error.failureClass
      : "unknown",
    failureStage: error instanceof FocusedObservationError
      ? error.failureStage
      : "provider_invocation",
    provider: args.provider,
    model: args.model,
    providerStatus: error instanceof FocusedObservationError
      ? error.providerStatus
      : null,
    safeDetail: safeDetail(error),
    contractValidationReason: error instanceof FocusedObservationError
      ? error.contractValidationReason
      : null,
  });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function contextFromInput(
  input: EmptyRoomObservationInput,
  args: {
    provider: EmptyRoomObservationFailureDiagnostic["provider"];
    model: string;
    generatedAt: string;
  },
): FocusedSideFloorWallEvidenceContext {
  return {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: input.retainedEmpty.identity,
    originalAncestorSha256: input.originalAncestorIdentity.sha256,
    provider: args.provider,
    model: args.model,
    observerProfile: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROFILE,
    promptVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
    generatedAt: args.generatedAt,
  };
}

export async function observeFocusedSideFloorWallObservation(
  input: EmptyRoomObservationInput,
  dependencies: Readonly<{
    model?: string;
    apiKey?: string;
    now?: () => Date;
    callProvider?: (args: {
      prompt: string;
      imageBase64: string;
      mimeType: string;
      responseSchema: unknown;
      model: string;
    }) => Promise<unknown>;
    fetch?: typeof fetch;
  }> = {},
): Promise<FocusedSideFloorWallEvidence> {
  const model = dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const context = contextFromInput(input, { provider, model, generatedAt });
  const fail = (diagnostic: EmptyRoomObservationFailureDiagnostic) =>
    buildFailedFocusedSideFloorWallEvidence(context, diagnostic);

  if (
    hash(input.retainedEmpty.bytes) !== input.retainedEmpty.identity.sha256 ||
    input.retainedEmpty.bytes.byteLength !==
      input.retainedEmpty.identity.byteCount ||
    input.retainedEmpty.identity.orientation !== 1 ||
    input.originalAncestorIdentity.sha256.length !== 64
  ) {
    return fail(Object.freeze({
      failureClass: "basis_validation",
      failureStage: "basis_validation",
      provider,
      model,
      providerStatus: null,
      safeDetail:
        "Retained EMPTY bytes did not match the attempt-bound EMPTY identity.",
      contractValidationReason: "retained_empty_identity_mismatch",
    }));
  }

  const apiKey = dependencies.apiKey ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY;
  if (!dependencies.callProvider && !apiKey) {
    return fail(Object.freeze({
      failureClass: "configuration",
      failureStage: "configuration",
      provider,
      model,
      providerStatus: null,
      safeDetail:
        "Focused side-floor-wall observation provider credentials are unavailable.",
      contractValidationReason: null,
    }));
  }

  const prompt = focusedPrompt();
  const imageBase64 = Buffer.from(input.retainedEmpty.bytes).toString("base64");
  try {
    const raw = dependencies.callProvider
      ? await dependencies.callProvider({
        prompt,
        imageBase64,
        mimeType: input.retainedEmpty.identity.mimeType,
        responseSchema: RESPONSE_SCHEMA,
        model,
      })
      : await withGeminiUsageAccounting(
        {
          attemptId: input.attemptId,
          provider: "google_gemini",
          model,
          workflowType: "afc-v2-empty-side-floor-wall-observation",
          actionType: "observe-retained-empty-side-floor-wall",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: 1,
          metadata: {
            promptVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
            representation: "EMPTY",
            authority: "observation_only",
            cameraAuthorityConsumed: false,
            floorAuthorityConsumed: false,
          },
        },
        () =>
          callGeminiJson({
            apiKey: apiKey!,
            model,
            prompt,
            imageBase64,
            mimeType: input.retainedEmpty.identity.mimeType,
            fetch: dependencies.fetch ?? fetch,
          }),
      );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new FocusedObservationError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "Focused side-floor-wall observer result failed the top-level contract.",
        contractValidationReason: "provider_result_not_object",
      });
    }
    const root = raw as Record<string, unknown>;
    if (!Array.isArray(root.observedSides) || !Array.isArray(root.unresolved)) {
      throw new FocusedObservationError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "Focused side-floor-wall observer result failed the top-level contract.",
        contractValidationReason: !Array.isArray(root.observedSides)
          ? "provider_result_observedSides_not_array"
          : "provider_result_unresolved_not_array",
      });
    }
    return buildFocusedSideFloorWallEvidence(raw, context);
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-empty-side-floor-wall-observation] failed", diagnostic);
    return fail(diagnostic);
  }
}

export function emptyFocusedSideFloorWallSibling(
  input: EmptyRoomObservationInput,
): FocusedSideFloorWallEvidence {
  return buildEmptyFocusedSideFloorWallEvidence(
    contextFromInput(input, {
      provider: "controlled_fixture",
      model: "fixture",
      generatedAt: new Date().toISOString(),
    }),
  );
}
