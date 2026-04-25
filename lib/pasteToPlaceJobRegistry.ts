import { PASTE_TO_PLACE_CANCELLED_CODE } from "@/lib/pasteToPlaceJobControl";

type ScopeState = {
  latestJobId: string;
  cancelledJobIds: Set<string>;
  updatedAt: number;
};

type JobState = "active" | "stale" | "cancelled" | "unknown";

const scopeRegistry = new Map<string, ScopeState>();
const MAX_SCOPE_IDLE_MS = 10 * 60 * 1000;
const MAX_CANCELLED_IDS_PER_SCOPE = 128;

function trimCancelledIds(scopeState: ScopeState): void {
  if (scopeState.cancelledJobIds.size <= MAX_CANCELLED_IDS_PER_SCOPE) return;
  const next = Array.from(scopeState.cancelledJobIds).slice(-MAX_CANCELLED_IDS_PER_SCOPE);
  scopeState.cancelledJobIds = new Set(next);
}

function cleanupExpiredScopes(now: number): void {
  for (const [scopeId, scopeState] of scopeRegistry.entries()) {
    if (now - scopeState.updatedAt > MAX_SCOPE_IDLE_MS) {
      scopeRegistry.delete(scopeId);
    }
  }
}

function getScopeState(scopeId: string, now: number): ScopeState {
  const existing = scopeRegistry.get(scopeId);
  if (existing) {
    existing.updatedAt = now;
    return existing;
  }
  const created: ScopeState = {
    latestJobId: "",
    cancelledJobIds: new Set<string>(),
    updatedAt: now,
  };
  scopeRegistry.set(scopeId, created);
  return created;
}

export function markPasteToPlaceJobLatest(scopeId: string, jobId: string): void {
  const now = Date.now();
  cleanupExpiredScopes(now);
  const scopeState = getScopeState(scopeId, now);
  scopeState.latestJobId = jobId;
}

export function markPasteToPlaceJobCancelled(scopeId: string, jobId: string): void {
  const now = Date.now();
  cleanupExpiredScopes(now);
  const scopeState = getScopeState(scopeId, now);
  scopeState.cancelledJobIds.add(jobId);
  trimCancelledIds(scopeState);
}

export function getPasteToPlaceJobState(scopeId: string, jobId: string): JobState {
  const scopeState = scopeRegistry.get(scopeId);
  if (!scopeState) return "unknown";
  if (scopeState.cancelledJobIds.has(jobId)) return "cancelled";
  if (scopeState.latestJobId !== jobId) return "stale";
  return "active";
}

export function buildPasteToPlaceCancelledResponse(reason: "stale" | "cancelled"): Response {
  return Response.json(
    {
      code: PASTE_TO_PLACE_CANCELLED_CODE,
      cancelled: true,
      reason,
    },
    { status: 409 }
  );
}
