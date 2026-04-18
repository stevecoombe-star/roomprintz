const LS_KEY = "vibode.pendingGeneration.v1";

export function savePendingLocal(payload: any) {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload ?? null));
  } catch {
    // ignore storage failures (quota, privacy mode)
  }
}

export function loadPendingLocal(): any | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPendingLocal() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;

  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore storage failures (quota, privacy mode)
  }
}
