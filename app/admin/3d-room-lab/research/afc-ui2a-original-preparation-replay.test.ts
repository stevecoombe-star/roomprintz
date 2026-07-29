import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { originalFilename, originalPreparationId, originalPreparationReceiptFilename, stableAfcUi2aReceiptBytes } from "./afc-ui2a-original-preparation-contract";
import { replayAfcUi2aOriginalPreparation } from "./afc-ui2a-original-preparation-replay";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");

test("Original replay rereads the selected strict receipt and immutable bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-replay-"));
  try {
    const room = path.join(root, "room-a");
    await mkdir(room);
    const imageSha = computeCalibrationImageFingerprint(png);
    const fileName = originalFilename("room-a", imageSha, "image/png");
    await writeFile(path.join(room, fileName), png);
    const receipt = {
      receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1" as const,
      preparationStage: "original_captured" as const,
      preparationId: originalPreparationId("room-a", imageSha),
      roomId: "room-a",
      source: { sanitizedImageUrl: "https://images.example.test/room.png", expectedQualifiedFingerprint: imageSha, expectedDecodedWidth: 1, expectedDecodedHeight: 1 },
      original: { fileName, sha256: imageSha, byteCount: png.byteLength, mimeType: "image/png" as const, decodedWidth: 1, decodedHeight: 1, orientation: 1 as const },
      safety: { authoritative: false as const, applied: false as const, persistedToScene: false as const, activeCameraUnchanged: true as const, floorStateUnchanged: true as const, supportStateUnchanged: true as const, databaseWrites: false as const, productionAssetWrites: false as const, productionTokenAccountingUsed: false as const, emptyRoomGenerationCall: false as const, geminiFloorProposalCall: false as const, localResearchCaptureWritten: true as const },
    };
    const receiptBytes = stableAfcUi2aReceiptBytes(receipt);
    const receiptFileName = originalPreparationReceiptFilename("room-a", imageSha);
    await writeFile(path.join(room, receiptFileName), receiptBytes);
    const result = await replayAfcUi2aOriginalPreparation({
      roomLabel: "Room A",
      selector: { preparationId: receipt.preparationId, receiptFileName, receiptSha256: computeCalibrationImageFingerprint(receiptBytes) },
      currentExpectedFingerprint: imageSha,
    }, { resolveFixedInputsRoot: async () => ({ ok: true as const, root }) });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(Object.isFrozen(result.evidence), true);
      assert.equal(result.evidence.original.sha256, imageSha);
    }
    const changed = await replayAfcUi2aOriginalPreparation({
      roomLabel: "Room A",
      selector: { preparationId: receipt.preparationId, receiptFileName, receiptSha256: "0".repeat(64) },
    }, { resolveFixedInputsRoot: async () => ({ ok: true as const, root }) });
    assert.deepEqual(changed, { ok: false, failureCode: "original_receipt_hash_mismatch", message: "The selected Original-preparation receipt changed after selection." });
    assert.equal(JSON.stringify(changed).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
