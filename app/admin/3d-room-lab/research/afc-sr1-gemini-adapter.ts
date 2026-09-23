import { createHash } from "node:crypto";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  validateAfcSr1ResponseContractDocument,
  type AfcSr1ResponseContractDocumentV1,
} from "./afc-sr1-semantic-prior-prompt";
import {
  validateAfcSr1ProviderNeutralRequestArtifact,
  type AfcSr1RequestPackageV1,
  type AfcSr1RequestPackageEvidenceBytesV1,
} from "./afc-sr1-request-package";

export const AFC_SR1_PROVIDER_EXECUTION_PROFILE_VERSION =
  "afc-sr1-provider-execution-profile/v1" as const;
export const AFC_SR1_GEMINI_ADAPTER_VERSION =
  "afc-sr1-gemini-adapter/v1" as const;
export const AFC_SR1_PROVIDER_REQUEST_DIGEST_VERSION =
  "afc-sr1-provider-request-digest/v1" as const;
export const AFC_SR1_ENVELOPE_EXTRACTION_POLICY_VERSION =
  "afc-sr1-envelope-extraction/exactly-one-candidate-one-text-part-optional-thought-signature/v1" as const;

export type AfcSr1ProviderExecutionProfileV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_PROVIDER_EXECUTION_PROFILE_VERSION;
  provider: "google_gemini";
  adapterVersion: typeof AFC_SR1_GEMINI_ADAPTER_VERSION;
  model: string;
  candidateCount: 1;
  temperature: 0;
  maxOutputTokens: 2048;
  responseMimeType: "application/json";
  thinkingPolicy: "minimal_for_gemini_3_5_flash_only/v1";
  retryPolicy: "single_attempt/v1";
}>;

export type AfcSr1GeminiResponseJsonSchemaV1 = Readonly<Record<string, unknown>>;

export type AfcSr1ProviderRequestDigestPreimageV1 = Readonly<{
  digestSchemaVersion: typeof AFC_SR1_PROVIDER_REQUEST_DIGEST_VERSION;
  adapterVersion: typeof AFC_SR1_GEMINI_ADAPTER_VERSION;
  packageDigest: string;
  provider: "google_gemini";
  model: string;
  profileDigest: string;
  responseJsonSchemaDigest: string;
  promptSha256: string;
  compositePngSha256: string;
  candidateCount: 1;
  providerImagePolicy: "composite_only/v1";
}>;

export type AfcSr1GeminiRequestPayloadV1 = Readonly<{
  contents: readonly [Readonly<{
    role: "user";
    parts: readonly [
      Readonly<{ text: string }>,
      Readonly<{ inlineData: Readonly<{ mimeType: "image/png"; data: string }> }>,
    ];
  }>];
  generationConfig: Readonly<{
    temperature: 0;
    maxOutputTokens: 2048;
    candidateCount: 1;
    responseMimeType: "application/json";
    responseJsonSchema: AfcSr1GeminiResponseJsonSchemaV1;
    thinkingConfig?: Readonly<{ thinkingLevel: "minimal" }>;
  }>;
}>;

export type AfcSr1CandidateExtractionV1 =
  | Readonly<{
      ok: true;
      candidateIndex: 0;
      candidateText: string;
      candidateTextSha256: string;
      candidateTextUtf8ByteCount: number;
      finishReason: string;
      providerModelVersion: string | null;
      usageMetadata: Record<string, unknown> | null;
    }>
  | Readonly<{
      ok: false;
      class:
        | "blocked"
        | "empty_candidates"
        | "malformed_envelope"
        | "unsupported_finish_reason"
        | "candidates_ambiguous"
        | "no_text"
        | "multiple_text_parts"
        | "text_part_ambiguous";
      reasonCode: string;
      candidateIndex: 0 | null;
      finishReason: string | null;
      providerModelVersion: string | null;
      usageMetadata: Record<string, unknown> | null;
    }>;

type AfcSr1CandidateFailureClass =
  | "blocked"
  | "empty_candidates"
  | "malformed_envelope"
  | "unsupported_finish_reason"
  | "candidates_ambiguous"
  | "no_text"
  | "multiple_text_parts"
  | "text_part_ambiguous";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function byteSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isGemini35FlashModel(model: string): boolean {
  return /(?:^|\/)gemini-3\.5-flash$/i.test(model);
}

