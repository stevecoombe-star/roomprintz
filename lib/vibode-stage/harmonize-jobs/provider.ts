import { classifyNanoBananaProAspectRatio } from "@/lib/afc-image-models";
import { readPngSize } from "@/lib/vibode-stage/harmonize-export";
import {
  HarmonizeNbpProofError,
  callHarmonizeNbpProof,
} from "@/lib/vibode-stage/harmonize-nbp-proof";

import { createHarmonizeFakeJpeg } from "./fake-jpeg";
import { redactHarmonizeDiagnostic } from "./redaction";

const REJECTED_HTTP = new Set([400, 401, 403, 413, 422]);

export type HarmonizeProviderSuccess = Readonly<{
  output: Uint8Array;
  outputMime: string;
  returnedModel: string | null;
  providerStatus: string | null;
  httpStatus: number;
  latencyMs: number;
}>;

export type HarmonizeProvider = (input: Readonly<{
  prompt: string;
  png: Uint8Array;
  signal: AbortSignal;
}>) => Promise<HarmonizeProviderSuccess>;

export type HarmonizeProviderFailure = Readonly<{
  code: "provider_rejected" | "provider_uncertain";
  message: string;
  providerStatus: string | null;
  providerHttpStatus: number | null;
  retryable: false;
}>;

export function classifyHarmonizeProviderFailure(error: unknown): HarmonizeProviderFailure {
  if (error instanceof HarmonizeNbpProofError) {
    const rejected = error.code === "provider_http"
      && error.httpStatus != null
      && REJECTED_HTTP.has(error.httpStatus);
    return {
      code: rejected ? "provider_rejected" : "provider_uncertain",
      message: redactHarmonizeDiagnostic(error.message),
      providerStatus: error.providerStatus,
      providerHttpStatus: error.httpStatus,
      retryable: false,
    };
  }
  const message = error instanceof Error ? error.message : "Provider request failed.";
  return {
    code: "provider_uncertain",
    message: redactHarmonizeDiagnostic(message),
    providerStatus: null,
    providerHttpStatus: null,
    retryable: false,
  };
}

export type HarmonizeWorkerProviderMode = "google" | "fake";

/**
 * Worker process setting. A browser request cannot select this.
 * Fake mode starts only when the provider is explicitly `fake`,
 * NODE_ENV is set to something other than production, and
 * VIBODE_HARMONIZE_ALLOW_FAKE is exactly `1`. Any miss refuses startup.
 * Unset provider stays on the real Nano Banana Pro client.
 */
export function readHarmonizeWorkerProviderMode(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<{ ok: true; mode: HarmonizeWorkerProviderMode }> | Readonly<{ ok: false; code: "fake_forbidden" | "invalid_provider" }> {
  const requested = env.VIBODE_HARMONIZE_PROVIDER?.trim().toLowerCase() ?? "";
  if (requested === "" || requested === "google") return { ok: true, mode: "google" };
  if (requested !== "fake") return { ok: false, code: "invalid_provider" };
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase() ?? "";
  const allowFake = env.VIBODE_HARMONIZE_ALLOW_FAKE?.trim() ?? "";
  if (!nodeEnv || nodeEnv === "production" || allowFake !== "1") {
    return { ok: false, code: "fake_forbidden" };
  }
  return { ok: true, mode: "fake" };
}

/**
 * Deterministic labeled JPEG for the composite's ratio family.
 * The output size is twice the documented 1K grid. For 4:3 that is the
 * verified 2400×1792 frame. The other sizes are fixtures, not verified
 * provider dimensions. This function does not call a network.
 */
export function createHarmonizeFakeProvider(): HarmonizeProvider {
  return async ({ png, signal }) => {
    if (signal.aborted) {
      throw new HarmonizeNbpProofError("timeout", "Fake Harmonize provider aborted before a result.");
    }
    const measured = readPngSize(png);
    const classified = measured
      ? classifyNanoBananaProAspectRatio(measured.width, measured.height)
      : null;
    if (!measured || !classified?.ok) {
      throw new HarmonizeNbpProofError(
        "invalid_package",
        "B-stage-composite.png is outside the supported Nano Banana Pro aspect ratios.",
      );
    }
    const output = await createHarmonizeFakeJpeg(classified.gridWidth * 2, classified.gridHeight * 2);
    if (signal.aborted) {
      throw new HarmonizeNbpProofError("timeout", "Fake Harmonize provider aborted before a result.");
    }
    return {
      output,
      outputMime: "image/jpeg",
      returnedModel: "fake-harmonize",
      providerStatus: "FAKE",
      httpStatus: 200,
      latencyMs: 1,
    };
  };
}

/** The verified Interactions request. One create. */
export function createHarmonizeNbpProvider(input: Readonly<{
  apiKey: string;
  fetchImpl?: typeof fetch;
}>): HarmonizeProvider {
  return async ({ prompt, png, signal }) => {
    const result = await callHarmonizeNbpProof({
      prompt,
      png,
      apiKey: input.apiKey,
      fetchImpl: (url, init) => {
        if (signal.aborted) {
          throw new HarmonizeNbpProofError("timeout", "Nano Banana Pro did not finish before the timeout.");
        }
        const timeoutSignal = init?.signal;
        const combined = timeoutSignal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal ?? signal;
        return (input.fetchImpl ?? fetch)(url, { ...init, signal: combined });
      },
    });
    return {
      output: result.output,
      outputMime: result.outputMime,
      returnedModel: result.returnedModel,
      providerStatus: result.providerStatus,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
    };
  };
}
