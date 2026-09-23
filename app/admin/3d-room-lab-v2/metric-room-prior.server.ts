import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import { acceptMetricRoomPrior } from "./metric-room-prior-acceptance";
import {
  AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION,
  buildMetricRoomPriorReceipt,
  buildUnavailableMetricRoomPriorReceipt,
  parseMetricRoomPriorModelEstimate,
  type MetricPriorImageIdentity,
  type MetricRoomPriorFailure,
  type MetricRoomPriorReceipt,
  type MetricRoomPriorReceiptContext,
} from "./metric-room-prior-contract";

export const AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL = "gemini-3.5-flash";
export const AFC_V2_METRIC_ROOM_PRIOR_PROFILE =
  "original-metric-room-prior-conservative/v1" as const;

const TIMEOUT_MS = 60_000;

export type MetricRoomPriorInput = Readonly<{
  attemptId: string;
  loadGeneration: number;
  original: Readonly<{
    bytes: Uint8Array;
    identity: MetricPriorImageIdentity;
  }>;
}>;

const RANGE_SCHEMA = {
  type: ["object", "null"],
  required: ["low", "best", "high"],
  properties: {
    low: { type: "number", description: "Lower bound in metres, one decimal." },
    best: { type: "number", description: "Best estimate in metres, one decimal." },
    high: { type: "number", description: "Upper bound in metres, one decimal." },
  },
} as const;

const RESPONSE_SCHEMA = {
  type: "object",
  required: [
    "observability",
    "estimatedRoomDepthM",
    "estimatedRoomWidthM",
    "estimatedCeilingHeightM",
    "modelConfidence",
    "limitations",
    "notes",
  ],
  properties: {
    observability: {
      type: "string",
      enum: ["recoverable", "weak", "not_recoverable"],
    },
    estimatedRoomDepthM: RANGE_SCHEMA,
    estimatedRoomWidthM: RANGE_SCHEMA,
    estimatedCeilingHeightM: {
      type: ["number", "null"],
      description: "Optional ceiling height in metres, one decimal.",
    },
    modelConfidence: { type: "number", minimum: 0, maximum: 1 },
    limitations: { type: "array", items: { type: "string" } },
    notes: { type: ["string", "null"] },
  },
} as const;

class MetricPriorError extends Error {
  readonly failureClass: MetricRoomPriorFailure["failureClass"];
  readonly failureStage: MetricRoomPriorFailure["failureStage"];
  readonly providerStatus: number | null;
  readonly contractValidationReason: string | null;

