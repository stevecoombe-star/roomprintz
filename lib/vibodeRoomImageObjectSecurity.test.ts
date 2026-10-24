import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ROOM_IMAGE_READ_BYTES,
  buildSupabaseStorageObjectUrl,
  detectRoomImage,
  downloadSupabaseStorageObject,
  parseRoomImageReadCompletion,
  parseRoomImageReadReservation,
  readBoundedBody,
  resolveOwnedRoomImageLocation,
} from "./vibodeRoomImageObjectSecurity";

const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const SUPABASE = "https://sec20c-offline.example";
const SERVICE_KEY = "sec20c-offline-service-role";

function jpeg(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

function png(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 24);
  return bytes;
}

function webp(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes[4] = 8;
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x20], 12);
  return bytes;
}

function resolve(overrides: Partial<Parameters<typeof resolveOwnedRoomImageLocation>[0]> = {}) {
  return resolveOwnedRoomImageLocation({
    userId: USER,
    roomId: ROOM,
    storageBucket: "vibode-base-images",
    storagePath: `users/${USER}/scene_1/base.jpg`,
    imageUrl: "https://hostile.example/secret.jpg?token=signed",
    supabaseUrl: SUPABASE,
    ...overrides,
  });
}

test("owned bucket and path are authoritative and the row image URL is ignored", () => {
  assert.deepEqual(resolve(), {
    bucket: "vibode-base-images",
    objectPath: `users/${USER}/scene_1/base.jpg`,
  });
  assert.deepEqual(
    resolve({
      storageBucket: "vibode-generations",
      storagePath: `${ROOM}/stage_1/out.webp`,
      imageUrl: "http://127.0.0.1/room.jpg",
    }),
    { bucket: "vibode-generations", objectPath: `${ROOM}/stage_1/out.webp` },
  );
});

test("legacy image_url recovery accepts only an owned object in an allowed bucket", () => {
  const signed =
    `${SUPABASE}/storage/v1/object/sign/vibode-generations/rooms/${ROOM}/harmonize/out.jpg?token=signed-secret`;
  assert.deepEqual(
    resolve({ storageBucket: null, storagePath: null, imageUrl: signed }),
    { bucket: "vibode-generations", objectPath: `rooms/${ROOM}/harmonize/out.jpg` },
  );
  assert.equal(
    resolve({
      storageBucket: "vibode-base-images",
      storagePath: " ",
      imageUrl: `${SUPABASE}/storage/v1/object/public/vibode-base-images/users/${USER}/scene_1/base.jpg`,
    })?.objectPath,
    `users/${USER}/scene_1/base.jpg`,
  );
});

test("legacy recovery fails closed for unowned, external, loopback, and disallowed targets", () => {
  const ownedPath = `users/${USER}/scene_1/base.jpg`;
  const cases = [
    "data:image/jpeg;base64,AAAA",
    "http://127.0.0.1/storage/v1/object/public/vibode-base-images/" + ownedPath,
    "http://localhost/storage/v1/object/public/vibode-base-images/" + ownedPath,
    "http://169.254.169.254/storage/v1/object/public/vibode-base-images/" + ownedPath,
    "http://[fe80::1]/storage/v1/object/public/vibode-base-images/" + ownedPath,
    `https://hostile.example/storage/v1/object/public/vibode-base-images/${ownedPath}`,
    `${SUPABASE}/storage/v1/object/public/vibode-thumbnails/${ownedPath}`,
    `${SUPABASE}/storage/v1/object/public/vibode-base-images/users/${OTHER}/scene_1/base.jpg`,
    `${SUPABASE}/storage/v1/object/sign/vibode-base-images/users/${USER}/../../${OTHER}/secret.jpg?token=signed`,
    `${SUPABASE}/storage/v1/render/image/public/vibode-base-images/${ownedPath}`,
  ];
  for (const imageUrl of cases) {
    assert.equal(resolve({ storageBucket: null, storagePath: null, imageUrl }), null, imageUrl);
  }
  assert.equal(
    resolve({
      storageBucket: "vibode-thumbnails",
      storagePath: null,
      imageUrl: `${SUPABASE}/storage/v1/object/public/vibode-base-images/${ownedPath}`,
    }),
    null,
  );
  assert.equal(
    resolve({
      storageBucket: "vibode-base-images",
      storagePath: `users/${OTHER}/secret.jpg`,
      imageUrl: `${SUPABASE}/storage/v1/object/public/vibode-base-images/${ownedPath}`,
    }),
    null,
  );
});

test("image signatures accept jpeg png and webp and reject everything else", () => {
  assert.deepEqual(detectRoomImage(jpeg(), "image/jpeg"), { ok: true, mime: "image/jpeg" });
  assert.deepEqual(detectRoomImage(png(), "image/png; charset=binary"), { ok: true, mime: "image/png" });
  assert.deepEqual(detectRoomImage(webp(), null), { ok: true, mime: "image/webp" });
  assert.equal(detectRoomImage(jpeg(), "image/png").ok, false);
  assert.equal(detectRoomImage(jpeg().subarray(0, 8), "image/jpeg").ok, false);
  const gif = new Uint8Array(32);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  assert.equal(detectRoomImage(gif, "image/gif").ok, false);
  assert.equal(detectRoomImage(new TextEncoder().encode("<html></html>"), "text/html").ok, false);
  assert.equal(detectRoomImage(new Uint8Array(), null).ok, false);
  assert.equal(detectRoomImage(new Uint8Array(MAX_ROOM_IMAGE_READ_BYTES + 1), "image/jpeg").ok, false);
  assert.equal(MAX_ROOM_IMAGE_READ_BYTES, 8 * 1024 * 1024);
});

