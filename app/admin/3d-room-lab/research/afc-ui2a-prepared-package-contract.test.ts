import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAfcUi2aPackageIdentity,
  parseAfcUi2aPreparedInputReceipt,
  stableAfcUi2aPreparedInputReceiptBytes,
} from "./afc-ui2a-prepared-package-contract";
import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import { buildAfcUi2aSharedComparisonContext, digestAfcUi2aSharedContext } from "./afc-ui2a-shared-context";

const originalSha256 = "ca9d77cb4b951ce95ed4fa261b55b288164b07e757dbdf5da565eafefc3439b7";
const emptySha256 = "d5f9b40ffbe2789d4756d72162b1d4a38d505da67b36e5deb9b2a9e0ec5bb686";
const manifestSha256 = "9c540ed3c4038a86d231bc8d85eacdb42f90392d83eb348e952af2fbdd14708f";

test("prepared-package identity and receipt are deterministic and closed", () => {
  const context = buildAfcUi2aSharedComparisonContext({
    roomId: "room-a", originalSha256, originalWidth: 1264, originalHeight: 848,
  });
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const sharedContextDigest = digestAfcUi2aSharedContext(context.context);
  const identity = buildAfcUi2aPackageIdentity({
    roomId: "room-a", originalSha256, emptySha256, manifestSha256, sharedContextDigest,
    compatibility: { version: "afc-r3c-image-pair-compatibility/v1", tier: "exact_grid_compatible", relativeAspectErrorRaw: 0 },
  });
  assert.ok(identity);
  if (!identity) return;
  assert.equal(identity.packageDigest, "77b54ebd2c1a250ed9132ba60796709e73f65a8cb2e967b64a55bec863af6ac9");
  const receipt = {
    receiptContractVersion: "afc-ui2a-prepared-input-receipt/v1",
    preparationStage: "pair_manifest_prepared",
    packageId: identity.packageId,
    roomId: "room-a",
    originalPreparation: {
      preparationId: `afc-ui2a-original:room-a:${originalSha256}`,
      receiptFileName: `afc-ui2a-original-preparation.room-a.${originalSha256}.receipt.json`,
      receiptSha256: "a".repeat(64),
    },
    original: {
      fileName: `room-a.original.${originalSha256}.jpg`, sha256: originalSha256, byteCount: 486995,
      mimeType: "image/jpeg", decodedWidth: 1264, decodedHeight: 848, orientation: 1,
    },
    emptyRoomAssist: {
      fileName: `room-a.empty-room.${emptySha256}.png`, sha256: emptySha256, byteCount: 1199149,
      mimeType: "image/png", decodedWidth: 1264, decodedHeight: 848, orientation: 1,
      generatedFromOriginalSha256: originalSha256, generatorId: "vibode-empty-room-assist/stage1-empty-room/v1",
      requestedModelId: "NBP", resolvedModelStatus: "not_reported_by_compositor",
    },
    compatibility: { version: "afc-r3c-image-pair-compatibility/v1", tier: "exact_grid_compatible", relativeAspectErrorRaw: 0, relativeAspectError: 0 },
    sharedComparisonContext: context.context,
    sharedContextDigest,
    manifest: { fileName: "afc-r3c-room-a.image-manifest.v1.json", sha256: manifestSha256, contractVersion: "afc-r3c-image-manifest/v1" },
    safety: {
      authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true,
      floorStateUnchanged: true, supportStateUnchanged: true, databaseWrites: false,
      productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false,
      geminiFloorProposalCall: false, afcR2Run: false, localResearchPackageWritten: true,
    },
  };
  const parsed = parseAfcUi2aPreparedInputReceipt(receipt);
  assert.ok(parsed.ok, parsed.ok ? undefined : parsed.path);
  if (!parsed.ok) return;
  assert.deepEqual(stableAfcUi2aPreparedInputReceiptBytes(parsed.receipt), stableAfcUi2aPreparedInputReceiptBytes(parsed.receipt));
  assert.equal(Object.isFrozen(parsed.receipt), true);
  assert.equal(Object.isFrozen(parsed.receipt.safety), true);
  assert.equal(parseAfcUi2aPreparedInputReceipt({ ...receipt, timestamp: "forbidden" }).ok, false);
  assert.equal(parseAfcUi2aPreparedInputReceipt({ ...receipt, resolutionSource: "forbidden" }).ok, false);
  assert.equal(parseAfcUi2aPreparedInputReceipt({ ...receipt, packageId: `${identity.packageId}x` }).ok, false);
});

