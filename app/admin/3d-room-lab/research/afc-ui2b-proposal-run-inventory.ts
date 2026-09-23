/** Read-only discovery of UI2B companion receipts whose proposal receipts replay in UI1A. */
import "server-only";

import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { replayAfcProposalOverlay } from "./afc-proposal-overlay-view-model";
import { normalizeAfcUi2aRoomLabel } from "./afc-ui2a-original-preparation-contract";
import type { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { AFC_R3C_CAPTURE_ROOT_RELATIVE } from "./gemini-floor-proposal-capture";
import { isAfcUi2bStudyMode } from "./afc-ui2b-proposal-run-contract";
import { replayAfcUi2bBindingReceipt, type AfcUi2bBindingReplaySummary } from "./afc-ui2b-binding-replay";

type RunSummary = AfcUi2bBindingReplaySummary;
export type AfcUi2bProposalRunInventoryResult =
  | Readonly<{ status: "inventory"; roomId: string; runs: readonly RunSummary[]; invalidCandidateCount: number }>
  | Readonly<{ status: "failure"; failureCode: "invalid_input" | "inventory_unavailable"; message: string }>;

export type AfcUi2bProposalRunInventoryDependencies = Readonly<{
  captureRoot?: () => string;
  replayProposal?: typeof replayAfcProposalOverlay;
  replayPackage?: typeof replayAfcUi2aPreparedPackage;
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
function packageIdForRoom(value: unknown, roomId: string): value is string {
  return typeof value === "string" && new RegExp(`^afc-ui2a-package:${roomId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:[a-f0-9]{64}$`).test(value);
}
async function canonicalDirectory(root: string): Promise<string | null> {
  try {
    const info = await lstat(root);
    return info.isDirectory() && !info.isSymbolicLink() ? await realpath(root) : null;
  } catch { return null; }
}
export async function discoverAfcUi2bProposalRuns(
  input: Readonly<{ roomLabel: unknown; packageId?: unknown; studyMode?: unknown }>,
  dependencies: AfcUi2bProposalRunInventoryDependencies = {},
): Promise<AfcUi2bProposalRunInventoryResult> {
  const roomId = normalizeAfcUi2aRoomLabel(input.roomLabel);
  if (!roomId || (input.packageId !== undefined && !packageIdForRoom(input.packageId, roomId)) ||
    (input.studyMode !== undefined && !isAfcUi2bStudyMode(input.studyMode))) {
    return deepFreeze({ status: "failure" as const, failureCode: "invalid_input" as const, message: "The proposal-run inventory query is invalid." });
  }
  const captureRoot = await canonicalDirectory((dependencies.captureRoot ?? (() => path.join(process.cwd(), AFC_R3C_CAPTURE_ROOT_RELATIVE)))());
  if (!captureRoot) return deepFreeze({ status: "failure" as const, failureCode: "inventory_unavailable" as const, message: "The proposal-run inventory is unavailable." });
  let names: string[];
  try { names = await readdir(captureRoot); } catch {
    return deepFreeze({ status: "failure" as const, failureCode: "inventory_unavailable" as const, message: "The proposal-run inventory is unavailable." });
  }
  let invalidCandidateCount = 0;
  const runs: RunSummary[] = [];
  for (const name of names.filter((candidate) => /^afc-ui2b-run\.[a-f0-9]{64}\.binding\.json$/.test(candidate)).sort()) {
    const strictReplay = await replayAfcUi2bBindingReceipt({ roomLabel: roomId, bindingFileName: name }, {
      captureRoot: () => captureRoot, replayPackage: dependencies.replayPackage, replayProposal: dependencies.replayProposal,
    });
    if (strictReplay.status !== "valid") { invalidCandidateCount++; continue; }
    if ((input.packageId !== undefined && strictReplay.summary.packageId !== input.packageId) ||
      (input.studyMode !== undefined && strictReplay.summary.studyMode !== input.studyMode)) continue;
    runs.push(strictReplay.summary);
  }
  runs.sort((left, right) => `${left.packageId}\n${left.studyMode}\n${left.proposal.receiptFileName}`.localeCompare(`${right.packageId}\n${right.studyMode}\n${right.proposal.receiptFileName}`));
  return deepFreeze({ status: "inventory" as const, roomId, runs, invalidCandidateCount });
}
