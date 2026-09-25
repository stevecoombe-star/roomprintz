import assert from "node:assert/strict";
import test from "node:test";

import {
  createPi3aAuthority,
  PI3A_GENERATION_A,
  PI3A_GENERATION_B,
  PI3A_ROOM_ID,
} from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import type { LoadedSceneRow } from "@/lib/afc-v2-runtime/scene-inheritance";
import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  AFC_V2_USER_SIZE_DEFAULT,
} from "@/lib/afc-v2-runtime/types";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { PARTNER_INTAKE_ASSET_SOURCE } from "@/lib/vibode-stage/partner-runtime-asset-id";
import type { DynamicRuntimeLookupRow } from "@/lib/vibode-stage/partner-runtime-assets";

import { resetThumbnailRenderAccessForTests } from "./access.server";
import { VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION } from "./contract";
import {
  buildVibodeThumbnailRenderPayload,
  readVibodeThumbnailRenderAccess,
  mintVibodeThumbnailRenderAccess,
  thumbnailContentToken,
  type ThumbnailRenderSource,
} from "./payload.server";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const HOST = "project.supabase.co";
const PARTNER_ASSET_ID = "vibode-stage/partner-intake/44444444-4444-4444-8444-444444444444";
const SIGNED_GLB = `https://${HOST}/storage/v1/object/sign/partner/chair.glb?token=secret`;
const SIGNED_BG = `https://${HOST}/storage/v1/object/sign/rooms/bg.jpg?token=secret`;

function source(patch?: Partial<ThumbnailRenderSource> & {
  objects?: LoadedSceneRow;
  generationId?: string;
  dynamic?: readonly DynamicRuntimeLookupRow[];
  mintFails?: boolean;
}): ThumbnailRenderSource {
  const generationId = patch?.generationId ?? PI3A_GENERATION_A;
  const authority = createPi3aAuthority({ generationId });
  const loaded: LoadedSceneRow = patch?.objects ?? {
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
  return {
    policy: { supabaseHost: HOST },
    async loadRoom() {
      return {
        id: PI3A_ROOM_ID,
        userId: USER_ID,
        currentAfcGenerationId: generationId,
      };
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
        productionAuthority: authority,
      };
    },
    async loadScene() {
      return loaded;
    },
    async signStorageUrl() {
      return SIGNED_BG;
    },
    async lookupDynamicAssets() {
      return patch?.dynamic ?? [];
    },
    async mintDynamicSignedGet() {
      if (patch?.mintFails) return { ok: false };
      return {
        ok: true,
        signedUrl: SIGNED_GLB,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    ...patch,
  };
}

test("valid room version and scene build a render payload", async () => {
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source());
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const asset = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(built.payload.objects.length, 1);
  assert.equal(built.payload.objects[0]?.glbUrl, asset?.glbUrl);
  assert.equal(built.payload.background.url, SIGNED_BG);
  assert.equal(built.payload.camera.position.z, 4);
  assert.equal(JSON.stringify(built.payload).includes("room-images"), false);
});

test("generation mismatch is rejected", async () => {
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source({
    objects: {
      found: true,
      scene: {
        roomId: PI3A_ROOM_ID,
        versionId: VERSION_ID,
        afcGenerationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
        objects: [{
          objectId: "sofa-1",
          assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotationDeg: { x: 0, y: 0, z: 0 },
            uniformScale: 1,
          },
        }],
      },
    },
  }));
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "generation_mismatch");
  assert.equal(built.retryable, false);
});

test("an empty scene is identified and does not mint a token", async () => {
  resetThumbnailRenderAccessForTests();
  const built = await mintVibodeThumbnailRenderAccess({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source({
    objects: {
      found: true,
      scene: {
        roomId: PI3A_ROOM_ID,
        versionId: VERSION_ID,
        afcGenerationId: PI3A_GENERATION_A,
        coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
        objects: [],
      },
    },
  }));
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "scene_empty");
});

test("an unknown asset is rejected", async () => {
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source({
    objects: {
      found: true,
      scene: {
        roomId: PI3A_ROOM_ID,
        versionId: VERSION_ID,
        afcGenerationId: PI3A_GENERATION_A,
        coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
        objects: [{
          objectId: "mystery-1",
          assetId: "missing-asset",
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotationDeg: { x: 0, y: 0, z: 0 },
            uniformScale: 1,
          },
        }],
      },
    },
  }));
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "glb_identity_missing");
});

