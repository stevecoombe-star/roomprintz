import "server-only";

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { classifyAfcR3cImagePairCompatibility } from "./gemini-floor-proposal-composition";
import { writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
import type { AfcUi2aVerifiedEmptyEvidence } from "./afc-ui2a-empty-evidence-replay";
import type { AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";
import type { AfcUi2aOriginalPreparationSelector } from "./afc-ui2a-package-contract";
import { reverifyAfcUi2aPackageImages, type AfcUi2aPackageImageVerificationDependencies } from "./afc-ui2a-package-image-verification";
import { buildAfcUi2aImageManifest, stableAfcUi2aManifestBytes, writeAfcUi2aImageManifest } from "./afc-ui2a-manifest-writer";
import {
  afcUi2aManifestFilename,
  buildAfcUi2aPackageIdentity,
  deepFreeze,
  parseAfcUi2aPreparedInputReceipt,
  stableAfcUi2aPreparedInputReceiptBytes,
} from "./afc-ui2a-prepared-package-contract";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { buildAfcUi2aSharedComparisonContext, digestAfcUi2aSharedContext } from "./afc-ui2a-shared-context";

export type AfcUi2aPreparedPackageMaterializationFailureCode =
  | "invalid_input" | "capture_not_authorized" | "original_evidence_invalid" | "original_image_missing"
  | "original_image_mismatch" | "empty_evidence_invalid" | "empty_image_missing" | "empty_image_mismatch"
  | "empty_lineage_mismatch" | "pair_incompatible" | "shared_context_invalid" | "manifest_build_failed"
  | "manifest_conflict" | "manifest_capture_failed" | "manifest_validation_failed"
  | "package_receipt_capture_failed" | "package_receipt_validation_failed" | "package_replay_failed"
  | "package_not_found" | "package_receipt_hash_mismatch" | "package_receipt_invalid" | "unexpected_failure";

type CompatibilityEvidence = Readonly<{
  version: "afc-r3c-image-pair-compatibility/v1";
  tier: "exact_grid_compatible";
  relativeAspectErrorRaw: number;
  relativeAspectError: number;
}>;

export type AfcUi2aPreparedPackageResult =
  | Readonly<{
    status: "package_materialized"; packageId: string; roomId: string; originalPreparationId: string;
    original: AfcUi2aVerifiedOriginalEvidence["original"];
    emptyRoomAssist: AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"];
    compatibility: CompatibilityEvidence; sharedContextDigest: string;
    manifest: Readonly<{ fileName: string; sha256: string; contractVersion: "afc-r3c-image-manifest/v1"; disposition: "written" | "byte_identical" | "semantically_adopted" }>;
    receipt: Readonly<{ fileName: string; sha256: string; reused: boolean }>;
    safety: ReturnType<typeof packageSafety>;
  }>
  | Readonly<{ status: "failure"; failureCode: AfcUi2aPreparedPackageMaterializationFailureCode; message: string }>;

export type AfcUi2aPreparedPackageDependencies = Readonly<{
  imageVerification?: AfcUi2aPackageImageVerificationDependencies;
  immutableWriter?: typeof writeAfcR3cImmutableCapture;
  replayPackage?: typeof replayAfcUi2aPreparedPackage;
}>;

function packageSafety() {
  return {
    authoritative: false as const, applied: false as const, persistedToScene: false as const,
    activeCameraUnchanged: true as const, floorStateUnchanged: true as const, supportStateUnchanged: true as const,
    databaseWrites: false as const, productionAssetWrites: false as const, productionTokenAccountingUsed: false as const,
    emptyRoomGenerationCall: false as const, geminiFloorProposalCall: false as const, afcR2Run: false as const,
    localResearchPackageWritten: true as const,
  };
}
function message(code: AfcUi2aPreparedPackageMaterializationFailureCode): string {
  switch (code) {
    case "invalid_input": return "The verified package inputs are invalid.";
    case "capture_not_authorized": return "Confirm prepared-package materialization before accessing local evidence.";
    case "original_evidence_invalid": return "The Original-preparation evidence is invalid.";
    case "original_image_missing": return "The immutable Original image is unavailable.";
    case "original_image_mismatch": return "The immutable Original image no longer matches verified evidence.";
    case "empty_evidence_invalid": return "The Empty-Room evidence is invalid.";
    case "empty_image_missing": return "The immutable Empty-Room image is unavailable.";
    case "empty_image_mismatch": return "The immutable Empty-Room image no longer matches verified evidence.";
    case "empty_lineage_mismatch": return "The Empty-Room evidence does not match the verified Original.";
    case "pair_incompatible": return "The image pair is not exact-grid compatible; manifest v1 requires identical decoded dimensions.";
    case "shared_context_invalid": return "The shared comparison context is invalid.";
    case "manifest_build_failed": return "The image manifest could not be built.";
    case "manifest_conflict": return "A different immutable manifest already exists for this room.";
    case "manifest_capture_failed": return "The image manifest could not be captured immutably.";
    case "manifest_validation_failed": return "The image manifest did not pass verification.";
    case "package_receipt_capture_failed": return "The prepared-package receipt could not be captured immutably.";
    case "package_receipt_validation_failed": return "The prepared-package receipt did not pass verification.";
    case "package_replay_failed": return "The prepared package did not pass strict replay.";
    case "package_not_found": return "The prepared package is unavailable.";
    case "package_receipt_hash_mismatch": return "The prepared-package receipt changed after selection.";
    case "package_receipt_invalid": return "The prepared-package receipt is invalid.";
    case "unexpected_failure": return "The prepared package could not be completed.";
  }
}
function fail(code: AfcUi2aPreparedPackageMaterializationFailureCode): AfcUi2aPreparedPackageResult {
  return deepFreeze({ status: "failure" as const, failureCode: code, message: message(code) });
}
function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function zero(value: number): number { return Object.is(value, -0) ? 0 : value; }
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function safeExistingFile(directory: string, name: string): Promise<Buffer | null | "unsafe"> {
  if (path.basename(name) !== name) return "unsafe";
  const lexical = path.resolve(directory, name);
  if (!inside(directory, lexical)) return "unsafe";
  try {
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink()) return "unsafe";
    const actual = await realpath(lexical);
    return inside(directory, actual) ? await readFile(actual) : "unsafe";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unsafe";
  }
}

export function admitAfcUi2aExactGridPair(
  original: AfcUi2aVerifiedOriginalEvidence["original"],
  empty: AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"],
): Readonly<{ ok: true; compatibility: CompatibilityEvidence }> | Readonly<{
  ok: false; compatibility: Readonly<{ version: string; tier: string; relativeAspectErrorRaw: number | null; relativeAspectError: number | null }>;
}> {
  const classified = classifyAfcR3cImagePairCompatibility(
    { fingerprint: original.sha256, decodedWidth: original.decodedWidth, decodedHeight: original.decodedHeight, orientation: original.orientation },
    { fingerprint: empty.sha256, decodedWidth: empty.decodedWidth, decodedHeight: empty.decodedHeight, orientation: empty.orientation },
  );
  const evidence = {
    version: classified.version, tier: classified.tier,
    relativeAspectErrorRaw: classified.relativeAspectErrorRaw === null ? null : zero(classified.relativeAspectErrorRaw),
    relativeAspectError: classified.relativeAspectError === null ? null : zero(classified.relativeAspectError),
  };
  if (classified.tier !== "exact_grid_compatible" || evidence.relativeAspectErrorRaw === null || evidence.relativeAspectError === null) {
    return deepFreeze({ ok: false as const, compatibility: evidence });
  }
  return deepFreeze({
    ok: true as const,
    compatibility: {
      version: classified.version,
      tier: "exact_grid_compatible" as const,
      relativeAspectErrorRaw: evidence.relativeAspectErrorRaw,
      relativeAspectError: evidence.relativeAspectError,
    },
  });
}

/** Materializes only an already verified Original + Empty pair; it never resolves or generates Empty evidence. */
export async function materializeAfcUi2aPreparedPackage(args: {
  originalPreparation: AfcUi2aOriginalPreparationSelector;
  originalEvidence: AfcUi2aVerifiedOriginalEvidence;
  emptyEvidence: AfcUi2aVerifiedEmptyEvidence;
  executeCapture: unknown;
}, dependencies: AfcUi2aPreparedPackageDependencies = {}): Promise<AfcUi2aPreparedPackageResult> {
  if (args.executeCapture !== true) return fail("capture_not_authorized");
  if (args.originalPreparation.preparationId !== args.originalEvidence.preparationId ||
    args.originalPreparation.receiptFileName !==
      `afc-ui2a-original-preparation.${args.originalEvidence.roomId}.${args.originalEvidence.original.sha256}.receipt.json` ||
    !/^[a-f0-9]{64}$/.test(args.originalPreparation.receiptSha256)) return fail("original_evidence_invalid");
  const reverified = await reverifyAfcUi2aPackageImages(args.originalEvidence, args.emptyEvidence, dependencies.imageVerification);
  if (!reverified.ok) return fail(reverified.failureCode);
  const admission = admitAfcUi2aExactGridPair(reverified.images.original, reverified.images.emptyRoomAssist);
  if (!admission.ok) return fail("pair_incompatible");
  const shared = buildAfcUi2aSharedComparisonContext({
    roomId: args.originalEvidence.roomId, originalSha256: reverified.images.original.sha256,
    originalWidth: reverified.images.original.decodedWidth, originalHeight: reverified.images.original.decodedHeight,
  });
  if (!shared.ok) return fail("shared_context_invalid");
  const sharedContextDigest = digestAfcUi2aSharedContext(shared.context);
  const builtManifest = buildAfcUi2aImageManifest({
    roomId: args.originalEvidence.roomId, images: reverified.images, sharedComparisonContext: shared.context,
  });
  if (!builtManifest.ok) return fail("manifest_build_failed");
  const manifestWrite = await writeAfcUi2aImageManifest({
    roomDirectory: reverified.images.roomDirectory, roomId: args.originalEvidence.roomId,
    expectedManifest: builtManifest.manifest, expectedBytes: stableAfcUi2aManifestBytes(builtManifest.manifest),
  }, { immutableWriter: dependencies.immutableWriter });
  if (!manifestWrite.ok) return fail(manifestWrite.failureCode);
  const identity = buildAfcUi2aPackageIdentity({
    roomId: args.originalEvidence.roomId, originalSha256: reverified.images.original.sha256,
    emptySha256: reverified.images.emptyRoomAssist.sha256, manifestSha256: manifestWrite.sha256,
    sharedContextDigest, compatibility: admission.compatibility,
  });
  if (!identity) return fail("unexpected_failure");
  const receipt = {
    receiptContractVersion: "afc-ui2a-prepared-input-receipt/v1" as const,
    preparationStage: "pair_manifest_prepared" as const,
    packageId: identity.packageId,
    roomId: args.originalEvidence.roomId,
    originalPreparation: { ...args.originalPreparation },
    original: { ...reverified.images.original },
    emptyRoomAssist: {
      fileName: reverified.images.emptyRoomAssist.fileName,
      sha256: reverified.images.emptyRoomAssist.sha256,
      byteCount: reverified.images.emptyRoomAssist.byteCount,
      mimeType: reverified.images.emptyRoomAssist.mimeType,
      decodedWidth: reverified.images.emptyRoomAssist.decodedWidth,
      decodedHeight: reverified.images.emptyRoomAssist.decodedHeight,
      orientation: 1 as const,
      generatedFromOriginalSha256: reverified.images.emptyRoomAssist.generatedFromOriginalSha256,
      generatorId: reverified.images.emptyRoomAssist.generatorId,
      requestedModelId: "NBP" as const,
      resolvedModelStatus: "not_reported_by_compositor" as const,
    },
    compatibility: admission.compatibility,
    sharedComparisonContext: shared.context,
    sharedContextDigest,
    manifest: { fileName: afcUi2aManifestFilename(args.originalEvidence.roomId), sha256: manifestWrite.sha256, contractVersion: "afc-r3c-image-manifest/v1" as const },
    safety: packageSafety(),
  };
  const receiptParsed = parseAfcUi2aPreparedInputReceipt(receipt);
  if (!receiptParsed.ok) return fail("package_receipt_validation_failed");
  const receiptBytes = stableAfcUi2aPreparedInputReceiptBytes(receiptParsed.receipt);
  const prior = await safeExistingFile(reverified.images.roomDirectory, identity.receiptFileName);
  if (prior === "unsafe") return fail("package_receipt_capture_failed");
  if (prior && !prior.equals(receiptBytes)) return fail("package_receipt_capture_failed");
  const write = await (dependencies.immutableWriter ?? writeAfcR3cImmutableCapture)({
    outputDir: reverified.images.roomDirectory, filename: identity.receiptFileName, bytes: receiptBytes,
  });
  if (!write.ok) return fail("package_receipt_capture_failed");
  const actualReceiptBytes = await safeExistingFile(reverified.images.roomDirectory, identity.receiptFileName);
  if (!actualReceiptBytes || actualReceiptBytes === "unsafe") return fail("package_receipt_validation_failed");
  const receiptSha256 = hash(actualReceiptBytes);
  let actualReceipt: ReturnType<typeof parseAfcUi2aPreparedInputReceipt>;
  try { actualReceipt = parseAfcUi2aPreparedInputReceipt(JSON.parse(actualReceiptBytes.toString("utf8"))); }
  catch { return fail("package_receipt_validation_failed"); }
  if (!actualReceipt.ok || !actualReceiptBytes.equals(receiptBytes)) return fail("package_receipt_validation_failed");
  const replay = await (dependencies.replayPackage ?? replayAfcUi2aPreparedPackage)({
    roomLabel: args.originalEvidence.roomId, packageId: identity.packageId,
    receiptFileName: identity.receiptFileName, receiptSha256,
  });
  if (!replay.ok) return fail("package_replay_failed");
  return deepFreeze({
    status: "package_materialized" as const, packageId: identity.packageId, roomId: args.originalEvidence.roomId,
    originalPreparationId: args.originalEvidence.preparationId, original: { ...reverified.images.original },
    emptyRoomAssist: { ...reverified.images.emptyRoomAssist }, compatibility: admission.compatibility, sharedContextDigest,
    manifest: { fileName: manifestWrite.fileName, sha256: manifestWrite.sha256, contractVersion: "afc-r3c-image-manifest/v1" as const, disposition: manifestWrite.disposition },
    receipt: { fileName: identity.receiptFileName, sha256: receiptSha256, reused: write.reused },
    safety: packageSafety(),
  });
}
