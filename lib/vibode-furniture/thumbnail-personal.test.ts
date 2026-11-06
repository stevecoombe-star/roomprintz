import assert from "node:assert/strict";
import test from "node:test";

import {
  createPi3aAuthority,
  PI3A_GENERATION_A,
  PI3A_ROOM_ID,
} from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { AFC_V2_RUNTIME_COORDINATE_SPACE } from "@/lib/afc-v2-runtime/types";
import { PERSONAL_FURNITURE_BUCKET, personalFurniturePermanentPath } from "@/lib/vibode-furniture/asset-id";
import type { PersonalRuntimeRow } from "@/lib/vibode-furniture/runtime-resolve";

import { buildVibodeThumbnailRenderPayload, type ThumbnailRenderSource } from "@/lib/vibode-thumbnail-render/payload.server";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const ASSET_ID = "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST = "project.supabase.co";
const SIGNED_GLB = `https://${HOST}/storage/v1/object/sign/personal/model.glb?token=secret`;
const SIGNED_BG = `https://${HOST}/storage/v1/object/sign/rooms/bg.jpg?token=secret`;

function row(userId: string): PersonalRuntimeRow {
  return {
    assetId: ASSET_ID,
    userId,
    authoredWidthM: 1.2,
    authoredHeightM: 0.8,
    authoredDepthM: 0.6,
    storageBucket: PERSONAL_FURNITURE_BUCKET,
    storageObjectPath: personalFurniturePermanentPath(userId, ASSET_ID)!,
  };
}

function source(input: Readonly<{
  ownerUserId?: string;
  rows?: readonly PersonalRuntimeRow[];
}>): ThumbnailRenderSource & { minted: number; lookedUp: string[] } {
  const state = { minted: 0, lookedUp: [] as string[] };
  const authority = createPi3aAuthority({ generationId: PI3A_GENERATION_A });
  const bound: ThumbnailRenderSource & { minted: number; lookedUp: string[] } = {
    ...state,
    policy: { supabaseHost: HOST },
    async loadRoom() {
      return {
        id: PI3A_ROOM_ID,
        userId: input.ownerUserId ?? USER_ID,
        currentAfcGenerationId: PI3A_GENERATION_A,
      };
    },
    async loadVersion() {
      return {
        id: VERSION_ID,
        roomId: PI3A_ROOM_ID,
        userId: input.ownerUserId ?? USER_ID,
        imageUrl: null,
        storageBucket: "room-images",
        storagePath: "rooms/bg.jpg",
      };
    },
    async loadGeneration() {
      return {
        id: PI3A_GENERATION_A,
        roomId: PI3A_ROOM_ID,
        userId: input.ownerUserId ?? USER_ID,
        status: "ready",
        productionAuthority: authority,
      };
    },
    async loadScene() {
      return {
        found: true,
        scene: {
          roomId: PI3A_ROOM_ID,
          versionId: VERSION_ID,
          afcGenerationId: PI3A_GENERATION_A,
          coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
          objects: [{
            objectId: "personal-1",
            assetId: ASSET_ID,
            userSizeMultiplier: 1.5,
            transform: {
              position: { x: 0.2, y: 0, z: 0.4 },
              rotationDeg: { x: 0, y: 10, z: 0 },
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
    async lookupPersonalAssets(_ids, ownerUserId) {
      state.lookedUp.push(ownerUserId);
      bound.lookedUp = state.lookedUp;
      return input.rows ?? [row(ownerUserId)];
    },
    async mintDynamicSignedGet() {
      state.minted += 1;
      bound.minted = state.minted;
      return {
        ok: true,
        signedUrl: SIGNED_GLB,
        expiresAt: "2030-01-01T00:00:00.000Z",
      };
    },
    minted: 0,
    lookedUp: [],
  };
  return bound;
}

test("a personal model resolves for its owner's room thumbnail", async () => {
  const bound = source({});
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, bound);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(bound.lookedUp, [USER_ID]);
  assert.equal(built.payload.objects[0]?.glbUrl, SIGNED_GLB);
  assert.equal(built.payload.objects[0]?.userSizeMultiplier, 1.5);
  const json = JSON.stringify(built.payload);
  assert.equal(json.includes(PERSONAL_FURNITURE_BUCKET), false);
  assert.equal(json.includes("storageObjectPath"), false);
  assert.equal(json.includes("service_role"), false);
});

test("another user's personal model is not signed for the thumbnail", async () => {
  const bound = source({ rows: [row(OTHER_USER)] });
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, bound);
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "glb_identity_missing");
  assert.equal(bound.minted, 0);
  assert.deepEqual(bound.lookedUp, [USER_ID]);
});
