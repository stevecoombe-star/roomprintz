import "server-only";

import {
  buildAfcSr1GeminiEndpoint,
  buildAfcSr1GeminiRequestPayload,
  compileAfcSr1GeminiResponseJsonSchema,
  digestAfcSr1ProviderRequest,
  extractAfcSr1GeminiCandidate,
  validateAfcSr1ProviderExecutionProfile,
  type AfcSr1ProviderExecutionProfileV1,
} from "./afc-sr1-gemini-adapter";
import {
  buildAfcSr1ExecutionReceipt,
  buildAfcSr1RawProviderEvidence,
  reenterAfcSr1P0,
  type AfcSr1ExecutionReceiptV1,
  type AfcSr1RawProviderEvidenceBytesV1,
} from "./afc-sr1-provider-replay";
import {
  validateAfcSr1RequestPackageReplay,
  type AfcSr1RequestPackageEvidenceBytesV1,
  type AfcSr1RequestPackageV1,
} from "./afc-sr1-request-package";
import type { AfcSr1ValidatedAdvisoryV1 } from "./afc-sr1-semantic-prior";

export type AfcSr1ProviderExecutionFailureV1 =
  | Readonly<{
      stage: "pre_execution";
      class: "package_invalid" | "package_stale" | "unsupported_visibility" | "provider_profile_invalid";
      reasonCode: string;
    }>
  | Readonly<{
      stage: "transport";
      class: "timeout" | "network_error" | "http_error";
      reasonCode: string;
      httpStatus?: number;
    }>
  | Readonly<{
      stage: "provider";
      class: "blocked" | "empty_candidates" | "malformed_envelope" | "unsupported_finish_reason" | "candidates_ambiguous";
      reasonCode: string;
    }>
  | Readonly<{
      stage: "extraction";
      class: "no_text" | "multiple_text_parts" | "text_part_ambiguous" | "invalid_json";
      reasonCode: string;
    }>
  | Readonly<{
      stage: "semantic";
      class: "hard_invalid" | "stale";
      reasonCode: string;
    }>;

export type AfcSr1ProviderExecutionResultV1 =
  | Readonly<{
      status: "validated_advisory";
      advisory: AfcSr1ValidatedAdvisoryV1;
      receipt: AfcSr1ExecutionReceiptV1;
      rawEvidence: AfcSr1RawProviderEvidenceBytesV1;
    }>
  | Readonly<{
      status: "failed";
      failure: AfcSr1ProviderExecutionFailureV1;
      receipt: AfcSr1ExecutionReceiptV1 | null;
      rawEvidence: AfcSr1RawProviderEvidenceBytesV1 | null;
    }>;

export type AfcSr1ProviderFetch = typeof fetch;

const DEFAULT_TIMEOUT_MS = 15_000;

function preExecutionFailure(
  failure: Extract<AfcSr1ProviderExecutionFailureV1, { stage: "pre_execution" }>
): AfcSr1ProviderExecutionResultV1 {
  return Object.freeze({ status: "failed", failure, receipt: null, rawEvidence: null });
}

function capturedFailure(input: Readonly<{
  failure: AfcSr1ProviderExecutionFailureV1;
  requestPackage: AfcSr1RequestPackageV1;
  profile: AfcSr1ProviderExecutionProfileV1;
  providerRequestDigest: string;
  rawEvidence: AfcSr1RawProviderEvidenceBytesV1;
  extraction?: ReturnType<typeof extractAfcSr1GeminiCandidate> | null;
  p0?: ReturnType<typeof reenterAfcSr1P0> | null;
}>): AfcSr1ProviderExecutionResultV1 {
  return Object.freeze({
    status: "failed",
    failure: input.failure,
    receipt: buildAfcSr1ExecutionReceipt({
      requestPackage: input.requestPackage,
      profile: input.profile,
      providerRequestDigest: input.providerRequestDigest,
      rawEvidence: input.rawEvidence,
      extraction: input.extraction ?? null,
      p0: input.p0 ?? null,
    }),
    rawEvidence: input.rawEvidence,
  });
}

/**
 * Explicitly gated server-only research execution. Timeout remains transport
 * metadata rather than profile identity because it changes no provider input.
 */