  constructor(args: {
    failureClass: MetricRoomPriorFailure["failureClass"];
    failureStage: MetricRoomPriorFailure["failureStage"];
    detail: string;
    providerStatus?: number | null;
    contractValidationReason?: string | null;
  }) {
    super(args.detail);
    this.name = "MetricPriorError";
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
    : "Unknown metric room-prior failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown metric room-prior failure.";
}

export function metricRoomPriorPrompt(): string {
  return `Estimate approximate physical room dimensions from the supplied ORIGINAL photograph only.

This is a soft physical-size prior. It is not geometry reconstruction.

Hard limits:
- Do not modify, complete, or reconstruct room geometry.
- Do not infer FOV, camera pose, camera height, or calibration.
- Do not output world coordinates, image polylines, polygons, or pixel traces.
- Do not output autoMetricScale, metricScale, or any scale factor.
- Do not use any canonical 4-unit Floor depth, TILED tile size, or projective gauge as a physical measurement.
- Do not snap to typical or round room dimensions.
- Do not treat this image as EMPTY, TILED, or FULLY_TILED evidence.

Task:
- Estimate the approximate physical depth of the visible room in metres. Depth is the primary estimate: the receding distance from the camera's near floor toward the far visible floor or back wall.
- Optionally estimate physical width in metres as secondary diagnostic information.
- Optionally estimate ceiling height in metres as plausibility context only. Ceiling height must not be treated as the room-scale answer.
- Use one decimal metre. Prefer 5.8 over 5.827314. Avoid false precision.
- Ranges must reflect actual uncertainty: low ≤ best ≤ high, all positive.

Evidence:
- Use only visible real-world cues in this ORIGINAL photograph, cautiously: doors, counters, cabinets, outlets, appliances, furniture, people if present.
- Every cue is soft. No object has one exact standard size. Do not snap room scale from one assumed door height or appliance width.
- Distinguish observed evidence from assumptions. Disclose major assumptions in limitations.
- Use broad uncertainty. If physical scale cannot be estimated reliably, return observability=not_recoverable with null dimension ranges. That is the correct answer. Do not invent a dimension.

Observability:
- recoverable: visible cues support an approximate physical size with a honest range.
- weak: some cues exist but the estimate is too uncertain for automatic use.
- not_recoverable: physical scale is not honestly observable. Prefer this over a made-up number.

Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new MetricPriorError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Metric room prior returned no response envelope.",
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
    throw new MetricPriorError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Metric room prior returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MetricPriorError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      detail: "Metric room prior candidate text was not valid JSON.",
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
      maxOutputTokens: 2048,
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
      throw new MetricPriorError({
        failureClass: timedOut ? "timeout" : "transport",
        failureStage: "provider_invocation",
        detail: timedOut
          ? "Metric room prior request timed out."
          : `Metric room prior transport failed: ${safeDetail(error)}`,
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
      throw new MetricPriorError({
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: providerDetail
          ? `Metric room prior HTTP ${response.status}: ${safeDetail(providerDetail)}`
          : `Metric room prior failed with HTTP ${response.status}.`,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new MetricPriorError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Metric room prior returned a non-JSON response content type.",
      });
    }
    try {
      return extractJson(JSON.parse(await response.text()));
    } catch (error) {
      if (error instanceof MetricPriorError) throw error;
      throw new MetricPriorError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Metric room prior returned an invalid JSON response envelope.",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function failureDiagnostic(args: {
  error: unknown;
  provider: MetricRoomPriorFailure["provider"];
  model: string;
}): MetricRoomPriorFailure {
  const error = args.error;
  return Object.freeze({
    failureClass: error instanceof MetricPriorError
      ? error.failureClass
      : "unknown",
    failureStage: error instanceof MetricPriorError
      ? error.failureStage
      : "provider_invocation",
    provider: args.provider,
    model: args.model,
    providerStatus: error instanceof MetricPriorError
      ? error.providerStatus
      : null,
    safeDetail: safeDetail(error),
    contractValidationReason: error instanceof MetricPriorError
      ? error.contractValidationReason
      : null,
  });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function receiptContext(
  input: MetricRoomPriorInput,
  provider: MetricRoomPriorFailure["provider"],
  model: string,
): MetricRoomPriorReceiptContext {
  return {
    sourceImageHash: input.original.identity.sha256,
    originalAncestorSha256: input.original.identity.sha256,
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    provider,
    model,
  };
}

export async function estimateMetricRoomPrior(
  input: MetricRoomPriorInput,
  dependencies: Readonly<{
    model?: string;
    apiKey?: string;
    callProvider?: (args: {
      prompt: string;
      imageBase64: string;
      mimeType: string;
      responseSchema: unknown;
      model: string;
    }) => Promise<unknown>;
    fetch?: typeof fetch;
  }> = {},
): Promise<MetricRoomPriorReceipt> {
  const model = dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  const context = receiptContext(input, provider, model);
  const fail = (diagnostic: MetricRoomPriorFailure) =>
    buildUnavailableMetricRoomPriorReceipt(context, diagnostic);

  if (
    hash(input.original.bytes) !== input.original.identity.sha256 ||
    input.original.bytes.byteLength !== input.original.identity.byteCount ||
    input.original.identity.orientation !== 1 ||
    input.original.identity.sha256.length !== 64
  ) {
    return fail(Object.freeze({
      failureClass: "basis_validation",
      failureStage: "basis_validation",
      provider,
      model,
      providerStatus: null,
      safeDetail:
        "ORIGINAL bytes did not match the attempt-bound ORIGINAL identity.",
      contractValidationReason: "original_identity_mismatch",
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
      safeDetail: "Metric room prior provider credentials are unavailable.",
      contractValidationReason: null,
    }));
  }

  const prompt = metricRoomPriorPrompt();
  const imageBase64 = Buffer.from(input.original.bytes).toString("base64");
  try {
    const raw = dependencies.callProvider
      ? await dependencies.callProvider({
        prompt,
        imageBase64,
        mimeType: input.original.identity.mimeType,
        responseSchema: RESPONSE_SCHEMA,
        model,
      })
      : await withGeminiUsageAccounting(
        {
          attemptId: input.attemptId,
          provider: "google_gemini",
          model,
          workflowType: "afc-v2-metric-room-prior",
          actionType: "estimate-original-metric-room-prior",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: 1,
          metadata: {
            promptVersion: AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION,
            representation: "ORIGINAL",
            authority: "prior_only",
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
            mimeType: input.original.identity.mimeType,
            fetch: dependencies.fetch ?? fetch,
          }),
      );
    const parsed = parseMetricRoomPriorModelEstimate(raw);
    if (!parsed.ok) {
      throw new MetricPriorError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "Metric room prior result failed the contract.",
        contractValidationReason: parsed.reason,
      });
    }
    return buildMetricRoomPriorReceipt(
      context,
      parsed.estimate,
      acceptMetricRoomPrior(parsed.estimate),
      null,
    );
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-metric-room-prior] failed", diagnostic);
    return fail(diagnostic);
  }
}
