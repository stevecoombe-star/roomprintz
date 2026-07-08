// GER-W1 — Pure Gemini Evidence Wire Adapter
//
// This module is a lab-only, deterministic, network-free adapter between the
// frozen GER-I0 nested test-kernel receipt and the `gemini-evidence-wire/v1`
// envelope. It converts only valid, sealed GER-I0 receipts into a strict,
// canonical wire envelope, and rejects any envelope that is malformed,
// non-canonical, unknown-field-bearing, non-zero-authority, self-digest
// invalid, scope-invalid, or projection-inconsistent.
//
// It validates ONLY local receipt facts. It does NOT claim global identifier
// uniqueness, stored-row existence, cross-row retry lineage, database
// idempotency, insert conflict behavior, artifact existence, storage-binding
// retrieval, raw-wire-byte capture, or retained-artifact semantics. Those
// belong to GER-W2 or later.
//
// The ONLY import permitted here is the frozen GER-I0 kernel. Canonicalization
// and SHA-256 are never reimplemented; they are delegated to the kernel.

import {
  canonicalizeRfc8785Jcs,
  isEvidenceReceiptReference,
  isGeminiEvidenceReceiptType,
  validateCoordinateTransferTransform,
  validateDigestForField,
  validateReceiptSet,
  validateRetentionTombstone,
  validateZeroAuthority,
  verifyReceiptSelfDigest,
  CANONICALIZATION_VERSION,
  RECEIPT_SCHEMA_VERSION,
  type ContentDigestV1,
  type ContractReceiptV1,
  type CoordinateTransferTransformV1,
  type EvidenceDigestFieldKey,
  type GeminiEvidenceReceiptTypeV1,
  type RetentionTombstoneBodyV1,
  type TombstonedArtifactRole,
  type ValidationResult,
} from "./gemini-evidence-contract";

// ---------------------------------------------------------------------------
// Section 2 — Wire envelope + schema version
// ---------------------------------------------------------------------------

export const GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION =
  "gemini-evidence-wire/v1" as const;

export type GeminiEvidenceReceiptTypeV1Wire = GeminiEvidenceReceiptTypeV1;

export type GeminiEvidenceReceiptProjectionV1 = {
  receiptId: string;
  receiptType: GeminiEvidenceReceiptTypeV1;
  receiptSchemaVersion: string;
  receiptDigestHex: string;
  receiptDigestScope: "canonical-receipt-payload-json/v1";
  receiptCreatedAtIso: string;

  logicalInvocationId: string | null;
  providerAttemptId: string | null;
  retryOfProviderAttemptId: string | null;
  requestCorrelationId: string | null;
};

export type GeminiEvidenceWireEnvelopeV1 = {
  wireSchemaVersion: "gemini-evidence-wire/v1";
  canonicalReceipt: string;
  projection: GeminiEvidenceReceiptProjectionV1;
};

// ---------------------------------------------------------------------------
// Section 6 — Reserved W2 sentinel + identifier grammar
// ---------------------------------------------------------------------------

/**
 * Future GER-W2 expression-index sentinel. It is NOT a receipt value and must
 * never appear inside any receipt identifier or wire field.
 */
export const GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL =
  "__ger_null_retry_predecessor_v1__" as const;

const IDENTIFIER_MAX_LENGTH = 256;
// Printable ASCII (U+0021..U+007E): no NUL, no space, no control chars, no DEL.
const IDENTIFIER_PATTERN = /^[\x21-\x7e]+$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Return a stable wire refusal reason for a malformed / reserved identifier,
 * or null when the value satisfies the local identifier grammar. This is a
 * SHAPE check only: it never asserts global uniqueness, unguessability,
 * provider-call existence, or request-correlation truth.
 */
function identifierReason(value: unknown): string | null {
  if (value === GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL) {
    return "wire_reserved_identifier";
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return "wire_invalid_identifier";
  }
  return null;
}

function nullableIdentifierReason(value: unknown): string | null {
  if (value === null) return null;
  return identifierReason(value);
}

// ---------------------------------------------------------------------------
// Result vocabulary + tiny structural helpers
// ---------------------------------------------------------------------------

const OK: ValidationResult = { ok: true };
function fail(reason: string): ValidationResult {
  return { ok: false, reason };
}

type ReceiptParse =
  | { ok: true; receipt: ContractReceiptV1 }
  | { ok: false; reason: string };

export type WireParseResult =
  | {
      ok: true;
      value: GeminiEvidenceWireEnvelopeV1;
      receipt: ContractReceiptV1;
    }
  | { ok: false; reason: string };

/** Plain-object guard that rejects arrays and non-Object-prototype objects. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Enforce an exact key allowlist. Returns a stable reason on the first unknown
 * key, then on the first missing required key, otherwise null.
 */
function keyAllowlistReason(
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  unknownReason: string,
  missingReason: string
): string | null {
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) {
      return `${unknownReason}:${key}`;
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) return missingReason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strict digest + reference primitives (closed shapes only)
// ---------------------------------------------------------------------------

const DIGEST_KEYS = ["algorithm", "encoding", "scope", "value"] as const;
const REFERENCE_KEYS = ["receiptId", "receiptType", "receiptDigest"] as const;

