import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAfcUi2aImageManifest } from "./afc-ui2a-manifest-writer";
import { materializeAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { buildAfcUi2aSharedComparisonContext } from "./afc-ui2a-shared-context";

const originalBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");
const emptyBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture(semanticManifest = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-replay-"));
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
  const selector = {
    preparationId: `afc-ui2a-original:room-a:${original.sha256}`,
    receiptFileName: `afc-ui2a-original-preparation.room-a.${original.sha256}.receipt.json`,
    receiptSha256: "c".repeat(64),
  };
  const originalEvidence = {
    roomId: "room-a", preparationId: selector.preparationId, receipt: {} as never, original,
    roomDirectory, originalFilePath: path.join(roomDirectory, original.fileName),
    sanitizedImageUrl: "https://example.invalid/original.png",
  };
  const emptyEvidence = { canonicalReceiptFileName: "empty.receipt.json", emptyRoomAssist };
  await Promise.all([
    writeFile(path.join(roomDirectory, original.fileName), originalBytes),
    writeFile(path.join(roomDirectory, emptyRoomAssist.fileName), emptyBytes),
    writeFile(path.join(roomDirectory, selector.receiptFileName), "{}"),
  ]);
  if (semanticManifest) {
    const context = buildAfcUi2aSharedComparisonContext({
      roomId: "room-a", originalSha256: original.sha256, originalWidth: 1, originalHeight: 1,
    });
    assert.equal(context.ok, true);
    if (!context.ok) throw new Error("context");
    const manifest = buildAfcUi2aImageManifest({
      roomId: "room-a", images: { original, emptyRoomAssist }, sharedComparisonContext: context.context,
    });
    assert.equal(manifest.ok, true);
    if (!manifest.ok) throw new Error("manifest");
    await writeFile(path.join(roomDirectory, "afc-r3c-room-a.image-manifest.v1.json"), JSON.stringify(manifest.manifest));
  }
  return { root, roomDirectory, selector, originalEvidence, emptyEvidence };
}

async function materialize(value: Awaited<ReturnType<typeof fixture>>) {
  return materializeAfcUi2aPreparedPackage({
    originalPreparation: value.selector, originalEvidence: value.originalEvidence,
    emptyEvidence: value.emptyEvidence, executeCapture: true,
  }, { replayPackage: async () => ({ ok: true as const, evidence: {} as never }) });
}

test("prepared-package replay rejects malformed selectors before fixed-root access", async () => {
  let resolverCalls = 0;
  const result = await replayAfcUi2aPreparedPackage({
    roomLabel: "room-a",
    packageId: "not-a-package",
    receiptFileName: "anything",
    receiptSha256: "a".repeat(64),
  }, {
    resolveFixedInputsRoot: async () => {
      resolverCalls += 1;
      return { ok: false, code: "fixed_inputs_root_unavailable" };
    },
  });
  assert.deepEqual(result, { ok: false, failureCode: "invalid_input" });
  assert.equal(resolverCalls, 0);
});

test("prepared-package replay independently verifies a complete materialized package", async () => {
  const value = await fixture();
  try {
    const prepared = await materialize(value);
    assert.equal(prepared.status, "package_materialized");
    if (prepared.status !== "package_materialized") return;
    let pinnedSelector: unknown;
    const replay = await replayAfcUi2aPreparedPackage({
      roomLabel: "room-a", packageId: prepared.packageId,
      receiptFileName: prepared.receipt.fileName, receiptSha256: prepared.receipt.sha256,
    }, {
      resolveFixedInputsRoot: async () => ({ ok: true as const, root: value.root }),
      replayOriginal: async ({ selector }) => {
        pinnedSelector = selector;
        return { ok: true as const, evidence: { ...value.originalEvidence, roomDirectory: await realpath(value.roomDirectory) } };
      },
    });
    assert.ok(replay.ok, replay.ok ? undefined : replay.failureCode);
    if (!replay.ok) return;
    assert.deepEqual(pinnedSelector, value.selector);
    assert.equal(Object.isFrozen(replay.evidence), true);
    assert.equal(JSON.stringify(replay.evidence).includes(value.roomDirectory), true);
    const receiptBytes = await readFile(path.join(value.roomDirectory, prepared.receipt.fileName));
    assert.equal(sha(receiptBytes), prepared.receipt.sha256);
    const summary = {
      packageId: replay.evidence.packageId,
      roomId: replay.evidence.roomId,
      receiptFileName: prepared.receipt.fileName,
      manifestFileName: replay.evidence.receipt.manifest.fileName,
    };
    assert.equal(JSON.stringify(summary).includes(value.roomDirectory), false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("prepared-package replay accepts an immutable semantically adopted manifest", async () => {
  const value = await fixture(true);
  try {
    const manifestPath = path.join(value.roomDirectory, "afc-r3c-room-a.image-manifest.v1.json");
    const before = await readFile(manifestPath);
    const prepared = await materialize(value);
    assert.equal(prepared.status, "package_materialized");
    if (prepared.status !== "package_materialized") return;
    assert.equal(prepared.manifest.disposition, "semantically_adopted");
    const receipt = JSON.parse((await readFile(path.join(value.roomDirectory, prepared.receipt.fileName))).toString("utf8"));
    assert.equal(receipt.manifest.sha256, sha(before));
    const replay = await replayAfcUi2aPreparedPackage({
      roomLabel: "room-a", packageId: prepared.packageId,
      receiptFileName: prepared.receipt.fileName, receiptSha256: prepared.receipt.sha256,
    }, {
      resolveFixedInputsRoot: async () => ({ ok: true as const, root: value.root }),
      replayOriginal: async () => ({ ok: true as const, evidence: { ...value.originalEvidence, roomDirectory: await realpath(value.roomDirectory) } }),
    });
    assert.ok(replay.ok, replay.ok ? undefined : replay.failureCode);
    assert.deepEqual(await readFile(manifestPath), before);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