function metadata(envelope: Record<string, unknown>, candidate: Record<string, unknown> | null) {
  return {
    candidateIndex: candidate?.index === 0 ? 0 as const : null,
    finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : null,
    providerModelVersion: typeof envelope.modelVersion === "string" ? envelope.modelVersion : null,
    usageMetadata: plain(envelope.usageMetadata) ? Object.freeze({ ...envelope.usageMetadata }) : null,
  };
}

function extractionFailure(
  envelope: Record<string, unknown>,
  candidate: Record<string, unknown> | null,
  failure: AfcSr1CandidateFailureClass,
  reasonCode: string,
): AfcSr1CandidateExtractionV1 {
  return Object.freeze({ ok: false, class: failure, reasonCode, ...metadata(envelope, candidate) });
}

export function validateAfcSr1ProviderExecutionProfile(
  profile: unknown
): asserts profile is AfcSr1ProviderExecutionProfileV1 {
  const keys = [
    "schemaVersion", "provider", "adapterVersion", "model", "candidateCount",
    "temperature", "maxOutputTokens", "responseMimeType", "thinkingPolicy", "retryPolicy",
  ];
  if (!plain(profile) || !exactKeys(profile, keys) ||
      profile.schemaVersion !== AFC_SR1_PROVIDER_EXECUTION_PROFILE_VERSION ||
      profile.provider !== "google_gemini" ||
      profile.adapterVersion !== AFC_SR1_GEMINI_ADAPTER_VERSION ||
      typeof profile.model !== "string" || profile.model.length === 0 ||
      profile.model !== profile.model.trim() || /[\r\n]/.test(profile.model) ||
      profile.candidateCount !== 1 || profile.temperature !== 0 ||
      profile.maxOutputTokens !== 2048 || profile.responseMimeType !== "application/json" ||
      profile.thinkingPolicy !== "minimal_for_gemini_3_5_flash_only/v1" ||
      profile.retryPolicy !== "single_attempt/v1") {
    throw new TypeError("AFC-SR1 provider profile: invalid");
  }
}

export function digestAfcSr1ProviderExecutionProfile(
  profile: AfcSr1ProviderExecutionProfileV1
): string {
  validateAfcSr1ProviderExecutionProfile(profile);
  return `sr1prof1:${sha256HexUtf8(canonicalizeRfc8785Jcs(profile))}`;
}

/**
 * The P1 response contract is the only schema source. This is intentionally a
 * syntactic Gemini constraint; P0 remains the semantic authority.
 */
export function compileAfcSr1GeminiResponseJsonSchema(
  contract: AfcSr1ResponseContractDocumentV1
): AfcSr1GeminiResponseJsonSchemaV1 {
  validateAfcSr1ResponseContractDocument(contract);
  const rankedItem = {
    type: "object",
    properties: {
      hypothesis: { type: "string", enum: [...contract.hypotheses] },
      score: { type: "number", minimum: contract.rankingRules.scoreMin, maximum: contract.rankingRules.scoreMax },
    },
    required: ["hypothesis", "score"],
    propertyOrdering: ["hypothesis", "score"],
    additionalProperties: false,
  };
  const seam = {
    type: "object",
    properties: {
      adjustableCorner: { type: "string", enum: ["NL", "NR"] },
      preferredSeamT: { anyOf: [{ type: "number", minimum: contract.seamTPriorRules.min, maximum: contract.seamTPriorRules.max }, { type: "null" }] },
      minSeamT: { type: "number", minimum: contract.seamTPriorRules.min, maximum: contract.seamTPriorRules.max },
      maxSeamT: { type: "number", minimum: contract.seamTPriorRules.min, maximum: contract.seamTPriorRules.max },
    },
    required: ["adjustableCorner", "preferredSeamT", "minSeamT", "maxSeamT"],
    propertyOrdering: ["adjustableCorner", "preferredSeamT", "minSeamT", "maxSeamT"],
    additionalProperties: false,
  };
  return Object.freeze({
    type: "object",
    properties: {
      schemaVersion: { type: "string", enum: [contract.responseSchemaVersion] },
      bindingEcho: { type: "string" },
      decision: { type: "string", enum: [...contract.allowedDecisions] },
      rankedHypotheses: {
        anyOf: [
          { type: "array", items: rankedItem, minItems: contract.rankingRules.exactHypothesisCount, maxItems: contract.rankingRules.exactHypothesisCount },
          { type: "null" },
        ],
      },
      seamTPrior: { anyOf: [seam, { type: "null" }] },
      semanticLabels: { type: "array", items: { type: "string", enum: [...contract.semanticLabels] } },
    },
    required: [...contract.allowedKeys],
    propertyOrdering: [...contract.allowedKeys],
    additionalProperties: false,
  });
}

