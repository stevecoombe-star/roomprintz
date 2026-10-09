import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";

import { selectHarmonizeEmptyBytes } from "./harmonize-empty";
import { encodeRgbaPng, type HarmonizeExportAuthority } from "./harmonize-export";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const GENERATION_ID = "22222222-2222-4222-8222-222222222222";

async function emptyPng(): Promise<Uint8Array> {
  return encodeRgbaPng(Uint8Array.of(10, 20, 30, 255, 40, 50, 60, 255), 2, 1);
}

function authority(sha256: string, width = 2, height = 1): HarmonizeExportAuthority {
  return {
    generationId: GENERATION_ID,
    empty: { sha256, decodedWidth: width, decodedHeight: height },
    frame: { width, height },
    frozenCamera: { frame: { width, height } },
  };
}

test("admin empty selection returns the original bytes only when identity and frame match", async () => {
  const bytes = await emptyPng();
  const sha = sha256Hex(bytes);
  const selected = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: USER_ID, currentAfcGenerationId: GENERATION_ID },
    generation: {
      id: GENERATION_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      status: "ready",
      emptyStoragePath: "users/u/rooms/r/empty.png",
      empty: {
        sha256: sha,
        byteCount: bytes.byteLength,
        decodedWidth: 2,
        decodedHeight: 1,
        mimeType: "image/png",
      },
    },
    authority: authority(sha),
    bytes,
  });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.deepEqual(selected.bytes, bytes);
  assert.notEqual(selected.bytes, bytes);
  selected.bytes[0] = 0;
  assert.equal(bytes[0], 0x89);

  const forbidden = selectHarmonizeEmptyBytes({
    callerIsAdmin: false,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: USER_ID, currentAfcGenerationId: GENERATION_ID },
    generation: null,
    authority: null,
    bytes: null,
  });
  assert.deepEqual(forbidden, {
    ok: false,
    status: 403,
    error: "Admin access required.",
  });

  const otherRoom = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: OTHER_USER, currentAfcGenerationId: GENERATION_ID },
    generation: null,
    authority: authority(sha),
    bytes,
  });
  assert.equal(otherRoom.ok, false);
  if (!otherRoom.ok) {
    assert.equal(otherRoom.status, 404);
    assert.equal(otherRoom.error, "Room not found.");
  }

  const mismatched = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: USER_ID, currentAfcGenerationId: GENERATION_ID },
    generation: {
      id: GENERATION_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      status: "ready",
      emptyStoragePath: "users/u/rooms/r/empty.png",
      empty: {
        sha256: sha,
        byteCount: bytes.byteLength,
        decodedWidth: 2,
        decodedHeight: 1,
        mimeType: "image/png",
      },
    },
    authority: {
      ...authority(sha),
      frame: { width: 4, height: 1 },
      frozenCamera: { frame: { width: 4, height: 1 } },
    },
    bytes,
  });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) {
    assert.equal(mismatched.status, 409);
    assert.match(mismatched.error, /stopped instead of scaling/);
  }

  const compatible = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: USER_ID, currentAfcGenerationId: GENERATION_ID },
    generation: {
      id: GENERATION_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      status: "ready",
      emptyStoragePath: "users/u/rooms/r/empty.png",
      empty: {
        sha256: sha,
        byteCount: bytes.byteLength,
        decodedWidth: 2,
        decodedHeight: 1,
        mimeType: "image/png",
      },
    },
    authority: {
      ...authority(sha),
      empty: { sha256: sha, decodedWidth: 2, decodedHeight: 1, orientation: 1 },
      original: { orientation: 1 },
      frame: { width: 4, height: 2 },
      frozenCamera: { frame: { width: 4, height: 2 } },
    },
    bytes,
  });
  assert.equal(compatible.ok, true);
  if (compatible.ok) assert.deepEqual(compatible.bytes, bytes);

  const turned = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: USER_ID, currentAfcGenerationId: GENERATION_ID },
    generation: {
      id: GENERATION_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      status: "ready",
      emptyStoragePath: "users/u/rooms/r/empty.png",
      empty: {
        sha256: sha,
        byteCount: bytes.byteLength,
        decodedWidth: 2,
        decodedHeight: 1,
        mimeType: "image/png",
      },
    },
    authority: {
      ...authority(sha),
      empty: { sha256: sha, decodedWidth: 2, decodedHeight: 1, orientation: 6 },
      original: { orientation: 1 },
    },
    bytes,
  });
  assert.equal(turned.ok, false);
  if (!turned.ok) {
    assert.equal(turned.status, 409);
    assert.match(turned.error, /orientation/);
  }

  const corrupt = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: USER_ID,
    roomId: ROOM_ID,
    room: { userId: USER_ID, currentAfcGenerationId: GENERATION_ID },
    generation: {
      id: GENERATION_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      status: "ready",
      emptyStoragePath: "users/u/rooms/r/empty.png",
      empty: {
        sha256: "ab".repeat(32),
        byteCount: bytes.byteLength,
        decodedWidth: 2,
        decodedHeight: 1,
        mimeType: "image/png",
      },
    },
    authority: authority("ab".repeat(32)),
    bytes,
  });
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) assert.equal(corrupt.status, 409);
});
