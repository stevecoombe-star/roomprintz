import "server-only";

import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { normalizeAfcUi2aRoomLabel } from "./afc-ui2a-original-preparation-contract";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import { parseAfcUi2aPreparedInputReceipt, type AfcUi2aPreparedInputReceiptV1 } from "./afc-ui2a-prepared-package-contract";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { deepFreeze } from "./afc-ui2a-complete-contract";

type RootResult = { ok: true; root: string } | { ok: false; code: "fixed_inputs_root_unavailable" | "fixed_inputs_root_disallowed" };
type InventoryPackage = Readonly<{
  packageId: string; roomId: string;
  receipt: Readonly<{ fileName: string; sha256: string }>;
  manifest: Readonly<{ fileName: string; sha256: string; contractVersion: "afc-r3c-image-manifest/v1" }>;
  originalPreparationId: string;
  original: Readonly<{ fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: 1 }>;
  emptyRoomAssist: Readonly<{
    fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: 1;
    generatedFromOriginalSha256: string; generatorId: string; requestedModelId: "NBP"; resolvedModelStatus: "not_reported_by_compositor";
  }>;
  compatibility: Readonly<{ version: "afc-r3c-image-pair-compatibility/v1"; tier: "exact_grid_compatible"; relativeAspectErrorRaw: number; relativeAspectError: number }>;
  sharedContextDigest: string;
  safety: Readonly<{
    authoritative: false; applied: false; persistedToScene: false; activeCameraUnchanged: true; floorStateUnchanged: true; supportStateUnchanged: true;
    databaseWrites: false; productionAssetWrites: false; productionTokenAccountingUsed: false; emptyRoomGenerationCall: false;
    geminiFloorProposalCall: false; afcR2Run: false; localResearchPackageWritten: true;
  }>;
}>;
export type AfcUi2aPackageInventoryResult =
  | Readonly<{
    status: "inventory"; roomId: string; packages: readonly InventoryPackage[]; invalidCandidateCount: number;
    safety: Readonly<{ readOnly: true; filesystemWrites: false; compositorCalls: false; geminiCalls: false; afcR2Runs: false; sceneMutations: false }>;
  }>
  | Readonly<{ status: "failure"; failureCode: "invalid_input" | "inventory_unavailable"; message: string }>;

export type AfcUi2aPackageInventoryDependencies = Readonly<{
  resolveFixedInputsRoot?: (configured: string | null | undefined) => Promise<RootResult>;
  replayPackage?: typeof replayAfcUi2aPreparedPackage;
}>;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function failure(failureCode: "invalid_input" | "inventory_unavailable", message: string): AfcUi2aPackageInventoryResult {
  return deepFreeze({ status: "failure" as const, failureCode, message });
}
async function safeRoomDirectory(root: string, roomId: string): Promise<string | null> {
  const lexical = path.resolve(root, roomId);
  if (!inside(root, lexical) || path.basename(lexical) !== roomId) return null;
  try {
    const info = await lstat(lexical);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const [rootReal, roomReal] = await Promise.all([realpath(root), realpath(lexical)]);
    return inside(rootReal, roomReal) ? roomReal : null;
  } catch { return null; }
}
async function safeReceipt(directory: string, fileName: string): Promise<Buffer | null> {
  if (path.basename(fileName) !== fileName) return null;
  const lexical = path.resolve(directory, fileName);
  if (!inside(directory, lexical)) return null;
  try {
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(lexical);
    return inside(directory, actual) ? await readFile(actual) : null;
  } catch { return null; }
}
function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function summary(receiptFileName: string, receiptSha256: string, receipt: AfcUi2aPreparedInputReceiptV1): InventoryPackage {
  return {
    packageId: receipt.packageId, roomId: receipt.roomId,
    receipt: { fileName: receiptFileName, sha256: receiptSha256 },
    manifest: { fileName: receipt.manifest.fileName, sha256: receipt.manifest.sha256, contractVersion: receipt.manifest.contractVersion },
    originalPreparationId: receipt.originalPreparation.preparationId,
    original: {
      fileName: receipt.original.fileName,
      sha256: receipt.original.sha256,
      byteCount: receipt.original.byteCount,
      mimeType: receipt.original.mimeType,
      decodedWidth: receipt.original.decodedWidth,
      decodedHeight: receipt.original.decodedHeight,
      orientation: receipt.original.orientation,
    },
    emptyRoomAssist: {
      fileName: receipt.emptyRoomAssist.fileName, sha256: receipt.emptyRoomAssist.sha256, byteCount: receipt.emptyRoomAssist.byteCount,
      mimeType: receipt.emptyRoomAssist.mimeType, decodedWidth: receipt.emptyRoomAssist.decodedWidth, decodedHeight: receipt.emptyRoomAssist.decodedHeight,
      orientation: 1, generatedFromOriginalSha256: receipt.emptyRoomAssist.generatedFromOriginalSha256,
      generatorId: receipt.emptyRoomAssist.generatorId, requestedModelId: "NBP", resolvedModelStatus: "not_reported_by_compositor",
    },
    compatibility: {
      version: receipt.compatibility.version,
      tier: receipt.compatibility.tier,
      relativeAspectErrorRaw: receipt.compatibility.relativeAspectErrorRaw,
      relativeAspectError: receipt.compatibility.relativeAspectError,
    },
    sharedContextDigest: receipt.sharedContextDigest,
    safety: {
      authoritative: receipt.safety.authoritative,
      applied: receipt.safety.applied,
      persistedToScene: receipt.safety.persistedToScene,
      activeCameraUnchanged: receipt.safety.activeCameraUnchanged,
      floorStateUnchanged: receipt.safety.floorStateUnchanged,
      supportStateUnchanged: receipt.safety.supportStateUnchanged,
      databaseWrites: receipt.safety.databaseWrites,
      productionAssetWrites: receipt.safety.productionAssetWrites,
      productionTokenAccountingUsed: receipt.safety.productionTokenAccountingUsed,
      emptyRoomGenerationCall: receipt.safety.emptyRoomGenerationCall,
      geminiFloorProposalCall: receipt.safety.geminiFloorProposalCall,
      afcR2Run: receipt.safety.afcR2Run,
      localResearchPackageWritten: receipt.safety.localResearchPackageWritten,
    },
  };
}

