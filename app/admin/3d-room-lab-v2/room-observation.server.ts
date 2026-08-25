import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import type { FullyTiledGeneration } from "./fully-tiled-generation.server";
import {
  buildRoomObservationContract,
  type RoomObservationContract,
} from "./room-observation-contract";

export const AFC_V2_ROOM_OBSERVATION_PROMPT_VERSION =
  "afc-v2-visible-room-envelope-observer/v5" as const;
export const AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL = "gemini-3.5-flash";
const ROOM_OBSERVATION_TIMEOUT_MS = 60_000;

const RESPONSE_SCHEMA = {
  type: "object",
  required: [
    "observedPlanes",
    "observedGridFamilies",
    "observedSeams",
    "observedOpenings",
    "planeContinuity",
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
          "boundaryEvidence",
          "gridCompatibility",
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
          boundaryEvidence: {
            type: "string",
            enum: [
              "projective_discontinuity",
              "architectural_break",
              "uninterrupted_tiled_field",
              "unclear",
            ],
          },
          gridCompatibility: {
            type: "string",
            enum: ["compatible", "incompatible", "insufficient"],
          },
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
    planeContinuity: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "planeIds",
          "assessment",
          "gridCompatibility",
          "boundaryEvidence",
          "confidence",
          "visibility",
        ],
        properties: {
          id: { type: "string" },
          planeIds: {
            type: "array",
            minItems: 2,
            items: { type: "string" },
          },
          assessment: {
            type: "string",
            enum: ["continuous", "discontinuous", "unresolved"],
          },
          gridCompatibility: {
            type: "string",
            enum: ["compatible", "incompatible", "insufficient"],
          },
          boundaryEvidence: {
            type: "string",
            enum: [
              "uninterrupted_tiled_field",
              "projective_discontinuity",
              "architectural_break",
              "opening",
              "unclear",
            ],
          },
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

const GRID_REFINEMENT_SCHEMA = {
  type: "object",
  required: ["observedGridFamilies", "unresolved"],
  properties: {
    observedGridFamilies: RESPONSE_SCHEMA.properties.observedGridFamilies,
    unresolved: RESPONSE_SCHEMA.properties.unresolved,
  },
  $defs: RESPONSE_SCHEMA.$defs,
} as const;

const SEAM_REFINEMENT_SCHEMA = {
  type: "object",
  required: ["observedSeams", "unresolved"],
  properties: {
    observedSeams: RESPONSE_SCHEMA.properties.observedSeams,
    unresolved: RESPONSE_SCHEMA.properties.unresolved,
  },
  $defs: RESPONSE_SCHEMA.$defs,
} as const;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function missingGridPlaneSummaries(raw: unknown): readonly unknown[] {
  const root = objectRecord(raw);
  const planes = Array.isArray(root?.observedPlanes)
    ? root.observedPlanes
    : [];
  const grids = Array.isArray(root?.observedGridFamilies)
    ? root.observedGridFamilies
    : [];
  const boundPlaneIds = new Set(
    grids.map((value) => objectRecord(value)?.planeId)
      .filter((value): value is string => typeof value === "string"),
  );
  return planes
    .map(objectRecord)
    .filter((plane): plane is Record<string, unknown> =>
      Boolean(
        plane &&
          typeof plane.id === "string" &&
          (plane.category === "floor" ||
            plane.category === "wall" ||
            plane.category === "ceiling") &&
          !boundPlaneIds.has(plane.id),
      )
    )
    .map((plane) => ({
      id: plane.id,
      category: plane.category,
      imagePolygon: plane.imagePolygon,
    }))
    .slice(0, 16);
}

function gridRefinementPrompt(
  missingPlanes: readonly unknown[],
): string {
  return `Perform a focused grout-line census on the supplied FULLY_TILED analytical image.

The primary room observer reported these visible planes without any accepted grid family:
${JSON.stringify(missingPlanes)}

This image intentionally shows a dark tiled lattice on visible floor, wall, and ceiling fields. For each listed plane, inspect only inside its supplied image polygon and sample actual visible grout-line segments. Return axis_a and axis_b when both are visible, or one family when only one is visible. Use at least two sampled segments per family when available. Keep every segment inside the associated visible plane field and stop at openings or boundaries. Do not alter planes, seams, openings, camera, Floor authority, or world geometry. Do not synthesize lines. If a listed plane genuinely has no safely observable family, explain that plane by ID in unresolved.

Coordinates are source-normalized: x=0 left, x=1 right, y=0 top, y=1 bottom. IDs must begin with a letter and contain only letters, digits, underscore, or hyphen. Return JSON matching the supplied schema.`;
}

function mergeGridRefinement(
  raw: unknown,
  refinement: unknown,
): unknown {
  const root = objectRecord(raw);
  const refined = objectRecord(refinement);
  if (!root || !refined) return raw;
  const primaryGrids = Array.isArray(root.observedGridFamilies)
    ? root.observedGridFamilies
    : [];
  const refinedGrids = Array.isArray(refined.observedGridFamilies)
    ? refined.observedGridFamilies
    : [];
  const primaryUnresolved = Array.isArray(root.unresolved)
    ? root.unresolved
    : [];
  const refinedUnresolved = Array.isArray(refined.unresolved)
    ? refined.unresolved
    : [];
  return {
    ...root,
    observedGridFamilies: [...primaryGrids, ...refinedGrids],
    unresolved: [...primaryUnresolved, ...refinedUnresolved],
    providerPasses: {
      structuralObservation: 1,
      gridRefinement: 1,
      seamRefinement: objectRecord(root.providerPasses)?.seamRefinement === 1
        ? 1
        : 0,
    },
  };
}

function normalizedPoints(value: unknown): readonly { x: number; y: number }[] {
  return Array.isArray(value)
    ? value.map(objectRecord).filter((point): point is Record<string, unknown> =>
      Boolean(
        point &&
          typeof point.x === "number" &&
          typeof point.y === "number",
      )
    ).map((point) => ({ x: point.x as number, y: point.y as number }))
    : [];
}

function polygonsShareBoundary(a: unknown, b: unknown): boolean {
  const pointsA = normalizedPoints(a);
  const pointsB = normalizedPoints(b);
  const contacts = pointsA.filter((pointA) =>
    pointsB.some((pointB) =>
      Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) <= 0.02
    )
  );
  return contacts.some((first, index) =>
    contacts.slice(index + 1).some((second) =>
      Math.hypot(first.x - second.x, first.y - second.y) >= 0.025
    )
  );
}

function missingSeamTargets(raw: unknown): readonly unknown[] {
  const root = objectRecord(raw);
  const planes = Array.isArray(root?.observedPlanes)
    ? root.observedPlanes.map(objectRecord).filter(Boolean) as Record<
      string,
      unknown
    >[]
    : [];
  const seams = Array.isArray(root?.observedSeams)
    ? root.observedSeams.map(objectRecord).filter(Boolean) as Record<
      string,
      unknown
    >[]
    : [];
  const acceptedPairKeys = new Set(
    seams.map((seam) =>
      Array.isArray(seam.planeIds)
        ? [...seam.planeIds].filter((id): id is string =>
          typeof id === "string"
        ).sort().join(":")
        : ""
    ),
  );
  const targets: unknown[] = [];
  for (let a = 0; a < planes.length; a += 1) {
    for (let b = a + 1; b < planes.length; b += 1) {
      const categories = [planes[a].category, planes[b].category].sort().join(
        ":",
      );
      const category = categories === "floor:wall"
        ? "floor_wall"
        : categories === "ceiling:wall"
        ? "wall_ceiling"
        : null;
      const ids = [planes[a].id, planes[b].id].filter((id): id is string =>
        typeof id === "string"
      );
      if (
        category &&
        ids.length === 2 &&
        !acceptedPairKeys.has([...ids].sort().join(":")) &&
        polygonsShareBoundary(
          planes[a].imagePolygon,
          planes[b].imagePolygon,
        )
      ) {
        targets.push({ category, planeIds: ids });
      }
    }
  }
  return targets.slice(0, 24);
}

function seamRefinementPrompt(raw: unknown, targets: readonly unknown[]): string {
  const root = objectRecord(raw);
  return `Perform a focused visible-seam census on the supplied FULLY_TILED analytical image.

The primary observer's polygons share boundaries for these floor-wall or wall-ceiling plane pairs, but no seam was reported:
${JSON.stringify(targets)}

Reported planes:
${JSON.stringify(root?.observedPlanes ?? [])}

Reported openings:
${JSON.stringify(root?.observedOpenings ?? [])}

For each target pair, report a seam only where the architectural meeting boundary is actually visible. Trace only the observed source-normalized polyline; stop at windows, doors, passages, occlusion, and image edges. Do not cross or fill an opening. Do not add wall-wall seams in this pass. Do not alter planes, grids, openings, camera, Floor authority, or world geometry. If a target cannot be supported, identify its plane IDs in unresolved.

Coordinates are source-normalized: x=0 left, x=1 right, y=0 top, y=1 bottom. IDs must begin with a letter and contain only letters, digits, underscore, or hyphen. Return JSON matching the supplied schema.`;
}

function mergeSeamRefinement(raw: unknown, refinement: unknown): unknown {
  const root = objectRecord(raw);
  const refined = objectRecord(refinement);
  if (!root || !refined) return raw;
  const primarySeams = Array.isArray(root.observedSeams)
    ? root.observedSeams
    : [];
  const refinedSeams = Array.isArray(refined.observedSeams)
    ? refined.observedSeams
    : [];
  const primaryUnresolved = Array.isArray(root.unresolved)
    ? root.unresolved
    : [];
  const refinedUnresolved = Array.isArray(refined.unresolved)
    ? refined.unresolved
    : [];
  return {
    ...root,
    observedSeams: [...primarySeams, ...refinedSeams],
    unresolved: [...primaryUnresolved, ...refinedUnresolved],
    providerPasses: {
      structuralObservation: 1,
      gridRefinement: objectRecord(root.providerPasses)?.gridRefinement === 1
        ? 1
        : 0,
      seamRefinement: 1,
    },
  };
}

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
- A plane is a projectively coherent visible tiled field. Use floor, wall, ceiling, or unknown when category is ambiguous. Do not split one uninterrupted tiled field merely because it spans a large image region or contains a window. Do not promote a thin corner-line band, grout cluster, or antialiased transition into a separate plane when it has no independently coherent grid field.
- For each plane, trace a conservative image polygon around only that visible field. The supplied calibrated Floor polygon is a camera-calibration patch, not the visible floor extent: independently trace the visible tiled floor field and never copy the calibration quad unless the visible field truly has that exact boundary. A floor polygon must follow visible floor-wall seams and the lower image boundary; it must not include wall or ceiling pixels.
- This analytical image intentionally contains a conspicuous dark grout-line lattice across the floor, walls, and ceiling. Treat those lines as primary geometric evidence, not texture noise. For every confidently reported plane, perform a separate grid census before writing JSON. Report up to two principal families (axis_a and axis_b) whenever actual lines are visible, including narrow wall and ceiling fields. Sample at least two actual visible segments per family when available. A result with floor grids but no wall or ceiling grids is incomplete when the supplied image visibly contains those lines. Never synthesize extensions or invent a family that is genuinely not visible; record that absence in unresolved.
- Systematically inspect visible floor-wall, wall-wall, and wall-ceiling boundaries. A seam is only an actually visible architectural meeting boundary. Reference only planes you reported and stop each polyline at openings, occlusion, or the image edge.
- For every seam, classify boundaryEvidence and gridCompatibility. A wall-wall seam needs a projective discontinuity or architectural break; an uninterrupted tiled field is not a true wall-wall seam even if an earlier region split suggested one.
- An opening is a visible window, door, passage, or unknown discontinuity where the tiled field stops. Trace the observed boundary only.
- Add one planeContinuity entry for every neighboring pair of reported wall polygons. If two or more wall planes are reported, planeContinuity must not be empty. Mark continuous only when the polygons share a visible boundary, sampled grid directions are compatible, the tiled field is uninterrupted, and no opening or supported corner separates them. Use discontinuous for a supported corner/opening and unresolved when evidence is insufficient.
- Do not report adjacency separately. V2 normalization derives final adjacency only from accepted visible seams.
- Set visibility to "observed" exactly. Put uncertainty in ambiguity and unresolved. Prefer unknown or omission over a false claim.
- IDs must begin with a letter and contain only letters, digits, underscore, or hyphen.

Before returning JSON, audit the result in this order:
1. Every plane polygon stays inside its own visible field.
2. Every reported plane has a deliberate grid-family decision.
3. Every visible floor-wall and wall-ceiling boundary was considered.
4. Every wall-wall seam has real discontinuity evidence rather than a semantic guess.
5. Openings interrupt fields and polylines without being filled or crossed.

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

async function callGeminiJson(args: {
  apiKey: string;
  model: string;
  prompt: string;
  responseSchema: unknown;
  imageBase64: string;
  mimeType: string;
  fetch: typeof fetch;
}): Promise<unknown> {
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
      responseJsonSchema: args.responseSchema,
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
        safeDetail: "Room observer returned a non-JSON response content type.",
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
    return extractJson(envelope);
  } finally {
    clearTimeout(timeout);
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
    "planeContinuity",
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
  const imageBase64 = Buffer.from(input.generation.bytes).toString("base64");
  const callRaw = async (args: {
    prompt: string;
    responseSchema: unknown;
    actionType: string;
    attemptId: string;
  }): Promise<unknown> => {
    if (dependencies.callProvider) {
      return dependencies.callProvider({
        prompt: args.prompt,
        imageBase64,
        mimeType: input.generation.identity.mimeType,
        responseSchema: args.responseSchema,
        model,
      });
    }
    return withGeminiUsageAccounting(
      {
        attemptId: args.attemptId,
        provider: "google_gemini",
        model,
        workflowType: "afc-v2-room-envelope-observation",
        actionType: args.actionType,
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
      () =>
        callGeminiJson({
          apiKey: apiKey!,
          model,
          prompt: args.prompt,
          responseSchema: args.responseSchema,
          imageBase64,
          mimeType: input.generation.identity.mimeType,
          fetch: dependencies.fetch ?? fetch,
        }),
    );
  };
  let contract: RoomObservationContract;
  try {
    let raw = await callRaw({
      prompt: observationPrompt,
      responseSchema: RESPONSE_SCHEMA,
      actionType: "observe-fully-tiled-room-envelope",
      attemptId: input.attemptId,
    });
    const missingPlanes = missingGridPlaneSummaries(raw);
    if (missingPlanes.length > 0) {
      try {
        const refinement = await callRaw({
          prompt: gridRefinementPrompt(missingPlanes),
          responseSchema: GRID_REFINEMENT_SCHEMA,
          actionType: "refine-fully-tiled-room-grids",
          attemptId: `${input.attemptId}-grid-refinement`,
        });
        raw = mergeGridRefinement(raw, refinement);
      } catch (error) {
        const root = objectRecord(raw);
        if (root) {
          const unresolved = Array.isArray(root.unresolved)
            ? root.unresolved
            : [];
          raw = {
            ...root,
            unresolved: [
              ...unresolved,
              `Grid refinement failed closed: ${safeDetail(error)}`.slice(0, 240),
            ],
            providerPasses: {
              structuralObservation: 1,
              gridRefinement: 0,
              seamRefinement: 0,
            },
          };
        }
      }
    }
    const seamTargets = missingSeamTargets(raw);
    if (seamTargets.length > 0) {
      try {
        const refinement = await callRaw({
          prompt: seamRefinementPrompt(raw, seamTargets),
          responseSchema: SEAM_REFINEMENT_SCHEMA,
          actionType: "refine-fully-tiled-room-seams",
          attemptId: `${input.attemptId}-seam-refinement`,
        });
        raw = mergeSeamRefinement(raw, refinement);
      } catch (error) {
        const root = objectRecord(raw);
        if (root) {
          const unresolved = Array.isArray(root.unresolved)
            ? root.unresolved
            : [];
          raw = {
            ...root,
            unresolved: [
              ...unresolved,
              `Seam refinement failed closed: ${safeDetail(error)}`.slice(0, 240),
            ],
            providerPasses: {
              structuralObservation: 1,
              gridRefinement:
                objectRecord(root.providerPasses)?.gridRefinement === 1 ? 1 : 0,
              seamRefinement: 0,
            },
          };
        }
      }
    }
    contract = buildValidatedContract({ raw, input, provider, model, now });
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
