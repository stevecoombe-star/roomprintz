import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import type { EmptyRoomObservationFailureDiagnostic } from "./empty-room-observation-contract";
import type { EmptyRoomObservationInput } from "./empty-room-observation.server";
import {
  AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
} from "./empty-room-observation.server";
import {
  buildEmptyFocusedSideCeilingWallEvidence,
  buildFailedFocusedSideCeilingWallEvidence,
  buildFocusedSideCeilingWallEvidence,
  type FocusedSideCeilingWallEvidence,
  type FocusedSideCeilingWallEvidenceContext,
} from "./empty-side-ceiling-wall-observation-contract";

export const AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION =
  "afc-v2-empty-side-ceiling-wall-observer/v2" as const;
export const AFC_V2_EMPTY_SIDE_CEILING_WALL_PROFILE =
  "empty-side-ceiling-wall-conservative/v1" as const;

const TIMEOUT_MS = 60_000;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["observedSeams", "unresolved"],
  properties: {
    observedSeams: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "category",
          "sourceNormalizedPolyline",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: ["wall_ceiling"] },
          sourceNormalizedPolyline: { $ref: "#/$defs/polyline" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
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
    : "Unknown focused side-ceiling-wall observation failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown focused side-ceiling-wall observation failure.";
}

function focusedPrompt(): string {
  return `You are examining an EMPTY room image only for visible side wall-ceiling seams.

Inspect only the supplied EMPTY image pixels. It is not TILED. It contains no camera, Floor authority, FOV, pose, or world-geometry input. Return image-space coordinates normalized to this exact EMPTY image: x=0 left, x=1 right, y=0 top, y=1 bottom.

Find only the visible architectural boundaries where a side wall meets the ceiling. These often appear as perspective-receding diagonal lines from the near or front image region toward a back wall-ceiling junction. They are not required to be horizontal, vertical, or axis-aligned. They may be shallow or high-angle diagonals, partly contrast-defined, or near x=0 or x=1.

Do not report:
- the back wall-ceiling seam, except as a visible endpoint context you do not emit
- wall-wall corners
- floor-wall seams
- plane polygon extents
- interior tonal bands
- moulding shadows
- lighting gradients
- openings, floor regions, wall planes, ceiling planes, camera, or world geometry

Do not force both sides. If only one side is clearly visible, return one. If only part of a side seam is visible, return only the supported segment. If uncertain, omit.

Ignore strong interior edges created by pelmets, curtain boxes, bulkheads, valances, shelves, soffit faces, or similar protruding elements below the ceiling. The wall-ceiling seam is the room-envelope boundary where the actual wall meets the ceiling. Do not substitute the lower edge of an attached overhead element for the wall-ceiling junction. If an attached element sits below the ceiling, keep the junction at the actual ceiling/wall envelope; do not move it down to the element's lower edge. If the true wall-ceiling boundary is occluded by such an element, omit or return only the visibly supported portion. Do not invent a hidden continuation behind it. If a soffit or bulkhead genuinely is the visible room ceiling boundary, report that envelope; do not reject it merely for looking like a protruding structure.

Never infer hidden continuation. Never extend through glare, occlusion, clipping, or weak tonal transition. Never substitute a vertical wall-wall line for a side wall-ceiling seam. Never manufacture a seam because a room probably has one.

Confidence is certainty that the reported polyline follows the actual visible architectural side wall-ceiling boundary. Prefer omission over a fabricated seam. Set visibility to "observed" exactly. IDs must begin with a letter and contain only letters, digits, underscores, or hyphens. Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new FocusedObservationError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Focused side-ceiling-wall observer returned no response envelope.",
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
      detail: "Focused side-ceiling-wall observer returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new FocusedObservationError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      detail: "Focused side-ceiling-wall observer candidate text was not valid JSON.",
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
          ? "Focused side-ceiling-wall observer request timed out."
          : `Focused side-ceiling-wall observer transport failed: ${safeDetail(error)}`,
      });
    }
    if (!response.ok) {
      throw new FocusedObservationError({
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: `Focused side-ceiling-wall observer failed with HTTP ${response.status}.`,
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
        detail: "Focused side-ceiling-wall observer returned an invalid JSON response envelope.",
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
): FocusedSideCeilingWallEvidenceContext {
  return {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: input.retainedEmpty.identity,
    originalAncestorSha256: input.originalAncestorIdentity.sha256,
    provider: args.provider,
    model: args.model,
    observerProfile: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROFILE,
    promptVersion: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
    generatedAt: args.generatedAt,
  };
}

export async function observeFocusedSideCeilingWallSeams(
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
): Promise<FocusedSideCeilingWallEvidence> {
  const model = dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const context = contextFromInput(input, { provider, model, generatedAt });
  const fail = (diagnostic: EmptyRoomObservationFailureDiagnostic) =>
    buildFailedFocusedSideCeilingWallEvidence(context, diagnostic);

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
        "Focused side-ceiling-wall observation provider credentials are unavailable.",
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
          workflowType: "afc-v2-empty-side-ceiling-wall-observation",
          actionType: "observe-retained-empty-side-ceiling-wall",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: 1,
          metadata: {
            promptVersion: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
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
        detail: "Focused side-ceiling-wall observer result failed the top-level contract.",
        contractValidationReason: "provider_result_not_object",
      });
    }
    const root = raw as Record<string, unknown>;
    if (!Array.isArray(root.observedSeams) || !Array.isArray(root.unresolved)) {
      throw new FocusedObservationError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "Focused side-ceiling-wall observer result failed the top-level contract.",
        contractValidationReason: !Array.isArray(root.observedSeams)
          ? "provider_result_observedSeams_not_array"
          : "provider_result_unresolved_not_array",
      });
    }
    return buildFocusedSideCeilingWallEvidence(raw, context);
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-empty-side-ceiling-wall-observation] failed", diagnostic);
    return fail(diagnostic);
  }
}

export function emptyFocusedSideCeilingWallSibling(
  input: EmptyRoomObservationInput,
): FocusedSideCeilingWallEvidence {
  return buildEmptyFocusedSideCeilingWallEvidence(
    contextFromInput(input, {
      provider: "controlled_fixture",
      model: "fixture",
      generatedAt: new Date().toISOString(),
    }),
  );
}
