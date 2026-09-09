import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Fail-closed durable artifact check. A mismatch is a cache miss, never a
 * reason to rewrite the persisted hash.
 */
export function durableArtifactBytesMatch(input: Readonly<{
  bytes: Uint8Array;
  sha256: string;
  byteCount?: number | null;
}>): boolean {
  if (input.bytes.byteLength === 0) return false;
  if (typeof input.sha256 !== "string" || input.sha256.length !== 64) {
    return false;
  }
  if (
    typeof input.byteCount === "number" &&
    input.bytes.byteLength !== input.byteCount
  ) {
    return false;
  }
  return sha256Hex(input.bytes) === input.sha256;
}
