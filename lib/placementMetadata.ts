export type PlacementIntent = "user_directed" | "model_decided";

export type PlacementSource =
  | "clipboard"
  | "product_url"
  | "swap"
  | "my_furniture"
  | "model_vision_inferred"
  | "user_adjusted";

export type PlacementOwnership = "user" | "vibode";

export type PlacementMetadata = {
  placementIntent: PlacementIntent;
  placementSource: PlacementSource;
  ownership: PlacementOwnership;
  confidence: number | null;
};

const DEFAULT_USER_DIRECTED_SOURCE: PlacementSource = "clipboard";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPlacementIntent(value: unknown): PlacementIntent | null {
  const raw = safeStr(value);
  if (raw === "user_directed" || raw === "model_decided") return raw;
  return null;
}

function toPlacementSource(value: unknown): PlacementSource | null {
  const raw = safeStr(value);
  if (
    raw === "clipboard" ||
    raw === "product_url" ||
    raw === "swap" ||
    raw === "my_furniture" ||
    raw === "model_vision_inferred" ||
    raw === "user_adjusted"
  ) {
    return raw;
  }
  return null;
}

function toPlacementOwnership(value: unknown): PlacementOwnership | null {
  const raw = safeStr(value);
  if (raw === "user" || raw === "vibode") return raw;
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function defaultUserDirectedPlacementMetadata(
  source: PlacementSource = DEFAULT_USER_DIRECTED_SOURCE
): PlacementMetadata {
  return {
    placementIntent: "user_directed",
    placementSource: source,
    ownership: "user",
    confidence: 1,
  };
}

export function normalizePlacementMetadata(
  value: unknown,
  fallback: PlacementMetadata = defaultUserDirectedPlacementMetadata()
): PlacementMetadata {
  if (!isRecord(value)) return fallback;
  return {
    placementIntent: toPlacementIntent(value.placementIntent) ?? fallback.placementIntent,
    placementSource: toPlacementSource(value.placementSource) ?? fallback.placementSource,
    ownership: toPlacementOwnership(value.ownership) ?? fallback.ownership,
    confidence:
      value.confidence === null
        ? null
        : isFiniteNumber(value.confidence)
        ? value.confidence
        : fallback.confidence,
  };
}