/** Strict, read-only inventory: a receipt appears only after its own selector strict-replays successfully. */
export async function discoverAfcUi2aPreparedPackages(roomLabel: unknown, dependencies: AfcUi2aPackageInventoryDependencies = {}): Promise<AfcUi2aPackageInventoryResult> {
  const roomId = normalizeAfcUi2aRoomLabel(roomLabel);
  if (!roomId) return failure("invalid_input", "The room label is invalid.");
  const root = await (dependencies.resolveFixedInputsRoot ?? resolveAfcUi2aFixedInputsRoot)(process.env.AFC_UI1_FIXED_INPUTS_ROOT);
  if (!root.ok) return failure("inventory_unavailable", "Prepared-package inventory is unavailable.");
  const roomDirectory = await safeRoomDirectory(root.root, roomId);
  if (!roomDirectory) return failure("inventory_unavailable", "Prepared-package inventory is unavailable.");
  let names: string[];
  try { names = await readdir(roomDirectory); }
  catch { return failure("inventory_unavailable", "Prepared-package inventory is unavailable."); }
  const candidate = new RegExp(`^afc-ui2a-prepared-input\\.${roomId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([a-f0-9]{64})\\.receipt\\.json$`);
  const packages: InventoryPackage[] = [];
  let invalidCandidateCount = 0;
  const replay = dependencies.replayPackage ?? replayAfcUi2aPreparedPackage;
  for (const fileName of names.filter((name) => candidate.test(name)).sort()) {
    const bytes = await safeReceipt(roomDirectory, fileName);
    if (!bytes) { invalidCandidateCount++; continue; }
    const receiptSha256 = hash(bytes);
    let parsed: ReturnType<typeof parseAfcUi2aPreparedInputReceipt>;
    try { parsed = parseAfcUi2aPreparedInputReceipt(JSON.parse(bytes.toString("utf8"))); }
    catch { invalidCandidateCount++; continue; }
    if (!parsed.ok) { invalidCandidateCount++; continue; }
    const replayed = await replay({ roomLabel: roomId, packageId: parsed.receipt.packageId, receiptFileName: fileName, receiptSha256 });
    if (!replayed.ok) { invalidCandidateCount++; continue; }
    packages.push(summary(fileName, receiptSha256, parsed.receipt));
  }
  packages.sort((a, b) => a.packageId.localeCompare(b.packageId));
  return deepFreeze({
    status: "inventory" as const, roomId, packages, invalidCandidateCount,
    safety: { readOnly: true as const, filesystemWrites: false as const, compositorCalls: false as const, geminiCalls: false as const, afcR2Runs: false as const, sceneMutations: false as const },
  });
}
