import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC,
  isOwnedOriginalStoragePath,
  isProductionOriginalSourceUrl,
  prepareOwnedOriginalForAnalysis,
  resolveOwnedOriginalStorage,
} from "./production-original";
import { AFC_V2_ORIGINAL_STORAGE_BUCKET } from "./production-store";

const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "44444444-4444-4444-8444-444444444444";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";

test("owner-bound ORIGINAL paths require users/{authenticatedUserId}/", () => {
  assert.equal(
    isOwnedOriginalStoragePath(USER_A, `users/${USER_A}/scene_x/base.jpg`),
    true,
  );
  assert.equal(
    isOwnedOriginalStoragePath(USER_A, `users/${USER_B}/scene_x/base.jpg`),
    false,
  );
  assert.equal(
    isOwnedOriginalStoragePath(USER_A, `users/${USER_A}/../users/${USER_B}/base.jpg`),
    false,
  );
  assert.equal(isOwnedOriginalStoragePath(USER_A, "/etc/passwd"), false);
});

test("cross-user ORIGINAL storage path is rejected before download or signing", async () => {
  let downloaded = false;
  let signed = false;
  const result = await prepareOwnedOriginalForAnalysis({
    authenticatedUserId: USER_A,
    room: {
      id: ROOM_ID,
      userId: USER_A,
      currentAfcGenerationId: null,
      baseStorageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
      baseStoragePath: `users/${USER_B}/scene_x/base.jpg`,
      baseAsset: null,
    },
    download: async () => {
      downloaded = true;
      return Uint8Array.from([1]);
    },
    sign: async () => {
      signed = true;
      return "https://example.test/signed.jpg";
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unowned_path");
  assert.equal(downloaded, false);
  assert.equal(signed, false);
});

test("room/asset ORIGINAL identity must stay consistent with the authenticated owner", () => {
  const rejected = resolveOwnedOriginalStorage({
    authenticatedUserId: USER_A,
    roomId: ROOM_ID,
    room: {
      id: ROOM_ID,
      userId: USER_A,
      baseStorageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
      baseStoragePath: `users/${USER_A}/scene_x/base.jpg`,
      baseAsset: {
        id: "55555555-5555-4555-8555-555555555555",
        roomId: ROOM_ID,
        userId: USER_B,
        storageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
        storagePath: `users/${USER_B}/scene_x/base.jpg`,
      },
    },
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "inconsistent_asset");
});

test("AFC bucket cannot be used as the ORIGINAL source", () => {
  const rejected = resolveOwnedOriginalStorage({
    authenticatedUserId: USER_A,
    roomId: ROOM_ID,
    room: {
      id: ROOM_ID,
      userId: USER_A,
      baseStorageBucket: "vibode-afc-v2",
      baseStoragePath: `users/${USER_A}/rooms/${ROOM_ID}/afc/x/empty.png`,
      baseAsset: null,
    },
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_bucket");
});

test("owned ORIGINAL signs a compositor-fetchable https URL and never a placeholder", async () => {
  const bytes = Uint8Array.from([9, 8, 7, 6]);
  const signedExpires: number[] = [];
  const result = await prepareOwnedOriginalForAnalysis({
    authenticatedUserId: USER_A,
    room: {
      id: ROOM_ID,
      userId: USER_A,
      currentAfcGenerationId: null,
      baseStorageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
      baseStoragePath: `users/${USER_A}/scene_x/base.jpg`,
      baseAsset: null,
    },
    download: async (ref) => {
      assert.equal(ref.bucket, AFC_V2_ORIGINAL_STORAGE_BUCKET);
      assert.equal(ref.path, `users/${USER_A}/scene_x/base.jpg`);
      return bytes;
    },
    sign: async (_ref, expiresInSec) => {
      signedExpires.push(expiresInSec);
      return "https://proj.supabase.co/storage/v1/object/sign/vibode-base-images/users/a/base.jpg?token=tmp";
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected owned original");
  assert.equal(result.bytes, bytes);
  assert.equal(isProductionOriginalSourceUrl(result.sourceImageUrl), true);
  assert.equal(signedExpires[0], AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC);
  assert.ok(AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC >= 15 * 60);
});

test("signed ORIGINAL URL failure fails closed without returning a privileged URL", async () => {
  const result = await prepareOwnedOriginalForAnalysis({
    authenticatedUserId: USER_A,
    room: {
      id: ROOM_ID,
      userId: USER_A,
      currentAfcGenerationId: null,
      baseStorageBucket: AFC_V2_ORIGINAL_STORAGE_BUCKET,
      baseStoragePath: `users/${USER_A}/scene_x/base.jpg`,
      baseAsset: null,
    },
    download: async () => Uint8Array.from([1, 2, 3]),
    sign: async () => "https://vibode.invalid/original",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "sign_failed");
  assert.equal("sourceImageUrl" in result, false);
});

test("placeholder ORIGINAL URLs are not compositor-fetchable production URLs", () => {
  assert.equal(isProductionOriginalSourceUrl("https://vibode.invalid/rooms/x/original"), false);
  assert.equal(isProductionOriginalSourceUrl("http://example.test/original.jpg"), false);
  assert.equal(isProductionOriginalSourceUrl("https://example.test/original.jpg"), true);
});
