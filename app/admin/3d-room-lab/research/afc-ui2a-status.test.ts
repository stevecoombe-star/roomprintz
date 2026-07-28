import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { originalFilename, originalPreparationId, originalPreparationReceiptFilename, parseAfcUi2aOriginalPreparationReceipt } from "./afc-ui2a-original-preparation-contract";
import { discoverAfcUi2aOriginalPreparations } from "./afc-ui2a-status";

const digest = "a".repeat(64);
function receipt(roomId: string) {
  return {
    receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1", preparationStage: "original_captured",
    preparationId: originalPreparationId(roomId, digest), roomId,
    source: { sanitizedImageUrl: "https://images.example/room.jpg", expectedQualifiedFingerprint: digest, expectedDecodedWidth: 1, expectedDecodedHeight: 1 },
    original: { fileName: originalFilename(roomId, digest, "image/png"), sha256: digest, byteCount: 3, mimeType: "image/png", decodedWidth: 1, decodedHeight: 1, orientation: 1 },
    safety: { authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true, supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false, geminiFloorProposalCall: false, localResearchCaptureWritten: true },
  };
}
test("UI2A status discovers only strict regular receipt files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-status-"));
  try {
    const room = path.join(root, "room-a");
    await mkdir(room);
    const name = originalPreparationReceiptFilename("room-a", digest);
    const contents = Buffer.from(JSON.stringify(receipt("room-a"), null, 2));
    assert.equal(parseAfcUi2aOriginalPreparationReceipt(receipt("room-a")).ok, true);
    await writeFile(path.join(room, name), contents);
    await writeFile(path.join(room, "malformed.receipt.json"), "{}");
    await symlink(path.join(room, name), path.join(room, originalPreparationReceiptFilename("room-a", "b".repeat(64))));
    const summaries = await discoverAfcUi2aOriginalPreparations({
      expectedFingerprint: digest,
      resolveFixedInputsRoot: async () => ({ ok: true, root }),
    });
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].originalFileName, originalFilename("room-a", digest, "image/png"));
    assert.equal(summaries[0].receiptSha256, createHash("sha256").update(contents).digest("hex"));
    assert.equal(summaries[0].matchesCurrentFingerprint, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
