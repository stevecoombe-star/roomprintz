import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { detectStillMagic } from "@/lib/stillImageKind";
import { MAX_OUTPUT_BYTES } from "@/lib/prepareRoomImageForUpload";
import { FIRST_GENERATION_JPEG_MAX_BYTES } from "@/lib/vibode-furniture/generation/transport";

import {
  abandonPhotoPreparation,
  beginPhotoPreparation,
  completePhotoPreparation,
  PHOTO_PREPARATION_MESSAGES,
  type PhotoPreparationDeps,
  type PhotoPurpose,
} from "./handler";
import {
  PHOTO_PREPARATION_DIRECT_MAX_BYTES,
  PHOTO_PREPARATION_MAX_INPUT_BYTES,
  VERCEL_FUNCTION_BODY_MAX_BYTES,
  photoPreparationPathOwnedBy,
} from "./limits";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PREP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-11-18T20:00:00.000Z");

function heicHeader(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  return bytes;
}

function pathFor(userId: string, preparationId = PREP): string {
  return `users/${userId}/preparations/${preparationId}/source.heic`;
}

function deps(overrides: Partial<PhotoPreparationDeps> = {}): PhotoPreparationDeps & {
  removed: string[];
  finished: number;
} {
  const removed: string[] = [];
  const state = {
    removed,
    finished: 0,
    ...overrides,
  };
  const base: PhotoPreparationDeps = {
    now: () => NOW,
    authorize: async (_request, purpose) => {
      if (purpose === "furniture") return { ok: false, status: 403, error: "Not approved." };
      return { ok: true, userId: USER };
    },
    sweep: async () => [],
    removeObject: async (objectPath) => {
      removed.push(objectPath);
    },
    begin: async () => ({ ok: true, preparationId: PREP, objectPath: pathFor(USER) }),
    signUpload: async () => ({ signedUrl: "https://storage.example/upload?token=scoped" }),
    close: async () => ({ ok: true, objectPath: pathFor(USER) }),
    claim: async () => ({
      ok: true,
      objectPath: pathFor(USER),
      byteSize: PHOTO_PREPARATION_DIRECT_MAX_BYTES + 1,
      purpose: "room" as const,
    }),
    download: async () => {
      const bytes = new Uint8Array(PHOTO_PREPARATION_DIRECT_MAX_BYTES + 1);
      bytes.set(heicHeader());
      return bytes;
    },
    convert: async () => ({ bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) }),
    finish: async () => {
      state.finished += 1;
      return { ok: true, objectPath: pathFor(USER) };
    },
    outputLimit: (purpose: PhotoPurpose) => purpose === "room" ? MAX_OUTPUT_BYTES : FIRST_GENERATION_JPEG_MAX_BYTES,
  };
  return Object.assign(state, base, overrides, { removed, finished: state.finished });
}

function beginRequest(body: Record<string, unknown>, token = "owner"): Request {
  return new Request("https://vibode.test/api/vibode/photo-preparations", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("direct and normalized payloads stay inside the Vercel function ceiling", () => {
  assert.ok(PHOTO_PREPARATION_DIRECT_MAX_BYTES + 200_000 < VERCEL_FUNCTION_BODY_MAX_BYTES);
  assert.ok(MAX_OUTPUT_BYTES < VERCEL_FUNCTION_BODY_MAX_BYTES);
  assert.ok(FIRST_GENERATION_JPEG_MAX_BYTES < VERCEL_FUNCTION_BODY_MAX_BYTES);
  assert.equal(PHOTO_PREPARATION_MAX_INPUT_BYTES, 25 * 1024 * 1024);
  assert.equal(photoPreparationPathOwnedBy(pathFor(USER), USER), true);
  assert.equal(photoPreparationPathOwnedBy(pathFor(USER), OTHER), false);
  assert.equal(photoPreparationPathOwnedBy(`users/${USER}/preparations/${PREP}/other.jpg`, USER), false);
});

test("a large HEIC receives only a signed upload URL, and a foreign path is not signed", async () => {
  const ready = deps();
  const opened = await beginPhotoPreparation(beginRequest({
    purpose: "room",
    byteSize: PHOTO_PREPARATION_DIRECT_MAX_BYTES + 1,
  }), ready);
  assert.equal(opened.status, 200);
  if ("signedUrl" in opened) {
    assert.equal(opened.preparationId, PREP);
    assert.equal(opened.signedUrl.startsWith("https://"), true);
    assert.equal("objectPath" in opened, false);
  }

  const foreign = deps({
    begin: async () => ({ ok: true, preparationId: PREP, objectPath: pathFor(OTHER) }),
  });
  const rejected = await beginPhotoPreparation(beginRequest({
    purpose: "room",
    byteSize: PHOTO_PREPARATION_MAX_INPUT_BYTES,
  }), foreign);
  assert.equal(rejected.status, 500);
  assert.equal(foreign.removed.includes(pathFor(OTHER)), false);

  const small = await beginPhotoPreparation(beginRequest({
    purpose: "room",
    byteSize: PHOTO_PREPARATION_DIRECT_MAX_BYTES,
  }), ready);
  assert.equal(small.status, 400);

  const huge = await beginPhotoPreparation(beginRequest({
    purpose: "furniture",
    byteSize: PHOTO_PREPARATION_MAX_INPUT_BYTES + 1,
  }), ready);
  assert.equal(huge.status, 413);
  if ("error" in huge) assert.equal(huge.error, PHOTO_PREPARATION_MESSAGES.tooLarge);
});

test("furniture preparation keeps its own authorization and conversion deletes the original", async () => {
  let converted: PhotoPurpose | null = null;
  const furniture = deps({
    authorize: async (_request, purpose) => purpose === "furniture"
      ? { ok: true, userId: USER }
      : { ok: false, status: 401, error: "Unauthorized." },
    claim: async () => ({
      ok: true,
      objectPath: pathFor(USER),
      byteSize: PHOTO_PREPARATION_DIRECT_MAX_BYTES + 1,
      purpose: "furniture",
    }),
    convert: async (_bytes, purpose) => {
      converted = purpose;
      return { bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) };
    },
  });
  const denied = await completePhotoPreparation(new Request("https://vibode.test/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preparationId: PREP, purpose: "room" }),
  }), furniture);
  assert.equal(denied.status, 401);
  assert.equal(furniture.finished, 0);

  const completed = await completePhotoPreparation(new Request("https://vibode.test/complete", {
    method: "POST",
    headers: { authorization: "Bearer owner", "content-type": "application/json" },
    body: JSON.stringify({ preparationId: PREP, purpose: "furniture" }),
  }), furniture);
  assert.equal(completed.status, 200);
  if ("bytes" in completed) assert.equal(detectStillMagic(completed.bytes), "jpeg");
  assert.equal(converted, "furniture");
  assert.equal(furniture.finished, 1);
  assert.deepEqual(furniture.removed, [pathFor(USER)]);
});