test("a partner asset resolves through a signed URL", async () => {
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source({
    dynamic: [{
      assetId: PARTNER_ASSET_ID,
      status: "ready",
      source: PARTNER_INTAKE_ASSET_SOURCE,
      authoredWidthM: 0.8,
      authoredHeightM: 0.9,
      authoredDepthM: 0.7,
      storageBucket: "partner-private",
      storageObjectPath: "partner/chair.glb",
    }],
    objects: {
      found: true,
      scene: {
        roomId: PI3A_ROOM_ID,
        versionId: VERSION_ID,
        afcGenerationId: PI3A_GENERATION_A,
        coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
        objects: [{
          objectId: "chair-1",
          assetId: PARTNER_ASSET_ID,
          transform: {
            position: { x: 0.2, y: 0, z: 0.4 },
            rotationDeg: { x: 0, y: 10, z: 0 },
            uniformScale: 1,
          },
        }],
      },
    },
  }));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.payload.objects[0]?.glbUrl, SIGNED_GLB);
  assert.equal(JSON.stringify(built.payload).includes("partner-private"), false);
  assert.equal(JSON.stringify(built.payload).includes("storageObjectPath"), false);
});

test("a render token resolves only its room and version", async () => {
  resetThumbnailRenderAccessForTests();
  const minted = await mintVibodeThumbnailRenderAccess({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source());
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const read = await readVibodeThumbnailRenderAccess(minted.accessToken, source());
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.payload.room.roomId, PI3A_ROOM_ID);
  assert.equal(read.payload.room.versionId, VERSION_ID);
  assert.equal(read.payload.job.jobId, minted.jobId);
  const changed = await readVibodeThumbnailRenderAccess(minted.accessToken, source({
    objects: {
      found: true,
      scene: {
        roomId: PI3A_ROOM_ID,
        versionId: VERSION_ID,
        afcGenerationId: PI3A_GENERATION_A,
        coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
        objects: [{
          objectId: "sofa-2",
          assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
          transform: {
            position: { x: 3, y: 0, z: 0 },
            rotationDeg: { x: 0, y: 0, z: 0 },
            uniformScale: 1,
          },
        }],
      },
    },
  }));
  assert.equal(changed.ok, false);
  if (changed.ok) return;
  assert.equal(changed.code, "render_access_denied");
});

function sceneObject(
  patch?: Partial<SceneObjectDefinition> & {
    position?: SceneObjectDefinition["transform"]["position"];
    rotationDeg?: SceneObjectDefinition["transform"]["rotationDeg"];
  },
): SceneObjectDefinition {
  return {
    objectId: patch?.objectId ?? "sofa-1",
    assetId: patch?.assetId ?? AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    transform: {
      position: patch?.position ?? patch?.transform?.position ?? { x: 1, y: 0, z: 2 },
      rotationDeg: patch?.rotationDeg ?? patch?.transform?.rotationDeg ?? { x: 0, y: 20, z: 0 },
      uniformScale: 1,
    },
    productId: patch?.productId,
    variantId: patch?.variantId,
    userSizeMultiplier: patch?.userSizeMultiplier,
  };
}

function sceneWith(
  objects: readonly SceneObjectDefinition[],
  generationId = PI3A_GENERATION_A,
): LoadedSceneRow {
  return {
    found: true,
    scene: {
      roomId: PI3A_ROOM_ID,
      versionId: VERSION_ID,
      afcGenerationId: generationId,
      coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
      objects: [...objects],
    },
  };
}

async function contentTokenFor(
  patch?: Parameters<typeof source>[0],
): Promise<string> {
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source(patch));
  assert.equal(built.ok, true);
  if (!built.ok) return "";
  return built.payload.job.contentToken;
}

