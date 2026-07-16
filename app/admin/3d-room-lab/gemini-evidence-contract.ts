// GER-I0 — Deterministic Evidence Receipt Contract Kernel
//
// This module is a lab-only, deterministic, network-free fixture kernel that
// proves the closed GER-1C + GER-1D + GER-1E rules in pure TypeScript.
//
// It is intentionally self-contained. The ONLY runtime dependency is Node's
// built-in `crypto` for SHA-256. It imports no React, Next.js, routes,
// `server-only`, Supabase, Gemini code, filesystem code, or mutable global
// state. The nested "test-kernel" receipt shape here exists solely to make the
// contract fixtures explicit and is NOT the future persisted database or wire
// shape.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Section 3 — Closed receipt and digest vocabulary
// ---------------------------------------------------------------------------

export type GeminiEvidenceReceiptTypeV1 =
  | "gemini_invocation"
  | "gemini_provider_response"
  | "gemini_parsed_response"
  | "gemini_local_assessment"
  | "derivative_lineage"
  | "evidence_comparison"
  | "evidence_disposition"
  | "evidence_retention_tombstone";

export type ContentDigestScopeV1 =
  | "encoded-image-bytes/v1"
  | "raw-provider-response-text/v1"
  | "canonical-parsed-response-json/v1"
  | "rendered-prompt-text/v1"
  | "response-schema-json/v1"
  | "effective-generation-config-json/v1"
  | "canonical-invocation-payload-json/v1"
  | "render-coordinate-transform-json/v1"
  | "coordinate-transfer-transform-json/v1"
  | "storage-binding-json/v1"
  | "model-candidate-claim-json/v1"
  | "model-claim-text/v1"
  | "canonical-local-assessment-input-json/v1"
  | "canonical-local-assessment-output-json/v1"
  | "canonical-comparison-input-json/v1"
  | "canonical-comparison-output-json/v1"
  | "generation-request-json/v1"
  | "generation-result-json/v1"
  | "canonical-receipt-payload-json/v1";

export type ContentDigestV1 = {
  algorithm: "sha256";
  encoding: "hex";
  scope: ContentDigestScopeV1;
  value: string;
};

export const GEMINI_EVIDENCE_RECEIPT_TYPES: readonly GeminiEvidenceReceiptTypeV1[] =
  [
    "gemini_invocation",
    "gemini_provider_response",
    "gemini_parsed_response",
    "gemini_local_assessment",
    "derivative_lineage",
    "evidence_comparison",
    "evidence_disposition",
    "evidence_retention_tombstone",
  ] as const;

export const CONTENT_DIGEST_SCOPES: readonly ContentDigestScopeV1[] = [
  "encoded-image-bytes/v1",
  "raw-provider-response-text/v1",
  "canonical-parsed-response-json/v1",
  "rendered-prompt-text/v1",
  "response-schema-json/v1",
  "effective-generation-config-json/v1",
  "canonical-invocation-payload-json/v1",
  "render-coordinate-transform-json/v1",
  "coordinate-transfer-transform-json/v1",
  "storage-binding-json/v1",
  "model-candidate-claim-json/v1",
  "model-claim-text/v1",
  "canonical-local-assessment-input-json/v1",
  "canonical-local-assessment-output-json/v1",
  "canonical-comparison-input-json/v1",
  "canonical-comparison-output-json/v1",
  "generation-request-json/v1",
  "generation-result-json/v1",
  "canonical-receipt-payload-json/v1",
] as const;

const RECEIPT_TYPE_SET: ReadonlySet<string> = new Set(
  GEMINI_EVIDENCE_RECEIPT_TYPES
);
const DIGEST_SCOPE_SET: ReadonlySet<string> = new Set(CONTENT_DIGEST_SCOPES);

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function isGeminiEvidenceReceiptType(
  value: unknown
): value is GeminiEvidenceReceiptTypeV1 {
  return typeof value === "string" && RECEIPT_TYPE_SET.has(value);
}

export function isContentDigestScope(
  value: unknown
): value is ContentDigestScopeV1 {
  return typeof value === "string" && DIGEST_SCOPE_SET.has(value);
}

/**
 * Structural guard for a well-formed content digest. This checks shape and
 * hex format only; it deliberately does NOT verify that the hash matches any
 * content, and it never infers scope from value shape.
 */
export function isWellFormedContentDigest(
  value: unknown
): value is ContentDigestV1 {
  if (!isPlainObject(value)) return false;
  const d = value as Record<string, unknown>;
  return (
    d.algorithm === "sha256" &&
    d.encoding === "hex" &&
    isContentDigestScope(d.scope) &&
    typeof d.value === "string" &&
    SHA256_HEX_PATTERN.test(d.value)
  );
}

