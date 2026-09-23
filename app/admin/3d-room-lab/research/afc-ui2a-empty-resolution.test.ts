import assert from "node:assert/strict";
import test from "node:test";

import { resolveAfcUi2aEmptyEvidence } from "./afc-ui2a-empty-resolution";
import { AFC_UI2A_EMPTY_RESOLUTION_REQUEST_VERSION, parseAfcUi2aEmptyResolutionRequest } from "./afc-ui2a-package-contract";
import type { AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";

const sha = "a".repeat(64);
const selector = {
  preparationId: `afc-ui2a-original:room-a:${sha}`,
  receiptFileName: `afc-ui2a-original-preparation.room-a.${sha}.receipt.json`,
  receiptSha256: "b".repeat(64),
};
const request = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: AFC_UI2A_EMPTY_RESOLUTION_REQUEST_VERSION,
  roomLabel: "Room A",
  originalPreparation: selector,
  executeCapture: true,
  ...overrides,
});
const original = {
  roomId: "room-a",
  preparationId: selector.preparationId,
  receipt: { source: { sanitizedImageUrl: "https://images.example.test/room.jpg" } },
  original: { fileName: `room-a.original.${sha}.png`, sha256: sha, byteCount: 12, mimeType: "image/png", decodedWidth: 2, decodedHeight: 2, orientation: 1 },
  roomDirectory: "/tmp/room-a",
  originalFilePath: "/tmp/room-a/original.png",
  sanitizedImageUrl: "https://images.example.test/room.jpg",
} as unknown as AfcUi2aVerifiedOriginalEvidence;
const selected = {
  status: "selected" as const,
  evidence: {
    canonicalReceiptFileName: "afc-r3c-fixed-empty-room.capture.receipt.json",
    emptyRoomAssist: {
      fileName: `room-a.empty-room.${"c".repeat(64)}.png`, sha256: "c".repeat(64), byteCount: 10, mimeType: "image/png" as const,
      decodedWidth: 2, decodedHeight: 2, orientation: 1 as const, generatedFromOriginalSha256: sha,
      generatorId: "vibode-empty-room-assist/stage1-empty-room/v1", requestedModelId: "NBP" as const,
      resolvedModelId: null, resolvedModelStatus: "not_reported_by_compositor" as const,
    },
  },
};
const baseDeps = {
  replayOriginal: async () => ({ ok: true as const, evidence: original }),
  discoverDurable: async () => selected,
};

test("closed request parser rejects output and non-primitive acknowledgement fields", () => {
  assert.equal(parseAfcUi2aEmptyResolutionRequest(request()).ok, true);
  assert.equal(parseAfcUi2aEmptyResolutionRequest(request({ outputDir: "/tmp" })).ok, false);
  for (const value of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true)]) {
    const parsed = parseAfcUi2aEmptyResolutionRequest(request({ executeCapture: value }));
    assert.equal(parsed.ok, true);
  }
});

test("capture acknowledgement stops before replay, discovery, or capture", async () => {
  let calls = 0;
  const result = await resolveAfcUi2aEmptyEvidence(request({ executeCapture: false }), {
    replayOriginal: async () => { calls++; return { ok: true as const, evidence: original }; },
    discoverDurable: async () => { calls++; return { status: "absent" as const }; },
    capture: async () => { calls++; throw new Error("must not run"); },
  });
  assert.deepEqual(result, { status: "failure", failureCode: "capture_not_authorized", message: "Confirm Empty-Room resolution before accessing local research evidence.", emptyRoomGenerationCall: false });
  assert.equal(calls, 0);
});

test("durable disk evidence wins before cache or live generation", async () => {
  let captures = 0;
  const result = await resolveAfcUi2aEmptyEvidence(request({ executeEmptyRoomGeneration: true }), {
    ...baseDeps,
    capture: async () => { captures++; throw new Error("must not run"); },
  });
  assert.equal(result.status, "empty_resolved");
  assert.equal(result.status === "empty_resolved" && result.resolutionSource, "disk_reused");
  assert.equal(captures, 0);
});

test("cache miss requires primitive true generation acknowledgement", async () => {
  let captures = 0;
  const result = await resolveAfcUi2aEmptyEvidence(request({ executeEmptyRoomGeneration: "true" }), {
    replayOriginal: baseDeps.replayOriginal,
    discoverDurable: async () => ({ status: "absent" as const }),
    capture: async () => {
      captures++;
      return { status: "cache_miss" as const, captureSource: null, emptyRoomGenerationCall: false, captureWritten: false, safety: {} as never };
    },
  });
  assert.equal(result.status, "empty_generation_required");
  assert.equal(captures, 1);
});

test("live generation is reserved and replayed after capture", async () => {
  let captures = 0;
  let reservationReleased = false;
  const discoveries = [{ status: "absent" as const }, selected];
  const result = await resolveAfcUi2aEmptyEvidence(request({ executeEmptyRoomGeneration: true }), {
    replayOriginal: baseDeps.replayOriginal,
    discoverDurable: async () => discoveries.shift() ?? selected,
    emptyGenerationEnabled: () => true,
    acquireReservation: async ({ originalSha256 }) => {
      assert.equal(originalSha256, sha);
      return { ok: true, filePath: "/tmp/reservation" };
    },
    releaseReservation: async () => { reservationReleased = true; },
    capture: async (raw) => {
      captures++;
      const actual = raw as { executeEmptyRoomGeneration?: boolean };
      if (captures === 1) {
        assert.equal(actual.executeEmptyRoomGeneration, undefined);
        return { status: "cache_miss" as const, captureSource: null, emptyRoomGenerationCall: false, captureWritten: false, safety: {} as never };
      }
      assert.equal(actual.executeEmptyRoomGeneration, true);
      return { status: "captured" as const, captureSource: "generated" as const, originalPath: "/private/original", emptyPath: "/private/empty", receiptPath: "/private/receipt", emptyRoomGenerationCall: true, safety: {} as never };
    },
  });
  assert.equal(result.status, "empty_resolved");
  assert.equal(result.status === "empty_resolved" && result.resolutionSource, "generated");
  assert.equal(captures, 2);
  assert.equal(reservationReleased, true);
});
