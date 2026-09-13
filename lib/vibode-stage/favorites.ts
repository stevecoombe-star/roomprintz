import { favoriteKey } from "./catalog";

export const STAGE_FAVORITES_STORAGE_KEY = "vibode:stage-favorites/v1";

export function toggleFavoriteKeys(
  current: ReadonlySet<string>,
  productId: string,
  variantId?: string | null,
): Set<string> {
  const key = favoriteKey(productId, variantId);
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function parseFavoriteKeys(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.filter((item): item is string => typeof item === "string" && item.includes("::")),
  );
}

export function serializeFavoriteKeys(keys: ReadonlySet<string>): string[] {
  return [...keys];
}

export function readFavoriteKeysFromStorage(
  storage: Pick<Storage, "getItem"> | null | undefined,
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(STAGE_FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    return parseFavoriteKeys(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function writeFavoriteKeysToStorage(
  storage: Pick<Storage, "setItem"> | null | undefined,
  keys: ReadonlySet<string>,
): void {
  if (!storage) return;
  storage.setItem(STAGE_FAVORITES_STORAGE_KEY, JSON.stringify(serializeFavoriteKeys(keys)));
}