test("prepared-package receipts bind the derived aspect-compatible tier and both error values", () => {
  const context = buildAfcUi2aSharedComparisonContext({
    roomId: "room-a", originalSha256, originalWidth: 200, originalHeight: 1,
  });
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const derived = classifyAfcR3cImagePairCompatibility(
    { fingerprint: originalSha256, decodedWidth: 200, decodedHeight: 1, orientation: 1 },
    { fingerprint: emptySha256, decodedWidth: 197, decodedHeight: 1, orientation: 1 },
  );
  assert.equal(derived.tier, "aspect_compatible_rescaled");
  if (derived.relativeAspectErrorRaw === null || derived.relativeAspectError === null) return;
  const identity = buildAfcUi2aPackageIdentity({
    roomId: "room-a", originalSha256, emptySha256, manifestSha256, sharedContextDigest: digestAfcUi2aSharedContext(context.context),
    compatibility: {
      version: derived.version, tier: derived.tier, relativeAspectErrorRaw: derived.relativeAspectErrorRaw,
    },
  });
  assert.ok(identity);
  if (!identity) return;
  const exactIdentity = buildAfcUi2aPackageIdentity({
    roomId: "room-a", originalSha256, emptySha256, manifestSha256, sharedContextDigest: digestAfcUi2aSharedContext(context.context),
    compatibility: { version: derived.version, tier: "exact_grid_compatible", relativeAspectErrorRaw: 0 },
  });
  assert.ok(exactIdentity);
  if (exactIdentity) assert.notEqual(identity.packageId, exactIdentity.packageId);
  const receipt = {
    receiptContractVersion: "afc-ui2a-prepared-input-receipt/v1",
    preparationStage: "pair_manifest_prepared",
    packageId: identity.packageId,
    roomId: "room-a",
    originalPreparation: {
      preparationId: `afc-ui2a-original:room-a:${originalSha256}`,
      receiptFileName: `afc-ui2a-original-preparation.room-a.${originalSha256}.receipt.json`,
      receiptSha256: "a".repeat(64),
    },
    original: {
      fileName: `room-a.original.${originalSha256}.jpg`, sha256: originalSha256, byteCount: 486995,
      mimeType: "image/jpeg", decodedWidth: 200, decodedHeight: 1, orientation: 1,
    },
    emptyRoomAssist: {
      fileName: `room-a.empty-room.${emptySha256}.png`, sha256: emptySha256, byteCount: 1199149,
      mimeType: "image/png", decodedWidth: 197, decodedHeight: 1, orientation: 1,
      generatedFromOriginalSha256: originalSha256, generatorId: "vibode-empty-room-assist/stage1-empty-room/v1",
      requestedModelId: "NBP", resolvedModelStatus: "not_reported_by_compositor",
    },
    compatibility: {
      version: derived.version, tier: derived.tier,
      relativeAspectErrorRaw: derived.relativeAspectErrorRaw, relativeAspectError: derived.relativeAspectError,
    },
    sharedComparisonContext: context.context,
    sharedContextDigest: digestAfcUi2aSharedContext(context.context),
    manifest: { fileName: "afc-r3c-room-a.image-manifest.v1.json", sha256: manifestSha256, contractVersion: "afc-r3c-image-manifest/v1" },
    safety: {
      authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true,
      floorStateUnchanged: true, supportStateUnchanged: true, databaseWrites: false,
      productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false,
      geminiFloorProposalCall: false, afcR2Run: false, localResearchPackageWritten: true,
    },
  };
  assert.equal(parseAfcUi2aPreparedInputReceipt(receipt).ok, true);
  assert.equal(parseAfcUi2aPreparedInputReceipt({ ...receipt, compatibility: { ...receipt.compatibility, tier: "exact_grid_compatible" } }).ok, false);
  assert.equal(parseAfcUi2aPreparedInputReceipt({ ...receipt, compatibility: { ...receipt.compatibility, relativeAspectErrorRaw: 0.014 } }).ok, false);
  assert.equal(parseAfcUi2aPreparedInputReceipt({ ...receipt, compatibility: { ...receipt.compatibility, relativeAspectError: 0.0149 } }).ok, false);
  assert.equal(parseAfcUi2aPreparedInputReceipt({
    ...receipt,
    emptyRoomAssist: { ...receipt.emptyRoomAssist, decodedWidth: 196 },
  }).ok, false);
});
