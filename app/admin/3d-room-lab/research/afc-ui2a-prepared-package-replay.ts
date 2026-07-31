import "server-only";

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import {
  parseAfcR3cImageManifest,
  validateSharedCandidateComparisonContext,
} from "./gemini-floor-proposal-manifest";
import type { AfcUi2aVerifiedEmptyEvidence } from "./afc-ui2a-empty-evidence-replay";
import {
  replayAfcUi2aOriginalPreparation,
  type AfcUi2aOriginalPreparationReplayResult,
} from "./afc-ui2a-original-preparation-replay";
import { normalizeAfcUi2aRoomLabel } from "./afc-ui2a-original-preparation-contract";
import type { AfcUi2aOriginalPreparationSelector } from "./afc-ui2a-package-contract";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import { reverifyAfcUi2aPackageImages } from "./afc-ui2a-package-image-verification";
import {
  afcUi2aManifestFilename,
  buildAfcUi2aPackageIdentity,
  deepFreeze,
  parseAfcUi2aPreparedInputReceipt,
  type AfcUi2aPreparedInputReceiptV1,
} from "./afc-ui2a-prepared-package-contract";
import { digestAfcUi2aSharedContext } from "./afc-ui2a-shared-context";

export type AfcUi2aPreparedPackageFailureCode =
  | "invalid_input" | "original_evidence_invalid" | "original_image_missing" | "original_image_mismatch"
  | "empty_evidence_invalid" | "empty_image_missing" | "empty_image_mismatch" | "empty_lineage_mismatch"
  | "pair_incompatible" | "shared_context_invalid" | "manifest_conflict" | "manifest_validation_failed"
  | "package_not_found" | "package_receipt_hash_mismatch" | "package_receipt_invalid"
  | "package_replay_failed" | "unexpected_failure";

export type AfcUi2aPreparedPackageReplayDependencies = Readonly<{
  replayOriginal?: (args: {
    roomLabel: unknown;
    selector: AfcUi2aOriginalPreparationSelector;
  }) => Promise<AfcUi2aOriginalPreparationReplayResult>;
  resolveFixedInputsRoot?: (configured: string | null | undefined) => Promise<
    { ok: true; root: string } | { ok: false; code: "fixed_inputs_root_unavailable" | "fixed_inputs_root_disallowed" }
  >;
}>;

export type AfcUi2aVerifiedPreparedPackage = Readonly<{
  packageId: string;
  roomId: string;
  receipt: AfcUi2aPreparedInputReceiptV1;
  roomDirectory: string;
  manifestFilePath: string;
  originalFilePath: string;
  emptyRoomAssistFilePath: string;
}>;

function failure(failureCode: AfcUi2aPreparedPackageFailureCode): Readonly<{ ok: false; failureCode: AfcUi2aPreparedPackageFailureCode }> {
  return deepFreeze({ ok: false as const, failureCode });
}
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function safeFile(directory: string, filename: string): Promise<{ path: string; bytes: Buffer } | null> {
  if (path.basename(filename) !== filename) return null;
  const lexical = path.resolve(directory, filename);
  if (!inside(directory, lexical)) return null;
  try {
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(lexical);
    return inside(directory, actual) ? { path: actual, bytes: await readFile(actual) } : null;
  } catch {
    return null;
  }
}
async function safeRoomDirectory(root: string, roomId: string): Promise<string | null> {
  const lexical = path.resolve(root, roomId);
  if (!inside(root, lexical) || path.basename(lexical) !== roomId) return null;
  try {
    const info = await lstat(lexical);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const [rootReal, roomReal] = await Promise.all([realpath(root), realpath(lexical)]);
    return inside(rootReal, roomReal) ? roomReal : null;
  } catch {
    return null;
  }
}
function receiptCompatibilityMatches(
  receipt: AfcUi2aPreparedInputReceiptV1,
  original: { sha256: string; decodedWidth: number; decodedHeight: number; orientation: number },
  empty: { sha256: string; decodedWidth: number; decodedHeight: number; orientation: number },
): boolean {
  const compatibility = classifyAfcR3cImagePairCompatibility(
    { fingerprint: original.sha256, decodedWidth: original.decodedWidth, decodedHeight: original.decodedHeight, orientation: original.orientation },
    { fingerprint: empty.sha256, decodedWidth: empty.decodedWidth, decodedHeight: empty.decodedHeight, orientation: empty.orientation },
  );
  return compatibility.tier !== "incompatible" &&
    compatibility.version === receipt.compatibility.version &&
    compatibility.tier === receipt.compatibility.tier &&
    (Object.is(compatibility.relativeAspectErrorRaw, receipt.compatibility.relativeAspectErrorRaw) ||
      compatibility.relativeAspectErrorRaw === receipt.compatibility.relativeAspectErrorRaw) &&
    (Object.is(compatibility.relativeAspectError, receipt.compatibility.relativeAspectError) ||
      compatibility.relativeAspectError === receipt.compatibility.relativeAspectError);
}
function manifestImageMatchesReceipt(
  manifest: { filePath: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: number },
  receipt: { fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: number },
): boolean {
  return manifest.filePath === receipt.fileName && manifest.sha256 === receipt.sha256 &&
    manifest.byteCount === receipt.byteCount && manifest.mimeType === receipt.mimeType &&
    manifest.decodedWidth === receipt.decodedWidth && manifest.decodedHeight === receipt.decodedHeight &&
    manifest.orientation === receipt.orientation;
}

