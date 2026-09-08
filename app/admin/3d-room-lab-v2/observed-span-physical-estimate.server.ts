import "server-only";

import { createHash } from "node:crypto";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";
import {
  composeMetricCorrespondenceOverlay,
  type MetricCorrespondenceOverlayResult,
} from "./metric-correspondence-overlay.server";
import type { ObservedSpanMetricCandidate } from "./observed-span-metric-candidate-contract";
import { acceptObservedSpanPhysicalEstimate } from "./observed-span-physical-estimate-acceptance";
import {
  AFC_V2_OBSERVED_SPAN_CONTEXT_IMAGE_KIND,
  AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION,
  AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND,
  OBSERVED_SPAN_OVERLAY_CAPTION,
  buildObservedSpanPhysicalEstimateReceipt,
  parseObservedSpanPhysicalEstimate,
  unavailableObservedSpanEstimateAcceptance,
  type ObservedSpanEstimateFailure,
  type ObservedSpanEstimateImageIdentity,
  type ObservedSpanEstimateLineage,
  type ObservedSpanPhysicalEstimateReceipt,
} from "./observed-span-physical-estimate-contract";

export const AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_DEFAULT_MODEL =
  "gemini-3.5-flash";

const TIMEOUT_MS = 60_000;

export type ObservedSpanPhysicalEstimateInput = Readonly<{
  attemptId: string;
  loadGeneration: number;
  empty: Readonly<{
    bytes: Uint8Array;
    identity: ObservedSpanEstimateImageIdentity;
  }>;
  original?: Readonly<{
    bytes: Uint8Array;
    identity: ObservedSpanEstimateImageIdentity;
  }> | null;
  candidate: ObservedSpanMetricCandidate;
  floorAuthorityKey: string;
  freezeReceiptVersion: string | null;
  freezePayloadSha256: string | null;
}>;

export type ObservedSpanProviderSegmentMetadata = Readonly<{
  highlightedImageKind: typeof AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND;
  imageSpace: "empty-source-normalized-image/v1";
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
    "status",
    "estimatedLengthM",
    "modelConfidence",
    "limitations",
    "notes",
  ],
  properties: {
    status: {
      type: "string",
      enum: ["recoverable", "usable", "weak", "not_recoverable"],
    },
    estimatedLengthM: RANGE_SCHEMA,
    modelConfidence: { type: "number", minimum: 0, maximum: 1 },
    basis: { type: ["string", "null"] },
    limitations: { type: "array", items: { type: "string" } },
    notes: { type: ["string", "null"] },
    ambiguity: { type: ["string", "null"] },
  },
} as const;

class ObservedSpanEstimateError extends Error {
  readonly failureClass: ObservedSpanEstimateFailure["failureClass"];
  readonly failureStage: ObservedSpanEstimateFailure["failureStage"];
  readonly providerStatus: number | null;
  readonly contractValidationReason: string | null;

