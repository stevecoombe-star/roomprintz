import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverAfcUi2aPreparedPackages } from "./afc-ui2a-package-inventory";
import { stableAfcUi2aReceiptBytes } from "./afc-ui2a-original-preparation-contract";
import { materializeAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";

const originalBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");
const emptyBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-inventory-"));
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
  const provisionalReceipt = {
    receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1" as const, preparationStage: "original_captured" as const,
    preparationId: `afc-ui2a-original:room-a:${original.sha256}`, roomId: "room-a",
    source: { sanitizedImageUrl: "https://example.invalid/original.png", expectedQualifiedFingerprint: original.sha256, expectedDecodedWidth: 1, expectedDecodedHeight: 1 },
    original,
    safety: {
      authoritative: false as const, applied: false as const, persistedToScene: false as const, activeCameraUnchanged: true as const,
      floorStateUnchanged: true as const, supportStateUnchanged: true as const, databaseWrites: false as const, productionAssetWrites: false as const,
      productionTokenAccountingUsed: false as const, emptyRoomGenerationCall: false as const, geminiFloorProposalCall: false as const, localResearchCaptureWritten: true as const,
    },
  };
  const receiptBytes = stableAfcUi2aReceiptBytes(provisionalReceipt);
  const originalPreparation = {
    preparationId: provisionalReceipt.preparationId,
    receiptFileName: `afc-ui2a-original-preparation.room-a.${original.sha256}.receipt.json`,
    receiptSha256: sha(receiptBytes),
  };
  const originalEvidence = {
    roomId: "room-a", preparationId: originalPreparation.preparationId, receipt: provisionalReceipt, original,
    roomDirectory, originalFilePath: path.join(roomDirectory, original.fileName), sanitizedImageUrl: "https://example.invalid/original.png",
  };
  await Promise.all([
    writeFile(path.join(roomDirectory, original.fileName), originalBytes),
    writeFile(path.join(roomDirectory, emptyRoomAssist.fileName), emptyBytes),
    writeFile(path.join(roomDirectory, originalPreparation.receiptFileName), receiptBytes),
  ]);
  const replay = async (args: Parameters<typeof replayAfcUi2aPreparedPackage>[0]) => replayAfcUi2aPreparedPackage(args, {
    resolveFixedInputsRoot: async () => ({ ok: true as const, root }),
    replayOriginal: async () => ({ ok: true as const, evidence: { ...originalEvidence, roomDirectory: await realpath(roomDirectory) } }),
  });
  return {
    root, roomDirectory, original, emptyRoomAssist, originalPreparation, originalEvidence,
    replay,
    materialize: () => materializeAfcUi2aPreparedPackage({
      originalPreparation, originalEvidence, emptyEvidence: { canonicalReceiptFileName: "afc-r3c-fixed-empty-room.fixture.receipt.json", emptyRoomAssist }, executeCapture: true,
    }, { replayPackage: replay }),
    inventory: () => discoverAfcUi2aPreparedPackages("room-a", {
      resolveFixedInputsRoot: async () => ({ ok: true as const, root }),
      replayPackage: replay,
    }),
  };
}

test("package inventory rejects invalid labels before fixed-root access", async () => {
  let called = 0;
  const result = await discoverAfcUi2aPreparedPackages("../room-a", {
    resolveFixedInputsRoot: async () => { called++; return { ok: true, root: "/tmp" }; },
  });
  assert.deepEqual(result, { status: "failure", failureCode: "invalid_input", message: "The room label is invalid." });
  assert.equal(called, 0);
});
test("package inventory safely reports an unavailable fixed root", async () => {
  const result = await discoverAfcUi2aPreparedPackages("room-a", {
    resolveFixedInputsRoot: async () => ({ ok: false, code: "fixed_inputs_root_unavailable" }),
  });
  assert.deepEqual(result, { status: "failure", failureCode: "inventory_unavailable", message: "Prepared-package inventory is unavailable." });
});

