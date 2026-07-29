import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { discoverAfcUi2aDurableEmptyEvidence, parseAfcUi2aFixedEmptySuccessReceipt } from "./afc-ui2a-empty-evidence-replay";
import type { AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";

const sha = "a".repeat(64);
function receipt() {
  return {
    receiptContractVersion: "afc-r3c-fixed-empty-room-capture-receipt/v1",
    roomId: "room-a",
    requestId: "room-a-ui2a-empty-request",
    createdAt: "2026-07-28T00:00:00.000Z",
    captureSource: "cache_hit",
    original: {
      sourceFilePath: "/untrusted/original.png", capturedFilePath: "/untrusted/original.png", sha256: sha,
      byteCount: 10, decodedWidth: 2, decodedHeight: 2, orientation: 1, mimeType: "image/png",
    },
    emptyRoomAssist: {
      capturedFilePath: `/untrusted/room-a.empty-room.${"b".repeat(64)}.png`, sha256: "b".repeat(64),
      byteCount: 10, decodedWidth: 2, decodedHeight: 2, orientation: 1, mimeType: "image/png", generatedFromOriginalSha256: sha,
    },
    generation: {
      cacheStatus: "hit", generatorId: "vibode-empty-room-assist/stage1-empty-room/v1", requestedModelId: "NBP",
      resolvedModelId: null, resolvedModelStatus: "not_reported_by_compositor", appliedAspectRatio: "1:1",
      imageTransport: "data_url", generatedAt: "2026-07-28T00:00:00.000Z",
    },
    safety: {
      applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true, sceneStateUnchanged: true,
      databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false,
      geminiFloorProposalCall: false, localResearchCaptureWritten: true,
    },
  };
}

test("strict success receipt parser accepts only the committed success shape", () => {
  assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(receipt()).ok, true);
  const valid = receipt();
  const nullAspectRatio = { ...valid, generation: { ...valid.generation, appliedAspectRatio: null } };
  assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(nullAspectRatio).ok, true);
  const withUnknown = { ...receipt(), ignored: true };
  assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(withUnknown).ok, false);
  const failure = { ...receipt(), receiptStatus: "generation_failure", failureCode: "empty_generation_failed" };
  assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(failure).ok, false);
  const unsafe = receipt();
  unsafe.requestId = "../not-safe";
  assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(unsafe).ok, false);
});

test("legacy source input basename is provenance while captured Original basename remains required", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-legacy-empty-"));
  try {
    const roomDirectory = path.join(root, "room-a");
    await mkdir(roomDirectory);
    const verifiedRoomDirectory = await realpath(roomDirectory);
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");
    const originalSha256 = computeCalibrationImageFingerprint(pixel);
    const emptySha256 = computeCalibrationImageFingerprint(pixel);
    const originalFileName = `room-a.original.${originalSha256}.png`;
    const emptyFileName = `room-a.empty-room.${emptySha256}.png`;
    await Promise.all([
      writeFile(path.join(roomDirectory, originalFileName), pixel),
      writeFile(path.join(roomDirectory, emptyFileName), pixel),
    ]);
    const receiptFileName = "afc-r3c-fixed-empty-room.room-a-legacy.receipt.json";
    const receiptFor = (capturedOriginalFileName: string) => ({
      receiptContractVersion: "afc-r3c-fixed-empty-room-capture-receipt/v1",
      roomId: "room-a",
      requestId: "room-a-legacy",
      createdAt: "2026-07-28T00:00:00.000Z",
      captureSource: "generated",
      original: {
        sourceFilePath: "/legacy/operator-input/centered-rectangular-room.jpg",
        capturedFilePath: `/legacy/fixed-inputs/room-a/${capturedOriginalFileName}`,
        sha256: originalSha256,
        byteCount: pixel.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1,
        mimeType: "image/png",
      },
      emptyRoomAssist: {
        capturedFilePath: `/legacy/fixed-inputs/room-a/${emptyFileName}`,
        sha256: emptySha256,
        byteCount: pixel.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1,
        mimeType: "image/png",
        generatedFromOriginalSha256: originalSha256,
      },
      generation: {
        cacheStatus: "miss",
        generatorId: "vibode-empty-room-assist/stage1-empty-room/v1",
        requestedModelId: "NBP",
        resolvedModelId: null,
        resolvedModelStatus: "not_reported_by_compositor",
        appliedAspectRatio: null,
        imageTransport: "data_url",
        generatedAt: "2026-07-28T00:00:00.000Z",
      },
      safety: {
        applied: false,
        authoritative: false,
        persisted: false,
        activeCameraUnchanged: true,
        sceneStateUnchanged: true,
        databaseWrites: false,
        productionAssetWrites: false,
        productionTokenAccountingUsed: false,
        emptyRoomGenerationCall: true,
        geminiFloorProposalCall: false,
        localResearchCaptureWritten: true,
      },
    });
    const original = {
      roomId: "room-a",
      preparationId: `afc-ui2a-original:room-a:${originalSha256}`,
      receipt: {},
      original: {
        fileName: originalFileName,
        sha256: originalSha256,
        byteCount: pixel.byteLength,
        mimeType: "image/png",
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1,
      },
      roomDirectory: verifiedRoomDirectory,
      originalFilePath: path.join(roomDirectory, originalFileName),
      sanitizedImageUrl: "https://images.example.test/room-a.png",
    } as unknown as AfcUi2aVerifiedOriginalEvidence;
    const validReceipt = receiptFor(originalFileName);
    await writeFile(path.join(roomDirectory, receiptFileName), JSON.stringify(validReceipt));
    assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(validReceipt).ok, true);
    assert.equal(parseAfcUi2aFixedEmptySuccessReceipt(JSON.parse((await readFile(path.join(roomDirectory, receiptFileName))).toString("utf8"))).ok, true);
    const before = await readdir(roomDirectory);
    assert.equal(before.includes(receiptFileName), true);
    assert.equal(/^afc-r3c-fixed-empty-room\.[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.receipt\.json$/.test(receiptFileName), true);
    const selected = await discoverAfcUi2aDurableEmptyEvidence(original);
    assert.equal(selected.status, "selected");
    if (selected.status === "selected") {
      assert.equal(selected.evidence.emptyRoomAssist.sha256, emptySha256);
      assert.equal(JSON.stringify(selected.evidence).includes("/legacy/"), false);
      assert.equal(JSON.stringify(selected.evidence).includes(roomDirectory), false);
    }
    assert.deepEqual(await readdir(roomDirectory), before);

    await writeFile(path.join(roomDirectory, receiptFileName), JSON.stringify(receiptFor("different-original.png")));
    const rejected = await discoverAfcUi2aDurableEmptyEvidence(original);
    assert.deepEqual(rejected, { status: "invalid", failureCode: "empty_lineage_mismatch" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
