import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import type { FullyTiledGeneration } from "./fully-tiled-generation.server";
import {
  buildRoomObservationContract,
  type RoomObservationContract,
} from "./room-observation-contract";

export const AFC_V2_ROOM_OBSERVATION_PROMPT_VERSION =
  "afc-v2-visible-room-envelope-observer/v1" as const;
export const AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL = "gemini-3.5-flash";
const ROOM_OBSERVATION_TIMEOUT_MS = 60_000;

const RESPONSE_SCHEMA = {
  type: "object",
  required: [
    "observedPlanes",
    "observedGridFamilies",
    "observedSeams",
    "observedOpenings",
    "adjacency",
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
          "imagePolygon",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: ["floor", "wall", "ceiling", "unknown"],
          },
          imagePolygon: { $ref: "#/$defs/polygon" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
        },
      },
    },
    observedGridFamilies: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "planeId",
          "axis",
          "lineSegments",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          planeId: { type: "string" },
          axis: {
            type: "string",
            enum: ["axis_a", "axis_b", "unresolved"],
          },
          lineSegments: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["start", "end"],
              properties: {
                start: { $ref: "#/$defs/point" },
                end: { $ref: "#/$defs/point" },
              },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
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
          "imagePolyline",
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
          imagePolyline: { $ref: "#/$defs/polyline" },
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
          "imageBoundary",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "window",
              "door",
              "passage",
              "unknown_discontinuity",
            ],
          },
          hostPlaneId: { type: ["string", "null"] },
          imageBoundary: { $ref: "#/$defs/polygon" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["observed"] },
          ambiguity: { type: ["string", "null"] },
        },
      },
    },
    adjacency: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "planeAId",
          "planeBId",
          "seamId",
          "confidence",
        ],
        properties: {
          id: { type: "string" },
          planeAId: { type: "string" },
          planeBId: { type: "string" },
          seamId: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
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

type ObservationInput = Readonly<{
  attemptId: string;
  floorResultId: string;
  generation: FullyTiledGeneration;
  floor: Readonly<{
    authorityKey: string;
    sourceNormalizedPolygon: readonly { x: number; y: number }[];
    observationSource: "FULLY_TILED";
  }>;
  camera: Readonly<{
    verticalFovDeg: number;
    pose: Readonly<{
      position: Readonly<{ x: number; y: number; z: number }>;
      lookAt: Readonly<{ x: number; y: number; z: number }>;
      up: Readonly<{ x: number; y: number; z: number }>;
    }>;
    frame: Readonly<{ width: number; height: number }>;
    originalBasisRestored: true;
  }>;
}>;

export type RoomObservationResult =
  | Readonly<{ status: "observed"; contract: RoomObservationContract }>
  | Readonly<{
      status: "failed";
      reason: string;
      diagnostic: RoomObservationFailureDiagnostic;
    }>;

export type RoomObservationFailureDiagnostic = Readonly<{
  failureClass:
    | "configuration"
    | "transport"
    | "provider_http"
    | "provider_response"
    | "json_parse"
    | "contract_validation"
    | "timeout"
    | "unknown";
  failureStage:
    | "configuration"
    | "provider_invocation"
    | "provider_response"
    | "response_extraction"
    | "json_parse"
    | "contract_validation";
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  providerStatus: number | null;
  safeDetail: string;
  contractValidationReason: string | null;
}>;

class RoomObservationPipelineError extends Error {
  readonly code: string;
  readonly failureClass: RoomObservationFailureDiagnostic["failureClass"];
  readonly failureStage: RoomObservationFailureDiagnostic["failureStage"];
  readonly providerStatus: number | null;
  readonly contractValidationReason: string | null;

  constructor(args: {
    failureClass: RoomObservationFailureDiagnostic["failureClass"];
    failureStage: RoomObservationFailureDiagnostic["failureStage"];
    safeDetail: string;
    providerStatus?: number | null;
    contractValidationReason?: string | null;
  }) {
    super(args.safeDetail);
    this.name = "RoomObservationPipelineError";
    this.code = `${args.failureStage}:${args.failureClass}`;
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
    : "Unknown room-observation failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown room-observation failure.";
}

function failureDiagnostic(args: {
  error: unknown;
  provider: RoomObservationFailureDiagnostic["provider"];
  model: string;
}): RoomObservationFailureDiagnostic {
  const error = args.error;
  if (error instanceof RoomObservationPipelineError) {
    return Object.freeze({
      failureClass: error.failureClass,
      failureStage: error.failureStage,
      provider: args.provider,
      model: args.model,
      providerStatus: error.providerStatus,
      safeDetail: safeDetail(error.message),
      contractValidationReason: error.contractValidationReason,
    });
  }
  return Object.freeze({
    failureClass: "unknown",
    failureStage: "provider_invocation",
    provider: args.provider,
    model: args.model,
    providerStatus: null,
    safeDetail: safeDetail(error),
    contractValidationReason: null,
  });
}

function prompt(input: ObservationInput): string {
  return `Observe only the visible room-envelope evidence in this FULLY_TILED analytical room image.

The certified floor/camera pipeline is already authoritative. Consume this reference; do not estimate, modify, refine, or replace the camera:
${JSON.stringify({
    floorObservationSource: input.floor.observationSource,
    floorAuthorityKey: input.floor.authorityKey,
    calibratedFloorPolygonSourceNormalized:
      input.floor.sourceNormalizedPolygon,
    cameraRealizationBasis: "ORIGINAL",
    verticalFovDeg: input.camera.verticalFovDeg,
    frame: input.camera.frame,
  })}

Coordinates must be normalized to the supplied image: x=0 left, x=1 right, y=0 top, y=1 bottom.

Evidence rules:
- Report visible evidence only. Never invent hidden planes, hidden seams, occluded continuations, or a whole-room reconstruction.
- Do not output world coordinates, dimensions, camera parameters, support geometry, collision geometry, or final Room-Boundary geometry.
- A plane is a visible contiguous tiled field. Use floor, wall, ceiling, or unknown when category is ambiguous.
- For each plane, trace a conservative image polygon inside its actually visible field.
- A grid family is a set of sampled visible grout-line segments on one plane. Use at most two principal families per plane. Sample actual lines; do not synthesize extensions.
- A seam is an actually visible floor-wall, wall-wall, wall-ceiling, or unknown architectural meeting boundary. Reference only planes you reported.
- An opening is a visible window, door, passage, or unknown discontinuity where the tiled field stops. Trace the observed boundary only.
- Adjacency is allowed only when two reported planes visibly meet along one reported seam.
- Set visibility to "observed" exactly. Put uncertainty in ambiguity and unresolved. Prefer unknown or omission over a false claim.
- IDs must begin with a letter and contain only letters, digits, underscore, or hyphen.

Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new RoomObservationPipelineError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      safeDetail: "Room observer returned no response envelope.",
    });
  }
  const candidates = Array.isArray(
      (payload as Record<string, unknown>).candidates,
    )
    ? (payload as Record<string, unknown>).candidates as unknown[]
    : [];
  const first = candidates[0];
  if (!first || typeof first !== "object") {
    throw new RoomObservationPipelineError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      safeDetail: "Room observer returned no candidate.",
    });
  }
  const content = (first as Record<string, unknown>).content;
  const parts = content && typeof content === "object" &&
      Array.isArray((content as Record<string, unknown>).parts)
    ? (content as Record<string, unknown>).parts as unknown[]
    : [];
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
    throw new RoomObservationPipelineError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      safeDetail: "Room observer returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RoomObservationPipelineError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      safeDetail: "Room observer candidate text was not valid JSON.",
    });
  }
}

function validateProviderObservationEnvelope(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "provider_result_not_object";
  }
  const record = value as Record<string, unknown>;
  const requiredArrays = [
    "observedPlanes",
    "observedGridFamilies",
    "observedSeams",
    "observedOpenings",
    "adjacency",
    "unresolved",
  ] as const;
  const invalid = requiredArrays.find((key) => !Array.isArray(record[key]));
  return invalid ? `provider_result_${invalid}_not_array` : null;
}

function buildValidatedContract(args: {
  raw: unknown;
  input: ObservationInput;
  provider: RoomObservationFailureDiagnostic["provider"];
  model: string;
  now: () => Date;
}): RoomObservationContract {
  const contractValidationReason = validateProviderObservationEnvelope(args.raw);
  if (contractValidationReason) {
    throw new RoomObservationPipelineError({
      failureClass: "contract_validation",
      failureStage: "contract_validation",
      safeDetail: "Room observer result failed the top-level contract.",
      contractValidationReason,
    });
  }
  try {
    return buildRoomObservationContract(args.raw, {
      originalIdentity: args.input.generation.originalIdentity,
      fullyTiledIdentity: args.input.generation.identity,
      generationId: args.input.generation.provenance.generationId,
      attemptId: args.input.attemptId,
      floorResultId: args.input.floorResultId,
      cameraAuthorityKey: args.input.floor.authorityKey,
      frozenSnapshotDigest: digestFrozenCameraSnapshot(args.input.camera),
      provider: args.provider,
      model: args.model,
      promptVersion: AFC_V2_ROOM_OBSERVATION_PROMPT_VERSION,
      generatedAt: args.now().toISOString(),
    });
  } catch (error) {
    if (error instanceof RoomObservationPipelineError) throw error;
    throw new RoomObservationPipelineError({
      failureClass: "contract_validation",
      failureStage: "contract_validation",
      safeDetail: `Room observation contract construction failed: ${safeDetail(error)}`,
      contractValidationReason: "contract_builder_rejected",
    });
  }
}

export function digestFrozenCameraSnapshot(
  camera: ObservationInput["camera"],
): string {
  const canonicalShape = {
    frame: {
      height: camera.frame.height,
      width: camera.frame.width,
    },
    originalBasisRestored: camera.originalBasisRestored,
    pose: {
      lookAt: {
        x: camera.pose.lookAt.x,
        y: camera.pose.lookAt.y,
        z: camera.pose.lookAt.z,
      },
      position: {
        x: camera.pose.position.x,
        y: camera.pose.position.y,
        z: camera.pose.position.z,
      },
      up: {
        x: camera.pose.up.x,
        y: camera.pose.up.y,
        z: camera.pose.up.z,
      },
    },
    verticalFovDeg: camera.verticalFovDeg,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalShape))
    .digest("hex");
}

export async function observeFullyTiledRoomEnvelope(
  input: ObservationInput,
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
): Promise<RoomObservationResult> {
  const apiKey = dependencies.apiKey ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY;
  const configuredModel =
    dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim();
  const model = configuredModel || AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  if (!dependencies.callProvider && !apiKey) {
    const diagnostic = Object.freeze({
      failureClass: "configuration" as const,
      failureStage: "configuration" as const,
      provider,
      model,
      providerStatus: null,
      safeDetail: "Room observation provider credentials are unavailable.",
      contractValidationReason: null,
    });
    return {
      status: "failed",
      reason: "Room observation provider credentials are unavailable.",
      diagnostic,
    };
  }
  const observationPrompt = prompt(input);
  const now = dependencies.now ?? (() => new Date());
  let contract: RoomObservationContract;
  try {
    if (dependencies.callProvider) {
      const raw = await dependencies.callProvider({
        prompt: observationPrompt,
        imageBase64: Buffer.from(input.generation.bytes).toString("base64"),
        mimeType: input.generation.identity.mimeType,
        responseSchema: RESPONSE_SCHEMA,
        model,
      });
      contract = buildValidatedContract({ raw, input, provider, model, now });
    } else {
      contract = await withGeminiUsageAccounting(
        {
          attemptId: input.attemptId,
          provider: "google_gemini",
          model,
          workflowType: "afc-v2-room-envelope-observation",
          actionType: "observe-fully-tiled-room-envelope",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: 1,
          metadata: {
            promptVersion: AFC_V2_ROOM_OBSERVATION_PROMPT_VERSION,
            representation: "FULLY_TILED",
            cameraRole: "consumed_reference_only",
          },
        },
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            ROOM_OBSERVATION_TIMEOUT_MS,
          );
          try {
            const generationConfig: Record<string, unknown> = {
              temperature: 0.1,
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
              responseJsonSchema: RESPONSE_SCHEMA,
            };
            if (/(?:^|\/)gemini-3\.5-flash$/i.test(model)) {
              generationConfig.thinkingConfig = {
                thinkingLevel: "minimal",
              };
            }
            let response: Response;
            try {
              response = await (dependencies.fetch ?? fetch)(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey!)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  signal: controller.signal,
                  body: JSON.stringify({
                    contents: [{
                      role: "user",
                      parts: [
                        { text: observationPrompt },
                        {
                          inlineData: {
                            mimeType: input.generation.identity.mimeType,
                            data: Buffer.from(input.generation.bytes).toString(
                              "base64",
                            ),
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
              throw new RoomObservationPipelineError({
                failureClass: timedOut ? "timeout" : "transport",
                failureStage: "provider_invocation",
                safeDetail: timedOut
                  ? "Room observer request timed out."
                  : `Room observer transport failed: ${safeDetail(error)}`,
              });
            }
            if (!response.ok) {
              const body = await response.text().catch(() => "");
              let providerDetail = "";
              try {
                const parsed = JSON.parse(body) as {
                  error?: { status?: unknown; message?: unknown };
                };
                const status = typeof parsed.error?.status === "string"
                  ? parsed.error.status
                  : "";
                const message = typeof parsed.error?.message === "string"
                  ? parsed.error.message
                  : "";
                providerDetail = [status, message].filter(Boolean).join(": ");
              } catch {
                providerDetail = "";
              }
              throw new RoomObservationPipelineError({
                failureClass: "provider_http",
                failureStage: "provider_response",
                providerStatus: response.status,
                safeDetail: providerDetail
                  ? `Room observer HTTP ${response.status}: ${safeDetail(providerDetail)}`
                  : `Room observer failed with HTTP ${response.status}.`,
              });
            }
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.toLowerCase().includes("application/json")) {
              throw new RoomObservationPipelineError({
                failureClass: "provider_response",
                failureStage: "provider_response",
                providerStatus: response.status,
                safeDetail:
                  "Room observer returned a non-JSON response content type.",
              });
            }
            let envelope: unknown;
            try {
              envelope = JSON.parse(await response.text());
            } catch {
              throw new RoomObservationPipelineError({
                failureClass: "provider_response",
                failureStage: "provider_response",
                providerStatus: response.status,
                safeDetail: "Room observer returned an invalid JSON response envelope.",
              });
            }
            return buildValidatedContract({
              raw: extractJson(envelope),
              input,
              provider,
              model,
              now,
            });
          } finally {
            clearTimeout(timeout);
          }
        },
      );
    }
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-room-observation] failed", diagnostic);
    return {
      status: "failed",
      reason: "FULLY_TILED room observation failed.",
      diagnostic,
    };
  }

  return { status: "observed", contract };
}
