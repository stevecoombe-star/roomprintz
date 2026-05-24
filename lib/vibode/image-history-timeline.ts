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

export type ImageHistoryWorkflowGroupKey = "original" | "set" | "stage" | "style";

export type ImageHistoryWorkflowGroup<TVersion extends ImageHistoryTimelineVersion> = {
  key: ImageHistoryWorkflowGroupKey;
  label: "ORIGINAL" | "SET" | "STAGE" | "STYLE";
  representative: TVersion;
  items: TVersion[];
  isActiveGroup: boolean;
  isExpandable: boolean;
};

export type ImageHistoryChildSummaryGroup<TVersion extends ImageHistoryTimelineVersion> = {
  kind: ImageHistoryTimelineKind;
  items: TVersion[];
};

export type ImageHistoryWorkflowGroupsResult<TVersion extends ImageHistoryTimelineVersion> = {
  groups: ImageHistoryWorkflowGroup<TVersion>[];
  active: TVersion;
  childSummary: {
    representative: TVersion | null;
    totalChildren: number;
    displayKind: ImageHistoryTimelineKind | null;
    groupedChildren: ImageHistoryChildSummaryGroup<TVersion>[];
    isExpandable: boolean;
  };
};

function getTargetChildKindForActiveKind(
  activeKind: ImageHistoryTimelineKind
): ImageHistoryTimelineKind | null {
  if (activeKind === "unknown" || activeKind === "style") return null;
  if (activeKind === "stage") return "style";
  if (activeKind === "set") return "stage";
  return "set";
}

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

function getParentId<TVersion extends ImageHistoryTimelineVersion>(version: TVersion): string | null {
  return typeof version.parentVersionId === "string" && version.parentVersionId.trim().length > 0
    ? version.parentVersionId
    : null;
}

function buildChildrenByParentId<TVersion extends ImageHistoryTimelineVersion>(
  versionsById: Map<string, TVersion>
): Map<string, TVersion[]> {
  const childrenByParentId = new Map<string, TVersion[]>();
  for (const version of versionsById.values()) {
    const parentId = getParentId(version);
    if (!parentId) continue;
    if (!versionsById.has(parentId)) continue;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(version);
    childrenByParentId.set(parentId, children);
  }

  for (const [parentId, children] of childrenByParentId) {
    childrenByParentId.set(parentId, sortByCreatedAtAsc(children));
  }
  return childrenByParentId;
}

function firstFromEnd<T>(items: T[], predicate: (item: T) => boolean): T | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index];
  }
  return null;
}

function getChildrenOfKind<TVersion extends ImageHistoryTimelineVersion>(
  childrenByParentId: Map<string, TVersion[]>,
  parentId: string | null,
  kind: ImageHistoryTimelineKind
): TVersion[] {
  if (!parentId) return [];
  return (childrenByParentId.get(parentId) ?? []).filter((child) => normalizeKind(child) === kind);
}

function buildWorkflowGroup<TVersion extends ImageHistoryTimelineVersion>(args: {
  key: ImageHistoryWorkflowGroupKey;
  label: ImageHistoryWorkflowGroup<TVersion>["label"];
  representative: TVersion | null;
  siblings: TVersion[];
  activeVersionId: string;
}): ImageHistoryWorkflowGroup<TVersion> | null {
  if (!args.representative) return null;
  const normalizedItems = args.siblings.some((item) => item.id === args.representative!.id)
    ? args.siblings
    : sortByCreatedAtAsc([...args.siblings, args.representative]);
  return {
    key: args.key,
    label: args.label,
    representative: args.representative,
    items: normalizedItems,
    isActiveGroup: args.representative.id === args.activeVersionId,
    isExpandable: normalizedItems.length > 1,
  };
}

