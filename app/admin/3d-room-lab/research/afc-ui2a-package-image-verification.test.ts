import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reverifyAfcUi2aPackageImages } from "./afc-ui2a-package-image-verification";

const originalBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");
const emptyBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const roomDirectory = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-images-"));
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
  await Promise.all([
    writeFile(path.join(roomDirectory, original.fileName), originalBytes),
    writeFile(path.join(roomDirectory, emptyRoomAssist.fileName), emptyBytes),
  ]);
  return {
    roomDirectory, originalEvidence: {
      roomId: "room-a", preparationId: `afc-ui2a-original:room-a:${original.sha256}`,
      receipt: {} as never, original, roomDirectory, originalFilePath: path.join(roomDirectory, original.fileName),
      sanitizedImageUrl: "https://example.invalid/original.png",
    },
    emptyEvidence: { canonicalReceiptFileName: "empty.receipt.json", emptyRoomAssist },
  };
}

test("package image reverification admits only the verified immutable pair", async () => {
  const value = await fixture();
  try {
    const result = await reverifyAfcUi2aPackageImages(value.originalEvidence, value.emptyEvidence);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.images), true);
    assert.deepEqual(result.images.original, value.originalEvidence.original);
    assert.deepEqual(result.images.emptyRoomAssist, value.emptyEvidence.emptyRoomAssist);
  } finally {
    await rm(value.roomDirectory, { recursive: true, force: true });
  }
});

test("package image reverification rejects unsafe files and evidence mismatches without path leakage", async () => {
  const value = await fixture();
  const verify = () => reverifyAfcUi2aPackageImages(value.originalEvidence, value.emptyEvidence);
  try {
    await unlink(path.join(value.roomDirectory, value.originalEvidence.original.fileName));
    assert.deepEqual(await verify(), { ok: false, failureCode: "original_image_missing" });
    await writeFile(path.join(value.roomDirectory, value.originalEvidence.original.fileName), originalBytes);
    await unlink(path.join(value.roomDirectory, value.emptyEvidence.emptyRoomAssist.fileName));
    assert.deepEqual(await verify(), { ok: false, failureCode: "empty_image_missing" });
    await writeFile(path.join(value.roomDirectory, value.emptyEvidence.emptyRoomAssist.fileName), emptyBytes);
    await unlink(path.join(value.roomDirectory, value.originalEvidence.original.fileName));
    await symlink(path.join(value.roomDirectory, value.emptyEvidence.emptyRoomAssist.fileName), path.join(value.roomDirectory, value.originalEvidence.original.fileName));
    assert.deepEqual(await verify(), { ok: false, failureCode: "original_image_missing" });
    await unlink(path.join(value.roomDirectory, value.originalEvidence.original.fileName));
    await mkdir(path.join(value.roomDirectory, value.originalEvidence.original.fileName));
    assert.deepEqual(await verify(), { ok: false, failureCode: "original_image_missing" });
    await rm(path.join(value.roomDirectory, value.originalEvidence.original.fileName), { recursive: true });
    await writeFile(path.join(value.roomDirectory, value.originalEvidence.original.fileName), originalBytes);
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      { ...value.originalEvidence, original: { ...value.originalEvidence.original, fileName: "nested/original.png" } },
      value.emptyEvidence,
    ), { ok: false, failureCode: "original_image_missing" });
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      { ...value.originalEvidence, original: { ...value.originalEvidence.original, sha256: "a".repeat(64) } },
      value.emptyEvidence,
    ), { ok: false, failureCode: "original_image_mismatch" });
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      { ...value.originalEvidence, original: { ...value.originalEvidence.original, byteCount: 1 } },
      value.emptyEvidence,
    ), { ok: false, failureCode: "original_image_mismatch" });
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      { ...value.originalEvidence, original: { ...value.originalEvidence.original, mimeType: "image/jpeg" } },
      value.emptyEvidence,
    ), { ok: false, failureCode: "original_image_mismatch" });
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      { ...value.originalEvidence, original: { ...value.originalEvidence.original, decodedWidth: 2 } },
      value.emptyEvidence,
    ), { ok: false, failureCode: "original_image_mismatch" });
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      { ...value.originalEvidence, original: { ...value.originalEvidence.original, orientation: 6 as never } },
      value.emptyEvidence,
    ), { ok: false, failureCode: "original_image_mismatch" });
    assert.deepEqual(await reverifyAfcUi2aPackageImages(
      value.originalEvidence,
      { ...value.emptyEvidence, emptyRoomAssist: { ...value.emptyEvidence.emptyRoomAssist, generatedFromOriginalSha256: "a".repeat(64) } },
    ), { ok: false, failureCode: "empty_lineage_mismatch" });
  } finally {
    await rm(value.roomDirectory, { recursive: true, force: true });
  }
});

test("package image reverification rejects decoded-orientation and provenance tampering", async () => {
  const value = await fixture();
  try {
    const orientation = await reverifyAfcUi2aPackageImages(value.originalEvidence, value.emptyEvidence, {
      inspectMetadata: async () => ({ ok: true as const, width: 1, height: 1, orientation: 6 }),
    });
    assert.deepEqual(orientation, { ok: false, failureCode: "original_image_mismatch" });
    for (const emptyRoomAssist of [
      { ...value.emptyEvidence.emptyRoomAssist, generatorId: "other" },
      { ...value.emptyEvidence.emptyRoomAssist, requestedModelId: "other" as never },
      { ...value.emptyEvidence.emptyRoomAssist, resolvedModelId: "model" as never },
      { ...value.emptyEvidence.emptyRoomAssist, resolvedModelStatus: "other" as never },
      { ...value.emptyEvidence.emptyRoomAssist, decodedHeight: 2 },
    ]) {
      const result = await reverifyAfcUi2aPackageImages(value.originalEvidence, {
        ...value.emptyEvidence, emptyRoomAssist,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.failureCode, /empty_(image_mismatch|lineage_mismatch)/);
    }
  } finally {
    await rm(value.roomDirectory, { recursive: true, force: true });
  }
});
