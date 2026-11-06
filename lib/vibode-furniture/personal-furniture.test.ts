import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { validatePersistedSceneObjects } from "@/lib/afc-v2-runtime/persisted-scene";
import { encodeUntexturedFurnitureProbeGlb } from "@/lib/afc-v2-runtime/textured-furniture-probe-glb";
import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID, type SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import { partnerIntakeRuntimeAssetId } from "@/lib/vibode-stage/partner-runtime-asset-id";
import type { RuntimeFurnitureAssetDefinition } from "@/lib/afc-v2-runtime/runtime-furniture-assets";

import {
  createPersonalFurnitureAssetId,
  isPersonalFurnitureAssetId,
  PERSONAL_FURNITURE_BUCKET,
  PERSONAL_FURNITURE_FINALIZE_LEASE_MS,
  PERSONAL_FURNITURE_GLB_MAX_BYTES,
  personalFurniturePendingPath,
  personalFurniturePermanentPath,
} from "./asset-id";
import { nextStageDrawer } from "./drawer-panel";
import {
  personalLibraryItemLeaksStorage,
  type PersonalFurnitureAssetRecord,
  type PersonalFurnitureUploadRecord,
} from "./library";
import {
  archivePersonalFurniture,
  createPersonalFurnitureUpload,
  finalizePersonalFurnitureUpload,
  listPersonalFurniture,
  personalSceneAssetsAreOwned,
  placePersonalFurniture,
} from "./operations";
import { resolveMixedSceneRuntimeAssets, resolvePersonalRuntimeAssets } from "./runtime-resolve";
import { personalSceneAssetOwnership } from "./scene-guard.server";
import type { PersonalFurnitureStore, PersonalGlbValidation, PersonalObjectStore } from "./store";
import { personalUploadClaimOutcome, personalUploadShouldExpire } from "./upload-lease";
import { validatePersonalFurnitureGlb } from "./validate.server";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SHA = "ab".repeat(32);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function object(assetId: string, objectId = "obj-1", userSizeMultiplier?: number): SceneObjectDefinition {
  return {
    objectId,
    assetId,
    transform: {
      position: { x: 1, y: 0, z: 2 },
      rotationDeg: { x: 0, y: 15, z: 0 },
      uniformScale: 1,
    },
    ...(userSizeMultiplier == null ? {} : { userSizeMultiplier }),
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

class MemoryObjects implements PersonalObjectStore {
  readonly bytes = new Map<string, Uint8Array>();
  permanentWrites = 0;
  signedGets: string[] = [];
  removed: string[] = [];

  async createPendingUploadUrl(objectPath: string) {
    return { signedUrl: `https://signed.example/upload/${encodeURIComponent(objectPath)}` };
  }

  async read(objectPath: string) {
    return this.bytes.get(objectPath) ?? null;
  }

  async writePermanent(objectPath: string, bytes: Uint8Array) {
    this.permanentWrites += 1;
    if (this.bytes.has(objectPath)) return "exists" as const;
    this.bytes.set(objectPath, bytes);
    return "written" as const;
  }

  async remove(objectPath: string) {
    this.removed.push(objectPath);
    this.bytes.delete(objectPath);
  }

  async signGet(objectPath: string) {
    this.signedGets.push(objectPath);
    return {
      signedUrl: `https://signed.example/get?object=${encodeURIComponent(objectPath)}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  }
}

class MemoryRecords implements PersonalFurnitureStore {
  assets: Mutable<PersonalFurnitureAssetRecord>[] = [];
  uploads: Mutable<PersonalFurnitureUploadRecord>[] = [];

  async countOpenUploads(userId: string, nowIso: string) {
    return this.uploads.filter((upload) =>
      upload.userId === userId &&
      upload.status === "pending" &&
      upload.expiresAt > nowIso
    ).length;
  }

  async expireUploads(userId: string, nowIso: string) {
    const paths: string[] = [];
    this.uploads = this.uploads.map((upload) => {
      if (upload.userId === userId && personalUploadShouldExpire(upload, nowIso)) {
        paths.push(upload.pendingObjectPath);
        return { ...upload, status: "expired" as const };
      }
      return upload;
    });
    return paths;
  }

  async insertUpload(upload: PersonalFurnitureUploadRecord) {
    this.uploads.push({ ...upload });
  }

  async readUpload(userId: string, uploadId: string) {
    return this.uploads.find((upload) => upload.userId === userId && upload.uploadId === uploadId) ?? null;
  }

  async claimUpload(userId: string, uploadId: string, nowIso: string) {
    const upload = this.uploads.find((item) => item.userId === userId && item.uploadId === uploadId);
    const outcome = personalUploadClaimOutcome(upload ?? null, nowIso);
    if (outcome === "claim" && upload) {
      upload.status = "finalizing";
      upload.updatedAt = nowIso;
      return upload;
    }
    if (outcome === "lost") return "lost" as const;
    return null;
  }

  async markUploadFinalized(userId: string, uploadId: string, resultAssetId: string) {
    const upload = this.uploads.find((item) => item.userId === userId && item.uploadId === uploadId);
    if (!upload || upload.status !== "finalizing") return;
    upload.status = "finalized";
    upload.resultAssetId = resultAssetId;
  }

  async markUploadRejected(userId: string, uploadId: string) {
    const upload = this.uploads.find((item) => item.userId === userId && item.uploadId === uploadId);
    if (!upload || (upload.status !== "pending" && upload.status !== "finalizing")) return;
    upload.status = "rejected";
  }

  async findAssetBySha(userId: string, sha256: string) {
    return this.assets.find((item) => item.userId === userId && item.sha256 === sha256) ?? null;
  }

  async findOwnedAsset(userId: string, assetId: string) {
    return this.assets.find((item) => item.userId === userId && item.assetId === assetId) ?? null;
  }

  async insertAsset(next: PersonalFurnitureAssetRecord) {
    if (this.assets.some((item) => item.assetId === next.assetId || (item.userId === next.userId && item.sha256 === next.sha256))) {
      return "exists" as const;
    }
    this.assets.push({ ...next });
    return "inserted" as const;
  }

  async listActive(userId: string) {
    return this.assets.filter((item) => item.userId === userId && item.libraryVisibility === "active");
  }

  async archiveAsset(userId: string, assetId: string) {
    const item = this.assets.find((asset) => asset.userId === userId && asset.assetId === assetId);
    if (!item) return "missing" as const;
    item.libraryVisibility = "archived";
    return "archived" as const;
  }

  async ownedAssetIds(userId: string, assetIds: readonly string[]) {
    return new Set(this.assets
      .filter((item) => item.userId === userId && assetIds.includes(item.assetId))
      .map((item) => item.assetId));
  }
}

function measured(bytes: Uint8Array): PersonalGlbValidation {
  return {
    accepted: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
    widthM: 1.2,
    heightM: 0.8,
    depthM: 0.6,
    errors: [],
  };
}

function accepted(bytes: Uint8Array): PersonalGlbValidation {
  return {
    accepted: true,
    sha256: SHA,
    byteSize: bytes.byteLength,
    widthM: 1.2,
    heightM: 0.8,
    depthM: 0.6,
    errors: [],
  };
}

test("personal asset ids stay out of the static and partner namespaces", () => {
  const id = createPersonalFurnitureAssetId("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA");
  assert.equal(id, "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(isPersonalFurnitureAssetId(id!), true);
  assert.equal(isPersonalFurnitureAssetId(AFC_V2_RUNTIME_FURNITURE_ASSET_ID), false);
  assert.equal(isPersonalFurnitureAssetId(partnerIntakeRuntimeAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!), false);
  assert.equal(createPersonalFurnitureAssetId("not-a-uuid"), null);
  assert.equal(personalFurniturePermanentPath("../other", id!), null);
  assert.equal(
    personalFurniturePermanentPath(USER_A, id!),
    `users/${USER_A}/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/model.glb`,
  );
  assert.equal(PERSONAL_FURNITURE_GLB_MAX_BYTES, 25 * 1024 * 1024);
});

test("the shared drawer switches panels without an undo or selection action", () => {
  assert.deepEqual(nextStageDrawer({
    open: false,
    pinned: false,
    panel: "catalog",
    target: "furniture",
  }), { open: true, pinned: false, panel: "furniture" });
  assert.deepEqual(nextStageDrawer({
    open: true,
    pinned: true,
    panel: "catalog",
    target: "furniture",
  }), { open: true, pinned: true, panel: "furniture" });
  assert.deepEqual(nextStageDrawer({
    open: true,
    pinned: true,
    panel: "furniture",
    target: "furniture",
  }), { open: false, pinned: false, panel: "furniture" });
  const context = source("components/stage/StageEditorContext.tsx");
  const toggle = context.slice(
    context.indexOf("const toggleFurniture"),
    context.indexOf("const pinCatalog"),
  );
  assert.doesNotMatch(toggle, /undo\(|setSelection|setRoomScaleMultiplier/);
  const header = source("components/stage/StageEditorHeader.tsx");
  assert.ok(header.indexOf('aria-label="Catalog"') < header.indexOf('aria-label="My Furniture"'));
  assert.ok(header.indexOf('aria-label="My Furniture"') < header.indexOf("overflow-x-auto"));
  assert.match(header, /<RoomScaleControl \/>[\s\S]*aria-label="Undo"/);
  assert.match(header, /<RemoveAlignmentControl blocked=\{bringForwardEditing\} \/>\s*<BringForwardControl \/>\s*<HarmonizeButton \/>/);
});

test("an owner can upload, list, place, reuse, and archive without exposing storage", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const uploadId = "33333333-3333-4333-8333-333333333333";
  const assetId = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  const created = await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId,
    assetId,
    now,
    store: records,
    objects,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal("storageObjectPath" in created, false);
  const pending = personalFurniturePendingPath(USER_A, uploadId)!;
  const bytes = new Uint8Array([1, 2, 3, 4]);
  objects.bytes.set(pending, bytes);
  const saved = await finalizePersonalFurnitureUpload({
    userId: USER_A,
    uploadId,
    displayName: "  Blue   chair ",
    category: " Seating ",
    now,
    store: records,
    objects,
    validate: async (input) => accepted(input.bytes),
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.idempotent, false);
  assert.equal(saved.item.displayName, "Blue chair");
  assert.equal(saved.item.category, "Seating");
  assert.equal(personalLibraryItemLeaksStorage(saved.item), false);
  assert.equal(objects.permanentWrites, 1);
  const again = await finalizePersonalFurnitureUpload({
    userId: USER_A,
    uploadId,
    displayName: "Blue chair",
    now,
    store: records,
    objects,
    validate: async () => { throw new Error("validator must not run again"); },
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.idempotent, true);
  assert.equal(again.item.assetId, assetId);
  assert.equal(objects.permanentWrites, 1);
  const listed = await listPersonalFurniture({ userId: USER_A, store: records, objects });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.assetId, assetId);
  const hidden = await listPersonalFurniture({ userId: USER_B, store: records, objects });
  assert.deepEqual(hidden, []);
  const placed = await placePersonalFurniture({
    userId: USER_A,
    assetId,
    store: records,
    objects,
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.equal(placed.runtimeAsset.assetId, assetId);
  assert.equal("productId" in placed.runtimeAsset, false);
  const roomOne = [object(assetId, "obj-1", 1.25)];
  const roomTwo = [object(assetId, "obj-2", 0.75)];
  assert.equal(roomOne[0]?.assetId, roomTwo[0]?.assetId);
  assert.equal(await personalSceneAssetsAreOwned({ userId: USER_A, objects: roomOne, store: records }), "owned");
  assert.equal(await personalSceneAssetsAreOwned({ userId: USER_A, objects: roomTwo, store: records }), "owned");
  const persisted = validatePersistedSceneObjects(roomOne);
  assert.equal(persisted.ok, true);
  if (!persisted.ok) return;
  assert.equal(persisted.objects[0]?.userSizeMultiplier, 1.25);
  assert.equal(persisted.objects[0]?.productId, undefined);
  const json = JSON.stringify(persisted.objects);
  assert.doesNotMatch(json, /signedUrl|storageObjectPath|storageBucket|sha256|service_role/);
  const archived = await archivePersonalFurniture({ userId: USER_A, assetId, store: records });
  assert.equal(archived.ok, true);
  assert.deepEqual(await listPersonalFurniture({ userId: USER_A, store: records, objects }), []);
  assert.equal(await personalSceneAssetsAreOwned({ userId: USER_A, objects: roomOne, store: records }), "owned");
  const archivedPlace = await placePersonalFurniture({ userId: USER_A, assetId, store: records, objects });
  assert.equal(archivedPlace.ok, false);
});

test("another user, an abandoned upload, and a bad file cannot take the model", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const assetId = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  const uploadId = "33333333-3333-4333-8333-333333333333";
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId,
    assetId,
    now,
    store: records,
    objects,
  });
  const stolen = await finalizePersonalFurnitureUpload({
    userId: USER_B,
    uploadId,
    displayName: "Stolen",
    now,
    store: records,
    objects,
    validate: async (input) => accepted(input.bytes),
  });
  assert.equal(stolen.ok, false);
  if (stolen.ok) return;
  assert.equal(stolen.status, 404);
  assert.equal(objects.permanentWrites, 0);
  const pending = personalFurniturePendingPath(USER_A, uploadId)!;
  objects.bytes.set(pending, new Uint8Array(PERSONAL_FURNITURE_GLB_MAX_BYTES + 1));
  const oversized = await finalizePersonalFurnitureUpload({
    userId: USER_A,
    uploadId,
    displayName: "Too big",
    now,
    store: records,
    objects,
    validate: async () => { throw new Error("oversized bytes must not be parsed"); },
  });
  assert.equal(oversized.ok, false);
  if (oversized.ok) return;
  assert.equal(oversized.status, 413);
  assert.equal(objects.bytes.has(pending), false);

  const secondUpload = "44444444-4444-4444-8444-444444444444";
  const secondAsset = createPersonalFurnitureAssetId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId: secondUpload,
    assetId: secondAsset,
    now,
    store: records,
    objects,
  });
  const secondPending = personalFurniturePendingPath(USER_A, secondUpload)!;
  objects.bytes.set(secondPending, new Uint8Array([9]));
  const invalid = await finalizePersonalFurnitureUpload({
    userId: USER_A,
    uploadId: secondUpload,
    displayName: "Bad",
    now,
    store: records,
    objects,
    validate: async () => ({
      accepted: false,
      sha256: SHA,
      byteSize: 1,
      widthM: null,
      heightM: null,
      depthM: null,
      errors: [{ code: "MALFORMED_GLB", message: "bad" }],
    }),
  });
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.errorCode, "INVALID_GLB");
  assert.equal(objects.permanentWrites, 0);
  const archived = await archivePersonalFurniture({ userId: USER_B, assetId, store: records });
  assert.equal(archived.ok, false);
  const placed = await placePersonalFurniture({ userId: USER_B, assetId, store: records, objects });
  assert.equal(placed.ok, false);
  assert.equal(objects.signedGets.length, 0);
});

test("the same bytes finalize once and a foreign scene id is not signed", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const firstAsset = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  const firstUpload = "33333333-3333-4333-8333-333333333333";
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId: firstUpload,
    assetId: firstAsset,
    now,
    store: records,
    objects,
  });
  objects.bytes.set(personalFurniturePendingPath(USER_A, firstUpload)!, new Uint8Array([4, 5]));
  const first = await finalizePersonalFurnitureUpload({
    userId: USER_A,
    uploadId: firstUpload,
    displayName: "Chair",
    now,
    store: records,
    objects,
    validate: async (input) => accepted(input.bytes),
  });
  assert.equal(first.ok, true);
  const secondAsset = createPersonalFurnitureAssetId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
  const secondUpload = "44444444-4444-4444-8444-444444444444";
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId: secondUpload,
    assetId: secondAsset,
    now,
    store: records,
    objects,
  });
  objects.bytes.set(personalFurniturePendingPath(USER_A, secondUpload)!, new Uint8Array([4, 5]));
  const duplicate = await finalizePersonalFurnitureUpload({
    userId: USER_A,
    uploadId: secondUpload,
    displayName: "Chair again",
    now,
    store: records,
    objects,
    validate: async (input) => accepted(input.bytes),
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.item.assetId, firstAsset);
  assert.equal(objects.permanentWrites, 1);
  assert.equal(records.assets.length, 1);

  const signed: string[] = [];
  const resolved = await resolvePersonalRuntimeAssets({
    assetIds: [firstAsset],
    ownerUserId: USER_B,
    lookupPersonalAssets: async () => [{
      assetId: firstAsset,
      userId: USER_A,
      authoredWidthM: 1,
      authoredHeightM: 1,
      authoredDepthM: 1,
      storageBucket: PERSONAL_FURNITURE_BUCKET,
      storageObjectPath: personalFurniturePermanentPath(USER_A, firstAsset)!,
    }],
    mintSignedGet: async (row) => {
      signed.push(row.storageObjectPath);
      return { ok: true, signedUrl: "https://signed.example/nope", expiresAt: "2030-01-01T00:00:00.000Z" };
    },
  });
  assert.equal(resolved.assetDefinitions.length, 0);
  assert.equal(resolved.assetIssues[0]?.code, "RUNTIME_ASSET_NOT_FOUND");
  assert.deepEqual(signed, []);
  assert.equal(await personalSceneAssetsAreOwned({
    userId: USER_B,
    objects: [object(firstAsset)],
    store: records,
  }), "foreign");
});

test("runtime resolution keeps partner lookup away from personal ids and signs the owner", async () => {
  const personalId = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  const partnerId = partnerIntakeRuntimeAssetId("cccccccc-cccc-4ccc-8ccc-cccccccccccc")!;
  const partnerLookups: string[][] = [];
  const personalOwners: string[] = [];
  const mixed = await resolveMixedSceneRuntimeAssets({
    assetIds: [AFC_V2_RUNTIME_FURNITURE_ASSET_ID, partnerId, personalId],
    ownerUserId: USER_A,
    lookupDynamicAssets: async (ids) => {
      partnerLookups.push([...ids]);
      return [{
        assetId: partnerId,
        status: "ready",
        source: "partner_intake",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        storageBucket: "partner-private",
        storageObjectPath: "partner/chair.glb",
      }];
    },
    lookupPersonalAssets: async (ids, ownerUserId) => {
      personalOwners.push(ownerUserId);
      assert.deepEqual(ids, [personalId]);
      return [{
        assetId: personalId,
        userId: ownerUserId,
        authoredWidthM: 1.2,
        authoredHeightM: 0.8,
        authoredDepthM: 0.6,
        storageBucket: PERSONAL_FURNITURE_BUCKET,
        storageObjectPath: personalFurniturePermanentPath(ownerUserId, personalId)!,
      }];
    },
    mintSignedGet: async (row) => ({
      ok: true,
      signedUrl: `https://signed.example/${row.storageBucket}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
    }),
  });
  assert.equal(partnerLookups.some((ids) => ids.includes(personalId)), false);
  assert.deepEqual(personalOwners, [USER_A]);
  assert.equal(mixed.assetDefinitions.some((item) => item.assetId === personalId), true);
  assert.equal(mixed.assetDefinitions.some((item) => item.assetId === partnerId), true);
  const personal = mixed.assetDefinitions.find((item) => item.assetId === personalId) as RuntimeFurnitureAssetDefinition;
  assert.equal(JSON.stringify(personal).includes("storageObjectPath"), false);
  const lookup = source("lib/vibode-furniture/furniture-store.server.ts");
  const lookupFn = lookup.slice(
    lookup.indexOf("export async function lookupPersonalFurnitureRuntimeRows"),
    lookup.indexOf("function createRecordStore"),
  );
  assert.doesNotMatch(lookupFn, /library_visibility/);
  assert.match(lookup, /library_visibility", "active"/);
});