test("a misleading upload and an active conversion are not turned into a JPEG", async () => {
  const png = deps({
    download: async () => Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0),
  });
  const mislabeled = await completePhotoPreparation(new Request("https://vibode.test/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preparationId: PREP, purpose: "room" }),
  }), png);
  assert.equal(mislabeled.status, 422);
  assert.equal(png.finished, 1);
  assert.deepEqual(png.removed, [pathFor(USER)]);

  const busy = deps({
    close: async () => ({ ok: false, code: "busy" }),
  });
  const abandoned = await abandonPhotoPreparation(new Request("https://vibode.test/abandon", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preparationId: PREP, purpose: "room" }),
  }), busy);
  assert.equal(abandoned.status, 409);
  assert.deepEqual(busy.removed, []);
});

test("preparation routes stay off the generation ledger and the worker sweep cannot stop generation", () => {
  const root = process.cwd();
  const files = [
    "lib/photo-preparation/handler.ts",
    "lib/photo-preparation/production.server.ts",
    "lib/photo-preparation/convert.server.ts",
    "lib/photo-preparation/browser.ts",
    "app/api/vibode/photo-preparations/route.ts",
    "app/api/vibode/photo-preparations/complete/route.ts",
    "app/api/vibode/photo-preparations/abandon/route.ts",
  ].map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(files, /reserve\(|createOwnedGeneration|stripe|chargeVibode|MESHY_API|api\.meshy\.ai/);
  assert.match(readFileSync(path.join(root, "lib/photo-preparation/production.server.ts"), "utf8"), /purpose === "furniture"/);
  assert.match(readFileSync(path.join(root, "lib/photo-preparation/production.server.ts"), "utf8"), /authorizeFurnitureGenerationCaller/);
  const worker = readFileSync(path.join(root, "furniture-generation-worker/src/index.ts"), "utf8");
  const maintenanceAt = worker.indexOf("await runFurnitureGenerationMaintenance");
  const photoSweepAt = worker.indexOf("await sweepExpiredPhotoPreparations();");
  const claimAt = worker.indexOf("claim: () => executeFurnitureGenerationClaim");
  assert.ok(maintenanceAt > 0 && claimAt > maintenanceAt && photoSweepAt > claimAt);
  assert.ok(worker.slice(photoSweepAt - 40, photoSweepAt).includes("try {"));
  assert.match(worker, /sweep: \(\) => deps\.commands\.sweep\(Date\.now\(\)\)/);
  const deletion = readFileSync(path.join(root, "app/api/admin/delete-user/route.ts"), "utf8");
  assert.match(deletion, /vibode-photo-preparations/);
  assert.match(deletion, /delete_vibode_photo_preparations_for_user/);
  const migration = readFileSync(path.join(root, "supabase/migrations/20261118203000_vibode_photo_preparations.sql"), "utf8");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /revoke all on table public\.vibode_photo_preparations from public, anon, authenticated, service_role/);
  assert.match(migration, /public boolean not null|false,/);
  assert.doesNotMatch(migration, /vibode-furniture-generation-inputs|vibode-base-images|vibode-furniture-assets/);
});