// ---------------------------------------------------------------------------
// Validation result vocabulary (matches the repo's { ok } convention)
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const OK: ValidationResult = { ok: true };
function fail(reason: string): ValidationResult {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Section 4 — Canonical JSON (RFC 8785 / JCS) and hashing
// ---------------------------------------------------------------------------

export const CANONICALIZATION_VERSION = "rfc8785-jcs/v1" as const;

/**
 * Error thrown when an input value is not part of the GER-I0 canonicalization
 * contract (a strict subset of RFC 8785 covering JSON-compatible values).
 */
export class CanonicalizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`GER-I0 canonicalization refused [${code}]: ${message}`);
    this.name = "CanonicalizationError";
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new CanonicalizationError(
      "non_finite_number",
      "NaN and Infinity are not permitted"
    );
  }
  // Serialize -0 as 0 per the GER-I0 contract.
  if (Object.is(n, -0)) return "0";
  // For finite numbers, JSON.stringify matches the ECMAScript Number->String
  // algorithm that RFC 8785 JCS number serialization is defined against.
  return JSON.stringify(n) as string;
}

function serializeValue(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return serializeNumber(value as number);

  if (t === "undefined") {
    throw new CanonicalizationError(
      "undefined_value",
      "undefined is not permitted anywhere in an input payload"
    );
  }
  if (t === "bigint") {
    throw new CanonicalizationError("unsupported_bigint", "bigint is not permitted");
  }
  if (t === "function") {
    throw new CanonicalizationError(
      "unsupported_function",
      "functions are not permitted"
    );
  }
  if (t === "symbol") {
    throw new CanonicalizationError("unsupported_symbol", "symbols are not permitted");
  }

  // typeof === "object" (and not null)
  if (Array.isArray(value)) {
    const parts = value.map((element) => serializeValue(element));
    return `[${parts.join(",")}]`;
  }

  if (!isPlainObject(value)) {
    // Rejects Date, Map, Set, typed arrays, RegExp, class instances, and any
    // other non-plain object. Scope is never inferred from these shapes.
    throw new CanonicalizationError(
      "non_plain_object",
      "only plain objects, arrays, and JSON primitives are permitted"
    );
  }

  // Sort own enumerable string keys by UTF-16 code units (the default JS
  // string comparison), matching RFC 8785 property ordering.
  const keys = Object.keys(value).sort();
  const members: string[] = [];
  for (const key of keys) {
    const child = value[key];
    if (typeof child === "undefined") {
      throw new CanonicalizationError(
        "undefined_value",
        `undefined value at key ${JSON.stringify(key)} is not permitted`
      );
    }
    members.push(`${JSON.stringify(key)}:${serializeValue(child)}`);
  }
  return `{${members.join(",")}}`;
}

/**
 * Canonicalize a JSON-compatible value into an RFC 8785 / JCS style string.
 * Narrow by design: valid JSON-compatible values only. Does not mutate input.
 */
export function canonicalizeRfc8785Jcs(value: unknown): string {
  return serializeValue(value);
}

export function sha256HexUtf8(input: string): string {
  return createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex");
}

export function digestCanonicalJson(
  scope: ContentDigestScopeV1,
  value: unknown
): ContentDigestV1 {
  if (!isContentDigestScope(scope)) {
    throw new CanonicalizationError(
      "unknown_digest_scope",
      `unknown digest scope: ${String(scope)}`
    );
  }
  const canonical = canonicalizeRfc8785Jcs(value);
  return {
    algorithm: "sha256",
    encoding: "hex",
    scope,
    value: sha256HexUtf8(canonical),
  };
}

/**
 * Synthetic typed digest for fixtures whose backing content is not modeled as
 * JSON (e.g. encoded image bytes, raw provider text). The scope is declared
 * explicitly by the caller and never inferred.
 */
export function makeSyntheticDigest(
  scope: ContentDigestScopeV1,
  seed: string
): ContentDigestV1 {
  if (!isContentDigestScope(scope)) {
    throw new CanonicalizationError(
      "unknown_digest_scope",
      `unknown digest scope: ${String(scope)}`
    );
  }
  return {
    algorithm: "sha256",
    encoding: "hex",
    scope,
    value: sha256HexUtf8(seed),
  };
}

// ---------------------------------------------------------------------------
// Section 5 — Field-to-required-scope bindings
// ---------------------------------------------------------------------------

export type TombstonedArtifactRole =
  | "raw_provider_response"
  | "parsed_response"
  | "encoded_image_bytes";

export type EvidenceDigestFieldKey =
  | "header.receiptDigest"
  | "receiptReference.receiptDigest"
  | "inputBasis.encodedBytesDigest"
  | "intrinsicToContainerTransformDigest"
  | "renderedPromptDigest"
  | "responseSchemaDigest"
  | "effectiveGenerationConfigDigest"
  | "invocationPayloadDigest"
  | "rawResponse.digest"
  | "rawResponse.storageBindingDigest"
  | "parsedResponseDigest"
  | "rawCandidateDigest"
  | "notesClaimDigest"
  | "risksClaimDigest"
  | "assessmentInputDigest"
  | "assessmentOutputDigest"
  | "transferTransformDigest"
  | "derivativeLineage.parentEncodedBytesDigest"
  | "derivativeLineage.derivativeEncodedBytesDigest"
  | "derivativeLineage.durableStorageBindingDigest"
  | "generation.requestDigest"
  | "generation.resultDigest"
  | "comparison.inputDigest"
  | "comparison.outputDigest"
  | "tombstone.originalDigest"
  | "tombstone.originalStorageBindingDigest"
  | "coordinateTransfer.sourceBasis.encodedBytesDigest"
  | "coordinateTransfer.destinationBasis.encodedBytesDigest";

