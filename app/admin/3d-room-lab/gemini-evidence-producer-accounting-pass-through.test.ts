// GER-W3B.1 — Deterministic tests for the additive, default-off optional
// `attemptId` pass-through through the auto-floor Gemini accounting boundary.
//
// These tests are pure: no current time, randomness, env, network, DB,
// Supabase, Gemini, or route execution is exercised. The pure context-builder
// helper is tested directly for byte-identical default-off behavior, and
// node:fs is used ONLY for deterministic source self-checks (containment).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAutoFloorGeminiAccountingContext,
  type GeminiAutoFloorAccounting,
} from "@/lib/vibodeGeminiAutoFloorDetection";

// ---------------------------------------------------------------------------
// Deterministic fixtures (fixed literals only)
// ---------------------------------------------------------------------------

const MODEL = "gemini-fixture-model";
const MIME = "image/png";
const REQUEST_ID = "req-fixture-123";
const ROUTE = "/api/admin/3d-room-lab/auto-floor/detect-vision";
const USER_ID = "user-fixture-9";
const ATTEMPT_ID = "google_gemini:auto-floor:req-fixture-123:ger-attempt-seed-1";

const AUTO_FLOOR_DETECTION_SOURCE = readFileSync(
  new URL("../../../lib/vibodeGeminiAutoFloorDetection.ts", import.meta.url),
  "utf8"
);
const AUTO_FLOOR_VISION_SOURCE = readFileSync(
  new URL("../../../lib/vibodeAutoFloorVisionDetect.ts", import.meta.url),
  "utf8"
);

// The expected default-off context, built independently of the helper so the
// test asserts an exact literal rather than a re-derivation of the same code.
function expectedBaseContext(accounting?: GeminiAutoFloorAccounting) {
  return {
    requestId: accounting?.requestId ?? null,
    userId: accounting?.userId ?? null,
    provider: "google_gemini",
    model: MODEL,
    workflowType: "auto-floor-detect",
    actionType: "vision-floor-detect",
    route: accounting?.route ?? ROUTE,
    service: "roomprintz-ui",
    imageCount: 1,
    metadata: {
      mime: MIME,
      modelVersion: MODEL,
      endpointKind: "google_generate_content_v1beta",
      purpose: "auto-floor-vision",
    },
  };
}

// ---------------------------------------------------------------------------
// 1) Absent attemptId preserves existing accounting context fields
// ---------------------------------------------------------------------------

test("1) absent attemptId yields the pre-W3B.1 context exactly (no attemptId key)", () => {
  const accounting: GeminiAutoFloorAccounting = {
    requestId: REQUEST_ID,
    route: ROUTE,
    userId: USER_ID,
  };
  const ctx = buildAutoFloorGeminiAccountingContext({
    model: MODEL,
    mime: MIME,
    accounting,
  });
  assert.deepEqual(ctx, expectedBaseContext(accounting));
  assert.equal("attemptId" in ctx, false);
});

test("1b) undefined accounting yields the byte-identical default context", () => {
  const ctx = buildAutoFloorGeminiAccountingContext({ model: MODEL, mime: MIME });
  assert.deepEqual(ctx, expectedBaseContext(undefined));
  assert.equal("attemptId" in ctx, false);
});

test("1c) explicit undefined attemptId is treated as absent (no attemptId key)", () => {
  const accounting: GeminiAutoFloorAccounting = {
    requestId: REQUEST_ID,
    route: ROUTE,
    userId: USER_ID,
    attemptId: undefined,
  };
  const ctx = buildAutoFloorGeminiAccountingContext({
    model: MODEL,
    mime: MIME,
    accounting,
  });
  assert.deepEqual(ctx, expectedBaseContext(accounting));
  assert.equal("attemptId" in ctx, false);
});

// ---------------------------------------------------------------------------
// 2) Provided attemptId is passed through unchanged
// ---------------------------------------------------------------------------

test("2) provided attemptId is passed through unchanged, other fields preserved", () => {
  const accounting: GeminiAutoFloorAccounting = {
    requestId: REQUEST_ID,
    route: ROUTE,
    userId: USER_ID,
    attemptId: ATTEMPT_ID,
  };
  const ctx = buildAutoFloorGeminiAccountingContext({
    model: MODEL,
    mime: MIME,
    accounting,
  });
  assert.deepEqual(ctx, { ...expectedBaseContext(accounting), attemptId: ATTEMPT_ID });
  assert.equal(ctx.attemptId, ATTEMPT_ID);
});

test("2b) attemptId is not sanitized/altered by the producer boundary", () => {
  // A value that would be rejected by a grammar sanitizer must still pass
  // through untouched here — sanitization is the route slice's job, not this
  // additive boundary's.
  const weird = "attempt with spaces and é";
  const ctx = buildAutoFloorGeminiAccountingContext({
    model: MODEL,
    mime: MIME,
    accounting: { requestId: REQUEST_ID, route: ROUTE, userId: USER_ID, attemptId: weird },
  });
  assert.equal(ctx.attemptId, weird);
});

// ---------------------------------------------------------------------------
// 3) requestId remains requestId and is not used as attemptId
// ---------------------------------------------------------------------------