export async function runAfcSr1SemanticPriorResearch(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  evidenceBytes: AfcSr1RequestPackageEvidenceBytesV1;
  profile: AfcSr1ProviderExecutionProfileV1;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: AfcSr1ProviderFetch;
  executeLiveProviderCall: true;
}>): Promise<AfcSr1ProviderExecutionResultV1> {
  if (input.executeLiveProviderCall !== true) {
    return preExecutionFailure(Object.freeze({
      stage: "pre_execution", class: "package_invalid", reasonCode: "live_execution_acknowledgement_required",
    }));
  }
  const packageReplay = await validateAfcSr1RequestPackageReplay({
    requestPackage: input.requestPackage,
    evidenceBytes: input.evidenceBytes,
  });
  if (!packageReplay.ok) {
    const failureClass = packageReplay.failureClass === "unsupported_visibility"
      ? "unsupported_visibility"
      : packageReplay.failureClass === "hard_invalid" ? "package_invalid" : "package_stale";
    return preExecutionFailure(Object.freeze({
      stage: "pre_execution", class: failureClass, reasonCode: packageReplay.reasonCode,
    }));
  }
  try {
    validateAfcSr1ProviderExecutionProfile(input.profile);
  } catch {
    return preExecutionFailure(Object.freeze({
      stage: "pre_execution", class: "provider_profile_invalid", reasonCode: "provider_profile_invalid",
    }));
  }
  if (typeof input.apiKey !== "string" || input.apiKey.length === 0) {
    return preExecutionFailure(Object.freeze({
      stage: "pre_execution", class: "provider_profile_invalid", reasonCode: "api_key_invalid",
    }));
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return preExecutionFailure(Object.freeze({
      stage: "pre_execution", class: "provider_profile_invalid", reasonCode: "timeout_invalid",
    }));
  }
  const responseJsonSchema = compileAfcSr1GeminiResponseJsonSchema(
    input.requestPackage.artifact.responseContract
  );
  const providerRequestDigest = digestAfcSr1ProviderRequest({
    requestPackage: input.requestPackage,
    profile: input.profile,
    responseJsonSchema,
  });
  const payload = buildAfcSr1GeminiRequestPayload({
    requestPackage: input.requestPackage,
    evidenceBytes: input.evidenceBytes,
    profile: input.profile,
  });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? globalThis.fetch)(
      buildAfcSr1GeminiEndpoint(input.profile.model, input.apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
  } catch {
    clearTimeout(timer);
    return Object.freeze({
      status: "failed",
      failure: Object.freeze({
        stage: "transport",
        class: timedOut || controller.signal.aborted ? "timeout" : "network_error",
        reasonCode: timedOut || controller.signal.aborted ? "provider_timeout" : "provider_network_error",
      }),
      receipt: null,
      rawEvidence: null,
    });
  }
  clearTimeout(timer);
  let rawResponseBytes: Uint8Array;
  try {
    rawResponseBytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return Object.freeze({
      status: "failed",
      failure: Object.freeze({
        stage: "transport", class: "network_error", reasonCode: "provider_response_body_unreadable",
      }),
      receipt: null,
      rawEvidence: null,
    });
  }
  const rawEvidence = buildAfcSr1RawProviderEvidence({
    httpStatus: response.status,
    rawResponseBytes,
  });
  if (!response.ok) {
    return capturedFailure({
      failure: Object.freeze({
        stage: "transport", class: "http_error", reasonCode: "provider_http_error", httpStatus: response.status,
      }),
      requestPackage: input.requestPackage,
      profile: input.profile,
      providerRequestDigest,
      rawEvidence,
    });
  }
  const extraction = extractAfcSr1GeminiCandidate(rawEvidence.rawResponseBytes);
  if (!extraction.ok) {
    const stage = ["blocked", "empty_candidates", "malformed_envelope", "unsupported_finish_reason", "candidates_ambiguous"]
      .includes(extraction.class) ? "provider" : "extraction";
    return capturedFailure({
      failure: Object.freeze({ stage, class: extraction.class, reasonCode: extraction.reasonCode }) as AfcSr1ProviderExecutionFailureV1,
      requestPackage: input.requestPackage,
      profile: input.profile,
      providerRequestDigest,
      rawEvidence,
      extraction,
    });
  }
  const p0 = reenterAfcSr1P0({
    requestPackage: input.requestPackage,
    candidateText: extraction.candidateText,
  });
  if (p0.kind === "invalid_json") {
    return capturedFailure({
      failure: Object.freeze({ stage: "extraction", class: "invalid_json", reasonCode: p0.reasonCode }),
      requestPackage: input.requestPackage,
      profile: input.profile,
      providerRequestDigest,
      rawEvidence,
      extraction,
      p0,
    });
  }
  if (p0.kind === "semantic_failure") {
    return capturedFailure({
      failure: Object.freeze({ stage: "semantic", class: p0.failureClass, reasonCode: p0.reasonCode }),
      requestPackage: input.requestPackage,
      profile: input.profile,
      providerRequestDigest,
      rawEvidence,
      extraction,
      p0,
    });
  }
  const receipt = buildAfcSr1ExecutionReceipt({
    requestPackage: input.requestPackage,
    profile: input.profile,
    providerRequestDigest,
    rawEvidence,
    extraction,
    p0,
  });
  return Object.freeze({
    status: "validated_advisory",
    advisory: p0.advisory,
    receipt,
    rawEvidence,
  });
}
