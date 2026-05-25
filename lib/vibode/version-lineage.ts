import { getVibodeVersionKind, type VibodeVersionKind } from "@/lib/vibode/version-kind";

export type RoomVersionLineageSource = "generation_run" | "metadata" | "none";

export type RoomVersionForLineage = {
  id: string;
  metadata?: unknown;
};

export type GenerationRunForLineage = {
  output_asset_id: string | null;
  source_asset_id: string | null;
};

type ParentCandidate = {
  parentVersionId: string | null;
  lineageSource: RoomVersionLineageSource;
};

export type RoomVersionLineageGraph = {
  parentByVersionId: Map<string, string | null>;
  lineageSourceByVersionId: Map<string, RoomVersionLineageSource>;
  childrenByParentVersionId: Map<string | null, string[]>;
  normalizedVersionKindByVersionId: Map<string, VibodeVersionKind>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveMetadataParentVersionId(version: RoomVersionForLineage): string | null {
  if (!isRecord(version.metadata)) return null;

  // Priority is explicit snake_case first, then camelCase.
  const snake = safeString(version.metadata.source_version_id);
  if (snake) return snake;

  return safeString(version.metadata.sourceVersionId);
}

function buildGenerationRunParentIndex(
  generationRuns: GenerationRunForLineage[]
): Map<string, string | null> {
  const parentByOutputId = new Map<string, string | null>();
  for (const run of generationRuns) {
    const outputId = safeString(run.output_asset_id);
    if (!outputId) continue;
    if (parentByOutputId.has(outputId)) continue;
    parentByOutputId.set(outputId, safeString(run.source_asset_id));
  }
  return parentByOutputId;
}

function getParentCandidate(
  version: RoomVersionForLineage,
  parentByOutputId: Map<string, string | null>
): ParentCandidate {
  const fromGenerationRun = parentByOutputId.get(version.id);
  if (fromGenerationRun !== undefined) {
    return {
      parentVersionId: fromGenerationRun,
      lineageSource: fromGenerationRun ? "generation_run" : "none",
    };
  }

  const fromMetadata = resolveMetadataParentVersionId(version);
  if (fromMetadata) {
    return {
      parentVersionId: fromMetadata,
      lineageSource: "metadata",
    };
  }

  return {
    parentVersionId: null,
    lineageSource: "none",
  };
}

export function buildRoomVersionLineageGraph(
  versions: RoomVersionForLineage[],
  generationRuns: GenerationRunForLineage[]
): RoomVersionLineageGraph {
  const knownVersionIds = new Set(versions.map((version) => version.id));
  const generationRunParentIndex = buildGenerationRunParentIndex(generationRuns);

  const parentByVersionId = new Map<string, string | null>();
  const lineageSourceByVersionId = new Map<string, RoomVersionLineageSource>();
  const normalizedVersionKindByVersionId = new Map<string, VibodeVersionKind>();

  for (const version of versions) {
    const candidate = getParentCandidate(version, generationRunParentIndex);
    const hasKnownParent = candidate.parentVersionId
      ? knownVersionIds.has(candidate.parentVersionId)
      : false;
    const parentVersionId = hasKnownParent ? candidate.parentVersionId : null;
    const lineageSource =
      parentVersionId && candidate.lineageSource !== "none" ? candidate.lineageSource : "none";
    parentByVersionId.set(version.id, parentVersionId);
    lineageSourceByVersionId.set(version.id, lineageSource);
    normalizedVersionKindByVersionId.set(version.id, getVibodeVersionKind(version));
  }

  // Guard against cycles by breaking the edge that closes a detected cycle.
  for (const version of versions) {
    let cursor: string | null = version.id;
    const path = new Set<string>();
    while (cursor) {
      if (path.has(cursor)) {
        // Break cycle at current edge (cursor parent).
        parentByVersionId.set(cursor, null);
        lineageSourceByVersionId.set(cursor, "none");
        break;
      }
      path.add(cursor);
      cursor = parentByVersionId.get(cursor) ?? null;
    }
  }

  const childrenByParentVersionId = new Map<string | null, string[]>();
  for (const version of versions) {
    const parentVersionId = parentByVersionId.get(version.id) ?? null;
    const children = childrenByParentVersionId.get(parentVersionId) ?? [];
    children.push(version.id);
    childrenByParentVersionId.set(parentVersionId, children);
  }

  return {
    parentByVersionId,
    lineageSourceByVersionId,
    childrenByParentVersionId,
    normalizedVersionKindByVersionId,
  };
}
