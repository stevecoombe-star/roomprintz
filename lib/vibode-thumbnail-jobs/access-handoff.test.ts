import assert from "node:assert/strict";
import test from "node:test";

import { createPi3aAuthority, PI3A_GENERATION_A, PI3A_ROOM_ID } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { AFC_V2_RUNTIME_COORDINATE_SPACE, AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";
import {
  mintThumbnailRenderToken,
  resetThumbnailRenderAccessForTests,
} from "@/lib/vibode-thumbnail-render/access.server";
import {
  buildVibodeThumbnailRenderPayload,
  readVibodeThumbnailRenderAccess,
  type ThumbnailRenderSource,
} from "@/lib/vibode-thumbnail-render/payload.server";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST = "project.supabase.co";
const SIGNED_BG = `https://${HOST}/storage/v1/object/sign/rooms/bg.jpg?token=secret`;

function source(): ThumbnailRenderSource {
  const generationId = PI3A_GENERATION_A;
  return {
    policy: { supabaseHost: HOST },
    async loadRoom() {
      return { id: PI3A_ROOM_ID, userId: USER_ID, currentAfcGenerationId: generationId };
    },
    async loadVersion() {
      return {
        id: VERSION_ID,
        roomId: PI3A_ROOM_ID,
        userId: USER_ID,
        imageUrl: null,
        storageBucket: "room-images",
        storagePath: "rooms/bg.jpg",
      };
    },
    async loadGeneration() {
      return {
        id: generationId,
        roomId: PI3A_ROOM_ID,
        userId: USER_ID,
        status: "ready",
        productionAuthority: createPi3aAuthority({ generationId }),
      };
    },
    async loadScene() {
      return {
        found: true,
        scene: {
          roomId: PI3A_ROOM_ID,
          versionId: VERSION_ID,
          afcGenerationId: generationId,
          coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
          objects: [{
            objectId: "sofa-1",
            assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
            transform: {
              position: { x: 1, y: 0, z: 2 },
              rotationDeg: { x: 0, y: 20, z: 0 },
              uniformScale: 1,
            },
          }],
        },
      };
    },
    async signStorageUrl() {
      return SIGNED_BG;
    },
    async lookupDynamicAssets() {
      return [];
    },
    async mintDynamicSignedGet() {
      return { ok: false };
    },
  };
}

test("a durable claim authorizes the same render payload", async () => {
  resetThumbnailRenderAccessForTests();
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
    jobId: JOB_ID,
  }, source());
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const minted = mintThumbnailRenderToken({
    jobId: JOB_ID,
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
    contentToken: built.payload.job.contentToken,
    nonce: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    durable: true,
    nowMs: 5_000,
  });
  assert.ok(minted);
  if (!minted) return;
  const read = await readVibodeThumbnailRenderAccess(minted.token, source(), {
    nowMs: 5_000,
    lookupClaim: async () => ({
      jobId: JOB_ID,
      roomId: PI3A_ROOM_ID,
      versionId: VERSION_ID,
      contentToken: built.payload.job.contentToken,
      expiresAtMs: 5_000 + 180_000,
    }),
  });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.payload.job.contentToken, built.payload.job.contentToken);
  assert.equal(read.payload.objects.length, 1);
});

test("a durable token is denied without a matching claimed job", async () => {
  resetThumbnailRenderAccessForTests();
  const minted = mintThumbnailRenderToken({
    jobId: JOB_ID,
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
    contentToken: "d".repeat(64),
    nonce: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    durable: true,
    nowMs: 5_000,
  });
  assert.ok(minted);
  if (!minted) return;
  const missing = await readVibodeThumbnailRenderAccess(minted.token, source(), {
    nowMs: 5_000,
    lookupClaim: async () => null,
  });
  assert.equal(missing.ok, false);
  const mismatched = await readVibodeThumbnailRenderAccess(minted.token, source(), {
    nowMs: 5_000,
    lookupClaim: async () => ({
      jobId: JOB_ID,
      roomId: PI3A_ROOM_ID,
      versionId: VERSION_ID,
      contentToken: "e".repeat(64),
      expiresAtMs: 5_000 + 180_000,
    }),
  });
  assert.equal(mismatched.ok, false);
});