test("bounded reads stop before an oversized stream is buffered", async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(64));
    },
  });
  const bounded = await readBoundedBody(stream, 100);
  assert.equal(bounded.ok, false);
  if (!bounded.ok) assert.equal(bounded.reason, "too_large");
  assert.equal(pulls <= 3, true);
});

test("reservation success requires the exact reserved contract", () => {
  const attemptId = "77777777-7777-4777-8777-777777777777";
  assert.deepEqual(parseRoomImageReadReservation({ ok: true, code: "reserved", attemptId }), {
    status: "reserved",
    attemptId,
  });
  assert.equal(parseRoomImageReadReservation({ ok: false, code: "busy", attemptId: null }).status, "busy");
  assert.equal(parseRoomImageReadReservation({ ok: false, code: "user_quota", attemptId: null }).status, "quota");
  assert.equal(parseRoomImageReadReservation({ ok: false, code: "global_quota", attemptId: null }).status, "quota");
  for (const value of [
    { ok: true },
    { ok: true, code: "reserved" },
    { ok: "true", code: "reserved", attemptId },
    { ok: 1, code: "reserved", attemptId },
    { success: true, code: "reserved", attemptId },
    { ok: true, code: "busy", attemptId },
    { ok: false, code: "reserved", attemptId },
    "true",
    true,
    null,
    [],
  ]) {
    assert.equal(parseRoomImageReadReservation(value).status, "unavailable");
  }
});

test("completion success requires the exact completed or already-terminal contract", () => {
  const attemptId = "77777777-7777-4777-8777-777777777777";
  assert.deepEqual(parseRoomImageReadCompletion({ ok: true, code: "completed", attemptId, outcome: "succeeded" }), {
    status: "completed",
    attemptId,
    outcome: "succeeded",
  });
  assert.equal(
    parseRoomImageReadCompletion({ ok: true, code: "already_terminal", attemptId, outcome: "timed_out" }).status,
    "already_terminal",
  );
  assert.equal(parseRoomImageReadCompletion({ ok: false, code: "forbidden", attemptId: null }).status, "forbidden");
  assert.equal(parseRoomImageReadCompletion({ ok: false, code: "invalid", attemptId: null }).status, "invalid");
  for (const value of [
    { ok: true, code: "completed", attemptId },
    { ok: true, code: "completed", attemptId, outcome: "refunded" },
    { ok: true, code: "reserved", attemptId, outcome: "succeeded" },
    { ok: true, code: "already_terminal", attemptId, outcome: "in_flight" },
    { ok: false, code: "completed", attemptId },
    { ok: 1, code: "forbidden", attemptId: null },
    true,
    null,
  ]) {
    assert.equal(parseRoomImageReadCompletion(value).status, "unavailable");
  }
});

test("storage download uses only the configured object URL and does not follow redirects", async () => {
  const calls: string[] = [];
  const result = await downloadSupabaseStorageObject({
    supabaseUrl: SUPABASE,
    serviceRoleKey: SERVICE_KEY,
    bucket: "vibode-base-images",
    objectPath: `users/${USER}/scene_1/base.jpg`,
    userId: USER,
    roomId: ROOM,
    fetchImpl: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      calls.push(url);
      assert.equal(url.includes(SERVICE_KEY), false);
      assert.equal(url.includes("token="), false);
      assert.equal(init?.redirect, "error");
      return new Response(Buffer.from(jpeg()), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "32" },
      });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    `${SUPABASE}/storage/v1/object/vibode-base-images/users/${encodeURIComponent(USER)}/scene_1/base.jpg`,
  ]);

  let redirectPulls = 0;
  const redirected = await downloadSupabaseStorageObject({
    supabaseUrl: SUPABASE,
    serviceRoleKey: SERVICE_KEY,
    bucket: "vibode-base-images",
    objectPath: `users/${USER}/scene_1/base.jpg`,
    userId: USER,
    roomId: ROOM,
    fetchImpl: async () => {
      throw new TypeError("unexpected redirect");
    },
  });
  assert.deepEqual(redirected, { ok: false, reason: "redirect" });

  const oversized = await downloadSupabaseStorageObject({
    supabaseUrl: SUPABASE,
    serviceRoleKey: SERVICE_KEY,
    bucket: "vibode-generations",
    objectPath: `${ROOM}/stage_1/out.jpg`,
    userId: USER,
    roomId: ROOM,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            redirectPulls += 1;
            controller.enqueue(new Uint8Array([1]));
          },
        }),
        { status: 200, headers: { "content-length": String(MAX_ROOM_IMAGE_READ_BYTES + 1) } },
      ),
  });
  assert.deepEqual(oversized, { ok: false, reason: "too_large" });
  assert.equal(redirectPulls <= 1, true);

  const blocked = await downloadSupabaseStorageObject({
    supabaseUrl: SUPABASE,
    serviceRoleKey: SERVICE_KEY,
    bucket: "vibode-base-images",
    objectPath: `users/${OTHER}/secret.jpg`,
    userId: USER,
    roomId: ROOM,
    fetchImpl: async () => {
      throw new Error("should-not-fetch");
    },
  });
  assert.deepEqual(blocked, { ok: false, reason: "invalid" });
  assert.equal(buildSupabaseStorageObjectUrl({
    supabaseUrl: "http://127.0.0.1:54321",
    bucket: "vibode-thumbnails",
    objectPath: `users/${USER}/scene_1/base.jpg`,
  }), null);
});
