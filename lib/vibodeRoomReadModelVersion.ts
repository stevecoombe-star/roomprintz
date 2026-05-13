export const DEFAULT_ROOM_READ_MODEL_VERSION = "gemini-3-flash-preview";

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isValidGeminiRoomReadModelVersion(value: unknown): value is string {
  const model = safeStr(value);
  if (!model) return false;
  if (/^nbp$/i.test(model) || /^nb2$/i.test(model)) return false;
  return /^gemini[-\w.]+$/i.test(model) || /^models\/gemini[-\w.]+$/i.test(model);
}

export function resolveRoomReadModelVersion(value: unknown): string {
  return isValidGeminiRoomReadModelVersion(value) ? value.trim() : DEFAULT_ROOM_READ_MODEL_VERSION;
}