export function digestAfcSr1GeminiResponseJsonSchema(schema: AfcSr1GeminiResponseJsonSchemaV1): string {
  return sha256HexUtf8(canonicalizeRfc8785Jcs(schema));
}

export function buildAfcSr1GeminiRequestPayload(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  evidenceBytes: AfcSr1RequestPackageEvidenceBytesV1;
  profile: AfcSr1ProviderExecutionProfileV1;
}>): AfcSr1GeminiRequestPayloadV1 {
  validateAfcSr1ProviderExecutionProfile(input.profile);
  validateAfcSr1ProviderNeutralRequestArtifact(input.requestPackage.artifact);
  const artifact = input.requestPackage.artifact;
  if (artifact.providerImagePolicy !== "composite_only/v1" ||
      byteSha256(input.evidenceBytes.compositePngBytes) !== artifact.compositeImage.compositePngSha256) {
    throw new TypeError("AFC-SR1 Gemini adapter: composite evidence invalid");
  }
  const generationConfig: AfcSr1GeminiRequestPayloadV1["generationConfig"] = {
    temperature: 0,
    maxOutputTokens: 2048,
    candidateCount: 1,
    responseMimeType: "application/json",
    responseJsonSchema: compileAfcSr1GeminiResponseJsonSchema(artifact.responseContract),
    ...(isGemini35FlashModel(input.profile.model)
      ? { thinkingConfig: Object.freeze({ thinkingLevel: "minimal" as const }) }
      : {}),
  };
  return Object.freeze({
    contents: Object.freeze([Object.freeze({
      role: "user",
      parts: Object.freeze([
        Object.freeze({ text: artifact.prompt.promptText }),
        Object.freeze({ inlineData: Object.freeze({
          mimeType: "image/png" as const,
          data: Buffer.from(input.evidenceBytes.compositePngBytes).toString("base64"),
        }) }),
      ]) as AfcSr1GeminiRequestPayloadV1["contents"][0]["parts"],
    })]) as AfcSr1GeminiRequestPayloadV1["contents"],
    generationConfig: Object.freeze(generationConfig),
  });
}

export function buildAfcSr1ProviderRequestDigestPreimage(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  profile: AfcSr1ProviderExecutionProfileV1;
  responseJsonSchema: AfcSr1GeminiResponseJsonSchemaV1;
}>): AfcSr1ProviderRequestDigestPreimageV1 {
  validateAfcSr1ProviderExecutionProfile(input.profile);
  validateAfcSr1ProviderNeutralRequestArtifact(input.requestPackage.artifact);
  const artifact = input.requestPackage.artifact;
  if (!/^sr1pkg1:[0-9a-f]{64}$/.test(input.requestPackage.packageDigest) ||
      !SHA256_HEX.test(artifact.prompt.promptSha256) ||
      !SHA256_HEX.test(artifact.compositeImage.compositePngSha256)) {
    throw new TypeError("AFC-SR1 provider request: package identity invalid");
  }
  return Object.freeze({
    digestSchemaVersion: AFC_SR1_PROVIDER_REQUEST_DIGEST_VERSION,
    adapterVersion: AFC_SR1_GEMINI_ADAPTER_VERSION,
    packageDigest: input.requestPackage.packageDigest,
    provider: "google_gemini",
    model: input.profile.model,
    profileDigest: digestAfcSr1ProviderExecutionProfile(input.profile),
    responseJsonSchemaDigest: digestAfcSr1GeminiResponseJsonSchema(input.responseJsonSchema),
    promptSha256: artifact.prompt.promptSha256,
    compositePngSha256: artifact.compositeImage.compositePngSha256,
    candidateCount: 1,
    providerImagePolicy: "composite_only/v1",
  });
}

export function digestAfcSr1ProviderRequest(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  profile: AfcSr1ProviderExecutionProfileV1;
  responseJsonSchema: AfcSr1GeminiResponseJsonSchemaV1;
}>): string {
  return `sr1prvreq1:${sha256HexUtf8(canonicalizeRfc8785Jcs(
    buildAfcSr1ProviderRequestDigestPreimage(input)
  ))}`;
}

