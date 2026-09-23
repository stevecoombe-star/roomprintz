import { createHash } from "node:crypto";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  compileAfcSr1GeminiResponseJsonSchema,
  digestAfcSr1ProviderExecutionProfile,
  digestAfcSr1ProviderRequest,
  extractAfcSr1GeminiCandidate,
  validateAfcSr1ProviderExecutionProfile,
  type AfcSr1CandidateExtractionV1,
  type AfcSr1ProviderExecutionProfileV1,
} from "./afc-sr1-gemini-adapter";
import {
  parseAfcSr1SemanticPriorResponse,
  validateAfcSr1SemanticPriorResponse,
  type AfcSr1SemanticPriorResponseV1,
  type AfcSr1ValidatedAdvisoryV1,
} from "./afc-sr1-semantic-prior";
import {
  validateAfcSr1RequestPackageReplay,
  type AfcSr1RequestPackageEvidenceBytesV1,
  type AfcSr1RequestPackageV1,
} from "./afc-sr1-request-package";

export const AFC_SR1_RAW_PROVIDER_RESPONSE_VERSION =
  "afc-sr1-raw-provider-response/v1" as const;
export const AFC_SR1_EXECUTION_RECEIPT_VERSION =
  "afc-sr1-execution-receipt/v1" as const;
export const AFC_SR1_EXECUTION_RECEIPT_DIGEST_VERSION =
  "afc-sr1-execution-receipt-digest/v1" as const;

export type AfcSr1RawProviderResponseV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_RAW_PROVIDER_RESPONSE_VERSION;
  provider: "google_gemini";
  httpStatus: number;
  rawBodySha256: string;
  rawBodyByteCount: number;
}>;

export type AfcSr1RawProviderEvidenceBytesV1 = Readonly<{
  rawResponseBytes: Uint8Array;
  rawResponse: AfcSr1RawProviderResponseV1;
}>;

export type AfcSr1ExecutionValidationOutcomeV1 =
  | "not_reached/v1"
  | `p0_hard_invalid/v1:${string}`
  | `p0_stale/v1:${string}`
  | `validated_advisory/v1:${string}`;

export type AfcSr1ExecutionReceiptV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_EXECUTION_RECEIPT_VERSION;
  packageDigest: string;
  seamBindingToken: string;
  providerRequestDigest: string;
  adapterVersion: "afc-sr1-gemini-adapter/v1";
  profileDigest: string;
  provider: "google_gemini";
  model: string;
  attemptIndex: 0;
  httpStatus: number;
  rawBodySha256: string;
  candidateIndex: 0 | null;
  candidateTextSha256: string | null;
  finishReason: string | null;
  parsedResponseDigest: string | null;
  validationOutcome: AfcSr1ExecutionValidationOutcomeV1;
  receiptDigest: string;
  providerModelVersion: string | null;
  usageMetadata: Record<string, unknown> | null;
}>;

export type AfcSr1ExecutionReceiptDigestPreimageV1 = Readonly<{
  digestSchemaVersion: typeof AFC_SR1_EXECUTION_RECEIPT_DIGEST_VERSION;
  schemaVersion: typeof AFC_SR1_EXECUTION_RECEIPT_VERSION;
  packageDigest: string;
  seamBindingToken: string;
  providerRequestDigest: string;
  adapterVersion: "afc-sr1-gemini-adapter/v1";
  profileDigest: string;
  provider: "google_gemini";
  model: string;
  attemptIndex: 0;
  httpStatus: number;
  rawBodySha256: string;
  candidateIndex: 0 | null;
  candidateTextSha256: string | null;
  finishReason: string | null;
  parsedResponseDigest: string | null;
  validationOutcome: AfcSr1ExecutionValidationOutcomeV1;
}>;

