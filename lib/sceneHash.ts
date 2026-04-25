// lib/sceneHash.ts
// ==============================
// Canonical JSON + SHA-256 (universal: browser + node)
// ==============================

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json | undefined };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Canonicalize JSON:
 * - Sort object keys lexicographically
 * - Drop undefined values
 * - Keep array order as-is
 */
export function canonicalizeJson(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (isPlainObject(value)) {
    const out: Record<string, Json> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      const v = (value as Record<string, Json | undefined>)[k];
      if (typeof v === "undefined") continue;
      out[k] = canonicalizeJson(v);
    }
    return out;
  }

  return value;
}

export function canonicalStringify(value: Json): string {
  return JSON.stringify(canonicalizeJson(value));
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/**
 * SHA-256 hex digest that works in:
 * - Browser (crypto.subtle)
 * - Node (require("crypto"))
 *
 * NOTE: async because browser subtle digest is async.
 */
export async function sha256Hex(input: string): Promise<string> {
  // Browser / modern runtimes with Web Crypto
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.subtle?.digest) {
    const enc = new TextEncoder();
    const data = enc.encode(input);
    const hashBuf = await webCrypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(hashBuf));
  }

  // Node fallback
    const nodeCrypto = await import("crypto");
  return nodeCrypto.createHash("sha256").update(input, "utf8").digest("hex");
}
