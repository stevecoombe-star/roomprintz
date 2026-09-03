import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import { acceptMetricCorrespondenceEstimate } from "./metric-correspondence-estimate-acceptance";
import {
  AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION,
  buildMetricCorrespondenceEstimateReceipt,
  buildUnavailableMetricCorrespondenceEstimateReceipt,
  parseMetricCorrespondencePhysicalEstimate,
  type MetricCorrespondenceEstimateFailure,
  type MetricCorrespondenceEstimateImageIdentity,
  type MetricCorrespondenceEstimateReceipt,
  type MetricCorrespondenceEstimateReceiptContext,
} from "./metric-correspondence-estimate-contract";
import type { MetricCorrespondenceSpan } from "./metric-correspondence-span-contract";
import {
  composeMetricCorrespondenceOverlay,
  type MetricCorrespondenceOverlayResult,
} from "./metric-correspondence-overlay.server";

export const AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_DEFAULT_MODEL =
  "gemini-3.5-flash";

const TIMEOUT_MS = 60_000;

export type MetricCorrespondenceEstimateInput = Readonly<{
  attemptId: string;
  loadGeneration: number;
  original: Readonly<{
    bytes: Uint8Array;
    identity: MetricCorrespondenceEstimateImageIdentity;
  }>;
  span: MetricCorrespondenceSpan;
}>;

export type MetricCorrespondenceProviderSpanMetadata = Readonly<{
  spanRole: MetricCorrespondenceSpan["role"];
  endpointA: Readonly<{ x: number; y: number }>;
  endpointB: Readonly<{ x: number; y: number }>;
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
    "estimatedLengthM",
    "modelConfidence",
    "limitations",
    "notes",
  ],
  properties: {
    observability: {
      type: "string",
      enum: ["recoverable", "weak", "not_recoverable"],
    },
    estimatedLengthM: RANGE_SCHEMA,
    modelConfidence: { type: "number", minimum: 0, maximum: 1 },
    limitations: { type: "array", items: { type: "string" } },
    notes: { type: ["string", "null"] },
  },
} as const;

class MetricSpanEstimateError extends Error {
  readonly failureClass: MetricCorrespondenceEstimateFailure["failureClass"];
  readonly failureStage: MetricCorrespondenceEstimateFailure["failureStage"];
  readonly providerStatus: number | null;
  readonly contractValidationReason: string | null;

