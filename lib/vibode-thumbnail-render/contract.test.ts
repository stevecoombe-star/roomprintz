import assert from "node:assert/strict";
import test from "node:test";

import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { PI4C_MAX_SCENE_OBJECTS } from "@/lib/afc-v2-runtime/persisted-scene";
import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
} from "@/lib/afc-v2-runtime/types";

import {
  validateVibodeThumbnailRenderPayload,
  VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC,
  type ThumbnailRenderUrlPolicy,
  type VibodeThumbnailRenderPayload,
} from "./contract";
import {
  VIBODE_PRODUCTION_AMBIENT_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_POSITION,
} from "./still-renderer";

const POLICY: ThumbnailRenderUrlPolicy = { supabaseHost: "project.supabase.co" };
const JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function payload(
  patch?: (draft: VibodeThumbnailRenderPayload) => VibodeThumbnailRenderPayload,
): VibodeThumbnailRenderPayload {
  const asset = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.ok(asset);
  const draft: VibodeThumbnailRenderPayload = {
    schemaVersion: "vibode-thumbnail-render/v1",
    job: {
      jobId: JOB_ID,
      contentToken: "a".repeat(64),
    },
    room: {
      roomId: ROOM_ID,
      versionId: VERSION_ID,
      afcGenerationId: GENERATION_ID,
    },
    frame: { width: 1200, height: 800 },
    background: {
      url: "https://project.supabase.co/storage/v1/object/sign/room/bg.jpg?token=abc",
    },
    camera: {
      verticalFovDeg: 52,
      position: { x: 0, y: 1.6, z: 4 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      metricScale: 1,
      near: AFC_V2_RUNTIME_CAMERA_NEAR,
      far: AFC_V2_RUNTIME_CAMERA_FAR,
    },
    objects: [{
      objectId: "sofa-1",
      assetId: asset.assetId,
      glbUrl: asset.glbUrl,
      position: { x: 1, y: 0, z: 1 },
      rotationDeg: { x: 0, y: 15, z: 0 },
      userSizeMultiplier: 1,
    }],
    lighting: {
      ambientIntensity: VIBODE_PRODUCTION_AMBIENT_INTENSITY,
      directionalIntensity: VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
      directionalPosition: { ...VIBODE_PRODUCTION_DIRECTIONAL_POSITION },
    },
  };
  return patch ? patch(draft) : draft;
}

test("thumbnail asset URL lifetime is fifteen minutes", () => {
  assert.equal(VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC, 15 * 60);
});

test("valid thumbnail render payload is accepted", () => {
  const result = validateVibodeThumbnailRenderPayload(payload(), POLICY);
  assert.equal(result.ok, true);
});

test("bad frame values are rejected", () => {
  assert.equal(validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    frame: { width: 0, height: 800 },
  })), POLICY).ok, false);
  assert.equal(validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    frame: { width: 9000, height: 800 },
  })), POLICY).ok, false);
});

test("bad camera values are rejected", () => {
  assert.equal(validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    camera: { ...draft.camera, verticalFovDeg: Number.NaN },
  })), POLICY).ok, false);
  assert.equal(validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    camera: {
      ...draft.camera,
      position: { x: 0, y: 0, z: 0 },
      lookAt: { x: 0, y: 0, z: 0 },
    },
  })), POLICY).ok, false);
});

test("more than 32 objects are rejected", () => {
  const asset = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.ok(asset);
  const objects = Array.from({ length: PI4C_MAX_SCENE_OBJECTS + 1 }, (_, index) => ({
    objectId: `object-${index}`,
    assetId: asset.assetId,
    glbUrl: asset.glbUrl,
    position: { x: index, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    userSizeMultiplier: 1,
  }));
  const result = validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    objects,
  })), POLICY);
  assert.equal(result.ok, false);
});

test("invalid transforms and user size are rejected", () => {
  const transform = validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    objects: [{
      ...draft.objects[0],
      position: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
    }],
  })), POLICY);
  assert.equal(transform.ok, false);
  const size = validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    objects: [{
      ...draft.objects[0],
      userSizeMultiplier: 3,
    }],
  })), POLICY);
  assert.equal(size.ok, false);
});

test("caller-chosen GLB URLs are rejected", () => {
  const result = validateVibodeThumbnailRenderPayload(payload((draft) => ({
    ...draft,
    objects: [{
      ...draft.objects[0],
      glbUrl: "https://evil.example/sofa.glb",
    }],
  })), POLICY);
  assert.equal(result.ok, false);
});