export type AfcSr1P0ReentryV1 =
  | Readonly<{
      kind: "validated_advisory";
      advisory: AfcSr1ValidatedAdvisoryV1;
      parsedResponse: AfcSr1SemanticPriorResponseV1;
      parsedResponseDigest: string;
      advisoryDigest: string;
      validationOutcome: AfcSr1ExecutionValidationOutcomeV1;
    }>
  | Readonly<{
      kind: "semantic_failure";
      failureClass: "hard_invalid" | "stale";
      reasonCode: string;
      parsedResponse: AfcSr1SemanticPriorResponseV1 | null;
      parsedResponseDigest: string | null;
      validationOutcome: AfcSr1ExecutionValidationOutcomeV1;
    }>
  | Readonly<{
      kind: "invalid_json";
      reasonCode: "candidate_text_invalid_json";
      parsedResponse: null;
      parsedResponseDigest: null;
      validationOutcome: "not_reached/v1";
    }>;

export type AfcSr1ProviderReplayResultV1 =
  | Readonly<{ ok: true; advisory: AfcSr1ValidatedAdvisoryV1 | null; receipt: AfcSr1ExecutionReceiptV1 }>
  | Readonly<{ ok: false; reasonCode: string }>;

function byteSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cloneMetadata(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value === null ? null : Object.freeze({ ...value });
}

function equalJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeRfc8785Jcs(left) === canonicalizeRfc8785Jcs(right);
  } catch {
    return false;
  }
}

export function buildAfcSr1RawProviderEvidence(input: Readonly<{
  httpStatus: number;
  rawResponseBytes: Uint8Array;
}>): AfcSr1RawProviderEvidenceBytesV1 {
  if (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599) {
    throw new TypeError("AFC-SR1 raw provider response: HTTP status invalid");
  }
  const rawResponseBytes = new Uint8Array(input.rawResponseBytes);
  return Object.freeze({
    rawResponseBytes,
    rawResponse: Object.freeze({
      schemaVersion: AFC_SR1_RAW_PROVIDER_RESPONSE_VERSION,
      provider: "google_gemini",
      httpStatus: input.httpStatus,
      rawBodySha256: byteSha256(rawResponseBytes),
      rawBodyByteCount: rawResponseBytes.byteLength,
    }),
  });
}

export function reenterAfcSr1P0(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  candidateText: string;
}>): AfcSr1P0ReentryV1 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.candidateText);
  } catch {
    return Object.freeze({
      kind: "invalid_json",
      reasonCode: "candidate_text_invalid_json",
      parsedResponse: null,
      parsedResponseDigest: null,
      validationOutcome: "not_reached/v1",
    });
  }
  const parsed = parseAfcSr1SemanticPriorResponse(decoded);
  if (!parsed.ok) {
    return Object.freeze({
      kind: "semantic_failure",
      failureClass: "hard_invalid",
      reasonCode: parsed.reasonCode,
      parsedResponse: null,
      parsedResponseDigest: null,
      validationOutcome: `p0_hard_invalid/v1:${parsed.reasonCode}`,
    });
  }
  const parsedResponseDigest = sha256HexUtf8(canonicalizeRfc8785Jcs(parsed.value));
  const artifact = input.requestPackage.artifact;
  const validation = validateAfcSr1SemanticPriorResponse({
    response: parsed.value,
    semanticPriorBinding: artifact.semanticPriorBinding,
    overlayDescriptor: artifact.overlayDescriptor,
    request: artifact.p0Request,
  });
  if (!validation.ok) {
    return Object.freeze({
      kind: "semantic_failure",
      failureClass: validation.failureClass,
      reasonCode: validation.reasonCode,
      parsedResponse: parsed.value,
      parsedResponseDigest,
      validationOutcome: `p0_${validation.failureClass}/v1:${validation.reasonCode}`,
    });
  }
  const advisoryDigest = sha256HexUtf8(canonicalizeRfc8785Jcs(validation.value));
  return Object.freeze({
    kind: "validated_advisory",
    advisory: validation.value,
    parsedResponse: parsed.value,
    parsedResponseDigest,
    advisoryDigest,
    validationOutcome: `validated_advisory/v1:${advisoryDigest}`,
  });
}

