// GER-W3B.0 — Pure Producer Receipt Builder + Identity Wrapper
//
// This module is a lab-only, deterministic, network-free continuation of the
// frozen GER-I0 kernel, the GER-W1 wire adapter, and the GER-W2 ledger. It
// provides ONLY the pure producer-side identity and `gemini_invocation`
// receipt-building primitives needed at the Gemini outbound-call boundary.
//
// STRICT W3B.0 SCOPE. This module deliberately does NOT:
//   * enable any route ledger write, or perform any actual row insertion,
//   * call Gemini or perform any network, database, storage, or Supabase I/O,
//   * build any non-invocation evidence receipt (provider-response,
//     parsed-response, local-assessment, disposition, derivative-lineage,
//     comparison, or retention-tombstone are all out of scope here),
//   * capture, retain, or reparse raw provider response text,
//   * apply migrations, execute route handlers, or read the process environment,
//   * grant any camera / calibration authority, or advance P-empty lineage.
//
// R-2 (default-off byte identity): identity plumbing is default-off. The gate
//   helper defaults to false and, with the flag off, the accounting-context
//   resolver returns the base context UNCHANGED (byte-identical): no external
//   providerAttemptId is minted, passed, or injected.
//
// R-3 (mint placement): `providerAttemptId` is a non-null minted value ONLY on
//   a passed / provider_call_started invocation, which models the point
//   immediately before the outbound `callGeminiAutoFloorDetection` /
//   detect-vision provider call, AFTER all local preflight refusal points. This
//   module intentionally exposes NO pre-outbound refusal-receipt builder; any
//   future refused preflight receipt must carry providerAttemptId = null.
//
// R-5 (retry scope): only `initial` and `operator_rerun` relationships are
//   produced. `provider_retry` is out of W3B.0 scope and is refused with a
//   stable reason. A produced invocation always has retryOfProviderAttemptId =
//   null and priorInvocationReceipt = null, which, combined with the W2
//   retry-fork uniqueness surface, pins at most one invocation receipt per
//   logicalInvocationId with a null retry predecessor.
//
// Determinism: all identifiers are minted from caller-supplied seeds. This
// module NEVER imports a random-UUID generator or Node's built-in hashing
// module, and NEVER reads env or the clock. Production seed generation (e.g.
// random UUID seeds) is deferred to a later route-integration slice.

import {
  buildInvocationReceipt,
  validateReceiptSet,
  type ContractReceiptV1,
  type InvocationIdentityV1,
  type InvocationPreflightV1,
} from "./gemini-evidence-contract";

import {
  GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL,
  parseGeminiEvidenceWireEnvelopeV1,
  toGeminiEvidenceWireEnvelopeV1,
  type GeminiEvidenceWireEnvelopeV1,
} from "./gemini-evidence-wire";

// ---------------------------------------------------------------------------
// Section 1 — Producer identity types
// ---------------------------------------------------------------------------

/**
 * W3B.0 producer relationships. `provider_retry` is intentionally excluded
 * (R-5): retries are out of scope for this slice.
 */
export type GeminiEvidenceProducerRelationshipV1 = "initial" | "operator_rerun";

export type GeminiEvidenceProducerIdentityV1 = {
  relationship: GeminiEvidenceProducerRelationshipV1;
  receiptId: string;
  logicalInvocationId: string;
  providerAttemptId: string;
  requestId: string | null;
  createdAtIso: string;
};

export type GeminiEvidenceProducerIdentityResultV1 =
  | { ok: true; value: GeminiEvidenceProducerIdentityV1 }
  | { ok: false; reason: string };

export type GeminiEvidenceProducerInvocationResultV1 =
  | {
      ok: true;
      receipt: ContractReceiptV1;
      envelope: GeminiEvidenceWireEnvelopeV1;
    }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Section 2 — Grammar-safe identifier primitives (R-1)
// ---------------------------------------------------------------------------

