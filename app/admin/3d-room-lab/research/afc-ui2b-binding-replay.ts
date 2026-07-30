/** Strict server-only replay for one immutable UI2B companion binding receipt. */
import "server-only";

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { replayAfcProposalOverlay } from "./afc-proposal-overlay-view-model";
import { normalizeAfcUi2aRoomLabel } from "./afc-ui2a-original-preparation-contract";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { AFC_R3C_CAPTURE_ROOT_RELATIVE } from "./gemini-floor-proposal-capture";
import { afcUi2bProposalBindingReceiptFileName, parseAfcUi2bBindingReceipt } from "./afc-ui2b-proposal-run";

export type AfcUi2bBindingReplaySummary = Readonly<{
  packageId: string; roomId: string; studyMode: "original_only" | "empty_only";
  proposal: Readonly<{ receiptFileName: string; receiptSha256: string; candidateCount: number; acceptedCandidateIds: readonly string[]; warningCount: number; strictReplayVerified: true }>;
  selectedImageSha256: string; manifestSha256: string; providerCallCount: 1;
}>;
export type AfcUi2bBindingReplayResult =
  | Readonly<{ status: "valid"; summary: AfcUi2bBindingReplaySummary }>
  | Readonly<{ status: "invalid" }>;
export type AfcUi2bBindingReplayDependencies = Readonly<{
  captureRoot?: () => string;
  replayPackage?: typeof replayAfcUi2aPreparedPackage;
  replayProposal?: typeof replayAfcProposalOverlay;
}>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}
function safeName(value: unknown): value is string {
  return typeof value === "string" && value === path.basename(value) && value.length > 0 && !value.includes("\0");
}
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function canonicalDirectory(root: string): Promise<string | null> {
  try {
    const info = await lstat(root);
    return info.isDirectory() && !info.isSymbolicLink() ? await realpath(root) : null;
  } catch { return null; }
}
async function immutableBytes(root: string, filename: string): Promise<Buffer | null> {
  if (!safeName(filename)) return null;
  try {
    const candidate = path.resolve(root, filename);
    if (!inside(root, candidate)) return null;
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(candidate);
    return inside(root, actual) ? await readFile(actual) : null;
  } catch { return null; }
}

/** Replays every binding edge without returning paths or raw artifacts. */
export async function replayAfcUi2bBindingReceipt(
  input: Readonly<{ roomLabel: unknown; bindingFileName: unknown }>,
  dependencies: AfcUi2bBindingReplayDependencies = {},
): Promise<AfcUi2bBindingReplayResult> {
  const roomId = normalizeAfcUi2aRoomLabel(input.roomLabel);
  if (!roomId || !safeName(input.bindingFileName) || !/^afc-ui2b-run\.[a-f0-9]{64}\.binding\.json$/.test(input.bindingFileName)) {
    return deepFreeze({ status: "invalid" as const });
  }
  const rootInput = (dependencies.captureRoot ?? (() => path.join(process.cwd(), AFC_R3C_CAPTURE_ROOT_RELATIVE)))();
  const captureRoot = await canonicalDirectory(rootInput);
  if (!captureRoot) return deepFreeze({ status: "invalid" as const });
  const bytes = await immutableBytes(captureRoot, input.bindingFileName);
  if (!bytes) return deepFreeze({ status: "invalid" as const });
  let parsed: ReturnType<typeof parseAfcUi2bBindingReceipt>;
  try { parsed = parseAfcUi2bBindingReceipt(JSON.parse(bytes.toString("utf8"))); } catch { return deepFreeze({ status: "invalid" as const }); }
  if (!parsed.ok || parsed.receipt.roomId !== roomId || input.bindingFileName !== afcUi2bProposalBindingReceiptFileName(parsed.receipt.proposal.receiptSha256)) {
    return deepFreeze({ status: "invalid" as const });
  }
  const receipt = parsed.receipt;
  const packageReplay = await (dependencies.replayPackage ?? replayAfcUi2aPreparedPackage)({
    roomLabel: receipt.roomId, packageId: receipt.package.packageId,
    receiptFileName: receipt.package.receiptFileName, receiptSha256: receipt.package.receiptSha256,
  });
  const expectedImage = receipt.studyMode === "original_only"
    ? packageReplay.ok ? packageReplay.evidence.receipt.original : null
    : packageReplay.ok ? packageReplay.evidence.receipt.emptyRoomAssist : null;
  if (!packageReplay.ok || packageReplay.evidence.receipt.manifest.fileName !== receipt.manifest.fileName ||
    packageReplay.evidence.receipt.manifest.sha256 !== receipt.manifest.sha256 ||
    packageReplay.evidence.receipt.sharedContextDigest !== receipt.sharedContextDigest ||
    !expectedImage || expectedImage.fileName !== receipt.selectedImage.fileName || expectedImage.sha256 !== receipt.selectedImage.sha256) {
    return deepFreeze({ status: "invalid" as const });
  }
  const proposal = await (dependencies.replayProposal ?? replayAfcProposalOverlay)({ receiptFileName: receipt.proposal.receiptFileName, captureRoot });
  const expectedProposalRole = receipt.studyMode === "original_only" ? "original_contextual" : "empty_room_boundary_specialist";
  if (proposal.status !== "valid" || proposal.viewModel.artifactIdentity.receiptSha256 !== receipt.proposal.receiptSha256 ||
    proposal.viewModel.artifactIdentity.roomId !== receipt.roomId || proposal.viewModel.artifactIdentity.studyMode !== receipt.studyMode ||
    proposal.viewModel.artifactIdentity.imageRole !== expectedProposalRole ||
    proposal.viewModel.provenance.provider.modelId !== receipt.runner.modelId ||
    (receipt.studyMode === "original_only"
      ? proposal.viewModel.imageBasis.original.sha256 !== receipt.selectedImage.sha256
      : proposal.viewModel.imageBasis.emptyRoom.sha256 !== receipt.selectedImage.sha256)) {
    return deepFreeze({ status: "invalid" as const });
  }
  return deepFreeze({
    status: "valid" as const,
    summary: {
      packageId: receipt.package.packageId, roomId: receipt.roomId, studyMode: receipt.studyMode,
      proposal: {
        receiptFileName: receipt.proposal.receiptFileName, receiptSha256: receipt.proposal.receiptSha256,
        candidateCount: proposal.viewModel.provenance.afcR3c.candidateIds.length,
        acceptedCandidateIds: [...proposal.viewModel.provenance.afcR3c.candidateIds],
        warningCount: proposal.viewModel.warnings.length, strictReplayVerified: true as const,
      },
      selectedImageSha256: receipt.selectedImage.sha256, manifestSha256: receipt.manifest.sha256, providerCallCount: 1,
    },
  });
}