export function buildAfcSr1GeminiEndpoint(model: string, apiKey: string): string {
  validateAfcSr1ProviderExecutionProfile({
    schemaVersion: AFC_SR1_PROVIDER_EXECUTION_PROFILE_VERSION,
    provider: "google_gemini",
    adapterVersion: AFC_SR1_GEMINI_ADAPTER_VERSION,
    model,
    candidateCount: 1,
    temperature: 0,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
    thinkingPolicy: "minimal_for_gemini_3_5_flash_only/v1",
    retryPolicy: "single_attempt/v1",
  });
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new TypeError("AFC-SR1 Gemini adapter: api key invalid");
  }
  return `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export function extractAfcSr1GeminiCandidate(rawResponseBytes: Uint8Array): AfcSr1CandidateExtractionV1 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(rawResponseBytes).toString("utf8"));
  } catch {
    return Object.freeze({
      ok: false, class: "malformed_envelope", reasonCode: "envelope_invalid_json",
      candidateIndex: null, finishReason: null, providerModelVersion: null, usageMetadata: null,
    });
  }
  if (!plain(decoded) || !Array.isArray(decoded.candidates)) {
    return Object.freeze({
      ok: false, class: "malformed_envelope", reasonCode: "candidates_missing_or_invalid",
      candidateIndex: null, finishReason: null,
      providerModelVersion: plain(decoded) && typeof decoded.modelVersion === "string" ? decoded.modelVersion : null,
      usageMetadata: plain(decoded) && plain(decoded.usageMetadata) ? Object.freeze({ ...decoded.usageMetadata }) : null,
    });
  }
  if (decoded.candidates.length === 0) return extractionFailure(decoded, null, "empty_candidates", "candidates_empty");
  if (decoded.candidates.length !== 1) return extractionFailure(decoded, null, "candidates_ambiguous", "candidates_not_exactly_one");
  if (!plain(decoded.candidates[0])) return extractionFailure(decoded, null, "malformed_envelope", "candidate_invalid");
  const candidate = decoded.candidates[0];
  if (candidate.index !== 0) return extractionFailure(decoded, candidate, "malformed_envelope", "candidate_index_not_zero");
  if (candidate.finishReason !== "STOP") {
    const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : null;
    return extractionFailure(
      decoded,
      candidate,
      finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "BLOCKLIST" || finishReason === "PROHIBITED_CONTENT"
        ? "blocked" : "unsupported_finish_reason",
      finishReason === null ? "finish_reason_missing" : `finish_reason_${finishReason.toLowerCase()}`,
    );
  }
  if (!plain(candidate.content) || !exactKeys(candidate.content, ["role", "parts"]) ||
      candidate.content.role !== "model" || !Array.isArray(candidate.content.parts)) {
    return extractionFailure(decoded, candidate, "malformed_envelope", "candidate_content_invalid");
  }
  if (candidate.content.parts.length === 0) return extractionFailure(decoded, candidate, "no_text", "text_part_missing");
  if (candidate.content.parts.length !== 1) return extractionFailure(decoded, candidate, "multiple_text_parts", "text_parts_not_exactly_one");
  const part = candidate.content.parts[0];
  if (!plain(part) || !Object.hasOwn(part, "text") ||
      Object.keys(part).some(key => key !== "text" && key !== "thoughtSignature") ||
      (Object.hasOwn(part, "thoughtSignature") && typeof part.thoughtSignature !== "string")) {
    return extractionFailure(decoded, candidate, "text_part_ambiguous", "text_part_shape_invalid");
  }
  if (typeof part.text !== "string" || part.text.length === 0 || part.text.trim().length === 0) {
    return extractionFailure(decoded, candidate, "no_text", "text_empty_or_invalid");
  }
  return Object.freeze({
    ok: true,
    candidateIndex: 0,
    candidateText: part.text,
    candidateTextSha256: sha256HexUtf8(part.text),
    candidateTextUtf8ByteCount: Buffer.byteLength(part.text, "utf8"),
    finishReason: "STOP",
    providerModelVersion: typeof decoded.modelVersion === "string" ? decoded.modelVersion : null,
    usageMetadata: plain(decoded.usageMetadata) ? Object.freeze({ ...decoded.usageMetadata }) : null,
  });
}
