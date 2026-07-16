import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionApiKey,
  isAutoFloorVisionAllowLocalhostHttp,
  getAutoFloorVisionGeminiTimeoutMs,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getAutoFloorVisionModel,
  isAutoFloorVisionDebugLog,
  isAutoFloorVisionEnabled,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";
import { fetchRoomImageSafely, inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { detectFloorFromVerifiedBytes } from "@/lib/vibodeAutoFloorVisionDetect";
import { DEFAULT_AUTO_FLOOR_VISION_CONFIG } from "@/app/admin/3d-room-lab/auto-floor-vision-provider-scaffold";
import type { AutoFloorDetectionResult } from "@/app/admin/3d-room-lab/auto-floor-detection";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import {
  prepareDetectVisionGeminiEvidenceIdentityV1,
  prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1,
  shouldMintGeminiEvidenceDetectVisionIdentityV1,
  shouldPersistGeminiEvidenceDetectVisionInvocationV1,
} from "@/app/admin/3d-room-lab/gemini-evidence-producer-receipts";
import { persistDetectVisionGeminiEvidenceInvocationEnvelopeV1 } from "@/app/admin/3d-room-lab/gemini-evidence-detect-vision-invocation-persistence";

// --- Phase 2F-F: lab-only, flag-gated REAL Gemini vision floor route ---------
// POST /api/admin/3d-room-lab/auto-floor/detect-vision
//
// Hard gates (fail closed on every error):
// - authenticated admin only
// - AUTO_FLOOR_VISION_ENABLED must be truthy (server-only)
// - server-only Gemini key required
// - SSRF-hardened image fetch (now shared via lib/vibodeAutoFloorImageFetch)
//
// Phase 2H-B refactor: the SSRF fetch + decoded-metadata verification and the
// Gemini call + Phase 2F-B mapping are now shared helpers so the empty-room
// assist route reuses the exact same hardened implementation. Behavior and the
// fail-closed contract here are unchanged.

export const runtime = "nodejs";

const VISION_ROUTE = "/api/admin/3d-room-lab/auto-floor/detect-vision";
const MAX_CANDIDATES = 3;
const DEFAULT_FLOOR_RECT = { widthMeters: 4, depthMeters: 4 };

// Logs ONLY derived/sanitized metadata. Never logs API keys, image bytes/base64,
// full image URLs/query strings, prompts, or raw model responses.
function logVisionFailure(fields: Record<string, unknown>): void {
  console.warn("[auto-floor-vision] failure", fields);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSize(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return { width: value.width, height: value.height };
}

function parseFloorRect(value: unknown): { widthMeters: number; depthMeters: number } {
  if (!isRecord(value)) return DEFAULT_FLOOR_RECT;
  if (!isFiniteNumber(value.widthMeters) || !isFiniteNumber(value.depthMeters)) return DEFAULT_FLOOR_RECT;
  if (value.widthMeters <= 0 || value.depthMeters <= 0) return DEFAULT_FLOOR_RECT;
  return { widthMeters: value.widthMeters, depthMeters: value.depthMeters };
}

function failed(reason: string): AutoFloorDetectionResult {
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: [],
    failureReasons: [reason],
  };
}

function failedWithBasis(
  reason: string,
  attestedBasisFingerprint: string | null
): AutoFloorDetectionResult {
  return {
    ...failed(reason),
    attestedBasisFingerprint,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) {
    return NextResponse.json(failed("Admin access required."), { status: 403 });
  }

  if (!isAutoFloorVisionEnabled()) {
    return NextResponse.json(
      failed("Gemini vision floor detection is disabled on the server."),
      { status: 200 }
    );
  }

  const apiKey = getAutoFloorVisionApiKey();
  if (!apiKey) {
    return NextResponse.json(failed("Server is not configured with a Gemini API key."), { status: 200 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failed("Request body was not valid JSON."), { status: 200 });
  }

  const record = isRecord(body) ? body : {};
  const requestId = getRequestIdFromHeaders(request.headers, "auto-floor-vision");
  const imageUrl = safeStr(record.imageUrl);
  const frameSize = parseSize(record.frameSize);
  // Accept either intrinsicSize or sourceSize for the original-image dimensions.
  const intrinsicSize = parseSize(record.intrinsicSize) ?? parseSize(record.sourceSize);
  const floorRect = parseFloorRect(record.floorRect);
  const expectedBasisFingerprint = safeStr(record.expectedBasisFingerprint);

  if (!frameSize) {
    return NextResponse.json(failed("Missing or invalid frame size."), { status: 200 });
  }
  if (!intrinsicSize) {
    return NextResponse.json(failed("Missing or invalid intrinsic/source image size."), { status: 200 });
  }
  if (!imageUrl) {
    return NextResponse.json(failed("Missing image URL."), { status: 200 });
  }
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    // The lab is URL-only today; data/blob inputs are not supported this phase.
    return NextResponse.json(
      failed("Inline (data/blob) images are not supported by the vision route."),
      { status: 200 }
    );
  }

  const image = await fetchRoomImageSafely(imageUrl, {
    allowedHosts: getAutoFloorVisionAllowedImageHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  });
  if (!image.ok) {
    logVisionFailure({ requestId, route: VISION_ROUTE, stage: "fetch", reason: image.reason });
    return NextResponse.json(failedWithBasis(image.reason, null), { status: 200 });
  }
  const attestedBasisFingerprint = computeCalibrationImageFingerprint(image.buffer);
  if (expectedBasisFingerprint && expectedBasisFingerprint !== attestedBasisFingerprint) {
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      stage: "basis_attestation",
      reason: "basis_fingerprint_mismatch",
    });
    return NextResponse.json(
      failedWithBasis("basis_fingerprint_mismatch", attestedBasisFingerprint),
      { status: 200 }
    );
  }

  // Verify the decoded bytes describe the same coordinate system as the client
  // intrinsicSize used for source->container conversion. The exact original
  // bytes are still what Gemini receives (image.base64 is unchanged).
  const meta = await inspectImageMetadata(image.buffer);
  if (!meta.ok) {
    logVisionFailure({ requestId, route: VISION_ROUTE, stage: "image_verify", reason: "decode_failed" });
    return NextResponse.json(failed(meta.reason), { status: 200 });
  }
  if (meta.orientation !== 1) {
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      stage: "image_verify",
      reason: "non_normal_orientation",
      orientation: meta.orientation,
    });
    return NextResponse.json(
      failedWithBasis("This image orientation is not yet supported for vision calibration.", attestedBasisFingerprint),
      { status: 200 }
    );
  }
  if (meta.width !== intrinsicSize.width || meta.height !== intrinsicSize.height) {
    logVisionFailure({ requestId, route: VISION_ROUTE, stage: "image_verify", reason: "dimension_mismatch" });
    return NextResponse.json(
      failedWithBasis("Room image dimensions changed before vision calibration could run.", attestedBasisFingerprint),
      { status: 200 }
    );
  }

  const verifiedSourceSize = { width: meta.width, height: meta.height };
  const model = getAutoFloorVisionModel();

  // GER-W3B.2 — Default-off producer identity minting at the outbound boundary.
  // Per W3A correction R-3, identity is minted ONLY here: after every local
  // preflight refusal point (admin gate, feature flag, API key, body/URL
  // validation, SSRF fetch, basis attestation, decode + dimension checks) and
  // immediately before the outbound Gemini call. Entropy seeds are produced only
  // on the enabled branch and are never derived from requestId, roomId, assetId,
  // versionId, the scene hash, the image URL, frame size, or any other input.
  // When the flag is disabled (default), no seeds are generated and the
  // accounting object is byte-identical to prior route behavior.
  const baseAccounting = {
    requestId,
    route: VISION_ROUTE,
    userId: adminUser.id ?? null,
  };
  let accounting: typeof baseAccounting & { attemptId?: string } = baseAccounting;
  if (
    shouldMintGeminiEvidenceDetectVisionIdentityV1({
      enabled: process.env.GER_DETECT_VISION_IDENTITY_ENABLED,
    })
  ) {
    const identity = prepareDetectVisionGeminiEvidenceIdentityV1({
      enabled: true,
      requestId,
      createdAtIso: new Date().toISOString(),
      entropySeeds: {
        receiptSeed: randomUUID(),
        logicalSeed: randomUUID(),
        attemptSeed: randomUUID(),
      },
    });
    if (identity.status === "error") {
      // Fail closed: with identity enabled we never call Gemini with a missing
      // or malformed attemptId. Return the same style of safe failed result.
      logVisionFailure({
        requestId,
        route: VISION_ROUTE,
        stage: "identity_mint",
        reason: identity.reason,
      });
      return NextResponse.json(
        failedWithBasis(
          "Vision calibration identity could not be prepared.",
          attestedBasisFingerprint
        ),
        { status: 200 }
      );
    }
    if (identity.status === "minted") {
      // GER-W3B.3 — Construct the gemini_invocation receipt + W1 envelope from
      // the SAME minted identity, immediately before the outbound Gemini call.
      // This proves a valid, ledger-shaped invocation can be built at this
      // boundary. The constructed value is used ONLY to decide continuation and
      // (when the SEPARATE W3B.4 persistence flag below is enabled) as the sole
      // argument handed to the server-only persistence helper. It is otherwise
      // NOT logged verbatim, returned in the response body, or retained: the
      // invocation is not persisted unless the separate W3B.4 persistence flag
      // (GER_DETECT_VISION_INVOCATION_LEDGER_WRITE_ENABLED) is explicitly
      // enabled.
      const invocation = prepareDetectVisionGeminiEvidenceInvocationEnvelopeV1({
        identity: identity.identity,
      });
      if (invocation.status === "error") {
        // Fail closed: with identity enabled we never call Gemini when the
        // invocation envelope cannot be constructed. Return the same style of
        // safe failed result as the other preflight refusals.
        logVisionFailure({
          requestId,
          route: VISION_ROUTE,
          stage: "invocation_construction",
          reason: invocation.reason,
        });
        return NextResponse.json(
          failedWithBasis(
            "Vision calibration invocation could not be prepared.",
            attestedBasisFingerprint
          ),
          { status: 200 }
        );
      }

      // GER-W3B.4 — Default-off persistence of the constructed gemini_invocation
      // envelope into the W2D ledger, gated behind a SEPARATE server-side flag
      // (GER_DETECT_VISION_INVOCATION_LEDGER_WRITE_ENABLED) from the identity
      // flag. When this flag is disabled or absent, no persistence helper is
      // called, no service client is constructed, no row is inserted, and the
      // unchanged W3B.3 route path proceeds. When enabled, the write happens
      // AFTER successful invocation construction and BEFORE the outbound Gemini
      // call. This slice records ONLY the invocation envelope: it captures no
      // provider response, no raw response text, and retains no artifact. The
      // route imports no Supabase / service-client symbol — it delegates to the
      // server-only helper, which is the ONLY consumer of the built envelope.
      if (
        shouldPersistGeminiEvidenceDetectVisionInvocationV1({
          enabled: process.env.GER_DETECT_VISION_INVOCATION_LEDGER_WRITE_ENABLED,
        })
      ) {
        const persistence =
          await persistDetectVisionGeminiEvidenceInvocationEnvelopeV1({
            envelope: invocation.envelope,
            createdAt: new Date().toISOString(),
          });
        if (persistence.status === "error") {
          // Fail closed: with persistence enabled we never call Gemini when the
          // invocation could not be recorded in the ledger. Only safe metadata
          // is logged (never the receipt, envelope body, row, or raw text).
          logVisionFailure({
            requestId,
            route: VISION_ROUTE,
            stage: "invocation_persistence",
            reason: persistence.reason,
          });
          return NextResponse.json(
            failedWithBasis(
              "Vision calibration invocation could not be recorded.",
              attestedBasisFingerprint
            ),
            { status: 200 }
          );
        }
      }

      accounting = {
        ...baseAccounting,
        attemptId: identity.identity.providerAttemptId,
      };
    }
  }

  const outcome = await detectFloorFromVerifiedBytes({
    apiKey,
    model,
    image: { base64: image.base64, mime: image.mime, byteCount: image.byteCount },
    sourceSize: verifiedSourceSize,
    frameSize,
    floorRect,
    maxCandidates: MAX_CANDIDATES,
    timeoutMs: getAutoFloorVisionGeminiTimeoutMs(),
    accounting,
  });

  if (!outcome.ok && outcome.failureKind === "gemini") {
    const info = outcome.info;
    const baseLog: Record<string, unknown> = {
      requestId,
      route: VISION_ROUTE,
      model,
      latencyMs: Date.now() - startedAt,
      stage: info.stage,
      code: info.code,
      httpStatus: info.httpStatus,
      upstreamStatus: info.upstreamStatus,
      upstreamMessage: info.sanitizedMessage,
      imageMime: image.mime,
      imageBytes: image.byteCount,
      schemaSent: true,
      configuredThinkingLevel: DEFAULT_AUTO_FLOOR_VISION_CONFIG.thinkingLevel ?? null,
      configuredMaxOutputTokens: DEFAULT_AUTO_FLOOR_VISION_CONFIG.maxOutputTokens,
    };
    if (
      isAutoFloorVisionDebugLog() &&
      (info.stage === "json_parse" || info.stage === "response_extraction")
    ) {
      logVisionFailure({
        ...baseLog,
        finishReason: info.diagnostics?.finishReason ?? null,
        topLevelKeys: info.diagnostics?.topLevelKeys ?? null,
        candidateCount: info.diagnostics?.candidateCount ?? null,
        contentPartCount: info.diagnostics?.contentPartCount ?? null,
        hadThoughtPart: info.diagnostics?.hadThoughtPart ?? null,
        hasTextPart: info.diagnostics?.hasTextPart ?? null,
        usedDirectTextField: info.diagnostics?.usedDirectTextField ?? null,
        extractedTextLength: info.diagnostics?.extractedTextLength ?? null,
        textExcerpt: info.debugExcerpt ?? null,
      });
    } else {
      logVisionFailure(baseLog);
    }
    return NextResponse.json(failedWithBasis(info.uiReason, attestedBasisFingerprint), { status: 200 });
  }

  if (!outcome.ok && outcome.failureKind === "mapping") {
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      model,
      latencyMs: Date.now() - startedAt,
      stage: "phase_2fb_mapping",
      message: outcome.message,
    });
    return NextResponse.json({ ...outcome.result, attestedBasisFingerprint }, { status: 200 });
  }

  if (!outcome.ok) {
    // Exhaustiveness guard.
    return NextResponse.json(failedWithBasis("Failed to process vision response.", attestedBasisFingerprint), { status: 200 });
  }

  const result = outcome.result;
  if (result.status === "failed") {
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      model,
      latencyMs: Date.now() - startedAt,
      stage: "phase_2fb_mapping",
      candidateCount: result.candidates.length,
      failureReasons: result.failureReasons,
    });
  }

  const selected = result.candidates.find((c) => c.id === result.selectedCandidateId) ?? null;
  console.log("[auto-floor-vision] completed", {
    requestId,
    model,
    latencyMs: Date.now() - startedAt,
    imageHost: image.host,
    imageMime: image.mime,
    imageBytes: image.byteCount,
    configuredThinkingLevel: DEFAULT_AUTO_FLOOR_VISION_CONFIG.thinkingLevel ?? null,
    configuredMaxOutputTokens: DEFAULT_AUTO_FLOOR_VISION_CONFIG.maxOutputTokens,
    finishReason: outcome.meta.finishReason,
    candidatesTokenCount: outcome.meta.candidatesTokenCount,
    thoughtsTokenCount: outcome.meta.thoughtsTokenCount,
    candidateCount: result.candidates.length,
    status: result.status,
    selectedConfidence: selected?.confidence ?? null,
    selectedScore: selected?.confidenceScore ?? null,
  });

  return NextResponse.json({ ...result, attestedBasisFingerprint }, { status: 200 });
}