test("3) requestId is never reused as attemptId", () => {
  const accounting: GeminiAutoFloorAccounting = {
    requestId: REQUEST_ID,
    route: ROUTE,
    userId: USER_ID,
  };
  const ctx = buildAutoFloorGeminiAccountingContext({
    model: MODEL,
    mime: MIME,
    accounting,
  });
  assert.equal(ctx.requestId, REQUEST_ID);
  assert.equal("attemptId" in ctx, false);

  // Even when both are present, they stay distinct and independent.
  const withBoth = buildAutoFloorGeminiAccountingContext({
    model: MODEL,
    mime: MIME,
    accounting: { ...accounting, attemptId: ATTEMPT_ID },
  });
  assert.equal(withBoth.requestId, REQUEST_ID);
  assert.equal(withBoth.attemptId, ATTEMPT_ID);
  assert.notEqual(withBoth.attemptId, withBoth.requestId);
});

// ---------------------------------------------------------------------------
// 4-5) No attemptId minting in either producer lib
// ---------------------------------------------------------------------------

test("4) no attemptId is minted in lib/vibodeGeminiAutoFloorDetection.ts", () => {
  // No id-minting primitives are used to fabricate an attemptId.
  assert.equal(AUTO_FLOOR_DETECTION_SOURCE.includes("buildAttemptId"), false);
  assert.equal(AUTO_FLOOR_DETECTION_SOURCE.includes("randomUUID"), false);
  assert.equal(AUTO_FLOOR_DETECTION_SOURCE.includes("Math.random"), false);
  // attemptId is only ever read from the caller-supplied accounting object,
  // never assigned a default/fallback expression.
  assert.equal(/attemptId\s*[:=]\s*[^;\n]*\?\?/.test(AUTO_FLOOR_DETECTION_SOURCE), false);
});

test("5) no attemptId is minted in lib/vibodeAutoFloorVisionDetect.ts", () => {
  assert.equal(AUTO_FLOOR_VISION_SOURCE.includes("buildAttemptId"), false);
  assert.equal(AUTO_FLOOR_VISION_SOURCE.includes("randomUUID"), false);
  assert.equal(AUTO_FLOOR_VISION_SOURCE.includes("Math.random"), false);
  // The vision lib only forwards the caller's accounting object; it never
  // constructs an attemptId value.
  assert.equal(/attemptId\s*[:=]\s*["'`]/.test(AUTO_FLOOR_VISION_SOURCE), false);
});

// ---------------------------------------------------------------------------
// 6) No process.env flag read in producer libs
// ---------------------------------------------------------------------------

test("6) producer libs read no process.env / introduce no env flag", () => {
  assert.equal(AUTO_FLOOR_DETECTION_SOURCE.includes("process.env"), false);
  assert.equal(AUTO_FLOOR_VISION_SOURCE.includes("process.env"), false);
});

// ---------------------------------------------------------------------------
// 7) No ledger insert/import in producer libs
// ---------------------------------------------------------------------------

test("7) producer libs contain no ledger insert / receipt / Supabase / DB import", () => {
  const forbidden = [
    "insertGeminiEvidenceReceiptEnvelopeV1",
    "insertGeminiEvidenceReceiptEnvelopeForTestV1",
    "gemini-evidence-receipt-ledger",
    "gemini-evidence-producer-receipts",
    "@supabase/supabase-js",
    "@supabase/ssr",
    "provider_response",
    "gemini_provider_response",
    "calibrationAuthority",
    ".from(",
    ".upsert(",
    ".insert(",
  ];
  for (const fragment of forbidden) {
    assert.equal(
      AUTO_FLOOR_DETECTION_SOURCE.includes(fragment),
      false,
      `vibodeGeminiAutoFloorDetection.ts must not reference ${fragment}`
    );
    assert.equal(
      AUTO_FLOOR_VISION_SOURCE.includes(fragment),
      false,
      `vibodeAutoFloorVisionDetect.ts must not reference ${fragment}`
    );
  }
});

// ---------------------------------------------------------------------------
// 8) No route file modified (the pass-through never edits the route source)
// ---------------------------------------------------------------------------

test("8) detect-vision route source is untouched by W3B.1 (no attemptId wiring)", () => {
  const routeSource = readFileSync(
    new URL(
      "../../../app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts",
      import.meta.url
    ),
    "utf8"
  );
  // The route must not yet thread an attemptId into accounting; that is the
  // deferred route-integration slice, not W3B.1.
  assert.equal(routeSource.includes("attemptId"), false);
});

// ---------------------------------------------------------------------------
// 9) Source-level shape assertions of the additive pass-through
// ---------------------------------------------------------------------------

test("9) GeminiAutoFloorAccounting declares an optional attemptId", () => {
  assert.match(AUTO_FLOOR_DETECTION_SOURCE, /attemptId\?\s*:\s*string/);
});

test("10) the accounting context forwards attemptId only when present", () => {
  // The helper spreads attemptId into a shallow clone guarded by a typeof
  // check, so no attemptId key appears on the default-off path.
  assert.match(
    AUTO_FLOOR_DETECTION_SOURCE,
    /typeof\s+accounting\?\.attemptId\s*===\s*"string"/
  );
  assert.match(AUTO_FLOOR_DETECTION_SOURCE, /attemptId:\s*accounting\.attemptId/);
});
