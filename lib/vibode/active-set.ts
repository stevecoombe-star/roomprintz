import { getVibodeVersionKind } from "@/lib/vibode/version-kind";

type CandidateVersionLike = {
  id?: unknown;
  asset_type?: unknown;
  is_active?: unknown;
  metadata?: unknown;
};

type ResolveActiveSetVersionIdArgs = {
  roomMetadata?: unknown;
  versions?: unknown[];
  baseAssetId?: string | null;
  activeAssetId?: string | null;
};

type EffectiveBaseSetVersionResult = {
  activeSetVersionId: string | null;
  version: CandidateVersionLike | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAssetType(value: unknown): string {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : "";
}

function readActiveSetVersionIdFromRoomMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;

  const direct = normalizeText(metadata.activeSetVersionId) ?? normalizeText(metadata.active_set_version_id);
  if (direct) return direct;

  const activeSet = isRecord(metadata.activeSet) ? metadata.activeSet : null;
  if (activeSet) {
    const nested = normalizeText(activeSet.versionId) ?? normalizeText(activeSet.activeSetVersionId);
    if (nested) return nested;
  }

  const vibode = isRecord(metadata.vibode) ? metadata.vibode : null;
  if (vibode) {
    const nested = normalizeText(vibode.activeSetVersionId) ?? normalizeText(vibode.active_set_version_id);
    if (nested) return nested;
  }

  return null;
}

function toCandidateVersions(versions: unknown[] | undefined): CandidateVersionLike[] {
  if (!Array.isArray(versions)) return [];
  return versions.filter(isRecord);
}

export function isVersionEligibleForActiveSet(version: unknown): boolean {
  if (!isRecord(version)) return false;

  if (normalizeAssetType(version.asset_type) === "base") {
    return true;
  }

  return getVibodeVersionKind(version) === "set";
}

export function resolveActiveSetVersionId(args: ResolveActiveSetVersionIdArgs): string | null {
  const versions = toCandidateVersions(args.versions);
  const eligibleVersions = versions.filter((version) => isVersionEligibleForActiveSet(version));
  const eligibleIds = new Set(
    eligibleVersions.map((version) => normalizeText(version.id)).filter((value): value is string => Boolean(value))
  );

  const metadataSelectedId = readActiveSetVersionIdFromRoomMetadata(args.roomMetadata);
  if (metadataSelectedId && eligibleIds.has(metadataSelectedId)) {
    return metadataSelectedId;
  }

  const baseAssetId = normalizeText(args.baseAssetId);
  if (baseAssetId && eligibleIds.has(baseAssetId)) {
    return baseAssetId;
  }

  const activeAssetId = normalizeText(args.activeAssetId);
  if (activeAssetId && eligibleIds.has(activeAssetId)) {
    return activeAssetId;
  }

  const eligibleActiveVersion = eligibleVersions.find((version) => version.is_active === true);
  const eligibleActiveVersionId = normalizeText(eligibleActiveVersion?.id);
  if (eligibleActiveVersionId) return eligibleActiveVersionId;

  return normalizeText(eligibleVersions[0]?.id);
}

export function getEffectiveBaseSetVersion(args: ResolveActiveSetVersionIdArgs): EffectiveBaseSetVersionResult {
  const activeSetVersionId = resolveActiveSetVersionId(args);
  if (!activeSetVersionId) {
    return {
      activeSetVersionId: null,
      version: null,
    };
  }

  const versions = toCandidateVersions(args.versions);
  const version = versions.find((candidate) => normalizeText(candidate.id) === activeSetVersionId) ?? null;

  return {
    activeSetVersionId,
    version,
  };
}

