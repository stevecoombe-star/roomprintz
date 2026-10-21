export const CLEANUP_HISTORY_LABEL = "Clean Up Room";

export const CLEANUP_HISTORY_NOTE =
  "This saves the generated image to Image History at its output size. Vibode uses its existing aspect-compatible image handling. It does not certify a new camera or change the room.";

export function isCleanupHistoryAsset(asset: unknown): boolean {
  const row = record(asset);
  if (!row) return false;
  const metadata = record(row.metadata);
  return Boolean(uuid(row.cleanup_job_id) ?? uuid(row.cleanupJobId) ?? uuid(metadata?.cleanupJobId));
}

/** Cards already shown by a lineage group stay out of the fallback strip. */
export function cleanupHistoryFallbackVersions<T extends { id: string }>(
  versions: readonly T[],
  visibleIds: ReadonlySet<string>,
): T[] {
  const seen = new Set<string>();
  const hidden: T[] = [];
  for (const version of versions) {
    if (!version.id || seen.has(version.id) || visibleIds.has(version.id) || !isCleanupHistoryAsset(version)) continue;
    seen.add(version.id);
    hidden.push(version);
  }
  return hidden;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