export function buildAfcSr1ExecutionReceiptDigestPreimage(
  receipt: Omit<AfcSr1ExecutionReceiptV1, "receiptDigest" | "providerModelVersion" | "usageMetadata">
): AfcSr1ExecutionReceiptDigestPreimageV1 {
  return Object.freeze({
    digestSchemaVersion: AFC_SR1_EXECUTION_RECEIPT_DIGEST_VERSION,
    schemaVersion: receipt.schemaVersion,
    packageDigest: receipt.packageDigest,
    seamBindingToken: receipt.seamBindingToken,
    providerRequestDigest: receipt.providerRequestDigest,
    adapterVersion: receipt.adapterVersion,
    profileDigest: receipt.profileDigest,
    provider: receipt.provider,
    model: receipt.model,
    attemptIndex: receipt.attemptIndex,
    httpStatus: receipt.httpStatus,
    rawBodySha256: receipt.rawBodySha256,
    candidateIndex: receipt.candidateIndex,
    candidateTextSha256: receipt.candidateTextSha256,
    finishReason: receipt.finishReason,
    parsedResponseDigest: receipt.parsedResponseDigest,
    validationOutcome: receipt.validationOutcome,
  });
}

export function digestAfcSr1ExecutionReceipt(
  receipt: Omit<AfcSr1ExecutionReceiptV1, "receiptDigest" | "providerModelVersion" | "usageMetadata">
): string {
  return `sr1exec1:${sha256HexUtf8(canonicalizeRfc8785Jcs(
    buildAfcSr1ExecutionReceiptDigestPreimage(receipt)
  ))}`;
}

export function buildAfcSr1ExecutionReceipt(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  profile: AfcSr1ProviderExecutionProfileV1;
  providerRequestDigest: string;
  rawEvidence: AfcSr1RawProviderEvidenceBytesV1;
  extraction: AfcSr1CandidateExtractionV1 | null;
  p0: AfcSr1P0ReentryV1 | null;
}>): AfcSr1ExecutionReceiptV1 {
  validateAfcSr1ProviderExecutionProfile(input.profile);
  const extraction = input.extraction;
  const base = {
    schemaVersion: AFC_SR1_EXECUTION_RECEIPT_VERSION,
    packageDigest: input.requestPackage.packageDigest,
    seamBindingToken: input.requestPackage.artifact.seamBindingToken,
    providerRequestDigest: input.providerRequestDigest,
    adapterVersion: "afc-sr1-gemini-adapter/v1" as const,
    profileDigest: digestAfcSr1ProviderExecutionProfile(input.profile),
    provider: "google_gemini" as const,
    model: input.profile.model,
    attemptIndex: 0 as const,
    httpStatus: input.rawEvidence.rawResponse.httpStatus,
    rawBodySha256: input.rawEvidence.rawResponse.rawBodySha256,
    candidateIndex: extraction?.candidateIndex ?? null,
    candidateTextSha256: extraction?.ok ? extraction.candidateTextSha256 : null,
    finishReason: extraction?.finishReason ?? null,
    parsedResponseDigest: input.p0?.parsedResponseDigest ?? null,
    validationOutcome: input.p0?.validationOutcome ?? "not_reached/v1" as AfcSr1ExecutionValidationOutcomeV1,
  };
  const receiptDigest = digestAfcSr1ExecutionReceipt(base);
  return Object.freeze({
    ...base,
    receiptDigest,
    providerModelVersion: extraction?.providerModelVersion ?? null,
    usageMetadata: cloneMetadata(extraction?.usageMetadata ?? null),
  });
}

