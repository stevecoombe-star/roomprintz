// GER-W3C.0 — Deterministic tests for the flag-gated raw provider-response byte
// capture hook at the Gemini auto-floor provider boundary.
//
// All tests are pure/local:
//   * `globalThis.fetch` is stubbed with a fake Response that returns EXACT raw
//     bytes (whitespace / key order / trailing newline preserved). No live
//     Gemini, no live network, no Supabase, no route, no browser.
//   * SHA-256 expectations are recomputed independently with node:crypto so the
//     tests assert the digest is over the exact HTTP body bytes captured via
//     `arrayBuffer()` — never `Response.text()`, parsed JSON, or
//     `JSON.stringify(parsed)`.
//   * node:fs is used ONLY for the deterministic implementation source
//     containment self-check.
//
// The accounting wrapper (`withGeminiUsageAccounting`) is a no-op here: with no
// Supabase service-role env present it never constructs a client and never
// touches the network.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  callGeminiAutoFloorDetection,
  GeminiAutoFloorError,
  type GeminiAutoFloorCallArgs,
  type GeminiProviderResponseCapture,
} from "@/lib/vibodeGeminiAutoFloorDetection";

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

const IMPL_SOURCE = readFileSync(
  new URL("../../../lib/vibodeGeminiAutoFloorDetection.ts", import.meta.url),
  "utf8"
);

/** The model-candidate JSON string the extractor should surface. */
const MODEL_TEXT_JSON = '{"quads":[]}';

/**
 * A NON-CANONICAL raw Gemini envelope: leading/trailing whitespace, indentation,
 * and a trailing newline. Chosen so `raw !== JSON.stringify(JSON.parse(raw))`,
 * which makes the reserialization-negative test meaningful. It still parses into
 * a valid envelope whose first candidate carries `MODEL_TEXT_JSON`.
 */
const NON_CANONICAL_RAW_ENVELOPE = `{
  "candidates": [
    {
      "finishReason": "STOP",
      "content": { "parts": [ { "text": ${JSON.stringify(MODEL_TEXT_JSON)} } ] }
    }
  ]
}
`;

function baseArgs(
  overrides?: Partial<GeminiAutoFloorCallArgs>
): GeminiAutoFloorCallArgs {
  return {
    apiKey: "fixture-key",
    model: "gemini-fixture-model",
    prompt: "fixture-prompt",
    responseSchema: {},
    imageBase64: "AAAA",
    mime: "image/png",
    temperature: 0,
    maxOutputTokens: 256,
    timeoutMs: 60_000,
    accounting: { requestId: "req-fixture-w3c0", route: null, userId: null },
    ...overrides,
  };
}

type FakeResponseHandle = {
  res: {
    ok: boolean;
    status: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  };
  calls: { arrayBuffer: number; json: number; text: number };
  bytes: Buffer;
};

/**
 * A fake Response returning EXACTLY the provided raw string as UTF-8 bytes,
 * tracking which body accessor was used so the default-off legacy path
 * (`res.json()`) can be distinguished from the enabled capture path
 * (`res.arrayBuffer()`).
 */
