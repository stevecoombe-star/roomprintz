import "server-only";

import { normalizeAfcUi2aRoomLabel } from "./afc-ui2a-original-preparation-contract";

export const AFC_UI2B_PROPOSAL_RUN_REQUEST_VERSION = "afc-ui2b-proposal-run-request/v1" as const;
export const AFC_UI2B_STUDY_MODES = Object.freeze(["original_only", "empty_only"] as const);
export type AfcUi2bStudyMode = (typeof AFC_UI2B_STUDY_MODES)[number];
export type AfcUi2bOperation = "validate" | "execute";

export type AfcUi2bProposalRunRequest = Readonly<{
  contractVersion: typeof AFC_UI2B_PROPOSAL_RUN_REQUEST_VERSION;
  operation: AfcUi2bOperation;
  roomLabel: string;
  packageSelector: Readonly<{ packageId: string; receiptFileName: string; receiptSha256: string }>;
  studyMode: AfcUi2bStudyMode;
  executeCapture?: unknown;
  executeLiveProviderCall?: unknown;
}>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const item = value as object;
    if (seen.has(item)) return value;
    seen.add(item);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(item);
  }
  return value;
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.filter((key) => key !== "executeCapture" && key !== "executeLiveProviderCall").every((key) => Object.hasOwn(value, key));
}
function isStudyMode(value: unknown): value is AfcUi2bStudyMode {
  return value === "original_only" || value === "empty_only";
}

/** Strict browser contract: selectors only, never paths or runner authority. */
export function parseAfcUi2bProposalRunRequest(value: unknown):
  | Readonly<{ ok: true; request: AfcUi2bProposalRunRequest }>
  | Readonly<{ ok: false }> {
  if (!plain(value) || !allowedKeys(value, [
    "contractVersion", "operation", "roomLabel", "packageSelector", "studyMode", "executeCapture", "executeLiveProviderCall",
  ])) return deepFreeze({ ok: false as const });
  if (value.contractVersion !== AFC_UI2B_PROPOSAL_RUN_REQUEST_VERSION ||
    (value.operation !== "validate" && value.operation !== "execute") ||
    !isStudyMode(value.studyMode) || typeof value.roomLabel !== "string" || !plain(value.packageSelector)) {
    return deepFreeze({ ok: false as const });
  }
  const roomId = normalizeAfcUi2aRoomLabel(value.roomLabel);
  const selector = value.packageSelector;
  if (!roomId || !allowedKeys(selector, ["packageId", "receiptFileName", "receiptSha256"]) ||
    typeof selector.packageId !== "string" || typeof selector.receiptFileName !== "string" || typeof selector.receiptSha256 !== "string") {
    return deepFreeze({ ok: false as const });
  }
  const packageMatch = selector.packageId.match(/^afc-ui2a-package:([a-z][a-z0-9-]{0,63}):([a-f0-9]{64})$/);
  if (!packageMatch || packageMatch[1] !== roomId || !/^[a-f0-9]{64}$/.test(selector.receiptSha256) ||
    selector.receiptFileName !== `afc-ui2a-prepared-input.${roomId}.${packageMatch[2]}.receipt.json`) {
    return deepFreeze({ ok: false as const });
  }
  if (value.operation === "validate" &&
    (value.executeCapture === true || value.executeLiveProviderCall === true) &&
    !(value.executeCapture === true && value.executeLiveProviderCall === true)) {
    return deepFreeze({ ok: false as const });
  }
  return deepFreeze({
    ok: true as const,
    request: {
      contractVersion: AFC_UI2B_PROPOSAL_RUN_REQUEST_VERSION,
      operation: value.operation,
      roomLabel: roomId,
      packageSelector: {
        packageId: selector.packageId,
        receiptFileName: selector.receiptFileName,
        receiptSha256: selector.receiptSha256,
      },
      studyMode: value.studyMode,
      ...(Object.hasOwn(value, "executeCapture") ? { executeCapture: value.executeCapture } : {}),
      ...(Object.hasOwn(value, "executeLiveProviderCall") ? { executeLiveProviderCall: value.executeLiveProviderCall } : {}),
    },
  });
}

export function isAfcUi2bStudyMode(value: unknown): value is AfcUi2bStudyMode {
  return isStudyMode(value);
}