export function getImageHistoryWorkflowGroups<TVersion extends ImageHistoryTimelineVersion>(
  activeVersionId: string | null | undefined,
  allVersions: TVersion[]
): ImageHistoryWorkflowGroupsResult<TVersion> | null {
  const timeline = getImageHistoryForVersion(activeVersionId, allVersions);
  if (!timeline) return null;

  const versionsById = normalizeVersionsById(allVersions);
  const childrenByParentId = buildChildrenByParentId(versionsById);

  const chain = [...timeline.ancestors, timeline.active];
  const root = chain[0] ?? timeline.active;
  const activeKind = normalizeKind(timeline.active);
  const setNode =
    activeKind === "set" ? timeline.active : firstFromEnd(chain, (version) => normalizeKind(version) === "set");
  const stageNode =
    activeKind === "stage"
      ? timeline.active
      : firstFromEnd(chain, (version) => normalizeKind(version) === "stage");
  const styleNode =
    activeKind === "style"
      ? timeline.active
      : firstFromEnd(chain, (version) => normalizeKind(version) === "style");

  const groups: ImageHistoryWorkflowGroup<TVersion>[] = [];

  const originalSiblings = [root];
  const originalRepresentative = timeline.active.id === root.id ? timeline.active : root;
  const originalGroup = buildWorkflowGroup({
    key: "original",
    label: "ORIGINAL",
    representative: originalRepresentative,
    siblings: originalSiblings,
    activeVersionId: timeline.active.id,
  });
  if (originalGroup) groups.push(originalGroup);

  const setGroup = buildWorkflowGroup({
    key: "set",
    label: "SET",
    representative: setNode,
    siblings: setNode
      ? getChildrenOfKind(childrenByParentId, getParentId(setNode), "set")
      : [],
    activeVersionId: timeline.active.id,
  });
  if (setGroup) groups.push(setGroup);

  const stageGroup = buildWorkflowGroup({
    key: "stage",
    label: "STAGE",
    representative: stageNode,
    siblings: stageNode
      ? getChildrenOfKind(childrenByParentId, getParentId(stageNode), "stage")
      : [],
    activeVersionId: timeline.active.id,
  });
  if (stageGroup) groups.push(stageGroup);

  const styleGroup = buildWorkflowGroup({
    key: "style",
    label: "STYLE",
    representative: styleNode,
    siblings: styleNode
      ? getChildrenOfKind(childrenByParentId, getParentId(styleNode), "style")
      : [],
    activeVersionId: timeline.active.id,
  });
  if (styleGroup) groups.push(styleGroup);

  const directChildren = sortByCreatedAtAsc(childrenByParentId.get(timeline.active.id) ?? []);

  let groupedChildren: ImageHistoryChildSummaryGroup<TVersion>[] = [];
  let displayKind: ImageHistoryTimelineKind | null = null;
  let representative: TVersion | null = null;
  let isExpandable = false;

  const targetKind = getTargetChildKindForActiveKind(activeKind);
  if (targetKind === null) {
    const groupedChildrenAllKinds: ImageHistoryChildSummaryGroup<TVersion>[] = [
      { kind: "set", items: timeline.childrenByKind.set },
      { kind: "stage", items: timeline.childrenByKind.stage },
      { kind: "style", items: timeline.childrenByKind.style },
      { kind: "unknown", items: timeline.childrenByKind.unknown },
    ];
    groupedChildren = groupedChildrenAllKinds.filter((entry) => entry.items.length > 0);
    if (groupedChildren.length > 0) {
      const visibleChildren = sortByCreatedAtAsc(groupedChildren.flatMap((entry) => entry.items));
      representative = visibleChildren.length > 0 ? visibleChildren[visibleChildren.length - 1] : null;
      isExpandable = groupedChildren.length > 1 || groupedChildren.some((entry) => entry.items.length > 1);
    }
  } else {
    displayKind = targetKind;
    const targetChildren =
      targetKind === "set"
        ? timeline.childrenByKind.set
        : targetKind === "stage"
          ? timeline.childrenByKind.stage
          : timeline.childrenByKind.style;
    groupedChildren = [
      {
        kind: displayKind,
        items: targetChildren,
      },
    ];
    const sortedTargetChildren = sortByCreatedAtAsc(targetChildren);
    representative =
      sortedTargetChildren.length > 0 ? sortedTargetChildren[sortedTargetChildren.length - 1] : null;
    isExpandable = sortedTargetChildren.length > 1;
  }

  const totalChildren = directChildren.length;

  return {
    groups,
    active: timeline.active,
    childSummary: {
      representative,
      totalChildren,
      displayKind,
      groupedChildren,
      isExpandable,
    },
  };
}
