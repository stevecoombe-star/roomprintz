export type CanonicalObjectStore = Readonly<{
  download: (bucket: string, path: string) => Promise<Uint8Array | null>;
  putIfAbsent: (
    bucket: string,
    path: string,
    bytes: Uint8Array,
  ) => Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: "exists" | "unavailable" }>>;
}>;

export type CanonicalPlacement = "created" | "present" | "conflict" | "unavailable";

/**
 * A missing object is created. Identical bytes are a no-op.
 * Different bytes stay untouched. Callers must use a store that
 * does not overwrite an existing object.
 */
export async function placeIdenticalCanonicalObject(
  store: CanonicalObjectStore,
  bucket: string,
  path: string,
  bytes: Uint8Array,
): Promise<CanonicalPlacement> {
  const existing = await store.download(bucket, path);
  if (existing && existing.byteLength > 0) {
    return sameBytes(existing, bytes) ? "present" : "conflict";
  }
  const placed = await store.putIfAbsent(bucket, path, bytes);
  if (placed.ok) return "created";
  const after = await store.download(bucket, path);
  if (after && after.byteLength > 0) {
    return sameBytes(after, bytes) ? "present" : "conflict";
  }
  return "unavailable";
}

/** True when a storage write may still finish inside the recovery lease. */
export function canonicalWriteAllowed(deadlineMs: number | null, nowMs: number): boolean {
  return deadlineMs == null || nowMs < deadlineMs;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength || left.byteLength === 0) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