/**
 * Validate a closed content-digest object bound to a specific field. Rejects
 * unknown digest keys, then delegates well-formedness and the field-to-scope
 * binding to the frozen kernel via validateDigestForField.
 */
function strictDigest(
  value: unknown,
  field: EvidenceDigestFieldKey,
  context?: { affectedArtifactRole?: TombstonedArtifactRole }
): ValidationResult {
  if (!isPlainObject(value)) {
    return fail(`wire_invalid_digest:${field}:not_object`);
  }
  for (const key of Object.keys(value)) {
    if (!DIGEST_KEYS.includes(key as (typeof DIGEST_KEYS)[number])) {
      return fail(`wire_unknown_digest_field:${field}:${key}`);
    }
  }
  const bound = validateDigestForField(
    field,
    value as ContentDigestV1,
    context
  );
  if (!bound.ok) return fail(`wire_invalid_digest:${field}:${bound.reason}`);
  return OK;
}

/**
 * Validate a closed EvidenceReceiptReferenceV1. Requires exactly the three
 * reference keys, a syntactically valid receiptId, a closed receipt type, an
 * optional expected type, and a canonical-receipt-payload-json/v1 digest. It
 * does NOT assert that the referenced receipt exists anywhere.
 */
function strictReference(
  value: unknown,
  expectedType?: GeminiEvidenceReceiptTypeV1
): ValidationResult {
  if (!isPlainObject(value)) return fail("wire_invalid_reference:not_object");
  const keyReason = keyAllowlistReason(
    value,
    REFERENCE_KEYS,
    [],
    "wire_unknown_reference_field",
    "wire_invalid_reference:missing_field"
  );
  if (keyReason) return fail(keyReason);

  const idReason = identifierReason(value.receiptId);
  if (idReason) return fail(idReason);

  if (!isGeminiEvidenceReceiptType(value.receiptType)) {
    return fail("wire_invalid_reference:unknown_type");
  }
  if (expectedType && value.receiptType !== expectedType) {
    return fail("wire_invalid_reference:wrong_type");
  }

  const digestResult = strictDigest(
    value.receiptDigest,
    "receiptReference.receiptDigest"
  );
  if (!digestResult.ok) return digestResult;

  // Defense in depth: the frozen kernel's own reference guard also enforces
  // the canonical-receipt-payload-json/v1 scope and exact reference shape.
  if (!isEvidenceReceiptReference(value)) {
    return fail("wire_invalid_reference:shape");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Section 5 — Strict receipt wire profile (closed, per receipt type)
// ---------------------------------------------------------------------------

const INVOCATION_BODY_KEYS = [
  "identity",
  "priorInvocationReceipt",
  "preflight",
] as const;
const INVOCATION_IDENTITY_KEYS = [
  "logicalInvocationId",
  "requestId",
  "providerAttemptId",
  "relationship",
  "retryOfProviderAttemptId",
] as const;
const INVOCATION_PREFLIGHT_KEYS = [
  "status",
  "outboundCallStatus",
  "refusalReasons",
] as const;

function bodyInvocation(body: Record<string, unknown>): ValidationResult {
  const bodyKeyReason = keyAllowlistReason(
    body,
    INVOCATION_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (bodyKeyReason) return fail(bodyKeyReason);

  const identity = body.identity;
  if (!isPlainObject(identity)) return fail("wire_invalid_body_shape:identity");
  const identityKeyReason = keyAllowlistReason(
    identity,
    INVOCATION_IDENTITY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (identityKeyReason) return fail(identityKeyReason);

  const logicalReason = identifierReason(identity.logicalInvocationId);
  if (logicalReason) return fail(logicalReason);
  const requestReason = nullableIdentifierReason(identity.requestId);
  if (requestReason) return fail(requestReason);
  const attemptReason = nullableIdentifierReason(identity.providerAttemptId);
  if (attemptReason) return fail(attemptReason);
  const retryReason = nullableIdentifierReason(
    identity.retryOfProviderAttemptId
  );
  if (retryReason) return fail(retryReason);
  if (
    identity.relationship !== "initial" &&
    identity.relationship !== "provider_retry" &&
    identity.relationship !== "operator_rerun"
  ) {
    return fail("wire_invalid_body_shape:relationship");
  }

  const preflight = body.preflight;
  if (!isPlainObject(preflight)) return fail("wire_invalid_body_shape:preflight");
  const preflightKeyReason = keyAllowlistReason(
    preflight,
    INVOCATION_PREFLIGHT_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (preflightKeyReason) return fail(preflightKeyReason);
  if (preflight.status !== "passed" && preflight.status !== "refused") {
    return fail("wire_invalid_body_shape:status");
  }
  if (
    preflight.outboundCallStatus !== "not_sent" &&
    preflight.outboundCallStatus !== "provider_call_started"
  ) {
    return fail("wire_invalid_body_shape:outboundCallStatus");
  }
  if (
    !Array.isArray(preflight.refusalReasons) ||
    !preflight.refusalReasons.every((r) => typeof r === "string")
  ) {
    return fail("wire_invalid_body_shape:refusalReasons");
  }

  const prior = body.priorInvocationReceipt;
  if (prior !== null) {
    const refResult = strictReference(prior, "gemini_invocation");
    if (!refResult.ok) return refResult;
  }
  return OK;
}

const PROVIDER_RESPONSE_BODY_KEYS = ["invocationRef", "rawResponse"] as const;
const RAW_RESPONSE_REQUIRED_KEYS = [
  "digest",
  "storageBindingDigest",
  "retentionState",
] as const;
const RAW_RESPONSE_OPTIONAL_KEYS = ["text"] as const;

function bodyProviderResponse(
  body: Record<string, unknown>
): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    ["invocationRef"],
    ["rawResponse"],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  const refResult = strictReference(body.invocationRef, "gemini_invocation");
  if (!refResult.ok) return refResult;

  // rawResponse absent OR null → discarded-without-binding (no raw text digest,
  // no replay or retention claim).
  if (!Object.hasOwn(body, "rawResponse") || body.rawResponse === null) {
    return OK;
  }
  const raw = body.rawResponse;
  if (!isPlainObject(raw)) return fail("wire_invalid_body_shape:rawResponse");
  const rawKeyReason = keyAllowlistReason(
    raw,
    RAW_RESPONSE_REQUIRED_KEYS,
    RAW_RESPONSE_OPTIONAL_KEYS,
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (rawKeyReason) return fail(rawKeyReason);

  // The W1 wire profile permits ONLY digest_only raw responses. `retained` is
  // refused; a fourth `discarded` retention value (or any other value) is
  // refused; `tombstoned` is expressed by an evidence_retention_tombstone
  // receipt, never inline here.
  if (raw.retentionState === "retained") {
    return fail("wire_raw_response_retained");
  }
  if (raw.retentionState !== "digest_only") {
    return fail(
      `wire_invalid_raw_response_retention_state:${String(
        raw.retentionState
      )}`
    );
  }

  // No raw response text may appear anywhere in a W1 wire receipt.
  if (Object.hasOwn(raw, "text") && raw.text !== null) {
    return fail("wire_raw_response_text_present");
  }

  const digestResult = strictDigest(raw.digest, "rawResponse.digest");
  if (!digestResult.ok) return digestResult;
  const bindingResult = strictDigest(
    raw.storageBindingDigest,
    "rawResponse.storageBindingDigest"
  );
  if (!bindingResult.ok) return bindingResult;
  return OK;
}

const PARSED_RESPONSE_BODY_KEYS = [
  "providerResponseRef",
  "parsedResponseDigest",
  "rawCandidateDigest",
] as const;

function bodyParsedResponse(body: Record<string, unknown>): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    PARSED_RESPONSE_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  const refResult = strictReference(
    body.providerResponseRef,
    "gemini_provider_response"
  );
  if (!refResult.ok) return refResult;

  const parsedDigest = strictDigest(
    body.parsedResponseDigest,
    "parsedResponseDigest"
  );
  if (!parsedDigest.ok) return parsedDigest;
  const candidateDigest = strictDigest(
    body.rawCandidateDigest,
    "rawCandidateDigest"
  );
  if (!candidateDigest.ok) return candidateDigest;
  return OK;
}

const LOCAL_ASSESSMENT_BODY_KEYS = [
  "parsedResponseRef",
  "assessmentInputDigest",
  "assessmentOutputDigest",
  "notesClaimDigest",
  "risksClaimDigest",
] as const;

function bodyLocalAssessment(body: Record<string, unknown>): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    LOCAL_ASSESSMENT_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  const refResult = strictReference(
    body.parsedResponseRef,
    "gemini_parsed_response"
  );
  if (!refResult.ok) return refResult;

  const inputDigest = strictDigest(
    body.assessmentInputDigest,
    "assessmentInputDigest"
  );
  if (!inputDigest.ok) return inputDigest;
  const outputDigest = strictDigest(
    body.assessmentOutputDigest,
    "assessmentOutputDigest"
  );
  if (!outputDigest.ok) return outputDigest;
  const notesDigest = strictDigest(body.notesClaimDigest, "notesClaimDigest");
  if (!notesDigest.ok) return notesDigest;
  const risksDigest = strictDigest(body.risksClaimDigest, "risksClaimDigest");
  if (!risksDigest.ok) return risksDigest;
  return OK;
}

const DERIVATIVE_LINEAGE_BODY_KEYS = [
  "derivativeLineage",
  "transferTransform",
  "transferTransformDigest",
] as const;
const DERIVATIVE_LINEAGE_INNER_KEYS = [
  "parentEncodedBytesDigest",
  "derivativeEncodedBytesDigest",
  "durableStorageBindingDigest",
] as const;

function bodyDerivativeLineage(
  body: Record<string, unknown>
): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    DERIVATIVE_LINEAGE_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  const lineage = body.derivativeLineage;
  if (!isPlainObject(lineage)) {
    return fail("wire_invalid_body_shape:derivativeLineage");
  }
  const lineageKeyReason = keyAllowlistReason(
    lineage,
    DERIVATIVE_LINEAGE_INNER_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (lineageKeyReason) return fail(lineageKeyReason);

  const parentDigest = strictDigest(
    lineage.parentEncodedBytesDigest,
    "derivativeLineage.parentEncodedBytesDigest"
  );
  if (!parentDigest.ok) return parentDigest;
  const derivativeDigest = strictDigest(
    lineage.derivativeEncodedBytesDigest,
    "derivativeLineage.derivativeEncodedBytesDigest"
  );
  if (!derivativeDigest.ok) return derivativeDigest;
  const storageDigest = strictDigest(
    lineage.durableStorageBindingDigest,
    "derivativeLineage.durableStorageBindingDigest"
  );
  if (!storageDigest.ok) return storageDigest;

  const transferDigest = strictDigest(
    body.transferTransformDigest,
    "transferTransformDigest"
  );
  if (!transferDigest.ok) return transferDigest;

  const transformShape = strictCoordinateTransfer(body.transferTransform);
  if (!transformShape.ok) return transformShape;
  return OK;
}

const COMPARISON_BODY_KEYS = ["leftRef", "rightRef", "comparison"] as const;
const COMPARISON_INNER_KEYS = ["inputDigest", "outputDigest"] as const;

function bodyComparison(body: Record<string, unknown>): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    COMPARISON_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  const leftResult = strictReference(body.leftRef);
  if (!leftResult.ok) return leftResult;
  const rightResult = strictReference(body.rightRef);
  if (!rightResult.ok) return rightResult;

  const comparison = body.comparison;
  if (!isPlainObject(comparison)) {
    return fail("wire_invalid_body_shape:comparison");
  }
  const comparisonKeyReason = keyAllowlistReason(
    comparison,
    COMPARISON_INNER_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (comparisonKeyReason) return fail(comparisonKeyReason);

  const inputDigest = strictDigest(comparison.inputDigest, "comparison.inputDigest");
  if (!inputDigest.ok) return inputDigest;
  const outputDigest = strictDigest(
    comparison.outputDigest,
    "comparison.outputDigest"
  );
  if (!outputDigest.ok) return outputDigest;
  return OK;
}

const DISPOSITION_BODY_KEYS = [
  "subjectRef",
  "assessmentRef",
  "disposition",
] as const;

function bodyDisposition(body: Record<string, unknown>): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    DISPOSITION_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  const subjectResult = strictReference(body.subjectRef);
  if (!subjectResult.ok) return subjectResult;
  const assessmentResult = strictReference(
    body.assessmentRef,
    "gemini_local_assessment"
  );
  if (!assessmentResult.ok) return assessmentResult;

  if (
    body.disposition !== "accepted" &&
    body.disposition !== "rejected" &&
    body.disposition !== "deferred"
  ) {
    return fail("wire_invalid_body_shape:disposition");
  }
  return OK;
}

const TOMBSTONE_BODY_KEYS = [
  "affectedArtifactRole",
  "tombstonedReceiptRef",
  "originalDigest",
  "originalStorageBindingDigest",
  "retentionState",
  "recoverablePayloadPresent",
] as const;

function bodyTombstone(body: Record<string, unknown>): ValidationResult {
  const keyReason = keyAllowlistReason(
    body,
    TOMBSTONE_BODY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_body_shape"
  );
  if (keyReason) return fail(keyReason);

  if (
    body.affectedArtifactRole !== "raw_provider_response" &&
    body.affectedArtifactRole !== "parsed_response" &&
    body.affectedArtifactRole !== "encoded_image_bytes"
  ) {
    return fail("wire_invalid_body_shape:affectedArtifactRole");
  }

  const refResult = strictReference(body.tombstonedReceiptRef);
  if (!refResult.ok) return refResult;

  // Enforce closed digest SHAPES here (exact keys + well-formedness). The
  // role-dependent originalDigest scope and the originalStorageBindingDigest
  // scope are bound by the frozen validateRetentionTombstone at the semantic
  // stage so that role/digest mismatches surface as wire_tombstone reasons.
  const originalShape = strictDigestShapeOnly(body.originalDigest, "originalDigest");
  if (!originalShape.ok) return originalShape;
  const storageShape = strictDigestShapeOnly(
    body.originalStorageBindingDigest,
    "originalStorageBindingDigest"
  );
  if (!storageShape.ok) return storageShape;

  if (typeof body.retentionState !== "string") {
    return fail("wire_invalid_body_shape:retentionState");
  }
  if (typeof body.recoverablePayloadPresent !== "boolean") {
    return fail("wire_invalid_body_shape:recoverablePayloadPresent");
  }
  return OK;
}

/**
 * Enforce a closed digest object shape (exact keys + kernel well-formedness)
 * WITHOUT binding it to a specific field scope. Used where the required scope
 * is role-dependent and resolved later by a frozen kernel validator.
 */
function strictDigestShapeOnly(value: unknown, label: string): ValidationResult {
  if (!isPlainObject(value)) return fail(`wire_invalid_digest:${label}:not_object`);
  for (const key of Object.keys(value)) {
    if (!DIGEST_KEYS.includes(key as (typeof DIGEST_KEYS)[number])) {
      return fail(`wire_unknown_digest_field:${label}:${key}`);
    }
  }
  // parsedResponseDigest carries canonical-parsed-response-json/v1 and is a
  // convenient, real digest field whose only job here is to confirm the object
  // is a well-formed sha256/hex digest with a known scope. The actual required
  // scope is asserted later by validateRetentionTombstone.
  const wellFormed = validateDigestForField(
    "parsedResponseDigest",
    value as ContentDigestV1
  );
  if (
    !wellFormed.ok &&
    wellFormed.reason !== "wrong_digest_scope_for_field"
  ) {
    return fail(`wire_invalid_digest:${label}:${wellFormed.reason}`);
  }
  return OK;
}

function parseStrictBody(
  receiptType: GeminiEvidenceReceiptTypeV1,
  body: Record<string, unknown>
): ValidationResult {
  switch (receiptType) {
    case "gemini_invocation":
      return bodyInvocation(body);
    case "gemini_provider_response":
      return bodyProviderResponse(body);
    case "gemini_parsed_response":
      return bodyParsedResponse(body);
    case "gemini_local_assessment":
      return bodyLocalAssessment(body);
    case "derivative_lineage":
      return bodyDerivativeLineage(body);
    case "evidence_comparison":
      return bodyComparison(body);
    case "evidence_disposition":
      return bodyDisposition(body);
    case "evidence_retention_tombstone":
      return bodyTombstone(body);
    default:
      return fail("wire_unknown_receipt_type");
  }
}

// ---------------------------------------------------------------------------
// Strict coordinate-transfer transform shape (closed at every nested level)
// ---------------------------------------------------------------------------

const TRANSFER_KEYS = [
  "schemaVersion",
  "sourceSpace",
  "intermediateSpace",
  "destinationSpace",
  "sourceBasis",
  "destinationBasis",
  "sourceCoverCrop",
  "destinationCoverCrop",
  "compatibility",
] as const;
const TRANSFER_BASIS_KEYS = [
  "encodedBytesDigest",
  "intrinsicSize",
  "frameSize",
] as const;
const SIZE_KEYS = ["width", "height"] as const;
const COVER_CROP_KEYS = [
  "cropTransformVersion",
  "coordinateConverterVersion",
  "clampPolicyVersion",
  "transformTuple",
] as const;
const TRANSFORM_TUPLE_KEYS = [
  "scale",
  "offsetX",
  "offsetY",
  "visibleSourceRectNorm",
] as const;
const RECT_KEYS = ["x", "y", "width", "height"] as const;
const COMPATIBILITY_KEYS = ["status", "compatibilityPolicyVersion"] as const;

function allNumbers(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((k) => typeof obj[k] === "number");
}

function strictSize(value: unknown, label: string): ValidationResult {
  if (!isPlainObject(value)) return fail(`wire_invalid_transfer:${label}`);
  const keyReason = keyAllowlistReason(
    value,
    SIZE_KEYS,
    [],
    "wire_unknown_body_field",
    `wire_invalid_transfer:${label}`
  );
  if (keyReason) return fail(keyReason);
  if (!allNumbers(value, SIZE_KEYS)) return fail(`wire_invalid_transfer:${label}`);
  return OK;
}

function strictBasis(
  value: unknown,
  label: string,
  digestField: EvidenceDigestFieldKey
): ValidationResult {
  if (!isPlainObject(value)) return fail(`wire_invalid_transfer:${label}`);
  const keyReason = keyAllowlistReason(
    value,
    TRANSFER_BASIS_KEYS,
    [],
    "wire_unknown_body_field",
    `wire_invalid_transfer:${label}`
  );
  if (keyReason) return fail(keyReason);
  const digestResult = strictDigest(value.encodedBytesDigest, digestField);
  if (!digestResult.ok) return digestResult;
  const intrinsic = strictSize(value.intrinsicSize, `${label}.intrinsicSize`);
  if (!intrinsic.ok) return intrinsic;
  const frame = strictSize(value.frameSize, `${label}.frameSize`);
  if (!frame.ok) return frame;
  return OK;
}

function strictCoverCrop(value: unknown, label: string): ValidationResult {
  if (!isPlainObject(value)) return fail(`wire_invalid_transfer:${label}`);
  const keyReason = keyAllowlistReason(
    value,
    COVER_CROP_KEYS,
    [],
    "wire_unknown_body_field",
    `wire_invalid_transfer:${label}`
  );
  if (keyReason) return fail(keyReason);
  if (
    typeof value.cropTransformVersion !== "string" ||
    typeof value.coordinateConverterVersion !== "string" ||
    typeof value.clampPolicyVersion !== "string"
  ) {
    return fail(`wire_invalid_transfer:${label}`);
  }
  const tuple = value.transformTuple;
  if (!isPlainObject(tuple)) return fail(`wire_invalid_transfer:${label}.transformTuple`);
  const tupleKeyReason = keyAllowlistReason(
    tuple,
    TRANSFORM_TUPLE_KEYS,
    [],
    "wire_unknown_body_field",
    `wire_invalid_transfer:${label}.transformTuple`
  );
  if (tupleKeyReason) return fail(tupleKeyReason);
  if (!allNumbers(tuple, ["scale", "offsetX", "offsetY"])) {
    return fail(`wire_invalid_transfer:${label}.transformTuple`);
  }
  const rect = tuple.visibleSourceRectNorm;
  if (!isPlainObject(rect)) {
    return fail(`wire_invalid_transfer:${label}.visibleSourceRectNorm`);
  }
  const rectKeyReason = keyAllowlistReason(
    rect,
    RECT_KEYS,
    [],
    "wire_unknown_body_field",
    `wire_invalid_transfer:${label}.visibleSourceRectNorm`
  );
  if (rectKeyReason) return fail(rectKeyReason);
  if (!allNumbers(rect, RECT_KEYS)) {
    return fail(`wire_invalid_transfer:${label}.visibleSourceRectNorm`);
  }
  return OK;
}

function strictCoordinateTransfer(value: unknown): ValidationResult {
  if (!isPlainObject(value)) return fail("wire_invalid_transfer:root");
  const keyReason = keyAllowlistReason(
    value,
    TRANSFER_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_transfer:root"
  );
  if (keyReason) return fail(keyReason);

  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.sourceSpace !== "string" ||
    typeof value.intermediateSpace !== "string" ||
    typeof value.destinationSpace !== "string"
  ) {
    return fail("wire_invalid_transfer:spaces");
  }

  const sourceBasis = strictBasis(
    value.sourceBasis,
    "sourceBasis",
    "coordinateTransfer.sourceBasis.encodedBytesDigest"
  );
  if (!sourceBasis.ok) return sourceBasis;
  const destinationBasis = strictBasis(
    value.destinationBasis,
    "destinationBasis",
    "coordinateTransfer.destinationBasis.encodedBytesDigest"
  );
  if (!destinationBasis.ok) return destinationBasis;

  const sourceCrop = strictCoverCrop(value.sourceCoverCrop, "sourceCoverCrop");
  if (!sourceCrop.ok) return sourceCrop;
  const destCrop = strictCoverCrop(
    value.destinationCoverCrop,
    "destinationCoverCrop"
  );
  if (!destCrop.ok) return destCrop;

  const compatibility = value.compatibility;
  if (!isPlainObject(compatibility)) {
    return fail("wire_invalid_transfer:compatibility");
  }
  const compatKeyReason = keyAllowlistReason(
    compatibility,
    COMPATIBILITY_KEYS,
    [],
    "wire_unknown_body_field",
    "wire_invalid_transfer:compatibility"
  );
  if (compatKeyReason) return fail(compatKeyReason);
  if (typeof compatibility.compatibilityPolicyVersion !== "string") {
    return fail("wire_invalid_transfer:compatibility");
  }
  if (
    compatibility.status !== "exact_grid" &&
    compatibility.status !== "aspect_rescaled"
  ) {
    return fail("wire_invalid_transfer:compatibility");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Strict header shape
// ---------------------------------------------------------------------------

const HEADER_KEYS = [
  "schemaVersion",
  "receiptId",
  "receiptType",
  "createdAtIso",
  "producer",
  "authority",
  "receiptDigest",
] as const;
const PRODUCER_KEYS = [
  "service",
  "implementationCommit",
  "canonicalizationVersion",
] as const;
const AUTHORITY_KEYS = [
  "effect",
  "mutationPermission",
  "calibrationApplyPermission",
  "reason",
] as const;

function parseStrictHeader(header: unknown): ValidationResult {
  if (!isPlainObject(header)) return fail("wire_invalid_header_shape");
  const keyReason = keyAllowlistReason(
    header,
    HEADER_KEYS,
    [],
    "wire_unknown_header_field",
    "wire_invalid_header_shape"
  );
  if (keyReason) return fail(keyReason);

  if (header.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    return fail("wire_invalid_header_shape");
  }
  if (!isGeminiEvidenceReceiptType(header.receiptType)) {
    return fail("wire_unknown_receipt_type");
  }
  const idReason = identifierReason(header.receiptId);
  if (idReason) return fail(idReason);
  if (
    typeof header.createdAtIso !== "string" ||
    !ISO_INSTANT_PATTERN.test(header.createdAtIso)
  ) {
    return fail("wire_invalid_header_shape");
  }

  const producer = header.producer;
  if (!isPlainObject(producer)) return fail("wire_invalid_producer_shape");
  const producerKeyReason = keyAllowlistReason(
    producer,
    PRODUCER_KEYS,
    [],
    "wire_unknown_producer_field",
    "wire_invalid_producer_shape"
  );
  if (producerKeyReason) return fail(producerKeyReason);
  if (producer.service !== "roomprintz-ui") {
    return fail("wire_invalid_producer_shape");
  }
  if (producer.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    return fail("wire_invalid_producer_shape");
  }
  if (
    typeof producer.implementationCommit !== "string" ||
    producer.implementationCommit.length === 0
  ) {
    return fail("wire_invalid_producer_shape");
  }

  // Authority: enforce closed KEYS + string types only. The zero-authority
  // VALUE contract is asserted by the frozen validateZeroAuthority so that a
  // sealed non-zero authority surfaces as wire_zero_authority:non_zero_authority.
  const authority = header.authority;
  if (!isPlainObject(authority)) return fail("wire_invalid_authority_shape");
  const authorityKeyReason = keyAllowlistReason(
    authority,
    AUTHORITY_KEYS,
    [],
    "wire_unknown_authority_field",
    "wire_invalid_authority_shape"
  );
  if (authorityKeyReason) return fail(authorityKeyReason);
  for (const key of AUTHORITY_KEYS) {
    if (typeof authority[key] !== "string") {
      return fail("wire_invalid_authority_shape");
    }
  }

  const digestResult = strictDigest(header.receiptDigest, "header.receiptDigest");
  if (!digestResult.ok) return digestResult;
  return OK;
}

// ---------------------------------------------------------------------------
// Section 7 — Full strict receipt parse + mandatory frozen-kernel revalidation
// ---------------------------------------------------------------------------

function validateSemantic(
  receipt: ContractReceiptV1,
  body: Record<string, unknown>
): ValidationResult {
  switch (receipt.header.receiptType) {
    case "gemini_invocation": {
      // Use the frozen invocation-set semantics for LOCAL consistency. The one
      // tolerated failure, missing_referenced_receipt, is precisely the
      // cross-row target-existence claim W1 must NOT make.
      const setResult = validateReceiptSet([receipt]);
      if (!setResult.ok && setResult.reason !== "missing_referenced_receipt") {
        return fail(`wire_invocation_local:${setResult.reason}`);
      }
      return OK;
    }
    case "derivative_lineage": {
      const transform = body.transferTransform as CoordinateTransferTransformV1;
      const transferResult = validateCoordinateTransferTransform(transform);
      if (!transferResult.ok) {
        return fail(`wire_coordinate_transfer:${transferResult.reason}`);
      }
      return OK;
    }
    case "evidence_retention_tombstone": {
      const tombstoneResult = validateRetentionTombstone(
        body as unknown as RetentionTombstoneBodyV1
      );
      if (!tombstoneResult.ok) {
        return fail(`wire_tombstone:${tombstoneResult.reason}`);
      }
      return OK;
    }
    default:
      return OK;
  }
}

function parseStrictReceipt(value: unknown): ReceiptParse {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "wire_invalid_receipt_shape" };
  }
  for (const key of Object.keys(value)) {
    if (key !== "header" && key !== "body") {
      return { ok: false, reason: `wire_unknown_receipt_field:${key}` };
    }
  }
  if (!Object.hasOwn(value, "header") || !Object.hasOwn(value, "body")) {
    return { ok: false, reason: "wire_invalid_receipt_shape" };
  }

  const headerResult = parseStrictHeader(value.header);
  if (!headerResult.ok) return { ok: false, reason: headerResult.reason };

  const body = value.body;
  if (!isPlainObject(body)) {
    return { ok: false, reason: "wire_invalid_body_shape" };
  }

  const receipt = value as unknown as ContractReceiptV1;

  const selfDigest = verifyReceiptSelfDigest(receipt);
  if (!selfDigest.ok) {
    return { ok: false, reason: `wire_receipt_self_digest:${selfDigest.reason}` };
  }

  const zeroAuthority = validateZeroAuthority(receipt);
  if (!zeroAuthority.ok) {
    return { ok: false, reason: `wire_zero_authority:${zeroAuthority.reason}` };
  }

  const bodyResult = parseStrictBody(receipt.header.receiptType, body);
  if (!bodyResult.ok) return { ok: false, reason: bodyResult.reason };

  const semantic = validateSemantic(receipt, body);
  if (!semantic.ok) return { ok: false, reason: semantic.reason };

  return { ok: true, receipt };
}

// ---------------------------------------------------------------------------
// Section 3 — Projection derivation + validation
// ---------------------------------------------------------------------------

const PROJECTION_KEYS = [
  "receiptId",
  "receiptType",
  "receiptSchemaVersion",
  "receiptDigestHex",
  "receiptDigestScope",
  "receiptCreatedAtIso",
  "logicalInvocationId",
  "providerAttemptId",
  "retryOfProviderAttemptId",
  "requestCorrelationId",
] as const;

const PROJECTION_STRING_KEYS = [
  "receiptId",
  "receiptType",
  "receiptSchemaVersion",
  "receiptDigestHex",
  "receiptDigestScope",
  "receiptCreatedAtIso",
] as const;

const PROJECTION_NULLABLE_KEYS = [
  "logicalInvocationId",
  "providerAttemptId",
  "retryOfProviderAttemptId",
  "requestCorrelationId",
] as const;

/**
 * Derive the projection from a receipt. All values are read from the receipt;
 * a receipt is NEVER constructed from a projection. For gemini_invocation the
 * four identity projections are read from body.identity; for every other
 * receipt type they are null.
 */
export function projectGeminiEvidenceReceiptV1(
  receipt: ContractReceiptV1
): GeminiEvidenceReceiptProjectionV1 {
  const header = receipt.header;

  let logicalInvocationId: string | null = null;
  let providerAttemptId: string | null = null;
  let retryOfProviderAttemptId: string | null = null;
  let requestCorrelationId: string | null = null;

  if (header.receiptType === "gemini_invocation") {
    const identity = (receipt.body as { identity?: unknown }).identity;
    if (isPlainObject(identity)) {
      logicalInvocationId =
        typeof identity.logicalInvocationId === "string"
          ? identity.logicalInvocationId
          : null;
      providerAttemptId =
        typeof identity.providerAttemptId === "string"
          ? identity.providerAttemptId
          : null;
      retryOfProviderAttemptId =
        typeof identity.retryOfProviderAttemptId === "string"
          ? identity.retryOfProviderAttemptId
          : null;
      requestCorrelationId =
        typeof identity.requestId === "string" ? identity.requestId : null;
    }
  }

  return {
    receiptId: header.receiptId,
    receiptType: header.receiptType,
    receiptSchemaVersion: header.schemaVersion,
    receiptDigestHex: header.receiptDigest.value,
    receiptDigestScope: "canonical-receipt-payload-json/v1",
    receiptCreatedAtIso: header.createdAtIso,
    logicalInvocationId,
    providerAttemptId,
    retryOfProviderAttemptId,
    requestCorrelationId,
  };
}

/**
 * Validate a supplied projection against the projection derived from the
 * receipt. Fails on unknown keys, missing keys, wrong primitive types, and any
 * value mismatch (including non-null invocation fields on a non-invocation
 * receipt). The mismatch reason is the offending projection field name.
 */
export function validateGeminiEvidenceProjectionV1(
  receipt: ContractReceiptV1,
  projection: unknown
): ValidationResult {
  if (!isPlainObject(projection)) return fail("not_object");

  const expected = projectGeminiEvidenceReceiptV1(receipt);

  for (const key of Object.keys(projection)) {
    if (!PROJECTION_KEYS.includes(key as (typeof PROJECTION_KEYS)[number])) {
      return fail(`unknown_projection_key:${key}`);
    }
  }
  for (const key of PROJECTION_KEYS) {
    if (!Object.hasOwn(projection, key)) {
      return fail(`missing_projection_key:${key}`);
    }
  }

  for (const key of PROJECTION_STRING_KEYS) {
    if (typeof projection[key] !== "string") return fail(`type:${key}`);
    if (projection[key] !== expected[key]) return fail(key);
  }
  for (const key of PROJECTION_NULLABLE_KEYS) {
    const value = projection[key];
    if (value !== null && typeof value !== "string") return fail(`type:${key}`);
    if (value !== expected[key]) return fail(key);
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Section 4 — Canonical receipt boundary (envelope build + strict parse)
// ---------------------------------------------------------------------------

const ENVELOPE_KEYS = [
  "wireSchemaVersion",
  "canonicalReceipt",
  "projection",
] as const;

/**
 * Build a wire envelope from a sealed, valid GER-I0 receipt. The canonical
 * receipt string is the future persisted source of truth; the envelope only
 * makes the future W2 repository input explicit and independently verifiable.
 */
export function toGeminiEvidenceWireEnvelopeV1(
  receipt: ContractReceiptV1
): GeminiEvidenceWireEnvelopeV1 {
  return {
    wireSchemaVersion: GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION,
    canonicalReceipt: canonicalizeRfc8785Jcs(receipt),
    projection: projectGeminiEvidenceReceiptV1(receipt),
  };
}

/**
 * Parse and validate an already-decoded wire envelope object. Returns the
 * original canonicalReceipt unchanged on success along with the parsed
 * receipt. Refusal reasons are stable and prefixed `wire_`.
 */
export function parseGeminiEvidenceWireEnvelopeV1(
  input: unknown
): WireParseResult {
  if (!isPlainObject(input)) {
    return { ok: false, reason: "wire_invalid_envelope_shape" };
  }
  for (const key of Object.keys(input)) {
    if (!ENVELOPE_KEYS.includes(key as (typeof ENVELOPE_KEYS)[number])) {
      return { ok: false, reason: `wire_unknown_envelope_field:${key}` };
    }
  }
  for (const key of ENVELOPE_KEYS) {
    if (!Object.hasOwn(input, key)) {
      return { ok: false, reason: `wire_missing_envelope_field:${key}` };
    }
  }

  if (input.wireSchemaVersion !== GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION) {
    return { ok: false, reason: "wire_wrong_schema_version" };
  }

  const canonicalReceipt = input.canonicalReceipt;
  if (typeof canonicalReceipt !== "string") {
    return { ok: false, reason: "wire_invalid_canonical_receipt_type" };
  }

  let receiptValue: unknown;
  try {
    receiptValue = JSON.parse(canonicalReceipt);
  } catch {
    return { ok: false, reason: "wire_invalid_receipt_json" };
  }

  // Canonical fixed point: the parsed receipt must re-canonicalize to exactly
  // the supplied text. This refuses whitespace, reordered keys, duplicate keys,
  // non-canonical number forms, and any other non-canonical representation.
  let recanonicalized: string;
  try {
    recanonicalized = canonicalizeRfc8785Jcs(receiptValue);
  } catch {
    return { ok: false, reason: "wire_noncanonical_receipt_text" };
  }
  if (recanonicalized !== canonicalReceipt) {
    return { ok: false, reason: "wire_noncanonical_receipt_text" };
  }

  const parsed = parseStrictReceipt(receiptValue);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const projectionResult = validateGeminiEvidenceProjectionV1(
    parsed.receipt,
    input.projection
  );
  if (!projectionResult.ok) {
    return {
      ok: false,
      reason: `wire_projection_mismatch:${projectionResult.reason}`,
    };
  }

  return {
    ok: true,
    value: {
      wireSchemaVersion: GEMINI_EVIDENCE_WIRE_SCHEMA_VERSION,
      canonicalReceipt,
      projection: input.projection as GeminiEvidenceReceiptProjectionV1,
    },
    receipt: parsed.receipt,
  };
}

/**
 * Parse wire envelope TEXT. Refuses invalid JSON, then defers to the strict
 * envelope parser. No mutation is performed on the input text.
 */
export function parseGeminiEvidenceWireTextV1(text: string): WireParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return { ok: false, reason: "wire_invalid_json" };
  }
  return parseGeminiEvidenceWireEnvelopeV1(decoded);
}