function receiptMatches(expected: AfcSr1ExecutionReceiptV1, actual: AfcSr1ExecutionReceiptV1): boolean {
  return expected.schemaVersion === actual.schemaVersion &&
    expected.packageDigest === actual.packageDigest &&
    expected.seamBindingToken === actual.seamBindingToken &&
    expected.providerRequestDigest === actual.providerRequestDigest &&
    expected.adapterVersion === actual.adapterVersion &&
    expected.profileDigest === actual.profileDigest &&
    expected.provider === actual.provider &&
    expected.model === actual.model &&
    expected.attemptIndex === actual.attemptIndex &&
    expected.httpStatus === actual.httpStatus &&
    expected.rawBodySha256 === actual.rawBodySha256 &&
    expected.candidateIndex === actual.candidateIndex &&
    expected.candidateTextSha256 === actual.candidateTextSha256 &&
    expected.finishReason === actual.finishReason &&
    expected.parsedResponseDigest === actual.parsedResponseDigest &&
    expected.validationOutcome === actual.validationOutcome &&
    expected.receiptDigest === actual.receiptDigest &&
    expected.providerModelVersion === actual.providerModelVersion &&
    equalJson(expected.usageMetadata, actual.usageMetadata);
}

/**
 * Replays only captured bytes. It has no fetch dependency and never calls a
 * provider; success proves the recorded receipt still follows from evidence.
 */
export async function validateAfcSr1ProviderExecutionReplay(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  packageEvidence: AfcSr1RequestPackageEvidenceBytesV1;
  profile: AfcSr1ProviderExecutionProfileV1;
  providerRequestDigest: string;
  rawResponseBytes: Uint8Array;
  receipt: AfcSr1ExecutionReceiptV1;
}>): Promise<AfcSr1ProviderReplayResultV1> {
  const packageReplay = await validateAfcSr1RequestPackageReplay({
    requestPackage: input.requestPackage,
    evidenceBytes: input.packageEvidence,
  });
  if (!packageReplay.ok) return Object.freeze({ ok: false, reasonCode: `package_${packageReplay.failureClass}:${packageReplay.reasonCode}` });
  try {
    validateAfcSr1ProviderExecutionProfile(input.profile);
  } catch {
    return Object.freeze({ ok: false, reasonCode: "provider_profile_invalid" });
  }
  const schema = compileAfcSr1GeminiResponseJsonSchema(input.requestPackage.artifact.responseContract);
  const providerRequestDigest = digestAfcSr1ProviderRequest({
    requestPackage: input.requestPackage,
    profile: input.profile,
    responseJsonSchema: schema,
  });
  if (input.providerRequestDigest !== providerRequestDigest ||
      input.receipt.providerRequestDigest !== providerRequestDigest) {
    return Object.freeze({ ok: false, reasonCode: "provider_request_digest_mismatch" });
  }
  const rawEvidence = buildAfcSr1RawProviderEvidence({
    httpStatus: input.receipt.httpStatus,
    rawResponseBytes: input.rawResponseBytes,
  });
  if (rawEvidence.rawResponse.rawBodySha256 !== input.receipt.rawBodySha256) {
    return Object.freeze({ ok: false, reasonCode: "raw_body_digest_mismatch" });
  }
  let extraction: AfcSr1CandidateExtractionV1 | null = null;
  let p0: AfcSr1P0ReentryV1 | null = null;
  if (input.receipt.httpStatus >= 200 && input.receipt.httpStatus < 300) {
    extraction = extractAfcSr1GeminiCandidate(rawEvidence.rawResponseBytes);
    if (extraction.ok) p0 = reenterAfcSr1P0({
      requestPackage: input.requestPackage,
      candidateText: extraction.candidateText,
    });
  }
  const expected = buildAfcSr1ExecutionReceipt({
    requestPackage: input.requestPackage,
    profile: input.profile,
    providerRequestDigest,
    rawEvidence,
    extraction,
    p0,
  });
  if (!receiptMatches(expected, input.receipt)) {
    return Object.freeze({ ok: false, reasonCode: "receipt_or_replayed_evidence_mismatch" });
  }
  return Object.freeze({
    ok: true,
    advisory: p0?.kind === "validated_advisory" ? p0.advisory : null,
    receipt: expected,
  });
}
