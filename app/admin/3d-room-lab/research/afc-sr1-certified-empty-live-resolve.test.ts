import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAfcSr1CertifiedEmptyResolver,
  resolveAfcSr1CertifiedEmptyLive,
} from "./afc-sr1-certified-empty-live-resolve";

const originalBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==",
  "base64"
);
const emptyBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==",
  "base64"
);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const selector = {
  roomId: "room-c",
  packageId: `afc-ui2a-package:room-c:${"a".repeat(64)}`,
  receiptFileName: `afc-ui2a-prepared-input.room-c.${"a".repeat(64)}.receipt.json`,
  receiptSha256: "c".repeat(64),
};
const original = {
  sha256: sha(originalBytes),
  byteCount: originalBytes.byteLength,
  decodedWidth: 1,
  decodedHeight: 1,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const empty = {
  sha256: sha(emptyBytes),
  byteCount: emptyBytes.byteLength,
  decodedWidth: 1,
  decodedHeight: 1,
  mimeType: "image/png" as const,
  orientation: 1 as const,
  generatedFromOriginalSha256: sha(originalBytes),
};

function replayResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    evidence: {
      roomId: selector.roomId,
      packageId: selector.packageId,
      receipt: {
        original,
        emptyRoomAssist: empty,
      },
      emptyRoomAssistFilePath: "/server-only/trusted-empty.png",
      ...overrides,
    } as never,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    replayPackage: async () => replayResult(),
    readEmptyBytes: async () => emptyBytes,
    inspectMetadata: async () => ({ ok: true as const, width: 1, height: 1, orientation: 1 }),
    ...overrides,
  };
}

test("certified EMPTY replay binds bytes and marks the resolved input non-generated", async () => {
  const result = await resolveAfcSr1CertifiedEmptyLive({
    selector,
    expectedOriginal: {
      sha256: original.sha256,
      decodedWidth: 1,
      decodedHeight: 1,
      orientation: 1,
    },
  }, dependencies() as never);
  assert.ok(result);
  if (!result) return;
  assert.equal(result.empty.basis.sha256, sha(emptyBytes));
  assert.equal(result.empty.generated, false);
  assert.deepEqual(Buffer.from(result.empty.bytes), emptyBytes);
});

test("certified resolver permits only the freshly qualified package Original", async () => {
  const result = await resolveAfcSr1CertifiedEmptyLive({
    selector,
    expectedOriginal: {
      sha256: original.sha256,
      decodedWidth: 1,
      decodedHeight: 1,
      orientation: 1,
    },
  }, dependencies() as never);
  assert.ok(result);
  if (!result) return;
  const resolveEmpty = createAfcSr1CertifiedEmptyResolver(result);
  assert.equal(await resolveEmpty({ basis: original, sourceImageUrl: "https://example.test/original.png" }), result.empty);
  assert.equal(
    await resolveEmpty({
      basis: { ...original, sha256: "d".repeat(64) },
      sourceImageUrl: "https://example.test/other.png",
    }),
    null
  );
});

test("certified EMPTY fails closed for a claimed Original mismatch or altered EMPTY bytes", async () => {
  const expectedOriginal = {
    sha256: "e".repeat(64),
    decodedWidth: 1,
    decodedHeight: 1,
    orientation: 1 as const,
  };
  assert.equal(
    await resolveAfcSr1CertifiedEmptyLive({ selector, expectedOriginal }, dependencies() as never),
    null
  );
  assert.equal(
    await resolveAfcSr1CertifiedEmptyLive({
      selector,
      expectedOriginal: { ...expectedOriginal, sha256: original.sha256 },
    }, dependencies({
      readEmptyBytes: async () => Buffer.from(emptyBytes.subarray(0, emptyBytes.length - 1)),
    }) as never),
    null
  );
});

test("certified EMPTY propagates replay confinement failures without reading inputs", async () => {
  let reads = 0;
  const result = await resolveAfcSr1CertifiedEmptyLive({
    selector: { ...selector, roomId: "../room-c" },
    expectedOriginal: {
      sha256: original.sha256,
      decodedWidth: 1,
      decodedHeight: 1,
      orientation: 1,
    },
  }, dependencies({
    replayPackage: async () => ({ ok: false as const, failureCode: "package_not_found" }),
    readEmptyBytes: async () => {
      reads++;
      return emptyBytes;
    },
  }) as never);
  assert.equal(result, null);
  assert.equal(reads, 0);
});

test("helper contains no cache write or live EMPTY generation path", () => {
  const source = readFileSync(
    new URL("./afc-sr1-certified-empty-live-resolve.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /getOrGenerateEmptyRoomImage/);
  assert.doesNotMatch(source, /writeFile|mkdir|callCompositor/);
});