test("content token is stable and ignores non-pixel metadata", async () => {
  const first = await contentTokenFor({ objects: sceneWith([sceneObject()]) });
  const second = await contentTokenFor({ objects: sceneWith([sceneObject()]) });
  assert.equal(first, second);

  const sizedDefault = await contentTokenFor({
    objects: sceneWith([sceneObject({ userSizeMultiplier: AFC_V2_USER_SIZE_DEFAULT })]),
  });
  const omittedSize = await contentTokenFor({
    objects: sceneWith([sceneObject()]),
  });
  assert.equal(sizedDefault, omittedSize);

  const withCommerce = await contentTokenFor({
    objects: sceneWith([sceneObject({
      productId: "product-sofa",
      variantId: "variant-navy",
    })]),
  });
  assert.equal(withCommerce, omittedSize);

  const resigned = await contentTokenFor({
    objects: sceneWith([sceneObject()]),
    async signStorageUrl() {
      return `https://${HOST}/storage/v1/object/sign/rooms/bg.jpg?token=rotated-secret`;
    },
  });
  assert.equal(resigned, omittedSize);

  const moved = await contentTokenFor({
    objects: sceneWith([sceneObject({ position: { x: 1.5, y: 0, z: 2 } })]),
  });
  const turned = await contentTokenFor({
    objects: sceneWith([sceneObject({ rotationDeg: { x: 0, y: 35, z: 0 } })]),
  });
  const resized = await contentTokenFor({
    objects: sceneWith([sceneObject({ userSizeMultiplier: 1.25 })]),
  });
  const added = await contentTokenFor({
    objects: sceneWith([
      sceneObject(),
      sceneObject({
        objectId: "chair-1",
        assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
        position: { x: 0, y: 0, z: 1 },
        rotationDeg: { x: 0, y: 0, z: 0 },
      }),
    ]),
  });
  const removed = await contentTokenFor({
    objects: sceneWith([
      sceneObject({
        objectId: "chair-1",
        assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
        position: { x: 0, y: 0, z: 1 },
        rotationDeg: { x: 0, y: 0, z: 0 },
      }),
    ]),
  });
  const reversed = await contentTokenFor({
    objects: sceneWith([
      sceneObject({
        objectId: "chair-1",
        assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
        position: { x: 0, y: 0, z: 1 },
        rotationDeg: { x: 0, y: 0, z: 0 },
      }),
      sceneObject(),
    ]),
  });
  const nextGeneration = await contentTokenFor({
    generationId: PI3A_GENERATION_B,
    objects: sceneWith([sceneObject()], PI3A_GENERATION_B),
  });
  const nextBackground = await contentTokenFor({
    objects: sceneWith([sceneObject()]),
    async loadVersion() {
      return {
        id: VERSION_ID,
        roomId: PI3A_ROOM_ID,
        userId: USER_ID,
        imageUrl: null,
        storageBucket: "room-images",
        storagePath: "rooms/other-bg.jpg",
      };
    },
    async signStorageUrl() {
      return SIGNED_BG;
    },
  });

  const tokens = [moved, turned, resized, added, removed, reversed, nextGeneration, nextBackground];
  assert.equal(new Set([omittedSize, ...tokens]).size, tokens.length + 1);
});

test("content token uses the render-contract salt and canonical numbers", async () => {
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_ID,
  }, source({ objects: sceneWith([sceneObject()]) }));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const identity = {
    renderContract: VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION,
    roomId: built.payload.room.roomId,
    versionId: built.payload.room.versionId,
    afcGenerationId: built.payload.room.afcGenerationId,
    frame: built.payload.frame,
    camera: {
      verticalFovDeg: built.payload.camera.verticalFovDeg,
      position: built.payload.camera.position,
      lookAt: built.payload.camera.lookAt,
      up: built.payload.camera.up,
      metricScale: built.payload.camera.metricScale,
    },
    background: { bucket: "room-images", objectPath: "rooms/bg.jpg" },
    objects: built.payload.objects.map((object) => ({
      objectId: object.objectId,
      assetId: object.assetId,
      position: object.position,
      rotationDeg: object.rotationDeg,
      userSizeMultiplier: object.userSizeMultiplier,
    })),
  };
  assert.equal(built.payload.job.contentToken, thumbnailContentToken(identity));
  assert.notEqual(
    built.payload.job.contentToken,
    thumbnailContentToken({ ...identity, renderContract: "vibode-thumbnail-render/v2" }),
  );
  assert.equal(
    thumbnailContentToken({ b: 1, a: { z: 0, y: -0 } }),
    thumbnailContentToken({ a: { y: 0, z: 0 }, b: 1 }),
  );
  assert.equal(thumbnailContentToken([1, 2]), thumbnailContentToken([1, 2]));
  assert.notEqual(thumbnailContentToken([1, 2]), thumbnailContentToken([2, 1]));
  assert.throws(
    () => thumbnailContentToken({ x: Number.NaN }),
    /non-finite number/,
  );
  assert.throws(
    () => thumbnailContentToken({ x: Number.POSITIVE_INFINITY }),
    /non-finite number/,
  );
});

test("a signed history URL contributes its object path, not its token", async () => {
  const signed = `https://${HOST}/storage/v1/object/sign/room-images/rooms/legacy.jpg?token=one`;
  const rotated = `https://${HOST}/storage/v1/object/sign/room-images/rooms/legacy.jpg?token=two`;
  const version = {
    id: VERSION_ID,
    roomId: PI3A_ROOM_ID,
    userId: USER_ID,
    imageUrl: signed,
    storageBucket: null,
    storagePath: null,
  };
  const first = await contentTokenFor({
    async loadVersion() {
      return version;
    },
  });
  const second = await contentTokenFor({
    async loadVersion() {
      return { ...version, imageUrl: rotated };
    },
  });
  const otherObject = await contentTokenFor({
    async loadVersion() {
      return {
        ...version,
        imageUrl: `https://${HOST}/storage/v1/object/sign/room-images/rooms/other.jpg?token=one`,
      };
    },
  });
  assert.equal(first, second);
  assert.notEqual(first, otherObject);
});