  constructor(args: {
    failureClass: ObservedSpanEstimateFailure["failureClass"];
    failureStage: ObservedSpanEstimateFailure["failureStage"];
    detail: string;
    providerStatus?: number | null;
    contractValidationReason?: string | null;
  }) {
    super(args.detail);
    this.name = "ObservedSpanEstimateError";
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
    : "Unknown observed-span estimate failure.";
  return text
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, "[REDACTED_LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Unknown observed-span estimate failure.";
}

export function observedSpanProviderSegmentMetadata(
  candidate: Pick<ObservedSpanMetricCandidate, "imageA" | "imageB">,
): ObservedSpanProviderSegmentMetadata {
  return Object.freeze({
    highlightedImageKind: AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND,
    imageSpace: "empty-source-normalized-image/v1",
    endpointA: Object.freeze({ x: candidate.imageA.x, y: candidate.imageA.y }),
    endpointB: Object.freeze({ x: candidate.imageB.x, y: candidate.imageB.y }),
  });
}

export function observedSpanPhysicalEstimatorPrompt(
  metadata: ObservedSpanProviderSegmentMetadata,
  includeOriginalContext: boolean,
): string {
  return `Estimate the real-world physical length, in metres, of THIS highlighted observed wall segment only.

PRIMARY image: EMPTY reconstruction with a high-contrast overlay A ●────────● B on the exact observed floor-wall segment. Estimate A↔B only.

${includeOriginalContext
    ? "CONTEXT image: ORIGINAL room photograph, unhighlighted. Use it only as physical-scale context (furniture, doors, windows, people). Do not treat ORIGINAL coordinates as geometry authority."
    : "No ORIGINAL context image is provided. Use visible cues in the EMPTY overlay image only."}

Highlighted segment metadata (normalized EMPTY image coordinates, 0–1). These endpoints match labels A and B in the EMPTY overlay:
${JSON.stringify(metadata)}

Hard limits:
- Estimate only the exact highlighted visible segment from A to B.
- Do not estimate full wall width.
- Do not estimate room width.
- Do not estimate room depth.
- Do not complete hidden geometry or extend beyond the highlighted endpoints.
- Do not infer continuation past A or B for any reason, including frame truncation, opening, occlusion, or an interior observed stop.
- Do not choose a different segment or seam.
- Do not move, extend, or snap the endpoints.
- Do not return endpoint coordinates, polylines, world coordinates, or an alternate seam.
- Do not return a completed wall, hidden continuation, Floor dimensions, canonical length, or a scale factor.
- Do not use image pixel length alone as a physical measurement.

Evidence:
- Use visible architectural, furniture, door, and window scale cues only.
- Every cue is a soft reference. Do not assume exact standard sizes.
- Uncertainty is acceptable. Prefer an honest range over a made-up number.
- Use one decimal metre. Prefer 2.4 over 2.4371. Avoid false precision.
- Ranges must reflect actual uncertainty: low ≤ best ≤ high, all positive.

Status:
- recoverable or usable: visible cues support an approximate physical length of this exact highlighted segment with an honest range.
- weak: some cues exist but the estimate is too uncertain for automatic use.
- not_recoverable: physical length of this highlighted segment cannot be estimated reliably. Prefer this over a made-up number. Return estimatedLengthM=null.

Return JSON matching the supplied schema.`;
}

function extractJson(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new ObservedSpanEstimateError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Observed-span estimator returned no response envelope.",
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
    throw new ObservedSpanEstimateError({
      failureClass: "provider_response",
      failureStage: "response_extraction",
      detail: "Observed-span estimator returned no JSON text.",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ObservedSpanEstimateError({
      failureClass: "json_parse",
      failureStage: "json_parse",
      detail: "Observed-span estimator candidate text was not valid JSON.",
    });
  }
}

async function callGeminiJson(args: {
  apiKey: string;
  model: string;
  prompt: string;
  emptyOverlayBase64: string;
  emptyMimeType: string;
  originalBase64: string | null;
  originalMimeType: string | null;
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
    const parts: unknown[] = [
      { text: args.prompt },
      { text: "PRIMARY: EMPTY_OVERLAY — highlighted observed wall segment only." },
      {
        inlineData: {
          mimeType: args.emptyMimeType,
          data: args.emptyOverlayBase64,
        },
      },
    ];
    if (args.originalBase64 && args.originalMimeType) {
      parts.push(
        { text: "CONTEXT: ORIGINAL_CONTEXT — unhighlighted physical-scale context only." },
        {
          inlineData: {
            mimeType: args.originalMimeType,
            data: args.originalBase64,
          },
        },
      );
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
              parts,
            }],
            generationConfig,
          }),
        },
      );
    } catch (error) {
      const timedOut = controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      throw new ObservedSpanEstimateError({
        failureClass: timedOut ? "timeout" : "transport",
        failureStage: "provider_invocation",
        detail: timedOut
          ? "Observed-span estimator request timed out."
          : `Observed-span estimator transport failed: ${safeDetail(error)}`,
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
      throw new ObservedSpanEstimateError({
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: providerDetail
          ? `Observed-span estimator HTTP ${response.status}: ${safeDetail(providerDetail)}`
          : `Observed-span estimator failed with HTTP ${response.status}.`,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ObservedSpanEstimateError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Observed-span estimator returned a non-JSON response content type.",
      });
    }
    try {
      return extractJson(JSON.parse(await response.text()));
    } catch (error) {
      if (error instanceof ObservedSpanEstimateError) throw error;
      throw new ObservedSpanEstimateError({
        failureClass: "provider_response",
        failureStage: "provider_response",
        providerStatus: response.status,
        detail: "Observed-span estimator returned an invalid JSON response envelope.",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function failureDiagnostic(args: {
  error: unknown;
  provider: ObservedSpanEstimateFailure["provider"];
  model: string;
}): ObservedSpanEstimateFailure {
  const error = args.error;
  return Object.freeze({
    failureClass: error instanceof ObservedSpanEstimateError
      ? error.failureClass
      : "unknown",
    failureStage: error instanceof ObservedSpanEstimateError
      ? error.failureStage
      : "provider_invocation",
    provider: args.provider,
    model: args.model,
    providerStatus: error instanceof ObservedSpanEstimateError
      ? error.providerStatus
      : null,
    safeDetail: safeDetail(error),
    contractValidationReason: error instanceof ObservedSpanEstimateError
      ? error.contractValidationReason
      : null,
  });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function identityMatches(
  bytes: Uint8Array,
  identity: ObservedSpanEstimateImageIdentity,
): boolean {
  return hash(bytes) === identity.sha256 &&
    bytes.byteLength === identity.byteCount &&
    identity.orientation === 1 &&
    identity.sha256.length === 64;
}

function lineageFrom(
  input: ObservedSpanPhysicalEstimateInput,
  overlaySha: string,
): ObservedSpanEstimateLineage {
  return Object.freeze({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    s4aCandidateId: input.candidate.lineage.s4aCandidateId,
    sourceSeamId: input.candidate.lineage.sourceSeamId,
    observationSource: input.candidate.lineage.observationSource,
    emptySha256: input.empty.identity.sha256,
    emptyByteCount: input.empty.identity.byteCount,
    emptyDecodedWidth: input.empty.identity.decodedWidth,
    emptyDecodedHeight: input.empty.identity.decodedHeight,
    originalSha256: input.original?.identity.sha256 ?? null,
    floorAuthorityKey: input.floorAuthorityKey,
    freezeReceiptVersion: input.freezeReceiptVersion,
    freezePayloadSha256: input.freezePayloadSha256,
    emptyNormalizedA: Object.freeze({
      x: input.candidate.imageA.x,
      y: input.candidate.imageA.y,
    }),
    emptyNormalizedB: Object.freeze({
      x: input.candidate.imageB.x,
      y: input.candidate.imageB.y,
    }),
    canonicalWorldA: Object.freeze({ ...input.candidate.canonicalWorldA }),
    canonicalWorldB: Object.freeze({ ...input.candidate.canonicalWorldB }),
    canonicalLength: input.candidate.canonicalLength,
    highlightedImageKind: AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND,
    overlayRasterSha256: overlaySha,
    promptVersion: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION,
    schemaVersion: "afc-v2-observed-span-physical-estimate/v1",
    junctionProofType: input.candidate.junction?.type ?? "none",
    junctionMateCandidateId: input.candidate.junction?.mateCandidateId ?? null,
    junctionMateSourceSeamId: input.candidate.junction?.mateSourceSeamId ?? null,
  });
}

export async function estimateObservedSpanPhysicalLength(
  input: ObservedSpanPhysicalEstimateInput,
  dependencies: Readonly<{
    model?: string;
    apiKey?: string;
    callProvider?: (args: {
      prompt: string;
      emptyOverlayBase64: string;
      emptyMimeType: string;
      originalBase64: string | null;
      originalMimeType: string | null;
      responseSchema: unknown;
      model: string;
    }) => Promise<unknown>;
    fetch?: typeof fetch;
    composeOverlay?: (
      args: {
        originalBytes: Uint8Array;
        imageA: ObservedSpanMetricCandidate["imageA"];
        imageB: ObservedSpanMetricCandidate["imageB"];
        width: number;
        height: number;
        format?: "png" | "jpeg";
        caption?: string;
      },
    ) => Promise<MetricCorrespondenceOverlayResult | null>;
  }> = {},
): Promise<ObservedSpanPhysicalEstimateReceipt> {
  const model = dependencies.model?.trim() ||
    process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_DEFAULT_MODEL;
  const provider = dependencies.callProvider
    ? "controlled_fixture" as const
    : "google_gemini" as const;
  const originalIncluded = Boolean(input.original);
  const fail = (
    diagnostic: ObservedSpanEstimateFailure,
    overlayImageHash = "",
    forbidden = false,
  ) =>
    buildObservedSpanPhysicalEstimateReceipt({
      lineage: lineageFrom(input, overlayImageHash),
      contextImageKind: originalIncluded
        ? AFC_V2_OBSERVED_SPAN_CONTEXT_IMAGE_KIND
        : null,
      overlayImageHash,
      provider,
      model,
      estimate: null,
      hostAcceptance: unavailableObservedSpanEstimateAcceptance([
        diagnostic.contractValidationReason ?? diagnostic.failureClass,
        diagnostic.safeDetail,
      ].filter(Boolean)),
      failure: diagnostic,
      originalIncludedAsUnhighlightedContext: originalIncluded,
      forbiddenGeometryFieldsPresent: forbidden,
    });

  if (!identityMatches(input.empty.bytes, input.empty.identity)) {
    return fail(Object.freeze({
      failureClass: "basis_validation",
      failureStage: "basis_validation",
      provider,
      model,
      providerStatus: null,
      safeDetail: "EMPTY bytes did not match the attempt-bound EMPTY identity.",
      contractValidationReason: "empty_identity_mismatch",
    }));
  }
  if (
    input.original &&
    !identityMatches(input.original.bytes, input.original.identity)
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
      safeDetail: "Observed-span estimator provider credentials are unavailable.",
      contractValidationReason: null,
    }));
  }

  const compose = dependencies.composeOverlay ?? composeMetricCorrespondenceOverlay;
  let overlay: MetricCorrespondenceOverlayResult | null = null;
  try {
    overlay = await compose({
      originalBytes: input.empty.bytes,
      imageA: input.candidate.imageA,
      imageB: input.candidate.imageB,
      width: input.empty.identity.decodedWidth,
      height: input.empty.identity.decodedHeight,
      format: "jpeg",
      caption: OBSERVED_SPAN_OVERLAY_CAPTION,
    });
  } catch (error) {
    return fail(Object.freeze({
      failureClass: "overlay_generation",
      failureStage: "overlay_generation",
      provider,
      model,
      providerStatus: null,
      safeDetail: `Observed-span overlay generation failed: ${safeDetail(error)}`,
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
      safeDetail: "Observed-span overlay generation returned no raster.",
      contractValidationReason: "overlay_generation_failed",
    }));
  }

  const metadata = observedSpanProviderSegmentMetadata(input.candidate);
  const prompt = observedSpanPhysicalEstimatorPrompt(metadata, originalIncluded);
  const emptyOverlayBase64 = Buffer.from(overlay.bytes).toString("base64");
  const originalBase64 = input.original
    ? Buffer.from(input.original.bytes).toString("base64")
    : null;
  try {
    const raw = dependencies.callProvider
      ? await dependencies.callProvider({
        prompt,
        emptyOverlayBase64,
        emptyMimeType: overlay.mimeType,
        originalBase64,
        originalMimeType: input.original?.identity.mimeType ?? null,
        responseSchema: RESPONSE_SCHEMA,
        model,
      })
      : await withGeminiUsageAccounting(
        {
          attemptId: input.attemptId,
          provider: "google_gemini",
          model,
          workflowType: "afc-v2-observed-span-physical-estimate",
          actionType: "estimate-observed-span-physical-length",
          route: "/api/admin/3d-room-lab-v2/analyze",
          service: "roomprintz-ui",
          sourceTrigger: "admin_3d_room_lab_v2",
          imageCount: originalIncluded ? 2 : 1,
          metadata: {
            promptVersion: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION,
            representation: AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND,
            authority: "physical_estimate_only",
            s4aCandidateId: input.candidate.id,
            cameraAuthorityConsumed: false,
            floorAuthorityConsumed: false,
          },
        },
        () =>
          callGeminiJson({
            apiKey: apiKey!,
            model,
            prompt,
            emptyOverlayBase64,
            emptyMimeType: overlay.mimeType,
            originalBase64,
            originalMimeType: input.original?.identity.mimeType ?? null,
            fetch: dependencies.fetch ?? fetch,
          }),
      );
    const parsed = parseObservedSpanPhysicalEstimate(raw);
    if (!parsed.ok) {
      throw new ObservedSpanEstimateError({
        failureClass: "contract_validation",
        failureStage: "contract_validation",
        detail: "Observed-span estimate failed the contract.",
        contractValidationReason: parsed.reason,
      });
    }
    const lineage = lineageFrom(input, overlay.sha256);
    return buildObservedSpanPhysicalEstimateReceipt({
      lineage,
      contextImageKind: originalIncluded
        ? AFC_V2_OBSERVED_SPAN_CONTEXT_IMAGE_KIND
        : null,
      overlayImageHash: overlay.sha256,
      provider,
      model,
      estimate: parsed.estimate,
      hostAcceptance: acceptObservedSpanPhysicalEstimate(parsed.estimate, {
        candidate: input.candidate,
        lineage,
        current: {
          s4aCandidateId: input.candidate.lineage.s4aCandidateId,
          sourceSeamId: input.candidate.lineage.sourceSeamId,
          emptySha256: input.empty.identity.sha256,
          originalSha256: input.original?.identity.sha256 ?? null,
          floorAuthorityKey: input.floorAuthorityKey,
          canonicalLength: input.candidate.canonicalLength,
          freezeReceiptVersion: input.freezeReceiptVersion,
          freezePayloadSha256: input.freezePayloadSha256,
          candidateStillEligible: true,
        },
        originalWasIncluded: originalIncluded,
      }),
      failure: null,
      originalIncludedAsUnhighlightedContext: originalIncluded,
      forbiddenGeometryFieldsPresent: false,
    });
  } catch (error) {
    const diagnostic = failureDiagnostic({ error, provider, model });
    console.error("[afc-v2-observed-span-physical-estimate] failed", diagnostic);
    return fail(
      diagnostic,
      overlay.sha256,
      diagnostic.contractValidationReason === "forbidden_geometry_authority_fields",
    );
  }
}
