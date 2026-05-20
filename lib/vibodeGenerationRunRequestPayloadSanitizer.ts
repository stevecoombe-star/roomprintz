type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type MutableImageSummary = {
  hasImageBase64: boolean;
  referenceImageCount: number;
  embeddedReferenceImageCount: number;
  imageBase64Length: number;
  totalEmbeddedImageBytesEstimate: number;
  dataImageStringCount: number;
  longBase64StringCount: number;
};

const BLOB_KEYS = new Set([
  "imageBase64",
  "roomImageBase64",
  "skuImageBase64",
  "referenceImageBase64s",
]);

const DATA_IMAGE_PREFIX = "data:image/";
const LONG_BASE64_LENGTH_THRESHOLD = 8192;

function estimateDecodedBytes(base64Like: string): number {
  const commaIndex = base64Like.indexOf(",");
  const maybeBase64 = commaIndex >= 0 ? base64Like.slice(commaIndex + 1) : base64Like;
  const normalized = maybeBase64.replace(/\s+/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function looksLikeLongBase64Blob(value: string): boolean {
  if (value.length < LONG_BASE64_LENGTH_THRESHOLD) return false;
  const compact = value.replace(/\s+/g, "");
  if (compact.length < LONG_BASE64_LENGTH_THRESHOLD) return false;
  return /^[A-Za-z0-9+/=]+$/.test(compact);
}

function sanitizeValue(
  value: unknown,
  summary: MutableImageSummary,
  keyHint: string | null
): JsonValue | undefined {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    const isDataImage = lower.startsWith(DATA_IMAGE_PREFIX);
    const isLongBase64Blob = looksLikeLongBase64Blob(trimmed);
    if (isDataImage || isLongBase64Blob) {
      summary.hasImageBase64 = true;
      summary.imageBase64Length = Math.max(summary.imageBase64Length, trimmed.length);
      summary.totalEmbeddedImageBytesEstimate += estimateDecodedBytes(trimmed);
      if (isDataImage) summary.dataImageStringCount += 1;
      if (isLongBase64Blob) summary.longBase64StringCount += 1;
      if (keyHint === "imageBase64" || keyHint === "roomImageBase64" || keyHint === "skuImageBase64") {
        return undefined;
      }
      return null;
    }
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value)) {
    if (keyHint === "referenceImageBase64s") {
      summary.hasImageBase64 = value.length > 0 || summary.hasImageBase64;
      summary.referenceImageCount = Math.max(summary.referenceImageCount, value.length);
      summary.embeddedReferenceImageCount += value.length;
      for (const item of value) {
        if (typeof item === "string") {
          summary.imageBase64Length = Math.max(summary.imageBase64Length, item.length);
          summary.totalEmbeddedImageBytesEstimate += estimateDecodedBytes(item);
        }
      }
      return undefined;
    }
    if (keyHint === "referenceImages") {
      summary.referenceImageCount = Math.max(summary.referenceImageCount, value.length);
    }
    const out: JsonValue[] = [];
    for (const item of value) {
      const sanitized = sanitizeValue(item, summary, keyHint);
      if (typeof sanitized !== "undefined") out.push(sanitized);
    }
    return out;
  }

  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (BLOB_KEYS.has(key)) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          summary.hasImageBase64 = true;
          if (keyHint === "referenceImages" && key === "imageBase64") {
            summary.embeddedReferenceImageCount += 1;
          }
          summary.imageBase64Length = Math.max(summary.imageBase64Length, trimmed.length);
          summary.totalEmbeddedImageBytesEstimate += estimateDecodedBytes(trimmed);
        } else if (Array.isArray(item)) {
          summary.hasImageBase64 = item.length > 0 || summary.hasImageBase64;
          if (key === "referenceImageBase64s") {
            summary.referenceImageCount = Math.max(summary.referenceImageCount, item.length);
            summary.embeddedReferenceImageCount += item.length;
          }
          for (const listItem of item) {
            if (typeof listItem === "string") {
              summary.imageBase64Length = Math.max(summary.imageBase64Length, listItem.length);
              summary.totalEmbeddedImageBytesEstimate += estimateDecodedBytes(listItem);
            }
          }
        }
        continue;
      }
      if (key === "referenceImages" && Array.isArray(item)) {
        summary.referenceImageCount = Math.max(summary.referenceImageCount, item.length);
      }
      const sanitized = sanitizeValue(item, summary, key);
      if (typeof sanitized !== "undefined") {
        out[key] = sanitized;
      }
    }
    return out;
  }

  return String(value);
}

function hasForbiddenPayloadShape(value: JsonValue): boolean {
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered.includes(DATA_IMAGE_PREFIX)) return true;
    if (looksLikeLongBase64Blob(value)) return true;
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasForbiddenPayloadShape(entry));
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (BLOB_KEYS.has(key)) return true;
      if (hasForbiddenPayloadShape(entry)) return true;
    }
  }
  return false;
}

export function sanitizeGenerationRunRequestPayload(input: unknown): JsonObject {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const summary: MutableImageSummary = {
    hasImageBase64: false,
    referenceImageCount: 0,
    embeddedReferenceImageCount: 0,
    imageBase64Length: 0,
    totalEmbeddedImageBytesEstimate: 0,
    dataImageStringCount: 0,
    longBase64StringCount: 0,
  };
  const sanitized = sanitizeValue(source, summary, null);
  const sanitizedObject =
    sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as JsonObject)
      : {};

  if (summary.hasImageBase64) {
    sanitizedObject.hasImageBase64 = true;
  }
  if (summary.referenceImageCount > 0) {
    sanitizedObject.referenceImageCount = summary.referenceImageCount;
  }
  if (summary.embeddedReferenceImageCount > 0) {
    sanitizedObject.embeddedReferenceImageCount = summary.embeddedReferenceImageCount;
  }
  if (summary.imageBase64Length > 0) {
    sanitizedObject.imageBase64Length = summary.imageBase64Length;
  }
  if (summary.totalEmbeddedImageBytesEstimate > 0) {
    sanitizedObject.totalEmbeddedImageBytesEstimate = summary.totalEmbeddedImageBytesEstimate;
  }

  if (hasForbiddenPayloadShape(sanitizedObject)) {
    return {
      requestPayloadSanitized: true,
      requestPayloadSanitizationMode: "fallback_minimal",
      hasImageBase64: summary.hasImageBase64,
      referenceImageCount: summary.referenceImageCount,
      embeddedReferenceImageCount: summary.embeddedReferenceImageCount,
      imageBase64Length: summary.imageBase64Length,
      totalEmbeddedImageBytesEstimate: summary.totalEmbeddedImageBytesEstimate,
      dataImageStringCount: summary.dataImageStringCount,
      longBase64StringCount: summary.longBase64StringCount,
    };
  }

  return sanitizedObject;
}
