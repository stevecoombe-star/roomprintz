export type PendingFurnitureSelection = {
  furnitureId: string;
  previewImageUrl?: string | null;
  suppressedClipboardPreviewHash?: string | null;
  createdAt: number;
};

const STORAGE_KEY = "vibode:pendingFurnitureSelection";
const CLIPBOARD_SUPPRESSION_STORAGE_KEY = "vibode:pendingFurnitureClipboardSuppression";
const TTL_MS = 30 * 60 * 1000;

export function setPendingFurnitureSelection(selection: PendingFurnitureSelection) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {}
}

export function getPendingFurnitureSelection(): PendingFurnitureSelection | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const { furnitureId, createdAt, previewImageUrl, suppressedClipboardPreviewHash } = parsed as {
      furnitureId: unknown;
      createdAt: unknown;
      previewImageUrl?: unknown;
      suppressedClipboardPreviewHash?: unknown;
    };

    if (typeof furnitureId !== "string" || typeof createdAt !== "number") {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (Date.now() - createdAt > TTL_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const normalizedPreviewImageUrl =
      typeof previewImageUrl === "string" && previewImageUrl.trim().length > 0 ? previewImageUrl : null;
    const normalizedSuppressedClipboardPreviewHash =
      typeof suppressedClipboardPreviewHash === "string" &&
      suppressedClipboardPreviewHash.trim().length > 0
        ? suppressedClipboardPreviewHash
        : null;

    return {
      furnitureId,
      createdAt,
      previewImageUrl: normalizedPreviewImageUrl,
      suppressedClipboardPreviewHash: normalizedSuppressedClipboardPreviewHash,
    };
  } catch {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    return null;
  }
}

export function clearPendingFurnitureSelection() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function setPendingFurnitureClipboardSuppressionHash(hash: string | null) {
  try {
    if (typeof hash !== "string" || hash.trim().length === 0) {
      window.sessionStorage.removeItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      CLIPBOARD_SUPPRESSION_STORAGE_KEY,
      JSON.stringify({ hash, createdAt: Date.now() })
    );
  } catch {}
}

export function getPendingFurnitureClipboardSuppressionHash(): string | null {
  try {
    const raw = window.sessionStorage.getItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hash?: unknown; createdAt?: unknown } | null;
    if (!parsed || typeof parsed !== "object") {
      window.sessionStorage.removeItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
      return null;
    }
    if (typeof parsed.createdAt !== "number" || Date.now() - parsed.createdAt > TTL_MS) {
      window.sessionStorage.removeItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
      return null;
    }
    if (typeof parsed.hash !== "string" || parsed.hash.trim().length === 0) {
      window.sessionStorage.removeItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
      return null;
    }
    return parsed.hash;
  } catch {
    try {
      window.sessionStorage.removeItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
    } catch {}
    return null;
  }
}

export function clearPendingFurnitureClipboardSuppressionHash() {
  try {
    window.sessionStorage.removeItem(CLIPBOARD_SUPPRESSION_STORAGE_KEY);
  } catch {}
}