const IDENTIFIER_MAX_LENGTH = 256;
// Printable ASCII (U+0021..U+007E): no NUL, no space, no control chars, no DEL.
// This mirrors the frozen GER-W1 identifier grammar so every minted id passes
// the wire adapter unchanged.
const IDENTIFIER_PATTERN = /^[\x21-\x7e]+$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Stable, grammar-safe prefixes for each minted producer identifier. */
export const GER_W3B0_RECEIPT_ID_PREFIX = "ger-inv-" as const;
export const GER_W3B0_LOGICAL_INVOCATION_ID_PREFIX = "ger-logical-" as const;
export const GER_W3B0_PROVIDER_ATTEMPT_ID_PREFIX = "ger-attempt-" as const;

/**
 * Return a stable refusal reason for a malformed / reserved identifier, or null
 * when the value satisfies the local (W1-equivalent) identifier grammar. Shape
 * check only: never asserts global uniqueness or unguessability.
 */
function identifierGrammarReason(value: unknown): string | null {
  if (value === GER_W2_NULL_RETRY_PREDECESSOR_SENTINEL) {
    return "reserved_identifier";
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return "invalid_identifier";
  }
  return null;
}

/**
 * Deterministically map an arbitrary seed to a grammar-safe slug. Characters
 * outside the URL-safe token set are encoded as `x<hexCodePoint>` so a hostile
 * seed (spaces, control chars, non-ASCII) can never break the identifier
 * grammar. This never embeds an unsanitized request header: seeds are supplied
 * explicitly by the caller and are distinct from the request correlation id.
 */
function safeSlug(seed: string): string {
  return seed.replace(
    /[^A-Za-z0-9._-]/g,
    (ch) => "x" + (ch.codePointAt(0) ?? 0).toString(16)
  );
}

/**
 * Mint a grammar-safe identifier `${prefix}${safeSlug(seed)}`, then defensively
 * revalidate the result against the full identifier grammar.
 */
function mintIdentifier(
  prefix: string,
  seed: unknown
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof seed !== "string" || seed.length === 0) {
    return { ok: false, reason: "invalid_seed" };
  }
  const id = `${prefix}${safeSlug(seed)}`;
  const reason = identifierGrammarReason(id);
  if (reason) return { ok: false, reason };
  return { ok: true, value: id };
}

/**
 * Sanitize a candidate request correlation id. Returns the id unchanged only if
 * it is a printable-ASCII, length-bounded, non-reserved identifier; otherwise
 * returns null. This is the ONLY place a request header may enter producer
 * identity, and it is sanitize-or-null (R-1). It is never embedded in a minted
 * receipt / logical / attempt identifier.
 */
export function sanitizeGeminiEvidenceProducerRequestIdV1(
  requestId: string | null | undefined
): string | null {
  if (requestId === null || requestId === undefined) return null;
  if (typeof requestId !== "string") return null;
  if (identifierGrammarReason(requestId) !== null) return null;
  return requestId;
}

// ---------------------------------------------------------------------------
// Section 3 — Pure identity builder (R-1, R-5)
// ---------------------------------------------------------------------------

/**
 * Build a grammar-safe producer identity from deterministic seed inputs.
 *
 * Identity is minted ONLY from caller entropy seeds and the relationship. It is
 * NEVER derived from the scene hash, room id, asset id, version id, request id,
 * an image URL, frame size, the Gemini prompt, or any mutable scene state.
 * `requestId` is sanitized-or-null and kept strictly separate from the minted
 * attempt id.
 *
 * R-5: only `initial` and `operator_rerun` are accepted; `provider_retry` (and
 * any other value) is refused with a stable reason.
 */