test("scene ownership fails closed and does not query when no personal id is present", async () => {
  let queries = 0;
  const supabase = {
    from() {
      queries += 1;
      return {
        select() {
          return {
            eq(_column: string, userId: string) {
              return {
                async in() {
                  return {
                    data: userId === USER_A ? [{ asset_id: createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") }] : [],
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const personalId = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  assert.equal(await personalSceneAssetOwnership(supabase as never, USER_A, [object(AFC_V2_RUNTIME_FURNITURE_ASSET_ID)]), "empty");
  assert.equal(queries, 0);
  assert.equal(await personalSceneAssetOwnership(supabase as never, USER_A, [object(personalId)]), "owned");
  assert.equal(await personalSceneAssetOwnership(supabase as never, USER_B, [object(personalId)]), "foreign");
  const save = source("lib/afc-v2-runtime/scene-persistence.server.ts");
  const saveFn = save.slice(save.indexOf("export async function saveOwnedVersionScene"));
  assert.ok(saveFn.indexOf("harmonizeOutputGuard") < saveFn.indexOf("personalSceneAssetOwnership"));
  assert.match(saveFn, /This furniture model is not available/);
});

test("measured GLB validation accepts a metre box and rejects a malformed file", async () => {
  const assetId = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  const bytes = encodeUntexturedFurnitureProbeGlb();
  const accepted = await validatePersonalFurnitureGlb({ bytes, assetId });
  assert.equal(accepted.accepted, true);
  assert.ok(accepted.widthM && accepted.widthM >= 0.05 && accepted.widthM <= 8);
  assert.equal(accepted.sha256.length, 64);
  const rejected = await validatePersonalFurnitureGlb({
    bytes: new Uint8Array([1, 2, 3, 4]),
    assetId,
  });
  assert.equal(rejected.accepted, false);
});

test("STAGE wiring keeps commercial placement and authorizes personal resolution", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const add = viewer.slice(viewer.indexOf("addSceneObject: (assetId"), viewer.indexOf("duplicateSceneObject:"));
  assert.ok(add.indexOf("furnitureAssetDefinition(assetId)") < add.indexOf("isPersonalFurnitureAssetId(assetId)"));
  assert.ok(add.indexOf("isPersonalFurnitureAssetId(assetId)") < add.indexOf("identity?.productId"));
  assert.match(add, /ensureCommercialPlacementRef/);
  assert.doesNotMatch(add, /RUNTIME_ASSET_RESOLVE_PATH|refreshRuntimeAssetRef/);
  const context = source("components/stage/StageEditorContext.tsx");
  assert.ok(context.indexOf("const pasteProductLink") < context.indexOf("const addPersonalAssetToRoom"));
  assert.match(source("components/stage/StageCatalogDrawer.tsx"), /data-stage-catalog-scroller="true"/);
  assert.match(source("app/api/vibode/3d-scene/route.ts"), /enrichOwnedSceneRuntimeAssets\(resolved\.scene\.objects, auth\.userId\)/);
  const resolve = source("app/api/vibode/runtime/assets/resolve/route.ts");
  assert.ok(resolve.indexOf("authorizeProductionAfcUser") < resolve.indexOf("await resolveMixedSceneRuntimeAssets"));
  assert.match(resolve, /ownerUserId: auth\.userId/);
  const place = source("app/api/vibode/furniture-assets/place/route.ts");
  assert.ok(place.indexOf("authorizeProductionAfcUser") < place.indexOf("await placePersonalFurniture"));
  assert.match(place, /authorizeOwnedVersionScene/);
  assert.doesNotMatch(place, /objects_json|upsert\(/);
  for (const file of [
    "app/api/vibode/furniture-assets/route.ts",
    "app/api/vibode/furniture-assets/uploads/route.ts",
    "app/api/vibode/furniture-assets/archive/route.ts",
  ]) {
    const route = source(file);
    assert.ok(route.indexOf("authorizeProductionAfcUser") < route.indexOf("personalFurnitureServices()"), file);
  }
  const generator = source("components/stage/StageMyFurniturePanel.tsx");
  assert.match(generator, /3D Furniture Generator — Coming Soon/);
  assert.doesNotMatch(generator, /meshy|Generate</i);
  assert.match(source("lib/vibode-thumbnail-render/payload.server.ts"), /room\?\.userId/);
  const migration = source("supabase/migrations/20261105180000_vibode_furniture_assets.sql");
  assert.doesNotMatch(migration, /vibode_furniture_assets_no_delete/);
  assert.match(migration, /on delete cascade/);
  assert.match(source("app/api/admin/delete-user/route.ts"), /vibode-furniture-assets/);
});

async function reserveUpload(records: MemoryRecords, objects: MemoryObjects, now: Date) {
  const assetId = createPersonalFurnitureAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
  const uploadId = "33333333-3333-4333-8333-333333333333";
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId,
    assetId,
    now,
    store: records,
    objects,
  });
  const pending = personalFurniturePendingPath(USER_A, uploadId)!;
  const bytes = new Uint8Array([7, 8, 9, 10]);
  objects.bytes.set(pending, bytes);
  return {
    assetId,
    uploadId,
    pending,
    bytes,
    permanent: personalFurniturePermanentPath(USER_A, assetId)!,
  };
}

function finalizeReserved(args: {
  records: MemoryRecords;
  objects: MemoryObjects;
  now: Date;
  uploadId: string;
  userId?: string;
}) {
  return finalizePersonalFurnitureUpload({
    userId: args.userId ?? USER_A,
    uploadId: args.uploadId,
    displayName: "Chair",
    now: args.now,
    store: args.records,
    objects: args.objects,
    validate: async (input) => measured(input.bytes),
  });
}

test("a crash before the permanent object is recovered after the finalize lease", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  const original = objects.writePermanent.bind(objects);
  let attempts = 0;
  objects.writePermanent = async (path, bytes) => {
    attempts += 1;
    if (attempts === 1) throw new Error("crashed before permanent object");
    return original(path, bytes);
  };
  await assert.rejects(() => finalizeReserved({ records, objects, now, uploadId: reserved.uploadId }));
  assert.equal(records.assets.length, 0);
  assert.equal(objects.bytes.has(reserved.permanent), false);
  const immediate = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(immediate.ok, false);
  if (immediate.ok) return;
  assert.equal(immediate.errorCode, "UPLOAD_IN_PROGRESS");
  assert.equal(attempts, 1);
  const later = new Date(now.getTime() + PERSONAL_FURNITURE_FINALIZE_LEASE_MS + 1);
  const recovered = await finalizeReserved({ records, objects, now: later, uploadId: reserved.uploadId });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.idempotent, false);
  assert.equal(recovered.item.assetId, reserved.assetId);
  assert.equal(records.assets.length, 1);
  assert.equal(attempts, 2);
  const repeat = await finalizeReserved({ records, objects, now: later, uploadId: reserved.uploadId });
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(repeat.idempotent, true);
  assert.equal(records.assets.length, 1);
});

test("a crash after the permanent object adopts those bytes and does not overwrite them", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  const originalInsert = records.insertAsset.bind(records);
  let inserts = 0;
  records.insertAsset = async (asset) => {
    inserts += 1;
    if (inserts === 1) throw new Error("crashed before asset row");
    return originalInsert(asset);
  };
  await assert.rejects(() => finalizeReserved({ records, objects, now, uploadId: reserved.uploadId }));
  const frozen = objects.bytes.get(reserved.permanent);
  assert.ok(frozen);
  const copy = new Uint8Array(frozen);
  assert.equal(records.assets.length, 0);
  const immediate = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(immediate.ok, false);
  if (immediate.ok) return;
  assert.equal(immediate.errorCode, "UPLOAD_IN_PROGRESS");
  assert.deepEqual(objects.bytes.get(reserved.permanent), copy);
  const later = new Date(now.getTime() + PERSONAL_FURNITURE_FINALIZE_LEASE_MS + 1);
  const stranger = await finalizeReserved({
    records,
    objects,
    now: later,
    uploadId: reserved.uploadId,
    userId: USER_B,
  });
  assert.equal(stranger.ok, false);
  if (stranger.ok) return;
  assert.equal(stranger.status, 404);
  const recovered = await finalizeReserved({ records, objects, now: later, uploadId: reserved.uploadId });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.item.assetId, reserved.assetId);
  assert.equal(records.assets.length, 1);
  assert.deepEqual(objects.bytes.get(reserved.permanent), copy);
  assert.equal(records.assets[0]?.sha256, measured(copy).sha256);
});

test("a crash after the asset row is saved returns that same record", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  const original = records.markUploadFinalized.bind(records);
  let marks = 0;
  records.markUploadFinalized = async (userId, uploadId, resultAssetId) => {
    marks += 1;
    if (marks === 1) throw new Error("crashed before upload ack");
    return original(userId, uploadId, resultAssetId);
  };
  await assert.rejects(() => finalizeReserved({ records, objects, now, uploadId: reserved.uploadId }));
  assert.equal(records.assets.length, 1);
  assert.equal(records.uploads[0]?.status, "finalizing");
  assert.equal(objects.permanentWrites, 1);
  const recovered = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.idempotent, true);
  assert.equal(recovered.item.assetId, reserved.assetId);
  assert.equal(records.assets.length, 1);
  assert.equal(objects.permanentWrites, 1);
  assert.equal(records.uploads[0]?.status, "finalized");
});

test("a crash after database finalization retries the same saved model", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  const original = objects.signGet.bind(objects);
  let signs = 0;
  objects.signGet = async (path) => {
    signs += 1;
    if (signs === 1) throw new Error("response dropped");
    return original(path);
  };
  await assert.rejects(() => finalizeReserved({ records, objects, now, uploadId: reserved.uploadId }));
  assert.equal(records.uploads[0]?.status, "finalized");
  assert.equal(records.uploads[0]?.resultAssetId, reserved.assetId);
  const recovered = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.idempotent, true);
  assert.equal(recovered.item.assetId, reserved.assetId);
  assert.equal(records.assets.length, 1);
  assert.equal(objects.permanentWrites, 1);
});

test("a concurrent finalize cannot write a second object or cross users", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  const original = objects.writePermanent.bind(objects);
  let entered = false;
  objects.writePermanent = async (path, bytes) => {
    if (!entered) {
      entered = true;
      const concurrent = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
      assert.equal(concurrent.ok, false);
      if (!concurrent.ok) assert.equal(concurrent.errorCode, "UPLOAD_IN_PROGRESS");
      const stranger = await finalizeReserved({
        records,
        objects,
        now,
        uploadId: reserved.uploadId,
        userId: USER_B,
      });
      assert.equal(stranger.ok, false);
      if (!stranger.ok) assert.equal(stranger.status, 404);
    }
    return original(path, bytes);
  };
  const first = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.idempotent, false);
  assert.equal(records.assets.length, 1);
  assert.equal(objects.permanentWrites, 1);
  const repeat = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(repeat.idempotent, true);
  assert.equal(objects.permanentWrites, 1);
});

