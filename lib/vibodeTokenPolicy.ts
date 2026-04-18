import type { TokenActionKey } from "@/lib/vibodeTokenConstants";

const STAGE_ACTION_MAP: Record<number, TokenActionKey> = {
  1: "STAGE_1",
  2: "STAGE_2",
  3: "STAGE_3",
  4: "STAGE_4",
  5: "STAGE_5",
};

const EDIT_ACTION_MAP: Record<string, TokenActionKey> = {
  remove: "EDIT_REMOVE",
  swap: "EDIT_SWAP",
  move: "EDIT_MOVE",
  rotate: "EDIT_ROTATE",
};

export function getStageTokenActionKey(stageNumber: number | null | undefined): TokenActionKey | null {
  if (typeof stageNumber !== "number" || !Number.isFinite(stageNumber)) return null;
  const normalized = Math.trunc(stageNumber);
  return STAGE_ACTION_MAP[normalized] ?? null;
}

export function getEditTokenActionKey(toolName: string | null | undefined): TokenActionKey | null {
  if (typeof toolName !== "string") return null;
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return null;
  return EDIT_ACTION_MAP[normalized] ?? null;
}

export function buildTokenLedgerMetadata(args: {
  modelVersion?: string | null;
  stageNumber?: number | null;
  endpoint?: string | null;
  requestKind?: string | null;
}): Record<string, unknown> {
  return {
    modelVersion: args.modelVersion ?? null,
    stageNumber: args.stageNumber ?? null,
    endpoint: args.endpoint ?? null,
    requestKind: args.requestKind ?? null,
  };
}