export type EvidenceDigestFieldContext = {
  affectedArtifactRole?: TombstonedArtifactRole;
};

/**
 * The single immutable source of truth mapping every static digest field to
 * its required scope. Role-dependent fields (tombstone.originalDigest) are
 * intentionally absent here and resolved structurally by role instead.
 */
export const EVIDENCE_DIGEST_FIELD_SCOPES: Readonly<
  Record<
    Exclude<EvidenceDigestFieldKey, "tombstone.originalDigest">,
    ContentDigestScopeV1
  >
> = Object.freeze({
  "header.receiptDigest": "canonical-receipt-payload-json/v1",
  "receiptReference.receiptDigest": "canonical-receipt-payload-json/v1",
  "inputBasis.encodedBytesDigest": "encoded-image-bytes/v1",
  "intrinsicToContainerTransformDigest": "render-coordinate-transform-json/v1",
  "renderedPromptDigest": "rendered-prompt-text/v1",
  "responseSchemaDigest": "response-schema-json/v1",
  "effectiveGenerationConfigDigest": "effective-generation-config-json/v1",
  "invocationPayloadDigest": "canonical-invocation-payload-json/v1",
  "rawResponse.digest": "raw-provider-response-text/v1",
  "rawResponse.storageBindingDigest": "storage-binding-json/v1",
  "parsedResponseDigest": "canonical-parsed-response-json/v1",
  "rawCandidateDigest": "model-candidate-claim-json/v1",
  "notesClaimDigest": "model-claim-text/v1",
  "risksClaimDigest": "model-claim-text/v1",
  "assessmentInputDigest": "canonical-local-assessment-input-json/v1",
  "assessmentOutputDigest": "canonical-local-assessment-output-json/v1",
  "transferTransformDigest": "coordinate-transfer-transform-json/v1",
  "derivativeLineage.parentEncodedBytesDigest": "encoded-image-bytes/v1",
  "derivativeLineage.derivativeEncodedBytesDigest": "encoded-image-bytes/v1",
  "derivativeLineage.durableStorageBindingDigest": "storage-binding-json/v1",
  "generation.requestDigest": "generation-request-json/v1",
  "generation.resultDigest": "generation-result-json/v1",
  "comparison.inputDigest": "canonical-comparison-input-json/v1",
  "comparison.outputDigest": "canonical-comparison-output-json/v1",
  "tombstone.originalStorageBindingDigest": "storage-binding-json/v1",
  "coordinateTransfer.sourceBasis.encodedBytesDigest": "encoded-image-bytes/v1",
  "coordinateTransfer.destinationBasis.encodedBytesDigest":
    "encoded-image-bytes/v1",
});

const TOMBSTONE_ORIGINAL_DIGEST_SCOPE_BY_ROLE: Readonly<
  Record<TombstonedArtifactRole, ContentDigestScopeV1>
> = Object.freeze({
  raw_provider_response: "raw-provider-response-text/v1",
  parsed_response: "canonical-parsed-response-json/v1",
  encoded_image_bytes: "encoded-image-bytes/v1",
});

/**
 * Thrown when a required digest scope cannot be resolved for a field (e.g. an
 * unknown field key, or a role-dependent field without the role context).
 */
export class DigestFieldBindingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`GER-I0 digest-field binding error [${code}]: ${message}`);
    this.name = "DigestFieldBindingError";
    this.code = code;
  }
}

export function getRequiredDigestScope(
  field: EvidenceDigestFieldKey,
  context?: EvidenceDigestFieldContext
): ContentDigestScopeV1 {
  if (field === "tombstone.originalDigest") {
    const role = context?.affectedArtifactRole;
    // Own-property-safe: never resolve inherited keys like "constructor".
    if (
      typeof role !== "string" ||
      !Object.hasOwn(TOMBSTONE_ORIGINAL_DIGEST_SCOPE_BY_ROLE, role)
    ) {
      throw new DigestFieldBindingError(
        "missing_tombstone_role",
        "tombstone.originalDigest scope is role-dependent and requires affectedArtifactRole"
      );
    }
    return TOMBSTONE_ORIGINAL_DIGEST_SCOPE_BY_ROLE[role];
  }
  // Own-property-safe lookup so inherited keys such as "constructor" or
  // "__proto__" resolve to unknown_field instead of a prototype member.
  if (
    typeof field !== "string" ||
    !Object.hasOwn(EVIDENCE_DIGEST_FIELD_SCOPES, field)
  ) {
    throw new DigestFieldBindingError(
      "unknown_field",
      `no digest is permitted at unknown field: ${String(field)}`
    );
  }
  return EVIDENCE_DIGEST_FIELD_SCOPES[
    field as Exclude<EvidenceDigestFieldKey, "tombstone.originalDigest">
  ];
}