test("cleanup does not take an active finalize and removes an abandoned upload", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  const upload = records.uploads[0];
  assert.ok(upload);
  upload.status = "finalizing";
  upload.updatedAt = now.toISOString();
  upload.expiresAt = new Date(now.getTime() - 1000).toISOString();
  objects.bytes.set(reserved.permanent, new Uint8Array([1, 2, 3]));
  const held = await records.expireUploads(USER_A, now.toISOString());
  assert.deepEqual(held, []);
  assert.equal(upload.status, "finalizing");
  assert.equal(objects.bytes.has(reserved.pending), true);
  assert.deepEqual(objects.bytes.get(reserved.permanent), new Uint8Array([1, 2, 3]));

  upload.updatedAt = new Date(now.getTime() - PERSONAL_FURNITURE_FINALIZE_LEASE_MS - 1).toISOString();
  const nextUpload = "44444444-4444-4444-8444-444444444444";
  const nextAsset = createPersonalFurnitureAssetId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId: nextUpload,
    assetId: nextAsset,
    now,
    store: records,
    objects,
  });
  assert.equal(objects.bytes.has(reserved.pending), false);
  assert.deepEqual(objects.bytes.get(reserved.permanent), new Uint8Array([1, 2, 3]));
  assert.equal(records.uploads.find((item) => item.uploadId === reserved.uploadId)?.status, "expired");

  const abandoned = records.uploads.find((item) => item.uploadId === nextUpload);
  assert.ok(abandoned);
  objects.bytes.set(abandoned.pendingObjectPath, new Uint8Array([4]));
  abandoned.expiresAt = new Date(now.getTime() - 1000).toISOString();
  const thirdUpload = "55555555-5555-4555-8555-555555555555";
  const thirdAsset = createPersonalFurnitureAssetId("cccccccc-cccc-4ccc-8ccc-cccccccccccc")!;
  await createPersonalFurnitureUpload({
    userId: USER_A,
    uploadId: thirdUpload,
    assetId: thirdAsset,
    now,
    store: records,
    objects,
  });
  assert.equal(objects.bytes.has(abandoned.pendingObjectPath), false);
  assert.deepEqual(objects.bytes.get(reserved.permanent), new Uint8Array([1, 2, 3]));
  assert.equal(records.assets.length, 0);
});

test("an unreferenced permanent object is replaced and a saved asset is not", async () => {
  const records = new MemoryRecords();
  const objects = new MemoryObjects();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const reserved = await reserveUpload(records, objects, now);
  objects.bytes.set(reserved.permanent, new Uint8Array([9, 9, 9]));
  const result = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.idempotent, false);
  assert.deepEqual(objects.bytes.get(reserved.permanent), reserved.bytes);
  assert.equal(records.assets.length, 1);
  const saved = new Uint8Array(objects.bytes.get(reserved.permanent)!);
  const repeat = await finalizeReserved({ records, objects, now, uploadId: reserved.uploadId });
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(repeat.idempotent, true);
  assert.deepEqual(objects.bytes.get(reserved.permanent), saved);
  assert.equal(objects.permanentWrites, 2);
});