test("real materialization, inventory, and strict replay remain path-free and stable", async () => {
  const value = await fixture();
  try {
    const materialized = await value.materialize();
    assert.equal(materialized.status, "package_materialized");
    if (materialized.status !== "package_materialized") return;
    const receiptPath = path.join(value.roomDirectory, materialized.receipt.fileName);
    const actualReceiptSha = sha(await readFile(receiptPath));
    const before = await readdir(value.roomDirectory);
    const first = await value.inventory();
    const second = await value.inventory();
    assert.equal(first.status, "inventory");
    assert.equal(second.status, "inventory");
    if (first.status !== "inventory" || second.status !== "inventory") return;
    assert.deepEqual(second, first);
    assert.equal(first.packages.length, 1);
    const entry = first.packages[0];
    assert.equal(entry.packageId, materialized.packageId);
    assert.equal(entry.manifest.sha256, materialized.manifest.sha256);
    assert.equal(entry.receipt.sha256, actualReceiptSha);
    assert.deepEqual(entry.original, materialized.original);
    assert.equal(entry.emptyRoomAssist.sha256, materialized.emptyRoomAssist.sha256);
    assert.equal(entry.compatibility.tier, "exact_grid_compatible");
    assert.equal(entry.sharedContextDigest, materialized.sharedContextDigest);
    assert.deepEqual(entry.safety, materialized.safety);
    assert.deepEqual(Object.keys(entry.original).sort(), ["byteCount", "decodedHeight", "decodedWidth", "fileName", "mimeType", "orientation", "sha256"]);
    assert.deepEqual(Object.keys(entry.compatibility).sort(), ["relativeAspectError", "relativeAspectErrorRaw", "tier", "version"]);
    assert.deepEqual(Object.keys(entry.safety).sort(), [
      "activeCameraUnchanged", "afcR2Run", "applied", "authoritative", "databaseWrites", "emptyRoomGenerationCall",
      "floorStateUnchanged", "geminiFloorProposalCall", "localResearchPackageWritten", "persistedToScene",
      "productionAssetWrites", "productionTokenAccountingUsed", "supportStateUnchanged",
    ]);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.packages), true);
    assert.equal(Object.isFrozen(entry), true);
    const serialized = JSON.stringify(first);
    for (const forbidden of [value.root, value.roomDirectory, "resolvedModelId", "originalFilePath", "manifestFilePath"]) assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.deepEqual(await readdir(value.roomDirectory), before);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("inventory isolates malformed, unsafe, and replay-invalid candidates while retaining the valid package", async () => {
  const value = await fixture();
  try {
    const materialized = await value.materialize();
    assert.equal(materialized.status, "package_materialized");
    if (materialized.status !== "package_materialized") return;
    const invalidDigest = "d".repeat(64);
    const malformed = `afc-ui2a-prepared-input.room-a.${invalidDigest}.receipt.json`;
    const unknown = `afc-ui2a-prepared-input.room-a.${"e".repeat(64)}.receipt.json`;
    const directory = `afc-ui2a-prepared-input.room-a.${"f".repeat(64)}.receipt.json`;
    const linked = `afc-ui2a-prepared-input.room-a.${"1".repeat(64)}.receipt.json`;
    await writeFile(path.join(value.roomDirectory, malformed), "{");
    await writeFile(path.join(value.roomDirectory, unknown), JSON.stringify({ unexpected: true }));
    await mkdir(path.join(value.roomDirectory, directory));
    await symlink(path.join(value.roomDirectory, malformed), path.join(value.roomDirectory, linked));
    await writeFile(path.join(value.roomDirectory, "unrelated.txt"), "ignored");
    const result = await value.inventory();
    assert.equal(result.status, "inventory");
    if (result.status !== "inventory") return;
    assert.equal(result.packages.length, 1);
    assert.equal(result.invalidCandidateCount, 4);
    assert.equal(JSON.stringify(result).includes(malformed), false);
    assert.equal(JSON.stringify(result).includes("path"), false);
    assert.equal((await lstat(path.join(value.roomDirectory, linked))).isSymbolicLink(), true);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
