import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
import { prepareAfcUi2aOriginal } from "./afc-ui2a-prepare-original";

const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const digest = createHash("sha256").update(bytes).digest("hex");
function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "afc-ui2a-prepare-original-request/v1",
    currentImage: { contractVersion: "afc-ui2a-current-image/v1", imageUrl: "https://images.example/room.jpg?token=private", expectedFingerprint: digest, expectedWidth: 12, expectedHeight: 8 },
    roomLabel: "Room A",
    executeCapture: true,
    ...overrides,
  };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-"));
  return {
    root,
    deps: {
      fetchImage: async () => ({ ok: true as const, base64: bytes.toString("base64"), buffer: bytes, mime: "image/png", byteCount: bytes.byteLength, host: "images.example" }),
      inspectMetadata: async () => ({ ok: true as const, width: 12, height: 8, orientation: 1 }),
      resolveFixedInputsRoot: async () => ({ ok: true as const, root }),
      immutableWriter: writeAfcR3cImmutableCapture,
    },
  };
}

test("UI2A captures only a byte-verified immutable Original then receipt", async () => {
  const item = await fixture();
  try {
    const first = await prepareAfcUi2aOriginal(request(), item.deps);
    assert.equal(first.status, "prepared");
    if (first.status !== "prepared") return;
    assert.equal(first.roomId, "room-a");
    assert.equal(first.original.fileName, `room-a.original.${digest}.png`);
    assert.equal(first.receipt.fileName, `afc-ui2a-original-preparation.room-a.${digest}.receipt.json`);
    assert.equal(first.reused.original, false);
    assert.equal((await readFile(path.join(item.root, "room-a", first.original.fileName))).equals(bytes), true);
    const second = await prepareAfcUi2aOriginal(request(), item.deps);
    assert.equal(second.status, "prepared");
    if (second.status === "prepared") assert.deepEqual(second.reused, { original: true, receipt: true });
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("UI2A fails closed before any capture for changed identity or acknowledgement", async () => {
  const item = await fixture();
  try {
    const mismatch = await prepareAfcUi2aOriginal(request({ currentImage: { ...request().currentImage, expectedFingerprint: "b".repeat(64) } }), item.deps);
    assert.deepEqual(mismatch.status === "failure" && mismatch.failureCode, "image_fingerprint_mismatch");
    const denied = await prepareAfcUi2aOriginal(request({ executeCapture: "true" }), item.deps);
    assert.deepEqual(denied.status === "failure" && denied.failureCode, "capture_not_authorized");
    assert.equal((await readdir(item.root)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("UI2A rejects dimensions, orientation, MIME, and root failures", async () => {
  const item = await fixture();
  try {
    const width = await prepareAfcUi2aOriginal(request(), { ...item.deps, inspectMetadata: async () => ({ ok: true as const, width: 13, height: 8, orientation: 1 }) });
    assert.equal(width.status === "failure" && width.failureCode, "image_dimension_mismatch");
    const orientation = await prepareAfcUi2aOriginal(request(), { ...item.deps, inspectMetadata: async () => ({ ok: true as const, width: 12, height: 8, orientation: 6 }) });
    assert.equal(orientation.status === "failure" && orientation.failureCode, "image_orientation_invalid");
    const mime = await prepareAfcUi2aOriginal(request(), { ...item.deps, fetchImage: async () => ({ ok: true as const, base64: "", buffer: bytes, mime: "image/gif", byteCount: bytes.byteLength, host: "images.example" }) });
    assert.equal(mime.status === "failure" && mime.failureCode, "image_mime_unsupported");
    const mimeDrift = await prepareAfcUi2aOriginal(request(), { ...item.deps, fetchImage: async () => ({ ok: true as const, base64: "", buffer: bytes, mime: "image/jpeg", byteCount: bytes.byteLength, host: "images.example" }) });
    assert.equal(mimeDrift.status === "failure" && mimeDrift.failureCode, "image_mime_unsupported");
    const oversized = await prepareAfcUi2aOriginal(request(), { ...item.deps, maxImageBytes: 1 });
    assert.equal(oversized.status === "failure" && oversized.failureCode, "image_byte_limit_exceeded");
    const root = await prepareAfcUi2aOriginal(request(), { ...item.deps, resolveFixedInputsRoot: async () => ({ ok: false as const, code: "fixed_inputs_root_unavailable" as const }) });
    assert.equal(root.status === "failure" && root.failureCode, "fixed_inputs_root_unavailable");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
