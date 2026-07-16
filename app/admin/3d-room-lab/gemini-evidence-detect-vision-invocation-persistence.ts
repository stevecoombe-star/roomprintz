// GER-W3B.4 — Default-off detect-vision gemini_invocation ledger persistence.
//
// This module is the ONLY route-adjacent seam that writes an already-built
// gemini_invocation W1 envelope into the frozen GER-W2D ledger. It exists so the
// detect-vision route can persist the invocation receipt WITHOUT importing any
// Supabase / service-client symbol itself: the route imports only this helper,
// and this helper delegates exclusively to the W2D public API.
//
// STRICT W3B.4 SCOPE. This module persists ONLY the gemini_invocation envelope.
// It deliberately does NOT:
//   * enable or build any downstream (non-invocation) evidence receipt kind,
//   * capture, reparse, or retain raw provider text or image bytes,
//   * apply migrations, execute route handlers, or call Gemini,
//   * return the persisted row, the receipt, the canonical payload, or the
//     envelope body to the caller,
//   * log anything (the route owns all safe, metadata-only logging),
//   * grant any camera / calibration authority, or advance P-empty lineage.
//
// R-4 (executable server-only guard): this module begins with a real,
// executable `import "server-only";` statement — never an inert bare
// "server-only"; expression — so it can never be bundled into a client build.

import "server-only";

import {
  createGeminiEvidenceReceiptLedgerServiceClient,
  createSupabaseGeminiEvidenceReceiptLedgerClientV1,
  insertGeminiEvidenceReceiptEnvelopeV1,
  GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON,
  type AsyncGeminiEvidenceReceiptLedgerClientV1,
  type GeminiEvidenceReceiptLedgerServiceEnvSource,
} from "./gemini-evidence-receipt-ledger";

import type { GeminiEvidenceWireEnvelopeV1 } from "./gemini-evidence-wire";

/** Stable, conservative reason for an unexpected non-read thrown error. */
export const GER_W3B4_PERSIST_UNEXPECTED_ERROR_REASON =
  "ledger_persist_unexpected_error";

export type PersistDetectVisionGeminiEvidenceInvocationResultV1 =
  | { status: "persisted"; outcome: "inserted" | "idempotent" }
  | { status: "error"; reason: string };

/**
 * Persist an already-built gemini_invocation envelope into the W2D ledger.
 *
 * Contract:
 *   * if `client` is provided it is used verbatim (deterministic tests inject a
 *     fake async client wrapping the W2B fake repository),
 *   * if `client` is absent a real service-role client is constructed via the
 *     W2D factory (defaulting to the ambient server env, overridable via
 *     `serviceEnvSource` for deterministic fail-closed tests) and wrapped with
 *     the W2D Supabase adapter,
 *   * the insert goes through the frozen W2D `insertGeminiEvidenceReceiptEnvelopeV1`
 *     repository protocol; snapshots are intentionally null for this slice.
 *
 * The result reports ONLY a coarse status + outcome/reason. It never returns the
 * row, the receipt, the canonical payload, or the envelope body, and it logs
 * nothing. A missing service env is mapped to the stable
 * `ledger_service_env_missing` reason; any other thrown error is mapped
 * conservatively to a stable reason. All W2D repository refusals (integrity
 * conflict, digest mismatch, provider-attempt reuse, forked lineage, read
 * failure, etc.) are surfaced verbatim as the error reason.
 */
export async function persistDetectVisionGeminiEvidenceInvocationEnvelopeV1(input: {
  envelope: GeminiEvidenceWireEnvelopeV1;
  createdAt: string;
  client?: AsyncGeminiEvidenceReceiptLedgerClientV1;
  serviceEnvSource?: GeminiEvidenceReceiptLedgerServiceEnvSource;
}): Promise<PersistDetectVisionGeminiEvidenceInvocationResultV1> {
  let client = input.client;
  if (!client) {
    try {
      const supabase =
        input.serviceEnvSource === undefined
          ? createGeminiEvidenceReceiptLedgerServiceClient()
          : createGeminiEvidenceReceiptLedgerServiceClient(input.serviceEnvSource);
      client = createSupabaseGeminiEvidenceReceiptLedgerClientV1(supabase);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message === GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON
      ) {
        return { status: "error", reason: GER_W2_LEDGER_SERVICE_ENV_MISSING_REASON };
      }
      return { status: "error", reason: GER_W3B4_PERSIST_UNEXPECTED_ERROR_REASON };
    }
  }

  try {
    const inserted = await insertGeminiEvidenceReceiptEnvelopeV1(client, {
      envelope: input.envelope,
      createdAt: input.createdAt,
    });
    if (inserted.ok) {
      return { status: "persisted", outcome: inserted.outcome };
    }
    return { status: "error", reason: inserted.reason };
  } catch {
    // insertGeminiEvidenceReceiptEnvelopeV1 already maps genuine read errors to
    // ledger_read_failed; only a truly unexpected throw reaches here.
    return { status: "error", reason: GER_W3B4_PERSIST_UNEXPECTED_ERROR_REASON };
  }
}
