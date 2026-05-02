export type DetectedRoomObjectLabel = {
  label: string;
  confidence: number;
};

export const ALLOWED_ROOM_OBJECT_LABELS = [
  "sofa",
  "chair",
  "coffee table",
  "side table",
  "dining table",
  "bed",
  "nightstand",
  "dresser",
  "cabinet",
  "tv stand",
  "rug",
  "lamp",
  "plant",
  "artwork",
  "mirror",
  "ottoman",
  "bookshelf",
  "curtains",
] as const;

const ALLOWED_LABEL_SET = new Set<string>(ALLOWED_ROOM_OBJECT_LABELS);

const ROOM_OBJECT_LABEL_ALIASES: Record<string, string> = {
  couch: "sofa",
  "sectional sofa": "sofa",
  sectional: "sofa",
  loveseat: "sofa",
  armchair: "chair",
  "dining chair": "chair",
  "lounge chair": "chair",
  "center table": "coffee table",
  "end table": "side table",
  "potted plant": "plant",
  "wall art": "artwork",
  painting: "artwork",
  picture: "artwork",
  "television stand": "tv stand",
  "media console": "tv stand",
};

function normalizeRawLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  const canonical = ROOM_OBJECT_LABEL_ALIASES[normalized] ?? normalized;
  return ALLOWED_LABEL_SET.has(canonical) ? canonical : null;
}

function parseConfidence(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeDetectedRoomObjectLabels(
  input: unknown
): DetectedRoomObjectLabel[] {
  const objects = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { objects?: unknown[] }).objects)
    ? (input as { objects: unknown[] }).objects
    : [];

  const bestByLabel = new Map<string, number>();
  for (const item of objects) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = normalizeRawLabel(record.label);
    const confidence = parseConfidence(record.confidence);
    if (!label || confidence === null || confidence < 0.6) continue;
    const prev = bestByLabel.get(label);
    if (prev === undefined || confidence > prev) {
      bestByLabel.set(label, confidence);
    }
  }

  return Array.from(bestByLabel.entries())
    .map(([label, confidence]) => ({ label, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}