export function validateDigestForField(
  field: EvidenceDigestFieldKey,
  digest: ContentDigestV1 | null,
  context?: EvidenceDigestFieldContext
): ValidationResult {
  let requiredScope: ContentDigestScopeV1;
  try {
    requiredScope = getRequiredDigestScope(field, context);
  } catch (error) {
    if (error instanceof DigestFieldBindingError) {
      return fail(`digest_field_binding:${error.code}`);
    }
    throw error;
  }

  if (digest === null) {
    return fail("missing_required_digest");
  }
  if (!isWellFormedContentDigest(digest)) {
    // Covers correct-scope-but-bad-hash and any malformed digest object.
    return fail("malformed_content_digest");
  }
  if (digest.scope !== requiredScope) {
    return fail("wrong_digest_scope_for_field");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Section 6 — Minimal normalized receipt model + self-digest
// ---------------------------------------------------------------------------

export const RECEIPT_SCHEMA_VERSION = "gemini-evidence-contract/ger-i0/v1";

export type ReceiptAuthorityV1 = {
  effect: "none";
  mutationPermission: "none";
  calibrationApplyPermission: "none";
  reason: string;
};

export const GER_I0_ZERO_AUTHORITY: ReceiptAuthorityV1 = Object.freeze({
  effect: "none",
  mutationPermission: "none",
  calibrationApplyPermission: "none",
  reason: "GER-I0 fixture evidence has no calibration authority.",
});

/** Fields that must never appear in a fixture body: they imply authority. */
export const FORBIDDEN_AUTHORITY_FIELD_KEYS: readonly string[] = [
  "applyCamera",
  "calibrationAuthorityGranted",
  "calibratedCameraEligible",
  "preserveCalibration",
] as const;

export type ReceiptHeaderV1 = {
  schemaVersion: string;
  receiptId: string;
  receiptType: GeminiEvidenceReceiptTypeV1;
  createdAtIso: string;

  producer: {
    service: "roomprintz-ui";
    implementationCommit: string;
    canonicalizationVersion: "rfc8785-jcs/v1";
  };

  authority: ReceiptAuthorityV1;

  receiptDigest: ContentDigestV1;
};

export type ContractReceiptV1 = {
  header: ReceiptHeaderV1;
  body: Record<string, unknown>;
};

const PLACEHOLDER_RECEIPT_DIGEST: ContentDigestV1 = {
  algorithm: "sha256",
  encoding: "hex",
  scope: "canonical-receipt-payload-json/v1",
  value: "0".repeat(64),
};

/**
 * Compute the receipt self-digest. The complete receipt object is canonicalized
 * with ONLY receipt.header.receiptDigest omitted. No other field is omitted,
 * blanked, replaced, or normalized away.
 */
export function computeReceiptDigest(receipt: ContractReceiptV1): ContentDigestV1 {
  const { receiptDigest: _omitted, ...headerWithoutDigest } = receipt.header;
  void _omitted;
  const payload = {
    header: headerWithoutDigest,
    body: receipt.body,
  };
  return digestCanonicalJson("canonical-receipt-payload-json/v1", payload);
}

/** Return a NEW receipt whose header.receiptDigest is a valid self-digest. */
export function sealReceipt(
  receiptWithoutValidDigest: ContractReceiptV1
): ContractReceiptV1 {
  const digest = computeReceiptDigest(receiptWithoutValidDigest);
  return {
    header: {
      ...receiptWithoutValidDigest.header,
      receiptDigest: digest,
    },
    body: receiptWithoutValidDigest.body,
  };
}

export function verifyReceiptSelfDigest(
  receipt: ContractReceiptV1
): ValidationResult {
  const stored = receipt.header.receiptDigest;
  if (!isWellFormedContentDigest(stored)) {
    return fail("malformed_receipt_digest");
  }
  if (stored.scope !== "canonical-receipt-payload-json/v1") {
    return fail("receipt_digest_wrong_scope");
  }
  let recomputed: ContentDigestV1;
  try {
    recomputed = computeReceiptDigest(receipt);
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      return fail(`receipt_not_canonicalizable:${error.code}`);
    }
    throw error;
  }
  if (recomputed.value !== stored.value) {
    return fail("receipt_self_digest_mismatch");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Section 7 — References and zero authority
// ---------------------------------------------------------------------------

export type EvidenceReceiptReferenceV1 = {
  receiptId: string;
  receiptType: GeminiEvidenceReceiptTypeV1;
  receiptDigest: ContentDigestV1;
};

export type InvocationReceiptReferenceV1 = EvidenceReceiptReferenceV1 & {
  receiptType: "gemini_invocation";
};

export type LocalAssessmentReceiptReferenceV1 = EvidenceReceiptReferenceV1 & {
  receiptType: "gemini_local_assessment";
};

/**
 * Guard for a well-formed evidence receipt reference. This rejects
 * usage-accounting-shaped objects and any object that lacks the exact
 * reference shape and the required canonical-receipt-payload-json/v1 scope.
 */
export function isEvidenceReceiptReference(
  value: unknown
): value is EvidenceReceiptReferenceV1 {
  if (!isPlainObject(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.receiptId === "string" &&
    r.receiptId.length > 0 &&
    isGeminiEvidenceReceiptType(r.receiptType) &&
    isWellFormedContentDigest(r.receiptDigest) &&
    (r.receiptDigest as ContentDigestV1).scope ===
      "canonical-receipt-payload-json/v1"
  );
}

export function makeReceiptReference(
  receipt: ContractReceiptV1
): EvidenceReceiptReferenceV1 {
  return {
    receiptId: receipt.header.receiptId,
    receiptType: receipt.header.receiptType,
    receiptDigest: receipt.header.receiptDigest,
  };
}

export function makeInvocationReference(
  receipt: ContractReceiptV1
): InvocationReceiptReferenceV1 {
  if (receipt.header.receiptType !== "gemini_invocation") {
    throw new Error(
      "makeInvocationReference requires a gemini_invocation receipt"
    );
  }
  return {
    receiptId: receipt.header.receiptId,
    receiptType: "gemini_invocation",
    receiptDigest: receipt.header.receiptDigest,
  };
}

function scanForForbiddenAuthorityKeys(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const element of value) {
      const found = scanForForbiddenAuthorityKeys(element);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_AUTHORITY_FIELD_KEYS.includes(key)) return key;
      const found = scanForForbiddenAuthorityKeys(value[key]);
      if (found) return found;
    }
  }
  return null;
}

export function validateZeroAuthority(
  receipt: ContractReceiptV1
): ValidationResult {
  const authority = receipt.header.authority;
  if (!isPlainObject(authority)) {
    return fail("missing_authority_block");
  }
  if (
    authority.effect !== "none" ||
    authority.mutationPermission !== "none" ||
    authority.calibrationApplyPermission !== "none" ||
    authority.reason !== GER_I0_ZERO_AUTHORITY.reason
  ) {
    return fail("non_zero_authority");
  }
  const forbidden = scanForForbiddenAuthorityKeys(receipt.body);
  if (forbidden) {
    return fail(`forbidden_authority_field:${forbidden}`);
  }
  return OK;
}

/**
 * Validate a single reference against a set of receipts. Rejects unknown/wrong
 * types, wrong digest scope, missing/mismatched targets, and self-reference.
 */
export function validateReceiptReference(
  reference: unknown,
  options: {
    receiptsById: ReadonlyMap<string, ContractReceiptV1>;
    expectedType?: GeminiEvidenceReceiptTypeV1;
    referringReceiptId?: string;
  }
): ValidationResult {
  if (!isEvidenceReceiptReference(reference)) {
    return fail("invalid_reference_shape");
  }
  if (
    options.expectedType &&
    reference.receiptType !== options.expectedType
  ) {
    return fail("wrong_reference_type");
  }
  if (reference.receiptDigest.scope !== "canonical-receipt-payload-json/v1") {
    return fail("wrong_reference_digest_scope");
  }
  if (
    options.referringReceiptId &&
    reference.receiptId === options.referringReceiptId
  ) {
    return fail("self_reference");
  }
  const target = options.receiptsById.get(reference.receiptId);
  if (!target) {
    return fail("missing_referenced_receipt");
  }
  if (target.header.receiptId !== reference.receiptId) {
    return fail("referenced_receipt_id_mismatch");
  }
  if (target.header.receiptType !== reference.receiptType) {
    return fail("referenced_receipt_type_mismatch");
  }
  if (
    target.header.receiptDigest.value !== reference.receiptDigest.value ||
    target.header.receiptDigest.scope !== reference.receiptDigest.scope
  ) {
    return fail("referenced_receipt_digest_mismatch");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Section 8 — Retry-chain validation
// ---------------------------------------------------------------------------

export type InvocationRelationshipV1 =
  | "initial"
  | "provider_retry"
  | "operator_rerun";

export type InvocationIdentityV1 = {
  logicalInvocationId: string;
  requestId: string | null;
  providerAttemptId: string | null;
  relationship: InvocationRelationshipV1;
  retryOfProviderAttemptId: string | null;
};

export type InvocationPreflightV1 = {
  status: "passed" | "refused";
  outboundCallStatus: "not_sent" | "provider_call_started";
  refusalReasons: string[];
};

export type InvocationBodyV1 = {
  identity: InvocationIdentityV1;
  priorInvocationReceipt: InvocationReceiptReferenceV1 | null;
  preflight: InvocationPreflightV1;
};

function asInvocationBody(body: unknown): InvocationBodyV1 | null {
  if (!isPlainObject(body)) return null;
  const identity = body.identity;
  const preflight = body.preflight;
  if (!isPlainObject(identity) || !isPlainObject(preflight)) return null;
  if (
    typeof identity.logicalInvocationId !== "string" ||
    (identity.relationship !== "initial" &&
      identity.relationship !== "provider_retry" &&
      identity.relationship !== "operator_rerun")
  ) {
    return null;
  }
  return body as unknown as InvocationBodyV1;
}

function validatePreflightConsistency(
  identity: InvocationIdentityV1,
  preflight: InvocationPreflightV1
): ValidationResult {
  if (preflight.status === "refused") {
    if (preflight.outboundCallStatus !== "not_sent") {
      return fail("refusal_must_not_send");
    }
    if (identity.providerAttemptId !== null) {
      return fail("refusal_must_have_null_provider_attempt");
    }
    if (!Array.isArray(preflight.refusalReasons) ||
      preflight.refusalReasons.length === 0) {
      return fail("refusal_requires_reasons");
    }
    return OK;
  }
  // passed
  if (preflight.outboundCallStatus !== "provider_call_started") {
    return fail("passed_must_start_call");
  }
  if (identity.providerAttemptId === null) {
    return fail("passed_requires_provider_attempt");
  }
  return OK;
}

function validateInvocationIdentityShape(
  body: InvocationBodyV1
): ValidationResult {
  const { identity, preflight, priorInvocationReceipt } = body;

  switch (identity.relationship) {
    case "initial": {
      if (priorInvocationReceipt !== null) {
        return fail("initial_must_have_no_prior");
      }
      if (identity.retryOfProviderAttemptId !== null) {
        return fail("initial_must_have_no_retry_of");
      }
      return validatePreflightConsistency(identity, preflight);
    }
    case "operator_rerun": {
      if (priorInvocationReceipt !== null) {
        return fail("operator_rerun_must_have_no_prior");
      }
      if (identity.retryOfProviderAttemptId !== null) {
        return fail("operator_rerun_must_have_no_retry_of");
      }
      return validatePreflightConsistency(identity, preflight);
    }
    case "provider_retry": {
      if (identity.providerAttemptId === null) {
        return fail("provider_retry_requires_provider_attempt");
      }
      if (identity.retryOfProviderAttemptId === null) {
        return fail("provider_retry_requires_retry_of");
      }
      if (priorInvocationReceipt === null) {
        return fail("provider_retry_missing_prior_reference");
      }
      return validatePreflightConsistency(identity, preflight);
    }
    default:
      return fail("unknown_relationship");
  }
}

/**
 * Validate a complete set of receipts, including retry-chain integrity and the
 * store-level fork safeguard. Returns the first failure encountered.
 */
export function validateReceiptSet(
  receipts: readonly ContractReceiptV1[]
): ValidationResult {
  const byId = new Map<string, ContractReceiptV1>();
  for (const receipt of receipts) {
    if (byId.has(receipt.header.receiptId)) {
      return fail("duplicate_receipt_id");
    }
    byId.set(receipt.header.receiptId, receipt);
  }

  // Per-receipt structural rules.
  for (const receipt of receipts) {
    if (!isGeminiEvidenceReceiptType(receipt.header.receiptType)) {
      return fail("unknown_receipt_type");
    }
    const self = verifyReceiptSelfDigest(receipt);
    if (!self.ok) return fail(`self_digest:${self.reason}`);
    const authority = validateZeroAuthority(receipt);
    if (!authority.ok) return authority;
  }

  const invocations = receipts.filter(
    (r) => r.header.receiptType === "gemini_invocation"
  );

  // Identity coherence for every invocation.
  const invocationBodies = new Map<string, InvocationBodyV1>();
  for (const inv of invocations) {
    const body = asInvocationBody(inv.body);
    if (!body) return fail("invalid_invocation_body");
    invocationBodies.set(inv.header.receiptId, body);
    const identityResult = validateInvocationIdentityShape(body);
    if (!identityResult.ok) return identityResult;
  }

  // Store-level fork safeguard: at most one invocation receipt per
  // (logicalInvocationId, retryOfProviderAttemptId).
  const seenPairs = new Set<string>();
  for (const inv of invocations) {
    const body = invocationBodies.get(inv.header.receiptId)!;
    const key = `${body.identity.logicalInvocationId}\u0000${
      body.identity.retryOfProviderAttemptId ?? "\u0000null"
    }`;
    if (seenPairs.has(key)) {
      return fail("forked_invocation_lineage");
    }
    seenPairs.add(key);
  }

  // Cycle / self-reference detection over provider_retry prior references,
  // using receiptId edges (independent of digest matching).
  const edges = new Map<string, string>();
  for (const inv of invocations) {
    const body = invocationBodies.get(inv.header.receiptId)!;
    if (
      body.identity.relationship === "provider_retry" &&
      body.priorInvocationReceipt !== null
    ) {
      const priorId = body.priorInvocationReceipt.receiptId;
      if (priorId === inv.header.receiptId) {
        return fail("provider_retry_self_reference");
      }
      edges.set(inv.header.receiptId, priorId);
    }
  }
  for (const start of edges.keys()) {
    const visited = new Set<string>([start]);
    let current = edges.get(start);
    while (current !== undefined) {
      if (visited.has(current)) {
        return fail("retry_reference_cycle");
      }
      visited.add(current);
      current = edges.get(current);
    }
  }

  // Deep provider_retry chain resolution.
  for (const inv of invocations) {
    const body = invocationBodies.get(inv.header.receiptId)!;
    if (body.identity.relationship !== "provider_retry") continue;

    const ref = body.priorInvocationReceipt;
    const refResult = validateReceiptReference(ref, {
      receiptsById: byId,
      expectedType: "gemini_invocation",
      referringReceiptId: inv.header.receiptId,
    });
    if (!refResult.ok) return refResult;

    const prior = byId.get((ref as InvocationReceiptReferenceV1).receiptId)!;
    const priorBody = asInvocationBody(prior.body);
    if (!priorBody) return fail("referenced_receipt_not_invocation");

    if (
      priorBody.identity.logicalInvocationId !==
      body.identity.logicalInvocationId
    ) {
      return fail("cross_logical_invocation_reference");
    }
    if (
      priorBody.identity.providerAttemptId !==
      body.identity.retryOfProviderAttemptId
    ) {
      return fail("wrong_prior_attempt_id");
    }
    if (priorBody.preflight.status !== "passed") {
      return fail("referenced_receipt_preflight_not_passed");
    }
    if (priorBody.preflight.outboundCallStatus !== "provider_call_started") {
      return fail("referenced_receipt_no_outbound_call");
    }
  }

  return OK;
}

// ---------------------------------------------------------------------------
// Section 9 — Coordinate-transfer fixture model
// ---------------------------------------------------------------------------

export type CoordinateCoverCropV1 = {
  cropTransformVersion: string;
  coordinateConverterVersion: string;
  clampPolicyVersion: string;
  transformTuple: {
    scale: number;
    offsetX: number;
    offsetY: number;
    visibleSourceRectNorm: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};

export type CoordinateTransferBasisV1 = {
  encodedBytesDigest: ContentDigestV1;
  intrinsicSize: { width: number; height: number };
  frameSize: { width: number; height: number };
};

export type CoordinateTransferTransformV1 = {
  schemaVersion: "vibode-coordinate-transfer-transform/v1";

  sourceSpace: "empty-derivative-container-normalized-v0";
  intermediateSpace: "intrinsic-source-normalized-v0";
  destinationSpace: "original-container-normalized-v0";

  sourceBasis: CoordinateTransferBasisV1;
  destinationBasis: CoordinateTransferBasisV1;

  sourceCoverCrop: CoordinateCoverCropV1;
  destinationCoverCrop: CoordinateCoverCropV1;

  compatibility: {
    status: "exact_grid" | "aspect_rescaled";
    compatibilityPolicyVersion: string;
  };
};

export const COORDINATE_TRANSFER_TRANSFORM_SCHEMA_VERSION =
  "vibode-coordinate-transfer-transform/v1" as const;

export function validateCoordinateTransferTransform(
  transform: CoordinateTransferTransformV1
): ValidationResult {
  if (
    transform.schemaVersion !== COORDINATE_TRANSFER_TRANSFORM_SCHEMA_VERSION
  ) {
    return fail("wrong_transfer_schema_version");
  }
  if (
    transform.sourceSpace !== "empty-derivative-container-normalized-v0" ||
    transform.intermediateSpace !== "intrinsic-source-normalized-v0" ||
    transform.destinationSpace !== "original-container-normalized-v0"
  ) {
    return fail("wrong_transfer_space_chain");
  }
  const sourceByteResult = validateDigestForField(
    "coordinateTransfer.sourceBasis.encodedBytesDigest",
    transform.sourceBasis?.encodedBytesDigest ?? null
  );
  if (!sourceByteResult.ok) return fail(`source_basis:${sourceByteResult.reason}`);

  const destByteResult = validateDigestForField(
    "coordinateTransfer.destinationBasis.encodedBytesDigest",
    transform.destinationBasis?.encodedBytesDigest ?? null
  );
  if (!destByteResult.ok) return fail(`destination_basis:${destByteResult.reason}`);

  if (
    transform.compatibility?.status !== "exact_grid" &&
    transform.compatibility?.status !== "aspect_rescaled"
  ) {
    return fail("invalid_compatibility_status");
  }
  return OK;
}

/** A transfer transform is never authority-bearing; aspect_rescaled is diagnostic. */
export function isTransferTransformAuthorityBearing(): false {
  return false;
}

// ---------------------------------------------------------------------------
// Tombstone / retention replay refusal
// ---------------------------------------------------------------------------

export type RawResponseRetentionStateV1 =
  | "retained"
  | "digest_only"
  | "tombstoned";

export type RawResponseBindingV1 = {
  digest: ContentDigestV1;
  storageBindingDigest: ContentDigestV1;
  retentionState: RawResponseRetentionStateV1;
  // In GER-I0 the recoverable text is never present. It is modeled only so the
  // replay/reparse guards can prove refusal.
  text?: string | null;
};

export function attemptRawResponseReplay(
  rawResponse: RawResponseBindingV1
): ValidationResult {
  if (rawResponse.retentionState === "tombstoned") {
    return fail("raw_response_tombstoned_replay_refused");
  }
  if (
    rawResponse.retentionState === "digest_only" ||
    rawResponse.text === undefined ||
    rawResponse.text === null
  ) {
    return fail("raw_response_not_replayable_without_bytes");
  }
  return OK;
}

export function attemptRawResponseReparse(
  rawResponse: RawResponseBindingV1
): ValidationResult {
  if (rawResponse.retentionState === "tombstoned") {
    return fail("raw_response_tombstoned_reparse_refused");
  }
  if (
    rawResponse.retentionState === "digest_only" ||
    rawResponse.text === undefined ||
    rawResponse.text === null
  ) {
    return fail("raw_response_digest_only_not_reparseable");
  }
  return OK;
}

export type RetentionTombstoneBodyV1 = {
  affectedArtifactRole: TombstonedArtifactRole;
  tombstonedReceiptRef: EvidenceReceiptReferenceV1;
  originalDigest: ContentDigestV1;
  originalStorageBindingDigest: ContentDigestV1;
  retentionState: "tombstoned";
  recoverablePayloadPresent: false;
};

export function validateRetentionTombstone(
  body: RetentionTombstoneBodyV1
): ValidationResult {
  if (body.retentionState !== "tombstoned") {
    return fail("tombstone_not_tombstoned");
  }
  if (body.recoverablePayloadPresent !== false) {
    return fail("tombstone_must_not_retain_payload");
  }
  const originalResult = validateDigestForField(
    "tombstone.originalDigest",
    body.originalDigest,
    { affectedArtifactRole: body.affectedArtifactRole }
  );
  if (!originalResult.ok) return fail(`original_digest:${originalResult.reason}`);

  const storageResult = validateDigestForField(
    "tombstone.originalStorageBindingDigest",
    body.originalStorageBindingDigest
  );
  if (!storageResult.ok) {
    return fail(`original_storage_binding:${storageResult.reason}`);
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Compact fixture builders (lab-only, deterministic)
// ---------------------------------------------------------------------------

const FIXTURE_IMPLEMENTATION_COMMIT = "ger-i0-fixture-commit";

/** Build a sealed contract receipt with the fixed GER-I0 zero-authority block. */
export function buildSealedReceipt(input: {
  receiptId: string;
  receiptType: GeminiEvidenceReceiptTypeV1;
  createdAtIso?: string;
  body: Record<string, unknown>;
}): ContractReceiptV1 {
  const unsealed: ContractReceiptV1 = {
    header: {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      receiptId: input.receiptId,
      receiptType: input.receiptType,
      createdAtIso: input.createdAtIso ?? "2026-07-07T00:00:00.000Z",
      producer: {
        service: "roomprintz-ui",
        implementationCommit: FIXTURE_IMPLEMENTATION_COMMIT,
        canonicalizationVersion: CANONICALIZATION_VERSION,
      },
      authority: { ...GER_I0_ZERO_AUTHORITY },
      receiptDigest: { ...PLACEHOLDER_RECEIPT_DIGEST },
    },
    body: input.body,
  };
  return sealReceipt(unsealed);
}

/** Build a sealed gemini_invocation receipt from a partial identity/preflight. */
export function buildInvocationReceipt(input: {
  receiptId: string;
  identity: InvocationIdentityV1;
  preflight: InvocationPreflightV1;
  priorInvocationReceipt?: InvocationReceiptReferenceV1 | null;
  createdAtIso?: string;
}): ContractReceiptV1 {
  const body: InvocationBodyV1 = {
    identity: input.identity,
    preflight: input.preflight,
    priorInvocationReceipt: input.priorInvocationReceipt ?? null,
  };
  return buildSealedReceipt({
    receiptId: input.receiptId,
    receiptType: "gemini_invocation",
    createdAtIso: input.createdAtIso,
    body: body as unknown as Record<string, unknown>,
  });
}

/** Build a valid coordinate-transfer transform fixture (exact-grid by default). */
export function buildCoordinateTransferTransform(
  overrides: Partial<CoordinateTransferTransformV1> = {}
): CoordinateTransferTransformV1 {
  const coverCrop: CoordinateCoverCropV1 = {
    cropTransformVersion: "crop/v1",
    coordinateConverterVersion: "converter/v1",
    clampPolicyVersion: "clamp/v1",
    transformTuple: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      visibleSourceRectNorm: { x: 0, y: 0, width: 1, height: 1 },
    },
  };
  return {
    schemaVersion: COORDINATE_TRANSFER_TRANSFORM_SCHEMA_VERSION,
    sourceSpace: "empty-derivative-container-normalized-v0",
    intermediateSpace: "intrinsic-source-normalized-v0",
    destinationSpace: "original-container-normalized-v0",
    sourceBasis: {
      encodedBytesDigest: makeSyntheticDigest(
        "encoded-image-bytes/v1",
        "transfer-source-bytes"
      ),
      intrinsicSize: { width: 1024, height: 768 },
      frameSize: { width: 1024, height: 768 },
    },
    destinationBasis: {
      encodedBytesDigest: makeSyntheticDigest(
        "encoded-image-bytes/v1",
        "transfer-destination-bytes"
      ),
      intrinsicSize: { width: 1024, height: 768 },
      frameSize: { width: 1024, height: 768 },
    },
    sourceCoverCrop: coverCrop,
    destinationCoverCrop: coverCrop,
    compatibility: {
      status: "exact_grid",
      compatibilityPolicyVersion: "compat/v1",
    },
    ...overrides,
  };
}
