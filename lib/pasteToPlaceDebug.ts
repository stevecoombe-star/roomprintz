export type PasteToPlaceDebugSnapshot = {
  activeSource: {
    type: "clipboard" | "my_furniture" | null;
    skuId: string | null;
    clipboardDataUrlHash: string | null;
  };
  hasPreparedProduct: boolean;
  isIngesting: boolean;
  isEditRunning: boolean;
  isMenuOpen: boolean;
  roomId: string | null;
};

function hashString(input: string): string {
  let hash = 2166136261;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash ^= input.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function hashDataUrlForLogs(dataUrl: string | null | undefined): string | null {
  if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) return null;
  return hashString(dataUrl);
}

export function buildPasteToPlaceSnapshot(args: {
  activeSource: {
    type: "clipboard" | "my_furniture" | null;
    skuId: string | null;
    clipboardDataUrlHash: string | null;
  };
  hasPreparedProduct: boolean;
  isIngesting: boolean;
  isEditRunning: boolean;
  isMenuOpen: boolean;
  roomId: string | null;
}): PasteToPlaceDebugSnapshot {
  return {
    activeSource: {
      type: args.activeSource.type,
      skuId: args.activeSource.skuId,
      clipboardDataUrlHash: args.activeSource.clipboardDataUrlHash,
    },
    hasPreparedProduct: args.hasPreparedProduct,
    isIngesting: args.isIngesting,
    isEditRunning: args.isEditRunning,
    isMenuOpen: args.isMenuOpen,
    roomId: args.roomId,
  };
}

export function logPasteToPlaceEvent(
  event: string,
  payload: Record<string, unknown>,
  stateSnapshot: PasteToPlaceDebugSnapshot
): void {
  console.info("[paste-to-place]", {
    event,
    payload,
    state_snapshot: stateSnapshot,
  });
}
