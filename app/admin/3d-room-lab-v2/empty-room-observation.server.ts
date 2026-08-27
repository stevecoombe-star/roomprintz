import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import {
  buildEmptyRoomObservationEvidence,
  buildFailedEmptyRoomObservationEvidence,
  type EmptyRoomObservationEvidence,
  type EmptyRoomObservationFailureDiagnostic,
  type RoomObservationImageIdentity,
} from "./empty-room-observation-contract";

export const AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION =
  "afc-v2-empty-visible-room-observer/v2" as const;
export const AFC_V2_EMPTY_ROOM_OBSERVATION_PROFILE =
  "empty-visible-architecture-conservative/v1" as const;
export const AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL = "gemini-3.5-flash";

const TIMEOUT_MS = 60_000;

export type EmptyRoomObservationInput = Readonly<{
  attemptId: string;
  loadGeneration: number;
  originalAncestorIdentity: RoomObservationImageIdentity;
  retainedEmpty: Readonly<{
    bytes: Uint8Array;
    identity: RoomObservationImageIdentity;
  }>;
}>;

const RESPONSE_SCHEMA = {
  type: "object",
  required: [
    "observedPlanes",
    "observedSeams",
    "observedOpenings",
    "observedJunctions",
    "unresolved",
  ],
  properties: {
    observedPlanes: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "category",
          "sourceNormalizedPolygon",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: ["floor", "wall", "ceiling", "unknown"],
          },
          sourceNormalizedPolygon: { $ref: "#/$defs/polygon" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
        },
      },
    },
    observedSeams: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "category",
          "planeIds",
          "sourceNormalizedPolyline",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: ["floor_wall", "wall_wall", "wall_ceiling", "unknown"],
          },
          planeIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          sourceNormalizedPolyline: { $ref: "#/$defs/polyline" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
        },
      },
    },
    observedOpenings: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "category",
          "hostPlaneId",
          "sourceNormalizedBoundary",
          "boundaryClosure",
          "boundaryEvidenceCompleteness",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "door",
              "doorway",
              "window",
              "archway",
              "pass_through",
              "other_major_opening",
              "unknown",
            ],
          },
          hostPlaneId: { type: ["string", "null"] },
          sourceNormalizedBoundary: { $ref: "#/$defs/polyline" },
          boundaryClosure: {
            type: "string",
            enum: ["complete_visible_outline", "partial_visible_outline"],
          },
          boundaryEvidenceCompleteness: {
            type: "string",
            enum: ["all_edges_visibly_traced", "partial_edges_only"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
        },
      },
    },
    observedJunctions: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "category",
          "sourceNormalizedPoint",
          "seamIds",
          "openingIds",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "room_corner",
              "seam_junction",
              "opening_boundary_intersection",
              "unknown",
            ],
          },
          sourceNormalizedPoint: { $ref: "#/$defs/point" },
          seamIds: { type: "array", items: { type: "string" } },
          openingIds: { type: "array", items: { type: "string" } },
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
    polygon: {
      type: "array",
      minItems: 3,
      items: { $ref: "#/$defs/point" },
    },
  },
} as const;

class ObservationError extends Error {
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
    this.name = "ObservationError";
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
    : "Unknown EMPTY room-observation failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown EMPTY room-observation failure.";
}

