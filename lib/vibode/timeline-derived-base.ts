import type { VibodeVersionKind } from "@/lib/vibode/version-kind";

export type TimelineDerivedBaseVersionKind = VibodeVersionKind | "original";

export type TimelineDerivedBaseVersion = {
  id: string;
  parentVersionId?: string | null;
  normalizedVersionKind?: TimelineDerivedBaseVersionKind | null;
  asset_type?: string | null;
};

export type ResolveTimelineDerivedBaseResult =
  | {
      ok: true;
      baseVersionId: string;
      selectedVersionId: string;
      strategy:
        | "selected_original"
        | "selected_set"
        | "nearest_set_ancestor"
        | "nearest_original_ancestor";
      ancestorPath: string[];
    }
  | {
      ok: false;
      selectedVersionId: string | null;
      reason:
        | "missing_selected_version_id"
        | "selected_version_not_found"
        | "no_timeline_base_found";
      ancestorPath: string[];
    };

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeVersionKind(value: unknown): TimelineDerivedBaseVersionKind | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (
    normalized === "original" ||
    normalized === "set" ||
    normalized === "stage" ||
    normalized === "style" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return null;
}

function isOriginalVersion(version: TimelineDerivedBaseVersion): boolean {
  if (normalizeVersionKind(version.normalizedVersionKind) === "original") return true;
  return normalizeText(version.asset_type)?.toLowerCase() === "base";
}

function isSetVersion(version: TimelineDerivedBaseVersion): boolean {
  return normalizeVersionKind(version.normalizedVersionKind) === "set";
}

function normalizeVersionsById(
  versions: TimelineDerivedBaseVersion[]
): Map<string, TimelineDerivedBaseVersion> {
  const byId = new Map<string, TimelineDerivedBaseVersion>();
  for (const version of versions) {
    const id = normalizeText(version?.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, version);
  }
  return byId;
}

export function resolveTimelineDerivedBaseVersionId(params: {
  versions: TimelineDerivedBaseVersion[];
  selectedVersionId: string | null | undefined;
}): ResolveTimelineDerivedBaseResult {
  const selectedVersionId = normalizeText(params.selectedVersionId);
  if (!selectedVersionId) {
    return {
      ok: false,
      selectedVersionId: null,
      reason: "missing_selected_version_id",
      ancestorPath: [],
    };
  }

  const versionsById = normalizeVersionsById(Array.isArray(params.versions) ? params.versions : []);
  const selectedVersion = versionsById.get(selectedVersionId);
  if (!selectedVersion) {
    return {
      ok: false,
      selectedVersionId,
      reason: "selected_version_not_found",
      ancestorPath: [],
    };
  }

  if (isOriginalVersion(selectedVersion)) {
    return {
      ok: true,
      baseVersionId: selectedVersion.id,
      selectedVersionId,
      strategy: "selected_original",
      ancestorPath: [selectedVersion.id],
    };
  }
  if (isSetVersion(selectedVersion)) {
    return {
      ok: true,
      baseVersionId: selectedVersion.id,
      selectedVersionId,
      strategy: "selected_set",
      ancestorPath: [selectedVersion.id],
    };
  }

  const ancestorPath: string[] = [];
  const visited = new Set<string>();
  let cursor: TimelineDerivedBaseVersion | null = selectedVersion;
  let nearestOriginalAncestorId: string | null = null;

  while (cursor) {
    const cursorId = normalizeText(cursor.id);
    if (!cursorId || visited.has(cursorId)) break;

    visited.add(cursorId);
    ancestorPath.push(cursorId);

    if (cursorId !== selectedVersion.id) {
      if (isSetVersion(cursor)) {
        return {
          ok: true,
          baseVersionId: cursor.id,
          selectedVersionId,
          strategy: "nearest_set_ancestor",
          ancestorPath,
        };
      }
      if (!nearestOriginalAncestorId && isOriginalVersion(cursor)) {
        nearestOriginalAncestorId = cursor.id;
      }
    }

    const parentId = normalizeText(cursor.parentVersionId);
    if (!parentId) break;
    cursor = versionsById.get(parentId) ?? null;
  }

  if (nearestOriginalAncestorId) {
    return {
      ok: true,
      baseVersionId: nearestOriginalAncestorId,
      selectedVersionId,
      strategy: "nearest_original_ancestor",
      ancestorPath,
    };
  }

  return {
    ok: false,
    selectedVersionId,
    reason: "no_timeline_base_found",
    ancestorPath,
  };
}