/** Read-only package replay. Returned paths remain server-only evidence for UI2A-3. */
export async function replayAfcUi2aPreparedPackage(args: {
  roomLabel: unknown;
  packageId: unknown;
  receiptFileName: unknown;
  receiptSha256: unknown;
}, dependencies: AfcUi2aPreparedPackageReplayDependencies = {}): Promise<
  Readonly<{ ok: true; evidence: AfcUi2aVerifiedPreparedPackage }> |
  Readonly<{ ok: false; failureCode: AfcUi2aPreparedPackageFailureCode }>
> {
  const roomId = normalizeAfcUi2aRoomLabel(args.roomLabel);
  const packageMatch = typeof args.packageId === "string" &&
    args.packageId.match(/^afc-ui2a-package:([a-z][a-z0-9-]{0,63}):([a-f0-9]{64})$/);
  if (!roomId || !packageMatch || packageMatch[1] !== roomId || typeof args.receiptFileName !== "string" ||
    typeof args.receiptSha256 !== "string" || !/^[a-f0-9]{64}$/.test(args.receiptSha256)) return failure("invalid_input");
  const expectedReceiptFileName = `afc-ui2a-prepared-input.${roomId}.${packageMatch[2]}.receipt.json`;
  if (args.receiptFileName !== expectedReceiptFileName) return failure("invalid_input");
  const root = await (dependencies.resolveFixedInputsRoot ?? resolveAfcUi2aFixedInputsRoot)(process.env.AFC_UI1_FIXED_INPUTS_ROOT);
  if (!root.ok) return failure("package_not_found");
  const roomDirectory = await safeRoomDirectory(root.root, roomId);
  if (!roomDirectory) return failure("package_not_found");
  const receiptFile = await safeFile(roomDirectory, args.receiptFileName);
  if (!receiptFile) return failure("package_not_found");
  if (sha(receiptFile.bytes) !== args.receiptSha256) return failure("package_receipt_hash_mismatch");
  let parsed: ReturnType<typeof parseAfcUi2aPreparedInputReceipt>;
  try { parsed = parseAfcUi2aPreparedInputReceipt(JSON.parse(receiptFile.bytes.toString("utf8"))); }
  catch { return failure("package_receipt_invalid"); }
  if (!parsed.ok || parsed.receipt.roomId !== roomId || parsed.receipt.packageId !== args.packageId) return failure("package_receipt_invalid");
  const receipt = parsed.receipt;
  const originalSelector: AfcUi2aOriginalPreparationSelector = { ...receipt.originalPreparation };
  const originalReplay = dependencies.replayOriginal ?? replayAfcUi2aOriginalPreparation;
  const originalReplayResult = await originalReplay({ roomLabel: roomId, selector: originalSelector });
  if (!originalReplayResult.ok) return failure("original_evidence_invalid");
  const originalEvidence = originalReplayResult.evidence;
  if (originalEvidence.preparationId !== receipt.originalPreparation.preparationId ||
    originalEvidence.roomId !== roomId || originalEvidence.roomDirectory !== roomDirectory) return failure("original_evidence_invalid");
  const manifestName = afcUi2aManifestFilename(roomId);
  if (receipt.manifest.fileName !== manifestName) return failure("manifest_validation_failed");
  const manifestFile = await safeFile(originalEvidence.roomDirectory, manifestName);
  if (!manifestFile) return failure("manifest_validation_failed");
  if (sha(manifestFile.bytes) !== receipt.manifest.sha256) return failure("manifest_validation_failed");
  let manifest: ReturnType<typeof parseAfcR3cImageManifest>;
  try { manifest = parseAfcR3cImageManifest(JSON.parse(manifestFile.bytes.toString("utf8"))); }
  catch { return failure("manifest_validation_failed"); }
  if (!manifest.ok || manifest.manifest.roomId !== roomId ||
    JSON.stringify(manifest.manifest.sharedComparisonContext) !== JSON.stringify(receipt.sharedComparisonContext) ||
    !manifestImageMatchesReceipt(manifest.manifest.original, receipt.original) ||
    !manifestImageMatchesReceipt(manifest.manifest.emptyRoomAssist, receipt.emptyRoomAssist) ||
    manifest.manifest.emptyRoomAssist.generatedFromOriginalSha256 !== receipt.emptyRoomAssist.generatedFromOriginalSha256 ||
    manifest.manifest.emptyRoomAssist.generatorId !== receipt.emptyRoomAssist.generatorId ||
    manifest.manifest.emptyRoomAssist.generatorModelId !== receipt.emptyRoomAssist.requestedModelId) return failure("manifest_validation_failed");
  const emptyEvidence: AfcUi2aVerifiedEmptyEvidence = {
    canonicalReceiptFileName: "",
    emptyRoomAssist: {
      fileName: receipt.emptyRoomAssist.fileName, sha256: receipt.emptyRoomAssist.sha256,
      byteCount: receipt.emptyRoomAssist.byteCount, mimeType: receipt.emptyRoomAssist.mimeType,
      decodedWidth: receipt.emptyRoomAssist.decodedWidth, decodedHeight: receipt.emptyRoomAssist.decodedHeight,
      orientation: 1, generatedFromOriginalSha256: receipt.emptyRoomAssist.generatedFromOriginalSha256,
      generatorId: receipt.emptyRoomAssist.generatorId, requestedModelId: "NBP",
      resolvedModelId: null, resolvedModelStatus: "not_reported_by_compositor",
    },
  };
  const reverified = await reverifyAfcUi2aPackageImages(originalEvidence, emptyEvidence);
  if (!reverified.ok) return failure(reverified.failureCode);
  if (JSON.stringify(reverified.images.original) !== JSON.stringify(receipt.original) ||
    reverified.images.emptyRoomAssist.sha256 !== receipt.emptyRoomAssist.sha256) return failure("package_replay_failed");
  const context = validateSharedCandidateComparisonContext(receipt.sharedComparisonContext);
  if (!context.ok || digestAfcUi2aSharedContext(context.value) !== receipt.sharedContextDigest) return failure("shared_context_invalid");
  if (!receiptCompatibilityMatches(receipt, reverified.images.original, reverified.images.emptyRoomAssist)) return failure("pair_incompatible");
  const identity = buildAfcUi2aPackageIdentity({
    roomId, originalSha256: receipt.original.sha256, emptySha256: receipt.emptyRoomAssist.sha256,
    manifestSha256: receipt.manifest.sha256, sharedContextDigest: receipt.sharedContextDigest,
    compatibility: receipt.compatibility,
  });
  if (!identity || identity.packageId !== receipt.packageId || identity.receiptFileName !== args.receiptFileName) return failure("package_replay_failed");
  const originalFile = await safeFile(originalEvidence.roomDirectory, receipt.original.fileName);
  const emptyFile = await safeFile(originalEvidence.roomDirectory, receipt.emptyRoomAssist.fileName);
  if (!originalFile || !emptyFile) return failure("package_replay_failed");
  return deepFreeze({
    ok: true as const,
    evidence: {
      packageId: receipt.packageId, roomId, receipt, roomDirectory: reverified.images.roomDirectory,
      manifestFilePath: manifestFile.path, originalFilePath: originalFile.path, emptyRoomAssistFilePath: emptyFile.path,
    },
  });
}

export function summarizeAfcUi2aPreparedPackage(evidence: AfcUi2aVerifiedPreparedPackage): Readonly<{
  packageId: string; roomId: string; receiptFileName: string; manifestFileName: string;
}> {
  return deepFreeze({
    packageId: evidence.packageId,
    roomId: evidence.roomId,
    receiptFileName: `afc-ui2a-prepared-input.${evidence.roomId}.${evidence.packageId.split(":").at(-1)}.receipt.json`,
    manifestFileName: evidence.receipt.manifest.fileName,
  });
}