function observerPrompt(): string {
  return `Inspect only the visible architectural evidence in the supplied EMPTY room image.

The image is the appearance-cleared EMPTY representation retained by the live attempt. It is not TILED and it contains no camera or Floor-authority input. Use only pixels that are visibly supported in this image.

Coordinates:
- Return image-space coordinates normalized to this exact EMPTY image.
- x=0 is the left edge, x=1 is the right edge, y=0 is the top edge, and y=1 is the bottom edge.
- Never return world coordinates, metric dimensions, wall heights, world normals, camera pose, camera estimates, or FOV estimates.

Visible planes:
- Report conservative visible regions for floor, wall, and ceiling planes when sufficiently supported.
- A floor region is only the visibly supported floor-plane extent. It is observation evidence, never an authoritative Floor quad.
- Partial visible regions are valid. Omit a weak region instead of completing it.

Visible seams:
- Report only actually visible floor-wall, wall-wall, and wall-ceiling boundaries.
- Preserve open endpoints. Stop at occlusion, openings, weak evidence, cropping, or the image edge.
- Never extend a seam to an image boundary merely to complete it.
- Never connect across an occlusion or close a gap.
- Trace each wall-ceiling seam independently along the visible physical junction between that specific wall and the ceiling. Do not derive a wall-ceiling seam merely from the broad extent or polygon boundary of either plane.
- Preserve the visible slope and image perspective of wall-ceiling seams. If a junction is weak, partly occluded, or uncertain, return only the confidently visible segment. Do not extend it to an image edge unless the physical junction remains visibly traceable there.
- Preserve visible floor-wall boundaries without broadening, smoothing, or completing them.
- Preserve the conservative wall-wall rule: trace a room corner only where the physical junction is visible. A plane polygon reaching an image edge does not establish another wall or a wall-wall seam.

Visible openings:
- Report visible doors, doorways, windows, archways, pass-throughs, and other obvious major structural openings.
- Trace every reported opening edge where it actually appears in this image. Openings on oblique walls must follow that wall's visible image perspective.
- A physically rectangular opening commonly appears as a trapezoid or general quadrilateral in perspective. Preserve that projected shape.
- Do not force horizontal top/bottom edges, vertical left/right edges, axis alignment, rectangularity, symmetry, parallelism, or equal edge lengths unless those properties are visibly present in image coordinates.
- Do not infer a missing edge from expected construction or symmetry.
- Use complete_visible_outline with boundaryEvidenceCompleteness=all_edges_visibly_traced only when every boundary edge is geometrically located from visible evidence.
- If only some edges are confidently visible, return the ordered open polyline for those edges with partial_visible_outline and boundaryEvidenceCompleteness=partial_edges_only. Do not add a closing segment or missing corner.
- Do not infer hidden depth or convert an opening into a portal.

Visible corners and junctions:
- Report visible room corners, seam junctions, and useful opening-boundary intersections.
- Bind junctions to reported seams/openings where applicable.

Strict prohibitions:
- Do not infer hidden walls or unseen room boundaries.
- Do not close visible openings.
- Do not extrapolate unseen or occluded boundaries.
- Do not assume symmetry or regularize unusual room geometry.
- Do not use furniture, decor, shadows, rugs, or object edges as structural seams.
- Do not invent a floor-wall seam behind an occluder.
- Do not estimate or consume camera authority, Floor authority, FOV, frozen pose, or calibration.
- Do not use or request TILED or FULLY_TILED evidence.
- Do not manufacture world geometry or a closed room envelope.

Confidence:
- Confidence measures certainty in the reported coordinates and traced geometry, not certainty that the object is a window, door, wall, or ceiling.
- Recognizing a window does not justify high confidence in all of its boundary edges.
- Lower confidence, return partial evidence, or omit the primitive when edge placement is obscured by trim or shadow, perspective is ambiguous, the opening approaches image truncation, or any side would come only from expected rectangular construction.
- Keep ambiguity and boundary completeness consistent: uncertainty or missing edges cannot be reported as an unambiguous complete outline.

Set visibility to "observed" exactly. Put uncertainty in ambiguity and unresolved. IDs must begin with a letter and contain only letters, digits, underscores, or hyphens. Prefer omission or explicit uncertainty over a fabricated complete result. Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new ObservationError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "EMPTY room observer returned no response envelope.",
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
    throw new ObservationError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "EMPTY room observer returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ObservationError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      detail: "EMPTY room observer candidate text was not valid JSON.",
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
      maxOutputTokens: 8192,
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
      throw new ObservationError({
        failureClass: timedOut ? "timeout" : "transport",
        failureStage: "provider_invocation",
        detail: timedOut
          ? "EMPTY room observer request timed out."
          : `EMPTY room observer transport failed: ${safeDetail(error)}`,
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let providerDetail = "";
      try {
        const parsed = JSON.parse(body) as {
          error?: { status?: unknown; message?: unknown };
        };
        providerDetail = [parsed.error?.status, parsed.error?.message]
          .filter((value): value is string => typeof value === "string")
          .join(": ");
      } catch {
        providerDetail = "";
      }
      throw new ObservationError({
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: providerDetail
          ? `EMPTY room observer HTTP ${response.status}: ${safeDetail(providerDetail)}`
          : `EMPTY room observer failed with HTTP ${response.status}.`,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ObservationError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "EMPTY room observer returned a non-JSON response content type.",
      });
    }
    try {
      return extractJson(JSON.parse(await response.text()));
    } catch (error) {
      if (error instanceof ObservationError) throw error;
      throw new ObservationError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "EMPTY room observer returned an invalid JSON response envelope.",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function validateTopLevel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "provider_result_not_object";
  }
  const root = value as Record<string, unknown>;
  const required = [
    "observedPlanes",
    "observedSeams",
    "observedOpenings",
    "observedJunctions",
    "unresolved",
  ] as const;
  const invalid = required.find((key) => !Array.isArray(root[key]));
  return invalid ? `provider_result_${invalid}_not_array` : null;
}

function failureDiagnostic(args: {
  error: unknown;
  provider: EmptyRoomObservationFailureDiagnostic["provider"];
  model: string;
}): EmptyRoomObservationFailureDiagnostic {
  const error = args.error;
  return Object.freeze({
    failureClass: error instanceof ObservationError
      ? error.failureClass
      : "unknown",
    failureStage: error instanceof ObservationError
      ? error.failureStage
      : "provider_invocation",
    provider: args.provider,
    model: args.model,
    providerStatus: error instanceof ObservationError
      ? error.providerStatus
      : null,
    safeDetail: safeDetail(error),
    contractValidationReason: error instanceof ObservationError
      ? error.contractValidationReason
      : null,
  });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function observeRetainedEmptyRoom(
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
): Promise<EmptyRoomObservationEvidence> {
  const model = dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  const now = dependencies.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const context = {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: input.retainedEmpty.identity,
    originalAncestorSha256: input.originalAncestorIdentity.sha256,
    provider,
    model,
    observerProfile: AFC_V2_EMPTY_ROOM_OBSERVATION_PROFILE,
    promptVersion: AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
    generatedAt,
  } as const;
  const fail = (diagnostic: EmptyRoomObservationFailureDiagnostic) =>
    buildFailedEmptyRoomObservationEvidence(context, diagnostic);

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
      safeDetail: "EMPTY room observation provider credentials are unavailable.",
      contractValidationReason: null,
    }));
  }

  const prompt = observerPrompt();
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
          workflowType: "afc-v2-empty-room-observation",
          actionType: "observe-retained-empty-visible-architecture",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: 1,
          metadata: {
            promptVersion: AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
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
    const validationReason = validateTopLevel(raw);
    if (validationReason) {
      throw new ObservationError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "EMPTY room observer result failed the top-level contract.",
        contractValidationReason: validationReason,
      });
    }
    return buildEmptyRoomObservationEvidence(raw, context);
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-empty-room-observation] failed", diagnostic);
    return fail(diagnostic);
  }
}
