import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAfcUi2aRoomLabel,
  originalFilename,
  originalPreparationId,
  parseAfcUi2aOriginalPreparationReceipt,
  parseAfcUi2aPrepareOriginalRequest,
  stableAfcUi2aReceiptBytes,
} from "./afc-ui2a-original-preparation-contract";

const digest = "a".repeat(64);
const request = () => ({
  contractVersion: "afc-ui2a-prepare-original-request/v1",
  currentImage: { contractVersion: "afc-ui2a-current-image/v1", imageUrl: "https://images.example/room.jpg", expectedFingerprint: digest, expectedWidth: 10, expectedHeight: 20 },
  roomLabel: "Room A",
  executeCapture: true,
});
const receipt = () => ({
  receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1",
  preparationStage: "original_captured",
  preparationId: originalPreparationId("room-a", digest),
  roomId: "room-a",
  source: { sanitizedImageUrl: "https://images.example/room.jpg", expectedQualifiedFingerprint: digest, expectedDecodedWidth: 10, expectedDecodedHeight: 20 },
  original: { fileName: originalFilename("room-a", digest, "image/jpeg"), sha256: digest, byteCount: 30, mimeType: "image/jpeg", decodedWidth: 10, decodedHeight: 20, orientation: 1 },
  safety: { authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true, supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false, geminiFloorProposalCall: false, localResearchCaptureWritten: true },
} as const);

test("UI2A request is closed and acknowledgement stays unknown", () => {
  assert.equal(parseAfcUi2aPrepareOriginalRequest(request()).ok, true);
  assert.equal(parseAfcUi2aPrepareOriginalRequest({ ...request(), unexpected: true }).ok, false);
  assert.equal(parseAfcUi2aPrepareOriginalRequest({ ...request(), currentImage: { ...request().currentImage, expectedFingerprint: "not-a-hash" } }).ok, false);
  assert.equal(parseAfcUi2aPrepareOriginalRequest({ ...request(), roomLabel: "../room-a" }).ok, false);
  for (const executeCapture of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true)]) {
    const parsed = parseAfcUi2aPrepareOriginalRequest({ ...request(), executeCapture });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.notEqual(parsed.request.executeCapture, true);
  }
});

test("UI2A room labels normalize strictly", () => {
  assert.equal(normalizeAfcUi2aRoomLabel("Room A"), "room-a");
  assert.equal(normalizeAfcUi2aRoomLabel("room_a"), "room-a");
  assert.equal(normalizeAfcUi2aRoomLabel("Room  12"), "room-12");
  for (const invalid of ["../room-a", "/absolute", "room/a", ".room-a", "", "a".repeat(65), "x\0y"]) assert.equal(normalizeAfcUi2aRoomLabel(invalid), null);
});

test("UI2A receipt is strict and stable", () => {
  const valid = receipt();
  const parsed = parseAfcUi2aOriginalPreparationReceipt(valid);
  assert.equal(parsed.ok, true);
  assert.deepEqual(stableAfcUi2aReceiptBytes(valid), stableAfcUi2aReceiptBytes(receipt()));
  assert.equal(parseAfcUi2aOriginalPreparationReceipt({ ...valid, extra: true }).ok, false);
  assert.equal(parseAfcUi2aOriginalPreparationReceipt({ ...valid, source: { ...valid.source, sanitizedImageUrl: "https://images.example/room.jpg?secret=1" } }).ok, false);
  assert.equal(parseAfcUi2aOriginalPreparationReceipt({ ...valid, original: { ...valid.original, fileName: "wrong.jpg" } }).ok, false);
  assert.equal(parseAfcUi2aOriginalPreparationReceipt({ ...valid, safety: { ...valid.safety, geminiFloorProposalCall: true } }).ok, false);
});
