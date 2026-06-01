export type VibodeVersionKind = "set" | "stage" | "style" | "unknown";
export type PersistedVibodeVersionKind = Exclude<VibodeVersionKind, "unknown">;
export type WorkflowStepDisplayLabel = "SETUP" | "STAGE" | "STYLE" | "UNKNOWN";

const KNOWN_VERSION_KINDS = new Set<VibodeVersionKind>(["set", "stage", "style", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCandidate(value: unknown): VibodeVersionKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || !KNOWN_VERSION_KINDS.has(normalized as VibodeVersionKind)) return null;
  return normalized === "unknown" ? "unknown" : (normalized as VibodeVersionKind);
}

export function normalizePersistedVibodeVersionKind(
  value: unknown
): PersistedVibodeVersionKind | null {
  const normalized = normalizeCandidate(value);
  if (!normalized || normalized === "unknown") return null;
  return normalized;
}

export function inferPersistedVibodeVersionKindFromStageNumber(
  stageNumber: unknown
): PersistedVibodeVersionKind {
  if (typeof stageNumber !== "number" || !Number.isFinite(stageNumber)) return "stage";
  const normalized = Math.trunc(stageNumber);
  if (normalized <= 2) return "set";
  if (normalized >= 4) return "style";
  return "stage";
}

function extractMetadata(version: unknown): Record<string, unknown> | null {
  if (!isRecord(version)) return null;
  const metadata = version.metadata;
  return isRecord(metadata) ? metadata : null;
}

function readKindFromMetadata(metadata: Record<string, unknown>): VibodeVersionKind {
  const candidates = [
    metadata.versionKind,
    metadata.workflowStage,
    metadata.kind,
    metadata.stage,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (normalized && normalized !== "unknown") return normalized;
  }
  return "unknown";
}

export function getVibodeVersionKind(version: unknown): VibodeVersionKind {
  const metadata = extractMetadata(version);
  if (!metadata) return "unknown";
  return readKindFromMetadata(metadata);
}

export function stampVibodeVersionKindMetadata(
  metadata: unknown,
  versionKind: unknown
): Record<string, unknown> | null {
  const normalizedKind = normalizePersistedVibodeVersionKind(versionKind);
  if (!normalizedKind) return null;
  const base = isRecord(metadata) ? metadata : {};
  return {
    ...base,
    versionKind: normalizedKind,
  };
}

export function isSetVersion(version: unknown): boolean {
  return getVibodeVersionKind(version) === "set";
}

export function isStageVersion(version: unknown): boolean {
  return getVibodeVersionKind(version) === "stage";
}

export function isStyleVersion(version: unknown): boolean {
  return getVibodeVersionKind(version) === "style";
}

export function getWorkflowStepDisplayLabel(kind: VibodeVersionKind): WorkflowStepDisplayLabel {
  if (kind === "set") return "SETUP";
  if (kind === "stage") return "STAGE";
  if (kind === "style") return "STYLE";
  return "UNKNOWN";
}
