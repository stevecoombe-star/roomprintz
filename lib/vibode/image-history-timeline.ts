import { getVibodeVersionKind, type VibodeVersionKind } from "@/lib/vibode/version-kind";

export type ImageHistoryTimelineKind = VibodeVersionKind;

export type ImageHistoryTimelineVersion = {
  id: string;
  parentVersionId?: string | null;
  normalizedVersionKind?: ImageHistoryTimelineKind | null;
  created_at?: string | null;
};

export type ImageHistoryTimelineResult<TVersion extends ImageHistoryTimelineVersion> = {
  ancestors: TVersion[];
  active: TVersion;
  childrenByKind: {
    set: TVersion[];
    stage: TVersion[];
    style: TVersion[];
    unknown: TVersion[];
  };
  childCountSummary: Array<{
    kind: ImageHistoryTimelineKind;
    count: number;
  }>;
};

function toValidDateMs(value: string | null | undefined): number {
  if (typeof value !== "string") return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeKind<TVersion extends ImageHistoryTimelineVersion>(
  version: TVersion
): ImageHistoryTimelineKind {
  const kind = version.normalizedVersionKind;
  if (kind === "set" || kind === "stage" || kind === "style" || kind === "unknown") {
    return kind;
  }
  return getVibodeVersionKind(version);
}

function sortByCreatedAtAsc<TVersion extends ImageHistoryTimelineVersion>(versions: TVersion[]): TVersion[] {
  return versions
    .slice()
    .sort((a, b) => {
      const aMs = toValidDateMs(a.created_at);
      const bMs = toValidDateMs(b.created_at);
      if (aMs !== bMs) return aMs - bMs;
      return a.id.localeCompare(b.id);
    });
}

function normalizeVersionsById<TVersion extends ImageHistoryTimelineVersion>(
  versions: TVersion[]
): Map<string, TVersion> {
  const byId = new Map<string, TVersion>();
  // Guard duplicates by keeping first occurrence in input.
  for (const version of versions) {
    if (!version.id || byId.has(version.id)) continue;
    byId.set(version.id, version);
  }
  return byId;
}

export function getImageHistoryForVersion<TVersion extends ImageHistoryTimelineVersion>(
  activeVersionId: string | null | undefined,
  allVersions: TVersion[]
): ImageHistoryTimelineResult<TVersion> | null {
  if (!activeVersionId || !Array.isArray(allVersions) || allVersions.length === 0) {
    return null;
  }

  const versionsById = normalizeVersionsById(allVersions);
  const active = versionsById.get(activeVersionId);
  if (!active) return null;

  const childrenByParentId = new Map<string, TVersion[]>();
  for (const version of versionsById.values()) {
    const parentId =
      typeof version.parentVersionId === "string" && version.parentVersionId.trim().length > 0
        ? version.parentVersionId
        : null;
    if (!parentId) continue;
    if (!versionsById.has(parentId)) continue; // Guard missing parent references.
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(version);
    childrenByParentId.set(parentId, children);
  }

  const ancestorsNewestToOldest: TVersion[] = [];
  const visited = new Set<string>([active.id]);
  let cursorParentId =
    typeof active.parentVersionId === "string" && active.parentVersionId.trim().length > 0
      ? active.parentVersionId
      : null;
  while (cursorParentId) {
    const parentVersion = versionsById.get(cursorParentId);
    if (!parentVersion) {
      // Guard missing parent chain: stop at last known parent.
      break;
    }
    if (visited.has(parentVersion.id)) {
      // Guard cycles in ancestry.
      return null;
    }
    visited.add(parentVersion.id);
    ancestorsNewestToOldest.push(parentVersion);
    cursorParentId =
      typeof parentVersion.parentVersionId === "string" &&
      parentVersion.parentVersionId.trim().length > 0
        ? parentVersion.parentVersionId
        : null;
  }

  const directChildren = sortByCreatedAtAsc(childrenByParentId.get(active.id) ?? []);

  const childrenByKind: ImageHistoryTimelineResult<TVersion>["childrenByKind"] = {
    set: [],
    stage: [],
    style: [],
    unknown: [],
  };
  for (const child of directChildren) {
    const kind = normalizeKind(child);
    if (kind === "set") {
      childrenByKind.set.push(child);
      continue;
    }
    if (kind === "stage") {
      childrenByKind.stage.push(child);
      continue;
    }
    if (kind === "style") {
      childrenByKind.style.push(child);
      continue;
    }
    childrenByKind.unknown.push(child);
  }

  return {
    ancestors: ancestorsNewestToOldest.reverse(),
    active,
    childrenByKind,
    childCountSummary: [
      { kind: "set", count: childrenByKind.set.length },
      { kind: "stage", count: childrenByKind.stage.length },
      { kind: "style", count: childrenByKind.style.length },
      { kind: "unknown", count: childrenByKind.unknown.length },
    ],
  };
}
