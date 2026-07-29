import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { admitAfcUi2aExactGridPair, materializeAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package";
import { writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
import { parseAfcUi2aPreparedInputReceipt } from "./afc-ui2a-prepared-package-contract";
import { stableAfcUi2aReceiptBytes } from "./afc-ui2a-original-preparation-contract";

const original = {
  fileName: "room-a.original.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
  sha256: "a".repeat(64),
  byteCount: 1,
  mimeType: "image/jpeg" as const,
  decodedWidth: 100,
  decodedHeight: 50,
  orientation: 1 as const,
};
const emptyRoomAssist = {
  fileName: "room-a.empty-room.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
  sha256: "b".repeat(64),
  byteCount: 1,
  mimeType: "image/png" as const,
  decodedWidth: 100,
  decodedHeight: 50,
  orientation: 1 as const,
  generatedFromOriginalSha256: original.sha256,
  generatorId: "vibode-empty-room-assist/stage1-empty-room/v1",
  requestedModelId: "NBP" as const,
  resolvedModelId: null,
  resolvedModelStatus: "not_reported_by_compositor" as const,
};
const originalBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");
const emptyBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

async function materializationFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-package-"));
  const roomDirectory = path.join(root, "room-a");
  await mkdir(roomDirectory);
  const original = {
    fileName: `room-a.original.${sha(originalBytes)}.png`, sha256: sha(originalBytes), byteCount: originalBytes.byteLength,
    mimeType: "image/png" as const, decodedWidth: 1, decodedHeight: 1, orientation: 1 as const,
  };
  const emptyRoomAssist = {
    fileName: `room-a.empty-room.${sha(emptyBytes)}.png`, sha256: sha(emptyBytes), byteCount: emptyBytes.byteLength,
    mimeType: "image/png" as const, decodedWidth: 1, decodedHeight: 1, orientation: 1 as const,
    generatedFromOriginalSha256: original.sha256, generatorId: "vibode-empty-room-assist/stage1-empty-room/v1",
    requestedModelId: "NBP" as const, resolvedModelId: null, resolvedModelStatus: "not_reported_by_compositor" as const,
  };
  const originalPreparation = {
    preparationId: `afc-ui2a-original:room-a:${original.sha256}`,
    receiptFileName: `afc-ui2a-original-preparation.room-a.${original.sha256}.receipt.json`,
    receiptSha256: "c".repeat(64),
  };
  const originalReceipt = {
    receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1" as const,
    preparationStage: "original_captured" as const, preparationId: originalPreparation.preparationId, roomId: "room-a",
    source: {
      sanitizedImageUrl: "https://example.invalid/original.png", expectedQualifiedFingerprint: original.sha256,
      expectedDecodedWidth: 1, expectedDecodedHeight: 1,
    },
    original,
    safety: {
      authoritative: false as const, applied: false as const, persistedToScene: false as const,
      activeCameraUnchanged: true as const, floorStateUnchanged: true as const, supportStateUnchanged: true as const,
      databaseWrites: false as const, productionAssetWrites: false as const, productionTokenAccountingUsed: false as const,
      emptyRoomGenerationCall: false as const, geminiFloorProposalCall: false as const, localResearchCaptureWritten: true as const,
    },
  };
  await Promise.all([
    writeFile(path.join(roomDirectory, original.fileName), originalBytes),
    writeFile(path.join(roomDirectory, emptyRoomAssist.fileName), emptyBytes),
    writeFile(path.join(roomDirectory, originalPreparation.receiptFileName), stableAfcUi2aReceiptBytes(originalReceipt)),
  ]);
  return {
    root, roomDirectory, originalPreparation,
    originalEvidence: {
      roomId: "room-a", preparationId: originalPreparation.preparationId, receipt: originalReceipt,
      original, roomDirectory, originalFilePath: path.join(roomDirectory, original.fileName),
      sanitizedImageUrl: "https://example.invalid/original.png",
    },
    emptyEvidence: { canonicalReceiptFileName: "empty.receipt.json", emptyRoomAssist },
  };
}

function replaySuccess() {
  return async () => ({ ok: true as const, evidence: {} as never });
}

test("exact-grid admission uses the committed classifier and refuses rescaling", () => {
  const exact = admitAfcUi2aExactGridPair(original, emptyRoomAssist);
  assert.equal(exact.ok, true);
  if (exact.ok) assert.deepEqual(exact.compatibility, {
    version: "afc-r3c-image-pair-compatibility/v1", tier: "exact_grid_compatible",
    relativeAspectErrorRaw: 0, relativeAspectError: 0,
  });
  const rescaled = admitAfcUi2aExactGridPair(original, { ...emptyRoomAssist, decodedWidth: 200, decodedHeight: 100 });
  assert.equal(rescaled.ok, false);
  if (!rescaled.ok) assert.equal(rescaled.compatibility.tier, "aspect_compatible_rescaled");
});

test("materialization primitive acknowledgement gates before any evidence read", async () => {
  const result = await materializeAfcUi2aPreparedPackage({
    originalPreparation: {
      preparationId: `afc-ui2a-original:room-a:${original.sha256}`,
      receiptFileName: `afc-ui2a-original-preparation.room-a.${original.sha256}.receipt.json`,
      receiptSha256: "c".repeat(64),
    },
    originalEvidence: {
      roomId: "room-a", preparationId: `afc-ui2a-original:room-a:${original.sha256}`,
      receipt: {} as never, original, roomDirectory: "/not-read", originalFilePath: "/not-read",
      sanitizedImageUrl: "https://example.invalid/image.jpg",
    },
    emptyEvidence: { canonicalReceiptFileName: "not-read", emptyRoomAssist },
    executeCapture: new Boolean(true),
  });
  assert.deepEqual(result, {
    status: "failure", failureCode: "capture_not_authorized",
    message: "Confirm prepared-package materialization before accessing local evidence.",
  });
});

test("materialization writes the verified manifest before the exact prepared receipt then self-replays", async () => {
  const value = await materializationFixture();
  const writes: string[] = [];
  let replayCalls = 0;
  const writer: typeof writeAfcR3cImmutableCapture = async (args) => {
    writes.push(args.filename.includes("image-manifest") ? "manifest-write" : "receipt-write");
    return writeAfcR3cImmutableCapture(args);
  };
  try {
    const result = await materializeAfcUi2aPreparedPackage({
      originalPreparation: value.originalPreparation, originalEvidence: value.originalEvidence,
      emptyEvidence: value.emptyEvidence, executeCapture: true,
    }, {
      immutableWriter: writer,
      replayPackage: async (args) => {
        replayCalls += 1;
        assert.ok(writes.includes("manifest-write"));
        assert.ok(writes.includes("receipt-write"));
        assert.equal(args.roomLabel, "room-a");
        return { ok: true as const, evidence: {} as never };
      },
    });
    assert.equal(result.status, "package_materialized");
    if (result.status !== "package_materialized") return;
    assert.equal(result.manifest.disposition, "written");
    assert.deepEqual(writes, ["manifest-write", "receipt-write"]);
    assert.equal(replayCalls, 1);
    await access(path.join(value.roomDirectory, result.manifest.fileName));
    const receiptBytes = await readFile(path.join(value.roomDirectory, result.receipt.fileName));
    const receipt = parseAfcUi2aPreparedInputReceipt(JSON.parse(receiptBytes.toString("utf8")));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal("resolvedModelId" in receipt.receipt.emptyRoomAssist, false);
    assert.equal(result.packageId, receipt.receipt.packageId);
    assert.equal(result.receipt.sha256, sha(receiptBytes));
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.receipt), true);
    assert.equal(JSON.stringify(result).includes(value.roomDirectory), false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("duplicate materialization reuses artifacts and an orphan manifest is retryable", async () => {
  const value = await materializationFixture();
  try {
    const args = {
      originalPreparation: value.originalPreparation, originalEvidence: value.originalEvidence,
      emptyEvidence: value.emptyEvidence, executeCapture: true,
    };
    const first = await materializeAfcUi2aPreparedPackage(args, { replayPackage: replaySuccess() });
    const second = await materializeAfcUi2aPreparedPackage(args, { replayPackage: replaySuccess() });
    assert.equal(first.status, "package_materialized");
    assert.equal(second.status, "package_materialized");
    if (first.status !== "package_materialized" || second.status !== "package_materialized") return;
    assert.equal(second.manifest.disposition, "byte_identical");
    assert.equal(second.receipt.reused, true);
    assert.equal(second.packageId, first.packageId);
    assert.equal(second.manifest.sha256, first.manifest.sha256);
    assert.equal(second.receipt.sha256, first.receipt.sha256);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }

  const retry = await materializationFixture();
  try {
    const args = {
      originalPreparation: retry.originalPreparation, originalEvidence: retry.originalEvidence,
      emptyEvidence: retry.emptyEvidence, executeCapture: true,
    };
    const failed = await materializeAfcUi2aPreparedPackage(args, {
      immutableWriter: async (write) => write.filename.includes("prepared-input")
        ? { ok: false as const, reason: "injected" }
        : writeAfcR3cImmutableCapture(write),
      replayPackage: replaySuccess(),
    });
    assert.equal(failed.status, "failure");
    assert.equal(failed.status === "failure" && failed.failureCode, "package_receipt_capture_failed");
    await access(path.join(retry.roomDirectory, "afc-r3c-room-a.image-manifest.v1.json"));
    const recovered = await materializeAfcUi2aPreparedPackage(args, { replayPackage: replaySuccess() });
    assert.equal(recovered.status, "package_materialized");
    if (recovered.status !== "package_materialized") return;
    assert.equal(recovered.manifest.disposition, "byte_identical");
    assert.equal(recovered.receipt.reused, false);
  } finally {
    await rm(retry.root, { recursive: true, force: true });
  }
});