function makeFakeResponse(rawString: string, status = 200): FakeResponseHandle {
  const bytes = Buffer.from(rawString, "utf8");
  const calls = { arrayBuffer: 0, json: 0, text: 0 };
  const res = {
    ok: status >= 200 && status < 300,
    status,
    async arrayBuffer(): Promise<ArrayBuffer> {
      calls.arrayBuffer += 1;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async json(): Promise<unknown> {
      calls.json += 1;
      return JSON.parse(rawString);
    },
    async text(): Promise<string> {
      calls.text += 1;
      return rawString;
    },
  };
  return { res, calls, bytes };
}

/** Runs `fn` with `globalThis.fetch` stubbed to resolve to `res`, then restores. */
async function withStubbedFetch<T>(
  handle: FakeResponseHandle,
  fn: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => handle.res;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function sha256Hex(input: Buffer | string): string {
  return createHash("sha256")
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

// ===========================================================================
// Group A — default-off path
// ===========================================================================

test("A: hook absent -> legacy res.json() path, arrayBuffer never read, normal result", async () => {
  const handle = makeFakeResponse(NON_CANONICAL_RAW_ENVELOPE);
  const result = await withStubbedFetch(handle, () =>
    callGeminiAutoFloorDetection(baseArgs())
  );
  assert.deepEqual(result.raw, { quads: [] });
  assert.equal(handle.calls.json, 1, "disabled mode must consume via res.json()");
  assert.equal(
    handle.calls.arrayBuffer,
    0,
    "disabled mode must never read the raw byte buffer"
  );
});

test("A: no capture args field is populated when caller omits the hook", async () => {
  const handle = makeFakeResponse(NON_CANONICAL_RAW_ENVELOPE);
  const args = baseArgs();
  assert.equal(
    "onProviderResponseCaptured" in args,
    false,
    "baseline call args must not carry a capture hook"
  );
  const result = await withStubbedFetch(handle, () =>
    callGeminiAutoFloorDetection(args)
  );
  assert.deepEqual(result.raw, { quads: [] });
});

// ===========================================================================
// Group B — enabled raw-byte capture
// ===========================================================================

test("B: hook called exactly once with exact byte digest / length / decode; result still works", async () => {
  const handle = makeFakeResponse(NON_CANONICAL_RAW_ENVELOPE);
  const captures: GeminiProviderResponseCapture[] = [];

  const result = await withStubbedFetch(handle, () =>
    callGeminiAutoFloorDetection(
      baseArgs({
        onProviderResponseCaptured: async (capture) => {
          captures.push(capture);
          return { ok: true };
        },
      })
    )
  );

  assert.equal(captures.length, 1, "hook must be called exactly once");
  const [capture] = captures;
  assert.equal(handle.calls.arrayBuffer, 1, "enabled mode reads bytes once");
  assert.equal(handle.calls.json, 0, "enabled mode must not use res.json()");

  assert.equal(capture.byteLength, handle.bytes.byteLength);
  assert.equal(capture.byteLength, Buffer.byteLength(NON_CANONICAL_RAW_ENVELOPE, "utf8"));
  assert.equal(capture.rawResponseText, handle.bytes.toString("utf8"));
  assert.equal(capture.rawResponseText, NON_CANONICAL_RAW_ENVELOPE);
  assert.equal(capture.httpStatus, 200);
  assert.equal(capture.rawResponseBytesSha256Hex, sha256Hex(handle.bytes));

  assert.deepEqual(result.raw, { quads: [] });
});

test("B: hook runs before ANY JSON.parse (envelope parse ordering proof)", async () => {
  const handle = makeFakeResponse(NON_CANONICAL_RAW_ENVELOPE);
  const order: Array<{ kind: "hook" } | { kind: "parse"; arg: unknown }> = [];

  const originalParse = JSON.parse;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (JSON as any).parse = (...parseArgs: [string, ...unknown[]]) => {
    order.push({ kind: "parse", arg: parseArgs[0] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalParse as any).apply(JSON, parseArgs);
  };
  try {
    await withStubbedFetch(handle, () =>
      callGeminiAutoFloorDetection(
        baseArgs({
          onProviderResponseCaptured: async () => {
            order.push({ kind: "hook" });
            return { ok: true };
          },
        })
      )
    );
  } finally {
    JSON.parse = originalParse;
  }

  assert.ok(order.length >= 2, "expected a hook entry followed by parse entries");
  assert.equal(order[0].kind, "hook", "hook must precede the first JSON.parse");
  const firstParse = order.find((e) => e.kind === "parse");
  assert.ok(firstParse && firstParse.kind === "parse");
  assert.equal(
    firstParse.arg,
    NON_CANONICAL_RAW_ENVELOPE,
    "the first JSON.parse must be over the exact raw response text"
  );
});

// ===========================================================================
// Group C — reserialization negative
// ===========================================================================

test("C: digest is over raw bytes, NOT JSON.stringify(JSON.parse(raw))", async () => {
  // Precondition: the fixture is genuinely non-canonical.
  const reserialized = JSON.stringify(JSON.parse(NON_CANONICAL_RAW_ENVELOPE));
  assert.notEqual(
    NON_CANONICAL_RAW_ENVELOPE,
    reserialized,
    "fixture must be non-canonical for this test to be meaningful"
  );

  const rawBytesDigest = sha256Hex(NON_CANONICAL_RAW_ENVELOPE);
  const reserializedDigest = sha256Hex(reserialized);
  assert.notEqual(
    rawBytesDigest,
    reserializedDigest,
    "raw-byte digest must differ from the reserialized-JSON digest"
  );

  const handle = makeFakeResponse(NON_CANONICAL_RAW_ENVELOPE);
  let observed: string | null = null;
  await withStubbedFetch(handle, () =>
    callGeminiAutoFloorDetection(
      baseArgs({
        onProviderResponseCaptured: async (capture) => {
          observed = capture.rawResponseBytesSha256Hex;
          return { ok: true };
        },
      })
    )
  );

  assert.equal(observed, rawBytesDigest, "hook must receive the raw-byte digest");
  assert.notEqual(
    observed,
    reserializedDigest,
    "hook must NOT receive the reserialized digest"
  );
});

// ===========================================================================
// Group D — hook refusal
// ===========================================================================

test("D: refusal aborts before parse, returns typed safe error with stable reason", async () => {
  const handle = makeFakeResponse(NON_CANONICAL_RAW_ENVELOPE);
  const STABLE_REASON = "capture_binding_unavailable";
  const rawDigest = sha256Hex(NON_CANONICAL_RAW_ENVELOPE);

  const order: Array<"hook" | "parse"> = [];
  const originalParse = JSON.parse;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (JSON as any).parse = (...parseArgs: [string, ...unknown[]]) => {
    if (parseArgs[0] === NON_CANONICAL_RAW_ENVELOPE) order.push("parse");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalParse as any).apply(JSON, parseArgs);
  };

  let thrown: unknown;
  try {
    await withStubbedFetch(handle, () =>
      callGeminiAutoFloorDetection(
        baseArgs({
          onProviderResponseCaptured: async () => {
            order.push("hook");
            return { ok: false, reason: STABLE_REASON };
          },
        })
      )
    );
  } catch (err) {
    thrown = err;
  } finally {
    JSON.parse = originalParse;
  }

  assert.ok(thrown instanceof GeminiAutoFloorError, "must be a typed error");
  const error = thrown as GeminiAutoFloorError;
  assert.equal(error.stage, "raw_response_capture");
  assert.equal(error.code, "RAW_RESPONSE_CAPTURE_REFUSED");
  assert.equal(error.captureReason, STABLE_REASON, "error must carry the stable reason");

  // Parse pipeline of the raw envelope must NOT have been reached.
  assert.ok(order.includes("hook"), "hook must have run");
  assert.equal(
    order.includes("parse"),
    false,
    "the raw envelope must never be parsed after refusal"
  );

  // Error must carry neither the raw text nor the digest hex in any field.
  const fieldValues = [
    error.message,
    error.captureReason,
    error.sanitizedMessage,
    error.debugExcerpt,
    JSON.stringify(error.diagnostics),
  ]
    .filter((v): v is string => typeof v === "string")
    .join("\u0000");
  assert.equal(
    fieldValues.includes(NON_CANONICAL_RAW_ENVELOPE),
    false,
    "error must not carry raw response text"
  );
  assert.equal(fieldValues.includes(rawDigest), false, "error must not carry digest hex");
  assert.equal(error.sanitizedMessage, null);
  assert.equal(error.debugExcerpt, null);
  assert.equal(error.diagnostics, null);
});

// ===========================================================================
// Group E — malformed JSON in enabled mode
// ===========================================================================

test("E: malformed 2xx body -> hook still called with exact bytes, then fails safely", async () => {
  const MALFORMED = "this is <not> json at all\n";
  const handle = makeFakeResponse(MALFORMED);
  const captures: GeminiProviderResponseCapture[] = [];

  let thrown: unknown;
  try {
    await withStubbedFetch(handle, () =>
      callGeminiAutoFloorDetection(
        baseArgs({
          onProviderResponseCaptured: async (capture) => {
            captures.push(capture);
            return { ok: true };
          },
        })
      )
    );
  } catch (err) {
    thrown = err;
  }

  assert.equal(captures.length, 1, "hook must still be called on malformed bodies");
  assert.equal(captures[0].byteLength, Buffer.byteLength(MALFORMED, "utf8"));
  assert.equal(captures[0].rawResponseText, MALFORMED);
  assert.equal(captures[0].rawResponseBytesSha256Hex, sha256Hex(MALFORMED));

  assert.ok(thrown instanceof GeminiAutoFloorError, "must fail with a typed error");
  const error = thrown as GeminiAutoFloorError;
  assert.equal(error.stage, "json_parse");
  assert.equal(error.code, "ENVELOPE_PARSE_ERROR");
  // The honest failure must not smuggle the raw text out.
  assert.equal(
    (error.message + String(error.sanitizedMessage) + String(error.debugExcerpt)).includes(
      MALFORMED.trim()
    ),
    false,
    "malformed-body error must not carry the raw text"
  );
});

// ===========================================================================
// No-leak: implementation logs nothing for any enabled-mode scenario
// ===========================================================================

test("no-leak: enabled-mode scenarios log no raw text / digest to console", async () => {
  const raw = NON_CANONICAL_RAW_ENVELOPE;
  const rawDigest = sha256Hex(raw);

  const logged: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => console[m]);
  for (const m of methods) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any)[m] = (...cargs: unknown[]) => {
      logged.push(cargs.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }

  try {
    // Accept.
    await withStubbedFetch(makeFakeResponse(raw), () =>
      callGeminiAutoFloorDetection(
        baseArgs({ onProviderResponseCaptured: async () => ({ ok: true }) })
      )
    );
    // Refuse.
    await withStubbedFetch(makeFakeResponse(raw), () =>
      callGeminiAutoFloorDetection(
        baseArgs({
          onProviderResponseCaptured: async () => ({ ok: false, reason: "nope" }),
        })
      )
    ).catch(() => undefined);
    // Malformed.
    await withStubbedFetch(makeFakeResponse("not-json\n"), () =>
      callGeminiAutoFloorDetection(
        baseArgs({ onProviderResponseCaptured: async () => ({ ok: true }) })
      )
    ).catch(() => undefined);
  } finally {
    methods.forEach((m, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[m] = originals[i];
    });
  }

  const joined = logged.join("\n");
  assert.equal(joined.includes(raw), false, "must not log raw response text");
  assert.equal(joined.includes(rawDigest), false, "must not log the digest hex");
});

// ===========================================================================
// Group F — source containment
// ===========================================================================

test("F: implementation imports only node:crypto + the accounting boundary", () => {
  const fromTargets = [...IMPL_SOURCE.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set(["node:crypto", "@/lib/vibodeGeminiUsageAccounting"]);
  for (const target of fromTargets) {
    assert.equal(allowed.has(target), true, `unexpected import target: ${target}`);
  }
  // Executable server-only guard, no bare require().
  assert.equal(/^\s*import\s+["']server-only["']\s*;?\s*$/m.test(IMPL_SOURCE), true);
  assert.equal(/\brequire\(/.test(IMPL_SOURCE), false, "must not use require()");
});

test("F: implementation has no receipt/ledger/supabase/storage/route/env scope creep", () => {
  // NOTE: the capture stage `provider_response_capture` and doc comments about the
  // `raw-provider-response-text/v1` DIGEST SCOPE legitimately contain the words
  // "provider response"; scope creep is proven instead by banning the receipt
  // TYPE token, the receipt/ledger/wire module imports, and all persistence/IO.
  for (const fragment of [
    "gemini_provider_response", // the W1 receipt-type token (would imply receipts)
    "gemini-evidence-receipt-ledger",
    "gemini-evidence-wire",
    "gemini-evidence-producer-receipts",
    "gemini-evidence-contract",
    "@supabase/supabase-js",
    "@supabase/ssr",
    ".upload(",
    "storage",
    "route.ts",
    "detect-vision/route",
    "process.env",
    ".insert(",
    ".upsert(",
  ]) {
    assert.equal(
      IMPL_SOURCE.includes(fragment),
      false,
      `implementation must not reference ${fragment}`
    );
  }
});

test("F: digest basis is exactly the raw response bytes (not reserialized JSON)", () => {
  // The one SHA-256 site updates over the captured byte buffer.
  assert.ok(
    /createHash\("sha256"\)\s*\.update\(rawBytes\)/.test(IMPL_SOURCE),
    "digest must be computed over the exact captured raw byte buffer"
  );
  // No digest is ever taken over reserialized / stringified parsed output.
  assert.equal(
    /\.update\(\s*(?:Buffer\.from\()?JSON\.stringify/.test(IMPL_SOURCE),
    false,
    "digest must never be over JSON.stringify(...)"
  );
  // Bytes are captured via arrayBuffer() (exact HTTP body bytes), not
  // Response.text(), res.json(), or any parsed/reserialized form.
  assert.ok(
    /new Uint8Array\(await res\.arrayBuffer\(\)\)/.test(IMPL_SOURCE),
    "raw bytes must be captured via arrayBuffer()"
  );
  assert.ok(
    IMPL_SOURCE.includes('new TextDecoder("utf-8").decode(rawBytes)'),
    "raw text must be a UTF-8 decode of the captured bytes"
  );
});