  constructor(args: {
    failureClass: MetricCorrespondenceEstimateFailure["failureClass"];
    failureStage: MetricCorrespondenceEstimateFailure["failureStage"];
    detail: string;
    providerStatus?: number | null;
    contractValidationReason?: string | null;
  }) {
    super(args.detail);
    this.name = "MetricSpanEstimateError";
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
    : "Unknown matched-span estimate failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown matched-span estimate failure.";
}

export function metricCorrespondenceProviderSpanMetadata(
  span: Pick<MetricCorrespondenceSpan, "role" | "imageA" | "imageB">,
): MetricCorrespondenceProviderSpanMetadata {
  return Object.freeze({
    spanRole: span.role,
    endpointA: Object.freeze({ x: span.imageA.x, y: span.imageA.y }),
    endpointB: Object.freeze({ x: span.imageB.x, y: span.imageB.y }),
  });
}

export function metricCorrespondenceEstimatorPrompt(
  metadata: MetricCorrespondenceProviderSpanMetadata,
): string {
  return `Estimate the real-world physical length, in metres, of the exact highlighted line segment from endpoint A to endpoint B in this ORIGINAL room photograph.

The photograph has a high-contrast overlay: A ●────────● B. Estimate A↔B only.

Highlighted span metadata (normalized ORIGINAL image coordinates, 0–1). These endpoints match labels A and B in the overlay:
${JSON.stringify(metadata)}

Hard limits:
- Estimate only the exact highlighted visible span from A to B.
- Do not move, extend, or snap the endpoints.
- Do not extend the segment to the frame edges.
- Do not infer hidden continuation beyond A or B.
- If only part of a wall or seam is highlighted, estimate only that highlighted visible span.
- Do not estimate whole-room width unless the highlighted A↔B segment actually is that width.
- Do not estimate room depth or ceiling height.
- Do not use image pixel length alone as a physical measurement.
- Do not output world coordinates, image polylines, or a scale factor.
- Do not output a similarity scale, gauge-unit length, Floor width or depth, or any desired physical answer.
- Do not treat this image as EMPTY, TILED, or FULLY_TILED evidence.

Evidence:
- Use visible physical cues in the ORIGINAL photograph carefully: furniture, doors, cabinets, people if present.
- Every cue is a soft reference only. Do not assume exact standard sizes.
- Distinguish observed evidence from assumptions. Disclose major assumptions in limitations.
- Use one decimal metre. Prefer 5.8 over 5.827314. Avoid false precision.
- Ranges must reflect actual uncertainty: low ≤ best ≤ high, all positive.

Observability:
- recoverable: visible cues support an approximate physical length of this exact A↔B span with an honest range.
- weak: some cues exist but the estimate is too uncertain for automatic use.
- not_recoverable: physical scale of this highlighted span is not honestly inferable. Prefer this over a made-up number. Return estimatedLengthM=null.

Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new MetricSpanEstimateError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Matched-span estimator returned no response envelope.",
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
    throw new MetricSpanEstimateError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Matched-span estimator returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MetricSpanEstimateError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      detail: "Matched-span estimator candidate text was not valid JSON.",
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
      throw new MetricSpanEstimateError({
        failureClass: timedOut ? "timeout" : "transport",
        failureStage: "provider_invocation",
        detail: timedOut
          ? "Matched-span estimator request timed out."
          : `Matched-span estimator transport failed: ${safeDetail(error)}`,
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
      throw new MetricSpanEstimateError({
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: providerDetail
          ? `Matched-span estimator HTTP ${response.status}: ${safeDetail(providerDetail)}`
          : `Matched-span estimator failed with HTTP ${response.status}.`,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new MetricSpanEstimateError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Matched-span estimator returned a non-JSON response content type.",
      });
    }
    try {
      return extractJson(JSON.parse(await response.text()));
    } catch (error) {
      if (error instanceof MetricSpanEstimateError) throw error;
      throw new MetricSpanEstimateError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Matched-span estimator returned an invalid JSON response envelope.",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function failureDiagnostic(args: {
  error: unknown;
  provider: MetricCorrespondenceEstimateFailure["provider"];
  model: string;
}): MetricCorrespondenceEstimateFailure {
  const error = args.error;
  return Object.freeze({
    failureClass: error instanceof MetricSpanEstimateError
      ? error.failureClass
      : "unknown",
    failureStage: error instanceof MetricSpanEstimateError
      ? error.failureStage
      : "provider_invocation",
    provider: args.provider,
    model: args.model,
    providerStatus: error instanceof MetricSpanEstimateError
      ? error.providerStatus
      : null,
    safeDetail: safeDetail(error),
    contractValidationReason: error instanceof MetricSpanEstimateError
      ? error.contractValidationReason
      : null,
  });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function receiptContext(
  input: MetricCorrespondenceEstimateInput,
  provider: MetricCorrespondenceEstimateFailure["provider"],
  model: string,
  overlayImageHash = "",
): MetricCorrespondenceEstimateReceiptContext {
  return {
    correspondenceSpanId: input.span.id,
    sourceImageHash: input.original.identity.sha256,
    overlayImageHash,
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    provider,
    model,
  };
}

export async function estimateMetricCorrespondenceSpan(
  input: MetricCorrespondenceEstimateInput,
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
    composeOverlay?: (
      args: {
        originalBytes: Uint8Array;
        imageA: MetricCorrespondenceSpan["imageA"];
        imageB: MetricCorrespondenceSpan["imageB"];
        width: number;
        height: number;
        format?: "png" | "jpeg";
      },
    ) => Promise<MetricCorrespondenceOverlayResult | null>;
  }> = {},
): Promise<MetricCorrespondenceEstimateReceipt> {
  const model = dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  const context = receiptContext(input, provider, model);
  const fail = (
    diagnostic: MetricCorrespondenceEstimateFailure,
    overlayImageHash = "",
  ) =>
    buildUnavailableMetricCorrespondenceEstimateReceipt(
      { ...context, overlayImageHash },
      diagnostic,
    );

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

  if (!input.span.overlaySafeOnOriginal) {
    return fail(Object.freeze({
      failureClass: "basis_validation",
      failureStage: "basis_validation",
      provider,
      model,
      providerStatus: null,
      safeDetail: "Selected correspondence span is not ORIGINAL-safe for overlay.",
      contractValidationReason: "overlay_unsafe",
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
      safeDetail: "Matched-span estimator provider credentials are unavailable.",
      contractValidationReason: null,
    }));
  }

  const compose = dependencies.composeOverlay ?? composeMetricCorrespondenceOverlay;
  let overlay: MetricCorrespondenceOverlayResult | null = null;
  try {
    overlay = await compose({
      originalBytes: input.original.bytes,
      imageA: input.span.imageA,
      imageB: input.span.imageB,
      width: input.original.identity.decodedWidth,
      height: input.original.identity.decodedHeight,
      format: "jpeg",
    });
  } catch (error) {
    return fail(Object.freeze({
      failureClass: "overlay_generation",
      failureStage: "overlay_generation",
      provider,
      model,
      providerStatus: null,
      safeDetail: `Matched-span overlay generation failed: ${safeDetail(error)}`,
      contractValidationReason: "overlay_generation_failed",
    }));
  }
  if (!overlay) {
    return fail(Object.freeze({
      failureClass: "overlay_generation",
      failureStage: "overlay_generation",
      provider,
      model,
      providerStatus: null,
      safeDetail: "Matched-span overlay generation returned no raster.",
      contractValidationReason: "overlay_generation_failed",
    }));
  }

  const metadata = metricCorrespondenceProviderSpanMetadata(input.span);
  const prompt = metricCorrespondenceEstimatorPrompt(metadata);
  const imageBase64 = Buffer.from(overlay.bytes).toString("base64");
  try {
    const raw = dependencies.callProvider
      ? await dependencies.callProvider({
        prompt,
        imageBase64,
        mimeType: overlay.mimeType,
        responseSchema: RESPONSE_SCHEMA,
        model,
      })
      : await withGeminiUsageAccounting(
        {
          attemptId: input.attemptId,
          provider: "google_gemini",
          model,
          workflowType: "afc-v2-metric-correspondence-estimate",
          actionType: "estimate-original-metric-correspondence-span",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: 1,
          metadata: {
            promptVersion: AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION,
            representation: "ORIGINAL_OVERLAY",
            authority: "prior_only",
            correspondenceSpanId: input.span.id,
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
            mimeType: overlay.mimeType,
            fetch: dependencies.fetch ?? fetch,
          }),
      );
    const parsed = parseMetricCorrespondencePhysicalEstimate(raw);
    if (!parsed.ok) {
      throw new MetricSpanEstimateError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "Matched-span estimate failed the contract.",
        contractValidationReason: parsed.reason,
      });
    }
    return buildMetricCorrespondenceEstimateReceipt(
      { ...context, overlayImageHash: overlay.sha256 },
      parsed.estimate,
      acceptMetricCorrespondenceEstimate(
        parsed.estimate,
        input.span.canonicalLength,
      ),
      null,
    );
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-metric-correspondence-estimate] failed", diagnostic);
    return fail(diagnostic, overlay.sha256);
  }
}