export function buildGeminiEvidenceProducerIdentityV1(input: {
  relationship: GeminiEvidenceProducerRelationshipV1;
  requestId?: string | null;
  createdAtIso: string;
  entropy: {
    receiptSeed: string;
    logicalSeed: string;
    attemptSeed: string;
  };
}): GeminiEvidenceProducerIdentityResultV1 {
  const { relationship, requestId, createdAtIso, entropy } = input;

  if (relationship !== "initial" && relationship !== "operator_rerun") {
    // R-5: provider_retry and any unknown relationship are out of scope.
    return { ok: false, reason: "producer_unsupported_relationship" };
  }

  if (typeof createdAtIso !== "string" || !ISO_INSTANT_PATTERN.test(createdAtIso)) {
    return { ok: false, reason: "producer_invalid_created_at" };
  }

  if (entropy === null || typeof entropy !== "object") {
    return { ok: false, reason: "producer_missing_entropy" };
  }

  const receiptMint = mintIdentifier(
    GER_W3B0_RECEIPT_ID_PREFIX,
    entropy.receiptSeed
  );
  if (!receiptMint.ok) {
    return { ok: false, reason: `producer_receipt_id:${receiptMint.reason}` };
  }
  const logicalMint = mintIdentifier(
    GER_W3B0_LOGICAL_INVOCATION_ID_PREFIX,
    entropy.logicalSeed
  );
  if (!logicalMint.ok) {
    return {
      ok: false,
      reason: `producer_logical_invocation_id:${logicalMint.reason}`,
    };
  }
  const attemptMint = mintIdentifier(
    GER_W3B0_PROVIDER_ATTEMPT_ID_PREFIX,
    entropy.attemptSeed
  );
  if (!attemptMint.ok) {
    return {
      ok: false,
      reason: `producer_provider_attempt_id:${attemptMint.reason}`,
    };
  }

  const sanitizedRequestId =
    sanitizeGeminiEvidenceProducerRequestIdV1(requestId);

  return {
    ok: true,
    value: {
      relationship,
      receiptId: receiptMint.value,
      logicalInvocationId: logicalMint.value,
      providerAttemptId: attemptMint.value,
      requestId: sanitizedRequestId,
      createdAtIso,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 4 — Default-off identity gate (R-2)
// ---------------------------------------------------------------------------

const TRUTHY_FLAG_VALUES: ReadonlySet<string> = new Set([
  "1",
  "true",
  "yes",
  "on",
]);

/**
 * Pure default-off gate for producer identity plumbing. Returns false for any
 * absent / null / empty / false / "0" input, and true only for the explicit
 * boolean `true` or one of the recognized truthy string flag values. This
 * helper NEVER reads the process environment; the caller supplies the value.
 */
export function shouldUseGeminiEvidenceProducerIdentityV1(input: {
  enabled?: string | boolean | null;
}): boolean {
  const value = input?.enabled;
  if (value === true) return true;
  if (typeof value === "string") return TRUTHY_FLAG_VALUES.has(value);
  return false;
}

// ---------------------------------------------------------------------------
// Section 5 — Default-off accounting-context resolver (R-2)
// ---------------------------------------------------------------------------

export type GeminiEvidenceProducerAccountingContextResultV1<
  T extends Record<string, unknown>,
> =
  | { used: false; context: T }
  | { used: true; context: T & { attemptId: string } };

/**
 * Model, as a pure helper, what a future route integration would do with the
 * accounting context WITHOUT touching any producer-boundary lib file.
 *
 * R-2 (default-off byte identity): when the gate is off — or the gate is on but
 * no grammar-safe attemptId is available — the base accounting context is
 * returned UNCHANGED (the same object reference), so the disabled/default path
 * is byte-identical in the inspected accounting-context shape. No external
 * providerAttemptId is minted, passed into `withGeminiUsageAccounting`, or
 * injected. Only when the gate is on AND a grammar-safe attemptId is supplied
 * is a shallow-cloned context carrying `attemptId` returned.
 */
export function resolveGeminiEvidenceProducerAccountingContextV1<
  T extends Record<string, unknown>,
>(
  baseContext: T,
  input: { enabled?: string | boolean | null; attemptId?: string | null }
): GeminiEvidenceProducerAccountingContextResultV1<T> {
  if (!shouldUseGeminiEvidenceProducerIdentityV1(input)) {
    return { used: false, context: baseContext };
  }
  const attemptId = input.attemptId;
  if (
    typeof attemptId !== "string" ||
    identifierGrammarReason(attemptId) !== null
  ) {
    // Gate on but no usable attempt id: still leave the context untouched.
    return { used: false, context: baseContext };
  }
  return { used: true, context: { ...baseContext, attemptId } };
}

// ---------------------------------------------------------------------------
// Section 6 — Invocation receipt builder (gemini_invocation only)
// ---------------------------------------------------------------------------

/**
 * Build ONLY a sealed `gemini_invocation` receipt + its W1 wire envelope from a
 * grammar-safe producer identity.
 *
 * R-3 (mint placement): this builder is the outbound-call boundary. It requires
 * a non-null providerAttemptId and a `provider_call_started` outbound status,
 * modeling the point immediately before the Gemini provider call, after all
 * local preflight refusal points. It produces no pre-outbound refusal receipt.
 *
 * R-5: `provider_retry` is refused; retryOfProviderAttemptId and
 * priorInvocationReceipt are always null. The receipt is validated through the
 * frozen kernel `validateReceiptSet` and its envelope through the frozen W1
 * `parseGeminiEvidenceWireEnvelopeV1`.
 */
export function buildGeminiEvidenceInvocationReceiptEnvelopeForProducerV1(input: {
  identity: GeminiEvidenceProducerIdentityV1;
  outboundCallStatus: "provider_call_started";
}): GeminiEvidenceProducerInvocationResultV1 {
  const { identity, outboundCallStatus } = input;

  if (identity === null || typeof identity !== "object") {
    return { ok: false, reason: "producer_invocation_missing_identity" };
  }

  if (
    identity.relationship !== "initial" &&
    identity.relationship !== "operator_rerun"
  ) {
    // R-5: provider_retry (and anything else) is out of scope.
    return { ok: false, reason: "producer_invocation_unsupported_relationship" };
  }

  if (outboundCallStatus !== "provider_call_started") {
    return { ok: false, reason: "producer_invocation_invalid_outbound_status" };
  }

  if (identifierGrammarReason(identity.receiptId) !== null) {
    return { ok: false, reason: "producer_invocation_invalid_receipt_id" };
  }
  if (identifierGrammarReason(identity.logicalInvocationId) !== null) {
    return { ok: false, reason: "producer_invocation_invalid_logical_id" };
  }
  // R-3: providerAttemptId must be a non-null, grammar-safe minted value.
  if (identifierGrammarReason(identity.providerAttemptId) !== null) {
    return { ok: false, reason: "producer_invocation_invalid_provider_attempt" };
  }
  if (
    typeof identity.createdAtIso !== "string" ||
    !ISO_INSTANT_PATTERN.test(identity.createdAtIso)
  ) {
    return { ok: false, reason: "producer_invocation_invalid_created_at" };
  }

  const sanitizedRequestId = sanitizeGeminiEvidenceProducerRequestIdV1(
    identity.requestId
  );

  const invocationIdentity: InvocationIdentityV1 = {
    logicalInvocationId: identity.logicalInvocationId,
    requestId: sanitizedRequestId,
    providerAttemptId: identity.providerAttemptId,
    relationship: identity.relationship,
    retryOfProviderAttemptId: null,
  };

  const preflight: InvocationPreflightV1 = {
    status: "passed",
    outboundCallStatus,
    refusalReasons: [],
  };

  const receipt = buildInvocationReceipt({
    receiptId: identity.receiptId,
    identity: invocationIdentity,
    preflight,
    priorInvocationReceipt: null,
    createdAtIso: identity.createdAtIso,
  });

  const setResult = validateReceiptSet([receipt]);
  if (!setResult.ok) {
    return {
      ok: false,
      reason: `producer_invocation_receipt_invalid:${setResult.reason}`,
    };
  }

  const envelope = toGeminiEvidenceWireEnvelopeV1(receipt);
  const parsed = parseGeminiEvidenceWireEnvelopeV1(envelope);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `producer_invocation_envelope_invalid:${parsed.reason}`,
    };
  }

  return { ok: true, receipt, envelope };
}
